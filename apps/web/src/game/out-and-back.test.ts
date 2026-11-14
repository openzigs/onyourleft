// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * An out-and-back — #1996: where the route comes back along itself, the road
 * is drawn once, one ground lies beside it, and the turning point is road and
 * verge rather than a hole with the horizon standing in it.
 *
 * Read off the frame the renderer is handed (`scene.ts` §`sceneFrame`): the
 * road's triangles (`RoadCorridor.indices`) and the ground's
 * (`TerrainMesh.indices`), over points in the chase camera's view on the
 * owner's 16 : 10 tablet. Measured on this fixture before #1996: the road
 * twice over up to 177 points of a frame's view, the two passes' grounds up
 * to 11 m apart under the same point, and past the turning point no ground at
 * all — 2 608 of 2 658 points of the view 20 m before it.
 */

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  routeProfile,
  type RouteProfile,
  type RoutePoint,
} from '@onyourleft/domain';

import { CAMERA_TARGET_AHEAD_METRES, horizontalSpread } from './camera';
import { NO_LAND_CLASS } from './land-class';
import {
  TERRAIN_COLUMN_OFFSETS,
  VERGE_DROP_METRES,
  standingOnGround,
  terrainHeightAt,
} from './landform';
import {
  circuitRoute,
  crossingRoute,
  hairpinRoute,
  lollipopRoute,
  northRoute,
  outAndBackRoute,
  plannerCornerRoute,
  plannerRoute,
} from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import {
  RETRACE_LOOK_AHEAD_METRES,
  corridorOrigin,
  ribbonNormals,
  roadCorridor,
  type CorridorPoint,
} from './terrain';

const COLUMNS = TERRAIN_COLUMN_OFFSETS.length;

/** The owner's tablet, 16 : 10: how far to each side the camera sees, per metre ahead. */
const SPREAD = horizontalSpread(16 / 10);

/** The frame at an odometer reading, as the renderer is handed it. */
function frameAt(
  profile: RouteProfile,
  at: number,
  extra: Partial<Parameters<typeof sceneFrame>[0]> = {},
): ReturnType<typeof sceneFrame> {
  const start = atStartLine(profile);
  return sceneFrame({
    profile,
    origin: corridorOrigin(profile),
    state: { ...start, ride: { ...start.ride, distance: metres(at) } },
    ...extra,
  });
}

interface Triangle {
  readonly ax: number;
  readonly ay: number;
  readonly az: number;
  readonly bx: number;
  readonly by: number;
  readonly bz: number;
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  /** The corridor row of its lowest-numbered vertex. */
  readonly row: number;
}

function triangles(
  vertices: Float32Array,
  indices: Uint32Array,
  perRow: number,
  count = indices.length,
): Triangle[] {
  const out: Triangle[] = [];
  for (let at = 0; at + 2 < count; at += 3) {
    const a = (indices[at] as number) * 3;
    const b = (indices[at + 1] as number) * 3;
    const c = (indices[at + 2] as number) * 3;
    out.push({
      ax: vertices[a] as number,
      ay: vertices[a + 1] as number,
      az: vertices[a + 2] as number,
      bx: vertices[b] as number,
      by: vertices[b + 1] as number,
      bz: vertices[b + 2] as number,
      cx: vertices[c] as number,
      cy: vertices[c + 1] as number,
      cz: vertices[c + 2] as number,
      row: Math.floor(Math.min(a, b, c) / 3 / perRow),
    });
  }
  return out;
}

