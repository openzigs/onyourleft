// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The account export carries no ridden block** — #2891, ADR 0090 D-6.4,
 * beside `world-corridor-not-exported.test.ts`, whose method this is.
 *
 * The ridden-block store is ODbL 1.0 data and location data that never
 * leaves the device. This runs the Files screen's own `exportEverything` over
 * an account that holds a ride, its route and a ridden block, and reads every
 * file it produced for any trace of the block: the table's name, the record's
 * own fields, the block's key, a feature value as JSON spells it, the
 * packed bytes themselves, raw or in base64 — of the features and of the
 * streets alike — and, since ADR 0098 kept street names in the streets, the
 * name of the street it holds.
 */

import {
  ATHLETE_A,
  createStoreHarness,
  resetFixtureIds,
  riddenBlockFor,
  riddenBlockStreetName,
  rideFor,
  routeFor,
  seedAthletes,
  streamSetFor,
  worldCorridorFeaturesFor,
} from '@onyourleft/store/testing';
import { TABLE, type RiddenBlockRecord } from '@onyourleft/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

/** Every fractional number in the block's features, spelled as JSON spells it. */
function featureValues(): string[] {
  const values = new Set<string>();
  // `riddenBlockFor`'s features are `worldCorridorFeaturesFor(owner, seed + 20)`.
  JSON.stringify(worldCorridorFeaturesFor(ATHLETE_A, 20), (_key, value: unknown) => {
    if (typeof value === 'number' && !Number.isInteger(value)) values.add(JSON.stringify(value));
    return value;
  });
  return [...values];
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    for (let index = 0; index < needle.length; index += 1) {
      if (haystack[start + index] !== needle[index]) continue outer;
    }
    return true;
  }
  return false;
}

/** What of the block appears in `files`, named so a failure says which. */
async function tracesOf(
  block: RiddenBlockRecord,
  files: readonly DownloadableFile[],
): Promise<string[]> {
  const base64Of = (bytes: Uint8Array): string => {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  };
  const packed = new Uint8Array(await block.features.arrayBuffer());
  const run = packed.slice(10, 42);
  const streets = new Uint8Array(await block.streets.arrayBuffer());
  const streetsRun = streets.slice(10, 42);
  const markers = [
    TABLE.riddenBlocks,
    'ODbL-1.0',
    String(block.block),
    block.archive.identity,
    block.readAt,
    base64Of(packed).slice(16, 56),
    base64Of(streets).slice(16, 56),
    riddenBlockStreetName(block.owner),
    ...featureValues(),
  ];
  const found: string[] = [];
  for (const file of files) {
    const text = new TextDecoder('latin1').decode(file.bytes);
    for (const marker of markers) {
      if (text.includes(marker)) found.push(`${file.fileName}: ${marker}`);
    }
    if (containsBytes(file.bytes, run)) found.push(`${file.fileName}: the packed features`);
    if (containsBytes(file.bytes, streetsRun)) {
      found.push(`${file.fileName}: the packed streets`);
    }
  }
  return found;
}

describe('the account export carries no ridden block — #2891', () => {
  it.each(['fit', 'gpx', 'tcx'] as const)(
    'finds no trace of one in any file of a %s export',
    async (format) => {
      await seedAthletes(harness);
      const route = routeFor(ATHLETE_A);
      const ride = rideFor(ATHLETE_A, { routeId: route.id, hasPosition: true });
      const block = await riddenBlockFor(ATHLETE_A);
      await harness.write(async (store) => {
        await store.putRoute(route);
        await store.putActivity(ride);
        await store.putStreamSet(streamSetFor(ride, { sampleCount: 60 }));
        await store.putRiddenBlock(block);
      });

      const files: DownloadableFile[] = [];
      const report = await harness.read(async (store) => {
        // The block is there to be found: the export ran over an account
        // that holds one, not over an empty table.
        await expect(store.getRiddenBlock(ATHLETE_A, block.block)).resolves.toBeDefined();
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
      expect(files.length).toBeGreaterThan(1);
      expect(featureValues().length).toBeGreaterThan(5);
      await expect(tracesOf(block, files)).resolves.toStrictEqual([]);
    },
  );

  it('would find one, so the scan can go red', async () => {
    const block = await riddenBlockFor(ATHLETE_A);
    const planted: DownloadableFile = {
      fileName: 'manifest.json',
      mediaType: 'application/json',
      bytes: new TextEncoder().encode(
        JSON.stringify({
          [TABLE.riddenBlocks]: [
            { block: block.block, features: worldCorridorFeaturesFor(ATHLETE_A, 20) },
          ],
        }),
      ),
    };
    const raw: DownloadableFile = {
      fileName: 'block.bin',
      mediaType: 'application/octet-stream',
      bytes: new Uint8Array(await block.features.arrayBuffer()),
    };
    const rawStreets: DownloadableFile = {
      fileName: 'streets.bin',
      mediaType: 'application/octet-stream',
      bytes: new Uint8Array(await block.streets.arrayBuffer()),
    };
    // A file that names the street alone, with nothing else of the block.
    const named: DownloadableFile = {
      fileName: 'route.gpx',
      mediaType: 'application/gpx+xml',
      bytes: new TextEncoder().encode(`<name>${riddenBlockStreetName(ATHLETE_A)}</name>`),
    };
    const found = await tracesOf(block, [planted, raw, rawStreets, named]);
    expect(found).toContain('manifest.json: riddenBlocks');
    expect(found).toContain(`manifest.json: ${String(block.block)}`);
    expect(found.some((line) => /^manifest\.json: \d+\.4375$/.test(line))).toBe(true);
    expect(found).toContain('block.bin: the packed features');
    expect(found).toContain('streets.bin: the packed streets');
    expect(found).toContain(`route.gpx: ${riddenBlockStreetName(ATHLETE_A)}`);
  });
});
