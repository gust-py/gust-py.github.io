// map.js — map view: patched-conic trajectory prediction, maneuver nodes,
// and the heliocentric map renderer.
//
// Trajectory prediction integrates nothing numerically: it walks patch to
// patch with the analytic Kepler propagator, converting state vectors across
// sphere-of-influence boundaries exactly like the flight sim does.

import { BODIES, childrenOf, bodyLocalPos, bodyLocalVel, bodyWorldPos } from './universe.js';
import { orbitFromState, stateAtTime } from './orbits.js';
import { terrainAtLaunchSite } from './terrain.js';

export const mapState = {
  open: false,
  panX: 0, panY: 0,   // world offset (m) from the tracked body
  zoom: 20000,        // meters per pixel
  free: false,
  node: null,         // { prograde, radial, t }
};

// ---------- trajectory cache ----------
let traj = null;        // { segs: [{ bodyKey, pts: [{t,x,y}] }], node?: segs }
let trajDirty = true;
let trajTime = 0;

export function invalidateTrajectory() { trajDirty = true; }
export function clearNode() { mapState.node = null; trajDirty = true; }

function groundRadius(bodyKey, theta) {
  return BODIES[bodyKey].radius + terrainAtLaunchSite(bodyKey, theta);
}

// Walk up to maxPatches conic patches. Returns segments in local body frames.
export function predict(flight, t, withNode) {
  const segs = [];
  let bodyKey = flight.bodyKey;
  let pos = { ...flight.pos }, vel = { ...flight.vel };
  if (withNode && mapState.node) {
    // apply the node burn at the node time: jump ahead on rails first
    const n = mapState.node;
    const o0 = orbitFromState(BODIES[bodyKey].mu, pos.x, pos.y, vel.x, vel.y, t);
    if (n.t > t) {
      const s = stateAtTime(o0, n.t);
      pos = { x: s.x, y: s.y }; vel = { x: s.vx, y: s.vy };
      t = n.t;
    }
    // prograde/radial unit vectors at the node
    const pv = nodeDirections(BODIES[bodyKey].mu, pos, vel);
    vel.x += pv.pro.x * n.prograde + pv.rad.x * n.radial;
    vel.y += pv.pro.y * n.prograde + pv.rad.y * n.radial;
  }
  let t0 = t;
  const MAX_PATCHES = 4;

  for (let patch = 0; patch < MAX_PATCHES; patch++) {
    const body = BODIES[bodyKey];
    const orbit = orbitFromState(body.mu, pos.x, pos.y, vel.x, vel.y, t0);
    const pts = [];
    let hit = null; // { kind: 'exit'|'enter'|'ground'|'end', t, ... }

    const inAtmo = body.atmoHeight > 0;
    const willReenter = orbit.rPe < body.radius + (inAtmo ? body.atmoHeight * 0.5 : 0);
    const staysIn = orbit.e < 1 && (body.soi === Infinity || orbit.rAp < body.soi * 0.999);

    let dt, steps;
    if (staysIn) {
      steps = 360;
      dt = orbit.period / steps;
    } else {
      steps = 600;
      const v = Math.hypot(vel.x, vel.y);
      const rNow = Math.hypot(pos.x, pos.y);
      dt = Math.max(1, (rNow / Math.max(v, 50)) / 20);
    }

    let ct = t0, cp = { ...pos }, cv = { ...vel };
    pts.push({ t: ct, x: cp.x, y: cp.y });
    for (let i = 0; i < steps; i++) {
      if (!staysIn) {
        // adaptive step: coarse far away, fine near the body
        const rr = Math.hypot(cp.x, cp.y);
        const vv = Math.max(50, Math.hypot(cv.x, cv.y));
        dt = Math.max(2, rr / (vv * 12));
      }
      ct += dt;
      const s = stateAtTime(orbit, ct);
      cp = { x: s.x, y: s.y }; cv = { x: s.vx, y: s.vy };
      const r = Math.hypot(cp.x, cp.y);

      // child SOI entry?
      let entered = null;
      for (const child of childrenOf(bodyKey)) {
        const cpos = bodyLocalPos(child, ct);
        const d = Math.hypot(cp.x - cpos.x, cp.y - cpos.y);
        if (d < child.soi) { entered = { child, cpos }; break; }
      }
      if (entered) {
        pts.push({ t: ct, x: cp.x, y: cp.y });
        segs.push({ bodyKey, pts, encounter: entered.child.name });
        const cvel = bodyLocalVel(entered.child, ct);
        bodyKey = entered.child.key;
        pos = { x: cp.x - entered.cpos.x, y: cp.y - entered.cpos.y };
        vel = { x: cv.x - cvel.x, y: cv.y - cvel.y };
        t0 = ct;
        hit = { kind: 'enter' };
        break;
      }
      // SOI exit?
      if (body.soi !== Infinity && r > body.soi) {
        pts.push({ t: ct, x: cp.x, y: cp.y });
        segs.push({ bodyKey, pts });
        const bp = bodyLocalPos(body, ct), bv = bodyLocalVel(body, ct);
        bodyKey = body.orbit.parent;
        pos = { x: cp.x + bp.x, y: cp.y + bp.y };
        vel = { x: cv.x + bv.x, y: cv.y + bv.y };
        t0 = ct;
        hit = { kind: 'exit' };
        break;
      }
      // ground/atmosphere impact?
      if (r <= groundRadius(bodyKey, Math.atan2(cp.y, cp.x)) ||
          (inAtmo && willReenter && ct > t0 + (orbit.period || 1e9) * 0.02 && r < body.radius + body.atmoHeight)) {
        pts.push({ t: ct, x: cp.x, y: cp.y });
        segs.push({ bodyKey, pts, impact: true });
        hit = { kind: 'ground' };
        break;
      }
      pts.push({ t: ct, x: cp.x, y: cp.y });
      if (i === steps - 1) { segs.push({ bodyKey, pts }); hit = { kind: 'end' }; }
    }
    if (!hit || hit.kind === 'ground' || hit.kind === 'end') break;
  }
  return segs;
}

