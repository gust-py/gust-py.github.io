// missions.js — contracts, science "firsts", and flight event detection.

import { BODIES } from './universe.js';
import { orbitFromState } from './orbits.js';

// ---------- mission board ----------
export const MISSIONS = [
  { id: 'm1', name: 'Break the Sound Barrier', desc: 'Pass 340 m/s in flight.', funds: 3000, sci: 2,
    test: c => c.spd > 340 },
  { id: 'm2', name: 'Kilometer High Club', desc: 'Reach 1 km altitude.', funds: 3000, sci: 2,
    test: c => c.alt > 1000 },
  { id: 'm3', name: 'Edge of Space', desc: 'Leave the atmosphere (70 km).', funds: 6000, sci: 5,
    test: c => c.alt > BODIES.gaia.atmoHeight },
  { id: 'm4', name: 'Orbit Achieved', desc: 'Reach a stable orbit of Gaia (Pe > 70 km).', funds: 12000, sci: 10,
    test: c => c.orbit && c.orbit.e < 1 && c.orbit.rPe > BODIES.gaia.radius + BODIES.gaia.atmoHeight && !c.flight.landed },
  { id: 'm5', name: 'Safe Return', desc: 'Land intact on Gaia after flying above 70 km.', funds: 8000, sci: 6,
    test: c => c.flight.landed && c.flight.bodyKey === 'gaia' && (c.flight.maxAlt || 0) > BODIES.gaia.atmoHeight && c.flight.hasFlown },
  { id: 'm6', name: 'Crumb Encounter', desc: 'Enter the sphere of influence of Crumb.', funds: 15000, sci: 12,
    test: c => c.flight.bodyKey === 'crumb' || c.flight.visited.includes('crumb') },
  { id: 'm7', name: 'Moonlighting', desc: 'Achieve orbit around Crumb.', funds: 20000, sci: 15,
    test: c => c.flight.bodyKey === 'crumb' && c.orbit && c.orbit.e < 1 && !c.flight.landed &&
      c.orbit.rPe > BODIES.crumb.radius + 2000 },
  { id: 'm8', name: 'One Small Step', desc: 'Land on Crumb and stay intact.', funds: 30000, sci: 25,
    test: c => c.flight.landed && c.flight.bodyKey === 'crumb' },
  { id: 'm9', name: 'Homecoming', desc: 'Return from Crumb and land safely on Gaia.', funds: 40000, sci: 30,
    test: c => c.flight.landed && c.flight.bodyKey === 'gaia' && c.flight.visited.includes('crumb') },
  { id: 'm10', name: 'Scorched', desc: 'Fly past Scorch (enter its SOI).', funds: 25000, sci: 18,
    test: c => c.flight.bodyKey === 'scorch' || c.flight.visited.includes('scorch') },
  { id: 'm11', name: 'Red Horizon', desc: 'Enter the SOI of Rusty.', funds: 35000, sci: 22,
    test: c => c.flight.bodyKey === 'rusty' || c.flight.visited.includes('rusty') },
  { id: 'm12', name: 'Rusty Tourist', desc: 'Achieve orbit around Rusty.', funds: 50000, sci: 30,
    test: c => c.flight.bodyKey === 'rusty' && c.orbit && c.orbit.e < 1 && !c.flight.landed &&
      c.orbit.rPe > BODIES.rusty.radius + BODIES.rusty.atmoHeight },
  { id: 'm13', name: 'Interplanetary Landing', desc: 'Land intact on any world other than Gaia.', funds: 60000, sci: 40,
    test: c => c.flight.landed && c.flight.bodyKey !== 'gaia' },
  { id: 'm14', name: 'Escape Velocity', desc: 'Leave the Helios system (escape its SOI).', funds: 80000, sci: 50,
    test: c => c.events.includes('helios_escape') },
  { id: 'm15', name: 'Grand Tour', desc: 'Visit Scorch, Crumb and Rusty in one career.', funds: 100000, sci: 60,
    test: c => c.game.firsts.includes('visited_scorch') && c.game.firsts.includes('visited_crumb') &&
      c.game.firsts.includes('visited_rusty') },
];

