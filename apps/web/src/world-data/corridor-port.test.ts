// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1539's acceptance criteria for the read, through the port `main.tsx`
 * builds (`createWorldCorridorPort`) over a **real** store in IndexedDB and a
 * synthetic PMTiles archive read by the product's own `corridorArchiveFrom` —
 * only the archive's bytes are faked, by a source that counts every
 * `getBytes`. Read back through what a consumer uses: a fresh port over a
 * fresh store connection.
 */

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  unixSeconds,
  type GeographicPosition,
  type RouteProfile,
} from '@onyourleft/domain';
import { corridorTileCover, tileBounds, type PlaceFeature } from '@onyourleft/map-features';
import {
  lakeTile,
  PLACE_SENTINEL,
  placesTile,
  residentialBlockTile,
  sidewalkTile,
  woodWithHoleTile,
} from '@onyourleft/map-features/testing';
import {
  openActivityStore,
  privacyZoneId,
  type ActivityStore,
  type PrivacyZoneRecord,
  type RouteRecord,
} from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  resetFixtureIds,
  routeFor,
  seedAthletes,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CORRIDOR_HALF_WIDTH_METRES,
  CORRIDOR_READER_VERSION,
  packCorridorFeatures,
  type CorridorState,
} from '../game/world-data/corridor';
import { circuitRoute } from '../game/route-fixtures-testing';
import { insideZone, type CoordinateAt } from '../privacy/boundaries';
import {
  buildArchive,
  countingSource,
  tilesRequested,
  type ArchiveTile,
  type CountingSource,
} from './archive-testing';
import { lazyWorldCorridorPort, readingCorridorOnSave } from './corridor-lazy';
import { createWorldCorridorPort, routeDigestOf, type WorldCorridorPort } from './corridor-port';
import { corridorArchiveFrom } from './corridor-source';

const ARCHIVE_URL = 'https://tiles.example.org/basemap-us-test.pmtiles';
const FIXTURES = [residentialBlockTile, woodWithHoleTile, lakeTile, sidewalkTile];

let harness: ReturnType<typeof createStoreHarness>;
let stores: ActivityStore[];

beforeEach(async () => {
  resetFixtureIds();
  harness = createStoreHarness();
  stores = [];
  await seedAthletes(harness, [ATHLETE_A]);
});

afterEach(async () => {
  for (const store of stores) store.close();
  await harness.destroy();
});

function freshStore(): ActivityStore {
  const store = openActivityStore(harness.databaseName);
  stores.push(store);
  return store;
}

interface Switches {
  tiles: boolean;
  realistic: boolean;
  recording: boolean;
  url: string | undefined;
}

const on = (): Switches => ({ tiles: true, realistic: true, recording: false, url: ARCHIVE_URL });

function portOver(
  store: ActivityStore,
  source: CountingSource,
  switches: Switches,
): WorldCorridorPort {
  return createWorldCorridorPort({
    store,
    owner: ATHLETE_A,
    basemap: () =>
      switches.url === undefined ? undefined : { archiveUrl: switches.url, attribution: '' },
    archive: () => corridorArchiveFrom(source),
    mapTilesOn: () => switches.tiles,
    realisticOn: () => switches.realistic,
    recording: () => switches.recording,
    now: () => new Date('2026-10-21T12:00:00Z'),
    yieldToIdle: () => Promise.resolve(),
  });
}

/** Every tile of the route's corridor, holding the four #1544 fixtures in turn. */
function corridorTiles(profile: RouteProfile, extra = 2_000): ArchiveTile[] {
  return corridorTileCover(profile.positions, CORRIDOR_HALF_WIDTH_METRES + extra, 2_000).map(
    (tile, index) => ({ x: tile.x, y: tile.y, bytes: (FIXTURES[index % 4] as () => Uint8Array)() }),
  );
}

async function savedRoute(profile?: RouteProfile): Promise<RouteRecord> {
  const base = routeFor(ATHLETE_A);
  const route = profile === undefined ? base : { ...base, profile };
  await harness.write((store) => store.putRoute(route));
  return route;
}

const load = (port: WorldCorridorPort, route: RouteRecord): Promise<CorridorState> =>
  port.load(
    { id: route.id, profile: route.profile },
    new AbortController().signal,
    () => undefined,
  );

