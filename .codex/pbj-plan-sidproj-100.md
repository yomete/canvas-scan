# SIDPROJ-100 implementation contract

## Falsifiable goal

SIDPROJ-100 is complete when one fresh targeted Chrome run creates `/private/tmp/sidproj-100-heavy-negative-probe.json` once with mode `0600`. The artifact must contain exactly ten finite Canvas2D API self-time values in `[7, 8)`. The fixture must derive its bounded workload only from exact, same-realm `CanvasRenderingContext2D` native calls that the bootstrap captures before Canvas Scan loads. The native calibration and wrapped measurement must replay one ordered operation plan. Every source, disk, evidence, judge, commit, push, and Linear gate in this contract must pass.

## Live issue state

- Issue: `SIDPROJ-100`, `V05-09p — Calibrate with exact HTML Canvas native calls`.
- URL: `https://linear.app/yde/issue/SIDPROJ-100/v05-09p-calibrate-with-exact-html-canvas-native-calls`.
- State during planning: `In Progress` with the `AFK` label.
- Parent: `SIDPROJ-62`.
- SIDPROJ-100 has no blockers.
- SIDPROJ-100 blocks SIDPROJ-99.
- It relates to SIDPROJ-98, SIDPROJ-95, and SIDPROJ-70.
- SIDPROJ-70 stays out of scope.
- The issue has no comments, attachments, or releases during planning.

Both final SIDPROJ-99 source judges returned `FAIL`. Carry all six facts into the implementation and tests:

1. The Offscreen trailing workload omits the full background fill.
2. The Offscreen trailing workload uses unscaled scene rectangles.
3. The Offscreen timer includes JavaScript loop and setter time.
4. Offscreen Canvas2D has no timing contract with HTML Canvas2D.
5. Warm-up tests do not use the real sample-selection path.
6. Telemetry and old-path mutation tests do not cover their complete contracts.

Do not patch the rejected SIDPROJ-99 design. Replace it with the one design in this contract.

## Baseline and initial dirty tree

- Branch: `agent/sidproj-100-exact-html-native-calibration`.
- Current `HEAD` and implementation baseline: `65decbced2257a3d15774423c9607e037b77e6fb`.
- Merge base with `origin/main`: `20e53799202a0193f6c48c9b438ec9452b80dfaf`.
- Git uses SSH signing. `commit.gpgsign=true` and `gpg.format=ssh`.
- Port `5190` had no listener during planning.
- `/private/tmp/sidproj-99-heavy-negative-probe.json` was absent.
- `/private/tmp/sidproj-100-heavy-negative-probe.json` was absent.
- `git diff --check` passed.
- The focused probe suite passed 208 tests.
- The v0.4 lab suite passed 63 tests, all 60 attacks, and all 12 live contracts.

The exact initial `git status --short --branch` output is:

```text
## agent/sidproj-100-exact-html-native-calibration
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

Preserve all unrelated v0.5, release, package, pack, document, and agent work. Do not reset, clean, stash, restore, remove, or format unrelated paths. Compare the final dirty tree with this list before staging.

## Artifact preservation

`/private/tmp/sidproj-95-heavy-negative-probe.json` is a regular mode-`0600` file. Its planning facts are:

```text
size=8289
device=16777234
inode=904777482
sha256=4d8b2292910fba995d837b392e439274b0fdf412200941f337e25ad134827d65
```

Treat it as read-only evidence. Do not remove, rename, replace, chmod, reuse, upload as new evidence, or write it. Apply the same no-target rule to `/private/tmp/sidproj-99-heavy-negative-probe.json`.

The only new production path is:

```text
/private/tmp/sidproj-100-heavy-negative-probe.json
```

Use `lstat()` semantics. If that path exists as a regular file, link, directory, or another type before the targeted run, stop. Do not remove or replace it.

## Exact closure scope and planning hashes

The final closure allowlist contains exactly these nine files:

```text
apps/workbench/public/v04-lab.html
apps/workbench/src/v04-lab-main.tsx
apps/workbench/src/V04Lab.tsx
packages/dogfood/lab-v04-truth.mjs
packages/dogfood/lab-v04.mjs
packages/dogfood/lab-v04.test.mjs
packages/dogfood/v04-heavy-negative-probe.mjs
packages/dogfood/v04-heavy-negative-probe-check.mjs
packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

Their planning hashes are:

