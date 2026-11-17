import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { BODIES, AU_KM } from './bodies.js';
import { Sim } from './physics.js';
import { createBaker, NOISE_GLSL } from './textures.js';

// ---------------------------------------------------------------------------------------------
// Conventions
//  physics: AU, ecliptic, z = north.   scene: U units per AU, y = north:  (x, y, z) -> (x, z, -y)
//  The scene origin is re-centred every frame on the focus point (kept in doubles), so zooming
//  into a moon of Neptune is as precise as looking at the Sun.
// ---------------------------------------------------------------------------------------------
const U = 1e5;
const J2000_MS = Date.UTC(2000, 0, 1, 12);
const N = BODIES.length;
const query = new URLSearchParams(location.search);

const sim = new Sim(BODIES);
const epochNow = () => (Date.now() - J2000_MS) / 86400000;
sim.reset(epochNow());

const params = {
  sunGravity: 1,
  G: 1,
  focusMassExp: 0,
  speedExp: Number(query.get('speed') ?? 0.7),
  reverse: false,
  paused: query.has('paused'),
  magnification: Number(query.get('mag') ?? 100),
  orbits: true,
  trails: true,
  labels: true,
  focus: 'Sun',
  resetSim: () => resetSim(),
  resetParams: () => resetParams(),
};

