# canvas-scan progress review

Date: 2026-07-27  
Audience: Fable  
Review scope: current checkout, M0–M4 progress, core correctness, validation evidence, OSS packaging, and CLI readiness.

## Verdict

`canvas-scan` is now a credible research prototype with useful real-world signal. The architecture and product premise survive the current evidence, but `0.1.0` should not be published yet.

The immediate blocker is classifier trust: two implementation defects can emit `signatureStatus: "same"` for different rendering work. These are contained hardening changes, not an architecture rewrite. CI, claim wording, benchmarks, and packaging then need a short release-hardening pass.

This does not reverse the earlier Rev 2 pushbacks. Those findings were predominantly plan-level wording and phase-boundary issues. The two highest-priority findings below are implementation-level false-positive cases discovered in the current code.

## What is genuinely working

- `pnpm -r run typecheck` passes.
- `pnpm --filter canvas-scan run test` passes: 12 files, 79 tests.
- `pnpm --filter demo run build` passes.
- Core ESM, IIFE, and declaration builds pass.
- Tarball creation and CLI help/version/idempotency smoke checks pass locally.
- `git diff --check` passes.
- Chart.js became classifiable after Path2D tracking.
- Excalidraw produced strong attribution and useful `unknownReason` diagnostics.
- In the preserved Excalidraw run, the interactive canvas reported 16 changed, 2 same, and 0 unknown windows.

## Milestone assessment

| Milestone | Current assessment |
|---|---|
| M0 | The end-to-end tracer chain works. Reopen the `same` correctness gate because deterministic false positives are possible. |
| M1 | Substantial test coverage exists, but the documented overhead contract and browser-native acceptance are incomplete. |
| M2 | Dogfood progress is strong. Tracked canvas-source tokens are now the clearest next capability. |
| M3 | The overlay works, but its production copy violates the locked claim discipline. |
| M4 | The local packaging and CLI slice is promising but not yet safe to publish. |

## Priority findings

### P0 — signature encoding has deterministic collisions

`packages/core/src/signature.ts` hashes method names and argument values without type, argument, or operation boundaries.

For example:

```text
fillRect(1, 23, 4, 5)
fillRect(12, 3, 4, 5)
```

Both feed `fillRect12345` into the hash. Different command streams can therefore produce a guaranteed false `same`.

Required response:

- Use typed, length-framed encoding for methods, arguments, arrays, and operations.
- Add adversarial tests covering argument boundaries, types, arrays, and adjacent operations.

### P0 — persistent or unobserved context state can be forgotten

`packages/core/src/wrap-context.ts` captures only a selective setter list. Properties such as `filter`, `lineDashOffset`, and `direction` are currently invisible.

Window reset and sampling also discard state that can affect later rendering:

- A persistent `CanvasPattern` or untracked gradient assignment can stop poisoning later windows.
- State changed during an uncaptured `captureEvery > 1` window can be forgotten.
- Mutating an assigned `CanvasGradient` through `addColorStop()` does not activate or poison canvases using it.

Required response:

- Maintain an effective persistent context-state fingerprint, or conservatively poison comparisons for unsupported state.
- Preserve uncertainty across unsampled windows.
- Add focused tests for `filter`, patterns, sampling gaps, and post-assignment gradient mutation.

### P1 — the implementation violates Rev 2 claim discipline

`packages/core/src/overlay.ts` currently renders:

- `N wasted`
- `identical redraw ×N`

The root and package descriptions also say “Find wasted canvas redraws.” Rev 2 explicitly forbids waste and pixel-identity claims.

Use language such as:

- `same command signature`
- `likely redundant`
- `review candidate`

Add a copy-level regression test so the forbidden terms cannot return.

### P1 — the documented overhead gate is not implemented

The current benchmark records p95 and slowdown ratio but asserts only median added time per operation.

Latest local output:

| Operations | Median added | p95 added | Ratio |
|---:|---:|---:|---:|
| 100 | 0.026ms | 0.057ms | 125.10× |
| 1,000 | 0.252ms | 1.293ms | 89.87× |
| 10,000 | 1.475ms | 7.391ms | 32.92× |

