// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Overpasses and underpasses — #2661: where a mapped street crosses the route
 * on a bridge or in a tunnel, the grade separation is drawn.
 *
 * `cross-streets.ts` §`meetsAtGrade` rightly leaves such a street out of the
 * junctions, but until #2661 nothing else drew it: the rider passed under an
 * invisible overpass (the 2026-11-15 tag audit's Chicago case, Halsted St
 * under I-290).
 *
 * ## Where a crossing is
 *
 * {@link mappedGradeCrossings}: from #1539's corridor, every street whose
 * `grade` (`StreetFeature.grade`, the tile's `is_bridge` and `is_tunnel`) is
 * not `'ground'`, resampled as the junctions' streets are
 * (`cross-streets.ts` §`resampled`). A crossing is where two of its points
 * next to each other lie within `cross-streets.ts`
 * §`JUNCTION_TOLERANCE_METRES` of the same stretch of the drawn road on
 * OPPOSITE sides of it: the street passes from one side to the other. A
 * street that runs along the route — within `cross-streets.ts`
 * §`JUNCTION_MIN_ANGLE_DEGREES` of its heading, either way — crosses
 * nothing. A `highway` crosses as any other street does: a motorway bridge is
 * the case the audit found.
 *
 * - **A bridge** is the street passing OVER the route: an overpass.
 * - **A tunnel** is the street passing UNDER it, so the route is on a bridge
 *   of its own there. ⚠️ **Only where that is visible**: a tunnel way longer
 *   than {@link UNDERPASS_MAX_METRES} is a bored tunnel deep under the ground,
 *   which a rider above it cannot see, and is not one.
 *
 * Crossings within {@link CROSSING_MERGE_METRES} of each other along the route,
 * of one grade, are one — a way split where it crosses, or traced twice — so
 * that two blocks never stand in the same place.
 *
 * ## What is drawn
 *
 * Boxes, as #459's stream bridges are (`waterways.ts` §`BridgePart`), handed
 * to the frame's bridges (`scene.ts` §`water`) and drawn by
 * `three-renderer.ts` §`BridgeBelt`. ⚠️ **Since #2699 an overpass's boxes are
 * not in the stone**: the belt draws them in a second instanced box of its
 * own, in the colour each box's `finish` names, so a frame with an overpass
 * makes one draw call more than it did. Nothing here adds a structure, and
 * the frame's bridges are still cut to `waterways.ts` §`MAXIMUM_BRIDGE_PARTS`
 * boxes, twelve triangles each, whichever of the belt's two draws them.
 *
 * - **An overpass**: a level deck slab along the
 *   street, long enough to cover both abutments however skew it crosses; an
 *   edge beam along each side of the deck, which rises above it as the
 *   parapet; and an abutment each side of the road, parallel to it and
 *   {@link OVERPASS_SETBACK_METRES} off its edge, from under the ground up to
 *   the deck. The edge beams' feet are the lowest of it, at
 *   {@link OVERPASS_CLEARANCE_METRES} above the highest of the road it spans.
 *   ⚠️ **Nothing of it stands in the carriageway below the clearance**:
 *   `overpasses.test.ts` holds every block's corners clear of the road's
 *   width up to that height.
 *
 *   **Why edge beams — #2699.** #2687's screenshots showed #2661's overpass as
 *   a flat brown slab: a deck and its parapets flush, in the stream bridges'
 *   stone, read from below as one block. So the deck now wears the road's own
 *   colour, being a road (`finish: 'road'`), and the beams, the parapets and
 *   the abutments a concrete grey (`'concrete'`), drawn apart from the stone
 *   (`three-renderer.ts` §`BridgeBelt`). Each beam stands
 *   {@link OVERPASS_EDGE_PROUD_METRES} proud of the deck's side and hangs
 *   {@link OVERPASS_EDGE_DROP_METRES} below its underside, so a rider under it
 *   sees a light edge either side of a dark deck — and that it is still five
 *   boxes, as #2661 drew, is what keeps the frame's share of the belt.
 * - **An underpass**: a parapet with its coping along each edge of the road
 *   over the street's width and {@link UNDERPASS_MARGIN_METRES} either side,
 *   in pieces that follow the road's height — the stream bridge's own
 *   parapets (`waterways.ts` §`bridgeParts`). The ground under the road is not
 *   cut: the street below is no more seen than it was.
 *
 * ⚠️ **The deck is at the route's height, not the street's.** A street's
 * height is not in the tile, so a route in a cutting still has the deck five
 * metres over it, its abutments rising from the ground beside the road. The
 * route's own grade is never read or changed: nothing here touches
 * a profile, and what a trainer is sent at an overpass is the route's.
 *
 * ⚠️ **Location data** (ADR 0004 D): nothing here formats a message. It reads
 * a street's `kind`, `kindDetail`, `grade` and line, and never a name.
 *
 * Pure, built once a corridor and once a crossing, and names no rendering
 * library.
 */

import { distanceOnRoute, elevationAt, type RouteProfile } from '@onyourleft/domain';

import {
  JUNCTION_MIN_ANGLE_DEGREES,
  JUNCTION_TOLERANCE_METRES,
  resampled,
  SIDE_ROAD_WIDTHS,
  STREET_MAX_METRES,
  widthClassOf,
  type WidthClass,
} from './cross-streets';
import type { LandClassMask } from './land-class';
import { terrainHeightAt } from './landform';
import { nearestOnDrawnRoad, type NearestOnRoad } from './road-grid';
import { drawnRoadFrame, ROAD_WIDTH_METRES, type CorridorOrigin } from './terrain';
import {
  BRIDGE_PIECE_METRES,
  COPING_DEPTH_METRES,
  COPING_OVERHANG_METRES,
  PARAPET_HEIGHT_METRES,
  PARAPET_THICKNESS_METRES,
  type BridgeFinish,
  type BridgePart,
} from './waterways';
import type { WorldCorridor } from './world-data/corridor';

/** Half the main carriageway, in metres: **3.5**. */
const ROAD_HALF_WIDTH_METRES = ROAD_WIDTH_METRES / 2;

/**
 * How far the underside of an overpass's deck stands above the road it spans,
 * in metres: **5** — about the 16 ft a US interstate bridge leaves, and the
 * 16 ft 6 in a British one does.
 */
export const OVERPASS_CLEARANCE_METRES = 5;

/**
 * How deep an overpass is from its edge beams' feet to its deck's top, in
 * metres: **1.2**. The deck slab is this less {@link OVERPASS_EDGE_DROP_METRES}.
 */
export const OVERPASS_DECK_DEPTH_METRES = 1.2;

/**
 * How far an overpass's edge beam hangs below its deck slab's underside, in
 * metres: **0.25** — #2699. A lip a rider under the bridge sees each side.
 */
export const OVERPASS_EDGE_DROP_METRES = 0.25;

/**
 * How far an overpass's edge beam stands proud of its deck slab's side, in
 * metres: **0.15** — #2699. Outward only: its inner face is over the deck.
 */
export const OVERPASS_EDGE_PROUD_METRES = 0.15;

/**
 * How far each edge beam's end reaches past the deck's. The two overlap where
 * the beam hangs below and stands above the deck's edge, and ends in the same
 * plane would draw as two colours fighting for it.
 */
export const OVERPASS_BEAM_OVERHANG_METRES = 0.02;

/** How far off the road's edge an overpass's abutment's face stands, in metres: **3**. */
export const OVERPASS_SETBACK_METRES = 3;

/** How thick an overpass's abutment is, across the road, in metres: **1**. */
export const ABUTMENT_THICKNESS_METRES = 1;

/** How far below the ground an abutment's foot reaches, in metres: **0.3**. */
const ABUTMENT_FOOT_METRES = 0.3;

/**
 * The longest tunnel way that is an underpass, in metres: **80**. Longer is a
 * bored tunnel deep under the ground, which nothing on the route can see.
 */
export const UNDERPASS_MAX_METRES = 80;

/** How far past the street's edges an underpass's parapets run, along the road, in metres: **2**. */
export const UNDERPASS_MARGIN_METRES = 2;

/** Crossings of one grade within this many metres along the route are one: **3**. */
export const CROSSING_MERGE_METRES = 3;

/**
 * The most crossings one route keeps: **1 000**, in route order. A street
 * network is an imported file's; past this the route has no more of them
 * rather than an unbounded list, as `cross-streets.ts` §`MAX_JUNCTIONS`.
 */
export const MAX_GRADE_CROSSINGS = 1_000;

/**
 * The most boxes a frame's overpasses and underpasses may add: **48**,
 * nearest the rider first — nine overpasses of five boxes, or two of the widest, most
 * skew underpasses. Inside `waterways.ts` §`MAXIMUM_BRIDGE_PARTS`, which the
 * frame's bridges are cut to with the streams' first.
 */
export const OVERPASS_FRAME_PARTS = 48;

/** How far past the frame's corridor a crossing is still drawn, in metres: **40**. */
const IN_VIEW_REACH_METRES = 40;

/** How far either side of a crossing its heading is read, in metres: **8**. */
const HEADING_METRES = 8;

/** Where a mapped street crosses the route over or under it. */
export interface GradeCrossing {
  /** The route distance of the crossing, on the first lap. */
  readonly along: number;
  /** `'bridge'`: the street passes over the route. `'tunnel'`: under it. */
  readonly grade: 'bridge' | 'tunnel';
  readonly widthClass: WidthClass;
  /** Where its centreline crosses the drawn road's, local metres. */
  readonly x: number;
  readonly z: number;
  /** Its heading there in plan, a unit vector towards the road's right (its normal). */
  readonly dx: number;
  readonly dz: number;
}

/** The road's frame at `along`: where, and its forward and normal directions. */
function roadAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  along: number,
): { x: number; z: number; forwardX: number; forwardZ: number; normalX: number; normalZ: number } {
  const frame = drawnRoadFrame(profile, origin, along);
  if (frame === undefined) {
    return { x: 0, z: 0, forwardX: 0, forwardZ: 1, normalX: -1, normalZ: 0 };
  }
  // The heading is the normal turned back a quarter (`terrain.ts` §`drawnRoadFrame`).
  return {
    x: frame.x,
    z: frame.z,
    forwardX: frame.normalZ,
    forwardZ: -frame.normalX,
    normalX: frame.normalX,
    normalZ: frame.normalZ,
  };
}