// --- renderer / scene ------------------------------------------------------------------------
// No GPU? Browsers then rasterise WebGL on the CPU (llvmpipe / SwiftShader). Detect that and go easy on it:
// small textures, no MSAA, coarser spheres, cheaper sun, and a render resolution that adapts to the frame rate.
const glName = (() => {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  } catch { return ''; }
})();
const LOW = query.has('quality') ? query.get('quality') === 'low' : /llvmpipe|swiftshader|softpipe|software|basic render/i.test(glName);
const MAX_PR = LOW ? 1 : Math.min(devicePixelRatio, 2), MIN_PR = LOW ? 0.4 : 1;
let pixelRatio = MAX_PR;
const renderer = new THREE.WebGLRenderer({ antialias: !LOW, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 1e-3, 1e10);
camera.position.set(0, 2.6 * U, 5.6 * U);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.zoomSpeed = 1.6;
controls.maxDistance = 400 * U;

const sunLight = new THREE.PointLight(0xffffff, 3.3, 0, 0);
scene.add(sunLight, new THREE.AmbientLight(0xffffff, 0.035));

const LOG_V = '#include <common>\n#include <logdepthbuf_pars_vertex>\n';
const LOG_F = '#include <logdepthbuf_pars_fragment>\n';

// --- stars -----------------------------------------------------------------------------------
const stars = (() => {
  const count = 9000, pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
  const pole = new THREE.Vector3(0.45, 0.5, 0.74).normalize(), v = new THREE.Vector3();
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < count; i++) {
    do {
      v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
    } while (v.lengthSq() > 1 || v.lengthSq() < 0.01);
    v.normalize();
    if (i % 2 && Math.abs(v.dot(pole)) > 0.25 * rnd()) { i--; continue; } // half the stars hug a "milky way" band
    v.multiplyScalar(2e9);
    pos.set([v.x, v.y, v.z], i * 3);
    const b = 0.25 + 0.75 * Math.pow(rnd(), 3), t = rnd();
    col.set([b * (0.8 + 0.2 * t), b * 0.9, b * (1.0 - 0.25 * t)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
  pts.frustumCulled = false;
  scene.add(pts);
  return pts;
})();

// --- body visuals ----------------------------------------------------------------------------
const sphereGeo = LOW ? new THREE.SphereGeometry(1, 64, 32) : new THREE.SphereGeometry(1, 128, 64);
const toThree = (v) => new THREE.Vector3(v[0], v[2], -v[1]);
const Y = new THREE.Vector3(0, 1, 0);
const timeUniform = { value: 0 };

function sunMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: timeUniform },
    defines: LOW ? { LOW: 1 } : {},
    vertexShader: `${LOG_V} varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main(){ vP=position; vec4 mv=modelViewMatrix*vec4(position,1.0); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz);
        gl_Position=projectionMatrix*mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `${LOG_F} uniform float uTime; varying vec3 vP; varying vec3 vN; varying vec3 vV;
      ${NOISE_GLSL}
      void main(){
        #include <logdepthbuf_fragment>
        float t=uTime*0.04;
        #ifdef LOW
        float n=fbm(vP*3.0+vec3(0.0,t,0.0),3);
        float g=snoise(vP*26.0+vec3(t*3.0,0.0,t*2.0))*0.6, spots=0.0;
        #else
        float n=fbm(vP*3.0+vec3(0.0,t,0.0),5);
        float g=snoise(vP*26.0+vec3(t*3.0,0.0,t*2.0))*0.5+snoise(vP*60.0-vec3(0.0,t*4.0,0.0))*0.25;
        float spots=smoothstep(0.42,0.6,fbm(vP*5.0+vec3(t*0.5),4));
        #endif
        float v=0.62+0.5*n+0.16*g-0.5*spots;
        vec3 c=mix(vec3(1.0,0.36,0.03),vec3(1.0,0.78,0.30),clamp(v,0.0,1.0));
        c=mix(c,vec3(1.0,0.97,0.85),smoothstep(0.85,1.25,v));
        float mu=max(dot(normalize(vN),normalize(vV)),0.0);
        c*=0.45+0.75*pow(mu,0.5);
        gl_FragColor=vec4(c*1.25,1.0);
      }`,
  });
}

function atmosphereMaterial(a) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Vector3(...a.color) }, uStrength: { value: a.strength }, uPower: { value: a.power }, uSunDir: { value: new THREE.Vector3(1, 0, 0) } },
    vertexShader: `${LOG_V} varying vec3 vN; varying vec3 vW;
      void main(){ vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz;
        gl_Position=projectionMatrix*viewMatrix*w;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `${LOG_F} uniform vec3 uColor; uniform float uStrength; uniform float uPower; uniform vec3 uSunDir; varying vec3 vN; varying vec3 vW;
      void main(){
        #include <logdepthbuf_fragment>
        vec3 n=normalize(vN);
        float x=max(dot(n,normalize(cameraPosition-vW)),0.0);
        const float xl=0.305; // where the line of sight grazes the planet's limb (shell radius 1.05)
        float rim=x<xl?pow(x/xl,2.5):pow(1.0-(x-xl)/(1.0-xl),uPower);
        float day=smoothstep(-0.3,0.45,dot(n,uSunDir));
        gl_FragColor=vec4(uColor*rim*day*uStrength,1.0);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
}

function ringMesh(r) {
  const geo = new THREE.RingGeometry(r.inner, r.outer, 256, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uInner: { value: r.inner }, uOuter: { value: r.outer }, uStyle: { value: r.style },
      uCenter: { value: new THREE.Vector3() }, uSunPos: { value: new THREE.Vector3() }, uPlanetR: { value: 1 } },
    vertexShader: `${LOG_V} varying float vR; varying vec3 vW;
      void main(){ vR=length(position.xz); vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz;
        gl_Position=projectionMatrix*viewMatrix*w;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `${LOG_F} uniform float uInner; uniform float uOuter; uniform int uStyle; uniform vec3 uCenter; uniform vec3 uSunPos; uniform float uPlanetR;
      varying float vR; varying vec3 vW;
      ${NOISE_GLSL}
      void main(){
        #include <logdepthbuf_fragment>
        float t=(vR-uInner)/(uOuter-uInner);
        vec3 col; float alpha;
        if(uStyle==0){
          float n=0.5+0.5*snoise(vec3(t*45.0,0.5,3.0)), n2=0.5+0.5*snoise(vec3(t*150.0,1.5,7.0));
          float fine=0.58+0.27*n+0.15*n2;
          float c=smoothstep(0.0,0.04,t)*(1.0-smoothstep(0.265,0.285,t))*0.22;
          float b=smoothstep(0.27,0.30,t)*(1.0-smoothstep(0.682,0.692,t));
          float cas=smoothstep(0.69,0.70,t)*(1.0-smoothstep(0.755,0.765,t))*0.07;
          float a=smoothstep(0.76,0.772,t)*(1.0-smoothstep(0.985,1.0,t))*0.72*smoothstep(0.0,0.005,abs(t-0.949));
          alpha=clamp(c*fine+b*(0.5+0.6*fine)+cas+a*(0.6+0.5*fine),0.0,0.97);
          col=mix(vec3(0.50,0.43,0.36),vec3(0.93,0.87,0.74),clamp(b*fine*1.2+a*0.5,0.0,1.0));
        } else {
          float l=exp(-pow((t-0.85)/0.08,2.0))+0.5*exp(-pow((t-0.35)/0.05,2.0))+0.4*exp(-pow((t-0.1)/0.04,2.0));
          alpha=clamp(l,0.0,1.0)*0.5; col=vec3(0.55,0.62,0.66);
        }
        vec3 L=normalize(uSunPos-vW), rel=vW-uCenter;
        float tc=-dot(rel,L), lit=1.0;
        if(tc>0.0){ float d=sqrt(max(dot(rel,rel)-tc*tc,0.0)); lit=smoothstep(uPlanetR*0.96,uPlanetR*1.03,d); }
        gl_FragColor=vec4(col*(0.05+0.95*lit),alpha);
      }`,
    transparent: true, side: THREE.DoubleSide, depthWrite: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 2;
  return m;
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d'), g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,240,200,1)'); g.addColorStop(0.12, 'rgba(255,205,120,0.75)');
  g.addColorStop(0.3, 'rgba(255,150,60,0.22)'); g.addColorStop(0.6, 'rgba(255,110,40,0.05)'); g.addColorStop(1, 'rgba(255,90,30,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const TEX_SCALE = Number(query.get('tex') ?? (LOW ? 0.25 : 1)); // ?tex=0.5 → 1k planets, ?tex=2 → 4k planets
const bakeQueue = [];
const bake = createBaker(renderer);
const bodies = BODIES.map((def, i) => {
  const group = new THREE.Group(), tilt = new THREE.Group();
  group.add(tilt); scene.add(group);
  tilt.quaternion.setFromUnitVectors(Y, toThree(sim.pole[i]).normalize());
  const b = { def, i, group, tilt, spin: Math.random() * 6.28, color: new THREE.Color(def.color), radiusAU: def.radiusKm / AU_KM };
  if (def.tex === 'sun') {
    b.mesh = new THREE.Mesh(sphereGeo, sunMaterial());
    b.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    scene.add(b.glow);
  } else {
    // flat-coloured placeholder; the real texture is painted a few frames later (see paintNext)
    b.mesh = new THREE.Mesh(sphereGeo, new THREE.MeshStandardMaterial({ color: b.color, roughness: 1 }));
    bakeQueue.push(b);
    if (def.shape) b.mesh.scale.set(...def.shape);
    if (def.oblate) tilt.scale.set(1, def.oblate, 1);
    if (def.atmo) {
      b.atmo = new THREE.Mesh(sphereGeo, atmosphereMaterial(def.atmo));
      b.atmo.scale.setScalar(1.05); b.atmo.renderOrder = 3;
      tilt.add(b.atmo);
    }
    if (def.ring) { b.ring = ringMesh(def.ring); tilt.add(b.ring); }
  }
  tilt.add(b.mesh);

  // osculating orbit line
  if (i > 0) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((ORBIT_SEG() + 1) * 3), 3));
    b.orbit = new THREE.Line(g, new THREE.LineBasicMaterial({ color: b.color, transparent: true, opacity: sim.isMoon[i] ? 0.3 : 0.4, depthWrite: false }));
    b.orbit.frustumCulled = false;
    scene.add(b.orbit);
  }
  // trail
  const max = sim.isMoon[i] ? 90 : 260;
  const tg = new THREE.BufferGeometry(), cols = new Float32Array((max + 1) * 3);
  for (let k = 0; k <= max; k++) { const f = Math.pow(1 - k / max, 1.6) * 0.9; cols.set([b.color.r * f, b.color.g * f, b.color.b * f], k * 3); }
  tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array((max + 1) * 3), 3));
  tg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  b.trail = { max, buf: new Float64Array(max * 3), head: 0, count: 0, lastT: sim.t,
    line: new THREE.Line(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })) };
  b.trail.line.frustumCulled = false;
  scene.add(b.trail.line);
  return b;
});
function ORBIT_SEG() { return 256; }

