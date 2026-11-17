// Body catalogue. Physics units: AU, days, solar masses (ecliptic J2000, z = north).

export const AU_KM = 149597870.7;
export const MSUN_KG = 1.98847e30;
export const G0 = 2.959122082855911e-4; // AU^3 / (Msun day^2)

// Planet elements at J2000: [a (AU), e, I (deg), L (deg), long. of perihelion (deg), long. of asc. node (deg)]
// tilt = obliquity (deg), poleLon = ecliptic longitude the pole leans towards (deg, mostly cosmetic)
// rotH = sidereal rotation period (hours). Moons are placed on circular orbits and rotate once per orbit.
export const BODIES = [
  { name: 'Sun', tex: 'sun', mass: 1, radiusKm: 695700, rotH: 609.1, tilt: 7.25, poleLon: 76, color: '#ffd27a' },

  { name: 'Mercury', tex: 'mercury', seed: 1.3, mass: 1.6601e-7, radiusKm: 2439.7, rotH: 1407.6, tilt: 0.03,
    el: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
    color: '#b5aca3', bump: 0.035 },

  { name: 'Venus', tex: 'venus', seed: 2.7, mass: 2.4478e-6, radiusKm: 6051.8, rotH: 5832.5, tilt: 177.36, poleLon: 30,
    el: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
    color: '#e8cf9a', atmo: { color: [1.0, 0.82, 0.5], strength: 0.9, power: 2.5 } },

  { name: 'Earth', tex: 'earth', seed: 4.1, mass: 3.0035e-6, radiusKm: 6371, rotH: 23.934, tilt: 23.44, poleLon: 90,
    el: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
    color: '#6fa8ff', bump: 0.02, clouds: true, atmo: { color: [0.35, 0.6, 1.0], strength: 1.0, power: 3.0 } },
  { name: 'Moon', parent: 'Earth', tex: 'moon', seed: 5.9, massKg: 7.342e22, radiusKm: 1737.4, aKm: 384400,
    plane: 'ecliptic', incl: 5.14, phase: 0.8, color: '#c9c9c9', bump: 0.035 },

  { name: 'Mars', tex: 'mars', seed: 7.7, mass: 3.2271e-7, radiusKm: 3389.5, rotH: 24.623, tilt: 25.19, poleLon: 150,
    el: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    color: '#e07a4a', bump: 0.025, atmo: { color: [0.95, 0.6, 0.4], strength: 0.35, power: 3.5 } },
  { name: 'Phobos', parent: 'Mars', tex: 'darkrock', seed: 8.3, massKg: 1.066e16, radiusKm: 11.3, aKm: 9376,
    phase: 1.0, color: '#9c8f84', bump: 0.05, shape: [1, 0.82, 0.72] },
  { name: 'Deimos', parent: 'Mars', tex: 'darkrock', seed: 9.1, massKg: 1.48e15, radiusKm: 6.2, aKm: 23463,
    phase: 4.0, color: '#a89d92', bump: 0.04, shape: [1, 0.8, 0.7] },

  { name: 'Jupiter', tex: 'jupiter', seed: 11.5, mass: 9.5458e-4, radiusKm: 69911, rotH: 9.925, tilt: 3.13, poleLon: 200,
    el: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    color: '#e0b98a', oblate: 0.935 },
  { name: 'Io', parent: 'Jupiter', tex: 'io', seed: 12.2, massKg: 8.93e22, radiusKm: 1821.6, aKm: 421700,
    phase: 0.3, color: '#e8d560', bump: 0.012 },
  { name: 'Europa', parent: 'Jupiter', tex: 'europa', seed: 13.8, massKg: 4.8e22, radiusKm: 1560.8, aKm: 671100,
    phase: 2.1, color: '#d9cfbb', bump: 0.006 },
  { name: 'Ganymede', parent: 'Jupiter', tex: 'ganymede', seed: 14.4, massKg: 1.482e23, radiusKm: 2634.1, aKm: 1070400,
    phase: 3.9, color: '#a79c90', bump: 0.02 },
  { name: 'Callisto', parent: 'Jupiter', tex: 'callisto', seed: 15.6, massKg: 1.076e23, radiusKm: 2410.3, aKm: 1882700,
    phase: 5.2, color: '#8a7a6c', bump: 0.025 },

  { name: 'Saturn', tex: 'saturn', seed: 17.9, mass: 2.8581e-4, radiusKm: 58232, rotH: 10.656, tilt: 26.73, poleLon: 80,
    el: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    color: '#e6cf9c', oblate: 0.9, ring: { inner: 1.28, outer: 2.35, style: 0 } },
  { name: 'Enceladus', parent: 'Saturn', tex: 'icy', seed: 18.5, massKg: 1.08e20, radiusKm: 252.1, aKm: 238040,
    phase: 1.7, color: '#eef4fa', bump: 0.012 },
  { name: 'Rhea', parent: 'Saturn', tex: 'grayrock', tint: [0.72, 0.71, 0.69], seed: 19.3, massKg: 2.307e21,
    radiusKm: 763.8, aKm: 527108, phase: 4.4, color: '#c8c6c1', bump: 0.03 },
  { name: 'Titan', parent: 'Saturn', tex: 'titan', seed: 20.9, massKg: 1.3452e23, radiusKm: 2574.7, aKm: 1221870,
    phase: 0.2, color: '#e3a045', atmo: { color: [1.0, 0.62, 0.2], strength: 0.9, power: 2.2 } },

  { name: 'Uranus', tex: 'uranus', seed: 22.1, mass: 4.3662e-5, radiusKm: 25362, rotH: 17.24, tilt: 97.77, poleLon: 260,
    el: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503],
    color: '#9fe3e6', oblate: 0.977, ring: { inner: 1.95, outer: 2.03, style: 1 },
    atmo: { color: [0.6, 0.95, 1.0], strength: 0.45, power: 3.0 } },
  { name: 'Titania', parent: 'Uranus', tex: 'grayrock', tint: [0.6, 0.57, 0.54], seed: 23.7, massKg: 3.4e21,
    radiusKm: 788.9, aKm: 435910, phase: 2.6, color: '#b3aaa0', bump: 0.03 },
  { name: 'Oberon', parent: 'Uranus', tex: 'grayrock', tint: [0.52, 0.47, 0.45], seed: 24.9, massKg: 3.08e21,
    radiusKm: 761.4, aKm: 583520, phase: 5.5, color: '#a3968f', bump: 0.035 },

  { name: 'Neptune', tex: 'neptune', seed: 26.3, mass: 5.1514e-5, radiusKm: 24622, rotH: 16.11, tilt: 28.32, poleLon: 320,
    el: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
    color: '#5b82f0', oblate: 0.983, atmo: { color: [0.35, 0.5, 1.0], strength: 0.6, power: 3.0 } },
  { name: 'Triton', parent: 'Neptune', tex: 'triton', seed: 27.5, massKg: 2.14e22, radiusKm: 1353.4, aKm: 354760,
    retrograde: true, phase: 3.3, color: '#d6c4bd', bump: 0.012 },
];
