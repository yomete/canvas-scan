// Chart.js: hover the plot area while six series are drawn, then resize twice.
// Hovering is where an immediate-mode chart spends its time, because every
// pointer move redraws the whole plot.
import { recordInteraction, sleep } from './shared.mjs';

export default async function drive({ page }) {
  const box = await page.locator('#plot').boundingBox();
  await recordInteraction(page, async () => {
    for (let step = 0; step < 60; step++) {
      await page.mouse.move(box.x + 40 + (step * 12) % (box.width - 80), box.y + box.height / 2 + Math.sin(step / 4) * 60);
      await sleep(90);
    }
    // A resize is the other thing a chart does that costs real work.
    for (const width of [700, 900]) {
      await page.evaluate(value => { window.__CORPUS__.canvas.style.width = `${value}px`; window.__CORPUS__.chart.resize(); }, width);
      await sleep(600);
    }
  });
}
