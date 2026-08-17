# SIDPROJ-93 implementation contract

## Falsifiable goal

SIDPROJ-93 is complete when all 53 live rows pass the closed checker. The checker must select one product-owned lifecycle chain and one shared association domain. It must reject every mandatory counterexample. The full source, evidence, judge, hash, port, upload, commit, push, and Linear gates must pass.

## Live issue and baseline

- Linear issue: `SIDPROJ-93`, `V05-09i — Scope lifecycle evidence and align live association proof`.
- URL: `https://linear.app/yde/issue/SIDPROJ-93/v05-09i-scope-lifecycle-evidence-and-align-live-association-proof`.
- Live state during planning: `In Progress`, label `AFK`, no blocker, no comments.
- Relations: SIDPROJ-93 blocks SIDPROJ-92. It relates to SIDPROJ-91 and SIDPROJ-70.
- Branch: `agent/sidproj-93-lifecycle-association-closure`.
- Baseline commit and current `HEAD`: `65decbced2257a3d15774423c9607e037b77e6fb`.
- The owned diff from the baseline has 1,230 insertions and 327 removals.
- The current focused suite passed 51 tests and all 60 named attacks:

  ```text
  pnpm --filter dogfood run lab:v0.4:test
  ```

- `git diff --check` passed during planning.
- Chrome is `151.0.7922.137`.
- Port `5190` had no listener during planning.
- Git uses SSH signing. `commit.gpgsign=true` and `gpg.format=ssh`.
- SIDPROJ-92 used correction `1/1`, evidence `1/2`, and judge `2/2`.
- Start a new SIDPROJ-93 ledger. Do not continue the SIDPROJ-92 ledger.

## Exact 13 live failures

The approved SIDPROJ-92 Chrome run reached the combined checker and returned these 13 failure entries:

1. Row `20`, `resize-churn:nearest-negative:negative`: `key binding`.
2. Row `28`, `lifecycle-reactivation:variant-a:bad`: `key binding`.
3. Row `29`, `lifecycle-reactivation:variant-a:fixed`: `key binding`.
4. Row `30`, `lifecycle-reactivation:variant-b:bad`: `key binding`.
5. Row `31`, `lifecycle-reactivation:variant-b:fixed`: `key binding`.
6. Row `32`, `lifecycle-reactivation:variant-c:bad`: `key binding`.
7. Row `33`, `lifecycle-reactivation:variant-c:fixed`: `key binding`.
8. Row `34`, `lifecycle-reactivation:nearest-negative:negative`: `key binding`.
9. Row `34`, `lifecycle-reactivation:nearest-negative:negative`: `negative boundary`.
10. Row `35`, `interaction-association:variant-a:bad`: `dual result`.
11. Row `35`, `interaction-association:variant-a:bad`: `key binding`.
12. Row `39`, `interaction-association:variant-c:bad`: `dual result`.
13. Row `39`, `interaction-association:variant-c:bad`: `key binding`.

Add a focused regression for each entry. Each regression must name its row coordinate and expected removed failure. One table-driven test can hold the 13 cases, but it must assert each case separately.

## Owned files and dirty-tree boundary

Only these source files belong to SIDPROJ-93:

```text
packages/dogfood/lab-v04.mjs
packages/dogfood/lab-v04.test.mjs
```

The worktree also contains unrelated v0.5, pack, release, documentation, package, and workflow files. Do not change, format, restore, remove, stage, or commit any unrelated path. Do not stage this plan file.

Use this baseline for every diff and scope check:

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

A judge round has two independent reviewer streams. Each stream first checks the frozen source. The same stream later checks fresh evidence. The evidence continuation does not start a new judge round.

If judge round 1 fails, collect all P1 and P2 findings from both reviewers. Use one correction batch. Add each new counterexample to focused tests before judge round 2.

If judge round 2 fails, stop. Do not make another local patch. Use evidence run 2 only after one confirmed environment failure changes. Do not start a third evidence run.

