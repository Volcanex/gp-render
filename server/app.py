from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

app = FastAPI()

DIST_DIR = Path(__file__).resolve().parent.parent / "web" / "dist"


@app.get("/health")
def health():
    return {"ok": True, "checks": {}}


if DIST_DIR.is_dir():
    app.mount("/", StaticFiles(directory=DIST_DIR, html=True), name="spa")
