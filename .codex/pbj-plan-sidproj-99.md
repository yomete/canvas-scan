# SIDPROJ-99 implementation contract

## Falsifiable goal

SIDPROJ-99 is complete when one fresh ten-capture Chrome probe writes `/private/tmp/sidproj-99-heavy-negative-probe.json` once. All ten Canvas2D API self-time values must be finite and in `[7, 8)`. The fixture must select and run at most 32 large native calls from warm calibration on an uninstrumented `OffscreenCanvas` context before recording starts. All source, disk, release, judge, commit, push, and Linear gates in this contract must pass.

## Live issue and evidence

- Issue: `SIDPROJ-99`, `V05-09o — Calibrate the heavy negative to native self-time`.
- URL: `https://linear.app/yde/issue/SIDPROJ-99/v05-09o-calibrate-the-heavy-negative-to-native-self-time`.
- State during planning: `In Progress` with the `AFK` label.
- Parent: `SIDPROJ-62`.
- SIDPROJ-99 has no blocker. It blocks SIDPROJ-98.
- It relates to SIDPROJ-97, SIDPROJ-95, and SIDPROJ-70.
- SIDPROJ-70 stays out of scope.
- Linear attachment `0c16f857-741a-4001-b552-b3e3bbeb0fc4` contains the failed SIDPROJ-98 targeted probe.
- The attachment bytes match `/private/tmp/sidproj-95-heavy-negative-probe.json`.
- The old artifact is a regular mode-`0600` file, size 8289, device 16777234, inode 904777482.
- Its SHA-256 is `4d8b2292910fba995d837b392e439274b0fdf412200941f337e25ad134827d65`.
- Its values are `[4.9, 6.6, 6.7, 6.6, 6.6, 6.5, 7.0, 7.1, 5.9, 6.7]`.
- Its minimum is 4.9, maximum is 7.1, and median is 6.6.
- Chrome was `151.0.7922.137`. The artifact recorded Git `65decbced2257a3d15774423c9607e037b77e6fb`.

Do not remove, rename, replace, chmod, reuse, or write the old artifact. Treat it as read-only failure evidence.

## Confirmed cause

`apps/workbench/src/V04Lab.tsx` measures wall time around each wrapped `putImageData()` call. It stops when that outer sum reaches its budget. The failed runs used 154 through 291 calls.

`packages/core/src/wrap-context.ts:1188-1209` starts its clock inside the wrapper. It adds only the duration around `original.apply(this, args)` to `record.selfTimeMs`. Wrapper work before and after the native call stays outside the product value.

Thus, the fixture sums native time plus wrapper time. Canvas Scan sums native time only. Small wrapper costs accumulate across hundreds of calls and make the product value lower than the fixture value.

The old preflight also saves its first three trailing samples without a warm-up. Run 1 saved `[2.0, 2.4, 1.3]` ms. Its median reserve was 2.0 ms. This reduced the `putImageData` budget to 5.4 ms and produced 4.9 ms of product self-time.

## Baseline and worktree

- Branch: `agent/sidproj-99-native-self-time-calibration`.
- Baseline commit and current `HEAD`: `65decbced2257a3d15774423c9607e037b77e6fb`.
- Git uses SSH signing. `commit.gpgsign=true` and `gpg.format=ssh`.
- Port `5190` had no listener during planning.
- `git diff --check` passed.
- The focused probe suite passed 180 tests.
- The lab suite passed 63 tests, all 60 attacks, and all 12 live contracts.
- Core passed 555 tests. Type checks and both builds passed.

The initial worktree is:

```text
 M apps/workbench/src/V04Lab.tsx
 M packages/core/test/pack-manifest.test.ts
 M packages/dogfood/lab-v04-truth.mjs
 M packages/dogfood/lab-v04.mjs
 M packages/dogfood/lab-v04.test.mjs
 M packages/dogfood/lab-v05-truth.mjs
 M packages/dogfood/lab-v05.mjs
 M packages/dogfood/lab-v05.test.mjs
 M packages/dogfood/package.json
 M scripts/pack-manifest.mjs
 M scripts/verify-pack.mjs
?? .codex/
?? AGENTS.md
?? apps/workbench/public/bench-v05.html
?? docs/releases/v0.5-human-test.md
?? docs/releases/v0.5-release-notes.md
?? packages/dogfood/bench-v05-chrome.mjs
?? packages/dogfood/bench-v05-chrome.test.mjs
?? packages/dogfood/excalidraw-v05-truth.mjs
?? packages/dogfood/excalidraw-v05-truth.test.mjs
?? packages/dogfood/excalidraw-v05.mjs
?? packages/dogfood/release-v05.mjs
?? packages/dogfood/release-v05.test.mjs
?? packages/dogfood/v04-heavy-negative-probe-check.mjs
?? packages/dogfood/v04-heavy-negative-probe-check.test.mjs
?? packages/dogfood/v04-heavy-negative-probe.mjs
?? packages/dogfood/v05-bench-diagnostic.ts
```

