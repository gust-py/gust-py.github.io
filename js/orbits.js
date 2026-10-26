// orbits.js — 2D Keplerian orbit math: state <-> elements, propagation (elliptic + hyperbolic).
// Orbits are stored in the reference frame of their central body.
// Trick for 2D: if the orbit is clockwise (h < 0) we mirror the y-axis, work with a CCW
// orbit internally, and mirror back on output ("flipped" flag).

const TAU = Math.PI * 2;

export function orbitFromState(mu, px, py, vx, vy, t) {
  let flipped = false;
  let h = px * vy - py * vx;
  if (h < 0) { flipped = true; py = -py; vy = -vy; h = -h; }

  const r = Math.hypot(px, py);
  const v2 = vx * vx + vy * vy;
  const energy = v2 / 2 - mu / r;
  const a = -mu / (2 * energy); // < 0 for hyperbolic
  const rv = px * vx + py * vy;

  // Eccentricity vector
  let ex = ((v2 - mu / r) * px - rv * vx) / mu;
  let ey = ((v2 - mu / r) * py - rv * vy) / mu;
  let e = Math.hypot(ex, ey);
  let argPe;
  if (e < 1e-9) { e = 0; argPe = 0; ex = 1; ey = 0; }
  else argPe = Math.atan2(ey, ex);
  // bound orbit (a > 0) but e >= 1 by float error (near-radial): clamp to elliptic
  if (a > 0 && e >= 1) e = 0.9999999;

  // True anomaly (CCW from periapsis)
  let nu = Math.atan2(py, px) - argPe;
  nu = ((nu % TAU) + TAU) % TAU;

  let n, tPeri, period = null;
  if (e < 1) {
    // Elliptic
    const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
    const M = E - e * Math.sin(E);
    n = Math.sqrt(mu / (a * a * a));
    tPeri = t - (((M % TAU) + TAU) % TAU) / n;
    period = TAU / n;
  } else {
    // Hyperbolic
    let nuS = nu > Math.PI ? nu - TAU : nu; // signed
    const H = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nuS / 2));
    const M = e * Math.sinh(H) - H;
    n = Math.sqrt(mu / Math.pow(-a, 3));
    tPeri = t - M / n;
  }

  return {
    mu, a, e, argPe, n, tPeri, period, flipped,
    rPe: a * (1 - e),
    rAp: e < 1 ? a * (1 + e) : Infinity,
  };
}

function solveKeplerE(M, e) {
  M = ((M % TAU) + TAU) % TAU;
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 30; i++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    const d = f / fp;
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return E;
}

function solveKeplerH(M, e) {
  let H = Math.asinh(M / e);
  for (let i = 0; i < 40; i++) {
    const f = e * Math.sinh(H) - H - M;
    const fp = e * Math.cosh(H) - 1;
    const d = f / fp;
    H -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return H;
}

// State (pos + vel relative to central body) at universal time t.
export function stateAtTime(orbit, t) {
  const { mu, a, e, argPe, n, tPeri, flipped } = orbit;
  let xp, yp, vxp, vyp; // perifocal (CCW)

  if (e < 1) {
    const M = n * (t - tPeri);
    const E = solveKeplerE(M, e);
    const cosE = Math.cos(E), sinE = Math.sin(E);
    const r = a * (1 - e * cosE);
    const b = Math.sqrt(1 - e * e);
    xp = a * (cosE - e);
    yp = a * b * sinE;
    const k = Math.sqrt(mu * a) / r;
    vxp = -k * sinE;
    vyp = k * b * cosE;
  } else {
    const M = n * (t - tPeri);
    const H = solveKeplerH(M, e);
    const coshH = Math.cosh(H), sinhH = Math.sinh(H);
    const r = a * (1 - e * coshH); // a<0 => r>0
    const b = Math.sqrt(e * e - 1);
    xp = a * (coshH - e);
    yp = -a * b * sinhH;
    const hDot = -n * a / r; // dH/dt
    vxp = a * sinhH * hDot;
    vyp = -a * b * coshH * hDot;
  }

  // Rotate by argument of periapsis
  const c = Math.cos(argPe), s = Math.sin(argPe);
  let px = xp * c - yp * s;
  let py = xp * s + yp * c;
  let vx = vxp * c - vyp * s;
  let vy = vxp * s + vyp * c;

  if (flipped) { py = -py; vy = -vy; }
  return { x: px, y: py, vx, vy };
}

// Radius (distance from body center) at a given true anomaly.
export function radiusAtNu(orbit, nu) {
  const { a, e } = orbit;
  return a * (1 - e * e) / (1 + e * Math.cos(nu));
}

// Time until the orbit radius next exceeds rTarget (SOI exit), or null.
// Only meaningful when rAp > rTarget (elliptic) or always for hyperbolic outbound.
export function timeToRadius(orbit, rTarget, tNow) {
  const { a, e, n, tPeri } = orbit;
  if (e < 1) {
    if (orbit.rAp <= rTarget) return null;
    if (orbit.rPe >= rTarget) return 0;
    const cosE = (1 - rTarget / a) / e;
    if (cosE < -1 || cosE > 1) return null;
    const E = Math.acos(cosE); // outbound crossing, E in (0, pi)
    const M = E - e * Math.sin(E);
    let dt = (M / n) - ((n * (tNow - tPeri)) % TAU + TAU) % TAU / n;
    while (dt < 0) dt += orbit.period;
    return dt;
  } else {
    const coshH = (1 - rTarget / a) / e;
    if (coshH < 1) return 0;
    const H = Math.acosh(coshH); // outbound
    const M = e * Math.sinh(H) - H;
    const dt = (M / n) - (tNow - tPeri);
    return dt > 0 ? dt : null;
  }
}

// Angular position of periapsis marker etc. — sample the orbit path for drawing.
// Returns array of {x,y} points relative to the central body (current frame).
export function sampleOrbitPath(orbit, maxR, count = 180) {
  const pts = [];
  const { a, e, argPe, flipped } = orbit;
  let nuMax = Math.PI;
  if (e >= 1) {
    nuMax = Math.acos(-1 / e) - 1e-3; // asymptote limit
  } else if (orbit.rAp > maxR) {
    // clip ellipse to maxR
    const cosNu = (a * (1 - e * e) / maxR - 1) / e;
    if (cosNu > -1 && cosNu < 1) nuMax = Math.acos(cosNu);
  }
  for (let i = -count; i <= count; i++) {
    const nu = (i / count) * nuMax;
    const r = a * (1 - e * e) / (1 + e * Math.cos(nu));
    if (r < 0 || r > maxR * 1.05) continue;
    const ang = argPe + nu;
    let x = r * Math.cos(ang);
    let y = r * Math.sin(ang);
    if (flipped) y = -y;
    pts.push({ x, y });
  }
  return pts;
}
