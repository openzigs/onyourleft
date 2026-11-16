// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2685: a park's look by the kind that made it park — the owner's ruling of
 * 2026-11-15, "as realistic as possible". A golf course is open fairway with
 * trees in stands, a cemetery and a playground carry a few trees, a pitch is an
 * even green with none, and a nature reserve is natural ground; every other
 * park kind is mown grass with specimen trees, as before.
 *
 * The mask is read through `landClassMask`, the scenery through `scatterAt`,
 * the path the renderer is handed. Each look's assertion has its control: the
 * same rectangle drawn as a plain `park`, so a fixture that placed nothing
 * could not pass for a rule holding. **No OpenStreetMap data and no real
 * place**: rectangles from arithmetic.
 */

import { describe, expect, it } from 'vitest';

import type { Box, LandUseFeature } from '@onyourleft/map-features';

import {
  landClassMask,
  LAND_CLASS_OF_KIND,
  PARK_LOOK_OF_KIND,
  parkLookOfKind,
  type LandClassMask,
} from './land-class';
import { northRoute } from './route-fixtures-testing';
import {
  GOLF_STAND_METRES,
  GOLF_STAND_SHARE,
  scatterAt,
  scatterSeed,
  type ScatterItem,
} from './scatter';
import { landUseCorridor } from './testing/land-use-fixtures';
import { corridorOrigin } from './terrain';
import type { WorldCorridor } from './world-data/corridor';

/** A level 6 km road due north: local `z` is distance along, `x` is across. */
const ROUTE = northRoute(6_000, () => 10);
const ORIGIN = corridorOrigin(ROUTE);
const SEED = scatterSeed(ROUTE);
/** The middle 2 km, covered, 1 km either side of the road. */
const MIDDLE: Box = { minX: -1_000, maxX: 1_000, minZ: 2_000, maxZ: 4_000 };
const ALL = { maxItems: 100_000, riderMetres: 0 };
const CHUNK_BYTES = 64 * 64;