Preserve every unrelated path and byte. Do not reset, clean, stash, restore, remove, or format unrelated work.

## Exact closure scope and planning hashes

The combined SIDPROJ-94 through SIDPROJ-99 closure owns exactly these seven files:

```text
apps/workbench/src/V04Lab.tsx
packages/dogfood/lab-v04-truth.mjs
packages/dogfood/lab-v04.mjs
packages/dogfood/lab-v04.test.mjs
packages/dogfood/v04-heavy-negative-probe.mjs
packages/dogfood/v04-heavy-negative-probe-check.mjs
packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

SIDPROJ-99 can change only these four files:

```text
apps/workbench/src/V04Lab.tsx
packages/dogfood/v04-heavy-negative-probe.mjs
packages/dogfood/v04-heavy-negative-probe-check.mjs
packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

Their planning hashes are:

```text
d2a19749934855ccb803424072cd203a16aba77f01c418c991c92cf3ed7829dc  apps/workbench/src/V04Lab.tsx
43e3fc4503fe41ef54f71ac0a80209104e6cc2e130fc38927bdfae541650ced9  packages/dogfood/v04-heavy-negative-probe.mjs
03dba0a389e42aa30a6394f4d1560f7aa594ac1625cca2b9ab2a08dde0ec37b0  packages/dogfood/v04-heavy-negative-probe-check.mjs
7e098ab60aa9677ec2e040730620660bed2a76636bd429d7a79d0c8bc60e9694  packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

Keep these three closure files byte-identical:

```text
ca1a7a66360a77e2fce4bfe42030bb1eaf5dea16ae7b1049abb59d9b804effe9  packages/dogfood/lab-v04-truth.mjs
91970eb07365ca7abe3bab79b78ab35984ba997ebead5a6d72ce3d89549f80be  packages/dogfood/lab-v04.mjs
95888d4d6cbe7d0177f3db8f476100bbdf596e9a1c20f400a0c445fb63f9d687  packages/dogfood/lab-v04.test.mjs
```

Do not add an eighth closure file. Do not change `packages/dogfood/package.json`. Do not stage this plan.

## Fresh run ledger

Start with this exact ledger:

```text
correction rounds: 0/1
full evidence runs: 0/2
judge rounds: 0/2
```

A judge round contains two independent source judge streams. Each stream later checks fresh evidence.

Collect all P1 and P2 findings from both judges before one correction batch starts. Add every accepted counterexample to focused tests. If judge round 2 fails, stop and report the blocker.

Evidence run 1 is the targeted ten-capture probe. Evidence run 2 is the complete `--idle-release` capture. Do not start Chrome before both source judges pass. Do not start a third evidence run.

Allow one evidence retry only after a confirmed browser, port, network, or fixture timing environment failure changes. Do not retry a product, calibration, writer, checker, or contract failure.

At 90 minutes, report elapsed time, passed gates, remaining gates, and the ledger. At two hours, stop the same patch loop.

## One bounded calibration design

Use this design. Do not substitute a feedback loop, a product-output loop, a fixed guessed call count, or a new product threshold.

### Judge round 1 correction batch

Both independent source judges returned the same complete defect set. This is the single allowed correction batch:

1. The first build scaled only width and created `1280×140` while telemetry claimed `1280×560`.
2. `7.4 - 0.3` produced `7.1000000000000005` and rejected the declared exact edge.
3. A detached HTML canvas was still wrapped, so its outer samples did not prove the native lower bound.
4. The old-path audit read only the test file, not every relevant production source.
5. Direct cold-warm-up, slow trailing warm-up, modeled 8 ms, negative telemetry, and dimension-binding cases were missing.

The corrected design below uses uninstrumented `OffscreenCanvas` samples, both real backing dimensions, three-decimal arithmetic, an explicit modeled native total, a four-file path audit, and the complete missing corpus.

Current ledger:

```text
correction rounds: 1/1
full evidence runs: 0/2
judge rounds: 1/2
```

### Constants and workload

Keep these inherited constants:

```text
targetMs = 7.4
maxIterations = 2048
maxCalibrationElapsedMs = 12
trailingSampleCount = 3
maxPreflightElapsedMs = 50
trailingOperations = 200
finalPaintCount = 1
```

Add these exact fixture constants:

```text
workloadScale = 4
workloadWidth = 1280
workloadHeight = 560
warmupCallCount = 2
primitiveSampleCount = 3
maxCallCount = 32
minimumPrimitiveSampleMs = 0.25
maximumPrimitiveSampleMs = 0.5
minimumTrailingReserveMs = 0.3
maximumTrailingReserveMs = 0.6
```

For only `heavy-burst/nearest-negative/negative`, configure both backing dimensions of the primary canvas at four times the normal backing ratio. Do not reuse `configureCanvas()`'s one-axis `backingRatio`, which exists for backing-store mismatch scenarios. Add a narrow heavy-workload helper or explicit assignments that set `primary.width = 1280` and `primary.height = 560` while keeping CSS at 320 by 140. Bind telemetry to the actual canvas width and height and reject any mismatch.

Create an `OffscreenCanvas(1280, 560)` for calibration. Canvas Scan patches `CanvasRenderingContext2D.prototype`, not `OffscreenCanvasRenderingContext2D.prototype`; the offscreen context is therefore uninstrumented. Run all calibration before fixture `ready`, so it is also outside the measured recording. Use this uninstrumented context for both primitive and trailing native-work samples. The calibration must never call a product API or read product output.

Keep all other scenarios, variants, modes, canvas dimensions, and visible behavior unchanged.

### Warm-up and sampling

Run all warm-up and sampling before the fixture publishes `ready`. The probe starts its drain and measured recording only after `ready`. Thus, warm-up and samples cannot enter the saved recording.

On the uninstrumented offscreen calibration context before fixture `ready`:

1. Run exactly two unsaved `putImageData()` warm-up calls.
2. Run one unsaved native trailing-work warm-up with the same 200 `fillRect()` calls plus the same final `clearRect()` and two `fillRect()` calls as the measured primary path.
3. Measure exactly three separate full-size `putImageData()` calls. Save the three outer durations as `primitiveSamplesMs`.
4. Measure exactly three separate native trailing-work calls. Save the three durations as `trailingSamplesMs`.
5. Stop if total preflight time exceeds 50 ms.

Do not put a warm-up duration in either sample array. Do not run warm-up after `ready`. Do not read Canvas Scan state.

Require every primitive sample to be finite and in `[0.25, 0.5]`. Require every trailing sample to be finite and in `[0, 0.6]`. A sample outside these bounds is a calibration failure. Do not clamp a primitive sample into range.

### Call selection and measured execution

Quantize every saved millisecond sample to three decimal places with `Math.round(value * 1000) / 1000`. Compute both medians from the sorted quantized three-item arrays. Compute the reserve and budget with the same three-decimal quantization:

```text
trailingReserveMs = roundMs(min(0.6, max(0.3, median(trailingSamplesMs))))
nativeWorkBudgetMs = roundMs(7.4 - trailingReserveMs)
callCount = ceil(nativeWorkBudgetMs / median(primitiveSamplesMs))
modeledNativeSelfTimeMs = roundMs(callCount * primitiveMedianMs + trailingReserveMs)
```

Require `nativeWorkBudgetMs` in `[6.8, 7.1]`. Require integer `callCount` in `[1, 32]` and at most 2048. Require `modeledNativeSelfTimeMs` in `[7, 8)`. Otherwise, fail before `ready`. Exact reserve `0.3` must produce exact budget `7.1` and pass.

During the measured recording, execute exactly `callCount` full-size `putImageData()` calls on the wrapped primary context. Do not stop on wall time. Measure one outer duration around the complete fixed-count loop only for telemetry.

Then run the inherited 200 trailing operations and one final paint. Keep the current three settle frames.

Require the complete loop outer duration to be finite, nonnegative, and at most 12 ms. Record any arithmetic overrun. If the overrun is not zero, fail the fixture after telemetry becomes available. Do not reduce the call count from the outer duration.

This makes wrapper time observational. It cannot control the native call count. At the declared sample limits, ceiling selection yields 14 through 29 calls. This leaves space below the 32-call cap.

### Exact telemetry

Replace `HeavyCalibration` with an exact object that has only these keys:

```text
targetMs
maxIterations
maxCalibrationElapsedMs
trailingSampleCount
maxPreflightElapsedMs
trailingOperations
finalPaintCount
workloadScale
workloadWidth
workloadHeight
warmupPolicy
calibrationSource
warmupCallCount
primitiveSampleCount
maxCallCount
primitiveSamplesMs
primitiveMedianMs
trailingSamplesMs
trailingReserveMs
nativeWorkBudgetMs
callCount
modeledNativeSelfTimeMs
measuredOuterTimeMs
preflightElapsedMs
calibrationElapsedMs
calibrationElapsedOverrunMs
cap
```

Use these exact nonnumeric values:

```text
warmupPolicy = "offscreen-before-ready"
calibrationSource = "offscreen-native"
cap = "call-count"
```

Require `workloadWidth = 1280` and `workloadHeight = 560`, and require them to come from the real primary canvas dimensions. Set `measuredOuterTimeMs` and `calibrationElapsedMs` to the same complete-loop outer duration. Set `calibrationElapsedOverrunMs` to `roundMs(max(0, calibrationElapsedMs - 12))`.

All numeric telemetry must be finite and nonnegative. All declared counts and dimensions must be positive integers. The checker must recompute medians, reserve, budget, call count, and overrun. It must reject missing keys, extra keys, false arithmetic, wrong constants, wrong strings, and incoherent limits.

## File and symbol changes

### `apps/workbench/src/V04Lab.tsx`

- Change `HeavyCalibration` to the exact schema above.
- Add the exact constants above next to the current heavy-negative constants.
- Change both nearest-negative backing dimensions to four times normal without changing backing-store-mismatch behavior.
- In the heavy-negative preflight, use `OffscreenCanvas(1280, 560)` and its uninstrumented 2D context before recording starts.
- Measure primitive and native trailing samples on that offscreen context. Remove it from all product and visible-canvas collections.
- Quantize sample and derived telemetry to three decimals and record the modeled native total.
- Add the separate warm-up, primitive samples, trailing samples, median calculation, reserve, budget, and fixed call count.
- In `heavy()`, replace the wall-time `while` loop with an exact `for` loop over `callCount`.
- Keep the outer timer only for telemetry and the 12 ms failure gate.
- Keep `trailingWork`, 200 trailing operations, one final paint, three settle frames, and one accepted fixture run.
- Do not add a Canvas Scan import, global read, report read, finding read, row read, or checker read.

### `packages/dogfood/v04-heavy-negative-probe.mjs`

- Change `artifactPath` to `/private/tmp/sidproj-99-heavy-negative-probe.json`.
- Change `productionPublicationRequest()` to final name `sidproj-99-heavy-negative-probe.json`.
- Keep `publishCreateOnce()`, cleanup, race labels, source hashes, process ownership, drain, capture order, validator order, and writer behavior unchanged.
- Keep the new final path create-once. If it exists as any file, link, or directory, stop without a Chrome run.
- Keep the old path absent from all write, link, unlink, rename, chmod, cleanup, and publication targets.

### `packages/dogfood/v04-heavy-negative-probe-check.mjs`

- Change only the accepted artifact path to `/private/tmp/sidproj-99-heavy-negative-probe.json`.
- Change the pass line to `SIDPROJ_99_HEAVY_NEGATIVE_PROBE: PASS`.
- Replace `validCalibration()` with exact validation for the corrected telemetry schema and arithmetic, including exact real dimensions, offscreen source strings, three-decimal arithmetic, and modeled native total in `[7, 8)`.
- Add a small pure exported model for tests. It must compute `nativeSelfTimeMs = nativeCallMs * callCount` and `outerTimeMs = (nativeCallMs + wrapperMs) * callCount`.
- Keep this model independent of the fixture. Do not import fixture code or expected product output.
- Keep `checkArtifact()` label order, identity checks, source audit, port proof, and total behavior unchanged.
- Keep the prohibited token audit. Add tokens only if the new source can read an undeclared product or checker truth channel.

### `packages/dogfood/v04-heavy-negative-probe-check.test.mjs`

- Change fixture artifacts and policy assertions to the new exact path.
- Add a direct old-path rejection test. Invoke the checker with `/private/tmp/sidproj-95-heavy-negative-probe.json` and require `unsupported artifact path`.
- Add a source audit that reads the fixture, probe, checker, and test source. It must prove the old path is never a filesystem target in any of them and that only the checker rejection test may name it as a CLI argument.
- Replace old calibration fixtures and mutations with the new exact schema.
- Test every key independently. Require exact `checkArtifact()` failure arrays.
- Keep all 20 create-once disk cases and the six race-label additions.
- Keep the validator totality corpus and source audit.

## Mandatory calibration corpus

Add all these direct cases:

1. The pure model shows that positive wrapper time makes outer time exceed native self-time.
2. The model shows that a high call count accumulates wrapper bias.
3. A wall-time budget can pass while modeled native self-time stays below 7 ms.
4. Fixed call selection does not change when wrapper time changes.
5. Cold unsaved primitive and trailing warm-up values do not enter either three-item sample array.
6. A slow first trailing warm-up cannot reduce `nativeWorkBudgetMs`; direct test data must show the same three saved samples and budget with two different warm-up durations.
7. Primitive medians 0.25 and 0.5 select coherent counts at the declared edges.
8. A selected count above 32 is rejected.
9. A selected count above 2048 is rejected, even if another field claims 32.
10. A compensation that models 8 ms or more of native time is rejected by `validCalibration()` and by the product band gate.
11. A recorded value of 6.999 is rejected.
12. A recorded value of exactly 8 is rejected.
13. Nonfinite, negative, missing, and extra telemetry values are rejected.
14. False primitive median, reserve, budget, count, outer-time equality, and overrun arithmetic are rejected.
15. Wrong workload dimensions, scale, warm-up policy, call cap, and `cap` are rejected.
16. The old artifact path is rejected even though the old regular file exists.
17. The new final path already exists as a regular file, symbolic link, or directory.
18. Exact reserve `0.3` produces exact budget `7.1` and a valid bounded model.
19. Negative values for every mutable telemetry number are rejected.
20. The source audit fails when the old path is added as a filesystem target to the fixture, probe, checker, or test source.
21. The fixture source binds workload telemetry to the actual `primary.width` and `primary.height` and uses `OffscreenCanvas`; a one-axis 1280 by 140 counterexample is rejected.

For the three existing-new-path cases, use only fresh test roots for writer tests. For the production runner preflight, inspect the real new path with `lstat()` and stop. Never create a test object at either real production path.

## Frozen contracts

Keep all these contracts active:

- `[7, 8)` stays exact. The product threshold stays 8 ms.
- Product truth and primitive truth stay independent.
- The fixture never reads `window.__CANVAS_SCAN__`, reports, findings, canvases, rows, pass flags, failure text, repository expected values, or checker output.
- The probe drains the prior report before the measured recording.
- Each capture uses a new context and one accepted fixture run.
- Ten captures, exact zero drops, empty diagnostics, and current identities remain mandatory.
- Create-once hard-link publication, `0700` directory mode, `0600` file mode, inode binding, and cleanup order stay unchanged.
- All targeted race labels, non-`ENOENT` precedence, and the complete real-disk matrix stay unchanged.
- `validateProbeExit()` stays total and keeps this label order: `schema`, `run count`, `runs`, `values`, `drops`, `diagnostics`, `coordinate`, `band`, `port`.
- `checkArtifact()` keeps this label order: `schema`, `run identity`, `coordinate`, `runs`, `run:<iteration>`, `aggregates`, `diagnostics`, `identity`, `port`.
- Hashes, timestamps, PNG proof, idle proof, lifecycle proof, association proof, and port proof stay exact.
- The old artifact stays byte-identical at its planning SHA-256.

## Verification funnel

Run these gates in order. Stop at the first product or contract failure.

### 1. Focused checks

Run after each source batch:

```text
node --test packages/dogfood/v04-heavy-negative-probe-check.test.mjs
pnpm --filter dogfood run lab:v0.4:test
git diff --check -- apps/workbench/src/V04Lab.tsx packages/dogfood/lab-v04-truth.mjs packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs packages/dogfood/v04-heavy-negative-probe.mjs packages/dogfood/v04-heavy-negative-probe-check.mjs packages/dogfood/v04-heavy-negative-probe-check.test.mjs
shasum -a 256 packages/dogfood/lab-v04-truth.mjs packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs /private/tmp/sidproj-95-heavy-negative-probe.json
```

Require more than 180 focused probe tests. Require 63 lab tests, all 60 attacks, and all 12 live contracts. Require all 20 disk cases, six race additions, the new calibration corpus, validator totality, and the source audit.

Require the three frozen source hashes and old artifact hash to equal the planning hashes.

### 2. Standard source checks

```text
pnpm --filter canvas-scan test
pnpm typecheck
pnpm --filter canvas-scan run build
pnpm --filter workbench exec vite build
git diff --check
git status --short --branch
git diff --name-only
git diff --stat 65decbced2257a3d15774423c9607e037b77e6fb -- apps/workbench/src/V04Lab.tsx packages/dogfood/lab-v04-truth.mjs packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs packages/dogfood/v04-heavy-negative-probe.mjs packages/dogfood/v04-heavy-negative-probe-check.mjs packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

