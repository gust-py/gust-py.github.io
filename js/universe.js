// universe.js — celestial bodies (compressed KSP-style system) and their analytic positions.
// All units SI: meters, seconds, kg. mu = GM. Celestial orbits are circular for simplicity.

export const G0 = 9.81;

// Body definition:
//  name, color, radius (m), mu (m^3/s^2), soi (m, Infinity for the star),
//  atmoHeight (m, 0 = airless), scaleH (m), rho0 (kg/m^3 sea level),
//  orbit: { parent, a (m), phase0 (rad) }  — circular, CCW
export const BODIES = {
  helios: {
    name: 'Helios', color: '#ffd75e', glow: '#ff9d2e',
    radius: 65_400_000, mu: 1.1723e18, soi: Infinity,
    atmoHeight: 0, scaleH: 1, rho0: 0,
    orbit: null, star: true,
  },
  scorch: {
    name: 'Scorch', color: '#b8865a', glow: null,
    radius: 250_000, mu: 1.6861e11, soi: 9_646_663,
    atmoHeight: 0, scaleH: 1, rho0: 0,
    orbit: { parent: 'helios', a: 5_263_138_304, phase0: 3.14 },
  },
  gaia: {
    name: 'Gaia', color: '#4f8fd9', glow: '#86c5ff',
    radius: 600_000, mu: 3.5316e12, soi: 84_159_286,
    atmoHeight: 70_000, scaleH: 5_600, rho0: 1.225,
    orbit: { parent: 'helios', a: 13_599_840_256, phase0: 0 },
    home: true, land: '#4a7c3a', ocean: '#2d5f9e',
  },
  crumb: {
    name: 'Crumb', color: '#9a9a9a', glow: null,
    radius: 200_000, mu: 6.5138e10, soi: 2_429_559,
    atmoHeight: 0, scaleH: 1, rho0: 0,
    orbit: { parent: 'gaia', a: 12_000_000, phase0: 1.7 },
  },
  rusty: {
    name: 'Rusty', color: '#c96a3b', glow: null,
    radius: 320_000, mu: 3.0136e11, soi: 47_921_949,
    atmoHeight: 50_000, scaleH: 3_000, rho0: 0.2,
    orbit: { parent: 'helios', a: 20_726_155_264, phase0: 4.4 },
  },
};

// Precompute mean motion for each orbiting body.
for (const key of Object.keys(BODIES)) {
  const b = BODIES[key];
  b.key = key;
  if (b.orbit) {
    const parent = BODIES[b.orbit.parent];
    b.orbit.n = Math.sqrt(parent.mu / Math.pow(b.orbit.a, 3)); // rad/s
  }
}

export function childrenOf(key) {
  return Object.values(BODIES).filter(b => b.orbit && b.orbit.parent === key);
}

// Position of a body relative to its parent at universal time t.
export function bodyLocalPos(body, t) {
  const o = body.orbit;
  const ang = o.phase0 + o.n * t;
  return { x: o.a * Math.cos(ang), y: o.a * Math.sin(ang) };
}

// Velocity of a body relative to its parent at universal time t.
export function bodyLocalVel(body, t) {
  const o = body.orbit;
  const ang = o.phase0 + o.n * t;
  const v = o.a * o.n;
  return { x: -v * Math.sin(ang), y: v * Math.cos(ang) };
}

// Absolute (heliocentric) position / velocity of a body at time t.
export function bodyWorldPos(body, t) {
  let x = 0, y = 0;
  while (body.orbit) {
    const p = bodyLocalPos(body, t);
    x += p.x; y += p.y;
    body = BODIES[body.orbit.parent];
  }
  return { x, y };
}

export function bodyWorldVel(body, t) {
  let x = 0, y = 0;
  while (body.orbit) {
    const v = bodyLocalVel(body, t);
    x += v.x; y += v.y;
    body = BODIES[body.orbit.parent];
  }
  return { x, y };
}

// Atmospheric density at altitude h above sea level.
export function atmoDensity(body, h) {
  if (h < 0) h = 0;
  if (!body.atmoHeight || h >= body.atmoHeight) return 0;
  return body.rho0 * Math.exp(-h / body.scaleH);
}

export function surfaceGravity(body) {
  return body.mu / (body.radius * body.radius);
}
