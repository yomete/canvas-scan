# Investigate a URL

Back to the [README](https://github.com/yomete/canvas-scan#readme).

Run one guided investigation against a page you do not control:

```bash
node packages/dogfood/investigate-url.mjs --url=https://example.com
```

The command opens Chrome on that URL with canvas-scan installed before the first application script. Drive the overlay yourself: record, explain, keep a baseline, record a candidate, compare. Close the browser window when you finish. The command writes every artifact you produced, and a report of what it observed, to a directory it names on exit.

The command accepts one `http` or `https` URL. It refuses any other scheme, and it refuses two targets. Add `--out=DIR` to choose the directory. Add `--timeout=MINUTES` to change the one-hour limit.

## Keep every run: `--tag` and `--out`

A run never replaces an earlier one. Add `--tag=NAME` to name the build or the run, for example `--tag=baseline` and then `--tag=candidate`. The tag goes into every file name the run writes:

| Untagged | Tagged with `--tag=candidate` |
| --- | --- |
| `run-report.json` | `run-report-candidate.json` |
| `handoff.json`, `handoff.jsonl` | `handoff-candidate.json`, `handoff-candidate.jsonl` |
| `artifacts/session-1.json` | `artifacts/candidate-session-1.json` |

Without `--out`, each run gets a new directory, `.investigation-<tag>-<time>`. With `--out=DIR`, the run writes into `DIR`, so two differently tagged runs can share it. When `DIR` already holds a report under the same name, from an untagged run or the same tag, the run writes to `DIR-2` instead, then `DIR-3`, and so on. The report records the tag and the directory it used, and the command prints the report path on exit. A tag is 1 to 64 letters, digits, dots, dashes, or underscores, and starts with a letter or digit.

Chrome runs from a throwaway profile that the command deletes afterwards, so your own browser profile does not change. The command records every request that leaves the target's origin, and the report names them. It measures no GPU time, diagnoses no CPU, and sends nothing anywhere.

Build the bundle first with `pnpm --filter canvas-scan run build`.

## The agent handoff

The command also writes `handoff.json` and `handoff.jsonl`. Both hold the same versioned records, so a coding agent can read one investigation without parsing overlay text or carrying state from a conversation. Use `--handoff=json`, `--handoff=jsonl`, or `--handoff=none` to choose.

JSONL uses one record per line. Each record has one of seven kinds: `metadata`, `stage`, `finding`, `explanation`, `comparison`, `limit`, and `result`. The last record is always the terminal `result`, so a reader can tell a finished run from a truncated file.

Every finding carries its evidence level, its claim boundary, its next check, and how many of its frames the tool could not compare. Every dropped observation gets its own `limit` record. A run that did not finish names each incomplete stage in the `result` record.

The reader refuses an unknown record kind, an extra or missing field, a missing terminal record, and a result that disagrees with its own stages. It also refuses any record that names a remote address other than the target, because the handoff is local and fetches no prompt, rule file, or score.

Read one back with:

```bash
node packages/dogfood/read-handoff.mjs path/to/handoff.jsonl
```

# Drive a recording from Playwright, without changing the application

This is the setup for a temporary investigation. The IIFE bundle in the package is the same file the guided investigation injects. Playwright's `addInitScript` runs it before the application's first script, so canvas-scan observes every canvas from the start, and nothing in the application's code or build changes. `canvas-scan init --write` is not needed.

Get the IIFE without touching the repository by unpacking the published tarball in a scratch directory:

```bash
mkdir -p /tmp/canvas-scan && cd /tmp/canvas-scan && npm pack canvas-scan && tar -xzf canvas-scan-*.tgz
# IIFE: /tmp/canvas-scan/package/dist/canvas-scan.iife.js
```

Or use `node_modules/canvas-scan/dist/canvas-scan.iife.js` from an install.

```ts
// record.mjs: node record.mjs <build-tag> <runs>
import fs from 'node:fs';
import { chromium } from 'playwright';

const IIFE = '/tmp/canvas-scan/package/dist/canvas-scan.iife.js';
const [tag = 'baseline', runs = '5'] = process.argv.slice(2);
fs.mkdirSync('canvas-scan-runs', { recursive: true });

const browser = await chromium.launch();
for (let run = 1; run <= Number(runs); run++) {
  const context = await browser.newContext(); // a fresh context per run
  await context.addInitScript({ path: IIFE }); // before every application script
  const page = await context.newPage();
  await page.goto('http://localhost:5173/chart');
  await page.evaluate(() => __CANVAS_SCAN__.hideOverlay()); // keep the overlay from taking clicks
  await page.evaluate(() => __CANVAS_SCAN__.startRecording());
  await page.getByRole('button', { name: 'Zoom' }).click(); // the one bounded interaction
  const session = await page.evaluate(() => __CANVAS_SCAN__.stopRecording());
  const file = `canvas-scan-runs/${tag}-run-${run}.json`;
  if (fs.existsSync(file)) throw new Error(`${file} exists; pick a new tag rather than replace it`);
  fs.writeFileSync(file, JSON.stringify(session));
  await context.close(); // canvas-scan leaves with the context
}
await browser.close();
```

`stopRecording()` returns the session synchronously. Each session goes to a file named for its build and run, so the candidate never overwrites the baseline. Record each build several times and compare the spread; one session per build is one sample.

The overlay opens its results panel when a recording stops, and that panel takes pointer events. `hideOverlay()` takes the overlay out of the layout, so clicks reach the page; recording keeps working. To record with no overlay at all, run `context.addInitScript(() => { window.__CANVAS_SCAN_OPTS = { overlay: false }; })` before the IIFE.

To clean up, close the context and delete the scratch directory. The application never changed, so there is nothing to revert.

Timings from these runs include canvas-scan's own overhead. Measure user latency in a separate context without the `addInitScript`. See [Overhead](https://github.com/yomete/canvas-scan/blob/main/docs/overhead.md).
