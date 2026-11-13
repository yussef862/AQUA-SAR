"""
Pre-load tiles for the demo so the first slider drag is instant.
Usage:  python warm.py https://your-api.example.com
"""
import math
import sys
import httpx

API = sys.argv[1].rstrip("/")
# Burullus rough bbox (lon_min, lat_min, lon_max, lat_max): adjust to your ROI
BBOX = (30.55, 31.35, 31.15, 31.62)
ZOOMS = range(9, 13)
LAYERS = [f"s1_{y}" for y in range(2019, 2027)] + ["nisar_2026"]


def deg2tile(lon, lat, z):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


with httpx.Client(timeout=60) as c:
    for layer in LAYERS:
        ok = bad = 0
        for z in ZOOMS:
            x0, y1 = deg2tile(BBOX[0], BBOX[1], z)
            x1, y0 = deg2tile(BBOX[2], BBOX[3], z)
            for x in range(x0, x1 + 1):
                for y in range(y0, y1 + 1):
                    r = c.get(f"{API}/tiles/{layer}/{z}/{x}/{y}.png")
                    if r.status_code == 200 and "x-tile-error" not in r.headers:
                        ok += 1
                    else:
                        bad += 1
        print(f"{layer}: ok={ok} bad={bad}")