## Selected product lifecycle model

### Product ownership boundary

Change `projectProductResult()` to accept these product-owned session fields:

```text
canvases
findings
lifecycleEvents
episodeAssociations
```

`canvases` means the current product canvas summaries from the stopped session. It is not primitive proof. The product projector must not read windows, episodes, resets, browser entries, geometry, fixture state, idle state, diagnostics, or repository truth.

Keep `projectPrimitiveProof()` unchanged as the only projector for primitive windows, episodes, resets, browser entries, fixture state, and idle state.

### `selectProductLifecycleEvents(canvases, lifecycleEvents)`

Add this product-only helper near `projectProductResult()`. It must return a closed subset of raw lifecycle events without changing raw session data.

Use `canvases[0]?.canvasId` as the primary product canvas. This matches `hasLifecycle()` in `lab-v04-truth.mjs`.

Select the lifecycle chain as follows:

1. Keep measured `retired` and `reactivated` events for the primary canvas only.
2. Build pairs where the reactivation index is greater than the retirement index.
3. Select the pair with the greatest reactivation index.
4. If two pairs have that index, select the pair with the greatest retirement index.
5. Return only that retired event and that reactivated event for lifecycle-chain evidence.
6. If no pair exists, keep only the latest measured primary-canvas `retired` event.

The fallback retirement preserves the resize nearest-negative proof. It must not create a lifecycle result because no selected reactivation exists.

Select replacement evidence separately:

1. Find `detached` events whose canvas differs from at least one current product canvas summary.
2. Select the event with the greatest window index.
3. Use the canvas ID as the stable tie-breaker.
4. Add only that detached event to the result.

Remove `first-observed`, `active`, unrelated retirements, unrelated reactivations, and extra detached events from the product projection. Sort the final selected events with the current window/type/canvas order. Remove a duplicate semantic event before projection.

This selection must produce these results:

- A current primary retired/reactivated chain is product-true.
- An unrelated historical chain for a non-primary canvas does not count.
- A fixed lifecycle row with an unrelated valid chain remains product-false.
- A 119-boundary row with an unrelated valid chain remains product-false.
- A primary retirement without a reactivation remains product-false.
- The resize nearest-negative row keeps one primary retirement.
- The integrated replacement row keeps one relevant detached event.

### Lifecycle cross-observation binding

Keep `productLifecycleActual()` product-only. Make it read only the selected projection.

Keep `primitiveLifecycleActual()` primitive-only. It must still require:

- `fixture.boundaryCount === 120`;
- one canvas key;
- positive raster work in at least two primitive windows;
- a gap of at least 120 window indexes.

Keep `lifecycleBinding()` as the cross-observation check. The selected retired and reactivated events must use one canvas key. Primitive proof must contain:

- a positive member window for that canvas before retirement;
- a positive member window at the reactivation index;
- the declared 120-boundary relation.

Do not let an unrelated product event fail the row after selection. Do not let an unrelated primitive canvas satisfy the selected chain.

In `checkCombinedRow()`, apply the generic lifecycle key check only to selected product events. Keep the specific lifecycle, replacement, and resize-negative checks. Do not remove key checks to make live rows pass.

## Aligned association model

### One exact association-kind domain

Add one shared repository-owned constant near the projectors:

```text
['document-event', 'long-animation-frame']
```

Use this exact allowlist in both projectors:

- `projectProductResult()` filters raw `episodeAssociations` before it computes the time origin.
- `projectPrimitiveProof()` filters raw `browserEntries` with the same allowlist.
- `validProductResult()` accepts only the same two `entryKind` values.
- The primitive browser schema accepts only the same two kinds.

Exclude `event-timing` and `user-mark` from both projections. A direct combined row that adds either omitted product kind must fail the product schema.

Do not compute product normalized times from an association that the allowlist removes. Sort and deduplicate the filtered association rows with the current semantic keys.

