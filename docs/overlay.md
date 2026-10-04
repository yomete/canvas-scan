# Reading the overlay

Back to the [README](https://github.com/yomete/canvas-scan#readme).

Findings are ranked by measured Canvas2D API self-time, highest first, across all four types. Each card carries a **What this shows, and what it does not** disclosure holding the evidence level, the claim boundary, and the next check.

When a finding's draw episode overlaps an Event Timing entry or a long animation frame, the card shows an **Overlaps** line with each entry and its duration, longest first. This is associated evidence: the entry and the episode occurred at the same time. It does not show that the canvas work caused the long frame. The coverage line reports the long animation frames that overlapped no draw episode, so a stall outside Canvas2D is visible without the JSON.

**Keyboard.** The overlay's controls, the canvas rows in the activity flyout, and the finding cards are all reachable by Tab. Enter opens a canvas row's details and Escape returns focus to the row that opened it. Escape acts only while focus is inside the overlay, so a dialog or menu in your own application keeps its own dismissal. Inspect mode's outlines are a pointer affordance: they highlight canvases under the cursor and have no tab stops of their own, because adding one per canvas would insert them into your application's tab order. The activity flyout offers the same canvases as focusable rows, so nothing is reachable only by pointer.
