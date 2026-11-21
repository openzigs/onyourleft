// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2662: the smaller land kinds the 2026-11-15 tag audit found classed wrong,
 * and the footprint size limit that left malls and big warehouses out.
 *
 * - `kindergarten` is built-up, as a `school` is; `village_green` and
 *   `allotments` are park.
 * - `bare` ground — `beach`, `sand`, `bare_rock`, `glacier`, the airfield's
 *   `aerodrome`, `runway` and `taxiway`, and the built-on `pier`, `platform`
 *   and `dam` — carries no tree, shrub or rock and no field boundary, where as
 *   `other` it could carry a farm fence.
 * - A footprint is `too-large` over 100 000 m², not 20 000.
 *
 * Every placement assertion reads what `scatterAt`, `structuresAt` and
 * `footprintPlans` hand back, the paths the renderer is handed, and each has
 * its control: the same call on covered `other` ground, which must still
 * place what the rule takes away. **No OpenStreetMap data and no real place**:
 * rectangles from arithmetic.
 */

import { describe, expect, it } from 'vitest';

import type { Box, LandUseFeature } from '@onyourleft/map-features';

import { FOOTPRINT_MAX_AREA, footprintPlans, footprintUse } from './footprint-buildings';
import { buildingBeside, footprintFixture, rectangleBeside } from './footprint-fixtures-testing';
import {
  fieldGround,
  kindAt,
  LAND_CLASS_OF_KIND,
  landClassMask,
  nothingGrowsAt,
  type LandClassMask,
} from './land-class';
import { northRoute } from './route-fixtures-testing';
import { scatterAt, scatterSeed, type ScatterItem } from './scatter';
import { clearOfSettlements, structuresAt } from './settlements';
import { landUseCorridor } from './testing/land-use-fixtures';
import { corridorOrigin } from './terrain';
import type { WorldCorridor } from './world-data/corridor';

const BARE_KINDS = [
  'beach',
  'sand',
  'bare_rock',
  'glacier',
  'aerodrome',
  'runway',
  'taxiway',
  'pier',
  'platform',
  'dam',
] as const;

/** A level 6 km road due north: local `z` is distance along, `x` is across. */
const ROUTE = northRoute(6_000, () => 10);
const ORIGIN = corridorOrigin(ROUTE);
const SEED = scatterSeed(ROUTE);
/** The middle 2 km, covered, 1 km either side of the road. */
const MIDDLE: Box = { minX: -1_000, maxX: 1_000, minZ: 2_000, maxZ: 4_000 };
const ALL = { maxItems: 100_000, riderMetres: 0 };
const VEGETATION = new Set(['tree-broadleaf', 'tree-conifer', 'shrub', 'rock']);
const BOUNDARIES = new Set(['wall', 'hedge', 'fence']);

