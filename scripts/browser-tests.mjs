// End-to-end checks that run the real overlay in a real browser.
//
// These exist because the unit suite cannot see any of it. Every finding in
// the 2026-08-26 triage sweep was written by reading source, and two of the
// forty-seven were wrong for exactly that reason: findings were already
// ranked, and Keep as baseline already kept the right session. Both are
// asserted here so the next reader does not have to take the code's word for
// it. The rest cover behaviour that only exists once frames are running —
// retirement, the commit loop, sampling, the timing of instrumented calls.
//
// Run: node scripts/browser-tests.mjs   (needs apps/demo/dist to be built)
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch, serve } from './browser-driver.mjs';

const DIST = fileURLToPath(new URL('../apps/demo/dist', import.meta.url));
if (!existsSync(DIST)) {
  console.error('apps/demo/dist is missing. Run: pnpm --filter demo run build');
  process.exit(1);
}

const checks = [];
const check = (name, page, body) => checks.push({ name, page, body });

// Shared page helpers, injected ahead of every check body.
const HELPERS = `
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const shadow = document.querySelector('[data-canvas-scan]').shadowRoot;
  const api = window.__CANVAS_SCAN__;
  const openFlyout = async () => {
    if (shadow.querySelector('.flyout').hidden) shadow.querySelector('.counts').click();
    await wait(400);
  };
  const plainText = card => {
    const copy = card.cloneNode(true);
    copy.querySelectorAll('.finding-boundary').forEach(n => n.remove());
    return copy.textContent;
  };
  // Readbacks are genuinely slow, so the per-episode 8 ms heavy-work gate is
  // crossed for real rather than by a contrived number.
  const burnFrame = ctx => {
    for (let i = 0; i < 120; i++) ctx.fillRect((i % 60) * 10, (i % 30) * 10, 8, 8);
    for (let i = 0; i < 50; i++) ctx.getImageData(0, 0, 600, 300);
  };
  const heavyCanvas = () => {
    const canvas = document.getElementById('ritual-canvas');
    canvas.width = 600; canvas.height = 300;
    return canvas.getContext('2d');
  };
  const recordHeavy = async (frames = 8) => {
    const ctx = heavyCanvas();
    shadow.querySelector('.record').click();
    await wait(200);
    for (let f = 0; f < frames; f++) { burnFrame(ctx); await wait(30); }
    shadow.querySelector('.stop-recording').click();
    await wait(700);
  };
`;

// ---------------------------------------------------------------- overlay basics
check('overlay mounts and stays quiet on the console', 'index', `
  return {
    mounted: !!shadow,
    version: api.version,
    counts: shadow.querySelector('.counts').textContent,
  };
`, );

check('instrumented readbacks are counted and timed', 'index', `
  const canvas = document.createElement('canvas');
  canvas.width = 300; canvas.height = 150;
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  shadow.querySelector('.record').click();
  await wait(200);
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 100; i++) ctx.getImageData(0, 0, 40, 40);
    for (let i = 0; i < 100; i++) ctx.measureText('a fairly long string to measure');
    await wait(50);
  }
  shadow.querySelector('.stop-recording').click();
  await wait(700);
  const summary = api.getLastSession().canvases.find(c => c.canvasId.startsWith('canvas:'));
  canvas.remove();
  return {
    wrapped: !/native code/.test(CanvasRenderingContext2D.prototype.getImageData.toString()),
    getImageDataCount: summary?.methodEvidence?.getImageData?.count ?? 0,
    measureTextCount: summary?.methodEvidence?.measureText?.count ?? 0,
    rasterOperationCount: summary?.rasterOperationCount,
    selfTimeAboveZero: (summary?.canvasApiSelfTimeMs ?? 0) > 0,
  };
`);

