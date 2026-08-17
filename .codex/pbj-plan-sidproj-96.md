# SIDPROJ-96 implementation contract

## Falsifiable goal

SIDPROJ-96 is complete when direct tests prove every harness transition and failure path. Two source judges must then approve the frozen source. One targeted probe and one full release capture must pass with an empty port.

## Live issue and baseline

- Linear issue: `SIDPROJ-96`, `V05-09l — Close the heavy probe harness state machine`.
- URL: `https://linear.app/yde/issue/SIDPROJ-96/v05-09l-close-the-heavy-probe-harness-state-machine`.
- Live state during planning: `In Progress` with the `AFK` label.
- The issue has no blocker and no comments.
- SIDPROJ-96 blocks SIDPROJ-95.
- SIDPROJ-96 relates to SIDPROJ-94 and SIDPROJ-70.
- Branch: `agent/sidproj-96-heavy-probe-state-machine`.
- Baseline commit and current `HEAD`: `65decbced2257a3d15774423c9607e037b77e6fb`.
- Chrome during planning: `151.0.7922.137`.
- Port `5190` had no listener during planning.
- Git uses SSH signing. `commit.gpgsign=true` and `gpg.format=ssh`.
- `git diff --check` passes.
- `node --test packages/dogfood/v04-heavy-negative-probe-check.test.mjs` passes 5 broad tests.
- `pnpm --filter dogfood run lab:v0.4:test` passes 63 tests.
- The lab suite runs all 60 attacks and all 12 live contracts.

The initial worktree is:

```text
## agent/sidproj-96-heavy-probe-state-machine
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

Preserve every unrelated path and byte. Do not reset, clean, stash, format, restore, remove, or stage them.

## Final SIDPROJ-95 judge reports

SIDPROJ-95 stopped before Chrome with this ledger:

```text
correction rounds: 1/1
full evidence runs: 0/2
judge rounds: 2/2
```

### Judge A

Judge A found no P1 and five P2 defects:

1. The drain waits one animation frame. It does not wait for a changed report with exactly 17 operations.
2. One slow `putImageData` can cross 12 ms. The fixture then throws and skips the 200 operations and final paint.
3. The checker accepts `cap='elapsed'` when elapsed is `2` and no real cap is true.
4. The checker accepts stale and future canonical timestamps.
5. An operation error skips the final live-port check. The predictable temporary path can follow a pre-created symbolic link.

Judge A also found missing direct mutations for out-of-band values, run structure, elapsed truth, identities, live port, timestamps, and disk links.

### Judge B

Judge B found two P1 and four P2 defects:

- P1: a timestamp from 2000 passes.
- P1: the checker can label an impossible low-elapsed record as `elapsed`.
- P2: a slow call skips fixed trailing work.
- P2: the probe exit check accepts a missing drop object or extra zero-valued drop keys.
- P2: `stopOwned()` signals `-pid` without a process-group ownership recheck.
- P2: the mutation suite is broad and incomplete. It also uses fixed identities.

Both judges confirmed these boundaries now work: `lsof` exit 1, detached readiness ownership, live-port injection, ten prohibited tokens, negative numeric rejection, identity formats, empty diagnostics, query-free request failures, wrong artifact path, final link rejection, and other probe exit failures. Preserve them and add direct tests.

## Exact closure scope

Only these seven files belong to the combined SIDPROJ-94, SIDPROJ-95, and SIDPROJ-96 closure:

```text
apps/workbench/src/V04Lab.tsx
packages/dogfood/lab-v04-truth.mjs
packages/dogfood/lab-v04.mjs
packages/dogfood/lab-v04.test.mjs
packages/dogfood/v04-heavy-negative-probe.mjs
packages/dogfood/v04-heavy-negative-probe-check.mjs
packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

Do not add an eighth file. Do not change `packages/dogfood/package.json`. Run the probe and checker with `node` directly.

The first four files contain inherited approved work. Change only the SIDPROJ-96 symbols named below. Preserve all other hunks.

Do not stage this plan. Do not stage an unrelated v0.5, pack, package, document, workflow, or release-note path.

## Fresh run ledger

