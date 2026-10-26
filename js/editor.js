// editor.js — the Vehicle Assembly Building: palette, stack construction,
// staging preview and live delta-v / TWR / cost readouts.

import { PARTS, partsForTier, partCategory, TECH_TIERS } from './parts.js';
import { BODIES, surfaceGravity } from './universe.js';
import * as V from './vessel.js';
import { drawRocket } from './render.js';

export const editor = {
  design: V.newDesign(),
  selected: -1,        // selected stack index
  undoStack: [],
  zoom: 26,            // px per meter
  panY: 0,
};

const $ = id => document.getElementById(id);

export function pushUndo() {
  editor.undoStack.push(JSON.stringify(editor.design));
  if (editor.undoStack.length > 40) editor.undoStack.shift();
}

export function undo() {
  const s = editor.undoStack.pop();
  if (s) { editor.design = JSON.parse(s); editor.selected = -1; refreshEditorUI(); }
}

// ---------- part placement ----------
// Returns a message string on failure, null on success.
export function addPart(pid) {
  const p = PARTS[pid];
  const d = editor.design;
  const stack = d.stack;

  if (p.radialOnly) {
    if (!stack.length) return 'Add a command pod first.';
    let idx = editor.selected >= 0 ? editor.selected : bestRadialHost(stack);
    if (idx < 0) return 'Select a core part (like a tank) to attach this to.';
    pushUndo();
    stack[idx].radials.push(pid);
    return null;
  }

  if (p.type === 'pod') {
    if (stack.some(s => PARTS[s.pid].type === 'pod')) return 'Only one command part per rocket (for now).';
    pushUndo();
    stack.unshift({ pid, radials: [] });
    editor.selected = -1;
    return null;
  }

  if (!stack.length) return 'Start with a command pod — someone has to fly this thing.';

  if (p.type === 'parachute' || p.type === 'nosecone') {
    pushUndo();
    stack.unshift({ pid, radials: [] });
    return null;
  }

  if (p.type === 'srb' && editor.selected >= 0 && PARTS[stack[editor.selected].pid].type !== 'decoupler') {
    // SRB onto a selected part = radial booster pair
    pushUndo();
    stack[editor.selected].radials.push(pid);
    return null;
  }

  // stack parts: insert below selection, or at the bottom
  pushUndo();
  const at = editor.selected >= 0 ? editor.selected + 1 : stack.length;
  stack.splice(at, 0, { pid, radials: [] });
  if (editor.selected >= 0) editor.selected = at;
  return null;
}

function bestRadialHost(stack) {
  // prefer the lowest tank; fall back to the bottom part
  for (let i = stack.length - 1; i >= 0; i--) {
    if (PARTS[stack[i].pid].type === 'tank') return i;
  }
  return stack.length - 1;
}

export function removeSelected() {
  const d = editor.design;
  if (editor.selected < 0 || editor.selected >= d.stack.length) return;
  pushUndo();
  const s = d.stack[editor.selected];
  if (s.radials.length) s.radials.pop();  // strip radials first, one pair at a time
  else d.stack.splice(editor.selected, 1);
  if (editor.selected >= d.stack.length) editor.selected = d.stack.length - 1;
  refreshEditorUI();
}

export function clearDesign() {
  pushUndo();
  editor.design = V.newDesign();
  editor.selected = -1;
  refreshEditorUI();
}

// ---------- canvas ----------
export function renderEditor(ctx, W, H, time) {
  ctx.fillStyle = '#0d1017';
  ctx.fillRect(0, 0, W, H);
  // grid
  ctx.strokeStyle = 'rgba(90,110,150,0.09)';
  ctx.lineWidth = 1;
  const g = 40;
  for (let x = (W / 2) % g; x < W; x += g) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = (H / 2) % g; y < H; y += g) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  const stack = editor.design.stack;
  if (!stack.length) {
    ctx.fillStyle = 'rgba(200,215,240,0.45)';
    ctx.font = '15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Pick a command pod from the parts list to begin', W / 2, H / 2);
    ctx.textAlign = 'left';
    return;
  }

  const fstack = V.makeFlightStack(editor.design);
  const geom = V.stackGeometry(fstack);
  // auto-fit zoom
  const fit = (H * 0.7) / Math.max(geom.height, 4);
  const S = Math.min(editor.zoom, fit);
  const cx = W / 2, cy = H / 2 + editor.panY;

  ctx.save();
  ctx.translate(cx, cy);
  drawRocket(ctx, fstack, S, { showFlames: false, time });
  ctx.restore();

  // selection highlight + section boundaries
  const sections = V.computeSections(fstack);
  stack.forEach((s, i) => {
    const p = PARTS[s.pid];
    const y = cy - geom.offsets[i] * S;
    if (i === editor.selected) {
      let w = p.w;
      for (const r of s.radials) w += PARTS[r].w * 2;
      ctx.strokeStyle = '#7fd4ff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(cx - (w / 2) * S - 5, y - (p.h / 2) * S - 3, w * S + 10, p.h * S + 6);
      ctx.setLineDash([]);
    }
    if (p.type === 'decoupler') {
      ctx.strokeStyle = 'rgba(242,182,50,0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(cx - 90, y - (p.h / 2) * S);
      ctx.lineTo(cx + 90, y - (p.h / 2) * S);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });

  // CoM marker
  const comY = cy - geom.com * S;
  ctx.strokeStyle = '#f2b632'; ctx.fillStyle = '#f2b632';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx - Math.max(...stack.map(s => PARTS[s.pid].w)) * S / 2 - 26, comY, 6, 0, 7); ctx.stroke();
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillText('CoM', cx - Math.max(...stack.map(s => PARTS[s.pid].w)) * S / 2 - 44, comY + 3);
}

