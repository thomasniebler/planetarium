// Milky Way scene: ~100k test particles orbiting in an analytic potential with a rotating bar and spiral arms.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { query, LOW, createRenderer, WORKERS, fpsMeter } from '../common/gfx.js';
import { MWPotential, R_SUN, Z_SUN, V_SUN } from './mwpotential.js';
import { buildPopulations, TYPE } from './mwmodel.js';
import { KMS } from './units.js';
import { Pool, sliceArrays } from './pool.js';
import { particleMaterial, pointScale, backdrop } from './points.js';
import { rotationCurve } from './rotcurve.js';

// physics: Galactocentric kpc, z = north Galactic pole.  scene: (x, y, z) -> (x, z, -y), y up
const toScene = (x, y, z, v) => v.set(x, z, -y);
const WARM = 250; // Myr of warm-up before "today"
const QUALITY = Number(query.get('n') ?? (LOW ? 0.35 : 1));

const params = {
  haloMult: 1, barStrength: 1, barOmega: 40, spiralStrength: 1, spiralOmega: 20,
  speedExp: Number(query.get('speed') ?? 1), paused: query.has('paused'),
  focus: query.get('focus') === 'sun' ? 'Sun' : 'Galactic centre',
  brightness: 1, old: true, young: true, gas: true, dust: true, sunOrbit: true, labels: true,
  reset: () => restart(),
};

// --- renderer --------------------------------------------------------------------------------
const renderer = createRenderer();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 1e6);
camera.position.set(0, 26, 34);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.zoomSpeed = 1.4;
controls.minDistance = 0.3; controls.maxDistance = 400;
backdrop(scene, 3000, 5e4);

const STYLE = /* glsl */ `
  void style(float type, float seed, float val, out vec3 col, out float inten, out float size, out float cap){
    cap = 3.0; size = 0.05;
    if (type < 0.5) {            // thin disk: mixed old population, slightly bluer than the rest
      col = mix(vec3(1.0, 0.84, 0.64), vec3(1.0, 0.95, 0.88), seed); inten = 0.45;
    } else if (type < 1.5) {     // thick disk
      col = vec3(1.0, 0.78, 0.55); inten = 0.45;
    } else if (type < 2.5) {     // bulge / bar
      col = mix(vec3(1.0, 0.74, 0.42), vec3(1.0, 0.88, 0.7), seed); inten = 0.5;
    } else if (type < 3.5) {     // stellar halo
      col = vec3(1.0, 0.8, 0.62); inten = 0.3;
    } else if (type < 4.5) {     // young stars: blue-white when born, fading and reddening with age
      float a = clamp(val, 0.0, 1.0);
      col = mix(vec3(0.5, 0.68, 1.0), vec3(1.0, 0.93, 0.8), smoothstep(0.15, 1.0, a));
      inten = 3.0 * smoothstep(0.0, 0.03, a) * pow(1.0 - a, 1.2) * (0.6 + 0.8 * seed);
      size = 0.075; cap = 3.5;
    } else if (type < 5.5) {     // HII regions: pink glowing gas around the youngest clusters
      float a = clamp(val, 0.0, 1.0);
      col = vec3(1.0, 0.32, 0.5); inten = 0.7 * sin(3.14159 * a) * (0.5 + seed);
      size = 0.05 + 0.08 * seed; cap = 40.0;
    } else {                     // dust (absorption per colour channel, reddens what is behind it)
      float a = clamp(val, 0.0, 1.0);
      col = vec3(0.55, 0.68, 0.8); inten = 0.5 * sin(3.14159 * a);
      size = 0.12 + 0.15 * seed; cap = 70.0;
    }
  }`;
const starMat = particleMaterial(STYLE, { types: 7 });
const dustMat = particleMaterial(STYLE, { types: 7, dust: true });

// --- simulation state --------------------------------------------------------------------------
const P = new MWPotential();
let pool, S, points = [], posArr, valArr, ready = false;
const loadingEl = document.getElementById('loading');

