// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The corridor read's plan and its reading — #1539: the cover, the cap, the
 * privacy-zone filter, the archive's bounds, four in flight, a refused tile
 * standing alone, the timeouts, and the one formatter of a failure, which
 * must never print a place.
 */

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  unixSeconds,
  type GeographicPosition,
} from '@onyourleft/domain';
import { corridorTileCover, tileBounds, type TileId } from '@onyourleft/map-features';
import {
  FIXTURE_FRAME,
  FIXTURE_TILE,
  HOSTILE_FIXTURES,
  lakeTile,
  placesTile,
  RESIDENTIAL_FOOTPRINTS,
  residentialBlockTile,
  sidewalkTile,
  woodWithHoleTile,
} from '@onyourleft/map-features/testing';
import { privacyZoneId, type PrivacyZoneRecord } from '@onyourleft/store';
import { ATHLETE_A } from '@onyourleft/store/testing';
import { describe, expect, it } from 'vitest';

import {
  CORRIDOR_CONCURRENCY,
  CORRIDOR_HALF_WIDTH_METRES,
  CORRIDOR_MAX_TILES,
  corridorStateText,
  coveredLookup,
  describeCorridorFailure,
  packCorridorFeatures,
  planCorridor,
  readCorridorTiles,
  tileTouchesZone,
  unpackCorridorFeatures,
  type CorridorArchive,
  type CorridorFailure,
  type CorridorPlan,
  type CorridorState,
} from './corridor';

const METRES_PER_DEGREE_LATITUDE = 111_320;

/** A straight line north from the fixture frame, a point every 10 m. */
function lineNorth(length: number): GeographicPosition[] {
  const points: GeographicPosition[] = [];
  for (let along = 0; along <= length; along += 10) {
    points.push(
      geographicPosition(
        degreesLatitude(FIXTURE_FRAME.latitude + along / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(FIXTURE_FRAME.longitude),
      ),
    );
  }
  return points;
}

function zoneAt(position: GeographicPosition, radius: number): PrivacyZoneRecord {
  return {
    id: privacyZoneId('zone-1'),
    athleteId: ATHLETE_A,
    centre: position,
    radius: metres(radius),
    label: 'home',
    createdAt: unixSeconds(1_700_000_000),
  };
}

const tileKey = (tile: { x: number; y: number }): string => `${String(tile.x)}/${String(tile.y)}`;

/** An archive in memory: each tile's bytes by key, and what was asked of it. */
function memoryArchive(
  bytesFor: (tile: TileId) => Uint8Array | undefined | 'throw' | 'hang',
  options: { bounds?: { west: number; south: number; east: number; north: number } } = {},
) {
  const asked: TileId[] = [];
  let inFlight = 0;
  let mostInFlight = 0;
  let opened = 0;
  const archive: CorridorArchive = {
    open: () => {
      opened += 1;
      return Promise.resolve({
        kind: 'open',
        identity: '"memory"',
        bounds: options.bounds ?? { west: -180, south: -85, east: 180, north: 85 },
      });
    },
    tile: async (tile, signal) => {
      asked.push(tile);
      inFlight += 1;
      mostInFlight = Math.max(mostInFlight, inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 1));
        const answer = bytesFor(tile);
        if (answer === 'throw') throw new Error('no');
        if (answer === 'hang') {
          await new Promise((_, reject) => {
            signal.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'));
            });
          });
        }
        return answer === 'hang' ? undefined : answer;
      } finally {
        inFlight -= 1;
      }
    },
  };
  return {
    archive,
    asked,
    mostInFlight: () => mostInFlight,
    opened: () => opened,
  };
}

const read = (
  plan: CorridorPlan,
  archive: CorridorArchive,
  extra: Partial<Parameters<typeof readCorridorTiles>[0]> = {},
) =>
  readCorridorTiles({
    plan,
    archive,
    signal: new AbortController().signal,
    progress: () => undefined,
    yieldToIdle: () => Promise.resolve(),
    ...extra,
  });

