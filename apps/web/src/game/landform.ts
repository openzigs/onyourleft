// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ground beside the road, as a landform the route's own gradient shows on
 * — #458.
 *
 * ## What was wrong, and what this replaces
 *
 * Until #458 the ground was **one flat quad at the rider's own height that
 * moved with them** (`three-renderer.ts` §`GROUND_RADIUS_METRES`, deleted). On
 * a climb the road lifted off a plane that stayed level with the rider, and on
 * a descent it dived through it, so a 10 % hill did not look like a hill: the
 * world beside the road stayed flat whatever the road did. The owner's words
 * are the issue's — *"we also want to ensure the road gradients visually
 * show."*
 *
 * What replaces it is a **corridor of ground either side of the road**, built
 * from the SAME centreline and the SAME normals as the road (`terrain.ts`
 * §`ribbonNormals`), whose height is the road's own height at that point of
 * the route plus a synthesised lateral profile. So on a climb the ground ahead
 * is a hillside at the height of the road ahead, and on a descent it falls
 * away into a valley in front of the rider.
 *
 * ## ⚠️ Where every height comes from — ADR 0009 and #248
 *
 * **From the route profile, and from a seeded hash of where you are, and from
 * nothing else.** There is no elevation off the road in this program: a
 * `RouteProfile` is a line, and an external elevation model is
 * [#248](https://github.com/openzigs/onyourleft/issues/248)'s decision rather
 * than this file's. So the lateral profile is **invented, deterministically**:
 * a smooth field hashed from the route's own seed at nodes
 * {@link RELIEF_SPAN_METRES} apart, read at the WRAPPED route distance — the
 * same principle `scatter.ts` §`scatterAt` states, and for the same reason: a
 * place looks the same on lap two as on lap one, and a route ridden twice looks
 * the same twice.
 *
 * ## ⚠️ The ground never rises into the carriageway
 *
 * Three rules, each with its own constant, and `landform.test.ts` holds every
 * vertex of a sweep over bending and hilly routes to them:
 *
 * 1. **The innermost column IS the road's edge.** Same point, same height, to
 *    the bit — which is the no-crack guarantee, at distance 0 and across a
 *    loop's wrap (#440's lesson). The ground then drops
 *    {@link VERGE_DROP_METRES} over {@link VERGE_METRES}, which is the verge.
 * 2. **Nothing rises above the road within {@link RELIEF_CLEAR_METRES} of its
 *    centreline.** The invented relief is zero there and grows with distance,
 *    so a cutting or a hillside starts beyond the scenery's own near band.
 * 3. **On the inside of a bend the ground is folded in, never through.** A
 *    cross-section longer than the bend's radius would cross the centre of
 *    curvature and stand on the far side of the road; {@link BEND_FOLD_SHARE}
 *    of the radius is the most it reaches.
 *
 * ⚠️ **What it does not cover, stated rather than hidden:** two stretches of
 * the same corridor that pass within the ground's reach of each other other
 * than through a bend — a road that doubles back across itself without
 * turning. The ground of one could then stand over the other. Nothing in a
 * `RouteProfile` can say which of two crossing roads is on top, which is the
 * same reason a tunnel is impossible here (`waterways.ts`).
 *
 * ## The trainer is untouched
 *
 * **Visual only.** The grade #362 writes to a trainer comes from `gradeAt` on
 * the route profile, and nothing in this file reads or writes a profile. A
 * landform that changed what the rider felt would be the ground telling the
 * trainer something the route did not.
 *
 * Pure, and names no rendering library: `three-renderer.ts` turns what is
 * built here into pixels, and `game.browser.spec.ts` reads those pixels back.
 */

import { distanceOnRoute, elevationAt, gradeAt, type RouteProfile } from '@onyourleft/domain';

import { slotHash, uniformFrom } from './seeded';
import { DRY, waterShaping, waterways, type WaterShaping } from './waterways';
import {
  ROAD_WIDTH_METRES,
  ribbonNormals,
  type CorridorOrigin,
  type CorridorPoint,
  type RoadCorridor,
} from './terrain';

/** Half the road, which is where the ground starts. */
const ROAD_HALF_WIDTH_METRES = ROAD_WIDTH_METRES / 2;

/**
 * How far out from the road's edge the verge drops, in metres: **0.6**.
 *
 * This repository's own choice: enough that the road reads as a raised
 * surface from a camera 2 m up (`camera.ts`), short enough to stay inside the
 * 3 m verge `scatter.ts` keeps bare.
 */
