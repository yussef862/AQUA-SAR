/**
 * DATA page: MapLibre map, year timeline, results (table / Chart.js chart) and the mascot chat.
 * All data comes from js/api.js. MapLibre (`maplibregl`) and Chart.js (`Chart`) are CDN globals.
 */
import { LAKES, COLORS, SOURCES, API_BASE } from './config.js';
import { getLakeInfo, getAnalysis, getTileLayer, layerKeyFor, sendChat } from './api.js';
import { getLakeData, refreshLakeData, badgeFor, yearRange, nisarYear, buildCoreAnalysis, buildSensorTable } from './lakeData.js';
import { getQuestion, pickChips, findChip } from './chips.js';
import { poseUrl, preload } from './mascot.js';
import { navigateWithFade, initPageTransition } from './transition.js';

if (window.Chart) {
  Chart.defaults.font.family = "'Instrument Serif', Georgia, serif";
  Chart.defaults.font.size = 14;
}
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const mobile = () => window.matchMedia('(max-width: 900px)').matches;

/* ---- which lake? (?lake=burullus) --------------------------------------------- */
const params = new URLSearchParams(window.location.search);
const lakeId = LAKES.some((l) => l.id === params.get('lake')) ? params.get('lake') : LAKES[0].id;

const state = {
  lake: lakeId,
  info: null,
  data: null, // getLakeData() result (null = no data for this lake yet)
  year: null,
  sensor2026: 'nisar', // which 2026 layer the small switch shows
  asked: new Set(), // question ids already asked (no chip repeats them)
  main: null, // water-area analysis (table / chart)
  core: null, // lake-core analysis
  sensors: null, // 2026 sensor comparison
  full: null, // full-range analysis
  results: { mode: 'table', open: false },
  chatBusy: false,
  chatTable: null, // rows from the last POST /chat answer that carried a table
};

/* ==========================================================================
   MAP
   ========================================================================== */
/** 'sentinel' | 'nisar' for the layer on screen (two sensors exist only at the last year). */
function currentSensor() {
  const d = state.data;
  return d && state.year === nisarYear(d) ? state.sensor2026 : 'sentinel';
}

let map = null;
let mapReady = false;
let layerToken = 0;

function initMap(info) {
  if (!window.maplibregl) {
    $('#layer-note').textContent = 'Map library could not be loaded (offline?).';
    setLoading(false);
    return;
  }
  map = new maplibregl.Map({
    container: 'map',
    center: [30.9, 31.5],
    zoom: 10,
    maxZoom: 16,
    attributionControl: { compact: true },
    style: {
      version: 8,
      sources: {
        satellite: {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          maxzoom: 18,
          attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
        },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#07122a' } },
        { id: 'satellite', type: 'raster', source: 'satellite', paint: { 'raster-brightness-max': 0.92, 'raster-saturation': 0.05 } },
      ],
    },
  });
  // zoom buttons + compass (north arrow, rotates with the map) and scale bar
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 110 }), 'bottom-right');
  map.on('load', () => {
    mapReady = true;
    applyLayer(state.year, currentSensor());
  });
  // keep the canvas in sync when the chat opens/closes or the results panel grows
  new ResizeObserver(() => map.resize()).observe($('#map'));
}

/* Layer swap: the new raster layer is added on top first; the old one is removed only after the new one has
   loaded, so the map is never empty and never flickers. */
let shownLayer = null;   // id currently visible
let pendingLayer = null; // id still loading
let layerSeq = 0;

function dropLayer(id) {
  if (!id) return;
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
}

function setLoading(on) {
  const el = $('#map-loading');
  if (el) el.hidden = !on;
}

/** Small non-blocking message over the map ('' hides it) with a Retry button that asks the backend again. */
function showMapMsg(text) {
  const box = $('#map-msg');
  if (!box) return;
  box.hidden = !text;
  box.querySelector('span').textContent = text;
}

async function retryTiles() {
  showMapMsg('');
  setLoading(true);
  try {
    const fresh = await refreshLakeData(state.lake);
    if (fresh?.tiles && state.data) state.data.tiles = fresh.tiles; // numbers stay as already shown
  } catch (e) {
    console.warn(e);
  }
  applyLayer(state.year, currentSensor());
}