function geometryFor(a, b) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(posArr.subarray(3 * a, 3 * b), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aVal', new THREE.BufferAttribute(valArr.subarray(a, b), 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aType', new THREE.BufferAttribute(Float32Array.from(S.type.subarray(a, b)), 1));
  g.setAttribute('aSeed', new THREE.BufferAttribute(S.seed.subarray(a, b), 1));
  return g;
}

async function start() {
  ready = false;
  loadingEl.textContent = 'Settling stars into their orbits…';
  loadingEl.classList.remove('done');
  await new Promise((r) => setTimeout(r, 30)); // let the message paint
  const pp = { haloMult: params.haloMult, barStrength: params.barStrength, barOmega: params.barOmega,
    spiralStrength: params.spiralStrength, spiralOmega: params.spiralOmega };
  P.update(pp);
  P.setTime(-WARM);
  S = buildPopulations(P, QUALITY);
  posArr = new Float32Array(3 * S.n); valArr = new Float32Array(S.n);
  for (let i = 0; i < S.n; i++) {
    // physics -> scene axes
    posArr[3 * i] = S.pos[3 * i]; posArr[3 * i + 1] = S.pos[3 * i + 2]; posArr[3 * i + 2] = -S.pos[3 * i + 1];
  }
  points.forEach((p) => { scene.remove(p); p.geometry.dispose(); });
  points = [new THREE.Points(geometryFor(0, S.dustStart), starMat), new THREE.Points(geometryFor(S.dustStart, S.n), dustMat)];
  points.forEach((p, k) => { p.frustumCulled = false; p.renderOrder = k; scene.add(p); });

  pool?.terminate();
  pool = new Pool(() => new Worker(new URL('./mw.worker.js', import.meta.url), { type: 'module' }), WORKERS, S.n);
  await pool.init((k, a, b) => {
    const slice = sliceArrays({ pos: S.pos, vel: S.vel, type: S.type, born: S.born, life: S.life }, a, b, { pos: 3, vel: 3 });
    return [{ cmd: 'init', slice, seed: 1000 + k, t0: -WARM, params: pp }];
  });
  pool.step(0, onSlice, onAll); // fetch the settled state
  resetSun();
  ready = true;
  loadingEl.classList.add('done');
}

function onSlice(a, pos, val) {
  // worker positions are physics axes; convert while copying
  for (let i = 0, m = pos.length / 3; i < m; i++) {
    const o = 3 * (a + i);
    posArr[o] = pos[3 * i]; posArr[o + 1] = pos[3 * i + 2]; posArr[o + 2] = -pos[3 * i + 1];
  }
  valArr.set(val, a);
}
function onAll(data) {
  points.forEach((p) => { p.geometry.attributes.position.needsUpdate = true; p.geometry.attributes.aVal.needsUpdate = true; });
  advanceSun(data.t);
}

// --- the Sun: one more test particle, integrated here so we can draw its orbit -----------------
const sun = { pos: new Float64Array(3), vel: new Float64Array(3), acc: new Float64Array(3), t: 0, angle: 0, lastPhi: Math.PI };
const TRAIL = 400;
const trailBuf = new Float32Array(TRAIL * 3);
let trailCount = 0, trailHead = 0, trailLastT = -1e9;
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((TRAIL + 1) * 3), 3));
const trailCol = new Float32Array((TRAIL + 1) * 3);
for (let k = 0; k <= TRAIL; k++) { const f = Math.pow(1 - k / TRAIL, 1.3) * 0.9; trailCol.set([1.0 * f, 0.85 * f, 0.35 * f], 3 * k); }
trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
trail.frustumCulled = false; trail.renderOrder = 3;
scene.add(trail);
const sunDot = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), new THREE.MeshBasicMaterial({ color: 0xffe08a, depthTest: false }));
sunDot.renderOrder = 4;
scene.add(sunDot);

