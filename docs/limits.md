# Scope and honest limits

Back to the [README](https://github.com/yomete/canvas-scan#readme).

- Main-realm, main-thread Canvas2D only. Worker and transferred (OffscreenCanvas) canvases are outside the boundary. A `transferControlToOffscreen()` call is detected: the canvas gets a `transferred-to-worker` lifecycle event and `observability: 'unobservable'` in its session summary, and the overlay shows it as not observable. The work in the worker is absent from the artifact — no windows — and is never reported as zero-cost. A canvas created in a worker is not detected. canvas-scan reports what it observed and never claims the recording is complete.
- Command signatures cannot prove pixel identity. Untracked or changed inputs make a window `unknown`. `CanvasPattern` inputs remain `unknown`; animated images behind stable URLs are not proven stable.
- A `reset()` call or a width/height reset makes that window `unknown`, and observer-only reset detection can keep later windows `unknown` until a directly observed reset restores trusted state.
- Tracked source-canvas invalidation follows direct `drawImage()` dependencies only — it does not propagate through deeper chains.
- Raster work inside a skipped sampling window makes the next captured comparison `unknown`; idle skipped windows remain comparable. The work itself is not discarded — see [Sampling](https://github.com/yomete/canvas-scan/blob/main/docs/api.md#sampling).
- `getImageData` and `measureText` are timed and counted but their arguments are not part of the command signature, so they never make a window `changed`. `toDataURL` and `toBlob` on the canvas element are timed and counted the same way, and their time lands on that canvas. For `toBlob`, the measured span is the synchronous readback only. The asynchronous encode is not measured. `createPattern` and `isPointInPath` are not instrumented at all, and time spent in them is not measured.
- Native canvas APIs captured before canvas-scan installs are outside the observable boundary — hence the "first import" rule.
- Browser features (event timing, long animation frames) are detected per session and can be unavailable; associated evidence never claims causality.
- React attribution requires an early load and a supported React setup; callsite mapping requires development source maps.

These limits are product behavior, not fine print: when canvas-scan cannot observe something safely, it tells you `unknown` instead of inventing an answer.
