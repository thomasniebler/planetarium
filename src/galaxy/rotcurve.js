// Rotation curve chart: circular speed vs radius, total and per component (bulge, disks, dark-matter halo).
// Canvas 2D, legend above, hover crosshair with a tooltip, dashed marker at the Sun's radius.
import { KMS } from './units.js';

const INK = '#f0efec', INK2 = '#c3c2b7', MUTED = '#898781', GRID = '#2c2c2a', AXIS = '#383835';
const SERIES = [ // fixed categorical order (validated for a dark surface)
  { key: 'disk', name: 'Stars & gas disk', parts: 2, color: '#3987e5' },
  { key: 'bulge', name: 'Bulge', parts: 1, color: '#d95926' },
  { key: 'halo', name: 'Dark matter', parts: 4, color: '#199e70' },
];
const RMAX = 25, VMAX = 300;

export function rotationCurve(root, P, sunR) {
  root.innerHTML = `<div class="rc-title">Rotation curve: orbital speed (km/s) vs distance from the centre (kpc)</div>
    <div class="rc-legend"><span><i style="background:${INK}"></i>Total</span>${SERIES.map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('')}</div>
    <div class="rc-plot"><canvas></canvas><div class="rc-tip"></div></div>`;
  const canvas = root.querySelector('canvas'), tip = root.querySelector('.rc-tip');
  const W = 300, H = 150, m = { l: 30, r: 10, t: 8, b: 20 };
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
  const ctx = canvas.getContext('2d');
  const X = (R) => m.l + (R / RMAX) * (W - m.l - m.r), Y = (v) => H - m.b - (v / VMAX) * (H - m.t - m.b);
  let hoverR = null;

  const speed = (R, parts) => P.vcirc(R, parts) / KMS;
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = '10px system-ui, sans-serif'; ctx.lineWidth = 1;
    for (let v = 0; v <= VMAX; v += 100) {
      ctx.strokeStyle = v === 0 ? AXIS : GRID;
      ctx.beginPath(); ctx.moveTo(m.l, Y(v) + 0.5); ctx.lineTo(W - m.r, Y(v) + 0.5); ctx.stroke();
      ctx.fillStyle = MUTED; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(v, m.l - 5, Y(v));
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let R = 0; R <= RMAX; R += 5) ctx.fillText(`${R}`, X(R), H - m.b + 5);

    const rs = sunR();
    ctx.setLineDash([3, 3]); ctx.strokeStyle = MUTED;
    ctx.beginPath(); ctx.moveTo(X(rs) + 0.5, Y(VMAX)); ctx.lineTo(X(rs) + 0.5, Y(0)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = INK2; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText('Sun', X(rs), m.t);

    const line = (parts, color, width) => {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let k = 0; k <= 120; k++) { const R = 0.05 + (k / 120) * (RMAX - 0.05), v = speed(R, parts); k ? ctx.lineTo(X(R), Y(v)) : ctx.moveTo(X(R), Y(v)); }
      ctx.stroke();
    };
    SERIES.forEach((s) => line(s.parts, s.color, 2));
    line(7, INK, 2);

    if (hoverR !== null) {
      ctx.strokeStyle = INK2; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(hoverR) + 0.5, Y(VMAX)); ctx.lineTo(X(hoverR) + 0.5, Y(0)); ctx.stroke();
      const rows = [['Total', speed(hoverR, 7), INK], ...SERIES.map((s) => [s.name, speed(hoverR, s.parts), s.color])];
      rows.forEach(([, v, c]) => { ctx.fillStyle = c; ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(hoverR), Y(v), 4, 0, 7); ctx.stroke(); ctx.fill(); });
      tip.innerHTML = `<b>${hoverR.toFixed(1)} kpc</b>` + rows.map(([n, v, c]) => `<div><i style="background:${c}"></i>${n}<span>${v.toFixed(0)} km/s</span></div>`).join('');
      tip.style.display = 'block';
      tip.style.left = `${X(hoverR) > W / 2 ? X(hoverR) - 150 : X(hoverR) + 10}px`;
    } else tip.style.display = 'none';
  }
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    const R = ((e.clientX - r.left - m.l) / (W - m.l - m.r)) * RMAX;
    hoverR = R >= 0.1 && R <= RMAX ? R : null; draw();
  });
  canvas.addEventListener('pointerleave', () => { hoverR = null; draw(); });
  draw();
  let lastR = -1;
  return { draw, tick() { const r = sunR(); if (Math.abs(r - lastR) > 0.05) { lastR = r; draw(); } } };
}
