/**
 * Reusable mascot module.
 *
 *   import { show, hide, poseUrl, preload } from './mascot.js';
 *   show('wave', 'Welcome!', { position: 'bottom-left', duration: 4000 });
 *   hide();
 *
 * Positions (see css/mascot.css): 'bottom-left' | 'bottom-right' | 'near-search'
 * Options: { position, duration (ms, 0 = stay), flip (mirror image), onHide }
 */
import { MASCOT } from './config.js';

const CLOSE_ICON =
  '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>';

let root;
let img;
let textEl;
let timer = 0;
let hideTimer = 0;
let onHideCb = null;
let currentPose = null;

/** URL of a pose image. */
export function poseUrl(pose) {
  return MASCOT.basePath + (MASCOT.poses[pose] || MASCOT.poses.wave);
}

/** Warm the cache so pose swaps never flash. */
export function preload(poses = Object.keys(MASCOT.poses)) {
  poses.forEach((p) => {
    const i = new Image();
    i.src = poseUrl(p);
  });
}

function ensure() {
  if (root) return;
  root = document.createElement('div');
  root.className = 'mascot';
  root.dataset.pos = 'bottom-left';
  root.innerHTML = `
    <div class="mascot__figure"><img class="mascot__img" width="140" height="140" alt=""></div>
    <div class="mascot__bubble" role="status" aria-live="polite">
      <span class="mascot__text"></span>
      <button type="button" class="mascot__close" aria-label="Dismiss message">${CLOSE_ICON}</button>
    </div>`;
  document.body.append(root);
  img = root.querySelector('.mascot__img');
  textEl = root.querySelector('.mascot__text');
  root.querySelector('.mascot__close').addEventListener('click', () => hide());
}

function setPose(pose) {
  if (pose === currentPose) return;
  currentPose = pose;
  const next = poseUrl(pose);
  const apply = () => {
    img.src = next;
    img.alt = MASCOT.alt[pose] || 'Astronaut mascot';
    img.classList.remove('is-swapping');
  };
  if (!root.classList.contains('is-visible') || !img.src) return apply();
  img.classList.add('is-swapping');
  window.setTimeout(apply, 160);
}

/** Show the mascot with a speech bubble. Replaces whatever is currently shown. */
export function show(pose, text, { position = 'bottom-left', duration = 6000, flip = false, onHide = null } = {}) {
  ensure();
  window.clearTimeout(timer);
  window.clearTimeout(hideTimer);
  if (onHideCb && onHideCb !== onHide) onHideCb = null; // replaced, not dismissed

  root.dataset.pos = position;
  root.dataset.flip = String(flip);
  textEl.textContent = text;
  setPose(pose);
  onHideCb = onHide;
  // next frame so the transition runs when (re)appearing
  requestAnimationFrame(() => root.classList.add('is-visible'));

  if (duration > 0) timer = window.setTimeout(() => hide(), duration);
}

/** Hide the mascot (fires onHide of the current message, if any). */
export function hide() {
  if (!root) return;
  window.clearTimeout(timer);
  root.classList.remove('is-visible');
  const cb = onHideCb;
  onHideCb = null;
  if (cb) cb();
}

/** Is the mascot currently on screen? */
export function isVisible() {
  return !!root && root.classList.contains('is-visible');
}
