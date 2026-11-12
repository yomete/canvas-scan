---
name: canvas-scan
description: Investigate and improve slow Canvas2D drawing with canvas-scan. Records one bounded interaction, ranks findings by measured Canvas2D self-time, and compares a baseline with a candidate after a code change. Use when a user reports a slow, laggy, or janky <canvas>, asks why a chart, whiteboard, map, or game canvas stutters, or asks to make canvas rendering faster.
---

# canvas-scan

canvas-scan watches every main-thread Canvas2D canvas and records a bounded
investigation. It measures synchronous Canvas2D API self-time only. It never
claims GPU time, render time, pixel identity, or wasted work.

## Rules for every investigation

1. Measure before you change code. Do not guess from the source.
2. Load canvas-scan before React and before all application canvas work.
3. Record one bounded interaction, not a whole session.
4. Read `claimBoundary.nonEstablishedFacts` and `nextCheck` on every finding before you act.
5. Make one change, then record a candidate and compare it with the baseline.
6. Report `unknown` as `unknown`. Do not read it as "no problem" or "a problem".
7. Do not read a self-time change smaller than `timerResolutionMs` as a change.
8. Record each build several times. One session per build is an anecdote. See "Sample size" below.
9. Instrumented timings are not user latency. Measure latency in a separate run without canvas-scan. See "Overhead" below.
10. A low Canvas2D total does not mean a fast renderer. Read `observationCoverage` before you say a canvas is cheap.

## Before you start

Pick one setup. Both load canvas-scan before the application's first script.