function resetSun() {
  sun.pos.set([-R_SUN, 0, Z_SUN]);
  sun.vel.set(V_SUN.map((v) => v * KMS));
  sun.t = 0; sun.angle = 0; sun.lastPhi = Math.PI;
  P.setTime(0); P.acc(sun.pos[0], sun.pos[1], sun.pos[2], sun.acc);
  trailCount = 0; trailHead = 0; trailLastT = -1e9;
}
function advanceSun(t) {
  const total = t - sun.t;
  if (total <= 0) return;
  const steps = Math.ceil(total / 0.5 - 1e-9), dt = total / steps, { pos, vel, acc } = sun;
  for (let s = 0; s < steps; s++) {
    for (let k = 0; k < 3; k++) { vel[k] += acc[k] * dt / 2; pos[k] += vel[k] * dt; }
    sun.t += dt; P.setTime(sun.t); P.acc(pos[0], pos[1], pos[2], acc);
    for (let k = 0; k < 3; k++) vel[k] += acc[k] * dt / 2;
    const phi = Math.atan2(pos[1], pos[0]);
    let d = phi - sun.lastPhi; d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
    sun.angle -= d; sun.lastPhi = phi; // the Galaxy turns towards -phi
    if (sun.t - trailLastT >= 1.5) {
      trailBuf.set([pos[0], pos[2], -pos[1]], trailHead * 3);
      trailHead = (trailHead + 1) % TRAIL; trailCount = Math.min(trailCount + 1, TRAIL); trailLastT = sun.t;
    }
  }
  sun.t = t;
}
function updateTrail() {
  const arr = trailGeo.attributes.position.array;
  arr.set([sun.pos[0], sun.pos[2], -sun.pos[1]], 0);
  for (let k = 0; k < trailCount; k++) {
    const q = ((trailHead - 1 - k + TRAIL) % TRAIL) * 3;
    arr[3 * k + 3] = trailBuf[q]; arr[3 * k + 4] = trailBuf[q + 1]; arr[3 * k + 5] = trailBuf[q + 2];
  }
  trailGeo.setDrawRange(0, trailCount + 1);
  trailGeo.attributes.position.needsUpdate = true;
  trail.visible = params.sunOrbit;
}

// --- labels --------------------------------------------------------------------------------------
const labelRoot = document.getElementById('labels');
const mkLabel = (text, onClick) => {
  const el = document.createElement('div');
  el.className = 'label'; el.innerHTML = `<i></i>${text}`;
  if (onClick) el.addEventListener('click', onClick);
  labelRoot.appendChild(el);
  return el;
};
const labels = [
  { el: mkLabel('Sun', () => setFocus('Sun')), pos: () => tmpA.set(sun.pos[0], sun.pos[2], -sun.pos[1]) },
  { el: mkLabel('Sgr A* (central black hole)', () => setFocus('Galactic centre')), pos: () => tmpA.set(0, 0, 0) },
];
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();

// --- camera focus --------------------------------------------------------------------------------
let flyTo = null;
function focusPoint(v) {
  return params.focus === 'Sun' ? v.set(sun.pos[0], sun.pos[2], -sun.pos[1]) : v.set(0, 0, 0);
}
function setFocus(name) {
  params.focus = name;
  flyTo = name === 'Sun' ? 4 : 45;
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
}
controls.addEventListener('start', () => { flyTo = null; });

