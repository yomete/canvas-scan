# canvas-scan product contract

Status: Approved for v0.4 on 2026-08-04.

This file defines the durable product direction for canvas-scan. The README
describes the current release. A release contract defines the next release.
`HANDOFF.md` and `CODEX_REVIEW.md` preserve history and evidence, but they do
not override this contract.

## North star

canvas-scan helps developers debug performance issues in canvas apps.

A successful investigation lets a developer add one early script, record a
slow interaction, and answer these questions:

- Which canvas performed work?
- Which interaction or draw episode contained the work?
- Which Canvas2D calls dominated the observed work?
- Which evidence is measured, associated, or only a candidate?
- Where should the developer check next?

The product succeeds when it reduces the time from “this canvas app feels
slow” to a correct next check.

`docs/north-star-benchmark.md` measures that sentence, and it is the only thing
that may claim the product outcome. A green build, a passing test suite, a
shipped feature, a low overhead figure, and a corpus result are all gates on the
way there. None of them is the outcome, and the scorer refuses each of them as a
claim source.

## Core ritual

1. Add the early canvas-scan script or import.
2. Start an investigation recording.
3. Reproduce the slow interaction.
4. Stop the recording.
5. Review ranked findings and their evidence.
6. Make a change.
7. Record the interaction again and compare the evidence.

Scan finds canvas activity continuously. Investigate records a bounded user
scenario and explains its Canvas2D work. Compare checks evidence from two
recordings. v0.4 establishes Investigate. v0.5 adds the full Compare workflow.

## Product boundary

The primary product is a browser-level Canvas2D investigation tool. React
owner attribution is a useful adapter, not the product boundary. A non-React
application must still receive useful Canvas2D evidence.

The default installation remains one early script or import. Optional labels,
interaction marks, and worker instrumentation can add precision. They must not
be necessary for the basic investigation.

The first supported boundary is observable main-thread Canvas2D work in the
current browser realm. The product must state when work crosses that boundary.
It must not report unobserved work as zero work.

## Evidence model

Every finding uses one of these evidence levels.

### Measured

canvas-scan directly observed the value within its boundary. Examples include:

- Canvas2D method calls and counts.
- Synchronous time inside wrapped Canvas2D methods.
- Canvas backing dimensions and observed CSS dimensions.
- Canvas resets and first-observed lifecycle events.
- Command status: `same`, `changed`, or `unknown`.
- The reason for an `unknown` command status.

### Associated

Two observed events overlap in time, but canvas-scan cannot prove causality.
Examples include:

- A draw episode near a user interaction.
- A draw episode that overlaps a long animation frame.
- Canvas work near a React commit.

### Candidate

The evidence supports a performance investigation, but it does not prove that
the work is avoidable. Examples include:

- A repeated draw batch.
- A large backing store.
- Repeated canvas resets during active drawing.

The user interface must show the evidence level. Each finding must include the
measured evidence, the least-specific valid explanation, what the evidence does
not establish, and a next check.

## Claim rules

canvas-scan can claim only what its measurement boundary supports.

Each finding must separate an observation from its explanation. It must use the
least-specific explanation that is sufficient for the observed evidence. More
measured evidence can narrow that explanation. Short wording, vague wording,
or an unsupported broad claim does not make an explanation valid.

This rule uses Bennett's least-specific explanation principle as a claim
discipline heuristic. The paper does not prove the rule for software agents or
canvas diagnosis: <https://arxiv.org/abs/2301.12987v4>.

It must not claim:

- Pixel identity from command-stream equality.
- Wasted work from a repeated command stream.
- GPU raster or presentation cost from synchronous Canvas2D timing.
- React commit causality from temporal proximity.
- Complete coverage of worker-owned or transferred canvases.
- A performance improvement without before-and-after evidence.

Use “Canvas2D API self-time,” not “render time” or “GPU time.” Use “associated
with,” not “caused by.” Use “review candidate,” not “waste.”

An `unknown` result is valid evidence. The product must prefer `unknown` over a
false `same` result.

## Instrumentation rules

Instrumentation must preserve native Canvas2D behavior.

- The native context identity, receivers, properties, return values, and
  exceptions must remain unchanged.
- The passive scan path must stay bounded and low cost.
- Detailed evidence must be limited to a short recording or selected canvas.
- The tool must not capture image pixels, input values, or raw application
  objects in an exported investigation.
- An internal instrumentation error must disable instrumentation and leave the
  application usable.
- Sampling must fail closed when skipped work breaks a comparison.

## Validation system

The repository owns three validation layers.

### Known-truth cases

Each case contains one intentional defect and a fixed mode. The case declares
the expected finding and structural evidence. It uses timing only when a
browser measurement is the subject of the case.

### Integrated lab apps

The Canvas Performance Lab contains two realistic dirty applications:

- A continuous application with persistent animation work.
- A burst-driven flamegraph or timeline that draws only after interactions.

Each application has bad and fixed modes with the same data and interactions.
canvas-scan receives no private hint about the active defect.

Each known-truth behavior must pass at least three deterministic variants. Each
variant changes at least two factors that do not define the defect. The complete
matrix must cover framework ownership, draw schedule, Canvas2D method mix,
canvas identity order, geometry, device pixel ratio, idle gaps, event source,
and work near a threshold. Each behavior must also pass one nearest negative
case.

### External dogfood

Real open-source applications test external validity after the controlled lab
passes. They can reveal missing Canvas2D patterns, but they do not replace the
known-truth cases. Upstream reports or pull requests need reproducible evidence
and remain separate external actions.

## Release authority

Agents own mechanical and behavioral checks. A release candidate must include:

- Unit and integration test results.
- Real-Chrome probe results.
- Canvas Performance Lab results.
- Hot-path benchmark results.
- Package and clean-consumer results.
- Known limits and unresolved uncertainty.
- A short manual release test.

The user tests release candidates for usefulness, language, and product feel.
The user does not need to test each implementation issue.

## Agent operating contract

A task is ready for autonomous work only when it has a clear outcome, bounded
scope, explicit non-goals, falsifiable acceptance criteria, exact checks, and
no unresolved product choice.

Before an agent changes a finding rule, instrumentation rule, or diagnosed bug,
it must record:

- The observed facts.
- The least-specific valid hypothesis that explains those facts.
- A check that can disprove the hypothesis.
- Stronger assumptions that the proposed change introduces.

The independent judge must test at least one counterexample outside the
original case. It must reject code that depends on private fixture labels,
stable canvas order, or another fact that does not define the behavior.

For a substantial ready task, use one plan, one build, and one independent
judge. Allow one correction pass after a failed judge result. After that pass,
create a follow-up issue or request the intervention defined by the issue. Do
not start an open-ended review loop.

An agent must stop for user input when:

- Acceptance criteria conflict.
- A product choice changes the core ritual.
- Work expands the active release scope.
- A change weakens an evidence or claim rule.
- A breaking API change has multiple valid designs.
- A required check needs unavailable credentials, hardware, or external access.

An agent must not stop only because a test fails, a local refactor is needed,
or browser behavior differs from a test fake. Those are implementation tasks.

Do not commit, push, publish, open an upstream issue, or create a pull request
without the user’s authorization for that action.

## Current non-goals

- A general JavaScript CPU profiler.
- Production monitoring or remote telemetry.
- Automatic code changes.
- Proof of GPU cost or pixel equality.
- WebGL or WebGPU investigation in the Canvas2D milestones.
- Full worker and `OffscreenCanvas` coverage in v0.4.
- Framework-specific correctness rules in the core engine.
- Automatic upstream pull requests.
