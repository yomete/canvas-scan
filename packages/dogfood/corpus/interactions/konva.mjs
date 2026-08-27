// Konva: drag one shape across a layer of two hundred, then toggle the layer
// twice. A retained scene graph decides for itself when to redraw, so this asks
// what canvas-scan sees when the redraw schedule is not the application's own
// paint loop.
import { recordInteraction, sleep } from './shared.mjs';

export default async function drive({ page }) {
  const box = await page.locator('#stage').boundingBox();
  await recordInteraction(page, async () => {
    await page.mouse.move(box.x + 450, box.y + 250);
    await page.mouse.down();
    for (let step = 0; step < 60; step++) {
      await page.mouse.move(box.x + 450 + Math.sin(step / 6) * 300, box.y + 250 + Math.cos(step / 8) * 150);
      await sleep(90);
    }
    await page.mouse.up();
    await sleep(300);
    for (let pass = 0; pass < 2; pass++) {
      await page.evaluate(() => { const { layer } = window.__CORPUS__; layer.visible(!layer.visible()); layer.draw(); });
      await sleep(500);
    }
  });
}
