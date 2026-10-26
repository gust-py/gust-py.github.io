// render.js — rocket drawing (shared by editor + flight) and the flight-scene renderer.
//
// drawRocket draws in LOCAL px coords with the NOSE toward -Y (screen up),
// origin at the stack CENTER. Caller sets translate/rotate/scale first.
//
// v4 — planetas diversificados + terreno REAL em todas as distâncias:
//  • O disco visto de longe é desenhado com a MESMA função de elevação e as
//    MESMAS cores de bioma do terreno de perto — montanhas, praias, oceanos
//    e crateras batem nas duas escalas (nada de textura fake com blobs).
//  • Cada corpo tem identidade própria (LOOKS): paleta, céu, relevo,
//    crateras, nuvens, atmosfera e detalhes de solo.
//  • Calotas polares removidas. Oceano só onde deve existir (Gaia).
//  • Mais detalhes reais de perto: árvores, pedregulhos, rachaduras de lava,
//    regolito, e névoa que respeita a altitude.
//
// v5 — relevo em TODA a escala + plataforma ancorada + árvores realistas:
//  • MICRO_WAVES: oitavas de colina (λ ≈ 40 m – 2,4 km) que aparecem DE PERTO
//    (antes o terreno da Gaia só tinha ondas de dezenas de km — plano no chão).
//  • Base de lançamento simples ancorada no ÂNGULO FIXO de spawn (mundo);
//    antes eram desenhadas sempre abaixo do foguete (seguindo-o pelo céu).
//  • Árvores refritas: tronco afilado com casca e abaflamento, galhos, copa em
//    camadas com variação de cor por indivíduo, pinheiros, sombra e LOD.
//
// v7 — rework dos MOTORES (estilo "engines rework"):
//  • Bocal em sino de verdade: perfil curvo com ANÉIS de cobre (canais de
//    refrigeração), maquinário metálico em cima, garganta escura.
//  • Motor aceso: interior do sino iluminado (garganta brilha) + aro quente.
//  • Pluma de exaustão em CAMADAS (bruma externa → cone → núcleo brilhante →
//    ponto quente) — nada de gota translúcida única.
//  • EXPANSÃO pela pressão ambiente (atmoF): ao nível do mar a pluma é fechada
//    e intensa; no vácuo abre em leque largo e difuso (motores de vácuo).
//  • Tremor suave por senos (sem Math.random por frame — não "trema").

import { BODIES, bodyWorldPos, atmoDensity } from './universe.js';
import { PARTS } from './parts.js';
import * as V from './vessel.js';
import { world } from './physics.js';
import * as MAP from './map.js';

// ---------- compat com map.js (INTERFERÊNCIA CORRIGIDA) ----------
// O render.js original importava { drawBody, surfaceElevationM } POR NOME.
// O map.js novo (mapa estilo KSP) não exporta mais esses nomes — e import
// nomeado faltando DERRUBA O MÓDULO INTEIRO no carregamento. O import de
// namespace nunca falha; se o map.js voltar a exportar essas funções, as
// versões dele são usadas automaticamente (compatível com as duas versões).
const elevAt = MAP.surfaceElevationM || elevLocal;
const drawPlanet = MAP.drawBody || drawBodyFar;

