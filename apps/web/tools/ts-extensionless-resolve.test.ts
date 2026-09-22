// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The resolve hook the `realistic:*` scripts run under — #478.
 *
 * No gate runs those scripts: they fetch from the internet and drive Blender.
 * So the two things that would break them silently are checked here instead —
 * that every `--import` a script names is a file inside this app, and that the
 * hook really does carry a script's own import graph.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('..', import.meta.url));

/** Every script in this app's `package.json`, by name. */
function scripts(): Readonly<Record<string, string>> {
  const manifest = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  return manifest.scripts ?? {};
}

/** The `--import` target of a `node` command line, if it has one. */
function importOf(command: string): string | undefined {
  return /--import\s+(\S+)/.exec(command)?.[1];
}

describe('the realistic scripts’ resolve hook — #478', () => {
  const realistic = Object.entries(scripts()).filter(([name]) => name.startsWith('realistic:'));

  it('finds the realistic scripts, so the checks below are over something', () => {
    expect(realistic.map(([name]) => name).sort()).toEqual([
      'realistic:fetch',
      'realistic:process',
      'realistic:stage',
    ]);
  });

  it('names a hook inside THIS app that exists, never another package’s tools', () => {
    for (const [name, command] of Object.entries(scripts())) {
      const hook = importOf(command);
      if (hook === undefined) continue;
      const path = resolve(WEB, hook);
      const inside = relative(WEB, path);
      expect(inside.startsWith('..'), `${name}: ${hook}`).toBe(false);
      expect(existsSync(path), `${name}: ${hook}`).toBe(true);
    }
    // Every realistic script has one: its own imports are extensionless.
    for (const [name, command] of realistic) expect(importOf(command), name).toBeDefined();
  });

  it('carries a script’s real, extensionless import graph under node', () => {
    // `process-assets.ts` imports `./fetch-assets` and `./sources` with no
    // extension, which is what the hook is for. Its `main` runs only when it
    // is the entry point, so importing it here fetches and runs nothing.
    const [, command] = realistic.find(([name]) => name === 'realistic:process') ?? [];
    const hook = importOf(command ?? '');
    expect(hook).toBeDefined();
    const run = (withHook: boolean) =>
      spawnSync(
        process.execPath,
        [
          ...(withHook ? ['--import', hook ?? ''] : []),
          '--input-type=module',
          '-e',
          "const m = await import('./tools/realistic/process-assets.ts'); console.log(typeof m);",
        ],
        { cwd: WEB, encoding: 'utf8', timeout: 30_000 },
      );
    const hooked = run(true);
    expect(hooked.stderr).toBe('');
    expect(hooked.stdout.trim()).toBe('object');
    // The control: without the hook the same import fails, so the pass above
    // is the hook's doing.
    const bare = run(false);
    expect(bare.status).not.toBe(0);
    expect(bare.stderr).toMatch(/ERR_MODULE_NOT_FOUND/);
  });
});
