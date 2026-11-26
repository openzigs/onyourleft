// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The street a saved route is on, painted on the road now and then** —
 * #3245, under ADR 0100 (proposed).
 *
 * The open world paints every named street at each junction mouth and every
 * 200 m (`street-names.ts` §`streetNameLabels`, #3052). A route ride is much
 * sparser, because the rider is not choosing a way and a side street's name
 * would be clutter: only **the street the route is on** is named,
 *
 * - **once just after the route joins it** — its first label's nearest letter
 *   {@link ROUTE_STREET_NAME_JOIN_METRES} past where the route came onto it,
 *   so the rider learns the street's name as they turn onto it (the route's
 *   first street counts as joined at the start);
 * - **and then at most once each {@link ROUTE_STREET_NAME_REPEAT_METRES}**
 *   along the same street.
 *
 * ## Which street the route is on
 *
 * The drawn road (`road-grid.ts` §`drawnRoadPoints`) is sampled every
 * {@link SAMPLE_METRES}. A sample is on a named street when one of the
 * corridor's named streets passes within {@link MATCH_METRES} of it and runs
 * within {@link MATCH_DEGREES} of the road's heading there, either way — so a
 * street that crosses the route at a junction is never the route's street.
 * The nearest such street names the sample. Samples of one name make a
 * stretch; a stretch shorter than {@link MIN_STRETCH_METRES} is a stray match
 * and dropped, and two stretches of one name with no more than
 * {@link GAP_METRES} between them (an unnamed bridge, the junction's own
 * node) are one. A different name, or a longer gap, is a new street, and the
 * route joining it earns its label again.
 *
 * ## Where a label goes
 *
 * On the drawn road's centreline, laid along it, painted exactly as the open
 * world's are (`street-names.ts` §`streetNamesInView`, one draw call for all
 * of them). **Only where the whole name fits**: inside its street's stretch,
 * and where the road runs straight under it, within
 * {@link STRAIGHT_METRES} of the name's line along its whole length. Where it
 * does not fit, the label moves on along the street until it does, or the
 * street ends first and it is not painted. An unnamed street gets nothing, a
 * name the glyph atlas cannot paint whole gets nothing, and nothing invents
 * a name.
 *
 * ⚠️ **A street name is map data, not the rider's place** (ADR 0096 D-4, ADR
 * 0100): drawn, never logged, stored by this module, or sent. Nothing here
 * formats a coordinate into a string.
 *
 * Pure, run once at the press, and names no rendering library.
 */

import type { RouteProfile } from '@onyourleft/domain';

import { drawnRoadPoints, squaredToSegment, type DrawnRoadPoints } from './road-grid';
import { paintable, paintedLength, type StreetNameLabel } from './street-names';
import type { CorridorOrigin } from './terrain';

/**
 * How far apart one street's labels are on a route ride, at the least, in
 * metres: **1 000** (#3245: "every once in a while — not that often").
 */
export const ROUTE_STREET_NAME_REPEAT_METRES = 1_000;

/**
 * How far past where the route joins a street its first label's nearest
 * letter is, in metres: **30**, so the name is in front of the rider just
 * after the turn rather than in the junction.
 */
export const ROUTE_STREET_NAME_JOIN_METRES = 30;

/** How often the drawn road is sampled for the street it is on, in metres. */
const SAMPLE_METRES = 4;

/** How far from the drawn centreline a mapped street may be and still be the route's, in metres. */
const MATCH_METRES = 8;

/** How far a mapped street's heading may be from the road's and still be the route's, in degrees. */
const MATCH_DEGREES = 30;

const MATCH_COSINE = Math.cos((MATCH_DEGREES * Math.PI) / 180);

/** The shortest stretch of one name that is a street the route is on, in metres. */
const MIN_STRETCH_METRES = 20;

/** The longest unnamed stretch inside one street, in metres. */
const GAP_METRES = 50;

/** How far the drawn road may stray from a label's straight line under it, in metres. */
const STRAIGHT_METRES = 1;

/** The side of a cell of the named streets' index, in metres. */
const CELL_METRES = 32;

