"""
AQUA SAR - analysis layer (v2).

Every lake number the LLM may quote comes out of run_lake_analysis().
Source of truth: data/burullus_yearly.json (the same file the website uses).

Design choices
- Open water + fish ponds are reported together as "water_surface" (the split is unstable between years).
- Small year-to-year moves (< 1.5%) are labelled "stable".
- Trend = Theil-Sen (pure Python, same maths as scipy.stats.theilslopes, so no numpy/scipy on Vercel).
- Forecast = TWO scenarios inside one range, never one "best" number:
    continued_trend = trend of the whole record, recent_pace = trend of the last RECENT_YEARS years.
- NISAR numbers live in their own block and are never mixed into yearly series, changes or trends.
- No cause is ever stated here: the tool reports what changed, not why.
"""
from __future__ import annotations

import json
import math
import os
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
_env = Path(os.getenv("LAKE_JSON", "data/burullus_yearly.json"))
DATA_FILE = _env if _env.is_absolute() else HERE / _env
if not DATA_FILE.exists():  # fallback when the file sits next to this script
    DATA_FILE = HERE / "burullus_yearly.json"

LAKES = {"burullus": {"display": "Lake Burullus"}}
ALIASES = {
    "burullus": "burullus",
    "lake burullus": "burullus",
    "burullus lake": "burullus",
    "البرلس": "burullus",
    "بحيرة البرلس": "burullus",
}

METRICS = ["water_surface", "vegetation", "land"]
STABLE_PCT = 1.5          # |change| below this many percent is called "stable"
MAX_HORIZON = 2032
RECENT_YEARS = 4          # window of the "recent pace" scenario (2023-2026)
PACE_BREAK_YEAR = 2023    # most of the loss happened 2019-2023, roughly flat after

# Facts that are not in the JSON yet (final numbers from the Burullus closing chat)
S2_GREEN_CORE = {
    "source": "Sentinel-2 optical images (NDVI above 0.3, June-October median)",
    "area": "the lake core (about 226 km2, fixed area)",
    "years": [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026],
    "green_km2": [1.8, 2.2, 2.5, 7.2, 11.2, 12.0, 21.2, 16.5],
    "reading": (
        "Green vegetation over the lake core grew roughly nine-fold from 2019 to 2026. "
        "The number of images jumps in 2025-2026, so 2025 to 2026 is not read as a reversal."
    ),
    "use": "Optical reference. Never put it in the same table as, or subtract it from, the radar numbers.",
}


# ---------------------------------------------------------------- maths
def _r1(x):
    return None if x is None else round(float(x), 1)


def _median(v):
    v = sorted(v)
    n = len(v)
    if n == 0:
        return float("nan")
    return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2


def _theil_sen(x, y) -> dict:
    n = len(x)
    slopes = sorted(
        (y[j] - y[i]) / (x[j] - x[i]) for i in range(n) for j in range(i + 1, n) if x[j] > x[i]
    )
    med = _median(slopes)
    inter = _median(y) - med * _median(x)
    z = 1.959963984540054
    nt = len(slopes)
    reps = lambda a: [k for k in Counter(a).values() if k > 1]  # noqa: E731
    sigsq = (
        n * (n - 1) * (2 * n + 5)
        - sum(k * (k - 1) * (2 * k + 5) for k in reps(x))
        - sum(k * (k - 1) * (2 * k + 5) for k in reps(y))
    ) / 18.0
    sigma = math.sqrt(max(sigsq, 0.0))
    ru = min(int(round((nt + z * sigma) / 2.0)), nt - 1)
    rl = max(int(round((nt - z * sigma) / 2.0)) - 1, 0)
    lo, hi = slopes[rl], slopes[ru]
    fitted = [inter + med * xi for xi in x]
    res = [yi - fi for yi, fi in zip(y, fitted)]
    mean = sum(res) / len(res)
    resid = math.sqrt(sum((r - mean) ** 2 for r in res) / max(len(res) - 1, 1))
    return {"slope": med, "intercept": inter, "lo": min(lo, hi), "hi": max(lo, hi), "resid": resid}


