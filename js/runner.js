/**
 * runner.js — Take Test flow. (Stage 3)
 */
const Runner = {
  init() {
    Router.register('runner', () => this.render());
  },

  render() {
    document.getElementById('section-runner').innerHTML = `
      <div class="page-header"><h1>Take Test</h1></div>
      <div class="coming-soon">
        <h2>Coming in Stage 3</h2>
        <p>The test-taking flow will be built here.</p>
      </div>
    `;
  },
};
