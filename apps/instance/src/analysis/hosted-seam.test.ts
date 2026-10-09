// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **One seam** (#1101, the `hosted-mask-reachable.test.ts` shape, ported):
 * the hosted connection (`model.ts` §`createHostedModel`) is built by
 * `hosted.ts` and by no other shipped module of the instance, and
 * `hosted.ts` builds it only inside `maskedConnection`, with a guard.
 *
 * Every shipped `.ts` under `src/` is read and searched for the name, so a
 * new module that builds a hosted request without the masking is a red build
 * whichever directory it is in. Tests and `-testing.ts` support may name it:
 * the control in `hosted.test.ts` builds an unmasked connection on purpose.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, '..');

/** Every shipped module under `directory`, at any depth. */
function shippedUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return shippedUnder(path);
    return entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('-testing.ts')
      ? [path]
      : [];
  });
}

/** The modules, relative to `src/`, whose source names the hosted connection's constructor. */
function naming(files: Readonly<Record<string, string>>): string[] {
  return Object.entries(files)
    .filter(([, source]) => /\bcreateHostedModel\b/.test(source))
    .map(([path]) => path)
    .sort();
}

/** Where `hosted.ts` builds the hosted connection: inside `maskedConnection`, or not. */
function buildsBehindMasking(source: string): boolean {
  const calls = [...source.matchAll(/\bcreateHostedModel\s*\(/g)];
  return (
    calls.length > 0 &&
    calls.every((call) =>
      /maskedConnection\(\s*$/.test(source.slice(Math.max(0, call.index - 40), call.index)),
    )
  );
}

describe('the hosted connection is built in one place, behind the masking (#1101)', () => {
  const files = Object.fromEntries(
    shippedUnder(SOURCE).map((path) => [relative(SOURCE, path), readFileSync(path, 'utf8')]),
  );

  it('walks every shipped module, and only model.ts (its definition) and hosted.ts name it', () => {
    expect(Object.keys(files).length).toBeGreaterThan(50);
    expect(naming(files)).toStrictEqual(['analysis/hosted.ts', 'analysis/model.ts']);
  });

  it('hosted.ts builds it only as maskedConnection’s inner connection', () => {
    expect(buildsBehindMasking(files['analysis/hosted.ts'] ?? '')).toBe(true);
  });

  it('finds a module that builds it elsewhere, and one that builds it unmasked — the controls', () => {
    expect(
      naming({
        'analysis/model.ts': 'export function createHostedModel() {}',
        'analysis/hosted.ts': 'maskedConnection(createHostedModel({}), guard)',
        'analysis/jobs.ts': "import { createHostedModel } from './model.ts';",
      }),
    ).toStrictEqual(['analysis/hosted.ts', 'analysis/jobs.ts', 'analysis/model.ts']);
    expect(buildsBehindMasking('return createHostedModel({ baseUrl });')).toBe(false);
    expect(
      buildsBehindMasking('return maskedConnection(\n    createHostedModel({ baseUrl }),'),
    ).toBe(true);
  });
});
