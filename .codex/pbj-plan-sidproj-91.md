# SIDPROJ-91 implementation contract

## Goal

SIDPROJ-91 is complete when one combined v0.4 evidence set records two independent observations for every one of the 53 rows. The checker must derive the result from each observation. Both results must equal repository truth and each other. The focused suite must contain at least 40 exact attacks. All source gates, one fresh Chrome run, the disk gates, and the final judge continuation must pass.

## Live issue and baseline

- Linear issue: `SIDPROJ-91`, `V05-09g — Bind product results to closed v0.4 evidence`.
- URL: `https://linear.app/yde/issue/SIDPROJ-91/v05-09g-bind-product-results-to-closed-v04-evidence`.
- Live state during planning: `In Progress`, label `AFK`, no blocker.
- Relations: SIDPROJ-91 blocks SIDPROJ-90. It relates to SIDPROJ-89, SIDPROJ-86, and SIDPROJ-70.
- Branch: `agent/sidproj-91-bind-product-evidence`.
- Baseline commit: `65decbced2257a3d15774423c9607e037b77e6fb`.
- Chrome: `151.0.7922.137`.
- Port `5190` had no listener during planning.
- Git uses SSH signing. `commit.gpgsign=true` and `gpg.format=ssh`.
- The current SIDPROJ-90 implementation is dirty in the two owned files. Keep its useful closed-schema work, but replace its single-observation evidence model.
- The focused baseline passed 20 tests:

  ```text
  pnpm --filter dogfood run lab:v0.4:test
  ```

- The core baseline passed 555 tests:

  ```text
  pnpm --filter canvas-scan test
  ```

- `git diff --check` passed during planning.

## Pre-existing dirty files

The following paths were dirty before this plan file existed:

```text
 M packages/core/test/pack-manifest.test.ts
 M packages/dogfood/lab-v04.mjs
 M packages/dogfood/lab-v04.test.mjs
 M packages/dogfood/lab-v05-truth.mjs
 M packages/dogfood/lab-v05.mjs
 M packages/dogfood/lab-v05.test.mjs
 M packages/dogfood/package.json
 M scripts/pack-manifest.mjs
 M scripts/verify-pack.mjs
?? .codex/pbj-plan.md
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

Only these source files belong to SIDPROJ-91:

```text
packages/dogfood/lab-v04.mjs
packages/dogfood/lab-v04.test.mjs
```

Do not change, stage, commit, format, restore, or remove any other dirty path. The plan file is a workflow file. Do not stage it.

## Run ledger

Start with this ledger and include it in each status update:

```text
correction rounds: 0/1
full evidence runs: 0/2
judge rounds: 0/2
```

A judge round contains two independent reviewer streams. Each stream first checks the frozen source. The same stream later checks the fresh evidence. A failed source check closes that round. A fresh-evidence continuation does not start another round.

If judge round 1 fails, collect all P1 and P2 findings before one correction batch. Add each counterexample to the mutation suite. Run all source gates again. Start judge round 2 only after the source passes.

If judge round 2 fails, stop. Do not make another local patch. If the first Chrome run has an environment failure, use the second evidence run only after the cause changes. Do not start a third evidence run.

## Evidence files

`--check-evidence` must accept only the complete combined set:

```text
/private/tmp/sidproj-55-canvas-lab-v0.4.json
/private/tmp/sidproj-55-variant-matrix.json
/private/tmp/sidproj-55-nearest-negatives.json
/private/tmp/sidproj-55-console-summary.txt
/private/tmp/sidproj-55-integrated-continuous.png
/private/tmp/sidproj-55-integrated-burst.png
/private/tmp/sidproj-55-mutation-output.txt
/private/tmp/sidproj-86-v04-idle-boundary.json
/private/tmp/sidproj-90-v04-release-evidence.json
/private/tmp/sidproj-55-sha256.txt
```

The hash file must list the first nine paths in sorted path order. Each line must use exact `<64 lowercase hex><two spaces><absolute path>\n` syntax. The file must have one terminal newline. It must not have a blank line.

Reject a legacy-only set, a mutation-only set, a partial combined pair, or a missing combined file. Reject an extra hash row, a duplicate row, a changed order, or an undeclared path. Do not select the expected set from the files that happen to exist.

All JSON readers must reject duplicate keys at every nesting level. Reject a JSON artifact larger than 8 MiB. Reject symlinks, directories, and paths outside the exact allowlist.

## Combined release schema

Keep the current top-level release fields and phase linkage. Change each `phases.matrix.rows[]` item to this exact schema:

```text
{
  scenario: Scenario,
  variant: Variant,
  mode: "bad" | "fixed" | "negative",
  productResult: ProductResult,
  primitiveProof: PrimitiveProof
}
```

Use the exact 53-row order from `orderedRuns()`. Reject an extra field, an extra row, a missing row, or a changed row order.

Do not store `expected`, `actual`, `pass`, `unsupported`, or a copied repository result in either observation. The checker computes these values from repository truth after it checks both observations.

### Product-result schema

Build `productResult` only from `session.findings`, `session.lifecycleEvents`, and `session.episodeAssociations`. Do not read windows, episodes, resets, browser entries, fixture state, or the truth manifest when this projection is built.

```text
ProductResult = {
  findings: ProductFinding[],
  lifecycleEvents: ProductLifecycleEvent[],
  episodeAssociations: ProductAssociation[]
}
```

Use SHA-256 keys for product IDs. A key is the lowercase SHA-256 of the exact source ID string. This keeps the relation closed without saved raw IDs or free text.

All product findings have these exact common fields:

```text
{
  type: FindingType,
  evidenceLevel: "candidate",
  claimSha256: LowerHex64,
  canvasKey: LowerHex64,
  relatedEpisodeKeys: LowerHex64[],
  metrics: TypeSpecificMetrics
}
```

Use these exact metric unions:

```text
heavy-canvas-work: {
  canvasApiSelfTimeMs: FiniteMs,
  rasterOperationCount: OperationCount,
  maximumWindowSelfTimeMs: FiniteMs,
  topMethodCount: 1..32
}

