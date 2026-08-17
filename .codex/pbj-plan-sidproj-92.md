# SIDPROJ-92 implementation contract

## Falsifiable goal

SIDPROJ-92 is complete when the checker rejects the exact split-association row and the exact trailing-IDAT-input PNG. The complete baseline live truth suite and all 60 existing disk attacks must pass. Two independent source judges must pass before one Chrome run. The fresh disk evidence and both judge continuations must then pass.

## Live issue and baseline

- Linear issue: `SIDPROJ-92`, `V05-09h — Bind referenced association support and strict PNG input`.
- URL: `https://linear.app/yde/issue/SIDPROJ-92/v05-09h-bind-referenced-association-support-and-strict-png-input`.
- Live state during planning: `In Progress`, label `AFK`, no blocker.
- Relations: SIDPROJ-92 blocks SIDPROJ-91. It relates to SIDPROJ-90 and SIDPROJ-70.
- SIDPROJ-91 remains `In Progress` and has SIDPROJ-92 as its only live blocker.
- Branch: `agent/sidproj-92-association-png-closure`.
- Baseline commit and current `HEAD`: `65decbced2257a3d15774423c9607e037b77e6fb`.
- Current Chrome: `151.0.7922.137`.
- Port `5190` had no listener during planning.
- Git uses SSH signing. `commit.gpgsign=true` and `gpg.format=ssh`.
- The current focused suite passed 37 tests and ran all 60 named attacks:

  ```text
  pnpm --filter dogfood run lab:v0.4:test
  ```

- `git diff --check` passed during planning.
- The final SIDPROJ-91 Linear report records 555 passing core tests, workspace type checks, both builds, and diff checks.
- SIDPROJ-91 used correction `1/1`, evidence `0/2`, and judge `2/2`. Do not continue that ledger.
- No Chrome evidence run was spent for SIDPROJ-91.

## Current gaps

The current two-file change contains the SIDPROJ-91 dual-observation model. Keep that model, but close these exact gaps:

1. `primitiveAssociationActual()` can get primitive truth from one LoAF and episode pair.
2. `associationsBound()` can separately bind the product association to another overlapping pair that has no working canvas.
3. `validPng()` uses `inflateSync(Buffer.concat(idat))`, which accepts unused bytes after the zlib stream.
4. The current live tests summarize the baseline suite, but they removed multiple baseline assertions.

## Owned files and dirty-tree boundary

Only these source files belong to SIDPROJ-92:

```text
packages/dogfood/lab-v04.mjs
packages/dogfood/lab-v04.test.mjs
```

The worktree also contains unrelated v0.5, pack, release, documentation, package, and workflow files. Do not change, format, restore, remove, stage, or commit any unrelated path. Do not stage this plan file.

Use this baseline for all owned-file review and scope checks:

```text
65decbced2257a3d15774423c9607e037b77e6fb
```

## Run ledger

Start SIDPROJ-92 with this new ledger. Include it in each status update:

```text
correction rounds: 0/1
full evidence runs: 0/2
judge rounds: 0/2
```

A judge round contains two independent reviewer streams. Each stream first checks the frozen source. The same stream later checks the fresh evidence. The evidence continuation does not start a new judge round.

If judge round 1 fails, collect all P1 and P2 findings from both reviewers. Use one correction batch. Add each new counterexample to focused tests before judge round 2.

If judge round 2 fails, stop. Do not make another local patch. If Chrome run 1 has a confirmed environment failure, use run 2 only after the cause changes. Do not start a third Chrome run.

## Required source changes

### `packages/dogfood/lab-v04.mjs`

#### Bind each product association to its own primitive support

Change `associationsBound()` and its small supporting helpers. Keep `projectProductResult()` and `projectPrimitiveProof()` independent.

For each saved product association:

1. Resolve `association.entryKey` to exactly one primitive browser entry.
2. Resolve `association.episodeKey` to exactly one primitive episode.
3. Require the primitive entry kind to equal `association.entryKind`.
4. Require the referenced entry and referenced episode to overlap.
5. Compute the intersection from that referenced pair only.
6. Normalize all product intersection times against the earliest referenced intersection start.
7. Require each saved product start and end to equal its referenced normalized intersection exactly.

