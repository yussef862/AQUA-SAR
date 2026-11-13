
"""
AQUA SAR - Earth Engine Tile Manager

The frontend requests stable backend URLs:
    /tiles/{layer}/{z}/{x}/{y}.png

This module creates and refreshes Earth Engine tile URL templates.
It also logs initialization and asset-access failures without exposing
service account credentials or private keys.
"""

import asyncio
import json
import os
import time
from pathlib import Path

import ee
import google.auth


ASSET_PREFIX = os.getenv(
    "ASSET_PREFIX",
    "projects/aqua-sar/assets",
)

# Class IDs:
# 0 = water
# 1 = vegetation
# 2 = land
# 3 = fish farms
#
# Water and fish farms share one color because the project reports
# merged water area.

CLASS_PALETTE = [
    "1f78b4",
    "33a02c",
    "d9b26f",
    "1f78b4",
]

VIS = {
    "min": 0,
    "max": 3,
    "palette": CLASS_PALETTE,
}


# ---------------------------------------------------------
# Layer configuration
# ---------------------------------------------------------

LAYERS: dict[str, dict] = {}

for year in range(2019, 2027):
    LAYERS[f"s1_{year}"] = {
        "asset": f"{ASSET_PREFIX}/burullus_s1_{year}",
        "label": f"Sentinel-1 · {year}",
        "year": year,
        "sensor": "Sentinel-1",
    }

LAYERS["nisar_2026"] = {
    "asset": f"{ASSET_PREFIX}/burullus_nisar_2026",
    "label": "NISAR · 2026",
    "year": 2026,
    "sensor": "NISAR",
}


# ---------------------------------------------------------
# Earth Engine initialization
# ---------------------------------------------------------

def init_ee() -> None:
    """
    Initialize Google Earth Engine.

    Authentication priority:
    1. GEE_SA_KEY_JSON environment variable.
    2. GEE_SA_KEY_FILE local file.
    3. Google Application Default Credentials.

    Never log the service account JSON or private key.
    """

    project = os.getenv("EE_PROJECT", "").strip()

    if not project:
        raise RuntimeError(
            "EE_PROJECT environment variable is missing"
        )

    key_json = os.getenv(
        "GEE_SA_KEY_JSON",
        "",
    ).strip()

    key_file = os.getenv(
        "GEE_SA_KEY_FILE",
        "",
    ).strip()

    try:
        if key_json:
            print(
                "[ee:auth] Using GEE_SA_KEY_JSON",
                flush=True,
            )

            try:
                info = json.loads(key_json)
            except json.JSONDecodeError as exc:
                raise RuntimeError(
                    "GEE_SA_KEY_JSON is not valid JSON"
                ) from exc

            if not info.get("client_email"):
                raise RuntimeError(
                    "Service account JSON is missing client_email"
                )

            if not info.get("private_key"):
                raise RuntimeError(
                    "Service account JSON is missing private_key"
                )

            credentials = ee.ServiceAccountCredentials(
                info["client_email"],
                key_data=json.dumps(info),
            )

        elif key_file and Path(key_file).is_file():
            print(
                "[ee:auth] Using GEE_SA_KEY_FILE",
                flush=True,
            )

            try:
                with open(key_file, "r", encoding="utf-8") as file:
                    info = json.load(file)
            except Exception as exc:
                raise RuntimeError(
                    "Could not read the service account key file"
                ) from exc

            if not info.get("client_email"):
                raise RuntimeError(
                    "Service account JSON file is missing client_email"
                )

            if not info.get("private_key"):
                raise RuntimeError(
                    "Service account JSON file is missing private_key"
                )

            credentials = ee.ServiceAccountCredentials(
                info["client_email"],
                key_data=json.dumps(info),
            )

        else:
            print(
                "[ee:auth] No service account key configured; "
                "trying Application Default Credentials",
                flush=True,
            )

            credentials, detected_project = google.auth.default(
                scopes=[
                    "https://www.googleapis.com/auth/earthengine",
                    "https://www.googleapis.com/auth/cloud-platform",
                ]
            )

            print(
                f"[ee:auth] ADC credentials obtained; "
                f"detected_project={detected_project or 'not detected'}",
                flush=True,
            )

        print(
            f"[ee:init] Initializing Earth Engine for project={project}",
            flush=True,
        )

        ee.Initialize(
            credentials=credentials,
            project=project,
        )

        print(
            "[ee:init] ee.Initialize completed",
            flush=True,
        )

    except Exception as exc:
        print(
            f"[ee:init] INITIALIZATION ERROR: "
            f"{type(exc).__name__}: {exc}",
            flush=True,
        )
        raise


