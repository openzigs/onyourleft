// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Junction surfaces — #3133: **a junction the rider turns through drawn as
 * roads meeting**, not as one road bending into the street turned into.
 *
 * ## Why
 *
 * The owner's open-world tablet ride of 2026-11-24 (build 1124c): "if I pick
 * the roads don't junction quite right, they just turn instead of being a T
 * or cross." Once a turn is chosen the road the frame draws is the route, and
 * the route bends into the new street (`terrain.ts` §`roadCorridor`, its
 * corner rounded over `BEND_SMOOTHING_METRES`). So its edge lines and its
 * centre line ran round the corner, across the mouths of the ways not taken,
 * and nothing drew the corners between the arms: the corner rounded off the
 * road's outside edge left ground showing where the junction is.
 *
 * ## What is drawn
 *
 * For each junction where the route turns ({@link TURNED_JUNCTION_DEGREES} or
 * more onto the way it takes), one surface, a `cross-streets.ts` §`SideRoad`
 * in the road's material and its one mesh:
 *
 * - every arm meeting there — the road the rider came along, the way taken
 *   and each way not taken — **to its own width**, from the node out to its
 *   mouth ({@link junctionOutline}): the route's road at
 *   `terrain.ts` §`ROAD_WIDTH_METRES`, every other way at its street's class
 *   (`cross-streets.ts` §`SIDE_ROAD_WIDTHS`);
 * - the square where the arms overlap;
 * - **a rounded corner** of {@link JUNCTION_CORNER_RADIUS_METRES} where the
 *   edges of two neighbouring arms meet, less where the arms meet at a
 *   narrow angle ({@link JUNCTION_CORNER_MOST_METRES}); and a straight edge
 *   where they are a half-turn apart, as along the top of a T.
 *
 * It stands at the road's own level, lifted as a nearby street is
 * (`nearby-streets.ts` §`deckGround`), so it lies over the road's bend; and
 * the road's edge lines and centre-line marks are not painted between the
 * mouths of the two arms the route rides ({@link JunctionSurface.mouths},
 * `terrain.ts` §`roadCorridor`'s `unpainted`), so the lines stop at the
 * mouth instead of bending round the turn. Past each mouth the arm is drawn
 * as it was: the road, a stub, a nearby street or a way road.
 *
 * ⚠️ **Only where the route turns.** A junction ridden straight through is
 * the road with a stub at each side street and its lines carried through,
 * as before.
 *
 * ⚠️ **Location data** (ADR 0004 D): nothing here formats a message, and it
 * reads no name.
 *
 * Pure but for its cache, and names no rendering library.
 */

import { positionAt, type GeographicPosition, type RouteProfile } from '@onyourleft/domain';

import { SIDE_ROAD_WIDTHS, TARMAC, type SideRoad } from './cross-streets';
import { deckGround } from './nearby-streets';
import { localGroundPosition, ROAD_WIDTH_METRES, type CorridorOrigin } from './terrain';

/** How far the route must turn onto the way it takes for a junction to be drawn as one, in degrees: **30**. */
export const TURNED_JUNCTION_DEGREES = 30;

/**
 * The radius a junction's corners are rounded to, in metres: **6**, a town
 * street's kerb. Big enough that the road's own bend (`terrain.ts`
 * §`BEND_SMOOTHING_METRES`) stays inside it at a square corner.
 */
export const JUNCTION_CORNER_RADIUS_METRES = 6;

/**
 * The farthest a rounded corner runs along an arm from where the two edges
 * meet, in metres: **12**. At a narrow angle a full radius would run tens of
 * metres down both streets; the radius is made smaller to keep within this.
 */
export const JUNCTION_CORNER_MOST_METRES = 12;

/** How far along an arm its heading is read, in metres: **15**, past the corner's rounding. */
export const JUNCTION_HEADING_METRES = 15;

/** Two neighbouring arms this close to a half-turn apart meet along a straight edge, in degrees: **10**. */
const STRAIGHT_EDGE_DEGREES = 10;

/** How many straight pieces a rounded corner is drawn in. */
const CORNER_PIECES = 6;

/** One arm meeting at a junction: its heading, a unit vector in plan, and half its width. */
export interface JunctionArm {
  readonly x: number;
  readonly z: number;
  readonly half: number;
}

/** A junction's outline about its node, and how far out along each arm it reaches. */
export interface JunctionOutline {
  /** The outline about the node, `x0, z0, x1, z1, …`, each point at a heading after the last. */
  readonly points: readonly number[];
  /** How far from the node along each arm, in the arms' given order, its mouth is. */
  readonly mouths: readonly number[];
}

/**
 * The outline of the surface where `arms` meet, about a node at the origin —
 * the module note: each arm from its mouth's one edge to its other, then
 * round the corner to the next arm by heading. Fewer than two arms, or two
 * with the same heading, have none.
 */
export function junctionOutline(arms: readonly JunctionArm[]): JunctionOutline | undefined {
  if (arms.length < 2) return undefined;
  const order = arms
    .map((arm, index) => ({ arm, index, heading: Math.atan2(arm.z, arm.x) }))
    .sort((a, b) => a.heading - b.heading);
  const count = order.length;
  /** What each corner needs of its two arms, and the points round it. */
  const corners: {
    readonly first: number;
    readonly second: number;
    readonly round: readonly number[];
  }[] = [];
  for (let at = 0; at < count; at += 1) {
    const a = order[at] as (typeof order)[number];
    const b = order[(at + 1) % count] as (typeof order)[number];
    const gap = b.heading - a.heading + (at + 1 < count ? 0 : 2 * Math.PI);
    if (!(gap > 1e-6)) return undefined;
    const straight = (STRAIGHT_EDGE_DEGREES * Math.PI) / 180;
    if (gap >= Math.PI - straight && gap <= Math.PI + straight) {
      corners.push({ first: 0, second: 0, round: [] });
      continue;
    }
    if (gap > Math.PI) {
      // Wider than a half-turn: no corner to round, and a point on the line
      // between the arms keeps every piece of the outline less than one.
      const middle = a.heading + gap / 2;
      const reach = Math.min(a.arm.half, b.arm.half);
      corners.push({
        first: 0,
        second: 0,
        round: [Math.cos(middle) * reach, Math.sin(middle) * reach],
      });
      continue;
    }
    // `a`'s edge towards `b` and `b`'s towards `a`: where they meet.
    const ax = a.arm.x;
    const az = a.arm.z;
    const bx = b.arm.x;
    const bz = b.arm.z;
    // Each edge's offset: a quarter-turn round from the arm, towards the other.
    const aox = -az * a.arm.half;
    const aoz = ax * a.arm.half;
    const box = bz * b.arm.half;
    const boz = -bx * b.arm.half;
    // s·a − t·b = (b's offset) − (a's offset).
    const rx = box - aox;
    const rz = boz - aoz;
    const det = -ax * bz + bx * az;
    const s = (-rx * bz + bx * rz) / det;
    const t = (ax * rz - az * rx) / det;
    const half = gap / 2;
    const radius = Math.min(
      JUNCTION_CORNER_RADIUS_METRES,
      JUNCTION_CORNER_MOST_METRES * Math.tan(half),
    );
    const tangent = radius / Math.tan(half);
    // Where the rounding leaves each edge, and the circle it follows.
    const fromX = (s + tangent) * ax + aox;
    const fromZ = (s + tangent) * az + aoz;
    const toX = (t + tangent) * bx + box;
    const toZ = (t + tangent) * bz + boz;
    const meetX = s * ax + aox;
    const meetZ = s * az + aoz;
    let bisectX = ax + bx;
    let bisectZ = az + bz;
    const length = Math.hypot(bisectX, bisectZ);
    bisectX /= length;
    bisectZ /= length;
    const centreX = meetX + (bisectX * radius) / Math.sin(half);
    const centreZ = meetZ + (bisectZ * radius) / Math.sin(half);
    const start = Math.atan2(fromZ - centreZ, fromX - centreX);
    let sweep = Math.atan2(toZ - centreZ, toX - centreX) - start;
    while (sweep > Math.PI) sweep -= 2 * Math.PI;
    while (sweep < -Math.PI) sweep += 2 * Math.PI;
    const round: number[] = [];
    for (let piece = 0; piece <= CORNER_PIECES; piece += 1) {
      const angle = start + (sweep * piece) / CORNER_PIECES;
      round.push(centreX + Math.cos(angle) * radius, centreZ + Math.sin(angle) * radius);
    }
    corners.push({ first: s + tangent, second: t + tangent, round });
  }
  // Each arm reaches past every other arm's edge, and past both its corners.
  const mouthOf = new Float64Array(count);
  for (let at = 0; at < count; at += 1) {
    const before = corners[(at + count - 1) % count] as (typeof corners)[number];
    const after = corners[at] as (typeof corners)[number];
    let others = 0;
    for (let other = 0; other < count; other += 1) {
      if (other !== at)
        others = Math.max(others, (order[other] as (typeof order)[number]).arm.half);
    }
    mouthOf[at] = Math.max(others, before.second, after.first);
  }
  const points: number[] = [];
  /** Adds a point, unless it is where the last one is: a rounding that ends at a mouth. */
  const add = (x: number, z: number): void => {
    const last = points.length - 2;
    if (
      last >= 0 &&
      Math.abs((points[last] as number) - x) < 1e-6 &&
      Math.abs((points[last + 1] as number) - z) < 1e-6
    ) {
      return;
    }
    points.push(x, z);
  };
  for (let at = 0; at < count; at += 1) {
    const { arm } = order[at] as (typeof order)[number];
    const mouth = mouthOf[at] as number;
    // Its right edge (clockwise of it), then its left.
    add(arm.x * mouth + arm.z * arm.half, arm.z * mouth - arm.x * arm.half);
    add(arm.x * mouth - arm.z * arm.half, arm.z * mouth + arm.x * arm.half);
    const { round } = corners[at] as (typeof corners)[number];
    for (let index = 0; index + 1 < round.length; index += 2) {
      add(round[index] as number, round[index + 1] as number);
    }
  }
  // The last rounding may end where the first arm's mouth begins.
  if (
    points.length > 2 &&
    Math.abs((points[0] as number) - (points[points.length - 2] as number)) < 1e-6 &&
    Math.abs((points[1] as number) - (points[points.length - 1] as number)) < 1e-6
  ) {
    points.length -= 2;
  }
  const mouths: number[] = new Array<number>(count).fill(0);
  for (let at = 0; at < count; at += 1) {
    mouths[(order[at] as (typeof order)[number]).index] = mouthOf[at] as number;
  }
  return { points, mouths };
}

/** One way on from a junction the route does not take, as the scene is handed it. */
export interface JunctionWay {
  /** Its street's point {@link JUNCTION_HEADING_METRES} from the junction's node, or its far end where it is shorter. */
  readonly toward: GeographicPosition;
  /** Its street's width, metres. */
  readonly width: number;
}

/**
 * A junction the route turns through (`open-world/road.ts`
 * §`OpenWorldRoad.junctionsTurned`, `scene.ts` §`SceneInput.junctionsTurned`):
 * the same object while the route takes the same way there.
 */
export interface TurnedJunction {
  /** Its ride distance. */
  readonly junction: number;
  /**
   * Its node, where every way on from it leaves: the street graph's, not the
   * road's view at {@link junction}, which is resampled and cuts the corner.
   */
  readonly position: GeographicPosition;
  /** The way the route takes. */
  readonly taken: JunctionWay;
  /** Every way on from it the route does not take. */
  readonly ways: readonly JunctionWay[];
}

/** A junction's surface, and how far along the road either side of it the road's lines stop. */
export interface JunctionSurface {
  readonly road: SideRoad;
  /** The road's distance on its view where the surface's mouth on the way in is, and on the way taken. */
  readonly mouths: { readonly from: number; readonly to: number };
}

/** The width of a street of road class `roadClass` (`open-world/session.ts` §`ROAD_CLASS`): 2 is a major road. */
export function junctionWayWidth(roadClass: number): number {
  return roadClass >= 2 ? SIDE_ROAD_WIDTHS.major : SIDE_ROAD_WIDTHS.minor;
}

/** Each junction's surface by the road's view: the same object while both are. */
const surfaces = new WeakMap<RouteProfile, WeakMap<TurnedJunction, JunctionSurface | null>>();

/**
 * The surface of `junction`, `metres` along the road's view `profile` — the
 * module note. None where it is too near either end of the view to read the
 * road's arms there, where the ground is not drawn about it, or where its
 * arms make no outline. The same object for the same view and junction.
 */
export function junctionSurface(
  profile: RouteProfile,
  origin: CorridorOrigin,
  junction: TurnedJunction,
  metres: number,
): JunctionSurface | undefined {
  let byJunction = surfaces.get(profile);
  if (byJunction === undefined) {
    byJunction = new WeakMap();
    surfaces.set(profile, byJunction);
  }
  const known = byJunction.get(junction);
  if (known !== undefined) return known ?? undefined;
  const built = surfaceOf(profile, origin, junction, metres);
  byJunction.set(junction, built ?? null);
  return built;
}

function surfaceOf(
  profile: RouteProfile,
  origin: CorridorOrigin,
  junction: TurnedJunction,
  at: number,
): JunctionSurface | undefined {
  const total: number = profile.totalDistance;
  if (!(at - JUNCTION_HEADING_METRES >= 0 && at + JUNCTION_HEADING_METRES <= total)) {
    return undefined;
  }
  const node = localGroundPosition(origin, junction.position);
  const toward = (x: number, z: number, half: number): JunctionArm | undefined => {
    const length = Math.hypot(x - node.x, z - node.z);
    return length > 1e-3 ? { x: (x - node.x) / length, z: (z - node.z) / length, half } : undefined;
  };
  const road = ROAD_WIDTH_METRES / 2;
  // The way in, off the road's view: on a straight street its samples are on it.
  const back = localGroundPosition(origin, positionAt(profile, at - JUNCTION_HEADING_METRES));
  const on = localGroundPosition(origin, junction.taken.toward);
  const arms: (JunctionArm | undefined)[] = [
    toward(back.x, back.z, road),
    toward(on.x, on.z, road),
  ];
  for (const way of junction.ways) {
    const there = localGroundPosition(origin, way.toward);
    arms.push(toward(there.x, there.z, way.width / 2));
  }
  if (arms.some((arm) => arm === undefined)) return undefined;
  const outline = junctionOutline(arms as JunctionArm[]);
  if (outline === undefined) return undefined;
  const ground = deckGround(profile, origin);
  const level = ground.about(node.x, node.z);
  if (level === undefined) return undefined;
  const positions: number[] = [node.x, level(node.x, node.z), node.z];
  const { points } = outline;
  for (let index = 0; index + 1 < points.length; index += 2) {
    const x = node.x + (points[index] as number);
    const z = node.z + (points[index + 1] as number);
    const height = ground.about(x, z) ?? level;
    positions.push(x, height(x, z), z);
  }
  const rim = points.length / 2;
  const indices: number[] = [];
  for (let index = 0; index < rim; index += 1) {
    indices.push(0, 1 + index, 1 + ((index + 1) % rim));
  }
  const vertices = positions.length / 3;
  const colours = new Float32Array(vertices * 3);
  for (let vertex = 0; vertex < vertices; vertex += 1) colours.set(TARMAC, vertex * 3);
  // For the clearances, and what `way-roads.ts` counts as drawn: each arm
  // out to its half-width short of its mouth, so that the round end of what
  // is measured about it stops at the mouth and a way road runs on from
  // there; and the node out to each point of the outline.
  const segments: number[] = [];
  const halfWidths: number[] = [];
  (arms as JunctionArm[]).forEach((arm, index) => {
    const reach = Math.max(0, (outline.mouths[index] as number) - arm.half);
    segments.push(node.x, node.z, node.x + arm.x * reach, node.z + arm.z * reach);
    halfWidths.push(arm.half);
  });
  for (let index = 0; index + 1 < points.length; index += 2) {
    segments.push(
      node.x,
      node.z,
      node.x + (points[index] as number),
      node.z + (points[index + 1] as number),
    );
    halfWidths.push(0);
  }
  return {
    road: {
      // No junction of its own, as a nearby street has none: `along` is where it is.
      junction: { along: at, source: 'street', arms: [] },
      mesh: {
        positions: Float32Array.from(positions),
        colours,
        across: new Float32Array(vertices),
        indices: Uint32Array.from(indices),
      },
      segments: Float32Array.from(segments),
      halfWidths: Float32Array.from(halfWidths),
    },
    mouths: { from: at - (outline.mouths[0] as number), to: at + (outline.mouths[1] as number) },
  };
}

const NO_SURFACES: readonly JunctionSurface[] = [];

/**
 * The surfaces of every junction of `junctions` from `fromMetres` to
 * `toMetres` along the road's view `profile`, whose ride distance zero is
 * `rides`, in route order.
 */
export function junctionSurfacesAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  junctions: readonly TurnedJunction[],
  rides: number,
  fromMetres: number,
  toMetres: number,
): readonly JunctionSurface[] {
  let out: JunctionSurface[] | undefined;
  for (const junction of junctions) {
    const metres = junction.junction - rides;
    if (metres < fromMetres || metres > toMetres) continue;
    const surface = junctionSurface(profile, origin, junction, metres);
    if (surface === undefined) continue;
    (out ??= []).push(surface);
  }
  if (out === undefined) return NO_SURFACES;
  return out.sort((a, b) => a.road.junction.along - b.road.junction.along);
}
