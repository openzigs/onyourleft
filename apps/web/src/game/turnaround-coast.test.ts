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
 *
 * ## #3122: one surface between the passes, and the camera behind the rider
 *
 * The owner rode it again with #3103's fix and saw a trench and a wall beside
 * the turn, flashing as they came up to it, and the camera drop beside them in
 * the turn. Read off the same frames:
 *
 * - **The surface a rider sees**: the topmost of the ground and the road, on a
 *   half-metre lattice within {@link BESIDE_METRES} of either pass. Measured
 *   before the fix, on the return 3 m over seen from 80 m and 120 m back: the
 *   ground 1.65 m under the drawn road 9.5 m from it, beside the turn, and a
 *   1.05 m step between two points half a metre apart — the pass alongside,
 *   drawn 1.5 m under, showing inside the nearer pass's U-turn where that
 *   pass's ground is folded away (`landform.ts` §`coveredShare`).
 * - **The camera**, composed between frames as `GameView` composes it. Before
 *   the fix its eye was 1.2 m behind the rider and 1.9 m to their side through
 *   the turn, and its step from one frame to the next changed by 0.3 m at
 *   once (`scene.ts` §`U_TURN_CAMERA_METRES`).
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

import {
  CAMERA_ABOVE_METRES,
  CAMERA_BEHIND_METRES,
  cameraRig,
  dampedHeading,
  dampedLookAhead,
  turnedPose,
  type GroundHeading,
} from './camera';
import { FOUNDATION_METRES } from './buildings';
import { footprintPlans } from './footprint-buildings';
import { buildingBeside, landBeside, rectangleBeside } from './footprint-fixtures-testing';
import { landClassMask, type LandClassMask } from './land-class';
import {
  RELIEF_CLEAR_METRES,
  TERRAIN_COLUMN_OFFSETS,
  VERGE_DROP_METRES,
  standingOnGround,
} from './landform';
import { FIXTURE_LATITUDE } from './route-fixtures-testing';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { ROAD_COLUMNS, ROAD_WIDTH_METRES, corridorOrigin, type CorridorPoint } from './terrain';

const METRES_PER_DEGREE_LATITUDE = 111_320;

/** How far the way out runs north before it turns. */
const LEG_METRES = 800;

/**
 * The fixture: north for {@link LEG_METRES} (or `leg`) climbing 2.7 % (or
 * `climb`), one vertex, and back `lane` metres east falling 0.5 %, a point
 * every 10 m. The first point back is as far from the vertex as turns the
 * road through 174° there.
 */
function coastReversal(lane: number, loop = false, leg = LEG_METRES, climb = 0.027): RouteProfile {
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
  for (let north = 0; north <= leg; north += 10) push(north, 0, 30 + climb * north);
  const top = 30 + climb * leg;
  const back = leg - lane / Math.tan((6 * Math.PI) / 180);
  for (let north = back; north >= 0; north -= 10) {
    push(north, lane, top - 0.005 * (leg - north));
  }
  return routeProfile(points, { loop });
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
    // height or under it. ⚠️ #3140: on the climbing way out, and on one
    // level all the way out. The way back is drawn at the way out's heights
    // (`landform.ts` §`drawnProfileOf`), and a mapped sea is drawn only
    // beside a run of road no steeper than `waterways.ts` §`LAKE_MAX_GRADE_PERCENT`:
    // so the climbing fixture now draws none — before, it drew one off the
    // way back's own −0.5 % — and the level one is where water is judged.
    let judgedVertices = 0;
    let levelVertices = 0;
    for (const climb of [0.027, 0]) {
      const profile = coastReversal(lane, false, LEG_METRES, climb);
      const land = coast(profile);
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
          if (climb === 0) levelVertices += 1;
          expect(
            (vertices[at + 1] as number) - road.height,
            `${String(offset)} m from the turn, ${road.across.toFixed(1)} m from the road`,
          ).toBeLessThanOrEqual(0);
        }
      }
    }
    // Non-vacuity: the sea is drawn beside the road in view.
    expect(judgedVertices).toBeGreaterThan(50);
    expect(levelVertices).toBeGreaterThan(50);
  });
});

/** A triangle of a drawn mesh, in plan with its three heights. */
interface Facet {
  readonly ax: number;
  readonly az: number;
  readonly ay: number;
  readonly bx: number;
  readonly bz: number;
  readonly by: number;
  readonly cx: number;
  readonly cz: number;
  readonly cy: number;
  /** Whether it is the road's. */
  readonly road: boolean;
}

/** The side of {@link surfaceOf}'s lookup grid, metres. */
const CELL_METRES = 2;