// --- GUI -----------------------------------------------------------------------------------------
const gui = new GUI({ title: 'Milky Way' });
const pushParams = () => {
  const pp = { haloMult: params.haloMult, barStrength: params.barStrength, barOmega: params.barOmega,
    spiralStrength: params.spiralStrength, spiralOmega: params.spiralOmega };
  P.update(pp); P.setTime(sun.t); P.acc(sun.pos[0], sun.pos[1], sun.pos[2], sun.acc);
  pool?.broadcast({ cmd: 'params', params: pp });
  curve.draw();
};
const fPhys = gui.addFolder('Physics');
fPhys.add(params, 'haloMult', 0, 3, 0.01).name('Dark matter ×').onChange(pushParams);
fPhys.add(params, 'barStrength', 0, 3, 0.01).name('Bar strength ×').onChange(pushParams);
fPhys.add(params, 'barOmega', 10, 80, 1).name('Bar speed (km/s/kpc)').onChange(pushParams);
fPhys.add(params, 'spiralStrength', 0, 4, 0.01).name('Spiral strength ×').onChange(pushParams);
fPhys.add(params, 'spiralOmega', 5, 60, 1).name('Spiral speed (km/s/kpc)').onChange(pushParams);
const fTime = gui.addFolder('Time');
fTime.add(params, 'speedExp', -1, 2.7, 0.01).name('Speed: 10^x Myr/s');
fTime.add(params, 'paused').name('Paused');
const fView = gui.addFolder('View');
fView.add(params, 'focus', ['Galactic centre', 'Sun']).name('Focus').onChange(setFocus);
fView.add(params, 'brightness', 0.2, 4, 0.01).name('Brightness');
fView.add(params, 'old').name('Old stars').onChange(updateShow);
fView.add(params, 'young').name('Young stars').onChange(updateShow);
fView.add(params, 'gas').name('Glowing gas (HII)').onChange(updateShow);
fView.add(params, 'dust').name('Dust').onChange(updateShow);
fView.add(params, 'sunOrbit').name("Sun's path");
fView.add(params, 'labels').name('Labels').onChange((v) => { labelRoot.style.display = v ? '' : 'none'; });
gui.add(params, 'reset').name('Restart (today, keep parameters)');
function updateShow() {
  const o = params.old ? 1 : 0;
  starMat.uniforms.uShow.value = [o, o, o, o, params.young ? 1 : 0, params.gas ? 1 : 0, 0];
  dustMat.uniforms.uShow.value = [0, 0, 0, 0, 0, 0, params.dust ? 1 : 0];
}
updateShow();

async function restart() {
  if (!ready) return;
  await start();
}

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { params.paused = !params.paused; e.preventDefault(); }
  else if (e.key === ',') params.speedExp = Math.max(-1, params.speedExp - 0.15);
  else if (e.key === '.') params.speedExp = Math.min(2.7, params.speedExp + 0.15);
  else return;
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- HUD -----------------------------------------------------------------------------------------
const timeEl = document.getElementById('date'), speedEl = document.getElementById('speed'), infoEl = document.getElementById('facts');
const curve = rotationCurve(document.getElementById('curve'), P, () => Math.hypot(sun.pos[0], sun.pos[1]));
const fmtT = (t) => (Math.abs(t) >= 1000 ? `${(t / 1000).toFixed(2)} billion years` : `${t.toFixed(1)} million years`);
const meter = fpsMeter();
let effSpeed = 0, lastPoolT = 0, hudTick = 0;
function updateHud() {
  timeEl.textContent = sun.t < 0.05 ? 'Today' : `Today + ${fmtT(sun.t)}`;
  const want = Math.pow(10, params.speedExp);
  const lag = !params.paused && effSpeed < 0.8 * want ? ` (running at ${effSpeed.toFixed(effSpeed < 10 ? 1 : 0)} – CPU limit)` : '';
  speedEl.textContent = `${params.paused ? 'paused' : `${want < 10 ? want.toFixed(1) : want.toFixed(0)} Myr per second${lag}`}`
    + ` · ${(S?.n ?? 0).toLocaleString('en')} particles on ${pool?.workers.length ?? 0} threads · ${meter.fps.toFixed(0)} fps`;
  curve.tick();
  const R = Math.hypot(sun.pos[0], sun.pos[1]);
  const v = Math.hypot(...sun.vel) / KMS;
  const vc = P.vcirc(R) / KMS, vh = P.vcirc(R, 4) / KMS;
  infoEl.innerHTML = `<table>
    <tr><td>Sun – Galactic centre</td><td>${(R * 3261.6).toFixed(0)} light-years (${R.toFixed(2)} kpc)</td></tr>
    <tr><td>Height above the disk</td><td>${(sun.pos[2] * 3261.6).toFixed(0)} light-years</td></tr>
    <tr><td>Sun's orbital speed</td><td>${v.toFixed(0)} km/s</td></tr>
    <tr><td>Orbits completed</td><td>${(sun.angle / (2 * Math.PI)).toFixed(2)}</td></tr>
    <tr><td>Dark matter share of gravity here</td><td>${Math.round((100 * vh * vh) / Math.max(vc * vc, 1e-9))} %</td></tr>
  </table>`;
}

