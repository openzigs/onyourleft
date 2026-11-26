// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where #3252's timber fence and highway noise barrier stand — read back
 * through the path a frame takes: a synthetic corridor, its land mask, the
 * mapped town built from it, and `structuresAt`, which is what hands a frame
 * its structures. Rectangles and one straight line of arithmetic; no real
 * place.
 *
 * - **Right, 900–1 100 m**: allotments from 12 m back to 80 m.
 * - **Right, 1 300–1 700 m**: residential land from 8 m back to 120 m.
 * - **Right, 1 900–2 300 m**: a field, the same shape: the control.
 * - **Right, 1 200–2 400 m**: a highway 60 m out, along the road.
 */

import { describe, expect, it } from 'vitest';

import {
  HIGHWAY_HALF_WIDTH_METRES,
  NOISE_BARRIER_BEHIND_METRES,
  NOISE_BARRIER_REACH_METRES,
  NOISE_BARRIER_VERGE_METRES,
  noiseBarrierPieces,
  TIMBER_FENCE_KINDS,
  timberFencedGrounds,
  timberFencePieces,
  type ChainLinkPiece,
  type ChainLinkRoute,
} from './chain-link';
import { SIDE_ROAD_WIDTHS } from './cross-streets';
import { footprintPlans, mappedTown } from './footprint-buildings';
import { landBeside, sceneryFixture, streetBeside } from './footprint-fixtures-testing';
import { landClassMask } from './land-class';
import { nearestOnDrawnRoad } from './road-grid';
import { northRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import {
  BOUNDARY_PIECE_METRES,
  FIELD_EDGE_LATERAL_METRES,
  structuresAt,
  type MappedTown,
} from './settlements';
import { corridorOrigin } from './terrain';
import { urbanClassMap } from './urban-class';
import type { WorldCorridor } from './world-data/corridor';

const profile = northRoute(3_000, () => 10);
const origin = corridorOrigin(profile);
const seed = scatterSeed(profile);
const land = (kind: string, from: number, to: number, near: number, far: number) =>
  landBeside(profile, origin, 'landuse', kind, from, to, near, far);
const HIGHWAY_LATERAL = 60;
const highway = (grade: 'ground' | 'bridge' = 'ground', kind = 'highway') => ({
  ...streetBeside(
    profile,
    origin,
    [
      [1_200, HIGHWAY_LATERAL],
      [2_400, HIGHWAY_LATERAL],
    ],
    'motorway',
    grade,
  ),
  kind,
});

function corridorWith(streets: WorldCorridor['streets']): WorldCorridor {
  return {
    routeId: 'boundary-fences',
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
    landUse: [
      land('allotments', 900, 1_100, 12, 80),
      land('residential', 1_300, 1_700, 8, 120),
      land('farmland', 1_900, 2_300, 8, 120),
    ],
    buildings: [],
    paths: [],
    streets,
  };
}

const corridor = corridorWith([highway()]);
const mask = landClassMask(corridor);
const route: ChainLinkRoute = {
  profile,
  origin,
  seed,
  land: mask,
  roadside: FIELD_EDGE_LATERAL_METRES,
  piece: BOUNDARY_PIECE_METRES,
  cityCentre: () => false,
};

/** Where a piece stands beside the road: its odometer and its signed lateral. */
function beside(piece: ChainLinkPiece): { readonly along: number; readonly lateral: number } {
  const near = nearestOnDrawnRoad(profile, origin, piece.item.x, piece.item.z, 200);
  if (near === undefined) throw new Error('a piece off the road');
  return { along: near.along, lateral: near.lateral };
}

describe('the highway noise barrier — #3252', () => {
  const pieces = noiseBarrierPieces(corridor.streets, route);

  it('stands along the highway where built-up land is behind it, and nowhere else', () => {
    // 400 m of residential frontage in 8 m pieces.
    expect(pieces.length).toBeGreaterThanOrEqual(48);
    expect(pieces.length).toBeLessThanOrEqual(52);
    for (const piece of pieces) {
      const { along, lateral } = beside(piece);
      expect(along).toBeGreaterThan(1_290);
      expect(along).toBeLessThan(1_710);
      // Off the highway's edge, on the road's side of it.
      expect(lateral).toBeCloseTo(
        HIGHWAY_LATERAL - HIGHWAY_HALF_WIDTH_METRES - NOISE_BARRIER_VERGE_METRES,
        3,
      );
      expect(piece.item.kind).toBe('fence');
      expect(piece.item.boundary).toBe('noise-barrier');
      // The variant the realistic world draws a barrier as: a mesh of its own.
      expect(piece.item.variant).toBe(2);
      expect(piece.item.chainLink).toBeUndefined();
      expect(piece.item.scale).toBe(1);
      // Along the highway, which runs along the road: its length up +z.
      expect(Math.abs(Math.sin(piece.item.rotation))).toBeLessThan(1e-6);
      expect(piece.along).toBeCloseTo(along, 6);
    }
    // No barrier through the fields: the same highway, the same distance out.
    expect(pieces.some((piece) => beside(piece).along > 1_900)).toBe(false);
  });

  it('is on the ROUTE’S side of the highway whichever side that is', () => {
    const left = {
      ...highway(),
      line: streetBeside(
        profile,
        origin,
        [
          [1_300, -HIGHWAY_LATERAL],
          [1_700, -HIGHWAY_LATERAL],
        ],
        'motorway',
      ).line,
    };
    const leftCorridor: WorldCorridor = {
      ...corridorWith([left]),
      landUse: [land('residential', 1_300, 1_700, -120, -8)],
    };
    const mirrored = noiseBarrierPieces(leftCorridor.streets, {
      ...route,
      land: landClassMask(leftCorridor),
    });
    expect(mirrored.length).toBeGreaterThanOrEqual(48);
    for (const piece of mirrored) {
      expect(beside(piece).lateral).toBeCloseTo(
        -(HIGHWAY_LATERAL - HIGHWAY_HALF_WIDTH_METRES - NOISE_BARRIER_VERGE_METRES),
        3,
      );
    }
  });

  it('has none for a highway on a bridge, a street that is no highway, or one out of reach', () => {
    expect(noiseBarrierPieces([highway('bridge')], route)).toEqual([]);
    expect(noiseBarrierPieces([highway('ground', 'major_road')], route)).toEqual([]);
    const far = {
      ...highway(),
      line: streetBeside(
        profile,
        origin,
        [
          [1_300, NOISE_BARRIER_REACH_METRES + 30],
          [1_700, NOISE_BARRIER_REACH_METRES + 30],
        ],
        'motorway',
      ).line,
    };
    expect(noiseBarrierPieces([far], route)).toEqual([]);
  });

  it('has none where the route is the highway’s own verge, nor in a city centre', () => {
    const hard = {
      ...highway(),
      line: streetBeside(
        profile,
        origin,
        [
          [1_300, 9],
          [1_700, 9],
        ],
        'motorway',
      ).line,
    };
    expect(noiseBarrierPieces([hard], route)).toEqual([]);
    expect(noiseBarrierPieces(corridor.streets, { ...route, cityCentre: () => true })).toEqual([]);
  });

  it('reads the land a garden’s depth behind it, and draws a highway at the width it clears', () => {
    expect(HIGHWAY_HALF_WIDTH_METRES).toBe(SIDE_ROAD_WIDTHS.highway / 2);
    expect(NOISE_BARRIER_BEHIND_METRES).toBeGreaterThan(BOUNDARY_PIECE_METRES);
  });
});

describe('the timber fence — #3252', () => {
  it('fences allotments and gardens, and no other land', () => {
    expect([...TIMBER_FENCE_KINDS].sort()).toEqual(['allotments', 'garden']);
    expect(timberFencedGrounds(corridor.landUse).map((ground) => ground.kind)).toEqual([
      'allotments',
    ]);
  });

  it('stands along the allotments’ outline within sight of the road, each piece a timber fence', () => {
    const pieces = timberFencePieces(timberFencedGrounds(corridor.landUse), route);
    expect(pieces.length).toBeGreaterThan(25);
    for (const piece of pieces) {
      const { along, lateral } = beside(piece);
      expect(along).toBeGreaterThan(890);
      expect(along).toBeLessThan(1_110);
      expect(lateral).toBeGreaterThan(11);
      expect(piece.item.kind).toBe('fence');
      expect(piece.item.boundary).toBe('timber-fence');
      expect(piece.item.variant).toBe(1);
      expect(piece.item.chainLink).toBeUndefined();
    }
    // Its frontage, the edge nearest the road, is fenced end to end.
    const frontage = pieces.filter((piece) => Math.abs(beside(piece).lateral - 12) < 0.01);
    expect(frontage).toHaveLength(Math.round(200 / BOUNDARY_PIECE_METRES));
  });
});

describe('both among a frame’s structures — #3252', () => {
  const urban = urbanClassMap(corridor, mask, profile);
  const { plans } = footprintPlans(corridor, mask, profile, origin, undefined, urban);
  const town = mappedTown(corridor, plans, urban);
  const items = structuresAt(
    profile,
    origin,
    seed,
    800,
    2_400,
    { maxItems: 1_000, riderMetres: 1_500 },
    [],
    mask,
    town,
  );

  it('carries them as fences out of the boundaries’ budget, each marked as what it is', () => {
    const barrier = items.filter((item) => item.boundary === 'noise-barrier');
    const timber = items.filter((item) => item.boundary === 'timber-fence');
    expect(barrier.length).toBeGreaterThanOrEqual(48);
    expect(timber.length).toBeGreaterThan(25);
    for (const item of [...barrier, ...timber]) expect(item.kind).toBe('fence');
    // And a field's own fence is neither, and keeps the first variant.
    const fields = items.filter((item) => item.kind === 'fence' && item.boundary === undefined);
    expect(fields.length).toBeGreaterThan(0);
    for (const item of fields) expect(item.variant).toBe(0);
  });

  it('CONTROL: a town with no highway and no allotments carries neither', () => {
    const plain: WorldCorridor = {
      ...corridorWith([]),
      landUse: [land('residential', 1_300, 1_700, 8, 120), land('farmland', 1_900, 2_300, 8, 120)],
    };
    const plainMask = landClassMask(plain);
    const plainUrban = urbanClassMap(plain, plainMask, profile);
    const plainTown: MappedTown = mappedTown(
      plain,
      footprintPlans(plain, plainMask, profile, origin, undefined, plainUrban).plans,
      plainUrban,
    );
    const without = structuresAt(
      profile,
      origin,
      seed,
      800,
      2_400,
      { maxItems: 1_000, riderMetres: 1_500 },
      [],
      plainMask,
      plainTown,
    );
    expect(without.some((item) => item.boundary !== undefined)).toBe(false);
  });
});

describe('the owner’s page’s scenery fixture shows what it says — #3252, `?town=scenery`', () => {
  it('stands a timber fence by its allotments and a noise barrier by its houses', () => {
    const fixture = sceneryFixture();
    const fixtureMask = landClassMask(fixture.corridor);
    const fixtureUrban = urbanClassMap(fixture.corridor, fixtureMask, fixture.profile);
    const fixtureTown = mappedTown(
      fixture.corridor,
      footprintPlans(
        fixture.corridor,
        fixtureMask,
        fixture.profile,
        fixture.origin,
        undefined,
        fixtureUrban,
      ).plans,
      fixtureUrban,
    );
    const placed = fixtureTown.chainLinkAt?.(
      fixture.profile,
      fixture.origin,
      scatterSeed(fixture.profile),
      fixtureMask,
    );
    expect(
      placed?.filter((piece) => piece.item.boundary === 'timber-fence').length,
    ).toBeGreaterThan(25);
    expect(
      placed?.filter((piece) => piece.item.boundary === 'noise-barrier').length,
    ).toBeGreaterThan(40);
  });
});
