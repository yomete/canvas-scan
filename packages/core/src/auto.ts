// Must be the app's FIRST import: bippy's hook must exist before react-dom evaluates.
import { start } from './index.js';

start({ captureEvery: 1, ...((globalThis as any).__CANVAS_SCAN_OPTS ?? {}) });