Start this exact ledger:

```text
correction rounds: 0/1
full evidence runs: 0/2
judge rounds: 0/2
```

Evidence run 1 is the targeted ten-capture probe. Evidence run 2 is the complete `--idle-release` capture.

Do not start Chrome before both source judges pass. If the targeted probe fails, stop. Do not use run 2 for a second targeted probe. Start the full run only after the targeted probe and independent checker pass.

Collect all P1 and P2 findings from both judges before one correction batch starts. If judge round 2 fails, stop and report the blocker.

At 90 minutes, report elapsed time, passed gates, remaining gates, and the ledger. At two hours, stop the same patch loop and reassess the model.

## `apps/workbench/src/V04Lab.tsx`

### Preserve fixture calibration inputs

Keep these SIDPROJ-95 constants exact:

```text
HEAVY_NEGATIVE_TARGET_MS = 7.4
HEAVY_NEGATIVE_MAX_ITERATIONS = 2048
HEAVY_NEGATIVE_MAX_CALIBRATION_ELAPSED_MS = 12
HEAVY_NEGATIVE_TRAILING_SAMPLE_COUNT = 3
HEAVY_NEGATIVE_MAX_PREFLIGHT_ELAPSED_MS = 50
HEAVY_NEGATIVE_TRAILING_OPERATIONS = 200
```

Keep fixture-only preflight, the detached calibration canvas, the three trailing-cost samples, the median reserve, and the product-feedback prohibition.

Keep bad and fixed heavy rows unchanged. Keep non-React rows unchanged. Keep the product threshold at `8` ms and the negative band at `[7, 8)`.

### Coherent elapsed telemetry

Change `HeavyCalibration` to keep actual elapsed time. Add this field:

```text
calibrationElapsedOverrunMs: number
```

Use these meanings:

- `calibrationElapsedMs` is the actual elapsed time after the last completed `putImageData` call.
- `calibrationElapsedOverrunMs` equals `max(0, calibrationElapsedMs - 12)`.
- Do not clamp, hide, or throw for an overrun.
- Both values must be finite and non-negative.

The loop checks the wall cap before each call. One call can start below `12` and finish above `12`. After that call, stop calibration. Record the actual elapsed and overrun. Always continue to `heavy-factor-draws`.

Always run exactly 200 trailing operations. Always run the final visible `paint()` once. Do not put either action behind an elapsed assertion.

### First true stop condition

After the loop, compute these booleans from final telemetry:

```text
budgetReached = measuredPutImageDataMs >= putImageDataBudgetMs
iterationsReached = putImageDataIterations === 2048
elapsedReached = calibrationElapsedMs >= 12
```

Select the first true condition in this exact order:

```text
budget
iterations
elapsed
```

If no condition is true, record an invalid sentinel only inside the local implementation. Do not manufacture `elapsed`. The fixture must fail before it exposes a successful completion, but it must first run the 200 operations and final paint.

The checker accepts only the three declared cap values. It rejects a record with no true stop condition.

### Slow-call counterexample

The test model must cover this exact call sequence:

```text
elapsed before call: 11 ms
elapsed after call: 13 ms
budgetReached: false
iterationsReached: false
```

The result must use `cap='elapsed'`, `calibrationElapsedMs=13`, and `calibrationElapsedOverrunMs=1`. The code must still run all 200 trailing operations and one final paint.

Do not change animation-frame waits, fixture run count, visible output, or product data.

## `packages/dogfood/v04-heavy-negative-probe.mjs`

Refactor this file into small exported functions. Keep the direct CLI under an exact `import.meta.url` main guard. Importing the module in tests must not build, start Vite, start Chrome, write evidence, or change the port.

### Exact drain state machine

Define and export `drainThenStartMeasured(driver)`. Use an injected driver with these methods:

```text
snapshotReports()
startRecording(kind)
sendDrainOperations(count)
waitForChangedReport(before, count, timeoutMs)
stopRecording(kind)
```

Use these exact states:

```text
idle
drain-started
operations-sent
report-acknowledged
drain-stopped
drain-proven
measured-started
```

Perform these transitions in order:

1. Save a deep snapshot of all current reports.
2. Call `startRecording('drain')`.
3. Send exactly `17` `clearRect` operations.
4. Wait up to `5,000` ms for one report that differs from the saved report for its canvas.
5. Require that changed report to have exactly `rasterOperationCount === 17`.
6. Call `stopRecording('drain')` once.
7. Require the stopped session to contain one window with exactly 17 raster operations.
8. Call `startRecording('measured')` only after step 7 passes.
9. Return the full transition list and drain facts.

Do not use one or a fixed number of animation frames as acknowledgement. A report that appears after more than one frame must pass inside the five-second bound.

If steps 1 through 7 fail, do not start the measured recording. If drain stop lacks the exact window, fail. No drain operation can enter the measured session.

The real Playwright driver must run `getReports()` polling in the page. It must compare each candidate with the saved report for the same canvas. It must not accept an unchanged prior 17-operation report.

### Exact drop schema

Define and export `exactZeroDrops(value)`. Require an object with exactly these eight keys:

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

Every value must be an integer equal to zero. Reject a missing object, missing key, extra key, negative value, fractional value, and nonzero value.

Use `exactZeroDrops()` before a run enters the artifact and again in the final probe exit decision. Do not use `Object.values(value ?? {})` as schema validation.

Define and export `validateProbeExit(artifact)`. Reject malformed drops, a nonempty diagnostic, an out-of-band value, a wrong run count, and saved port pollution.

Run `validateProbeExit()` before the atomic write and save its failure list. A finite out-of-band run still writes its diagnostic artifact, then the CLI exits nonzero.

A malformed schema can write only diagnostic evidence. The CLI must exit nonzero. The independent checker must reject it.

### Privacy-safe diagnostics

Keep this exact diagnostic schema:

```text
warnings
consoleErrors
pageErrors
requestFailures
instrumentationKills
unsupportedEvidence
```

A passing artifact needs six empty arrays. Do not write raw page text, input values, pixels, response bodies, raw stacks, or live objects.

Use these fixed labels for non-request failures:

```text
browser-warning
browser-console-error
browser-page-error
instrumentation-kill
unsupported-evidence
```

For a request failure, save only:

```text
<METHOD> <origin><pathname>
```

Remove query and fragment data. Bound the saved string to 500 characters. Reject `?`, `#`, control characters, or a longer string in the checker.

### Port and process ownership

Define and export `portListeners(runLsof)`. Treat `lsof` exit code `1` as an empty listener list. Propagate every other execution error.

Refuse to start when the initial listener list is not empty.

Keep Vite detached. Define ownership as:

```text
processGroup(pid) === pid
```

Change `stopOwned()` to receive an injected `isOwned` function. Use this sequence:

1. Return without a signal when the child has already exited.
2. Require ownership before `SIGTERM`.
3. Wait at most 5,000 ms.
4. Return when the child exited.
5. Recheck ownership before `SIGKILL`.
6. Wait at most 5,000 ms.
7. Fail if the child remains active.

Never signal `-pid` after an ownership check fails. Treat `ESRCH` as an already-exited process. Do not wait forever on an exited process.

### Cleanup and error precedence

Define and export one injected orchestration function, `runWithCleanup(operation, resources)`. `resources` supplies browser close, Vite stop, and live-port check functions.

The function must run cleanup after all of these failures:

- Vite readiness;
- Chrome start;
- a capture or drain;
- probe exit validation;

Use this cleanup order:

1. Close Chrome when it exists.
2. Stop Vite only after the ownership checks above.
3. Run a final live `lsof` check.
4. Require the listener list to be empty.

Run the final port proof even when browser close or Vite stop fails. Collect all cleanup errors.

Preserve the original operation error as the primary error. Append cleanup errors in cleanup order. If the operation passed, throw the first cleanup error and append later cleanup errors.

Do not put the final port proof after a rethrowing `try/finally`. Make it part of the guaranteed cleanup body.

The capture cleanup must finish before the artifact records `listenersAfter: []`. After `runWithCleanup()` returns, call a second exported wrapper, `writeWithFinalPortProof(write, checkPort)`.

