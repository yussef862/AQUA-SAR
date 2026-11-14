/**
 * STORY page: a scroll-driven documentary of Lake Burullus, 2019–2026.
 * Text lives in CONTENT below (verbatim; *…* / **…** are emphasis markers, never shown).
 * Map layers come from the backend through js/api.js (getTileLayer -> getTileUrl -> API_BASE).
 */
import { navigateWithFade, initPageTransition } from './transition.js';
import { GLOBE } from './config.js';
import { getTileLayer } from './api.js';

const $ = (s, r = document) => r.querySelector(s);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isWide = () => innerWidth >= 900;

/* ================================================================ CONTENT */
const INTRO = {
  title: "What If a Lake Could Tell Its Story?",
  lines: [
    "Along Egypt's Mediterranean coast lies Lake Burullus.",
    "For generations, its waters have supported fishermen, wildlife, and the communities living around it.",
    "From the shore, the lake may seem unchanged.",
    "But from space, a different story begins to emerge.",
    "*Between 2019 and 2026, satellite observations revealed that approximately 18 square kilometers of mapped water were lost across our study region.*",
    "Meanwhile, green vegetation in the heart of the lake expanded to almost nine times its original footprint.",
    "What happened to the lake?",
    "Why was its landscape changing?",
    "And what could these changes mean for the people who depend on it?",
    "*To find the answers, we traveled back to 2019.*",
  ],
};

const SPRINGER = { label: 'Springer', url: 'https://link.springer.com/article/10.1007/s11270-023-06351-3' };
const SCIDIR = { label: 'ScienceDirect', url: 'https://www.sciencedirect.com/science/article/pii/S1642359326000819' };
const MDPI = { label: 'MDPI', url: 'https://www.mdpi.com/2071-1050/14/9/4980' };

