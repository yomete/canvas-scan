// Drives the complete ritual through the overlay, the way a person would:
// Record, Explain, Keep as baseline, Record again, Compare. Every action is a
// click on a real control in the real shadow root — nothing here reaches past
// the interface into the recording API, because the interface is what the
// fixture exists to prove.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const find = (page, selector) => page.evaluate(name => {
  const host = document.querySelector('[data-canvas-scan]');
  const control = host?.shadowRoot?.querySelector(name);
  return !!control && !control.hidden && !control.disabled;
}, selector);

// Waiting on the control rather than on a guessed delay. An explanation runs
// until it has what it needs, and a fixed sleep either wastes the run's time or
// fails it on a slow machine.
async function waitFor(page, selector, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await find(page, selector)) return;
    await sleep(250);
  }
  throw new Error(`the overlay never offered ${selector} within ${timeoutMs} ms`);
}

const click = (page, selector) => page.evaluate(name => {
  const control = document.querySelector('[data-canvas-scan]').shadowRoot.querySelector(name);
  if (!control) throw new Error(`the overlay has no ${name}`);
  control.click();
}, selector);

// Real readbacks, so the 8 ms per-episode heavy-work gate is crossed by
// genuine work rather than a contrived number.
async function drawFrames(page, frames) {
  await page.evaluate(async count => {
    const canvas = document.getElementById('ritual-canvas');
    canvas.width = 600; canvas.height = 300;
    const context = canvas.getContext('2d');
    for (let frame = 0; frame < count; frame++) {
      for (let index = 0; index < 120; index++) context.fillRect((index % 60) * 10, (index % 30) * 10, 8, 8);
      for (let index = 0; index < 50; index++) context.getImageData(0, 0, 600, 300);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  }, frames);
}

async function record(page, frames = 8) {
  await waitFor(page, '.record');
  await click(page, '.record');
  await sleep(200);
  await drawFrames(page, frames);
  await click(page, '.stop-recording');
  await sleep(800);
}

export default async function drive({ page }) {
  // Chrome refuses clipboard writes without permission, and the comparison
  // artifact only leaves the overlay through Copy.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

  await record(page);
  await waitFor(page, '.counts');
  await click(page, '.counts');
  await waitFor(page, '.explanation-action');

  // "Explain next interaction" arms the capture; the interaction is the
  // redraw that follows, and the panel offers Copy once it has finished.
  await click(page, '.explanation-action');
  await sleep(600);
  await drawFrames(page, 4);
  await waitFor(page, '.explanation-copy');
  await click(page, '.explanation-copy');
  await sleep(500);

  await waitFor(page, '.baseline-action');
  await click(page, '.baseline-action');
  await sleep(400);

  await record(page);

  await waitFor(page, '.comparison-action');
  await click(page, '.comparison-action');
  await waitFor(page, '.comparison-copy');
  await click(page, '.comparison-copy');
  await sleep(700);
}
