<!-- This README is packed with the canvas-scan package. -->

# canvas-scan

This source builds `canvas-scan@0.5.0`.

canvas-scan is a drop-in Canvas2D investigation tool. It observes main-thread
Canvas2D work. React owner data is optional attribution, not the product
boundary.

## Status

The release records a bounded investigation session. It reports
measured Canvas2D API self-time, associated browser evidence, and review
candidates. It does not claim GPU time, render time, causality, wasted work,
or pixel identity. Repeated commands are a review candidate only.

## Install

```bash
npm install -D canvas-scan
npx canvas-scan init --write
```

Load canvas-scan before React and before application Canvas2D work:

```ts
import 'canvas-scan/auto'; // first import
```

You can also call the module API:

```ts
import {
  compareSessions,
  getLastExplanation,
  getLastSession,
  mark,
  start,
  startExplanation,
  startRecording,
  stopExplanation,
  stopRecording,
} from 'canvas-scan';
start();
```

The CLI supports Vite and Next. For a script tag, copy
`node_modules/canvas-scan/dist/canvas-scan.iife.js` to your public directory
and load it before other scripts. A pnpm workspace uses the same first import.

## v0.5 investigation ritual

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

## Session artifact

`InvestigationSessionV1` is plain JSON. It contains `schemaVersion`, session
metadata, browser features, canvases, windows, reset events, lifecycle events,
episodes, browser entries, episode associations, findings, collection limits,
and dropped-entry counts. It does not contain page text, input values, pixels,
or live objects.

Findings use four types: `heavy-canvas-work`, `repeated-draw-work`,
`resize-churn`, and `backing-store-mismatch`. Evidence is `measured`,
`associated`, or `candidate`. `claimBoundary` states what the evidence cannot
prove. `nextCheck` states the next useful check.

- `heavy-canvas-work` means one episode contains at least 8 ms of measured
  synchronous Canvas2D API self-time. It is not GPU or render time. Check the
  top measured methods and the application code that calls them.
- `repeated-draw-work` means captured windows sent the same commands. This is a
  review candidate. This does not claim unchanged pixels or wasted work. Check whether
  the scene and interaction require those repeated commands.
- `resize-churn` means reset events span repeated active raster-work windows. It
  does not prove that resets caused slowness. Check whether sizing and reset
  calls can run only when dimensions or state change.
- `backing-store-mismatch` means the recorded backing area is larger than the
  DPR-adjusted expected area. It does not prove excess GPU cost. Check the
  sizing policy and required image quality.

Canvas2D API self-time is measured synchronous API time. It is not GPU or
render time. Interaction and long-frame overlap is associated evidence. It
does not prove causality. The tool does not claim that repeated commands show wasted work or pixel identity.

## Limits

- The tool observes main-realm Canvas2D only.
- Worker and transferred canvases are outside the boundary.
- Browser features are detected and can be unavailable.
- Retention is bounded by the session collection limits.
- The session excludes private page text, input values, pixels, and objects.
- Command signatures cannot prove pixel identity. Untracked or changed inputs
  can make a window `unknown`.
- CanvasPattern inputs remain `unknown`. Animated images or changing image
  contents behind stable URLs and dimensions are not proven stable.
- A `reset()` call or width or height reset makes that window `unknown`.
  Observer-only reset detection can keep later windows `unknown` until a
  directly observed reset restores trusted state.
- Tracked source-canvas reset invalidation follows direct `drawImage()`
  dependencies only. It does not propagate through a deeper A to B to C chain.
- Raster work in a skipped sampling window makes the next captured comparison
  `unknown`. Idle skipped windows remain comparable.
- Native reset APIs captured before canvas-scan installs are outside the
  observable boundary.
- React attribution is optional and depends on an early load and supported
  browser and React information.
- Full capture adds <2ms mean and <3ms p95. Count-only adds <0.75ms mean and
  <2ms p95 at the 1,000-operation gate level.

## License

MIT
