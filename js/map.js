// map.js — KSP-style map view: bodies with PROCEDURAL TERRAIN (relief, biomes,
// water, sand, rock, ice, clouds), orbit lines, patched-conic trajectory
// prediction, Ap/Pe markers and maneuver nodes.
//
// Trajectory segments are computed analytically (Kepler propagation) with numeric
// event scanning for SOI entry/exit and surface impact. Segment points are stored
// RELATIVE to their body and drawn translated to the body's CURRENT position.
//
// RENDERING v2:
//  - Each body gets a cached procedural texture (fBm + ridged noise) with real
//    height field, biome coloring and hill-shaded relief.
//  - A separate cloud layer (alpha fBm) rotates slowly with time.
//  - Gas giants get latitudinal bands; stars get turbulent granulation.
//  - Atmosphere glow drawn inside the disc near the limb.

import { BODIES, childrenOf, bodyLocalPos, bodyWorldPos } from './universe.js';
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

// ======================================================================
// PROCEDURAL TERRAIN
// ======================================================================

// Deterministic PRNG (mulberry32) seeded per body name -> stable terrain.
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Value noise with smootherstep interpolation.
function makeNoise(seed) {
  const rng = mulberry32(seed);
  const perm = new Uint8Array(512);
  const grad = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; grad[i] = rng() * 2 - 1; }
  for (let i = 255; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  function noise2(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const aa = grad[perm[perm[X] + Y]], ab = grad[perm[perm[X] + Y + 1]];
    const ba = grad[perm[perm[X + 1] + Y]], bb = grad[perm[perm[X + 1] + Y + 1]];
    const x1 = aa + u * (ba - aa), x2 = ab + u * (bb - ab);
    return x1 + v * (x2 - x1); // ~[-1,1]
  }
  return noise2;
}

// Fractal Brownian motion.
function fbm(noise, x, y, octaves, lac = 2, gain = 0.5) {
  let a = 0, amp = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) { a += amp * noise(x * f, y * f); amp *= gain; f *= lac; }
  return a; // ~[-1,1]
}

