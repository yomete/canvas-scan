# Investigation details

Details for the [v0.5 investigation ritual](https://github.com/yomete/canvas-scan#v05-investigation-ritual).

To open a session JSON that you downloaded, or one that a teammate sent,
select **Load session JSON** in the flyout and choose the file. The overlay
shows the findings of that file as the saved recording. Select **Keep as
baseline** on one of them to compare it with your next recording. The file
must have `schemaVersion: 1`.

An explanation takes at most 8 stack samples. One sample is for the first
raster call. One sample is for the first different command in each frame. For
a `heavy-canvas-work` finding, one sample is for the first call of the top
method in each frame. When that sample maps to your source, the heavy card
shows a `Top method ... called from` line. The line names the function, the
file, and the line.

The comparison also carries two session-scoped browser measures:
`worst-interaction-duration-ms`, the longest Event Timing entry in each
recording, and `long-animation-frame-count`. Each is `null` when the browser
did not supply the feature, so the stall a ticket was opened for is compared
next to the canvas figures rather than read from the raw JSON.

Two recordings rarely cover the same span. The comparison carries `span`: the
duration, the draw-episode count, and the user-mark count of each side. When
the two sides differ by more than 20 percent in duration or in episode count,
`spanMismatch` says so, because session-scoped totals are then not on one
scale. Compare the explicitly selected findings for measures over their draw
episodes. Session episode counts do not establish equivalent interactions.
User marks remain recorded context; matching labels do not define comparison
ranges.

When the selected findings cannot be paired, the comparison is
`incomparable` and names the reason. A fix that removes the finding it
targeted is the commonest case: the candidate has no finding to pair. For
`finding-not-found`, `finding-type-mismatch`, and `incomplete-evidence`, the
artifact still carries `sessionFallback`: session-wide totals of Canvas2D
API self-time, raster operations, active windows, and canvas resets, summed
over every recorded canvas, with a `caveat` that keeps the reason visible.
The totals are not a paired comparison. They describe the same work only if
both recordings drove the same interaction, and `spanMismatch` still says
when the two recordings differ in length. A different schema or sampling rate
puts the totals on different scales, so those get no fallback.

The comparison also carries `observationNote` when either session counted
canvases that canvas-scan does not observe, such as a WebGL canvas or one
transferred to a worker. Their work is in no measure, so a lower Canvas2D
total does not mean they drew less.

canvas-scan also writes to the User Timing API, so a DevTools Performance
trace of the same run lines up with the session. `startRecording()` calls
`performance.mark('canvas-scan:recording-start')`. `stopRecording()` calls
`performance.measure('canvas-scan:episode-N')` for each draw episode. Both
show in the Timings track of the Performance panel. The session JSON stores
`timeOrigin`, the page's `performance.timeOrigin`. Add it to a session
timestamp to get the absolute time of a trace event. In the other direction,
a `performance.mark` or `performance.measure` that the page makes during a
recording is stored as a `user-mark` entry. The entry name is the label, and
a measure keeps its duration. Entries with a name that starts with
`canvas-scan:` are not stored.

The state changes from `idle` to `recording` to `complete` to `recording`.
The maximum duration is 30 seconds. Stops are `manual` or `max-duration`.
Calling start while recording is idempotent.
