// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Nothing that talks to an instance names the world corridor store** —
 * #1545, ADR 0054 D-3.5.
 *
 * The corridor store holds ODbL 1.0 data, and the only thing keeping ODbL
 * §4.4's share-alike from engaging is that none of it is ever Publicly Used:
 * it never leaves the device. An instance is the road out — sync, a write-up's
 * context, anything the instance stores — so this holds the line in source:
 * no module under `apps/web/src/instance/` and none under `apps/instance/`
 * names `worldCorridors`, `getWorldCorridor` or `WorldCorridorRecord`.
 *
 * A documented ban is not a gate (CLAUDE.md §8), and a scan that finds nothing
 * because it read nothing is no gate either: the walk must read files, and a
 * planted name must be found.
 *
 * ⚠️ This is a source scan, not a proof: a module could reach the store under
 * another name. ADR 0054 D-3.5's payload test (#1539: every export, sync and
 * write-up payload built from a populated store, with no byte of it inside) is
 * the one that reads what is actually sent.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** The names that reach the store. Any of them in a module is that module reaching it. */
const CORRIDOR_NAMES = ['worldCorridors', 'getWorldCorridor', 'WorldCorridorRecord'] as const;

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** The two trees an instance's traffic is built in. */
const INSTANCE_TREES = [
  fileURLToPath(new URL('../instance', import.meta.url)),
  fileURLToPath(new URL('../../../instance', import.meta.url)),
] as const;

/** Never source: installed packages and build output. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '.wrangler', 'coverage']);

/** Every file under `root`, skipping what is not this project's source. */
function filesUnder(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        found.push(...filesUnder(path));
      }
    } else if (entry.isFile()) {
      found.push(path);
    }
  }
  return found;
}

/** The corridor names `source` mentions, in {@link CORRIDOR_NAMES} order. */
function corridorNamesIn(source: string): string[] {
  return CORRIDOR_NAMES.filter((name) => source.includes(name));
}

describe('no instance module names the world corridor store — #1545', () => {
  it('reads the instance trees at all', () => {
    // A walk that found nothing would make the next assertion pass vacuously.
    for (const tree of INSTANCE_TREES) {
      expect(filesUnder(tree).length, relative(REPOSITORY_ROOT, tree)).toBeGreaterThan(10);
    }
  });

  it('finds a planted name, so the scan can go red', () => {
    expect(
      corridorNamesIn('const rows = await store.getWorldCorridor(owner, route);'),
    ).toStrictEqual(['getWorldCorridor']);
    expect(corridorNamesIn("db.table('worldCorridors')")).toStrictEqual(['worldCorridors']);
    expect(corridorNamesIn('type Row = WorldCorridorRecord;')).toStrictEqual([
      'WorldCorridorRecord',
    ]);
    expect(corridorNamesIn('const corridor = buildRoute();')).toStrictEqual([]);
  });

  it('finds none in apps/web/src/instance/ or apps/instance/', () => {
    const offenders = INSTANCE_TREES.flatMap(filesUnder).flatMap((file) => {
      const names = corridorNamesIn(readFileSync(file, 'utf8'));
      return names.length === 0 ? [] : [`${relative(REPOSITORY_ROOT, file)}: ${names.join(', ')}`];
    });
    expect(
      offenders,
      'the world corridor store is ODbL data that never leaves the device (ADR 0054 D-3.5)',
    ).toStrictEqual([]);
  });
});
