// The request-classification contract.
//
// "canvas-scan sends nothing anywhere" is the kind of claim a reader has to
// take on faith unless something checks it. This is the something. One fixed
// contract classifies every request a run makes, and the checker refuses any
// request it cannot place.
//
// The contract has three owners and no fourth:
//
//   target-navigation      the document request for the URL you named
//   application-asset      anything the target's own origin serves it
//   canvas-scan            a same-origin source map, fetched only while an
//                          explanation is resolving a draw callsite
//
// Anything else is a violation, whatever it is called. There is no telemetry
// owner, no update-check owner, no crash-report owner, because there is no way
// to declare one: an undeclared destination fails the check rather than
// producing a new category.
//
// The source-map exception is structural rather than a promise. safeResourceUrl
// in draw-callsite.ts refuses a cross-origin resource before the fetch happens,
// and rejects a redirect that leaves the origin, so canvas-scan cannot reach a
// third party even if asked to.
export const REQUEST_OWNERS = Object.freeze(['target-navigation', 'application-asset', 'canvas-scan']);

// Named so a violation report says what the request looked like, not just that
// it was unexpected. None of these is a category a request can be filed under —
// they are the names of things that must never appear.
export const FORBIDDEN_PURPOSES = Object.freeze(['telemetry', 'upload', 'score', 'crash-report', 'supply-chain', 'remote-rule', 'update-check']);

export class NetworkContractViolation extends Error {}

const fail = message => { throw new NetworkContractViolation(message); };

// canvas-scan only ever asks for a source map, and only from the origin it is
// running on. Both halves have to hold for the request to be its.
const isSourceMap = pathname => pathname.endsWith('.map');

export function classifyRequest(request, { targetOrigin, navigationUrl }) {
  if (typeof request?.url !== 'string') fail('a recorded request has no URL');
  let url;
  try { url = new URL(request.url); }
  catch { fail(`a recorded request has an unusable URL: ${String(request.url).slice(0, 120)}`); }

  if (url.origin !== targetOrigin) {
    fail(`undeclared destination ${url.origin}${url.pathname} (${request.method ?? 'GET'}): the contract allows the target's origin and nothing else`);
  }
  if (request.url === navigationUrl && request.resourceType === 'document') return 'target-navigation';
  if (isSourceMap(url.pathname)) return 'canvas-scan';
  return 'application-asset';
}

// `expected` is the set of owners this run is allowed to produce. A run with no
// explanation should produce no canvas-scan request at all, and saying so up
// front is what makes an extra one a failure rather than a curiosity.
export function checkRequests(requests, { targetOrigin, navigationUrl, expectedOwners = REQUEST_OWNERS }) {
  for (const owner of expectedOwners) {
    if (!REQUEST_OWNERS.includes(owner)) fail(`unknown request owner ${JSON.stringify(owner)}. The contract has exactly: ${REQUEST_OWNERS.join(', ')}`);
  }
  const classified = requests.map(request => ({ ...request, owner: classifyRequest(request, { targetOrigin, navigationUrl }) }));

  const unexpected = classified.filter(request => !expectedOwners.includes(request.owner));
  if (unexpected.length) {
    fail(`${unexpected.length} request${unexpected.length === 1 ? '' : 's'} of an owner this run did not expect: ${[...new Set(unexpected.map(request => `${request.owner} ${request.url}`))].slice(0, 5).join(', ')}`);
  }

  // A body leaving the machine is what "upload" and "telemetry" look like from
  // here. canvas-scan sends none, so any body at all belongs to the
  // application and must be aimed at the application's own origin.
  const canvasScanWithBody = classified.filter(request => request.owner === 'canvas-scan' && request.hasBody);
  if (canvasScanWithBody.length) fail(`canvas-scan sent ${canvasScanWithBody.length} request carrying a body; it sends none`);

  const navigations = classified.filter(request => request.owner === 'target-navigation');
  if (navigations.length !== 1 && expectedOwners.includes('target-navigation')) {
    fail(`expected exactly one target navigation, recorded ${navigations.length}`);
  }
  return classified;
}

// The process side of the same claim. Chrome is not the only thing that could
// talk to a network — the command itself could. Loopback is where the local
// fixture server lives; anything else is the command phoning somewhere.
export function checkConnections(connections) {
  const offMachine = connections.filter(connection => !isLoopback(connection.host));
  if (offMachine.length) {
    fail(`the command opened ${offMachine.length} connection${offMachine.length === 1 ? '' : 's'} off this machine: ${[...new Set(offMachine.map(connection => `${connection.host}:${connection.port}`))].slice(0, 5).join(', ')}`);
  }
  return connections;
}

export function isLoopback(host) {
  if (typeof host !== 'string') return false;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0:0:0:0:0:0:0:1' || host.startsWith('127.');
}
