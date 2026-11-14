/**
 * AQUA SAR — data access layer used by the UI.
 *
 *   getLakes()                              -> list of lakes
 *   getLakeInfo(lake)                       -> metadata, map ROI, reference text (data/lakes.json)
 *   getAnalysis(lake, startYear, endYear)   -> table + chart data, built from getLakeData()
 *   getTileUrl(layerKey)                    -> backend tile URL template for a layer key
 *   getTileLayer(lake, year, source)        -> map overlay descriptor
 *   sendChat(lake, message, context)        -> assistant reply (text + table/chart blocks)
 *
 * Measurements are NOT defined here: they all come from js/lakeData.js (getLakeData).
 * Lake metadata (name, ROI, background text) still comes from data/lakes.json.
 */
import { API_BASE } from './config.js';
import { getLakeData, buildAnalysis } from './lakeData.js';

/* ------------------------------------------------------------------ helpers */


const cache = new Map();
async function loadJson(path) {
  if (!cache.has(path)) {
    cache.set(
      path,
      fetch(path).then((res) => {
        if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
        return res.json();
      }),
    );
  }
  return cache.get(path);
}

/* -------------------------------------------------------------------- lakes */

export async function getLakes() {
  return (await loadJson('data/lakes.json')).lakes;
}

export async function getLakeInfo(lake) {
  const info = (await loadJson('data/lakes.json')).lakes.find((l) => l.id === lake);
  if (!info) throw new Error(`Unknown lake: ${lake}`);
  return info;
}

/* ----------------------------------------------------------------- analysis */

/**
 * Table + chart data for a year range (default: the whole series). Resolves to null when the lake has no data.
 * See buildAnalysis() in js/lakeData.js for the shape.
 */
export async function getAnalysis(lake, startYear, endYear) {
  const data = await getLakeData(lake);
  return data ? buildAnalysis(data, startYear, endYear) : null;
}

/* --------------------------------------------------------------- map layers */

/** Tile layer key: "s1_<year>", or "nisar_2026" ONLY for year 2026 + sensor NISAR. */
export function layerKeyFor(year, sensor = 'sentinel') {
  return year === 2026 && sensor === 'nisar' ? 'nisar_2026' : `s1_${year}`;
}

/**
 * Tile URL template (with {z}/{x}/{y}) for a layer key: API_BASE + the relative url from the "tiles" block,
 * or API_BASE + "/tiles/<layer>/{z}/{x}/{y}.png". The front-end never builds Earth Engine URLs.
 */
export async function getTileUrl(layerKey, lake = 'burullus') {
  const data = await getLakeData(lake);
  if (!data) return null;
  const rel = data.tiles?.[layerKey]?.url;
  if (!rel) return null; // no tiles block (offline data): no map layer
  return /^https?:/i.test(rel) ? rel : API_BASE + rel;
}

/**
 * What js/data.js draws on the map for (lake, year, source):
 *   { kind: 'xyz', key, url, label, sensor }  -> real class-map tiles
 *   null                                      -> no tiles (backend down / no data): draw nothing
 */
export async function getTileLayer(lake, year, source = 'sentinel') {
  const data = await getLakeData(lake);
  if (!data || year == null) return null;
  const key = layerKeyFor(year, source);
  const url = await getTileUrl(key, lake);
  if (!url) return null;
  const t = data.tiles[key];
  return { kind: 'xyz', key, url, label: t.label, sensor: t.sensor };
}

/* --------------------------------------------------------------------- chat */

/**
 * POST {API_BASE}/chat  -> { reply, intent, topic, years, table, source, ai_generated }
 *   request: { message (<=400 chars), intro, history (last 2, each <=300 chars), lake }
 * 50 s timeout. Any network error or non-200 THROWS: the UI shows an error with a Retry button
 * (there is no mock or template fallback). Nothing is logged or stored here.
 */
export async function sendChat(lake, message, { intro = false, history = [] } = {}) {
  const body = { intro, history, lake };
  if (!intro) body.message = String(message ?? '').slice(0, 400);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 50000);
  try {
    const res = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (res.status !== 200) throw new Error(`chat failed (${res.status})`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
