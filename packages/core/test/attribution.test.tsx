// @vitest-environment jsdom

import { beforeEach, expect, it, vi } from 'vitest';

const { getOwnerStack } = vi.hoisted(() => ({
  getOwnerStack: vi.fn(),
}));

vi.mock('bippy/source', async importOriginal => {
  const actual = await importOriginal<typeof import('bippy/source')>();
  getOwnerStack.mockImplementation(actual.getOwnerStack);
  return { ...actual, getOwnerStack };
});

import {
  addSkippedOwners,
  findOwnerFiberForCanvas,
  looksMinified,
  resolveAttribution,
} from '../src/attribution';
import {
  resolveSourceLocation,
  resolveSourceOutcome,
} from '../src/symbolicate';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import React, { useLayoutEffect, useRef } from 'react';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;

beforeEach(() => {
  getOwnerStack.mockClear();
});

it('attributes a JSX canvas to its nearest React owner', () => {
  function MyChart() {
    return <canvas data-testid="c" />;
  }

  const container = document.createElement('div');
  const root = createRoot(container);
  flushSync(() => root.render(<MyChart />));

  const canvas = container.querySelector('[data-testid="c"]')!;
  expect(resolveAttribution(canvas)).toEqual({
    nearestReactOwner: 'MyChart',
    attributionKind: 'jsx-owner',
  });

  root.unmount();
});

it('attributes an imperatively appended canvas through its React container', () => {
  function ImperativeHost() {
    const ref = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
      const canvas = document.createElement('canvas');
      canvas.id = 'imp';
      ref.current!.appendChild(canvas);
    }, []);

    return <div ref={ref} />;
  }

  const container = document.createElement('div');
  const root = createRoot(container);
  flushSync(() => root.render(<ImperativeHost />));

  const canvas = container.querySelector('#imp')!;
  expect(resolveAttribution(canvas)).toEqual({
    nearestReactOwner: 'ImperativeHost',
    attributionKind: 'container-only',
  });

  root.unmount();
});

it('leaves a canvas outside a React tree unattributed', () => {
  const canvas = document.createElement('canvas');

  expect(resolveAttribution(canvas)).toEqual({
    nearestReactOwner: null,
    attributionKind: 'unattributed',
  });
});

it('resolves no source for a canvas outside a React tree', async () => {
  const canvas = document.createElement('canvas');

  await expect(resolveSourceLocation(canvas)).resolves.toBeNull();
  await expect(resolveSourceOutcome(canvas)).resolves.toEqual({
    kind: 'unavailable',
  });
});

it('resolves a React canvas to a source location when one is available', async () => {
  function SourceChart() {
    return <canvas data-testid="source-c" />;
  }

  const container = document.createElement('div');
  const root = createRoot(container);
  flushSync(() => root.render(<SourceChart />));

  const canvas = container.querySelector('[data-testid="source-c"]')!;
  getOwnerStack.mockResolvedValueOnce([
    {
      fileName: '/src/SourceChart.tsx',
      lineNumber: 14,
      columnNumber: 3,
    },
  ]);

  await expect(resolveSourceOutcome(canvas)).resolves.toEqual({
    kind: 'found',
    location: {
      file: '/src/SourceChart.tsx',
      line: 14,
      column: 3,
    },
  });
  expect(getOwnerStack).toHaveBeenCalledOnce();

  root.unmount();
});

it('finds the owner for an imperatively appended canvas', () => {
  function ImperativeSourceHost() {
    const ref = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
      const canvas = document.createElement('canvas');
      canvas.id = 'imperative-source';
      ref.current!.appendChild(canvas);
    }, []);

    return <div ref={ref} />;
  }

  const container = document.createElement('div');
  const root = createRoot(container);
  flushSync(() => root.render(<ImperativeSourceHost />));

  expect(
    findOwnerFiberForCanvas(container.querySelector('#imperative-source')!),
  ).not.toBeNull();

  root.unmount();
});

it('reports source lookup errors distinctly', async () => {
  function ThrowingSource() {
    return <canvas id="throwing-source" />;
  }

  const container = document.createElement('div');
  const root = createRoot(container);
  flushSync(() => root.render(<ThrowingSource />));
  getOwnerStack.mockRejectedValueOnce(new Error('lookup failed'));

  await expect(
    resolveSourceOutcome(container.querySelector('#throwing-source')!),
  ).resolves.toEqual({ kind: 'error' });

  root.unmount();
});

it('retries source lookup after a transient error', async () => {
  function RecoveringSource() {
    return <canvas id="recovering-source" />;
  }

  const container = document.createElement('div');
  const root = createRoot(container);
  flushSync(() => root.render(<RecoveringSource />));
  const canvas = container.querySelector('#recovering-source')!;
  getOwnerStack
    .mockRejectedValueOnce(new Error('temporary failure'))
    .mockResolvedValueOnce([
      {
        fileName: '/src/RecoveringSource.tsx',
        lineNumber: 24,
        columnNumber: 5,
      },
    ]);

  await expect(resolveSourceOutcome(canvas)).resolves.toEqual({
    kind: 'error',
  });
  await expect(resolveSourceOutcome(canvas)).resolves.toEqual({
    kind: 'found',
    location: {
      file: '/src/RecoveringSource.tsx',
      line: 24,
      column: 5,
    },
  });
  expect(getOwnerStack).toHaveBeenCalledTimes(2);

  root.unmount();
});

