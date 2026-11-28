// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The road's own safety furniture outside a village — #3284: a steel guard
 * rail where the ground falls away beside the road, on the outside of a tight
 * bend over a drop and on a bridge's approaches, and white marker posts along
 * an open road with no kerb. No map carries either, so both are placed by
 * rule, from the route and the landform the frame already draws.
 *
 * ⚠️ **Not `barrier=*`.** #3008's and #2977's barriers are the map's fences,
 * walls and hedges away from the road (`settlements.ts`, `boundary-*`). This is
 * road furniture, and it stands on the verge.
 *
 * ## Where (`roadsidePlacement`)
 *
 * A pure function of a {@link RoadsideSite}: what the ground does beside the
 * road, how the road bends, where something crosses its edge, where a kerb
 * runs and where the bridges are. Sampled every {@link RAIL_SAMPLE_METRES} on
 * the ODOMETER's own grid, never the corridor's rows (which slide with the
 * rider, `terrain.ts` §`roadCorridor`), so a run's ends stay put as the rider
 * rides up to them.
 *
 * - **A rail** on a side where the ground falls more than
 *   {@link RAIL_DROP_METRES} within {@link RAIL_DROP_REACH_METRES} of the
 *   road's edge; on the OUTSIDE of a bend tighter than
 *   {@link RAIL_BEND_RADIUS_METRES} where it also falls more than
 *   {@link RAIL_BEND_DROP_METRES}; and for {@link RAIL_APPROACH_METRES} along
 *   each approach to a bridge, starting at its parapet's end.
 * - **A marker post** every {@link MARKER_POST_SPACING_METRES} on each side,
 *   every {@link MARKER_POST_BEND_SPACING_METRES} on a bend tighter than
 *   {@link MARKER_BEND_RADIUS_METRES}, wherever no rail runs on that side.
 * - **Neither** across a side road's mouth, a driveway, a field gate or a
 *   footway (`RoadsideSite.clearAt`), on a bridge, or along a village's or a
 *   city's kerbed pavement (`RoadsideSite.kerbedAt`).
 *
 * ## What (`guardRailParts`, `markerPostItems`)
 *
 * - **A rail** is boxes, `waterways.ts` §`BridgePart`'s, drawn as instances
 *   of the overpass box (`three-renderer.ts` §`BridgeBelt`) in galvanised
 *   steel: a W-beam of three boxes a piece (two ridges proud of a web) on a
 *   post every {@link RAIL_POST_SPACING_METRES}, at most `realistic-budget.ts`
 *   §`REALISTIC_GUARD_RAIL_BOXES` a frame, nearest first. ⚠️ **Read off the
 *   drawn road's own vertices** (`RoadCorridor.vertices`' edge columns), so
 *   the rail's top is {@link RAIL_TOP_METRES} over the road's edge at every
 *   corridor row and straight between them, as the road is: it neither floats
 *   nor sinks on a gradient. A piece spans as many rows as stay within
 *   {@link RAIL_HEIGHT_TOLERANCE_METRES} of its chord.
 * - **A marker post** is the scenery's own `post` (`scatter.ts`
 *   §`ScatterKind`, the white post the scatter already stands at tight bends),
 *   so it is drawn in that kind's mesh. Its reflector band is not drawn: the
 *   post is one solid, and a band would re-cut a shape every bend's post
 *   wears.
 *
 * ⚠️ **The realistic world only**, and neither has a draw call of its own. The
 * stylised world's scenery-free frame (`browser/game-harness.ts`, `scatter`
 * emptied) is held to exactly `realistic-budget.ts`
 * §`STYLISED_SCENE_DRAW_CALLS` (11), and the overpass box or the post's mesh
 * would be a twelfth call on such a frame with a rail or a post beside it, so
 * its ceiling does not allow them. In the realistic world the overpass box
 * costs a call on a frame with a rail and no overpass, as it did on a frame
 * with an overpass (#2699), and the posts' mesh none where the scatter
 * already stands a post in view.
 */

import { distanceOnRoute, elevationAt, type RouteProfile } from '@onyourleft/domain';

import type { SideRoad } from './cross-streets';
import type { FootwayPiece } from './footway-surfaces';
import type { LandClassMask } from './land-class';
import { terrainHeightAt, VERGE_DROP_METRES } from './landform';
import { REALISTIC_GUARD_RAIL_BOXES } from './realistic-budget';
import type { ScatterItem } from './scatter';
import { FIELD_GATE_SCALE } from './settlements';
import type { VillageStreet } from './streets';
import {
  drawnRoadPosition,
  ROAD_COLUMNS,
  ROAD_WIDTH_METRES,
  type CorridorOrigin,
  type CorridorPoint,
  type RoadCorridor,
} from './terrain';
import type { BridgePart } from './waterways';

/** Half the carriageway, where the road's edge is: **3.5 m**. */
const ROAD_HALF_WIDTH_METRES = ROAD_WIDTH_METRES / 2;

/** A side of the road: `+1` on its normal (the rider's right), `−1` the other. */
export type RoadSide = 1 | -1;

/** How far apart along the odometer the rule is read, in metres: **2**. */
export const RAIL_SAMPLE_METRES = 2;

/**
 * How far the ground must fall below the road's edge for a rail, in metres:
 * **4** — about a storey, which is where a car leaving the road is hurt by
 * the fall rather than by the verge.
 */
export const RAIL_DROP_METRES = 3;

/**
 * Within how far of the road's edge that fall is measured, in metres:
 * **24** — the landform's columns out to its 27 m one (`landform.ts`
 * §`TERRAIN_COLUMN_OFFSETS`), so a fall is a bank beside the road and not a
 * valley a field away.
 */
export const RAIL_DROP_REACH_METRES = 24;

/** A bend tighter than this radius takes a rail on its outside over a smaller drop, in metres: **60**. */
export const RAIL_BEND_RADIUS_METRES = 60;

/** The fall a tight bend's outside takes a rail over, in metres: **1.5**. */
export const RAIL_BEND_DROP_METRES = 1;

/** How far a rail runs along each approach to a bridge from its parapet's end, in metres: **20**. */
export const RAIL_APPROACH_METRES = 20;

/** A run shorter than this is not drawn, in metres: **8** — two posts' worth. */
export const RAIL_MIN_RUN_METRES = 8;

/**
 * How far from the centreline the rail's beam stands, in metres: **3.8** —
 * 0.3 m out from the road's edge, inside a bridge parapet's 0.35 m, so a rail
 * meets a parapet's end face rather than standing proud of it.
 */
export const RAIL_LATERAL_METRES = ROAD_HALF_WIDTH_METRES + 0.3;

/** How far the rail's top stands above the road's edge beside it, in metres: **0.75**. */
export const RAIL_TOP_METRES = 0.75;

/** How tall the W-beam is, in metres: **0.31**, a standard beam's. */
export const RAIL_BEAM_METRES = 0.31;

/** How far apart a rail's posts are along it, in metres: **4**. */
export const RAIL_POST_SPACING_METRES = 4;

/** The longest one piece of beam may be, in metres: **12**. */
export const RAIL_PIECE_MAX_METRES = 12;

/**
 * How far a piece of beam's top may stand off the drawn road's edge height
 * plus {@link RAIL_TOP_METRES}, at every row of the road it spans, in
 * metres: **0.02**.
 */
export const RAIL_HEIGHT_TOLERANCE_METRES = 0.02;

/** How far a bridge approach's beam runs on into the parapet's end, in metres: **0.2**. */
export const RAIL_PARAPET_OVERLAP_METRES = 0.2;

/**
 * The widest gap there may be between a rail and the parapet it meets, in
 * metres: **0.05**. The beam overlaps the parapet's end by
 * {@link RAIL_PARAPET_OVERLAP_METRES}, so the gap is nought by construction
 * and this is the tolerance `roadside-safety.test.ts` holds it to.
 *
 * @test-facing the figure the bridge fixture's gap is held to
 */
export const RAIL_PARAPET_GAP_METRES = 0.05;

/** How far apart marker posts are along an open road, in metres: **50**. */
export const MARKER_POST_SPACING_METRES = 50;

/** How far apart marker posts are on a bend, in metres: **25**. */
export const MARKER_POST_BEND_SPACING_METRES = MARKER_POST_SPACING_METRES / 2;

/** A bend tighter than this radius takes its marker posts closer, in metres: **200**. */
export const MARKER_BEND_RADIUS_METRES = 200;

/** How far from the centreline a marker post stands, in metres: **4.3**, 0.8 m out on the verge. */
export const MARKER_POST_LATERAL_METRES = ROAD_HALF_WIDTH_METRES + 0.8;

/** How far past a kerbed pavement's ends neither rail nor post stands, in metres: **10**. */
export const KERB_MARGIN_METRES = 10;

/** How far clear of a side road's or a footway's edge a rail or post keeps, in metres: **2**. */
export const MOUTH_MARGIN_METRES = 2;

/** How far ahead of the rider a rail is drawn, in metres: **250**. */
export const RAIL_DRAW_AHEAD_METRES = 250;

/** How far ahead of the rider a post is drawn, in metres: **150** — a rail's or a marker. */
export const POST_DRAW_AHEAD_METRES = 150;

/** How far behind the rider either is drawn, in metres: **40**. */
export const ROADSIDE_DRAW_BEHIND_METRES = 40;

/** A bridge's parapets along the road, as odometer readings. */
export interface ParapetSpan {
  readonly from: number;
  readonly to: number;
}

/** What {@link roadsidePlacement} reads the road from. @see the header */
export interface RoadsideSite {
  /** The odometer stretch to place along. */
  readonly from: number;
  readonly to: number;
  /** How far the ground falls below the road's edge, the most within {@link RAIL_DROP_REACH_METRES}, in metres. */
  readonly dropAt: (along: number, side: RoadSide) => number;
  /** The drawn road's curvature, per metre, positive where it turns toward side `+1`. */
  readonly curvatureAt: (along: number) => number;
  /** False where a side road's mouth, a driveway, a field gate or a footway meets the road's edge. */
  readonly clearAt: (along: number, side: RoadSide, lateral: number) => boolean;
  /** True along a village's or a city's kerbed pavement. */
  readonly kerbedAt: (along: number) => boolean;
  /** The bridges' parapets. */
  readonly bridges: readonly ParapetSpan[];
}

/** One unbroken stretch of rail, odometer `from` to `to`. */
export interface RailRun {
  readonly side: RoadSide;
  readonly from: number;
  readonly to: number;
  /** Whether `from` is a bridge parapet's end, which the beam runs on into. */
  readonly parapetFrom?: true;
  /** Whether `to` is. */
  readonly parapetTo?: true;
}

/** One marker post. */
export interface MarkerPost {
  readonly side: RoadSide;
  readonly along: number;
}

/** Where the rails and the marker posts go. */
export interface RoadsidePlacement {
  readonly rails: readonly RailRun[];
  readonly posts: readonly MarkerPost[];
}

const SIDES: readonly RoadSide[] = [1, -1];

/** Where the guard rails and marker posts stand along `site`. @see the header */
export function roadsidePlacement(site: RoadsideSite): RoadsidePlacement {
  const onBridge = (along: number): boolean =>
    site.bridges.some((span) => along >= span.from && along <= span.to);
  const onApproach = (along: number): boolean =>
    site.bridges.some(
      (span) =>
        (along > span.to && along <= span.to + RAIL_APPROACH_METRES) ||
        (along < span.from && along >= span.from - RAIL_APPROACH_METRES),
    );
  const railWanted = (along: number, side: RoadSide): boolean => {
    if (onBridge(along) || site.kerbedAt(along)) return false;
    let wanted = onApproach(along);
    if (!wanted) {
      const drop = site.dropAt(along, side);
      if (drop > RAIL_DROP_METRES) {
        wanted = true;
      } else if (drop > RAIL_BEND_DROP_METRES) {
        const curvature = site.curvatureAt(along);
        const outside: RoadSide = curvature > 0 ? -1 : 1;
        wanted = Math.abs(curvature) > 1 / RAIL_BEND_RADIUS_METRES && side === outside;
      }
    }
    return wanted && site.clearAt(along, side, RAIL_LATERAL_METRES);
  };

  const rails: RailRun[] = [];
  const first = Math.ceil(site.from / RAIL_SAMPLE_METRES);
  const last = Math.floor(site.to / RAIL_SAMPLE_METRES);
  for (const side of SIDES) {
    let start: number | undefined;
    let end = 0;
    const close = (): void => {
      if (start === undefined) return;
      rails.push(meetingParapets({ side, from: start, to: end }, site.bridges));
      start = undefined;
    };
    for (let index = first; index <= last; index += 1) {
      const along = index * RAIL_SAMPLE_METRES;
      if (railWanted(along, side)) {
        start ??= along;
        end = along;
      } else {
        close();
      }
    }
    close();
  }
  const kept = rails.filter((run) => run.to - run.from >= RAIL_MIN_RUN_METRES);

  const posts: MarkerPost[] = [];
  const every = MARKER_POST_SPACING_METRES / MARKER_POST_BEND_SPACING_METRES;
  for (
    let index = Math.ceil(site.from / MARKER_POST_BEND_SPACING_METRES);
    index * MARKER_POST_BEND_SPACING_METRES <= site.to;
    index += 1
  ) {
    const along = index * MARKER_POST_BEND_SPACING_METRES;
    if (
      index % every !== 0 &&
      !(Math.abs(site.curvatureAt(along)) > 1 / MARKER_BEND_RADIUS_METRES)
    ) {
      continue;
    }
    if (onBridge(along) || onApproach(along) || site.kerbedAt(along)) continue;
    for (const side of SIDES) {
      const railed = kept.some(
        (run) =>
          run.side === side &&
          along >= run.from - RAIL_POST_SPACING_METRES &&
          along <= run.to + RAIL_POST_SPACING_METRES,
      );
      if (railed || !site.clearAt(along, side, MARKER_POST_LATERAL_METRES)) continue;
      posts.push({ side, along });
    }
  }
  return { rails: kept, posts };
}

/** A run whose end is the sample next to a bridge's parapet, carried on to the parapet's end. */
function meetingParapets(run: RailRun, bridges: readonly ParapetSpan[]): RailRun {
  let met: RailRun = run;
  for (const span of bridges) {
    if (met.from > span.to && met.from - span.to <= RAIL_SAMPLE_METRES) {
      met = { ...met, from: span.to, parapetFrom: true };
    }
    if (met.to < span.from && span.from - met.to <= RAIL_SAMPLE_METRES) {
      met = { ...met, to: span.from, parapetTo: true };
    }
  }
  return met;
}

// --- The boxes ------------------------------------------------------------

/** A point in the corridor's frame. */
interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Where the drawn road's edge is at odometer `along` on `side`, carried out
 * along the road's own normal to `lateral` from the centreline: `undefined`
 * off the corridor, or on a row the corridor does not draw (`retraced`).
 *
 * ⚠️ **The road's own vertices**, `RoadCorridor.vertices`' outermost columns
 * (column 0 at `+` half the road, the last at `−`): a row of the ribbon is
 * flat across, and straight to the next row, so this is the drawn road's
 * height and plan exactly, between rows as well as at them.
 */
function edgeAt(
  corridor: RoadCorridor,
  along: number,
  side: RoadSide,
  lateral: number,
): Point | undefined {
  const rows = corridor.centre;
  const row = rowBefore(rows, along);
  if (row === undefined) return undefined;
  if ((corridor.retraced[row] ?? 0) !== 0 || (corridor.retraced[row + 1] ?? 0) !== 0) {
    return undefined;
  }
  const near = rows[row] as CorridorPoint;
  const far = rows[row + 1] as CorridorPoint;
  const span = far.along - near.along;
  const t = span > 0 ? (along - near.along) / span : 0;
  const column = side === 1 ? 0 : ROAD_COLUMNS - 1;
  const scale = lateral / ROAD_HALF_WIDTH_METRES;
  const at = (index: number, centre: CorridorPoint): Point => {
    const offset = (index * ROAD_COLUMNS + column) * 3;
    const ex = corridor.vertices[offset] as number;
    const ey = corridor.vertices[offset + 1] as number;
    const ez = corridor.vertices[offset + 2] as number;
    return { x: centre.x + (ex - centre.x) * scale, y: ey, z: centre.z + (ez - centre.z) * scale };
  };
  const a = at(row, near);
  const b = at(row + 1, far);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/** The last row at or before `along` that has a row after it, or `undefined` off the corridor. */
function rowBefore(rows: readonly CorridorPoint[], along: number): number | undefined {
  if (rows.length < 2) return undefined;
  const firstRow = rows[0] as CorridorPoint;
  const lastRow = rows[rows.length - 1] as CorridorPoint;
  if (along < firstRow.along || along > lastRow.along) return undefined;
  let low = 0;
  let high = rows.length - 2;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((rows[middle] as CorridorPoint).along <= along) low = middle;
    else high = middle - 1;
  }
  return low;
}

/**
 * A box whose top face's middle runs straight from `a` to `b`, `width` across
 * level and `height` deep square to it — `three-renderer.ts`
 * §`BridgeBelt.update`'s box: its `up` is `(−ax·ay, flat², −az·ay) / flat`.
 */
function hungBox(a: Point, b: Point, width: number, height: number): GuardRailPart | undefined {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dy, dz);
  const flat = Math.hypot(dx, dz);
  if (!(flat > 0)) return undefined;
  const ax = dx / length;
  const ay = dy / length;
  const az = dz / length;
  const flatShare = flat / length;
  const half = height / 2;
  return {
    x: (a.x + b.x) / 2 + ((ax * ay) / flatShare) * half,
    y: (a.y + b.y) / 2 - flatShare * half,
    z: (a.z + b.z) / 2 + ((az * ay) / flatShare) * half,
    axisX: ax,
    axisY: ay,
    axisZ: az,
    length,
    width,
    height,
  };
}

