// render.js — rocket drawing (shared by editor + flight) and the flight-scene renderer.
//
// drawRocket draws in LOCAL px coords with the NOSE toward -Y (screen up),
// origin at the stack CENTER. Caller sets translate/rotate/scale first.

import { BODIES, bodyWorldPos, atmoDensity } from './universe.js';
import { PARTS } from './parts.js';
import * as V from './vessel.js';
import { world } from './physics.js';
import { terrainHeight, terrainAtLaunchSite, cloudsFor, TERRAIN } from './terrain.js';

// ---------- part shapes ----------
function shade(color, f) {
  const n = parseInt(color.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) * f) | 0;
  const g = Math.min(255, ((n >> 8) & 255) * f) | 0;
  const b = Math.min(255, (n & 255) * f) | 0;
  return `rgb(${r},${g},${b})`;
}

// Vertical metal gradient across a part body (light from upper-left).
function metalGrad(ctx, w, y0, y1, base) {
  const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  g.addColorStop(0, shade(base, 0.62));
  g.addColorStop(0.22, shade(base, 1.12));
  g.addColorStop(0.45, shade(base, 0.94));
  g.addColorStop(1, shade(base, 0.55));
  return g;
}

function drawPart(ctx, p, S, state, time) {
  const w = p.w * S, h = p.h * S;
  const px = Math.max(1, S * 0.045); // panel line width
  ctx.save();
  switch (p.type) {
    case 'pod': {
      // tr hull with vertical sheen
      ctx.fillStyle = metalGrad(ctx, w, 0, 0, '#d8dce4');
      ctx.beginPath();
      ctx.moveTo(-w / 2, h / 2);
      ctx.quadraticCurveTo(-w * 0.42, -h * 0.28, -w * 0.18, -h / 2);
      ctx.lineTo(w * 0.18, -h / 2);
      ctx.quadraticCurveTo(w * 0.42, -h * 0.28, w / 2, h / 2);
      ctx.closePath(); ctx.fill();
      // heat shield
      ctx.fillStyle = '#5b4a3a';
      ctx.beginPath();
      ctx.moveTo(-w / 2, h / 2);
      ctx.quadraticCurveTo(0, h * 0.68, w / 2, h / 2);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(-w / 2, h * 0.36, w * 0.16, h * 0.09);
      // hatch + trim band
      ctx.fillStyle = '#4c5566';
      ctx.fillRect(-w * 0.5, h * 0.30, w, h * 0.07);
      if (p.crew) {
        // window with glow
        ctx.fillStyle = '#27313f';
        ctx.beginPath(); ctx.arc(0, -h * 0.05, w * 0.20, 0, 7); ctx.fill();
        const wg = ctx.createRadialGradient(-w * 0.05, -h * 0.10, 0, 0, -h * 0.05, w * 0.17);
        wg.addColorStop(0, '#bfeaff'); wg.addColorStop(1, '#5fa8d8');
        ctx.fillStyle = wg;
        ctx.beginPath(); ctx.arc(0, -h * 0.05, w * 0.155, 0, 7); ctx.fill();
        ctx.strokeStyle = '#2a3242'; ctx.lineWidth = px; ctx.stroke();
      } else {
        ctx.fillStyle = '#f2b632';
        ctx.fillRect(-w * 0.3, -h * 0.18, w * 0.6, h * 0.28);
        ctx.fillStyle = '#2a3242';
        ctx.fillRect(-w * 0.3, -h * 0.18, w * 0.6, h * 0.06);
      }
      // nose light
      ctx.fillStyle = '#ff6b5e';
      ctx.beginPath(); ctx.arc(0, -h * 0.46, Math.max(1, w * 0.05), 0, 7); ctx.fill();
      break;
    }
    case 'tank': {
      ctx.fillStyle = metalGrad(ctx, w, -h / 2, h / 2, '#c8cdd6');
      ctx.fillRect(-w / 2, -h / 2, w, h);
      // panel seams
      ctx.strokeStyle = 'rgba(40,50,70,0.28)'; ctx.lineWidth = px;
      for (let i = 1; i < 4; i++) {
        const y = -h / 2 + (h * i) / 4;
        ctx.beginPath(); ctx.moveTo(-w / 2, y); ctx.lineTo(w / 2, y); ctx.stroke();
      }
      // orange bands + top/bottom rims
      ctx.fillStyle = '#e66a2c';
      ctx.fillRect(-w / 2, -h / 2 + h * 0.10, w, h * 0.085);
      ctx.fillRect(-w / 2, h / 2 - h * 0.19, w, h * 0.085);
      ctx.fillStyle = 'rgba(255,255,255,0.30)';
      ctx.fillRect(-w * 0.42, -h / 2, w * 0.13, h);
      ctx.fillStyle = '#9aa2b1';
      ctx.fillRect(-w / 2, -h / 2, w, Math.max(1, h * 0.025));
      ctx.fillRect(-w / 2, h / 2 - Math.max(1, h * 0.025), w, Math.max(1, h * 0.025));
      // fuel level pip (dark strip on the right)
      if (state && p.fuel) {
        const frac = 1 - (state.fuel || 0) / p.fuel;
        ctx.fillStyle = 'rgba(30,40,60,0.40)';
        ctx.fillRect(w * 0.30, -h / 2 + 2, w * 0.09, (h - 4) * frac);
      }
      break;
    }
    case 'engine': {
      ctx.fillStyle = '#4b5162';
      ctx.fillRect(-w * 0.30, -h / 2, w * 0.60, h * 0.30);
      ctx.fillStyle = '#2f3542';
      ctx.fillRect(-w * 0.42, -h / 2 + h * 0.10, w * 0.84, h * 0.08);
      // bell
      const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      g.addColorStop(0, '#20242e'); g.addColorStop(0.3, '#7d8798');
      g.addColorStop(0.55, '#aab4c4'); g.addColorStop(1, '#23272f');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-w * 0.22, -h * 0.2);
      ctx.quadraticCurveTo(-w * 0.26, h * 0.15, -w * 0.48, h / 2);
      ctx.lineTo(-w * 0.48, h / 2);
      ctx.lineTo(w * 0.48, h / 2);
      ctx.quadraticCurveTo(w * 0.26, h * 0.15, w * 0.22, -h * 0.2);
      ctx.closePath(); ctx.fill();
      // bell interior + soot
      ctx.fillStyle = 'rgba(10,12,18,0.75)';
      ctx.beginPath();
      ctx.ellipse(0, h / 2, w * 0.46, Math.max(1.5, S * 0.06), 0, 0, 7);
      ctx.fill();
      ctx.fillStyle = 'rgba(60,45,35,0.5)';
      ctx.fillRect(-w * 0.30, h * 0.28, w * 0.14, h * 0.2);
      break;
    }
    case 'srb': {
      const bodyH = h - w * 0.6 - h * 0.06;
      ctx.fillStyle = metalGrad(ctx, w, 0, 0, '#e8e3d8');
      ctx.fillRect(-w / 2, -h / 2 + w * 0.6, w, bodyH);
      // nose cone fade
      const ng = ctx.createLinearGradient(0, -h / 2, 0, -h / 2 + w * 0.6);
      ng.addColorStop(0, '#c23b22'); ng.addColorStop(1, '#8f2b18');
      ctx.fillStyle = ng;
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h / 2 + w * 0.6);
      ctx.lineTo(0, -h / 2);
      ctx.lineTo(w / 2, -h / 2 + w * 0.6);
      ctx.closePath(); ctx.fill();
      // stripe + rivet rows
      ctx.fillStyle = '#c23b22';
      ctx.fillRect(-w / 2, -h * 0.10, w, h * 0.12);
      ctx.strokeStyle = 'rgba(90,60,40,0.35)'; ctx.lineWidth = px;
      ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2 + w * 0.6 + bodyH * 0.33); ctx.lineTo(w / 2, -h / 2 + w * 0.6 + bodyH * 0.33); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2 + w * 0.6 + bodyH * 0.66); ctx.lineTo(w / 2, -h / 2 + w * 0.6 + bodyH * 0.66); ctx.stroke();
      // nozzle
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
      ctx.fillStyle = metalGrad(ctx, w, 0, 0, '#3d4453');
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = '#f2b632';
      ctx.fillRect(-w / 2, -h * 0.15, w, h * 0.3);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      for (const sx of [-0.32, 0, 0.32]) ctx.fillRect(w * sx - w * 0.03, -h * 0.1, w * 0.06, h * 0.2);
      break;
    }
    case 'parachute': {
      if (state && state.deployed) {
        const cw = w * 6, ch = w * 5;
        ctx.strokeStyle = 'rgba(230,230,240,0.8)';
        ctx.lineWidth = Math.max(1, S * 0.04);
        ctx.beginPath();
        for (const fx of [-1, -0.5, 0, 0.5, 1]) {
          ctx.moveTo(0, -h * 0.2);
          ctx.lineTo(cw * fx / 2, -ch + Math.abs(fx) * ch * 0.08);
        }
        ctx.stroke();
        const g = ctx.createLinearGradient(-cw / 2, -ch, cw / 2, -ch);
        g.addColorStop(0, '#e66a2c'); g.addColorStop(0.35, '#fff3e0');
        g.addColorStop(0.7, '#e66a2c'); g.addColorStop(1, '#b34d1c');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(0, -ch, cw / 2, Math.PI, 0); ctx.closePath(); ctx.fill();
        // canopy shading
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.beginPath(); ctx.arc(-cw * 0.22, -ch, cw * 0.36, Math.PI, 0); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = metalGrad(ctx, w, 0, 0, '#b8bec9');
      ctx.beginPath(); ctx.arc(0, h * 0.1, w / 2, Math.PI, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e66a2c';
      ctx.fillRect(-w / 2, h * 0.1, w, h * 0.3);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(-w * 0.4, h * 0.1, w * 0.12, h * 0.3);
      break;
    }
    case 'nosecone': {
      const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      g.addColorStop(0, '#8b93a3'); g.addColorStop(0.35, '#eef1f6');
      g.addColorStop(0.6, '#c3c9d4'); g.addColorStop(1, '#6a7180');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-w / 2, h / 2);
      ctx.quadraticCurveTo(-w * 0.4, -h * 0.3, 0, -h / 2);
      ctx.quadraticCurveTo(w * 0.4, -h * 0.3, w / 2, h / 2);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(60,70,90,0.4)'; ctx.lineWidth = px;
      ctx.beginPath(); ctx.moveTo(-w * 0.30, h * 0.18); ctx.lineTo(w * 0.30, h * 0.18); ctx.stroke();
      break;
    }
    case 'fin': {
      const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      g.addColorStop(0, '#f07f42'); g.addColorStop(1, '#c14f1d');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-w / 2, h / 2);
      ctx.lineTo(-w / 2, -h / 2);
      ctx.quadraticCurveTo(w * 0.1, -h * 0.15, w / 2, h / 2);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(90,40,15,0.5)'; ctx.lineWidth = px;
      ctx.stroke();
      break;
    }
    case 'legs': {
      ctx.strokeStyle = '#9aa2b1';
      ctx.lineWidth = Math.max(1.5, S * 0.12);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, -h / 2);
      ctx.lineTo(w * 0.7, h / 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(60,66,80,0.8)';
      ctx.lineWidth = Math.max(1, S * 0.05);
      ctx.beginPath();
      ctx.moveTo(w * 0.55, h * 0.16);
      ctx.lineTo(w * 0.28, -h * 0.05);
      ctx.stroke();
      ctx.fillStyle = '#6b7280';
      ctx.fillRect(w * 0.45, h / 2 - S * 0.08, w * 0.55, S * 0.12);
      break;
    }
    case 'science': {
      ctx.fillStyle = metalGrad(ctx, w, 0, 0, '#f2b632');
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = '#2a3242';
      ctx.beginPath(); ctx.arc(0, 0, w * 0.22, 0, 7); ctx.fill();
      // blinking sensor light
      if (Math.sin(time * 4) > 0) {
        ctx.fillStyle = '#7dff9a';
        ctx.beginPath(); ctx.arc(w * 0.22, -h * 0.25, Math.max(1, w * 0.08), 0, 7); ctx.fill();
      }
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
  // bright core
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.moveTo(-fw * 0.18, 0);
  ctx.quadraticCurveTo(0, len * 0.45, fw * 0.18, 0);
  ctx.closePath(); ctx.fill();
}