/**
 * The topmost drawn surface at a point in plan — the ground's or the road's,
 * whichever is higher there, as a camera above them sees it — or `undefined`
 * where neither is drawn. Every triangle the renderer is handed, not the
 * mesh's own rows: the oracle is not the code. Asked only within `box`.
 */
function surfaceOf(
  frame: ReturnType<typeof sceneFrame>,
  box: {
    readonly minX: number;
    readonly maxX: number;
    readonly minZ: number;
    readonly maxZ: number;
  },
): (x: number, z: number) => { readonly y: number; readonly road: boolean } | undefined {
  const cells = new Map<string, Facet[]>();
  const add = (vertices: Float32Array, indices: Uint32Array, road: boolean): void => {
    for (let at = 0; at + 2 < indices.length; at += 3) {
      const a = (indices[at] as number) * 3;
      const b = (indices[at + 1] as number) * 3;
      const c = (indices[at + 2] as number) * 3;
      if (a === b || b === c || a === c) continue;
      const facet: Facet = {
        ax: vertices[a] as number,
        ay: vertices[a + 1] as number,
        az: vertices[a + 2] as number,
        bx: vertices[b] as number,
        by: vertices[b + 1] as number,
        bz: vertices[b + 2] as number,
        cx: vertices[c] as number,
        cy: vertices[c + 1] as number,
        cz: vertices[c + 2] as number,
        road,
      };
      // Only the cells of the box it will be asked within.
      const x0 = Math.max(
        Math.floor(Math.min(facet.ax, facet.bx, facet.cx) / CELL_METRES),
        Math.floor(box.minX / CELL_METRES),
      );
      const x1 = Math.min(
        Math.floor(Math.max(facet.ax, facet.bx, facet.cx) / CELL_METRES),
        Math.floor(box.maxX / CELL_METRES),
      );
      const z0 = Math.max(
        Math.floor(Math.min(facet.az, facet.bz, facet.cz) / CELL_METRES),
        Math.floor(box.minZ / CELL_METRES),
      );
      const z1 = Math.min(
        Math.floor(Math.max(facet.az, facet.bz, facet.cz) / CELL_METRES),
        Math.floor(box.maxZ / CELL_METRES),
      );
      for (let x = x0; x <= x1; x += 1) {
        for (let z = z0; z <= z1; z += 1) {
          const key = `${String(x)},${String(z)}`;
          const list = cells.get(key);
          if (list === undefined) cells.set(key, [facet]);
          else list.push(facet);
        }
      }
    }
  };
  add(frame.terrain.mesh.vertices, frame.terrain.mesh.indices, false);
  add(frame.corridor.vertices, frame.corridor.indices, true);
  return (x, z) => {
    let top: { y: number; road: boolean } | undefined;
    const key = `${String(Math.floor(x / CELL_METRES))},${String(Math.floor(z / CELL_METRES))}`;
    for (const f of cells.get(key) ?? []) {
      const d = (f.bz - f.cz) * (f.ax - f.cx) + (f.cx - f.bx) * (f.az - f.cz);
      if (Math.abs(d) < 1e-9) continue;
      const u = ((f.bz - f.cz) * (x - f.cx) + (f.cx - f.bx) * (z - f.cz)) / d;
      const v = ((f.cz - f.az) * (x - f.cx) + (f.ax - f.cx) * (z - f.cz)) / d;
      const w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      const y = u * f.ay + v * f.by + w * f.cy;
      if (top === undefined || y > top.y) top = { y, road: f.road };
    }
    return top;
  };
}

/** The road's half-width, metres. */
const ROAD_HALF_METRES = ROAD_WIDTH_METRES / 2;

/**
 * How far from either pass's centreline the surface is judged: the road's
 * half-width and **6 m** past its edge, which takes in everything between the
 * two passes' road edges, and #3122's "within 6 m of its edge".
 */
const BESIDE_METRES = ROAD_HALF_METRES + 6;

/** The lattice the surface is read on, metres. */
const LATTICE_METRES = 0.5;

/**
 * The largest step between two neighbouring points of the ground a rider
 * sees: **0.3 m** — #3122's. Half a metre apart, that is a slope of 0.6: the
 * verge's own 0.25 m over 0.6 m is 0.21 between two lattice points.
 */
const MOST_STEP_METRES = 0.3;

/**
 * How much further than the verge's drop the ground beside a drawn road may
 * lie under it, metres: **0.15**. The road it is measured against is the
 * nearest point of the drawn centreline, and at the tip of the U-turn the
 * drawn rows are bunched — 2 m apart along the road, half a metre on the
 * ground — so the row whose verge a point is can be 5 m of a 2.7 % climb from
 * the point of the road nearest it. Measured before #3122 on these frames:
 * 0.25 far from the turn, 0.36 beside the tip, and 1.65 inside the U-turn.
 */