// Paint one body's textures per frame so the page never freezes (matters a lot on CPU rendering).
const bakeTotal = bakeQueue.length;
function paintNext() {
  const b = bakeQueue.shift(), def = b.def;
  const tex = bake(def, (sim.isMoon[b.i] ? 1024 : 2048) * TEX_SCALE);
  const mat = new THREE.MeshStandardMaterial({ map: tex.map, metalness: 0, roughness: 1 });
  if (tex.normalMap) mat.normalMap = tex.normalMap;
  // roughness lives in the albedo texture's alpha channel (shiny oceans, matte land)
  mat.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace('#include <roughnessmap_fragment>',
      'float roughnessFactor = roughness * texture2D( map, vMapUv ).a;');
  };
  b.mesh.material.dispose();
  b.mesh.material = mat;
  if (tex.clouds) {
    b.clouds = new THREE.Mesh(sphereGeo, new THREE.MeshStandardMaterial({ map: tex.clouds, transparent: true, depthWrite: false, roughness: 1 }));
    b.clouds.scale.setScalar(1.012); b.clouds.renderOrder = 1;
    b.tilt.add(b.clouds);
  }
}

// --- labels ----------------------------------------------------------------------------------
const labelRoot = document.getElementById('labels');
bodies.forEach((b) => {
  const el = document.createElement('div');
  el.className = 'label' + (sim.isMoon[b.i] ? ' moon' : '');
  el.innerHTML = `<i style="background:${b.def.color}"></i>${b.def.name}`;
  el.addEventListener('click', () => setFocus(b.i));
  labelRoot.appendChild(el);
  b.label = el; b.sx = 0; b.sy = 0; b.onScreen = false;
});

