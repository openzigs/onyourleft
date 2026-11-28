// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Road signs placed from the route itself — #3279. Read from the placement
 * function (`routeSigns`, `roadSignsAt`) and back through `sceneFrame`, the
 * frame the renderer draws, on synthetic routes only.
 */

import { describe, expect, it } from 'vitest';

import { altitudeMetres, metres, routeProfile, type RouteProfile } from '@onyourleft/domain';
import type { BuildingFeature, StreetFeature } from '@onyourleft/map-features';

import { realisticRoute, villageRoute, VILLAGE_HOLD_METRES } from '../demo/synthetic-road';

import {
  onSideRoad,
  SIDE_ROAD_STRUCTURE_MARGIN_METRES,
  UNCACHED_SIDE_ROAD_CLEARANCE,
} from './cross-streets';
import { buildingBeside, landBeside, rectangleBeside } from './footprint-fixtures-testing';
import { footprintPlans } from './footprint-buildings';
import { lookAhead, nextClimbText } from './hud/look-ahead';
import { slopesOf, wholePercent } from './hud/climb-ahead';
import { landClassMask, NO_LAND_CLASS } from './land-class';
import { ROAD_CLEARANCE_METRES } from './landform';
import { mappedBuildingsOf, onDriveway } from './mapped-buildings';
import { onPavement, pavementBands } from './people';
import { BLANK_CELL, DIGIT_CELLS, FACE_CELLS, PERCENT_CELL, signCells } from './road-sign-atlas';
import {
  BEND_RADIUS_METRES,
  BEND_START_METRES,
  CLIMB_FOOT_METRES,
  CLIMB_TOP_METRES,
  climbBendRoute,
  climbLoop,
  narrowHairpin,
  streamAtTheFoot,
  switchbacks,
} from './road-signs-fixtures-testing';
import {
  nearestSigns,
  roadSignsAt,
  routeSigns,
  SIGN_FOOTPRINT,
  SIGN_LATERAL_METRES,
  SIGN_SPACING_METRES,
  SIGNED_GRADE_PERCENT,
  SIGNS_PER_FRAME,
  signsClearOf,
  SUMMIT_GAIN_METRES,
  type RoadSign,
  type RouteSign,
} from './road-signs';
import { northRoute } from './route-fixtures-testing';
import { sceneFrame } from './scene';
import { footprintClearance } from './settlements';
import { atStartLine } from './simulation';
import { corridorOrigin, drawnRoadFrame, type CorridorOrigin } from './terrain';
import { inWater, waterways } from './waterways';
import type { WorldCorridor } from './world-data/corridor';

const ROUTE = climbBendRoute();
const ORIGIN = corridorOrigin(ROUTE);
const SEED = 7;

function frameAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  distance: number,
  extra: Partial<Parameters<typeof sceneFrame>[0]> = {},
) {
  const start = atStartLine(profile);
  return sceneFrame({
    profile,
    origin,
    state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
    ...extra,
  });
}

const kinds = (signs: readonly RouteSign[], kind: RouteSign['kind']) =>
  signs.filter((sign) => sign.kind === kind);

