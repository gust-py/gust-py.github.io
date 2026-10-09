<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'three/addons/libs/lil-gui.module.min.js';

/* ---- lê os shaders que já estão no HTML ---- */
const noise = document.getElementById('noise-functions').textContent;
const planetVert = noise + document.getElementById('planet-vert-shader').textContent;
const planetFrag = noise + document.getElementById('planet-frag-shader').textContent;
const atmoVert   = document.getElementById('atmosphere-vert-shader').textContent;
const atmoFrag   = noise + document.getElementById('atmosphere-frag-shader').textContent;

/* ---- renderer / cena / câmera ---- */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070f);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 1.1, 3.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 1.5;
controls.maxDistance = 10;

/* ---- luz (compartilhada planeta/atmosfera) ---- */
const lightDirection = new THREE.Vector3(1, 0.35, 0.5).normalize();

/* ---- planeta ---- */
const R = 1;
const planetGeo = new THREE.SphereGeometry(R, 256, 256);

// tangente "para o leste" em cada vértice (usada no bump mapping)
{
  const count = planetGeo.attributes.position.count;
  const tangents = new Float32Array(count * 3);
  const p = new THREE.Vector3(), t = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    p.fromBufferAttribute(planetGeo.attributes.position, i).normalize();
    t.crossVectors(up, p);
    if (t.lengthSq() < 1e-8) t.set(1, 0, 0); // polos
    t.normalize();
    tangents.set([t.x, t.y, t.z], i * 3);
  }
  planetGeo.setAttribute('tangent', new THREE.BufferAttribute(tangents, 3));
}

const u = {
  type: { value: 2 }, radius: { value: R },
  amplitude: { value: 0.12 }, sharpness: { value: 2.2 }, offset: { value: 0.01 },
  period: { value: 1.4 }, persistence: { value: 0.5 }, lacunarity: { value: 2.1 },
  octaves: { value: 6 }, bumpStrength: { value: 0.7 }, bumpOffset: { value: 0.01 },
  color1: { value: new THREE.Color('#0b2e59') },
  color2: { value: new THREE.Color('#1d6fa5') },
  color3: { value: new THREE.Color('#4c7a3f') },
  color4: { value: new THREE.Color('#8c7a5b') },
  color5: { value: new THREE.Color('#f0f4f8') },
  transition2: { value: 0.02 }, transition3: { value: 0.06 },
  transition4: { value: 0.09 }, transition5: { value: 0.125 },
  blend12: { value: 0.015 }, blend23: { value: 0.02 },
  blend34: { value: 0.02 }, blend45: { value: 0.03 },
  ambientIntensity: { value: 0.08 }, diffuseIntensity: { value: 1.0 },
  specularIntensity: { value: 0.5 }, shininess: { value: 64 },
  lightDirection: { value: lightDirection },
  lightColor: { value: new THREE.Color('#fff2df') },
};

scene.add(new THREE.Mesh(planetGeo,
  new THREE.ShaderMaterial({ uniforms: u, vertexShader: planetVert, fragmentShader: planetFrag })));

/* ---- atmosfera (partículas) ---- */
function makeSpriteTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const COUNT = 3500;
const positions = new Float32Array(COUNT * 3), sizes = new Float32Array(COUNT);
for (let i = 0; i < COUNT; i++) {
  const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
  const r = R * 1.05 + Math.random() * 0.05;
  positions.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th)], i * 3);
  sizes[i] = 14 + Math.random() * 26;
}
const atmoGeo = new THREE.BufferGeometry();
atmoGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
atmoGeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

const ua = {
  time: { value: 0 }, speed: { value: 0.03 }, opacity: { value: 0.45 },
  density: { value: 0.3 }, scale: { value: 0.5 },
  lightDirection: { value: lightDirection },
  color: { value: new THREE.Color('#86b5ff') },
  pointTexture: { value: makeSpriteTexture() },
};

scene.add(new THREE.Points(atmoGeo, new THREE.ShaderMaterial({
  uniforms: ua, vertexShader: atmoVert, fragmentShader: atmoFrag,
  transparent: true, depthWrite: false,
})));

/* ---- GUI ---- */
const gui = new GUI({ title: 'Planeta procedural' });
const fT = gui.addFolder('Terreno');
fT.add(u.type, 'value', { 'Suave (1)': 1, 'Colinas (2)': 2, 'Cordilheiras (3)': 3 }).name('tipo');
fT.add(u.amplitude, 'value', 0.01, 0.3, 0.001);
fT.add(u.sharpness, 'value', 0.5, 6, 0.1);
fT.add(u.offset, 'value', 0, 0.1, 0.001);
fT.add(u.period, 'value', 0.3, 4, 0.01);
fT.add(u.persistence, 'value', 0.2, 0.9, 0.01);
fT.add(u.lacunarity, 'value', 1.2, 3.5, 0.01);
fT.add(u.octaves, 'value', 1, 8, 1);
fT.add(u.bumpStrength, 'value', 0, 1, 0.01);
fT.add(u.bumpOffset, 'value', 0.002, 0.05, 0.001);
const fC = gui.addFolder('Cores e camadas');
fC.addColor(u.color1, 'value').name('oceano profundo');
fC.addColor(u.color2, 'value').name('água rasa');
fC.addColor(u.color3, 'value').name('terra');
fC.addColor(u.color4, 'value').name('rocha');
fC.addColor(u.color5, 'value').name('neve');
fC.add(u.transition2, 'value', 0.001, 0.2, 0.001).name('nível 2');
fC.add(u.transition3, 'value', 0.001, 0.2, 0.001).name('nível 3 (mar)');
fC.add(u.transition4, 'value', 0.001, 0.2, 0.001).name('nível 4');
fC.add(u.transition5, 'value', 0.001, 0.2, 0.001).name('nível 5');
fC.add(u.blend12, 'value', 0, 0.1, 0.001).name('blend 1-2');
fC.add(u.blend23, 'value', 0, 0.1, 0.001).name('blend 2-3');
fC.add(u.blend34, 'value', 0, 0.1, 0.001).name('blend 3-4');
fC.add(u.blend45, 'value', 0, 0.1, 0.001).name('blend 4-5');
const fL = gui.addFolder('Luz');
fL.add(u.ambientIntensity, 'value', 0, 0.5, 0.01).name('ambiente');
fL.add(u.diffuseIntensity, 'value', 0, 2, 0.01).name('difusa');
fL.add(u.specularIntensity, 'value', 0, 1, 0.01).name('especular');
fL.add(u.shininess, 'value', 2, 128, 1).name('brilho');
const fA = gui.addFolder('Atmosfera');
fA.add(ua.opacity, 'value', 0, 1, 0.01);
fA.add(ua.density, 'value', 0, 1, 0.01);
fA.add(ua.scale, 'value', 0.1, 2, 0.01);
fA.add(ua.speed, 'value', 0, 0.3, 0.005);

/* ---- loop ---- */
const clock = new THREE.Clock();
const EIXO_Y = new THREE.Vector3(0, 1, 0);
renderer.setAnimationLoop(() => {
  ua.time.value += clock.getDelta();
  lightDirection.applyAxisAngle(EIXO_Y, 0.001); // "dia" passando devagar
  controls.update();
  renderer.render(scene, camera);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
</script>
