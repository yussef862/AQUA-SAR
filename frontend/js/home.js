/**
 * HOME page: starfield, 3D globe (Three.js + assets/models/earth.glb), search, Explore card,
 * mascot sequence and the page transition to data.html.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LAKES, COUNTRY_KEYWORDS, GLOBE, HOME_LINES } from './config.js';
import * as mascot from './mascot.js';
import { createSatellites } from './satellites.js';
import { createSatellitePanel } from './satellite-panel.js';
import { initPageTransition, startFade, navigateWithFade } from './transition.js';

const $ = (sel) => document.querySelector(sel);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const deg = (d) => (d * Math.PI) / 180;
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

/* ==========================================================================
   Starfield (2D canvas, subtle twinkle)
   ========================================================================== */
function initStars() {
  const canvas = $('#stars');
  const ctx = canvas.getContext('2d');
  let stars = [];
  let w = 0;
  let h = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round((w * h) / 1800);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() ** 3 * 1.9 + 0.4,
      phase: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 1.4,
      blue: Math.random() < 0.12,
    }));
    draw(0);
  }

  function draw(t) {
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      const a = reduced.matches ? 0.8 : 0.6 + 0.4 * Math.sin(t * 0.001 * s.speed + s.phase) ** 2;
      ctx.globalAlpha = a;
      ctx.fillStyle = s.blue ? '#7fb8ff' : '#ffffff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function loop(t) {
    draw(t);
    requestAnimationFrame(loop);
  }

  window.addEventListener('resize', resize);
  resize();
  if (!reduced.matches) requestAnimationFrame(loop);
}

/* ==========================================================================
   Globe
   ========================================================================== */