// ---------------------------------------------------------------- finding cards
check('a heavy card labels both spans and reaches the top methods', 'index', `
  await recordHeavy();
  await openFlyout();
  const session = api.getLastSession();
  const heavy = session.findings.find(f => f.type === 'heavy-canvas-work');
  const card = [...shadow.querySelectorAll('.finding-card')]
    .find(c => c.querySelector('.finding-toggle').textContent.includes('Heavy frame'));
  const boundary = card?.querySelector('.finding-boundary');
  return {
    heavyFound: !!heavy,
    summaryLine: plainText(card).match(/Slowest frame [^\\n]*?draw calls/)?.[0] ?? null,
    namesBothSpans: /Slowest frame .* · this episode /.test(plainText(card)),
    boundaryClosed: boundary?.open === false,
    boundaryHasEvidenceLevel: /Evidence level: candidate/.test(boundary?.textContent ?? ''),
    boundaryHasNotEstablished: /Not established:/.test(boundary?.textContent ?? ''),
    boundaryHasNextCheck: /Next check:/.test(boundary?.textContent ?? ''),
    boundaryHasTopMethods: /Top measured methods:/.test(boundary?.textContent ?? ''),
    plainCopyStaysPlain: !/review candidate/i.test(plainText(card)),
  };
`);

check('findings are ranked by measured self-time across types', 'index', `
  // The triage claimed this was broken. It was not, and nothing guarded it.
  const orphan = document.createElement('canvas');
  orphan.width = 800; orphan.height = 400;
  orphan.style.width = '200px'; orphan.style.height = '100px';
  document.body.append(orphan);
  const light = orphan.getContext('2d');
  const ctx = heavyCanvas();
  shadow.querySelector('.record').click();
  await wait(200);
  for (let f = 0; f < 8; f++) {
    for (let i = 0; i < 20; i++) light.fillRect((i % 10) * 8, 4, 6, 6);
    burnFrame(ctx);
    await wait(30);
  }
  shadow.querySelector('.stop-recording').click();
  await wait(700);
  const session = api.getLastSession();
  const selfTimes = session.findings.map(f => f.canvasApiSelfTimeMs);
  orphan.remove();
  return {
    findingCount: session.findings.length,
    typeCount: new Set(session.findings.map(f => f.type)).size,
    selfTimes,
    isDescending: selfTimes.every((v, i) => i === 0 || selfTimes[i - 1] >= v),
  };
`);

// ---------------------------------------------------------------- the quiet tail
check('findings with no measured time collapse behind a count', 'index', `
  // A real application that is already fast produces findings that are true
  // and cost nothing. They stay in the artifact and keep their rank; they just
  // stop padding the list. This draws two rectangles a frame on a light canvas
  // — enough raster operations to repeat, not enough to measure — alongside
  // the heavy canvas, so the list has both a top and a tail.
  const quiet = document.createElement('canvas');
  quiet.width = 200; quiet.height = 100;
  document.body.append(quiet);
  const light = quiet.getContext('2d');
  const ctx = heavyCanvas();
  shadow.querySelector('.record').click();
  await wait(200);
  for (let f = 0; f < 8; f++) {
    light.fillRect(4, 4, 6, 6);
    light.fillRect(20, 4, 6, 6);
    burnFrame(ctx);
    await wait(30);
  }
  shadow.querySelector('.stop-recording').click();
  await wait(700);
  await openFlyout();
  const session = api.getLastSession();
  const group = shadow.querySelector('.finding-quiet');
  const rankedCards = [...shadow.querySelectorAll('.findings-list > .finding-card')];
  const quietCards = [...(group?.querySelectorAll('.finding-card') ?? [])];
  quiet.remove();
  return {
    findingsInArtifact: session.findings.length,
    zeroInArtifact: session.findings.filter(f => f.canvasApiSelfTimeMs === 0).length,
    measuredInArtifact: session.findings.filter(f => f.canvasApiSelfTimeMs > 0).length,
    groupPresent: !!group,
    groupClosed: group ? !group.open : null,
    groupSummary: group?.querySelector('summary')?.textContent ?? null,
    rankedCardCount: rankedCards.length,
    quietCardCount: quietCards.length,
    // Every card is still numbered by its place in the ranking, so a number
    // read off the interface still finds the same finding in the JSON.
    cardNumbers: [...rankedCards, ...quietCards].map(c => Number(c.dataset.findingIndex)),
    quietCardsAreAllZero: quietCards.every(c => session.findings[Number(c.dataset.findingIndex)]?.canvasApiSelfTimeMs === 0),
  };
`);

