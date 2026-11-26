// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The road's paint round a one-point turnaround holds still — #3254.
 *
 * After #3122 the owner still saw flashing coming up to a turnaround. A
 * 60 fps screen recording on the Pixel Tablet put every flash on the white
 * edge line where the way out and the way back meet: from frame ~2709 of the
 * turnaround recording, 89 frames in all, the end of the line changed length
 * and shape from one frame to the next while the road surface, the ground and
 * the scenery held still.
 *
 * The cause: a corridor's points are a fixed distance apart from wherever the
 * rider is, so they slide along the road with the rider. At a turning point
 * the drawn road's last ten metres either side of the turn are gathered into
 * its last metre, and the edge lines are laid across normals that swing
 * through half a turn over those few points, so the end of the road round the
 * turn was a different polygon on every frame (`terrain.ts`
 * §`steadiedAtTurns`).
 *
 * Read off what the renderer is handed — `sceneFrame`'s corridor, its
 * vertices and its index list — at 60 frames a second at 36 km/h: the paint,
 * the two edge lines and the centre-line marks, rasterised in plan on a 10 cm
 * lattice within {@link NEAR_TIP_METRES} of the turn. Measured before the
 * fix, on the way back 1, 3 and 5 m over: the paint there changed on every
 * one of the 300 frames from 80 m before the turn to 30 m before it, and of
 * the 300 from 30 m before it to 20 m after, 116, 135 and 138 held a
 * single-frame flash of more than {@link SPECK_CELLS} cells — cells painted
 * on one frame and on neither neighbour, or on both neighbours and not on it,
 * the recording's own test for a flash. After it: none changed, and none
 * flashed.
 *
 * Arithmetic only: no coordinates or names of the owner's route.
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

import { FIXTURE_LATITUDE } from './route-fixtures-testing';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { ROAD_COLUMNS, corridorOrigin } from './terrain';

const METRES_PER_DEGREE_LATITUDE = 111_320;

/**
 * The fixture: north 800 m climbing 2.7 %, one vertex, and back `lane` metres
 * east falling 0.5 %, a point every 10 m, turned through 174° at the vertex —
 * `turnaround-coast.test.ts` §`coastReversal`, without the sea.
 */
function reversal(lane: number): RouteProfile {
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
  const leg = 800;
  for (let north = 0; north <= leg; north += 10) push(north, 0, 30 + 0.027 * north);
  const top = 30 + 0.027 * leg;
  for (let north = leg - lane / Math.tan((6 * Math.PI) / 180); north >= 0; north -= 10) {
    push(north, lane, top - 0.005 * (leg - north));
  }
  return routeProfile(points, { loop: false });
}

/** How far each way of the way back is drawn from the way out, metres. */
const LANES = [1, 3, 5] as const;

/** 36 km/h at 60 frames a second, the recording's rate: metres a frame. */
const FRAME_METRES = 10 / 60;

/** How far from the tip of the turn the paint is read, in plan: metres. */
const NEAR_TIP_METRES = 30;

/**
 * How many lattice cells may flash on one frame and not count: **20**, 0.2 m²
 * of paint, a pixel or two on the tablet 20 m from the camera; the
 * recording's flash cells were 64 × 40 pixels.
 */
const SPECK_CELLS = 20;

/** The lattice the paint is read on, metres. */
const CELL_METRES = 0.1;

/**
 * Where the lattice sits off the whole decimetre, as a share of a cell: so
 * that no cell centre lies on the edge of a line drawn a whole number of
 * centimetres from a straight road's centreline, where Float32 rounding alone
 * would paint it on one frame and not the next.
 */
const CELL_PHASE = 0.37;

interface Ride {
  readonly profile: RouteProfile;
  readonly turn: number;
  readonly tipX: number;
  readonly tipZ: number;
}

function ride(lane: number): Ride {
  const profile = reversal(lane);
  const turn = profile.totalDistance / 2;
  // The tip in plan: the drawn road's point furthest north, as the frame at
  // the turn draws it.
  const { centre } = frameAt(profile, turn).corridor;
  const tip = centre.reduce((north, point) => (point.z > north.z ? point : north));
  return { profile, turn, tipX: tip.x, tipZ: tip.z };
}

function frameAt(profile: RouteProfile, odometer: number): ReturnType<typeof sceneFrame> {
  const start = atStartLine(profile);
  return sceneFrame({
    profile,
    origin: corridorOrigin(profile),
    state: { ...start, ride: { ...start.ride, distance: metres(odometer) } },
  });
}

/**
 * The paint the frame at `odometer` draws within {@link NEAR_TIP_METRES} of
 * the tip, as lattice cells: every triangle of the two edge lines' lanes and
 * of the centre-line marks that the index list draws (one folded to a point
 * draws nothing), rasterised in plan. The road's layout is `terrain.ts`'
 * own: three lanes of `centre.length - 1` quads, the outer two paint, then
 * the marks, two triangles each.
 */
