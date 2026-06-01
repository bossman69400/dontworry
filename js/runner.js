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
  session:    null,   // active Session object (null = no active session)
  currentIdx: 0,      // index into session.questionSnapshot
  _saveTimer: null,   // debounce handle for text autosave

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
    this.render();
  },

  discardSession(sessionId) {
    if (!confirm('Discard this in-progress session? Your answers will be lost.')) return;
    Storage.deleteSession(sessionId);
    this.render();
  },

  // ── 2. Mode Selection ────────────────────────────────────

  _renderModeSelection(el, test) {
    const questions = Storage.getQuestions();
    const qCount = test.questionIds.filter(id => questions[id]).length;
    this._pendingTestId = test.id;

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

        <button class="btn btn-primary btn-start-test"
                onclick="Runner.startTest('${test.id}')">Start Test &rarr;</button>
      </div>
    `;
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

    const modeEl = document.querySelector('input[name="study-mode"]:checked');
    const mode   = modeEl ? modeEl.value : 'open-book';

    // Build an initial (empty) responses map
    const responses = {};
    testQs.forEach(q => { responses[q.id] = Models.createResponse(); });

    this.session    = Models.createSession({
      testId:           test.id,
      testTitle:        test.title,
      mode,
      questionSnapshot: testQs,
      responses,
    });
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

    el.innerHTML = `
      <div class="runner-header">
        <div class="runner-header-top">
          <div class="runner-meta">
            <span class="mode-badge mode-${session.mode}">${this._modeLabel(session.mode)}</span>
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
          ${q.subtopic ? `<span class="subtopic-badge">${this._esc(q.subtopic)}</span>` : ''}
        </div>

        <div class="q-card-prompt">${this._renderText(q.prompt)}</div>

        ${q.instructions
          ? `<div class="q-card-instructions">${this._renderText(q.instructions)}</div>`
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
