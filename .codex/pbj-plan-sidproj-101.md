# SIDPROJ-101 implementation contract

## Falsifiable goal

SIDPROJ-101 is complete when one finite verifier uses the TypeScript compiler API and lexical symbols as its primary source proof. The verifier must reject every named SIDPROJ-101 counterexample and every unsupported protected carrier. More than 545 focused tests must pass without count padding. Two independent source judges must pass before Chrome starts. One targeted run must create exactly ten distinct finite values in `[7, 8)`. One complete `--idle-release` run must then pass. Both evidence judge continuations, all inherited gates, the signed commit, the branch push, and the Linear closure must pass.

## Live issue state

- Issue: `SIDPROJ-101`, `V05-09q — Replace regex proof with a binding-aware verifier`.
- URL: `https://linear.app/yde/issue/SIDPROJ-101/v05-09q-replace-regex-proof-with-a-binding-aware-verifier`.
- State during planning: `In Progress` with the `AFK` label.
- Parent: `SIDPROJ-62`.
- SIDPROJ-101 has no blocker.
- SIDPROJ-101 blocks SIDPROJ-100.
- It relates to SIDPROJ-99, SIDPROJ-95, and SIDPROJ-70.
- SIDPROJ-70 stays out of scope.
- The issue has no attachments or releases during planning.

SIDPROJ-100 used its one correction round and both source-judge rounds. Both final judges failed before Chrome. The one remaining problem is the regex-only evidence model. Do not add another phrase or isolated text pattern to that model.

## Baseline and inherited dirty tree

- Branch: `agent/sidproj-101-binding-aware-verifier`.
- Current `HEAD` and implementation baseline: `65decbced2257a3d15774423c9607e037b77e6fb`.
- Merge base with `origin/main`: `20e53799202a0193f6c48c9b438ec9452b80dfaf`.
- Git uses SSH signing. `commit.gpgsign=true` and `gpg.format=ssh`.
- Port `5190` had no listener during planning.
- `/private/tmp/sidproj-99-heavy-negative-probe.json` was absent.
- `/private/tmp/sidproj-100-heavy-negative-probe.json` was absent.
- The focused probe suite passed 545 tests.
- The v0.4 lab suite passed 63 tests, all 60 attacks, and all 12 live contracts.
- `git diff --check` passed.
- TypeScript `5.9.3` resolved from `apps/workbench/package.json` through its declared dependency.

The exact initial `git status --short --branch` output is:

```text
## agent/sidproj-101-binding-aware-verifier
 M apps/workbench/public/v04-lab.html
 M apps/workbench/src/V04Lab.tsx
 M apps/workbench/src/v04-lab-main.tsx
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

All dirty files are inherited SIDPROJ-100 or unrelated v0.5, release, package, pack, document, and agent work. Preserve them. Do not reset, clean, stash, restore, remove, or format unrelated paths.

## Artifact preservation

`/private/tmp/sidproj-95-heavy-negative-probe.json` is a regular mode-`0600` file. Its planning facts are:

```text
size=8289
device=16777234
inode=904777482
sha256=4d8b2292910fba995d837b392e439274b0fdf412200941f337e25ad134827d65
```

Treat it as read-only evidence. Do not remove, rename, replace, chmod, reuse, or upload it as new evidence. Apply the same no-target rule to `/private/tmp/sidproj-99-heavy-negative-probe.json`.

The only new production evidence path is:

```text
/private/tmp/sidproj-100-heavy-negative-probe.json
```

Use `lstat()` semantics before the targeted run. Stop if any file type exists at that path. Do not remove or replace it.

## Exact closure scope and planning hashes

The final commit allowlist contains exactly these nine files:

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

Their SIDPROJ-101 planning hashes are:

```text
2db19bed3ced4686be7120b3d7d77501bc5751c06d415fc618166cff4cc63799  apps/workbench/public/v04-lab.html
b9c9130c9bb3ba8e5281fe0cd34bb05038f049cc6861361803bd983b73a1c256  apps/workbench/src/v04-lab-main.tsx
9abedde3ef8c1feac6aa3398a92f529d2d99119d9b0bd3072f234de1008c9d98  apps/workbench/src/V04Lab.tsx
ca1a7a66360a77e2fce4bfe42030bb1eaf5dea16ae7b1049abb59d9b804effe9  packages/dogfood/lab-v04-truth.mjs
91970eb07365ca7abe3bab79b78ab35984ba997ebead5a6d72ce3d89549f80be  packages/dogfood/lab-v04.mjs
95888d4d6cbe7d0177f3db8f476100bbdf596e9a1c20f400a0c445fb63f9d687  packages/dogfood/lab-v04.test.mjs
8cd1a36abb6ce9b3fd67582be444cb5c34b6a72dab57af34864e046ff0b2997b  packages/dogfood/v04-heavy-negative-probe.mjs
3a0328f36c68c3624672c0d15968a386b315f3501ac7005618ce21f663910ae2  packages/dogfood/v04-heavy-negative-probe-check.mjs
ac279e0292abea8fcdafd185790c637282b7c8966e099a585781074155fa92e3  packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