function hashSeed(str) {
  let h = 2166136261 >>> 0;
  const s = String(str || 'x');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

// saneia qualquer número vindo do jogo (posição/altura podem vir NaN
// depois de explosões, zooms extremos etc.)
function num(v, d = 0) { return Number.isFinite(v) ? v : d; }
function clampN(v, a, b2) { return Math.max(a, Math.min(b2, v)); }
function wrapPi(a) {
  a = a % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// ---------- identidade visual por corpo ----------
// Paleta, céu, relevo, crateras e detalhes de cada corpo. Corpos
// desconhecidos caem no genericLook (derivado de color/land/ocean).
const DEFAULT_WAVES = [
  { f: 3.1, p: 97, w: 0.55 }, { f: 7.3, p: 89, w: 0.25 }, { f: 17.7, p: 83, w: 0.12 },
  { f: 37.4, p: 79, w: 0.05 }, { f: 89.2, p: 73, w: 0.03 },
];

const LOOKS = {
  gaia: {
    sky: [110, 175, 235],
    ocean: true,
    ampF: 0.004,
    waves: DEFAULT_WAVES,
    craters: 0,
    pad: Math.PI / 2,        // ângulo mundial do centro da plataforma (spawn)
    padFlat: 0.0006,         // meia-largura achatada (~360 m) p/ o pad
    flora: true, trees: true, clouds: true, ripples: true,
    atmo: [120, 180, 255], atmoA: 0.35,
    farCore: [26, 58, 104],
    pal: {
      grass: [104, 162, 66], grassDark: [58, 100, 36],
      dirt: [136, 100, 64], dirtDark: [106, 78, 48],
      sand: [206, 192, 146], sandWet: [164, 150, 106],
      stone: [128, 124, 118], stoneLight: [162, 158, 152], stoneDark: [92, 88, 84],
      shallow: [96, 178, 202], deep: [20, 56, 106], foam: [234, 246, 250],
    },
  },
  // lua árida: regolito cinza, crateras por toda parte, pedregulhos, sem ar
  crumb: {
    sky: [186, 186, 192],
    ocean: false,
    ampF: 0.0045,
    waves: [
      { f: 2.6, p: 91, w: 0.42 }, { f: 6.4, p: 87, w: 0.22 }, { f: 15.1, p: 83, w: 0.14 },
      { f: 33.7, p: 79, w: 0.08 }, { f: 81.3, p: 71, w: 0.05 },
    ],
    craters: 26, boulders: true, ripples: false,
    atmo: null,
    farCore: [99, 97, 94],
    pal: {
      grass: [152, 149, 143], grassDark: [118, 115, 110],
      dirt: [124, 121, 116], dirtDark: [96, 93, 90],
      sand: [172, 169, 162], sandWet: [148, 145, 139],
      stone: [120, 117, 112], stoneLight: [158, 155, 149], stoneDark: [78, 75, 72],
      shallow: [0, 0, 0], deep: [0, 0, 0], foam: [230, 230, 230],
    },
  },
  // mundo tostado: crosta escura rachada de lava, relevo serrilhado, sem ar
  scorch: {
    sky: [255, 130, 60],
    ocean: false,
    ampF: 0.005,
    waves: [
      { f: 4.7, p: 97, w: 0.4 }, { f: 11.9, p: 89, w: 0.26 }, { f: 27.1, p: 83, w: 0.16 },
      { f: 59.3, p: 79, w: 0.09 }, { f: 131.7, p: 73, w: 0.05 },
    ],
    craters: 13, boulders: true, lava: true, ripples: false,
    atmo: null,
    farCore: [66, 41, 30],
    pal: {
      grass: [98, 60, 42], grassDark: [72, 44, 31],
      dirt: [80, 49, 35], dirtDark: [57, 36, 27],
      sand: [130, 82, 53], sandWet: [102, 64, 43],
      stone: [90, 55, 40], stoneLight: [138, 90, 59], stoneDark: [51, 32, 25],
      shallow: [0, 0, 0], deep: [0, 0, 0], foam: [255, 170, 90],
    },
  },
  // deserto enferrujado: dunas suaves, poeira laranja, atmosfera fina
  rusty: {
    sky: [206, 140, 88],
    ocean: false,
    ampF: 0.0035,
    waves: [
      { f: 2.1, p: 97, w: 0.45 }, { f: 5.3, p: 89, w: 0.24 }, { f: 12.7, p: 83, w: 0.15 },
      { f: 29.3, p: 79, w: 0.09 }, { f: 67.1, p: 73, w: 0.05 },
    ],
    craters: 7, boulders: true, ripples: true,
    atmo: [255, 170, 110], atmoA: 0.22,
    farCore: [108, 64, 44],
    pal: {
      grass: [178, 108, 66], grassDark: [134, 80, 48],
      dirt: [148, 88, 53], dirtDark: [114, 68, 43],
      sand: [212, 144, 94], sandWet: [178, 118, 76],
      stone: [130, 98, 84], stoneLight: [164, 128, 108], stoneDark: [90, 66, 56],
      shallow: [0, 0, 0], deep: [0, 0, 0], foam: [238, 198, 162],
    },
  },
  // mundo gelado: neve azulada, gelo liso, atmosfera raríssima
  zephyr: {
    sky: [188, 212, 230],
    ocean: false,
    ampF: 0.0032,
    waves: [
      { f: 2.4, p: 93, w: 0.44 }, { f: 6.1, p: 87, w: 0.23 }, { f: 14.3, p: 81, w: 0.14 },
      { f: 31.9, p: 77, w: 0.08 }, { f: 77.7, p: 71, w: 0.05 },
    ],
    craters: 5, boulders: true, ripples: true,
    atmo: [190, 220, 245], atmoA: 0.2,
    farCore: [150, 180, 198],
    pal: {
      grass: [226, 236, 242], grassDark: [196, 210, 220],
      dirt: [204, 218, 226], dirtDark: [168, 186, 198],
      sand: [238, 244, 248], sandWet: [214, 226, 234],
      stone: [158, 176, 188], stoneLight: [192, 208, 218], stoneDark: [116, 134, 146],
      shallow: [0, 0, 0], deep: [0, 0, 0], foam: [246, 250, 252],
    },
  },
  // rocha violeta: mundo noturno e craterado, cristais salientes, sem ar
  vesper: {
    sky: [52, 40, 70],
    ocean: false,
    ampF: 0.0045,
    waves: [
      { f: 3.3, p: 89, w: 0.4 }, { f: 8.2, p: 85, w: 0.24 }, { f: 19.4, p: 81, w: 0.14 },
      { f: 43.1, p: 77, w: 0.08 }, { f: 101.3, p: 73, w: 0.05 },
    ],
    craters: 18, boulders: true, ripples: false,
    atmo: null,
    farCore: [74, 58, 96],
    pal: {
      grass: [128, 104, 152], grassDark: [98, 78, 118],
      dirt: [112, 90, 134], dirtDark: [86, 68, 104],
      sand: [148, 122, 172], sandWet: [122, 100, 144],
      stone: [98, 82, 116], stoneLight: [134, 112, 154], stoneDark: [62, 50, 78],
      shallow: [0, 0, 0], deep: [0, 0, 0], foam: [200, 186, 220],
    },
  },
  helios: {
    sky: [255, 220, 120],
    ocean: false,
    ampF: 0.004,
    waves: DEFAULT_WAVES,
    craters: 0,
    star: true,
    atmo: null,
    farCore: [255, 205, 80],
    pal: {
      grass: [200, 140, 60], grassDark: [160, 110, 45],
      dirt: [170, 120, 50], dirtDark: [140, 95, 40],
      sand: [220, 170, 80], sandWet: [200, 150, 70],
      stone: [190, 130, 60], stoneLight: [230, 180, 90], stoneDark: [150, 100, 45],
      shallow: [0, 0, 0], deep: [0, 0, 0], foam: [255, 240, 180],
    },
  },
  // luas novas: Grit (regolito marrom-cinza), Puff (gelo branco), Mote (violeta escuro)
  grit: {
    sky: [172, 164, 152],
    ocean: false,
    ampF: 0.005,
    waves: [
      { f: 2.9, p: 89, w: 0.42 }, { f: 7.1, p: 85, w: 0.22 }, { f: 16.9, p: 81, w: 0.13 },
      { f: 37.7, p: 77, w: 0.08 }, { f: 91.3, p: 71, w: 0.05 },
    ],
    craters: 30, boulders: true, ripples: false,
    atmo: null,
    farCore: [88, 82, 74],
    pal: {
      grass: [142, 132, 118], grassDark: [110, 102, 90],
      dirt: [122, 112, 98], dirtDark: [94, 86, 76],
      sand: [160, 148, 132], sandWet: [136, 126, 112],
      stone: [108, 100, 90], stoneLight: [142, 132, 118], stoneDark: [70, 64, 58],
      shallow: [0, 0, 0], deep: [0, 0, 0], foam: [218, 210, 198],
    },
  },
  puff: {
    sky: [214, 226, 234],
    ocean: false,
    ampF: 0.0038,
    waves: [
      { f: 3.7, p: 91, w: 0.4 }, { f: 9.1, p: 85, w: 0.22 }, { f: 21.7, p: 81, w: 0.13 },
      { f: 48.3, p: 77, w: 0.08 }, { f: 113.7, p: 73, w: 0.05 },
    ],
    craters: 12, boulders: true, ripples: true,
    atmo: null,
    farCore: [186, 202, 212],
    pal: {
      grass: [232, 240, 246], grassDark: [204, 216, 224],
      dirt: [214, 226, 234], dirtDark: [182, 196, 206],
      sand: [242, 248, 251], sandWet: [220, 230, 238],
      stone: [176, 190, 200], stoneLight: [210, 222, 230], stoneDark: [136, 150, 160],
      shallow: [0, 0, 0], deep: [0, 0, 0], foam: [250, 253, 255],
    },
  },
  mote: {
    sky: [40, 32, 54],
    ocean: false,
    ampF: 0.005,
    waves: [
      { f: 3.1, p: 87, w: 0.42 }, { f: 7.7, p: 83, w: 0.23 }, { f: 18.3, p: 79, w: 0.14 },
      { f: 40.7, p: 75, w: 0.08 }, { f: 96.1, p: 71, w: 0.05 },
    ],
    craters: 22, boulders: true, ripples: false,
    atmo: null,
    farCore: [56, 45, 72],
    pal: {
      grass: [96, 80, 116], grassDark: [74, 62, 90],
      dirt: [84, 70, 102], dirtDark: [64, 54, 78],
      sand: [112, 94, 132], sandWet: [92, 78, 108],
      stone: [74, 62, 88], stoneLight: [102, 86, 118], stoneDark: [48, 40, 58],
      shallow: [0, 0, 0], deep: [0, 0, 0], foam: [164, 148, 184],
    },
  },
};

// Oitavas de MICRORELEVO: colinas/ondulações visíveis de perto. As
// frequências são angulares (λ = 2π·r/f metros), então o MESMO conjunto dá
// colinas proporcionais em qualquer corpo — pequeno no Crumb, grande na Gaia.
// Amplitudes baixas: de longe somem abaixo de 1 px (disco continua limpo),
// de perto desenham colinas reais de ±3 a ±70 m.
const MICRO_WAVES = [
  { f: 1571, p: 31, w: 0.032 },   // λ ≈ 2,4 km (Gaia) — colinas rolantes
  { f: 4189, p: 47, w: 0.014 },   // λ ≈ 900 m
  { f: 12243, p: 61, w: 0.0055 }, // λ ≈ 310 m
  { f: 33659, p: 73, w: 0.0018 }, // λ ≈ 112 m
  { f: 87011, p: 89, w: 0.0007 }, // λ ≈ 43 m
];

function genericLook(b) {
  const base = hexRGBc((b && b.color) || '#8a8f98');
  const land = (b && b.land) ? hexRGBc(b.land) : mulC(base, 0.78);
  const earthlike = !!(b && b.land && b.ocean);
  return {
    sky: [220, 160, 120],
    ocean: !!(b && b.ocean),
    ampF: 0.004,
    waves: null,
    craters: 0,
    flora: earthlike, trees: earthlike, clouds: earthlike, ripples: true,
    boulders: !earthlike,
    atmo: (b && b.atmoHeight) ? [120, 180, 255] : null,
    atmoA: 0.35,
    farCore: (b && b.ocean) ? hexRGBc(b.ocean) : mulC(base, 0.45),
    pal: {
      grass: land, grassDark: mulC(land, 0.6),
      dirt: mixC(land, [114, 82, 52], 0.55), dirtDark: [90, 64, 42],
      sand: [216, 196, 132], sandWet: [172, 152, 98],
      stone: [128, 124, 118], stoneLight: [162, 158, 152], stoneDark: [92, 88, 84],
      shallow: [96, 178, 202],
      deep: (b && b.ocean) ? hexRGBc(b.ocean) : [20, 56, 106],
      foam: [234, 246, 250],
    },
  };
}

function bodyLook(b) {
  return (b && b.key && LOOKS[b.key]) || genericLook(b);
}

// amplitude do relevo (metros) — identidade por corpo
function ampOf(b) {
  const look = bodyLook(b);
  return Math.min(num(b && b.radius, 600000) * (look.ampF || 0.004), 3500) || 1;
}

// ---------- crateras (reais: a MESMA depressão vista de perto e de longe) ----------
const craterCache = new Map();
function cratersOf(b) {
  const key = (b && b.key) || String((b && b.color) || 'x');
  if (craterCache.has(key)) return craterCache.get(key);
  const look = bodyLook(b);
  const n = look.craters | 0;
  const list = [];
  if (n > 0) {
    let s = hashSeed(key + ':crateras') || 1;
    const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
    for (let i = 0; i < n; i++) {
      const big = rnd() < 0.22; // poucos grandes, muitos pequenos
      list.push({
        c: rnd() * Math.PI * 2,
        w: big ? 0.012 + rnd() * 0.026 : 0.0035 + rnd() * 0.011, // largura angular
        d: (big ? 0.5 : 0.3) + rnd() * 0.35,                     // fração da amplitude
      });
    }
  }
  craterCache.set(key, list);
  return list;
}
// perfil da cratera: tigela + borda levantada (d = distância normalizada)
function craterShape(d) {
  if (!Number.isFinite(d) || d >= 1.18) return 0;
  const bowl = d < 0.82 ? -(1 - (d / 0.82) * (d / 0.82)) : 0;
  const rim = Math.exp(-((d - 0.95) * (d - 0.95)) / 0.014) * 0.5;
  return bowl + rim;
}

// Terreno procedural determinístico (soma de senoides + crateras, fases por
// corpo). e = 0 é a altitude física (raio do corpo); a média fica um pouco
// abaixo, gerando oceanos/beiras na Gaia. A GAIA mantém EXATAMENTE a mesma
// base de antes (mesmas frequências/fases) — nada muda para a física/jogo.
//
// minWL (opcional): menor escala visível em metros, para ANTI-ALIASING — cada
// visão passa o próprio passo de amostragem e oitavas com λ < 2·minWL somem
// com fade suave (completas só a partir de 3·minWL). Assim o disco de longe
// nunca vira ruído listrado e o solo de perto mantém TODOS os detalhes; as
// duas escalas mostram exatamente o que cabe nelas, da MESMA função.
function elevLocal(body, a, minWL) {
  const r = num(body && body.radius, 600000);
  const look = bodyLook(body);
  const amp = Math.min(r * (look.ampF || 0.004), 3500) || 1;
  const seed = hashSeed(body && body.key);
  const waves = look.waves || DEFAULT_WAVES;
  const fadeK = (lam) => {                     // 0 abaixo de 2·minWL, 1 acima de 3·minWL
    if (!(minWL > 0)) return 1;
    const k = clampN(lam / minWL - 2, 0, 1);
    return k * k * (3 - 2 * k);
  };
  let e = 0;
  for (let i = 0; i < waves.length; i++) {
    const wv = waves[i];
    e += Math.sin(a * wv.f + (seed % wv.p) * 0.11) * wv.w * fadeK((2 * Math.PI / wv.f) * r);
  }
  e = (e * 0.85 - 0.12) * amp;
  // microrelevo (colinas de perto). Perto da plataforma de lançamento as
  // oitavas finas são suavizadas até zero — sítio construído, chão plano —
  // e a elevação no spawn fica IDÊNTICA à da versão anterior.
  let microK = 1;
  if (look.padFlat) {
    const dd = Math.abs(wrapPi(a - (look.pad || 0)));
    const tF = clampN((dd - look.padFlat * 0.3) / (look.padFlat * 0.7), 0, 1);
    microK = tF * tF * (3 - 2 * tF);
  }
  if (microK > 0.001) {
    for (let i = 0; i < MICRO_WAVES.length; i++) {
      const wv = MICRO_WAVES[i];
      e += Math.sin(a * wv.f + (seed % wv.p) * 0.11) * wv.w * microK * fadeK((2 * Math.PI / wv.f) * r) * amp;
    }
  }
  const crs = cratersOf(body);
  for (let i = 0; i < crs.length; i++) {
    const cr = crs[i];
    const dd = Math.abs(wrapPi(a - cr.c));
    if (dd > cr.w * 1.18) continue;
    e += craterShape(dd / cr.w) * cr.d * fadeK(cr.w * 2 * r) * amp;
  }
  return Number.isFinite(e) ? e : 0;
}

// Paleta de biomas do corpo (cada planeta com as cores do SEU solo).
function biomePalette(b) {
  return bodyLook(b).pal;
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

// Cor contínua do solo por elevação + inclinação. SEM FAIXAS: cada material
// (areia/grama/terra/pedra) é um PESO suave (smoothstep) sobre faixas que se
// sobrepõem — a cor flui de uma praia a um campo sem degrau visível.
function groundColor(eN, sl, sea, pal) {
  if (eN < sea) {
    const depth = clampN((sea - eN) / 0.55, 0, 1);
    return mixC(pal.shallow, pal.deep, depth * depth * (3 - 2 * depth));
  }
  const above = Math.max(0, eN - sea);
  const S = (a, b2, x) => {           // smoothstep entre a e b2
    const tt = clampN((x - a) / (b2 - a), 0, 1);
    return tt * tt * (3 - 2 * tt);
  };
  // pesos que se misturam em janelas largas (nunca mudam de material de uma vez)
  const wSand = 1 - S(0.05, 0.18, above);
  const wGrass = S(0.04, 0.15, above) * (1 - S(0.40, 0.64, above));
  const wDirt = S(0.38, 0.62, above) * (1 - S(0.66, 0.88, above));
  const wStone = S(0.64, 0.90, above);
  const sum = wSand + wGrass + wDirt + wStone + 1e-6;
  let c = [
    (pal.sand[0] * wSand + pal.grass[0] * wGrass + pal.dirt[0] * wDirt + pal.stone[0] * wStone) / sum,
    (pal.sand[1] * wSand + pal.grass[1] * wGrass + pal.dirt[1] * wDirt + pal.stone[1] * wStone) / sum,
    (pal.sand[2] * wSand + pal.grass[2] * wGrass + pal.dirt[2] * wDirt + pal.stone[2] * wStone) / sum,
  ];
  // faixa molhada junto à água (transição areia→água sem linha dura)
  const wet = 1 - S(0.002, 0.035, above);
  c = mixC(c, pal.sandWet, wet * 0.7);
  // encostas íngremes expõem pedra — devagar e com teto baixo (sem manchas)
  const st = S(0.85, 1.75, Math.abs(sl));
  if (above > 0.03) c = mixC(c, pal.stone, st * 0.4);
  return c;
}

// ---------- part shapes ----------
function shade(color, f) {
  // quick hex shade: f<1 darker, f>1 lighter
  const n = parseInt(color.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) * f) | 0;
  const g = Math.min(255, ((n >> 8) & 255) * f) | 0;
  const b = Math.min(255, (n & 255) * f) | 0;
  return `rgb(${r},${g},${b})`;
}

// sombreamento CILÍNDRICO estilo SFS: bordas bem escuras, brilho à esquerda
// do centro caindo suave até a borda direita (opaco)
function cylG(ctx, x0, ww, base) {
  const g = ctx.createLinearGradient(x0, 0, x0 + ww, 0);
  g.addColorStop(0, shade(base, 0.6));
  g.addColorStop(0.16, shade(base, 0.93));
  g.addColorStop(0.34, shade(base, 1.12));
  g.addColorStop(0.55, shade(base, 1.0));
  g.addColorStop(0.8, shade(base, 0.84));
  g.addColorStop(1, shade(base, 0.58));
  return g;
}

// contorno fino padrão das peças (silhueta marcada com linha discreta)
const PART_EDGE = 'rgba(95,95,95,0.5)';

function drawPart(ctx, p, S, state, time) {
  const w = p.w * S, h = p.h * S;
  ctx.save();
  switch (p.type) {
    case 'pod': {
      // CÁPSULA ESTILO SFS: cone truncado cinza-escuro com janela trapezoidal
      // e base larga de cantos arredondados — zero rebites, zero enfeite.
      const crew = !!p.crew;
      const charcoal = () => {
        const gp = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
        gp.addColorStop(0, '#2b2e34'); gp.addColorStop(0.2, '#43474f');
        gp.addColorStop(0.42, '#5d636d'); gp.addColorStop(0.68, '#454a52');
        gp.addColorStop(1, '#272a30');
        return gp;
      };
      ctx.lineJoin = 'round';
      if (crew) {
        const cone = () => {
          ctx.beginPath();
          ctx.moveTo(-w * 0.22, -h / 2);
          ctx.lineTo(w * 0.22, -h / 2);
          ctx.quadraticCurveTo(w * 0.36, -h * 0.04, w / 2, h * 0.3);
          ctx.lineTo(w / 2, h * 0.44);
          ctx.quadraticCurveTo(w / 2, h * 0.5, w * 0.42, h * 0.5);
          ctx.lineTo(-w * 0.42, h * 0.5);
          ctx.quadraticCurveTo(-w / 2, h * 0.5, -w / 2, h * 0.44);
          ctx.lineTo(-w / 2, h * 0.3);
          ctx.quadraticCurveTo(-w * 0.36, -h * 0.04, -w * 0.22, -h / 2);
          ctx.closePath();
        };
        ctx.fillStyle = charcoal();
        cone(); ctx.fill();
        ctx.strokeStyle = 'rgba(16,18,22,0.55)';
        ctx.lineWidth = Math.max(1, w * 0.02);
        cone(); ctx.stroke();
        ctx.save(); cone(); ctx.clip();
        // banda de fundição na base (mais escura)
        ctx.fillStyle = 'rgba(14,16,20,0.32)';
        ctx.fillRect(-w / 2, h * 0.34, w, h * 0.2);
        ctx.restore();
        // janela trapezoidal com moldura fina
        ctx.fillStyle = '#1f2228';
        ctx.beginPath();
        ctx.moveTo(-w * 0.13, -h * 0.28);
        ctx.lineTo(w * 0.13, -h * 0.28);
        ctx.lineTo(w * 0.18, 0);
        ctx.lineTo(-w * 0.18, 0);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#6e747e';
        ctx.lineWidth = Math.max(1, w * 0.028);
        ctx.stroke();
      } else {
        // BRAINLET: textura "estante" igual à imagem — faixas cinza-claras
        // topo/base e miolo escuro com lombadas verticais de larguras variadas
        ctx.fillStyle = '#c9ced4';
        ctx.fillRect(-w / 2, -h / 2, w, h * 0.16);
        ctx.fillRect(-w / 2, h / 2 - h * 0.16, w, h * 0.16);
        ctx.fillStyle = '#131518';
        ctx.fillRect(-w / 2, -h / 2 + h * 0.16, w, h * 0.68);
        const spines = [
          { x: -0.44, wd: 0.1, c: '#262a2f' },
          { x: -0.3, wd: 0.08, c: '#0e1013' },
          { x: -0.18, wd: 0.12, c: '#2e3238' },
          { x: -0.02, wd: 0.07, c: '#17191d' },
          { x: 0.09, wd: 0.11, c: '#0a0c0f' },
          { x: 0.24, wd: 0.09, c: '#262a2f' },
          { x: 0.37, wd: 0.1, c: '#14171b' },
        ];
        for (const s of spines) {
          ctx.fillStyle = s.c;
          ctx.fillRect(w * s.x, -h / 2 + h * 0.16, w * s.wd, h * 0.68);
        }
        ctx.strokeStyle = 'rgba(16,18,22,0.55)';
        ctx.lineWidth = Math.max(1, w * 0.03);
        ctx.strokeRect(-w / 2, -h / 2, w, h);
      }
      break;
    }
    case 'tank': {
      // TANQUE ESTILO SFS: cilindro branco limpo — só sombreamento cilíndrico,
      // rims sutis topo/base e contorno fino. Identidade vem do tamanho.
      const base = p.id === 'megachungus' ? '#e4e6ea' : '#f1f3f5';
      ctx.fillStyle = cylG(ctx, -w / 2, w, base);
      ctx.fillRect(-w / 2, -h / 2, w, h);
      const rimH = Math.max(2, h * 0.035);
      ctx.fillStyle = shade(base, 0.8);
      ctx.fillRect(-w / 2, -h / 2, w, rimH);
      ctx.fillRect(-w / 2, h / 2 - rimH, w, rimH);
      ctx.fillStyle = shade(base, 0.6);
      ctx.fillRect(-w / 2, -h / 2 + rimH, w, 1);
      ctx.fillRect(-w / 2, h / 2 - rimH - 1, w, 1);
      ctx.strokeStyle = PART_EDGE;
      ctx.lineWidth = Math.max(1, w * 0.012);
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      if (state && p.fuel) {
        // medidor discreto: filete junto à borda direita, só aparece se gastar
        const frac = clampN((state.fuel || 0) / p.fuel, 0, 1);
        const gh = (h - rimH * 2 - 2) * (1 - frac);
        if (gh > 1) {
          ctx.fillStyle = shade(base, 0.64);
          ctx.fillRect(w * 0.4, -h / 2 + rimH + 1, Math.max(2, w * 0.055), gh);
        }
      }
      break;
    }
    case 'engine': {
      // maquinário compacto no topo (sino LONGO — bocal achatado não)
      const gm = ctx.createLinearGradient(-w * 0.3, 0, w * 0.3, 0);
      gm.addColorStop(0, '#333333'); gm.addColorStop(0.45, '#8a8a8a'); gm.addColorStop(1, '#333333');
      ctx.fillStyle = gm;
      ctx.fillRect(-w * 0.25, -h / 2, w * 0.5, h * 0.26);
      ctx.fillStyle = '#5e5e5e'; // tubulações laterais
      ctx.fillRect(-w * 0.42, -h * 0.40, w * 0.18, h * 0.10);
      ctx.fillRect(w * 0.24, -h * 0.42, w * 0.18, h * 0.10);
      // cardan entre maquinário e sino
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(-w * 0.17, -h * 0.32, w * 0.34, h * 0.08);
      // sino do bocal: garganta estreita + flare no fim (perfil longo e curvo)
      const bt = -h * 0.26, be = h / 2;
      const tw = w * 0.24, ew = w * 0.84;
      const bell = () => {
        ctx.beginPath();
        ctx.moveTo(-tw / 2, bt);
        ctx.bezierCurveTo(-tw / 2 - (ew - tw) * 0.10, bt + (be - bt) * 0.52,
          -ew / 2, bt + (be - bt) * 0.80, -ew / 2, be);
        ctx.lineTo(ew / 2, be);
        ctx.bezierCurveTo(ew / 2, bt + (be - bt) * 0.80,
          tw / 2 + (ew - tw) * 0.10, bt + (be - bt) * 0.52, tw / 2, bt);
        ctx.closePath();
      };
      const gb = ctx.createLinearGradient(-ew / 2, 0, ew / 2, 0);
      gb.addColorStop(0, '#2b2b2b'); gb.addColorStop(0.28, '#6e6e6e');
      gb.addColorStop(0.5, '#949494'); gb.addColorStop(0.72, '#6e6e6e');
      gb.addColorStop(1, '#2b2b2b');
      ctx.fillStyle = gb;
      bell(); ctx.fill();
      ctx.save(); bell(); ctx.clip();
      ctx.fillStyle = 'rgba(22,22,22,0.5)'; // anéis horizontais (aço escuro)
      for (let i = 0; i < 7; i++) {
        const yy = bt + (be - bt) * (0.08 + i * 0.115);
        ctx.fillRect(-ew / 2, yy, ew, Math.max(1, h * 0.028));
      }
      ctx.fillStyle = '#161616'; // garganta escura no topo
      ctx.beginPath();
      ctx.ellipse(0, bt + h * 0.02, tw * 0.48, h * 0.05, 0, 0, 7);
      ctx.fill();
      ctx.fillStyle = 'rgba(18,18,18,0.45)'; // borda interna da saída
      ctx.fillRect(-ew / 2, be - h * 0.03, ew, h * 0.03);
      ctx.restore();
      ctx.strokeStyle = '#969696'; // aro metálico da saída
      ctx.lineWidth = Math.max(0.8, h * 0.02);
      ctx.beginPath();
      ctx.moveTo(-ew / 2, be);
      ctx.lineTo(ew / 2, be);
      ctx.stroke();
      // SINO NUNCA BRILHA: o metal fica FOSCO mesmo aceso — quem brilha é a
      // pluma (ponto quente + partículas aditivas, logo abaixo da saída).
      break;
    }
    case 'srb': {
      // casca branca com sombreamento cilíndrico + nariz arredondado (SFS)
      const gc = cylG(ctx, -w / 2, w, '#f1f3f5');
      const topY = -h / 2 + w * 0.55;
      ctx.fillStyle = gc;
      ctx.fillRect(-w / 2, topY, w, h - w * 0.55 - h * 0.2);
      ctx.beginPath();
      ctx.moveTo(-w / 2, topY);
      ctx.quadraticCurveTo(-w * 0.5, -h / 2 + w * 0.12, 0, -h / 2);
      ctx.quadraticCurveTo(w * 0.5, -h / 2 + w * 0.12, w / 2, topY);
      ctx.closePath(); ctx.fill();
      // emenda escura sob o nariz (sem ponta vermelha)
      ctx.fillStyle = shade('#f1f3f5', 0.55);
      ctx.fillRect(-w / 2, topY - Math.max(1, h * 0.012), w, Math.max(1, h * 0.024));
      ctx.strokeStyle = PART_EDGE;
      ctx.lineWidth = 1;
      ctx.strokeRect(-w / 2, topY, w, h - w * 0.55 - h * 0.2);
      // sino metálico do booster (mesmo estilo do motor, versão compacta)
      const bt = h / 2 - h * 0.2, be = h / 2;
      const tw = w * 0.34, ew = w * 0.9;
      const sb = () => {
        ctx.beginPath();
        ctx.moveTo(-tw / 2, bt);
        ctx.bezierCurveTo(-tw / 2 - (ew - tw) * 0.12, bt + (be - bt) * 0.5,
          -ew / 2, bt + (be - bt) * 0.78, -ew / 2, be);
        ctx.lineTo(ew / 2, be);
        ctx.bezierCurveTo(ew / 2, bt + (be - bt) * 0.78,
          tw / 2 + (ew - tw) * 0.12, bt + (be - bt) * 0.5, tw / 2, bt);
        ctx.closePath();
      };
      const gs2 = ctx.createLinearGradient(-ew / 2, 0, ew / 2, 0);
      gs2.addColorStop(0, '#2d2d2d'); gs2.addColorStop(0.3, '#707070');
      gs2.addColorStop(0.5, '#979797'); gs2.addColorStop(0.7, '#707070');
      gs2.addColorStop(1, '#2d2d2d');
      ctx.fillStyle = gs2;
      sb(); ctx.fill();
      ctx.save(); sb(); ctx.clip();
      ctx.fillStyle = 'rgba(24,24,24,0.55)'; // anéis do sino
      for (let i = 0; i < 3; i++) {
        const yy = bt + (be - bt) * (0.15 + i * 0.3);
        ctx.fillRect(-ew / 2, yy, ew, Math.max(1, h * 0.016));
      }
      ctx.fillStyle = '#161616'; // garganta escura
      ctx.beginPath();
      ctx.ellipse(0, bt + h * 0.012, tw * 0.46, h * 0.018, 0, 0, 7);
      ctx.fill();
      ctx.fillStyle = 'rgba(18,18,18,0.4)'; // borda interna da saída
      ctx.fillRect(-ew / 2, be - h * 0.02, ew, h * 0.02);
      ctx.restore();
      ctx.strokeStyle = '#9d9d9d'; // aro metálico da saída
      ctx.lineWidth = Math.max(0.8, h * 0.01);
      ctx.beginPath();
      ctx.moveTo(-ew / 2, be);
      ctx.lineTo(ew / 2, be);
      ctx.stroke();
      // bocal do booster NÃO brilha (mesma regra do sino: metal fosco)
      break;
    }
    case 'decoupler': {
      // anel de separação metálico com dentes triangulares (estilo SFS staging)
      const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      g.addColorStop(0, '#787e88'); g.addColorStop(0.34, '#cdd2d8');
      g.addColorStop(0.58, '#bcc1c9'); g.addColorStop(1, '#6e747e');
      ctx.fillStyle = g;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      const lip = Math.max(1.5, h * 0.22);
      ctx.fillStyle = '#3a3f47';
      ctx.fillRect(-w / 2, -h / 2, w, lip);
      ctx.fillRect(-w / 2, h / 2 - lip, w, lip);
      ctx.fillStyle = '#4d535d';
      for (let i = 0; i < 7; i++) {
        const cx = -w / 2 + (w * (i + 0.5)) / 7;
        const tw3 = (w / 7) * 0.42;
        ctx.beginPath();
        ctx.moveTo(cx - tw3, h * 0.14);
        ctx.lineTo(cx, -h * 0.14);
        ctx.lineTo(cx + tw3, h * 0.14);
        ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(52,56,62,0.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      break;
    }
    case 'parachute': {
      const big = p.id === 'kingsheet';
      const cap = big ? '#c23b22' : '#e66a2c';
      if (state && state.deployed) {
        // copa com GOMOS alternados + 5 linhas de suspensão em leque
        const cw = w * 6, ch = w * 5, topY = -ch;
        ctx.strokeStyle = 'rgba(230,230,240,0.85)';
        ctx.lineWidth = Math.max(1, S * 0.035);
        ctx.beginPath();
        for (let i = 0; i <= 4; i++) {
          const a = Math.PI * (0.12 + 0.19 * i);
          ctx.moveTo(0, -h * 0.2);
          ctx.lineTo((cw / 2) * Math.cos(a), topY - (cw / 2) * Math.sin(a));
        }
        ctx.stroke();
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, topY, cw / 2, Math.PI, 0);
        ctx.closePath();
        ctx.clip();
        ctx.fillStyle = '#f4f0e6';
        ctx.fillRect(-cw / 2, topY - cw / 2, cw, cw);
        ctx.fillStyle = cap;
        for (let i = 0; i < 6; i += 2) {
          ctx.fillRect(-cw / 2 + (cw / 6) * i, topY - cw / 2, cw / 6, cw);
        }
        ctx.restore();
        ctx.strokeStyle = shade(cap, 0.7);
        ctx.lineWidth = Math.max(1, S * 0.05);
        ctx.beginPath();
        ctx.arc(0, topY, cw / 2, Math.PI, 0);
        ctx.stroke();
      }
      // tambor estilo SFS: cúpula branca arredondada + corpo curto + pinstripe
      const pd = '#eceef1';
      ctx.fillStyle = cylG(ctx, -w / 2, w, pd);
      ctx.beginPath();
      ctx.arc(0, h * 0.08, w / 2, Math.PI, 0);
      ctx.closePath(); ctx.fill();
      ctx.fillRect(-w / 2, h * 0.08, w, h * 0.3);
      ctx.fillStyle = cap; // pinstripe fino de identidade
      ctx.fillRect(-w / 2, h * 0.08, w, Math.max(1.5, h * 0.1));
      ctx.fillStyle = shade(pd, 0.62);
      ctx.fillRect(-w / 2, h * 0.38 - Math.max(1.5, h * 0.07), w, Math.max(1.5, h * 0.07));
      ctx.strokeStyle = PART_EDGE;
      ctx.lineWidth = 1;
      ctx.strokeRect(-w / 2, h * 0.08, w, h * 0.3);
      break;
    }
    case 'nosecone': {
      // cone branco limpo com banda de base escura (estilo SFS)
      ctx.fillStyle = cylG(ctx, -w / 2, w, '#f1f3f5');
      ctx.beginPath();
      ctx.moveTo(-w / 2, h / 2);
      ctx.quadraticCurveTo(-w * 0.44, -h * 0.26, 0, -h / 2);
      ctx.quadraticCurveTo(w * 0.44, -h * 0.26, w / 2, h / 2);
      ctx.closePath(); ctx.fill();
      ctx.lineJoin = 'round';
      ctx.strokeStyle = PART_EDGE;
      ctx.lineWidth = Math.max(1, w * 0.015);
      ctx.stroke();
      ctx.fillStyle = '#3d434c';
      ctx.fillRect(-w / 2, h / 2 - Math.max(2, h * 0.1), w, Math.max(2, h * 0.1));
      break;
    }
    case 'fin': {
      // aleta cinza-claro limpa com contorno (estilo SFS)
      const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      g.addColorStop(0, '#e6e9ed'); g.addColorStop(0.5, '#c6cbd2'); g.addColorStop(1, '#949ba5');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-w / 2, h / 2);
      ctx.lineTo(-w / 2, -h / 2);
      ctx.quadraticCurveTo(w * 0.28, -h * 0.1, w / 2, h / 2);
      ctx.closePath(); ctx.fill();
      ctx.lineJoin = 'round';
      ctx.strokeStyle = PART_EDGE;
      ctx.lineWidth = Math.max(1, w * 0.05);
      ctx.stroke();
      break;
    }
    case 'legs': {
      // perna com pistão secundário, pivô e pé de duas camadas
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#9d9d9d';
      ctx.lineWidth = Math.max(2, S * 0.15);
      ctx.beginPath();
      ctx.moveTo(-w * 0.15, -h / 2);
      ctx.lineTo(w * 0.68, h * 0.4);
      ctx.stroke();
      ctx.strokeStyle = '#c9c9c9';
      ctx.lineWidth = Math.max(1.2, S * 0.08);
      ctx.beginPath();
      ctx.moveTo(w * 0.05, -h * 0.14);
      ctx.lineTo(w * 0.3, h * 0.05);
      ctx.stroke();
      ctx.fillStyle = '#3c3c3c';
      ctx.beginPath();
      ctx.arc(-w * 0.15, -h * 0.44, Math.max(2, S * 0.11), 0, 7);
      ctx.fill();
      ctx.fillStyle = '#6e6e6e';
      ctx.fillRect(w * 0.4, h * 0.4, w * 0.6, Math.max(2, S * 0.1));
      ctx.fillStyle = '#575757';
      ctx.fillRect(w * 0.44, h * 0.4 + Math.max(2, S * 0.1), w * 0.52, Math.max(2, S * 0.08));
      ctx.lineCap = 'butt';
      break;
    }
    case 'science': {
      if (p.id === 'goopod') {
        // cilindro branco com janela circular do goo
        ctx.fillStyle = cylG(ctx, -w / 2, w, '#eceef1');
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.fillStyle = '#3d434c';
        ctx.fillRect(-w / 2, -h / 2, w, Math.max(1, h * 0.14));
        ctx.fillRect(-w / 2, h / 2 - Math.max(1, h * 0.14), w, Math.max(1, h * 0.14));
        ctx.strokeStyle = PART_EDGE;
        ctx.lineWidth = 1;
        ctx.strokeRect(-w / 2, -h / 2, w, h);
        ctx.fillStyle = '#2a2e35';
        ctx.beginPath(); ctx.arc(0, 0, w * 0.3, 0, 7); ctx.fill();
        ctx.fillStyle = '#7ec850';
        ctx.beginPath(); ctx.arc(0, 0, w * 0.22, 0, 7); ctx.fill();
        ctx.fillStyle = '#a5e07e';
        ctx.beginPath(); ctx.arc(-w * 0.06, -w * 0.06, w * 0.07, 0, 7); ctx.fill();
      } else {
        // caixa branca com mostrador de ponteiro (estilo SFS)
        ctx.fillStyle = cylG(ctx, -w / 2, w, '#eceef1');
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.strokeStyle = PART_EDGE;
        ctx.lineWidth = 1;
        ctx.strokeRect(-w / 2, -h / 2, w, h);
        ctx.fillStyle = '#2a2e35';
        ctx.beginPath(); ctx.arc(0, -h * 0.08, w * 0.27, 0, 7); ctx.fill();
        ctx.fillStyle = '#e8ecf2';
        ctx.beginPath(); ctx.arc(0, -h * 0.08, w * 0.19, 0, 7); ctx.fill();
        ctx.strokeStyle = '#c23b22';
        ctx.lineWidth = Math.max(1, w * 0.05);
        ctx.beginPath();
        ctx.moveTo(0, -h * 0.08);
        ctx.lineTo(w * 0.1, -h * 0.19);
        ctx.stroke();
        ctx.fillStyle = '#3d434c';
        ctx.fillRect(-w * 0.32, h * 0.26, w * 0.14, h * 0.14);
        ctx.fillRect(w * 0.18, h * 0.26, w * 0.14, h * 0.14);
      }
      break;
    }
  }
  ctx.restore();
}

// ---------- chama do motor (pluma com PARTÍCULAS DENSAS + brilho aditivo) ----------
// Bruma externa → corpo translúcido (cola) → 44 PUFFS + 30 FAÍSCAS em mistura
// ADITIVA ('lighter': partículas SOMAM luz de verdade) → diamantes de choque
// (só no mar) → núcleo brilhante → ponto quente. A fase das partículas é
// função de (time·vel + i/NP + hash) — denso, fluido, sem estado, idêntico
// entre chamadas. Expansão pela pressão (atmoF 1 = mar, 0 = vácuo).
function colA(c, a) {
  const f = (x) => (Number.isFinite(x) ? Math.max(0, Math.min(255, x | 0)) : 200);
  return `rgba(${f(c[0])},${f(c[1])},${f(c[2])},${a})`;
}
function drawFlame(ctx, w, h, S, power, time, color1 = '#ffb143', color2 = '#fff7d6', opts = {}) {
  const p = clampN(power, 0, 1.4);
  if (p <= 0.001 || !(w > 0) || !(h > 0) || !(S > 0)) return;
  const atmoF = clampN(opts.atmoF === undefined ? 1 : opts.atmoF, 0, 1);
  const c1 = hexRGBc(color1);
  const c2 = hexRGBc(color2);
  const cDeep = mulC(c1, 0.6);                        // laranja profundo no rabinho
  const cRed = mixC(mulC(c1, 0.4), [64, 16, 8], 0.3); // fim esfriando: vermelho escuro
  const cHot = mixC(c2, [255, 255, 255], 0.55);       // ponto quente branco

  const flick = 1 + 0.05 * Math.sin(time * 31) + 0.035 * Math.sin(time * 57 + 1.7)
              + 0.025 * Math.sin(time * 23 + 0.6);
  const vac = Math.pow(1 - atmoF, 1.5);               // 0 no mar → 1 no vácuo
  const expand = 1 + 2.1 * vac;                       // leque no vácuo
  const len = h * (1.3 + 3.9 * p) * flick * S * (1 + 0.75 * vac);
  if (!Number.isFinite(len) || len <= 0) return;
  const w0 = w * 0.38 * S;                            // meia-largura na saída
  const wEnd = w0 * (1.35 + 0.55 * p) * expand * (1 + 0.035 * Math.sin(time * 44 + 2.1));

  // um cone de pluma: abre devagar (quase linear) e arredonda no rabinho
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

  const aMul = 0.55 + 0.45 * atmoF; // no vácuo a pluma difunde um pouco

  // puff suave (gradiente radial que some até 0 — NUNCA bloco translúcido)
  const puff = (x, y, r, col, a) => {
    if (!(r > 0.4) || !(a > 0.005)) return;
    if (r < 2.2) { // faísca miúda: disco sólido (bem mais barato)
      ctx.fillStyle = colA(col, Math.min(1, a));
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      return;
    }
    const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
    g.addColorStop(0, colA(col, Math.min(1, a)));
    g.addColorStop(0.6, colA(col, Math.min(1, a) * 0.5));
    g.addColorStop(1, colA(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 7);
    ctx.fill();
  };

  // hash determinístico por índice (idêntico entre frames — NUNCA Math.random)
  const hsh = (i, k) => {
    let x = (i * 2654435761 + k * 2246822519 + 101) >>> 0;
    x = Math.imul(x ^ (x >>> 15), 2654435761) >>> 0;
    return (((x ^ (x >>> 13)) >>> 8) % 1000) / 1000;
  };

  // 0) bruma externa fraca (bloom discreto)
  cone(w0 * 1.5, wEnd * 1.45,
    grad([[0, c1, 0.15 * aMul], [0.5, cDeep, 0.10 * aMul], [1, cDeep, 0]]));

  // 1) corpo translúcido — só a "cola" entre as partículas
  cone(w0, wEnd,
    grad([[0, c2, 0.5 * aMul], [0.35, c1, 0.4 * aMul], [0.75, cDeep, 0.2 * aMul], [1, cDeep, 0]]));

  // === DAQUI PRA BAIXO: MISTURA ADITIVA — as partículas somam LUZ de verdade,
  //     igual exaustão real (sobreposições saturam para branco-quente) ===
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // 2) NUVEM DE PUFFS: nascem brancas na saída, caem ACELERANDO, a turbulência
  //    cresce com a idade e a cor esfria branco→amarelo→laranja→vermelho escuro.
  const NP = 44;
  for (let i = 0; i < NP; i++) {
    const h1 = hsh(i, 1), h2 = hsh(i, 2), h3 = hsh(i, 3);
    const vel = (0.8 + 0.45 * h1) * (0.85 + 0.35 * p);
    const age = (time * vel + i / NP + h2) % 1;
    const yFrac = age * (0.8 + 0.25 * h1) + 0.17 * age * age; // acelera na queda
    const y = yFrac * len * (0.92 + 0.2 * h3);
    const spread = w0 * 0.85 + (wEnd - w0 * 0.85) * Math.pow(age, 0.78);
    const dx = Math.sin(age * Math.PI * (2.1 + h2 * 3.1) + h1 * 9.4) * spread * (0.2 + 0.2 * age)
             + (h2 - 0.5) * spread * 0.7;
    const r = (w0 * 0.44 + spread * 0.72) * (0.34 + 0.9 * age) * (0.85 + 0.3 * h3);
    const env = age < 0.1 ? age / 0.1 : 1 - Math.pow((age - 0.1) / 0.9, 1.4);
    const a = 0.34 * aMul * Math.max(0, env);
    const col = age < 0.28 ? mixC(c2, c1, age / 0.28)
              : age < 0.6 ? mixC(c1, cDeep, (age - 0.28) / 0.32)
              : mixC(cDeep, cRed, (age - 0.6) / 0.4);
    puff(dx, y, r, col, a);
  }

  // 3) FAÍSCAS: pontos pequenos, RÁPIDOS e brilhantes voando dentro da pluma
  const NS = 30;
  for (let i = 0; i < NS; i++) {
    const h1 = hsh(i + 71, 1), h2 = hsh(i + 71, 2), h3 = hsh(i + 71, 3);
    const vel = (1.5 + 0.9 * h1) * (0.85 + 0.3 * p);
    const age = (time * vel + h2) % 1;
    const y = (age * (0.85 + 0.3 * h1) + 0.3 * age * age) * len * (0.55 + 0.4 * h3);
    const spread = w0 * (0.45 + 1.25 * age) * (1 + 0.55 * vac);
    const dx = Math.sin(age * Math.PI * (3 + h2 * 4) + h1 * 12) * spread * 0.35
             + (h2 - 0.5) * spread * 0.85;
    const r = Math.max(0.5, w0 * (0.09 + 0.15 * h3) * (1.05 - age * 0.5)) * (1 + 0.4 * vac);
    const env = age < 0.07 ? age / 0.07 : 1 - age;
    const a = 0.8 * Math.max(0, env) * (0.45 + 0.55 * atmoF);
    const col = age < 0.3 ? mixC([255, 255, 246], c1, age / 0.3) : mixC(c1, cDeep, (age - 0.3) / 0.7);
    puff(dx, y, r, col, a);
  }

  // 4) núcleo brilhante — coluna quente que dá continuidade no meio da pluma
  const lenC = len * (0.58 + 0.18 * atmoF);
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

  // 5) diamantes de choque (só no mar): nós brilhantes periódicos na coluna
  const diaA = 0.38 * atmoF * atmoF;
  if (diaA > 0.02) {
    const step = lenC / 4.6;
    for (let i = 1; i <= 4; i++) {
      const yy = step * i * (0.95 + 0.1 * Math.sin(time * 9 + i * 2.4));
      const rr = w0 * (0.46 - i * 0.065) * (0.9 + 0.18 * Math.sin(time * 27 + i * 1.7));
      puff(0, yy, Math.max(0.5, rr), mixC(c2, [255, 255, 255], 0.45), diaA * (1 - i / 5.5));
    }
  }

  // 6) ponto quente na saída (garganta ilumina o início da pluma)
  const rHot = w0 * (1.05 + 0.12 * Math.sin(time * 44 + 2.1));
  const gHot = ctx.createRadialGradient(0, h * 0.05 * S, rHot * 0.08, 0, h * 0.05 * S, rHot);
  gHot.addColorStop(0, colA(cHot, 1));
  gHot.addColorStop(0.55, colA(c2, 0.55));
  gHot.addColorStop(1, colA(c2, 0));
  ctx.fillStyle = gHot;
  ctx.beginPath();
  ctx.arc(0, h * 0.05 * S, rHot, 0, 7);
  ctx.fill();

  ctx.restore(); // volta à composição normal
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
            isNuke ? '#7fb4ff' : '#ff7f26', isNuke ? '#e0f0ff' : '#ffe6c0',
            { atmoF: opts.atmoF });
          ctx.restore();
        }
      }
      if (p.type === 'srb' && s.ignited && s.fuel > 0) {
        ctx.save();
        ctx.translate(0, y + p.h * S / 2);
        drawFlame(ctx, p.w, p.h * 0.45, S, 1, t, '#ff912e', '#ffefce', { atmoF: opts.atmoF });
        ctx.restore();
      }
      for (const r of s.radials) {
        const rp = PARTS[r.pid];
        if (rp.type === 'srb' && r.ignited && r.fuel > 0) {
          const xOff = (p.w / 2 + rp.w / 2);
          for (const side of [-1, 1]) {
            ctx.save();
            ctx.translate(side * xOff * S, y + rp.h * S / 2);
            drawFlame(ctx, rp.w, rp.h * 0.45, S, 1, t, '#ff912e', '#ffefce', { atmoF: opts.atmoF });
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
  // zoom degenerado (0/NaN) tornaria 1/zoom = Infinity → arc(Infinity) lança
  // IndexSizeError no canvas real e derruba o loop inteiro; saneia aqui em cima
  const zoom = Number.isFinite(cam && cam.zoom) && cam.zoom > 1e-9 ? cam.zoom : 0.18;

  const toScreen = (wx, wy) => [
    W / 2 + (wx - flight.pos.x) / zoom,
    H / 2 - (wy - flight.pos.y) / zoom,
  ];

  // background: blend sky by atmospheric density (céu de CADA corpo), com
  // PROFUNDIDADE: gradiente vertical — zênite mais escuro, horizonte com
  // neblina mais clara e quente (dissecação atmosférica de verdade)
  const rho = atmoDensity(body, Math.max(alt, 0));
  const skyF = body.rho0 ? Math.pow(rho / body.rho0, 0.35) : 0;
  const sky = bodyLook(body).sky || [220, 160, 120];
  const spaceC = [8, 10, 18];
  const lerp3 = (a, b2, tt) => a.map((c, i) => Math.round(c + (b2[i] - c) * tt));
  const zen = lerp3(spaceC, sky.map((c) => c * 0.78), skyF);           // topo
  const hor = lerp3(spaceC, lerp3(sky, [255, 246, 228], 0.24), skyF);  // horizonte
  const bg = hor;
  const gSky = ctx.createLinearGradient(0, 0, 0, H);
  gSky.addColorStop(0, `rgb(${zen[0]},${zen[1]},${zen[2]})`);
  gSky.addColorStop(1, `rgb(${hor[0]},${hor[1]},${hor[2]})`);
  ctx.fillStyle = gSky;
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
        drawNearSurface(ctx, W, H, flight, b, zoom, t, hor);
      } catch (err) {
        drawFlatGround(ctx, W, H);
      }
      continue;
    }
    // zoom degenerado (0/NaN/negativo): rPx fica Infinity/NaN e os raios de
    // brilho/atmo lançam IndexSizeError no canvas real — pula o corpo
    if (!Number.isFinite(rPx) || rPx <= 0) continue;

    if (b.atmoHeight) {
      const ac = bodyLook(b).atmo || [120, 180, 255];
      const aa = bodyLook(b).atmoA || 0.35;
      const g = ctx.createRadialGradient(sx, sy, rPx, sx, sy, rPx + b.atmoHeight * 1.8 / zoom);
      g.addColorStop(0, `rgba(${ac[0] | 0},${ac[1] | 0},${ac[2] | 0},${aa})`);
      g.addColorStop(1, `rgba(${ac[0] | 0},${ac[1] | 0},${ac[2] | 0},0)`);
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
      // planeta de longe com o TERRENO REAL (mesma elevação/biomas de perto);
      // se o map.js antigo exportar drawBody, a versão dele é respeitada
      drawPlanet(ctx, b, sx, sy, rPx, t, W, H);
    } else {
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(sx, sy, Math.max(rPx, 1), 0, 7); ctx.fill();
    }
    // simple shading toward the limb (suave: não apaga a banda de terreno)
    if (rPx > 40 && !b.star) {
      const g = ctx.createRadialGradient(sx, sy, rPx * 0.68, sx, sy, rPx);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.25)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(sx, sy, rPx, 0, 7); ctx.fill();
    }
  }

  // a base de lançamento é desenhada DENTRO de drawNearSurface,
  // ancoradas ao ângulo fixo de spawn (PAD_ANG) — ficam no lugar no mundo
  // enquanto o foguete sobe/afasta (antes seguiam o foguete — bug)

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
      atmoF: skyF,
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
function mixC(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function mulC(c, f) { return [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)]; }