class Globe {
  constructor(container) {
    this.el = container;
    this.pitch = deg(18);
    this.yaw = deg(-20);
    this.vel = { yaw: 0, pitch: 0 };
    this.dragging = false;
    this.lastInteraction = -1e9;
    this.flying = false;
    this.layout = { cx: 0.5, cy: 0.5, dist: 5 }; // globe centre as a fraction of the viewport + camera distance
    this.fly = null;
    this.ready = false;
    this.focusKey = null; // satellite the camera is following (null = normal globe view)
    this.follow = null; // camera blend state: { phase: 'in' | 'track' | 'out', ... } (null = home camera)
    this.pointer = { x: 0, y: 0, active: false, type: 'mouse' };
    this.tagHover = null;
    this.hoverKey = null;
    this.down = null;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.el.prepend(this.renderer.domElement);

    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
    this.addLights();
    this.addAtmosphere();
    this.sats = createSatellites({
      scene: this.scene,
      camera: this.camera,
      container: this.el,
      onSelect: (key) => this.focusSatellite(key),
      onHover: (key) => (this.tagHover = key),
    }); // Sentinel-1 + NISAR orbiting (click one to follow it)
    this.bindPointer();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  addLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const sun = new THREE.DirectionalLight(0xfff3e0, 1.8);
    sun.position.set(-4, 2.5, 5);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x4aa8ff, 0.8);
    rim.position.set(4, -1, -3);
    this.scene.add(rim);
  }

  /** Fresnel rim glow (inside the limb) + soft halo (outside). */
  addAtmosphere() {
    const vert = `varying vec3 vN; varying vec3 vV;
      void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
    const rimFrag = `varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0 - max(dot(vN, vV), 0.0), 3.0); gl_FragColor = vec4(0.18, 0.55, 1.0, 1.0) * f * 1.25; }`;
    const haloFrag = `varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(max(0.62 - dot(vN, vec3(0.0,0.0,1.0)), 0.0), 3.0); gl_FragColor = vec4(0.2, 0.6, 1.0, 1.0) * f * 2.2; }`;
    const mk = (frag, radius, side) =>
      new THREE.Mesh(
        new THREE.SphereGeometry(radius, 96, 96),
        new THREE.ShaderMaterial({
          vertexShader: vert,
          fragmentShader: frag,
          side,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
        }),
      );
    this.scene.add(mk(rimFrag, 1.012, THREE.FrontSide));
    this.scene.add(mk(haloFrag, 1.16, THREE.BackSide));
  }

  /** Load the GLB, normalise it to radius 1. */
  async load(onProgress) {
    const gltf = await new GLTFLoader().loadAsync(GLOBE.modelUrl, (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    });
    const model = gltf.scene;
    // earth.glb uses KHR_materials_pbrSpecularGlossiness, which current three.js ignores (-> blank white sphere).
    // Fetch the embedded texture ourselves and apply a standard material.
    const tex = await gltf.parser.getDependency('texture', 0);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const earthMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0 });
    model.traverse((o) => {
      if (o.isMesh) o.material = earthMat;
    });
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = 2 / Math.max(size.x, size.y, size.z);
    model.position.sub(center.multiplyScalar(s));
    model.scale.setScalar(s);
    this.pivot.add(model);
    this.ready = true;
    this.el.classList.add('is-ready');
  }

  resize() {
    const w = this.el.clientWidth || window.innerWidth;
    const h = this.el.clientHeight || window.innerHeight;
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    this.sats?.resize(w, h);
    this.camera.aspect = w / h;
    // base layout: centre-left on desktop, upper-centre on narrow screens
    const narrow = w <= 900;
    const lay = this.focusKey ? this.focusLayout() : this.homeLayout();
    this.layout.cx = lay.cx;
    this.layout.cy = lay.cy;
    const diameterFrac = narrow ? 0.78 : 0.68; // of min(h, w)
    // globe diameter in px = diameterFrac * min(w, h)  ->  visible height at the globe's distance
    const visibleH = (2 * h) / (diameterFrac * Math.min(w, h));
    this.baseDist = visibleH / (2 * Math.tan(deg(this.camera.fov / 2)));
    if (!this.fly) this.layout.dist = this.baseDist;
    this.applyView();
  }

  applyView() {
    const { cx, cy, dist } = this.layout;
    if (!this.follow) {
      this.camera.position.set(0, 0, dist);
      this.camera.quaternion.identity();
    }
    this.camera.setViewOffset(this.w, this.h, this.w / 2 - cx * this.w, this.h / 2 - cy * this.h, this.w, this.h);
    this.camera.updateProjectionMatrix();
  }

  bindPointer() {
    const el = this.el;
    let lastX = 0;
    let lastY = 0;
    const local = (e) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest?.('.sat-tag')) return; // satellite labels are their own buttons
      if (this.flying || this.focusKey) return;
      this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
      this.dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
      el.classList.add('is-dragging');
    });
    el.addEventListener('pointermove', (e) => {
      Object.assign(this.pointer, local(e), { active: e.pointerType === 'mouse', type: e.pointerType });
      if (!this.dragging) return;
      const k = 0.0052;
      const dx = (e.clientX - lastX) * k;
      const dy = (e.clientY - lastY) * k;
      lastX = e.clientX;
      lastY = e.clientY;
      this.yaw += dx;
      this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch + dy));
      this.vel.yaw = dx * 60;
      this.vel.pitch = dy * 60;
      this.lastInteraction = performance.now();
    });
    const end = () => {
      this.dragging = false;
      el.classList.remove('is-dragging');
      this.lastInteraction = performance.now();
    };
    el.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      end();
      // a short press without dragging = click: did it land on a satellite?
      if (d && !this.flying && !this.focusKey && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 7 && performance.now() - d.t < 600) {
        const p = local(e);
        const key = this.sats.pick(p.x, p.y, e.pointerType === 'mouse' ? 30 : 46);
        if (key) this.focusSatellite(key);
      }
    });
    el.addEventListener('pointercancel', () => {
      this.down = null;
      end();
    });
    el.addEventListener('pointerleave', () => (this.pointer.active = false));
  }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.fly) {
      this.stepFly(performance.now());
    } else if (!this.dragging) {
      // inertia, then slow auto-rotation after 2 s of inactivity
      this.yaw += this.vel.yaw * dt;
      this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch + this.vel.pitch * dt));
      const damp = Math.pow(0.04, dt);
      this.vel.yaw *= damp;
      this.vel.pitch *= damp;
      if (!reduced.matches && performance.now() - this.lastInteraction > 2000) {
        this.yaw += GLOBE.autoRotateSpeed * dt;
      }
    }
    this.pivot.rotation.set(this.pitch, this.yaw, 0);
    this.sats.setVisible(!this.flying); // satellites step aside while the camera flies to a lake
    this.sats.step(dt);
    if (this.follow) this.stepFollow(performance.now(), dt);
    this.sats.project(this.w, this.h);
    this.updateHover();
    this.renderer.render(this.scene, this.camera);
  }

  /* ------------------------------------------------------------------ satellite focus */
  homeLayout() {
    return { cx: 0.5, cy: this.w <= 900 ? 0.4 : 0.5 };
  }

  /** Where the followed satellite sits on screen: left of the info window (desktop) or above it (phones). */
  focusLayout() {
    if (this.w <= 900) return { cx: 0.5, cy: 0.27 };
    return { cx: Math.max(0.3, (this.w - 410) / (2 * this.w)), cy: 0.5 };
  }

  /** Slow the orbits and show a pointer cursor while the mouse is over a satellite. */
  updateHover() {
    let key = null;
    if (!this.flying && !this.focusKey && !this.dragging) {
      if (this.pointer.active) key = this.sats.pick(this.pointer.x, this.pointer.y, 30);
      key = key || this.tagHover;
    }
    if (key !== this.hoverKey) {
      this.hoverKey = key;
      this.sats.setHover(key);
      this.el.classList.toggle('is-sat-hover', !!key);
    }
    this.sats.setSlow(!!(key || this.focusKey));
  }

  /** Fly the camera to a satellite and keep following it; the info window opens through the 'satellite-focus' event. */
  focusSatellite(key) {
    if (this.flying || this.focusKey === key || !this.sats.frameOf(key)) return;
    const switching = !!this.focusKey;
    this.focusKey = key;
    this.vel = { yaw: 0, pitch: 0 };
    this.dragging = false;
    this.el.classList.remove('is-dragging', 'is-sat-hover');
    this.hoverKey = null;
    this.follow = {
      phase: 'in',
      t0: performance.now(),
      ms: reduced.matches ? 1 : 1500,
      fromPos: this.camera.position.clone(),
      fromQuat: this.camera.quaternion.clone(),
      fromCx: this.layout.cx,
      fromCy: this.layout.cy,
    };
    this.sats.setFocus(key);
    this.el.dispatchEvent(new CustomEvent('satellite-focus', { detail: { key, switching } }));
  }

  /** Leave the satellite and glide back to the normal globe view. */
  blurSatellite() {
    if (!this.focusKey) return;
    this.focusKey = null;
    this.follow = {
      phase: 'out',
      t0: performance.now(),
      ms: reduced.matches ? 1 : 1300,
      fromPos: this.camera.position.clone(),
      fromQuat: this.camera.quaternion.clone(),
      fromCx: this.layout.cx,
      fromCy: this.layout.cy,
    };
    this.sats.setFocus(null);
    this.el.dispatchEvent(new CustomEvent('satellite-blur'));
  }

  stepFollow(now, dt) {
    const f = this.follow;
    let toPos;
    let toQuat;
    let to;
    if (f.phase === 'out') {
      toPos = _v.set(0, 0, this.baseDist);
      toQuat = _q.identity();
      to = this.homeLayout();
    } else {
      // chase pose: a bit above (away from Earth), behind and beside the satellite, looking at it with Earth below
      const sat = this.sats.frameOf(this.focusKey);
      toPos = _v.copy(sat.pos).addScaledVector(sat.up, 0.45).addScaledVector(sat.fwd, -0.7).addScaledVector(sat.side, 0.56);
      _m.lookAt(toPos, sat.pos, sat.up);
      toQuat = _q.setFromRotationMatrix(_m);
      to = this.focusLayout();
    }
    const t = Math.min(1, (now - f.t0) / f.ms);
    if (f.phase === 'track') {
      const k = 1 - Math.exp(-dt * 8);
      this.camera.position.lerp(toPos, k);
      this.camera.quaternion.slerp(toQuat, k);
      this.layout.cx = to.cx;
      this.layout.cy = to.cy;
    } else {
      const e = ease(t);
      this.camera.position.lerpVectors(f.fromPos, toPos, e);
      this.camera.quaternion.slerpQuaternions(f.fromQuat, toQuat, e);
      this.layout.cx = f.fromCx + (to.cx - f.fromCx) * e;
      this.layout.cy = f.fromCy + (to.cy - f.fromCy) * e;
    }
    this.applyView();
    if (t >= 1) {
      if (f.phase === 'in') f.phase = 'track';
      else if (f.phase === 'out') {
        this.follow = null;
        this.layout.dist = this.baseDist;
        this.applyView();
      }
    }
  }

  /** Target rotation that brings (lat, lon) to face the camera. */
  rotationFor(lat, lon) {
    const lam = deg(lon + GLOBE.lonOffsetDeg);
    return { pitch: deg(lat), yaw: -GLOBE.lonDirection * lam };
  }

  /** Smoothly rotate + zoom to a place. Resolves when done. */
  flyTo(lat, lon, ms = GLOBE.flyDurationMs) {
    const target = this.rotationFor(lat, lon);
    // shortest way around for yaw
    let dy = (target.yaw - this.yaw) % (Math.PI * 2);
    if (dy > Math.PI) dy -= Math.PI * 2;
    if (dy < -Math.PI) dy += Math.PI * 2;
    this.flying = true;
    this.vel = { yaw: 0, pitch: 0 };
    return new Promise((resolve) => {
      this.fly = {
        t0: performance.now(),
        ms: reduced.matches ? 1 : ms,
        from: { yaw: this.yaw, pitch: this.pitch, cx: this.layout.cx, cy: this.layout.cy, dist: this.layout.dist },
        to: { yaw: this.yaw + dy, pitch: target.pitch, cx: 0.5, cy: 0.5, dist: this.baseDist * 0.52 },
        resolve,
      };
    });
  }

  stepFly(now) {
    const f = this.fly;
    const t = Math.min(1, (now - f.t0) / f.ms);
    const e = ease(t);
    const lerp = (a, b) => a + (b - a) * e;
    this.yaw = lerp(f.from.yaw, f.to.yaw);
    this.pitch = lerp(f.from.pitch, f.to.pitch);
    this.layout.cx = lerp(f.from.cx, f.to.cx);
    this.layout.cy = lerp(f.from.cy, f.to.cy);
    this.layout.dist = lerp(f.from.dist, f.to.dist);
    this.applyView();
    if (t >= 1) {
      this.fly = null;
      f.resolve();
    }
  }

  /** Put the view back after a cancelled fly (e.g. page restored from bfcache). */
  reset() {
    if (this.focusKey) this.el.dispatchEvent(new CustomEvent('satellite-blur'));
    this.fly = null;
    this.flying = false;
    this.follow = null;
    this.focusKey = null;
    this.sats.setFocus(null);
    this.layout.cx = this.homeLayout().cx;
    this.layout.cy = this.homeLayout().cy;
    this.layout.dist = this.baseDist;
    this.applyView();
  }
}

/* ==========================================================================
   Search
   ========================================================================== */
const ICONS = {
  wave: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 9c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/></svg>',
  mountain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 19l6-10 4 6 2-3 6 7z"/><path d="M2 19h20"/></svg>',
};

/** lowercase + strip Arabic diacritics/tatweel + unify alef/ya/ta-marbuta */
const norm = (s) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Exactly this logic:
 *  - Egypt (or a partial of it) -> the available lake(s)
 *  - Burullus (English or Arabic, partial) -> that lake
 *  - anything else -> 'soon'
 */
function matchQuery(raw) {
  const q = norm(raw);
  if (!q) return { kind: 'empty' };
  const hit = new Set();
  const partial = (word) => (q.length === 1 ? word.startsWith(q) : word.includes(q));
  if (COUNTRY_KEYWORDS.some((k) => partial(norm(k)))) LAKES.forEach((l) => hit.add(l));
  for (const lake of LAKES) {
    if (lake.aliases.some((a) => partial(norm(a)))) hit.add(lake);
  }
  return hit.size ? { kind: 'lakes', lakes: LAKES.filter((l) => hit.has(l)) } : { kind: 'soon' };
}

function initSearch({ onSelect, onNoResult }) {
  const input = $('#search-input');
  const list = $('#search-list');
  let options = []; // lake objects currently listed
  let active = -1;

  const close = () => {
    list.hidden = true;
    list.replaceChildren();
    options = [];
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };

  const setActive = (i) => {
    active = i;
    [...list.children].forEach((li, idx) => li.setAttribute('aria-selected', String(idx === i)));
    if (i >= 0) input.setAttribute('aria-activedescendant', `opt-${i}`);
    else input.removeAttribute('aria-activedescendant');
  };

  function render() {
    const res = matchQuery(input.value);
    list.replaceChildren();
    options = [];
    active = -1;
    if (res.kind === 'empty') return close();

    if (res.kind === 'soon') {
      const li = document.createElement('li');
      li.className = 'search__item';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-disabled', 'true');
      li.textContent = 'Coming soon';
      list.append(li);
      onNoResult();
    } else {
      options = res.lakes;
      res.lakes.forEach((lake, i) => {
        const li = document.createElement('li');
        li.className = 'search__item';
        li.id = `opt-${i}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.innerHTML = `
          <span class="search__ico">${ICONS[lake.icon]}</span>
          <span><span class="search__name">${lake.name}</span><br>
          <span class="search__desc">${lake.blurb}</span></span>`;
        li.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input
        li.addEventListener('click', () => choose(lake));
        li.addEventListener('mousemove', () => setActive(i));
        list.append(li);
      });
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function choose(lake) {
    close();
    input.value = lake.name;
    input.blur();
    onSelect(lake);
  }

  input.addEventListener('input', render);
  input.addEventListener('focus', () => input.value && render());
  input.addEventListener('blur', () => window.setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!list.hidden) {
        e.preventDefault();
        close();
      } else input.blur();
    } else if (e.key === 'ArrowDown' && options.length) {
      e.preventDefault();
      setActive((active + 1) % options.length);
    } else if (e.key === 'ArrowUp' && options.length) {
      e.preventDefault();
      setActive((active - 1 + options.length) % options.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0) return choose(options[active]);
      if (options.length === 1) return choose(options[0]); // exact / only match
      const q = norm(input.value);
      const exact = options.find((l) => [l.name, l.nameAr, ...l.aliases].some((a) => norm(a) === q));
      if (exact) choose(exact);
      else if (options.length) setActive(0); // "Egypt": highlight first, Enter again to pick
    }
  });

  return { focus: () => input.focus(), lock: () => (input.disabled = true), unlock: () => (input.disabled = false) };
}

