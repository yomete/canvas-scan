# SIDPROJ-95 implementation contract

## Falsifiable goal

SIDPROJ-95 is complete when one bounded Chrome probe records ten heavy nearest-negative values in `[7, 8)` ms. The complete v0.4 release capture must then pass unchanged product thresholds and all closed evidence checks.

## Live issue and blocker

- Linear issue: `SIDPROJ-95`, `V05-09k — Stabilize the heavy nearest-negative fixture`.
- URL: `https://linear.app/yde/issue/SIDPROJ-95/v05-09k-stabilize-the-heavy-nearest-negative-fixture`.
- Live state during planning: `In Progress` with the `AFK` label.
- The issue has no blocker and no comments.
- SIDPROJ-95 blocks SIDPROJ-94.
- SIDPROJ-95 relates to SIDPROJ-93 and SIDPROJ-70.
- Do not run SIDPROJ-70.

SIDPROJ-94 passed both final source judges after one correction batch. Its complete Chrome command then failed twice before the combined checker. Both runs failed at:

```text
heavy-burst:nearest-negative:negative
nearest-negative heavy self-time is not in the required range below 8 ms
```

Both runs owned and cleaned port `5190`. The final SIDPROJ-94 ledger was:

```text
correction rounds: 1/1
full evidence runs: 2/2
judge rounds: 2/2
```

Treat this repeat as a fixture defect. Do not change the approved SIDPROJ-94 association model.

## Baseline

- Branch: `agent/sidproj-95-heavy-negative-fixture`.
- Baseline commit and current `HEAD`: `65decbced2257a3d15774423c9607e037b77e6fb`.
- Chrome during planning: `151.0.7922.137`.
- Port `5190` had no listener during planning.
- Git uses SSH signing. `commit.gpgsign=true` and `gpg.format=ssh`.
- `git diff --check` passes.
- `pnpm --filter dogfood run lab:v0.4:test` passes 63 tests.
- The 63 tests include all 60 named attacks and all 12 live contracts.
- The inherited SIDPROJ-94 diff has 1,407 additions and 326 removals in its two files.

The initial worktree is:

```text
## agent/sidproj-95-heavy-negative-fixture
 M packages/core/test/pack-manifest.test.ts
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
?? packages/dogfood/v05-bench-diagnostic.ts
```

Preserve every unrelated path and byte. Do not reset, clean, stash, format, restore, remove, or stage them.

## Exact ownership and closure scope

SIDPROJ-95 owns changes to these five files:

