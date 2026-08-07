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

# Dogfood findings — Excalidraw run, 2026-07-27

Setup: excalidraw/excalidraw @ `b2e81e3` (shallow clone in a scratch dir, React
19, on-demand renderer, no react-scan), instrumented by injecting the IIFE
bundle as the first script tag of `excalidraw-app/index.html` (served from the
repo's vite publicDir; vite's injected module scripts are deferred, so the
synchronous IIFE still evaluates before React). Driven by `collect.mjs`
scenario `excalidraw` in headless Chrome: 3s idle → two rectangles drawn via
mouse drags (`r` tool key) → hand-tool pan → 5s idle. Raw data:
`results/2026-07-27-excalidraw.json`. A one-off timeline probe (same scenario,
per-window timestamps interleaved with scenario phase marks) backed findings
3–4. `collect.mjs` gained per-canvas `unknownReasons` aggregation for this run.

Install friction, for the record: brew's yarn 1.22.22 matched the repo's
`packageManager` pin exactly (no corepack needed), but the full-workspace
install died on network timeouts fetching `@next/swc-*` binaries needed only
by `examples/*` — trimming that workspace from the throwaway clone plus
`--network-timeout 600000` got a clean install in ~16 min.

## Per-canvas summary

24 canvases observed, 77 windows total. No kill-switch warnings, no page
errors.

