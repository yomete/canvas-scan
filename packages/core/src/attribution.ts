import {
  getDisplayName,
  getFiberFromHostInstance,
  isCompositeFiber,
} from 'bippy';
import type { AttributionKind } from './types.js';

type FiberNode = NonNullable<ReturnType<typeof getFiberFromHostInstance>>;

// Library-internal wrappers to skip when a user-owned composite exists above
// them (react-konva's StageWrap/Stage to start). Skipping must never turn a
// named owner into null — the nearest named composite is the fallback.
const skippedOwners = new Set(['StageWrap', 'Stage']);

export function addSkippedOwners(names: readonly string[]): void {
  for (const name of names) skippedOwners.add(name);
}

// A production bundle renames every symbol it can, and the result reads like a
// name without being one: Excalidraw's canvases resolved to `mRe`, `fRe` and
// `ERe`. React needs a capitalised binding for JSX, so a display name that does
// not start with a capital was never a component somebody wrote. A short name
// that does start with one is a word — App, Box, Nav — and a bundler's counter
// is not: `ERe` has its capital in the wrong place.
//
// The tail of this is a four-character minified name that happens to look like
// a word. That one gets through, and is reported as a name. The rule stays a
// rule about evidence rather than a guess about intent: what it decides is
// whether the tool may head a finding with the symbol, never whether the symbol
// is recorded.
export function looksMinified(name: string): boolean {
  if (name.length <= 3) return !/^[A-Z][a-z]+$/.test(name);
  return !/^[A-Z]/.test(name);
}

function findOwner(fiber: FiberNode): FiberNode | null {
  let compositeFallback: FiberNode | null = null;
  let namedFallback: FiberNode | null = null;
  let minifiedFallback: FiberNode | null = null;
  for (let current: FiberNode | null = fiber; current; current = current.return) {
    if (!isCompositeFiber(current)) continue;
    compositeFallback ??= current;
    const name = getDisplayName(current.type);
    if (!name) continue;
    namedFallback ??= current;
    if (skippedOwners.has(name)) continue;
    // A readable name anywhere above wins. On a fully minified bundle there is
    // none, and the nearest renamed component is still the truthful owner — it
    // is reported as a minified one rather than as a name.
    if (looksMinified(name)) {
      minifiedFallback ??= current;
      continue;
    }
    return current;
  }
  return minifiedFallback ?? namedFallback ?? compositeFallback;
}

// The owner exists either way. This decides only whether its name can be shown
// as one.
function ownerKind(name: string | null, whenReadable: AttributionKind): AttributionKind {
  return name && looksMinified(name) ? 'minified-owner' : whenReadable;
}

export function findOwnerFiber(canvas: any): FiberNode | null {
  const fiber = getFiberFromHostInstance(canvas);
  return fiber ? findOwner(fiber) : null;
}

export function findOwnerFiberForCanvas(canvas: any): FiberNode | null {
  const own = findOwnerFiber(canvas);
  if (own) return own;
  // Imperatively appended canvases carry no fiber; the nearest React-managed
  // ancestor owns them (same rule resolveAttribution already applies).
  for (let el = canvas?.parentElement; el; el = el.parentElement) {
    const owner = findOwnerFiber(el);
    if (owner) return owner;
  }
  return null;
}

export function resolveAttribution(canvas: any): {
  nearestReactOwner: string | null;
  attributionKind: AttributionKind;
} {
  try {
    const fiber = getFiberFromHostInstance(canvas);
    if (fiber) {
      const owner = findOwnerFiber(canvas);
      const name = owner ? getDisplayName(owner.type) : null;
      if (fiber.stateNode === canvas) {
        return owner
          ? { nearestReactOwner: name, attributionKind: ownerKind(name, 'jsx-owner') }
          : { nearestReactOwner: null, attributionKind: 'react-host-no-owner' };
      }
      return {
        nearestReactOwner: name,
        attributionKind: ownerKind(name, 'container-only'),
      };
    }

    // Imperatively appended canvases (react-konva, pixi) carry no fiber stamp;
    // the nearest React-managed ancestor is the best truthful attribution.
    const owner = findOwnerFiberForCanvas(canvas);
    if (owner) {
      const ownerName = getDisplayName(owner.type);
      return {
        nearestReactOwner: ownerName,
        attributionKind: ownerKind(ownerName, 'container-only'),
      };
    }

    for (let el = canvas.parentElement; el; el = el.parentElement) {
      const hostFiber = getFiberFromHostInstance(el);
      if (!hostFiber) continue;
      return {
        nearestReactOwner: null,
        attributionKind: 'container-only',
      };
    }

    return { nearestReactOwner: null, attributionKind: 'unattributed' };
  } catch {
    return { nearestReactOwner: null, attributionKind: 'unattributed' };
  }
}