```text
apps/workbench/src/V04Lab.tsx
packages/dogfood/lab-v04-truth.mjs
packages/dogfood/v04-heavy-negative-probe.mjs
packages/dogfood/v04-heavy-negative-probe-check.mjs
packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

SIDPROJ-95 also closes the approved SIDPROJ-94 work. Stage these two inherited files without unrelated changes:

```text
packages/dogfood/lab-v04.mjs
packages/dogfood/lab-v04.test.mjs
```

The final staged set must contain exactly these seven paths. Do not change `packages/dogfood/package.json`. Run the new commands with `node` directly.

Do not stage this plan. Do not stage any v0.5, pack, package, document, workflow, or release-note path.

## Run ledger

Start this fresh ledger:

```text
correction rounds: 0/1
full evidence runs: 0/2
judge rounds: 0/2
```

Evidence run 1 is the targeted ten-capture probe. Evidence run 2 is the complete `--idle-release` capture.

Do not start a Chrome run before both source judges pass. If the targeted probe fails, stop. Do not use run 2 for a second targeted probe. Start the full run only after the targeted probe and its independent checker pass.

Use one correction batch only. Collect all P1 and P2 findings from both source judges before the correction starts. If judge round 2 fails, stop and report the blocker.

At 90 minutes, report elapsed time, passed gates, remaining gates, and the ledger. At two hours, stop the same patch loop and reassess the approach.

## Current fixture defect

`heavy()` in `apps/workbench/src/V04Lab.tsx` currently does this for `heavy-burst:nearest-negative:negative`:

1. It calls `putImageData` until fixture-side measured call time reaches `7.8` ms.
2. It caps that loop at 2,048 calls.
3. It then performs 200 raster operations.
4. It then calls the final visible `paint()`.

The first loop uses almost the full product band. The 200 operations and final paint add product self-time after that loop. This can push the measured total to `8` ms or more.

Keep the product threshold at `8` ms. Keep the nearest-negative band at `[7, 8)` ms.

## Fixture calibration design

Change only the heavy nearest-negative branch in `V04Lab`.

### Closed constants

Define named constants near the fixture constants:

```text
HEAVY_NEGATIVE_TARGET_MS = 7.4
HEAVY_NEGATIVE_MAX_ITERATIONS = 2048
HEAVY_NEGATIVE_MAX_CALIBRATION_ELAPSED_MS = 12
HEAVY_NEGATIVE_TRAILING_SAMPLE_COUNT = 3
HEAVY_NEGATIVE_MAX_PREFLIGHT_ELAPSED_MS = 50
HEAVY_NEGATIVE_TRAILING_OPERATIONS = 200
```

The target is inside the closed band. It leaves `0.4` ms above the lower bound and `0.6` ms below the upper bound.

Do not make a constant depend on product output, repository truth, or a saved result.

### Preflight trailing-cost sample

Before `window.__CANVAS_LAB_FIXTURE__.ready` becomes true, calibrate only the heavy nearest-negative fixture.

Use a detached calibration canvas with the same backing width, height, factors, prepared image, and heavy tile as the primary canvas. Do not use the primary canvas for preflight work.

Run exactly three preflight samples. Each sample must reproduce this fixed trailing schedule:

1. Run exactly 200 heavy factor operations.
2. Use the nearest-negative `rects` method branch.
3. Run one replica of the final visible paint.

Measure only fixture work with `performance.now()`. Do not read canvas-scan state. Use the median of the three elapsed samples as `trailingReserveMs`.

Stop setup with an exact fixture error if the complete preflight takes more than `50` ms. Do not retry preflight. Do not reduce the fixed trailing schedule.

### Captured calibration schedule

Calculate:

```text
putImageDataBudgetMs = max(0, HEAVY_NEGATIVE_TARGET_MS - trailingReserveMs)
```

During the one captured fixture run, call `putImageData` while both conditions remain true:

```text
measuredPutImageDataMs < putImageDataBudgetMs
iterationCount < HEAVY_NEGATIVE_MAX_ITERATIONS
```

Before each next call, also check this wall cap:

```text
performance.now() - calibrationStartedAt < HEAVY_NEGATIVE_MAX_CALIBRATION_ELAPSED_MS
```

After the loop, run the existing 200 trailing operations and the existing final visible `paint()` once. Keep their order and drawing behavior unchanged.

The algorithm can complete below the target when a cap stops it. It must not start a second capture. The probe reports a band failure.

### Fixture telemetry

Add `heavyCalibration` to `FixtureSnapshot`. Use `null` for all other fixture coordinates.

For the heavy nearest-negative coordinate, expose this exact closed record:

```text
{
  targetMs: 7.4,
  maxIterations: 2048,
  maxCalibrationElapsedMs: 12,
  trailingSampleCount: 3,
  maxPreflightElapsedMs: 50,
  trailingOperations: 200,
  finalPaintCount: 1,
  trailingSamplesMs,
  trailingReserveMs,
  putImageDataBudgetMs,
  putImageDataIterations,
  measuredPutImageDataMs,
  preflightElapsedMs,
  calibrationElapsedMs,
  cap: 'budget' | 'iterations' | 'elapsed'
}
```

All numeric values must be finite and non-negative. `trailingSamplesMs` must contain exactly three values. Its median must equal `trailingReserveMs`.

`putImageDataBudgetMs` must equal `max(0, 7.4 - trailingReserveMs)`. `preflightElapsedMs` must not exceed `50`. `calibrationElapsedMs` must not exceed `12`.

`putImageDataIterations` must be an integer from `0` through `2048`. Set `cap` to the first stop condition in this order: `budget`, `iterations`, then `elapsed`.

The telemetry is fixture-owned diagnostic data. Do not add it to product output. The full lab can ignore the extra snapshot field.

### Prohibited feedback

The fixture must not read or call any of these values:

```text
window.__CANVAS_SCAN__
getReports
stopRecording
session.findings
session.canvases
canvasApiSelfTimeMs
checkScenarioResult
row.pass
row.failures
repository expected values
```

Do not loop until a product result passes. Do not retry a completed capture. Do not change waits or animation-frame counts.

## Exact observed-value diagnostic

In `packages/dogfood/lab-v04-truth.mjs`, add and export:

```text
heavyNearestNegativeFailures(value)
```

Return `[]` only when `value` is finite, `value >= 7`, and `value < 8`.

Use this exact diagnostic format for a failure:

```text
nearest-negative heavy self-time observed=<observed>; required=[7, 8) ms
```

Use these exact observed tokens:

- A finite number: JavaScript `String(value)` followed by ` ms`.
- `undefined` or `null`: `missing`.
- `NaN`: `NaN`.
- Positive infinity: `Infinity`.
- Negative infinity: `-Infinity`.

Examples:

```text
nearest-negative heavy self-time observed=6.999 ms; required=[7, 8) ms
nearest-negative heavy self-time observed=8 ms; required=[7, 8) ms
nearest-negative heavy self-time observed=missing; required=[7, 8) ms
nearest-negative heavy self-time observed=NaN; required=[7, 8) ms
nearest-negative heavy self-time observed=Infinity; required=[7, 8) ms
```

Use this helper only for `heavy-burst:nearest-negative:negative`. Keep the non-React nearest-negative lower bound and its current diagnostics unchanged.

Add table-driven tests for these exact inputs:

```text
6.999
7
7.5
7.999999999999999
8
8.001
undefined
NaN
Infinity
```

The tests must check the complete returned array. Values `7`, `7.5`, and `7.999999999999999` must return `[]`.

Use `7.999999999999999` as the nearest representable JavaScript number below `8`. Do not use `8 - Number.EPSILON`; that expression rounds to `8`.

## Dedicated targeted probe

Create `packages/dogfood/v04-heavy-negative-probe.mjs`. Do not import truth functions from `lab-v04-truth.mjs` or checker functions from the new checker.

Use the existing Playwright, Vite, Chrome, port-ownership, diagnostic, cleanup, build, and hash patterns in `lab-v04.mjs`. Do not add a dependency.

### Probe operation

The probe must:

1. Refuse to start when port `5190` has a listener.
2. Run `pnpm --filter canvas-scan run build` once.
3. Copy the current IIFE to `apps/workbench/public/canvas-scan.iife.js`.
4. Start Vite on `127.0.0.1:5190` with `--strictPort`.
5. Start one headless installed Chrome process.
6. Run ten fresh browser contexts in sequence.
7. Load only `heavy-burst:nearest-negative:negative` in each context.
8. Wait for `window.__CANVAS_SCAN__` and fixture readiness.
9. Perform the same 17-operation idle drain that the full lab uses.
10. Start one new recording.
11. Trigger the fixture once with its declared pointer event.
12. Wait for fixture completion under the existing 30-second fixture timeout.
13. Stop the recording once.
14. Read the first measured supporting canvas `canvasApiSelfTimeMs` from the completed session.
15. Read the fixture-owned `heavyCalibration` snapshot.
16. Close the context.
17. Stop Chrome and the owned Vite process.
18. Check that port `5190` has no listener.
19. Write the artifact atomically only after cleanup passes.

Do not retry a context or a completed capture. A missing or non-finite value is an evidence failure.

Do not stop early for a finite out-of-band value. Collect all ten completed captures, clean the process state, and write the diagnostic artifact. Then exit non-zero.

The probe exits zero only when all ten values are finite and inside `[7, 8)`. The independent checker remains the acceptance authority.

Collect warnings, console errors, page errors, request failures, instrumentation kills, unsupported evidence, and product drop counts. All lists and counts must be empty or zero.

Use these exact `diagnostics` keys:

```text
warnings
consoleErrors
pageErrors
requestFailures
instrumentationKills
unsupportedEvidence
```

Use these exact `droppedEntryCounts` keys in every run:

```text
canvasWindowReports
canvasLifetimes
resetEvents
lifecycleEvents
documentEvents
eventTiming
userMarks
longAnimationFrames
```

### Target artifact

Write one regular, non-symbolic-link file:

```text
/private/tmp/sidproj-95-heavy-negative-probe.json
```

Use this exact top-level schema:

```text
{
  schemaVersion,
  runId,
  startedAt,
  endedAt,
  coordinate,
  band,
  runCount,
  runs,
  values,
  minimum,
  maximum,
  median,
  chromeRevision,
  gitSha,
  bundleSha256,
  harnessSha256,
  diagnostics,
  port
}
```

Use these exact fixed fields:

```text
schemaVersion: 1
coordinate: { scenario: 'heavy-burst', variant: 'nearest-negative', mode: 'negative' }
band: { minimumInclusiveMs: 7, maximumExclusiveMs: 8 }
runCount: 10
port: { number: 5190, listenersBefore: [], listenersAfter: [] }
```

Each `runs` item must use this exact schema:

```text
{
  iteration,
  canvasApiSelfTimeMs,
  acceptedRunCount,
  droppedEntryCounts,
  calibration
}
```

Use iterations `1` through `10` exactly once. `acceptedRunCount` must equal `1`. All declared product drop counts must equal zero.

`values` must equal the ten `canvasApiSelfTimeMs` values in iteration order. Compute `minimum` and `maximum` from `values`. Compute the ten-value median as the average of sorted positions five and six.

Use the installed Chrome revision. Use the current Git `HEAD`. Hash the copied IIFE bytes for `bundleSha256`.

Compute `harnessSha256` from these files in this exact order. Prefix each byte stream with its byte length and a colon, as `lab-v04.mjs` does:

```text
packages/dogfood/v04-heavy-negative-probe.mjs
packages/dogfood/v04-heavy-negative-probe-check.mjs
apps/workbench/src/V04Lab.tsx
apps/workbench/src/v04-lab-main.tsx
apps/workbench/public/v04-lab.html
```

Do not include product output, page text, pixels, input values, raw stacks, URLs with query text, or live objects.

## Independent checker

Create `packages/dogfood/v04-heavy-negative-probe-check.mjs`.

The checker must not import the probe or `lab-v04-truth.mjs`. It must independently read the artifact, current Git state, installed Chrome revision, IIFE bytes, harness files, and live port state.

Export pure checks for unit tests. Add a direct CLI that accepts only this path:

```text
/private/tmp/sidproj-95-heavy-negative-probe.json
```

On success, print:

```text
SIDPROJ_95_HEAVY_NEGATIVE_PROBE: PASS
```

On failure, print the precise failed field and exit non-zero.

The checker must reject:

- an extra or missing top-level field;
- a wrong coordinate or band;
- fewer or more than ten runs or values;
- a missing, duplicate, skipped, or reordered iteration;
- a value below `7`, equal to `8`, above `8`, absent, or non-finite;
- a `values` list that differs from `runs`;
- a false minimum, maximum, or median;
- an accepted-run count other than one;
- a non-zero or malformed product drop count;
- a malformed calibration record;
- a changed calibration constant or exceeded cap;
- a warning, console error, page error, request failure, instrumentation kill, or unsupported item;
- a stale or malformed UUID or timestamp;
- a Chrome revision that differs from installed Chrome;
- a Git SHA that differs from current `HEAD`;
- a bundle or harness hash mismatch;
- a port other than `5190`;
- a saved listener before or after the run;
- a current live listener on port `5190`;
- an unsafe file type, symbolic link, or unexpected artifact path.

The checker must accept the artifact only when all ten values are finite and inside `[7, 8)`.

## Checker and diagnostic tests

Create `packages/dogfood/v04-heavy-negative-probe-check.test.mjs`.

Use a complete synthetic artifact with current local identities. Test the checker without Chrome.

Include these tests:

1. Accept the complete exact artifact.
2. Run the nine observed-value diagnostic cases.
3. Reject undershoot.
4. Reject `8` and overshoot.
5. Reject missing and non-finite values.
6. Reject a false minimum.
7. Reject a false maximum.
8. Reject a false median.
9. Reject a missing run.
10. Reject an extra run.
11. Reject a duplicate or reordered iteration.
12. Reject a changed target or cap.
13. Reject a cap overrun.
14. Reject a non-zero drop count.
15. Reject a diagnostic item.
16. Reject wrong Chrome, Git, bundle, and harness identities.
17. Reject saved and live port pollution through an injected live-port value.
18. Reject an extra schema field.
19. Reject a symbolic-link disk artifact.
20. Read `V04Lab.tsx` and reject fixture source that contains a prohibited product-feedback token.

Do not run Chrome from a unit test.

## Preserve the approved v0.4 checker

Keep all inherited SIDPROJ-94 behavior:

- exact complete LoAF association-set equality;
- exact per-pair normalized times;
- independent document-event truth;
- current-primary lifecycle chains for rows 28, 30, and 32;
- all reconstructed live rows return `[]`;
- split-pair rejection;
- unused compressed IDAT rejection;
- 60 named executable attacks;
- 12 live baseline contracts;
- 63 focused tests before new tests;
- exact 53 matrix rows and 20 idle rows;
- exact schemas, numeric bounds, diagnostics, drops, identities, hashes, and privacy limits;
- exact ten-file v0.4 artifact set and nine-file hash manifest.

The targeted artifact is separate from the inherited ten-file set. Do not add it to `evidencePaths`, `artifactPaths`, `normalPaths`, `/private/tmp/sidproj-55-sha256.txt`, or the SIDPROJ-90 release schema.

Keep bad and fixed heavy-burst fixture behavior unchanged. Keep all non-React burst behavior unchanged. Keep the 200 trailing operations and final visible paint unchanged.

## Verification funnel

### 1. Focused source checks

Run these after each source change:

```text
node --test packages/dogfood/v04-heavy-negative-probe-check.test.mjs
pnpm --filter dogfood run lab:v0.4:test
git diff --check -- apps/workbench/src/V04Lab.tsx packages/dogfood/lab-v04-truth.mjs packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs packages/dogfood/v04-heavy-negative-probe.mjs packages/dogfood/v04-heavy-negative-probe-check.mjs packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