// --- display state ---------------------------------------------------------------------------
const disp = new Float64Array(3 * N);   // scene-space positions (doubles, not yet re-centred)
const origin = [0, 0, 0];
const pan = [0, 0, 0];                  // offset of the view centre from the focused body
let focus = 0, flying = false, recentering = false, flyDist = 6 * U;

const magOf = (i) => (i === 0 ? Math.min(params.magnification, 20) : params.magnification);
const radiusOf = (i) => bodies[i].radiusAU * U * magOf(i);

function computeDisplay() {
  const p = sim.pos, mag = params.magnification;
  for (let i = 0; i < N; i++) {
    if (sim.isMoon[i]) continue;
    disp[3 * i] = p[3 * i] * U; disp[3 * i + 1] = p[3 * i + 2] * U; disp[3 * i + 2] = -p[3 * i + 1] * U;
  }
  // a planet's whole moon system is magnified about the planet, together with the planet itself
  for (let i = 0; i < N; i++) {
    if (!sim.isMoon[i]) continue;
    const j = sim.parent[i], s = U * mag;
    disp[3 * i] = disp[3 * j] + (p[3 * i] - p[3 * j]) * s;
    disp[3 * i + 1] = disp[3 * j + 1] + (p[3 * i + 2] - p[3 * j + 2]) * s;
    disp[3 * i + 2] = disp[3 * j + 2] - (p[3 * i + 1] - p[3 * j + 1]) * s;
  }
}

function setFocus(i, instant = false) {
  if (i !== focus) {
    for (let k = 0; k < 3; k++) pan[k] = origin[k] - disp[3 * i + k];
    bodies[focus].label.classList.remove('focus');
    focus = i;
  }
  bodies[i].label.classList.add('focus');
  flyDist = i === 0 ? 6 * U : radiusOf(i) * 5;
  flying = recentering = true;
  if (instant) { pan.fill(0); camera.position.setLength(flyDist); flying = recentering = false; }
  params.focus = BODIES[i].name;
  params.focusMassExp = Math.log10(Math.max(sim.massMult[i], 0.01));
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  infoTick = 0;
}
controls.addEventListener('start', () => { flying = false; });

