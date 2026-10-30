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
 *
 * #1632 (ADR 0055 D-7.2): the scan holds for a corridor that holds place
 * points, and the last case reads one through the port `main.tsx` builds: the
 * read asks the archive for nothing more than the same corridor without places
 * asks for, makes no other request, and no request carries a place's name.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { corridorTileCover } from '@onyourleft/map-features';
import { PLACE_SENTINEL, placesTile, sidewalkTile } from '@onyourleft/map-features/testing';
import { openActivityStore } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  resetFixtureIds,
  routeFor,
  seedAthletes,
} from '@onyourleft/store/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CORRIDOR_HALF_WIDTH_METRES } from '../game/world-data/corridor';
import {
  buildArchive,
  countingSource,
  tilesRequested,
  type ArchiveTile,
} from '../world-data/archive-testing';
import { createWorldCorridorPort } from '../world-data/corridor-port';
import { corridorArchiveFrom } from '../world-data/corridor-source';

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

describe('a corridor that holds places sends nothing more — #1632, ADR 0055 D-4, D-7.2', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Reads `route`'s corridor through the product's port over `tiles`, and what it asked for. */
  async function readOver(tile: () => Uint8Array) {
    resetFixtureIds();
    const harness = createStoreHarness();
    await seedAthletes(harness, [ATHLETE_A]);
    const route = routeFor(ATHLETE_A);
    await harness.write((store) => store.putRoute(route));
    const tiles: ArchiveTile[] = corridorTileCover(
      route.profile.positions,
      CORRIDOR_HALF_WIDTH_METRES + 2_000,
      2_000,
    ).map((at) => ({ x: at.x, y: at.y, bytes: tile() }));
    const bytes = await buildArchive({ tiles });
    const source = countingSource(bytes);
    const store = openActivityStore(harness.databaseName);
    try {
      const state = await createWorldCorridorPort({
        store,
        owner: ATHLETE_A,
        basemap: () => ({ archiveUrl: 'https://tiles.example.org/b.pmtiles', attribution: '' }),
        archive: () => corridorArchiveFrom(source),
        mapTilesOn: () => true,
        realisticOn: () => true,
        recording: () => false,
        now: () => new Date('2026-10-25T12:00:00Z'),
        yieldToIdle: () => Promise.resolve(),
      }).load({ id: route.id, profile: route.profile }, new AbortController().signal, () => {});
      return { state, calls: source.calls, requested: tilesRequested(tiles, bytes, source.calls) };
    } finally {
      store.close();
      await harness.destroy();
    }
  }

  it('asks the archive for the same tiles with places as without, and makes no other request', async () => {
    const fetches = vi.fn(() => Promise.reject(new TypeError('no network in this test')));
    vi.stubGlobal('fetch', fetches);
    const withPlaces = await readOver(placesTile);
    const without = await readOver(sidewalkTile);
    // Not vacuous: the read holds places, with names in the tiles they came from.
    expect(withPlaces.state.kind === 'ready' && withPlaces.state.corridor.places?.length).toBe(
      6 * withPlaces.requested.length,
    );
    expect(withPlaces.requested.length).toBeGreaterThan(0);
    expect(withPlaces.requested).toStrictEqual(without.requested);
    expect(withPlaces.calls.length).toBe(without.calls.length);
    expect(fetches).not.toHaveBeenCalled();
    expect(JSON.stringify(withPlaces.calls)).not.toContain(PLACE_SENTINEL);
    expect(JSON.stringify(withPlaces.state)).not.toContain(PLACE_SENTINEL);
  });
});
