/**
 * app.js — entry point; initialises all modules and the router.
 */
document.addEventListener('DOMContentLoaded', () => {
  Builder.init();
  Runner.init();
  Review.init();
  History.init();
  Router.init();
});
