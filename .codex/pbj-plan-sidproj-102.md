# SIDPROJ-102 implementation contract

## Falsifiable goal

SIDPROJ-102 is complete when the repository uses one fixed whole-module release harness and two fresh private evidence runs. The harness must reject every changed trusted module before Chrome. It must reject every declared browser, artifact, path, identity, and truth mutation with the exact declared reason. It must not contain a general alias, taint, data-flow, or control-flow analyzer. Two independent source judges must pass before Chrome starts. The targeted run must produce ten distinct finite Canvas2D API self-time values in `[7, 8)`. The complete idle-release run must then pass. Both fresh run directories, all disk checks, both evidence judge continuations, the signed commit, the branch push, the Linear evidence update, and the declared issue closure chain must pass.

## Live issue and relation state

- Issue: `SIDPROJ-102`, `V05-09r — Freeze the release harness and isolate fresh evidence`.
- URL: `https://linear.app/yde/issue/SIDPROJ-102/v05-09r-freeze-the-release-harness-and-isolate-fresh-evidence`.
- State during planning: `In Progress` with the `AFK` label.
- Parent: `SIDPROJ-62`, `v0.5 — Release confidence`.
- SIDPROJ-102 has no blocker.
- SIDPROJ-102 blocks SIDPROJ-101.
- It relates to SIDPROJ-100, SIDPROJ-99, SIDPROJ-95, and SIDPROJ-70.
- SIDPROJ-70 stays out of scope.
- SIDPROJ-102 has no comments, attachments, documents, or releases during planning.

The live blocked chain is:

```text
SIDPROJ-102 -> SIDPROJ-101 -> SIDPROJ-100 -> SIDPROJ-99 -> SIDPROJ-98 -> SIDPROJ-97 -> SIDPROJ-96 -> SIDPROJ-95 -> SIDPROJ-94
```

Do not close this chain before all SIDPROJ-102 gates pass. Do not close SIDPROJ-93 or SIDPROJ-70 as part of this issue.

## Why the prior model stopped

SIDPROJ-101 used its one correction round and both source-judge rounds. Both final source judges failed before Chrome. The final comment records these passed gates:

- 743 focused verifier tests.
- 63 v0.4 tests.
- 60 mutation attacks.
- 12 inherited live contracts.
- 555 core tests.
- Workspace type check.
- Core and workbench builds.
- Scoped and full diff checks.
- Seven inherited file hashes.

The judges found one model problem. The handwritten binding-aware walker did not prove control flow, runtime loop counts, browser script semantics, protected-value escape coverage, or all old-path aliases. Do not correct that walker. Remove it. Whole trusted module bytes replace general source analysis.

## Baseline and preflight status

- Branch: `agent/sidproj-102-fixed-release-harness`.
- Current `HEAD` and implementation baseline: `65decbced2257a3d15774423c9607e037b77e6fb`.
- Merge base with `origin/main`: `20e53799202a0193f6c48c9b438ec9452b80dfaf`.
- Git uses SSH signing.
- `commit.gpgsign=true`.
- `gpg.format=ssh`.
- The signing key is `/Users/yomi/.ssh/dash0_ed25519.pub`.
- Chrome is available at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
- Planning Chrome version: `151.0.7922.137`.
- Port `5190` had no listener during planning.
- `/private/tmp` is a directory with mode `1777`.
- `/private/tmp/sidproj-95-heavy-negative-probe.json` is a regular mode-`0600` file.
- Its device is `16777234`, inode is `904777482`, size is `8289`, and SHA-256 is `4d8b2292910fba995d837b392e439274b0fdf412200941f337e25ad134827d65`.
- `/private/tmp/sidproj-99-heavy-negative-probe.json` was absent.
- `/private/tmp/sidproj-100-heavy-negative-probe.json` was absent.
- A stale private directory named `/private/tmp/sidproj-95-heavy-negative-probe-o2Vdr8` exists. Preserve it. Never use it as input.
- The Linear prepared-upload and attachment APIs are available.
- Closure upload needs direct raw-byte PUT requests to Linear signed URLs. A system network gate can apply at that step.
- The focused probe suite passed 743 tests during planning.
- The v0.4 lab suite passed 63 tests during planning.
- `git diff --check` passed during planning.

The exact run ledger starts at:

```text
correction rounds: 0/1
expensive runs: 0/2
judge rounds: 0/2
```

## Complete inherited dirty tree

