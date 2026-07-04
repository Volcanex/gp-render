# titan

**Owner:** Gabriel Penman

Browser explorer for Titan-game vision-system rendering: blue-noise/Bayer
dither, palettes, ISO grain, dither pinning. Vite+React Three.js frontend
served by a tiny FastAPI app.

## Run
```
cd web && npm install && npm run build
cd ../server && uvicorn app:app --port 8094
```

## Deploy
- systemd unit `titan` (`deploy/titan.service`) runs uvicorn from the
  working tree — commit before restarting, uncommitted edits go live.
- nginx vhost `deploy/titan.nginx` for titan.gabrielpenman.com, port 8094,
  no auth. Certbot adds TLS + the :80 redirect on top of this file.

## Gotcha
Server serves `web/dist/`, not `web/src/`. Rebuild (`npm run build`)
after frontend edits or the deployed site won't change.
