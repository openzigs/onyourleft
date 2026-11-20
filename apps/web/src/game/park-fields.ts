// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a sports pitch and a playground are drawn with — #2688, the geometry
 * #2685 left: a pitch's white lines and its goals, net, hoops or backstop by
 * its mapped sport, and a playground's few low play structures. Every one a
 * box, a {@link ParkPiece}, drawn by `park-dressing.ts` in the park dressing
 * belt's ONE instanced call, after its golf and cemetery pieces, at most
 * {@link PARK_FIELD_CAPACITY} a frame, nearest first — its own budget term,
 * `realistic-budget.ts` §`REALISTIC_PARK_FIELD_TRIANGLES`, because the
 * belt's 512 pieces were already spent.
 *
 * ## Where a pitch's lines go
 *
 * A mapped pitch is a polygon, usually the four corners of its rectangle.
 * Its frame is the smallest rectangle round its outer ring whose sides run
 * along one of the ring's own edges ({@link fieldFrame}): its middle, its long
 * axis and its length and width. Its lines are drawn
 * {@link PITCH_LINE_INSET_METRES} inside that rectangle.
 *
 * ## By sport (`LandUseFeature.sport`, `@onyourleft/map-features` §`PITCH_SPORTS`)
 *
 * - `soccer`: the touch and goal lines, the halfway line, and a goal at each
 *   end — two posts and a crossbar, 7.32 by 2.44 m (5 by 2 m on a pitch under
 *   {@link SMALL_PITCH_WIDTH_METRES} wide).
 * - `american_football`, `rugby_union`, `rugby_league`: the lines, and an H
 *   of goalposts at each end.
 * - `tennis`: the lines and a net across the middle.
 * - `basketball`: the lines and a hoop on a pole at each end.
 * - `baseball`, `softball`: no lines (a diamond is not a rectangle), and a
 *   backstop of three fence panels behind home plate, at the narrow end of
 *   the polygon's fan ({@link apexEnd}).
 * - **No sport, or one the world does not draw**: the lines alone.
 *
 * ⚠️ **A line is a flat box, not a ground decal.** The ground's shader window
 * (`park-dressing.ts` §`ParkGround`) has its four channels spent on golf and
 * cemeteries, and a box costs the same ten triangles whatever it is. Each
 * line is {@link PITCH_LINE_WIDTH_METRES} wide — wider than a real line's
 * 0.12 m, so it does not break into dashes from the saddle. ⚠️ **One box
 * per line, laid along the slope**: the scene tilts it from the ground
 * under one end to the ground under the other ({@link laidAlongTheGround}),
 * because a line split into the cemetery wall's 4 m pieces would spend
 * {@link PARK_FIELD_CAPACITY} on one pitch.
 *
 * ## A playground
 *
 * A swing frame, a slide's tower and its chute, and a climbing frame, in the
 * playground's middle and along its long axis, where it is at least
 * {@link PLAYGROUND_MIN_METRES} across.
 *
 * Nothing within {@link FIELD_ROAD_CLEARANCE_METRES} of the drawn road is
 * drawn. ⚠️ **No building** (ADR 0054 D-5.2): a goal is not one.
 *
 * Pure: names no rendering library, and formats no coordinate into a string.
 */

import type { LandUseFeature, PitchSport } from '@onyourleft/map-features';

import type { RouteProfile } from '@onyourleft/domain';

import { standingOnGround, type TerrainMesh } from './landform';
import type { ParkPiece, ParkPieceKind } from './park-dressing';
import { distanceToDrawnRoad } from './road-grid';
import type { CorridorOrigin } from './terrain';

/**
 * The most pitch and playground pieces a frame draws: **80**, nearest
 * first, after the golf and cemetery pieces' 512 — inside what the worst
 * realistic frame left beside them (`realistic-budget.ts`
 * §`REALISTIC_PARK_FIELD_TRIANGLES`). Seven goal pitches, or ten courts.
 */
export const PARK_FIELD_CAPACITY = 80;

/** The most pitch and playground polygons one corridor reads, in file order: **2 000**. */
export const FIELD_POLYGONS_MAX = 2_000;

/** A pitch or playground whose frame is shorter than this is not drawn, in metres: **12**. */
export const FIELD_MIN_METRES = 12;

/** How far inside its frame a pitch's lines run, in metres: **1**. */
export const PITCH_LINE_INSET_METRES = 1;

/** A line's drawn width, in metres: **0.2**. @see the header */
export const PITCH_LINE_WIDTH_METRES = 0.2;

/** A line's height above the ground, in metres: **0.03**. */
export const PITCH_LINE_HEIGHT_METRES = 0.03;