const CHAPTERS = [
  {
    id: 'y2019', year: 2019, title: '2019 — The Starting Point', chip: 'Source: Sentinel-1',
    lines: [
      "Our journey begins in 2019.",
      "Using Sentinel-1 radar observations, AQUA SAR identified approximately *288.5 km² of mapped water* across the study region.",
      "In the central part of the lake, open water covered approximately 224 km².",
      "And green vegetation?",
      "Just 1.8 km².",
      "At this point, nearly 99% of our defined central reference region was classified as open water.",
      "These measurements became our starting point.",
      "A baseline that would allow us to follow the lake's transformation, one year at a time.",
      "But the first signs of change were closer than we expected.",
    ],
  },
  {
    id: 'y2020', year: 2020, title: '2020 — Something Was Changing',
    lines: [
      "One year later, we returned to the lake through satellite observations.",
      "This time, the mapped water area had decreased to 284 km².",
      "A reduction of 4.5 km² in just one year.",
      "It wasn't a dramatic transformation.",
      "Not yet.",
      "But it was the first measurable sign in our timeline that the landscape was changing.",
      "And the following year, the decline continued.",
    ],
  },
  {
    id: 'y2021', year: 2021, title: '2021 — More Than a Temporary Change?',
    lines: [
      "By 2021, the mapped water area had fallen again.",
      "*280.7 km².*",
      "Compared with 2019, that was a net reduction of *7.8 km²*.",
      "Meanwhile, green vegetation in the center of the lake reached approximately *2.5 km²*.",
      "It was still relatively limited.",
      "But two observations were beginning to stand out.",
      "Across the wider region, less area was being classified as water.",
      "And inside the lake, green vegetation was becoming increasingly important to our investigation.",
      "*Then came 2022. The year that changed the direction of our story.*",
    ],
  },
  {
    id: 'y2022', year: 2022, title: '2022 — The Year Everything Accelerated', chip: 'Source: Sentinel-2',
    lines: [
      "In 2022, we recorded the largest annual decline in mapped water across our entire eight-year series.",
      "*6 km² in a single year.*",
      "The mapped water area dropped to *274.7 km²*.",
      "But that wasn't the only change.",
      "Sentinel-2 revealed that green vegetation in the lake's central region had expanded from **2.5 km² in 2021 to 7.1 km² in 2022**.",
      "Almost three times as much in just one year.",
      "While the wider study region was losing mapped water, the center of the lake was becoming noticeably greener.",
      "**Why was this happening?**",
      "Scientific research offers important clues.",
      "Water entering Lake Burullus through agricultural and other drainage systems can carry nitrogen, phosphorus, and pollutants.",
      "Excess nutrients can encourage biological growth, while restricted water circulation can create conditions favorable to aquatic vegetation.",
      "The lake was not simply changing in size.",
      "**Its internal environment was changing too.**",
    ],
    sources: [SPRINGER, SCIDIR],
  },
  {
    id: 'y2023', year: 2023, title: '2023 — A Lake Under Pressure',
    lines: [
      "By 2023, mapped water had fallen to 271.7 km².",
      "That was 16.8 km² less than in 2019.",
      "Most of the net water-area decline eventually recorded by 2026 had already taken place.",
      "But to understand this transformation, we needed more than satellite images.",
      "Scientific studies had already documented the environmental pressures affecting Lake Burullus.",
      "A 2022 study by Keshta and colleagues found that coastal marshland had declined by 44.8% between 1985 and 2020, with some wetland areas converted into agricultural land and fish farms.",
      "And a 2023 study by Al-Afify and colleagues documented nutrient enrichment and pollution entering the lake through surrounding drains.",
      "These findings helped us understand the bigger picture.",
      "The change…",
    ],
    sources: [MDPI, SPRINGER],
  },
  {
    id: 'y2024', year: 2024, title: '2024 — Not Every Part of the Lake Was Changing the Same Way',
    lines: [
      "In 2024, something unexpected happened.",
      "The total mapped water area increased slightly, reaching 272.2 km².",
      "For the first time in our timeline, the broader decline was interrupted.",
      "But the center of the lake told a different story.",
      "Central open water continued to decrease, falling from 218.7 km² in 2023 to 216.8 km² in 2024.",
      "How could the overall mapped water area increase while open water in the center was still decreasing?",
      "Because the lake was not changing uniformly.",
      "Different regions were experiencing different patterns.",
      "This showed us why looking at a single measurement was not enough.",
      "To understand the lake, we needed to look both at the bigger picture and at what was happening inside it.",
    ],
  },
  {
    id: 'y2025', year: 2025, title: '2025 — A Lake Turning Greener', chip: 'Source: Sentinel-2',
    lines: [
      "Then came 2025.",
      "Sentinel-2 recorded the highest green-vegetation coverage in our annual series.",
      "21.2 km².",
      "In 2019, that number had been just 1.8 km².",
      "The expansion was impossible to ignore.",
      "And science helped explain why this pattern mattered.",
      "Research on Lake Burullus has described a relationship between aquatic vegetation and restricted water circulation.",
      "As vegetation becomes denser, it can obstruct the movement of water.",
      "Reduced circulation can then contribute to conditions that allow vegetation to persist or expand.",
      "Scientists call this the stagnation–vegetation feedback.",
      "And while our satellite observations cannot prove exactly what caused the expansion, they reveal how dramatically the visible vegetation footprint had changed.",
      "But these weren't just changes on a satellite image. They could also matter to the people living around the lake.",
    ],
  },
  {
    id: 'people', year: null, hold: 2025, title: 'Behind Every Satellite Image, There Are Real People',
    lines: [
      "Lake Burullus is more than water and vegetation.",
      "It is a source of livelihood for thousands of fishermen.",
      "And as aquatic vegetation becomes denser, fishing can become more difficult.",
      "Thick vegetation can obstruct boat movement and make it harder to reach fishing areas.",
      "In fact, these challenges have already been documented in reports about Lake Burullus.",
      "So the changes we observe from space are not just environmental measurements.",
      "They can also help us understand the challenges facing the communities that depend on the lake.",
      "And that makes monitoring the lake even more important.",
    ],
  },
  {
    id: 'y2026', year: 2026, title: '2026 — The Transformation Revealed',
    lines: [
      "Eight years after our journey began, we returned to the same lake.",
      "But the measurements told a very different story.",
      "In 2019, our satellite analysis identified 288.5 km² of mapped water.",
      "By 2026, that number had declined to 270.5 km².",
      "A net reduction of 18 km², or approximately 6.2%.",
      "In the central region, open water had decreased from 224 to 214.4 km².",
      "And green vegetation had expanded from 1.8 to 16.5 km².",
      "Almost nine times its original coverage.",
      "Although vegetation coverage in 2026 was lower than its 2025 peak, differences in satellite image availability mean we cannot call this a confirmed ecological recovery.",
      "What we can say is that the lake's visible surface had changed substantially.",
      "And now, we had a new satellite perspective to investigate it.",
    ],
  },
];