/** Every triangle over a point in plan, edges included, and its height there. */
function over(
  all: readonly Triangle[],
  x: number,
  z: number,
): { readonly height: number; readonly row: number }[] {
  const found: { readonly height: number; readonly row: number }[] = [];
  for (const t of all) {
    if (
      x < Math.min(t.ax, t.bx, t.cx) ||
      x > Math.max(t.ax, t.bx, t.cx) ||
      z < Math.min(t.az, t.bz, t.cz) ||
      z > Math.max(t.az, t.bz, t.cz)
    ) {
      continue;
    }
    const area = (t.bx - t.ax) * (t.cz - t.az) - (t.cx - t.ax) * (t.bz - t.az);
    if (Math.abs(area) < 1e-9) continue;
    const u = ((t.bx - x) * (t.cz - z) - (t.cx - x) * (t.bz - z)) / area;
    const v = ((t.cx - x) * (t.az - z) - (t.ax - x) * (t.cz - z)) / area;
    const w = 1 - u - v;
    if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
    found.push({ height: u * t.ay + v * t.by + w * t.cy, row: t.row });
  }
  return found;
}

/** Points on the ground in front of the camera, every 4 m, out to `reach`, inside its view. */
function inView(
  camera: ReturnType<typeof sceneFrame>['camera'],
  reach = 150,
): { readonly x: number; readonly z: number; readonly ahead: number }[] {
  const points: { readonly x: number; readonly z: number; readonly ahead: number }[] = [];
  for (let ahead = 4; ahead <= reach; ahead += 4) {
    for (let across = -150; across <= 150; across += 4) {
      if (Math.abs(across) > ahead * SPREAD) continue;
      points.push({
        // Off the grid by a few centimetres, so no point lies on an edge.
        x: camera.x + camera.headingX * ahead - camera.headingZ * across + 0.013,
        z: camera.z + camera.headingZ * ahead + camera.headingX * across + 0.017,
        ahead,
      });
    }
  }
  return points;
}

/** The road's surface triangles — its three lanes, not its centre-line marks. */
function roadOf(frame: ReturnType<typeof sceneFrame>): Triangle[] {
  const rows = frame.corridor.centre.length;
  return triangles(frame.corridor.vertices, frame.corridor.indices, 6, (rows - 1) * 3 * 6);
}

function groundOf(frame: ReturnType<typeof sceneFrame>): Triangle[] {
  return triangles(frame.terrain.mesh.vertices, frame.terrain.mesh.indices, COLUMNS * 2);
}

const along = (frame: ReturnType<typeof sceneFrame>, row: number): number =>
  (frame.corridor.centre[row] as CorridorPoint).along;

const profile = outAndBackRoute();
/** The turning point, half way along. */
const turn = profile.totalDistance / 2;
/** The rider coming up to the turn, rounding it and riding away. */
const approach = [-200, -120, -60, -30, -12, -4];
const leaving = [4, 12, 30];