def _label(pct):
    if pct is None or abs(pct) < STABLE_PCT:
        return "stable"
    return "increase" if pct > 0 else "decrease"


def _change(a: float, b: float) -> dict:
    d = b - a
    pct = (d / a * 100) if a else None
    return {"start": _r1(a), "end": _r1(b), "change_km2": _r1(d), "change_pct": _r1(pct), "label": _label(pct)}


# ---------------------------------------------------------------- data
_cache: dict = {}


def _raw() -> dict:
    mtime = DATA_FILE.stat().st_mtime
    if _cache.get("mtime") != mtime:
        _cache["data"] = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        _cache["mtime"] = mtime
    return _cache["data"]


def _rows(d: dict) -> dict:
    return {
        int(y["year"]): {
            "water_surface": float(y["water_km2"]),
            "vegetation": float(y["vegetation_km2"]),
            "land": float(y["land_km2"]),
        }
        for y in d["years"]
    }


def _core_rows(d: dict) -> dict:
    return {
        int(y["year"]): {
            "open_water": float(y["water_km2"]),
            "vegetation": float(y["vegetation_km2"]),
            "land": float(y["land_km2"]),
        }
        for y in d["core_open_water"]["years"]
    }


def _fit_series(years, values):
    return _theil_sen([float(y) for y in years], [float(v) for v in values])


def _trend_block(years, series: dict) -> dict | None:
    if len(years) < 4:
        return None
    out = {}
    for m, vals in series.items():
        f = _fit_series(years, vals)
        out[m] = {
            "slope_km2_per_year": round(f["slope"], 2),
            "slope_range_km2_per_year": [round(f["lo"], 2), round(f["hi"], 2)],
            "trend_is_clear": (f["lo"] > 0) or (f["hi"] < 0),
        }
    return out


# ---------------------------------------------------------------- forecast
def _project(fit: dict, last_year: int, target: int, margin: float):
    anchor = fit["intercept"] + fit["slope"] * last_year
    dt = target - last_year
    return anchor + fit["slope"] * dt, anchor + fit["lo"] * dt - margin, anchor + fit["hi"] * dt + margin


def _backtest(rows: dict, holdout: int = 2, window: int | None = None) -> dict:
    years = sorted(rows)
    train, test = years[:-holdout], years[-holdout:]
    if window:
        train = train[-window:]
    out = {}
    for m in METRICS:
        fit = _fit_series(train, [rows[y][m] for y in train])
        errs, inside = [], []
        for y in test:
            mid, low, high = _project(fit, train[-1], y, fit["resid"])
            errs.append(abs(rows[y][m] - mid))
            inside.append(low <= rows[y][m] <= high)
        out[m] = {
            "trained_on_years": [train[0], train[-1]],
            "tested_on_years": test,
            "mean_abs_error_km2": _r1(sum(errs) / len(errs)),
            "actual_inside_projected_range": bool(all(inside)),
        }
    return out


def _forecast(rows: dict, horizon: int) -> dict:
    years = sorted(rows)
    last = years[-1]
    rec = years[-RECENT_YEARS:]
    bt_all, bt_rec = _backtest(rows), _backtest(rows, window=RECENT_YEARS)
    out = {}
    for m in METRICS:
        fa = _fit_series(years, [rows[y][m] for y in years])
        fr = _fit_series(rec, [rows[y][m] for y in rec])
        ma = max(fa["resid"], bt_all[m]["mean_abs_error_km2"] or 0.0)
        mr = max(fr["resid"], bt_rec[m]["mean_abs_error_km2"] or 0.0)
        pts = []
        for t in range(last + 1, horizon + 1):
            a_mid, a_lo, a_hi = _project(fa, last, t, ma)
            r_mid, r_lo, r_hi = _project(fr, last, t, mr)
            pts.append({
                "year": t,
                "continued_trend_km2": _r1(a_mid),
                "recent_pace_km2": _r1(r_mid),
                "range_low_km2": _r1(min(a_lo, r_lo)),
                "range_high_km2": _r1(max(a_hi, r_hi)),
            })
        out[m] = {
            "continued_trend": {
                "years_used": [years[0], last],
                "slope_km2_per_year": round(fa["slope"], 2),
                "slope_range_km2_per_year": [round(fa["lo"], 2), round(fa["hi"], 2)],
                "trend_is_clear": (fa["lo"] > 0) or (fa["hi"] < 0),
            },
            "recent_pace": {
                "years_used": [rec[0], last],
                "slope_km2_per_year": round(fr["slope"], 2),
                "slope_range_km2_per_year": [round(fr["lo"], 2), round(fr["hi"], 2)],
                "trend_is_clear": (fr["lo"] > 0) or (fr["hi"] < 0),
            },
            "points": pts,
        }
    return out


