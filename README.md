# 🚀 Orbit or Bust!

**Build rockets. Fight gravity. Explore a tiny solar system. Explode educationally.**

A Kerbal Space Program-inspired 2D space-program game that runs entirely in your browser —
no installs, no build step, no dependencies. Pure JavaScript + HTML5 Canvas.

**▶ Play it here: https://starlordz12.github.io/orbit-or-bust/**

---

## What you do

```
Choose a mission
      ↓
Design a vehicle in the VAB
      ↓
Check your Δv, TWR and staging
      ↓
Launch and fly it
      ↓
Reach orbit or crash spectacularly
      ↓
Understand the failure
      ↓
Redesign and try again
```

## Features

- **Vehicle Assembly** — 21 parts across 4 tech tiers: pods, tanks, engines, solid boosters,
  decouplers, parachutes, fins, landing legs, nosecones and science instruments. Live
  **Δv / TWR / cost / staging** analysis while you build (Tsiolkovsky doesn't lie).
- **Real flight physics** — thrust, gravity, exponential atmosphere, drag, engine gimbal,
  SAS, aerodynamic stability (no fins → your rocket *will* remind you), staging with
  jettisoned debris, parachutes with semi/full deploy, crash physics.
- **Real orbital mechanics** — 2D patched conics: Keplerian elliptic *and* hyperbolic
  orbits, spheres of influence, analytic on-rails propagation up to 100,000× time warp,
  trajectory prediction across SOI changes, gravity assists, and **maneuver nodes**.
- **A compressed solar system** — the star **Helios**, home world **Gaia** (70 km
  atmosphere), its moon **Crumb**, scorched inner **Scorch**, and rusty outer **Rusty**.
- **A space program** — funds, science, 15 missions (break 1 km → orbit → land on Crumb →
  interplanetary Grand Tour), science "firsts", an R&D tech tree, safe-recovery refunds,
  and autosave via localStorage.

## Controls

| Key | Action |
|---|---|
| `A` / `D` | Steer |
| `Shift` / `Ctrl` | Throttle up / down |
| `Z` / `X` | Full throttle / cut |
| `Space` | Next stage |
| `T` | Toggle SAS |
| `M` | Map view (click your orbit to place a maneuver node) |
| `,` / `.` | Time warp down / up |
| Scroll | Zoom (editor, flight and map) |

## Flight school (three-minute version)

1. **Pod on top, parachute above it, tanks below, engine at the bottom.** Add a decoupler
   and a second stage below. Strap on side boosters. Add fins.
2. Launch straight up, then **tip east (D) gradually from ~2 km** — a gravity turn.
   You need ~3,400 m/s of Δv to orbit; check the readout before flying.
3. Cut throttle when apoapsis reads ~80 km, coast to it (map view helps), then
   **burn prograde at apoapsis** until periapsis climbs above 70 km. You're in orbit!
4. To come home: burn retrograde until periapsis dips into the atmosphere, ride the drag,
   deploy chutes. Recover the craft for an 80% refund.
5. The Mun— er, *Crumb* — is next. Click your orbit in map view, add ~840 m/s prograde,
   and drag the node around until the trajectory shows `→ Crumb`.

## Running locally

Any static file server works (ES modules need HTTP, not `file://`):

```bash
python -m http.server 8000
# then open http://localhost:8000
```

## How it works

The same trick the real KSP uses: **two simulations that hand off to each other.**
Under power or in atmosphere, the craft is integrated numerically (semi-implicit Euler at
120 Hz) with thrust, drag and torque applied. Coasting in vacuum, it's converted to
Keplerian orbital elements and propagated **analytically** — which is what makes 100,000×
time warp free. Trajectory prediction runs the same Kepler solver forward through
sphere-of-influence transitions, which is how the map view can show you a Crumb encounter
(or a lithobraking incident) before you commit to it.

| Module | What it owns |
|---|---|
| `js/universe.js` | Celestial bodies, atmospheres, SOI radii |
| `js/orbits.js` | Kepler solver: state ↔ elements, elliptic + hyperbolic propagation |
| `js/parts.js` | Part catalog + tech tree |
| `js/vessel.js` | Stack construction, staging, fuel flow, Δv analysis |
| `js/physics.js` | Flight integration, aero, staging execution, debris, explosions |
| `js/map.js` | Patched-conic trajectory prediction, map view, maneuver nodes |
| `js/render.js` | Rocket + flight-scene rendering |
| `js/editor.js` | The VAB |
| `js/missions.js` | Contracts + science firsts |
| `js/game.js` | Main loop, HUD, time warp, input, saves |

No frameworks, no build step, ~3,500 lines. Open the console and poke `window.__oob`
if you want to cheat — we won't judge. (We will judge.)

## Roadmap

- Sound (engine rumble, explosions, the quiet of space)
- Docking + multi-vessel persistence
- Re-entry heating and heat shields
- Crumb's far side easter egg
- Electricity, solar panels, and probe blackouts

---

*Built with real math and unreasonable enthusiasm. Fly safe. Or don't — that's data too.* 🧑‍🚀