/* ==========================================================================
   Boot
   ========================================================================== */
async function main() {
  initPageTransition();
  initStars();
  mascot.preload(['wave', 'point', 'think', 'idea', 'explain', 'laptop', 'celebrate']);

  const globeEl = $('#globe');
  const status = $('#globe-status');
  let globe = null;
  try {
    globe = new Globe(globeEl);
    globe
      .load((p) => (status.textContent = `Loading Earth… ${Math.round(p * 100)}%`))
      .catch((err) => {
        console.error('Globe failed to load', err);
        globeEl.classList.add('is-fallback');
        status.textContent = '';
      });
  } catch (err) {
    console.error('WebGL unavailable', err);
    globeEl.classList.add('is-fallback');
    status.textContent = '';
  }

  let busy = false;
  let searchUsed = false;

  // "story" here = anything that should keep the mascot quiet; a followed satellite counts
  const story = { isOpen: () => !!(globe && globe.focusKey) };

  /* Satellite info window: opens when a satellite is clicked, camera follows it */
  const panel = createSatellitePanel({
    onClose: () => globe?.blurSatellite(),
    onSwitch: (key) => globe?.focusSatellite(key),
  });
  const setFocusUI = (on) => {
    document.body.classList.toggle('is-sat-focus', on);
    for (const el of [$('.hero'), $('.search')]) if (el) el.inert = on; // keep focus/tab order out of hidden UI
    if (on) mascot.hide();
  };
  globeEl.addEventListener('satellite-focus', (e) => {
    setFocusUI(true);
    panel.open(e.detail.key);
  });
  globeEl.addEventListener('satellite-blur', () => {
    setFocusUI(false);
    panel.close();
  });

  const search = initSearch({
    onNoResult: () => {
      searchUsed = true;
      mascot.show('think', HOME_LINES.noResult, { position: 'near-search', flip: false, duration: 6000 });
    },
    onSelect: async (lake) => {
      if (busy || globe?.focusKey) return;
      busy = true;
      search.lock();
      mascot.hide();
      const url = `data.html?lake=${lake.id}`;
      if (!globe || !globe.ready) return navigateWithFade(url, 400);
      window.setTimeout(startFade, Math.max(0, GLOBE.flyDurationMs - 500)); // fade to dark near the end of the zoom
      await globe.flyTo(lake.lat, lake.lon);
      await sleep(550);
      window.location.href = url;
    },
  });

  // restore after Back button (bfcache)
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
      busy = false;
      search.unlock();
      globe?.reset();
    }
  });

  /* Mascot sequence: wave (bottom-left) -> point (near search) */
  const exploreBtn = $('#explore');
  let hoverActive = false;
  mascot.show('wave', HOME_LINES.welcome, {
    position: 'bottom-left',
    duration: HOME_LINES.welcomeMs,
    onHide: undefined,
  });
  window.setTimeout(() => {
    if (searchUsed || hoverActive || story.isOpen()) return;
    mascot.show('point', HOME_LINES.searchHint, { position: 'near-search', flip: true, duration: HOME_LINES.hintMs });
  }, HOME_LINES.welcomeMs + 200);

  /* Explore card */
  const sayExplore = () => {
    if (story.isOpen()) return;
    hoverActive = true;
    mascot.show('idea', HOME_LINES.exploreHover, { position: 'bottom-right', duration: 0 });
  };
  const stopExplore = () => {
    hoverActive = false;
    if (!story.isOpen()) mascot.hide();
  };
  exploreBtn.addEventListener('mouseenter', sayExplore);
  exploreBtn.addEventListener('focus', sayExplore);
  exploreBtn.addEventListener('mouseleave', stopExplore);
  exploreBtn.addEventListener('blur', stopExplore);
  // the card opens the (separate) story page
  exploreBtn.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    mascot.hide();
    navigateWithFade('story.html');
  });

  // "/" focuses search
  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement === document.body && !story.isOpen()) {
      e.preventDefault();
      search.focus();
    }
  });
}

main();
