// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The HUD's plan view as a street map around the rider — #2290.
 *
 * The owner, 2026-11-06, from a tablet: the plan view draws only the route's
 * outline. Where the ride's world was given a corridor of map data (#1539,
 * ADR 0054), the panel now draws that data — the covered land, water, streets
 * and paths — about {@link STREET_MAP_METRES} across, north up, centred on the
 * rider and following them, with the route and the rider's mark on top.
 *
 * ## ⚠️ From the corridor this ride already holds, and never from a tile request
 *
 * The obvious build is a second MapLibre map in the corner, asking the
 * archive for tiles as the rider moves. It is not built, and not on taste:
 * ADR 0032 D-1 item 1 — *"no runtime request is made by anything under
 * `apps/web/src/game/` … at any time"* — and ADR 0054 D-2.4, *"no request for
 * the world is made while a ride is recording … the disclosure is one
 * corridor, once, and not a sequence of positions for an hour."* A map that
 * followed the rider over the network would be exactly that sequence: a tile
 * range every kilometre or so, for the whole ride, saying where the athlete
 * is riding. Changing that takes a superseding ADR, not this file.
 *
 * What the ride does hold is the corridor: every z15 tile within 250 m of the
 * route, read from the configured basemap archive once, when the route was
 * chosen or saved, kept on the device (`world-data/corridor-port.ts`) and
 * fixed for the ride at the press (`GameView` §`worldCorridorRef`). A z15
 * tile is about a kilometre on a side, so the corridor already reaches about
 * {@link STREET_MAP_METRES} round the rider. Drawn from it, this panel:
 *
 * - **makes no request at all**, so `plan-no-network.test.tsx` still holds,
 *   now with a corridor as well as without;
 * - **works offline**, from the copy of the archive's data the device keeps;
 * - **keeps the privacy zones trimmed**, because the read never asked for a
 *   tile touching one (ADR 0054 D-6.3): those tiles are blank here too;
 * - **owes only the credit the HUD already shows** for a ride with a corridor
 *   (`HudPanelProps.attribution`, ADR 0054 D-3.6).
 *
 * ⚠️ **What it cannot draw, stated rather than implied.** No place names: the
 * corridor keeps no name (ADR 0054 D-2.2), and its place points may be read
 * by `urban-class.ts` alone (ADR 0055 D-5.4, `places-never-shown.test.ts`).
 * And no map on a ride with no corridor — the stylised world, map tiles off,
 * no archive, a route outside the archive's coverage — where the panel draws
 * the route's outline as it always has (`PlanTrace.tsx`).
 *
 * ## North up
 *
 * `plan.ts` §"North-up, deliberately" gives the reasons, and they hold here:
 * the shape a rider recognises is what a turning map destroys, and a heading
 * computed here would be a second one beside `scene.ts` §`cameraPose`.
 *
 * ## The cost, bounded: an SVG, redrawn only when the rider has moved
 *
 * `HudPanel` renders sixty times a second. The per-frame work here is the
 * rider's place, which is a lookup and two multiplications. The drawing
 * changes only when that place reaches another point of a
 * {@link STREET_MAP_STEP_METRES} grid (the view is centred on the grid point,
 * under a pixel from the rider on every box `theme.css` gives the panel), and
 * the shapes in it only when the rider crosses into another
 * {@link STREET_MAP_CELL_METRES} cell. Each layer is ONE `<path>`, however many
 * streets it holds, so the panel is six elements on every ride. A rider who
 * has stopped costs no redraw at all.
 */

import { distanceBetween, positionAt, type RouteProfile } from '@onyourleft/domain';

import { localGroundPosition, type CorridorOrigin } from '../terrain';
import type { WorldCorridor } from '../world-data/corridor';
import { PLAN_BREAK_FACTOR, PLAN_SIZE, RIDER_MARK_RADIUS } from './plan';

/**
 * How much of the world the panel shows, in metres, across its shorter side:
 * **1 km**, the owner's "about 1 km around the rider". The box is wider than it
 * is tall in every layout (`theme.css` §`.oyl-hud__plan-svg`), and the drawing
 * is fitted with `meet`, so the height is this and the width is more of the
 * same map rather than a stretched one.
 */
export const STREET_MAP_METRES = 1000;

/**
 * The grid the view's centre moves on: **5 m**. On the largest box the panel
 * has, 8 rem, a kilometre is 128 px, so a step is 0.64 px — the map moves no
 * more than a pixel at a time and is redrawn about twice a second at 40 km/h
 * rather than sixty times.
 */
export const STREET_MAP_STEP_METRES = 5;

/**
 * The side of the cells the map's shapes are filed under: **500 m**. A shape
 * is filed under the cell holding the middle of its bounds, and the panel
 * draws the cells near the rider's, so the set changes once per 500 m ridden.
 */
export const STREET_MAP_CELL_METRES = 500;

