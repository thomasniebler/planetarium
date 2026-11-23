// Renderer set-up shared by the galaxy scenes (CPU-rendering detection like the solar system page).
import * as THREE from 'three';

export const query = new URLSearchParams(location.search);

export const glName = (() => {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  } catch { return ''; }
})();

export const LOW = query.has('quality')
  ? query.get('quality') === 'low'
  : /llvmpipe|swiftshader|softpipe|software|basic render/i.test(glName);

export function createRenderer() {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(LOW ? 1 : Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  document.body.prepend(renderer.domElement);
  return renderer;
}

// Number of simulation workers: leave a core for the page itself.
export const WORKERS = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 2) - 1));

// Frames-per-second meter (exponential moving average).
export function fpsMeter() {
  let ms = 0;
  return {
    tick(raw) { if (raw > 0 && raw < 2000) ms = ms ? ms + (raw - ms) * 0.08 : raw; },
    get fps() { return ms ? 1000 / ms : 0; },
  };
}