The exact initial `git status --short --branch --untracked-files=all` path set follows. Preserve every path and every unrelated byte.

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
packages/dogfood/v04-heavy-negative-probe-check.mjs
packages/dogfood/v04-heavy-negative-probe-check.test.mjs
packages/dogfood/v04-heavy-negative-probe.mjs
packages/dogfood/v05-bench-diagnostic.ts
```

This plan adds `.codex/pbj-plan-sidproj-102.md` as one more untracked planning file. Do not stage any `.codex/` file or `AGENTS.md`. Do not reset, clean, stash, restore, remove, or format unrelated paths.

## Planning hashes

```text
2db19bed3ced4686be7120b3d7d77501bc5751c06d415fc618166cff4cc63799  apps/workbench/public/v04-lab.html
b9c9130c9bb3ba8e5281fe0cd34bb05038f049cc6861361803bd983b73a1c256  apps/workbench/src/v04-lab-main.tsx
9abedde3ef8c1feac6aa3398a92f529d2d99119d9b0bd3072f234de1008c9d98  apps/workbench/src/V04Lab.tsx
ca1a7a66360a77e2fce4bfe42030bb1eaf5dea16ae7b1049abb59d9b804effe9  packages/dogfood/lab-v04-truth.mjs
91970eb07365ca7abe3bab79b78ab35984ba997ebead5a6d72ce3d89549f80be  packages/dogfood/lab-v04.mjs
95888d4d6cbe7d0177f3db8f476100bbdf596e9a1c20f400a0c445fb63f9d687  packages/dogfood/lab-v04.test.mjs
8cd1a36abb6ce9b3fd67582be444cb5c34b6a72dab57af34864e046ff0b2997b  packages/dogfood/v04-heavy-negative-probe.mjs
2b38713b6e9288969d8f7ca6c8aa65f87e8621c56cb8029a0d2b0cc0635c9910  packages/dogfood/v04-heavy-negative-probe-check.mjs
9ddf7bd660f3b0555bfd605da45f1e7bbc59f870842012657388cc2b07e8e24d  packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

The builder must record new source-freeze hashes after implementation. The release manifest must contain those new hashes. Do not use the planning hashes as final manifest values.

## Fixed trust model

### Trust root

Add `packages/dogfood/v04-release-manifest.mjs`. This file is the reviewed repository trust root. It cannot list its own digest. The final source judges and the signed Git commit bind this trust-root file.

Export one deeply frozen object named `releaseManifest`. Use this exact shape:

```js
{
  schemaVersion: 1,
  algorithm: 'sha256',
  modules: [
    { role, path, sha256 },
    // exact ordered entries below
  ],
}
```

Each entry must have exactly `role`, `path`, and `sha256`. Each digest must use 64 lowercase hexadecimal characters. Paths must be repository-relative POSIX paths. Reject an extra field, entry, role, path, or digest.

### Exact ordered trusted module manifest

Use this exact order. Do not sort it at runtime.

```text
browser-document       apps/workbench/public/v04-lab.html
bootstrap              apps/workbench/src/v04-lab-main.tsx
calibration-fixture    apps/workbench/src/V04Lab.tsx
repository-truth       packages/dogfood/lab-v04-truth.mjs
release-runner-checker packages/dogfood/lab-v04.mjs
release-contract-tests packages/dogfood/lab-v04.test.mjs
evidence-directory     packages/dogfood/v04-evidence-run.mjs
targeted-runner        packages/dogfood/v04-heavy-negative-probe.mjs
targeted-checker       packages/dogfood/v04-heavy-negative-probe-check.mjs
targeted-contract-tests packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

Add `packages/dogfood/v04-evidence-run.mjs`. Export the exact ordered role/path specification separately from digest values. Export flat functions for manifest checks, run-directory creation, final-file creation, safe reads, directory checks, run-index checks, and identity-bound temporary cleanup.

The manifest check must:

1. Check the exact manifest schema and exact ordered role/path specification.
2. Resolve each path below the repository root.
3. Reject a path that escapes the root.
4. Open and hash the complete file bytes.
5. Reject a missing, extra, renamed, reordered, or changed module.
6. Return the exact checked module list for `run.json`.

Do not parse any trusted module. Do not inspect identifier names. Do not use partial source text or regular expressions as proof. Remove `virtualProgram()`, `singleProgram()`, `sourceProof()`, `oldPathTargetFailures()`, carrier propagation, sink inference, alias bounds, and the TypeScript compiler import from the targeted checker. Do not replace them with Babel, Acorn, another parser, a text denylist, or another analyzer.

The fixed manifest is a release allowlist. It is not a general integrity framework. Do not reuse it for arbitrary repository files.

## File and symbol changes

### `packages/dogfood/v04-evidence-run.mjs` — new fixed evidence-directory API

Use flat functions. Do not add a class.

Export these symbols:

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
sha256
```

`createEvidenceRun(kind, options)` accepts only `kind: 'targeted' | 'idle-release'`. Production options must not accept an existing run directory, artifact path, prior artifact, or evidence bytes.

Create the directory with these rules:

- Root: exact `/private/tmp`.
- Name: `sidproj-102-${kind}-${runId}`.
- `runId`: a new UUID v4 from `randomUUID()`.
- Create it with one non-recursive `mkdir(path, { mode: 0o700 })` call.
- Treat `EEXIST` as `run directory exists`.
- Use `lstat()` after creation.
- Require a real directory, no symbolic link, mode `0700`, the exact parent, and the exact UUID name.
- Record its device and inode.
- Never follow a replacement path.

`writeFinalArtifact(run, name, bytes)` must:

- Accept only the exact artifact allowlist for the run kind.
- Reject `/`, `\\`, `.`, `..`, an absolute name, or a path outside the recorded directory.
- Check the directory device and inode before and after the write.
- Open the final path with `wx`, `O_NOFOLLOW`, and mode `0600`.
- Write, sync, and close the handle.
- Check the handle and path device/inode, regular-file type, mode `0600`, and link count `1`.
- Treat `EEXIST` as `final artifact exists`.
- Never rename, copy, link, chmod, replace, or remove a final artifact.

