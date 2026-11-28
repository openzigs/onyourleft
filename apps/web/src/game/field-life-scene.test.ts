// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The field life a FRAME carries — #3286, read back off `sceneFrame`, the
 * path the renderer takes it by (`port.ts` §`SceneFrame.fieldLife`).
 *
 * The fixture is synthetic, written as arithmetic: 3 km of level road running
 * north, and beside it from 1 km —
 *
 * - **a meadow on the right** (`−x`), from 8 m out to 220 m, on to 2.6 km,
 *   with a wood mapped inside it and a mapped track across it;
 * - **arable farmland on the left**, from 8 m out to 220 m.
 *
 * No real place. ⚠️ The road's RIGHT is `−x` here: the route runs north
 * (`route-fixtures-testing.ts` §`northRoute`).
 */

import { describe, expect, it } from 'vitest';

import { metres } from '@onyourleft/domain';
import type { LandUseFeature } from '@onyourleft/map-features';

import {
  FIELD_ANIMALS_MAX,
  FIELD_ANIMALS_NEAR_MAX,
  FIELD_BALES_MAX,
  FIELD_LIFE_CELL_METRES,
  FIELD_LIFE_EDGE_METRES,
  FIELD_LIFE_NEAR_METRES,
  FIELD_LIFE_ROAD_CLEAR_METRES,
  FIELD_LIFE_STREET_CLEAR_METRES,
  type FieldLife,
} from './field-life';
import { besideRoad, landBeside, ringBeside, streetBeside } from './footprint-fixtures-testing';
import { kindAt, landClassMask } from './land-class';
import { standingOnGround } from './landform';
import type { SceneFrame } from './port';
import { distanceToDrawnRoad } from './road-grid';
import { northRoute } from './route-fixtures-testing';
import { sceneFrame, type SceneInput } from './scene';
import { atStartLine } from './simulation';
import { corridorOrigin } from './terrain';
import type { WorldCorridor } from './world-data/corridor';

const PROFILE = northRoute(3_000, () => 10);
const ORIGIN = corridorOrigin(PROFILE);

/** Where the fields run along the road, metres: the farmland to 1.6 km, the meadow on to 2.6 km. */
const FIELDS_FROM = 1_000;
const FIELDS_TO = 1_600;
const MEADOW_TO = 2_600;

/** The meadow's mapped edges, metres from the road's middle: its near edge inside the clearance. */
const NEAR_EDGE = 8;
const FAR_EDGE = 220;

/** The wood inside the meadow, along and across. */
const WOOD = { from: 1_250, to: 1_350, near: 40, far: 140 } as const;

/** The track across the meadow, along it at 1 150 m. */
const TRACK_ALONG = 1_150;

const MEADOW = landBeside(
  PROFILE,
  ORIGIN,
  'landuse',
  'meadow',
  FIELDS_FROM,
  MEADOW_TO,
  NEAR_EDGE,
  FAR_EDGE,
);

/** A corridor of `landUse`, with the track across the meadow. */
function corridorOf(landUse: readonly LandUseFeature[], tracks = true): WorldCorridor {
  return {
    routeId: 'field-life-fixture',
    origin: ORIGIN,
    covered: () => true,
    coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
    landUse,
    buildings: [],
    paths: [],
    streets: tracks
      ? [
          streetBeside(
            PROFILE,
            ORIGIN,
            [
              [TRACK_ALONG, 20],
              [TRACK_ALONG, 200],
            ],
            'track',
          ),
        ]
      : [],
  };
}

const FIELDS = corridorOf([
  MEADOW,
  landBeside(PROFILE, ORIGIN, 'landuse', 'wood', WOOD.from, WOOD.to, WOOD.near, WOOD.far),
  landBeside(PROFILE, ORIGIN, 'landuse', 'farmland', FIELDS_FROM, FIELDS_TO, -NEAR_EDGE, -FAR_EDGE),
]);
const FIELDS_LAND = landClassMask(FIELDS);

/** The same road through a town and a wood: no meadow, grassland or farmland. */
const NO_FIELDS = corridorOf(
  [
    landBeside(PROFILE, ORIGIN, 'landuse', 'residential', 900, 1_700, 8, 220),
    landBeside(PROFILE, ORIGIN, 'landuse', 'wood', 900, 1_700, -8, -220),
  ],
  false,
);

/** A frame of a ride `distance` in, over `corridor`, saying whatever `more` says. */
function frameAt(
  distance: number,
  corridor: WorldCorridor | null = FIELDS,
  more: Partial<SceneInput> = {},
): SceneFrame {
  const start = atStartLine(PROFILE);
  return sceneFrame({
    profile: PROFILE,
    origin: ORIGIN,
    state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
    ...(corridor === null
      ? {}
      : {
          worldCorridor: corridor,
          landClass: corridor === FIELDS ? FIELDS_LAND : landClassMask(corridor),
        }),
    ...more,
  });
}

