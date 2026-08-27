# Excalidraw public dogfood — canvas-scan 0.6.2

Date: 2026-08-27
Target: `https://excalidraw.com`, the deployed production build. No repository
access, no source maps, no cooperation from the application.
Harness: `packages/dogfood/public-app-dogfood.mjs`.

## Why this run

The existing Excalidraw probes clone the repository, patch its entry file, and
assert a finding we already know is there. That is a regression harness. The
question here is the other one: point the tool at an application it has never
seen, drive it like a user, and report whatever it says without deciding the
answer first.

The bundle is injected through Playwright's `addInitScript`, which runs before
any application script. That is the "first import" position the README requires,
obtained without touching the application — the position anyone instrumenting a
third-party page would use.

## Workload

18.4 seconds: twenty rectangles and ellipses drawn by dragging, then
select-all and three full-scene drags, then six zoom steps, then pointer
movement with no drawing. 342 reported windows across 152 draw episodes.

## Result: honest, and not useful

canvas-scan installed cleanly, disturbed nothing, wrote nothing to the console,
and caused no page errors. It reported no heavy canvas work, which is correct —
Excalidraw spent 23.3 ms of Canvas2D API self-time across the whole 18 seconds,
and its worst single frame was 0.5 ms. It is a fast application.

It also correctly declined to blame canvas work for the worst long animation
frame in the run (211 ms), because that time was not spent in Canvas2D calls.

What a user would actually see is twelve findings, all `repeated-draw-work`,
with these self-times:

    0.3, 0.3, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1, 0, 0, 0, 0 ms

Six of the twelve rest on a single repeated window. Finding 1 is 0.3 ms. The
ranking works and the list is correctly ordered — the problem is that every
entry in it is nothing. A user's first action is to open finding 1, and on this
application that leads nowhere twelve times in a row.

## Defect 1 — injecting at document-start left the tool half-installed

**Found and fixed in this run.**

Loaded through `addInitScript` — or a browser extension, or
`Page.addScriptToEvaluateOnNewDocument` — canvas-scan runs before the document
element exists. `mountOverlay` appended its host to
`document.body ?? document.documentElement`, both of which are `null` at that
point, and threw. `start()` sets `window.__CANVAS_SCAN__` only after mounting,
so the throw left the Canvas2D prototypes patched with no API and no overlay:
every bit of the overhead and none of the tool, silently.

Observed before the fix:

| | |
|---|---|
| `document.readyState` | `loading` |
| `document.body` / `document.documentElement` | both null |
| thrown | `TypeError: Cannot read properties of null (reading 'append')` |
| `getContext` patched | yes |
| `window.__CANVAS_SCAN__` | undefined |

The script-tag position the README documents is **not** affected: a script in
`<head>` runs with `document.documentElement` already present, which was
verified separately. The exposure is to anyone instrumenting a page they do not
control, which is the use case the IIFE bundle exists for.

Two changes: `attachHost` waits for `DOMContentLoaded` when there is nothing to
append to yet, and `start()` wraps the overlay mount so a failure warns and
leaves the API working. The second is the general form — the overlay is the
convenience, the API is the tool, and one must not cost the other.

## Defect 2 — `repeated-draw-work` has no floor worth the name

The other three finding types have real gates: heavy work needs 8 ms in an
episode, resize churn needs two distinct qualifying windows, backing-store
mismatch needs two affected windows. `repeated-draw-work` needs **one** repeated
window whose raster count clears `minRepeatedRasterOps`, which defaults to 2.

So a single frame that redrew three shapes identically, costing no measurable
time, becomes a review candidate carrying the same visual weight as a real
problem. On a healthy application that manufactures a wall of noise, which is
exactly what happened here: twelve findings, none of them worth opening.

This is invisible on the demo, where the fixture is built to produce findings.
It only shows up when the tool is pointed at an application that is already
fast — which is most applications, most of the time.

A floor is a product call, not a bug fix. Candidates: a minimum episode
self-time the way heavy work has one; a minimum repeated-window count above
one; or keeping the findings and ranking them below anything with measurable
time, so the list stays honest without leading with nothing.

## Defect 3 — the canvas lifetime cap is far too low for cache-canvas applications

Excalidraw renders elements to per-element cache canvases. In 18 seconds it
created **228** of them. The recording cap `MAX_CANVASES` is 128, and hitting it
does not merely stop tracking new canvases — `removeCanvas` evicts the oldest
canvas *and everything recorded about it*:

| Entry kind | Kept | Dropped | Share lost |
|---|---|---|---|
| Canvas lifetimes | 128 | 100 | 44% |
| Canvas window reports | 342 | 254 | 43% |
| Reset events | 236 | 180 | 43% |
| Lifecycle events | 372 | 304 | 45% |

Nearly half the recording was discarded, and the findings are derived from what
survived. Note that the window cap itself (10,000) was nowhere near reached —
the loss is entirely a consequence of the canvas cap cascading.

This is the honest-reporting machinery working: the counts are all there in
`droppedEntryCounts`, and every finding card carries the truncation line added
for B-41 this week, so a user would at least be told. But being told that half
the evidence is gone is not the same as being able to investigate.

The cap exists to bound memory. Whether 128 is the right number for an
application class that treats canvases as cache entries is a product call.

## What this says about the comparison engine

Command statuses across the run: **20 same, 98 changed, 224 unknown**. Two
thirds of windows could not be compared at all, and the reasons are dominated by
the application's own design:

    canvas-reset        118
    canvas-source-reset  97
    first-window          9

Excalidraw resizes its cache canvases constantly and composites them with
`drawImage`, so a reset invalidates both the cache canvas and whatever drew from
it. Every one of those `unknown` answers is correct and honestly labelled. The
consequence is still that the central question the tool exists to answer — did
this frame draw the same thing as the last one — is unanswerable here two thirds
of the time.

## Attribution on a production build

Owner names resolve to minified identifiers: `mRe`, `fRe`, `ERe`. The
attribution is not wrong, and the two-character filter in `attribution.ts`
correctly does not reject them, but a finding headed `Repeated drawing · mRe`
tells a reader nothing they can act on. Of the 128 canvases in the session, 124
were `unattributed` — the cache canvases are created imperatively and carry no
fiber.

## Verdict

The tool is honest on a real application and it disturbs nothing. It made no
false claim in this run, and it correctly refused the one claim it would have
been tempting to make.

It was also not useful on this application, and the reasons are specific rather
than vague: the noise floor lets twelve empty findings to the top, the canvas
cap throws away half the evidence, and the app's cache-canvas design defeats the
comparison engine two thirds of the time. Defects 2 and 3 are both fixable and
both are product calls about thresholds.

Excalidraw being fast is the awkward part of this result. A tool that finds
nothing on a fast application is behaving correctly, and this run cannot
distinguish "found nothing because there was nothing" from "found nothing
because it cannot see". The next run should target an application with a known
canvas performance problem, so the tool has something real to find.

## Repeating this run

    pnpm --filter canvas-scan run build
    node packages/dogfood/public-app-dogfood.mjs --url=https://excalidraw.com --out=/tmp/evidence

Evidence is written as `session.json` (the full artifact) and `report.json`
(the summary the tables above are drawn from).
