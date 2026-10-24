// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1542: the countryside read off #1546's land-class mask — the species mix
 * and clustering by class, field boundaries along farmland's edges, and cheap
 * ground clutter — and the three levers that switch each off.
 *
 * Every assertion reads what `scatterAt`, `structuresAt` and `sceneFrame`
 * hand back, the paths the renderer is handed, and each has its control: the
 * same call on covered land with no class (`other`), which is the procedural
 * world, so a fixture that placed nothing could not pass for a rule holding.
 */

import { describe, expect, it } from 'vitest';

import { metres } from '@onyourleft/domain';
import type { Box, LandUseFeature } from '@onyourleft/map-features';

import {
  atClassEdge,
  COUNTRYSIDE,
  countrysideWithout,
  landClassMask,
  NO_LAND_CLASS,
  type Countryside,
  type LandClassMask,
} from './land-class';
import { northRoute, valleyRoute } from './route-fixtures-testing';
import {
  scatterAt,
  scatterSeed,
  HEDGEROW_EDGE_METRES,
  SCATTER_BAND_METRES,
  SCATTER_VERGE_METRES,
  type ScatterItem,
} from './scatter';
import { sceneFrame } from './scene';
import {
  BOUNDARY_PIECE_METRES,
  PLOT_METRES,
  siteAt,
  siteSpacing,
  structuresAt,
} from './settlements';
import { atStartLine } from './simulation';
import { corridorOrigin, drawnRoadFrame, ROAD_WIDTH_METRES } from './terrain';
import { CHANNEL_BANK_METRES, waterways } from './waterways';
import type { WorldCorridor } from './world-data/corridor';

/** A level 6 km road due north: local `z` is distance along, `x` is across. */
const ROUTE = northRoute(6_000, () => 10);
const ORIGIN = corridorOrigin(ROUTE);
const SEED = scatterSeed(ROUTE);
/** The middle 2 km, covered, 1 km either side of the road. */
const MIDDLE: Box = { minX: -1_000, maxX: 1_000, minZ: 2_000, maxZ: 4_000 };
const ALL = { maxItems: 100_000, riderMetres: 0 };
const OFF: Countryside = countrysideWithout(['planting', 'boundaries', 'clutter']);

function corridorOf(landUse: readonly LandUseFeature[]): WorldCorridor {
  return {
    routeId: 'countryside-fixture',
    origin: { latitude: 51.5, longitude: -0.12, elevation: 0 },
    covered: (x, z) => x >= MIDDLE.minX && x < MIDDLE.maxX && z >= MIDDLE.minZ && z < MIDDLE.maxZ,
    coveredBoxes: [MIDDLE],
    landUse,
    buildings: [],
    paths: [],
    streets: [],
  };
}

