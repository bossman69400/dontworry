/**
 * review.js — Review & self-grading flow. (Stage 4)
 */
const Review = {
  init() {
    Router.register('review', () => this.render());
  },

  render() {
    document.getElementById('section-review').innerHTML = `
      <div class="page-header"><h1>Review Answers</h1></div>
      <div class="coming-soon">
        <h2>Coming in Stage 4</h2>
        <p>The review and self-grading flow will be built here.</p>
      </div>
    `;
  },
};