const FINAL = {
  title: "The Lake's Story Is Still Being Written",
  lines: [
    "From 2019 to 2026, we watched Lake Burullus change.",
    "We identified where mapped water declined.",
    "We observed where vegetation expanded.",
    "And we connected those changes to scientific research on water quality, wetland transformation, and circulation.",
    "But this story is bigger than satellite images.",
    "It is about an ecosystem.",
    "About the communities that depend on it.",
    "And about the importance of understanding environmental changes before their consequences become harder to manage.",
    "With AQUA SAR, we turn satellite observations into a story that people can explore, understand, and investigate.",
    "Our observations do not answer every question.",
    "But they give scientists, communities, and decision-makers a clearer picture of what changed, where it changed, and when.",
    "Because protecting our waters begins with understanding how they change.",
  ],
  tagline: "Watching our waters change, from space.",
};

/* Numbers that appear in the text above (the only ones the mini visuals may use). Years without a value are skipped. */
const WATER = { 2019: 288.5, 2020: 284, 2021: 280.7, 2022: 274.7, 2023: 271.7, 2024: 272.2, 2026: 270.5 };
const VEG = { 2019: 1.8, 2021: 2.5, 2022: 7.1, 2025: 21.2, 2026: 16.5 };
const YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

/* ================================================================ RENDER */
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** *…* / **…** -> emphasis (asterisks never shown); number + km² / % -> count-up spans. */
function fmt(text) {
  let h = esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong class="hl2">$1</strong>')
    .replace(/\*(.+?)\*/g, '<strong>$1</strong>');
  h = h.replace(/(\d+(?:\.\d+)?)(\s?(?:km²|%))/g, (m, n, u) => {
    const dec = (n.split('.')[1] || '').length;
    return `<span class="num" data-v="${n}" data-d="${dec}" data-t="${n}">${n}</span>${u}`;
  });
  return h;
}
const para = (t, i) => `<p class="rv" style="--d:${Math.min(i, 6) * 70}ms">${fmt(t)}</p>`;

function render() {
  const root = $('#story');
  const intro = `
    <section class="screen screen--intro" id="intro" data-screen="intro"><div class="card">
      <h1 class="intro__title rv in">${esc(INTRO.title)}</h1>
      ${INTRO.lines.map(para).join('')}
      <button type="button" id="begin" class="btn rv">Begin the journey <span aria-hidden="true">↓</span></button>
      <span class="scroll-cue rv">Scroll</span>
    </div></section>`;

  const chapters = CHAPTERS.map((c) => `
    <section class="chapter" id="${c.id}" data-year="${c.year ?? ''}" data-hold="${c.hold ?? ''}"><div class="card">
      ${c.chip ? `<span class="chip rv">${c.chip}</span>` : ''}
      <h2 class="ch__title rv">${c.year ? `<span class="ghost" aria-hidden="true">${c.year}</span>` : ''}${esc(c.title)}</h2>
      ${c.lines.map(para).join('')}
      ${c.sources ? `<div class="sources rv"><span>Sources:</span>${c.sources.map((s) => `<a href="${s.url}" target="_blank" rel="noopener noreferrer">${s.label}</a>`).join('')}</div>` : ''}
    </div></section>`).join('');

  const fin = `
    <section class="screen screen--final" id="final" data-screen="final"><div class="card">
      <h2 class="rv">${esc(FINAL.title)}</h2>
      ${FINAL.lines.map(para).join('')}
      <div class="wordmark rv"><img src="assets/img/logo.svg" alt=""><span>AQUA <em>SAR</em></span></div>
      <p class="tagline rv">${esc(FINAL.tagline)}</p>
      <a class="btn rv" href="data.html" id="explore-data">Explore the data</a>
    </div></section>`;

  root.innerHTML = intro + chapters + fin;

  $('#timeline-list').innerHTML = YEARS.map((y) => `<li data-y="${y}"><button type="button" aria-label="Go to ${y}"><span>${y}</span><i></i></button></li>`).join('');
}