/** Draw the class-map tiles api.getTileLayer() describes for (lake, year, source). */
async function applyLayer(year, source) {
  if (!mapReady) return;
  const token = ++layerToken;
  const desc = await getTileLayer(state.lake, year, source);
  if (token !== layerToken) return; // a newer request replaced this one
  const note = $('#layer-note');

  if (!desc) {
    // no tiles (backend unavailable or no data): base map only, NO fake overlay
    dropLayer(pendingLayer);
    dropLayer(shownLayer);
    pendingLayer = shownLayer = null;
    setLoading(false);
    note.textContent = '';
    showMapMsg(state.data ? 'Using offline data' : '');
    return;
  }

  note.textContent = '';
  showMapMsg('');
  const cur = pendingLayer || shownLayer;
  if (cur && cur.endsWith(`-${desc.key}`)) { if (!pendingLayer) setLoading(false); return; } // already on screen / loading
  dropLayer(pendingLayer); // abandon a layer that never finished loading
  const id = `tiles-${++layerSeq}-${desc.key}`;
  pendingLayer = id;
  setLoading(true);
  map.addSource(id, { type: 'raster', tiles: [desc.url], tileSize: 256, minzoom: 8, maxzoom: 13 });
  map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0, 'raster-opacity-transition': { duration: 200, delay: 0 }, 'raster-fade-duration': 0 } });

  let done = false;
  const finish = () => {
    if (done || pendingLayer !== id) return;
    done = true;
    map.off('sourcedata', onData);
    clearTimeout(timer);
    const old = shownLayer;
    shownLayer = id;
    pendingLayer = null;
    map.setPaintProperty(id, 'raster-opacity', 0.85); // 200 ms cross-fade
    if (old && map.getLayer(old)) {
      map.setPaintProperty(old, 'raster-opacity-transition', { duration: 200, delay: 0 });
      map.setPaintProperty(old, 'raster-opacity', 0);
      setTimeout(() => dropLayer(old), 230);
    }
    setLoading(false);
  };
  const onData = (e) => {
    if (e.sourceId === id && map.isSourceLoaded(id)) finish();
  };
  const timer = setTimeout(finish, 10000); // never leave the old layer stuck if loading stalls
  map.on('sourcedata', onData);
  map.on('idle', function once() {
    map.off('idle', once);
    if (pendingLayer === id) finish();
  });
}

/* ==========================================================================
   TIMELINE
   ========================================================================== */
function initTimeline() {
  const slider = $('#year-slider');
  const wrap = $('#slider');
  const out = $('#year-out');
  const ticks = $('#ticks');
  const badge = $('#badge');
  const d = state.data;

  if (!d) {
    // no time series for this lake yet
    slider.disabled = true;
    badge.hidden = true;
    out.textContent = 'No data yet';
    return;
  }

  const { min, max } = yearRange(d);
  slider.min = min;
  slider.max = max;
  slider.value = max; // default: rightmost = NISAR
  state.year = max;
  $('#key-s1').textContent = `Sentinel-1 (${min}-${max - 1})`;
  $('#key-nisar').textContent = `NISAR (Jun-Oct ${nisarYear(d)})`;

  for (let y = min; y <= max; y++) {
    const s = document.createElement('span');
    s.textContent = y;
    s.dataset.year = y;
    ticks.append(s);
  }

  const sw = $('#s2026');
  const swBtns = { sentinel: $('#sw-s1'), nisar: $('#sw-nisar') };
  const update = () => {
    const y = Number(slider.value);
    const b = badgeFor(d, y);
    // at the last year two sensors exist: the small switch picks Sentinel-1 or NISAR (default NISAR)
    if (y === max) b.sensor = state.sensor2026;
    if (sw) sw.hidden = y !== max;
    Object.entries(swBtns).forEach(([k, el]) => el?.setAttribute('aria-pressed', String(state.sensor2026 === k)));
    const tile = d.tiles?.[layerKeyFor(y, b.sensor)];
    if (y === max && b.sensor === 'sentinel') b.text = d.years.find((r) => r.year === y)?.badge ?? b.text;
    const label = SOURCES[b.sensor].label;
    state.year = y;
    wrap.dataset.source = b.sensor;
    out.textContent = `${y} · ${label}`;
    slider.setAttribute('aria-valuetext', `${y}, ${label}`);
    $('#badge-text').textContent = tile?.label ?? b.text; // label from the tiles, else the JSON badge
    badge.classList.toggle('badge--nisar', b.sensor === 'nisar');
    ticks.querySelectorAll('span').forEach((t) => t.classList.toggle('is-active', Number(t.dataset.year) === y));
    renderTable(); // refresh the "current year" row highlight
  };

  // dragging: badge updates at once, the map swaps after ~150 ms idle (or on release)
  let idle = null;
  const swap = () => {
    clearTimeout(idle);
    applyLayer(state.year, currentSensor());
  };
  slider.addEventListener('input', () => {
    update();
    clearTimeout(idle);
    idle = setTimeout(swap, 150);
  });
  slider.addEventListener('change', swap);
  Object.entries(swBtns).forEach(([k, el]) =>
    el?.addEventListener('click', () => {
      state.sensor2026 = k;
      update();
      swap();
    }),
  );

  // Releasing the slider only updates map, badge and highlights (done on 'input').
  // One exception: releasing on the NISAR year fills (does not send) the sensor-comparison question, Q10.
  slider.addEventListener('change', () => {
    if (Number(slider.value) === max) prefillChat(getQuestion('Q10').question);
  });

  update();
}

