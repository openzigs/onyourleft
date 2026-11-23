// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3105: an open-world ride draws the map's real water, and its bridges as
 * decks over it.
 *
 * One synthetic block, every number this file's own and none a place: a
 * street ridden north, a river 60 m across that it crosses on a mapped
 * bridge, a second street beside it that crosses the same river on a bridge of
 * its own, a mapped tunnel further on, and ground with two valleys in it — one
 * 150 m short of the river and one more than a kilometre from it — so that the
 * view's own heights invent a stream at each (`waterways.ts`
 * §`findWaterways`).
 *
 * The tiles are planned as the worker plans them (`tile-planner.ts`
 * §`tilePlanWorkerCore`, and cloned as a transfer would), the mask is the one
 * the session hands the road (`water-mask.ts`), and what is asserted is read
 * off the frame the scene builds: the water's own triangles, the belt's
 * boxes, the side roads. Each case has a control with the change taken away.
 */

import {
  elevationAt,
  metres,
  RollingRoute,
  type RollingEdge,
  type RouteProfile,
} from '@onyourleft/domain';
import { graphOf, placeAt, streetThrough } from '@onyourleft/domain/rolling-testing';
import {
  columnAtLongitude,
  NO_ROAD_FIELDS,
  rowAtLatitude,
  type DecodedStreetFeature,
  type LandUseFeature,
  type StreetGrade,
  type TileId,
  type WaterLineFeature,
} from '@onyourleft/map-features';
import { beforeAll, describe, expect, it } from 'vitest';

import { NO_LAND_CLASS, type LandClassMask } from '../land-class';
import { NEARBY_STREETS_PER_FRAME } from '../nearby-streets';
import {
  PORTAL_CLEAR_METRES,
  riddenSpans,
  SPAN_SAMPLE_METRES,
  type RiddenSpan,
} from '../mapped-spans';
import type { SceneFrame } from '../port';
import { REALISTIC_STRUCTURE_ITEMS } from '../realistic-budget';
import { scatterSeed } from '../scatter';
import { sceneFrame } from '../scene';
import { atStartLine } from '../simulation';
import {
  corridorOrigin,
  drawnRoadPosition,
  localGroundPosition,
  ROAD_WIDTH_METRES,
} from '../terrain';
import {
  BRIDGE_CLEARANCE_METRES,
  BRIDGE_HALF_SPAN_METRES,
  MAXIMUM_BRIDGE_PARTS,
  PARAPET_THICKNESS_METRES,
  STREAM_HALF_WIDTH_METRES,
  waterways,
  type BridgePart,
} from '../waterways';
import type { WorldCorridor } from '../world-data/corridor';
import { OpenWorldRoad } from './road';
import { openWorldStreetCorridor } from './street-corridor';
import {
  TILE_LAND_CELL_METRES,
  tilePlanBuffers,
  type TileBlockFeatures,
  type TilePlan,
} from './tile-plan';
import { tilePlanWorkerCore } from './tile-planner';
import {
  openWorldWaterMask,
  REAL_WATER_BUFFER_METRES,
  WATER_BUFFER_CELL_METRES,
  WaterMaskKeeper,
} from './water-mask';

const FRAME = { latitude: 40, longitude: -105, elevation: 0 };
/** Where the ridden street starts, metres north of the frame's origin. */
const START_NORTH = -1_300;
/** The junction the ridden street ends at. */
const JUNCTION_NORTH = 900;
/** The river's banks, metres north. */
const RIVER = { south: 300, north: 360 };
/** The mapped bridge: over the river and 50 m of the land either side of it. */
const BRIDGE = { south: 250, north: 410 };
/** The mapped tunnel. */
const TUNNEL = { south: 500, north: 580 };
/** The second street, metres east of the ridden one. */
const SIDE_EAST = 120;
/** The valley beside the river, and the one far from it. */
const NEAR_VALLEY = 150;
const FAR_VALLEY = -900;

/** Two valleys, each a floor the road climbs 15 m out of within 300 m either way. */
const valleys = (_east: number, north: number): number =>
  Math.min(15, 0.05 * Math.min(Math.abs(north - NEAR_VALLEY), Math.abs(north - FAR_VALLEY)));

