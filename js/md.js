/**
 * md.js — Markdown rendering with MathJax math support.
 *
 * Requires marked.js (CDN) to be loaded before this file.
 * MathJax is loaded async separately; typesetMath() calls it on demand.
 *
 * Exports (globals):
 *   renderMarkdown(text)     — returns HTML string
 *   stripMarkdown(text)      — returns plain text (for row previews)
 *   clearMath(el?)           — clear MathJax state before replacing innerHTML
 *   typesetMath(el?)         — trigger MathJax typesetting on an element
 */

// ── Configure marked.js ───────────────────────────────────
// Called immediately; no-ops gracefully if marked hasn't loaded yet.
(function configureMarked() {
  if (typeof marked === 'undefined') return;
  marked.use({ gfm: true, breaks: false });
})();

// Unique placeholder prefix for math extraction.
// Built from a random suffix so it can never accidentally match user content.
const _MD_PH = 'MDMATHPH' + Math.random().toString(36).slice(2, 10).toUpperCase();

/**
 * Strip Markdown syntax from text, returning a plain readable string.
 * Used for compact single-line previews in the Builder question list.
 */
function stripMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\\\[[\s\S]*?\\\]/g, '[math]')
    .replace(/\$\$[\s\S]*?\$\$/g, '[math]')
    .replace(/\\\([\s\S]*?\\\)/g, '[math]')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Render a Markdown string to HTML, protecting math delimiters so that
 * MathJax can typeset them after the HTML is inserted into the DOM.
 *
 * Math delimiters:
 *   Inline:  \( ... \)
 *   Display: \[ ... \]   or   $$ ... $$
 *
 * Falls back to escaped plain text with line breaks when marked.js is not
 * loaded (e.g. offline — the CDN request failed).
 */
function renderMarkdown(text) {
  if (!text) return '';

  if (typeof marked === 'undefined') {
    // Offline/CDN-unavailable fallback
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }

  try {
    const pool = [];
    const mark = m => { pool.push(m); return _MD_PH + (pool.length - 1) + 'X'; };
    const restore = html => {
      pool.forEach((math, i) => { html = html.split(_MD_PH + i + 'X').join(math); });
      return html;
    };

    let src = text;
    // Extract math before markdown processing — order: longest delimiters first
    src = src.replace(/\\\[[\s\S]*?\\\]/g, mark);   // \[ ... \]
    src = src.replace(/\$\$[\s\S]*?\$\$/g, mark);    // $$ ... $$
    src = src.replace(/\\\([\s\S]*?\\\)/g, mark);    // \( ... \)

    const html = marked.parse(src);
    return restore(html);
  } catch (e) {
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }
}

/**
 * Clear MathJax's internal tracking of a DOM element before its innerHTML
 * is replaced.  Must be called while the old content is still in the DOM so
 * MathJax can clean up its internal records.  No-ops if MathJax is not loaded.
 */
function clearMath(el) {
  if (typeof MathJax === 'undefined') return;
  try {
    if (typeof MathJax.typesetClear === 'function') {
      MathJax.typesetClear(el ? [el] : undefined);
    }
  } catch (e) {}
}

// Serialised typeset queue — chains every typesetPromise call so that a
// second render triggered before the first finishes (e.g. rapid navigation)
// never hits MathJax's "already in progress" error.
let _typesetQueue = Promise.resolve();

/**
 * Typeset MathJax on a DOM element (or the full page if el is omitted).
 * Waits for MathJax startup to complete so it is safe to call immediately
 * after setting innerHTML, even before the async CDN script has finished
 * loading.  Calls are serialised to prevent "already in progress" errors
 * during rapid navigation.
 */
function typesetMath(el) {
  if (typeof MathJax === 'undefined') return;
  const run = () => {
    if (typeof MathJax.typesetPromise !== 'function') return Promise.resolve();
    return MathJax.typesetPromise(el ? [el] : undefined).catch(() => {});
  };
  if (MathJax.startup && MathJax.startup.promise) {
    _typesetQueue = _typesetQueue
      .then(() => MathJax.startup.promise)
      .then(run)
      .catch(() => {});
  } else {
    _typesetQueue = _typesetQueue.then(run).catch(() => {});
  }
}