function featuresOf(state: CorridorState) {
  if (state.kind !== 'ready') throw new Error(`not ready: ${JSON.stringify(state)}`);
  const { buildings, landUse, paths, streets } = state.corridor;
  return { buildings, landUse, paths, streets };
}

function shifted(profile: RouteProfile, northMetres: number): RouteProfile {
  return {
    ...profile,
    positions: profile.positions.map((position) =>
      geographicPosition(
        degreesLatitude(position.latitude + northMetres / 111_320),
        degreesLongitude(position.longitude),
      ),
    ),
  };
}

describe('read once, then from the store', () => {
  it('reads the corridor, and a fresh port over a fresh connection asks nothing and gets the same', async () => {
    const route = await savedRoute();
    const tiles = corridorTiles(route.profile);
    const source = countingSource(await buildArchive({ tiles }));

    const first = await load(portOver(freshStore(), source, on()), route);
    expect(first.kind).toBe('ready');
    const firstCalls = source.calls.length;
    expect(firstCalls).toBeGreaterThan(0);
    const firstFeatures = featuresOf(first);
    expect(firstFeatures.buildings.length).toBeGreaterThan(0);
    expect(firstFeatures.landUse.length).toBeGreaterThan(0);
    expect(firstFeatures.paths.length).toBeGreaterThan(0);
    // #1565: the streets come back from the store too.
    expect(firstFeatures.streets.length).toBeGreaterThan(0);

    for (const store of stores) store.close();
    const second = await load(portOver(freshStore(), source, on()), route);
    expect(source.calls.length - firstCalls).toBe(0);
    expect(featuresOf(second)).toStrictEqual(firstFeatures);
    // The covered lookup is rebuilt from the kept tiles: the start is covered.
    expect(second.kind === 'ready' && second.corridor.covered(0, 0)).toBe(true);
  });

  it('keeps one row for the owner and route, declared ODbL, with every tile’s state', async () => {
    const route = await savedRoute();
    const source = countingSource(await buildArchive({ tiles: corridorTiles(route.profile) }));
    await load(portOver(freshStore(), source, on()), route);
    const kept = await harness.read((store) => store.getWorldCorridor(ATHLETE_A, route.id));
    expect(kept?.licence).toBe('ODbL-1.0');
    expect(kept?.archive).toStrictEqual({ url: ARCHIVE_URL, identity: '"fixture-1"' });
    expect(kept?.halfWidthMetres).toBe(CORRIDOR_HALF_WIDTH_METRES);
    expect(kept?.tiles.length).toBeGreaterThan(0);
    expect(kept?.tiles.every((tile) => tile.state === 'covered')).toBe(true);
  });
});

