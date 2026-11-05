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
 *    of the radius is the most it reaches. Since #2096 the fold also tapers
 *    back out, {@link REACH_TAPER_PER_METRE} metres of reach a metre of road,
 *    rather than jumping from the fold to the full 420 m between two rows —
 *    which stood the relief up on end as a wall beside the road. The scenery
 *    is placed from the route and knows nothing of either, so since #2099 a
 *    frame keeps only what stands over its own triangles
 *    ({@link standingOnGround}).
 *
 * ⚠️ **What it does not cover, stated rather than hidden:** two stretches of
 * the same corridor that pass within the ground's reach of each other other
 * than through a bend — a road that doubles back across itself without
 * turning. The ground of one could then stand over the other. Nothing in a
 * `RouteProfile` can say which of two crossing roads is on top, which is the
 * same reason a tunnel is impossible here (`waterways.ts`).
 *
 * ⚠️ **The inside of a very sharp bend, where the two legs' ground overlaps**
 * (#2096), is #2101's: past the line between the legs each one's ground sinks
 * under the other's ({@link seamReach}), so the leg nearer a point is the
 * one drawn there. Only where the road has turned through more than
 * {@link SEAM_TURN_RADIANS} between them: the legs of a gentler bend still
 * overlap as they did, two sheets at different invented heights, and where
 * the corridor ends past one leg they are held to the road's height at the
 * line and lie within a metre or so of each other.
 *
 * ## ⚠️ A mapped town stands on the flat — #1547
 *
 * Where the ride's land-class mask (`land-class.ts`, #1546) maps built-up
 * land, the invented relief is held to {@link RELIEF_SLOPE} times the distance
 * to it ({@link LandClassMask.builtUpDistances}): **none on the town itself**,
 * so it is the road's own height less the verge, and rising from its edge no
 * faster than the relief rises from the road's clear band. That is the same
 * rule as rule 2 above, with the town's edge for the road's, and it is what
 * keeps a mapped footprint off an invented 20 m bank without a step at the
 * town's edge. A fixed blend margin cannot do both: the relief is up to 45 m,
 * and 45 m over #1547's proposed 30 m is a slope of 1.5, far past anything the
 * relief makes by itself. The water's ceiling is applied after, so a stream's
 * bed is still cut through a town; the road, and the grade a trainer is sent,
 * are untouched. Where nothing is mapped — `NO_LAND_CLASS`, every ride with no
 * corridor — the distance is `Infinity` and every height is today's, to the
 * bit.
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

import { treeLineHeight } from './ground-blend';
import type { LandClassMask } from './land-class';
import { slotHash, uniformFrom } from './seeded';
import { DRY, waterNearRoute, waterShaping, waterways, type WaterShaping } from './waterways';
import {
  ROAD_WIDTH_METRES,
  drawnRoadFrame,
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
   * ⚠️ **Borrowed**: shared by every mesh of the same row count.
   */
  readonly indices: Uint32Array;
  /**
   * How many cross-sections there are: the corridor's own centreline points.
   * Vertex `(row, side, column)` is at `row · 2 · columns + side · columns +
   * column`, side 0 the normal's — the RIGHT, since #583 — and 1 the left,
   * column 0 the road's edge. ⚠️ Side 0 was called the left until #583, when
   * the world was a mirror of its map and the normal pointed at the map's
   * left; on the screen it was always the right.
   */
  readonly rows: number;
  /** Indices a band spends, both sides, every row: for a draw range. */
  readonly indicesPerBand: number;
  /**
   * How long this route's fields are, in metres — {@link fieldSpanMetres}.
   * The ground's patchwork is drawn on it, and the walls stand on it.
   */
  readonly fieldSpan: number;
  /**
   * How many fields a lap of this route has, each side: `totalDistance /
   * fieldSpan`, a whole number by construction.
   *
   * ⚠️ **What makes lap two's patchwork lap one's** — #468's review, B3.
   * {@link TerrainMesh.fields} carries the ODOMETER, which keeps counting on
   * lap two, and the shader picked each field's colour from
   * `floor(odometer / fieldSpan)`: the same field was a different colour every
   * lap while the walls between them, which `settlements.ts` places on the
   * wrapped field, stayed put. The shader now wraps that index by this count.
   * The odometer rather than the wrapped distance stays in the attribute
   * because the attribute is INTERPOLATED: a triangle across a loop's seam
   * with 4 995 at one corner and 5 at the next would sweep through every
   * field between them — #440's lesson, in a varying.
   */
  readonly fieldCount: number;
  /**
   * The tree line as a height in this corridor's frame — #627: where the
   * realistic ground turns to scree. `ground-blend.ts` §`treeLineHeight`.
   */
  readonly treeLine: number;
  /**
   * Which build lent {@link vertices}, {@link normals}, {@link colours} and
   * {@link fields} — #469. Absent on a mesh somebody owns outright (a copy, or
   * one built by hand in a test).
   *
   * ⚠️ **Those four arrays are BORROWED, and valid until the next
   * {@link terrainCorridor}.** They are storage this module keeps and writes
   * again on the next build, for the reason {@link indices} already was: a
   * frame that allocates four fresh arrays sixty times a second is a GC pause
   * every few seconds on a phone, which is #323's stutter arriving from the
   * other side. So a mesh held across another build reads the NEWER build's
   * ground. `three-renderer.ts` §`TerrainBelt.update` refuses a stale lease
   * rather than drawing it, and `frame-testing.ts` §`retainedFrame` is how a
   * caller that must hold two frames at once takes a copy.
   */
  readonly lease?: number | undefined;
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
  /**
   * The middle of the route's own elevation range, in local metres — what the
   * ridge stands above, and since #622 where the realistic world's valley haze
   * begins (`realistic-light.ts` §`valleyHazeFactor`).
   */
  readonly middle: number;
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
 * `signedLateral` how far from the centreline, positive on the normal's side
 * — the RIGHT, since #583 — the frame `terrain.ts` builds the road's columns
 * in. Piecewise-linear across
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
  /**
   * The ride's land-class mask — #1547: the ground is levelled under mapped
   * built-up land, so a thing standing there stands on the levelled ground.
   * Required, so no caller can forget it: `NO_LAND_CLASS` is passed, never
   * defaulted.
   */
  land: LandClassMask,
): number {
  const wrapped = distanceOnRoute(profile, routeDistance);
  const road = elevationAt(profile, wrapped) - origin.elevation;
  const side = signedLateral >= 0 ? 0 : 1;
  const lateral = Math.abs(signedLateral);
  if (lateral <= ROAD_HALF_WIDTH_METRES) {
    return road;
  }
  const ways = waterways(profile, seed);
  // ⚠️ **Inside the clear band there is no relief to read**, so the hashed
  // fields are not drawn at all: the ground there is the road less the verge,
  // under whatever ceiling water puts on it. A third of the scenery stands in
  // that band, and this is the whole of what it costs to stand it there.
  if (lateral <= RELIEF_CLEAR_METRES && ways.crossings.length + ways.lakes.length === 0) {
    return groundHeight(
      road,
      NO_RELIEF,
      lateral,
      DRY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    );
  }
  // The far field starts to count at the blend's near end; a bracket that
  // ends inside it reads only the near field, and no bracket reads the mottle.
  const fields = reliefFields(
    profile,
    seed,
    wrapped,
    side,
    lateral < (RELIEF_BLEND_METRES[0] as number) ? 'height-near-the-road' : 'everything',
  );
  const sign = side === 0 ? 1 : -1;
  const shaped = (offset: number): WaterShaping =>
    waterShaping(ways, profile, origin, wrapped, offset * sign, road);
  let column = 0;
  while (column < COLUMNS - 2 && lateral > (TERRAIN_COLUMN_OFFSETS[column + 1] as number)) {
    column += 1;
  }
  const inner = TERRAIN_COLUMN_OFFSETS[column] as number;
  const outer = TERRAIN_COLUMN_OFFSETS[column + 1] as number;
  const share = Math.min(1, (lateral - inner) / (outer - inner));
  // #1547: each column's own hold, at where that column stands beside the
  // drawn road — the point the mesh's vertex is built at.
  const frame =
    land.levellingBytes > 0 && lateral > RELIEF_CLEAR_METRES
      ? drawnRoadFrame(profile, origin, wrapped)
      : undefined;
  if (frame === undefined) {
    LEVEL_HOLDS[0] = Number.POSITIVE_INFINITY;
    LEVEL_HOLDS[1] = Number.POSITIVE_INFINITY;
  } else {
    LEVEL_POINTS[0] = frame.x + frame.normalX * inner * sign;
    LEVEL_POINTS[1] = frame.z + frame.normalZ * inner * sign;
    LEVEL_POINTS[2] = frame.x + frame.normalX * outer * sign;
    LEVEL_POINTS[3] = frame.z + frame.normalZ * outer * sign;
    reliefHolds(land, 2);
  }
  const fromHold = LEVEL_HOLDS[0] as number;
  const toHold = LEVEL_HOLDS[1] as number;
  const from = groundHeight(road, fields, inner, shaped(inner), fromHold, fromHold);
  const to = groundHeight(road, fields, outer, shaped(outer), toHold, toHold);
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
  /**
   * The ride's land-class mask — #1547: the ground is levelled under mapped
   * built-up land. Required: `scene.ts` passes the ride's, or `NO_LAND_CLASS`
   * explicitly, so an optional parameter nobody supplies cannot pass for
   * wiring (`check-wiring.mjs` §Limits).
   */
  land: LandClassMask,
): TerrainMesh {
  // #459. The streams and lakes, as a ceiling on the ground and a damping of
  // its relief. @see waterShaping
  const ways = waterways(profile, seed);
  const hasWater = ways.crossings.length + ways.lakes.length > 0;
  const centre = corridor.centre;
  const rows = centre.length;
  const normals2d = ribbonNormals(centre);
  const lent = terrainScratchFor(rows);
  // ⚠️ **The erosion and the taper run BEFORE `clearReach`** (#2097's review).
  // `clearReach` only vouches for the laterals it probes, and a taper after it
  // lowered a row's reach to one it never did: ground stood 8.6 m over a
  // hairpin's far leg. On the tapered reach it probes the very laterals the
  // ground is built at. Its own cuts are not tapered: they are the clearance,
  // and are what they were before #2096.
  const reach = clearReach(
    centre,
    normals2d,
    tapered(
      centre,
      keptFolds(steadied(foldReach(centre, normals2d, lent.reach), lent.steadied), lent.folds),
    ),
  );
  // #2101: where another leg of this road takes over each side, from the
  // reach every side ends up with — the other leg's ground has to be there.
  // `clearReach` probes the columns' own offsets, and a column drawn in
  // towards a seam stands between the seam and its offset, sunk.
  const seams = seamReach(centre, normals2d, reach, lent.seams, lent.shallow, lent.meets);
  const { shallow, meets } = lent;
  // And how far each side may sink past its seam: a metre where it has
  // only the shallow seam, deepening along the road from there.
  const depths = roadToNone(centre, seams, lent.depths);
  // And how far each side is along the road from a row whose side has any
  // seam: the relief may stand up again only away from one. @see SEAM_CREST_FADE_METRES
  const away = roadToSeam(centre, shallow, lent.away);
  // And the line each side is held to, let out along the road from the rows
  // that have a seam rather than dropped where they stop having one, and
  // the height each side moves by to meet the other leg. @see meetingRises
  lent.lines.set(shallow);
  const lines = tapered(centre, lent.lines);
  const rises = meetingRises(centre, shallow, meets, lent.rises);
  const perRow = COLUMNS * 2;
  const { vertices, colours, fields, normals } = lent;
  // #1547: asked only where the mask levels anything, so a ride with no
  // corridor pays nothing for it and builds today's ground to the bit.
  const levelled = land.levellingBytes > 0;

  for (let row = 0; row < rows; row += 1) {
    const point = centre[row] as CorridorPoint;
    const normalX = normals2d[row * 2] as number;
    const normalZ = normals2d[row * 2 + 1] as number;
    // #569: whether any water reaches this cross-section at all, asked once a
    // row. Where none does, `waterShaping` would answer DRY at every column.
    const wetRow = hasWater && waterNearRoute(ways, profile, point.distance);
    for (let side = 0; side < 2; side += 1) {
      const sign = side === 0 ? 1 : -1;
      const relief = reliefFields(profile, seed, point.distance, side);
      const limit = reach[row * 2 + side] as number;
      const seam = seams[row * 2 + side] as number;
      const held = shallow[row * 2 + side] as number;
      const line = lines[row * 2 + side] as number;
      // How far this side moves towards the other leg's road height by the
      // line, and from where: a side lowered from the verge's foot, a side
      // raised from the clear band's edge, each its share of the difference
      // by the width it has, so the two meet on the line at one slope.
      // Nothing far from any seam, where `line` is `Infinity` and `rise`
      // nought, and `rise` fades along the road past it. @see meetingRises
      const rise = rises[row * 2 + side] as number;
      const from = rise < 0 ? ROAD_CLEARANCE_METRES : RELIEF_CLEAR_METRES;
      const ramp = Math.max(
        1,
        Math.max(0, line - ROAD_CLEARANCE_METRES) + Math.max(0, line - RELIEF_CLEAR_METRES),
      );
      const meet = rise === 0 ? 0 : (rise * Math.max(0, line - from)) / ramp;
      // And sunk past the seam faster than the other leg's ground falls away
      // from it towards its own road, which it does at `rise` over `ramp`, on
      // top of the relief.
      const sinking = SEAM_SINK_PER_METRE + (2 * Math.abs(rise)) / ramp;
      const deepest =
        SHALLOW_SINK_METRES + SEAM_DEEPEN_PER_METRE * (depths[row * 2 + side] as number);
      const tint = 1 + TERRAIN_MOTTLE * relief.mottle;
      // How much of the hold on the relief's rising part is let go: none on
      // a row with a seam, all of it {@link SEAM_CREST_FADE_METRES} of road on.
      const crestShare = Math.min(1, (away[row * 2 + side] as number) / SEAM_CREST_FADE_METRES);
      columnLaterals(limit, line);
      // #1547: every column's hold, asked in one call where anything is levelled.
      if (levelled) {
        for (let column = 0; column < COLUMNS; column += 1) {
          const lateral = LATERALS[column] as number;
          LEVEL_POINTS[column * 2] = point.x + normalX * lateral * sign;
          LEVEL_POINTS[column * 2 + 1] = point.z + normalZ * lateral * sign;
        }
        reliefHolds(land, COLUMNS);
      }
      for (let column = 0; column < COLUMNS; column += 1) {
        const lateral = LATERALS[column] as number;
        const at = row * perRow + side * COLUMNS + column;
        const x = point.x + normalX * lateral * sign;
        const z = point.z + normalZ * lateral * sign;
        vertices[at * 3] = x;
        const shaping = wetRow
          ? waterShaping(ways, profile, origin, point.distance, lateral * sign, point.y)
          : DRY;
        // Column 0 is `point.y` exactly: `groundHeight` drops nothing and adds
        // no relief at the road's half-width, so the edge needs no special case.
        const hold = levelled ? (LEVEL_HOLDS[column] as number) : Number.POSITIVE_INFINITY;
        // #2101: held to the seam with another leg as to a town's edge, so
        // the two meet on it at the road's own height rather than at two
        // invented ones, and sunk past it under that leg's ground — by no
        // more than a metre where that leg's ground does not cover the rest
        // (`held`, the shallow seam), and deepening from there along the
        // road. Neither where no other leg takes over: both are `Infinity`.
        // The relief is held to `line`, the seam let out along the road, which
        // is `held` or nearer, and `Infinity` only far from any seam.
        const flat = Math.min(hold, RELIEF_SLOPE * Math.max(0, line - lateral));
        // And no higher than the road within it, near a seam, while past it
        // the relief may fall as it did before #2101: the owner's ruling of
        // 2026-11-04. @see SEAM_CREST_FADE_METRES
        const crest = crestShare < 1 ? flat * crestShare : flat;
        const fall = Math.min(hold, RELIEF_SLOPE * Math.abs(line - lateral));
        const met = Math.min(
          shaping.ceiling,
          groundHeight(point.y, relief, lateral, shaping, fall, crest) +
            meet * towardsSeam(lateral, line, from),
        );
        const height = Number.isFinite(held)
          ? met -
            Math.max(
              Math.min(deepest, sunk(lateral - seam, sinking)),
              Math.min(SHALLOW_SINK_METRES, sunk(lateral - held, sinking)),
            )
          : met;
        vertices[at * 3 + 1] = height;
        vertices[at * 3 + 2] = z;
        // #501: the wet margin. Column 0 is the road's own edge and is never
        // wet, so the road's verge stays the road's. And only on the shore:
        // ground far from the water is dry however low it lies (#501 review).
        const wet = column === 0 ? 0 : wetness(height, shaping.level) * shaping.shore;
        colours[at * 3] = tint * (1 + (WET_GROUND_TINT[0] - 1) * wet);
        colours[at * 3 + 1] = tint * (1 + (WET_GROUND_TINT[1] - 1) * wet);
        colours[at * 3 + 2] = tint * (1 + (WET_GROUND_TINT[2] - 1) * wet);
        fields[at * 2] = point.along;
        fields[at * 2 + 1] = lateral * sign;
      }
    }
  }

  // #2149: and the inside of a sharp bend closed where the fold stops it
  // short of the bend's centre. @see closeFans
  closeFans(centre, normals2d, reach, lent.folds, vertices, fields);
  const indices = terrainIndices(rows);
  gridNormals(vertices, rows, normals);
  terrainLease += 1;
  return {
    vertices,
    normals,
    colours,
    fields,
    indices,
    rows,
    indicesPerBand: Math.max(0, rows - 1) * 2 * 6,
    fieldSpan: fieldSpanMetres(profile),
    fieldCount: Math.max(1, Math.round(profile.totalDistance / FIELD_SPAN_METRES)),
    treeLine: treeLineHeight(origin),
    lease: terrainLease,
  };
}

/** Each column's lateral offset for the side {@link columnLaterals} was last asked about. */
const LATERALS = new Float64Array(COLUMNS);

/**
 * Where each column of one side of one row stands, out from the road, into
 * {@link LATERALS}, for a side reaching `limit` with its seam at `seam`.
 *
 * ⚠️ The first two columns are never folded: the road's edge and the foot of
 * its verge are where they are on any bend. (Under a bridge they are
 * LOWERED, into the channel — the bridge's opening — but never moved.) The
 * rest stop at the side's `limit`.
 *
 * ⚠️ **And since #2101 the columns past the `seam` with another leg are drawn
 * in towards it** ({@link seamReach}): a column `d` past it stands `d² / s`
 * past it, `s` being the outermost column's distance past it. So the first
 * column past the line stands a few metres from it rather than tens, and the
 * ground starts to sink under the other leg's there rather than dragging the
 * triangles that span the line down from a column far beyond it. Every
 * column moves smoothly with the seam and keeps its order, so a seam that
 * moves from one row to the next twists no quad — snapping the nearest column
 * onto the line instead changed column where the seam crossed a midpoint,
 * and stood a triangle up between rows (|ny| 0.143, measured). The outermost
 * column stays where it is: it is the ground's reach.
 */
function columnLaterals(limit: number, seam: number): void {
  const outermost = TERRAIN_COLUMN_OFFSETS[COLUMNS - 1] as number;
  const span = outermost - seam;
  for (let column = 0; column < COLUMNS; column += 1) {
    const offset = TERRAIN_COLUMN_OFFSETS[column] as number;
    const past = offset - seam;
    const drawn = column >= 2 && past > 0 && span > 0 ? seam + (past * past) / span : offset;
    LATERALS[column] = column < 2 ? offset : Math.min(drawn, limit);
  }
}

/**
 * How far each side of each row is from the other leg's road height at its
 * seam, other minus own, into `out` — #2101: nought where a side has no seam.
 *
 * ⚠️ **What stopped a bank standing on the inside of a very sharp bend** —
 * the owner's ruling of 2026-11-03, on frames of #2101's first fix: a raised
 * green bank inside a 143° bend with a hard straight edge, hiding part of the
 * far leg's road, and a smaller hump leaving it. Two things stood it up, each
 * measured on a planner's 140° to 150° corner:
 *
 * 1. **The hold stopped dead.** A side is held to {@link RELIEF_SLOPE} a metre
 *    from its seam; where a row's seam ended — the other leg's rows run out
 *    at the corridor's end — the next row had its relief back in full, 3 m
 *    beside a row held to the road's height, two metres of road away: the
 *    straight edge, at |ny| 0.47 to 0.59 on the level. So the seam is let out
 *    along the road at {@link REACH_TAPER_PER_METRE} ({@link tapered}, the
 *    reach's own taper), and the hold, the meeting ramp and the columns
 *    drawn in to the line all read the line it gives.
 * 2. **Both legs met halfway, each from its clear band's edge**, and near
 *    the bend the seam is centimetres past that edge, so the step between the
 *    legs stood on end (|ny| 0.11 at 143° descending at 6 %) and the upper
 *    leg's ground hid the lower leg's road (by up to 1.8 m descending at
 *    6 %). Rule 2 of this file's header forbids only rising inside the clear
 *    band, so a side lowered now starts from the verge's foot, a side raised
 *    from the clear band's edge, and each takes the share of the difference
 *    its width gives: the two meet on the line at one slope.
 * 3. **And the height each moves by stopped dead** where the hold no longer
 *    did (#2117's review): nought on the first row past the last seam, beside
 *    a row moved by up to half the roads' difference — a crease across the
 *    leaving leg's ground. So it too is let out along the road, fading at
 *    {@link MEET_TAPER_PER_METRE}, a row with a seam keeping its own.
 */
function meetingRises(
  centre: readonly CorridorPoint[],
  shallow: Float64Array,
  meets: Float64Array,
  out: Float64Array,
): Float64Array {
  const rows = centre.length;
  for (let index = 0; index < rows * 2; index += 1) {
    out[index] = Number.isFinite(shallow[index])
      ? (meets[index] as number) - (centre[index >> 1] as CorridorPoint).y
      : 0;
  }
  // Let out along the road from the rows that have a seam, as the line is,
  // rather than dropped to nought on the first row without one: one pass
  // forward and one back, as `tapered`'s, a row with a seam keeping its own.
  const gap = (row: number): number => {
    const from = centre[row] as CorridorPoint;
    const to = centre[row + 1] as CorridorPoint;
    return MEET_TAPER_PER_METRE * Math.hypot(to.x - from.x, to.z - from.z);
  };
  const carried = (at: number, from: number, fade: number): void => {
    if (Number.isFinite(shallow[at])) return;
    const near = out[from] as number;
    const left = Math.max(0, Math.abs(near) - fade);
    if (left > Math.abs(out[at] as number)) out[at] = Math.sign(near) * left;
  };
  for (let row = 1; row < rows; row += 1) {
    const fade = gap(row - 1);
    for (let side = 0; side < 2; side += 1) carried(row * 2 + side, row * 2 + side - 2, fade);
  }
  for (let row = rows - 2; row >= 0; row -= 1) {
    const fade = gap(row);
    for (let side = 0; side < 2; side += 1) carried(row * 2 + side, row * 2 + side + 2, fade);
  }
  return out;
}

/**
 * How fast the height a side moves to meet the other leg fades along the
 * road from the last row with a seam, in metres of it per metre of road:
 * **0.25** — #2117's review. @see meetingRises
 *
 * ⚠️ **What stops a crease across the leaving leg.** Until the review it fell
 * to nought on the first row without a seam, while the line it moves the
 * ground to was let out along the road, so every column past the line
 * stepped by up to half the two roads' difference between two rows: up to
 * 4.8 m over 2 m of road, 62 to 165 m ahead, on a 147° bend at 6 % — where
 * the owner saw a smaller hump leaving the bend. A side moves about half of
 * it by the line, so at 0.25 its ground there fades no faster than 0.125 m a
 * metre along the road, under {@link RELIEF_SLOPE}. Without the fade 18 of
 * the 28 graded corners step by more than a metre a metre.
 *
 * Held both ways since #2117's re-review, which found nought left every test
 * green: `landform.test.ts` §"lets the meeting height go along the road"
 * goes red on all 28 graded corners at 0.05 and below and on 12 at 0.1, and
 * §"…where a seam starts" on 4 at 1 and at 2 (at 6 %, measured). 0.15 and
 * 0.2 pass as well: nothing tells them from 0.25, kept for the reason above.
 */
const MEET_TAPER_PER_METRE = 0.25;

/**
 * The road from each side of each row to the nearest row whose side has no
 * seam in `seams`, in metres, into `out`: nought on a row with none, and
 * `Infinity` where every row has one. One pass forward and one back, as
 * {@link tapered}'s.
 */
function roadToNone(
  centre: readonly CorridorPoint[],
  seams: Float64Array,
  out: Float64Array,
): Float64Array {
  const rows = centre.length;
  for (let index = 0; index < rows * 2; index += 1) {
    out[index] = Number.isFinite(seams[index]) ? Number.POSITIVE_INFINITY : 0;
  }
  return roadToNearest(centre, out);
}

/**
 * The road from each side of each row to the nearest row whose side has a
 * seam in `seams`, in metres, into `out`: nought on a row with one, and
 * `Infinity` where no row has one — {@link roadToNone}'s other half.
 */
function roadToSeam(
  centre: readonly CorridorPoint[],
  seams: Float64Array,
  out: Float64Array,
): Float64Array {
  const rows = centre.length;
  for (let index = 0; index < rows * 2; index += 1) {
    out[index] = Number.isFinite(seams[index]) ? 0 : Number.POSITIVE_INFINITY;
  }
  return roadToNearest(centre, out);
}

/**
 * Each entry of `out`, no more than any other row's on its side plus the
 * road between them, in place: one pass forward and one back, as
 * {@link tapered}'s.
 */
function roadToNearest(centre: readonly CorridorPoint[], out: Float64Array): Float64Array {
  const rows = centre.length;
  const gap = (row: number): number => {
    const from = centre[row] as CorridorPoint;
    const to = centre[row + 1] as CorridorPoint;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    return Math.sqrt(dx * dx + dz * dz);
  };
  for (let row = 1; row < rows; row += 1) {
    const apart = gap(row - 1);
    for (let side = 0; side < 2; side += 1) {
      const at = row * 2 + side;
      out[at] = Math.min(out[at] as number, (out[at - 2] as number) + apart);
    }
  }
  for (let row = rows - 2; row >= 0; row -= 1) {
    const apart = gap(row);
    for (let side = 0; side < 2; side += 1) {
      const at = row * 2 + side;
      out[at] = Math.min(out[at] as number, (out[at + 2] as number) + apart);
    }
  }
  return out;
}

/**
 * How much deeper a side may sink past its seam for each metre of road it is
 * from a row whose side has only the shallow seam, or none: **2** — #2101,
 * as the reach's own taper is ({@link REACH_TAPER_PER_METRE}).
 *
 * ⚠️ Rule 3 of {@link seamReach} holds on one row and fails on the next, so
 * a side sunk tens of metres stood beside one sunk a metre at most, and the
 * triangles between them stood on end: |ny| 0.029, measured on a road with a
 * 100° bend before a 145° one.
 *
 * ⚠️ **1.5, not the taper's 2, since the owner's ruling of 2026-11-03**: where
 * a deep side met a shallow one, two metres of road apart, 2 stood the
 * ground between them at |ny| 0.44 in view, on a 147° bend at 3 %, and
 * 1.75 still did. 0.75 and 0.5 stood triangles on end on the graded corners
 * too (|ny| 0.141 at 140° and 6 %), measured. 1 and 1.25 pass every test:
 * 1.5 is kept for the deeper sinking under the other leg's ground, which is
 * not measured (#2117's review; `landform.test.ts` says so where it holds it).
 */
const SEAM_DEEPEN_PER_METRE = 1.5;

/**
 * How far along the road from a row whose side has a seam the relief takes to
 * be let rise above the road again inside the line, in metres: **100** —
 * #2101, the owner's ruling of 2026-11-04. @see terrainCorridor
 *
 * ⚠️ **What stopped a bank standing beyond the bend on the approach.** Within
 * the line each side's relief was held to {@link RELIEF_SLOPE} a metre from
 * it, both ways, so between a leg's clear band and the line it could still
 * rise a few metres and fall back to the line: a ridge along the far leg,
 * between it and the rider coming up to the bend, whose face towards the
 * rider is front-facing and drawn. Before #2101 the same ground rose all the
 * way out, so that face looked away from the rider and was culled, and the
 * far leg's road showed through: the owner's frames at 143°. So beside a seam
 * the relief may fall but not rise, and the hold on its rising part is let go
 * along the road from the last row with a seam rather than dropped there — a
 * dropped hold is the crease #2117's review found on the meeting height.
 * Past the line the relief may fall again as it did before #2101, rather
 * than being held flat: on a descent the approach's ground past its line,
 * flat at the meeting height, stood over the lower far leg's road.
 *
 * Measured on the graded corners: 10 and 30 step the ground by more than a
 * metre a metre between rows where a seam ends (35 and 13 tests red), and
 * holding the rise everywhere a corridor has a seam reds 114. 50 passes,
 * and so does 400: nothing measured holds it from above, so 100 is twice
 * the least that passes, not a measured optimum.
 */
const SEAM_CREST_FADE_METRES = 100;

/**
 * The storage {@link terrainCorridor} writes into, and the row count it is
 * sized for — #469.
 *
 * ⚠️ **Lent, not owned**, which is {@link terrainIndices}' pattern extended to
 * the four arrays that change every frame and the two a frame works in. A
 * corridor's row count is fixed for its configuration (`terrain.ts`
 * §`roadCorridor` strides to stay inside `MAXIMUM_CORRIDOR_QUADS`), so after
 * the first frame of a ride nothing here is allocated again; a row count that
 * does change — a different route, a different corridor — replaces the lot.
 * Until #469 a frame allocated all six, about 66 KiB, measured.
 */
let terrainScratch:
  | {
      readonly rows: number;
      readonly vertices: Float32Array;
      readonly normals: Float32Array;
      readonly colours: Float32Array;
      readonly fields: Float32Array;
      /** {@link foldReach}'s answer, which {@link clearReach} then tightens in place. */
      readonly reach: Float64Array;
      /** {@link steadied}'s answer. */
      readonly steadied: Float64Array;
      /** {@link seamReach}'s answer. */
      readonly seams: Float64Array;
      /** {@link seamReach}'s shallow answer. */
      readonly shallow: Float64Array;
      /** The other leg's road height at each shallow seam. @see seamReach */
      readonly meets: Float64Array;
      /** {@link roadToNone}'s answer over the full seams. */
      readonly depths: Float64Array;
      /** The shallow seams, {@link tapered} along the road. @see meetingRises */
      readonly lines: Float64Array;
      /** {@link meetingRises}' answer. */
      readonly rises: Float64Array;
      /** {@link roadToSeam}'s answer over the shallow seams. */
      readonly away: Float64Array;
      /** The fold's own reach, steadied, before the taper: {@link closeFans}'. */
      readonly folds: Float64Array;
    }
  | undefined;

/** The build that lent {@link terrainScratch} last. @see TerrainMesh.lease */
let terrainLease = 0;

function terrainScratchFor(rows: number): NonNullable<typeof terrainScratch> {
  if (terrainScratch?.rows === rows) {
    return terrainScratch;
  }
  const vertexCount = rows * COLUMNS * 2;
  terrainScratch = {
    rows,
    vertices: new Float32Array(vertexCount * 3),
    normals: new Float32Array(vertexCount * 3),
    colours: new Float32Array(vertexCount * 3),
    fields: new Float32Array(vertexCount * 2),
    reach: new Float64Array(rows * 2),
    steadied: new Float64Array(rows * 2),
    seams: new Float64Array(rows * 2),
    shallow: new Float64Array(rows * 2),
    meets: new Float64Array(rows * 2),
    depths: new Float64Array(rows * 2),
    lines: new Float64Array(rows * 2),
    rises: new Float64Array(rows * 2),
    away: new Float64Array(rows * 2),
    folds: new Float64Array(rows * 2),
  };
  return terrainScratch;
}

/** Whether a mesh's buffers are still the ones its build wrote. @see TerrainMesh.lease */
export function terrainMeshIsCurrent(mesh: TerrainMesh): boolean {
  return mesh.lease === undefined || mesh.lease === terrainLease;
}

/**
 * The things in `items` that stand over a triangle of `mesh`, in order, each
 * at the height of the ground drawn under it — #2099 and #2101.
 *
 * ⚠️ **What keeps scenery off ground that is not drawn — #2099.** Everything
 * beside the road is placed by a function of the ROUTE (`scatter.ts`,
 * `settlements.ts`), and the ground's reach is a function of the FRAME:
 * {@link foldReach} pulls a sharp bend's inside in, and since #2096
 * {@link tapered} lets it back out at {@link REACH_TAPER_PER_METRE}, so for
 * some way before and after the bend the inside's ground stops short of where
 * the scenery stands. Measured on a planner's 90° corner before this existed:
 * 26 items of about 6 000 (14 mirrored), 12 to 42 m from the road, standing
 * over sky. Only this frame's triangles can say where the ground is, so they
 * are what is asked.
 *
 * ⚠️ **And what stands each on the ground a rider sees — #2101.** An item's
 * own `y` is `terrainHeightAt`'s, which knows nothing of a fold, the taper, or
 * {@link seamReach}'s hold, and nothing of which leg's ground is under it on
 * the inside of a very sharp bend: on the owner's course a boulder stood 4 m
 * over the ground there, and a fir 1.7 m. So `y` is replaced by the height of
 * the highest triangle under the item, which is the one drawn on top. A place
 * where the two agree, which is nearly everywhere, keeps the item as it is.
 *
 * Each item is tested against the triangles between the two rows whose
 * cross-sections it lies between, both sides and every band: the same
 * triangles {@link terrainIndices} hands the renderer. A row's cross-section
 * is the line through its two road-edge vertices, so which side of it a point
 * lies on is one product; a point is only ever measured against the few pairs
 * of rows whose cross-sections it lies between, which on a straight road is
 * one. Nothing moves in plan: an item is kept or dropped, and lifted or
 * lowered onto the ground.
 *
 * Lent storage, like {@link terrainCorridor}'s: valid for the mesh it was
 * asked about, and asked about in the same frame it was built in.
 */
export function standingOnGround<
  T extends { readonly x: number; readonly y: number; readonly z: number },
>(items: readonly T[], mesh: TerrainMesh): readonly T[] {
  const across = rowCrossings(mesh);
  const fanned = fannedPairs(mesh);
  const kept: T[] = [];
  for (const item of items) {
    const y = groundTop(mesh, across, fanned, item.x, item.z);
    if (Number.isNaN(y)) continue;
    kept.push(y === item.y ? item : { ...item, y });
  }
  return kept;
}

/**
 * Each row's cross-section, four numbers a row: the point between its two
 * road edges and the unit heading along the road there. Lent, like
 * {@link terrainScratch}.
 */
let crossings = new Float64Array(0);

function rowCrossings(mesh: TerrainMesh): Float64Array {
  const { vertices, rows } = mesh;
  if (crossings.length !== rows * 4) {
    crossings = new Float64Array(rows * 4);
  }
  for (let row = 0; row < rows; row += 1) {
    // Column 0 of side 0, and of side 1: the road's two edges, which lie on
    // the row's own normal through its centreline point.
    const right = row * COLUMNS * 2 * 3;
    const left = right + COLUMNS * 3;
    const rx = vertices[right] as number;
    const rz = vertices[right + 2] as number;
    const lx = vertices[left] as number;
    const lz = vertices[left + 2] as number;
    const nx = rx - lx;
    const nz = rz - lz;
    const length = Math.sqrt(nx * nx + nz * nz);
    crossings[row * 4] = (rx + lx) / 2;
    crossings[row * 4 + 1] = (rz + lz) / 2;
    // The normal is `(−z, x)` of the heading (`terrain.ts`), so the heading
    // is `(z, −x)` of the normal. A collapsed row has none: 0, which puts
    // every point on its cross-section, and the triangles decide.
    crossings[row * 4 + 2] = length > 0 ? nz / length : 0;
    crossings[row * 4 + 3] = length > 0 ? -nx / length : 0;
  }
  return crossings;
}

/**
 * Which pairs of rows have a triangle {@link closeFan} drew, by the pair's
 * first row: 1 if so. Lent, like {@link crossings}.
 *
 * ⚠️ **A fan's triangles lie off the cross-sections of their rows** — #2149:
 * its point is not between the cross-sections of every pair it closes on, so
 * asking only the pairs a point lies between never reaches them, and scenery
 * over a fan stood on the ground of another leg, or was dropped. A pair is a
 * fan's when a side's outermost column is one point on a row and its
 * neighbour, which a fold alone never does: it collapses a row's columns onto
 * that row's own end. The pair before a fan's first row and the one after
 * its last are its, too: their quads end on the point.
 */
let fannedRows = new Uint8Array(0);

function fannedPairs(mesh: TerrainMesh): Uint8Array {
  const { vertices, rows } = mesh;
  if (fannedRows.length !== rows) fannedRows = new Uint8Array(rows);
  fannedRows.fill(0);
  for (let side = 0; side < 2; side += 1) {
    for (let row = 0; row + 1 < rows; row += 1) {
      const a = ((row * 2 + side) * COLUMNS + COLUMNS - 1) * 3;
      const b = a + COLUMNS * 2 * 3;
      if (vertices[a] !== vertices[b] || vertices[a + 2] !== vertices[b + 2]) continue;
      // Rows `row` and `row + 1` share the point: the pair between them, the
      // one before `row` and the one after `row + 1` are the fan's.
      fannedRows[row] = 1;
      if (row > 0) fannedRows[row - 1] = 1;
      if (row + 2 < rows) fannedRows[row + 1] = 1;
    }
  }
  return fannedRows;
}

/**
 * How far past a cross-section, in metres, a point still counts as between
 * two rows: **1 cm**, for Float32 vertices a kilometre from the origin. Only
 * which triangles are asked depends on it; the triangles decide.
 */
const CROSSING_SLACK_METRES = 1e-2;

/** The highest ground triangle's height over a point in plan, or `NaN` where there is none. */
function groundTop(
  mesh: TerrainMesh,
  across: Float64Array,
  fanned: Uint8Array,
  x: number,
  z: number,
): number {
  const along = (row: number): number =>
    (x - (across[row * 4] as number)) * (across[row * 4 + 2] as number) +
    (z - (across[row * 4 + 1] as number)) * (across[row * 4 + 3] as number);
  let top = Number.NaN;
  let behind = along(0);
  for (let row = 0; row + 1 < mesh.rows; row += 1) {
    const ahead = along(row + 1);
    if ((behind >= -CROSSING_SLACK_METRES && ahead <= CROSSING_SLACK_METRES) || fanned[row] === 1) {
      top = topOfRowPair(mesh.vertices, row, x, z, top);
    }
    behind = ahead;
  }
  return top;
}

/**
 * The higher of `top` and every ground triangle's height over a point between
 * `row` and the next, either side. `NaN` stays `NaN` only where none is under it.
 */
function topOfRowPair(
  vertices: Float32Array,
  row: number,
  x: number,
  z: number,
  top: number,
): number {
  const perRow = COLUMNS * 2;
  let highest = top;
  for (let side = 0; side < 2; side += 1) {
    for (let band = 0; band < TERRAIN_BANDS; band += 1) {
      const a = row * perRow + side * COLUMNS + band;
      const b = a + 1;
      const c = a + perRow;
      const d = c + 1;
      // {@link terrainIndices}' two triangles of the quad, whichever way wound.
      highest = heightIn(vertices, a, b, c, x, z, highest);
      highest = heightIn(vertices, b, d, c, x, z, highest);
    }
  }
  return highest;
}

/**
 * The higher of `top` and a triangle's height over a point, if the point lies
 * in it in plan, edges included; `top` if it does not.
 */
function heightIn(
  vertices: Float32Array,
  a: number,
  b: number,
  c: number,
  x: number,
  z: number,
  top: number,
): number {
  const ax = vertices[a * 3] as number;
  const az = vertices[a * 3 + 2] as number;
  const bx = vertices[b * 3] as number;
  const bz = vertices[b * 3 + 2] as number;
  const cx = vertices[c * 3] as number;
  const cz = vertices[c * 3 + 2] as number;
  const area = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
  // A folded row's outer columns are one point: a triangle with no area
  // covers nothing.
  if (!(Math.abs(area) > 1e-9)) return top;
  const u = ((bx - x) * (cz - z) - (cx - x) * (bz - z)) / area;
  const v = ((cx - x) * (az - z) - (ax - x) * (cz - z)) / area;
  const w = 1 - u - v;
  if (u < -1e-6 || v < -1e-6 || w < -1e-6) return top;
  const height =
    u * (vertices[a * 3 + 1] as number) +
    v * (vertices[b * 3 + 1] as number) +
    w * (vertices[c * 3 + 1] as number);
  return Number.isNaN(top) || height > top ? height : top;
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
  return { tops, foot: low - 20, middle, base: low - 1_000 };
}

/** Relief fields that contribute nothing — for the clear band, where there is none. */
const NO_RELIEF: ReliefFields = { near: 0, far: 0, mottle: 0, tilt: 0 };

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

/** How many relief layers {@link reliefFields} reads a node's hash under. */
const RELIEF_LAYERS = 7;

/**
 * The last two relief nodes' hashes — #569. A relief node is
 * {@link RELIEF_SPAN_METRES} of road, so the 135 rows of a corridor since #543
 * fall on three or four of them, and every row used to hash its two nodes
 * afresh: up to twelve hashes a row and side. A value here is the same pure
 * function of the seed, the node and the layer it always was; only the
 * repetition is gone.
 */
const reliefNodes = [0, 1].map(() => ({
  seed: Number.NaN,
  node: Number.NaN,
  values: new Float64Array(RELIEF_LAYERS),
}));
let reliefNodeVictim = 0;

function reliefNodeValue(seed: number, node: number, layer: number): number {
  for (let slot = 0; slot < reliefNodes.length; slot += 1) {
    const entry = reliefNodes[slot] as (typeof reliefNodes)[number];
    if (entry.seed === seed && entry.node === node) {
      // The other slot is the one to evict next, so a row's two nodes never
      // push each other out.
      reliefNodeVictim = 1 - slot;
      return entry.values[layer] as number;
    }
  }
  const slot = reliefNodeVictim;
  const entry = reliefNodes[slot] as (typeof reliefNodes)[number];
  entry.seed = seed;
  entry.node = node;
  for (let each = 0; each < RELIEF_LAYERS; each += 1) {
    entry.values[each] = uniformFrom(slotHash(seed, node, RELIEF_KEY + each), 0);
  }
  reliefNodeVictim = 1 - slot;
  return entry.values[layer] as number;
}

function reliefFields(
  profile: RouteProfile,
  seed: number,
  wrapped: number,
  side: number,
  /**
   * How far out anything will be read. The far field and the mottle cost two
   * hashes each and a tree beside the road never reads either — its column
   * bracket ends well inside the far field's blend, and a height has no colour
   * — so a caller that knows says so, and the fields are not drawn.
   */
  reading: 'everything' | 'height-near-the-road' = 'everything',
): ReliefFields {
  const nodes = Math.max(2, Math.round(profile.totalDistance / RELIEF_SPAN_METRES));
  const at = (wrapped / profile.totalDistance) * nodes;
  const node = Math.floor(at);
  const ramp = smoothstep01(at - node);
  const field = (layer: number): number => {
    const from = reliefNodeValue(seed, node % nodes, layer);
    const to = reliefNodeValue(seed, (node + 1) % nodes, layer);
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
  const nearOnly = reading === 'height-near-the-road';
  return {
    near: field(side),
    far: nearOnly ? 0 : field(2 + side),
    mottle: nearOnly ? 0 : field(4 + side),
    tilt: CROSS_SLOPE_PER_GRADE * grade * (side === 0 ? uphill : -uphill),
  };
}

/**
 * What the ground is multiplied by where it is wet, linear RGB — #501: darker,
 * and browner, the colour of the mud at a stream's edge. This repository's
 * own, like every other ground colour here (`world.ts` §Provenance).
 */
export const WET_GROUND_TINT: readonly [number, number, number] = [0.5, 0.44, 0.34];

/**
 * How far above the water the ground is still wet, in metres: **1.2** — #501.
 *
 * ⚠️ **A height, not a distance from the shore**, and that is the point: the
 * ground's rows are ten metres apart and slide with the rider, so where the
 * drawn ground comes up out of the water moves with them, and a margin placed
 * by distance would sit beside the shoreline rather than on it. A margin by
 * height is wherever the ground IS just above the water, however the rows fall.
 */
export const WET_MARGIN_METRES = 1.2;

/**
 * How wet the ground is at `height`, beside water whose surface is at `level`,
 * from 1 at the water's surface (and under it) to 0 at {@link WET_MARGIN_METRES}
 * above it — #501. `level` is `-Infinity` where no water is near: dry.
 */
export function wetness(height: number, level: number): number {
  if (!Number.isFinite(level)) return 0;
  return 1 - smoothstep01((height - level) / WET_MARGIN_METRES);
}

/**
 * The points {@link reliefHolds} is asked about, `x, z` pairs — a column each
 * of one cross-section — and its answers. Module storage, so a build
 * allocates nothing for them (#469).
 */
const LEVEL_POINTS = new Float64Array(COLUMNS * 2);
const LEVEL_HOLDS = new Float64Array(COLUMNS);

/**
 * The most the relief may rise or fall at each of the first `count` of
 * {@link LEVEL_POINTS}, in metres, into {@link LEVEL_HOLDS} — #1547:
 * {@link RELIEF_SLOPE} times the distance to mapped built-up land, so none on
 * it. `Infinity` where none is near. @see LandClassMask.builtUpDistances
 */
function reliefHolds(land: LandClassMask, count: number): void {
  land.builtUpDistances(LEVEL_POINTS, count, LEVEL_HOLDS);
  for (let index = 0; index < count; index += 1) {
    LEVEL_HOLDS[index] = RELIEF_SLOPE * (LEVEL_HOLDS[index] as number);
  }
}

/**
 * The ground's height at a lateral offset beside a road at height `road`.
 *
 * ⚠️ **Never above the road inside {@link RELIEF_CLEAR_METRES}**: the drop is
 * at least zero, and the relief is exactly zero there. `hold` is
 * {@link reliefHolds}': the relief is held within it, and `Infinity` holds
 * nothing. `crest` holds only its rising part, and no more loosely than `hold`
 * does — #2101's ruling of 2026-11-04 (@see SEAM_CREST_FADE_METRES).
 */
function groundHeight(
  road: number,
  fields: ReliefFields,
  lateral: number,
  water: WaterShaping,
  hold: number,
  crest: number,
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
  // #1547: held to the town's; `Math.min` of `Infinity` is the relief's own
  // bound, so where nothing is mapped this is the line it always was.
  const most = Math.min(RELIEF_MAX_METRES, hold);
  // #459: the water's bed is a ceiling. Under a bridge that includes the road's
  // own edge, which is the bridge's opening.
  return Math.min(
    water.ceiling,
    road - drop + Math.min(Math.min(most, crest), Math.max(-most, relief)),
  );
}

/**
 * How far each row's ground may reach on each side before a bend folds it —
 * two numbers a row, the normal's side (the right, since #583) then the other.
 *
 * The turn is read from the corridor's own normals either side of the row, so
 * it is the bend the road is actually drawn round.
 */
function foldReach(
  centre: readonly CorridorPoint[],
  normals: Float64Array,
  reach: Float64Array,
): Float64Array {
  reach.fill(Number.POSITIVE_INFINITY);
  // ⚠️ **Per quad, since #543.** Each pair of neighbouring rows is a strip of
  // quads, and it folds on the inside wherever its two cross-sections meet —
  // `apart / turn` out from the road, and both of its rows are held inside
  // that. This used to read one curvature per row from the rows either side,
  // which is the same thing while the rows are evenly spaced; #543 made them
  // two metres apart near the rider and a grid step beyond, and at that seam
  // a two-metre quad whose far cross-section is a ten-metre chord's turns
  // three times as sharply as the window around it said — measured, as a
  // triangle wound towards the ground 27 m inside an 80 m circuit.
  for (let row = 0; row + 1 < centre.length; row += 1) {
    const from = centre[row] as CorridorPoint;
    const to = centre[row + 1] as CorridorPoint;
    const apart = Math.hypot(to.x - from.x, to.z - from.z);
    if (!(apart > 0)) {
      continue;
    }
    const ax = normals[row * 2] as number;
    const az = normals[row * 2 + 1] as number;
    const bx = normals[(row + 1) * 2] as number;
    const bz = normals[(row + 1) * 2 + 1] as number;
    // Positive when the road turns toward its normal: that side is inside.
    const turn = Math.atan2(ax * bz - az * bx, ax * bx + az * bz);
    const curvature = turn / apart;
    if (curvature === 0) {
      continue;
    }
    const limit = BEND_FOLD_SHARE / Math.abs(curvature);
    // ⚠️ The sign convention is `terrain.ts`'s: the normal is `(−z, x)` of
    // the heading — the rider's RIGHT, on the screen and, since #583, on the
    // map — and a bend toward it is a POSITIVE cross product, so side 0 is the
    // inside. It was called the LEFT normal until #583, when the world was a
    // mirror of its map. `landform.test.ts` §"folds the inside of a bend in,
    // on the correct side" pins which is which.
    // Written on the pair's first row only: {@link steadied} takes each row's
    // reach down to the least of its neighbours', which carries it to the
    // second.
    const at = row * 2 + (curvature > 0 ? 0 : 1);
    reach[at] = Math.min(reach[at] as number, limit);
  }
  return reach;
}

/**
 * How near the point where two neighbouring rows' cross-sections meet a side
 * must reach, on both rows, for {@link closeFan} to start a fan from that
 * pair: at least **0.75** of the way. {@link BEND_FOLD_SHARE} stops a folded
 * side at 0.9 of it, and {@link steadied} at the least of three rows'.
 * Measured: at 1 the pocket stays open on 18 of `landform.test.ts`' 24
 * corners; 0.5 passes too, so it is held from above only.
 */
const FAN_SHARE = 0.75;

/**
 * How far either way of where a fan's first pair of rows meet
 * {@link closeFan} may close it, in metres: **2**. Measured: at 0.2 one of
 * `landform.test.ts`' 24 corners keeps its pocket; 10 passes too, so it is
 * held from below only.
 */
const FAN_BOX_METRES = 2;

/**
 * Twice the area in plan, in square metres, that every triangle
 * {@link closeFan} makes is held to at least: **1e-3**, so none is left on
 * its edge by the point's rounding to a `Float32Array`. ⚠️ A guard, not a
 * measured bound: nought passes every test.
 */
const FAN_MARGIN = 1e-3;

/**
 * How steep a triangle {@link closeFan} makes may stand, as the upward share
 * of its normal: |ny| no less than **0.5**, 60° — the bound `landform.test.ts`
 * holds the ground a rider sees to on a level road or at 3 %
 * (`GENTLE_STEEPEST`). A row whose end is sunk past a seam, under another
 * leg's ground, stands at another height from its neighbours', and gathering
 * it would stand a wall between them. Measured without it: 25 more triangles
 * near the apex steeper than this on the 140° bends of 6 m climbing at 10 %
 * (`landform.test.ts` §"closes the apex on one point").
 */
const FAN_STEEPEST = 0.5;

/**
 * Closes the inside of every bend whose fold stops the ground short of the
 * bend's centre, near the road — #2149 — in place, on the columns of each
 * side that the reach collapsed onto the side's end.
 *
 * ⚠️ **What left the pocket at a very sharp bend's apex.** {@link foldReach}
 * stops each row's inside short of where its cross-section meets the next
 * row's, so the rows round a bend end on a ring short of the bend's centre,
 * and inside that ring no ground lay at all. The legs' ground, square to the
 * straights, covers its own side of the centre and not the bend's. On the
 * owner's 143° bend the inside reach fell to 4.3–5.1 m and the ring left a
 * pocket about 0.3 × 1.3 m, where the horizon ring, drawn first and writing
 * no depth, showed as a flat grey shape. `landform.test.ts` reproduces it on
 * a corner sampled every 10 m, as the owner's course is.
 *
 * So every run of neighbouring rows whose side the fold stops — its reach is
 * `folds`', the fold's own, steadied, and nothing nearer stopped it — is
 * handed to {@link closeFan}, which moves those columns of as many of them as
 * it can to one point, closing their quads on it as a fan. Nothing else
 * moves, so nothing the ground covered is uncovered, and no triangle or draw
 * call is added.
 *
 * ⚠️ **Only within the clear band** ({@link RELIEF_CLEAR_METRES}), where the
 * ground has no relief and every end a fan gathers stands at about one
 * height. A bend whose centre lies further out keeps its pocket there, and
 * that is stated rather than closed. Measured without that bound: the ground
 * `landform-levelling.test.ts` holds to main's digests moved, and on a
 * planner's route `standingOnGround` disagreed with the triangles and a
 * side's reach stepped faster than {@link REACH_TAPER_PER_METRE} allows.
 */
function closeFans(
  centre: readonly CorridorPoint[],
  normals: Float64Array,
  reach: Float64Array,
  folds: Float64Array,
  vertices: Float32Array,
  fields: Float32Array,
): void {
  const rows = centre.length;
  const outermost = TERRAIN_COLUMN_OFFSETS[COLUMNS - 1] as number;
  for (let side = 0; side < 2; side += 1) {
    let first = -1;
    for (let row = 0; row <= rows; row += 1) {
      const limit = row < rows ? (reach[row * 2 + side] as number) : Number.POSITIVE_INFINITY;
      if (limit < outermost && limit >= (folds[row * 2 + side] as number)) {
        if (first < 0) first = row;
        continue;
      }
      if (first >= 0 && row - 1 > first) {
        closeFan(centre, normals, reach, vertices, fields, side, first, row - 1);
      }
      first = -1;
    }
  }
}

/**
 * {@link closeFans}' one run of rows, `start` to `stop`: as many of them as
 * can be closed on one point, grown out a row at a time from the pair whose
 * cross-sections meet nearest the road for as long as {@link fanFits} finds
 * a point for them.
 *
 * ⚠️ **Every column a row's reach collapsed onto its end moves, not only the
 * outermost**, so the fan is drawn in the band just past that end, which
 * every rung draws, and not in the outermost band, which `quality.ts`' rungs
 * below level 0 leave out: they draw ten bands or fewer of the twelve.
 * `landform.test.ts` holds the pocket at the fewest bands any rung draws, and
 * with the outermost column alone moved it is red on 19 of its 24 corners.
 */
function closeFan(
  centre: readonly CorridorPoint[],
  normals: Float64Array,
  reach: Float64Array,
  vertices: Float32Array,
  fields: Float32Array,
  side: number,
  start: number,
  stop: number,
): void {
  const sign = side === 0 ? 1 : -1;
  // The seed: the pair whose cross-sections meet nearest the road, of the
  // pairs that reach {@link FAN_SHARE} of the way there.
  let seed = -1;
  let nearest = Number.POSITIVE_INFINITY;
  for (let row = start; row < stop; row += 1) {
    const from = centre[row] as CorridorPoint;
    const to = centre[row + 1] as CorridorPoint;
    // `from + a·t = to − b·u`, `a` and `−b` the two rows' normals on this side.
    const ax = sign * (normals[row * 2] as number);
    const az = sign * (normals[row * 2 + 1] as number);
    const bx = -sign * (normals[(row + 1) * 2] as number);
    const bz = -sign * (normals[(row + 1) * 2 + 1] as number);
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const det = ax * bz - az * bx;
    if (!(Math.abs(det) > SEAM_EPSILON)) continue;
    const t = (dx * bz - dz * bx) / det;
    const u = (ax * dz - az * dx) / det;
    if (!(t > 0 && u > 0 && t < nearest)) continue;
    if ((reach[row * 2 + side] as number) < FAN_SHARE * t) continue;
    if ((reach[(row + 1) * 2 + side] as number) < FAN_SHARE * u) continue;
    nearest = t;
    seed = row;
    FAN_SEED[0] = from.x + ax * t;
    FAN_SEED[1] = from.z + az * t;
  }
  if (seed < 0) return;
  // Each row's first column to move: the one after the first that its
  // reach collapsed onto its end, or the outermost if none did.
  if (fanFrom.length < centre.length) fanFrom = new Int32Array(centre.length);
  for (let row = start; row <= stop; row += 1) {
    const outer = groundVertex(side, row, COLUMNS - 1);
    let from = COLUMNS - 1;
    for (let column = COLUMNS - 2; column >= 2; column -= 1) {
      const at = groundVertex(side, row, column);
      if (vertices[at] !== vertices[outer] || vertices[at + 2] !== vertices[outer + 2]) break;
      from = column + 1;
    }
    fanFrom[row] = from;
  }
  let first = seed;
  let end = seed + 1;
  if (!fanFits(centre, normals, vertices, side, first, end)) return;
  for (let grown = true; grown;) {
    grown = false;
    if (end < stop && fanFits(centre, normals, vertices, side, first, end + 1)) {
      end += 1;
      grown = true;
    }
    if (first > start && fanFits(centre, normals, vertices, side, first - 1, end)) {
      first -= 1;
      grown = true;
    }
  }
  // `FAN_POINT` holds the point of the last `(first, end)` that fitted, which
  // is the current one: a call that fails returns before it writes.
  const x = FAN_POINT[0] as number;
  const y = FAN_POINT[1] as number;
  const z = FAN_POINT[2] as number;
  for (let row = first; row <= end; row += 1) {
    const point = centre[row] as CorridorPoint;
    const lateral = sign * Math.hypot(x - point.x, z - point.z);
    for (let column = fanFrom[row] as number; column < COLUMNS; column += 1) {
      const at = groundVertex(side, row, column);
      vertices[at] = x;
      vertices[at + 1] = y;
      vertices[at + 2] = z;
      fields[(at / 3) * 2 + 1] = lateral;
    }
  }
}

/**
 * Whether rows `first` to `end` of a side can close on one point, and where,
 * into {@link FAN_POINT}: `x`, height, `z` — each row's columns from
 * {@link fanFrom} on standing at it.
 *
 * Each triangle that the point is one corner of faces up on one side of the
 * line through its other two, so the points that turn none over are the
 * inside of a convex polygon. It is clipped from a box {@link FAN_BOX_METRES}
 * either way of {@link FAN_SEED} by those lines, and by each moved row's own:
 * no further out along its cross-section than {@link RELIEF_CLEAR_METRES}.
 * The point is the mean of the polygon's corners, inside it, at the mean
 * height of the rows' ends; and no triangle it makes may stand steeper than
 * {@link FAN_STEEPEST}. Only columns at or past a row's end move, so nothing
 * the ground covered is uncovered.
 */
function fanFits(
  centre: readonly CorridorPoint[],
  normals: Float64Array,
  vertices: Float32Array,
  side: number,
  first: number,
  end: number,
): boolean {
  const rows = centre.length;
  const sign = side === 0 ? 1 : -1;
  const seedX = FAN_SEED[0] as number;
  const seedZ = FAN_SEED[1] as number;
  // A box's four corners, and at most one more for each line: two for each
  // band of each quad, and one for each row.
  const most = 4 + (end - first + 2) * TERRAIN_BANDS * 2 + (end - first + 1);
  if (fanPolygon.length < most * 2) {
    fanPolygon = new Float64Array(most * 2);
    fanClipped = new Float64Array(most * 2);
  }
  fanPolygon[0] = seedX - FAN_BOX_METRES;
  fanPolygon[1] = seedZ - FAN_BOX_METRES;
  fanPolygon[2] = seedX + FAN_BOX_METRES;
  fanPolygon[3] = seedZ - FAN_BOX_METRES;
  fanPolygon[4] = seedX + FAN_BOX_METRES;
  fanPolygon[5] = seedZ + FAN_BOX_METRES;
  fanPolygon[6] = seedX - FAN_BOX_METRES;
  fanPolygon[7] = seedZ + FAN_BOX_METRES;
  let count = 4;
  // Each quad from the row before the run to its last row, band by band, as
  // its two triangles (`a b c` and `b d c`), a moved column standing for the
  // point: `-1`.
  for (let row = Math.max(0, first - 1); row <= end && row + 1 < rows; row += 1) {
    for (let band = 0; band < TERRAIN_BANDS; band += 1) {
      const a = fanCorner(side, first, end, row, band);
      const b = fanCorner(side, first, end, row, band + 1);
      const c = fanCorner(side, first, end, row + 1, band);
      const d = fanCorner(side, first, end, row + 1, band + 1);
      for (let half = 0; half < 2; half += 1) {
        const p = half === 0 ? a : b;
        const q = half === 0 ? b : d;
        // A triangle with the point at two corners, or none, has no say.
        if ((p < 0 ? 1 : 0) + (q < 0 ? 1 : 0) + (c < 0 ? 1 : 0) !== 1) continue;
        const at = fanTurn(vertices, side, p, q, c, 0, 0);
        const alongX = fanTurn(vertices, side, p, q, c, 1, 0) - at;
        const alongZ = fanTurn(vertices, side, p, q, c, 0, 1) - at;
        // Nor does one whose other two corners are one point: it has no area
        // wherever the point is.
        if (!(Math.abs(alongX) + Math.abs(alongZ) > SEAM_EPSILON)) continue;
        count = clipped(count, alongX, alongZ, at - FAN_MARGIN);
        if (count === 0) return false;
      }
    }
  }
  for (let row = first; row <= end; row += 1) {
    const point = centre[row] as CorridorPoint;
    const nx = sign * (normals[row * 2] as number);
    const nz = sign * (normals[row * 2 + 1] as number);
    const out = nx * point.x + nz * point.z;
    count = clipped(count, -nx, -nz, RELIEF_CLEAR_METRES + out);
    if (count === 0) return false;
  }
  let x = 0;
  let z = 0;
  for (let k = 0; k < count; k += 1) {
    x += fanPolygon[k * 2] as number;
    z += fanPolygon[k * 2 + 1] as number;
  }
  x /= count;
  z /= count;
  let y = 0;
  for (let row = first; row <= end; row += 1) {
    y += vertices[groundVertex(side, row, COLUMNS - 1) + 1] as number;
  }
  y /= end - first + 1;
  // The same triangles, each with its other two corners and the point.
  for (let row = Math.max(0, first - 1); row <= end && row + 1 < rows; row += 1) {
    for (let band = 0; band < TERRAIN_BANDS; band += 1) {
      const a = fanCorner(side, first, end, row, band);
      const b = fanCorner(side, first, end, row, band + 1);
      const c = fanCorner(side, first, end, row + 1, band);
      const d = fanCorner(side, first, end, row + 1, band + 1);
      for (let half = 0; half < 2; half += 1) {
        const p = half === 0 ? a : b;
        const q = half === 0 ? b : d;
        if ((p < 0 ? 1 : 0) + (q < 0 ? 1 : 0) + (c < 0 ? 1 : 0) !== 1) continue;
        const one = p < 0 ? q : p;
        const two = p < 0 || q < 0 ? c : q;
        if (!fanGentle(vertices, one, two, x, y, z)) return false;
      }
    }
  }
  FAN_POINT[0] = x;
  FAN_POINT[1] = y;
  FAN_POINT[2] = z;
  return true;
}

/** The index into `vertices` of a row's column on a side. */
function groundVertex(side: number, row: number, column: number): number {
  return (row * COLUMNS * 2 + side * COLUMNS + column) * 3;
}

/**
 * {@link groundVertex}, or `-1` for a column that rows `first` to `end` of a
 * fan move to its point ({@link fanFrom}).
 */
function fanCorner(side: number, first: number, end: number, row: number, column: number): number {
  return row >= first && row <= end && column >= (fanFrom[row] as number)
    ? -1
    : groundVertex(side, row, column);
}

/**
 * Twice a triangle's signed area in plan, its corners indices into
 * `vertices` and `-1` for `(x, z)`, wound as {@link terrainIndices} winds this
 * side's: positive faces up.
 */
function fanTurn(
  vertices: Float32Array,
  side: number,
  p: number,
  q: number,
  r: number,
  x: number,
  z: number,
): number {
  const second = side === 0 ? q : r;
  const third = side === 0 ? r : q;
  const ax = p < 0 ? x : (vertices[p] as number);
  const az = p < 0 ? z : (vertices[p + 2] as number);
  const bx = second < 0 ? x : (vertices[second] as number);
  const bz = second < 0 ? z : (vertices[second + 2] as number);
  const cx = third < 0 ? x : (vertices[third] as number);
  const cz = third < 0 ? z : (vertices[third + 2] as number);
  return (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
}

/**
 * Whether the triangle between two vertices and `(x, y, z)` stands no
 * steeper than {@link FAN_STEEPEST}: one with no area stands no way.
 */
function fanGentle(
  vertices: Float32Array,
  p: number,
  q: number,
  x: number,
  y: number,
  z: number,
): boolean {
  const e1x = (vertices[p] as number) - x;
  const e1y = (vertices[p + 1] as number) - y;
  const e1z = (vertices[p + 2] as number) - z;
  const e2x = (vertices[q] as number) - x;
  const e2y = (vertices[q + 1] as number) - y;
  const e2z = (vertices[q + 2] as number) - z;
  const nx = e1y * e2z - e1z * e2y;
  const ny = e1z * e2x - e1x * e2z;
  const nz = e1x * e2y - e1y * e2x;
  const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
  return !(length > FAN_MARGIN) || Math.abs(ny) / length >= FAN_STEEPEST;
}

/** Where a fan's first pair of rows meet, `x` then `z`: {@link closeFan}'s, for {@link fanFits}. */
const FAN_SEED = new Float64Array(2);

/** {@link fanFits}' point: `x`, height, `z`. */
const FAN_POINT = new Float64Array(3);

/**
 * Each row's first column {@link closeFan} moves, by row. Lent, like
 * {@link terrainScratch}: grown to the row count, never shrunk.
 */
let fanFrom = new Int32Array(0);

/**
 * {@link fanFits}' polygon, two numbers a corner, and the one {@link clipped}
 * clips it into: a box's four corners, and at most one more for each line.
 * Lent, like {@link terrainScratch}: grown to the most a run needs, never shrunk.
 */
let fanPolygon = new Float64Array(0);
let fanClipped = new Float64Array(0);

/**
 * {@link fanPolygon}'s first `count` corners, clipped IN PLACE to where
 * `a·x + b·z + c` is no less than nought: how many corners are left.
 */
function clipped(count: number, a: number, b: number, c: number): number {
  let kept = 0;
  for (let k = 0; k < count; k += 1) {
    const x1 = fanPolygon[k * 2] as number;
    const z1 = fanPolygon[k * 2 + 1] as number;
    const next = k + 1 === count ? 0 : k + 1;
    const x2 = fanPolygon[next * 2] as number;
    const z2 = fanPolygon[next * 2 + 1] as number;
    const v1 = a * x1 + b * z1 + c;
    const v2 = a * x2 + b * z2 + c;
    if (v1 >= 0) {
      fanClipped[kept * 2] = x1;
      fanClipped[kept * 2 + 1] = z1;
      kept += 1;
    }
    if (v1 >= 0 !== v2 >= 0) {
      const share = v1 / (v1 - v2);
      fanClipped[kept * 2] = x1 + (x2 - x1) * share;
      fanClipped[kept * 2 + 1] = z1 + (z2 - z1) * share;
      kept += 1;
    }
  }
  for (let k = 0; k < kept * 2; k += 1) fanPolygon[k] = fanClipped[k] as number;
  return kept;
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

/** The side of one cell of {@link clearReach}'s grid, in metres: a segment's own length. */
const CLEAR_CELL_METRES = 12;

/** How many halvings {@link clearReach} spends finding where a side must stop. */
const CLEAR_REACH_STEPS = 8;

/**
 * {@link clearReach}'s grid and the lists it empties into it, kept from one
 * frame to the next — #569. The grid's contents are rebuilt every call; only
 * the storage is kept, as `terrainScratch` keeps the ground's (#469).
 *
 * ⚠️ **Module scratch makes {@link clearReach} NON-REENTRANT** (#581, from
 * #569's review). One grid serves every call, so two calls interleaved — a
 * second landform built from inside the first, or from a worker sharing this
 * module instance — would empty each other's lists mid-walk. Nothing does
 * either today: a landform is built synchronously, start to finish, on one
 * thread. Anything that changes that owes this grid a per-caller copy.
 */
const clearCells = new Map<number, number[]>();
const clearListPool: number[][] = [];

/**
 * {@link foldReach}'s answer, tightened IN PLACE so that no column of the
 * ground stands within {@link ROAD_CLEARANCE_METRES} of any other stretch of
 * this corridor's road.
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
  // ⚠️ **A grid of the segments, so a point is only ever measured against the
  // few whose boxes — grown by the clearance — reach its cell.** Nearly every
  // point on nearly every row is in an empty cell and is refused in one
  // lookup. The first cut projected every column of every row onto every
  // segment, 0.50 ms of a frame; a box test on each took it to 0.15 ms, and the
  // grid to about a third of that again — measured, and the JS thread's cost
  // is the one #240's NFR-2 names.
  //
  // ⚠️ **Since #569 the grid and its lists are lent, a probe outside the whole
  // road's box is clear without a lookup, and the distance is compared
  // squared.** #543 made the corridor 135 rows of two-metre segments rather
  // than 47 of ten, so a cell beside the road holds about four times the
  // segments and there are three times the rows probing it: this function
  // became the largest single cost of a scene frame. None of the three moves
  // an answer — a list is emptied before it is reused, the box is grown by
  // the clearance, and `d² < c²` is `d < c` for the non-negative numbers
  // here. `landform.test.ts` §"does not depend on what was built before it"
  // is what holds the first.
  const cells = clearCells;
  for (const list of cells.values()) {
    list.length = 0;
    clearListPool.push(list);
  }
  cells.clear();
  const cellOf = (value: number): number => Math.floor(value / CLEAR_CELL_METRES);
  const key = (column: number, row: number): number => column * 100_003 + row;
  for (let segment = 0; segment + 1 < centre.length; segment += 1) {
    const from = centre[segment] as CorridorPoint;
    const to = centre[segment + 1] as CorridorPoint;
    const lowX = cellOf(Math.min(from.x, to.x) - ROAD_CLEARANCE_METRES);
    const highX = cellOf(Math.max(from.x, to.x) + ROAD_CLEARANCE_METRES);
    const lowZ = cellOf(Math.min(from.z, to.z) - ROAD_CLEARANCE_METRES);
    const highZ = cellOf(Math.max(from.z, to.z) + ROAD_CLEARANCE_METRES);
    for (let column = lowX; column <= highX; column += 1) {
      for (let cellRow = lowZ; cellRow <= highZ; cellRow += 1) {
        const at = key(column, cellRow);
        let list = cells.get(at);
        if (list === undefined) {
          list = clearListPool.pop() ?? [];
          cells.set(at, list);
        }
        list.push(segment);
      }
    }
  }
  // The whole road's box, grown by the clearance: a probe outside it is clear
  // without a lookup, which is most of the outer columns on most roads.
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const point of centre) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  minX -= ROAD_CLEARANCE_METRES;
  maxX += ROAD_CLEARANCE_METRES;
  minZ -= ROAD_CLEARANCE_METRES;
  maxZ += ROAD_CLEARANCE_METRES;
  const clearance = ROAD_CLEARANCE_METRES * ROAD_CLEARANCE_METRES;
  const clearOf = (x: number, z: number): boolean => {
    if (x < minX || x > maxX || z < minZ || z > maxZ) return true;
    const near = cells.get(key(cellOf(x), cellOf(z)));
    if (near === undefined) return true;
    for (let index = 0; index < near.length; index += 1) {
      const segment = near[index] as number;
      const from = centre[segment] as CorridorPoint;
      const to = centre[segment + 1] as CorridorPoint;
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const span = dx * dx + dz * dz;
      const t =
        span > 0 ? Math.min(1, Math.max(0, ((x - from.x) * dx + (z - from.z) * dz) / span)) : 0;
      const ox = x - (from.x + dx * t);
      const oz = z - (from.z + dz * t);
      if (ox * ox + oz * oz < clearance) {
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
 * How far out along each row's normal, each side, the ground stays nearer to
 * that row's own point of the road than to another leg of it whose ground
 * covers the rest — #2101. Two numbers a row, as {@link foldReach}'s, into
 * `out`; `Infinity` where no other leg does. And into `shallow`, the same for
 * another leg whose ground reaches the seam whether or not it covers the
 * rest, with that leg's road height there into `meets`.
 *
 * ⚠️ **What stops one leg's ground rising through another's.** On the inside
 * of a very sharp bend, and between a hairpin's legs, each leg's ground
 * reaches out across the other's: two sheets at two invented heights, since
 * the relief is keyed on the distance along the route, so where one stood
 * higher it rose through the other — seen on the owner's course leaving a
 * 143° bend. The seam is the line between the two legs, which both legs
 * find. {@link terrainCorridor} holds each leg's relief to
 * {@link RELIEF_SLOPE} times the distance to it — #1547's rule for a town's
 * edge — and moves each leg half the way to the other's road height
 * ({@link towardsSeam}), so the two meet on it at one height; and past it
 * sinks each leg's ground under the other's ({@link sunk}), drawing the
 * columns past it in towards it ({@link columnLaterals}). Nothing is taken
 * away, so the ground covers all it covered: cutting each leg back to the
 * line instead left sky where the other's ground did not reach. The reach,
 * the taper, the clearance and the draw calls are as they were.
 *
 * ⚠️ **A side only sinks under ground that is there**, or it would open a
 * pit where the overlap used to be. So a point `Q` of another leg takes over
 * only if all three hold:
 *
 * 1. **It is another leg**: the road there has turned through more than
 *    {@link SEAM_TURN_RADIANS} from the road here.
 * 2. **Its own ground reaches the seam**, by `reach` — the fold's, steadied,
 *    tapered and cleared of the road ({@link clearReach}).
 * 3. **Its ground covers the rest of this side's reach past the seam**: the
 *    rest of the ray runs to that leg's road, or to this side's reach, within
 *    the corridor along that leg and within its reach out from it. Past the
 *    two ends of the corridor there is no ground at all: measured, a leg cut
 *    back against the corridor's first rows left sky 40 m ahead of the camera
 *    at a 143° bend's apex. Where 1 and 2 hold and 3 does not, the side is
 *    held to the line and sunk no more than {@link SHALLOW_SINK_METRES} past
 *    it: the `shallow` answer. And from a row where 3 fails the sinking
 *    deepens only {@link SEAM_DEEPEN_PER_METRE} a metre along the road.
 *
 * And no seam nearer the road than {@link ROAD_CLEARANCE_METRES}: the other
 * road is then within twice that, which is `clearReach`'s, and it is where a
 * point-to-point route's rows, collapsed onto its first point, found a seam
 * at nought on the road ahead of them.
 *
 * Exact for the polyline, not probed. A point `t` out along the normal `n`
 * from the row's point `C` is as near a point `Q` as `C` is once
 * `t = |CQ|² / (2 n·CQ)`, and as `t` grows its distance to a stretch shrinks
 * no faster than `t` grows, so the first such `t` over a stretch is the least
 * of its two ends' and of the one where the stretch's own line comes within
 * `t`, if the foot then lies on the stretch. On a straight nothing answers.
 *
 * ⚠️ O(rows²): about 18 000 stretch-and-row pairs at the usual 135 rows,
 * nearly all refused on a sign or on the row's own reach. Allocates nothing.
 */
function seamReach(
  centre: readonly CorridorPoint[],
  normals: Float64Array,
  reach: Float64Array,
  out: Float64Array,
  /** Where rules 1 and 2 hold and 3 does not: {@link SHALLOW_SINK_METRES}. */
  shallow: Float64Array,
  /** The other leg's road height at each `shallow` seam, in local metres. */
  meets: Float64Array,
): Float64Array {
  out.fill(Number.POSITIVE_INFINITY);
  shallow.fill(Number.POSITIVE_INFINITY);
  const last = centre.length - 1;
  // ⚠️ **Nothing to do unless the corridor turns past rule 1's angle**, which
  // is most frames of most rides: no two rows can face further apart than the
  // whole corridor turns, and that is a sum along it. Without this a build on
  // a straight road took 40 % longer, measured.
  let turned = 0;
  let least = 0;
  let most = 0;
  for (let row = 1; row <= last; row += 1) {
    const ax = normals[(row - 1) * 2] as number;
    const az = normals[(row - 1) * 2 + 1] as number;
    const bx = normals[row * 2] as number;
    const bz = normals[row * 2 + 1] as number;
    turned += Math.atan2(ax * bz - az * bx, ax * bx + az * bz);
    least = Math.min(least, turned);
    most = Math.max(most, turned);
  }
  if (!(most - least > SEAM_TURN_RADIANS)) return out;
  for (let row = 0; row <= last; row += 1) {
    const point = centre[row] as CorridorPoint;
    const nx = normals[row * 2] as number;
    const nz = normals[row * 2 + 1] as number;
    // Every point but the row's own and the corridor's two ends — and none
    // facing within a right angle of this row, which rule 1 refuses anyway:
    // on a bend that is most of them, refused in two multiplications.
    for (let k = 1; k < last; k += 1) {
      if (k === row) continue;
      if ((normals[k * 2] as number) * nx + (normals[k * 2 + 1] as number) * nz > 0) continue;
      const each = centre[k] as CorridorPoint;
      const dx = each.x - point.x;
      const dz = each.z - point.z;
      const outward = nx * dx + nz * dz;
      if (!(Math.abs(outward) > SEAM_EPSILON)) continue;
      const t = (dx * dx + dz * dz) / (2 * Math.abs(outward));
      if (!(t >= ROAD_CLEARANCE_METRES)) continue;
      const side = outward > 0 ? 0 : 1;
      claim(centre, normals, reach, out, shallow, meets, row, side, k, 0, t);
    }
    // Every stretch but the row's own two, either side of it.
    for (let segment = 0; segment < last; segment += 1) {
      if (segment === row || segment === row - 1) continue;
      // And no stretch whose both ends face within a right angle of it.
      if (
        (normals[segment * 2] as number) * nx + (normals[segment * 2 + 1] as number) * nz > 0 &&
        (normals[segment * 2 + 2] as number) * nx + (normals[segment * 2 + 3] as number) * nz > 0
      ) {
        continue;
      }
      const from = centre[segment] as CorridorPoint;
      const to = centre[segment + 1] as CorridorPoint;
      // A square root rather than `Math.hypot`, which returns a fresh number
      // every call: this runs some 18 000 times a build, and with `hypot`
      // a build allocated enough to collect inside every window
      // `landform-levelling.test.ts` §"allocates no more" measures in.
      const ex = to.x - from.x;
      const ez = to.z - from.z;
      const length = Math.sqrt(ex * ex + ez * ez);
      if (!(length > SEAM_EPSILON)) continue;
      const ux = ex / length;
      const uz = ez / length;
      // `offset` is the row's point off the stretch's line and `closing` how
      // fast walking out along the normal changes it; `foot0` and `drift` the
      // same for where the foot falls along the stretch.
      const offset = (point.x - from.x) * -uz + (point.z - from.z) * ux;
      const closing = nx * -uz + nz * ux;
      const foot0 = (point.x - from.x) * ux + (point.z - from.z) * uz;
      const drift = nx * ux + nz * uz;
      for (let side = 0; side < 2; side += 1) {
        const sign = side === 0 ? 1 : -1;
        const rate = offset >= 0 ? 1 - closing * sign : 1 + closing * sign;
        if (!(rate > SEAM_EPSILON)) continue;
        const t = Math.abs(offset) / rate;
        if (!(t >= ROAD_CLEARANCE_METRES)) continue;
        const foot = foot0 + t * drift * sign;
        if (!(foot >= 0 && foot <= length)) continue;
        claim(centre, normals, reach, out, shallow, meets, row, side, segment, foot / length, t);
      }
    }
  }
  return out;
}

/**
 * A point of another leg's claim on `row`'s `side` from `t` out, written to
 * whichever of {@link seamReach}'s answers it beats.
 */
function claim(
  centre: readonly CorridorPoint[],
  normals: Float64Array,
  reach: Float64Array,
  seams: Float64Array,
  shallow: Float64Array,
  meets: Float64Array,
  row: number,
  side: number,
  k: number,
  share: number,
  t: number,
): void {
  const at = row * 2 + side;
  // Nothing past the side's own reach is any claim at all; and a claim no
  // nearer than both answers so far changes neither.
  if (!(t < (reach[at] as number))) return;
  if (!(t < (shallow[at] as number)) && !(t < (seams[at] as number))) return;
  const grade = takesOver(centre, normals, reach, row, side, k, share, t);
  if (grade === OVER && t < (seams[at] as number)) seams[at] = t;
  if (grade !== NOT_OVER && t < (shallow[at] as number)) {
    shallow[at] = t;
    const from = centre[k] as CorridorPoint;
    const to = centre[Math.min(centre.length - 1, k + 1)] as CorridorPoint;
    meets[at] = from.y + (to.y - from.y) * share;
  }
}

/**
 * Whether the point `share` of the way from point `k` of the road to the next
 * takes over `row`'s `side` from `t` out — {@link seamReach}'s rules 1 to 3.
 */
function takesOver(
  centre: readonly CorridorPoint[],
  normals: Float64Array,
  reach: Float64Array,
  row: number,
  side: number,
  k: number,
  share: number,
  t: number,
): typeof NOT_OVER | typeof SHALLOW | typeof OVER {
  const last = centre.length - 1;
  const point = centre[row] as CorridorPoint;
  const from = centre[k] as CorridorPoint;
  const ahead = Math.min(last, k + 1);
  const to = centre[ahead] as CorridorPoint;
  const along = from.along + (to.along - from.along) * share;
  const sign = side === 0 ? 1 : -1;
  const nx = (normals[row * 2] as number) * sign;
  const nz = (normals[row * 2 + 1] as number) * sign;
  // That leg's own normal there, and its heading: `(z, −x)` of the normal.
  let mx = (normals[k * 2] as number) * (1 - share) + (normals[ahead * 2] as number) * share;
  let mz =
    (normals[k * 2 + 1] as number) * (1 - share) + (normals[ahead * 2 + 1] as number) * share;
  const length = Math.sqrt(mx * mx + mz * mz);
  if (!(length > SEAM_EPSILON)) return NOT_OVER;
  mx /= length;
  mz /= length;
  // 1. Another leg: the road there has turned past {@link SEAM_TURN_RADIANS}
  // from the road here.
  const turned = (normals[row * 2] as number) * mx + (normals[row * 2 + 1] as number) * mz;
  if (!(turned < SEAM_TURN_COSINE)) return NOT_OVER;
  const qx = from.x + (to.x - from.x) * share;
  const qz = from.z + (to.z - from.z) * share;
  // Where this row's ray is against that leg: `across` out from its road and
  // `down` along it, each a value at the row's point and a rate per metre out.
  const across0 = (point.x - qx) * mx + (point.z - qz) * mz;
  const acrossRate = nx * mx + nz * mz;
  const down0 = (point.x - qx) * mz - (point.z - qz) * mx;
  const downRate = nx * mz - nz * mx;
  const across = across0 + t * acrossRate;
  const facing = across >= 0 ? 0 : 1;
  const theirs =
    (reach[k * 2 + facing] as number) * (1 - share) + (reach[ahead * 2 + facing] as number) * share;
  // 2. That leg's ground reaches the seam.
  if (!(t <= theirs + SEAM_SLACK_METRES)) return NOT_OVER;
  // 3. And the rest of the ray: to that leg's road if it runs towards it,
  // else to this side's own reach and no further out than that leg reaches,
  // and in either case beside the corridor rather than past one of its ends.
  const ours = reach[row * 2 + side] as number;
  const approaching = across * acrossRate < 0;
  const stop = approaching ? Math.min(ours, -across0 / acrossRate) : ours;
  if (!approaching && !(Math.abs(across0 + stop * acrossRate) <= theirs + SEAM_SLACK_METRES)) {
    return SHALLOW;
  }
  const end = along + down0 + stop * downRate;
  return end >= (centre[0] as CorridorPoint).along && end <= (centre[last] as CorridorPoint).along
    ? OVER
    : SHALLOW;
}

/** {@link takesOver}'s answers: no, as far as rule 2, all three rules. */
const NOT_OVER = 0;
const SHALLOW = 1;
const OVER = 2;

/**
 * How far the road must have turned between a row and a point of it for that
 * point to be ANOTHER LEG, in radians: **3π/4**, 135° — #2101. @see seamReach
 *
 * ⚠️ **What scopes #2101 to very sharp bends.** The owner's bend was 143°,
 * and between the legs of a bend that sharp, and of a hairpin, the two
 * grounds face each other across a narrow wedge. A point of the row's own
 * bend, turned through less, is the fold's ({@link foldReach}); and the legs
 * of a right angle, or of the 100° and 120° bends of `plannerRoute`, are as
 * they were before #2101. Measured by the normals rather than the distance
 * along the road: on a circle every point of the arc is as near the bend's
 * centre as the row is, so no distance along it tells the legs from the arc,
 * where the angle does.
 */
const SEAM_TURN_RADIANS = (3 * Math.PI) / 4;

/** {@link SEAM_TURN_RADIANS}' cosine, which the normals' dot product is compared with. */
const SEAM_TURN_COSINE = Math.cos(SEAM_TURN_RADIANS);

/**
 * How fast a leg's ground sinks past its seam, under the other leg's, in
 * metres a metre once {@link sunk} has rounded in: **0.5** — #2101.
 *
 * Under the other leg's ground, which within its own seam is held to
 * {@link RELIEF_SLOPE} a metre from the line, by nearly three times that
 * margin. Not steeper: where the seam moves a few metres between two rows
 * that converge on the inside of a bend, a sink of 1 stood a triangle at
 * |ny| 0.10 — the wall #2096's test refuses near the road.
 */
const SEAM_SINK_PER_METRE = 0.5;

/**
 * The most a side sinks past a seam where the other leg's ground does not
 * cover the rest of it, in metres: **1** — #2101. @see seamReach
 *
 * ⚠️ Where rule 3 fails — the rest of the ray runs past one end of the
 * corridor, where the other leg has no ground — sinking all the way would
 * open a pit there. Not sinking at all left the other leg standing up to
 * 1.2 m over this one's, measured leaving a 143° bend, where the other leg's
 * first rows are the corridor's. Held to the road's height at the seam and a
 * metre under it past, it is under the other leg's ground near the line and
 * a metre's dip in the open past the corridor's end.
 */
const SHALLOW_SINK_METRES = 1;

/**
 * How far a side's ground is sunk `past` metres beyond its seam: none at the
 * seam, and no slope there either, rising to `rate` metres a metre over the
 * first {@link SEAM_SOFT_METRES} or so — {@link SEAM_SINK_PER_METRE}, and
 * more where the two legs' roads are at different heights. @see seamReach
 *
 * ⚠️ **Rounded, so the ground a rider sees does not dip at the line.** The
 * triangles that span the seam are drawn between a column before it and one
 * past it; sunk at the full rate from the line, they sloped the visible side
 * down towards it, and `ground-blob.ts` carried that slope from a tree's
 * foot to its shadow and laid the shadow on the sunk sheet under the other
 * leg's ground.
 */
function sunk(past: number, rate: number): number {
  return past > 0 ? (rate * past * past) / (past + SEAM_SOFT_METRES) : 0;
}

/**
 * How much of the way to the seam's meeting height a side's ground is moved,
 * at `lateral` out with its seam at `seam`: none `from` the road in, all of
 * it at the seam and past it — #2101. @see seamReach
 *
 * ⚠️ **What makes two legs at different heights meet.** On a climbing bend
 * the other leg's road is higher or lower than this one's — 14 m, a 25 m
 * hairpin's legs at 4 % — so holding each leg's relief to nought at the line
 * left a step as tall between them. Each moves its share of the difference,
 * from nothing at `from` to all of it at the line, where they then meet; the
 * road and the ground beside it are where they were. Since the owner's ruling
 * of 2026-11-03 a side lowered starts at the verge's foot rather than the
 * clear band's edge, and the shares follow the widths ({@link meetingRises}).
 */
function towardsSeam(lateral: number, seam: number, from: number): number {
  // A side raised from the clear band's edge, never inside it: rule 2 of
  // this file's header, nothing above the road within it, holds whatever the
  // other leg's height. A side lowered from the verge's foot, which rule 2
  // allows.
  if (!(seam > from) || !(lateral > from)) return 0;
  return Math.min(1, (lateral - from) / (seam - from));
}

/** Over about how far past a seam the sinking rounds in, in metres: **4**. @see sunk */
const SEAM_SOFT_METRES = 4;

/** Below this a length or a product in {@link seamReach} is taken as none: a micrometre. */
const SEAM_EPSILON = 1e-6;

/** How far past its own reach another leg's ground still counts as reaching a point: 1 cm. */
const SEAM_SLACK_METRES = 1e-2;

/**
 * How fast the ground's reach may change from one row to the next, in metres
 * of reach per metre of road between them: **2** — #2096.
 *
 * ⚠️ **What stops a fold standing up as a wall.** On a folded row every outer
 * column collapses onto one point, and until #2096 the row two metres on could
 * reach the full 420 m again: the triangles between the two then lay in one
 * cross-section's plane, nearly vertical, as tall as the invented relief on
 * that row (up to {@link RELIEF_MAX_METRES}) — a flat green wall beside the
 * road after a sharp bend, with the grass smeared down it. Capping the change
 * tapers the ground back out over many rows instead, so no two neighbouring
 * rows' outer columns stand far enough apart for a triangle between them to
 * stand up. 2 is the issue's upper bound, chosen because it gives back the
 * most ground: a fold at 20 m reaches 420 m again 200 m of road later.
 */
export const REACH_TAPER_PER_METRE = 2;

/**
 * Each row's reach, no further than {@link REACH_TAPER_PER_METRE} times the
 * road between it and ANY other row past that row's own, in place.
 *
 * ⚠️ **It runs BEFORE {@link clearReach}, and must.** Taking reach away moves
 * a collapsed vertex to a lateral nobody probed, and the far leg of a hairpin
 * can lie between two columns that are both clear: run after `clearReach`, the
 * outer columns collapsed onto its tarmac, 8.6 m above it (#2097's review).
 * `clearReach` probes `min(offset, limit)`, so on the tapered reach it vouches
 * for the very laterals the ground is built at. Only the fold's bound survives
 * a decrease on its own; the clearance is re-established by running after.
 *
 * One pass forward and one back is the whole of it: on a chain of rows the
 * least of `reach[j] + k · (road from j to r)` over every `j` is what the two
 * passes leave, because the road between two rows is the sum of the gaps
 * between them.
 */
function tapered(centre: readonly CorridorPoint[], reach: Float64Array): Float64Array {
  const rows = reach.length / 2;
  // Each gap is asked by both passes, once per row: about 135 hypots, not worth a store.
  const gap = (row: number): number => {
    const from = centre[row] as CorridorPoint;
    const to = centre[row + 1] as CorridorPoint;
    return REACH_TAPER_PER_METRE * Math.hypot(to.x - from.x, to.z - from.z);
  };
  for (let row = 1; row < rows; row += 1) {
    const most = gap(row - 1);
    for (let side = 0; side < 2; side += 1) {
      const at = row * 2 + side;
      reach[at] = Math.min(reach[at] as number, (reach[at - 2] as number) + most);
    }
  }
  for (let row = rows - 2; row >= 0; row -= 1) {
    const most = gap(row);
    for (let side = 0; side < 2; side += 1) {
      const at = row * 2 + side;
      reach[at] = Math.min(reach[at] as number, (reach[at + 2] as number) + most);
    }
  }
  return reach;
}

/** `reach`, copied into `out`, and `reach` returned. */
function keptFolds(reach: Float64Array, out: Float64Array): Float64Array {
  out.set(reach);
  return reach;
}

/**
 * Each row's reach, no further than either neighbour's — an erosion over the
 * rows, per side.
 *
 * ⚠️ **The erosion is what stops a quad twisting where a reach changes.** A
 * row stopped short beside a row that was not makes a quad whose outer edge
 * runs back past its inner one, and that triangle turns over: wound towards
 * the ground and culled — a hole — or overlapping the one beside it. On a 25 m
 * hairpin the reaches alone left one such triangle; taking the least of three
 * rows removes it, at the cost of stopping the ground one row early either side
 * of a bend. It is also what carries {@link foldReach}'s limit, written on a
 * pair's first row, to the pair's second.
 *
 * It runs before {@link tapered}, which must see the reach it carries to a
 * pair's second row, and both before {@link clearReach}, which then vouches
 * for the laterals the ground is built at.
 */
function steadied(reach: Float64Array, out: Float64Array): Float64Array {
  const rows = reach.length / 2;
  for (let row = 0; row < rows; row += 1) {
    for (let side = 0; side < 2; side += 1) {
      const at = (index: number): number =>
        reach[Math.min(rows - 1, Math.max(0, index)) * 2 + side] as number;
      out[row * 2 + side] = Math.min(at(row - 1), at(row), at(row + 1));
    }
  }
  return out;
}

/**
 * The last index list built, and the row count it was built for.
 *
 * ⚠️ **Borrowed, not owned**, exactly as `terrain.ts` §`roadIndices` lends the
 * road's: for a corridor of one shape the list is identical frame after frame,
 * and rebuilding 6 624 indices sixty times a second is an allocation on the
 * thread GATT notifications arrive on (#240's NFR-2/NFR-3). The renderer copies
 * what it is handed and nothing mutates it.
 */
let lastIndices: { readonly rows: number; readonly indices: Uint32Array } | undefined;

/** Innermost band first, both sides and every row, then the next band out. */
function terrainIndices(rows: number): Uint32Array {
  if (lastIndices !== undefined && lastIndices.rows === rows) {
    return lastIndices.indices;
  }
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
        // mirror images — the columns run one way on one and the other way on
        // the other —
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
  lastIndices = { rows, indices };
  return indices;
}

/**
 * Upward unit normals from the height grid: across the columns and along the
 * rows, one step either side, crossed.
 */
function gridNormals(vertices: Float32Array, rows: number, normals: Float32Array): void {
  const perRow = COLUMNS * 2;
  // Vertex `(row, side, column)` starts at `(row · perRow + side · COLUMNS +
  // column) · 3`. Written out as offsets rather than through a helper, and the
  // length taken as a square root rather than `Math.hypot`, since #569: this
  // runs on every vertex of the ground every frame, and #543 nearly tripled
  // the rows.
  for (let row = 0; row < rows; row += 1) {
    const back = Math.max(0, row - 1) * perRow;
    const ahead = Math.min(rows - 1, row + 1) * perRow;
    const here = row * perRow;
    for (let side = 0; side < 2; side += 1) {
      const sideOffset = side * COLUMNS;
      for (let column = 0; column < COLUMNS; column += 1) {
        const inner = (here + sideOffset + Math.max(0, column - 1)) * 3;
        const outer = (here + sideOffset + Math.min(COLUMNS - 1, column + 1)) * 3;
        const before = (back + sideOffset + column) * 3;
        const after = (ahead + sideOffset + column) * 3;
        const ax = (vertices[after] as number) - (vertices[before] as number);
        const ay = (vertices[after + 1] as number) - (vertices[before + 1] as number);
        const az = (vertices[after + 2] as number) - (vertices[before + 2] as number);
        const cx = (vertices[outer] as number) - (vertices[inner] as number);
        const cy = (vertices[outer + 1] as number) - (vertices[inner + 1] as number);
        const cz = (vertices[outer + 2] as number) - (vertices[inner + 2] as number);
        let nx = ay * cz - az * cy;
        let ny = az * cx - ax * cz;
        let nz = ax * cy - ay * cx;
        const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
        const at = (here + sideOffset + column) * 3;
        if (!(length > 0)) {
          // A collapsed cross-section — behind the start of a point-to-point
          // route, where every row is the same point. Straight up is what a
          // surface there would face. ⚠️ All three written: the array is
          // lent again every frame (#469), so an unwritten component holds
          // whatever the last frame put there rather than a zero.
          normals[at] = 0;
          normals[at + 1] = 1;
          normals[at + 2] = 0;
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
}

function smoothstep01(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}
