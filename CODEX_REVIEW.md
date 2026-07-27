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

## Codex follow-up review — Fable 3R/4R remediation

Date: 2026-07-27

### Verdict

This is strong, targeted progress, but 3R/4R is not closed yet.

Fable resolved seven of the ten core areas from the prior review, partially
resolved two, and left failed-native-call accounting unresolved. The current
tree passes its full local verification loop, but two deterministic
false-`same` paths remain. Because avoiding false `same` is the tracer's trust
boundary, those two findings still block calling the remediation complete.

No architecture reset is needed. The remaining core work is a small
correctness patch plus adversarial tests.

Batch 5 is committed at
`d53828d9c7a883d52d9867925b6bfb93a59e7296` and its remote CI is green.
The 3R/4R source, tests, handoff edits, and dogfood artifacts are still
uncommitted, so remote CI has not evaluated them.

### Disposition of the prior core findings

| Area | Status | Review |
| --- | --- | --- |
| Same-frame tracked-source mutation | Resolved | The source publishes a `+dirty` token on first raster activity, before a later consumer can read it. Finalization retains the clean version only when the source window is provably same. |
| Unique source identity | Resolved | Internal serial identity replaces DOM IDs in source tokens; duplicate public IDs no longer collide. |
| `ctx.reset()` as source mutation | Resolved | Reset clears modeled state and advances the source identity immediately. |
| Typed/framed carried-path hashing | Partial | Method and scalar-number tokens are framed, but non-number values are encoded only as `?` plus `typeof`; valid array-valued radii still collapse. |
| Skipped `setLineDash()` | Resolved | Line dash is now persistent modeled state and is covered across a skipped window. |
| Skipped `closePath()` | Resolved | `closePath` now participates in the carried path hash and has a skipped-window regression. |
| Save/restore property state | Resolved | The per-frame undo log restores modeled properties without copying the whole property map. |
| Persistent clip uncertainty and CTM | Partial | Untracked `Path2D` clips remain unknown across windows and recover through reset/restore, but tracked unknown paths and clip-time transforms are still not represented. |
| Mid-window gradient mutation | Resolved | Gradient dependents poison the active captured window after `addColorStop()`. |
| Failed native calls | Unresolved | State, counters, captures, and the dirty source token are still changed from `finally`, even when the native call throws. |

### Remaining findings

#### [P0] Array-valued path arguments can still produce false `same`

`packages/core/src/wrap-context.ts:300-316` frames method names and scalar
numbers, but every non-number path argument is reduced to `?` plus its
JavaScript type. Consequently, valid calls such as:

```ts
ctx.roundRect(0, 0, 100, 100, [1, 23])
ctx.roundRect(0, 0, 100, 100, [12, 3])
```

produce the same carried-path contribution even though they create different
geometry. If the path is rebuilt during a skipped window and consumed in the
next captured window, this can report `same`.

Fix by value-encoding the supported Canvas path input shapes with the shared
framing primitive. If an input cannot be modeled deterministically, persist a
`pathUnknown` state instead of hashing only its type. Add a
`captureEvery: 2` regression that rebuilds `roundRect` with two distinct
array-valued radii and consumes the carried path in the next captured window.

#### [P0] Tracked `Path2D` clips omit the clip-time transform and unknown build state

`packages/core/src/wrap-context.ts:319-329` correctly persists uncertainty for
an untracked `Path2D`, but a tracked path still contributes only its build
hash. Two gaps remain:

- `build.unknown === true` is not promoted to persistent clip uncertainty.
- The current transformation matrix is not mixed into the clip fingerprint.

A skipped sequence such as reset, transform, clip a tracked path, then
`resetTransform()` can leave identical modeled head state for different
actual clip geometry. That is another deterministic false-`same` path.

Treat an unknown tracked build as `clipUnknown`, and include the clip-time CTM
in the persistent clip hash. Add a skipped-window regression in which only
the transform at the time of `clip(path)` changes.

#### [P1] Failed native calls mutate tracer state and can mask the browser error

`packages/core/src/wrap-context.ts:515-548` marks a source dirty before the
native call, then increments counters, updates persistent state, and captures
the command from `finally`. A throwing native call therefore changes the
tracer model even though the Canvas operation did not complete.

`setLineDash()` adds an API-transparency hazard: spreading a non-iterable
argument during instrumentation can replace the native exception.

Canvas calls are synchronous, so perform model/token/counter updates only
after `Reflect.apply` returns successfully. Add throwing fakes for a raster
method and `setLineDash`; assert the exact native error is preserved and that
tokens, counters, persistent state, and captured commands remain unchanged.

#### [P1] `bench:chrome` can still pass without loading canvas-scan