/** A box standing upright, `bottom` to `top`, its length along the road's heading in plan. */
function standingBox(
  at: Point,
  heading: { readonly x: number; readonly z: number },
  size: { readonly along: number; readonly across: number },
  bottom: number,
  top: number,
): GuardRailPart {
  return {
    x: at.x,
    y: (bottom + top) / 2,
    z: at.z,
    axisX: heading.x,
    axisY: 0,
    axisZ: heading.z,
    length: size.along,
    width: size.across,
    height: top - bottom,
  };
}

/** One box of a guard rail, its beam's or a post's: a `waterways.ts` §`BridgePart`, painted galvanised steel. */
export type GuardRailPart = Omit<BridgePart, 'finish'>;

/** The W-beam's parts: a lateral offset outward of the beam's line, the top below the rail's top, a height and a width. */
const BEAM_PARTS: readonly {
  readonly out: number;
  readonly below: number;
  readonly height: number;
  readonly width: number;
}[] = [
  // The upper ridge, the rail's top.
  { out: 0, below: 0, height: 0.1, width: 0.06 },
  // The web the two ridges stand proud of.
  { out: 0.035, below: 0.02, height: RAIL_BEAM_METRES - 0.04, width: 0.03 },
  // The lower ridge.
  { out: 0, below: RAIL_BEAM_METRES - 0.1, height: 0.1, width: 0.06 },
];

