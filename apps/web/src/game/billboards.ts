// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where the game's billboards stand — #966: the owner's *"a few billboards
 * along courses"*, each carrying the wordmark (`logo-board.ts`).
 *
 * ## The rule, from the route and a seed only
 *
 * The same procedural placement as everything else beside the road (ADR 0009,
 * ADR 0022): no map, no place data. A billboard may stand only at a
 * **boundary between two settlement sites** (`settlements.ts`
 * §`SETTLEMENT_SPACING_METRES`, the same division of the route, stretched the
 * same way), with {@link BILLBOARD_CHANCE}, moved along the road by a hashed
 * jitter of at most {@link BILLBOARD_JITTER_METRES}. That is where no village
 * or farmstead can be: each is placed at least 30 % of a site's span in from
 * its site's ends and reaches at most 108 m either side of its middle, so the
 * jitter is also kept under `0.3 · span − 120`, and a route of fewer than two
 * sites — under about a kilometre — has no boundary and so no billboard. A
 * loop's boundary at nought is its start line, where the gate is, and holds
 * none. Every billboard is a function of where it stands, so lap two's are
 * lap one's.
 *
 * ## ⚠️ Never in the carriageway, and never on a bend's inside
 *
 * - **A bend's inside.** The road's turn is read over
 *   {@link BEND_WINDOW_METRES} either side, off the DRAWN road
 *   (`terrain.ts` §`drawnRoadFrame`). Where it turns faster than
 *   {@link STRAIGHT_RADIANS_PER_METRE} the billboard stands on the OUTSIDE,
 *   the side the road turns away from; where it turns faster than
 *   `scatter.ts` §`TIGHT_BEND_RADIANS_PER_METRE` — a bend tight enough that a
 *   real road would be posted — there is none at all. Only a straight is left
 *   to the hash.
 * - **Every stretch of the road.** The whole footprint
 *   (`logo-board.ts` §`BILLBOARD_FOOTPRINT`) is held
 *   `landform.ts` §`ROAD_CLEARANCE_METRES` off EVERY segment of the route, by
 *   the measure a house is (`settlements.ts` §`footprintClearance`) — the rule
 *   that keeps a hairpin's other leg out from under it.
 * - **Everything else built.** A billboard that would meet a structure — a
 *   house, a signpost, a wall run out from the road — inside
 *   {@link STRUCTURE_MARGIN_METRES} is not built; and the natural scenery is
 *   kept {@link SCENERY_MARGIN_METRES} off it ({@link clearOfBillboards}).
 *   Nor is one built in water.
 *
 * ## Set back, and turned to the rider
 *
 * {@link BILLBOARD_LATERAL_METRES} from the centreline — behind the verge's
 * walls and hedges (`settlements.ts` §`FIELD_EDGE_LATERAL_METRES`) and inside
 * the clear ground the landform keeps level beside the road — and turned
 * {@link BILLBOARD_YAW_RADIANS} from facing the road squarely toward a rider
 * riding at it, so its face is read on the approach rather than edge-on.
 *
 * ## Counted in the structures budget
 *
 * A frame's billboards come out of `QualitySettings.structureItems` before
 * its structures do (`scene.ts`), so a rung that takes structures away takes
 * billboards with them, and none is ever extra.
 *
 * Pure, and names no rendering library.
 */

import { distanceOnRoute, type RouteProfile } from '@onyourleft/domain';

import { ROAD_CLEARANCE_METRES, terrainHeightAt } from './landform';
import { BILLBOARDS_PER_FRAME, BILLBOARD_FOOTPRINT, LOGO_POST_ACROSS_METRES } from './logo-board';
import { TIGHT_BEND_RADIANS_PER_METRE, type ScatterItem } from './scatter';
import { slotHash, uniformFrom } from './seeded';
import {
  footprintClearance,
  SETTLEMENT_SPACING_METRES,
  STRUCTURE_FOOTPRINTS,
  structuresAt,
  type Footprint,
} from './settlements';
import { drawnRoadFrame, type CorridorOrigin } from './terrain';
import { inWater, waterways } from './waterways';