// --- orbits & trails -------------------------------------------------------------------------
function updateOrbit(b) {
  const i = b.i, line = b.orbit;
  const el = sim.osculating(i);
  if (!params.orbits || !el || el.a === undefined) { line.visible = false; return; }
  line.visible = true;
  const j = sim.parent[i], moon = sim.isMoon[i];
  const s = U * (moon ? params.magnification : 1);
  const bx = disp[3 * j] - origin[0], by = disp[3 * j + 1] - origin[1], bz = disp[3 * j + 2] - origin[2];
  const { a, e, P, Q, r } = el, arr = line.geometry.attributes.position.array, n = ORBIT_SEG();
  const x0 = r[0] * P[0] + r[1] * P[1] + r[2] * P[2], y0 = r[0] * Q[0] + r[1] * Q[1] + r[2] * Q[2];
  let A, B, E0, span, hyper = e >= 1;
  if (!hyper) { A = a; B = a * Math.sqrt(1 - e * e); E0 = Math.atan2(y0 / B, x0 / A + e); span = 2 * Math.PI; }
  else {
    A = -a; B = A * Math.sqrt(e * e - 1);
    const rmax = moon ? el.dist * 30 + 0.01 : Math.max(400, el.dist * 3);
    const hm = Math.acosh(Math.max((rmax / A + 1) / e, 1.0001));
    E0 = -hm; span = 2 * hm;
  }
  for (let k = 0; k <= n; k++) {
    const E = E0 + (span * k) / n;
    const x = hyper ? A * (e - Math.cosh(E)) : A * (Math.cos(E) - e);
    const y = hyper ? B * Math.sinh(E) : B * Math.sin(E);
    const px = x * P[0] + y * Q[0], py = x * P[1] + y * Q[1], pz = x * P[2] + y * Q[2];
    arr[3 * k] = bx + px * s; arr[3 * k + 1] = by + pz * s; arr[3 * k + 2] = bz - py * s;
  }
  line.geometry.attributes.position.needsUpdate = true;
}

function updateTrail(b) {
  const i = b.i, tr = b.trail, p = sim.pos, moon = sim.isMoon[i], j = sim.parent[i];
  const rel = (k) => (moon ? p[3 * i + k] - p[3 * j + k] : p[3 * i + k]);
  const interval = i === 0 ? 4 : sim.period0[i] / (moon ? 80 : 130);
  if (Math.abs(sim.t - tr.lastT) >= interval) {
    tr.buf.set([rel(0), rel(1), rel(2)], tr.head * 3);
    tr.head = (tr.head + 1) % tr.max; tr.count = Math.min(tr.count + 1, tr.max); tr.lastT = sim.t;
  }
  // at extreme time-lapse a fast body moves a large part of its orbit per frame: a trail would be a zigzag
  tr.line.visible = params.trails && tr.count > 0 && (i === 0 || Math.abs(frameAdvance) < sim.period0[i] / 14);
  if (!tr.line.visible) return;
  const s = U * (moon ? params.magnification : 1);
  const bx = (moon ? disp[3 * j] : 0) - origin[0], by = (moon ? disp[3 * j + 1] : 0) - origin[1], bz = (moon ? disp[3 * j + 2] : 0) - origin[2];
  const arr = tr.line.geometry.attributes.position.array;
  const put = (slot, x, y, z) => { arr[3 * slot] = bx + x * s; arr[3 * slot + 1] = by + z * s; arr[3 * slot + 2] = bz - y * s; };
  put(0, rel(0), rel(1), rel(2));
  for (let k = 0; k < tr.count; k++) {
    const q = ((tr.head - 1 - k + tr.max) % tr.max) * 3;
    put(k + 1, tr.buf[q], tr.buf[q + 1], tr.buf[q + 2]);
  }
  tr.line.geometry.setDrawRange(0, tr.count + 1);
  tr.line.geometry.attributes.position.needsUpdate = true;
}
const clearTrails = () => bodies.forEach((b) => { b.trail.count = 0; b.trail.head = 0; b.trail.lastT = sim.t; });

