// physics.js — local flight simulation: gravity, thrust, drag, aero stability,
// staging execution, ground contact, SOI transitions, debris and particles.
//
// Flight state lives in game.js; this module mutates it one substep at a time.
// Positions/velocities are relative to the current SOI body. Angle 0 = +x, CCW.
//
// PHYSICS MODEL (v2):
//  - Semi-implicit (symplectic) integration with fixed substeps -> stable orbits.
//  - Gravity: full inverse-square field (already exact for a point mass).
//  - Drag: F = ½ ρ v² Cd(hypersonic/transonic corrections) A, Mach-aware.
//  - Aero torque: physical CoP vs CoM pendulum model with aerodynamic damping.
//  - Engines: thrust/Isp corrected for ambient pressure (vacuum gains, sea-level loss).
//  - Reentry heating: q̇ ∝ ρ v³ on a frontal area, with heat sink and thermal failure.
//  - Chutes: real Cd·A canopy drag -> terminal velocity emerges naturally.
//  - Landing: vertical/horizontal speed split, friction, tip-over torque.
//  - Staging: linear momentum conservation, SRB asymmetry -> residual torque.

import { BODIES, childrenOf, bodyLocalPos, bodyLocalVel, atmoDensity, G0 } from './universe.js';
import { PARTS } from './parts.js';
import * as V from './vessel.js';

export const world = {
  debris: [],
  particles: [],
};

// Environment / tuning constants (all in SI-ish units: kg, m, s, N, kN where noted)
const PHYS = {
  maxSubstep: 0.02,          // s — max integration substep (stability)
  mach1: 340,                // m/s at sea level (scaled by sqrt(T/T0) below)
  gamma: 1.4,                // heat capacity ratio of air
  transonicPeak: 1.35,       // Cd multiplier peak near Mach 1
  heatFluxK: 5.0e-4,         // stagnation heat flux coefficient, q̇ = K √ρ v³ (W/m²)
  heatCapacity: 80,          // J/K per ton of hull (heat-sink model)
  maxHullTemp: 2400,         // K — structural failure
  radiateK: 5.67e-8 * 1.2,   // simplified graybody radiation coefficient
  recoveryHeat: 0.55,        // fraction of absorbed heat radiated away per model
  aeroDampK: 0.9,            // aerodynamic rotational damping scale
  copFinK: 4.0,              // fin normal-force coefficient scale
  copBodyK: 0.6,             // body normal-force coefficient (per unit width)
  chuteDrag: 1.4,            // drag coefficient of an open parachute canopy
  semiDeployFactor: 0.12,    // drogue-stage drag fraction above 4 km
  tipoverG: 0.35,            // lateral accel (g) beyond which a landed craft tips
  groundFriction: 0.6,       // Coulomb friction on touchdown skid
  fuelSlosh: 0.02,           // random torque perturbation at high AoA + high q
};

export function clearWorld() {
  world.debris.length = 0;
  world.particles.length = 0;
}

// ---------- helpers ----------
export function altitudeOf(flight) {
  const body = BODIES[flight.bodyKey];
  return Math.hypot(flight.pos.x, flight.pos.y) - body.radius;
}

export function surfaceSpeed(flight) {
  return Math.hypot(flight.vel.x, flight.vel.y); // non-rotating bodies: orbital == surface frame
}

function normAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// Distance from CoM to the bottom of the stack (for ground clearance).
function bottomDistance(stack) {
  const g = V.stackGeometry(stack);
  return g.height / 2 + g.com;
}

// --- Mach-dependent drag multiplier ---
// Subsonic ~1, rises to a transonic peak near M=1.05, relaxes toward ~0.8-1
// as the shock attaches at high Mach (hypersonic).
function machDragFactor(mach) {
  if (mach < 0.8) return 1;
  if (mach < 1.05) {
    const t = (mach - 0.8) / 0.25;           // 0..1 across the transonic rise
    return 1 + (PHYS.transonicPeak - 1) * t * t;
  }
  // gradual decay from the peak toward hypersonic limit 0.9
  return 0.9 + (PHYS.transonicPeak - 0.9) * Math.exp(-(mach - 1.05) / 1.8);
}