export const VERGE_METRES = 0.6;

/**
 * How far below the road the ground beside it is, in metres: **0.25** — the
 * figure the flat quad this replaces sat under the road by
 * (`GROUND_BELOW_ROAD_METRES`), kept so that the near ground reads as it did.
 */
export const VERGE_DROP_METRES = 0.25;

/**
 * How far from the centreline the invented relief starts, in metres: **12**.
 *
 * ⚠️ **The rule that keeps the ground out of the carriageway**, and it is set
 * past the road (3.5 m), the verge (0.6 m) and the first two of `scatter.ts`'s
 * five bands, so the near scenery stands on level ground beside the road and a
 * hillside begins behind it. Within it the ground is the road's own height less
 * the verge drop, and never above it.
 */
export const RELIEF_CLEAR_METRES = 12;

/**
 * How fast the invented relief may grow with distance from the road: **0.18**
 * of a metre up or down per metre out — about 10°.
 *
 * This repository's own choice, and a slope rather than a height because what
 * the eye reads as a landform is the angle: a ground that rose 45 m at the edge
 * of the fog and nothing near the road would read as a wall at the horizon.
 */
export const RELIEF_SLOPE = 0.18;

/** The most the invented relief may rise or fall, in metres: **45**. */
export const RELIEF_MAX_METRES = 45;

/**
 * How far apart along the route the relief field's hashed nodes are, in
 * metres: **180**.
 *
 * Long against the corridor's ten-metre rows, so that the ground's shape is
 * carried by the field rather than by the rows sampling it — the rows slide
 * with the rider (`terrain.ts` §`roadCorridor` builds them from the odometer),
 * and a field that varied inside one row spacing would visibly wobble as they
 * moved.
 */
export const RELIEF_SPAN_METRES = 180;

/**
 * How steeply the ground crosses the road where the road climbs, as a share of
 * the road's own gradient: **2**.
 *
 * ⚠️ **What makes a climb read as a hillside rather than as a ramp.** A road up
 * a hill is cut into the side of it, so the ground rises on one side and falls
 * away on the other; a landform that only followed the road's height would
 * tilt the whole view with the camera and look level. So beyond
 * {@link RELIEF_CLEAR_METRES} the ground takes a cross-slope of this many times
 * the road's own gradient, UP on one side and DOWN on the other — which side is
 * a seeded field along the route, so it is the same side every lap. On the
 * level there is none. This repository's own number, by eye against #458's
 * first screenshots, where a 10 % climb without it read as a flat field.
 */
export const CROSS_SLOPE_PER_GRADE = 2;

/**
 * Over how much gradient the cross-slope's corner at a crest is rounded, as a
 * fraction: **0.02** — two percent, under which a road is as good as level.
 */
const TILT_ROUNDING_GRADE = 0.02;

/**
 * How sharply the uphill side is chosen: the side field is multiplied by
 * **3** and clamped, so most of a route has one side fully uphill and the
 * change from one side to the other takes a third of a node's span rather
 * than a single row.
 */
const UPHILL_STEEPNESS = 3;

/**
 * Where the near relief field hands over to the far one, in metres from the
 * centreline: from **40** to **300**. Two fields rather than one, so that a
 * hillside beside the road can fall into a valley further out.
 */
export const RELIEF_BLEND_METRES = [40, 300] as const;

/**
 * The share of a bend's radius the ground may reach on its inside: **0.9**.
 *
 * A cross-section longer than the radius crosses the centre of curvature and
 * stands on the far side of the road. `scatter.ts` §`BEND_INNER_SHARE` keeps
 * its scenery to 0.6 of the radius, measured over a longer window; this is the
 * ground's own bound and it only has to stop a fold.
 */
export const BEND_FOLD_SHARE = 0.9;

/**
 * How far from the centreline each column of the ground stands, in metres.
 *
 * The first two are the road's edge and the foot of the verge; the rest
 * roughly double, because a metre of ground 300 m away is a fraction of a pixel
 * and a metre beside the road is a great many. The last, **420 m**, is past
 * the corridor's own 400 m, where `world.ts` has faded everything by at least
 * three-quarters into the horizon.
 */
export const TERRAIN_COLUMN_OFFSETS: readonly number[] = [
  ROAD_HALF_WIDTH_METRES,
  ROAD_HALF_WIDTH_METRES + VERGE_METRES,
  8,
  RELIEF_CLEAR_METRES,
  18,
  27,
  40,
  60,
  90,
  135,
  200,
  300,
  420,
];

