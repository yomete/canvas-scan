# Excalidraw re-run — canvas-scan 0.7.0

Date: 2026-08-27
Target: `https://excalidraw.com`, public production build.
Tool under test: `canvas-scan.iife.js` built from `v0.7.0`.

## Why this run

Three of the five changes in v0.7 came from the Excalidraw run earlier the same
day, and all three were verified against fixtures written from that write-up.
A fixture written from a report encodes the reporter's reading of the problem,
which is the part that can be wrong. This run checks the fixes against the
application that produced them.

Same target, same interaction as `research/2026-08-27-excalidraw-public-dogfood.md`:
twenty shapes drawn by dragging, select all, three scene drags, six zoom steps.
Driven through Playwright rather than by hand.

## Result

| | 0.6.2, earlier today | 0.7.0, now |
| --- | --- | --- |
| Recording length | 18.4 s | 16.4 s |
| Canvases reported | 128 | **210** |
| Canvas lifetimes dropped | 100 (44%) | **0** |
| Canvases kept as a summary only | — | 84 |
| Canvases carrying a source location | none for the 124 with no fiber | **210, all of them** |
| Owner on the top finding | `mRe` | **`Excalidraw`** |
| Findings in the list | 12, all shown | 11, with 4 collapsed behind a count |
| Comparison boundary stated | no | yes, on the coverage line |
| Total Canvas2D API self-time | 23.3 ms | 31.1 ms |

The two runs are not perfectly comparable. They differ by two seconds of
recording, the site may have shipped a new build between them, and the
interaction was driven by hand the first time and by Playwright this time.
Every number above is a direction, not a delta.

## The card a reader now sees

```
1  Repeated drawing · Excalidraw
   2 near-identical frames · 32 draw calls · 0.2 ms
   Drawn from App.tsx:209
   Canvas not on the page.
```

`App.tsx:209` is Excalidraw's own source, resolved through the source map their
production build publishes. The bundle is `assets/index-CmqSbLij.js`, and the
generated location the tool recorded is line 151, column 338205 of it.

That line is the whole point of the release. The same finding read
`Repeated drawing · mRe` this morning.

## What each change did

**No canvas is forgotten.** `canvasLifetimes` dropped went from 100 to 0, and
the session reports 210 canvases rather than 128. 84 of them are summaries only,
and the coverage line names them. Their totals are real; their per-window detail,
resets and lifecycle events are still dropped — 226 window reports, 150 reset
events and 255 lifecycle events this run. The fix keeps what a finding is
derived from, not everything.

**The owner is readable.** No canvas resolved as `minified-owner` at all. The
labelling half of that fix was not exercised; the other half was. `findOwner`
now skips a minified name and keeps walking, so it reached `Excalidraw` where it
used to stop at `mRe`. 17 canvases resolved a JSX owner, 1 a container, and 192
remain genuinely unattributed — those are the imperative cache canvases, and
they now carry a creation site instead of nothing.

**The empty findings are out of the way.** Seven findings with measured time are
listed; four with none are collapsed behind `4 more findings with no measured
time`, closed by default.

**The boundary is stated.** 403 of 555 frames came back unknown, and the
coverage line says so in the reader's language rather than leaving it to be
counted.

## What this run did not settle

The application is still fast, and canvas-scan still finds nothing important in
it. The largest finding is 0.2 ms. This run confirms the tool is now readable
and honest on a production build; it does not show the tool finding a real
problem, because there is not one here to find. The PolarSignals re-run remains
the evidence for that.

Excalidraw serves its JavaScript from its own origin, so the same-origin rule on
source maps did not bite. An application that serves its bundle from a separate
CDN origin would get no mapping, and the card would name the bundle. That case
is untested.

## Network

Four origins were contacted during the run: `excalidraw.com`,
`excalidraw.nyc3.cdn.digitaloceanspaces.com`, `scripts.simpleanalyticscdn.com`,
and `sentry.io`. All four are the application's own traffic. canvas-scan's only
request was the same-origin source map on `excalidraw.com`.

## Repeating this run

Build the bundle, then drive the pinned interaction with the bundle installed
before the application's first script:

```bash
pnpm --filter canvas-scan run build
```

The interaction is `packages/dogfood/corpus/interactions/excalidraw.mjs`.
