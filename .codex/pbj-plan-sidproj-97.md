# SIDPROJ-97 implementation contract

## Falsifiable goal

SIDPROJ-97 is complete when create-once publication cannot replace any existing final path or publish a changed temporary inode. Unit tests must use only fresh test roots. `validateProbeExit()` must return exact failure arrays without throwing for all JSON-compatible input.

## Live issue and baseline

- Linear issue: `SIDPROJ-97`, `V05-09m — Make targeted evidence publication create-once`.
- URL: `https://linear.app/yde/issue/SIDPROJ-97/v05-09m-make-targeted-evidence-publication-create-once`.
- Live state during planning: `In Progress` with the `AFK` label.
- The issue has no blocker and no comments.
- SIDPROJ-97 blocks SIDPROJ-96.
- SIDPROJ-97 relates to SIDPROJ-95 and SIDPROJ-70.
- Branch: `agent/sidproj-97-create-once-evidence`.
- Baseline commit and current `HEAD`: `65decbced2257a3d15774423c9607e037b77e6fb`.
- `git diff --check` passes.
- The current probe suite passes 145 tests.
- The current lab suite passes 63 tests, all 60 attacks, and all 12 live contracts.
- Chrome during planning: `151.0.7922.137`.
- Port `5190` had no listener during planning.
- Git uses SSH signing. `commit.gpgsign=true` and `gpg.format=ssh`.

The initial worktree is:

```text
## agent/sidproj-97-create-once-evidence
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

## Final SIDPROJ-96 reports

SIDPROJ-96 stopped before Chrome with this ledger:

```text
correction rounds: 1/1
full evidence runs: 0/2
judge rounds: 2/2
```

### Judge B

Judge B found two P1 and several P2 defects:

- P1: `writeArtifactAtomic()` unlinks an existing regular final path before `link()`. A failed publication loses the old artifact.
- P1: two unit tests write, link, and unlink the real evidence path.
- P2: a final path can appear after the first check. Current unlink-and-link behavior can replace it.
- P2: a temporary path can change after `lstat` and before `link`.
- P2: many mutation tests check only that failures are nonempty.
- P2: direct cases are missing for candidate temporary regular files, candidate links, delayed reports, and exact labels.

Judge B confirmed the real page report unwrap, native cleanup, probe-exit schemas, ownership `ESRCH`, and checker port proof.

### Judge A

Judge A found five P2 defects:

- A temporary path replacement can make publication hard-link the wrong inode.
- An injected publication failure after an existing final removal loses old bytes.
- Unit tests touch the real evidence path.
- `validateProbeExit()` records a missing `values` error, then indexes `artifact.values` and throws `TypeError`.
- Mutation tests assert only a nonempty failure list.

Judge A called unlink-and-link a plan deviation. SIDPROJ-97 resolves this with create-once publication to an absent final path. It never unlinks or replaces the final path.

## Exact seven-file closure scope

Only these seven files belong to the combined SIDPROJ-94 through SIDPROJ-97 closure:

```text
apps/workbench/src/V04Lab.tsx
packages/dogfood/lab-v04-truth.mjs
packages/dogfood/lab-v04.mjs
packages/dogfood/lab-v04.test.mjs
packages/dogfood/v04-heavy-negative-probe.mjs
packages/dogfood/v04-heavy-negative-probe-check.mjs
packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

Do not add an eighth file. Do not change `packages/dogfood/package.json`.

SIDPROJ-97 changes only the writer, production wrapper, probe-exit validator, and their tests in the final three files. Keep the first four files byte-for-byte frozen from the current branch. Keep all unrelated symbols in the last three files unchanged.

Do not stage this plan. Do not stage an unrelated v0.5, pack, package, document, workflow, or release-note path.

## Fresh run ledger

Start this exact ledger:

```text
correction rounds: 0/1
full evidence runs: 0/2
judge rounds: 0/2
```

