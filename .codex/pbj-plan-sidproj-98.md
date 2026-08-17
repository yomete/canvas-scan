# SIDPROJ-98 implementation contract

## Falsifiable goal

SIDPROJ-98 is complete when every owned publication path that disappears after creation returns its exact race label. Direct real-disk tests must prove each transition. Non-`ENOENT` `lstat()` errors must keep the existing error-precedence rules. All inherited source, browser, disk, evidence, judge, commit, push, and Linear gates must pass.

## Live issue and relations

- Issue: `SIDPROJ-98`, `V05-09n — Close targeted publication race labels`.
- URL: `https://linear.app/yde/issue/SIDPROJ-98/v05-09n-close-targeted-publication-race-labels`.
- Live state during planning: `In Progress` with the `AFK` label.
- Parent: `SIDPROJ-62`.
- SIDPROJ-98 has no blocker.
- SIDPROJ-98 blocks SIDPROJ-97.
- SIDPROJ-98 relates to SIDPROJ-94, SIDPROJ-95, SIDPROJ-96, and SIDPROJ-70.
- SIDPROJ-70 stays out of scope.

SIDPROJ-97 used its complete budget:

```text
correction rounds: 1/1
full evidence runs: 0/2
judge rounds: 2/2
```

One final SIDPROJ-97 judge passed. The other judge found only this P2 defect:

1. A temporary file that disappears after publication returns raw `ENOENT`, not `temporary-race`.
2. A temporary directory that disappears before cleanup returns raw `ENOENT`, not `directory-race`.
3. A final path that disappears after `link()` returns raw `ENOENT`, not `final-race`.

All three counterexamples kept unrelated paths safe. Start a new SIDPROJ-98 ledger.

## Baseline and worktree

- Branch: `agent/sidproj-98-publication-race-labels`.
- Baseline commit and current `HEAD`: `65decbced2257a3d15774423c9607e037b77e6fb`.
- Git uses SSH signing. `commit.gpgsign=true` and `gpg.format=ssh`.
- Chrome during planning: `151.0.7922.137`.
- Port `5190` had no listener during planning.
- `git diff --check` passed during planning.
- The focused probe suite passed all 173 inherited tests.
- The lab suite passed all 63 tests, all 60 attacks, and all 12 live contracts.
- The inherited core result is 555 passing tests.
- The inherited real-disk matrix has 20 passing cases.
- The inherited test-source audit passes.

The initial worktree is:

```text
## agent/sidproj-98-publication-race-labels
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

Preserve every unrelated path and byte. Do not reset, clean, stash, restore, remove, format, or stage unrelated work.

## Exact seven-file closure scope

The combined SIDPROJ-94 through SIDPROJ-98 closure owns exactly these seven files:

```text
apps/workbench/src/V04Lab.tsx
packages/dogfood/lab-v04-truth.mjs
packages/dogfood/lab-v04.mjs
packages/dogfood/lab-v04.test.mjs
packages/dogfood/v04-heavy-negative-probe.mjs
packages/dogfood/v04-heavy-negative-probe-check.mjs
packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

SIDPROJ-98 can change only these two files:

