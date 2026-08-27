// Runs the guided command in a process of its own, with every outbound socket
// and every name lookup recorded before anything else loads.
//
// Chrome is a child process with its own network stack, and the browser half of
// the claim is checked separately. What this process can prove is the other
// half: the command itself — the harness, the report writer, the handoff
// builder — opens nothing off this machine.
//
// Prints one JSON object on the last line.
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The CJS module objects, not the ESM default bindings. Patching the default
// binding leaves the real prototype untouched, and an empty recording would
// then look exactly like silence.
const require = createRequire(import.meta.url);
const net = require('node:net');
const dns = require('node:dns');

const connections = [];
const lookups = [];

// Hooked before the harness is imported, so nothing it does can go unrecorded.
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  // Node normalizes the call before it reaches the prototype, so the first
  // argument is usually [options, callback] rather than the options object.
  // Missing that is how a recorder ends up reporting perfect silence, which is
  // what the control connection in this fixture exists to catch.
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (typeof first === 'object' && first !== null) connections.push({ host: first.host ?? null, port: first.port ?? null, path: first.path ?? null });
  else if (typeof first === 'number') connections.push({ host: typeof args[1] === 'string' ? args[1] : 'localhost', port: first, path: null });
  else if (typeof first === 'string') connections.push({ host: null, port: null, path: first });
  return connect.apply(this, args);
};
const lookup = dns.lookup;
dns.lookup = function (hostname, ...rest) { lookups.push(hostname); return lookup.call(this, hostname, ...rest); };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { serve } = await import(path.join(root, 'scripts/browser-driver.mjs'));
const { investigate } = await import(path.join(root, 'packages/dogfood/investigate-url.mjs'));

const result = { ok: false, connections: [], lookups: [], hookWorks: false, error: null };
const { server, port } = await serve(path.join(root, 'apps/demo/dist'));

// A control. If the hook were broken, an empty connection list would look like
// perfect silence, and this check would be worthless. One deliberate loopback
// connection proves the recorder records.
await new Promise(resolve => {
  const probe = net.connect({ host: '127.0.0.1', port }, () => { probe.end(); resolve(); });
  probe.on('error', () => resolve());
});
result.hookWorks = connections.some(connection => connection.host === '127.0.0.1' && connection.port === port);
try {
  const origin = `http://127.0.0.1:${port}`;
  const report = await investigate(
    {
      url: `${origin}/`, origin,
      out: mkdtempSync(path.join(os.tmpdir(), 'canvas-scan-process-')),
      drive: path.join(root, 'packages/dogfood/fixtures/investigate-url-ritual.mjs'),
      handoff: 'both', blockExternal: true, timeoutMs: 180_000,
    },
    { log: () => {} },
  );
  result.ok = report.notes.length === 0;
  result.error = report.notes.join(' | ') || null;
} catch (error) {
  result.error = String(error);
} finally {
  server.close();
}
// Unix-domain sockets have a path and no host: Playwright's own pipe to Chrome
// is one, and it never leaves the machine. Only addressed connections matter.
result.connections = connections.filter(connection => connection.port !== null);
result.lookups = [...new Set(lookups)];
console.log(`\n${JSON.stringify(result)}`);
process.exit(0);