describe('the signs a route carries — #3279', () => {
  const signs = routeSigns(ROUTE, ORIGIN);
  const [climb] = slopesOf(ROUTE);

  it('gives one climb, one bend and a flat stretch exactly a climb sign, chevrons and a summit board', () => {
    // The acceptance fixture: an 8 % climb, a level top, one tight bend.
    expect(climb?.kind).toBe('climb');
    expect(new Set(signs.map((sign) => sign.kind))).toEqual(
      new Set(['climb', 'summit', 'chevron']),
    );
    // ONE climb sign, at the foot — where the HUD's slope starts — reading 8.
    const [foot, ...others] = kinds(signs, 'climb');
    expect(others).toEqual([]);
    expect(foot?.distance).toBeCloseTo(climb?.start ?? Number.NaN, 6);
    expect(Math.abs((foot?.distance ?? 0) - CLIMB_FOOT_METRES)).toBeLessThan(20);
    expect(foot?.percent).toBe(8);
    expect(foot?.side).toBe(1);
    // ONE summit board, at the top.
    const [top, ...more] = kinds(signs, 'summit');
    expect(more).toEqual([]);
    expect(Math.abs((top?.distance ?? 0) - CLIMB_TOP_METRES)).toBeLessThan(20);
    expect(top?.percent).toBeUndefined();
    // Chevrons, every one on the bend, on its outside (the left of a right
    // turn), pointing the way it turns.
    const chevrons = kinds(signs, 'chevron');
    expect(chevrons.length).toBeGreaterThanOrEqual(2);
    const arc = (Math.PI / 2) * BEND_RADIUS_METRES;
    for (const chevron of chevrons) {
      expect(chevron.distance).toBeGreaterThanOrEqual(BEND_START_METRES - 10);
      expect(chevron.distance).toBeLessThanOrEqual(BEND_START_METRES + arc + 10);
      expect(chevron.side).toBe(-1);
      expect(chevron.face).toBe('chevron-right');
    }
    // And nothing at all on the level road before the climb or on the top.
    for (const sign of signs) {
      const onFlat =
        sign.distance < CLIMB_FOOT_METRES - 20 ||
        (sign.distance > CLIMB_TOP_METRES + 20 && sign.distance < BEND_START_METRES - 10) ||
        sign.distance > BEND_START_METRES + arc + 10;
      expect(onFlat, `${sign.kind} at ${String(sign.distance)}`).toBe(false);
    }
  });

  it('stands the chevrons on the bend’s OUTSIDE, and every plate facing the rider who rides at it', () => {
    const placed = roadSignsAt(ROUTE, ORIGIN, SEED, 0, 10_000);
    expect(placed.length).toBe(signs.length);
    // The bend's centre: its start, on the inside (the right of a right turn).
    const start = drawnRoadFrame(ROUTE, ORIGIN, BEND_START_METRES);
    if (start === undefined) throw new Error('no road at the bend');
    const centre = {
      x: start.x + start.normalX * BEND_RADIUS_METRES,
      z: start.z + start.normalZ * BEND_RADIUS_METRES,
    };
    for (const sign of placed) {
      const road = drawnRoadFrame(ROUTE, ORIGIN, sign.along);
      if (road === undefined) throw new Error('no road at a sign');
      // The plate faces back along the road: its face against the road's way.
      const faceX = Math.sin(sign.rotation);
      const faceZ = Math.cos(sign.rotation);
      expect(faceX * road.normalZ + faceZ * -road.normalX).toBeLessThan(-0.85);
      // …and its whole plate clear of every stretch of the road.
      expect(footprintClearance(ROUTE, ORIGIN, sign, SIGN_FOOTPRINT)).toBeGreaterThanOrEqual(
        ROAD_CLEARANCE_METRES,
      );
      if (sign.kind !== 'chevron') continue;
      expect(Math.hypot(sign.x - centre.x, sign.z - centre.z)).toBeGreaterThan(
        BEND_RADIUS_METRES + 3,
      );
    }
  });

  it('mirrors a left bend: its chevrons on the right, pointing left', () => {
    const left = climbBendRoute({ turn: 'left' });
    const chevrons = kinds(routeSigns(left, corridorOrigin(left)), 'chevron');
    expect(chevrons.length).toBeGreaterThanOrEqual(2);
    for (const chevron of chevrons) {
      expect(chevron.side).toBe(1);
      expect(chevron.face).toBe('chevron-left');
    }
  });

  it('puts no sign on a level, straight road', () => {
    const level = northRoute(4_000, () => 30);
    expect(routeSigns(level, corridorOrigin(level))).toEqual([]);
  });

  it('signs a descent at its top, reading its whole percent', () => {
    const down = northRoute(2_000, (along) =>
      along <= 500 ? 60 : along <= 1_100 ? 60 - (along - 500) * 0.09 : 6,
    );
    const placed = routeSigns(down, corridorOrigin(down));
    expect(placed.map((sign) => sign.kind)).toEqual(['descent']);
    const [slope] = slopesOf(down);
    expect(placed[0]?.distance).toBeCloseTo(slope?.start ?? Number.NaN, 6);
    expect(placed[0]?.percent).toBe(9);
  });

  it('holds the stated thresholds: under 6 %, under 200 m and under 40 m gained are unsigned', () => {
    const climbOf = (grade: number, length: number) =>
      northRoute(3_000, (along) => (along <= 500 ? 0 : Math.min(along - 500, length) * grade));
    const signed = (route: RouteProfile, kind: RouteSign['kind']) =>
      kinds(routeSigns(route, corridorOrigin(route)), kind).length;
    // 5 % over 900 m: 45 m up, a summit, but no climb sign.
    expect(signed(climbOf(0.05, 900), 'climb')).toBe(0);
    expect(signed(climbOf(0.05, 900), 'summit')).toBe(1);
    // 6 % over 400 m: signed; over 150 m: not.
    expect(signed(climbOf(0.06, 400), 'climb')).toBe(1);
    expect(signed(climbOf(0.06, 150), 'climb')).toBe(0);
    // 8 % over 450 m is 36 m up: no summit; over 600 m, 48 m: one.
    expect(signed(climbOf(0.08, 450), 'summit')).toBe(0);
    expect(signed(climbOf(0.08, 600), 'summit')).toBe(1);
    expect(SIGNED_GRADE_PERCENT).toBe(6);
    expect(SUMMIT_GAIN_METRES).toBe(40);
  });

  it('keeps every sign 40 m from another, the one that matters more where two would meet', () => {
    // Over the top and straight down again: the summit and the descent's sign
    // would stand together, and the descent's is kept.
    const peak = northRoute(3_000, (along) =>
      along <= 500
        ? 0
        : along <= 1_100
          ? (along - 500) * 0.09
          : Math.max(0, 54 - (along - 1_100) * 0.09),
    );
    const placed = routeSigns(peak, corridorOrigin(peak));
    expect(placed.map((sign) => sign.kind)).toEqual(['climb', 'descent']);
    // A mountain of hairpins: never two groups nearer than the spacing.
    const mountain = switchbacks();
    const all = routeSigns(mountain, corridorOrigin(mountain));
    expect(all.filter((sign) => sign.kind === 'chevron').length).toBeGreaterThan(6);
    for (const one of all) {
      for (const other of all) {
        if (one === other || one.group === other.group) continue;
        expect(Math.abs(one.distance - other.distance)).toBeGreaterThanOrEqual(SIGN_SPACING_METRES);
      }
    }
  });

  it('carries a loop’s signs round every lap, at the same places', () => {
    const loop = climbLoop();
    const origin = corridorOrigin(loop);
    const total = loop.totalDistance as number;
    const first = roadSignsAt(loop, origin, SEED, 0, total);
    const second = roadSignsAt(loop, origin, SEED, total, 2 * total);
    expect(first.length).toBeGreaterThan(0);
    expect(second.map((sign) => sign.along - total)).toEqual(first.map((sign) => sign.along));
    expect(second.map((sign) => [sign.x, sign.z])).toEqual(first.map((sign) => [sign.x, sign.z]));
    // A span across the line holds the end of one lap and the start of the next: each sign once.
    const across = roadSignsAt(loop, origin, SEED, total / 2, total * 1.5);
    expect(across.length).toBe(first.length);
    expect(across.some((sign) => sign.along < total)).toBe(true);
    expect(across.some((sign) => sign.along >= total)).toBe(true);
  });

  it('hands a frame at most its belt’s room, the nearest the rider', () => {
    const many: RoadSign[] = Array.from({ length: 50 }, (_, index) => ({
      kind: 'chevron',
      face: 'chevron-left',
      x: 0,
      y: 0,
      z: index,
      rotation: 0,
      along: index * 10,
      side: 1,
    }));
    const kept = nearestSigns(many, 100);
    expect(kept.length).toBe(SIGNS_PER_FRAME);
    expect(kept.some((sign) => sign.along === 100)).toBe(true);
    expect(kept.some((sign) => sign.along === 490)).toBe(false);
  });

  it('puts none on the owner’s village road, and only the descent on the realistic road', () => {
    // What keeps the frozen village frame's 50 calls and the wooded frame's
    // count where they were: no sign in reach of either hold.
    const village = villageRoute();
    expect(routeSigns(village, corridorOrigin(village))).toEqual([]);
    const road = realisticRoute();
    const placed = routeSigns(road, corridorOrigin(road));
    expect(placed.map((sign) => sign.kind)).toEqual(['descent']);
    expect(Math.abs((placed[0]?.distance ?? 0) - 500)).toBeLessThan(20);
    expect(Math.abs((placed[0]?.distance ?? 0) - VILLAGE_HOLD_METRES)).toBeGreaterThan(300);
  });
});

