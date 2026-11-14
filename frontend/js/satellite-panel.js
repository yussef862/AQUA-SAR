/**
 * Info window for a satellite (opens when a satellite on the home globe is clicked).
 * Plain DOM, no dependencies. Content comes from js/satellite-info.js and is inserted with textContent.
 *
 *   const panel = createSatellitePanel({ onClose, onSwitch });
 *   panel.open('s1');  panel.close();
 */
import { SAT_INFO } from './satellite-info.js';

const h = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

export function createSatellitePanel({ onClose, onSwitch } = {}) {
  const el = h('aside', 'sat-panel');
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'false');

  const closeBtn = h('button', 'sat-panel__close');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close satellite details');
  closeBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  const body = h('div', 'sat-panel__body');
  el.append(closeBtn, body);
  document.body.append(el);

  let currentKey = null;
  let hideTimer = 0;
  let prevFocus = null;

  function fill(key) {
    const info = SAT_INFO[key];
    el.style.setProperty('--accent', info.accent);
    el.style.setProperty('--accent-rgb', info.accentRgb);

    const title = h('h2', 'sat-panel__title', info.name);
    title.id = 'sat-panel-title';
    el.setAttribute('aria-labelledby', title.id);

    const kicker = h('p', 'sat-panel__kicker');
    kicker.append(h('span', 'sat-panel__dot'), document.createTextNode(info.kicker));

    const facts = h('dl', 'sat-panel__facts');
    for (const [k, v] of info.facts) facts.append(h('dt', null, k), h('dd', null, v));

    const nodes = [
      kicker,
      title,
      h('p', 'sat-panel__tagline', info.tagline),
      h('p', 'sat-panel__about', info.about),
      facts,
      h('h3', 'sat-panel__sub', 'In AQUA SAR'),
      h('p', 'sat-panel__about', info.role),
    ];
    if (info.note) nodes.push(h('p', 'sat-panel__note', info.note));

    const otherKey = Object.keys(SAT_INFO).find((k) => k !== key);
    const other = SAT_INFO[otherKey];
    const actions = h('div', 'sat-panel__actions');
    const back = h('button', 'sat-panel__btn sat-panel__btn--primary', 'Back to Earth');
    back.type = 'button';
    back.addEventListener('click', () => onClose?.());
    const sw = h('button', 'sat-panel__btn');
    sw.type = 'button';
    sw.style.setProperty('--btn-rgb', other.accentRgb);
    sw.append(h('span', 'sat-panel__dot sat-panel__dot--other'), document.createTextNode(`View ${other.name}`));
    sw.addEventListener('click', () => onSwitch?.(otherKey));
    actions.append(back, sw);
    nodes.push(actions);

    body.replaceChildren(...nodes);
    body.classList.remove('is-swap');
    void body.offsetWidth; // restart the small fade when switching satellites
    body.classList.add('is-swap');
    body.scrollTop = 0;
    el.scrollTop = 0;
  }

  function open(key) {
    if (!SAT_INFO[key]) return;
    window.clearTimeout(hideTimer);
    const wasOpen = !el.hidden && el.classList.contains('is-open');
    if (!wasOpen && document.activeElement && document.activeElement !== document.body) prevFocus = document.activeElement;
    currentKey = key;
    fill(key);
    el.hidden = false;
    void el.offsetWidth;
    el.classList.add('is-open');
    if (!wasOpen) closeBtn.focus({ preventScroll: true });
  }

  function close() {
    if (el.hidden) return;
    el.classList.remove('is-open');
    currentKey = null;
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      el.hidden = true;
    }, 420);
    if (prevFocus && prevFocus.isConnected) prevFocus.focus?.({ preventScroll: true });
    prevFocus = null;
  }

  closeBtn.addEventListener('click', () => onClose?.());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && currentKey) {
      e.preventDefault();
      onClose?.();
    }
  });

  return { open, close, isOpen: () => currentKey !== null };
}
