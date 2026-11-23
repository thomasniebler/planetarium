// Local Group scene: Milky Way, Andromeda, Triangulum and the Magellanic Clouds over billions of years.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { query, LOW, createRenderer, WORKERS, fpsMeter } from '../common/gfx.js';
import { GALAXIES, Halos, initialHalos, buildStars, m31Velocity } from './lgmodel.js';
import { KMS } from './units.js';
import { Pool, sliceArrays } from './pool.js';
import { particleMaterial, pointScale, backdrop } from './points.js';

const QUALITY = Number(query.get('n') ?? (LOW ? 0.35 : 1));
const NG = GALAXIES.length;
const iMW = 0, iM31 = 1;
const M31V = m31Velocity(GALAXIES);
const KPC_MLY = 3261.56 / 1e6; // million light-years per kpc

const params = {
  friction: true, mwMass: 1, m31Mass: 1,
  m31Tangential: Number(query.get('vt') ?? Math.round(M31V.tangential)),
  speedExp: Number(query.get('speed') ?? 2), paused: query.has('paused'),
  focus: query.get('focus') ?? 'Local Group',
  brightness: 0.7, paths: true, labels: true,
  restart: () => start(),
};
const FOCI = ['Local Group', ...GALAXIES.map((g) => g.name)];
const FLY = { 'Local Group': 1100, 'Milky Way': 110, 'Andromeda (M31)': 160, 'Triangulum (M33)': 45, 'Large Magellanic Cloud': 35, 'Small Magellanic Cloud': 25 };

// --- renderer --------------------------------------------------------------------------------
const renderer = createRenderer();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 1e7);
camera.position.set(-500, 650, 1050);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.zoomSpeed = 1.4;
controls.minDistance = 1; controls.maxDistance = 8000;
backdrop(scene, 3500, 2e6);

// aType = galaxy * 3 + (0 disk, 1 bulge, 2 stellar halo)
const STYLE = /* glsl */ `
  void style(float type, float seed, float val, out vec3 col, out float inten, out float size, out float cap){
    float g = floor(type / 3.0 + 0.01), k = type - 3.0 * g;
    cap = 3.0;
    if (k < 0.5) {
      vec3 young = g > 1.5 ? vec3(0.62, 0.76, 1.0) : vec3(0.75, 0.84, 1.0);
      col = mix(vec3(1.0, 0.9, 0.78), young, seed * seed); size = 0.22; inten = val;
    } else if (k < 1.5) {
      col = mix(vec3(1.0, 0.76, 0.45), vec3(1.0, 0.88, 0.7), seed); size = 0.18; inten = val;
    } else {
      col = vec3(1.0, 0.78, 0.6); size = 0.3; inten = val * 0.6;
    }
  }`;
const starMat = particleMaterial(STYLE, { types: 3 * NG });

// --- galaxy centres: labels, glow, paths -----------------------------------------------------------
const glowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d'), gr = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,255,255,0.45)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.08)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
const labelRoot = document.getElementById('labels');
const PATH = 700, PATH_DT = 10; // points, Myr between points
const gal = GALAXIES.map((g, i) => {
  const el = document.createElement('div');
  el.className = 'label'; el.innerHTML = `<i style="background:${g.color}"></i>${g.name}`;
  el.addEventListener('click', () => setFocus(g.name));
  labelRoot.appendChild(el);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: g.color, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
  glow.renderOrder = 2; scene.add(glow);
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array((PATH + 1) * 3), 3));
  const col = new Float32Array((PATH + 1) * 3), c = new THREE.Color(g.color);
  for (let k = 0; k <= PATH; k++) { const f = Math.pow(1 - k / PATH, 1.2) * 0.55; col.set([c.r * f, c.g * f, c.b * f], 3 * k); }
  pg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const path = new THREE.Line(pg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
  path.frustumCulled = false; path.renderOrder = 1; scene.add(path);
  return { def: g, i, el, glow, path, buf: new Float32Array(PATH * 3), head: 0, count: 0, lastT: -1e9, pos: new THREE.Vector3(), lum: Math.pow(g.lum / 1e11, 0.3) };
});

// --- simulation ------------------------------------------------------------------------------------
let pool, S, points, posArr, valArr, ready = false, halo = null, events = [], watch;
const loadingEl = document.getElementById('loading');