function corridorOf(landUse: readonly LandUseFeature[], box: Box = MIDDLE): WorldCorridor {
  return {
    routeId: 'park-looks-fixture',
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
const scenery = (land: LandClassMask): readonly ScatterItem[] =>
  scatterAt(ROUTE, ORIGIN, SEED, 0, ROUTE.totalDistance, ALL, land).filter(
    // Well inside the covered 2 km, so no item there reads past its end.
    (item) => item.z > 2_100 && item.z < 3_900,
  );
const TREES = new Set(['tree-broadleaf', 'tree-conifer']);
const trees = (items: readonly ScatterItem[]): number =>
  items.filter((item) => TREES.has(item.kind)).length;
const rocks = (items: readonly ScatterItem[]): number =>
  items.filter((item) => item.kind === 'rock').length;
/** A plain park over the same ground: every look's control. */
const MOWN = scenery(mask(rectangle('park', MIDDLE)));
const ofKind = (kind: string): readonly ScatterItem[] => scenery(mask(rectangle(kind, MIDDLE)));

describe('#2685 the look of a park, read off the mask', () => {
  const LOOKS = {
    nature_reserve: 'natural',
    national_park: 'natural',
    golf_course: 'golf',
    cemetery: 'cemetery',
    playground: 'playground',
    pitch: 'pitch',
    park: 'mown',
    garden: 'mown',
    recreation_ground: 'mown',
    grass: 'mown',
    dog_park: 'mown',
    zoo: 'mown',
  } as const;

  it('reads each park kind’s look at its own rectangle, and its class is still park', () => {
    const fixture = landUseCorridor([...Object.keys(LOOKS), 'residential', 'wood']);
    const land = landClassMask(fixture.corridor);
    for (const [kind, look] of Object.entries(LOOKS)) {
      expect(land.classAt(...fixture.centreOf(kind)), kind).toBe('park');
      expect(land.parkLookAt(...fixture.centreOf(kind)), kind).toBe(look);
    }
    // Land that is not park reads `mown`, which no reader asks of it.
    expect(land.parkLookAt(...fixture.centreOf('residential'))).toBe('mown');
    expect(land.parkLookAt(...fixture.centreOf('wood'))).toBe('mown');
  });

  it('names a look only for park kinds, and reads a prototype key as mown', () => {
    for (const kind of Object.keys(PARK_LOOK_OF_KIND)) {
      expect(LAND_CLASS_OF_KIND[kind], kind).toBe('park');
    }
    expect(parkLookOfKind('constructor')).toBe('mown');
    expect(parkLookOfKind('toString')).toBe('mown');
  });

  it('gives an overlap to the more particular place', () => {
    const ground: Box = { minX: 0, maxX: 300, minZ: 0, maxZ: 300 };
    const inner: Box = { minX: 100, maxX: 200, minZ: 100, maxZ: 200 };
    const read = (outer: string, within: string, order: 'outer-first' | 'inner-first') => {
      const features = [rectangle(outer, ground), rectangle(within, inner)];
      const land = landClassMask(
        corridorOf(order === 'outer-first' ? features : features.reverse(), ground),
      );
      return [land.parkLookAt(150, 150), land.parkLookAt(50, 50)];
    };
    for (const order of ['outer-first', 'inner-first'] as const) {
      // A pitch inside a recreation ground is a pitch, and the ground around it mown.
      expect(read('recreation_ground', 'pitch', order), order).toStrictEqual(['pitch', 'mown']);
      // A park inside a national park is mown, and the reserve around it natural.
      expect(read('national_park', 'park', order), order).toStrictEqual(['mown', 'natural']);
      // A playground inside a park is a playground.
      expect(read('park', 'playground', order), order).toStrictEqual(['playground', 'mown']);
      // A golf course inside a national park is a golf course, whichever came first.
      expect(read('national_park', 'golf_course', order), order).toStrictEqual(['golf', 'natural']);
    }
  });

  it('leaves a wood inside a golf course a wood: a look never outranks a class', () => {
    const ground: Box = { minX: 0, maxX: 300, minZ: 0, maxZ: 300 };
    const land = landClassMask(
      corridorOf(
        [
          rectangle('golf_course', ground),
          rectangle('wood', { minX: 100, maxX: 200, minZ: 100, maxZ: 200 }),
        ],
        ground,
      ),
    );
    expect(land.classAt(150, 150)).toBe('wood');
    expect(land.parkLookAt(150, 150)).toBe('mown');
    expect(land.classAt(50, 50)).toBe('park');
    expect(land.parkLookAt(50, 50)).toBe('golf');
  });

  it('costs nothing for a town of plain parks, and a chunk for a look', () => {
    const ground: Box = { minX: 0, maxX: 300, minZ: 0, maxZ: 300 };
    const plain = landClassMask(corridorOf([rectangle('park', ground)], ground));
    expect(plain.bytes).toBe(CHUNK_BYTES);
    const golf = landClassMask(corridorOf([rectangle('golf_course', ground)], ground));
    expect(golf.bytes).toBe(2 * CHUNK_BYTES);
    expect(golf.parkLookAt(150, 150)).toBe('golf');
  });

  it('draws a look only within the mask’s byte cap, and the class regardless', () => {
    const ground: Box = { minX: 0, maxX: 300, minZ: 0, maxZ: 300 };
    // Room for the class chunk and nothing more.
    const land = landClassMask(corridorOf([rectangle('cemetery', ground)], ground), CHUNK_BYTES);
    expect(land.bytes).toBe(CHUNK_BYTES);
    expect(land.classAt(150, 150)).toBe('park');
    expect(land.parkLookAt(150, 150)).toBe('mown');
    // Control: with room for one more, it is a cemetery.
    const roomy = landClassMask(
      corridorOf([rectangle('cemetery', ground)], ground),
      2 * CHUNK_BYTES,
    );
    expect(roomy.parkLookAt(150, 150)).toBe('cemetery');
  });

  it('reads mown outside every chunk, and for a NaN', () => {
    const land = mask(rectangle('golf_course', MIDDLE));
    expect(land.parkLookAt(0, 3_000)).toBe('golf');
    expect(land.parkLookAt(0, 9_000)).toBe('mown');
    expect(land.parkLookAt(Number.NaN, 3_000)).toBe('mown');
    expect(land.parkLookAt(1e12, 3_000)).toBe('mown');
  });
});

describe('#2685 a park planted by its look', () => {
  it('has the mown park’s control: specimen trees and no rock', () => {
    expect(trees(MOWN)).toBeGreaterThan(100);
    expect(rocks(MOWN)).toBe(0);
  });

  it('leaves a pitch an even green, with nothing standing on it', () => {
    expect(ofKind('pitch')).toStrictEqual([]);
  });

  it('plants a cemetery and a playground with a few trees and no rock', () => {
    for (const kind of ['cemetery', 'playground']) {
      const items = ofKind(kind);
      expect(trees(items), kind).toBeGreaterThan(0);
      expect(trees(items), kind).toBeLessThan(trees(MOWN) / 2);
      expect(rocks(items), kind).toBe(0);
    }
  });

  it('plants a golf course in stands with open fairway between them', () => {
    const items = ofKind('golf_course');
    expect(trees(items)).toBeGreaterThan(0);
    expect(trees(items)).toBeLessThan(trees(MOWN));
    expect(rocks(items)).toBe(0);
    // The squares any tree stands in: a golf course's are a few of those a
    // mown park's trees reach, and those few are crowded.
    const squares = (each: readonly ScatterItem[]): Map<string, number> => {
      const held = new Map<string, number>();
      for (const item of each) {
        if (!TREES.has(item.kind)) continue;
        const square = `${Math.floor(item.x / GOLF_STAND_METRES)} ${Math.floor(item.z / GOLF_STAND_METRES)}`;
        held.set(square, (held.get(square) ?? 0) + 1);
      }
      return held;
    };
    const golf = squares(items);
    const mown = squares(MOWN);
    expect(golf.size).toBeLessThan(mown.size * (GOLF_STAND_SHARE + 0.15));
    expect(trees(items) / golf.size).toBeGreaterThan(trees(MOWN) / mown.size);
  });

  it('draws a nature reserve as natural meadow: a lone tree, and stones', () => {
    for (const kind of ['nature_reserve', 'national_park']) {
      const items = ofKind(kind);
      expect(trees(items), kind).toBeGreaterThan(0);
      expect(trees(items), kind).toBeLessThan(trees(MOWN) / 2);
      expect(rocks(items), kind).toBeGreaterThan(0);
    }
  });

  it('plants every mown kind as the plain park, item for item', () => {
    const key = (item: ScatterItem): string =>
      `${item.kind} ${item.x.toFixed(3)} ${item.z.toFixed(3)}`;
    for (const kind of ['garden', 'recreation_ground', 'grass', 'dog_park', 'zoo']) {
      expect(ofKind(kind).map(key), kind).toStrictEqual(MOWN.map(key));
    }
  });
});