```text
ac0c83afbf4377be0257596a66f4a0661c45feaac2d2606b8e260ef9777c17b3  apps/workbench/public/v04-lab.html
dd9afe5a33fd3a43aac1e5fb5dcf9d276c45b30e629bc9cf07bcedca94fb176b  apps/workbench/src/v04-lab-main.tsx
10367ed6bdbf0e047146ee7f4b10f0a24bb36526bf0c846f14f29d7929c3b822  apps/workbench/src/V04Lab.tsx
ca1a7a66360a77e2fce4bfe42030bb1eaf5dea16ae7b1049abb59d9b804effe9  packages/dogfood/lab-v04-truth.mjs
91970eb07365ca7abe3bab79b78ab35984ba997ebead5a6d72ce3d89549f80be  packages/dogfood/lab-v04.mjs
95888d4d6cbe7d0177f3db8f476100bbdf596e9a1c20f400a0c445fb63f9d687  packages/dogfood/lab-v04.test.mjs
2f70021323e4c7c4466d8914ea90705fad2176e81f82efdc41dcb3f76b4c5e96  packages/dogfood/v04-heavy-negative-probe.mjs
45dbe0359e200d7ac069c011181e9cb96b3df7d114516a5b14b8b6e6d3d23fa0  packages/dogfood/v04-heavy-negative-probe-check.mjs
4ce911f12506a5e9f9563be5b8b5b00af4d947eba86050348ef70b7a93234a95  packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

Keep these three inherited files byte-identical unless a focused or standard gate proves that a change is necessary:

```text
ca1a7a66360a77e2fce4bfe42030bb1eaf5dea16ae7b1049abb59d9b804effe9  packages/dogfood/lab-v04-truth.mjs
91970eb07365ca7abe3bab79b78ab35984ba997ebead5a6d72ce3d89549f80be  packages/dogfood/lab-v04.mjs
95888d4d6cbe7d0177f3db8f476100bbdf596e9a1c20f400a0c445fb63f9d687  packages/dogfood/lab-v04.test.mjs
```

The expected source change set is the other six files. If a frozen file must change, record the failing gate and the smallest proved change before implementation. Do not change `packages/dogfood/package.json`. Do not stage this plan.

## Run ledger and stop rules

Start with this exact ledger:

```text
correction rounds: 0/1
full evidence runs: 0/2
judge rounds: 0/2
```

A judge round has two independent source judges. The same two streams later check the fresh disk evidence.

Collect every P1 and P2 finding from both judges before one correction batch starts. Add each accepted counterexample to focused and disk mutation tests. If judge round 2 fails, stop. Do not add local phrase patches after that failure.

Evidence run 1 is the targeted ten-capture probe. Evidence run 2 is the complete `--idle-release` capture. Chrome and all full release commands are expensive. Root must not start them until both source judges return `PASS`. Do not start a third evidence run.

Allow one retry only after a confirmed browser, port, network, or fixture timing environment failure changes. Do not retry a product, native model, writer, checker, schema, or contract failure.

At 90 minutes, report elapsed time, passed gates, remaining gates, and the ledger. At two hours, stop the same patch loop. Reassess the model or report the concrete blocker.

## One same-realm native design

Use this design. Do not substitute Offscreen Canvas, a product-output feedback loop, a fixed guessed call count, or a widened band.

### Bootstrap order and capability

In `v04-lab-main.tsx`, execute these actions in this order:

1. Read `CanvasRenderingContext2D.prototype` from the current page realm.
2. Capture direct references to its exact `putImageData`, `fillRect`, and `clearRect` functions.
3. Create one detached `HTMLCanvasElement` in the same page realm before Canvas Scan loads.
4. Set that canvas to exactly `1280` by `560` and get its `CanvasRenderingContext2D` before Canvas Scan loads.
5. Put the canvas, context, and three method references in one frozen, module-local capability object.
6. Fail before a script load if the canvas, context, dimensions, receiver identity, or methods are invalid.
7. Create and await the `/canvas-scan.iife.js` script load.
8. After the IIFE load resolves, dynamically import `react`, `react-dom/client`, and `./V04Lab`.
9. Render with the dynamically imported `createElement(V04Lab, { nativeCanvas2D })`. Do not use JSX in the bootstrap.

Do not use a static runtime import for React, `react-dom/client`, or `V04Lab`. A type-only import is also unnecessary. Keep the capability type structurally compatible in the two modules.

Remove the static `/canvas-scan.iife.js` script tag from `v04-lab.html`. Keep `window.__CANVAS_SCAN_OPTS = { overlay: true }` before the module bootstrap. Do not change the React refresh preamble unless a source test proves that it violates the required load order.

The bootstrap must not assign the capability or any native function to `window`, `globalThis`, a DOM node, a DOM property, a data attribute, React state, or another module. Pass the one object only through the direct `V04Lab` prop. The detached canvas and context must also stay in that capability. Canvas Scan must never observe a `getContext()` call for the calibration canvas.

### Capability validation

Define the fixture-only prop with exactly these fields:

```text
canvas
context
putImageData
fillRect
clearRect
```

Reject a missing object, a null value, an array, a missing field, an extra field, a non-canvas receiver, a wrong context, a wrong dimension, a context whose `canvas` is not the captured canvas, or a non-function method. Run this check before the fixture publishes `ready`. Do not include the functions, their names, their source text, or the capability object in an error string.

### Detached HTML calibration canvas

For only `heavy-burst/nearest-negative/negative`:

- Use the calibration canvas and context that the bootstrap created before the IIFE loaded.
- Require its backing width to equal exactly `1280` and height to equal exactly `560`.
- Do not call `getContext()` for the calibration canvas after the IIFE loads.
- Never append the canvas to the DOM.
- Never add it to `directCanvases`, `scenarioCanvases`, `contexts`, product reports, or screenshots.
- Never use `OffscreenCanvas` or `OffscreenCanvasRenderingContext2D`.
- Create all pixels and plan data before timing starts.

Keep the visible primary canvas CSS size at `320` by `140`. Keep its backing size at exactly `1280` by `560` for this coordinate. Bind telemetry to the real detached and primary backing dimensions. Fail before `ready` if either canvas differs.

### Shared ordered operation plan

Build one module-local ordered plan for a selected `putImageData` call count. The native calibration and wrapped measurement must replay this same plan object. Do not build separate native and measured workloads.

Create one same-realm `ImageData` object with `new ImageData(1280, 560)` after instrumentation. Do not call `createImageData()` on either context. Put that same object in every `putImageData` plan entry. Replay the same object on the detached and primary contexts. Do not create receiver-specific pixel arguments.

The plan starts with the selected number of full-size `putImageData(imageData, 0, 0)` calls. It then contains exactly these 200 workload calls, in index order from 0 through 199:

```text
x = (index * 13) % (1280 - 8)
y = (index * 7) % (560 - 8)
fillRect(x, y, 3, 2)
```

The plan ends with the exact nearest-negative final paint. Preserve this exact order:

```text
imageSmoothingEnabled = false
clearRect(0, 0, 1280, 560)
fillStyle = '#07111f'
fillRect(0, 0, 1280, 560)
fillStyle = '#38bdf8'
fillRect(72, 96, 328, 176)
fillStyle = '#a78bfa'
fillRect(528, 96, 224, 176)
```

Thus, the final paint has four native method calls and four style steps. The plan has `callCount + 204` native method calls. It has four style steps. It includes the full background fill and the scaled scene geometry.

Represent method steps with a closed method enum:

```text
putImageData | fillRect | clearRect
```

Represent style steps with a closed property enum:

```text
imageSmoothingEnabled | fillStyle
```

The calibration replayer must invoke each method with `Reflect.apply(capturedMethod, detachedContext, args)`. The measured replayer must invoke the normal context method on the wrapped primary context. Both replayers must consume the same ordered entries and arguments.

The measured path must keep `state.drawCount` behavior equal to the current final `paint()` call. It must keep three settle frames, one accepted fixture run, and all other scenarios unchanged.

### Per-call timing boundary

Use one small native-call timer. Its measured interval must contain only this call:

```text
Reflect.apply(capturedMethod, detachedContext, args)
```

Write `measureNativeCall` as a named, standalone plain-JavaScript function. Inject its `now` function. The Node test must extract and evaluate this exact source function as it does for `selectHeavySamples`. Production must pass `performance.now.bind(performance)`.

Call `performance.now()` immediately before and immediately after that expression. Keep the following work outside the interval:

- loop control;
- plan construction;
- argument calculation;
- method lookup;
- style setters;
- sample array writes;
- totals and median work;
- React, wrapper, fixture, and telemetry work.

Record each native-call duration separately. Sum those durations after the replay. Do not time a complete loop or plan and call it native self-time.

### Warm-up and real sample selection

Run warm-up before every saved sample and before fixture `ready`. Keep it outside recording. Use the captured methods and the detached HTML context.

Keep these bounds:

```text
targetMs = 7.4
bandMinimumInclusiveMs = 7
bandMaximumExclusiveMs = 8
maxIterations = 2048
maxMeasuredWorkElapsedMs = 12
maxPreflightElapsedMs = 50
trailingOperations = 200
finalPaintCount = 1
workloadScale = 4
workloadWidth = 1280
workloadHeight = 560
warmupCallCount = 2
primitiveSampleCount = 3
fixedPlanSampleCount = 3
maxCallCount = 32
```

Use one pure sample-selection helper in the fixture. It must accept tagged sample events. Each event has the closed phase enum `warmup | saved` and closed kind enum `primitive | fixed-plan`. The helper must select only `saved` events. The fixture and tests must call this same helper.

Write `selectHeavySamples` as a named, standalone function with plain JavaScript syntax in `V04Lab.tsx`. The Node test must read the file, extract that exact function declaration with a balanced-brace source helper, evaluate it in an isolated `Function`, and call it with the mutation corpus. Do not copy its logic into the test or checker.

Run exactly two unsaved primitive warm-up calls. Run one unsaved fixed-plan warm-up. Then collect exactly three saved primitive samples. Collect exactly three saved fixed-plan samples. A fixed-plan sample replays the 200 workload calls and exact final paint with zero `putImageData` calls. It sums only the separate native-call durations.

Compute the median of each three-item saved array. Use raw finite millisecond values for selection. Do not add loop or setter time. Compute:

```text
nativeWorkBudgetMs = targetMs - fixedPlanMedianMs
callCount = ceil(nativeWorkBudgetMs / primitiveMedianMs)
modeledNativeSelfTimeMs = primitiveMedianMs * callCount + fixedPlanMedianMs
```

Require a finite positive primitive median. Require a finite nonnegative fixed-plan median. Require a finite positive budget. Require integer `callCount` in `[1, 32]` and at most `2048`. Require `modeledNativeSelfTimeMs` in `[7, 8)`.

Build the final shared plan with that call count. Replay it once through the captured native functions. Save every per-call duration in order. Require the array length to equal `callCount + 204`. Require its exact sum, `calibratedNativeSelfTimeMs`, in `[7, 8)`. Fail before `ready` if any check fails.

Do not round, clamp, add a tolerance to, or widen either `[7, 8)` gate. If telemetry uses a display rounding helper, the checker must not use the rounded value for band acceptance or call selection.

Measure one outer duration around the full wrapped replay only for telemetry and the inherited measured-work cap. It must not control the plan or call count. Require it to be finite and nonnegative. Record `measuredOuterOverrunMs = max(0, measuredOuterTimeMs - 12)`. Fail the fixture if the overrun is not zero.

Require the total preflight wall time to be finite, nonnegative, and at most 50 ms. Keep the full operation and selection work within the existing 2048 iteration bound.

## Exact heavy calibration telemetry

Replace the rejected Offscreen schema with one closed object. It has only these keys:

```text
targetMs
bandMinimumInclusiveMs
bandMaximumExclusiveMs
maxIterations
maxMeasuredWorkElapsedMs
maxPreflightElapsedMs
trailingOperations
finalPaintCount
finalPaintMethodCallCount
finalPaintStyleStepCount
workloadScale
workloadWidth
workloadHeight
trailingXMultiplier
trailingYMultiplier
trailingEdgeInset
trailingRectWidth
trailingRectHeight
scene
finalPaintColors
warmupPolicy
calibrationSource
timingModel
operationPlan
cap
warmupCallCount
primitiveSampleCount
fixedPlanSampleCount
maxCallCount
primitiveSamplesMs
primitiveMedianMs
fixedPlanSamplesMs
fixedPlanMedianMs
nativeWorkBudgetMs
callCount
planCallCount
planStyleStepCount
calibrationCallDurationsMs
calibratedNativeSelfTimeMs
modeledNativeSelfTimeMs
measuredOuterTimeMs
measuredOuterOverrunMs
preflightElapsedMs
```

Use these exact strings and arrays:

```text
warmupPolicy = 'same-realm-native-before-ready'
calibrationSource = 'detached-html-canvas-2d-native'
timingModel = 'per-native-call'
operationPlan = 'heavy-negative-v1'
cap = 'call-count'
scene = [18, 24, 82, 44, 132, 56]
finalPaintColors = ['#07111f', '#38bdf8', '#a78bfa']
```

The checker must reject a missing key, an extra key, a wrong enum, a wrong array order, or a wrong constant. It must reject each negative, fractional where integer-only, non-finite, out-of-range, missing, extra, or inconsistent mutable value.

The checker must recompute all of these facts:

- three-item sample counts and medians;
- native budget;
- bounded call count;
- modeled native total;
- plan native-call count;
- plan style-step count;
- per-call duration count and sum;
- both exact `[7, 8)` gates;
- measured outer overrun;
- all dimensions, geometry constants, caps, and enums.

No function reference, function name, function source, operation argument that contains `ImageData`, or capability value can enter telemetry.

## File and symbol changes

### `apps/workbench/public/v04-lab.html`

- Remove the static `/canvas-scan.iife.js` script element.
- Keep the Canvas Scan option assignment before `v04-lab-main.tsx`.
- Keep the existing document, style, refresh preamble, root, and module entry.
- Make the bootstrap the only owner of the IIFE load.

### `apps/workbench/src/v04-lab-main.tsx`

- Add the exact native capture at module start.
- Create the detached HTML canvas and its context before instrumentation starts.
- Add the narrow async script loader for `/canvas-scan.iife.js`.
- Remove static React and `V04Lab` imports.
- Do not use JSX or an injected JSX runtime in this bootstrap.
- Await the IIFE before the dynamic `react`, `react-dom/client`, and `V04Lab` imports.
- Render with the dynamically imported `createElement`.
- Keep native references in module-local state.
- Pass one frozen capability prop to `V04Lab`.
- Do not export the capability or put it in an error, log, DOM field, or global.

### `apps/workbench/src/V04Lab.tsx`

- Add the exact capability prop and fail-closed validation.
- Remove every `OffscreenCanvas` type and use.
- Use the detached same-realm HTML calibration canvas and context from the pre-IIFE capability.
- Do not call `getContext()` for that canvas after Canvas Scan loads.
- Add the tagged sample-selection helper that both fixture code and tests exercise.
- Add one shared ordered operation-plan builder.
- Add the native and wrapped replayers for that same plan.
- Add the per-call native timer with the exact boundary above.
- Replace `trailingWork()` and the separate final `paint()` path for this coordinate with the shared plan.
- Keep all other coordinates and visible results unchanged.
- Replace `HeavyCalibration` with the exact schema above.
- Keep warm-up, calibration, and sampling before `ready` and before recording.
- Keep the 50 ms, 12 ms, 2048, 200, one-final-paint, and bounded-call-count caps.
- Keep product truth independent. Do not read Canvas Scan output.

### `packages/dogfood/lab-v04-truth.mjs`

- Keep the file byte-identical at its frozen hash.
- Change it only if a focused test proves that the exact `[7, 8)` product boundary cannot stay active without a change.
- Do not change the product threshold, truth projection, failure wording, or primitive/product split.

### `packages/dogfood/lab-v04.mjs`

- Keep the file byte-identical at its frozen hash.
- Preserve the 53-row matrix, 20-row idle set, 60 attacks, 12 live contracts, release artifact, diagnostics, drops, identity, PNG, and port gates.
- Do not copy native capability values into the release evidence.

### `packages/dogfood/lab-v04.test.mjs`

- Keep the file byte-identical at its frozen hash.
- Preserve 63 tests, all 60 attacks, all 12 live contracts, and the exact heavy boundary tests.

### `packages/dogfood/v04-heavy-negative-probe.mjs`

- Change `artifactPath` to `/private/tmp/sidproj-100-heavy-negative-probe.json`.
- Change `productionPublicationRequest()` to final name `sidproj-100-heavy-negative-probe.json`.
- Keep create-once hard-link publication, `0700` directory mode, `0600` file mode, inode binding, cleanup order, race labels, process ownership, drain, capture order, and port proof unchanged.
- Keep exactly ten new browser contexts and one accepted fixture run per capture.
- Keep the artifact schema closed. Store the new calibration object only.
- Keep SIDPROJ-95 and SIDPROJ-99 paths outside every filesystem target.

### `packages/dogfood/v04-heavy-negative-probe-check.mjs`

- Accept only `/private/tmp/sidproj-100-heavy-negative-probe.json`.
- Print only `SIDPROJ_100_HEAVY_NEGATIVE_PROBE: PASS` on success.
- Replace `validCalibration()` with the exact schema and arithmetic above.
- Keep `checkArtifact()` label order and total behavior.
- Keep current identity, diagnostics, drop, timestamp, aggregate, and port checks.
- Keep the fixture product-output privacy check.
- Add finite source-proof helpers for bootstrap order, capability confinement, plan equivalence, timing boundaries, Offscreen absence, and old-path targets.
- Do not use a growing natural-language denylist as the primary proof.

### `packages/dogfood/v04-heavy-negative-probe-check.test.mjs`

- Update fixtures and policy assertions to SIDPROJ-100.
- Exercise the real tagged sample-selection helper contract through its source-defined model. Do not use an unrelated arithmetic example.
- Add the complete telemetry, plan, bootstrap, timer, privacy, old-path, and mandatory counterexample corpus below.
- Keep all 20 create-once disk cases, six race additions, total validator cases, cleanup cases, diagnostics cases, and identity cases.
- Never create a test object at a real production artifact path.

## Source-level privacy and order proof

Add a finite source proof that reads these files:

```text
apps/workbench/public/v04-lab.html
apps/workbench/src/v04-lab-main.tsx
apps/workbench/src/V04Lab.tsx
packages/dogfood/v04-heavy-negative-probe.mjs
packages/dogfood/v04-heavy-negative-probe-check.mjs
```

The proof must use exact allowed source shapes or exact occurrence counts for the capability identifiers. It must show all these facts:

1. `v04-lab.html` has no static Canvas Scan IIFE script.
2. `v04-lab-main.tsx` reads all three prototype methods and creates the calibration canvas and context before its script loader call.
3. The script load resolves before all three dynamic import expressions.
4. There are no static runtime React or `V04Lab` imports, JSX expressions, or injected JSX runtime imports in the bootstrap.
5. The capability has one creation site and one prop handoff site.
6. `V04Lab` uses it only for validation and detached native replay, and never calls `getContext()` for the captured canvas.
7. No assignment target for the capability or its functions is a global or DOM property.
8. No fixture snapshot, telemetry key, artifact field, diagnostics field, screenshot input, error expression, or log expression contains the capability or a native function.
9. No source serializes, stringifies, clones, hashes, or interpolates a native function.
10. The bootstrap and fixture do not export the capability.

Mutate each forbidden sink separately. The proof must fail when a native function enters `window`, `globalThis`, a DOM property, `FixtureSnapshot`, `HeavyCalibration`, an artifact run, diagnostics, a screenshot value, an error string, or a console call.

This source proof is the release proof that captured native functions never enter globals, DOM, artifacts, diagnostics, screenshots, or error strings.

## Mandatory focused and mutation corpus

Add every case below. Require exact checker failure arrays where the current test style uses them.

### Bootstrap and capability

1. The three exact prototype references are captured before IIFE load.
2. The detached canvas and context are created before IIFE load and are never registered after instrumentation.
3. The IIFE resolves before `react`, `react-dom/client`, and `V04Lab` imports.
4. A static React import fails the source proof.
5. A static `V04Lab` import fails the source proof.
6. JSX or a JSX-runtime import in the bootstrap fails the source proof.
7. Each missing, extra, null, array, wrong-receiver, wrong-dimension, or non-function capability shape fails before `ready`.
8. Each forbidden native-function sink fails the privacy proof.

### Workload equivalence

1. The native and wrapped replayers consume the same plan object.
2. Compare every ordered entry, method enum, style enum, receiver dimension, and argument.
3. Require exactly 200 workload `fillRect` entries.
4. Require the background `fillRect(0, 0, 1280, 560)`.
5. Require scaled cyan geometry `(72, 96, 328, 176)`.
6. Require scaled purple geometry `(528, 96, 224, 176)`.
7. Require exact style order and exact final paint order.
8. Reject a plan that omits the background fill.
9. Reject unscaled scene rectangles.
10. Reject a different native receiver, dimension, argument, style value, order, or final paint step.
11. Reject any `OffscreenCanvas` source use.

### Timing and warm-up

1. A JavaScript loop adds 0.8 ms outside a native call. The native sample stays unchanged.
2. Style setters add 0.5 ms outside a native call. The native sample stays unchanged.
3. Plan creation and sample-array work add time. The native sample stays unchanged.
4. Mutate the real timer so loop, setter, or plan work enters its interval. The source proof must fail each mutation.
5. Feed a cold 2.4 ms warm-up through the real tagged sample-selection helper. It must not enter saved arrays, medians, budgets, or the plan.
6. Put a slow warm-up event between saved events. It must not enter saved arrays, medians, budgets, or the plan.
7. Change a warm-up tag to `saved`. The selected result must change and the test must detect it.
8. Require calibration-call duration count `callCount + 204` and exact sum.
9. Reject an outer plan timer as a native-call timer.

### Telemetry and product band

1. Mutate every telemetry key independently.
2. Remove and add every telemetry key independently.
3. Mutate one element in each numeric array to a negative value.
4. Mutate one element in each numeric array to `NaN`, `Infinity`, and `-Infinity`.
5. Mutate each integer-only count, dimension, and constant to a fraction.
6. Mutate each count, constant, dimension, budget, cap, enum, and derived field independently.
7. Mutate each scene and color array element independently.
8. Reject false medians, budget, call count, plan counts, sums, model, outer overrun, and preflight bounds.
9. Reject modeled or calibrated native time below 7 or at least 8.
10. Reject a product value of `6.999`.
11. Reject a product value of exactly `8`.
12. Reject missing, extra, reordered, duplicate, or non-finite product values.
13. Recompute minimum, maximum, and median from exactly ten values.

### Old-path and create-once safety

Audit these four files:

```text
apps/workbench/src/V04Lab.tsx
packages/dogfood/v04-heavy-negative-probe.mjs
packages/dogfood/v04-heavy-negative-probe-check.mjs
packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

