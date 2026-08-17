# SIDPROJ-102 coherent contract redesign

## Falsifiable goal

SIDPROJ-102 is complete when one fixed release harness passes every finite source, browser, CLI, disk, artifact, and truth case in this plan. Every negative case must return its exact complete ordered failure array or its exact thrown message. Full-module SHA-256 digests must prove the trusted module bytes. Real semantic tests must make the named behavior change in a temporary source copy or a finite pure fixture. Two independent source judges must pass before Chrome starts. One targeted run and one idle-release run must then pass. Disk checks and both evidence judge continuations must pass on those fresh runs. The final signed commit must contain only the exact eleven-file allowlist. The branch push, Linear evidence upload, comments, and issue closure must then succeed.

## Live issue state and authority

- Issue: `SIDPROJ-102`, `V05-09r — Freeze the release harness and isolate fresh evidence`.
- URL: `https://linear.app/yde/issue/SIDPROJ-102/v05-09r-freeze-the-release-harness-and-isolate-fresh-evidence`.
- Live state on 2026-08-13: `In Progress` with the `AFK` label.
- Parent: `SIDPROJ-62`, `v0.5 — Release confidence`.
- SIDPROJ-102 has no blocker.
- SIDPROJ-102 blocks SIDPROJ-101.
- SIDPROJ-102 relates to SIDPROJ-100, SIDPROJ-99, SIDPROJ-95, and SIDPROJ-70.
- SIDPROJ-70 stays out of scope.
- The user authorized this coherent redesign after the final source gate stopped.
- Before the build starts, align SIDPROJ-102 with the authoritative browser order, exact-result rules, and finite disk matrix in this redesign.
- After that alignment, do not change Linear again until the closure steps in this plan.

The live SIDPROJ-102 comment says the final source gate stopped before Chrome. The comment records these passed checks:

- 126 targeted checker tests.
- 68 v0.4 lab tests.
- 60 inherited attacks.
- 12 live contracts.
- 555 core tests.
- Workspace type checks.
- Core and workbench builds.
- A fixed manifest with 10 complete module digests.
- Scoped and full diff checks.
- Frozen SIDPROJ-95 SHA-256 `4d8b2292910fba995d837b392e439274b0fdf412200941f337e25ad134827d65`.

These results are the prior stopped baseline. The builder must rerun all checks after the redesign.

The final source reviewers found four blockers:

1. Most inherited attacks only prove a nonempty failure result. Generic text and file tests do not check exact messages.
2. Named semantic source tests append comments. They do not make the named behavior changes.
3. The finite CLI and disk matrix is incomplete.
4. The old written script order contradicts the measured document order.

This plan resolves all four blockers as one closed test contract. Do not add a source analyzer.

## Fresh redesign ledger

Start this redesign with this exact ledger:

```text
correction rounds: 0/1
expensive runs: 0/2
judge rounds: 0/2
```

A correction round is one batch for both complete source-judge reports. An expensive run is one targeted or idle-release Chrome run. A judge round contains two independent source reviews of one unchanged tree.

## Repository baseline

- Repository: `/Users/yomi/Documents/batcave/canvas-scan`.
- Branch: `agent/sidproj-102-fixed-release-harness`.
- `HEAD`: `65decbced2257a3d15774423c9607e037b77e6fb`.
- `HEAD` subject: `Record canvas windows at observation time`.
- Merge base with `origin/main`: `20e53799202a0193f6c48c9b438ec9452b80dfaf`.
- Git uses SSH signing.
- `commit.gpgsign=true`.
- `gpg.format=ssh`.
- Signing key: `/Users/yomi/.ssh/dash0_ed25519.pub`.
- Chrome binary exists at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
- Planning did not start Chrome or read its version.
- Port `5190` had no listener during redesign planning.
- `/private/tmp` is a real directory with mode `1777` (`drwxrwxrwt`).
- `/private/tmp/sidproj-95-heavy-negative-probe.json` is a regular mode-`0600` file.
- SIDPROJ-95 device: `16777234`.
- SIDPROJ-95 inode: `904777482`.
- SIDPROJ-95 size: `8289` bytes.
- SIDPROJ-95 SHA-256: `4d8b2292910fba995d837b392e439274b0fdf412200941f337e25ad134827d65`.
- A direct raw-byte PUT to a Linear signed upload URL can need a system network gate.
- Git push can need a network gate.
- Chrome process start can need a system execution gate.

Report a system gate as soon as it occurs. Continue all safe work that does not need the gate.

## Complete dirty tree at redesign planning

Preserve all paths and all unrelated bytes. Do not reset, clean, stash, restore, remove, or format unrelated files.

Modified paths:

```text
apps/workbench/public/v04-lab.html
apps/workbench/src/V04Lab.tsx
apps/workbench/src/v04-lab-main.tsx
packages/core/test/pack-manifest.test.ts
packages/dogfood/lab-v04-truth.mjs
packages/dogfood/lab-v04.mjs
packages/dogfood/lab-v04.test.mjs
packages/dogfood/lab-v05-truth.mjs
packages/dogfood/lab-v05.mjs
packages/dogfood/lab-v05.test.mjs
packages/dogfood/package.json
scripts/pack-manifest.mjs
scripts/verify-pack.mjs
```

