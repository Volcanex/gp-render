from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

app = FastAPI()

# scenes.mjs is dynamically imported cross-origin by the gdesign compositor
# (design.gabrielpenman.com): GET-only, world-readable static file.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

DIST_DIR = Path(__file__).resolve().parent.parent / "web" / "dist"


@app.get("/health")
def health():
    return {"ok": True, "checks": {}}


if DIST_DIR.is_dir():
    app.mount("/", StaticFiles(directory=DIST_DIR, html=True), name="spa")
