// render.js — rocket drawing (shared by editor + flight) and the flight-scene renderer.
//
// drawRocket draws in LOCAL px coords with the NOSE toward -Y (screen up),
// origin at the stack CENTER. Caller sets translate/rotate/scale first.

import { BODIES, bodyWorldPos, atmoDensity } from './universe.js';
import { PARTS } from './parts.js';
import * as V from './vessel.js';
import { world } from './physics.js';

// ---------- part shapes ----------
function shade(color, f) {
  // quick hex shade: f<1 darker, f>1 lighter
  const n = parseInt(color.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) * f) | 0;
  const g = Math.min(255, ((n >> 8) & 255) * f) | 0;
  const b = Math.min(255, (n & 255) * f) | 0;
  return `rgb(${r},${g},${b})`;
}

function drawPart(ctx, p, S, state, time) {
  const w = p.w * S, h = p.h * S;
  ctx.save();
  switch (p.type) {
    case 'pod': {
      ctx.fillStyle = '#d8dce4';
      ctx.beginPath();
      ctx.moveTo(-w / 2, h / 2);
      ctx.lineTo(-w * 0.18, -h / 2);
      ctx.lineTo(w * 0.18, -h / 2);
      ctx.lineTo(w / 2, h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#4c5566';
      ctx.fillRect(-w / 2, h * 0.35, w, h * 0.15);
      if (p.crew) {
        ctx.fillStyle = '#7fd4ff';
        ctx.beginPath(); ctx.arc(0, 0, w * 0.16, 0, 7); ctx.fill();
        ctx.strokeStyle = '#2a3242'; ctx.lineWidth = Math.max(1, S * 0.05); ctx.stroke();
      } else {
        ctx.fillStyle = '#f2b632';
        ctx.fillRect(-w * 0.3, -h * 0.15, w * 0.6, h * 0.3);
      }
      break;
    }
    case 'tank': {
      ctx.fillStyle = '#c8cdd6';
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = '#e66a2c';
      ctx.fillRect(-w / 2, -h / 2 + h * 0.12, w, h * 0.1);
      ctx.fillRect(-w / 2, h / 2 - h * 0.22, w, h * 0.1);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(-w * 0.38, -h / 2, w * 0.16, h);
      if (state && p.fuel) {
        // subtle fuel level pip
        ctx.fillStyle = 'rgba(30,40,60,0.35)';
        const frac = 1 - (state.fuel || 0) / p.fuel;
        ctx.fillRect(w * 0.30, -h / 2 + 2, w * 0.1, (h - 4) * frac);
      }
      break;
    }
    case 'engine': {
      ctx.fillStyle = '#6b7280';
      ctx.fillRect(-w * 0.3, -h / 2, w * 0.6, h * 0.3);
      const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      g.addColorStop(0, '#3b4150'); g.addColorStop(0.5, '#8a93a5'); g.addColorStop(1, '#3b4150');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-w * 0.22, -h * 0.2);
      ctx.lineTo(-w * 0.48, h / 2);
      ctx.lineTo(w * 0.48, h / 2);
      ctx.lineTo(w * 0.22, -h * 0.2);
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'srb': {
      ctx.fillStyle = '#e8e3d8';
      ctx.fillRect(-w / 2, -h / 2 + w * 0.6, w, h - w * 0.6 - h * 0.06);
      ctx.fillStyle = '#c23b22';
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h / 2 + w * 0.6);
      ctx.lineTo(0, -h / 2);
      ctx.lineTo(w / 2, -h / 2 + w * 0.6);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#c23b22';
      ctx.fillRect(-w / 2, -h * 0.1, w, h * 0.12);
      ctx.fillStyle = '#5a5f6b';
      ctx.beginPath();
      ctx.moveTo(-w * 0.35, h / 2 - h * 0.06);
      ctx.lineTo(-w * 0.45, h / 2);
      ctx.lineTo(w * 0.45, h / 2);
      ctx.lineTo(w * 0.35, h / 2 - h * 0.06);
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'decoupler': {
      ctx.fillStyle = '#3d4453';
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = '#f2b632';
      ctx.fillRect(-w / 2, -h * 0.15, w, h * 0.3);
      break;
    }
    case 'parachute': {
      if (state && state.deployed) {
        // canopy above (drawn big); shroud lines
        const cw = w * 6, ch = w * 5;
        ctx.strokeStyle = 'rgba(230,230,240,0.8)';
        ctx.lineWidth = Math.max(1, S * 0.04);
        ctx.beginPath();
        ctx.moveTo(0, -h * 0.2);
        ctx.lineTo(-cw / 2, -ch);
        ctx.moveTo(0, -h * 0.2);
        ctx.lineTo(cw / 2, -ch);
        ctx.stroke();
        const g = ctx.createLinearGradient(-cw / 2, -ch, cw / 2, -ch);
        g.addColorStop(0, '#e66a2c'); g.addColorStop(0.5, '#fff3e0'); g.addColorStop(1, '#e66a2c');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, -ch, cw / 2, Math.PI, 0);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = '#b8bec9';
      ctx.beginPath();
      ctx.arc(0, h * 0.1, w / 2, Math.PI, 0);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e66a2c';
      ctx.fillRect(-w / 2, h * 0.1, w, h * 0.3);
      break;
    }
    case 'nosecone': {
      ctx.fillStyle = '#d8dce4';
      ctx.beginPath();
      ctx.moveTo(-w / 2, h / 2);
      ctx.quadraticCurveTo(-w * 0.4, -h * 0.3, 0, -h / 2);
      ctx.quadraticCurveTo(w * 0.4, -h * 0.3, w / 2, h / 2);
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'fin': {
      ctx.fillStyle = '#e66a2c';
      ctx.beginPath();
      ctx.moveTo(-w / 2, h / 2);
      ctx.lineTo(-w / 2, -h / 2);
      ctx.lineTo(w / 2, h / 2);
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'legs': {
      ctx.strokeStyle = '#9aa2b1';
      ctx.lineWidth = Math.max(1.5, S * 0.12);
      ctx.beginPath();
      ctx.moveTo(0, -h / 2);
      ctx.lineTo(w * 0.7, h / 2);
      ctx.stroke();
      ctx.fillStyle = '#6b7280';
      ctx.fillRect(w * 0.45, h / 2 - S * 0.08, w * 0.55, S * 0.12);
      break;
    }
    case 'science': {
      ctx.fillStyle = '#f2b632';
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = '#2a3242';
      ctx.beginPath(); ctx.arc(0, 0, w * 0.22, 0, 7); ctx.fill();
      break;
    }
  }
  ctx.restore();
}

function drawFlame(ctx, w, h, S, power, time, color1 = '#ffb143', color2 = '#fff7d6') {
  const flick = 0.85 + 0.3 * Math.sin(time * 47) * Math.random();
  const len = (h * 1.6 + h * 2.2 * power) * flick * S;
  const fw = w * 0.55 * S * (0.8 + 0.3 * power);
  const g = ctx.createLinearGradient(0, 0, 0, len);
  g.addColorStop(0, color2);
  g.addColorStop(0.35, color1);
  g.addColorStop(1, 'rgba(255,80,20,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-fw / 2, 0);
  ctx.quadraticCurveTo(-fw * 0.3, len * 0.6, 0, len);
  ctx.quadraticCurveTo(fw * 0.3, len * 0.6, fw / 2, 0);
  ctx.closePath(); ctx.fill();
}

// Draws a flight stack (or design stack converted via makeFlightStack).
// opts: { throttle, showFlames, time }
export function drawRocket(ctx, stack, S, opts = {}) {
  if (!stack.length) return;
  const geom = V.stackGeometry(stack);
  const t = opts.time || 0;

  // flames behind everything
  if (opts.showFlames) {
    stack.forEach((s, i) => {
      const p = PARTS[s.pid];
      const y = -geom.offsets[i] * S; // canvas y down; offsets +up
      if (p.type === 'engine' && s.ignited && (opts.throttle || 0) > 0 && opts.hasFuel !== false) {
        if (!opts.fuelBySection || opts.fuelBySection[i] > 0) {
          ctx.save();
          ctx.translate(0, y + p.h * S / 2);
          const isNuke = p.isp > 500;
          drawFlame(ctx, p.w, p.h * 0.6, S, opts.throttle, t,
            isNuke ? '#7fb4ff' : '#ffb143', isNuke ? '#e0f0ff' : '#fff7d6');
          ctx.restore();
        }
      }
      if (p.type === 'srb' && s.ignited && s.fuel > 0) {
        ctx.save();
        ctx.translate(0, y + p.h * S / 2);
        drawFlame(ctx, p.w, p.h * 0.25, S, 1, t, '#ffd75e', '#fffbe8');
        ctx.restore();
      }
      for (const r of s.radials) {
        const rp = PARTS[r.pid];
        if (rp.type === 'srb' && r.ignited && r.fuel > 0) {
          const xOff = (p.w / 2 + rp.w / 2);
          for (const side of [-1, 1]) {
            ctx.save();
            ctx.translate(side * xOff * S, y + rp.h * S / 2);
            drawFlame(ctx, rp.w, rp.h * 0.25, S, 1, t, '#ffd75e', '#fffbe8');
            ctx.restore();
          }
        }
      }
    });
  }

  // parts (bottom to top so upper parts overlap)
  for (let i = stack.length - 1; i >= 0; i--) {
    const s = stack[i];
    const p = PARTS[s.pid];
    const y = -geom.offsets[i] * S;
    // radials first (behind core)
    for (const r of s.radials) {
      const rp = PARTS[r.pid];
      const xOff = (p.w / 2 + rp.w / 2) * S;
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(side * xOff, y);
        if (rp.type === 'fin' || rp.type === 'legs') ctx.scale(side, 1);
        drawPart(ctx, rp, S, r, t);
        ctx.restore();
      }
    }
    ctx.save();
    ctx.translate(0, y);
    drawPart(ctx, p, S, s, t);
    ctx.restore();
  }
}

// ---------- flight scene ----------
export function makeCamera() {
  return { zoom: 0.18 }; // meters per pixel
}

const STAR_TILE = 384;
function drawStars(ctx, W, H, offX, offY, alpha) {
  if (alpha <= 0.02) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const ox = offX * 0.02, oy = offY * 0.02; // slow parallax
  const x0 = Math.floor((ox - W) / STAR_TILE), x1 = Math.floor((ox + 2 * W) / STAR_TILE);
  const y0 = Math.floor((oy - H) / STAR_TILE), y1 = Math.floor((oy + 2 * H) / STAR_TILE);
  ctx.fillStyle = '#dfe6ff';
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      let seed = (tx * 73856093) ^ (ty * 19349663);
      for (let i = 0; i < 5; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const px = (seed % STAR_TILE) + tx * STAR_TILE - ox;
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const py = (seed % STAR_TILE) + ty * STAR_TILE - oy;
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const r = 0.4 + (seed % 100) / 90;
        ctx.fillRect(px, py, r, r);
      }
    }
  }
  ctx.restore();
}

// Renders the local flight view. Vessel-centred camera.
export function renderFlight(ctx, W, H, flight, cam, t) {
  const body = BODIES[flight.bodyKey];
  const alt = Math.hypot(flight.pos.x, flight.pos.y) - body.radius;
  const zoom = cam.zoom;

  const toScreen = (wx, wy) => [
    W / 2 + (wx - flight.pos.x) / zoom,
    H / 2 - (wy - flight.pos.y) / zoom,
  ];

  // background: blend sky by atmospheric density
  const rho = atmoDensity(body, Math.max(alt, 0));
  const skyF = body.rho0 ? Math.pow(rho / body.rho0, 0.35) : 0;
  const sky = body.key === 'gaia' ? [110, 175, 235] : [220, 160, 120];
  const spaceC = [8, 10, 18];
  const bg = sky.map((c, i) => Math.round(spaceC[i] + (c - spaceC[i]) * skyF));
  ctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
  ctx.fillRect(0, 0, W, H);

  drawStars(ctx, W, H, flight.pos.x / zoom, -flight.pos.y / zoom, 1 - skyF);

  // celestial bodies visible from this frame
  const curW = bodyWorldPos(body, t);
  for (const b of Object.values(BODIES)) {
    const bw = bodyWorldPos(b, t);
    const rel = { x: bw.x - curW.x + 0, y: bw.y - curW.y };
    const [sx, sy] = toScreen(rel.x, rel.y);
    const rPx = b.radius / zoom;
    const dist = Math.hypot(sx - W / 2, sy - H / 2);
    if (dist - rPx > Math.hypot(W, H)) continue; // fully off-screen
    if (rPx < 0.6) continue;

    if (b.atmoHeight) {
      const g = ctx.createRadialGradient(sx, sy, rPx, sx, sy, rPx + b.atmoHeight * 1.8 / zoom);
      g.addColorStop(0, 'rgba(120,180,255,0.35)');
      g.addColorStop(1, 'rgba(120,180,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(sx, sy, rPx + b.atmoHeight * 1.8 / zoom, 0, 7); ctx.fill();
    }
    if (b.star) {
      const g = ctx.createRadialGradient(sx, sy, rPx * 0.6, sx, sy, rPx * 2.2);
      g.addColorStop(0, 'rgba(255,215,94,0.9)');
      g.addColorStop(1, 'rgba(255,150,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(sx, sy, rPx * 2.2, 0, 7); ctx.fill();
    }
    ctx.fillStyle = b.color;
    ctx.beginPath(); ctx.arc(sx, sy, Math.max(rPx, 1), 0, 7); ctx.fill();
    // simple shading toward the limb
    if (rPx > 40) {
      const g = ctx.createRadialGradient(sx, sy, rPx * 0.55, sx, sy, rPx);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(sx, sy, rPx, 0, 7); ctx.fill();
    }
  }

  // launch pad on Gaia (at the north pole spawn point)
  if (flight.bodyKey === 'gaia' && alt < 30_000) {
    const padY = body.radius;
    const [px, py] = toScreen(0, padY);
    const wpx = 30 / zoom;
    if (wpx > 2) {
      ctx.fillStyle = '#39404f';
      ctx.fillRect(px - wpx / 2, py - 3 / zoom, wpx, 5 / zoom);
      ctx.fillStyle = '#59637a';
      ctx.fillRect(px - wpx / 2 - 8 / zoom, py + 2 / zoom, wpx + 16 / zoom, 12 / zoom);
    }
  }

  // debris
  for (const d of world.debris) {
    if (d.bodyKey !== flight.bodyKey) continue;
    const [sx, sy] = toScreen(d.pos.x, d.pos.y);
    if (sx < -200 || sx > W + 200 || sy < -200 || sy > H + 200) continue;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(Math.PI / 2 - d.angle);
    drawRocket(ctx, d.stack, 1 / zoom, { showFlames: false });
    ctx.restore();
  }

  // particles
  for (const p of world.particles) {
    if (p.bodyKey !== flight.bodyKey) continue;
    const [sx, sy] = toScreen(p.x, p.y);
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(sx, sy, Math.max(1.2, p.size / zoom), 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // active vessel
  if (!flight.destroyed && flight.stack.length) {
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(Math.PI / 2 - flight.angle);
    const geom = V.stackGeometry(flight.stack);
    ctx.translate(0, -(-geom.com) / zoom); // rotate around CoM, then offset to stack center
    const fuelBySection = {};
    const sections = V.computeSections(flight.stack);
    flight.stack.forEach((s, i) => {
      const si = V.sectionOfIndex(sections, i);
      fuelBySection[i] = V.sectionFuel(flight.stack, si);
    });
    drawRocket(ctx, flight.stack, 1 / zoom, {
      showFlames: true, throttle: flight.throttle, time: t, fuelBySection,
    });
    ctx.restore();

    // attitude ring markers (screen space around vessel)
    drawMarkers(ctx, W, H, flight);
  }
}

function marker(ctx, W, H, worldAngle, color, style) {
  const R = 78;
  const sa = -worldAngle; // world CCW -> screen
  const x = W / 2 + Math.cos(sa) * R;
  const y = H / 2 + Math.sin(sa) * R;
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = 2;
  if (style === 'dot') {
    ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 1.5, 0, 7); ctx.fill();
  } else if (style === 'cross') {
    ctx.beginPath();
    ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y + 5);
    ctx.moveTo(x + 5, y - 5); ctx.lineTo(x - 5, y + 5);
    ctx.stroke();
  } else if (style === 'arrow') {
    const ax = Math.cos(sa), ay = Math.sin(sa);
    ctx.beginPath();
    ctx.moveTo(x + ax * 8, y + ay * 8);
    ctx.lineTo(x - ay * 5 - ax * 3, y + ax * 5 - ay * 3);
    ctx.lineTo(x + ay * 5 - ax * 3, y - ax * 5 - ay * 3);
    ctx.closePath(); ctx.fill();
  }
}

function drawMarkers(ctx, W, H, flight) {
  const spd = Math.hypot(flight.vel.x, flight.vel.y);
  if (spd > 1) {
    const va = Math.atan2(flight.vel.y, flight.vel.x);
    marker(ctx, W, H, va, '#9fe870', 'dot');            // prograde
    marker(ctx, W, H, va + Math.PI, '#f0685a', 'cross'); // retrograde
  }
  if (flight.nodeDir !== undefined && flight.nodeDir !== null) {
    marker(ctx, W, H, flight.nodeDir, '#7fb4ff', 'arrow'); // maneuver direction
  }
}
