// Excalidraw: draw twenty shapes by dragging, select all, drag the scene three
// times, then zoom six steps. Per-element cache canvases mean this is the entry
// that stresses the canvas lifetime cap.
import { recordInteraction, sleep } from './shared.mjs';

export default async function drive({ page }) {
  await page.waitForSelector('canvas', { timeout: 45_000 });
  const box = await page.locator('canvas').first().boundingBox();
  const originX = box.x + 200;
  const originY = box.y + 200;
  const drag = async (x1, y1, x2, y2) => {
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    for (let step = 1; step <= 12; step++) {
      await page.mouse.move(x1 + ((x2 - x1) * step) / 12, y1 + ((y2 - y1) * step) / 12);
      await sleep(25);
    }
    await page.mouse.up();
    await sleep(200);
  };

  await recordInteraction(page, async () => {
    for (let row = 0; row < 4; row++) {
      for (let column = 0; column < 5; column++) {
        await page.keyboard.press(row % 2 === 0 ? 'r' : 'o');
        await drag(originX + column * 130, originY + row * 90, originX + column * 130 + 100, originY + row * 90 + 65);
      }
    }
    await page.keyboard.press('Escape');
    await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
    await sleep(300);
    for (let pass = 0; pass < 3; pass++) {
      await drag(originX + 240, originY + 120, originX + 240 + (pass % 2 ? -140 : 140), originY + 120 + (pass % 2 ? -90 : 90));
    }
    for (let step = 0; step < 6; step++) {
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, step % 2 === 0 ? -240 : 240);
      await page.keyboard.up('Control');
      await sleep(180);
    }
  });
}