describe('#1632 place points: kept, read back, and a row of another reader version read again', () => {
  /** The route's corridor with every other tile #1632's places fixture. */
  function tilesWithPlaces(profile: RouteProfile): ArchiveTile[] {
    return corridorTiles(profile).map((tile, index) =>
      index % 2 === 0 ? { ...tile, bytes: placesTile() } : tile,
    );
  }

  function placesOf(state: CorridorState): readonly PlaceFeature[] {
    if (state.kind !== 'ready') throw new Error(`not ready: ${state.kind}`);
    return state.corridor.places ?? [];
  }

  /** The kept row's features, as JSON text. */
  async function keptText(route: RouteRecord): Promise<string> {
    const kept = await harness.read((store) => store.getWorldCorridor(ATHLETE_A, route.id));
    if (kept === undefined) throw new Error('nothing kept');
    const json = kept.features.stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(json).text();
  }

  /** Keeps a row for `route` as another reader would have: its version, and its packed blob. */
  async function keepRow(route: RouteRecord, readerVersion: number, features: Blob): Promise<void> {
    const covered = corridorTileCover(route.profile.positions, CORRIDOR_HALF_WIDTH_METRES, 600);
    // It matches the route in everything but its reader version.
    const routeDigest = await routeDigestOf(route.profile.positions);
    await harness.write((store) =>
      store.putWorldCorridor({
        owner: ATHLETE_A,
        routeId: route.id,
        routeDigest,
        archive: { url: ARCHIVE_URL, identity: '"fixture-1"' },
        readerVersion,
        halfWidthMetres: CORRIDOR_HALF_WIDTH_METRES,
        readAt: '2026-10-20T12:00:00.000Z',
        tiles: covered.map((tile) => ({ x: tile.x, y: tile.y, state: 'covered' as const })),
        features,
        licence: 'ODbL-1.0',
      }),
    );
  }

  /** A gzip blob of `value` as JSON, as a packed `features` is. */
  async function gzipJson(value: unknown): Promise<Blob> {
    const stream = new Blob([JSON.stringify(value)])
      .stream()
      .pipeThrough(new CompressionStream('gzip'));
    return new Blob([await new Response(stream).arrayBuffer()]);
  }

  it('reads a corridor that holds places, keeps it, and a fresh store hands back the same places', async () => {
    const route = await savedRoute();
    const source = countingSource(await buildArchive({ tiles: tilesWithPlaces(route.profile) }));
    const first = placesOf(await load(portOver(freshStore(), source, on()), route));
    // Every kind ADR 0055 D-2 keeps is held, the ones that lift nothing too (D-5.5).
    expect(new Set(first.map((place) => place.kindDetail))).toStrictEqual(
      new Set(['city', 'town', 'village', 'hamlet', 'suburb', 'quarter']),
    );
    const calls = source.calls.length;

    for (const store of stores) store.close();
    const second = await load(portOver(freshStore(), source, on()), route);
    expect(source.calls.length).toBe(calls);
    expect(placesOf(second)).toStrictEqual(first);
    const kept = await harness.read((store) => store.getWorldCorridor(ATHLETE_A, route.id));
    expect(kept?.readerVersion).toBe(CORRIDOR_READER_VERSION);
    expect(CORRIDOR_READER_VERSION).toBe(3);
    // No name, `wikidata` or population reached the store (ADR 0055 D-3).
    const text = await keptText(route);
    expect(text).toContain('"places"');
    expect(text).not.toContain(PLACE_SENTINEL);
  });

  it('reads again a row kept at reader version 2, with no places, rather than trusting it', async () => {
    const route = await savedRoute();
    const source = countingSource(await buildArchive({ tiles: tilesWithPlaces(route.profile) }));
    await keepRow(
      route,
      2,
      await gzipJson({ v: 2, landUse: [], buildings: [], paths: [], streets: [] }),
    );

    const state = await load(portOver(freshStore(), source, on()), route);
    expect(source.calls.length).toBeGreaterThan(0);
    expect(placesOf(state).length).toBeGreaterThan(0);
    const kept = await harness.read((store) => store.getWorldCorridor(ATHLETE_A, route.id));
    expect(kept?.readerVersion).toBe(CORRIDOR_READER_VERSION);
  });

  it('reads again a row kept by a newer reader, rather than decoding it as its own', async () => {
    // A version-3 row met by version-2 code is this: a row of a reader version
    // other than its own, whose blob it could otherwise parse. Trusted only at
    // exactly its own version, never at a later one.
    const route = await savedRoute();
    const source = countingSource(await buildArchive({ tiles: tilesWithPlaces(route.profile) }));
    await keepRow(
      route,
      CORRIDOR_READER_VERSION + 1,
      await packCorridorFeatures({
        landUse: [],
        buildings: [],
        paths: [],
        streets: [],
        places: [],
      }),
    );

    const state = await load(portOver(freshStore(), source, on()), route);
    expect(source.calls.length).toBeGreaterThan(0);
    expect(placesOf(state).length).toBeGreaterThan(0);
    const kept = await harness.read((store) => store.getWorldCorridor(ATHLETE_A, route.id));
    expect(kept?.readerVersion).toBe(CORRIDOR_READER_VERSION);
  });
});

