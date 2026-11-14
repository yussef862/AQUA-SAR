/**
 * Sentinel-1 and NISAR orbiting the home-page Earth (added to the existing globe scene by js/home.js).
 * Circular orbits computed analytically from real orbital elements, glowing analytic trails, faint orbit rings,
 * HTML labels that follow the satellites. Satellites can be picked (click / tap / label button); picking and the
 * camera follow live in js/home.js, the info window in js/satellite-panel.js. No backend, no storage.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

/* ================================================================== CONFIG */
const R_EARTH_KM = 6371;
const MU = 398600.4418; // km^3 / s^2
const ALT_EXAGGERATION = 2; // altitudes are drawn exaggerated (kept modest so the orbits fit around the hero globe)
const SPEED = 400; // x real time -> one orbit takes about 15 s
const TRAIL_ARC_DEG = 70;
const TRAIL_SEGMENTS = 120;

/** Per-model tuning. rotationOffset = Euler degrees [x, y, z] inside the orbital frame
 *  (+Y = away from Earth, +Z = direction of travel, so the model's "down" side faces Earth's centre). */
const MODEL_CONFIG = {
  s1: { file: 'assets/models/sentinel1.glb', targetSize: 0.15, rotationOffset: [0, 0, 0] },
  nisar: { file: 'assets/models/nisar.glb', targetSize: 0.18, rotationOffset: [0, 0, 0] },
};

/** Fill in author and license for each model. */
export const CREDITS = {
  s1: 'TODO: author and license of the Sentinel-1 model',
  nisar: 'TODO: author and license of the NISAR model',
};

const SATS = {
  s1: { name: 'Sentinel-1', color: 0x4cc9f0, altKm: 693, incDeg: 98.18, raanDeg: 20, theta0: 0.6 },
  nisar: { name: 'NISAR', color: 0xf5c542, altKm: 747, incDeg: 98.4, raanDeg: 55, theta0: 3.4 },
};

const D2R = Math.PI / 180;

for (const s of Object.values(SATS)) {
  const a = R_EARTH_KM + s.altKm;
  s.period = 2 * Math.PI * Math.sqrt((a * a * a) / MU); // seconds, from the real altitude
  s.r = 1 + (s.altKm / R_EARTH_KM) * ALT_EXAGGERATION; // drawn radius (exaggerated)
}

/** Orbit plane = inclination about X, then RAAN about Y. In-plane position = (r cos t, 0, -r sin t):
 *  the minus sign makes i = 0 eastward for an Earth spinning about +Y, so i > 90 deg is retrograde. */
function planeVec(s, x, z, out) {
  const ci = Math.cos(s.incDeg * D2R), si = Math.sin(s.incDeg * D2R);
  const y1 = -z * si, z1 = z * ci;
  const co = Math.cos(s.raanDeg * D2R), so = Math.sin(s.raanDeg * D2R);
  return out.set(x * co + z1 * so, y1, -x * so + z1 * co);
}
const orbitPos = (s, t, out) => planeVec(s, s.r * Math.cos(t), -s.r * Math.sin(t), out);
const orbitVel = (s, t, out) => planeVec(s, -Math.sin(t), -Math.cos(t), out);

/* ================================================================ BUILDERS */
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

/** Centre on the bounding box and scale so the longest side = targetSize. */
function normalize(obj, targetSize) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const k = targetSize / (Math.max(size.x, size.y, size.z) || 1);
  obj.position.sub(c);
  const inner = new THREE.Group();
  inner.add(obj);
  inner.scale.setScalar(k);
  const holder = new THREE.Group();
  holder.add(inner);
  return holder;
}