/* ==========================================================================
   RESULTS (table + chart)
   ========================================================================== */
let bigChart = null;
let coreChart = null;

/** Results views (mode -> element). Modes are also the chat block types. */
const VIEWS = {
  table: '#table-view',
  chart: '#chart-view',
  'core-chart': '#core-chart-view',
  'core-table': '#core-table-view',
  sensors: '#sensors-view',
};
const CORE_GROUP = ['core-chart', 'core-table', 'sensors'];

const fmtPct = (p) => (p === null ? '–' : `${p > 0 ? '+' : ''}${p.toFixed(1)}%`);
const pctClass = (p) => (p === null ? '' : p < 0 ? 'neg' : p > 0 ? 'pos' : '');
const fmtDiff = (x) => `${x > 0 ? '+' : ''}${x.toFixed(1)}`;

/** Year | Water area km² | % change | Data source. NISAR row: gold, never a % change vs Sentinel-1. */
function tableHTML(analysis, cur = null) {
  const rows = analysis.rows
    .map((r) => {
      const isCur = cur && r.year === cur.year && r.sensor === cur.sensor;
      return `<tr class="${r.sensor === 'nisar' ? 'is-nisar' : ''} ${isCur ? 'is-current' : ''}">
        <td>${r.year}</td><td class="num">${r.areaKm2.toFixed(1)}</td><td class="num ${pctClass(r.pctChange)}">${fmtPct(r.pctChange)}</td><td>${r.source}</td></tr>`;
    })
    .join('');
  return `<table class="dtable"><thead><tr><th scope="col">Year</th><th scope="col" class="num">Water area km²</th><th scope="col" class="num">% change</th><th scope="col">Data source</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** Year | Water in core | % of core | Vegetation | Land | Data source. */
function coreTableHTML(a) {
  const rows = a.rows
    .map(
      (r) => `<tr class="${r.sensor === 'nisar' ? 'is-nisar' : ''}"><td>${r.year}</td><td class="num">${r.water.toFixed(1)}</td><td class="num">${r.pctOfCore.toFixed(1)}%</td>
        <td class="num">${r.vegetation.toFixed(1)}</td><td class="num">${r.land.toFixed(1)}</td><td>${r.source}</td></tr>`,
    )
    .join('');
  return `<table class="dtable"><thead><tr><th scope="col">Year</th><th scope="col" class="num">Water in core km²</th><th scope="col" class="num">% of core</th><th scope="col" class="num">Vegetation km²</th><th scope="col" class="num">Land km²</th><th scope="col">Data source</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** Metric | Sentinel-1 km² | NISAR km² | Difference km². The core-water row (they agree) is highlighted. */
function sensorsHTML(a) {
  const rows = a.rows
    .map(
      (r) => `<tr class="${r.agree ? 'is-agree' : ''}"><td>${esc(r.metric)}</td><td class="num">${r.sentinel1.toFixed(1)}</td><td class="num">${r.nisar.toFixed(1)}</td><td class="num">${fmtDiff(r.difference)}</td></tr>`,
    )
    .join('');
  return `<table class="dtable"><thead><tr><th scope="col">Metric</th><th scope="col" class="num">Sentinel-1 km²</th><th scope="col" class="num">NISAR km²</th><th scope="col" class="num">Difference km²</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** Chart.js config shared by the big charts and the mini charts in chat (all numbers from analysis.chart). */
function chartConfig(analysis, mini = false) {
  const c = analysis.chart;
  const labels = c.years.map(String);
  const ds = [];

  if (!mini) {
    // trend band + dashed centre line: only over the data years, no projection
    ds.push(
      { label: '_lo', data: c.trend.low, borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: 'rgba(159,179,217,0.13)', order: 5 },
      { label: '_hi', data: c.trend.high, borderWidth: 0, pointRadius: 0, fill: false, order: 5 },
      { label: c.trend.label, data: c.trend.center, borderColor: 'rgba(238,244,255,0.55)', borderDash: [6, 5], borderWidth: 1.5, pointRadius: 0, fill: false, order: 4 },
    );
  }
  ds.push({
    label: 'Sentinel-1',
    data: c.sentinel1,
    borderColor: COLORS.sentinel,
    backgroundColor: COLORS.sentinel,
    pointRadius: mini ? 2 : 4,
    pointHoverRadius: 6,
    borderWidth: 2.5,
    tension: 0.2,
    order: 2,
  });
  if (c.nisar) {
    // separate gold point for the NISAR year: same x as the last Sentinel-1 point, NOT connected to the line
    ds.push({
      label: 'NISAR',
      data: c.years.map((y) => (y === c.nisar.year ? c.nisar.water_km2 : null)),
      showLine: false,
      borderColor: COLORS.nisar,
      backgroundColor: COLORS.nisar,
      pointRadius: mini ? 4 : 7,
      pointHoverRadius: 9,
      order: 1,
    });
  }

  return {
    type: 'line',
    data: { labels, datasets: ds },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500 },
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { right: 8 } },
      scales: {
        x: { grid: { color: COLORS.grid }, ticks: { color: COLORS.textDim, maxTicksLimit: mini ? 6 : 12, font: { size: mini ? 10 : 12 } } },
        y: {
          min: c.yHint[0],
          max: c.yHint[1],
          grid: { color: COLORS.grid },
          ticks: { color: COLORS.textDim, font: { size: mini ? 10 : 12 } },
          title: { display: !mini, text: c.yTitle || 'Water area (km²)', color: COLORS.textDim },
        },
      },
      plugins: {
        legend: {
          display: !mini,
          labels: { color: COLORS.text, usePointStyle: true, boxWidth: 8, filter: (item) => !item.text.startsWith('_') },
        },
        tooltip: {
          filter: (item) => !item.dataset.label.startsWith('_'),
          callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} km²` },
        },
      },
    },
  };
}

