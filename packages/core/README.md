<!-- This README is packed with the canvas-scan package. -->

# canvas-scan

> One early import that watches every main-thread Canvas2D canvas in your app — and turns "this canvas feels slow" into a correct next check.

[![npm version](https://img.shields.io/npm/v/canvas-scan)](https://www.npmjs.com/package/canvas-scan)
[![license: MIT](https://img.shields.io/npm/l/canvas-scan)](./LICENSE)

![canvas-scan recording an investigation on a canvas-heavy app](docs/demo.gif)

React performance tools stop at the `<canvas>` element: they can tell you a component re-rendered, but not what the canvas did. canvas-scan starts where they stop. It records a bounded investigation session and answers five questions:

- Which canvas performed work?
- Which interaction or draw episode contained that work?
- Which Canvas2D calls dominated the measured time?
- How strong is each piece of evidence — `measured`, `associated`, or `candidate`?
- What should you check next?

**It never guesses.** Self-time means synchronous Canvas2D API time, and the tool never claims GPU time, render time, pixel identity, or wasted work. Window comparisons come back `same | changed | unknown`, and `unknown` is an honest answer, not a failure. Every finding states what its evidence cannot prove and names the next useful check.

## Quick start

```bash
npm install -D canvas-scan
npx canvas-scan init --write   # wires Vite or Next
```

Or add the import yourself — it must be the first import, before React and before any canvas work:

```ts
import 'canvas-scan/auto';
```

Or, for development without a bundler, a script tag before all other scripts:

```html
<script src="https://unpkg.com/canvas-scan@0.7.2/dist/canvas-scan.iife.js"></script>
```

Reload, press **Record investigation** in the overlay, reproduce the slow interaction once, and stop. Findings appear ranked, each with its evidence level, its claim boundary, and its next check.

![the canvas-scan overlay with ranked findings](docs/overlay.png)

Findings are ranked by measured Canvas2D API self-time, highest first, across all four types. Each card carries a **What this shows, and what it does not** disclosure holding the evidence level, the claim boundary, and the next check.

When a finding's draw episode overlaps an Event Timing entry or a long animation frame, the card shows an **Overlaps** line with each entry and its duration, longest first. This is associated evidence: the entry and the episode occurred at the same time. It does not show that the canvas work caused the long frame. The coverage line reports the long animation frames that overlapped no draw episode, so a stall outside Canvas2D is visible without the JSON.

**Keyboard.** The overlay's controls, the canvas rows in the activity flyout, and the finding cards are all reachable by Tab. Enter opens a canvas row's details and Escape returns focus to the row that opened it. Escape acts only while focus is inside the overlay, so a dialog or menu in your own application keeps its own dismissal. Inspect mode's outlines are a pointer affordance: they highlight canvases under the cursor and have no tab stops of their own, because adding one per canvas would insert them into your application's tab order. The activity flyout offers the same canvases as focusable rows, so nothing is reachable only by pointer.

## Keep it out of production

`canvas-scan/auto` is a development tool. `canvas-scan init --write` adds the import with no condition, and bundlers include that import in production builds. Guard the import before you commit, and keep the guard synchronous. A dynamic import evaluates after your app's own imports and after React, and canvas-scan then warns that it started late. Do not replace the import with a dynamic import behind `import.meta.env.DEV`.

**Next.** In `instrumentation-client.ts`, replace the import with a `require` behind `process.env.NODE_ENV`. Next replaces `process.env.NODE_ENV` at build time and drops the dead branch, so a production build contains no canvas-scan code. In development the `require` is synchronous, so canvas-scan still runs before the app code.

```ts
if (process.env.NODE_ENV === 'development') {
  require('canvas-scan/auto');
}
```

**Vite.** Keep the static import on the first line of your entry. In `vite.config.ts`, alias `canvas-scan/auto` to an empty module when `command === 'build'`. Development keeps the first-import order, and a production build contains no canvas-scan code.

```ts
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  resolve: {
    alias: command === 'build' ? { 'canvas-scan/auto': 'data:text/javascript,' } : {},
  },
}));
```

`canvas-scan init --write` prints the pattern for the framework it wired.

## What it finds

- **`heavy-canvas-work`** — one draw episode contains at least 8 ms of measured synchronous Canvas2D API self-time. Not GPU or render time. The gate sums the self-time of one canvas across the whole episode, not across one frame. A draw episode starts at the first frame boundary that has Canvas2D activity. It ends when two consecutive frame boundaries have no Canvas2D activity on any canvas, so one quiet frame does not split it. The threshold is 8 ms because it is close to half of one 16.7 ms frame at 60 Hz. When one canvas spends that much time in synchronous Canvas2D calls during one burst of drawing, the calls are large enough to review, whether they landed in one frame or were spread across the burst. The finding's `maximumWindow` names the slowest single frame, so you can see which of the two occurred. Next: check the top measured methods and the application code that calls them. When the slowest window followed a canvas reset, the next check changes: the backing-store reallocation cost lands on the next context call, so check the sizing code before you check the top measured methods. Run an explanation to see the function that calls the top method.
- **`repeated-draw-work`** — captured windows sent the same command signature. A review candidate only: it does not claim unchanged pixels or wasted work. Next: check whether the scene and interaction require those repeated commands.
- **`resize-churn`** — reset events span repeated active raster-work windows. It does not prove the resets caused slowness. Next: check whether sizing and reset calls can run only when dimensions or state change.
- **`backing-store-mismatch`** — the recorded backing area is larger than the DPR-adjusted expected area. It does not prove excess GPU cost. Next: check the sizing policy and required image quality.

If React is present and canvas-scan loaded early, findings carry the nearest React owner with an explicit attribution confidence. Attribution is optional context, never the product boundary.

## v0.5 investigation ritual

The workflow is record → explain → change → compare, with a plain JSON artifact at every step:

1. Load `canvas-scan/auto` before React and before application Canvas2D work.
2. Start the baseline with the overlay or `startRecording()`. Reproduce one
   bounded interaction, stop with `stopRecording()`, and read
   `getLastSession()`.
3. Open one baseline finding. Select **Explain next interaction**, or call
   `startExplanation({ sessionId, findingIndex })` with that explicit finding.
4. Reproduce the interaction again. Stop with the overlay or
   `stopExplanation()`, read `getLastExplanation()`, and use
   **Copy explanation JSON** or **Download explanation JSON** when you need
   the artifact.
5. Select **Keep as baseline** on the explained finding. The overlay also
   keeps the baseline in the tab's `sessionStorage`. A full page reload
   restores it and shows `Baseline restored from the last page load`. A
   baseline larger than 4 MB stays in page memory only, and the overlay says
   so.
6. Make the application change. Start a candidate with `startRecording()`,
   reproduce the same bounded interaction, and stop with `stopRecording()`.
7. Open a candidate of the same finding type. Select **Compare with baseline**,
   or call `compareSessions(baseline, candidate, { baselineFindingIndex,
   candidateFindingIndex })`. The pairing is always explicit.
8. Review the measured pair. Select **Copy comparison JSON** or **Download
   comparison JSON** to keep the plain JSON artifact.

To open a session JSON that you downloaded, or one that a teammate sent,
select **Load session JSON** in the flyout and choose the file. The overlay
shows the findings of that file as the saved recording. Select **Keep as
baseline** on one of them to compare it with your next recording. The file
must have `schemaVersion: 1`.

Explanation detail covers only the selected canvas. It excludes raw argument
values, page text, pixels, and raw application and argument URLs. It also
excludes application objects and source content. Sanitized selected-callsite
evidence can include generated script paths and mapped source paths. A result
can be an honest `unknown` when safe comparison is not possible. One measured
pair does not prove that the application improved.

An explanation takes at most 8 stack samples. One sample is for the first
raster call. One sample is for the first different command in each frame. For
a `heavy-canvas-work` finding, one sample is for the first call of the top
method in each frame. When that sample maps to your source, the heavy card
shows a `Top method ... called from` line. The line names the function, the
file, and the line.

The comparison also carries two session-scoped browser measures:
`worst-interaction-duration-ms`, the longest Event Timing entry in each
recording, and `long-animation-frame-count`. Each is `null` when the browser
did not supply the feature, so the stall a ticket was opened for is compared
next to the canvas figures rather than read from the raw JSON.

Two recordings rarely cover the same span. The comparison carries `span`: the
duration, the draw-episode count, and the user-mark count of each side. When
the two sides differ by more than 20 percent in duration or in episode count,
`spanMismatch` says so, because session-scoped totals are then not on one
scale. Compare the explicitly selected findings for measures over their draw
episodes. Session episode counts do not establish equivalent interactions.
User marks remain recorded context; matching labels do not define comparison
ranges.

canvas-scan also writes to the User Timing API, so a DevTools Performance
trace of the same run lines up with the session. `startRecording()` calls
`performance.mark('canvas-scan:recording-start')`. `stopRecording()` calls
`performance.measure('canvas-scan:episode-N')` for each draw episode. Both
show in the Timings track of the Performance panel. The session JSON stores
`timeOrigin`, the page's `performance.timeOrigin`. Add it to a session
timestamp to get the absolute time of a trace event. In the other direction,
a `performance.mark` or `performance.measure` that the page makes during a
recording is stored as a `user-mark` entry. The entry name is the label, and
a measure keeps its duration. Entries with a name that starts with
`canvas-scan:` are not stored.

The state changes from `idle` to `recording` to `complete` to `recording`.
The maximum duration is 30 seconds. Stops are `manual` or `max-duration`.
Calling start while recording is idempotent.

## API

```ts
import {
  start,                // begin passive observation (what /auto does)
  stop,                 // cancel the frame loop and remove the overlay
  getReports,           // read the current passive draw-batch reports
  mark,                 // add a labeled marker to the recording
  startRecording,       // begin a bounded investigation session
  stopRecording,
  getLastSession,       // InvestigationSessionV1, plain JSON
  startExplanation,     // bounded command capture for one selected finding
  stopExplanation,
  getLastExplanation,   // ExplanationArtifactV1, plain JSON
  compareSessions,      // explicit pair comparison, returns ComparisonArtifactV1
} from 'canvas-scan';
```

### Options

`stop()` — also on `window.__CANVAS_SCAN__` for an `/auto` import — cancels the frame loop and removes the overlay. That removes the per-frame cost without a reload. The Canvas2D prototype patch stays in place, so wrapped calls still have per-call overhead. `start()` runs again after `stop()`.

`start(options)` — and `import 'canvas-scan/auto'`, which calls it with the defaults — accepts:

| Option | Default | What it does |
| --- | --- | --- |
| `captureEvery` | `1` | Report one window in every *n*. See **Sampling** below. |
| `minFlashRasterOps` | `2` | The raster operations a repeated window must reach before the overlay flashes its outline. Also sets `minRepeatedRasterOps` when that is absent. |
| `minRepeatedRasterOps` | `minFlashRasterOps` | The raster operations a repeated window must reach to count towards a `repeated-draw-work` finding. Set it to tune findings without changing the flash, or the flash without changing findings. |
| `overlay` | `true` | Mount the in-page overlay. |
| `skipOwners` | `[]` | Component names to skip when naming a canvas's owner. |
| `debug` | `false` | Write the frame loop's per-canvas `console.debug` lines. |

### Sampling

Above `captureEvery: 1`, canvas-scan reports one window in every *n*. The windows in between are still measured: their raster operations, Canvas2D API self-time, and method evidence are carried into the next reported window, and that window's `coveredWindowCount` says how many windows it covers. A sampled recording therefore totals the whole of what was measured, and the 8 ms heavy-work gate sees the real figure. The episode-break gap scales with `captureEvery` for the same reason, so grouping does not collapse into one window per episode.

The session records the rate it was made at as `captureEvery`. `compareSessions` refuses a pair recorded at different rates with `sampling-mismatch`, because their totals are not on one scale.

### What the comparison can and cannot answer

The comparison answers one question: did this frame draw the same thing as the last one? It answers it by comparing a frame's Canvas2D commands with the previous frame's. That works when a canvas is stable between frames, and it cannot work when the previous frame is gone.

| Application design | The comparison |
| --- | --- |
| One canvas, redrawn wholesale each frame | Answers. This is the case it was built for. |
| A library managing its own layers and redraw scheduling | Mostly answers. |
| Per-element or per-tile cache canvases, resized and composited with `drawImage` | Often cannot answer. |

A canvas whose size is reassigned has no previous frame to compare against, and neither has a canvas drawn from a source that was reassigned. canvas-scan reports those frames as `unknown`, with the reason, rather than guessing.

The measured figures are unaffected. Canvas2D API self-time, raster counts, method evidence, canvas resets, and backing-store ratios are all still measured on every frame. Three of the four finding types do not use the comparison at all. Only repeated-draw-work rests on it, and it rests only on the frames the comparison could answer for.

Two real applications, recorded on the same day, show both ends. A charting application drawing into one stable canvas came back with 1 unknown window out of 1378. Excalidraw, which caches every element on its own canvas, came back with 224 unknown out of 342. Both answers are correct. When most frames come back `unknown`, the overlay says so on the coverage line rather than leaving it to be discovered.

## Investigate a URL

Run one guided investigation against a page you do not control:

```bash
node packages/dogfood/investigate-url.mjs --url=https://example.com
```

The command opens Chrome on that URL with canvas-scan installed before the first application script. Drive the overlay yourself: record, explain, keep a baseline, record a candidate, compare. Close the browser window when you finish. The command writes every artifact you produced, and a report of what it observed, to a directory it names on exit.

The command accepts one `http` or `https` URL. It refuses any other scheme, and it refuses two targets. Add `--out=DIR` to choose the directory. Add `--timeout=MINUTES` to change the one-hour limit.

Chrome runs from a throwaway profile that the command deletes afterwards, so your own browser profile does not change. The command records every request that leaves the target's origin, and the report names them. It measures no GPU time, diagnoses no CPU, and sends nothing anywhere.

Build the bundle first with `pnpm --filter canvas-scan run build`.

### The agent handoff

The command also writes `handoff.json` and `handoff.jsonl`. Both hold the same versioned records, so a coding agent can read one investigation without parsing overlay text or carrying state from a conversation. Use `--handoff=json`, `--handoff=jsonl`, or `--handoff=none` to choose.

JSONL uses one record per line. Each record has one of seven kinds: `metadata`, `stage`, `finding`, `explanation`, `comparison`, `limit`, and `result`. The last record is always the terminal `result`, so a reader can tell a finished run from a truncated file.

Every finding carries its evidence level, its claim boundary, its next check, and how many of its frames the tool could not compare. Every dropped observation gets its own `limit` record. A run that did not finish names each incomplete stage in the `result` record.

The reader refuses an unknown record kind, an extra or missing field, a missing terminal record, and a result that disagrees with its own stages. It also refuses any record that names a remote address other than the target, because the handoff is local and fetches no prompt, rule file, or score.

Read one back with:

```bash
node packages/dogfood/read-handoff.mjs path/to/handoff.jsonl
```

## Drive a recording from Playwright

The IIFE bundle in the package is the same file the guided investigation injects. Load it before the application scripts, then call the recording API from the test. `stopRecording()` returns the session synchronously.

```ts
await page.addInitScript({ path: 'node_modules/canvas-scan/dist/canvas-scan.iife.js' });
await page.goto('http://localhost:5173/chart');
await page.evaluate(() => __CANVAS_SCAN__.startRecording());
await page.getByRole('button', { name: 'Zoom' }).click(); // drive the page
const session = await page.evaluate(() => __CANVAS_SCAN__.stopRecording());
fs.writeFileSync('session.json', JSON.stringify(session));
```

## For coding agents

canvas-scan ships an agent skill at `skills/canvas-scan/SKILL.md` in the published package, and at `packages/core/skills/canvas-scan` in the repository. It teaches the record, explain, change, compare workflow, how to read each finding type, and which code change matches each one. After install it is at `node_modules/canvas-scan/skills/canvas-scan`. Copy that directory into your agent's skills directory, or point the agent at it.

## The artifacts

`InvestigationSessionV1`, `ExplanationArtifactV1`, and `ComparisonArtifactV1` are versioned plain JSON: session metadata, browser features, canvases, windows, reset and lifecycle events, episodes, browser evidence entries, findings, collection limits, and dropped-entry counts. Every finding carries a `claimBoundary` stating what the evidence cannot prove and a `nextCheck` naming the next useful step.

A recording that reached the canvas limit keeps each evicted canvas as a summary with `windowDetailDropped: true`. `compareSessions` refuses a pairing only when the selected canvas is summary-only, because that canvas has no frames. Other summary-only canvases do not block the comparison. The artifact reports how many it left out on each side in `coverageNote`, and the overlay shows the same note.

**Privacy.** Artifacts never contain page text, input values, pixels, raw argument values, application URLs, or live objects. Explanation commands are normalized to typed tokens.

**canvas-scan sends no investigation data anywhere, by default or otherwise.** It performs no telemetry, upload, scoring, crash reporting, supply-chain check, remote-rule fetch, or update check. It makes one kind of network request of its own: it fetches your app's own source maps, bounded in count and size. Two things ask for them, and both follow something you did — canvas-scan never fetches on its own. Resolving a draw callsite during an explanation asks for one. So does a recording that produced findings, because a finding names the canvas it is about, and `app.min.js:1` is a real place and no help. That request cannot leave your app's origin — the resolver refuses a cross-origin resource before the fetch, and refuses a redirect that leaves the origin.

The claim is checked rather than asserted. `packages/dogfood/network-silence.mjs` defines one request-classification contract with three owners: the target navigation, the target's own application traffic, and canvas-scan's same-origin source maps. Anything else fails. `pnpm --filter dogfood run network-silence:test` runs the complete guided workflow with external network access cut off once the application has loaded, classifies every request the run made, and watches the command's own process for a socket leaving the machine.

## Overhead

Measured at the 1,000-operation gate level: full capture adds < 2 ms mean and < 3 ms p95 per frame; count-only observation adds < 0.75 ms mean and < 2 ms p95. Recording is bounded and everything is subject to fixed collection limits with explicit dropped-entry counts.

Those figures are for one canvas. The frame loop walks every tracked canvas on every frame, so an application with many canvases pays a cost per canvas as well. `pnpm --filter dogfood run bench:chrome` measures it with 10, 100, and 300 canvases that each draw 100 operations per frame, and prints the added cost per canvas per frame. Measured on 2026-09-02 (headless Chrome, Apple Silicon), median of five blocks:

| Canvases | Full capture, added per canvas per frame | Count-only, added per canvas per frame |
| --- | --- | --- |
| 10 | 140 to 170 µs | 26 to 31 µs |
| 100 | 115 to 118 µs | 18 µs |
| 300 | 114 to 119 µs | 18 µs |

The range is the two draw streams the bench runs (mixed and tracked-source). The per-canvas figure includes the 100 operations each canvas draws. At 300 canvases, full capture added 34 to 36 ms per frame, which is more than a 60 Hz frame. If a many-canvas application gets slow with canvas-scan loaded, that is the cost, and `stop()` removes it without a reload. A baseline and a candidate recorded with canvas-scan loaded in both runs are still comparable, because both pay the same cost.

Per-call self-time is a `performance.now()` delta, and the browser sets the
resolution of that clock. Chrome coarsens it to 0.1 ms when the page is not
cross-origin isolated, so most single calls read as 0 or 0.1 ms and a
per-method total is a sum of quantized values. The session JSON stores
`crossOriginIsolated` and `timerResolutionMs`, the smallest nonzero clock step
measured at stop. The overlay shows the resolution on its coverage line. Do
not read a self-time change smaller than `timerResolutionMs` as a change in
the work.

## Scope and honest limits

- Main-realm, main-thread Canvas2D only. Worker and transferred (OffscreenCanvas) canvases are outside the boundary. A `transferControlToOffscreen()` call is detected: the canvas gets a `transferred-to-worker` lifecycle event and `observability: 'unobservable'` in its session summary, and the overlay shows it as not observable. The work in the worker is absent from the artifact — no windows — and is never reported as zero-cost. A canvas created in a worker is not detected. canvas-scan reports what it observed and never claims the recording is complete.
- Command signatures cannot prove pixel identity. Untracked or changed inputs make a window `unknown`. `CanvasPattern` inputs remain `unknown`; animated images behind stable URLs are not proven stable.
- A `reset()` call or a width/height reset makes that window `unknown`, and observer-only reset detection can keep later windows `unknown` until a directly observed reset restores trusted state.
- Tracked source-canvas invalidation follows direct `drawImage()` dependencies only — it does not propagate through deeper chains.
- Raster work inside a skipped sampling window makes the next captured comparison `unknown`; idle skipped windows remain comparable. The work itself is not discarded — see **Sampling**.
- `getImageData` and `measureText` are timed and counted but their arguments are not part of the command signature, so they never make a window `changed`. `toDataURL` and `toBlob` on the canvas element are timed and counted the same way, and their time lands on that canvas. For `toBlob`, the measured span is the synchronous readback only. The asynchronous encode is not measured. `createPattern` and `isPointInPath` are not instrumented at all, and time spent in them is not measured.
- Native canvas APIs captured before canvas-scan installs are outside the observable boundary — hence the "first import" rule.
- Browser features (event timing, long animation frames) are detected per session and can be unavailable; associated evidence never claims causality.
- React attribution requires an early load and a supported React setup; callsite mapping requires development source maps.

These limits are product behavior, not fine print: when canvas-scan cannot observe something safely, it tells you `unknown` instead of inventing an answer.

## License

MIT
