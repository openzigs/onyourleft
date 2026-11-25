// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The open-world session reads its road's heights** — #2899.
 *
 * `real-grade.test.ts` holds what the trainer is written over a rolling route
 * that was handed a height source. This file holds that the SESSION hands it
 * one: the product's `createOpenWorldSession`, over the synthetic map archive
 * every session test reads and a synthetic terrain archive, gives a first
 * view whose heights are the ground's, marks the map's bridges as spans, and
 * with no terrain archive is as flat as it was.
 */

import { type GeographicPosition, type RouteProfile } from '@onyourleft/domain';
import { heightPixelMetres, heightTilePosition } from '@onyourleft/map-features';
import { heightTileWebp, truncatedHeightTile } from '@onyourleft/map-features/testing';
import type { GraphFixtureStreet } from '@onyourleft/map-features/testing';
import { describe, expect, it } from 'vitest';

import { terrainArchiveFrom, type TerrainArchive } from '../../terrain/terrain-source';
import { buildTerrainArchive, fixtureDecode } from '../../terrain/terrain-testing';
import { countingSource, type CountingSource } from '../../world-data/archive-testing';
import { corridorArchiveFrom } from '../../world-data/corridor-source';
import {
  fixturePosition,
  fixtureStart,
  MAIN_STREET_ROW,
  openWorldFixtureArchive,
  OPEN_WORLD_FIXTURE_STREETS,
  START_COLUMN,
  START_ROW,
} from './fixture-testing';
import { createOpenWorldSession } from './session';

const START = fixtureStart(START_COLUMN, START_ROW);
/** Where the start falls in the terrain archive's z12 grid. */
const AT = heightTilePosition(START.position.longitude, START.position.latitude);
if (AT === undefined) throw new Error('the fixture start is off the grid');
const PIXEL = heightPixelMetres(START.position.latitude);

/** The z12 column a fixture pixel of Main street falls in. */
function columnOf(fixtureColumn: number): number {
  const place = fixturePosition(fixtureColumn, MAIN_STREET_ROW);
  const at = heightTilePosition(place.longitude, place.latitude);
  if (at === undefined || at.tile.x !== AT?.tile.x) throw new Error('off the start’s tile');
  return at.column;
}

async function terrainOf(
  bytes: Uint8Array,
): Promise<{ terrain: TerrainArchive; source: CountingSource }> {
  const source = countingSource(
    await buildTerrainArchive([{ tile: (AT as NonNullable<typeof AT>).tile, bytes }]),
  );
  return { terrain: terrainArchiveFrom(source), source };
}

async function firstView(
  terrain: TerrainArchive | undefined,
  streets: readonly GraphFixtureStreet[] = OPEN_WORLD_FIXTURE_STREETS,
  mapTilesOn = true,
): Promise<{ profile: RouteProfile; realHeights: boolean; knownAt: (rider: number) => boolean }> {
  const session = createOpenWorldSession({
    start: START,
    archive: corridorArchiveFrom(countingSource(await openWorldFixtureArchive(streets))),
    mapTilesOn: () => mapTilesOn,
    yieldToIdle: () => Promise.resolve(),
    terrain,
    decodeHeights: fixtureDecode,
  });
  try {
    const outcome = await session.ready;
    if (outcome.kind !== 'ready') throw new Error(`not ready: ${outcome.kind}`);
    const road = outcome.road();
    return {
      profile: road.view.profile,
      realHeights: road.realHeights,
      knownAt: (rider) => road.heightsKnownAt(rider),
    };
  } finally {
    session.stop();
  }
}

/** The grade of `profile` at its sample `metres` along. */
const gradeAtSample = (profile: RouteProfile, metres: number): number =>
  profile.grades[Math.round(metres / 10)] as number;