describe('the percent a sign shows — #3279', () => {
  // A climb whose mean is 7.47 %: the HUD rounds to a tenth first and says 8;
  // rounding the mean straight would say 7.
  const route = northRoute(3_000, (along) =>
    along <= 500 ? 0 : Math.min(along - 500, 700) * 0.0747,
  );
  const origin = corridorOrigin(route);

  it('is the whole percent the HUD shows for the same stretch, read through the same function', () => {
    const [slope] = slopesOf(route);
    if (slope === undefined) throw new Error('no climb');
    // Non-vacuity: this climb is one where a second rounding would differ.
    expect(Math.round(slope.grade)).not.toBe(wholePercent(slope.grade));
    // What the HUD's strip says, a little before the foot.
    const caption = nextClimbText(lookAhead(route, slope.start - 150).climb, 'metric');
    const shown = /· (\d+) %/.exec(caption ?? '')?.[1];
    expect(shown).toBe('8');
    // What the frame the renderer draws carries.
    const frame = frameAt(route, origin, slope.start - 150);
    const sign = (frame.signs ?? []).find((each) => each.kind === 'climb');
    expect(sign?.percent).toBe(Number(shown));
    // …and the numerals the belt draws for it.
    if (sign === undefined) throw new Error('no climb sign in the frame');
    expect(signCells(sign)).toEqual({
      face: FACE_CELLS.climb,
      back: signCells({ face: 'descent' }).back,
      glyphs: [DIGIT_CELLS[8], PERCENT_CELL, BLANK_CELL],
      shift: 0.5,
    });
  });

  it('writes two numerals and the sign for a steep one, unshifted, and none on a summit', () => {
    expect(signCells({ face: 'descent', percent: 14 })).toMatchObject({
      glyphs: [DIGIT_CELLS[1], DIGIT_CELLS[4], PERCENT_CELL],
      shift: 0,
    });
    expect(signCells({ face: 'summit' }).glyphs).toEqual([BLANK_CELL, BLANK_CELL, BLANK_CELL]);
    expect(signCells({ face: 'climb', percent: 140 }).glyphs).toEqual([
      BLANK_CELL,
      BLANK_CELL,
      BLANK_CELL,
    ]);
  });
});

