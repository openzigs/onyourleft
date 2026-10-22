// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1546: the land-class mask, and the two rules that hold the moment map data
 * exists — no procedural village on mapped land, and nothing growing on
 * mapped built-up land or water.
 *
 * Every placement assertion reads what `structuresAt`, `scatterAt`,
 * `streetsAt` and `sceneFrame` hand back — the paths the renderer is handed —
 * and each has its control: the same call with {@link NO_LAND_CLASS}, which
 * must still place what the rule takes away, so a fixture that placed nothing
 * there cannot pass for the rule holding.
 */

import { getHeapStatistics, GCProfiler } from 'node:v8';

import { describe, expect, it } from 'vitest';

import { metres } from '@onyourleft/domain';

import {
  decodeTile,
  tileBox,
  type Box,
  type LandUseFeature,
  type TileId,
} from '@onyourleft/map-features';
import {
  FIXTURE_FRAME,
  FIXTURE_TILE,
  lakeTile,
  residentialBlockTile,
  woodWithHoleTile,
} from '@onyourleft/map-features/testing';

import {
  LAND_CLASS_MAX_BYTES,
  LAND_CLASS_OF_KIND,
  landClassMask,
  landClassOfKind,
  NO_LAND_CLASS,
  type LandClassMask,
} from './land-class';
import { northRoute } from './route-fixtures-testing';
import { scatterAt, scatterSeed, type ScatterItem } from './scatter';
import { sceneFrame } from './scene';
import {
  clearOfSettlements,
  siteAt,
  siteOnMappedLand,
  siteSpacing,
  structuresAt,
} from './settlements';
import { atStartLine } from './simulation';
import { streetsAt } from './streets';
import { corridorOrigin } from './terrain';
import { planCorridor, type WorldCorridor } from './world-data/corridor';

/** A corridor of the given covered boxes and land use, in local metres. */
function corridorOf(boxes: readonly Box[], landUse: readonly LandUseFeature[]): WorldCorridor {
  return {
    routeId: 'land-class-fixture',
    origin: { latitude: FIXTURE_FRAME.latitude, longitude: FIXTURE_FRAME.longitude, elevation: 0 },
    covered: (x, z) =>
      boxes.some((box) => x >= box.minX && x < box.maxX && z >= box.minZ && z < box.maxZ),
    coveredBoxes: boxes,
    landUse,
    buildings: [],
    paths: [],
  };
}

/** A rectangle of land use, in local metres. */
function rectangle(layer: LandUseFeature['layer'], kind: string, box: Box): LandUseFeature {
  return {
    layer,
    kind,
    rings: [
      Float32Array.of(
        box.minX,
        box.minZ,
        box.maxX,
        box.minZ,
        box.maxX,
        box.maxZ,
        box.minX,
        box.maxZ,
      ),
    ],
  };
}

const BUILDING_KINDS = new Set(['building', 'church', 'shop-row', 'barn', 'shed', 'signpost']);
const BOUNDARY_KINDS = new Set(['wall', 'hedge', 'fence']);
const VEGETATION_KINDS = new Set(['tree-broadleaf', 'tree-conifer', 'shrub', 'rock']);

