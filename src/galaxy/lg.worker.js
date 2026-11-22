// Integrates the Local Group: galaxy centres (identically in every worker) and one slice of the stars.
import { GALAXIES, Halos } from './lgmodel.js';

let H, S, acc, t = 0;
const DT_MAX = 1; // Myr

function starAccAll() {
  const { n, pos } = S;
  for (let i = 0; i < n; i++) H.starAcc(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2], acc, 3 * i);
}

function step(dt) {
  const h = dt / 2, { pos, vel } = S, m = 3 * S.n, hp = H.pos, hv = H.vel, ha = H.acc, hm = hp.length;
  for (let k = 0; k < hm; k++) { hv[k] += ha[k] * h; hp[k] += hv[k] * dt; }
  for (let k = 0; k < m; k++) { vel[k] += acc[k] * h; pos[k] += vel[k] * dt; }
  H.computeAcc();
  starAccAll();
  for (let k = 0; k < hm; k++) hv[k] += ha[k] * h;
  for (let k = 0; k < m; k++) vel[k] += acc[k] * h;
  t += dt;
}

onmessage = ({ data: msg }) => {
  if (msg.cmd === 'init') {
    S = msg.slice;
    H = new Halos(GALAXIES, { friction: msg.friction });
    msg.massMult.forEach((f, i) => H.setMassMult(i, f));
    H.pos.set(msg.halos.pos); H.vel.set(msg.halos.vel);
    H.computeAcc();
    acc = new Float64Array(3 * S.n);
    starAccAll();
    t = 0;
    postMessage({ cmd: 'ready' });
  } else if (msg.cmd === 'params') {
    if (msg.friction !== undefined) H.friction = msg.friction;
    if (msg.massMult) msg.massMult.forEach((f, i) => H.setMassMult(i, f));
    H.computeAcc(); starAccAll();
  } else if (msg.cmd === 'step') {
    if (msg.dt > 0) {
      const steps = Math.ceil(msg.dt / DT_MAX - 1e-9);
      for (let s = 0; s < steps; s++) step(msg.dt / steps);
    }
    const out = new Float32Array(msg.buf), val = new Float32Array(msg.frac);
    for (let k = 0; k < 3 * S.n; k++) out[k] = S.pos[k];
    val.set(S.val);
    postMessage({ cmd: 'step', t, buf: msg.buf, frac: msg.frac, halos: { pos: H.pos.slice(), vel: H.vel.slice() } }, [msg.buf, msg.frac]);
  }
};
