# SIDPROJ-94 implementation contract

## Falsifiable goal

SIDPROJ-94 is complete when the checker accepts exact complete LoAF pair sets and rejects all incomplete or false sets. All reconstructed live rows must return `[]`. Both source judges, one Chrome run, disk checks, and evidence continuations must pass.

## Live issue and baseline

- Linear issue: `SIDPROJ-94`, `V05-09j — Bind the complete LoAF association set`.
- URL: `https://linear.app/yde/issue/SIDPROJ-94/v05-09j-bind-the-complete-loaf-association-set`.
- Live state during planning: `In Progress`, label `AFK`, no blocker, no comments.
- Relations: SIDPROJ-94 blocks SIDPROJ-93. It relates to SIDPROJ-92 and SIDPROJ-70.
- Branch: `agent/sidproj-94-complete-association-set`.
- Baseline commit and current `HEAD`: `65decbced2257a3d15774423c9607e037b77e6fb`.
- The complete owned diff has 1,347 insertions and 327 removals across two files.
- The current focused suite passes 60 tests and runs all 60 named attacks.
- `git diff --check` passes.
- The prior reported standard gates pass: 555 core tests, workspace type checks, both builds, and diff checks.
- Chrome is `151.0.7922.137`.
- Port `5190` had no listener during planning.
- Git uses SSH signing. `commit.gpgsign=true` and `gpg.format=ssh`.

SIDPROJ-93 stopped before Chrome with this final ledger:

```text
correction rounds: 1/1
full evidence runs: 0/2
judge rounds: 2/2
```

Both final SIDPROJ-93 judges returned `FAIL`. Start a new SIDPROJ-94 ledger.

## Final SIDPROJ-93 judge findings

### Judge B, P1

`associationsBound()` requires `workingEpisodes.length === 1`. This contradicts the recorder. One LoAF can overlap two working episodes. Core emits one product association for each overlap.

The exact reproduction adds a second positive overlapping episode and two exact raw product associations to row 35. `checkCombinedRows()` returns `['35:key binding']`. The required result is `[]`.

Judge B confirmed these prior boundaries pass: retarget rejection, numeric keys, raw projection, lifecycle/domain tests, 60 attacks, 12 live contracts, split-pair rejection, and unused-IDAT rejection.

### Judge A, P2-1

The 13-case live regression checks only that old labels disappeared. It does not require each reconstructed row to pass.

Rows 28, 30, and 32 use only a historical chain instead of their current primary chain. They still return:

```text
28:dual result
28:lifecycle binding
30:dual result
30:lifecycle binding
32:dual result
32:lifecycle binding
```

### Judge A, P2-2

Judge A confirmed the same valid multi-episode LoAF failure. `packages/core/src/recording.ts` emits one association for every overlapping browser entry and episode. The checker must compare complete semantic pair sets.

## Core recorder contract

Keep raw recorder behavior unchanged. `deriveAssociations()` in `packages/core/src/recording.ts` uses this rule:

1. Iterate each recorded browser entry.
2. Iterate each derived draw episode.
3. Skip a pair only when their time ranges do not overlap.
4. Emit one association for every overlapping pair.
5. Set the association start to `max(entry.start, episode.start)`.
6. Set the association end to `min(entry.end, episode.end)`.

One LoAF can therefore produce zero, one, or many associations. Do not add a one-episode-per-LoAF rule.

## Owned files and dirty-tree boundary

Only these source files belong to SIDPROJ-94:

```text
packages/dogfood/lab-v04.mjs
packages/dogfood/lab-v04.test.mjs
```

The worktree contains unrelated v0.5, pack, release, package, documentation, and workflow files. Do not change, format, restore, remove, stage, or commit another path. Do not stage this plan file.

Use this baseline for all scope and diff checks:

```text
65decbced2257a3d15774423c9607e037b77e6fb
```

## Run ledger

Start with this exact ledger. Include it in each status update:

```text
correction rounds: 0/1
full evidence runs: 0/2
judge rounds: 0/2
```

A judge round contains two independent reviewer streams. Each stream first checks the frozen source. The same stream later checks fresh evidence. Evidence continuation does not start a new judge round.

If judge round 1 fails, collect all P1 and P2 findings from both reviewers. Use one correction batch. Add all new counterexamples before judge round 2.

If judge round 2 fails, stop. Do not make another local patch. Use evidence run 2 only after a confirmed environment cause changes. Do not start a third evidence run.

## Exact complete-set association model

### Keep the projection boundary

Keep `associationKinds` exact:

```text
['document-event', 'long-animation-frame']
```