// Which stack part is at canvas point (mx, my)?
export function pickPart(mx, my, W, H) {
  const stack = editor.design.stack;
  if (!stack.length) return -1;
  const fstack = V.makeFlightStack(editor.design);
  const geom = V.stackGeometry(fstack);
  const fit = (H * 0.7) / Math.max(geom.height, 4);
  const S = Math.min(editor.zoom, fit);
  const cx = W / 2, cy = H / 2 + editor.panY;
  for (let i = 0; i < stack.length; i++) {
    const p = PARTS[stack[i].pid];
    let w = p.w;
    for (const r of stack[i].radials) w += PARTS[r].w * 2;
    const y = cy - geom.offsets[i] * S;
    if (mx > cx - (w / 2) * S - 6 && mx < cx + (w / 2) * S + 6 &&
        my > y - (p.h / 2) * S && my < y + (p.h / 2) * S) return i;
  }
  return -1;
}

// ---------- DOM panels ----------
let onPaletteClick = null;
export function initEditorUI(game, paletteClickHandler) {
  onPaletteClick = paletteClickHandler;
  buildPalette(game);
}

export function buildPalette(game) {
  const pal = $('palette');
  pal.innerHTML = '';
  const cats = {};
  for (const p of Object.values(PARTS)) {
    const cat = partCategory(p);
    (cats[cat] = cats[cat] || []).push(p);
  }
  for (const [cat, parts] of Object.entries(cats)) {
    const h = document.createElement('div');
    h.className = 'pal-cat';
    h.textContent = cat;
    pal.appendChild(h);
    for (const p of parts) {
      const locked = p.tier > game.maxTier();
      const el = document.createElement('div');
      el.className = 'pal-part' + (locked ? ' locked' : '');
      el.innerHTML = `
        <div class="pp-name">${p.name}${locked ? ' 🔒' : ''}</div>
        <div class="pp-meta">${partMeta(p)}</div>
        <div class="pp-desc">${locked ? `Unlock: ${TECH_TIERS[p.tier].name} (R&D)` : p.desc}</div>
        <div class="pp-cost">$${p.cost}</div>`;
      if (!locked) el.addEventListener('click', () => onPaletteClick && onPaletteClick(p.id));
      pal.appendChild(el);
    }
  }
}

function partMeta(p) {
  const bits = [`${(p.mass + (p.fuel || 0)).toFixed(2)} t`];
  if (p.thrust) bits.push(`${p.thrust} kN`, `Isp ${p.isp}s`);
  if (p.fuel && !p.thrust) bits.push(`${p.fuel} t fuel`);
  if (p.dragArea) bits.push('chute');
  if (p.torque) bits.push(`torque ${p.torque}`);
  if (p.sciBonus) bits.push(`+${p.sciBonus * 100}% sci`);
  return bits.join(' · ');
}

export function refreshEditorUI() {
  const d = editor.design;
  const fstack = V.makeFlightStack(d);
  const g = surfaceGravity(BODIES.gaia);
  const { stages, totalDv } = V.analyzeDesign(d, g);
  const mass = V.stackMass(fstack);
  const cost = V.designCost(d);

  $('stat-mass').textContent = mass.toFixed(2) + ' t';
  $('stat-height').textContent = V.stackHeight(fstack).toFixed(1) + ' m';
  $('stat-cost').textContent = '$' + cost.toLocaleString();
  $('stat-dv').textContent = Math.round(totalDv).toLocaleString() + ' m/s';

  const stEl = $('stage-list');
  stEl.innerHTML = '';
  if (!stages.length) {
    stEl.innerHTML = '<div class="stage-row muted">No engines yet</div>';
  }
  stages.forEach(s => {
    const row = document.createElement('div');
    row.className = 'stage-row';
    const twrBad = s.twr < 1 ? ' style="color:#f0685a"' : '';
    row.innerHTML = `<b>${s.label}</b>
      <span>Δv ${Math.round(s.deltaV)} m/s</span>
      <span${twrBad}>TWR ${s.twr.toFixed(2)}</span>
      <span>${s.burnTime.toFixed(0)}s</span>`;
    stEl.appendChild(row);
  });

  // warnings
  const warn = [];
  if (d.stack.length) {
    if (!V.designHasType(d, 'pod')) warn.push('No command pod — nobody is flying this.');
    if (!V.designHasType(d, 'engine') && !V.designHasType(d, 'srb')) warn.push('No engines. Gravity wins by default.');
    if (!V.designHasType(d, 'parachute')) warn.push('No parachute — landing will be “memorable”.');
    if (stages.length && stages[0].twr < 1.05) warn.push('Liftoff TWR below 1 — it will not leave the pad.');
    if (V.totalFinArea(fstack) === 0 && (V.designHasType(d, 'engine') || V.designHasType(d, 'srb')))
      warn.push('No fins — expect wobble. SAS can only do so much.');
  }
  $('warnings').innerHTML = warn.map(w => `<div class="warn">⚠ ${w}</div>`).join('');
}