/** The road's height at odometer `along`, local metres. */
function roadHeight(profile: RouteProfile, origin: CorridorOrigin, along: number): number {
  return elevationAt(profile, distanceOnRoute(profile, along)) - origin.elevation;
}

function metresOf(line: Float32Array): number {
  let total = 0;
  for (let at = 0; at + 3 < line.length; at += 2) {
    total += Math.hypot(
      (line[at + 2] as number) - (line[at] as number),
      (line[at + 3] as number) - (line[at + 1] as number),
    );
  }
  return total;
}

/** One corridor's crossings, kept with the profile they were found against. */
const crossingsFound = new WeakMap<
  WorldCorridor,
  { profile: RouteProfile; crossings: readonly GradeCrossing[] }
>();

/**
 * Every place a mapped street crosses the route on a bridge or in a tunnel,
 * in route order — #2661. Built once per corridor, the same array after.
 * @see the header
 */
export function mappedGradeCrossings(
  corridor: WorldCorridor,
  profile: RouteProfile,
  origin: CorridorOrigin,
): readonly GradeCrossing[] {
  const cached = crossingsFound.get(corridor);
  if (cached?.profile === profile) return cached.crossings;
  const found: GradeCrossing[] = [];
  const budget = { metres: STREET_MAX_METRES };
  const steepest = Math.cos((JUNCTION_MIN_ANGLE_DEGREES * Math.PI) / 180);
  for (const street of corridor.streets) {
    if (street.grade === 'ground') continue;
    if (street.grade === 'tunnel' && metresOf(street.line) > UNDERPASS_MAX_METRES) continue;
    const points = resampled(street.line, budget);
    const count = points.length / 2;
    const near: (NearestOnRoad | undefined)[] = [];
    for (let index = 0; index < count; index += 1) {
      const x = points[index * 2] as number;
      const z = points[index * 2 + 1] as number;
      near.push(
        corridor.covered(x, z)
          ? nearestOnDrawnRoad(profile, origin, x, z, JUNCTION_TOLERANCE_METRES)
          : undefined,
      );
    }
    for (let index = 0; index + 1 < count; index += 1) {
      const a = near[index];
      const b = near[index + 1];
      if (a === undefined || b === undefined) continue;
      // From one side to the other, of one stretch of the road.
      if (!(a.lateral * b.lateral < 0 || (a.lateral === 0 && b.lateral !== 0))) continue;
      if (Math.abs(a.along - b.along) > JUNCTION_TOLERANCE_METRES * 2) continue;
      const t = a.lateral / (a.lateral - b.lateral);
      const ax = points[index * 2] as number;
      const az = points[index * 2 + 1] as number;
      const x = ax + ((points[index * 2 + 2] as number) - ax) * t;
      const z = az + ((points[index * 2 + 3] as number) - az) * t;
      const along = a.along + (b.along - a.along) * t;
      // Its heading, over a few metres either side.
      const reach = Math.ceil(HEADING_METRES / 2);
      const from = Math.max(0, index - reach + 1);
      const to = Math.min(count - 1, index + reach);
      let dx = (points[to * 2] as number) - (points[from * 2] as number);
      let dz = (points[to * 2 + 1] as number) - (points[from * 2 + 1] as number);
      const length = Math.hypot(dx, dz);
      if (!(length > 0)) continue;
      dx /= length;
      dz /= length;
      const road = roadAt(profile, origin, along);
      if (Math.abs(dx * road.forwardX + dz * road.forwardZ) > steepest) continue;
      if (dx * road.normalX + dz * road.normalZ < 0) {
        dx = -dx;
        dz = -dz;
      }
      found.push({
        along,
        grade: street.grade,
        widthClass: widthClassOf(street),
        x,
        z,
        dx,
        dz,
      });
    }
  }
  found.sort((p, q) => p.along - q.along);
  const crossings: GradeCrossing[] = [];
  for (const crossing of found) {
    if (crossings.length >= MAX_GRADE_CROSSINGS) break;
    const twin = crossings.some(
      (kept) =>
        kept.grade === crossing.grade &&
        Math.abs(kept.along - crossing.along) < CROSSING_MERGE_METRES,
    );
    if (!twin) crossings.push(crossing);
  }
  crossingsFound.set(corridor, { profile, crossings });
  return crossings;
}

