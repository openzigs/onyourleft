// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `billboards.ts` — where the game's billboards stand, #966. Never in the
 * carriageway, never on a bend's inside, clear of what else is built, and a
 * function of where they stand.
 */

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  distanceOnRoute,
  geographicPosition,
  metres,
  routeProfile,
  type RoutePoint,
  type RouteProfile,
} from '@onyourleft/domain';

import {
  BILLBOARD_LATERAL_METRES,
  BILLBOARD_YAW_RADIANS,
  SCENERY_MARGIN_METRES,
  STRAIGHT_RADIANS_PER_METRE,
  STRUCTURE_MARGIN_METRES,
  billboardsAt,
  clearOfBillboards,
  footprintsMeet,
  nearestBillboards,
  turnAt,
  type Billboard,
} from './billboards';
import { ROAD_CLEARANCE_METRES } from './landform';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import {
  BILLBOARDS_PER_FRAME,
  BILLBOARD_FOOTPRINT,
  GATE_LOGO_BOARDS_PER_FRAME,
  LOGO_BOARDS_PER_FRAME,
  carriesTheLogo,
  logoBoxes,
} from './logo-board';
import { inWater, waterways } from './waterways';
import {
  FIXTURE_LATITUDE,
  circuitRoute,
  plannerRoute,
  steadyClimb,
  valleyRoute,
} from './route-fixtures-testing';
import {
  STRUCTURE_KINDS,
  TIGHT_BEND_RADIANS_PER_METRE,
  scatterAt,
  scatterSeed,
  type ScatterItem,
} from './scatter';
import { SETTLEMENT_SPACING_METRES, STRUCTURE_FOOTPRINTS, structuresAt } from './settlements';
import { corridorOrigin, drawnRoadFrame } from './terrain';

const METRES_PER_DEGREE_LATITUDE = 111_320;

