// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The mapped bridges and tunnels an open-world ride is on** — #3105.
 *
 * The street graph has always known a bridge from the street beneath it
 * (`packages/map-features` §`street-graph.ts`: a bridge's inner vertices snap
 * to nothing), so the route cannot turn off one. The drawing did not: the
 * ridden road over a mapped bridge was the road on the ground, and a side
 * street's bridge was not drawn at all (`nearby-streets.ts` left every bridge
 * to `overpasses.ts`, which draws the ones that cross the route). The owner
 * crossed a real river on a long bridge on 2026-11-23 and saw flat road over
 * grass.
 *
 * Three things, all in `three-renderer.ts` §`BridgeBelt`'s boxes, so no new
 * mesh and no draw call of their own:
 *
 * - **The ridden road's bridge** ({@link riddenSpans}, {@link riddenSpanParts}):
 *   the stretches of the view that lie along a street the map grades `bridge`
 *   carry the stream bridges' own parapets and copings (`waterways.ts`
 *   §`deckPieces`, #459) for the whole mapped span. Where the span is over
 *   real water, `waterways.ts` §`waterUnderRoad` has already made it a
 *   crossing at the water's width, with its slab, abutments and approaches,
 *   and the channel cut under it; this file adds the parapets over the rest.
 * - **The ridden road's tunnel**: a portal at each mouth of a stretch the map
 *   grades `tunnel` — two jambs and a lintel in the overpasses' concrete.
 *   ⚠️ No hill is drawn over it: an open-world ride is flat until #2899, and
 *   `waterways.ts` says why a tunnel's ground cannot be invented.
 * - **A side street's bridge** ({@link sideDeckParts}): `nearby-streets.ts`
 *   draws its road as a deck at the road's level, and this stands a parapet
 *   along each edge of it.
 *
 * ⚠️ **The deck is the road, at the road's level** (the issue's "flat until
 * #2899"): nothing here reads or writes a profile, so the grade a trainer is
 * sent on a bridge is the route's own, as `waterways.ts` holds for a stream's.
 *
 * ## How a span is found
 *
 * By geometry, from `WorldCorridor.streets`, never from the graph: the view
 * is a profile and carries no street ids, and the scene is handed the
 * corridor already. The drawn road is stepped every
 * {@link SPAN_SAMPLE_METRES}; a step is on a bridge (or in a tunnel) when a
 * segment of a street so graded passes within {@link SPAN_TOLERANCE_METRES}
 * of it, running within {@link SPAN_PARALLEL_COSINE} of the road's own
 * direction. The direction test is what keeps an overpass that crosses the
 * road from being read as the road's own bridge. Cached per corridor and
 * view, as `nearby-streets.ts` §`nearbyStreets` is.
 *
 * ⚠️ **Only on an open-world view** (`scene.ts` asks only where the profile is
 * anchored): a route ride's road over a mapped bridge is drawn as it was.
 *
 * Pure, and names no rendering library.
 */

import { elevationAt, type RouteProfile } from '@onyourleft/domain';
import type { StreetGrade } from '@onyourleft/map-features';

import type { SideRoad } from './cross-streets';
import {
  ROAD_WIDTH_METRES,
  drawnRoadFrame,
  type CorridorOrigin,
  type CorridorPoint,
  type RoadCorridor,
} from './terrain';
import {
  BRIDGE_HALF_SPAN_METRES,
  PARAPET_HEIGHT_METRES,
  PARAPET_THICKNESS_METRES,
  crossingWiden,
  deckPieces,
  type BridgePart,
  type Waterways,
} from './waterways';
import type { WorldCorridor } from './world-data/corridor';

/** The step the drawn road is tested at, in metres: **5**. */
export const SPAN_SAMPLE_METRES = 5;

/** The most steps of the drawn road one view is tested at, whatever its length. */
export const SPAN_SAMPLE_LIMIT = 4_096;

/**
 * How near the drawn road a graded street's segment must pass, in metres:
 * **4**. The road is drawn as the mean of the route over 10 m either side
 * (`terrain.ts`, #543), so through a bend it runs a metre or two inside the
 * mapped line; half a carriageway and a little covers that, and is nearer
 * than the next carriageway of a dual road.
 */
export const SPAN_TOLERANCE_METRES = 4;

/** How near parallel to the road the segment must run: within **30°**, as a cosine. */
export const SPAN_PARALLEL_COSINE = Math.cos(Math.PI / 6);

/** The shortest stretch that is a span, in metres: **8**. Less is a stray vertex. */
export const SPAN_MIN_METRES = 8;

/** The longest gap between two stretches of one span, in metres: **10**, two steps. */
export const SPAN_GAP_METRES = 10;

