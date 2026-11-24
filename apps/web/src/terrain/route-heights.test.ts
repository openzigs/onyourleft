// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A drawn route's heights from the terrain archive — #2013.
 *
 * Read back the way the planner reads them: a draft goes through
 * `routing/elevation.ts` §`planElevation`, and what is asserted is the
 * profile, the climb and the coverage a rider is shown. The archive is a
 * fixture PMTiles file of synthetic height tiles, read through `PMTiles`.
 */

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  gradeAt,
  metres,
  RoutingError,
  type GeographicPosition,
} from '@onyourleft/domain';
import { heightPixelMetres } from '@onyourleft/map-features';
import {
  FLAT_HEIGHT_METRES,
  flatHeightTile,
  oversizeHeightTile,
  slopeHeightTile,
  truncatedHeightTile,
  VALLEY,
  valleyHeightTile,
} from '@onyourleft/map-features/testing';
import { describe, expect, it } from 'vitest';

import { addWaypoint, emptyDraft, type RouteDraft } from '../routing/draft';
import { planElevation, resampleShape } from '../routing/elevation';
import { countingSource, type CountingSource } from '../world-data/archive-testing';
import { TERRAIN_DATASET_NAME, type RouteHeights } from './heights';
import {
  MAX_ROUTE_HEIGHT_TILES,
  ROUTE_TOO_LONG_FOR_HEIGHTS_TEXT,
  terrainHeights,
} from './route-heights';
import { terrainArchiveFrom } from './terrain-source';
import {
  buildTerrainArchive,
  fixtureDecode,
  FIXTURE_HEIGHT_TILE,
  NEXT_HEIGHT_TILE,
  placeInTile,
} from './terrain-testing';

/** A draft of straight freehand legs through `places`: what the planner draws with no engine. */
function draftThrough(...places: GeographicPosition[]): RouteDraft {
  return places.reduce((draft, place) => addWaypoint(draft, place, 'freehand').draft, emptyDraft());
}

async function readerOver(
  tiles: Parameters<typeof buildTerrainArchive>[0],
): Promise<{ heights: RouteHeights; source: CountingSource }> {
  const source = countingSource(await buildTerrainArchive(tiles));
  return {
    heights: terrainHeights({ archive: terrainArchiveFrom(source), decode: fixtureDecode }),
    source,
  };
}

/** The ground a pixel of the fixture tile covers along its middle row, in metres. */
const PIXEL_METRES = heightPixelMetres(placeInTile(FIXTURE_HEIGHT_TILE, 256, 256).latitude);

