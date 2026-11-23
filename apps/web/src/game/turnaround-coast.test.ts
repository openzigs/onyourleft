// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A one-point turnaround on a coast road whose two passes are not at one
 * height — #3103.
 *
 * The owner rode a 1.6 km copy of a saved coast route, cut either side of its
 * one-point 174° turnaround, and saw the ground beside the road stand over
 * it, with a step, and a flat strip of water above the road. A recorded ride
 * is not `outAndBackRoute`, whose height is a function of where a point is:
 * its way out and way back carry their own elevations, and the owner's read
 * +2.7 % before the turn and −0.5 % after it. So this fixture climbs 2.7 % to
 * a single vertex, turns 174° there, and comes back a lane over falling
 * 0.5 %, with the sea on both sides from 30 m out. Arithmetic only: no
 * coordinates or names of the owner's route.
 *
 * Read back through what a ride draws — `sceneFrame` handed the ride's mask,
 * as `GameView` hands it — at the drawn road's own rows (those whose road is
 * drawn: `RoadCorridor.retraced` 0) in the chase camera's view, 200 m either
 * side of the turn, the rider coming up to it and riding away. Measured before
 * the fix, on the return 3 m over: the ground 1.5 m over its neighbouring
 * vertex 4 cm away at the road's edge, where the way back's road begins; the
 * ground beside the way out up to 1.06 m over the road 6.6 m from its centre;
 * and the sea up to 0.83 m over the road it lies beside.
 */

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  routeProfile,
  type RoutePoint,
  type RouteProfile,
} from '@onyourleft/domain';

import { landBeside } from './footprint-fixtures-testing';
import { landClassMask, type LandClassMask } from './land-class';
import { RELIEF_CLEAR_METRES, TERRAIN_COLUMN_OFFSETS } from './landform';
import { FIXTURE_LATITUDE } from './route-fixtures-testing';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { ROAD_WIDTH_METRES, corridorOrigin, type CorridorPoint } from './terrain';

const METRES_PER_DEGREE_LATITUDE = 111_320;

/** How far the way out runs north before it turns. */
const LEG_METRES = 800;

/**
 * The fixture: north for {@link LEG_METRES} climbing 2.7 %, one vertex, and
 * back `lane` metres east falling 0.5 %, a point every 10 m. The first point
 * back is as far from the vertex as turns the road through 174° there.
 */
