// @vitest-environment jsdom

import { expect, it } from 'vitest';
import { addSkippedOwners, resolveAttribution } from '../src/attribution';
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
