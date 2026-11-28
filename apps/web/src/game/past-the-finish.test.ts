// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Past a route's end, the world goes on — #3336.
 *
 * Read off the frame the renderer is handed (`scene.ts` §`sceneFrame`), on
 * synthetic routes: 50 m, 500 m and 5 km past the end there is ground, a road
 * and scenery; the world short of the end is the one the route draws, to the
 * item, on the frame that starts drawing the extension and on one drawing a
 * longer one; and the finish gantry stays at the route's end.
 *
 * Measured on `main` before #3336, 50 m past the end of the 3 km route here:
 * a corridor 3 m long, no scenery at all, and none of the gantry.
 */

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  elevationAt,
  geographicPosition,
  gradeAt,
  metres,
  positionAt,
  routeProfile,
  type RoutePoint,
  type RouteProfile,
} from '@onyourleft/domain';

import {
  DRAWN_ON_AHEAD_METRES,
  PAST_THE_FINISH_CHUNK_METRES,
  drawnPastTheFinish,
} from './past-the-finish';
import {
  FIXTURE_LATITUDE,
  circuitRoute,
  lakeValleyRoute,
  lollipopRoute,
  northRoute,
  outAndBackRoute,
  sBendRoute,
  windingRoute,
} from './route-fixtures-testing';
import { cityStreetscapeFixture } from './footprint-fixtures-testing';
import { FOOTPRINT_MAX_VERTICES, footprintPlans, type FootprintPlan } from './footprint-buildings';
import { landClassMask } from './land-class';
import { mappedBuildingsOf } from './mapped-buildings';
import { anchorScenery, extendedRoute } from './scenery-anchor';
import { sceneFrame } from './scene';
import type { SceneFrame } from './port';
import { atStartLine } from './simulation';
import { corridorOrigin, localGroundPosition, type CorridorPoint } from './terrain';

/** Room for every item: a budget would thin two frames differently, by where each rider is. */
const EVERYTHING = 1_000_000;

/** The frame at odometer `at` on `profile`, as `GameView` hands it: the route itself. */
function frameAt(profile: RouteProfile, at: number): SceneFrame {
  const start = atStartLine(profile);
  return sceneFrame({
    profile,
    origin: corridorOrigin(profile),
    scatterItems: EVERYTHING,
    structureItems: EVERYTHING,
    state: { ...start, ride: { ...start.ride, distance: metres(at) } },
  });
}

/** How far the drawn road reaches, end to end, in metres. */
function roadReach(frame: SceneFrame): number {
  const centre = frame.corridor.centre;
  let length = 0;
  for (let index = 1; index < centre.length; index += 1) {
    const here = centre[index - 1] as CorridorPoint;
    const next = centre[index] as CorridorPoint;
    length += Math.hypot(next.x - here.x, next.z - here.z);
  }
  return length;
}

/** How far across the ground's vertices spread, in metres: none, on a world drawn to one point. */
function groundSpread(frame: SceneFrame): number {
  const vertices = frame.terrain.mesh.vertices;
  let lowX = Number.POSITIVE_INFINITY;
  let highX = Number.NEGATIVE_INFINITY;
  let lowZ = Number.POSITIVE_INFINITY;
  let highZ = Number.NEGATIVE_INFINITY;
  for (let index = 0; index + 2 < vertices.length; index += 3) {
    const x = vertices[index] as number;
    const z = vertices[index + 2] as number;
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    lowX = Math.min(lowX, x);
    highX = Math.max(highX, x);
    lowZ = Math.min(lowZ, z);
    highZ = Math.max(highZ, z);
  }
  return Math.hypot(highX - lowX, highZ - lowZ);
}

/**
 * Every item of the scenery that `keep` admits: what and where it is, written
 * out to the centimetre, to its height. A height is not written into the key
 * because two frames a step apart stand the same item a centimetre apart: each
 * reads it off its own ground, which is built round its own rider.
 */
function itemsOf(
  frame: SceneFrame,
  keep: (x: number, z: number) => boolean,
): ReadonlyMap<string, number> {
  return new Map(
    frame.scatter
      .filter((item) => keep(item.x, item.z))
      .map((item) => [
        `${item.kind} ${item.x.toFixed(2)} ${item.z.toFixed(2)} ` +
          `${item.rotation.toFixed(3)} ${item.scale.toFixed(3)} ${String(item.variant)}`,
        item.y,
      ]),
  );
}

