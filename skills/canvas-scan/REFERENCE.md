# canvas-scan reference for agents

## Finding types and the fix that matches each

Every finding has `evidenceLevel: 'candidate'`, a `claimBoundary` with
`observation`, `explanation`, and `nonEstablishedFacts`, and a `nextCheck`.
Read `nonEstablishedFacts` before you propose a fix.

| Finding `type` | What was measured | What it does not prove | Where to change the code |
| --- | --- | --- | --- |
| `heavy-canvas-work` | One draw episode holds at least 8 ms of Canvas2D self-time on one canvas. `topMethods` ranks the methods. `maximumWindow` names the slowest frame. | GPU cost, render cost, wasted work. | Start at the function that calls the top method. The explanation's stack sample names it. Reduce the call count, batch paths, cache a static layer on an offscreen canvas, or skip a draw when nothing changed. If `maximumWindow.followsCanvasReset` is `true`, check the sizing code first: a width or height reset reallocates the backing store, and that cost lands on the next call. |
| `repeated-draw-work` | Captured windows sent the same command signature. `repeatedWindowCount` and `adjacentIdenticalWindowPairs` give the shape. | Unchanged pixels, wasted work. | Check whether the scene and the interaction need those commands. Add a dirty flag, skip the redraw when the inputs did not change, or draw only the changed region. |
| `resize-churn` | Reset events span repeated active windows. `resetEvents` carries the source and dimensions. `dimensionChanges` says how many resets changed nothing. | That the resets caused the slowness. | Set `width`, `height`, and `ctx.reset()` only when the dimensions or the state change. Compare the new size with the old size before you assign it. |
| `backing-store-mismatch` | The backing area is larger than the DPR-adjusted expected area. `affectedWindows` carries `actualToExpectedAreaRatio`. | Excess GPU cost. | Check the sizing policy. Set the backing size to CSS size times `devicePixelRatio`, and no larger, unless the image quality needs it. |

The two evidence levels you will also see:

- `measured`: Canvas2D self-time, raster counts, method evidence, resets. These are direct measurements.
- `associated`: an Event Timing entry or a long animation frame that overlapped a draw episode. It occurred at the same time. It is not a cause.

## InvestigationSessionV1 fields an agent needs

| Field | Use |
| --- | --- |
| `findings[]` | Ranked by `canvasApiSelfTimeMs`, highest first. Index into it with `findingIndex`. |
| `canvases[]` | One per canvas. `nearestReactOwner` and `sourceLocation` say where it was created. `observability: 'unobservable'` marks a canvas handed to a worker. `windowDetailDropped: true` marks a canvas kept as a summary only. |
| `episodes[]` | Draw episodes. An episode starts at the first frame with Canvas2D activity and ends after two quiet frames. |
| `browserEntries[]` and `episodeAssociations[]` | Event Timing and long-animation-frame entries, and which episode each overlapped. |
| `captureEvery` | The sampling rate. Two sessions at different rates do not compare. |
| `timerResolutionMs` | The clock step. A self-time delta below it is not a change. |
| `crossOriginIsolated` | `false` means Chrome coarsened the clock to 0.1 ms. |
| `stopReason` | `manual` or `max-duration`. The maximum is 30 seconds. |
| `collectionLimits` and dropped counts | Fixed caps. A reached cap means the recording is incomplete, and the artifact says by how much. |
| `timeOrigin` | Add it to a session timestamp to line up with a DevTools trace. |

## ComparisonArtifactV1 fields

| Field | Use |
| --- | --- |
| `status` | `comparable` or `incomparable`. |
| `incomparableReasons[]` | `finding-not-found`, `finding-type-mismatch`, `unsupported-schema`, `incomplete-evidence`, `sampling-mismatch`. |
| `measures[]` | The paired measures, baseline and candidate. Includes `worst-interaction-duration-ms` and `long-animation-frame-count`, each `null` when the browser did not supply the feature. |
| `span` and `spanMismatch` | Duration, episode count, and user-mark count of each side. `spanMismatch` is set above a 20 percent difference. |
| `coverageNote` | Set when either side kept a canvas as a summary only. |
| `improvementEstablished` | Always `false`. One measured pair does not prove the application improved. |

## API

```ts
import {
  start, stop, getReports, mark,
  startRecording, stopRecording, getLastSession,
  startExplanation, stopExplanation, getLastExplanation,
  compareSessions,
} from 'canvas-scan';
```

`start(options)` accepts `captureEvery`, `minFlashRasterOps`, `minRepeatedRasterOps`,
`overlay`, `skipOwners`, and `debug`. `stop()` removes the frame loop and the overlay
without a reload. `mark(label)` adds a labeled marker to the recording. A
`performance.mark` or `performance.measure` made during a recording is stored as a
`user-mark` entry.

## Overlay path, for a human in the loop

Record investigation, open a finding, Explain next interaction, Keep as baseline,
make the change, Record investigation, Compare with baseline. Each step has a Copy
JSON and a Download JSON control. Load session JSON opens a saved session.

## Limits to state in every report

- Main-realm, main-thread Canvas2D only. Worker and OffscreenCanvas work is absent, never zero.
- Command signatures do not prove pixel identity. A reset, a `CanvasPattern` input, or a resized source canvas makes a window `unknown`.
- `createPattern` and `isPointInPath` are not instrumented. The asynchronous part of `toBlob` is not measured.
- A canvas created before canvas-scan loaded is outside the boundary.
- React attribution needs an early load. Callsite mapping needs development source maps, and canvas-scan fetches only same-origin maps.
- canvas-scan sends no data anywhere.
- Per-canvas overhead at 300 canvases exceeds one 60 Hz frame. Both the baseline and the candidate pay it, so they still compare.