const DEEPER_THAN_VERGE_METRES = 0.15;

/** The worst of a measure over many points, and where it was. */
interface Worst {
  value: number;
  at: string;
}

/**
 * {@link drawnRoadAt} over `rows`, asked only of the rows within
 * {@link BESIDE_METRES} of a point: the rows are put in a grid of cells that
 * size once, so a lattice of tens of thousands of points does not walk every
 * row for each. `Infinity` across, as {@link drawnRoadAt}'s, past that.
 */
function nearestOf(
  centre: readonly CorridorPoint[],
  rows: readonly number[],
): (x: number, z: number) => { readonly across: number; readonly height: number } {
  const cells = new Map<string, number[]>();
  const cellOf = (value: number): number => Math.floor(value / BESIDE_METRES);
  for (const row of rows) {
    const from = centre[row] as CorridorPoint;
    const to = centre[row + 1] as CorridorPoint;
    const x0 = cellOf(Math.min(from.x, to.x)) - 1;
    const x1 = cellOf(Math.max(from.x, to.x)) + 1;
    const z0 = cellOf(Math.min(from.z, to.z)) - 1;
    const z1 = cellOf(Math.max(from.z, to.z)) + 1;
    for (let x = x0; x <= x1; x += 1) {
      for (let z = z0; z <= z1; z += 1) {
        const key = `${String(x)},${String(z)}`;
        const list = cells.get(key);
        if (list === undefined) cells.set(key, [row]);
        else list.push(row);
      }
    }
  }
  return (x, z) =>
    drawnRoadAt(centre, cells.get(`${String(cellOf(x))},${String(cellOf(z))}`) ?? [], x, z);
}

describe('one surface between the two passes of a one-point turnaround — #3122', () => {
  it.each([1, 3])(
    'draws the ground between and beside the two passes with no step and no pit, the way back %d m over',
    (lane) => {
      const profile = coastReversal(lane);
      const land = coast(profile);
      const step: Worst = { value: 0, at: 'nowhere' };
      const deep: Worst = { value: Number.NEGATIVE_INFINITY, at: 'nowhere' };
      let judgedPoints = 0;
      let besideRoad = 0;
      for (const offset of RIDER) {
        const { frame, segments, near } = judged(profile, land, profile.totalDistance / 2 + offset);
        const { centre } = frame.corridor;
        // Every piece of either pass's centreline in view near the turn,
        // drawn or not.
        const pieces: number[] = [];
        for (let row = 0; row + 1 < centre.length; row += 1) {
          if (near(row) && near(row + 1)) pieces.push(row);
        }
        if (pieces.length === 0) continue;
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minZ = Number.POSITIVE_INFINITY;
        let maxZ = Number.NEGATIVE_INFINITY;
        for (const row of pieces) {
          const point = centre[row] as CorridorPoint;
          minX = Math.min(minX, point.x - BESIDE_METRES);
          maxX = Math.max(maxX, point.x + BESIDE_METRES);
          minZ = Math.min(minZ, point.z - BESIDE_METRES);
          maxZ = Math.max(maxZ, point.z + BESIDE_METRES);
        }
        const top = surfaceOf(frame, { minX, maxX, minZ, maxZ });
        const passes = nearestOf(centre, pieces);
        const drawn = nearestOf(centre, segments);
        // The ground at each lattice point beside either pass: `NaN` where it
        // is not beside one, or where the road is on top.
        const columns = Math.ceil((maxX - minX) / LATTICE_METRES) + 1;
        const lines = Math.ceil((maxZ - minZ) / LATTICE_METRES) + 1;
        const ground = new Float64Array(columns * lines).fill(Number.NaN);
        for (let i = 0; i < columns; i += 1) {
          for (let j = 0; j < lines; j += 1) {
            const x = minX + i * LATTICE_METRES;
            const z = minZ + j * LATTICE_METRES;
            if (!(passes(x, z).across <= BESIDE_METRES)) continue;
            const surface = top(x, z);
            if (surface !== undefined && !surface.road) ground[i * lines + j] = surface.y;
          }
        }
        for (let i = 0; i < columns; i += 1) {
          for (let j = 0; j < lines; j += 1) {
            const here = ground[i * lines + j] as number;
            if (Number.isNaN(here)) continue;
            const x = minX + i * LATTICE_METRES;
            const z = minZ + j * LATTICE_METRES;
            const where = `${String(offset)} m from the turn at (${x.toFixed(1)}, ${z.toFixed(1)})`;
            judgedPoints += 1;
            for (const there of [
              i + 1 < columns ? (ground[(i + 1) * lines + j] as number) : Number.NaN,
              j + 1 < lines ? (ground[i * lines + j + 1] as number) : Number.NaN,
            ]) {
              if (!(Math.abs(there - here) > step.value)) continue;
              step.value = Math.abs(there - here);
              step.at = `a step ${where}`;
            }
            const road = drawn(x, z);
            if (!(road.across >= ROAD_HALF_METRES && road.across <= BESIDE_METRES)) continue;
            besideRoad += 1;
            if (!(road.height - here > deep.value)) continue;
            deep.value = road.height - here;
            deep.at = `${where}, ${road.across.toFixed(1)} m from the road`;
          }
        }
      }
      expect(step.value, step.at).toBeLessThanOrEqual(MOST_STEP_METRES);
      expect(deep.value, deep.at).toBeLessThanOrEqual(VERGE_DROP_METRES + DEEPER_THAN_VERGE_METRES);
      // Non-vacuity: the lattice covers the ground beside the road in view.
      expect(judgedPoints).toBeGreaterThan(50_000);
      expect(besideRoad).toBeGreaterThan(20_000);
    },
  );
});