`readCurrentArtifact(run, name)` must open with `O_RDONLY | O_NOFOLLOW`. It must use the handle bytes. It must compare handle and path device/inode before and after the read. It must require link count `1`, mode `0600`, and the recorded parent directory identity. Reject a symbolic link, hard link, missing file, replaced path, or outside path.

`removeOwnedTemporary()` is only for a non-final temporary file. It must compare the recorded directory and file device/inode immediately before `unlink()`. It must never accept a final artifact name. If implementation needs no evidence temporary file, keep this function covered by focused tests and do not call it in production.

Do not remove a failed or complete run directory. A partial run remains isolated. The operator can review it. This issue does not authorize cleanup of old evidence.

### Run index schema

Write `run.json` last with `wx` and mode `0600`. It has exactly these top-level keys:

```text
schemaVersion
issue
kind
runId
startedAt
endedAt
directory
source
artifacts
```

Exact values and nested schemas:

```js
{
  schemaVersion: 1,
  issue: 'SIDPROJ-102',
  kind: 'targeted' | 'idle-release',
  runId: '<UUID v4 that equals the directory suffix>',
  startedAt: '<canonical UTC millisecond timestamp>',
  endedAt: '<canonical UTC millisecond timestamp>',
  directory: {
    mode: '0700',
    device: '<positive decimal string>',
    inode: '<positive decimal string>',
  },
  source: {
    gitSha: '<40 lowercase hex>',
    chromeRevision: '<four-part numeric version>',
    bundleSha256: '<64 lowercase hex>',
    manifestSha256: '<64 lowercase hex of complete manifest bytes>',
    modules: [
      { role: '<declared role>', path: '<declared path>', sha256: '<64 lowercase hex>' },
    ],
  },
  artifacts: [
    { name: '<exact basename>', role: '<exact role>', size: '<positive decimal string>', sha256: '<64 lowercase hex>' },
  ],
}
```

The `artifacts` array does not list `run.json`. It lists every other final artifact in the exact run-kind order. `checkRunIndex()` recomputes every size and digest from the current directory. It rejects extra files, missing files, extra rows, reordered rows, duplicate names, extra fields, and stale timestamps.

### Exact artifact file sets

The targeted directory contains exactly:

```text
targeted.json           targeted-evidence
run.json                run-index
```

The idle-release directory contains exactly:

```text
canvas-lab-v0.4.json        matrix-primary
variant-matrix.json         matrix-projection
nearest-negatives.json      negative-projection
console-summary.txt         console-summary
integrated-continuous.png   continuous-screenshot
integrated-burst.png        burst-screenshot
mutation-output.txt         mutation-evidence
idle-boundary.json          idle-evidence
release-evidence.json       release-evidence
sha256.txt                  artifact-manifest
run.json                    run-index
```

No checker can read a file outside the current run directory, except the fixed release manifest, trusted repository modules, `packages/core/package.json`, the current built IIFE, Git `HEAD`, Chrome version, and port state. Those inputs are repository truth or current environment truth.

### `apps/workbench/public/v04-lab.html` — fixed browser document

Keep the styles and DOM shell. Remove the React refresh preamble script. Use exactly these three script elements after the dynamic IIFE append completes:

1. One classic inline options script in `<head>`.
2. One external module application entry with raw `src="/src/v04-lab-main.tsx"`.
3. One dynamically appended classic IIFE with raw `src="/canvas-scan.iife.js"`.

The options script must use `Object.defineProperty()` to create one own, non-writable, non-configurable `window.__CANVAS_SCAN_OPTS` value. Freeze the exact value `{ overlay: true }`. Do not use an assignment that a later script can replace.

The document must contain no other script element. Do not add JSON scripts, import maps, preload scripts, inline diagnostics, Vite preamble code, or another loader.

### `apps/workbench/src/v04-lab-main.tsx` — trusted bootstrap

Keep the exact current native capability behavior:

1. Capture `CanvasRenderingContext2D.prototype`.
2. Capture `putImageData`.
3. Capture `fillRect`.
4. Capture `clearRect`.
5. Create one detached HTML canvas.
6. Set width `1280` and height `560`.
7. Get one same-realm `2d` context.
8. Check receiver, dimensions, and the three exact native functions.
9. Freeze exactly `{ canvas, context, putImageData, fillRect, clearRect }`.
10. Create one script with raw `/canvas-scan.iife.js`.
11. Resolve only from `script.onload`.
12. Reject only from `script.onerror`.
13. Append once to `document.head`.
14. Await the loader.
15. After the await, import `react`, `react-dom/client`, and `./V04Lab` once each.
16. Render one direct `nativeCanvas2D` prop.

Do not add a runtime export, global, DOM property, state value, log, error value, hash input, diagnostic, screenshot input, or callback that contains a native function, canvas, context, or capability.

The manifest, not a general source analyzer, binds this behavior. Focused semantic mutations change module bytes and must fail `trusted module digest`.