```text
packages/dogfood/v04-heavy-negative-probe.mjs
packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

Do not change the other five closure files. Their planning hashes are:

```text
d2a19749934855ccb803424072cd203a16aba77f01c418c991c92cf3ed7829dc  apps/workbench/src/V04Lab.tsx
ca1a7a66360a77e2fce4bfe42030bb1eaf5dea16ae7b1049abb59d9b804effe9  packages/dogfood/lab-v04-truth.mjs
91970eb07365ca7abe3bab79b78ab35984ba997ebead5a6d72ce3d89549f80be  packages/dogfood/lab-v04.mjs
95888d4d6cbe7d0177f3db8f476100bbdf596e9a1c20f400a0c445fb63f9d687  packages/dogfood/lab-v04.test.mjs
03dba0a389e42aa30a6394f4d1560f7aa594ac1625cca2b9ab2a08dde0ec37b0  packages/dogfood/v04-heavy-negative-probe-check.mjs
```

Save these hashes before the build. Compare them after each source batch and before staging.

Do not add an eighth closure file. Do not change `packages/dogfood/package.json`. Do not stage this plan.

## Fresh run ledger

Start with this exact ledger:

```text
correction rounds: 0/1
full evidence runs: 0/2
judge rounds: 0/2
```

A judge round contains two independent source judge streams. Each stream later checks fresh evidence.

Collect all P1 and P2 findings from both judges before one correction batch starts. Add every accepted counterexample to direct tests.

If judge round 2 fails, stop. Do not make another local patch. Reassess the evidence model and report the blocker.

Evidence run 1 is the targeted ten-capture probe. Evidence run 2 is the complete `--idle-release` capture.

Do not start Chrome before both source judges pass. Do not start a third evidence run.

At 90 minutes, report elapsed time, passed gates, remaining gates, and the ledger. At two hours, stop the same patch loop.

## Frozen behavior

Keep these inherited behaviors unchanged:

- create-once hard-link publication;
- the initial absent-final preflight;
- final-path no-replace safety;
- temporary and directory device/inode binding;
- exact modes `0700` and `0600`;
- cleanup through `unlink()` and `rmdir()` only;
- cleanup error order and the primary-error rule;
- production path isolation;
- total `validateProbeExit()` behavior and exact failure arrays;
- the complete 20-case disk matrix;
- the test-source audit;
- all product, fixture, calibration, timing, threshold, association, and lifecycle behavior;
- `[7, 8)` and the ten-capture Chrome flow;
- all diagnostics, drop, identity, hash, timestamp, privacy, ownership, and port checks;
- all inherited v0.4 evidence schemas and file sets.

Never unlink, rename, replace, chmod, follow, or remove `finalPath` on a failure path. Never use recursive or forced removal.

Keep this exact `validateProbeExit()` label order:

```text
schema
run count
runs
values
drops
diagnostics
coordinate
band
port
```

Keep these exact direct arrays:

```text
null -> ['schema', 'run count', 'runs', 'values', 'diagnostics', 'coordinate', 'band', 'port']
missing values -> ['schema', 'values']
missing runs -> ['schema', 'runs']
missing diagnostics -> ['schema', 'diagnostics']
missing droppedEntryCounts in run 1 -> ['drops']
wrong coordinate only -> ['coordinate']
wrong band only -> ['band']
wrong port only -> ['port']
runCount 9 only -> ['run count']
one value equal to 8 with matching run -> ['values']
```

Keep this exact `checkArtifact()` label order:

```text
schema
run identity
coordinate
runs
run:<iteration>
aggregates
diagnostics
identity
port
```

Keep the source audit. It permits the production path only in the exact wrapper-policy assertion. It rejects that path as a filesystem target.

Keep all 20 inherited disk cases:

1. Successful publication creates one regular final file with exact bytes.
2. The private temporary directory mode is `0700`.
3. The temporary file mode is `0600`.
4. Handle `stat` and path `lstat` use the same device and inode.
5. Sync and close occur before publication.
6. An existing final regular file fails and stays byte-identical.
7. An injected link failure keeps concurrently created final bytes.
8. An existing final symbolic link fails and preserves its target.
9. An existing final directory fails and remains present.
10. A concurrent final regular file returns `final-race` and preserves bytes.
11. A concurrent final symbolic link returns `final-race` and preserves its target.
12. A candidate temporary regular file makes `wx` fail and stays unchanged.
13. A candidate temporary link makes `wx` fail and preserves its target.
14. A changed temporary path returns `temporary-race` and preserves both inodes.
15. A changed temporary directory returns `directory-race` and preserves both directories.
16. Success removes only the exact temporary inode and private directory.
17. A cleanup failure after publication leaves final bytes unchanged.
18. Write, close, and cleanup failures keep the primary error first.
19. Failure cleanup never targets the final path.
20. A second publication fails and preserves the first bytes.

## `packages/dogfood/v04-heavy-negative-probe.mjs`

Change only `publishCreateOnce()` and a minimal local helper if the implementation needs one. Keep all other symbols byte-for-byte unchanged.

### Exact missing-path mapping

Use the existing `sameDirectory()` and `sameTemporary()` identity boundaries. Map only `error.code === 'ENOENT'` at an owned path.

- If an owned directory is missing at any check after `mkdtemp()`, return `new Error('directory-race')`.
- If an owned temporary file is missing at any check after `open()`, return `new Error('temporary-race')`.
- If `finalPath` is missing after a successful `link()`, return `new Error('final-race')`.
- Keep the initial `lstat(finalPath)` behavior. Initial `ENOENT` means that publication can start.
- Propagate every non-`ENOENT` `lstat()` error unchanged.
- Append a non-`ENOENT` cleanup error after the primary error in action order.

Do not convert a non-`ENOENT` error by its message. Check only `error.code` for `ENOENT`.

An `ENOENT`-derived race must produce one exact declared label. Do not append the same derived label again during cleanup.

The exact standalone error messages are:

```text
temporary-race
directory-race
final-race
```

When a primary error and non-`ENOENT` cleanup errors coexist, keep this existing format:

```text
<primary>; <first cleanup error>; <second cleanup error>
```

### Identity and cleanup constraints

Keep the current identity sequence:

1. Record the directory device and inode after `mkdtemp()`.
2. Record the temporary device and inode from the open handle.
3. Check the directory and temporary path before `link()`.
4. Publish with one `link(temporary, finalPath)` call.
5. Check the final device and inode after `link()`.
6. Check the temporary path before `unlink(temporary)`.
7. Check the directory before `rmdir(directory)`.

Keep cleanup bound to the recorded device and inode values. A missing owned path is a race, not successful cleanup.

If the code records that one missing path already caused the primary race label, do not retry that exact missing cleanup action. Continue only safe, independent cleanup actions.

Do not remove or change a replacement path. Keep every final path unchanged, including the surviving hard-link artifact.

## `packages/dogfood/v04-heavy-negative-probe-check.test.mjs`

Keep all 173 inherited tests. Keep the existing 20 numbered disk tests unchanged. Add direct named tests outside that matrix.

Use a fresh root from `checkedTestRoot()` for each real-disk case. Use `realFsApi()` wrappers to place the race at one exact `lstat()` call.

Do not add a production race hook. Do not touch `/private/tmp/sidproj-95-heavy-negative-probe.json` in a filesystem test.

Every new rejection test must use an `assert.rejects()` predicate. The predicate must check the complete `error.message` with `assert.equal()`.

### Missing temporary after creation

After the handle closes and before the pre-link identity check, call real `unlink(temporary)`. Then let real `lstat(temporary)` return `ENOENT`.

Require:

```text
error.message === 'temporary-race'
```

Also check that the temporary stays absent, the final stays absent, and the private directory cleanup does not change unrelated files.

### Missing temporary after publication

After the hard link succeeds, remove only `temporary`. Place this mutation immediately before the post-publication temporary identity check.

Require:

```text
error.message === 'temporary-race'
```

Check that `temporary` stays absent. Check that `finalPath` remains a regular file with the exact published bytes.

Also create an unrelated file in the test root. Check its exact bytes after the failure.

### Missing directory after creation

After `mkdtemp()` returns and before its first identity check, remove only the empty owned directory with real `rmdir()`.

Require:

```text
error.message === 'directory-race'
```

Check that the directory stays absent. Check that the final stays absent and an unrelated file stays byte-identical.

### Missing directory before cleanup

Let publication and temporary cleanup succeed. Remove only the now-empty owned directory immediately before the cleanup identity check.

Require:

```text
error.message === 'directory-race'
```

Check that the directory stays absent. Check that the final remains byte-identical and the unrelated file stays byte-identical.

### Missing final after hard link

After real `link(temporary, finalPath)` succeeds, call real `unlink(finalPath)` immediately before the final identity check.

Require:

```text
error.message === 'final-race'
```

Check that the final stays absent. Check that safe cleanup removes only the owned temporary and directory. Check that an unrelated file stays byte-identical.

### Non-`ENOENT` `lstat()` behavior

Add table-driven, one-shot failures for each identity phase:

```text
initial final preflight
directory after creation
temporary before link
final after link
temporary before cleanup
directory before cleanup
```

Use a distinct sentinel message for each phase. Do not set `code: 'ENOENT'` on a sentinel.

Each case must check the complete sentinel error message. It must also check all final, temporary, directory, replacement, and unrelated paths that exist after that phase.

Add one direct primary-error test. Make `link()` fail with `publication-primary`. Then make temporary and directory cleanup `lstat()` calls fail once with non-`ENOENT` errors.

Require this complete message and order:

```text
publication-primary; temporary-lstat-cleanup; directory-lstat-cleanup
```

Check that no removal targets `finalPath`. Manually remove only the exact test paths after all assertions pass.

The final focused test count must be greater than 173. Do not use regex-only race assertions for the new cases.

## Verification funnel

Run the gates in this order. Stop at the first product or contract failure.

### 1. Focused source checks

Run after each source change:

```text
node --test packages/dogfood/v04-heavy-negative-probe-check.test.mjs
pnpm --filter dogfood run lab:v0.4:test
git diff --check -- apps/workbench/src/V04Lab.tsx packages/dogfood/lab-v04-truth.mjs packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs packages/dogfood/v04-heavy-negative-probe.mjs packages/dogfood/v04-heavy-negative-probe-check.mjs packages/dogfood/v04-heavy-negative-probe-check.test.mjs
shasum -a 256 apps/workbench/src/V04Lab.tsx packages/dogfood/lab-v04-truth.mjs packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs packages/dogfood/v04-heavy-negative-probe-check.mjs
```

Require all inherited 173 probe tests plus all new cases. Require 63 lab tests, 60 attacks, and 12 live contracts.

Require the five frozen hashes to equal the planning hashes. Require the 20 numbered real-disk cases and test-source audit to pass.

### 2. Standard source checks

Run after focused checks pass:

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

Require at least 555 core tests. Require all workspace type checks and both builds to pass.

Check every unrelated dirty path against its initial bytes. The owned diff from the baseline can contain only the seven closure files.

### 3. Two independent source judges

Freeze the source. Give each judge these same raw inputs:

- this complete plan;
- the live SIDPROJ-98 text and relations;
- `.codex/pbj-plan-sidproj-97.md`;
- both final SIDPROJ-97 judge reports;
- the complete seven-file diff from the baseline;
- the two SIDPROJ-98 changed-file diffs;
- all missing-path counterexamples;
- all non-`ENOENT` cases and exact messages;
- the complete 20-case disk matrix;
- the test-source audit;
- pre-change and post-change frozen hashes;
- the 173-plus focused result;
- the 63 lab tests, 60 attacks, and 12 live contracts;
- the current ledger.

Do not give either judge the other judge's report. Tell each judge to check every changed hunk and test.

Each judge must return all P1 and P2 findings in one terminal report. Each judge must check exact labels, error precedence, path safety, identity binding, and frozen behavior.

Both judges must return `PASS` before Chrome starts.

If judge round 1 fails, collect both complete reports. Use one correction batch. Run all source gates again. Then start judge round 2.

If judge round 2 fails, stop and report the blocker.

### 4. Evidence run 1: targeted ten-capture probe

Use `lstat()` to check the production final path before Chrome starts:

```text
/private/tmp/sidproj-95-heavy-negative-probe.json
```

If any file type exists, stop and report it. Do not remove or replace it.

Run exactly once after both source judges pass:

```text
node packages/dogfood/v04-heavy-negative-probe.mjs
```

This changes the ledger to `full evidence runs: 1/2`.

Do not retry a product, writer, checker, or contract failure. Allow one retry only for a confirmed environment failure after its cause changes.

Run these checks without Chrome:

```text
node packages/dogfood/v04-heavy-negative-probe-check.mjs /private/tmp/sidproj-95-heavy-negative-probe.json
/usr/sbin/lsof -nP -iTCP@127.0.0.1:5190 -sTCP:LISTEN
shasum -a 256 /private/tmp/sidproj-95-heavy-negative-probe.json
```

Require ten finite values in `[7, 8)`. Require exact aggregates, drops, diagnostics, identities, timestamps, calibration, modes, hashes, and an empty port.

If this gate fails, stop. Do not start the full release capture.

### 5. Evidence run 2: complete idle-release capture

Run exactly once after the targeted probe and checker pass:

```text
pnpm --filter dogfood run lab:v0.4 -- --idle-release
```

This changes the ledger to `full evidence runs: 2/2`.

Require all 20 idle rows, all 53 matrix rows, all mutation evidence, fixed hashes, current identities, empty diagnostics, zero drops, and port cleanup.

Do not start a third Chrome run.

### 6. Disk checks

Run without Chrome:

```text
pnpm --filter dogfood run lab:v0.4:check
pnpm --filter dogfood run lab:v0.4 -- --check-idle-evidence
node packages/dogfood/v04-heavy-negative-probe-check.mjs /private/tmp/sidproj-95-heavy-negative-probe.json
/usr/sbin/lsof -nP -iTCP@127.0.0.1:5190 -sTCP:LISTEN
shasum -a 256 /private/tmp/sidproj-55-canvas-lab-v0.4.json /private/tmp/sidproj-55-console-summary.txt /private/tmp/sidproj-55-integrated-burst.png /private/tmp/sidproj-55-integrated-continuous.png /private/tmp/sidproj-55-mutation-output.txt /private/tmp/sidproj-55-nearest-negatives.json /private/tmp/sidproj-55-variant-matrix.json /private/tmp/sidproj-86-v04-idle-boundary.json /private/tmp/sidproj-90-v04-release-evidence.json /private/tmp/sidproj-95-heavy-negative-probe.json
```

Recompute every hash from disk. Do not use saved hash text as proof.

### 7. Evidence judge continuations

Send fresh evidence to the same two judge streams. This continues the open judge round.

Give each judge:

- the final frozen seven-file diff;
- both exact SIDPROJ-98 changed-file diffs;
- the targeted artifact and checker output;
- all ten values and recomputed aggregates;
- the artifact device, inode, mode, and hash;
- `/private/tmp/sidproj-90-v04-release-evidence.json`;
- all inherited v0.4 artifacts and recomputed hashes;
- Chrome, Git, bundle, harness, timestamp, drop, calibration, and port facts;
- the final run ledger.

Do not share one continuation with the other judge. Both continuations must return `PASS`.

## Closure

Start closure only after all checks and both evidence continuations pass.

1. Check the complete worktree.
2. Check the five frozen hashes again.
3. Stage exactly these seven files:

```text
git add -- apps/workbench/src/V04Lab.tsx packages/dogfood/lab-v04-truth.mjs packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs packages/dogfood/v04-heavy-negative-probe.mjs packages/dogfood/v04-heavy-negative-probe-check.mjs packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

