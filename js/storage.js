/**
 * storage.js — all localStorage read/write helpers.
 * Keys: exam_questions, exam_tests, exam_sessions
 */
const Storage = {

  // ── Questions ─────────────────────────────────────────

  getQuestions() {
    return JSON.parse(localStorage.getItem('exam_questions') || '{}');
  },

  saveQuestion(question) {
    const all = this.getQuestions();
    all[question.id] = question;
    localStorage.setItem('exam_questions', JSON.stringify(all));
  },

  deleteQuestion(id) {
    const all = this.getQuestions();
    delete all[id];
    localStorage.setItem('exam_questions', JSON.stringify(all));
  },

  // ── Tests ─────────────────────────────────────────────

  getTests() {
    return JSON.parse(localStorage.getItem('exam_tests') || '{}');
  },

  saveTest(test) {
    const all = this.getTests();
    all[test.id] = test;
    localStorage.setItem('exam_tests', JSON.stringify(all));
  },

  deleteTest(id) {
    const all = this.getTests();
    delete all[id];
    localStorage.setItem('exam_tests', JSON.stringify(all));
  },

  // ── Sessions ──────────────────────────────────────────

  getSessions() {
    return JSON.parse(localStorage.getItem('exam_sessions') || '{}');
  },

  saveSession(session) {
    const all = this.getSessions();
    all[session.id] = session;
    localStorage.setItem('exam_sessions', JSON.stringify(all));
  },

  deleteSession(id) {
    const all = this.getSessions();
    delete all[id];
    localStorage.setItem('exam_sessions', JSON.stringify(all));
  },
};
