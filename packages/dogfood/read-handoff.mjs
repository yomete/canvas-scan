// A clean consumer of the agent handoff.
//
// It reads one file and nothing else: no overlay text, no browser, no runtime
// state, no network. Everything it prints comes from records the validator has
// already accepted. This exists so the format's claim — that an agent can act
// on an investigation without being in the room for it — is demonstrated rather
// than asserted.
//
// Usage: node read-handoff.mjs path/to/handoff.jsonl
import { readFileSync } from 'node:fs';
import { parseJson, parseJsonl } from './agent-handoff.mjs';

export function summarize(records) {
  const of = kind => records.filter(record => record.kind === kind);
  const [metadata] = of('metadata');
  const [result] = of('result');
  const findings = of('finding');
  const limits = of('limit');
  const lines = [];

  lines.push(`${metadata.tool} ${metadata.toolVersion ?? 'unknown version'} on ${metadata.target}`);
  lines.push(`run ${result.status}${result.incompleteStages.length ? ` — did not finish: ${result.incompleteStages.join(', ')}` : ''}`);
  for (const note of result.notes) lines.push(`  note: ${note}`);

  const { unknownWindowCount, activeWindowCount, summaryOnlyCanvasCount } = metadata.completeness;
  lines.push(`coverage: ${activeWindowCount} frames recorded, ${unknownWindowCount} could not be compared${summaryOnlyCanvasCount ? `, ${summaryOnlyCanvasCount} canvases kept as a summary only` : ''}`);
  for (const limit of limits) lines.push(`  dropped: ${limit.droppedCount} ${limit.name} (${limit.scope})`);

  if (findings.length === 0) lines.push('no findings');
  for (const finding of findings) {
    lines.push('');
    lines.push(`${finding.rank}. ${finding.type} · ${finding.owner ?? 'unattributed'} · ${finding.canvasApiSelfTimeMs} ms · ${finding.evidenceLevel}`);
    lines.push(`   observed: ${finding.claimBoundary.observation}`);
    // Printed with the finding, never separately. A reader who sees the claim
    // has already seen what it does not establish.
    lines.push(`   not established: ${finding.claimBoundary.nonEstablishedFacts}`);
    lines.push(`   unknown: ${finding.unknownCoverage.unknownWindowCount} of ${finding.unknownCoverage.activeWindowCount} frames`);
    lines.push(`   next check: ${finding.nextCheck}`);
  }

  for (const comparison of of('comparison')) {
    lines.push('');
    lines.push(`comparison ${comparison.status}: ${comparison.measureCount} measures${comparison.incomparableReasons.length ? ` — ${comparison.incomparableReasons.join(', ')}` : ''}`);
    lines.push(`   improvement established: ${comparison.improvementEstablished}`);
  }
  return lines.join('\n');
}

export function readHandoff(file) {
  const text = readFileSync(file, 'utf8');
  return file.endsWith('.jsonl') ? parseJsonl(text) : parseJson(text);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file] = process.argv.slice(2);
  if (!file) { console.error('usage: node read-handoff.mjs path/to/handoff.jsonl'); process.exit(2); }
  console.log(summarize(readHandoff(file)));
}
