/**
 * "Satellites over Earth": Sentinel-1 and NISAR on analytic circular orbits around a rotating Earth.
 * three.js 0.160.0 from the import map in orbits.html. No backend, no storage, no other libraries.
 * Click a satellite -> follow camera + info panel; click anywhere else / X / Esc -> back to the overview.
 * Zooming never touches the simulation: clock, orbits, trails, Earth rotation and models keep running.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { navigateWithFade, initPageTransition } from './transition.js';

/* ================================================================== CONFIG */
const R_EARTH_KM = 6371;
const MU = 398600.4418; // km^3 / s^2
const SIDEREAL_DAY_S = 86164;
const ALT_EXAGGERATION = 2.5;
const DEFAULT_SPEED = 400;
const TRAIL_ARC_DEG = 70;
const TRAIL_SEGMENTS = 120;
const EARTH_TEXTURE = 'assets/earth/earth.jpg'; // equirectangular, longitude 0 at the centre. Missing -> lat/lon grid sphere.
const EARTH_LON_OFFSET_DEG = 0; // tune if your texture is shifted in longitude

/** Per-model tuning. rotationOffset = Euler degrees [x, y, z] applied to the model inside its orbital frame
 *  (frame: +Y = away from Earth, +Z = direction of travel, so the model's "down" faces Earth's centre). */
const MODEL_CONFIG = {
  s1: { file: 'assets/models/sentinel1.glb', targetSize: 0.17, rotationOffset: [0, 0, 0] },
  nisar: { file: 'assets/models/nisar.glb', targetSize: 0.2, rotationOffset: [0, 0, 0] },
};

/** Fill in author and license for each model. */
const CREDITS = {
  s1: 'TODO: author and license of the Sentinel-1 model',
  nisar: 'TODO: author and license of the NISAR model',
  earth: 'TODO: author and license of the Earth texture',
};

const SATS = {
  s1: { name: 'Sentinel-1', color: 0x4cc9f0, altKm: 693, incDeg: 98.18, raanDeg: -12, theta0: 0.6, period: 0 },
  nisar: { name: 'NISAR', color: 0xf5c542, altKm: 747, incDeg: 98.4, raanDeg: 23, theta0: 3.4, period: 0 },
};

const BURULLUS = { lat: 31.5, lon: 30.9 };

const INFO = {
  s1: {
    title: 'Sentinel-1',
    sub: 'ESA Copernicus',
    facts: [
      'Radar: C-band SAR (about 5.4 GHz, wavelength about 5.5 cm), dual polarization VV and VH.',
      'Operator: ESA and the European Commission (Copernicus programme).',
      'Orbit: near-polar, sun-synchronous, about 693 km altitude, about 98 deg inclination, about 99 minutes per orbit, 12-day repeat cycle per satellite.',
      'Imaging mode behind our maps: Interferometric Wide swath, about 250 km wide.',
      'In AQUA SAR: the yearly Lake Burullus maps for 2019 to 2026, mapped at 10 m pixel size.',
    ],
  },
  nisar: {
    title: 'NISAR',
    sub: 'NASA-ISRO',
    facts: [
      "Radar: NASA's L-band SAR (wavelength about 24 cm), plus an S-band radar from ISRO. AQUA SAR uses the L-band data (HH and HV).",
      'Antenna: a 12 m deployable mesh reflector on a boom (the large ring in the 3D model).',
      'Orbit: near-polar, sun-synchronous, about 747 km altitude, about 98 deg inclination, about 100 minutes per orbit, 12-day repeat cycle.',
      'Swath: about 240 km wide.',
      'In AQUA SAR: the featured 2026 layer for Lake Burullus (June to October 2026), 20 m pixel spacing. It is provisional data from one season, shown beside Sentinel-1 and never subtracted from it.',
    ],
  },
};

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FLY_IN_MS = reduced ? 0 : 1400;
const FLY_OUT_MS = reduced ? 0 : 1200;
const DRAG_THRESHOLD = 5; // px: below = click, above = drag
const FOLLOW = { back: 0.6, up: 0.26, side: 0.2 }; // camera offset in the satellite's orbital frame

const $ = (s) => document.querySelector(s);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const D2R = Math.PI / 180;

/* ================================================================== ORBITS */
for (const s of Object.values(SATS)) {
  const a = R_EARTH_KM + s.altKm;
  s.period = 2 * Math.PI * Math.sqrt((a * a * a) / MU); // seconds (real altitude)
  s.r = 1 + (s.altKm / R_EARTH_KM) * ALT_EXAGGERATION; // drawn radius (exaggerated)
}

