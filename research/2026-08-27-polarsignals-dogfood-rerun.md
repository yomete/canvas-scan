# PolarSignals dogfood re-run — canvas-scan 0.6.2

Date: 2026-08-27
Target: `local.polarsignals.com`, `ui/packages/app/cloud-v2` dev server, profiler view.
Companion to `2026-08-21-polarsignals-dogfood.md`, whose fixes are no longer in
the checkout — so both defects it describes should be reproducible, and both
were.

## Why this run

The Excalidraw run on the same day (`2026-08-27-excalidraw-public-dogfood.md`)
could not answer the question it set out to ask. Excalidraw is fast: 23.3 ms of
Canvas2D time across 18 seconds, and canvas-scan reported twelve findings that
were all noise. That result cannot distinguish "found nothing because there was
nothing" from "found nothing because it cannot see".

This target has two known defects with known symptoms. That makes it a
known-answer test rather than an open-ended one.

## Method

Instrumented the way the original note did — the IIFE bundle in
`public/canvas-scan.iife.js` and a `<script>` as the first entry in
`pages/_document.tsx`, so `getContext` is patched before any chart takes a
context. Both changes were reverted after the run.

The recordings were driven by hand through the overlay, because the page sits
behind SSO and the automation harness has no session. Two recordings, exported
with the overlay's own **Download session JSON**.

## Result: both defects found, with numbers

### LineChart hover — reproduced, emphatically

19.3 seconds of pointer movement across the CPU Cores chart. No clicking.

| | |
|---|---|
| Windows recorded | 1378 |
| Windows that redrew **identical commands** | **1049 (76%)** |
| Windows that drew something different | 328 |
| Windows that could not be compared | **1** |
| Back-to-back identical frames | **681** |
| `repeated-draw-work` findings | 44, covering all 1049 windows |
| Canvas2D API self-time | 55.3 ms |

The largest single finding covers **205 repeated windows out of 251 active** in
one draw episode — 82% of the frames in that episode drew the same thing twice.
The top method is `lineTo`, called **32,379 times**, which is the overlay
renderer stroking every visible series polyline again on each `pointermove`.
That is precisely the root cause the original note identified: the hover object
gets a fresh identity every `pointermove` because it carries cursor coordinates
for the DOM tooltip, so the overlay draw effect re-runs.

Attribution resolved to `LineChartInner`, a real component name, because this is
a dev build with unminified names — unlike Excalidraw's `mRe` and `fRe`.

Note the comparison engine's coverage here: **1 unknown window out of 1378**.
On Excalidraw it was 65% unknown. The difference is the application's design,
not the tool's: a chart that draws into one stable canvas is exactly the case
the command-signature comparison was built for.

### Flamegraph invert — the structural defect reproduced, the cost did not

Roughly twenty toggles of **Invert Call Stack** over 30 seconds.

| | |
|---|---|
| Canvas resets observed | **92** |
| …that **did not change the size** | **69 (75%)** |
| …that did change it | 23 |
| Reset sources | 46 `width-setter`, 46 `height-setter` |
| Canvas2D API self-time | 140.4 ms |
| Findings | 1 `resize-churn`, 4 `heavy-canvas-work` |

Every toggle assigns both `canvas.width` and `canvas.height`, and three quarters
of those assignments set the value it already had. Each one forces the browser to
reallocate and clear the backing store for nothing. That is the defect, located
and quantified — and `69 of 92 changed nothing` is a stronger statement of it
than the original note had.

**What did not reproduce:** the original note measured `save()` at 21–74 ms per
toggle and a 728 ms worst pointerup-to-paint. Here `save` was called 45 times for
1 ms total, and the worst single frame was 5.2 ms. The reallocation cost lands on
the next context call, and it scales with the backing store — the note describes
a flamegraph spanning "tens of megapixels", while this one sat in a browser
window roughly 1200 px wide. The defect is the same; its price here is small.
A full-screen flamegraph on a large display should be re-measured before
deciding how much the fix is worth.

The four `heavy-canvas-work` findings (8.1–8.9 ms each) are honest but marginal —
they clear the 8 ms episode gate by a hair. The real work is visible in the
methods: **99,257 `fill` calls and 99,257 `roundRect` calls**, about 5,800
rounded rectangles per frame.

## What this says about the tool

**It works when there is something to find.** Two known defects, both located,
both quantified, with the responsible methods named and a real component name
attached. That is the answer the Excalidraw run could not give.

**Ranking held up under load.** 45 findings, correctly ordered: the
`heavy-canvas-work` finding at 9.9 ms first, then repeated-draw findings
descending 7.6 → 0 ms. The top twelve are all worth opening.

**[SIDPROJ-202](https://linear.app/yde/issue/SIDPROJ-202) is real but narrower than the Excalidraw run suggested.** Six of the
44 repeated findings measured 0 ms and four rest on a single window — the noise
is here too. But ranking put every one of them in the bottom third, so a user
reading top-down never meets them. The noise floor matters most when there is
*nothing* real to find, which is when it fills the whole list. This is evidence
for option 3 in that issue — rank the empty ones below anything with measurable
time — because that is already happening and it already works. What remains is
the list's length, not its order.

**[SIDPROJ-203](https://linear.app/yde/issue/SIDPROJ-203) did not bite.** Six canvases, nothing dropped at all across either
recording. That issue is specific to applications that treat canvases as cache
entries, which charting applications do not.

**Two fixes from this week earned their place:**

- The `resize-churn` summary reads `92 canvas resets · 69 didn't change the
  size`. That second number *is* the finding.
- The heavy-work card separates the spans: the LineChart heavy finding is 9.9 ms
  across an episode whose slowest single frame was 0.2 ms. Before B-04 the card
  would have put 9.9 ms next to the whole episode's draw-call count and invited
  the reader to think one frame did all of it.

## Evidence

- `~/Downloads/canvas-scan-1787801077027-1.json` — LineChart hover, 2.6 MB
- `~/Downloads/canvas-scan-1787801126496-2.json` — Flamegraph invert, 186 KB

## Repeating this run

The instrumentation was reverted. To redo it:

    cp packages/core/dist/canvas-scan.iife.js \
      ~/Documents/batcave/polarsignals/ui/packages/app/cloud-v2/public/

then add `<script src="/canvas-scan.iife.js" />` as the first child of `<Head>`
in `pages/_document.tsx`, reload the authenticated page, and record through the
overlay.

The page is behind SSO, so the headless harness cannot reach it. Refreshing
`e2e-tests/.auth/user.json` through the repo's own Playwright setup project
would make this automatable and repeatable.