/** The share of site boundaries that carry a billboard: **0.6** — one every kilometre or so. */
export const BILLBOARD_CHANCE = 0.6;

/** The most a billboard is moved along the road from its boundary: **40 m**. */
export const BILLBOARD_JITTER_METRES = 40;

/** How far from the centreline a billboard's middle stands: **9.5 m**. */
export const BILLBOARD_LATERAL_METRES = 9.5;

/** How far a billboard is turned from facing the road squarely, toward the rider: **25°**. */
export const BILLBOARD_YAW_RADIANS = (25 * Math.PI) / 180;

/** How far either side of a billboard the road's turn is read over: **30 m**. */
export const BEND_WINDOW_METRES = 30;

/** Below this turn the road is a straight, and either side will do: **1/400 m⁻¹**. */
export const STRAIGHT_RADIANS_PER_METRE = 1 / 400;

/** How far a structure must stay from a billboard's footprint: **1.5 m**. */
export const STRUCTURE_MARGIN_METRES = 1.5;

/** How far the natural scenery is kept from a billboard's footprint: **3 m** — a canopy's reach. */
export const SCENERY_MARGIN_METRES = 3;

/** The key the boundaries are hashed under, outside every other placer's. */
const BILLBOARD_KEY = 0x6_0000;

/** One uniform per quantity, one stream each. */
const STREAM_CHANCE = 0;
const STREAM_JITTER = 1;
const STREAM_SIDE = 2;

/** A billboard, placed. */
export interface Billboard {
  /** Local metres, the corridor's frame; `y` is the ground under its middle. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Yaw, radians: its face (`logo-board.ts`' `z`) is `(sin, cos)` of it. */
  readonly rotation: number;
  /** The odometer it stands at, unwrapped. */
  readonly along: number;
  /** Which side of the road: `+1` on the road's normal (the rider's right), `−1` the other. */
  readonly side: 1 | -1;
}

/**
 * Every billboard beside the road between two odometer readings, in order
 * along the road. Half-open, as `settlements.ts` §`structuresAt` is, so two
 * adjacent spans are a partition.
 */
export function billboardsAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  fromMetres: number,
  toMetres: number,
): readonly Billboard[] {
  const total = profile.totalDistance as number;
  const sites = Math.max(1, Math.round(total / SETTLEMENT_SPACING_METRES));
  if (sites < 2) return [];
  const span = total / sites;
  const jitter = Math.max(0, Math.min(BILLBOARD_JITTER_METRES, 0.3 * span - 120));
  const first = Math.floor((fromMetres - jitter) / span);
  // Never more boundaries than the route has: `settlements.ts`' own bound.
  const last = Math.min(Math.ceil((toMetres + jitter) / span), first + sites + 1);
  const found: Billboard[] = [];
  for (let boundary = first; boundary <= last; boundary += 1) {
    // Inside a point-to-point route only; on a loop, never at its start line.
    if (!profile.loop && (boundary <= 0 || boundary >= sites)) continue;
    const wrapped = ((boundary % sites) + sites) % sites;
    if (wrapped === 0) continue;
    const hash = slotHash(seed, wrapped, BILLBOARD_KEY);
    if (uniformFrom(hash, STREAM_CHANCE) >= BILLBOARD_CHANCE) continue;
    const along = boundary * span + (2 * uniformFrom(hash, STREAM_JITTER) - 1) * jitter;
    if (along < fromMetres || along >= toMetres) continue;
    const placed = billboardAt(
      profile,
      origin,
      seed,
      along,
      uniformFrom(hash, STREAM_SIDE) < 0.5 ? 1 : -1,
    );
    if (placed !== undefined) found.push(placed);
  }
  return found;
}

