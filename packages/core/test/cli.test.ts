// @ts-nocheck The zero-dependency CLI does not add Node type dependencies.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as cli from '../bin/canvas-scan.mjs';

const { applyInit, detectFramework, planInit, readVersion } = cli;

const fixtures: string[] = [];

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-'));
  fixtures.push(dir);
  return dir;
}

// A package is installed when a real manifest is present, not when a directory
// with the right name exists.
function installPackage(dir: string) {
  const target = path.join(dir, 'node_modules/canvas-scan');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(
    path.join(target, 'package.json'),
    JSON.stringify({ name: 'canvas-scan', version: '0.2.0' }),
  );
}

function writePackageJson(dir: string, contents: object) {
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(contents),
  );
}

afterEach(() => {
  for (const dir of fixtures.splice(0)) {
    fs.rmSync(dir, { recursive: true });
  }
});

describe('canvas-scan init CLI', () => {
  it('installs once as the first import in a Vite entry', () => {
    const dir = fixture();
    writePackageJson(dir, { devDependencies: { vite: '^7.0.0' } });
    fs.mkdirSync(path.join(dir, 'src'));
    const entry = path.join(dir, 'src/main.tsx');
    fs.writeFileSync(entry, "import React from 'react';\nrender();\n");

    expect(detectFramework(dir)).toBe('vite');
    const plan = planInit(dir);
    expect(plan.action.kind).toBe('prepend');
    expect(applyInit(plan, dir).changed).toBe(true);
    expect(fs.readFileSync(entry, 'utf8').split('\n')[0]).toBe(
      "import 'canvas-scan/auto';",
    );

    const repeatedPlan = planInit(dir);
    expect(repeatedPlan.action.kind).toBe('none');
    expect(applyInit(repeatedPlan, dir).changed).toBe(false);
    expect(
      fs.readFileSync(entry, 'utf8').match(/canvas-scan\/auto/g),
    ).toHaveLength(1);
  });

  it('does not call an import without the dependency "already installed"', () => {
    const dir = fixture();
    writePackageJson(dir, { devDependencies: { vite: '^7.0.0' } });
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(
      path.join(dir, 'src/main.tsx'),
      "import 'canvas-scan/auto';\nrender();\n",
    );

    const plan = planInit(dir);
    expect(plan.install).toBe('npm install -D canvas-scan');
    expect(plan.action.reason).toBe(
      'the import is already there, but canvas-scan is not in package.json yet.',
    );
    expect(applyInit(plan, dir).message).toBe(plan.action.reason);
  });

  it('reports a genuinely installed project as already installed', () => {
    const dir = fixture();
    writePackageJson(dir, {
      devDependencies: { vite: '^7.0.0', 'canvas-scan': '^0.2.0' },
    });
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(
      path.join(dir, 'src/main.tsx'),
      "import 'canvas-scan/auto';\nrender();\n",
    );
    installPackage(dir);

    const plan = planInit(dir);
    expect(plan.install).toBeNull();
    expect(plan.action.reason).toBe('canvas-scan is already installed.');
  });

  it('treats a declared but uninstalled dependency as needing an install', () => {
    const dir = fixture();
    writePackageJson(dir, {
      devDependencies: { vite: '^7.0.0', 'canvas-scan': '^0.2.0' },
    });
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(
      path.join(dir, 'src/main.tsx'),
      "import 'canvas-scan/auto';\nrender();\n",
    );

    // Declared in package.json, never installed — a fresh clone.
    expect(planInit(dir).install).toBe('npm install -D canvas-scan');
  });

  it('does not mistake a commented mention for a real import', () => {
    const dir = fixture();
    writePackageJson(dir, { devDependencies: { vite: '^7.0.0' } });
    fs.mkdirSync(path.join(dir, 'src'));
    const entry = path.join(dir, 'src/main.tsx');
    fs.writeFileSync(
      entry,
      "// TODO: add import 'canvas-scan/auto';\nrender();\n",
    );

    const plan = planInit(dir);
    expect(plan.action.kind).toBe('prepend');
    expect(applyInit(plan, dir).changed).toBe(true);
    expect(fs.readFileSync(entry, 'utf8').split('\n')[0]).toBe(
      "import 'canvas-scan/auto';",
    );
  });

  it('does not mistake an import in a block comment for a real import', () => {
    const dir = fixture();
    writePackageJson(dir, { devDependencies: { vite: '^7.0.0' } });
    fs.mkdirSync(path.join(dir, 'src'));
    const entry = path.join(dir, 'src/main.tsx');
    fs.writeFileSync(
      entry,
      "/*\nimport 'canvas-scan/auto';\n*/\nrender();\n",
    );

    expect(planInit(dir).action.kind).toBe('prepend');
  });

  it('does not mistake an import in a template literal for a real import', () => {
    const dir = fixture();
    writePackageJson(dir, { devDependencies: { vite: '^7.0.0' } });
    fs.mkdirSync(path.join(dir, 'src'));
    const entry = path.join(dir, 'src/main.tsx');
    fs.writeFileSync(
      entry,
      "const example = `\nimport 'canvas-scan/auto';\n`;\nrender();\n",
    );

    expect(planInit(dir).action.kind).toBe('prepend');
  });

  it('recognises the import forms an entry file actually uses', () => {
    const forms = [
      "import 'canvas-scan/auto';",
      'import "canvas-scan/auto"',
      "import {} from 'canvas-scan/auto';",
      "import/* boot */'canvas-scan/auto';",
      "require ('canvas-scan/auto');",
      "const _ = require('canvas-scan/auto');",
    ];

    for (const form of forms) {
      const dir = fixture();
      writePackageJson(dir, { devDependencies: { vite: '^7.0.0' } });
      fs.mkdirSync(path.join(dir, 'src'));
      fs.writeFileSync(path.join(dir, 'src/main.tsx'), `${form}\nrender();\n`);

      expect(planInit(dir).action.kind, form).toBe('none');
    }
  });

  it('does not let a stale node_modules directory pass as installed', () => {
    const dir = fixture();
    writePackageJson(dir, {
      devDependencies: { vite: '^7.0.0', 'canvas-scan': '^0.2.0' },
    });
    const stale = path.join(dir, 'node_modules/canvas-scan');
    fs.mkdirSync(stale, { recursive: true });
    // A manifest for something else entirely.
    fs.writeFileSync(
      path.join(stale, 'package.json'),
      JSON.stringify({ name: 'not-canvas-scan', version: '1.0.0' }),
    );

    expect(planInit(dir).install).toBe('npm install -D canvas-scan');
  });

  it('creates a Next.js instrumentation client once', () => {
    const dir = fixture();
    writePackageJson(dir, { dependencies: { next: '^15.3.0' } });

    expect(detectFramework(dir)).toBe('next');
    const plan = planInit(dir);
    expect(plan.action.kind).toBe('create');
    expect(applyInit(plan, dir).changed).toBe(true);
    expect(
      fs.readFileSync(path.join(dir, 'instrumentation-client.ts'), 'utf8'),
    ).toBe("import 'canvas-scan/auto';\n");
    expect(applyInit(plan, dir).changed).toBe(false);
  });

  it('prepends the import to an existing Next.js instrumentation client', () => {
    const dir = fixture();
    writePackageJson(dir, { dependencies: { next: '^15.3.0' } });
    const instrumentation = path.join(dir, 'instrumentation-client.ts');
    fs.writeFileSync(instrumentation, 'export const value = true;\n');

    const plan = planInit(dir);
    expect(plan.action.kind).toBe('prepend');
    expect(applyInit(plan, dir).changed).toBe(true);
    expect(fs.readFileSync(instrumentation, 'utf8')).toBe(
      "import 'canvas-scan/auto';\nexport const value = true;\n",
    );
  });

  it('provides script tag instructions for an unknown project', () => {
    const dir = fixture();

    expect(detectFramework(dir)).toBe('unknown');
    const plan = planInit(dir);
    expect(plan.action.kind).toBe('manual');
    expect(plan.instructions).toMatch(/script tag/i);
  });

  it('reads the package version', () => {
    const pkg = JSON.parse(
      fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );
    expect(readVersion()).toBe(pkg.version);
  });

  it('runtime sources carry the package version', () => {
    const pkg = JSON.parse(
      fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );
    const indexSource = fs.readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    const recordingSource = fs.readFileSync(new URL('../src/recording.ts', import.meta.url), 'utf8');
    expect(indexSource).toContain(`version: '${pkg.version}'`);
    expect(recordingSource).toContain(`canvasScanVersion: '${pkg.version}'`);
  });

  it('plans the npm install command when canvas-scan is missing', () => {
    const dir = fixture();
    writePackageJson(dir, {});

    expect(planInit(dir).install).toBe('npm install -D canvas-scan');
  });

  it('plans the pnpm install command when a pnpm lockfile exists', () => {
    const dir = fixture();
    writePackageJson(dir, {});
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');

    expect(planInit(dir).install).toBe('pnpm add -D canvas-scan');
  });

  it('plans the yarn install command when a yarn lockfile exists', () => {
    const dir = fixture();
    writePackageJson(dir, {});
    fs.writeFileSync(path.join(dir, 'yarn.lock'), '');

    expect(planInit(dir).install).toBe('yarn add -D canvas-scan');
  });

  it('does not plan an install when canvas-scan is present', () => {
    const dir = fixture();
    writePackageJson(dir, {
      devDependencies: { 'canvas-scan': '^0.1.0' },
    });
    installPackage(dir);

    expect(planInit(dir).install).toBeNull();
  });

  it('creates the instrumentation client for Next 15.3', () => {
    const dir = fixture();
    writePackageJson(dir, { dependencies: { next: '^15.3.0' } });

    expect(planInit(dir).action.kind).toBe('create');
  });

  it('provides manual instructions for Next versions before 15.3', () => {
    const dir = fixture();
    writePackageJson(dir, { dependencies: { next: '^14.2.0' } });

    const plan = planInit(dir);
    expect(plan.action.kind).toBe('manual');
    expect(plan.instructions).toContain(
      'instrumentation-client.ts requires Next 15.3+',
    );
  });

  it('provides manual instructions for unverified Next versions', () => {
    const dir = fixture();
    writePackageJson(dir, { dependencies: { next: 'latest' } });

    const plan = planInit(dir);
    expect(plan.action.kind).toBe('manual');
    expect(plan.instructions).toContain(
      "detected next version spec 'latest' — could not verify >= 15.3",
    );
  });
});

