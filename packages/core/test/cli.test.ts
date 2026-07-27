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

  it('creates a Next.js instrumentation client once', () => {
    const dir = fixture();
    writePackageJson(dir, { dependencies: { next: '^15.0.0' } });

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
    writePackageJson(dir, { dependencies: { next: '^15.0.0' } });
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
    expect(readVersion()).toBe('0.1.0');
  });
});