### `apps/workbench/src/V04Lab.tsx` — trusted calibration fixture

Keep the current exact same-realm native calibration, shared operation plan, 200 inherited trailing calls, final paint, geometry, colors, caps, and `[7, 8)` target. Keep expected product truth out of this module.

Make runtime count evidence explicit. The calibration object must include these exact integer fields:

```text
declaredWarmupCallCount = 2
observedWarmupCallCount = 2
declaredPrimitiveSampleCount = 3
observedPrimitiveSampleCount = 3
declaredFixedPlanSampleCount = 3
observedFixedPlanSampleCount = 3
```

Increment observed counts at the actual call sites. Derive saved sample arrays only from events whose phase is `saved`. Check the exact capability before the fixture sets `ready`. Do not add a second readiness path.

The fixture can expose measured fixture output through its existing fixture snapshot. It must not read Canvas Scan globals, reports, findings, canvases, copied product conclusions, expected rows, checker output, or release artifacts.

### `packages/dogfood/lab-v04-truth.mjs` — repository truth

Keep this module as the only expected row and product-claim truth source. Keep the exact 53-row order, 60 attacks, numeric boundaries, honest `unknown`, lifecycle rules, association rules, and product/primitive separation.

Add or keep a closed support rule for command status. An `unknown` can become `same` or `changed` only when the current artifact contains the measured support that the declared truth rule needs. A copied result string, expected boolean, row pass flag, or fixture label cannot provide support.

Do not import the runner, checker, product bundle, or browser artifact into repository truth.

### `packages/dogfood/lab-v04.mjs` — complete release runner and checker

Replace stable `/private/tmp/sidproj-*` evidence paths, `atomicWrite()`, and pre-run `removeOwned()` calls with the new evidence-run API. `--idle-release` must create one new `idle-release` directory. It must never read or remove prior SIDPROJ-55, SIDPROJ-86, SIDPROJ-90, SIDPROJ-95, SIDPROJ-99, SIDPROJ-100, or SIDPROJ-101 evidence.

Keep these exact existing payload schemas and closed validators:

- Primary lab JSON: `schemaVersion`, `lab`, `runId`, `startedAt`, `endedAt`, `gitSha`, `dirty`, `browser`, `product`, `scenarios`, `matrixCoverage`, `diagnostics`, `pass`.
- Matrix JSON: `schemaVersion`, `lab`, `runId`, `rows`.
- Nearest-negative JSON: `schemaVersion`, `lab`, `runId`, `rows`.
- Idle JSON: `schemaVersion`, `runId`, `matrixRunId`, `startedAt`, `endedAt`, `chromeRevision`, `gitSha`, `bundleSha256`, `harnessSha256`, `counterexample`, `rows`, `diagnostics`, `port`.
- Release JSON: `schemaVersion`, `releaseRunId`, `startedAt`, `endedAt`, `environment`, `phases`, `diagnostics`, `port`.
- Mutation text: exactly `mutationRunId`, `parentRunId`, `startedAt`, `endedAt`, and `failure` lines.
- Hash text: one normalized lowercase SHA-256 line for each non-index artifact in exact artifact order.
- Summary text: the existing exact header, row lines, diagnostics lines, and new relative artifact basenames.
- PNG files: the existing exact strict 1440 by 1000 RGB schema and complete compressed-stream check.

Change only path fields and artifact names that must become run-relative. Do not add absolute paths to artifact payloads. Do not add free text or hidden diagnostics.

Change `evaluateCapture()` and related calls so repository truth, product output, fixture measurement, and browser environment are separate arguments. The runner can combine them only after each input passes its own closed schema. The fixture output cannot supply an expected finding or command status.

The release checker must accept one explicit current run object from the same invocation, or one explicit current run directory from the CLI. It must reject a regular-file argument. It must not find a latest directory, scan for an old run, accept a default old path, or accept more than one directory argument.

### Browser-semantic contract

Add one closed `browserContract` object to targeted evidence and to each release phase environment. It has exactly:

```js
{
  scripts: [
    { role: 'options', kind: 'classic-inline', rawSrc: null, resolvedPath: null, query: '', fragment: '' },
    { role: 'application', kind: 'module-external', rawSrc: '/src/v04-lab-main.tsx', resolvedPath: '/src/v04-lab-main.tsx', query: '', fragment: '' },
    { role: 'canvas-scan', kind: 'classic-external', rawSrc: '/canvas-scan.iife.js', resolvedPath: '/canvas-scan.iife.js', query: '', fragment: '' },
  ],
  options: {
    own: true,
    frozen: true,
    writable: false,
    configurable: false,
    keys: ['overlay'],
    overlay: true,
  },
  ready: {
    canvasScan: true,
    fixture: true,
    capabilityValidated: true,
  },
}
```

Collect this object from browser semantics after fixture readiness. Use `document.scripts`, each script's raw `getAttribute('src')`, resolved `URL`, script type, the own property descriptor, `Object.isFrozen()`, Canvas Scan presence, and the fixture's scalar validation flag. Do not serialize native values.

Require three and only three document script elements. Reject an inert option script, another executable inline script, another loader, another application entry, a later option override, a query, a fragment, an entity-decoded alternate source, a relative source, or a different resolved origin/path.