/** How far the chase camera's eye stands behind the rider, metres, at least and at most. */
const CHASE_BEHIND_METRES = [CAMERA_BEHIND_METRES - 1, CAMERA_BEHIND_METRES + 0.5] as const;

/** How far to the side of the camera's line of sight the rider may be, metres. */
const CHASE_ACROSS_METRES = 1;

/** How far the eye's height over the rider's road may be off {@link CAMERA_ABOVE_METRES}, metres. */
const CHASE_ABOVE_SLACK_METRES = 0.5;

/**
 * The largest change in the eye's step from one 60 fps frame to the next,
 * metres: **2 cm**, `turnaround.test.ts`' bound on the drawn rider's own. A
 * camera that cuts moves tens of centimetres more in one frame than in the
 * last. At a lower frame rate the bound grows with the square of the frame's
 * length, as a steady swing's does.
 */
const MOST_EYE_JERK_METRES = 0.02;

/**
 * Where the camera is ridden, metres from the turn: the pivot eased in
 * (`scene.ts` §`U_TURN_CAMERA_METRES`: from 45 m before the turn on this
 * fixture), the turn itself, and the pivot handed back (by 50 m after). A
 * stretch at a time, each from a frame of its own, so that no one case draws
 * more frames than a CI runner's default time for a test allows.
 */
const STRETCHES = {
  easedIn: [-50, -15],
  turn: [-22, 22],
  handedBack: [15, 55],
  whole: [-50, 55],
} as const;