### Positive association rule

Keep `primaryCanvas()`, `workingAssociationPair()`, and `associationsBound()`. Make their shared contract exact.

For each selected product LoAF association:

1. Resolve its own `entryKey` to one primitive LoAF entry.
2. Resolve its own `episodeKey` to one primitive episode.
3. Require that exact entry and episode to overlap.
4. Select the primary episode canvas by maximum self-time and then canvas key.
5. Require positive episode self-time and positive episode raster work for that canvas.
6. Require a positive primitive member window for that canvas inside the episode index range.
7. Compute the exact intersection for that referenced entry and episode.
8. Normalize intersections against the earliest selected intersection start.
9. Require exact equality with the saved product association start and end.

`primitiveAssociationActual()` must independently require:

- the document event type from `manifest.factors.eventSource`;
- one complete working LoAF and episode pair;
- the exact shared association domain.

`associationsBound()` must still reject the SIDPROJ-92 split-pair counterexample. Another LoAF, episode, canvas, or document-event kind cannot replace a missing fact in the referenced pair.

The checker must not copy the expected event type into product output. Repository truth can compare the primitive document event with the manifest after both projections exist.

## Mandatory focused counterexamples

Add direct focused tests for all of these cases:

1. A historical retired/reactivated chain for a canvas absent from current product summaries does not count.
2. A fixed lifecycle row with an unrelated valid chain stays false and passes the combined checker.
3. A 119-boundary lifecycle row with an unrelated valid chain stays false and passes the combined checker.
4. A primary retired/reactivated chain with no primitive work fails cross-observation binding.
5. A primary retirement without reactivation remains false but stays available for resize nearest-negative proof.
6. A product `event-timing` or `user-mark` association is excluded by both projectors.
7. A direct combined product association with an omitted kind fails the exact product schema.
8. A product LoAF association paired with a different working episode fails.
9. A valid LoAF and episode with the wrong document event type fails.
10. A product LoAF association whose referenced episode has no positive member window fails.
11. Product association times must equal the normalized intersection of the referenced pair.
12. Keep `product association support cannot come from a different LoAF and episode pair` unchanged in meaning.
13. Keep `the strict PNG parser rejects unused compressed input inside IDAT` unchanged in meaning.

Build the 13 live-row regressions from product-owned raw data and valid primitive rows. Do not copy a saved Chrome result into expected test truth.

## Exact file changes

### `packages/dogfood/lab-v04.mjs`

- Add the shared association-kind allowlist.
- Add `selectProductLifecycleEvents()`.
- Change `projectProductResult()` to use current product canvas summaries, selected lifecycle events, and filtered associations.
- Change `projectPrimitiveProof()` to use the shared association-kind allowlist.
- Tighten the product association union in `validProductResult()` to the shared allowlist.
- Keep `validPrimitiveProof()` exact and use the same browser kind domain.
- Keep `productLifecycleActual()` limited to the selected chain.
- Keep `primitiveLifecycleActual()` independent.
- Keep `lifecycleBinding()` tied to the selected canvas and primitive windows.
- Keep `workingAssociationPair()` tied to the referenced primary canvas and member window.
- Keep `associationsBound()` tied to each referenced product pair and exact normalized times.
- Keep `primitiveAssociationActual()` tied to the expected document source and a complete working pair.
- Change `checkCombinedRow()` only as needed for selected-event key checks.
- Keep `captureRow()` as the caller that passes the full stopped session into both independent projectors.
- Do not change `validPng()`. Its full-input zlib check is already part of the frozen boundary.
- Do not change evidence schemas, legacy projections, file-set rules, hashes, run timing, fixture timing, or browser cleanup.

### `packages/dogfood/lab-v04.test.mjs`