// Ridged multifractal — sharp mountain crests.
function ridged(noise, x, y, octaves) {
  let a = 0, amp = 0.5, f = 1, w = 1;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise(x * f, y * f));
    n *= n * w; w = Math.min(1, n * 2);
    a += n * amp; amp *= 0.5; f *= 2.1;
  }
  return a; // [0,1]
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function mixRGB(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}
function hexRGB(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Biome palette per body kind. base = body.color as tint for landmasses.
function biomePalette(body) {
  const base = hexRGB(body.color || '#8a9a6a');
  const darken = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
  if (body.star) {
    return { kind: 'star', hot: [255, 250, 220], mid: [255, 200, 90], dark: [230, 120, 30] };
  }
  if (body.gas) {
    return {
      kind: 'gas',
      band1: darken(base, 1.15), band2: darken(base, 0.72),
      storm: darken(base, 1.35),
    };
  }
  const kind = body.ice ? 'ice' : body.lava ? 'lava' : body.ocean === false ? 'dry' : 'terra';
  return {
    kind,
    deep: kind === 'lava' ? [120, 20, 5] : kind === 'ice' ? [10, 40, 80] : [12, 28, 62],
    shallow: kind === 'lava' ? [220, 90, 20] : kind === 'ice' ? [40, 90, 140] : [30, 90, 140],
    water: kind === 'lava' ? [255, 140, 40] : kind === 'ice' ? [70, 130, 180] : [38, 118, 158],
    sand: kind === 'ice' ? [190, 205, 220] : [206, 186, 130],
    land: kind === 'ice' ? [170, 195, 215] : base,
    land2: kind === 'ice' ? [225, 238, 248] : darken(base, 0.72),
    rock: kind === 'ice' ? [140, 160, 180] : [110, 100, 90],
    snow: kind === 'lava' ? [70, 60, 55] : [235, 240, 245],
    lavaGlow: [255, 120, 30],
  };
}

// Texture cache: bodyKey -> { terrain: canvas, clouds: canvas|null, size }
const TEX_SIZE = 384;
const texCache = new Map();

function getBodyTextures(body) {
  let c = texCache.get(body.key || body.name);
  if (c) return c;

  const S = TEX_SIZE, R = S / 2;
  const seed = hashStr(body.name || body.key || 'body');
  const noise = makeNoise(seed);
  const noise2 = makeNoise(seed ^ 0x9e3779b9);
  const pal = biomePalette(body);
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  const data = img.data;

  // height field stored for shading pass
  const height = new Float32Array(S * S);

  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const dx = (px - R) / R, dy = (py - R) / R;
      const d = Math.hypot(dx, dy);
      const idx = (py * S + px) * 4;
      if (d > 1.0) { data[idx + 3] = 0; continue; }
      const inside = clamp((1 - d) * R, 0, R); // px from limb toward center
      // sample noise on the disc plane (spatially coherent across the disc)
      const nx = px / S * 6, ny = py / S * 6;
      let color;

      if (pal.kind === 'star') {
        // turbulent granulation
        const g = fbm(noise, nx * 3, ny * 3, 5) * 0.5 + 0.5;
        const cells = ridged(noise2, nx * 6, ny * 6, 3);
        const m = clamp(g * 0.7 + cells * 0.5, 0, 1);
        color = m < 0.45 ? mixRGB(pal.dark, pal.mid, m / 0.45)
              : mixRGB(pal.mid, pal.hot, (m - 0.45) / 0.55);
        height[py * S + px] = m;
      } else if (pal.kind === 'gas') {
        // latitudinal bands distorted by turbulence
        const band = Math.sin((py / S) * Math.PI * 14 + fbm(noise, nx, ny, 4) * 2.4);
        const t = band * 0.5 + 0.5;
        color = mixRGB(pal.band1, pal.band2, t);
        // occasional storm ovals
        const storm = fbm(noise2, nx * 1.6, ny * 1.6, 3);
        if (storm > 0.42) color = mixRGB(color, pal.storm, clamp((storm - 0.42) * 3, 0, 0.8));
        height[py * S + px] = 0.5;
      } else {
        // ---- terrestrial: real height field ----
        const cont = fbm(noise, nx, ny, 6) * 0.5 + 0.5;              // continents
        const mount = ridged(noise2, nx * 1.4, ny * 1.4, 5);          // crests
        const hills = fbm(noise2, nx * 3, ny * 3, 4) * 0.5 + 0.5;
        // mountains only on land
        const landMask = clamp((cont - 0.48) * 6, 0, 1);
        const h = cont * 0.72 + mount * landMask * 0.45 + hills * 0.12;
        height[py * S + px] = h;

        // polar caps: stronger toward top/bottom of the disc, softened by noise
        const lat = Math.abs(dy);
        const cap = lat > 0.62 + fbm(noise, nx * 2, ny * 2, 3) * 0.14 ? 1 : 0;

        const seaLevel = pal.kind === 'dry' ? -1 : pal.kind === 'ice' ? 0.34 : 0.44;
        if (h < seaLevel) {
          const depth = clamp((seaLevel - h) / 0.25, 0, 1);
          color = mixRGB(pal.shallow, pal.deep, depth);
        } else {
          const e = clamp((h - seaLevel) / (1 - seaLevel), 0, 1);
          if (e < 0.06) color = pal.sand;                             // beaches
          else if (e < 0.35) color = mixRGB(pal.sand, pal.land, (e - 0.06) / 0.29);
          else if (e < 0.62) color = mixRGB(pal.land, pal.land2, (e - 0.35) / 0.27);
          else if (e < 0.82) color = mixRGB(pal.land2, pal.rock, (e - 0.62) / 0.2);
          else color = mixRGB(pal.rock, pal.snow, (e - 0.82) / 0.18);
          if (cap) color = mixRGB(color, pal.snow, 0.9);
          if (pal.kind === 'lava' && h > 0.8) {
            // glowing fissures on lava worlds
            const fis = ridged(noise, nx * 5, ny * 5, 3);
            if (fis > 0.62) color = mixRGB(color, pal.lavaGlow, (fis - 0.62) * 2);
          }
        }
      }

      // limb darkening: sphere-like falloff toward the edge
      const shade = clamp(1 - d * d * 0.55, 0, 1);
      color = [color[0] * shade, color[1] * shade, color[2] * shade];

      data[idx] = clamp(color[0], 0, 255);
      data[idx + 1] = clamp(color[1], 0, 255);
      data[idx + 2] = clamp(color[2], 0, 255);
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // ---- hill-shading pass: pseudo-normals from the height field, light from NW ----
  const img2 = ctx.getImageData(0, 0, S, S);
  const d2 = img2.data;
  const H = (x, y) => height[clamp(y, 0, S - 1) * S + clamp(x, 0, S - 1)];
  const Lx = -0.6, Ly = -0.7, Lz = 0.4; // light direction (from upper-left, toward viewer)
  for (let py = 1; py < S - 1; py++) {
    for (let px = 1; px < S - 1; px++) {
      const idx = (py * S + px) * 4;
      if (d2[idx + 3] === 0) continue;
      const strength = pal.kind === 'gas' ? 0 : pal.kind === 'star' ? 0 : 1;
      if (!strength) continue;
      const dzx = (H(px + 1, py) - H(px - 1, py)) * 14;
      const dzy = (H(px, py + 1) - H(px, py - 1)) * 14;
      // surface normal of the height field
      const nl = Math.hypot(dzx, dzy, 1);
      const dot = clamp((-dzx * Lx + -dzy * Ly + Lz) / nl, 0, 1);
      const f = 0.62 + 0.75 * dot; // 0.62 shadow .. 1.37 highlight
      d2[idx] = clamp(d2[idx] * f, 0, 255);
      d2[idx + 1] = clamp(d2[idx + 1] * f, 0, 255);
      d2[idx + 2] = clamp(d2[idx + 2] * f, 0, 255);
    }
  }
  ctx.putImageData(img2, 0, 0);

  // ---- cloud layer (separate, transparent) ----
  let clouds = null;
  const hasClouds = !body.star && !body.gas &&
    (body.clouds !== false) && (pal.kind === 'terra' || pal.kind === 'ice' || pal.kind === 'lava');
  if (hasClouds) {
    clouds = document.createElement('canvas');
    clouds.width = S; clouds.height = S;
    const cc = clouds.getContext('2d');
    const ci = cc.createImageData(S, S);
    const cd = ci.data;
    const swirl = makeNoise(seed ^ 0x51ed27);
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const dx = (px - R) / R, dy = (py - R) / R;
        const d = Math.hypot(dx, dy);
        const idx = (py * S + px) * 4;
        if (d > 0.985) { cd[idx + 3] = 0; continue; }
        // swirl-distorted fBm clouds, banded like trade winds
        const warp = fbm(swirl, px / S * 4, py / S * 4, 3) * 0.8;
        const n = fbm(noise2, px / S * 7 + warp, py / S * 5, 5) * 0.5 + 0.5;
        const bandBoost = 0.12 * Math.sin((py / S) * Math.PI * 5);
        const cov = clamp(n + bandBoost - 0.52, 0, 1);
        const a = clamp(cov * 3.2, 0, 1) * 235 * clamp((0.985 - d) * 18, 0, 1);
        cd[idx] = 255; cd[idx + 1] = 255; cd[idx + 2] = 255;
        cd[idx + 3] = a;
      }
    }
    cc.putImageData(ci, 0, 0);
  }

  c = { terrain: canvas, clouds, size: S };
  texCache.set(body.key || body.name, c);
  return c;
}