describe('next compound-range gate', () => {
  it('treats compound ranges as unverifiable', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { planInit } = await import('../bin/canvas-scan.mjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-range-'));
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        dependencies: { next: '^15.3.0 || ^14.2.0', 'canvas-scan': '*' },
      }),
    );
    const plan = planInit(dir);
    expect(plan.action.kind).toBe('manual');
    expect(plan.instructions).toContain('could not verify');
  });
});

describe('next gate: prerelease and malformed specs', () => {
  async function planFor(spec: string) {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { planInit } = await import('../bin/canvas-scan.mjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-prerel-'));
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ dependencies: { next: spec, 'canvas-scan': '*' } }),
    );
    return planInit(dir);
  }

  it('treats a prerelease spec as unverifiable (orders below stable)', async () => {
    const plan = await planFor('15.3.0-beta');
    expect(plan.action.kind).toBe('manual');
    expect(plan.instructions).toContain('could not verify');
  });

  it('treats a malformed spec as unverifiable', async () => {
    const plan = await planFor('15.3.foo');
    expect(plan.action.kind).toBe('manual');
  });
});

describe('next gate: stacked comparators', () => {
  it('treats stacked comparator prefixes as unverifiable', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { planInit } = await import('../bin/canvas-scan.mjs');
    for (const spec of ['^>=15.3.0', '~>=15.3.0']) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-stack-'));
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ dependencies: { next: spec, 'canvas-scan': '*' } }),
      );
      const plan = planInit(dir);
      expect(plan.action.kind).toBe('manual');
      expect(plan.instructions).toContain('could not verify');
    }
  });
});