// Prograde / radial unit vectors for a state in the parent frame.
function nodeDirections(mu, pos, vel) {
  const r = Math.hypot(pos.x, pos.y) || 1;
  const rad = { x: pos.x / r, y: pos.y / r };
  const spd = Math.hypot(vel.x, vel.y) || 1;
  const pro = { x: vel.x / spd, y: vel.y / spd };
  // make radial the outward +h component: rad' = pro x h ... keep simple: radial = component of rad orthogonal to pro
  const dot = rad.x * pro.x + rad.y * pro.y;
  const rx = rad.x - dot * pro.x, ry = rad.y - dot * pro.y;
  const rl = Math.hypot(rx, ry) || 1;
  return { pro, rad: { x: rx / rl, y: ry / rl } };
}

export function updateTrajectory(flight, t) {
  if (!trajDirty && trajTime === t) return;
  trajTime = t;
  trajDirty = false;
  traj = { segs: predict(flight, t, false) };
}

export function updateNodeTrajectory(flight, t) {
  traj = traj || { segs: [] };
  traj.node = predict(flight, t, true);
}

export function nodeWorldInfo() {
  const n = mapState.node;
  if (!n || !traj) return null;
  // directions at node time from the pre-burn trajectory
  let best = null;
  for (const seg of traj.segs) {
    for (const p of seg.pts) {
      if (!best || Math.abs(p.t - n.t) < Math.abs(best.p.t - n.t)) best = { seg, p };
    }
  }
  if (!best) return null;
  const body = BODIES[best.seg.bodyKey];
  const o = orbitFromState(body.mu, best.p.x, best.p.y, 0, 0, best.p.t); // position-only
  void o;
  // recompute velocity at that time on the same patch: cheap approach — finite diff
  const pv = nodeVelAt(traj.segs, n.t);
  if (!pv) return null;
  const dir = nodeDirections(body.mu, pv.pos, pv.vel);
  const dvTotal = Math.hypot(n.prograde, n.radial);
  return { bodyKey: best.seg.bodyKey, dirWorld: Math.atan2(
    dir.pro.y * n.prograde + dir.rad.y * n.radial,
    dir.pro.x * n.prograde + dir.rad.x * n.radial), dvTotal: dvTotal || Math.abs(n.prograde) + Math.abs(n.radial) };
}

function nodeVelAt(segs, t) {
  for (const seg of segs) {
    const pts = seg.pts;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i - 1].t <= t && pts[i].t >= t) {
        const body = BODIES[seg.bodyKey];
        const o = orbitFromState(body.mu, pts[i - 1].x, pts[i - 1].y, 0, 0, pts[i - 1].t);
        void o;
        // velocity via finite difference of position along the patch
        const h = Math.max(0.5, (pts[i].t - pts[i - 1].t) / 50);
        const s1 = patchStateAt(segs, seg.bodyKey, t - h);
        const s2 = patchStateAt(segs, seg.bodyKey, t + h);
        if (!s1 || !s2) return null;
        return {
          pos: { x: (s1.x + s2.x) / 2, y: (s1.y + s2.y) / 2 },
          vel: { x: (s2.x - s1.x) / (2 * h), y: (s2.y - s1.y) / (2 * h) },
        };
      }
    }
  }
  return null;
}