4. Run `git diff --cached --name-only`.
5. Require exactly the seven paths above.
6. Check the complete staged diff.
7. Create one clear signed commit with `git commit -S`.
8. Push `agent/sidproj-98-publication-race-labels`.
9. Upload `/private/tmp/sidproj-95-heavy-negative-probe.json` to SIDPROJ-98.
10. Upload `/private/tmp/sidproj-90-v04-release-evidence.json` to SIDPROJ-98.
11. Add all checks, values, aggregates, hashes, Chrome revision, commit SHA, inode facts, port result, and final ledger to SIDPROJ-98.
12. Mark SIDPROJ-98 Done.
13. Add the same closure evidence to SIDPROJ-97. Mark SIDPROJ-97 Done.
14. Add the same closure evidence to SIDPROJ-96. Mark SIDPROJ-96 Done.
15. Add the same closure evidence to SIDPROJ-95. Mark SIDPROJ-95 Done.
16. Add the same closure evidence to SIDPROJ-94. Mark SIDPROJ-94 Done.
17. Check live Linear state before work starts on another AFK issue.

Do not ask for routine Linear approval.

## Out of scope

- Do not redesign `publishCreateOnce()`.
- Do not change the writer API or production path.
- Do not change `productionPublicationRequest()` or `publishProductionArtifact()`.
- Do not change `validateProbeExit()` or `checkArtifact()`.
- Do not change the independent checker.
- Do not change fixture timing, calibration, product output, findings, thresholds, association logic, or lifecycle logic.
- Do not widen `[7, 8)`.
- Do not change browser order, waits, capture count, or exit rules.
- Do not retry completed captures or add longer waits.
- Do not weaken schema, disk, hash, identity, timestamp, diagnostic, drop, port, or privacy checks.
- Do not change `packages/dogfood/package.json`.
- Do not change a v0.5, pack, package, document, release-note, or workflow file.
- Do not run SIDPROJ-70.
- Do not stage `.codex/` or `AGENTS.md`.
- Do not tag, publish, open a pull request, or contact an external maintainer.
