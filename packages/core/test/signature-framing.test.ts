import { describe, expect, it } from 'vitest';

import { trackBuild } from '../src/build-registry';
import {
  captureOp,
  captureSet,
  newWindowSignature,
} from '../src/signature';

function hashOf(
  ops: Array<
    ['op', string, unknown[]] | ['set', string, unknown]
  >,
): number {
  const signature = newWindowSignature();

  for (const entry of ops) {
    if (entry[0] === 'op') {
      captureOp(signature, entry[1], entry[2]);
    } else {
      captureSet(signature, entry[1], entry[2]);
    }
  }

  return signature.hash;
}

describe('signature framing', () => {
  it('separates concatenated numeric arguments', () => {
    expect(hashOf([['op', 'fillRect', [1, 23, 4, 5]]])).not.toBe(
      hashOf([['op', 'fillRect', [12, 3, 4, 5]]]),
    );
  });

  it('separates string boundaries', () => {
    expect(hashOf([['op', 'fillText', ['ab', 'c']]])).not.toBe(
      hashOf([['op', 'fillText', ['a', 'bc']]]),
    );
  });

  it('separates numbers from strings', () => {
    expect(hashOf([['op', 'fillRect', [5]]])).not.toBe(
      hashOf([['op', 'fillRect', ['5']]]),
    );
  });

  it('separates method names from arguments', () => {
    expect(hashOf([['op', 'fill', ['Rect']]])).not.toBe(
      hashOf([['op', 'fillRect', []]]),
    );
  });

  it('separates arity shifts across adjacent operations', () => {
    expect(
      hashOf([
        ['op', 'moveTo', [1, 2, 3]],
        ['op', 'lineTo', [4]],
      ]),
    ).not.toBe(
      hashOf([
        ['op', 'moveTo', [1, 2]],
        ['op', 'lineTo', [3, 4]],
      ]),
    );
  });

  it('separates array element boundaries', () => {
    expect(hashOf([['op', 'setLineDash', [[1, 23]]]])).not.toBe(
      hashOf([['op', 'setLineDash', [[12, 3]]]]),
    );
  });

  it('separates array boundaries across adjacent operations', () => {
    expect(
      hashOf([
        ['op', 'setLineDash', [[1, 2]]],
        ['op', 'setLineDash', [[3]]],
      ]),
    ).not.toBe(
      hashOf([
        ['op', 'setLineDash', [[1]]],
        ['op', 'setLineDash', [[2, 3]]],
      ]),
    );
  });

  it('separates empty strings, null, and undefined', () => {
    const empty = hashOf([['op', 'fillText', ['']]]);
    const nullValue = hashOf([['op', 'fillText', [null]]]);
    const undefinedValue = hashOf([['op', 'fillText', [undefined]]]);

    expect(empty).not.toBe(nullValue);
    expect(empty).not.toBe(undefinedValue);
    expect(nullValue).not.toBe(undefinedValue);
  });

  it('separates setters from operations', () => {
    expect(hashOf([['set', 'fillStyle', 'red']])).not.toBe(
      hashOf([['op', 'fillStyle', ['red']]]),
    );
  });

  it('preserves equality for identical streams', () => {
    const ops: Array<['op', string, unknown[]]> = [
      ['op', 'beginPath', []],
      ['op', 'fillRect', [1, 2, 3, 4]],
    ];

    expect(hashOf(ops)).toBe(hashOf(ops));
  });

  it.each([
    [10.001, 10.0009],
    [0.3, 0.30000000000000004],
  ])('preserves quantization equality for %s and %s', (first, second) => {
    expect(hashOf([['op', 'fillRect', [first]]])).toBe(
      hashOf([['op', 'fillRect', [second]]]),
    );
  });

  it('preserves differences at two decimal places', () => {
    expect(hashOf([['op', 'fillRect', [10.01]]])).not.toBe(
      hashOf([['op', 'fillRect', [10.02]]]),
    );
  });

  it('separates tracked build tokens from spoofed strings', () => {
    class Path2D {}

    const path = new Path2D();
    const build = newWindowSignature();
    captureOp(build, 'rect', [1, 2, 3, 4]);
    trackBuild(path, build);

    expect(hashOf([['op', 'stroke', [path]]])).not.toBe(
      hashOf([['op', 'stroke', [`Path2D#${build.hash}`]]]),
    );
  });
});
