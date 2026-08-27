# PolarSignals dogfood run — canvas-scan

Date: 2026-08-21
Target: `~/Documents/batcave/polarsignals`, app `ui/packages/app/cloud-v2`, dev server on port 3000.
Tool under test: `canvas-scan.iife.js` (built from this repo).

## Goal

Use canvas-scan on a real product codebase with heavy Canvas2D charts. Find real
performance defects, fix them, and measure each fix with a before/after pair of
recordings. This run also tests whether the tool's findings hold up outside the
synthetic demo.

## Instrumentation

- Copy `canvas-scan.iife.js` into `ui/packages/app/cloud-v2/public/`.
- Add a `<script src="/canvas-scan.iife.js">` tag to `pages/_document.tsx`.
- Record an interaction in the browser, then export the session JSON.

The recorder attributes self-time to Canvas2D calls per animation frame. It
compares each frame against the previous frame that drew the same geometry, so
it can flag work that repeats without visible change.

## Finding 1 — LineChart hover repaints identical frames

**Symptom.** Moving the pointer over a LineChart triggers a full overlay-canvas
repaint on every `pointermove` frame. Analysis reports hundreds of
same-content window pairs (380 in the baseline session).

**Root cause.** The hover object gets a fresh identity on every pointermove,
because it carries cursor coordinates for the DOM tooltip. The overlay draw
effect depends on that object. React re-runs the effect each frame, and the
overlay renderer strokes every visible series polyline again. Nothing visible
changes, because the hovered point does not move the drawing.

**Fix.** Key the overlay effect on the inputs that reach the canvas. Build a
content key from hover points, drag state, selection, highlighted series,
hidden series, viewport, size, compact mode, area fill, and dark mode. Skip
the effect when the key matches the previous render. Apply the same guard to
ScatterChart and BarChart overlays.

**Evidence.**

| Metric | Before | After |
|---|---|---|
| Same-content window pairs | 380 | 0 |
| Findings | 18 | 0 |

## Finding 2 — Flamegraph resize stalls interaction by up to 728 ms

**Symptom.** Toggling Invert Call Stack on the Flamegraph freezes the page.
The worst pointerup-to-paint gap measures 728 ms. Long-animation-frames show
~500 ms stalls with no script attribution.

**Root cause.** Each toggle assigns `canvas.width` and `canvas.height`, even
when the values do not change. Assigning either property forces the browser to
reallocate the backing store and clear it. The flamegraph canvas spans tens of
megapixels, so the reallocation dominates the redraw. The cost lands on the
next context call after the assignment, which makes `save()` measure 21–74 ms
per toggle in the baseline session.

**Fix.** Add `syncCanvasSize(canvas, width, height)` in
`Flamegraph/canvasSize.ts`. The helper skips both assignments when the
dimensions already match. This is safe because the renderer clears and repaints
the full area itself; nothing depends on the implicit clear from the
assignments. Unit tests cover the skip and assign paths.

**Evidence.** Baseline: 16 toggles. Candidate: 32 toggles, so compare
per-toggle costs.

| Metric | Baseline | Candidate |
|---|---|---|
| Total Canvas2D self-time | 479 ms (~30 ms/toggle) | 283 ms (~8.8 ms/toggle) |
| Worst single window | 77.5 ms | 8.6 ms |
| Cumulative `save()` self-time | 320.9 ms | 1.7 ms |
| Worst pointerup-to-paint | 728 ms | 72 ms |
| ~500 ms silent long frames | many | 1 (initial load, unrelated) |

The `save()` anomaly disappears completely. Remaining reset events are honest:
each toggle flips between two genuine sizes (13824 vs 12336 device pixels),
because the two orientations expose different row ranges.

## Negative result — Flamegraph scroll

Scrolling the flamegraph produces no findings. Scrolling translates the canvas
with a CSS transform and draws twice per gesture. The tool does not flag
healthy transform-based scrolling.

## Residual work

Each toggle still costs one backing-store reallocation, because the two
orientations have different heights. A stable-buffer approach would remove
this too: allocate once at maximum height and never touch `width` or `height`.
That trades memory for churn, so it is a product decision for upstream.

## State of local changes

All changes sit uncommitted on branch `main` in `~/Documents/batcave/polarsignals`:

- `ui/packages/app/cloud-v2/pages/_document.tsx` — instrumentation script tag.
- `ui/packages/app/cloud-v2/public/canvas-scan.iife.js` — new file.
- `ui/packages/shared/viz/src/{LineChart,ScatterChart,BarChart}/index.tsx` — overlay content-key guards.
- `ui/packages/shared/viz/src/Flamegraph/index.tsx` — uses `syncCanvasSize`.
- `ui/packages/shared/viz/src/Flamegraph/canvasSize.ts` + `canvasSize.test.ts` — new files.

Verification passed: 22/22 Jest tests, clean `tsc`.

## Repeating this run

1. Start the dev server (`next dev` in `ui/packages/app/cloud-v2`).
2. Open the app and confirm `window.__canvasScan` exists.
3. Record one interaction per scenario. Export the session JSON.
4. Compare findings and per-frame self-time against the tables above.