function renderTable() {
  if (state.chatTable) {
    $('#table-view').innerHTML = backendTableHTML(state.chatTable); // the chat's table stays as the backend sent it
    return;
  }
  if (!state.main || !state.data) return;
  const cur = { year: state.year, sensor: badgeFor(state.data, state.year).sensor };
  $('#table-view').innerHTML = tableHTML(state.main, cur);
}

function renderResults() {
  const { mode, open } = state.results;
  $('#results').dataset.open = String(open);
  $('#results-toggle').setAttribute('aria-expanded', String(open));
  $('#results-toggle').setAttribute('aria-label', open ? 'Collapse results' : 'Expand results');
  const inCore = CORE_GROUP.includes(mode);
  $('#btn-table').setAttribute('aria-pressed', String(mode === 'table'));
  $('#btn-chart').setAttribute('aria-pressed', String(mode === 'chart'));
  $('#btn-core').setAttribute('aria-pressed', String(inCore));
  $('#subnav').hidden = !inCore;
  $('#sub-core-chart').setAttribute('aria-pressed', String(mode === 'core-chart'));
  $('#sub-core-table').setAttribute('aria-pressed', String(mode === 'core-table'));
  $('#sub-sensors').setAttribute('aria-pressed', String(mode === 'sensors'));
  Object.entries(VIEWS).forEach(([m, sel]) => {
    $(sel).hidden = m !== mode;
  });

  const caption = $('#results-caption');
  const note = $('#results-note');
  if (!state.data) {
    caption.textContent = `Time series for ${state.info.name} are not available yet.`;
    note.textContent = '';
    return;
  }
  const d = state.data;
  const ny = nisarYear(d);
  const twoSensors = `${ny} is shown for two different sensors (Sentinel-1 and NISAR); they are not directly comparable.`;
  const coreNote = `Core = area mapped as permanent water by an independent Landsat dataset (JRC) in 2019–2021, ${state.core.coreArea} km². ${ny} shows two sensors; they are not directly comparable.`;
  const { min, max } = yearRange(d);

  if (mode === 'table' || mode === 'chart') {
    if (!state.main) {
      caption.textContent = '';
      note.textContent = '';
      return;
    }
    caption.textContent = `${state.info.name} · water area (km²) · ${state.main.startYear}–${state.main.endYear}`;
    note.textContent = [twoSensors, mode === 'chart' ? `Trend = Theil-Sen on Sentinel-1 ${min}-${max} with range.` : ''].filter(Boolean).join(' ');
  } else if (mode === 'core-chart') {
    caption.textContent = state.core.title;
    note.textContent = coreNote;
  } else if (mode === 'core-table') {
    caption.textContent = 'Lake core · water, vegetation and land (km²)';
    note.textContent = coreNote;
  } else {
    caption.textContent = state.sensors.note;
    note.textContent = state.sensors.reading;
  }

  renderTable();
  $('#core-table-view').innerHTML = coreTableHTML(state.core);
  $('#sensors-view').innerHTML = sensorsHTML(state.sensors);
  if (open && window.Chart) {
    if (mode === 'chart' && state.main) {
      bigChart?.destroy();
      bigChart = new Chart($('#chart'), chartConfig(state.main, false));
    }
    if (mode === 'core-chart') {
      coreChart?.destroy();
      coreChart = new Chart($('#core-chart'), chartConfig(state.core, false));
    }
  }
}

