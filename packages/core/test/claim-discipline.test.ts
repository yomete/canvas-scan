import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Rev 2 claim discipline (HANDOFF.md): user-facing copy must never assert
// waste, pixel identity, identical output, or repaint cost. Disclaimer lines
// that explicitly NEGATE a claim are allowed.
const FORBIDDEN = [
  /\bwasted\b/i,
  /identical redraw/i,
  /pixel-?identical/i,
  /repaint cost/i,
];
const OVERLAY_FORBIDDEN = [...FORBIDDEN, /\bavoidable\b/i];
const DISCLAIMER = /does not claim|never claims/i;
const FINDING_FORBIDDEN = [
  /\bGPU time\b/i,
  /\brender time\b/i,
  /\bcaused by\b/i,
  /\bwasted\b/i,
  /\bavoidable work\b/i,
];
const FINDING_DISCLAIMER = /does not establish/i;
const ASSOCIATION_FORBIDDEN = /\b(caused|causes|triggered|responsible for)\b/i;

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');

function offendingLines(text: string): string[] {
  return text
    .split('\n')
    .filter((line) => !DISCLAIMER.test(line))
    .filter((line) => FORBIDDEN.some((pattern) => pattern.test(line)));
}

function overlayOffendingLines(text: string): string[] {
  return text
    .split('\n')
    .filter((line) => !DISCLAIMER.test(line))
    .filter((line) => OVERLAY_FORBIDDEN.some((pattern) => pattern.test(line)));
}

describe('claim discipline', () => {
  it('keeps heavy-work copy within the measured claim boundary', () => {
    const source = readFileSync(join(packageDir, 'src/recording.ts'), 'utf8');
    const findings = source
      .split('\n')
      .filter((line) => !FINDING_DISCLAIMER.test(line))
      .filter((line) => FINDING_FORBIDDEN.some((pattern) => pattern.test(line)));
    expect(findings).toEqual([]);
    expect(source).toContain('Canvas2D API self-time');
    expect(source).toContain('does not establish GPU time');
  });

  it('keeps forbidden claims out of the overlay copy', () => {
    const source = readFileSync(join(packageDir, 'src/overlay.ts'), 'utf8');
    expect(overlayOffendingLines(source)).toEqual([]);
    expect(source).toContain('near-identical frames');
    expect(source).toMatch(/review /);
  });

  it('keeps browser evidence and association copy non-causal', () => {
    for (const file of ['src/browser-evidence.ts', 'src/recording.ts', 'src/overlay.ts']) {
      const source = readFileSync(join(packageDir, file), 'utf8');
      expect(source.split('\n').filter(line => ASSOCIATION_FORBIDDEN.test(line))).toEqual([]);
    }
    expect(readFileSync(join(packageDir, 'src/overlay.ts'), 'utf8')).not.toContain('associated with');
  });

  it('keeps forbidden claims out of the package description', () => {
    const manifest = JSON.parse(
      readFileSync(join(packageDir, 'package.json'), 'utf8'),
    );
    expect(offendingLines(manifest.description)).toEqual([]);
  });

  it('keeps forbidden claims out of both READMEs', () => {
    for (const file of [
      join(packageDir, 'README.md'),
      join(packageDir, '../../README.md'),
    ]) {
      expect(offendingLines(readFileSync(file, 'utf8'))).toEqual([]);
    }
  });
});