Evidence run 1 is the targeted ten-capture probe. Evidence run 2 is the complete `--idle-release` capture.

Do not start Chrome before both source judges pass. If the targeted probe fails, stop. Do not use run 2 for a second targeted probe. Start the full run only after the targeted probe and checker pass.

Collect all P1 and P2 findings from both judges before one correction batch starts. If judge round 2 fails, stop and report the blocker.

At 90 minutes, report elapsed time, passed gates, remaining gates, and the ledger. At two hours, stop the same patch loop and reassess the model.

## Frozen product, fixture, and Chrome flow

Do not change any of these approved behaviors:

- fixture calibration constants or timing;
- preflight and trailing-cost sampling;
- slow-call elapsed and overrun telemetry;
- first-true cap selection;
- exactly 200 trailing operations and one final paint;
- heavy value diagnostics and `[7, 8)`;
- product findings, timing, instrumentation, association, or lifecycle logic;
- exact drain state machine and real page driver;
- exact eight-key drop schema;
- diagnostic privacy and request normalization;
- Vite ownership, `ESRCH`, cleanup, and error precedence;
- final port proof after capture, write, and checker failures;
- ten-capture Chrome order, waits, recording flow, or exit rules;
- current identity and timestamp checks.

SIDPROJ-97 must not change `apps/workbench/src/V04Lab.tsx`, `packages/dogfood/lab-v04-truth.mjs`, `packages/dogfood/lab-v04.mjs`, or `packages/dogfood/lab-v04.test.mjs`.

Their frozen SHA-256 values at planning time are:

```text
d2a19749934855ccb803424072cd203a16aba77f01c418c991c92cf3ed7829dc  apps/workbench/src/V04Lab.tsx
ca1a7a66360a77e2fce4bfe42030bb1eaf5dea16ae7b1049abb59d9b804effe9  packages/dogfood/lab-v04-truth.mjs
91970eb07365ca7abe3bab79b78ab35984ba997ebead5a6d72ce3d89549f80be  packages/dogfood/lab-v04.mjs
95888d4d6cbe7d0177f3db8f476100bbdf596e9a1c20f400a0c445fb63f9d687  packages/dogfood/lab-v04.test.mjs
```

## `packages/dogfood/v04-heavy-negative-probe.mjs`

### Split pure publication from production policy

Replace `writeArtifactAtomic()` with two layers:

```text
publishCreateOnce({ root, finalName, bytes, fsApi })
productionPublicationRequest(bytes)
publishProductionArtifact(bytes)
```

`publishCreateOnce()` is the pure filesystem helper. It accepts a fresh root and one plain final filename. It must not reference the real production path.

`productionPublicationRequest()` is pure. It returns the exact production root, final name, and unchanged bytes.

`publishProductionArtifact()` is the only production wrapper. It calls `publishCreateOnce(productionPublicationRequest(bytes))`. It enforces this exact path:

```text
/private/tmp/sidproj-95-heavy-negative-probe.json
```

The wrapper calls the pure helper with:

```text
root: '/private/tmp'
finalName: 'sidproj-95-heavy-negative-probe.json'
```

Do not export a production race hook. Tests can inject `fsApi` only into the pure helper.

### Pure helper input boundary

`publishCreateOnce()` must require:

- an absolute root;
- a final name with no slash, backslash, `.` segment, or `..` segment;
- a final path whose `path.dirname()` equals the resolved root;
- string or byte input with finite size;
- an injected or real filesystem API with the exact methods that the helper uses.

The helper can publish only inside its supplied root. It cannot accept a nested final path.

### Create-once final path

Resolve `finalPath = path.join(root, finalName)`.

Before any temporary work, call `lstat(finalPath)`:

- `ENOENT` permits work to continue.
- Any returned file type fails with `final-exists`.
- Any other error propagates.

Do not unlink, rename, replace, chmod, truncate, open, or follow an existing final path.