The expected SIDPROJ-101 source changes are the checker and its test. Keep the other seven files byte-identical unless a focused or standard gate proves that the inherited implementation needs a change. The three v0.4 lab files must keep their listed frozen hashes. Do not change `packages/dogfood/package.json`. Do not stage this plan.

## Run ledger and stop rules

Start with this exact ledger:

```text
correction rounds: 0/1
full evidence runs: 0/2
judge rounds: 0/2
```

A judge round has two independent judges on one unchanged source tree. If round 1 passes, the final evidence review uses round 2. If round 1 fails, collect both reports before one correction batch. The repeated source review consumes round 2. The evidence review then continues those two open judge streams without a third round.

Collect every P1 and P2 finding from both judges before the one correction batch starts. Add each accepted counterexample to focused and disk mutation tests. If source judge round 2 fails, stop. If either final evidence continuation fails, stop.

Evidence run 1 is the targeted ten-capture probe. Evidence run 2 is the complete `--idle-release` capture. Chrome and complete release commands are expensive. Do not start Chrome until both source judges pass. Do not start a third evidence run.

Allow one retry only after a confirmed browser, port, network, or fixture timing environment failure changes. Do not retry a product, verifier, native model, writer, checker, schema, or contract failure.

At 90 minutes, report elapsed time, passed gates, remaining gates, and the ledger. At two hours, stop the same patch loop. Reassess the verifier model or report the concrete blocker.

## Required implementation

### `packages/dogfood/v04-heavy-negative-probe-check.mjs`

Replace the regex and occurrence-count source proof with one finite compiler-API verifier. Keep `validCalibration()`, `checkArtifact()`, identity checks, port checks, the artifact checker CLI, and all inherited runtime contracts active.

Load TypeScript from the declared workbench dependency. Add `createRequire` from `node:module`. Create the require function from the absolute `apps/workbench/package.json` path. Load `typescript` through that require function. Do not add or change a package dependency.

Keep one public verifier entry point. `sourceProof(sources)` can keep its current name and failure-array API. It must call the new parsed verifier. `oldPathTargetFailures()` can remain as a compatibility wrapper, but it must call the same parsed model. No regular expression can act as the primary protected-value or old-path proof.

Use these exact source keys and repository files:

```text
html         apps/workbench/public/v04-lab.html
main         apps/workbench/src/v04-lab-main.tsx
fixture      apps/workbench/src/V04Lab.tsx
probe        packages/dogfood/v04-heavy-negative-probe.mjs
checker      packages/dogfood/v04-heavy-negative-probe-check.mjs
checkerTest  packages/dogfood/v04-heavy-negative-probe-check.test.mjs
```

Reject a missing key, an extra key, or a non-string value. Parse the five script files with one in-memory `ts.Program`. Use `allowJs: true`, `checkJs: false`, `jsx: ts.JsxEmit.Preserve`, `target: ts.ScriptTarget.ESNext`, `module: ts.ModuleKind.ESNext`, `noLib: true`, and `noResolve: true`. Select `TSX` for both TSX files and `JS` for each MJS file. Reject every syntax diagnostic in these virtual files. Use `program.getTypeChecker()` and `checker.getSymbolAtLocation()` for all local identity. Do not use identifier text as lexical identity.