/** Show a view in the results area (called by the chat answers and by the toggle buttons). */
function showResults({ mode = state.results.mode, open = true } = {}) {
  state.results = { mode, open };
  renderResults();
}

function initResults() {
  $('#btn-table').addEventListener('click', () => showResults({ mode: 'table' }));
  $('#btn-chart').addEventListener('click', () => showResults({ mode: 'chart' }));
  $('#btn-core').addEventListener('click', () => showResults({ mode: CORE_GROUP.includes(state.results.mode) ? state.results.mode : 'core-chart' }));
  $('#sub-core-chart').addEventListener('click', () => showResults({ mode: 'core-chart' }));
  $('#sub-core-table').addEventListener('click', () => showResults({ mode: 'core-table' }));
  $('#sub-sensors').addEventListener('click', () => showResults({ mode: 'sensors' }));
  $('#results-toggle').addEventListener('click', () => showResults({ open: !state.results.open }));
  renderResults();
}

/* ==========================================================================
   CHAT
   ========================================================================== */
const messages = $('#messages');
const input = $('#chat-input');
const sendBtn = $('#chat-send');
let typingEl = null;
let poseTimer = 0;
let greeted = false;

/** Header pose: 'wave' | 'laptop' (loading) | 'explain' (results) | 'think' (idle). */
function setPose(pose, revertMs = 0) {
  const img = $('#head-pose');
  window.clearTimeout(poseTimer);
  const next = poseUrl(pose);
  if (!img.src.endsWith(next)) {
    img.classList.add('is-swapping');
    window.setTimeout(() => {
      img.src = next;
      img.classList.remove('is-swapping');
    }, 160);
  }
  img.dataset.pose = pose;
  if (revertMs) poseTimer = window.setTimeout(() => setPose('think'), revertMs);
}

const timeNow = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const scrollDown = () => (messages.scrollTop = messages.scrollHeight);

function botAvatar() {
  const d = document.createElement('div');
  d.className = 'avatar';
  d.innerHTML = `<img src="${poseUrl('think')}" alt="" width="34" height="34">`;
  return d;
}

function addUser(text) {
  const el = document.createElement('div');
  el.className = 'msg msg--user';
  el.innerHTML = `<div class="bubble"><p>${esc(text)}</p><span class="time">${timeNow()}</span></div>`;
  messages.append(el);
  scrollDown();
}

function showTyping() {
  typingEl = document.createElement('div');
  typingEl.className = 'msg';
  typingEl.setAttribute('aria-label', 'Assistant is typing');
  typingEl.append(botAvatar());
  const b = document.createElement('div');
  b.className = 'bubble';
  b.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  typingEl.append(b);
  messages.append(typingEl);
  scrollDown();
}
const hideTyping = () => {
  typingEl?.remove();
  typingEl = null;
};