const local = (east: number, north: number) => localGroundPosition(FRAME, placeAt(east, north));

function edge(id: string, from: string, to: string, stops: [number, number][]): RollingEdge {
  return { id, from, to, points: streetThrough(stops, valleys), roadClass: 1 };
}

function rolling(): RollingRoute {
  // A stop every 50 m: a synthetic street takes its heights at its stops.
  const stops: [number, number][] = [];
  for (let north = START_NORTH; north <= JUNCTION_NORTH; north += 50) stops.push([0, north]);
  const start = edge('s', 'start', 'j', stops);
  return new RollingRoute(
    graphOf([
      start,
      edge('n', 'j', 'north', [
        [0, JUNCTION_NORTH],
        [0, JUNCTION_NORTH + 800],
      ]),
      edge('e', 'j', 'east', [
        [0, JUNCTION_NORTH],
        [800, JUNCTION_NORTH],
      ]),
      edge('w', 'j', 'west', [
        [0, JUNCTION_NORTH],
        [-800, JUNCTION_NORTH],
      ]),
    ]),
    start,
  );
}

function street(stops: [number, number][], grade: StreetGrade = 'ground'): DecodedStreetFeature {
  return {
    ...NO_ROAD_FIELDS,
    kind: 'minor_road',
    kindDetail: 'residential',
    grade,
    line: Float32Array.from(stops.flatMap(([e, n]) => [local(e, n).x, local(e, n).z])),
  };
}

const tileOf = (east: number, north: number): TileId => {
  const at = placeAt(east, north);
  return {
    z: 15,
    x: Math.floor(columnAtLongitude(at.longitude)),
    y: Math.floor(rowAtLatitude(at.latitude)),
  };
};

/** Every tile under the fixture, each once. */
function tilesUnder(): TileId[] {
  const tiles = new Map<string, TileId>();
  for (let east = -600; east <= 600; east += 200) {
    for (let north = START_NORTH - 100; north <= JUNCTION_NORTH + 900; north += 200) {
      const tile = tileOf(east, north);
      tiles.set(`${String(tile.x)}/${String(tile.y)}`, tile);
    }
  }
  return [...tiles.values()];
}

interface Fixture {
  /** How the second street's stretch over the river is graded. */
  readonly sideGrade?: StreetGrade;
  /** The river's north bank, for a wider river; and its bridge's end. */
  readonly riverNorth?: number;
  /** No water polygon and no water line: the map with no river on it. */
  readonly dry?: boolean;
}

function blockOf(fixture: Fixture = {}): TileBlockFeatures {
  const riverNorth = fixture.riverNorth ?? RIVER.north;
  const bridgeNorth = riverNorth + (BRIDGE.north - RIVER.north);
  const shift = riverNorth - RIVER.north;
  const streets: DecodedStreetFeature[] = [
    street([
      [0, START_NORTH],
      [0, BRIDGE.south],
    ]),
    street(
      [
        [0, BRIDGE.south],
        [0, bridgeNorth],
      ],
      'bridge',
    ),
    street([
      [0, bridgeNorth],
      [0, TUNNEL.south + shift],
    ]),
    street(
      [
        [0, TUNNEL.south + shift],
        [0, TUNNEL.north + shift],
      ],
      'tunnel',
    ),
    street([
      [0, TUNNEL.north + shift],
      [0, JUNCTION_NORTH + 800],
    ]),
    street([
      [SIDE_EAST, -200],
      [SIDE_EAST, BRIDGE.south],
    ]),
    street(
      [
        [SIDE_EAST, BRIDGE.south],
        [SIDE_EAST, bridgeNorth],
      ],
      fixture.sideGrade ?? 'bridge',
    ),
    street([
      [SIDE_EAST, bridgeNorth],
      [SIDE_EAST, 800],
    ]),
  ];
  const corners = [
    local(-600, RIVER.south),
    local(600, RIVER.south),
    local(600, riverNorth),
    local(-600, riverNorth),
  ];
  const river: LandUseFeature = {
    layer: 'water',
    kind: 'river',
    rings: [Float32Array.from(corners.flatMap((corner) => [corner.x, corner.z]))],
  };
  const middle = (RIVER.south + riverNorth) / 2;
  const line: WaterLineFeature = {
    kind: 'river',
    line: Float32Array.from(
      [local(-600, middle), local(600, middle)].flatMap((point) => [point.x, point.z]),
    ),
  };
  return {
    buildings: [],
    landUse: fixture.dry === true ? [] : [river],
    waterLines: fixture.dry === true ? [] : [line],
    tiles: tilesUnder().map((tile, index) => ({ tile, streets: index === 0 ? streets : [] })),
  };
}