Keep product and primitive derivation independent:

- `projectProductResult()` reads product canvas summaries, findings, lifecycle events, and raw product episode associations.
- `projectPrimitiveProof()` reads windows, episodes, resets, browser entries, fixture state, idle state, limits, drops, and diagnostics.
- Neither projector reads repository truth or the other projector's source fields.
- `event-timing` and `user-mark` stay excluded from both projectors.

Do not silently remove duplicate product associations in `projectProductResult()`. Keep all allowlisted raw rows. Normalize and sort them. Let the exact product schema reject a duplicate semantic pair.

### Semantic pair identity

Define one semantic LoAF pair key:

```text
`${entryKey}:${episodeKey}`
```

The entry kind is already fixed to `long-animation-frame` for this set. Do not use times, array indexes, canvas keys, or expected booleans as pair identity.

### `qualifyingPrimitiveLoafPairs(proof)`

Add this pure primitive-only helper next to `workingAssociationPair()`.

For every primitive entry with kind `long-animation-frame`, check every primitive episode. Include a pair only when all conditions pass:

1. The LoAF entry and episode overlap by their normalized ranges.
2. `primaryCanvas(episode)` returns one canvas by maximum `canvasApiSelfTimeMs` and canvas-key tie-breaker.
3. The primary canvas has positive episode `canvasApiSelfTimeMs`.
4. The primary canvas has positive episode `rasterOperationCount`.
5. One primitive window uses the primary canvas key.
6. That window index is inside the exact episode range.
7. That member window has positive `rasterOperationCount`.

Return one closed record per qualifying pair:

```text
{
  pairKey,
  entryKey,
  episodeKey,
  startedAtTimestampMs,
  endedAtTimestampMs
}
```

Set the start to the maximum referenced start. Set the end to the minimum referenced end. Sort by `pairKey`. Reject duplicate primitive entry keys or episode keys through the existing primitive schema before this helper runs.

Do not use a product association or manifest expectation in this helper.

### `selectedProductLoafPairs(product)`

Add this pure product-only helper next to `productAssociationActual()`.

Filter `product.episodeAssociations` to `entryKind === 'long-animation-frame'`. Return their semantic pair keys and saved normalized time ranges. Sort by pair key.

Do not derive a missing product pair from primitive proof. Do not use repository expected booleans.

### Complete-set equality in `associationsBound()`

Replace the global `workingEpisodes.length === 1` rule.

`associationsBound(product, proof)` must do this:

1. Build the selected product LoAF pair list.
2. Build the qualifying primitive LoAF pair list.
3. Reject duplicate product semantic pair keys.
4. Require equal list lengths.
5. Require exact sorted pair-key equality.
6. Normalize primitive pair intersections against the earliest qualifying primitive intersection start.
7. Require each product pair start to equal its matching normalized primitive start.
8. Require each product pair end to equal its matching normalized primitive end.

Set equality supplies these outcomes:

- Product `[]` and primitive `[]` pass binding.
- Product 1-of-1 and primitive 1-of-1 pass.
- Product 2-of-2 and primitive 2-of-2 pass.
- Product 1-of-2 fails.
- Product 2-of-1 fails.
- A missing first pair fails.
- A missing second pair fails.
- A retargeted single pair fails when another primitive pair remains.
- An extra product pair fails.
- A duplicate product pair fails.
- A correct pair with wrong saved time fails.

Do not compare pair arrays by source order. Sort by semantic key before equality and time checks.

### Product normalized time contract

Keep `projectProductResult()` normalization product-only. It must use allowlisted raw product associations.

For LoAF rows produced by the recorder, each raw product start and end already equals the referenced raw intersection. Normalize all selected product LoAF intersection ranges against the earliest selected LoAF intersection start.

Document-event product associations can remain in the closed product projection. They do not enter LoAF set equality. If a projected document-event association exists, it must still resolve to its own primitive entry and episode and use its exact normalized intersection.

Use separate origins for these checks:

- LoAF complete-set time binding uses the earliest selected LoAF intersection.
- Projected document-event time binding uses the earliest selected document-event intersection.

This prevents an unrelated document association from shifting LoAF normalized times. Change the product projector to normalize each association kind against its own earliest start. Keep its declared sorted output.

### Independent document-event truth

Keep `primitiveAssociationActual(proof, manifest)` independent from product pair equality.

It must require:

1. One primitive `document-event` entry with the exact event type from `manifest.factors.eventSource`.
2. At least one qualifying primitive LoAF and episode pair.

A product LoAF pair set cannot supply the document event. A wrong document event type must make primitive association truth false, even when all LoAF pairs match.