The HTML check can use an exact leaf check because TypeScript does not parse HTML. Reject any static script whose `src` leaf equals `/canvas-scan.iife.js`. Keep the existing option assignment before the module entry.

### Finite protected-value model

Use these exact protected tags:

```text
prototype
canvas
context
putImageData
fillRect
clearRect
capability
```

Create tags only from these exact AST origins in `v04-lab-main.tsx`:

1. One immutable module-local `prototype` binding from `CanvasRenderingContext2D.prototype`.
2. One immutable binding for each exact method property on that prototype symbol.
3. One immutable `canvas` binding from `document.createElement('canvas')`.
4. One immutable `context` binding from the one `canvas.getContext('2d')` call.
5. One immutable `nativeCanvas2D` binding from `Object.freeze({ canvas, context, putImageData, fillRect, clearRect })`.
6. The `nativeCanvas2D` parameter symbol in the exported `V04Lab` function. Bind it to the capability tag only because the bootstrap has the exact direct prop handoff.
7. The `value` parameter and the local `capability` binding in `validNativeCanvas2D`. Bind them only through the one allowlisted validation call.

Reject a second origin, an origin in another file, a mutable origin, a reassigned origin, an extra capability field, or a different origin expression.

Represent a propagated value as a finite record with a tag set, named object properties, and array elements. Support only these carriers:

- immutable local `const` identifier aliases;
- parenthesized, `as`, type-assertion, non-null, and `satisfies` wrappers;
- object literals with static identifier or string keys;
- object destructuring with static keys and no rest element;
- array literals and fixed-index array destructuring with no spread or rest element;
- static property access on a known object carrier;
- template expressions, binary expressions, calls, assignments, returns, and exports for descendant-tag detection only.

Use a maximum of 64 propagation rounds. Use a maximum carrier nesting depth of 8. Stop with `unsupported protected carrier` if the model does not reach a fixpoint, if a protected carrier exceeds either bound, or if syntax can carry a protected value but the model cannot resolve its shape.

Track aliases by TypeScript `Symbol` identity. Do not merge shadowed identifiers. Do not treat equal identifier text in another scope as the same value. Track object properties and array indexes only on finite local carriers. Do not build a heap model or an unbounded taint engine.

Mutable `let` or `var` aliases, reassignment, compound assignment, update expressions, computed unknown keys, spread, rest, optional calls, dynamic property names, class fields, closures that return protected data, and unresolved carrier calls are unsupported. If they contain a protected descendant, fail closed.

Run propagation before the use-policy check. Thus, `const first = nativeCanvas2D; const second = first` must give both symbols the capability tag before any export or sink check. A local alias declaration is a carrier for analysis, not a new allowed production use. Reject every protected alias that is not part of the exact production allowlist.

### Exact protected uses

Allow a protected tag only at the AST nodes below. Reject all other uses with `protected use`.

In `v04-lab-main.tsx`, allow:

- the prototype receiver for the three exact method captures;
- the exact canvas width and height writes, with values `1280` and `560`;
- the one pre-IIFE `canvas.getContext('2d')` receiver;
- the exact receiver, dimension, identity, and method checks in the two capability guards;
- the five exact shorthand properties in `Object.freeze`;
- the exact `Object.values(nativeCanvas2D).slice(2).every(...)` guard;
- the one direct `{ nativeCanvas2D }` prop inside `createElement(V04Lab, { nativeCanvas2D })`.

In `V04Lab.tsx`, allow:

- the one component parameter and its exact closed type;
- the one call `validNativeCanvas2D(nativeCanvas2D)` before fixture `ready`;
- the exact field reads inside `validNativeCanvas2D`;
- `nativeCanvas2D.context[step.property]` in the native style replay;
- `nativeCanvas2D[step.method]`, `nativeCanvas2D.context`, and `step.args` in the exact `measureNativeCall` call;
- `nativeCanvas2D.putImageData` and `nativeCanvas2D.context` in the exact primitive warm-up and saved sample calls;
- the exact React effect dependency array `[controls, factors, nativeCanvas2D]`.

