# API, options, and sampling

Back to the [README](https://github.com/yomete/canvas-scan#readme).

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

## Options

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

## Sampling

Above `captureEvery: 1`, canvas-scan reports one window in every *n*. The windows in between are still measured: their raster operations, Canvas2D API self-time, and method evidence are carried into the next reported window, and that window's `coveredWindowCount` says how many windows it covers. A sampled recording therefore totals the whole of what was measured, and the 8 ms heavy-work gate sees the real figure. The episode-break gap scales with `captureEvery` for the same reason, so grouping does not collapse into one window per episode.

The session records the rate it was made at as `captureEvery`. `compareSessions` refuses a pair recorded at different rates with `sampling-mismatch`, because their totals are not on one scale.
