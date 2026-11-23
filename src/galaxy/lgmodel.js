// Local Group model (kpc, Myr, Msun). "Restricted N-body", as in Toomre & Toomre (1972) and the orbit studies of
// van der Marel et al. (2012) / Patel et al. (2017):
//  - each galaxy is a rigid, spherical mass distribution (Hernquist bulge + disk + dark halo) whose centre
//    moves under the gravity of all the others, plus Chandrasekhar dynamical friction, which drains orbital
//    energy so that galaxies can actually merge;
//  - stars are massless test particles feeling every galaxy's potential: tidal tails, bridges and the final
//    merger remnant all come from that.
// Positions/velocities: Galactocentric (x from the Sun towards the Galactic centre, z = north Galactic pole).
import { G, KMS, rng } from './units.js';

const D = Math.PI / 180;
const SOFT2 = 4 * 4; // kpc^2

// mass components: [mass, Hernquist scale radius]
export const GALAXIES = [
  { key: 'MW', name: 'Milky Way', color: '#ffd9a0',
    comps: [[1.2e12, 30], [6.0e10, 3.0], [1.2e10, 0.7]],
    stars: { disk: 22000, bulge: 6000, halo: 2500, Rd: 2.6, hz: 0.3, Rmax: 17, bulgeA: 0.7, haloR: 25 }, lum: 5.5e10,
    pos: [0, 0, 0], vel: [0, 0, 0], spin: 'mw' },
  { key: 'M31', name: 'Andromeda (M31)', color: '#cfe0ff',
    comps: [[1.7e12, 35], [7.5e10, 4.5], [2.5e10, 1.0]],
    stars: { disk: 28000, bulge: 8000, halo: 3500, Rd: 5.3, hz: 0.4, Rmax: 28, bulgeA: 1.0, haloR: 35 }, lum: 1.0e11,
    // van der Marel et al. (2012): Galactocentric position and velocity
    pos: [-378.9, 612.7, -283.1], vel: [66.1, -76.3, 45.1],
    sky: { ra: 10.6847, dec: 41.2690, incl: 77.5, pa: 37.7, recedingAlongPA: true, nearSide: -1 } },
  { key: 'M33', name: 'Triangulum (M33)', color: '#b8d4ff',
    comps: [[1.6e11, 14], [5.0e9, 1.4]],
    stars: { disk: 8000, bulge: 0, halo: 0, Rd: 1.4, hz: 0.15, Rmax: 8 }, lum: 5e9,
    pos: [-476.1, 491.1, -412.9], vel: [43.1, 101.3, 138.8],
    sky: { ra: 23.4621, dec: 30.6599, incl: 54, pa: 22.5, recedingAlongPA: false, nearSide: 1 } },
  { key: 'LMC', name: 'Large Magellanic Cloud', color: '#c8dcff',
    comps: [[1.2e11, 12], [3.0e9, 1.5]],
    stars: { disk: 5000, bulge: 0, halo: 0, Rd: 1.5, hz: 0.3, Rmax: 7 }, lum: 3e9,
    // Kallivayalil et al. (2013)
    pos: [-1, -41, -28], vel: [-57, -226, 221],
    sky: { ra: 80.894, dec: -69.756, incl: 26.2, pa: 154.5, clockwise: true, nearSide: -1 } },
  { key: 'SMC', name: 'Small Magellanic Cloud', color: '#d4e2ff',
    comps: [[6e9, 3], [4e8, 1.0]],
    stars: { disk: 0, bulge: 2200, halo: 0, bulgeA: 1.0 }, lum: 5e8,
    pos: [15.3, -36.9, -43.3], vel: [19, -153, 153] },
];

// --- disk orientations from where they sit on the sky -----------------------------------------
const EQ2GAL = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.4448296300, 0.7469822445],
  [-0.8676661490, -0.1980763734, 0.4559837762],
];
const mul = (M, v) => M.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lin = (...terms) => [0, 1, 2].map((k) => terms.reduce((s, [f, v]) => s + f * v[k], 0));
const unit = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };

// Spin axis (unit angular momentum, Galactic axes) of a disk with inclination `incl` and major-axis position
// angle `pa`; nearSide = +1/-1 says whether the near side lies at PA + 90 or PA - 90; the rotation sense comes
// from `recedingAlongPA` (the half of the major axis at PA recedes) or `clockwise` (as seen on the sky).
export function spinFromSky({ ra, dec, incl, pa, recedingAlongPA, clockwise, nearSide }) {
  const a = ra * D, d = dec * D, i = incl * D, t = pa * D;
  const los = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  const east = [-Math.sin(a), Math.cos(a), 0];
  const north = [-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)];
  const major = lin([Math.cos(t), north], [Math.sin(t), east]);
  const minor = lin([-Math.sin(t), north], [Math.cos(t), east]);
  const toNear = lin([nearSide * Math.cos(i), minor], [-Math.sin(i), los]); // in-plane, towards the near side
  let n = unit(cross(major, toNear));
  if (clockwise !== undefined) { if ((dot(n, los) > 0) !== clockwise) n = n.map((x) => -x); }
  else {
    const v = cross(n, major); // velocity of the point on the major axis at PA
    if ((dot(v, los) > 0) !== recedingAlongPA) n = n.map((x) => -x);
  }
  return mul(EQ2GAL, n);
}

// orthonormal basis (u, w, n) with n = spin axis; disk points are R (cos p u + sin p w), rotating towards +p
export function basis(n) {
  const ref = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = unit(cross(ref, n)), w = cross(n, u);
  return [u, w, n];
}

export function spinOf(g) {
  if (g.spin === 'mw') return [0, 0, -1]; // the Milky Way turns clockwise seen from the north Galactic pole
  if (g.sky) return spinFromSky(g.sky);
  return unit([0.3, -0.5, 0.8]);
}

// --- dynamics of the galaxy centres -------------------------------------------------------------
export class Halos {
  constructor(defs, opts = {}) {
    this.n = defs.length;
    this.comps = defs.map((g) => g.comps.map(([m, a]) => [m, a]));
    this.base = defs.map((g) => g.comps.map(([m]) => m));
    this.pos = new Float64Array(3 * this.n);
    this.vel = new Float64Array(3 * this.n);
    this.acc = new Float64Array(3 * this.n);
    this.massMult = new Float64Array(this.n).fill(1);
    this.friction = opts.friction ?? true;
    this.lnL = opts.lnL ?? 0.6;
    this.alive = new Uint8Array(this.n).fill(1);
  }

  mass(i) { return this.comps[i].reduce((s, c) => s + c[0], 0); }
  setMassMult(i, f) { this.massMult[i] = f; this.comps[i].forEach((c, k) => { c[0] = this.base[i][k] * f; }); }

  // M(<r) of galaxy j and its halo density
  enclosed(j, r) { let m = 0; for (const [M, a] of this.comps[j]) m += M * r * r / ((r + a) * (r + a)); return m; }
  density(j, r) { let rho = 0; for (const [M, a] of this.comps[j]) rho += M * a / (2 * Math.PI * Math.max(r, 0.05) * (r + a) ** 3); return rho; }

  // acceleration of a massless particle at (x, y, z) from all galaxies, into out[o..]
  starAcc(x, y, z, out, o) {
    let ax = 0, ay = 0, az = 0;
    const { pos, comps, n } = this;
    for (let j = 0; j < n; j++) {
      const dx = x - pos[3 * j], dy = y - pos[3 * j + 1], dz = z - pos[3 * j + 2];
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6;
      const cj = comps[j];
      let f = 0;
      for (let k = 0; k < cj.length; k++) { const q = r + cj[k][1]; f += cj[k][0] / (q * q); }
      f = -G * f / r;
      ax += f * dx; ay += f * dy; az += f * dz;
    }
    out[o] = ax; out[o + 1] = ay; out[o + 2] = az;
  }

