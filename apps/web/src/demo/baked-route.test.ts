// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The demo's baked-route loader — #1652. Every case reads a bundle that
 * `demo:bake`'s own code baked from the synthetic corridor archive
 * (`browser/demo-route-fixture.ts`, ADR 0056 D-9: never OpenStreetMap data),
 * through the loader the page uses, and checks what came back against what
 * the fixture's tiles decode to in Node (`corridor-fixture.ts`
 * §`expectedCorridorCounts`).
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { corridorFixtureRoute, expectedCorridorCounts } from '../../browser/corridor-fixture';
import { bakeFixtureRouteInto, routeFilesIn } from '../../browser/demo-route-fixture';
import { CORRIDOR_READER_VERSION } from '../game/world-data/corridor';
import type { ManifestEntry } from '../../tools/demo/bake-route';
import { encodeRouteBundle, readRouteBundle } from '../../tools/demo/route-bundle';
import { BAKED_ROUTE_UNAVAILABLE, loadBakedRoute, type ReadDemoFile } from './baked-route';

const scratch = mkdtempSync(join(tmpdir(), 'oyl-demo-route-'));
let entry: ManifestEntry;
let files: Map<string, Uint8Array<ArrayBuffer>>;

beforeAll(async () => {
  entry = await bakeFixtureRouteInto(scratch);
  files = routeFilesIn(scratch);
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const MANIFEST = './routes/routes.json';
const bundlePath = (): string => `./routes/${entry.file}`;

/** A reader over `served`, recording every path it was asked for. */
function reader(served: ReadonlyMap<string, Uint8Array<ArrayBuffer>>): {
  read: ReadDemoFile;
  asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    read: (path) => {
      asked.push(path);
      const bytes = served.get(path);
      return bytes === undefined
        ? Promise.reject(new Error(`404 ${path}`))
        : Promise.resolve(bytes);
    },
  };
}

/** `files` with the bundle replaced by `bytes`, and the manifest's digest of it made to match. */
function servedWithBundle(bytes: Uint8Array<ArrayBuffer>): Map<string, Uint8Array<ArrayBuffer>> {
  const manifest = JSON.parse(new TextDecoder().decode(files.get(MANIFEST))) as {
    routes: Record<string, { sha256: string }>;
  };
  const route = manifest.routes['fixture'];
  if (route === undefined) throw new Error('the fixture manifest has no fixture route');
  route.sha256 = createHash('sha256').update(bytes).digest('hex');
  return new Map([
    ...files,
    [MANIFEST, new TextEncoder().encode(JSON.stringify(manifest))],
    [bundlePath(), bytes],
  ]);
}

describe('a baked route, read into memory — #1652', () => {
  it('reads the fixture bundle: the road from its line, and every feature the fixture holds', async () => {
    const { read, asked } = reader(files);
    const loaded = await loadBakedRoute('fixture', read);
    if (loaded.kind !== 'ready') throw new Error(`not ready: ${loaded.notice}`);
    const expected = expectedCorridorCounts();
    expect(loaded.route.counts).toEqual(expected);
    // Read back off the corridor the scene is handed, not off the counts.
    const { corridor } = loaded.route;
    expect(corridor.buildings.length).toBe(expected.buildings);
    expect(corridor.landUse.length).toBe(expected.landUse);
    expect(corridor.streets.length).toBe(expected.streets);
    expect(corridor.coveredBoxes.length).toBe(expected.tiles);
    expect(corridor.routeId).toBe('fixture');
    // The road is the bundle's line: the fixture route's two kilometres.
    expect(loaded.route.profile.positions.length).toBe(corridorFixtureRoute().positions.length);
    expect(loaded.route.profile.totalDistance).toBeCloseTo(corridorFixtureRoute().totalDistance, 0);
    // Its own files, and nothing else.
    expect(asked).toEqual([MANIFEST, bundlePath()]);
    expect(loaded.route.bundlePath).toBe(bundlePath());
  });

  it('marks a tile the bundle says is not covered, so nothing is drawn there', async () => {
    const { bundle } = await readRouteBundle(files.get(bundlePath()) as Uint8Array<ArrayBuffer>);
    const bytes = await encodeRouteBundle({
      ...bundle,
      tiles: { ...bundle.tiles, uncovered: [{ index: 0, state: 'privacy-zone' }] },
    });
    const loaded = await loadBakedRoute('fixture', reader(servedWithBundle(bytes)).read);
    if (loaded.kind !== 'ready') throw new Error('not ready');
    expect(loaded.route.counts.tiles).toBe(expectedCorridorCounts().tiles - 1);
    expect(loaded.route.corridor.coveredBoxes.length).toBe(expectedCorridorCounts().tiles - 1);
  });

  it.each([
    ['a truncated file', (bytes: Uint8Array<ArrayBuffer>) => bytes.slice(0, bytes.length >> 1)],
    ['an empty file', () => new Uint8Array(0)],
    ['a file that is not gzip', () => new TextEncoder().encode('{"format":"nothing"}')],
  ])('refuses %s, whose digest the manifest names, as unavailable', async (_what, damage) => {
    const bytes = damage(files.get(bundlePath()) as Uint8Array<ArrayBuffer>);
    expect(await loadBakedRoute('fixture', reader(servedWithBundle(bytes)).read)).toEqual({
      kind: 'failed',
      notice: BAKED_ROUTE_UNAVAILABLE,
    });
  });

  it('refuses a whole file whose digest is not the manifest’s', async () => {
    const original = files.get(bundlePath()) as Uint8Array<ArrayBuffer>;
    const changed = new Uint8Array(original);
    changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 0xff;
    const served = new Map([...files, [bundlePath(), changed]]);
    expect(await loadBakedRoute('fixture', reader(served).read)).toEqual({
      kind: 'failed',
      notice: BAKED_ROUTE_UNAVAILABLE,
    });
  });

  it('refuses a file baked by another reader version', async () => {
    const { bundle } = await readRouteBundle(files.get(bundlePath()) as Uint8Array<ArrayBuffer>);
    const bytes = await encodeRouteBundle({
      ...bundle,
      readerVersion: CORRIDOR_READER_VERSION + 1,
    });
    const loaded = await loadBakedRoute('fixture', reader(servedWithBundle(bytes)).read);
    expect(loaded.kind).toBe('failed');
  });

  it('refuses a file whose plan is not the route’s', async () => {
    const { bundle } = await readRouteBundle(files.get(bundlePath()) as Uint8Array<ArrayBuffer>);
    const bytes = await encodeRouteBundle({
      ...bundle,
      tiles: { ...bundle.tiles, planned: bundle.tiles.planned + 1 },
    });
    expect((await loadBakedRoute('fixture', reader(servedWithBundle(bytes)).read)).kind).toBe(
      'failed',
    );
  });

  it('refuses a file with every tile uncovered: no map data is none', async () => {
    const { bundle } = await readRouteBundle(files.get(bundlePath()) as Uint8Array<ArrayBuffer>);
    const bytes = await encodeRouteBundle({
      ...bundle,
      tiles: {
        ...bundle.tiles,
        uncovered: Array.from({ length: bundle.tiles.planned }, (_, index) => ({
          index,
          state: 'refused' as const,
        })),
      },
    });
    expect((await loadBakedRoute('fixture', reader(servedWithBundle(bytes)).read)).kind).toBe(
      'failed',
    );
  });

  it('is unavailable, never a rejection, when the manifest cannot be read', async () => {
    const { read, asked } = reader(new Map());
    expect(await loadBakedRoute('fixture', read)).toEqual({
      kind: 'failed',
      notice: BAKED_ROUTE_UNAVAILABLE,
    });
    expect(asked).toEqual([MANIFEST]);
  });

  it('is unavailable for a route the manifest does not name, and reads no bundle', async () => {
    const { read, asked } = reader(files);
    expect((await loadBakedRoute('elsewhere', read)).kind).toBe('failed');
    expect(asked).toEqual([MANIFEST]);
  });

  it.each([
    ['a path out of the directory', '../index.html'],
    ['another route’s file', `other.${'0'.repeat(16)}.bin`],
    ['a name with no digest', 'fixture.bin'],
  ])('reads no file when the manifest names %s', async (_what, file) => {
    const manifest = JSON.parse(new TextDecoder().decode(files.get(MANIFEST))) as {
      routes: Record<string, { file: string }>;
    };
    (manifest.routes['fixture'] as { file: string }).file = file;
    const { read, asked } = reader(
      new Map([[MANIFEST, new TextEncoder().encode(JSON.stringify(manifest))]]),
    );
    expect((await loadBakedRoute('fixture', read)).kind).toBe('failed');
    expect(asked).toEqual([MANIFEST]);
  });

  it('reads nothing for an id the bake could not have written', async () => {
    const { read, asked } = reader(files);
    expect((await loadBakedRoute('../routes', read)).kind).toBe('failed');
    expect(asked).toEqual([]);
  });

  it('says so in the corridor’s own words, and names no coordinate', () => {
    expect(BAKED_ROUTE_UNAVAILABLE).toBe('Towns from map data: not available for this route');
    expect(BAKED_ROUTE_UNAVAILABLE).not.toMatch(/\d/);
  });
});