/**
 * The most graded segments one corridor's spans are found from: **20 000**,
 * in file order, and the most grid cells they are filed under:
 * {@link SPAN_MAX_CELLS}. A decoded tile bounds vertices, not length, so past
 * either the rest are not read, as `cross-streets.ts` §`STREET_MAX_METRES`
 * stops the streets.
 */
export const SPAN_MAX_SEGMENTS = 20_000;

/** @see SPAN_MAX_SEGMENTS — **100 000**. */
export const SPAN_MAX_CELLS = 100_000;

/** The side of the grid cells the graded segments are filed under, in metres. */
const SPAN_CELL_METRES = 32;

/**
 * How long each piece of a mapped span's parapet is, in metres: **12**. Three
 * of a stream bridge's pieces (`waterways.ts` §`BRIDGE_PIECE_METRES`): a
 * mapped bridge can be hundreds of metres long, and at four boxes a piece the
 * belt's 128 are 384 m of parapet.
 */
export const SPAN_PIECE_METRES = 12;

/** How high a tunnel portal's opening stands over the road, in metres: **5.2**. */
export const PORTAL_CLEAR_METRES = 5.2;

/** How wide each of a portal's jambs is, across the road, in metres: **0.9**. */
export const PORTAL_JAMB_METRES = 0.9;

/** How far a portal's jamb stands off the carriageway's edge, in metres: **0.3**. */
export const PORTAL_VERGE_METRES = 0.3;

/** How deep a portal is along the road, in metres: **1.5**. */
export const PORTAL_DEPTH_METRES = 1.5;

/** How deep a portal's lintel is, in metres: **1**. */
export const PORTAL_LINTEL_METRES = 1;

/** How many of a side deck's 4 m stations one parapet runs along: **3**, 12 m. */
const SIDE_DECK_STATIONS = 3;

/** A stretch of a view on a mapped bridge or in a mapped tunnel, in the view's own distance. */
export interface RiddenSpan {
  readonly from: number;
  readonly to: number;
  readonly grade: Exclude<StreetGrade, 'ground'>;
}

const NO_SPANS: readonly RiddenSpan[] = [];

const found = new WeakMap<WorldCorridor, { profile: RouteProfile; spans: readonly RiddenSpan[] }>();

/**
 * The stretches of `profile`'s drawn road on a mapped bridge or in a mapped
 * tunnel — #3105. Built once per corridor and view. @see the header
 */
export function riddenSpans(
  corridor: WorldCorridor,
  profile: RouteProfile,
  origin: CorridorOrigin,
): readonly RiddenSpan[] {
  const cached = found.get(corridor);
  if (cached?.profile === profile) return cached.spans;
  const spans = findSpans(corridor, profile, origin);
  found.set(corridor, { profile, spans });
  return spans;
}