Publish with one no-overwrite hard-link operation:

```text
link(temporaryPath, finalPath)
```

`link()` must fail when any concurrent file, link, or directory appears at `finalPath`. Do not catch `EEXIST` to remove or replace that path. Convert it to `final-race` and preserve the concurrent path unchanged.

After successful publication, use `lstat(finalPath)`. Require a regular, non-symbolic-link file with the exact device and inode recorded from the created temporary handle.

Never unlink the final path. A publication or cleanup failure after a successful hard link must leave the published final artifact intact.

### Private temporary directory

Call `mkdtemp()` under the supplied root with a fixed `sidproj-97-publish-` prefix and an unpredictable suffix.

Immediately call `lstat(directory)`. Require:

- a directory;
- not a symbolic link;
- permission bits exactly `0700`;
- a parent equal to the resolved supplied root.

Record the directory device and inode. Before each temporary cleanup action, call `lstat(directory)` again. Require the same device and inode.

The production helper uses `/private/tmp`. Unit tests use a fresh private root under `/private/tmp`.

### Exact temporary inode

Use one fixed filename inside the unpredictable private directory:

```text
artifact.json
```

Create it with:

```text
open(temporaryPath, 'wx', 0o600)
```

Keep the returned file handle. Use this sequence:

1. Write all bytes through the handle.
2. Call `handle.sync()`.
3. Call `handle.stat()` and record `dev`, `ino`, file type, and permission bits.
4. Require a regular file with permission bits exactly `0600`.
5. Close the handle.
6. Immediately before `link()`, call `lstat(temporaryPath)`.
7. Require a regular, non-symbolic-link path.
8. Require its `dev` and `ino` to equal the handle record.
9. Call the one no-overwrite hard link without another asynchronous operation between steps 6 and 9.

An existing candidate temporary regular file or symbolic link must make `open(..., 'wx')` fail. Do not open or follow it.

The private directory blocks external path replacement. The pre-link inode comparison rejects a path that changed before publication. Production code must not contain a race hook between the final `lstat` and `link`.

### Safe cleanup

Track whether this call created the directory and temporary inode.

After successful publication:

1. Check that the final path matches the recorded temporary device and inode.
2. Check that the temporary path still matches the recorded device and inode.
3. Unlink only that exact temporary regular path.
4. Check that the directory still matches its recorded device and inode.
5. Remove only that exact empty directory with `rmdir()`.

On failure before publication, use the same identity checks before temporary unlink or directory removal.

If a temporary path or directory does not match, do not remove it. Report `temporary-race` or `directory-race`.

Preserve the primary write or publication error. Append handle-close and safe-cleanup errors in action order.

Never use recursive removal. Never traverse a link. Never remove the final path.

### Production flow

Before the targeted probe starts Vite or Chrome, require that the production final path is absent. This preflight prevents an evidence run that cannot publish.

After all captures and cleanup pass, call `publishProductionArtifact()` inside the existing final-port wrapper.

Keep create-once semantics. A second targeted probe cannot replace the first artifact. Do not automatically remove stale evidence.

## `packages/dogfood/v04-heavy-negative-probe-check.mjs`

Keep `checkArtifact()` and all checker behavior frozen. Change only imports or names that the writer split requires.

Keep the production artifact constant in this file. The CLI must still accept only the real production path. Keep its final port proof.

## Total `validateProbeExit()` contract

Implement this contract in `packages/dogfood/v04-heavy-negative-probe.mjs`.

`validateProbeExit(value)` must accept every JSON-compatible value. It must never throw. It must always return a new array.

Use this exact top-level artifact schema:

```text
schemaVersion
runId
startedAt
endedAt
coordinate
band
runCount
runs
values
minimum
maximum
median
chromeRevision
gitSha
bundleSha256
harnessSha256
diagnostics
port
```

Use this exact closed label order:

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