// Oclusão ambiente SUAVE: gradiente radial que some até o transparente —
// profundidade de verdade, sem "blocos semi-transparentes" no chão.
// x,y = centro (px), rx/ry = raios (px), col = "r,g,b", aM = alpha no centro.
function aoBlob(ctx, x, y, rx, ry, col, aM) {
  if (!(rx > 0.5) || !(ry > 0.3) || !Number.isFinite(x) || !Number.isFinite(y)) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, rx * 0.08, 0, 0, rx);
  g.addColorStop(0, `rgba(${col},${aM.toFixed(3)})`);
  g.addColorStop(0.5, `rgba(${col},${(aM * 0.55).toFixed(3)})`);
  g.addColorStop(1, `rgba(${col},0)`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, rx, 0, 7); ctx.fill();
  ctx.restore();
}

// Desenha o solo como um perfil de terreno amostrado, com biomas do corpo
// (grama/regolito, areia, subsolo, pedra, água), sombreamento por inclinação,
// névoa de distância (que respeita a altitude) e detalhes de superfície.
// A altura é referenciada ao solo sob o foguete, então ele sempre pousa
// exatamente na superfície.
function drawNearSurface(ctx, W, H, flight, b, zoomArg, t, sky) {
  const zoom = Number.isFinite(zoomArg) && zoomArg > 1e-6 ? zoomArg : 0.18;
  const fr = vesselFrame(flight, b);
  // se a posição da nave veio NaN/Infinity (física bugada, destroço etc.),
  // desenha um chão liso seguro em vez de espalhar NaN pelo canvas
  if (![fr.altV, fr.a0, fr.up.x, fr.up.y, fr.perp.x, fr.perp.y].every(Number.isFinite)) {
    drawFlatGround(ctx, W, H);
    return;
  }
  const look = bodyLook(b);
  const diag = Math.hypot(W, H);
  const halfWin = (diag * 0.75) * zoom / b.radius; // radians covering the screen
  const N = Math.max(80, Math.min(340, Math.round(diag / 4.5)));
  const arcStep = (b.radius * halfWin * 2) / N + 1e-9;
  const minWL = arcStep;                           // anti-aliasing: 1 amostra ≈ arcStep
  const h0 = num(elevAt(b, fr.a0, minWL));         // terrain height at the vessel
  const amp = ampOf(b);
  const sea = look.ocean ? -0.28 : -Infinity;      // oceano SÓ em corpos com água
  const pal = biomePalette(b);

  const pts = [], hs = [], eNs = [];
  for (let i = 0; i <= N; i++) {
    const a = fr.a0 - halfWin + (2 * halfWin) * i / N;
    const e = num(elevAt(b, a, minWL));            // reserva local cobre NaN/undefined
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
  const slV = [];
  for (let i = 0; i <= N; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(N, i + 1);
    slV.push((hs[i1] - hs[i0]) / ((i1 - i0) * arcStep + 1e-9));
  }

  // média móvel da elevação/inclinação SÓ para a COR. Janela larga (±4/±7
  // amostras) mata o ruído de cor das oitavas finas de microrelevo (bandas
  // verticais); a geometria do perfil continua nítida (usa os valores crus).
  const smoothW = (arr, r) => arr.map((_, i) => {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - r), J = Math.min(N, i + r); j <= J; j++) { s += arr[j]; c++; }
    return s / c;
  });
  const eNsS = smoothW(eNs, 6);
  // luz: inclinação MUITO suavizada (±18 amostras ≈ 120 px) e contribuição
  // baixa — profundidade vem do gradiente de solo/água e da névoa; luz forte
  // por inclinação vira listras verticais nas encostas
  const slS = smoothW(slV, 18);

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
  // névoa diminiu com a altitude: em altura o horizonte fica limpo e a
  // transição para a visão do planeta inteiro fica suave
  const fogK = clampN(1 - (fr.altV / zoom) / (diag * 0.55), 0.35, 1);
  const colV = [];
  for (let i = 0; i <= N; i++) {
    let c = groundColor(eNsS[i], slS[i], sea, pal);
    c = mulC(c, Math.max(0.9, Math.min(1.08, 1 - slS[i] * 0.55)));   // luz suave
    const distPx = Math.abs(pts[i][0] - W / 2);
    const hz = Math.min(0.42 * fogK, (distPx / (diag * 0.72)) * 0.5);
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

  // PROFUNDIDADE: gradiente vertical por quad da superfície para baixo —
  // o solo escurece com a profundidade (perfil de terra) e a água funda
  // escurece em direção ao leito. Gradiente contínuo (começa em alpha 0 na
  // própria superfície) — nada de blocos chapados semi-transparentes.
  const depthLen = clampN(diag * 0.55, 420, 1500);
  for (let i = 0; i < N; i++) {
    const x0 = pts[i][0], y0 = pts[i][1], x1 = pts[i + 1][0], y1 = pts[i + 1][1];
    if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) continue;
    const water = eNsS[i] < sea;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const ex = mx + down.x * depthLen, ey = my + down.y * depthLen;
    const g = ctx.createLinearGradient(mx, my, ex, ey);
    if (water) {
      g.addColorStop(0, 'rgba(8,22,40,0)');
      g.addColorStop(0.34, 'rgba(8,22,40,0.26)');
      g.addColorStop(1, 'rgba(6,14,28,0.5)');
    } else {
      g.addColorStop(0, 'rgba(20,16,10,0)');
      g.addColorStop(0.3, 'rgba(20,16,10,0.22)');
      g.addColorStop(1, 'rgba(12,10,7,0.48)');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1 + down.x * far, y1 + down.y * far);
    ctx.lineTo(x0 + down.x * far, y0 + down.y * far);
    ctx.closePath();
    ctx.fill();
  }

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

  drawGroundDetails(ctx, W, H, b, zoom, t, fr, sea, amp, h0, pal, look, halfWin, N, eNs, slV, minWL);
  // base de lançamento (só na Gaia): ancorada ao mundo, por cima do terreno
  // e por baixo do foguete — herda o try/catch da chamada acima
  if (b.key === 'gaia' && look.pad !== undefined) {
    drawLaunchPad(ctx, W, H, b, zoom, t, fr, h0, minWL);
  }
}

