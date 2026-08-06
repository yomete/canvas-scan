import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cwd = path.dirname(fileURLToPath(import.meta.url));
const probes = ['probe:reset', 'probe:recording', 'probe:burst-heavy', 'probe:continuous-repeated', 'probe:resize-churn', 'probe:backing-store', 'probe:lifecycle', 'probe:associations', 'probe:findings'];
let failed = false;

for (const probe of probes) {
  const result = spawnSync('pnpm', ['run', probe], { cwd, stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}

process.exitCode = failed ? 1 : 0;