/**
 * How many bands of ground each side has: the gaps between the columns, **12**.
 *
 * ⚠️ **The unit `quality.ts` spends terrain in.** A rung draws the innermost
 * so many bands and no more — `three-renderer.ts` draws a prefix of the index
 * list, which {@link terrainCorridor} orders innermost band first for exactly
 * that reason. The columns themselves never change, so a rung moves no vertex
 * and scenery standing on the ground stands on the same ground at every rung.
 */
export const TERRAIN_BANDS = TERRAIN_COLUMN_OFFSETS.length - 1;

/** Columns per side. */
const COLUMNS = TERRAIN_COLUMN_OFFSETS.length;

/**
 * The band indices {@link slotHash} hashes the relief under, well outside
 * anything `scatter.ts` hashes a band as, so a place's ground and the trees on
 * it do not correlate.
 */
const RELIEF_KEY = 0x2_0000;

/** How much the ground's own colour varies, either way, as a share: **6 %**. */
export const TERRAIN_MOTTLE = 0.06;

/**
 * How long a field beside the road is, nominally, in metres: **90** — #460.
 *
 * Here rather than in `settlements.ts`, which walls the fields, because the
 * ground's own patchwork (#425) is drawn on the same grid and the two must not
 * disagree about where a field ends: a wall that stood across the middle of a
 * field of one colour would be a wall between nothing.
 */
export const FIELD_SPAN_METRES = 90;

/**
 * The field length that divides this route evenly — {@link FIELD_SPAN_METRES}
 * stretched, as `scatter.ts` §`cellSpanMetres` stretches its cells, so a loop's
 * seam is a field boundary and lap two's fields are lap one's.
 */
export function fieldSpanMetres(profile: RouteProfile): number {
  return profile.totalDistance / Math.max(1, Math.round(profile.totalDistance / FIELD_SPAN_METRES));
}

/** The ground beside the road for one frame, ready to become a vertex buffer. */
export interface TerrainMesh {
  /** Three floats a vertex. @see TerrainMesh.rows for the layout */
  readonly vertices: Float32Array;
  /**
   * Three floats a vertex, unit length and pointing up.
   *
   * ⚠️ **Computed here, from the grid**, because the ground is LIT since #458
   * — the one decision the issue asks to be recorded. The flat quad was unlit,
   * which was right for a horizontal plane (`world.ts` makes a horizontal
   * surface receive exactly 1) and is exactly the defect for a slope: an unlit
   * hillside is the same colour as a level field, and the hill does not read.
   */
  readonly normals: Float32Array;
  /** Three floats a vertex, linear, multiplying the ground colour: the mottle. */
  readonly colours: Float32Array;
  /**
   * Two floats a vertex: the row's ODOMETER and the signed lateral offset, in
   * metres. Where on the route a vertex stands, in the route's own frame, for a
   * shader that draws something tied to the route rather than to the screen
   * (#425's surface detail, #460's field patchwork).
   */
  readonly fields: Float32Array;
  /**
   * Triangles, innermost band first — both sides, every row — then the next
   * band out. @see TERRAIN_BANDS for why the order is load-bearing.
   */
  readonly indices: Uint32Array;
  /**
   * How many cross-sections there are: the corridor's own centreline points.
   * Vertex `(row, side, column)` is at `row · 2 · columns + side · columns +
   * column`, side 0 the left and 1 the right, column 0 the road's edge.
   */
  readonly rows: number;
  /** Indices a band spends, both sides, every row: for a draw range. */
  readonly indicesPerBand: number;
  /**
   * How long this route's fields are, in metres — {@link fieldSpanMetres}.
   * The ground's patchwork is drawn on it, and the walls stand on it.
   */
  readonly fieldSpan: number;
}

/**
 * The distant hills — #458's "distant relief silhouette".
 *
 * A ring of {@link HORIZON_SEGMENTS} tops at {@link HORIZON_RADIUS_METRES}
 * around the camera, heights relative to the route's first point. It is drawn
 * unfogged (at its distance fog would take all of it) and hazed toward the
 * horizon colour instead, and it reaches down to {@link HorizonRelief.base} so
 * that nothing below the horizon is ever sky once the corridor's own ground has
 * ended.
 */