Require at least 555 core tests. Require all type checks and both builds. Check every unrelated dirty path against its initial bytes.

### 3. Two independent source judges

Freeze the source. Give both judges these raw inputs:

- this complete plan and live SIDPROJ-99 text;
- `.codex/pbj-plan-sidproj-98.md` and `.codex/pbj-plan-sidproj-97.md`;
- the failed artifact and its attachment SHA-256;
- `packages/core/src/wrap-context.ts:1166-1212`;
- the complete seven-file diff from the baseline;
- the four SIDPROJ-99 changed-file diffs;
- the exact telemetry schema and complete mutation corpus;
- all create-once, race, totality, source-audit, and path tests;
- all focused and standard check output;
- pre-change and post-change hashes;
- the current ledger.

Do not give either judge the other judge's report. Tell each judge to inspect every changed hunk and return all P1 and P2 findings in one terminal report.

Each judge must check the native-versus-outer model, warm-up boundary, call-count bound, band risk, telemetry arithmetic, product independence, old-path safety, create-once behavior, and frozen contracts.

Both judges must return `PASS` before Chrome starts. If round 1 fails, collect both reports. Use one correction batch. Run all source gates again. Then start round 2. If round 2 fails, stop.

### 4. Evidence run 1: targeted ten-capture probe

