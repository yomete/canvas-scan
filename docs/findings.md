# What canvas-scan finds

Back to the [README](https://github.com/yomete/canvas-scan#readme).

- **`heavy-canvas-work`** — one draw episode contains at least 8 ms of measured synchronous Canvas2D API self-time. Not GPU or render time. The gate sums the self-time of one canvas across the whole episode, not across one frame. A draw episode starts at the first frame boundary that has Canvas2D activity. It ends when two consecutive frame boundaries have no Canvas2D activity on any canvas, so one quiet frame does not split it. The threshold is 8 ms because it is close to half of one 16.7 ms frame at 60 Hz. When one canvas spends that much time in synchronous Canvas2D calls during one burst of drawing, the calls are large enough to review, whether they landed in one frame or were spread across the burst. The finding's `maximumWindow` names the slowest single frame, so you can see which of the two occurred. Next: check the top measured methods and the application code that calls them. When the slowest window followed a canvas reset, the next check changes: the backing-store reallocation cost lands on the next context call, so check the sizing code before you check the top measured methods. Run an explanation to see the function that calls the top method.
- **`repeated-draw-work`** — captured windows sent the same command signature. A review candidate only: it does not claim unchanged pixels or wasted work. Next: check whether the scene and interaction require those repeated commands.
- **`resize-churn`** — reset events span repeated active raster-work windows. It does not prove the resets caused slowness. Next: check whether sizing and reset calls can run only when dimensions or state change.
- **`backing-store-mismatch`** — the recorded backing area is larger than the DPR-adjusted expected area. It does not prove excess GPU cost. Next: check the sizing policy and required image quality.

If React is present and canvas-scan loaded early, findings carry the nearest React owner with an explicit attribution confidence. Attribution is optional context, never the product boundary.

## What the comparison can and cannot answer

The comparison answers one question: did this frame draw the same thing as the last one? It answers it by comparing a frame's Canvas2D commands with the previous frame's. That works when a canvas is stable between frames, and it cannot work when the previous frame is gone.

| Application design | The comparison |
| --- | --- |
| One canvas, redrawn wholesale each frame | Answers. This is the case it was built for. |
| A library managing its own layers and redraw scheduling | Mostly answers. |
| Per-element or per-tile cache canvases, resized and composited with `drawImage` | Often cannot answer. |

A canvas whose size is reassigned has no previous frame to compare against, and neither has a canvas drawn from a source that was reassigned. canvas-scan reports those frames as `unknown`, with the reason, rather than guessing.

The measured figures are unaffected. Canvas2D API self-time, raster counts, method evidence, canvas resets, and backing-store ratios are all still measured on every frame. Three of the four finding types do not use the comparison at all. Only repeated-draw-work rests on it, and it rests only on the frames the comparison could answer for.

Two real applications, recorded on the same day, show both ends. A charting application drawing into one stable canvas came back with 1 unknown window out of 1378. Excalidraw, which caches every element on its own canvas, came back with 224 unknown out of 342. Both answers are correct. When most frames come back `unknown`, the overlay says so on the coverage line rather than leaving it to be discovered.

## How many recordings a before-and-after needs

Timing varies between runs of the same workload. In one investigation, a single-session change from 168 ms to 304 ms of Canvas2D self-time looked like a regression, and repeated runs did not confirm it. One session per build is one sample.

- Record the same interaction at least 5 times per build, each in a fresh page load. Name each file for its build and run, for example `baseline-run-3.json`, so nothing overwrites the baseline. The guided run's `--tag` does this for you; see [Investigate a URL](https://github.com/yomete/canvas-scan/blob/main/docs/investigate-url.md).
- For each build, list the self-time of the finding under investigation, or the session total, across the runs. Look at the median and at the range.
- Call it a regression or an improvement only when the two builds' ranges do not overlap. When they overlap, the answer is "no clear change at this sample size".
- Structural counts such as raster operations, resets, and active windows vary far less than times. A count change that holds in every run is stronger evidence than a time change.
- `compareSessions` compares one pair at a time. A single-session comparison is still allowed, but say that it rests on one sample per build.