describe('an out-and-back draws its road once — #1996', () => {
  it('draws no point of the road twice, coming up to the turn and leaving it', () => {
    let both = 0;
    for (const offset of [...approach, ...leaving]) {
      const frame = frameAt(profile, turn + offset);
      const road = roadOf(frame);
      if (frame.corridor.retraced.includes(1)) both += 1;
      for (const point of inView(frame.camera)) {
        const alongs = over(road, point.x, point.z).map((hit) => along(frame, hit.row));
        expect(
          alongs.length < 2 || Math.max(...alongs) - Math.min(...alongs) < 20,
          `road twice ${String(offset)} m from the turn, ${String(point.ahead)} m ahead`,
        ).toBe(true);
      }
    }
    // Non-vacuity: every one of these frames holds both passes.
    expect(both).toBe(approach.length + leaving.length);
  }, 120_000);

  it('paints one dashed line down the shared road, not two', () => {
    // ⚠️ The doubled lane lines the owner saw: each pass paints its marks at
    // its own route distance, so two dashed lines out of step lay down one
    // road. One pass's marks are a period apart; two passes' interleave.
    for (const offset of [-200, -60, -12]) {
      const frame = frameAt(profile, turn + offset);
      const { corridor } = frame;
      const first = (corridor.centre.length - 1) * 3 * 6;
      const centres: { readonly x: number; readonly z: number }[] = [];
      for (let at = first; at + 5 < corridor.indices.length; at += 6) {
        const corners = [0, 1, 2, 4].map((k) => (corridor.indices[at + k] as number) * 3);
        const xs = corners.map((c) => corridor.vertices[c] as number);
        const zs = corners.map((c) => corridor.vertices[c + 2] as number);
        // A mark folded to nothing has no length.
        if (Math.max(...xs) - Math.min(...xs) + Math.max(...zs) - Math.min(...zs) < 0.5) continue;
        centres.push({ x: xs.reduce((a, b) => a + b) / 4, z: zs.reduce((a, b) => a + b) / 4 });
      }
      const tip = corridor.centre.reduce((far, point) => (point.z > far.z ? point : far));
      let close = 0;
      for (const [index, mark] of centres.entries()) {
        if (Math.hypot(mark.x - tip.x, mark.z - tip.z) < 20) continue;
        const neighbour = centres.some(
          (other, each) => each !== index && Math.hypot(other.x - mark.x, other.z - mark.z) < 6,
        );
        if (neighbour) close += 1;
      }
      expect(close, `${String(offset)} m from the turn`).toBe(0);
      expect(centres.length).toBeGreaterThan(20);
    }
  });

  it('always draws the road under the rider', () => {
    // ⚠️ The frame changes pass when the camera's target rounds the turn
    // (`terrain.ts` §`retracedRows`), so for the last 25 m to it the road
    // under the rider is the other pass's, in the same place. At the turning
    // point itself the drawn road stops at the first point clear of it, and
    // the rider can stand up to 20 cm past it, on the verge round its end.
    for (const offset of [...approach, -1, 0, 1, ...leaving]) {
      const frame = frameAt(profile, turn + offset);
      const rider = frame.markers[0] as { readonly x: number; readonly z: number };
      const road = roadOf(frame);
      const near = [0, 0.2, -0.2].some((dx) =>
        [0, 0.2, -0.2].some((dz) => over(road, rider.x + dx, rider.z + dz).length > 0),
      );
      expect(
        Math.abs(offset) <= 1 ? near : over(road, rider.x, rider.z).length > 0,
        `at ${String(offset)}`,
      ).toBe(true);
    }
  });

  it.each([
    ['a straight road', northRoute(3_000, () => 0)],
    ['a 25 m hairpin', hairpinRoute(25)],
    ['a planner’s 143° corner', plannerCornerRoute(143)],
    ['a planner’s road', plannerRoute()],
    ['a circuit, across its wrap', circuitRoute(120)],
  ])('marks nothing on a road ridden once: %s', (_name, once) => {
    for (let at = 0; at <= once.totalDistance * 2; at += 37) {
      expect(
        roadCorridor(once, corridorOrigin(once), at).retraced.includes(1),
        `at ${String(at)}`,
      ).toBe(false);
    }
  });

  it('changes pass cleanly: one pass’s road and ground, never neither, at the change', () => {
    // ⚠️ Where the camera's target is at the turn, every point of either pass
    // is about as far from it as the one beside it on the other, and to
    // rounding each was the nearer by turns (`terrain.ts` §`retracedRows`):
    // stretches of both passes not drawn at once, and holes in the view.
    const flip = turn - RETRACE_LOOK_AHEAD_METRES;
    for (let offset = -0.6; offset <= 0.6; offset += 0.1) {
      const frame = frameAt(profile, flip + offset);
      const road = roadOf(frame);
      const ground = groundOf(frame);
      for (const point of inView(frame.camera, 60)) {
        const roadHits = over(road, point.x, point.z);
        const alongs = roadHits.map((hit) => along(frame, hit.row));
        expect(
          alongs.length < 2 || Math.max(...alongs) - Math.min(...alongs) < 20,
          `road twice at ${offset.toFixed(1)}, ${String(point.ahead)} m ahead`,
        ).toBe(true);
        expect(
          roadHits.length + over(ground, point.x, point.z).length,
          `hole at ${offset.toFixed(1)}, ${String(point.ahead)} m ahead`,
        ).toBeGreaterThan(0);
      }
    }
  }, 120_000);

  it('changes pass where the camera looks', () => {
    // `terrain.ts` §`RETRACE_LOOK_AHEAD_METRES` is a copy of the camera's
    // target, and must stay one: measured from the rider, the camera turned
    // back down the way home while the way out was drawn, and saw past its
    // 60 m tail into no ground at all.
    expect(RETRACE_LOOK_AHEAD_METRES).toBe(CAMERA_TARGET_AHEAD_METRES);
  });

  it('marks nothing where a road only crosses itself', () => {
    // `terrain.ts` §`RETRACE_HEADING_COSINE`: a later pass across an earlier
    // one at right angles is within half a road of it where they cross, and
    // far along the road from it, and is not the same road ridden again —
    // taking it away left a gap in one road at the crossroads.
    const crossing = crossingRoute();
    let both = 0;
    for (let at = 60; at <= 300; at += 7) {
      const corridor = roadCorridor(crossing, corridorOrigin(crossing), at);
      const alongs = corridor.centre.map((point) => point.along);
      if (Math.min(...alongs) < 100 && Math.max(...alongs) > 500) both += 1;
      expect(corridor.retraced.includes(1), `at ${String(at)}`).toBe(false);
    }
    // Non-vacuity: corridors that hold both crossings of the one place.
    expect(both).toBeGreaterThan(5);
  });

  it('keeps the normal of the road arriving at the turning point', () => {
    // ⚠️ `terrain.ts` §`ribbonNormals`: the point the road turns back at took
    // its own segment's normal, facing the other way, and the quad from the
    // point before was a bow tie across the road.
    const corridor = roadCorridor(profile, corridorOrigin(profile), turn - 20);
    const normals = ribbonNormals(corridor.centre);
    const flips: number[] = [];
    for (let row = 1; row + 1 < corridor.centre.length; row += 1) {
      const dot =
        (normals[row * 2] as number) * (normals[row * 2 - 2] as number) +
        (normals[row * 2 + 1] as number) * (normals[row * 2 - 1] as number);
      if (dot < 0) flips.push(row);
    }
    // The road runs north to the turn, so the turning point is the
    // northernmost point; one flip, from it to the first point of the way back.
    const tip = corridor.centre.reduce(
      (north, point, row) => (point.z > (corridor.centre[north] as CorridorPoint).z ? row : north),
      0,
    );
    expect(flips).toEqual([tip + 1]);
  });
});