repeated-draw-work: {
  repeatedWindowCount: 1..10000,
  rasterOperationCount: OperationCount,
  repeatedWindowIndexes: WindowIndex[],
  repeatedWindowRasterOperationCounts: OperationCount[]
}

resize-churn: {
  activeResetCount: 2..10000,
  resetEventWindowIndexes: WindowIndex[]
}

backing-store-mismatch: {
  affectedWindowCount: 2..10000,
  affectedWindowIndexes: WindowIndex[],
  areaRatios: PositiveRatio[]
}
```

The product lifecycle event schema is exact:

```text
{
  type: "first-observed" | "active" | "detached" | "retired" | "reactivated",
  canvasKey: LowerHex64,
  windowIndex: WindowIndex,
  connected: boolean,
  activeRegistrySize: 0..128,
  evidenceLevel: "measured"
}
```

The product association schema is exact:

```text
{
  entryKey: LowerHex64,
  entryKind: "document-event" | "event-timing" | "user-mark" | "long-animation-frame",
  episodeKey: LowerHex64,
  startedAtTimestampMs: NormalizedMs,
  endedAtTimestampMs: NormalizedMs,
  evidenceLevel: "associated"
}
```

Normalize product-association times against the minimum association start in that product projection. An empty association array uses no time origin. The normalization must not read primitive data.

Sort product findings by type, canvas key, and first related episode key. Sort lifecycle events by window index, type, and canvas key. Sort associations by start, end, entry key, and episode key. Reject duplicate semantic rows.

The findings array has at most `3` items. A finding has `1..10000` related episode keys. The lifecycle array has at most `10000` items. The association array has at most `2000` items. Reject duplicate keys inside a related-episode array.

### Primitive-proof schema

Build `primitiveProof` only from windows, episodes, reset events, browser entries, browser features, collection limits, dropped counts, fixture state, idle state, and diagnostics. Do not read canvas summaries, product findings, lifecycle events, episode associations, or the truth manifest when this projection is built.

```text
PrimitiveProof = {
  windows: PrimitiveWindow[],
  episodes: PrimitiveEpisode[],
  resetEvents: PrimitiveReset[],
  browser: {
    longAnimationFrames: true,
    entries: PrimitiveBrowserEntry[]
  },
  fixture: PrimitiveFixture,
  idle: PrimitiveIdle,
  collectionLimits: CollectionLimits,
  droppedEntryCounts: DropCounts,
  diagnostics: Diagnostics
}
```

Use these exact child schemas:

```text
PrimitiveWindow = {
  canvasKey: LowerHex64,
  windowIndex: WindowIndex,
  startedAtTimestampMs: NormalizedMs,
  endedAtTimestampMs: NormalizedMs,
  canvasApiSelfTimeMs: FiniteMs,
  rasterOperationCount: OperationCount,
  signatureStatus: "same" | "changed" | "unknown",
  actualToExpectedAreaRatio: PositiveRatio | null
}

PrimitiveEpisodeCanvas = {
  canvasKey: LowerHex64,
  canvasApiSelfTimeMs: FiniteMs,
  rasterOperationCount: OperationCount,
  methodCount: 0..32
}

