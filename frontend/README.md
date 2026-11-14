# AQUA SAR

NASA Space Apps Challenge 2026 (Cairo) — a 2-page web app for exploring Egypt's lakes with SAR satellites
(Sentinel-1 archive 2015–2025, NISAR 2026). Vanilla HTML / CSS / JS (ES modules), **no build step**.

## Run

ES modules and `fetch()` need a web server (not `file://`):

```bash
cd aqua-sar
npx serve .          # or: python3 -m http.server 8080
```

Open the printed URL. Internet access is needed for the CDN libraries (Three.js, MapLibre GL JS, Chart.js,
Google Fonts) and the Esri satellite base map.

## Structure

```
index.html            home: 3D Earth, search, "Explore the Story" card
story.html            story page (placeholder — content to be added)
data.html             data page: map, timeline, results, chat
css/                  base (variables, utilities) · home · data · mascot
js/config.js          lakes, colors, year range, mascot lines, story slides  <- edit text here
js/api.js             ALL data access (mock now, FastAPI later)
js/home.js            globe, search logic, story overlay, mascot sequence
js/satellites.js      Sentinel-1 + NISAR orbiting the home globe (analytic orbits, trails, labels; models in assets/models)
js/satellite-panel.js info window that opens when a satellite is clicked (camera follows it)
js/satellite-info.js  text of that window (edit wording here)
js/data.js            map, timeline, table/chart, chat panel
js/mascot.js          reusable mascot: show(pose, text, {position}) / hide()
js/transition.js      page fade helper (small extra module shared by both pages)
data/lakes.json       lake metadata, map centre/zoom, placeholder outline, reference text
data/burullus_yearly.json  REAL yearly water / vegetation / land areas (Sentinel-1 2019-2026 + NISAR 2026)
js/lakeData.js        getLakeData(): the single source of every measurement (+ core / sensor table builders)
js/chips.js           suggestion chips Q02-Q25 (question text + topic only); answers come from POST /chat
assets/models/earth.glb   3D Earth (CC BY 4.0, "Earth" by Akshat, Sketchfab)
assets/mascot/        15 transparent PNG poses cropped from mascot-sheet.png
assets/img/           logo, reference screenshots
```

Mascot poses: `wave point think laptop idea explain celebrate rocket rocket-point laptop-sit analyze music love fly back`
(mapping in `js/config.js`).

## Search rules (home)

Only one lake exists. "Egypt", "Burullus", `البرلس` (case-insensitive, partial, Arabic and
English) list it; selecting one rotates and zooms the globe (~2 s), fades to dark and opens
`data.html?lake=burullus`. **Anything else shows a single "Coming soon" row** and nothing else.
Keyboard: ↑ ↓ Enter Esc; `/` focuses the search.

## Mock data -> real FastAPI backend

Everything the UI shows comes from five functions in `js/api.js`. Today they read `data/*.json` and fake latency.
To go live set in `js/config.js`:

```js
export const API_BASE_URL = 'https://your-backend/api';
export const USE_MOCK = false;
```

Each function already has its real-backend branch. The contract it expects:

| Function | Request | Response |
|---|---|---|
| `getLakes()` | `GET /lakes` | `[lake]` |
| `getLakeInfo(lake)` | `GET /lakes/{id}` | `{id,name,nameAr,center:[lon,lat],zoom,location,summary,history,reference:{label,items:[{topic,text}]}}` |
| `getAnalysis(lake,start,end)` | `GET /analysis?lake=&start=&end=` | `{lake,startYear,endYear,unit,mock,rows:[{year,areaKm2,pctChange,source,uncertaintyKm2}],trend:{slope,band,points:[{year,value,lo,hi}]}\|null}` — `source` is `"Sentinel-1"` or `"NISAR"` |
| `getTileLayer(lake,year,source)` | `GET /tiles/{lake}/{year}/{source}/{z}/{x}/{y}.png` | descriptor `{kind:'xyz',tiles:[...],tileSize,opacity}` |
| `sendChat(lake,message,context)` | `POST /chat` `{lake,message,context:{year}}` | `{text,pose,blocks:[{type:'table'\|'chart',analysis}],suggestions?}` |

`getTileLayer()` is the marked plug-in point for real water-mask tiles; until then it returns a placeholder outline
(`kind: 'placeholder-geojson'`) that is only a rough hand-drawn shape scaled by the mock area.
The chat's `pose` is one of `wave | laptop | explain | think`.

## Honesty notes

* All measurements come from `data/burullus_yearly.json` through `getLakeData()` in `js/lakeData.js` (swap for `GET /lakes/burullus` by setting `USE_MOCK = false`; the static file is the fallback).
* Salinity / soil / fish-farm text is labelled *reference (from published research)* — general descriptions, **not**
  model-measured. Verify and cite before publishing.
* NISAR (2026) is a different sensor from the Sentinel-1 archive; the UI notes that 2025→2026 is not like-for-like.
* NASA / Space Apps logos are placeholders until you add the official files to `assets/img/`.

## Credits

3D model "Earth" by Akshat — <https://sketchfab.com/3d-models/earth-41fc80d85dfd480281f21b74b2de2faa> — CC BY 4.0.
Base imagery © Esri, Maxar, Earthstar Geographics. Mascot artwork: AQUA SAR team.

## Calibrating the globe

If Egypt does not face the camera after selecting a lake, adjust `GLOBE.lonOffsetDeg` (and `lonDirection` = `1` / `-1`)
in `js/config.js`. This depends on how the texture is mapped in `earth.glb`.
