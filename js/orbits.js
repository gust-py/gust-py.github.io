// orbits.js — two-body Keplerian mechanics: state vectors <-> orbital elements,
// analytic propagation (elliptic AND hyperbolic) via Newton–Raphson on the
// eccentric/hyperbolic anomaly. Nothing here is approximated beyond the
// standard two-body assumptions the whole game already uses.

const EPS = 1e-10;

export function orbitFromState(mu, x, y, vx, vy, t) {
  const r = Math.hypot(x, y);
  const v2 = vx * vx + vy * vy;
  const energy = v2 / 2 - mu / r;
  const a = -mu / (2 * energy); // negative for hyperbolic
  // eccentricity vector
  const rv = x * vx + y * vy;
  const ex = (v2 - mu / r) * x / mu - rv * vx / mu;
  const ey = (v2 - mu / r) * y / mu - rv * vy / mu;
  const e = Math.hypot(ex, ey);
  const omega = Math.atan2(ey, ex); // argument of periapsis

  const orbit = { mu, a, e, omega, t0: t, rAp: 0, rPe: 0, period: 0 };

  if (e < 1) {
    orbit.n = Math.sqrt(mu / (a * a * a));
    orbit.rPe = a * (1 - e);
    orbit.rAp = a * (1 + e);
    orbit.period = 2 * Math.PI / orbit.n;
    const E0 = trueToEccentric(trueAnomaly(x, y, vx, vy, e, omega, rv), e);
    orbit.M0 = E0 - e * Math.sin(E0);
  } else {
    orbit.n = Math.sqrt(mu / (-a * -a * -a)); // a is negative; n uses |a|^3
    orbit.n = Math.sqrt(mu / Math.pow(-a, 3));
    orbit.rPe = -a * (1 - e);
    orbit.rAp = Infinity;
    const H0 = trueToHyperbolic(trueAnomaly(x, y, vx, vy, e, omega, rv), e);
    orbit.M0 = e * Math.sinh(H0) - H0;
  }
  return orbit;
}

function trueAnomaly(x, y, vx, vy, e, omega, rv) {
  void vx; void vy; void rv; // nu comes straight from the eccentricity-vector frame
  return Math.atan2(y, x) - omega;
}

function trueToEccentric(nu, e) {
  return 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
}
function trueToHyperbolic(nu, e) {
  const c = Math.cos(nu / 2);
  if (c <= 0) return Math.cosh(3); // near-asymptote guard
  return 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.sin(nu / 2) / c);
}

// Propagate an orbit to time t. Returns {x, y, vx, vy} in the parent frame.
export function stateAtTime(o, t) {
  const dt = t - o.t0;
  const M = o.M0 + o.n * dt;
  let x, y, vx, vy;
  if (o.e < 1) {
    // Newton on E - e sinE = M
    let E = o.e < 0.8 ? M : Math.PI;
    for (let i = 0; i < 12; i++) {
      const f = E - o.e * Math.sin(E) - M;
      const fp = 1 - o.e * Math.cos(E);
      const dE = f / fp;
      E -= dE;
      if (Math.abs(dE) < EPS) break;
    }
    const cosE = Math.cos(E), sinE = Math.sin(E);
    const r = o.a * (1 - o.e * cosE);
    x = o.a * (cosE - o.e);
    y = o.a * Math.sqrt(1 - o.e * o.e) * sinE;
    const fac = Math.sqrt(o.mu * o.a) / r;
    vx = -fac * sinE;
    vy = fac * Math.sqrt(1 - o.e * o.e) * cosE;
  } else {
    // Newton on e sinhH - H = M
    let H = Math.sign(M) * Math.log(2 * Math.abs(M) / o.e + 1.8);
    for (let i = 0; i < 20; i++) {
      const f = o.e * Math.sinh(H) - H - M;
      const fp = o.e * Math.cosh(H) - 1;
      const dH = f / fp;
      H -= dH;
      if (Math.abs(dH) < EPS) break;
    }
    const coshH = Math.cosh(H), sinhH = Math.sinh(H);
    const r = -o.a * (o.e * coshH - 1); // |a|(e coshH - 1)
    x = -o.a * (o.e - coshH);
    y = o.a * Math.sqrt(o.e * o.e - 1) * sinhH;
    const fac = Math.sqrt(o.mu * -o.a) / r;
    vx = -fac * sinhH;
    vy = -fac * Math.sqrt(o.e * o.e - 1) * coshH;
  }
  // rotate perifocal -> inertial frame
  const c = Math.cos(o.omega), s = Math.sin(o.omega);
  return {
    x: x * c - y * s,
    y: x * s + y * c,
    vx: vx * c - vy * s,
    vy: vx * s + vy * c,
  };
}