/** How far behind the beam's line a rail post stands, in metres. */
const RAIL_POST_OUT_METRES = 0.1;

/** How far below the road's edge a rail post's foot is sunk, in metres. */
const POST_FOOT_METRES = 0.5;

/** A box and how far its middle is from the rider along the road. */
interface Ranked {
  readonly part: GuardRailPart;
  readonly distance: number;
}

/**
 * The boxes the rails of `placement` are drawn as along `corridor`, within
 * {@link RAIL_DRAW_AHEAD_METRES} (the beam) and {@link POST_DRAW_AHEAD_METRES}
 * (its posts) ahead of `riderDistance` and {@link ROADSIDE_DRAW_BEHIND_METRES}
 * behind it, nearest first, at most `realistic-budget.ts`
 * §`REALISTIC_GUARD_RAIL_BOXES`. @see the header
 */
export function guardRailParts(
  corridor: RoadCorridor,
  placement: RoadsidePlacement,
  riderDistance: number,
): readonly GuardRailPart[] {
  const ranked: Ranked[] = [];
  const behind = riderDistance - ROADSIDE_DRAW_BEHIND_METRES;
  const railAhead = riderDistance + RAIL_DRAW_AHEAD_METRES;
  const postAhead = riderDistance + POST_DRAW_AHEAD_METRES;
  for (const run of placement.rails) {
    const from = Math.max(run.from, behind);
    const to = Math.min(run.to, railAhead);
    if (!(to > from)) continue;
    railPieces(corridor, run.side, from, to, run, riderDistance, ranked);
    for (
      let index = Math.ceil(from / RAIL_POST_SPACING_METRES);
      index * RAIL_POST_SPACING_METRES <= Math.min(to, postAhead);
      index += 1
    ) {
      const along = index * RAIL_POST_SPACING_METRES;
      const post = postAt(corridor, along, run.side, RAIL_LATERAL_METRES + RAIL_POST_OUT_METRES);
      if (post === undefined) continue;
      ranked.push({
        part: standingBox(
          post.at,
          post.heading,
          { along: 0.15, across: 0.1 },
          post.at.y - POST_FOOT_METRES,
          post.at.y + RAIL_TOP_METRES - 0.05,
        ),
        distance: Math.abs(along - riderDistance),
      });
    }
  }
  ranked.sort((a, b) => a.distance - b.distance);
  return ranked.slice(0, REALISTIC_GUARD_RAIL_BOXES).map((each) => each.part);
}

