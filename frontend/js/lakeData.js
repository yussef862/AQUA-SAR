/**
 * AQUA SAR — the ONE place lake measurements come from.
 *
 *   const data = await getLakeData('burullus');   // JSON shape of data/burullus_yearly.json
 *
 * Today it reads the static file data/<lake>_yearly.json. When the backend is ready set
 * It calls GET {API_BASE}/lakes/<id> (same JSON shape)
 * and falls back to the static file if that request fails.
 * Resolves to null for lakes without data yet (any lake not listed in STATIC_FILES).
 *
 * NO measurement is hardcoded anywhere else: slider, badge, chart, table and chat all read from here.
 * The pure helpers below only reshape this JSON (they never invent numbers).
 */
import { API_BASE } from './config.js';

/** Static files bundled with the front-end (fallback). Add a line per lake that has data. */
const STATIC_FILES = { burullus: 'data/burullus_yearly.json' };

const cache = new Map();

export function getLakeData(lakeId = 'burullus') {
  if (!cache.has(lakeId)) cache.set(lakeId, load(lakeId));
  return cache.get(lakeId);
}

/** Forget the cached result so the next getLakeData() asks the backend again (Retry button). */
export function refreshLakeData(lakeId = 'burullus') {
  cache.delete(lakeId);
  return getLakeData(lakeId);
}

/**
 * Plain GET (no headers, no credentials, no cache option -> no CORS preflight) with a 15 s timeout and up to
 * 2 retries (500 ms, 1500 ms) on network errors, timeouts and 5xx. Covers the backend's cold start.
 */
export async function fetchWithRetry(url, { timeoutMs = 15000, backoff = [500, 1500] } = {}) {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (res.status < 500 || attempt >= backoff.length) return res;
    } catch (err) {
      if (attempt >= backoff.length) throw err;
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, backoff[attempt]));
  }
}

async function load(id) {
  try {
    const res = await fetchWithRetry(`${API_BASE}/lakes/${encodeURIComponent(id)}`);
    if (res.ok) {
      const json = await res.json(); // includes data.tiles
      if (json?.tiles) return json;
      console.warn('Lake API answered without tiles; using the bundled JSON for the numbers.');
    }
  } catch (err) {
    console.warn('Lake API unavailable, using the static file (no map tiles).', err);
  }
  const path = STATIC_FILES[id];
  if (!path) return null;
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return res.json();
}

/* ------------------------------------------------------------------ helpers */

const round1 = (n) => Math.round(n * 10) / 10;

/** Year the NISAR layer belongs to (also the last slider position). */
export const nisarYear = (d) => d.chart.nisar_point.year;

/** First / last year of the Sentinel-1 series. */
export function yearRange(d) {
  return { min: d.years[0].year, max: d.years[d.years.length - 1].year };
}

/** Map badge for a slider year: { text, sensor: 'sentinel' | 'nisar' }. Text comes from the JSON. */
export function badgeFor(d, year) {
  if (year === nisarYear(d)) return { text: d.nisar_2026.badge, sensor: 'nisar' };
  const row = d.years.find((y) => y.year === year);
  return { text: row.badge, sensor: 'sentinel' };
}

/** Sentinel-1 → Sentinel-1 change between two years (same sensor only). */
export function sentinelChange(d, from, to) {
  const a = d.years.find((y) => y.year === from).water_km2;
  const b = d.years.find((y) => y.year === to).water_km2;
  return { from: a, to: b, km2: round1(b - a), pct: round1(((b - a) / a) * 100) };
}

/**
 * Everything the table and the chart need for a year range.
 *  rows : one per Sentinel-1 year + an extra NISAR row for the NISAR year (pctChange is null for it;
 *         a % change is never computed between Sentinel-1 and NISAR).
 *  chart: series sliced to the range; trend is only the 2019-2026 fit, never projected.
 */
export function buildAnalysis(d, startYear, endYear) {
  const { min, max } = yearRange(d);
  const start = Math.max(min, Math.min(startYear ?? min, endYear ?? max));
  const end = Math.min(max, Math.max(startYear ?? min, endYear ?? max));
  const ny = nisarYear(d);

  const rows = [];
  for (const y of d.years) {
    if (y.year < start || y.year > end) continue;
    rows.push({ year: y.year, areaKm2: y.water_km2, pctChange: y.water_change_yoy_pct, source: y.source, sensor: 'sentinel' });
    if (y.year === ny) {
      rows.push({ year: ny, areaKm2: d.nisar_2026.water_km2, pctChange: null, source: 'NISAR', sensor: 'nisar' });
    }
  }

  const idx = d.chart.x_years.map((y, i) => (y >= start && y <= end ? i : -1)).filter((i) => i >= 0);
  const pick = (arr) => idx.map((i) => arr[i]);
  const c = d.chart;
  return {
    lake: d.lake,
    startYear: start,
    endYear: end,
    range: { min, max },
    rows,
    trendInfo: d.trend_sentinel1_2019_2026,
    chart: {
      years: pick(c.x_years),
      sentinel1: pick(c.sentinel1_water_km2),
      nisar: ny >= start && ny <= end ? c.nisar_point : null,
      // band = the Theil-Sen range lines (trend_band_*), which are ordered so the fill is an hourglass
      trend: {
        label: c.trend_label,
        center: pick(c.trend_center_km2),
        low: pick(c.trend_band_lower_km2 ?? c.trend_low_km2),
        high: pick(c.trend_band_upper_km2 ?? c.trend_high_km2),
      },
      yHint: c.y_axis_hint_km2,
    },
  };
}

