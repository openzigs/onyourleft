// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The account export carries no world corridor** — #1545, ADR 0054 D-3.5.
 *
 * The corridor store is ODbL 1.0 data that never leaves the device: an export
 * a rider can hand to anyone is the most direct way out, so this runs the
 * Files screen's own `exportEverything` over an account that holds a corridor
 * and reads every file it produced for any trace of one — the table's name,
 * the corridor's own fields, a feature value as the decoded JSON spells it,
 * and the packed bytes themselves, raw or in base64.
 *
 * #1632 (ADR 0055 D-7.2): the corridor holds place points — the fixture's,
 * and in the last export case ones the product decoded and packed from tiles
 * whose places carry a name — and none of them, nor the name, is exported.
 */

import {
  ATHLETE_A,
  createStoreHarness,
  resetFixtureIds,
  rideFor,
  routeFor,
  seedAthletes,
  streamSetFor,
  worldCorridorFeaturesFor,
  worldCorridorFor,
} from '@onyourleft/store/testing';
import { decodeTile } from '@onyourleft/map-features';
import {
  FIXTURE_FRAME,
  FIXTURE_TILE,
  PLACE_SENTINEL,
  placesTile,
} from '@onyourleft/map-features/testing';
import { TABLE, type WorldCorridorRecord } from '@onyourleft/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { packCorridorFeatures } from '../game/world-data/corridor';
import { exportEverything } from './export-everything';
import type { DownloadableFile } from './store-port';

let harness: ReturnType<typeof createStoreHarness>;

beforeEach(() => {
  resetFixtureIds();
  harness = createStoreHarness();
});

afterEach(async () => {
  await harness.destroy();
});

/** Every number in the decoded features, spelled as JSON spells it. */
function featureValues(): string[] {
  const values = new Set<string>();
  JSON.stringify(worldCorridorFeaturesFor(ATHLETE_A), (_key, value: unknown) => {
    if (typeof value === 'number' && !Number.isInteger(value)) {
      values.add(JSON.stringify(value));
    }
    return value;
  });
  return [...values];
}

/** Whether `needle` occurs in `haystack` as a run of bytes. */
function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[start + index] !== needle[index]) continue outer;
    }
    return true;
  }
  return false;
}

/** What of the corridor appears in `files`, named so a failure says which. */
async function tracesOf(
  corridor: WorldCorridorRecord,
  files: readonly DownloadableFile[],
): Promise<string[]> {
  const packed = new Uint8Array(await corridor.features.arrayBuffer());
  // A run from inside the gzip body, past its fixed ten-byte header, which
  // any gzip file shares.
  const run = packed.slice(10, 42);
  let binary = '';
  for (const byte of packed) binary += String.fromCharCode(byte);
  const base64 = btoa(binary);
  const markers = [
    TABLE.worldCorridors,
    'ODbL-1.0',
    corridor.routeDigest,
    corridor.archive.identity,
    corridor.readAt,
    PLACE_SENTINEL,
    base64.slice(16, 56),
    ...featureValues(),
  ];
  const found: string[] = [];
  for (const file of files) {
    const text = new TextDecoder('latin1').decode(file.bytes);
    for (const marker of markers) {
      if (text.includes(marker)) found.push(`${file.fileName}: ${marker}`);
    }
    if (containsBytes(file.bytes, run)) found.push(`${file.fileName}: the packed features`);
  }
  return found;
}

/** A corridor's features as the product packs them, from a tile whose places carry names (#1632). */
async function packedPlaces(): Promise<Blob> {
  const decoded = decodeTile(placesTile(), FIXTURE_TILE, FIXTURE_FRAME);
  if ('reason' in decoded) throw new Error(decoded.reason);
  expect(decoded.places.length).toBeGreaterThan(0);
  return packCorridorFeatures({
    landUse: [],
    buildings: [],
    paths: [],
    streets: [],
    places: decoded.places,
  });
}

describe('the account export carries no world corridor — #1545', () => {
  it.each([
    ['fit', 'fixture'],
    ['gpx', 'fixture'],
    ['tcx', 'fixture'],
    ['fit', 'decoded places'],
  ] as const)(
    'finds no trace of one in any file of a %s export, its features the %s',
    async (format, features) => {
      await seedAthletes(harness);
      const route = routeFor(ATHLETE_A);
      const ride = rideFor(ATHLETE_A, { routeId: route.id, hasPosition: true });
      const corridor = await worldCorridorFor(
        ATHLETE_A,
        route.id,
        features === 'fixture' ? {} : { features: await packedPlaces() },
      );
      await harness.write(async (store) => {
        await store.putRoute(route);
        await store.putActivity(ride);
        await store.putStreamSet(streamSetFor(ride, { sampleCount: 60 }));
        await store.putWorldCorridor(corridor);
      });

      const files: DownloadableFile[] = [];
      const report = await harness.read(async (store) => {
        // The corridor is there to be found: the export ran over an account
        // that holds one, not over an empty table.
        await expect(store.getWorldCorridor(ATHLETE_A, route.id)).resolves.toBeDefined();
        return exportEverything({
          store,
          athleteId: ATHLETE_A,
          format,
          onFile: (file) => {
            files.push(file);
          },
        });
      });

      expect(report.exported).toBe(1);
      // The route itself IS exported — the corridor is what is not.
      expect(files.length).toBeGreaterThan(1);
      expect(featureValues().length).toBeGreaterThan(5);
      await expect(tracesOf(corridor, files)).resolves.toStrictEqual([]);
    },
  );

  it('would find one, so the scan can go red', async () => {
    const corridor = await worldCorridorFor(ATHLETE_A, routeFor(ATHLETE_A).id);
    const planted: DownloadableFile = {
      fileName: 'manifest.json',
      mediaType: 'application/json',
      bytes: new TextEncoder().encode(
        JSON.stringify({
          [TABLE.worldCorridors]: [worldCorridorFeaturesFor(ATHLETE_A)],
        }),
      ),
    };
    const raw: DownloadableFile = {
      fileName: 'corridor.bin',
      mediaType: 'application/octet-stream',
      bytes: new Uint8Array(await corridor.features.arrayBuffer()),
    };
    const found = await tracesOf(corridor, [planted, raw]);
    expect(found).toContain('manifest.json: worldCorridors');
    expect(found).toContain('manifest.json: 12.4375');
    // #1632: a place's point is a marker too.
    expect(found).toContain('manifest.json: 365.4375');
    expect(found).toContain('corridor.bin: the packed features');
  });
});
