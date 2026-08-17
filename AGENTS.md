# Canvas Scan Agent Workflow

These rules apply to AFK Linear implementation and release-evidence work in this repository.

## Use a Finite Evidence Contract

- Express acceptance with exact schemas, enums, repository truth, and named artifacts.
- Use exact allowlists for repository-owned machine labels. Scope each exception to a named file or structured field.
- Do not use a growing natural-language denylist as the primary evidence boundary.
- If a text scan is necessary, define its normalization, scope, accepted contexts, and mutation corpus before browser tests.
- Keep expected truth outside product output. Never use product-visible text, runtime globals, or copied actual results as truth.
- Reject extra fields, files, rows, and free text when the contract does not declare them.

## Preflight the Closure Path

Before implementation, check:

1. Live Linear state, AFK label, blockers, and issue scope.
2. The branch, worktree, baseline commit, and existing user changes.
3. Browser, port, signing, evidence, and upload requirements.
4. System gates that can block a raw evidence upload or another closure action.

Do not ask for routine Linear approval. Report any unavoidable system approval early and continue all safe work.

## Use the Verification Funnel

Run checks from cheapest to most expensive:

1. Focused unit and mutation tests.
2. Existing source checker suites.
3. Type, build, diff, and scope checks.
4. Initial independent judges on the source, contract, and complete adversarial corpus.
5. One full browser or external evidence run after the source freezes.
6. Independent disk checks and one final bounded judge round on the fresh evidence.

Do not run the full browser lab after each local checker change. Freeze the source first.

## Batch Review Findings

- Tell each judge to inspect the complete diff and return all P1 and P2 findings in one terminal report.
- Give each judge the raw plan, diff, evidence, and known counterexamples. Do not give it another judge's conclusions.
- Collect all judge findings before a correction starts.
- Correct one batch. Add every counterexample to focused and disk mutation tests before the next expensive run.
- If a second judge round fails, do not continue with local phrase-by-phrase or case-by-case patches.
- Reassess the evidence model. Use one coherent redesign, split follow-up work, or report the concrete blocker.

## Enforce Run Budgets

Record this ledger in the plan and status updates:

```text
correction rounds: 0/1
full evidence runs: 0/2
judge rounds: 0/2
```

- A correction round is one batch that addresses one complete judge report set.
- An evidence run is a browser, benchmark, or external acceptance run that takes material time.
- The second evidence run is for the single correction batch or one confirmed environment retry.
- Do not start a third evidence run automatically. First reassess the approach and report why the budget failed.
- Allow one automatic retry for a confirmed browser, port, network, or fixture timing failure.
- Treat a repeated environment failure as a harness defect. Do not repeat the complete suite unchanged.

## Use Time Circuit Breakers

- At 90 minutes, send a status update with elapsed time, completed gates, remaining gates, and the current run ledger.
- At two hours, stop the same patch loop. Diagnose the model, redesign the check, split the work, or report a blocker.
- Do not ask the user to approve routine continuation. Ask only for a material scope decision or a system-required gate.

## Close an AFK Issue

After all required checks, evidence upload, and judges pass:

1. Stage only the issue's files.
2. Create a clear signed commit.
3. Push the current issue branch.
4. Add the final evidence and check summary to Linear.
5. Mark the issue Done.
6. Check live Linear state and start only the next unblocked Todo issue with the AFK label.

Do not tag, publish, open a pull request, or include unrelated work unless the user asks.
