# The external corpus

The corpus runs the guided Canvas Scan workflow against a small, pinned set of
real Canvas2D applications. It answers one question: is Canvas Scan useful on
somebody else's application?

## What the corpus is not

The corpus does not define product truth. The controlled fixtures in
`packages/dogfood` do that. A corpus result never says what Canvas Scan should
do, and it never fails a release on its own. Every outcome carries the label
`external-only` and the flags `blocksRelease: false`, `definesProductTruth:
false`, and `createsUpstreamAction: false`.

The corpus opens no issue and no pull request. It reads three repositories at
fixed commits and writes locally.

## The applications

| Entry | Design | Why it is here |
| --- | --- | --- |
| `chartjs` | one stable canvas redrawn wholesale | The case the command-signature comparison was built for. |
| `konva` | a retained scene graph | The library decides when to redraw, not the application. |
| `excalidraw` | per-element cache canvases | Hundreds of short-lived canvases, which stresses the canvas lifetime cap. |

`manifest.json` pins each repository to an exact commit. A tag can be
repointed; a commit cannot, so the manifest checker refuses anything but a
full commit hash.

Each entry declares its setup commands, one bounded interaction, the
observations it expects to be supported, its stop conditions, and an evidence
budget in seconds.

## Running it

```bash
pnpm --filter canvas-scan run build
pnpm --filter dogfood run corpus -- --out=/tmp/corpus
```

Add `--entry=chartjs` to run one application. Add `--skip-setup` to reuse a
build already in the cache directory.

The run needs the network, and it clones over whatever transport your Git
configuration uses. Every run saves the agent handoff, the package bundle
hash, the browser revision, the application commit, and the commands it ran.

## Reading the result

Each entry gets one of five statuses:

| Status | Meaning |
| --- | --- |
| `useful-evidence` | The run observed something worth reading, or observed the application and found it had nothing to report. |
| `honest-unknown` | The run observed the application and could not compare it. This is a true answer, not a missing one. |
| `declared-unavailable` | The application made the run impossible, and the entry named this in advance as a stop condition. |
| `setup-failed` | The clone, the install, or the build did not work. |
| `run-failed` | The run did not finish, and the entry did not declare the reason. |

`setup-failed` is a status of its own and never collapses into a result about
Canvas Scan. A failed application build that reported "no findings" would be
Canvas Scan claiming a clean bill of health for a page it never saw.

## The advisory baseline

`corpus-baseline.mjs` compares one corpus run with a stored baseline and
reports what changed. It is advisory: a change is something to read, not a
build failure.

Write a baseline from a run:

```bash
node packages/dogfood/corpus-baseline.mjs --run=/tmp/corpus/corpus-run.json --baseline=corpus-baseline.json --write
```

Compare a later run with it:

```bash
node packages/dogfood/corpus-baseline.mjs --run=/tmp/corpus/corpus-run.json --baseline=corpus-baseline.json
```

### What it compares

Structural result classes only: which entries produced evidence, what kinds of
finding, whether the tool could compare the drawing at all, and what a
collection limit dropped.

**No measured time enters a baseline.** Two browser runs on two machines differ
by more than any change worth reporting, and a difference between one recording
and one other recording is not evidence about speed. The builder refuses a
timing field, and the renderer refuses to write the words "faster", "slower",
"fixed", "improved", or "regressed".

### When a comparison is not valid

The comparison reports `invalid` and stops when a pin has moved, the schemas
differ, an entry is missing, or an entry did not produce a sound run. A changed
pin explains every difference underneath it, so a diff would only distract.

A `declared-unavailable` entry is reported as incomplete but does not make the
comparison invalid: the entry named that state in advance.

Every reported change links to the run report and the agent handoff it came
from.
