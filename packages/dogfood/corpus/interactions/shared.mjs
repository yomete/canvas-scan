// Shared helpers for corpus interactions. Every corpus entry drives the same
// overlay controls the way a person would; only the application interaction in
// between differs.
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export const control = (page, selector) => page.evaluate(name => {
  const host = document.querySelector('[data-canvas-scan]');
  const found = host?.shadowRoot?.querySelector(name);
  return !!found && !found.hidden && !found.disabled;
}, selector);

export async function waitFor(page, selector, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await control(page, selector)) return true;
    await sleep(250);
  }
  return false;
}

export const click = (page, selector) => page.evaluate(name => {
  document.querySelector('[data-canvas-scan]').shadowRoot.querySelector(name)?.click();
}, selector);

// One bounded recording around one bounded interaction. The corpus asks
// whether canvas-scan is useful on somebody else's application, so it records
// the interaction the entry declares and stops.
export async function recordInteraction(page, interact) {
  await waitFor(page, '.record');
  await click(page, '.record');
  await sleep(300);
  await interact();
  await click(page, '.stop-recording');
  await sleep(1000);
  await waitFor(page, '.counts', 5000);
  await click(page, '.counts');
  await sleep(500);
}