/** Orbit plane = inclination about X, then RAAN about Y. In-plane position = (r cos t, 0, -r sin t).
 *  The sign of the z term makes i = 0 an eastward (prograde) orbit for an Earth spinning about +Y (east = -Z),
 *  so inclinations above 90 degrees (Sentinel-1, NISAR) really are retrograde, as for real sun-synchronous orbits. */
function planeVec(s, x, z, out) {
  const ci = Math.cos(s.incDeg * D2R), si = Math.sin(s.incDeg * D2R);
  const y1 = -z * si, z1 = z * ci; // rotate about X by inclination (y = 0 in the plane)
  const co = Math.cos(s.raanDeg * D2R), so = Math.sin(s.raanDeg * D2R);
  return out.set(x * co + z1 * so, y1, -x * so + z1 * co); // rotate about Y by RAAN
}
const orbitPos = (s, theta, out) => planeVec(s, s.r * Math.cos(theta), -s.r * Math.sin(theta), out);
const orbitVel = (s, theta, out) => planeVec(s, -Math.sin(theta), -Math.cos(theta), out); // unit tangent (direction of travel)

/* ============================================================== SCENE SETUP */
const canvas = $('#gl');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
} catch (e) {
  $('#loading').textContent = 'WebGL is not available in this browser.';
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.setClearColor(0x02050c, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
camera.position.set(0.5, 1.5, 4.7);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 2.2;
controls.maxDistance = 9;
controls.rotateSpeed = 0.6;

scene.add(new THREE.AmbientLight(0xffffff, 0.75));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(5, 2.5, 4);
scene.add(sun);

/* stars */
{
  const n = 1400, p = new Float32Array(n * 3), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.randomDirection().multiplyScalar(60 + Math.random() * 30).toArray(p, i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 0.25, color: 0xcfe0ff, sizeAttenuation: true, depthWrite: false })));
}

/* Earth: radius 1, Y up. Group rotates (sidereal); the marker is a child so it turns with the surface. */
const earth = new THREE.Group();
scene.add(earth);
const earthMat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, color: 0xffffff });
const earthMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), earthMat);
earthMesh.rotation.y = EARTH_LON_OFFSET_DEG * D2R;
earth.add(earthMesh);

/** Dark stylized texture with a lat/lon grid (equirectangular, lon 0 at the centre). Used until / unless earth.jpg loads. */
function gridTexture() {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#071733'; g.fillRect(0, 0, c.width, c.height);
  const X = (lon) => ((lon + 180) / 360) * c.width, Y = (lat) => ((90 - lat) / 180) * c.height;
  for (let lon = -180; lon <= 180; lon += 15) { g.strokeStyle = lon === 0 ? 'rgba(120,190,255,.7)' : 'rgba(80,150,230,.3)'; g.lineWidth = lon === 0 ? 3 : 1.5; g.beginPath(); g.moveTo(X(lon), 0); g.lineTo(X(lon), c.height); g.stroke(); }
  for (let lat = -90; lat <= 90; lat += 15) { g.strokeStyle = lat === 0 ? 'rgba(120,190,255,.7)' : 'rgba(80,150,230,.3)'; g.lineWidth = lat === 0 ? 3 : 1.5; g.beginPath(); g.moveTo(0, Y(lat)); g.lineTo(c.width, Y(lat)); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
earthMat.map = gridTexture();
new THREE.TextureLoader().load(
  EARTH_TEXTURE,
  (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    earthMat.map = tex;
    earthMat.needsUpdate = true;
  },
  undefined,
  () => console.info('earth.jpg not found: showing the lat/lon grid sphere.'),
);

/* atmosphere glow (back-face fresnel) */
scene.add(
  new THREE.Mesh(
    new THREE.SphereGeometry(1.1, 64, 48),
    new THREE.ShaderMaterial({
      transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vN; void main(){ float i = pow(0.72 - dot(vN, vec3(0.0,0.0,1.0)), 3.0); gl_FragColor = vec4(0.25,0.62,1.0,1.0) * i * 1.1; }',
    }),
  ),
);

/* Lake Burullus marker (child of the Earth group): lon 0 faces +X, east is toward -Z. */
function latLonToVec(lat, lon, r = 1) {
  const la = lat * D2R, lo = lon * D2R;
  return new THREE.Vector3(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo));
}
const marker = new THREE.Group();
const markerPos = latLonToVec(BURULLUS.lat, BURULLUS.lon, 1.003);
marker.position.copy(markerPos);
marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), markerPos.clone().normalize());
marker.add(new THREE.Mesh(new THREE.SphereGeometry(0.011, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffb347 })));
const pulse = new THREE.Mesh(
  new THREE.RingGeometry(0.014, 0.019, 32),
  new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
);
marker.add(pulse);
earth.add(marker);

