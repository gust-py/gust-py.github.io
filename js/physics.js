// physics.js — local flight simulation: gravity, thrust, drag, aero stability,
// staging execution, ground contact, SOI transitions, debris and particles.
//
// Flight state lives in game.js; this module mutates it one substep at a time.
// Positions/velocities are relative to the current SOI body. Angle 0 = +x, CCW.

import { BODIES, childrenOf, bodyLocalPos, bodyLocalVel, atmoDensity, G0 } from './universe.js';
import { PARTS } from './parts.js';
import * as V from './vessel.js';

export const world = {
  debris: [],
  particles: [],
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

// ---------- main step ----------
// controls: { pitch: -1..1 (rotate), throttle: 0..1, sas: bool }
export function stepFlight(flight, dt, t) {
  if (flight.destroyed) return;
  const body = BODIES[flight.bodyKey];
  const stack = flight.stack;
  if (!stack.length) { destroyVessel(flight, 'Vessel lost'); return; }

  const r = Math.hypot(flight.pos.x, flight.pos.y);
  const alt = r - body.radius;
  const mass = V.stackMass(stack);
  const rho = atmoDensity(body, alt);

  // --- fuel & thrust ---
  let thrust = 0;
  const engines = V.activeEngines(stack);
  const geom = V.stackGeometry(stack);
  let gimbalLever = 0;
  for (const e of engines) {
    if (e.kind === 'srb') {
      const burn = e.part.thrust / (e.part.isp * G0) * dt; // tons per booster
      const actual = Math.min(burn, e.holder.fuel);
      e.holder.fuel -= actual;
      thrust += e.part.thrust * e.count * (actual / burn || 0);
    } else {
      const th = flight.throttle;
      if (th <= 0) continue;
      const want = e.part.thrust * th / (e.part.isp * G0) * dt;
      const got = V.drainSectionFuel(stack, e.section, want);
      thrust += e.part.thrust * th * (want > 0 ? got / want : 0);
      if (got > 0) {
        // engine gimbal contributes steering authority: thrust * sin(~3.5deg) * lever arm
        const idx = stack.findIndex(s => PARTS[s.pid] === e.part && s.ignited);
        const lever = idx >= 0 ? Math.abs(geom.offsets[idx] - geom.com) : 4;
        gimbalLever += e.part.thrust * th * 0.06 * Math.max(lever, 1);
      }
    }
  }
  flight.thrustNow = thrust;

  // --- take-off check while landed ---
  const g = body.mu / (r * r);
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
  let ax = -body.mu / (r * r * r) * flight.pos.x;
  let ay = -body.mu / (r * r * r) * flight.pos.y;

  const dir = { x: Math.cos(flight.angle), y: Math.sin(flight.angle) };
  ax += (thrust / mass) * dir.x;
  ay += (thrust / mass) * dir.y;

  const spd = Math.hypot(flight.vel.x, flight.vel.y);
  let q = 0;
  if (rho > 0 && spd > 0.1) {
    q = 0.5 * rho * spd * spd; // Pa
    // chute semi-deploy above 4 km
    for (const s of stack) if (s.deployed) s.chuteFactor = alt > 4000 ? 0.15 : 1;
    const cda = V.dragCdA(stack);
    const fd = q * cda / 1000; // kN
    ax -= (fd / mass) * (flight.vel.x / spd);
    ay -= (fd / mass) * (flight.vel.y / spd);
    flight.qNow = q;
  } else flight.qNow = 0;

  // --- rotation: aero stability + control ---
  const moi = V.stackMoI(stack);
  let torque = 0;
  if (q > 50 && spd > 10) {
    const velAng = Math.atan2(flight.vel.y, flight.vel.x);
    const aoa = normAngle(flight.angle - velAng);
    const finArea = V.totalFinArea(stack);
    const coreW = V.maxWidth(stack);
    // fins stabilize (restore toward prograde); a finless rocket is mildly unstable
    const K = finArea * 3.0 - coreW * 0.35;
    torque += -Math.sin(aoa) * (q / 1000) * K;
    // aero damping
    torque += -flight.angVel * (q / 1000) * (finArea + 0.3) * 0.8;
  }

  // a deployed parachute makes the craft hang under the canopy (nose anti-velocity)
  const chuteOut = rho > 0.001 && spd > 3 && stack.some(s => s.deployed);
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
    // hold heading
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

  // --- integrate ---
  flight.vel.x += ax * dt;
  flight.vel.y += ay * dt;
  flight.pos.x += flight.vel.x * dt;
  flight.pos.y += flight.vel.y * dt;

  // --- heating / stats ---
  flight.maxAlt = Math.max(flight.maxAlt || 0, alt);
  flight.maxSpd = Math.max(flight.maxSpd || 0, spd);
  // calor normalizado 0..1 pra cauda de plasma (suavizado: o brilho "respira",
  // não stroba entre frames). ρ·v³ com portão de velocidade.
  // rv = velocidade radial: + afastando do planeta (subida) / − mergulhando
  // (reentrada). Plasma SÓ na reentrada — subindo o casco fica frio.
  const rr0 = Math.hypot(flight.pos.x, flight.pos.y) || 1;
  const rv0 = (flight.pos.x * flight.vel.x + flight.vel.y * flight.vel.y) / rr0;
  const hT = plasmaHeat(body, alt, spd, rv0);
  flight.heatFlux = (flight.heatFlux || 0) + (hT - (flight.heatFlux || 0)) * Math.min(1, dt * 5);

  // --- ground contact ---
  const bd = bottomDistance(stack);
  const r2 = Math.hypot(flight.pos.x, flight.pos.y);
  if (r2 - body.radius <= bd) {
    const vSpeed = Math.abs((flight.vel.x * flight.pos.x + flight.vel.y * flight.pos.y) / r2);
    const speed = Math.hypot(flight.vel.x, flight.vel.y);
    const safe = V.landingSafeSpeed(stack);
    const upAng = Math.atan2(flight.pos.y, flight.pos.x);
    const tilt = Math.abs(normAngle(flight.angle - upAng));
    if (speed <= safe && tilt < 0.6) {
      // touchdown
      flight.landed = true;
      const rr = body.radius + bd;
      const k = rr / r2;
      flight.pos.x *= k; flight.pos.y *= k;
      flight.vel.x = 0; flight.vel.y = 0;
      flight.angVel = 0;
      flight.angle = upAng;
      flight.sasTarget = upAng;
    } else {
      destroyVessel(flight, speed > safe
        ? `Impact at ${speed.toFixed(0)} m/s (max survivable: ${safe.toFixed(0)} m/s)`
        : 'Tipped over on landing');
    }
    return;
  }

  // --- SOI transitions ---
  checkSOI(flight, t);
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
    }
  } else if (step.type === 'separate') {
    const at = Math.min(step.at, stack.length);
    if (at > 0 && at < stack.length) {
      const dropped = stack.slice(at);
      const geom = V.stackGeometry(stack);
      stack.length = at;
      spawnDebris(flight, dropped, geom.offsets[at] || -geom.height / 2, 0, -3);
      // separation nudge
      const dir = { x: Math.cos(flight.angle), y: Math.sin(flight.angle) };
      flight.vel.x += dir.x * 0.5; flight.vel.y += dir.y * 0.5;
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
  for (let i = world.debris.length - 1; i >= 0; i--) {
    const d = world.debris[i];
    d.ttl -= dt;
    const body = BODIES[d.bodyKey];
    const r = Math.hypot(d.pos.x, d.pos.y);
    const alt = r - body.radius;
    if (d.ttl <= 0 || alt > body.atmoHeight + 200_000) { world.debris.splice(i, 1); continue; }
    const m = Math.max(V.stackMass(d.stack), 0.05);
    let ax = -body.mu / (r * r * r) * d.pos.x;
    let ay = -body.mu / (r * r * r) * d.pos.y;
    const rho = atmoDensity(body, alt);
    const spd = Math.hypot(d.vel.x, d.vel.y);
    if (rho > 0 && spd > 0.1) {
      const fd = 0.5 * rho * spd * spd * V.dragCdA(d.stack) / 1000;
      ax -= fd / m * d.vel.x / spd;
      ay -= fd / m * d.vel.y / spd;
    }
    d.vel.x += ax * dt; d.vel.y += ay * dt;
    d.pos.x += d.vel.x * dt; d.pos.y += d.vel.y * dt;
    d.angle += d.angVel * dt;
    if (alt <= V.stackHeight(d.stack) / 2) {
      spawnExplosion(d.bodyKey, d.pos.x, d.pos.y, 0.6);
      world.debris.splice(i, 1);
    }
  }
}

// ---------- destruction & particles ----------
export function destroyVessel(flight, reason) {
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
    // plasma é gás quente e rarefeito: quase não freia; a fumaça-violeta que
    // forma o manto externo freia ainda menos; fumaça/explosão freia forte
    const drag = p.kind === 'plasma' ? 0.25 : p.kind === 'plasmaSmoke' ? 0.12 : 0.8;
    p.vx *= (1 - drag * dt); p.vy *= (1 - drag * dt);
  }
}