No protected value is allowed in the HTML, probe, checker, or checker test. Text that has the same identifier spelling is not protected unless its lexical symbol derives from an origin.

Reject every protected value in these finite sink classes:

- assignments to `window`, `globalThis`, `document`, or a property chain from those globals;
- DOM calls `append`, `appendChild`, `prepend`, `before`, `after`, `replaceWith`, `replaceChildren`, `insertBefore`, `setAttribute`, and `setAttributeNS`;
- React `useState` from the lexical `react` import and calls to a setter that its destructuring result creates;
- `JSON.stringify`, `structuredClone`, `String`, hash `update`, console `log`, `error`, `warn`, `info`, or `debug`;
- diagnostic array `push`, Playwright `screenshot`, and `new Error` arguments;
- all returns, exports, export assignments, dynamic imports, and module handoffs;
- all calls with a protected argument unless the call node is in the exact allowlist above;
- all assignments with a protected right side unless the assignment node is in the exact allowlist above.

The sink check must inspect nested object, array, template, call, and binary-expression descendants. It must catch a protected method that hides under a local name or object property.

### Exact bootstrap and loader contract

Use AST position and symbol identity. Check this exact order in `v04-lab-main.tsx`:

1. Capture `CanvasRenderingContext2D.prototype`.
2. Capture `putImageData`.
3. Capture `fillRect`.
4. Capture `clearRect`.
5. Create the detached canvas once.
6. Set width to `1280`.
7. Set height to `560`.
8. Call `getContext('2d')` once.
9. Run the receiver and dimension guard.
10. Construct the frozen five-field capability once.
11. Run the exact method guard.
12. Declare `loadCanvasScan`.
13. In `main`, await `loadCanvasScan()`.
14. After that await, dynamically import `react`, `react-dom/client`, and `./V04Lab` exactly once each.
15. Render the one direct capability prop.

Model `loadCanvasScan` as one exact function with no parameter. Its body must await one `new Promise<void>` expression. The promise executor must have only the lexical `resolve` and `reject` parameters. Its body must:

1. Create exactly one script element with `document.createElement('script')`.
2. Set `script.src` exactly once to the string literal `/canvas-scan.iife.js`.
3. Assign `script.onload` exactly once to a zero-parameter callback whose only action calls its lexical `resolve()`.
4. Assign `script.onerror` exactly once to a zero-parameter callback whose only action calls its lexical `reject(new Error('canvas scan load failed'))`.
5. Call `document.head.append(script)` exactly once after both handler assignments.

Reject every other use of the lexical `resolve`, `reject`, or script symbols. Reject `resolve()` before `onload`. Reject a timer, event listener, different event, promise chain, or direct call that resolves the loader. Reject static runtime imports from `react`, `react-dom/client`, or `./V04Lab`. Reject JSX and a JSX-runtime import in the bootstrap.

The detached canvas must remain module-local. Reject a second `getContext` call on it or any alias. Reject append, export, state, return, module handoff, or registration of it. Canvas Scan must never observe its context creation.

### Exact AST contracts for inherited source

Convert the current `validNativeCanvas2D`, `measureNativeCall`, `selectHeavySamples`, `heavyPlan`, native replay, and wrapped replay checks from normalized source strings to AST predicates. Keep their exact current semantics from `.codex/pbj-plan-sidproj-100.md`:

- The capability keys are exactly `canvas`, `context`, `putImageData`, `fillRect`, and `clearRect`.
- The timer interval contains only `Reflect.apply(method, receiver, args)` between the two `now()` calls.
- Sample selection accepts only phase `saved` and kinds `primitive` or `fixed-plan`.
- The one shared plan starts with selected full-size `putImageData` calls.
- It then has exactly 200 inherited `fillRect` calls.
- It ends with the exact four native calls and four style steps.
- It includes the full `1280` by `560` background fill.
- It uses cyan geometry `(72, 96, 328, 176)`.
- It uses purple geometry `(528, 96, 224, 176)`.
- Native replay uses `Reflect.apply` on the captured method and detached context.
- Wrapped replay uses the same plan on the primary wrapped context.
- The call-count gate occurs before the final plan construction.
- No `OffscreenCanvas`, wrapped `createImageData`, or product-output feedback enters the fixture.