PrimitiveEpisode = {
  episodeKey: LowerHex64,
  firstWindowIndex: WindowIndex,
  lastWindowIndex: WindowIndex,
  startedAtTimestampMs: NormalizedMs,
  endedAtTimestampMs: NormalizedMs,
  canvases: PrimitiveEpisodeCanvas[]
}

PrimitiveReset = {
  canvasKey: LowerHex64,
  windowIndex: WindowIndex,
  source: "width-setter" | "height-setter" | "width-attribute" | "height-attribute" | "context-reset",
  rasterOperationCount: OperationCount,
  activeRasterOverlap: boolean
}

PrimitiveBrowserEntry = {
  entryKey: LowerHex64,
  kind: "document-event" | "long-animation-frame",
  eventType: "pointerdown" | "keydown" | "wheel" | null,
  startedAtTimestampMs: NormalizedMs,
  endedAtTimestampMs: NormalizedMs
}

PrimitiveFixture = {
  interactionStartedAtTimestampMs: NormalizedMs,
  boundaryCount: null | 0..120,
  acceptedRunCount: 0 | 1,
  drawCount: 0..10000000,
  actions: [] | ["Load", "Zoom", "Pan", "Hover", "Search", "Filter", "Resize"],
  visibleChecksum: DeclaredChecksum,
  visibleImageHash: LowerHex8
}