function rectangle(kind: string, box: Box): LandUseFeature {
  return {
    layer: 'landuse',
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

const mask = (...landUse: LandUseFeature[]): LandClassMask => landClassMask(corridorOf(landUse));
/** Covered, and no class: the procedural world, read through a mask. */
const OTHER = mask();
const FARMLAND = mask(rectangle('farmland', MIDDLE));

const scenery = (land: LandClassMask, countryside: Countryside = COUNTRYSIDE) =>
  scatterAt(ROUTE, ORIGIN, SEED, 0, ROUTE.totalDistance, ALL, land, countryside);
const structures = (land: LandClassMask, countryside: Countryside = COUNTRYSIDE) =>
  structuresAt(
    ROUTE,
    ORIGIN,
    SEED,
    0,
    ROUTE.totalDistance,
    ALL,
    undefined,
    land,
    undefined,
    countryside,
  );
const key = (item: ScatterItem): string =>
  `${item.kind} ${item.x.toFixed(3)} ${item.z.toFixed(3)} ${item.rotation.toFixed(3)}`;
/** Well inside the covered 2 km, so no item there reads past its end. */
const inside = (item: ScatterItem): boolean => item.z > 2_100 && item.z < 3_900;
const TREES = new Set(['tree-broadleaf', 'tree-conifer']);
const BOUNDARIES = new Set(['wall', 'hedge', 'fence']);
const share = (items: readonly ScatterItem[], kinds: ReadonlySet<string>): number =>
  items.filter((item) => kinds.has(item.kind)).length / items.length;
/** The nearest band's depth from the centreline: its hedgerow. */
const NEAREST_BAND = ROAD_WIDTH_METRES / 2 + SCATTER_VERGE_METRES + SCATTER_BAND_METRES / 5;

describe('#1542 planting by land class', () => {
  it('plants a wood throughout, with a broadleaf and scrub edge', () => {
    // A wood from 8 m out on the positive side: its edge is at x = 8.
    const wood = mask(rectangle('wood', { ...MIDDLE, minX: 8 }));
    const onWood = scenery(wood)
      .filter(inside)
      .filter((item) => item.x > 8);
    // Within `WOOD_EDGE_METRES` of it, by the mask's 5 m cells, and clear of it.
    const edge = onWood.filter((item) => item.x < 15);
    const interior = onWood.filter((item) => item.x >= 19);
    expect(edge.length).toBeGreaterThan(20);
    expect(interior.length).toBeGreaterThan(20);
    // The edge broadleaf and scrub in front of the procedural mix, which is
    // mostly conifer at 51.5°; mostly trees, which have impostors far off.
    const broadleaf = new Set(['tree-broadleaf']);
    expect(share(edge, broadleaf)).toBeGreaterThan(0.5);
    expect(share(interior, broadleaf)).toBeLessThan(0.25);
    expect(share(edge, TREES)).toBeGreaterThan(0.6);
    expect(share(edge, new Set(['shrub']))).toBeGreaterThan(share(interior, new Set(['shrub'])));
    // Throughout: no 40 m of the wood beside the road stands empty, where the
    // procedural world's clustering leaves open ground.
    const longestGap = (items: readonly ScatterItem[]): number => {
      const along = items.map((item) => item.z).sort((a, b) => a - b);
      return Math.max(...along.slice(1).map((z, index) => z - (along[index] as number)));
    };
    expect(longestGap(onWood)).toBeLessThan(40);
    const procedural = scenery(OTHER)
      .filter(inside)
      .filter((item) => item.x > 8);
    expect(longestGap(procedural)).toBeGreaterThan(40);
  });

  it('stands hedgerow trees by the road and leaves the pasture open', () => {
    const items = scenery(FARMLAND).filter(inside);
    const procedural = scenery(OTHER).filter(inside);
    const hedgerow = (item: ScatterItem): boolean => Math.abs(item.x) < NEAREST_BAND;
    const rows = items.filter(hedgerow);
    const pasture = items.filter((item) => !hedgerow(item));
    // The hedgerow is trees, and broadleaf at 51.5° where the procedural mix is
    // mostly conifer.
    expect(share(rows, TREES)).toBeGreaterThan(0.75);
    expect(share(rows, new Set(['tree-broadleaf']))).toBeGreaterThan(0.75);
    expect(share(procedural, new Set(['tree-broadleaf']))).toBeLessThan(0.25);
    // Four times the pasture's items a metre of road, where its depth is four bands.
    expect(rows.length * 4).toBeGreaterThan(pasture.length);
    // Open: under a fifth of what the procedural world stands there.
    expect(pasture.length).toBeLessThan(procedural.filter((item) => !hedgerow(item)).length / 5);
    expect(pasture.length).toBeGreaterThan(0);
  });

  it('stands hedgerow trees within a hedgerow’s reach of a field’s edge, not only by the road', () => {
    // Pasture from 14 m out on the positive side, past the nearest band: only
    // the edge rule can plant a hedgerow tree there. The items reach about 22 m.
    const near = (items: readonly ScatterItem[]): readonly ScatterItem[] =>
      items.filter(inside).filter((item) => item.x > 15 && item.x < 14 + HEDGEROW_EDGE_METRES);
    const atEdge = near(scenery(mask(rectangle('farmland', { ...MIDDLE, minX: 14 }))));
    // Control: the same ground in a field whose edge is the road's far side.
    const inField = near(scenery(FARMLAND));
    expect(atEdge.length).toBeGreaterThan(10);
    expect(inField.length).toBeGreaterThan(0);
    expect(share(atEdge, TREES)).toBeGreaterThan(0.75);
    // A hedgerow keeps ten times the pasture's trees.
    expect(atEdge.length).toBeGreaterThan(inField.length * 4);
  });

  it('plants a park with specimen trees and no rock', () => {
    const items = scenery(mask(rectangle('park', MIDDLE)), COUNTRYSIDE).filter(inside);
    expect(items.length).toBeGreaterThan(0);
    expect(items.filter((item) => item.kind === 'rock')).toStrictEqual([]);
    expect(share(items, TREES)).toBeGreaterThan(0.75);
    expect(items.length).toBeLessThan(scenery(OTHER).filter(inside).length / 2);
  });

  it('reads the end of the map as no wood’s edge', () => {
    const wood = mask(rectangle('wood', { ...MIDDLE, maxX: 0 }));
    // 2 m from the covered stretch's end: past it is `unknown`, not open ground.
    expect(atClassEdge(wood, 'wood', -100, MIDDLE.minZ + 2, 8)).toBe(false);
    expect(atClassEdge(wood, 'wood', -100, MIDDLE.maxZ - 2, 8)).toBe(false);
    // Control: 2 m from where the wood meets covered open ground, it is.
    expect(atClassEdge(wood, 'wood', -2, 3_000, 8)).toBe(true);
    expect(atClassEdge(wood, 'wood', -100, 3_000, 8)).toBe(false);
  });

  it('reads nothing where the mask is unknown', () => {
    const outside = (item: ScatterItem): boolean => item.z < 1_900 || item.z > 4_100;
    const mapped = scenery(FARMLAND).filter(outside).map(key);
    expect(mapped.length).toBeGreaterThan(0);
    expect(mapped).toStrictEqual(scenery(NO_LAND_CLASS).filter(outside).map(key));
  });
});

describe('#1542 ground clutter', () => {
  it('lays field stones on farmland and rocks on a wood’s floor, and none with the lever off', () => {
    const rocks = (items: readonly ScatterItem[]): number =>
      items.filter(inside).filter((item) => item.kind === 'rock').length;
    const wood = mask(rectangle('wood', MIDDLE));
    expect(rocks(scenery(FARMLAND))).toBeGreaterThan(10);
    expect(rocks(scenery(FARMLAND, countrysideWithout(['clutter'])))).toBe(0);
    expect(rocks(scenery(wood))).toBeGreaterThan(
      rocks(scenery(wood, countrysideWithout(['clutter']))),
    );
    // Stones, not a field of them: a few in every hundred items.
    const farmed = scenery(FARMLAND).filter(inside);
    expect(rocks(farmed) / farmed.length).toBeLessThan(0.2);
  });
});

describe('#1542 field boundaries along farmland’s edges', () => {
  /** Farmland either side of the road, a 100 m gap in it, and a field set back on each side. */
  const FIELDS = mask(
    rectangle('farmland', { minX: -220, maxX: 220, minZ: 2_200, maxZ: 2_500 }),
    rectangle('farmland', { minX: -220, maxX: 220, minZ: 2_600, maxZ: 3_000 }),
    rectangle('farmland', { minX: 25, maxX: 220, minZ: 3_200, maxZ: 3_600 }),
    rectangle('wood', { minX: -220, maxX: -30, minZ: 3_200, maxZ: 3_600 }),
    rectangle('farmland', { minX: -30, maxX: -10, minZ: 3_200, maxZ: 3_600 }),
  );
  const EDGES_ALONG = [2_200, 2_500, 2_600, 3_000, 3_200, 3_600];
  const EDGES_ACROSS = [25, 10, 30];
  const outward = (item: ScatterItem): boolean => Math.abs(Math.sin(item.rotation)) > 0.99;
  const beyondVerge = (item: ScatterItem): boolean => Math.abs(item.x) > 8;
  const onFarmland =
    (land: LandClassMask) =>
    (item: ScatterItem): boolean =>
      land.classAt(item.x, item.z) === 'farmland';

  it('hedges a mapped field all along the road', () => {
    const verge = (items: readonly ScatterItem[], side: number): readonly number[] =>
      items
        .filter(inside)
        .filter((item) => BOUNDARIES.has(item.kind) && !beyondVerge(item))
        .filter((item) => Math.sign(item.x) === side)
        .map((item) => item.z)
        .sort((a, b) => a - b);
    const widest = (along: readonly number[]): number =>
      Math.max(...along.slice(1).map((z, index) => z - (along[index] as number)));
    for (const side of [-1, 1]) {
      const hedged = verge(structures(FARMLAND), side);
      expect(widest(hedged)).toBeLessThan(BOUNDARY_PIECE_METRES + 1);
      // Control: the procedural fields leave some open.
      expect(widest(verge(structures(OTHER), side))).toBeGreaterThan(50);
    }
    const kinds = new Set(
      structures(FARMLAND)
        .filter(inside)
        .filter((item) => !beyondVerge(item))
        .map((item) => item.kind),
    );
    expect([...kinds]).toStrictEqual(['hedge']);
  });

  it('runs a boundary out from the road only where a field ends', () => {
    const out = structures(FIELDS)
      .filter(inside)
      .filter((item) => BOUNDARIES.has(item.kind) && beyondVerge(item) && outward(item))
      .filter(onFarmland(FIELDS));
    expect(out.length).toBeGreaterThan(0);
    for (const item of out) {
      const nearest = Math.min(...EDGES_ALONG.map((edge) => Math.abs(item.z - edge)));
      expect(nearest, key(item)).toBeLessThan(BOUNDARY_PIECE_METRES);
    }
    // Every edge has one, on each side the field reaches.
    for (const edge of EDGES_ALONG) {
      expect(
        out.filter((item) => Math.abs(item.z - edge) < BOUNDARY_PIECE_METRES).length,
        `${String(edge)} m`,
      ).toBeGreaterThan(0);
    }
    // Control: the procedural fields stand them at their own spacing, inside a field.
    const procedural = structures(FIELDS, OFF)
      .filter(inside)
      .filter((item) => BOUNDARIES.has(item.kind) && beyondVerge(item))
      .filter(onFarmland(FIELDS))
      .filter(
        (item) =>
          Math.min(...EDGES_ALONG.map((edge) => Math.abs(item.z - edge))) > BOUNDARY_PIECE_METRES,
      );
    expect(procedural.length).toBeGreaterThan(0);
  });

  it('runs one along the road where a field starts back from it, and fences it from a wood', () => {
    const along = structures(FIELDS)
      .filter((item) => item.z > 3_210 && item.z < 3_590)
      .filter((item) => BOUNDARIES.has(item.kind) && beyondVerge(item) && !outward(item));
    expect(along.length).toBeGreaterThan(0);
    for (const item of along) {
      const nearest = Math.min(...EDGES_ACROSS.map((edge) => Math.abs(Math.abs(item.x) - edge)));
      // On the boundary grid's 8 m, on the field's side.
      expect(nearest, key(item)).toBeLessThan(BOUNDARY_PIECE_METRES);
    }
    const byWood = along.filter((item) => item.x < -25);
    expect(byWood.length).toBeGreaterThan(20);
    expect(new Set(byWood.map((item) => item.kind))).toStrictEqual(new Set(['fence']));
    expect(along.filter((item) => item.x > 0).every((item) => item.kind === 'hedge')).toBe(true);
  });

  it('reads the end of the map as no edge', () => {
    // FARMLAND fills the covered 2 km: past it is `unknown`, not another field.
    const out = structures(FARMLAND)
      .filter((item) => BOUNDARIES.has(item.kind) && beyondVerge(item))
      .filter(onFarmland(FARMLAND));
    expect(out).toStrictEqual([]);
  });
});

describe('#1542 boundaries on the span, and clear of villages and streams', () => {
  const edgesOf = (items: readonly ScatterItem[]): readonly ScatterItem[] =>
    items.filter((item) => BOUNDARIES.has(item.kind) && Math.abs(item.x) > 8);
  /** A field 25 m out on the positive side, over the whole covered stretch. */
  const setBack = (box: Box, route = ROUTE): LandClassMask =>
    landClassMask({
      ...corridorOf([rectangle('farmland', { ...box, minX: 25 })]),
      covered: (x, z) => x >= box.minX && x < box.maxX && z >= box.minZ && z < box.maxZ,
      coveredBoxes: [box],
      routeId: String(route.totalDistance),
    });

  it('admits each piece to exactly one of two adjacent spans', () => {
    const land = mask(
      rectangle('farmland', { minX: 25, maxX: 220, minZ: 3_200, maxZ: 3_600 }),
      rectangle('wood', { minX: -220, maxX: -30, minZ: 3_200, maxZ: 3_600 }),
      rectangle('farmland', { minX: -30, maxX: -10, minZ: 3_200, maxZ: 3_600 }),
    );
    const span = (from: number, to: number): readonly string[] =>
      edgesOf(
        structuresAt(ROUTE, ORIGIN, SEED, from, to, ALL, undefined, land, undefined, COUNTRYSIDE),
      )
        .filter((item) => item.z > 3_150 && item.z < 3_650)
        .map(key)
        .sort();
    const whole = span(3_000, 3_800);
    expect(whole.length).toBeGreaterThan(20);
    // Split at every metre across several pieces, so some split lands exactly
    // on a piece's own odometer.
    for (let at = 3_300; at <= 3_340; at += 1) {
      const halves = [...span(3_000, at), ...span(at, 3_800)].sort();
      expect(halves, `split at ${String(at)} m`).toStrictEqual(whole);
    }
  });

  it('stands no mapped edge through a procedural village', () => {
    const { sites } = siteSpacing(ROUTE);
    const village = Array.from({ length: sites }, (_, index) => siteAt(ROUTE, SEED, index)).find(
      (site) => site?.kind === 'village' && site.centre > 2_300 && site.centre < 3_700,
    );
    if (village === undefined) throw new Error('the fixture route has no village in the middle');
    // ⚠️ A village is built only where `siteOnMappedLand` finds no map data, and
    // it looks every 10 m along the site. So the data here leaves out the 5 m cell
    // each of those looks falls in and covers the cells between: the village is
    // still built, and the field's edges in the cells between are still mapped.
    const start = village.centre - village.half - PLOT_METRES;
    const length = 2 * (village.half + PLOT_METRES);
    const looked = new Set<number>();
    for (let step = 0; step <= Math.ceil(length / 10); step += 1) {
      const frame = drawnRoadFrame(ROUTE, ORIGIN, start + Math.min(length, step * 10));
      if (frame === undefined) throw new Error('no frame');
      for (let lateral = -42; lateral <= 42; lateral += 6) {
        looked.add(Math.floor((frame.z + frame.normalZ * lateral) / 5));
      }
    }
    const boxes: Box[] = [];
    for (let cell = Math.floor(MIDDLE.minZ / 5); cell < MIDDLE.maxZ / 5; cell += 1) {
      const within = cell * 5 + 2.5 > start - 5 && cell * 5 + 2.5 < start + length + 5;
      if (!within || !looked.has(cell)) {
        boxes.push({ minX: -1_000, maxX: 1_000, minZ: cell * 5, maxZ: (cell + 1) * 5 });
      }
    }
    const land = landClassMask({
      ...corridorOf([rectangle('farmland', { ...MIDDLE, minX: 25 })]),
      covered: (_x, z) => boxes.some((box) => z >= box.minZ && z < box.maxZ),
      coveredBoxes: boxes,
    });
    const items = structures(land);
    const inVillage = (item: ScatterItem): boolean => item.z >= start && item.z < start + length;
    // The village was built, with the field mapped around it ...
    expect(
      items.filter((item) => inVillage(item) && !BOUNDARIES.has(item.kind)).length,
    ).toBeGreaterThan(5);
    // ... and edged on both sides of it, but not through it.
    expect(
      edgesOf(items).filter((item) => item.z > start - 200 && item.z < start).length,
    ).toBeGreaterThan(0);
    expect(
      edgesOf(items).filter((item) => item.z >= start + length && item.z < start + length + 200)
        .length,
    ).toBeGreaterThan(0);
    expect(edgesOf(items).filter(inVillage)).toStrictEqual([]);
  });

  it('stands no mapped edge in a stream’s channel', () => {
    const valley = valleyRoute();
    const origin = corridorOrigin(valley);
    const seed = scatterSeed(valley);
    const stream = waterways(valley, seed).crossings[0];
    if (stream === undefined) throw new Error('the valley fixture has no stream');
    const box: Box = { minX: -1_000, maxX: 1_000, minZ: 0, maxZ: 3_000 };
    const land = setBack(box, valley);
    const items = edgesOf(
      structuresAt(
        valley,
        origin,
        seed,
        0,
        valley.totalDistance,
        ALL,
        undefined,
        land,
        undefined,
        COUNTRYSIDE,
      ),
    );
    const channel = (item: ScatterItem): boolean =>
      Math.abs(item.z - stream.distance) <= CHANNEL_BANK_METRES;
    expect(items.filter(channel)).toStrictEqual([]);
    // Control: both banks of the channel are edged.
    expect(
      items.filter((item) => item.z < stream.distance - CHANNEL_BANK_METRES).length,
    ).toBeGreaterThan(5);
    expect(
      items.filter((item) => item.z > stream.distance + CHANNEL_BANK_METRES).length,
    ).toBeGreaterThan(5);
  });

  it('walls a mapped field’s roadside on steep ground, and hedges it on level ground', () => {
    const valley = valleyRoute();
    const origin = corridorOrigin(valley);
    const seed = scatterSeed(valley);
    const box: Box = { minX: -1_000, maxX: 1_000, minZ: 0, maxZ: 3_000 };
    const land = landClassMask({
      ...corridorOf([rectangle('farmland', box)]),
      covered: () => true,
      coveredBoxes: [box],
    });
    const verge = structuresAt(
      valley,
      origin,
      seed,
      0,
      valley.totalDistance,
      ALL,
      undefined,
      land,
      undefined,
      COUNTRYSIDE,
    ).filter((item) => BOUNDARIES.has(item.kind) && Math.abs(item.x) < 8);
    const kindsOn = (from: number, to: number): readonly string[] => [
      ...new Set(verge.filter((item) => item.z > from && item.z < to).map((item) => item.kind)),
    ];
    // The valley's sides fall at 5%, past the 4% a boundary is walled above.
    expect(kindsOn(500, 900)).toStrictEqual(['wall']);
    expect(kindsOn(1_100, 1_500)).toStrictEqual(['wall']);
    // Level at both ends: a hedge.
    expect(kindsOn(50, 350)).toStrictEqual(['hedge']);
  });
});

describe('#1542 levers', () => {
  const MIXED = mask(
    rectangle('farmland', { ...MIDDLE, maxZ: 2_700 }),
    rectangle('wood', { ...MIDDLE, minZ: 2_700, maxZ: 3_300 }),
    rectangle('park', { ...MIDDLE, minZ: 3_300 }),
  );

  it('with every lever off, farmland, a wood and a park are the world before #1542', () => {
    expect(scenery(MIXED, OFF).map(key)).toStrictEqual(scenery(OTHER).map(key));
    expect(structures(FARMLAND, OFF).map(key)).toStrictEqual(structures(OTHER).map(key));
    // Control: on, they are not.
    expect(scenery(MIXED).map(key)).not.toStrictEqual(scenery(OTHER).map(key));
    expect(structures(FARMLAND).map(key)).not.toStrictEqual(structures(OTHER).map(key));
  });

  it('reach the frame through SceneInput.countrysideOff, one change each', () => {
    const start = atStartLine(ROUTE);
    const input = {
      profile: ROUTE,
      origin: ORIGIN,
      state: { ...start, ride: { ...start.ride, distance: metres(2_500) } },
    };
    const frame = (land: LandClassMask, off?: Parameters<typeof countrysideWithout>[0]) =>
      sceneFrame({ ...input, landClass: land, countrysideOff: off }).scatter.map(key);
    const on = frame(FARMLAND);
    for (const lever of ['planting', 'boundaries', 'clutter'] as const) {
      expect(frame(FARMLAND, [lever]), lever).not.toStrictEqual(on);
    }
    expect(frame(FARMLAND, ['planting', 'boundaries', 'clutter'])).toStrictEqual(frame(OTHER));
    expect(frame(FARMLAND, [])).toStrictEqual(on);
  });
});