const DEBUG = new URLSearchParams(location.search).get('debug') === '1';
const clean = (s) => String(s ?? '').replace(/[  ]/g, ' '); // narrow / no-break spaces -> normal space
const convo = []; // this page's messages, in memory only: { role, content }

/** One assistant bubble. The reply is shown with textContent (never innerHTML). */
function addBot({ text, aiGenerated = false, source = null, chips = [], retry = null }) {
  messages.querySelectorAll('.chips').forEach((c) => c.remove()); // chips of earlier replies are replaced
  const el = document.createElement('div');
  el.className = 'msg';
  el.append(botAvatar());
  const b = document.createElement('div');
  b.className = 'bubble';
  const p = document.createElement('p');
  p.className = 'reply';
  p.textContent = text;
  b.append(p);
  if (retry) {
    const r = document.createElement('button');
    r.type = 'button';
    r.className = 'retry';
    r.textContent = 'Retry';
    r.addEventListener('click', () => {
      if (state.chatBusy) return;
      el.remove();
      retry();
    });
    b.append(r);
  }
  if (aiGenerated) {
    const tag = document.createElement('span');
    tag.className = 'aitag';
    tag.textContent = 'AI-generated';
    b.append(tag);
  }
  if (DEBUG && source) {
    const dbg = document.createElement('span');
    dbg.className = 'srcbadge';
    dbg.textContent = `source: ${source}`;
    b.append(dbg);
  }
  if (chips.length) {
    const c = document.createElement('div');
    c.className = 'chips';
    chips.forEach((q) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = q.question;
      btn.addEventListener('click', () => send(q.question));
      c.append(btn);
    });
    b.append(c);
  }
  const t = document.createElement('span');
  t.className = 'time';
  t.textContent = timeNow();
  b.append(t);
  el.append(b);
  messages.append(el);
  scrollDown();
  if ($('#app').classList.contains('chat-closed')) $('#launcher-dot').hidden = false; // notification
}

/** Table from the backend -> the Results table, exactly as returned (no client-side numbers). */
function backendTableHTML(rows) {
  const cell = (v) => (v === null || v === undefined ? '—' : esc(String(v)));
  const body = rows
    .map((r) => `<tr><td>${cell(r.year)}</td><td class="num">${cell(r.water_surface_km2)}</td><td class="num">${cell(r.pct_change)}</td><td>${cell(r.data_source)}</td></tr>`)
    .join('');
  return `<table class="dtable"><thead><tr><th scope="col">Year</th><th scope="col" class="num">Water area km²</th><th scope="col" class="num">% change</th><th scope="col">Data source</th></tr></thead><tbody>${body}</tbody></table>`;
}

function applyAnswer(res) {
  if (Array.isArray(res.table) && res.table.length) {
    state.chatTable = res.table;
    $('#table-view').innerHTML = backendTableHTML(res.table);
    showResults({ mode: 'table', open: true });
    const slider = $('#year-slider');
    const to = Array.isArray(res.years) ? Number(res.years[1]) : NaN;
    if (slider && !slider.disabled && Number.isFinite(to)) {
      slider.value = String(Math.min(Math.max(to, Number(slider.min)), Number(slider.max)));
      slider.dispatchEvent(new Event('input')); // same path as dragging: badge now, map after the debounce
    }
  }
}

/** One request/response round. A failure shows the error bubble; Retry runs the same round again. */
async function ask({ message = '', intro = false }) {
  state.chatBusy = true;
  sendBtn.disabled = true;
  input.disabled = true;
  setPose('laptop');
  showTyping();
  const hist = convo.slice(-2).map((m) => ({ role: m.role, content: m.content.slice(0, 300) }));
  try {
    const res = await sendChat(state.lake, message, { intro, history: hist });
    hideTyping();
    const text = clean(res.reply);
    if (!intro) convo.push({ role: 'user', content: message });
    convo.push({ role: 'assistant', content: text });
    addBot({
      text,
      aiGenerated: res.ai_generated === true,
      source: res.source,
      chips: chipsFor(res.intent, res.topic),
    });
    applyAnswer(res);
    setPose(Array.isArray(res.table) ? 'explain' : 'think', Array.isArray(res.table) ? 8000 : 0);
  } catch (err) {
    console.warn('Chat request failed:', err?.name || 'error'); // never log the message itself
    hideTyping();
    addBot({ text: "I couldn't reach the assistant. Please try again.", retry: () => ask({ message, intro }) });
    setPose('think');
  } finally {
    state.chatBusy = false;
    sendBtn.disabled = false;
    input.disabled = false;
  }
}

