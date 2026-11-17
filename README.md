# Planetarium

An interactive N-body simulation of the solar system in the browser (three.js).

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

Sizes are magnified by default ("Body size ×"); set it to 1 for true scale. See [IDEAS.md](IDEAS.md) for what might come next.
