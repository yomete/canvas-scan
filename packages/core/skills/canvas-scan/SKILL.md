---
name: canvas-scan
description: Investigate and improve slow Canvas2D drawing with canvas-scan. Records one bounded interaction, ranks findings by measured Canvas2D self-time, and compares a baseline with a candidate after a code change. Use when a user reports a slow, laggy, or janky <canvas>, asks why a chart, whiteboard, map, or game canvas stutters, or asks to make canvas rendering faster.
---

# canvas-scan

canvas-scan watches every main-thread Canvas2D canvas and records a bounded
investigation. It measures synchronous Canvas2D API self-time only. It never
claims GPU time, render time, pixel identity, or wasted work.

## Rules for every investigation

1. Measure before you change code. Do not guess from the source.
2. Load canvas-scan before React and before all application canvas work.
3. Record one bounded interaction, not a whole session.
4. Read `claimBoundary.nonEstablishedFacts` and `nextCheck` on every finding before you act.
5. Make one change, then record a candidate and compare it with the baseline.
6. Report `unknown` as `unknown`. Do not read it as "no problem" or "a problem".
7. Do not read a self-time change smaller than `timerResolutionMs` as a change.

## Quick start

Install and wire the import. The import must be the first import in the entry file.

```bash
npm install -D canvas-scan
npx canvas-scan init --write
```

Keep it out of production. See "Keep it out of production" in the package README
for the Next `require` guard and the Vite build alias. Never use a dynamic import.

## Workflow: record, explain, change, compare

Drive the page from Playwright or from the browser console. `window.__CANVAS_SCAN__`
exposes the same API as `import { ... } from 'canvas-scan'`.

1. **Record a baseline.** Call `startRecording()`, reproduce the slow interaction once, then call `stopRecording()`. It returns an `InvestigationSessionV1`. Save it to a file.
2. **Read the findings.** `session.findings` is ranked by `canvasApiSelfTimeMs`, highest first. Take the top finding. Note its `type`, `canvasId`, `topMethods`, `claimBoundary`, and `nextCheck`.
3. **Explain the top finding.** Call `startExplanation({ sessionId, findingIndex })`, reproduce the interaction again, then call `stopExplanation()`. The `ExplanationArtifactV1` carries up to 8 stack samples. A sample that maps to source names the function, file, and line that calls the top method. Start your code change there.
4. **Change the code.** Use the table in [REFERENCE.md](REFERENCE.md) to pick the fix that matches the finding type.
5. **Record a candidate.** Repeat step 1 with the same interaction.
6. **Compare.** Call `compareSessions(baseline, candidate, { baselineFindingIndex, candidateFindingIndex })`. Pair findings of the same `type` and the same canvas role. Read `status`, `measures`, `spanMismatch`, and `coverageNote`.
7. **Report.** State the measured delta for the paired finding. Say what the comparison does not prove. `improvementEstablished` is always `false`; one measured pair is evidence, not proof.

## Playwright driver

```ts
await page.addInitScript({ path: 'node_modules/canvas-scan/dist/canvas-scan.iife.js' });
await page.goto('http://localhost:5173/chart');
await page.evaluate(() => __CANVAS_SCAN__.startRecording());
await page.getByRole('button', { name: 'Zoom' }).click(); // the one bounded interaction
const session = await page.evaluate(() => __CANVAS_SCAN__.stopRecording());
fs.writeFileSync('baseline.json', JSON.stringify(session));
```

For a page you do not control, use the guided run. It writes `handoff.jsonl`,
one record per line, that an agent can read without the overlay:

```bash
node packages/dogfood/investigate-url.mjs --url=https://example.com
node packages/dogfood/read-handoff.mjs path/to/handoff.jsonl
```

## How to read a comparison

- `status: 'incomparable'` names the reason in `incomparableReasons`. Fix the pairing and record again. Do not report a result.
- `spanMismatch` set: the two recordings differ by more than 20 percent in duration or episode count. Compare only the paired findings, not the session totals.
- `coverageNote` set: one side evicted a canvas to a summary. Say so in the report.
- Many `unknown` windows in `commandStatuses`: the repeated-draw comparison could not answer. The measured self-time is still valid. See "What the comparison can and cannot answer" in the package README.

## Advanced

Artifact fields, finding types, the fix table, and the limits are in [REFERENCE.md](REFERENCE.md).
