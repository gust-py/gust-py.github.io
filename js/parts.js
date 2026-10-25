// parts.js — the part catalog and tech tree.
// Units: mass in tons (dry), fuel in tons, thrust in kN, isp in seconds, sizes in meters.
// kN / tons = m/s^2, so forces and masses stay consistent everywhere.

export const TECH_TIERS = [
  { id: 0, name: 'Launch Day',      cost: 0,   blurb: 'Where every space program starts: enthusiasm and a small budget.' },
  { id: 1, name: 'Basic Rocketry',  cost: 30,  blurb: 'Bigger tanks, vacuum engines, and legs to (hopefully) land on.' },
  { id: 2, name: 'Heavy Lifting',   cost: 100, blurb: 'When in doubt, add more boosters.' },
  { id: 3, name: 'Deep Space',      cost: 250, blurb: 'Nuclear engines and enormous tanks for interplanetary ambition.' },
];

export const PARTS = {
  // ---- Tier 0: Launch Day ----
  beanpod: {
    name: 'Bean Pod', type: 'pod', tier: 0, cost: 600,
    mass: 0.8, w: 1.3, h: 1.6, torque: 12, crew: 1,
    desc: 'A snug one-blob command pod. Smells faintly of legumes.',
  },
  stubby: {
    name: 'Stubby Tank', type: 'tank', tier: 0, cost: 200,
    mass: 0.25, fuel: 2.0, w: 1.3, h: 1.9,
    desc: 'Holds 2 tons of rocket juice. The workhorse of ambition.',
  },
  sparrow: {
    name: 'Sparrow Engine', type: 'engine', tier: 0, cost: 500,
    mass: 1.2, thrust: 180, isp: 295, w: 1.3, h: 1.4,
    desc: 'Reliable, loud, and mostly points the right way.',
  },
  pip: {
    name: 'Pip Booster', type: 'srb', tier: 0, cost: 250,
    mass: 0.75, fuel: 2.8, thrust: 200, isp: 195, w: 0.9, h: 4.2, radialOk: true,
    desc: 'Solid rocket booster. Once lit, it has exactly one opinion.',
  },
  snapring: {
    name: 'Snap Ring', type: 'decoupler', tier: 0, cost: 120,
    mass: 0.06, w: 1.3, h: 0.35,
    desc: 'Explosive bolts that separate stages. Satisfying *clunk* included.',
  },
  bedsheet: {
    name: 'Bedsheet Chute', type: 'parachute', tier: 0, cost: 150,
    mass: 0.1, w: 0.9, h: 0.55, dragArea: 650,
    desc: 'Technically a parachute. Deploy before the ground arrives.',
  },
  popsicle: {
    name: 'Popsicle Fin', type: 'fin', tier: 0, cost: 60,
    mass: 0.05, w: 0.55, h: 1.1, finArea: 0.5, radialOk: true, radialOnly: true,
    desc: 'Keeps the pointy end forward. Attach near the bottom.',
  },

  // ---- Tier 1: Basic Rocketry ----
  longboy: {
    name: 'Longboy Tank', type: 'tank', tier: 1, cost: 700,
    mass: 0.5, fuel: 4.0, w: 1.3, h: 3.6,
    desc: 'Twice the tank, twice the consequences.',
  },
  kestrel: {
    name: 'Kestrel Engine', type: 'engine', tier: 1, cost: 700,
    mass: 0.6, thrust: 65, isp: 350, w: 1.3, h: 1.1,
    desc: 'Feeble at sea level, magnificent in vacuum.',
  },
  thumper: {
    name: 'Thumper Booster', type: 'srb', tier: 1, cost: 550,
    mass: 1.5, fuel: 6.0, thrust: 320, isp: 210, w: 1.1, h: 6.0, radialOk: true,
    desc: 'A bigger, angrier firework. The neighbors will know.',
  },
  longlegs: {
    name: 'Daddy Longlegs', type: 'legs', tier: 1, cost: 200,
    mass: 0.12, w: 0.5, h: 1.6, safeSpeed: 6, radialOk: true, radialOnly: true,
    desc: 'Landing struts. Raises survivable touchdown speed considerably.',
  },
  thermo: {
    name: 'Thermo-3000', type: 'science', tier: 1, cost: 300,
    mass: 0.06, w: 0.45, h: 0.7, sciBonus: 0.5, radialOk: true, radialOnly: true,
    desc: 'Measures how hot things are. +50% science from discoveries.',
  },
  brainlet: {
    name: 'Brainlet Core', type: 'pod', tier: 1, cost: 900,
    mass: 0.3, w: 1.0, h: 0.7, torque: 6, crew: 0,
    desc: 'Uncrewed probe core. Nobody has to write apology letters.',
  },

  // ---- Tier 2: Heavy Lifting ----
  chungus: {
    name: 'Chungus Tank', type: 'tank', tier: 2, cost: 1400,
    mass: 1.0, fuel: 8.0, w: 1.6, h: 5.4,
    desc: 'An absolute unit of a fuel tank.',
  },
  mule: {
    name: 'Mule Engine', type: 'engine', tier: 2, cost: 2000,
    mass: 3.0, thrust: 650, isp: 290, w: 1.6, h: 2.0,
    desc: 'Heavy-lift engine. Subtlety not included.',
  },
  conehead: {
    name: 'Conehead', type: 'nosecone', tier: 2, cost: 120,
    mass: 0.08, w: 1.3, h: 1.2,
    desc: 'Aerodynamics! Cuts drag when riding on top.',
  },
  kingsheet: {
    name: 'King Bedsheet', type: 'parachute', tier: 2, cost: 400,
    mass: 0.3, w: 1.2, h: 0.7, dragArea: 1900,
    desc: 'For landing things that really ought to bounce.',
  },
  goopod: {
    name: 'Goo Pod', type: 'science', tier: 2, cost: 600,
    mass: 0.15, w: 0.6, h: 0.8, sciBonus: 0.75, radialOk: true, radialOnly: true,
    desc: 'The goo observes you back. +75% science from discoveries.',
  },

  // ---- Tier 3: Deep Space ----
  megachungus: {
    name: 'Mega Chungus', type: 'tank', tier: 3, cost: 2600,
    mass: 2.0, fuel: 16.0, w: 2.0, h: 8.0,
    desc: 'Somewhere in here is a smaller tank trying to get out.',
  },
  firefly: {
    name: 'Firefly Atomic', type: 'engine', tier: 3, cost: 4500,
    mass: 2.5, thrust: 60, isp: 800, w: 1.3, h: 2.6,
    desc: 'Nuclear thermal engine. Absurd efficiency, glacial thrust.',
  },
  wallop: {
    name: 'Wallop Booster', type: 'srb', tier: 3, cost: 1500,
    mass: 3.0, fuel: 12.0, thrust: 620, isp: 220, w: 1.4, h: 8.5, radialOk: true,
    desc: 'The committee vetoed the name "Overkill". Their loss.',
  },
};

for (const id of Object.keys(PARTS)) PARTS[id].id = id;

export const PART_ORDER = Object.keys(PARTS);

export function partsForTier(maxTier) {
  return PART_ORDER.map(id => PARTS[id]).filter(p => p.tier <= maxTier);
}

// Category shown in the editor palette.
export function partCategory(p) {
  switch (p.type) {
    case 'pod': return 'Command';
    case 'tank': case 'engine': case 'srb': return 'Propulsion';
    case 'decoupler': case 'nosecone': case 'fin': case 'legs': return 'Structure';
    case 'parachute': return 'Recovery';
    case 'science': return 'Science';
    default: return 'Misc';
  }
}