Untracked paths:

```text
.codex/pbj-plan-sidproj-100.md
.codex/pbj-plan-sidproj-101.md
.codex/pbj-plan-sidproj-102.md
.codex/pbj-plan-sidproj-102-redesign.md
.codex/pbj-plan-sidproj-91.md
.codex/pbj-plan-sidproj-92.md
.codex/pbj-plan-sidproj-93.md
.codex/pbj-plan-sidproj-94.md
.codex/pbj-plan-sidproj-95.md
.codex/pbj-plan-sidproj-96.md
.codex/pbj-plan-sidproj-97.md
.codex/pbj-plan-sidproj-98.md
.codex/pbj-plan-sidproj-99.md
.codex/pbj-plan.md
AGENTS.md
apps/workbench/public/bench-v05.html
docs/releases/v0.5-human-test.md
docs/releases/v0.5-release-notes.md
packages/dogfood/bench-v05-chrome.mjs
packages/dogfood/bench-v05-chrome.test.mjs
packages/dogfood/excalidraw-v05-truth.mjs
packages/dogfood/excalidraw-v05-truth.test.mjs
packages/dogfood/excalidraw-v05.mjs
packages/dogfood/release-v05.mjs
packages/dogfood/release-v05.test.mjs
packages/dogfood/v04-evidence-run.mjs
packages/dogfood/v04-heavy-negative-probe-check.mjs
packages/dogfood/v04-heavy-negative-probe-check.test.mjs
packages/dogfood/v04-heavy-negative-probe.mjs
packages/dogfood/v04-release-manifest.mjs
packages/dogfood/v05-bench-diagnostic.ts
```

The issue overlaps exactly these eleven dirty or untracked source files:

```text
apps/workbench/public/v04-lab.html
apps/workbench/src/v04-lab-main.tsx
apps/workbench/src/V04Lab.tsx
packages/dogfood/lab-v04-truth.mjs
packages/dogfood/lab-v04.mjs
packages/dogfood/lab-v04.test.mjs
packages/dogfood/v04-evidence-run.mjs
packages/dogfood/v04-release-manifest.mjs
packages/dogfood/v04-heavy-negative-probe.mjs
packages/dogfood/v04-heavy-negative-probe-check.mjs
packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

Current complete-file hashes for that overlap are:

```text
b97132b12e01b9c3e10765890734c1ef5dd05583bfa5fb19b1ec34390081ec20  apps/workbench/public/v04-lab.html
9c8520540e62476d15484689bc03bdf16986aa2120b29a3746a41eea083fa2a4  apps/workbench/src/v04-lab-main.tsx
a7db1064c879f889f80e6631e9a50dd02d26b974a3184d7c60c32b7a75ab4f52  apps/workbench/src/V04Lab.tsx
ca1a7a66360a77e2fce4bfe42030bb1eaf5dea16ae7b1049abb59d9b804effe9  packages/dogfood/lab-v04-truth.mjs
8c1d0830964f49f9dbf9609669afbffb8aa501fa8dda06ccf68f63703797c0f9  packages/dogfood/lab-v04.mjs
5c555f3216025495cb40e7fdfbfe289192f8b1626fb2b26998ae5f3edcdb9300  packages/dogfood/lab-v04.test.mjs
f8b77114eb7cbbfd1b19378f1921838c5093fb03375bf5b8f45a07016850b51e  packages/dogfood/v04-evidence-run.mjs
9725bec194a710dd9a4b8b0045c511edbe22ceba4bdb02992f7be2eeb67bce21  packages/dogfood/v04-release-manifest.mjs
35523c34ab771edb2a2dd68d2f6e505b4ed4715e3a2f73f330ebed283b10da9c  packages/dogfood/v04-heavy-negative-probe.mjs
822c49e4f1c92283488d3f37f3ac858abfdaa3a3cf017a02386f86cced5c09fb  packages/dogfood/v04-heavy-negative-probe-check.mjs
3299e182083f3f017a20df4e154e291f125fabb1583bd3cbbdf33e6cbaec0ee7  packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

The builder must calculate new freeze hashes after the redesign. Do not reuse a listed hash after its file changes.

## Fixed trust model

`packages/dogfood/v04-release-manifest.mjs` is the reviewed trust root. The source judges and signed Git commit bind its bytes. It cannot list its own digest.

Keep this exact ordered trusted-module specification:

