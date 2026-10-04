# Investigate a URL

Back to the [README](https://github.com/yomete/canvas-scan#readme).

Run one guided investigation against a page you do not control:

```bash
node packages/dogfood/investigate-url.mjs --url=https://example.com
```

The command opens Chrome on that URL with canvas-scan installed before the first application script. Drive the overlay yourself: record, explain, keep a baseline, record a candidate, compare. Close the browser window when you finish. The command writes every artifact you produced, and a report of what it observed, to a directory it names on exit.

The command accepts one `http` or `https` URL. It refuses any other scheme, and it refuses two targets. Add `--out=DIR` to choose the directory. Add `--timeout=MINUTES` to change the one-hour limit.

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

# Drive a recording from Playwright

The IIFE bundle in the package is the same file the guided investigation injects. Load it before the application scripts, then call the recording API from the test. `stopRecording()` returns the session synchronously.

```ts
await page.addInitScript({ path: 'node_modules/canvas-scan/dist/canvas-scan.iife.js' });
await page.goto('http://localhost:5173/chart');
await page.evaluate(() => __CANVAS_SCAN__.startRecording());
await page.getByRole('button', { name: 'Zoom' }).click(); // drive the page
const session = await page.evaluate(() => __CANVAS_SCAN__.stopRecording());
fs.writeFileSync('session.json', JSON.stringify(session));
```