- **Injection (preferred for a temporary investigation).** Playwright injects the packaged IIFE with `addInitScript`. Nothing in the application changes, nothing reaches its production build, and closing the browser context removes canvas-scan. Use this whenever you drive the page from Playwright. See "Playwright driver" below.
- **Import (when the developer wants canvas-scan in their dev build).** `npx canvas-scan init --write` makes `import 'canvas-scan/auto'` the first import in the entry file. Keep it out of production. See [docs/production.md](https://github.com/yomete/canvas-scan/blob/main/docs/production.md) for the Next `require` guard and the Vite build alias. Never use a dynamic import.

### Get the IIFE

The IIFE is `dist/canvas-scan.iife.js` in the package. Get it in one of two ways:

- Without touching the repository: unpack the published tarball in a scratch directory.

  ```bash
  mkdir -p /tmp/canvas-scan && cd /tmp/canvas-scan && npm pack canvas-scan && tar -xzf canvas-scan-*.tgz
  # IIFE: /tmp/canvas-scan/package/dist/canvas-scan.iife.js
  ```

- From an install: `node_modules/canvas-scan/dist/canvas-scan.iife.js`. Install with the package manager the repository uses only when the developer agrees to a dev dependency: `pnpm add -D canvas-scan` when `pnpm-lock.yaml` exists, `yarn add -D canvas-scan` when `yarn.lock` exists, otherwise `npm install -D canvas-scan`.

### Refresh this skill from the package

The package ships its own copy of this skill at `skills/canvas-scan/` (`node_modules/canvas-scan/skills/canvas-scan/` after an install, `package/skills/canvas-scan/` in an unpacked tarball). Compare it with the directory this file loaded from, which the skill header names as the base directory. When any file differs, copy the package's directory over this one, then read the new `SKILL.md` and follow that version instead of this one. Say in one line that the skill updated, and give the `version` from the package's `package.json`. When the package copy is missing, the package predates the skill; keep this version and say so.

In the command, `$PKG` is the package directory and `$SKILL_DIR` is the base directory from the skill header.

```bash
diff -rq "$PKG/skills/canvas-scan" "$SKILL_DIR" || cp -R "$PKG/skills/canvas-scan/." "$SKILL_DIR"/
```

## Workflow: record, explain, change, compare

Drive the page from Playwright or from the browser console. `window.__CANVAS_SCAN__`
exposes the same API as `import { ... } from 'canvas-scan'`.

1. **Record a baseline.** Call `startRecording()`, reproduce the slow interaction once, then call `stopRecording()`. It returns an `InvestigationSessionV1`. Save it to a file named for the build and the run, such as `baseline-run-1.json`, so a later recording never replaces it.
2. **Read the findings.** `session.findings` is ranked by `canvasApiSelfTimeMs`, highest first. Take the top finding. Note its `type`, `canvasId`, `topMethods`, `claimBoundary`, and `nextCheck`.
3. **Explain the top finding.** Call `startExplanation({ sessionId, findingIndex })`, reproduce the interaction again, then call `stopExplanation()`. The `ExplanationArtifactV1` carries up to 8 stack samples. A sample that maps to source names the function, file, and line that calls the top method. Start your code change there.
4. **Change the code.** Use the table in [REFERENCE.md](REFERENCE.md) to pick the fix that matches the finding type.
5. **Record a candidate.** Repeat step 1 with the same interaction, and save it under a new name. Record each build several times (see "Sample size").
6. **Compare.** Call `compareSessions(baseline, candidate, { baselineFindingIndex, candidateFindingIndex })`. Pair findings of the same `type` and the same canvas role. Read `status`, `measures`, `spanMismatch`, and `coverageNote`.
7. **Report.** State the measured delta for the paired finding and how many runs per build it rests on. Say what the comparison does not prove. `improvementEstablished` is always `false`; one measured pair is evidence, not proof.

## Playwright driver

This script needs no change to the application. It injects canvas-scan before the page's scripts, records one interaction several times, and writes each session to its own tagged file, so a later build does not overwrite the baseline.

```ts
// record.mjs: node record.mjs <build-tag> <runs>
import fs from 'node:fs';
import { chromium } from 'playwright';

const IIFE = '/tmp/canvas-scan/package/dist/canvas-scan.iife.js'; // or node_modules/canvas-scan/dist/canvas-scan.iife.js
const [tag = 'baseline', runs = '5'] = process.argv.slice(2);
fs.mkdirSync('canvas-scan-runs', { recursive: true });

const browser = await chromium.launch();
for (let run = 1; run <= Number(runs); run++) {
  const context = await browser.newContext(); // a fresh context per run: nothing carries over
  await context.addInitScript({ path: IIFE }); // runs before every application script
  const page = await context.newPage();
  await page.goto('http://localhost:5173/chart');
  await page.evaluate(() => __CANVAS_SCAN__.hideOverlay()); // keep the overlay from taking clicks
  await page.evaluate(() => __CANVAS_SCAN__.startRecording());
  await page.getByRole('button', { name: 'Zoom' }).click(); // the one bounded interaction
  const session = await page.evaluate(() => __CANVAS_SCAN__.stopRecording());
  const file = `canvas-scan-runs/${tag}-run-${run}.json`;
  if (fs.existsSync(file)) throw new Error(`${file} exists; pick a new tag rather than replace it`);
  fs.writeFileSync(file, JSON.stringify(session));
  await context.close(); // removes canvas-scan with the context
}
await browser.close();
```

Run it once per build with a different tag: `node record.mjs baseline 5`, change the code, then `node record.mjs candidate 5`.

- **The overlay.** After `stopRecording()` the overlay opens its results panel, and that panel takes pointer events. A `pointer-events: none` rule on `[data-canvas-scan]` does not reach it. Call `__CANVAS_SCAN__.hideOverlay()` before you click the page; recording still works, and `showOverlay()` brings it back. To run with no overlay at all, add `await context.addInitScript(() => { window.__CANVAS_SCAN_OPTS = { overlay: false }; });` before the IIFE.
- **Cleanup.** Injection never touches the repository. Close the context, and delete the scratch directory and the `canvas-scan-runs` files when the investigation ends. Do not add canvas-scan to the application to finish the job.

For a page you do not control, use the guided run. It writes `handoff.jsonl`,
one record per line, that an agent can read without the overlay:

```bash
node packages/dogfood/investigate-url.mjs --url=https://example.com
node packages/dogfood/read-handoff.mjs path/to/handoff.jsonl
```

## How to read a comparison

- `status: 'incomparable'` names the reason in `incomparableReasons`. The findings were not paired, so report no per-finding result.
- `sessionFallback` set: the findings did not pair (for example, the fix removed the finding), and the artifact carries session-wide totals instead: Canvas2D self-time, raster operations, active windows, and resets over every canvas. Report them with the `caveat` text and the reason. They describe the same work only if both runs drove the same interaction.
- `spanMismatch` set: the two recordings differ by more than 20 percent in duration or episode count. Compare only the paired findings, not the session totals.
- `coverageNote` set: one side evicted a canvas to a summary. Say so in the report.
- `observationNote` set: a canvas drew through WebGL, a worker, or another API canvas-scan does not observe. Its work is in no measure. Say so, and point to a browser performance trace for it.
- Many `unknown` windows in `commandStatuses`: the repeated-draw comparison could not answer. The measured self-time is still valid. See "What the comparison can and cannot answer" in the package README.

## Sample size

Timing varies between runs. In one investigation a single-session change from 168 ms to 304 ms looked like a regression, and repeated runs did not confirm it.

1. Record the same interaction at least 5 times per build, in a fresh page each time. The Playwright driver above does this.
2. Compare the spread, not one pair. For each build, list the Canvas2D self-time of the paired finding (or the session total) across runs, and give the median and the minimum and maximum.
3. Call a change a regression or an improvement only when the two builds' ranges do not overlap. When they overlap, report "no clear change at this sample size".
4. Structural counts (raster operations, resets, active windows) vary much less than times. A count change that holds in every run is stronger evidence than a time change.
5. `compareSessions` compares one pair. Run it on one representative pair for the per-finding measures, and say in the report how many runs per build the conclusion rests on. A single-session comparison is still allowed; state that it is one sample.

## Overhead

canvas-scan wraps every Canvas2D call, so instrumented script time is higher than the user sees. In one flame-graph view it roughly doubled script time per input: zoom went from 14.8 ms to 32.2 ms, and pan from 20.4 ms to 46.4 ms.

- Use canvas-scan to find which canvas and which calls dominate. Do not report its timings as input latency or frame time.
- Measure latency in a separate run without canvas-scan: a fresh browser context with no `addInitScript`, or a build without the import. Use a browser performance trace or Event Timing there.
- `stop()` removes the frame loop and the overlay, but the Canvas2D wrappers stay until the page reloads. Leftover wrappers added about 3 ms to one trace. Before an uninstrumented trace, close the context or reload the page without the injection.
- A baseline and a candidate that both run with canvas-scan pay the same overhead, so they still compare with each other.

## Coverage

`session.observationCoverage` says what the recording could not see. `unobservedCanvases` counts canvases by reason (`webgl`, `webgl2`, `webgpu`, `bitmaprenderer`, `transferred-to-worker`, `main-thread-offscreen-canvas`). `undeterminedCanvasCount` counts canvases with no context canvas-scan saw: they never drew, or they took their context before canvas-scan loaded. A worker that creates its own OffscreenCanvas leaves no trace at all. When any count is above zero, say in the report that the Canvas2D figures do not cover that rendering, and use a browser performance trace for it. Never call an unobserved renderer fast.

## Advanced

Artifact fields, finding types, the fix table, and the limits are in [REFERENCE.md](REFERENCE.md).
