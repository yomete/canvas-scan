import { getOwnerStack } from 'bippy/source';
import { findOwnerFiberForCanvas } from './attribution';
import type { SourceLocation } from './types';

const sourceLocations = new WeakMap<
  object,
  Promise<SourceOutcome>
>();

export type SourceOutcome =
  | { kind: 'found'; location: SourceLocation }
  | { kind: 'unavailable' }
  | { kind: 'error' };

async function resolveUncached(canvas: object): Promise<SourceOutcome> {
  try {
    const owner = findOwnerFiberForCanvas(canvas);
    if (!owner) return { kind: 'unavailable' };

    const stack = await getOwnerStack(owner);
    const frame = stack.find(
      item =>
        typeof item.fileName === 'string' &&
        item.fileName.length > 0 &&
        typeof item.lineNumber === 'number',
    );
    if (!frame?.fileName || frame.lineNumber === undefined) {
      return { kind: 'unavailable' };
    }

    return {
      kind: 'found',
      location: {
        file: frame.fileName,
        line: frame.lineNumber,
        column: frame.columnNumber ?? 0,
      },
    };
  } catch {
    return { kind: 'error' };
  }
}

export async function resolveSourceOutcome(
  canvas: unknown,
): Promise<SourceOutcome> {
  if (
    (typeof canvas !== 'object' || canvas === null) &&
    typeof canvas !== 'function'
  ) {
    return { kind: 'unavailable' };
  }

  const cached = sourceLocations.get(canvas);
  if (cached) return cached;

  const outcome = resolveUncached(canvas).then(result => {
    if (result.kind === 'error') sourceLocations.delete(canvas);
    return result;
  });
  sourceLocations.set(canvas, outcome);
  return outcome;
}

export async function resolveSourceLocation(
  canvas: unknown,
): Promise<SourceLocation | null> {
  const outcome = await resolveSourceOutcome(canvas);
  return outcome.kind === 'found' ? outcome.location : null;
}