describe('re-read when the route or the archive changes', () => {
  it('reads again when the route’s positions change (a new routeDigest)', async () => {
    const route = await savedRoute();
    const moved = { ...route, profile: shifted(route.profile, 60) };
    const source = countingSource(await buildArchive({ tiles: corridorTiles(route.profile) }));
    await load(portOver(freshStore(), source, on()), route);
    await harness.write((store) => store.putRoute(moved));
    const before = source.calls.length;
    const again = await load(portOver(freshStore(), source, on()), moved);
    expect(again.kind).toBe('ready');
    expect(source.calls.length).toBeGreaterThan(before);
  });

  it('reads again once this device has seen the archive answer with a new etag', async () => {
    const one = await savedRoute();
    const two = await savedRoute(shifted(one.profile, 1_500));
    const tiles = [...corridorTiles(one.profile), ...corridorTiles(two.profile)].filter(
      (tile, index, all) => all.findIndex((t) => t.x === tile.x && t.y === tile.y) === index,
    );
    const bytes = await buildArchive({ tiles });
    const source = countingSource(bytes, '"fixture-1"');
    const port = portOver(freshStore(), source, on());
    await load(port, one);
    // Asked again with nothing changed: from the store.
    let before = source.calls.length;
    await load(port, one);
    expect(source.calls.length).toBe(before);

    source.replace(bytes, '"fixture-2"');
    await load(port, two);
    before = source.calls.length;
    const again = await load(port, one);
    expect(again.kind).toBe('ready');
    expect(source.calls.length).toBeGreaterThan(before);
    const kept = await harness.read((store) => store.getWorldCorridor(ATHLETE_A, one.id));
    expect(kept?.archive.identity).toBe('"fixture-2"');
  });

  it('reads again when the configured archive is another URL', async () => {
    const route = await savedRoute();
    const source = countingSource(await buildArchive({ tiles: corridorTiles(route.profile) }));
    await load(portOver(freshStore(), source, on()), route);
    const before = source.calls.length;
    await load(portOver(freshStore(), source, { ...on(), url: `${ARCHIVE_URL}?v=2` }), route);
    expect(source.calls.length).toBeGreaterThan(before);
  });
});

describe('map tiles off, or the stylised world, means no request', () => {
  it('asks nothing with map tiles off, and says so', async () => {
    const route = await savedRoute();
    const source = countingSource(await buildArchive({ tiles: corridorTiles(route.profile) }));
    const state = await load(portOver(freshStore(), source, { ...on(), tiles: false }), route);
    expect(state).toStrictEqual({ kind: 'off', why: 'map-tiles-off' });
    expect(source.calls).toHaveLength(0);
  });

  it('asks nothing with the stylised world chosen', async () => {
    const route = await savedRoute();
    const source = countingSource(await buildArchive({ tiles: corridorTiles(route.profile) }));
    const state = await load(portOver(freshStore(), source, { ...on(), realistic: false }), route);
    expect(state).toStrictEqual({ kind: 'off', why: 'stylised-world' });
    expect(source.calls).toHaveLength(0);
  });

  it('asks nothing with no archive configured, nor while a ride records', async () => {
    const route = await savedRoute();
    const source = countingSource(await buildArchive({ tiles: corridorTiles(route.profile) }));
    expect(
      await load(portOver(freshStore(), source, { ...on(), url: undefined }), route),
    ).toStrictEqual({
      kind: 'off',
      why: 'no-archive',
    });
    expect(
      await load(portOver(freshStore(), source, { ...on(), recording: true }), route),
    ).toStrictEqual({
      kind: 'unavailable',
      why: 'refused',
    });
    expect(source.calls).toHaveLength(0);
  });

  it('reads nothing from an archive that is not Protomaps basemap v4', async () => {
    const route = await savedRoute();
    const bytes = await buildArchive({
      tiles: corridorTiles(route.profile),
      metadata: { name: 'Something Else', version: '1.0' },
    });
    const state = await load(portOver(freshStore(), countingSource(bytes), on()), route);
    expect(state).toStrictEqual({ kind: 'off', why: 'wrong-schema' });
  });
});