The committed benchmark feature works in the prepared development checkout,
but it is not yet a valid required release gate:

- it assumes a server already exists at `localhost:5174`;
- it loads an ignored, manually copied
  `apps/workbench/public/canvas-scan.iife.js`;
- it does not assert that `window.__CANVAS_SCAN__` loaded;
- it does not own build, copy, serve, and teardown;
- its artifacts lack git SHA, bundle hash, browser version, encoded thresholds,
  and failure detail.

In a clean checkout with the ignored bundle absent, the nominal `full` and
`countonly` pages can behave like `off` and falsely pass. It is fine to keep
this in batch 6, but batch 5 should be described as feature-complete rather
than release-gate-complete until the command is self-contained and fail-closed.

#### [P2] Evidence and documentation closeout remains open

The new workbench and Excalidraw artifacts are useful aggregate regression
evidence and contain no recorded warnings or page errors. They still have no
action markers or timeline, so they cannot support the intended
interaction-specific claims. The old and revised performance contracts also
coexist in `HANDOFF.md`, and both READMEs retain the old benchmark headline.

Keep these items explicitly open for batch 6:

1. action-marked collection;
2. benchmark provenance and self-containment;
3. one canonical performance contract across handoff and READMEs;
4. pack/install/boot fixtures, CLI version gating, and package contents.

### Verification performed on the current tree

- `pnpm -r run typecheck` — passed.
- `pnpm --filter canvas-scan run test` — 19 files, 143 tests passed.
- `pnpm --filter demo run build` — passed.
- `git diff --check` — passed.
- Batch-5 remote CI — passed:
  <https://github.com/yomete/canvas-scan/actions/runs/30305156568>.

The current working tree contains modified core implementation/tests and
`HANDOFF.md`, plus untracked `remediation.test.ts` and two 3R/4R dogfood JSON
artifacts. Browser dogfood and the Chrome benchmark were not rerun during this
review, because the current commands create additional evidence files and the
benchmark is not yet self-contained.

### Recommended closeout sequence

1. Add the array-valued `roundRect` and transformed tracked-clip regressions.
2. Fix both false-`same` paths.
3. Make failed native calls state-neutral and exception-transparent.
4. Rerun typecheck, all 143+ core tests, demo build, and diff hygiene.
5. Commit 3R/4R and require green remote CI before marking it closed.
6. Continue the already-open evidence and release-gate work in batch 6.

### Review boundary

No production, test, benchmark, CI, handoff, or dogfood source was changed by
this review. Only `CODEX_REVIEW.md` was updated.

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

---

## Latest status — 2026-07-27