/** The billboard at one odometer reading, or none where the rules leave no room. */
function billboardAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  along: number,
  hashedSide: 1 | -1,
): Billboard | undefined {
  const at = distanceOnRoute(profile, along);
  const turn = turnAt(profile, origin, at);
  if (turn === undefined || Math.abs(turn) > TIGHT_BEND_RADIANS_PER_METRE) return undefined;
  // On a bend, the side the road turns AWAY from: a turn toward the normal
  // (positive) puts the inside on the normal's side.
  const side: 1 | -1 =
    Math.abs(turn) > STRAIGHT_RADIANS_PER_METRE ? (turn > 0 ? -1 : 1) : hashedSide;
  const frame = drawnRoadFrame(profile, origin, at);
  if (frame === undefined) return undefined;
  const lateral = BILLBOARD_LATERAL_METRES * side;
  // Facing the road, turned toward a rider riding at it: back along the
  // road's direction, `(normalZ, −normalX)`.
  const towardRoad = { x: -frame.normalX * side, z: -frame.normalZ * side };
  const backAlong = { x: -frame.normalZ, z: frame.normalX };
  const cos = Math.cos(BILLBOARD_YAW_RADIANS);
  const sin = Math.sin(BILLBOARD_YAW_RADIANS);
  const faceX = towardRoad.x * cos + backAlong.x * sin;
  const faceZ = towardRoad.z * cos + backAlong.z * sin;
  // Its middle and both posts out of the water — #966's review: the posts
  // stand {@link LOGO_POST_ACROSS_METRES} either side along the board's
  // across axis `(faceZ, −faceX)`, which at this yaw is mostly ALONG the
  // road, so a board whose middle is dry beside a stream's bank can have a
  // post in the channel.
  const ways = waterways(profile, seed);
  for (const post of [0, -1, 1]) {
    const dx = post * LOGO_POST_ACROSS_METRES * faceZ;
    const dz = -post * LOGO_POST_ACROSS_METRES * faceX;
    // In the road's frame: along its heading `(normalZ, −normalX)`, and out along its normal.
    const alongOffset = dx * frame.normalZ - dz * frame.normalX;
    const lateralOffset = dx * frame.normalX + dz * frame.normalZ;
    const foot = post === 0 ? at : distanceOnRoute(profile, along + alongOffset);
    if (inWater(ways, profile, foot, lateral + lateralOffset)) return undefined;
  }
  const board = {
    x: frame.x + frame.normalX * lateral,
    z: frame.z + frame.normalZ * lateral,
    rotation: Math.atan2(faceX, faceZ),
  };
  if (footprintClearance(profile, origin, board, BILLBOARD_FOOTPRINT) < ROAD_CLEARANCE_METRES) {
    return undefined;
  }
  if (meetsAStructure(profile, origin, seed, along, board)) return undefined;
  return {
    ...board,
    y: terrainHeightAt(profile, origin, seed, at, lateral),
    along,
    side,
  };
}

/**
 * The billboards one frame carries — #966: the nearest to the rider first, no
 * more than the frame's structure budget allows and never more than
 * `logo-board.ts` §`BILLBOARDS_PER_FRAME`, the wordmark belt's room once the
 * gate's boards are drawn. Taken before any scenery is cleared for them, so a
 * board the belt could not draw never leaves a bare patch.
 */
export function nearestBillboards(
  billboards: readonly Billboard[],
  riderMetres: number,
  structureBudget: number,
): readonly Billboard[] {
  return billboards
    .slice()
    .sort((one, other) => Math.abs(one.along - riderMetres) - Math.abs(other.along - riderMetres))
    .slice(0, Math.max(0, Math.min(structureBudget, BILLBOARDS_PER_FRAME)));
}

/**
 * How fast the drawn road turns at a route distance, in radians a metre:
 * positive toward its normal (the rider's right), negative away. Undefined
 * where the road has no direction.
 */
export function turnAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  at: number,
): number | undefined {
  const before = drawnRoadFrame(profile, origin, distanceOnRoute(profile, at - BEND_WINDOW_METRES));
  const after = drawnRoadFrame(profile, origin, distanceOnRoute(profile, at + BEND_WINDOW_METRES));
  if (before === undefined || after === undefined) return undefined;
  // The road's direction is `(normalZ, −normalX)`; the turn from one to the
  // other, signed so that turning toward the normal is positive.
  const beforeX = before.normalZ;
  const beforeZ = -before.normalX;
  const afterX = after.normalZ;
  const afterZ = -after.normalX;
  const cross = beforeX * afterZ - beforeZ * afterX;
  const dot = beforeX * afterX + beforeZ * afterZ;
  // The normal of the direction (dx, dz) is (−dz, dx), so a direction turned
  // toward it has a POSITIVE cross product with the one before.
  return Math.atan2(cross, dot) / (2 * BEND_WINDOW_METRES);
}