/**
 * The marker posts of `placement` within {@link POST_DRAW_AHEAD_METRES} ahead
 * of `riderDistance` and {@link ROADSIDE_DRAW_BEHIND_METRES} behind it, as
 * `post` scenery items standing on the verge's ground beside the drawn road:
 * the scenery's own white post (`three-renderer.ts` §`SCATTER_STYLE`), which
 * the realistic world already draws at its tight bends, so a frame with one
 * in view spends no call on them. ⚠️ **Not in `SceneFrame.scatter`**, whose
 * arrangement `arrangement-unchanged.test.ts` pins: `SceneFrame.markerPosts`.
 */
export function markerPostItems(
  corridor: RoadCorridor,
  placement: RoadsidePlacement,
  riderDistance: number,
): readonly ScatterItem[] {
  const items: ScatterItem[] = [];
  for (const marker of placement.posts) {
    if (
      marker.along < riderDistance - ROADSIDE_DRAW_BEHIND_METRES ||
      marker.along > riderDistance + POST_DRAW_AHEAD_METRES
    ) {
      continue;
    }
    const at = edgeAt(corridor, marker.along, marker.side, MARKER_POST_LATERAL_METRES);
    if (at === undefined) continue;
    items.push({
      kind: 'post',
      x: at.x,
      y: at.y - VERGE_DROP_METRES,
      z: at.z,
      rotation: 0,
      scale: 1,
      variant: 0,
    });
  }
  return items;
}