`writeWithFinalPortProof()` must run the atomic write, then run another live-port proof in its guaranteed cleanup body. It must also run that proof after a write failure.

Preserve a write error as primary. Append a final-port error. This second proof does not signal a process because capture cleanup already stopped the owned Vite group.

### Safe atomic output

Define and export `writeArtifactAtomic(file, bytes, fsApi)`. Accept only:

```text
/private/tmp/sidproj-95-heavy-negative-probe.json
```

Use `mkdtemp` in `/private/tmp` with a fixed safe prefix and unpredictable suffix. Create one temporary file inside that directory with `open(..., 'wx', 0o600)`.

Before the write, use `lstat` on the final path when it exists. Reject a symbolic link or nonregular final file. Do not follow it or replace it.

Write through the exclusive file handle. Call `sync()`. Close the handle in all paths. Use `lstat` to require that the temporary path is a regular non-symbolic-link file. Rename it atomically to the final path.

Reject an injected candidate temporary path that already exists or is a symbolic link. Never use `${artifactPath}.${process.pid}`.

Remove only the temporary regular file and temporary directory that this call created. Do not traverse links. Preserve the original write error and append close or cleanup errors.

The probe writes the artifact only after all ten captures finish. It writes diagnostic evidence for finite out-of-band captures, then exits nonzero. It does not retry a capture.

## `packages/dogfood/v04-heavy-negative-probe-check.mjs`

### Fresh-time contract

Change `checkArtifact` to accept an injected fourth argument:

```text
checkArtifact(value, identity, liveListeners = [], now = Date.now())
```

Use exact canonical UTC millisecond timestamps. Require:

```text
startedAt < endedAt
endedAt - startedAt <= 10 minutes
startedAt >= now - 15 minutes
endedAt <= now + 60 seconds
```

Also reject a value when either timestamp is more than 60 seconds in the future. Tests must inject `now`; they must not depend on wall-clock time.

Reject year 2000, year 2020, year 2030, a noncanonical timestamp, equal or reversed times, and an overlong duration. Accept one current bounded run with injected `now`.

### Exact calibration schema

Add `calibrationElapsedOverrunMs` to the exact calibration keys.

Require all calibration numbers to be finite and non-negative. Keep the exact SIDPROJ-95 constants, sample count, median reserve, budget formula, iteration bound, preflight bound, and trailing facts.

Require:

```text
calibrationElapsedOverrunMs === max(0, calibrationElapsedMs - 12)
```

Do not require `calibrationElapsedMs <= 12`. The actual value can exceed 12 after one completed call.

Recompute the three stop booleans. Require the declared cap to equal the first true condition in this order:

```text
budget
iterations
elapsed
```

Reject `cap='elapsed'` when elapsed is below `12`. Reject telemetry when no stop condition is true. Reject `iterations` unless count equals `2048` and budget is false. Reject `elapsed` when budget or iterations is already true.

Accept the exact slow-call record from this plan.

### Closed artifact and identity checks

Keep exact top-level, coordinate, band, run, diagnostics, and port schemas.

Use the exact eight-key drop check for every run. Check integer zero, not truthiness or loose equality.

Keep exact identity formats and current matches:

```text
Chrome: four numeric components
Git SHA: 40 lowercase hex characters
bundle hash: 64 lowercase hex characters
harness hash: 64 lowercase hex characters
```

The CLI must recompute all four current identities. It must accept only the declared artifact path. It must reject a missing path, wrong path, final symbolic link, and nonregular final file.

Keep a live listener argument for unit tests. The CLI must also run `lsof` itself and reject any live listener.

Put the CLI read, parse, source scan, identity, and artifact checks inside an error-preserving wrapper. Always run a final live-port proof, even after any checker failure.

Keep the checker error primary. Append a port-proof error when both fail. The checker does not signal a process.

### Source token boundary

Keep all ten exact prohibited tokens:

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

Apply this scan only to `apps/workbench/src/V04Lab.tsx`. Do not expand it into a natural-language denylist.

## `packages/dogfood/v04-heavy-negative-probe-check.test.mjs`

Replace broad compound tests with explicit named tests or named subtests. One mutation must produce one assertion and one clear expected failure label.

