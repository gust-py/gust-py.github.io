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
  rusty: {
    name: 'Rusty', color: '#c96a3b', glow: null,
    radius: 320_000, mu: 3.0136e11, soi: 47_921_949,
    atmoHeight: 50_000, scaleH: 3_000, rho0: 0.2,
    orbit: { parent: 'helios', a: 20_726_155_264, phase0: 4.4 },
  },
  zephyr: {
    name: 'Zephyr', color: '#a9cfe4', glow: '#d6ecf6',
    radius: 420_000, mu: 5.2e11, soi: 78_100_000,
    atmoHeight: 44_000, scaleH: 6_200, rho0: 0.38,
    orbit: { parent: 'helios', a: 27_200_000_000, phase0: 5.6 },
  },
  vesper: {
    name: 'Vesper', color: '#8a6fae', glow: '#b79ad6',
    radius: 380_000, mu: 4.4e11, soi: 90_300_000,
    atmoHeight: 0, scaleH: 1, rho0: 0,
    orbit: { parent: 'helios', a: 33_600_000_000, phase0: 2.2 },
  },
  // ---- luas (Scorch é o ÚNICO corpo sem lua) ----
  crumb: {
    name: 'Crumb', color: '#9a9a9a', glow: null,
    radius: 200_000, mu: 6.5138e10, soi: 2_429_559,
    atmoHeight: 0, scaleH: 1, rho0: 0,
    orbit: { parent: 'gaia', a: 12_000_000, phase0: 1.7 },
  },
  grit: {
    name: 'Grit', color: '#8f8578', glow: null,
    radius: 90_000, mu: 5.9e9, soi: 830_000,
    atmoHeight: 0, scaleH: 1, rho0: 0,
    orbit: { parent: 'rusty', a: 4_000_000, phase0: 0.9 },
  },
  puff: {
    name: 'Puff', color: '#dfe9ee', glow: null,
    radius: 70_000, mu: 2.8e9, soi: 445_000,
    atmoHeight: 0, scaleH: 1, rho0: 0,
    orbit: { parent: 'zephyr', a: 3_600_000, phase0: 2.7 },
  },
  mote: {
    name: 'Mote', color: '#6f5d85', glow: null,
    radius: 60_000, mu: 1.8e9, soi: 310_000,
    atmoHeight: 0, scaleH: 1, rho0: 0,
    orbit: { parent: 'vesper', a: 2_800_000, phase0: 4.5 },
  },
};

// ---------- cinturão de asteroides (visuais de mapa, sem física) ----------
// Entre Rusty e Zephyr. 12 corpos IRREGULARES (polígonos, NÃO bolas): cada um
// tem 'shape' = raios relativos por vértice, girando devagar. Determinístico.
export const ASTEROIDS = [
  { a: 23.2e9, phase0: 0.31, size: 24e3, spin: 0.052, spinPhase: 1.2,
    shape: [1.0, 0.72, 0.88, 1.18, 0.94, 0.66, 0.82, 1.12, 1.0, 0.78, 0.9, 1.08] },
  { a: 23.45e9, phase0: 1.42, size: 15e3, spin: -0.074, spinPhase: 3.8,
    shape: [0.8, 1.1, 0.92, 0.68, 1.05, 1.2, 0.85, 0.75, 1.0, 0.9] },
  { a: 23.7e9, phase0: 2.67, size: 31e3, spin: 0.033, spinPhase: 0.4,
    shape: [1.06, 0.9, 1.22, 0.84, 0.7, 0.98, 1.14, 0.76, 0.92, 1.18, 0.86, 1.0] },
  { a: 23.95e9, phase0: 3.9, size: 11e3, spin: 0.09, spinPhase: 5.1,
    shape: [1.15, 0.78, 0.95, 1.05, 0.7, 0.88, 1.1, 0.82] },
  { a: 24.2e9, phase0: 5.05, size: 27e3, spin: -0.041, spinPhase: 2.3,
    shape: [0.9, 1.08, 0.76, 1.16, 1.0, 0.82, 0.94, 1.2, 0.72, 1.0, 0.88, 1.1] },
  { a: 24.45e9, phase0: 0.12, size: 18e3, spin: 0.063, spinPhase: 4.4,
    shape: [1.0, 0.82, 1.14, 0.9, 0.7, 1.06, 0.96, 1.18, 0.8, 0.92] },
  { a: 24.7e9, phase0: 1.28, size: 33e3, spin: -0.028, spinPhase: 1.9,
    shape: [1.12, 0.94, 0.74, 1.05, 1.2, 0.86, 0.68, 0.98, 1.16, 0.8, 1.02, 0.9] },
  { a: 24.95e9, phase0: 2.53, size: 13e3, spin: 0.081, spinPhase: 3.3,
    shape: [0.85, 1.12, 0.95, 0.72, 1.08, 0.9, 1.16, 0.8] },
  { a: 25.2e9, phase0: 3.77, size: 21e3, spin: -0.058, spinPhase: 5.6,
    shape: [1.04, 0.8, 1.18, 0.9, 0.76, 1.08, 0.94, 1.14, 0.84, 1.0, 0.9, 1.1] },
  { a: 25.45e9, phase0: 4.99, size: 16e3, spin: 0.045, spinPhase: 0.8,
    shape: [0.92, 1.1, 0.78, 1.02, 1.18, 0.86, 0.94, 1.06, 0.72, 1.0] },
  { a: 25.7e9, phase0: 6.05, size: 29e3, spin: -0.036, spinPhase: 2.6,
    shape: [1.08, 0.88, 1.16, 0.72, 0.96, 1.22, 0.8, 1.0, 0.9, 1.12, 0.78, 0.94] },
  { a: 25.95e9, phase0: 1.83, size: 12e3, spin: 0.068, spinPhase: 4.1,
    shape: [1.1, 0.84, 0.98, 1.14, 0.76, 0.92, 1.06, 0.8] },
];
for (const ast of ASTEROIDS) {
  ast.n = Math.sqrt(BODIES.helios.mu / Math.pow(ast.a, 3));
}
export function asteroidWorldPos(ast, t) {
  const ang = ast.phase0 + ast.n * t;
  return { x: ast.a * Math.cos(ang), y: ast.a * Math.sin(ang) };
}

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