async function start() {
  ready = false;
  loadingEl.textContent = 'Placing galaxies…';
  loadingEl.classList.remove('done');
  await new Promise((r) => setTimeout(r, 30));
  const H = new Halos(GALAXIES, { friction: params.friction });
  H.setMassMult(iMW, params.mwMass); H.setMassMult(iM31, params.m31Mass);
  initialHalos(H, GALAXIES, { m31Tangential: params.m31Tangential });
  S = buildStars(H, GALAXIES, QUALITY);
  halo = { pos: H.pos.slice(), vel: H.vel.slice(), t: 0 };
  posArr = new Float32Array(3 * S.n); valArr = new Float32Array(S.n);
  copyPos(0, S.pos); valArr.set(S.val);
  if (points) { scene.remove(points); points.geometry.dispose(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(posArr, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aVal', new THREE.BufferAttribute(valArr, 1));
  g.setAttribute('aType', new THREE.BufferAttribute(Float32Array.from(S.gal, (gi, i) => gi * 3 + S.type[i]), 1));
  g.setAttribute('aSeed', new THREE.BufferAttribute(S.seed, 1));
  points = new THREE.Points(g, starMat); points.frustumCulled = false;
  scene.add(points);
  if (!start.placed) { // first view: look at the Milky Way–Andromeda line from the side, a little from above
    start.placed = true;
    const d = new THREE.Vector3().subVectors(gal[iM31].pos.set(H.pos[3], H.pos[5], -H.pos[4]), gal[iMW].pos.set(H.pos[0], H.pos[2], -H.pos[1]));
    const side = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
    camera.position.copy(side.multiplyScalar(-1).add(new THREE.Vector3(0, 0.45, 0)).setLength(Number(query.get('dist') ?? 1100)));
  }
  gal.forEach((b) => { b.count = 0; b.head = 0; b.lastT = -1e9; b.pos.set(H.pos[3 * b.i], H.pos[3 * b.i + 2], -H.pos[3 * b.i + 1]); });
  events = []; watch = { prev: Infinity, falling: false, mergedSince: null, lmcPrev: Infinity, lmcFalling: false, lmcDone: false };

  pool?.terminate();
  pool = new Pool(() => new Worker(new URL('./lg.worker.js', import.meta.url), { type: 'module' }), WORKERS, S.n);
  await pool.init((k, a, b) => [{
    cmd: 'init', friction: params.friction, massMult: Array.from(H.massMult),
    halos: { pos: H.pos, vel: H.vel },
    slice: sliceArrays({ pos: S.pos, vel: S.vel, val: S.val }, a, b, { pos: 3, vel: 3 }),
  }]);
  ready = true;
  loadingEl.classList.add('done');
  if (query.has('t') && !start.jumped) { start.jumped = true; pool.step(Number(query.get('t')), onSlice, onAll); } // ?t=4500: jump ahead (Myr)
}

function copyPos(a, pos) {
  for (let i = 0, m = pos.length / 3; i < m; i++) {
    const o = 3 * (a + i);
    posArr[o] = pos[3 * i]; posArr[o + 1] = pos[3 * i + 2]; posArr[o + 2] = -pos[3 * i + 1];
  }
}
const onSlice = (a, pos) => copyPos(a, pos);
function onAll(data) {
  points.geometry.attributes.position.needsUpdate = true;
  halo = { pos: data.halos.pos, vel: data.halos.vel, t: data.t };
  gal.forEach((b) => {
    const p = halo.pos, i = b.i;
    b.pos.set(p[3 * i], p[3 * i + 2], -p[3 * i + 1]);
    if (halo.t - b.lastT >= PATH_DT) {
      b.buf.set([b.pos.x, b.pos.y, b.pos.z], b.head * 3);
      b.head = (b.head + 1) % PATH; b.count = Math.min(b.count + 1, PATH); b.lastT = halo.t;
    }
  });
  watchEvents();
}

const sep = (i, j) => {
  const p = halo.pos;
  return Math.hypot(p[3 * i] - p[3 * j], p[3 * i + 1] - p[3 * j + 1], p[3 * i + 2] - p[3 * j + 2]);
};
const relSpeed = (i, j) => {
  const v = halo.vel;
  return Math.hypot(v[3 * i] - v[3 * j], v[3 * i + 1] - v[3 * j + 1], v[3 * i + 2] - v[3 * j + 2]) / KMS;
};
const fmtT = (t) => (t >= 1000 ? `${(t / 1000).toFixed(2)} billion years` : `${t.toFixed(0)} million years`);
function watchEvents() {
  const d = sep(iMW, iM31), t = halo.t;
  if (watch.falling && d > watch.prev + 0.5 && watch.prev < 400 && !watch.mergedSince)
    events.push(`+${fmtT(t)}: Milky Way and Andromeda pass each other ${(watch.prev * KPC_MLY * 1000).toFixed(0)} thousand light-years apart`);
  if (Math.abs(d - watch.prev) > 0.5) { watch.falling = d < watch.prev; watch.prev = d; }
  if (d < 12) {
    if (watch.mergedSince === null) watch.mergedSince = t;
    else if (t - watch.mergedSince > 400 && !watch.merged) { watch.merged = true; events.push(`+${fmtT(t)}: the two have merged into one elliptical galaxy`); }
  } else if (!watch.merged) watch.mergedSince = null;
  const dl = sep(iMW, 3);
  if (!watch.lmcDone && dl < 6) {
    watch.lmcSince ??= t;
    if (t - watch.lmcSince > 300) { watch.lmcDone = true; events.push(`+${fmtT(t)}: the Large Magellanic Cloud has been swallowed by the Milky Way`); }
  } else if (!watch.lmcDone) watch.lmcSince = null;
}

// --- camera focus --------------------------------------------------------------------------------
let flyTo = null;
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), lastFocus = new THREE.Vector3();
function focusPoint(v) {
  const k = GALAXIES.findIndex((g) => g.name === params.focus);
  // 'Local Group': halfway between the two big galaxies (the barycentre sits much closer to Andromeda)
  return k >= 0 ? v.copy(gal[k].pos) : v.addVectors(gal[iMW].pos, gal[iM31].pos).multiplyScalar(0.5);
}
function setFocus(name) {
  params.focus = name;
  flyTo = FLY[name] ?? 200;
  gal.forEach((b) => b.el.classList.toggle('focus', b.def.name === name));
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
}
controls.addEventListener('start', () => { flyTo = null; });

// --- GUI -----------------------------------------------------------------------------------------
const gui = new GUI({ title: 'Local Group' });
const push = () => pool?.broadcast({ cmd: 'params', friction: params.friction, massMult: GALAXIES.map((g, i) => (i === iMW ? params.mwMass : i === iM31 ? params.m31Mass : 1)) });
const fPhys = gui.addFolder('Physics');
fPhys.add(params, 'friction').name('Dynamical friction').onChange(push);
fPhys.add(params, 'mwMass', 0.3, 3, 0.01).name('Milky Way mass ×').onChange(push);
fPhys.add(params, 'm31Mass', 0.3, 3, 0.01).name('Andromeda mass ×').onChange(push);
const fStart = gui.addFolder('Starting conditions (restart)');
fStart.add(params, 'm31Tangential', 0, 200, 1).name('M31 sideways speed km/s').onFinishChange(() => start());
fStart.add(params, 'restart').name('Restart from today');
const fTime = gui.addFolder('Time');
fTime.add(params, 'speedExp', 0, 3, 0.01).name('Speed: 10^x Myr/s');
fTime.add(params, 'paused').name('Paused');
const fView = gui.addFolder('View');
fView.add(params, 'focus', FOCI).name('Focus').onChange(setFocus);
fView.add(params, 'brightness', 0.2, 5, 0.01).name('Brightness');
fView.add(params, 'paths').name('Galaxy paths');
fView.add(params, 'labels').name('Labels').onChange((v) => { labelRoot.style.display = v ? '' : 'none'; });

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { params.paused = !params.paused; e.preventDefault(); }
  else if (e.key === ',') params.speedExp = Math.max(0, params.speedExp - 0.15);
  else if (e.key === '.') params.speedExp = Math.min(3, params.speedExp + 0.15);
  else return;
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- HUD -----------------------------------------------------------------------------------------
const timeEl = document.getElementById('date'), speedEl = document.getElementById('speed'), infoEl = document.getElementById('facts');
const meter = fpsMeter();
let effSpeed = 0, lastPoolT = 0, hudTick = 0;
function updateHud() {
  if (!halo) return;
  timeEl.textContent = halo.t < 0.5 ? 'Today' : `Today + ${fmtT(halo.t)}`;
  const want = Math.pow(10, params.speedExp);
  const lag = !params.paused && effSpeed < 0.8 * want ? ` (running at ${effSpeed.toFixed(0)} – CPU limit)` : '';
  speedEl.textContent = `${params.paused ? 'paused' : `${want.toFixed(0)} million years per second${lag}`}`
    + ` · ${(S?.n ?? 0).toLocaleString('en')} stars on ${pool?.workers.length ?? 0} threads · ${meter.fps.toFixed(0)} fps`;
  const d = sep(iMW, iM31);
  infoEl.innerHTML = `<table>
    <tr><td>Milky Way – Andromeda</td><td>${d > 30 ? `${(d * KPC_MLY).toFixed(2)} million` : `${(d * KPC_MLY * 1000).toFixed(0)} thousand`} light-years (${d.toFixed(0)} kpc)</td></tr>
    <tr><td>Relative speed</td><td>${relSpeed(iMW, iM31).toFixed(0)} km/s</td></tr>
    <tr><td>Andromeda's sideways speed today</td><td>${params.m31Tangential} km/s</td></tr>
  </table>${events.length ? `<ul class="events">${events.map((e) => `<li>${e}</li>`).join('')}</ul>` : ''}`;
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
    wanted = Math.min(wanted + dtReal * speed, Math.max(speed * 0.15, 2));
    realAcc += dtReal;
    if (!pool.busy && wanted > 0) { const req = wanted; wanted = 0; pool.step(req, onSlice, onAll); }
    if (realAcc > 0.5) { effSpeed = (pool.t - lastPoolT) / realAcc; lastPoolT = pool.t; realAcc = 0; }
  } else if (ready) { lastPoolT = pool.t; realAcc = 0; }

  // follow the focus: while flying, glide towards it; afterwards only carry along its motion, so a
  // user's pan offset (right-drag) is kept
  focusPoint(tmpA);
  if (flyTo !== null) tmpB.subVectors(tmpA, controls.target).multiplyScalar(1 - Math.exp(-4 * dtReal));
  else tmpB.subVectors(tmpA, lastFocus);
  lastFocus.copy(tmpA);
  controls.target.add(tmpB); camera.position.add(tmpB);
  if (flyTo !== null) {
    const off = tmpB.subVectors(camera.position, controls.target), dd = off.length();
    const nd = dd * Math.pow(flyTo / dd, 1 - Math.exp(-2.5 * dtReal));
    off.setLength(nd); camera.position.copy(controls.target).add(off);
    if (Math.abs(Math.log(nd / flyTo)) < 0.01 && tmpA.distanceTo(controls.target) < 0.01 * flyTo) flyTo = null;
  }
  controls.update();

  const scale = pointScale(renderer, camera);
  starMat.uniforms.uScale.value = scale; starMat.uniforms.uBright.value = params.brightness;
  starMat.uniforms.uMinPx.value = LOW ? 1.2 : 1.5 * renderer.getPixelRatio();
  const h = innerHeight;
  gal.forEach((b) => {
    // a soft glow keeps distant galaxies findable; it fades once the galaxy itself is big on screen
    const dist = camera.position.distanceTo(b.pos), px = (25 * scale) / dist / renderer.getPixelRatio();
    b.glow.position.copy(b.pos);
    b.glow.scale.setScalar(dist * 0.05 * b.lum);
    b.glow.material.opacity = 0.45 * params.brightness * Math.max(0, Math.min(1, 1.6 - px / 60));
    const arr = b.path.geometry.attributes.position.array;
    arr.set([b.pos.x, b.pos.y, b.pos.z], 0);
    for (let q = 0; q < b.count; q++) {
      const o = ((b.head - 1 - q + PATH) % PATH) * 3;
      arr[3 * q + 3] = b.buf[o]; arr[3 * q + 4] = b.buf[o + 1]; arr[3 * q + 5] = b.buf[o + 2];
    }
    b.path.geometry.setDrawRange(0, b.count + 1);
    b.path.geometry.attributes.position.needsUpdate = true;
    b.path.visible = params.paths;
  });
  renderer.render(scene, camera);

  if (params.labels) {
    const shown = [];
    gal.forEach((b) => {
      tmpB.copy(b.pos).applyMatrix4(camera.matrixWorldInverse);
      tmpA.copy(b.pos).project(camera);
      const x = (tmpA.x * 0.5 + 0.5) * innerWidth, y = (-tmpA.y * 0.5 + 0.5) * h;
      // hide a label sitting on top of a bigger galaxy's label (e.g. the LMC next to the Milky Way from afar)
      let show = tmpB.z < 0 && Math.abs(tmpA.x) < 1.1 && Math.abs(tmpA.y) < 1.1;
      if (show && shown.some((s) => Math.hypot(s[0] - x, s[1] - y) < 16)) show = false;
      if (show) shown.push([x, y]);
      b.el.style.display = show ? '' : 'none';
      if (show) b.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
    });
  }
  if (hudTick-- <= 0) { updateHud(); hudTick = 10; }
}

window.__stats = () => ({ fps: meter.fps, n: S?.n, workers: pool?.workers.length, t: halo?.t, effSpeed, events });
start().then(() => { if (params.focus !== 'Local Group') setFocus(params.focus); });
requestAnimationFrame(frame);