### Current identities

Build the valid fixture with these current local values at test time:

- installed Chrome revision;
- current Git `HEAD`;
- current IIFE hash;
- current harness hash;
- an injected `now` and timestamps derived from it.

Do not hard-code Chrome `151.0.7922.137` or fake repeated hash characters.

### Direct artifact mutation matrix

Add one named test or subtest for every item:

1. Accept a complete current artifact.
2. Reject each of the nine observed-value cases from SIDPROJ-95 as applicable.
3. Reject an undershoot.
4. Reject exactly `8`.
5. Reject an overshoot.
6. Reject missing, `NaN`, `Infinity`, and `-Infinity` separately.
7. Reject a divergent `values` item.
8. Reject false minimum, maximum, and median separately.
9. Reject missing and extra top-level keys separately.
10. Reject wrong coordinate, band, and run count separately.
11. Reject missing and extra runs separately.
12. Reject duplicate, skipped, and reordered iteration numbers separately.
13. Reject an accepted-run count other than one.
14. Reject a missing drops object.
15. Reject each missing drop key through named subtests.
16. Reject one extra drop key.
17. Reject negative, fractional, and nonzero drop values separately.
18. Reject a missing and extra calibration key separately.
19. Reject every changed calibration constant separately.
20. Reject wrong sample count, non-finite sample, false median reserve, and false budget separately.
21. Reject negative and over-limit iteration counts separately.
22. Reject non-finite and negative measured time separately.
23. Reject preflight overrun.
24. Reject false elapsed-overrun math.
25. Reject `elapsed=2` with `cap='elapsed'`.
26. Reject `iterations` below 2048.
27. Reject `elapsed` when budget is already true.
28. Reject telemetry with no true cap.
29. Accept the 11-to-13-ms slow-call telemetry record.
30. Reject each of the six nonempty diagnostics separately.
31. Reject malformed request diagnostics with a query, fragment, control character, and more than 500 characters separately.
32. Reject malformed and mismatched Chrome, Git, bundle, and harness identities separately.
33. Reject saved listeners before and after separately.
34. Reject a live listener through injection.
35. Reject a stale year-2000 timestamp.
36. Reject a stale year-2020 timestamp.
37. Reject a future year-2030 timestamp.
38. Reject noncanonical, equal, reversed, and overlong timestamps separately.
39. Accept a current bounded timestamp with injected `now`.

### Direct state-machine and cleanup matrix

Use injected fakes. Do not start Chrome, Vite, or a live listener.

Add named tests for:

1. `lsof` exit code 1 returns an empty list.
2. Another `lsof` error propagates.
3. A pre-existing listener prevents start.
4. Drain follows the exact seven-state transition list.
5. A changed 17-operation report after more than one animation frame passes.
6. An unchanged prior 17-operation report does not acknowledge the drain.
7. A stopped drain without the 17-operation window fails.
8. A drain failure does not start the measured recording.
9. Measured recording starts only after drain stop and proof.
10. Drain operations do not occur after measured start.
11. An already-exited process receives no signal and no wait.
12. Missing ownership prevents `SIGTERM`.
13. Ownership loss before forced cleanup prevents `SIGKILL`.
14. `ESRCH` finishes cleanup without an unbounded wait.
15. Cleanup runs after readiness failure.
16. Cleanup runs after browser-start failure.
17. Cleanup runs after drain or capture failure.
18. Cleanup runs after probe exit validation failure.
19. Cleanup and final port proof run after write failure.
20. Browser-close failure does not skip Vite cleanup or port proof.
21. Vite-stop failure does not skip port proof.
22. An operation error remains primary and cleanup errors append in order.
23. A success with cleanup errors throws the first cleanup error.
24. Port pollution fails every path.
25. A checker read, parse, identity, or schema failure still runs the final port proof.
26. A checker error remains primary when its final port proof also fails.

### Direct disk matrix

Use a fresh test directory under `/private/tmp`. Use current identities. Do not touch the real artifact.

Add named tests for:

