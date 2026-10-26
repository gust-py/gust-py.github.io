// map.js — KSP-style map view: bodies, orbit lines, patched-conic trajectory
// prediction, Ap/Pe markers and maneuver nodes.
//
// Trajectory segments are computed analytically (Kepler propagation) with numeric
// event scanning for SOI entry/exit and surface impact. Segment points are stored
// RELATIVE to their body and drawn translated to the body's CURRENT position.

import { BODIES, childrenOf, bodyLocalPos, bodyWorldPos, ASTEROIDS, asteroidWorldPos } from './universe.js';
import { orbitFromState, stateAtTime, timeToRadius } from './orbits.js';

// ---------- trajectory prediction ----------
// Returns [{ bodyKey, orbit, tStart, tEnd, pts:[{x,y,t}], event }]
export function predictTrajectory(bodyKey, px, py, vx, vy, t0, maxSegs = 4) {
  const segs = [];
  let cur = { bodyKey, px, py, vx, vy, t: t0 };

  for (let si = 0; si < maxSegs; si++) {
    const body = BODIES[cur.bodyKey];
    const orbit = orbitFromState(body.mu, cur.px, cur.py, cur.vx, cur.vy, cur.t);
    const children = childrenOf(cur.bodyKey);

    // pick a scan horizon
    let tSpan;
    const canExit = body.soi !== Infinity && (orbit.e >= 1 || orbit.rAp > body.soi);
    if (canExit) {
      const tx = timeToRadius(orbit, body.soi, cur.t);
      tSpan = tx !== null ? tx + Math.max(60, tx * 0.03) : 3600 * 24 * 30;
    } else if (orbit.period) {
      tSpan = orbit.period * 1.002;
    } else {
      tSpan = 3600 * 24 * 30;
    }
    tSpan = Math.min(tSpan, 3600 * 24 * 3650);

    const N = 360;
    const dt = tSpan / N;
    const pts = [];
    let event = null;

    for (let i = 0; i <= N; i++) {
      const t = cur.t + i * dt;
      const s = stateAtTime(orbit, t);
      const r = Math.hypot(s.x, s.y);
      if (r <= body.radius) {
        event = { type: 'impact', t, state: s };
        pts.push({ x: s.x, y: s.y, t });
        break;
      }
      pts.push({ x: s.x, y: s.y, t });
      if (body.soi !== Infinity && r > body.soi && i > 1) {
        event = { type: 'exit', t, state: s };
        break;
      }
      let hit = null;
      for (const c of children) {
        const cp = bodyLocalPos(c, t);
        if (Math.hypot(s.x - cp.x, s.y - cp.y) < c.soi) { hit = c; break; }
      }
      if (hit && i > 0) {
        event = { type: 'enter', child: hit, t, state: s };
        break;
      }
    }

    segs.push({ bodyKey: cur.bodyKey, orbit, tStart: cur.t, tEnd: pts.length ? pts[pts.length - 1].t : cur.t, pts, event });

    if (!event || event.type === 'impact') break;
    const s = event.state;
    if (event.type === 'exit') {
      const bp = bodyLocalPos(body, event.t);
      const v = bodyVel(body, event.t);
      cur = {
        bodyKey: body.orbit.parent,
        px: s.x + bp.x, py: s.y + bp.y,
        vx: s.vx + v.x, vy: s.vy + v.y,
        t: event.t,
      };
    } else {
      const c = event.child;
      const cp = bodyLocalPos(c, event.t);
      const cv = bodyVel(c, event.t);
      cur = {
        bodyKey: c.key,
        px: s.x - cp.x, py: s.y - cp.y,
        vx: s.vx - cv.x, vy: s.vy - cv.y,
        t: event.t,
      };
    }
  }
  return segs;
}

function bodyVel(body, t) {
  const o = body.orbit;
  const ang = o.phase0 + o.n * t;
  const v = o.a * o.n;
  return { x: -v * Math.sin(ang), y: v * Math.cos(ang) };
}