// Speed of sound drops with altitude in the exponential model: a ∝ √T, T profile
// approximated by two "layers" (troposphere-like then thermosphere-like).
function speedOfSound(body, alt) {
  const T0 = 290, Tmin = 210;
  const hScale = Math.max(body.atmoHeight, 1);
  const frac = Math.min(1, alt / (hScale * 0.85));
  const T = T0 + (Tmin - T0) * Math.min(frac, 1) + Math.max(0, frac - 1) * 400;
  return PHYS.mach1 * Math.sqrt(T / T0);
}

// --- Engine performance vs ambient pressure -------------------------------
// Simplified ideal-nozzle model: Isp and thrust interpolate between the part's
// rated (sea-level) values and a vacuum bonus proportional to expansion ratio
// proxy. We use Isp * 1.12 max bonus, thrust ~ (1 + 0.15 * vacuumness).
function enginePerformance(part, rho) {
  const seaRho = 1.2;
  const vac = 1 - Math.min(1, rho / seaRho);       // 0 at sea level, 1 in vacuum
  const isp = part.isp * (1 + 0.12 * vac);
  const thrust = part.thrust * (1 + 0.15 * vac);
  return { isp, thrust };
}

// --- Reentry heating -------------------------------------------------------
// Sutton-Graves-like stagnation flux: q̇ = K √ρ v³  [W/m²]; we integrate an
// isothermal heat-sink temperature on a reference 1 m² frontal area.
function stepHeating(flight, rho, spd, mass, dt) {
  if (rho <= 1e-7 || spd < 120) {
    // radiative + gentle cooling
    flight.hullTemp = (flight.hullTemp || 290) - Math.max(0, (flight.hullTemp || 290) - 290) * Math.min(1, dt * 0.25);
    return;
  }
  const flux = PHYS.heatFluxK * Math.sqrt(rho) * spd * spd * spd; // W (per m²)
  const temp = flight.hullTemp || 290;
  const absorbed = flux * dt / (PHYS.heatCapacity * Math.max(mass, 0.1));
  const radiated = PHYS.radiateK * (temp * temp * temp * temp - 290 ** 4) * dt
    / (PHYS.heatCapacity * Math.max(mass, 0.1));
  flight.hullTemp = temp + PHYS.recoveryHeat * absorbed - radiated;
  if (flight.hullTemp > PHYS.maxHullTemp) {
    destroyVessel(flight, `Burned up during reentry (${flight.hullTemp.toFixed(0)} K hull temperature)`);
  }
}

// ---------- main step ----------
// controls: { pitch: -1..1 (rotate), throttle: 0..1, sas: bool }
export function stepFlight(flight, dt, t) {
  if (flight.destroyed) return;
  const body = BODIES[flight.bodyKey];
  const stack = flight.stack;
  if (!stack.length) { destroyVessel(flight, 'Vessel lost'); return; }

  // --- fixed substepping for numeric stability (symplectic Euler) ---
  const steps = Math.max(1, Math.ceil(dt / PHYS.maxSubstep));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    if (flight.destroyed) return;
    integrateSubstep(flight, h, t + i * h, body, stack);
  }
  // SOI check once per frame (cheap, transitions are frame events)
  if (!flight.destroyed && !flight.landed) checkSOI(flight, t);
}

