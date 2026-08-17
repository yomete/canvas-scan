# SIDPROJ-70 implementation contract

## Goal

SIDPROJ-70 is complete when one frozen candidate produces a checked evidence archive that passes every v0.5 mechanical gate, both performance contracts, the complete package probe, and one bounded Excalidraw run without a release action.

## Baseline

- Work in `/Users/yomi/Documents/batcave/canvas-scan`.
- Use branch `agent/sidproj-70-release-gates`.
- The baseline commit is `c6be811e026a68ba6a5879c88972e2fec5d3b56a`.
- The initial `git status --short --branch` output is:

  ```text
  ## agent/sidproj-70-release-gates
  ?? AGENTS.md
  ```

- `AGENTS.md` is a pre-existing user file. It defines the workflow for this issue. Preserve it, but do not edit, stage, hash as candidate input, or include it in SIDPROJ-70 evidence.
- `.codex/pbj-plan.md` did not exist before this plan phase. Do not edit it during the build.
- `docs/releases/v0.5.md` is the approved product and release contract. Do not change its public API, limits, thresholds, or evidence boundary.
- The bottom status in `CODEX_REVIEW.md` is `CODEX_STATUS: APPROVED`. Do not append to this log during the build.
- The current focused baseline passed:

  ```text
  pnpm --filter canvas-scan exec vitest run test/pack-manifest.test.ts
  # 19 tests passed

  pnpm --filter dogfood run lab:v0.5:test
  # 50 tests passed

  pnpm --filter dogfood run release:v0.4:test
  # 28 tests passed

  git diff --check
  # exit 0
  ```

- No `bench:v0.5:chrome`, v0.5 release runner, v0.5 Excalidraw runner, v0.5 report, release-note draft, or human-test file exists.

## Preflight state

