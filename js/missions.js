// missions.js — contracts and science "firsts".
//
// Missions are checked every frame against the live flight + program state.
// Firsts are one-time science awards for reaching new situations.

import { BODIES } from './universe.js';
import { orbitFromState } from './orbits.js';
import { scienceMultiplier } from './vessel.js';

// ---------- science firsts ----------
// key: `${event}:${bodyKey}` stored in game.firsts
export const FIRST_SCIENCE = {
  'space:gaia': { sci: 8, label: 'First taste of space' },
  'orbit:gaia': { sci: 12, label: 'Orbiting Gaia' },
  'highalt:gaia': { sci: 4, label: 'Above 20 km' },
  'soi:crumb': { sci: 15, label: 'Entered Crumb\'s sphere of influence' },
  'orbit:crumb': { sci: 20, label: 'Orbiting Crumb' },
  'land:crumb': { sci: 40, label: 'Standing on Crumb!' },
  'soi:helios': { sci: 20, label: 'Interplanetary space' },
  'soi:scorch': { sci: 35, label: 'Visiting Scorch' },
  'orbit:scorch': { sci: 30, label: 'Orbiting Scorch' },
  'land:scorch': { sci: 70, label: 'Landed on Scorch' },
  'soi:rusty': { sci: 35, label: 'Visiting Rusty' },
  'orbit:rusty': { sci: 30, label: 'Orbiting Rusty' },
  'land:rusty': { sci: 70, label: 'Landed on Rusty' },
};

// Determine current situation flags for the active flight.
export function detectEvents(flight, t) {
  const body = BODIES[flight.bodyKey];
  const alt = Math.hypot(flight.pos.x, flight.pos.y) - body.radius;
  const events = [];

  events.push(`soi:${flight.bodyKey}`);
  if (alt > 20_000) events.push(`highalt:${flight.bodyKey}`);
  if (alt > (body.atmoHeight || 20_000)) events.push(`space:${flight.bodyKey}`);

  // orbit: periapsis above atmosphere (or 10 km for airless), closed orbit
  const o = orbitFromState(body.mu, flight.pos.x, flight.pos.y, flight.vel.x, flight.vel.y, t);
  const minPe = body.radius + (body.atmoHeight || 10_000);
  if (o.e < 1 && o.rPe > minPe) events.push(`orbit:${flight.bodyKey}`);

  if (flight.landed && flight.bodyKey !== 'gaia') events.push(`land:${flight.bodyKey}`);
  if (flight.landed && flight.bodyKey === 'gaia' && flight.hasFlown) events.push(`landed-back:gaia`);

  return { events, alt, orbit: o };
}

// Awards new firsts; returns [{label, sci}] for toasts.
export function awardFirsts(game, flight, events) {
  const out = [];
  const mult = scienceMultiplier(flight.stack);
  for (const ev of events) {
    if (game.firsts.includes(ev)) continue;
    game.firsts.push(ev);
    const f = FIRST_SCIENCE[ev];
    if (f) {
      const sci = Math.round(f.sci * mult);
      game.science += sci;
      out.push({ label: f.label, sci });
    }
  }
  return out;
}

// ---------- missions ----------
// check(ctx) where ctx = { game, flight, events, alt, orbit, spd }
export const MISSIONS = [
  {
    id: 'pad', name: 'Off the Pad', funds: 4000, sci: 3,
    desc: 'Reach an altitude of 1 km. Baby steps.',
    check: c => c.flight && c.alt > 1000,
  },
  {
    id: 'sound', name: 'Breaking the Sound Barrier', funds: 5000, sci: 4,
    desc: 'Exceed 340 m/s while below 20 km.',
    check: c => c.flight && c.spd > 340 && c.alt < 20_000,
  },
  {
    id: 'space', name: 'Kiss of Space', funds: 12_000, sci: 8,
    desc: 'Leave the atmosphere: pass 70 km altitude.',
    check: c => c.flight && c.flight.bodyKey === 'gaia' && c.alt > 70_000,
  },
  {
    id: 'orbit', name: 'Stay Awhile', funds: 25_000, sci: 15,
    desc: 'Achieve a stable orbit of Gaia (periapsis above 70 km).',
    check: c => c.events.includes('orbit:gaia'),
  },
  {
    id: 'high', name: 'The High Ground', funds: 15_000, sci: 8,
    desc: 'Reach an altitude of 1,000 km above Gaia.',
    check: c => c.flight && c.flight.bodyKey === 'gaia' && c.alt > 1_000_000,
  },
  {
    id: 'recover', name: 'Bring It Home', funds: 10_000, sci: 5,
    desc: 'Land safely back on Gaia after reaching space.',
    check: c => c.events.includes('landed-back:gaia') && c.flight.maxAlt > 70_000,
  },
  {
    id: 'crumbsoi', name: 'Moon Shot', funds: 30_000, sci: 15,
    desc: 'Enter Crumb\'s sphere of influence.',
    check: c => c.events.includes('soi:crumb'),
  },
  {
    id: 'crumborbit', name: 'Crumb Orbiter', funds: 40_000, sci: 20,
    desc: 'Achieve orbit around Crumb.',
    check: c => c.events.includes('orbit:crumb'),
  },
  {
    id: 'crumbland', name: 'One Small Squish', funds: 80_000, sci: 40,
    desc: 'Land on Crumb in one piece.',
    check: c => c.events.includes('land:crumb'),
  },
  {
    id: 'crumbreturn', name: 'There and Back Again', funds: 100_000, sci: 50,
    desc: 'Visit Crumb\'s SOI, then land safely back on Gaia.',
    check: c => c.events.includes('landed-back:gaia') && c.flight.visited && c.flight.visited.includes('crumb'),
  },
  {
    id: 'escape', name: "Sun's Out", funds: 50_000, sci: 25,
    desc: 'Escape Gaia entirely and orbit Helios.',
    check: c => c.events.includes('soi:helios'),
  },
  {
    id: 'scorchsoi', name: 'Toasty', funds: 120_000, sci: 40,
    desc: 'Reach Scorch, the scorched inner world.',
    check: c => c.events.includes('soi:scorch'),
  },
  {
    id: 'rustysoi', name: 'Rust Never Sleeps', funds: 120_000, sci: 40,
    desc: 'Reach Rusty, the red outer world.',
    check: c => c.events.includes('soi:rusty'),
  },
  {
    id: 'rustyland', name: 'Red Rover', funds: 250_000, sci: 80,
    desc: 'Land on Rusty. Bonus points for style (not really).',
    check: c => c.events.includes('land:rusty'),
  },
  {
    id: 'tour', name: 'The Grand Tour', funds: 500_000, sci: 100,
    desc: 'Visit the SOI of every world: Crumb, Scorch, Rusty and Helios.',
    check: c => ['soi:crumb', 'soi:scorch', 'soi:rusty', 'soi:helios'].every(e => c.game.firsts.includes(e)),
  },
];

// Returns newly completed missions.
export function checkMissions(game, ctx) {
  const done = [];
  for (const m of MISSIONS) {
    if (game.missionsDone.includes(m.id)) continue;
    let ok = false;
    try { ok = m.check(ctx); } catch (e) { ok = false; }
    if (ok) {
      game.missionsDone.push(m.id);
      game.funds += m.funds;
      game.science += m.sci;
      done.push(m);
    }
  }
  return done;
}

export function activeMissions(game, n = 4) {
  return MISSIONS.filter(m => !game.missionsDone.includes(m.id)).slice(0, n);
}