For each product LoAF association, also require support from its referenced episode only:

- The referenced entry has kind `long-animation-frame`.
- The referenced episode has a primary canvas.
- Select the primary canvas with the same rule as `supportingCanvas()`: maximum episode `canvasApiSelfTimeMs`.
- Use the canvas key as a stable tie-breaker if equal self-times occur.
- The primary canvas has positive `canvasApiSelfTimeMs` and positive `rasterOperationCount` in the referenced episode.
- At least one primitive window has that canvas key.
- That member window index is inside the referenced episode range.
- That member window has positive `rasterOperationCount`.

Do not let another LoAF, another episode, or another canvas supply any part of this cross-observation binding. Keep `primitiveAssociationActual()` independent, but make it use the same complete working-pair predicate for its own primitive result.

The exact split-pair counterexample must fail:

- Start from the valid `interaction-association:variant-a:bad` combined row.
- Keep the product association on LoAF A and episode A.
- Keep LoAF A and episode A overlapping.
- Make episode A internally valid but give it no primary canvas with positive member-window raster work.
- Add LoAF B and episode B as a separate valid primitive pair.
- Give episode B the working primary canvas and a positive member window.
- Keep the product association times equal to the normalized intersection of A.
- Keep all schemas, totals, sorting, indexes, and keys valid.
- `checkCombinedRows()` must reject this row for the referenced-support rule.

Do not add a product canvas key to the association schema. Do not copy raw product support into primitive proof. Use the existing SHA-256 entry, episode, and canvas keys.

#### Require full zlib input consumption

Change `validPng()` only inside its IDAT inflate check.

- Keep the exact PNG signature, 1440 by 1000 RGB8 IHDR, chunk CRC, consecutive non-empty IDAT, scanline size, filter, IEND, and outer suffix checks.
- Concatenate all IDAT data once.
- Call `inflateSync(compressed, { info: true })`.
- Check `result.buffer` for the exact `(1440 * 3 + 1) * 1000` byte output and filter bytes `0..4`.
- Require `result.engine.bytesWritten === compressed.length`.
- Reject the PNG when zlib stops before the end of the concatenated IDAT input.
- Do not accept a second zlib stream, padding, or arbitrary suffix bytes inside IDAT.
- Do not use a private runtime field or a text scan.

The exact trailing-input counterexample must fail:

- Create one valid RGB image stream with `deflateSync(rawImage())`.
- Append at least one non-zlib byte to that compressed stream.
- Put the complete value in one non-empty IDAT chunk.
- Recompute the IDAT CRC with the current `chunk()` helper.
- Keep IHDR, IEND, dimensions, output size, filter bytes, and outer file suffix valid.
- `validPng()` must return `false` only because the inflate operation did not consume all IDAT input.

Keep the existing `png-trailing-bytes` attack. It checks bytes after IEND and covers a different boundary.

### `packages/dogfood/lab-v04.test.mjs`

#### Add the two source counterexamples

Add two direct focused tests outside the existing `attacks` array:

- `product association support cannot come from a different LoAF and episode pair`
- `the strict PNG parser rejects unused compressed input inside IDAT`

The first test must construct the exact split-pair row from this plan. Assert that the unmodified 53 rows pass first. Assert that the changed row keeps its exact schema and then makes `checkCombinedRows()` return a failure.

The second test must construct the exact valid-CRC IDAT value from this plan. Assert that the base PNG passes. Assert that the changed PNG fails.

#### Preserve all 60 disk attacks

Keep the current `attacks` array at exactly 60 stable names. Do not remove, rename, disable, merge, or replace an attack with a name-only entry.

Keep these two tests and their meaning:

```text
the mutation corpus has 60 stable executable attacks
all 60 attacks fail the intended closed checker
```

Each attack must call its intended checker and fail for its named fact. The two new SIDPROJ-92 counterexamples are separate direct tests. They do not replace any attack and do not change the exact count of 60.

#### Restore every baseline live truth test

