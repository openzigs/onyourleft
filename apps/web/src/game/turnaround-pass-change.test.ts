// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The pass change before a one-point turnaround, ridden frame by frame — #3061.
 *
 * Coming up to a turning point the frame changes which pass of the road it
 * draws when the camera's target rounds the turn, 25 m before it (#1996,
 * `terrain.ts` §`retracedRows`). On `route-fixtures-testing.ts`
 * §`reversalRoute` — a 172° turn at one recorded point, the shape of the
 * owner's turnaround — the return lies up to half the road to one side there.
 * Measured before #3061, on the frames `scene.ts` §`sceneFrame` hands the
 * renderer: the road under the rider moved sideways by 1.7 m (to the right)
 * and 1.3 m (to the left) in the frame of the change, and for the last 24 m
 * the drawn rider was up to 4.6 m and 5.2 m from the drawn road's centreline,
 * past its 3.5 m edge. `terrain.ts` §`towardTheRidersPass` and §`tipBetween`
 * are the change.
 */

import { describe, expect, it } from 'vitest';

import { metres, type RouteProfile } from '@onyourleft/domain';

import { TERRAIN_COLUMN_OFFSETS } from './landform';
import { REVERSAL_AT_METRES, reversalRoute } from './route-fixtures-testing';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { ROAD_COLUMNS, ROAD_WIDTH_METRES, corridorOrigin, type CorridorPoint } from './terrain';

/** One piece of the drawn road's centreline, in plan. */
interface Piece {
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
}

/**
 * The drawn road's centreline, read off the vertices and indices the renderer
 * is handed: the middle of each row's two outer columns, for every piece of
 * the carriageway (`terrain.ts` §`roadIndices`' middle lane) that is not
 * folded to nothing.
 */
function drawnCentreline(frame: ReturnType<typeof sceneFrame>): Piece[] {
  const { corridor } = frame;
  const segments = corridor.centre.length - 1;
  const { vertices, indices } = corridor;
  const middle = (row: number): { readonly x: number; readonly z: number } => {
    const left = row * ROAD_COLUMNS * 3;
    const right = (row * ROAD_COLUMNS + ROAD_COLUMNS - 1) * 3;
    return {
      x: ((vertices[left] as number) + (vertices[right] as number)) / 2,
      z: ((vertices[left + 2] as number) + (vertices[right + 2] as number)) / 2,
    };
  };
  const pieces: Piece[] = [];
  for (let segment = 0; segment < segments; segment += 1) {
    const at = (segments + segment) * 6;
    const quad = indices.subarray(at, at + 6);
    if (quad.every((index) => index === quad[0])) continue;
    const a = middle(segment);
    const b = middle(segment + 1);
    pieces.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
  }
  return pieces;
}

/** How far a point is from the nearest piece of a centreline, metres. */
function distanceTo(pieces: readonly Piece[], x: number, z: number): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const piece of pieces) {
    const dx = piece.bx - piece.ax;
    const dz = piece.bz - piece.az;
    const span = dx * dx + dz * dz;
    const t =
      span > 0 ? Math.min(1, Math.max(0, ((x - piece.ax) * dx + (z - piece.az) * dz) / span)) : 0;
    nearest = Math.min(nearest, Math.hypot(x - piece.ax - dx * t, z - piece.az - dz * t));
  }
  return nearest;
}

/** What riding round the turn did, frame by frame. */
interface Ridden {
  /** The furthest the drawn rider was from the drawn road's centreline, metres. */
  readonly furthestOff: number;
  /**
   * The most the drawn road moved under the drawn rider between two frames:
   * how much nearer or further the rider was from this frame's centreline
   * than, at the same place, from the last frame's, metres.
   */
  readonly mostMoved: number;
  /** How many frames drew the way back at the point beside the rider's turn, as a control. */
  readonly changed: number;
}

/** The drawn rider's place, from the frame. */
function riderOf(frame: ReturnType<typeof sceneFrame>): { readonly x: number; readonly z: number } {
  return frame.markers[0] as { readonly x: number; readonly z: number };
}

/**
 * Rides the last `window` metres up to the turn and 10 m on round it at
 * 30 km/h, 60 frames a second, as `GameView` hands `sceneFrame` its odometer.
 */
function rideRoundTheTurn(profile: RouteProfile, window: number): Ridden {
  const origin = corridorOrigin(profile);
  const start = atStartLine(profile);
  const step = 30 / 3.6 / 60;
  let last: readonly Piece[] | undefined;
  let furthestOff = 0;
  let mostMoved = 0;
  let changed = 0;
  for (let along = REVERSAL_AT_METRES - window; along < REVERSAL_AT_METRES + 10; along += step) {
    const frame = sceneFrame({
      profile,
      origin,
      state: { ...start, ride: { ...start.ride, distance: metres(along) } },
    });
    const rider = riderOf(frame);
    const road = drawnCentreline(frame);
    const off = distanceTo(road, rider.x, rider.z);
    furthestOff = Math.max(furthestOff, off);
    if (last !== undefined) {
      mostMoved = Math.max(mostMoved, Math.abs(off - distanceTo(last, rider.x, rider.z)));
    }
    last = road;
    // The way back's point 20 m past the turn is drawn: the frame has changed pass.
    const { centre, retraced } = frame.corridor;
    const back = centre.findIndex((point: CorridorPoint) => point.along > REVERSAL_AT_METRES + 20);
    if (back >= 0 && retraced[back] === 0) changed += 1;
  }
  return { furthestOff, mostMoved, changed };
}