function integrateSubstep(flight, dt, t, body, stack) {
  const r0 = Math.hypot(flight.pos.x, flight.pos.y);
  const alt = r0 - body.radius;
  const mass = V.stackMass(stack);
  const rho = atmoDensity(body, alt);
  const geom = V.stackGeometry(stack);

  // --- fuel & thrust (pressure-corrected) ---
  let thrust = 0;
  const engines = V.activeEngines(stack);
  let gimbalLever = 0;
  for (const e of engines) {
    if (e.kind === 'srb') {
      const perf = enginePerformance(e.part, rho);
      const burn = perf.thrust / (perf.isp * G0) * dt; // tons per booster
      const actual = Math.min(burn, e.holder.fuel);
      e.holder.fuel -= actual;
      thrust += perf.thrust * e.count * (actual / burn || 0);
    } else {
      const th = flight.throttle;
      if (th <= 0) continue;
      const perf = enginePerformance(e.part, rho);
      const want = perf.thrust * th / (perf.isp * G0) * dt;
      const got = V.drainSectionFuel(stack, e.section, want);
      thrust += perf.thrust * th * (want > 0 ? got / want : 0);
      if (got > 0) {
        const idx = stack.findIndex(s => PARTS[s.pid] === e.part && s.ignited);
        const lever = idx >= 0 ? Math.abs(geom.offsets[idx] - geom.com) : 4;
        gimbalLever += perf.thrust * th * 0.06 * Math.max(lever, 1);
      }
    }
  }
  flight.thrustNow = thrust;

  // --- take-off check while landed ---
  const g = body.mu / (r0 * r0);
  if (flight.landed) {
    if (thrust / mass > g * 1.0) {
      flight.landed = false;
    } else {
      flight.vel.x = 0; flight.vel.y = 0;
      flight.angVel = 0;
      return;
    }
  }

  // --- forces ---
  // Gravity: exact inverse-square point-mass field.
  let ax = -body.mu / (r0 * r0 * r0) * flight.pos.x;
  let ay = -body.mu / (r0 * r0 * r0) * flight.pos.y;

  const dir = { x: Math.cos(flight.angle), y: Math.sin(flight.angle) };
  ax += (thrust / mass) * dir.x;
  ay += (thrust / mass) * dir.y;

  const spd = Math.hypot(flight.vel.x, flight.vel.y);
  let q = 0;
  let chuteOut = false;
  if (rho > 0 && spd > 0.1) {
    q = 0.5 * rho * spd * spd; // Pa
    // chute semi-deploy above 4 km
    for (const s of stack) if (s.deployed) s.chuteFactor = alt > 4000 ? PHYS.semiDeployFactor : 1;
    const cda = V.dragCdA(stack);
    // Mach correction: transonic drag rise
    const a = speedOfSound(body, alt);
    const mach = spd / a;
    const cdFactor = machDragFactor(mach);
    const fd = q * cda * cdFactor / 1000; // kN
    // decay-chute separation: deployed chutes rip off above ~40 m/s & q > 40 kPa
    if (stack.some(s => s.deployed) && s_chuteRip(flight, q, spd)) {
      for (const s of stack) if (s.deployed) { s.deployed = false; s.ripped = true; }
      spawnExplosion(flight.bodyKey, flight.pos.x, flight.pos.y, 0.15);
    }
    ax -= (fd / mass) * (flight.vel.x / spd);
    ay -= (fd / mass) * (flight.vel.y / spd);
    flight.qNow = q;
    flight.machNow = mach;
  } else {
    flight.qNow = 0;
    flight.machNow = 0;
  }

  // --- rotation: physical CoP/CoM aerodynamic model + control ---
  const moi = V.stackMoI(stack);
  let torque = 0;
  if (q > 20 && spd > 5) {
    const velAng = Math.atan2(flight.vel.y, flight.vel.x);
    const aoa = normAngle(flight.angle - velAng);
    const finArea = V.totalFinArea(stack);
    const coreW = V.maxWidth(stack);

    // Normal force acts at the Center of Pressure. Fins push the CoP aft;
    // the bare body contributes a small destabilizing lift forward of CoM.
    // Restoring torque = -F_normal * arm(CoP - CoM), F ∝ q * (finArea, width).
    const finForce = q * finArea * PHYS.copFinK / 1000;      // kN
    const bodyForce = q * coreW * PHYS.copBodyK / 1000;      // kN
    const finArm = Math.max(geom.height / 2 - geom.com, 0.5); // fins sit near the tail
    const bodyArm = Math.max(geom.com, 0.2) * 0.5;            // nose lift, forward of CoM
    // static margin: stable if (finForce * finArm > bodyForce * bodyArm)
    torque += -Math.sin(aoa) * (finForce * finArm - bodyForce * bodyArm);

    // aerodynamic rotational damping (weathercock rate damping)
    torque += -flight.angVel * Math.sqrt(q / 1000) * (finArea + 0.3) * PHYS.aeroDampK;

    // high-AoA buffeting: small stochastic perturbation (fuel slosh / flow separation)
    if (Math.abs(aoa) > 0.8 && q > 5000) {
      torque += (Math.random() - 0.5) * 2 * PHYS.fuelSlosh * q / 1000;
    }
  }

  // a deployed parachute makes the craft hang under the canopy (nose anti-velocity)
  chuteOut = rho > 0.001 && spd > 3 && stack.some(s => s.deployed);
  if (chuteOut) {
    const hang = Math.atan2(-flight.vel.y, -flight.vel.x);
    const err = normAngle(hang - flight.angle);
    const k = Math.min(1, dt * 1.5);
    flight.angle += err * k;
    flight.angVel *= (1 - k);
    flight.sasTarget = flight.angle;
  }

  const ctrlAuthority = V.controlTorque(stack) + gimbalLever;
  let cmd = flight.pitchInput || 0;
  if (!cmd && flight.sas) {
    // hold heading — critically-damped PD controller
    const err = normAngle(flight.sasTarget - flight.angle);
    cmd = Math.max(-1, Math.min(1, err * 4 - flight.angVel * 3));
  } else if (cmd) {
    flight.sasTarget = flight.angle; // reset hold target while steering
  }
  torque += cmd * ctrlAuthority;
  torque += -flight.angVel * ctrlAuthority * 0.15; // reaction-wheel damping

  flight.angVel += (torque / moi) * dt;
  flight.angVel = Math.max(-3, Math.min(3, flight.angVel));
  flight.angle += flight.angVel * dt;

  // --- semi-implicit integration: velocities first, then positions ---
  flight.vel.x += ax * dt;
  flight.vel.y += ay * dt;
  flight.pos.x += flight.vel.x * dt;
  flight.pos.y += flight.vel.y * dt;

  // --- heating / stats ---
  stepHeating(flight, rho, spd, mass, dt);
  flight.maxAlt = Math.max(flight.maxAlt || 0, alt);
  flight.maxSpd = Math.max(flight.maxSpd || 0, spd);
  flight.maxQ = Math.max(flight.maxQ || 0, q || 0);

  // --- ground contact ---
  groundContact(flight, dt, body, stack);
}