// ---------------------------------------------------------------- the commit loop
check('a finding card reacts when its canvas leaves the page', 'index', `
  await recordHeavy();
  const card = () => shadow.querySelector('.finding-card');
  const state = () => ({
    unavailableHidden: card()?.querySelector('.finding-unavailable')?.hidden,
    actionsHidden: card()?.querySelector('.finding-actions')?.hidden,
  });
  const before = state();
  const canvas = document.getElementById('ritual-canvas');
  const parent = canvas.parentNode;
  const next = canvas.nextSibling;
  canvas.remove();
  await wait(900);
  const afterRemoval = state();
  parent.insertBefore(canvas, next);
  await wait(900);
  return { before, afterRemoval, afterReinsert: state() };
`);

check('a retired canvas is marked rather than left looking live', 'index', `
  const canvas = document.createElement('canvas');
  canvas.width = 100; canvas.height = 50;
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  for (let f = 0; f < 4; f++) { ctx.fillRect(0, 0, 10, 10); ctx.fillRect(12, 0, 10, 10); await wait(60); }
  await openFlyout();
  const row = () => [...shadow.querySelectorAll('.row')].find(r => r.dataset.canvasId?.startsWith('canvas:'));
  const before = { text: row()?.textContent, stale: row()?.classList.contains('stale') };
  // 120 quiet boundaries retires it, which is about two seconds at 60 fps.
  await wait(3500);
  const afterQuiet = { text: row()?.textContent, stale: row()?.classList.contains('stale') };
  ctx.fillRect(0, 0, 10, 10); ctx.fillRect(12, 0, 10, 10);
  await wait(700);
  const afterRedraw = { stale: row()?.classList.contains('stale') };
  canvas.remove();
  return {
    beforeSaysStopped: /stopped drawing/.test(before.text ?? ''),
    beforeStale: before.stale,
    afterQuietSaysStopped: /stopped drawing/.test(afterQuiet.text ?? ''),
    afterQuietStale: afterQuiet.stale,
    afterRedrawStale: afterRedraw.stale,
  };
`);

// ---------------------------------------------------------------- live counts
check('the counter uses two labels and names the canvas ceiling', 'index', `
  const live = shadow.querySelector('.counts').textContent;
  const made = [];
  for (let i = 0; i < 70; i++) {
    const c = document.createElement('canvas');
    c.width = 40; c.height = 20;
    document.body.append(c); made.push(c);
    const x = c.getContext('2d');
    x.fillRect(0, 0, 5, 5); x.fillRect(6, 0, 5, 5);
  }
  await wait(1600);
  const counter = shadow.querySelector('.canvas-count');
  const result = {
    liveLabelIsNotReviewCandidates: !/review candidate/.test(live),
    countText: counter.textContent,
    namesTheCeiling: /\\(\\+\\d+ not tracked\\)/.test(counter.textContent),
    titleExplains: /at most 64 canvases/.test(counter.title),
    trackedCanvases: Object.keys(api.getReports()).length,
  };
  made.forEach(c => c.remove());
  return result;
`);

// ---------------------------------------------------------------- keyboard
check('Escape acts only while focus is inside the overlay', 'index', `
  await recordHeavy(3);
  await openFlyout();
  const open = () => !shadow.querySelector('.flyout').hidden;
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(400);
  const afterOutside = open();
  shadow.querySelector('.row')?.focus();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(400);
  const afterInside = open();
  input.remove();
  return { afterOutside, afterInside };
`);

