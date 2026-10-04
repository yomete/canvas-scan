// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markBrowserEvidence, resetBrowserEvidence, startBrowserEvidence, stopBrowserEvidence } from '../src/browser-evidence';

const types = ['pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'keydown', 'keyup', 'wheel', 'input', 'change'];
type Fake = { callback: (list: { getEntries(): unknown[] }) => void; entries: unknown[]; observed: unknown[]; disconnected: number; throwDisconnect?: boolean };
let observers: Fake[] = [];
class FakeObserver {
  static supportedEntryTypes: string[] = ['event', 'long-animation-frame', 'mark', 'measure'];
  value: Fake;
  constructor(callback: Fake['callback']) { this.value = { callback, entries: [], observed: [], disconnected: 0 }; observers.push(this.value); }
  observe(options: unknown): void { this.value.observed.push(options); }
  takeRecords(): unknown[] { return this.value.entries; }
  disconnect(): void { this.value.disconnected++; if (this.value.throwDisconnect) throw new Error('disconnect'); }
}
function install(): void { observers = []; vi.stubGlobal('PerformanceObserver', FakeObserver); }
function hostileEvent(type = 'input', timestamp = 12): Event {
  const event = new Event(type, { bubbles: true });
  const target = {};
  Object.defineProperties(target, Object.fromEntries(['value', 'textContent', 'innerText', 'id', 'className', 'attributes', 'parentElement', 'clientX', 'pointerId', 'key', 'code', 'ctrlKey', 'application'].map(key => [key, { get() { throw new Error(`${key} read`); } }])));
  Object.defineProperty(target, 'tagName', { get() { return 'INPUT'; } });
  Object.defineProperty(event, 'target', { get() { return target; } });
  Object.defineProperty(event, 'timeStamp', { get() { return timestamp; } });
  return event;
}
afterEach(() => { resetBrowserEvidence(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('browser evidence', () => {
  it('uses independent feature flags, options, and cleanup', () => {
    install(); const add = vi.spyOn(document, 'addEventListener'); const remove = vi.spyOn(document, 'removeEventListener');
    expect(startBrowserEvidence(0)).toEqual({ eventTiming: true, longAnimationFrames: true });
    expect(observers.map(item => item.observed[0])).toEqual([{ type: 'event', buffered: true, durationThreshold: 16 }, { type: 'long-animation-frame', buffered: true }, { type: 'mark', buffered: true }, { type: 'measure', buffered: true }]);
    expect(add.mock.calls.filter(([type, , capture]) => types.includes(type as string) && capture === true)).toHaveLength(types.length);
    remove.mockClear();
    stopBrowserEvidence(20);
    expect(observers.map(item => item.disconnected)).toEqual([1, 1, 1, 1]);
    expect(remove.mock.calls.filter(([type, , capture]) => types.includes(type as string) && capture === true)).toHaveLength(types.length);
  });

  it('handles missing support, throwing support, constructor failures, and observe failures', () => {
    expect(startBrowserEvidence(0)).toEqual({ eventTiming: false, longAnimationFrames: false }); resetBrowserEvidence();
    class BadSupport { static get supportedEntryTypes(): string[] { throw new Error('support'); } }
    vi.stubGlobal('PerformanceObserver', BadSupport); expect(startBrowserEvidence(0)).toEqual({ eventTiming: false, longAnimationFrames: false }); resetBrowserEvidence();
    class BadConstructor { static supportedEntryTypes = ['event']; constructor() { throw new Error('construct'); } }
    vi.stubGlobal('PerformanceObserver', BadConstructor); expect(startBrowserEvidence(0)).toEqual({ eventTiming: false, longAnimationFrames: false }); resetBrowserEvidence();
    let disconnects = 0;
    class BadObserve { static supportedEntryTypes = ['event']; observe() { throw new Error('observe'); } disconnect() { disconnects++; } }
    vi.stubGlobal('PerformanceObserver', BadObserve); expect(startBrowserEvidence(0)).toEqual({ eventTiming: false, longAnimationFrames: false }); expect(disconnects).toBe(1);
  });

  it('keeps a working observer when the other observer fails', () => {
    const instances: Array<{ type: string; disconnected: number }> = [];
    class PartialObserver {
      static supportedEntryTypes = ['event', 'long-animation-frame'];
      type = ''; disconnected = 0;
      constructor() { instances.push(this); }
      observe(options: { type: string }): void { this.type = options.type; if (this.type === 'event') throw new Error('event observe'); }
      takeRecords(): unknown[] { return this.type === 'long-animation-frame' ? [{ startTime: 1, duration: 60, blockingDuration: 5, scripts: [] }] : []; }
      disconnect(): void { this.disconnected++; }
    }
    vi.stubGlobal('PerformanceObserver', PartialObserver);
    expect(startBrowserEvidence(0)).toEqual({ eventTiming: false, longAnimationFrames: true });
    const result = stopBrowserEvidence(100);
    expect(instances.map(instance => instance.disconnected)).toEqual([1, 1]);
    expect(result.entries).toMatchObject([{ kind: 'long-animation-frame', durationMs: 60 }]);
  });

  it('keeps every approved document event and tolerates hostile event and target getters', () => {
    install(); const add = vi.spyOn(document, 'addEventListener'); vi.spyOn(performance, 'now').mockReturnValue(12); startBrowserEvidence(0);
    for (const type of types) document.dispatchEvent(hostileEvent(type));
    document.dispatchEvent(hostileEvent('click'));
    const inputListener = add.mock.calls.find(([type]) => type === 'input')?.[1] as EventListener;
    inputListener({ get type() { throw new Error('type read'); } } as unknown as Event);
    inputListener({ type: 'input', get timeStamp() { throw new Error('timestamp read'); }, get target() { throw new Error('target read'); } } as unknown as Event);
    const result = stopBrowserEvidence(20);
    expect(result.entries.filter(entry => entry.kind === 'document-event').map(entry => entry.eventType)).toEqual([...types, 'input']);
    expect(result.entries.slice(0, types.length)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'document-event', eventType: 'input', targetTagName: 'input', startedAtTimestampMs: 12, endedAtTimestampMs: 12 })]));
    expect(result.entries.at(-1)).toMatchObject({ kind: 'document-event', eventType: 'input', targetTagName: '', startedAtTimestampMs: 12, endedAtTimestampMs: 12 });
  });

  it('filters Event Timing, uses target tags, and continues after malformed entries', () => {
    install(); startBrowserEvidence(10); observers[0].entries.push({ get name() { throw new Error('bad'); } }, { name: 'click', startTime: 11, duration: 2 }, { name: 'pointerdown', startTime: 12, duration: 3, interactionId: 8, target: { tagName: 'BUTTON' } }, { name: 'keyup', startTime: 15, duration: 2, target: { get tagName() { throw new Error('tag'); } } });
    const result = stopBrowserEvidence(20);
    expect(result.entries).toMatchObject([{ kind: 'event-timing', eventType: 'pointerdown', targetTagName: 'button', durationMs: 3, interactionId: 8 }, { kind: 'event-timing', eventType: 'keyup', targetTagName: '', interactionId: null }]);
  });

  it('rejects a document event timestamp from before recording', () => {
    install(); vi.spyOn(performance, 'now').mockReturnValue(100);
    const event = hostileEvent('pointerdown', 90);
    startBrowserEvidence(95); document.dispatchEvent(event);
    expect(stopBrowserEvidence(110).entries).toEqual([]);
  });

  it('keeps marks bounded and keeps one entry per call only during recording', () => {
    markBrowserEvidence('outside'); install(); vi.spyOn(performance, 'now').mockReturnValue(12); startBrowserEvidence(0);
    markBrowserEvidence(' \u0000  Hello   mark  '); markBrowserEvidence('   '); markBrowserEvidence('a'.repeat(90));
    const marks = stopBrowserEvidence(20).entries.filter(entry => entry.kind === 'user-mark');
    expect(marks).toMatchObject([{ label: 'Hello mark' }, { label: 'a'.repeat(80) }]);
  });

  it('turns a tab or newline in a label into a space rather than deleting it', () => {
    install(); vi.spyOn(performance, 'now').mockReturnValue(12); startBrowserEvidence(0);
    // Control characters used to be deleted before whitespace was collapsed,
    // so the words either side were joined: 'step 1\tstep 2' became
    // 'step 1step 2' with nothing saying the separator was lost.
    markBrowserEvidence('step 1\tstep 2');
    markBrowserEvidence('  a\t\tb \n c  ');
    const marks = stopBrowserEvidence(20).entries.filter(entry => entry.kind === 'user-mark');
    expect(marks).toMatchObject([{ label: 'step 1 step 2' }, { label: 'a b c' }]);
  });

  it('records page marks and measures as user marks and skips its own entries', () => {
    install(); startBrowserEvidence(10);
    observers[2].entries.push({ name: 'pan-start', startTime: 12, duration: 0 }, { name: 'canvas-scan:recording-start', startTime: 10, duration: 0 }, { name: 'before', startTime: 5, duration: 0 });
    observers[3].entries.push({ name: 'pan', startTime: 12, duration: 30 }, { name: 'canvas-scan:episode-1', startTime: 12, duration: 5 }, { get name() { throw new Error('bad'); } });
    const marks = stopBrowserEvidence(50).entries.filter(entry => entry.kind === 'user-mark');
    expect(marks).toEqual([
      { entryId: 'browser-evidence-1', kind: 'user-mark', startedAtTimestampMs: 12, endedAtTimestampMs: 12, label: 'pan-start' },
      { entryId: 'browser-evidence-2', kind: 'user-mark', startedAtTimestampMs: 12, endedAtTimestampMs: 42, label: 'pan' },
    ]);
  });

  it('copies every bounded long-frame script field', () => {
    install(); startBrowserEvidence(0);
    observers[1].entries.push({ startTime: 1, duration: 60, blockingDuration: 10, scripts: Array.from({ length: 21 }, (_, index) => ({ invoker: index === 0 ? 'BUTTON#private.primary[data-secret=value].onpointerdown' : index === 1 ? 'button#private.primary[data-secret=value].onpointerup' : index === 2 ? 'svg#private.icon[data-secret=value].onclick' : ` i${index}\u0000 `, invokerType: ' event-listener ', sourceURL: 'https://x.test/a.js?q=private#fragment', sourceFunctionName: '🙂'.repeat(201), executionStart: 2, duration: index, forcedStyleAndLayoutDuration: 3, pauseDuration: 4 })) });
    const result = stopBrowserEvidence(100); const loaf = result.entries[0];
    expect(loaf).toMatchObject({ kind: 'long-animation-frame', durationMs: 60, blockingDurationMs: 10, droppedScriptAttributionCount: 1 });
    if (loaf.kind !== 'long-animation-frame') throw new Error('missing loaf');
    expect(loaf.scripts).toHaveLength(20); expect(loaf.scripts[0]).toMatchObject({ invoker: 'button.onpointerdown', invokerType: 'event-listener', sourceURL: 'https://x.test/a.js', executionStartTimestampMs: 2, durationMs: 0, forcedStyleAndLayoutDurationMs: 3, pauseDurationMs: 4 });
    expect(loaf.scripts[1].invoker).toBe('button.onpointerup'); expect(loaf.scripts[2].invoker).toBe('svg.onclick');
    expect(JSON.stringify(loaf.scripts.slice(0, 3))).not.toMatch(/private|primary|icon|secret|value/);
    expect([...(loaf.scripts[0].sourceFunctionName ?? '')]).toHaveLength(200);
  });

  it('removes DOM selector identity from stored long-frame invokers', () => {
    install(); startBrowserEvidence(0);
    const invokers = ['DIV#private.onclick', 'div > button#private.onclick', '#private.onclick', '.private.onclick', '[data-secret].onclick', 'svg:use#private.onclick', 'DiV.Private', 'svg.Private', 'custom-element.Private', 'div||button.private.onclick', 'svg|use.private.onclick', '*.private.onclick', 'console.log', 'performance.now', 'app.render', 'Window.requestAnimationFrame'];
    observers[1].entries.push({ startTime: 1, duration: 60, blockingDuration: 10, scripts: invokers.map(invoker => ({ invoker })) });
    const result = stopBrowserEvidence(100); const loaf = result.entries[0];
    if (loaf.kind !== 'long-animation-frame') throw new Error('missing loaf');
    expect(loaf.scripts.map(script => script.invoker)).toEqual(['div.onclick', 'button.onclick', 'onclick', 'onclick', 'onclick', 'use.onclick', 'div', 'svg', 'custom-element', 'button.onclick', 'use.onclick', 'onclick', 'console.log', 'performance.now', 'app.render', 'Window.requestAnimationFrame']);
    const stored = JSON.stringify(result);
    for (const value of ['private', 'Private', 'data-secret', 'div >', '#private', '.private', '[data-secret]', 'svg:', '||', 'svg|', '*.']) expect(stored).not.toContain(value);
  });

  it('evicts the combined FIFO and counts each removed kind', () => {
    install(); vi.spyOn(performance, 'now').mockReturnValue(5); startBrowserEvidence(0);
    document.dispatchEvent(hostileEvent('pointerdown', 5));
    observers[0].callback({ getEntries: () => [{ name: 'pointerup', startTime: 1, duration: 2 }] });
    markBrowserEvidence('first mark');
    observers[1].callback({ getEntries: () => [{ startTime: 1, duration: 60, blockingDuration: 5, scripts: [] }] });
    for (let index = 0; index < 2000; index++) markBrowserEvidence(String(index));
    const result = stopBrowserEvidence(100);
    expect(result.entries).toHaveLength(2000);
    expect(result.dropped).toEqual({ documentEvents: 1, eventTiming: 1, userMarks: 1, longAnimationFrames: 1 });
  });

  it('cleans each observer and listeners when one disconnect throws, including reset', () => {
    install(); startBrowserEvidence(0); observers[0].throwDisconnect = true; stopBrowserEvidence(10); expect(observers[1].disconnected).toBe(1);
    install(); const remove = vi.spyOn(document, 'removeEventListener'); startBrowserEvidence(0); remove.mockClear(); observers[0].throwDisconnect = true; resetBrowserEvidence(); expect(observers[1].disconnected).toBe(1);
    expect(remove.mock.calls.filter(([type, , capture]) => types.includes(type as string) && capture === true)).toHaveLength(types.length);
  });

  it('ignores observer callbacks retained across stop, reset, and restart', () => {
    install(); startBrowserEvidence(0); const stopped = observers[0]; stopBrowserEvidence(10);
    startBrowserEvidence(20); stopped.callback({ getEntries: () => [{ name: 'pointerdown', startTime: 21, duration: 2 }] });
    const reset = observers[4]; resetBrowserEvidence(); startBrowserEvidence(30);
    reset.callback({ getEntries: () => [{ name: 'pointerup', startTime: 31, duration: 2 }] });
    expect(stopBrowserEvidence(40).entries).toEqual([]);
  });
});