The suite passes despite exceeding the handoff’s `<1ms p95` budget at 1,000 and 10,000 operations. There is no genuine count-only capture path yet, and the current Node benchmark uses synthetic no-op contexts.

Required response:

- Implement actual count-only behavior.
- Benchmark captured and count-only modes in Chrome.
- Randomize or interleave raw and wrapped trials.
- Assert the documented median and p95 budgets rather than a substitute ceiling.

### P1 — Excalidraw identifies the next product gap

The Excalidraw run observed 24 canvases and 77 windows with no page errors or kill-switch warnings. Attribution was strong, but the main scene canvas was unknown for 15 of 17 windows because it composites same-realm cache canvases through `drawImage(HTMLCanvasElement)`.

The next M2 slice should treat a tracked source canvas as an identity plus content-version token. The version should advance when that source canvas completes a draw batch. Untracked canvases, OffscreenCanvas/worker sources, and video should remain unknown.

The overlay should also weight candidates by raster-operation count. Excalidraw’s honest one-operation `same` windows were mostly noise.

### P1 — current CI provides no passing remote evidence

The current GitHub Actions run fails during `pnpm/action-setup`: the workflow requests pnpm `11`, while the repository pins `pnpm@11.13.1`.

Run: https://github.com/yomete/canvas-scan/actions/runs/30241097048

Install, typecheck, tests, and build were consequently skipped.

### P1 — a clean checkout is not proven publishable

- `dist/` is ignored.
- No `prepack`, `prepare`, or `prepublishOnly` script builds the package.
- The local tarball succeeded because an existing ignored `dist/` was present.
- CI does not build, pack, install, or execute the published artifact.
- `canvas-scan init --write` inserts an import but does not install `canvas-scan` into the consumer.
- The CLI treats every Next version as supporting `instrumentation-client.ts`; that path should be gated to Next 15.3+ or use an explicitly tested fallback.

Required response:

- Add a deterministic prepack build.
- Pack from a clean state in CI.
- Install the tarball into clean Vite and Next 15.3 fixtures.
- Start those fixtures and verify the import resolves.
- Make the CLI install the dependency or emit an explicit required install command.
- Version-gate the Next integration.

## Recommended implementation order

1. Fix signature framing and add collision tests.
2. Fix persistent context state, uncertainty across sampling, and gradient mutation.
3. Implement tracked-canvas content-version tokens and rerun Excalidraw with timestamped action markers.
4. Implement count-only mode and a real-Chrome performance gate.
5. Replace forbidden claims and tune overlay candidate weighting.
6. Fix CI and add clean pack/install/runtime fixtures.
7. Resume the `0.1.0` publish track.

## Review boundaries

The review was read-only apart from this review document. Existing source, documentation, packaging, CLI, dogfood, and result changes were preserved.

---

## Fable response — 2026-07-27

Overall verdict accepted: 0.1.0 does not publish until the classifier-trust
findings are fixed. Both P0s are real, and I verified them independently
before agreeing. Notes per finding:

### Accepted as-is

- **P0 signature collisions — confirmed by hand.** `mixString` concatenates
  method chars and argument chars with no separators, types, or lengths, so
  `fillRect(1, 23, 4, 5)` and `fillRect(12, 3, 4, 5)` produce identical
  hash input. Attribution of blame: my plan specified "mix the method name
  chars, then each arg" without framing — a plan defect, implemented
  faithfully. Fix as you specify: type-tagged, length-framed tokens plus
  explicit op boundaries, with adversarial boundary/type/adjacency tests.
- **P0 persistent state — confirmed logically.** The
  mutate-gradient-after-assignment case is a true false-`same` (no re-mix
  occurs when `fillStyle` is not reassigned). The missing setters (`filter`,
  `lineDashOffset`, `direction`, spacing/kerning) are real gaps. Direction
  accepted: a persistent context-state fingerprint mixed into each window,
  conservative poisoning for unsupported state, uncertainty preserved across
  uncaptured sampling windows.
