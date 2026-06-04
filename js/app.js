/**
 * app.js — entry point; initialises all modules, the router,
 * global save-status helpers, and beforeunload persistence guard.
 */

// ── Save-status indicator ─────────────────────────────────
// Shown in the nav bar whenever a debounced save is pending or has just
// completed. Uses a single shared element so concurrent events don't stack.

let _saveStatusTimer = null;

function showSavePending() {
  const el = document.getElementById('save-status');
  if (!el) return;
  clearTimeout(_saveStatusTimer);
  el.textContent   = 'Saving\u2026';
  el.className     = 'save-status save-status-pending';
}

function showSaved() {
  const el = document.getElementById('save-status');
  if (!el) return;
  clearTimeout(_saveStatusTimer);
  el.textContent = 'Saved';
  el.className   = 'save-status save-status-done';
  _saveStatusTimer = setTimeout(() => {
    el.className = 'save-status';
  }, 1800);
}

// ── Init ─────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  Builder.init();
  Runner.init();
  Review.init();
  History.init();
  Router.init();
});

// ── Beforeunload guard ────────────────────────────────────
// Flush any pending debounced saves synchronously before the page unloads.
// localStorage writes are synchronous, so this is safe.

window.addEventListener('beforeunload', () => {
  try {
    if (typeof Review !== 'undefined') Review._flushReasonText();
    if (typeof Runner !== 'undefined' && Runner.session &&
        !Runner.session.completedAt && Runner._flushAndSave) {
      Runner._flushAndSave();
    }
  } catch (e) {}
});