- Change synthetic product projection helpers to include current product canvas summaries.
- Add the 13 exact live-failure regressions.
- Add every mandatory lifecycle and association counterexample.
- Keep the split-pair and unused-IDAT tests exact.
- Keep all 12 baseline live contracts.
- Keep all 60 named attacks executable.
- Keep the 53-row synthetic combined baseline valid.
- Keep projector isolation tests. Prove that primitive-only decoy fields do not change product projection.
- Add a product ownership test that changing `canvases[0]` changes lifecycle-chain selection.

## All 12 live baseline contracts

Keep these exact live tests and their full assertions:

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

Use live `checkScenarioResult()`, `evaluateCapture()`, `checkMatrixCoverage()`, `checkVariantInvariance()`, `checkNearestNegatives()`, `applyMutation()`, and `collectDiagnostics()` calls. Disk attacks do not replace these checks.

## Exact 60-attack corpus

Keep exactly these stable executable attacks:

1. `remove-positive-product-finding`
2. `insert-fixed-product-finding`
3. `insert-negative-product-finding`
4. `remove-product-loaf-association`
5. `insert-product-loaf-without-overlap`
6. `remove-product-retired-event`
7. `remove-product-reactivated-event`
8. `insert-fixed-product-lifecycle`
9. `remove-product-detached-event`
10. `insert-fixed-product-detached-event`
11. `remove-primitive-heavy-episode`
12. `remove-primitive-repeated-window`
13. `remove-primitive-resize-reset`
14. `remove-primitive-backing-window`
15. `remove-primitive-lifecycle-gap`
16. `remove-primitive-loaf-overlap`
17. `change-supporting-canvas-key`
18. `change-related-episode-key`
19. `add-product-field`
20. `add-primitive-field`
21. `add-legacy-field`
22. `add-combined-row`
23. `remove-combined-row`
24. `reorder-combined-rows`
25. `legacy-only-file-set`
26. `mutation-only-file-set`
27. `missing-release-file`
28. `missing-idle-file`
29. `extra-hash-line`
30. `duplicate-hash-line`
31. `blank-hash-line`
32. `leading-hash-line`
33. `trailing-hash-line`
34. `duplicate-json-key`
35. `escaped-duplicate-json-key`
36. `negative-backing-ratio`
37. `huge-backing-ratio`
38. `max-value-backing-ratio`
39. `huge-reset-index`
40. `max-safe-lifecycle-index`
41. `huge-event-time`
42. `huge-episode-time`
43. `huge-gap-value`
44. `max-safe-idle-drain-count`
45. `negative-count`
46. `self-time-exceeds-run-duration`
47. `maximum-window-exceeds-total`
48. `contradictory-repeated-total`
49. `png-ihdr-iend-only`
50. `png-invalid-ihdr-crc`
51. `png-invalid-idat-crc`
52. `png-invalid-iend-crc`
53. `png-empty-idat`
54. `png-invalid-deflate-stream`
55. `png-wrong-inflated-size`
56. `png-invalid-filter-byte`
57. `png-trailing-bytes`
58. `png-second-ihdr`
59. `png-nonconsecutive-idat`
60. `coordinated-legacy-and-combined-product-lie`

Do not remove, rename, disable, merge, or replace an attack with a name-only entry. Keep the exact count and unique-name checks. Run every attack through its intended checker.

## Preserved evidence boundary

Keep all SIDPROJ-91 and SIDPROJ-92 closure rules:

- exact 53-row order;
- independent product and primitive observations;
- exact JSON schemas and duplicate-key rejection;
- declared numeric bounds and cross-field totals;
- exact ten-file closed artifact set;
- exact nine-file hash manifest;
- exact legacy projections from combined evidence;
- strict PNG signature, IHDR, IDAT, zlib-consumption, filter, CRC, IEND, and suffix checks;
- exact harness digest inputs;
- zero drops and empty diagnostics;
- exact idle and mutation links;
- safe file types and exact paths.

Do not weaken one boundary to correct a live row.

