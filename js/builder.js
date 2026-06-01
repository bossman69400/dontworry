/**
 * builder.js — Test Builder: create/edit tests and questions.
 *
 * State:
 *   Builder.currentTest  — the test object being edited (null = list view)
 *   Builder._qForm       — question being edited in the modal
 */
const Builder = {
  currentTest: null,
  _qForm: null,       // { q: Question, isNew: bool }

  // ── Init ────────────────────────────────────────────────

  init() {
    Router.register('builder', () => this.render());
  },

  render() {
    const el = document.getElementById('section-builder');
    if (this.currentTest) {
      this._renderEditor(el);
    } else {
      this._renderTestList(el);
    }
  },

  // ── Test List View ───────────────────────────────────────

  _renderTestList(el) {
    const tests = Object.values(Storage.getTests())
      .sort((a, b) => b.updatedAt - a.updatedAt);

    el.innerHTML = `
      <div class="page-header">
        <h1>Test Builder</h1>
        <div class="header-actions">
          <button class="btn btn-primary" onclick="Builder.newTest()">+ New Test</button>
          <label class="btn btn-secondary" title="Import a previously exported JSON file">
            Import JSON
            <input type="file" accept=".json" style="display:none"
                   onchange="Builder.importTest(event)">
          </label>
        </div>
      </div>

      ${tests.length === 0
        ? `<div class="empty-state">
             <p>No tests yet. Click <strong>+ New Test</strong> to create your first one.</p>
           </div>`
        : `<div class="test-list">
             ${tests.map(t => this._renderTestCard(t)).join('')}
           </div>`
      }
    `;
  },

  _renderTestCard(test) {
    const questions = Storage.getQuestions();
    const qCount = test.questionIds.filter(id => questions[id]).length;
    const updated = this._fmtDate(test.updatedAt);
    return `
      <div class="test-card">
        <div class="test-card-info">
          <h3>${this._esc(test.title)}</h3>
          ${test.description ? `<p>${this._esc(test.description)}</p>` : ''}
          <span class="meta">${qCount} question${qCount !== 1 ? 's' : ''} &middot; Updated ${updated}</span>
        </div>
        <div class="test-card-actions">
          <button class="btn btn-sm btn-secondary" onclick="Builder.editTest('${test.id}')">Edit</button>
          <button class="btn btn-sm btn-secondary" onclick="Builder.exportTest('${test.id}')">Export</button>
          <button class="btn btn-sm btn-danger"    onclick="Builder.deleteTest('${test.id}')">Delete</button>
        </div>
      </div>
    `;
  },

  // ── Test Editor View ─────────────────────────────────────

  _renderEditor(el) {
    // FIX: preserve any title/desc the user has typed before wiping innerHTML.
    // Without this, inputs reset whenever _renderEditor is called (on every
    // question save, move, delete, duplicate).
    const titleEl = document.getElementById('test-title');
    const descEl  = document.getElementById('test-desc');
    if (titleEl) this.currentTest.title       = titleEl.value;
    if (descEl)  this.currentTest.description = descEl.value;

    const questions = Storage.getQuestions();
    const testQs    = this.currentTest.questionIds.map(id => questions[id]).filter(Boolean);
    const isSaved   = !!Storage.getTests()[this.currentTest.id];

    el.innerHTML = `
      <div class="page-header">
        <button class="btn btn-ghost" onclick="Builder.backToList()">&#8592; Back</button>
        <h1>${isSaved ? 'Edit Test' : 'New Test'}</h1>
        <div class="header-actions">
          <button class="btn btn-primary" onclick="Builder.saveTest()">Save Test</button>
          ${isSaved
            ? `<button class="btn btn-secondary" onclick="Builder.exportTest('${this.currentTest.id}')">Export JSON</button>`
            : ''}
        </div>
      </div>

      <div class="editor-meta">
        <div class="form-group">
          <label for="test-title">Test Title *</label>
          <input type="text" id="test-title" class="form-input"
                 value="${this._esc(this.currentTest.title)}"
                 placeholder="e.g. Week 3 Practice Test">
        </div>
        <div class="form-group">
          <label for="test-desc">Description <span class="hint">(optional)</span></label>
          <textarea id="test-desc" class="form-input" rows="2"
                    placeholder="Optional description">${this._esc(this.currentTest.description)}</textarea>
        </div>
      </div>

      <div class="questions-section">
        <div class="questions-header">
          <h2>Questions <span class="count-badge">${testQs.length}</span></h2>
          <button class="btn btn-primary" onclick="Builder.openQuestionForm(null)">+ Add Question</button>
        </div>

        ${testQs.length === 0
          ? `<div class="empty-state"><p>No questions yet. Click <strong>+ Add Question</strong> to begin.</p></div>`
          : `<div class="question-list">
               ${testQs.map((q, i) => this._renderQuestionRow(q, i, testQs.length)).join('')}
             </div>`
        }
      </div>

      <div id="q-modal" class="modal hidden"></div>
    `;
  },

  _renderQuestionRow(q, idx, total) {
    const typeLabel  = { short: 'Short', long: 'Long', mcq: 'MCQ' }[q.type] || q.type;
    const weekBadges = q.weekTags
      .map(w => `<span class="week-tag week-tag-${w.replace(/\D/g, '')}">${w}</span>`)
      .join('');
    const preview = q.prompt.length > 90 ? q.prompt.slice(0, 90) + '\u2026' : q.prompt;

    return `
      <div class="question-row">
        <div class="question-row-order">
          <div class="reorder-btns">
            <button class="reorder-btn" title="Move up"
                    onclick="Builder.moveQuestion('${q.id}', -1)"
                    ${idx === 0 ? 'disabled' : ''}>&#9650;</button>
            <button class="reorder-btn" title="Move down"
                    onclick="Builder.moveQuestion('${q.id}', 1)"
                    ${idx === total - 1 ? 'disabled' : ''}>&#9660;</button>
          </div>
          <span class="q-num">${idx + 1}</span>
        </div>

        <div class="question-row-info">
          <div class="question-row-meta">
            <span class="type-badge type-${q.type}">${typeLabel}</span>
            ${weekBadges}
            ${q.subtopic ? `<span class="subtopic-badge">${this._esc(q.subtopic)}</span>` : ''}
          </div>
          <p class="question-prompt-preview"
             title="${this._esc(q.prompt)}">${this._esc(preview)}</p>
        </div>

        <div class="question-row-actions">
          <button class="btn btn-sm btn-secondary" onclick="Builder.openQuestionForm('${q.id}')">Edit</button>
          <button class="btn btn-sm btn-secondary" onclick="Builder.duplicateQuestion('${q.id}')">Duplicate</button>
          <button class="btn btn-sm btn-danger"    onclick="Builder.removeQuestion('${q.id}')">Delete</button>
        </div>
      </div>
    `;
  },

  // ── Question Form (Modal) ────────────────────────────────

  openQuestionForm(questionId) {
    let q, isNew;
    if (questionId) {
      q = JSON.parse(JSON.stringify(Storage.getQuestions()[questionId]));
      isNew = false;
    } else {
      q = Models.createQuestion({
        type: 'short',
        weekTags: [],
        mcqOptions: [],
      });
      isNew = true;
    }
    this._qForm = { q, isNew };
    this._renderModal();
  },

  _renderModal() {
    const { q, isNew } = this._qForm;
    const weeks = Array.from({ length: 12 }, (_, i) => i + 1);
    const modal = document.getElementById('q-modal');

    modal.innerHTML = `
      <div class="modal-backdrop" onclick="Builder.closeModal()"></div>
      <div class="modal-box">
        <div class="modal-header">
          <h2>${isNew ? 'Add Question' : 'Edit Question'}</h2>
          <button class="btn btn-ghost btn-sm" onclick="Builder.closeModal()">&#10005;</button>
        </div>

        <div class="modal-body">

          <div class="form-group">
            <label>Question Type *</label>
            <div class="type-selector">
              <button type="button" class="type-btn ${q.type === 'short' ? 'active' : ''}"
                      onclick="Builder._changeType('short')">Short Answer</button>
              <button type="button" class="type-btn ${q.type === 'long' ? 'active' : ''}"
                      onclick="Builder._changeType('long')">Long Answer</button>
              <button type="button" class="type-btn ${q.type === 'mcq' ? 'active' : ''}"
                      onclick="Builder._changeType('mcq')">Multiple Choice</button>
            </div>
          </div>

          <div class="form-group">
            <label>Week Tags * <span class="hint">Select one or more</span></label>
            <div class="week-tag-grid">
              ${weeks.map(w => `
                <label class="week-checkbox">
                  <input type="checkbox" value="Week ${w}"
                         ${q.weekTags.includes('Week ' + w) ? 'checked' : ''}>
                  <span class="week-tag week-tag-${w}">Week ${w}</span>
                </label>
              `).join('')}
            </div>
          </div>

          <div class="form-group">
            <label for="q-subtopic">Subtopic <span class="hint">(optional)</span></label>
            <input type="text" id="q-subtopic" class="form-input"
                   value="${this._esc(q.subtopic)}"
                   placeholder="e.g. Enzyme Kinetics">
          </div>

          <div class="form-group">
            <label for="q-prompt">Question Prompt *</label>
            <textarea id="q-prompt" class="form-input" rows="3"
                      placeholder="Enter your question here\u2026">${this._esc(q.prompt)}</textarea>
          </div>

          <div class="form-group">
            <label for="q-instructions">Instructions <span class="hint">(optional)</span></label>
            <textarea id="q-instructions" class="form-input" rows="2"
                      placeholder="e.g. Answer in 2\u20133 sentences">${this._esc(q.instructions)}</textarea>
          </div>

          ${q.type === 'mcq' ? this._renderMcqSection(q) : ''}

          <div class="form-group">
            <label for="q-model-answer">Model Answer / Marking Guide *</label>
            <textarea id="q-model-answer" class="form-input" rows="4"
                      placeholder="Enter the ideal answer or key marking points\u2026">${this._esc(q.modelAnswer)}</textarea>
          </div>

        </div>

        <div class="modal-footer">
          <div id="q-errors" class="form-errors hidden"></div>
          <button class="btn btn-ghost" onclick="Builder.closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="Builder.saveQuestion()">Save Question</button>
        </div>
      </div>
    `;

    modal.classList.remove('hidden');
  },

  _renderMcqSection(q) {
    return `
      <div class="form-group" id="mcq-section">
        <label>Answer Options *
          <span class="hint">Mark at least one as correct</span>
        </label>
        <div class="mcq-options-list" id="mcq-options-list">
          ${q.mcqOptions.map((opt, i) => this._renderMcqOption(opt, i)).join('')}
        </div>
        <button type="button" class="btn btn-sm btn-secondary"
                onclick="Builder._addMcqOption()">+ Add Option</button>
      </div>
    `;
  },

  _renderMcqOption(opt, idx) {
    return `
      <div class="mcq-option-row" data-opt-id="${opt.id}">
        <input type="text" class="form-input mcq-opt-input"
               data-opt-id="${opt.id}"
               value="${this._esc(opt.text)}"
               placeholder="Option ${idx + 1}">
        <label class="correct-label" title="Mark as correct answer">
          <input type="checkbox" ${opt.isCorrect ? 'checked' : ''}
                 onchange="Builder._toggleCorrect('${opt.id}', this.checked)">
          <span>Correct</span>
        </label>
        <button type="button" class="btn btn-sm btn-danger"
                onclick="Builder._removeMcqOption('${opt.id}')">&#10005;</button>
      </div>
    `;
  },

  // ── Modal interaction helpers ────────────────────────────

  /**
   * Read all current form values back into this._qForm.q before any
   * re-render (type change, add/remove option).
   */
  _syncFormToQ() {
    const q = this._qForm.q;

    // Week tags
    q.weekTags = Array.from(
      document.querySelectorAll('.week-checkbox input:checked')
    ).map(cb => cb.value);

    const get = id => {
      const el = document.getElementById(id);
      return el ? el.value : '';
    };
    q.subtopic     = get('q-subtopic').trim();
    q.prompt       = get('q-prompt').trim();
    q.instructions = get('q-instructions').trim();
    q.modelAnswer  = get('q-model-answer').trim();

    // Sync MCQ option text (isCorrect is maintained live via _toggleCorrect)
    if (q.type === 'mcq') {
      document.querySelectorAll('.mcq-opt-input').forEach(input => {
        const opt = q.mcqOptions.find(o => o.id === input.dataset.optId);
        if (opt) opt.text = input.value.trim();
      });
    }
  },

  _changeType(type) {
    this._syncFormToQ();
    this._qForm.q.type = type;
    // Seed two blank options when first switching to MCQ
    if (type === 'mcq' && this._qForm.q.mcqOptions.length === 0) {
      this._qForm.q.mcqOptions = [
        Models.createMcqOption('', false),
        Models.createMcqOption('', false),
      ];
    }
    this._renderModal();
  },

  _addMcqOption() {
    this._syncFormToQ();
    this._qForm.q.mcqOptions.push(Models.createMcqOption('', false));
    this._renderModal();
    // Scroll new option into view and focus it
    setTimeout(() => {
      const list = document.getElementById('mcq-options-list');
      if (list && list.lastElementChild) {
        list.lastElementChild.scrollIntoView({ block: 'nearest' });
        list.lastElementChild.querySelector('input[type=text]')?.focus();
      }
    }, 40);
  },

  _removeMcqOption(optId) {
    this._syncFormToQ();
    this._qForm.q.mcqOptions = this._qForm.q.mcqOptions.filter(o => o.id !== optId);
    this._renderModal();
  },

  _toggleCorrect(optId, isCorrect) {
    const opt = this._qForm.q.mcqOptions.find(o => o.id === optId);
    if (opt) opt.isCorrect = isCorrect;
  },

  // FIX: show inline errors inside the modal instead of a toast that
  // auto-dismisses before the user can read it.
  _showModalErrors(errors) {
    const el = document.getElementById('q-errors');
    if (!el) return;
    el.innerHTML = errors.map(e => `<span>${this._esc(e)}</span>`).join('');
    el.classList.remove('hidden');
    el.scrollIntoView({ block: 'nearest' });
  },

  _clearModalErrors() {
    const el = document.getElementById('q-errors');
    if (el) { el.innerHTML = ''; el.classList.add('hidden'); }
  },

  saveQuestion() {
    this._syncFormToQ();
    this._clearModalErrors();
    const q = this._qForm.q;
    const errors = Models.validateQuestion(q);
    if (errors.length) {
      this._showModalErrors(errors);
      return;
    }

    q.updatedAt = Date.now();
    Storage.saveQuestion(q);

    if (this._qForm.isNew) {
      this.currentTest.questionIds.push(q.id);
    }

    // FIX: auto-persist structure change so it survives Back→Edit round-trips
    this._autosaveTest();

    this.closeModal();
    this._renderEditor(document.getElementById('section-builder'));
    this._toast('Question saved.');
  },

  closeModal() {
    this._qForm = null;
    const modal = document.getElementById('q-modal');
    if (modal) modal.classList.add('hidden');
  },

  // ── Question list actions ────────────────────────────────

  moveQuestion(id, direction) {
    const ids = this.currentTest.questionIds;
    const idx = ids.indexOf(id);
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= ids.length) return;
    [ids[idx], ids[newIdx]] = [ids[newIdx], ids[idx]];
    // FIX: persist the new order immediately
    this._autosaveTest();
    this._renderEditor(document.getElementById('section-builder'));
  },

  duplicateQuestion(id) {
    const original = Storage.getQuestions()[id];
    if (!original) return;
    const copy = JSON.parse(JSON.stringify(original));
    delete copy.id;
    copy.prompt    = copy.prompt + ' (copy)';
    copy.createdAt = Date.now();
    // Give each MCQ option a fresh ID so they are independent of the original
    if (copy.mcqOptions) {
      copy.mcqOptions = copy.mcqOptions.map(opt => ({ ...opt, id: generateId() }));
    }
    const newQ = Models.createQuestion(copy);
    Storage.saveQuestion(newQ);

    const idx = this.currentTest.questionIds.indexOf(id);
    this.currentTest.questionIds.splice(idx + 1, 0, newQ.id);
    // FIX: persist the new list immediately
    this._autosaveTest();
    this._renderEditor(document.getElementById('section-builder'));
    this._toast('Question duplicated.');
  },

  removeQuestion(id) {
    if (!confirm('Remove this question from the test?')) return;
    this.currentTest.questionIds = this.currentTest.questionIds.filter(qid => qid !== id);

    // Clean up orphaned question from storage if no test references it
    const allTests = Object.values(Storage.getTests())
      .filter(t => t.id !== this.currentTest.id);
    const usedElsewhere = allTests.some(t => t.questionIds.includes(id));
    if (!usedElsewhere) Storage.deleteQuestion(id);

    // FIX: persist the removal immediately
    this._autosaveTest();
    this._renderEditor(document.getElementById('section-builder'));
  },

  // ── Auto-persist helper ──────────────────────────────────

  /**
   * Silently saves the current test's questionIds to storage whenever they
   * change — but only if the test was already saved (has a title and exists
   * in storage). New unsaved tests are not auto-saved here; the user must
   * explicitly click Save Test.
   */
  _autosaveTest() {
    if (!Storage.getTests()[this.currentTest.id]) return;
    this.currentTest.updatedAt = Date.now();
    Storage.saveTest(this.currentTest);
  },

  // ── Test CRUD ────────────────────────────────────────────

  newTest() {
    this.currentTest = Models.createTest({ title: '', questionIds: [] });
    this.render();
  },

  editTest(id) {
    const test = Storage.getTests()[id];
    if (!test) return;
    this.currentTest = JSON.parse(JSON.stringify(test));
    this.render();
  },

  saveTest() {
    // Read current DOM values for title/desc (may differ from currentTest in memory)
    const title = (document.getElementById('test-title')?.value || '').trim();
    const desc  = (document.getElementById('test-desc')?.value  || '').trim();
    this.currentTest.title       = title;
    this.currentTest.description = desc;
    this.currentTest.updatedAt   = Date.now();

    const errors = Models.validateTest(this.currentTest);
    if (errors.length) {
      this._toast(errors.join('\n'), 'error');
      return;
    }

    Storage.saveTest(this.currentTest);
    this._renderEditor(document.getElementById('section-builder'));
    this._toast('Test saved!');
  },

  deleteTest(id) {
    const test = Storage.getTests()[id];
    if (!test) return;
    if (!confirm(`Delete "${test.title}"?\nThe questions will remain in storage.`)) return;
    Storage.deleteTest(id);
    if (this.currentTest && this.currentTest.id === id) this.currentTest = null;
    this.render();
  },

  backToList() {
    if (this.currentTest) {
      const stored = Storage.getTests()[this.currentTest.id];

      if (!stored) {
        // New unsaved test — warn if it has a title or questions
        const domTitle = document.getElementById('test-title')?.value?.trim() || '';
        if (domTitle || this.currentTest.questionIds.length > 0) {
          if (!confirm('This test has not been saved yet.\nGo back and discard it?')) return;
        }
      } else {
        // Existing saved test — warn if title or description differs from storage
        const domTitle = document.getElementById('test-title')?.value ?? stored.title;
        const domDesc  = document.getElementById('test-desc')?.value  ?? stored.description;
        if (domTitle.trim() !== stored.title || domDesc.trim() !== stored.description) {
          if (!confirm('You have unsaved changes to the test title or description.\nDiscard them and go back?')) return;
        }
      }
    }
    this.currentTest = null;
    this.render();
  },

  // ── Import / Export ──────────────────────────────────────

  exportTest(id) {
    // FIX: when called from the editor, use the live in-memory state so that
    // unsaved structural changes (reorders, new questions) are included.
    let test;
    if (this.currentTest && this.currentTest.id === id) {
      // Merge current DOM title/desc into a copy of the in-memory test
      const domTitle = document.getElementById('test-title')?.value?.trim();
      const domDesc  = document.getElementById('test-desc')?.value?.trim();
      test = {
        ...this.currentTest,
        title:       domTitle !== undefined ? domTitle : this.currentTest.title,
        description: domDesc  !== undefined ? domDesc  : this.currentTest.description,
      };
    } else {
      test = Storage.getTests()[id];
      if (!test) return;
    }

    const questions = Storage.getQuestions();
    const testQs    = test.questionIds.map(qid => questions[qid]).filter(Boolean);
    const payload   = { test, questions: testQs, exportedAt: Date.now() };
    const blob      = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url       = URL.createObjectURL(blob);
    const a         = document.createElement('a');
    a.href          = url;
    a.download      = (test.title || 'test').replace(/[^a-z0-9]/gi, '_') + '.json';
    a.click();
    URL.revokeObjectURL(url);
  },

  importTest(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.test || !Array.isArray(data.questions)) {
          throw new Error('File is missing "test" or "questions" fields.');
        }

        const existing = Storage.getTests();
        if (existing[data.test.id]) {
          const overwrite = confirm(
            `A test called "${existing[data.test.id].title}" already exists.\nOverwrite it?`
          );
          if (!overwrite) { event.target.value = ''; return; }
        }

        data.questions.forEach(q => Storage.saveQuestion(q));
        Storage.saveTest(data.test);
        this._toast(`Imported "${data.test.title}" (${data.questions.length} questions).`);
        this.render();
      } catch (err) {
        this._toast('Import failed: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  },

  // ── Utilities ────────────────────────────────────────────

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
    return new Date(ts).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  },
};
