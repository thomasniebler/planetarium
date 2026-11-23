# Planetarium

Interactive gravity simulations in the browser (three.js), in three scenes you can switch between at the top left:

- **Solar system** (`index.html`): an N-body simulation of the Sun, planets and moons.
- **Milky Way** (`galaxy.html`): ~100k stars orbiting in a barred spiral galaxy.
- **Local Group** (`localgroup.html`): the Milky Way, Andromeda, Triangulum and the Magellanic Clouds over billions of years, including the Milky Way–Andromeda collision.

## Solar system

- Real gravity between the Sun, 8 planets and 12 moons, starting from today's planet positions
- Tweak the physics live: Sun gravity, gravitational constant, mass of any body, time speed and direction
- Fly to any body, zoom from the whole system down to a single moon
- Planet textures are generated procedurally on startup (no image assets)
- Works without a GPU: detects CPU rendering and lowers texture size and resolution automatically

```sh
npm install
npm run dev
```

URL options: `?focus=Saturn`, `?tex=0.5` (texture scale), `?quality=low|high`, `?speed=1` (log10 days/s), `?paused`.

Sizes are magnified by default ("Body size ×"); set it to 1 for true scale.

## Milky Way

- Stars are test particles moving in a fixed gravitational potential: a bulge, a thin and a thick disk, and a dark-matter halo
  (loosely after McMillan 2017), plus a rotating bar (40 km/s/kpc) and a rotating two-armed spiral pattern (20 km/s/kpc).
  The stars don't attract each other, which is what makes ~100k of them affordable on a CPU.
- The spiral arms are a density wave. Young blue stars, glowing hydrogen (HII) clouds and dust are born on the arms. They then
  drift off as they orbit, fade and are reborn on an arm. Old stars only respond weakly to the arms.
- The Sun is integrated alongside, starting from its real position and velocity, so you can follow its ~240-million-year orbit.
- Tweak dark matter, bar and spiral strength and pattern speeds live. The rotation curve shows how much of the orbital speed comes from
  stars and how much from dark matter. Set dark matter to 0 and watch the outer disk fly apart.
- The simulation runs in Web Workers (one per core, up to 6). It settles for 250 Myr before "today" so the bar and arms are already in place.

URL options: `?speed=1` (log10 Myr/s), `?focus=sun`, `?view=top|edge`, `?n=0.5` (particle count scale), `?quality=low|high`, `?paused`.

## Local Group

- Each galaxy is a rigid, spherical mass distribution (bulge + disk + dark halo). The galaxy centres attract each other, and
  Chandrasekhar dynamical friction makes them lose orbital energy, so they can merge. Stars are test particles feeling every galaxy
  ("restricted N-body", as in Toomre & Toomre 1972). Tidal tails, bridges and the final elliptical remnant all emerge from that.
- Starting positions and velocities come from van der Marel et al. 2012 (M31, M33) and Kallivayalil et al. 2013 (Magellanic Clouds).
  Disk orientations are derived from each galaxy's inclination and position angle on the sky.
- With the default values, the Large Magellanic Cloud is swallowed after ~3.8 Gyr. The Milky Way and Andromeda first pass each
  other after ~4.7 Gyr and merge after ~5.8 Gyr (published estimates: first passage ~3.9–4.5 Gyr, merger ~6 Gyr).
- Andromeda's sideways (tangential) velocity is poorly known (17 km/s in 2012, ~57 km/s with Gaia). Change it under "Starting
  conditions" to see whether the collision still happens.
- Caveats: the halos stay rigid (in reality they are deformed and stripped), the dynamical-friction rate is capped once two centres
  have sunk together, and the disk orientations of M33 and the LMC are approximate.

URL options: `?speed=2` (log10 Myr/s), `?t=4500` (jump ahead, Myr), `?focus=Milky Way`, `?vt=57` (Andromeda's sideways speed), `?dist=400`, `?n=0.5`, `?paused`.

See [IDEAS.md](IDEAS.md) for what might come next.