Do not require a product association for the document event. Do not include document-event pairs in LoAF complete-set equality.

### Preserve per-pair support

Keep `primaryCanvas()` and `workingAssociationPair()` consistent with `qualifyingPrimitiveLoafPairs()`.

Another LoAF, episode, canvas, or member window cannot certify a pair. The SIDPROJ-92 split-pair counterexample must remain rejected.

## Exact acceptance cases

Add focused tests for these exact pair-set cases. Each test must assert the full returned failure array.

1. One LoAF, one qualifying episode, and one exact product association returns `[]`.
2. One LoAF, two qualifying episodes, and two exact product associations returns `[]`.
3. The same primitive 2-pair set with only the first product pair returns `['35:key binding']`.
4. The same primitive 2-pair set with only the second product pair returns `['35:key binding']`.
5. Retargeting the original association to the second episode while omitting the first returns `['35:key binding']`.
6. Adding a product pair absent from primitive qualifying pairs returns `['35:key binding']`.
7. Removing a product pair present in primitive qualifying pairs returns `['35:key binding']`.
8. Duplicating a product semantic pair fails the product schema and returns `['35:combined schema']`.
9. A correct complete set with one wrong normalized start returns `['35:key binding']`.
10. A correct complete set with one wrong normalized end returns `['35:key binding']`.
11. A referenced episode with no positive primary member window returns `['35:dual result', '35:key binding']`.
12. A complete LoAF set with the wrong document event type returns `['35:dual result']`.
13. A complete LoAF set with no document event returns `['35:dual result']`.
14. A direct product `event-timing` or `user-mark` association fails schema, while raw projector input excludes both kinds.

Build the valid two-pair case from raw product associations and primitive proof. Do not hand-copy saved product times from primitive output. Use two different episode keys and one LoAF key. Both episodes must overlap the LoAF and have their own positive primary member windows.

## Full reconstructed live rows

Replace `the 13 live combined failures have removed failures at their row coordinates`. Its current assertion is not sufficient.

Build the reconstructed combined rows from product-owned raw session data and valid primitive data. Assert `checkCombinedRows(combined)` equals `[]` exactly.

The reconstruction must cover the unique prior rows:

```text
20 resize-churn:nearest-negative:negative
28 lifecycle-reactivation:variant-a:bad
29 lifecycle-reactivation:variant-a:fixed
30 lifecycle-reactivation:variant-b:bad
31 lifecycle-reactivation:variant-b:fixed
32 lifecycle-reactivation:variant-c:bad
33 lifecycle-reactivation:variant-c:fixed
34 lifecycle-reactivation:nearest-negative:negative
35 interaction-association:variant-a:bad
39 interaction-association:variant-c:bad
```

The single exact `[]` assertion covers these 13 former failure entries. Keep this table in the test for traceability:

```text
20 resize-churn:nearest-negative:negative key binding
28 lifecycle-reactivation:variant-a:bad key binding
29 lifecycle-reactivation:variant-a:fixed key binding
30 lifecycle-reactivation:variant-b:bad key binding
31 lifecycle-reactivation:variant-b:fixed key binding
32 lifecycle-reactivation:variant-c:bad key binding
33 lifecycle-reactivation:variant-c:fixed key binding
34 lifecycle-reactivation:nearest-negative:negative key binding
34 lifecycle-reactivation:nearest-negative:negative negative boundary
35 interaction-association:variant-a:bad dual result
35 interaction-association:variant-a:bad key binding
39 interaction-association:variant-c:bad dual result
39 interaction-association:variant-c:bad key binding
```

### Rows 28, 30, and 32

For each bad lifecycle row, pass its current primary canvas summary to `projectProductResult()`. Include the current primary retired/reactivated chain, not a historical-only chain.

Use the exact product canvas ID that hashes to the row's primitive canvas key. Use event indexes that match the row's primitive lifecycle contract:

- the selected retirement occurs after the earlier positive primitive window;
- the selected reactivation index equals the later positive primitive window index;
- the reactivation follows retirement;
- the primitive fixture boundary is 120.

Also include unrelated historical lifecycle events as decoys. The selected product chain must use only the current primary canvas. Each row must return no `dual result`, `key binding`, or `lifecycle binding` failure.

### Fixed and negative lifecycle rows

- Rows 29, 31, and 33 keep only unrelated historical chains. Their selected product lifecycle result stays false. Each full row returns `[]`.
- Row 34 keeps `boundaryCount === 119`. An unrelated 120-style chain does not change the product result. The full row returns `[]`.
- Row 20 keeps its one current primary fallback retirement, two active resets in one window, and one working window. The full row returns `[]`.