1. Accept one safe regular artifact.
2. Reject a wrong final path.
3. Reject a final symbolic link.
4. Reject a final directory or other nonregular file.
5. Reject a pre-created symbolic link at an injected candidate temporary path.
6. Reject a pre-existing candidate temporary regular file because `wx` fails.
7. Prove the writer does not change the link target.
8. Reject a temporary file that changes to a link or nonregular file before rename through an injected race hook.
9. Preserve the primary write error when close or temporary cleanup also fails.
10. Prove a successful write closes and syncs before rename.

### Ten direct source mutations

Use one named subtest per prohibited token. Append exactly one token to the real fixture source in memory. Require exactly that token in the result.

Do not combine the ten tokens into one loop without named subtests.

## Preserve inherited behavior

Preserve all SIDPROJ-94 and SIDPROJ-95 behavior:

- exact complete LoAF association-set equality;
- exact per-pair normalized times;
- independent document-event truth;
- current-primary lifecycle chains for rows 28, 30, and 32;
- all reconstructed live rows return `[]`;
- split-pair rejection;
- unused compressed IDAT rejection;
- all 60 named executable attacks;
- all 12 live baseline contracts;
- all 63 existing lab tests;
- exact 53 matrix rows and 20 idle rows;
- exact schemas, numeric bounds, diagnostics, drops, identities, hashes, and privacy limits;
- exact ten-file v0.4 artifact set and nine-file hash manifest;
- heavy negative diagnostics with exact observed values;
- fixture-only calibration with no product feedback;
- exactly 200 trailing operations and one final paint;
- exact ten-capture targeted artifact and independent checker.

Keep `/private/tmp/sidproj-95-heavy-negative-probe.json` separate from the inherited v0.4 artifact set. Do not add it to `evidencePaths`, `artifactPaths`, `normalPaths`, `/private/tmp/sidproj-55-sha256.txt`, or the SIDPROJ-90 release schema.

## Verification funnel

### 1. Focused source checks

Run these after each source change:

```text
node --test packages/dogfood/v04-heavy-negative-probe-check.test.mjs
pnpm --filter dogfood run lab:v0.4:test
git diff --check -- apps/workbench/src/V04Lab.tsx packages/dogfood/lab-v04-truth.mjs packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs packages/dogfood/v04-heavy-negative-probe.mjs packages/dogfood/v04-heavy-negative-probe-check.mjs packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

The new checker suite must show each mutation by name. The lab suite must pass at least 63 tests. It must run all 60 attacks and all 12 live contracts.

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

The core suite must report at least 555 passing tests. Both builds and all type checks must pass.

Check that every unrelated dirty path still matches its initial bytes. The owned diff from the baseline must contain only the seven closure paths.

### 3. Source judge gate

Run two independent judges on the same frozen source. Give each judge:

- this complete plan;
- live SIDPROJ-96 text;
- the SIDPROJ-95 plan;
- both final SIDPROJ-95 judge reports;
- the complete seven-file diff from the baseline;
- all source, state-machine, cleanup, disk, token, and mutation tests;
- the exact slow-call, stale-time, drop, listener, and link counterexamples;
- all 60 attacks and 12 live contracts;
- the current ledger.

Tell each judge to inspect all changed hunks. Each judge must return all P1 and P2 findings in one terminal report. Do not share one judge's report with the other judge.

Both judges must confirm exact drain order, cap truth, fixed trailing work, fresh time, drop schema, cleanup precedence, port proof, atomic output, diagnostic privacy, and direct mutation coverage.

Both judges must return `PASS` before Chrome.

### 4. Evidence run 1: targeted probe

After source freeze, run exactly once:

```text
node packages/dogfood/v04-heavy-negative-probe.mjs
```

This is full evidence run `1/2`. Do not retry a product failure.

Then run these checks without Chrome:

```text
node packages/dogfood/v04-heavy-negative-probe-check.mjs /private/tmp/sidproj-95-heavy-negative-probe.json
/usr/sbin/lsof -nP -iTCP@127.0.0.1:5190 -sTCP:LISTEN
shasum -a 256 /private/tmp/sidproj-95-heavy-negative-probe.json
```

Require ten finite values in `[7, 8)`. Require exact aggregates, current identities, current timestamps, exact drops, empty diagnostics, coherent cap telemetry, and an empty port.

If this gate fails, stop. Do not start the complete release capture.

### 5. Evidence run 2: complete release capture

After the targeted checker passes, run exactly once:

```text
pnpm --filter dogfood run lab:v0.4 -- --idle-release
```

This is full evidence run `2/2`. Do not start a third Chrome run.

Require all 20 idle rows, all 53 matrix rows, mutation evidence, exact hashes, current identities, empty diagnostics, zero drops, and port cleanup.

### 6. Disk checks

Run without Chrome:

```text
pnpm --filter dogfood run lab:v0.4:check
pnpm --filter dogfood run lab:v0.4 -- --check-idle-evidence
node packages/dogfood/v04-heavy-negative-probe-check.mjs /private/tmp/sidproj-95-heavy-negative-probe.json
/usr/sbin/lsof -nP -iTCP@127.0.0.1:5190 -sTCP:LISTEN
shasum -a 256 /private/tmp/sidproj-55-canvas-lab-v0.4.json /private/tmp/sidproj-55-console-summary.txt /private/tmp/sidproj-55-integrated-burst.png /private/tmp/sidproj-55-integrated-continuous.png /private/tmp/sidproj-55-mutation-output.txt /private/tmp/sidproj-55-nearest-negatives.json /private/tmp/sidproj-55-variant-matrix.json /private/tmp/sidproj-86-v04-idle-boundary.json /private/tmp/sidproj-90-v04-release-evidence.json /private/tmp/sidproj-95-heavy-negative-probe.json
```

Recompute every hash from disk. Do not trust saved hash text without disk recomputation.

### 7. Evidence judge continuations

Send fresh evidence to the same two judge streams. This continues the current judge round.

Give each judge:

- the frozen seven-file diff;
- the targeted artifact and checker output;
- all ten values and recomputed aggregates;
- the complete SIDPROJ-90 release artifact;
- all inherited v0.4 artifacts and fresh hashes;
- Chrome, Git, bundle, harness, timestamp, drop, calibration, and port facts;
- the final ledger.

Both continuations must return `PASS`.

## Closure

After all checks and judge continuations pass:

1. Check the complete worktree again.
2. Stage exactly these seven paths:

```text
git add -- apps/workbench/src/V04Lab.tsx packages/dogfood/lab-v04-truth.mjs packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs packages/dogfood/v04-heavy-negative-probe.mjs packages/dogfood/v04-heavy-negative-probe-check.mjs packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

3. Run `git diff --cached --name-only`. Require exactly the seven paths above.
4. Check the complete staged diff.
5. Create one clear signed commit with `git commit -S`.
6. Push `agent/sidproj-96-heavy-probe-state-machine`.
7. Upload `/private/tmp/sidproj-95-heavy-negative-probe.json` to SIDPROJ-96.
8. Upload `/private/tmp/sidproj-90-v04-release-evidence.json` to SIDPROJ-96.
9. Add all values, aggregates, hashes, checks, Chrome revision, commit SHA, timestamp facts, drop facts, port result, and final ledger to SIDPROJ-96.
10. Mark SIDPROJ-96 Done.
11. Add the same closure evidence to SIDPROJ-95 and mark SIDPROJ-95 Done.
12. Add the same closure evidence to SIDPROJ-94 and mark SIDPROJ-94 Done.
13. Check live Linear state before work starts on another AFK issue.

Do not ask for routine Linear approval.

## Out of scope

- Do not change Canvas Scan product timing, instrumentation, or findings.
- Do not change the `8` ms product threshold.
- Do not widen `[7, 8)`.
- Do not use product output as fixture feedback.
- Do not retry a completed capture or add longer waits.
- Do not change SIDPROJ-94 association or lifecycle logic.
- Do not weaken idle, PNG, schema, numeric, hash, file-set, or privacy checks.
- Do not change `packages/dogfood/package.json`.
- Do not change a v0.5, pack, package, document, release-note, or workflow file.
- Do not run SIDPROJ-70.
- Do not tag, publish, open a pull request, or contact an external maintainer.