function findSpans(
  corridor: WorldCorridor,
  profile: RouteProfile,
  origin: CorridorOrigin,
): readonly RiddenSpan[] {
  // Every finite segment of a graded street: `ax, az, bx, bz`, and its grade.
  const segments: number[] = [];
  const grades: Exclude<StreetGrade, 'ground'>[] = [];
  const cells = new Map<string, number[]>();
  const cellOf = (value: number): number => Math.floor(value / SPAN_CELL_METRES);
  let work = SPAN_MAX_CELLS;
  for (const street of corridor.streets) {
    if (street.grade === 'ground') continue;
    const line = street.line;
    for (let at = 0; at + 3 < line.length; at += 2) {
      if (grades.length >= SPAN_MAX_SEGMENTS || work <= 0) break;
      const ax = line[at] as number;
      const az = line[at + 1] as number;
      const bx = line[at + 2] as number;
      const bz = line[at + 3] as number;
      if (![ax, az, bx, bz].every(Number.isFinite)) continue;
      const index = grades.length;
      grades.push(street.grade);
      segments.push(ax, az, bx, bz);
      const reach = SPAN_TOLERANCE_METRES;
      for (
        let column = cellOf(Math.min(ax, bx) - reach);
        column <= cellOf(Math.max(ax, bx) + reach) && work > 0;
        column += 1
      ) {
        for (
          let row = cellOf(Math.min(az, bz) - reach);
          row <= cellOf(Math.max(az, bz) + reach) && work > 0;
          row += 1
        ) {
          work -= 1;
          const key = `${String(column)},${String(row)}`;
          const filed = cells.get(key);
          if (filed === undefined) cells.set(key, [index]);
          else filed.push(index);
        }
      }
    }
  }
  if (grades.length === 0) return NO_SPANS;
  const total: number = profile.totalDistance;
  const steps = Math.max(2, Math.min(SPAN_SAMPLE_LIMIT, Math.round(total / SPAN_SAMPLE_METRES)));
  const spacing = total / steps;
  const spans: { from: number; to: number; grade: Exclude<StreetGrade, 'ground'> }[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const at = Math.min(total, index * spacing);
    const frame = drawnRoadFrame(profile, origin, at);
    if (frame === undefined) continue;
    // The road runs along (normalZ, −normalX): the normal is (−tz, tx).
    const tx = frame.normalZ;
    const tz = -frame.normalX;
    let grade: Exclude<StreetGrade, 'ground'> | undefined;
    for (const segment of cells.get(`${String(cellOf(frame.x))},${String(cellOf(frame.z))}`) ??
      []) {
      const ax = segments[segment * 4] as number;
      const az = segments[segment * 4 + 1] as number;
      const ex = (segments[segment * 4 + 2] as number) - ax;
      const ez = (segments[segment * 4 + 3] as number) - az;
      const length = Math.hypot(ex, ez);
      if (!(length > 0)) continue;
      if (Math.abs(ex * tx + ez * tz) < SPAN_PARALLEL_COSINE * length) continue;
      const share = Math.min(
        1,
        Math.max(0, ((frame.x - ax) * ex + (frame.z - az) * ez) / (length * length)),
      );
      const gap = Math.hypot(ax + share * ex - frame.x, az + share * ez - frame.z);
      if (gap > SPAN_TOLERANCE_METRES) continue;
      // A bridge wins where both are mapped, as a street's own grade does.
      if (grades[segment] === 'bridge') {
        grade = 'bridge';
        break;
      }
      grade = 'tunnel';
    }
    if (grade === undefined) continue;
    const last = spans[spans.length - 1];
    if (last?.grade === grade && at - last.to <= SPAN_GAP_METRES + 1e-6) last.to = at;
    else spans.push({ from: at, to: at, grade });
  }
  return spans.filter((span) => span.to - span.from >= SPAN_MIN_METRES);
}

/** A tunnel's portal across the road at `distance`: two jambs and a lintel, in concrete. */
function portalParts(
  profile: RouteProfile,
  origin: CorridorOrigin,
  distance: number,
  parts: BridgePart[],
): void {
  const frame = drawnRoadFrame(profile, origin, distance);
  if (frame === undefined) return;
  const y = elevationAt(profile, distance) - origin.elevation;
  const axis = { axisX: frame.normalZ, axisY: 0, axisZ: -frame.normalX };
  const out = ROAD_WIDTH_METRES / 2 + PORTAL_VERGE_METRES + PORTAL_JAMB_METRES / 2;
  for (const side of [1, -1]) {
    parts.push({
      x: frame.x + frame.normalX * out * side,
      y: y + PORTAL_CLEAR_METRES / 2,
      z: frame.z + frame.normalZ * out * side,
      ...axis,
      length: PORTAL_DEPTH_METRES,
      width: PORTAL_JAMB_METRES,
      height: PORTAL_CLEAR_METRES,
      finish: 'concrete',
    });
  }
  parts.push({
    x: frame.x,
    y: y + PORTAL_CLEAR_METRES + PORTAL_LINTEL_METRES / 2,
    z: frame.z,
    ...axis,
    length: PORTAL_DEPTH_METRES,
    width: 2 * (out + PORTAL_JAMB_METRES / 2),
    height: PORTAL_LINTEL_METRES,
    finish: 'concrete',
  });
}

/**
 * The boxes of the mapped spans in view of this frame's corridor — #3105: a
 * bridge's parapets and copings in pieces of {@link SPAN_PIECE_METRES}, on a
 * grid fixed to the span so no piece moves as the rider does, nearest the
 * rider first; none over a stretch a crossing of `ways` already bridges
 * (`waterways.ts` §`bridgeParts`, which is handed the same crossings); and a
 * portal at each mouth of a tunnel in view. At most `room` boxes.
 */
