import { useEffect, useMemo, useRef } from 'react';

type Mode = 'bad' | 'fixed' | 'negative';
type Controls = { scenario: string; variant: string; mode: Mode; mutation: string | null };
type Factors = {
  ownership: 'react' | 'non-react';
  methodMix: 'rects' | 'paths' | 'image' | 'mixed';
  identityOrder: 'first' | 'middle' | 'last';
  geometry: 'compact' | 'standard' | 'wide';
  idleGapBoundaries: number;
  eventSource: 'pointer' | 'wheel' | 'keyboard';
};
type FixtureSnapshot = {
  actions: string[];
  acceptedRunCount: number;
  drawCount: number;
  interactionComplete: boolean;
  interactionStartedAt: number | null;
  boundaryCount: number | null;
  phase: string;
  visibleChecksum: string;
  visibleImageHash: string;
};
type LabFixture = { ready: boolean; completed: Promise<void>; snapshot: (includeImage?: boolean) => FixtureSnapshot };

const scenarios = ['heavy-burst', 'repeated-continuous', 'resize-churn', 'backing-store-mismatch', 'lifecycle-reactivation', 'interaction-association', 'non-react-burst', 'integrated-continuous', 'integrated-burst'];
const knownVariants = ['variant-a', 'variant-b', 'variant-c', 'nearest-negative'];
const burstActions = ['Load', 'Zoom', 'Pan', 'Hover', 'Search', 'Filter', 'Resize'];
const scene = [18, 24, 82, 44, 132, 56];

function readControls(): Controls {
  const query = new URLSearchParams(location.search);
  const scenario = query.get('scenario') ?? 'heavy-burst';
  const variant = query.get('variant') ?? 'variant-a';
  const mode = (query.get('mode') ?? 'bad') as Mode;
  const mutation = query.get('mutation');
  const integrated = scenario.startsWith('integrated-');
  const validVariant = integrated ? variant === 'integrated' : knownVariants.includes(variant);
  const validMode = integrated ? mode === 'bad' || mode === 'fixed' : mode === 'negative' ? variant === 'nearest-negative' : (mode === 'bad' || mode === 'fixed') && variant !== 'nearest-negative';
  if (!scenarios.includes(scenario) || !validVariant || !validMode || (mutation !== null && mutation !== 'heavy-burst-seed-off')) throw new Error('unknown v0.4 fixture control');
  return { scenario, variant, mode, mutation };
}