For each file, inject each old path as a direct filesystem target. Require failure. For each file, construct each old path indirectly from separate root and name values, then use it as a filesystem target. Require failure.

Apply this matrix to both paths:

```text
/private/tmp/sidproj-95-heavy-negative-probe.json
/private/tmp/sidproj-99-heavy-negative-probe.json
```

Thus, the old-path corpus has at least 16 file/path/construction mutations: four files, two paths, and direct plus indirect construction. A clean-text check alone does not pass.

Run the checker against SIDPROJ-95, SIDPROJ-99, a random path, no path, and an extra path. Each must fail with `unsupported artifact path` before file access.

Keep the cases for an existing SIDPROJ-100 final regular file, symbolic link, and directory. Keep all 20 real-disk publication cases and the six added race-label cases. The SIDPROJ-95 artifact must stay byte-identical through all tests.

## Frozen contracts

Keep all these contracts active:

- `[7, 8)` stays exact. The product threshold stays 8 ms.
- Product truth and primitive truth stay independent.
- The fixture never reads `window.__CANVAS_SCAN__`, reports, findings, canvases, rows, pass flags, failure text, expected values, or checker output.
- The probe drains the prior report before measured recording starts.
- Each capture uses a new context and one accepted fixture run.
- Ten captures, zero drops, empty diagnostics, and current identities remain mandatory.
- Create-once hard-link publication and its identity, mode, cleanup, and race contracts stay unchanged.
- `validateProbeExit()` stays total and keeps label order: `schema`, `run count`, `runs`, `values`, `drops`, `diagnostics`, `coordinate`, `band`, `port`.
- `checkArtifact()` keeps label order: `schema`, `run identity`, `coordinate`, `runs`, `run:<iteration>`, `aggregates`, `diagnostics`, `identity`, `port`.
- Hashes, timestamps, PNG proof, idle proof, lifecycle proof, association proof, and port proof stay exact.
- SIDPROJ-95 evidence stays byte-identical.

