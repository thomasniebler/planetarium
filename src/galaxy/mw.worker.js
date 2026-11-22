// Integrates one slice of the Milky Way's test particles (leapfrog, kick-drift-kick) in the analytic potential.
import { MWPotential } from './mwpotential.js';
import { spawn, SHORT_LIVED } from './mwmodel.js';
import { rng } from './units.js';

let P, S, acc, r, t = 0;
const DT_MAX = 0.5; // Myr

function accAll() {
  const { n, pos } = S;
  for (let i = 0; i < n; i++) P.acc(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2], acc, 3 * i);
}

function step(dt) {
  const { n, pos, vel, type, born, life } = S, m = 3 * n, h = dt / 2;
  for (let k = 0; k < m; k++) { vel[k] += acc[k] * h; pos[k] += vel[k] * dt; }
  t += dt;
  P.setTime(t);
  accAll();
  for (let k = 0; k < m; k++) vel[k] += acc[k] * h;
  for (let i = 0; i < n; i++) {
    if (SHORT_LIVED(type[i]) && t - born[i] > life[i]) {
      spawn(P, i, type[i], pos, vel, born, life, r, t);
      P.acc(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2], acc, 3 * i);
    }
  }
}

function advance(total, dtMax) {
  if (total <= 0) return;
  const steps = Math.ceil(total / dtMax - 1e-9);
  for (let s = 0; s < steps; s++) step(total / steps);
}

onmessage = ({ data: msg }) => {
  if (msg.cmd === 'init') {
    S = msg.slice;
    r = rng(msg.seed);
    t = msg.t0;
    P = new MWPotential(msg.params);
    const target = { barStrength: P.p.barStrength, spiralStrength: P.p.spiralStrength };
    P.setTime(t);
    acc = new Float64Array(3 * S.n);
    // warm-up: let the old stars respond to the bar and spiral (grown in over the first half), so the
    // galaxy is in a settled state at t = 0 ("today")
    const warm = -t, ramp = warm / 2;
    while (t < -1e-9) {
      const f = Math.min(1, (t + warm) / ramp), g = f * f * (3 - 2 * f);
      P.update({ barStrength: target.barStrength * g, spiralStrength: target.spiralStrength * g });
      P.setTime(t); accAll();
      advance(Math.min(5, -t), 1);
    }
    t = 0;
    P.update(target); P.setTime(t); accAll();
    postMessage({ cmd: 'ready' });
  } else if (msg.cmd === 'params') {
    P.update(msg.params); P.setTime(t); accAll();
  } else if (msg.cmd === 'step') {
    advance(msg.dt, DT_MAX);
    const { n, pos, born, life, type } = S, out = new Float32Array(msg.buf), frac = new Float32Array(msg.frac);
    for (let k = 0; k < 3 * n; k++) out[k] = pos[k];
    for (let i = 0; i < n; i++) frac[i] = SHORT_LIVED(type[i]) ? (t - born[i]) / life[i] : 0;
    postMessage({ cmd: 'step', t, buf: msg.buf, frac: msg.frac }, [msg.buf, msg.frac]);
  }
};