describe('the chase camera through a one-point turnaround on the coast — #3122', () => {
  it.each([
    [3, 30, 60, 'easedIn', 1],
    [3, 30, 60, 'turn', 1],
    [3, 30, 60, 'handedBack', 1],
    [1, 30, 60, 'turn', 1],
    [3, 40, 20, 'whole', 1],
    // The ends are 3 m apart, so as a loop (`draftIsLoop`) the route is
    // ridden in laps, and the second lap's odometer is a lap past the turn.
    [3, 30, 60, 'turn', 2],
  ] as const)(
    'stays behind and above the rider and never jumps, the way back %d m over at %d km/h, %d fps: %s, lap %d',
    (lane, kmh, fps, stretch, lap) => {
      const profile = coastReversal(lane, lap > 1);
      const land = coast(profile);
      const origin = corridorOrigin(profile);
      const start = atStartLine(profile);
      // The turn's odometer on the lap ridden: half the out-and-back, which the
      // loop's closing metres do not move.
      const turn = coastReversal(lane).totalDistance / 2 + (lap - 1) * profile.totalDistance;
      const speed = kmh / 3.6;
      const seconds = 1 / fps;
      const [from, to] = STRETCHES[stretch];
      const nearest: Worst = { value: Number.POSITIVE_INFINITY, at: 'nowhere' };
      const farthest: Worst = { value: Number.NEGATIVE_INFINITY, at: 'nowhere' };
      const across: Worst = { value: 0, at: 'nowhere' };
      const above: Worst = { value: 0, at: 'nowhere' };
      const jerk: Worst = { value: 0, at: 'nowhere' };
      let heading: GroundHeading | undefined;
      let lookAhead: number | undefined;
      let lastEye: { readonly x: number; readonly z: number } | undefined;
      let lastStep: { readonly x: number; readonly z: number } | undefined;
      let lastYaw: number | undefined;
      let turned = 0;
      let frames = 0;
      for (let along = turn + from; along <= turn + to; along += speed * seconds) {
        // As `GameView` composes it: the frame's pose, its heading and
        // look-ahead damped by the clock, turned to that heading.
        const frame = sceneFrame({
          profile,
          origin,
          landClass: land,
          state: {
            ...start,
            ride: { ...start.ride, distance: metres(along), speed: speed as never },
          },
        });
        heading = dampedHeading(heading, frame.camera, seconds, false);
        lookAhead = dampedLookAhead(lookAhead, frame.camera.targetAheadMetres, seconds);
        const { eye } = cameraRig(turnedPose(frame.camera, heading, lookAhead));
        const rider = frame.markers.find((marker) => marker.kind === 'rider');
        if (rider === undefined) throw new Error('no rider drawn');
        const at = `${(along - turn).toFixed(1)} m from the turn`;
        const behind = (rider.x - eye.x) * heading.headingX + (rider.z - eye.z) * heading.headingZ;
        const aside = Math.abs(
          (rider.x - eye.x) * heading.headingZ - (rider.z - eye.z) * heading.headingX,
        );
        const off = Math.abs(eye.y - rider.y - CAMERA_ABOVE_METRES);
        if (behind < nearest.value) Object.assign(nearest, { value: behind, at });
        if (behind > farthest.value) Object.assign(farthest, { value: behind, at });
        if (aside > across.value) Object.assign(across, { value: aside, at });
        if (off > above.value) Object.assign(above, { value: off, at });
        if (lastEye !== undefined) {
          const step = { x: eye.x - lastEye.x, z: eye.z - lastEye.z };
          if (lastStep !== undefined) {
            const change = Math.hypot(step.x - lastStep.x, step.z - lastStep.z);
            if (change > jerk.value) Object.assign(jerk, { value: change, at });
          }
          lastStep = step;
        }
        lastEye = eye;
        const yaw = Math.atan2(heading.headingX, heading.headingZ);
        if (lastYaw !== undefined) {
          turned += Math.abs(Math.atan2(Math.sin(yaw - lastYaw), Math.cos(yaw - lastYaw)));
        }
        lastYaw = yaw;
        frames += 1;
      }
      expect(nearest.value, `behind, ${nearest.at}`).toBeGreaterThanOrEqual(CHASE_BEHIND_METRES[0]);
      expect(farthest.value, `behind, ${farthest.at}`).toBeLessThanOrEqual(CHASE_BEHIND_METRES[1]);
      expect(across.value, `across, ${across.at}`).toBeLessThanOrEqual(CHASE_ACROSS_METRES);
      expect(above.value, `above the rider's road, ${above.at}`).toBeLessThanOrEqual(
        CHASE_ABOVE_SLACK_METRES,
      );
      expect(jerk.value, `the eye's step changed, ${jerk.at}`).toBeLessThanOrEqual(
        MOST_EYE_JERK_METRES * (60 / fps) ** 2,
      );
      // Non-vacuity: it rode the stretch, and through the turn the camera
      // turned round.
      expect(frames).toBeGreaterThan(60);
      if (stretch === 'turn' || stretch === 'whole') {
        expect(turned).toBeGreaterThan((160 * Math.PI) / 180);
      }
    },
  );
});

/*
 * ## #3140: the owner's ride of 2026-11-24 with #3122's fix
 *
 * Three more things showed near the same turnaround: the camera low and far
 * behind about a kilometre before the turn, only the rider's helmet showing;
 * a house beside the road hanging over the grass; and the way back drawn as a
 * second road beside the way out. Each is read off the frames a ride draws,
 * on this fixture and on its passes 4 to 6 m apart, which a recorded way
 * back along the other side of a real road can be.
 */

/** How far the passes are drawn apart in #3140's cases, metres: #3109's two, and wider. */
const LANES_3140 = [1, 3, 4, 5] as const;

/** The longer leg #3140's camera is ridden on: a kilometre before the turn, and the corridor's 60 m behind. */
const LONG_LEG_METRES = 1_100;

/**
 * Whether anything drawn — the ground or the road — stands over the line
 * from `from` to `to`, and by how much at most: the line read at 40 points
 * strictly between its ends, against every triangle of the two meshes under
 * it. The oracle is the triangles the renderer is handed, not the code.
 */