// ---------- map state ----------
export const mapState = {
  open: false,
  zoom: 50_000,       // meters per pixel
  panX: 0, panY: 0,   // pan offset (world m) from focus
  free: false,
  node: null,         // { t, prograde, radial }
  traj: null,         // cached prediction segments
  nodeTraj: null,
  trajDirty: true,
};

export function invalidateTrajectory() { mapState.trajDirty = true; }

export function updateTrajectory(flight, t) {
  if (!mapState.trajDirty && mapState.traj) return;
  mapState.traj = predictTrajectory(
    flight.bodyKey, flight.pos.x, flight.pos.y, flight.vel.x, flight.vel.y, t);
  mapState.trajDirty = false;
  updateNodeTrajectory(flight, t);
}

// The maneuver node lives on one of the vessel's trajectory segments.
export function nodeSegment() {
  const n = mapState.node;
  if (!n || !mapState.traj) return null;
  for (const seg of mapState.traj) {
    if (n.t >= seg.tStart - 1 && (n.t <= seg.tEnd + 1 || !seg.event)) return seg;
  }
  return mapState.traj[0] || null;
}

export function nodeWorldInfo() {
  // Returns { bodyKey, px,py, vx,vy, dvx,dvy, dirWorld } for the node, or null.
  const n = mapState.node;
  const seg = nodeSegment();
  if (!n || !seg) return null;
  const s = stateAtTime(seg.orbit, n.t);
  const spd = Math.hypot(s.vx, s.vy) || 1;
  const pro = { x: s.vx / spd, y: s.vy / spd };
  const rr = Math.hypot(s.x, s.y) || 1;
  const rad = { x: s.x / rr, y: s.y / rr };
  const dvx = pro.x * n.prograde + rad.x * n.radial;
  const dvy = pro.y * n.prograde + rad.y * n.radial;
  return {
    bodyKey: seg.bodyKey, px: s.x, py: s.y, vx: s.vx, vy: s.vy,
    dvx, dvy,
    dirWorld: Math.atan2(dvy, dvx),
    dvTotal: Math.hypot(n.prograde, n.radial),
  };
}

export function updateNodeTrajectory(flight, t) {
  const info = nodeWorldInfo();
  if (!info) { mapState.nodeTraj = null; return; }
  mapState.nodeTraj = predictTrajectory(
    info.bodyKey, info.px, info.py, info.vx + info.dvx, info.vy + info.dvy, mapState.node.t, 3);
}