  computeAcc() {
    const { pos, vel, acc, n } = this;
    acc.fill(0);
    const M = Array.from({ length: n }, (_, i) => this.mass(i));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dx = pos[3 * i] - pos[3 * j], dy = pos[3 * i + 1] - pos[3 * j + 1], dz = pos[3 * i + 2] - pos[3 * j + 2];
        // centres are softened by a few kpc: galaxies are extended, and a point-like passage through a bulge cusp
        // would make the integrator inject energy (slingshots) where real galaxies would simply merge
        const r = Math.sqrt(dx * dx + dy * dy + dz * dz + SOFT2);
        // gravity of j on i's centre (i treated as a point in j's potential); symmetrised so momentum is kept
        const gij = (this.enclosed(j, r) / r ** 3) * M[i], gji = (this.enclosed(i, r) / r ** 3) * M[j];
        const f = -G * 0.5 * (gij + gji) / M[i];
        acc[3 * i] += f * dx; acc[3 * i + 1] += f * dy; acc[3 * i + 2] += f * dz;
        // dynamical friction on the lighter galaxy from the heavier one's halo; the heavier one gets the recoil
        if (this.friction && M[i] < M[j] || (this.friction && M[i] === M[j] && i > j)) {
          const vx = vel[3 * i] - vel[3 * j], vy = vel[3 * i + 1] - vel[3 * j + 1], vz = vel[3 * i + 2] - vel[3 * j + 2];
          const v = Math.sqrt(vx * vx + vy * vy + vz * vz) + 1e-9;
          const sigma = Math.sqrt(G * this.enclosed(j, r) / r / 2);
          const X = v / (Math.SQRT2 * sigma);
          const lnL = this.lnL * Math.max(0.3, Math.log(1 + r / (1.4 * this.comps[i][0][1] * 0.5)));
          let fd = -4 * Math.PI * G * G * M[i] * this.density(j, r) * lnL / (v * v * v) * (erf(X) - 2 * X / Math.sqrt(Math.PI) * Math.exp(-X * X));
          // once two centres have sunk together the drag rate gets huge; cap it (|fd| is a damping rate per Myr),
          // which also keeps the explicit integrator stable (it needs rate * dt well below 2)
          fd = Math.max(fd, -0.08 / (1 + M[i] / M[j]));
          acc[3 * i] += fd * vx; acc[3 * i + 1] += fd * vy; acc[3 * i + 2] += fd * vz;
          const rr = -M[i] / M[j];
          acc[3 * j] += rr * fd * vx; acc[3 * j + 1] += rr * fd * vy; acc[3 * j + 2] += rr * fd * vz;
        }
      }
    }
  }
}