/** Each of the block's tiles, planned as the worker plans it and cloned as a transfer is. */
function plansOf(block: TileBlockFeatures): TilePlan[] {
  const core = tilePlanWorkerCore();
  core.handle({ kind: 'frame', frame: FRAME });
  core.handle({ kind: 'hold', block: 'b', features: block });
  return block.tiles.map(({ tile }, id) => {
    const answer = core.handle({ kind: 'plan', id, block: 'b', tile, detail: 'full' });
    if (answer?.reply.kind !== 'plan') throw new Error('a tile was not planned');
    return structuredClone(answer.reply.plan, { transfer: answer.transfer });
  });
}

interface World {
  readonly block: TileBlockFeatures;
  readonly plans: readonly TilePlan[];
  readonly corridor: WorldCorridor;
  readonly land: LandClassMask | undefined;
  readonly profile: RouteProfile;
}

function worldOf(fixture: Fixture = {}): World {
  const block = blockOf(fixture);
  const plans = plansOf(block);
  const corridor = openWorldStreetCorridor(FRAME, [block]);
  const land = openWorldWaterMask(plans);
  const road = new OpenWorldRoad(rolling(), {
    frame: FRAME,
    streets: () => corridor,
    water: () => land,
  });
  return { block, plans, corridor, land, profile: road.view.profile };
}

/** The view's distance of a place `north` on the ridden street. */
const alongOf = (north: number): number => north - START_NORTH;

/** What a test reads of a frame, copied out: the water's buffers are lent (`waterways.ts`). */
interface Seen {
  /** Every water vertex drawn, `x, y, z`. */
  readonly water: readonly (readonly [number, number, number])[];
  readonly waterTriangles: number;
  readonly bridges: readonly BridgePart[];
  readonly sideRoads: SceneFrame['sideRoads'];
}

function see(world: World, north: number, land: LandClassMask | undefined = world.land): Seen {
  const { profile } = world;
  const start = atStartLine(profile);
  const frame = sceneFrame({
    profile,
    origin: corridorOrigin(profile),
    state: { ...start, ride: { ...start.ride, distance: metres(alongOf(north)) } },
    worldCorridor: world.corridor,
    landClass: land,
    structureItems: REALISTIC_STRUCTURE_ITEMS,
  });
  const { vertices, indices } = frame.water.surface;
  const used = new Set<number>(indices);
  return {
    water: [...used].map((vertex) => [
      vertices[vertex * 3] as number,
      vertices[vertex * 3 + 1] as number,
      vertices[vertex * 3 + 2] as number,
    ]),
    waterTriangles: indices.length / 3,
    bridges: [...frame.water.bridges],
    sideRoads: frame.sideRoads,
  };
}

/** The frame's `x` (metres WEST) and `z` (north) of a place. */
const xOf = (east: number): number => local(east, 0).x;
const zOf = (north: number): number => local(0, north).z;

const stone = (parts: readonly BridgePart[]): BridgePart[] =>
  parts.filter((part) => part.finish === undefined);
const parapets = (parts: readonly BridgePart[]): BridgePart[] =>
  stone(parts).filter((part) => part.width === PARAPET_THICKNESS_METRES);
