// Where release evidence is written.
//
// The repo's convention is /private/tmp/sidproj-NN-*.json, and the release
// reports under docs/releases cite those exact paths as provenance. That
// directory exists on macOS and not on Linux, so every CI run of the pack job
// failed on an ENOENT while passing on a developer's Mac — which is how it
// stayed unnoticed.
//
// The convention is kept where it holds. /private/tmp is still the default
// wherever it exists, so existing documented paths stay true and a developer
// sees no change. Elsewhere the platform's own temporary directory is used,
// and CANVAS_SCAN_EVIDENCE_DIR overrides both.
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MACOS_SHARED_TMP = '/private/tmp';

export function evidenceDir() {
  const configured = process.env.CANVAS_SCAN_EVIDENCE_DIR;
  const directory = configured
    ? path.resolve(configured)
    : existsSync(MACOS_SHARED_TMP) ? MACOS_SHARED_TMP : tmpdir();
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function evidencePath(name) {
  return path.join(evidenceDir(), name);
}