describe('the session’s road reads the terrain archive — #2899', () => {
  it('gives a first view that climbs as the ground does, where the street’s own heights are 0', async () => {
    // The ground rises 3 % eastward, and Main street runs east.
    const { terrain, source } = await terrainOf(
      heightTileWebp((column) => 400 + column * 0.03 * PIXEL),
    );
    const view = await firstView(terrain);
    expect(source.calls.length).toBeGreaterThan(0);
    expect(view.realHeights).toBe(true);
    for (const at of [100, 250, 400]) {
      expect(gradeAtSample(view.profile, at), `${String(at)} m`).toBeCloseTo(3, 1);
      expect(view.knownAt(at)).toBe(true);
    }
    // The heights are the ground's: 150 m of 3 % is 4.5 m.
    const rise = (view.profile.elevations[30] as number) - (view.profile.elevations[15] as number);
    expect(rise).toBeCloseTo(4.5, 1);
  });

  it('is flat, as it was, with no terrain archive, and claims no real heights', async () => {
    const view = await firstView(undefined);
    expect(new Set(view.profile.grades)).toStrictEqual(new Set([0]));
    expect(view.realHeights).toBe(false);
    // Every grade of a road with no height source is known: it is the road's own.
    expect(view.knownAt(300)).toBe(true);
  });

  it('begins level, with the heights unknown, when the start’s tile is refused', async () => {
    const { terrain } = await terrainOf(truncatedHeightTile());
    const view = await firstView(terrain);
    expect(new Set(view.profile.grades)).toStrictEqual(new Set([0]));
    expect(view.realHeights).toBe(true);
    expect(view.knownAt(300)).toBe(false);
  });

  it('marks the map’s bridge as a span: the first view is level over a valley the terrain has', async () => {
    // Main street in three parts, the middle one a bridge, over a valley in
    // the ground between the bridge's two ends.
    const west = -2_600;
    const east = -2_200;
    const bridged = (bridge: boolean): GraphFixtureStreet[] => [
      {
        tags: { kind: 'minor_road', kind_detail: 'residential' },
        line: [
          [-4_000, MAIN_STREET_ROW],
          [west, MAIN_STREET_ROW],
        ],
      },
      {
        tags: {
          kind: 'minor_road',
          kind_detail: 'residential',
          ...(bridge ? { is_bridge: true } : {}),
        },
        line: [
          [west, MAIN_STREET_ROW],
          [east, MAIN_STREET_ROW],
        ],
      },
      {
        tags: { kind: 'minor_road', kind_detail: 'residential' },
        line: [
          [east, MAIN_STREET_ROW],
          [4_000, MAIN_STREET_ROW],
        ],
      },
    ];
    const from = columnOf(west);
    const to = columnOf(east);
    const middle = (from + to) / 2;
    // The valley's rims stand a pixel inside the bridge's two ends, which are on the plateau.
    const half = (to - from) / 2 - 1;
    // A plateau at 300 m, and a valley 12 m deep between those rims.
    const valley = heightTileWebp((column) => {
      const off = Math.abs(column + 0.5 - middle);
      return off >= half ? 300 : 288 + (12 * off) / half;
    });
    const position = (profile: RouteProfile, index: number): GeographicPosition =>
      profile.positions[index] as GeographicPosition;
    /** The view's sample nearest the valley's middle. */
    const overTheValley = (profile: RouteProfile): number => {
      const target = fixturePosition((west + east) / 2, MAIN_STREET_ROW).longitude;
      let best = 0;
      for (let index = 1; index < 120; index += 1) {
        if (
          Math.abs(position(profile, index).longitude - target) <
          Math.abs(position(profile, best).longitude - target)
        ) {
          best = index;
        }
      }
      return best;
    };

    const deck = await firstView((await terrainOf(valley)).terrain, bridged(true));
    const onDeck = overTheValley(deck.profile);
    expect(deck.profile.elevations[onDeck]).toBeCloseTo(300, 1);
    expect(Math.abs(deck.profile.grades[onDeck] as number)).toBeLessThan(0.05);
    expect(deck.knownAt(onDeck * 10)).toBe(true);

    // The same street with no bridge mark is on the valley floor.
    const floor = await firstView((await terrainOf(valley)).terrain, bridged(false));
    expect(floor.profile.elevations[overTheValley(floor.profile)]).toBeLessThan(295);
  });

  it('asks for no heights with map tiles off', async () => {
    const { terrain, source } = await terrainOf(heightTileWebp(() => 400));
    await expect(firstView(terrain, OPEN_WORLD_FIXTURE_STREETS, false)).rejects.toThrow(
      'not ready: refused',
    );
    expect(source.calls).toHaveLength(0);
  });
});

describe('the session’s road keeps reading heights as the ride goes — #2899', () => {
  /**
   * The road the product's session returns, its terrain host not answering
   * while the ride starts, and the ride loop's follow of it.
   */
  async function rideFromOffline() {
    const { terrain, source } = await terrainOf(
      heightTileWebp((column) => 400 + column * 0.03 * PIXEL),
    );
    source.offline = true;
    const session = createOpenWorldSession({
      start: START,
      archive: corridorArchiveFrom(countingSource(await openWorldFixtureArchive())),
      mapTilesOn: () => true,
      yieldToIdle: () => Promise.resolve(),
      terrain,
      decodeHeights: fixtureDecode,
      // A draw of 0 is no delay at all before a read (ADR 0090 R-8's delay is `heights.test.ts`'s).
      random: () => 0,
    });
    const outcome = await session.ready;
    if (outcome.kind !== 'ready') throw new Error(`not ready: ${outcome.kind}`);
    const road = outcome.road();
    let rider = 0;
    /**
     * Follows the road a frame at a time, a centimetre a frame, as the ride
     * loop does, until `done` or 500 frames have gone. Whether it was done.
     */
    const frames = async (done: () => boolean): Promise<boolean> => {
      for (let frame = 0; frame < 500 && !done(); frame += 1) {
        rider += 0.01;
        road.follow(rider);
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 1);
        });
      }
      return done();
    };
    return { session, source, road, frames };
  }

  it('asks again where the rider is, and the road takes the heights that arrive, with no extension of the route', async () => {
    const { session, source, road, frames } = await rideFromOffline();
    try {
      // The start's read failed: the ride began level, its heights unknown.
      expect(road.heightsKnownAt(100)).toBe(false);
      const failed = source.calls.length;
      const end = road.route.end;
      // Still offline: the road tells the session where the rider is, the
      // session's heights ask again for the tile that failed, and none arrives.
      expect(await frames(() => source.calls.length > failed)).toBe(true);
      expect(road.heightsKnownAt(100)).toBe(false);

      source.offline = false;
      // Asked for again, it arrives; and the follow after that sees a tile
      // arrived and has the route ask for the heights it lacked.
      expect(await frames(() => road.heightsKnownAt(100))).toBe(true);
      expect(gradeAtSample(road.view.profile, 250)).toBeCloseTo(3, 1);
      // Not by the route's next extension, which is a minute off at this pace.
      expect(road.route.end).toBe(end);
    } finally {
      session.stop();
    }
  });
});