// Evaluate position at time t along a patch by regenerating its orbit.
function patchStateAt(segs, bodyKey, t) {
  for (const seg of segs) {
    if (seg.bodyKey !== bodyKey || seg.pts.length < 2) continue;
    const a = seg.pts[0], b = seg.pts[seg.pts.length - 1];
    if (t < a.t || t > b.t) continue;
    // reconstruct orbit at segment start (velocity unknown; use finite diff on stored pts)
    for (let i = 1; i < seg.pts.length; i++) {
      if (seg.pts[i].t >= t) {
        const p0 = seg.pts[i - 1], p1 = seg.pts[i];
        const f = (t - p0.t) / Math.max(1e-9, p1.t - p0.t);
        return { x: p0.x + (p1.x - p0.x) * f, y: p0.y + (p1.y - p0.y) * f };
      }
    }
  }
  return null;
}

// Click → place node at the closest trajectory point (screen space).
export function tryPlaceNode(mx, my, W, H, flight, t) {
  if (!traj) return false;
  updateTrajectory(flight, t);
  const world0 = screenToWorld(mx, my, W, H, flight, t);
  let best = null;
  for (const seg of traj.segs) {
    for (const p of seg.pts) {
      const wp = toWorld(seg.bodyKey, p, t);
      const d = Math.hypot(wp.x - world0.x, wp.y - world0.y);
      const tol = mapState.zoom * 14;
      if (d < tol && (!best || d < best.d)) best = { d, seg, p };
    }
  }
  if (!best) return false;
  mapState.node = { prograde: 0, radial: 0, t: best.p.t };
  updateNodeTrajectory(flight, t);
  return true;
}

function toWorld(bodyKey, p, nowT) {
  const bw = bodyWorldPos(BODIES[bodyKey], p.t);
  return { x: bw.x + p.x, y: bw.y + p.y };
}

function screenToWorld(mx, my, W, H, flight, t) {
  const anchor = mapAnchor(flight, t);
  return {
    x: anchor.x + (mx - W / 2) * mapState.zoom + mapState.panX,
    y: anchor.y - (my - H / 2) * mapState.zoom + mapState.panY,
  };
}

function mapAnchor(flight, t) {
  if (!mapState.free || mapState.panX === 0 && mapState.panY === 0) {
    const bw = bodyWorldPos(BODIES[flight.bodyKey], t);
    if (!mapState.free) { mapState.panX = 0; mapState.panY = 0; }
    return bw;
  }
  const bw = bodyWorldPos(BODIES[flight.bodyKey], t);
  return { x: bw.x + mapState.panX, y: bw.y + mapState.panY };
}