Keep `prohibitedFixtureTokens()` as a secondary product-truth independence check. Do not extend it to prove protected-value flow. Regex can check an exact HTML leaf or normalize a fixed literal only. It cannot prove binding, alias, order, control flow, or a filesystem target.

### Finite old-path constant model

Use these exact protected old-path identities:

```text
/private/tmp/sidproj-95-heavy-negative-probe.json
/private/tmp/sidproj-99-heavy-negative-probe.json
```

Evaluate constants by lexical symbol. Support only:

- string literals and no-substitution template literals;
- immutable local identifier aliases;
- template literals whose substitutions all resolve to strings;
- binary `+` when both sides resolve to strings;
- `path.join(...)` when `path` is the lexical default or namespace import from `node:path` and all arguments resolve;
- parentheses, `as`, type assertions, non-null, and `satisfies` wrappers.

Use at most 64 fixpoint rounds, expression depth 16, and result length 4096. Track provenance for each exact old basename and full path. Propagate that provenance even when an unsupported parent expression prevents a final string result.

Reject a sink target when it resolves to an old path. Also reject it when it has old-path provenance, even if it resolves only to a basename. If an unsupported expression makes the target unresolved but any descendant has old-path provenance, fail closed with `old path target`.

Resolve sink functions by lexical imports from `node:fs` and `node:fs/promises`. Also recognize the exact finite `fs`, `fs.promises`, and injected `fsApi` member calls in the audited files. Do not infer a sink only from an unrelated local identifier with the same text.

Use this exact sink and target-index table:

```text
lstat lstatSync stat statSync readFile readFileSync writeFile writeFileSync appendFile appendFileSync open openSync mkdir mkdirSync mkdtemp mkdtempSync unlink unlinkSync rm rmSync rmdir rmdirSync: argument 0
link linkSync rename renameSync copyFile copyFileSync cp cpSync symlink symlinkSync: arguments 0 and 1
```

The audit must cover `V04Lab.tsx`, the probe, the checker, and the checker test. Literal declarations in mutation data are not failures by themselves. Only a declared filesystem target triggers the old-path policy. The exact SIDPROJ-100 artifact path remains the only production evidence target.

### `packages/dogfood/v04-heavy-negative-probe-check.test.mjs`

Update `sourceSet()` to include `checkerTest`. Make all verifier mutations parse as their declared file kind. Assert exact failure arrays and stable labels. Do not assert only that a nonempty array exists.

Keep all existing telemetry, product band, total validator, identity, diagnostic, port, cleanup, process ownership, writer, 20 disk, and race tests. Keep source extraction tests for the real `measureNativeCall` and `selectHeavySamples` functions.

Add a passing shadowing test. A local unprotected `putImageData` in another lexical scope must not inherit the protected method tag. Add a passing unrelated-sink-name test. A local function named `readFile` that does not derive from a declared filesystem import must not count as a filesystem sink.

Add each named SIDPROJ-101 counterexample as one independent test with the exact expected label:

1. `window.nativeLeak = putImageData` -> `protected use`.
2. `document.body.nativeLeak = clearRect` -> `protected use`.
3. `JSON.stringify(fillRect)` -> `protected use`.
4. `const alias = putImageData; window.nativeLeak = alias` -> `protected use`.
5. `const first = nativeCanvas2D; const second = first; export { second }` -> `protected use`.
6. `const hiddenCanvas = canvas; hiddenCanvas.getContext('2d')` -> `protected use`.
7. `const hiddenCanvas = canvas; document.body.append(hiddenCanvas)` -> `protected use`.
8. Return `nativeCanvas2D` from a helper -> `protected use`.
9. Import `useState` from `react` and store `nativeCanvas2D` in React state -> `protected use`.
10. Change `script.src` to `/not-canvas.js` -> `loader contract`.
11. Call the lexical `resolve()` before `script.onload` -> `loader contract`.
12. Resolve from `setTimeout` -> `loader contract`.
13. Resolve from a different event handler -> `loader contract`.
14. Import React before the awaited loader -> `bootstrap order`.
15. Assign the SIDPROJ-95 full path to `oldPath`, then call the imported `readFile(oldPath)` -> `old path target`.
16. Put two immutable aliases between that SIDPROJ-95 literal and `readFile` -> `old path target`.
17. Assign root plus SIDPROJ-95 name to `target`, then call `writeFile(target, data)` -> `old path target`.
18. Assign a SIDPROJ-95 template literal to `target`, then call `lstat(target)` -> `old path target`.
19. Assign `path.join` for SIDPROJ-95 to `target`, then call `unlink(target)` -> `old path target`.
20. Repeat cases 15 through 19 for SIDPROJ-99 -> `old path target`.
21. Carry an old-path alias through an unsupported conditional or optional-call expression to `readFile` -> `old path target`.

Add protected-carrier tests for object properties, object destructuring, arrays, array destructuring, templates, binary expressions, call arguments, assignments, returns, and exports. Each test must use a protected lexical origin and must expect `protected use` or `unsupported protected carrier` exactly.

Add one long alias-chain test that reaches the fixpoint within 64 rounds. Add one 65-step protected chain that fails with `unsupported protected carrier`. Add tests for mutable aliases, reassignment, spread, rest, a computed unknown key, and an unresolved protected call. Each must fail closed.

Add an exhaustive old-path sink matrix. For both old paths, use a direct full-path literal at every target argument in the exact sink table. Give each generated test a unique name that includes the path, sink, and argument index. Also add both-path expression tests for one alias, two aliases, concatenation, template interpolation, `path.join`, and an intermediate target binding. Generated matrix tests are permitted because each row names a distinct declared sink, path, form, or target index.

Add loader tests for a missing handler, extra script element, extra append, wrong append receiver, handler order, aliased resolve, promise-chain resolve, timer resolve, event-listener resolve, and each early dynamic import. Add tests that reject a second canvas origin, context origin, method origin, capability origin, or direct prop handoff.

The final focused count must exceed 545. Do not pad the count. Every new test must mutate one declared verifier rule and assert its exact result.

## Inherited SIDPROJ-100 contracts

Keep all these contracts active:

- The fixture captures exact same-realm `putImageData`, `fillRect`, and `clearRect` before Canvas Scan loads.
- It creates the detached `1280` by `560` HTML canvas and context before the IIFE.
- The detached canvas never enters the DOM, Canvas Scan registration, React state, telemetry, diagnostics, screenshots, or artifacts.
- The capability stays module-local and reaches `V04Lab` through one direct prop.
- The fixture validates the exact closed capability before `ready`.
- The plan has `callCount + 204` native calls and four style steps.
- Other negative scenarios keep their inherited 200-call behavior.
- One same-realm `ImageData(1280, 560)` object enters both native and wrapped plan replay.
- The call-count cap is checked before final plan construction.
- The exact warm-up, sample, median, budget, timing, preflight, and telemetry contracts stay active.
- `[7, 8)` stays exact. The product threshold stays 8 ms.
- Product truth and primitive truth stay independent.
- The fixture never reads Canvas Scan product output.
- Ten captures, one accepted fixture run each, zero drops, empty diagnostics, and current identities remain mandatory.
- Create-once hard-link publication, inode identity, mode, cleanup, process ownership, drain, race, and port contracts stay active.
- `validateProbeExit()` and `checkArtifact()` stay total and keep their label order.
- Hashes, timestamps, PNG proof, idle proof, lifecycle proof, and association proof stay exact.
- SIDPROJ-95 evidence stays byte-identical.

## Verification funnel

Run the gates in this order. Stop at the first product or contract failure.

### 1. Focused checks

Classification: focused.