// --- main loop -----------------------------------------------------------------------------------
let last = performance.now(), wanted = 0, realAcc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const raw = now - last; last = now;
  meter.tick(raw);
  const dtReal = Math.min(raw / 1000, 0.1);

  if (ready && !params.paused) {
    const speed = Math.pow(10, params.speedExp);
    wanted = Math.min(wanted + dtReal * speed, Math.max(speed * 0.15, 1));
    realAcc += dtReal;
    if (!pool.busy && wanted > 0) {
      const req = wanted;
      wanted = 0;
      pool.step(req, onSlice, onAll);
    }
    if (realAcc > 0.5) { effSpeed = (pool.t - lastPoolT) / realAcc; lastPoolT = pool.t; realAcc = 0; }
  } else if (ready) { lastPoolT = pool.t; realAcc = 0; }

  // camera follows the focus point
  focusPoint(tmpA);
  const k = flyTo !== null ? 1 - Math.exp(-5 * dtReal) : 1;
  tmpB.subVectors(tmpA, controls.target).multiplyScalar(k);
  controls.target.add(tmpB); camera.position.add(tmpB);
  if (flyTo !== null) {
    const off = tmpB.subVectors(camera.position, controls.target), d = off.length();
    const nd = d * Math.pow(flyTo / d, 1 - Math.exp(-3 * dtReal));
    off.setLength(nd); camera.position.copy(controls.target).add(off);
    if (Math.abs(Math.log(nd / flyTo)) < 0.01 && tmpA.distanceTo(controls.target) < 0.01) flyTo = null;
  }
  controls.update();

  const scale = pointScale(renderer, camera);
  for (const m of [starMat, dustMat]) { m.uniforms.uScale.value = scale; m.uniforms.uBright.value = params.brightness; m.uniforms.uMinPx.value = LOW ? 1.2 : 1.5 * renderer.getPixelRatio(); }
  dustMat.uniforms.uBright.value = 1;
  updateTrail();
  sunDot.position.set(sun.pos[0], sun.pos[2], -sun.pos[1]);
  sunDot.scale.setScalar(camera.position.distanceTo(sunDot.position) * 0.004);
  renderer.render(scene, camera);

  if (params.labels) {
    for (const l of labels) {
      const w = l.pos();
      tmpB.copy(w).applyMatrix4(camera.matrixWorldInverse);
      w.project(camera);
      const show = tmpB.z < 0 && Math.abs(tmpA.x) < 1.1 && Math.abs(tmpA.y) < 1.1;
      l.el.style.display = show ? '' : 'none';
      if (show) l.el.style.transform = `translate(${((tmpA.x * 0.5 + 0.5) * innerWidth).toFixed(1)}px,${((-tmpA.y * 0.5 + 0.5) * innerHeight).toFixed(1)}px)`;
    }
  }
  if (hudTick-- <= 0) { updateHud(); hudTick = 10; }
}

if (query.has('dist')) camera.position.setLength(Number(query.get('dist')));
if (query.has('view')) { // ?view=top | edge
  const d = camera.position.length();
  camera.position.set(0, query.get('view') === 'top' ? d : 0.02 * d, query.get('view') === 'top' ? 0.001 : d);
}
window.__stats = () => ({ fps: meter.fps, n: S?.n, workers: pool?.workers.length, t: sun.t, effSpeed });
start().then(() => { if (params.focus === 'Sun') setFocus('Sun'); });
requestAnimationFrame(frame);
