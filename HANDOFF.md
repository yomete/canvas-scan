# canvas-scan — session handoff (2026-07-26)

Handoff from a research session in the polarsignals repo. A fresh agent in this
folder can continue from this document alone.

Rev 2 (same day): amended after an external second-opinion review (GPT 5.6).
Measurement claims are relabeled to what the mechanism actually measures,
Tier 2's commit-timestamp error is corrected, attribution gains confidence
levels, and later phases are re-sequenced M0–M4.

## What this is

**canvas-scan** (working name) — an open-source, drop-in dev tool for
canvas-heavy React apps, in the style of aidenybai/react-scan and
aidenybai/react-grab. One early import, no component instrumentation. It
shows, for every observable main-thread Canvas2D canvas in the current realm:
the nearest React owner (with an explicit attribution confidence level),
draw-batch counts, canvas API self-time, and — the headline feature —
surfaces draw batches that repeat the previous captured window's command
signature, as candidates for investigation, using react-scan's red-outline
visual grammar. It never claims pixel identity, wasted work, repaint cost, or
commit causality — the wrapping mechanism can't measure those (details below).

**This is Yomi's personal project, NOT a Polar Signals project.** Personal
GitHub repo, personal npm scope. Do not wire it into the polarsignals codebase
or suggest shipping it under the company org.

Why it's viable: research confirmed nobody occupies this niche. Spector.js is
WebGL-only with zero React awareness; why-did-you-render and
react-render-tracker stop at the React render boundary; react-scan goes blind
at `<canvas>`. The audience (charting, editors, maps, react-konva/pixi users)
overlaps exactly with react-scan's adopters.

## Decisions locked (don't re-litigate)

- Personal project, open source, MIT.
- MVP is **Canvas2D only**. WebGL is a later phase (Spector.js partially covers it).
- Attribution ships as **two tiers of different strength** (see below) — the
  strong tier (owner + confidence level) is the core UX; commit-correlation is
  a clearly-labeled hint and lands **after M0**.
- Overlay follows react-scan's visual grammar (outlines on the offending
  canvases + small HUD), not a devtools panel.
- Build the minimal thing first: tracer bullet before any overlay work.
- (Rev 2) Honest labels only: the tool reports `signatureStatus: same |
  changed | unknown`, `canvasApiSelfTimeMs`, and `rasterOperationCount` —
  never "pixel-identical", "wasted", "repaint cost", or "msPerFrame".
- (Rev 2) M0 scope: Chrome, Vite + React 19 dev build, main-thread Canvas2D.
  Workers, OffscreenCanvas transfers, and cross-origin frames are marked
  `unobservable`, never reported as zero-cost.
- (Rev 2) The M3 overlay is a simple original one (positioned elements or one
  plain overlay canvas). react-scan's worker/SAB pipeline is overkill for a
  handful of canvases, and SharedArrayBuffer requires cross-origin isolation.
  Retain MIT notices for anything that does get lifted.

## Research findings (condensed)

Full agent reports: `research/2026-07-26-dropin-tool-research.json`
(four structured reports: react-scan internals, react-grab internals,
canvas-instrumentation prior art, and an audit of the polarsignals viz code —
that last one is context only, not part of this project).

Caveat (verified in Rev 2): the research JSON's `detecting_redundant_redraws`
field is literally empty — the signature-comparison design below is
synthesized from adjacent findings, not backed by surveyed prior art. Treat it
as a hypothesis to validate in M0/M1, not a proven technique.

### How the drop-in trick works

Install a fake `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` **before React loads**.
React's reconciler unconditionally calls `hook.inject(renderer)` on startup and
`hook.onCommitFiberRoot(rendererID, root)` on every commit — the same contract
the DevTools extension uses, requiring zero app cooperation. The **bippy**
library (MIT, aidenybai, published to be depended on — bippy.dev) does this as
a module-load side effect and coexists with the real DevTools extension via a
`hasOwnProperty` patch. Load order is critical: if React initializes first and
finds no hook, some code paths never wire commit callbacks. Hence the install
story: script tag "before any scripts" / first import in the entry module /
Next.js `<Script strategy="beforeInteractive">` or `instrumentation-client.ts`.

### What bippy gives you for free (do not reimplement)