describe('planCorridor', () => {
  it('is corridorTileCover at ±250 m, in route order, every tile requestable with no zone', () => {
    const route = lineNorth(3_000);
    const plan = planCorridor(route, []);
    expect(plan?.requestable).toStrictEqual(
      corridorTileCover(route, CORRIDOR_HALF_WIDTH_METRES, CORRIDOR_MAX_TILES),
    );
    expect(plan?.tiles.every((tile) => tile.state === 'covered')).toBe(true);
  });

  it(`stops at ${String(CORRIDOR_MAX_TILES)} tiles and says the rest is over the cap`, () => {
    const plan = planCorridor(lineNorth(600_000), []) as CorridorPlan;
    expect(plan.requestable).toHaveLength(CORRIDOR_MAX_TILES);
    expect(plan.tiles.filter((tile) => tile.state === 'over-cap')).toHaveLength(1);
  });

  it('marks every tile within a zone’s widened radius privacy-zone, and requests none of them', () => {
    const route = lineNorth(3_000);
    const zone = zoneAt(route[0] as GeographicPosition, 400);
    const plan = planCorridor(route, [zone]) as CorridorPlan;
    const zoned = plan.tiles.filter((tile) => tile.state === 'privacy-zone');
    expect(zoned.length).toBeGreaterThan(0);
    const requested = new Set(plan.requestable.map(tileKey));
    for (const tile of zoned) expect(requested.has(tileKey(tile))).toBe(false);
    for (const tile of plan.requestable) expect(tileTouchesZone(tile, [zone])).toBe(false);
  });

  it('skips a tile exactly as far out as the radius widened by the trim jitter and 1%, no further', () => {
    // Independent of zoneReachMetres: radius 1000 m, jitter 12.5% -> 1125 m, +1% -> about 1136 m.
    const tile = corridorTileCover(lineNorth(3_000), CORRIDOR_HALF_WIDTH_METRES, 1)[0] as TileId;
    const bounds = tileBounds(tile);
    const longitude = (bounds.west + bounds.east) / 2;
    const zoneNorthOfTile = (gap: number): PrivacyZoneRecord =>
      zoneAt(
        geographicPosition(
          degreesLatitude(bounds.north + gap / METRES_PER_DEGREE_LATITUDE),
          degreesLongitude(longitude),
        ),
        1_000,
      );
    // Inside the widened reach (1125 m is the jitter's worst case): not requested.
    expect(tileTouchesZone(tile, [zoneNorthOfTile(1_100)])).toBe(true);
    expect(tileTouchesZone(tile, [zoneNorthOfTile(1_130)])).toBe(true);
    // Beyond the 1% slack: requestable.
    expect(tileTouchesZone(tile, [zoneNorthOfTile(1_145)])).toBe(false);
    expect(tileTouchesZone(tile, [zoneNorthOfTile(1_300)])).toBe(false);
  });

  it('has nothing to request for a route entirely inside a zone', () => {
    const route = lineNorth(500);
    const plan = planCorridor(route, [zoneAt(route[25] as GeographicPosition, 5_000)]);
    expect(plan?.requestable).toStrictEqual([]);
  });

  it('plans nothing for a route with no positions', () => {
    expect(planCorridor([], [])).toBeUndefined();
  });
});

