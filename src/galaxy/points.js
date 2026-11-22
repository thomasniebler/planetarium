// Point-sprite material for galaxy particles. Each particle is a soft gaussian blob of a physical size (kpc);
// when it would be smaller than uMinPx on screen it is drawn at uMinPx with its light scaled down, so the
// total brightness of a region is the same at any distance (surface brightness is conserved).
//
// styleGLSL must define:  void style(float type, float seed, float val, out vec3 col, out float inten,
//                                     out float size, out float cap)
// `dust` materials darken what is behind them (dst *= 1 - col) instead of adding light.
import * as THREE from 'three';

export function particleMaterial(styleGLSL, { dust = false, types = 8 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uScale: { value: 1000 }, uBright: { value: 1 }, uMinPx: { value: 1.5 },
      uShow: { value: new Array(types).fill(1) },
    },
    vertexShader: /* glsl */ `
      attribute float aType; attribute float aSeed; attribute float aVal;
      uniform float uScale; uniform float uBright; uniform float uMinPx; uniform float uShow[${types}];
      varying vec3 vCol; varying float vA;
      ${styleGLSL}
      void main(){
        vec3 col; float inten, size, cap;
        style(aType, aSeed, aVal, col, inten, size, cap);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float px = size * uScale / max(-mv.z, 1e-4);
        float ps = clamp(px, uMinPx, max(cap, uMinPx));
        float dim = px < uMinPx ? px * px / (uMinPx * uMinPx) : 1.0;
        vA = inten * dim * uBright * uShow[int(aType + 0.5)];
        vCol = col;
        gl_PointSize = ps;
        if (vA < 0.0015 || mv.z > 0.0) { gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol; varying float vA;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float d2 = dot(c, c) * 4.0;
        if (d2 > 1.0) discard;
        float g = exp(-d2 * 4.0) * (1.0 - d2);
        gl_FragColor = vec4(vCol * min(vA * g, ${dust ? '0.95' : '64.0'}), 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: dust ? THREE.ZeroFactor : THREE.OneFactor,
    blendDst: dust ? THREE.OneMinusSrcColorFactor : THREE.OneFactor,
  });
}

// pixels per unit length at unit distance, for the current drawing-buffer size and camera
export function pointScale(renderer, camera) {
  const h = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
  return h / (2 * Math.tan((camera.fov * Math.PI) / 360));
}

// Sparse, very faint background "sky" of distant galaxies/stars so empty space is not pure black.
export function backdrop(scene, count = 2500, radius = 1e5, seed = 99) {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    do v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1); while (v.lengthSq() > 1 || v.lengthSq() < 0.01);
    v.setLength(radius);
    pos.set([v.x, v.y, v.z], i * 3);
    const b = 0.12 + 0.35 * Math.pow(rnd(), 4), t = rnd();
    col.set([b * (0.85 + 0.15 * t), b * 0.88, b * (1.0 - 0.2 * t)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.3, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
  p.frustumCulled = false;
  scene.add(p);
  return p;
}
