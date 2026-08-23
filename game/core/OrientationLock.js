// OrientationLock.js
// Best-effort landscape lock for mobile devices.
//
// Two layers work together and never conflict:
//  1) The real Screen Orientation API (screen.orientation.lock) — supported
//     on Chrome/Android and generally only while the page is fullscreen, so
//     we request fullscreen first and only ever call this from inside a
//     genuine user gesture (a click/tap handler) — browsers silently reject
//     both calls otherwise.
//  2) A pure-CSS fallback (see the "Landscape lock" block at the end of
//     style.css) that rotates the whole page 90° whenever the browser
//     reports `orientation: portrait` on a small, touch (coarse-pointer)
//     screen — i.e. a phone the user hasn't physically turned sideways yet,
//     or a browser (iOS Safari, mainly) that doesn't support the
//     Orientation Lock API at all. That CSS is driven purely by the
//     *reported* orientation, so if (1) actually succeeds the browser
//     starts reporting `landscape` on its own and the fallback simply never
//     engages — the two layers can't double-rotate.

/** Try to enter fullscreen and lock the screen to landscape. Must be called
 * from inside a user-gesture handler (click/touchend) — browsers reject
 * both the fullscreen and the orientation.lock request otherwise. Silently
 * no-ops anywhere it isn't supported (desktop, iOS Safari, etc.); the CSS
 * fallback in style.css keeps the game playable in landscape regardless. */
export async function requestLandscapeLock() {
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      await el.requestFullscreen().catch(() => {});
    }
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock('landscape').catch(() => {});
    }
  } catch (e) {
    // Unsupported or rejected by the browser — nothing to do, the CSS
    // rotation fallback already covers this case without a real lock.
  }
}

/** Retries the lock on the very next tap anywhere in the document. Useful
 * as a safety net for a "Продолжить" click or any other later gesture, in
 * case the very first attempt (e.g. from the start menu) was rejected. */
export function installOrientationLockRetry() {
  document.addEventListener('click', () => { requestLandscapeLock(); }, { once: true, capture: true });
}
