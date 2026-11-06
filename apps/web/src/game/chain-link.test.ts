// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where a chain-link fence stands — #1274, the owner's ruling of 2026-11-05:
 * beside industrial, school and sports grounds only; a field's fence keeps its
 * planks; and a ride with no corridor, the stylised world's, has none.
 */

import { describe, expect, it } from 'vitest';

import {
  CHAIN_LINK_KINDS,
  CHAIN_LINK_REACH_METRES,
  chainLinkPieces,
  fencedGrounds,
  type ChainLinkPiece,
} from './chain-link';
import { footprintPlans, mappedTown } from './footprint-buildings';
import { fencedGroundsFixture, landBeside } from './footprint-fixtures-testing';
import { kindAt, landClassMask, NO_LAND_CLASS } from './land-class';
import { circuitRoute, valleyRoute } from './route-fixtures-testing';
import { distanceToDrawnRoad, nearestOnDrawnRoad } from './road-grid';
import { scatterSeed } from './scatter';
import {
  BOUNDARY_PIECE_METRES,
  CHAIN_LINK_BUILDING_CLEARANCE_METRES,
  FIELD_EDGE_LATERAL_METRES,
  NO_MAPPED_TOWN,
  structuresAt,
  type MappedTown,
} from './settlements';
import { corridorOrigin, drawnRoadFrame } from './terrain';
import { NO_URBAN_CLASS, urbanClassMap, type UrbanClassMap } from './urban-class';
import { CHANNEL_BANK_METRES, inWater, waterways } from './waterways';

const grounds = fencedGroundsFixture();
const { profile, origin, corridor } = grounds;
const seed = scatterSeed(profile);
const land = landClassMask(corridor);
const urban = urbanClassMap(corridor, land, profile);
const { plans } = footprintPlans(corridor, land, profile, origin, undefined, urban);
const town = mappedTown(corridor, plans, urban);

/** Every piece the town places, built once. */
const pieces = (town.chainLinkAt as NonNullable<MappedTown['chainLinkAt']>)(
  profile,
  origin,
  seed,
  land,
);

/** The ground a piece fences: the kind beside it, a little in from its line. */
function groundOf(piece: ChainLinkPiece): string | undefined {
  // Its length runs along its own +z; try both sides of its line.
  const across = [Math.cos(piece.item.rotation), -Math.sin(piece.item.rotation)];
  for (const side of [1, -1]) {
    const kind = kindAt(
      corridor,
      piece.item.x + (across[0] as number) * side,
      piece.item.z + (across[1] as number) * side,
    );
    if (kind !== undefined && CHAIN_LINK_KINDS.has(kind)) return kind;
  }
  return undefined;
}