/* ============================================================== REVEALS */
function countUp(el) {
  const end = Number(el.dataset.v), dec = Number(el.dataset.d), t0 = performance.now(), dur = 1500;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    el.textContent = p < 1 ? (end * (1 - Math.pow(1 - p, 3))).toFixed(dec) : el.dataset.t;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function initReveals() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      if (!reduced) e.target.querySelectorAll('.num').forEach(countUp);
      io.unobserve(e.target);
    });
  }, { threshold: 0.25, rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.rv:not(.in)').forEach((el) => io.observe(el));
}

/* ================================================================= STARS */
function drawStars() {
  const c = $('#stars'), dpr = Math.min(devicePixelRatio || 1, 2);
  const paint = () => {
    c.width = innerWidth * dpr; c.height = innerHeight * dpr;
    const g = c.getContext('2d'); g.scale(dpr, dpr);
    const n = Math.round((innerWidth * innerHeight) / 2200);
    for (let i = 0; i < n; i++) {
      const r = Math.random() * 1.1 + 0.2;
      g.fillStyle = `rgba(${Math.random() < 0.15 ? '170,210,255' : '255,255,255'},${0.25 + Math.random() * 0.7})`;
      g.beginPath(); g.arc(Math.random() * innerWidth, Math.random() * innerHeight, r, 0, 6.283); g.fill();
    }
  };
  paint();
  let w = innerWidth;
  addEventListener('resize', () => { if (innerWidth !== w) { w = innerWidth; paint(); } });
}