// ---------- base de lançamento SIMPLES ----------
// ANCORADA AO MUNDO: desenhada no ângulo fixo de spawn (PAD_ANG = π/2, onde o
// jogo nasce: pos (0, R)), sobre o terreno achatado do pad. NÃO segue o
// foguete — quando ele sobe ou afasta, a base fica no lugar. Sem torre: só a
// laje de concreto com o pátio de cascalho e uma sombra de contato SUAVE
// (gradiente que some — nada de bloco chapado semi-transparente).
const PAD_ANG = Math.PI / 2;
function drawLaunchPad(ctx, W, H, b, zoom, t, fr, h0, minWL) {
  const lod = 1 / zoom;                          // px por metro
  if (!(lod > 0.3)) return;                      // longe demais
  const da = wrapPi(PAD_ANG - fr.a0);
  const relX = b.radius * da / zoom;             // px ao longo do horizonte
  if (Math.abs(relX) > W * 0.75 + 60) return;    // pad fora da tela
  const ePad = num(elevAt(b, PAD_ANG, minWL));   // terreno achatado sob o pad
  const relY = (ePad - h0 - fr.altV) / zoom;
  const px = W / 2 + fr.up.x * relY + fr.perp.x * relX;
  const py = H / 2 + fr.up.y * relY + fr.perp.y * relX;
  if (!Number.isFinite(px) || !Number.isFinite(py)) return;
  const up = fr.up, perp = fr.perp;
  const P = (d, h) => [px + perp.x * d * lod + up.x * h * lod, py + perp.y * d * lod + up.y * h * lod];
  const box = (d0, hv, w, h, fill) => {
    const a = P(d0, hv + h), c = P(d0 + w, hv);
    ctx.fillStyle = fill;
    ctx.fillRect(Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.abs(c[0] - a[0]), Math.abs(c[1] - a[1]));
  };

  // sombra de contato: oclusão suave ao redor da laje (gradiente radial que
  // some sozinho — profundidade sem mancha chapada)
  const sc = P(0, -0.8);
  aoBlob(ctx, sc[0], sc[1], Math.max(3, 19 * lod), Math.max(1, 2.4 * lod), '14,18,24', 0.32);

  // base simples: pátio de cascalho + laje de concreto (topo em h=0 — é onde
  // os pés do foguete encostam)
  box(-16, -0.5, 32, 0.5, '#4c5361');            // apron de cascalho
  box(-13, -1.2, 26, 1.2, '#3d4450');            // frente/lateral escura
  box(-13, -0.22, 26, 0.22, '#6e7987');          // face superior clara
  if (lod > 1) {                                 // faixas de perigo na borda
    for (let d = -12; d <= 11; d += 2.4) box(d, -0.42, 1.2, 0.2, '#c9a636');
  }
  if (lod > 1.4) {                               // olhais de fixação no piso
    for (const d of [-9, -3, 3, 9]) {
      const c = P(d, -0.5);
      ctx.fillStyle = '#454c58';
      ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(0.8, 0.26 * lod), 0, 7); ctx.fill();
    }
  }
}