/** Whether any structure near `along` comes within {@link STRUCTURE_MARGIN_METRES} of the board. */
function meetsAStructure(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  along: number,
  board: { readonly x: number; readonly z: number; readonly rotation: number },
): boolean {
  const reach = BILLBOARD_FOOTPRINT.x + 60;
  const near = structuresAt(profile, origin, seed, along - reach, along + reach, {
    maxItems: Number.POSITIVE_INFINITY,
    riderMetres: along,
  });
  return near.some((item) =>
    footprintsMeet(
      board,
      BILLBOARD_FOOTPRINT,
      item,
      STRUCTURE_FOOTPRINTS[item.kind as keyof typeof STRUCTURE_FOOTPRINTS],
      STRUCTURE_MARGIN_METRES,
    ),
  );
}

/** A footprint standing somewhere, as a rectangle: its middle, its axes and its half-sizes. */
interface Rectangle {
  readonly x: number;
  readonly z: number;
  /** Its own `x` axis, and its own `z` axis, in the ground plane. */
  readonly ax: readonly [number, number];
  readonly az: readonly [number, number];
  readonly halfX: number;
  readonly halfZ: number;
}

function rectangleOf(
  at: { readonly x: number; readonly z: number; readonly rotation: number },
  footprint: Footprint,
  margin: number,
): Rectangle {
  // A yaw maps the frame's `z` to `(sin, cos)` and its `x` to `(cos, −sin)`.
  const sin = Math.sin(at.rotation);
  const cos = Math.cos(at.rotation);
  const middle = (footprint.back + footprint.front) / 2;
  return {
    x: at.x + sin * middle,
    z: at.z + cos * middle,
    ax: [cos, -sin],
    az: [sin, cos],
    halfX: footprint.x + margin,
    halfZ: (footprint.front - footprint.back) / 2 + margin,
  };
}

/**
 * Whether two footprints come within `margin` of each other — two rectangles,
 * one grown by the margin, tested on the separating-axis theorem.
 */
export function footprintsMeet(
  first: { readonly x: number; readonly z: number; readonly rotation: number },
  firstFootprint: Footprint,
  second: { readonly x: number; readonly z: number; readonly rotation: number },
  secondFootprint: Footprint,
  margin: number,
): boolean {
  const a = rectangleOf(first, firstFootprint, margin);
  const b = rectangleOf(second, secondFootprint, 0);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const [axisX, axisZ] of [a.ax, a.az, b.ax, b.az]) {
    const reachA =
      a.halfX * Math.abs(a.ax[0] * axisX + a.ax[1] * axisZ) +
      a.halfZ * Math.abs(a.az[0] * axisX + a.az[1] * axisZ);
    const reachB =
      b.halfX * Math.abs(b.ax[0] * axisX + b.ax[1] * axisZ) +
      b.halfZ * Math.abs(b.az[0] * axisX + b.az[1] * axisZ);
    if (Math.abs(dx * axisX + dz * axisZ) > reachA + reachB) return false;
  }
  return true;
}

/**
 * The natural scenery, less anything standing within
 * {@link SCENERY_MARGIN_METRES} of a billboard — `settlements.ts`
 * §`clearOfBuildings`' move, for the billboards. A function of positions only.
 */
export function clearOfBillboards(
  natural: readonly ScatterItem[],
  billboards: readonly Billboard[],
): readonly ScatterItem[] {
  if (billboards.length === 0) return natural;
  return natural.filter((item) =>
    billboards.every(
      (board) =>
        !footprintsMeet(
          board,
          BILLBOARD_FOOTPRINT,
          { x: item.x, z: item.z, rotation: 0 },
          { x: 0, back: 0, front: 0 },
          SCENERY_MARGIN_METRES,
        ),
    ),
  );
}
