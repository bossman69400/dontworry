/**
 * router.js — simple hash-based section switcher.
 * Usage: Router.register('builder', renderFn) then Router.init().
 */
const Router = {
  _handlers: {},
  _defaultSection: 'builder',

  register(sectionName, renderFn) {
    this._handlers[sectionName] = renderFn;
  },

  navigate(sectionName) {
    window.location.hash = sectionName;
  },

  _handleRoute() {
    // Flush any pending debounced saves before the section switches.
    // Wrapped in try/catch so a broken module can't block navigation.
    try {
      if (typeof Review !== 'undefined' && Review._flushReasonText) {
        Review._flushReasonText();
      }
      if (typeof Runner !== 'undefined' && Runner.session &&
          !Runner.session.completedAt && Runner._flushAndSave) {
        Runner._flushAndSave();
      }
    } catch (e) {}

    const hash = window.location.hash.replace('#', '') || this._defaultSection;

    // Update nav active state
    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.toggle('active', link.dataset.section === hash);
    });

    // Hide all sections, show the active one
    document.querySelectorAll('.section').forEach(el => {
      el.style.display = 'none';
    });
    const el = document.getElementById('section-' + hash);
    if (el) el.style.display = 'block';

    // Call the registered render function
    if (this._handlers[hash]) {
      this._handlers[hash]();
    }
  },

  init() {
    window.addEventListener('hashchange', () => this._handleRoute());
    this._handleRoute();
  },
};