describe('never on a side-road mouth, a driveway or a pavement — #3279', () => {
  it('drops a sign whose plate would stand on ANOTHER stretch of the road, as at a hairpin', () => {
    const route = narrowHairpin();
    const origin = corridorOrigin(route);
    const [up] = slopesOf(route);
    if (up === undefined) throw new Error('no climb');
    // The way up's sign would stand on the right — on the way down.
    expect(kinds(routeSigns(route, origin), 'climb')).toHaveLength(1);
    const placed = roadSignsAt(route, origin, SEED, 0, 10_000);
    expect(placed.some((sign) => sign.kind === 'climb')).toBe(false);
    for (const sign of placed) {
      expect(footprintClearance(route, origin, sign, SIGN_FOOTPRINT)).toBeGreaterThanOrEqual(
        ROAD_CLEARANCE_METRES,
      );
    }
  });

  it('drops a sign that would stand in the water', () => {
    const route = streamAtTheFoot();
    const origin = corridorOrigin(route);
    const ways = waterways(route, SEED, NO_LAND_CLASS);
    const [climb] = kinds(routeSigns(route, origin), 'climb');
    if (climb === undefined) throw new Error('no climb sign');
    // Non-vacuity: the stream does cross where the sign would stand.
    expect(inWater(ways, route, climb.distance, SIGN_LATERAL_METRES)).toBe(true);
    expect(roadSignsAt(route, origin, SEED, 0, 10_000).some((sign) => sign.kind === 'climb')).toBe(
      false,
    );
  });

  const [slope] = slopesOf(ROUTE);
  const foot = slope?.start ?? Number.NaN;

  /** A straight street leaving the route at `along` on the right, at a right angle. */
  function rightTurn(along: number): StreetFeature {
    const here = drawnRoadFrame(ROUTE, ORIGIN, along);
    if (here === undefined) throw new Error(`no road at ${String(along)}`);
    return {
      kind: 'minor_road',
      kindDetail: 'residential',
      grade: 'ground',
      line: Float32Array.from([
        here.x,
        here.z,
        here.x + here.normalX * 120,
        here.z + here.normalZ * 120,
      ]),
    };
  }

  const corridor = (
    streets: readonly StreetFeature[],
    buildings: readonly BuildingFeature[] = [],
    landUse: WorldCorridor['landUse'] = [],
  ): WorldCorridor => ({
    routeId: 'road-signs-fixture',
    origin: ORIGIN,
    covered: () => true,
    coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
    landUse,
    buildings,
    paths: [],
    streets,
  });

  it('drops the climb sign a side road leaves from, and keeps it where none does', () => {
    const bare = frameAt(ROUTE, ORIGIN, foot - 100, { worldCorridor: corridor([]) });
    expect((bare.signs ?? []).some((sign) => sign.kind === 'climb')).toBe(true);
    const ride = [-150, -100, -50, -10, 10].map((offset) =>
      frameAt(ROUTE, ORIGIN, foot + offset, { worldCorridor: corridor([rightTurn(foot)]) }),
    );
    for (const frame of ride) {
      expect(frame.sideRoads.some((road) => road.junction.source === 'mapped')).toBe(true);
      expect((frame.signs ?? []).some((sign) => sign.kind === 'climb')).toBe(false);
      // And every sign the frame does carry is off every side road in it.
      for (const sign of frame.signs ?? []) {
        expect(
          onSideRoad(frame.sideRoads, sign, SIGN_FOOTPRINT, SIDE_ROAD_STRUCTURE_MARGIN_METRES),
        ).toBe(false);
      }
    }
  });

  it('drops a sign on a mapped driveway, by the rule that keeps a hedge off one', () => {
    const profile = northRoute(3_000, () => 10);
    const origin = corridorOrigin(profile);
    const houses = Array.from({ length: 6 }, (_, index) =>
      buildingBeside(profile, origin, [rectangleBeside(1_000 + index * 40, 30, 13, 8)], 6),
    );
    const land = (kind: string, near: number, far: number) =>
      landBeside(profile, origin, 'landuse', kind, 500, 2_000, near, far);
    const world: WorldCorridor = {
      ...corridor([], houses, [land('residential', 15, 300), land('farmland', -300, -4)]),
      origin,
    };
    const plans = footprintPlans(world, landClassMask(world), profile, origin).plans;
    const buildings = mappedBuildingsOf(plans);
    const plan = plans.find((each) => each.driveway.length > 0);
    if (plan === undefined) throw new Error('the fixture has no driveway');
    // A sign stood on the driveway's first corner, square to the road.
    const at = { x: plan.driveway[0] as number, z: plan.driveway[1] as number };
    const on: RoadSign = { ...signAt(at.x, at.z), kind: 'climb', face: 'climb', percent: 8 };
    expect(onDriveway(buildings, on, SIGN_FOOTPRINT, SIDE_ROAD_STRUCTURE_MARGIN_METRES)).toBe(true);
    expect(signsClearOf([on], [], UNCACHED_SIDE_ROAD_CLEARANCE, [], buildings)).toEqual([]);
    // THE CONTROL: the same sign 20 m along, between two driveways, stays.
    const off: RoadSign = { ...on, z: on.z + 20 };
    expect(signsClearOf([off], [], UNCACHED_SIDE_ROAD_CLEARANCE, [], buildings)).toEqual([off]);
  });

  it('drops a sign on a village pavement, and keeps one beside it', () => {
    const village = villageRoute();
    const origin = corridorOrigin(village);
    const frame = frameAt(village, origin, VILLAGE_HOLD_METRES);
    const [street] = frame.streets;
    if (street === undefined) throw new Error('no village street in the frame');
    const walk = street.walks[0];
    if (walk === undefined) throw new Error('a street with no pavement');
    const middle = Math.floor(walk.length / 6) * 3;
    const on = signAt(walk[middle] as number, walk[middle + 2] as number);
    expect(onPavement([pavementBands(street)], on.x, on.z)).toBe(true);
    expect(signsClearOf([on], [], UNCACHED_SIDE_ROAD_CLEARANCE, [street], undefined)).toEqual([]);
    // THE CONTROL: 30 m out across the fields from it.
    const off = { ...on, x: on.x + 30 };
    expect(signsClearOf([off], [], UNCACHED_SIDE_ROAD_CLEARANCE, [street], undefined)).toEqual([
      off,
    ]);
  });
});

