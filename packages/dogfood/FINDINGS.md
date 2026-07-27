# Dogfood findings — workbench run, 2026-07-26

Setup: `apps/workbench` (react-konva 19 + Konva.Animation, chart.js 4 via
react-chartjs-2, React 19 **StrictMode ON**, react-scan loaded alongside via
unpkg) instrumented with the canvas-scan IIFE bundle via script tag, driven by
`collect.mjs` in headless Chrome. Raw data: `results/2026-07-26-workbench.json`.

Scenario: 3s mount/settle → 5× "rerender same data" → 2× "change data" →
mouse-drag across the konva stage → 2s settle. ~1,750 animation-frame windows.

## Per-canvas summary

| canvas | inferred identity | owner (kind) | windows | same/changed/unknown |
|---|---|---|---|---|
| 1, 2 | startup utility canvases (konva/react-scan internals) | — (unattributed) | 1 each | 0/0/1 |
| 3 | konva stars layer, scene | StageWrap (container-only) | 12 | 1/10/1 |
| 4 | konva stars layer, hit | — (unattributed, not in DOM) | 12 | **9**/2/1 |
| 5 | konva animated layer, scene | StageWrap (container-only) | 1750 | 0/1750/0 |
| 6 | konva animated layer, hit | — (unattributed) | 1750 | 0/1750/0 |
| 7, 9 | konva buffer canvases | — (unattributed) | 1–2 | mostly unknown, idle |
| 8 | chart.js | **ChartComponent (jsx-owner)** | 311 | 0/0/**311** |

No kill-switch warnings, no page errors, `reactScanPresent: true`.

## Findings

1. **chart.js is 100% `unknown` — Path2D is the cause (verified in its
   source).** chart.js 4 feature-detects Path2D and builds line geometry into
   `new Path2D()` objects, then strokes them. Path2D is on our mandatory-
   unknown list, so every window poisons. The honesty rule works as designed,
   but it makes the headline feature useless for the single biggest canvas-
   charting library. **Core design consequence (highest-priority M2 item):
   capture Path2D construction** — wrap the Path2D constructor + its path
   methods, hash the build-command stream per object, and treat the object as
   a stable token (identity + build hash) instead of poison. Same likely
   applies to CanvasGradient (hash construction + color stops).
2. **The konva ecosystem validates the hypothesis.** Scene canvases report
   `changed` under animation/drag (1,750/1,750 for the rotating layer — no
   false `same` at 60fps), and the redundancy signal fired for real: konva
   redrew the stars **hit canvas** with command-identical streams in 9 of 12
   windows. First genuine real-world "investigation candidate" the tool has
   surfaced.
3. **Reports need an `unknownReason` field.** Diagnosing finding 1 required
   grepping chart.js source. The capture layer knows exactly which arg
   poisoned the window — surface it (e.g. `unknownReason: 'Path2D'`).
4. **Attribution names library wrappers, not user components.** The konva
   scene canvases attribute to react-konva's internal `StageWrap`, not the
   user's `KonvaSection`. Needs a library-wrapper filter list when walking to
   the composite owner (react-scan and react-grab both ship such lists).
   Hit/buffer canvases are detached from the DOM → truthfully `unattributed`;
   acceptable, document it.
5. **react-scan coexistence: pass.** Both tools share the bippy hook; reports
   flowed for the entire run, zero errors, zero instrumentation warnings —
   with react-scan's own overlay canvases also being observed by us.
6. **StrictMode: no false-`same` storm.** Double-invoked mounts show up as a
   couple of extra early windows; steady-state classification is unaffected.

## Addendum — re-run after M2 slice 1 (Path2D/gradient capture, same day)

Raw data: `results/2026-07-26-workbench-after-path2d.json`. The chart.js
canvas went from 311 windows / 100% `unknown` to **367 windows / 0 `unknown`
(33 `same`, 334 `changed`)** — the 33 `same` windows are the
rerender-same-data clicks being caught, which is the product's headline
scenario working on real chart.js. Konva results unchanged; coexistence still
clean; no kill-switch trips. Finding 1 is resolved; finding 3
(`unknownReason`) shipped in the same slice.

Finding 4 resolved 2026-07-27: the owner walk now skips a library-wrapper
deny-list (`StageWrap`, `Stage`; extensible via `start({ skipOwners })`) AND
1–2-character names (minified library internals — react-konva's dist exposed
an `m` between Stage and the user component), always falling back to the
nearest named composite rather than null. Re-run: konva canvases attribute to
`KonvaSection` (container-only), chart unchanged (`ChartComponent`,
jsx-owner).

## Verdict

The signal survives contact with reality **for direct-canvas and konva-style
apps**, and already produced one real find. It fails (honestly, as `unknown`)
for Path2D-based libraries — chart.js today, likely more over time. Path2D
capture is the gating work before the tool is broadly useful; do it before any
overlay/alpha work. Excalidraw run deferred until after Path2D capture (its
rough.js renderer draws direct-to-context, but the repo's yarn/corepack setup
under node 25 needs its own session).