function coastReversal(lane: number): RouteProfile {
  const metresPerDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((FIXTURE_LATITUDE * Math.PI) / 180);
  const points: RoutePoint[] = [];
  const push = (north: number, east: number, elevation: number): void => {
    points.push({
      position: geographicPosition(
        degreesLatitude(FIXTURE_LATITUDE + north / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(-0.12 + east / metresPerDegreeLongitude),
      ),
      elevation: altitudeMetres(elevation),
    });
  };
  for (let north = 0; north <= LEG_METRES; north += 10) push(north, 0, 30 + 0.027 * north);
  const top = 30 + 0.027 * LEG_METRES;
  const back = LEG_METRES - lane / Math.tan((6 * Math.PI) / 180);
  for (let north = back; north >= 0; north -= 10) {
    push(north, lane, top - 0.005 * (LEG_METRES - north));
  }
  return routeProfile(points, { loop: false });
}

/** The sea both sides of the way out from 30 m, as a tile decodes it. */
function coast(profile: RouteProfile): LandClassMask {
  const origin = corridorOrigin(profile);
  const turn = profile.totalDistance / 2;
  return landClassMask({
    routeId: 'coast-reversal',
    origin,
    covered: () => true,
    coveredBoxes: [{ minX: -3_000, maxX: 3_000, minZ: -1_000, maxZ: 3_000 }],
    landUse: [
      landBeside(profile, origin, 'water', 'ocean', 50, turn - 2, 30, 400),
      landBeside(profile, origin, 'water', 'ocean', 50, turn - 2, -400, -30),
    ],
    buildings: [],
    paths: [],
    streets: [],
  });
}

/** The rider coming up to the turn and riding away, metres from it. */
const RIDER = [-200, -160, -120, -80, -40, -20, -10, 0, 10, 20, 40, 80, 120, 160];

/** How far either side of the turn is judged, along the route. */
const JUDGED_METRES = 200;

/** How far ahead of the chase camera is judged: past it the fog has the ground. */
const VIEW_METRES = 150;

const COLUMNS = TERRAIN_COLUMN_OFFSETS.length;

/** The columns within 30 m of the centreline: the road's edge out to 27 m. */
const NEAR_COLUMNS = TERRAIN_COLUMN_OFFSETS.filter((offset) => offset <= 30).length;

interface Judged {
  readonly frame: ReturnType<typeof sceneFrame>;
  /** The drawn road's segments in view near the turn: rows `[row, row + 1]`, both drawn. */
  readonly segments: readonly number[];
  /** Whether a row of the frame's corridor is in view, near the turn. */
  readonly near: (row: number) => boolean;
}

function judged(profile: RouteProfile, land: LandClassMask, odometer: number): Judged {
  const start = atStartLine(profile);
  const frame = sceneFrame({
    profile,
    origin: corridorOrigin(profile),
    state: { ...start, ride: { ...start.ride, distance: metres(odometer) } },
    landClass: land,
  });
  const turn = profile.totalDistance / 2;
  const { centre } = frame.corridor;
  const { camera } = frame;
  const near = (row: number): boolean => {
    const point = centre[row] as CorridorPoint;
    const ahead = (point.x - camera.x) * camera.headingX + (point.z - camera.z) * camera.headingZ;
    return Math.abs(point.distance - turn) <= JUDGED_METRES && ahead > 0 && ahead <= VIEW_METRES;
  };
  const segments: number[] = [];
  for (let row = 0; row + 1 < centre.length; row += 1) {
    if (frame.corridor.retraced[row] === 1 || frame.corridor.retraced[row + 1] === 1) continue;
    if (near(row) && near(row + 1)) segments.push(row);
  }
  return { frame, segments, near };
}

/**
 * The drawn road nearest `(x, z)` in plan among `segments`: how far, and its
 * height there. Written out here rather than asked of `landform.ts`, so the
 * oracle is not the code.
 */
function drawnRoadAt(
  centre: readonly CorridorPoint[],
  segments: readonly number[],
  x: number,
  z: number,
): { readonly across: number; readonly height: number } {
  let across = Number.POSITIVE_INFINITY;
  let height = Number.NaN;
  let beyond = false;
  for (const row of segments) {
    const from = centre[row] as CorridorPoint;
    const to = centre[row + 1] as CorridorPoint;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const span = dx * dx + dz * dz;
    const raw = span > 0 ? ((x - from.x) * dx + (z - from.z) * dz) / span : 0;
    const t = Math.min(1, Math.max(0, raw));
    const distance = Math.hypot(x - from.x - dx * t, z - from.z - dz * t);
    if (distance < across) {
      across = distance;
      height = from.y + (to.y - from.y) * t;
      beyond = raw < -0.01 || raw > 1.01;
    }
  }
  // Past the end of the judged road the nearest point is its last, whose
  // height is not the road's beside the point: not judged.
  return beyond ? { across: Number.POSITIVE_INFINITY, height } : { across, height };
}

describe('a one-point turnaround on a coast whose passes are not at one height — #3103', () => {
  it.each([1, 3])(
    'meets the drawn road with no step between neighbouring vertices, the way back %d m over',
    (lane) => {
      // Neighbouring vertices of the drawn ground — along a row and to the
      // next row — within 30 m of the road: no closer to vertical than 2 in 1
      // by more than 5 cm. The ground's own slopes, the verge's included, are
      // gentler; a step is not.
      const profile = coastReversal(lane);
      const land = coast(profile);
      let pairs = 0;
      for (const offset of RIDER) {
        const { frame, near } = judged(profile, land, profile.totalDistance / 2 + offset);
        const { vertices } = frame.terrain.mesh;
        const { centre } = frame.corridor;
        const at = (row: number, side: number, column: number): number =>
          (row * 2 * COLUMNS + side * COLUMNS + column) * 3;
        for (let row = 0; row + 1 < centre.length; row += 1) {
          if (!near(row)) continue;
          const road = (centre[row] as CorridorPoint).y;
          for (let side = 0; side < 2; side += 1) {
            for (let column = 0; column < NEAR_COLUMNS; column += 1) {
              const a = at(row, side, column);
              for (const b of [at(row + 1, side, column), at(row, side, column + 1)]) {
                const ay = vertices[a + 1] as number;
                const by = vertices[b + 1] as number;
                // A sunk point of another pass is not drawn ground (`landform.ts` §`retracedGround`).
                if (ay < road - 50 || by < road - 50) continue;
                const apart = Math.hypot(
                  (vertices[a] as number) - (vertices[b] as number),
                  (vertices[a + 2] as number) - (vertices[b + 2] as number),
                );
                pairs += 1;
                expect(
                  Math.abs(ay - by) - 2 * apart,
                  `${String(offset)} m from the turn, row ${String(row)}, side ${String(side)}, column ${String(column)}`,
                ).toBeLessThanOrEqual(0.05);
              }
            }
          }
        }
      }
      expect(pairs).toBeGreaterThan(5_000);
    },
  );

  it.each([1, 3])(
    'stands no ground over the drawn road within its clear band, the way back %d m over',
    (lane) => {
      // `landform.ts` rule 2: nothing rises above the road within
      // RELIEF_CLEAR_METRES of its centreline. Every vertex of the drawn
      // ground that far from the drawn road, whichever pass's it is, is at
      // the road's height there or under it — 5 cm for the float rounding.
      const profile = coastReversal(lane);
      const land = coast(profile);
      let judgedVertices = 0;
      let alongside = 0;
      for (const offset of RIDER) {
        const { frame, segments } = judged(profile, land, profile.totalDistance / 2 + offset);
        const { vertices } = frame.terrain.mesh;
        const { centre, retraced } = frame.corridor;
        for (let at = 0; at < vertices.length; at += 3) {
          const x = vertices[at] as number;
          const z = vertices[at + 2] as number;
          const road = drawnRoadAt(centre, segments, x, z);
          // Beside the road: from its edge out. (On the road, at the tip of
          // the U-turn, are the road's own folded edges.)
          if (!(road.across >= ROAD_WIDTH_METRES / 2 && road.across <= RELIEF_CLEAR_METRES)) {
            continue;
          }
          judgedVertices += 1;
          if (retraced[Math.floor(at / 3 / (2 * COLUMNS))] === 1) alongside += 1;
          expect(
            (vertices[at + 1] as number) - road.height,
            `${String(offset)} m from the turn, ${road.across.toFixed(1)} m from the road`,
          ).toBeLessThanOrEqual(0.05);
        }
      }
      expect(judgedVertices).toBeGreaterThan(2_000);
      // Non-vacuity: the other pass's ground is judged too, not only the drawn pass's.
      expect(alongside).toBeGreaterThan(50);
    },
  );

  it.each([1, 3])('draws no water above the road beside it, the way back %d m over', (lane) => {
    // Every vertex of the drawn water within 30 m of the drawn road is at its
    // height or under it.
    const profile = coastReversal(lane);
    const land = coast(profile);
    let judgedVertices = 0;
    for (const offset of RIDER) {
      const { frame, segments } = judged(profile, land, profile.totalDistance / 2 + offset);
      const { vertices, indices } = frame.water.surface;
      const used = new Set(indices);
      for (const index of used) {
        const at = index * 3;
        const road = drawnRoadAt(
          frame.corridor.centre,
          segments,
          vertices[at] as number,
          vertices[at + 2] as number,
        );
        if (!(road.across <= 30)) continue;
        judgedVertices += 1;
        expect(
          (vertices[at + 1] as number) - road.height,
          `${String(offset)} m from the turn, ${road.across.toFixed(1)} m from the road`,
        ).toBeLessThanOrEqual(0);
      }
    }
    // Non-vacuity: the sea is drawn beside the road in view.
    expect(judgedVertices).toBeGreaterThan(50);
  });
});
