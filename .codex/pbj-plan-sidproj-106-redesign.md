# SIDPROJ-106 finite copy-comparison failure redesign

## Falsifiable goal

This redesign cycle is complete when the investigation run report gives the two
export stages distinct, finite, privacy-safe failure reasons; when one injected
focused test produces each declared reason from exactly its failure class; when
the mutation corpus rejects the retired catch-all reason, free-text reasons,
wrong-stage reasons, and mis-tagged typed failures; and when every focused
suite, syntax check, and diff check passes in this container without starting a
Chrome evidence run.

## Live issue state and authority

- Issue: `SIDPROJ-106`, `RDY-03 — Emit one complete investigation-run report`.
- Live state on 2026-08-19: `In Progress` with the `AFK` label.
- The latest Linear comment (2026-08-19 02:58 UTC) reports: both budgeted local
  Chrome runs completed through `pair-findings`, then recorded
  `copy-comparison: failed/export-failed` and `verify-run:
  failed/ritual-incomplete`; the final independent judge is BLOCKED.
- Judge P1: no complete Chrome evidence exists.
- Judge P2 model defect: `export-failed` combines click, clipboard, JSON
  parse, product-output, and checker failures. The finite evidence cannot
  classify the repeated result as a harness defect or a product defect.
- Required follow-up: give these failure classes distinct finite, privacy-safe
  reasons and focused injected tests before a new evidence cycle.
- The previous ledger is exhausted (correction rounds 1/1, full evidence runs
  2/2, judge rounds 2/2). The user directed this fresh redesign cycle and
  forbade a third Chrome run from the old ledger.

## Fresh redesign ledger

Start this redesign with this exact ledger:

```text
correction rounds: 0/1
full evidence runs: 0/2
judge rounds: 0/2
```

The two consumed Chrome runs stay recorded in Linear history for the previous
cycle. No Chrome run starts during this build phase. The fresh evidence budget
belongs to the next local macOS cycle, and it opens only after both independent
source judges pass on a frozen tree.

## Repository baseline

- Cloud branch: `claude/sidproj-106-copy-comparison-6zld7t`.
- `HEAD`: `f84d697ee471b7d43528ca0e5fe243f0fa17776c`, the signed tip of
  `agent/sidproj-106-run-report`. The worktree is clean.