```text
browser-document         apps/workbench/public/v04-lab.html
bootstrap                apps/workbench/src/v04-lab-main.tsx
calibration-fixture      apps/workbench/src/V04Lab.tsx
repository-truth         packages/dogfood/lab-v04-truth.mjs
release-runner-checker   packages/dogfood/lab-v04.mjs
release-contract-tests   packages/dogfood/lab-v04.test.mjs
evidence-directory       packages/dogfood/v04-evidence-run.mjs
targeted-runner          packages/dogfood/v04-heavy-negative-probe.mjs
targeted-checker         packages/dogfood/v04-heavy-negative-probe-check.mjs
targeted-contract-tests  packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

Each manifest row has exactly `role`, `path`, and `sha256`. The digest uses 64 lowercase hexadecimal characters. The manifest has exactly `schemaVersion`, `algorithm`, and `modules`. The algorithm is `sha256`. The module order is fixed.

`verifyReleaseManifest()` must open every trusted path and hash all file bytes. Full-module digests prove trusted bytes. The checker must reject a missing, extra, renamed, reordered, or changed trusted module.

Do not parse trusted source as proof. Do not inspect identifier names. Do not use regular expressions, partial source text, or a source-text denylist as proof. Do not build a source, alias, taint, data-flow, or control-flow analyzer. Do not add a JavaScript parser or TypeScript compiler proof.

## Authoritative browser contract

Use one authoritative script order everywhere:

```text
options
Canvas Scan IIFE
application
```

Use this exact browser contract array:

```js
[
  { role: 'options', kind: 'classic-inline', rawSrc: null, resolvedPath: null, query: '', fragment: '' },
  { role: 'canvas-scan', kind: 'classic-external', rawSrc: '/canvas-scan.iife.js', resolvedPath: '/canvas-scan.iife.js', query: '', fragment: '' },
  { role: 'application', kind: 'module-external', rawSrc: '/src/v04-lab-main.tsx', resolvedPath: '/src/v04-lab-main.tsx', query: '', fragment: '' },
]
```

This order matches the measured `document.scripts` result. The bootstrap appends the Canvas Scan IIFE to `document.head`. The application module element stays in `body`. Do not describe or accept options, application, Canvas Scan.

The options script must create one own, frozen `{ overlay: true }` value. Its descriptor must be non-writable and non-configurable. The document must contain no other script.

Both `pageBrowserContract()` in the targeted runner and `browserContractFor()` in the release runner must produce the same exact object. `checkBrowserContract()` must compare the full object and return one exact label.

## Exact failure contract

Use these stable failure labels in this order when a checker can report more than one result:

```text
manifest schema
trusted module set
trusted module order
trusted module digest
run directory
artifact identity
artifact set
artifact schema
browser scripts
browser options
bootstrap ready
calibration
runtime counts
artifact truth
unknown support
diagnostics
port
```

Return each label at most once. Keep the order above. Do not expose paths, source text, artifact text, or secrets in a failure.

Every negative test must use one of these forms:

- `assert.deepEqual(actualFailures, exactExpectedFailures)` for failure arrays.
- An error predicate that checks `error.message === exactMessage` for thrown errors.
- `assert.equal(actualLabel, exactExpectedLabel)` for a single pure checker label.

Do not use `notDeepEqual(..., [])`, `.length > 0`, `.some(...)`, `assert.throws()` without a message check, a message regular expression, or `assert.doesNotThrow()` around an inner weak assertion.

If one mutation correctly causes multiple labels, list the full ordered array in the mutation table. Do not weaken the checker to force one label.

## File and symbol changes

### `packages/dogfood/lab-v04.test.mjs`

Replace `rejectedCombined()` with a helper that accepts a mutation and an exact expected array. Change the `attacks` table to this shape:

```js
[name, mutateOrRun, exactExpected]
```

For all 60 inherited attacks, run the real mutation once and compare the complete result with `exactExpected`. For pure parsers and file-set functions, compare the exact thrown message. Keep the exact attack count at 60. Do not add count-padding cases.

Change the generic file, hash-text, JSON, PNG, projection, and combined-row cases to exact results. A boolean PNG validator can still use exact `false`. A parser must use an exact thrown message.

Keep all 12 live contracts. Change each negative live-contract assertion to the complete expected failure list or exact error message.

Add a table that checks the authoritative browser contract and every browser mutation from this plan. Import and test `checkBrowserContract()` directly. Do not infer browser order from source text.

Add a finite unknown-support table. It must keep honest `unknown` rows valid. It must reject a change from `unknown` to `same` and from `unknown` to `changed` when no measured comparison supports the status.

The support rule must use only the current primitive evidence and repository truth. It must not use `productResult`, expected booleans copied from product output, row pass flags, fixture labels, checker output, or diagnostic text. A known status needs these finite facts from the raw measured window report:

1. `unknownReason` is `null`.
2. `comparisonGap` is a positive bounded integer.
3. A prior window with the same `canvasKey` exists at the declared gap.
4. `sampled` is the raw measured boolean for the current window.

An unknown status needs one exact reason from the closed `signatureUnknownReasons` set. It can use `comparisonGap: null` when no comparable pair exists. Tests must cover every accepted unknown reason shape that the current finite corpus uses. Tests must cover missing, wrong-canvas, wrong-gap, future, duplicate, and copied-status support mutations.

The raw report does not export signature hashes or an independent comparison record. Do not invent one, copy product truth, or change core code. This rule rejects a status-only unknown-to-known change because the unchanged reason and gap do not support the new status. A coordinated rewrite of all raw measurement fields is outside the standalone artifact model. The fixed source, fresh browser run, and closed artifact identity form that trust boundary.

### `packages/dogfood/v04-heavy-negative-probe-check.test.mjs`

Keep manifest, browser, artifact, runtime-count, directory, identity, and cleanup tests. Make every thrown-message check exact.

Replace `semanticMutations` comment appends. Each named source case must do one actual semantic edit in a temporary repository tree. Use an exact unique source anchor and an exact replacement. Check that the anchor occurs once before the edit. Check that the replacement occurs once after the edit. Keep the manifest digest unchanged. Then require exactly `trusted module digest`.

The minimum real source changes are:

- Move exact capability validation after the fixture publishes `ready`.
- Put exact capability validation behind dead code.
- Validate a wrong canvas, context, or native method.
- Change the warm-up loop bound.
- Change the primitive saved-sample loop bound.
- Change the fixed-plan saved-sample loop bound.
- Read a Canvas Scan result through each declared global form.
- Put a native value in each declared sink.
- Add a second loader.
- Add a second application entry.
- Add a second dynamic import.
- Add a second capability handoff.
- Add a direct old-evidence read.
- Add an old-evidence helper call.
- Add an old-evidence destructuring call.
- Add an old-evidence computed filesystem call.
- Add an `fs.promises` old-evidence call.
- Add old-evidence link, rename, copy, and removal calls.

Use valid source changes. Do not append a comment, identifier, label, or dead string as the semantic mutation. The digest test proves changed bytes. The test name and actual replacement prove that the named behavior changed.

For behavior that does not need source, use a finite pure fixture. Browser-order, option-descriptor, artifact, runtime-count, unknown-support, CLI-argument, and failure-order cases are pure fixtures. Link, rename, copy, removal, replacement, and permission cases use real temporary disk operations.

Add and test an exported pure `parseTargetedArgs(args)` in `v04-heavy-negative-probe-check.mjs`. The production `main()` must call it.

### `packages/dogfood/v04-heavy-negative-probe-check.mjs`

Keep `validCalibration()`, `checkBrowserContract()`, `checkArtifact()`, `currentIdentity()`, and `checkTargetedRun()`.

Export `parseTargetedArgs(args)`. It must accept exactly one string argument. It must reject no argument and more than one argument with `run directory`. It must not choose a default or scan for a recent run.

`checkTargetedRun()` must accept only one absolute path with this exact form:

```text
/private/tmp/sidproj-102-targeted-<UUID_V4>
```

It must reject these cases with exact `run directory`:

- No CLI argument.
- Two or more CLI arguments.
- A relative path.
- A regular-file path.
- A path outside `/private/tmp`.
- A wrong issue prefix.
- A wrong run-kind prefix.
- A malformed UUID.
- A non-v4 UUID.
- A symbolic-link directory.
- A directory with a wrong mode.
- A stale targeted run.
- An idle-release run.
- A different current-run identity when an expected run object exists.

After path checks, map content failures through the stable failure contract. Keep exact complete arrays until `main()` formats the final message.

### `packages/dogfood/v04-evidence-run.mjs`

Keep flat functions. Do not add a class.

Keep these exports:

```text
trustedModuleSpec
verifyReleaseManifest
createEvidenceRun
writeFinalArtifact
readCurrentArtifact
writeRunIndex
checkRunDirectory
checkRunIndex
removeOwnedTemporary
parseExactJson
sha256
```

Add the smallest test-only injection that lets a test select one UUID. Production options must stay exactly empty. The test-only option must work only with an absolute temporary root that is not `/private/tmp`. Reject all other option shapes with `invalid evidence run`.

Use the injection to pre-create the exact selected directory. `createEvidenceRun()` must then throw exactly `run directory exists`. Do not accept an existing directory.

Cover this complete real-disk matrix in a temporary root:

- Pre-existing selected run directory.
- Run directory replaced after create.
- Run directory changed to a symbolic link.
- Run directory mode changed from `0700`.
- Run object points outside its root.
- Final regular file exists before write.
- Final symbolic link exists before write.
- Final directory exists before write.
- Final path is replaced after write.
- Final file gets a hard link.
- Final file is renamed away.
- A copied file replaces the final path.
- An expected file is removed.
- An unexpected file is added.
- A final file is copied from SIDPROJ-95, SIDPROJ-99, SIDPROJ-100, or SIDPROJ-101.
- Run-index rows are missing, extra, duplicated, or reordered.
- Run-index kind is wrong.
- Run-index UUID is wrong.
- Run-index timestamps are stale, future, reversed, or too long.
- A temporary file is removed before owned cleanup.
- A temporary file is renamed before owned cleanup.
- A copy replaces a temporary path before owned cleanup.
- A temporary path becomes a symbolic link before owned cleanup.
- A temporary path gains a hard link before owned cleanup.
- Cleanup is asked to remove each final artifact name.

For each case, check the exact message. Also check which original, replacement, or linked file remains. Cleanup must never remove a replacement, final artifact, or another run directory.

Do not add a general filesystem-call detector. Test real filesystem effects and the small exported API boundary.

### `packages/dogfood/lab-v04.mjs`

Keep `parseArgs(args)` as the only release CLI parser. It accepts:

```text
[]
['--idle-release']
['--', '--idle-release']
['--check-evidence', '<absolute idle-release directory>']
['--', '--check-evidence', '<absolute idle-release directory>']
```

Normalize one leading `--`. Reject all other shapes with exactly `unsupported lab arguments`.

The check path must accept only:

```text
/private/tmp/sidproj-102-idle-release-<UUID_V4>
```

Add exact CLI and disk tests for:

- Missing directory after `--check-evidence`.
- More than one directory.
- A regular file.
- A relative path.
- A path outside `/private/tmp`.
- A wrong issue prefix.
- A targeted prefix.
- A malformed UUID.
- A non-v4 UUID.
- A stale run.
- A wrong-kind `run.json`.
- A directory identity replacement.
- A pre-existing selected production run directory through the evidence API test boundary.

The idle-release runner must always create one fresh private directory. It must never accept an inherited evidence file as input. It must not find the latest directory. It must not scan old runs. It must not remove a prior run.

Keep the exact 53-row matrix, 20 idle rows, strict PNG checks, mutation artifact, hash manifest, diagnostics, drop, process, and port contracts.

Use exact complete failure arrays in `checkCombinedRows()`, `checkIdleEvidence()`, `checkReleaseEvidence()`, and all test call sites. Keep stable array order.

### `packages/dogfood/lab-v04-truth.mjs`

Keep this file as the only expected row and claim-truth source. Keep the exact 53-row order, 60 attack domain, numeric boundaries, lifecycle rules, association rules, and product-versus-primitive split.

Keep honest unknowns valid. Define the closed unknown reason set in repository truth or one imported trusted helper. Keep it outside product-visible output.

The checker must reject an unknown-to-`same` or unknown-to-`changed` result unless current primitive evidence proves the comparison. Changing product output and copied expected output together must still fail. A product status string, pass flag, fixture label, diagnostic, or copied checker result cannot prove support.

Do not require a known result when the finite support is absent. Do not convert an honest unknown into a release failure.

### `apps/workbench/public/v04-lab.html`

Keep one classic inline options script. Keep one module application script. Do not add another script.

The final measured script array must be options, Canvas Scan IIFE, application. The IIFE appears because the bootstrap appends it to `document.head`.

### `apps/workbench/src/v04-lab-main.tsx`

Keep the current exact native capture and loader sequence:

1. Capture the Canvas2D prototype and three native methods.
2. Create one detached `1280` by `560` HTML canvas.
3. Get its same-realm `2d` context.
4. Check the exact canvas, context, dimensions, and methods.
5. Freeze exactly `{ canvas, context, putImageData, fillRect, clearRect }`.
6. Create one classic script with raw `/canvas-scan.iife.js`.
7. Resolve only from `script.onload`.
8. Reject only from `script.onerror`.
9. Append the script once to `document.head`.
10. Await the loader.
11. Import React, React DOM, and `V04Lab` after the await.
12. Pass one direct `nativeCanvas2D` prop.

Do not add a second loader, import, handoff, global, DOM property, state value, export, return, log, error payload, diagnostic, hash input, or screenshot input.

### `apps/workbench/src/V04Lab.tsx`

Keep the exact same-realm calibration, detached canvas, operation plan, geometry, caps, colors, and `[7, 8)` band.

Keep these exact runtime counts:

```text
declaredWarmupCallCount = 2
observedWarmupCallCount = 2
declaredPrimitiveSampleCount = 3
observedPrimitiveSampleCount = 3
declaredFixedPlanSampleCount = 3
observedFixedPlanSampleCount = 3
```

Increment observed counts at the actual call sites. Select saved samples only from events with phase `saved`. Check the exact capability before the fixture reports `ready`.

The fixture must not read Canvas Scan globals, reports, findings, canvases, rows, pass flags, expected results, checker output, or evidence files.

### `packages/dogfood/v04-heavy-negative-probe.mjs`

Keep one fresh targeted run. Keep ten captures, exact browser-contract capture, current identities, runtime counts, zero drops, empty diagnostics, and port cleanup.

Write only `targeted.json` and `run.json` into the new private run directory. Print the exact run directory. Do not read or remove old evidence.

### `packages/dogfood/v04-release-manifest.mjs`

After all source changes stop, update all ten full-module SHA-256 values. Check each value against the complete current bytes. Do this before source judges.

## Artifact and identity contract

The targeted directory contains exactly:

```text
targeted.json
run.json
```

The idle-release directory contains exactly:

```text
canvas-lab-v0.4.json
variant-matrix.json
nearest-negatives.json
console-summary.txt
integrated-continuous.png
integrated-burst.png
mutation-output.txt
idle-boundary.json
release-evidence.json
sha256.txt
run.json
```

The run directory uses mode `0700`. Each file uses mode `0600` and link count `1`. Create the run directory and every final file with exclusive create-once operations. Reject extra, missing, renamed, reordered, linked, copied, replaced, or outside files.

`run.json` is last. It binds the run kind, UUID, timestamps, directory identity, Git SHA, Chrome revision, bundle digest, manifest digest, complete trusted module list, exact artifact order, size, and digest.

The checker reads only the current run directory, the fixed manifest, trusted module bytes, current Git `HEAD`, current built IIFE, Chrome version, and port state. It must not read another run or prior SIDPROJ evidence.

## Required finite mutation corpus

### Manifest

- Change one byte in each trusted module.
- Remove each trusted module.
- Add one module.
- Rename one module.
- Swap each adjacent module pair.
- Change each role.
- Use a missing, short, uppercase, non-hex, or extra digest.
- Add an extra manifest or row field.

Each case must check its exact error. The manifest must use complete bytes.

### Semantic source

Use the real temporary-copy edits listed in the file section. Each case must make the named behavior change. Each case must leave manifest values unchanged. Each case must fail exactly `trusted module digest`.

Do not add comment-only or string-only semantic cases.

### Browser

- Inert options script.
- Later options override.
- Another executable inline script.
- Relative IIFE URL.
- Entity-encoded IIFE URL.
- IIFE query.
- IIFE fragment.
- Different IIFE path.
- Another loader.
- Another application entry.
- Another dynamic import script.
- Missing or mutable options descriptor.
- Extra option key.
- Unfrozen option value.
- Missing Canvas Scan ready state.
- Missing fixture ready state.
- Missing capability validation.
- Any script order other than options, Canvas Scan IIFE, application.

Each pure fixture must return one exact label.

### CLI and disk

Cover every CLI and disk case in the file sections. Use real temporary paths for filesystem cases. Check exact error messages and preserved-file state.

The full link, rename, copy, removal, replacement, and pre-existing-directory matrix is mandatory. Do not replace it with source scanning.

### Artifact and truth

- Remove each required field.
- Add one extra field.
- Add one extra row or file.
- Remove one row or file.
- Reorder each ordered set.
- Duplicate each unique row type.
- Use duplicate JSON keys.
- Use negative, fractional, non-finite, stale, future, or inconsistent values.
- Change one targeted value to `6.999`.
- Change one targeted value to `8`.
- Duplicate a targeted value and coordinate aggregates.
- Change minimum, maximum, or median.
- Add a diagnostic, drop, instrumentation kill, request query, or unsupported evidence.
- Change runtime counts and arrays together.
- Change honest unknown to `same` without measured support.
- Change honest unknown to `changed` without measured support.
- Keep each valid honest unknown shape unchanged and require a pass.
- Copy a product result into expected truth.
- Change product output and copied expected output together.
- Hide a conclusion in a diagnostic or free-text field.

Every case must compare the exact complete ordered failure array or exact thrown message.

## Verification funnel

Run the gates in this order. Stop at the first product or contract failure.

### 1. Focused tests

```bash
node --test packages/dogfood/v04-heavy-negative-probe-check.test.mjs
pnpm --filter dogfood run lab:v0.4:test
git diff --check -- apps/workbench/public/v04-lab.html apps/workbench/src/v04-lab-main.tsx apps/workbench/src/V04Lab.tsx packages/dogfood/lab-v04-truth.mjs packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs packages/dogfood/v04-evidence-run.mjs packages/dogfood/v04-release-manifest.mjs packages/dogfood/v04-heavy-negative-probe.mjs packages/dogfood/v04-heavy-negative-probe-check.mjs packages/dogfood/v04-heavy-negative-probe-check.test.mjs
shasum -a 256 /private/tmp/sidproj-95-heavy-negative-probe.json
```

Require all redesigned tests, all 60 exact attacks, all 12 live contracts, and the complete finite CLI and disk matrix. Record the real test counts. Do not pad counts.

### 2. Standard checks

```bash
pnpm --filter canvas-scan test
pnpm typecheck
pnpm --filter canvas-scan run build
pnpm --filter workbench exec vite build
git diff --check
git status --short --branch --untracked-files=all
git diff --name-only
git diff --stat 65decbced2257a3d15774423c9607e037b77e6fb -- apps/workbench/public/v04-lab.html apps/workbench/src/v04-lab-main.tsx apps/workbench/src/V04Lab.tsx packages/dogfood/lab-v04-truth.mjs packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs packages/dogfood/v04-evidence-run.mjs packages/dogfood/v04-release-manifest.mjs packages/dogfood/v04-heavy-negative-probe.mjs packages/dogfood/v04-heavy-negative-probe-check.mjs packages/dogfood/v04-heavy-negative-probe-check.test.mjs
shasum -a 256 apps/workbench/public/v04-lab.html apps/workbench/src/v04-lab-main.tsx apps/workbench/src/V04Lab.tsx packages/dogfood/lab-v04-truth.mjs packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs packages/dogfood/v04-evidence-run.mjs packages/dogfood/v04-heavy-negative-probe.mjs packages/dogfood/v04-heavy-negative-probe-check.mjs packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

