// @vitest-environment jsdom

import { expect, it } from 'vitest';
import { resolveAttribution } from '../src/attribution';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import React, { useLayoutEffect, useRef } from 'react';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;

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