/**
 * Every piece any frame along the fields carries, each once, riding three
 * cells at a time: a frame plans 200 m round the road ahead, so no field is
 * passed unasked.
 */
function piecesAlong(corridor: WorldCorridor = FIELDS): readonly FieldLife[] {
  const seen = new Map<string, FieldLife>();
  for (let distance = 900; distance <= 2_700; distance += 3 * FIELD_LIFE_CELL_METRES) {
    for (const piece of frameAt(distance, corridor).fieldLife?.pieces ?? []) {
      seen.set(`${piece.kind},${String(piece.x)},${String(piece.z)}`, piece);
    }
  }
  return [...seen.values()];
}

const ALONG = piecesAlong();
const ANIMALS = ALONG.filter((piece) => piece.kind !== 'bale');
const BALES = ALONG.filter((piece) => piece.kind === 'bale');

/** Where `along` the road and `lateral` across it is, in the corridor's metres. */
function at(along: number, lateral = 0): { readonly x: number; readonly z: number } {
  const [x, z] = besideRoad(PROFILE, ORIGIN, along, lateral);
  return { x, z };
}

/** Whether `(x, z)` is inside the meadow's mapped polygon, by its own ring. */
function insideMeadow(x: number, z: number): boolean {
  return kindAt(corridorOf([MEADOW], false), x, z) === 'meadow';
}