// --- GUI -------------------------------------------------------------------------------------
const gui = new GUI({ title: 'Simulation' });
const fPhys = gui.addFolder('Physics');
fPhys.add(params, 'sunGravity', 0, 5, 0.01).name('Sun gravity ×').onChange((v) => {
  sim.massMult[0] = v; sim.updateMasses();
  if (focus === 0) { params.focusMassExp = Math.log10(Math.max(v, 0.01)); massCtrl.updateDisplay(); }
});
fPhys.add(params, 'G', 0, 5, 0.01).name('Gravitational constant ×').onChange((v) => { sim.gMult = v; sim.computeAcc(); });
const massCtrl = fPhys.add(params, 'focusMassExp', -2, 3.5, 0.01).name('Focused body mass × 10^').onChange((v) => {
  sim.massMult[focus] = Math.pow(10, v); sim.updateMasses();
  if (focus === 0) { params.sunGravity = Math.min(5, sim.massMult[0]); sunCtrl.updateDisplay(); }
});
const sunCtrl = fPhys.controllers[0];
const fTime = gui.addFolder('Time');
fTime.add(params, 'speedExp', -2, 3.3, 0.01).name('Speed: 10^x days/s');
fTime.add(params, 'reverse').name('Run backwards');
fTime.add(params, 'paused').name('Paused');
const fView = gui.addFolder('View');
fView.add(params, 'focus', BODIES.map((b) => b.name)).name('Focus').onChange((v) => setFocus(sim.index.get(v)));
fView.add(params, 'magnification', 1, 1000, 1).name('Body size ×').onChange(() => {
  if (focus !== 0) camera.position.setLength(Math.max(camera.position.length(), radiusOf(focus) * 1.5));
});
fView.add(params, 'orbits').name('Orbit lines');
fView.add(params, 'trails').name('Trails');
fView.add(params, 'labels').name('Labels').onChange((v) => { labelRoot.style.display = v ? '' : 'none'; });
gui.add(params, 'resetSim').name('Reset to today (keep parameters)');
gui.add(params, 'resetParams').name('Reset everything');

