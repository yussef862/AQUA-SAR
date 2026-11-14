/**
 * AQUA SAR — shared configuration.
 * Everything that is "content" or a "constant" lives here so it is easy to edit:
 *  - lake list used by the home-page search
 *  - colors, year range, data sources
 *  - mascot poses + the lines the mascot says
 *  - the 3 slides of the "Explore the Story" overlay
 */

/* ---------------------------------------------------------------- Backend */

/** Backend base URL (no trailing slash). Not a secret: it is the public API address.
 *  - ?api=https://...        debug override
 *  - localhost / 127.0.0.1   http://localhost:8000 ONLY with ?local=1
 *  - everything else         the deployed backend */
export const API_BASE = (() => {
  const PROD = 'https://aqua-sar-api.vercel.app';
  const q = new URLSearchParams(location.search);
  const api = q.get('api');
  if (api && /^https?:\/\//i.test(api)) return api.replace(/\/+$/, '');
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  return local && q.get('local') === '1' ? 'http://localhost:8000' : PROD;
})();

/** false -> the chat talks to the live backend (POST /chat). There is no mock chat any more. */
export const USE_MOCK = false;

/* ----------------------------------------------------------------- Colors */
/* Keep in sync with the CSS variables in css/base.css. Used by Chart.js/MapLibre. */
export const COLORS = {
  sentinel: '#22c3e6', // cyan  — Sentinel-1 archive
  nisar: '#f5b301',    // gold  — NISAR
  text: '#eef4ff',
  textDim: '#9fb3d9',
  grid: 'rgba(159,179,217,0.12)',
  water: '#2a7de1',
  vegetation: '#2fbf5b',
  land: '#c9a063',
};

/* ------------------------------------------------------------ Data sources */

export const SOURCES = {
  sentinel: { id: 'sentinel', label: 'Sentinel-1', color: COLORS.sentinel },
  nisar: { id: 'nisar', label: 'NISAR', color: COLORS.nisar },
};


/* ------------------------------------------------------------------ Lakes */
/**
 * Only ONE searchable lake exists (Burullus). Everything else = "Coming soon".
 * `aliases` are matched case-insensitively, partially, in English and Arabic.
 * (Detailed metadata + map ROI live in data/lakes.json.)
 */
export const LAKES = [
  {
    id: 'burullus',
    name: 'Lake Burullus',
    nameAr: 'بحيرة البرلس',
    blurb: 'Brackish lagoon on the Nile Delta coast',
    icon: 'wave',
    lat: 31.5,
    lon: 30.86,
    aliases: ['burullus', 'burullos', 'borollos', 'burulus', 'lake burullus', 'البرلس', 'برلس', 'بحيرة البرلس'],
  },
];

/** Typing any of these lists the available lake(s). */
export const COUNTRY_KEYWORDS = ['egypt', 'misr', 'masr', 'مصر', 'جمهورية مصر العربية'];

/* ------------------------------------------------------------- Home globe */
export const GLOBE = {
  modelUrl: 'assets/models/earth.glb',
  /** Calibration so that a real-world longitude faces the camera. */
  lonOffsetDeg: 90, // derived from the GLB's UV layout: longitude 0 sits on +X, so yaw = -(lon + 90°)
  /** +1 / -1 — flips the direction if the texture is mirrored in the model. */
  lonDirection: 1,
  autoRotateSpeed: 0.06, // rad / second
  flyDurationMs: 2000,
};

/* ----------------------------------------------------------------- Mascot */
export const MASCOT = {
  basePath: 'assets/mascot/',
  poses: {
    wave: 'wave.png',
    point: 'point.png',
    think: 'think.png',
    laptop: 'laptop.png',
    idea: 'idea.png',
    explain: 'explain.png',
    celebrate: 'celebrate.png',
    rocket: 'rocket-sit.png',
    'rocket-point': 'rocket-point.png',
    'laptop-sit': 'laptop-sit.png',
    analyze: 'analyze.png',
    music: 'music.png',
    love: 'love.png',
    fly: 'fly.png',
    back: 'back.png',
  },
  alt: {
    wave: 'Astronaut mascot waving',
    point: 'Astronaut mascot pointing',
    think: 'Astronaut mascot thinking',
    laptop: 'Astronaut mascot with a laptop and chart',
    idea: 'Astronaut mascot with a bright idea',
    explain: 'Astronaut mascot explaining with open arms',
    celebrate: 'Astronaut mascot celebrating',
    rocket: 'Astronaut mascot riding a rocket',
  },
};

/** What the mascot says on the home page. */
export const HOME_LINES = {
  welcome: 'Welcome to AQUA SAR!',
  searchHint: 'Try searching for Egypt',
  exploreHover: "Egypt's lakes are changing — radar from space lets us watch them, even through clouds.",
  noResult: "Hmm… I only know Egypt's lakes for now. Try “Egypt”!",
  welcomeMs: 4000,
  hintMs: 7000,
};