/** A box `length` along `(axisX, 0, axisZ)`, level, in an overpass's `finish`. */
function levelBox(
  x: number,
  y: number,
  z: number,
  axisX: number,
  axisZ: number,
  length: number,
  width: number,
  height: number,
  finish: BridgeFinish,
): BridgePart {
  return { x, y, z, axisX, axisY: 0, axisZ, length, width, height, finish };
}

/** An overpass's boxes. @see the header */
function overpassBoxes(
  crossing: GradeCrossing,
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  land: LandClassMask,
): BridgePart[] {
  const road = roadAt(profile, origin, crossing.along);
  const sine = crossing.dx * road.normalX + crossing.dz * road.normalZ;
  const cosine = crossing.dx * road.forwardX + crossing.dz * road.forwardZ;
  const deckWidth = SIDE_ROAD_WIDTHS[crossing.widthClass] + PARAPET_THICKNESS_METRES * 2;
  // The deck with its edge beams proud of it: what the span and the abutments cover.
  const overallWidth = deckWidth + OVERPASS_EDGE_PROUD_METRES * 2;
  const outer = ROAD_HALF_WIDTH_METRES + OVERPASS_SETBACK_METRES + ABUTMENT_THICKNESS_METRES;
  // Along the road, how far either way the deck's footprint reaches past the crossing.
  const skew = (outer * Math.abs(cosine)) / sine + overallWidth / 2 / sine;
  // Level, over the highest of the road it spans.
  let road0 = roadHeight(profile, origin, crossing.along);
  for (const end of [-1, 1]) {
    road0 = Math.max(road0, roadHeight(profile, origin, crossing.along + end * skew));
  }
  // The edge beams' feet: the lowest of the overpass.
  const clearance = road0 + OVERPASS_CLEARANCE_METRES;
  const underside = clearance + OVERPASS_EDGE_DROP_METRES;
  const deckTop = clearance + OVERPASS_DECK_DEPTH_METRES;
  // Along the street, long enough to cover both abutments however skew it crosses.
  const span = 2 * (outer / sine + ((overallWidth / 2) * Math.abs(cosine)) / sine);
  const parts: BridgePart[] = [
    levelBox(
      crossing.x,
      (underside + deckTop) / 2,
      crossing.z,
      crossing.dx,
      crossing.dz,
      span,
      deckWidth,
      deckTop - underside,
      'road',
    ),
  ];
  // An edge beam along each side of the deck: proud of it, under it, and the parapet above it.
  const acrossX = crossing.dz;
  const acrossZ = -crossing.dx;
  const beamTop = deckTop + PARAPET_HEIGHT_METRES;
  for (const side of [-1, 1]) {
    const out =
      (deckWidth / 2 - PARAPET_THICKNESS_METRES / 2 + OVERPASS_EDGE_PROUD_METRES / 2) * side;
    parts.push(
      levelBox(
        crossing.x + acrossX * out,
        (clearance + beamTop) / 2,
        crossing.z + acrossZ * out,
        crossing.dx,
        crossing.dz,
        span + OVERPASS_BEAM_OVERHANG_METRES * 2,
        PARAPET_THICKNESS_METRES + OVERPASS_EDGE_PROUD_METRES,
        beamTop - clearance,
        'concrete',
      ),
    );
  }
  // An abutment each side, parallel to the road, from under the ground to the deck.
  for (const side of [-1, 1]) {
    const lateral = side * (outer - ABUTMENT_THICKNESS_METRES / 2);
    const along = crossing.along + (lateral * cosine) / sine;
    const here = roadAt(profile, origin, along);
    const length = overallWidth / sine;
    const grounds = [-0.5, 0, 0.5].map((end) =>
      terrainHeightAt(
        profile,
        origin,
        seed,
        distanceOnRoute(profile, along + end * length),
        lateral,
        land,
      ),
    );
    const foot = Math.min(...grounds) - ABUTMENT_FOOT_METRES;
    parts.push(
      levelBox(
        here.x + here.normalX * lateral,
        (underside + foot) / 2,
        here.z + here.normalZ * lateral,
        here.forwardX,
        here.forwardZ,
        length,
        ABUTMENT_THICKNESS_METRES,
        underside - foot,
        'concrete',
      ),
    );
  }
  return parts;
}

