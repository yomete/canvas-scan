import {
  getDisplayName,
  getFiberFromHostInstance,
  isCompositeFiber,
} from 'bippy';
import type { AttributionKind } from './types';

type FiberNode = NonNullable<ReturnType<typeof getFiberFromHostInstance>>;

// Library-internal wrappers to skip when a user-owned composite exists above
// them (react-konva's StageWrap/Stage to start). Skipping must never turn a
// named owner into null — the nearest named composite is the fallback.
const skippedOwners = new Set(['StageWrap', 'Stage']);

export function addSkippedOwners(names: readonly string[]): void {
  for (const name of names) skippedOwners.add(name);
}

function findOwner(fiber: FiberNode): {
  name: string | null;
  hasComposite: boolean;
} {
  let fallback: string | null = null;
  let hasComposite = false;
  for (let current: FiberNode | null = fiber; current; current = current.return) {
    if (!isCompositeFiber(current)) continue;
    hasComposite = true;
    const name = getDisplayName(current.type);
    if (!name) continue;
    fallback ??= name;
    // 1-2 char names are minified library internals (library dist code is
    // bundled; user components in dev builds keep their real names)
    if (!skippedOwners.has(name) && name.length > 2) {
      return { name, hasComposite: true };
    }
  }
  return { name: fallback, hasComposite };
}

export function resolveAttribution(canvas: any): {
  nearestReactOwner: string | null;
  attributionKind: AttributionKind;
} {
  try {
    const fiber = getFiberFromHostInstance(canvas);
    if (fiber) {
      const owner = findOwner(fiber);
      if (fiber.stateNode === canvas) {
        return owner.hasComposite
          ? { nearestReactOwner: owner.name, attributionKind: 'jsx-owner' }
          : { nearestReactOwner: 'canvas', attributionKind: 'direct-host' };
      }
      return {
        nearestReactOwner: owner.name,
        attributionKind: 'container-only',
      };
    }

    // Imperatively appended canvases (react-konva, pixi) carry no fiber stamp;
    // the nearest React-managed ancestor is the best truthful attribution.
    for (let el = canvas.parentElement; el; el = el.parentElement) {
      const hostFiber = getFiberFromHostInstance(el);
      if (!hostFiber) continue;
      const owner = findOwner(hostFiber);
      return {
        nearestReactOwner: owner.name,
        attributionKind: 'container-only',
      };
    }

    return { nearestReactOwner: null, attributionKind: 'unattributed' };
  } catch {
    return { nearestReactOwner: null, attributionKind: 'unattributed' };
  }
}