// ---------------------------------------------------------------- baseline
check('keeping a baseline after an explanation keeps the investigated session', 'index', `
  // The other triage entry that turned out to be wrong. getLastSession()
  // moves to the explanation's follow-up while the panel keeps showing the
  // session under investigation, and the control must follow the panel.
  await recordHeavy();
  await openFlyout();
  const investigated = api.getLastSession().sessionId;
  const explain = shadow.querySelector('.explanation-action');
  if (!explain || explain.hidden) return { skipped: 'no explanation action' };
  explain.click();
  await wait(400);
  const ctx = heavyCanvas();
  for (let f = 0; f < 6; f++) { burnFrame(ctx); await wait(30); }
  shadow.querySelector('.stop-recording').click();
  await wait(900);
  const followUp = api.getLastSession().sessionId;
  await openFlyout();
  const keep = shadow.querySelector('.baseline-action');
  return {
    followUpDiffers: followUp !== investigated,
    controlTargetsInvestigated: keep?.dataset.sessionId === investigated,
  };
`);

// ---------------------------------------------------------------- sampling
check('a sampled recording keeps its totals and its grouping', 'sampling', `
  const fixture = window.__SAMPLING_FIXTURE__;
  shadow.querySelector('.record').click();
  await wait(200);
  fixture.draw(40);
  await wait(1500);
  shadow.querySelector('.stop-recording').click();
  await wait(700);
  const session = api.getLastSession();
  const indices = session.windows.map(w => w.windowIndex);
  const gaps = indices.slice(1).map((v, i) => v - indices[i]);
  return {
    captureEveryInArtifact: session.captureEvery,
    reportedWindows: session.windows.length,
    everyGapMatchesTheRate: gaps.every(g => g === fixture.captureEvery),
    coversMoreThanOneWindow: session.windows.every(w => w.coveredWindowCount >= 1)
      && session.windows.some(w => w.coveredWindowCount > 1),
    // A fixed three-index break would make every reported window its own
    // episode. The gap scales with the rate, so they stay one episode.
    episodes: session.episodes.length,
    rasterCaptured: session.canvases[0]?.rasterOperationCount ?? 0,
  };
`);

// ---------------------------------------------------------------- injection
// Runs against a blank page with the IIFE bundle installed at document-start,
// so it needs neither the demo nor its helpers.
const IIFE = fileURLToPath(new URL('../packages/core/dist/canvas-scan.iife.js', import.meta.url));
const injectionCheck = {
  name: 'installs from a document-start injection without losing the API',
  body: `
    return {
      readyStateAtInjection: window.__INJECT_PROBE__?.readyState ?? null,
      hadDocumentElement: window.__INJECT_PROBE__?.hasDocElement ?? null,
      installed: !!window.__CANVAS_SCAN__,
      overlayMounted: !!document.querySelector('[data-canvas-scan]'),
      getContextWrapped: !/native code/.test(HTMLCanvasElement.prototype.getContext.toString()),
    };
  `,
  expect: r => [
    // If the document element already existed the case under test did not
    // happen, and a pass would mean nothing.
    [r.hadDocumentElement === false, `injection ran too late to test anything (readyState ${r.readyStateAtInjection})`],
    [r.getContextWrapped === true, 'the canvas patch did not install'],
    [r.installed === true, 'the prototypes were patched but no API was installed — all of the overhead, none of the tool'],
    [r.overlayMounted === true, 'the overlay never mounted once the document arrived'],
  ],
};