export interface HorizonRelief {
  /** Heights of the ridge, in local metres, one per segment round the ring. */
  readonly tops: Float32Array;
  /** Just below the lowest point of the route: where the ridge's haze ends. */
  readonly foot: number;
  /** Far below everything: where the ring's skirt ends. */
  readonly base: number;
}

/** How many tops the ring has. Enough to read as hills rather than as teeth. */
export const HORIZON_SEGMENTS = 48;

/**
 * How far out the ring stands, in metres: **1 100**. Past the corridor's
 * ground (420 m), inside the camera's 2 000 m far plane at every corner of the
 * ring's segments.
 */
export const HORIZON_RADIUS_METRES = 1_100;

/**
 * How high the ridge stands above the middle of the route's own elevation
 * range, in metres: from **30** to **150**. A flat route still has hills on its
 * horizon — a dead-flat skyline reads as the edge of the world rather than as
 * distance — and a mountain route's ridge is lifted by its own range.
 */
export const HORIZON_RISE_METRES = [30, 150] as const;

/** The most elevation samples the ring reads to find a route's range. */
const HORIZON_SAMPLE_LIMIT = 256;

/**
 * The ground's height at a point, in local metres — what a thing standing
 * there stands on.
 *
 * `routeDistance` is where on the route the point is BESIDE, and
 * `signedLateral` how far from the centreline, left positive — the frame
 * `terrain.ts` builds the road's columns in. Piecewise-linear across
 * {@link TERRAIN_COLUMN_OFFSETS}, which is what the mesh is, so a tree placed at
 * this height stands on the triangles the renderer draws rather than on a
 * smoother surface nobody sees. `landform.test.ts` samples the mesh itself to
 * say so.
 */
export function terrainHeightAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  routeDistance: number,
  signedLateral: number,
): number {
  const wrapped = distanceOnRoute(profile, routeDistance);
  const road = elevationAt(profile, wrapped) - origin.elevation;
  const side = signedLateral >= 0 ? 0 : 1;
  const lateral = Math.abs(signedLateral);
  if (lateral <= ROAD_HALF_WIDTH_METRES) {
    return road;
  }
  const fields = reliefFields(profile, seed, wrapped, side);
  const ways = waterways(profile, seed);
  const shaped = (offset: number): WaterShaping =>
    waterShaping(ways, profile, origin, wrapped, offset * (side === 0 ? 1 : -1), road);
  let column = 0;
  while (column < COLUMNS - 2 && lateral > (TERRAIN_COLUMN_OFFSETS[column + 1] as number)) {
    column += 1;
  }
  const inner = TERRAIN_COLUMN_OFFSETS[column] as number;
  const outer = TERRAIN_COLUMN_OFFSETS[column + 1] as number;
  const share = Math.min(1, (lateral - inner) / (outer - inner));
  const from = groundHeight(road, fields, inner, shaped(inner));
  const to = groundHeight(road, fields, outer, shaped(outer));
  return from + (to - from) * share;
}

/**
 * The ground either side of this frame's road.
 *
 * Built from the corridor itself — its centreline and {@link ribbonNormals} —
 * so its innermost column coincides with the road's outermost to the bit.
 */