describe('privacy zones (ADR 0054 D-6.3) — a departing boundary', () => {
  const ZONE_RADIUS = 200;

  function zoneAt(centre: GeographicPosition, radius: number): PrivacyZoneRecord {
    return {
      id: privacyZoneId('zone-home'),
      athleteId: ATHLETE_A,
      centre,
      radius: metres(radius),
      label: 'home',
      createdAt: unixSeconds(1_700_000_000),
    };
  }

  /** Each tile's corners and nine points along each edge, as positions. */
  function edgePoints(tile: { x: number; y: number }): CoordinateAt[] {
    const b = tileBounds({ z: 15, x: tile.x, y: tile.y });
    const points: CoordinateAt[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const lon = b.west + (b.east - b.west) * t;
      const lat = b.south + (b.north - b.south) * t;
      for (const [latitude, longitude] of [
        [b.north, lon],
        [b.south, lon],
        [lat, b.west],
        [lat, b.east],
      ] as const) {
        points.push({
          path: `$.tile`,
          position: geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude)),
        });
      }
    }
    return points;
  }

  it('requests no tile any of whose bounds lies within the zone’s widened radius', async () => {
    const route = await savedRoute(circuitRoute(600));
    const zone = zoneAt(route.profile.positions[0] as GeographicPosition, ZONE_RADIUS);
    await harness.write((store) => store.putPrivacyZone(zone));
    const tiles = corridorTiles(route.profile);
    const bytes = await buildArchive({ tiles });
    const source = countingSource(bytes);
    const state = await load(portOver(freshStore(), source, on()), route);

    const requested = tilesRequested(tiles, bytes, source.calls);
    expect(requested.length).toBeGreaterThan(0);
    // The walk is not blind: the cover DID have tiles touching the zone.
    const cover = corridorTileCover(route.profile.positions, CORRIDOR_HALF_WIDTH_METRES, 600);
    expect(cover.some((tile) => insideZone(edgePoints(tile), zone, route.id).length > 0)).toBe(
      true,
    );
    for (const tile of requested) {
      expect(insideZone(edgePoints(tile), zone, route.id)).toStrictEqual([]);
    }
    const kept = await harness.read((store) => store.getWorldCorridor(ATHLETE_A, route.id));
    expect(kept?.tiles.some((tile) => tile.state === 'privacy-zone')).toBe(true);
    expect(state.kind).toBe('ready');
  });

  it('a zone added after the corridor was kept drops that world: nothing kept is used inside it', async () => {
    const route = await savedRoute(circuitRoute(300));
    const store = freshStore();
    const source = countingSource(await buildArchive({ tiles: corridorTiles(route.profile) }));
    const first = await load(portOver(store, source, on()), route);
    expect(first.kind).toBe('ready');
    const before = source.calls.length;

    await harness.write((s) =>
      s.putPrivacyZone(zoneAt(route.profile.positions[0] as GeographicPosition, ZONE_RADIUS)),
    );
    const second = await load(portOver(freshStore(), source, on()), route);
    expect(second.kind).toBe('ready');
    if (first.kind !== 'ready' || second.kind !== 'ready') return;
    expect(first.corridor.covered(0, 0)).toBe(true);
    // The route's start is the zone's centre: the world there is procedural again.
    expect(second.corridor.covered(0, 0)).toBe(false);
    // The read was redone under the new zones, and asked for none inside it.
    expect(source.calls.length).toBeGreaterThan(before);
  });

  it('a zone added after the corridor was kept leaves no kept world to fall back on offline', async () => {
    const route = await savedRoute(circuitRoute(300));
    const source = countingSource(await buildArchive({ tiles: corridorTiles(route.profile) }));
    await load(portOver(freshStore(), source, on()), route);
    await harness.write((s) =>
      s.putPrivacyZone(zoneAt(route.profile.positions[0] as GeographicPosition, ZONE_RADIUS)),
    );
    source.offline = true;
    expect(await load(portOver(freshStore(), source, on()), route)).toStrictEqual({
      kind: 'unavailable',
      why: 'offline',
    });
  });

  it('makes no request at all for a route entirely inside zones', async () => {
    const route = await savedRoute(circuitRoute(300));
    await harness.write((store) =>
      store.putPrivacyZone(zoneAt(route.profile.positions[0] as GeographicPosition, 5_000)),
    );
    const source = countingSource(await buildArchive({ tiles: corridorTiles(route.profile) }));
    const state = await load(portOver(freshStore(), source, on()), route);
    expect(source.calls).toHaveLength(0);
    expect(state).toStrictEqual({ kind: 'unavailable', why: 'outside-coverage' });
  });
});

describe('offline', () => {
  it('a route with nothing kept is unavailable, and a route with a kept corridor is ready', async () => {
    const kept = await savedRoute();
    const fresh = await savedRoute(shifted(kept.profile, 3_000));
    const source = countingSource(await buildArchive({ tiles: corridorTiles(kept.profile) }));
    await load(portOver(freshStore(), source, on()), kept);

    source.offline = true;
    const port = portOver(freshStore(), source, on());
    expect(await load(port, fresh)).toStrictEqual({ kind: 'unavailable', why: 'offline' });
    expect((await load(port, kept)).kind).toBe('ready');
  });
});

