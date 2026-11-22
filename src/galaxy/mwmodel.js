// Particle populations of the Milky Way scene and their (re)birth rules. Shared by the page and the workers.
//
// Old populations (thin/thick disk, bulge, stellar halo) are sampled once and then just orbit.
// Short-lived populations trace the spiral arms the way real galaxies show them: young stars, HII regions and
// dust are born where the spiral potential compresses gas (on the arm), age, drift off the arm while orbiting,
// fade and are reborn on an arm. That is the density-wave picture: the arms are a pattern, not a fixed set of stars.
import { KMS, rng } from './units.js';

export const TYPE = { THIN: 0, THICK: 1, BULGE: 2, HALO: 3, YOUNG: 4, HII: 5, DUST: 6 };
export const SHORT_LIVED = (t) => t >= TYPE.YOUNG;

// counts at full quality
export const COUNTS = { THIN: 46000, THICK: 7000, BULGE: 16000, HALO: 2500, YOUNG: 20000, HII: 2600, DUST: 9000 };

const LIFE = { [TYPE.YOUNG]: [25, 260], [TYPE.HII]: [6, 14], [TYPE.DUST]: [30, 70] }; // Myr, uniform range

// Disk velocity dispersions (km/s) at the solar radius, scaled with exp(-(R - Rsun)/(2 Rd))
const RD_THIN = 2.6, RD_THICK = 2.2;

export function buildPopulations(P, quality = 1, seed = 7) {
  const r = rng(seed);
  const order = ['THIN', 'THICK', 'BULGE', 'HALO', 'YOUNG', 'HII', 'DUST']; // DUST last: rendered separately
  const n = order.reduce((s, k) => s + Math.round(COUNTS[k] * quality), 0);
  const pos = new Float64Array(3 * n), vel = new Float64Array(3 * n);
  const type = new Uint8Array(n), seedA = new Float32Array(n), born = new Float32Array(n), life = new Float32Array(n);
  let i = 0;
  for (const k of order) {
    const t = TYPE[k], cnt = Math.round(COUNTS[k] * quality);
    for (let c = 0; c < cnt; c++, i++) {
      type[i] = t; seedA[i] = r();
      if (SHORT_LIVED(t)) {
        spawn(P, i, t, pos, vel, born, life, r, 0);
        born[i] = -r() * life[i]; // already at a random age, so the galaxy starts in steady state
      } else sampleOld(P, t, i, pos, vel, r);
    }
  }
  const dustStart = n - Math.round(COUNTS.DUST * quality);
  return { n, pos, vel, type, seed: seedA, born, life, dustStart };
}

function setCircular(P, i, R, phi, z, sigR, sigPhi, sigZ, lag, pos, vel, r) {
  const c = Math.cos(phi), s = Math.sin(phi);
  pos[3 * i] = R * c; pos[3 * i + 1] = R * s; pos[3 * i + 2] = z;
  const vc = P.vcirc(R) * (1 - lag);
  const vR = r.gauss() * sigR * KMS, vphi = -(vc + r.gauss() * sigPhi * KMS); // rotation towards -phi
  vel[3 * i] = vR * c - vphi * s; vel[3 * i + 1] = vR * s + vphi * c; vel[3 * i + 2] = r.gauss() * sigZ * KMS;
}

function expDiskR(r, Rd, Rmin, Rmax) {
  for (;;) { // radius from Sigma ~ exp(-R/Rd): R = -Rd ln(u1 u2) is Gamma(2, Rd)
    const R = -Rd * Math.log((r() + 1e-12) * (r() + 1e-12));
    if (R > Rmin && R < Rmax) return R;
  }
}