describe('readCorridorTiles', () => {
  const route = lineNorth(4_000);

  it('reads every planned tile, at most four at a time, and keeps the features', async () => {
    const plan = planCorridor(route, []) as CorridorPlan;
    const memory = memoryArchive(() => residentialBlockTile());
    const outcome = await read(plan, memory.archive);
    expect(outcome.kind).toBe('read');
    if (outcome.kind !== 'read') return;
    expect(memory.asked.map(tileKey)).toStrictEqual(plan.requestable.map(tileKey));
    expect(memory.mostInFlight()).toBe(Math.min(CORRIDOR_CONCURRENCY, plan.requestable.length));
    expect(outcome.features.buildings).toHaveLength(
      RESIDENTIAL_FOOTPRINTS.length * plan.requestable.length,
    );
    expect(outcome.tiles.every((tile) => tile.state === 'covered')).toBe(true);
    expect(outcome.identity).toBe('"memory"');
  });

  it('never asks for a tile outside the archive’s bounds, and marks it outside-archive', async () => {
    const plan = planCorridor(route, []) as CorridorPlan;
    // Bounds that end at the first tile's northern edge: tiles north of it are outside.
    const north = tileBounds(plan.requestable[0] as TileId).north;
    const memory = memoryArchive(() => residentialBlockTile(), {
      bounds: { west: -180, south: -85, east: 180, north },
    });
    const outcome = await read(plan, memory.archive);
    expect(outcome.kind).toBe('read');
    if (outcome.kind !== 'read') return;
    const outside = outcome.tiles.filter((tile) => tile.state === 'outside-archive');
    expect(outside.length).toBeGreaterThan(0);
    const asked = new Set(memory.asked.map(tileKey));
    for (const tile of outside) expect(asked.has(tileKey(tile))).toBe(false);
  });

  it('refuses one hostile tile and keeps the rest, with the refusal said in words', async () => {
    const plan = planCorridor(route, []) as CorridorPlan;
    const hostile = plan.requestable[1] as TileId;
    const lines: string[] = [];
    const memory = memoryArchive((tile) =>
      tileKey(tile) === tileKey(hostile) ? HOSTILE_FIXTURES[0]?.bytes() : lakeTile(),
    );
    const outcome = await read(plan, memory.archive, { log: (line) => lines.push(line) });
    if (outcome.kind !== 'read') throw new Error(outcome.kind);
    const states = outcome.tiles.map((tile) => tile.state);
    expect(states.filter((state) => state === 'refused')).toHaveLength(1);
    expect(outcome.tiles.find((tile) => tileKey(tile) === tileKey(hostile))?.state).toBe('refused');
    expect(outcome.features.landUse.length).toBe(plan.requestable.length - 1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('not a well-formed vector tile');
  });

  it('marks a tile whose request fails refused, and one that never arrives refused after its timeout', async () => {
    const plan = planCorridor(route, []) as CorridorPlan;
    const [failing, hanging] = plan.requestable as [TileId, TileId];
    const lines: string[] = [];
    const memory = memoryArchive((tile) =>
      tileKey(tile) === tileKey(failing)
        ? 'throw'
        : tileKey(tile) === tileKey(hanging)
          ? 'hang'
          : sidewalkTile(),
    );
    const outcome = await read(plan, memory.archive, {
      tileTimeoutMs: 20,
      log: (line) => lines.push(line),
    });
    if (outcome.kind !== 'read') throw new Error(outcome.kind);
    expect(outcome.tiles.find((tile) => tileKey(tile) === tileKey(failing))?.state).toBe('refused');
    expect(outcome.tiles.find((tile) => tileKey(tile) === tileKey(hanging))?.state).toBe('refused');
    expect(lines).toContain(describeCorridorFailure({ kind: 'timeout' }));
    expect(outcome.features.paths.length).toBeGreaterThan(0);
  });

  it('is offline when not one tile arrives, and when the archive cannot be opened', async () => {
    const plan = planCorridor(route, []) as CorridorPlan;
    expect((await read(plan, memoryArchive(() => 'throw').archive)).kind).toBe('offline');
    const closed: CorridorArchive = {
      open: () => Promise.reject(new TypeError('Failed to fetch')),
      tile: () => Promise.reject(new Error('unreachable')),
    };
    expect((await read(plan, closed)).kind).toBe('offline');
  });

  it('opens nothing for a plan with nothing to request', async () => {
    const memory = memoryArchive(() => residentialBlockTile());
    const empty = planCorridor(lineNorth(500), [
      zoneAt(lineNorth(500)[25] as GeographicPosition, 5_000),
    ]) as CorridorPlan;
    expect((await read(empty, memory.archive)).kind).toBe('offline');
    expect(memory.opened()).toBe(0);
    expect(memory.asked).toHaveLength(0);
  });

  it('stops before the next request once a ride is recording, and keeps nothing', async () => {
    const plan = planCorridor(route, []) as CorridorPlan;
    const memory = memoryArchive(() => residentialBlockTile());
    let recording = false;
    const outcome = await read(plan, memory.archive, {
      progress: (done) => {
        if (done >= 2) recording = true;
      },
      mustStop: () => recording,
    });
    expect(outcome.kind).toBe('aborted');
    expect(memory.asked.length).toBeLessThan(plan.requestable.length);
  });

  it('is aborted, and asks for nothing more, when the whole read runs out of time', async () => {
    const plan = planCorridor(route, []) as CorridorPlan;
    const memory = memoryArchive(() => 'hang');
    const outcome = await read(plan, memory.archive, { readTimeoutMs: 20, tileTimeoutMs: 10_000 });
    expect(outcome.kind).toBe('aborted');
    expect(memory.asked).toHaveLength(CORRIDOR_CONCURRENCY);
  });

  it('reports progress as tiles are done, ending at all of them', async () => {
    const plan = planCorridor(route, []) as CorridorPlan;
    const seen: [number, number][] = [];
    await read(plan, memoryArchive(() => woodWithHoleTile()).archive, {
      progress: (done, of) => seen.push([done, of]),
    });
    expect(seen[0]).toStrictEqual([0, plan.requestable.length]);
    expect(seen.at(-1)).toStrictEqual([plan.requestable.length, plan.requestable.length]);
  });
});

describe('describeCorridorFailure names no place (ADR 0004 D)', () => {
  const failures: CorridorFailure[] = [
    ...HOSTILE_FIXTURES.map((fixture) => ({ kind: 'refusal' as const, refusal: fixture.refusal })),
    { kind: 'http', status: 503 },
    { kind: 'not-a-range' },
    { kind: 'changed' },
    { kind: 'too-large', limit: 4_194_304 },
    { kind: 'compression' },
    { kind: 'timeout' },
    { kind: 'aborted' },
    { kind: 'network' },
    { kind: 'store', name: 'StoreReferentialError' },
  ];
  const places = [
    String(FIXTURE_TILE.x),
    String(FIXTURE_TILE.y),
    FIXTURE_FRAME.latitude.toFixed(2),
    FIXTURE_FRAME.longitude.toFixed(2),
    String(Math.trunc(FIXTURE_FRAME.latitude)),
    String(Math.trunc(FIXTURE_FRAME.longitude)),
  ];

  it.each(failures)('says $kind without a coordinate or a tile id', (failure) => {
    const words = describeCorridorFailure(failure);
    expect(words.startsWith('Towns from map data: ')).toBe(true);
    for (const place of places) expect(words).not.toContain(place);
  });
});

describe('the chooser’s line', () => {
  it('says each state in words that name no place', () => {
    const states: [CorridorState, string][] = [
      [{ kind: 'reading', done: 12, of: 40 }, 'Towns from map data: reading (12 of 40)'],
      [
        { kind: 'unavailable', why: 'offline' },
        'Towns from map data: not available for this route',
      ],
      [
        { kind: 'unavailable', why: 'outside-coverage' },
        'Towns from map data: not available for this route',
      ],
      [
        { kind: 'off', why: 'map-tiles-off' },
        'Towns from map data: off, because map tiles are off in Settings',
      ],
    ];
    for (const [state, text] of states) expect(corridorStateText(state)).toBe(text);
  });
});

describe('packing', () => {
  it('reads back what it packed, to the centimetre', async () => {
    const plan = planCorridor(lineNorth(1_000), []) as CorridorPlan;
    const outcome = await read(
      plan,
      memoryArchive((tile) => (tile.x % 2 === 0 ? residentialBlockTile() : sidewalkTile())).archive,
    );
    if (outcome.kind !== 'read') throw new Error(outcome.kind);
    const back = await unpackCorridorFeatures(await packCorridorFeatures(outcome.features));
    expect(back.buildings.map((b) => [b.kind, b.heightMetres, b.minHeightMetres])).toStrictEqual(
      outcome.features.buildings.map((b) => [b.kind, b.heightMetres, b.minHeightMetres]),
    );
    const flat = (features: typeof back) =>
      [...features.buildings, ...features.landUse].flatMap((f) => f.rings.flatMap((r) => [...r]));
    const before = flat(outcome.features);
    const after = flat(back);
    expect(after).toHaveLength(before.length);
    after.forEach((value, index) => {
      expect(Math.abs(value - (before[index] as number))).toBeLessThanOrEqual(0.005 + 1e-3);
    });
    expect(back.paths.map((p) => p.kindDetail)).toStrictEqual(
      outcome.features.paths.map((p) => p.kindDetail),
    );
    // #1565: the streets, read back through the same unpack a kept corridor takes.
    expect(outcome.features.streets.length).toBeGreaterThan(0);
    expect(back.streets.map((f) => [f.kind, f.kindDetail, f.line.length])).toStrictEqual(
      outcome.features.streets.map((f) => [f.kind, f.kindDetail, f.line.length]),
    );
    back.streets.forEach((street, index) => {
      const before = outcome.features.streets[index]?.line as Float32Array;
      street.line.forEach((value, at) => {
        expect(Math.abs(value - (before[at] as number))).toBeLessThanOrEqual(0.005 + 1e-3);
      });
    });
  });

  it("keeps each street's grade, so a bridge or a tunnel is still one when the corridor is kept (#1565)", async () => {
    const line = Float32Array.from([0, 0, 0, 100]);
    const streets = (['ground', 'bridge', 'tunnel'] as const).map((grade) => ({
      kind: 'major_road',
      kindDetail: 'primary',
      grade,
      line,
    }));
    const back = await unpackCorridorFeatures(
      await packCorridorFeatures({ landUse: [], buildings: [], paths: [], streets, places: [] }),
    );
    expect(back.streets.map((street) => street.grade)).toStrictEqual([
      'ground',
      'bridge',
      'tunnel',
    ]);
  });

  it('keeps each place’s kind, detail and rank, and its point to the centimetre (#1632)', async () => {
    const plan = planCorridor(lineNorth(1_000), []) as CorridorPlan;
    const outcome = await read(plan, memoryArchive(() => placesTile()).archive);
    if (outcome.kind !== 'read') throw new Error(outcome.kind);
    expect(outcome.features.places.length).toBeGreaterThan(0);
    const back = await unpackCorridorFeatures(await packCorridorFeatures(outcome.features));
    expect(back.places.map((p) => [p.kind, p.kindDetail, p.populationRank])).toStrictEqual(
      outcome.features.places.map((p) => [p.kind, p.kindDetail, p.populationRank]),
    );
    back.places.forEach((place, index) => {
      const before = outcome.features.places[index];
      expect(Math.abs(place.x - (before?.x ?? Number.NaN))).toBeLessThanOrEqual(0.005 + 1e-3);
      expect(Math.abs(place.z - (before?.z ?? Number.NaN))).toBeLessThanOrEqual(0.005 + 1e-3);
    });
  });

  it('refuses a blob of the reader before places (#1632)', async () => {
    const json = new Blob([
      JSON.stringify({ v: 2, landUse: [], buildings: [], paths: [], streets: [] }),
    ])
      .stream()
      .pipeThrough(new CompressionStream('gzip'));
    await expect(
      unpackCorridorFeatures(new Blob([await new Response(json).arrayBuffer()])),
    ).rejects.toThrow(/not a version/);
  });

  it('refuses a blob it did not write', async () => {
    // #1565: a version-1 blob, as a reader before the streets kept it, is not read.
    const json = new Blob([JSON.stringify({ v: 1 })])
      .stream()
      .pipeThrough(new CompressionStream('gzip'));
    await expect(
      unpackCorridorFeatures(new Blob([await new Response(json).arrayBuffer()])),
    ).rejects.toThrow(/not a version/);
  });
});

describe('coveredLookup', () => {
  it('is true inside a covered tile and false in a tile that was not read', () => {
    const covered = coveredLookup(FIXTURE_FRAME, [
      { x: FIXTURE_TILE.x, y: FIXTURE_TILE.y, state: 'covered' },
      { x: FIXTURE_TILE.x, y: FIXTURE_TILE.y - 1, state: 'privacy-zone' },
    ]);
    // The frame's origin is an eighth of the way into the fixture tile.
    expect(covered(0, 0)).toBe(true);
    // 300 m north is in the tile above, which was a privacy-zone tile.
    expect(covered(0, 300)).toBe(false);
    // 2 km east is nowhere read.
    expect(covered(-2_000, 0)).toBe(false);
  });
});
