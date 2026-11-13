"""
Earth Engine tile manager.

GEE tile URLs (getMapId) expire after a few hours. The frontend never sees them:
it always asks THIS backend for /tiles/<layer>/<z>/<x>/<y>.png (a stable URL), and the
backend keeps a fresh GEE url template per layer, refreshing it before it expires and
once more (force) if GEE ever answers with an auth / not-found error.
"""
import asyncio
import json
import os
import time

import ee
import google.auth

ASSET_PREFIX = os.getenv("ASSET_PREFIX", "projects/aqua-sar/assets")

# class ids: 0 water, 1 vegetation, 2 land, 3 fishfarm (water and fishfarm share one color
# because the site reports merged water)
CLASS_PALETTE = ["1f78b4", "33a02c", "d9b26f", "1f78b4"]
VIS = {"min": 0, "max": 3, "palette": CLASS_PALETTE}

LAYERS: dict[str, dict] = {}
for _y in range(2019, 2027):
    LAYERS[f"s1_{_y}"] = {
        "asset": f"{ASSET_PREFIX}/burullus_s1_{_y}",
        "label": f"Sentinel-1 · {_y}",
        "year": _y,
        "sensor": "Sentinel-1",
    }
LAYERS["nisar_2026"] = {
    "asset": f"{ASSET_PREFIX}/burullus_nisar_2026",
    "label": "NISAR · 2026",
    "year": 2026,
    "sensor": "NISAR",
}


def init_ee() -> None:
    project = os.environ["EE_PROJECT"]
    key_json = os.getenv("GEE_SA_KEY_JSON", "").strip()
    key_file = os.getenv("GEE_SA_KEY_FILE", "").strip()

    if key_json or (key_file and os.path.exists(key_file)):
        info = json.loads(key_json) if key_json else json.load(open(key_file))
        creds = ee.ServiceAccountCredentials(info["client_email"], key_data=json.dumps(info))
    else:
        # Cloud Run / GCE: use the attached service account
        creds, _ = google.auth.default(
            scopes=[
                "https://www.googleapis.com/auth/earthengine",
                "https://www.googleapis.com/auth/cloud-platform",
            ]
        )
    ee.Initialize(credentials=creds, project=project)


class TileManager:
    def __init__(self, ttl_seconds: int = 2700):
        self.ttl = ttl_seconds
        self.state: dict[str, dict] = {}
        self.locks = {k: asyncio.Lock() for k in LAYERS}

    @staticmethod
    def _build(layer: str) -> str:
        img = ee.Image(LAYERS[layer]["asset"]).select(0)
        m = img.getMapId(VIS)
        return m["tile_fetcher"].url_format

    async def template(self, layer: str, force: bool = False) -> str:
        st = self.state.get(layer)
        if st and not force and time.time() - st["t"] < self.ttl:
            return st["url"]
        async with self.locks[layer]:
            st = self.state.get(layer)
            # somebody else refreshed while we waited for the lock
            guard = 10 if force else self.ttl
            if st and time.time() - st["t"] < guard:
                return st["url"]
            url = await asyncio.to_thread(self._build, layer)
            self.state[layer] = {"url": url, "t": time.time()}
            return url

    async def refresh_all(self) -> None:
        for layer in LAYERS:
            try:
                await self.template(layer, force=True)
            except Exception as e:  # keep the old url if the refresh fails
                print(f"[tiles] refresh failed for {layer}: {e}")

    async def refresh_loop(self, every_seconds: int) -> None:
        while True:
            await asyncio.sleep(every_seconds)
            await self.refresh_all()

    def ages(self) -> dict:
        now = time.time()
        return {k: round(now - v["t"]) for k, v in self.state.items()}