/* ============================================================== SATELLITES */
const labelsEl = $('#labels');
const markerLabel = document.createElement('div');
markerLabel.className = 'marker-label';
markerLabel.textContent = 'Lake Burullus';
labelsEl.append(markerLabel);

/** Simple stand-ins, used until (or instead of) the GLB. Sized so the longest side = 1 (then scaled to targetSize). */
function placeholder(key) {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0xb8c4d8, metalness: 0.5, roughness: 0.5 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x1f3f8f, metalness: 0.3, roughness: 0.4 });
  if (key === 's1') {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.36), body));
    for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.3), panel); p.position.x = sx * 0.28; g.add(p); }
  } else {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.26), body));
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 8), body); boom.position.y = 0.28; g.add(boom);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.012, 8, 40), new THREE.MeshStandardMaterial({ color: 0xe5c35a, metalness: 0.6, roughness: 0.4 }));
    ring.position.y = 0.5; ring.rotation.x = Math.PI / 2; g.add(ring);
    for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.012, 0.24), panel); p.position.set(sx * 0.26, 0, 0); g.add(p); }
  }
  return g;
}

/** Scale to targetSize (longest bounding-box side) and centre the model on its bounding box. */
function normalize(obj, targetSize) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const k = targetSize / (Math.max(size.x, size.y, size.z) || 1);
  const holder = new THREE.Group();
  obj.position.sub(c);
  const inner = new THREE.Group();
  inner.add(obj);
  inner.scale.setScalar(k);
  holder.add(inner);
  return holder;
}

const sats = {};
for (const [key, s] of Object.entries(SATS)) {
  const cfg = MODEL_CONFIG[key];
  const frame = new THREE.Group(); // positioned + oriented every frame (orbital frame)
  const slot = new THREE.Group(); // holds the model; rotationOffset applied here
  slot.rotation.set(...cfg.rotationOffset.map((d) => d * D2R));
  frame.add(slot);
  const hit = new THREE.Mesh(new THREE.SphereGeometry(cfg.targetSize, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
  hit.userData.sat = key;
  frame.add(hit);
  let current = normalize(placeholder(key), cfg.targetSize);
  slot.add(current);
  scene.add(frame);

  // faint full ring
  const ringPts = [];
  const v = new THREE.Vector3();
  for (let i = 0; i <= 256; i++) ringPts.push(orbitPos(s, (i / 256) * Math.PI * 2, v).clone());
  const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), new THREE.LineBasicMaterial({ color: s.color, transparent: true, opacity: 0.22 }));
  scene.add(ring);

  // glowing trail: two additive lines (core + soft halo), fading toward the tail
  const trail = makeTrail(s.color);
  scene.add(trail.core, trail.halo);

  const label = document.createElement('button');
  label.type = 'button';
  label.className = 'sat-label';
  label.dataset.sat = key;
  label.textContent = s.name;
  label.setAttribute('aria-label', `Follow ${s.name}`);
  labelsEl.append(label);

  sats[key] = { key, def: s, cfg, frame, slot, hit, current, trail, label, pos: new THREE.Vector3(), fwd: new THREE.Vector3(), up: new THREE.Vector3(), side: new THREE.Vector3(), theta: 0, hover: false };
}