/** How far apart a street's indexed points are: half a cell, so none of it is more than a quarter cell from one. */
const INDEX_STEP_METRES = CELL_METRES / 2;

/** One straight piece of a named street. */
interface NamedSegment {
  readonly ax: number;
  readonly az: number;
  readonly dx: number;
  readonly dz: number;
  readonly span: number;
  readonly length: number;
  readonly name: string;
}

/** A street as this module reads it: its line in local metres and its name, if any. */
export interface RouteStreet {
  readonly line: ArrayLike<number>;
  readonly name?: string | undefined;
}

/** One street the route is on, from where it joins to where it leaves, route metres. */
interface Stretch {
  readonly name: string;
  readonly from: number;
  to: number;
}

const cellKey = (column: number, row: number): number =>
  (column + 2 ** 20) * 2 ** 21 + (row + 2 ** 20);

/** Every paintable named street's segments, by the cells they pass through. */
function namedIndex(streets: Iterable<RouteStreet>): Map<number, NamedSegment[]> {
  const cells = new Map<number, NamedSegment[]>();
  for (const street of streets) {
    const name = street.name?.trim();
    if (name === undefined || name.length === 0 || !paintable(name)) continue;
    const line = street.line;
    for (let at = 0; at + 3 < line.length; at += 2) {
      const ax = line[at] as number;
      const az = line[at + 1] as number;
      const dx = (line[at + 2] as number) - ax;
      const dz = (line[at + 3] as number) - az;
      const span = dx * dx + dz * dz;
      if (!(span > 0)) continue;
      const length = Math.sqrt(span);
      const segment: NamedSegment = { ax, az, dx, dz, span, length, name };
      const steps = Math.ceil(length / INDEX_STEP_METRES);
      const filed = new Set<number>();
      for (let step = 0; step <= steps; step += 1) {
        const share = step / steps;
        const key = cellKey(
          Math.floor((ax + dx * share) / CELL_METRES),
          Math.floor((az + dz * share) / CELL_METRES),
        );
        if (filed.has(key)) continue;
        filed.add(key);
        const list = cells.get(key);
        if (list === undefined) cells.set(key, [segment]);
        else list.push(segment);
      }
    }
  }
  return cells;
}

/** The name of the street the drawn road runs along at its point `index`, if any. */
function nameAt(
  cells: Map<number, NamedSegment[]>,
  road: DrawnRoadPoints,
  index: number,
): string | undefined {
  const points = road.points;
  const last = points.length / 2 - 1;
  const from = Math.min(index, last - 1);
  const x = points[index * 2] as number;
  const z = points[index * 2 + 1] as number;
  const hx = (points[from * 2 + 2] as number) - (points[from * 2] as number);
  const hz = (points[from * 2 + 3] as number) - (points[from * 2 + 1] as number);
  const heading = Math.hypot(hx, hz);
  if (!(heading > 0)) return undefined;
  // A segment within MATCH_METRES has an indexed point within a further
  // quarter cell, so the cells within both of the sample hold it.
  const reach = MATCH_METRES + INDEX_STEP_METRES / 2;
  let least = MATCH_METRES * MATCH_METRES;
  let name: string | undefined;
  for (
    let column = Math.floor((x - reach) / CELL_METRES);
    column <= Math.floor((x + reach) / CELL_METRES);
    column += 1
  ) {
    for (
      let row = Math.floor((z - reach) / CELL_METRES);
      row <= Math.floor((z + reach) / CELL_METRES);
      row += 1
    ) {
      for (const segment of cells.get(cellKey(column, row)) ?? []) {
        const along = Math.abs(segment.dx * hx + segment.dz * hz) / (segment.length * heading);
        if (along < MATCH_COSINE) continue;
        const squared = squaredToSegment(
          x,
          z,
          segment.ax,
          segment.az,
          segment.dx,
          segment.dz,
          segment.span,
        );
        if (squared <= least) {
          least = squared;
          name = segment.name;
        }
      }
    }
  }
  return name;
}