describe('canvas-scan init CLI: entry candidates and reporting', () => {
  it('finds a plain-JavaScript src/index.js entry', () => {
    const dir = fixture();
    writePackageJson(dir, { devDependencies: { vite: '^7.0.0' } });
    installPackage(dir);
    fs.mkdirSync(path.join(dir, 'src'));
    // src/index.ts was a candidate while its JavaScript sibling was not, so a
    // plain-JavaScript project using this entry was told no entry existed.
    fs.writeFileSync(path.join(dir, 'src/index.js'), 'console.log(1);\n');

    const plan = planInit(dir);

    expect(plan.action).toMatchObject({ kind: 'prepend', file: path.join(dir, 'src/index.js') });
    expect(applyInit(plan, dir)).toMatchObject({ changed: true });
    expect(fs.readFileSync(path.join(dir, 'src/index.js'), 'utf8').split('\n')[0])
      .toBe("import 'canvas-scan/auto';");
  });

  it('finds src/index.jsx as well', () => {
    const dir = fixture();
    writePackageJson(dir, { devDependencies: { vite: '^7.0.0' } });
    installPackage(dir);
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src/index.jsx'), 'export {};\n');

    expect(planInit(dir).action).toMatchObject({ kind: 'prepend', file: path.join(dir, 'src/index.jsx') });
  });

  it('reports a write failure instead of throwing a stack trace', () => {
    const dir = fixture();
    writePackageJson(dir, { devDependencies: { vite: '^7.0.0' } });
    installPackage(dir);
    fs.mkdirSync(path.join(dir, 'src'));
    const entry = path.join(dir, 'src/main.ts');
    fs.writeFileSync(entry, 'export {};\n');
    fs.chmodSync(entry, 0o444);
    const errors: string[] = [];
    const logs: string[] = [];
    const originalError = console.error;
    const originalLog = console.log;
    console.error = (...args: unknown[]) => { errors.push(args.join(' ')); };
    console.log = (...args: unknown[]) => { logs.push(args.join(' ')); };

    try {
      const code = cli.run(['init', dir, '--write']);
      expect(code).toBe(1);
      expect(errors.join('\n')).toContain('Could not write:');
      expect(errors.join('\n')).not.toContain('at ');
    } finally {
      console.error = originalError;
      console.log = originalLog;
      fs.chmodSync(entry, 0o644);
    }
  });

  it('prints the instructions once with --write', () => {
    const dir = fixture();
    // No manifest at all, so the framework is unknown and the plan is manual.
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(' ')); };
    try {
      expect(cli.run(['init', dir, '--write'])).toBe(0);
    } finally {
      console.log = originalLog;
    }
    const plan = planInit(dir);
    const repeated = logs.filter(line => line === plan.instructions);
    expect(repeated).toHaveLength(1);
  });
});