function corridorOf(landUse: readonly LandUseFeature[], box: Box = MIDDLE): WorldCorridor {
  return {
    routeId: 'small-land-kinds-fixture',
    origin: { latitude: 51.5, longitude: -0.12, elevation: 0 },
    covered: (x, z) => x >= box.minX && x < box.maxX && z >= box.minZ && z < box.maxZ,
    coveredBoxes: [box],
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
/** Well inside the covered 2 km, so no item there reads past its end. */
const inside = (item: ScatterItem): boolean => item.z > 2_100 && item.z < 3_900;
const scenery = (land: LandClassMask): readonly ScatterItem[] =>
  scatterAt(ROUTE, ORIGIN, SEED, 0, ROUTE.totalDistance, ALL, land).filter(inside);
const structures = (land: LandClassMask): readonly ScatterItem[] =>
  structuresAt(ROUTE, ORIGIN, SEED, 0, ROUTE.totalDistance, ALL, undefined, land).filter(inside);
/** Covered, and no class: the procedural world, read through a mask. Every rule's control. */
const OTHER = mask();

describe('#2662 the kinds, through landClassMask', () => {
  it('reads each kind as its class at its own rectangle', () => {
    const expected = {
      kindergarten: 'built-up',
      village_green: 'park',
      allotments: 'park',
      ...Object.fromEntries(BARE_KINDS.map((kind) => [kind, 'bare'])),
      // #2976: natural grass and heather are open ground, as a meadow is.
      grassland: 'farmland',
      heath: 'farmland',
    };
    const fixture = landUseCorridor(Object.keys(expected));
    const land = landClassMask(fixture.corridor);
    for (const [kind, cls] of Object.entries(expected)) {
      expect(land.classAt(...fixture.centreOf(kind)), kind).toBe(cls);
    }
  });

  it('names each kind in the table, beside its rule (ADR 0054 D-5.1)', () => {
    for (const kind of BARE_KINDS) expect(LAND_CLASS_OF_KIND[kind], kind).toBe('bare');
    expect(LAND_CLASS_OF_KIND.kindergarten).toBe('built-up');
    // #2976: and natural grass and heather, beside `meadow`.
    expect(LAND_CLASS_OF_KIND.grassland).toBe('farmland');
    expect(LAND_CLASS_OF_KIND.heath).toBe('farmland');
  });

  it('ranks bare above farmland and below built-up, wood and water', () => {
    const ground: Box = { minX: 0, maxX: 300, minZ: 0, maxZ: 300 };
    const inner: Box = { minX: 100, maxX: 200, minZ: 100, maxZ: 200 };
    const read = (outer: string, within: string): readonly [string, string] => {
      // Both orders: the class wins by precedence, not by which came first.
      const [a, b] = [outer, within].map((_, order) => {
        const features = [rectangle(outer, ground), rectangle(within, inner)];
        const land = landClassMask(corridorOf(order === 0 ? features : features.reverse(), ground));
        return land.classAt(150, 150);
      });
      return [a as string, b as string];
    };
    // A beach inside farmland is a beach.
    expect(read('farmland', 'beach')).toStrictEqual(['bare', 'bare']);
    // An airport's terminal land inside the aerodrome keeps its class, and its kind.
    expect(read('aerodrome', 'commercial')).toStrictEqual(['built-up', 'built-up']);
    expect(read('sand', 'wood')).toStrictEqual(['wood', 'wood']);
    expect(read('pier', 'wetland')).toStrictEqual(['water', 'water']);
    const terminal = corridorOf(
      [rectangle('aerodrome', ground), rectangle('commercial', inner)],
      ground,
    );
    expect(kindAt(terminal, 150, 150)).toBe('commercial');
    expect(kindAt(terminal, 50, 50)).toBe('aerodrome');
  });

  it('draws a kindergarten’s footprint as a school’s, and keeps it off field ground', () => {
    const fixture = landUseCorridor(['kindergarten', 'school']);
    const land = landClassMask(fixture.corridor);
    const useAt = (kind: string): string => {
      const [x, z] = fixture.centreOf(kind);
      return footprintUse(land.classAt(x, z), kindAt(fixture.corridor, x, z));
    };
    expect(useAt('kindergarten')).toBe(useAt('school'));
    expect(fieldGround(land, ...fixture.centreOf('kindergarten'))).toBe(false);
  });
});

describe('#2662 bare ground: nothing grows and no field is fenced', () => {
  it('reads bare ground as neither field ground nor ground that grows', () => {
    const land = mask(rectangle('beach', MIDDLE));
    expect(fieldGround(land, 0, 3_000)).toBe(false);
    expect(nothingGrowsAt(land, 0, 3_000)).toBe(true);
    // Control: covered ground of no class is both.
    expect(fieldGround(OTHER, 0, 3_000)).toBe(true);
    expect(nothingGrowsAt(OTHER, 0, 3_000)).toBe(false);
  });

  it('places no tree, shrub or rock on any bare kind', () => {
    // Control: the same ground as `other` grows plenty.
    expect(scenery(OTHER).filter((item) => VEGETATION.has(item.kind)).length).toBeGreaterThan(50);
    for (const kind of BARE_KINDS) {
      const grown = scenery(mask(rectangle(kind, MIDDLE))).filter((item) =>
        VEGETATION.has(item.kind),
      );
      expect(grown, kind).toStrictEqual([]);
    }
  });

  it('runs no wall, hedge or fence across bare ground', () => {
    // Control: the same ground as `other` is the procedural world's fields, fenced.
    const fenced = structures(OTHER).filter((item) => BOUNDARIES.has(item.kind));
    expect(fenced.length).toBeGreaterThan(0);
    for (const kind of ['beach', 'aerodrome', 'glacier']) {
      const edges = structures(mask(rectangle(kind, MIDDLE))).filter((item) =>
        BOUNDARIES.has(item.kind),
      );
      expect(edges, kind).toStrictEqual([]);
    }
  });

  it('clears bare ground in #1534’s clearing hook too, and keeps the posts', () => {
    const land = mask(rectangle('runway', MIDDLE));
    const grown = scenery(OTHER);
    const cleared = clearOfSettlements(grown, [], land);
    expect(cleared.filter((item) => VEGETATION.has(item.kind))).toStrictEqual([]);
    expect(grown.filter((item) => VEGETATION.has(item.kind)).length).toBeGreaterThan(0);
    expect(cleared.filter((item) => item.kind === 'post')).toStrictEqual(
      grown.filter((item) => item.kind === 'post'),
    );
  });
});

describe('#2976 grassland and heath: open ground, as a meadow is', () => {
  const OPEN = ['grassland', 'heath'] as const;

  it('reads each as farmland through the mask, and as field ground', () => {
    for (const kind of OPEN) {
      const land = mask(rectangle(kind, MIDDLE));
      expect(land.classAt(0, 3_000), kind).toBe('farmland');
      expect(fieldGround(land, 0, 3_000), kind).toBe(true);
      expect(nothingGrowsAt(land, 0, 3_000), kind).toBe(false);
    }
  });

  it('plants each as a meadow is planted, not as the procedural world', () => {
    const meadow = scenery(mask(rectangle('meadow', MIDDLE)));
    // Control: the procedural world on the same ground is not a meadow's planting.
    expect(scenery(OTHER)).not.toStrictEqual(meadow);
    expect(meadow.filter((item) => VEGETATION.has(item.kind)).length).toBeGreaterThan(0);
    for (const kind of OPEN) {
      expect(scenery(mask(rectangle(kind, MIDDLE))), kind).toStrictEqual(meadow);
      expect(structures(mask(rectangle(kind, MIDDLE))), kind).toStrictEqual(
        structures(mask(rectangle('meadow', MIDDLE))),
      );
    }
  });

  it('keeps a building mapped on it, as a park would not', () => {
    const kept = (kind: string) => {
      const corridor = {
        ...corridorOf([rectangle(kind, MIDDLE)]),
        buildings: [buildingBeside(ROUTE, ORIGIN, [rectangleBeside(3_000, 40, 12, 9)], 6)],
      };
      return footprintPlans(corridor, landClassMask(corridor), ROUTE, ORIGIN).verdicts;
    };
    for (const kind of OPEN) expect(kept(kind), kind).toMatchObject({ kept: 1 });
    // Control: the same building in a park is dropped.
    expect(kept('park')).toMatchObject({ kept: 0, 'on-excluded-land': 1 });
  });

  it('reads inside a protected area as the area, and as farmland beside it', () => {
    // The open ground: the north half of the covered 2 km; the area: all of it.
    const north: Box = { ...MIDDLE, minZ: 3_000 };
    const cases = [
      ['national_park', 'park'],
      ['nature_reserve', 'park'],
      ['forest', 'wood'],
    ] as const;
    for (const kind of OPEN) {
      for (const [area, reads] of cases) {
        // Either drawing order: the higher code wins, not the later polygon.
        for (const land of [
          mask(rectangle(area, MIDDLE), rectangle(kind, north)),
          mask(rectangle(kind, north), rectangle(area, MIDDLE)),
        ]) {
          expect(land.classAt(0, 3_500), `${kind} in ${area}`).toBe(reads);
          expect(land.protectedArea(0, 3_500), `${kind} in ${area}`).toBe(true);
          expect(fieldGround(land, 0, 3_500), `${kind} in ${area}`).toBe(false);
        }
      }
      // Control: the same open ground with no area round it is farmland.
      const alone = mask(rectangle(kind, north));
      expect(alone.classAt(0, 3_500), kind).toBe('farmland');
      expect(alone.protectedArea(0, 3_500), kind).toBe(false);
      expect(fieldGround(alone, 0, 3_500), kind).toBe(true);
    }
    // Control: a meadow, which is not open ground, still outranks the area.
    const meadow = mask(rectangle('national_park', MIDDLE), rectangle('meadow', north));
    expect(meadow.classAt(0, 3_500)).toBe('farmland');
    expect(meadow.protectedArea(0, 3_500)).toBe(false);
  });
});

describe('#2662 a footprint’s size limit', () => {
  const fixture = footprintFixture();
  /** One footprint on the fixture's levelled residential land, alone in the corridor. */
  const verdicts = (length: number, depth: number) => {
    const building = buildingBeside(fixture.profile, fixture.origin, [
      rectangleBeside(400, 115, length, depth),
    ]);
    const corridor = { ...fixture.corridor, buildings: [building] };
    return footprintPlans(corridor, landClassMask(corridor), fixture.profile, fixture.origin)
      .verdicts;
  };

  it('keeps a mall-sized footprint under 100 000 m², and the fixture’s warehouse', () => {
    expect(FOOTPRINT_MAX_AREA).toBe(100_000);
    // 560 × 170 = 95 200 m².
    expect(verdicts(560, 170)).toMatchObject({ kept: 1, 'too-large': 0 });
    const { verdicts: whole } = footprintPlans(
      fixture.corridor,
      landClassMask(fixture.corridor),
      fixture.profile,
      fixture.origin,
    );
    expect(whole['too-large']).toBe(0);
  });

  it('drops one over it as too large', () => {
    // 600 × 170 = 102 000 m², on the same ground.
    expect(verdicts(600, 170)).toMatchObject({ kept: 0, 'too-large': 1 });
  });
});