const northOf = (part: { z: number }): number => part.z - zOf(0);
const between = (value: number, from: number, to: number): boolean => value >= from && value <= to;
/** Each place, every 4 m from `from` to `to` north, that none of `parts` reaches along the road. */
function gaps(parts: readonly BridgePart[], from: number, to: number): number[] {
  const open: number[] = [];
  for (let north = from; north <= to; north += 4) {
    if (!parts.some((part) => Math.abs(northOf(part) - north) <= part.length / 2 + 0.5)) {
      open.push(north);
    }
  }
  return open;
}

let world: World;
let wide: World;
let dry: World;
let groundSide: World;

beforeAll(() => {
  world = worldOf();
  wide = worldOf({ riverNorth: RIVER.south + 250 });
  dry = worldOf({ dry: true });
  groundSide = worldOf({ sideGrade: 'ground' });
});

describe('the tiles hold the real water — #3105', () => {
  it('plans the river’s water line in exactly one tile, and carries it across a transfer', () => {
    const owners = world.plans.filter((plan) => plan.water.count > 0);
    expect(owners).toHaveLength(1);
    const [owner] = owners as [TilePlan];
    expect(owner.water.lines).toHaveLength(4);
    // The line is the block's own, float for float.
    expect([...owner.water.lines]).toStrictEqual([...(world.block.waterLines?.[0]?.line ?? [])]);
    // And its buffers are among the ones a worker transfers.
    const buffers = tilePlanBuffers(owner);
    for (const array of [owner.water.kinds, owner.water.lineStarts, owner.water.lines]) {
      expect(buffers).toContain(array.buffer);
    }
  });

  it('answers water on the river, nothing else anywhere, and covered only in the river’s buffer', () => {
    const land = world.land;
    expect(land).toBeDefined();
    if (land === undefined) return;
    const onRiver = local(0, 330);
    expect(land.classAt(onRiver.x, onRiver.z)).toBe('water');
    expect(land.wetlandAt(onRiver.x, onRiver.z)).toBe(false);
    // Off the river the mask says nothing, whatever the tile's land holds.
    for (const north of [0, 200, 500, 1_000]) {
      const at = local(40, north);
      expect(land.classAt(at.x, at.z)).toBe('unknown');
    }
    expect(land.waterLines.map((line) => line.kind)).toStrictEqual(['river']);
    expect(land.bytes).toBeGreaterThan(0);
    // The buffer: within 200 m of a bank, and not a buffer and two cells past it.
    for (const north of [RIVER.south - 150, RIVER.north + 150, 330]) {
      const at = local(0, north);
      expect(land.covered(at.x, at.z)).toBe(true);
    }
    const past = REAL_WATER_BUFFER_METRES + 2 * WATER_BUFFER_CELL_METRES;
    for (const north of [RIVER.south - past, RIVER.north + past, FAR_VALLEY]) {
      const at = local(0, north);
      expect(land.covered(at.x, at.z)).toBe(false);
    }
  });

  it('marks a mapped wetland as wetland, and cuts no crossing through it', () => {
    const corners = [local(-600, 300), local(600, 300), local(600, 360), local(-600, 360)];
    const marsh: LandUseFeature = {
      layer: 'landuse',
      kind: 'wetland',
      rings: [Float32Array.from(corners.flatMap((corner) => [corner.x, corner.z]))],
    };
    const land = openWorldWaterMask(plansOf({ ...blockOf({ dry: true }), landUse: [marsh] }));
    expect(land).toBeDefined();
    if (land === undefined) return;
    const at = local(0, 330);
    expect(land.classAt(at.x, at.z)).toBe('water');
    expect(land.wetlandAt(at.x, at.z)).toBe(true);
    // Wet ground, not a river: the road is not bridged over it.
    const profile = dry.profile;
    expect(
      waterways(profile, scatterSeed(profile), land).crossings.filter(
        (crossing) => crossing.halfWidth !== undefined,
      ),
    ).toStrictEqual([]);
    // Control: the same polygon as open water is a crossing.
    const open = openWorldWaterMask(
      plansOf({
        ...blockOf({ dry: true }),
        landUse: [{ ...marsh, layer: 'water', kind: 'river' }],
      }),
    );
    expect(
      waterways(profile, scatterSeed(profile), open ?? NO_LAND_CLASS).crossings.filter(
        (crossing) => crossing.halfWidth !== undefined,
      ),
    ).toHaveLength(1);
  });

  it('is no mask at all where no tile holds water', () => {
    expect(dry.land).toBeUndefined();
    expect(openWorldWaterMask([])).toBeUndefined();
  });

  it('keeps one mask until a tile that holds water is planned or let go', () => {
    const keeper = new WaterMaskKeeper();
    const wet = world.plans.filter((plan) => plan.water.count > 0 || plan.land.classes.includes(1));
    const parched = world.plans.filter((plan) => !wet.includes(plan));
    expect(wet.length).toBeGreaterThan(0);
    expect(parched.length).toBeGreaterThan(0);
    expect(keeper.of(parched)).toBeUndefined();
    const first = keeper.of([...parched, ...wet]);
    expect(first).toBeDefined();
    // A tile with no water planned or let go: the same object.
    expect(keeper.of(wet)).toBe(first);
    expect(keeper.of([...wet].reverse())).toBe(first);
    // A tile that holds water let go: another mask, or none.
    const fewer = keeper.of(wet.slice(1));
    expect(fewer).not.toBe(first);
    expect(keeper.of([])).toBeUndefined();
  });
});

