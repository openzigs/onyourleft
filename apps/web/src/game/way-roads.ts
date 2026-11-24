// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Way roads — #3106: **every way out of an open-world junction drawn as road
 * from the junction to the end of the view, whatever else draws of it.**
 *
 * ## Why the streets' own drawing is not enough
 *
 * An open-world ride's junction prompt offers the ways the STREET GRAPH holds
 * (`@onyourleft/map-features` §`StreetGraph`, read through the rolling
 * route). What the scene draws of a street comes by another path: a stub at
 * each junction (`cross-streets.ts` §`mappedJunctions`) and the street beyond
 * it (`nearby-streets.ts`), both read from the corridor's street features
 * under rules written for a route ride. The two disagree, and where they do
 * the prompt offers a turn into a hedge (the owner's tablet ride of
 * 2026-11-23). Each of these is a way the graph offers and the streets' own
 * drawing leaves undrawn, at its mouth or for its whole length:
 *
 * - **a fork**: a street leaving at under `cross-streets.ts`
 *   §`JUNCTION_MIN_ANGLE_DEGREES` (30°) is no junction's arm, and a street
 *   that touches the route is drawn only from
 *   `nearby-streets.ts` §`NEARBY_STREET_HANDOVER_METRES` (23.5 m) off the
 *   road — 69 m along a street leaving at 20°;
 * - **a street mapped on a bridge or in a tunnel** from the junction: the
 *   graph rides it (ADR 0091 D-4: its ends are nodes where it comes back to
 *   grade), and neither file draws a street that is not at `ground`;
 * - a way too short to be an arm, an arm stopped by invented water, an arm
 *   past a frame's `cross-streets.ts` §`SIDE_ROADS_PER_FRAME`, a piece past
 *   `nearby-streets.ts` §`NEARBY_STREETS_PER_FRAME`.
 *
 * Rather than answer each rule with an exception, the frame is completed
 * from the source the prompt reads: for each way out the scene is handed
 * (`scene.ts` §`SceneInput.waysOut`, the view the rolling route would hand
 * out were the way taken), every stretch from its junction to the view's
 * reach that neither the road nor any side road of the frame covers is drawn
 * here. Where the streets' own drawing is whole this adds nothing: not a
 * triangle. ⚠️ That is a town of crossroads a fixture block (232 m) apart,
 * and not every town of crossroads: with a crossroads every 100 m or less
 * the streets in view pass `nearby-streets.ts` §`NEARBY_STREETS_PER_FRAME`,
 * and what that leaves out of a way is drawn here, 100–400 m from the rider
 * (the review of PR #3113 measured up to 15 way roads a frame at 100 m and
 * 35 at 60 m, and none with that cap lifted).
 *
 * ## What is drawn
 *
 * The way's own line, its position every {@link WAY_ROAD_STEP_METRES} along
 * its view (`@onyourleft/domain` §`positionAt`: the street's mapped line, as
 * the stub and the street beyond are drawn on, not the smoothed line a road
 * is ridden on). A station is covered when it lies on the road's surface or
 * within a drawn side road's half-width of its centreline. Each run of
 * stations not covered is a ribbon of a minor street's width
 * (`nearby-streets.ts` §`streetRibbon`, on the road's own drawn ground,
 * {@link routeGround}), run on one station into what is covered at each end
 * so no seam shows, and from the road's edge — {@link WAY_ROAD_MOUTH_METRES}
 * inside it — where the run starts at the road. Each is a
 * `cross-streets.ts` §`SideRoad`, so the side roads' one mesh draws it in the
 * road's material and one draw call, and the scenery, the billboards and the
 * people are kept off it as off any side road (`scene.ts`).
 *
 * ## Cost
 *
 * Worked out again only when the ways handed on, the side roads drawn, the
 * reach — counted in steps of {@link WAY_ROAD_REFRESH_METRES} — or how many
 * junctions the rider has passed change. Every other frame is handed the
 * same array, of the same objects. ⚠️ How often that is depends on the town:
 * every 40 m ridden or so where the junctions are a fixture block (232 m)
 * apart, as the streets in view are chosen, and every 10–15 m where they are
 * 40–100 m apart, since a junction's stub or a way comes into view or leaves
 * it that often — 28 workings-out in 300 m of `open-world/fixture-testing.ts`
 * §`OPEN_WORLD_DENSE_STREETS`, and the review of PR #3113 timed one at up to
 * 2.5–3.3 ms on a desktop. A working-out that changes the ribbons has the
 * side roads' one mesh merged again. Not measured on the tablet.
 *
 * At most {@link WAY_ROAD_STATIONS_PER_FRAME} stations a frame, every
 * station read counted whether or not anything is drawn there, two
 * triangles a station drawn.
 *
 * ## Which ways are read first
 *
 * A town of short blocks holds more way in view than the bound reads, so the
 * order decides what the rider sees ({@link readingOrder}):
 *
 * 1. the ways out of the road's own junctions ahead of the rider, the
 *    nearest junction first — **the next junction's, which the prompt is
 *    offering, before anything else**;
 * 2. the ways out of the junctions along those, ahead, nearest first;
 * 3. the ways out of junctions behind the rider, which the chase camera
 *    looks away from, the nearest first.
 *
 * ⚠️ Not "the nearest junction first" over all of them, as it was: a
 * junction up to 60 m behind and the junctions along ITS ways came before
 * the next junction's own, and with a crossroads every 40 m the offered way
 * went unread from 40 m short of its junction to 20 m short of it.
 *
 * ## A road turned off
 *
 * #3123, the owner's tablet ride of 2026-11-24: after a junction turn, the
 * road turned off stopped at the junction although it carries on. The frame
 * draws the road from `terrain.ts` §`VIEW_BEHIND_METRES` behind the rider;
 * the streets' own drawing keeps off the route, which the road back from the
 * junction still is, and off the way on past it until it reads the streets
 * again; and a way out is handed on only that far behind. So for each
 * junction the rider has passed where the route left the road it came along
 * (`scene.ts` §`SceneInput.turnedOff`), that road is read here both ways
 * from the junction to {@link TURNED_OFF_REACH_METRES}: on along the way the
 * route would have taken, and back along the road's own view
 * ({@link WayReached.turnedOff}). The road covers either only where the frame
 * draws it, counted from {@link WayRoadsRoad.drawnFromMetres} in whole
 * {@link WAY_ROAD_REFRESH_METRES}, so it is worked out again every 40 m and
 * not every frame; the road back runs on a station into where it is drawn.
 * They are read straight after the next junction's ways: as the rider turns,
 * the road turned off is what the camera swings across.
 *
 * ⚠️ **Location data** (ADR 0004 D): nothing here formats a message, and it
 * reads no name.
 *
 * Pure but for its cache, and names no rendering library.
 */