Each label can occur at most once. Return labels in the order above.

### Label rules

- `schema`: the top value is not a plain object, `schemaVersion !== 1`, or top-level keys differ from the exact artifact schema.
- `run count`: `runCount !== 10`.
- `runs`: `runs` is not a ten-item array, or any row has wrong non-drop keys, iteration, accepted count, or calibration presence.
- `values`: `values` is not a ten-item array; a value is missing, non-finite, or outside `[7, 8)`; a structurally valid run value differs from its value entry; or aggregates differ.
- `drops`: a structurally available run has a missing or malformed exact eight-key zero drop record.
- `diagnostics`: diagnostics is not the exact six-array schema or any array is nonempty.
- `coordinate`: coordinate is not exactly `{ scenario: 'heavy-burst', variant: 'nearest-negative', mode: 'negative' }`.
- `band`: band is not exactly `{ minimumInclusiveMs: 7, maximumExclusiveMs: 8 }`.
- `port`: port is not exactly `{ number: 5190, listenersBefore: [], listenersAfter: [] }`.

Use structural guards before every property read. Do not index `runs` or `values` until each is an array. Do not call `Object.keys()` or `Object.values()` on a null or primitive value.

If `runs` has the wrong length, add `runs` and skip row-dependent `values` and `drops` comparisons. Validate the independent `values` array itself and aggregates when safe.

If `values` is absent, return `values` without an exception. A missing drop object must return `drops`, not `runs`.

### Exact required arrays

At minimum, these direct cases must return exactly:

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

The `schema` label appears for a missing top-level key. A missing nested drop field uses the nested labels shown above.

## `packages/dogfood/v04-heavy-negative-probe-check.test.mjs`

The current suite has 145 passing tests. Keep all inherited test intent. Replace unsafe and weak assertions.

### No real production path in filesystem tests

No unit test can read, write, open, link, unlink, rename, `lstat`, `stat`, chmod, or remove:

```text
/private/tmp/sidproj-95-heavy-negative-probe.json
```

All real filesystem tests must:

1. Call `mkdtemp('/private/tmp/sidproj-97-publication-test-')`.
2. Check that the root is a real directory, not a link.
3. Call `publishCreateOnce()` with that root and a test-only final name.
4. Remove only the exact test files and root that the test created.

Do not import the production artifact constant into the test file.

Test `productionPublicationRequest()` directly. Assert its exact root, filename, and byte identity. Do not call `publishProductionArtifact()` from a unit test.

### Test-source audit

Add a source audit that reads `v04-heavy-negative-probe-check.test.mjs` as text.

The source audit must distinguish policy text from a filesystem target:

- Permit the real production path only inside one exact expected string used to check the production wrapper argument.
- Reject the real path when it appears as an argument or derived target for `readFile`, `writeFile`, `open`, `link`, `unlink`, `rename`, `lstat`, `stat`, `chmod`, `rm`, `rmdir`, `symlink`, `mkdir`, or the pure writer.
- Reject an import of `artifactPath` from either production module.

Normalize whitespace before the scoped source check. Do not use a growing denylist outside this one test file and one production path.

### Exact mutation assertions

Replace the `fails()` helper. Use a helper that accepts an exact expected array:

```text
rejects(label, mutate, expectedFailures)
```

Each mutation must use `assert.deepEqual(actual, expectedFailures)`. Do not use `notDeepEqual`, `.length > 0`, or `.includes()` as acceptance.

Keep each mutation as a named test or named subtest. When one mutation correctly triggers more than one label, list the complete ordered array.

Do not compute `expectedFailures` from the checker under test. Write each expected array as a literal in the test case.

For inherited `checkArtifact()` mutations, preserve its current closed labels and order:

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

Assert the complete current array for each mutation. A mutation that changes a run value and leaves aggregates stale must assert both `run:<iteration>` and `aggregates` in their returned order.