The lab suite must pass at least 63 tests. It must run all 60 attacks and all 12 live contracts. The new checker suite must pass every listed counterexample.

### 2. Standard source checks

Run these after focused checks pass:

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

The core suite must report at least 555 passing tests. Both builds and type checks must pass.

Check that every unrelated dirty path still matches its initial bytes. The owned diff from the baseline must contain only the seven closure paths.

### 3. Source judge gate

Run two independent source judges on the same frozen source. Give each judge:

- this complete plan;
- live SIDPROJ-95 text;
- the SIDPROJ-94 plan and final result;
- the complete seven-file diff from the baseline;
- the full fixture, truth, probe, checker, and tests;
- the nine diagnostic cases;
- the complete checker counterexample list;
- all 60 attacks and 12 live contracts;
- the current run ledger.

Tell each judge to inspect every changed hunk. Each judge must return all P1 and P2 findings in one terminal report. Do not share one judge's report with the other judge.

Both judges must confirm that calibration has no product feedback. Both must confirm exact caps, fixed trailing work, diagnostic values, probe independence, port cleanup, and inherited boundaries.

Both judges must return `PASS` before Chrome.

### 4. Evidence run 1: targeted probe

After source freeze, run exactly once:

```text
node packages/dogfood/v04-heavy-negative-probe.mjs
```

