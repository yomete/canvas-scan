// Minimal headless-Chrome driver for the browser tests. No dependencies:
// Node's built-in fetch and WebSocket speak the DevTools Protocol directly,
// and a small static server hands out the built demo.
//
// The throttling flags matter. Chrome freezes requestAnimationFrame in a page
// it considers hidden, and canvas-scan's whole frame loop rides on it — so
// without them the tests would sit against a stopped loop and see nothing.
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

// A page with a canvas and no canvas-scan in it. The injection check must not
// run against the demo, because the demo imports canvas-scan itself: that
// second copy installs successfully once the document exists and sets the
// global, which would hide an injected copy failing outright.
const BLANK_PAGE = `<!doctype html><html><head><title>blank</title></head>
<body><canvas id="blank-canvas" width="200" height="100"></canvas>
<script>const c=document.getElementById('blank-canvas').getContext('2d');c.fillRect(0,0,10,10);c.fillRect(20,0,10,10);</script>
</body></html>`;

export function serve(root) {
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (path === '/__blank') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(BLANK_PAGE);
      return;
    }
    // normalize() collapses any ".." before the join, so a request cannot
    // escape the directory being served.
    const file = join(root, normalize(path === '/' ? '/index.html' : path));
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(response);
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function chromeBinary() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find(path => existsSync(path));
  if (!found) {
    throw new Error(`No Chrome found. Set CHROME_PATH, or install one of:\n  ${candidates.join('\n  ')}`);
  }
  return found;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// `initScript` is evaluated before any page script, which is the position a
// browser extension or an automation harness installs from. It is a harsher
// position than a script tag: the document element does not exist yet.
export async function launch(url, { initScript } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'canvas-scan-browser-'));
  const port = 9400 + Math.floor(process.pid % 500);
  const chrome = spawn(chromeBinary(), [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--window-size=1400,900',
    'about:blank',
  ], { stdio: 'ignore' });

  let socketUrl;
  for (let attempt = 0; attempt < 80 && !socketUrl; attempt++) {
    try {
      socketUrl = (await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json())).webSocketDebuggerUrl;
    } catch { await sleep(250); }
  }
  if (!socketUrl) throw new Error('Chrome did not expose a debugging port');

  const socket = new WebSocket(socketUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });

  let nextId = 1;
  const pending = new Map();
  const consoleLines = [];
  let pageSession;

  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.sessionId === pageSession) {
      consoleLines.push({
        type: message.params.type,
        text: message.params.args.map(a => a.value ?? a.description ?? '').join(' '),
      });
    }
  };

  const send = (method, params = {}, sessionId) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  };

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  pageSession = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await send('Runtime.enable', {}, pageSession);
  await send('Page.enable', {}, pageSession);
  if (initScript) {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: initScript }, pageSession);
  }
  await send('Page.navigate', { url }, pageSession);
  await sleep(1200);

  return {
    // Each step runs as an async IIFE so `await` works and the final
    // expression is the value. A thrown error is returned rather than
    // rethrown, so one failing check does not lose the rest of the run.
    async evaluate(expression) {
      const result = await send('Runtime.evaluate', {
        expression: `(async () => { ${expression} })()`,
        awaitPromise: true,
        returnByValue: true,
        timeout: 60000,
      }, pageSession);
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      }
      return result.result.value;
    },
    consoleLines,
    async close() {
      socket.close();
      chrome.kill();
      await sleep(200);
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
