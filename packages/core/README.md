<!-- This README is packed with the canvas-scan package. -->

# canvas-scan

> One early import that watches every main-thread Canvas2D canvas in your app. It turns "this canvas feels slow" into a correct next check.

[![npm version](https://img.shields.io/npm/v/canvas-scan)](https://www.npmjs.com/package/canvas-scan)
[![license: MIT](https://img.shields.io/npm/l/canvas-scan)](./LICENSE)

![canvas-scan recording an investigation on a canvas-heavy app](docs/demo.gif)

React performance tools stop at the `<canvas>` element: they can tell you a component re-rendered, but not what the canvas did. canvas-scan starts where they stop. It records a bounded investigation session and answers five questions:

- Which canvas performed work?
- Which interaction or draw episode contained that work?
- Which Canvas2D calls dominated the measured time?
- How strong is each piece of evidence — `measured`, `associated`, or `candidate`?
- What should you check next?

**It never guesses.** Self-time means synchronous Canvas2D API time. The tool never claims GPU time, render time, pixel identity, or wasted work. Window comparisons come back `same | changed | unknown`, and `unknown` is an honest answer, not a failure. Every finding states what its evidence cannot prove and names the next useful check.

## Quick start

```bash
npm install -D canvas-scan
npx canvas-scan init --write   # wires Vite or Next
```

Or add the import yourself. It must be the first import, before React and before any canvas work:

```ts
import 'canvas-scan/auto';
```

Or, for development without a bundler, a script tag before all other scripts:

```html
<script src="https://unpkg.com/canvas-scan@0.7.4/dist/canvas-scan.iife.js"></script>
```

Reload, press **Record investigation** in the overlay, reproduce the slow interaction once, and stop. Findings appear ranked, each with its evidence level, its claim boundary, and its next check.

`canvas-scan/auto` is a development tool, and `init --write` adds the import with no guard. Guard it before you commit: see [Keep it out of production](https://github.com/yomete/canvas-scan/blob/main/docs/production.md).

![the canvas-scan overlay with ranked findings](docs/overlay.png)

Findings are ranked by measured Canvas2D API self-time. Each card states its evidence level, its claim boundary, and its next check. See [Reading the overlay](https://github.com/yomete/canvas-scan/blob/main/docs/overlay.md) for the Overlaps line and keyboard use.

## What it finds

Four finding types. Each one states what it cannot prove and names the next check. [Full definitions](https://github.com/yomete/canvas-scan/blob/main/docs/findings.md).

- **`heavy-canvas-work`**: one draw episode contains at least 8 ms of measured synchronous Canvas2D API self-time. Not GPU or render time. The gate sums the self-time of one canvas across the whole episode, not across one frame. An episode ends when two consecutive frame boundaries have no Canvas2D activity on any canvas. The threshold is 8 ms because it is close to half of one 16.7 ms frame at 60 Hz.
- **`repeated-draw-work`**: captured windows sent the same command signature. A review candidate only.
- **`resize-churn`**: reset events span repeated active raster-work windows.
- **`backing-store-mismatch`**: the recorded backing area is larger than the DPR-adjusted expected area.

## Investigate: record, explain, change, compare

Every step leaves a plain JSON artifact. The overlay and the API do the same work.

1. Load `canvas-scan/auto` before React and before application Canvas2D work.
2. Record a baseline: `startRecording()`, reproduce one bounded interaction, `stopRecording()`, then read `getLastSession()`.
3. Open one baseline finding. Select **Explain next interaction**, or call `startExplanation({ sessionId, findingIndex })` with that explicit finding.
4. Reproduce the interaction again. Stop with `stopExplanation()`, read `getLastExplanation()`, and use **Copy explanation JSON** when you need the artifact.
5. Select **Keep as baseline** on the explained finding. The overlay keeps it across a page reload.
6. Make the application change. Record a candidate: `startRecording()`, the same bounded interaction, `stopRecording()`.
7. Open a candidate finding of the same finding type. Select **Compare with baseline**, or call `compareSessions(baseline, candidate, { baselineFindingIndex, candidateFindingIndex })`. The pairing is always explicit.
8. Review the measured pair. **Copy comparison JSON** keeps the plain JSON artifact.

The public API for this workflow is `startRecording`, `stopRecording`, `getLastSession`, `mark`, `startExplanation`, `stopExplanation`, `getLastExplanation`, and `compareSessions`. `mark` adds a labeled marker to the recording. See [API, options, and sampling](https://github.com/yomete/canvas-scan/blob/main/docs/api.md).

An explanation covers only the selected canvas. It excludes raw argument values, page text, pixels, raw application and argument URLs, application objects, and source content. Sanitized callsite evidence can include generated script paths and mapped source paths. A result can be an honest `unknown`. One measured pair does not prove that the application improved.

More detail: [load a saved session, explanation samples, browser measures, span mismatch, User Timing, and recording states](https://github.com/yomete/canvas-scan/blob/main/docs/investigation-details.md).

## For coding agents

canvas-scan ships an agent skill at `skills/canvas-scan/SKILL.md` in the published package, and at `packages/core/skills/canvas-scan` in the repository. It teaches the record, explain, change, compare workflow, how to read each finding type, and which code change matches each one. After install it is at `node_modules/canvas-scan/skills/canvas-scan`. Copy that directory into your agent's skills directory, or point the agent at it.

## Documentation

- [Keep it out of production](https://github.com/yomete/canvas-scan/blob/main/docs/production.md): guard the import in Next and Vite builds.
- [What it finds](https://github.com/yomete/canvas-scan/blob/main/docs/findings.md): the four finding types, and what the comparison can and cannot answer.
- [Reading the overlay](https://github.com/yomete/canvas-scan/blob/main/docs/overlay.md): finding cards, the Overlaps line, and keyboard use.
- [API, options, and sampling](https://github.com/yomete/canvas-scan/blob/main/docs/api.md): imports, `start(options)`, and `captureEvery`.
- [Investigate a URL](https://github.com/yomete/canvas-scan/blob/main/docs/investigate-url.md): the guided run, the agent handoff, and Playwright.
- [The artifacts](https://github.com/yomete/canvas-scan/blob/main/docs/artifacts.md): the JSON artifacts, privacy, and network claims.
- [Overhead](https://github.com/yomete/canvas-scan/blob/main/docs/overhead.md): measured cost and timer resolution.
- [Scope and honest limits](https://github.com/yomete/canvas-scan/blob/main/docs/limits.md): what canvas-scan cannot observe.

## License

MIT