Add exact `validateProbeExit()` tests for:

- all ten required arrays above;
- every JSON primitive;
- an empty object;
- missing and malformed runs;
- missing and malformed values;
- missing and malformed diagnostics;
- each missing drop key;
- extra, negative, fractional, and nonzero drops;
- wrong coordinate, band, and port;
- bad aggregates;
- all out-of-band and non-finite values.

Add one table-driven totality test with JSON-compatible malformed objects. Wrap each call with `assert.doesNotThrow()` and check the exact returned array.

### Real create-once disk matrix

Use a new private test root for each case. Add direct tests for:

1. Successful publication creates one regular final file with exact bytes.
2. The private temporary directory mode is `0700`.
3. The temporary file mode is `0600`.
4. Handle `stat` and path `lstat` use the same device and inode.
5. Sync and close occur before publication.
6. An existing final regular file fails and stays byte-identical.
7. An injected link failure with an existing final keeps old bytes.
8. An existing final symbolic link fails and its target stays byte-identical.
9. An existing final directory fails and remains present.
10. A concurrent final regular file created before `link` makes publication fail and preserves concurrent bytes.
11. A concurrent final symbolic link before `link` fails and preserves its target.
12. A pre-existing candidate temporary regular file makes `wx` fail.
13. A pre-existing candidate temporary symbolic link makes `wx` fail and preserves its target.
14. A temporary path changed from the created inode before the final pre-link check fails with `temporary-race`.
15. A temporary directory changed from its created inode fails with `directory-race`.
16. A successful publication removes only the exact temporary inode and empty private directory.
17. A cleanup failure after publication leaves final bytes unchanged.
18. A write failure with close and cleanup failures preserves the primary error first.
19. No failure path calls `unlink`, `rename`, or removal on the final path.
20. A second publication to the same final name fails and preserves the first bytes.

Use injected filesystem wrappers only to place a race before the helper's final pre-link `lstat`. Do not add a race hook to production code.

### Preserve inherited direct tests

Keep direct named coverage for:

- delayed 17-operation drain acknowledgement;
- stopped-drain proof;
- measured start order;
- exact drops;
- calibration caps and slow-call overrun;
- timestamps and current identities;
- all diagnostic and request boundaries;
- process ownership and `ESRCH`;
- cleanup error precedence;
- final port proof after capture, write, and checker failures;
- all ten prohibited fixture tokens.

The final probe test count must be at least 145. More tests are expected because exact arrays replace broad assertions.

## Preserve inherited release evidence

Preserve all SIDPROJ-94 through SIDPROJ-96 behavior:

- exact complete LoAF set equality and pair timing;
- independent document-event truth;
- current-primary lifecycle chains;
- reconstructed live rows return `[]`;
- split-pair and unused-IDAT rejection;
- all 60 named executable attacks;
- all 12 live baseline contracts;
- all 63 existing lab tests;
- exact 53 matrix rows and 20 idle rows;
- exact v0.4 schemas, numeric bounds, diagnostics, drops, identities, hashes, and privacy limits;
- exact ten-file v0.4 artifact set and nine-file hash manifest;
- targeted ten-capture artifact and independent checker.

Keep `/private/tmp/sidproj-95-heavy-negative-probe.json` separate from the v0.4 artifact set.

## Verification funnel

### 1. Focused source checks

Run after each source change:

```text
node --test packages/dogfood/v04-heavy-negative-probe-check.test.mjs
pnpm --filter dogfood run lab:v0.4:test
git diff --check -- apps/workbench/src/V04Lab.tsx packages/dogfood/lab-v04-truth.mjs packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs packages/dogfood/v04-heavy-negative-probe.mjs packages/dogfood/v04-heavy-negative-probe-check.mjs packages/dogfood/v04-heavy-negative-probe-check.test.mjs
shasum -a 256 apps/workbench/src/V04Lab.tsx packages/dogfood/lab-v04-truth.mjs packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs
```

