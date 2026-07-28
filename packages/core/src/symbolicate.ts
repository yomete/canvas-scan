import { getOwnerStack, symbolicateStack } from 'bippy/source';
import { findOwnerFiber } from './attribution';
import type { SourceLocation } from './types';

const sourceLocations = new WeakMap<
  object,
  Promise<SourceLocation | null>
>();

async function resolveUncached(canvas: object): Promise<SourceLocation | null> {
  try {
    const owner = findOwnerFiber(canvas);
    if (!owner) return null;

    const stack = await getOwnerStack(owner);
    const symbolicatedStack = await symbolicateStack(stack);
    const frame = symbolicatedStack.find(
      item =>
        typeof item.fileName === 'string' &&
        item.fileName.length > 0 &&
        typeof item.lineNumber === 'number',
    );
    if (!frame?.fileName || frame.lineNumber === undefined) return null;

    return {
      file: frame.fileName,
      line: frame.lineNumber,
      column: frame.columnNumber ?? 0,
    };
  } catch {
    return null;
  }
}

export async function resolveSourceLocation(
  canvas: unknown,
): Promise<SourceLocation | null> {
  if (
    (typeof canvas !== 'object' || canvas === null) &&
    typeof canvas !== 'function'
  ) {
    return null;
  }

  const cached = sourceLocations.get(canvas);
  if (cached) return cached;

  const location = resolveUncached(canvas);
  sourceLocations.set(canvas, location);
  return location;
}