describe('the class at a point, by rule — #1544’s fixtures', () => {
  const box = tileBox(FIXTURE_FRAME, FIXTURE_TILE);
  /** A tile pixel's local metres: `x` is metres WEST, so the tile's west edge is `maxX`. */
  const at = (px: number, py: number): readonly [number, number] => [
    box.maxX - (px / 4096) * (box.maxX - box.minX),
    box.maxZ - (py / 4096) * (box.maxZ - box.minZ),
  ];
  const decoded = (bytes: Uint8Array): readonly LandUseFeature[] => {
    const tile = decodeTile(bytes, FIXTURE_TILE, FIXTURE_FRAME);
    if ('reason' in tile) throw new Error(`fixture refused: ${tile.reason}`);
    return tile.landUse;
  };
  // The residential block (600–1400 px) with the wood (1500 px, r 900, a
  // clearing at 1450, 1550 r 320) drawn over its corner, the lake, and a
  // farmland strip along the tile's southern edge.
  const [southX0, southZ0] = at(200, 3700);
  const [southX1, southZ1] = at(3900, 3950);
  const landUse = [
    ...decoded(residentialBlockTile()),
    ...decoded(woodWithHoleTile()),
    ...decoded(lakeTile()),
    rectangle('landuse', 'farmland', {
      minX: Math.min(southX0, southX1),
      maxX: Math.max(southX0, southX1),
      minZ: Math.min(southZ0, southZ1),
      maxZ: Math.max(southZ0, southZ1),
    }),
  ];
  const mask = landClassMask(corridorOf([box], landUse));

  it('reads wood inside the wood, built-up in the rest of the block, water, farmland, and unknown outside', () => {
    // Inside the wood and inside the block: the wood wins.
    expect(mask.classAt(...at(1350, 800))).toBe('wood');
    // The block's corner the wood does not reach.
    expect(mask.classAt(...at(700, 700))).toBe('built-up');
    // The wood's clearing is the block again.
    expect(mask.classAt(...at(1300, 1300))).toBe('built-up');
    // The wood outside the block.
    expect(mask.classAt(...at(2100, 1900))).toBe('wood');
    expect(mask.classAt(...at(2600, 2400))).toBe('water');
    expect(mask.classAt(...at(2000, 3800))).toBe('farmland');
    // Covered, and no polygon: other.
    expect(mask.classAt(...at(3800, 400))).toBe('other');
    expect(mask.covered(...at(3800, 400))).toBe(true);
    // Outside the covered tile: the procedural world decides.
    expect(mask.classAt(box.maxX + 50, box.maxZ + 50)).toBe('unknown');
    expect(mask.covered(box.minX - 50, box.minZ - 50)).toBe(false);
    expect(mask.classAt(Number.NaN, 0)).toBe('unknown');
  });

  it('keeps a polygon that reaches past the covered tile off the land outside it', () => {
    const half: Box = { ...box, maxX: (box.minX + box.maxX) / 2 };
    const wide = rectangle('landuse', 'residential', {
      minX: box.minX - 100,
      maxX: box.maxX + 100,
      minZ: box.minZ,
      maxZ: box.maxZ,
    });
    const halfMask = landClassMask(corridorOf([half], [wide]));
    const z = (box.minZ + box.maxZ) / 2;
    expect(halfMask.classAt(half.minX + 20, z)).toBe('built-up');
    expect(halfMask.classAt(half.maxX + 20, z)).toBe('unknown');
  });

  it('measures what it holds', () => {
    expect(mask.bytes).toBeGreaterThan(0);
    expect(mask.bytes % 4096).toBe(0);
    expect(NO_LAND_CLASS.bytes).toBe(0);
    expect(NO_LAND_CLASS.classAt(0, 0)).toBe('unknown');
    expect(NO_LAND_CLASS.covered(0, 0)).toBe(false);
  });
});

describe('the kind table', () => {
  it('classes every kind in #1546’s table, and every other kind as other — never built-up', () => {
    expect(landClassOfKind('landuse', 'residential')).toBe('built-up');
    expect(landClassOfKind('landuse', 'scrub')).toBe('wood');
    expect(landClassOfKind('landuse', 'cemetery')).toBe('park');
    expect(landClassOfKind('landuse', 'meadow')).toBe('farmland');
    expect(landClassOfKind('landuse', 'marina')).toBe('water');
    expect(landClassOfKind('landuse', 'beach')).toBe('other');
    expect(landClassOfKind('landuse', 'aerodrome')).toBe('other');
    expect(landClassOfKind('landuse', 'a kind nobody wrote down')).toBe('other');
    // A `water` feature is water, whatever its kind says.
    expect(landClassOfKind('water', 'residential')).toBe('water');
    expect(Object.keys(LAND_CLASS_OF_KIND)).toHaveLength(41);
  });

  it('does not find Object’s own properties for a hostile kind', () => {
    for (const kind of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(landClassOfKind('landuse', kind)).toBe('other');
    }
  });
});

/** A level 6 km road due north: local `z` is distance along, `x` is across. */
const ROUTE = northRoute(6_000, () => 10);
const ORIGIN = corridorOrigin(ROUTE);
const SEED = scatterSeed(ROUTE);
/** The middle 2 km, covered, 1 km either side of the road. */
const MIDDLE: Box = { minX: -1_000, maxX: 1_000, minZ: 2_000, maxZ: 4_000 };
const ALL = { maxItems: 100_000, riderMetres: 0 };