Require at least 555 core tests. Require all type checks and both builds. Update and check the full-module manifest after all source files stop changing. Check all unrelated dirty paths against the planning baseline.

Do not run either Chrome command before both source judges pass:

```text
node packages/dogfood/v04-heavy-negative-probe.mjs
pnpm --filter dogfood run lab:v0.4 -- --idle-release
```

### 3. Two independent source judges

Freeze the source. Start two independent judges on the same unchanged tree. Give each judge:

- This complete plan.
- The live SIDPROJ-102 issue and both comments.
- The complete eleven-file diff.
- All ten complete trusted modules and manifest.
- The complete exact-result mutation corpus.
- All focused and standard output.
- The dirty-tree baseline.
- The current ledger.

Do not give one judge the other report. Tell each judge to return all P1 and P2 findings in one terminal report.

Each judge must try to refute complete-byte binding, actual semantic mutations, exact failure arrays, browser order, unknown support, CLI closure, directory identity, all link and replacement cases, artifact closure, source scope, process cleanup, and port cleanup.

Both judges must return `PASS` before Chrome starts. Set `judge rounds: 1/2`.

If either judge fails, collect both reports. Use one correction round. Add all accepted counterexamples to focused tests. Rerun focused and standard checks. Start source judge round 2. Stop if either round-2 judge fails.

