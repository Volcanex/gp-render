# render

**Owner:** Gabriel Penman

Generic browser rendering playground (formerly `titan`). Blue-noise/Bayer
dither, palettes, ISO grain, dither pinning, aperture/DOF, raymarched SDF
scene. Vite+React Three.js frontend served by a tiny FastAPI app.

Non-obvious architecture: in rgb332 colour mode the shader quantises into
256 index slots which display through an editable CLUT texture
(`web/src/palette/`) — hardware-palette style, identity by default, edited
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
  working tree — commit before restarting, uncommitted edits go live.
- nginx vhost `deploy/render.nginx` for render.gabrielpenman.com, port
  8094, no auth. Certbot adds TLS + the :80 redirect on top of this file.

The former Titan-game environment (poles + volumetric haze) is now just
one of the scenes, selectable as `render` in the scene dropdown
(`web/src/scene/RenderScene.jsx`, exports `RENDER_LAMPS`).

## Gotcha
Server serves `web/dist/`, not `web/src/`. Rebuild (`npm run build`)
after frontend edits or the deployed site won't change.