function sampleOld(P, t, i, pos, vel, r) {
  if (t === TYPE.THIN || t === TYPE.THICK) {
    const thin = t === TYPE.THIN, Rd = thin ? RD_THIN : RD_THICK;
    const R = expDiskR(r, Rd, thin ? 1.2 : 1.0, thin ? 17 : 13);
    const hz = thin ? 0.25 : 0.8;
    const z = hz * Math.atanh((2 * r() - 1) * 0.999) * 0.5; // sech^2 profile
    const f = Math.min(1.7, Math.exp(-(R - 8.2) / (2 * Rd)));
    const sR = (thin ? 32 : 55) * f, sZ = (thin ? 17 : 35) * f;
    const vc = P.vcirc(R);
    const lag = Math.min(0.5, (sR * KMS) ** 2 / (vc * vc) * 1.1); // asymmetric drift
    setCircular(P, i, R, r() * 2 * Math.PI, z, sR, sR * 0.65, sZ, lag, pos, vel, r);
  } else if (t === TYPE.BULGE) {
    // Hernquist sphere squashed into a bar-like ellipsoid, with some rotation; dispersion from local v_c
    let rr;
    do { const u = Math.sqrt(r()); rr = 0.6 * u / (1 - u); } while (rr > 3.5);
    const ct = 2 * r() - 1, st = Math.sqrt(1 - ct * ct), ph = r() * 2 * Math.PI;
    let x = rr * st * Math.cos(ph) * 1.25, y = rr * st * Math.sin(ph) * 0.75, z = rr * ct * 0.6;
    const c = P.bc, s = P.bs; // align with the bar
    const X = x * c - y * s, Y = x * s + y * c;
    pos[3 * i] = X; pos[3 * i + 1] = Y; pos[3 * i + 2] = z;
    const R = Math.max(Math.hypot(X, Y), 0.05), vc = P.vcirc(Math.max(Math.hypot(X, Y, z), 0.05));
    const sig = vc * 0.62, rot = vc * 0.45 * Math.min(1, R / 1.2);
    const vx = r.gauss() * sig + rot * Y / R, vy = r.gauss() * sig - rot * X / R;
    vel[3 * i] = vx; vel[3 * i + 1] = vy; vel[3 * i + 2] = r.gauss() * sig * 0.8;
  } else { // stellar halo: power-law sphere, isotropic, hot
    let rr;
    do { rr = 2 + 35 * Math.pow(r(), 2.2); } while (rr > 40);
    const ct = 2 * r() - 1, st = Math.sqrt(1 - ct * ct), ph = r() * 2 * Math.PI;
    pos[3 * i] = rr * st * Math.cos(ph); pos[3 * i + 1] = rr * st * Math.sin(ph); pos[3 * i + 2] = rr * ct;
    const sig = P.vcirc(rr) / Math.sqrt(2) * 0.9;
    vel[3 * i] = r.gauss() * sig; vel[3 * i + 1] = r.gauss() * sig - P.vcirc(rr) * 0.08; vel[3 * i + 2] = r.gauss() * sig;
  }
}

// Born on a spiral arm at time t. Main arms get most of the star formation; the two inter-arms (half a turn
// of phase between them) a bit, so the young disk shows a main two-armed pattern plus weaker secondary arms.
export function spawn(P, i, t, pos, vel, born, life, r, now) {
  const [l0, l1] = LIFE[t];
  life[i] = l0 + (l1 - l0) * (t === TYPE.YOUNG ? Math.pow(r(), 1.6) : r());
  born[i] = now;
  const R = expDiskR(r, 3.4, 3.4, 15.5);
  const m = P.spM, secondary = r() < 0.22;
  const k = Math.floor(r() * m);
  // arm width ~ 0.25 kpc across; dust sits on the inner (upstream) edge, HII right on the ridge
  const off = t === TYPE.DUST ? 0.22 : t === TYPE.HII ? -0.02 : -0.05;
  const w = t === TYPE.DUST ? 0.09 : t === TYPE.HII ? 0.12 : 0.2;
  const phi = P.armPhi(R, k + (secondary ? 0.5 : 0), now) + (off + r.gauss() * w) / R;
  const hz = t === TYPE.DUST ? 0.06 : t === TYPE.HII ? 0.05 : 0.08;
  setCircular(P, i, R, phi, r.gauss() * hz, 7, 5, 5, 0, pos, vel, r);
}
