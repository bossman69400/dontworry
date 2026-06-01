/**
 * history.js — Session History view.
 *
 * Lists every saved session (complete and in-progress) with rich metadata,
 * filter/sort controls, and actions for each session.
 *
 * State is preserved across navigation so the user's current sort/filter
 * stays put when they switch sections and come back.
 */
const History = {
  _sort:    'newest',   // 'newest' | 'oldest' | 'best' | 'worst'
  _filters: {
    status: 'all',      // 'all' | 'completed' | 'incomplete'
    type:   'all',      // 'all' | 'normal' | 'redo'
    mode:   'all',      // 'all' | 'open-book' | 'one-note-check' | 'closed-book'
  },

  // ── Init ─────────────────────────────────────────────────

  init() {
    Router.register('history', () => this.render());
  },

  render() {
    const el       = document.getElementById('section-history');
    const sessions = this._filteredSorted();
    const allCount = Object.keys(Storage.getSessions()).length;

    el.innerHTML = `
      <div class="page-header">
        <h1>History</h1>
        <span class="page-subtitle">${allCount} session${allCount !== 1 ? 's' : ''} total</span>
      </div>

      <div class="history-controls">
        ${this._sortBarHTML()}
        ${this._filterBarHTML()}
      </div>

      <div id="history-list">
        ${this._listHTML(sessions)}
      </div>
    `;
  },

  // ── Sort & filter bars ────────────────────────────────────

  _sortBarHTML() {
    const defs = [
      ['newest', 'Newest first'],
      ['oldest', 'Oldest first'],
      ['best',   'Best grade'],
      ['worst',  'Worst grade'],
    ];
    return `
      <div class="hctl-row">
        <span class="hctl-label">Sort</span>
        ${defs.map(([val, label]) => `
          <button class="hctl-chip ${this._sort === val ? 'hctl-chip-active' : ''}"
                  onclick="History.setSort('${val}')">${label}</button>
        `).join('')}
      </div>
    `;
  },

  _filterBarHTML() {
    const f = this._filters;

    const statusDefs = [
      ['all', 'All'],
      ['completed',  'Completed'],
      ['incomplete', 'In Progress'],
    ];
    const typeDefs = [
      ['all',    'All'],
      ['normal', 'Normal'],
      ['redo',   'Redo'],
    ];
    const modeDefs = [
      ['all',             'All modes'],
      ['open-book',       'Open Book'],
      ['one-note-check',  'One Note Check'],
      ['closed-book',     'Closed Book'],
    ];

    return `
      <div class="hctl-row">
        <span class="hctl-label">Status</span>
        ${statusDefs.map(([val, label]) => `
          <button class="hctl-chip ${f.status === val ? 'hctl-chip-active' : ''}"
                  onclick="History.setFilter('status','${val}')">${label}</button>
        `).join('')}
      </div>
      <div class="hctl-row">
        <span class="hctl-label">Type</span>
        ${typeDefs.map(([val, label]) => `
          <button class="hctl-chip ${f.type === val ? 'hctl-chip-active' : ''}"
                  onclick="History.setFilter('type','${val}')">${label}</button>
        `).join('')}
        &nbsp;
        <span class="hctl-label">Mode</span>
        ${modeDefs.map(([val, label]) => `
          <button class="hctl-chip ${f.mode === val ? 'hctl-chip-active' : ''}"
                  onclick="History.setFilter('mode','${val}')">${label}</button>
        `).join('')}
      </div>
    `;
  },

  // ── Session list ──────────────────────────────────────────

  _listHTML(sessions) {
    if (sessions.length === 0) {
      const hasAny = Object.keys(Storage.getSessions()).length > 0;
      if (!hasAny) {
        return `<div class="empty-state">
          <p>No sessions yet. Go to <a href="#runner">Take Test</a> to start one.</p>
        </div>`;
      }
      return `<div class="empty-state">
        <p>No sessions match the current filters.
          <button class="btn btn-sm btn-ghost" onclick="History.clearFilters()">Clear filters</button>
        </p>
      </div>`;
    }
    // Pre-load all sessions once for redo lineage lookup
    const allSessions = Storage.getSessions();
    return sessions.map(s => this._cardHTML(s, allSessions)).join('');
  },

  _cardHTML(session, allSessions) {
    const stats      = this._sessionStats(session);
    const isRedo     = !!session.isRedo;
    const isComplete = !!session.completedAt;
    const pct        = stats.total > 0
      ? Math.round((stats.answered / stats.total) * 100) : 0;

    // Redo lineage
    let lineageHTML = '';
    if (isRedo && session.redoOf) {
      const src = allSessions[session.redoOf];
      lineageHTML = `
        <div class="session-lineage">
          &#8635; Redo of:
          <span class="lineage-title">${src
            ? this._esc(src.testTitle)
            : '<em>original session deleted</em>'}</span>
          ${src
            ? `<button class="btn btn-sm btn-ghost lineage-link"
                       onclick="History.openReview('${src.id}')"
                       title="Open the original session in Review">view original</button>`
            : ''}
        </div>`;
    }

    // Grade display
    let gradeHTML = '';
    if (isComplete) {
      if (stats.gradeCount > 0) {
        const avg = (stats.gradeSum / stats.gradeCount).toFixed(2);
        gradeHTML = `
          <span class="session-stat">Avg grade: <strong>${avg}</strong></span>
          <span class="session-stat-sep">&middot;</span>
          <span class="session-stat ${stats.weak > 0 ? 'session-stat-weak' : ''}">
            Weak: <strong>${stats.weak}</strong>
          </span>`;
      } else {
        gradeHTML = `<span class="session-stat session-stat-muted">Not yet graded</span>`;
      }
    }

    // Actions
    const reviewBtn = isComplete
      ? `<button class="btn btn-sm btn-primary"
                 onclick="History.openReview('${session.id}')">Review</button>`
      : '';
    const resumeBtn = !isComplete
      ? `<button class="btn btn-sm btn-primary"
                 onclick="History.resumeSession('${session.id}')">Resume</button>`
      : '';
    const deleteBtn = `<button class="btn btn-sm btn-danger"
                               onclick="History.deleteSession('${session.id}')">Delete</button>`;

    return `
      <div class="history-card ${isComplete ? '' : 'history-card-inprogress'}">
        <div class="history-card-top">
          <div class="history-card-badges">
            ${isRedo     ? `<span class="hbadge hbadge-redo">Redo</span>`        : ''}
            ${!isComplete? `<span class="hbadge hbadge-progress">In Progress</span>` : ''}
          </div>
          <div class="history-card-title-row">
            <span class="history-card-title">${this._esc(session.testTitle)}</span>
            <span class="history-card-date">${this._fmtDate(session.completedAt || session.startedAt)}</span>
          </div>
        </div>

        <div class="history-card-meta">
          <span class="mode-badge mode-${session.mode}">${this._modeLabel(session.mode)}</span>
          <span class="session-stat">${stats.total} question${stats.total !== 1 ? 's' : ''}</span>
          <span class="session-stat-sep">&middot;</span>
          <span class="session-stat">${stats.answered}/${stats.total} answered</span>
          <span class="session-stat-sep">&middot;</span>
          ${isComplete ? gradeHTML : `<span class="session-stat">${pct}% complete</span>`}
        </div>

        ${!isComplete ? `
          <div class="history-progress">
            <div class="mini-progress-track" title="${pct}% answered">
              <div class="mini-progress-fill" style="width:${pct}%"></div>
            </div>
          </div>
        ` : ''}

        ${lineageHTML}

        <div class="history-card-actions">
          ${reviewBtn}${resumeBtn}${deleteBtn}
        </div>
      </div>
    `;
  },

  // ── Filter / sort logic ───────────────────────────────────

  _filteredSorted() {
    const sessions = Object.values(Storage.getSessions());
    const f        = this._filters;

    const filtered = sessions.filter(s => {
      if (f.status === 'completed'  && !s.completedAt)  return false;
      if (f.status === 'incomplete' &&  s.completedAt)  return false;
      if (f.type   === 'normal'     &&  s.isRedo)       return false;
      if (f.type   === 'redo'       && !s.isRedo)       return false;
      if (f.mode   !== 'all'        &&  s.mode !== f.mode) return false;
      return true;
    });

    filtered.sort((a, b) => {
      switch (this._sort) {
        case 'oldest':
          return (a.startedAt || 0) - (b.startedAt || 0);
        case 'best': {
          const ga = this._avgGrade(a), gb = this._avgGrade(b);
          if (ga === null && gb === null) return 0;
          if (ga === null) return 1;
          if (gb === null) return -1;
          return gb - ga;
        }
        case 'worst': {
          const ga = this._avgGrade(a), gb = this._avgGrade(b);
          if (ga === null && gb === null) return 0;
          if (ga === null) return 1;
          if (gb === null) return -1;
          return ga - gb;
        }
        default: // newest
          return (b.startedAt || 0) - (a.startedAt || 0);
      }
    });

    return filtered;
  },

  // ── Actions ───────────────────────────────────────────────

  openReview(sessionId) {
    Review.openSession(sessionId);
    Router.navigate('review');
  },

  resumeSession(sessionId) {
    Runner.resumeSession(sessionId);
    // resumeSession sets Runner.session and calls Router.navigate internally
  },

  deleteSession(sessionId) {
    const session = Storage.getSessions()[sessionId];
    if (!session) return;
    const label = session.testTitle + (session.completedAt ? '' : ' (in progress)');
    if (!confirm(`Delete session "${label}"?\n\nThis cannot be undone.`)) return;

    Storage.deleteSession(sessionId);

    // Clear from Review if it's the currently open session
    if (typeof Review !== 'undefined' &&
        Review.selectedSession && Review.selectedSession.id === sessionId) {
      Review.selectedSession = null;
    }

    // Re-render the list in-place (no full page reload)
    const listEl = document.getElementById('history-list');
    if (listEl) {
      listEl.innerHTML = this._listHTML(this._filteredSorted());
    }
  },

  setSort(val) {
    this._sort = val;
    this._rerender();
  },

  setFilter(key, val) {
    this._filters[key] = val;
    this._rerender();
  },

  clearFilters() {
    this._filters = { status: 'all', type: 'all', mode: 'all' };
    this._rerender();
  },

  /** Re-render just the controls + list, keeping the page header intact. */
  _rerender() {
    const sessions = this._filteredSorted();
    const ctlEl = document.querySelector('.history-controls');
    if (ctlEl) ctlEl.innerHTML = this._sortBarHTML() + this._filterBarHTML();
    const listEl = document.getElementById('history-list');
    if (listEl) listEl.innerHTML = this._listHTML(sessions);
  },

  // ── Stat helpers ──────────────────────────────────────────

  /**
   * Compute lightweight stats for a session.
   * Gracefully handles sessions with missing review fields (pre-Stage-4)
   * and sessions with no questions.
   */
  _sessionStats(session) {
    const defaults = {
      answer: '', usedNotes: false, notConfident: false,
      flagged: false, guessed: false, retryLater: false,
      selfGrade: null,
    };
    let answered = 0, weak = 0, gradeSum = 0, gradeCount = 0;

    (session.questionSnapshot || []).forEach(q => {
      const r = { ...defaults, ...(session.responses[q.id] || {}) };
      if (r.answer && (typeof r.answer !== 'string' || r.answer.trim())) answered++;
      if (r.selfGrade !== null) { gradeSum += r.selfGrade; gradeCount++; }
      if (r.usedNotes || r.notConfident || r.flagged || r.retryLater ||
          (r.selfGrade !== null && r.selfGrade < 1)) weak++;
    });

    return {
      total:      (session.questionSnapshot || []).length,
      answered,
      weak,
      gradeSum,
      gradeCount,
    };
  },

  _avgGrade(session) {
    const { gradeSum, gradeCount } = this._sessionStats(session);
    return gradeCount > 0 ? gradeSum / gradeCount : null;
  },

  // ── Utilities ─────────────────────────────────────────────

  _modeLabel(mode) {
    return {
      'open-book':      'Open Book',
      'one-note-check': 'One Note Check',
      'closed-book':    'Closed Book',
    }[mode] || (mode || 'Unknown mode');
  },

  _esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  _fmtDate(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  },
};