export function drawRocket(ctx, stack, S, opts = {}) {
  if (!stack.length) return;
  const geom = V.stackGeometry(stack);
  const t = opts.time || 0;

  if (opts.showFlames) {
    stack.forEach((s, i) => {
      const p = PARTS[s.pid];
      const y = -geom.offsets[i] * S;
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

  for (let i = stack.length - 1; i >= 0; i--) {
    const s = stack[i];
    const p = PARTS[s.pid];
    const y = -geom.offsets[i] * S;
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
function drawStars(ctx, W, H, offX, offY, alpha, time) {
  if (alpha <= 0.02) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const ox = offX * 0.02, oy = offY * 0.02;
  const x0 = Math.floor((ox - W) / STAR_TILE), x1 = Math.floor((ox + 2 * W) / STAR_TILE);
  const y0 = Math.floor((oy - H) / STAR_TILE), y1 = Math.floor((oy + 2 * H) / STAR_TILE);
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
        const tw = 0.55 + 0.45 * Math.sin(time * 0.001 * (2 + (seed % 5)) + seed);
        ctx.fillStyle = `rgba(223,230,255,${tw})`;
        ctx.fillRect(px, py, r, r);
      }
    }
  }
  ctx.restore();
}

// Sun direction (unit vector, world frame) pointing from `body` toward Helios.
function sunDir(body, t) {
  let b = body, hx = 0, hy = 0;
  while (b.orbit) { const p = bodyWorldPos(b, t); hx += p.x; hy += p.y; b = BODIES[b.orbit.parent]; }
  // helios is at world origin
  const L = Math.hypot(hx, hy) || 1;
  return { x: -hx / L, y: -hy / L };
}

// Palette per body: [low ground, high ground, ocean|null]
function groundPalette(b) {
  if (b.key === 'gaia') return ['#5d9948', '#8a7f5a', '#2d5f9e'];
  if (b.key === 'crumb') return ['#8f8f92', '#c9c9cd', null];
  if (b.key === 'scorch') return ['#9c6f45', '#d8b07a', null];
  if (b.key === 'rusty') return ['#a85a30', '#d29a6a', '#6e4630'];
  return ['#7a6a55', '#a89474', null];
}

// Renders the local flight view. Vessel-centred camera.
export function renderFlight(ctx, W, H, flight, cam, t) {
  const body = BODIES[flight.bodyKey];
  const alt = Math.hypot(flight.pos.x, flight.pos.y) - body.radius;
  const zoom = cam.zoom;
  const upA = Math.atan2(flight.pos.y, flight.pos.x);
  const sun = sunDir(body, t);
  // daylight factor at the vessel position (1 = noon, ->0.25 = night)
  const dayl = 0.25 + 0.75 * Math.max(0, Math.cos(upA - Math.atan2(sun.y, sun.x)) ** 1.2);

  const toScreen = (wx, wy) => [
    W / 2 + (wx - flight.pos.x) / zoom,
    H / 2 - (wy - flight.pos.y) / zoom,
  ];

  // ---- background sky ----
  const rho = atmoDensity(body, Math.max(alt, 0));
  const skyF = body.rho0 ? Math.pow(rho / body.rho0, 0.35) : 0;
  const skyDay = body.key === 'gaia' ? [110, 175, 235] : [225, 150, 110];
  const spaceC = [8, 10, 18];
  const bg = skyDay.map((c, i) => Math.round((spaceC[i] + (c - spaceC[i]) * skyF) * dayl + spaceC[i] * (1 - dayl) * (1 - skyF)));
  ctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
  ctx.fillRect(0, 0, W, H);
  // warm horizon haze when low in atmosphere
  if (skyF > 0.15) {
    const horizon = ctx.createLinearGradient(0, 0, 0, H);
    const a = skyF * 0.35 * dayl;
    horizon.addColorStop(0, 'rgba(0,0,0,0)');
    horizon.addColorStop(1, body.key === 'gaia' ? `rgba(255,236,200,${a})` : `rgba(255,200,150,${a})`);
    ctx.fillStyle = horizon;
    ctx.fillRect(0, 0, W, H);
  }

  drawStars(ctx, W, H, flight.pos.x / zoom, -flight.pos.y / zoom, (1 - skyF) * (0.4 + 0.6 * (1 - dayl) + 0.001), t);

  // ---- distant bodies (Helios, other planets) ----
  const curW = bodyWorldPos(body, t);
  for (const b of Object.values(BODIES)) {
    if (b.key === body.key) continue;
    const bw = bodyWorldPos(b, t);
    const rel = { x: bw.x - curW.x, y: bw.y - curW.y };
    const [sx, sy] = toScreen(rel.x, rel.y);
    const rPx = b.radius / zoom;
    if (Math.hypot(sx - W / 2, sy - H / 2) - rPx > Math.hypot(W, H)) continue;
    if (rPx < 0.6) continue;
    if (b.star) {
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rPx * 3.2);
      g.addColorStop(0, 'rgba(255,250,220,1)');
      g.addColorStop(0.25, 'rgba(255,215,94,0.95)');
      g.addColorStop(0.5, 'rgba(255,150,40,0.35)');
      g.addColorStop(1, 'rgba(255,150,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(sx, sy, rPx * 3.2, 0, 7); ctx.fill();
    } else {
      // phase shading: lit side faces Helios
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(sx, sy, rPx, 0, 7); ctx.fill();
      if (rPx > 3) {
        const sa = Math.atan2(sun.y, sun.x);
        const lx = sx + Math.cos(sa) * rPx * 0.4, ly = sy - Math.sin(sa) * rPx * 0.4;
        const g = ctx.createRadialGradient(lx, ly, rPx * 0.1, sx, sy, rPx * 1.15);
        g.addColorStop(0, 'rgba(255,240,200,0.25)');
        g.addColorStop(0.55, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,10,0.75)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(sx, sy, rPx, 0, 7); ctx.fill();
      }
    }
  }

  // ---- the body we're at ----
  const rSelfPx = body.radius / zoom;
  if (rSelfPx < 1400) {
    // small on screen: limb-shaded disc + atmosphere + clouds texture
    const [sx, sy] = toScreen(0, 0);
    if (body.atmoHeight) {
      const g = ctx.createRadialGradient(sx, sy, rSelfPx, sx, sy, rSelfPx + body.atmoHeight * 1.8 / zoom);
      g.addColorStop(0, `rgba(120,180,255,${0.35 * dayl})`);
      g.addColorStop(1, 'rgba(120,180,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(sx, sy, rSelfPx + body.atmoHeight * 1.8 / zoom, 0, 7); ctx.fill();
    }
    const [cLow, cHigh] = groundPalette(body);
    const g = ctx.createRadialGradient(
      sx + sun.x * rSelfPx * 0.45, sy - sun.y * rSelfPx * 0.45, rSelfPx * 0.1, sx, sy, rSelfPx * 1.25);
    g.addColorStop(0, shade(cHigh, dayl));
    g.addColorStop(0.6, shade(cLow, 0.9 * dayl));
    g.addColorStop(1, shade('#000010', Math.max(0.25, dayl)));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(sx, sy, rSelfPx, 0, 7); ctx.fill();
    // hinted terrain texture (deterministic blotches)
    if (rSelfPx > 40) {
      ctx.save();
      ctx.beginPath(); ctx.arc(sx, sy, rSelfPx, 0, 7); ctx.clip();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = shade(cHigh, dayl);
      const nT = 26;
      for (let i = 0; i < nT; i++) {
        const a2 = i * 2.399963 + 1; // golden angle
        const rr = rSelfPx * Math.sqrt((i % 13) / 13);
        ctx.beginPath();
        ctx.ellipse(sx + Math.cos(a2) * rr, sy + Math.sin(a2) * rr, rSelfPx * 0.12, rSelfPx * 0.05, a2, 0, 7);
        ctx.fill();
      }
      ctx.restore();
      // terminator
      const g2 = ctx.createRadialGradient(
        sx + sun.x * rSelfPx * 0.6, sy - sun.y * rSelfPx * 0.6, rSelfPx * 0.4, sx, sy, rSelfPx * 1.4);
      g2.addColorStop(0, 'rgba(0,0,0,0)');
      g2.addColorStop(0.72, 'rgba(0,0,0,0)');
      g2.addColorStop(1, 'rgba(0,0,10,0.72)');
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.arc(sx, sy, rSelfPx, 0, 7); ctx.fill();
    }
  } else {
    // close to the surface: draw the real terrain silhouette across the screen
    drawTerrain(ctx, W, H, body, flight, zoom, toScreen, upA, sun, dayl, alt, t);
    // clouds
    if (body.atmoHeight && alt < body.atmoHeight * 2.2) drawClouds(ctx, W, H, body, zoom, toScreen, t, dayl);
    // vessel shadow on the ground
    drawGroundShadow(ctx, W, H, body, flight, zoom, toScreen, sun, dayl, alt);
    drawLaunchPad(ctx, W, H, body, flight, zoom, toScreen, dayl);
  }

  // ---- debris ----
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

  // ---- particles ----
  for (const p of world.particles) {
    if (p.bodyKey !== flight.bodyKey) continue;
    const [sx, sy] = toScreen(p.x, p.y);
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife) * 0.85;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(sx, sy, Math.max(1.2, p.size / zoom), 0, 7); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // ---- active vessel ----
  if (!flight.destroyed && flight.stack.length) {
    // reentry / high-q plasma glow ahead of the vessel
    const q = flight.qNow || 0;
    const spd = Math.hypot(flight.vel.x, flight.vel.y);
    if (q > 8000 && spd > 300) {
      const k = Math.min(1, (q - 8000) / 40000);
      const va = Math.atan2(flight.vel.y, flight.vel.x);
      const sa = Math.PI / 2 - va; // world CCW -> screen
      const off = 40 + 50 * k;
      const gx = W / 2 + Math.cos(sa) * off, gy = H / 2 - Math.sin(sa) * off;
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, 90 + 160 * k);
      g.addColorStop(0, `rgba(255,190,110,${0.5 * k})`);
      g.addColorStop(0.4, `rgba(255,110,60,${0.3 * k})`);
      g.addColorStop(1, 'rgba(255,60,30,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(gx, gy, 90 + 160 * k, 0, 7); ctx.fill();
    }

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(Math.PI / 2 - flight.angle);
    const geom = V.stackGeometry(flight.stack);
    ctx.translate(0, -(-geom.com) / zoom);
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

    drawMarkers(ctx, W, H, flight);
  }
}

// ----- terrain silhouette across the whole screen -----
function drawTerrain(ctx, W, H, body, flight, zoom, toScreen, upA, sun, dayl, alt, t) {
  const [cLow, cHigh, ocean] = groundPalette(body);
  const pad = Math.hypot(W, H) * zoom * 0.75 + 50_000; // angular half-span padding
  const theta0 = upA - pad / body.radius, theta1 = upA + pad / body.radius;
  const N = 220;

  // daylight varies along the visible arc
  const dayAt = th => 0.25 + 0.75 * Math.max(0, Math.cos(th - Math.atan2(sun.y, sun.x)) ** 1.2);

  // ground polygon
  ctx.beginPath();
  let first = true;
  for (let i = 0; i <= N; i++) {
    const th = theta0 + (theta1 - theta0) * i / N;
    const r = body.radius + terrainAtLaunchSite(body.key, th);
    const wx = Math.cos(th) * r, wy = Math.sin(th) * r;
    const [sx, sy] = toScreen(wx, wy);
    if (first) { ctx.moveTo(sx, sy); first = false; } else ctx.lineTo(sx, sy);
  }
  // close downward past the screen corners
  const [ex, ey] = [W + 400, H + 400];
  ctx.lineTo(ex + 400, ey + 400);
  ctx.lineTo(-400, ey + 400);
  ctx.closePath();

  const midDay = dayAt(upA);
  const g = ctx.createLinearGradient(0, H * 0.25, 0, H + 200);
  g.addColorStop(0, shade(cHigh, midDay));
  g.addColorStop(0.45, shade(cLow, 0.92 * midDay));
  g.addColorStop(1, shade(cLow, 0.55 * midDay));
  ctx.fillStyle = g;
  ctx.fill();

  // ocean: fill sea-level areas of Gaia/Rusty
  if (ocean) {
    ctx.save();
    ctx.clip();
    ctx.beginPath();
    first = true;
    for (let i = 0; i <= N; i++) {
      const th = theta0 + (theta1 - theta0) * i / N;
      const hgt = terrainAtLaunchSite(body.key, th);
      if (hgt >= 0) { first = true; continue; }
      const r = body.radius;
      const wx = Math.cos(th) * r, wy = Math.sin(th) * r;
      const [sx, sy] = toScreen(wx, wy);
      if (first) { ctx.moveTo(sx, sy); first = false; } else ctx.lineTo(sx, sy);
    }
    ctx.strokeStyle = shade(ocean, midDay);
    ctx.lineWidth = Math.max(3, 60 / zoom * 8);
    ctx.globalAlpha = 0.9;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // subtle surface shading strip along the silhouette edge
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = shade('#ffffff', midDay);
  ctx.lineWidth = Math.max(1.5, 6 / zoom * 4);
  ctx.beginPath();
  first = true;
  for (let i = 0; i <= N; i++) {
    const th = theta0 + (theta1 - theta0) * i / N;
    const r = body.radius + terrainAtLaunchSite(body.key, th);
    const [sx, sy] = toScreen(Math.cos(th) * r, Math.sin(th) * r);
    if (first) { ctx.moveTo(sx, sy); first = false; } else ctx.lineTo(sx, sy);
  }
  ctx.stroke();
  ctx.restore();
}

function drawClouds(ctx, W, H, body, zoom, toScreen, t, dayl) {
  const R = body.radius;
  const clouds = cloudsFor(body.key);
  const visSpan = Math.hypot(W, H) * zoom * 1.2;
  for (const c of clouds) {
    const th = c.theta + c.drift * t;
    // wrap into the visible arc around the current view center handled via screen cull below
    const wx = Math.cos(th) * (R + c.alt), wy = Math.sin(th) * (R + c.alt);
    const [sx, sy] = toScreen(wx, wy);
    const rPx = c.r / zoom;
    if (sx < -rPx * 3 || sx > W + rPx * 3 || sy < -rPx * 3 || sy > H + rPx * 3) continue;
    if (rPx < 4 || rPx > Math.max(W, H) * 4) continue;
    const a = c.alpha * Math.min(1, dayl + 0.25);
    // puff cluster: 3 overlapping ellipses aligned with the surface tangent
    const tang = th + Math.PI / 2;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    for (let k = 0; k < 3; k++) {
      const off = (k - 1) * rPx * 0.9;
      const px = sx + Math.cos(tang) * off, py = sy - Math.sin(tang) * off;
      ctx.beginPath();
      ctx.ellipse(px, py, rPx * (k === 1 ? 1.25 : 0.9), rPx * 0.5 / c.stretch, -tang + Math.PI / 2, 0, 7);
      ctx.fill();
    }
  }
}

function drawGroundShadow(ctx, W, H, body, flight, zoom, toScreen, sun, dayl, alt) {
  if (alt > 4000) return;
  const R = body.radius;
  const upA = Math.atan2(flight.pos.y, flight.pos.x);
  const groundR = R + terrainAtLaunchSite(body.key, upA);
  // near-vertical sun at gameplay altitudes: shadow hugs the base of the vessel
  const gx = Math.cos(upA) * groundR, gy = Math.sin(upA) * groundR;
  const [sx, sy] = toScreen(gx, gy);
  const geom = V.stackGeometry(flight.stack);
  const wPx = (V.maxWidth(flight.stack) * 1.3) / zoom;
  const hPx = (geom.height * 0.9) / zoom * Math.min(1, alt / 30 + 0.15);
  const tang = upA + Math.PI / 2;
  const a = 0.38 * dayl * Math.max(0.15, 1 - alt / 4000);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(-tang + Math.PI / 2);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(wPx, 2));
  g.addColorStop(0, `rgba(0,0,0,${a})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, Math.max(2, wPx), Math.max(2, hPx), 0, 0, 7);
  ctx.fill();
  ctx.restore();
}

function drawLaunchPad(ctx, W, H, body, flight, zoom, toScreen, dayl) {
  if (flight.bodyKey !== 'gaia') return;
  const padY = body.radius; // flattened terrain zone around the north pole
  const [px, py] = toScreen(0, padY);
  const wpx = 30 / zoom;
  if (wpx < 2 || py < -100 || py > H + 200) return;
  ctx.fillStyle = shade('#39404f', dayl);
  ctx.fillRect(px - wpx / 2, py - 3 / zoom, wpx, 5 / zoom);
  ctx.fillStyle = shade('#59637a', dayl);
  ctx.fillRect(px - wpx / 2 - 8 / zoom, py + 2 / zoom, wpx + 16 / zoom, 12 / zoom);
  // tower
  const th = 24 / zoom;
  ctx.fillStyle = shade('#8b93a3', dayl);
  ctx.fillRect(px + wpx * 0.42, py - th, Math.max(1, 1.2 / zoom), th);
}

function marker(ctx, W, H, worldAngle, color, style) {
  const R = 78;
  const sa = -worldAngle;
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
    marker(ctx, W, H, va, '#9fe870', 'dot');
    marker(ctx, W, H, va + Math.PI, '#f0685a', 'cross');
  }
  if (flight.nodeDir !== undefined && flight.nodeDir !== null) {
    marker(ctx, W, H, flight.nodeDir, '#7fb4ff', 'arrow');
  }
}