/**
 * How deep a line is set into the ground beneath that, in metres: **0.15**,
 * the cemetery wall's — so where the ground sags between a line's ends
 * (§`laidAlongTheGround`) no gap shows under it.
 */
export const PITCH_LINE_SET_IN_METRES = 0.15;

/** A soccer pitch narrower than this has small-sided goals, in metres: **30**. */
export const SMALL_PITCH_WIDTH_METRES = 30;

/** How near the drawn road no piece is drawn, in metres: **6**. */
export const FIELD_ROAD_CLEARANCE_METRES = 6;

/** A playground narrower than this has no structures, in metres: **8**. */
export const PLAYGROUND_MIN_METRES = 8;

/** The lines' paint. */
export const PITCH_LINE_COLOUR = 0xf2f2ea;
/** A goal's white posts. */
export const GOAL_COLOUR = 0xf4f4f0;
/** A net's dark mesh. */
export const NET_COLOUR = 0x2b2f2c;
/** A backstop's fence panels' height, in metres: **3.5**. */
export const BACKSTOP_HEIGHT_METRES = 3.5;
/** A backstop's galvanised fence, the chain-link's grey. */
export const BACKSTOP_COLOUR = 0x8c9089;
/** A playground's painted steel: red, yellow, blue. */
export const PLAY_COLOURS: readonly number[] = Object.freeze([0xc8372d, 0xe8b923, 0x2f63b0]);

/** The sports with goals at each end: a soccer goal, or an H of posts. */
const GOAL_SPORTS: ReadonlySet<PitchSport> = new Set([
  'soccer',
  'american_football',
  'rugby_union',
  'rugby_league',
]);

/** A pitch's frame: its middle, its long axis, its length along it and its width across. */
export interface FieldFrame {
  readonly x: number;
  readonly z: number;
  /** The long axis, a unit vector. */
  readonly ax: number;
  readonly az: number;
  readonly length: number;
  readonly width: number;
}

/**
 * The smallest rectangle round `ring` whose sides run along one of the ring's
 * own edges: a mapped rectangle's own, and a fair frame for anything near
 * one. `undefined` for a ring of fewer than three points.
 */
export function fieldFrame(ring: Float32Array): FieldFrame | undefined {
  const count = Math.floor(ring.length / 2);
  if (count < 3) return undefined;
  let best: FieldFrame | undefined;
  let bestArea = Number.POSITIVE_INFINITY;
  for (let edge = 0; edge < count; edge += 1) {
    const next = (edge + 1) % count;
    const ex = (ring[next * 2] as number) - (ring[edge * 2] as number);
    const ez = (ring[next * 2 + 1] as number) - (ring[edge * 2 + 1] as number);
    const length = Math.hypot(ex, ez);
    if (!(length > 0.5)) continue;
    const ux = ex / length;
    const uz = ez / length;
    let minU = Number.POSITIVE_INFINITY;
    let maxU = Number.NEGATIVE_INFINITY;
    let minV = Number.POSITIVE_INFINITY;
    let maxV = Number.NEGATIVE_INFINITY;
    for (let at = 0; at < count; at += 1) {
      const px = ring[at * 2] as number;
      const pz = ring[at * 2 + 1] as number;
      const u = px * ux + pz * uz;
      const v = -px * uz + pz * ux;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!(area < bestArea)) continue;
    bestArea = area;
    const midU = (minU + maxU) / 2;
    const midV = (minV + maxV) / 2;
    const x = midU * ux - midV * uz;
    const z = midU * uz + midV * ux;
    const alongU = maxU - minU >= maxV - minV;
    best = alongU
      ? { x, z, ax: ux, az: uz, length: maxU - minU, width: maxV - minV }
      : { x, z, ax: -uz, az: ux, length: maxV - minV, width: maxU - minU };
  }
  return best;
}

/**
 * Which end of `frame`'s long axis is a fan's apex — a baseball diamond's
 * home plate: `+1` or `−1`, the end farther from the ring's mean point,
 * since a fan's area lies toward its wide end.
 */
export function apexEnd(ring: Float32Array, frame: FieldFrame): 1 | -1 {
  const count = Math.floor(ring.length / 2);
  let along = 0;
  for (let at = 0; at < count; at += 1) {
    along +=
      ((ring[at * 2] as number) - frame.x) * frame.ax +
      ((ring[at * 2 + 1] as number) - frame.z) * frame.az;
  }
  return along / Math.max(1, count) > 0 ? -1 : 1;
}

/** `atan2`'s answer for a box whose width runs along `(dx, dz)` — `park-dressing.ts` §`yawAlong`'s. */
function yawOf(dx: number, dz: number): number {
  return Math.atan2(-dz, dx);
}