## Verification funnel

## First build retry requirements

The first builder produced a partial six-file implementation and returned `STATUS: BLOCKED`. Treat the current tree as partial input, not accepted source. The retry must correct all items below before any judge starts:

1. Remove `// @ts-nocheck` from `V04Lab.tsx`. Define the complete closed `HeavyCalibration`, operation-step, sample-event, sample-result, timer, capability, and component-prop types. The normal workspace type check must prove them.
2. Replace the current 22-line, count-padded probe test file. Restore every inherited SIDPROJ-97 publication, race, cleanup, total-validator, source-audit, identity, diagnostic, and port test. Use `.codex/pbj-plan-sidproj-97.md`, `.codex/pbj-plan-sidproj-96.md`, the current production helpers, and this contract as the recovery truth.
3. Do not satisfy a test-count gate with loops that mutate many indexes in one array. Each required mutation axis must have a unique descriptive test name, a unique target, and an exact expected failure. Generated matrix tests are permitted only when the matrix iterates distinct declared fields, values, files, paths, or attack classes.
4. Keep all 20 real-disk publication cases, the six later race-label cases, post-publication replacement, invalid input, cleanup precedence, and totality cases. Tests must use fresh isolated test roots and never a real production artifact path.
5. Implement the finite bootstrap, capability, privacy, timer-boundary, shared-plan, Offscreen-absence, and old-path source proof in `v04-heavy-negative-probe-check.mjs`. The current `prohibitedFixtureTokens()` scan is not sufficient as the primary proof.
6. Add and run mutations that independently put each native function or capability into every forbidden sink from this contract. Add order mutations for each bootstrap step. Add workload mutations for every method, style, argument, dimension, order, receiver, background fill, and scaled rectangle.
7. Extract and execute the real source-defined `measureNativeCall` and `selectHeavySamples` helpers. Prove loop, setter, plan, and array work stays outside the timer. Prove cold and interleaved warm-up values stay outside every saved result and derived value.
8. Make `validCalibration()` reject each negative duration even when a coordinated positive duration keeps the sum unchanged. Apply the same direct domain check to both sample arrays and every mutable number.
9. Make `validateProbeExit()` check the complete calibration contract for each run. Existence of a `calibration` key is not sufficient.
10. Replace `HeavyCalibration = Record<string, unknown>` with the exact closed type. Use named constants in production checks and telemetry. Do not hide unsafe non-null assertions behind disabled checking.
11. Require the fixture production path to validate every raw duration, every derived number, both dimensions, exact array lengths, exact plan counts, nonnegative preflight and outer times, and all caps before it publishes `ready`.
12. Recheck that the pre-IIFE calibration receiver never enters Canvas Scan registration. Keep the capability module-local, render without JSX, and preserve the IIFE-before-React order.