import { positionAt, type RouteProfile } from '@onyourleft/domain';

import { SIDE_ROAD_WIDTHS, type SideRoad } from './cross-streets';
import type { LandClassMask } from './land-class';
import {
  NEARBY_STREET_REFRESH_METRES,
  NEARBY_STREET_STEP_METRES,
  routeGround,
  streetRibbon,
} from './nearby-streets';
import { distanceToDrawnRoad, nearestOnDrawnRoad } from './road-grid';
import {
  localGroundPosition,
  ROAD_WIDTH_METRES,
  VIEW_AHEAD_METRES,
  type CorridorOrigin,
} from './terrain';

/** How far apart a way road's stations are, in metres: the nearby streets' **4**. */
export const WAY_ROAD_STEP_METRES = NEARBY_STREET_STEP_METRES;

/** The step a way's reach is counted in, in metres: the nearby streets' refresh, **40**. */
export const WAY_ROAD_REFRESH_METRES = NEARBY_STREET_REFRESH_METRES;

/**
 * The most stations a frame's way roads are read at: **1 024**, 4 km of ways
 * and at most 2 048 triangles were none of it drawn by anything else. Every
 * way out of the junctions in a 400 m view where they are a fixture block
 * apart; the ways out of the road's next five junctions where they are 40 m
 * apart, which is why the order matters ({@link readingOrder}).
 */
export const WAY_ROAD_STATIONS_PER_FRAME = 1_024;

