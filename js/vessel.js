// vessel.js — vessel construction, staging, mass properties and delta-v analysis.
//
// A DESIGN is: { name, stack: [ { pid, radials: [pid, ...] } ] }
//   stack[0] is the TOP of the rocket. Each radial entry is a symmetric PAIR
//   (drawn on both sides, counted twice for mass/thrust/cost).
//
// A FLIGHT STACK entry is: { pid, fuel, ignited, deployed, radials: [{pid, fuel, ignited}] }

import { PARTS } from './parts.js';
import { G0 } from './universe.js';

export function newDesign() {
  return { name: 'Untitled Rocket', stack: [] };
}

export function designCost(design) {
  let c = 0;
  for (const s of design.stack) {
    c += PARTS[s.pid].cost;
    for (const rp of s.radials) c += PARTS[rp].cost * 2;
  }
  return c;
}

export function designHasType(design, type) {
  return design.stack.some(s => PARTS[s.pid].type === type ||
    s.radials.some(rp => PARTS[rp].type === type));
}

// ---------- sections ----------
// Sections are contiguous runs of stack indices, split so that each DECOUPLER is
// the TOP part of the section below it (firing a decoupler jettisons its whole
// section and everything beneath). Returns array of {start, end} from TOP to BOTTOM.
export function computeSections(stack) {
  const sections = [];
  let start = 0;
  for (let i = 0; i < stack.length; i++) {
    if (i > 0 && PARTS[stack[i].pid].type === 'decoupler') {
      sections.push({ start, end: i - 1 });
      start = i;
    }
  }
  if (stack.length) sections.push({ start, end: stack.length - 1 });
  return sections;
}

export function sectionOfIndex(sections, i) {
  return sections.findIndex(s => i >= s.start && i <= s.end);
}

// ---------- staging sequence ----------
// Steps, in press-space order (bottom section first):
//   {type:'ignite', section}          — light liquid engines + radial SRBs of that section
//   {type:'dropBoosters', section}    — jettison that section's radial SRBs
//   {type:'separate', at}             — fire decoupler at stack index `at` (drops it + below), then auto-ignite next section
//   {type:'chute'}                    — deploy all parachutes
export function buildStagingQueue(stack) {
  const sections = computeSections(stack);
  const steps = [];
  for (let si = sections.length - 1; si >= 0; si--) {
    const sec = sections[si];
    const hasEngine = rangeHas(stack, sec, p => p.type === 'engine' || p.type === 'srb');
    const hasRadialBoosters = rangeHasRadial(stack, sec, p => p.type === 'srb');
    if (si === sections.length - 1) {
      if (hasEngine || hasRadialBoosters) steps.push({ type: 'ignite', section: si, label: 'Ignition!' });
    }
    if (hasRadialBoosters) steps.push({ type: 'dropBoosters', section: si, label: 'Drop boosters' });
    if (si > 0) {
      steps.push({ type: 'separate', at: sec.start, label: 'Stage separation' });
    }
  }
  const hasChute = stack.some(s => PARTS[s.pid].type === 'parachute');
  if (hasChute) steps.push({ type: 'chute', label: 'Deploy parachutes' });
  return steps;
}

function rangeHas(stack, sec, pred) {
  for (let i = sec.start; i <= sec.end; i++) if (pred(PARTS[stack[i].pid])) return true;
  return false;
}
function rangeHasRadial(stack, sec, pred) {
  for (let i = sec.start; i <= sec.end; i++) {
    for (const r of stack[i].radials) {
      const rp = r.pid !== undefined ? r.pid : r;
      if (pred(PARTS[rp])) return true;
    }
  }
  return false;
}

// ---------- flight vessel ----------
export function makeFlightStack(design) {
  return design.stack.map(s => ({
    pid: s.pid,
    fuel: PARTS[s.pid].fuel || 0,
    ignited: false,
    deployed: false,
    radials: s.radials.map(rp => ({ pid: rp, fuel: PARTS[rp].fuel || 0, ignited: false })),
  }));
}

// Total mass in tons (dry + remaining fuel), radials counted twice.
export function stackMass(stack) {
  let m = 0;
  for (const s of stack) {
    m += PARTS[s.pid].mass + (s.fuel || 0);
    for (const r of s.radials) m += (PARTS[r.pid].mass + (r.fuel || 0)) * 2;
  }
  return m;
}

// Height of the stack in meters.
export function stackHeight(stack) {
  return stack.reduce((h, s) => h + PARTS[s.pid].h, 0);
}

