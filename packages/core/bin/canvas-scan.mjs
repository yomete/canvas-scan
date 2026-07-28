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
  const dependencies = readDependencies(dir);

  if ('next' in dependencies) return 'next';
  if ('vite' in dependencies) return 'vite';
  return 'unknown';
}

function hasImport(file) {
  const source = fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, '');

  // Match the import statement itself after removing multiline constructs
  // whose contents can begin at the start of a line.
  return /^[ \t]*(?:import\s+['"]canvas-scan\/auto['"]|(?:const|let|var)[^\n=]*=\s*require\(\s*['"]canvas-scan\/auto['"]\s*\)|require\(\s*['"]canvas-scan\/auto['"]\s*\))/m.test(
    source,
  );
}

function readDependencies(dir) {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(dir, 'package.json'), 'utf8'),
    );
    return {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };
  } catch {
    return {};
  }
}

// A dependency entry is a declaration, not an installation, and a bare
// directory is not a package. Walk up the way Node does, and require a real
// manifest. Yarn Plug'n'Play installs resolve without any node_modules
// directory and are reported as missing here.
function isInstalled(dir) {
  for (let current = path.resolve(dir); ; ) {
    if (
      fs.existsSync(path.join(current, 'node_modules/canvas-scan/package.json'))
    ) {
      return true;
    }
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function installCommand(dir, dependencies) {
  if ('canvas-scan' in dependencies && isInstalled(dir)) return null;
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) {
    return 'pnpm add -D canvas-scan';
  }
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) {
    return 'yarn add -D canvas-scan';
  }
  return 'npm install -D canvas-scan';
}

function minimumNextVersion(spec) {
  // Only a SINGLE simple spec is verifiable; compound ranges (||, hyphen
  // ranges, space-separated comparators) can admit versions below the
  // first token's minimum, so they are conservatively unverifiable.
  // Numeric-only tail: prerelease suffixes (15.3.0-beta orders BELOW
  // 15.3.0) and malformed specs (15.3.foo) are conservatively unverifiable.
  const single = spec.trim().match(/^(?:[\^~]|>=)?v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/i);
  if (!single) return null;
  const minor = single[2];
  return {
    major: Number(single[1]),
    minor: minor === undefined || minor === 'x' || minor === '*' ? 0 : Number(minor),
  };
}

// An import line does not mean the package is there to import. `install` is
// null exactly when canvas-scan is already a dependency, so it decides which
// of the two situations we are actually in.
function alreadyImportedReason(install) {
  return install === null
    ? 'canvas-scan is already installed.'
    : 'the import is already there, but canvas-scan is not in package.json yet.';
}

function nextManualInstructions(spec, unparseable) {
  const detection = unparseable
    ? `detected next version spec '${spec}' — could not verify >= 15.3. `
    : '';
  return `${detection}instrumentation-client.ts requires Next 15.3+. Add import 'canvas-scan/auto' as the FIRST import of your custom App/entry, or add a <Script strategy="beforeInteractive"> tag.`;
}

export function planInit(dir) {
  const projectDir = path.resolve(dir);
  const framework = detectFramework(projectDir);
  const dependencies = readDependencies(projectDir);
  const install = installCommand(projectDir, dependencies);

  if (framework === 'vite') {
    const entry = viteEntries.find((file) =>
      fs.existsSync(path.join(projectDir, file)),
    );

    if (!entry) {
      return {
        framework,
        install,
        action: { kind: 'none', reason: 'No Vite entry file found.' },
        instructions:
          "Add import 'canvas-scan/auto'; as the first line of your Vite entry.",
      };
    }

    const file = path.join(projectDir, entry);
    if (hasImport(file)) {
      return {
        framework,
        install,
        action: { kind: 'none', reason: alreadyImportedReason(install) },
        instructions: `${entry} already imports canvas-scan/auto.`,
      };
    }

    return {
      framework,
      install,
      action: { kind: 'prepend', file, line: importLine },
      instructions: `Prepend ${JSON.stringify(importLine.trim())} to ${entry}.`,
    };
  }

  if (framework === 'next') {
    const spec = dependencies.next;
    const version = minimumNextVersion(spec);
    if (
      version === null ||
      version.major < 15 ||
      (version.major === 15 && version.minor < 3)
    ) {
      return {
        framework,
        install,
        action: { kind: 'manual' },
        instructions: nextManualInstructions(spec, version === null),
      };
    }

    const file = path.join(projectDir, 'instrumentation-client.ts');

    if (!fs.existsSync(file)) {
      return {
        framework,
        install,
        action: { kind: 'create', file, content: importLine },
        instructions:
          'Create instrumentation-client.ts with the canvas-scan/auto import.',
      };
    }

    if (hasImport(file)) {
      return {
        framework,
        install,
        action: { kind: 'none', reason: alreadyImportedReason(install) },
        instructions:
          'instrumentation-client.ts already imports canvas-scan/auto.',
      };
    }

    return {
      framework,
      install,
      action: { kind: 'prepend', file, line: importLine },
      instructions:
        'Prepend the canvas-scan/auto import to instrumentation-client.ts.',
    };
  }

  return {
    framework,
    install,
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
    return { changed: false, message: alreadyImportedReason(plan.install) };
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
  if (plan.install) {
    console.log(`Required: ${plan.install}`);
  }
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

function isMainModule() {
  if (!process.argv[1]) return false;
  // node resolves the module URL through symlinks (macOS tmpdir is
  // /var -> /private/var), so argv[1] must be realpathed before comparing.
  let entry = process.argv[1];
  try {
    entry = fs.realpathSync(entry);
  } catch {
    return false;
  }
  return import.meta.url === pathToFileURL(entry).href;
}

if (isMainModule()) {
  process.exitCode = run(process.argv.slice(2));
}