function overTheLine(
  frame: ReturnType<typeof sceneFrame>,
  from: { readonly x: number; readonly y: number; readonly z: number },
  to: { readonly x: number; readonly y: number; readonly z: number },
): number {
  const minX = Math.min(from.x, to.x) - 0.1;
  const maxX = Math.max(from.x, to.x) + 0.1;
  const minZ = Math.min(from.z, to.z) - 0.1;
  const maxZ = Math.max(from.z, to.z) + 0.1;
  const facets: Facet[] = [];
  const add = (vertices: Float32Array, indices: Uint32Array, road: boolean): void => {
    for (let at = 0; at + 2 < indices.length; at += 3) {
      const a = (indices[at] as number) * 3;
      const b = (indices[at + 1] as number) * 3;
      const c = (indices[at + 2] as number) * 3;
      const ax = vertices[a] as number;
      const bx = vertices[b] as number;
      const cx = vertices[c] as number;
      if (Math.max(ax, bx, cx) < minX || Math.min(ax, bx, cx) > maxX) continue;
      const az = vertices[a + 2] as number;
      const bz = vertices[b + 2] as number;
      const cz = vertices[c + 2] as number;
      if (Math.max(az, bz, cz) < minZ || Math.min(az, bz, cz) > maxZ) continue;
      facets.push({
        ax,
        ay: vertices[a + 1] as number,
        az,
        bx,
        by: vertices[b + 1] as number,
        bz,
        cx,
        cy: vertices[c + 1] as number,
        cz,
        road,
      });
    }
  };
  add(frame.terrain.mesh.vertices, frame.terrain.mesh.indices, false);
  add(frame.corridor.vertices, frame.corridor.indices, true);
  let most = Number.NEGATIVE_INFINITY;
  for (let step = 1; step < 40; step += 1) {
    const t = step / 40;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    const z = from.z + (to.z - from.z) * t;
    for (const f of facets) {
      const d = (f.bz - f.cz) * (f.ax - f.cx) + (f.cx - f.bx) * (f.az - f.cz);
      if (Math.abs(d) < 1e-9) continue;
      const u = ((f.bz - f.cz) * (x - f.cx) + (f.cx - f.bx) * (z - f.cz)) / d;
      const v = ((f.cz - f.az) * (x - f.cx) + (f.ax - f.cx) * (z - f.cz)) / d;
      if (u < -1e-6 || v < -1e-6 || 1 - u - v < -1e-6) continue;
      most = Math.max(most, u * f.ay + v * f.by + (1 - u - v) * f.cy - y);
    }
  }
  return most;
}

/** How high over the rider's road the line of sight to them is aimed: their hip, metres. */
const RIDER_HIP_METRES = 0.9;

/**
 * Where #3140's camera is ridden, metres from the turn: from a kilometre
 * before it until the U-turn pivot eases in (`scene.ts`
 * §`U_TURN_CAMERA_METRES`: from 45 m before the turn on this fixture), a
 * stretch at a time, each from a frame of its own.
 */
const LEAD_UP = [
  [-1_000, -875],
  [-875, -750],
  [-750, -625],
  [-625, -500],
  [-500, -375],
  [-375, -250],
  [-250, -150],
  [-150, -50],
] as const;

describe('the chase camera on the way up to a one-point turnaround — #3140', () => {
  it.each(LANES_3140.flatMap((lane) => LEAD_UP.map(([from, to]) => [lane, from, to] as const)))(
    'stays in the chase band and sees the rider, the way back %d m over, %d to %d m from the turn',
    (lane, from, to) => {
      const profile = coastReversal(lane, false, LONG_LEG_METRES);
      const land = coast(profile);
      const origin = corridorOrigin(profile);
      const start = atStartLine(profile);
      const turn = profile.totalDistance / 2;
      // 30 km/h at 10 fps, composed as `GameView` composes the camera.
      const speed = 30 / 3.6;
      const seconds = 1 / 10;
      const nearest: Worst = { value: Number.POSITIVE_INFINITY, at: 'nowhere' };
      const farthest: Worst = { value: Number.NEGATIVE_INFINITY, at: 'nowhere' };
      const above: Worst = { value: 0, at: 'nowhere' };
      const hidden: Worst = { value: Number.NEGATIVE_INFINITY, at: 'nowhere' };
      let heading: GroundHeading | undefined;
      let lookAhead: number | undefined;
      let frames = 0;
      for (let along = turn + from; along <= turn + to; along += speed * seconds) {
        const frame = sceneFrame({
          profile,
          origin,
          landClass: land,
          state: {
            ...start,
            ride: { ...start.ride, distance: metres(along), speed: speed as never },
          },
        });
        heading = dampedHeading(heading, frame.camera, seconds, false);
        lookAhead = dampedLookAhead(lookAhead, frame.camera.targetAheadMetres, seconds);
        const { eye } = cameraRig(turnedPose(frame.camera, heading, lookAhead));
        const rider = frame.markers.find((marker) => marker.kind === 'rider');
        if (rider === undefined) throw new Error('no rider drawn');
        const at = `${(along - turn).toFixed(1)} m from the turn`;
        const behind = (rider.x - eye.x) * heading.headingX + (rider.z - eye.z) * heading.headingZ;
        const off = Math.abs(eye.y - rider.y - CAMERA_ABOVE_METRES);
        if (behind < nearest.value) Object.assign(nearest, { value: behind, at });
        if (behind > farthest.value) Object.assign(farthest, { value: behind, at });
        if (off > above.value) Object.assign(above, { value: off, at });
        // "Only the helmet showed": nothing drawn between the eye and the rider.
        const over = overTheLine(frame, eye, { ...rider, y: rider.y + RIDER_HIP_METRES });
        if (over > hidden.value) Object.assign(hidden, { value: over, at });
        frames += 1;
      }
      expect(nearest.value, `behind, ${nearest.at}`).toBeGreaterThanOrEqual(CHASE_BEHIND_METRES[0]);
      expect(farthest.value, `behind, ${farthest.at}`).toBeLessThanOrEqual(CHASE_BEHIND_METRES[1]);
      expect(above.value, `above the rider's road, ${above.at}`).toBeLessThanOrEqual(
        CHASE_ABOVE_SLACK_METRES,
      );
      expect(hidden.value, `drawn over the line to the rider, ${hidden.at}`).toBeLessThanOrEqual(0);
      // Non-vacuity: the stretch was ridden, and the line crossed drawn ground.
      expect(frames).toBeGreaterThan(110);
      expect(hidden.value).toBeGreaterThan(Number.NEGATIVE_INFINITY);
    },
  );
});