/**
 * The most the drawn road may move under the rider from one frame to the
 * next, metres: **0.2**. Measured at the change on these frames, 0.12 m; it
 * was 1.7 m and 1.3 m.
 */
const MOST_MOVED_METRES = 0.2;

describe('the pass change before a one-point turnaround — #3061', () => {
  it.each([
    ['to the right, as the owner’s', 'right'],
    ['to the left', 'left'],
  ] as const)(
    'keeps the drawn rider on the drawn road, and the road still under them, turning 172° %s',
    (_name, hand) => {
      const ridden = rideRoundTheTurn(reversalRoute(172, hand), 30);
      expect(ridden.furthestOff).toBeLessThan(ROAD_WIDTH_METRES / 2);
      expect(ridden.mostMoved).toBeLessThan(MOST_MOVED_METRES);
      // Non-vacuity: the frame changes pass in this window, and draws the
      // way back for the last 25 m of it.
      expect(ridden.changed).toBeGreaterThan(150);
    },
  );

  it.each([
    ['to the right, as the owner’s', 'right'],
    ['to the left', 'left'],
  ] as const)(
    'draws a bot already on the way back on the moved road, turning 172° %s',
    (_name, hand) => {
      // #3073's review: the road is moved for the rider coming up to the
      // turn, and a bot already round it is drawn on the way back's drawn
      // line, which is where that pass is recorded. It must be moved with it.
      const profile = reversalRoute(172, hand);
      const origin = corridorOrigin(profile);
      const start = atStartLine(profile);
      let furthestOff = 0;
      let frames = 0;
      for (let before = 1; before <= 24; before += 1) {
        for (let past = 3; past <= 20; past += 1) {
          const frame = sceneFrame({
            profile,
            origin,
            state: {
              ...start,
              ride: { ...start.ride, distance: metres(REVERSAL_AT_METRES - before) },
            },
            botDistance: REVERSAL_AT_METRES + past,
          });
          const bot = frame.markers.find((marker) => marker.kind === 'bot');
          if (bot === undefined) continue;
          frames += 1;
          furthestOff = Math.max(furthestOff, distanceTo(drawnCentreline(frame), bot.x, bot.z));
        }
      }
      expect(frames).toBe(24 * 18);
      expect(furthestOff).toBeLessThan(ROAD_WIDTH_METRES / 2);
    },
  );

  it('lays the ground beside the road where it is moved, to the bit', () => {
    // ⚠️ The ground is built on the corridor's points and their own normals
    // (`landform.ts` §`terrainCorridor`). Laid across the normals of the
    // points before they were moved, the road's edge stood off the ground's
    // first column where the far pass bends back to its own place.
    const profile = reversalRoute(172, 'right');
    const origin = corridorOrigin(profile);
    const at = REVERSAL_AT_METRES - 15;
    const frame = sceneFrame({
      profile,
      origin,
      state: {
        ...atStartLine(profile),
        ride: { ...atStartLine(profile).ride, distance: metres(at) },
      },
    });
    const { corridor } = frame;
    const ground = frame.terrain.mesh;
    const columns = TERRAIN_COLUMN_OFFSETS.length;
    // Non-vacuity: points the move took off their own place.
    let moved = 0;
    for (let row = 0; row < corridor.centre.length; row += 1) {
      const point = corridor.centre[row] as CorridorPoint;
      // The way back's drawn points clear of the turn, whose own rows the
      // ground turns round its end (`landform.ts` §`retracedRoles`).
      if (corridor.retraced[row] === 1 || !(point.along > REVERSAL_AT_METRES + 6)) continue;
      // Its own place is 0.14 m off the way out for every metre from the turn;
      // moved, it lies on the way out.
      if (Math.abs(point.x) < 0.1 * (point.along - REVERSAL_AT_METRES)) moved += 1;
      for (const [side, column] of [
        [0, 0],
        [1, ROAD_COLUMNS - 1],
      ] as const) {
        const road = (row * ROAD_COLUMNS + column) * 3;
        const edge = (row * columns * 2 + side * columns) * 3;
        expect(ground.vertices[edge], `row ${String(row)}`).toBe(corridor.vertices[road]);
        expect(ground.vertices[edge + 2], `row ${String(row)}`).toBe(corridor.vertices[road + 2]);
      }
    }
    expect(moved).toBeGreaterThan(5);
  });
});
