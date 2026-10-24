// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DEMO_FORBIDDEN_PATHS,
  demoForbiddenModules,
  forbiddenModules,
  missingForbiddenPaths,
} from './forbidden-modules';

const REPOSITORY = fileURLToPath(new URL('../../../../', import.meta.url));

/** `scripts/check-wiring.mjs` §`TRAINER_COMMAND_SEAM`, read off the file rather than copied. */
function trainerCommandSeam(): string[] {
  const source = readFileSync(join(REPOSITORY, 'scripts/check-wiring.mjs'), 'utf8');
  const list = /^const TRAINER_COMMAND_SEAM = \[([\s\S]*?)\];/m.exec(source)?.[1] ?? '';
  return [...list.matchAll(/^\s*'([^']+)',/gm)].map((match) => match[1] ?? '');
}

type Hook = (this: { error: (message: string) => never }, ...args: unknown[]) => void;

function run(hook: unknown, ...args: unknown[]): void {
  (hook as Hook).call(
    {
      error(message: string): never {
        throw new Error(message);
      },
    },
    ...args,
  );
}

function chunk(...modules: string[]): unknown {
  return {
    type: 'chunk',
    fileName: 'assets/index.js',
    modules: Object.fromEntries(modules.map((id) => [id, {}])),
  };
}

describe('what the demo may never bundle — #1645', () => {
  it('names every module of the trainer-command seam', () => {
    const seam = trainerCommandSeam();
    expect(seam).toHaveLength(5);
    const named = DEMO_FORBIDDEN_PATHS.map((each) => each.path);
    for (const path of seam) {
      expect(named).toContain(path);
    }
  });

  it('names only paths that are there, so it cannot pass over nothing', () => {
    expect(missingForbiddenPaths(REPOSITORY)).toEqual([]);
    expect(
      missingForbiddenPaths(REPOSITORY, [{ path: 'apps/web/src/no-such-module.ts', why: '' }]),
    ).toEqual(['apps/web/src/no-such-module.ts']);
  });

  it('finds a seam module, a file under a forbidden directory and a forbidden package', () => {
    const found = forbiddenModules(
      [
        join(REPOSITORY, 'packages/sensors/protocol/src/fitness-machine-control.ts'),
        join(REPOSITORY, 'packages/sensors/web-bluetooth/src/transport.ts?worker'),
        join(REPOSITORY, 'apps/web/src/net/room-session.ts'),
        `${REPOSITORY}node_modules/.pnpm/dexie@4.4.6/node_modules/dexie/dist/dexie.mjs`,
      ],
      REPOSITORY,
    );
    expect(found).toHaveLength(4);
    expect(found[0]).toMatch(
      /^packages\/sensors\/protocol\/src\/fitness-machine-control\.ts \(the trainer-command seam/,
    );
    expect(found[1]).toMatch(/^packages\/sensors\/web-bluetooth\/src\/transport\.ts \(Bluetooth/);
    expect(found[2]).toMatch(/^apps\/web\/src\/net\/room-session\.ts \(rooms/);
    expect(found[3]).toMatch(/node_modules\/dexie\/dist\/dexie\.mjs \(the IndexedDB adapter/);
  });

  it('passes what the demo may use, including a sibling whose name only starts the same', () => {
    expect(
      forbiddenModules(
        [
          join(REPOSITORY, 'apps/web/src/demo/main.tsx'),
          join(REPOSITORY, 'apps/web/src/game/scene.ts'),
          join(REPOSITORY, 'apps/web/src/ride/trainer-target-memory.ts'),
          join(REPOSITORY, 'apps/web/src/network-words.ts'),
          join(REPOSITORY, 'packages/store/src/ids.ts'),
          `${REPOSITORY}node_modules/.pnpm/react@19.3.1/node_modules/react/index.js`,
          '\0vite/modulepreload-polyfill.js',
        ],
        REPOSITORY,
      ),
    ).toEqual([]);
  });

  it('fails the build when a chunk holds one', () => {
    const plugin = demoForbiddenModules(REPOSITORY);
    expect(() => {
      run(
        plugin.generateBundle,
        {},
        {
          'assets/index.js': chunk(
            join(REPOSITORY, 'apps/web/src/demo/main.tsx'),
            join(REPOSITORY, 'apps/web/src/ride/trainer.ts'),
          ),
        },
      );
    }).toThrow(
      /oyl-demo-forbidden-modules: .*\n {2}- apps\/web\/src\/ride\/trainer\.ts \(opens a trainer\)/,
    );
  });

  it('lets a build through that holds none, and ignores assets', () => {
    const plugin = demoForbiddenModules(REPOSITORY);
    expect(() => {
      run(
        plugin.generateBundle,
        {},
        {
          'assets/index.js': chunk(join(REPOSITORY, 'apps/web/src/demo/main.tsx')),
          'realistic/basis/basis_transcoder.wasm': { type: 'asset', fileName: 'x' },
        },
      );
    }).not.toThrow();
  });

  it('fails the build before it starts when a forbidden path has gone', () => {
    const empty = mkdtempSync(join(tmpdir(), 'oyl-demo-forbidden-'));
    try {
      expect(() => {
        run(demoForbiddenModules(empty).buildStart);
      }).toThrow(/name no file, so the check would pass over nothing/);
      expect(() => {
        run(demoForbiddenModules(REPOSITORY).buildStart);
      }).not.toThrow();
    } finally {
      rmSync(empty, { recursive: true });
    }
  });
});