// CACTO (saguaro) da faixa de areia/deserto: tronco em cápsula com costelas,
// 0–2 braços em cotovelo, espinhos claros e florzinha rara. Rígido (não balança).
function drawCactus(ctx, x, y, up, perp, lod, rnd) {
  const hpx = (1.2 + rnd() * 2.0) * lod;           // 1,2–3,2 m (bem visível)
  if (hpx < 5 || !Number.isFinite(hpx)) return;
  const wpx = Math.max(2, hpx * (0.2 + rnd() * 0.08));
  const jx = (rnd() - 0.5) * 0.8 * lod;
  const px = x + perp.x * jx, py = y + perp.y * jx;
  // cor própria por indivíduo (verde desértico com variação)
  const tone = 0.8 + rnd() * 0.4;
  const cMain = mulC(mixC([62, 118, 64], [92, 142, 74], rnd() * 0.6), tone);
  const cDark = mulC(cMain, 0.68);
  const cLight = mulC(cMain, 1.35);
  const P = (du, dp) => [px + up.x * du + perp.x * dp, py + up.y * du + perp.y * dp];
  // oclusão ambiente na base (gradiente radial que some — sem bloco)
  const rAO = wpx * 2.1;
  const gAO = ctx.createRadialGradient(px, py, rAO * 0.1, px, py, rAO);
  gAO.addColorStop(0, 'rgba(22,26,16,0.32)');
  gAO.addColorStop(1, 'rgba(22,26,16,0)');
  ctx.fillStyle = gAO;
  ctx.beginPath();
  ctx.ellipse(px, py, rAO, rAO * 0.4, 0, 0, 7);
  ctx.fill();
  const top = P(hpx, 0);
  ctx.lineCap = 'round';
  // braços primeiro (atrás do tronco)
  const nArms = rnd() < 0.24 ? 0 : rnd() < 0.62 ? 1 : 2;
  for (let a2 = 0; a2 < nArms; a2++) {
    const side = rnd() < 0.5 ? -1 : 1;
    const armH = hpx * (0.3 + rnd() * 0.28);
    const armOut = wpx * (1.3 + rnd() * 1.0);
    const armUp = hpx * (0.2 + rnd() * 0.22);
    const s0 = P(armH, side * wpx * 0.15);
    const c1a = P(armH, side * armOut);
    const e1 = P(armH + armUp, side * armOut);
    ctx.strokeStyle = rgbS(mulC(cMain, 0.94));
    ctx.lineWidth = wpx * 0.6;
    ctx.beginPath();
    ctx.moveTo(s0[0], s0[1]);
    ctx.quadraticCurveTo(c1a[0], c1a[1], e1[0], e1[1]);
    ctx.stroke();
    if (hpx > 12) {                                // sombra na parte de baixo do braço
      ctx.strokeStyle = rgbS(cDark);
      ctx.lineWidth = wpx * 0.16;
      ctx.beginPath();
      ctx.moveTo(s0[0] + perp.x * side * wpx * 0.22, s0[1] + perp.y * side * wpx * 0.22);
      ctx.quadraticCurveTo(c1a[0] + up.x * wpx * 0.3, c1a[1] + up.y * wpx * 0.3,
        e1[0] + up.x * wpx * 0.3, e1[1] + up.y * wpx * 0.3);
      ctx.stroke();
    }
  }
  // tronco: cápsula vertical
  ctx.strokeStyle = rgbS(cMain);
  ctx.lineWidth = wpx;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(top[0], top[1]);
  ctx.stroke();
  if (hpx >= 9) {
    // costelas escuras + aresta de luz
    ctx.strokeStyle = rgbS(cDark);
    ctx.lineWidth = Math.max(0.7, wpx * 0.13);
    for (const off of [-0.24, 0.24]) {
      const b2 = P(hpx * 0.06, wpx * off), t2 = P(hpx * 0.94, wpx * off);
      ctx.beginPath();
      ctx.moveTo(b2[0], b2[1]);
      ctx.lineTo(t2[0], t2[1]);
      ctx.stroke();
    }
    const lb = P(hpx * 0.08, -wpx * 0.34), lt = P(hpx * 0.92, -wpx * 0.34);
    ctx.strokeStyle = rgbS(cLight);
    ctx.lineWidth = Math.max(0.6, wpx * 0.12);
    ctx.beginPath();
    ctx.moveTo(lb[0], lb[1]);
    ctx.lineTo(lt[0], lt[1]);
    ctx.stroke();
  }
  if (hpx > 14) {                                  // espinhos claros nas bordas
    ctx.fillStyle = rgbS(cLight);
    for (let j = 0; j < 5; j++) {
      const du = hpx * (0.18 + j * 0.17);
      for (const off of [-0.52, 0.52]) {
        const sp = P(du, wpx * off);
        ctx.beginPath();
        ctx.arc(sp[0], sp[1], Math.max(0.5, wpx * 0.07), 0, 7);
        ctx.fill();
      }
    }
  }
  if (rnd() < 0.22) {                              // florzinha rara no topo
    const fl = P(hpx + wpx * 0.18, 0);
    ctx.fillStyle = '#e77fa8';
    ctx.beginPath();
    ctx.arc(fl[0], fl[1], Math.max(1, wpx * 0.26), 0, 7);
    ctx.fill();
  }
  ctx.lineCap = 'butt';
}