describe('a drawn route’s profile comes from the terrain archive, with no engine', () => {
  it('reads a flat block as a flat route: no climb, one height, the dataset named', async () => {
    const { heights } = await readerOver([{ tile: FIXTURE_HEIGHT_TILE, bytes: flatHeightTile() }]);
    const draft = draftThrough(
      placeInTile(FIXTURE_HEIGHT_TILE, 60, 100),
      placeInTile(FIXTURE_HEIGHT_TILE, 300, 180),
      placeInTile(FIXTURE_HEIGHT_TILE, 420, 400),
    );
    const planned = await planElevation(draft, heights, heights.interval);
    expect(planned).toBeDefined();
    expect(planned!.profile.totalAscent).toBe(0);
    expect(planned!.profile.totalDescent).toBe(0);
    expect(new Set(planned!.profile.elevations)).toStrictEqual(new Set([FLAT_HEIGHT_METRES]));
    expect(planned!.coverage).toStrictEqual({ complete: true, missing: 0, gaps: [] });
    expect(planned!.dataset.name).toBe(TERRAIN_DATASET_NAME);
    // The source's own grid where the route is: a z12 pixel near 40° N.
    expect(planned!.dataset.resolution).toBeCloseTo(PIXEL_METRES, 1);
    expect(planned!.interval).toBe(15);
    // The distance is the drawn line's own.
    expect(planned!.profile.totalDistance).toBeGreaterThan(5_000);
  });

  it('reads a steady 5 % slope as 5 %, and its climb as a twentieth of its length', async () => {
    const { heights } = await readerOver([
      { tile: FIXTURE_HEIGHT_TILE, bytes: slopeHeightTile(0.05 * PIXEL_METRES) },
    ]);
    // West to east along the tile's middle row, uphill all the way.
    const draft = draftThrough(
      placeInTile(FIXTURE_HEIGHT_TILE, 40, 256),
      placeInTile(FIXTURE_HEIGHT_TILE, 470, 256),
    );
    const planned = await planElevation(draft, heights, heights.interval);
    const profile = planned!.profile;
    for (const share of [0.2, 0.5, 0.8]) {
      expect(gradeAt(profile, metres(profile.totalDistance * share))).toBeCloseTo(5, 1);
    }
    expect(profile.totalAscent / profile.totalDistance).toBeCloseTo(0.05, 3);
    expect(profile.totalDescent).toBe(0);

    // And downhill the other way: the sign is the direction ridden.
    const back = await planElevation(
      draftThrough(
        placeInTile(FIXTURE_HEIGHT_TILE, 470, 256),
        placeInTile(FIXTURE_HEIGHT_TILE, 40, 256),
      ),
      heights,
      heights.interval,
    );
    expect(gradeAt(back!.profile, metres(back!.profile.totalDistance / 2))).toBeCloseTo(-5, 1);
  });

  it('draws the stretch outside the archive as a gap, and keeps the heights it has', async () => {
    // The next tile east is not in the archive: outside the extract.
    const { heights } = await readerOver([{ tile: FIXTURE_HEIGHT_TILE, bytes: flatHeightTile() }]);
    const draft = draftThrough(
      placeInTile(FIXTURE_HEIGHT_TILE, 312, 256),
      placeInTile(NEXT_HEIGHT_TILE, 200, 256),
    );
    const planned = await planElevation(draft, heights, heights.interval);
    expect(planned!.coverage.complete).toBe(false);
    expect(planned!.coverage.gaps).toHaveLength(1);
    // 200 px of the line are in the tile that is held, and 200 px are not.
    const held = 200 * PIXEL_METRES;
    expect(planned!.coverage.gaps[0]!.from).toBeGreaterThan(held - 30);
    expect(planned!.coverage.gaps[0]!.from).toBeLessThan(held + 30);
    expect(planned!.coverage.gaps[0]!.to).toBe(
      planned!.coverage.missing + planned!.coverage.gaps[0]!.from,
    );
    expect(planned!.profile.elevations[0]).toBe(FLAT_HEIGHT_METRES);
  });

  it.each([
    ['a malformed tile', truncatedHeightTile],
    ['an oversize tile', oversizeHeightTile],
  ])('treats %s as no heights there, and neither throws nor stops the read', async (_, hostile) => {
    const { heights } = await readerOver([
      { tile: FIXTURE_HEIGHT_TILE, bytes: flatHeightTile() },
      { tile: NEXT_HEIGHT_TILE, bytes: hostile() },
    ]);
    const draft = draftThrough(
      placeInTile(FIXTURE_HEIGHT_TILE, 312, 256),
      placeInTile(NEXT_HEIGHT_TILE, 200, 256),
    );
    const planned = await planElevation(draft, heights, heights.interval);
    expect(planned!.coverage.complete).toBe(false);
    expect(planned!.profile.elevations[0]).toBe(FLAT_HEIGHT_METRES);
  });

  it('says there is no profile when every tile on the route was refused', async () => {
    const { heights } = await readerOver([
      { tile: FIXTURE_HEIGHT_TILE, bytes: truncatedHeightTile() },
    ]);
    const draft = draftThrough(
      placeInTile(FIXTURE_HEIGHT_TILE, 100, 256),
      placeInTile(FIXTURE_HEIGHT_TILE, 200, 256),
    );
    const refused = await planElevation(draft, heights, heights.interval).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(RoutingError);
    expect((refused as RoutingError).code).toBe('malformed-response');
  });
});