describe('an open-world ride draws a real river and the bridge over it — #3105', () => {
  it('rides the fixture’s street where the fixture says it is', () => {
    const origin = corridorOrigin(world.profile);
    for (const north of [BRIDGE.south, 330, TUNNEL.north]) {
      const at = drawnRoadPosition(world.profile, origin, alongOf(north));
      expect(Math.abs(at.x - xOf(0))).toBeLessThan(0.5);
      expect(Math.abs(at.z - zOf(north))).toBeLessThan(0.5);
    }
  });

  it('makes the river one crossing as wide as its water, and no invented stream in its buffer', () => {
    const { profile, land } = world;
    if (land === undefined) throw new Error('no water mask');
    const seed = scatterSeed(profile);
    // Control: with no map, the view's own heights invent a stream at each valley.
    const invented = waterways(profile, seed, NO_LAND_CLASS).crossings;
    const inventedNorths = invented.map((crossing) => crossing.distance + START_NORTH);
    expect(inventedNorths.some((north) => Math.abs(north - NEAR_VALLEY) < 20)).toBe(true);
    expect(inventedNorths.some((north) => Math.abs(north - FAR_VALLEY) < 20)).toBe(true);
    expect(invented.every((crossing) => crossing.halfWidth === undefined)).toBe(true);

    const mapped = waterways(profile, seed, land).crossings;
    const norths = mapped.map((crossing) => crossing.distance + START_NORTH);
    // The river: one crossing, at its middle, half as wide as its water.
    const rivers = mapped.filter((crossing) => crossing.halfWidth !== undefined);
    expect(rivers).toHaveLength(1);
    const [river] = rivers as [(typeof mapped)[number]];
    expect(Math.abs(river.distance + START_NORTH - 330)).toBeLessThan(10);
    expect(river.halfWidth).toBeGreaterThan(20);
    expect(river.halfWidth).toBeLessThan(45);
    // No invented stream within the river's buffer: the near valley's is gone.
    for (const north of norths) {
      const realRiver = Math.abs(north - 330) < 10;
      const inBuffer = between(
        north,
        RIVER.south - REAL_WATER_BUFFER_METRES,
        RIVER.north + REAL_WATER_BUFFER_METRES,
      );
      expect(realRiver || !inBuffer).toBe(true);
    }
    // The far valley's, a kilometre from any real water, is the ride's as before.
    expect(norths.some((north) => Math.abs(north - FAR_VALLEY) < 20)).toBe(true);
  });

  it('draws the river’s water under the road, bank to bank, where none was drawn', () => {
    const origin = corridorOrigin(world.profile);
    const roadY = (north: number): number =>
      drawnRoadHeight(world.profile, alongOf(north)) - origin.elevation;
    const seen = see(world, 200);
    const inRiver = seen.water.filter(
      ([x, , z]) => Math.abs(x - xOf(0)) < 30 && between(z - zOf(0), RIVER.south, RIVER.north),
    );
    expect(inRiver.length).toBeGreaterThan(0);
    // Below the deck: the water lies a bridge's clearance under the road.
    for (const [, y] of inRiver) {
      expect(y).toBeLessThan(roadY(330) - BRIDGE_CLEARANCE_METRES + 0.5);
    }
    // Bank to bank: water reaches both banks, as a stream's eight metres would not.
    const drawnNorths = seen.water
      .filter(([x]) => Math.abs(x - xOf(0)) < 30)
      .map(([, , z]) => z - zOf(0));
    expect(Math.min(...drawnNorths)).toBeLessThanOrEqual(RIVER.south);
    expect(Math.max(...drawnNorths)).toBeGreaterThanOrEqual(RIVER.north);
    // Control: the same frame with no water mask draws no water on the river.
    const bare = see(world, 200, NO_LAND_CLASS);
    expect(
      bare.water.filter(([, , z]) => between(z - zOf(0), RIVER.south, RIVER.north)),
    ).toStrictEqual([]);
  });

  it('draws the ridden road over it as a bridge deck: parapets along the whole mapped span', () => {
    const seen = see(world, 200);
    const beside = parapets(seen.bridges).filter(
      (part) => Math.abs(Math.abs(part.x - xOf(0)) - ROAD_WIDTH_METRES / 2) < 1,
    );
    // Both edges of the road, and from one end of the mapped bridge to the other.
    for (const side of [1, -1]) {
      const edgeParts = beside.filter((part) => Math.sign(part.x - xOf(0)) === side);
      const reach = edgeParts.flatMap((part) => [
        northOf(part) - part.length / 2,
        northOf(part) + part.length / 2,
      ]);
      expect(Math.min(...reach)).toBeLessThanOrEqual(BRIDGE.south + SPAN_SAMPLE_METRES);
      expect(Math.max(...reach)).toBeGreaterThanOrEqual(BRIDGE.north - SPAN_SAMPLE_METRES);
      // With no gap: the river's own bridge in the middle, the mapped span's either end.
      expect(
        gaps(edgeParts, BRIDGE.south + SPAN_SAMPLE_METRES, BRIDGE.north - SPAN_SAMPLE_METRES),
      ).toStrictEqual([]);
    }
    // A slab under the deck over the water: a box as wide as the road and its parapets.
    const slabs = stone(seen.bridges).filter(
      (part) =>
        Math.abs(part.width - (ROAD_WIDTH_METRES + PARAPET_THICKNESS_METRES * 2)) < 1e-6 &&
        between(northOf(part), RIVER.south, RIVER.north),
    );
    expect(slabs.length).toBeGreaterThan(0);
    // Control: no mask and no mapped bridge on the corridor, and nothing stands at the river.
    const flatCorridor: World = {
      ...world,
      corridor: openWorldStreetCorridor(FRAME, [
        { ...world.block, tiles: world.block.tiles.map((each) => ({ ...each, streets: [] })) },
      ]),
    };
    const bare = see(flatCorridor, 200, NO_LAND_CLASS);
    expect(
      bare.bridges.filter((part) => between(northOf(part), BRIDGE.south, BRIDGE.north)),
    ).toStrictEqual([]);
  });

  it('finds the ridden road’s mapped bridge and tunnel as spans of the view', () => {
    const spans = riddenSpans(world.corridor, world.profile, corridorOrigin(world.profile));
    const norths = spans.map((span) => ({
      grade: span.grade,
      from: span.from + START_NORTH,
      to: span.to + START_NORTH,
    }));
    const near = (span: (typeof norths)[number], stretch: { south: number; north: number }) =>
      Math.abs(span.from - stretch.south) <= SPAN_SAMPLE_METRES &&
      Math.abs(span.to - stretch.north) <= SPAN_SAMPLE_METRES;
    expect(norths.filter((span) => span.grade === 'bridge')).toHaveLength(1);
    expect(norths.filter((span) => span.grade === 'tunnel')).toHaveLength(1);
    expect(near(norths.find((span) => span.grade === 'bridge') as never, BRIDGE)).toBe(true);
    expect(near(norths.find((span) => span.grade === 'tunnel') as never, TUNNEL)).toBe(true);
    // The second street's bridge, 120 m off and parallel, is not the road's.
    const sideOnly: RiddenSpan[] = [
      ...riddenSpans(
        openWorldStreetCorridor(FRAME, [
          {
            ...world.block,
            tiles: world.block.tiles.map((each, index) => ({
              ...each,
              streets:
                index === 0
                  ? [
                      street(
                        [
                          [SIDE_EAST, BRIDGE.south],
                          [SIDE_EAST, BRIDGE.north],
                        ],
                        'bridge',
                      ),
                      // And a bridge that crosses the road square is an overpass, not the road.
                      street(
                        [
                          [-100, 100],
                          [100, 100],
                        ],
                        'bridge',
                      ),
                    ]
                  : [],
            })),
          },
        ]),
        world.profile,
        corridorOrigin(world.profile),
      ),
    ];
    expect(sideOnly).toStrictEqual([]);
  });

  it('draws a portal at each mouth of the ridden road’s tunnel', () => {
    const seen = see(world, TUNNEL.south - 80);
    const concrete = seen.bridges.filter((part) => part.finish === 'concrete');
    for (const mouth of [TUNNEL.south, TUNNEL.north]) {
      const at = concrete.filter((part) => Math.abs(northOf(part) - mouth) <= SPAN_SAMPLE_METRES);
      // Two jambs clear of the carriageway and a lintel over it.
      const jambs = at.filter((part) => part.height === PORTAL_CLEAR_METRES);
      expect(jambs).toHaveLength(2);
      for (const jamb of jambs) {
        expect(Math.abs(jamb.x - xOf(0)) - jamb.width / 2).toBeGreaterThanOrEqual(
          ROAD_WIDTH_METRES / 2,
        );
      }
      const lintels = at.filter((part) => part.height !== PORTAL_CLEAR_METRES);
      expect(lintels).toHaveLength(1);
      const [lintel] = lintels as [BridgePart];
      const roadY = drawnRoadHeight(world.profile, alongOf(mouth));
      expect(lintel.y - lintel.height / 2 - roadY).toBeCloseTo(PORTAL_CLEAR_METRES, 3);
      expect(lintel.width).toBeGreaterThan(ROAD_WIDTH_METRES);
    }
  });
});