// ---------- rendering ----------
export function renderMap(ctx, W, H, flight, t) {
  ctx.fillStyle = '#05070d';
  ctx.fillRect(0, 0, W, H);

  const zoom = mapState.zoom;
  const body = BODIES[flight.bodyKey];
  const bw = bodyWorldPos(body, t);
  const focus = {
    x: bw.x + flight.pos.x + mapState.panX,
    y: bw.y + flight.pos.y + mapState.panY,
  };
  const toScreen = (wx, wy) => [W / 2 + (wx - focus.x) / zoom, H / 2 - (wy - focus.y) / zoom];

  // celestial orbits
  ctx.lineWidth = 1;
  for (const b of Object.values(BODIES)) {
    if (!b.orbit) continue;
    const parent = BODIES[b.orbit.parent];
    const pw = bodyWorldPos(parent, t);
    const [cx, cy] = toScreen(pw.x, pw.y);
    const rPx = b.orbit.a / zoom;
    if (rPx < 4 || rPx > 200000) continue;
    ctx.strokeStyle = 'rgba(140,160,200,0.25)';
    ctx.beginPath(); ctx.arc(cx, cy, rPx, 0, 7); ctx.stroke();
  }

  // bodies + SOI
  for (const b of Object.values(BODIES)) {
    const wp = bodyWorldPos(b, t);
    const [sx, sy] = toScreen(wp.x, wp.y);
    if (sx < -W || sx > 2 * W || sy < -H || sy > 2 * H) continue;
    if (b.soi !== Infinity) {
      const soiPx = b.soi / zoom;
      if (soiPx > 8 && soiPx < 5000) {
        ctx.strokeStyle = 'rgba(120,150,200,0.15)';
        ctx.setLineDash([4, 6]);
        ctx.beginPath(); ctx.arc(sx, sy, soiPx, 0, 7); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    const rPx = Math.max(b.radius / zoom, b.star ? 6 : 3);
    if (b.star) {
      const g = ctx.createRadialGradient(sx, sy, rPx * 0.5, sx, sy, rPx * 3);
      g.addColorStop(0, 'rgba(255,215,94,0.8)'); g.addColorStop(1, 'rgba(255,150,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(sx, sy, rPx * 3, 0, 7); ctx.fill();
    }
    ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.arc(sx, sy, rPx, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(210,225,255,0.75)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(b.name, sx + rPx + 5, sy + 3);
  }

  // cinturão de asteroides: faixa-guia + polígonos IRREGULARES girando
  // (sem portão de zoom: o culling por tela já elimina quando de perto)
  {
    const sun = bodyWorldPos(BODIES.helios, t);
    const [hx, hy] = toScreen(sun.x, sun.y);
    const rIn = (ASTEROIDS[0].a - 1.2e8) / zoom, rOut = (ASTEROIDS[ASTEROIDS.length - 1].a + 1.2e8) / zoom;
    if (rOut > 6 && rOut < 200000) {
      ctx.strokeStyle = 'rgba(160,160,180,0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(hx, hy, rIn, 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.arc(hx, hy, rOut, 0, 7); ctx.stroke();
    }
    for (const ast of ASTEROIDS) {
      const ap = asteroidWorldPos(ast, t);
      const [ax, ay] = toScreen(ap.x, ap.y);
      if (ax < -30 || ax > W + 30 || ay < -30 || ay > H + 30) continue;
      const rPx = Math.max(ast.size / zoom, 2.2);
      const rot = ast.spinPhase + ast.spin * t;
      const sh = ast.shape;
      ctx.fillStyle = '#8b8b93';
      ctx.strokeStyle = 'rgba(30,30,36,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < sh.length; i++) {
        const ang = rot + (i / sh.length) * Math.PI * 2;
        const rr = rPx * sh[i];
        const px2 = ax + Math.cos(ang) * rr, py2 = ay - Math.sin(ang) * rr;
        if (i === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  // vessel trajectory
  if (mapState.traj) {
    drawSegments(ctx, toScreen, mapState.traj, t, '#9fe870', 1.6);
    drawApsides(ctx, toScreen, mapState.traj, t, flight);
  }
  // node-predicted trajectory
  if (mapState.nodeTraj) {
    ctx.setLineDash([6, 5]);
    drawSegments(ctx, toScreen, mapState.nodeTraj, t, '#7fb4ff', 1.4);
    ctx.setLineDash([]);
  }
  // node marker
  const ni = nodeWorldInfo();
  if (ni) {
    const nb = bodyWorldPos(BODIES[ni.bodyKey], t);
    const [nx, ny] = toScreen(nb.x + ni.px, nb.y + ni.py);
    ctx.strokeStyle = '#7fb4ff'; ctx.fillStyle = 'rgba(127,180,255,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(nx, ny, 8, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#7fb4ff';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillText('◆ node', nx + 11, ny - 8);
  }

  // vessel marker
  const [vx, vy] = toScreen(bw.x + flight.pos.x, bw.y + flight.pos.y);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(vx, vy - 7); ctx.lineTo(vx + 5, vy + 5); ctx.lineTo(vx - 5, vy + 5);
  ctx.closePath(); ctx.stroke();
}

function drawSegments(ctx, toScreen, segs, t, color, width) {
  ctx.lineWidth = width;
  segs.forEach((seg, i) => {
    const b = BODIES[seg.bodyKey];
    const bw = bodyWorldPos(b, t);
    ctx.strokeStyle = i === 0 ? color : fade(color, 0.55);
    ctx.beginPath();
    seg.pts.forEach((p, j) => {
      const [sx, sy] = toScreen(bw.x + p.x, bw.y + p.y);
      if (j === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    });
    ctx.stroke();
    // SOI-change badge
    if (seg.event && seg.event.type === 'enter') {
      const p = seg.pts[seg.pts.length - 1];
      const [sx, sy] = toScreen(bw.x + p.x, bw.y + p.y);
      ctx.fillStyle = '#ffd75e';
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillText(`→ ${seg.event.child.name}`, sx + 6, sy - 4);
    }
  });
}

function fade(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function drawApsides(ctx, toScreen, segs, t, flight) {
  const seg = segs[0];
  if (!seg) return;
  const o = seg.orbit;
  const b = BODIES[seg.bodyKey];
  const bw = bodyWorldPos(b, t);
  ctx.font = '10px system-ui, sans-serif';
  const mark = (r, ang, label, color) => {
    let x = r * Math.cos(ang), y = r * Math.sin(ang);
    if (o.flipped) y = -y;
    const [sx, sy] = toScreen(bw.x + x, bw.y + y);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(sx, sy, 3.5, 0, 7); ctx.fill();
    ctx.fillText(label, sx + 6, sy + 3);
  };
  if (o.rPe > 0) mark(o.rPe, o.argPe, `Pe ${fmtAlt(o.rPe - b.radius)}`, '#7fd4ff');
  if (o.e < 1 && o.rAp < (b.soi === Infinity ? Infinity : b.soi * 1.2)) {
    mark(o.rAp, o.argPe + Math.PI, `Ap ${fmtAlt(o.rAp - b.radius)}`, '#f2b632');
  }
}

export function fmtAlt(m) {
  if (!isFinite(m)) return '—';
  const neg = m < 0; const a = Math.abs(m);
  let s;
  if (a >= 1e9) s = (a / 1e9).toFixed(2) + ' Gm';
  else if (a >= 1e6) s = (a / 1e6).toFixed(2) + ' Mm';
  else if (a >= 1000) s = (a / 1000).toFixed(1) + ' km';
  else s = a.toFixed(0) + ' m';
  return neg ? '-' + s : s;
}

// ---------- interaction ----------
// Click near the vessel's trajectory -> place/move the maneuver node there.
export function tryPlaceNode(mx, my, W, H, flight, t) {
  if (!mapState.traj) return false;
  const zoom = mapState.zoom;
  const body = BODIES[flight.bodyKey];
  const bw = bodyWorldPos(body, t);
  const focus = {
    x: bw.x + flight.pos.x + mapState.panX,
    y: bw.y + flight.pos.y + mapState.panY,
  };
  const toScreen = (wx, wy) => [W / 2 + (wx - focus.x) / zoom, H / 2 - (wy - focus.y) / zoom];

  let best = null, bestD = 14; // px threshold
  for (const seg of mapState.traj) {
    const b = BODIES[seg.bodyKey];
    const sbw = bodyWorldPos(b, t);
    for (const p of seg.pts) {
      const [sx, sy] = toScreen(sbw.x + p.x, sbw.y + p.y);
      const d = Math.hypot(sx - mx, sy - my);
      if (d < bestD) { bestD = d; best = p; }
    }
  }
  if (best) {
    if (!mapState.node) mapState.node = { t: best.t, prograde: 0, radial: 0 };
    else mapState.node.t = best.t;
    updateNodeTrajectory(flight, t);
    return true;
  }
  return false;
}

export function clearNode() {
  mapState.node = null;
  mapState.nodeTraj = null;
}