it('skips known library wrapper names to reach the user component', () => {
  function StageWrap() {
    return (
      <div>
        <canvas id="konva-like" />
      </div>
    );
  }
  function Stage() {
    return <StageWrap />;
  }
  function KonvaSection() {
    return <Stage />;
  }

  const container = document.createElement('div');
  const root = createRoot(container);
  flushSync(() => root.render(<KonvaSection />));

  expect(resolveAttribution(container.querySelector('#konva-like')!)).toEqual({
    nearestReactOwner: 'KonvaSection',
    attributionKind: 'jsx-owner',
  });

  root.unmount();
});

it('falls back to the skipped name when nothing better exists above it', () => {
  function Stage() {
    return <canvas id="lone-stage" />;
  }

  const container = document.createElement('div');
  const root = createRoot(container);
  flushSync(() => root.render(<Stage />));

  expect(resolveAttribution(container.querySelector('#lone-stage')!)).toEqual({
    nearestReactOwner: 'Stage',
    attributionKind: 'jsx-owner',
  });

  root.unmount();
});

it('skips wrappers on the container-only path too', () => {
  function StageWrap() {
    const ref = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
      const canvas = document.createElement('canvas');
      canvas.id = 'imp2';
      ref.current!.appendChild(canvas);
    }, []);

    return <div ref={ref} />;
  }
  function UserHost() {
    return <StageWrap />;
  }

  const container = document.createElement('div');
  const root = createRoot(container);
  flushSync(() => root.render(<UserHost />));

  expect(resolveAttribution(container.querySelector('#imp2')!)).toEqual({
    nearestReactOwner: 'UserHost',
    attributionKind: 'container-only',
  });

  root.unmount();
});

it('skips minified-looking names on the way to a real one', () => {
  const MinifiedInner = function m() {
    return <canvas id="minified-c" />;
  };
  function RealOwner() {
    return <MinifiedInner />;
  }

  const container = document.createElement('div');
  const root = createRoot(container);
  flushSync(() => root.render(<RealOwner />));

  expect(resolveAttribution(container.querySelector('#minified-c')!)).toEqual({
    nearestReactOwner: 'RealOwner',
    attributionKind: 'jsx-owner',
  });

  root.unmount();
});

it('honors additional skip names registered at runtime', () => {
  addSkippedOwners(['LibWrapper']);

  function LibWrapper() {
    return <canvas id="wrapped-c" />;
  }
  function UserOwner() {
    return <LibWrapper />;
  }

  const container = document.createElement('div');
  const root = createRoot(container);
  flushSync(() => root.render(<UserOwner />));

  expect(resolveAttribution(container.querySelector('#wrapped-c')!)).toEqual({
    nearestReactOwner: 'UserOwner',
    attributionKind: 'jsx-owner',
  });

  root.unmount();
});

// ---------------------------------------------------------------- minified builds
//
// Found by the public dogfood run against excalidraw.com: 124 of 128 canvases
// had no owner, and the four that resolved gave `mRe`, `fRe` and `ERe`. A
// finding headed "Repeated drawing · mRe" tells a reader nothing, and it looks
// exactly like a finding that worked.

it.each([
  ['mRe', true],
  ['fRe', true],
  ['ERe', true],
  ['a', true],
  ['UI', true],
  ['abcd', true],
  ['App', false],
  ['Box', false],
  ['Nav', false],
  ['Chart', false],
  ['LineChartInner', false],
])('treats %s as minified: %s', (name, expected) => {
  expect(looksMinified(name)).toBe(expected);
});

it('reports a minified owner as evidence, not as a name', () => {
  // A production bundle keeps the function renamed and still needs a
  // capitalised binding for JSX.
  const Minified = function mRe() {
    return <canvas data-testid="min" />;
  };

  const container = document.createElement('div');
  const root = createRoot(container);
  flushSync(() => root.render(<Minified />));

  expect(resolveAttribution(container.querySelector('[data-testid="min"]')!)).toEqual({
    // The symbol is kept. A reader can search the bundle for it.
    nearestReactOwner: 'mRe',
    // It is not a name, so nothing may head a finding with it.
    attributionKind: 'minified-owner',
  });

  root.unmount();
});

it('prefers a readable owner above a minified one', () => {
  const Inner = function mRe() {
    return <canvas data-testid="mixed" />;
  };
  function DashboardChart() {
    return <Inner />;
  }

  const container = document.createElement('div');
  const root = createRoot(container);
  flushSync(() => root.render(<DashboardChart />));

  expect(resolveAttribution(container.querySelector('[data-testid="mixed"]')!)).toEqual({
    nearestReactOwner: 'DashboardChart',
    attributionKind: 'jsx-owner',
  });

  root.unmount();
});

it('does not demote a short real component name', () => {
  function App() {
    return <canvas data-testid="app-c" />;
  }

  const container = document.createElement('div');
  const root = createRoot(container);
  flushSync(() => root.render(<App />));

  expect(resolveAttribution(container.querySelector('[data-testid="app-c"]')!)).toEqual({
    nearestReactOwner: 'App',
    attributionKind: 'jsx-owner',
  });

  root.unmount();
});