The whole-module digest proves bootstrap statement order. The browser contract proves the served document semantics and current execution result. Do not add a general control-flow check.

### `packages/dogfood/v04-heavy-negative-probe.mjs` — targeted runner

Remove `artifactPath`, `productionPublicationRequest()`, hard-link publication, and all stable final-path behavior. Create one targeted evidence run before the build and browser start. Stop if directory creation fails. Do not accept a path argument.

Keep process ownership, drain acknowledgement, ten captures, one accepted run, zero drops, diagnostics, port proof, build, bundle copy, and Chrome flow. Collect repository truth and Canvas Scan product output through separate local values. Pass them separately to the artifact builder.

Write `targeted.json` only after all ten captures, cleanup, port checks, source identity checks, browser checks, and `validateProbeExit()` pass. Then write `run.json`. Run the independent checker against the same recorded directory identity before the command prints success.

Print these final lines:

```text
SIDPROJ_102_TARGETED_RUN_DIR: <absolute fresh directory>
SIDPROJ_102_TARGETED_PROBE: PASS
```

### Targeted artifact schema

Use `schemaVersion: 2`. The top-level keys are exactly:

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
manifestSha256
modules
browserContract
diagnostics
port
```

Each run row has exactly:

```text
iteration
canvasApiSelfTimeMs
acceptedRunCount
droppedEntryCounts
calibration
```

Keep the existing exact calibration schema. Replace its three old count names with the six declared/observed count fields above. Keep all other constants, arrays, dimensions, timing values, plan counts, derived values, caps, and enum strings closed.

Require ten rows, ten distinct finite values in `[7, 8)`, exact aggregates, one accepted run per row, exact zero drops, empty diagnostics, current identities, exact browser contract, and an empty port.

### `packages/dogfood/v04-heavy-negative-probe-check.mjs` — targeted checker

Keep `validCalibration()`, `checkArtifact()`, total failure arrays, current identity checks, browser checks, port checks, and the CLI. Replace `harnessSha256` with the fixed manifest digest and checked complete module entries.

The CLI accepts exactly one absolute targeted run directory. It rejects no argument, more than one argument, a file, a symbolic link, a hard-linked artifact, a wrong prefix, a wrong UUID, a stale run, an idle-release run, or a path outside `/private/tmp`.

The checker can read only:

- `targeted.json` and `run.json` from that directory.
- `packages/dogfood/v04-release-manifest.mjs`.
- Complete trusted module bytes from the manifest.
- Current `HEAD`, built IIFE bytes, Chrome version, and port state.

It must not read SIDPROJ-95, SIDPROJ-99, SIDPROJ-100, SIDPROJ-101, or another SIDPROJ-102 directory. It must reject old artifact filenames and old schema version `1` before any content can certify the run.

Use this exact stable failure order:

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

Return each label once. Do not expose filesystem paths or artifact content in errors.

### Test files

Update `packages/dogfood/v04-heavy-negative-probe-check.test.mjs` and `packages/dogfood/lab-v04.test.mjs`. Remove tests for the general binding-aware analyzer. Keep all artifact, telemetry, total-validator, process, port, disk, race, truth, PNG, lifecycle, association, 60 attack, and 12 live-contract tests that still apply.

Use fresh test roots under the test runner's temporary directory. Never access a production evidence directory. Every mutation must assert the exact complete failure array or exact thrown message.

## Required mutation corpus

### Fixed module mutations

Each case must fail only with its declared manifest reason:

- Change one byte in each trusted module -> `trusted module digest`.
- Remove each trusted module -> `trusted module set`.
- Add one module -> `trusted module set`.
- Rename one module path -> `trusted module set`.
- Swap each adjacent pair -> `trusted module order`.
- Change one declared role -> `trusted module set`.
- Use a missing, short, uppercase, non-hex, or extra digest -> `manifest schema` or `trusted module digest`, as declared by the case.

Apply the semantic source mutations below without changing the fixed manifest. Each must fail `trusted module digest`:

- Move capability validation after ready.
- Put capability validation in dead code.
- Validate the wrong value.
- Change a warm-up loop count.
- Change a saved primitive loop count.
- Change a saved fixed-plan loop count.
- Read Canvas Scan output through `window`, `globalThis`, `self`, `document.defaultView`, an alias, a callback, or a computed property.
- Put a native value in a global, DOM node, state value, export, return, log, error, diagnostic, hash, or screenshot input.
- Add another loader, application entry, dynamic import, or capability handoff.

### Browser-semantic mutations

Unit-test the closed browser-contract checker directly. Each case must fail one exact label:

- Inert options script -> `browser options`.
- Later options override -> `browser scripts`.
- Another executable inline script -> `browser scripts`.
- Relative IIFE URL -> `browser scripts`.
- Entity-encoded IIFE URL -> `browser scripts`.
- IIFE query -> `browser scripts`.
- IIFE fragment -> `browser scripts`.
- Different IIFE path -> `browser scripts`.
- Another loader or application entry -> `browser scripts`.
- Dynamic import represented as another script -> `browser scripts`.
- Missing or mutable options descriptor -> `browser options`.
- Extra option key or unfrozen value -> `browser options`.
- Missing Canvas Scan, fixture readiness, or capability validation -> `bootstrap ready`.

### Fresh directory and file mutations

Use real disk operations in fresh private test roots. Cover these exact cases:

- Pre-create the chosen run directory -> `run directory exists`.
- Replace the run directory after creation -> `run directory`.
- Use mode other than `0700` -> `run directory`.
- Place the run outside the exact root -> `run directory`.
- Pre-create a final regular file, symbolic link, or directory -> `final artifact exists`.
- Replace a final path during write or read -> `artifact identity`.
- Add a hard link -> `artifact identity`.
- Add an unexpected file -> `artifact set`.
- Remove or rename an expected file -> `artifact set`.
- Reorder the run-index artifact rows -> `artifact set`.
- Copy or rename an SIDPROJ-95, SIDPROJ-99, SIDPROJ-100, or SIDPROJ-101 artifact into the run -> `artifact set` or `artifact schema`.
- Supply a direct old artifact path instead of a directory -> `run directory`.
- Supply another SIDPROJ-102 directory -> `run directory` or freshness failure.
- Try link, rename, copy, removal, or replacement calls through the injected file API -> the helper must reject the unsupported API or preserve all final files.
- Remove an owned temporary before cleanup -> exact identity failure.
- Replace an owned temporary before cleanup -> exact identity failure and preserve the replacement.

The production API has no old evidence input. Do not test or implement alias analysis for old paths. Test the API boundary and disk identity instead.

### Artifact and truth mutations

For each JSON object, row, enum, array, and text schema:

- Remove each required field.
- Add one extra field.
- Add one extra row or file.
- Reorder each ordered row set.
- Use duplicate JSON keys.
- Use negative, fractional, non-finite, stale, future, or inconsistent values where invalid.
- Change one of the ten targeted values to `6.999`.
- Change one targeted value to `8`.
- Duplicate one targeted value and coordinate rows and aggregates.
- Change minimum, maximum, or median.
- Add a diagnostic, drop, instrumentation kill, request query, or unsupported evidence.
- Change an honest `unknown` to `same` without measured support -> `unknown support`.
- Change an honest `unknown` to `changed` without measured support -> `unknown support`.
- Copy a product conclusion into expected truth -> `artifact truth`.
- Change product output and copied expected output together -> `artifact truth`.
- Hide a conclusion in a diagnostic or free-text field -> schema or diagnostics failure.
- Change declared and observed runtime counts together in the artifact -> `runtime counts`, because trusted runtime arrays and event phases do not match.

Keep exact failure arrays. Do not assert only that a failure list is nonempty.

## Inherited contracts that stay active

- Same-realm HTML Canvas2D native capture occurs before Canvas Scan loads.
- The detached canvas stays outside the DOM, product state, telemetry, diagnostics, screenshots, and artifacts.
- Native and wrapped paths use one exact ordered operation plan.
- The plan contains `callCount + 204` native calls and four style steps.
- The plan includes one full `1280` by `560` background fill.
- The plan uses cyan geometry `(72, 96, 328, 176)`.
- The plan uses purple geometry `(528, 96, 224, 176)`.
- The call-count cap occurs before final plan construction.
- Warm-up calls stay outside saved samples and recording.
- The 50 ms preflight, 12 ms measured-work, 2048 iteration, 200 trailing-operation, and one-final-paint bounds stay exact.
- The 8 ms product threshold stays exact.
- The targeted band stays `[7, 8)`.
- Product truth and primitive truth stay independent.
- An honest `unknown` stays valid.
- Ten captures, one accepted run each, zero drops, empty diagnostics, and current identities stay mandatory.
- Port ownership, bounded process stop, drain acknowledgement, strict PNG proof, idle proof, lifecycle proof, association proof, and complete-set checks stay active.
- SIDPROJ-95 evidence stays byte-identical.

## Verification funnel

Run the gates in this order. Stop at the first product or contract failure.

### 1. Focused checks

Classification: focused.

```bash
node --test packages/dogfood/v04-heavy-negative-probe-check.test.mjs
pnpm --filter dogfood run lab:v0.4:test
git diff --check -- apps/workbench/public/v04-lab.html apps/workbench/src/v04-lab-main.tsx apps/workbench/src/V04Lab.tsx packages/dogfood/lab-v04-truth.mjs packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs packages/dogfood/v04-evidence-run.mjs packages/dogfood/v04-release-manifest.mjs packages/dogfood/v04-heavy-negative-probe.mjs packages/dogfood/v04-heavy-negative-probe-check.mjs packages/dogfood/v04-heavy-negative-probe-check.test.mjs
shasum -a 256 /private/tmp/sidproj-95-heavy-negative-probe.json
```

Require every declared manifest, browser, disk, artifact, runtime-count, old-evidence boundary, and truth mutation. Require 63 v0.4 tests, all 60 attacks, and all 12 live contracts. Report the focused test count. Do not pad it.

### 2. Standard checks

Classification: standard.

```bash
pnpm --filter canvas-scan test
pnpm typecheck
pnpm --filter canvas-scan run build
pnpm --filter workbench exec vite build
git diff --check
git status --short --branch --untracked-files=all
git diff --name-only
git diff --stat 65decbced2257a3d15774423c9607e037b77e6fb -- apps/workbench/public/v04-lab.html apps/workbench/src/v04-lab-main.tsx apps/workbench/src/V04Lab.tsx packages/dogfood/lab-v04-truth.mjs packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs packages/dogfood/v04-evidence-run.mjs packages/dogfood/v04-release-manifest.mjs packages/dogfood/v04-heavy-negative-probe.mjs packages/dogfood/v04-heavy-negative-probe-check.mjs packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