// Detalhes ancorados ao ângulo mundial (não deslizam quando o foguete se
// move), com identidade POR CORPO: árvores/flores na Gaia, regolito e
// pedregulhos no Crumb, lava no Scorch, dunas no Rusty, ondas na água.
function drawGroundDetails(ctx, W, H, b, zoom, t, fr, sea, amp, h0, pal, look, halfWin, N, eNs, slV, minWL) {
  const diag = Math.hypot(W, H);
  if (fr.altV / zoom > diag * 0.85) return;        // solo está fora da tela
  const lod = 1 / zoom;                            // px por metro
  if (lod < 0.55) return;                          // longe demais p/ detalhes

  const maxCells = 520;
  const cellW = Math.max(1.3 / b.radius, (halfWin * 2) / maxCells);
  const k0 = Math.ceil((fr.a0 - halfWin) / cellW), k1 = Math.floor((fr.a0 + halfWin) / cellW);
  const up = fr.up, perp = fr.perp;
  const ph1 = (hashSeed(((b && b.key) || 'x') + ':floresta') % 628) / 100;
  const ph2 = (hashSeed(((b && b.key) || 'x') + ':matas') % 628) / 100;

  for (let k = k0; k <= k1; k++) {
    const ac = k * cellW;
    const e = num(elevAt(b, ac, minWL));
    const eN = e / amp;
    const idx = Math.max(0, Math.min(N, Math.round(((ac - (fr.a0 - halfWin)) / (2 * halfWin)) * N)));
    const key = biomeKey(eN, num(slV[idx]), sea);
    // sítio da plataforma: sem vegetação num raio de ~22 m do pad
    const nearPad = look.pad !== undefined && Math.abs(wrapPi(ac - look.pad)) * b.radius < 22;

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

    if (key === 'grass' && !nearPad) {
      if (eN - sea < 0.19) {
        // faixa amarela (areia/deserto): NADA de grama — só cactos esparsos
        if (look.flora && lod >= 0.7 && rnd() < 0.1) {
          drawCactus(ctx, ox2, oy2, up, perp, lod, rnd);
        }
      } else if (look.flora) {
        if (rnd() < 0.22) continue;                // quebra a periodicidade das células
        const hpx = (0.4 + rnd() * 1.1) * lod;     // altura do tufo ~0.4–1.5 m
        if (hpx >= 1.6) {
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
          if (rnd() < 0.06) {                      // florzinhas raras na grama
            ctx.fillStyle = rnd() < 0.5 ? 'rgba(246,216,110,0.95)' : 'rgba(242,244,248,0.95)';
            ctx.beginPath();
            ctx.arc(ox2 + up.x * hpx + perp.x * sway, oy2 + up.y * hpx + perp.y * sway,
              Math.max(1, lod * 0.1), 0, 7);
            ctx.fill();
          }
        }
        // árvores em manchas de floresta (mata baixa esparsa fora delas)
        if (look.trees) {
          const fm = Math.sin(k * 0.011 + ph1) * Math.cos(k * 0.0037 + ph2);
          if (rnd() < (fm > 0.25 ? 0.16 : 0.012)) {
            drawTree(ctx, ox2, oy2, up, perp, lod, rnd, pal, t, ac);
          }
        }
      } else {
        // planície árida (regolito/poeira): pontinhos e pedrinhas (cor MISTURADA,
        // opaca — sem manchas translúcidas)
        ctx.fillStyle = rgbS(mixC(pal.grass, pal.grassDark, 0.55));
        for (let j = 0; j < 3; j++) {
          const d2 = (rnd() - 0.5) * 0.8 * lod;
          const dy2 = -(rnd() * 0.3) * lod;
          ctx.beginPath();
          ctx.arc(ox2 + perp.x * d2 + up.x * dy2, oy2 + perp.y * d2 + up.y * dy2,
            Math.max(0.8, lod * (0.07 + rnd() * 0.12)), 0, 7);
          ctx.fill();
        }
        if (rnd() < 0.14) {
          const pr = Math.max(1, lod * 0.15);
          ctx.fillStyle = rgbS(mixC(pal.stone, pal.stoneDark, 0.6));
          ctx.beginPath();
          ctx.arc(ox2 + up.x * pr * 0.4, oy2 + up.y * pr * 0.4, pr, 0, 7);
          ctx.fill();
        }
      }
    } else if (key === 'dirt') {
      ctx.fillStyle = rgbS(mixC(pal.dirt, pal.dirtDark, 0.55));
      for (let j = 0; j < 2; j++) {                // pontinhos de solo
        const d2 = (rnd() - 0.5) * 0.8 * lod;
        const dy2 = -(rnd() * 0.3) * lod;
        ctx.beginPath();
        ctx.arc(ox2 + perp.x * d2 + up.x * dy2, oy2 + perp.y * d2 + up.y * dy2,
          Math.max(0.8, lod * (0.07 + rnd() * 0.09)), 0, 7);
        ctx.fill();
      }
      if (rnd() < 0.14) {                          // pedrinha solta
        const pr = Math.max(1, lod * 0.16);
        ctx.fillStyle = rgbS(mixC(pal.stone, pal.stoneDark, 0.6));
        ctx.beginPath();
        ctx.arc(ox2 + up.x * pr * 0.4, oy2 + up.y * pr * 0.4, pr, 0, 7);
        ctx.fill();
      }
    } else if (key === 'sand') {
      // deserto/areia: só cactos (raros, longe do pad) — nunca grama
      if (look.flora && !nearPad && lod >= 0.8 && rnd() < 0.06) {
        drawCactus(ctx, ox2, oy2, up, perp, lod, rnd);
      }
      if (look.ripples !== false) {
        const len = (0.45 + rnd() * 0.7) * lod;
        if (len >= 2 && rnd() >= 0.35) {
          const dyp = (0.06 + rnd() * 0.22) * lod; // ondulação acima do solo
          ctx.strokeStyle = rgbS(mixC(pal.sand, pal.sandWet, 0.55));
          ctx.lineWidth = Math.max(1, lod * 0.06);
          ctx.beginPath();
          ctx.moveTo(ox2 - perp.x * len / 2 + up.x * dyp, oy2 - perp.y * len / 2 + up.y * dyp);
          ctx.lineTo(ox2 + perp.x * len / 2 + up.x * dyp, oy2 + perp.y * len / 2 + up.y * dyp);
          ctx.stroke();
          if (rnd() < 0.3) {                       // grão claro / conchinha
            const d3 = (rnd() - 0.5) * 0.6 * lod;
            ctx.fillStyle = rgbS(mixC(pal.sand, [246, 238, 208], 0.6));
            ctx.beginPath();
            ctx.arc(ox2 + perp.x * d3 + up.x * lod * 0.05, oy2 + perp.y * d3 + up.y * lod * 0.05,
              Math.max(0.8, lod * 0.05), 0, 7);
            ctx.fill();
          }
        }
      } else {
        // areia árida: grãos soltos
        ctx.fillStyle = rgbS(mixC(pal.sand, pal.sandWet, 0.5));
        const d2 = (rnd() - 0.5) * 0.8 * lod;
        ctx.beginPath();
        ctx.arc(ox2 + perp.x * d2 + up.x * lod * 0.06, oy2 + perp.y * d2 + up.y * lod * 0.06,
          Math.max(0.8, lod * (0.05 + rnd() * 0.07)), 0, 7);
        ctx.fill();
      }
    } else if (key === 'stone') {
      const len = (0.3 + rnd() * 0.5) * lod;
      if (len >= 2 && rnd() >= 0.25) {
        const dir = rnd() < 0.5 ? -1 : 1;
        const dyp = (0.1 + rnd() * 0.3) * lod;
        ctx.strokeStyle = rgbS(mixC(pal.stone, pal.stoneDark, 0.55));
        ctx.lineWidth = Math.max(1, lod * 0.05);
        ctx.beginPath();                           // rachadura
        ctx.moveTo(ox2 - perp.x * len * 0.5 * dir + up.x * dyp,
          oy2 - perp.y * len * 0.5 * dir + up.y * dyp);
        ctx.lineTo(ox2 + perp.x * len * 0.5 * dir + up.x * (dyp - len * 0.25),
          oy2 + perp.y * len * 0.5 * dir + up.y * (dyp - len * 0.25));
        ctx.stroke();
        ctx.fillStyle = rgbS(mixC(pal.stone, pal.stoneLight, 0.55)); // brilho no topo
        ctx.beginPath();
        ctx.arc(ox2 + up.x * lod * 0.12, oy2 + up.y * lod * 0.12, Math.max(1, lod * 0.07), 0, 7);
        ctx.fill();
      }
    } else if (key === 'water') {
      if (lod >= 1.5) {
        const depth = sea - eN;
        const surfY = (sea * amp - h0 - fr.altV) / zoom;
        const sx2 = W / 2 + up.x * surfY + perp.x * relX;
        const sy2 = H / 2 + up.y * surfY + perp.y * relX;
        if (depth < 0.02) {                        // espuma na beira d'água
          const fw = (0.7 + rnd() * 1.2) * lod;
          const fh = Math.max(1.2, lod * 0.12);
          ctx.globalAlpha = 0.4 + 0.3 * Math.sin(t * 2.6 + k * 0.9);
          ctx.fillStyle = rgbS(pal.foam);
          ctx.beginPath();
          ctx.ellipse(sx2, sy2, Math.max(0.1, fw / 2), Math.max(0.1, fh), 0, 0, 7);
          ctx.fill();
          ctx.globalAlpha = 1;
        } else if (depth < 0.3) {                  // ondinha que corre
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

    // pedregulhos (corpos áridos): rochas meio enterradas, determinísticas
    if (look.boulders && key !== 'water' && rnd() < 0.028) {
      const br = (0.5 + rnd() * 1.5) * lod;
      if (br >= 1.6) {
        const squash = 0.55 + rnd() * 0.3;
        const bx2 = ox2 + up.x * br * squash * 0.5, by2 = oy2 + up.y * br * squash * 0.5;
        ctx.fillStyle = rgbS(mixC(pal.stone, mulC(pal.stoneDark, 0.8), rnd() * 0.7));
        ctx.beginPath();
        for (let j = 0; j < 6; j++) {
          const aj = (j / 6) * Math.PI * 2;
          const rj = br * (0.72 + rnd() * 0.5);
          const lx = Math.cos(aj) * rj;
          const ly = Math.sin(aj) * rj * squash;
          const px2 = bx2 + perp.x * lx + up.x * ly;
          const py2 = by2 + perp.y * lx + up.y * ly;
          if (j === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
        }
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = rgbS(mixC(pal.stone, pal.stoneLight, 0.5)); // brilho no topo
        ctx.beginPath();
        ctx.arc(bx2 + up.x * br * squash * 0.3, by2 + up.y * br * squash * 0.3,
          Math.max(1, br * 0.3), 0, 7);
        ctx.fill();
      }
    }

    // rachaduras de lava (Scorch): brilho quente pulsante no chão
    if (look.lava && key !== 'water' && rnd() < 0.1) {
      const len = (0.8 + rnd() * 1.8) * lod;
      if (len >= 1.8) {
        const pulse = 0.55 + 0.45 * Math.sin(t * 2.3 + k * 1.7);
        const dy3 = (0.05 + rnd() * 0.25) * lod;
        const x0 = ox2 - perp.x * len / 2 + up.x * dy3;
        const y0 = oy2 - perp.y * len / 2 + up.y * dy3;
        const x1 = ox2 + perp.x * len / 2 + up.x * dy3;
        const y1 = oy2 + perp.y * len / 2 + up.y * dy3;
        ctx.strokeStyle = `rgba(255,96,24,${(0.3 + 0.3 * pulse).toFixed(3)})`;
        ctx.lineWidth = Math.max(1.2, lod * 0.09);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.strokeStyle = `rgba(255,190,80,${(0.5 + 0.4 * pulse).toFixed(3)})`;
        ctx.lineWidth = Math.max(0.7, lod * 0.035);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
    }
  }
}

// árvore realista: tronco afilado com abaflamento e casca, galhos, copa em
// camadas (sombra embaixo, luz no topo) e variação de cor por indivíduo.
// Duas espécies: frondosa (copa arredondada) e pinheiro (cones empilhados).
// Coordenadas locais: d = ao longo do horizonte, h = para cima (em px).
// ac = ângulo mundial da célula (mantém o balanço estável ao mover a câmera).
function drawTree(ctx, x, y, up, perp, lod, rnd, pal, t, ac) {
  const hM = 3.4 + rnd() * 3.8;                  // altura em metros: 3,4–7,2
  const th = hM * lod;                           // altura em px
  if (th < 2.2) return;
  // identidade da árvore: espécie + tom próprio (diferença de cores visível)
  const pick = rnd();
  let leaf = mixC(pal.grass,
    pick < 0.4 ? [70, 128, 42] : pick < 0.75 ? [128, 162, 56] : [154, 156, 54],
    0.4 + rnd() * 0.35);
  if (rnd() < 0.06) leaf = [176, 118, 46];       // raro: árvore outonal
  const leafDark = mulC(leaf, 0.58);
  const leafLight = mixC(leaf, [234, 246, 178], 0.3);
  const pine = rnd() < 0.28;
  const sway = Math.sin(t * 1.25 + ac * 731.7) * th * 0.026;
  // LOD baixo: silhueta barata (tronco + copa fundidos)
  if (th < 7) {
    ctx.fillStyle = rgbS(mixC(leafDark, [38, 44, 28], 0.25));
    ctx.beginPath();
    ctx.arc(x + up.x * th * 0.62, y + up.y * th * 0.62, th * 0.46, 0, 7);
    ctx.fill();
    return;
  }
  const P = (d, h) => [x + perp.x * d + up.x * h, y + perp.y * d + up.y * h]; // px
  const M = (v) => v * lod;                      // metros → px
  const trunkC = mixC([88, 60, 38], [132, 100, 64], rnd());
  const trunkD = mulC(trunkC, 0.6);
  const lean = (rnd() - 0.5) * 0.14 * th;        // inclinação individual
  const topD = lean + sway * 0.4;
  // sombra de contato no chão: oclusão suave em gradiente (some sozinha —
  // sem elipse chapada semi-transparente)
  const sh = P(M(0.45), M(0.05));
  aoBlob(ctx, sh[0], sh[1], Math.max(1.5, M(hM * 0.22)), Math.max(0.8, M(hM * 0.06)), '18,26,10', 0.3);
  // tronco afilado com abaflamento na base (raiz abre no chão)
  const wb = Math.max(0.9, M(0.17));             // meia-largura na base
  const wt = Math.max(0.5, M(0.06));             // meia-largura no topo
  const thTr = pine ? th * 0.8 : th * 0.62;      // altura do tronco
  ctx.fillStyle = rgbS(trunkC);
  ctx.beginPath();
  ctx.moveTo(...P(-wb * 1.5, 0));
  ctx.lineTo(...P(-wb, thTr * 0.2));
  ctx.lineTo(...P(-wt + topD * 0.5, thTr * 0.55));
  ctx.lineTo(...P(-wt * 0.85 + topD, thTr));
  ctx.lineTo(...P(wt * 0.85 + topD, thTr));
  ctx.lineTo(...P(wt + topD * 0.5, thTr * 0.55));
  ctx.lineTo(...P(wb, thTr * 0.2));
  ctx.lineTo(...P(wb * 1.5, 0));
  ctx.closePath();
  ctx.fill();
  // casca: faceta escura de um lado do tronco
  ctx.strokeStyle = rgbS(trunkD);
  ctx.lineWidth = Math.max(0.8, wb * 0.5);
  ctx.beginPath();
  ctx.moveTo(...P(-wb * 0.55, thTr * 0.06));
  ctx.quadraticCurveTo(
    ...P(-wb * 0.35 + topD * 0.4, thTr * 0.5),
    ...P(-wt * 0.55 + topD, thTr * 0.94));
  ctx.stroke();
  // galhos (só quando a árvore está grande na tela)
  if (th > 16) {
    ctx.lineWidth = Math.max(0.7, wt * 0.45);
    for (const bh of [0.52, 0.7]) {
      const sd = rnd() < 0.5 ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(...P(sd * wt * 0.4 + topD * 0.3, thTr * bh));
      ctx.quadraticCurveTo(
        ...P(sd * M(0.5 + rnd() * 0.5) + topD * 0.6, thTr * (bh + 0.14)),
        ...P(sd * M(0.9 + rnd() * 0.7) + topD + sway * 0.5, thTr * (bh + 0.2)));
      ctx.stroke();
    }
  }
  const cr = pine ? th * 0.3 : th * 0.38;        // raio da copa (px)
  const cd = topD + sway;                        // deslocamento da copa
  const ch = pine ? th * 0.86 : th * 0.82;       // centro da copa (px)
  if (pine) {
    // pinheiro: 3 cones empilhados, escuros embaixo → claros em cima
    for (let i = 0; i < 3; i++) {
      const wT = cr * (1.6 - i * 0.45);
      const yB = ch - th * 0.24 * i;
      ctx.fillStyle = rgbS(mixC(leafDark, leaf, i / 2));
      ctx.beginPath();
      ctx.moveTo(...P(cd * (0.6 + i * 0.2), yB + th * 0.3));
      ctx.lineTo(...P(cd * 0.8 - wT, yB));
      ctx.lineTo(...P(cd * 0.8 + wT, yB));
      ctx.closePath();
      ctx.fill();
    }
  } else {
    // copa frondosa: bolhas individuais (escuras embaixo) + volume + luz
    const nb = 5 + Math.floor(rnd() * 3);
    for (let i = 0; i < nb; i++) {
      const ba = rnd() * Math.PI * 2;
      const bd = cd + Math.cos(ba) * cr * 0.62;
      const bh2 = ch + Math.sin(ba) * cr * 0.5;
      ctx.fillStyle = rgbS(Math.sin(ba) < -0.25 ? leafDark : leaf);
      ctx.beginPath();
      ctx.arc(...P(bd, bh2), Math.max(1.2, cr * (0.3 + rnd() * 0.45)), 0, 7);
      ctx.fill();
    }
    ctx.fillStyle = rgbS(leafDark);              // volume sombreado (baixo)
    ctx.beginPath();
    ctx.arc(...P(cd - cr * 0.2, ch - cr * 0.3), Math.max(1.5, cr * 0.7), 0, 7);
    ctx.fill();
    ctx.fillStyle = rgbS(leaf);                  // massa principal
    ctx.beginPath();
    ctx.arc(...P(cd + cr * 0.08, ch + cr * 0.14), Math.max(1.5, cr * 0.64), 0, 7);
    ctx.fill();
    ctx.fillStyle = rgbS(leafLight);             // luz do sol no topo
    ctx.beginPath();
    ctx.arc(...P(cd + cr * 0.22, ch + cr * 0.36), Math.max(1, cr * 0.36), 0, 7);
    ctx.fill();
    if (th > 24) {                               // folhas iluminadas (pontinhos)
      ctx.fillStyle = rgbS(mixC(leafLight, [255, 255, 214], 0.4));
      for (let i = 0; i < 4; i++) {
        const ba = rnd() * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(...P(cd + Math.cos(ba) * cr * 0.5, ch + cr * 0.28 + Math.sin(ba) * cr * 0.34),
          Math.max(0.8, th * 0.028), 0, 7);
        ctx.fill();
      }
    }
  }
}

// ---------- planeta de longe com o TERRENO REAL ----------
// O disco é desenhado com a MESMA função de elevação e as MESMAS cores de
// bioma do terreno de perto: montanhas, praias, oceanos e crateras batem
// nas duas escalas. Sem blobs fake, SEM CALOTAS POLARES.
function drawBodyFar(ctx, b, sx, sy, rPx, t, W, H) {
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(rPx) || rPx <= 0) return;
  const look = bodyLook(b);
  const pal = look.pal;

  if (rPx < 8) {
    ctx.fillStyle = rgbS(look.farCore || hexRGBc((b && b.color) || '#8a8f98'));
    ctx.beginPath(); ctx.arc(sx, sy, rPx, 0, 7); ctx.fill();
    return;
  }
  if (b.star) { drawStarDisc(ctx, b, sx, sy, rPx); return; }

  const r = num(b && b.radius, 600000);
  const amp = ampOf(b);
  const sea = look.ocean ? -0.28 : -Infinity;
  const zoomM = r / rPx;                 // metros por px neste corpo
  const reliefPx = amp / zoomM;          // amplitude do relevo em px

  // arco visível do círculo: cone que a tela ocupa vista do centro do planeta
  const aC = Math.atan2(H / 2 - sy, W / 2 - sx);
  let halfAng = 0;
  for (const cx2 of [0, W]) {
    for (const cy2 of [0, H]) {
      const da = Math.abs(wrapPi(Math.atan2(cy2 - sy, cx2 - sx) - aC));
      if (da > halfAng) halfAng = da;
    }
  }
  halfAng += 0.09;
  // disco inteiro dentro da tela → desenha o círculo completo
  if (sx - rPx >= 0 && sx + rPx <= W && sy - rPx >= 0 && sy + rPx <= H) halfAng = Math.PI;
  halfAng = clampN(halfAng, 0.04, Math.PI);

  const M = Math.round(clampN(rPx * 1.1, 240, 640));
  const a0 = aC - halfAng, a1 = aC + halfAng;
  const minWL = (r * (a1 - a0)) / M;   // arco por amostra → anti-aliasing do disco

  const eN = new Array(M + 1);
  for (let i = 0; i <= M; i++) {
    const a = a0 + (a1 - a0) * i / M;
    eN[i] = num(elevAt(b, a, minWL)) / amp;
  }
  const sl = new Array(M + 1);
  for (let i = 0; i <= M; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(M, i + 1);
    const arcM = (r * (i1 - i0) * (a1 - a0)) / M + 1e-9;
    sl[i] = ((eN[i1] - eN[i0]) * amp) / arcM;
  }
  // cor da banda: média móvel LARGA (±6 amostras ≈ 7,5 km) — sem isso as
  // colinas de 2–3 km cruzam os limites de bioma a cada poucos px e a banda
  // vira listras radiais. O padrão macro (continentes/oceanos) é preservado.
  const smooth = (arr, r) => arr.map((_, i) => {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - r), J = Math.min(M, i + r); j <= J; j++) { s += arr[j]; c++; }
    return s / c;
  });
  const eNs = smooth(eN, 6), slS = smooth(sl, 6);

  const surfPx = (i) => rPx + eN[i] * reliefPx;   // raio px da superfície
  const seaR = rPx + sea * reliefPx;              // nível do mar (abaixo do raio)
  const bandIn = rPx - clampN(reliefPx * 1.5, 2.2, rPx * 0.3);

  // 1) interior do disco (manto rochoso / oceano profundo)
  const core = look.farCore || mulC(pal.stoneDark, 0.6);
  const gCore = ctx.createRadialGradient(sx, sy, rPx * 0.15, sx, sy, rPx);
  gCore.addColorStop(0, rgbS(mulC(core, 1.1)));
  gCore.addColorStop(1, rgbS(mulC(core, 0.7)));
  ctx.fillStyle = gCore;
  ctx.beginPath(); ctx.arc(sx, sy, rPx, 0, 7); ctx.fill();

  // 2) banda de terreno: água plana (rasa→funda) e terra por bioma
  for (let i = 0; i < M; i++) {
    const aa0 = a0 + (a1 - a0) * i / M;
    const aa1 = a0 + (a1 - a0) * (i + 1) / M;
    let c, rO0, rO1, rI0, rI1;
    if (eN[i] < sea) {
      const depth = clampN((sea - eNs[i]) / 0.5, 0, 1);
      c = mixC(pal.shallow, pal.deep, depth);
      rO0 = rO1 = seaR;                      // superfície da água é plana
      rI0 = surfPx(i); rI1 = surfPx(i + 1);  // leito
    } else {
      c = groundColor(eNs[i], slS[i], sea, pal);
      c = mulC(c, clampN(1 - slS[i] * 1.0, 0.82, 1.12)); // luz pela inclinação (suave)
      rO0 = surfPx(i); rO1 = surfPx(i + 1);
      rI0 = rI1 = bandIn;
    }
    const paint = rgbS(c);
    ctx.fillStyle = paint;
    ctx.strokeStyle = paint;                 // mata frestas de antialiasing
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx + Math.cos(aa0) * rO0, sy + Math.sin(aa0) * rO0);
    ctx.lineTo(sx + Math.cos(aa1) * rO1, sy + Math.sin(aa1) * rO1);
    ctx.lineTo(sx + Math.cos(aa1) * rI1, sy + Math.sin(aa1) * rI1);
    ctx.lineTo(sx + Math.cos(aa0) * rI0, sy + Math.sin(aa0) * rI0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // 3) nuvens ancoradas ao corpo (Gaia): frisas suaves na borda do disco
  if (look.clouds && rPx > 24) {
    let s = hashSeed(((b && b.key) || 'x') + ':nuvens') || 1;
    const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
    ctx.save();
    ctx.lineCap = 'round';
    for (let j = 0; j < 18; j++) {
      const ca = rnd() * Math.PI * 2;
      const rr = rPx * (1.012 + rnd() * 0.05);
      const len = 0.06 + rnd() * 0.16;
      ctx.strokeStyle = `rgba(255,255,255,${(0.07 + rnd() * 0.11).toFixed(3)})`;
      ctx.lineWidth = Math.max(0.8, rPx * (0.01 + rnd() * 0.018));
      ctx.beginPath();
      ctx.arc(sx, sy, rr, ca, ca + len);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// estrela: disco de plasma com granulação e manchas solares
function drawStarDisc(ctx, b, sx, sy, rPx) {
  const g = ctx.createRadialGradient(sx, sy, rPx * 0.1, sx, sy, rPx);
  g.addColorStop(0, '#fff8dc');
  g.addColorStop(0.55, '#ffd75e');
  g.addColorStop(1, '#ff9d2e');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(sx, sy, rPx, 0, 7); ctx.fill();
  let s = hashSeed(((b && b.key) || 'helios') + ':manchas') || 1;
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
  for (let j = 0; j < 9; j++) {
    const ma = rnd() * Math.PI * 2, mr = rnd() * rPx * 0.78;
    const ms = rPx * (0.02 + rnd() * 0.06);
    ctx.fillStyle = `rgba(200,90,20,${(0.1 + rnd() * 0.18).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(sx + Math.cos(ma) * mr, sy + Math.sin(ma) * mr, Math.max(0.6, ms), 0, 7);
    ctx.fill();
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

// gancho para harnesses de teste (não usado pelo jogo)
export { elevLocal as debugElevLocal };