describe('a side street on a bridge is drawn as a deck, not dropped — #3105', () => {
  /** The side roads' drawn segments on the second street between the river's banks. */
  const overRiver = (seen: Seen): number =>
    seen.sideRoads.flatMap((road) => {
      const found: number[] = [];
      for (let at = 0; at + 3 < road.segments.length; at += 4) {
        const x = ((road.segments[at] as number) + (road.segments[at + 2] as number)) / 2;
        const z = ((road.segments[at + 1] as number) + (road.segments[at + 3] as number)) / 2;
        if (Math.abs(x - xOf(SIDE_EAST)) < 1 && between(z - zOf(0), RIVER.south, RIVER.north)) {
          found.push(z);
        }
      }
      return found;
    }).length;

  it('draws the bridge’s road across the river, with a parapet along each edge', () => {
    const seen = see(world, 200);
    // 60 m of river at 4 m a station: the deck is whole across it.
    expect(overRiver(seen)).toBeGreaterThanOrEqual(12);
    const decks = seen.sideRoads.filter((road) => road.deck === true);
    expect(decks.length).toBeGreaterThan(0);
    for (const deck of decks) expect(deck.mesh.indices.length).toBeGreaterThan(0);
    // A parapet along each edge, between the banks.
    const beside = parapets(seen.bridges).filter(
      (part) =>
        Math.abs(part.x - xOf(SIDE_EAST)) < 6 && between(northOf(part), RIVER.south, RIVER.north),
    );
    expect(beside.some((part) => part.x > xOf(SIDE_EAST))).toBe(true);
    expect(beside.some((part) => part.x < xOf(SIDE_EAST))).toBe(true);
    // And every deck is at the level of the road it is drawn beside, over the water too.
    const river = waterways(
      world.profile,
      scatterSeed(world.profile),
      world.land ?? NO_LAND_CLASS,
    ).crossings.find((crossing) => crossing.halfWidth !== undefined);
    expect(river).toBeDefined();
    let overWater = 0;
    for (const deck of decks) {
      const { positions } = deck.mesh;
      for (let at = 0; at + 2 < positions.length; at += 3) {
        const north = (positions[at + 2] as number) - zOf(0);
        const height = positions[at + 1] as number;
        const road = elevationAt(world.profile, alongOf(north));
        expect(Math.abs(height - road)).toBeLessThan(0.5);
        if (between(north, RIVER.south, RIVER.north)) {
          overWater += 1;
          expect(height).toBeGreaterThan((river?.waterElevation ?? 0) + 1);
        }
      }
    }
    expect(overWater).toBeGreaterThan(0);
  });

  it('is what the street lacked: the same stretch mapped on the ground stops at the water', () => {
    const seen = see(groundSide, 200);
    expect(overRiver(seen)).toBe(0);
    expect(seen.sideRoads.filter((road) => road.deck === true)).toStrictEqual([]);
  });
});

