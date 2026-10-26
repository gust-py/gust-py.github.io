// render.js — rocket drawing (shared by editor + flight) and the flight-scene renderer.
//
// drawRocket draws in LOCAL px coords with the NOSE toward -Y (screen up),
// origin at the stack CENTER. Caller sets translate/rotate/scale first.

import { BODIES, bodyWorldPos, atmoDensity } from './universe.js';
import { PARTS } from './parts.js';
import * as V from './vessel.js';
import { world } from './physics.js';
import { drawBody, surfaceElevationM } from './map.js';

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
  if (!Number.isFinite(offX) || !Number.isFinite(offY)) return; // zoom 0/NaN → sem estrelas (evita loop infinito)
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

  drawStars(ctx, W, H, num(flight.pos.x / zoom), num(-flight.pos.y / zoom), 1 - skyF);

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

    // near-surface ground for the body we're flying over: real terrain relief
    if (b === body && rPx > 2000) {
      // o terreno NUNCA pode derrubar o loop de render (um throw aqui
      // congelava o jogo inteiro — inclusive a tela de fabricar foguetes)
      try {
        drawNearSurface(ctx, W, H, flight, b, zoom, t, bg);
      } catch (err) {
        drawFlatGround(ctx, W, H);
      }
      continue;
    }
    // zoom degenerado (0/NaN/negativo): rPx fica Infinity/NaN e os raios de
    // brilho/atmo lançam IndexSizeError no canvas real — pula o corpo
    if (!Number.isFinite(rPx) || rPx <= 0) continue;

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
    if (rPx >= 5) {
      // procedural terrain (biomes, relief shading, clouds) — same textures as map
      drawBody(ctx, b, sx, sy, rPx, t);
    } else {
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(sx, sy, Math.max(rPx, 1), 0, 7); ctx.fill();
    }
    // simple shading toward the limb
    if (rPx > 40 && !b.star) {
      const g = ctx.createRadialGradient(sx, sy, rPx * 0.55, sx, sy, rPx);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(sx, sy, rPx, 0, 7); ctx.fill();
    }
  }

  // launch pad on Gaia (at the north pole spawn point)
  if (flight.bodyKey === 'gaia' && alt < 30_000) {
    const fr = vesselFrame(flight, body);
    // pad sits at sea level directly below the spawn point
    const px = W / 2 + fr.up.x * (-fr.altV / zoom);
    const py = H / 2 + fr.up.y * (-fr.altV / zoom);
    const wpx = 30 / zoom;
    if (wpx > 2) {
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.atan2(fr.up.x, -fr.up.y) + Math.PI / 2); // align pad with local ground
      ctx.fillStyle = '#39404f';
      ctx.fillRect(-wpx / 2, -3 / zoom, wpx, 5 / zoom);
      ctx.fillStyle = '#59637a';
      ctx.fillRect(-wpx / 2 - 8 / zoom, 2 / zoom, wpx + 16 / zoom, 12 / zoom);
      ctx.restore();
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

// ---------- near-surface terrain (real relief on the ground) ----------

// Vessel local frame: altitude, world angle, screen-space up/perp vectors.
function vesselFrame(flight, body) {
  const Rv = Math.hypot(flight.pos.x, flight.pos.y);
  const a0 = Math.atan2(flight.pos.y, flight.pos.x);
  return {
    altV: Rv - body.radius,
    a0,
    up: { x: Math.cos(a0), y: -Math.sin(a0) },      // radial, screen space
    perp: { x: -Math.sin(a0), y: -Math.cos(a0) },    // along-horizon, screen space
  };
}

function hexRGBc(hex) {
  const n = parseInt(String(hex || '').replace('#', '').slice(0, 6), 16);
  if (!Number.isFinite(n)) return [125, 143, 94];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// cor à prova de NaN — nunca gera "rgb(NaN,...)" (o addColorStop do canvas
// lança SyntaxError com cor inválida e isso congelava o loop do jogo)
function rgbS(c) {
  const f = (x) => (Number.isFinite(x) ? Math.max(0, Math.min(255, x | 0)) : 110);
  return `rgb(${f(c[0])},${f(c[1])},${f(c[2])})`;
}
// saneia qualquer número vindo do jogo (posição/altura podem vir NaN
// depois de explosões, zooms extremos etc.)
function num(v, d = 0) { return Number.isFinite(v) ? v : d; }
function mixC(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function mulC(c, f) { return [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)]; }

// Paleta de biomas: grama, areia, terra, pedra e água.
// Gaia tem grama de verdade; outros corpos mantêm seu tom base nas terras baixas.
function biomePalette(b) {
  const base = hexRGBc(b.color || '#7d8f5e');
  const gaia = b.key === 'gaia';
  return {
    grass: gaia ? [106, 168, 64] : base,           // grama
    grassDark: gaia ? [56, 102, 34] : mulC(base, 0.6),
    dirt: gaia ? [140, 100, 62] : mixC(base, [114, 82, 52], 0.55),  // terra
    dirtDark: gaia ? [108, 76, 46] : [90, 64, 42],
    sand: [216, 196, 132],                          // areia
    sandWet: [172, 152, 98],                        // areia molhada na beira d'água
    stone: [128, 124, 118],                         // pedra
    stoneLight: [162, 158, 152],
    stoneDark: [92, 88, 84],
    shallow: [96, 178, 202],                        // água rasa
    deep: [20, 56, 106],                            // água funda
    foam: [234, 246, 250],
  };
}

// Material discreto do solo num ponto (escolhe os detalhes desenhados).
// Leva em conta elevação E inclinação: encostas íngremes viram pedra.
function biomeKey(eN, sl, sea) {
  if (eN < sea) return 'water';
  const steep = Math.abs(sl);
  const above = eN - sea;
  if (steep > 1.35) return 'stone';
  if (above < 0.045) return 'sand';
  if (eN > 0.8) return 'stone';
  if (steep > 0.75) return eN > 0.35 ? 'stone' : 'dirt';
  if (eN > 0.55) return 'dirt';
  return 'grass';
}

// Cor contínua do solo por elevação + inclinação (com transições suaves).
function groundColor(eN, sl, sea, pal) {
  if (eN < sea) {
    const depth = Math.min(1, (sea - eN) / 0.5);
    return mixC(pal.shallow, pal.deep, depth);
  }
  const above = eN - sea;
  let c;
  if (above < 0.018) c = mixC(pal.sandWet, pal.sand, above / 0.018);       // areia molhada
  else if (above < 0.05) c = pal.sand;                                     // areia
  else if (above < 0.11) c = mixC(pal.sand, pal.grass, (above - 0.05) / 0.06);
  else if (eN < 0.4) c = pal.grass;                                        // grama
  else if (eN < 0.56) c = mixC(pal.grass, pal.dirt, (eN - 0.4) / 0.16);
  else if (eN < 0.72) c = pal.dirt;                                        // terra
  else c = mixC(pal.dirt, pal.stone, Math.min(1, (eN - 0.72) / 0.16));     // pedra
  // encostas íngremes expõem pedra
  const st = Math.min(1, Math.max(0, (Math.abs(sl) - 0.55) / 0.9));
  if (above > 0.02) c = mixC(c, pal.stone, st * 0.8);
  return c;
}

// Desenha o solo como um perfil de terreno amostrado, com biomas
// (grama, areia, terra, pedra, água), sombreamento por inclinação,
// névoa de distância e detalhes de superfície. A altura é referenciada
// ao solo sob o foguete, então ele sempre pousa exatamente na superfície.
function drawNearSurface(ctx, W, H, flight, b, zoomArg, t, sky) {
  const zoom = Number.isFinite(zoomArg) && zoomArg > 1e-6 ? zoomArg : 0.18;
  const fr = vesselFrame(flight, b);
  // se a posição da nave veio NaN/Infinity (física bugada, destroço etc.),
  // desenha um chão liso seguro em vez de espalhar NaN pelo canvas
  if (![fr.altV, fr.a0, fr.up.x, fr.up.y, fr.perp.x, fr.perp.y].every(Number.isFinite)) {
    drawFlatGround(ctx, W, H);
    return;
  }
  const h0 = num(surfaceElevationM(b, fr.a0));     // terrain height at the vessel
  const amp = Math.min(num(b.radius, 600000) * 0.004, 3500) || 1;
  const sea = b.ocean === false ? -Infinity : -0.28;
  const pal = biomePalette(b);
  const isGaia = b.key === 'gaia';

  const diag = Math.hypot(W, H);
  const halfWin = (diag * 0.75) * zoom / b.radius; // radians covering the screen
  const N = Math.max(80, Math.min(260, Math.round(diag / 6)));
  const pts = [], hs = [], eNs = [];
  for (let i = 0; i <= N; i++) {
    const a = fr.a0 - halfWin + (2 * halfWin) * i / N;
    const e = num(surfaceElevationM(b, a));        // map.js pode devolver undefined/NaN
    const eN = e / amp;
    const hDraw = eN < sea ? sea * amp : e;        // water surface is flat
    const relY = (hDraw - h0 - fr.altV) / zoom;    // px above vessel, along up
    const relX = b.radius * (a - fr.a0) / zoom;    // px along horizon
    pts.push([
      W / 2 + fr.up.x * relY + fr.perp.x * relX,
      H / 2 + fr.up.y * relY + fr.perp.y * relX,
    ]);
    hs.push(hDraw);
    eNs.push(eN);
  }

  // inclinação por vértice (variação de altura por metro de arco), suavizada
  const arcStep = (b.radius * halfWin * 2) / N + 1e-9;
  const slV = [];
  for (let i = 0; i <= N; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(N, i + 1);
    slV.push((hs[i1] - hs[i0]) / ((i1 - i0) * arcStep + 1e-9));
  }

  // média móvel (±2) da elevação/inclinação só para a COR, evita bandas
  // visíveis entre quads vizinhos (geomtria continua nítida)
  const smooth = (arr) => arr.map((_, i) => {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - 2), J = Math.min(N, i + 2); j <= J; j++) { s += arr[j]; c++; }
    return s / c;
  });
  const eNsS = smooth(eNs);
  const slS = smooth(slV);

  const down = { x: -fr.up.x, y: -fr.up.y };
  const far = diag * 2 + fr.altV / zoom * 2;

  // base fill so no seams show between segments
  ctx.fillStyle = rgbS(mulC(pal.dirtDark, 0.9));
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i <= N; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.lineTo(pts[N][0] + down.x * far, pts[N][1] + down.y * far);
  ctx.lineTo(pts[0][0] + down.x * far, pts[0][1] + down.y * far);
  ctx.closePath();
  ctx.fill();

  // cor por vértice (bioma + luz + névoa) — usada em gradientes por quad
  const colV = [];
  for (let i = 0; i <= N; i++) {
    let c = groundColor(eNsS[i], slS[i], sea, pal);
    c = mulC(c, Math.max(0.7, Math.min(1.25, 1 - slS[i] * 1.6)));   // luz suave
    const distPx = Math.abs(pts[i][0] - W / 2);
    const hz = Math.min(0.42, (distPx / (diag * 0.72)) * 0.5);
    if (hz > 0.01) c = mixC(c, sky, hz);
    colV.push(c);
  }

  // quads por segmento com gradiente entre vértices: sem degraus de cor,
  // o relevo fica suave; a geometria do perfil continua nítida.
  // fill + stroke com a mesma tinta cobre as frestas de antialiasing
  // entre quads vizinhos (evita "costelas" verticais).
  for (let i = 0; i < N; i++) {
    const x0 = pts[i][0], y0 = pts[i][1], x1 = pts[i + 1][0], y1 = pts[i + 1][1];
    let tinta;
    if (Number.isFinite(x0) && Number.isFinite(y0) && Number.isFinite(x1) && Number.isFinite(y1)) {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, rgbS(colV[i]));
      g.addColorStop(1, rgbS(colV[i + 1]));
      tinta = g;
    } else {
      tinta = rgbS(colV[i]);                     // coordenadas NaN → tinta plana
    }
    ctx.fillStyle = tinta;
    ctx.strokeStyle = tinta;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pts[i][0], pts[i][1]);
    ctx.lineTo(pts[i + 1][0], pts[i + 1][1]);
    ctx.lineTo(pts[i + 1][0] + down.x * far, pts[i + 1][1] + down.y * far);
    ctx.lineTo(pts[i][0] + down.x * far, pts[i][1] + down.y * far);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // contorno sutil do relevo
  ctx.strokeStyle = 'rgba(18,22,28,0.22)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i <= N; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();

  // brilho na linha da superfície da água
  if (sea > -Infinity) {
    ctx.strokeStyle = 'rgba(228,246,252,0.32)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i <= N; i++) {
      if (eNs[i] < sea) {
        if (!pen) { ctx.moveTo(pts[i][0], pts[i][1]); pen = true; }
        else ctx.lineTo(pts[i][0], pts[i][1]);
      } else {
        pen = false;
      }
    }
    ctx.stroke();
  }

  drawGroundDetails(ctx, W, H, b, zoom, t, fr, sea, amp, h0, pal, halfWin, N, eNs, slV);
}