/* ------------------------------------------------------- core + sensors */

/** Lake-core series (fixed area mapped as permanent water by JRC in 2019-2021): chart + table rows. */
export function buildCoreAnalysis(d) {
  const core = d.core_open_water;
  const c = core.chart;
  const ny = nisarYear(d);
  const rows = core.years.map((y) => ({
    year: y.year,
    water: y.water_km2,
    pctOfCore: y.water_pct_of_core,
    vegetation: y.vegetation_km2,
    land: y.land_km2,
    source: y.source,
    sensor: 'sentinel',
  }));
  const n = core.nisar_2026;
  rows.push({ year: ny, water: n.water_km2, pctOfCore: n.water_pct_of_core, vegetation: n.vegetation_km2, land: n.land_km2, source: 'NISAR', sensor: 'nisar' });
  return {
    lake: d.lake,
    coreArea: core.core_area_km2,
    title: c.title,
    rows,
    chart: {
      years: c.x_years,
      sentinel1: c.sentinel1_water_km2,
      nisar: c.nisar_point,
      trend: { label: d.chart.trend_label, center: c.trend_center_km2, low: c.trend_band_lower_km2, high: c.trend_band_upper_km2 },
      yHint: c.y_axis_hint_km2,
      yTitle: 'Open water in the lake core (km²)',
    },
  };
}

/** The ONLY place the two sensors are compared (2026, same lake, different sensors). */
export function buildSensorTable(d) {
  const s = d.sensor_comparison_2026;
  return {
    lake: d.lake,
    note: s.note,
    reading: s.reading,
    rows: s.rows.map((r) => ({
      metric: r.metric,
      sentinel1: r.sentinel1_km2,
      nisar: r.nisar_km2,
      difference: r.difference_km2,
      agree: r.metric === 'Water, lake core', // highlighted row
    })),
  };
}

/** Values used by the answer templates (all read from the JSON, nothing typed in). */
export function derive(d) {
  const { min, max } = yearRange(d);
  const yr = (y) => d.years.find((x) => x.year === y);
  const cyr = (y) => d.core_open_water.years.find((x) => x.year === y);
  const t = d.trend_sentinel1_2019_2026;
  const core = d.core_open_water;
  const sensor = (metric) => d.sensor_comparison_2026.rows.find((r) => r.metric === metric);
  const w2019 = yr(min).water_km2;
  const w2023 = yr(2023).water_km2;
  const w2026 = yr(max).water_km2;
  const c2026 = cyr(max).water_km2;
  const coreGap = round1(Math.abs(c2026 - core.nisar_2026.water_km2));
  const s2 = d.s2_ndvi_reference;
  return {
    min,
    max,
    nisarYear: nisarYear(d),
    studyArea: d.study_area_km2,
    seaStrip: d.about_the_data.sea_strip_removed_km2,
    w2019,
    w2023,
    w2026,
    loss: t.total_change_km2,
    lossPct: t.total_change_pct,
    slope: t.slope_km2_per_year,
    slopeLo: t.slope_range_km2_per_year[0],
    slopeHi: t.slope_range_km2_per_year[1],
    vegGain: t.vegetation_change_km2,
    dropTo2023: round1(w2019 - w2023),
    overshoot: t.backtest.overshoot_km2_approx,
    cArea: core.core_area_km2,
    c2019: cyr(min).water_km2,
    c2023: cyr(2023).water_km2,
    c2026,
    c2019Pct: cyr(min).water_pct_of_core,
    c2026Pct: cyr(max).water_pct_of_core,
    cVeg2019: cyr(min).vegetation_km2,
    cVeg2026: cyr(max).vegetation_km2,
    cLoss: core.change_2019_2026.water_km2,
    cVegGain: core.change_2019_2026.vegetation_km2,
    cLandGain: core.change_2019_2026.land_km2,
    cSlope: core.trend.slope_km2_per_year,
    cSlopeLo: core.trend.slope_range_km2_per_year[0],
    cSlopeHi: core.trend.slope_range_km2_per_year[1],
    nCore: core.nisar_2026.water_km2,
    nCorePct: core.nisar_2026.water_pct_of_core,
    nCoreVeg: core.nisar_2026.vegetation_km2,
    nCoreLand: core.nisar_2026.land_km2,
    coreGap,
    coreGapPct: round1((coreGap / core.core_area_km2) * 100),
    greenPct: core.optical_check.share_of_sentinel1_core_vegetation_that_is_green_pct,
    s2First: s2.green_km2[0],
    s2FirstYear: s2.years[0],
    s2Last: s2.green_km2[s2.green_km2.length - 1],
    s2LastYear: s2.years[s2.years.length - 1],
    sensor,
  };
}