export function terrainCorridor(
  profile: RouteProfile,
  origin: CorridorOrigin,
  corridor: RoadCorridor,
  seed: number,
): TerrainMesh {
  // #459. The streams and lakes, as a ceiling on the ground and a damping of
  // its relief. @see waterShaping
  const ways = waterways(profile, seed);
  const centre = corridor.centre;
  const rows = centre.length;
  const normals2d = ribbonNormals(centre);
  const reach = steadied(clearReach(centre, normals2d, foldReach(centre, normals2d)));
  const perRow = COLUMNS * 2;
  const vertices = new Float32Array(rows * perRow * 3);
  const colours = new Float32Array(rows * perRow * 3);
  const fields = new Float32Array(rows * perRow * 2);

  for (let row = 0; row < rows; row += 1) {
    const point = centre[row] as CorridorPoint;
    const normalX = normals2d[row * 2] as number;
    const normalZ = normals2d[row * 2 + 1] as number;
    for (let side = 0; side < 2; side += 1) {
      const sign = side === 0 ? 1 : -1;
      const relief = reliefFields(profile, seed, point.distance, side);
      const limit = reach[row * 2 + side] as number;
      const tint = 1 + TERRAIN_MOTTLE * relief.mottle;
      for (let column = 0; column < COLUMNS; column += 1) {
        const offset = TERRAIN_COLUMN_OFFSETS[column] as number;
        // ⚠️ The first two columns are never folded: the road's edge and the
        // foot of its verge are where they are on any bend. (Under a bridge
        // they are LOWERED, into the channel — the bridge's opening — but
        // never moved.)
        const lateral = column < 2 ? offset : Math.min(offset, limit);
        const at = row * perRow + side * COLUMNS + column;
        vertices[at * 3] = point.x + normalX * lateral * sign;
        // Column 0 is `point.y` exactly: `groundHeight` drops nothing and adds
        // no relief at the road's half-width, so the edge needs no special case.
        vertices[at * 3 + 1] = groundHeight(
          point.y,
          relief,
          lateral,
          ways.crossings.length + ways.lakes.length === 0
            ? DRY
            : waterShaping(ways, profile, origin, point.distance, lateral * sign, point.y),
        );
        vertices[at * 3 + 2] = point.z + normalZ * lateral * sign;
        colours[at * 3] = tint;
        colours[at * 3 + 1] = tint;
        colours[at * 3 + 2] = tint;
        fields[at * 2] = point.along;
        fields[at * 2 + 1] = lateral * sign;
      }
    }
  }

  const indices = terrainIndices(rows);
  return {
    vertices,
    normals: gridNormals(vertices, rows),
    colours,
    fields,
    indices,
    rows,
    indicesPerBand: Math.max(0, rows - 1) * 2 * 6,
    fieldSpan: fieldSpanMetres(profile),
  };
}

/**
 * The distant hills, for a route.
 *
 * Seeded and stateless like the rest of this file, and lifted by the route's
 * own elevation range so that a mountain route's horizon is a mountain one.
 */
export function horizonRelief(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
): HorizonRelief {
  const stride = Math.max(1, Math.ceil(profile.elevations.length / HORIZON_SAMPLE_LIMIT));
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < profile.elevations.length; index += stride) {
    const each = profile.elevations[index] as number;
    lowest = Math.min(lowest, each);
    highest = Math.max(highest, each);
  }
  const low = lowest - origin.elevation;
  const middle = (lowest + highest) / 2 - origin.elevation;
  const [rise, most] = HORIZON_RISE_METRES;
  const tops = new Float32Array(HORIZON_SEGMENTS);
  // Eight coarse hills round the ring, smoothed, with a little of each
  // segment's own on top — the same two-scale shape the relief field has.
  const HILLS = 8;
  for (let segment = 0; segment < HORIZON_SEGMENTS; segment += 1) {
    const at = (segment / HORIZON_SEGMENTS) * HILLS;
    const hill = Math.floor(at);
    const ramp = smoothstep01(at - hill);
    const from = uniformFrom(slotHash(seed, hill % HILLS, RELIEF_KEY + 8), 0);
    const to = uniformFrom(slotHash(seed, (hill + 1) % HILLS, RELIEF_KEY + 8), 0);
    const coarse = from + (to - from) * ramp;
    const fine = uniformFrom(slotHash(seed, segment, RELIEF_KEY + 9), 0);
    tops[segment] = middle + rise + (most - rise) * (0.8 * coarse + 0.2 * fine);
  }
  return { tops, foot: low - 20, base: low - 1_000 };
}

/** The relief fields beside one point of the route, on one side. */
interface ReliefFields {
  /** The field near the road, in [−1, 1]. */
  readonly near: number;
  /** The field far from it, in [−1, 1]. */
  readonly far: number;
  /** The ground's own colour variation here, in [−1, 1]. */
  readonly mottle: number;
  /**
   * The cross-slope here, rise per metre out, signed: up on one side and down
   * on the other. @see CROSS_SLOPE_PER_GRADE
   */
  readonly tilt: number;
}