| canvas | inferred identity | owner (kind) | windows | same/changed/unknown | unknownReason |
|---|---|---|---|---|---|
| 2 | static scene canvas | StaticCanvas (container-only) | 17 | 2/0/**15** | HTMLCanvasElement ×15 |
| 3 | interactive UI canvas | InteractiveCanvas (jsx-owner) | 18 | 2/16/0 | — |
| 4, 15 | in-progress-shape canvas (remounted per drawing session) | NewElementCanvas (jsx-owner) | 11 each | 0/0/11 | first-window ×1, HTMLCanvasElement ×10 |
| 5–14, 16–25 | one-shot canvases (element caches / text-measure / cursor utilities) | — (unattributed) | 1 each | 0/0/1 | canvas-resize |

## Findings

1. **The flagship expectation is refuted — the main canvas is unknown-heavy,
   and the honesty rule is doing exactly its job.** The premise was that
   rough.js draws direct-to-context, so Excalidraw would read as
   `same`/`changed`. rough.js *does* draw direct-to-context — but into
   per-element **cache canvases**, not the scene canvas (verified in source:
   `packages/element/src/renderElement.ts` — `generateElementCanvas`,
   `elementWithCanvasCache` WeakMap, then `context.drawImage(...)` onto the
   scene). Every content redraw of StaticCanvas includes
   `drawImage(HTMLCanvasElement)`, which is mandatory-unknown (a source
   canvas's pixels can change without the command stream changing), so the
   canvas that matters most is 15/17 `unknown`. Same pattern on
   NewElementCanvas during drags.
2. **Where draws stay direct, the signal stays readable.** InteractiveCanvas
   (selection UI, scrollbars) reported 16 `changed` / 2 `same` / 0 `unknown`
   across drags and pan — no false `same` during 60fps interaction.
3. **Idle is genuinely silent.** Zero windows during both the 3s leading and
   5s trailing idle phases (timeline probe) — Excalidraw is an on-demand
   renderer, so the feared idle-redraw false-`same` storm can't occur outside
   text editing (cursor blink lives in DOM editing, untested here).
4. **The 4 `same` windows are honest micro-repaints, and they hint at an
   overlay UX rule.** Timeline: the mount double-draw at t≈0 (both canvases,
   1 op, gap 1) and a wake-up repaint on each canvas at interaction start
   (1 op, gap ≈365). Command-identical, so `same` is correct — but a 1-op
   `same` window is noise next to the konva hit-canvas find (9/12 windows of
   real work). The overlay should probably weight `same` flags by
   rasterOperationCount before shouting. Observation only; no core change
   made.
5. **Attribution is flagship-quality out of the box.** Real component names
   (`StaticCanvas`, `InteractiveCanvas`, `NewElementCanvas`) with sensible
   kinds, zero `skipOwners` configuration, no minified-wrapper leakage.
   Caveat: Excalidraw is the app here; for a host app *embedding*
   `@excalidraw/excalidraw`, these same names become library wrappers —
   future `skipOwners` preset candidates.
6. **`unknownReason` paid for itself.** Diagnosing finding 1 took zero
   library-source grepping — the field named the poisoning arg type directly
   (contrast: the chart.js/Path2D diagnosis required reading chart.js
   internals). The 20 one-shot utility canvases self-explained as
   `canvas-resize`.
7. **Core design consequence — tracked-canvas source tokens are the next
   Path2D-shaped gap (M2 slice 2 candidate).** The element cache canvases are
   same-realm and already wrapped by our `getContext` patch — the tool
   *observes every draw into them*. Treating a drawImage source that is a
   **tracked** canvas as an (identity + content-version) token — version
   bumped per draw batch into that canvas — would let compositing canvases
   classify honestly, exactly as Path2D build-hash tokens fixed chart.js.
   Untracked canvases, worker/OffscreenCanvas, and video must still poison.
   Not implemented in this run (rule: the failure is the finding).

## Addendum — re-run after tracked-canvas tokens (hardening batch 4, 2026-07-27)

Raw data: `results/2026-07-27-excalidraw-after-tokens.json`. StaticCanvas
went from 2/0/15 (`HTMLCanvasElement` ×15) to **3 same / 14 changed /
0 unknown**; NewElementCanvas from 0/0/11 to 0/10/1 (first-window only).
Zero `HTMLCanvasElement` poisons anywhere. The 3 StaticCanvas `same`
windows are command-identical recomposites of unchanged caches — the
first real review candidates surfaced THROUGH a compositing layer.
Finding 7 is resolved; the verdict below is superseded for
cache-compositing apps.

## Verdict

On the flagship real-world app, attribution and the honesty infrastructure
worked flawlessly, but the headline signature signal is largely **mute where
it matters most**: cache-canvas compositing — the architecture every serious
canvas app converges on (Excalidraw element caches, konva cached shapes, pixi
render textures) — poisons the compositing canvas to `unknown` by design.
Canvas-source capture (finding 7) is the gating work for this class of app,
and it is the same shape of work as the Path2D fix that unlocked chart.js.

---

# Dogfood findings — Polar Signals Cloud profiler, 2026-07-29

The first run against a production application rather than a library fixture.

Setup: `canvas-scan@0.3.0` IIFE bundle, loaded by a script tag in
`_document.tsx` of the `cloud-v2` Next.js app (Next 16.2.6, **React 18.3.1**),
against the live production API with a real account. Driven through Chrome by
the agent: initial load, hover sweeps over the time-series and the flamegraph,
a re-run of the query, three Apply clicks with unchanged state, and two
flamegraph zooms. The edit was local and reverted afterwards.

## Per-canvas summary

| canvas | owner (kind) | frames | same/changed/unclear | draw calls | notes |
|---|---|---|---|---|---|
| 1 | — (unattributed) | 1 | 0/0/1 | 7 | pre-React utility canvas |
| 2 | LineChartInner (jsx-owner) | 3 | 0/2/1 | 16 | time-series axis |
| 3 | LineChartInner (jsx-owner) | 3 | 0/2/1 | 783 | time-series lines |
| 4 | LineChartInner (jsx-owner) | 5 | 0/4/1 | 1 | hover crosshair |
| 5 | FlamegraphCanvasInner (jsx-owner) | 1 | 0/0/1 | 760 | first flamegraph |
| 6 | PlaceholderCanvas (jsx-owner) | 1 | 0/0/1 | 534 | loading placeholder |
| 7 | FlamegraphCanvasInner (jsx-owner) | 3 | 0/0/3 | 883 | flamegraph after re-query |

**7 canvases, 0 review candidates.**

## Findings

1. **Attribution works on React 18.** Every React-owned canvas resolved to a
   named component with the `jsx-owner` kind. The handoff listed React 18 as
   unvalidated. It is now validated on one production application.

2. **The canvases the tool could judge did not repeat draw commands.** No
   judged canvas reported `same`. Hovering the time-series redraws only a
   one-call crosshair canvas, correctly `changed`, and three Apply clicks with
   unchanged state caused no redraw at all. The flamegraph returned no verdict
   at all: every flamegraph window was `unclear`, so this run says nothing about
   repeated draw commands there.

3. **`canvas-resize` blinds the tool on the canvas that matters most.** Every
   flamegraph redraw reported `unclear`, with the reason `canvas-resize`. The
   flamegraph sizes its canvas on each zoom, so the tool refuses to compare and
   gives no verdict on an 883-call canvas. Any charting library that sizes a
   canvas to its container hits this, which is most of them. **This is the most
   valuable finding of the run, and it is about canvas-scan, not the
   application.**

4. **The first flamegraph paint cost 21.6 ms of canvas API self-time in one
   frame.** The warm redraw of a larger flamegraph cost 2.3 ms for 883 calls.
   The measurement is enqueue time, not GPU time, so this is a hint rather
   than a conclusion.

5. **`FlamegraphCanvasInner` creates a new canvas element per query.** The
   retired canvas and its replacement appear as separate lifetimes. The 0.3.0
   identity model keeps their histories separate, which is what it exists for.

6. **`PlaceholderCanvas` issues 534 draw calls for a loading placeholder.**

## Verdict

The install path, the overlay, and attribution all work in a production
Next.js application on React 18. The tool found no `same` on the canvases it
could judge. It returned no verdict on the flamegraph or loading placeholder,
so this run does not establish that the application wastes nothing across all
paths exercised.

The run earns its keep through finding 3. `canvas-resize` is a self-inflicted
blind spot: `reset()` already clears the modelled state without poisoning the
window, and a resize does the same thing plus a dimension change. The fix is to
model the dimensions instead of refusing to compare. That work follows this
run.

---

# Dogfood findings — published v0.4.0 on Excalidraw, 2026-08-06

Setup: `canvas-scan@0.4.0` from the public npm tarball ran against
excalidraw/excalidraw at `219571a7187651c79648de08c9a98a3b2f7f607a`.
The test used Google Chrome `150.0.7871.189` and Excalidraw's React 19 app.
The public IIFE loaded before the React entry.

The disposable checkout removed the `examples/*` workspace before install.
This change avoided unrelated example dependencies. It did not change the
Excalidraw application or the Canvas2D path.

Exact commands:

```text
git clone --depth 1 https://github.com/excalidraw/excalidraw.git /private/tmp/sidproj-59-excalidraw.4YCqNA/repo
yarn install --frozen-lockfile --ignore-scripts --network-timeout 600000
yarn --cwd excalidraw-app vite --host 127.0.0.1 --port 4385
node packages/dogfood/excalidraw-v04.mjs http://127.0.0.1:4385 /private/tmp/sidproj-59-excalidraw-v04.json /private/tmp/sidproj-59-excalidraw-v04.png 219571a7187651c79648de08c9a98a3b2f7f607a
```

The disposable setup copied the public IIFE to
`public/canvas-scan.iife.js`. It loaded that file and an early-load marker
before `index.tsx`.

The scenario recorded two rectangle draws and one pan. The screenshot shows
both rectangles and the completed canvas-scan recording.

Artifacts:

- Raw session evidence: `results/2026-08-06-excalidraw-v04.json`.
- Raw evidence SHA-256: `e7b338ef848ff3eb76035508c38e39aecb4f19e2d52254f80348a2181a06b248`.
- Screenshot SHA-256: `790a0d1a5de0dbc3866ec61bba05865d6eb7e74319e8166e8f182acdc5ccaaef`.
- Session SHA-256: `ee551261fd5c65df5d63696c91445f033000014382355d12650c7694e1212b74`.
- Public tarball SHA-256: `80ec1ccb685dccd93db19ff93832bb664ffe58a9411a1d6995b286fd9893cc0e`.
- Loaded IIFE SHA-256: `8e1773f85717275799d22abee05f7d03874615a5d350a79fe0f8e28a93dfe15c`.

## Result

The public package passed all harness checks. The public API reported version
`0.4.0`, and the early-load marker found the React hook before React started.
The saved session matched `getLastSession()`. The browser reported no page
errors, console errors, or canvas-scan warnings.

The harness found the rectangle tool active before each rectangle. The static
scene hash changed after each draw. It then found the hand tool active, and the
static scene hash changed after the pan.

The recording observed 24 canvases, 75 active windows, and 34 draw episodes.
It measured 144 raster operations and 3.3 ms of Canvas2D API self-time. The
command statuses were 3 `same`, 28 `changed`, and 44 `unknown`.

The recording saved 59 browser entries and 29 episode associations. Chrome
provided Event Timing and long animation frame entries. The recording dropped
no entries.

The 44 `unknown` windows had explicit reasons. They were 4 `first-window`, 20
`canvas-source-reset`, and 20 `canvas-reset` results. These results do not imply
zero work or unchanged pixels.

## Product finding

The completed recording showed 22 review candidates. Twenty candidates were
`resize-churn`; two candidates were `repeated-draw-work` on `StaticCanvas`.

Each resize candidate had the same shape:

- The canvas was unattributed.
- The canvas had one active window.
- The canvas sent one raster operation.
- The canvas had two reset events.
- The canvas retired during the recording.

The least-specific explanation is that Excalidraw created a short-lived
canvas, set its width and height, and drew once. The current finding rule
counts the two setup resets as repeated reset work.

The evidence does not establish the purpose of each short-lived canvas. It
does not show that these canvases made Excalidraw slow. It also does not show
that Excalidraw can remove their setup resets.

This result is a product signal problem. The 20 one-shot setup candidates hide
the two repeated-command candidates and make the result hard to review.

## Next check

Add a nearest-negative case that creates a canvas, sets its width and height
once, draws once, and retires it. That case must not produce `resize-churn`.

Keep the positive case separate. A live canvas that resets across multiple
active windows must still produce the candidate.

## Verdict

The published package works in current Excalidraw and completes the v0.4
recording ritual. External dogfood found one reproducible candidate-quality
defect. Fix that defect before work starts on deeper v0.5 explanations.