## Verification funnel

### 1. Focused source checks

Run after each source change:

```text
pnpm --filter dogfood run lab:v0.4:test
git diff --check -- packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs
```

The suite must pass all 13 live-row regressions, all mandatory counterexamples, all 12 baseline contracts, and all 60 attacks.

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
- the live SIDPROJ-93 issue and its relations;
- the complete two-file diff from `65decbced2257a3d15774423c9607e037b77e6fb`;
- both full owned files;
- the exact 13 Chrome failure entries;
- all mandatory counterexamples;
- all 12 live baseline contracts;
- all 60 executable attacks;
- the fresh SIDPROJ-93 ledger.

Tell each reviewer to check the complete diff. Tell each reviewer to return all P1 and P2 findings in one terminal report. Do not give either reviewer the other report. Both source reports must return `PASS` before Chrome.

### 4. One Chrome run after source freeze

Freeze the source after both source judges pass. Run this command once:

```text
pnpm --filter dogfood exec node lab-v04.mjs --idle-release
```

This command is one SIDPROJ-93 evidence run. It must prove:

- 20 of 20 idle rows;
- 53 of 53 matrix rows;
- no recurrence of the 13 listed combined failures;
- all lifecycle bad, fixed, and nearest-negative rows;
- association rows 35 and 39 with equal positive product and primitive results;
- the exact heavy-finding mutation failure;
- zero dropped evidence;
- empty diagnostics;
- current Chrome, Git, bundle, and harness identities;
- exact hashes for all nine artifacts;
- no listener on port `5190` after the run.

Do not rerun Chrome for a source or checker failure. Use evidence run 2 only for one confirmed environment retry after the cause changes.

### 5. Fresh disk checks

Run these checks without another Chrome run:

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

Do not trust the saved hash text without disk recomputation.

### 6. Fresh-evidence judge continuations

Send the fresh artifacts, recomputed hashes, source, and port result to the same two reviewers. This continues the open judge round.

Each reviewer must check:

- the complete combined domain;
- independent product and primitive observations;
- selected lifecycle evidence;
- association-kind alignment;
- exact referenced LoAF, episode, canvas, member-window, document-event, and time binding;
- strict PNG structure and full zlib input use;
- legacy projections and exact hashes;
- environment identities and times;
- diagnostics, drops, mutation, idle links, and port state.

Both reviewers must return `PASS`.

## Closure

After all checks and both judge continuations pass:

1. Stage only `packages/dogfood/lab-v04.mjs` and `packages/dogfood/lab-v04.test.mjs`.
2. Check the staged path list and the full staged diff.
3. Create one clear signed commit with `git commit -S`.
4. Push `agent/sidproj-93-lifecycle-association-closure`.
5. Upload `/private/tmp/sidproj-90-v04-release-evidence.json` to SIDPROJ-93.
6. Upload the final check summary to SIDPROJ-93.
7. Add the commit SHA, all artifact hashes, test counts, Chrome revision, port result, and final ledger to SIDPROJ-93.
8. Mark SIDPROJ-93 Done.
9. Check live Linear state before work starts on another AFK issue.

Do not mark SIDPROJ-92 or SIDPROJ-91 Done as part of SIDPROJ-93 closure. They become separate unblocked issues after SIDPROJ-93 closes.

## Out of scope

- Do not change `packages/dogfood/lab-v04-truth.mjs` or product source.
- Do not change product timing, thresholds, findings, fixture behavior, core instrumentation, collection limits, or browser waits.
- Do not change any v0.5, pack, package, Excalidraw, release-note, or documentation file.
- Do not relax `idle capture contains draw activity`.
- Do not add retries, longer waits, or extra animation-frame waits.
- Do not weaken PNG, numeric, schema, hash, file-set, or privacy checks.
- Do not run SIDPROJ-70.
- Do not tag, publish, open a pull request, or contact an external maintainer.