Restore every live truth and scenario test from baseline commit `65decbced2257a3d15774423c9607e037b77e6fb`. Use live `checkScenarioResult()`, `evaluateCapture()`, `checkMatrixCoverage()`, `checkVariantInvariance()`, `checkNearestNegatives()`, `applyMutation()`, and `collectDiagnostics()` calls. Disk row builders and disk attacks do not replace these checks.

Restore these exact baseline test contracts:

1. `ordered matrix has the exact 53-row scenario, variant, and mode order`
   - Check all 53 rows.
   - Check all scenario groups.
   - Check the exact seven-row order for each non-integrated scenario.
   - Check the exact final four integrated rows.
2. `preserving variants cover every factor axis and keep the declared invariant`
   - Check matrix coverage, variant invariance, nearest negatives, and at least two changed factors.
   - Change one invariant and prove the checker fails.
3. `finding checks require measured fields, product relationships, and rank`
   - Keep the valid result.
   - Check rank, missing canvas identity, missing claim boundary, changed claim text, and missing maximum window.
4. `numeric truth boundaries accept the threshold and reject the nearest value below it`
   - Check heavy `8` versus `7.999`.
   - Check repeated `2` versus `1`.
   - Check resize two distinct windows versus one window.
   - Check backing two ratios at `2` versus one ratio at `1.999`.
   - Check each matching nearest-negative live capture.
5. `resize nearest negative keeps paired setup evidence and retirement`
   - Check the valid paired setup.
   - Remove reset evidence and prove failure.
   - Remove retirement evidence and prove failure.
6. `fixed and negative rows reject seeded and unexpected findings`
   - Reject a seeded expected finding in fixed and negative rows.
   - Reject an unexpected finding type.
   - Accept the declared empty fixed row.
   - Reject the value below the declared nearest-negative neighborhood.
7. `lifecycle uses 120-boundary retirement and same-identity reactivation evidence`
   - Check retirement then reactivation for one identity.
   - Reject a changed identity.
   - Check the 119-boundary nearest negative.
   - Reject a negative row with a retirement event.
8. `association checks require document capture, overlap relationships, and approved skips only`
   - Check a declared document event, LoAF, episode, and association.
   - Reject a missing product association when LoAF support exists.
   - Accept only the declared unsupported LoAF path.
   - Reject a missing document event.
   - Check the nearest-negative event-before-episode row.
   - Reject a seeded association in that negative row.
9. `non-React and integrated scenarios verify their complete evidence sets`
   - Check unattributed non-React ownership and reject a React owner.
   - Check all three integrated-continuous findings.
   - Remove one integrated finding and prove failure.
10. `diagnostics, idle draws, dropped evidence, and unapproved skips fail`
    - Check each diagnostic array.
    - Check idle draw rejection.
    - Check each dropped-evidence boundary used by the baseline helper.
    - Check unsupported evidence rejection.
    - Check the exact empty result from `collectDiagnostics()`.
11. `non-integrated captures accept exactly one fixture run`
    - Accept `1`.
    - Reject `0` and `2` with the exact failure text.
12. `mutation is narrow and fails only because the heavy finding is missing`
    - Check the exact heavy mutation failure array.
    - Reject an unknown mutation name.

Keep the baseline helper data faithful. Do not weaken a live assertion to a disk-schema assertion. Do not restore the old weak PNG or legacy evidence helpers from the baseline file.

## Source constraints

- Keep the SIDPROJ-91 dual-observation schemas, numeric bounds, exact 53-row order, exact 10-file artifact set, hash closure, and legacy projections.
- Keep expected truth outside product output. Use `lab-v04-truth.mjs` as repository truth.
- Keep the product and primitive projectors disjoint.
- Do not change product timing, thresholds, finding logic, fixture behavior, collection limits, or browser waits.
- Do not add retries, longer waits, or more animation-frame waits.
- Do not relax `idle capture contains draw activity`.
- Do not use natural-language denylists.

## Verification funnel

### 1. Focused source checks

Run after each source change:

```text
pnpm --filter dogfood run lab:v0.4:test
git diff --check -- packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs
```