function makeTrail(color) {
  const n = TRAIL_SEGMENTS + 1;
  const mk = (width, gain) => {
    const geo = new LineGeometry();
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) { const f = Math.pow(1 - k / (n - 1), 1.6) * gain; col.set([c.r * f, c.g * f, c.b * f], k * 3); }
    geo.setPositions(pos);
    geo.setColors(col);
    const mat = new LineMaterial({ color: 0xffffff, linewidth: width, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    mat.resolution.set(innerWidth, innerHeight);
    const line = new Line2(geo, mat);
    line.frustumCulled = false;
    return line;
  };
  return { core: mk(3, 1), halo: mk(9, 0.25), n };
}

/** Writes the analytic trail (angles theta - k*dTheta, k = 0..N) straight into the line's segment buffer. */
const tmp = new THREE.Vector3();
function updateTrail(sat, theta) {
  const { core, halo, n } = sat.trail;
  const dTheta = (TRAIL_ARC_DEG * D2R) / TRAIL_SEGMENTS;
  for (const line of [core, halo]) {
    const buf = line.geometry.attributes.instanceStart.data;
    const arr = buf.array; // interleaved [sx,sy,sz, ex,ey,ez] per segment
    let px = 0, py = 0, pz = 0;
    for (let k = 0; k < n; k++) {
      orbitPos(sat.def, theta - k * dTheta, tmp);
      if (k > 0) {
        const o = (k - 1) * 6;
        arr[o] = px; arr[o + 1] = py; arr[o + 2] = pz; arr[o + 3] = tmp.x; arr[o + 4] = tmp.y; arr[o + 5] = tmp.z;
      }
      px = tmp.x; py = tmp.y; pz = tmp.z;
    }
    buf.needsUpdate = true;
  }
}

/* GLBs: swapped in as each finishes; a failure keeps the stand-in. */
let pendingModels = Object.keys(SATS).length;
const loadingEl = $('#loading');
const doneModel = () => { if (--pendingModels <= 0) loadingEl.hidden = true; };
const loader = new GLTFLoader();
for (const sat of Object.values(sats)) {
  loader.load(
    sat.cfg.file,
    (gltf) => {
      const model = normalize(gltf.scene, sat.cfg.targetSize);
      sat.slot.remove(sat.current);
      sat.slot.add(model);
      sat.current = model;
      doneModel();
    },
    undefined,
    (err) => {
      console.warn(`${sat.cfg.file} could not be loaded; using the simple stand-in.`);
      doneModel();
    },
  );
}

/* ================================================================ SIM CLOCK */
let simT = 0; // simulated seconds, shared by Earth and both satellites
let speed = DEFAULT_SPEED;
let running = true;

$('#play').addEventListener('click', (e) => {
  running = !running;
  e.currentTarget.textContent = running ? 'Pause' : 'Play';
  e.currentTarget.setAttribute('aria-pressed', String(!running));
  e.currentTarget.setAttribute('aria-label', running ? 'Pause' : 'Play');
});
$('#speed').addEventListener('change', (e) => (speed = Number(e.target.value)));

/* ================================================== FOLLOW / OVERVIEW STATE */
const panel = $('#panel');
const panelBody = $('#panel-body');
let followKey = null; // satellite being followed (null = overview)
let saved = null; // { pos, target } of the overview camera, stored once per follow session
let tr = null; // camera transition { t0, dur, kind: 'follow' | 'overview', fromPos, fromLook, k0, k1 }
let yaw = 0, pitch = 0; // user drag offset around the followed satellite
const curLook = new THREE.Vector3(); // where the camera currently looks
const tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
let viewK = 0; // 0..1 how far the view is shifted into the free area next to the panel
let lastFocus = null;

curLook.copy(controls.target);

function shiftPx() {
  const narrow = innerWidth < 700;
  return narrow ? { x: 0, y: panel.offsetHeight / 2 } : { x: (panel.offsetWidth + 16) / 2, y: 0 };
}
function applyViewOffset() {
  if (viewK <= 0.0005) { camera.clearViewOffset(); return; }
  const s = shiftPx();
  camera.setViewOffset(innerWidth, innerHeight, s.x * viewK, s.y * viewK, innerWidth, innerHeight);
}

function fillPanel(key, instant) {
  const info = INFO[key];
  const html = `<h2>${info.title}<small>${info.sub}</small></h2>
    <ul>${info.facts.map((f) => { const i = f.indexOf(': '); return `<li><b>${f.slice(0, i)}:</b> ${f.slice(i + 2)}</li>`; }).join('')}</ul>
    <p class="panel__credits">Model credits: ${CREDITS[key]}</p>`;
  panel.dataset.sat = key;
  panel.setAttribute('aria-label', `${info.title} details`);
  if (instant || reduced) { panelBody.innerHTML = html; return; }
  panelBody.classList.add('is-fading');
  setTimeout(() => { panelBody.innerHTML = html; panelBody.classList.remove('is-fading'); }, 190);
}

function follow(key) {
  if (followKey === key) return;
  const first = !followKey;
  if (!saved) saved = { pos: camera.position.clone(), target: controls.target.clone() }; // ONCE per follow session
  controls.enabled = false;
  const now = performance.now();
  tr = { t0: now, dur: FLY_IN_MS, kind: 'follow', fromPos: camera.position.clone(), fromLook: curLook.clone(), k0: viewK, k1: 1 };
  if (!first) tr.dur = reduced ? 0 : 900; // smooth switch between satellites
  followKey = key;
  yaw = 0; pitch = 0;
  document.body.classList.add('is-following');
  Object.values(sats).forEach((s) => s.label.classList.toggle('is-active', s.key === key));
  if (first) {
    lastFocus = document.activeElement;
    fillPanel(key, true);
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
    $('#panel-close').focus({ preventScroll: true });
  } else fillPanel(key, false);
  $('#hint').textContent = 'Click anywhere else to zoom back out.';
}

function closeFollow() {
  if (!followKey) return;
  followKey = null;
  tr = { t0: performance.now(), dur: FLY_OUT_MS, kind: 'overview', fromPos: camera.position.clone(), fromLook: curLook.clone(), k0: viewK, k1: 0 };
  panel.classList.remove('is-open');
  panel.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('is-following');
  Object.values(sats).forEach((s) => s.label.classList.remove('is-active'));
  $('#hint').textContent = 'Click a satellite to follow it.';
  if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
}

/** Camera position wanted while following: behind (against the velocity), above and a little to the side. */
const offV = new THREE.Vector3(), axisV = new THREE.Vector3();
function followPose(sat, outPos, outLook) {
  offV.set(0, 0, 0)
    .addScaledVector(sat.fwd, -FOLLOW.back)
    .addScaledVector(sat.up, FOLLOW.up)
    .addScaledVector(sat.side, FOLLOW.side);
  offV.applyAxisAngle(sat.up, yaw); // drag: yaw around the satellite
  axisV.copy(sat.side).applyAxisAngle(sat.up, yaw);
  offV.applyAxisAngle(axisV, pitch); // drag: pitch
  outPos.copy(sat.pos).add(offV);
  outLook.copy(sat.pos);
}

function updateCamera(now) {
  if (!tr && !followKey) return; // overview: OrbitControls owns the camera
  const sat = followKey ? sats[followKey] : null;
  let u = 1;
  if (tr) {
    u = tr.dur > 0 ? Math.min(1, (now - tr.t0) / tr.dur) : 1;
    const e = ease(u);
    viewK = tr.k0 + (tr.k1 - tr.k0) * e;
    if (tr.kind === 'follow') {
      followPose(sat, tmpB, tmpC); // moving target: the blend always aims at where the satellite is now
      camera.position.lerpVectors(tr.fromPos, tmpB, e);
      curLook.lerpVectors(tr.fromLook, tmpC, e);
    } else {
      camera.position.lerpVectors(tr.fromPos, saved.pos, e);
      curLook.lerpVectors(tr.fromLook, saved.target, e);
    }
    camera.lookAt(curLook);
    if (u >= 1) {
      if (tr.kind === 'overview') {
        controls.target.copy(saved.target);
        camera.position.copy(saved.pos);
        controls.enabled = true;
        controls.update();
        saved = null;
        viewK = 0;
      }
      tr = null;
    }
  } else if (sat) {
    followPose(sat, camera.position, curLook);
    camera.lookAt(curLook);
    viewK = 1;
  }
  if (!followKey && !tr) curLook.copy(controls.target);
  applyViewOffset();
}

/* ============================================================ POINTER INPUT */
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const hitMeshes = Object.values(sats).map((s) => s.hit);
function pick(clientX, clientY) {
  ndc.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const h = raycaster.intersectObjects(hitMeshes, false)[0];
  return h ? h.object.userData.sat : null;
}

let down = null; // { x, y, moved, id }
const pointers = new Set();
let hoverKey = null;
const setHover = (key) => {
  if (key === hoverKey) return;
  hoverKey = key;
  canvas.classList.toggle('is-hover', !!key);
  for (const s of Object.values(sats)) {
    const on = s.key === key;
    s.hover = on;
    s.label.classList.toggle('is-hover', on);
  }
};

canvas.addEventListener('pointerdown', (e) => {
  pointers.add(e.pointerId);
  down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: pointers.size > 1 };
});
canvas.addEventListener('pointermove', (e) => {
  if (!down) {
    if (e.pointerType === 'mouse') setHover(pick(e.clientX, e.clientY));
    return;
  }
  if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_THRESHOLD) down.moved = true;
  if (followKey && down.moved && pointers.size === 1) { // dragging while following turns the camera around the satellite
    yaw -= (e.clientX - down.lx) * 0.006;
    pitch = Math.max(-1.2, Math.min(1.2, pitch + (e.clientY - down.ly) * 0.006));
  }
  down.lx = e.clientX; down.ly = e.clientY;
});
const endPointer = (e, cancelled) => {
  pointers.delete(e.pointerId);
  if (!down) return;
  const wasClick = !cancelled && !down.moved && pointers.size === 0;
  if (pointers.size === 0) down = null;
  if (!wasClick) return;
  const key = pick(e.clientX, e.clientY);
  if (key) follow(key);
  else closeFollow(); // empty space: closes when following, does nothing in the overview
};
canvas.addEventListener('pointerup', (e) => endPointer(e, false));
canvas.addEventListener('pointercancel', (e) => endPointer(e, true));
canvas.addEventListener('pointerleave', () => !down && setHover(null));