# ---------------------------------------------------------
# Tile manager
# ---------------------------------------------------------

class TileManager:
    def __init__(self, ttl_seconds: int = 2700):
        self.ttl = ttl_seconds

        # Cached URL templates, one per layer.
        self.state: dict[str, dict] = {}

        # Prevent simultaneous refreshes of the same layer.
        self.locks = {
            key: asyncio.Lock()
            for key in LAYERS
        }

    @staticmethod
    def _build(layer: str) -> str:
        """
        Generate a fresh Earth Engine tile URL template.
        This function runs in a worker thread.
        """

        if layer not in LAYERS:
            raise ValueError(
                f"Unknown Earth Engine layer: {layer}"
            )

        asset_id = LAYERS[layer]["asset"]

        print(
            f"[ee:asset] Requesting map for layer={layer} "
            f"asset={asset_id}",
            flush=True,
        )

        try:
            image = ee.Image(asset_id).select(0)

            map_data = image.getMapId(VIS)

            template = map_data["tile_fetcher"].url_format

            if not template:
                raise RuntimeError(
                    "Earth Engine returned an empty tile URL template"
                )

            print(
                f"[ee:asset] Map template created successfully "
                f"for layer={layer}",
                flush=True,
            )

            return template

        except Exception as exc:
            print(
                f"[ee:asset] FAILED layer={layer} "
                f"asset={asset_id} "
                f"error={type(exc).__name__}: {exc}",
                flush=True,
            )
            raise

    async def template(
        self,
        layer: str,
        force: bool = False,
    ) -> str:
        """
        Return a cached template or generate a fresh one.

        force=True requests a refresh even if a template exists.
        """

        if layer not in LAYERS:
            raise ValueError(
                f"Unknown layer: {layer}"
            )

        state = self.state.get(layer)

        if (
            state
            and not force
            and time.time() - state["t"] < self.ttl
        ):
            print(
                f"[tiles] Using cached template for {layer}",
                flush=True,
            )
            return state["url"]

        async with self.locks[layer]:
            state = self.state.get(layer)

            # Another request may have refreshed the template
            # while this request was waiting for the lock.
            guard = 10 if force else self.ttl

            if state and time.time() - state["t"] < guard:
                print(
                    f"[tiles] Template refreshed by another request "
                    f"for {layer}",
                    flush=True,
                )
                return state["url"]

            print(
                f"[tiles] Generating template for {layer}; "
                f"force={force}",
                flush=True,
            )

            try:
                url = await asyncio.to_thread(
                    self._build,
                    layer,
                )

                self.state[layer] = {
                    "url": url,
                    "t": time.time(),
                }

                print(
                    f"[tiles] Template stored for {layer}",
                    flush=True,
                )

                return url

            except Exception as exc:
                print(
                    f"[tiles] TEMPLATE GENERATION FAILED "
                    f"layer={layer}: {type(exc).__name__}: {exc}",
                    flush=True,
                )
                raise

    async def refresh_all(self) -> None:
        """Refresh all configured layer templates."""

        for layer in LAYERS:
            try:
                await self.template(
                    layer,
                    force=True,
                )

            except Exception as exc:
                print(
                    f"[tiles] Refresh failed for {layer}: "
                    f"{type(exc).__name__}: {exc}",
                    flush=True,
                )

    async def refresh_loop(
        self,
        every_seconds: int,
    ) -> None:
        """Optional background refresh loop."""

        while True:
            await asyncio.sleep(every_seconds)
            await self.refresh_all()

    def ages(self) -> dict:
        """Return the age of each cached template in seconds."""

        now = time.time()

        return {
            layer: round(now - state["t"])
            for layer, state in self.state.items()
        }