// chute rip-off check: q > 40 kPa with a fully deployed canopy at speed > 40 m/s
function s_chuteRip(flight, q, spd) {
  return q > 40000 && spd > 40;
}

// --- Landing with vertical/horizontal decomposition, friction, tip-over ---
function groundContact(flight, dt, body, stack) {
  const bd = bottomDistance(stack);
  const r2 = Math.hypot(flight.pos.x, flight.pos.y);
  const clearance = r2 - body.radius - bd;
  if (clearance > 0) return;

  const up = { x: flight.pos.x / r2, y: flight.pos.y / r2 };
  const vSpeed = flight.vel.x * up.x + flight.vel.y * up.y;      // radial component (+ = climbing)
  const hVel = { x: flight.vel.x - vSpeed * up.x, y: flight.vel.y - vSpeed * up.y };
  const hSpeed = Math.hypot(hVel.x, hVel.y);
  const speed = Math.hypot(flight.vel.x, flight.vel.y);
  const safe = V.landingSafeSpeed(stack);
  const upAng = Math.atan2(flight.pos.y, flight.pos.x);
  const tilt = Math.abs(normAngle(flight.angle - upAng));

  if (speed > safe || Math.abs(vSpeed) > safe) {
    destroyVessel(flight, `Impact at ${speed.toFixed(0)} m/s (max survivable: ${safe.toFixed(0)} m/s)`);
    return;
  }
  if (tilt >= 0.6) {
    destroyVessel(flight, 'Tipped over on landing');
    return;
  }

  // touchdown: snap to surface, zero radial velocity
  flight.landed = true;
  const rr = body.radius + bd;
  const k = rr / r2;
  flight.pos.x *= k; flight.pos.y *= k;

  // tangential skid: Coulomb friction bleeds horizontal speed
  const mu = PHYS.groundFriction;
  const g = body.mu / (rr * rr);
  const dv = Math.min(hSpeed, mu * g * dt * 60); // frame-scaled skid
  if (hSpeed > 1e-6) {
    flight.vel.x = hVel.x / hSpeed * (hSpeed - dv);
    flight.vel.y = hVel.y / hSpeed * (hSpeed - dv);
  } else { flight.vel.x = 0; flight.vel.y = 0; }
  // residual horizontal speed above tipover threshold = topple
  const hLeft = Math.hypot(flight.vel.x, flight.vel.y);
  if (hLeft * hLeft / (bd * 0.5) > PHYS.tipoverG * g) {
    destroyVessel(flight, 'Skidded and tipped over on landing');
    return;
  }
  flight.vel.x = 0; flight.vel.y = 0;
  flight.angVel = 0;
  flight.angle = upAng;
  flight.sasTarget = upAng;
}