// Draw a body with terrain, clouds, atmosphere and star glow.
function drawBody(ctx, body, sx, sy, rPx, t) {
  // star glow halo
  if (body.star) {
    const g = ctx.createRadialGradient(sx, sy, rPx * 0.5, sx, sy, rPx * 3);
    g.addColorStop(0, 'rgba(255,215,94,0.8)'); g.addColorStop(1, 'rgba(255,150,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(sx, sy, rPx * 3, 0, 7); ctx.fill();
  }

  if (rPx >= 5) {
    // textured body: clip to circle, draw the cached terrain, then rotating clouds
    const tex = getBodyTextures(body);
    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, rPx, 0, 7);
    ctx.clip();
    ctx.drawImage(tex.terrain, sx - rPx, sy - rPx, rPx * 2, rPx * 2);
    if (tex.clouds) {
      const rot = (t * 0.02) % (Math.PI * 2); // slow cloud drift
      ctx.translate(sx, sy);
      ctx.rotate(rot);
      ctx.globalAlpha = 0.85;
      ctx.drawImage(tex.clouds, -rPx, -rPx, rPx * 2, rPx * 2);
      ctx.globalAlpha = 1;
      ctx.rotate(-rot);
      ctx.translate(-sx, -sy);
    }
    // atmosphere ring near the limb
    if (!body.star && body.atmoHeight) {
      const ag = ctx.createRadialGradient(sx, sy, rPx * 0.82, sx, sy, rPx);
      const acol = body.ice ? '150,190,255' : body.lava ? '255,140,60' : '130,190,255';
      ag.addColorStop(0, `rgba(${acol},0)`);
      ag.addColorStop(0.75, `rgba(${acol},0.18)`);
      ag.addColorStop(1, `rgba(${acol},0.4)`);
      ctx.fillStyle = ag;
      ctx.fillRect(sx - rPx, sy - rPx, rPx * 2, rPx * 2);
    }
    ctx.restore();
    // crisp limb
    ctx.strokeStyle = 'rgba(200,220,255,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(sx, sy, rPx, 0, 7); ctx.stroke();
  } else {
    // far away: plain colored disc (cheap)
    ctx.fillStyle = body.color;
    ctx.beginPath(); ctx.arc(sx, sy, Math.max(rPx, 2), 0, 7); ctx.fill();
  }
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

  // bodies + SOI (draw small bodies first so big ones overlap correctly)
  const bodies = Object.values(BODIES).slice().sort((a, b) => b.radius - a.radius);
  for (const b of bodies) {
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
    drawBody(ctx, b, sx, sy, rPx, t);
    ctx.fillStyle = 'rgba(210,225,255,0.75)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(b.name, sx + rPx + 5, sy + 3);
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
