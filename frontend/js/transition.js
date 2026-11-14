/**
 * Smooth page-to-page fade (to dark, then navigate). The fade-IN on arrival is pure CSS
 * (`.page-fade` animation in css/base.css).
 */
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Start the fade-to-dark (without navigating yet). */
export function startFade() {
  document.documentElement.classList.add('is-leaving');
}

/** Fade to dark, then go to `url`. */
export function navigateWithFade(url, waitMs = 600) {
  startFade();
  window.setTimeout(() => {
    window.location.href = url;
  }, reduced() ? 0 : waitMs);
}

/** When the user comes back with the browser's Back button the page may be restored from cache. */
export function initPageTransition() {
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) document.documentElement.classList.remove('is-leaving');
  });
}