/* ================================================================= EARTH */
let earthRun = false;
async function initEarth() {
  const host = $('#earth');
  try {
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    host.append(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    camera.position.z = 5.4;
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(5, 3, 5);
    scene.add(sun);
    const pivot = new THREE.Group();
    scene.add(pivot);

    const gltf = await new GLTFLoader().loadAsync(GLOBE.modelUrl);
    const tex = await gltf.parser.getDependency('texture', 0); // earth.glb: see js/home.js for why
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0 });
    gltf.scene.traverse((o) => { if (o.isMesh) o.material = mat; });
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
    const s = 2 / Math.max(size.x, size.y, size.z);
    gltf.scene.position.sub(ctr.multiplyScalar(s));
    gltf.scene.scale.setScalar(s);
    pivot.add(gltf.scene);
    pivot.rotation.z = 0.2;

    const fit = () => {
      const w = host.clientWidth || 600;
      renderer.setSize(w, w, false);
      camera.aspect = 1; camera.updateProjectionMatrix();
    };
    fit();
    new ResizeObserver(fit).observe(host);
    earthRun = true;
    let last = performance.now();
    const loop = (t) => {
      if (!earthRun) return;
      if (!reduced) pivot.rotation.y += (t - last) * 0.00005;
      last = t;
      renderer.render(scene, camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  } catch (err) {
    console.warn('Earth model unavailable, using the CSS globe.', err);
    host.classList.add('earth--css');
  }
}

/* ================================================================== MAP */
const LAKE = { center: [30.85, 31.48], zoom: 10.2 };
let map = null, mapReady = false, atLake = false, journeyBusy = false;
const padLeft = () => (isWide() ? Math.round(innerWidth * 0.34) : 0);

function initMap() {
  if (!window.maplibregl) return;
  map = new maplibregl.Map({
    container: 'map', interactive: false, attributionControl: { compact: true },
    center: [20, 22], zoom: 1.2,
    style: {
      version: 8,
      sources: { sat: { type: 'raster', tileSize: 256, maxzoom: 18, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'] } },
      layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#02060f' } }, { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-brightness-max': 0.9 } }],
    },
  });
  map.on('load', () => { mapReady = true; if (wantYear != null) showYear(wantYear); });
  addEventListener('resize', () => map.resize());
}

const flyTo = (opts) => new Promise((res) => {
  if (reduced) { map.jumpTo({ center: opts.center, zoom: opts.zoom, padding: opts.padding }); return res(); }
  map.once('moveend', res);
  map.flyTo({ essential: true, curve: 1.5, ...opts });
});

function enterLake() {
  atLake = true;
  document.body.classList.add('is-lake');
  $('#map').classList.add('is-on');
  $('#earth').classList.add('is-gone');
  earthRun = false;
  $('#timeline').hidden = false;
  $('#mini').hidden = false;
}

/** World -> Egypt -> Nile Delta -> Burullus (MapLibre 4.x has no globe projection, so a smooth flyTo chain). */
async function journey() {
  if (journeyBusy || atLake) return;
  journeyBusy = true;
  document.body.style.overflow = 'hidden';
  $('#map').classList.add('is-on');
  $('#earth').classList.add('is-gone');
  document.body.classList.add('is-lake');
  if (map && mapReady) {
    await flyTo({ center: [30.2, 26.6], zoom: 5, duration: 3000 });
    await flyTo({ center: [31.0, 31.0], zoom: 8, duration: 2600 });
    await flyTo({ center: LAKE.center, zoom: LAKE.zoom, duration: 3000, padding: { left: padLeft() } });
  }
  enterLake();
  document.body.style.overflow = '';
  journeyBusy = false;
  $('#y2019').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}

/** User scrolled straight into the chapters without pressing the button. */
function ensureLake() {
  if (atLake || journeyBusy) return;
  enterLake();
  if (map && mapReady) map.jumpTo({ center: LAKE.center, zoom: LAKE.zoom, padding: { left: padLeft() } });
  else if (map) map.once('load', () => map.jumpTo({ center: LAKE.center, zoom: LAKE.zoom, padding: { left: padLeft() } }));
}

/* ---- layers: add the new year first, fade it in, then fade out and remove the previous one ---- */
let wantYear = null, shown = null, pending = null, seq = 0, tok = 0;
const dropLayer = (id) => { if (id && map.getLayer(id)) map.removeLayer(id); if (id && map.getSource(id)) map.removeSource(id); };

async function showYear(year) {
  wantYear = year;
  if (!map || !mapReady) return;
  const my = ++tok;
  const desc = await getTileLayer('burullus', year, 'sentinel').catch(() => null);
  if (my !== tok) return;
  if (!desc) { // tiles unavailable: no overlay, the text stays readable
    if (shown) { map.setPaintProperty(shown, 'raster-opacity', 0); const o = shown; shown = null; setTimeout(() => dropLayer(o), 900); }
    return;
  }
  dropLayer(pending);
  const id = `y-${++seq}-${desc.key}`;
  pending = id;
  map.addSource(id, { type: 'raster', tiles: [desc.url], tileSize: 256, maxzoom: 13 });
  map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': 0, 'raster-opacity-transition': { duration: 900 }, 'raster-fade-duration': 0 } });
  let done = false;
  const finish = () => {
    if (done || pending !== id) return;
    done = true; clearTimeout(timer); map.off('sourcedata', onData);
    const old = shown; shown = id; pending = null;
    map.setPaintProperty(id, 'raster-opacity', 0.85);
    if (old) { map.setPaintProperty(old, 'raster-opacity-transition', { duration: 900 }); map.setPaintProperty(old, 'raster-opacity', 0); setTimeout(() => dropLayer(old), 1000); }
  };
  const onData = (e) => { if (e.sourceId === id && map.isSourceLoaded(id)) finish(); };
  const timer = setTimeout(finish, 8000);
  map.on('sourcedata', onData);
}

let driftN = 0;
function drift() {
  if (reduced || !map || !mapReady) return;
  const z = driftN++ % 2 ? LAKE.zoom - 0.2 : LAKE.zoom + 0.35;
  map.easeTo({ zoom: z, center: [LAKE.center[0] + (driftN % 2 ? 0.02 : -0.02), LAKE.center[1]], duration: 16000, easing: (t) => t, padding: { left: padLeft() } });
}

/* ========================================================= MINI VISUALS */
const X0 = 34, X1 = 228, YT = 12, YB = 78;
const px = (y) => X0 + (YEARS.indexOf(y) / (YEARS.length - 1)) * (X1 - X0);
const WMIN = 270.5, WMAX = 288.5;
const py = (v) => YB - ((v - WMIN) / (WMAX - WMIN)) * (YB - YT);

function updateMini(year) {
  const ys = Object.keys(WATER).map(Number).filter((y) => y <= year);
  const run = ys.filter((y) => y <= 2024); // 2025 has no value in the story: the line is never drawn across it
  const d = run.map((y, i) => `${i ? 'L' : 'M'}${px(y).toFixed(1)} ${py(WATER[y]).toFixed(1)}`).join(' ');
  const cur = ys[ys.length - 1];
  const svg = $('#mini-water');
  svg.innerHTML = `
    <line x1="${X0}" y1="${YT}" x2="${X0}" y2="${YB}" stroke="rgba(159,179,217,.3)"/>
    <line x1="${X0}" y1="${YB}" x2="${X1}" y2="${YB}" stroke="rgba(159,179,217,.3)"/>
    <text x="${X0 - 4}" y="${YT + 3}" text-anchor="end">288.5</text>
    <text x="${X0 - 4}" y="${YB + 3}" text-anchor="end">270.5</text>
    <text x="${X0}" y="94" text-anchor="middle">2019</text><text x="${X1}" y="94" text-anchor="end">2026</text>
    ${d ? `<path class="ln" pathLength="1" d="${d}" style="stroke-dasharray:1;stroke-dashoffset:1"/>` : ''}
    ${ys.map((y) => `<circle class="${y === cur ? 'cur' : ''}" cx="${px(y).toFixed(1)}" cy="${py(WATER[y]).toFixed(1)}" r="${y === cur ? 3.6 : 2.4}"/>`).join('')}
    ${cur ? `<text x="${Math.min(px(cur), X1 - 8).toFixed(1)}" y="${(py(WATER[cur]) - 8).toFixed(1)}" text-anchor="middle" style="fill:#fff">${WATER[cur]}</text>` : ''}`;
  const path = svg.querySelector('.ln');
  if (path) requestAnimationFrame(() => requestAnimationFrame(() => (path.style.strokeDashoffset = '0')));

  const vy = Object.keys(VEG).map(Number).filter((y) => y <= year);
  const v = vy.length ? VEG[vy[vy.length - 1]] : 0;
  $('#mini-veg').style.width = `${(v / 21.2) * 100}%`;
  $('#mini-veg-v').textContent = v ? `${v}` : '';
}

/* ============================================================== TIMELINE */
function initChapters() {
  const items = [...document.querySelectorAll('#timeline-list li')];
  const setActive = (year) => {
    items.forEach((li) => {
      const y = Number(li.dataset.y);
      li.classList.toggle('is-active', y === year);
      li.classList.toggle('is-past', y < year);
    });
  };
  items.forEach((li) => li.querySelector('button').addEventListener('click', () => {
    ensureLake();
    $(`#y${li.dataset.y}`).scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }));

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const sec = e.target;
      if (sec.dataset.screen === 'intro') { $('#mini').hidden = true; return; }
      if (sec.dataset.screen === 'final') { $('#mini').hidden = true; return; }
      ensureLake();
      $('#mini').hidden = false;
      const year = Number(sec.dataset.year) || Number(sec.dataset.hold);
      setActive(year);
      updateMini(year);
      if (sec.dataset.year) { showYear(year); drift(); }
    });
  }, { rootMargin: '-45% 0px -45% 0px' });
  document.querySelectorAll('.chapter, .screen').forEach((s) => io.observe(s));
}

/* ================================================================= BOOT */
initPageTransition();
render();
$('#home-link').addEventListener('click', (e) => { e.preventDefault(); navigateWithFade('index.html'); });
$('#nav-home').addEventListener('click', (e) => { e.preventDefault(); navigateWithFade('index.html'); });
$('#explore-data').addEventListener('click', (e) => { e.preventDefault(); navigateWithFade('data.html'); });
$('#begin').addEventListener('click', journey);
drawStars();
initReveals();
initChapters();
initEarth();
initMap(); // the MapLibre <script defer> runs before this module
