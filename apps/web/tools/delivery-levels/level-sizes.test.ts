// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The levels' size ceilings — #2361, ADR 0065 D-3.2: 2 MiB a level file and
 * 8 MiB for all of them, the owner's (D-15 Q5), failing the app's build.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  LEVEL_FILE_MAX_BYTES,
  levelFileSizes,
  levelSizeFindings,
  levelSizes,
  LEVELS_TOTAL_MAX_BYTES,
} from './level-sizes';

const scratch = mkdtempSync(join(tmpdir(), 'oyl-level-sizes-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function directory(name: string, files: Record<string, number>): string {
  const path = join(scratch, name);
  mkdirSync(path, { recursive: true });
  for (const [file, bytes] of Object.entries(files)) {
    writeFileSync(join(path, file), new Uint8Array(bytes));
  }
  return path;
}

/** What the plugin says about `path` before a build: `undefined` when it lets the build go on. */
function beforeBuild(path: string, perFile: number, total: number): string | undefined {
  const hook = levelSizes(path, perFile, total).configResolved as () => void;
  try {
    hook();
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
}

describe('levelSizeFindings — #2361', () => {
  it('holds the ceilings at 2 MiB a level and 8 MiB in all until the owner raises them', () => {
    expect(LEVEL_FILE_MAX_BYTES).toBe(2 * 1024 * 1024);
    expect(LEVELS_TOTAL_MAX_BYTES).toBe(8 * 1024 * 1024);
  });

  it('passes files at both ceilings', () => {
    expect(
      levelSizeFindings(
        [
          { name: 'a.json', bytes: 100 },
          { name: 'b.json', bytes: 50 },
        ],
        100,
        150,
      ),
    ).toStrictEqual([]);
  });

  it('fails a level one byte over its ceiling, and levels one byte over theirs together', () => {
    expect(levelSizeFindings([{ name: 'a.json', bytes: 101 }], 100, 1000)).toStrictEqual([
      'a.json is 101 bytes, over the per-level ceiling of 100',
    ]);
    expect(
      levelSizeFindings(
        [
          { name: 'a.json', bytes: 100 },
          { name: 'b.json', bytes: 51 },
        ],
        100,
        150,
      ),
    ).toStrictEqual(['the level files are 151 bytes together, over the ceiling of 150']);
  });

  it('counts the JSON files directly in the directory and nothing else', () => {
    const path = directory('mixed', { 'a.json': 10, 'LICENCE-ODbL.txt': 500 });
    mkdirSync(join(path, 'below'));
    writeFileSync(join(path, 'below', 'b.json'), new Uint8Array(500));
    expect(levelFileSizes(path)).toStrictEqual([{ name: 'a.json', bytes: 10 }]);
    expect(levelFileSizes(join(scratch, 'absent'))).toStrictEqual([]);
  });
});

describe('levelSizes, the build’s plugin — #2361', () => {
  it('lets a build go on with no level files, which is #2361’s', () => {
    expect(beforeBuild(directory('empty', { 'LICENCE-ODbL.txt': 900 }), 100, 150)).toBeUndefined();
  });

  it('fails the build for a level over its ceiling, naming it', () => {
    expect(beforeBuild(directory('over', { 'big.json': 101 }), 100, 150)).toMatch(
      /cannot ship[\s\S]*big\.json is 101 bytes/,
    );
  });

  it('fails the build for levels over their ceiling together', () => {
    expect(beforeBuild(directory('together', { 'a.json': 80, 'b.json': 80 }), 100, 150)).toMatch(
      /160 bytes together/,
    );
  });

  it('runs in the build only', () => {
    expect(levelSizes(scratch).apply).toBe('build');
  });
});