function erf(x) { // Abramowitz & Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

// Initial conditions in the Local Group barycentre frame. tangential: override M31's sideways speed (km/s).
export function initialHalos(halos, defs, { m31Tangential = null } = {}) {
  const P = defs.map((g) => g.pos.slice()), V = defs.map((g) => g.vel.slice());
  if (m31Tangential !== null) {
    const iM = defs.findIndex((g) => g.key === 'M31');
    const r = P[iM], v = V[iM], rh = unit(r), vr = dot(v, rh);
    const vt = lin([1, v], [-vr, rh]), vtl = Math.hypot(...vt);
    const th = vtl > 1e-6 ? vt.map((x) => x / vtl) : unit(cross(rh, [0, 0, 1]));
    V[iM] = lin([vr, rh], [m31Tangential, th]);
  }
  let Mt = 0; const cp = [0, 0, 0], cv = [0, 0, 0];
  defs.forEach((g, i) => { const m = halos.mass(i); Mt += m; for (let k = 0; k < 3; k++) { cp[k] += m * P[i][k]; cv[k] += m * V[i][k]; } });
  defs.forEach((g, i) => {
    for (let k = 0; k < 3; k++) { halos.pos[3 * i + k] = P[i][k] - cp[k] / Mt; halos.vel[3 * i + k] = (V[i][k] - cv[k] / Mt) * KMS; }
  });
  halos.computeAcc();
}

export function m31Velocity(defs) {
  const g = defs.find((d) => d.key === 'M31'), rh = unit(g.pos), vr = dot(g.vel, rh);
  return { radial: vr, tangential: Math.hypot(...lin([1, g.vel], [-vr, rh])) };
}

// --- stars ---------------------------------------------------------------------------------------
// type: 0 disk, 1 bulge, 2 stellar halo.   val: brightness weight.   gal: galaxy index
export function buildStars(halos, defs, quality = 1, seed = 5) {
  const r = rng(seed);
  const list = [];
  defs.forEach((g, gi) => {
    const s = g.stars;
    const [u, w, nrm] = basis(spinOf(g));
    const c = [halos.pos[3 * gi], halos.pos[3 * gi + 1], halos.pos[3 * gi + 2]];
    const cv = [halos.vel[3 * gi], halos.vel[3 * gi + 1], halos.vel[3 * gi + 2]];
    const vcirc = (R) => Math.sqrt(G * halos.enclosed(gi, R) / R);
    const counts = { disk: Math.round((s.disk || 0) * quality), bulge: Math.round((s.bulge || 0) * quality), halo: Math.round((s.halo || 0) * quality) };
    const total = counts.disk + counts.bulge + counts.halo;
    const weight = Math.pow(g.lum / Math.max(total, 1) / 2e6, 0.5);
    for (let k = 0; k < counts.disk; k++) {
      let R;
      do R = -s.Rd * Math.log((r() + 1e-12) * (r() + 1e-12)); while (R > s.Rmax || R < 0.3);
      const p = r() * 2 * Math.PI, z = r.gauss() * s.hz * 0.6;
      const vc = vcirc(R), sig = 0.08 * vc;
      const vR = r.gauss() * sig, vp = vc + r.gauss() * sig * 0.6, vz = r.gauss() * sig * 0.5;
      const cp = Math.cos(p), sp = Math.sin(p);
      const x = lin([R * cp, u], [R * sp, w], [z, nrm]);
      const v = lin([vR * cp - vp * sp, u], [vR * sp + vp * cp, w], [vz, nrm]);
      list.push([gi, 0, x, v, weight * (0.7 + 0.6 * r())]);
    }
    const sphere = (type, cnt, a, rmax, rot) => {
      for (let k = 0; k < cnt; k++) {
        let rr;
        if (type === 1) do { const q = Math.sqrt(r()); rr = a * q / (1 - q); } while (rr > rmax);
        else do rr = 3 + rmax * Math.pow(r(), 1.8); while (rr > rmax);
        const ct = 2 * r() - 1, st = Math.sqrt(1 - ct * ct), ph = r() * 2 * Math.PI;
        const x = [rr * st * Math.cos(ph), rr * st * Math.sin(ph), rr * ct];
        const vc = vcirc(Math.max(rr, 0.05)), sig = vc / Math.sqrt(type === 1 ? 2.2 : 2);
        // a little rotation about the disk axis
        const tv = cross(nrm, x), tl = Math.hypot(...tv) || 1;
        const v = [0, 1, 2].map((q) => r.gauss() * sig + rot * vc * tv[q] / tl);
        list.push([gi, type, x, v, weight * (type === 2 ? 0.5 : 0.8)]);
      }
    };
    sphere(1, counts.bulge, s.bulgeA ?? 1, (s.bulgeA ?? 1) * 6, 0.3);
    sphere(2, counts.halo, 0, s.haloR ?? 20, 0.1);
    for (let k = list.length - total; k < list.length; k++) {
      const e = list[k];
      e[2] = e[2].map((x, q) => x + c[q]); e[3] = e[3].map((x, q) => x + cv[q]); // star velocities are already in kpc/Myr
    }
  });
  const n = list.length;
  const pos = new Float64Array(3 * n), vel = new Float64Array(3 * n), gal = new Uint8Array(n), type = new Uint8Array(n);
  const val = new Float32Array(n), seedA = new Float32Array(n);
  list.forEach(([gi, t, x, v, wt], i) => {
    pos.set(x, 3 * i); vel.set(v, 3 * i); gal[i] = gi; type[i] = t; val[i] = wt; seedA[i] = r();
  });
  return { n, pos, vel, gal, type, val, seed: seedA };
}
