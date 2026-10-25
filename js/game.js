// game.js — main loop, scenes, input, HUD, time warp, progression and saves.

import { BODIES } from './universe.js';
import { orbitFromState, stateAtTime } from './orbits.js';
import { PARTS, TECH_TIERS } from './parts.js';
import * as V from './vessel.js';
import * as PHY from './physics.js';
import { drawRocket, renderFlight, makeCamera } from './render.js';
import * as ED from './editor.js';
import * as MAP from './map.js';
import { detectEvents, awardFirsts, checkMissions, activeMissions, MISSIONS } from './missions.js';

const $ = id => document.getElementById(id);
const SAVE_KEY = 'orbit-or-bust-save-v1';
const WARPS = [1, 2, 4, 10, 50, 100, 1000, 10_000, 100_000];

export const game = {
  funds: 25_000,
  science: 0,
  techUnlocked: [0],
  firsts: [],
  missionsDone: [],
  launches: 0,
  t: 0,
  scene: 'editor',
  flight: null,
  savedCraft: {},
  maxTier() { return Math.max(...this.techUnlocked); },
};

let canvas, ctx, W, H;
const cam = makeCamera();
const keys = new Set();
let summaryShown = false;

// ---------- save / load ----------
function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      funds: game.funds, science: game.science, techUnlocked: game.techUnlocked,
      firsts: game.firsts, missionsDone: game.missionsDone, launches: game.launches,
      t: game.t, savedCraft: game.savedCraft, currentDesign: ED.editor.design,
    }));
  } catch (e) { /* storage may be unavailable */ }
}

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    Object.assign(game, {
      funds: s.funds ?? 25_000, science: s.science ?? 0,
      techUnlocked: s.techUnlocked ?? [0], firsts: s.firsts ?? [],
      missionsDone: s.missionsDone ?? [], launches: s.launches ?? 0,
      t: s.t ?? 0, savedCraft: s.savedCraft ?? {},
    });
    if (s.currentDesign && s.currentDesign.stack) ED.editor.design = s.currentDesign;
  } catch (e) { /* corrupt save: start fresh */ }
}

// ---------- toasts & modal ----------
function toast(html, cls = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + cls;
  el.innerHTML = html;
  $('toasts').appendChild(el);
  setTimeout(() => el.classList.add('show'), 20);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 5000);
}

function openModal(html) {
  $('modal-content').innerHTML = html;
  $('modal').classList.remove('hidden');
}
function closeModal() { $('modal').classList.add('hidden'); }

// ---------- launch / flight lifecycle ----------
function launch() {
  const d = ED.editor.design;
  if (!d.stack.length) return toast('Build a rocket first!', 'bad');
  if (!V.designHasType(d, 'pod')) return toast('You need a command pod or probe core.', 'bad');
  if (!V.designHasType(d, 'engine') && !V.designHasType(d, 'srb')) return toast('You need at least one engine.', 'bad');
  const cost = V.designCost(d);
  if (cost > game.funds) return toast(`Not enough funds: this costs $${cost.toLocaleString()}.`, 'bad');

  game.funds -= cost;
  game.launches++;
  PHY.clearWorld();
  MAP.clearNode();
  MAP.mapState.open = false;
  MAP.invalidateTrajectory();
  summaryShown = false;

  const stack = V.makeFlightStack(d);
  const geom = V.stackGeometry(stack);
  const bottomDist = geom.height / 2 + geom.com;
  game.flight = {
    bodyKey: 'gaia',
    pos: { x: 0, y: BODIES.gaia.radius + bottomDist },
    vel: { x: 0, y: 0 },
    angle: Math.PI / 2, angVel: 0, sasTarget: Math.PI / 2,
    stack, queue: V.buildStagingQueue(d.stack), queueIdx: 0,
    throttle: 0, sas: true, landed: true, destroyed: false,
    pitchInput: 0, warp: 1, railsOrbit: null,
    visited: ['gaia'], hasFlown: false, maxAlt: 0, maxSpd: 0,
    cost, tLaunch: game.t,
    gains: { sci: 0, missions: [] },
  };
  cam.zoom = 0.18;
  setScene('flight');
  toast(`<b>${d.name}</b> on the pad. Press <kbd>Space</kbd> to launch!`);
  saveGame();
}

