// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The resolve hook (#780): a real `node` loads `@onyourleft/physics` — whose
 * relative imports name no extension — with it, and cannot without it.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { candidatesFor } from './node-imports.ts';

const INSTANCE = fileURLToPath(new URL('..', import.meta.url));
const HOOK = new URL('./node-imports.ts', import.meta.url).href;

function load(register: boolean): { status: number | null; output: string } {
  const code = [
    register
      ? `import { registerHooks } from 'node:module'; const { resolveExtensionless } = await import(${JSON.stringify(HOOK)}); registerHooks({ resolve: resolveExtensionless });`
      : '',
    // The room core's three packages, and a name from each, so a module that
    // resolved to the wrong file would not have the export.
    `const physics = await import('@onyourleft/physics');`,
    `const domain = await import('@onyourleft/domain');`,
    `const protocol = await import('@onyourleft/protocol');`,
    `if (typeof physics.advanceRider !== 'function' || typeof domain.watts !== 'function' || typeof protocol.encodeMessage !== 'function') process.exit(3);`,
  ].join('\n');
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: INSTANCE,
    encoding: 'utf8',
    timeout: 30_000,
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

describe('Node loads the workspace packages the room core needs', () => {
  it('with the hook: all three load and have the exports the core uses', () => {
    const run = load(true);
    expect(run.output).toBe('');
    expect(run.status).toBe(0);
  });

  it('without it: Node refuses the first extensionless import — the problem the hook exists for', () => {
    const run = load(false);
    expect(run.status).not.toBe(0);
    expect(run.output).toContain('ERR_MODULE_NOT_FOUND');
  });
});

describe('what the hook will try, and what it will not', () => {
  const parent = 'file:///repo/packages/physics/src/index.ts';

  it('tries the file, then the directory index, for an extensionless relative import', () => {
    expect(candidatesFor('./tick', parent)).toEqual(['./tick.ts', './tick/index.ts']);
    expect(candidatesFor('../air', parent)).toEqual(['../air.ts', '../air/index.ts']);
  });

  it('tries nothing for a bare name, a named extension, or a parent that is not TypeScript', () => {
    expect(candidatesFor('kysely', parent)).toEqual([]);
    expect(candidatesFor('./tick.js', parent)).toEqual([]);
    expect(candidatesFor('./tick', 'file:///repo/x.js')).toEqual([]);
    expect(candidatesFor('./tick', undefined)).toEqual([]);
  });
});