Before Chrome, use `lstat()` semantics to check this exact new path:

```text
/private/tmp/sidproj-99-heavy-negative-probe.json
```

If any file type exists, stop. Do not remove or replace it. Also check the old artifact SHA-256 again.

Run exactly once after both source judges pass:

```text
node packages/dogfood/v04-heavy-negative-probe.mjs
```

Set `full evidence runs: 1/2`.

Then run without Chrome:

```text
node packages/dogfood/v04-heavy-negative-probe-check.mjs /private/tmp/sidproj-99-heavy-negative-probe.json
node packages/dogfood/v04-heavy-negative-probe-check.mjs /private/tmp/sidproj-95-heavy-negative-probe.json
/usr/sbin/lsof -nP -iTCP@127.0.0.1:5190 -sTCP:LISTEN
stat -f '%N|size=%z|mode=%Sp|dev=%d|ino=%i|type=%HT' /private/tmp/sidproj-99-heavy-negative-probe.json
shasum -a 256 /private/tmp/sidproj-99-heavy-negative-probe.json /private/tmp/sidproj-95-heavy-negative-probe.json
```

The first checker must print `SIDPROJ_99_HEAVY_NEGATIVE_PROBE: PASS`. The old-path checker must fail only with `unsupported artifact path`.

Require ten finite values in `[7, 8)`. Recompute minimum, maximum, and median from the values. Require one accepted run, zero drops, empty diagnostics, exact bounded telemetry, current identities, mode `0600`, a regular file, and an empty port.