/**
 * How far inside the road's edge a way road starts, in metres: **0.5**, so
 * its mouth and the road's surface overlap and no verge shows between them.
 */
export const WAY_ROAD_MOUTH_METRES = 0.5;

/**
 * How far a road turned off is drawn from its junction, each way, and how far
 * from the rider such a junction is handed on, in metres: **400**, the view's
 * reach ahead — #3123. Past that the road turned off is in the fog from
 * anywhere on the road.
 */
export const TURNED_OFF_REACH_METRES = VIEW_AHEAD_METRES;

/** Half the main carriageway, in metres: **3.5**. */
const ROAD_HALF_WIDTH_METRES = ROAD_WIDTH_METRES / 2;

/** Half a way road's width, in metres: a minor street's, **2.75**. */
const WAY_HALF_WIDTH_METRES = SIDE_ROAD_WIDTHS.minor / 2;

/** One way out, and how far along its own view this frame's view reaches. `scene.ts` §`ReachedWay`. */
export interface WayReached {
  readonly way: {
    /** The view the route would hand out were the way taken. */
    readonly profile: RouteProfile;
    /** The junction's distance on it. */
    readonly fromMetres: number;
  };
  readonly toMetres: number;
  /** What a distance on the way's view is short of the same ride distance on the road's. */
  readonly shift: number;
  /**
   * #3123: a stretch of a road the rider turned off at a junction they have
   * passed — the way the route would have taken, on past the junction, or
   * (`back`) the road itself from the junction back towards where the ride
   * came from, read from `fromMetres` DOWN to `toMetres`. The road covers
   * such a stretch only where the frame draws the road
   * ({@link WayRoadsRoad.drawnFromMetres}), since the road behind that is
   * the route still and drawn by nothing. @see the header's "A road turned off"
   */
  readonly turnedOff?:
    | {
        /** The junction's distance on the road's view. */
        readonly junctionMetres: number;
        readonly back: boolean;
      }
    | undefined;
}

/** The road the frame draws, the ground it draws beside it, and where the rider is on it. */
export interface WayRoadsRoad {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly seed: number;
  readonly land: LandClassMask;
  /** The rider's distance on {@link profile}: a junction short of it is behind them. */
  readonly riderMetres: number;
  /**
   * #3123: where on {@link profile} the frame's road starts (`terrain.ts`
   * §`roadCorridor`, `VIEW_BEHIND_METRES` behind the rider). Read
   * only for a {@link WayReached.turnedOff} stretch; absent is the whole road.
   */
  readonly drawnFromMetres?: number | undefined;
}

const NO_WAY_ROADS: readonly SideRoad[] = [];

/** A side road's box in plan, its half-widths included: found once a road. */
const boxes = new WeakMap<SideRoad, readonly [number, number, number, number]>();

function boxOf(road: SideRoad): readonly [number, number, number, number] {
  let box = boxes.get(road);
  if (box === undefined) {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    const s = road.segments;
    for (let at = 0; at + 3 < s.length; at += 4) {
      const half = road.halfWidths[at / 4] ?? 0;
      minX = Math.min(minX, (s[at] as number) - half, (s[at + 2] as number) - half);
      maxX = Math.max(maxX, (s[at] as number) + half, (s[at + 2] as number) + half);
      minZ = Math.min(minZ, (s[at + 1] as number) - half, (s[at + 3] as number) - half);
      maxZ = Math.max(maxZ, (s[at + 1] as number) + half, (s[at + 3] as number) + half);
    }
    box = [minX, maxX, minZ, maxZ];
    boxes.set(road, box);
  }
  return box;
}

/** Whether `(x, z)` lies within a segment's half-width of the centreline of one of `roads`. */
function onOneOf(roads: readonly SideRoad[], x: number, z: number): boolean {
  for (const road of roads) {
    const [minX, maxX, minZ, maxZ] = boxOf(road);
    if (x < minX || x > maxX || z < minZ || z > maxZ) continue;
    const s = road.segments;
    for (let at = 0; at + 3 < s.length; at += 4) {
      const half = road.halfWidths[at / 4] ?? 0;
      const ax = s[at] as number;
      const az = s[at + 1] as number;
      const dx = (s[at + 2] as number) - ax;
      const dz = (s[at + 3] as number) - az;
      const span = dx * dx + dz * dz;
      const t = span > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / span)) : 0;
      const ox = x - ax - t * dx;
      const oz = z - az - t * dz;
      if (ox * ox + oz * oz <= half * half) return true;
    }
  }
  return false;
}