/** A post's foot at the road's edge height, and the road's heading in plan there. */
function postAt(
  corridor: RoadCorridor,
  along: number,
  side: RoadSide,
  lateral: number,
):
  { readonly at: Point; readonly heading: { readonly x: number; readonly z: number } } | undefined {
  const at = edgeAt(corridor, along, side, lateral);
  const ahead = edgeAt(corridor, along + 0.5, side, lateral) ?? at;
  const back = edgeAt(corridor, along - 0.5, side, lateral) ?? at;
  if (at === undefined || ahead === undefined || back === undefined) return undefined;
  const dx = ahead.x - back.x;
  const dz = ahead.z - back.z;
  const flat = Math.hypot(dx, dz);
  if (!(flat > 0)) return undefined;
  return { at, heading: { x: dx / flat, z: dz / flat } };
}

/**
 * The beam of `run` from `from` to `to`, pushed onto `ranked`: pieces whose
 * ends are the run's ends and the corridor's rows between, each as long as
 * keeps every row it spans within {@link RAIL_HEIGHT_TOLERANCE_METRES} of its
 * chord and no longer than {@link RAIL_PIECE_MAX_METRES}. An end at a
 * bridge's parapet runs {@link RAIL_PARAPET_OVERLAP_METRES} on into it.
 */