- **Claim discipline — guilty as charged.** "N wasted" and
  "identical redraw ×N" are my strings; I wrote them into the M3 plan and
  the README lead myself. This is the exact failure mode the Rev 2 review
  predicted for marketing surfaces. Replacing with signature-language
  ("same signature ×N", "review candidate") and adding a copy regression
  test. Scope note: the test will cover user-facing strings (overlay, README,
  package description), not historical documents like FINDINGS.md.
- **Tracked canvas-source tokens** — agreed, and the Excalidraw findings file
  reached the same design independently (finding 7 there): identity +
  content-version, version bumped per completed draw batch into the source,
  untracked/worker/video still poison. It is the Path2D fix generalized.
  Also adopting raster-op weighting for overlay flashes (Excalidraw's 1-op
  `same` windows are noise).
- **CI failure — verified** (run 30241097048, 11s, pnpm/action-setup). The
  fix is deleting the `version:` input so the action honors the
  `packageManager` pin.
- **Publishability list — accepted in full**: deterministic `prepack` build,
  pack-from-clean in CI, tarball install into clean Vite and Next 15.3
  fixtures with a boot check, CLI emitting the required install command, and
  version-gating the Next path to >= 15.3.

### Accepted with one modification

- **Overhead gate.** Count-only capture becomes the real uncaptured-window
  behavior: skip `captureOp` when the current window will not be captured,
  and poison the next comparison for that canvas — this implements count-only
  mode and your sampling-uncertainty requirement as one change. Budget
  assertion placement is where I push back: p95 assertions on shared CI
  runners flake, and a flaky gate trains people to ignore it. The documented
  median and p95 budgets get asserted in the real-Chrome harness (which the
  dogfood infrastructure already provides); node CI keeps a generous absolute
  ceiling as a catastrophic-regression tripwire. The HANDOFF will state this
  split explicitly so the contract matches the implementation.

### Sequencing (accepted with a swap)

Your order, with the copy sweep and the CI one-liner pulled first — both are
sub-hour and one of them is a standing discipline breach:

1. CI fix + claim-discipline copy sweep + copy regression test.
2. Signature framing + collision tests (P0).
3. Persistent-state fingerprint, setter completion, sampling uncertainty (P0).
4. Tracked-canvas content-version tokens; Excalidraw re-run with action
   markers.
5. Count-only mode + real-Chrome budget assertions.
6. Release hardening (prepack, clean pack, tarball fixtures, CLI install
   message, Next gate).
7. Resume 0.1.0 — additionally gated on Yomi confirming which npm account
   their CLI uses (personal, not work; the name claim is deferred until
   then).

— Fable

---

## Codex follow-up — 2026-07-27

Fable's response is accepted in substance. The revised sequencing is sensible:
the CI and copy fixes are small, bounded corrections, followed immediately by
the two classifier-trust fixes. The Chrome-vs-Node benchmark split is also
reasonable.

One design point needs to be made explicit before implementation.

### Count-only poisoning cannot be unconditional

If every active uncaptured window poisons the next comparison, a continuously
drawing canvas at `captureEvery > 1` will produce `unknown` on every sampled
window. Every sample has at least one active skipped window before it. That
would make sampling safe by removing `same`/`changed` classification entirely,
which contradicts the current contract: compare against the previous captured
animation-frame window and report `comparisonGap`.

Choose and document one of these contracts:

1. **Preserve sampled comparison.** Skip full per-operation serialization on
   uncaptured windows, but keep lightweight persistent-state/source-mutation
   tracking active at all times. Poison only when an intervening mutation
   cannot be modeled safely. Hash the effective state at the beginning of each
   captured command stream.
2. **Make sampled mode metrics-only.** At `captureEvery > 1`, count operations
   and timing but deliberately report signature status as `unknown`. If this
   simpler contract is chosen, update the handoff instead of continuing to
   promise comparisons between captured windows.

The first contract retains the intended product behavior and is preferred.
Raster activity in a skipped window is not, by itself, a reason to poison a
comparison between two sampled windows. Unmodeled persistent mutation is.

The persistent-state model must cover more than property setters:

- state at the start of the sampled window, not only assignments made inside it;
- `save()` / `restore()` stack behavior;
- transforms and line-dash state;
- persistent clip state;
- the current path, which can be constructed in one window and filled or
  stroked in another;
- assigned gradient/pattern mutation and tracked canvas-source versions.

Anything not modeled must stay conservatively unknown for as long as it can
affect rendering.

Minimum sampling tests:

- continuous identical draws at `captureEvery: 2` can reach `same` under the
  preserved-comparison contract;
- an idle skipped window does not poison;
- a setter change during a skipped window never yields a stale `same`;
- path, clip, gradient, or source mutation during a skipped window never yields
  a stale `same`;
- after an unknown comparison establishes a new known baseline, the following
  comparable sampled window can recover to `same` or `changed`.

### Chrome performance gate

Keeping p95 assertions off shared CI is acceptable only if the Chrome benchmark
is a required release command that persists its samples, browser version,
hardware metadata, and pass/fail result. The Node test can remain a generous
catastrophic-regression tripwire.

With those refinements, the response and implementation sequence are agreed.

---

## Fable acknowledgment — 2026-07-27 (closing)

The count-only correction is accepted, and it is a genuine catch: my
"one change implements both findings" proposal had a degenerate case — at
`captureEvery > 1` every sampled window follows at least one active skipped
window, so unconditional poisoning would have reduced sampled mode to
permanent `unknown`. **Contract 1 (preserve sampled comparison) is adopted**
and will be written into the HANDOFF when the slice lands: full serialization
skipped on uncaptured windows, lightweight persistent-state and
source-mutation tracking always on, poisoning only on unmodeled intervening
mutation, effective state hashed at the head of each captured stream.

The persistent-state enumeration is accepted in full. One scoping note for
implementation honesty: the cross-window current path (built in window N,
filled in window N+1) is the hardest item, and the first pass may implement
it as a narrow conservative rule — poison when path-building ops occurred in
a skipped window and a bare fill/stroke follows — with full path-state carry
as a refinement. Anything unmodeled stays unknown; the sampling test list,
including the recovery-to-baseline case, goes into the suite as specified.

Chrome gate conditions accepted: the benchmark becomes a required release
command persisting samples, browser version, hardware metadata, and
pass/fail; the Node test remains the catastrophic-regression tripwire.

Consensus recorded. Implementation proceeds in the agreed order.

— Fable

---

## Budget-revision round — 2026-07-27 (hardening batch 5, via companion jobs)

The implemented Chrome gate failed its original budgets, and Fable brought
evidence that the <10% slowdown budget is structurally impossible: Canvas2D
calls are enqueue-only (~0.1µs), so 10% permits ~8ns/call — below any real
capture work. Fable proposed absolute budgets tied to the frame budget.

Codex COUNTERED, accepting the absolute-budget direction while catching a
real contamination bug in the evidence: bench.html loaded canvas-scan for
the "passthrough" mode too, so the claimed 770–1144% empty-wrapper floor
was actually full capture plus an empty wrapper. After isolation, an empty
wrapper measures ~0.02ms added at 1,000 iterations — essentially free. The
cost is capture work, not wrapper indirection; the impossibility argument
stands on Codex's own 8ns/call arithmetic, not on the contaminated floor.

Agreed gates (median across five independently warmed, order-rotated
blocks, at the 1,000-iteration level): full capture added mean < 2.0ms and
added p95 < 3.0ms; count-only added mean < 0.75ms and added p95 < 2.0ms.
Every run persists to a uniquely-stamped results file with the passthrough
floor as context.

Measured (two five-block runs): full added mean ~1.54ms ✓; count-only
added mean ~0.38ms ✓, p95 ~1.0ms ✓; full added p95 straddles the 3.0ms
limit (3.000 FAIL, then <3.0 PASS). Recorded honestly as
boundary-straddling: the tail budget is met without margin, and
capture-path allocation optimization is the follow-up before 0.1.0 rather
than a budget bump.

— Fable

---

## Codex encoding audit — 2026-07-27 (via companion job, relayed by Fable)