/** What one frame's way roads were worked out from, and what they were. */
interface Held {
  readonly land: LandClassMask;
  readonly seed: number;
  /** How many ways' junctions were behind the rider, then each way's view, its junction on it, and its reach in whole refreshes. */
  readonly ways: readonly (RouteProfile | number)[];
  readonly drawn: readonly SideRoad[];
  readonly roads: readonly SideRoad[];
  /** Each ribbon by its way's view and the stretch it covers, so a stretch drawn again is the same object. */
  readonly ribbons: WeakMap<RouteProfile, Map<string, SideRoad>>;
}

/** The last frame's, by the road's view. */
const held = new WeakMap<RouteProfile, Held>();

/** The most ribbons kept for one way before they are let go and made again. */
const RIBBONS_KEPT_PER_WAY = 32;

/** How far ahead of the rider a way's junction is, in ride metres: negative behind them. */
function aheadOf(road: WayRoadsRoad, { way, shift }: WayReached): number {
  return way.fromMetres + shift - road.riderMetres;
}

/**
 * `ways` in the order they are read, so that what
 * {@link WAY_ROAD_STATIONS_PER_FRAME} leaves unread is what the rider sees
 * least — the header's "Which ways are read first". A way is out of the
 * road's own junction when its junction lies on the drawn road, and out of a
 * junction along another way otherwise.
 */
function readingOrder(ways: readonly WayReached[], road: WayRoadsRoad): WayReached[] {
  let next = Number.POSITIVE_INFINITY;
  const ranked = ways.map((each) => {
    const ahead = aheadOf(road, each);
    let rank = 2;
    if (each.turnedOff === undefined && ahead >= 0) {
      const { x, z } = localGroundPosition(
        road.origin,
        positionAt(each.way.profile, each.way.fromMetres),
      );
      rank = toRoad(road, x, z) <= ROAD_WIDTH_METRES ? 0 : 1;
      if (rank === 0) next = Math.min(next, ahead);
    }
    return { each, rank, near: Math.abs(ahead) };
  });
  // #3123: a road turned off straight after the next junction's ways, which
  // the prompt offers: as the rider turns, it is what the camera swings across.
  for (const each of ranked) {
    if (each.each.turnedOff !== undefined) {
      each.rank = 0;
      each.near = Number.isFinite(next) ? next + 0.5 : 0;
    }
  }
  ranked.sort((a, b) => a.rank - b.rank || a.near - b.near);
  return ranked.map(({ each }) => each);
}

/**
 * The way roads of a frame — #3106: for each of `ways`, every stretch from
 * its junction to its reach that neither `road`'s surface nor any of `drawn`
 * covers, as side roads. The same array, of the same objects, while the ways,
 * their reaches in whole {@link WAY_ROAD_REFRESH_METRES}, how many of their
 * junctions are behind the rider and `drawn` are the same. @see the header
 */