// ---------- plasma trail (reentry heating) ----------
// Modelo visual estilo Sutton-Graves: fluxo ∝ ρ·v³, com PORTÃO de velocidade
// (voo lento nunca brilha, nem no mar). Normalizado 0..1 contra um reentry
// quente de referência (~3000 m/s na baixa atmosfera da Gaia = pico).
const PLASMA_REF_FLUX = 2.6e8;  // ρ·v³ que satura o efeito
const PLASMA_MIN_SPD = 520;     // m/s — abaixo disso: frio, zero plasma
const PLASMA_FULL_SPD = 1150;   // m/s — portão totalmente aberto

// Calor normalizado (heatFlux / maxHeatFlux) na atmosfera/velocidade atual.
// O fator ρ já embute a altitude: ar mais fino = menos plasma.
// radialV = componente radial da velocidade (m/s): + subindo, − caindo.
// SEM reentrada não há plasma: na subida/apogeu o efeito fica em zero —
// o fogo só aparece mergulhando de verdade na atmosfera (rampa suave nos
// primeiros 30 m/s de mergulho pra não "pops" ao cruzar o apogeu).
export function plasmaHeat(body, alt, spd, radialV = 0) {
  if (radialV > -1) return 0;   // subindo ou apogeu: frio
  if (spd < PLASMA_MIN_SPD) return 0;
  const rho = atmoDensity(body, Math.max(alt, 0));
  if (rho <= 0) return 0;
  const flux = rho * spd * spd * spd;
  const gate = Math.min(1, (spd - PLASMA_MIN_SPD) / (PLASMA_FULL_SPD - PLASMA_MIN_SPD));
  const desc = Math.min(1, -radialV / 30);  // rampa conforme mergulha de verdade
  return Math.max(0, Math.min(1, flux / PLASMA_REF_FLUX)) * gate * desc;
}

// Emissor de partículas REMOVIDO a pedido: a cauda agora são JATOS contínuos
// de fogo desenhados proceduralmente (drawPlasma em render.js) — sem
// partículas. A função continua exportada como no-op para não quebrar o
// game.js, que chama PHY.emitPlasma a cada frame.
export function emitPlasma() {}