function paintAt(at: Ride, odometer: number): Set<string> {
  const { corridor } = frameAt(at.profile, odometer);
  const { vertices, indices } = corridor;
  const segments = corridor.centre.length - 1;
  const lanes = ROAD_COLUMNS / 2;
  const painted: number[] = [];
  for (const lane of [0, lanes - 1]) painted.push(lane * segments * 6, (lane + 1) * segments * 6);
  painted.push(lanes * segments * 6, indices.length);
  const cells = new Set<string>();
  for (let range = 0; range < painted.length; range += 2) {
    for (let first = painted[range] as number; first < (painted[range + 1] as number); first += 3) {
      rasterise(at, vertices, indices, first, cells);
    }
  }
  return cells;
}

function rasterise(
  at: Ride,
  vertices: Float32Array,
  indices: Uint32Array,
  first: number,
  cells: Set<string>,
): void {
  const a = (indices[first] as number) * 3;
  const b = (indices[first + 1] as number) * 3;
  const c = (indices[first + 2] as number) * 3;
  const ax = vertices[a] as number;
  const az = vertices[a + 2] as number;
  const bx = vertices[b] as number;
  const bz = vertices[b + 2] as number;
  const cx = vertices[c] as number;
  const cz = vertices[c + 2] as number;
  const twice = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (!(Math.abs(twice) > 1e-12)) return;
  if (Math.hypot(ax - at.tipX, az - at.tipZ) > 2 * NEAR_TIP_METRES) return;
  const lattice = (value: number): number => value / CELL_METRES - CELL_PHASE;
  for (let i = Math.ceil(lattice(Math.min(ax, bx, cx))); i <= lattice(Math.max(ax, bx, cx)); i++) {
    for (
      let j = Math.ceil(lattice(Math.min(az, bz, cz)));
      j <= lattice(Math.max(az, bz, cz));
      j++
    ) {
      const x = (i + CELL_PHASE) * CELL_METRES;
      const z = (j + CELL_PHASE) * CELL_METRES;
      if (Math.hypot(x - at.tipX, z - at.tipZ) > NEAR_TIP_METRES) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / twice;
      const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / twice;
      if (u >= 0 && v >= 0 && u + v <= 1) cells.add(`${String(i)},${String(j)}`);
    }
  }
}

/** How many cells `from` and `to` disagree on. */
function changed(from: Set<string>, to: Set<string>): number {
  let count = 0;
  for (const cell of from) if (!to.has(cell)) count += 1;
  for (const cell of to) if (!from.has(cell)) count += 1;
  return count;
}

describe('the paint round a one-point turnaround holds still — #3254', () => {
  it.each(LANES)(
    'draws the same paint round the turn on every frame of the approach, the way back %d m over',
    (lane) => {
      // From 80 m before the turn to 30 m before it, before the frame changes
      // to the way back's pass (`terrain.ts` §`RETRACE_LOOK_AHEAD_METRES`):
      // nothing drawn near the turn moves, so neither may its paint.
      const at = ride(lane);
      let previous: Set<string> | undefined;
      let frames = 0;
      for (let odometer = at.turn - 80; odometer <= at.turn - 30; odometer += FRAME_METRES) {
        const paint = paintAt(at, odometer);
        // Non-vacuity: the edge lines and the marks up to the turn are read.
        expect(paint.size, `${(odometer - at.turn).toFixed(2)} m`).toBeGreaterThan(800);
        if (previous !== undefined) {
          expect(changed(previous, paint), `${(odometer - at.turn).toFixed(2)} m`).toBe(0);
        }
        previous = paint;
        frames += 1;
      }
      expect(frames).toBeGreaterThan(290);
    },
  );

  it.each(LANES)(
    'flashes no paint for a single frame through the turn, the way back %d m over',
    (lane) => {
      // From 30 m before the turn to 20 m after it, through the change of
      // pass and the swing round: a cell painted on one frame and on neither
      // neighbour, or on both and not on it, is a flash. More than
      // {@link SPECK_CELLS} of them on one frame is what the recording saw.
      const at = ride(lane);
      const odometers: number[] = [];
      for (let odometer = at.turn - 30; odometer <= at.turn + 20; odometer += FRAME_METRES) {
        odometers.push(odometer);
      }
      const paint = odometers.map((odometer) => paintAt(at, odometer));
      const flashes: string[] = [];
      for (let frame = 1; frame + 1 < paint.length; frame += 1) {
        const before = paint[frame - 1] as Set<string>;
        const here = paint[frame] as Set<string>;
        const after = paint[frame + 1] as Set<string>;
        let flashed = 0;
        for (const cell of here) if (!before.has(cell) && !after.has(cell)) flashed += 1;
        for (const cell of before) if (after.has(cell) && !here.has(cell)) flashed += 1;
        if (flashed > SPECK_CELLS) {
          flashes.push(
            `${((odometers[frame] as number) - at.turn).toFixed(2)} m: ${String(flashed)}`,
          );
        }
      }
      expect(flashes).toEqual([]);
      // Non-vacuity: the paint is read through the turn, and it does change
      // there — at the change of pass — so a reading that never changed
      // would not pass for one that holds still.
      expect(Math.min(...paint.map((cells) => cells.size))).toBeGreaterThan(800);
      let changes = 0;
      for (let frame = 1; frame < paint.length; frame += 1) {
        if (changed(paint[frame - 1] as Set<string>, paint[frame] as Set<string>) > 0) changes += 1;
      }
      expect(changes).toBeGreaterThan(0);
    },
  );
});