export function wayRoads(
  ways: readonly WayReached[],
  road: WayRoadsRoad,
  drawn: readonly SideRoad[],
): readonly SideRoad[] {
  if (ways.length === 0) return NO_WAY_ROADS;
  // A junction passed changes the order the ways are read in, and so what is drawn.
  let behind = 0;
  let turned = false;
  for (const each of ways) {
    if (aheadOf(road, each) < 0) behind += 1;
    if (each.turnedOff !== undefined) turned = true;
  }
  // #3123: where the frame's road starts, in whole refreshes, so a road
  // turned off is worked out again every 40 m ridden and not every frame. The
  // road is drawn from a little short of it, so what is counted as drawn is.
  const coverFrom =
    road.drawnFromMetres === undefined
      ? Number.NEGATIVE_INFINITY
      : Math.ceil(road.drawnFromMetres / WAY_ROAD_REFRESH_METRES) * WAY_ROAD_REFRESH_METRES;
  const key: (RouteProfile | number)[] = [behind, turned ? coverFrom : 0];
  for (const { way, toMetres, turnedOff } of ways) {
    key.push(
      way.profile,
      way.fromMetres,
      Math.ceil(toMetres / WAY_ROAD_REFRESH_METRES),
      turnedOff === undefined ? 0 : turnedOff.back ? 2 : 1,
    );
  }
  const last = held.get(road.profile);
  if (
    last !== undefined &&
    last.land === road.land &&
    last.seed === road.seed &&
    last.ways.length === key.length &&
    last.drawn.length === drawn.length &&
    key.every((each, index) => each === last.ways[index]) &&
    drawn.every((each, index) => each === last.drawn[index])
  ) {
    return last.roads;
  }
  const ribbons =
    last !== undefined && last.land === road.land && last.seed === road.seed
      ? last.ribbons
      : new WeakMap<RouteProfile, Map<string, SideRoad>>();
  const roads: SideRoad[] = [];
  let left = WAY_ROAD_STATIONS_PER_FRAME;
  for (const { way, toMetres, turnedOff } of readingOrder(ways, road)) {
    const total: number = way.profile.totalDistance;
    const back = turnedOff?.back === true;
    const to = back
      ? Math.max(0, toMetres)
      : Math.min(total, Math.ceil(toMetres / WAY_ROAD_REFRESH_METRES) * WAY_ROAD_REFRESH_METRES);
    const count = Math.min(
      left,
      Math.floor((back ? way.fromMetres - to : to - way.fromMetres) / WAY_ROAD_STEP_METRES) + 1,
    );
    if (!(count >= 2)) continue;
    left -= count;
    let byStretch = ribbons.get(way.profile);
    if (byStretch === undefined) {
      byStretch = new Map();
      ribbons.set(way.profile, byStretch);
    }
    const covering = turnedOff === undefined ? undefined : { ...turnedOff, from: coverFrom };
    for (const each of roadsOfWay(way, count, road, drawn, byStretch, covering)) {
      roads.push(each);
    }
  }
  const result = roads.length === 0 ? NO_WAY_ROADS : roads;
  // A copy of `drawn`: the caller's array may be one it writes again.
  held.set(road.profile, {
    land: road.land,
    seed: road.seed,
    ways: key,
    drawn: [...drawn],
    roads: result,
    ribbons,
  });
  return result;
}

/** How far `(x, z)` is from the drawn road's centreline, read no farther than matters here. */
function toRoad(road: WayRoadsRoad, x: number, z: number): number {
  return distanceToDrawnRoad(road.profile, road.origin, x, z, ROAD_WIDTH_METRES);
}

/**
 * One way's undrawn stretches, each as a side road. A road turned off
 * (`turned`, #3123) is read backwards when it is the road back from its
 * junction, and is covered by the road only where its place on the road —
 * the station's own for the road back, the junction's for the way on — is
 * at or past `turned.from`, where the frame draws the road. @see wayRoads
 */