Require at least 555 core tests. Require all type checks and both builds. Require the manifest to match complete current module bytes. Compare every unrelated dirty path with the initial status and bytes.

Do not run these commands before source judges pass:

```text
node packages/dogfood/v04-heavy-negative-probe.mjs
pnpm --filter dogfood run lab:v0.4 -- --idle-release
```

### 3. Source judges

Classification: standard judge gate. Freeze the source after focused and standard checks pass.

Start two fresh independent source judges on the same unchanged tree. Give each judge:

- This complete plan and the complete live SIDPROJ-102 text.
- The SIDPROJ-101 final judge comment.
- The complete eleven-file closure diff.
- The fixed manifest and every full trusted module.
- The complete mutation corpus and test output.
- The dirty-tree baseline and preservation checks.
- The current ledger.

Do not give either judge the other report. Tell each judge to inspect every changed hunk. Tell each judge to return all P1 and P2 findings in one terminal report.

Each judge must try to refute the trust-root boundary, manifest completeness, browser semantics, fixture independence, runtime counts, fresh-directory exclusivity, no-follow identity checks, file-set closure, artifact schemas, unknown support, process cleanup, port cleanup, and unrelated-path preservation.

Both judges must return `PASS` before Chrome starts. Set `judge rounds: 1/2`. If either fails, collect both reports before one correction batch. Add every accepted counterexample to focused and disk tests. Run focused and standard checks again. Start judge round 2. If either round-2 source judge fails, stop.