/**
 * Where #3140's houses are planned: metres from the turn along the way out,
 * and out from it, positive towards the way back. Each side of both passes,
 * in the clear band and past it; and 60 m from the turn on the outside only.
 * ⚠️ **Not on the inside of the U-turn within 100 m of it**: there the way
 * out's own ground is held down by #2101's seam (`landform.ts`
 * §`SEAM_CREST_FADE_METRES`) by an amount that changes from frame to frame —
 * 0.9 m at 60 m from the turn and 18 m out, between the rider 120 m and 80 m
 * from it, measured on the branch before #3140 — so no building planned once
 * stands on it in every frame. Stated in #3127, not fixed here.
 */
const HOUSES_3140 = [
  ...[-240, -160, -100].flatMap((along) =>
    [-18, -7, 7, 18].map((lateral) => [along, lateral] as const),
  ),
  [-60, -18],
  [-60, -7],
] as const;

/** The mapped height of #3140's houses, metres: their walls, from the floor to the eaves. */
const HOUSE_HEIGHT_METRES = 6;

/** Where the rider is when #3140's houses are read: the way out, then the way back. */
const HOUSE_RIDER = [-300, -200, -120, -80, 80, 120, 200, 300];

describe('a building beside either pass of a one-point turnaround — #3140', () => {
  it.each(LANES_3140)(
    'stands each house on the ground drawn under it on both passes, the way back %d m over',
    (lane) => {
      const profile = coastReversal(lane);
      const origin = corridorOrigin(profile);
      const turn = profile.totalDistance / 2;
      const world = {
        routeId: 'coast-reversal-houses',
        origin,
        covered: () => true,
        coveredBoxes: [{ minX: -3_000, maxX: 3_000, minZ: -1_000, maxZ: 3_000 }],
        landUse: [],
        buildings: HOUSES_3140.map(([along, lateral]) =>
          buildingBeside(
            profile,
            origin,
            [rectangleBeside(turn + along, lateral, 10, 6)],
            HOUSE_HEIGHT_METRES,
          ),
        ),
        paths: [],
        streets: [],
      };
      const land = landClassMask(world);
      // Planned once, as `GameView` plans a ride's mapped buildings at the press.
      const { plans } = footprintPlans(world, land, profile, origin);
      const start = atStartLine(profile);
      const air: Worst = { value: Number.NEGATIVE_INFINITY, at: 'nowhere' };
      const buried: Worst = { value: Number.NEGATIVE_INFINITY, at: 'nowhere' };
      let read = 0;
      const passes = new Set<string>();
      for (const offset of HOUSE_RIDER) {
        const frame = sceneFrame({
          profile,
          origin,
          landClass: land,
          state: { ...start, ride: { ...start.ride, distance: metres(turn + offset) } },
        });
        const { camera } = frame;
        for (const plan of plans) {
          const points = [{ x: plan.centroid.x, y: 0, z: plan.centroid.z }];
          for (let at = 0; at + 1 < plan.footprint.length; at += 2) {
            points.push({
              x: plan.footprint[at] as number,
              y: 0,
              z: plan.footprint[at + 1] as number,
            });
          }
          // In view: ahead of the camera, and every point of it over drawn ground.
          const ahead =
            (plan.centroid.x - camera.x) * camera.headingX +
            (plan.centroid.z - camera.z) * camera.headingZ;
          if (!(ahead > 0 && ahead <= VIEW_METRES)) continue;
          const stood = standingOnGround(points, frame.terrain.mesh);
          if (stood.length < points.length) continue;
          const lowest = Math.min(...stood.map((point) => point.y));
          const highest = Math.max(...stood.map((point) => point.y));
          read += 1;
          passes.add(offset < 0 ? 'out' : 'back');
          const at = `${String(offset)} m from the turn, the house at (${plan.centroid.x.toFixed(0)}, ${plan.centroid.z.toFixed(0)})`;
          // Its foot is the ground it was planned on less its foundation: no
          // gap between that ground and the ground drawn under it.
          const gap = plan.base + FOUNDATION_METRES - lowest;
          if (gap > air.value) Object.assign(air, { value: gap, at });
          // And its floor, the doors' threshold, its mapped height under its
          // eaves: never under the ground drawn under it.
          const under = highest - (plan.eaves - HOUSE_HEIGHT_METRES);
          if (under > buried.value) Object.assign(buried, { value: under, at });
        }
      }
      expect(air.value, `over the ground drawn under it, ${air.at}`).toBeLessThanOrEqual(0.05);
      expect(buried.value, `its floor under the ground, ${buried.at}`).toBeLessThanOrEqual(0.05);
      // Non-vacuity: houses were read from both passes.
      expect(read).toBeGreaterThan(20);
      expect([...passes].sort()).toEqual(['back', 'out']);
    },
  );
});