describe('offline or unreachable', () => {
  const draft = draftThrough(
    placeInTile(FIXTURE_HEIGHT_TILE, 100, 256),
    placeInTile(FIXTURE_HEIGHT_TILE, 200, 256),
  );

  it('fails as one retryable error that says elevation could not be downloaded and the route saves flat', async () => {
    const { heights, source } = await readerOver([
      { tile: FIXTURE_HEIGHT_TILE, bytes: flatHeightTile() },
    ]);
    source.offline = true;
    const failed = await planElevation(draft, heights, heights.interval).catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(RoutingError);
    expect((failed as RoutingError).code).toBe('unavailable');
    expect((failed as RoutingError).retryable).toBe(true);
    expect((failed as RoutingError).message).toBe(
      "Elevation couldn't be downloaded right now. The route is saved flat; try again later.",
    );
  });

  it('says this copy of the app cannot read an archive of the wrong kind', async () => {
    // Stops short of zoom 12: the reader refuses it as the wrong archive.
    const source = countingSource(
      await buildTerrainArchive([{ tile: FIXTURE_HEIGHT_TILE, bytes: flatHeightTile() }], {
        maxZoom: 11,
      }),
    );
    const heights = terrainHeights({ archive: terrainArchiveFrom(source), decode: fixtureDecode });
    const failed = await planElevation(draft, heights, heights.interval).catch((e: unknown) => e);
    expect((failed as RoutingError).code).toBe('unavailable');
    expect((failed as RoutingError).message).toBe(
      "This copy of the app can't read the elevation data. The route is saved flat.",
    );
  });

  it('reads the heights once the archive can be reached again', async () => {
    const { heights, source } = await readerOver([
      { tile: FIXTURE_HEIGHT_TILE, bytes: flatHeightTile() },
    ]);
    source.offline = true;
    await planElevation(draft, heights, heights.interval).catch(() => undefined);
    source.offline = false;
    const planned = await planElevation(draft, heights, heights.interval);
    expect(planned!.profile.elevations[0]).toBe(FLAT_HEIGHT_METRES);
  });

  it('names no coordinate and no tile in what it says', async () => {
    const { heights, source } = await readerOver([
      { tile: FIXTURE_HEIGHT_TILE, bytes: flatHeightTile() },
    ]);
    source.offline = true;
    const failed = (await planElevation(draft, heights, heights.interval).catch(
      (e: unknown) => e,
    )) as RoutingError;
    const from = placeInTile(FIXTURE_HEIGHT_TILE, 100, 256);
    for (const secret of [
      String(FIXTURE_HEIGHT_TILE.x),
      String(FIXTURE_HEIGHT_TILE.y),
      from.latitude.toFixed(2),
      from.longitude.toFixed(2),
      String(Math.trunc(from.latitude)),
      String(Math.trunc(Math.abs(from.longitude))),
    ]) {
      expect(failed.message).not.toContain(secret);
    }
    expect(failed.message).not.toMatch(/\d/);
  });
});