function railPieces(
  corridor: RoadCorridor,
  side: RoadSide,
  from: number,
  to: number,
  run: RailRun,
  riderDistance: number,
  ranked: Ranked[],
): void {
  const stations: number[] = [from];
  for (const row of corridor.centre) {
    if (row.along > from && row.along < to) stations.push(row.along);
  }
  stations.push(to);
  const line = (along: number): Point | undefined =>
    edgeAt(corridor, along, side, RAIL_LATERAL_METRES);
  let start = 0;
  while (start < stations.length - 1) {
    const a = line(stations[start] as number);
    if (a === undefined) {
      start += 1;
      continue;
    }
    let end = start + 1;
    while (end + 1 < stations.length) {
      const next = end + 1;
      if ((stations[next] as number) - (stations[start] as number) > RAIL_PIECE_MAX_METRES) break;
      const b = line(stations[next] as number);
      if (b === undefined || !withinChord(a, b, stations, start, next, line)) break;
      end = next;
    }
    const s0 = stations[start] as number;
    const s1 = stations[end] as number;
    const middle = (s0 + s1) / 2;
    for (const part of BEAM_PARTS) {
      const lateral = RAIL_LATERAL_METRES + part.out;
      let near = edgeAt(corridor, s0, side, lateral);
      let far = edgeAt(corridor, s1, side, lateral);
      if (near === undefined || far === undefined) continue;
      // A bridge approach's end runs on into the parapet, so the two meet.
      if (start === 0 && from === run.from && run.parapetFrom === true) {
        near = carriedOn(near, far, -RAIL_PARAPET_OVERLAP_METRES);
      }
      if (end === stations.length - 1 && to === run.to && run.parapetTo === true) {
        far = carriedOn(far, near, -RAIL_PARAPET_OVERLAP_METRES);
      }
      const top = RAIL_TOP_METRES - part.below;
      const box = hungBox(lifted(near, top), lifted(far, top), part.width, part.height);
      if (box !== undefined) ranked.push({ part: box, distance: Math.abs(middle - riderDistance) });
    }
    start = end;
  }
}

/** `point` raised by `by` metres. */
function lifted(point: Point, by: number): Point {
  return { x: point.x, y: point.y + by, z: point.z };
}

/** `point` moved `by` metres along the line from `toward` through it (negative: away from `toward`). */
function carriedOn(point: Point, toward: Point, by: number): Point {
  const dx = toward.x - point.x;
  const dy = toward.y - point.y;
  const dz = toward.z - point.z;
  const length = Math.hypot(dx, dy, dz);
  if (!(length > 0)) return point;
  const share = by / length;
  return { x: point.x + dx * share, y: point.y + dy * share, z: point.z + dz * share };
}

/** Whether every station strictly between `start` and `end` lies within tolerance of the chord `a`–`b`. */
function withinChord(
  a: Point,
  b: Point,
  stations: readonly number[],
  start: number,
  end: number,
  line: (along: number) => Point | undefined,
): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const squared = dx * dx + dy * dy + dz * dz;
  for (let index = start + 1; index < end; index += 1) {
    const p = line(stations[index] as number);
    if (p === undefined) return false;
    const t = squared > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / squared : 0;
    const off = Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y, a.z + dz * t - p.z);
    if (off > RAIL_HEIGHT_TOLERANCE_METRES) return false;
  }
  return true;
}

// --- The scene's site -----------------------------------------------------

/** What the scene hands {@link roadsideInView}. */
export interface RoadsideScene {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly seed: number;
  readonly land: LandClassMask;
  readonly corridor: RoadCorridor;
  readonly riderDistance: number;
  readonly bridges: readonly ParapetSpan[];
  readonly sideRoads: readonly SideRoad[];
  readonly footways: readonly FootwayPiece[];
  readonly streets: readonly VillageStreet[];
  readonly scenery: readonly ScatterItem[];
}

/** The laterals a fall is read at: the landform's columns out to {@link RAIL_DROP_REACH_METRES} past the edge. */
const DROP_LATERALS: readonly number[] = [
  ROAD_HALF_WIDTH_METRES + 0.6,
  8,
  12,
  18,
  ROAD_HALF_WIDTH_METRES + RAIL_DROP_REACH_METRES - 0.5,
];

/** How far either side of a point the bend is read over, in metres. */
const CURVATURE_HALF_METRES = 6;

/** A field gate's half-length, in metres: 6 m of rail (`settlements.ts` §`FIELD_GATE_SCALE`). */
const GATE_HALF_METRES = 3;

/** The most values a route's memo holds before it is emptied. */
const MEMO_LIMIT = 16_384;

/** Each route's falls and bends, read once a sample — the landform's and the drawn road's, which a ride never changes. */
const memos = new WeakMap<RouteProfile, WeakMap<LandClassMask, Map<number, Map<number, number>>>>();