The probe suite must pass at least 145 tests. Every artifact mutation must assert its exact complete array.

The lab suite must pass at least 63 tests. It must run all 60 attacks and all 12 live contracts.

The four frozen inherited files must have no SIDPROJ-97 changes relative to the branch state recorded before the build. Because they are already dirty from the Git baseline, save and compare their pre-build hashes.

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

The core suite must report at least 555 passing tests. Both builds and all type checks must pass.

Check that every unrelated dirty path still matches its initial bytes. The owned diff from the baseline must contain only the seven closure paths.

### 3. Source judge gate

Run two independent judges on the same frozen source. Give each judge:

- this complete plan;
- live SIDPROJ-97 text;
- the SIDPROJ-96 plan;
- both final SIDPROJ-96 judge reports;
- the complete seven-file diff from the baseline;
- pre-build and post-build hashes of the four frozen files;
- all exact mutation arrays;
- the full real disk matrix;
- the unit-test source audit;
- current identities and run ledger;
- all 60 attacks and 12 live contracts.

Tell each judge to inspect every changed hunk and all tests. Each judge must return all P1 and P2 findings in one terminal report. Do not share one judge's report with the other judge.

Both judges must confirm create-once final safety, temporary inode identity, test-root isolation, total validation, exact arrays, and frozen Chrome flow.

Both judges must return `PASS` before Chrome.

### 4. Evidence run 1: targeted probe

The final artifact path must be absent before this one-run evidence gate. Check it with `lstat`. If any type exists, stop and report it. Do not remove it automatically.

After source freeze, run exactly once:

```text
node packages/dogfood/v04-heavy-negative-probe.mjs
```

This is full evidence run `1/2`. Do not retry a product or publication failure.

Then run without Chrome:

```text
node packages/dogfood/v04-heavy-negative-probe-check.mjs /private/tmp/sidproj-95-heavy-negative-probe.json
/usr/sbin/lsof -nP -iTCP@127.0.0.1:5190 -sTCP:LISTEN
shasum -a 256 /private/tmp/sidproj-95-heavy-negative-probe.json
```

Require ten finite values in `[7, 8)`, exact aggregates, current identities and timestamps, exact drops, empty diagnostics, coherent cap telemetry, regular create-once evidence, and an empty port.

If this gate fails, stop. Do not start the full release capture.

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
- final artifact device, inode, mode, and hash facts;
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
6. Push `agent/sidproj-97-create-once-evidence`.
7. Upload `/private/tmp/sidproj-95-heavy-negative-probe.json` to SIDPROJ-97.
8. Upload `/private/tmp/sidproj-90-v04-release-evidence.json` to SIDPROJ-97.
9. Add all values, aggregates, hashes, checks, Chrome revision, commit SHA, publication inode facts, port result, and final ledger to SIDPROJ-97.
10. Mark SIDPROJ-97 Done.
11. Add the same closure evidence to SIDPROJ-96 and mark SIDPROJ-96 Done.
12. Add the same closure evidence to SIDPROJ-95 and mark SIDPROJ-95 Done.
13. Add the same closure evidence to SIDPROJ-94 and mark SIDPROJ-94 Done.
14. Check live Linear state before work starts on another AFK issue.

Do not ask for routine Linear approval.

## Out of scope

- Do not replace or remove an existing targeted artifact.
- Do not change fixture timing, calibration, product output, findings, or thresholds.
- Do not change association or lifecycle logic.
- Do not widen `[7, 8)`.
- Do not retry a completed capture or add longer waits.
- Do not weaken idle, PNG, schema, numeric, hash, file-set, or privacy checks.
- Do not change `packages/dogfood/package.json`.
- Do not change a v0.5, pack, package, document, release-note, or workflow file.
- Do not run SIDPROJ-70.
- Do not tag, publish, open a pull request, or contact an external maintainer.