const structures = (land: LandClassMask): readonly ScatterItem[] =>
  structuresAt(ROUTE, ORIGIN, SEED, 0, ROUTE.totalDistance, ALL, undefined, land);
const scenery = (land: LandClassMask): readonly ScatterItem[] =>
  scatterAt(ROUTE, ORIGIN, SEED, 0, ROUTE.totalDistance, ALL, land);
const key = (item: ScatterItem): string => `${item.kind} ${item.x.toFixed(3)} ${item.z.toFixed(3)}`;

describe('no procedural village in mapped land — P-9, ADR 0054 D-5.3', () => {
  const farmland = landClassMask(corridorOf([MIDDLE], [rectangle('landuse', 'farmland', MIDDLE)]));

  it('places no building, church, shop row, barn, shed or signpost of a site that touches the covered stretch', () => {
    const placed = structures(farmland).filter((item) => BUILDING_KINDS.has(item.kind));
    for (const item of placed) expect(farmland.covered(item.x, item.z)).toBe(false);
    // Every site touching the stretch is gone whole, not only its covered half.
    const { sites } = siteSpacing(ROUTE);
    const touching = Array.from({ length: sites }, (_, index) => siteAt(ROUTE, SEED, index))
      .filter((site) => site !== undefined)
      .filter((site) => siteOnMappedLand(ROUTE, ORIGIN, site, farmland));
    expect(touching.length).toBeGreaterThan(0);
    for (const site of touching) {
      const reach = site.half + 20;
      expect(
        placed.filter((item) => Math.abs(item.z - site.centre) <= reach),
        `site ${String(site.site)}`,
      ).toStrictEqual([]);
    }
  });

  it('reads the whole of a site’s ground, not only the road it stands beside', () => {
    // Covered from 8 m off the road on one side only: the centreline is not.
    const beside: Box = { minX: 8, maxX: 1_000, minZ: 0, maxZ: ROUTE.totalDistance };
    const mask = landClassMask(corridorOf([beside], [rectangle('landuse', 'farmland', beside)]));
    const placed = structures(mask).filter((item) => BUILDING_KINDS.has(item.kind));
    expect(placed.filter((item) => mask.covered(item.x, item.z))).toStrictEqual([]);
    // Control: today, buildings stand on that side.
    const today = structures(NO_LAND_CLASS).filter((item) => BUILDING_KINDS.has(item.kind));
    expect(today.filter((item) => mask.covered(item.x, item.z)).length).toBeGreaterThan(0);
  });

  it('control: without the mask, the covered stretch has procedural buildings', () => {
    const today = structures(NO_LAND_CLASS).filter(
      (item) => BUILDING_KINDS.has(item.kind) && item.kind !== 'signpost',
    );
    expect(today.filter((item) => farmland.covered(item.x, item.z)).length).toBeGreaterThan(0);
  });

  it('leaves the uncovered ends exactly as today', () => {
    const far = (item: ScatterItem): boolean =>
      item.z < MIDDLE.minZ - 250 || item.z > MIDDLE.maxZ + 250;
    const today = structures(NO_LAND_CLASS).filter(far).map(key);
    const masked = structures(farmland).filter(far).map(key);
    expect(today.length).toBeGreaterThan(0);
    expect(masked).toStrictEqual(today);
  });

  it('lays no village street on the covered stretch either', () => {
    const covered = streetsAt(ROUTE, ORIGIN, SEED, 0, ROUTE.totalDistance, farmland);
    const today = streetsAt(ROUTE, ORIGIN, SEED, 0, ROUTE.totalDistance);
    const onIt = (from: number, to: number): boolean => to >= MIDDLE.minZ && from <= MIDDLE.maxZ;
    expect(covered.filter((street) => onIt(street.from, street.to))).toStrictEqual([]);
    // Control: today there is one there, so the assertion above can fail.
    const there = today.filter((street) => onIt(street.from, street.to));
    expect(there.length).toBeGreaterThan(0);
    // And through the frame: riding past it, the frame lays none.
    const input = { profile: ROUTE, origin: ORIGIN, state: atStartLine(ROUTE) };
    const distance = (there[0] as (typeof there)[number]).from;
    const riding = {
      ...input,
      state: { ...input.state, ride: { ...input.state.ride, distance: metres(distance) } },
    };
    expect(
      sceneFrame({ ...riding, landClass: farmland }).streets.filter((street) =>
        onIt(street.from, street.to),
      ),
    ).toStrictEqual([]);
    expect(sceneFrame(riding).streets.length).toBeGreaterThan(0);
  });

  it('costs nothing and moves nothing with no map data', () => {
    expect(structures(NO_LAND_CLASS).map(key)).toStrictEqual(
      structuresAt(ROUTE, ORIGIN, SEED, 0, ROUTE.totalDistance, ALL).map(key),
    );
  });
});