function resetSim() { sim.reset(epochNow()); clearTrails(); }
function resetParams() {
  sim.massMult.fill(1); sim.gMult = 1;
  Object.assign(params, { sunGravity: 1, G: 1, focusMassExp: 0, speedExp: 0.7, reverse: false, paused: false });
  resetSim();
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
}

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { params.paused = !params.paused; e.preventDefault(); }
  else if (e.key === ',') params.speedExp = Math.max(-2, params.speedExp - 0.15);
  else if (e.key === '.') params.speedExp = Math.min(3.3, params.speedExp + 0.15);
  else if (e.key === 'r' || e.key === 'R') resetSim();
  else return;
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- HUD -------------------------------------------------------------------------------------
const dateEl = document.getElementById('date'), speedEl = document.getElementById('speed'), infoEl = document.getElementById('info');
let infoTick = 0, lagging = false, effSpeed = 0;
const fmt = (x, d = 3) => (Math.abs(x) >= 1e5 || (Math.abs(x) < 1e-3 && x !== 0) ? x.toExponential(2) : x.toFixed(d));
const fmtDays = (d) => (d > 800 ? `${fmt(d / 365.25, 2)} yr` : d > 2 ? `${fmt(d, 1)} d` : `${fmt(d * 24, 1)} h`);
function updateHud() {
  const ms = J2000_MS + sim.t * 86400000;
  dateEl.textContent = Math.abs(ms) < 8e15 ? new Date(ms).toISOString().slice(0, 10) : `year ${fmt(2000 + sim.t / 365.25, 0)}`;
  const sp = Math.pow(10, params.speedExp);
  const lag = !params.paused && lagging ? `  (running at ${fmtDays(Math.abs(effSpeed))}/s – integrator limit)` : '';
  const paint = bakeQueue.length ? ` · painting textures ${bakeTotal - bakeQueue.length}/${bakeTotal}` : '';
  const perf = ` · ${fps.toFixed(0)} fps${LOW ? ` (CPU rendering, ${Math.round(pixelRatio * 100)}% res)` : ''}`;
  speedEl.textContent = (params.paused ? 'paused' : `${params.reverse ? '−' : ''}${fmtDays(sp)} per second${lag}`) + perf + paint;
  const d = BODIES[focus], rows = [];
  const mult = sim.massMult[focus];
  rows.push(['Radius', `${d.radiusKm.toLocaleString('en')} km`]);
  rows.push(['Mass', `${(sim.mass[focus] * 1.98847e30).toExponential(2)} kg${mult !== 1 ? ` (×${fmt(mult, 2)})` : ''}`]);
  const el = sim.osculating(focus);
  if (el) {
    const ref = BODIES[sim.parent[focus]].name;
    rows.push([`Distance to ${ref}`, sim.isMoon[focus] ? `${Math.round(el.dist * AU_KM).toLocaleString('en')} km` : `${fmt(el.dist)} AU`]);
    rows.push(['Speed', `${fmt((el.speed * AU_KM) / 86400, 2)} km/s`]);
    if (el.a !== undefined) rows.push(['Eccentricity', fmt(el.e)]);
    rows.push(['Orbital period', el.bound ? fmtDays(el.period) : 'unbound – escaping']);
  }
  infoEl.innerHTML = `<h2>${d.name}</h2><table>${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table>`;
}