function endFlight(title, lines, refund = 0) {
  if (refund > 0) game.funds += Math.round(refund);
  const f = game.flight;
  openModal(`
    <h2>${title}</h2>
    <div class="summary">
      ${lines.map(l => `<div>${l}</div>`).join('')}
      ${refund > 0 ? `<div>Recovered value: <b>+$${Math.round(refund).toLocaleString()}</b></div>` : ''}
      <div>Science gained this flight: <b>+${f.gains.sci}</b></div>
      ${f.gains.missions.length ? `<div>Missions completed: <b>${f.gains.missions.join(', ')}</b></div>` : ''}
      <div class="muted">Funds: $${game.funds.toLocaleString()} · Science: ${game.science}</div>
    </div>
    <button class="btn primary" id="modal-ok">Back to the VAB</button>`);
  $('modal-ok').onclick = () => { closeModal(); backToEditor(); };
  saveGame();
}

function backToEditor() {
  game.flight = null;
  PHY.clearWorld();
  MAP.clearNode();
  MAP.mapState.open = false;
  setScene('editor');
  ED.refreshEditorUI();
}

function revertFlight() {
  game.funds += game.flight.cost;
  toast('Reverted to the VAB. Launch cost refunded.');
  backToEditor();
  saveGame();
}

function recoverVessel() {
  const f = game.flight;
  const refund = V.stackValue(f.stack) * 0.8;
  endFlight('Vessel Recovered!', [
    `Touched down safely on ${BODIES[f.bodyKey].name}.`,
    `Peak altitude: ${MAP.fmtAlt(f.maxAlt)} · Top speed: ${f.maxSpd.toFixed(0)} m/s`,
  ], refund);
}

function terminateFlight() {
  endFlight('Flight Terminated', ['The vessel was abandoned to its fate. The interns wept.']);
}

// ---------- scenes ----------
function setScene(s) {
  game.scene = s;
  document.body.className = 'scene-' + s + (MAP.mapState.open ? ' map-open' : '');
}
function refreshBodyClass() {
  document.body.className = 'scene-' + game.scene + (MAP.mapState.open ? ' map-open' : '');
}

// ---------- warp ----------
function setWarpIndex(i) {
  const f = game.flight;
  if (!f) return;
  i = Math.max(0, Math.min(WARPS.length - 1, i));
  let w = WARPS[i];
  const body = BODIES[f.bodyKey];
  const alt = PHY.altitudeOf(f);
  if (w > 4) {
    if (!f.landed && alt < (body.atmoHeight || 0) + 5000) {
      toast('Cannot rails-warp this low — climb above the atmosphere.', 'bad');
      w = Math.min(w, 4);
    } else if (f.thrustNow > 0 && !f.landed) {
      toast('Cut the throttle before high time warp.', 'bad');
      w = Math.min(w, 4);
    }
  }
  f.warp = w;
  if (w > 4 && !f.landed) {
    f.railsOrbit = orbitFromState(body.mu, f.pos.x, f.pos.y, f.vel.x, f.vel.y, game.t);
  } else {
    f.railsOrbit = null;
  }
  $('hud-warp').textContent = w > 1 ? `${w.toLocaleString()}×` : '1×';
}
function warpStep(dir) {
  const f = game.flight;
  if (!f) return;
  const i = WARPS.indexOf(f.warp);
  setWarpIndex(i + dir);
}

// ---------- update ----------
let evTimer = 0, trajTimer = 0, hudTimer = 0, autosaveTimer = 0;

