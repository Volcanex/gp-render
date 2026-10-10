# gp-render

A browser playground for rendering experiments, live at [render.gabrielpenman.com](https://render.gabrielpenman.com). It's built on Three.js and has blue-noise and Bayer dithering, palette ramps with an editable colour lookup table, camera-style grain and depth of field, and a raymarched scene. The build also exports its scenes as a standalone module, and [gp-design](https://github.com/Volcanex/gp-design) loads that module so the scenes show up there as layers.

![A test scene with the control panel open](screenshot.jpg)

## Running it

You need Node 22 and Python 3.11 or newer.

```sh
cd web && npm install && npm run build
cd ../server && pip install fastapi uvicorn && uvicorn app:app --port 8094
```

For live reloading while you work on the frontend, run `npm run dev` in `web/` instead.

## Licence

Copyright (C) 2026 Gabriel Penman. Licensed under the [GNU Affero General Public License v3.0 only](LICENSE). You can read it, run it, change it and share it for any purpose. If you share a changed copy, or run one as a network service, you must offer its source under the same licence.

Required Notice: Copyright Gabriel Penman (https://gabrielpenman.com)

Blue-noise texture (`web/public/textures/bluenoise128.png`): Christoph Peters, CC0, momentsingraphics.de/BlueNoise.html