describe('the chain-link fence’s grounds — #1274', () => {
  it('fences industrial, school and sports grounds, and no other land', () => {
    expect([...CHAIN_LINK_KINDS].sort()).toEqual(['industrial', 'pitch', 'school']);
    expect(fencedGrounds(corridor.landUse).map((ground) => ground.kind)).toEqual([
      'industrial',
      'school',
      'pitch',
      'pitch',
    ]);
    // Residential, farmland, a wood and water: none, by kind and by layer.
    const others = ['residential', 'commercial', 'farmland', 'wood', 'park'].map((kind) =>
      landBeside(profile, origin, 'landuse', kind, 950, 1_250, 2, 160),
    );
    const water = landBeside(profile, origin, 'water', 'industrial', 950, 1_250, 2, 160);
    expect(fencedGrounds([...others, water])).toEqual([]);
    // And the town reads its grounds through that filter: a town with only
    // the other land has no piece at all.
    const plain = mappedTown({ ...corridor, landUse: [...others, water] }, plans, urban);
    expect(plain.chainLinkAt?.(profile, origin, seed, land)).toEqual([]);
  });

  it('stands every piece on a fenced ground’s outline, each a chain-link fence', () => {
    // Non-vacuity: all four grounds are fenced.
    expect(pieces.length).toBeGreaterThan(60);
    const fenced = new Set<string>();
    for (const piece of pieces) {
      expect(piece.item.kind).toBe('fence');
      expect(piece.item.chainLink).toBe(true);
      const ground = groundOf(piece);
      expect(ground, `${String(piece.item.x)},${String(piece.item.z)}`).toBeDefined();
      fenced.add(ground as string);
    }
    expect([...fenced].sort()).toEqual(['industrial', 'pitch', 'school']);
  });

  it('fences a ground mapped to the road’s line on the field verge’s line, along the road', () => {
    // The industrial estate is mapped from 2 m: its frontage is moved out.
    const frontage = pieces.filter(
      (piece) => piece.along > 960 && piece.along < 1_240 && piece.item.x < 0,
    );
    const along = frontage.filter(
      (piece) =>
        Math.abs(distanceToDrawnRoad(profile, origin, piece.item.x, piece.item.z, 20) - 5.6) < 0.05,
    );
    // Non-vacuity: the whole 300 m frontage, a piece every 8 m or so.
    expect(along.length).toBeGreaterThan(30);
    for (const piece of along) {
      const frame = drawnRoadFrame(profile, origin, piece.along);
      if (frame === undefined) throw new Error('the fixture road has no direction');
      // Its length runs along the road: its +z is the road's (nz, −nx).
      const length = [Math.sin(piece.item.rotation), Math.cos(piece.item.rotation)];
      expect(
        Math.abs((length[0] as number) * frame.normalZ - (length[1] as number) * frame.normalX),
      ).toBeCloseTo(1, 6);
    }
    // And never nearer the road than the field verge's line.
    for (const piece of pieces) {
      expect(
        distanceToDrawnRoad(profile, origin, piece.item.x, piece.item.z, 60),
      ).toBeGreaterThanOrEqual(FIELD_EDGE_LATERAL_METRES - 0.05);
    }
  });

  it('fences no outline further from the road than its reach', () => {
    for (const piece of pieces) {
      expect(
        distanceToDrawnRoad(profile, origin, piece.item.x, piece.item.z, 200),
      ).toBeLessThanOrEqual(CHAIN_LINK_REACH_METRES);
    }
    // The estate's back, 160 m out, has none — its frontage and sides do.
    const back = pieces.filter(
      (piece) => distanceToDrawnRoad(profile, origin, piece.item.x, piece.item.z, 200) > 100,
    );
    expect(back).toEqual([]);
  });

  it('builds a route’s pieces once and keeps them', () => {
    const again = (town.chainLinkAt as NonNullable<MappedTown['chainLinkAt']>)(
      profile,
      origin,
      seed,
      land,
    );
    expect(again).toBe(pieces);
  });

  it('stands none where the urban class calls the road a city centre', () => {
    const everywhere = chainLinkPieces(fencedGrounds(corridor.landUse), {
      profile,
      origin,
      seed,
      land,
      roadside: FIELD_EDGE_LATERAL_METRES,
      piece: BOUNDARY_PIECE_METRES,
      cityCentre: () => true,
    });
    expect(everywhere).toEqual([]);
    // With no class, the same as the town's.
    expect(NO_URBAN_CLASS.classAt(1_100)).not.toBe('city-centre');
  });

  it('wires the town’s urban class: a city-centre road has none through mappedTown', () => {
    const centre: UrbanClassMap = { classAt: () => 'city-centre' };
    const downtown = mappedTown(corridor, plans, centre);
    // Non-vacuity: the same grounds with the real class do stand pieces.
    expect(pieces.length).toBeGreaterThan(60);
    expect(downtown.chainLinkAt?.(profile, origin, seed, land)).toEqual([]);
  });

  it('drops a side edge that meets the road, keeping the frontage along it', () => {
    // An estate mapped to the road's own line: its two sides run straight out
    // from the road, so their first pieces stand inside the verge, across it.
    const flush = landBeside(profile, origin, 'landuse', 'industrial', 950, 1_250, 0, 160);
    const made = chainLinkPieces(fencedGrounds([flush]), {
      profile,
      origin,
      seed,
      land,
      roadside: FIELD_EDGE_LATERAL_METRES,
      piece: BOUNDARY_PIECE_METRES,
      cityCentre: () => false,
    });
    // Non-vacuity: the frontage is fenced, from its first piece to its last.
    expect(made.filter((piece) => piece.along > 952 && piece.along < 1_248).length).toBeGreaterThan(
      30,
    );
    // A side's piece would be moved onto the verge at its own end of the
    // frontage, 950 m or 1 250 m; the frontage's own stand 4 m in.
    const onVerge = made.filter((piece) => Math.abs(piece.item.x) < FIELD_EDGE_LATERAL_METRES + 1);
    expect(onVerge.filter((piece) => Math.abs(piece.along - 950) < 2)).toEqual([]);
    expect(onVerge.filter((piece) => Math.abs(piece.along - 1_250) < 2)).toEqual([]);
  });

  it('stands none in a stream’s channel', () => {
    const valley = valleyRoute();
    const valleyOrigin = corridorOrigin(valley);
    const valleySeed = scatterSeed(valley);
    const stream = waterways(valley, valleySeed).crossings[0];
    if (stream === undefined) throw new Error('the valley fixture has no stream');
    const estate = landBeside(valley, valleyOrigin, 'landuse', 'industrial', 800, 1_200, 2, 160);
    const made = chainLinkPieces(fencedGrounds([estate]), {
      profile: valley,
      origin: valleyOrigin,
      seed: valleySeed,
      land: NO_LAND_CLASS,
      roadside: FIELD_EDGE_LATERAL_METRES,
      piece: BOUNDARY_PIECE_METRES,
      cityCentre: () => false,
    });
    const ways = waterways(valley, valleySeed);
    // Non-vacuity: the estate is fenced either side of the stream, and the
    // stream's channel lies across its frontage.
    expect(made.filter((piece) => piece.along < stream.distance - 40).length).toBeGreaterThan(5);
    expect(made.filter((piece) => piece.along > stream.distance + 40).length).toBeGreaterThan(5);
    expect(inWater(ways, valley, stream.distance, FIELD_EDGE_LATERAL_METRES)).toBe(true);
    for (const piece of made) {
      expect(Math.abs(piece.along - stream.distance)).toBeGreaterThan(CHANNEL_BANK_METRES);
    }
  });
});

