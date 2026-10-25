// terrain.js — deterministic procedural terrain for celestial bodies.
//
// Pure analytic geometry (no invention): the surface radius of a body is
// radius + h(θ), where h is a fixed sum-of-sines spectrum with per-body
// seeded phases. Being analytic, it is exact at every zoom level and every
// time — physics, rendering and the map all query the same function.

// Deterministic PRNG (mulberry32).
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Terrain spectra per body: amplitude (m) + octave count.
export const TERRAIN = {
  gaia:   { seed: 1337, amp: 1400, octaves: 7, cloudSeed: 42, cloudAmp: 1.0 },
  crumb:  { seed: 9001, amp: 900,  octaves: 6 },
  scorch: { seed: 777,  amp: 1800, octaves: 6 },
  rusty:  { seed: 4242, amp: 1200, octaves: 7, cloudSeed: 7, cloudAmp: 0.5 },
  helios: { seed: 5,    amp: 3000, octaves: 5 },
};

// Precompute harmonic tables: h(θ) = Σ A_i · sin(k_i·θ + φ_i), normalized so
// max|h| ≈ amp. Low harmonics = continents, high = ridges.
const TABLES = {};
for (const [key, T] of Object.entries(TERRAIN)) {
  const rand = rng(T.seed);
  const terms = [];
  let norm = 0;
  for (let o = 0; o < T.octaves; o++) {
    const k = 3 + o * 4 + Math.floor(rand() * 3); // harmonic number
    const phase = rand() * Math.PI * 2;
    const a = Math.pow(0.62, o);
    terms.push({ k, phase, a });
    norm += a;
  }
  TABLES[key] = { terms, scale: T.amp / norm };
}

// Terrain elevation above `body.radius` at surface angle θ (radians, CCW).
export function terrainHeight(bodyKey, theta) {
  const tb = TABLES[bodyKey];
  if (!tb) return 0;
  let h = 0;
  for (const t of tb.terms) h += t.a * Math.sin(t.k * theta + t.phase);
  return h * tb.scale;
}

// Same, flattened near the launch pad (north pole, θ = π/2) so the pad sits
// on level ground. Blend zone ±0.03 rad (~18 km on Gaia).
export function terrainAtLaunchSite(bodyKey, theta) {
  const h = terrainHeight(bodyKey, theta);
  let d = Math.abs(theta - Math.PI / 2);
  d = Math.min(d, Math.abs(d - 2 * Math.PI));
  const flat = Math.min(1, Math.max(0, (d - 0.008) / 0.03));
  return h * (flat * flat * (3 - 2 * flat)); // smoothstep
}

// Slope (dh/dθ) at θ — used to keep landed rockets upright on hills.
export function terrainSlope(bodyKey, theta) {
  const e = 0.0005;
  return (terrainHeight(bodyKey, theta + e) - terrainHeight(bodyKey, theta - e)) / (2 * e);
}

// ---------- clouds (visual only) ----------
// Deterministic cloud field: puffs placed on a band of altitudes/longitudes,
// drifting slowly. Returns {theta, alt, r, alpha} list for a body.
const CLOUDS = {};
export function cloudsFor(bodyKey) {
  if (CLOUDS[bodyKey]) return CLOUDS[bodyKey];
  const T = TERRAIN[bodyKey];
  if (!T || !T.cloudAmp) { CLOUDS[bodyKey] = []; return CLOUDS[bodyKey]; }
  const rand = rng(T.cloudSeed);
  const out = [];
  for (let i = 0; i < 90; i++) {
    out.push({
      theta: rand() * Math.PI * 2,
      alt: 4500 + rand() * 11000,               // meters above sea level
      r: 3500 + rand() * 9000,                  // puff radius (m)
      stretch: 1.6 + rand() * 1.6,              // elongated along surface
      drift: (rand() * 0.6 + 0.4) * 1e-5,       // rad/s wind
      alpha: 0.35 + rand() * 0.4,
      seed: Math.floor(rand() * 1e9),
    });
  }
  CLOUDS[bodyKey] = out;
  return out;
}
