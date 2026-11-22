// Galactic units: length kpc, time Myr, mass Msun.
export const G = 4.498502151469554e-12;   // kpc^3 / (Msun Myr^2)
export const KMS = 1.0227121650537077e-3; // 1 km/s in kpc/Myr
export const KMS_KPC = KMS;               // 1 km/s/kpc in rad/Myr

// Small deterministic PRNG so every page load starts from the same galaxy.
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  next.gauss = () => {
    let u = 0;
    while (u === 0) u = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
  return next;
}