/** `profile`'s memo under `land` and `seed`. */
function memoOf(profile: RouteProfile, land: LandClassMask, seed: number): Map<number, number> {
  let byLand = memos.get(profile);
  if (byLand === undefined) {
    byLand = new WeakMap();
    memos.set(profile, byLand);
  }
  let bySeed = byLand.get(land);
  if (bySeed === undefined) {
    bySeed = new Map();
    byLand.set(land, bySeed);
  }
  let memo = bySeed.get(seed);
  if (memo === undefined) {
    memo = new Map();
    bySeed.set(seed, memo);
  }
  if (memo.size > MEMO_LIMIT) memo.clear();
  return memo;
}

/**
 * The frame's guard rails and marker posts — {@link roadsidePlacement} over
 * the corridor the frame draws, read off the landform's own height
 * (`landform.ts` §`terrainHeightAt`), the drawn road's bends, the frame's side
 * roads, footways, field gates and pavements, and drawn by
 * {@link guardRailParts} and {@link markerPostItems}.
 */
export function roadsideInView(scene: RoadsideScene): RoadsideInView {
  const { profile, origin, seed, land, corridor } = scene;
  const rows = corridor.centre;
  if (rows.length < 2) return NO_ROADSIDE;
  const memo = memoOf(profile, land, seed);
  const sampleOf = (along: number): number =>
    Math.round(distanceOnRoute(profile, along) / RAIL_SAMPLE_METRES);
  const dropAt = (along: number, side: RoadSide): number => {
    const key = sampleOf(along) * 4 + (side === 1 ? 0 : 1);
    const known = memo.get(key);
    if (known !== undefined) return known;
    const wrapped = distanceOnRoute(profile, along);
    const road = elevationAt(profile, wrapped) - origin.elevation;
    let lowest = Number.POSITIVE_INFINITY;
    for (const lateral of DROP_LATERALS) {
      lowest = Math.min(
        lowest,
        terrainHeightAt(profile, origin, seed, wrapped, lateral * side, land),
      );
    }
    const drop = road - lowest;
    memo.set(key, drop);
    return drop;
  };
  const curvatureAt = (along: number): number => {
    const key = sampleOf(along) * 4 + 2;
    const known = memo.get(key);
    if (known !== undefined) return known;
    const back = drawnRoadPosition(profile, origin, along - CURVATURE_HALF_METRES);
    const here = drawnRoadPosition(profile, origin, along);
    const ahead = drawnRoadPosition(profile, origin, along + CURVATURE_HALF_METRES);
    const t1x = here.x - back.x;
    const t1z = here.z - back.z;
    const t2x = ahead.x - here.x;
    const t2z = ahead.z - here.z;
    const length = (Math.hypot(t1x, t1z) + Math.hypot(t2x, t2z)) / 2;
    const turned = Math.atan2(t1x * t2z - t1z * t2x, t1x * t2x + t1z * t2z);
    const curvature = length > 0 ? turned / length : 0;
    memo.set(key, curvature);
    return curvature;
  };
  const blockers = blockersNear(scene);
  const clearAt = (along: number, side: RoadSide, lateral: number): boolean => {
    const at = edgeAt(corridor, along, side, lateral);
    const centre = edgeAt(corridor, along, side, 0);
    if (at === undefined || centre === undefined) return false;
    if (land.classAt(at.x, at.z) === 'built-up') return false;
    const spot: RoadsideSpot = {
      x: at.x,
      z: at.z,
      centreX: centre.x,
      centreZ: centre.z,
      outX: at.x - centre.x,
      outZ: at.z - centre.z,
    };
    return !blockers.some((blocker) => blocker(spot));
  };
  const kerbedAt = (along: number): boolean =>
    scene.streets.some(
      (street) =>
        along >= street.from - KERB_MARGIN_METRES && along <= street.to + KERB_MARGIN_METRES,
    );
  const placement = roadsidePlacement({
    from: Math.max(
      (rows[0] as CorridorPoint).along,
      scene.riderDistance - ROADSIDE_DRAW_BEHIND_METRES,
    ),
    to: Math.min(
      (rows[rows.length - 1] as CorridorPoint).along,
      scene.riderDistance + RAIL_DRAW_AHEAD_METRES,
    ),
    dropAt,
    curvatureAt,
    clearAt,
    kerbedAt,
    bridges: scene.bridges,
  });
  return {
    rails: guardRailParts(corridor, placement, scene.riderDistance),
    posts: markerPostItems(corridor, placement, scene.riderDistance),
  };
}

/** A frame's guard rails, as boxes, and its marker posts, as scenery. */
export interface RoadsideInView {
  readonly rails: readonly GuardRailPart[];
  readonly posts: readonly ScatterItem[];
}

/** Nothing beside the road: a corridor too short to place along. */
const NO_ROADSIDE: RoadsideInView = Object.freeze({ rails: [], posts: [] });