// ---------- rendering ----------
export function renderMap(ctx, W, H, flight, t) {
  const track = BODIES[flight.bodyKey];
  const bw0 = bodyWorldPos(track, t);

  // auto zoom to fit the tracked body + its SOI on first open
  if (!mapState.zoomInit) {
    mapState.zoomInit = true;
    mapState.zoom = Math.max(track.soi !== Infinity ? track.soi * 2.4 / Math.min(W, H) : 5e7 / Math.min(W, H), track.radius * 3 / 40);
  }

  const toScreen = (wx, wy) => [
    W / 2 + (wx - bw0.x - mapState.panX) / mapState.zoom,
    H / 2 - (wy - bw0.y + mapState.panY) / mapState.zoom,
  ];

  ctx.fillStyle = '#05070d';
  ctx.fillRect(0, 0, W, H);
  // faint grid (one line every gpx meters, snapped to a power of ten)
  const gpx = Math.pow(10, Math.floor(Math.log10(mapState.zoom * 80)));
  const gstep = gpx / mapState.zoom;
  const gx0 = ((-bw0.x - mapState.panX) / mapState.zoom) % gstep;
  ctx.strokeStyle = 'rgba(120,150,210,0.06)';
  ctx.lineWidth = 1;
  for (let gx = gx0; gx < W; gx += gstep) {
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
  }
  for (let gy = ((bw0.y + mapState.panY) / mapState.zoom) % gstep; gy < H; gy += gstep) {
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
  }

  // orbits of all bodies around their parents
  for (const b of Object.values(BODIES)) {
    if (!b.orbit) continue;
    const parent = BODIES[b.orbit.parent];
    const wPos = bodyWorldPos(parent, t);
    const sx = W / 2 + (wPos.x - bw0.x - mapState.panX) / mapState.zoom;
    const sy = H / 2 - (wPos.y - bw0.y + mapState.panY) / mapState.zoom;
    const rPx = b.orbit.a / mapState.zoom;
    if (rPx < 6 || rPx > 40000) continue;
    ctx.strokeStyle = 'rgba(150,170,220,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(sx, sy, rPx, 0, 7);
    ctx.stroke();
  }

  // bodies
  for (const b of Object.values(BODIES)) {
    const bw = bodyWorldPos(b, t);
    const [sx, sy] = toScreen(bw.x, bw.y);
    const rPx = Math.max(2.5, b.radius / mapState.zoom);
    if (sx < -rPx - 20 || sx > W + rPx + 20 || sy < -rPx - 20 || sy > H + rPx + 20) continue;
    // SOI ring
    if (b.soi !== Infinity && b.soi / mapState.zoom > 8 && b.soi !== Infinity) {
      ctx.strokeStyle = 'rgba(150,170,220,0.12)';
      ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.arc(sx, sy, b.soi / mapState.zoom, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (b.star) {
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rPx * 3);
      g.addColorStop(0, '#fff6d8'); g.addColorStop(0.3, '#ffd75e'); g.addColorStop(1, 'rgba(255,150,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(sx, sy, rPx * 3, 0, 7); ctx.fill();
    } else {
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(sx, sy, rPx, 0, 7); ctx.fill();
      if (b.atmoHeight && rPx > 3) {
        ctx.strokeStyle = 'rgba(120,180,255,0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(sx, sy, rPx + b.atmoHeight / mapState.zoom, 0, 7); ctx.stroke();
      }
    }
    // label
    ctx.fillStyle = 'rgba(210,220,240,0.75)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(b.name, sx, sy - rPx - 6);
    ctx.textAlign = 'left';
  }

  // vessel marker
  {
    const vbw = bodyWorldPos(BODIES[flight.bodyKey], t);
    const [sx, sy] = toScreen(vbw.x + flight.pos.x, vbw.y + flight.pos.y);
    ctx.fillStyle = '#9fe870';
    ctx.beginPath(); ctx.arc(sx, sy, 4, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(159,232,112,0.4)';
    ctx.beginPath(); ctx.arc(sx, sy, 8, 0, 7); ctx.stroke();
  }

  // trajectory
  if (traj) drawSegs(ctx, toScreen, traj.segs, t, false);
  if (traj && traj.node) drawSegs(ctx, toScreen, traj.node, t, true);

  // node marker
  if (mapState.node) {
    const ni = nodeWorldInfo();
    if (ni) {
      const seg = findSegAt(traj.segs, mapState.node.t);
      if (seg) {
        const p = seg.pts.reduce((a, p) => Math.abs(p.t - mapState.node.t) < Math.abs(a.t - mapState.node.t) ? p : a, seg.pts[0]);
        const wp = toWorld(seg.bodyKey, p, t);
        const [sx, sy] = toScreen(wp.x, wp.y);
        ctx.fillStyle = '#7fb4ff';
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-4, -4, 8, 8);
        ctx.restore();
      }
    }
  }
}

function findSegAt(segs, t) {
  for (const s of segs) {
    if (s.pts.length && t >= s.pts[0].t && t <= s.pts[s.pts.length - 1].t) return s;
  }
  return segs[0];
}

function drawSegs(ctx, toScreen, segs, nowT, dashed) {
  for (const seg of segs) {
    ctx.strokeStyle = seg.impact ? 'rgba(240,104,90,0.85)'
      : seg.encounter ? 'rgba(159,232,112,0.9)'
      : dashed ? 'rgba(127,180,255,0.8)' : 'rgba(127,212,255,0.75)';
    ctx.lineWidth = 1.6;
    if (dashed) ctx.setLineDash([6, 5]);
    ctx.beginPath();
    let started = false;
    for (const p of seg.pts) {
      const wp = toWorld(seg.bodyKey, p, nowT);
      const [sx, sy] = toScreen(wp.x, wp.y);
      if (!started) { ctx.moveTo(sx, sy); started = true; } else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// ---------- formatting ----------
export function fmtAlt(m) {
  const a = Math.abs(m);
  if (!isFinite(m)) return '—';
  if (a >= 1e9) return (m / 1e9).toFixed(2) + ' Mm';
  if (a >= 1e6) return (m / 1e6).toFixed(2) + ' Mm';
  if (a >= 10_000) return (m / 1000).toFixed(1) + ' km';
  return m.toFixed(0) + ' m';
}