describe('the signs sceneFrame hands on, read back through the frame — #3279', () => {
  const climbSigns = (frame: ReturnType<typeof frameAt>) =>
    (frame.signs ?? []).filter((sign) => sign.kind === 'climb');

  /** The village road, its level raised into an 8 % climb at `foot` — the villages stay where they were. */
  function villageClimb(foot: number): RouteProfile {
    const base = villageRoute();
    return routeProfile(
      base.positions.map((position, index) => {
        const along = index * base.resolution;
        const rise = along <= foot ? 0 : Math.min(along - foot, 500) * 0.08;
        return { position, elevation: altitudeMetres(30 + rise) };
      }),
    );
  }

  it('drops the climb sign that stands on a village street’s pavement, and keeps it where none does', () => {
    // A foot 998 m along puts the climb sign on the first village's pavement.
    const route = villageClimb(998);
    const origin = corridorOrigin(route);
    const frame = frameAt(route, origin, 958);
    const raw = roadSignsAt(route, origin, SEED, 0, 10_000, NO_LAND_CLASS);
    const bands = frame.streets.map((street) => pavementBands(street));
    // Non-vacuity: the sign IS on a pavement the frame carries, before the filter.
    expect(raw.some((sign) => sign.kind === 'climb' && onPavement(bands, sign.x, sign.z))).toBe(
      true,
    );
    expect(climbSigns(frame)).toEqual([]);
    // THE CONTROL: the same climb 32 m further on stands clear of it, and stays.
    const clear = villageClimb(1_030);
    expect(climbSigns(frameAt(clear, corridorOrigin(clear), 990))).toHaveLength(1);
  });

  /** A climb at 1 000 m on a north road, the first house's driveway `shift` m along. */
  function houseClimb(shift: number) {
    const profile = northRoute(
      3_000,
      (along) => 10 + Math.min(Math.max(along - 1_000, 0), 400) * 0.08,
    );
    const origin = corridorOrigin(profile);
    const houses = Array.from({ length: 6 }, (_, index) =>
      buildingBeside(profile, origin, [rectangleBeside(shift + index * 40, 30, 13, 8)], 6),
    );
    const land = (kind: string, near: number, far: number) =>
      landBeside(profile, origin, 'landuse', kind, 500, 2_000, near, far);
    const world: WorldCorridor = {
      routeId: 'road-signs-houses',
      origin,
      covered: () => true,
      coveredBoxes: [{ minX: -1_000, maxX: 1_000, minZ: -500, maxZ: 3_500 }],
      landUse: [land('residential', 15, 300), land('farmland', -300, -4)],
      buildings: houses,
      paths: [],
      streets: [],
    };
    const plans = footprintPlans(world, landClassMask(world), profile, origin).plans;
    const buildings = mappedBuildingsOf(plans);
    return {
      profile,
      origin,
      buildings,
      frame: frameAt(profile, origin, 960, { mappedBuildings: buildings }),
    };
  }

  it('drops the climb sign that stands on a mapped driveway, and keeps it between two', () => {
    const on = houseClimb(1_004);
    const raw = roadSignsAt(on.profile, on.origin, SEED, 0, 10_000, NO_LAND_CLASS);
    const sign = raw.find((each) => each.kind === 'climb');
    if (sign === undefined) throw new Error('no climb sign');
    // Non-vacuity: the sign IS on a driveway before the filter.
    expect(onDriveway(on.buildings, sign, SIGN_FOOTPRINT, SIDE_ROAD_STRUCTURE_MARGIN_METRES)).toBe(
      true,
    );
    expect(climbSigns(on.frame)).toEqual([]);
    // THE CONTROL: the houses 30 m on leave it clear, and it stays.
    expect(climbSigns(houseClimb(1_034).frame)).toHaveLength(1);
  });
});

/** A sign of no consequence standing at `(x, z)`, its plate square to a road running north. */
function signAt(x: number, z: number): RoadSign {
  return { kind: 'summit', face: 'summit', x, y: 0, z, rotation: Math.PI, along: 0, side: 1 };
}