function makeTrail(color) {
  const n = TRAIL_SEGMENTS + 1;
  const mk = (width, gain) => {
    const geo = new LineGeometry();
    const col = new Float32Array(n * 3);
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) { const f = Math.pow(1 - k / (n - 1), 1.6) * gain; col.set([c.r * f, c.g * f, c.b * f], k * 3); }
    geo.setPositions(new Float32Array(n * 3));
    geo.setColors(col);
    const mat = new LineMaterial({ color: 0xffffff, linewidth: width, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const line = new Line2(geo, mat);
    line.frustumCulled = false;
    return line;
  };
  return { core: mk(3, 1), halo: mk(9, 0.25), n };
}

const tmp = new THREE.Vector3();
/** Analytic trail: angles theta - k*dTheta written straight into the line segment buffers (frame-rate independent). */
function updateTrail(sat, theta) {
  const { core, halo, n } = sat.trail;
  const dTheta = (TRAIL_ARC_DEG * D2R) / TRAIL_SEGMENTS;
  for (const line of [core, halo]) {
    const buf = line.geometry.attributes.instanceStart.data;
    const arr = buf.array;
    let px = 0, py = 0, pz = 0;
    for (let k = 0; k < n; k++) {
      orbitPos(sat.def, theta - k * dTheta, tmp);
      if (k > 0) { const o = (k - 1) * 6; arr[o] = px; arr[o + 1] = py; arr[o + 2] = pz; arr[o + 3] = tmp.x; arr[o + 4] = tmp.y; arr[o + 5] = tmp.z; }
      px = tmp.x; py = tmp.y; pz = tmp.z;
    }
    buf.needsUpdate = true;
  }
}

/* ============================================================== PUBLIC API */
/**
 * @param {{scene: THREE.Scene, camera: THREE.Camera, container: HTMLElement}} o
 * @returns {{ update(dt:number, w:number, h:number): void, resize(w:number, h:number): void, setVisible(v:boolean): void }}
 */
export function createSatellites({ scene, camera, container, onSelect, onHover }) {
  const root = new THREE.Group();
  scene.add(root);
  const labelsEl = document.createElement('div');
  labelsEl.className = 'sat-tags';
  container.append(labelsEl);

  const sats = {};
  for (const [key, def] of Object.entries(SATS)) {
    const cfg = MODEL_CONFIG[key];
    const frame = new THREE.Group();
    const slot = new THREE.Group();
    slot.rotation.set(...cfg.rotationOffset.map((d) => d * D2R));
    frame.add(slot);
    let current = normalize(placeholder(key), cfg.targetSize);
    slot.add(current);
    root.add(frame);

    const pts = [];
    const v = new THREE.Vector3();
    for (let i = 0; i <= 256; i++) pts.push(orbitPos(def, (i / 256) * Math.PI * 2, v).clone());
    root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: def.color, transparent: true, opacity: 0.22 })));

    const trail = makeTrail(def.color);
    root.add(trail.core, trail.halo);

    const tag = document.createElement('button');
    tag.type = 'button';
    tag.className = 'sat-tag';
    tag.dataset.sat = key;
    tag.textContent = def.name;
    tag.setAttribute('aria-label', `${def.name} satellite: show details`);
    tag.addEventListener('click', () => onSelect?.(key));
    tag.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && onHover?.(key));
    tag.addEventListener('pointerleave', () => onHover?.(null));
    labelsEl.append(tag);

    sats[key] = { key, def, cfg, frame, slot, current, trail, tag, sx: -1e4, sy: -1e4, hidden: true, pos: new THREE.Vector3(), fwd: new THREE.Vector3(), up: new THREE.Vector3(), side: new THREE.Vector3() };
  }

  // GLBs are swapped in as each finishes loading; a failure keeps the simple stand-in
  const loader = new GLTFLoader();
  for (const sat of Object.values(sats)) {
    loader.load(
      sat.cfg.file,
      (gltf) => {
        const model = normalize(gltf.scene, sat.cfg.targetSize);
        sat.slot.remove(sat.current);
        sat.slot.add(model);
        sat.current = model;
      },
      undefined,
      () => console.warn(`${sat.cfg.file} could not be loaded; using the simple stand-in.`),
    );
  }

  let simT = 0;
  let visible = true;
  let timeScale = 1; // eased towards slowTarget: orbits slow down while a satellite is hovered or followed
  let slowTarget = 1;
  let focusKey = null;
  let hoverKey = null;
  const M = new THREE.Matrix4();
  const dir = new THREE.Vector3();
  const proj = new THREE.Vector3();

  /** Behind the Earth (unit sphere at the origin) as seen from the camera? */
  function occluded(p) {
    dir.copy(p).sub(camera.position);
    const dist = dir.length();
    dir.divideScalar(dist);
    const b = camera.position.dot(dir);
    const disc = b * b - (camera.position.lengthSq() - 1);
    if (disc < 0) return false;
    const t = -b - Math.sqrt(disc);
    return t > 0 && t < dist;
  }

  return {
    keys: Object.keys(sats),
    /** Live pose of a satellite (vectors are updated every frame): pos, up (away from Earth), fwd (travel), side. */
    frameOf: (key) => sats[key],
    setSlow(on) { slowTarget = on ? 0.12 : 1; },
    setFocus(key) { focusKey = key; },
    setHover(key) { hoverKey = key; },
    /** Nearest visible satellite within `radius` px of (px, py) in container coordinates, or null. */
    pick(px, py, radius) {
      if (!visible) return null;
      let best = null;
      let bd = radius * radius;
      for (const s of Object.values(sats)) {
        if (s.hidden) continue;
        const dx = s.sx - px, dy = s.sy - py, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = s.key; }
      }
      return best;
    },
    setVisible(v) {
      visible = v;
      root.visible = v;
      labelsEl.style.visibility = v ? '' : 'hidden';
      labelsEl.style.opacity = v ? '1' : '0';
    },
    resize(w, h) {
      for (const s of Object.values(sats)) { s.trail.core.material.resolution.set(w, h); s.trail.halo.material.resolution.set(w, h); }
    },
    /** Advance the orbits (call before the camera is placed). */
    step(dt) {
      timeScale += (slowTarget - timeScale) * (1 - Math.exp(-dt * 5));
      simT += dt * SPEED * timeScale;
      for (const sat of Object.values(sats)) {
        const s = sat.def;
        const theta = s.theta0 + (2 * Math.PI * simT) / s.period;
        orbitPos(s, theta, sat.pos);
        orbitVel(s, theta, sat.fwd);
        sat.up.copy(sat.pos).normalize(); // away from Earth: the model's "down" side faces the centre
        sat.side.crossVectors(sat.up, sat.fwd).normalize();
        M.makeBasis(sat.side, sat.up, sat.fwd);
        sat.frame.position.copy(sat.pos);
        sat.frame.quaternion.setFromRotationMatrix(M);
        updateTrail(sat, theta);
      }
    },
    /** Screen positions + labels (call after the camera is placed for this frame). */
    project(w, h) {
      for (const sat of Object.values(sats)) {
        proj.copy(sat.pos).project(camera);
        sat.sx = (proj.x * 0.5 + 0.5) * w;
        sat.sy = (-proj.y * 0.5 + 0.5) * h;
        sat.hidden = occluded(sat.pos) || proj.z > 1;
        if (visible) {
          sat.tag.style.transform = `translate(${sat.sx.toFixed(1)}px, ${sat.sy.toFixed(1)}px) translate(12px, -50%)`;
          sat.tag.classList.toggle('is-hidden', sat.hidden || sat.key === focusKey);
          sat.tag.classList.toggle('is-hover', sat.key === hoverKey);
        }
      }
    },
    update(dt, w, h) { this.step(dt); this.project(w, h); },
  };
}