/** An underpass's boxes: the stream bridge's parapets and copings, over the street. @see the header */
function underpassBoxes(
  crossing: GradeCrossing,
  profile: RouteProfile,
  origin: CorridorOrigin,
): BridgePart[] {
  const road = roadAt(profile, origin, crossing.along);
  const sine = crossing.dx * road.normalX + crossing.dz * road.normalZ;
  const half = SIDE_ROAD_WIDTHS[crossing.widthClass] / 2 / sine + UNDERPASS_MARGIN_METRES;
  const pieces = Math.ceil((half * 2) / BRIDGE_PIECE_METRES);
  const step = (half * 2) / pieces;
  const parts: BridgePart[] = [];
  const at = (along: number): { x: number; y: number; z: number } => {
    const frame = roadAt(profile, origin, along);
    return { x: frame.x, y: roadHeight(profile, origin, along), z: frame.z };
  };
  for (let piece = 0; piece < pieces; piece += 1) {
    const from = at(crossing.along - half + piece * step);
    const to = at(crossing.along - half + (piece + 1) * step);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dy, dz);
    const flat = Math.hypot(dx, dz);
    if (!(flat > 0)) continue;
    const nx = -dz / flat;
    const nz = dx / flat;
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, z: (from.z + to.z) / 2 };
    for (const side of [1, -1]) {
      const out = ROAD_HALF_WIDTH_METRES + PARAPET_THICKNESS_METRES / 2;
      parts.push({
        x: mid.x + nx * out * side,
        y: mid.y + PARAPET_HEIGHT_METRES / 2 - 0.05,
        z: mid.z + nz * out * side,
        axisX: dx / length,
        axisY: dy / length,
        axisZ: dz / length,
        length,
        width: PARAPET_THICKNESS_METRES,
        height: PARAPET_HEIGHT_METRES + 0.1,
      });
      const coping = out + COPING_OVERHANG_METRES / 2;
      parts.push({
        x: mid.x + nx * coping * side,
        y: mid.y + PARAPET_HEIGHT_METRES - COPING_DEPTH_METRES / 2,
        z: mid.z + nz * coping * side,
        axisX: dx / length,
        axisY: dy / length,
        axisZ: dz / length,
        length,
        width: PARAPET_THICKNESS_METRES + COPING_OVERHANG_METRES,
        height: COPING_DEPTH_METRES,
      });
    }
  }
  return parts;
}