// Per-part vertical offsets (meters, from stack CENTER, +up toward nose).
// Returns { offsets: [y_center per stack index], com, height }.
export function stackGeometry(stack) {
  const height = stackHeight(stack);
  const offsets = [];
  let yTop = height / 2;
  for (const s of stack) {
    const h = PARTS[s.pid].h;
    offsets.push(yTop - h / 2);
    yTop -= h;
  }
  // Center of mass
  let m = 0, my = 0;
  stack.forEach((s, i) => {
    const pm = PARTS[s.pid].mass + (s.fuel || 0);
    m += pm; my += pm * offsets[i];
    for (const r of s.radials) {
      const rm = (PARTS[r.pid].mass + (r.fuel || 0)) * 2;
      m += rm; my += rm * offsets[i];
    }
  });
  return { offsets, com: m > 0 ? my / m : 0, height };
}

// Moment of inertia approximation (rod of length h): m*h^2/12, min for stubby craft.
export function stackMoI(stack) {
  const m = stackMass(stack);
  const h = Math.max(stackHeight(stack), 2);
  return Math.max(m * h * h / 12, 1);
}

export function controlTorque(stack) {
  let t = 0;
  for (const s of stack) if (PARTS[s.pid].torque) t += PARTS[s.pid].torque;
  return t;
}

export function totalFinArea(stack) {
  let a = 0;
  for (const s of stack) {
    if (PARTS[s.pid].finArea) a += PARTS[s.pid].finArea;
    for (const r of s.radials) if (PARTS[r.pid].finArea) a += PARTS[r.pid].finArea * 2;
  }
  return a;
}

export function maxWidth(stack) {
  let w = 0;
  for (const s of stack) {
    let pw = PARTS[s.pid].w;
    for (const r of s.radials) pw += PARTS[r.pid].w * 2;
    w = Math.max(w, pw);
  }
  return w || 1.3;
}

// Drag coefficient * frontal area (m^2). Nose shape matters; deployed chutes dominate.
export function dragCdA(stack) {
  if (!stack.length) return 1;
  const core = Math.max(...stack.map(s => PARTS[s.pid].w));
  const topType = PARTS[stack[0].pid].type;
  const noseFactor = (topType === 'nosecone' || topType === 'pod' || topType === 'parachute') ? 0.6 : 1.1;
  let cda = 0.8 * core * core * noseFactor;
  for (const s of stack) {
    for (const r of s.radials) {
      const rp = PARTS[r.pid];
      if (rp.type === 'srb') cda += 0.35 * rp.w * rp.w * 2;
    }
    if (s.deployed && PARTS[s.pid].dragArea) cda += PARTS[s.pid].dragArea * (s.chuteFactor || 1);
  }
  return cda;
}

export function landingSafeSpeed(stack) {
  let v = 8; // base survivable impact
  for (const s of stack) {
    for (const r of s.radials) if (PARTS[r.pid].safeSpeed) { v += PARTS[r.pid].safeSpeed; break; }
  }
  return Math.min(v, 16);
}

export function scienceMultiplier(stack) {
  let bonus = 0;
  for (const s of stack) {
    if (PARTS[s.pid].sciBonus) bonus += PARTS[s.pid].sciBonus;
    for (const r of s.radials) if (PARTS[r.pid].sciBonus) bonus += PARTS[r.pid].sciBonus;
  }
  return 1 + bonus;
}

// Remaining stack value in funds (for recovery refunds).
export function stackValue(stack) {
  let c = 0;
  for (const s of stack) {
    c += PARTS[s.pid].cost;
    for (const r of s.radials) c += PARTS[r.pid].cost * 2;
  }
  return c;
}

// ---------- engines & fuel ----------
// Active thrust sources for the current stack state.
// Liquid engines drain the pooled tank fuel of their own section.
export function activeEngines(stack) {
  const sections = computeSections(stack);
  const out = [];
  stack.forEach((s, i) => {
    const p = PARTS[s.pid];
    if (p.type === 'engine' && s.ignited) {
      out.push({ kind: 'liquid', part: p, section: sectionOfIndex(sections, i), throttleable: true });
    }
    if (p.type === 'srb' && s.ignited && s.fuel > 0) {
      out.push({ kind: 'srb', part: p, holder: s, count: 1 });
    }
    for (const r of s.radials) {
      const rp = PARTS[r.pid];
      if (rp.type === 'srb' && r.ignited && r.fuel > 0) {
        out.push({ kind: 'srb', part: rp, holder: r, count: 2 });
      }
    }
  });
  return out;
}

export function sectionFuel(stack, sectionIdx) {
  const sections = computeSections(stack);
  const sec = sections[sectionIdx];
  if (!sec) return 0;
  let f = 0;
  for (let i = sec.start; i <= sec.end; i++) f += stack[i].fuel || 0;
  return f;
}