```bash
node --test packages/dogfood/v04-heavy-negative-probe-check.test.mjs
pnpm --filter dogfood run lab:v0.4:test
git diff --check -- apps/workbench/public/v04-lab.html apps/workbench/src/v04-lab-main.tsx apps/workbench/src/V04Lab.tsx packages/dogfood/lab-v04-truth.mjs packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs packages/dogfood/v04-heavy-negative-probe.mjs packages/dogfood/v04-heavy-negative-probe-check.mjs packages/dogfood/v04-heavy-negative-probe-check.test.mjs
shasum -a 256 packages/dogfood/lab-v04-truth.mjs packages/dogfood/lab-v04.mjs packages/dogfood/lab-v04.test.mjs /private/tmp/sidproj-95-heavy-negative-probe.json
```

Require more than 545 focused probe tests. Require every named counterexample, all protected-carrier cases, the full filesystem sink matrix, all 20 disk cases, every race case, and all inherited tests. Require 63 lab tests, all 60 attacks, and all 12 live contracts.

Require the three frozen source hashes and SIDPROJ-95 hash to equal the planning hashes.

### 2. Standard checks

Classification: standard.

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

Require at least 555 core tests. Require all type checks and both builds. Require every closure change to stay in the nine-file allowlist. Compare every unrelated dirty path with the initial tree and bytes.

Do not run these expensive commands in this section:

```text
node packages/dogfood/v04-heavy-negative-probe.mjs
pnpm --filter dogfood run lab:v0.4 -- --idle-release
pnpm --filter dogfood run lab:v0.4
```

### 3. Two independent source judges

Classification: judge gate. Freeze the source after sections 1 and 2 pass.

Start two fresh independent judges on the same unchanged tree. Give each judge:

- this complete plan and the complete live SIDPROJ-101 text;
- `.codex/pbj-plan-sidproj-100.md`;
- the complete nine-file baseline and current diff;
- the exact parsed source file set, protected origins, allowed AST uses, sink table, and constant forms;
- every named SIDPROJ-101 counterexample;
- the complete focused and standard output;
- pre-change and post-change hashes;
- the current run ledger.

Do not give either judge the other report. Tell each judge to inspect every changed hunk and return all P1 and P2 findings in one terminal report.

Each judge must try to refute lexical binding, shadowing, alias convergence, carrier bounds, fail-closed behavior, loader semantics, protected sinks, old-path constant evaluation, sink argument indexes, native calibration, privacy, create-once safety, and frozen contracts.

Both judges must return `PASS` before Chrome starts. Set `judge rounds: 1/2`. If either fails, collect both reports. Use the one correction round. Run sections 1 and 2 again. Start judge round 2. If either round-2 judge fails, stop.

### 4. Expensive evidence run 1

Classification: expensive. Root owns this run.

Before Chrome, use `lstat()` semantics to check `/private/tmp/sidproj-100-heavy-negative-probe.json`. Stop if any type exists. Check the SIDPROJ-95 hash again. Then run exactly once:

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

Require exactly ten distinct finite values in `[7, 8)`. Recompute minimum, maximum, and median. Require one accepted run per capture, zero drops, empty diagnostics, exact closed telemetry, current identities, a regular mode-`0600` file, and an empty port.

Stop on a product, verifier, native model, writer, checker, or contract failure. Do not start evidence run 2.

### 5. Expensive evidence run 2

Classification: expensive. Root owns this run.

Run exactly once after run 1 and all its checks pass:

```bash
pnpm --filter dogfood run lab:v0.4 -- --idle-release
```

Set `full evidence runs: 2/2`.

Require all 20 idle rows, all 53 matrix rows, all mutation evidence, exact hashes, current identities, empty diagnostics, zero drops, and port cleanup. Do not start another Chrome run.

### 6. Disk and release checks

Classification: standard after evidence.