Require the old artifact SHA-256 to stay unchanged. If any product, calibration, writer, checker, or contract gate fails, stop. Do not start evidence run 2.

### 5. Evidence run 2: complete release capture

Run exactly once after run 1 and all checks pass:

```text
pnpm --filter dogfood run lab:v0.4 -- --idle-release
```

Set `full evidence runs: 2/2`.

Require all 20 idle rows, all 53 matrix rows, all mutation evidence, exact hashes, current identities, empty diagnostics, zero drops, and port cleanup. Do not start another Chrome run.

### 6. Disk checks

Run without Chrome:

```text
pnpm --filter dogfood run lab:v0.4:check
pnpm --filter dogfood run lab:v0.4 -- --check-idle-evidence
node packages/dogfood/v04-heavy-negative-probe-check.mjs /private/tmp/sidproj-99-heavy-negative-probe.json
/usr/sbin/lsof -nP -iTCP@127.0.0.1:5190 -sTCP:LISTEN
shasum -a 256 /private/tmp/sidproj-55-canvas-lab-v0.4.json /private/tmp/sidproj-55-console-summary.txt /private/tmp/sidproj-55-integrated-burst.png /private/tmp/sidproj-55-integrated-continuous.png /private/tmp/sidproj-55-mutation-output.txt /private/tmp/sidproj-55-nearest-negatives.json /private/tmp/sidproj-55-variant-matrix.json /private/tmp/sidproj-86-v04-idle-boundary.json /private/tmp/sidproj-90-v04-release-evidence.json /private/tmp/sidproj-95-heavy-negative-probe.json /private/tmp/sidproj-99-heavy-negative-probe.json
```