### 4. Expensive run 1: targeted

Check the Chrome binary, port `5190`, `/private/tmp`, the full manifest, and SIDPROJ-95 identity first. Do not remove or scan old SIDPROJ-102 directories.

Run exactly:

```bash
node packages/dogfood/v04-heavy-negative-probe.mjs
```

Set `expensive runs: 1/2`.

Require `SIDPROJ_102_TARGETED_PROBE: PASS`. Record the exact printed run path. Require ten distinct finite values in `[7, 8)`, exact aggregates, one accepted run per capture, exact runtime counts, zero drops, empty diagnostics, current identities, options/Canvas Scan IIFE/application order, two exact files, directory mode `0700`, file mode `0600`, link count `1`, and no port listener.

Stop on a product or contract failure. Do not start the idle-release run.

### 5. Expensive run 2: idle release

Run exactly:

```bash
pnpm --filter dogfood run lab:v0.4 -- --idle-release
```

Set `expensive runs: 2/2`.

Require all existing PASS markers and the printed idle-release path. Require 20 idle rows, 53 matrix rows, the exact expected mutation failure, strict PNGs, exact hashes, zero drops, empty diagnostics, current identities, options/Canvas Scan IIFE/application order, eleven exact files, directory mode `0700`, file mode `0600`, link count `1`, and port cleanup.

