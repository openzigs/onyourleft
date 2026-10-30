// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Footways and sidewalks from the corridor's map data — #1551, ADR 0054 D-5.5.
 *
 * Takes #1539's `paths` (`roads` features whose `kind` is `path` or whose
 * `kind_detail` is in {@link FOOTWAY_DETAILS}) and makes two things of them,
 * and draws nothing of its own:
 *
 * 1. **{@link pavementSides}** — which side of the drawn road a mapped
 *    sidewalk runs on, for `streets.ts` (#1535), which lays its kerbed
 *    pavement on THAT side through a covered stretch instead of its own
 *    "sides with houses" rule; and on neither where the land was read and no
 *    sidewalk is mapped. Where nothing was read the answer is `unknown`, and
 *    #1535's own rule stands ({@link NO_PAVEMENT_DATA}).
 * 2. **{@link footwayNetwork}** — the footways as 2 m polylines in the corridor
 *    frame, clipped to the corridor and kept off the carriageway, which #1541's
 *    pedestrians walk (`people.ts`).
 *
 * ## ⚠️ The side is the road's NORMAL, never the sign of `x`
 *
 * A sidewalk is beside the road over the stretch where its nearest point lies
 * {@link SIDEWALK_NEAREST_METRES}–{@link SIDEWALK_FARTHEST_METRES} from the
 * drawn centreline, along a heading within {@link SIDEWALK_MAX_ANGLE_DEGREES}
 * of the road's. Its side is the sign of that offset along the drawn road's
 * normal (`terrain.ts` §`drawnRoadFrame`), which is the rider's RIGHT
 * (`racing-line.ts` §`ROAD_SIDE`). `x` is metres WEST (#583): on a road running
 * north the right is `−x`, so a side read off the sign of `x` is the mirror.
 *
 * ## ⚠️ Never on the carriageway
 *
 * A `crossing` is a footway drawn ACROSS the road, so it is never a pavement
 * side and never part of the network; and a network point within
 * {@link ROAD_HALF_WIDTH_METRES} of ANY stretch of the drawn road
 * (`road-grid.ts` §`distanceToDrawnRoad`) breaks its line there. #1541's
 * "no pedestrian is ever inside the carriageway" rests on both.
 *
 * ⚠️ **Location data** (ADR 0004 D): nothing here formats a message. It reads
 * #1539's bounded features and only the three fields `PathFeature` carries.
 *
 * Pure, built once a ride (cached on the corridor object), and names no
 * rendering library.
 */

import { distanceOnRoute, type RouteProfile } from '@onyourleft/domain';
import { FOOTWAY_KIND, FOOTWAY_KIND_DETAILS, type PathFeature } from '@onyourleft/map-features';

import { distanceToDrawnRoad } from './road-grid';
import { drawnRoadFrame, ROAD_WIDTH_METRES, type CorridorOrigin } from './terrain';
import { CORRIDOR_HALF_WIDTH_METRES, type WorldCorridor } from './world-data/corridor';

/** Half the carriageway, in metres: **3.5** — `terrain.ts` §`ROAD_WIDTH_METRES` / 2. */
export const ROAD_HALF_WIDTH_METRES = ROAD_WIDTH_METRES / 2;

/** A sidewalk nearer the centreline than this, in metres (**3**), is not beside the road. */
export const SIDEWALK_NEAREST_METRES = 3;

/** A sidewalk farther from the centreline than this, in metres (**12**), is not beside the road. */
export const SIDEWALK_FARTHEST_METRES = 12;

/** A sidewalk whose heading is more than this off the road's, in degrees (**20**), is not beside it. */
export const SIDEWALK_MAX_ANGLE_DEGREES = 20;

/** How far apart {@link pavementSides} reads the road, in metres: **2**, `streets.ts`' own step. */
export const PAVEMENT_SIDES_STEP_METRES = 2;

/** How far apart a {@link FootwayNetwork} line's points are, in metres: **2**. */
export const FOOTWAY_STEP_METRES = 2;

/** The most lines a route's network keeps: **2 000**, nearest the route first. */
export const FOOTWAY_MAX_LINES = 2_000;

/** The most metres of footway a route's network keeps: **50 000**, nearest the route first. */
export const FOOTWAY_MAX_METRES = 50_000;

/**
 * The `kind_detail` values that are footways: `@onyourleft/map-features`'
 * set, which is what was decoded. A feature of `kind` `path` with no
 * `kind_detail` is one too; `track`, `bridleway` and `corridor` are not.
 */
export const FOOTWAY_DETAILS: readonly string[] = FOOTWAY_KIND_DETAILS;

/** Kept by the decoder under `kind` `path`, and not footways: a track is no pavement, a corridor is indoors. */
const NOT_FOOTWAYS: readonly string[] = ['track', 'bridleway', 'corridor'];

/** A footway drawn across the road: never a side, never walked. */
const CROSSING = 'crossing';

/** Which side of the drawn road a mapped sidewalk is on, at one stretch. */
export type PavementSide = 'left' | 'right' | 'both' | 'none' | 'unknown';

/** What `streets.ts` reads where the corridor was read (#1535). */
export interface PavementSides {
  /** Per drawn-road stretch, which side has a mapped sidewalk; `unknown` where not covered. */
  sideAt(along: number): PavementSide;
}

/** What #1541's pedestrians walk on (`people.ts` §`footwayWalks`). */
export interface FootwayNetwork {
  /** Corridor frame, `x0, z0, x1, z1, …`, resampled every 2 m, clipped to the corridor. */
  readonly lines: readonly Float32Array[];
  /**
   * #1541: each line's footway's `kind_detail` — `sidewalk`, `footway`, or
   * `''` for a plain `path` — so a runner keeps to a path and off a sidewalk.
   */
  readonly details: readonly string[];
  readonly totalMetres: number;
}

/** `unknown` everywhere: #1535's own rule. */
export const NO_PAVEMENT_DATA: PavementSides = { sideAt: () => 'unknown' };

/** Whether a feature is a footway this module uses, crossings included. */
export function isFootway(path: PathFeature): boolean {
  if (NOT_FOOTWAYS.includes(path.kindDetail)) return false;
  return path.kind === FOOTWAY_KIND || FOOTWAY_DETAILS.includes(path.kindDetail);
}

/** A footway that may be a pavement side or be walked: every footway but a crossing. */
function alongside(path: PathFeature): boolean {
  return path.kindDetail !== CROSSING && isFootway(path);
}

// --- Pavement sides -------------------------------------------------------

/** Bits of one stretch's code. 0 is `unknown`. */
const READ = 1;
const RIGHT = 2;
const LEFT = 4;

/** The side of a code. */
function sideOf(code: number): PavementSide {
  if ((code & READ) === 0) return 'unknown';
  const right = (code & RIGHT) !== 0;
  const left = (code & LEFT) !== 0;
  if (right && left) return 'both';
  if (right) return 'right';
  if (left) return 'left';
  return 'none';
}

/** The side of a cell of {@link SegmentGrid}, in metres. */
const SEGMENT_CELL_METRES = 16;

/** The footways' segments, bucketed by cell. Four floats a segment: `ax, az, bx, bz`. */
interface SegmentGrid {
  readonly segments: Float64Array;
  readonly cells: ReadonlyMap<number, readonly number[]>;
}

function cellKey(column: number, row: number): number {
  return column * 100_003 + row;
}

function segmentGrid(paths: readonly PathFeature[]): SegmentGrid {
  const flat: number[] = [];
  const cells = new Map<number, number[]>();
  for (const path of paths) {
    if (!alongside(path)) continue;
    const line = path.line;
    for (let at = 0; at + 3 < line.length; at += 2) {
      const ax = line[at] as number;
      const az = line[at + 1] as number;
      const bx = line[at + 2] as number;
      const bz = line[at + 3] as number;
      if (![ax, az, bx, bz].every(Number.isFinite)) continue;
      const index = flat.length / 4;
      flat.push(ax, az, bx, bz);
      const lastColumn = Math.floor(Math.max(ax, bx) / SEGMENT_CELL_METRES);
      const lastRow = Math.floor(Math.max(az, bz) / SEGMENT_CELL_METRES);
      for (let c = Math.floor(Math.min(ax, bx) / SEGMENT_CELL_METRES); c <= lastColumn; c += 1) {
        for (let r = Math.floor(Math.min(az, bz) / SEGMENT_CELL_METRES); r <= lastRow; r += 1) {
          const key = cellKey(c, r);
          const list = cells.get(key);
          if (list === undefined) cells.set(key, [index]);
          else list.push(index);
        }
      }
    }
  }
  return { segments: Float64Array.from(flat), cells };
}

const COS_MAX_ANGLE = Math.cos((SIDEWALK_MAX_ANGLE_DEGREES * Math.PI) / 180);

/**
 * Which sides of the road at `(x, z)`, whose normal (the rider's right) is
 * `(normalX, normalZ)`, have a sidewalk beside them: {@link RIGHT} and
 * {@link LEFT} bits.
 */
function sidesHere(
  grid: SegmentGrid,
  x: number,
  z: number,
  normalX: number,
  normalZ: number,
): number {
  // The road's heading: the normal turned back a quarter (`drawnRoadFrame`).
  const forwardX = normalZ;
  const forwardZ = -normalX;
  const reach = SIDEWALK_FARTHEST_METRES;
  const lastColumn = Math.floor((x + reach) / SEGMENT_CELL_METRES);
  const lastRow = Math.floor((z + reach) / SEGMENT_CELL_METRES);
  const firstRow = Math.floor((z - reach) / SEGMENT_CELL_METRES);
  const s = grid.segments;
  let found = 0;
  for (let c = Math.floor((x - reach) / SEGMENT_CELL_METRES); c <= lastColumn; c += 1) {
    for (let r = firstRow; r <= lastRow; r += 1) {
      for (const segment of grid.cells.get(cellKey(c, r)) ?? []) {
        const ax = s[segment * 4] as number;
        const az = s[segment * 4 + 1] as number;
        const dx = (s[segment * 4 + 2] as number) - ax;
        const dz = (s[segment * 4 + 3] as number) - az;
        const span = dx * dx + dz * dz;
        if (!(span > 0)) continue;
        const length = Math.sqrt(span);
        // Parallel, either way along it.
        if (Math.abs(dx * forwardX + dz * forwardZ) / length < COS_MAX_ANGLE) continue;
        // Beside THIS stretch: the foot of the perpendicular lies on the segment.
        const t = ((x - ax) * dx + (z - az) * dz) / span;
        if (t < 0 || t > 1) continue;
        const offsetX = ax + dx * t - x;
        const offsetZ = az + dz * t - z;
        const distance = Math.hypot(offsetX, offsetZ);
        if (distance < SIDEWALK_NEAREST_METRES || distance > SIDEWALK_FARTHEST_METRES) continue;
        // The side is the offset along the road's NORMAL. @see the header
        found |= offsetX * normalX + offsetZ * normalZ > 0 ? RIGHT : LEFT;
      }
    }
  }
  return found;
}

/** One corridor's sides, kept with the profile it was read against. */
const sidesBuilt = new WeakMap<WorldCorridor, { profile: RouteProfile; sides: PavementSides }>();

/**
 * Which side of the drawn road a mapped sidewalk runs on, every
 * {@link PAVEMENT_SIDES_STEP_METRES} of the route, from `corridor`'s footways.
 * `unknown` where the road's own point was not covered; `none` where it was and
 * no sidewalk is beside it. Built once per corridor, the same object after.
 */
export function pavementSides(
  corridor: WorldCorridor,
  profile: RouteProfile,
  origin: CorridorOrigin,
): PavementSides {
  const cached = sidesBuilt.get(corridor);
  if (cached?.profile === profile) return cached.sides;
  const grid = segmentGrid(corridor.paths);
  const length: number = profile.totalDistance;
  const count = Math.max(1, Math.floor(length / PAVEMENT_SIDES_STEP_METRES) + 1);
  const codes = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    const frame = drawnRoadFrame(profile, origin, index * PAVEMENT_SIDES_STEP_METRES);
    if (frame === undefined || !corridor.covered(frame.x, frame.z)) continue;
    codes[index] = READ | sidesHere(grid, frame.x, frame.z, frame.normalX, frame.normalZ);
  }
  const sides: PavementSides = {
    sideAt(along) {
      const wrapped: number = distanceOnRoute(profile, along);
      const index = Math.min(
        count - 1,
        Math.max(0, Math.round(wrapped / PAVEMENT_SIDES_STEP_METRES)),
      );
      return sideOf(codes[index] ?? 0);
    },
  };
  sidesBuilt.set(corridor, { profile, sides });
  return sides;
}

// --- The walkable network -------------------------------------------------

/** One run of kept points, how near the road it comes, and its footway's `kind_detail`. */
interface Run {
  readonly points: number[];
  readonly nearest: number;
  readonly detail: string;
}

/**
 * Where a point stands against the road: `-1` on the carriageway, `+Infinity`
 * outside the corridor, its distance from the drawn centreline otherwise.
 *
 * `previous` is the distance of the point before it on the same line, at most
 * {@link FOOTWAY_STEP_METRES} away, or `+Infinity`: this point is then no
 * farther than that plus the step, so the grid is searched only that far — a
 * search to the corridor's whole half-width is 289 cells, and is paid only at
 * a line's first point and after a break.
 */
function standing(
  profile: RouteProfile,
  origin: CorridorOrigin,
  x: number,
  z: number,
  previous: number,
): number {
  const reach = Math.min(CORRIDOR_HALF_WIDTH_METRES, previous + FOOTWAY_STEP_METRES + 1);
  const distance = distanceToDrawnRoad(profile, origin, x, z, reach);
  if (distance < ROAD_HALF_WIDTH_METRES) return -1;
  return distance <= CORRIDOR_HALF_WIDTH_METRES ? distance : Number.POSITIVE_INFINITY;
}

/** `line` resampled every {@link FOOTWAY_STEP_METRES}, its vertices kept. */
function resampled(line: Float32Array): number[] {
  const out: number[] = [];
  for (let at = 0; at + 1 < line.length; at += 2) {
    const ax = line[at] as number;
    const az = line[at + 1] as number;
    if (!Number.isFinite(ax) || !Number.isFinite(az)) return out;
    if (at === 0) out.push(ax, az);
    if (at + 3 >= line.length) break;
    const bx = line[at + 2] as number;
    const bz = line[at + 3] as number;
    if (!Number.isFinite(bx) || !Number.isFinite(bz)) return out;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / FOOTWAY_STEP_METRES));
    for (let step = 1; step <= steps; step += 1) {
      out.push(ax + ((bx - ax) * step) / steps, az + ((bz - az) * step) / steps);
    }
  }
  return out;
}

