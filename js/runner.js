/**
 * runner.js — Take Test flow.
 *
 * UI states:
 *   1. Test selection  — list saved tests + any in-progress sessions
 *   2. Mode selection  — choose study mode before starting
 *   3. Active question — question card with answer input, flags, navigation
 *   4. Complete        — summary screen after finishing
 *
 * All answer and flag changes are written to this.session in memory
 * immediately, then flushed to localStorage. Text answers are debounced
 * (500 ms); flag toggles and MCQ selections save instantly.
 * Navigating always flushes the current text answer first.
 */
const Runner = {
  session:        null,   // active Session object (null = no active session)
  currentIdx:     0,      // index into session.questionSnapshot
  _saveTimer:     null,   // debounce handle for text autosave
  _pendingPresets: null,  // preset groups built during mode-selection render

  // ── Init ─────────────────────────────────────────────────

  init() {
    Router.register('runner', () => this.render());
  },

  render() {
    const el = document.getElementById('section-runner');
    if (!this.session) {
      this._renderTestSelection(el);
    } else if (!this.session.completedAt) {
      this._renderQuestion(el);
    } else {
      this._renderComplete(el);
    }
  },

  // ── 1. Test Selection ────────────────────────────────────

  _renderTestSelection(el) {
    const tests    = Object.values(Storage.getTests()).sort((a, b) => b.updatedAt - a.updatedAt);
    const sessions = Object.values(Storage.getSessions());
    const inProgress = sessions.filter(s => !s.completedAt);

    el.innerHTML = `
      <div class="page-header">
        <h1>Take Test</h1>
      </div>

      ${inProgress.length > 0 ? `
        <div class="runner-section-block">
          <h2 class="section-label">Resume in progress</h2>
          <div class="test-list">
            ${inProgress.map(s => this._renderResumeCard(s)).join('')}
          </div>
        </div>
      ` : ''}

      <div class="runner-section-block">
        ${inProgress.length > 0 ? '<h2 class="section-label">Start a new test</h2>' : ''}
        ${tests.length === 0
          ? `<div class="empty-state">
               <p>No tests yet. Go to <a href="#builder">Builder</a> to create one first.</p>
             </div>`
          : `<div class="test-list">
               ${tests.map(t => this._renderTestCard(t)).join('')}
             </div>`
        }
      </div>
    `;
  },

  _renderResumeCard(session) {
    const answered = Object.values(session.responses)
      .filter(r => r.answer && (typeof r.answer === 'string' ? r.answer.trim() : true)).length;
    const total    = session.questionSnapshot.length;
    const pct      = total ? Math.round((answered / total) * 100) : 0;
    return `
      <div class="test-card">
        <div class="test-card-info">
          <div class="test-card-badges">
            ${session.shuffled   ? '<span class="hbadge hbadge-shuffled">Shuffled</span>'  : ''}
            ${session.isFiltered ? '<span class="hbadge hbadge-filtered">Filtered</span>'  : ''}
          </div>
          <h3>${this._esc(session.testTitle)}</h3>
          <span class="meta">
            ${answered} / ${total} answered &middot;
            ${this._modeLabel(session.mode)} &middot;
            Started ${this._fmtDate(session.startedAt)}
          </span>
          <div class="mini-progress-track" title="${pct}% answered">
            <div class="mini-progress-fill" style="width:${pct}%"></div>
          </div>
        </div>
        <div class="test-card-actions">
          <button class="btn btn-sm btn-primary"
                  onclick="Runner.resumeSession('${session.id}')">Resume</button>
          <button class="btn btn-sm btn-secondary"
                  onclick="Runner.discardSession('${session.id}')">Discard</button>
        </div>
      </div>
    `;
  },

  _renderTestCard(test) {
    const questions = Storage.getQuestions();
    const qCount = test.questionIds.filter(id => questions[id]).length;
    return `
      <div class="test-card">
        <div class="test-card-info">
          <h3>${this._esc(test.title)}</h3>
          ${test.description ? `<p>${this._esc(test.description)}</p>` : ''}
          <span class="meta">${qCount} question${qCount !== 1 ? 's' : ''}</span>
        </div>
        <div class="test-card-actions">
          <button class="btn btn-sm btn-primary"
                  onclick="Runner.selectTest('${test.id}')">Start</button>
        </div>
      </div>
    `;
  },

  selectTest(testId) {
    const test = Storage.getTests()[testId];
    if (!test) return;
    this._renderModeSelection(document.getElementById('section-runner'), test);
  },

  resumeSession(sessionId) {
    const session = Storage.getSessions()[sessionId];
    if (!session) return;
    this.session = session;
    // Resume at first unanswered question, or question 0
    const firstUnanswered = session.questionSnapshot.findIndex(q => {
      const r = session.responses[q.id];
      return !r || !r.answer || (typeof r.answer === 'string' && !r.answer.trim());
    });
    this.currentIdx = firstUnanswered >= 0 ? firstUnanswered : 0;
    // Navigate to runner section (needed when called from History)
    if (window.location.hash.replace('#', '') !== 'runner') {
      Router.navigate('runner');
    } else {
      this.render();
    }
  },

  discardSession(sessionId) {
    if (!confirm('Discard this in-progress session? Your answers will be lost.')) return;
    Storage.deleteSession(sessionId);
    this.render();
  },

  // ── 2. Mode Selection ────────────────────────────────────

  _renderModeSelection(el, test) {
    const questions = Storage.getQuestions();
    const testQs    = test.questionIds.map(id => questions[id]).filter(Boolean);
    const qCount    = testQs.length;
    this._pendingTestId = test.id;

    // Unique weeks used by this test's questions, in numeric order
    const allWeeks = [...new Set(testQs.flatMap(q => q.weekTags))]
      .sort((a, b) => parseInt(a.replace(/\D/g,'') || 0) - parseInt(b.replace(/\D/g,'') || 0));

    el.innerHTML = `
      <div class="page-header">
        <button class="btn btn-ghost" onclick="Runner._cancelMode()">&#8592; Back</button>
        <h1>${this._esc(test.title)}</h1>
      </div>

      <div class="mode-card">
        <h2>Choose Study Mode</h2>
        <p class="mode-card-sub">${qCount} question${qCount !== 1 ? 's' : ''}</p>

        <div class="mode-options">
          <label class="mode-option">
            <input type="radio" name="study-mode" value="open-book" checked>
            <div class="mode-option-body">
              <strong>Open Book</strong>
              <span>Use your notes freely throughout</span>
            </div>
          </label>
          <label class="mode-option">
            <input type="radio" name="study-mode" value="one-note-check">
            <div class="mode-option-body">
              <strong>One Note Check</strong>
              <span>One reference allowed per question</span>
            </div>
          </label>
          <label class="mode-option">
            <input type="radio" name="study-mode" value="closed-book">
            <div class="mode-option-body">
              <strong>Closed Book</strong>
              <span>No notes — test yourself from memory</span>
            </div>
          </label>
        </div>

        <hr class="mode-divider">

        <label class="mode-option shuffle-option">
          <input type="checkbox" name="shuffle-questions"
                 ${localStorage.getItem('exam_shuffle_pref') === '1' ? 'checked' : ''}>
          <div class="mode-option-body">
            <strong>Shuffle questions</strong>
            <span>Randomise order for this session only</span>
          </div>
        </label>

        ${allWeeks.length > 1 ? this._weekFilterHTML(allWeeks, testQs) : ''}

        <button class="btn btn-primary btn-start-test"
                onclick="Runner.startTest('${test.id}')">Start Test &rarr;</button>
      </div>
    `;
  },

  /**
   * Render the week-filter section for the mode-selection card.
   * Only called when the test has 2+ distinct week tags.
   */
  _weekFilterHTML(allWeeks, testQs) {
    // Quick presets: only include a preset group when the test uses at least
    // one week in that range.  Show the preset row only when 2+ groups match.
    const presetDefs = [
      { label: 'Wks 1–4',  weeks: ['Week 1','Week 2','Week 3','Week 4']   },
      { label: 'Wks 5–8',  weeks: ['Week 5','Week 6','Week 7','Week 8']   },
      { label: 'Wks 9–12', weeks: ['Week 9','Week 10','Week 11','Week 12'] },
    ];
    const activePresets = presetDefs.filter(p => p.weeks.some(w => allWeeks.includes(w)));
    this._pendingPresets = activePresets;
    const showPresets = activePresets.length > 1;

    const qCount = testQs.length;
    return `
      <hr class="mode-divider">
      <div class="week-filter-section">
        <div class="week-filter-header">
          <span class="week-filter-label">Week filter</span>
          <button type="button" class="btn btn-sm btn-ghost"
                  onclick="Runner._weekSelectAll(true)">All</button>
          <button type="button" class="btn btn-sm btn-ghost"
                  onclick="Runner._weekSelectAll(false)">None</button>
          ${showPresets ? activePresets.map(p => `
            <button type="button" class="btn btn-sm btn-ghost week-preset-btn"
                    data-preset="${this._esc(JSON.stringify(p.weeks))}"
                    onclick="Runner._weekSelectPreset(this.dataset.preset)">${p.label}</button>
          `).join('') : ''}
        </div>
        <div class="week-filter-grid">
          ${allWeeks.map(w => `
            <label class="week-filter-item">
              <input type="checkbox" class="week-filter-check"
                     value="${this._esc(w)}" checked
                     onchange="Runner._updateWeekCount()">
              <span class="week-tag week-tag-${w.replace(/\D/g,'')}">${this._esc(w)}</span>
            </label>
          `).join('')}
        </div>
        <p class="week-filter-count" id="week-filter-count">
          ${qCount} question${qCount !== 1 ? 's' : ''} selected
        </p>
      </div>
    `;
  },

  // ── Week-filter event handlers ────────────────────────

  _getSelectedWeeks() {
    return Array.from(document.querySelectorAll('.week-filter-check:checked'))
      .map(cb => cb.value);
  },

  _weekSelectAll(checked) {
    document.querySelectorAll('.week-filter-check').forEach(cb => { cb.checked = checked; });
    this._updateWeekCount();
  },

  _weekSelectPreset(jsonWeeks) {
    let weekList;
    try { weekList = JSON.parse(jsonWeeks); } catch (e) { return; }
    document.querySelectorAll('.week-filter-check').forEach(cb => {
      cb.checked = weekList.includes(cb.value);
    });
    this._updateWeekCount();
  },

  _updateWeekCount() {
    const test = this._pendingTestId ? Storage.getTests()[this._pendingTestId] : null;
    if (!test) return;
    const questions  = Storage.getQuestions();
    const testQs     = test.questionIds.map(id => questions[id]).filter(Boolean);
    const allChecks  = document.querySelectorAll('.week-filter-check');
    const selected   = this._getSelectedWeeks();
    const allTicked  = selected.length === allChecks.length;
    const count      = allTicked
      ? testQs.length
      : testQs.filter(q => q.weekTags.some(w => selected.includes(w))).length;
    const el = document.getElementById('week-filter-count');
    if (!el) return;
    el.textContent  = count === 0
      ? 'No questions match — select at least one week'
      : `${count} question${count !== 1 ? 's' : ''} selected`;
    el.className    = 'week-filter-count' + (count === 0 ? ' week-filter-count-empty' : '');
  },

  _cancelMode() {
    this._pendingTestId = null;
    this.session = null;
    this.render();
  },

  startTest(testId) {
    const test = Storage.getTests()[testId];
    if (!test) return;

    const questions = Storage.getQuestions();
    const testQs    = test.questionIds.map(id => questions[id]).filter(Boolean);

    if (testQs.length === 0) {
      alert('This test has no questions. Add some in the Builder first.');
      return;
    }

    const modeEl    = document.querySelector('input[name="study-mode"]:checked');
    const mode       = modeEl ? modeEl.value : 'open-book';
    const shuffleEl  = document.querySelector('input[name="shuffle-questions"]');
    const doShuffle  = shuffleEl ? shuffleEl.checked : false;

    // Persist shuffle preference for next time
    try { localStorage.setItem('exam_shuffle_pref', doShuffle ? '1' : '0'); } catch (e) {}

    // Week filter — read selected weeks from the checkboxes (shown only when
    // the test has 2+ distinct weeks).  If all boxes are checked, treat as
    // unfiltered so session metadata stays clean.
    const weekCheckboxes = document.querySelectorAll('.week-filter-check');
    const selectedWeeks  = Array.from(weekCheckboxes)
      .filter(cb => cb.checked).map(cb => cb.value);
    const isFiltered     = weekCheckboxes.length > 0 &&
                           selectedWeeks.length < weekCheckboxes.length;

    // If the filter UI is visible and no week is ticked, block the start.
    if (weekCheckboxes.length > 0 && selectedWeeks.length === 0) {
      alert('Please select at least one week to include in the session.');
      return;
    }

    // Apply week filter: keep questions whose weekTags overlap the selection.
    // When isFiltered is false, use the full list unchanged.
    let orderedQs = isFiltered
      ? testQs.filter(q => q.weekTags.some(w => selectedWeeks.includes(w)))
      : testQs;

    if (orderedQs.length === 0) {
      alert('No questions match the selected weeks. Please broaden your selection.');
      return;
    }

    // Apply Fisher-Yates shuffle AFTER filtering — never mutates the source array
    if (doShuffle) {
      orderedQs = [...orderedQs];
      for (let i = orderedQs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [orderedQs[i], orderedQs[j]] = [orderedQs[j], orderedQs[i]];
      }
    }

    // Build an initial (empty) responses map
    const responses = {};
    orderedQs.forEach(q => { responses[q.id] = Models.createResponse(); });

    this.session    = Models.createSession({
      testId:           test.id,
      testTitle:        test.title,
      mode,
      questionSnapshot: orderedQs,  // filtered + shuffled order — fixed for the session
      responses,
    });
    // Extra metadata fields (not part of the core model schema)
    this.session.shuffled      = doShuffle;
    this.session.selectedWeeks = isFiltered ? selectedWeeks : [];
    this.session.isFiltered    = isFiltered;
    this.currentIdx = 0;
    Storage.saveSession(this.session);
    this.render();
  },

  // ── 3. Active Question ───────────────────────────────────

  _renderQuestion(el) {
    const { session, currentIdx } = this;
    const q        = session.questionSnapshot[currentIdx];
    const response = session.responses[q.id] || Models.createResponse();
    const total    = session.questionSnapshot.length;
    const isFirst  = currentIdx === 0;
    const isLast   = currentIdx === total - 1;
    const pct      = Math.round(((currentIdx + 1) / total) * 100);

    // Tell MathJax to forget about the current content before we replace it.
    // Without this, MathJax's internal state for the element is stale after
    // innerHTML is swapped, which can prevent subsequent typesets from running.
    clearMath(el);

    el.innerHTML = `
      <div class="runner-header">
        <div class="runner-header-top">
          <div class="runner-meta">
            <span class="mode-badge mode-${session.mode}">${this._modeLabel(session.mode)}</span>
            ${session.shuffled   ? '<span class="mode-badge mode-shuffled">Shuffled</span>'  : ''}
            ${session.isFiltered ? '<span class="mode-badge mode-filtered">Filtered</span>'  : ''}
            <span class="runner-test-name">${this._esc(session.testTitle)}</span>
          </div>
          <button class="btn btn-sm btn-ghost"
                  onclick="Runner.promptFinish()">Finish Test</button>
        </div>
        <div class="progress-row">
          <div class="progress-track">
            <div class="progress-fill" style="width:${pct}%"></div>
          </div>
          <span class="progress-label">Q ${currentIdx + 1} / ${total}</span>
        </div>
      </div>

      <div class="question-card">
        <div class="q-card-meta">
          ${q.weekTags.map(w =>
            `<span class="week-tag week-tag-${w.replace(/\D/g, '')}">${w}</span>`
          ).join('')}
          ${getTags(q).map(t => `<span class="tag-badge">${this._esc(t)}</span>`).join('')}
        </div>

        <div class="q-card-prompt md-rendered">${renderMarkdown(q.prompt)}</div>

        ${q.instructions
          ? `<div class="q-card-instructions md-rendered">${renderMarkdown(q.instructions)}</div>`
          : ''}

        <div class="q-card-answer">
          ${this._renderAnswerInput(q, response)}
        </div>

        <div class="q-card-flags">
          <span class="flags-label">Mark as:</span>
          ${this._flagBtn('usedNotes',    'Used Notes',      response, q.id)}
          ${this._flagBtn('notConfident', 'Not Confident',   response, q.id)}
          ${this._flagBtn('flagged',      'Flag for Review', response, q.id)}
          ${this._flagBtn('guessed',      'Guessed',         response, q.id)}
        </div>
      </div>

      <div class="runner-nav">
        <button class="btn btn-secondary"
                onclick="Runner.navigate(-1)"
                ${isFirst ? 'disabled' : ''}>&#8592; Previous</button>

        <div class="nav-dots-row">
          ${this._renderNavDots(session, currentIdx)}
        </div>

        ${isLast
          ? `<button class="btn btn-primary"
                     onclick="Runner.promptFinish()">Finish Test</button>`
          : `<button class="btn btn-primary"
                     onclick="Runner.navigate(1)">Next &#8594;</button>`
        }
      </div>
    `;

    // Typeset math in the newly rendered question card
    typesetMath(el);

    // Auto-focus text inputs for keyboard users
    setTimeout(() => {
      const ta = el.querySelector('.answer-textarea');
      if (ta) ta.focus();
    }, 30);
  },

  // ─── Answer input rendering ──────────────────────────────

  _renderAnswerInput(q, response) {
    if (q.type === 'mcq') {
      return `
        <fieldset class="mcq-fieldset">
          <legend class="sr-only">Choose an answer</legend>
          ${q.mcqOptions.map((opt, i) => `
            <label class="mcq-option ${response.answer === opt.id ? 'mcq-selected' : ''}">
              <input type="radio"
                     name="mcq-answer"
                     class="mcq-radio"
                     value="${opt.id}"
                     ${response.answer === opt.id ? 'checked' : ''}
                     onchange="Runner.setMcqAnswer('${q.id}', this.value)">
              <span class="mcq-option-letter">${String.fromCharCode(65 + i)}</span>
              <span class="mcq-option-text">${this._esc(opt.text)}</span>
            </label>
          `).join('')}
        </fieldset>
      `;
    }

    const rows = q.type === 'long' ? 8 : 4;
    const placeholder = q.type === 'long'
      ? 'Write your answer here\u2026'
      : 'Type your answer here\u2026';

    return `
      <textarea id="answer-input"
                class="form-input answer-textarea"
                rows="${rows}"
                placeholder="${placeholder}"
                oninput="Runner.onTextInput('${q.id}', this.value)"
      >${this._esc(response.answer)}</textarea>
    `;
  },

  _flagBtn(field, label, response, qId) {
    return `
      <button type="button"
              class="flag-btn ${response[field] ? 'flag-active' : ''}"
              data-field="${field}"
              onclick="Runner.toggleFlag('${qId}', '${field}')">${label}</button>
    `;
  },

  _renderNavDots(session, currentIdx) {
    const total = session.questionSnapshot.length;
    // Switch to text counter above 24 questions to avoid wrapping chaos
    if (total > 24) {
      return `<span class="nav-counter">Q ${currentIdx + 1} of ${total}</span>`;
    }
    return session.questionSnapshot.map((q, i) => {
      const r        = session.responses[q.id];
      const answered = r && r.answer && (typeof r.answer === 'string' ? r.answer.trim() : true);
      const flagged  = r && r.flagged;
      let cls = 'nav-dot';
      if (i === currentIdx) cls += ' nav-dot-current';
      else if (flagged)     cls += ' nav-dot-flagged';
      else if (answered)    cls += ' nav-dot-answered';
      return `<button class="${cls}" title="Q${i + 1}${answered ? ' \u2022 answered' : ''}${flagged ? ' \u2022 flagged' : ''}"
                      onclick="Runner.goTo(${i})"></button>`;
    }).join('');
  },

  // ─── Answer / flag event handlers ────────────────────────

  onTextInput(questionId, value) {
    // Update memory immediately so navigating never loses text
    this._ensureResponse(questionId).answer = value;
    // Debounce the storage write so we don't thrash on every keystroke
    clearTimeout(this._saveTimer);
    showSavePending();
    this._saveTimer = setTimeout(() => {
      Storage.saveSession(this.session);
      showSaved();
    }, 500);
  },

  setMcqAnswer(questionId, optionId) {
    this._ensureResponse(questionId).answer = optionId;
    Storage.saveSession(this.session);
    // Reflect selection without re-rendering the whole card
    document.querySelectorAll('.mcq-option').forEach(label => {
      const radio = label.querySelector('.mcq-radio');
      label.classList.toggle('mcq-selected', radio && radio.value === optionId);
    });
  },

  toggleFlag(questionId, field) {
    const r = this._ensureResponse(questionId);
    r[field] = !r[field];
    Storage.saveSession(this.session);
    // Reflect toggle without re-rendering
    document.querySelectorAll(`.flag-btn[data-field="${field}"]`).forEach(btn => {
      btn.classList.toggle('flag-active', r[field]);
    });
  },

  _ensureResponse(questionId) {
    if (!this.session.responses[questionId]) {
      this.session.responses[questionId] = Models.createResponse();
    }
    return this.session.responses[questionId];
  },

  // ─── Navigation ──────────────────────────────────────────

  navigate(direction) {
    this._flushAndSave();
    const newIdx = this.currentIdx + direction;
    if (newIdx < 0 || newIdx >= this.session.questionSnapshot.length) return;
    this.currentIdx = newIdx;
    this._renderQuestion(document.getElementById('section-runner'));
  },

  goTo(idx) {
    if (idx === this.currentIdx) return;
    this._flushAndSave();
    this.currentIdx = idx;
    this._renderQuestion(document.getElementById('section-runner'));
  },

  /**
   * Flush the current text answer from the DOM into memory and immediately
   * write to storage. Called before any navigation or finish action.
   * Text answers are in the DOM textarea; MCQ answers are already in memory.
   */
  _flushAndSave() {
    clearTimeout(this._saveTimer);
    const ta = document.getElementById('answer-input');
    if (ta) {
      const q = this.session.questionSnapshot[this.currentIdx];
      this._ensureResponse(q.id).answer = ta.value;
    }
    Storage.saveSession(this.session);
  },

  // ─── Finish ──────────────────────────────────────────────

  promptFinish() {
    this._flushAndSave();

    const unanswered = this.session.questionSnapshot.filter(q => {
      const r = this.session.responses[q.id];
      return !r || !r.answer || (typeof r.answer === 'string' && !r.answer.trim());
    }).length;

    if (unanswered > 0) {
      const noun = unanswered === 1 ? 'question' : 'questions';
      if (!confirm(`${unanswered} ${noun} left unanswered.\nFinish the test anyway?`)) return;
    }

    this.session.completedAt = Date.now();
    Storage.saveSession(this.session);
    this._renderComplete(document.getElementById('section-runner'));
  },

  // ── 4. Complete Screen ───────────────────────────────────

  _renderComplete(el) {
    const { session } = this;
    const total    = session.questionSnapshot.length;
    const responses = Object.values(session.responses);
    const answered  = responses.filter(r =>
      r.answer && (typeof r.answer === 'string' ? r.answer.trim() : true)
    ).length;
    const flagged   = responses.filter(r => r.flagged).length;
    const usedNotes = responses.filter(r => r.usedNotes).length;

    el.innerHTML = `
      <div class="complete-wrap">
        <div class="complete-card">
          <div class="complete-checkmark">&#10003;</div>
          <h1>Test Complete</h1>
          <p class="complete-subtitle">${this._esc(session.testTitle)}</p>
          <p class="complete-mode">${this._modeLabel(session.mode)}</p>

          <div class="complete-stats">
            ${this._stat(answered,         'Answered')}
            ${this._statDivider()}
            ${this._stat(total - answered, 'Skipped')}
            ${this._statDivider()}
            ${this._stat(flagged,          'Flagged')}
            ${this._statDivider()}
            ${this._stat(usedNotes,        'Used Notes')}
          </div>

          <div class="complete-actions">
            <button class="btn btn-primary" onclick="Runner.goToReview()">Review Answers &rarr;</button>
            <button class="btn btn-secondary" onclick="Runner.newSession()">Take Another Test</button>
          </div>
        </div>
      </div>
    `;
  },

  _stat(value, label) {
    return `
      <div class="c-stat">
        <span class="c-stat-value">${value}</span>
        <span class="c-stat-label">${label}</span>
      </div>`;
  },
  _statDivider() {
    return `<div class="c-stat-divider"></div>`;
  },

  goToReview() {
    if (this.session && this.session.completedAt) {
      Review.openSession(this.session.id);
    }
    Router.navigate('review');
  },

    newSession() {
    this.session    = null;
    this.currentIdx = 0;
    this.render();
  },

  // ── Utilities ────────────────────────────────────────────

  /** Render text with line breaks preserved (typed in builder textareas). */
  _renderText(str) {
    return this._esc(str).replace(/\n/g, '<br>');
  },

  _modeLabel(mode) {
    return {
      'open-book':      'Open Book',
      'one-note-check': 'One Note Check',
      'closed-book':    'Closed Book',
    }[mode] || mode;
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
    return new Date(ts).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  },
};