// ---------------------------------------------------------------- runner
const EXPECTATIONS = {
  'overlay mounts and stays quiet on the console': r => [
    [r.mounted === true, 'overlay did not mount'],
    [typeof r.version === 'string', 'no version on the global'],
    [/canvases/.test(r.counts), `unexpected counter text: ${r.counts}`],
  ],
  'instrumented readbacks are counted and timed': r => [
    [r.wrapped === true, 'getImageData is still native'],
    [r.getImageDataCount >= 500, `getImageData count was ${r.getImageDataCount}`],
    [r.measureTextCount >= 500, `measureText count was ${r.measureTextCount}`],
    [r.rasterOperationCount === 0, `neither call draws, so raster should be 0, was ${r.rasterOperationCount}`],
    [r.selfTimeAboveZero === true, 'no self-time was measured'],
  ],
  'findings with no measured time collapse behind a count': r => [
    // Without both halves the check proves nothing: an all-measured run never
    // builds the group, and an all-empty run never proves the top survives.
    [r.measuredInArtifact > 0, 'the workload produced no measured finding, so there was no ranked list to preserve'],
    [r.zeroInArtifact > 0, 'the workload produced no zero-time finding, so the collapse was never exercised'],
    [r.groupPresent === true, 'the zero-time findings were not collapsed'],
    [r.groupClosed === true, 'the group should start closed'],
    [r.groupSummary === `${r.zeroInArtifact} more findings with no measured time`
      || r.groupSummary === `${r.zeroInArtifact} more finding with no measured time`,
      `the count is wrong: ${r.groupSummary} for ${r.zeroInArtifact} zero-time findings`],
    [r.rankedCardCount === r.measuredInArtifact, `${r.rankedCardCount} cards above the group, ${r.measuredInArtifact} measured findings`],
    [r.quietCardCount === r.zeroInArtifact, `${r.quietCardCount} cards inside the group, ${r.zeroInArtifact} zero-time findings`],
    [r.quietCardsAreAllZero === true, 'a finding with measured time was collapsed'],
    [r.cardNumbers.join(',') === r.cardNumbers.map((_, i) => i).join(','),
      `card numbering no longer matches the artifact order: ${r.cardNumbers.join(',')}`],
    [r.findingsInArtifact === r.rankedCardCount + r.quietCardCount, 'a finding was dropped from the list'],
  ],
  'a heavy card labels both spans and reaches the top methods': r => [
    [r.heavyFound === true, 'no heavy-canvas-work finding was produced'],
    [r.namesBothSpans === true, `the card did not name both spans: ${r.summaryLine}`],
    [r.boundaryClosed === true, 'the disclosure should start closed'],
    [r.boundaryHasEvidenceLevel === true, 'the disclosure omits the evidence level'],
    [r.boundaryHasNotEstablished === true, 'the disclosure omits the non-established facts'],
    [r.boundaryHasNextCheck === true, 'the disclosure omits the next check'],
    [r.boundaryHasTopMethods === true, 'the disclosure omits the top measured methods'],
    [r.plainCopyStaysPlain === true, 'the plain card copy leaked contract wording'],
  ],
  'findings are ranked by measured self-time across types': r => [
    [r.findingCount >= 2, `expected several findings, got ${r.findingCount}`],
    [r.typeCount >= 2, `expected more than one finding type, got ${r.typeCount}`],
    [r.isDescending === true, `findings were not ranked: ${JSON.stringify(r.selfTimes)}`],
  ],
  'a finding card reacts when its canvas leaves the page': r => [
    [r.before.unavailableHidden === true, 'the card claimed the canvas was gone while it was present'],
    [r.afterRemoval.unavailableHidden === false, 'the card did not notice the canvas leaving'],
    [r.afterRemoval.actionsHidden === true, 'the card still offered actions against a missing canvas'],
    [r.afterReinsert.unavailableHidden === true, 'the card did not notice the canvas returning'],
  ],
  'a retired canvas is marked rather than left looking live': r => [
    [r.beforeSaysStopped === false, 'a drawing canvas was marked as stopped'],
    [r.beforeStale === false, 'a drawing canvas was dimmed'],
    [r.afterQuietSaysStopped === true, 'a retired canvas was not marked'],
    [r.afterQuietStale === true, 'a retired canvas was not dimmed'],
    [r.afterRedrawStale === false, 'drawing again did not clear the mark'],
  ],
  'the counter uses two labels and names the canvas ceiling': r => [
    [r.liveLabelIsNotReviewCandidates === true, 'the live count still calls canvases review candidates'],
    [r.namesTheCeiling === true, `the counter hid the ceiling: ${r.countText}`],
    [r.titleExplains === true, 'the counter title does not explain the ceiling'],
    [r.trackedCanvases === 64, `expected 64 tracked canvases, got ${r.trackedCanvases}`],
  ],
  'Escape acts only while focus is inside the overlay': r => [
    [r.afterOutside === true, 'Escape from the host application closed the overlay'],
    [r.afterInside === false, 'Escape inside the overlay did not close the flyout'],
  ],
  'keeping a baseline after an explanation keeps the investigated session': r => [
    [r.skipped === undefined, `check could not run: ${r.skipped}`],
    [r.followUpDiffers === true, 'the explanation did not produce a follow-up session'],
    [r.controlTargetsInvestigated === true, 'the control targeted the follow-up session'],
  ],
  'a sampled recording keeps its totals and its grouping': r => [
    [r.captureEveryInArtifact === 3, `the artifact recorded captureEvery ${r.captureEveryInArtifact}`],
    [r.reportedWindows > 3, `too few reported windows: ${r.reportedWindows}`],
    [r.everyGapMatchesTheRate === true, 'reported window indices did not follow the sampling rate'],
    [r.coversMoreThanOneWindow === true, 'no reported window carried a skipped window with it'],
    [r.episodes === 1, `sampled grouping collapsed into ${r.episodes} episodes`],
    [r.rasterCaptured > 1200, `sampling discarded work: only ${r.rasterCaptured} raster operations survived`],
  ],
};