function factorsFor({ scenario, variant }: Controls): Factors {
  const base: Factors = { ownership: 'non-react', methodMix: 'rects', identityOrder: 'first', geometry: 'standard', idleGapBoundaries: 0, eventSource: 'pointer' };
  const variants: Record<string, Partial<Factors>[]> = {
    'heavy-burst': [{ ownership: 'react', eventSource: 'keyboard' }, { methodMix: 'paths', identityOrder: 'last', geometry: 'wide' }, { methodMix: 'image', idleGapBoundaries: 1, eventSource: 'wheel' }],
    'repeated-continuous': [{ ownership: 'react', methodMix: 'paths' }, { identityOrder: 'last', geometry: 'wide' }, { methodMix: 'mixed', idleGapBoundaries: 2, eventSource: 'keyboard' }],
    'resize-churn': [{ ownership: 'react', eventSource: 'keyboard' }, { methodMix: 'paths', identityOrder: 'last', geometry: 'wide' }, { methodMix: 'mixed', eventSource: 'wheel' }],
    'backing-store-mismatch': [{ ownership: 'react', eventSource: 'keyboard' }, { methodMix: 'paths', identityOrder: 'last', geometry: 'wide' }, { methodMix: 'image', identityOrder: 'middle', geometry: 'compact', eventSource: 'wheel' }],
    'lifecycle-reactivation': [{ ownership: 'react', identityOrder: 'middle' }, { methodMix: 'paths', identityOrder: 'last', geometry: 'wide' }, { methodMix: 'image', eventSource: 'keyboard' }],
    'interaction-association': [{ ownership: 'react', eventSource: 'keyboard' }, { methodMix: 'paths', identityOrder: 'last', geometry: 'wide', eventSource: 'wheel' }, { methodMix: 'mixed', idleGapBoundaries: 2 }],
    'non-react-burst': [{ methodMix: 'paths', identityOrder: 'last' }, { methodMix: 'image', geometry: 'wide', eventSource: 'wheel' }, { methodMix: 'mixed', identityOrder: 'middle', eventSource: 'keyboard', idleGapBoundaries: 1 }],
  };
  if (variant === 'nearest-negative' || variant === 'integrated') return base;
  return { ...base, ...(variants[scenario]?.[['variant-a', 'variant-b', 'variant-c'].indexOf(variant)] ?? {}) };
}

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
async function frames(count: number) { for (let index = 0; index < count; index++) await nextFrame(); }
function dimensions(geometry: Factors['geometry']) { return geometry === 'compact' ? [180, 100] : geometry === 'wide' ? [560, 140] : [320, 140]; }
function makeCanvas(role: string) { const canvas = document.createElement('canvas'); canvas.dataset.labRole = role; return canvas; }
function configureCanvas(canvas: HTMLCanvasElement, factors: Factors, backingRatio = 1) {
  const [width, height] = dimensions(factors.geometry);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * devicePixelRatio * backingRatio);
  canvas.height = Math.round(height * devicePixelRatio);
}
function makePrepared(width: number, height: number) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#07111f'; context.fillRect(0, 0, width, height);
  context.fillStyle = '#38bdf8'; context.fillRect(scene[0], scene[1], scene[2], scene[3]);
  context.fillStyle = '#a78bfa'; context.fillRect(scene[4], scene[1], scene[5], scene[3]);
  return canvas;
}
function drawVisible(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, prepared: HTMLCanvasElement, method: Factors['methodMix'], change = 0) {
  context.imageSmoothingEnabled = false;
  if (change) context.clearRect(-100 - change, -100, 1, 1);
  if (method === 'image') { context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(prepared, 0, 0, canvas.width, canvas.height); return; }
  const scaleX = canvas.width / prepared.width; const scaleY = canvas.height / prepared.height;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#07111f'; context.fillRect(0, 0, canvas.width, canvas.height);
  if (method === 'paths') {
    context.fillStyle = '#38bdf8'; context.beginPath(); context.rect(scene[0] * scaleX, scene[1] * scaleY, scene[2] * scaleX, scene[3] * scaleY); context.fill();
    context.fillStyle = '#a78bfa'; context.beginPath(); context.rect(scene[4] * scaleX, scene[1] * scaleY, scene[5] * scaleX, scene[3] * scaleY); context.fill();
    return;
  }
  context.fillStyle = '#38bdf8'; context.fillRect(scene[0] * scaleX, scene[1] * scaleY, scene[2] * scaleX, scene[3] * scaleY);
  if (method === 'mixed') context.drawImage(prepared, 0, 0, canvas.width, canvas.height);
  else { context.fillStyle = '#a78bfa'; context.fillRect(scene[4] * scaleX, scene[1] * scaleY, scene[5] * scaleX, scene[3] * scaleY); }
}
function canvasHash(canvases: HTMLCanvasElement[]) {
  let hash = 2166136261;
  for (const canvas of canvases) {
    const normalized = document.createElement('canvas'); normalized.width = canvas.clientWidth; normalized.height = canvas.clientHeight;
    const context = normalized.getContext('2d')!; context.imageSmoothingEnabled = false; context.drawImage(canvas, 0, 0, normalized.width, normalized.height);
    for (const byte of context.getImageData(0, 0, normalized.width, normalized.height).data) hash = Math.imul(hash ^ byte, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function V04Lab() {
  const controls = useMemo(readControls, []);
  const factors = useMemo(() => factorsFor(controls), [controls]);
  const host = useRef<HTMLDivElement>(null);
  const reactPrimary = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const state = { actions: [] as string[], acceptedRunCount: 0, drawCount: 0, interactionComplete: false, interactionStartedAt: null as number | null, boundaryCount: null as number | null, phase: 'ready' };
    let resolveCompletion!: () => void;
    const completed = new Promise<void>(resolve => { resolveCompletion = resolve; });
    const complete = () => { if (state.interactionComplete) return; state.interactionComplete = true; resolveCompletion(); };
    const directCanvases: HTMLCanvasElement[] = [];
    const outsideReact = factors.ownership === 'non-react' ? document.createElement('div') : null;
    if (outsideReact) { outsideReact.className = 'lab-canvases lab-canvases-outside-react'; document.body.append(outsideReact); }
    const canvasHost = outsideReact ?? host.current!;
    const primary = factors.ownership === 'react' ? reactPrimary.current! : makeCanvas('primary');
    const decoys = factors.ownership === 'react' ? [] : [makeCanvas('decoy-a'), makeCanvas('decoy-b')];
    if (factors.ownership === 'non-react') {
      const order = factors.identityOrder === 'first' ? [primary, ...decoys] : factors.identityOrder === 'middle' ? [decoys[0], primary, decoys[1]] : [...decoys, primary];
      canvasHost.append(...order); directCanvases.push(...order);
    }
    configureCanvas(primary, factors);
    for (const decoy of decoys) { decoy.width = 8; decoy.height = 8; decoy.style.width = '8px'; decoy.style.height = '8px'; }
    const contexts = new Map<HTMLCanvasElement, CanvasRenderingContext2D>();
    const contextFor = (canvas: HTMLCanvasElement) => { const current = contexts.get(canvas) ?? canvas.getContext('2d')!; contexts.set(canvas, current); return current; };
    let activePrimary = primary;
    const scenarioCanvases = [primary];

    if (controls.scenario === 'backing-store-mismatch') configureCanvas(primary, factors, controls.mode === 'bad' || controls.mode === 'negative' ? 2 : 1);
    if (controls.scenario === 'integrated-continuous') {
      const resize = makeCanvas('resize'); const backing = makeCanvas('backing');
      configureCanvas(resize, factors); configureCanvas(backing, factors, controls.mode === 'bad' ? 2 : 1);
      canvasHost.append(resize, backing); directCanvases.push(resize, backing); scenarioCanvases.push(resize, backing);
    }
    for (const canvas of canvasHost.querySelectorAll('canvas')) contextFor(canvas);
    const [cssWidth, cssHeight] = dimensions(factors.geometry);
    const prepared = new Map(scenarioCanvases.map(canvas => [canvas, makePrepared(cssWidth, cssHeight)]));
    const heavyTile = makePrepared(12, 8);
    const heavyPixels = contextFor(primary).createImageData(primary.width, primary.height);
    const preparedFor = (canvas: HTMLCanvasElement) => prepared.get(canvas) ?? makePrepared(canvas.width, canvas.height);
    const paint = (canvas = activePrimary, change = 0) => { drawVisible(contextFor(canvas), canvas, preparedFor(canvas), factors.methodMix, change); state.drawCount++; };

    async function heavy() {
      state.phase = 'heavy-start';
      const fixed = controls.mode === 'fixed' || controls.mutation === 'heavy-burst-seed-off';
      if (!fixed) {
        const context = contextFor(activePrimary);
        if (controls.scenario === 'heavy-burst' && controls.mode === 'negative') {
          let measuredCallTimeMs = 0;
          for (let index = 0; measuredCallTimeMs < 7.8 && index < 2048; index++) {
            const callStartedAt = performance.now();
            context.putImageData(heavyPixels, 0, 0);
            measuredCallTimeMs += performance.now() - callStartedAt;
          }
        } else {
          const pixelPasses = controls.mode === 'negative' ? 16 : 512;
          for (let index = 0; index < pixelPasses; index++) context.putImageData(heavyPixels, 0, 0);
        }
        state.phase = 'heavy-factor-draws';
        const operations = controls.mode === 'negative' ? 200 : 800;
        for (let index = 0; index < operations; index++) {
          const x = (index * 13) % Math.max(1, activePrimary.width - 8); const y = (index * 7) % Math.max(1, activePrimary.height - 8);
          if (factors.methodMix === 'image') context.drawImage(heavyTile, x, y);
          else if (factors.methodMix === 'paths') { context.beginPath(); context.rect(x, y, 3, 2); context.fill(); }
          else if (factors.methodMix === 'mixed' && index % 2) context.drawImage(heavyTile, x, y);
          else context.fillRect(x, y, 3, 2);
        }
      }
      state.phase = 'heavy-final-paint'; paint(); state.phase = 'heavy-settle'; await frames(3); state.phase = 'heavy-done';
    }
    async function repeated() {
      if (controls.mode === 'negative') {
        const context = contextFor(activePrimary); const image = preparedFor(activePrimary);
        context.drawImage(image, 0, 0, activePrimary.width, activePrimary.height); state.drawCount++; await nextFrame();
        context.drawImage(image, 0, 0, activePrimary.width, activePrimary.height); state.drawCount++; await nextFrame();
        return;
      }
      if (controls.mode === 'fixed') {
        paint(activePrimary, 1); await nextFrame();
        if (factors.idleGapBoundaries) await frames(factors.idleGapBoundaries);
        await frames(3);
        return;
      }
      for (let index = 0; index < 4; index++) {
        paint(activePrimary);
        await nextFrame();
        if (index === 1 && factors.idleGapBoundaries) await frames(factors.idleGapBoundaries);
      }
    }
    async function resizeChurn() {
      const context = contextFor(activePrimary);
      if (controls.mode === 'bad') { activePrimary.width = activePrimary.width; activePrimary.height = activePrimary.height; activePrimary.setAttribute('width', String(activePrimary.width)); context.reset(); }
      else if (controls.mode === 'negative') activePrimary.width = activePrimary.width;
      paint(); await frames(3);
    }
    async function backingMismatch() {
      paint(activePrimary, 1); await nextFrame();
      if (controls.mode === 'negative') activePrimary.width = Math.round(cssWidth * devicePixelRatio);
      paint(activePrimary, 2); await frames(3);
    }
    async function lifecycle() {
      paint(activePrimary, 1); await nextFrame();
      if (controls.mode === 'fixed') {
        await frames(89); paint(activePrimary, 2); await nextFrame(); await frames(30);
      } else {
        const count = controls.mode === 'bad' ? 120 : 119; await frames(count); state.boundaryCount = count;
        if (controls.mode === 'bad') { paint(activePrimary, 2); await nextFrame(); }
      }
    }
    async function association() {
      if (controls.mode === 'negative') await frames(3);
      paint(activePrimary, 1);
      if (controls.mode === 'bad') { const end = performance.now() + 85; while (performance.now() < end) Math.imul(31, 17); }
      await frames(3); await new Promise(resolve => setTimeout(resolve, 300));
    }
    async function integratedContinuous() {
      const [repeat, resize, backing] = scenarioCanvases;
      for (let index = 0; index < 4; index++) {
        if (controls.mode === 'bad' || index === 0) paint(repeat);
        if (controls.mode === 'bad') { resize.width = resize.width; resize.height = resize.height; }
        paint(resize, index + 1); paint(backing, index + 1); await nextFrame();
      }
    }
    async function knownScenario() {
      if (controls.scenario !== 'repeated-continuous' && factors.idleGapBoundaries) await frames(factors.idleGapBoundaries);
      if (controls.scenario === 'heavy-burst' || controls.scenario === 'non-react-burst') await heavy();
      else if (controls.scenario === 'repeated-continuous') await repeated();
      else if (controls.scenario === 'resize-churn') await resizeChurn();
      else if (controls.scenario === 'backing-store-mismatch') await backingMismatch();
      else if (controls.scenario === 'lifecycle-reactivation') await lifecycle();
      else if (controls.scenario === 'interaction-association') await association();
      else await integratedContinuous();
      complete();
    }
    let pending = Promise.resolve();
    const trigger = document.querySelector<HTMLButtonElement>('#lab-trigger');
    const eventName = factors.eventSource === 'keyboard' ? 'keydown' : factors.eventSource === 'wheel' ? 'wheel' : 'pointerdown';
    const activate = () => {
      if (state.acceptedRunCount) return;
      state.acceptedRunCount++;
      state.interactionStartedAt ??= performance.now();
      pending = pending.then(knownScenario).catch(error => { console.error(error); complete(); });
    };
    const onTrigger = (event: Event) => { if (eventName === 'keydown' && (event as KeyboardEvent).key !== 'Enter') return; activate(); };
    const onClick = () => activate();
    trigger?.addEventListener(eventName, onTrigger);
    trigger?.addEventListener('click', onClick);

    const burstButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-burst-action]')];
    async function runBurstAction(name: string) {
      if (state.actions.length !== burstActions.indexOf(name)) throw new Error(`unexpected burst action: ${name}`);
      state.interactionStartedAt ??= performance.now();
      state.actions.push(name);
      if (name === 'Zoom') {
        if (controls.mode === 'bad') await heavy(); else { paint(activePrimary, 1); await nextFrame(); }
      } else if (name === 'Pan') {
        if (controls.mode === 'bad') { activePrimary.width = activePrimary.width; activePrimary.height = activePrimary.height; }
        paint(activePrimary, 2); await nextFrame();
      } else if (name === 'Search' && controls.mode === 'bad') {
        const replacement = makeCanvas('replacement'); configureCanvas(replacement, factors); activePrimary.replaceWith(replacement); directCanvases.push(replacement); activePrimary = replacement;
        prepared.set(replacement, makePrepared(cssWidth, cssHeight)); paint(replacement, 4); await nextFrame();
      } else if (name !== 'Load') { paint(activePrimary, burstActions.indexOf(name) + 1); await nextFrame(); }
      if (name === 'Resize' && controls.mode === 'bad') { activePrimary.width = activePrimary.width; activePrimary.height = activePrimary.height; paint(activePrimary, 9); await nextFrame(); }
      if (name === 'Resize') { await frames(3); complete(); }
    }
    const burstListeners = burstButtons.map(button => { const listener = () => { pending = pending.then(() => runBurstAction(button.dataset.burstAction!)).catch(error => { console.error(error); complete(); }); }; button.addEventListener('click', listener); return [button, listener] as const; });

    const snapshot = (includeImage = false): FixtureSnapshot => ({
      actions: [...state.actions], acceptedRunCount: state.acceptedRunCount, drawCount: state.drawCount, interactionComplete: state.interactionComplete, interactionStartedAt: state.interactionStartedAt, boundaryCount: state.boundaryCount, phase: state.phase,
      visibleChecksum: `${controls.scenario}|${controls.variant}|${scene.join(',')}`,
      visibleImageHash: includeImage ? canvasHash(scenarioCanvases.map(canvas => canvas === primary ? activePrimary : canvas).filter(canvas => canvas.isConnected)) : '',
    });
    window.__CANVAS_LAB_FIXTURE__ = { ready: true, completed, snapshot };
    return () => {
      trigger?.removeEventListener(eventName, onTrigger);
      trigger?.removeEventListener('click', onClick);
      for (const [button, listener] of burstListeners) button.removeEventListener('click', listener);
      for (const canvas of directCanvases) canvas.remove();
      outsideReact?.remove();
      delete window.__CANVAS_LAB_FIXTURE__;
    };
  }, [controls, factors]);

  const reactOrder = factors.identityOrder === 'first' ? ['primary', 'decoy-a', 'decoy-b'] : factors.identityOrder === 'middle' ? ['decoy-a', 'primary', 'decoy-b'] : ['decoy-a', 'decoy-b', 'primary'];
  return <main className="lab-shell">
    <header><p className="eyebrow">Canvas Performance Lab v0.4</p><h1>{controls.scenario}</h1><p>{controls.variant} · {controls.mode}</p></header>
    {controls.scenario !== 'integrated-burst' && <button id="lab-trigger" type="button">Run fixture</button>}
    {controls.scenario === 'integrated-burst' && <section aria-label="Flamegraph actions">{burstActions.map(action => <button type="button" key={action} data-burst-action={action}>{action}</button>)}</section>}
    <div ref={host} className="lab-canvases">{factors.ownership === 'react' && reactOrder.map(role => <canvas key={role} ref={role === 'primary' ? reactPrimary : undefined} data-lab-role={role} className={role === 'primary' ? 'primary-canvas' : 'decoy-canvas'} />)}</div>
  </main>;
}

declare global {
  interface Window {
    __CANVAS_LAB_FIXTURE__?: LabFixture;
  }
}