describe('one ground beside a road ridden twice — #1996', () => {
  it('lies one sheet deep wherever both passes are in view', () => {
    // Within 2 m under the top of the ground at any point, only one pass's
    // rows — no two rows more than 40 m apart along the road. Two grounds
    // there are two sheets at the heights each pass's route distance
    // invented, which pierce each other and fight for depth.
    for (const offset of [...approach, ...leaving]) {
      const frame = frameAt(profile, turn + offset);
      const ground = groundOf(frame);
      for (const point of inView(frame.camera)) {
        const hits = over(ground, point.x, point.z);
        if (hits.length < 2) continue;
        const top = Math.max(...hits.map((hit) => hit.height));
        const near = hits.filter((hit) => hit.height > top - 2).map((hit) => along(frame, hit.row));
        expect(
          Math.max(...near) - Math.min(...near),
          `${String(offset)} m from the turn, ${String(point.ahead)} m ahead`,
        ).toBeLessThan(40);
      }
    }
  }, 120_000);

  it.each([3])(
    'keeps a return %d m over clear of the nearer pass’s ground, never level with it',
    (lane) => {
      // A recorded return on the other side of the road. Where it only lies
      // alongside, both grounds are kept, so the nearer pass's U-turn is not
      // left open, and the other's lies under it: no point in view has the
      // two passes' grounds within half a metre of each other, where they
      // would fight for the same depth, or cross.
      const offsetRoute = outAndBackRoute({ offset: lane });
      const middle = offsetRoute.totalDistance / 2;
      let judged = 0;
      for (const offset of [...approach, ...leaving]) {
        // The camera on the drawn path (#2422). From there, 12 m after the
        // turn and 32 m ahead, the two grounds stood 0.434 m apart while the
        // other pass was drawn 1 m under (`landform.ts`
        // §`RETRACE_UNDER_METRES`, #2469).
        const frame = frameAt(offsetRoute, middle + offset);
        const ground = groundOf(frame);
        for (const point of inView(frame.camera, 100)) {
          const hits = over(ground, point.x, point.z);
          if (hits.length < 2) continue;
          const top = hits.reduce((high, hit) => (hit.height > high.height ? hit : high));
          const other = hits.filter(
            (hit) => Math.abs(along(frame, hit.row) - along(frame, top.row)) >= 40,
          );
          if (other.length === 0) continue;
          judged += 1;
          expect(
            top.height - Math.max(...other.map((hit) => hit.height)),
            `${String(offset)} m from the turn, ${String(point.ahead)} m ahead`,
          ).toBeGreaterThan(0.5);
        }
      }
      expect(judged).toBeGreaterThan(300);
    },
    120_000,
  );

  it('reads one height field: the return’s ground at a place is the outbound’s', () => {
    // `landform.ts` §`reliefFields`. The relief is keyed on the route
    // distance, so the way back invented other hills at the same place, up
    // to 24 m from the way out's, and the ground changed as the rider turned.
    const origin = corridorOrigin(profile);
    const seed = scatterSeed(profile);
    let worst = 0;
    for (const out of [200, 650, 1100, turn - 100, turn - 30, turn - 12, turn - 6, turn - 2]) {
      for (const lateral of [20, 60, 150, 300, -20, -60, -150, -300]) {
        const going = terrainHeightAt(profile, origin, seed, out, lateral, NO_LAND_CLASS);
        // The same place, ridden the other way: its right is the way out's left.
        const back = terrainHeightAt(
          profile,
          origin,
          seed,
          2 * turn - out,
          -lateral,
          NO_LAND_CLASS,
        );
        worst = Math.max(worst, Math.abs(going - back));
      }
    }
    expect(worst).toBeLessThan(0.1);
  });

  it('bounds the work a route that never leaves one place can ask for', () => {
    // `landform.ts` §`RETRACE_CELL_LIMIT`. The route is the rider's own file
    // (SECURITY.md: untrusted), and finding where it rides a road again
    // measured every segment against every earlier one in the same twenty
    // metres. 5 000 shuttles up and down 40 m — 20 000 segments in one place
    // — took 3.4 s on the first frame without the limit and 0.14 s with it,
    // measured; the bound is ten times the second and under half the first.
    const points: RoutePoint[] = [];
    for (let pass = 0; pass < 5_000; pass += 1) {
      for (let step = 0; step <= 4; step += 1) {
        const north = pass % 2 === 0 ? step * 10 : 40 - step * 10;
        points.push({
          position: geographicPosition(
            degreesLatitude(51.5 + north / 111_320),
            degreesLongitude(-0.12),
          ),
          elevation: altitudeMetres(30 + 0.01 * pass),
        });
      }
    }
    const shuttle = routeProfile(points, { loop: false });
    const started = performance.now();
    const height = terrainHeightAt(shuttle, corridorOrigin(shuttle), 1, 20, 50, NO_LAND_CLASS);
    expect(Number.isFinite(height)).toBe(true);
    expect(performance.now() - started).toBeLessThan(1_500);
  }, 60_000);

  it('blends a later pass into the road it joins, with no step in the ground', () => {
    // `landform.ts` §`RETRACE_BLEND_METRES`. Where the way back JOINS the way
    // out rather than turning back along it, the place its relief is read
    // jumps from its own to the way out's: read straight across, the ground
    // stepped there by the difference of two invented hills.
    const lollipop = lollipopRoute();
    const origin = corridorOrigin(lollipop);
    const seed = scatterSeed(lollipop);
    // The way back runs down the stem's 1 000 m to the end.
    const joins = lollipop.totalDistance - 1_000;
    const worstStep = (from: number, to: number, lateral: number): number => {
      let worst = 0;
      let before = terrainHeightAt(lollipop, origin, seed, from, lateral, NO_LAND_CLASS);
      for (let at = from + 2; at <= to; at += 2) {
        const here = terrainHeightAt(lollipop, origin, seed, at, lateral, NO_LAND_CLASS);
        worst = Math.max(worst, Math.abs(here - before));
        before = here;
      }
      return worst;
    };
    for (const lateral of [-150, -60, 60, 150]) {
      // The relief's own steepest change along a stretch ridden once.
      const own = worstStep(200, 800, lateral);
      expect(worstStep(joins - 200, joins + 200, lateral), `${String(lateral)} m out`).toBeLessThan(
        2 * own + 0.05,
      );
    }
    // Non-vacuity: the stem is read as the way out's on the way back.
    for (const lateral of [60, 150]) {
      const going = terrainHeightAt(lollipop, origin, seed, 500, lateral, NO_LAND_CLASS);
      const back = terrainHeightAt(
        lollipop,
        origin,
        seed,
        lollipop.totalDistance - 500,
        -lateral,
        NO_LAND_CLASS,
      );
      expect(Math.abs(going - back)).toBeLessThan(0.1);
    }
  });

  it('does not change the ground in view as the rider rounds the turn', () => {
    // The frame draws one pass, and changes pass as the camera's target
    // rounds the turn: on two height fields every hill in view became another.
    const flip = turn - RETRACE_LOOK_AHEAD_METRES;
    // ⚠️ Each frame's triangles read before the next is built: the ground's
    // arrays are lent (`landform.ts` §`TerrainMesh.lease`), and the second
    // build writes over the first's.
    const before = frameAt(profile, flip - 8);
    const groundBefore = groundOf(before);
    const after = frameAt(profile, flip + 8);
    const groundAfter = groundOf(after);
    // Non-vacuity: the two frames draw different passes.
    const drawnPass = (frame: ReturnType<typeof sceneFrame>): number =>
      frame.corridor.retraced[
        frame.corridor.centre.findIndex((point) => point.along > turn + 20)
      ] as number;
    expect([drawnPass(before), drawnPass(after)]).toEqual([1, 0]);
    let compared = 0;
    let worst = 0;
    let where = '';
    // Over what both frames' cameras see: the camera moves on 16 m between them.
    for (const point of inView(after.camera)) {
      const a = over(groundBefore, point.x, point.z);
      const b = over(groundAfter, point.x, point.z);
      if (a.length === 0 || b.length === 0) continue;
      compared += 1;
      const gap = Math.abs(
        Math.max(...a.map((hit) => hit.height)) - Math.max(...b.map((hit) => hit.height)),
      );
      if (gap > worst) {
        worst = gap;
        where = `${String(point.ahead)} m ahead at ${point.x.toFixed(1)}, ${point.z.toFixed(1)}: ${Math.max(...a.map((hit) => hit.height)).toFixed(2)} vs ${Math.max(...b.map((hit) => hit.height)).toFixed(2)}`;
      }
    }
    expect(compared).toBeGreaterThan(800);
    expect(worst, where).toBeLessThan(0.75);
  }, 120_000);
});