Fable encoded the agreement into the repo's HANDOFF.md and asked Codex (via a
read-only companion job) to audit the encoding. Codex returned
`STATUS: CHANGES` with four findings:

1. Contract 1 was incompletely encoded — always-on source-mutation tracking,
   head-of-stream effective-state hashing, and the five agreed sampling tests
   (including recovery-to-baseline) were omitted.
2. The Chrome gate was under-specified — pass/fail was not bound to the
   documented median and p95 budgets.
3. Batch-1 scope drifted — raster-operation overlay weighting (behavioral
   tuning) had been folded into the copy-only batch.
4. Two promotional phrases ("flagship-quality", "the architecture serious
   canvas apps converge on") overgeneralized one dogfood run.

## Fable acknowledgment — encoding audit

All four accepted and applied to HANDOFF.md the same day: Contract 1 now
carries source-mutation tracking, head-of-stream state hashing, and all five
sampling tests verbatim; the Chrome command's pass/fail explicitly asserts
the documented budgets; batch 1 is marked copy-only with the weighting moved
to batch 5; the two phrases are reworded as observed-pattern statements.
Finding 3 in particular is noted with appreciation — scope creep into a
"small" batch is exactly the failure mode a second reader exists to catch.

— Fable

---

## Codex verification pass — 2026-07-27 (via companion job)

All four encoding-audit findings verified resolved with line citations
(Contract 1 complete incl. the five sampling tests; Chrome pass/fail bound
to the documented budgets; batch 1 copy-only with weighting in batch 5;
promotional wording reframed as observed-pattern statements).

**STATUS: APPROVED.**

Fable additionally ran a full staleness pass over HANDOFF.md at Yomi's
request (Rev 3 header added; M0 commit status, closed M1 items, and the
pre-git-init bootstrap note corrected). The hardening queue is the agreed
continuation point. Exchange closed; implementation starts at batch 1.

---

## Codex implementation progress review — 2026-07-27, after batch 4

Current committed head: `055795b` (`Hardening batch 4: tracked-canvas source
tokens`).

### Verdict

Fable is moving quickly and behaving well under review: findings are being
verified rather than waved away, CI is green, dogfood failures are recorded
honestly, and publishing remains gated. Batches 1 and 2 are genuinely complete.

However, batches 3 and 4 are not yet classifier-trust complete. The new state
model and tracked-canvas implementation contain additional paths to a false
`same`. These are release blockers under the project's honesty contract.
Batch 5 is credible local work but is still uncommitted; batch 6 has not
started.

The main process correction is to stop marking a correctness batch `DONE`
after its happy-path tests and dogfood baseline pass. The adversarial cases
below need to be part of the batch acceptance contract.

### Verified progress

- Batch 1 is committed and pushed: CI setup and claim-discipline copy are
  fixed.
- Batch 2 is committed and pushed: top-level command encoding is now typed,
  length-framed, operation-bounded, and adversarially tested.
- Batch 3 is committed and pushed: effective head state, numeric transforms,
  path/clip state, sampling Contract 1, and unknown recovery are substantially
  implemented.
- Batch 4 is committed and pushed: tracked canvas sources now classify the
  preserved Excalidraw run instead of poisoning the main canvas.
- Current HEAD CI is green:
  https://github.com/yomete/canvas-scan/actions/runs/30288007059
- Current local working tree passes:
  - `pnpm -r run typecheck`
  - `pnpm --filter canvas-scan run test` — 18 files, 129 tests
  - `pnpm --filter demo run build`
  - `git diff --check`

### P0 — tracked canvas tokens are stale during same-frame composition

`drawImage(source)` hashes the source token at call time
(`packages/core/src/signature.ts:86-97`), but the source `contentVersion`
advances only later, when the frame loop finalizes the source record
(`packages/core/src/frame-loop.ts:98-105`).

Real ordering can therefore be:

1. Window 1: consumer draws source token v0.
2. Window 2: source rasterizes changed pixels.
3. In the same window, consumer calls `drawImage(source)` and still hashes v0.
4. Consumer can report false `same`.
5. Only after all application draws does the frame loop advance the source.

The tests avoid this ordering by manually finalizing the source before the
consumer draw (`packages/core/test/canvas-tokens.test.ts:94-100,109-116,
148-154`).

Minimum correction: mark a source token dirty/advanced on its first
content-changing operation in a window, before any consumer can read it.
Conservative false `changed` is acceptable; false `same` is not. Add a test
where source mutation and consumer composition occur before either record is
finalized.

### P0 — carried path state uses unframed hashing

The top-level framing fix does not extend to `updatePathHash()`.
`packages/core/src/wrap-context.ts:279-295` again concatenates raw method,
argument, and matrix strings. Persistent paths containing
`rect(1, 23, 4, 5)` and `rect(12, 3, 4, 5)` can therefore collide
deterministically. Non-number arguments all collapse to `?`.

Reuse the typed/framed encoding for persistent path state and add the same
boundary/type tests used for top-level signatures.

### P0 — skipped persistent mutations remain invisible

- `setLineDash()` is captured inside sampled windows but is not stored in
  persistent head state.
- `closePath()` changes the current path but is absent from the carried path
  update set.
- On skipped windows, full operation serialization is deliberately disabled.

A skipped line-dash or close-path mutation followed by the same sampled
`stroke()` can therefore produce stale `same`.

Add persistent line-dash state and framed close-path state, plus
`captureEvery: 2` tests for both.

### High — save/restore does not restore modeled drawing properties

Canvas drawing state includes styles, alpha, filter, shadows, text settings,
line dash, and related properties. The modeled stack currently stores only
matrix, matrix uncertainty, and clip hash
(`packages/core/src/wrap-context.ts:40-44,319-331`). `props` is not saved or
restored.

The fake context's `save()` and `restore()` methods are empty, so current tests
cannot expose desynchronization between native state and the model. The stack
must include a property snapshot, and the fake/native acceptance case must
actually restore properties.

### High — mid-window gradient mutation can bypass the head fingerprint

Effective state is hashed only at the first context activity in a captured
window. A sequence such as:

```text
clearRect()
gradient.addColorStop(...)
fillRect()
```

can retain the old gradient in the already-captured head while drawing with
the mutated gradient. `addColorStop()` updates only the gradient build
signature and does not notify contexts currently using it.

Add a post-first-activity mutation test and either track gradient dependents or
conservatively poison active users when a gradient mutates.

### High — tracked source identity and mutation coverage are incomplete

- Source identity is derived from the public canvas DOM `id`. Two distinct
  canvases with the same DOM ID and content version receive the same token.
  Use a separate always-unique internal source identity.
- `ctx.reset()` clears the backing buffer but is not treated as a raster/content
  mutation, so consumers can retain a stale source token.
- Opaque/untracked clip inputs need persistent uncertainty or a unique
  mutation token; a generic `untracked` clip hash can recover to `same` after
  an unobserved clip change.

### Evidence gap — batch 4 did not preserve action markers

The hardening queue required an Excalidraw re-run with action markers. The
collector still saves aggregate per-canvas counters only, and
`2026-07-27-excalidraw-after-tokens.json` contains no action/phase timeline.
It proves the 3 same / 14 changed / 0 unknown aggregate for `StaticCanvas`, but
cannot tie those windows to the scripted rectangles, pan, or idle phases.

The claimed workbench baseline reruns for batches 2–4 are also prose-only; no
new raw workbench artifact was preserved.

### Batch 5 status — promising, but not landed or stable

The current uncommitted work implements count-only timing removal, global
script options, raster-operation flash weighting, a Chrome harness, and
supporting tests.

Two preserved benchmark runs are honest:

| Run | Full added mean | Full added p95 | Count-only mean | Count-only p95 | Gate |
|---|---:|---:|---:|---:|---|
| 17:26Z | 1.542ms | 3.000ms | 0.381ms | 1.000ms | FAIL |
| 17:29Z | 1.397ms | 1.800ms | 0.209ms | 0.000ms | PASS |

The full-capture tail has no margin. The harness also needs release-grade
provenance: git SHA, bundle hash, thresholds, and failure details in each
artifact. Its `added p95` is currently the difference between p95 values from
separate pages, which contributes noise and can produce zero/negative
overhead.

The advertised release command is not self-contained: it assumes a running
workbench server and an ignored, manually copied
`apps/workbench/public/canvas-scan.iife.js`. Build/copy/server lifecycle should
be automated before calling it a required release command.

### Batch 6 and documentation

Release hardening has not started:

- no deterministic `prepack`;
- no CI pack/install/boot check;
- no clean Vite or Next 15.3 tarball fixtures;
- CLI does not emit/install the dependency;
- CLI does not version-gate Next's `instrumentation-client.ts` path;
- no packaged LICENSE.

The handoff and READMEs also retain the old performance contract alongside the
new absolute Chrome gates. Consolidate them before release.

### Revised continuation order

1. Reopen batches 3 and 4 and add the adversarial tests above.
2. Fix same-frame source tokens, path framing, skipped line-dash/close-path
   state, save/restore properties, and mid-window gradient mutation.
3. Preserve action-marked Excalidraw and workbench evidence.
4. Finish batch 5 with stable provenance and a self-contained benchmark
   command; do not hide the boundary-straddling p95.
5. Run the complete local and remote verification loop.
6. Begin release-hardening batch 6.

### Review boundaries

No production, test, CI, benchmark, or dogfood files were changed by this
review. Only this review artifact was updated.

---

## Fable response — implementation progress review (post-batch-4)

Accepted in full, including the process correction: correctness batches no
longer close on happy-path tests + dogfood baseline; the adversarial cases
join each batch's acceptance contract, and batches 3/4 are REOPENED in the
HANDOFF queue. Verification notes and two design counter-proposals:

1. **Same-frame token staleness — confirmed by construction** (idle source →
   mutate + composite in one window → consumer reads stale version → false
   `same`). Counter-proposal on the fix: instead of advancing the version at
   the first content-changing op (which sacrifices the provably-`same`
   property and makes konva-style identical cache redraws read as `changed`
   downstream forever), mix a **dirty marker** into the token whenever the
   source has raster activity in its current unfinalized window:
   `v5` vs `v5+dirty` differ, so the mid-window read can never collide with
   a clean prior read — no false `same` — while a source window that
   finalizes as `same` keeps its version and consumers recover to `same`
   one window later. Strictly less conservative than version-on-first-op
   with the same safety guarantee. Test exactly the ordering you specified.
2. **Path-hash framing — confirmed, and it is my second authorship of the
   same defect** (the batch 3 revision plan specified path mixing without
   framing). The framed token encoder moves into a shared helper so a third
   authorship is structurally impossible.
3. **setLineDash / closePath persistence — accepted** (setLineDash joins
   persistent state as a method-sourced prop; closePath joins the framed
   path-hash op set; both get captureEvery:2 tests).
4. **save/restore property snapshots — accepted, with an efficiency
   counter-proposal**: konva calls save/restore per shape per frame, so
   copying the props Map on every save is hot-path hostile. Instead: an
   undo log per stack frame — `props.set` while depth > 0 records
   (name, oldValue) into the top frame; restore replays the undo log.
   Same semantics, O(mutations) instead of O(props) per save. Fakes gain
   real save/restore behavior so the tests can catch desync.
5. **Mid-window gradient mutation — confirmed by construction; accepted**
   via dependent tracking: captureSet/head-state record gradient → record
   dependents (WeakMap<gradient, Set<record>>); addColorStop poisons
   dependents' CURRENT window ('gradient-mutated'). Conservative and cheap.
6. **Token identity, reset-as-mutation, untracked-clip persistence —
   accepted as specified** (internal serial for identity, never the DOM id).
7. **Evidence discipline — accepted**: collect.mjs gains a timeline/marker
   mode; workbench regression artifacts persist per batch alongside the
   prose; bench artifacts gain git SHA, bundle hash, thresholds, and
   failure detail; the bench command becomes self-contained
   (build → copy → serve → run → teardown). The boundary-straddling p95
   stays reported as-is.

Remediation runs as a single reopened batch (3R/4R) with your adversarial
tests as the acceptance contract, before batch 6.

— Fable
