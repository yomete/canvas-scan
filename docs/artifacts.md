# The artifacts, privacy, and network claims

Back to the [README](https://github.com/yomete/canvas-scan#readme).

`InvestigationSessionV1`, `ExplanationArtifactV1`, and `ComparisonArtifactV1` are versioned plain JSON: session metadata, browser features, canvases, windows, reset and lifecycle events, episodes, browser evidence entries, findings, collection limits, and dropped-entry counts. Every finding carries a `claimBoundary` stating what the evidence cannot prove and a `nextCheck` naming the next useful step.

A recording that reached the canvas limit keeps each evicted canvas as a summary with `windowDetailDropped: true`. `compareSessions` refuses a pairing only when the selected canvas is summary-only, because that canvas has no frames. Other summary-only canvases do not block the comparison. The artifact reports how many it left out on each side in `coverageNote`, and the overlay shows the same note.

**Privacy.** Artifacts never contain page text, input values, pixels, raw argument values, application URLs, or live objects. Explanation commands are normalized to typed tokens.

**canvas-scan sends no investigation data anywhere, by default or otherwise.** It performs no telemetry, upload, scoring, crash reporting, supply-chain check, remote-rule fetch, or update check. It makes one kind of network request of its own: it fetches your app's own source maps, bounded in count and size. Two things ask for them, and both follow something you did — canvas-scan never fetches on its own. Resolving a draw callsite during an explanation asks for one. So does a recording that produced findings, because a finding names the canvas it is about, and `app.min.js:1` is a real place and no help. That request cannot leave your app's origin — the resolver refuses a cross-origin resource before the fetch, and refuses a redirect that leaves the origin.

The claim is checked rather than asserted. `packages/dogfood/network-silence.mjs` defines one request-classification contract with three owners: the target navigation, the target's own application traffic, and canvas-scan's same-origin source maps. Anything else fails. `pnpm --filter dogfood run network-silence:test` runs the complete guided workflow with external network access cut off once the application has loaded, classifies every request the run made, and watches the command's own process for a socket leaving the machine.