/**
 * Half the widest stretch drawn east–west: **2.5 km**. A phone upright gives
 * the panel about 22 rem by 5 rem, which at {@link STREET_MAP_METRES} tall is
 * 2.2 km wide; a shape off the box is clipped by the SVG, so this only has to
 * be wide enough.
 */
const REACH_ACROSS_METRES = 2500;

/**
 * How far a shape may reach from the middle of its bounds: **650 m**. The
 * archive clips every shape to its z15 tile, about 1.2 km on a side at the
 * equator and less elsewhere, so no shape the corridor holds reaches further.
 */
const SHAPE_REACH_METRES = 650;

/** How many route samples go in one filed piece of the route: 50, 500 m on the grid. */
const ROUTE_PIECE_SAMPLES = 50;

/**
 * The closest two kept vertices of a street may be: **2 m**, a quarter of a
 * pixel on the largest box. The archive's z15 tiles carry more than that.
 */
const VERTEX_METRES = 2;

/**
 * The rider's mark, as a radius in metres: the plan view's own mark, at this
 * map's scale, so it is the same size on screen on both (`plan.ts`
 * §`RIDER_MARK_MINIMUM_PIXELS`).
 */
export const STREET_MAP_MARK_RADIUS = (RIDER_MARK_RADIUS * STREET_MAP_METRES) / PLAN_SIZE;

/**
 * A place on the map, in metres **east** and **south** of the corridor's
 * origin — an SVG's own axes, so north is up. The corridor's local frame is
 * metres WEST (`x`) and NORTH (`z`) (`terrain.ts` §`localGroundPosition`), so
 * both are negated, once, here.
 */
export interface StreetMapPoint {
  readonly east: number;
  readonly south: number;
}

/** Every layer the map draws, each as one SVG path `d`, painted in this order. */
export interface StreetMapLayers {
  /** The corridor's covered tiles: where there is map data at all. */
  readonly land: string;
  readonly water: string;
  readonly streets: string;
  readonly paths: string;
  /** The route, on top of the map. */
  readonly route: string;
}

type Layer = keyof StreetMapLayers;

const LAYERS: readonly Layer[] = ['land', 'water', 'streets', 'paths', 'route'];

/** The map's shapes, filed by cell, each layer's as path fragments. */
export interface StreetMapIndex {
  readonly cells: ReadonlyMap<string, Readonly<Record<Layer, readonly string[]>>>;
}

/** A cell, by its column (east) and row (south). */
export interface StreetMapCell {
  readonly column: number;
  readonly row: number;
}

/** One decimal: a tenth of a metre, far finer than a pixel. Never `-0`. */
function coordinate(value: number): string {
  return String(Math.round(value * 10) / 10 + 0);
}

function cellKey(column: number, row: number): string {
  return `${String(column)},${String(row)}`;
}

/** The cell a point is in. */
export function streetMapCell(point: StreetMapPoint): StreetMapCell {
  return {
    column: Math.floor(point.east / STREET_MAP_CELL_METRES),
    row: Math.floor(point.south / STREET_MAP_CELL_METRES),
  };
}

/** A fragment and where it is filed: the middle of its bounds. */
interface Fragment {
  readonly d: string;
  readonly middle: StreetMapPoint;
}

/**
 * A line or a ring of `x0, z0, x1, z1, …` in the corridor's local metres, as
 * one subpath. Vertices closer than {@link VERTEX_METRES} to the last one kept
 * are dropped, but never a line's last. `undefined` for fewer than two points
 * kept, or a ring of fewer than three.
 */
function fragmentOf(values: Float32Array, closed: boolean): Fragment | undefined {
  const points: string[] = [];
  let lastEast = Number.NaN;
  let lastSouth = Number.NaN;
  let low = { east: Number.POSITIVE_INFINITY, south: Number.POSITIVE_INFINITY };
  let high = { east: Number.NEGATIVE_INFINITY, south: Number.NEGATIVE_INFINITY };
  for (let index = 0; index + 1 < values.length; index += 2) {
    const east = -(values[index] as number);
    const south = -(values[index + 1] as number);
    if (!Number.isFinite(east) || !Number.isFinite(south)) continue;
    const final = index + 3 >= values.length;
    const near = Math.hypot(east - lastEast, south - lastSouth) < VERTEX_METRES;
    if (near && !(final && !closed)) continue;
    points.push(`${coordinate(east)} ${coordinate(south)}`);
    lastEast = east;
    lastSouth = south;
    low = { east: Math.min(low.east, east), south: Math.min(low.south, south) };
    high = { east: Math.max(high.east, east), south: Math.max(high.south, south) };
  }
  if (points.length < (closed ? 3 : 2)) return undefined;
  return {
    d: `M${points[0] as string}L${points.slice(1).join(' ')}${closed ? 'Z' : ''}`,
    middle: { east: (low.east + high.east) / 2, south: (low.south + high.south) / 2 },
  };
}