// --- main loop -------------------------------------------------------------------------------
const tmp = new THREE.Vector3(), sunPos = new THREE.Vector3();
let last = performance.now(), frameAdvance = 0, fps = 0, frameMs = 0, prCooldown = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const rawMs = Math.max(0, now - last);
  const dtReal = Math.min(rawMs / 1000, LOW ? 0.12 : 0.05);
  if (bakeQueue.length === 0 && rawMs > 0 && rawMs < 2000) {
    frameMs = frameMs ? frameMs + (rawMs - frameMs) * 0.1 : rawMs;
    fps = 1000 / frameMs;
    // adaptive resolution: trade pixels for frame rate
    if ((prCooldown -= rawMs) <= 0) {
      const want = frameMs > 50 ? pixelRatio * 0.8 : frameMs < 24 ? pixelRatio * 1.15 : pixelRatio;
      const next = Math.min(MAX_PR, Math.max(MIN_PR, want));
      if (Math.abs(next - pixelRatio) > 0.02) { pixelRatio = next; renderer.setPixelRatio(pixelRatio); frameMs = 0; }
      prCooldown = 1200;
    }
  }
  last = now;
  timeUniform.value += dtReal;

  // physics
  let advanced = 0;
  if (!params.paused) advanced = sim.advance(dtReal * Math.pow(10, params.speedExp) * (params.reverse ? -1 : 1));
  frameAdvance = advanced;
  if (dtReal > 0 && !params.paused) {
    lagging = Math.abs(advanced) < 0.9 * dtReal * Math.pow(10, params.speedExp);
    effSpeed += (advanced / dtReal - effSpeed) * 0.1;
  }
  const spinCap = 0.5 * dtReal; // keep rotation watchable at high time-lapse
  bodies.forEach((b) => {
    const period = b.def.rotH ? b.def.rotH / 24 : sim.period0[b.i];
    b.spin += Math.max(-spinCap, Math.min(spinCap, (2 * Math.PI * advanced) / period));
  });

  // camera: fold any panning into the double-precision origin, keep OrbitControls' target at 0
  computeDisplay();
  controls.minDistance = radiusOf(focus) * 1.15;
  controls.update();
  const tg = controls.target;
  if (tg.lengthSq() > 0) {
    if (tg.length() > 1e-5 * camera.position.length()) recentering = false; // user is panning
    pan[0] += tg.x; pan[1] += tg.y; pan[2] += tg.z;
    camera.position.sub(tg); tg.set(0, 0, 0);
  }
  if (recentering) {
    const f = Math.exp(-5 * dtReal);
    pan[0] *= f; pan[1] *= f; pan[2] *= f;
    if (Math.hypot(pan[0], pan[1], pan[2]) < 1e-4 * flyDist) { pan.fill(0); recentering = false; }
  }
  if (flying) {
    const d = camera.position.length();
    const nd = d * Math.pow(flyDist / d, 1 - Math.exp(-4 * dtReal));
    camera.position.setLength(nd);
    if (Math.abs(Math.log(nd / flyDist)) < 0.01) flying = false;
  }
  for (let k = 0; k < 3; k++) origin[k] = disp[3 * focus + k] + pan[k];
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  // place everything relative to the origin
  sunPos.set(disp[0] - origin[0], disp[1] - origin[1], disp[2] - origin[2]);
  sunLight.position.copy(sunPos);
  stars.position.copy(camera.position);
  bodies.forEach((b) => {
    const i = b.i, R = radiusOf(i);
    b.group.position.set(disp[3 * i] - origin[0], disp[3 * i + 1] - origin[1], disp[3 * i + 2] - origin[2]);
    b.group.scale.setScalar(R);
    b.mesh.rotation.y = b.spin;
    if (b.clouds) b.clouds.rotation.y = b.spin + timeUniform.value * 0.004;
    if (b.atmo) b.atmo.material.uniforms.uSunDir.value.copy(sunPos).sub(b.group.position).normalize();
    if (b.ring) {
      const u = b.ring.material.uniforms;
      u.uCenter.value.copy(b.group.position); u.uSunPos.value.copy(sunPos); u.uPlanetR.value = R;
    }
    if (b.glow) {
      b.glow.position.copy(b.group.position);
      b.glow.scale.setScalar(Math.max(R * 9, camera.position.distanceTo(b.group.position) * 0.07));
    }
    if (b.orbit) updateOrbit(b);
    updateTrail(b);
  });

  renderer.render(scene, camera);
  if (bakeQueue.length) { paintNext(); frameMs = 0; prCooldown = 2500; } // don't let paint stalls trigger a resolution drop

  // labels
  if (params.labels) {
    const w = innerWidth, h = innerHeight;
    bodies.forEach((b) => {
      tmp.copy(b.group.position).applyMatrix4(camera.matrixWorldInverse);
      const front = tmp.z < 0;
      tmp.applyMatrix4(camera.projectionMatrix);
      b.sx = (tmp.x * 0.5 + 0.5) * w; b.sy = (-tmp.y * 0.5 + 0.5) * h;
      b.onScreen = front && b.sx > -50 && b.sx < w + 50 && b.sy > -20 && b.sy < h + 20;
    });
    bodies.forEach((b) => {
      let show = b.onScreen;
      const j = sim.parent[b.i];
      if (show && j >= 0 && b.i !== focus) {
        const pb = bodies[j];
        if (Math.hypot(b.sx - pb.sx, b.sy - pb.sy) < (sim.isMoon[b.i] ? 26 : 12)) show = false;
      }
      b.label.style.display = show ? '' : 'none';
      if (show) b.label.style.transform = `translate(${b.sx.toFixed(1)}px,${b.sy.toFixed(1)}px)`;
    });
  }
  if (infoTick-- <= 0) { updateHud(); infoTick = 8; }
}

const startFocus = sim.index.get(query.get('focus') ?? '') ?? 0;
computeDisplay();
setFocus(startFocus, true);
bakeQueue.sort((a, b) => (b.i === startFocus) - (a.i === startFocus));
window.__stats = () => ({ fps, pixelRatio, LOW, glName, left: bakeQueue.length });
if (query.has('dist')) camera.position.setLength(Number(query.get('dist')) * U);
document.getElementById('loading').classList.add('done');
requestAnimationFrame(frame);