This is full evidence run `1/2`. Do not retry a product failure.

Then run the independent checker without another Chrome run:

```text
node packages/dogfood/v04-heavy-negative-probe-check.mjs /private/tmp/sidproj-95-heavy-negative-probe.json
/usr/sbin/lsof -nP -iTCP@127.0.0.1:5190 -sTCP:LISTEN
shasum -a 256 /private/tmp/sidproj-95-heavy-negative-probe.json
```

Require ten finite values. Require `minimum >= 7` and `maximum < 8`. Require exact recomputed minimum, maximum, and median. Require no diagnostics, zero drops, correct identities, and an empty port.

If this gate fails, stop. Do not start the full release capture.

### 5. Evidence run 2: complete release capture

After the targeted checker passes, run exactly once:

```text
pnpm --filter dogfood run lab:v0.4 -- --idle-release
```

This is full evidence run `2/2`. Do not start a third Chrome run.

The command must prove:

- all 20 idle rows;
- all 53 matrix rows;
- the heavy nearest-negative row in `[7, 8)`;
- mutation evidence;
- exact hashes and identities;
- empty diagnostics;
- zero drops;
- exact fixture facts;
- cleanup of port `5190`.

### 6. Disk checks

Run these without Chrome:

```text
pnpm --filter dogfood run lab:v0.4:check
pnpm --filter dogfood run lab:v0.4 -- --check-idle-evidence
node packages/dogfood/v04-heavy-negative-probe-check.mjs /private/tmp/sidproj-95-heavy-negative-probe.json
/usr/sbin/lsof -nP -iTCP@127.0.0.1:5190 -sTCP:LISTEN
shasum -a 256 /private/tmp/sidproj-55-canvas-lab-v0.4.json /private/tmp/sidproj-55-console-summary.txt /private/tmp/sidproj-55-integrated-burst.png /private/tmp/sidproj-55-integrated-continuous.png /private/tmp/sidproj-55-mutation-output.txt /private/tmp/sidproj-55-nearest-negatives.json /private/tmp/sidproj-55-variant-matrix.json /private/tmp/sidproj-86-v04-idle-boundary.json /private/tmp/sidproj-90-v04-release-evidence.json /private/tmp/sidproj-95-heavy-negative-probe.json
```

