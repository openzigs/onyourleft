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
 * here. Where the streets' own drawing is whole — a town of crossroads —
 * this adds nothing: not a triangle.
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
 * Worked out again only when the ways handed on, the side roads drawn or the
 * reach — counted in steps of {@link WAY_ROAD_REFRESH_METRES} — change: about
 * once every 40 m ridden, as the streets in view are chosen. Every other
 * frame is handed the same array, of the same objects. At most
 * {@link WAY_ROAD_STATIONS_PER_FRAME} stations a frame, the ways whose
 * junctions are nearest first, two triangles a station.
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
import { localGroundPosition, ROAD_WIDTH_METRES, type CorridorOrigin } from './terrain';

/** How far apart a way road's stations are, in metres: the nearby streets' **4**. */
export const WAY_ROAD_STEP_METRES = NEARBY_STREET_STEP_METRES;

/** The step a way's reach is counted in, in metres: the nearby streets' refresh, **40**. */
export const WAY_ROAD_REFRESH_METRES = NEARBY_STREET_REFRESH_METRES;

/**
 * The most stations a frame's way roads are read at: **1 024**, 4 km of ways
 * — every way out of a town's junctions in a 400 m view — and at most 2 048
 * triangles were none of it drawn by anything else.
 */
export const WAY_ROAD_STATIONS_PER_FRAME = 1_024;

/**
 * How far inside the road's edge a way road starts, in metres: **0.5**, so
 * its mouth and the road's surface overlap and no verge shows between them.
 */
export const WAY_ROAD_MOUTH_METRES = 0.5;

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
}

/** The road the frame draws, and the ground it draws beside it. */
export interface WayRoadsRoad {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  readonly seed: number;
  readonly land: LandClassMask;
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
  /** Each way's view, its junction on it, and its reach in whole refreshes. */
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

/**
 * The way roads of a frame — #3106: for each of `ways`, every stretch from
 * its junction to its reach that neither `road`'s surface nor any of `drawn`
 * covers, as side roads. The same array, of the same objects, while the ways,
 * their reaches in whole {@link WAY_ROAD_REFRESH_METRES} and `drawn` are the
 * same. @see the header
 */
export function wayRoads(
  ways: readonly WayReached[],
  road: WayRoadsRoad,
  drawn: readonly SideRoad[],
): readonly SideRoad[] {
  if (ways.length === 0) return NO_WAY_ROADS;
  const key: (RouteProfile | number)[] = [];
  for (const { way, toMetres } of ways) {
    key.push(way.profile, way.fromMetres, Math.ceil(toMetres / WAY_ROAD_REFRESH_METRES));
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
  // The ways whose junctions are nearest first: the most of its view left.
  const nearestFirst = [...ways].sort(
    (a, b) => b.toMetres - b.way.fromMetres - (a.toMetres - a.way.fromMetres),
  );
  const roads: SideRoad[] = [];
  let left = WAY_ROAD_STATIONS_PER_FRAME;
  for (const { way, toMetres } of nearestFirst) {
    const total: number = way.profile.totalDistance;
    const to = Math.min(
      total,
      Math.ceil(toMetres / WAY_ROAD_REFRESH_METRES) * WAY_ROAD_REFRESH_METRES,
    );
    const count = Math.min(left, Math.floor((to - way.fromMetres) / WAY_ROAD_STEP_METRES) + 1);
    if (!(count >= 2)) continue;
    left -= count;
    let byStretch = ribbons.get(way.profile);
    if (byStretch === undefined) {
      byStretch = new Map();
      ribbons.set(way.profile, byStretch);
    }
    for (const each of roadsOfWay(way, count, road, drawn, byStretch)) roads.push(each);
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

/** One way's undrawn stretches, each as a side road. @see wayRoads */
function roadsOfWay(
  way: WayReached['way'],
  count: number,
  road: WayRoadsRoad,
  drawn: readonly SideRoad[],
  byStretch: Map<string, SideRoad>,
): SideRoad[] {
  const xs = new Float64Array(count);
  const zs = new Float64Array(count);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < count; index += 1) {
    const local = localGroundPosition(
      road.origin,
      positionAt(way.profile, way.fromMetres + index * WAY_ROAD_STEP_METRES),
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
    if (toRoad(road, x, z) <= onRoad) covered[index] = 1;
    else if (onOneOf(beside, x, z)) covered[index] = 2;
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
    const stretch = `${String(start)}:${String(end)}:${String(covered[start - 1] ?? 0)}:${
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