function update(dtReal) {
  if (game.scene !== 'flight' || !game.flight) return;
  const f = game.flight;

  // continuous controls
  f.pitchInput = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) +
                 (keys.has('KeyD') || keys.has('ArrowRight') ? -1 : 0);
  if (keys.has('ShiftLeft') || keys.has('ShiftRight')) f.throttle = Math.min(1, f.throttle + dtReal * 0.7);
  if (keys.has('ControlLeft') || keys.has('ControlRight')) f.throttle = Math.max(0, f.throttle - dtReal * 0.7);

  if (f.warp > 4) {
    // on-rails
    game.t += dtReal * f.warp;
    if (!f.landed && f.railsOrbit) {
      const s = stateAtTime(f.railsOrbit, game.t);
      f.pos.x = s.x; f.pos.y = s.y; f.vel.x = s.vx; f.vel.y = s.vy;
      if (PHY.checkSOI(f, game.t)) {
        const body = BODIES[f.bodyKey];
        f.railsOrbit = orbitFromState(body.mu, f.pos.x, f.pos.y, f.vel.x, f.vel.y, game.t);
        MAP.invalidateTrajectory();
        toast(`Entered the sphere of influence of <b>${body.name}</b>.`);
      }
      const body = BODIES[f.bodyKey];
      const alt = PHY.altitudeOf(f);
      if (alt < (body.atmoHeight || 0) + 5000) {
        setWarpIndex(0);
        toast('Approaching atmosphere — dropping out of time warp.');
      }
    }
  } else if (!f.destroyed) {
    const dt = dtReal * f.warp;
    const n = Math.min(24, Math.max(1, Math.ceil(dt * 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      PHY.stepFlight(f, h, game.t);
      game.t += h;
      if (f.soiChanged) {
        f.soiChanged = false;
        MAP.invalidateTrajectory();
        toast(`Entered the sphere of influence of <b>${BODIES[f.bodyKey].name}</b>.`);
      }
      if (f.destroyed) break;
    }
  } else {
    game.t += dtReal;
  }

  PHY.stepDebris(dtReal * Math.min(f.warp, 4), game.t);
  PHY.stepParticles(dtReal);

  if (!f.visited.includes(f.bodyKey)) f.visited.push(f.bodyKey);
  if (!f.hasFlown && PHY.altitudeOf(f) > BODIES[f.bodyKey].atmoHeight * 0.001 + 200) f.hasFlown = true;

  // events, firsts, missions (4 Hz)
  evTimer += dtReal;
  if (evTimer > 0.25 && !f.destroyed) {
    evTimer = 0;
    const { events, alt, orbit } = detectEvents(f, game.t);
    const spd = PHY.surfaceSpeed(f);
    const newFirsts = awardFirsts(game, f, events, orbit);
    for (const nf of newFirsts) {
      f.gains.sci += nf.sci;
      toast(`🔬 <b>${nf.label}</b> +${nf.sci} science`, 'sci');
    }
    const done = checkMissions(game, { game, flight: f, events, alt, spd, orbit });
    for (const m of done) {
      f.gains.missions.push(m.name);
      toast(`✅ Mission complete: <b>${m.name}</b> +$${m.funds.toLocaleString()} +${m.sci} sci`, 'good');
      refreshMissionHud();
    }
    if (newFirsts.length || done.length) saveGame();
  }

  // trajectory cache refresh
  trajTimer += dtReal;
  if (trajTimer > 0.25) {
    trajTimer = 0;
    if (f.warp <= 4 && !f.landed) MAP.invalidateTrajectory();
    MAP.updateTrajectory(f, game.t);
  }

  // maneuver-node direction for the flight markers
  const ni = MAP.nodeWorldInfo();
  f.nodeDir = ni && ni.bodyKey === f.bodyKey ? ni.dirWorld : null;

  // destroyed -> summary
  if (f.destroyed && !summaryShown) {
    summaryShown = true;
    setTimeout(() => {
      endFlight('Rapid Unscheduled Disassembly', [
        `<b>${f.destroyReason || 'It broke.'}</b>`,
        `Peak altitude: ${MAP.fmtAlt(f.maxAlt)} · Top speed: ${f.maxSpd.toFixed(0)} m/s`,
        'Every crash is data. Mostly about what explodes.',
      ]);
    }, 1800);
  }

  hudTimer += dtReal;
  if (hudTimer > 0.1) { hudTimer = 0; updateHUD(); }

  autosaveTimer += dtReal;
  if (autosaveTimer > 30) { autosaveTimer = 0; saveGame(); }
}

// ---------- HUD ----------
function updateHUD() {
  const f = game.flight;
  if (!f) return;
  const body = BODIES[f.bodyKey];
  const alt = PHY.altitudeOf(f);
  const spd = PHY.surfaceSpeed(f);
  $('hud-alt').textContent = MAP.fmtAlt(alt);
  $('hud-spd').textContent = spd.toFixed(alt > 10000 ? 0 : 1) + ' m/s';
  $('hud-body').textContent = body.name + (f.landed ? ' (landed)' : '');

  const o = orbitFromState(body.mu, f.pos.x, f.pos.y, f.vel.x, f.vel.y, game.t);
  $('hud-ap').textContent = o.e < 1 ? MAP.fmtAlt(o.rAp - body.radius) : 'escape';
  $('hud-pe').textContent = MAP.fmtAlt(o.rPe - body.radius);

  const met = game.t - f.tLaunch;
  $('hud-met').textContent = 'T+' + fmtTime(met);

  $('thr-fill').style.height = (f.throttle * 100).toFixed(0) + '%';
  $('sas-ind').classList.toggle('on', f.sas);

  // fuel for the current bottom section
  const sections = V.computeSections(f.stack);
  let fuel = 0, cap = 0;
  if (sections.length) {
    const sec = sections[sections.length - 1];
    for (let i = sec.start; i <= sec.end; i++) {
      const p = PARTS[f.stack[i].pid];
      if (p.fuel) { fuel += f.stack[i].fuel; cap += p.fuel; }
      for (const r of f.stack[i].radials) {
        const rp = PARTS[r.pid];
        if (rp.fuel) { fuel += r.fuel * 2; cap += rp.fuel * 2; }
      }
    }
  }
  $('fuel-fill').style.height = cap > 0 ? (fuel / cap * 100).toFixed(0) + '%' : '0%';

  const next = f.queue[f.queueIdx];
  $('next-stage').textContent = next ? `Next: ${next.label}` : 'No stages left';

  $('btn-recover').classList.toggle('hidden', !(f.landed && f.bodyKey === 'gaia' && !f.destroyed));

  // node readout
  const n = MAP.mapState.node;
  const ni = MAP.nodeWorldInfo();
  $('node-hud').classList.toggle('hidden', !n);
  if (n && ni) {
    $('node-hud').textContent = `Node: ${ni.dvTotal.toFixed(0)} m/s in ${fmtTime(Math.max(0, n.t - game.t))}`;
  }

  if (MAP.mapState.open) updateMapInfo(o, body);
}

function updateMapInfo(o, body) {
  const parts = [];
  parts.push(`<b>${body.name}</b> orbit`);
  parts.push(`Ap: ${o.e < 1 ? MAP.fmtAlt(o.rAp - body.radius) : '— (escape)'}`);
  parts.push(`Pe: ${MAP.fmtAlt(o.rPe - body.radius)}`);
  if (o.period) parts.push(`Period: ${fmtTime(o.period)}`);
  parts.push(`e: ${o.e.toFixed(3)}`);
  $('map-info').innerHTML = parts.join('<br>');

  const n = MAP.mapState.node;
  $('node-panel').classList.toggle('hidden', !n);
  if (n) {
    $('node-pro').textContent = n.prograde.toFixed(1);
    $('node-rad').textContent = n.radial.toFixed(1);
    const ni = MAP.nodeWorldInfo();
    $('node-dv').textContent = ni ? ni.dvTotal.toFixed(1) + ' m/s' : '—';
    $('node-tt').textContent = fmtTime(Math.max(0, n.t - game.t));
  }
}

function fmtTime(s) {
  if (!isFinite(s)) return '—';
  s = Math.floor(s);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600),
        m = Math.floor((s % 3600) / 60), ss = s % 60;
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m ${ss}s`;
  if (m) return `${m}m ${ss}s`;
  return `${ss}s`;
}

function refreshTopbar() {
  $('funds').textContent = '$' + game.funds.toLocaleString();
  $('science').textContent = game.science + ' 🔬';
}

function refreshMissionHud() {
  const el = $('missions-hud');
  const act = activeMissions(game, 3);
  el.innerHTML = '<div class="mh-title">Missions</div>' + act.map(m =>
    `<div class="mh-item"><b>${m.name}</b><span>${m.desc}</span></div>`).join('');
}

// ---------- modals: R&D, missions, craft ----------
function openRnD() {
  const rows = TECH_TIERS.map(t => {
    const unlocked = game.techUnlocked.includes(t.id);
    const canBuy = !unlocked && game.science >= t.cost && game.techUnlocked.includes(t.id - 1);
    const parts = Object.values(PARTS).filter(p => p.tier === t.id).map(p => p.name).join(', ');
    return `<div class="tech ${unlocked ? 'unlocked' : ''}">
      <div><b>${t.name}</b> ${t.cost ? `— ${t.cost} 🔬` : ''}</div>
      <div class="muted">${t.blurb}</div>
      <div class="tech-parts">${parts}</div>
      ${unlocked ? '<div class="tag">UNLOCKED</div>' :
        `<button class="btn ${canBuy ? 'primary' : ''}" data-tier="${t.id}" ${canBuy ? '' : 'disabled'}>Unlock</button>`}
    </div>`;
  }).join('');
  openModal(`<h2>Research & Development</h2><div class="muted">You have ${game.science} 🔬 science.</div>${rows}
    <button class="btn" id="modal-close2">Close</button>`);
  $('modal-content').querySelectorAll('button[data-tier]').forEach(b => {
    b.onclick = () => {
      const tier = TECH_TIERS[+b.dataset.tier];
      if (game.science < tier.cost) return;
      game.science -= tier.cost;
      game.techUnlocked.push(tier.id);
      toast(`🔓 Unlocked <b>${tier.name}</b>!`, 'good');
      ED.buildPalette(game);
      refreshTopbar();
      saveGame();
      openRnD();
    };
  });
  $('modal-close2').onclick = closeModal;
}

function openMissions() {
  const rows = MISSIONS.map(m => {
    const done = game.missionsDone.includes(m.id);
    return `<div class="mission ${done ? 'done' : ''}">
      <b>${done ? '✅' : '◻'} ${m.name}</b>
      <span>${m.desc}</span>
      <span class="muted">+$${m.funds.toLocaleString()} · +${m.sci} 🔬</span>
    </div>`;
  }).join('');
  openModal(`<h2>Mission Board</h2>${rows}<button class="btn" id="modal-close2">Close</button>`);
  $('modal-close2').onclick = closeModal;
}

function openCraftManager() {
  const names = Object.keys(game.savedCraft);
  openModal(`<h2>Saved Craft</h2>
    <div class="craft-save-row">
      <input id="craft-save-name" placeholder="Craft name" value="${ED.editor.design.name}">
      <button class="btn primary" id="craft-save-btn">Save current</button>
    </div>
    ${names.length ? names.map(n =>
      `<div class="craft-row"><b>${n}</b>
        <span><button class="btn sm" data-load="${n}">Load</button>
        <button class="btn sm bad" data-del="${n}">Delete</button></span></div>`).join('')
      : '<div class="muted">No saved craft yet.</div>'}
    <button class="btn" id="modal-close2">Close</button>`);
  $('craft-save-btn').onclick = () => {
    const name = $('craft-save-name').value.trim() || 'Untitled Rocket';
    ED.editor.design.name = name;
    game.savedCraft[name] = JSON.parse(JSON.stringify(ED.editor.design));
    toast(`Saved <b>${name}</b>.`);
    saveGame();
    openCraftManager();
  };
  $('modal-content').querySelectorAll('[data-load]').forEach(b => b.onclick = () => {
    ED.pushUndo();
    ED.editor.design = JSON.parse(JSON.stringify(game.savedCraft[b.dataset.load]));
    ED.editor.selected = -1;
    ED.refreshEditorUI();
    closeModal();
    toast(`Loaded <b>${b.dataset.load}</b>.`);
  });
  $('modal-content').querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    delete game.savedCraft[b.dataset.del];
    saveGame();
    openCraftManager();
  });
}

// ---------- input ----------
function initInput() {
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    keys.add(e.code);
    const f = game.flight;
    if (game.scene === 'flight' && f) {
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          if (!f.destroyed) {
            const step = PHY.executeNextStage(f);
            if (step) { toast(`<b>${step.label}</b>`); MAP.invalidateTrajectory(); }
          }
          break;
        case 'KeyZ': f.throttle = 1; break;
        case 'KeyX': f.throttle = 0; break;
        case 'KeyT': f.sas = !f.sas; f.sasTarget = f.angle; break;
        case 'KeyM': toggleMap(); break;
        case 'Comma': warpStep(-1); break;
        case 'Period': warpStep(1); break;
        case 'Escape':
          if (MAP.mapState.open) toggleMap();
          else closeModal();
          break;
      }
    } else if (game.scene === 'editor') {
      if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) { ED.undo(); e.preventDefault(); }
      if (e.code === 'Delete' || e.code === 'Backspace') ED.removeSelected();
      if (e.code === 'Escape') closeModal();
    }
  });
  window.addEventListener('keyup', e => keys.delete(e.code));

  // canvas interactions
  let dragging = false, dragMoved = false, lastX = 0, lastY = 0;
  canvas.addEventListener('mousedown', e => {
    dragging = true; dragMoved = false;
    lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
    if (MAP.mapState.open) {
      MAP.mapState.panX -= dx * MAP.mapState.zoom;
      MAP.mapState.panY += dy * MAP.mapState.zoom;
      MAP.mapState.free = true;
    }
    lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener('mouseup', e => {
    if (!dragging) return;
    dragging = false;
    if (dragMoved) return;
    // click
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    if (game.scene === 'editor') {
      ED.editor.selected = ED.pickPart(mx, my, W, H);
    } else if (MAP.mapState.open && game.flight) {
      if (MAP.tryPlaceNode(mx, my, W, H, game.flight, game.t)) updateHUD();
    }
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const k = e.deltaY > 0 ? 1.25 : 0.8;
    if (game.scene === 'editor') {
      ED.editor.zoom = Math.max(4, Math.min(60, ED.editor.zoom / k));
    } else if (MAP.mapState.open) {
      MAP.mapState.zoom = Math.max(50, Math.min(5e8, MAP.mapState.zoom * k));
    } else {
      cam.zoom = Math.max(0.06, Math.min(8000, cam.zoom * k));
    }
  }, { passive: false });
}

function toggleMap() {
  MAP.mapState.open = !MAP.mapState.open;
  MAP.mapState.panX = 0; MAP.mapState.panY = 0; MAP.mapState.free = false;
  if (MAP.mapState.open && game.flight) {
    MAP.invalidateTrajectory();
    MAP.updateTrajectory(game.flight, game.t);
  }
  refreshBodyClass();
}

// node edit buttons
function nodeAdjust(field, amount) {
  const n = MAP.mapState.node;
  if (!n || !game.flight) return;
  n[field] += amount;
  MAP.updateNodeTrajectory(game.flight, game.t);
  updateHUD();
}

// ---------- buttons ----------
function initButtons() {
  $('btn-launch').onclick = launch;
  $('btn-undo').onclick = () => ED.undo();
  $('btn-remove').onclick = () => ED.removeSelected();
  $('btn-clear').onclick = () => { ED.clearDesign(); };
  $('btn-rnd').onclick = openRnD;
  $('btn-missions').onclick = openMissions;
  $('btn-craft').onclick = openCraftManager;
  $('btn-rnd2').onclick = openRnD;

  $('btn-stage').onclick = () => {
    const f = game.flight;
    if (f && !f.destroyed) {
      const step = PHY.executeNextStage(f);
      if (step) { toast(`<b>${step.label}</b>`); MAP.invalidateTrajectory(); }
    }
  };
  $('btn-map').onclick = toggleMap;
  $('btn-revert').onclick = revertFlight;
  $('btn-recover').onclick = recoverVessel;
  $('btn-terminate').onclick = terminateFlight;
  $('btn-warp-down').onclick = () => warpStep(-1);
  $('btn-warp-up').onclick = () => warpStep(1);

  $('node-pro-plus').onclick = () => nodeAdjust('prograde', 10);
  $('node-pro-minus').onclick = () => nodeAdjust('prograde', -10);
  $('node-pro-plus-sm').onclick = () => nodeAdjust('prograde', 1);
  $('node-pro-minus-sm').onclick = () => nodeAdjust('prograde', -1);
  $('node-rad-plus').onclick = () => nodeAdjust('radial', 10);
  $('node-rad-minus').onclick = () => nodeAdjust('radial', -10);
  $('node-del').onclick = () => { MAP.clearNode(); updateHUD(); };

  $('modal-close').onclick = closeModal;
  $('craft-name').addEventListener('change', e => {
    ED.editor.design.name = e.target.value || 'Untitled Rocket';
  });
}

// ---------- main loop ----------
let last = performance.now();
let frameCount = 0;

function tick(now) {
  const dtReal = Math.min(Math.max((now - last) / 1000, 0), 0.05);
  last = now;
  frameCount++;

  if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) resize();

  update(dtReal);

  if (game.scene === 'editor') {
    ED.renderEditor(ctx, W, H, now / 1000);
    if (frameCount % 20 === 0) refreshTopbar();
  } else if (game.flight) {
    if (MAP.mapState.open) {
      MAP.updateTrajectory(game.flight, game.t);
      MAP.renderMap(ctx, W, H, game.flight, game.t);
    } else {
      renderFlight(ctx, W, H, game.flight, cam, game.t);
    }
    if (frameCount % 20 === 0) refreshTopbar();
  }
}

function frame(now) {
  tick(now);
  requestAnimationFrame(frame);
}

function resize() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
}

// ---------- boot ----------
window.addEventListener('DOMContentLoaded', () => {
  canvas = $('game');
  ctx = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);

  loadGame();
  ED.initEditorUI(game, pid => {
    const err = ED.addPart(pid);
    if (err) toast(err, 'bad');
    else ED.refreshEditorUI();
  });
  $('craft-name').value = ED.editor.design.name;
  ED.refreshEditorUI();
  refreshTopbar();
  refreshMissionHud();
  initInput();
  initButtons();
  setScene('editor');
  window.addEventListener('beforeunload', saveGame);
  window.__oobTick = tick; // manual frame driver (debug/testing)
  window.__oob = { game, MAP, PHY, V, ED }; // console debug handle

  if (!localStorage.getItem(SAVE_KEY)) {
    toast('Welcome to <b>Orbit or Bust!</b> Build a rocket, then hit LAUNCH. 🚀');
  }
  requestAnimationFrame(frame);

  // Keep simulating when the tab is hidden (rAF is paused there).
  setInterval(() => {
    if (!document.hidden) return;
    const now = performance.now();
    const dtReal = Math.min((now - last) / 1000, 0.6);
    last = now;
    update(dtReal);
  }, 250);
});