/**
 * Every crossing's boxes, built on first sight — per land-class mask, since
 * #1547 levels the ground an abutment stands on under mapped built-up land.
 */
const built = new WeakMap<LandClassMask, WeakMap<GradeCrossing, readonly BridgePart[]>>();

/**
 * One crossing's boxes, built once per land-class mask: an overpass's deck,
 * parapets and abutments, or an underpass's parapets. @see the header
 */
function overpassPartsOf(
  crossing: GradeCrossing,
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  land: LandClassMask,
): readonly BridgePart[] {
  let byCrossing = built.get(land);
  if (byCrossing === undefined) {
    byCrossing = new WeakMap();
    built.set(land, byCrossing);
  }
  const known = byCrossing.get(crossing);
  if (known !== undefined) return known;
  const parts =
    crossing.grade === 'bridge'
      ? overpassBoxes(crossing, profile, origin, seed, land)
      : underpassBoxes(crossing, profile, origin);
  byCrossing.set(crossing, parts);
  return parts;
}

/**
 * The boxes of every crossing within the odometer span
 * `[fromMetres, toMetres)`, widened a little — nearest `riderMetres` first,
 * each crossing once however many laps the span covers, whole crossings only,
 * and no more than {@link OVERPASS_FRAME_PARTS}.
 */