function roadsOfWay(
  way: WayReached['way'],
  count: number,
  road: WayRoadsRoad,
  drawn: readonly SideRoad[],
  byStretch: Map<string, SideRoad>,
  turned:
    { readonly junctionMetres: number; readonly back: boolean; readonly from: number } | undefined,
): SideRoad[] {
  const step = turned?.back === true ? -WAY_ROAD_STEP_METRES : WAY_ROAD_STEP_METRES;
  const xs = new Float64Array(count);
  const zs = new Float64Array(count);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < count; index += 1) {
    const local = localGroundPosition(
      road.origin,
      positionAt(way.profile, way.fromMetres + index * step),
    );
    xs[index] = local.x;
    zs[index] = local.z;
    minX = Math.min(minX, local.x);
    maxX = Math.max(maxX, local.x);
    minZ = Math.min(minZ, local.z);
    maxZ = Math.max(maxZ, local.z);
  }
  // Only the side roads whose boxes reach the way's are measured, station by station.
  const beside = drawn.filter((each) => {
    const [left, right, low, high] = boxOf(each);
    return !(right < minX || left > maxX || high < minZ || low > maxZ);
  });
  /** 1 on the road's surface, 2 on a side road, 0 where nothing is drawn. */
  const covered = new Uint8Array(count);
  const onRoad = ROAD_HALF_WIDTH_METRES - WAY_ROAD_MOUTH_METRES;
  let any = false;
  for (let index = 0; index < count; index += 1) {
    const x = xs[index] as number;
    const z = zs[index] as number;
    // #3123: the road back from a junction turned off at IS the road, so it
    // is run on a station into where the frame draws it, as into a side road.
    const roadAt =
      turned === undefined
        ? undefined
        : turned.back
          ? way.fromMetres + index * step
          : turned.junctionMetres;
    if ((roadAt === undefined || roadAt >= (turned?.from ?? 0)) && toRoad(road, x, z) <= onRoad) {
      covered[index] = turned?.back === true ? 2 : 1;
    } else if (onOneOf(beside, x, z)) covered[index] = 2;
    else any = true;
  }
  if (!any) return [];
  const out: SideRoad[] = [];
  let start = 0;
  while (start < count) {
    if (covered[start] !== 0) {
      start += 1;
      continue;
    }
    let end = start;
    while (end + 1 < count && covered[end + 1] === 0) end += 1;
    // What the ribbon is made of: its stations, what it starts from, and whether it runs on a station.
    // A road turned off is read from its junction, and the road back from
    // two junctions on the one view is two stretches of it.
    const stretch = `${turned === undefined ? '' : `${String(way.fromMetres)}:${String(step)}:`}${String(start)}:${String(end)}:${String(covered[start - 1] ?? 0)}:${
      end + 1 < count ? '1' : '0'
    }`;
    let ribbon = byStretch.get(stretch);
    if (ribbon === undefined) {
      const line: number[] = [];
      if (start > 0) {
        const px = xs[start - 1] as number;
        const pz = zs[start - 1] as number;
        if (covered[start - 1] === 1) {
          // From the road's edge: halved in towards where the surface ends.
          let on = 0;
          let off = 1;
          for (let step = 0; step < 8; step += 1) {
            const middle = (on + off) / 2;
            const x = px + ((xs[start] as number) - px) * middle;
            const z = pz + ((zs[start] as number) - pz) * middle;
            if (toRoad(road, x, z) <= onRoad) on = middle;
            else off = middle;
          }
          line.push(px + ((xs[start] as number) - px) * on, pz + ((zs[start] as number) - pz) * on);
        } else {
          line.push(px, pz);
        }
      }
      for (let index = start; index <= end; index += 1) {
        line.push(xs[index] as number, zs[index] as number);
      }
      if (end + 1 < count) line.push(xs[end + 1] as number, zs[end + 1] as number);
      ribbon = ribbonOf(line, road);
      if (byStretch.size >= RIBBONS_KEPT_PER_WAY) byStretch.clear();
      byStretch.set(stretch, ribbon);
    }
    if (ribbon.mesh.indices.length > 0) out.push(ribbon);
    start = end + 1;
  }
  return out;
}

/** How far the first search for the road beside a ribbon reaches, doubled until it finds it. */
const FIRST_REACH_METRES = 32;

/** No farther than this is the road looked for: past the last column of drawn ground. */
const LAST_REACH_METRES = 1_024;

/** `line` (`x0, z0, x1, z1, …`) as road surface on `road`'s drawn ground. */
function ribbonOf(line: readonly number[], road: WayRoadsRoad): SideRoad {
  const ribbon = streetRibbon(
    Float32Array.from(line),
    WAY_HALF_WIDTH_METRES,
    routeGround(road.profile, road.origin, road.seed, road.land),
  );
  let along = 0;
  for (let reach = FIRST_REACH_METRES; reach <= LAST_REACH_METRES; reach *= 2) {
    const near = nearestOnDrawnRoad(
      road.profile,
      road.origin,
      line[0] as number,
      line[1] as number,
      reach,
    );
    if (near !== undefined) {
      along = near.along;
      break;
    }
  }
  return {
    // No junction of its own, as a nearby street has none: `along` is where it is beside.
    junction: { along, source: 'street', arms: [] },
    mesh: ribbon.mesh,
    segments: ribbon.segments,
    halfWidths: ribbon.halfWidths,
  };
}