describe('a field boundary runs only on field ground', () => {
  it('runs none through a mapped wood or park, and keeps them on mapped farmland', () => {
    const wood: Box = { ...MIDDLE, maxZ: 2_700 };
    const park: Box = { ...MIDDLE, minZ: 2_700, maxZ: 3_300 };
    const fields: Box = { ...MIDDLE, minZ: 3_300 };
    const mask = landClassMask(
      corridorOf(
        [MIDDLE],
        [
          rectangle('landuse', 'forest', wood),
          rectangle('landuse', 'park', park),
          rectangle('landuse', 'farmland', fields),
        ],
      ),
    );
    const edges = structures(mask).filter((item) => BOUNDARY_KINDS.has(item.kind));
    const on = (cls: string) => edges.filter((item) => mask.classAt(item.x, item.z) === cls);
    expect(on('wood')).toStrictEqual([]);
    expect(on('park')).toStrictEqual([]);
    expect(on('farmland').length).toBeGreaterThan(0);
    // Control: today there are boundaries in both.
    const today = structures(NO_LAND_CLASS).filter((item) => BOUNDARY_KINDS.has(item.kind));
    expect(today.filter((item) => mask.classAt(item.x, item.z) === 'wood').length).toBeGreaterThan(
      0,
    );
    expect(today.filter((item) => mask.classAt(item.x, item.z) === 'park').length).toBeGreaterThan(
      0,
    );
  });
});

describe('nothing grows on mapped built-up land or water', () => {
  const town: Box = { ...MIDDLE, maxZ: 3_000 };
  const lake: Box = { ...MIDDLE, minZ: 3_000 };
  const mask = landClassMask(
    corridorOf(
      [MIDDLE],
      [rectangle('landuse', 'residential', town), rectangle('water', 'lake', lake)],
    ),
  );
  const onBuiltOrWater = (item: ScatterItem): boolean => {
    const here = mask.classAt(item.x, item.z);
    return here === 'built-up' || here === 'water';
  };

  it('places no tree, shrub or rock on a built-up or water cell', () => {
    const grown = scenery(mask).filter((item) => VEGETATION_KINDS.has(item.kind));
    expect(grown.filter(onBuiltOrWater)).toStrictEqual([]);
    // Control: the rule off places some there.
    const today = scenery(NO_LAND_CLASS).filter((item) => VEGETATION_KINDS.has(item.kind));
    expect(today.filter(onBuiltOrWater).length).toBeGreaterThan(0);
  });

  it('runs no wall, hedge or fence across built-up land or water', () => {
    const edges = structures(mask).filter((item) => BOUNDARY_KINDS.has(item.kind));
    expect(edges.filter(onBuiltOrWater)).toStrictEqual([]);
    // Off the town and the lake, the fields keep theirs.
    expect(edges.filter((item) => !mask.covered(item.x, item.z)).length).toBeGreaterThan(0);
    const today = structures(NO_LAND_CLASS).filter((item) => BOUNDARY_KINDS.has(item.kind));
    const onTown = today.filter((item) => item.z < town.maxZ && item.z >= town.minZ);
    const onLake = today.filter((item) => item.z >= lake.minZ && item.z < lake.maxZ);
    // Control, on each of the two: the rule off places boundaries there.
    expect(onTown.length).toBeGreaterThan(0);
    expect(onLake.length).toBeGreaterThan(0);
  });

  it('#1534’s clearing hook clears built-up cells too', () => {
    const grown = scenery(NO_LAND_CLASS);
    const cleared = clearOfSettlements(grown, [], mask);
    expect(
      cleared.filter((item) => VEGETATION_KINDS.has(item.kind)).filter(onBuiltOrWater),
    ).toStrictEqual([]);
    // Control: there was something there to clear, and the posts stay.
    expect(
      grown.filter((item) => VEGETATION_KINDS.has(item.kind)).filter(onBuiltOrWater).length,
    ).toBeGreaterThan(0);
    expect(cleared.filter((item) => item.kind === 'post')).toStrictEqual(
      grown.filter((item) => item.kind === 'post'),
    );
    expect(clearOfSettlements(grown, [])).toBe(grown);
  });

  it('reaches the frame through sceneFrame', () => {
    const input = { profile: ROUTE, origin: ORIGIN, state: atStartLine(ROUTE) };
    const riding = {
      ...input,
      state: { ...input.state, ride: { ...input.state.ride, distance: metres(2_500) } },
    };
    const drawn = sceneFrame({ ...riding, landClass: mask }).scatter;
    expect(
      drawn
        .filter((item) => VEGETATION_KINDS.has(item.kind) || BOUNDARY_KINDS.has(item.kind))
        .filter(onBuiltOrWater),
    ).toStrictEqual([]);
    const today = sceneFrame(riding).scatter;
    expect(
      today.filter((item) => VEGETATION_KINDS.has(item.kind)).filter(onBuiltOrWater).length,
    ).toBeGreaterThan(0);
  });
});