The retry must run every focused and standard command again. More than 208 tests is necessary but not sufficient. The named corpus and inherited behavior must all exist and pass.

Run the gates in this order. Stop at the first product or contract failure.

### 1. Focused source checks

Run after each source batch:

```bash
node --test packages/dogfood/v04-heavy-negative-probe-check.test.mjs
pnpm --filter dogfood run lab:v0.4:test
git diff --check -- apps/workbench/public/v04-lab.html apps/workbench/src/v04-lab-main.tsx apps/workbench/src/V04Lab.tsx packages/dogfood/lab-v04-truth.mjs packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs packages/dogfood/v04-heavy-negative-probe.mjs packages/dogfood/v04-heavy-negative-probe-check.mjs packages/dogfood/v04-heavy-negative-probe-check.test.mjs
shasum -a 256 packages/dogfood/lab-v04-truth.mjs packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs /private/tmp/sidproj-95-heavy-negative-probe.json
```

Require more than 208 focused probe tests. Require 63 lab tests, all 60 attacks, and all 12 live contracts. Require every new mutation, all 20 disk cases, all race cases, totality, source order, privacy, timer, plan, and old-path proofs.

Require the three frozen source hashes and SIDPROJ-95 artifact hash to equal the planning hashes.

### 2. Standard source checks