describe('what is asked of the host', () => {
  const tiles = [{ tile: FIXTURE_HEIGHT_TILE, bytes: flatHeightTile() }];

  it('is a function of the tiles a line crosses, not of where in them it runs', async () => {
    const first = await readerOver(tiles);
    const second = await readerOver(tiles);
    await planElevation(
      draftThrough(
        placeInTile(FIXTURE_HEIGHT_TILE, 10, 20),
        placeInTile(FIXTURE_HEIGHT_TILE, 90, 60),
      ),
      first.heights,
      first.heights.interval,
    );
    await planElevation(
      draftThrough(
        placeInTile(FIXTURE_HEIGHT_TILE, 500, 480),
        placeInTile(FIXTURE_HEIGHT_TILE, 300, 250),
        placeInTile(FIXTURE_HEIGHT_TILE, 310, 30),
      ),
      second.heights,
      second.heights.interval,
    );
    expect(first.source.calls.length).toBeGreaterThan(0);
    expect(second.source.calls).toStrictEqual(first.source.calls);
  });

  it('asks nothing for an edit of a route whose tiles it already holds', async () => {
    const { heights, source } = await readerOver(tiles);
    await planElevation(
      draftThrough(
        placeInTile(FIXTURE_HEIGHT_TILE, 10, 20),
        placeInTile(FIXTURE_HEIGHT_TILE, 90, 60),
      ),
      heights,
      heights.interval,
    );
    const asked = source.calls.length;
    const moved = await planElevation(
      draftThrough(
        placeInTile(FIXTURE_HEIGHT_TILE, 10, 20),
        placeInTile(FIXTURE_HEIGHT_TILE, 140, 90),
      ),
      heights,
      heights.interval,
    );
    expect(moved!.profile.elevations[0]).toBe(FLAT_HEIGHT_METRES);
    expect(source.calls).toHaveLength(asked);
  });

  it('holds the last four tiles it decoded and no more: an older one is asked for again', async () => {
    // Six tiles in a row, and a line through all six.
    const row = Array.from({ length: 6 }, (_, index) => ({
      tile: { z: 12 as const, x: 850 + index, y: 1550 },
      bytes: flatHeightTile(),
    }));
    const { heights, source } = await readerOver(row);
    const across = await heights.heights({
      shape: row.map(({ tile }) => placeInTile(tile, 256, 256)),
      interval: heights.interval,
    });
    expect(across.samples.map((sample) => sample.elevation)).toStrictEqual(
      row.map(() => FLAT_HEIGHT_METRES),
    );
    const asked = source.calls.length;
    // The last tile is still held; the first was let go.
    await heights.heights({
      shape: [placeInTile(row[5]!.tile, 100, 100)],
      interval: heights.interval,
    });
    expect(source.calls).toHaveLength(asked);
    await heights.heights({
      shape: [placeInTile(row[0]!.tile, 100, 100)],
      interval: heights.interval,
    });
    expect(source.calls.length).toBeGreaterThan(asked);
  });

  it('refuses a line that crosses more tiles than it reads for one route, asking nothing', async () => {
    const { heights, source } = await readerOver(tiles);
    // One point in each of 201 tiles along a row of the grid.
    const shape = Array.from({ length: MAX_ROUTE_HEIGHT_TILES + 1 }, (_, index) =>
      placeInTile({ z: 12, x: 700 + index, y: 1550 }, 256, 256),
    );
    const refused = await heights
      .heights({ shape, interval: heights.interval })
      .catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(RoutingError);
    expect((refused as RoutingError).code).toBe('invalid-request');
    expect((refused as RoutingError).message).toBe(ROUTE_TOO_LONG_FOR_HEIGHTS_TEXT);
    expect(source.calls).toHaveLength(0);
  });

  it('has no height for a place the grid has no tile for', async () => {
    const { heights } = await readerOver(tiles);
    const answer = await heights.heights({
      shape: [
        placeInTile(FIXTURE_HEIGHT_TILE, 10, 20),
        geographicPosition(degreesLatitude(88), degreesLongitude(10)),
      ],
      interval: heights.interval,
    });
    expect(answer.samples.map((sample) => sample.elevation)).toStrictEqual([
      FLAT_HEIGHT_METRES,
      undefined,
    ]);
    expect(answer.samples.map((sample) => sample.along)).toStrictEqual([0, 15]);
  });
});

describe('a bridge over the valley fixture', () => {
  // West to east across the valley, 100 px of plateau either side of it.
  const from = placeInTile(FIXTURE_HEIGHT_TILE, VALLEY.westColumn - 100, 256);
  const to = placeInTile(FIXTURE_HEIGHT_TILE, VALLEY.eastColumn + 100, 256);
  /** The bridge, as distances along the line: its abutments stand 5 px back from the valley's rims. */
  const span = {
    from: metres(95 * PIXEL_METRES),
    to: metres((105 + VALLEY.eastColumn - VALLEY.westColumn) * PIXEL_METRES),
  };

  async function sampled(spans: readonly (typeof span)[] | undefined) {
    const { heights } = await readerOver([
      { tile: FIXTURE_HEIGHT_TILE, bytes: valleyHeightTile() },
    ]);
    const shape = resampleShape([from, to], heights.interval);
    const answer = await heights.heights({ shape, interval: heights.interval, spans });
    return answer.samples.map((sample) => Number(sample.elevation));
  }

  it('gives the deck’s heights, level between the rims, where the span is marked', async () => {
    const deck = await sampled([span]);
    expect(Math.min(...deck)).toBeCloseTo(VALLEY.plateauMetres, 6);
    expect(Math.max(...deck)).toBeCloseTo(VALLEY.plateauMetres, 6);
  });

  it('gives the valley floor’s without it: the terrain model knows no bridge', async () => {
    const ground = await sampled(undefined);
    expect(Math.max(...ground)).toBe(VALLEY.plateauMetres);
    // The floor, to within the height one sample step can miss it by.
    expect(Math.min(...ground)).toBeLessThan(VALLEY.floorMetres + 3);
    expect(await sampled([])).toStrictEqual(ground);
  });
});
