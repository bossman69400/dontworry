/**
 * models.js — factory functions and validators for each data type.
 * generateId() is a plain global so all modules can use it.
 */

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

const Models = {

  // ── Question ───────────────────────────────────────────

  createQuestion(data = {}) {
    return {
      id:          data.id          || generateId(),
      type:        data.type        || 'short',   // 'short' | 'long' | 'mcq'
      prompt:      data.prompt      || '',
      instructions: data.instructions || '',
      weekTags:    data.weekTags    || [],         // e.g. ['Week 1', 'Week 3']
      subtopic:    data.subtopic    || '',
      modelAnswer: data.modelAnswer || '',
      mcqOptions:  data.mcqOptions  || [],         // only used when type === 'mcq'
      createdAt:   data.createdAt   || Date.now(),
      updatedAt:   Date.now(),
    };
  },

  createMcqOption(text = '', isCorrect = false) {
    return { id: generateId(), text, isCorrect };
  },

  validateQuestion(q) {
    const errors = [];
    if (!q.prompt || !q.prompt.trim())
      errors.push('Question prompt is required.');
    if (!q.weekTags || q.weekTags.length === 0)
      errors.push('At least one week tag is required.');
    if (!q.modelAnswer || !q.modelAnswer.trim())
      errors.push('Model answer / marking guide is required.');
    if (q.type === 'mcq') {
      if (!q.mcqOptions || q.mcqOptions.length < 2)
        errors.push('MCQ questions need at least 2 options.');
      const nonEmpty = (q.mcqOptions || []).filter(o => o.text.trim());
      if (nonEmpty.length < 2)
        errors.push('At least 2 options must have text.');
      if (!q.mcqOptions.some(o => o.isCorrect))
        errors.push('Mark at least one option as correct.');
    }
    return errors;
  },

  // ── Test ──────────────────────────────────────────────

  createTest(data = {}) {
    return {
      id:          data.id          || generateId(),
      title:       data.title       || '',
      description: data.description || '',
      questionIds: data.questionIds || [],
      createdAt:   data.createdAt   || Date.now(),
      updatedAt:   Date.now(),
    };
  },

  validateTest(t) {
    const errors = [];
    if (!t.title || !t.title.trim())
      errors.push('Test title is required.');
    return errors;
  },

  // ── Session ───────────────────────────────────────────

  createSession(data = {}) {
    return {
      id:               data.id             || generateId(),
      testId:           data.testId         || '',
      testTitle:        data.testTitle      || '',
      mode:             data.mode           || 'open-book',
      startedAt:        Date.now(),
      completedAt:      null,
      // Full snapshot of questions so history is immutable after edits
      questionSnapshot: data.questionSnapshot || [],
      responses:        data.responses      || {},
    };
  },

  // ── Response (per question inside a session) ──────────

  createResponse() {
    return {
      answer:           '',
      usedNotes:        false,
      notConfident:     false,
      flagged:          false,
      guessed:          false,
      // Filled during review:
      selfGrade:        null,   // null | 0 | 0.5 | 1
      retryLater:       false,
      errorReason:      null,   // see review.js for enum values
      errorReasonText:  '',
    };
  },
};
