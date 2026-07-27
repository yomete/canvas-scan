import { describe, expect, it } from 'vitest';

import { getBuildSignature } from '../src/build-registry';
import { captureOp, newWindowSignature } from '../src/signature';
import { installPath2DPatch } from '../src/wrap-path2d';

class Path2D {
  constructor(_init?: unknown) {}
  moveTo() {}
  lineTo() {}
  rect() {}
  closePath() {}
  addPath(_path?: unknown) {}
}

const NativeFake = Path2D;
const holder = { Path2D: Path2D as any };
installPath2DPatch(holder);
const Tracked = holder.Path2D;

function strokeSignature(path: unknown) {
  const signature = newWindowSignature();
  captureOp(signature, 'stroke', [path]);
  return signature;
}

describe('Path2D construction capture', () => {
  it('hashes identical builds and draw windows equally', () => {
    const first = new Tracked();
    first.moveTo(0, 0);
    first.lineTo(10, 10);
    const second = new Tracked();
    second.moveTo(0, 0);
    second.lineTo(10, 10);

    const firstBuild = getBuildSignature(first)!;
    const secondBuild = getBuildSignature(second)!;
    const firstWindow = strokeSignature(first);
    const secondWindow = strokeSignature(second);

    expect(firstBuild.hash).toBe(secondBuild.hash);
    expect(firstBuild.unknown).toBe(false);
    expect(secondBuild.unknown).toBe(false);
    expect(firstWindow.hash).toBe(secondWindow.hash);
    expect(firstWindow.unknown).toBe(false);
    expect(secondWindow.unknown).toBe(false);
  });

  it('hashes different builds differently', () => {
    const first = new Tracked();
    first.rect(0, 0, 10, 10);
    const second = new Tracked();
    second.rect(0, 0, 20, 20);

    expect(strokeSignature(first).hash).not.toBe(strokeSignature(second).hash);
  });

  it('reflects mutations in subsequent draw windows', () => {
    const path = new Tracked();
    path.moveTo(0, 0);
    const before = strokeSignature(path);

    path.lineTo(5, 5);
    const after = strokeSignature(path);

    expect(before.hash).not.toBe(after.hash);
  });

  it('marks an untracked native instance unknown', () => {
    const raw = Reflect.construct(NativeFake, []);
    const signature = strokeSignature(raw);

    expect(signature.unknown).toBe(true);
    expect(signature.unknownReason).toBe('Path2D');
  });

  it('captures SVG string construction', () => {
    const first = new Tracked('M0 0L10 10');
    const same = new Tracked('M0 0L10 10');
    const different = new Tracked('M0 0L20 20');

    expect(getBuildSignature(first)?.hash).toBe(getBuildSignature(same)?.hash);
    expect(getBuildSignature(first)?.hash).not.toBe(
      getBuildSignature(different)?.hash,
    );
  });

  it('captures tracked composition and poisons untracked composition', () => {
    const source = new Tracked();
    source.lineTo(10, 10);
    const sameSource = new Tracked();
    sameSource.lineTo(10, 10);

    const first = new Tracked(source);
    const second = new Tracked(sameSource);

    expect(getBuildSignature(first)?.hash).toBe(
      getBuildSignature(second)?.hash,
    );

    first.addPath(Reflect.construct(NativeFake, []));
    expect(getBuildSignature(first)?.unknown).toBe(true);
    expect(strokeSignature(first).unknownReason).toBe('Path2D:dirty');
  });

  it('preserves constructor identity and the prototype chain', () => {
    expect(new Tracked()).toBeInstanceOf(NativeFake);
    expect(Tracked.name).toBe('Path2D');
    expect(holder.Path2D).toBe(Tracked);
  });
});