// Detalhes ancorados ao ângulo mundial (não deslizam quando o foguete
// se move): tufos de grama com balanço, pontinhos de terra, ondulações
// na areia, rachaduras na pedra, ondas e espuma na água.
function drawGroundDetails(ctx, W, H, b, zoom, t, fr, sea, amp, h0, pal, halfWin, N, eNs, slV) {
  const diag = Math.hypot(W, H);
  if (fr.altV / zoom > diag * 0.85) return;        // solo está fora da tela
  const lod = 1 / zoom;                            // px por metro
  if (lod < 0.9) return;                           // longe demais p/ detalhes

  const isGaia = b.key === 'gaia';
  const maxCells = 520;
  const cellW = Math.max(1.3 / b.radius, (halfWin * 2) / maxCells);
  const k0 = Math.ceil((fr.a0 - halfWin) / cellW), k1 = Math.floor((fr.a0 + halfWin) / cellW);
  const up = fr.up, perp = fr.perp;

  for (let k = k0; k <= k1; k++) {
    const ac = k * cellW;
    const e = num(surfaceElevationM(b, ac));
    const eN = e / amp;
    const idx = Math.max(0, Math.min(N, Math.round(((ac - (fr.a0 - halfWin)) / (2 * halfWin)) * N)));
    const key = biomeKey(eN, num(slV[idx]), sea);

    const hDraw = eN < sea ? sea * amp : e;
    const relY = (hDraw - h0 - fr.altV) / zoom;
    const relX = b.radius * (ac - fr.a0) / zoom;
    const gx = W / 2 + up.x * relY + perp.x * relX;
    const gy = H / 2 + up.y * relY + perp.y * relX;
    if (!Number.isFinite(gx) || !Number.isFinite(gy)) continue;
    if (gx < -40 || gx > W + 40 || gy < -40 || gy > H + 40) continue;

    let s = (k * 374761393 + 668265263) & 0x7fffffff;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const jx = (rnd() - 0.5) * 0.9 * lod;          // espalha dentro da célula
    const ox2 = gx + perp.x * jx, oy2 = gy + perp.y * jx;

    if (key === 'grass') {
      if (rnd() < 0.22) continue;                // quebra a periodicidade das células
      const hpx = (0.4 + rnd() * 1.1) * lod;     // altura do tufo ~0.4–1.5 m
      if (hpx < 1.6) continue;
      const sway = Math.sin(t * 2.1 + k * 1.31) * hpx * 0.22;
      ctx.strokeStyle = rgbS(mulC(pal.grassDark, 0.85 + rnd() * 0.3));
      ctx.lineWidth = Math.max(1, hpx * 0.16);
      ctx.beginPath();
      ctx.moveTo(ox2, oy2);
      ctx.quadraticCurveTo(
        ox2 + up.x * hpx * 0.5 + perp.x * sway * 0.5,
        oy2 + up.y * hpx * 0.5 + perp.y * sway * 0.5,
        ox2 + up.x * hpx + perp.x * sway,
        oy2 + up.y * hpx + perp.y * sway,
      );
      ctx.stroke();
      const hpx2 = hpx * (0.5 + rnd() * 0.6);
      if (hpx2 >= 1.6 && rnd() < 0.7) {
      const sw2 = Math.sin(t * 1.7 + k * 2.3) * hpx2 * 0.25;
      ctx.strokeStyle = rgbS(mulC(pal.grass, 0.9));
      ctx.lineWidth = Math.max(1, hpx2 * 0.13);
      const bx = ox2 + perp.x * 0.18 * lod, by = oy2 + perp.y * 0.18 * lod;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(
        bx + up.x * hpx2 * 0.5 + perp.x * sw2 * 0.5,
        by + up.y * hpx2 * 0.5 + perp.y * sw2 * 0.5,
        bx + up.x * hpx2 + perp.x * sw2,
        by + up.y * hpx2 + perp.y * sw2,
      );
      ctx.stroke();
      }
      if (isGaia && rnd() < 0.06) {                // florzinhas raras na grama
        ctx.fillStyle = rnd() < 0.5 ? 'rgba(246,216,110,0.95)' : 'rgba(242,244,248,0.95)';
        ctx.beginPath();
        ctx.arc(ox2 + up.x * hpx + perp.x * sway, oy2 + up.y * hpx + perp.y * sway,
          Math.max(1, lod * 0.1), 0, 7);
        ctx.fill();
      }
    } else if (key === 'dirt') {
      ctx.fillStyle = rgbS(pal.dirtDark);
      ctx.globalAlpha = 0.4;
      for (let j = 0; j < 2; j++) {                // pontinhos de solo
        const d2 = (rnd() - 0.5) * 0.8 * lod;
        const dy2 = -(rnd() * 0.3) * lod;
        ctx.beginPath();
        ctx.arc(ox2 + perp.x * d2 + up.x * dy2, oy2 + perp.y * d2 + up.y * dy2,
          Math.max(0.8, lod * (0.07 + rnd() * 0.09)), 0, 7);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (rnd() < 0.14) {                          // pedrinha solta
        const pr = Math.max(1, lod * 0.16);
        ctx.fillStyle = rgbS(pal.stoneDark);
        ctx.beginPath();
        ctx.arc(ox2 + up.x * pr * 0.4, oy2 + up.y * pr * 0.4, pr, 0, 7);
        ctx.fill();
      }
    } else if (key === 'sand') {
      const len = (0.45 + rnd() * 0.7) * lod;
      if (len < 2 || rnd() < 0.35) continue;
      const dyp = (0.06 + rnd() * 0.22) * lod;     // ondulação acima do solo
      ctx.strokeStyle = rgbS(mulC(pal.sandWet, 0.9));
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = Math.max(1, lod * 0.06);
      ctx.beginPath();
      ctx.moveTo(ox2 - perp.x * len / 2 + up.x * dyp, oy2 - perp.y * len / 2 + up.y * dyp);
      ctx.lineTo(ox2 + perp.x * len / 2 + up.x * dyp, oy2 + perp.y * len / 2 + up.y * dyp);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (rnd() < 0.3) {                           // grão claro / conchinha
        const d3 = (rnd() - 0.5) * 0.6 * lod;
        ctx.fillStyle = 'rgba(240,232,200,0.8)';
        ctx.beginPath();
        ctx.arc(ox2 + perp.x * d3 + up.x * lod * 0.05, oy2 + perp.y * d3 + up.y * lod * 0.05,
          Math.max(0.8, lod * 0.05), 0, 7);
        ctx.fill();
      }
    } else if (key === 'stone') {
      const len = (0.3 + rnd() * 0.5) * lod;
      if (len < 2 || rnd() < 0.25) continue;
      const dir = rnd() < 0.5 ? -1 : 1;
      const dyp = (0.1 + rnd() * 0.3) * lod;
      ctx.strokeStyle = rgbS(mulC(pal.stoneDark, 0.95));
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = Math.max(1, lod * 0.05);
      ctx.beginPath();                             // rachadura
      ctx.moveTo(ox2 - perp.x * len * 0.5 * dir + up.x * dyp,
        oy2 - perp.y * len * 0.5 * dir + up.y * dyp);
      ctx.lineTo(ox2 + perp.x * len * 0.5 * dir + up.x * (dyp - len * 0.25),
        oy2 + perp.y * len * 0.5 * dir + up.y * (dyp - len * 0.25));
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = rgbS(pal.stoneLight);        // brilho no topo
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(ox2 + up.x * lod * 0.12, oy2 + up.y * lod * 0.12, Math.max(1, lod * 0.07), 0, 7);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else if (key === 'water') {
      if (lod < 1.5) continue;
      const depth = sea - eN;
      const surfY = (sea * amp - h0 - fr.altV) / zoom;
      const sx2 = W / 2 + up.x * surfY + perp.x * relX;
      const sy2 = H / 2 + up.y * surfY + perp.y * relX;
      if (depth < 0.02) {                          // espuma na beira d'água
        const fw = (0.7 + rnd() * 1.2) * lod;
        const fh = Math.max(1.2, lod * 0.12);
        ctx.globalAlpha = 0.4 + 0.3 * Math.sin(t * 2.6 + k * 0.9);
        ctx.fillStyle = rgbS(pal.foam);
        ctx.beginPath();
        ctx.ellipse(sx2, sy2, Math.max(0.1, fw / 2), Math.max(0.1, fh), 0, 0, 7);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else if (depth < 0.3) {                    // ondinha que corre
        const dyp = (0.15 + rnd() * 0.5) * lod;
        const wx = sx2 + Math.sin(t * 1.4 + k * 0.7) * lod * 0.3;
        const len = (0.4 + rnd() * 0.9) * lod;
        ctx.strokeStyle = 'rgba(215,240,250,' + (0.12 + 0.1 * Math.sin(t * 2 + k * 1.9)).toFixed(3) + ')';
        ctx.lineWidth = Math.max(1, lod * 0.05);
        ctx.beginPath();
        ctx.moveTo(wx - perp.x * len / 2 - up.x * dyp, sy2 - perp.y * len / 2 - up.y * dyp);
        ctx.lineTo(wx + perp.x * len / 2 - up.x * dyp, sy2 + perp.y * len / 2 - up.y * dyp);
        ctx.stroke();
      }
    }
  }
}

// último recurso: chão liso neutro (só usado se algo inesperado acontecer)
function drawFlatGround(ctx, W, H) {
  const hy = H * 0.62;
  const g = ctx.createLinearGradient(0, hy, 0, H);
  g.addColorStop(0, 'rgb(96,132,72)');
  g.addColorStop(1, 'rgb(58,78,46)');
  ctx.fillStyle = g;
  ctx.fillRect(0, hy, W, H - hy);
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
