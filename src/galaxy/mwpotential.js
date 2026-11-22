// Milky Way gravitational potential (kpc, Myr, Msun), loosely after McMillan (2017) / Bovy (2015):
//   Hernquist bulge + thin & thick Miyamoto–Nagai disks + NFW dark-matter halo (axisymmetric part)
//   + a rotating quadrupole bar + a rotating logarithmic two-armed spiral (density-wave perturbations).
// Frame: Galactocentric, z = north Galactic pole, Sun at x = -8.2 kpc. The Galaxy rotates clockwise seen
// from the north pole, i.e. towards -phi, so all patterns rotate with angle(t) = angle0 - Omega t.
import { G, KMS } from './units.js';

export const R_SUN = 8.2;
export const Z_SUN = 0.02;
export const V_SUN = [11.1, 12.24 + 233.5, 7.25]; // km/s: (U, V + v_c, W), Schönrich et al. 2010 peculiar motion

export const DEFAULTS = {
  bulgeM: 1.0e10, bulgeA: 0.6,
  thinM: 5.0e10, thinA: 3.0, thinB: 0.28,
  thickM: 1.2e10, thickA: 2.6, thickB: 0.9,
  haloM: 1.0e12, haloRs: 16, haloC: 12,     // NFW characteristic mass M_s = 4 pi rho0 rs^3 derived from M_vir
  haloMult: 1,                              // dark-matter multiplier (GUI)
  barStrength: 1, barOmega: 40, barLen: 4.5, barAngle0: (180 - 27) * Math.PI / 180,
  spiralStrength: 1, spiralOmega: 20, spiralPitch: 13, spiralArms: 2,
  spiralPhase0: 0, // set below so that the Perseus arm crosses the Sun–anticentre line at R ≈ 10 kpc
};
DEFAULTS.spiralPhase0 = Math.PI - Math.log(10 / R_SUN) / Math.tan(DEFAULTS.spiralPitch * Math.PI / 180);

const nfwMs = (p) => p.haloM / (Math.log(1 + p.haloC) - p.haloC / (1 + p.haloC));

// Everything the force routine needs, refreshed with update(params) / setTime(t).
export class MWPotential {
  constructor(params = {}) {
    this.p = { ...DEFAULTS, ...params };
    this.update();
    this.setTime(0);
  }

  update(params) {
    if (params) Object.assign(this.p, params);
    const p = this.p;
    this.GMb = G * p.bulgeM;
    this.GMd1 = G * p.thinM; this.GMd2 = G * p.thickM;
    this.GMh = G * nfwMs(p) * p.haloMult;
    // bar: Phi = -A (x'^2 - y'^2) (1 + r^2/Rb^2)^(-4); A tuned for a peak tangential/radial force ratio ~ 0.2
    this.barA = p.barStrength * 0.8 * (220 * KMS) ** 2 / (p.barLen * p.barLen);
    this.barInvRb2 = 1 / (p.barLen * p.barLen);
    // spiral: Phi = -S(R) cos(m (phi - phase(t)) - m ln(R/Rsun)/tan(pitch)), S(R) = A R/Rs exp(-R/Rs)
    this.spA = p.spiralStrength * 0.028 * (220 * KMS) ** 2;
    this.spRs = 4.5;
    this.spM = p.spiralArms;
    this.spCot = 1 / Math.tan(p.spiralPitch * Math.PI / 180);
  }

  setTime(t) {
    const p = this.p;
    this.t = t;
    const ab = p.barAngle0 - p.barOmega * KMS * t;
    this.bc = Math.cos(ab); this.bs = Math.sin(ab);
    this.spPhase = p.spiralPhase0 - p.spiralOmega * KMS * t;
  }