The focused suite must pass the full restored live suite, both new counterexamples, and all 60 existing attacks.

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
```

The core suite must report at least 555 passing tests. Both builds must pass. The owned SIDPROJ-92 diff from the baseline must contain only the two owned files. Unrelated pre-existing dirty paths can remain visible.

### 3. Source judge gate

Give two independent reviewers all of these items:

- this complete plan;
- the live SIDPROJ-92 description;
- the SIDPROJ-91 final Linear blocker report;
- the complete two-file diff from `65decbced2257a3d15774423c9607e037b77e6fb`;
- both full owned files;
- all 60 executable attacks;
- both new exact counterexamples;
- the restored baseline live suite;
- the current SIDPROJ-92 ledger.

Tell each reviewer to check the complete diff. Tell each reviewer to return all P1 and P2 findings in one terminal report. Do not give either reviewer the other report. Both source reports must return `PASS` before Chrome.

### 4. One Chrome evidence run after source freeze

Freeze the source after both source judges pass. Run this command once:

```text
pnpm --filter dogfood exec node lab-v04.mjs --idle-release
```

This command is one full evidence run. It must prove:

- 20 of 20 idle rows;
- 53 of 53 matrix rows;
- the exact heavy-finding mutation failure;
- the exact product-to-referenced-primitive association binding;
- zero dropped evidence;
- empty diagnostics;
- current Chrome, Git, bundle, and harness identities;
- exact hashes for all nine hashed artifacts;
- no listener on port `5190` after the run.

Do not rerun Chrome for a source or checker failure. Use the second run only for one confirmed environment retry after the cause changes.

### 5. Fresh disk checks

Run these checks without another browser run:

```text
pnpm --filter dogfood exec node lab-v04.mjs --check-evidence
pnpm --filter dogfood run lab:v0.4:test
/usr/sbin/lsof -nP -iTCP@127.0.0.1:5190 -sTCP:LISTEN
```

The first two commands must pass. The listener command must return no rows. Recompute SHA-256 for these exact nine files and compare every line with `/private/tmp/sidproj-55-sha256.txt`:

```text
/private/tmp/sidproj-55-canvas-lab-v0.4.json
/private/tmp/sidproj-55-console-summary.txt
/private/tmp/sidproj-55-integrated-burst.png
/private/tmp/sidproj-55-integrated-continuous.png
/private/tmp/sidproj-55-mutation-output.txt
/private/tmp/sidproj-55-nearest-negatives.json
/private/tmp/sidproj-55-variant-matrix.json
/private/tmp/sidproj-86-v04-idle-boundary.json
/private/tmp/sidproj-90-v04-release-evidence.json
```

Do not trust the saved hash text without the disk recomputation.

### 6. Fresh-evidence judge continuations

Send the fresh artifacts, recomputed hashes, source, and port result to the same two reviewers. This continues the open judge round.

Each reviewer must check the complete combined domain, both observations, exact referenced association support, strict PNG zlib consumption, legacy projections, hashes, identities, times, diagnostics, drops, port state, and mutation results. Both reviewers must return `PASS`.

## Closure

After all checks and both judge continuations pass:

1. Stage only `packages/dogfood/lab-v04.mjs` and `packages/dogfood/lab-v04.test.mjs`.
2. Check the staged path list and the full staged diff.
3. Create one clear signed commit with `git commit -S`.
4. Push `agent/sidproj-92-association-png-closure`.
5. Upload the combined release JSON and final check summary to SIDPROJ-92.
6. Add the commit SHA, artifact SHA-256 values, check counts, Chrome revision, and final ledger to SIDPROJ-92.
7. Mark SIDPROJ-92 Done.
8. Check live Linear state before work starts on another AFK issue.

Do not mark SIDPROJ-91 Done as part of SIDPROJ-92 closure. SIDPROJ-91 becomes a separate unblocked issue after SIDPROJ-92 closes.

## Out of scope

- Do not change `packages/dogfood/lab-v04-truth.mjs` or product source.
- Do not change any v0.5, pack, package, Excalidraw, release-note, or documentation file.
- Do not change product timing, thresholds, findings, fixture behavior, collection limits, or browser waits.
- Do not relax the idle draw boundary.
- Do not add retries, longer waits, or extra frame waits.
- Do not run SIDPROJ-70.
- Do not tag, publish, open a pull request, or contact an external maintainer.
