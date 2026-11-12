# Overhead and timer resolution

Back to the [README](https://github.com/yomete/canvas-scan#readme).

Measured at the 1,000-operation gate level: full capture adds < 2 ms mean and < 3 ms p95 per frame; count-only observation adds < 0.75 ms mean and < 2 ms p95. Recording is bounded and everything is subject to fixed collection limits with explicit dropped-entry counts.

Those figures are for one canvas. The frame loop walks every tracked canvas on every frame, so an application with many canvases pays a cost per canvas as well. `pnpm --filter dogfood run bench:chrome` measures it with 10, 100, and 300 canvases that each draw 100 operations per frame, and prints the added cost per canvas per frame. Measured on 2026-09-02 (headless Chrome, Apple Silicon), median of five blocks:

| Canvases | Full capture, added per canvas per frame | Count-only, added per canvas per frame |
| --- | --- | --- |
| 10 | 140 to 170 µs | 26 to 31 µs |
| 100 | 115 to 118 µs | 18 µs |
| 300 | 114 to 119 µs | 18 µs |

The range is the two draw streams the bench runs (mixed and tracked-source). The per-canvas figure includes the 100 operations each canvas draws. At 300 canvases, full capture added 34 to 36 ms per frame, which is more than a 60 Hz frame. If a many-canvas application gets slow with canvas-scan loaded, that is the cost, and `stop()` removes it without a reload. A baseline and a candidate recorded with canvas-scan loaded in both runs are still comparable, because both pay the same cost.

## Instrumented timings are not user latency

canvas-scan wraps every Canvas2D call, and the wrappers cost time on every call. In one flame-graph view, instrumentation roughly doubled script time per input: zoom went from 14.8 ms to 32.2 ms, and pan from 20.4 ms to 46.4 ms. Those are instrumented figures. They say which canvas and which calls dominate. They do not say how long the user waited.

Use two kinds of run, and keep them apart:

1. **Diagnosis, with canvas-scan.** Record, explain, and compare Canvas2D work. A baseline and a candidate that both run with canvas-scan pay the same overhead, so they compare with each other.
2. **Latency, without canvas-scan.** Measure input latency and frame time in a page that never loaded canvas-scan: a fresh browser context with no `addInitScript`, or a build without the import. Use a browser performance trace or Event Timing.

`stop()` cancels the frame loop and removes the overlay, but the Canvas2D prototype wrappers stay until the page reloads. Leftover wrappers added about 3 ms to one trace. Before an uninstrumented trace, close the browser context, or reload the page without the injection or the import. Nothing short of a reload removes the wrappers.

## Timer resolution

Per-call self-time is a `performance.now()` delta, and the browser sets the
resolution of that clock. Chrome coarsens it to 0.1 ms when the page is not
cross-origin isolated, so most single calls read as 0 or 0.1 ms and a
per-method total is a sum of quantized values. The session JSON stores
`crossOriginIsolated` and `timerResolutionMs`, the smallest nonzero clock step
measured at stop. The overlay shows the resolution on its coverage line. Do
not read a self-time change smaller than `timerResolutionMs` as a change in
the work.
