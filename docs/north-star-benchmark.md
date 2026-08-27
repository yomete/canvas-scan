# The north-star outcome benchmark

Status: frozen on 2026-08-27. Issue: SIDPROJ-107.

Do not change a value in this document without a new approval. The scorer holds
the same values in `PROTOCOL`, and a test fails when the two disagree.

## What this benchmark measures

The product contract states one north star:

> The product succeeds when it reduces the time from "this canvas app feels
> slow" to a correct next check.

This benchmark measures that sentence and nothing else. It measures the time a
developer needs to reach a correct next check, and whether the check is correct.

A green build does not prove the product outcome. Nor does a passing test suite,
a shipped feature, a low overhead figure, or a corpus result. The scorer refuses
each of these as a claim source. Only this benchmark can support a public claim.

## The two arms

Both arms use the same six fixtures, the same interactions, and the same answer
form.

| Arm | The participant uses |
| --- | --- |
| `control` | The Chrome DevTools Performance panel alone. |
| `canvas-scan` | The v0.5 investigation ritual from the README. |

A participant does three tasks in one arm and three in the other. The facilitator
counterbalances the order across the group, so every task appears in both arms.

## The six tasks

Each fixture is a self-contained page in `packages/dogfood/benchmark/pages/`. Each
page holds one seeded defect. The pages load no library and make no network
request.

| Task | The defect the fixture holds |
| --- | --- |
| `scene-overdraw` | A pointer handler redraws an unchanged scene. |
| `resize-churn` | The frame loop resets the canvas to the size it already has. |
| `oversized-backing-store` | The backing store is 156 times the displayed area. |
| `gradient-per-shape` | The draw loop builds one identical gradient per tile. |
| `pixel-readback` | A pointer handler reads one pixel back every frame. |
| `hidden-cache-canvas` | The expensive canvas is not in the document. |

`packages/dogfood/benchmark/manifest.json` holds the symptom and the interaction
for each task. The file is safe to show a participant.

## The answer key

`packages/dogfood/benchmark/answers.json` holds the expected answers. A
participant never opens this file. A facilitator opens it only after a
participant submits an answer.

Every answer names the line of the fixture that holds the seeded defect. No
answer comes from a canvas-scan session, finding, explanation, or comparison. A
benchmark that took its answers from the tool would mark canvas-scan against
itself. `checkAnswerKey` refuses a key that carries a canvas-scan artifact field.

## The protocol

### The start event

The facilitator shows the participant the fixture page and the symptom. The
facilitator names the interaction. The participant presses start, and the clock
starts.

### The stop event

The participant submits the answer form. The clock stops. The participant
submits the form once.

### The answer form

The form takes three values.

1. **Canvas.** Which canvas performed the work.
2. **Cause.** One tag from the closed list in the manifest.
3. **Next check.** One sentence naming what the participant would do next.

The form takes no canvas-scan artifact. The scorer refuses a submission that
carries one.

### A correct answer

An answer is correct when it names the seeded canvas and the seeded cause. The
scorer accepts the aliases listed in the answer key for the canvas name. It
matches the cause exactly against the closed list.

The next check is recorded. The scorer does not grade it.

### A timeout

The timeout is **15 minutes** for one task. A participant who reaches the timeout
without an answer produces a timeout.

A timeout is not a wrong answer. The scorer keeps the two apart. A timeout lowers
the correctness rate of its arm, and it never enters the median time.

### An invalid run

A run is invalid when any of these is true.

- The participant saw the fixture before.
- The fixture did not load, or the tool under test crashed.
- The participant submitted the form incomplete.
- The participant submitted an answer after the timeout.
- The facilitator recorded no elapsed time.

An invalid run says nothing about either arm. The scorer removes it from both
halves of the correctness fraction.

## The sample

| Value | Approved |
| --- | --- |
| Participants | 6 |
| Tasks for each participant | 6 |
| Graded runs for each arm | 36 |
| Time for one task | 15 minutes |
| Time for one session | 2 hours |

## The success threshold

The canvas-scan arm succeeds when both of these hold.

1. Its correctness rate is not below the control arm's rate.
2. Its median time to a correct answer is at most half the control arm's median.

The first condition stops the benchmark rewarding speed that comes from wrong
answers. The second condition is the north star itself.

`judge()` applies both conditions and reports the reason for each failure.

## The public claim

A result that meets the threshold supports one approved sentence. The sentence
names the sample, both arms, and both figures. `claimSentence()` builds it, and
it refuses a result that does not meet the threshold.

The approved form is:

> In a controlled benchmark, 6 developers reached a correct next check on 6
> seeded canvas defects X% of the time in a median of M minutes with canvas-scan,
> against Y% and N minutes with the Chrome DevTools Performance panel alone.

Do not state the claim without the numbers. The numbers make the claim bounded.

## Run the checks

The scorer, the manifest, and the answer key have a test suite. It needs no
browser and no participant.

```bash
pnpm --filter dogfood run benchmark:test
```

## What happens next

SIDPROJ-113 (RDY-09) runs this protocol and produces the first result. A person
runs it. A person approves any public claim that comes out of it.
