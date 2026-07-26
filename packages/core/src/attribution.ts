import {
  getDisplayName,
  getFiberFromHostInstance,
  isCompositeFiber,
  traverseFiber,
} from 'bippy';
import type { AttributionKind } from './types';

export function resolveAttribution(canvas: any): {
  nearestReactOwner: string | null;
  attributionKind: AttributionKind;
} {
  try {
    const fiber = getFiberFromHostInstance(canvas);
    if (fiber) {
      const composite = traverseFiber(
        fiber,
        (candidate) => isCompositeFiber(candidate),
        true,
      );
      if (fiber.stateNode === canvas) {
        return composite
          ? {
              nearestReactOwner: getDisplayName(composite.type),
              attributionKind: 'jsx-owner',
            }
          : {
              nearestReactOwner: 'canvas',
              attributionKind: 'direct-host',
            };
      }

      return {
        nearestReactOwner: composite
          ? getDisplayName(composite.type)
          : null,
        attributionKind: 'container-only',
      };
    }

    // Imperatively appended canvases (react-konva, pixi) carry no fiber stamp;
    // the nearest React-managed ancestor is the best truthful attribution.
    for (let el = canvas.parentElement; el; el = el.parentElement) {
      const hostFiber = getFiberFromHostInstance(el);
      if (!hostFiber) continue;
      const composite = traverseFiber(
        hostFiber,
        (candidate) => isCompositeFiber(candidate),
        true,
      );
      return {
        nearestReactOwner: composite
          ? getDisplayName(composite.type)
          : null,
        attributionKind: 'container-only',
      };
    }

    return {
      nearestReactOwner: null,
      attributionKind: 'unattributed',
    };
  } catch {
    return {
      nearestReactOwner: null,
      attributionKind: 'unattributed',
    };
  }
}