export function riddenSpanParts(
  profile: RouteProfile,
  origin: CorridorOrigin,
  corridor: RoadCorridor,
  spans: readonly RiddenSpan[],
  ways: Waterways,
  riderDistance: number,
  room: number,
): readonly BridgePart[] {
  if (spans.length === 0 || room <= 0) return [];
  const first = (corridor.centre[0] as CorridorPoint).along;
  const last = (corridor.centre[corridor.centre.length - 1] as CorridorPoint).along;
  const bridged = ways.crossings.map((crossing) => {
    const half = BRIDGE_HALF_SPAN_METRES + crossingWiden(crossing);
    return { from: crossing.distance - half, to: crossing.distance + half };
  });
  const parts: BridgePart[] = [];
  /** Each stretch of parapet to build, with how far its middle is from the rider. */
  const pieces: { from: number; to: number; gap: number }[] = [];
  for (const span of spans) {
    if (span.to < first || span.from > last) continue;
    if (span.grade === 'tunnel') {
      for (const mouth of [span.from, span.to]) {
        if (mouth >= first && mouth <= last) portalParts(profile, origin, mouth, parts);
      }
      continue;
    }
    const count = Math.max(1, Math.round((span.to - span.from) / SPAN_PIECE_METRES));
    const step = (span.to - span.from) / count;
    for (let piece = 0; piece < count; piece += 1) {
      const from = span.from + piece * step;
      const to = from + step;
      if (to < first || from > last) continue;
      // What of the piece no crossing's own bridge already covers.
      let open = [{ from, to }];
      for (const bridge of bridged) {
        open = open.flatMap((each) =>
          bridge.to <= each.from || bridge.from >= each.to
            ? [each]
            : [
                { from: each.from, to: Math.min(each.to, bridge.from) },
                { from: Math.max(each.from, bridge.to), to: each.to },
              ],
        );
      }
      for (const each of open) {
        if (each.to - each.from < 1) continue;
        pieces.push({ ...each, gap: Math.abs((each.from + each.to) / 2 - riderDistance) });
      }
    }
  }
  pieces.sort((a, b) => a.gap - b.gap);
  for (const piece of pieces) {
    if (parts.length >= room) break;
    // One piece, and no slab: the road is on the ground either side of water.
    deckPieces(profile, origin, corridor, piece.from, piece.to, parts, {
      pieceMetres: piece.to - piece.from,
      slab: false,
    });
  }
  return parts.length > room ? parts.slice(0, room) : parts;
}

const sideParts = new WeakMap<SideRoad, readonly BridgePart[]>();

/** A side deck's parapets, from its own drawn ribbon: one along each edge every {@link SIDE_DECK_STATIONS} stations. */
function partsOfDeck(road: SideRoad): readonly BridgePart[] {
  const known = sideParts.get(road);
  if (known !== undefined) return known;
  const parts: BridgePart[] = [];
  const positions = road.mesh.positions;
  // `nearby-streets.ts` §`streetRibbon`: a left and a right vertex a station.
  const stations = Math.floor(positions.length / 6);
  for (let from = 0; from + 1 < stations; from += SIDE_DECK_STATIONS) {
    const to = Math.min(stations - 1, from + SIDE_DECK_STATIONS);
    for (const edge of [0, 1]) {
      const other = 1 - edge;
      const ax = positions[(from * 2 + edge) * 3] as number;
      const ay = positions[(from * 2 + edge) * 3 + 1] as number;
      const az = positions[(from * 2 + edge) * 3 + 2] as number;
      const bx = positions[(to * 2 + edge) * 3] as number;
      const by = positions[(to * 2 + edge) * 3 + 1] as number;
      const bz = positions[(to * 2 + edge) * 3 + 2] as number;
      const length = Math.hypot(bx - ax, by - ay, bz - az);
      // Outward: from the other edge to this one, at the first station.
      const ox = ax - (positions[(from * 2 + other) * 3] as number);
      const oz = az - (positions[(from * 2 + other) * 3 + 2] as number);
      const across = Math.hypot(ox, oz);
      if (!(length > 0) || !(across > 0)) continue;
      const out = PARAPET_THICKNESS_METRES / 2 / across;
      parts.push({
        x: (ax + bx) / 2 + ox * out,
        y: (ay + by) / 2 + PARAPET_HEIGHT_METRES / 2,
        z: (az + bz) / 2 + oz * out,
        axisX: (bx - ax) / length,
        axisY: (by - ay) / length,
        axisZ: (bz - az) / length,
        length,
        width: PARAPET_THICKNESS_METRES,
        height: PARAPET_HEIGHT_METRES,
      });
    }
  }
  sideParts.set(road, parts);
  return parts;
}

/**
 * The parapets of the side streets' decks among `roads` — #3105
 * (`cross-streets.ts` §`SideRoad.deck`): whole decks, in the order given, in
 * at most `room` boxes. Built once a deck, from the ribbon it is drawn as.
 */
export function sideDeckParts(roads: readonly SideRoad[], room: number): readonly BridgePart[] {
  let parts: BridgePart[] | undefined;
  for (const road of roads) {
    if (road.deck !== true) continue;
    const own = partsOfDeck(road);
    if ((parts?.length ?? 0) + own.length > room) continue;
    parts ??= [];
    parts.push(...own);
  }
  return parts ?? [];
}