/** The route's samples as pieces of line, split where they jump (`plan.ts` §`PLAN_BREAK_FACTOR`). */
function routeFragments(origin: CorridorOrigin, profile: RouteProfile): readonly Fragment[] {
  const positions = profile.positions;
  const breakAbove = PLAN_BREAK_FACTOR * (profile.resolution as number);
  const fragments: Fragment[] = [];
  let piece: number[] = [];
  const close = (): void => {
    const fragment = fragmentOf(Float32Array.from(piece), false);
    if (fragment !== undefined) fragments.push(fragment);
  };
  positions.forEach((position, index) => {
    const previous = positions[index - 1];
    if (previous !== undefined && distanceBetween(previous, position) > breakAbove) {
      close();
      piece = [];
    }
    const local = localGroundPosition(origin, position);
    piece.push(local.x, local.z);
    // Pieces share their end sample, so the drawn route has no gap at a seam.
    if (piece.length >= ROUTE_PIECE_SAMPLES * 2) {
      close();
      piece = [local.x, local.z];
    }
  });
  if (piece.length >= 4) close();
  return fragments;
}

/**
 * The corridor and the route, filed by cell. Built once per ride: the corridor
 * and the route are both fixed when the ride starts.
 */
export function streetMapIndex(corridor: WorldCorridor, profile: RouteProfile): StreetMapIndex {
  const cells = new Map<string, Record<Layer, string[]>>();
  const file = (layer: Layer, fragment: Fragment | undefined): void => {
    if (fragment === undefined) return;
    const { column, row } = streetMapCell(fragment.middle);
    const key = cellKey(column, row);
    let cell = cells.get(key);
    if (cell === undefined) {
      cell = { land: [], water: [], streets: [], paths: [], route: [] };
      cells.set(key, cell);
    }
    cell[layer].push(fragment.d);
  };
  for (const box of corridor.coveredBoxes) {
    file(
      'land',
      fragmentOf(
        Float32Array.of(
          box.minX,
          box.minZ,
          box.maxX,
          box.minZ,
          box.maxX,
          box.maxZ,
          box.minX,
          box.maxZ,
        ),
        true,
      ),
    );
  }
  for (const feature of corridor.landUse) {
    if (feature.layer !== 'water') continue;
    // Every ring, outer and holes, into the one path: the archive winds a hole
    // against its outer ring, so the default `nonzero` fill leaves it open,
    // and two tiles' overlapping halves of one lake still fill as one.
    for (const ring of feature.rings) file('water', fragmentOf(ring, true));
  }
  for (const street of corridor.streets) file('streets', fragmentOf(street.line, false));
  for (const path of corridor.paths) file('paths', fragmentOf(path.line, false));
  for (const fragment of routeFragments(corridor.origin, profile)) file('route', fragment);
  return { cells };
}

/** The cells either side of a cell that can hold a shape inside the view. */
const COLUMNS_AROUND = Math.ceil(
  (REACH_ACROSS_METRES + SHAPE_REACH_METRES) / STREET_MAP_CELL_METRES,
);
const ROWS_AROUND = Math.ceil(
  (STREET_MAP_METRES / 2 + SHAPE_REACH_METRES) / STREET_MAP_CELL_METRES,
);

/** Every layer's shapes near a cell, each layer joined into one `d`. */
export function streetMapLayers(index: StreetMapIndex, centre: StreetMapCell): StreetMapLayers {
  const found: Record<Layer, string[]> = { land: [], water: [], streets: [], paths: [], route: [] };
  for (
    let column = centre.column - COLUMNS_AROUND;
    column <= centre.column + COLUMNS_AROUND;
    column += 1
  ) {
    for (let row = centre.row - ROWS_AROUND; row <= centre.row + ROWS_AROUND; row += 1) {
      const cell = index.cells.get(cellKey(column, row));
      if (cell === undefined) continue;
      for (const layer of LAYERS) found[layer].push(...cell[layer]);
    }
  }
  return {
    land: found.land.join(''),
    water: found.water.join(''),
    streets: found.streets.join(''),
    paths: found.paths.join(''),
    route: found.route.join(''),
  };
}

/** A value on the {@link STREET_MAP_STEP_METRES} grid. Never `-0`. */
function onStep(value: number): number {
  return Math.round(value / STREET_MAP_STEP_METRES) * STREET_MAP_STEP_METRES + 0;
}

/**
 * Where the view is centred for an odometer reading: the rider's place on the
 * route, through `positionAt` (which wraps a loop, as `plan.ts` §`riderMark`
 * says), on the {@link STREET_MAP_STEP_METRES} grid.
 */
export function streetMapCentre(
  origin: CorridorOrigin,
  profile: RouteProfile,
  distance: number,
): StreetMapPoint {
  const local = localGroundPosition(origin, positionAt(profile, distance));
  return { east: onStep(-local.x), south: onStep(-local.z) };
}

/** The view: {@link STREET_MAP_METRES} square, centred on `centre`. */
export function streetMapViewBox(centre: StreetMapPoint): string {
  const half = STREET_MAP_METRES / 2;
  return [centre.east - half, centre.south - half, STREET_MAP_METRES, STREET_MAP_METRES]
    .map(String)
    .join(' ');
}