- This container has no local macOS Chrome; `readiness-v05.mjs` requires
  `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, so the
  builder cannot start an evidence run even accidentally.
- Checkpoints from this container are SSH-signed with the container key and
  pushed only to the cloud branch above. The user merges them onto
  `agent/sidproj-106-run-report` locally with their own signature.

## Contract redesign

### Retired label

`export-failed` is removed from the declared stage reasons. The run-report
`schemaVersion` moves from `1` to `2` because the declared stage-reason
vocabulary changed. A report claiming schema 1, or any stage row using
`export-failed`, is rejected.

### Export stages and finite reasons

`EXPORT_STAGE_IDS = ['copy-explanation', 'copy-comparison']`. Both stages share
one declared `failed` reason list, `EXPORT_FAILURE_REASONS`:

| Reason | Exact producing condition |
| --- | --- |
| `copy-click-failed` | The copy control click step threw. |
| `copy-confirmation-timeout` | The copied-status confirmation step threw. |
| `clipboard-read-failed` | The clipboard read step threw. |
| `clipboard-json-invalid` | The clipboard JSON parse step threw. |
| `artifact-contract-violation` | The repository validator rejected the parsed artifact with a declared `ContractViolation`. |
| `export-harness-crashed` | Any other throw inside the export stage, including an undeclared validator crash or a typed failure tagged for the wrong stage. |

`artifact-contract-violation` is evidence about product output.
`export-harness-crashed` is evidence about the harness itself. The four
operational reasons isolate which export step broke. `export-unavailable`
remains the only declared `unavailable` reason for both stages.

### Mechanism

- `ContractViolation` (exported by `investigation-run-report.mjs`) marks every
  declared readiness-contract rejection. All validator-layer throws in
  `readiness-v05.mjs` (the shape/list/fixed helpers through
  `checkReadinessEvidence`) become `ContractViolation`. Runner and environment
  errors stay plain `Error`.
- `StageFailure` carries only `stageId` and `reason`. Its message is the finite
  string `SIDPROJ_106_STAGE_FAILURE: <stageId> <reason>`. It never copies text
  from the underlying cause, so no private value can reach a report through it.
- `runExportStage(stageId, steps)` is the only path through an export stage.
  `steps` must be exactly `{ click, confirm, read, parse, validate }`. Each
  step is wrapped: a throw in a step becomes the `StageFailure` for that step's
  reason, so classification is total by construction. A `validate` throw maps
  to `artifact-contract-violation` when it is a `ContractViolation` and to
  `export-harness-crashed` otherwise. On success it returns the validated
  artifact; summary fields are extracted only after validation.
- `classifyStageFailure(runStages, error)` replaces the inline pending-stage
  inference in the browser catch. It returns `null` unless exactly one
  first-nine stage is pending with every prior stage complete. A typed
  `StageFailure` naming that pending stage with a declared reason wins.
  Anything else falls back to `export-harness-crashed` for an export stage and
  to the stage's existing single declared catch-all otherwise
  (`STAGE_FALLBACK_REASONS`). A typed failure naming the wrong stage never
  transfers its reason.

### Unchanged boundaries

- The non-export stage reasons, the `verify-run` reason list, the comparison
  artifact's `incomparableReasons` enum, the unknown-reason scopes, the
  terminal-output contract, and the disk checker file rules do not change.
- No public core API, timing, or finding semantics change. `packages/core` is
  untouched.

## Test contract

Focused injected tests (investigation-run-report.test.mjs):

1. `runExportStage` success runs the five steps in order and returns the
   validated artifact.
2. A click throw produces exactly `copy-click-failed`.
3. A confirmation throw produces exactly `copy-confirmation-timeout`.
4. A clipboard-read throw produces exactly `clipboard-read-failed`.
5. A parse throw produces exactly `clipboard-json-invalid`.
6. A `ContractViolation` from validate produces `artifact-contract-violation`.
7. A non-contract validate crash produces `export-harness-crashed`.
8. A `StageFailure` message stays finite when the cause carries private text.
9. `classifyStageFailure` honors a typed reason for the pending export stage.
10. A typed reason for the wrong stage classifies as `export-harness-crashed`.
11. An untyped error on a pending export stage classifies as
    `export-harness-crashed`; a non-export pending stage keeps its declared
    fallback; a terminal prior stage classifies as `null`.
12. The reducer accepts every declared export reason on both export stages and
    rejects `export-failed` (existing reason-loop tests extend automatically).

Mutation rows (investigation-run-report-mutations.mjs), all rejected:

- A `copy-comparison` failed row uses the retired `export-failed` reason.
- A `copy-comparison` failed row smuggles private free text as its reason.
- A `copy-comparison` failed row uses another stage's declared reason.
- A report claims the retired schema version 1.
- `runExportStage` accepts an extra undeclared step.
- `runExportStage` accepts a missing step.

## Verification funnel for this cycle

1. `node --test packages/dogfood/investigation-run-report.test.mjs`
2. `node packages/dogfood/investigation-run-report-mutations.mjs`
3. `node --test packages/dogfood/readiness-v05.test.mjs` and
   `node packages/dogfood/readiness-v05-mutations.mjs`
4. `node --check` on every changed `.mjs`, workspace typecheck and builds if
   this container permits them, and `git diff --check`.
5. Two independent source judges on the frozen tree (next phase; before any
   Chrome).
6. Chrome evidence runs happen only on the local macOS host against the fresh
   ledger after the judges pass.

## Scope allowlist

The build changes only:

```text
.codex/pbj-plan-sidproj-106-redesign.md
packages/dogfood/investigation-run-report.mjs
packages/dogfood/investigation-run-report.test.mjs
packages/dogfood/investigation-run-report-mutations.mjs
packages/dogfood/readiness-v05.mjs
```

No tag, publish, pull request, Linear state change, or unrelated file is
allowed. Status comments on SIDPROJ-106 record the fresh ledger and completed
checks.
