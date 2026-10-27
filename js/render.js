function drawFlame(ctx, w, h, S, power, time, color1 = '#ffb143', color2 = '#fff7d6', opts = {}) {
  const p = clampN(power, 0, 1.4);
  if (p <= 0.001 || !(w > 0) || !(h > 0) || !(S > 0)) return;
  const atmoF = clampN(opts.atmoF === undefined ? 1 : opts.atmoF, 0, 1);
  const c1 = hexRGBc(color1);
  const c2 = hexRGBc(color2);
  const cDeep = mulC(c1, 0.56);
  const cRed = mixC(mulC(c1, 0.4), [64, 16, 8], 0.3);
  const cHot = mixC(c2, [255, 255, 255], 0.6);

  const flick = 1 + 0.05 * Math.sin(time * 31) + 0.035 * Math.sin(time * 57 + 1.7)
               + 0.025 * Math.sin(time * 23 + 0.6);
  const vac = Math.pow(1 - atmoF, 1.5);
  const expand = 1 + 2.6 * vac;
  const len = h * (1.6 + 4.8 * p) * flick * S * (1 + 0.9 * vac);
  if (!Number.isFinite(len) || len <= 0) return;
  const w0 = w * 0.46 * S;
  const wEnd = w0 * (1.5 + 0.7 * p) * expand * (1 + 0.06 * Math.sin(time * 44 + 2.1));

  const cone = (wa, wb, fill) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(-wa, 0);
    ctx.bezierCurveTo(-wa - (wb - wa) * 0.12, len * 0.5, -wb, len * 0.85, -wb * 0.92, len * 0.92);
    ctx.quadraticCurveTo(-wb * 0.55, len * 1.04, 0, len * 1.04);
    ctx.quadraticCurveTo(wb * 0.55, len * 1.04, wb * 0.92, len * 0.92);
    ctx.bezierCurveTo(wb, len * 0.85, wa + (wb - wa) * 0.12, len * 0.5, wa, 0);
    ctx.closePath();
    ctx.fill();
  };

  const grad = (stops) => {
    const g = ctx.createLinearGradient(0, 0, 0, len);
    for (const s of stops) g.addColorStop(s[0], colA(s[1], s[2]));
    return g;
  };

  const aMul = 0.7 + 0.5 * atmoF;

  const puff = (x, y, r, col, a) => {
    if (!(r > 0.4) || !(a > 0.005)) return;
    if (r < 2.2) {
      ctx.fillStyle = colA(col, Math.min(1, a));
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      return;
    }
    const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
    g.addColorStop(0, colA(col, Math.min(1, a)));
    g.addColorStop(0.6, colA(col, Math.min(1, a) * 0.5));
    g.addColorStop(1, colA(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  };

  const hsh = (i, k) => {
    let x = (i * 2654435761 + k * 2246822519 + 101) >>> 0;
    x = Math.imul(x ^ (x >>> 15), 2654435761) >>> 0;
    return (((x ^ (x >>> 13)) >>> 8) % 1000) / 1000;
  };

  cone(w0 * 1.5, wEnd * 1.45,
    grad([[0, c1, 0.15 * aMul], [0.5, cDeep, 0.10 * aMul], [1, cDeep, 0]]));

  cone(w0, wEnd,
    grad([[0, c2, 0.5 * aMul], [0.35, c1, 0.4 * aMul], [0.75, cDeep, 0.2 * aMul], [1, cDeep, 0]]));

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  const NP = 62;
  for (let i = 0; i < NP; i++) {
    const h1 = hsh(i, 1), h2 = hsh(i, 2), h3 = hsh(i, 3);
    const vel = (1.0 + 0.6 * h1) * (0.95 + 0.45 * p);
    const age = (time * vel + i / NP + h2) % 1;
    const yFrac = age * (0.8 + 0.25 * h1) + 0.17 * age * age;
    const y = yFrac * len * (0.92 + 0.2 * h3);
    const spread = w0 * 0.9 + (wEnd - w0 * 0.9) * Math.pow(age, 0.7);
    const dx = Math.sin(age * Math.PI * (2.1 + h2 * 3.1) + h1 * 9.4) * spread * (0.2 + 0.2 * age)
             + (h2 - 0.5) * spread * 0.7;
    const r = (w0 * 0.5 + spread * 0.8) * (0.36 + 0.9 * age) * (0.95 + 0.3 * h3);
    const env = age < 0.1 ? age / 0.1 : 1 - Math.pow((age - 0.1) / 0.9, 1.4);
    const a = 0.42 * aMul * Math.max(0, env);
    const col = age < 0.28 ? mixC(c2, c1, age / 0.28)
              : age < 0.6 ? mixC(c1, cDeep, (age - 0.28) / 0.32)
              : mixC(cDeep, cRed, (age - 0.6) / 0.4);
    puff(dx, y, r, col, a);
  }

  const NS = 38;
  for (let i = 0; i < NS; i++) {
    const h1 = hsh(i + 71, 1), h2 = hsh(i + 71, 2), h3 = hsh(i + 71, 3);
    const vel = (1.8 + 1.1 * h1) * (1.0 + 0.35 * p);
    const age = (time * vel + h2) % 1;
    const y = (age * (0.85 + 0.3 * h1) + 0.3 * age * age) * len * (0.55 + 0.4 * h3);
    const spread = w0 * (0.55 + 1.35 * age) * (1 + 0.7 * vac);
    const dx = Math.sin(age * Math.PI * (3 + h2 * 4) + h1 * 12) * spread * 0.35
             + (h2 - 0.5) * spread * 0.85;
    const r = Math.max(0.6, w0 * (0.11 + 0.18 * h3) * (1.08 - age * 0.55)) * (1 + 0.45 * vac);
    const env = age < 0.07 ? age / 0.07 : 1 - age;
    const a = 0.96 * Math.max(0, env) * (0.52 + 0.58 * atmoF);
    const col = age < 0.3 ? mixC([255, 255, 246], c1, age / 0.3) : mixC(c1, cDeep, (age - 0.3) / 0.7);
    puff(dx, y, r, col, a);
  }

  const lenC = len * (0.66 + 0.2 * atmoF);
  const gC = ctx.createLinearGradient(0, 0, 0, lenC);
  gC.addColorStop(0, colA(mixC(c2, [255, 255, 255], 0.6), 0.95 * aMul));
  gC.addColorStop(0.4, colA(c2, 0.85 * aMul));
  gC.addColorStop(0.75, colA(c1, 0.45 * aMul));
  gC.addColorStop(1, colA(c1, 0));
  ctx.fillStyle = gC;
  ctx.beginPath();
  ctx.moveTo(-w0 * 0.55, 0);
  ctx.bezierCurveTo(-w0 * 0.5, lenC * 0.5, -w0 * 0.34, lenC * 0.82, 0, lenC);
  ctx.bezierCurveTo(w0 * 0.34, lenC * 0.82, w0 * 0.5, lenC * 0.5, w0 * 0.55, 0);
  ctx.closePath();
  ctx.fill();

  const rHot = w0 * (1.15 + 0.15 * Math.sin(time * 44 + 2.1));
  const gHot = ctx.createRadialGradient(0, h * 0.05 * S, rHot * 0.08, 0, h * 0.05 * S, rHot);
  gHot.addColorStop(0, colA(cHot, 1));
  gHot.addColorStop(0.55, colA(c2, 0.55));
  gHot.addColorStop(1, colA(c2, 0));
  ctx.fillStyle = gHot;
  ctx.beginPath();
  ctx.arc(0, h * 0.05 * S, rHot, 0, 7);
  ctx.fill();

  ctx.restore();
}

// Draws a flight stack (or design stack converted via makeFlightStack).
// opts: { throttle, showFlames, time }
export function drawRocket(ctx, stack, S, opts = {}) {
  if (!stack.length) return;
  const geom = V.stackGeometry(stack);
  const t = opts.time || 0;

  if (opts.showFlames) {
    stack.forEach((s, i) => {
      const p = PARTS[s.pid];
      const y = -geom.offsets[i] * S;
      const flamePower = opts.reentryPower ?? opts.throttle ?? 0;
      if (p.type === 'engine' && s.ignited && flamePower > 0 && (opts.hasFuel !== false)) {
        if (!opts.fuelBySection || opts.fuelBySection[i] > 0) {
          ctx.save();
          ctx.translate(0, y + p.h * S / 2);
          const isNuke = p.isp > 500;
          drawFlame(ctx, p.w, p.h * 0.6, S, flamePower, t,
            isNuke ? '#7fb4ff' : '#ff7f26', isNuke ? '#e0f0ff' : '#ffe6c0',
            { atmoF: opts.atmoF, plasma: !!opts.plasma });
          ctx.restore();
        }
      }
      if (p.type === 'srb' && s.ignited && s.fuel > 0) {
        ctx.save();
        ctx.translate(0, y + p.h * S / 2);
        drawFlame(ctx, p.w, p.h * 0.45, S, 1, t, '#ff912e', '#ffefce', { atmoF: opts.atmoF, plasma: !!opts.plasma });
        ctx.restore();
      }
      for (const r of s.radials) {
        const rp = PARTS[r.pid];
        if (rp.type === 'srb' && r.ignited && r.fuel > 0) {
          const xOff = (p.w / 2 + rp.w / 2);
          for (const side of [-1, 1]) {
            ctx.save();
            ctx.translate(side * xOff * S, y + rp.h * S / 2);
            drawFlame(ctx, rp.w, rp.h * 0.45, S, 1, t, '#ff912e', '#ffefce', { atmoF: opts.atmoF, plasma: !!opts.plasma });
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
  return { zoom: 0.18 };
}