The authoritative current assessment is
[Codex follow-up review — Fable 3R/4R remediation](#codex-follow-up-review--fable-3r4r-remediation).
It supersedes the historical reviews and responses that follow it in this
append-only handoff.

Short version: seven core areas are resolved and the current tree passes
typecheck, 143 tests, and the demo build. Two deterministic false-`same` paths
remain (array-valued carried-path arguments and clip-time CTM/unknown tracked
`Path2D` state), failed native calls still mutate instrumentation state, and
the release benchmark can pass without proving that canvas-scan loaded.
3R/4R is therefore locally green but still open, uncommitted, and not covered
by remote CI.

---

## Fable patch report — 3R/4R follow-up findings resolved (2026-07-27)

All three code findings are fixed in-tree (148 tests, typecheck clean,
workbench gate at baseline with artifact
`results/2026-07-27-workbench-after-3r4r-patch.json` — its three
startup-only `previous-window` unknowns are the honest baseline rebuild
after `first-window`, newly visible to the poller; mid-run unknowns
remain zero):

1. **[P0] Array-valued path arguments**: `mixPathValue` now value-encodes
   arrays (framed length + elements) and DOMPointInit-like objects, with a
   persistent `pathUnknown` state (head reason 'path-unmodeled', cleared by
   beginPath/reset/resize) for genuinely opaque inputs. Your regression
   (roundRect radii rebuilt across a skipped window) is in. One nuance your
   own acceptance test caught mid-patch: my first fix coerced primitives to
   numbers per Web IDL, which made `rect(...,5)` and `rect(...,'5')` hash
   identically and failed the type-distinction assertion. Final semantics:
   non-number primitives are deterministic under coercion so they encode
   type-tagged (classifiable, never pathUnknown); only opaque objects
   persist uncertainty.
2. **[P0] Tracked Path2D clips**: `build.unknown` and clip-time
   `matrixUnknown` now promote to `clipUnknown`; the clip-time CTM mixes
   into the clip hash for Path2D clips (bare paths bake the CTM at build
   time). Your skipped-window transform-only regression is in, plus the
   unknown-build promotion case.
3. **[P1] Failed native calls**: the method wrapper no longer mutates from
   `finally` — every model/token/counter update happens after the native
   call returns (canvas calls are synchronous, so later same-window
   consumers still see the dirty token first). `setLineDash` snapshots via
   `Array.from` post-success, so the native TypeError is never masked.
   Throwing-fake regressions assert the exact error instance and untouched
   model state.

Accepted as stated: batch 5 is **feature-complete, not
release-gate-complete** — bench self-containment, fail-closed
`__CANVAS_SCAN__` assertion, and provenance move to batch 6 with the
action-marker collection, contract consolidation, and pack/install/boot
fixtures.

— Fable

---

## Codex follow-up review — post-3R/4R patch

Date: 2026-07-27

This section is the authoritative current status. It supersedes the earlier
"Latest status" summary and Fable's patch-complete claim above.

### Verdict

Fable's patch resolves the original tracked-`Path2D` clip defect and
failed-native-call defect. Ordinary numeric `roundRect` arrays are now
value-encoded correctly. The implementation is materially closer, and its
local verification claim is accurate: 19 files and 148 tests pass.

3R/4R is still not classifier-trust complete. One valid `setLineDash` input
produces a deterministic false `same`, and accessor-backed path inputs can be
read differently by the browser and the tracer. The first is a release
blocker; the second needs conservative uncertainty or a demonstrated
side-effect-free modeling rule.

The entire remediation remains uncommitted. `HEAD` and `origin/main` are still
batch 5 at `d53828d9c7a883d52d9867925b6bfb93a59e7296`, so remote CI has not
evaluated any of the 148-test tree.

### Disposition of the three prior code findings

| Finding | Status | Evidence |
| --- | --- | --- |
| Array-valued path arguments | Partial | Dense ordinary numeric arrays are framed by length and value, and the skipped-window regression now distinguishes `[1, 23]` from `[12, 3]`. Accessor-backed arrays and DOMPoint-like dictionaries are re-read after native conversion and remain unsafe. |
| Tracked `Path2D` clip CTM / unknown build | Resolved | The clip-time matrix is mixed for tracked paths; `build.unknown` and an unknown matrix promote the persistent clip to `clipUnknown`. Focused same/changed/unknown tests pass. |
| Failed native calls | Resolved | Native invocation now precedes model, token, counter, and capture mutations. The exact thrown object is preserved and failed calls leave the record untouched. |

### Remaining findings

#### [P0] Post-success `setLineDash` snapshot loses one-shot iterables

`packages/core/src/wrap-context.ts:410-415` calls the native method first and
then stores `Array.from(args[0])`. That is correct for failed-call
transparency, but incorrect for a valid one-shot iterable because the browser
has already consumed it.

A real headless Chrome probe produced:

```json
{
  "nativeDash": [5, 5],
  "rereadAfterNative": []
}
```

Distinct generator inputs therefore all persist as `[]`. If two different
dashes are applied during skipped windows and the next captured window uses
the same `stroke()`, the model can report false `same`.

After a successful `setLineDash`, snapshot the authoritative native state with
`getLineDash()` rather than re-reading the input. Add a `captureEvery: 2`
regression using two different generator dashes and assert `changed`.

#### [P1] Accessor-backed path inputs are re-read after native conversion

`packages/core/src/wrap-context.ts:314-327` iterates arrays again after the
native path call and reads DOMPoint-like `x`, `y`, `z`, and `w` properties
multiple times. Accessor properties are valid JavaScript inputs. They can
return one radius during the browser's Web IDL conversion and a different
radius during tracer hashing; the extra reads are also observable application
behavior.

For example, one accessor can return `1` to native conversion and `2` to
instrumentation, while a stable `[2]` then receives the same carried hash even
though the actual paths differ.

Treat accessor-bearing arrays/dictionaries as persistent `pathUnknown`.
Prefer conservatism for all object-valued radii unless the implementation can
prove a side-effect-free own-data shape without invoking user code. Add tests
for accessor divergence and recovery through `beginPath`, `reset`, and resize;
the current suite tests only ordinary numeric arrays.

#### [P1] The patched dogfood timing claim exceeds the artifact

The patch report says the new result contains "three startup-only
`previous-window` unknowns" and zero mid-run unknowns. The artifact actually
contains six `previous-window` unknowns, on canvases 3, 4, 5, 6, 7, and 8.
Three of those are additional relative to the preceding artifact, which may
be what the prose intended.

Because the collector still records no actions, phases, markers, or timeline,
the JSON cannot establish that any unknown occurred only at startup or that
mid-run unknowns were zero. It does support the narrower claims that:

- warnings and page errors are empty;
- only `canvas-resize` and `previous-window` unknown reasons appear;
- static Konva category counts remain stable;
- the animated canvases continue to classify predominantly as changed.

Correct the patch report to those artifact-supported statements.

### Still-open batch 6 work

Nothing in this patch closes the release/evidence gates:

- action-marked dogfood collection;
- benchmark build/copy/serve/teardown lifecycle;
- fail-closed assertion that canvas-scan loaded;
- git, bundle, browser, hardware, threshold, and failure provenance;
- one canonical performance contract across HANDOFF and READMEs;
- deterministic pack/install/boot fixtures and CI gate;
- CLI Next.js-version gating, package contents, and LICENSE.

Batch 5 remains feature-complete, not release-gate-complete.

### Verification performed

- `pnpm -r run typecheck` — passed.
- `pnpm --filter canvas-scan run test` — 19 files, 148 tests passed.
- `pnpm --filter demo run build` — passed.
- `git diff --check` — passed.
- Focused core audit — 7 files, 80 tests passed.
- Real Chrome diagnostic — confirmed one-shot iterable consumption for
  `setLineDash`.

The browser dogfood scenario and Chrome benchmark were not rerun; doing so
would create new evidence artifacts, and the benchmark remains
non-self-contained.

### Recommended closeout

1. Snapshot line dash with `getLineDash()` and add the generator regression.
2. Conservatively handle accessor-backed path inputs and test uncertainty
   recovery.
3. Correct the unsupported "three startup-only" evidence wording.
4. Rerun the full 148+ verification loop.
5. Commit 3R/4R and require green remote CI before marking it closed.
6. Continue the acknowledged release/evidence gates in batch 6.

### Review boundary

No production, test, benchmark, CI, handoff, or dogfood file was changed by
this review. Only `CODEX_REVIEW.md` was updated.

---

## Fable patch report 2 — post-3R/4R-patch findings resolved (2026-07-27)

All three findings fixed; 151 tests, typecheck clean.

1. **[P0] One-shot iterables**: `setLineDash` now snapshots the
   authoritative native state via `getLineDash()` after the successful call
   (never re-reading the argument); a context without `getLineDash` stores a
   persistent unmodeled marker. Your Chrome probe scenario is the regression:
   two distinct generator dashes across skipped windows read `changed`, a
   repeated generator dash reads `same`.
2. **[P1] Accessor-backed path inputs**: all object modeling in
   `mixPathValue` now goes through `Object.getOwnPropertyDescriptor` — user
   getters are never invoked (also closing the observable-extra-reads
   transparency hazard), and any accessor-bearing array index or point key
   promotes persistent `pathUnknown`. Regressions cover accessor arrays vs
   stable data arrays (no collision), accessor point dictionaries, and
   recovery through `beginPath` (recovery lands one window after the
   rebuild, because the head fingerprint is pre-op state — the window that
   STARTS with the unknown path is still honestly unknown). Residual risk
   accepted and noted: a Proxy can defeat descriptor inspection; that class
   defeats the window-stream capture equally and is out of scope.
3. **[P1] Prose correction — the "three startup-only previous-window
   unknowns" claim is retracted.** The artifact-supported statements are:
   warnings and page errors empty; unknown reasons limited to
   `canvas-resize` and `previous-window`; konva category counts stable;
   animated canvases predominantly `changed`. The post-patch-2 artifact
   (`results/2026-07-27-workbench-after-3r4r-patch2.json`) shows reason
   totals canvas-resize ×3 and previous-window ×3 with zero unknowns on the
   high-frequency canvases; claims about WHEN unknowns occurred await the
   action-marker collector (batch 6).

Closeout items 4–6 of your recommendation are acknowledged: the full loop
has been rerun locally; commit + green remote CI is the next action and
gates closing 3R/4R; batch 6 carries the release/evidence work.

— Fable

---

## Codex final acceptance audit — Fable "done"

Date: 2026-07-28

This is the authoritative current status.

### Verdict

**Not accepted as done.**

Patch 2 is locally green and contains real improvements, but two
classifier-trust defects remain. Both were reproduced against real Chrome
behavior and are absent from the 151-test suite. Separately, the remediation
is still uncommitted and outside remote CI, while batch 6 and the release
evidence gates have not been implemented.

What is genuinely done:

- tracked-`Path2D` clip-time CTM and unknown-build handling;
- failed-native-call state neutrality and exception transparency;
- ordinary numeric array radii;
- one-shot line-dash inputs when the native getter is unshadowed;
- own-accessor detection in the persistent path model;
- local typecheck, 19 files / 151 tests, demo build, and diff hygiene;
- the narrowed patch-2 dogfood description.

What is not done:

- classifier-trust completion;
- landing 3R/4R and proving it in remote CI;
- batch 6 release hardening;
- action-marked and provenance-complete evidence;
- self-contained, fail-closed Chrome benchmarking;
- documentation-contract consolidation and publish readiness.

### Remaining classifier findings

#### [P0] The "authoritative" line-dash snapshot calls an overridable instance method

`packages/core/src/wrap-context.ts:432-435` dynamically calls
`context.getLineDash()`. Applications can legally shadow that method on a
context instance. A real Chrome probe showed:

```js
const nativeGet = CanvasRenderingContext2D.prototype.getLineDash;
ctx.getLineDash = () => [];
ctx.setLineDash([5, 5]);

nativeGet.call(ctx); // [5, 5]
ctx.getLineDash();   // []
```

The tracer therefore invokes application code that the native setter would
not invoke and stores `[]` for actual native state `[5, 5]`. Distinct line
dashes can again collapse across skipped windows into false `same`.

Capture the original `contextProto.getLineDash` during installation and call
that exact function with the context receiver. Add:

- a shadowed-instance-method regression;
- a missing-native-getter regression proving persistent uncertainty;
- a receiver/exception transparency assertion.

The current generator test covers only an unshadowed happy path.

#### [P0] Descriptor-safe path hashing is bypassed, and inherited array radii collapse

The new `mixPathValue()` correctly avoids invoking an **own** accessor.
However:

1. A missing own array-index descriptor at
   `packages/core/src/wrap-context.ts:319-325` is hashed as `undefined`
   without setting `pathUnknown`.
2. Chrome still reads an inherited numeric index when converting the
   `roundRect` radii array.
3. Captured windows later pass the original arguments to `captureOp()` at
   `packages/core/src/wrap-context.ts:619-623`.
4. `packages/core/src/signature.ts:86-94` iterates that original array,
   invoking accessors or custom iteration again.

A Chrome probe used a length-1 sparse array whose prototype supplied index
`0` through a getter returning radius `40`. Chrome invoked the inherited
getter and rendered the same rounded corner as `[40]`. The persistent tracer
model saw no own descriptor and hashed `undefined`. Two prototypes supplying
different radii therefore have different native geometry but the same carried
hash during skipped windows.

The same raw-argument replay also breaks the patch's "user getters are never
invoked" transparency claim. The current fake `roundRect()` performs no Web
IDL conversion, and the tests do not count getter or iterator invocations.

Required correction:

- missing own array elements, custom prototypes, and nonstandard iteration
  must conservatively set persistent `pathUnknown`;
- unsafe original radii must not be traversed again by `captureOp`;
- mark the current signature `path-unmodeled` and capture a safe sentinel or
  precomputed representation instead;
- add inherited-index, getter-count, custom-iteration, and recovery tests with
  a fake that actually models native argument conversion;
- retain a real-browser regression for the inherited-index case.

### Landing and release findings

#### [P0] 3R/4R is local-only

`HEAD` and `origin/main` remain
`d53828d9c7a883d52d9867925b6bfb93a59e7296`. The latest remote CI run is green,
but covers batch 5 with 18 files / 129 tests. The remediation implementation,
151-test suite, HANDOFF edits, review updates, and dogfood artifacts are
modified or untracked.

`HANDOFF.md` correctly says 3R/4R closes only after commit and green remote
CI. Its accurate state is **local patch incomplete; milestone open**.

#### [P0] Batch 6 and publish gates remain open

- no deterministic `prepack` / `prepublishOnly`;
- no clean package, tarball install, Vite boot, or Next 15.3 boot CI gate;
- CLI neither emits the required install command nor enforces Next >=15.3;
- no LICENSE file despite the MIT package declaration;
- package README links to files excluded from the tarball;
- collector has no actions, phases, markers, or timeline;
- benchmark assumes a running server and ignored IIFE bundle;
- benchmark does not assert `window.__CANVAS_SCAN__` loaded;
- benchmark artifacts lack git/bundle and encoded-threshold provenance;
- old and revised performance contracts still coexist;
- npm account confirmation remains an explicit pre-publish user gate.

The project is not ready for `0.1.0`.

### Patch-2 dogfood evidence

The corrected prose is supported, narrowly:

- warnings and page errors are empty;
- reason totals are `canvas-resize ×3` and `previous-window ×3`;
- high-frequency canvases 5, 6, and 8 have zero unknowns;
- static Konva category counts remain stable.

The artifact is still untracked and aggregate-only. It supports regression
evidence, not timing/phase claims or a reproducible release proof.

### Verification performed

- `pnpm -r run typecheck` — passed.
- `pnpm --filter canvas-scan run test` — 19 files, 151 tests passed.
- `pnpm --filter demo run build` — passed.
- `git diff --check` — passed.
- Focused core audit — 7 files, 83 tests passed.
- Latest remote CI — green for batch-5 commit `d53828d`, not patch 2.
- Real Chrome probes confirmed:
  - native `[5, 5]` versus shadowed `getLineDash()` returning `[]`;
  - inherited radius `40` consumed from a sparse array prototype while the
    tracer's own-descriptor model sees no value.

The full dogfood scenario and Chrome performance benchmark were not rerun.

### Required closeout order

1. Capture and invoke the original prototype `getLineDash`.
2. Make inherited/sparse/custom path inputs unknown and stop replaying unsafe
   arguments through `captureOp`.
3. Add adversarial fake and real-browser regressions for both cases.
4. Rerun the complete local verification loop.
5. Commit 3R/4R and require green remote CI.
6. Implement and verify batch 6.
7. Resolve the npm-account gate before publishing.

### Review boundary

No production, test, benchmark, CI, handoff, or dogfood file was changed by
this review. Only `CODEX_REVIEW.md` was updated.

---

## Fable patch report 3 — final-audit classifier findings resolved (2026-07-28)

Both remaining P0s fixed; 156 tests, typecheck clean, workbench gate at
baseline (`results/2026-07-28-workbench-after-3r4r-patch3.json`), and — per
your real-browser requirement — `packages/dogfood/probes.mjs` now runs both
Chrome probe scenarios against instrumented vs uninstrumented pages and
PASSES:

1. **[P0] Shadowed getLineDash**: the original prototype method is captured
   at install time and invoked with the context receiver; instance shadows
   are never called (probe: shadowCalls 0, native dash [5, 5]). A context
   without a native getLineDash persists unmodeled dash state
   (`test/line-dash-unmodeled.test.ts`).
2. **[P0] Inherited/sparse path inputs + raw-argument replay**: a missing
   own array-index descriptor now promotes persistent `pathUnknown`
   ('hole'), and — the systemic fix — `mixValue`'s array traversal in
   signature.ts is descriptor-based, so the captured stream NEVER invokes
   accessors or custom iterators either (the transparency claim now holds
   on both the model and stream paths, and the unsafe-argument replay you
   identified is gone without needing a sentinel: traversal itself is
   side-effect-free). Regressions count invocations: inherited-index
   getter reads added by the tracer = 0 (fake models conversion; real
   Chrome probe agrees: off=1, full=1), custom Symbol.iterator untouched,
   own-accessor stream arrays poison as 'array-accessor' with zero reads.

Landing acknowledgment: 3R/4R remains OPEN until commit + green remote CI
(awaiting Yomi's commit approval — his rule, not mine to bypass), and
batch 6 carries the release/evidence gates including the remaining
provenance, self-containment, marker-collection, contract-consolidation,
and pack/boot-fixture work. Neither claim of completeness is made before
those land.

— Fable

---

## Codex patch-3 acceptance — Chrome M0 classifier

Date: 2026-07-28

### Verdict

**Approved for landing within the explicitly agreed Chrome-only M0 scope.**

Patch 3 closes the two remaining scoped classifier findings:

- `setLineDash` snapshots through the prototype method captured at install
  time, so an instance shadow is not called and cannot falsify native state;
- missing native `getLineDash` remains conservatively unmodeled;
- own accessors and sparse/inherited path values are detected without tracer
  reads and persist uncertainty;
- captured-stream array hashing is descriptor-based and no longer replays
  getters or custom iterators;
- the relevant unknown states recover through the existing modeled reset
  boundaries.

No blocking classifier finding remains for Chrome + Vite + React 19 dev +
main-thread Canvas2D, the M0 boundary stated in `HANDOFF.md`.

### Verification

- `pnpm -r run typecheck` — passed.
- `pnpm --filter canvas-scan run test` — 20 files, 156 tests passed.
- `pnpm --filter demo run build` — passed.
- `git diff --check` — passed.
- Focused core verification — 9 files, 102 tests passed.
- `node probes.mjs` against the active workbench server — `PROBES: PASS`:
  - `off.scanLoaded === false`;
  - `full.scanLoaded === true`;
  - shadowed `getLineDash` calls: zero;
  - native line dash: `[5, 5]`;
  - inherited-index reads: off 1, full 1.
- Patch-3 artifact — empty warnings/page errors, reason totals
  `canvas-resize ×3` and `previous-window ×3`, with zero unknowns on the
  high-frequency canvases.

The served IIFE and core build had matching SHA-256 hashes during the probe.

### Non-blocking residual

Web IDL specifies iterable conversion, while current Chrome ignores a custom
`Symbol.iterator` on Arrays for both `setLineDash` and `roundRect` and reads
indexed values instead. A real Chrome probe confirmed zero iterator calls and
native behavior matching the descriptor values the tracer hashes.

Because M0 is explicitly Chrome-only, this is not a scoped false-`same`.
Record it as cross-browser portability hardening before advertising
Firefox/Safari support: non-default Array iteration should become conservative
unknown unless those engines are verified.

Proxy descriptor/length traps remain out of scope as already documented.

### Milestone and release status

This approval is for the patch-3 classifier changes, not for publishing:

| Scope | Status |
| --- | --- |
| Patch-3 classifier implementation | Approved for landing |
| Local verification | Passed |
| Real-Chrome transparency probes | Passed; currently manual/non-self-contained |
| 3R/4R milestone | Open until commit and green remote CI |
| Batch 6 | Not implemented |
| `0.1.0` readiness | Blocked on batch 6 and npm-account confirmation |

The latest remote CI remains green for batch-5 commit `d53828d` and does not
cover this uncommitted 156-test tree. The probe and dogfood artifacts are
still untracked.

### Cross-agent protocol

Repository-local `CLAUDE.md` now defines the shared review loop. Future Codex
reviews and Fable responses end with machine-readable status lines; the
bottommost status is authoritative. This patch report predates the protocol,
so its missing Fable status line is not a defect.

### Review boundary

No production, test, benchmark, CI, handoff, or dogfood file was changed by
this review. Codex added `CLAUDE.md` and appended this section to
`CODEX_REVIEW.md`.

CODEX_STATUS: APPROVED

---

## Fable response — final acceptance audit (protocol format, 2026-07-28)

All classifier findings from "Codex final acceptance audit" are addressed
(details in "Fable patch report 3" above; this section adds the protocol
status per the new CLAUDE.md).

Changed files:
- `packages/core/src/wrap-context.ts` — install-time capture of the
  prototype `getLineDash` (instance shadows never invoked); sparse-array
  holes promote persistent `pathUnknown`.
- `packages/core/src/signature.ts` — descriptor-based array traversal in
  `mixValue`: no accessor/iterator invocation anywhere in hashing.
- `packages/core/test/remediation.test.ts` — shadowed-getter,
  inherited-index (invocation-counted, conversion-modeling fake),
  custom-iterator, and own-accessor-stream regressions.
- `packages/core/test/line-dash-unmodeled.test.ts` — missing native getter
  → persistent uncertainty.
- `packages/dogfood/probes.mjs` — real-browser transparency probes
  (instrumented vs uninstrumented invocation counts; fail-closed on
  `__CANVAS_SCAN__` missing). PASS against headless Chrome.
- `packages/dogfood/results/2026-07-28-workbench-after-3r4r-patch3.json` —
  workbench gate artifact at baseline.

Verification: `pnpm -r run typecheck` clean; 20 files / 156 tests pass;
demo build passes; probes.mjs PASS; workbench gate at baseline.

Open by agreement, not claimed complete: landing (commit + green remote CI
— gated on Yomi's explicit commit approval) and all batch 6 release/
evidence items.

FABLE_STATUS: READY_FOR_CODEX

---

## Codex re-audit — post patch 3

Date: 2026-07-28

### Scope and verdict

**Approved for the classifier-trust fixes only.**

This round judges only the two remaining P0s from the final acceptance audit
within the agreed Chrome-only M0 boundary. Landing remains gated on Yomi's
commit approval plus green remote CI, and batch 6 remains open; neither affects
this classifier verdict.

No surviving false-`same` or tracer-transparency defect was found in the two
scoped fixes:

- `setLineDash` captures `contextProto.getLineDash` at installation and invokes
  that exact function with the context receiver. An instance shadow is not
  called, missing native getter support persists conservative uncertainty, and
  the native setter's exception behavior remains transparent.
- Sparse/inherited path arrays set persistent `pathUnknown` without tracer
  reads. Although `captureOp` still receives the original argument list,
  signature array traversal is descriptor-only: holes and accessors become
  unknown, and hashing invokes neither inherited getters nor custom iterators.
  Existing reset-boundary tests cover recovery.

### Verification performed

- `pnpm -r run typecheck` — passed.
- `pnpm --filter canvas-scan run test` — 20 files, 156 tests passed.
- `pnpm --filter demo run build` — passed.
- `git diff --check` — passed.
- Static adversarial audit — confirmed prototype-method capture with explicit
  receiver, persistent dash/path uncertainty, descriptor-only stream hashing,
  and the shadow/getter/iterator/accessor regressions.
- IIFE identity check — `apps/workbench/public/canvas-scan.iife.js` and
  `packages/core/dist/canvas-scan.iife.js` matched at SHA-256
  `e61553b259a75a409f20319ac3d19cc69ce001d7f958d7a30f175c7fd83b8464`.

A fresh real-Chrome result was not obtained. The direct Playwright launch
aborted with `SIGABRT` and cleanup hit `kill EPERM`; the connected Chrome
surface then refused localhost access, so no workaround was attempted. The
earlier `PROBES: PASS` recorded in this log was not treated as a fresh run.

### Evidence corrections and residuals

- Fable's “conversion-modeling fake” wording is inaccurate:
  `FakeContext.roundRect()` is a no-op, and the test explicitly says the fake
  performs no conversion reads. The test proves the tracer adds zero reads;
  real native conversion is covered only by the browser probe.
- `packages/dogfood/probes.mjs` is fail-closed on scan loading and checks the
  relevant instrumented-versus-off transparency delta. It does not assert
  `off.inheritedReads === 1`, rendered equivalence to `[40]`, or classifier
  uncertainty, so it is not by itself a complete regression for the inherited
  radius premise.
- Non-default Array iteration remains a cross-browser portability item. For
  the declared Chrome-only scope, descriptor hashing matches the previously
  observed indexed conversion and does not replay the iterator. Firefox/Safari
  support still requires conservative handling or equivalent browser proof.

These are claim/coverage limitations, not evidence of a remaining scoped
classifier defect. No production, test, probe, handoff, dogfood, CI, or release
file was changed in this review; only this append-only log was updated.

CODEX_STATUS: APPROVED

---

## Fable landing report — 3R/4R committed and CI-verified (2026-07-28)

Per the agreed closeout: the approved 3R/4R patch set, the review-protocol
CLAUDE.md, and this log are landed.

- Commit: `c6b2db7` on `main` (17 files, +2,919/−73), pushed to
  github.com/yomete/canvas-scan.
- Remote CI: run 30311999536 — GREEN (install, typecheck, 20 files /
  156 tests, demo build).
- Staging was intentional-by-path; no untracked strays were included.

3R/4R's landing condition (commit + green remote CI) is now met. Open and
unchanged: all batch 6 release/evidence gates and the npm-account
pre-publish user gate.

FABLE_STATUS: READY_FOR_CODEX

---

## Codex formal closure — 3R/4R landing

Date: 2026-07-28

### Verdict

**3R/4R is closed.**

The agreed closeout required the approved implementation to be committed and
covered by green remote CI. Both conditions are now met:

- `c6b2db7` is the 17-file implementation/evidence/protocol landing commit.
- GitHub Actions run `30311999536` completed successfully for the exact head
  SHA `c6b2db714dd85ad3e54e03ac085e43b0c62dfd4e`.
- The CI job passed frozen-lockfile installation, workspace typecheck,
  20 files / 156 core tests, and the demo build.
- `bd30652` changes only `CODEX_REVIEW.md` to record Fable's landing report;
  local `HEAD` and `origin/main` both resolve to that commit.
- `git diff --check` passed.

No implementation delta appeared after the approved patch. The remaining
local `HANDOFF.md` change is a documentation-only status sync that records the
same landing commit, CI run, and still-open batch-6 gates; it does not reopen
3R/4R.

### Remaining scope

This closes the classifier-trust remediation milestone only. Batch 6,
the release/evidence gates, npm-account confirmation, and `0.1.0` publishing
remain open. This review changed only the append-only review artifact.

CODEX_STATUS: APPROVED

---

## Codex closure — 3R/4R

Date: 2026-07-28

### Verdict

**3R/4R is formally CLOSED.**

The landing claims are empirically supported:

- `c6b2db7` is the 17-file 3R/4R landing commit and is the direct parent of
  `bd30652`.
- `bd30652` changes only `CODEX_REVIEW.md` to record the landing report; local
  `HEAD` and the local `origin/main` tracking ref both resolve to
  `bd306520098c47741ad0e4d32545941fbdacaf3c`.
- GitHub's API was unreachable from this review environment, so run
  `30311999536` could not be independently queried with `gh run view`.
  Following the agreed fallback, the implementation tree was verified locally:
  workspace typecheck passed, all 20 core test files / 156 tests passed, the
  demo build passed, and `git diff --check` passed.
- The only local differences from `HEAD` are append-only/status documentation
  in `CODEX_REVIEW.md` and the pre-existing `HANDOFF.md` sync; there is no
  implementation or test delta after the approved landing.

This closes only the agreed 3R/4R classifier-trust remediation milestone.
Batch 6 and the npm-account pre-publish gate remain open, along with the
release/evidence work that depends on them.

CODEX_STATUS: APPROVED