Recompute every hash from disk. Do not use saved hash text as proof.

### 7. Evidence continuations

Send fresh evidence to the same two judge streams. This continues the open judge round.

Give each judge:

- the final frozen seven-file diff and four SIDPROJ-99 diffs;
- the new artifact and checker output;
- the old-path rejection output;
- all ten values and recomputed aggregates;
- all ten calibration objects;
- both artifact device, inode, mode, size, and hash facts;
- `/private/tmp/sidproj-90-v04-release-evidence.json`;
- all inherited v0.4 artifacts and recomputed hashes;
- Chrome, Git, bundle, harness, timestamp, drop, diagnostic, and port facts;
- the final ledger.

Do not share one continuation with the other judge. Both continuations must return `PASS`.

## Closure

Start closure only after all checks and both evidence continuations pass.

1. Check the complete worktree.
2. Check the three frozen source hashes and old artifact hash again.
3. Stage exactly these seven files:

```text
git add -- apps/workbench/src/V04Lab.tsx packages/dogfood/lab-v04-truth.mjs packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs packages/dogfood/v04-heavy-negative-probe.mjs packages/dogfood/v04-heavy-negative-probe-check.mjs packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

4. Run `git diff --cached --name-only`.
5. Require exactly the seven paths above.
6. Check the complete staged diff.
7. Create one clear signed commit with `git commit -S`.
8. Push `agent/sidproj-99-native-self-time-calibration`.
9. Upload `/private/tmp/sidproj-99-heavy-negative-probe.json` to SIDPROJ-99.
10. Upload `/private/tmp/sidproj-90-v04-release-evidence.json` to SIDPROJ-99.
11. Add checks, values, aggregates, telemetry, hashes, Chrome revision, commit SHA, inode facts, port result, and final ledger to SIDPROJ-99.
12. Mark SIDPROJ-99 Done.
13. Add the same closure evidence to SIDPROJ-98. Mark SIDPROJ-98 Done.
14. Add the same closure evidence to SIDPROJ-97. Mark SIDPROJ-97 Done.
15. Add the same closure evidence to SIDPROJ-96. Mark SIDPROJ-96 Done.
16. Add the same closure evidence to SIDPROJ-95. Mark SIDPROJ-95 Done.
17. Add the same closure evidence to SIDPROJ-94. Mark SIDPROJ-94 Done.
18. Check live Linear state before work starts on another AFK issue.

Do not ask for routine Linear approval.

## Out of scope

- Do not change the 8 ms product threshold or widen `[7, 8)`.
- Do not change Canvas Scan timing or wrapper code.
- Do not read product output from fixture code.
- Do not delete, replace, rename, reuse, or attach the old artifact as new evidence.
- Do not redesign create-once publication, cleanup, process ownership, drain, or port proof.
- Do not weaken schemas, mutation tests, source audits, hashes, diagnostics, drops, PNG proof, idle proof, lifecycle proof, or association proof.
- Do not change truth projection files or product findings.
- Do not change `packages/dogfood/package.json`.
- Do not change a v0.5, pack, package, document, release-note, or workflow file.
- Do not run SIDPROJ-70.
- Do not stage `.codex/` or `AGENTS.md`.
- Do not tag, publish, open a pull request, or contact an external maintainer.