describe('the budgets hold on a long bridge — #3105', () => {
  it('spans a 250 m river inside the belt’s boxes, and in a stream’s own triangles', () => {
    const { profile, land } = wide;
    if (land === undefined) throw new Error('no water mask');
    const river = waterways(profile, scatterSeed(profile), land).crossings.find(
      (crossing) => crossing.halfWidth !== undefined,
    );
    expect(river?.halfWidth).toBeGreaterThan(110);
    expect(river?.halfWidth).toBeLessThan(140);
    const streamTriangles = see(world, 200).waterTriangles;
    for (const north of [100, 200, 300, 425, 520]) {
      const seen = see(wide, north);
      expect(seen.bridges.length).toBeLessThanOrEqual(MAXIMUM_BRIDGE_PARTS);
      expect(stone(seen.bridges).length).toBeLessThanOrEqual(MAXIMUM_BRIDGE_PARTS);
      expect(seen.sideRoads.length).toBeLessThanOrEqual(NEARBY_STREETS_PER_FRAME + 8);
      // The river's water is the strip a stream's is, stretched: not a triangle more.
      expect(seen.waterTriangles).toBeLessThanOrEqual(streamTriangles);
    }
    // And its parapets run from bank to bank on both edges.
    const seen = see(wide, 300);
    const beside = parapets(seen.bridges).filter(
      (part) => Math.abs(Math.abs(part.x - xOf(0)) - ROAD_WIDTH_METRES / 2) < 1,
    );
    const reach = beside.flatMap((part) => [
      northOf(part) - part.length / 2,
      northOf(part) + part.length / 2,
    ]);
    expect(Math.min(...reach)).toBeLessThanOrEqual(RIVER.south);
    expect(Math.max(...reach)).toBeGreaterThanOrEqual(RIVER.south + 250);
    // With no gap on either edge, and a slab under the deck all the way over the water.
    for (const side of [1, -1]) {
      const edgeParts = beside.filter((part) => Math.sign(part.x - xOf(0)) === side);
      expect(gaps(edgeParts, RIVER.south, RIVER.south + 250)).toStrictEqual([]);
    }
    const slabs = stone(seen.bridges).filter(
      (part) => Math.abs(part.width - (ROAD_WIDTH_METRES + PARAPET_THICKNESS_METRES * 2)) < 1e-6,
    );
    expect(gaps(slabs, RIVER.south, RIVER.south + 250 - TILE_LAND_CELL_METRES.full)).toStrictEqual(
      [],
    );
    // A stream's bridge is 24 m; this one is the river's width and its abutments'.
    expect(Math.max(...reach) - Math.min(...reach)).toBeGreaterThan(
      2 * BRIDGE_HALF_SPAN_METRES + 250 - 2 * STREAM_HALF_WIDTH_METRES - 20,
    );
  });
});

/** The road's height at a view distance, in the profile's own datum. */
function drawnRoadHeight(profile: RouteProfile, along: number): number {
  return elevationAt(profile, along);
}