function reliefFields(
  profile: RouteProfile,
  seed: number,
  wrapped: number,
  side: number,
): ReliefFields {
  const nodes = Math.max(2, Math.round(profile.totalDistance / RELIEF_SPAN_METRES));
  const at = (wrapped / profile.totalDistance) * nodes;
  const node = Math.floor(at);
  const ramp = smoothstep01(at - node);
  const field = (layer: number): number => {
    const from = uniformFrom(slotHash(seed, node % nodes, RELIEF_KEY + layer), 0);
    const to = uniformFrom(slotHash(seed, (node + 1) % nodes, RELIEF_KEY + layer), 0);
    return (from + (to - from) * ramp) * 2 - 1;
  };
  // Which side is uphill: one smooth field for both sides, used with opposite
  // signs, so the two sides always disagree — a road cut across a slope.
  // ⚠️ **Steepened and clamped, never its sign.** A sign flips between two
  // rows, and the ground then swaps its hillside for its valley across ten
  // metres of road: a cliff that walks as the rows slide. The first version
  // did exactly that, and `landform.test.ts` §"the scenery stands on the
  // ground" found a shrub half a metre off the triangles under it.
  const uphill = Math.min(1, Math.max(-1, field(6) * UPHILL_STEEPNESS));
  // ⚠️ **A soft magnitude, not `Math.abs`.** The gradient's magnitude has a
  // corner at every crest and trough, and a mesh row that spans a corner cuts
  // it — measured at 15 cm under the scenery on a rolling road. Rounding the
  // corner over {@link TILT_ROUNDING_GRADE} of gradient removes it and changes
  // nothing on a real climb.
  const slope = gradeAt(profile, wrapped) / 100;
  const grade = Math.hypot(slope, TILT_ROUNDING_GRADE) - TILT_ROUNDING_GRADE;
  return {
    near: field(side),
    far: field(2 + side),
    mottle: field(4 + side),
    tilt: CROSS_SLOPE_PER_GRADE * grade * (side === 0 ? uphill : -uphill),
  };
}

/**
 * The ground's height at a lateral offset beside a road at height `road`.
 *
 * ⚠️ **Never above the road inside {@link RELIEF_CLEAR_METRES}**: the drop is
 * at least zero, and the relief is exactly zero there.
 */
function groundHeight(
  road: number,
  fields: ReliefFields,
  lateral: number,
  water: WaterShaping,
): number {
  const drop =
    lateral <= ROAD_HALF_WIDTH_METRES
      ? 0
      : Math.min(1, (lateral - ROAD_HALF_WIDTH_METRES) / VERGE_METRES) * VERGE_DROP_METRES;
  const [nearEnd, farStart] = RELIEF_BLEND_METRES;
  const blend = smoothstep01((lateral - nearEnd) / (farStart - nearEnd));
  const field = fields.near + (fields.far - fields.near) * blend;
  const beyond = Math.max(0, lateral - RELIEF_CLEAR_METRES);
  const amplitude = Math.min(RELIEF_MAX_METRES, beyond * RELIEF_SLOPE);
  const relief = (amplitude * field + fields.tilt * beyond) * water.relief;
  // #459: the water's bed is a ceiling. Under a bridge that includes the road's
  // own edge, which is the bridge's opening.
  return Math.min(
    water.ceiling,
    road - drop + Math.min(RELIEF_MAX_METRES, Math.max(-RELIEF_MAX_METRES, relief)),
  );
}

/**
 * How far each row's ground may reach on each side before a bend folds it —
 * two numbers a row, left then right.
 *
 * The turn is read from the corridor's own normals either side of the row, so
 * it is the bend the road is actually drawn round.
 */
function foldReach(centre: readonly CorridorPoint[], normals: Float64Array): Float64Array {
  const reach = new Float64Array(centre.length * 2).fill(Number.POSITIVE_INFINITY);
  for (let row = 0; row < centre.length; row += 1) {
    const before = Math.max(0, row - 1);
    const after = Math.min(centre.length - 1, row + 1);
    const from = centre[before] as CorridorPoint;
    const to = centre[after] as CorridorPoint;
    const apart = Math.hypot(to.x - from.x, to.z - from.z);
    if (!(apart > 0)) {
      continue;
    }
    const ax = normals[before * 2] as number;
    const az = normals[before * 2 + 1] as number;
    const bx = normals[after * 2] as number;
    const bz = normals[after * 2 + 1] as number;
    // Positive when the road turns toward its left normal: the left is inside.
    const turn = Math.atan2(ax * bz - az * bx, ax * bx + az * bz);
    const curvature = turn / apart;
    if (curvature === 0) {
      continue;
    }
    const limit = BEND_FOLD_SHARE / Math.abs(curvature);
    // ⚠️ The sign convention is `terrain.ts`'s: the normal is the LEFT one, and
    // a left-hand bend turns it anticlockwise in this x-east, z-north plane —
    // a POSITIVE cross product, so the left side is the inside.
    // `landform.test.ts` folds a left and a right bend to pin which is which.
    reach[row * 2 + (curvature > 0 ? 0 : 1)] = limit;
  }
  return reach;
}