const { server, port } = await serve(DIST);
let failures = 0;
let ran = 0;

{
  const { name, body, expect } = injectionCheck;
  const initScript = `window.__INJECT_PROBE__ = { readyState: document.readyState, hasDocElement: !!document.documentElement };\n${readFileSync(IIFE, 'utf8')}`;
  // /__blank has no canvas-scan of its own, so nothing can stand in for the
  // injected copy if it fails.
  const browser = await launch(`http://127.0.0.1:${port}/__blank`, { initScript });
  try {
    const result = await browser.evaluate(body);
    const problems = expect(result).filter(([ok]) => !ok).map(([, message]) => message);
    ran++;
    if (problems.length) {
      failures++;
      console.log(`FAIL  ${name}`);
      for (const problem of problems) console.log(`        ${problem}`);
      console.log(`        result: ${JSON.stringify(result)}`);
    } else {
      console.log(`ok    ${name}`);
    }
  } catch (error) {
    failures++;
    ran++;
    console.log(`ERROR ${name}\n        ${error.message.split('\n')[0]}`);
  } finally {
    await browser.close();
  }
}

for (const { name, page, body } of checks) {
  const url = `http://127.0.0.1:${port}/${page === 'index' ? '' : page + '.html'}`;
  const browser = await launch(url);
  try {
    const result = await browser.evaluate(HELPERS + body);
    const problems = EXPECTATIONS[name](result).filter(([ok]) => !ok).map(([, message]) => message);
    // Nothing should reach the console at default settings.
    const noise = browser.consoleLines.filter(line => line.text.startsWith('[canvas-scan]'));
    if (noise.length) problems.push(`canvas-scan wrote ${noise.length} console lines: ${noise[0].text}`);
    ran++;
    if (problems.length) {
      failures++;
      console.log(`FAIL  ${name}`);
      for (const problem of problems) console.log(`        ${problem}`);
      console.log(`        result: ${JSON.stringify(result)}`);
    } else {
      console.log(`ok    ${name}`);
    }
  } catch (error) {
    failures++;
    ran++;
    console.log(`ERROR ${name}\n        ${error.message.split('\n')[0]}`);
  } finally {
    await browser.close();
  }
}

server.close();
console.log(`\n${ran - failures}/${ran} browser checks passed`);
process.exit(failures ? 1 : 0);