# ---------------------------------------------------------------- story blocks
def _pace(rows: dict, years: list) -> dict | None:
    if len(years) < 4:
        return None
    if years[0] < PACE_BREAK_YEAR < years[-1]:
        brk = PACE_BREAK_YEAR
    elif len(years) >= 5:
        brk = years[(len(years) - 1) // 2]
    else:
        return None
    first = {"from": years[0], "to": brk}
    second = {"from": brk, "to": years[-1]}
    for m in METRICS:
        first[m] = _change(rows[years[0]][m], rows[brk][m])
        second[m] = _change(rows[brk][m], rows[years[-1]][m])
    return {"first_part": first, "second_part": second}


def _same_period(ch: dict) -> dict:
    """What happened to the three measures in the same period. No 'where it went' claim."""
    return {
        "water_surface_change_km2": ch["water_surface"]["change_km2"],
        "vegetation_change_km2": ch["vegetation"]["change_km2"],
        "land_change_km2": ch["land"]["change_km2"],
        "how_to_say_it": (
            "Say what each measure did in the same period (for example: water surface fell while "
            "vegetation grew). Never say water turned into vegetation or land for the whole study area."
        ),
    }


def _core_block(d: dict, start: int, end: int) -> dict:
    core = d["core_open_water"]
    rows = _core_rows(d)
    area = float(core["core_area_km2"])
    ys = [y for y in sorted(rows) if start <= y <= end]
    out = {
        "what_it_is": (
            "The lake core: a fixed area of about 226 km2 that Landsat-based JRC maps show as permanent "
            "water in 2019-2021. Because the area is fixed, changes inside it are real changes of the surface."
        ),
        "core_area_km2": _r1(area),
        "yearly": [
            {
                "year": y,
                "open_water_km2": _r1(rows[y]["open_water"]),
                "open_water_pct_of_core": _r1(rows[y]["open_water"] / area * 100),
                "now_mapped_as_vegetation_km2": _r1(rows[y]["vegetation"]),
                "now_mapped_as_land_km2": _r1(rows[y]["land"]),
                "not_open_water_km2": _r1(area - rows[y]["open_water"]),
            }
            for y in ys
        ],
        "caveats": core["caveats"],
    }
    if len(ys) >= 2:
        a, b = rows[ys[0]], rows[ys[-1]]
        out["change_start_to_end"] = {
            "open_water": _change(a["open_water"], b["open_water"]),
            "vegetation_change_km2": _r1(b["vegetation"] - a["vegetation"]),
            "land_change_km2": _r1(b["land"] - a["land"]),
        }
        out["trend_in_period"] = _trend_block(ys, {"open_water": [rows[y]["open_water"] for y in ys]})
        if (start, end) == (2019, 2026):
            out["share_of_total_water_loss_pct"] = core["share_of_total_water_loss_pct"]
            out["water_outside_core_km2"] = {
                "2019": core["water_outside_core_km2"]["sentinel1"][0],
                "2026": core["water_outside_core_km2"]["sentinel1"][-1],
                "note": "fell until 2023 and rose a little after; the cause was not tested",
            }
    return out


def _nisar_block(d: dict) -> dict:
    n = d["nisar_2026"]
    c = d["core_open_water"]["nisar_2026"]
    return {
        "what_it_is": (
            "NISAR is the NASA-ISRO radar satellite (L-band). Its images since June 2026 are the featured "
            "recent layer. These are 2026 numbers from a different sensor: shown beside Sentinel-1, never "
            "subtracted from it and never used for a trend."
        ),
        "status": "provisional data, one season (June-October 2026), 5-scene composite",
        "whole_area_2026": {
            "water_surface_km2": n["water_km2"], "vegetation_km2": n["vegetation_km2"], "land_km2": n["land_km2"],
        },
        "lake_core_2026": {
            "open_water_km2": c["water_km2"], "open_water_pct_of_core": c["water_pct_of_core"],
        },
        "sentinel1_2026_side_by_side": {
            "water_surface_km2": _r1(_rows(d)[2026]["water_surface"]),
            "lake_core_open_water_km2": _r1(_core_rows(d)[2026]["open_water"]),
        },
        "agreement": d["sensor_comparison_2026"]["rows"][1].get("agreement"),
        "reading": d["sensor_comparison_2026"]["reading"],
        "bright_surface_check": d.get("nisar_core_bright_2026"),
        "optical_reference_sentinel2": S2_GREEN_CORE,
        "accuracy_text": d["about_the_data"]["nisar"],
    }


def _headline(display: str, start: int, end: int, rows: dict, ch: dict | None) -> str:
    if ch is None:
        s = rows[start]
        return (
            f"In {start}, the water surface of {display} (open water plus fish ponds) covered "
            f"{s['water_surface']:.1f} km2, vegetation {s['vegetation']:.1f} km2 and dry land "
            f"{s['land']:.1f} km2 inside the study area."
        )
    w = ch["water_surface"]
    return (
        f"Between {start} and {end}, the water surface of {display} (open water plus fish ponds) went from "
        f"{w['start']:.1f} to {w['end']:.1f} km2 ({w['change_km2']:+.1f} km2, {w['change_pct']:+.1f}%). "
        f"In the same period vegetation changed by {ch['vegetation']['change_km2']:+.1f} km2 "
        f"and dry land by {ch['land']['change_km2']:+.1f} km2."
    )


def _about(d: dict) -> dict:
    a = d["about_the_data"]
    return {
        "sensor": "Sentinel-1 C-band radar (ESA Copernicus), processed on Google Earth Engine",
        "images": "one summer (Jun-Sep) and one winter (Dec-Mar) composite per year, 2019-2026, same area every year",
        "method": a["sentinel1"],
        "agreement_with_independent_dataset": a["jrc_agreement"],
        "scene_note": a["scene_note"],
        "study_area_km2": a["study_area_km2"],
        "reported_classes": {
            "water_surface": "open water plus fish ponds",
            "vegetation": "lake and marsh vegetation (radar sees dense vegetation only, so treat it as a minimum)",
            "land": "dry land (farmland, sand, built-up)",
        },
        "not_measured_by_radar": "salinity, soil quality and fish catch; these come from published research",
    }


# ---------------------------------------------------------------- main entry
def run_lake_analysis(
    lake_name: str,
    start_year: int,
    end_year: int,
    forecast_to_year: int | None = None,
    include_core: bool = False,
    include_nisar: bool = False,
) -> dict:
    key = ALIASES.get(str(lake_name).strip().lower())
    if key is None:
        return {"status": "coming_soon", "requested_lake": lake_name,
                "available_lakes": [v["display"] for v in LAKES.values()]}

    d = _raw()
    rows = _rows(d)
    display = LAKES[key]["display"]
    available = sorted(rows)

    try:
        start, end = int(start_year), int(end_year)
    except (TypeError, ValueError):
        return {"status": "bad_years", "available_years": available}
    if start > end:
        start, end = end, start
    if start not in rows or end not in rows:
        return {"status": "year_not_available", "available_years": available}

    years = [y for y in available if start <= y <= end]
    result = {
        "status": "ok",
        "lake": display,
        "years_available": [available[0], available[-1]],
        "period": [start, end],
        "data_source_for_yearly_numbers": "Sentinel-1",
        "yearly": [
            {"year": y, "water_surface_km2": _r1(rows[y]["water_surface"]),
             "vegetation_km2": _r1(rows[y]["vegetation"]), "land_km2": _r1(rows[y]["land"])}
            for y in years
        ],
        "about_the_data": _about(d),
    }

    json_pct = {int(y["year"]): y.get("water_change_vs_2019_pct") for y in d["years"]}
    pct_vs_start = {}
    for y in years:
        if start == available[0] and json_pct.get(y) is not None:
            pct_vs_start[y] = json_pct[y]          # same rounding as the website
        else:
            pct_vs_start[y] = _r1((rows[y]["water_surface"] - rows[start]["water_surface"]) / rows[start]["water_surface"] * 100)
    result["water_change_pct_vs_start_year"] = pct_vs_start

    ch = None
    if start != end:
        ch = {m: _change(rows[start][m], rows[end][m]) for m in METRICS}
        ch["water_surface"]["change_pct"] = pct_vs_start[end]
        ch["water_surface"]["label"] = _label(pct_vs_start[end])
        result["change_start_to_end"] = ch
        result["same_period_changes"] = _same_period(ch)
        result["year_over_year"] = [
            {"from": a, "to": b, **{m: _change(rows[a][m], rows[b][m]) for m in METRICS}}
            for a, b in zip(years[:-1], years[1:])
        ]
        trend = _trend_block(years, {m: [rows[y][m] for y in years] for m in METRICS})
        if trend:
            result["trend_in_period"] = trend
        pace = _pace(rows, years)
        if pace:
            result["pace_over_time"] = pace
    result["headline"] = _headline(display, start, end, rows, ch)

    if include_core:
        result["lake_core"] = _core_block(d, start, end)
    if include_nisar:
        result["nisar_2026"] = _nisar_block(d)

    if forecast_to_year is not None:
        last = available[-1]
        horizon = max(last + 1, min(int(forecast_to_year), MAX_HORIZON))
        bt_all = _backtest(rows)
        recent_from = available[-RECENT_YEARS]
        result["forecast"] = {
            "kind": "trend projection with a range, not a precise prediction",
            "based_on_years": [available[0], last],
            "how_to_say_it": (
                "Give the two scenarios as yearly rates (km2 per year), say the recent years look roughly flat, "
                "and that the range is wide. For a given future year quote only the range (range_low to range_high), "
                "never a single number."
            ),
            "scenarios": {
                "continued_trend": f"the trend of the whole record {available[0]}-{last} keeps going",
                "recent_pace": f"the trend of the last {RECENT_YEARS} years ({recent_from}-{last}) keeps going",
            },
            "projection": _forecast(rows, horizon),
            "backtest": {
                "method_tested": f"trend fitted on {available[0]}-{available[-3]}, used to predict {available[-2]} and {last}",
                "water_surface_mean_error_km2": bt_all["water_surface"]["mean_abs_error_km2"],
                "reading": d["trend_sentinel1_2019_2026"]["backtest"]["meaning"],
            },
        }
    return result


# ---------------------------------------------------------------- table for the app (built here, not by the LLM)
def build_table(result: dict) -> list[dict] | None:
    if result.get("status") != "ok" or len(result.get("yearly", [])) < 2:
        return None
    pct = result["water_change_pct_vs_start_year"]
    return [
        {"year": y["year"], "water_surface_km2": y["water_surface_km2"],
         "pct_change": None if i == 0 else pct[y["year"]], "data_source": "Sentinel-1"}
        for i, y in enumerate(result["yearly"])
    ]


if __name__ == "__main__":
    print(json.dumps(run_lake_analysis("Lake Burullus", 2019, 2026, forecast_to_year=2030, include_core=True,
                                       include_nisar=True), indent=1, ensure_ascii=False))