/**
 * How far from the road the ground must stop short of ANY stretch of it, in
 * metres: the road's half-width and its verge, **4.1**.
 *
 * ⚠️ **The rule a hairpin needs and a bend does not.** {@link foldReach} stops
 * a cross-section crossing the centre of its own bend; it knows nothing about
 * the OTHER leg of a hairpin, 30 m away across the inside of the turn, whose
 * straight has no curvature at all. `landform.test.ts` §"never stands over ANY
 * part of the road" found ground 17 cm above the far leg's tarmac on a 4 %
 * climb before this existed.
 */
export const ROAD_CLEARANCE_METRES = ROAD_HALF_WIDTH_METRES + VERGE_METRES;

/** How many halvings {@link clearReach} spends finding where a side must stop. */
const CLEAR_REACH_STEPS = 8;

/**
 * {@link foldReach}, tightened so that no column of the ground stands within
 * {@link ROAD_CLEARANCE_METRES} of any other stretch of this corridor's road.
 *
 * For each row and side, the columns are walked outward; the first that comes
 * too close to the road stops the side, at the furthest lateral offset between
 * it and the column before that is still clear. The two innermost columns are
 * never stopped — they are the road's own edge and verge.
 *
 * About 60 000 point-to-segment distances a frame at the corridor's usual 47
 * rows, and none once every column is clear, which is almost every row.
 */
function clearReach(
  centre: readonly CorridorPoint[],
  normals: Float64Array,
  reach: Float64Array,
): Float64Array {
  // Each segment's box, grown by the clearance, so a point nowhere near a
  // segment — which is nearly every point on nearly every row — is refused in
  // four comparisons rather than a projection. It halved the ground's cost a
  // frame, measured.
  const boxes = new Float64Array(Math.max(0, centre.length - 1) * 4);
  for (let segment = 0; segment + 1 < centre.length; segment += 1) {
    const from = centre[segment] as CorridorPoint;
    const to = centre[segment + 1] as CorridorPoint;
    boxes[segment * 4] = Math.min(from.x, to.x) - ROAD_CLEARANCE_METRES;
    boxes[segment * 4 + 1] = Math.max(from.x, to.x) + ROAD_CLEARANCE_METRES;
    boxes[segment * 4 + 2] = Math.min(from.z, to.z) - ROAD_CLEARANCE_METRES;
    boxes[segment * 4 + 3] = Math.max(from.z, to.z) + ROAD_CLEARANCE_METRES;
  }
  const clearOf = (x: number, z: number): boolean => {
    for (let segment = 0; segment + 1 < centre.length; segment += 1) {
      if (
        x < (boxes[segment * 4] as number) ||
        x > (boxes[segment * 4 + 1] as number) ||
        z < (boxes[segment * 4 + 2] as number) ||
        z > (boxes[segment * 4 + 3] as number)
      ) {
        continue;
      }
      const from = centre[segment] as CorridorPoint;
      const to = centre[segment + 1] as CorridorPoint;
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const span = dx * dx + dz * dz;
      const t =
        span > 0 ? Math.min(1, Math.max(0, ((x - from.x) * dx + (z - from.z) * dz) / span)) : 0;
      if (Math.hypot(x - (from.x + dx * t), z - (from.z + dz * t)) < ROAD_CLEARANCE_METRES) {
        return false;
      }
    }
    return true;
  };
  for (let row = 0; row < centre.length; row += 1) {
    const point = centre[row] as CorridorPoint;
    const normalX = normals[row * 2] as number;
    const normalZ = normals[row * 2 + 1] as number;
    for (let side = 0; side < 2; side += 1) {
      const sign = side === 0 ? 1 : -1;
      const limit = reach[row * 2 + side] as number;
      const at = (lateral: number): boolean =>
        clearOf(point.x + normalX * lateral * sign, point.z + normalZ * lateral * sign);
      let previous = TERRAIN_COLUMN_OFFSETS[1] as number;
      for (let column = 2; column < COLUMNS; column += 1) {
        const offset = Math.min(TERRAIN_COLUMN_OFFSETS[column] as number, limit);
        if (at(offset)) {
          previous = offset;
          if (offset >= limit) break;
          continue;
        }
        let clear = previous;
        let blocked = offset;
        for (let step = 0; step < CLEAR_REACH_STEPS; step += 1) {
          const middle = (clear + blocked) / 2;
          if (at(middle)) clear = middle;
          else blocked = middle;
        }
        reach[row * 2 + side] = clear;
        break;
      }
    }
  }
  return reach;
}