/* labels and the panel are UI: label click follows (and switches), X and Esc close */
for (const s of Object.values(sats)) {
  s.label.addEventListener('click', () => follow(s.key));
  s.label.addEventListener('pointerenter', () => setHover(s.key));
  s.label.addEventListener('pointerleave', () => setHover(null));
}
$('#panel-close').addEventListener('click', closeFollow);
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFollow(); });

/* ================================================================== LOOP */
const clock = { last: 0 };
const worldP = new THREE.Vector3();
const M = new THREE.Matrix4();
const camDir = new THREE.Vector3();

function project(el, world, hide) {
  tmpC.copy(world).project(camera);
  const x = (tmpC.x * 0.5 + 0.5) * innerWidth, y = (-tmpC.y * 0.5 + 0.5) * innerHeight;
  el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(10px, -50%)`;
  el.classList.toggle('is-hidden', hide || tmpC.z > 1);
}

/** Is point `p` hidden behind the Earth (unit sphere) as seen from the camera? */
function occluded(p) {
  camDir.copy(p).sub(camera.position);
  const dist = camDir.length();
  camDir.divideScalar(dist);
  const b = camera.position.dot(camDir);
  const c = camera.position.lengthSq() - 1;
  const disc = b * b - c;
  if (disc < 0) return false;
  const t = -b - Math.sqrt(disc);
  return t > 0 && t < dist;
}

function frame(nowMs) {
  const dt = Math.min((nowMs - clock.last) / 1000, 0.1);
  clock.last = nowMs;
  if (running) simT += dt * speed;

  earth.rotation.y = (2 * Math.PI * simT) / SIDEREAL_DAY_S;

  for (const sat of Object.values(sats)) {
    const s = sat.def;
    sat.theta = s.theta0 + (2 * Math.PI * simT) / s.period;
    orbitPos(s, sat.theta, sat.pos);
    orbitVel(s, sat.theta, sat.fwd);
    sat.up.copy(sat.pos).normalize(); // away from Earth: the model's "down" side faces the centre
    sat.side.crossVectors(sat.up, sat.fwd).normalize(); // = Y x Z
    M.makeBasis(sat.side, sat.up, sat.fwd);
    sat.frame.position.copy(sat.pos);
    sat.frame.quaternion.setFromRotationMatrix(M);
    sat.frame.scale.setScalar(sat.hover ? 1.18 : 1);
    updateTrail(sat, sat.theta);
  }

  if (!reduced) {
    const p = (nowMs / 1400) % 1;
    pulse.scale.setScalar(1 + p * 2.6);
    pulse.material.opacity = 0.8 * (1 - p);
  }

  if (!tr && !followKey) controls.update();
  updateCamera(nowMs);
  camera.updateMatrixWorld();

  for (const sat of Object.values(sats)) project(sat.label, sat.pos, occluded(sat.pos));
  marker.getWorldPosition(worldP);
  const facing = worldP.clone().normalize().dot(camera.position.clone().sub(worldP).normalize()) > 0;
  project(markerLabel, worldP, !facing);

  renderer.render(scene, camera);
}

let raf = 0;
function tick(t) {
  frame(t);
  raf = requestAnimationFrame(tick);
}
function start() { clock.last = performance.now(); raf = requestAnimationFrame(tick); }
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else if (!raf) start();
});

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  for (const s of Object.values(sats)) { s.trail.core.material.resolution.set(w, h); s.trail.halo.material.resolution.set(w, h); }
  if (viewK > 0) applyViewOffset();
}
addEventListener('resize', resize);
resize();

initPageTransition();
for (const [id, href] of [['#home-link', 'index.html'], ['#nav-home', 'index.html'], ['#nav-story', 'story.html'], ['#nav-data', 'data.html']]) {
  $(id).addEventListener('click', (e) => { e.preventDefault(); navigateWithFade(href); });
}
start();
