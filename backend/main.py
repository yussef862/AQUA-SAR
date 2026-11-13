
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

from tiles import LAYERS, TileManager  # noqa: E402
from tiles import init_ee  # noqa: E402
from chat import router as chat_router  # noqa: E402


BASE_DIR = Path(__file__).resolve().parent

TTL = int(os.getenv("TILE_TTL_SECONDS", "2700"))

_lake = Path(os.getenv("LAKE_JSON", "data/burullus_yearly.json"))
LAKE_JSON = _lake if _lake.is_absolute() else BASE_DIR / _lake

ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "*").split(",")
    if origin.strip()
]

# 1x1 transparent PNG. Kept as a final fallback for tile failures.
BLANK_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)

TILE_CACHE_HEADERS = {
    "Cache-Control": "public, max-age=86400, s-maxage=86400"
}

tm = TileManager(ttl_seconds=TTL)
tile_cache: LRUCache = LRUCache(maxsize=1500)

http: httpx.AsyncClient | None = None
_ready = False
_lock = asyncio.Lock()


async def ensure_ready():
    """
    Lazily initialize Earth Engine.

    In serverless environments, initialization is performed on the first
    tile request rather than relying on a startup hook.
    """
    global http, _ready

    if _ready:
        return

    async with _lock:
        if _ready:
            return

        print("[ee:init] Starting Earth Engine initialization", flush=True)
        print(
            f"[ee:init] EE_PROJECT configured: {bool(os.getenv('EE_PROJECT'))}",
            flush=True,
        )
        print(
            f"[ee:init] GEE_SA_KEY_JSON configured: {bool(os.getenv('GEE_SA_KEY_JSON', '').strip())}",
            flush=True,
        )
        print(
            f"[ee:init] GEE_SA_KEY_FILE configured: {bool(os.getenv('GEE_SA_KEY_FILE', '').strip())}",
            flush=True,
        )

        try:
            init_ee()

            print(
                "[ee:init] Earth Engine initialization call completed",
                flush=True,
            )

            http = httpx.AsyncClient(timeout=20)
            _ready = True

            print("[ee:init] Backend marked as ready", flush=True)

        except Exception as exc:
            print(
                f"[ee:init] FAILED: {type(exc).__name__}: {exc}",
                flush=True,
            )

            raise HTTPException(
                status_code=503,
                detail="Earth Engine initialization failed. Check Vercel Runtime Logs.",
            ) from exc


app = FastAPI(title="AQUA SAR API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat_router)


@app.get("/health")
async def health():
    """
    Cheap health check.

    This endpoint intentionally does not initialize Earth Engine.
    Therefore ee_ready only indicates whether this specific serverless
    instance has initialized it during a previous request.
    """
    return {
        "ok": True,
        "layers": len(LAYERS),
        "ee_ready": _ready,
        "tile_template_age_s": tm.ages(),
        "cached_tiles": len(tile_cache),
    }


@app.get("/lakes/burullus")
async def lake_burullus():
    """Return Burullus data and stable backend tile URLs."""

    if not LAKE_JSON.exists():
        raise HTTPException(
            status_code=500,
            detail="burullus_yearly.json not found on the server",
        )

    try:
        data = json.loads(LAKE_JSON.read_text(encoding="utf-8"))
    except Exception as exc:
        print(
            f"[lake] Failed to read lake JSON: {type(exc).__name__}: {exc}",
            flush=True,
        )
        raise HTTPException(
            status_code=500,
            detail="Could not read lake data",
        ) from exc

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
    """Return a map tile generated from the configured Earth Engine asset."""

    if layer not in LAYERS:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown layer: {layer}",
        )

    if min(z, x, y) < 0:
        raise HTTPException(
            status_code=400,
            detail="Tile coordinates must be non-negative",
        )

    ck = (layer, z, x, y)

    hit = tile_cache.get(ck)
    if hit is not None:
        return Response(
            hit,
            media_type="image/png",
            headers=TILE_CACHE_HEADERS,
        )

    # Initialize Earth Engine before requesting a tile URL.
    await ensure_ready()

    if http is None:
        raise HTTPException(
            status_code=503,
            detail="HTTP client is not initialized",
        )

    last_error = None

    for attempt in (0, 1):
        try:
            print(
                f"[tile] Requesting template layer={layer} "
                f"attempt={attempt + 1}",
                flush=True,
            )

            template = await tm.template(
                layer,
                force=(attempt == 1),
            )

            url = (
                template
                .replace("{z}", str(z))
                .replace("{x}", str(x))
                .replace("{y}", str(y))
            )

            response = await http.get(url)

            if response.status_code == 200 and response.content:
                tile_cache[ck] = response.content

                print(
                    f"[tile] SUCCESS layer={layer} "
                    f"coordinates={z}/{x}/{y}",
                    flush=True,
                )

                return Response(
                    response.content,
                    media_type="image/png",
                    headers=TILE_CACHE_HEADERS,
                )

            last_error = (
                f"Earth Engine tile server returned HTTP "
                f"{response.status_code}"
            )

            print(
                f"[tile] UPSTREAM ERROR layer={layer} "
                f"status={response.status_code} "
                f"attempt={attempt + 1}",
                flush=True,
            )

        except Exception as exc:
            last_error = f"{type(exc).__name__}: {exc}"

            print(
                f"[tile] FAILED layer={layer} "
                f"coordinates={z}/{x}/{y} "
                f"attempt={attempt + 1} "
                f"error={last_error}",
                flush=True,
            )

    print(
        f"[tile] FINAL FAILURE layer={layer}: {last_error}",
        flush=True,
    )

    # Temporary diagnostic behavior:
    # Return an HTTP error instead of silently returning a white tile.
    raise HTTPException(
        status_code=502,
        detail=(
            f"Tile generation failed for {layer}. "
            "Check Vercel Runtime Logs."
        ),
    )


@app.on_event("shutdown")
async def shutdown_event():
    """Close the HTTP client when the application shuts down."""
    global http

    if http is not None:
        await http.aclose()
        http = None