/** That `after` places what `before` does, where it does, at its height to within 5 cm. */
function expectTheSameItems(
  after: ReadonlyMap<string, number>,
  before: ReadonlyMap<string, number>,
): void {
  expect(before.size).toBeGreaterThan(20);
  expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
  for (const [key, height] of before) {
    expect(Math.abs((after.get(key) ?? Number.NaN) - height)).toBeLessThan(0.05);
  }
}

/**
 * Whether `(x, z)` is nearest the route's own road between route distances
 * `from` and `to`, and within `reach` of it — the whole route searched, so an
 * item beside another stretch, or past the end, is not counted.
 */
function besideTheRoute(
  route: RouteProfile,
  from: number,
  to: number,
  reach: number,
): (x: number, z: number) => boolean {
  const origin = corridorOrigin(route);
  const end: number = route.totalDistance;
  const points: { readonly along: number; readonly x: number; readonly z: number }[] = [];
  for (let along = 0; along <= end; along += 2) {
    points.push({ along, ...localGroundPosition(origin, positionAt(route, along)) });
  }
  return (x, z) => {
    let nearest = points[0] as (typeof points)[number];
    let best = Number.POSITIVE_INFINITY;
    for (const point of points) {
      const away = Math.hypot(point.x - x, point.z - z);
      if (away < best) {
        best = away;
        nearest = point;
      }
    }
    return best <= reach && nearest.along >= from && nearest.along <= to;
  };
}

/** The water a frame draws, but for the frame's own lease on its buffers and the ripples' clock. */
function waterOf(frame: SceneFrame): unknown {
  return JSON.parse(
    JSON.stringify(frame.water, (key, value: unknown) =>
      key === 'lease' || key === 'seconds'
        ? undefined
        : ArrayBuffer.isView(value)
          ? Array.from(value as Float32Array, (each) => Math.round(each * 100) / 100)
          : value,
    ),
  ) as unknown;
}

const ROUTE = northRoute(3_000, (along) => 40 + 12 * Math.sin(along / 400));
const END: number = ROUTE.totalDistance;

describe('riding past a route’s end draws a world — #3336', () => {
  for (const past of [50, 500, 5_000]) {
    it(`has ground, a road and scenery ${String(past)} m past the end`, () => {
      const frame = frameAt(ROUTE, END + past);
      // The corridor's whole span, 60 m behind and 400 m ahead, less a metre.
      expect(roadReach(frame)).toBeGreaterThan(450);
      expect(frame.corridor.quadCount).toBeGreaterThan(0);
      expect(groundSpread(frame)).toBeGreaterThan(400);
      expect(frame.scatter.length).toBeGreaterThan(20);
    });
  }

  it('draws the road on along the route’s final heading, level', () => {
    // An S-bend ends heading some way off north: the road past it carries on that way.
    const route = sBendRoute(60);
    const end: number = route.totalDistance;
    const drawn = drawnPastTheFinish(route, end + 50);
    const origin = corridorOrigin(route);
    const before = localGroundPosition(origin, positionAt(route, end - 50));
    const atEnd = localGroundPosition(origin, positionAt(route, end));
    const on = localGroundPosition(origin, positionAt(drawn, end + 500));
    const ending = Math.atan2(atEnd.x - before.x, atEnd.z - before.z);
    const going = Math.atan2(on.x - atEnd.x, on.z - atEnd.z);
    expect(Math.abs(going - ending)).toBeLessThan(0.02);
    expect(Math.hypot(on.x - atEnd.x, on.z - atEnd.z)).toBeCloseTo(500, 0);
  });

  it('draws the road on level from the route’s last height, whatever its last grade', () => {
    const drawn = drawnPastTheFinish(ROUTE, END + 50);
    expect(Math.abs(gradeAt(ROUTE, END))).toBeGreaterThan(0.5);
    expect(gradeAt(drawn, END + 500)).toBe(0);
    expect(elevationAt(drawn, END + 500)).toBe(elevationAt(ROUTE, END));
  });

  it('reads the final heading over the last 50 m, past a wobble in the last point', () => {
    // North, with its last point 3 m east of the line: a GPS wobble.
    const points: RoutePoint[] = [];
    for (let along = 0; along <= 1_000; along += 10) {
      points.push({
        position: geographicPosition(
          degreesLatitude(FIXTURE_LATITUDE + along / 111_320),
          degreesLongitude(
            along === 1_000 ? 3 / (111_320 * Math.cos((FIXTURE_LATITUDE * Math.PI) / 180)) : 0,
          ),
        ),
        elevation: altitudeMetres(10),
      });
    }
    const route = routeProfile(points);
    const end: number = route.totalDistance;
    const drawn = drawnPastTheFinish(route, end + 50);
    const origin = corridorOrigin(route);
    const atEnd = localGroundPosition(origin, positionAt(route, end));
    const on = localGroundPosition(origin, positionAt(drawn, end + 500));
    // Within 4° of north: read off the last two points it would be 17°.
    expect(Math.abs(Math.atan2(on.x - atEnd.x, on.z - atEnd.z))).toBeLessThan(0.07);
  });

  it('keeps drawing a road however far past the end the rider rides', () => {
    const far = END + 3 * PAST_THE_FINISH_CHUNK_METRES + 400;
    const frame = frameAt(ROUTE, far);
    expect(roadReach(frame)).toBeGreaterThan(450);
    expect(frame.scatter.length).toBeGreaterThan(20);
    const drawn = drawnPastTheFinish(ROUTE, far);
    expect(drawn.totalDistance).toBeGreaterThanOrEqual(far + DRAWN_ON_AHEAD_METRES - 1);
    // An extension of the route, never of another extension, even when one is handed back in.
    expect(extendedRoute(drawn)).toBe(ROUTE);
    const further = drawnPastTheFinish(drawn, (drawn.totalDistance as number) + 10);
    expect(further.totalDistance).toBeGreaterThan(drawn.totalDistance);
    expect(extendedRoute(further)).toBe(ROUTE);
  });
});