const chipsFor = (intent, topic) => pickChips(intent, topic, state.asked);

function send(raw) {
  const text = String(raw ?? '').trim().slice(0, 400);
  if (!text || state.chatBusy) return;
  const chip = findChip(text);
  if (chip) state.asked.add(chip.id);
  addUser(text);
  input.value = '';
  autoGrow();
  ask({ message: text });
}

function prefillChat(text) {
  input.value = text;
  autoGrow();
  input.classList.remove('is-prefilled');
  void input.offsetWidth; // restart the highlight animation
  input.classList.add('is-prefilled');
  if ($('#app').classList.contains('chat-closed')) $('#launcher-dot').hidden = false;
}

function autoGrow() {
  input.style.height = 'auto'; // eslint-disable-line -- measuring only
  input.style.height = `${Math.min(input.scrollHeight, 110)}px`;
}

function setChatOpen(open) {
  const app = $('#app');
  app.classList.toggle('chat-closed', !open);
  const chat = $('#chat');
  chat.dataset.open = String(open);
  chat.inert = !open;
  $('#chat-close').setAttribute('aria-expanded', String(open));
  $('#chat-open').setAttribute('aria-expanded', String(open));
  $('#chat-open').hidden = open;
  if (open) {
    $('#launcher-dot').hidden = true;
    window.setTimeout(() => input.focus({ preventScroll: true }), 300);
    scrollDown();
  } else {
    window.setTimeout(() => $('#chat-open').focus({ preventScroll: true }), 50);
  }
}

function initChat() {
  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    send(input.value);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input.value);
    }
  });
  input.addEventListener('input', autoGrow);
  $('#chat-close').addEventListener('click', () => setChatOpen(false));
  $('#chat-open').addEventListener('click', () => setChatOpen(true));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mobile() && $('#chat').dataset.open === 'true') setChatOpen(false);
  });
  // start closed on small screens (bottom sheet), open on desktop
  setChatOpen(!mobile());
  if (mobile()) $('#launcher-dot').hidden = false;
}

/** The assistant opens the conversation by itself (POST /chat with intro: true). */
async function greet() {
  if (greeted) return;
  greeted = true;
  setPose('wave');
  await ask({ intro: true });
}

/* ==========================================================================
   BOOT
   ========================================================================== */
/** Header dot: green if GET /health answers within 5 s, grey otherwise. Plain GET, no headers. */
async function checkHealth() {
  const dot = $('#api-dot');
  if (!dot) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  let ok = false;
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: ctrl.signal });
    ok = res.ok;
  } catch (e) { /* unreachable: grey */ }
  clearTimeout(timer);
  dot.classList.toggle('is-ok', ok);
  dot.title = ok ? 'Backend online' : 'Backend not reachable';
}

async function main() {
  checkHealth();
  initPageTransition();
  preload(['wave', 'laptop', 'explain', 'think']);

  // back / X -> fade to home
  $('#back').addEventListener('click', (e) => {
    e.preventDefault();
    navigateWithFade('index.html');
  });

  setLoading(true); // "Loading satellite layers..." until the lake JSON and the first layer are ready
  $('#map-retry')?.addEventListener('click', retryTiles);
  state.info = await getLakeInfo(state.lake);
  document.title = `${state.info.name} — AQUA SAR`;
  $('#lake-name').textContent = state.info.name;

  state.data = await getLakeData(state.lake).catch((e) => {
    console.error(e);
    return null;
  });
  if (!state.data) setLoading(false);

  if (state.data) {
    state.core = buildCoreAnalysis(state.data);
    state.sensors = buildSensorTable(state.data);
  }

  initMap(state.info);
  initTimeline();
  initResults();
  initChat();

  if (state.data) {
    getAnalysis(state.lake)
      .then((a) => {
        state.main = a; // so the Table / Chart buttons work before the chat has produced anything
        renderResults();
      })
      .catch((e) => console.error(e));
  }

  greet();
}

main().catch((err) => {
  console.error(err);
  $('#lake-name').textContent = 'Could not load lake data';
});