/** Builds pieces in a frame's own coordinates: `u` along its long axis, `v` across it. */
class FieldPieces {
  readonly pieces: ParkPiece[] = [];

  constructor(private readonly frame: FieldFrame) {}

  /**
   * A box centred at `(u, v)`, `along` long on the frame's long axis and
   * `across` on the other, `height` tall, its base `lift` above the ground.
   */
  box(
    kind: ParkPieceKind,
    u: number,
    v: number,
    along: number,
    across: number,
    height: number,
    lift: number,
    colour: number,
  ): void {
    const { x, z, ax, az } = this.frame;
    this.pieces.push({
      kind,
      x: x + ax * u - az * v,
      y: 0,
      z: z + az * u + ax * v,
      lift,
      // Its width along the long axis; its depth across it.
      yaw: yawOf(ax, az),
      width: along,
      height,
      depth: across,
      colour,
    });
  }

  /**
   * A line centred at `(u, v)`, `length` long along the long axis or (where
   * `across`) the other: its length always its `width`, so
   * {@link laidAlongTheGround} tilts it about its own depth axis. Set
   * {@link PITCH_LINE_SET_IN_METRES} into the ground.
   */
  line(u: number, v: number, length: number, across: boolean): void {
    const { x, z, ax, az } = this.frame;
    this.pieces.push({
      kind: 'pitch-line',
      x: x + ax * u - az * v,
      y: 0,
      z: z + az * u + ax * v,
      lift: -PITCH_LINE_SET_IN_METRES,
      yaw: across ? yawOf(-az, ax) : yawOf(ax, az),
      width: length,
      height: PITCH_LINE_HEIGHT_METRES + PITCH_LINE_SET_IN_METRES,
      depth: PITCH_LINE_WIDTH_METRES,
      colour: PITCH_LINE_COLOUR,
    });
  }
}

/** A pitch's touch lines, goal lines and (where `halfway`) its halfway line. */
function lines(build: FieldPieces, frame: FieldFrame, halfway: boolean): void {
  const halfL = frame.length / 2 - PITCH_LINE_INSET_METRES;
  const halfW = frame.width / 2 - PITCH_LINE_INSET_METRES;
  const w = PITCH_LINE_WIDTH_METRES;
  for (const side of [-1, 1]) {
    build.line(0, side * halfW, halfL * 2 + w, false);
    build.line(side * halfL, 0, halfW * 2 + w, true);
  }
  if (halfway) build.line(0, 0, halfW * 2, true);
}

/**
 * `pieces` stood on `mesh` by `landform.ts` §`standingOnGround`, with each
 * pitch line laid along the ground: its two ends found on the ground under
 * them, it is stood at their mean, tilted from one to the other and
 * lengthened by the slope, so a line up to a pitch's length neither floats
 * nor sinks at its ends on a slope (#2688's review). Where the ground between
 * its ends sags, its {@link PITCH_LINE_SET_IN_METRES} fills under it; where
 * it bulges, the line passes under it. A line with no ground under an end is
 * left as it was stood. Every other piece is returned as it is.
 */
export function laidAlongTheGround(
  pieces: readonly ParkPiece[],
  mesh: TerrainMesh,
): readonly ParkPiece[] {
  const ends: { x: number; y: number; z: number; index: number; end: 1 | -1 }[] = [];
  pieces.forEach((piece, index) => {
    if (piece.kind !== 'pitch-line') return;
    const dx = Math.cos(piece.yaw) * (piece.width / 2);
    const dz = -Math.sin(piece.yaw) * (piece.width / 2);
    ends.push({ x: piece.x + dx, y: 0, z: piece.z + dz, index, end: 1 });
    ends.push({ x: piece.x - dx, y: 0, z: piece.z - dz, index, end: -1 });
  });
  if (ends.length === 0) return pieces;
  const high = new Map<number, number>();
  const low = new Map<number, number>();
  for (const stood of standingOnGround(ends, mesh)) {
    (stood.end === 1 ? high : low).set(stood.index, stood.y);
  }
  return pieces.map((piece, index) => {
    const up = high.get(index);
    const down = low.get(index);
    if (up === undefined || down === undefined) return piece;
    const rise = up - down;
    return {
      ...piece,
      y: (up + down) / 2,
      tilt: Math.atan2(rise, piece.width),
      width: Math.hypot(piece.width, rise),
    };
  });
}