describe('the scenery budget is spent on ground that can carry it', () => {
  it('drops what the land takes away before the thinning, not after', () => {
    const mask = landClassMask(
      corridorOf([MIDDLE], [rectangle('landuse', 'residential', { ...MIDDLE, maxX: 0 })]),
    );
    const input = { profile: ROUTE, origin: ORIGIN, state: atStartLine(ROUTE) };
    const riding = {
      ...input,
      state: { ...input.state, ride: { ...input.state.ride, distance: metres(2_500) } },
      scatterItems: 40,
    };
    const natural = sceneFrame({ ...riding, landClass: mask }).scatter.filter(
      (item) => VEGETATION_KINDS.has(item.kind) || item.kind === 'post',
    );
    expect(natural).toHaveLength(40);
  });
});

describe('today’s world where nothing is covered', () => {
  it('NO_LAND_CLASS draws the frame a ride with no mask draws', () => {
    const input = { profile: ROUTE, origin: ORIGIN, state: atStartLine(ROUTE) };
    const without = sceneFrame(input);
    const withNone = sceneFrame({ ...input, landClass: NO_LAND_CLASS });
    expect(withNone.scatter).toStrictEqual(without.scatter);
    expect(withNone.streets).toStrictEqual(without.streets);
  });
});

describe('queries are allocation-free — #240 NFR-3', () => {
  it('calls classAt 10^5 times with no heap growth and no collection', () => {
    const box = tileBox(FIXTURE_FRAME, FIXTURE_TILE);
    const mask = landClassMask(
      corridorOf([box], [rectangle('landuse', 'residential', { ...box, maxX: box.minX + 300 })]),
    );
    const width = box.maxX - box.minX;
    const height = box.maxZ - box.minZ;
    let sink = 0;
    const sweep = (count: number): void => {
      for (let i = 0; i < count; i += 1) {
        // Inside, outside and on chunk edges, so every branch is taken.
        const x = box.minX - 50 + ((i * 7.31) % (width + 100));
        const z = box.minZ - 50 + ((i * 3.17) % (height + 100));
        if (mask.classAt(x, z) === 'built-up') sink += 1;
      }
    };
    // Warm up, so the measured window runs optimised code as a ride does.
    sweep(300_000);
    const attempts: string[] = [];
    let measured = false;
    for (let attempt = 0; attempt < 8 && !measured; attempt += 1) {
      const profiler = new GCProfiler();
      profiler.start();
      const before = getHeapStatistics().used_heap_size;
      const started = performance.now();
      sweep(100_000);
      const elapsed = performance.now() - started;
      const after = getHeapStatistics().used_heap_size;
      const { statistics } = profiler.stop();
      // A collection inside the window would hide an allocation: measure again.
      if (statistics.length > 0) {
        attempts.push('collected');
        continue;
      }
      measured = true;
      // Ten bytes a query would be a megabyte; the window's own bookkeeping is far below this.
      expect(after - before).toBeLessThan(64 * 1024);
      // #1546 states 50 ns a query on CI; this bound is ten times that, so a
      // slow runner is not a red build and a lookup that allocates or scans is.
      expect((elapsed * 1e6) / 100_000).toBeLessThan(500);
    }
    expect(measured, attempts.join(', ')).toBe(true);
    expect(sink).toBeGreaterThan(0);
  });
});