export function checkSOI(flight, t) {
  const body = BODIES[flight.bodyKey];
  const r = Math.hypot(flight.pos.x, flight.pos.y);
  if (body.soi !== Infinity && r > body.soi) {
    // exit to parent
    const bp = bodyLocalPos(body, t), bv = bodyLocalVel(body, t);
    flight.pos.x += bp.x; flight.pos.y += bp.y;
    flight.vel.x += bv.x; flight.vel.y += bv.y;
    flight.bodyKey = body.orbit.parent;
    flight.soiChanged = true;
    return true;
  }
  for (const child of childrenOf(flight.bodyKey)) {
    const cp = bodyLocalPos(child, t);
    const dx = flight.pos.x - cp.x, dy = flight.pos.y - cp.y;
    if (Math.hypot(dx, dy) < child.soi) {
      const cv = bodyLocalVel(child, t);
      flight.pos.x = dx; flight.pos.y = dy;
      flight.vel.x -= cv.x; flight.vel.y -= cv.y;
      flight.bodyKey = child.key;
      flight.soiChanged = true;
      return true;
    }
  }
  return false;
}

// ---------- staging ----------
// Executes the next step in the staging queue. Returns the step, or null.
export function executeNextStage(flight) {
  const step = flight.queue[flight.queueIdx];
  if (!step) return null;
  flight.queueIdx++;
  const stack = flight.stack;

  if (step.type === 'ignite') {
    const sections = V.computeSections(stack);
    V.applyIgnite(stack, sections.length - 1);
    if (flight.throttle <= 0) flight.throttle = 1;
  } else if (step.type === 'dropBoosters') {
    const sections = V.computeSections(stack);
    const sec = sections[sections.length - 1];
    const geom = V.stackGeometry(stack);
    for (let i = sec.start; i <= sec.end; i++) {
      const s = stack[i];
      const droppers = s.radials.filter(rp => PARTS[rp.pid].type === 'srb');
      s.radials = s.radials.filter(rp => PARTS[rp.pid].type !== 'srb');
      for (const d of droppers) {
        for (const side of [-1, 1]) {
          spawnDebris(flight, [{ pid: d.pid, fuel: d.fuel, ignited: false, radials: [] }],
            geom.offsets[i], side * 6);
        }
      }
      // asymmetric SRB drop (one side first) leaves residual angular momentum
      if (droppers.length % 2 === 1) flight.angVel += 0.15 * (Math.random() < 0.5 ? -1 : 1);
    }
  } else if (step.type === 'separate') {
    const at = Math.min(step.at, stack.length);
    if (at > 0 && at < stack.length) {
      const dropped = stack.slice(at);
      const geom = V.stackGeometry(stack);
      stack.length = at;
      spawnDebris(flight, dropped, geom.offsets[at] || -geom.height / 2, 0, -3);
      // separation nudge — momentum-conserving: upper stage keeps its velocity,
      // the decoupler impulse (0.5 m/s) applies to the (lighter) upper stack.
      const dir = { x: Math.cos(flight.angle), y: Math.sin(flight.angle) };
      const mUpper = V.stackMass(stack);
      const mLower = Math.max(V.stackMass(dropped), 0.05);
      // impulse J shared by both bodies: v_upper += J/m_upper, v_lower -= J/m_lower
      const J = 0.5 * mUpper; // tuned so upper gets ~0.5 m/s vs original feel
      flight.vel.x += dir.x * J / mUpper; flight.vel.y += dir.y * J / mUpper;
    }
    // auto-ignite new bottom section
    const sections = V.computeSections(stack);
    if (sections.length) {
      V.applyIgnite(stack, sections.length - 1);
      if (flight.throttle <= 0) flight.throttle = 1;
    }
  } else if (step.type === 'chute') {
    for (const s of stack) {
      if (PARTS[s.pid].type === 'parachute') s.deployed = true;
    }
  }
  return step;
}

