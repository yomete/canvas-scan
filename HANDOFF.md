# canvas-scan — session handoff (2026-07-26)

Handoff from a research session in the polarsignals repo. A fresh agent in this
folder can continue from this document alone.

Rev 2 (same day): amended after an external second-opinion review (GPT 5.6).
Measurement claims are relabeled to what the mechanism actually measures,
Tier 2's commit-timestamp error is corrected, attribution gains confidence
levels, and later phases are re-sequenced M0–M4.

Rev 3 (2026-07-27): M0–M4 slice 1 are all built and verified (statuses
inline below); repo lives at github.com/yomete/canvas-scan (private, 7
commits, CI added but failing — fix is hardening batch 1). Two dogfood runs
(konva/chart.js workbench + Excalidraw) validated and sharpened the design.
A cross-review with Codex found two P0 classifier-trust defects — see
"Hardening queue" below; 0.1.0 does not publish until it clears.

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
`signatureStatus: "same"` on the forced identical redraw. Committed as
`e1386e3` (the repo's root commit).

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
- Attribution wrapper-skip: RESOLVED 2026-07-27. The owner walk skips a
  deny-list (`StageWrap`, `Stage`; extensible via `start({ skipOwners })`)
  plus 1–2-char names (minified library internals), falling back to the
  nearest named composite, never null. konva canvases now attribute to the
  user's component (verified: `KonvaSection` in the re-run).
- react-scan coexistence verified live (shared hook, zero errors). StrictMode
  produces no false-`same` storm.
- Excalidraw run DONE 2026-07-27 (separate session; see the Excalidraw
  section of `packages/dogfood/FINDINGS.md`). Attribution produced real
  component names with zero configuration, idle is genuinely silent, and
  the honesty rule worked — which is the problem: the main scene canvas is
  15/17 windows `unknown` (`drawImage(HTMLCanvasElement)`) because
  Excalidraw composites per-element cache canvases. Cache compositing is a
  pattern also used by konva cached shapes and pixi render textures (an
  observed pattern, one dogfood run — not a category claim), so **tracked-canvas
  source tokens (identity + content-version, version bumped per draw batch
  and on resize) are the gating M2 slice 2** — the Path2D fix generalized.
  Untracked/worker/video sources still poison; CanvasPattern stays poison.

## Hardening queue (agreed in the 2026-07-27 cross-review with Codex)

**REOPENED (post-batch-4 Codex review — see CODEX_REVIEW.md "implementation
progress review" + Fable response): batches 3 and 4 are NOT
classifier-trust complete.** Process rule adopted: correctness batches
close only when the review's adversarial cases pass, not on happy-path
tests + dogfood baseline. Remediation batch 3R/4R (before batch 6):

- P0 same-frame token staleness → dirty-marker tokens (`vN+dirty` while
  the source window is unfinalized with raster activity).
- P0 path-hash framing → shared framed-token encoder (same defect as
  batch 2, reintroduced in the batch 3 plan; helper makes a third
  occurrence impossible).
- P0 skipped `setLineDash` / `closePath` → persistent line-dash prop +
  closePath in the framed path-op set, captureEvery:2 tests.
- High save/restore props → undo-log per stack frame (not Map copies —
  konva saves per shape); fakes gain real save/restore.
- High mid-window gradient mutation → dependent tracking, poison
  dependents' current window ('gradient-mutated').
- High token identity (internal serial, never DOM id), ctx.reset() bumps
  content version, untracked clip → persistent uncertainty.
- Evidence: collect.mjs marker/timeline mode; per-batch workbench
  artifacts; bench provenance (git SHA, bundle hash, thresholds) + fully
  self-contained bench command (build → copy → serve → run → teardown).

**CODEX_STATUS: APPROVED (2026-07-28, scoped to the classifier-trust
fixes)** — see CODEX_REVIEW.md "Codex re-audit — post patch 3". The
cross-review loop now runs on the CLAUDE.md status protocol. Approval
caveats recorded there: the remediation fake is a no-op (real Web IDL
conversion is covered by the browser probe, not the unit fake — Fable's
"conversion-modeling" wording was wrong); probes.mjs covers the
transparency delta, not rendered equivalence; non-default Array iteration
is a Firefox/Safari portability item for the WebGL/browser-expansion
phase. **3R/4R LANDED 2026-07-28: commit `c6b2db7`, remote CI run
30311999536 GREEN — the agreed closure condition is met; the log ends
FABLE_STATUS: READY_FOR_CODEX for Codex's formal closure round.** Batch 6
carries the release/evidence gates.

**3R/4R follow-up patch 3 DONE 2026-07-28** (Codex "final acceptance
audit"): getLineDash snapshots via the install-time-captured PROTOTYPE
method (instance shadows never invoked); sparse-array holes promote
persistent `pathUnknown` (Web IDL reads inherited indices, the model
can't); `mixValue` array traversal is descriptor-based, making the
captured stream side-effect-free too (no accessor/iterator invocation
anywhere in hashing). Real-browser transparency probes added:
`packages/dogfood/probes.mjs` (instrumented vs uninstrumented invocation
counts — PASS). 156 tests. 3R/4R still closes only on commit + green CI.

**3R/4R follow-up patch 2 DONE 2026-07-27** (CODEX_REVIEW.md "post-3R/4R
patch" review + "patch report 2"): `setLineDash` snapshots native state via
`getLineDash()` (one-shot iterables — a generator re-reads as [], proven by
Codex's Chrome probe); all object path inputs modeled via property
descriptors only (accessors never invoked → no observable extra reads;
accessor-bearing inputs promote persistent `pathUnknown`); the
"startup-only unknowns" prose claim was retracted as exceeding the
artifact (timing claims await the batch 6 marker collector). 151 tests.
**3R/4R closes only after commit + green remote CI (agreed closeout).**

**3R/4R follow-up patch DONE 2026-07-27** (Codex's second-pass findings —
see CODEX_REVIEW.md "follow-up review" + "patch report"): array-valued
path args value-encoded with persistent `pathUnknown` (non-number
primitives stay classifiable via type-tagged encoding — coercion is
deterministic); tracked-Path2D clips mix the clip-time CTM and promote
unknown builds to `clipUnknown`; failed native calls no longer mutate the
model (all updates post-success; native errors never masked). 148 tests.
Batch 5 is feature-complete but NOT release-gate-complete: bench
self-containment + fail-closed loading assertion + provenance are batch 6
items.

**3R/4R core fixes DONE 2026-07-27** (adversarial acceptance contract:
`test/remediation.test.ts`, 14 cases — 143 tests total): dirty-marker
content tokens (`vN+dirty` mid-window; provably-`same` sources keep their
version), shared framed-token encoder (`fnvStep`/`mixTokenInto`/
`mixNumberTokenInto` exported from signature.ts — path/clip hashing now
framed), `setLineDash` persisted as `__lineDash` prop + `closePath` in the
path-op set, save/restore props via per-frame undo logs (O(mutations),
fakes gained real save/restore), gradient-dependent tracking poisons
mid-window mutation ('gradient-mutated'), serial-based token identity,
`ctx.reset()` bumps content version, untracked clip → persistent
'clip-unmodeled'. Dogfood artifacts persisted:
`results/2026-07-27-workbench-after-3r4r.json` (baseline exact) and
`results/2026-07-27-excalidraw-after-3r4r.json` (StaticCanvas 5/12/0 —
consistent with post-token baseline). STILL OPEN from the evidence list:
collect.mjs marker mode; bench self-containment + provenance — fold into
batch 6.

Codex's progress review found two P0 classifier-trust defects; the full
exchange (findings, my verified responses, the sampling-contract decision)
is in Yomi's Codex outputs dir, `canvas-scan-progress-review-2026-07-27.md`.
0.1.0 does NOT publish until batches 1–6 land. Order:

1. CI fix (drop the pnpm `version:` input — it fights the packageManager
   pin) + claim-discipline copy sweep ("wasted"/"identical redraw" violate
   Rev 2 labels; use "same signature ×N" / "review candidate") + a copy
   regression test. Copy only — no behavioral changes in this batch.
   **DONE 2026-07-27**: pnpm version input dropped; overlay/README/package
   description now use "same signature ×N" / "review candidates";
   `test/claim-discipline.test.ts` guards user-facing copy (disclaimer
   negations allowed); GIF + screenshot regenerated with the new copy;
   82 tests. (Also unblocked: node_modules relinked from the global pnpm
   store — a Codex-sandbox run had left it pointing at a deleted repo-local
   store, breaking `pnpm add`.)
2. P0: signature framing — the hash concatenates unframed chars, so
   `fillRect(1, 23, …)` vs `fillRect(12, 3, …)` collide deterministically.
   Type-tagged, length-framed tokens + op boundaries + adversarial tests.
   **DONE 2026-07-27**: every token is now `tag + length + ':' + body`
   (uniquely decodable stream); ops carry method + arity frames, setters a
   distinct tag, arrays a length header, build tokens/images their own
   tags. 14 adversarial tests (boundaries, type confusion, method/arg
   bleed, arity shifts, setter/op confusion, build-token spoofing);
   quantization semantics unchanged. Workbench dogfood re-run matches the
   pre-framing baseline exactly — no classification drift. 96 tests.
3. P0: persistent context state — complete the setter list (`filter`,
   `lineDashOffset`, `direction`, spacing/kerning), per-window effective-
   state fingerprint, save/restore + transform + clip + cross-window path
   modeled or conservatively poisoned, post-assignment gradient mutation
   poisons. Sampling follows "Contract 1": skip full serialization on
   uncaptured windows, keep lightweight persistent-state AND
   source-mutation tracking always on, poison only on unmodeled
   intervening mutation, and hash the effective state at the head of each
   captured command stream. Five agreed sampling tests: (a) continuous
   identical draws at `captureEvery: 2` can reach `same`; (b) an idle
   skipped window does not poison; (c) a setter change in a skipped window
   never yields a stale `same`; (d) path/clip/gradient/source mutation in
   a skipped window never yields a stale `same`; (e) after an `unknown`
   establishes a new baseline, the next comparable window recovers to
   `same`/`changed`.
   **DONE 2026-07-27, with a design lesson.** First attempt used carried
   dirty-flags + lazy poisons; the workbench gate caught it cold — konva
   applies a permanent baseline `scale()` at canvas init, so every konva
   window poisoned to `carried-transform` (the dogfood regression gate
   exists for exactly this). Revision MODELS the three carried channels
   instead: the real 2D matrix (numeric composition, save/restore-stacked),
   a rolling current-path hash (mixes the CTM — path points transform at
   build time), and a clip hash. All three feed the head-of-window
   fingerprint as synthetic entries; stable baselines fingerprint
   identically, real drift reads as honest `changed`. The one remaining
   poison: object-form `setTransform(DOMMatrix)` → 'transform-unmodeled'.
   Setter list completed; head fingerprint + always-on props/state
   tracking; Contract 1 sampling with all five tests. Workbench re-run:
   konva baseline restored exactly (9/12 hit-canvas same, zero carried
   unknowns), chart.js unchanged. 117 tests.
4. Tracked-canvas source tokens (above) + Excalidraw re-run with action
   markers; konva workbench results must not regress.
   **DONE 2026-07-27.** Instrumented canvases register in the build
   registry as (canvasId + contentVersion) tokens; the version bumps at
   window finalize unless the window provably hashed `same` (so a
   cache canvas redrawn identically keeps consumers at `same`), on
   resize, and conservatively for uncaptured raster activity. Untracked
   canvases / OffscreenCanvas / video still poison; CanvasPattern stays
   poison. Excalidraw re-run: StaticCanvas 15/17 `unknown` → 3 same /
   14 changed / 0 unknown (zero HTMLCanvasElement poisons repo-wide;
   the 3 `same` are real cache-recomposite candidates). Workbench gate:
   exact baseline. 125 tests. Results:
   `packages/dogfood/results/2026-07-27-excalidraw-after-tokens.json`.
5. Count-only capture path + Chrome benchmark as a required release command
   (persists samples + browser/hardware metadata + pass/fail, where
   pass/fail ASSERTS the documented budgets: <1ms p95 added work and <10%
   median slowdown in count-only mode — the budgets bind to this command,
   not to CI); the Node overhead test stays a generous tripwire. Overlay
   `same` flashes weighted by rasterOperationCount land here (behavioral
   tuning, kept out of batch 1 by agreement).
   **DONE 2026-07-27, budgets revised by cross-review (see
   CODEX_REVIEW.md "Budget-revision round").** The original <10% slowdown
   budget proved structurally impossible (enqueue-only denominator ⇒
   ~8ns/call). Agreed absolute gates, median across five order-rotated
   blocks at 1,000 iterations: full added mean <2ms ✓ (~1.54), full added
   p95 <3ms (STRADDLES the limit run-to-run — met without margin;
   capture-path allocation optimization is the follow-up before 0.1.0),
   count-only added mean <0.75ms ✓ (~0.38), count-only added p95 <2ms ✓
   (~1.0). Run it: `pnpm --filter dogfood run bench:chrome` against the
   workbench server (serves bench.html); results persist uniquely-stamped
   with browser/hardware metadata + an isolated empty-wrapper floor
   (~0.02ms — wrapper indirection is free; capture work is the cost).
   Count-only windows no longer pay performance.now() (selfTime is
   discarded there anyway). Overlay flashes now require
   rasterOperationCount >= 2 (configurable: `minFlashRasterOps`);
   script-tag config via `window.__CANVAS_SCAN_OPTS`. 129 tests.
6. Release hardening: prepack build, pack-from-clean CI, tarball install
   into clean Vite + Next 15.3 fixtures, CLI prints the required install
   command, Next path version-gated to >= 15.3.
   **DONE 2026-07-28 (local; landing pending)** — see CODEX_REVIEW.md
   "Fable batch 6 report". All release/evidence gates implemented:
   prepack + LICENSE + scripts/verify-pack.mjs (all three fixtures PASS —
   and it caught a real shipped-CLI bug: the bin's main guard failed
   under symlinked paths and exited 0 doing nothing; fixed via realpath);
   CLI install-command + Next>=15.3 gate; marker/timeline collector;
   self-contained fail-closed bench with full provenance (first run
   honestly FAILED — 3R/4R always-on trackers doubled count-only cost;
   fixed by matrix-hash caching + integer path tokens: count-only
   0.194ms of 0.75 budget, full p95 2.2 of 3 — the batch-5 straddle now
   has margin). Canonical performance contract consolidated across
   README/package/HANDOFF (the M1 budget text above is superseded by
   these gates). 163 tests. Log ends FABLE_STATUS: READY_FOR_CODEX.
7. 0.1.0 publish — additionally gated on Yomi confirming the npm account
   (personal, not work).

**QUEUE COMPLETE (2026-07-28): batches 1–6 all landed, CI-verified, and
closed with CODEX_STATUS: APPROVED** (batch 6 took four review rounds:
5 → 2 → 1 → 0 findings — alias-safe path folds, unmodeled-transform
promotion, deterministic prepack with strict required-manifest assertion,
a Next gate that rejects compound/prerelease/malformed/stacked specs, and
HTTP boot proofs for both packed fixtures; the Node tripwire moved to
5µs/op after flaking at 2.02 on a shared runner — binding budgets stay in
the Chrome release command, which passes with margin). **0.1.0 SHIPPED 2026-07-28**: published to npm as `canvas-scan@0.1.0`
from the personal account `yomi` (whoami verified; the published tarball
passes the strict manifest rules). Tagged `v0.1.0`. Next frontier, per
"Later phases": launch polish (demo site, the Polar Signals case-study
conversation — Yomi's to have), overlay v2 (Yomi has ideas queued), then
the WebGL phase and React 18/Firefox/Safari expansion.

## Overlay v2 — agreed direction (2026-07-28, Yomi's call)

**Tiers 1+2 BUILT and SHIPPED in 0.2.0. Review status is NOT approved —
see the correction below.** The Codex round found three real findings
(inspect-mode stacking could let outlines cover the toolbar; the 250ms
refresh rebuilt DOM unconditionally, dropping focus, with O(n) listeners;
copy/count semantics + a fail-open screenshot script). All remediated:
z-layered dock, one rAF dirty-gated commit for ALL DOM writes with
delegated O(1) listeners, canvas-level candidate counts consistent with
the flash threshold, api-labelled timing copy, fail-closed v2-shots.mjs
acceptance, and hover labels on inspect outlines. Log ends
CODEX_STATUS: APPROVED. Toolbar pill (inspect toggle / accent-lit candidate count /
collapse-to-dot, draggable), sorted flyout rows (kind badge, same-rate,
unknownReason when unknown-dominant, mean self-time), opt-in inspect mode
(faint dashed outlines become clickable; Esc exits), pinned popover with
history aggregates + copy-json + **on-demand sourceLocation via bippy
symbolication — verified resolving App.tsx:3 through Vite sourcemaps in
real Chrome** (src/symbolicate.ts; cached per canvas; only runs on popover
open). History ring in frame-loop (120 reports/canvas,
`__CANVAS_SCAN__.getHistory`). Workbench gate at baseline. v2c (activity
strips, theming, position persistence) still open. GIF/README refresh
pending commit.

**react-scan's minimal toolbar idiom, NOT a devtools drawer.** The HUD pill
becomes a draggable toolbar (status dot, canvas/candidate counts, inspect
toggle, collapse); everything else is compact flyouts. Inspect is an
opt-in MODE: outlines stay pointer-events:none normally, become hoverable
only while toggled (never steals app input otherwise); clicking a hovered
canvas pins a small popover with the full report, and that click is the
off-hot-path moment where `sourceLocation` finally resolves (bippy
getOwnerStack + symbolicateStack on demand — the reserved field wakes up).
HUD rows stay clickable as the inspect path for detached canvases (konva
hit canvases, Excalidraw caches — not in the DOM, never hoverable).
Milestone shape: history ring in core (~120 reports/canvas, also
`__CANVAS_SCAN__.getHistory`) → toolbar chrome → enriched rows
(unknownReason, status distribution, self-time-weighted labels,
hover-to-locate, interestingness sort with quiet canvases collapsed) →
inspect mode + symbolication. Deferred to v2c: CSS-gradient activity
strips (no <canvas> in the overlay — self-instrumentation rule), Alt-hover
outside inspect mode, theming. Standing rules: headless screenshots are
overlay acceptance (the M3 flash-CSS lesson); all copy passes the
claim-discipline test; DOM writes batch on a throttled paint pass.

### Review-status correction (2026-07-28) — READ THIS BEFORE TRUSTING THE ABOVE

The `CODEX_STATUS: APPROVED` cited above was **superseded within the same
day** by a full-scope Codex re-audit ("prior overlay approval superseded"),
which is the bottommost section of `CODEX_REVIEW.md` and therefore the
authoritative status: **`CODEX_STATUS: CHANGES_REQUESTED`**. That re-audit
was missed because the copy of the review synced to the external Codex
outputs folder ends at the earlier approval, while the in-repo copy carries
210 further lines. **0.1.0 and 0.2.0 were both released after it.** The repo
copy is canonical; check `grep -n "^CODEX_STATUS" CODEX_REVIEW.md | tail -1`
before claiming any review state.

Status of its findings. All six code findings were verified open against the
shipped tree, then **fixed in the remediation batch below (uncommitted)**;
evidence lives in the Fable response appended to `CODEX_REVIEW.md`.

## Remediation batch (2026-07-28, PBJ: Fable plan → Codex gpt-5.6-sol → Fable judge)

**Done, verified, uncommitted. 207 tests (was 192).**

- **FIXED — public `sourceLocation` now reaches the public API.** Was: popover
  showed `source: App.tsx:3` while `getReports()['raf-chart'].sourceLocation`
  was `null` (1 of 120 history entries carried it). Now: a canonical
  per-canvas store in `frame-loop.ts` (`setSourceLocation`) republishes the
  latest report and seeds every subsequent one. Real Chrome after the fix:
  `latestSource {file: App.tsx, line: 3}`, 85 of 120 history entries carry it.
- **FIXED — a focused flyout row survives reports.** Rows are keyed by
  `canvasId` in `flyoutRows`, updated in place, reordered by re-appending,
  with an explicit focus restore. Real Chrome: `sameNode:true,
  stillFocused:true` (was `false,false`).
- **FIXED — hidden canvases are no longer clickable.** `isVisiblyHitTestable`
  walks ancestors for `visibility:hidden|collapse` and `display:none`. Real
  Chrome: hiding the effect canvas leaves its outline `hidden` with
  `pointer-events:none`.
- **FIXED — source lookup.** `findOwnerFiberForCanvas` in `attribution.ts` is
  now the single owner walk used by both attribution and symbolication, so
  container-only canvases (konva, Excalidraw) resolve. `SourceOutcome`
  distinguishes `found | unavailable | error`; errors are never cached, so a
  transient failure retries. The redundant `symbolicateStack()` pass is gone
  (bippy 0.6.1's `getOwnerStack` symbolicates internally).
- **FIXED — history is immutable, identified, and bounded.** `getHistory` and
  `getReports` return per-report copies; histories key on the record `serial`
  so a reused DOM id starts a fresh lifetime; `MAX_TRACKED_CANVASES = 64` with
  least-recently-reported eviction across all four maps.
- **FIXED — `v2-shots.mjs` hit-tests.** Real Playwright pointer clicks
  (Playwright's CSS engine pierces open shadow roots) on the toolbar and on a
  named canvas outline, asserting `EffectChart` rather than the last outline.
- **FIXED (judge catch, not in the Codex diff)** — the source store was keyed
  by canvas id with no invalidation, so a reused DOM id inherited the retired
  canvas's source location. Lifetime retirement now runs *before* the report
  is built, and eviction clears the source entry too. Regression added and
  confirmed to fail without the fix.
- **FIXED earlier** — `symbolicate.ts` and `v2-shots.mjs` are properly tracked
  with real content (commit `15b8485`), not intent-to-add placeholders.

**Release-track tail, swept in the same batch:**

- **FIXED — the shipped bundles can no longer lie about their version.**
  `assertPackedVersion` in `scripts/pack-manifest.mjs` requires the packed ESM
  chunk and the minified IIFE to carry `version: "<manifest version>"` and the
  packed README to advertise `canvas-scan@<version>`; `verify-pack.mjs` runs it
  against the real tarball, so CI's pack job gates it. A fast unit regression
  also asserts the `src/index.ts` literal matches `package.json`, catching the
  drift before a build bakes it in. Proven fail-closed by planting `9.9.9` in
  `index.ts` and watching the pack step fail.
- **FIXED — `init` no longer calls an import an installation.** An import line
  does not mean the package is installed. When `canvas-scan` is missing from
  `package.json`, `init` now says "the import is already there, but canvas-scan
  is not in package.json yet." and still prints the install command; only a
  genuine dependency gets "canvas-scan is already installed."

Still deferred: `CanvasRecord`s are never retired from the `records` Set in
`wrap-context.ts` (a real leak, separate from history retention).

Verification: **213 tests**; `pnpm -r run typecheck`; `node
scripts/verify-pack.mjs` (package + Vite + Next fixtures);
`node packages/dogfood/v2-shots.mjs` PASS; real-Chrome probe confirming all four
user-visible fixes; mutation checks confirming the new regressions fail without
their fixes. The Chrome perf gate (`bench-chrome.mjs`) has not been re-run — do
that before any release.

### Round 2 (2026-07-28): the remediation batch was itself reviewed, and failed

Codex re-reviewed `e944b8f` + `008f8dc` and returned CHANGES_REQUESTED. **The
most serious finding was a regression introduced by the previous batch's judge
stage.** Moving lifetime retirement ahead of `processRecord` — done to stop a
reused DOM id inheriting a stale source — was wrong because production never
prunes the `records` Set: the retired record kept being iterated and retired its
own successor every tick, wiping the new canvas's history and permanently
nulling its source. Verified with a probe under production conditions (history
length 1 instead of 2, source null forever). The fix was to key the source store
by `record.serial` instead of by DOM id, which makes cross-lifetime leakage
impossible by construction, and to move retirement back inside the reporting
branch.

Also fixed in round 2: `getHistory()[0].sourceLocation.file` could mutate stored
state (shallow copy shared the nested object); a canvas that stopped drawing
before its lookup resolved kept a null history and Copy JSON; a late lookup
could stamp a retired component's file:line onto its successor (fenced on canvas
identity); a focused row was still destroyed when a busier canvas pushed it past
the eighth slot, and `.more` was recreated every report; `pointer-events:none`
canvases kept clickable outlines; every outline was placed twice per commit;
failed and unavailable lookups were cached forever; several reason phrases were
inaccurate; both READMEs still documented `sourceLocation: null // reserved`;
and `init` equated a package.json entry with an installation.

Accepted but NOT fixed, recorded rather than papered over: bippy returns the
generated frame on a transient sourcemap failure, and canvas-scan cannot
distinguish that from a real bundle location, so a degraded `found` can still be
cached. Fixing it needs a signal from bippy or a path heuristic.

**222 tests.** The lesson worth keeping: a fix written during a judge stage is
unreviewed code. Round-tripping it through the reviewer caught what self-review
did not.

### Round 3 (2026-07-28): the ownership rule was wrong twice

Codex refuted round 2. Requiring a record to *report* before it could retire a
lifetime still was not an ownership test, and two P1s survived: an older
duplicate that kept drawing destroyed its successor's history and source, and a
successor that drew during an uncaptured window left the predecessor standing in
indefinitely. Both reproduced with regressions written before the fix.

The rule is now explicit — **the newest lifetime that drew owns the DOM id, and
ownership transfers on activity rather than on capture** — which also closed a
third hole: transfer now drops `latestReports[id]`, since the id belongs to a
lifetime that has not reported yet.

Also fixed: the overlay inherited all id-keyed state across an element swap
(resolved source, counts, candidate flag, stuck `resolving`, queued flashes), so
a new canvas could show the retired component's file:line; the round-2 focus fix
produced nine rows with stale text and a wrong "+N more" (a focused row now
stays *in* the ranked slice, rendered live); `init` treated a bare directory as
an installed package; `hasImport` used regex comment-stripping instead of
matching the import statement.

Declined, with reasons recorded in the review log: full occlusion/clipping hit
testing (needs `elementFromPoint` per canvas per commit, and in inspect mode our
own outline is the topmost element there — `inert` IS now handled), and the
hand-maintained unknown-reason enumeration in the tests, which cannot detect a
newly emitted code. The real fix for the latter is a single exported reason
table shared by engine and overlay — a `signature.ts` refactor, worth doing on
its own rather than inside a batch about lifetimes.

**228 tests.**

### Round 4 → the identity rewrite (2026-07-28, Yomi's call)

Round 4 found two more P1s (eviction erased the ownership high-water mark so an
older record could reclaim an id; non-owner reports let the overlay interleave
two lifetimes and publish one canvas's file:line as another's). At that point
**four consecutive rounds had found a P1 in the previous round's fix, and every
one was the same root cause**: the public `canvasId` was the canvas's DOM `id`
attribute — mutable, reusable, and shared between lifetimes — while `records`
is never pruned. Ownership rules, retirement ordering, high-water marks and
element-swap resets were all scaffolding to make one id safely mean two
canvases.

**The fix was to stop patching and change the identity.** `canvasId` is now
unique per canvas LIFETIME, minted once in `wrap-context.ts` from the existing
`record.serial`: `` `${elementId}#${serial}` `` when the element has an id,
`` `canvas:${serial}` `` otherwise. Every arbitration mechanism was then DELETED
— `historyKeys`, the ownership branch, retirement, the non-owner emit path, the
overlay's element-swap reset, the async lifetime fence. All four core maps key
on `canvasId` again and evict together. Net **−81 lines**.

Verified end to end in real Chrome: remounting a canvas with the same DOM id
produced `effect-chart#3` alongside the retired `effect-chart#2`, each with an
independent history — no merging, no inherited source.

Also in the batch (round-4 findings, independent of identity): the eight-row cap
is held when a focused row is retained (it replaces the lowest-ranked row rather
than becoming a ninth); activating "more" focuses a newly revealed row; the
flyout render cache is invalidated when `showAllRows`/`flyoutOpen` change;
`inert` is detected by attribute as well as property and the walk crosses shadow
boundaries via `getRootNode().host`; `hasImport` strips block comments and
template literals before matching; the overlay prunes per-canvas state the core
has evicted (new `getTrackedCanvasIds`).

**232 tests.** `canvasId` string shape is a visible API change, taken
deliberately while the package is two days old.

## Plain-language copy pass (2026-07-28, Yomi's call)

**Done, verified, uncommitted.** Yomi's question — "is everything here
written in a way that users actually understand?" — audited against a
beginner reading the overlay while their app is slow. It failed: the
claim-discipline work had pushed the copy from intuitive-but-dishonest
("wasted") to precise-but-opaque ("status 0/120/0 of 120 windows",
"raster ops", "comparison gap", raw `unknownReason` codes). Precision
nobody understands is not honesty.

The rule now: **plain words in the primary copy, precision in tooltips,
hedged phrasing so nothing overclaims.** A mapping table in `overlay.ts`
(`UNKNOWN_PHRASES`, `OBJECT_NOUNS`, `describeUnknownReason`) turns every
reason code the engine can emit into a sentence — "a video — its pixels
change every frame" — and keeps the raw code in the element's `title` so
bug reports can still quote it. `same signature ×N` → `sent the same draw
commands again ×N`; windows → frames; `unknown` → `unclear`; raster ops →
draw calls; canvas api self-time → time in canvas calls; sampling
mechanics hide unless sampling is on; empty lines hide instead of leaving
gaps. The flyout carries a one-line explainer ("canvas-scan watches what
your app asks each canvas to draw. When a canvas gets the same
instructions twice, that redraw may be avoidable.") that also lives in the
counts tooltip and both README openings. The demo button "force
same-signature redraw" → "redraw the same thing". Outline labels now
inherit the toolbar's monospace instead of the host page's font.

Guardrail added: `overlay.test.ts` renders the real overlay and asserts
the visible text carries NO internal vocabulary (`/window/`, `/signature/`,
`/raster/`, `/comparison gap/`, `/self-time/`, `/sampled/`, raw reason
codes), plus a table-independent expectation for all 19 reason phrases.
192 tests, typecheck, `verify-pack.mjs` (Vite + Next fixtures), and
`v2-shots.mjs` all pass; `docs/demo.gif` and `docs/overlay.png` re-recorded
against the new copy. Vocabulary bridge documented in both READMEs: a
window is one animation frame; the field names stay the programmatic
vocabulary.

## Later phases / launch checklist

- **M1 — correctness/overhead hardening** (the acceptance suite lives here):
  API transparency tests (context identity, native properties, receivers,
  exceptions); early/duplicate/late install determinism; direct-React,
  imperative, and non-React canvas fixtures; controls for translucent draws,
  mutable image/video sources, resize/reset, taint, and changed arguments;
  overhead benchmarks at 100 / 1,000 / 10,000 ops (budget: <1ms p95 added
  work, <10% median slowdown in count-only mode (superseded — see batch 5
  revised gates)); pin the exact tested bippy
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
  is a future optimization — now formalized as hardening batch 5). bippy
  pinned exactly 0.6.1. react-scan coexistence and the StrictMode fixture
  were both closed by the workbench dogfood run (headless, StrictMode ON,
  react-scan loaded alongside). Remaining M1 item: taint controls (blocked
  on the post-M0 audit mode).
- **M2 — console/API OSS alpha.**
- **M3 — simple original overlay + minimal HUD** (react-scan's visual
  grammar, not its worker/SAB pipeline — see Decisions locked).
  **Status 2026-07-27: slice 1 DONE.** `overlay.ts`: shadow-DOM host
  (fixed, pointer-events:none, survival re-append), red outline flash +
  `"<Owner> · same signature ×N"` label on `same` windows (copy updated in
  hardening batch 1), HUD pill with
  per-canvas stats, `start({ overlay: false })` opt-out. Frame loop gained a
  subscriber API (`subscribeToReports`/`emitReport`, bad listeners ejected).
  Overlay is DOM-only — deliberately no canvas, so it can't instrument
  itself. 74 tests; verified by headless screenshot (the flash CSS had a
  fade-in/fade-out transition conflict only a real render could catch —
  keep screenshot checks in the loop for overlay work).
- **M4 — installer + framework expansion**: `npx canvas-scan init` CLI
  (framework detection — copy react-scan's); React 18 and Next 15.3+ after
  fixtures pass (`instrumentation-client.ts` is the preferred early-load
  path); demo site, README GIF, install docs per framework. Budget as much
  time for this polish as for the core — it's what makes these tools land.
  **Status 2026-07-27: slice 1 DONE.** Packaging: ESM dist with code
  splitting (`.` and `./auto` share one chunk — module state is
  load-bearing) + d.ts + IIFE; dist entry points live in
  `publishConfig.exports`, so publish with `pnpm publish` ONLY. Zero-dep
  `canvas-scan init` CLI (vite/next detection, idempotent `--write`).
  README + demo GIF + CI shipped. Repo: github.com/yomete/canvas-scan
  (private). (Rev 3: stale — `canvas-scan` is claimed and published from the
  personal account `yomi`; 0.1.0 and 0.2.0 are live.) Remaining M4:
  React 18 fixtures, Next fixture validation, demo site, real 0.1.0
  publish.
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

- (Rev 3: stale — kept for history.) ~~This folder is not yet a git repo and
  has no tooling. First session: `git init`, scaffold the pnpm monorepo, then
  the tracer bullet.~~ The repo is scaffolded, tested, and pushed to
  github.com/yomete/canvas-scan; continue from the Hardening queue.
- Yomi's global CLAUDE.md auto-loads (commit/push only with explicit approval
  in the current turn; minimal-first working style; lead with the outcome).
- The polarsignals repo's conventions/memory do not apply here.
