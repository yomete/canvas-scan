#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const importLine = "import 'canvas-scan/auto';\n";
const viteEntries = [
  'src/main.tsx',
  'src/main.jsx',
  'src/main.ts',
  'src/main.js',
  'src/index.tsx',
  'src/index.ts',
];

export function detectFramework(dir) {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(dir, 'package.json'), 'utf8'),
    );
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    if ('next' in dependencies) return 'next';
    if ('vite' in dependencies) return 'vite';
  } catch {
    return 'unknown';
  }

  return 'unknown';
}

function hasImport(file) {
  return fs.readFileSync(file, 'utf8').includes('canvas-scan/auto');
}

export function planInit(dir) {
  const projectDir = path.resolve(dir);
  const framework = detectFramework(projectDir);

  if (framework === 'vite') {
    const entry = viteEntries.find((file) =>
      fs.existsSync(path.join(projectDir, file)),
    );

    if (!entry) {
      return {
        framework,
        action: { kind: 'none', reason: 'No Vite entry file found.' },
        instructions:
          "Add import 'canvas-scan/auto'; as the first line of your Vite entry.",
      };
    }

    const file = path.join(projectDir, entry);
    if (hasImport(file)) {
      return {
        framework,
        action: { kind: 'none', reason: 'canvas-scan is already installed.' },
        instructions: `${entry} already imports canvas-scan/auto.`,
      };
    }

    return {
      framework,
      action: { kind: 'prepend', file, line: importLine },
      instructions: `Prepend ${JSON.stringify(importLine.trim())} to ${entry}.`,
    };
  }

  if (framework === 'next') {
    const file = path.join(projectDir, 'instrumentation-client.ts');

    if (!fs.existsSync(file)) {
      return {
        framework,
        action: { kind: 'create', file, content: importLine },
        instructions:
          'Create instrumentation-client.ts with the canvas-scan/auto import.',
      };
    }

    if (hasImport(file)) {
      return {
        framework,
        action: { kind: 'none', reason: 'canvas-scan is already installed.' },
        instructions:
          'instrumentation-client.ts already imports canvas-scan/auto.',
      };
    }

    return {
      framework,
      action: { kind: 'prepend', file, line: importLine },
      instructions:
        'Prepend the canvas-scan/auto import to instrumentation-client.ts.',
    };
  }

  return {
    framework,
    action: { kind: 'manual' },
    instructions:
      'Add the canvas-scan IIFE bundle as the first script tag on the page.',
  };
}

export function applyInit(plan, dir) {
  if (plan.action.kind === 'none') {
    return { changed: false, message: plan.action.reason };
  }

  if (plan.action.kind === 'manual') {
    return { changed: false, message: plan.instructions };
  }

  const file = path.resolve(dir, plan.action.file);

  if (fs.existsSync(file) && hasImport(file)) {
    return { changed: false, message: 'canvas-scan is already installed.' };
  }

  if (plan.action.kind === 'create') {
    fs.writeFileSync(file, plan.action.content);
    return { changed: true, message: `Created ${path.relative(dir, file)}.` };
  }

  fs.writeFileSync(file, plan.action.line + fs.readFileSync(file, 'utf8'));
  return { changed: true, message: `Updated ${path.relative(dir, file)}.` };
}

export function readVersion() {
  const binDir = path.dirname(fileURLToPath(import.meta.url));
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(binDir, '..', 'package.json'), 'utf8'),
  );
  return packageJson.version;
}

export function helpText() {
  return `Usage:
  canvas-scan init [dir] [--write]
  canvas-scan --help
  canvas-scan --version`;
}

export function run(args) {
  if (args.length === 0 || args[0] === '--help') {
    console.log(helpText());
    return 0;
  }

  if (args[0] === '--version') {
    console.log(readVersion());
    return 0;
  }

  if (args[0] !== 'init') {
    console.error(`Unknown command: ${args[0]}`);
    console.error(helpText());
    return 1;
  }

  const write = args.includes('--write');
  const positional = args.slice(1).filter((arg) => arg !== '--write');
  const dir = path.resolve(positional[0] ?? '.');
  const plan = planInit(dir);

  console.log(`Framework: ${plan.framework}`);
  if (plan.action.kind === 'prepend') {
    console.log(`Edit: prepend ${JSON.stringify(plan.action.line.trim())} to ${plan.action.file}`);
  } else if (plan.action.kind === 'create') {
    console.log(`Edit: create ${plan.action.file}`);
  } else if (plan.action.kind === 'none') {
    console.log(`Edit: none (${plan.action.reason})`);
  } else {
    console.log('Edit: manual');
  }
  console.log(plan.instructions);

  if (write) {
    console.log(applyInit(plan, dir).message);
  }

  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = run(process.argv.slice(2));
}