`instrument()`, `traverseRenderedFibers` (Suspense-aware mount/update/unmount
walk ported from DevTools' backend), `traverseProps/State/Contexts` diffing,
`didFiberCommit` / `getMutatedHostFibers` (fiber flags bitmask reads),
`getTimings` (`fiber.actualDuration`), `getFiberId` (WeakMap identity),
`getDisplayName`, **`getFiberFromHostInstance`** (DOM node → fiber),
`getOwnerStack` + `symbolicateStack` (component → source file/line via
sourcemap fetch). Claims React 17–19 support — verified 2026-07-26 against
the npm registry: latest is 0.6.1 with peerDeps `react >= 17.0.1` (the
earlier "16.8+" note in Rev 1 was wrong). Pin the exact tested bippy version
during M0 (0.6.1 is the natural pin — react-scan itself depends on `^0.6.1`);
broader compatibility and react-scan coexistence validation stay in M1.
There's a ~90-byte `bippy/install-hook-only` export if bundle size matters.

### Proportions to expect (from react-scan's own source)

Essential core ≈ 1,500–2,000 LOC; UI/tooling polish is 4–5× that by volume.
The genuinely-hard React-internals code is a few hundred lines and mostly
lives in bippy. Two surprises worth remembering:
- react-scan's unnecessary-render detection is currently **hardcoded off** on
  main (`TRACK_UNNECESSARY_RENDERS = false`, "FIXME: calculation is slow") —
  its heuristic is shallow (SameValueZero + a "same shape, different
  reference" fast-serializer). Don't assume it's a solved reference.
- react-grab never extracts props/state — it's DOM attributes + source
  location only. Both tools are thin UI layers over bippy.

### Liftable pieces (all MIT)

- react-scan `new-outlines/`: OffscreenCanvas + Worker + SharedArrayBuffer
  outline renderer (lerp/fade, rect merging, label collision) — zero
  React-specific logic, portable wholesale.
- react-scan `getBatchedRectMap`: IntersectionObserver-based batched rect
  resolution, no forced layout, skips off-screen elements.
- react-grab `mount-root.ts` pattern: `position:fixed` pointer-events:none
  host + open Shadow DOM + re-append-on-timeout to survive hydration and
  z-index wars.
- react-grab's overlay is Solid, react-scan's is Preact — both deliberately
  NOT React, to avoid instrumenting themselves. Follow that.

### The canvas layer (the novel part — this is the actual product)

1. Patch `HTMLCanvasElement.prototype.getContext` early so every 2D context
   comes out wrapped. Prefer prototype method/descriptor wrappers with
   per-context `WeakMap` state over a Proxy; if a Proxy is used anyway, cache
   exactly one per raw context — repeated `getContext("2d")` must return the
   same observable object, and context identity, native properties,
   receivers, `instanceof`, and exceptions must all survive. API transparency
   gets its own acceptance suite in M1.
2. Frame windowing: counters accumulate continuously; the tool's **own** rAF
   tick snapshots-and-resets them once per animation-frame window. Never
   reset inside app callbacks — multiple app rAF callbacks share one frame
   (same timestamp), and draws also arrive from layout/passive effects, event
   handlers, timers, ResizeObserver, and video-frame callbacks. Record the
   scheduler origin per draw batch, and `comparisonGap` when sampling.
3. Signature comparison — NOT pixel identity: capture the command stream
   (method + args) per canvas per window, hash it cheaply (quantize floats;
   don't deep-hash image/pixel args), compare to the **previous captured
   animation-frame window** — not "previous frame"; `comparisonGap` records
   the distance, and equals 1 only at `captureEvery: 1`. Report
   `signatureStatus: same | changed | unknown`. Emitting `unknown` is
   mandatory whenever the window contains inputs the hash cannot prove
   stable: video or source-canvas arguments, opaque pixel buffers
   (ImageData/ImageBitmap), or persistent context state the tool doesn't
   model — those must never surface as `same`. Identical commands can paint
   different pixels, and identical pixels can still be non-wasted (state
   setup for later draws) — hence the label discipline. **Sample** full
   capture 1 frame in N — naive per-call capture at thousands of calls/frame
   becomes the bottleneck itself.
4. Optional opt-in audit mode (post-M0): pixel readback reporting
   `visuallyUnchanged`, benchmarked separately, returning `unavailable` on
   tainted canvases. Keep it — and source lookup — off the hot path.

### Attribution — the two-tier framing (key design insight)

- **Tier 1, strong: "nearest React owner is component X" — with a confidence
  level.** The wrapped context knows its canvas element;
  `getFiberFromHostInstance(canvas)` maps it to a fiber → `getDisplayName` +
  `getOwnerStack`/`symbolicateStack` → name + source location. But an exact
  host fiber exists only when React rendered the `<canvas>` itself; libraries
  that append their own canvas (react-konva, pixi — the core audience)
  resolve to a React-managed ancestor at best. Walk from the resolved host
  fiber to the nearest composite component and emit `attributionKind:
  direct-host | jsx-owner | container-only | unattributed`. `sourceLocation`
  is nullable and best-effort — not an M0 gate. Ship this as the core UX.
- **Tier 2, heuristic: "this draw batch is temporally associated with that
  commit". Post-M0.** Correction (Rev 2): `onCommitFiberRoot` receives
  `(rendererID, root, priorityLevel)` — there is NO commitTime field; a
  `performance.now()` inside the hook is observer time only. Layout-effect
  draws fire *before* the hook, passive-effect draws after, so a window must
  span both sides. React's real `commitTime` comes from `<Profiler>`, which
  requires app wrapping and breaks drop-in. Also breaks when a library-owned
  rAF loop draws independently of React (a commit that merely *started* a
  loop is not the cause of every subsequent frame). Label as "temporally
  associated" — never causal — and test layout-effect, passive-effect, and
  independent-rAF cases explicitly.
- Optional tiny opt-in API for ground truth (component reports its own
  identity around a draw), for people who want zero ambiguity.

### Pitfalls to design around (from prior-art research)

- **StrictMode double-invocation** in dev double-fires draws per logical
  commit — a naive redundancy detector systematically over-counts. v1
  decision (Rev 2): record the physical draws as they happen, no dedup;
  document the StrictMode interaction; validate against a
  production-profiling build.
- **OffscreenCanvas + Worker escapes main-thread patches entirely**
  (`transferControlToOffscreen` → the worker has its own unpatched context
  classes). v1: detect the transfer, mark that canvas "unobservable", document.
  Later: an importable worker-side shim.
- **GPU async**: wrapped-method timing measures synchronous API-call time —
  enqueue cost, not raster/composite/present cost. This applies to Canvas2D
  too (Chrome GPU-accelerates it), not just WebGL — hence the metric names
  `canvasApiSelfTimeMs` / `rasterOperationCount`, never "repaint cost". GPU
  truth arrives in the WebGL phase (EXT_disjoint_timer_query, check the
  DISJOINT flag).
- **Observer overhead skews the measurement**: per-frame batch counters, not
  per-call stack captures; sampled command capture.
- **Production React**: `fiber.actualDuration` and displayNames need dev or
  profiling builds; follow react-scan (no-op in prod unless dangerously forced).

## First milestone — M0 tracer bullet

**Status: DONE (2026-07-26).** Built via plan-build-judge (Codex coder, Claude
judge). All four verification commands pass (typecheck, 20/20 vitest, demo
build) and the contract was verified live in Chrome, including
`signatureStatus: "same"` on the forced identical redraw. Not yet committed.

> Done = in Chrome, on a Vite + React 19 dev fixture with two main-thread
> Canvas2D canvases (one drawing on a rAF loop, one drawing from an effect on
> prop change), one early import running at `captureEvery: 1` logs per-canvas
> draw batches as
> `{canvasId, nearestReactOwner, attributionKind, sourceLocation | null,
> rasterOperationCount, canvasApiSelfTimeMs, signatureStatus, unknownReason,
> sampled, comparisonGap}` (unknownReason joined the contract in M2 slice 1),
> and a forced identical redraw reports
> `signatureStatus: "same"`. Named API smoke checks pass: repeated
> `getContext("2d")` returns the identical object, `.canvas` resolves, one
> property setter round-trips, a basic draw produces output, and no
> instrumentation error escapes to the app (comprehensive transparency is
> M1). No pixel-identity, waste, repaint-cost, or commit-causality claim
> anywhere in the output.

That proves the full chain (hook install → getContext patch → frame windowing
→ signature hash → fiber attribution) before any overlay/UI work. The two
fixture canvases deliberately cover both scheduler origins (rAF and effect).
The full acceptance suite is M1, not M0 — the tracer bullet stays minimal.
Repo shape: pnpm monorepo like react-scan (`packages/core`, later
`packages/cli`, `apps/demo`). The demo app with a deliberately wasteful chart
is both the test bed and the launch asset.

## Dogfood findings (2026-07-26) — read before starting M2

Full report: `packages/dogfood/FINDINGS.md` (raw data in
`packages/dogfood/results/`). Harness: `packages/dogfood/collect.mjs` runs any
instrumented app in headless Chrome (hidden preview tabs pause rAF — headless
does not) and aggregates per-window status distributions. The IIFE bundle
(`pnpm --filter canvas-scan exec esbuild src/auto.ts --bundle --format=iife
--outfile=dist/canvas-scan.iife.js`) makes any third-party app instrumentable
via one script tag.

- Hypothesis PARTIALLY validated: konva-style apps report honest
  `same`/`changed` (zero false `same` at 60fps), and the tool surfaced a real
  candidate — konva redraws hit canvases command-identically during drags.
- **chart.js was 100% `unknown`: it draws through `Path2D` objects, which our
  rules poisoned. RESOLVED in M2 slice 1 (same day): Path2D + CanvasGradient
  construction capture shipped** (`build-registry.ts` + `wrap-path2d.ts`:
  wrap constructor + path methods, hash the build stream, treat the object as
  an identity + build-hash token; untracked/mutated objects still poison).
  Re-run: chart.js went from 311/311 unknown to 367 windows / 0 unknown, with
  33 `same` windows surfacing exactly the rerender-same-data redundancy
  scenario. CanvasPattern deliberately stays poison.
- Reports now carry `unknownReason` (e.g. 'HTMLVideoElement', 'Path2D:dirty',
  'canvas-resize', 'first-window') — shipped with the same slice.
- Attribution walk should skip library-internal wrappers (react-konva's
  `StageWrap` reported instead of the user's component) — add a filter list
  like react-scan/react-grab ship.
- react-scan coexistence verified live (shared hook, zero errors). StrictMode
  produces no false-`same` storm.
- Excalidraw run deferred until Path2D capture lands.

## Later phases / launch checklist

- **M1 — correctness/overhead hardening** (the acceptance suite lives here):
  API transparency tests (context identity, native properties, receivers,
  exceptions); early/duplicate/late install determinism; direct-React,
  imperative, and non-React canvas fixtures; controls for translucent draws,
  mutable image/video sources, resize/reset, taint, and changed arguments;
  overhead benchmarks at 100 / 1,000 / 10,000 ops (budget: <1ms p95 added
  work, <10% median slowdown in count-only mode); pin the exact tested bippy
  version and verify coexistence with react-scan.
  **Status 2026-07-26: largely done — 46 tests across 7 files.** Transparency
  + install-order determinism (early/duplicate/late); jsdom fixtures covering
  all four attributionKinds (a parent-DOM walk was ADDED to attribution.ts —
  bippy alone returns null for imperatively appended canvases, so
  container-only was dead code until this); translucency / image-src /
  changed-arg / mutable-source controls; canvas resize now poisons the window
  to `unknown` (width/height setters wrapped — resize resets context state
  the hash can't model). Measured overhead ~0.23–0.32µs per captured op: a
  1,000-op frame adds ~0.23ms median (inside budget); a 10,000-op frame adds
  ~3.2ms (over budget, acceptable — that IS the pathology the tool flags; a
  true count-only mode that skips capture during uncaptured sampling windows
  is a future optimization). bippy pinned exactly 0.6.1. Remaining M1 items:
  react-scan coexistence check (needs a visible browser session), StrictMode
  demo fixture, taint controls (blocked on the post-M0 audit mode).
- **M2 — console/API OSS alpha.**
- **M3 — simple original overlay + minimal HUD** (react-scan's visual
  grammar, not its worker/SAB pipeline — see Decisions locked).
- **M4 — installer + framework expansion**: `npx canvas-scan init` CLI
  (framework detection — copy react-scan's); React 18 and Next 15.3+ after
  fixtures pass (`instrumentation-client.ts` is the preferred early-load
  path); demo site, README GIF, install docs per framework. Budget as much
  time for this polish as for the core — it's what makes these tools land.
- WebGL phase. Then maybe commit-correlation (Tier 2) improvements.
- Launch case study: dogfood on the Polar Signals profiler page (canvas
  flamegraph; a June 2026 perf hunt there found a 31ms redraw and shipped a
  −48% fix — "canvas-scan would have found this" is the launch-post hook).
  Needs explicit Polar Signals permission for the launch post, plus a real
  replay showing the tool actually surfaces that issue. The dogfooding
  happens in the polarsignals checkout, not this repo.
- Maintenance reality: rides undocumented React internals; bippy's own docs
  call the approach "inherently fragile". Expect breakage across React majors.

## Suggested skills

- `vercel-react-best-practices` — when writing the demo app and any React glue.
- `technical-writing` — README, install docs, site copy.
- `prototype` — if exploring overlay/HUD design variations.
- `tdd` — the hash/attribution logic is pure-function-heavy and suits test-first.
- `web-design-guidelines` — before calling the overlay/HUD or demo site done.

## Context that does NOT carry over

- This folder is not yet a git repo and has no tooling. First session: `git
  init`, scaffold the pnpm monorepo, then the tracer bullet.
- Yomi's global CLAUDE.md auto-loads (commit/push only with explicit approval
  in the current turn; minimal-first working style; lead with the outcome).
- The polarsignals repo's conventions/memory do not apply here.