/** A road that never stops bending: a sine wave about due north, level. */
function wiggleRoute(length: number, amplitude: number, wavelength: number): RouteProfile {
  const perLongitude = METRES_PER_DEGREE_LATITUDE * Math.cos((FIXTURE_LATITUDE * Math.PI) / 180);
  const points: RoutePoint[] = [];
  for (let north = 0; north <= length; north += 5) {
    const east = amplitude * Math.sin((north / wavelength) * Math.PI * 2);
    points.push({
      position: geographicPosition(
        degreesLatitude(FIXTURE_LATITUDE + north / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(-0.12 + east / perLongitude),
      ),
      elevation: altitudeMetres(0),
    });
  }
  return routeProfile(points);
}

/**
 * Two long legs 14 m apart joined by a tight U-turn: a billboard on the side
 * facing the other leg would stand on it, and must not.
 */
function longHairpin(): RouteProfile {
  const perLongitude = METRES_PER_DEGREE_LATITUDE * Math.cos((FIXTURE_LATITUDE * Math.PI) / 180);
  const points: RoutePoint[] = [];
  const push = (east: number, north: number): void => {
    points.push({
      position: geographicPosition(
        degreesLatitude(FIXTURE_LATITUDE + north / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(-0.12 + east / perLongitude),
      ),
      elevation: altitudeMetres(0),
    });
  };
  const radius = 7;
  // 1 800 m legs: two of this route's site boundaries hash the side facing
  // the other leg, which is what the clearance has to refuse.
  for (let north = 0; north < 1_800; north += 10) push(0, north);
  for (let step = 0; step <= 12; step += 1) {
    const angle = (step / 12) * Math.PI;
    push(radius * (1 - Math.cos(angle)), 1_800 + radius * Math.sin(angle));
  }
  for (let north = 1_790; north >= 0; north -= 10) push(2 * radius, north);
  return routeProfile(points);
}

/**
 * A road that coils round a 30 m circle seven times, climbing: every site
 * boundary on it is on a bend tight enough that a real road would be posted,
 * so it holds no billboard.
 */
function coilRoute(): RouteProfile {
  const perLongitude = METRES_PER_DEGREE_LATITUDE * Math.cos((FIXTURE_LATITUDE * Math.PI) / 180);
  const radius = 30;
  const steps = Math.round((2 * Math.PI * radius) / 5);
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 7 * steps; index += 1) {
    const angle = (index / steps) * 2 * Math.PI;
    points.push({
      position: geographicPosition(
        degreesLatitude(FIXTURE_LATITUDE + (radius * Math.sin(angle)) / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(-0.12 + (radius * (Math.cos(angle) - 1)) / perLongitude),
      ),
      elevation: altitudeMetres(index * 0.1),
    });
  }
  return routeProfile(points);
}

const ROUTES: readonly (readonly [string, RouteProfile])[] = [
  ['two legs 14 m apart', longHairpin()],
  ['a road coiled round a 30 m circle', coilRoute()],
  ['a 3 km climb', steadyClimb()],
  ['a valley', valleyRoute()],
  ['a planner’s bends', plannerRoute()],
  ['a 300 m circuit, left-hand', circuitRoute(300)],
  ['a 300 m circuit, right-hand', circuitRoute(300, undefined, 'right')],
  ['a 200 m circuit, right-hand', circuitRoute(200, undefined, 'right')],
  ['a 400 m circuit, left-hand', circuitRoute(400)],
  ['a 400 m circuit, right-hand', circuitRoute(400, undefined, 'right')],
  ['a road that never stops bending', wiggleRoute(6_000, 40, 260)],
  ['a gentle wiggle', wiggleRoute(8_000, 25, 900)],
];

function all(profile: RouteProfile): readonly Billboard[] {
  const total = profile.totalDistance as number;
  return billboardsAt(profile, corridorOrigin(profile), scatterSeed(profile), 0, total);
}

/** The drawn road's centreline every metre, for a brute-force distance. */
function drawnRoad(profile: RouteProfile): readonly (readonly [number, number])[] {
  const origin = corridorOrigin(profile);
  const total = profile.totalDistance as number;
  const points: [number, number][] = [];
  for (let at = 0; at <= total; at += 1) {
    const frame = drawnRoadFrame(profile, origin, distanceOnRoute(profile, at));
    if (frame !== undefined) points.push([frame.x, frame.z]);
  }
  return points;
}

/** A footprint's four corners, in the corridor's frame. */
function corners(board: Billboard): readonly (readonly [number, number])[] {
  const sin = Math.sin(board.rotation);
  const cos = Math.cos(board.rotation);
  const out: [number, number][] = [];
  for (const x of [-BILLBOARD_FOOTPRINT.x, BILLBOARD_FOOTPRINT.x]) {
    for (const z of [BILLBOARD_FOOTPRINT.back, BILLBOARD_FOOTPRINT.front]) {
      out.push([board.x + x * cos + z * sin, board.z - x * sin + z * cos]);
    }
  }
  return out;
}

function distanceToSegment(
  px: number,
  pz: number,
  [ax, az]: readonly [number, number],
  [bx, bz]: readonly [number, number],
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const length = dx * dx + dz * dz;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / length));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

describe('billboards — #966', () => {
  it('stands some billboards, on the routes long enough for a site boundary', () => {
    // Non-vacuity for everything below: a rule that placed none would pass it.
    const counts = ROUTES.map(([, profile]) => all(profile).length);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBeGreaterThanOrEqual(8);
    // A route under one and a half site spans has no boundary inside it.
    const short = steadyClimb();
    const origin = corridorOrigin(short);
    expect(
      billboardsAt(short, origin, scatterSeed(short), 0, SETTLEMENT_SPACING_METRES * 1.4),
    ).not.toHaveLength(0);
  });

  it('puts none on a route of one site, and none at a loop’s start line', () => {
    const one = valleyRoute();
    if (Math.round((one.totalDistance as number) / SETTLEMENT_SPACING_METRES) < 2) {
      expect(all(one)).toEqual([]);
    }
    for (const [, profile] of ROUTES.filter(([, each]) => each.loop)) {
      const total = profile.totalDistance as number;
      for (const board of all(profile)) {
        const wrapped = distanceOnRoute(profile, board.along);
        expect(Math.min(wrapped, total - wrapped)).toBeGreaterThan(100);
      }
    }
  });

  it('never stands in the carriageway: every corner clear of every stretch of the drawn road', () => {
    // Measured by brute force here, independently of `footprintClearance`.
    for (const [name, profile] of ROUTES) {
      const road = drawnRoad(profile);
      for (const board of all(profile)) {
        for (const [x, z] of corners(board)) {
          let least = Number.POSITIVE_INFINITY;
          for (let index = 0; index + 1 < road.length; index += 1) {
            least = Math.min(
              least,
              distanceToSegment(
                x,
                z,
                road[index] as [number, number],
                road[index + 1] as [number, number],
              ),
            );
          }
          // The corner of a rectangle, not its nearest edge: a little slack
          // for a road segment passing between two corners.
          expect(least, name).toBeGreaterThan(ROAD_CLEARANCE_METRES - 0.05);
        }
      }
    }
  }, 60_000);

  it('stands on the OUTSIDE of a bend, and nowhere a bend is tight', () => {
    let onBends = 0;
    for (const [name, profile] of ROUTES) {
      const origin = corridorOrigin(profile);
      for (const board of all(profile)) {
        const turn = turnAt(profile, origin, distanceOnRoute(profile, board.along)) ?? 0;
        expect(Math.abs(turn), name).toBeLessThanOrEqual(TIGHT_BEND_RADIANS_PER_METRE);
        if (Math.abs(turn) <= STRAIGHT_RADIANS_PER_METRE) continue;
        onBends += 1;
        // A turn toward the normal puts the inside on the normal's side.
        expect(board.side, name).toBe(turn > 0 ? -1 : 1);
      }
    }
    expect(onBends).toBeGreaterThanOrEqual(3);
  });

  it('is outside a circuit, measured from the circuit’s own middle', () => {
    // Independently of the turn's sign: a circuit's inside is toward its middle.
    for (const profile of [circuitRoute(400), circuitRoute(400, undefined, 'right')]) {
      const road = drawnRoad(profile);
      const middleX = road.reduce((sum, [x]) => sum + x, 0) / road.length;
      const middleZ = road.reduce((sum, [, z]) => sum + z, 0) / road.length;
      const boards = all(profile);
      expect(boards.length).toBeGreaterThan(0);
      for (const board of boards) {
        expect(Math.hypot(board.x - middleX, board.z - middleZ)).toBeGreaterThan(400);
      }
    }
  });

  it('stands none on a road that only ever bends tightly', () => {
    const coil = coilRoute();
    // Non-vacuity: the route is long enough for a site boundary.
    expect(
      Math.round((coil.totalDistance as number) / SETTLEMENT_SPACING_METRES),
    ).toBeGreaterThanOrEqual(2);
    expect(all(coil)).toEqual([]);
  });

  it('stands none facing the other leg of a hairpin, where it would be in the road', () => {
    // Both of this route's site boundaries hash the side facing the other leg
    // (measured: without the clearance each would stand 2.5 m from that leg's
    // centreline, in its carriageway), so the clearance leaves it none.
    expect(all(longHairpin())).toEqual([]);
  });

  it('reads a right-hand bend as turning toward the normal', () => {
    const right = circuitRoute(300, undefined, 'right');
    const left = circuitRoute(300);
    expect(turnAt(right, corridorOrigin(right), 500)).toBeGreaterThan(0);
    expect(turnAt(left, corridorOrigin(left), 500)).toBeLessThan(0);
    // About one over the radius.
    expect(turnAt(right, corridorOrigin(right), 500)).toBeCloseTo(1 / 300, 3);
  });

  it('meets no structure, and stands at its lateral, turned toward the rider', () => {
    for (const [name, profile] of ROUTES) {
      const origin = corridorOrigin(profile);
      const seed = scatterSeed(profile);
      for (const board of all(profile)) {
        const near = structuresAt(profile, origin, seed, board.along - 80, board.along + 80, {
          maxItems: Number.POSITIVE_INFINITY,
          riderMetres: board.along,
        });
        for (const item of near) {
          expect(
            footprintsMeet(
              board,
              BILLBOARD_FOOTPRINT,
              item,
              STRUCTURE_FOOTPRINTS[item.kind as keyof typeof STRUCTURE_FOOTPRINTS],
              STRUCTURE_MARGIN_METRES,
            ),
            `${name}: ${item.kind}`,
          ).toBe(false);
        }
        const frame = drawnRoadFrame(profile, origin, distanceOnRoute(profile, board.along));
        if (frame === undefined) throw new Error('no road');
        const lateral = (board.x - frame.x) * frame.normalX + (board.z - frame.z) * frame.normalZ;
        expect(lateral, name).toBeCloseTo(BILLBOARD_LATERAL_METRES * board.side, 6);
        // Its face is turned from the road's normal by the yaw, toward the
        // rider riding at it: against the road's direction.
        const faceX = Math.sin(board.rotation);
        const faceZ = Math.cos(board.rotation);
        const towardRoad = -(faceX * frame.normalX + faceZ * frame.normalZ) * board.side;
        expect(towardRoad, name).toBeCloseTo(Math.cos(BILLBOARD_YAW_RADIANS), 6);
        const alongRoad = faceX * frame.normalZ - faceZ * frame.normalX;
        expect(alongRoad, name).toBeCloseTo(-Math.sin(BILLBOARD_YAW_RADIANS), 6);
      }
    }
  });

  it('is a function of where it stands: a partition of the route, and the same on lap two', () => {
    for (const [name, profile] of ROUTES) {
      const origin = corridorOrigin(profile);
      const seed = scatterSeed(profile);
      const total = profile.totalDistance as number;
      const whole = billboardsAt(profile, origin, seed, 0, total);
      const split = [
        ...billboardsAt(profile, origin, seed, 0, total / 3),
        ...billboardsAt(profile, origin, seed, total / 3, total),
      ];
      expect(split, name).toEqual(whole);
      if (profile.loop) {
        const second = billboardsAt(profile, origin, seed, total, 2 * total);
        expect(
          second.map((each) => [each.x, each.z, each.rotation]),
          name,
        ).toEqual(whole.map((each) => [each.x, each.z, each.rotation]));
      }
    }
  });

  it('keeps the natural scenery off a billboard, and nothing else', () => {
    const board: Billboard = { x: 0, y: 0, z: 0, rotation: 0, along: 0, side: 1 };
    const item = (x: number, z: number): ScatterItem => ({
      kind: 'tree-broadleaf',
      x,
      y: 0,
      z,
      rotation: 0,
      scale: 1,
      variant: 0,
    });
    const reach = BILLBOARD_FOOTPRINT.x + SCENERY_MARGIN_METRES;
    const kept = clearOfBillboards(
      [item(0, 0), item(reach - 0.1, 0), item(reach + 0.1, 0), item(0, 4)],
      [board],
    );
    expect(kept.map((each) => [each.x, each.z])).toEqual([
      [reach + 0.1, 0],
      [0, 4],
    ]);
    expect(clearOfBillboards([item(0, 0)], [])).toHaveLength(1);
  });

  it('stands no post in the water, nor its middle (#966’s review)', () => {
    // Swept over seeds, because where a board stands is a hash of the seed and
    // a post beside a stream's bank is a narrow band: each post is found here
    // from the board's own pose and `logoBoxes`, and put back in the road's
    // frame by brute force against the drawn road — not by the placer's sums.
    let checked = 0;
    for (const [, profile] of ROUTES) {
      const ways = waterways(profile, scatterSeed(profile));
      if (ways.crossings.length + ways.lakes.length === 0) continue;
      const origin = corridorOrigin(profile);
      const total = profile.totalDistance as number;
      const road = drawnRoad(profile);
      const roadFrames = road.map((_, at) =>
        drawnRoadFrame(profile, origin, distanceOnRoute(profile, at)),
      );
      for (let seed = 0; seed < 400; seed += 1) {
        for (const board of billboardsAt(profile, origin, seed, 0, total)) {
          const sin = Math.sin(board.rotation);
          const cos = Math.cos(board.rotation);
          const feet = [
            [board.x, board.z],
            ...logoBoxes()
              .filter((box) => box.role === 'post')
              .map((box) => [
                board.x + box.x * cos + box.z * sin,
                board.z - box.x * sin + box.z * cos,
              ]),
          ];
          for (const [px = 0, pz = 0] of feet) {
            let nearest = 0;
            let best = Number.POSITIVE_INFINITY;
            road.forEach(([rx, rz], at) => {
              const d = Math.hypot(px - rx, pz - rz);
              if (d < best) {
                best = d;
                nearest = at;
              }
            });
            const frame = roadFrames[nearest];
            if (frame === undefined) continue;
            const lateral = (px - frame.x) * frame.normalX + (pz - frame.z) * frame.normalZ;
            expect(inWater(ways, profile, distanceOnRoute(profile, nearest), lateral)).toBe(false);
            checked += 1;
          }
        }
      }
    }
    // Something was checked: three feet a board, on routes that have water.
    expect(checked).toBeGreaterThan(300);
  }, 60_000);

  it('holds every box of the board inside the footprint it is cleared by', () => {
    for (const box of logoBoxes()) {
      expect(Math.abs(box.x) + box.width / 2).toBeLessThanOrEqual(BILLBOARD_FOOTPRINT.x);
      expect(box.z - box.depth / 2).toBeGreaterThanOrEqual(BILLBOARD_FOOTPRINT.back);
      expect(box.z + box.depth / 2).toBeLessThanOrEqual(BILLBOARD_FOOTPRINT.front);
    }
  });

  it('takes the nearest billboards a frame can draw, and never more than the belt holds', () => {
    // The gate's boards and the billboards together fit the belt, so its cut
    // never binds after the scenery has been cleared for a board.
    expect(GATE_LOGO_BOARDS_PER_FRAME + BILLBOARDS_PER_FRAME).toBeLessThanOrEqual(
      LOGO_BOARDS_PER_FRAME,
    );
    const many: Billboard[] = Array.from({ length: BILLBOARDS_PER_FRAME + 4 }, (_, at) => ({
      x: 0,
      y: 0,
      z: 0,
      rotation: 0,
      along: 1_000 + (at % 2 === 0 ? at : -at) * 30,
      side: 1,
    }));
    const kept = nearestBillboards(many, 1_000, 1_000);
    expect(kept).toHaveLength(BILLBOARDS_PER_FRAME);
    const furthestKept = Math.max(...kept.map((each) => Math.abs(each.along - 1_000)));
    const dropped = many.filter((each) => !kept.includes(each));
    for (const each of dropped) {
      expect(Math.abs(each.along - 1_000)).toBeGreaterThanOrEqual(furthestKept);
    }
    // The structure budget still binds first where it is the smaller.
    expect(nearestBillboards(many, 1_000, 2)).toHaveLength(2);
    expect(nearestBillboards(many, 1_000, 0)).toEqual([]);
  });

  it('never puts more boards in a frame than the belt holds, riding every fixture', () => {
    for (const [, profile] of ROUTES) {
      const origin = corridorOrigin(profile);
      const start = atStartLine(profile);
      const total = profile.totalDistance as number;
      // Two laps of a loop, so a short circuit's gate is seen lap after lap.
      const end = profile.loop ? 2 * total : total;
      for (let distance = 0; distance <= end; distance += 25) {
        const frame = sceneFrame({
          profile,
          origin,
          state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
        });
        const gates = frame.lines.filter(carriesTheLogo).length;
        expect(gates).toBeLessThanOrEqual(GATE_LOGO_BOARDS_PER_FRAME);
        expect(frame.billboards.length).toBeLessThanOrEqual(BILLBOARDS_PER_FRAME);
      }
    }
  }, 60_000);

  describe('in a frame', () => {
    // A level valley: structures beside the road, so the budget is shared.
    const profile = valleyRoute();
    const origin = corridorOrigin(profile);
    const start = atStartLine(profile);
    const at = all(profile)[0]?.along ?? Number.NaN;
    const frame = (structureItems?: number): ReturnType<typeof sceneFrame> =>
      sceneFrame({
        profile,
        origin,
        state: { ...start, ride: { ...start.ride, distance: metres(at - 60) } },
        structureItems,
      });
    const structures = (items: readonly ScatterItem[]): number =>
      items.filter((item) => (STRUCTURE_KINDS as readonly string[]).includes(item.kind)).length;

    it('carries the billboards in view', () => {
      expect(Number.isFinite(at)).toBe(true);
      expect(frame().billboards.map((each) => each.along)).toContain(at);
    });

    it('counts them in the structures budget, and none is ever extra', () => {
      const full = frame();
      const structuresInView = structures(full.scatter);
      expect(full.billboards.length).toBeGreaterThan(0);
      expect(structuresInView).toBeGreaterThan(0);
      // A budget that just holds everything holds it; one fewer drops a
      // STRUCTURE first, the billboard last, and the sum never exceeds it.
      const budget = structuresInView + full.billboards.length;
      expect(structures(frame(budget).scatter)).toBe(structuresInView);
      expect(frame(budget).billboards).toHaveLength(full.billboards.length);
      const tight = frame(budget - 1);
      expect(structures(tight.scatter) + tight.billboards.length).toBe(budget - 1);
      expect(tight.billboards).toHaveLength(full.billboards.length);
      expect(frame(0).billboards).toEqual([]);
      expect(structures(frame(0).scatter)).toBe(0);
    });

    it('keeps the frame’s natural scenery off them', () => {
      // On a circuit whose billboard has trees where it stands: the natural
      // scatter there holds some, and the frame holds none.
      const circuit = circuitRoute(400);
      const circuitOrigin = corridorOrigin(circuit);
      const seed = scatterSeed(circuit);
      const circuitStart = atStartLine(circuit);
      let cleared = 0;
      for (const board of all(circuit)) {
        const near = (items: readonly ScatterItem[]): number =>
          items.filter((item) =>
            footprintsMeet(
              board,
              BILLBOARD_FOOTPRINT,
              { x: item.x, z: item.z, rotation: 0 },
              { x: 0, back: 0, front: 0 },
              SCENERY_MARGIN_METRES,
            ),
          ).length;
        cleared += near(
          scatterAt(circuit, circuitOrigin, seed, board.along - 60, board.along + 60, {
            maxItems: 100_000,
            riderMetres: board.along,
          }),
        );
        const shown = sceneFrame({
          profile: circuit,
          origin: circuitOrigin,
          state: {
            ...circuitStart,
            ride: { ...circuitStart.ride, distance: metres(board.along - 60) },
          },
        });
        expect(shown.billboards.map((each) => each.along)).toContain(board.along);
        expect(near(shown.scatter)).toBe(0);
      }
      expect(cleared).toBeGreaterThan(0);
    });
  });
});
