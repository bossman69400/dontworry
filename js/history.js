/**
 * history.js — Saved Tests / Session History. (Stage 5)
 */
const History = {
  init() {
    Router.register('history', () => this.render());
  },

  render() {
    document.getElementById('section-history').innerHTML = `
      <div class="page-header"><h1>History</h1></div>
      <div class="coming-soon">
        <h2>Coming in Stage 5</h2>
        <p>Session history and past results will be listed here.</p>
      </div>
    `;
  },
};