  // Acceleration at (x, y, z) into out[o..o+2]. parts: bitmask 1 bulge, 2 disks, 4 halo, 8 bar, 16 spiral.
  acc(x, y, z, out, o = 0, parts = 31) {
    let ax = 0, ay = 0, az = 0;
    const R2 = x * x + y * y, z2 = z * z, r2 = R2 + z2, r = Math.sqrt(r2) + 1e-9;
    if (parts & 1) { // Hernquist: a = -GM / (r (r + a)^2) * vec r
      const q = this.p.bulgeA + r, f = -this.GMb / (r * q * q);
      ax += f * x; ay += f * y; az += f * z;
    }
    if (parts & 2) { // Miyamoto–Nagai
      const p = this.p;
      let s = Math.sqrt(z2 + p.thinB * p.thinB), d = p.thinA + s, D = R2 + d * d, f = -this.GMd1 / (D * Math.sqrt(D));
      ax += f * x; ay += f * y; az += f * z * d / s;
      s = Math.sqrt(z2 + p.thickB * p.thickB); d = p.thickA + s; D = R2 + d * d; f = -this.GMd2 / (D * Math.sqrt(D));
      ax += f * x; ay += f * y; az += f * z * d / s;
    }
    if (parts & 4) { // NFW: M(<r) = Ms [ln(1+x) - x/(1+x)]
      const xx = r / this.p.haloRs, f = -this.GMh * (Math.log(1 + xx) - xx / (1 + xx)) / (r2 * r);
      ax += f * x; ay += f * y; az += f * z;
    }
    if ((parts & 8) && this.barA !== 0) {
      const c = this.bc, s = this.bs;
      const xp = x * c + y * s, yp = -x * s + y * c;
      const u = 1 + r2 * this.barInvRb2, g = 1 / (u * u * u * u), dg = -4 * g / u * this.barInvRb2; // dg/d(r^2)
      const Q = xp * xp - yp * yp, A = this.barA;
      const fxp = A * (2 * xp * g + Q * dg * 2 * xp), fyp = A * (-2 * yp * g + Q * dg * 2 * yp), fz = A * Q * dg * 2 * z;
      ax += fxp * c - fyp * s; ay += fxp * s + fyp * c; az += fz;
    }
    if ((parts & 16) && this.spA !== 0 && R2 > 1e-6) {
      const R = Math.sqrt(R2), m = this.spM, Rs = this.spRs;
      const phi = Math.atan2(y, x);
      const gam = m * (phi - this.spPhase) - m * Math.log(R / 8.2) * this.spCot;
      const cg = Math.cos(gam), sg = Math.sin(gam);
      const ex = Math.exp(-R / Rs), S = this.spA * R / Rs * ex, dS = this.spA / Rs * ex * (1 - R / Rs);
      const vert = 1 / Math.cosh(z / 0.3); // keep it in the disk; its own z-force is neglected
      // Phi = -S cos(gam):  dPhi/dR = -dS cos + S sin * dgam/dR,  dgam/dR = -m cot / R ; dPhi/dphi = S sin * m
      const dPdR = (-dS * cg - S * sg * m * this.spCot / R) * vert;
      const dPdphi = S * sg * m * vert;
      const aR = -dPdR, aphi = -dPdphi / R;
      const cx = x / R, sy = y / R;
      ax += aR * cx - aphi * sy; ay += aR * sy + aphi * cx;
    }
    out[o] = ax; out[o + 1] = ay; out[o + 2] = az;
  }

  // Circular speed (kpc/Myr) in the plane from the axisymmetric parts selected by `parts`.
  vcirc(R, parts = 7) {
    const a = [0, 0, 0];
    this.acc(R, 0, 0, a, 0, parts);
    return Math.sqrt(Math.max(0, -a[0] * R));
  }

  // Galactic azimuth of the arm centre lines at radius R (k-th arm). Main arms: k = 0..m-1.
  armPhi(R, k, t = this.t) {
    const p = this.p;
    return p.spiralPhase0 - p.spiralOmega * KMS * t + Math.log(R / 8.2) * this.spCot + (2 * Math.PI * k) / this.spM;
  }
}