Do not start a third expensive run.

### 6. Disk checks and repeated local gates

Use only the two exact paths that the runners print:

```bash
node packages/dogfood/v04-heavy-negative-probe-check.mjs /private/tmp/sidproj-102-targeted-<TARGETED_UUID>
pnpm --filter dogfood run lab:v0.4 -- --check-evidence /private/tmp/sidproj-102-idle-release-<RELEASE_UUID>
/usr/sbin/lsof -nP -iTCP@127.0.0.1:5190 -sTCP:LISTEN
shasum -a 256 /private/tmp/sidproj-95-heavy-negative-probe.json
node --test packages/dogfood/v04-heavy-negative-probe-check.test.mjs
pnpm --filter dogfood run lab:v0.4:test
pnpm --filter canvas-scan test
pnpm typecheck
pnpm --filter canvas-scan run build
pnpm --filter workbench exec vite build
git diff --check
git status --short --branch --untracked-files=all
```

Replace both UUID placeholders with the exact printed values. Do not use `find`, a glob, or a latest-directory scan.

Recompute every file size and digest. Recheck directory and file identities, modes, and link counts. Recheck the fixed manifest against complete bytes. Recheck that SIDPROJ-95 did not change.

### 7. Evidence judge continuations

Continue the same two independent judge streams. Give each judge:

- The final eleven-file diff and manifest.
- Both `run.json` files.
- Every file in both fresh run directories.
- Targeted values and recomputed aggregates.
- Runtime counts and sample arrays.
- Raw browser script facts and exact accepted order.
- Directory and file identity, mode, link count, size, and digest facts.
- Git, Chrome, bundle, source, SIDPROJ-95, port, diagnostic, and drop facts.
- The final ledger.

Do not share judge reports. Both continuations must return `PASS`. If a continuation fails, stop and report the evidence-model blocker.

## Closure allowlist

The final commit contains exactly these eleven paths:

```text
apps/workbench/public/v04-lab.html
apps/workbench/src/v04-lab-main.tsx
apps/workbench/src/V04Lab.tsx
packages/dogfood/lab-v04-truth.mjs
packages/dogfood/lab-v04.mjs
packages/dogfood/lab-v04.test.mjs
packages/dogfood/v04-evidence-run.mjs
packages/dogfood/v04-release-manifest.mjs
packages/dogfood/v04-heavy-negative-probe.mjs
packages/dogfood/v04-heavy-negative-probe-check.mjs
packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

Do not stage `packages/dogfood/package.json`. Existing scripts expose the needed commands. Do not stage `.codex`, `AGENTS.md`, v0.5 files, core tests, pack scripts, documents, or generated bundles.

## Signed commit, push, evidence upload, and closure

Start closure only after all checks and both evidence continuations pass.

Run the exact staging command:

```bash
git add -- apps/workbench/public/v04-lab.html apps/workbench/src/v04-lab-main.tsx apps/workbench/src/V04Lab.tsx packages/dogfood/lab-v04-truth.mjs packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs packages/dogfood/v04-evidence-run.mjs packages/dogfood/v04-release-manifest.mjs packages/dogfood/v04-heavy-negative-probe.mjs packages/dogfood/v04-heavy-negative-probe-check.mjs packages/dogfood/v04-heavy-negative-probe-check.test.mjs
git diff --cached --name-only
git diff --cached --check
git diff --cached
```

The staged name list must equal the eleven-file allowlist exactly.

Create and push one signed commit:

```bash
git commit -S -m "Freeze the Canvas release harness"
git push origin agent/sidproj-102-fixed-release-harness
```

Use Linear's prepared-upload flow. Prepare one file at a time. PUT the raw bytes to the signed URL. Create the attachment from the returned asset URL.

Upload only declared files from the two fresh run directories. Include both run indexes, targeted JSON, release JSON, idle JSON, matrix JSON files, mutation text, hash text, summary text, and both PNGs. Do not upload prior evidence, stale runs, secrets, or unrelated files.

Add one complete evidence comment to SIDPROJ-102. Include source hashes, commands, test counts, exact mutation results, browser order, targeted values, aggregates, identities, artifact hashes, port state, commit SHA, and final ledger.

Then:

1. Mark only SIDPROJ-102 Done.
2. Recheck live relations.
3. Add a concise closure reference to SIDPROJ-101 because SIDPROJ-102 blocks it.
4. Do not change the state of SIDPROJ-101, SIDPROJ-100, SIDPROJ-99, SIDPROJ-98, SIDPROJ-97, SIDPROJ-96, SIDPROJ-95, SIDPROJ-94, SIDPROJ-93, or SIDPROJ-70.
5. Check live Linear state before another AFK issue starts.

Do not ask for routine Linear approval. Report a system upload gate and continue safe closure checks.

## Stop rules

- Allow one correction round only.
- Allow two expensive runs only.
- Allow two source judge rounds only.
- Allow one automatic retry only after a confirmed environment condition changes.
- Do not retry a product, manifest, browser, CLI, disk, schema, truth, identity, or port contract failure.
- At 90 minutes, report elapsed time, passed gates, remaining gates, and the ledger.
- At two hours, stop the same patch loop.
- Stop if source judge round 2 fails.
- Stop if an evidence continuation fails.
- Do not start a third expensive run.

## Constraints

- Follow `AGENTS.md` and `PRODUCT.md`.
- Match the current flat-function MJS style.
- Use the minimum code that fits existing patterns.
- Keep expected truth outside product output.
- Reject extra modules, scripts, files, fields, rows, diagnostics, and free text.
- Use exact schemas, enums, orders, paths, roles, arrays, and messages.
- Use complete-file SHA-256 only for trusted source proof.
- Use actual semantic changes only for named semantic tests.
- Use real temporary disk operations for filesystem behavior.
- Preserve all unrelated dirty paths and bytes.
- Keep the product ritual, timing, and claim rules unchanged.

## Out of scope

- Do not build a source analyzer.
- Do not build an alias, taint, data-flow, or control-flow analyzer.
- Do not add a growing source-text denylist.
- Do not add a parser dependency.
- Do not use the TypeScript compiler as proof.
- Do not change Canvas Scan core timing.
- Do not change `packages/core/src/wrap-context.ts`.
- Do not change the 8 ms product threshold.
- Do not widen `[7, 8)`.
- Do not use Offscreen Canvas as a timing proxy.
- Do not let fixture code read Canvas Scan output.
- Do not accept prior evidence as input.
- Do not remove old evidence or private run directories.
- Do not change unrelated v0.5, release, package, pack, document, or workflow files.
- Do not run SIDPROJ-70 release work.
- Do not tag, publish, open a pull request, or contact an external maintainer.

STATUS: PLANNED /Users/yomi/Documents/batcave/canvas-scan/.codex/pbj-plan-sidproj-102-redesign.md