describe('a saved route has its corridor read, and the save never waits on it', () => {
  it('reads after a save, so the first choice asks nothing', async () => {
    const route = await savedRoute();
    const source = countingSource(await buildArchive({ tiles: corridorTiles(route.profile) }));
    const saved = await portOver(freshStore(), source, on()).afterSave(route);
    expect(saved.kind).toBe('ready');
    const before = source.calls.length;
    expect(before).toBeGreaterThan(0);
    const chosen = await load(portOver(freshStore(), source, on()), route);
    expect(chosen.kind).toBe('ready');
    expect(source.calls.length).toBe(before);
  });

  it('settles without throwing when the save had no network, and the next choice reads', async () => {
    const route = await savedRoute();
    const source = countingSource(await buildArchive({ tiles: corridorTiles(route.profile) }));
    source.offline = true;
    await expect(portOver(freshStore(), source, on()).afterSave(route)).resolves.toStrictEqual({
      kind: 'unavailable',
      why: 'offline',
    });
    source.offline = false;
    expect((await load(portOver(freshStore(), source, on()), route)).kind).toBe('ready');
  });

  it('asks nothing after a save with map tiles off', async () => {
    const route = await savedRoute();
    const source = countingSource(await buildArchive({ tiles: corridorTiles(route.profile) }));
    await portOver(freshStore(), source, { ...on(), tiles: false }).afterSave(route);
    expect(source.calls).toHaveLength(0);
  });
});

describe('readingCorridorOnSave: the store the two save screens are handed', () => {
  function recordingPort(answer: Promise<CorridorState>) {
    const asked: string[] = [];
    const port: WorldCorridorPort = {
      load: () => answer,
      afterSave: (route) => {
        asked.push(route.id);
        return answer;
      },
    };
    return { port, asked };
  }

  it('saves first, returns without waiting on the read, and then starts it', async () => {
    const never = new Promise<CorridorState>(() => undefined);
    const { port, asked } = recordingPort(never);
    const store = readingCorridorOnSave(freshStore(), port);
    const route = routeFor(ATHLETE_A);
    await expect(store.putRoute(route)).resolves.toBe(route.id);
    expect(asked).toStrictEqual([route.id]);
    // The route is saved, read back through a fresh connection.
    const back = await harness.read((fresh) => fresh.getRoute(ATHLETE_A, route.id));
    expect(back?.id).toBe(route.id);
  });

  it('starts no read for a save that failed, and the failure is the save’s', async () => {
    const { port, asked } = recordingPort(Promise.resolve({ kind: 'off', why: 'no-archive' }));
    const store = readingCorridorOnSave(freshStore(), port);
    const somebodyElses = routeFor(ATHLETE_A);
    await expect(
      store.putRoute({ ...somebodyElses, createdBy: 'nobody' as typeof somebodyElses.createdBy }),
    ).rejects.toThrow();
    expect(asked).toStrictEqual([]);
  });

  it('leaves every other member the store’s own, bound to it', async () => {
    const { port } = recordingPort(Promise.resolve({ kind: 'off', why: 'no-archive' }));
    const route = await savedRoute();
    const store = readingCorridorOnSave(freshStore(), port);
    expect((await store.listRoutes(ATHLETE_A)).map((r) => r.id)).toStrictEqual([route.id]);
  });
});

describe('lazyWorldCorridorPort: the port main.tsx builds, loaded on first use', () => {
  const options = (store: ActivityStore) => ({
    store,
    owner: ATHLETE_A,
    basemap: () => undefined,
    mapTilesOn: () => true,
    realisticOn: () => true,
    recording: () => false,
    now: () => new Date(),
  });

  it('loads the real port and reader by default, and answers through them', async () => {
    const route = await savedRoute();
    const port = lazyWorldCorridorPort(options(freshStore()));
    expect(await load(port, route)).toStrictEqual({ kind: 'off', why: 'no-archive' });
    expect(await port.afterSave(route)).toStrictEqual({ kind: 'off', why: 'no-archive' });
  });

  it('loads once, and a load that failed is refused and tried again on the next call', async () => {
    const route = await savedRoute();
    let loads = 0;
    const answer: CorridorState = { kind: 'off', why: 'stylised-world' };
    const port = lazyWorldCorridorPort(options(freshStore()), () => {
      loads += 1;
      if (loads === 1) return Promise.reject(new Error('chunk not fetched'));
      return Promise.resolve({
        load: () => Promise.resolve(answer),
        afterSave: () => Promise.resolve(answer),
      });
    });
    expect(await load(port, route)).toStrictEqual({ kind: 'unavailable', why: 'refused' });
    expect(await load(port, route)).toStrictEqual(answer);
    expect(await port.afterSave(route)).toStrictEqual(answer);
    expect(loads).toBe(2);
  });
});
