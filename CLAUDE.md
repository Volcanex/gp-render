# gp-render

Repo `Volcanex/gp-render` (was `render`), checked out at `/home/gabriel/gp-render`;
`/home/gabriel/render` is a compat symlink. The systemd unit is still `render`.

**Owner:** Gabriel Penman

Generic browser rendering playground (formerly `titan`). Blue-noise/Bayer
dither, palettes, ISO grain, dither pinning, aperture/DOF, raymarched SDF
scene. Vite+React Three.js frontend served by a tiny FastAPI app.

Non-obvious architecture: in rgb332 colour mode the shader quantises into
256 index slots which display through an editable CLUT texture
(`web/src/palette/`): hardware-palette style, identity by default, edited
live via the in-page palette panel (localStorage + JSON import/export).
The raymarched scene (`web/src/scene/RaymarchScene.jsx`) writes real
window-space depth via gl_FragDepth so the DOF and outline passes work on
it unchanged.

The in-app UI (control panels) is Leva; the 3D is React Three Fiber +
drei + `postprocessing`.

## Run
```
cd web && npm install && npm run build
cd ../server && uvicorn app:app --port 8094
```

## Deploy
- systemd unit `render` (`deploy/render.service`) runs uvicorn from the
  working tree, so commit before restarting: uncommitted edits go live.
- nginx vhost `deploy/render.nginx` for render.gabrielpenman.com, port
  8094, no auth. Certbot adds TLS + the :80 redirect on top of this file.

The former Titan-game environment (poles + volumetric haze) is now just
one of the scenes, selectable as `render` in the scene dropdown
(`web/src/scene/RenderScene.jsx`, exports `RENDER_LAMPS`).

## scenes.mjs: framework-free scene export
Alongside the SPA, render publishes a dependency-free ES module,
`dist/scenes.mjs`, so external consumers (the gdesign compositor at
design.gabrielpenman.com) can dynamically `import()` its 3D scenes as
live layers without pulling in React/R3F/Leva. The contract lives in
`web/src/scenes-lib/index.js` (`contractVersion`, `scenes` array: each
`{ id, label, params, create({ canvas }) }`, `create` returning
`{ renderFrame(t, params, width, height), dispose() }`). `renderFrame`
must be deterministic in `(t, params)` and synchronous, so a caller can
copy the canvas immediately after it returns.

The raymarch scene's GLSL/sun-model/terrain-height code lives in
`web/src/scene/raymarch-core.js`, framework-free and imported by BOTH
`web/src/scene/RaymarchScene.jsx` (the interactive SPA, via R3F) and
`web/src/scenes-lib/raymarch.js` (the plain-Three.js scenes.mjs export).
Edit the shared core, not either wrapper, when changing the scene
itself.

`npm run build` runs two Vite builds in sequence: the normal SPA build,
then a library build (`vite.scenes.config.js`, entry
`scenes-lib/index.js`, `emptyOutDir: false` so it doesn't wipe the SPA
output) that emits `dist/scenes.mjs`. The FastAPI server adds permissive
CORS (`GET`, `*` origin) so `scenes.mjs` can be imported cross-origin
from design.gabrielpenman.com; everything else it serves is unauthenticated
already.

## Gotcha
Server serves `web/dist/`, not `web/src/`. Rebuild (`npm run build`)
after frontend edits or the deployed site won't change. This now
includes `dist/scenes.mjs`, not just `dist/index.html`.