PrimitiveIdle = {
  idleDrawCount: 0,
  preInteractionWindowCount: 0,
  preInteractionEpisodeCount: 0,
  drainWindowCount: 1..10000,
  drainRasterOperationCount: IDLE_BOUNDARY_PROBE_OPERATIONS
}
```

Normalize all primitive timestamps against the earliest primitive timestamp for the row. This includes the fixture interaction time. The minimum is `0`. Each end must be at or after its start. Each interval must be at most `30000` ms.

Sort each primitive array by its declared index or normalized time, then its key. Reject duplicate window indexes for one canvas. Reject duplicate keys for one browser entry or episode. Reject a reset that refers to an unknown canvas or window. Reject an episode that refers to an unknown canvas or an invalid window range.

The windows, episodes, and reset arrays each have at most `10000` items. Each episode has `1..128` canvas items. The browser-entry array has at most `2000` items. The set of canvas keys across windows, episode canvases, and resets has at most `128` items.

## Numeric contract

Apply these bounds to every matching field in combined and legacy evidence:

```text
FiniteMs: finite number in [0, 30000]
NormalizedMs: finite number in [0, 30000]
WindowIndex: integer in [0, 9999]
OperationCount: integer in [0, 10000000]
PositiveRatio: finite number in (0, 1000000]
Canvas count and activeRegistrySize: integer in [0, 128]
Window, episode, reset, lifecycle, and idle-drain counts: integer in [0, 10000]
Browser-entry count: integer in [0, 2000]
Long-frame script-attribution count: integer in [0, 20]
Run duration: finite number in (0, 1800000]
```

The exact collection limits remain:

```text
maxDurationMs: 30000
maxCanvasWindowReports: 10000
maxCanvasLifetimes: 128
maxResetEvents: 10000
maxLifecycleEvents: 10000
maxBrowserEvidenceEntries: 2000
maxLongFrameScriptAttributions: 20
```

Each dropped count is an integer and exactly `0`. Each diagnostics array is exact and empty. No integer field can accept `Number.MAX_SAFE_INTEGER`. No numeric field can accept `1e300`, `Infinity`, `NaN`, a negative count, or a numeric string.

For heavy findings, `maximumWindowSelfTimeMs <= canvasApiSelfTimeMs`. For repeated findings, the array lengths equal `repeatedWindowCount`, and the operation sum equals `rasterOperationCount`. For backing findings, each positive ratio is bounded. The nearest negative has exactly two ratios. One ratio is below `2`; the other ratio is at or above `2`.

## Independent derivation rules

For each manifest expectation, compute `productActual` from `productResult` only. Compute `primitiveActual` from `primitiveProof` only. Then require:

```text
productActual === primitiveActual
productActual === manifest.expectation.expected
primitiveActual === manifest.expectation.expected
```

Apply these rules:

- A heavy result needs one qualifying product heavy finding. Primitive truth needs one episode canvas with at least `8` ms, positive operations, a positive maximum window, and at least one method.
- A repeated result needs one qualifying product repeated finding. Primitive truth needs a `same` window inside one episode with at least two operations.
- A resize result needs one qualifying product resize finding with two distinct reset indexes. Primitive truth needs active resets in at least two distinct known windows.
- A backing result needs one qualifying product backing finding with at least two qualifying windows. Primitive truth needs at least two active windows with ratios at or above `2`.
- A lifecycle result needs measured `retired` and later `reactivated` product events for the same canvas. Primitive truth needs `boundaryCount === 120` and two active windows for the same canvas key on opposite sides of that fixture gap.
- A replacement result needs a measured product `detached` event for the old canvas. Primitive truth needs two different working canvas keys in the integrated-burst row and the exact seven fixture actions.
- An association result needs one qualifying product LoAF association. Primitive truth needs the declared document event, one LoAF entry, one episode, overlap between the LoAF and episode, and the primary supporting canvas.
- A fixed or negative row must have no qualifying product result and no qualifying primitive result.
- Apply the existing seven nearest-negative rules to primitive data. The product result must stay absent for each nearest-negative row.
- Keep the current live capture check for the non-React ownership rule. The disk contract binds that checked finding to the matching primitive episode canvas key.
- Reject a product key that does not resolve to the corresponding primitive key. This relationship check does not let one projection create the other projection's result.

Do not use `pass`, `actual`, `unsupported`, product-visible text, or runtime globals as expected truth. Do not add a phrase denylist. Use `lab-v04-truth.mjs` only as repository truth.

## Legacy projections

Create the combined row first. Build the primary, matrix, and nearest-negative files only as exact projections of combined rows.

The primary compatibility row keeps the current manifest fields and adds exact `productResult` and `primitiveProof` fields. Its `expectations`, `pass`, and `failures` fields are presentation fields only. Compute them from the checked dual observation. Never use them to prove the row.

The matrix row is the exact declared subset of the primary row. The nearest-negative row is the exact declared subset of the seven primary negative rows. The console summary is an exact function of the primary file. The checker must reconstruct all three legacy JSON files and the console summary from the combined file and current repository truth. Require byte-equivalent JSON values and exact text.

A coordinated change to combined and legacy files must still fail when either observation differs from primitive truth or repository truth. Reject extra product fields, extra proof fields, extra legacy fields, extra free text, and extra expectation fields.

## PNG contract

Replace `validPng` with a strict parser. Use the PNG signature and CRC-32 polynomial. Do not use a signature-only or dimensions-only check.

For each screenshot, require:

1. The file size is at least 58 bytes and at most 8 MiB.
2. The signature is exact.
3. The first chunk is the only `IHDR` chunk.
4. `IHDR` has length `13`, width `1440`, height `1000`, bit depth `8`, color type `2`, compression `0`, filter `0`, and interlace `0`.
5. One or more consecutive `IDAT` chunks follow `IHDR`. Each `IDAT` chunk is non-empty.
6. The concatenated IDAT stream inflates successfully.
7. The inflated size is exactly `(1440 * 3 + 1) * 1000` bytes. Each scanline filter byte is in `[0, 4]`.
8. Each chunk CRC-32 equals the CRC of its type bytes followed by its data bytes.
9. One zero-length `IEND` chunk follows the final `IDAT` chunk.
10. `IEND` is terminal. No bytes follow it.

Reject unknown chunks. This lab owns the screenshots and current Chrome writes only `IHDR`, consecutive `IDAT`, and `IEND` chunks.

## File changes

### `packages/dogfood/lab-v04.mjs`

- Replace `projectFinding`, `projectLifecycle`, `projectAssociation`, `projectNegative`, and `buildRowProof` with separate product and primitive projectors.
- Add one stable ID-digest helper and separate time-normalization helpers. Do not let one projector read the other projector's sources.
- Replace `validFindingProof`, `validNegativeProof`, `checkRowProof`, and `checkMatrixProofs` with exact schema checks and the dual derivation rules.
- Change `captureRow` to return both observations. Keep the existing product timing, fixture waits, and evaluation behavior unchanged.
- Change `captureIdleSet` and the release evidence writer to use the new row schema.
- Make `writeMatrixEvidence` build the legacy files only from checked combined rows.
- Change `validateEvidence` to require all nine hashed artifacts on every `--check-evidence` call.
- Keep `parseExactJson` and strengthen its tests for escaped duplicate keys and malformed Unicode escapes.
- Keep `parseHashManifest`, but bind it to the exact nine-file order and exact line count.
- Replace `validPng` with the strict chunk, CRC, inflate, and scanline check.
- Add a pure artifact-set checker that unit tests can call for missing-file, extra-line, partial-pair, and coordinated legacy mutations.
- Keep the harness digest over exactly `lab-v04.mjs`, `lab-v04-truth.mjs`, `V04Lab.tsx`, `v04-lab-main.tsx`, and `v04-lab.html`.
- Do not change the fixture, truth manifest, product source, thresholds, or browser waits.

### `packages/dogfood/lab-v04.test.mjs`

- Replace `proofRows()` with independent `productResultRows()` and `primitiveProofRows()` builders.
- Add direct tests that one builder cannot use fields from the other source set.
- Add exact schema tests for every type-specific finding and every primitive child type.
- Build a valid RGB PNG with correct CRCs and a valid compressed image stream.
- Test every numeric lower bound, upper bound, cross-field relation, and array bound that this plan declares.
- Keep the existing truth, scenario, and idle tests.
- Add at least 40 independent mutation functions. Assert the exact mutation count and give each attack a stable machine name.

## Mandatory mutation corpus

The focused suite must contain at least these 50 named attacks:

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

Each attack must change one declared fact. Each attack must fail for the intended checker rule. Do not accept a failure from an unrelated malformed fixture.

## Verification funnel

### Focused checks

Run after each source change:

```text
pnpm --filter dogfood run lab:v0.4:test
git diff --check -- packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs
```

The focused suite must report at least 20 tests and at least 60 named attacks. All must pass.

### Standard source checks

Run after the focused checks pass:

```text
pnpm --filter canvas-scan test
pnpm typecheck
pnpm --filter canvas-scan run build
pnpm --filter workbench exec vite build
git diff --check
git status --short --branch
git diff --name-only
```

The core suite must report at least 555 passing tests. The two build commands must pass. `git diff --name-only` can show unrelated pre-existing dirty files, but the SIDPROJ-91 diff must touch only the two owned files.

### Source judge gate

Give two independent reviewers these items:

- this full plan;
- the live SIDPROJ-91 description;
- the complete two-file diff from baseline commit `65decbced2257a3d15774423c9607e037b77e6fb`;
- both full owned files;
- the complete named mutation corpus;
- the current ledger;
- the known SIDPROJ-90 counterexamples.

Tell each reviewer to return all P1 and P2 findings in one terminal report. Do not give either reviewer the other report. Both source reports must return PASS before Chrome.

### Expensive evidence checks

Freeze the source after both source reports pass. Run this command once:

```text
pnpm --filter dogfood exec node lab-v04.mjs --idle-release
```

This is one full evidence run. It must prove:

- 20 of 20 idle rows;
- 53 of 53 matrix rows;
- the exact heavy-finding mutation failure;
- zero dropped evidence;
- empty diagnostics;
- current Chrome, Git, bundle, and harness identities;
- exact hashes for all nine artifacts;
- no listener on port `5190` after the run.

Then run the disk checker without another browser run:

```text
pnpm --filter dogfood exec node lab-v04.mjs --check-evidence
pnpm --filter dogfood run lab:v0.4:test
/usr/sbin/lsof -nP -iTCP@127.0.0.1:5190 -sTCP:LISTEN
```

The first two commands must pass. The listener command must return no rows. Recompute every artifact hash from disk. Do not trust the saved hash text.

### Fresh-evidence judge continuation

Send the fresh artifacts and recomputed hashes to the same two reviewers. This is a continuation of the open judge round. Give each reviewer the source that produced the evidence. Do not give either reviewer the other report.

Each reviewer must check the complete combined domain, both observations, all legacy projections, PNG structure, hash closure, identities, times, diagnostics, drops, port state, and the declared mutation results. Both reviewers must return PASS.

## Closure

After all checks and both judge continuations pass:

1. Stage only `packages/dogfood/lab-v04.mjs` and `packages/dogfood/lab-v04.test.mjs`.
2. Check the staged diff and staged path list.
3. Create one clear signed commit.
4. Push `agent/sidproj-91-bind-product-evidence`.
5. Upload the combined release JSON and the final check summary to SIDPROJ-91.
6. Add the commit SHA, artifact SHA-256, check counts, Chrome revision, and final ledger to Linear.
7. Mark SIDPROJ-91 Done.
8. Recheck live Linear state before work starts on another AFK issue.

Do not stage the plan file or any pre-existing dirty file. Do not tag, publish, open a pull request, or run SIDPROJ-70.

## Out of scope

- Do not change product timing, finding logic, thresholds, collection limits, or fixture behavior.
- Do not change `apps/workbench/src/V04Lab.tsx` or `packages/dogfood/lab-v04-truth.mjs`.
- Do not relax `idle capture contains draw activity`.
- Do not add retries, longer waits, or more animation-frame waits.
- Do not add natural-language denylists or phrase-by-phrase exceptions.
- Do not change v0.5, pack, release-note, Excalidraw, or package files.
- Do not run SIDPROJ-70.
- Do not tag, publish, open a pull request, or contact an external maintainer.
