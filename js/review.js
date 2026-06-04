/**
 * review.js — Review Answers flow.
 *
 * UI states:
 *   1. Session list    — pick a completed session
 *   2. Review session  — full review page for the selected session
 *
 * All review edits (self-grade, retry later, error reason) are written to
 * session.responses in memory and persisted to localStorage immediately.
 * errorReasonText is debounced (500 ms).
 */
const Review = {
  selectedSession: null,
  _filters: {
    weeks:      [],    // [] = all weeks
    flags:      [],    // [] = all; entries = response fields that must be true
    grade:      'all', // 'all' | 'ungraded' | '0' | '0.5' | '1'
    unanswered: false,
    weakOnly:   false,
  },
  _showModelAnswers:  true,
  _hiddenModelAnswers: new Set(), // question IDs with per-card model answer hidden
  _reasonTimer:       null,

  ERROR_REASONS: [
    ['didnt-know',     "Didn't know it"],
    ['couldnt-phrase', "Knew it but couldn't phrase it"],
    ['mixed-up',       "Mixed it up with another concept"],
    ['careless',       "Careless mistake"],
    ['needed-notes',   "Needed notes prompt"],
    ['other',          "Other"],
  ],

  // ── Init ─────────────────────────────────────────────────

  init() {
    Router.register('review', () => this.render());
  },

  render() {
    const el = document.getElementById('section-review');
    if (this.selectedSession) {
      this._renderReview(el);
    } else {
      this._renderSessionList(el);
    }
  },

  // ── 1. Session list ───────────────────────────────────────

  _renderSessionList(el) {
    const sessions = Object.values(Storage.getSessions())
      .filter(s => s.completedAt)
      .sort((a, b) => b.completedAt - a.completedAt);

    el.innerHTML = `
      <div class="page-header">
        <h1>Review Answers</h1>
      </div>
      ${sessions.length === 0
        ? `<div class="empty-state">
             <p>No completed tests yet. Go to <a href="#runner">Take Test</a> and finish a session first.</p>
           </div>`
        : `<div class="test-list">
             ${sessions.map(s => this._sessionCardHTML(s)).join('')}
           </div>`
      }
    `;
  },

  _sessionCardHTML(session) {
    const stats = this._computeStats(session);
    const gradeStr = stats.avgGrade !== null
      ? `Avg: ${stats.avgGrade.toFixed(2)}`
      : 'Ungraded';
    const weakStr  = stats.weak > 0
      ? `&nbsp;&middot;&nbsp;<span class="weak-inline">${stats.weak} weak</span>`
      : '';
    const isRedo = !!session.isRedo;
    return `
      <div class="test-card">
        <div class="test-card-info">
          <div class="test-card-title-row">
            ${isRedo              ? '<span class="hbadge hbadge-redo">Redo</span>'          : ''}
            ${session.shuffled    ? '<span class="hbadge hbadge-shuffled">Shuffled</span>'  : ''}
            ${session.isFiltered  ? '<span class="hbadge hbadge-filtered">Filtered</span>'  : ''}
            <h3>${this._esc(session.testTitle)}</h3>
          </div>
          <span class="meta">
            ${this._modeLabel(session.mode)} &middot;
            ${this._fmtDate(session.completedAt)} &middot;
            ${stats.answered}/${stats.total} answered &middot;
            ${gradeStr}${weakStr}
          </span>
        </div>
        <div class="test-card-actions">
          <button class="btn btn-sm btn-primary"
                  onclick="Review.selectSession('${session.id}')">Review</button>
        </div>
      </div>
    `;
  },

  selectSession(id) {
    this._flushReasonText();   // save any pending text before switching
    const session = Storage.getSessions()[id];
    if (!session) return;
    this.selectedSession = session;
    this._filters = { weeks: [], flags: [], grade: 'all', unanswered: false, weakOnly: false, tags: [] };
    this._showModelAnswers  = true;
    this._hiddenModelAnswers = new Set();
    this.render();
  },

  /** Called by Runner.goToReview() to jump straight to a just-finished session. */
  openSession(id) {
    const session = Storage.getSessions()[id];
    if (session) {
      this.selectedSession = session;
      this._filters = { weeks: [], flags: [], grade: 'all', unanswered: false, weakOnly: false, tags: [] };
      this._showModelAnswers  = true;
      this._hiddenModelAnswers = new Set();
    }
  },

  backToList() {
    this.selectedSession = null;
    this.render();
  },

  // ── 2. Full review page ───────────────────────────────────

  _renderReview(el) {
    const session = this.selectedSession;
    const stats   = this._computeStats(session);

    el.innerHTML = `
      <div class="page-header">
        <button class="btn btn-ghost" onclick="Review.backToList()">&#8592; Sessions</button>
        <h1 class="review-page-title" title="${this._esc(session.testTitle)}">${this._esc(session.testTitle)}</h1>
        <div class="header-actions">
          <button class="btn btn-ghost" onclick="Review.exportSession('${session.id}')"
                  title="Export this session as JSON">Export</button>
          <button class="btn btn-secondary" id="global-model-btn"
                  onclick="Review.toggleAllModelAnswers()">
            ${this._showModelAnswers ? 'Collapse all answers' : 'Expand all answers'}
          </button>
          <button class="btn btn-primary" id="redo-weak-btn"
                  onclick="Review.redoWeak()"
                  ${stats.weak === 0 ? 'disabled' : ''}
                  title="${stats.weak === 0
                    ? 'No weak questions yet'
                    : `Redo ${stats.weak} weak question${stats.weak !== 1 ? 's' : ''}`}">
            Redo Weak (${stats.weak})
          </button>
        </div>
      </div>

      ${session.isRedo ? this._redoBannerHTML(session) : ''}

      <div id="review-summary" class="review-summary">
        ${this._summaryHTML(session, stats)}
      </div>

      <div id="review-filter-bar" class="review-filter-bar">
        ${this._filterBarHTML(session)}
      </div>

      <div id="review-cards" class="review-cards"></div>
    `;

    this._injectCards();
  },

  _redoBannerHTML(session) {
    const allSessions = Storage.getSessions();
    const source      = session.redoOf ? allSessions[session.redoOf] : null;
    const sourceLink  = source
      ? `<button class="btn btn-sm btn-ghost redo-source-btn"
                 onclick="Review.openSource('${session.redoOf}')">View original review</button>`
      : '';
    const sourceLabel = source
      ? `from <strong>${this._esc(source.testTitle)}</strong> (${this._fmtDate(source.completedAt || source.startedAt)})`
      : session.redoOf
        ? `(original session was deleted)`
        : '';

    return `
      <div class="redo-session-banner">
        <span class="redo-banner-icon">&#8635;</span>
        <span class="redo-banner-text">
          Weak-question redo session ${sourceLabel}
        </span>
        ${sourceLink}
      </div>
    `;
  },

  // ── Summary block ─────────────────────────────────────────

  _summaryHTML(session, stats) {
    if (!stats) stats = this._computeStats(session);

    const weekEntries = Object.entries(stats.weakByWeek).sort((a, b) => {
      return parseInt(a[0].replace(/\D/g, '')) - parseInt(b[0].replace(/\D/g, ''));
    });

    const statItems = [
      [stats.total,                 'Total'],
      [stats.answered,              'Answered'],
      [stats.unanswered,            'Skipped'],
      [stats.usedNotes,             'Used Notes'],
      [stats.notConfident,          'Not Confident'],
      [stats.flagged,               'Flagged'],
      [stats.guessed,               'Guessed'],
      [stats.retryLater,            'Retry Later'],
      [stats.avgGrade !== null ? stats.avgGrade.toFixed(2) : '—', 'Avg Grade'],
      [stats.weak,                  'Weak', stats.weak > 0],
    ];

    return `
      <div class="summary-grid">
        ${statItems.map(([v, l, warn]) => `
          <div class="summary-stat${warn ? ' summary-stat-warn' : ''}">
            <span class="summary-stat-value">${v}</span>
            <span class="summary-stat-label">${l}</span>
          </div>
        `).join('')}
      </div>
      ${weekEntries.length > 0 ? `
        <div class="summary-weak-weeks">
          <span class="summary-weak-label">Weak by week:</span>
          ${weekEntries.map(([w, c]) =>
            `<span class="week-tag week-tag-${w.replace(/\D/g, '')}">${w} (${c})</span>`
          ).join('')}
        </div>
      ` : ''}
    `;
  },

  // ── Filter bar ────────────────────────────────────────────

  _filterBarHTML(session) {
    const f = this._filters;

    const allWeeks = [...new Set(
      session.questionSnapshot.flatMap(q => q.weekTags)
    )].sort((a, b) => parseInt(a.replace(/\D/g, '')) - parseInt(b.replace(/\D/g, '')));
    const allTags = [...new Set(
      session.questionSnapshot.flatMap(q => getTags(q))
    )].sort();

    const flagDefs = [
      ['usedNotes',    'Used Notes'],
      ['notConfident', 'Not Confident'],
      ['flagged',      'Flagged'],
      ['guessed',      'Guessed'],
      ['retryLater',   'Retry Later'],
    ];
    const gradeDefs = [
      ['all',      'All'],
      ['ungraded', 'Ungraded'],
      ['0',        '0 – Wrong'],
      ['0.5',      '0.5 – Partial'],
      ['1',        '1 – Correct'],
    ];

    const hasFilters = f.weeks.length > 0 || f.flags.length > 0 ||
                       f.grade !== 'all' || f.unanswered || f.weakOnly ||
                       f.tags.length > 0;
    const shown = this._filteredQuestions().length;
    const total = session.questionSnapshot.length;

    return `
      <div class="filter-section">
        ${allWeeks.length > 0 ? `
          <div class="filter-row">
            <span class="filter-label">Week</span>
            <div class="filter-chips">
              ${allWeeks.map(w => `
                <button class="filter-chip ${f.weeks.includes(w) ? 'filter-chip-active' : ''}"
                        onclick="Review.toggleFilterWeek('${w}')">${w}</button>
              `).join('')}
            </div>
          </div>
        ` : ''}

        ${allTags.length > 0 ? `
          <div class="filter-row">
            <span class="filter-label">Tags</span>
            <div class="filter-chips">
              ${allTags.map(t =>
                `<button class="filter-chip ${f.tags.includes(t) ? 'filter-chip-active' : ''}"
                         data-tag="${this._esc(t)}"
                         onclick="Review.toggleFilterTag(this.dataset.tag)">${this._esc(t)}</button>`
              ).join('')}
            </div>
          </div>
        ` : ''}

        <div class="filter-row">
          <span class="filter-label">Flags</span>
          <div class="filter-chips">
            ${flagDefs.map(([key, label]) => `
              <button class="filter-chip ${f.flags.includes(key) ? 'filter-chip-active' : ''}"
                      onclick="Review.toggleFilterFlag('${key}')">${label}</button>
            `).join('')}
          </div>
        </div>

        <div class="filter-row">
          <span class="filter-label">Grade</span>
          <div class="filter-chips">
            ${gradeDefs.map(([val, label]) => `
              <button class="filter-chip ${f.grade === val ? 'filter-chip-active' : ''}"
                      onclick="Review.setFilterGrade('${val}')">${label}</button>
            `).join('')}
            <button class="filter-chip ${f.unanswered ? 'filter-chip-active' : ''}"
                    onclick="Review.toggleFilterBool('unanswered')">Unanswered</button>
            <button class="filter-chip filter-chip-weak ${f.weakOnly ? 'filter-chip-active filter-chip-weak-active' : ''}"
                    onclick="Review.toggleFilterBool('weakOnly')">Weak Only</button>
          </div>
        </div>

        <div class="filter-row filter-status-row">
          <span class="filter-count">
            ${hasFilters ? `${shown} of ${total} shown` : `${total} question${total !== 1 ? 's' : ''}`}
          </span>
          ${hasFilters
            ? `<button class="btn btn-sm btn-ghost" onclick="Review.clearFilters()">&#10005; Clear filters</button>`
            : ''}
        </div>
      </div>
    `;
  },

  // ── Filter event handlers ─────────────────────────────────

  toggleFilterWeek(week) {
    const idx = this._filters.weeks.indexOf(week);
    if (idx >= 0) this._filters.weeks.splice(idx, 1);
    else          this._filters.weeks.push(week);
    this._applyFilters();
  },

  toggleFilterFlag(flag) {
    const idx = this._filters.flags.indexOf(flag);
    if (idx >= 0) this._filters.flags.splice(idx, 1);
    else          this._filters.flags.push(flag);
    this._applyFilters();
  },

  setFilterGrade(val) {
    this._filters.grade = val;
    this._applyFilters();
  },

  toggleFilterBool(key) {
    this._filters[key] = !this._filters[key];
    this._applyFilters();
  },

  toggleFilterTag(tag) {
    const idx = this._filters.tags.indexOf(tag);
    if (idx >= 0) this._filters.tags.splice(idx, 1);
    else          this._filters.tags.push(tag);
    this._applyFilters();
  },

  clearFilters() {
    this._filters = { weeks: [], flags: [], grade: 'all', unanswered: false, weakOnly: false, tags: [] };
    this._applyFilters();
  },

  _applyFilters() {
    this._flushReasonText();
    const fb = document.getElementById('review-filter-bar');
    if (fb) fb.innerHTML = this._filterBarHTML(this.selectedSession);
    this._injectCards();
  },

  // ── Card rendering ────────────────────────────────────────

  _filteredQuestions() {
    const session = this.selectedSession;
    if (!session) return [];
    const f = this._filters;
    return session.questionSnapshot
      .map((q, idx) => ({ q, r: this._safeResponse(session.responses[q.id]), idx }))
      .filter(({ q, r }) => {
        if (f.weeks.length > 0 && !f.weeks.some(w => q.weekTags.includes(w))) return false;
        for (const flag of f.flags) { if (!r[flag]) return false; }
        if (f.grade !== 'all') {
          if (f.grade === 'ungraded') { if (r.selfGrade !== null) return false; }
          else { if (r.selfGrade !== parseFloat(f.grade)) return false; }
        }
        if (f.unanswered) {
          if (r.answer && (typeof r.answer !== 'string' || r.answer.trim())) return false;
        }
        if (f.weakOnly && !this._isWeak(r)) return false;
        if (f.tags.length > 0 && !f.tags.some(t => getTags(q).includes(t))) return false;
        return true;
      });
  },

  _injectCards() {
    const el = document.getElementById('review-cards');
    if (!el) return;

    // Clear MathJax's tracking before replacing content so the next
    // typesetMath call sees all math nodes as unprocessed.
    clearMath(el);

    const filtered = this._filteredQuestions();
    if (filtered.length === 0) {
      el.innerHTML = `<div class="empty-state">
        <p>No questions match the current filters.
          <button class="btn btn-sm btn-ghost" onclick="Review.clearFilters()">Clear filters</button>
        </p>
      </div>`;
    } else {
      const allQs = Storage.getQuestions();
      el.innerHTML = filtered.map(({ q, r, idx }) => this._cardHTML(q, r, idx, allQs)).join('');
    }
    // Re-apply global collapse
    if (!this._showModelAnswers) {
      el.querySelectorAll('.model-answer-body').forEach(b => b.classList.add('hidden'));
      el.querySelectorAll('.model-toggle-btn').forEach(btn => btn.textContent = 'Expand');
    }
    // Re-apply per-card collapse states
    this._hiddenModelAnswers.forEach(qId => {
      const body = document.getElementById('model-body-' + qId);
      const btn  = document.querySelector('#model-' + qId + ' .model-toggle-btn');
      if (body) body.classList.add('hidden');
      if (btn)  btn.textContent = 'Expand';
    });
    // Typeset math in all newly rendered markdown content
    typesetMath(el);
  },

  _cardHTML(q, r, originalIdx, allQuestions) {
    const typeLabel = { short: 'Short Answer', long: 'Long Answer', mcq: 'MCQ' }[q.type] || q.type;
    const weak      = this._isWeak(r);
    const weekBadges = q.weekTags.map(w =>
      `<span class="week-tag week-tag-${w.replace(/\D/g, '')}">${w}</span>`
    ).join('');
    const liveQ      = (allQuestions || Storage.getQuestions())[q.id];
    const status     = (liveQ && liveQ.status) || 'new';
    const statusLbl  = { new: 'New', learning: 'Learning', solid: 'Solid', mastered: 'Mastered' }[status];
    const isCollapsed = this._hiddenModelAnswers.has(q.id) || !this._showModelAnswers;

    const modelHidden = !this._showModelAnswers || this._hiddenModelAnswers.has(q.id);

    return `
      <div class="review-card ${weak ? 'review-card-weak' : ''}" data-qid="${q.id}">

        <div class="review-card-header">
          <div class="review-card-meta">
            <span class="q-index">Q${originalIdx + 1}</span>
            <span class="type-badge type-${q.type}">${typeLabel}</span>
            ${weekBadges}
            ${getTags(q).map(t => `<span class="tag-badge">${this._esc(t)}</span>`).join('')}
            <span class="status-badge status-${status}">${statusLbl}</span>
            ${weak ? `<span class="weak-badge">Weak</span>` : ''}
          </div>
        </div>

        <div class="review-card-body">

          <div class="review-card-prompt md-rendered">${renderMarkdown(q.prompt)}</div>

          ${q.instructions
            ? `<div class="review-instructions md-rendered">${renderMarkdown(q.instructions)}</div>`
            : ''}

          ${this._testFlagsHTML(r)}

          <div class="answer-grid">
            <div class="answer-col answer-col-yours">
              <div class="answer-col-header">Your Answer</div>
              <div class="answer-col-body">${this._yourAnswerHTML(q, r)}</div>
            </div>
            <div class="answer-col model-answer-section"
                 id="model-${q.id}">
              <div class="answer-col-header">
                Model Answer
                <button class="model-toggle-btn"
                        onclick="Review.toggleModelAnswer('${q.id}')">
                  ${isCollapsed ? 'Expand' : 'Collapse'}
                </button>
              </div>
              <div id="model-body-${q.id}"
                   class="answer-col-body model-answer-body${isCollapsed ? ' hidden' : ''}">
                ${this._modelAnswerHTML(q)}
              </div>
            </div>
          </div>

          <div class="review-controls">
            <div class="control-row">
              <span class="control-label">Self-grade</span>
              <div class="grade-btns">
                <button class="grade-btn grade-wrong ${r.selfGrade === 0 ? 'grade-active grade-wrong-active' : ''}"
                        onclick="Review.setSelfGrade('${q.id}', 0)">
                  <span class="grade-num">0</span>
                  <span class="grade-lbl">Wrong</span>
                </button>
                <button class="grade-btn grade-partial ${r.selfGrade === 0.5 ? 'grade-active grade-partial-active' : ''}"
                        onclick="Review.setSelfGrade('${q.id}', 0.5)">
                  <span class="grade-num">&frac12;</span>
                  <span class="grade-lbl">Partial</span>
                </button>
                <button class="grade-btn grade-correct ${r.selfGrade === 1 ? 'grade-active grade-correct-active' : ''}"
                        onclick="Review.setSelfGrade('${q.id}', 1)">
                  <span class="grade-num">1</span>
                  <span class="grade-lbl">Correct</span>
                </button>
              </div>
              <button class="retry-btn ${r.retryLater ? 'retry-active' : ''}"
                      onclick="Review.toggleRetryLater('${q.id}')">
                &#8635; Retry Later
              </button>
            </div>

            <div class="control-row">
              <span class="control-label">Error reason</span>
              <div class="error-reason-wrap">
                <select class="form-input error-reason-select"
                        onchange="Review.setErrorReason('${q.id}', this.value)">
                  <option value="">— Why did you struggle? (optional) —</option>
                  ${this.ERROR_REASONS.map(([val, label]) =>
                    `<option value="${val}" ${r.errorReason === val ? 'selected' : ''}>${label}</option>`
                  ).join('')}
                </select>
                <div id="reason-text-${q.id}" class="${r.errorReason === 'other' ? '' : 'hidden'}">
                  <textarea class="form-input reason-text-input"
                            data-qid="${q.id}"
                            rows="2"
                            placeholder="Describe what went wrong&#8230;"
                            oninput="Review.onReasonText('${q.id}', this.value)"
                    onblur="Review.onReasonTextBlur('${q.id}', this.value)"
                  >${this._esc(r.errorReasonText || '')}</textarea>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    `;
  },

  _testFlagsHTML(r) {
    const defs = [
      ['usedNotes',    'Used Notes'],
      ['notConfident', 'Not Confident'],
      ['flagged',      'Flagged'],
      ['guessed',      'Guessed'],
    ];
    const active = defs.filter(([key]) => r[key]);
    if (active.length === 0) return '';
    return `
      <div class="test-flags-row">
        <span class="flags-label">Flagged during test:</span>
        ${active.map(([, label]) => `<span class="test-flag-chip">${label}</span>`).join('')}
      </div>
    `;
  },

  _yourAnswerHTML(q, r) {
    if (!r.answer || (typeof r.answer === 'string' && !r.answer.trim())) {
      return `<span class="no-answer">No answer given</span>`;
    }
    if (q.type === 'mcq') {
      const opt = (q.mcqOptions || []).find(o => o.id === r.answer);
      return opt
        ? `<span class="mcq-answer-text">${this._esc(opt.text)}</span>`
        : `<span class="no-answer">Unknown option</span>`;
    }
    return `<div class="typed-answer">${this._renderText(r.answer)}</div>`;
  },

  _modelAnswerHTML(q) {
    const parts = [];
    if (q.type === 'mcq') {
      const correct = (q.mcqOptions || []).filter(o => o.isCorrect);
      if (correct.length > 0) {
        parts.push(`<div class="model-mcq-correct">
          <strong>${correct.length === 1 ? 'Correct option' : 'Correct options'}:</strong>
          ${correct.map(o => this._esc(o.text)).join(', ')}
        </div>`);
      }
    }
    if (q.modelAnswer && q.modelAnswer.trim()) {
      parts.push(`<div class="model-answer-text md-rendered">${renderMarkdown(q.modelAnswer)}</div>`);
    } else {
      parts.push(`<span class="no-answer">No model answer provided</span>`);
    }
    return parts.join('');
  },

  // ── Interactive controls ──────────────────────────────────

  setSelfGrade(questionId, grade) {
    const r = this._getResponse(questionId);
    // Clicking the active grade again deselects it
    r.selfGrade = (r.selfGrade === grade) ? null : grade;
    Storage.saveSession(this.selectedSession);

    // Update grade button visuals without re-rendering the card
    const card = document.querySelector(`.review-card[data-qid="${questionId}"]`);
    if (card) {
      card.querySelectorAll('.grade-btn').forEach(btn => {
        let btnVal = null;
        if (btn.classList.contains('grade-wrong'))   btnVal = 0;
        if (btn.classList.contains('grade-partial'))  btnVal = 0.5;
        if (btn.classList.contains('grade-correct'))  btnVal = 1;
        const active = btnVal !== null && btnVal === r.selfGrade;
        btn.classList.toggle('grade-active', active);
        if (btn.classList.contains('grade-wrong'))   btn.classList.toggle('grade-wrong-active',   active);
        if (btn.classList.contains('grade-partial'))  btn.classList.toggle('grade-partial-active', active);
        if (btn.classList.contains('grade-correct'))  btn.classList.toggle('grade-correct-active', active);
      });
    }

    this._refreshWeakState(questionId, r);
    this._refreshSummary();
    // Re-apply filters if grade or weak filters are active — a grade change
    // may make a card no longer match the current filter view.
    if (this._filters.weakOnly || this._filters.grade !== 'all') {
      this._applyFilters();
    }
  },

  toggleRetryLater(questionId) {
    const r = this._getResponse(questionId);
    r.retryLater = !r.retryLater;
    Storage.saveSession(this.selectedSession);
    const btn = document.querySelector(`.review-card[data-qid="${questionId}"] .retry-btn`);
    if (btn) btn.classList.toggle('retry-active', r.retryLater);
    this._refreshWeakState(questionId, r);
    this._refreshSummary();
    // Re-apply filters if weak filter is active — a retry-later change
    // may make a card match or stop matching the "Weak Only" filter.
    if (this._filters.weakOnly) {
      this._applyFilters();
    }
  },

  setErrorReason(questionId, reason) {
    const r = this._getResponse(questionId);
    r.errorReason = reason || null;
    Storage.saveSession(this.selectedSession);
    const textEl = document.getElementById('reason-text-' + questionId);
    if (textEl) textEl.classList.toggle('hidden', reason !== 'other');
  },

  onReasonText(questionId, value) {
    this._getResponse(questionId).errorReasonText = value;
    clearTimeout(this._reasonTimer);
    showSavePending();
    this._reasonTimer = setTimeout(() => {
      Storage.saveSession(this.selectedSession);
      showSaved();
    }, 500);
  },

  onReasonTextBlur(questionId, value) {
    // Flush immediately on blur — don't wait for the debounce timer
    clearTimeout(this._reasonTimer);
    const r = this._getResponse(questionId);
    r.errorReasonText = value;
    Storage.saveSession(this.selectedSession);
    showSaved();
  },

  // ── Model answer toggle ───────────────────────────────────

  toggleModelAnswer(questionId) {
    const body    = document.getElementById('model-body-' + questionId);
    const section = document.getElementById('model-' + questionId);
    const btn     = section && section.querySelector('.model-toggle-btn');
    if (!body) return;

    const nowCollapsed = body.classList.toggle('hidden');
    if (btn) btn.textContent = nowCollapsed ? 'Expand' : 'Collapse';

    if (nowCollapsed) {
      this._hiddenModelAnswers.add(questionId);
    } else {
      this._hiddenModelAnswers.delete(questionId);
      typesetMath(body);
    }
  },

  toggleAllModelAnswers() {
    this._showModelAnswers = !this._showModelAnswers;
    const collapse = !this._showModelAnswers;
    const cards    = document.getElementById('review-cards');
    if (!cards) return;

    cards.querySelectorAll('.model-answer-body').forEach(b => {
      b.classList.toggle('hidden', collapse);
    });
    cards.querySelectorAll('.model-toggle-btn').forEach(btn => {
      btn.textContent = collapse ? 'Expand' : 'Collapse';
    });

    if (collapse) {
      this.selectedSession.questionSnapshot.forEach(q => this._hiddenModelAnswers.add(q.id));
    } else {
      this._hiddenModelAnswers.clear();
      cards.querySelectorAll('.model-answer-body').forEach(b => typesetMath(b));
    }

    this._syncGlobalModelBtn();
  },

  _syncGlobalModelBtn() {
    const btn = document.getElementById('global-model-btn');
    if (btn) btn.textContent = this._showModelAnswers ? 'Collapse all answers' : 'Expand all answers';
  },

  // ── Weak state helpers ────────────────────────────────────

  _refreshWeakState(questionId, r) {
    const card = document.querySelector(`.review-card[data-qid="${questionId}"]`);
    if (!card) return;
    const weak = this._isWeak(r);
    card.classList.toggle('review-card-weak', weak);
    const badge = card.querySelector('.weak-badge');
    if (weak && !badge) {
      const newBadge = document.createElement('span');
      newBadge.className = 'weak-badge';
      newBadge.textContent = 'Weak';
      const meta = card.querySelector('.review-card-meta');
      if (meta) meta.appendChild(newBadge);
    } else if (!weak && badge) {
      badge.remove();
    }
  },

  _refreshSummary() {
    const summaryEl = document.getElementById('review-summary');
    if (summaryEl) summaryEl.innerHTML = this._summaryHTML(this.selectedSession);
    const stats = this._computeStats(this.selectedSession);
    const redoBtn = document.getElementById('redo-weak-btn');
    if (redoBtn) {
      redoBtn.textContent = `Redo Weak (${stats.weak})`;
      redoBtn.disabled    = stats.weak === 0;
      redoBtn.title       = stats.weak === 0
        ? 'No weak questions yet'
        : `Redo ${stats.weak} weak question${stats.weak !== 1 ? 's' : ''}`;
    }
  },

  _flushReasonText() {
    clearTimeout(this._reasonTimer);
    const ta = document.querySelector('.reason-text-input');
    if (ta && ta.dataset.qid && this.selectedSession) {
      this._getResponse(ta.dataset.qid).errorReasonText = ta.value;
      Storage.saveSession(this.selectedSession);
      showSaved();
    }
  },

  // ── Redo Weak Questions ───────────────────────────────────

  redoWeak() {
    const session = this.selectedSession;
    const weakQs  = session.questionSnapshot.filter(q =>
      this._isWeak(this._safeResponse(session.responses[q.id]))
    );

    if (weakQs.length === 0) {
      this._toast('No weak questions found. Grade questions or set flags to identify weak ones.', 'error');
      return;
    }

    const noun = weakQs.length === 1 ? 'question' : 'questions';
    if (!confirm(
      `Create a fresh redo session with ${weakQs.length} weak ${noun}?\n\n` +
      `Your current review grades and notes will be kept.`
    )) return;

    const responses = {};
    weakQs.forEach(q => { responses[q.id] = Models.createResponse(); });

    const redoSession = Models.createSession({
      testId:           session.testId,
      testTitle:        'Redo: ' + session.testTitle,
      mode:             session.mode,
      questionSnapshot: weakQs,
      responses,
    });
    // Extra metadata — not part of the formal model but harmless extra fields
    redoSession.isRedo = true;
    redoSession.redoOf = session.id;

    Storage.saveSession(redoSession);

    Runner.session    = redoSession;
    Runner.currentIdx = 0;
    Router.navigate('runner');
  },

  // ── Stats computation ─────────────────────────────────────

  _computeStats(session) {
    let answered = 0, usedNotes = 0, notConfident = 0, flagged = 0,
        guessed  = 0, retryLater = 0, weak = 0,
        gradeSum = 0, gradeCount = 0;
    const weakByWeek = {};

    session.questionSnapshot.forEach(q => {
      const r = this._safeResponse(session.responses[q.id]);
      if (r.answer && (typeof r.answer !== 'string' || r.answer.trim())) answered++;
      if (r.usedNotes)    usedNotes++;
      if (r.notConfident) notConfident++;
      if (r.flagged)      flagged++;
      if (r.guessed)      guessed++;
      if (r.retryLater)   retryLater++;
      if (r.selfGrade !== null) { gradeSum += r.selfGrade; gradeCount++; }
      if (this._isWeak(r)) {
        weak++;
        q.weekTags.forEach(w => { weakByWeek[w] = (weakByWeek[w] || 0) + 1; });
      }
    });

    return {
      total:       session.questionSnapshot.length,
      answered,
      unanswered:  session.questionSnapshot.length - answered,
      usedNotes, notConfident, flagged, guessed, retryLater,
      avgGrade:    gradeCount > 0 ? gradeSum / gradeCount : null,
      weak, weakByWeek,
    };
  },

  _isWeak(r) {
    if (!r) return false;
    return r.usedNotes ||
           r.notConfident ||
           r.flagged ||
           r.retryLater ||
           (r.selfGrade !== null && r.selfGrade < 1);
  },

  /** Read-only safe copy of a response — fills in missing fields with defaults. */
  _safeResponse(r) {
    return { ...Models.createResponse(), ...(r || {}) };
  },

  /**
   * Mutable reference to a response — adds default fields in-place (migration).
   * Use this for writes; use _safeResponse for reads only.
   */
  _getResponse(questionId) {
    if (!this.selectedSession.responses[questionId]) {
      this.selectedSession.responses[questionId] = Models.createResponse();
    }
    const r        = this.selectedSession.responses[questionId];
    const defaults = Models.createResponse();
    Object.keys(defaults).forEach(k => { if (!(k in r)) r[k] = defaults[k]; });
    return r;
  },

  // ── Question status editing ─────────────────────────────

  setQuestionStatus(questionId, status) {
    const all = Storage.getQuestions();
    if (!all[questionId]) return;
    all[questionId].status = status;
    Storage.saveQuestion(all[questionId]);
    showSaved();
    // Update all DOM references for this question without re-rendering
    const cards = document.querySelectorAll(`.review-card[data-qid="${questionId}"]`);
    const lbl   = { new: 'New', learning: 'Learning', solid: 'Solid', mastered: 'Mastered' };
    cards.forEach(card => {
      const badge = card.querySelector('.status-badge');
      if (badge) { badge.className = `status-badge status-${status}`; badge.textContent = lbl[status]; }
      card.querySelectorAll('.status-btn-sm').forEach(btn => {
        btn.classList.toggle('status-btn-sm-active', btn.dataset.status === status);
      });
    });
  },

  // ── Session export ───────────────────────────────────────

  exportSession(sessionId) {
    // Flush any pending debounced text before reading the session from storage
    this._flushReasonText();
    const session = Storage.getSessions()[sessionId];
    if (!session) return;
    const payload = {
      schemaVersion: 1,
      type:          'exam-practice-session',
      exportedAt:    Date.now(),
      session,
    };
    const safeTitle = (session.testTitle || 'session').replace(/[^a-z0-9]/gi, '_').slice(0, 40);
    const dateStr   = new Date().toISOString().slice(0, 10);
    this._downloadJSON(payload, `session_${safeTitle}_${dateStr}.json`);
  },

  openSource(sessionId) {
    this._flushReasonText();
    const source = Storage.getSessions()[sessionId];
    if (!source) {
      this._toast('Original session no longer exists.', 'error');
      return;
    }
    this.openSession(sessionId);
    this.render();
  },

  // ── Utilities ─────────────────────────────────────────────

  _modeLabel(mode) {
    return { 'open-book': 'Open Book', 'one-note-check': 'One Note Check', 'closed-book': 'Closed Book' }[mode] || mode;
  },

  _renderText(str) {
    return this._esc(str).replace(/\n/g, '<br>');
  },

  _toast(msg, type = 'success') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), type === 'error' ? 4000 : 2500);
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
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  },

  _downloadJSON(payload, filename) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};