describe('#3286 field life, read back off the frame', () => {
  it('grazes cows and sheep inside the meadow polygon only, and none near the road', () => {
    // Non-vacuity: a field of herds, both animals, in every pose.
    expect(ANIMALS.length).toBeGreaterThan(20);
    expect(new Set(ANIMALS.map((piece) => piece.kind))).toStrictEqual(new Set(['cow', 'sheep']));
    expect(new Set(ANIMALS.map((piece) => piece.pose))).toStrictEqual(
      new Set(['grazing', 'head-up', 'lying']),
    );
    for (const animal of ANIMALS) {
      expect(insideMeadow(animal.x, animal.z), `${String(animal.x)}, ${String(animal.z)}`).toBe(
        true,
      );
      // Inside the field's boundary, never on its edge's hedge.
      for (const [dx, dz] of [
        [FIELD_LIFE_EDGE_METRES, 0],
        [-FIELD_LIFE_EDGE_METRES, 0],
        [0, FIELD_LIFE_EDGE_METRES],
        [0, -FIELD_LIFE_EDGE_METRES],
      ] as const) {
        expect(insideMeadow(animal.x + dx, animal.z + dz)).toBe(true);
      }
      expect(distanceToDrawnRoad(PROFILE, ORIGIN, animal.x, animal.z, 500)).toBeGreaterThanOrEqual(
        FIELD_LIFE_ROAD_CLEAR_METRES,
      );
    }
    // The meadow's own near edge is inside the clearance, so it is the rule
    // and not the polygon that keeps them off the verge.
    expect(NEAR_EDGE).toBeLessThan(FIELD_LIFE_ROAD_CLEAR_METRES);
    expect(
      Math.min(
        ...ANIMALS.map((animal) => distanceToDrawnRoad(PROFILE, ORIGIN, animal.x, animal.z, 500)),
      ),
    ).toBeLessThan(FIELD_LIFE_ROAD_CLEAR_METRES + 10);
  });

  it('keeps them out of the wood mapped in the meadow and off the track across it', () => {
    const wood = corridorOf([MEADOW, FIELDS.landUse[1] as LandUseFeature], false);
    const track = at(TRACK_ALONG).z;
    for (const animal of ANIMALS) {
      expect(kindAt(wood, animal.x, animal.z)).toBe('meadow');
      expect(Math.abs(animal.z - track)).toBeGreaterThanOrEqual(FIELD_LIFE_STREET_CLEAR_METRES);
    }
    // Non-vacuity: the meadow round the wood and the track has herds in it.
    expect(ANIMALS.some((animal) => Math.abs(animal.z - track) < 40)).toBe(true);
    const [woodFrom, woodTo] = [at(WOOD.from).z, at(WOOD.to).z].sort((a, b) => a - b) as [
      number,
      number,
    ];
    expect(ANIMALS.some((animal) => animal.z > woodFrom - 30 && animal.z < woodTo + 30)).toBe(true);
  });

  it('lays the bales on the farmland, and stands no animal there', () => {
    expect(BALES.length).toBeGreaterThan(4);
    const arable = corridorOf([FIELDS.landUse[2] as LandUseFeature], false);
    for (const bale of BALES) {
      expect(bale.pose).toBe('lying');
      expect(kindAt(arable, bale.x, bale.z)).toBe('farmland');
      expect(distanceToDrawnRoad(PROFILE, ORIGIN, bale.x, bale.z, 500)).toBeGreaterThanOrEqual(
        FIELD_LIFE_ROAD_CLEAR_METRES,
      );
    }
    for (const animal of ANIMALS) expect(kindAt(arable, animal.x, animal.z)).toBeUndefined();
  });

  it('yields none on a corridor with no meadow, grassland or farmland, and none with no corridor', () => {
    for (const distance of [1_000, 1_200, 1_400, 1_600]) {
      expect(frameAt(distance, NO_FIELDS).fieldLife?.pieces).toHaveLength(0);
    }
    expect(frameAt(1_200, NO_FIELDS).fieldLife?.pieces).toHaveLength(0);
    expect(frameAt(1_200, null).fieldLife).toBeUndefined();
    // The realistic page's lever off.
    expect(frameAt(1_200, FIELDS, { fieldLifeOff: true }).fieldLife).toBeUndefined();
    expect(frameAt(1_200).fieldLife?.pieces.length).toBeGreaterThan(0);
  });

  it('holds a frame to its caps, the nearest animals to the rider at their near level', () => {
    let seenNear = false;
    for (let distance = 1_000; distance <= 2_600; distance += 50) {
      const pieces = frameAt(distance).fieldLife?.pieces ?? [];
      const animals = pieces.filter((piece) => piece.kind !== 'bale');
      expect(animals.length).toBeLessThanOrEqual(FIELD_ANIMALS_MAX);
      expect(pieces.length - animals.length).toBeLessThanOrEqual(FIELD_BALES_MAX);
      const near = animals.filter((piece) => piece.level === 'near');
      expect(near.length).toBeLessThanOrEqual(FIELD_ANIMALS_NEAR_MAX);
      // The rider is on the road's middle.
      const rider = at(distance);
      const off = (piece: FieldLife): number => Math.hypot(piece.x - rider.x, piece.z - rider.z);
      for (const each of near) expect(off(each)).toBeLessThanOrEqual(FIELD_LIFE_NEAR_METRES + 1);
      // Exactly the nearest within the band, up to the cap.
      const within = animals.filter((piece) => off(piece) <= FIELD_LIFE_NEAR_METRES).length;
      expect(near).toHaveLength(Math.min(within, FIELD_ANIMALS_NEAR_MAX));
      const farthestNear = Math.max(...near.map(off));
      const nearestFar = Math.min(...animals.filter((piece) => piece.level === 'far').map(off));
      if (near.length > 0) expect(farthestNear).toBeLessThanOrEqual(nearestFar);
      if (near.length > 0) seenNear = true;
    }
    // Non-vacuity: somewhere along the meadow an animal is near.
    expect(seenNear).toBe(true);
  });

  it('stands every piece on the frame’s own drawn ground', () => {
    let stood = 0;
    for (let distance = 1_000; distance <= 1_600; distance += 100) {
      const frame = frameAt(distance);
      const pieces = frame.fieldLife?.pieces ?? [];
      const grounded = standingOnGround(
        pieces.map((piece) => ({ ...piece, y: Number.NaN })),
        frame.terrain.mesh,
      );
      expect(grounded).toHaveLength(pieces.length);
      grounded.forEach((ground, index) => {
        expect(Math.abs(ground.y - (pieces[index] as FieldLife).y)).toBeLessThan(0.5);
        stood += 1;
      });
    }
    expect(stood).toBeGreaterThan(20);
  });

  it('stands a piece in the same place on every ask, and hands the same answer within a cell', () => {
    const first = frameAt(1_200).fieldLife;
    // Past the cache: another road object, the same numbers.
    const again = sceneFrame({
      profile: northRoute(3_000, () => 10),
      origin: ORIGIN,
      state: {
        ...atStartLine(PROFILE),
        ride: { ...atStartLine(PROFILE).ride, distance: metres(1_200) },
      },
      worldCorridor: FIELDS,
      landClass: FIELDS_LAND,
    }).fieldLife;
    expect(
      again?.pieces.map(({ x, z, kind, pose, heading }) => [x, z, kind, pose, heading]),
    ).toStrictEqual(
      first?.pieces.map(({ x, z, kind, pose, heading }) => [x, z, kind, pose, heading]),
    );
    // Two frames a metre apart in the one cell: the same object, so the belt rebuilds nothing.
    const cellStart =
      Math.ceil((1_240 + 40) / FIELD_LIFE_CELL_METRES) * FIELD_LIFE_CELL_METRES - 40;
    expect(frameAt(cellStart + 1).fieldLife).toBe(frameAt(cellStart + 2).fieldLife);
  });
});

// Keeps the fixture's helpers honest: the meadow's ring is the rectangle it says.
describe('the fixture', () => {
  it('maps the meadow where it says', () => {
    expect(MEADOW.rings[0]).toStrictEqual(
      ringBeside(PROFILE, ORIGIN, [
        [FIELDS_FROM, NEAR_EDGE],
        [MEADOW_TO, NEAR_EDGE],
        [MEADOW_TO, FAR_EDGE],
        [FIELDS_FROM, FAR_EDGE],
      ]),
    );
    expect(insideMeadow(at(1_200, 30).x, at(1_200, 30).z)).toBe(true);
    expect(insideMeadow(at(1_200, -30).x, at(1_200, -30).z)).toBe(false);
  });
});