### 4. Expensive run 1 — targeted ten-capture run

Classification: expensive. Root owns this run.

Before the command, check Chrome, port `5190`, the SIDPROJ-95 artifact identity and hash, manifest bytes, and `/private/tmp` mode. Do not check for or remove a prior SIDPROJ-102 directory. The runner always creates a new unpredictable directory.

Run exactly once:

```bash
node packages/dogfood/v04-heavy-negative-probe.mjs
```

Set `expensive runs: 1/2`.

The command must create and check one fresh targeted directory. It must print `SIDPROJ_102_TARGETED_PROBE: PASS`. Record the exact printed directory path, device, inode, mode, file list, sizes, and hashes.

Require exactly ten distinct finite values in `[7, 8)`. Recompute minimum, maximum, and median. Require one accepted run per capture, exact runtime counts, zero drops, empty diagnostics, current source identities, exact browser semantics, mode `0700` directory, two mode-`0600` files with link count `1`, and an empty port.

Stop on a product, manifest, browser, writer, checker, schema, truth, identity, or port failure. Do not start expensive run 2.

### 5. Expensive run 2 — complete idle release

Classification: expensive. Root owns this run.

Run exactly once after expensive run 1 and all its checks pass:

```bash
pnpm --filter dogfood run lab:v0.4 -- --idle-release
```

Set `expensive runs: 2/2`.

The command must create and check one fresh idle-release directory. It must print the directory and all existing v0.4 PASS markers. Require 20 idle rows, 53 matrix rows, the exact mutation failure, strict PNGs, exact hashes, current identities, empty diagnostics, zero drops, exact browser semantics, exact file set, mode `0700` directory, eleven mode-`0600` files with link count `1`, and port cleanup.

Do not start a third expensive run.

### 6. Standard disk checks after evidence

Classification: standard.

Run these commands with the two exact directory paths that the runners printed:

```bash
node packages/dogfood/v04-heavy-negative-probe-check.mjs /private/tmp/sidproj-102-targeted-<TARGETED_UUID>
pnpm --filter dogfood run lab:v0.4 -- --check-evidence /private/tmp/sidproj-102-idle-release-<RELEASE_UUID>
/usr/sbin/lsof -nP -iTCP@127.0.0.1:5190 -sTCP:LISTEN
shasum -a 256 /private/tmp/sidproj-95-heavy-negative-probe.json
```

`<TARGETED_UUID>` and `<RELEASE_UUID>` mean the exact UUIDs printed by the two completed runner commands. Do not use `find`, a latest-directory scan, a glob, or an old default path.

Rerun all focused checks, all standard checks, the manifest check, and full file identity checks. Recompute every artifact hash from the opened current handles. Check that no old evidence file changed.

### 7. Evidence judge continuations

Send fresh evidence to the same two independent judge streams. If source round 1 passed, this review consumes `judge rounds: 2/2`. If a correction used round 2, treat this step as a continuation of those open judge streams.

Give each judge:

- The final frozen eleven-file diff and manifest.
- Both fresh `run.json` files.
- Every artifact from both fresh directories.
- All targeted values and recomputed aggregates.
- All calibration arrays and runtime counts.
- Browser-contract objects and raw script facts.
- Directory and file device, inode, mode, link-count, size, and hash facts.
- The SIDPROJ-95 identity and hash.
- Chrome, Git, bundle, source, port, diagnostics, and drop facts.
- The final ledger.

Do not share one judge report with the other judge. Both judges must return `PASS`.

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

Do not stage `packages/dogfood/package.json`. Existing scripts already expose the needed lab commands. Do not stage plans, `AGENTS.md`, unrelated v0.5 release files, package files, pack files, core test files, documents, or generated bundle files.

## Signed commit, push, upload, and Linear continuation

Start closure only after every gate and both evidence judges pass.

1. Check the complete dirty tree and diff.
2. Check the fixed manifest against complete current bytes.
3. Check the SIDPROJ-95 identity and hash again.
4. Stage only the eleven-file allowlist.
5. Check the staged name list, staged diff, and staged diff whitespace.
6. Create one signed commit.
7. Push the current issue branch.
8. Upload only the two fresh run directories' declared files to SIDPROJ-102.
9. Attach `targeted.json`, both `run.json` files, `release-evidence.json`, `idle-boundary.json`, the primary and projection JSON files, mutation text, hash text, summary text, and both PNGs.
10. Do not upload SIDPROJ-95, SIDPROJ-99, SIDPROJ-100, SIDPROJ-101, a stale directory, secrets, or unrelated files.
11. Add the source, test, manifest, mutation, browser, evidence, aggregate, identity, hash, port, commit, and ledger summary to SIDPROJ-102.
12. Mark SIDPROJ-102 Done.
13. Add the same closure summary to SIDPROJ-101, SIDPROJ-100, SIDPROJ-99, SIDPROJ-98, SIDPROJ-97, SIDPROJ-96, SIDPROJ-95, and SIDPROJ-94.
14. Mark those eight issues Done only after a fresh relation check proves this commit and evidence satisfy their open acceptance.
15. Do not mark SIDPROJ-93 or SIDPROJ-70 Done.
16. Check live Linear state before another AFK issue starts.

Use this exact staging command:

```bash
git add -- apps/workbench/public/v04-lab.html apps/workbench/src/v04-lab-main.tsx apps/workbench/src/V04Lab.tsx packages/dogfood/lab-v04-truth.mjs packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs packages/dogfood/v04-evidence-run.mjs packages/dogfood/v04-release-manifest.mjs packages/dogfood/v04-heavy-negative-probe.mjs packages/dogfood/v04-heavy-negative-probe-check.mjs packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

Run these staged checks:

```bash
git diff --cached --name-only
git diff --cached --check
git diff --cached
```

Create and push the signed commit:

```bash
git commit -S -m "Freeze the Canvas release harness"
git push origin agent/sidproj-102-fixed-release-harness
```

Use Linear's prepared upload flow. Prepare one file at a time. PUT its raw bytes to its signed URL. Then create the attachment from the returned asset URL. Do not ask for routine Linear approval. If the system blocks the raw PUT, report that gate early and continue all safe closure checks.

## Stop rules and circuit breakers

- A correction round is one batch that addresses both complete source-judge reports.
- An expensive run is one targeted or complete Chrome evidence run.
- A judge round has two independent judges on one unchanged source tree.
- Allow one automatic retry only after a confirmed browser, port, network, or fixture timing environment failure changes.
- Do not retry a product, manifest, browser contract, writer, checker, schema, truth, identity, or port contract failure.
- At 90 minutes, report elapsed time, passed gates, remaining gates, and the exact ledger.
- At two hours, stop the same patch loop.
- If source judge round 2 fails, stop and report the proof-model blocker.
- If an evidence continuation fails, stop and report the evidence-model blocker.
- Do not start a third expensive run automatically.

## Constraints

- Follow `AGENTS.md` and `PRODUCT.md`.
- Match the current flat-function MJS style.
- Keep expected truth outside product output.
- Reject extra modules, files, fields, rows, scripts, diagnostics, and free text.
- Use exact enums, schemas, orders, paths, and roles.
- Use whole-file SHA-256 only for trusted module proof.
- Use exclusive create-once directory and artifact operations.
- Preserve every unrelated dirty path and byte.
- Keep the product ritual and claim rules unchanged.

## Out of scope

- Do not retain or add a general alias analyzer.
- Do not retain or add taint, data-flow, control-flow, heap, or lexical-binding analysis.
- Do not add a growing source-text denylist.
- Do not add a parser dependency or use the TypeScript compiler as proof.
- Do not change Canvas Scan core timing or `packages/core/src/wrap-context.ts`.
- Do not change the 8 ms product threshold.
- Do not widen `[7, 8)`.
- Do not use Offscreen Canvas as a timing proxy.
- Do not let fixture code read Canvas Scan output.
- Do not use prior evidence as input.
- Do not clean up old evidence or old private directories.
- Do not change unrelated v0.5, release, package, pack, document, or workflow files.
- Do not run SIDPROJ-70 release work.
- Do not tag, publish a package, open a pull request, or contact an external maintainer.