/** How far `(x, z)` is in plan from the nearest of `rows`' segments, their ends included. */
function planDistance(
  centre: readonly CorridorPoint[],
  rows: readonly number[],
  x: number,
  z: number,
): number {
  let least = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const from = centre[row] as CorridorPoint;
    const to = centre[row + 1] as CorridorPoint;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const span = dx * dx + dz * dz;
    const t =
      span > 0 ? Math.min(1, Math.max(0, ((x - from.x) * dx + (z - from.z) * dz) / span)) : 0;
    least = Math.min(least, Math.hypot(x - from.x - dx * t, z - from.z - dz * t));
  }
  return least;
}

describe('one road drawn where it is ridden twice — #3140', () => {
  it.each([...LANES_3140, 6])(
    'draws only the road the rider is on beside the turn, the way back %d m over',
    (lane) => {
      // Every point of the drawn road in view, more than 30 m from the turn
      // (inside that #3061 lays the road round the U-turn), lies within half a
      // road of the centreline of the pass the rider is on: the other pass is
      // the same road, and is not drawn as a second one beside it.
      const profile = coastReversal(lane);
      const land = coast(profile);
      const turn = profile.totalDistance / 2;
      const wide: Worst = { value: 0, at: 'nowhere' };
      let judgedVertices = 0;
      for (const offset of RIDER) {
        const { frame, near } = judged(profile, land, turn + offset);
        const { centre } = frame.corridor;
        const ridden: number[] = [];
        for (let row = 0; row + 1 < centre.length; row += 1) {
          const from = (centre[row] as CorridorPoint).along;
          const to = (centre[row + 1] as CorridorPoint).along;
          if (offset < 0 ? to < turn : from > turn) ridden.push(row);
        }
        // Every vertex of a triangle the renderer draws: a quad folded to nothing
        // (`terrain.ts` §`withoutRetraced`) draws none.
        const used = new Set<number>();
        const { indices } = frame.corridor;
        for (let at = 0; at + 2 < indices.length; at += 3) {
          const a = indices[at] as number;
          const b = indices[at + 1] as number;
          const c = indices[at + 2] as number;
          if (a === b || b === c || a === c) continue;
          used.add(a).add(b).add(c);
        }
        for (const index of used) {
          const row = Math.floor(index / ROAD_COLUMNS);
          if (row >= centre.length || !near(row)) continue;
          if (Math.abs((centre[row] as CorridorPoint).along - turn) <= 30) continue;
          const x = frame.corridor.vertices[index * 3] as number;
          const z = frame.corridor.vertices[index * 3 + 2] as number;
          const beyond = planDistance(centre, ridden, x, z) - ROAD_HALF_METRES;
          judgedVertices += 1;
          if (beyond > wide.value) {
            Object.assign(wide, {
              value: beyond,
              at: `${String(offset)} m from the turn, ${((centre[row] as CorridorPoint).along - turn).toFixed(1)} m along`,
            });
          }
        }
      }
      expect(wide.value, `road beyond the ridden road's edge, ${wide.at}`).toBeLessThanOrEqual(
        0.05,
      );
      expect(judgedVertices).toBeGreaterThan(500);
    },
  );
});
