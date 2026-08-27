import { getOwnerStack } from 'bippy/source';
import { findOwnerFiberForCanvas } from './attribution.js';
import { mapCreationSite } from './draw-callsite.js';
import { getRecord } from './wrap-context.js';
import type { SourceLocation } from './types.js';

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
    // No fiber anywhere above it: React never made this canvas, so there is no
    // owner stack to walk. The place the application asked for its context is
    // the only evidence there is, and mapping it through the application's own
    // source map is what turns app.min.js:1:48213 into a line somebody wrote.
    if (!owner) return creationSiteOutcome(canvas);

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

async function creationSiteOutcome(canvas: object): Promise<SourceOutcome> {
  const site = getRecord(canvas)?.creationSite;
  if (!site) return { kind: 'unavailable' };
  const mapped = await mapCreationSite(site);
  // An unmapped site is still a real place. Reporting the generated one beats
  // reporting nothing, and it is never dressed up as the developer's source.
  return { kind: 'found', location: mapped ?? site };
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

  // Only a resolved location is worth keeping. `unavailable` is often just
  // "the sourcemap was not ready yet", and an error is transient by
  // definition; caching either one pins a bad answer for the whole session.
  const outcome = resolveUncached(canvas).then(result => {
    if (result.kind !== 'found') sourceLocations.delete(canvas);
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