### Association rows 35 and 39

Reconstruct each row from its allowlisted raw product associations. Use all qualifying primitive LoAF and episode pairs. Include the declared pointer, keyboard, or wheel event from its manifest factors. Each full row returns `[]`.

## Exact file changes

### `packages/dogfood/lab-v04.mjs`

- Keep `associationKinds`, `selectProductLifecycleEvents()`, and product-only lifecycle selection.
- Change `projectProductResult()` to retain duplicate allowlisted raw associations for schema rejection.
- Normalize projected association times per association kind.
- Add a stable semantic pair-key helper.
- Add `qualifyingPrimitiveLoafPairs(proof)`.
- Add `selectedProductLoafPairs(product)`.
- Remove the `workingEpisodes.length === 1` condition from `associationsBound()`.
- Implement exact sorted complete-set equality and exact per-pair normalized time checks.
- Bind projected document-event associations separately to their referenced primitive pairs and times.
- Keep `primitiveAssociationActual()` independent and require the declared document event plus one qualifying LoAF pair.
- Keep `productAssociationActual()` product-only.
- Keep current-primary lifecycle selection and binding.
- Do not change `validPng()`, evidence schemas, numeric bounds, legacy projections, file rules, hashes, fixture timing, waits, or cleanup.

### `packages/dogfood/lab-v04.test.mjs`

- Add raw product and primitive builders for a one-pair and two-pair association domain.
- Add every exact acceptance case from this plan.
- Replace the weak 13-failure regression with one exact full-list `[]` assertion.
- Give rows 28, 30, and 32 their current primary lifecycle chains.
- Keep historical lifecycle decoys in those rows.
- Keep all fixed and nearest-negative lifecycle assertions.
- Keep `product association support cannot come from a different LoAF and episode pair` unchanged in meaning.
- Keep `the strict PNG parser rejects unused compressed input inside IDAT` unchanged in meaning.
- Keep the projector isolation tests and omitted-kind tests.
- Keep the exact 53-row synthetic baseline valid.
- Keep all 60 named attacks executable.
- Keep all 12 live baseline contracts.

## Preserve all 60 named attacks

Keep the current attack array at exactly 60 unique executable names. Do not remove, rename, disable, merge, or replace an attack with a name-only entry.

Keep these checks:

```text
the mutation corpus has 60 stable executable attacks
all 60 attacks fail the intended closed checker
```

The corpus includes product removal/insertion, lifecycle, LoAF overlap, key changes, schemas, rows, files, hashes, duplicate JSON, numeric bounds, PNG structure, and coordinated legacy lies.

## Preserve all 12 live baseline contracts

Keep these exact live contracts and their full assertions:

1. `ordered matrix has the exact 53-row scenario, variant, and mode order`
2. `preserving variants cover every factor axis and keep the declared invariant`
3. `finding checks require measured fields, product relationships, and rank`
4. `numeric truth boundaries accept the threshold and reject the nearest value below it`
5. `resize nearest negative keeps paired setup evidence and retirement`
6. `fixed and negative rows reject seeded and unexpected findings`
7. `lifecycle uses 120-boundary retirement and same-identity reactivation evidence`
8. `association checks require document capture, overlap relationships, and approved skips only`
9. `non-React and integrated scenarios verify their complete evidence sets`
10. `diagnostics, idle draws, dropped evidence, and unapproved skips fail`
11. `non-integrated captures accept exactly one fixture run`
12. `mutation is narrow and fails only because the heavy finding is missing`

Use live truth functions. Disk row tests and attacks do not replace these checks.

## Preserved evidence boundary

Keep all earlier closure rules:

- exact 53-row order;
- independent product and primitive observations;
- current-primary product lifecycle selection;
- exact association kind allowlist;
- exact schemas and duplicate-key rejection;
- bounded numeric fields and exact cross-field totals;
- exact ten-file artifact set and nine-file hash manifest;
- exact legacy projections from combined evidence;
- strict PNG signature, IHDR, IDAT, zlib-consumption, filter, CRC, IEND, and suffix checks;
- exact harness digest inputs;
- zero drops and empty diagnostics;
- exact idle and mutation links;
- exact paths and safe file types.

Do not weaken one boundary to make a live row pass.

## Verification funnel

### 1. Focused checks

Run after each source change:

```text
pnpm --filter dogfood run lab:v0.4:test
git diff --check -- packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs
```

The focused suite must pass all complete-set cases, the full reconstructed `[]` assertion, 60 attacks, 12 live contracts, split-pair rejection, and unused-IDAT rejection.