describe('the chain-link fence among the structures — #1274', () => {
  const budget = { maxItems: 400, riderMetres: 1_300 };
  const items = structuresAt(profile, origin, seed, 900, 2_100, budget, [], land, town);
  const chain = items.filter((item) => item.chainLink === true);

  it('carries the chain-link pieces as fences, out of the boundaries’ budget', () => {
    expect(chain.length).toBeGreaterThan(60);
    for (const item of chain) expect(item.kind).toBe('fence');
    // Nearest the rider first, as every boundary: a small budget keeps the
    // pieces nearest 1 300 m and drops the far ones.
    const small = structuresAt(
      profile,
      origin,
      seed,
      900,
      2_100,
      { maxItems: 40, riderMetres: 1_300 },
      [],
      land,
      town,
    );
    expect(small.length).toBeLessThanOrEqual(40);
  });

  it('leaves a field’s fence its planks: no field boundary is a chain-link', () => {
    const fields = items.filter(
      (item) =>
        (item.kind === 'fence' || item.kind === 'hedge' || item.kind === 'wall') &&
        item.chainLink !== true,
    );
    // Non-vacuity: the farmland's edges are fenced and hedged.
    expect(fields.filter((item) => item.kind === 'fence').length).toBeGreaterThan(0);
    for (const item of fields) expect(item.chainLink).toBeUndefined();
  });

  it('fences through no building it carries', () => {
    const buildings = items.filter((item) => item.kind === 'building' || item.kind === 'shop-row');
    // Non-vacuity: the lots on the estate and the school are there.
    expect(buildings.length).toBeGreaterThan(5);
    for (const piece of chain) {
      const ux = Math.sin(piece.rotation);
      const uz = Math.cos(piece.rotation);
      for (const building of buildings) {
        const t = Math.max(
          -BOUNDARY_PIECE_METRES / 2,
          Math.min(
            BOUNDARY_PIECE_METRES / 2,
            (building.x - piece.x) * ux + (building.z - piece.z) * uz,
          ),
        );
        expect(
          Math.hypot(building.x - (piece.x + ux * t), building.z - (piece.z + uz * t)),
        ).toBeGreaterThanOrEqual(CHAIN_LINK_BUILDING_CLEARANCE_METRES);
      }
    }
  });

  it('drops a piece that would run through a building, and keeps one clear of every building', () => {
    const building = items.find((item) => item.kind === 'building');
    if (building === undefined) throw new Error('the fixture carries no building');
    const near = nearestOnDrawnRoad(profile, origin, building.x, building.z, 60);
    if (near === undefined) throw new Error('the building is off the road');
    const through: ChainLinkPiece = {
      item: { ...(chain[0] as (typeof chain)[number]), x: building.x, z: building.z },
      along: near.along,
    };
    const clear = pieces[0] as ChainLinkPiece;
    const crossing: MappedTown = { ...town, chainLinkAt: () => [through, clear] };
    const carried = structuresAt(profile, origin, seed, 900, 2_100, budget, [], land, crossing);
    expect(carried.filter((item) => item.chainLink === true)).toEqual([clear.item]);
  });

  it('stands a loop’s chain-link on every lap, not only the first', () => {
    const lap = circuitRoute(100);
    const lapOrigin = corridorOrigin(lap);
    const piece: ChainLinkPiece = { item: chain[0] as (typeof chain)[number], along: 300 };
    const looped: MappedTown = { ...town, chainLinkAt: () => [piece] };
    const onLap = (lapNumber: number) =>
      structuresAt(
        lap,
        lapOrigin,
        seed,
        lapNumber * lap.totalDistance + 250,
        lapNumber * lap.totalDistance + 350,
        budget,
        [],
        land,
        looped,
      ).filter((item) => item.chainLink === true);
    // Non-vacuity: the first lap carries it, so a later lap's absence is the lap's.
    expect(onLap(0)).toHaveLength(1);
    expect(onLap(1)).toHaveLength(1);
    expect(onLap(3)).toHaveLength(1);
  });

  it('CONTROL: a ride with no corridor — the stylised world’s — has no chain-link', () => {
    const none = structuresAt(profile, origin, seed, 900, 2_100, budget, [], NO_LAND_CLASS);
    expect(none.filter((item) => item.chainLink === true)).toEqual([]);
    expect(NO_MAPPED_TOWN.chainLinkAt).toBeUndefined();
    // And the owner's page's before: the same town without its pieces.
    const without: MappedTown = { ...town };
    delete (without as { chainLinkAt?: unknown }).chainLinkAt;
    const before = structuresAt(profile, origin, seed, 900, 2_100, budget, [], land, without);
    expect(before.filter((item) => item.chainLink === true)).toEqual([]);
    expect(before.length).toBe(items.length - chain.length);
  });
});