```bash
pnpm --filter dogfood run lab:v0.4:check
pnpm --filter dogfood run lab:v0.4 -- --check-idle-evidence
node packages/dogfood/v04-heavy-negative-probe-check.mjs /private/tmp/sidproj-100-heavy-negative-probe.json
/usr/sbin/lsof -nP -iTCP@127.0.0.1:5190 -sTCP:LISTEN
shasum -a 256 /private/tmp/sidproj-55-canvas-lab-v0.4.json /private/tmp/sidproj-55-console-summary.txt /private/tmp/sidproj-55-integrated-burst.png /private/tmp/sidproj-55-integrated-continuous.png /private/tmp/sidproj-55-mutation-output.txt /private/tmp/sidproj-55-nearest-negatives.json /private/tmp/sidproj-55-variant-matrix.json /private/tmp/sidproj-86-v04-idle-boundary.json /private/tmp/sidproj-90-v04-release-evidence.json /private/tmp/sidproj-95-heavy-negative-probe.json /private/tmp/sidproj-100-heavy-negative-probe.json
```

Recompute each hash from disk. Rerun the focused suite, 63 v0.4 tests, 60 attacks, 12 contracts, 555 or more core tests, type checks, both builds, frozen hashes, and diff checks.

### 7. Evidence judges

Send the fresh evidence to the same two independent judge streams. If source round 1 passed, this review consumes judge round 2. If a correction consumed round 2, treat this as the evidence continuation of those open judge streams.

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

Do not share one judge result with the other judge. Both judges must return `PASS`.

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

5. Require every staged path to be in the nine-file allowlist.
6. Create one signed commit:

```bash
git commit -S -m "Add a binding-aware Canvas verifier"
```

7. Push the current issue branch:

```bash
git push origin agent/sidproj-101-binding-aware-verifier
```

8. Upload `/private/tmp/sidproj-100-heavy-negative-probe.json` to SIDPROJ-101 and SIDPROJ-100.
9. Upload `/private/tmp/sidproj-90-v04-release-evidence.json` to SIDPROJ-101 and SIDPROJ-100.
10. Add the source, test, counterexample, evidence, aggregate, telemetry, hash, Chrome, commit, inode, port, and ledger summary to SIDPROJ-101.
11. Mark SIDPROJ-101 Done.
12. Add the same closure evidence to SIDPROJ-100 and mark it Done.
13. Add the same closure evidence to SIDPROJ-99 and mark it Done.
14. Continue through the completed blocked chain only where live Linear relations prove completion.
15. Check live Linear state before another AFK issue starts.

Use Linear's prepared upload flow for each file. Upload raw bytes to the returned signed URL. Then create the attachment from the returned asset URL. Do not upload secrets, unrelated files, or SIDPROJ-95 as new evidence.

Do not ask for routine Linear approval.

## Constraints

- Follow `AGENTS.md` and its finite evidence, verification funnel, batch review, budget, circuit breaker, and closure rules.
- Match the current flat-function MJS style. Do not add a class or a new directory.
- Use the workspace TypeScript compiler API. Do not add a parser or dependency.
- Use lexical `Symbol` identity. Do not infer protected identity from identifier spelling.
- Keep all lists, bounds, allowed AST uses, sinks, and constant forms finite.
- Fail closed on unsupported syntax that carries protected data.
- Keep expected truth outside product output.
- Reject extra files, origins, protected aliases, uses, sinks, and source keys.
- Preserve every pre-existing dirty path and every unrelated byte.
- Do not stage `.codex/` or `AGENTS.md`.

## Out of scope

- Do not build an unbounded taint engine or heap model.
- Do not add another natural-language denylist or regex phrase loop.
- Do not change Canvas Scan core timing or `packages/core/src/wrap-context.ts`.
- Do not change the 8 ms threshold or widen `[7, 8)`.
- Do not use Offscreen Canvas as a timing proxy.
- Do not read Canvas Scan output from fixture code.
- Do not expose native references outside the direct capability prop.
- Do not redesign publication, process ownership, drain, cleanup, or port proof.
- Do not weaken schemas, mutation tests, hashes, diagnostics, drops, PNG proof, idle proof, lifecycle proof, or association proof.
- Do not change unrelated v0.5, release, package, pack, document, or workflow files.
- Do not change `packages/dogfood/package.json`.
- Do not run SIDPROJ-70 release work.
- Do not tag, publish a package, open a pull request, or contact an external maintainer.