/**
 * Each row's reach, no further than either neighbour's — an erosion over the
 * rows, per side.
 *
 * ⚠️ **What stops a quad twisting where a reach changes.** A row stopped short
 * beside a row that was not makes a quad whose outer edge runs back past its
 * inner one, and that triangle turns over: wound towards the ground and culled
 * — a hole — or overlapping the one beside it. On a 25 m hairpin the reaches
 * alone left one such triangle; taking the least of three rows removes it, at
 * the cost of stopping the ground one row early either side of a bend.
 */
function steadied(reach: Float64Array): Float64Array {
  const rows = reach.length / 2;
  const out = new Float64Array(reach.length);
  for (let row = 0; row < rows; row += 1) {
    for (let side = 0; side < 2; side += 1) {
      const at = (index: number): number =>
        reach[Math.min(rows - 1, Math.max(0, index)) * 2 + side] as number;
      out[row * 2 + side] = Math.min(at(row - 1), at(row), at(row + 1));
    }
  }
  return out;
}

/** Innermost band first, both sides and every row, then the next band out. */
function terrainIndices(rows: number): Uint32Array {
  const perRow = COLUMNS * 2;
  const indices = new Uint32Array(Math.max(0, rows - 1) * 2 * TERRAIN_BANDS * 6);
  let at = 0;
  for (let band = 0; band < TERRAIN_BANDS; band += 1) {
    for (let side = 0; side < 2; side += 1) {
      for (let row = 0; row + 1 < rows; row += 1) {
        const a = row * perRow + side * COLUMNS + band;
        const b = a + 1;
        const c = a + perRow;
        const d = c + 1;
        // ⚠️ **Wound per side, so every triangle faces UP.** The two sides are
        // mirror images — the columns run left on one and right on the other —
        // so one winding for both puts one side's faces towards the ground,
        // where a front-face-culled material does not draw them at all. The
        // first browser run of #458 found exactly that: the left hillside hid
        // nothing, because it was not there. `landform.test.ts` §"faces every
        // triangle up" holds the order to it.
        if (side === 0) {
          indices.set([a, b, c, b, d, c], at);
        } else {
          indices.set([a, c, b, b, c, d], at);
        }
        at += 6;
      }
    }
  }
  return indices;
}

/**
 * Upward unit normals from the height grid: across the columns and along the
 * rows, one step either side, crossed.
 */
function gridNormals(vertices: Float32Array, rows: number): Float32Array {
  const perRow = COLUMNS * 2;
  const normals = new Float32Array(vertices.length);
  const point = (row: number, side: number, column: number, axis: number): number =>
    vertices[(row * perRow + side * COLUMNS + column) * 3 + axis] as number;
  for (let row = 0; row < rows; row += 1) {
    const back = Math.max(0, row - 1);
    const ahead = Math.min(rows - 1, row + 1);
    for (let side = 0; side < 2; side += 1) {
      for (let column = 0; column < COLUMNS; column += 1) {
        const inner = Math.max(0, column - 1);
        const outer = Math.min(COLUMNS - 1, column + 1);
        const ax = point(ahead, side, column, 0) - point(back, side, column, 0);
        const ay = point(ahead, side, column, 1) - point(back, side, column, 1);
        const az = point(ahead, side, column, 2) - point(back, side, column, 2);
        const cx = point(row, side, outer, 0) - point(row, side, inner, 0);
        const cy = point(row, side, outer, 1) - point(row, side, inner, 1);
        const cz = point(row, side, outer, 2) - point(row, side, inner, 2);
        let nx = ay * cz - az * cy;
        let ny = az * cx - ax * cz;
        let nz = ax * cy - ay * cx;
        const length = Math.hypot(nx, ny, nz);
        const at = (row * perRow + side * COLUMNS + column) * 3;
        if (!(length > 0)) {
          // A collapsed cross-section — behind the start of a point-to-point
          // route, where every row is the same point. Straight up is what a
          // surface there would face.
          normals[at + 1] = 1;
          continue;
        }
        const up = ny >= 0 ? 1 : -1;
        nx = (nx / length) * up;
        ny = (ny / length) * up;
        nz = (nz / length) * up;
        normals[at] = nx;
        normals[at + 1] = ny;
        normals[at + 2] = nz;
      }
    }
  }
  return normals;
}

function smoothstep01(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}
