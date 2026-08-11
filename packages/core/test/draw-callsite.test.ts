import { describe, expect, it, vi } from 'vitest';
import {
  captureDrawCallsite,
  createDrawCallsiteCapture,
  disableDrawCallsiteCapture,
  finishDrawCallsiteCapture,
  getDrawCallsiteTestCounts,
  MAX_FRAMES_PER_STACK,
  MAX_SOURCE_MAP_LOOKUPS,
  MAX_SOURCE_MAP_RESPONSE_BYTES,
  MAX_STACK_SAMPLES,
  resetDrawCallsiteForTests,
  resolveDrawCallsiteBoundary,
  settleDrawCallsiteCaptureForTests,
} from '../src/draw-callsite';

const base = 'http://example.test/fixture.html';
function response(body: BodyInit, url: string, init: ResponseInit = {}): Response {
  const value = new Response(body, { status: 200, ...init });
  Object.defineProperty(value, 'url', { value: url });
  return value;
}
function stack(...frames: string[]): string { return ['Error', ...frames.map(frame => `    at ${frame}`)].join('\n'); }
function standard(source = 'fixtures/v05-05/source.js', mappings = 'AAAA'): string {
  return JSON.stringify({ version: 3, sources: [source], names: [], mappings });
}
async function captured(rawStack: string, fetch: typeof globalThis.fetch, reasons: Array<'first-raster' | 'first-difference'> = ['first-raster']) {
  const capture = createDrawCallsiteCapture({ locationHref: base, fetch });
  const target = {};
  captureDrawCallsite(capture, target, 3, reasons, rawStack);
  resolveDrawCallsiteBoundary(capture, target, 12);
  await settleDrawCallsiteCaptureForTests(capture);
  return finishDrawCallsiteCapture(capture);
}