describe('the world short of the end does not move — #3336', () => {
  for (const [name, route] of [
    ['a straight climbing route', ROUTE],
    ['a winding route', windingRoute(4_000)],
    ['an out-and-back', outAndBackRoute()],
    ['a lollipop', lollipopRoute()],
    ['a route through a lake’s valley', lakeValleyRoute()],
  ] as const) {
    it(`places ${name}’s own scenery, ground, water and sky on the road drawn on past its end`, () => {
      const end: number = route.totalDistance;
      // The profile a frame past the end is drawn on, drawn here short of the
      // end beside the route itself: the same places, so the same world.
      const drawn = drawnPastTheFinish(route, end + 1);
      expect(drawn).not.toBe(route);
      // Along the whole route, the last place in view of the end.
      for (const at of [end * 0.25, end * 0.5, end - 300]) {
        const own = frameAt(route, at);
        const on = frameAt(drawn, at);
        // In view of both, and short of the end, where the extension's own begin.
        const keep = besideTheRoute(route, at - 40, Math.min(at + 300, end - 40), 40);
        expectTheSameItems(itemsOf(on, keep), itemsOf(own, keep));
        // …and the world's colours, the horizon, the patchwork and the water are the route's.
        expect(on.world).toEqual(own.world);
        expect(on.terrain.horizon).toEqual(own.terrain.horizon);
        expect(on.terrain.mesh.fieldCount).toBe(own.terrain.mesh.fieldCount);
        expect(waterOf(on)).toEqual(waterOf(own));
      }
    });
  }

  it('places the same scenery on a longer extension as on a shorter one', () => {
    // A route of its own, so no case above has built its extensions already.
    const route = northRoute(3_000, (along) => 40 + 12 * Math.sin(along / 400));
    const first = drawnPastTheFinish(route, END + 100);
    const longer = drawnPastTheFinish(route, END + PAST_THE_FINISH_CHUNK_METRES);
    expect(longer.totalDistance).toBeGreaterThan(first.totalDistance);
    const at = END + 2_000;
    const keep = besideTheRoute(longer, at + 5, at + 250, 30);
    expectTheSameItems(itemsOf(frameAt(longer, at), keep), itemsOf(frameAt(first, at), keep));
  });
});