```bash
pnpm --filter canvas-scan test
pnpm typecheck
pnpm --filter canvas-scan run build
pnpm --filter workbench exec vite build
git diff --check
git status --short --branch
git diff --name-only
git diff --stat 65decbced2257a3d15774423c9607e037b77e6fb -- apps/workbench/public/v04-lab.html apps/workbench/src/v04-lab-main.tsx apps/workbench/src/V04Lab.tsx packages/dogfood/lab-v04-truth.mjs packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs packages/dogfood/v04-heavy-negative-probe.mjs packages/dogfood/v04-heavy-negative-probe-check.mjs packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

Require at least 555 core tests. Require all type checks and both builds. Require every source change to stay in the nine-file allowlist. Check every unrelated dirty path against the initial tree and bytes.

Do not run these expensive commands in this section:

```text
node packages/dogfood/v04-heavy-negative-probe.mjs
pnpm --filter dogfood run lab:v0.4 -- --idle-release
pnpm --filter dogfood run lab:v0.4
```

### 3. Two independent source judges

Freeze the source after sections 1 and 2 pass. Start judge round 1 with two independent judges. Give each judge these raw inputs:

- this complete plan and the complete live SIDPROJ-100 text;
- `.codex/pbj-plan-sidproj-99.md`;
- both final SIDPROJ-99 `FAIL` reports and all six facts listed above;
- the complete nine-file baseline diff and current diff;
- `packages/core/src/wrap-context.ts:1166-1212`;
- the exact telemetry schema;
- the full mandatory counterexample and mutation corpus;
- all focused and standard check output;
- pre-change and post-change hashes;
- the current ledger.

Do not give either judge the other judge's report. Tell each judge to check every changed hunk and return all P1 and P2 findings in one terminal report.

Each judge must check bootstrap order, exact native identity, realm and receiver, plan equivalence, timer boundaries, warm-up selection, target risk, telemetry closure, privacy, old-path safety, create-once safety, and frozen contracts.

Both judges must return `PASS` before Chrome starts. Set `judge rounds: 1/2`. If either fails, collect both reports. Use the one correction round. Run sections 1 and 2 again. Start judge round 2. If either round-2 judge fails, stop.

### 4. Expensive evidence run 1: targeted ten-capture probe

Root owns this run. Before Chrome, use `lstat()` semantics to check:

```text
/private/tmp/sidproj-100-heavy-negative-probe.json
```

If any type exists, stop. Check the SIDPROJ-95 hash again. Then run exactly once:

```bash
node packages/dogfood/v04-heavy-negative-probe.mjs
```

Set `full evidence runs: 1/2`.

Then run these non-Chrome checks:

```bash
node packages/dogfood/v04-heavy-negative-probe-check.mjs /private/tmp/sidproj-100-heavy-negative-probe.json
node packages/dogfood/v04-heavy-negative-probe-check.mjs /private/tmp/sidproj-95-heavy-negative-probe.json
node packages/dogfood/v04-heavy-negative-probe-check.mjs /private/tmp/sidproj-99-heavy-negative-probe.json
/usr/sbin/lsof -nP -iTCP@127.0.0.1:5190 -sTCP:LISTEN
stat -f '%N|size=%z|mode=%Sp|dev=%d|ino=%i|type=%HT' /private/tmp/sidproj-100-heavy-negative-probe.json /private/tmp/sidproj-95-heavy-negative-probe.json
shasum -a 256 /private/tmp/sidproj-100-heavy-negative-probe.json /private/tmp/sidproj-95-heavy-negative-probe.json
```

The first checker must print `SIDPROJ_100_HEAVY_NEGATIVE_PROBE: PASS`. Both old-path checkers must fail only with `unsupported artifact path`.

Require exactly ten finite values in `[7, 8)`. Recompute minimum, maximum, and median from those values. Require one accepted run, zero drops, empty diagnostics, exact closed telemetry, current identities, a regular mode-`0600` file, and an empty port.

Require each run to show the exact same-realm enum values, complete sample arrays, exact plan counts, per-call array length and sum, bounded call count, zero measured outer overrun, and matching `1280` by `560` dimensions.

If a product, native model, writer, checker, or contract gate fails, stop. Do not start evidence run 2.

### 5. Expensive evidence run 2: complete release capture

Root owns this run. Run exactly once after run 1 and all its checks pass:

```bash
pnpm --filter dogfood run lab:v0.4 -- --idle-release
```

Set `full evidence runs: 2/2`.

Require all 20 idle rows, all 53 matrix rows, all mutation evidence, exact hashes, current identities, empty diagnostics, zero drops, and port cleanup. Do not start another Chrome run.

### 6. Disk, evidence, and release checks

Run without Chrome:

```bash
pnpm --filter dogfood run lab:v0.4:check
pnpm --filter dogfood run lab:v0.4 -- --check-idle-evidence
node packages/dogfood/v04-heavy-negative-probe-check.mjs /private/tmp/sidproj-100-heavy-negative-probe.json
/usr/sbin/lsof -nP -iTCP@127.0.0.1:5190 -sTCP:LISTEN
shasum -a 256 /private/tmp/sidproj-55-canvas-lab-v0.4.json /private/tmp/sidproj-55-console-summary.txt /private/tmp/sidproj-55-integrated-burst.png /private/tmp/sidproj-55-integrated-continuous.png /private/tmp/sidproj-55-mutation-output.txt /private/tmp/sidproj-55-nearest-negatives.json /private/tmp/sidproj-55-variant-matrix.json /private/tmp/sidproj-86-v04-idle-boundary.json /private/tmp/sidproj-90-v04-release-evidence.json /private/tmp/sidproj-95-heavy-negative-probe.json /private/tmp/sidproj-100-heavy-negative-probe.json
```

Recompute every hash from disk. Do not use saved hash text as proof. Run the complete 20-case publication matrix, race-label tests, total validator, privacy audit, 63 v0.4 tests, 60 attacks, 12 contracts, 555 or more core tests, type checks, both builds, frozen hashes, and diff checks.

### 7. Evidence continuations

Send the fresh evidence to the same two judge streams. This continues the open judge round.

Give each judge:

- the final frozen nine-file diff;
- the targeted artifact and checker output;
- both old-path rejection outputs;
- all ten values and recomputed aggregates;
- all ten calibration objects and per-call arrays;
- both artifact identity, mode, size, and hash facts;
- `/private/tmp/sidproj-90-v04-release-evidence.json`;
- all inherited v0.4 artifacts and recomputed hashes;
- Chrome, Git, bundle, harness, timestamp, drop, diagnostic, and port facts;
- the final ledger.

Do not share one continuation with the other judge. Both disk and evidence continuations must return `PASS`.

## Signed commit, push, and Linear closure

Start closure only after all gates and both evidence judges pass.

1. Check `git status --short --branch` and the complete diff.
2. Check the three frozen source hashes and SIDPROJ-95 artifact hash again.
3. Stage only the nine-file allowlist:

```bash
git add -- apps/workbench/public/v04-lab.html apps/workbench/src/v04-lab-main.tsx apps/workbench/src/V04Lab.tsx packages/dogfood/lab-v04-truth.mjs packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs packages/dogfood/v04-heavy-negative-probe.mjs packages/dogfood/v04-heavy-negative-probe-check.mjs packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