Recompute every hash from disk. Do not trust saved hash text without recomputation.

### 7. Evidence judge continuations

Send fresh evidence to the same two judge streams. This continues the current judge round. It does not start another round.

Give each judge:

- the frozen seven-file source diff;
- the targeted probe artifact;
- the independent checker output;
- all ten observed values and recomputed aggregates;
- the complete SIDPROJ-90 release artifact;
- all inherited v0.4 artifacts and fresh hashes;
- Chrome, Git, bundle, harness, and port identities;
- the final run ledger.

Both judge continuations must return `PASS`.

## Closure

After all checks and judge continuations pass:

1. Check the complete worktree again.
2. Stage exactly the seven closure paths with this command:

```text
git add -- apps/workbench/src/V04Lab.tsx packages/dogfood/lab-v04-truth.mjs packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs packages/dogfood/v04-heavy-negative-probe.mjs packages/dogfood/v04-heavy-negative-probe-check.mjs packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

3. Run `git diff --cached --name-only`. Require exactly the seven paths above. Then check the complete staged diff.
4. Create one clear signed commit with `git commit -S`.
5. Push `agent/sidproj-95-heavy-negative-fixture`.
6. Upload `/private/tmp/sidproj-95-heavy-negative-probe.json` to SIDPROJ-95.
7. Upload `/private/tmp/sidproj-90-v04-release-evidence.json` to SIDPROJ-95.
8. Add all ten values, minimum, maximum, median, hashes, checks, Chrome revision, commit SHA, port result, and final ledger to SIDPROJ-95.
9. Mark SIDPROJ-95 Done.
10. Add the same closure evidence to SIDPROJ-94.
11. Mark SIDPROJ-94 Done because SIDPROJ-95 removed its only blocker.
12. Check live Linear state before work starts on another AFK issue.

Do not ask for routine Linear approval.

## Out of scope

- Do not change Canvas Scan product timing or instrumentation.
- Do not change finding generation or the `8` ms product threshold.
- Do not widen `[7, 8)`.
- Do not use product output as fixture feedback.
- Do not add capture retries or longer waits.
- Do not change the SIDPROJ-94 association model.
- Do not change lifecycle, idle, PNG, schema, numeric, hash, file-set, or privacy checks.
- Do not change `packages/dogfood/package.json`.
- Do not change a v0.5, pack, package, document, release-note, or workflow file.
- Do not run SIDPROJ-70.
- Do not tag, publish, open a pull request, or contact an external maintainer.
