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
const DISCLAIMER = /does not claim|never claims/i;

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');

function offendingLines(text: string): string[] {
  return text
    .split('\n')
    .filter((line) => !DISCLAIMER.test(line))
    .filter((line) => FORBIDDEN.some((pattern) => pattern.test(line)));
}

describe('claim discipline', () => {
  it('keeps forbidden claims out of the overlay copy', () => {
    const source = readFileSync(join(packageDir, 'src/overlay.ts'), 'utf8');
    expect(offendingLines(source)).toEqual([]);
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
