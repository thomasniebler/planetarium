// Full N-body gravity (every body attracts every other), leapfrog (kick-drift-kick) integrator.
import { G0, AU_KM, MSUN_KG } from './bodies.js';

const D = Math.PI / 180;
const EPS2 = 1e-13;      // softening^2 (AU^2), ~50 km: only matters for direct hits
const MAX_DT = 0.004;    // days; Phobos orbits in 0.32 d
const MAX_STEPS = 4000;  // per frame
const HARD_DT = 0.02;    // never integrate coarser than this

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function elementsToState(el, mu, tDays) {
  const [a, e, I, L, varpi, Om] = el;
  const n = Math.sqrt(mu / (a * a * a));
  let M = (L - varpi) * D + n * tDays;
  M = M - 2 * Math.PI * Math.round(M / (2 * Math.PI));
  let E = M + e * Math.sin(M);
  for (let k = 0; k < 10; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const b = a * Math.sqrt(1 - e * e);
  const cE = Math.cos(E), sE = Math.sin(E);
  const Ed = n / (1 - e * cE);
  const w = (varpi - Om) * D, i = I * D, O = Om * D;
  const cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(i), si = Math.sin(i), cO = Math.cos(O), sO = Math.sin(O);
  const rot = (x, y) => [
    (cw * cO - sw * sO * ci) * x + (-sw * cO - cw * sO * ci) * y,
    (cw * sO + sw * cO * ci) * x + (-sw * sO + cw * cO * ci) * y,
    sw * si * x + cw * si * y,
  ];
  return { r: rot(a * (cE - e), b * sE), v: rot(-a * sE * Ed, b * cE * Ed) };
}

export class Sim {
  constructor(defs) {
    this.defs = defs;
    const n = (this.n = defs.length);
    this.pos = new Float64Array(3 * n);
    this.vel = new Float64Array(3 * n);
    this.acc = new Float64Array(3 * n);
    this.baseMass = new Float64Array(n);
    this.massMult = new Float64Array(n).fill(1);
    this.mass = new Float64Array(n);
    this.parent = new Int32Array(n).fill(-1); // orbital reference body (Sun for planets)
    this.isMoon = new Uint8Array(n);
    this.period0 = new Float64Array(n);       // initial orbital period (days)
    this.pole = [];
    this.gMult = 1;
    this.t = 0;                               // days since J2000
    this.index = new Map(defs.map((d, i) => [d.name, i]));
    defs.forEach((d, i) => {
      this.baseMass[i] = d.mass ?? d.massKg / MSUN_KG;
      if (d.parent) { this.parent[i] = this.index.get(d.parent); this.isMoon[i] = 1; }
      else if (i > 0) this.parent[i] = 0;
      const eps = (d.tilt || 0) * D, lon = (d.poleLon ?? 90) * D;
      this.pole[i] = [Math.sin(eps) * Math.cos(lon), Math.sin(eps) * Math.sin(lon), Math.cos(eps)];
    });
    // moons: spin axis = orbit normal
    defs.forEach((d, i) => {
      if (!d.parent) return;
      let nrm;
      if (d.plane === 'ecliptic') { const inc = (d.incl || 0) * D; nrm = [Math.sin(inc), 0, Math.cos(inc)]; }
      else { nrm = this.pole[this.parent[i]].slice(); if (d.retrograde) nrm = nrm.map((x) => -x); }
      this.pole[i] = nrm;
    });
  }

  // Real solar system state at the given epoch (multipliers do not affect the initial state).
  reset(epochDays) {
    const { defs, pos, vel, baseMass, n } = this;
    pos.fill(0); vel.fill(0);
    defs.forEach((d, i) => {
      if (i === 0) return;
      const p = this.parent[i];
      const mu = G0 * (baseMass[p] + baseMass[i]);
      let r, v;
      if (d.el) {
        ({ r, v } = elementsToState(d.el, mu, epochDays));
        this.period0[i] = 2 * Math.PI * Math.sqrt(d.el[0] ** 3 / mu);
      } else {
        const a = d.aKm / AU_KM, nrm = this.pole[i];
        const ref = Math.abs(nrm[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
        const u = norm(cross(ref, nrm)), w = cross(nrm, u);
        const speed = Math.sqrt(mu / a), th = d.phase || 0, c = Math.cos(th), s = Math.sin(th);
        r = [0, 1, 2].map((k) => a * (c * u[k] + s * w[k]));
        v = [0, 1, 2].map((k) => speed * (-s * u[k] + c * w[k]));
        this.period0[i] = 2 * Math.PI * Math.sqrt(a ** 3 / mu);
      }
      for (let k = 0; k < 3; k++) { pos[3 * i + k] = pos[3 * p + k] + r[k]; vel[3 * i + k] = vel[3 * p + k] + v[k]; }
    });
    // barycentric frame
    let M = 0; const cp = [0, 0, 0], cv = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      M += baseMass[i];
      for (let k = 0; k < 3; k++) { cp[k] += baseMass[i] * pos[3 * i + k]; cv[k] += baseMass[i] * vel[3 * i + k]; }
    }
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { pos[3 * i + k] -= cp[k] / M; vel[3 * i + k] -= cv[k] / M; }
    this.t = epochDays;
    this.updateMasses();
  }

  updateMasses() {
    for (let i = 0; i < this.n; i++) this.mass[i] = this.baseMass[i] * this.massMult[i];
    this.computeAcc();
  }

  computeAcc() {
    const { n, pos, acc, mass } = this;
    const G = G0 * this.gMult;
    acc.fill(0);
    for (let i = 0; i < n; i++) {
      const ix = 3 * i, xi = pos[ix], yi = pos[ix + 1], zi = pos[ix + 2], mi = mass[i];
      let ax = 0, ay = 0, az = 0;
      for (let j = i + 1; j < n; j++) {
        const jx = 3 * j;
        const dx = pos[jx] - xi, dy = pos[jx + 1] - yi, dz = pos[jx + 2] - zi;
        const r2 = dx * dx + dy * dy + dz * dz + EPS2;
        const inv = G / (r2 * Math.sqrt(r2));
        const sj = inv * mass[j], si = inv * mi;
        ax += dx * sj; ay += dy * sj; az += dz * sj;
        acc[jx] -= dx * si; acc[jx + 1] -= dy * si; acc[jx + 2] -= dz * si;
      }
      acc[ix] += ax; acc[ix + 1] += ay; acc[ix + 2] += az;
    }
  }

  // Advance by simDt days (may be negative). Returns the time actually advanced.
  advance(simDt) {
    if (simDt === 0) return 0;
    let steps = Math.min(MAX_STEPS, Math.ceil(Math.abs(simDt) / MAX_DT));
    let dt = simDt / steps;
    if (Math.abs(dt) > HARD_DT) dt = Math.sign(dt) * HARD_DT; // too fast for this frame: fall behind rather than blow up
    const { pos, vel, acc } = this, m = pos.length, h = dt / 2;
    for (let s = 0; s < steps; s++) {
      for (let k = 0; k < m; k++) { vel[k] += acc[k] * h; pos[k] += vel[k] * dt; }
      this.computeAcc();
      for (let k = 0; k < m; k++) vel[k] += acc[k] * h;
    }
    this.t += dt * steps;
    return dt * steps;
  }

  // Osculating (instantaneous two-body) orbit of body i around its reference body.
  osculating(i) {
    const j = this.parent[i];
    if (j < 0) return null;
    const { pos, vel } = this;
    const mu = G0 * this.gMult * (this.mass[i] + this.mass[j]);
    const r = [0, 1, 2].map((k) => pos[3 * i + k] - pos[3 * j + k]);
    const v = [0, 1, 2].map((k) => vel[3 * i + k] - vel[3 * j + k]);
    const rl = Math.hypot(...r), v2 = dot(v, v);
    const out = { r, v, dist: rl, speed: Math.sqrt(v2), mu, bound: false };
    if (!(mu > 1e-18)) return out;
    const h = cross(r, v), hl = Math.hypot(...h);
    if (hl < 1e-18) return out;
    const vxh = cross(v, h);
    const ev = [0, 1, 2].map((k) => vxh[k] / mu - r[k] / rl);
    const e = Math.hypot(...ev);
    const energy = v2 / 2 - mu / rl;
    if (Math.abs(energy) < 1e-18) return out;
    const a = -mu / (2 * energy);
    const P = e > 1e-9 ? ev.map((x) => x / e) : r.map((x) => x / rl);
    const Q = cross(h.map((x) => x / hl), P);
    out.a = a; out.e = e; out.P = P; out.Q = Q;
    out.bound = e < 1;
    if (out.bound) out.period = 2 * Math.PI * Math.sqrt((a * a * a) / mu);
    return out;
  }
}
