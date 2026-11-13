import asyncio
import base64
import json
import os
from pathlib import Path

import httpx
from cachetools import LRUCache
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

from tiles import LAYERS, TileManager, init_ee  # noqa: E402
from chat import router as chat_router  # noqa: E402  (after load_dotenv)

load_dotenv()

from tiles import LAYERS, TileManager, init_ee  # noqa: E402  (after load_dotenv)

BASE_DIR = Path(__file__).resolve().parent
TTL = int(os.getenv("TILE_TTL_SECONDS", "2700"))
_lake = Path(os.getenv("LAKE_JSON", "data/burullus_yearly.json"))
LAKE_JSON = _lake if _lake.is_absolute() else BASE_DIR / _lake
ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]

# 1x1 transparent PNG, returned instead of an error so the map never shows broken tiles
BLANK_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)

# s-maxage lets the Vercel CDN cache tiles, so most requests never reach the function
TILE_CACHE_HEADERS = {"Cache-Control": "public, max-age=86400, s-maxage=86400"}

tm = TileManager(ttl_seconds=TTL)
tile_cache: LRUCache = LRUCache(maxsize=1500)
http: httpx.AsyncClient | None = None
_ready = False
_lock = asyncio.Lock()


async def ensure_ready():
    """Lazy init: serverless has no reliable startup hook or background tasks."""
    global http, _ready
    if _ready:
        return
    async with _lock:
        if _ready:
            return
        init_ee()
        http = httpx.AsyncClient(timeout=20)
        _ready = True


app = FastAPI(title="AQUA SAR API")
app.add_middleware(
    CORSMiddleware, allow_origins=ORIGINS, allow_methods=["*"], allow_headers=["*"]
)
app.include_router(chat_router)


@app.get("/health")
async def health():
    # No EE call here on purpose: keeps /health instant and works as a cheap ping
    return {"ok": True, "layers": len(LAYERS), "ee_ready": _ready,
            "tile_template_age_s": tm.ages(), "cached_tiles": len(tile_cache)}


@app.get("/lakes/burullus")
async def lake_burullus():
    """Same shape as data/burullus_yearly.json, plus a stable tile URL per layer."""
    if not LAKE_JSON.exists():
        raise HTTPException(500, "burullus_yearly.json not found on the server")
    data = json.loads(LAKE_JSON.read_text(encoding="utf-8"))
    data["tiles"] = {
        key: {
            "url": f"/tiles/{key}/{{z}}/{{x}}/{{y}}.png",
            "label": meta["label"],
            "sensor": meta["sensor"],
            "year": meta["year"],
        }
        for key, meta in LAYERS.items()
    }
    return data


@app.get("/tiles/{layer}/{z}/{x}/{y}.png")
async def tile(layer: str, z: int, x: int, y: int):
    if layer not in LAYERS:
        raise HTTPException(404, "unknown layer")

    ck = (layer, z, x, y)
    hit = tile_cache.get(ck)
    if hit is not None:
        return Response(hit, media_type="image/png", headers=TILE_CACHE_HEADERS)

    await ensure_ready()

    for attempt in (0, 1):
        try:
            tpl = await tm.template(layer, force=(attempt == 1))
            url = tpl.replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y))
            r = await http.get(url)
        except Exception as e:
            print(f"[tile] {layer} {z}/{x}/{y} error: {e}")
            continue
        if r.status_code == 200 and r.content:
            tile_cache[ck] = r.content
            return Response(r.content, media_type="image/png", headers=TILE_CACHE_HEADERS)
        print(f"[tile] {layer} {z}/{x}/{y} upstream {r.status_code}, retry={attempt == 0}")

    return Response(BLANK_PNG, media_type="image/png",
                    headers={"Cache-Control": "no-store", "X-Tile-Error": "1"})