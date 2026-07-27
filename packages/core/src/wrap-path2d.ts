import { getBuildSignature, trackBuild } from './build-registry';
import { captureOp, newWindowSignature } from './signature';

const PATH_METHODS = [
  'addPath',
  'closePath',
  'moveTo',
  'lineTo',
  'bezierCurveTo',
  'quadraticCurveTo',
  'arc',
  'arcTo',
  'ellipse',
  'rect',
  'roundRect',
];

let installed = false;
let killed = false;

function kill(error: unknown) {
  if (killed) return;
  killed = true;
  console.warn('[canvas-scan] Path2D instrumentation disabled', error);
}

export function isPath2DKilled(): boolean {
  return killed;
}

export function installPath2DPatch(holder: any = globalThis): void {
  if (installed) return;
  installed = true;
  const Native = holder?.Path2D;
  if (typeof Native !== 'function') return;

  for (const name of PATH_METHODS) {
    const original = Native.prototype[name];
    if (typeof original !== 'function') continue;
    Native.prototype[name] = function (this: any, ...args: unknown[]) {
      const result = original.apply(this, args);
      const sig = getBuildSignature(this);
      if (sig && !killed) {
        try {
          captureOp(sig, name, args);
        } catch (error) {
          kill(error);
        }
      }
      return result;
    };
  }

  holder.Path2D = class Path2D extends Native {
    constructor(...args: any[]) {
      super(...args);
      const sig = newWindowSignature();
      if (!killed) {
        try {
          if (args.length > 0) captureOp(sig, 'new', args);
        } catch (error) {
          kill(error);
        }
      }
      trackBuild(this, sig);
    }
  };
}