### 2. Standard source checks

Run only after focused checks pass:

```text
pnpm --filter canvas-scan test
pnpm typecheck
pnpm --filter canvas-scan run build
pnpm --filter workbench exec vite build
git diff --check
git status --short --branch
git diff --name-only
git diff --stat 65decbced2257a3d15774423c9607e037b77e6fb -- packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs
```

The core suite must report at least 555 passing tests. Both builds must pass. The owned diff from the baseline must contain only the two owned files.

### 3. Source judge gate

Give two independent reviewers all of these items:

- this complete plan;
- live SIDPROJ-94 with relations;
- both final SIDPROJ-93 judge reports;
- core `deriveAssociations()` behavior;
- the complete two-file diff from the baseline;
- both full owned files;
- every complete-set counterexample;
- the exact full reconstructed live-row assertion;
- all 60 attacks and 12 live contracts;
- the fresh SIDPROJ-94 ledger.

Tell each reviewer to check the complete diff and return all P1 and P2 findings in one terminal report. Do not share reports between reviewers. Both reviewers must return `PASS` before Chrome.

### 4. One Chrome run after source freeze

Freeze the source after both source judges pass. Run this command once:

```text
pnpm --filter dogfood exec node lab-v04.mjs --idle-release
```

This command is one full evidence run. It must prove:

- 20 of 20 idle rows;
- 53 of 53 matrix rows;
- no recurrence of the 13 prior failure entries;
- passing current-primary lifecycle chains for rows 28, 30, and 32;
- complete LoAF association sets for every association row;
- the exact heavy-finding mutation failure;
- zero dropped evidence and empty diagnostics;
- current Chrome, Git, bundle, and harness identities;
- exact hashes for all nine artifacts;
- no listener on port `5190` after the run.

Do not rerun Chrome for a source or checker failure. Use run 2 only for one confirmed environment retry after the cause changes.

### 5. Disk checks

Run these without another Chrome run:

```text
pnpm --filter dogfood exec node lab-v04.mjs --check-evidence
pnpm --filter dogfood run lab:v0.4:test
/usr/sbin/lsof -nP -iTCP@127.0.0.1:5190 -sTCP:LISTEN
```

The first two commands must pass. The listener command must return no rows.

Recompute SHA-256 for these exact nine files. Compare every line with `/private/tmp/sidproj-55-sha256.txt`:

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

Do not trust saved hash text without disk recomputation.

### 6. Fresh-evidence judge continuations

Send fresh artifacts, recomputed hashes, source, and port state to the same two reviewers. This continues the open judge round.

Each reviewer must check:

- the complete combined domain;
- complete product and primitive LoAF pair-set equality;
- each pair's keys, overlap, primary canvas, member work, and normalized times;
- independent document-event truth;
- current-primary lifecycle chains;
- strict PNG and numeric boundaries;
- legacy projections and exact hashes;
- identities, times, diagnostics, drops, mutation, idle links, and port state.

Both reviewers must return `PASS`.

## Closure

After all checks and both judge continuations pass:

1. Stage only `packages/dogfood/lab-v04.mjs` and `packages/dogfood/lab-v04.test.mjs`.
2. Check the staged path list and full staged diff.
3. Create one clear signed commit with `git commit -S`.
4. Push `agent/sidproj-94-complete-association-set`.
5. Upload `/private/tmp/sidproj-90-v04-release-evidence.json` to SIDPROJ-94.
6. Upload the final check summary to SIDPROJ-94.
7. Add the commit SHA, all artifact hashes, test counts, Chrome revision, port result, and final ledger to SIDPROJ-94.
8. Mark SIDPROJ-94 Done.
9. Check live Linear state before work starts on another AFK issue.

Do not mark SIDPROJ-93, SIDPROJ-92, or SIDPROJ-91 Done as part of SIDPROJ-94 closure. Each becomes a separate unblocked issue after SIDPROJ-94 closes.

## Out of scope

- Do not change `packages/core/src/recording.ts`, `packages/dogfood/lab-v04-truth.mjs`, or product source.
- Do not change product timing, thresholds, findings, fixture behavior, instrumentation, collection limits, or browser waits.
- Do not require one working episode per LoAF.
- Do not change any v0.5, pack, package, Excalidraw, release-note, or documentation file.
- Do not relax lifecycle, idle, PNG, numeric, schema, hash, file-set, or privacy checks.
- Do not add retries, longer waits, or extra animation-frame waits.
- Do not run SIDPROJ-70.
- Do not tag, publish, open a pull request, or contact an external maintainer.