- Google Chrome exists at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` and reports `151.0.7922.137`.
- `pnpm`, `node`, `git`, `lsof`, `shasum`, and `tar` exist.
- Ports `4385`, `5199`, `5209`, `5210`, and `5211` had no listeners during planning.
- Port `5199` belongs to the existing passive benchmark. Use port `5210` for the v0.5 benchmark. Use port `4385` for Excalidraw.
- The reference Excalidraw revision is `219571a7187651c79648de08c9a98a3b2f7f607a`.
- `packages/dogfood/results/2026-08-07-excalidraw-v04-post-release.json` passed against that revision. It contains two `repeated-draw-work` findings for owner `StaticCanvas`, at indexes `0` and `1`.
- Git uses SSH signatures. `commit.gpgsign=true`, `gpg.format=ssh`, and the baseline signature is good. This issue does not sign or commit anything.
- The raw evidence upload changes external state. The build only makes a local, hashed archive ready for upload. The root workflow performs any Linear upload after review and under the active system gate.
- Excalidraw setup needs GitHub and Yarn network access. Package probes can need npm network access. Classify a DNS, connection, registry, cache-permission, browser-launch, port-ownership, or fixture-timeout error as `ENVIRONMENT_FAILURE`.
- Do not classify a threshold breach, malformed artifact, privacy leak, missing field, changed hash, or failed assertion as an environment failure.

## Finite evidence contract

Use `/private/tmp/sidproj-70-release-evidence` as the only passing final evidence directory. Each invocation must first create a unique `/private/tmp/sidproj-70-release-attempt-<run-id>` directory with exclusive semantics. It must fail if the final directory already exists. Do not remove or replace prior evidence automatically.

On success, atomically rename the owned attempt directory to the final directory. On `PRODUCT_FAILURE`, leave the attempt directory in place and stop. On the first `ENVIRONMENT_FAILURE`, leave the attempt directory in place, write its exact path and recursive manifest hash to `environment-retry.json`, and print that path. A second invocation may discover exactly one prior attempt for the same frozen candidate only when it ended as `ENVIRONMENT_FAILURE`. It must record the prior error, the checked environment condition before each run, and the changed condition in the final evidence. Reject a prior product failure, another candidate hash, more than one failed attempt, or an unchanged environment condition. Do not permit a third invocation.

The root directory must contain only these entries:

```text
candidate.json
environment-retry.json
commands.json
command-output/
bench-v04/
bench-v05/
lab-v04/
lab-v05/
pack/
excalidraw/
release-notes.md
human-test.md
gate.json
evidence-sha256.txt
```

Each child checker owns its exact subtree. The root checker must reject a missing or extra root entry. It must reject symlinks, non-regular files outside declared directories, traversal, duplicate paths, duplicate hash rows, stale candidate hashes, and hash mismatches.

`evidence-sha256.txt` must contain one sorted SHA-256 row for every regular file except itself. Recompute all hashes from disk after all commands finish. Do not accept a hash copied from product output.

`candidate.json` must contain:

- `schemaVersion: 1` and `issue: "SIDPROJ-70"`.
- Exact `gitSha`, branch, package version, dirty state, and the full `git status --porcelain=v1 --untracked-files=all` list.
- `AGENTS.md` as the sole pre-existing excluded path.
- The sorted implementation file list and one SHA-256 hash per file.
- The production IIFE, ESM entry, declaration, pack harness, passive benchmark harness, v0.5 benchmark harness, release runner, and Excalidraw harness hashes.
- The tarball hash after pack verification.
- The Chrome revision and host CPU facts from the actual run.

`environment-retry.json` must always exist. With no retry, it contains exact `attemptCount: 1`, `status: "not-used"`, and null prior-failure fields. After the one permitted retry, it contains exact `attemptCount: 2`, `status: "used"`, the prior attempt path and recursive manifest hash, the exact environment error, the checked condition before each attempt, and the changed condition. It must never classify a product failure as retryable.

The implementation scope allowlist is exact:

```text
apps/workbench/public/bench-v05.html
docs/releases/v0.5-human-test.md
docs/releases/v0.5-release-notes.md
packages/core/test/pack-manifest.test.ts
packages/dogfood/bench-v05-chrome.mjs
packages/dogfood/bench-v05-chrome.test.mjs
packages/dogfood/excalidraw-v05.mjs
packages/dogfood/excalidraw-v05-truth.mjs
packages/dogfood/excalidraw-v05-truth.test.mjs
packages/dogfood/lab-v05.mjs
packages/dogfood/lab-v05-truth.mjs
packages/dogfood/lab-v05.test.mjs
packages/dogfood/package.json
packages/dogfood/release-v05.mjs
packages/dogfood/release-v05.test.mjs
packages/dogfood/v05-bench-diagnostic.ts
scripts/pack-manifest.mjs
scripts/verify-pack.mjs
```

The scope checker must reject another changed path. Treat `.codex/pbj-plan.md` and the pre-existing `AGENTS.md` as exact workflow exclusions. Treat `docs/releases/v0.5-report.md` as a derived report exclusion only after the passing runner creates it. Record and hash that report separately from candidate input.

`commands.json` must contain one ordered record per mechanical command. Each record must contain the exact command, class, start and end time, exit code, status, stdout artifact path, and stderr artifact path. The allowed status enum is `PASS`, `PRODUCT_FAILURE`, or `ENVIRONMENT_FAILURE`.

Keep expected truth in repository fixtures and checker allowlists. Do not read expected values from browser globals, product-visible text, or actual result files. Reject extra fields in new machine-owned schemas. Do not add a natural-language denylist. For release notes, compare normalized Markdown with the exact approved section and bullet allowlists in the checker.

## Changes

### `packages/dogfood/v05-bench-diagnostic.ts`

- Add a diagnostic-only entry point. Follow `command-capture-diagnostic.ts`.
- Start Canvas Scan with `captureEvery: 1` and `overlay: false`.
- Expose one test global for the harness. It must return and reset these internal counters:
  - `commandEntryAllocations`, from `getCommandEntryAllocationCount()`.
  - `stackAllocations`, from `getDrawCallsiteTestCounts().stackAllocations`.
- Expose only the functions needed to reset and read the counters.
- Do not export this global from `packages/core/src/index.ts`.
- Do not include this diagnostic entry in the package tarball.

### `apps/workbench/public/bench-v05.html`

- Add a fixed benchmark page for `1000` simple `fillRect` calls per measured frame.
- Load only the diagnostic bundle that the v0.5 benchmark serves.
- Support these exact modes: `v04-full`, `v05-no-selection`, and `v05-selected`.
- Before measurement, make one repeated-draw source finding on the measured canvas. Use the same prelude for all modes.
- `v04-full` and `v05-no-selection` keep normal full recording active and do not start an explanation.
- `v05-selected` calls `startExplanation()` with the explicit source session ID and finding index.
- Warm the JavaScript and Canvas2D path before the harness resets structural counters. Do not consume selected explanation entries during the warm-up.
- After the reset, measure exactly four frames. This stores at most `4000` selected command entries and stays below the fixed `5000` command limit.
- Publish only this bounded state through `window.__BENCH_V05__`: mode, done, four frame durations, source finding index, explanation start result, counter values before and after the four frames, diagnostics, and stop result.
- Stop the active recording or explanation after the fourth frame. Do not include setup time or stop time in a frame duration.
- Fail the page state if the source finding is absent, the start result is not `started`, the sample count differs, or any timed frame has a non-finite duration.

### `packages/dogfood/bench-v05-chrome.mjs`

- Add the `bench:v0.5:chrome` real-Chrome gate. Use port `5210` with `--strictPort` and the owned-listener checks from `bench-chrome-interleaved.mjs`.
- Build the diagnostic IIFE in a temporary evidence location. Serve the diagnostic bundle and `bench-v05.html` without changing a tracked public bundle.
- Use Google Chrome headless through `playwright-core` with `channel: "chrome"`.
- Run `20` complete pairs. Alternate order on each pair:
  - even pair: `v04-full`, then `v05-selected`;
  - odd pair: `v05-selected`, then `v04-full`.
- Open a fresh page for each variant. Collect exactly four finite frame samples from each page. Do not discard or replace a sample.
- Run one separate `v05-no-selection` page before the pairs.
- Define a stable run mechanically as all `20` pairs complete, both orders occur `10` times, all pages report four samples, Chrome and port ownership stay unchanged, and diagnostics stay empty.
- Compute each of the `80` aligned selected-minus-full frame deltas.
- Gate the arithmetic mean of those deltas with strict `< 4 ms`.
- Gate the nearest-rank p95 of those deltas with strict `< 8 ms`.
- Preserve negative deltas. Do not clamp them to zero.
- The `v05-no-selection` page must report exact deltas of `0` for both `commandEntryAllocations` and `stackAllocations`.
- Every selected page must report positive command allocations and at least one stack allocation. This prevents a vacuous performance pass.
- Record absolute v0.4 full and selected samples, all pair orders, all paired deltas, structural counters, thresholds, Chrome revision, hardware, Git SHA, dirty state, and all relevant hashes.
- Write one immutable JSON artifact under `/private/tmp` and print its exact path.
- Return nonzero for an incomplete run, a structural counter failure, a changed threshold, or either performance threshold failure.
- Export pure summary and check functions for focused tests. Keep process work behind the main-module guard.

### `packages/dogfood/bench-v05-chrome.test.mjs`

- Test the exact `20`-pair alternating order and `80`-delta requirement.
- Test mean and nearest-rank p95 with values that distinguish them from median or aggregate subtraction.
- Test strict boundaries. Exact `4` mean and exact `8` p95 must fail.
- Test a passing negative delta without clamping.
- Test zero no-selection command and stack counters.
- Add explicit counterexamples for nonzero no-selection commands and nonzero no-selection stacks.
- Add explicit counterexamples for a selected path with zero commands or zero stacks.
- Test missing pairs, missing samples, non-finite samples, changed order, diagnostics, changed hashes, and changed thresholds.
- Test product and environment result classes separately. A threshold failure is always `PRODUCT_FAILURE`.

### `packages/dogfood/package.json`

- Add `bench:v0.5:chrome` as `node bench-v05-chrome.mjs`.
- Add a focused test script for the v0.5 benchmark and release checker if it reduces command ambiguity.
- Add `release:v0.5` as the single frozen-tree evidence command: `node release-v05.mjs`.
- Do not change dependencies unless the current `playwright-core` package cannot run the new harness.

### `scripts/pack-manifest.mjs`

- Replace the partial operation check with exact repository-owned allowlists for all public packed surfaces.
- Require these ESM runtime exports: `start`, `getReports`, `startRecording`, `stopRecording`, `getLastSession`, `mark`, `startExplanation`, `stopExplanation`, `getLastExplanation`, and `compareSessions`.
- Require these IIFE fields: `version`, `getHistory`, `getReports`, `startRecording`, `stopRecording`, `mark`, `getLastSession`, `startExplanation`, `stopExplanation`, `getLastExplanation`, and `compareSessions`.
- Require every type that `packages/core/src/index.ts` exports:

  ```text
  AttributionKind
  CanvasMethodEvidence
  CanvasScanOptions
  DrawBatchReport
  SignatureStatus
  SourceLocation
  InvestigationSessionV1
  RecordedCanvasSummary
  RecordedCanvasWindow
  RecordedCanvasGeometry
  CanvasGeometryUnavailableReason
  RecordedResetEvent
  CanvasResetSource
  CanvasLifecycleEventType
  RecordedCanvasLifecycleEvent
  RecordedDrawEpisode
  RecordedEpisodeCanvasSummary
  RecordedTopMethod
  HeavyCanvasWorkFinding
  InvestigationFinding
  RepeatedDrawWorkFinding
  ResizeChurnFinding
  BackingStoreMismatchFinding
  RecordedRepeatedWindow
  RecordingState
  RecordingStopReason
  RecordedDocumentEvent
  RecordedEventTiming
  RecordedUserMark
  RecordedLongAnimationFrameScript
  RecordedLongAnimationFrame
  RecordedBrowserEvidenceEntry
  RecordedEpisodeAssociation
  ExplanationSelection
  ExplanationStartResult
  ExplanationUnknownReason
  NormalizedCommandArgument
  NormalizedCanvasCommand
  ExplanationCommandWindow
  CommandDifference
  ExplanationWindowComparison
  ExplanationStackFrame
  ExplanationStackSample
  ExplanationLimitName
  ExplanationLimitReason
  ExplanationLimitCoordinate
  ExplanationLimitResult
  ExplanationCallsiteLimitReason
  ExplanationCallsiteCoverage
  ExplanationArtifactV1
  SessionFindingPairing
  ComparisonMeasureId
  ComparisonMeasure
  ComparisonFindingRef
  ComparisonArtifactV1
  ```

- Parse export syntax, including `export type { ... }`. Do not pass because a name only appears in text.
- Keep the fixed tarball manifest, one shared chunk rule, version checks, and lab-boundary checks.
- Export the exact allowlists for tests and for pack evidence.

### `packages/core/test/pack-manifest.test.ts`

- Update fixtures for the complete runtime, IIFE, and type allowlists.
- Add one missing-name counterexample for each result class: ESM runtime, IIFE runtime, and type declaration.
- Test `getReports`, `getHistory`, one v0.4 type, and each v0.5 type family directly.
- Test that an identifier declaration without an export does not pass.
- Keep all current manifest, version, and lab-boundary regressions.

### `scripts/verify-pack.mjs`

- Keep the current clean `pnpm pack`, manifest, version, Vite, Next, manual browser, and lab-boundary checks.
- Add one isolated clean install and import probe in a fresh temporary directory.
- Install only the generated tarball plus TypeScript when the type probe needs it. Never import from the workspace source.
- In Node ESM, import `canvas-scan` from the installed tarball and assert every ESM runtime export from the exact allowlist.
- Compile a generated TypeScript file with `tsc --noEmit`. It must use an `import type` for every public type in the exact allowlist.
- Read the installed declaration files and run the same exported-type check against them.
- Keep the IIFE surface check against the tarball bytes.
- Record the tarball hash, manifest, declaration hashes, exact runtime and type name lists, install command, import command, typecheck command, and each probe result in `/private/tmp/sidproj-70-pack-summary.json`.
- Add no fallback to workspace imports. A missing packed API or type is a product failure.
- Keep network, npm cache, and clean-fixture errors separate in `environmentErrors`.

### `packages/dogfood/excalidraw-v05-truth.mjs`

- Define and export the exact external evidence schema and checker.
- Bind all evidence to Excalidraw revision `219571a7187651c79648de08c9a98a3b2f7f607a`, the frozen Git SHA, the production IIFE hash, Chrome revision, and the v0.4 post-release artifact hash.
- Require one baseline source session, one bounded explanation, one candidate session, and one comparison artifact.
- Require the selected baseline and candidate findings to have type `repeated-draw-work` and owner `StaticCanvas`.
- Require `compareSessions()` to receive the recorded explicit baseline and candidate indexes. Reject automatic pairing or a type mismatch.
- Accept the explanation command result only from `same`, `changed`, or `unknown`.
- For `unknown`, require the exact public unknown reason and preserve `firstGap` and all drop counts.
- Accept callsite mapping only as `mapped` or `unresolved`. For `unresolved`, require its exact public reason. Do not infer a source location.
- Require `improvementEstablished: false` and measured-pair language only.
- Require exact commands, all raw artifacts, diagnostics, drop counts, browser revision, Git and package hashes, interaction facts, and a recursive hash manifest.
- Accept useful evidence, an honest `unknown`, or an honest unavailable map. Do not require a controlled Excalidraw product result.
- Reject extra schema keys and files. Keep approved machine labels in exact allowlists.

### `packages/dogfood/excalidraw-v05-truth.test.mjs`

- Build valid in-memory fixtures without product output as truth.
- Add one counterexample for each external result class:
  - change `same` to `changed` without matching raw commands;
  - change `unknown` to a known result;
  - change `unresolved` to `mapped` without a mapped location;
  - remove an unresolved reason;
  - change a same-type pair to different types;
  - set `improvementEstablished` to true.
- Reject missing or extra artifacts, commands, hashes, diagnostics, drop counts, browser revision, and raw files.
- Reject a mismatched Excalidraw revision or v0.4 reference hash.
- Reject a claim that Excalidraw proves a product result, cause, fix, speedup, or improvement.
- Implement the claim check through exact accepted report fields and values. Do not grow a free-text denylist.

### `packages/dogfood/excalidraw-v05.mjs`

- Run exactly one bounded external acceptance flow against the pinned revision.
- Create a new disposable checkout under `/private/tmp/sidproj-70-excalidraw-*`. Reject a reused path, symlink, wrong revision, or existing port listener.
- Fetch only the pinned revision. Apply the same disposable workspace and early-IIFE changes that `excalidraw-v04.mjs` records. Do not change the Canvas Scan repository.
- Copy the frozen production IIFE into the disposable app. Record its SHA-256 hash before the server starts.
- Start Excalidraw at `127.0.0.1:4385`. Check listener ownership before and after readiness.
- Record a fresh source session with the existing rectangle, rectangle, and pan scenario.
- Select one explicit `StaticCanvas` `repeated-draw-work` finding. Record the index and source canvas ID.
- Start one explanation for that exact finding. Perform one bounded pan interaction. Stop the explanation before ten seconds.
- Record the command comparison result, first difference, all windows, bounded callsite state, map status, limits, first gap, and all drop counts.
- Record a second session with the same explicit interaction when Excalidraw permits it.
- Select one explicit `StaticCanvas` `repeated-draw-work` finding in the second session.
- Call `compareSessions()` with the two recorded indexes. Require a same-type explicit pair, but do not require a direction or improvement.
- Record console warnings, console errors, page errors, failed requests, server errors, instrumentation state, Chrome revision, exact commands, Git SHA, Excalidraw revision, package and harness hashes, screenshots, and raw JSON.
- Run `excalidraw-v05-truth.mjs` from disk after browser close. The checker, not the browser script, decides acceptance.
- Always close Chrome and the owned server. Never kill a process that the harness does not own.
- Classify clone, install, browser launch, port, or server errors as `ENVIRONMENT_FAILURE`. Preserve the exact error.
- Do not contact Excalidraw maintainers. Do not upload anything.

### `packages/dogfood/lab-v05.mjs`

- During `SIDPROJ_70_RELEASE=1`, reuse the fresh v0.4 evidence that the preceding mechanical command produced.
- Run the copied v0.4 checker once. Do not run the v0.4 browser lab again and do not use its three-attempt child retry.
- Keep the standalone v0.5 lab command unchanged outside this release-run environment.
- Update the v0.5 truth checker and focused test so the recorded command list and release-mode field remain exact in both modes.

### `packages/dogfood/release-v05.mjs`

- Add the complete mechanical and evidence runner. Use `release-v04.mjs` only as a style and fail-closed reference.
- Export pure command classification, candidate identity, artifact checks, and final gate evaluation for tests.
- Use the exact mechanical command order from `docs/releases/v0.5.md`:

  ```text
  pnpm -r run typecheck
  pnpm --filter canvas-scan run test
  pnpm --filter canvas-scan run build
  pnpm --filter demo run build
  pnpm --filter dogfood run lab:v0.4
  pnpm --filter dogfood run lab:v0.5
  pnpm --filter dogfood run bench:chrome
  pnpm --filter dogfood run bench:v0.5:chrome
  node scripts/verify-pack.mjs
  git diff --check
  ```

- Capture stdout and stderr for each command without changing command text.
- Stop immediately after a product threshold failure. Do not run another benchmark and do not use a fallback threshold.
- After all mechanical commands pass, run the Excalidraw command once.
- Copy source artifacts into the exact evidence tree. Run each existing disk checker against the copied artifact, not the original path.
- Run the new package, benchmark, Excalidraw, document, root-manifest, candidate-identity, and scope checks from disk.
- Treat `AGENTS.md` as the exact one-item pre-existing exclusion. Fail if another unrelated path appears.
- Create all output in the unique attempt directory. Promote it atomically to `/private/tmp/sidproj-70-release-evidence` only after every disk check passes.
- Preserve a failed attempt. Permit one retry only when the prior attempt records `ENVIRONMENT_FAILURE`, the frozen candidate hashes match, and the named environment condition changed.
- Require all mechanical commands to pass. Require both passive streams to pass their published strict limits.
- Require the v0.5 selected mean and p95 gates, zero no-selection counters, complete pack API and type probes, and the external contract.
- Record all product failures and environment failures in separate arrays. Do not convert one class to the other.
- Write `gate.json` and `docs/releases/v0.5-report.md` only after the disk checks pass.
- The runner must not sign, stage, commit, tag, push, publish, upload, or update Linear.

### `packages/dogfood/release-v05.test.mjs`

- Assert the exact ten-command mechanical list and order.
- Assert the exact evidence root allowlist and candidate scope allowlist.
- Test all strict passive and selected performance boundaries.
- Test zero no-selection counters and non-vacuous selected counters.
- Test complete runtime and type pack results.
- Test honest external `unknown` and `unresolved` results as accepted external evidence.
- Test a product threshold failure as a stop condition.
- Test every environment error family separately.
- Test missing, stale, extra, linked, and hash-mismatched evidence.
- Test that a changed candidate file, browser revision, package hash, or harness hash fails.
- Test that a failed command cannot pass because a copied artifact says `PASS`.
- Test that signing, publish, tag, upload, or Linear commands are not in the command set.

### `docs/releases/v0.5-release-notes.md`

- Add a draft only. Title it `canvas-scan v0.5.0 release notes (draft)`.
- Use only these fact groups:
  - one selected-canvas explanation for the next interaction, bounded to ten seconds;
  - the first normalized command difference, no observed difference, or honest unknown;
  - bounded generated and same-origin mapped callsite evidence;
  - explicit same-type finding comparison with measured pair deltas;
  - versioned JSON explanation and comparison artifacts;
  - unchanged v0.4 recording API and full passive performance gates.
- State these limits:
  - no pixel, GPU, compositor, causal, automatic-match, or improvement proof;
  - no cross-origin source-map fetch;
  - selected detail only, with fixed collection limits.
- Mark the text as a draft. Do not state that v0.5 is signed, tagged, published, released, fixed, faster, or improved.
- Do not add benchmark numbers to public claims. Keep measurements in the evidence report.

### `docs/releases/v0.5-human-test.md`

- Write the exact pre-publication human test from `docs/releases/v0.5.md`.
- State the prerequisites: use the exact tarball hash from `gate.json`, real Chrome, no publication credentials, and a clean disposable consumer.
- Give eight numbered checks:
  1. the finding has `Explain next interaction`;
  2. the ten-second boundary and active state are clear;
  3. the command result gives a difference, honest absence, or honest unknown without raw values;
  4. the callsite is useful when mapped and honest when unresolved;
  5. baseline selection and explicit finding pairing are clear;
  6. comparison text uses measured-pair language and makes no improvement claim;
  7. explanation and comparison JSON copy works;
  8. normal recording works after explanation stops.
- Give exact PASS and FAIL recording fields. A person must record Chrome revision, tarball hash, each step result, notes, and final decision.
- State that V05-10 owns this human run, signing, authentication, tag creation, publication, and final release approval.

### `docs/releases/v0.5-report.md`

- Generate a review-ready report from checked disk evidence.
- Include candidate identity, exact commands and statuses, passive benchmark values, selected paired values, structural counters, pack results, Chrome revision, diagnostics, drop counts, Excalidraw indexes and statuses, raw artifact paths and hashes, release-note hash, human-test hash, and the run ledger.
- Label Excalidraw results as external observations. State that they are not controlled truth.
- If the external result is `unknown` or the map is unavailable, show the exact reason without changing the gate meaning.
- Include no release-complete, cause, fix, speedup, regression, or improvement claim.
- State that raw local evidence does not prove a successful Linear attachment.

## Constraints

- Follow `AGENTS.md`, `CLAUDE.md`, and `docs/releases/v0.5.md`.
- Match the current flat function and Node ESM style. Reuse current hash, path, server-ownership, evidence-checker, and process helpers.
- Keep expected truth outside product output.
- Keep detailed command and stack capture off the global passive path.
- Do not change core product behavior or public types for this release-evidence issue.
- Do not change the fixed limits or strict comparisons.
- Do not add a fallback for a failed product gate.
- Do not add retry loops inside child harnesses.
- The release runner permits one environment retry only at the root workflow level.
- Before that retry, preserve the first failed evidence and record the exact environment error.
- Change the environment condition before retry. Examples are a cleared owned port, restored network, or changed fixture timing after a recorded timeout.
- Keep the candidate Git SHA and every product and harness hash identical across an environment retry.
- Use a unique attempt directory for each invocation. Never remove, overwrite, or promote a failed attempt.
- Treat a second environment failure as a harness defect. Stop without a third full run.
- At 90 minutes, report elapsed time, passed gates, remaining gates, and the ledger.
- At two hours, stop the same patch loop. Diagnose the evidence model or report the blocker.
- Stop and ask for a product decision if any fixed threshold fails. Never weaken the gate.

## Verification funnel

Run commands from `/Users/yomi/Documents/batcave/canvas-scan`.

Initial ledger:

```text
correction rounds: 1/1
full evidence runs: 0/2
judge rounds: 1/2
```

### Focused commands

Run these during implementation. They do not consume a full evidence run.

```text
pnpm --filter canvas-scan exec vitest run test/pack-manifest.test.ts
pnpm --filter dogfood exec node --test bench-v05-chrome.test.mjs
pnpm --filter dogfood exec node --test excalidraw-v05-truth.test.mjs
pnpm --filter dogfood exec node --test release-v05.test.mjs
pnpm --filter dogfood run lab:v0.5:test
```

Expected result: all tests pass. Each new result class has at least one mutation that the checker rejects.

### Standard commands

Run these after focused checks. They do not consume a full evidence run.

```text
pnpm -r run typecheck
pnpm --filter canvas-scan run test
pnpm --filter canvas-scan run build
pnpm --filter demo run build
git diff --check
git status --short
git diff --stat
```

Expected result: all commands pass. `git status --short` contains only the planned SIDPROJ-70 files, `.codex/pbj-plan.md`, and the preserved `AGENTS.md`.

### Expensive child commands

These commands are expensive. Do not run them separately during the build phase.

```text
pnpm --filter dogfood run lab:v0.4
pnpm --filter dogfood run lab:v0.5
pnpm --filter dogfood run bench:chrome
pnpm --filter dogfood run bench:v0.5:chrome
node scripts/verify-pack.mjs
node packages/dogfood/excalidraw-v05.mjs
```

The frozen-tree release runner invokes and records them once. One top-level `release:v0.5` invocation counts as one full evidence run.

### Judge round 1

After focused and standard checks pass, freeze the source. Give the judge the plan, complete diff, exact counterexample corpus, and current source. Ask for all P1 and P2 findings in one report.

If the judge finds an accepted issue, make one complete correction batch. Add each counterexample to focused and disk mutation tests. Update the ledger to `correction rounds: 1/1` and `judge rounds: 1/2`.

### Full evidence run 1

Run only after the source freezes and judge round 1 completes:

```text
pnpm --filter dogfood run release:v0.5
```

Expected result:

- All ten mechanical command records are `PASS`.
- Passive v0.4 mean and p95 results pass the published strict limits.
- No-selection command and stack allocation deltas are exactly zero.
- Selected detail reports positive counters and adds `< 4 ms` mean and `< 8 ms` p95.
- The clean tarball import and type probe contains every allowed API and type.
- The bounded Excalidraw run records an explicit same-type pair and honest mapping and command states.
- `/private/tmp/sidproj-70-release-evidence/gate.json` reports `mechanicalPass: true` and `pass: true`.
- The ledger becomes `full evidence runs: 1/2`.

If this run has a product failure, stop. Do not retry it.

If this run has one confirmed environment failure, preserve it. Change the named environment condition, then run the exact command once more. Update the ledger to `full evidence runs: 2/2`. Do not run a third time.

### Independent disk checks

After the full run, check the copied evidence without a browser:

```text
node packages/dogfood/bench-v05-chrome.mjs --check-evidence /private/tmp/sidproj-70-release-evidence/bench-v05/result.json
node packages/dogfood/excalidraw-v05-truth.mjs --check-evidence /private/tmp/sidproj-70-release-evidence/excalidraw
node packages/dogfood/release-v05.mjs --check-evidence /private/tmp/sidproj-70-release-evidence
shasum -a 256 -c /private/tmp/sidproj-70-release-evidence/evidence-sha256.txt
git diff --check
```

Expected result: every checker prints its exact PASS marker, all hashes pass, and `git diff --check` returns zero.

### Judge round 2

Give a fresh judge the raw plan, complete diff, complete adversarial corpus, final evidence directory, and hashes. Do not give it the first judge's conclusions. Require all P1 and P2 findings in one terminal report.

The final ledger must be:

```text
correction rounds: 0/1 or 1/1
full evidence runs: 1/2 or 2/2
judge rounds: 2/2
```

If judge round 2 fails, do not patch one phrase or case at a time. Reassess the evidence model and report the blocker.

## Out of scope

- Do not edit or include `AGENTS.md`.
- Do not change the v0.5 public API, artifact schemas, limits, privacy boundary, selected-canvas boundary, pairing rule, or product claims.
- Do not change the core recording, explanation, comparison, overlay, command-capture, or draw-callsite behavior unless a focused test proves a release-gate instrumentation defect. Stop for scope approval in that case.
- Do not change the package version in this issue.
- Do not run the V05-10 human test.
- Do not sign, stage, commit, tag, push, publish, create a release, or create a pull request.
- Do not authenticate to npm or use publication credentials.
- Do not update Linear or upload evidence during the build.
- Do not contact Excalidraw maintainers.
- Do not treat Excalidraw as controlled truth.
- Do not add remote artifact upload, persistent storage, cross-origin source-map fetch, pixel capture, or GPU timing.
- Do not clean unrelated files or old `/private/tmp` evidence.