/** Where a rail or post would stand, and the road's centre and outward direction beside it, in plan. */
interface RoadsideSpot {
  readonly x: number;
  readonly z: number;
  readonly centreX: number;
  readonly centreZ: number;
  readonly outX: number;
  readonly outZ: number;
}

/** A test of whether a spot is on something that crosses the road's edge on its side. */
type Blocker = (spot: RoadsideSpot) => boolean;

/**
 * The frame's side roads (mouths and driveways), footways and field gates
 * within reach of the drawn road, each as a test of a point — the segments
 * and points farther than they could reach dropped first, once a frame.
 */
function blockersNear(scene: RoadsideScene): readonly Blocker[] {
  const box = corridorBox(scene.corridor.centre, MARKER_POST_LATERAL_METRES + MOUTH_MARGIN_METRES);
  const near = (x: number, z: number, reach: number): boolean =>
    x >= box.minX - reach &&
    x <= box.maxX + reach &&
    z >= box.minZ - reach &&
    z <= box.maxZ + reach;
  const segments: number[] = [];
  for (const road of scene.sideRoads) {
    for (let index = 0; index < road.halfWidths.length; index += 1) {
      const reach = (road.halfWidths[index] as number) + MOUTH_MARGIN_METRES;
      const x0 = road.segments[index * 4] as number;
      const z0 = road.segments[index * 4 + 1] as number;
      const x1 = road.segments[index * 4 + 2] as number;
      const z1 = road.segments[index * 4 + 3] as number;
      if (
        Math.max(x0, x1) < box.minX - reach ||
        Math.min(x0, x1) > box.maxX + reach ||
        Math.max(z0, z1) < box.minZ - reach ||
        Math.min(z0, z1) > box.maxZ + reach
      ) {
        continue;
      }
      segments.push(x0, z0, x1, z1, reach);
    }
  }
  const points: number[] = [];
  for (const piece of scene.footways) {
    for (let at = 0; at + 2 < piece.positions.length; at += 3) {
      const x = piece.positions[at] as number;
      const z = piece.positions[at + 2] as number;
      if (near(x, z, MOUTH_MARGIN_METRES)) points.push(x, z, MOUTH_MARGIN_METRES);
    }
  }
  for (const item of scene.scenery) {
    if (item.kind !== 'fence' || item.chainLink === true || item.scale !== FIELD_GATE_SCALE)
      continue;
    const reach = GATE_HALF_METRES + MOUTH_MARGIN_METRES;
    if (near(item.x, item.z, reach)) points.push(item.x, item.z, reach);
  }
  const blockers: Blocker[] = [];
  if (segments.length > 0) {
    blockers.push((spot) => {
      for (let at = 0; at < segments.length; at += 5) {
        const near = nearestOnSegment(
          spot.x,
          spot.z,
          segments[at] as number,
          segments[at + 1] as number,
          segments[at + 2] as number,
          segments[at + 3] as number,
        );
        if (
          Math.hypot(near.x - spot.x, near.z - spot.z) <= (segments[at + 4] as number) &&
          onSide(spot, near.x, near.z)
        ) {
          return true;
        }
      }
      return false;
    });
  }
  if (points.length > 0) {
    blockers.push((spot) => {
      for (let at = 0; at < points.length; at += 3) {
        const x = points[at] as number;
        const z = points[at + 1] as number;
        if (
          Math.hypot(x - spot.x, z - spot.z) <= (points[at + 2] as number) &&
          onSide(spot, x, z)
        ) {
          return true;
        }
      }
      return false;
    });
  }
  return blockers;
}

/**
 * Whether `(x, z)` is on the spot's side of the road, past the middle of its
 * lane: a side road's arm starts ON the centreline at its junction, so its
 * first metres are within reach of the far side's verge too, and must not
 * break the rail there.
 */
function onSide(spot: RoadsideSpot, x: number, z: number): boolean {
  const out = Math.hypot(spot.outX, spot.outZ);
  return (
    out > 0 &&
    ((x - spot.centreX) * spot.outX + (z - spot.centreZ) * spot.outZ) / out >
      ROAD_HALF_WIDTH_METRES / 2
  );
}

/** The corridor's rows' bounding box in plan, grown by `by`. */
function corridorBox(
  rows: readonly CorridorPoint[],
  by: number,
): { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number } {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    minX = Math.min(minX, row.x);
    maxX = Math.max(maxX, row.x);
    minZ = Math.min(minZ, row.z);
    maxZ = Math.max(maxZ, row.z);
  }
  return { minX: minX - by, maxX: maxX + by, minZ: minZ - by, maxZ: maxZ + by };
}

/** The point of the segment `(x0, z0)`–`(x1, z1)` nearest `(x, z)`, in plan. */
function nearestOnSegment(
  x: number,
  z: number,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
): { readonly x: number; readonly z: number } {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const squared = dx * dx + dz * dz;
  const t = squared > 0 ? Math.min(1, Math.max(0, ((x - x0) * dx + (z - z0) * dz) / squared)) : 0;
  return { x: x0 + dx * t, z: z0 + dz * t };
}
