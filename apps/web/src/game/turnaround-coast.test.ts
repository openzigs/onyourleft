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
import { landBeside } from './footprint-fixtures-testing';
import { landClassMask, type LandClassMask } from './land-class';
import { RELIEF_CLEAR_METRES, TERRAIN_COLUMN_OFFSETS, VERGE_DROP_METRES } from './landform';
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
function coastReversal(lane: number, loop = false): RouteProfile {
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