function metresOf(points: readonly number[]): number {
  let total = 0;
  for (let at = 2; at + 1 < points.length; at += 2) {
    total += Math.hypot(
      (points[at] as number) - (points[at - 2] as number),
      (points[at + 1] as number) - (points[at - 1] as number),
    );
  }
  return total;
}

/**
 * The corridor's footways as lines #1541's pedestrians walk: every footway but
 * a crossing, resampled every {@link FOOTWAY_STEP_METRES}, broken wherever a
 * point is on the carriageway, outside the corridor's half-width or on land
 * that was not read, and bounded by `limits` — nearest the route first, the
 * line that reaches `maxMetres` cut where it does.
 */
export function footwayNetwork(
  corridor: WorldCorridor,
  profile: RouteProfile,
  origin: CorridorOrigin,
  limits: { readonly maxLines: number; readonly maxMetres: number },
): FootwayNetwork {
  const runs: Run[] = [];
  for (const path of corridor.paths) {
    if (!alongside(path)) continue;
    const points = resampled(path.line);
    let run: number[] = [];
    let nearest = Number.POSITIVE_INFINITY;
    let previous = Number.POSITIVE_INFINITY;
    const close = (): void => {
      if (run.length >= 4) runs.push({ points: run, nearest, detail: path.kindDetail });
      run = [];
      nearest = Number.POSITIVE_INFINITY;
    };
    for (let at = 0; at + 1 < points.length; at += 2) {
      const x = points[at] as number;
      const z = points[at + 1] as number;
      const where = corridor.covered(x, z)
        ? standing(profile, origin, x, z, previous)
        : Number.POSITIVE_INFINITY;
      // A point on the carriageway is within the half-width: the next is near.
      previous = where < 0 ? ROAD_HALF_WIDTH_METRES : where;
      if (where < 0 || where === Number.POSITIVE_INFINITY) {
        close();
        continue;
      }
      run.push(x, z);
      nearest = Math.min(nearest, where);
    }
    close();
  }
  runs.sort((a, b) => a.nearest - b.nearest);
  const lines: Float32Array[] = [];
  const details: string[] = [];
  let totalMetres = 0;
  for (const run of runs) {
    if (lines.length >= limits.maxLines || totalMetres >= limits.maxMetres) break;
    let points = run.points;
    let metres = metresOf(points);
    if (totalMetres + metres > limits.maxMetres) {
      // Cut at the last point that fits.
      let kept = 0;
      let at = 2;
      for (; at + 1 < points.length; at += 2) {
        const step = Math.hypot(
          (points[at] as number) - (points[at - 2] as number),
          (points[at + 1] as number) - (points[at - 1] as number),
        );
        if (totalMetres + kept + step > limits.maxMetres) break;
        kept += step;
      }
      if (at < 4) break;
      points = points.slice(0, at);
      metres = kept;
    }
    lines.push(Float32Array.from(points));
    details.push(run.detail);
    totalMetres += metres;
  }
  return { lines, details, totalMetres };
}