function spawnDebris(flight, stack, yOffset, sideKick = 0, axialKick = 0) {
  const dir = { x: Math.cos(flight.angle), y: Math.sin(flight.angle) };
  const side = { x: -dir.y, y: dir.x };
  world.debris.push({
    bodyKey: flight.bodyKey,
    pos: {
      x: flight.pos.x + dir.x * yOffset + side.x * sideKick * 0.3,
      y: flight.pos.y + dir.y * yOffset + side.y * sideKick * 0.3,
    },
    vel: {
      x: flight.vel.x + side.x * sideKick + dir.x * axialKick,
      y: flight.vel.y + side.y * sideKick + dir.y * axialKick,
    },
    angle: flight.angle, angVel: (Math.random() - 0.5) * 2,
    stack, ttl: 90,
  });
}

export function stepDebris(dt, t) {
  const steps = Math.max(1, Math.ceil(dt / PHYS.maxSubstep));
  const h = dt / steps;
  for (let i = world.debris.length - 1; i >= 0; i--) {
    const d = world.debris[i];
    d.ttl -= dt;
    const body = BODIES[d.bodyKey];
    const r = Math.hypot(d.pos.x, d.pos.y);
    const alt = r - body.radius;
    if (d.ttl <= 0 || alt > body.atmoHeight + 200_000) { world.debris.splice(i, 1); continue; }
    const m = Math.max(V.stackMass(d.stack), 0.05);
    for (let s = 0; s < steps; s++) {
      const r2 = Math.hypot(d.pos.x, d.pos.y);
      const a2 = r2 - body.radius;
      let ax = -body.mu / (r2 * r2 * r2) * d.pos.x;
      let ay = -body.mu / (r2 * r2 * r2) * d.pos.y;
      const rho = atmoDensity(body, a2);
      const spd = Math.hypot(d.vel.x, d.vel.y);
      if (rho > 0 && spd > 0.1) {
        const a = speedOfSound(body, a2);
        const fd = 0.5 * rho * spd * spd * V.dragCdA(d.stack) * machDragFactor(spd / a) / 1000;
        ax -= fd / m * d.vel.x / spd;
        ay -= fd / m * d.vel.y / spd;
        // debris burns up on fast atmospheric entry
        if (rho > 0.02 && spd > 1600) { spawnExplosion(d.bodyKey, d.pos.x, d.pos.y, 0.5); d.ttl = 0; break; }
      }
      d.vel.x += ax * h; d.vel.y += ay * h;
      d.pos.x += d.vel.x * h; d.pos.y += d.vel.y * h;
    }
    if (d.ttl <= 0) { world.debris.splice(i, 1); continue; }
    d.angle += d.angVel * dt;
    if (alt <= V.stackHeight(d.stack) / 2) {
      spawnExplosion(d.bodyKey, d.pos.x, d.pos.y, 0.6);
      world.debris.splice(i, 1);
    }
  }
}

// ---------- destruction & particles ----------
export function destroyVessel(flight, reason) {
  if (flight.destroyed) return;
  flight.destroyed = true;
  flight.destroyReason = reason;
  spawnExplosion(flight.bodyKey, flight.pos.x, flight.pos.y, 1.5 + V.stackMass(flight.stack) * 0.08);
}

export function spawnExplosion(bodyKey, x, y, scale = 1) {
  const n = Math.min(60, 25 * scale);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = (10 + Math.random() * 45) * scale;
    world.particles.push({
      bodyKey, x, y,
      vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: 1.2 + Math.random() * 1.3, maxLife: 2.5,
      size: (1.5 + Math.random() * 4) * scale,
      color: Math.random() < 0.6 ? '#ff9633' : (Math.random() < 0.5 ? '#ffd75e' : '#888888'),
    });
  }
}

export function stepParticles(dt) {
  for (let i = world.particles.length - 1; i >= 0; i--) {
    const p = world.particles[i];
    p.life -= dt;
    if (p.life <= 0) { world.particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= (1 - 0.8 * dt); p.vy *= (1 - 0.8 * dt);
  }
}
