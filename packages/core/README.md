<!-- This README is packed with the canvas-scan package. -->

# canvas-scan

> One early import that watches every main-thread Canvas2D canvas in your app — and turns "this canvas feels slow" into a correct next check.

[![npm version](https://img.shields.io/npm/v/canvas-scan)](https://www.npmjs.com/package/canvas-scan)
[![license: MIT](https://img.shields.io/npm/l/canvas-scan)](./LICENSE)


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
<script src="https://unpkg.com/canvas-scan@0.7.1/dist/canvas-scan.iife.js"></script>
```

Reload, press **Record investigation** in the overlay, reproduce the slow interaction once, and stop. Findings appear ranked, each with its evidence level, its claim boundary, and its next check.


## What it finds

- **`heavy-canvas-work`** — one draw episode contains at least 8 ms of measured synchronous Canvas2D API self-time. Not GPU or render time. Next: check the top measured methods and the application code that calls them.
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
   **Copy explanation JSON** when you need the artifact.
5. Select **Keep as baseline** on the explained finding.
6. Make the application change. Start a candidate with `startRecording()`,
   reproduce the same bounded interaction, and stop with `stopRecording()`.
7. Open a candidate of the same finding type. Select **Compare with baseline**,
   or call `compareSessions(baseline, candidate, { baselineFindingIndex,
   candidateFindingIndex })`. The pairing is always explicit.
8. Review the measured pair. Select **Copy comparison JSON** to copy the plain
   JSON artifact.

Explanation detail covers only the selected canvas. It excludes raw argument
values, page text, pixels, and raw application and argument URLs. It also
excludes application objects and source content. Sanitized selected-callsite
evidence can include generated script paths and mapped source paths. A result
can be an honest `unknown` when safe comparison is not possible. One measured
pair does not prove that the application improved.

The state changes from `idle` to `recording` to `complete` to `recording`.
The maximum duration is 30 seconds. Stops are `manual` or `max-duration`.
Calling start while recording is idempotent.

## API

```ts
import {
  start,                // begin passive observation (what /auto does)
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

## For coding agents

canvas-scan ships an agent skill at `skills/canvas-scan/SKILL.md` in the published package, and at `packages/core/skills/canvas-scan` in the repository. It teaches the record, explain, change, compare workflow, how to read each finding type, and which code change matches each one. After install it is at `node_modules/canvas-scan/skills/canvas-scan`. Copy that directory into your agent's skills directory, or point the agent at it.

## The artifacts

`InvestigationSessionV1`, `ExplanationArtifactV1`, and `ComparisonArtifactV1` are versioned plain JSON: session metadata, browser features, canvases, windows, reset and lifecycle events, episodes, browser evidence entries, findings, collection limits, and dropped-entry counts. Every finding carries a `claimBoundary` stating what the evidence cannot prove and a `nextCheck` naming the next useful step.

**Privacy.** Artifacts never contain page text, input values, pixels, raw argument values, application URLs, or live objects. Explanation commands are normalized to typed tokens. The tool makes no network requests of its own, with one exception: resolving a draw callsite during an explanation fetches your app's own source maps, bounded in count and size. Nothing is sent anywhere.

## Overhead

Measured at the 1,000-operation gate level: full capture adds < 2 ms mean and < 3 ms p95 per frame; count-only observation adds < 0.75 ms mean and < 2 ms p95. Recording is bounded and everything is subject to fixed collection limits with explicit dropped-entry counts.

## Scope and honest limits

- Main-realm, main-thread Canvas2D only. Worker and transferred (OffscreenCanvas) canvases are outside the boundary and are reported as unobservable, never as zero-cost.
- Command signatures cannot prove pixel identity. Untracked or changed inputs make a window `unknown`. `CanvasPattern` inputs remain `unknown`; animated images behind stable URLs are not proven stable.
- A `reset()` call or a width/height reset makes that window `unknown`, and observer-only reset detection can keep later windows `unknown` until a directly observed reset restores trusted state.
- Tracked source-canvas invalidation follows direct `drawImage()` dependencies only — it does not propagate through deeper chains.
- Raster work inside a skipped sampling window makes the next captured comparison `unknown`; idle skipped windows remain comparable.
- Native canvas APIs captured before canvas-scan installs are outside the observable boundary — hence the "first import" rule.
- Browser features (event timing, long animation frames) are detected per session and can be unavailable; associated evidence never claims causality.
- React attribution requires an early load and a supported React setup; callsite mapping requires development source maps.

These limits are product behavior, not fine print: when canvas-scan cannot observe something safely, it tells you `unknown` instead of inventing an answer.

## License

MIT
