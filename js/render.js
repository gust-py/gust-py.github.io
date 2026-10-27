@@
 function drawFlame(ctx, w, h, S, power, time, color1 = '#ffb143', color2 = '#fff7d6', opts = {}) {
   const p = clampN(power, 0, 1.4);
   if (p <= 0.001 || !(w > 0) || !(h > 0) || !(S > 0)) return;
   const atmoF = clampN(opts.atmoF === undefined ? 1 : opts.atmoF, 0, 1);
   const c1 = hexRGBc(color1);
   const c2 = hexRGBc(color2);
-  const cDeep = mulC(c1, 0.6);                        // laranja profundo no rabinho
-  const cRed = mixC(mulC(c1, 0.4), [64, 16, 8], 0.3); // fim esfriando: vermelho escuro
-  const cHot = mixC(c2, [255, 255, 255], 0.55);       // ponto quente branco
+  const cDeep = mulC(c1, 0.56);
+  const cRed = mixC(mulC(c1, 0.4), [64, 16, 8], 0.3);
+  const cHot = mixC(c2, [255, 255, 255], 0.6);
 
   const flick = 1 + 0.05 * Math.sin(time * 31) + 0.035 * Math.sin(time * 57 + 1.7)
                + 0.025 * Math.sin(time * 23 + 0.6);
-  const vac = Math.pow(1 - atmoF, 1.5);               // 0 no mar → 1 no vácuo
-  const expand = 1 + 2.1 * vac;                       // leque no vácuo
-  const len = h * (1.3 + 3.9 * p) * flick * S * (1 + 0.75 * vac);
+  const vac = Math.pow(1 - atmoF, 1.5);
+  const expand = 1 + 2.6 * vac;
+  const len = h * (1.6 + 4.8 * p) * flick * S * (1 + 0.9 * vac);
   if (!Number.isFinite(len) || len <= 0) return;
-  const w0 = w * 0.38 * S;                            // meia-largura na saída
-  const wEnd = w0 * (1.35 + 0.55 * p) * expand * (1 + 0.035 * Math.sin(time * 44 + 2.1));
+  const w0 = w * 0.46 * S;
+  const wEnd = w0 * (1.5 + 0.7 * p) * expand * (1 + 0.06 * Math.sin(time * 44 + 2.1));
@@
-  const aMul = 0.55 + 0.45 * atmoF; // no vácuo a pluma difunde um pouco
+  const aMul = 0.7 + 0.5 * atmoF;
@@
-  const NP = 44;
+  const NP = 62;
   for (let i = 0; i < NP; i++) {
@@
-    const vel = (0.8 + 0.45 * h1) * (0.85 + 0.35 * p);
+    const vel = (1.0 + 0.6 * h1) * (0.95 + 0.45 * p);
     const age = (time * vel + i / NP + h2) % 1;
     const yFrac = age * (0.8 + 0.25 * h1) + 0.17 * age * age; // acelera na queda
     const y = yFrac * len * (0.92 + 0.2 * h3);
-    const spread = w0 * 0.85 + (wEnd - w0 * 0.85) * Math.pow(age, 0.78);
+    const spread = w0 * 0.9 + (wEnd - w0 * 0.9) * Math.pow(age, 0.7);
     const dx = Math.sin(age * Math.PI * (2.1 + h2 * 3.1) + h1 * 9.4) * spread * (0.2 + 0.2 * age)
              + (h2 - 0.5) * spread * 0.7;
-    const r = (w0 * 0.44 + spread * 0.72) * (0.34 + 0.9 * age) * (0.85 + 0.3 * h3);
+    const r = (w0 * 0.5 + spread * 0.8) * (0.36 + 0.9 * age) * (0.95 + 0.3 * h3);
     const env = age < 0.1 ? age / 0.1 : 1 - Math.pow((age - 0.1) / 0.9, 1.4);
-    const a = 0.34 * aMul * Math.max(0, env);
+    const a = 0.42 * aMul * Math.max(0, env);
     const col = age < 0.28 ? mixC(c2, c1, age / 0.28)
                : age < 0.6 ? mixC(c1, cDeep, (age - 0.28) / 0.32)
                : mixC(cDeep, cRed, (age - 0.6) / 0.4);
     puff(dx, y, r, col, a);
   }
 
   // 3) FAÍSCAS: pontos pequenos, RÁPIDOS e brilhantes voando dentro da pluma
-  const NS = 30;
+  const NS = 38;
   for (let i = 0; i < NS; i++) {
@@
-    const vel = (1.5 + 0.9 * h1) * (0.85 + 0.3 * p);
+    const vel = (1.8 + 1.1 * h1) * (1.0 + 0.35 * p);
     const age = (time * vel + h2) % 1;
     const y = (age * (0.85 + 0.3 * h1) + 0.3 * age * age) * len * (0.55 + 0.4 * h3);
-    const spread = w0 * (0.45 + 1.25 * age) * (1 + 0.55 * vac);
+    const spread = w0 * (0.55 + 1.35 * age) * (1 + 0.7 * vac);
     const dx = Math.sin(age * Math.PI * (3 + h2 * 4) + h1 * 12) * spread * 0.35
              + (h2 - 0.5) * spread * 0.85;
-    const r = Math.max(0.5, w0 * (0.09 + 0.15 * h3) * (1.05 - age * 0.5)) * (1 + 0.4 * vac);
+    const r = Math.max(0.6, w0 * (0.11 + 0.18 * h3) * (1.08 - age * 0.55)) * (1 + 0.45 * vac);
     const env = age < 0.07 ? age / 0.07 : 1 - age;
-    const a = 0.8 * Math.max(0, env) * (0.45 + 0.55 * atmoF);
+    const a = 0.96 * Math.max(0, env) * (0.52 + 0.58 * atmoF);
     const col = age < 0.3 ? mixC([255, 255, 246], c1, age / 0.3) : mixC(c1, cDeep, (age - 0.3) / 0.7);
     puff(dx, y, r, col, a);
   }
@@
-  const lenC = len * (0.58 + 0.18 * atmoF);
+  const lenC = len * (0.66 + 0.2 * atmoF);
@@
-  const rHot = w0 * (1.05 + 0.12 * Math.sin(time * 44 + 2.1));
+  const rHot = w0 * (1.15 + 0.15 * Math.sin(time * 44 + 2.1));
@@
   const toScreen = (wx, wy) => [
     W / 2 + (wx - flight.pos.x) / zoom,
     H / 2 - (wy - flight.pos.y) / zoom,
   ];
@@
-  const skyF = body.rho0 ? Math.pow(rho / body.rho0, 0.35) : 0;
-  const sky = bodyLook(body).sky || [220, 160, 120];
+  const skyF = body.rho0 ? Math.pow(rho / body.rho0, 0.35) : 0;
+  const sky = bodyLook(body).sky || [220, 160, 120];
   const spaceC = [8, 10, 18];
   const lerp3 = (a, b2, tt) => a.map((c, i) => Math.round(c + (b2[i] - c) * tt));
-  const zen = lerp3(spaceC, sky.map((c) => c * 0.78), skyF);           // topo
-  const hor = lerp3(spaceC, lerp3(sky, [255, 246, 228], 0.24), skyF);  // horizonte
+  const zen = lerp3(spaceC, sky.map((c) => c * 0.78), skyF);
+  const hor = lerp3(sky, [255, 170, 96], 0.82 + skyF * 0.7);
   const bg = hor;
   const gSky = ctx.createLinearGradient(0, 0, 0, H);
-  gSky.addColorStop(0, `rgb(${zen[0]},${zen[1]},${zen[2]})`);
-  gSky.addColorStop(1, `rgb(${hor[0]},${hor[1]},${hor[2]})`);
+  gSky.addColorStop(0, `rgb(${zen[0]},${zen[1]},${zen[2]})`);
+  gSky.addColorStop(0.45, `rgb(${lerp3(zen, sky, 0.5)[0]},${lerp3(zen, sky, 0.5)[1]},${lerp3(zen, sky, 0.5)[2]})`);
+  gSky.addColorStop(1, `rgb(${hor[0]},${hor[1]},${hor[2]})`);
   ctx.fillStyle = gSky;
   ctx.fillRect(0, 0, W, H);
+
+  const glow = ctx.createRadialGradient(W * 0.52, H * 0.76, 30, W * 0.52, H * 0.76, H * 0.8);
+  glow.addColorStop(0, 'rgba(255, 202, 130, 0.22)');
+  glow.addColorStop(0.3, 'rgba(255, 118, 36, 0.16)');
+  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
+  ctx.fillStyle = glow;
+  ctx.fillRect(0, 0, W, H);
 
   drawStars(ctx, W, H, num(flight.pos.x / zoom), num(-flight.pos.y / zoom), 1 - skyF);