/** Two posts and a bar at each goal line: a soccer goal, or rugby's and football's H. */
function goals(build: FieldPieces, frame: FieldFrame, sport: PitchSport): void {
  const halfL = frame.length / 2 - PITCH_LINE_INSET_METRES;
  const soccer = sport === 'soccer';
  const small = frame.width < SMALL_PITCH_WIDTH_METRES;
  const span = soccer ? (small ? 5 : 7.32) : 5.6;
  const postHeight = soccer ? (small ? 2 : 2.44) : 8;
  const bar = soccer ? postHeight - 0.12 : 3;
  const post = 0.12;
  for (const end of [-1, 1]) {
    const u = end * halfL;
    for (const side of [-1, 1]) {
      build.box('goal', u, (side * span) / 2, post, post, postHeight, 0, GOAL_COLOUR);
    }
    build.box('goal', u, 0, post, span, post, bar, GOAL_COLOUR);
  }
}

/** Every piece of one pitch or playground, in no order; none where it is too small. */
export function fieldPieces(feature: LandUseFeature): readonly ParkPiece[] {
  const ring = feature.rings[0];
  if (ring === undefined || (feature.kind !== 'pitch' && feature.kind !== 'playground')) return [];
  const frame = fieldFrame(ring);
  if (frame === undefined || frame.length < FIELD_MIN_METRES) return [];
  const build = new FieldPieces(frame);
  if (feature.kind === 'playground') {
    if (frame.width < PLAYGROUND_MIN_METRES) return [];
    const [red, yellow, blue] = PLAY_COLOURS as [number, number, number];
    const span = Math.min(frame.length / 2 - 2, 5);
    // A swing frame: two legs and a top bar, along the long axis.
    for (const end of [-1.5, 1.5]) build.box('play', -span + end, 0, 0.12, 0.12, 2.3, 0, red);
    build.box('play', -span, 0, 3.4, 0.12, 0.12, 2.2, red);
    // A slide: its tower and its chute, laid along the axis.
    build.box('play', 0, 0, 1.2, 1.2, 1.5, 0, yellow);
    build.box('play', 1.9, 0, 2.6, 0.5, 0.12, 0.6, yellow);
    // A climbing frame.
    build.box('play', span, 0, 2, 2, 1.6, 0, blue);
    return build.pieces;
  }
  const sport = feature.sport;
  if (sport === 'baseball' || sport === 'softball') {
    // A backstop behind home plate: three fence panels round the apex.
    const end = apexEnd(ring, frame);
    const u = end * (frame.length / 2 - 2);
    build.box('backstop', u, 0, 0.08, 6, BACKSTOP_HEIGHT_METRES, 0, BACKSTOP_COLOUR);
    for (const side of [-1, 1]) {
      build.box(
        'backstop',
        u - end * 2.1,
        side * 4.2,
        4.5,
        0.08,
        BACKSTOP_HEIGHT_METRES,
        0,
        BACKSTOP_COLOUR,
      );
    }
    return build.pieces;
  }
  lines(build, frame, sport === undefined || sport !== 'tennis');
  if (sport !== undefined && GOAL_SPORTS.has(sport)) goals(build, frame, sport);
  if (sport === 'tennis') {
    build.box('net', 0, 0, 0.05, frame.width - 2 * PITCH_LINE_INSET_METRES, 0.95, 0, NET_COLOUR);
  }
  if (sport === 'basketball') {
    const halfL = frame.length / 2 - PITCH_LINE_INSET_METRES;
    for (const end of [-1, 1]) {
      build.box('hoop', end * (halfL + 0.6), 0, 0.15, 0.15, 3.3, 0, NET_COLOUR);
      build.box('hoop', end * (halfL - 0.2), 0, 0.05, 1.8, 1.05, 2.9, GOAL_COLOUR);
    }
  }
  return build.pieces;
}

/**
 * Every pitch's and playground's pieces in a corridor's land use — at most
 * {@link FIELD_POLYGONS_MAX} polygons, in file order — less any whose middle
 * is within {@link FIELD_ROAD_CLEARANCE_METRES} of the drawn road.
 */
export function fieldsOf(
  landUse: readonly LandUseFeature[],
  profile: RouteProfile,
  origin: CorridorOrigin,
): readonly ParkPiece[] {
  const out: ParkPiece[] = [];
  let polygons = 0;
  for (const feature of landUse) {
    if (feature.layer !== 'landuse') continue;
    if (feature.kind !== 'pitch' && feature.kind !== 'playground') continue;
    if (polygons >= FIELD_POLYGONS_MAX) break;
    polygons += 1;
    for (const piece of fieldPieces(feature)) {
      const road = distanceToDrawnRoad(
        profile,
        origin,
        piece.x,
        piece.z,
        FIELD_ROAD_CLEARANCE_METRES + Math.max(piece.width, piece.depth) / 2,
      );
      if (road < FIELD_ROAD_CLEARANCE_METRES + Math.max(piece.width, piece.depth) / 2) continue;
      out.push(piece);
    }
  }
  return out;
}