/** Each street the drawn road is on, in route order. @see the header */
function stretchesOf(cells: Map<number, NamedSegment[]>, road: DrawnRoadPoints): Stretch[] {
  const count = road.points.length / 2;
  const every = Math.max(1, Math.round(SAMPLE_METRES / road.step));
  const raw: Stretch[] = [];
  let current: Stretch | undefined;
  for (let index = 0; index < count; index += every) {
    const along = Math.min(road.total, index * road.step);
    const name = nameAt(cells, road, index);
    if (name === undefined) {
      if (current !== undefined && along - current.to > GAP_METRES) current = undefined;
    } else if (current?.name === name) {
      current.to = along;
    } else {
      current = { name, from: along, to: along };
      raw.push(current);
    }
  }
  const stretches: Stretch[] = [];
  for (const stretch of raw) {
    if (stretch.to - stretch.from < MIN_STRETCH_METRES) continue;
    const previous = stretches.at(-1);
    if (previous?.name === stretch.name && stretch.from - previous.to <= GAP_METRES) {
      previous.to = stretch.to;
    } else {
      stretches.push({ ...stretch });
    }
  }
  return stretches;
}

/** The drawn road's point `metres` along it. */
function pointAt(road: DrawnRoadPoints, metres: number): { x: number; z: number } {
  const last = road.points.length / 2 - 1;
  const exact = Math.min(last, Math.max(0, metres / road.step));
  const index = Math.min(last - 1, Math.floor(exact));
  const share = exact - index;
  const points = road.points;
  return {
    x: (points[index * 2] as number) * (1 - share) + (points[index * 2 + 2] as number) * share,
    z: (points[index * 2 + 1] as number) * (1 - share) + (points[index * 2 + 3] as number) * share,
  };
}

/**
 * A label's middle and direction at `at`, `half` metres either side — or
 * `undefined` where the drawn road strays more than {@link STRAIGHT_METRES}
 * from the name's straight line anywhere under it.
 */
function straightPlace(
  road: DrawnRoadPoints,
  at: number,
  half: number,
): Pick<StreetNameLabel, 'x' | 'z' | 'alongX' | 'alongZ'> | undefined {
  const start = pointAt(road, at - half);
  const end = pointAt(road, at + half);
  const length = Math.hypot(end.x - start.x, end.z - start.z);
  if (!(length > 0)) return undefined;
  const alongX = (end.x - start.x) / length;
  const alongZ = (end.z - start.z) / length;
  for (let metres = at - half; metres <= at + half; metres += road.step) {
    const point = pointAt(road, metres);
    const off = Math.abs((point.x - start.x) * alongZ - (point.z - start.z) * alongX);
    if (off > STRAIGHT_METRES) return undefined;
  }
  const middle = pointAt(road, at);
  return { x: middle.x, z: middle.z, alongX, alongZ };
}

/**
 * Every label of a route ride — #3245: the name of the street the route is
 * on, once just after the route joins it and then at most once each
 * {@link ROUTE_STREET_NAME_REPEAT_METRES}, where the whole name fits. None
 * for a route with no named street under it. @see the header
 */
export function routeStreetNameLabels(
  streets: Iterable<RouteStreet>,
  profile: RouteProfile,
  origin: CorridorOrigin,
): StreetNameLabel[] {
  const cells = namedIndex(streets);
  if (cells.size === 0) return [];
  const road = drawnRoadPoints(profile, origin);
  if (road.points.length < 4) return [];
  const labels: StreetNameLabel[] = [];
  for (const stretch of stretchesOf(cells, road)) {
    const half = paintedLength(stretch.name) / 2;
    let at = stretch.from + ROUTE_STREET_NAME_JOIN_METRES + half;
    while (at + half <= stretch.to) {
      const place = straightPlace(road, at, half);
      if (place === undefined) {
        at += SAMPLE_METRES;
        continue;
      }
      labels.push({ key: `route:${String(labels.length)}`, text: stretch.name, ...place });
      at += ROUTE_STREET_NAME_REPEAT_METRES;
    }
  }
  return labels;
}