// Consume `amount` tons of liquid fuel from a section's tanks (top-down within section).
// Returns amount actually consumed.
export function drainSectionFuel(stack, sectionIdx, amount) {
  const sections = computeSections(stack);
  const sec = sections[sectionIdx];
  if (!sec) return 0;
  let left = amount;
  for (let i = sec.end; i >= sec.start && left > 0; i--) {
    const s = stack[i];
    if (PARTS[s.pid].type !== 'tank' || !s.fuel) continue;
    const take = Math.min(s.fuel, left);
    s.fuel -= take; left -= take;
  }
  return amount - left;
}

// ---------- delta-v analysis (editor) ----------
// Simulates the staging queue on a copy of the flight stack.
// Returns [{ label, deltaV, twr, burnTime, startMass }] and totals.
export function analyzeDesign(design, g = 9.81) {
  const stack = makeFlightStack(design);
  const queue = buildStagingQueue(design.stack);
  const stages = [];
  let stackNow = stack;

  const doBurnPhase = () => {
    // Burn all currently ignited sources until every one is exhausted.
    let dv = 0, burnTime = 0;
    const m0 = stackMass(stackNow);
    let guard = 0;
    while (guard++ < 50) {
      const engines = activeEngines(stackNow);
      const sources = [];
      for (const e of engines) {
        if (e.kind === 'srb') {
          sources.push({ thrust: e.part.thrust * e.count, mdot: e.part.thrust * e.count / (e.part.isp * G0), fuelLeft: e.holder.fuel * e.count, srb: e });
        } else {
          const f = sectionFuel(stackNow, e.section);
          if (f > 0) sources.push({ thrust: e.part.thrust, mdot: e.part.thrust / (e.part.isp * G0), fuelLeft: f, liquid: e });
        }
      }
      if (!sources.length) break;
      // merge liquid engines sharing a section
      const t = Math.min(...sources.map(s => s.fuelLeft / s.mdot));
      const thrust = sources.reduce((a, s) => a + s.thrust, 0);
      const mdot = sources.reduce((a, s) => a + s.mdot, 0);
      const mA = stackMass(stackNow);
      const mB = mA - mdot * t;
      dv += (thrust / mdot) * Math.log(mA / mB);
      burnTime += t;
      // apply consumption
      for (const s of sources) {
        const used = s.mdot * t;
        if (s.srb) s.srb.holder.fuel = Math.max(0, s.srb.holder.fuel - used / s.srb.count);
        else drainSectionFuel(stackNow, s.liquid.section, used);
      }
    }
    return { dv, burnTime, m0 };
  };

  for (const step of queue) {
    if (step.type === 'ignite') {
      applyIgnite(stackNow, step.section);
      const thrust = igniteThrust(stackNow);
      const { dv, burnTime, m0 } = doBurnPhase();
      stages.push({ label: `Stage ${stages.length + 1}`, deltaV: dv, burnTime, startMass: m0, twr: thrust / (m0 * g) });
    } else if (step.type === 'dropBoosters') {
      for (const s of stackNow) s.radials = s.radials.filter(r => PARTS[r.pid].type !== 'srb');
    } else if (step.type === 'separate') {
      stackNow = stackNow.slice(0, step.at);
      // auto-ignite new bottom section
      const sections = computeSections(stackNow);
      if (sections.length) {
        applyIgnite(stackNow, sections.length - 1);
        const thrust = igniteThrust(stackNow);
        const { dv, burnTime, m0 } = doBurnPhase();
        if (dv > 0) stages.push({ label: `Stage ${stages.length + 1}`, deltaV: dv, burnTime, startMass: m0, twr: thrust / (m0 * g) });
      }
    }
  }
  const totalDv = stages.reduce((a, s) => a + s.deltaV, 0);
  return { stages, totalDv };
}

function applyIgnite(stack, sectionIdx) {
  const sections = computeSections(stack);
  const sec = sections[sectionIdx];
  if (!sec) return;
  for (let i = sec.start; i <= sec.end; i++) {
    const s = stack[i];
    const p = PARTS[s.pid];
    if (p.type === 'engine' || p.type === 'srb') s.ignited = true;
    for (const r of s.radials) if (PARTS[r.pid].type === 'srb') r.ignited = true;
  }
}

function igniteThrust(stack) {
  let t = 0;
  for (const e of activeEngines(stack)) {
    t += e.part.thrust * (e.count || 1);
  }
  return t;
}

export { applyIgnite };
