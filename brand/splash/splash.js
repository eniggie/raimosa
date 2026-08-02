const root = document.documentElement;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const revealDuration = reduceMotion ? 0 : 4800;

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    root.dataset.ready = "true";
  });
});

window.setTimeout(() => {
  root.dataset.complete = "true";
  window.dispatchEvent(new CustomEvent("raimosa:splash-ready"));
}, revealDuration);

// Add ?loop=1 while reviewing motion. Production splash screens play once.
if (new URLSearchParams(window.location.search).get("loop") === "1" && !reduceMotion) {
  window.setInterval(() => {
    delete root.dataset.ready;
    delete root.dataset.complete;
    void document.body.offsetWidth;
    requestAnimationFrame(() => { root.dataset.ready = "true"; });
    window.setTimeout(() => { root.dataset.complete = "true"; }, revealDuration);
  }, 7200);
}