// ---------- science firsts ----------
const FIRSTS = [
  { ev: 'launch', label: 'First Launch', sci: 3, test: c => c.events.includes('launch') },
  { ev: 'alt_5000', label: '5 km Altitude', sci: 3, test: c => c.alt > 5000 },
  { ev: 'space', label: 'Reached Space', sci: 8, test: c => c.alt > BODIES.gaia.atmoHeight },
  { ev: 'orbit', label: 'First Orbit', sci: 12, test: c =>
    c.orbit && c.orbit.e < 1 && c.orbit.rPe > BODIES.gaia.radius + BODIES.gaia.atmoHeight && !c.flight.landed },
  { ev: 'supersonic', label: 'Supersonic Flight', sci: 2, test: c => c.spd > 340 },
  { ev: 'reentry', label: 'Atmospheric Reentry', sci: 5, test: c => c.events.includes('reentry') },
  { ev: 'visited_crumb', label: 'Crumb Flyby', sci: 15, test: c => c.flight.bodyKey === 'crumb' },
  { ev: 'visited_scorch', label: 'Scorch Flyby', sci: 15, test: c => c.flight.bodyKey === 'scorch' },
  { ev: 'visited_rusty', label: 'Rusty Flyby', sci: 18, test: c => c.flight.bodyKey === 'rusty' },
  { ev: 'landed_crumb', label: 'Landed on Crumb', sci: 25, test: c => c.flight.landed && c.flight.bodyKey === 'crumb' },
  { ev: 'landed_scorch', label: 'Landed on Scorch', sci: 30, test: c => c.flight.landed && c.flight.bodyKey === 'scorch' },
  { ev: 'landed_rusty', label: 'Landed on Rusty', sci: 35, test: c => c.flight.landed && c.flight.bodyKey === 'rusty' },
  { ev: 'helios_escape', label: 'Escaped Helios', sci: 50, test: c => c.events.includes('helios_escape') },
];

// ---------- event detection ----------
// events: transient facts about this instant, used by missions + firsts.
export function detectEvents(flight, t) {
  const body = BODIES[flight.bodyKey];
  const alt = Math.hypot(flight.pos.x, flight.pos.y) - body.radius;
  const spd = Math.hypot(flight.vel.x, flight.vel.y);
  const o = orbitFromState(body.mu, flight.pos.x, flight.pos.y, flight.vel.x, flight.vel.y, t);
  const events = [];

  if (game_justLaunched(flight)) events.push('launch');
  if (flight.qNow > 0 && alt < body.atmoHeight * 1.1 &&
      flight.prevAlt !== undefined && flight.prevAlt > body.atmoHeight * 1.1) events.push('reentry');
  if (body.key === 'helios' && Math.hypot(flight.pos.x, flight.pos.y) > body.soi) events.push('helios_escape');
  flight.prevAlt = alt;
  flight._lastOrbit = o;

  return { events, alt, spd, orbit: o };
}

function game_justLaunched(flight) {
  return !flight.launchSeen && (flight.thrustNow > 0 || !flight.landed) &&
    (flight.launchSeen = true);
}

// Returns the list of newly-earned firsts (and records them on game).
export function awardFirsts(game, flight, events, orbit) {
  const ctx = { events, flight, game, alt: flight.maxAlt || 0, spd: flight.maxSpd || 0,
    orbit: orbit || flight._lastOrbit || null };
  const out = [];
  for (const f of FIRSTS) {
    if (game.firsts.includes(f.ev)) continue;
    if (f.test(ctx)) {
      game.firsts.push(f.ev);
      out.push({ label: f.label, sci: f.sci });
    }
  }
  return out;
}

// Returns missions completed this instant (and records them on game).
export function checkMissions(game, ctx) {
  const done = [];
  for (const m of MISSIONS) {
    if (game.missionsDone.includes(m.id)) continue;
    if (m.test(ctx)) {
      game.missionsDone.push(m.id);
      game.funds += m.funds;
      game.science += m.sci;
      done.push(m);
    }
  }
  return done;
}

// Missions to show on the flight HUD.
export function activeMissions(game, n = 3) {
  return MISSIONS.filter(m => !game.missionsDone.includes(m.id)).slice(0, n);
}