describe('draw callsite capture', () => {
  it('bounds samples and frames without exporting raw stack text', () => {
    resetDrawCallsiteForTests();
    const capture = createDrawCallsiteCapture({ locationHref: base, fetch: vi.fn(async url => response('', String(url))) as typeof fetch });
    const raw = stack(...Array.from({ length: 22 }, (_, index) => `draw${index} (http://other.test/app.js?secret#part:${index + 1}:2)`));
    for (let index = 0; index < 9; index++) {
      const target = {};
      captureDrawCallsite(capture, target, index, ['first-raster'], raw);
      resolveDrawCallsiteBoundary(capture, target, index + 1);
    }
    const result = finishDrawCallsiteCapture(capture);
    expect(result.stacks).toHaveLength(MAX_STACK_SAMPLES);
    expect(result.stacks[0].frames).toHaveLength(MAX_FRAMES_PER_STACK);
    expect(result.stacks[0].droppedFrameCount).toBe(2);
    expect(result.droppedEntryCounts).toMatchObject({ stackSamples: 1, stackFrames: 16 });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('    at ');
    expect(getDrawCallsiteTestCounts().stackAllocations).toBe(8);
  });

  it('allocates one raw stack for two reason-tagged samples and keeps raster priority', () => {
    resetDrawCallsiteForTests();
    const capture = createDrawCallsiteCapture({ locationHref: base, fetch: vi.fn(async url => response('', String(url))) as typeof fetch });
    const target = {};
    captureDrawCallsite(capture, target, 0, ['first-raster', 'first-difference'], stack('draw (http://other.test/app.js:1:1)'));
    resolveDrawCallsiteBoundary(capture, target, 9);
    expect(finishDrawCallsiteCapture(capture).stacks.map(sample => sample.reason)).toEqual(['first-raster', 'first-difference']);
    expect(getDrawCallsiteTestCounts().stackAllocations).toBe(1);

    const nearlyFull = createDrawCallsiteCapture({ locationHref: base, fetch: vi.fn(async url => response('', String(url))) as typeof fetch });
    for (let index = 0; index < MAX_STACK_SAMPLES - 1; index++) {
      const identity = {};
      captureDrawCallsite(nearlyFull, identity, index, ['first-raster'], 'Error');
      resolveDrawCallsiteBoundary(nearlyFull, identity, index);
    }
    const finalIdentity = {};
    captureDrawCallsite(nearlyFull, finalIdentity, 8, ['first-raster', 'first-difference'], 'Error');
    resolveDrawCallsiteBoundary(nearlyFull, finalIdentity, 8);
    const result = finishDrawCallsiteCapture(nearlyFull);
    expect(result.stacks.at(-1)?.reason).toBe('first-raster');
    expect(result.droppedEntryCounts.stackSamples).toBe(1);
  });

  it('maps a same-origin generated frame and strips URL details and dot segments', async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input); calls.push(url);
      if (url.includes('.map')) return response(standard('../fixtures/./v05-05/direct-source.js?mapped=private#fragment'), url);
      return response('draw();\n//# sourceMappingURL=/maps/direct.js.map', url);
    }) as typeof fetch;
    const result = await captured(stack('direct (http://example.test/assets/direct.js?private=1#part:1:0)'), fetcher);
    expect(calls).toEqual(['http://example.test/assets/direct.js?private=1', 'http://example.test/maps/direct.js.map']);
    expect(result.stacks[0]).toMatchObject({ windowIndex: 12, commandOrdinal: 3, frames: [{
      generated: { file: 'http://example.test/assets/direct.js', line: 1, column: 0 },
      mapped: { file: 'fixtures/v05-05/direct-source.js', line: 1, column: 0 },
      mappingStatus: 'mapped', unresolvedReason: null,
    }] });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(JSON.stringify(result)).not.toContain('mappings');
  });

  it('deep-copies mapped and generated locations on finish', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return response(url.endsWith('.map') ? standard('fixtures/v05-05/copy-source.js') : 'draw();\n//# sourceMappingURL=copy.js.map', url);
    }) as typeof fetch;
    const capture = createDrawCallsiteCapture({ locationHref: base, fetch: fetcher });
    const target = {};
    captureDrawCallsite(capture, target, 0, ['first-raster'], stack('draw (http://example.test/copy.js:1:0)'));
    resolveDrawCallsiteBoundary(capture, target, 1);
    await settleDrawCallsiteCaptureForTests(capture);
    const first = finishDrawCallsiteCapture(capture);
    first.stacks[0].frames[0].generated!.file = 'changed-generated.js';
    first.stacks[0].frames[0].mapped!.file = 'changed-mapped.js';
    first.stacks[0].frames.length = 0;
    const second = finishDrawCallsiteCapture(capture);
    expect(second.stacks[0].frames[0]).toMatchObject({
      generated: { file: 'http://example.test/copy.js' },
      mapped: { file: 'fixtures/v05-05/copy-source.js' },
    });
  });

  it('does not reuse source-map results across explanations', async () => {
    resetDrawCallsiteForTests();
    const first = await captured(stack('draw (http://example.test/shared.js:1:0)'), vi.fn(async input => {
      const url = String(input);
      return response(url.endsWith('.map') ? standard('fixtures/v05-05/first.js') : 'draw();\n//# sourceMappingURL=shared.js.map', url);
    }) as typeof fetch);
    const second = await captured(stack('draw (http://example.test/shared.js:1:0)'), vi.fn(async input => {
      const url = String(input);
      return response(url.endsWith('.map') ? standard('fixtures/v05-05/second.js') : 'draw();\n//# sourceMappingURL=shared.js.map', url);
    }) as typeof fetch);
    expect(first.stacks[0].frames[0].mapped?.file).toBe('fixtures/v05-05/first.js');
    expect(second.stacks[0].frames[0].mapped?.file).toBe('fixtures/v05-05/second.js');
    expect(getDrawCallsiteTestCounts().sourceMapLookups).toBe(2);
  });

  it('supports an indexed source map and does not fetch mapped sources', async () => {
    const calls: string[] = [];
    const indexed = JSON.stringify({ version: 3, sections: [{ offset: { line: 0, column: 0 }, map: { version: 3, sources: ['fixtures/v05-05/indexed.js'], names: [], mappings: 'AAAA' } }] });
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input); calls.push(url);
      return response(url.endsWith('.map') ? indexed : 'draw();\n//# sourceMappingURL=relative.map', url);
    }) as typeof fetch;
    const result = await captured(stack('draw (http://example.test/assets/indexed.js:1:0)'), fetcher);
    expect(result.stacks[0].frames[0].mapped?.file).toBe('fixtures/v05-05/indexed.js');
    expect(calls).toEqual(['http://example.test/assets/indexed.js', 'http://example.test/assets/relative.map']);
  });

  it('reports no map, missing mapping, invalid map, load failure, and redirected map exactly', async () => {
    const noMap = await captured(stack('draw (http://example.test/no-map.js:1:0)'), vi.fn(async url => response('draw();', String(url))) as typeof fetch);
    expect(noMap.stacks[0].frames[0].unresolvedReason).toBe('no-source-map');

    const missing = await captured(stack('draw (http://example.test/missing.js:1:0)'), vi.fn(async url => response(String(url).endsWith('.map') ? standard('fixture.js', '') : 'draw();\n//# sourceMappingURL=missing.js.map', String(url))) as typeof fetch);
    expect(missing.stacks[0].frames[0].unresolvedReason).toBe('mapping-missing');

    const invalid = await captured(stack('draw (http://example.test/invalid.js:1:0)'), vi.fn(async url => response(String(url).endsWith('.map') ? '{bad json' : 'draw();\n//# sourceMappingURL=invalid.js.map', String(url))) as typeof fetch);
    expect(invalid.stacks[0].frames[0].unresolvedReason).toBe('source-map-parse-failed');

    const failed = await captured(stack('draw (http://example.test/failed.js:1:0)'), vi.fn(async () => { throw new Error('network'); }) as typeof fetch);
    expect(failed.stacks[0].frames[0].unresolvedReason).toBe('source-map-load-failed');

    const redirected = await captured(stack('draw (http://example.test/redirect.js:1:0)'), vi.fn(async url => response('draw();', 'https://other.test/redirect.js')) as typeof fetch);
    expect(redirected.stacks[0].frames[0].unresolvedReason).toBe('cross-origin-source-map');
  });

  it.each(['https://other.test/map.js', '//other.test/map.js', 'data:application/json;base64,e30=', 'blob:http://example.test/id', 'file:///map.js'])(
    'rejects unsafe declared map %s without requesting it',
    async reference => {
      const calls: string[] = [];
      const result = await captured(stack('draw (http://example.test/unsafe.js:1:0)'), vi.fn(async input => {
        const url = String(input); calls.push(url); return response(`draw();\n//# sourceMappingURL=${reference}`, url);
      }) as typeof fetch);
      expect(calls).toEqual(['http://example.test/unsafe.js']);
      expect(result.stacks[0].frames[0].unresolvedReason).toBe('cross-origin-source-map');
    },
  );

  it('keeps a sanitized cross-origin generated location without fetching it', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const result = await captured(stack('draw (https://other.test/app.js?private=1#part:2:3)'), fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.stacks[0].frames[0]).toMatchObject({ generated: { file: 'https://other.test/app.js', line: 2, column: 3 }, unresolvedReason: 'cross-origin-source-map' });
  });

  it('uses manual redirect handling and rejects an opaque redirect before body use', async () => {
    let bodyRead = false;
    const redirected = response('', 'http://example.test/app.js');
    Object.defineProperty(redirected, 'type', { value: 'opaqueredirect' });
    Object.defineProperty(redirected, 'arrayBuffer', { value: async () => { bodyRead = true; return new ArrayBuffer(0); } });
    const fetcher = vi.fn(async () => redirected) as typeof fetch;
    const result = await captured(stack('draw (http://example.test/app.js:1:0)'), fetcher);
    expect(fetcher).toHaveBeenCalledWith('http://example.test/app.js', { redirect: 'manual' });
    expect(bodyRead).toBe(false);
    expect(result.stacks[0].frames[0].unresolvedReason).toBe('cross-origin-source-map');
  });

  it('accepts same-origin HTTPS resources when the page is HTTPS', async () => {
    const fetcher = vi.fn(async input => response('draw();', String(input))) as typeof fetch;
    const capture = createDrawCallsiteCapture({ locationHref: 'https://example.test/page', fetch: fetcher });
    const target = {};
    captureDrawCallsite(capture, target, 0, ['first-raster'], stack('draw (https://example.test/app.js:1:0)'));
    resolveDrawCallsiteBoundary(capture, target, 1);
    await settleDrawCallsiteCaptureForTests(capture);
    expect(finishDrawCallsiteCapture(capture).stacks[0].frames[0].unresolvedReason).toBe('no-source-map');
    expect(fetcher).toHaveBeenCalledWith('https://example.test/app.js', { redirect: 'manual' });
  });

  it('enforces header and actual response byte limits while accepting exactly 2 MiB', async () => {
    let bodyRead = false;
    const tooLargeHeader = {
      ok: true, url: 'http://example.test/large.js', status: 200, statusText: '', headers: new Headers({ 'content-length': String(MAX_SOURCE_MAP_RESPONSE_BYTES + 1) }),
      arrayBuffer: async () => { bodyRead = true; return new ArrayBuffer(0); },
    } as Response;
    const header = await captured(stack('draw (http://example.test/large.js:1:0)'), vi.fn(async () => tooLargeHeader) as typeof fetch);
    expect(bodyRead).toBe(false);
    expect(header.stacks[0].frames[0].unresolvedReason).toBe('source-map-too-large');

    const actual = await captured(stack('draw (http://example.test/actual.js:1:0)'), vi.fn(async url => response(new Uint8Array(MAX_SOURCE_MAP_RESPONSE_BYTES + 1), String(url), { headers: { 'content-length': '1' } })) as typeof fetch);
    expect(actual.stacks[0].frames[0].unresolvedReason).toBe('source-map-too-large');

    const exact = await captured(stack('draw (http://example.test/exact.js:1:0)'), vi.fn(async url => response(new Uint8Array(MAX_SOURCE_MAP_RESPONSE_BYTES), String(url))) as typeof fetch);
    expect(exact.stacks[0].frames[0].unresolvedReason).toBe('no-source-map');
  });

  it('reuses lookups, skips the ninth unique resource, and records exact drops', async () => {
    resetDrawCallsiteForTests();
    const fetcher = vi.fn(async url => response('draw();', String(url))) as typeof fetch;
    const capture = createDrawCallsiteCapture({ locationHref: base, fetch: fetcher });
    const frames = [
      'first (http://example.test/shared.js:1:0)',
      'second (http://example.test/shared.js:2:0)',
      ...Array.from({ length: MAX_SOURCE_MAP_LOOKUPS }, (_, index) => `unique${index} (http://example.test/unique-${index}.js:1:0)`),
    ];
    const target = {};
    captureDrawCallsite(capture, target, 0, ['first-raster'], stack(...frames));
    resolveDrawCallsiteBoundary(capture, target, 1);
    await settleDrawCallsiteCaptureForTests(capture);
    const result = finishDrawCallsiteCapture(capture);
    expect(fetcher).toHaveBeenCalledTimes(MAX_SOURCE_MAP_LOOKUPS);
    expect(getDrawCallsiteTestCounts().sourceMapLookups).toBe(MAX_SOURCE_MAP_LOOKUPS);
    expect(result.droppedEntryCounts.sourceMapLookups).toBe(1);
    expect(result.stacks[0].frames.at(-1)?.unresolvedReason).toBe('mapping-missing');
  });

  it('does not mutate a finalized capture after a late lookup completes', async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { release = resolve; });
    const capture = createDrawCallsiteCapture({ locationHref: base, fetch: vi.fn(async () => pending) as typeof fetch });
    const target = {};
    captureDrawCallsite(capture, target, 0, ['first-raster'], stack('draw (http://example.test/late.js:1:0)'));
    resolveDrawCallsiteBoundary(capture, target, 1);
    const result = finishDrawCallsiteCapture(capture);
    release(response('draw();', 'http://example.test/late.js'));
    await Promise.resolve(); await Promise.resolve();
    expect(result.stacks[0].frames[0].unresolvedReason).toBe('source-map-load-failed');
  });

  it('does not capture or allocate after capture is disabled', () => {
    resetDrawCallsiteForTests();
    const capture = createDrawCallsiteCapture({ locationHref: base, fetch: vi.fn() as unknown as typeof fetch });
    disableDrawCallsiteCapture(capture);
    captureDrawCallsite(capture, {}, 0, ['first-raster'], stack('draw (http://example.test/app.js:1:0)'));
    expect(finishDrawCallsiteCapture(capture)).toMatchObject({ stacks: [], droppedEntryCounts: { stackSamples: 0 } });
    expect(getDrawCallsiteTestCounts()).toEqual({ stackAllocations: 0, sourceMapLookups: 0 });
  });

  it('uses the selected wrapper as the stack boundary and keeps application function names', () => {
    const capture = createDrawCallsiteCapture({ locationHref: base, fetch: vi.fn() as unknown as typeof fetch });
    const target = {};
    function applicationFrame() { selectedWrapper(); }
    function selectedWrapper() { captureDrawCallsite(capture, target, 0, ['first-raster'], undefined, selectedWrapper); }
    applicationFrame();
    resolveDrawCallsiteBoundary(capture, target, 1);
    const frames = finishDrawCallsiteCapture(capture).stacks[0].frames;
    expect(frames[0].generated?.file).toContain('draw-callsite.test.ts');
    expect(frames.map(frame => frame.functionName)).not.toContain('selectedWrapper');

    const named = createDrawCallsiteCapture({ locationHref: base, fetch: vi.fn() as unknown as typeof fetch });
    const namedTarget = {};
    captureDrawCallsite(named, namedTarget, 0, ['first-raster'], stack('captureDrawCallsiteFromApplication (http://other.test/app.js:1:1)'));
    resolveDrawCallsiteBoundary(named, namedTarget, 1);
    expect(finishDrawCallsiteCapture(named).stacks[0].frames[0].functionName).toBe('captureDrawCallsiteFromApplication');
  });

  it('drops a sample whose target boundary was not resolved before disable', () => {
    const capture = createDrawCallsiteCapture({ locationHref: base, fetch: vi.fn() as unknown as typeof fetch });
    captureDrawCallsite(capture, {}, 0, ['first-raster'], stack('draw (http://other.test/app.js:1:0)'));
    disableDrawCallsiteCapture(capture);
    const result = finishDrawCallsiteCapture(capture);
    expect(result.stacks).toEqual([]);
    expect(result.droppedEntryCounts.stackSamples).toBe(1);
    expect(JSON.stringify(result)).not.toContain('"windowIndex":-1');
  });
});