4. Run these staged checks:

```bash
git diff --cached --name-only
git diff --cached --check
git diff --cached
```

5. Require every staged path to be in the nine-file allowlist. Expect the three frozen files to be absent unless a proved change exists.
6. Create one signed commit:

```bash
git commit -S -m "Calibrate v0.4 with exact Canvas2D natives"
```

7. Push the current issue branch:

```bash
git push origin agent/sidproj-100-exact-html-native-calibration
```

8. Upload `/private/tmp/sidproj-100-heavy-negative-probe.json` to SIDPROJ-100.
9. Upload `/private/tmp/sidproj-90-v04-release-evidence.json` to SIDPROJ-100.
10. Add the source, test, evidence, values, aggregates, telemetry, hashes, Chrome revision, commit SHA, inode facts, port result, and final ledger to SIDPROJ-100.
11. Mark SIDPROJ-100 Done.
12. Add the same closure evidence to SIDPROJ-99. Mark SIDPROJ-99 Done.
13. Continue through the completed blocked chain only where live Linear relations prove the issue is complete.
14. Check live Linear state before another AFK issue starts.

For each upload, use Linear's prepared upload flow. Prepare the exact file, upload its raw bytes to the returned signed URL, then create the attachment from the returned asset URL. Do not upload secrets, unrelated files, or the SIDPROJ-95 artifact as new evidence.

Do not ask for routine Linear approval.

## Out of scope

- Do not change Canvas Scan core timing or `packages/core/src/wrap-context.ts`.
- Do not change the 8 ms product threshold.
- Do not widen `[7, 8)`.
- Do not use Offscreen Canvas as a timing proxy.
- Do not read product output from fixture code.
- Do not expose native function references outside the direct capability prop.
- Do not add a natural-language denylist as the evidence boundary.
- Do not redesign create-once publication, process ownership, drain, cleanup, or port proof.
- Do not weaken schemas, mutation tests, source proofs, hashes, diagnostics, drops, PNG proof, idle proof, lifecycle proof, or association proof.
- Do not change unrelated v0.5, release, package, pack, document, or workflow files.
- Do not change `packages/dogfood/package.json`.
- Do not run SIDPROJ-70.
- Do not stage `.codex/` or `AGENTS.md`.
- Do not tag, publish a package, open a pull request, or contact an external maintainer.