describe('the turning point is road and verge, not a wall — #1996', () => {
  it('leaves no point of the view without road or ground, coming up to the turn', () => {
    // ⚠️ Before #1996 every row's ground was a cross-section of the road, so
    // past the turning point there was none, and the horizon's skirt stood in
    // the hole as a wall of hillside until the camera came round.
    let looked = 0;
    for (const offset of [-150, -100, -60, -30, -20, -12, -6, -2, 2, 6, 12]) {
      const frame = frameAt(profile, turn + offset);
      const road = roadOf(frame);
      const ground = groundOf(frame);
      for (const point of inView(frame.camera)) {
        looked += 1;
        expect(
          over(road, point.x, point.z).length + over(ground, point.x, point.z).length,
          `hole ${String(offset)} m from the turn, ${String(point.ahead)} m ahead`,
        ).toBeGreaterThan(0);
      }
    }
    expect(looked).toBeGreaterThan(15_000);
  }, 120_000);

  it.each([1, 2])(
    'leaves no hole in view coming up to the turn of a return %d m over',
    (lane) => {
      // ⚠️ `landform.ts` §`UNFOLDED_NEAR_TURN_ROWS`. A return
      // a lane over turns round a small U of its own, and the drawn rows of
      // the way out bend into it: their inside folded in to 22 m and tapered
      // back out over 200 m, a hole 60 m across beside the road ahead where
      // the way back's ground, sunk, had covered it.
      const offsetRoute = outAndBackRoute({ offset: lane });
      const middle = offsetRoute.totalDistance / 2;
      for (const offset of [-150, -120, -90, -60, -40]) {
        const frame = frameAt(offsetRoute, middle + offset);
        const road = roadOf(frame);
        const ground = groundOf(frame);
        for (const point of inView(frame.camera)) {
          expect(
            over(road, point.x, point.z).length + over(ground, point.x, point.z).length,
            `hole ${String(offset)} m from the turn, ${String(point.ahead)} m ahead`,
          ).toBeGreaterThan(0);
        }
      }
    },
    120_000,
  );

  it('stands no ground on end in the near view', () => {
    // No triangle within 80 m ahead steeper than |ny| 0.3 drawn on top —
    // under no other ground and no road — taller than the road's 25 cm verge.
    for (const offset of [-60, -30, -12, -4, 4, 12]) {
      const frame = frameAt(profile, turn + offset);
      const { camera } = frame;
      const road = roadOf(frame);
      const ground = groundOf(frame);
      for (const t of ground) {
        const x = (t.ax + t.bx + t.cx) / 3;
        const z = (t.az + t.bz + t.cz) / 3;
        const ahead = (x - camera.x) * camera.headingX + (z - camera.z) * camera.headingZ;
        const across = (x - camera.x) * -camera.headingZ + (z - camera.z) * camera.headingX;
        if (!(ahead > 0 && ahead < 80 && Math.abs(across) < ahead * SPREAD)) continue;
        if (Math.max(t.ay, t.by, t.cy) - Math.min(t.ay, t.by, t.cy) <= VERGE_DROP_METRES + 0.01) {
          continue;
        }
        const ex = [t.bx - t.ax, t.by - t.ay, t.bz - t.az] as const;
        const fx = [t.cx - t.ax, t.cy - t.ay, t.cz - t.az] as const;
        const nx = ex[1] * fx[2] - ex[2] * fx[1];
        const ny = ex[2] * fx[0] - ex[0] * fx[2];
        const nz = ex[0] * fx[1] - ex[1] * fx[0];
        const length = Math.hypot(nx, ny, nz);
        if (length < 1e-3 || Math.abs(ny) / length >= 0.3) continue;
        const y = (t.ay + t.by + t.cy) / 3;
        const above = [...over(ground, x, z), ...over(road, x, z)].some(
          (hit) => hit.height > y + 0.05,
        );
        expect(above, `a wall ${String(offset)} m from the turn, ${ahead.toFixed(1)} m ahead`).toBe(
          true,
        );
      }
    }
  }, 120_000);

  it('lays a verge past the end of the road', () => {
    // Where the road stops, the ground beyond is the verge's, a quarter of a
    // metre under it — not the relief, not a hole.
    const frame = frameAt(profile, turn - 30);
    const { corridor } = frame;
    const ground = groundOf(frame);
    const road = roadOf(frame);
    // The last drawn point of the way out, and its heading.
    const last = corridor.retraced.indexOf(1) - 1;
    const end = corridor.centre[last] as CorridorPoint;
    const before = corridor.centre[last - 3] as CorridorPoint;
    const headingX = end.x - before.x;
    const headingZ = end.z - before.z;
    const length = Math.hypot(headingX, headingZ);
    let checked = 0;
    for (let ahead = 0.5; ahead <= 3.5; ahead += 0.5) {
      for (const across of [-3, -1.5, 0, 1.5, 3]) {
        const x = end.x + (headingX * ahead - headingZ * across) / length + 0.013;
        const z = end.z + (headingZ * ahead + headingX * across) / length + 0.017;
        if (over(road, x, z).length > 0) continue;
        const hits = over(ground, x, z);
        expect(hits.length, `${String(ahead)} m past the end`).toBeGreaterThan(0);
        expect(Math.max(...hits.map((hit) => hit.height))).toBeCloseTo(
          end.y - VERGE_DROP_METRES,
          1,
        );
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('stands a thing past the end of the road on the ground drawn there', () => {
    // `landform.ts` §`rowCrossings` reads a row's cross-section off its right
    // side, which is where a turned row's triangles are. Read off the road's
    // two edges, every turned row had its anchor's cross-section, the ground
    // past the road's end was never asked about, and a thing standing there
    // was dropped or stood on the sunk skirt under it.
    const frame = frameAt(profile, turn - 30);
    const { corridor } = frame;
    const mesh = frame.terrain.mesh;
    const ground = groundOf(frame);
    const last = corridor.retraced.indexOf(1) - 1;
    const end = corridor.centre[last] as CorridorPoint;
    const before = corridor.centre[last - 3] as CorridorPoint;
    const length = Math.hypot(end.x - before.x, end.z - before.z);
    const headingX = (end.x - before.x) / length;
    const headingZ = (end.z - before.z) / length;
    const items: { readonly x: number; readonly y: number; readonly z: number }[] = [];
    for (const [ahead, across] of [
      [15, 0],
      [30, 20],
      [60, -40],
      [8, 25],
      [100, 10],
    ] as const) {
      items.push({
        x: end.x + headingX * ahead - headingZ * across,
        y: 0,
        z: end.z + headingZ * ahead + headingX * across,
      });
    }
    const standing = standingOnGround(items, mesh);
    expect(standing).toHaveLength(items.length);
    for (const item of standing) {
      const top = Math.max(...over(ground, item.x, item.z).map((hit) => hit.height));
      expect(item.y).toBeCloseTo(top, 3);
      expect(item.y).toBeGreaterThan(end.y - 50);
    }
  });

  it('lights the ground beside the turning point as ground, not as a cliff', () => {
    // `landform.ts` §`gridNormals` reads a drawn row against no neighbour that
    // is not drawn with it. Read against a sunk row's point 200 m under the
    // road, the drawn row's normals lay nearly flat, and the row lit as a
    // cliff face along the end of the drawn ground.
    for (const offset of [-60, -20, 10]) {
      const frame = frameAt(profile, turn + offset);
      const { vertices, normals } = frame.terrain.mesh;
      const road = (frame.corridor.centre[0] as CorridorPoint).y;
      let lit = 0;
      for (let at = 0; at * 3 < vertices.length; at += 1) {
        if ((vertices[at * 3 + 1] as number) < road - 100) continue;
        lit += 1;
        expect(normals[at * 3 + 1] as number, `vertex ${String(at)}`).toBeGreaterThan(0.6);
      }
      expect(lit).toBeGreaterThan(1_000);
    }
  });

  it('draws no more geometry than a road ridden once', () => {
    // The tablet's budget is not re-read because nothing grows: every row
    // and index of both meshes is the one-pass frame's, some folded to nothing.
    const once = frameAt(profile, 400);
    const twice = frameAt(profile, turn - 30);
    expect(once.corridor.retraced.includes(1)).toBe(false);
    expect(twice.corridor.indices.length).toBe(once.corridor.indices.length);
    expect(twice.corridor.vertices.length).toBe(once.corridor.vertices.length);
    expect(twice.terrain.mesh.indices.length).toBe(once.terrain.mesh.indices.length);
    expect(twice.terrain.mesh.vertices.length).toBe(once.terrain.mesh.vertices.length);
  });
});