describe('the finish gantry stays at the route’s end — #3336', () => {
  it('stands at the route’s end on a frame drawing on past it', () => {
    // Ten metres past the line, looking back through it, as a rider who has just crossed it does.
    const frame = frameAt(ROUTE, END + 10);
    const finish = frame.lines.find(
      (placed) => placed.stand.kind === 'gantry' && placed.stand.distance === END,
    );
    expect(finish).toBeDefined();
    // No piece of it stands on the road past the end (#902).
    const atEnd = localGroundPosition(corridorOrigin(ROUTE), positionAt(ROUTE, END));
    for (const box of finish?.boxes ?? []) {
      expect(box.z).toBeLessThanOrEqual(atEnd.z + 1);
    }
  });
});

describe('no mapped building stands on the road drawn on — #3336', () => {
  /** One of a city's plans, moved to `x, z` and scaled `scale` times about its middle. */
  function moved(plan: FootprintPlan, x: number, z: number, scale = 1): FootprintPlan {
    const shift = (ring: FootprintPlan['footprint']): FootprintPlan['footprint'] =>
      Float32Array.from(ring, (each, index) =>
        index % 2 === 0
          ? x + (each - plan.centroid.x) * scale
          : z + (each - plan.centroid.z) * scale,
      );
    return {
      ...plan,
      centroid: { x, z },
      footprint: shift(plan.footprint),
      driveway: shift(plan.driveway),
      apron: shift(plan.apron),
    };
  }

  it('takes out the one the road on runs through, and keeps the one beside the route', () => {
    const city = cityStreetscapeFixture();
    const land = landClassMask(city.corridor);
    const { plans } = footprintPlans(
      city.corridor,
      land,
      city.profile,
      city.origin,
      FOOTPRINT_MAX_VERTICES,
    );
    const model = plans[0] as FootprintPlan;
    const end: number = city.profile.totalDistance;
    const atEnd = localGroundPosition(city.origin, positionAt(city.profile, end));
    // The fixture runs north: 100 m on past the end, astride the road; 300 m
    // on, so wide that no corner of it is near the road it spans; 30 m short
    // of the end, 25 m off the route's road; and 200 m short of it, on the line
    // of the road on drawn back, as a bending route's own houses can be.
    const astride = moved(model, atEnd.x, atEnd.z + 100);
    const spanning = moved(model, atEnd.x, atEnd.z + 300, 6);
    const beside = moved(model, atEnd.x + 25, atEnd.z - 30);
    // 200 m on, its nearest wall 2 m east of the road's centreline: on the
    // carriageway, though no edge of it crosses the line.
    let westmost = Number.POSITIVE_INFINITY;
    for (let index = 0; index < model.footprint.length; index += 2) {
      westmost = Math.min(westmost, model.footprint[index] as number);
    }
    const onTheCarriageway = moved(
      model,
      atEnd.x + 2 + (model.centroid.x - westmost),
      atEnd.z + 200,
    );
    const behind = moved(model, atEnd.x, atEnd.z - 200);
    const buildings = mappedBuildingsOf([
      ...plans,
      astride,
      spanning,
      onTheCarriageway,
      beside,
      behind,
    ]);
    const frame = (at: number): SceneFrame => {
      const start = atStartLine(city.profile);
      return sceneFrame({
        profile: city.profile,
        origin: city.origin,
        state: { ...start, ride: { ...start.ride, distance: metres(at) } },
        worldCorridor: city.corridor,
        landClass: land,
        mappedBuildings: buildings,
      });
    };
    // Short of the end, every building, as before #3336.
    expect(frame(end - 50).mappedBuildings?.buildings).toBe(buildings);
    const past = frame(end + 20).mappedBuildings?.buildings.plans ?? [];
    expect(past).not.toContain(astride);
    expect(past).not.toContain(spanning);
    expect(past).not.toContain(onTheCarriageway);
    expect(past).toContain(beside);
    expect(past).toContain(behind);
    expect(past).toHaveLength(plans.length + 2);
  });
});

describe('only a point-to-point route is drawn on — #3336', () => {
  it('draws a loop as itself, which carries on round', () => {
    const loop = circuitRoute(200);
    expect(loop.loop).toBe(true);
    expect(drawnPastTheFinish(loop, loop.totalDistance + 500)).toBe(loop);
  });

  it('draws an open-world view as itself, whose own road goes on', () => {
    const view = northRoute(2_000, () => 20);
    anchorScenery(view, { seed: 7, origin: 0 });
    expect(drawnPastTheFinish(view, 2_500)).toBe(view);
  });

  it('draws a route as itself up to its end', () => {
    expect(drawnPastTheFinish(ROUTE, END)).toBe(ROUTE);
  });
});