describe('bounded — at most 8 MiB a route', () => {
  it('builds a 600-tile corridor’s first chunks in route order and leaves the rest unknown', () => {
    const long = northRoute(250_000, () => 10);
    const plan = planCorridor(long.positions, []);
    if (plan === undefined) throw new Error('no plan');
    const tiles: readonly TileId[] = plan.requestable;
    expect(tiles).toHaveLength(600);
    const boxes = tiles.map((tile) => tileBox(plan.frame, tile));
    const started = performance.now();
    const mask = landClassMask({
      ...corridorOf(
        boxes,
        boxes.map((each) => rectangle('landuse', 'farmland', each)),
      ),
      origin: corridorOrigin(long),
    });
    const elapsed = performance.now() - started;
    expect(mask.bytes).toBeLessThanOrEqual(LAND_CLASS_MAX_BYTES);
    const centre = (each: Box): readonly [number, number] => [
      (each.minX + each.maxX) / 2,
      (each.minZ + each.maxZ) / 2,
    ];
    expect(mask.classAt(...centre(boxes[0] as Box))).toBe('farmland');
    // The cap bit: the corridor's far end is the procedural world.
    expect(mask.bytes).toBe(LAND_CLASS_MAX_BYTES);
    expect(mask.covered(...centre(boxes[boxes.length - 1] as Box))).toBe(false);
    // Recorded for the PR, not asserted: Node, not the tablet's Chromium.
    expect(elapsed).toBeGreaterThan(0);
  });

  it('a smaller cap keeps the start of the route and drops its end', () => {
    const boxes: Box[] = [0, 1, 2].map((index) => ({
      minX: -100,
      maxX: 100,
      minZ: index * 1_000,
      maxZ: index * 1_000 + 300,
    }));
    const mask = landClassMask(corridorOf(boxes, []), 4096 * 2);
    expect(mask.bytes).toBe(4096 * 2);
    expect(mask.covered(0, 150)).toBe(true);
    expect(mask.covered(0, 2_150)).toBe(false);
  });

  it('makes no chunk for a box that reaches less than a cell centre into it', () => {
    // A chunk is 320 m; the next one's first centre is at 322.5 m.
    const mask = landClassMask(corridorOf([{ minX: 0, maxX: 321, minZ: 0, maxZ: 100 }], []));
    expect(mask.bytes).toBe(4096);
    expect(mask.covered(100, 50)).toBe(true);
    expect(mask.covered(321, 50)).toBe(false);
  });
});

describe('bounded — a work budget on the polygon pass', () => {
  /** A many-vertex polygon: a jagged ring inside `box`, `vertices` points. */
  function dense(box: Box, vertices: number): LandUseFeature {
    const ring = new Float32Array(vertices * 2);
    for (let i = 0; i < vertices; i += 1) {
      const angle = (i / vertices) * 2 * Math.PI;
      const radius = i % 2 === 0 ? 0.5 : 0.45;
      ring[i * 2] = (box.minX + box.maxX) / 2 + Math.cos(angle) * radius * (box.maxX - box.minX);
      ring[i * 2 + 1] =
        (box.minZ + box.maxZ) / 2 + Math.sin(angle) * radius * (box.maxZ - box.minZ);
    }
    return { layer: 'landuse', kind: 'farmland', rings: [ring] };
  }
  const TILE: Box = { minX: 0, maxX: 1_000, minZ: 0, maxZ: 1_000 };

  it('stops painting polygons once the budget is spent, and keeps the class the cells hold', () => {
    const features = [rectangle('landuse', 'farmland', TILE), rectangle('water', 'water', TILE)];
    const unbounded = landClassMask(corridorOf([TILE], features));
    expect(unbounded.classAt(500, 500)).toBe('water');
    // One rectangle on this tile costs 4 edges x 64 rows x its chunks: a budget of 1 buys exactly one polygon.
    const bounded = landClassMask(corridorOf([TILE], features), LAND_CLASS_MAX_BYTES, 1);
    expect(bounded.classAt(500, 500)).toBe('farmland');
  });

  it('builds a dense tile — 48 polygons of 8192 vertices — in a fraction of the unbudgeted time', () => {
    const features = Array.from({ length: 48 }, () => dense(TILE, 8_192));
    const corridor = corridorOf([TILE], features);
    const started = performance.now();
    landClassMask(corridor);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(250);
  });
});