export function overpassesAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  fromMetres: number,
  toMetres: number,
  riderMetres: number,
  crossings: readonly GradeCrossing[],
  land: LandClassMask,
): readonly BridgePart[] {
  if (crossings.length === 0) return [];
  const from = fromMetres - IN_VIEW_REACH_METRES;
  const to = toMetres + IN_VIEW_REACH_METRES;
  const total: number = profile.totalDistance;
  const firstLap = profile.loop && total > 0 ? Math.floor(from / total) : 0;
  const lastLap = profile.loop && total > 0 ? Math.floor(to / total) : 0;
  const found: { crossing: GradeCrossing; gap: number }[] = [];
  for (const crossing of crossings) {
    for (let lap = firstLap; lap <= lastLap; lap += 1) {
      const at = crossing.along + lap * total;
      if (at >= from && at < to) {
        found.push({ crossing, gap: Math.abs(at - riderMetres) });
        break;
      }
    }
  }
  found.sort((a, b) => a.gap - b.gap);
  const parts: BridgePart[] = [];
  for (const { crossing } of found) {
    const boxes = overpassPartsOf(crossing, profile, origin, seed, land);
    if (parts.length + boxes.length > OVERPASS_FRAME_PARTS) break;
    parts.push(...boxes);
  }
  return parts;
}
