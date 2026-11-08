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
 * ## The cost, bounded: a sheet drawn once per 250 m, and moved by the compositor
 *
 * `HudPanel` renders sixty times a second. The per-frame work here is the
 * rider's place, which is a lookup and two multiplications. What the tablet
 * pays for is different, and #2380 measured it: as #2290 built it, each
 * layer was ONE `<path>` joining every shape in 13 × 5 cells of 500 m — 58 KB
 * of streets on a real saved route — and the view box moved every
 * {@link STREET_MAP_STEP_METRES}, which made Skia re-stroke and re-raster the
 * whole of it on the GPU each time. A moving ride on that route ran at about
 * 5 fps on the owner's tablet; standing still, at 60.
 *
 * So the map is now two things that change at two rates:
 *
 * 1. **The sheet**: every layer CLIPPED to a {@link StreetMapRegion} — the
 *    widest box any layout gives the panel, plus {@link STREET_MAP_MARGIN_METRES}
 *    above and below — round a point on a {@link STREET_MAP_MARGIN_METRES}
 *    grid. Its shapes, and so its raster, change only when the rider's place
 *    reaches another point of that grid: once per 250 m ridden, about every
 *    22 s at 40 km/h. A segment off the region is not drawn at all, and a
 *    water ring or a covered tile is cut to it ({@link streetMapLayers}).
 * 2. **Where the sheet is**, a CSS `transform` on it ({@link streetMapSheetStyle})
 *    and on nothing else, once per {@link STREET_MAP_STEP_METRES}. The sheet
 *    is its own compositor layer (`theme.css` §`.oyl-hud__street-map-sheet`),
 *    so moving it re-strokes nothing: the GPU draws the raster it has, a
 *    fraction of a pixel further along.
 *
 * The rider's mark is drawn over the sheet in the middle of the box and never
 * changes at all. A rider who has stopped costs no write.
 */

import { distanceBetween, positionAt, type RouteProfile } from '@onyourleft/domain';

import { localGroundPosition, type CorridorOrigin } from '../terrain';
import type { WorldCorridor } from '../world-data/corridor';
import { PLAN_BREAK_FACTOR, PLAN_SIZE, RIDER_MARK_RADIUS } from './plan';

/**
 * How much of the world the panel shows, in metres, across its shorter side:
 * **1 km**, the owner's "about 1 km around the rider". The longer side is more
 * of the same map rather than a stretched one: the sheet is sized by the box's
 * shorter side, `cqmin` (`streetMapSheetStyle`), as #2290's `meet` fitted it.
 * The box is wider than tall in most layouts and a little taller than wide on
 * an upright phone (72 × 80 px at 390 × 844).
 */
export const STREET_MAP_METRES = 1000;

/**
 * The grid the view's centre moves on: **5 m**. On the largest box the panel
 * has, 8 rem, a kilometre is 128 px, so a step is 0.64 px — the map moves no
 * more than a pixel at a time, and its sheet is moved about twice a second at
 * 40 km/h rather than sixty times.
 */
export const STREET_MAP_STEP_METRES = 5;

/**
 * The side of the cells the map's shapes are filed under: **500 m**. A shape
 * is filed under the cell holding the middle of its bounds, and a region reads
 * the cells that can hold a shape reaching into it.
 */
export const STREET_MAP_CELL_METRES = 500;

/**
 * The margin the sheet is drawn beyond the box, and the grid its middle moves
 * on: **250 m** — #2380. The middle is the rider's place on this grid, so it
 * is never more than half of this from the rider, and the box never reaches
 * within half of this of the sheet's edge. The sheet is re-clipped, and
 * rasterised again, once per this many metres ridden: about every 22 s at
 * 40 km/h, where #2290's map was re-rasterised every 5 m.
 */
export const STREET_MAP_MARGIN_METRES = 250;

/**
 * Half the widest stretch drawn east–west: **2.5 km**. A phone upright gives
 * the panel about 22 rem by 5 rem, which at {@link STREET_MAP_METRES} tall is
 * 2.2 km either side of the rider, and the rider is up to half of
 * {@link STREET_MAP_MARGIN_METRES} from the sheet's middle: 2.325 km, under
 * this. `street-map.browser.spec.ts` holds the streets across the box at
 * every viewport it measures.
 *
 * ⚠️ The region is this wide on every box, a tablet's too, rather than as
 * wide as the box measured: the sheet is rasterised once per 250 m, so its
 * width costs one raster in 22 s, where measuring the box would add a resize
 * path to every ride.
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

/**
 * The part of the map the sheet holds, in the same metres: its `viewBox`.
 * @see streetMapRegion
 */
export interface StreetMapRegion {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
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

/** The layers whose shapes are rings, and filled; the rest are lines. */
const RINGS: ReadonlySet<Layer> = new Set(['land', 'water']);

/** A shape: `east0, south0, east1, south1, …`, its vertices thinned, and its bounds. */
interface Shape {
  readonly points: Float64Array;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The map's shapes, filed by cell. */
export interface StreetMapIndex {
  readonly cells: ReadonlyMap<string, Readonly<Record<Layer, readonly Shape[]>>>;
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

/**
 * A line or a ring of `x0, z0, x1, z1, …` in the corridor's local metres, as
 * a shape. Vertices closer than {@link VERTEX_METRES} to the last one kept
 * are dropped, but never a line's last. `undefined` for fewer than two points
 * kept, or a ring of fewer than three.
 */
function shapeOf(values: ArrayLike<number>, closed: boolean): Shape | undefined {
  const points: number[] = [];
  let lastEast = Number.NaN;
  let lastSouth = Number.NaN;
  for (let index = 0; index + 1 < values.length; index += 2) {
    const east = -(values[index] as number);
    const south = -(values[index + 1] as number);
    if (!Number.isFinite(east) || !Number.isFinite(south)) continue;
    const final = index + 3 >= values.length;
    const near = Math.hypot(east - lastEast, south - lastSouth) < VERTEX_METRES;
    if (near && !(final && !closed)) continue;
    points.push(east, south);
    lastEast = east;
    lastSouth = south;
  }
  if (points.length < (closed ? 6 : 4)) return undefined;
  return bounded(Float64Array.from(points));
}

function bounded(points: Float64Array): Shape {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (let index = 0; index + 1 < points.length; index += 2) {
    left = Math.min(left, points[index] as number);
    right = Math.max(right, points[index] as number);
    top = Math.min(top, points[index + 1] as number);
    bottom = Math.max(bottom, points[index + 1] as number);
  }
  return { points, left, top, right, bottom };
}

/** The route's samples as pieces of line, split where they jump (`plan.ts` §`PLAN_BREAK_FACTOR`). */
function routeShapes(origin: CorridorOrigin, profile: RouteProfile): readonly Shape[] {
  const positions = profile.positions;
  const breakAbove = PLAN_BREAK_FACTOR * (profile.resolution as number);
  const shapes: Shape[] = [];
  let piece: number[] = [];
  const close = (): void => {
    const shape = shapeOf(piece, false);
    if (shape !== undefined) shapes.push(shape);
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
  return shapes;
}

/**
 * The corridor and the route, filed by cell. Built once per ride: the corridor
 * and the route are both fixed when the ride starts.
 */
export function streetMapIndex(corridor: WorldCorridor, profile: RouteProfile): StreetMapIndex {
  const cells = new Map<string, Record<Layer, Shape[]>>();
  const file = (layer: Layer, shape: Shape | undefined): void => {
    if (shape === undefined) return;
    const { column, row } = streetMapCell({
      east: (shape.left + shape.right) / 2,
      south: (shape.top + shape.bottom) / 2,
    });
    const key = cellKey(column, row);
    let cell = cells.get(key);
    if (cell === undefined) {
      cell = { land: [], water: [], streets: [], paths: [], route: [] };
      cells.set(key, cell);
    }
    cell[layer].push(shape);
  };
  for (const box of corridor.coveredBoxes) {
    file(
      'land',
      shapeOf(
        [box.minX, box.minZ, box.maxX, box.minZ, box.maxX, box.maxZ, box.minX, box.maxZ],
        true,
      ),
    );
  }
  for (const feature of corridor.landUse) {
    if (feature.layer !== 'water') continue;
    // Every ring, outer and holes, into the one path: the archive winds a hole
    // against its outer ring, so the default `nonzero` fill leaves it open,
    // and two tiles' overlapping halves of one lake still fill as one.
    for (const ring of feature.rings) file('water', shapeOf(ring, true));
  }
  for (const street of corridor.streets) file('streets', shapeOf(street.line, false));
  for (const path of corridor.paths) file('paths', shapeOf(path.line, false));
  for (const shape of routeShapes(corridor.origin, profile)) file('route', shape);
  return { cells };
}

/** A value on a grid of `step`. Never `-0`. */
function onGrid(value: number, step: number): number {
  return Math.round(value / step) * step + 0;
}

/**
 * The part of the map the sheet holds for a view centred on `centre` — #2380:
 * {@link REACH_ACROSS_METRES} either side and the view's half plus
 * {@link STREET_MAP_MARGIN_METRES} above and below, round `centre` on the
 * {@link STREET_MAP_MARGIN_METRES} grid. It changes only when that grid point
 * does.
 */
export function streetMapRegion(centre: StreetMapPoint): StreetMapRegion {
  const east = onGrid(centre.east, STREET_MAP_MARGIN_METRES);
  const south = onGrid(centre.south, STREET_MAP_MARGIN_METRES);
  const across = REACH_ACROSS_METRES;
  const tall = STREET_MAP_METRES / 2 + STREET_MAP_MARGIN_METRES;
  return { left: east - across, top: south - tall, width: 2 * across, height: 2 * tall };
}

/** A subpath through `points`, `M` and then `L`. */
function subpath(points: readonly number[], closed: boolean): string {
  const pairs: string[] = [];
  for (let index = 0; index + 1 < points.length; index += 2) {
    pairs.push(`${coordinate(points[index] as number)} ${coordinate(points[index + 1] as number)}`);
  }
  return `M${pairs[0] as string}L${pairs.slice(1).join(' ')}${closed ? 'Z' : ''}`;
}

/**
 * A line's runs of segments that reach into the region, as subpaths. A
 * segment is kept whole when its bounds touch the region and dropped when
 * they do not, so a kept segment can end off the region; it is drawn beyond
 * the box either way, and the box clips it.
 */
function clippedLine(shape: Shape, region: StreetMapRegion, into: string[]): void {
  const right = region.left + region.width;
  const bottom = region.top + region.height;
  const { points } = shape;
  let run: number[] = [];
  const flush = (): void => {
    if (run.length >= 4) into.push(subpath(run, false));
    run = [];
  };
  for (let index = 0; index + 3 < points.length; index += 2) {
    const e0 = points[index] as number;
    const s0 = points[index + 1] as number;
    const e1 = points[index + 2] as number;
    const s1 = points[index + 3] as number;
    const touches =
      Math.max(e0, e1) >= region.left &&
      Math.min(e0, e1) <= right &&
      Math.max(s0, s1) >= region.top &&
      Math.min(s0, s1) <= bottom;
    if (!touches) {
      flush();
      continue;
    }
    if (run.length === 0) run.push(e0, s0);
    run.push(e1, s1);
  }
  flush();
}

/**
 * A ring cut to the region (Sutherland–Hodgman, one side of the rectangle at
 * a time), as a closed subpath. The cut runs along the region's edge, which
 * is beyond the box, so it is never seen; a ring keeps its winding, so a lake's
 * island stays dry.
 */
function clippedRing(shape: Shape, region: StreetMapRegion, into: string[]): void {
  const right = region.left + region.width;
  const bottom = region.top + region.height;
  const sides: readonly ((east: number, south: number) => number)[] = [
    (east) => east - region.left,
    (east) => right - east,
    (_, south) => south - region.top,
    (_, south) => bottom - south,
  ];
  let ring = Array.from(shape.points);
  for (const inside of sides) {
    const kept: number[] = [];
    const count = ring.length / 2;
    for (let index = 0; index < count; index += 1) {
      const e0 = ring[index * 2] as number;
      const s0 = ring[index * 2 + 1] as number;
      const next = (index + 1) % count;
      const e1 = ring[next * 2] as number;
      const s1 = ring[next * 2 + 1] as number;
      const a = inside(e0, s0);
      const b = inside(e1, s1);
      if (a >= 0) kept.push(e0, s0);
      if (a >= 0 !== b >= 0) {
        const t = a / (a - b);
        kept.push(e0 + (e1 - e0) * t, s0 + (s1 - s0) * t);
      }
    }
    ring = kept;
    if (ring.length < 6) return;
  }
  into.push(subpath(ring, true));
}

/** The cells either side of a cell that can hold a shape reaching into a region. */
const CELL_REACH = Math.ceil(SHAPE_REACH_METRES / STREET_MAP_CELL_METRES);

/**
 * Every layer's shapes in the region, each layer joined into one `d` — and
 * nothing off it (#2380): a line's segments off the region are dropped and a
 * ring is cut to it, so what the sheet holds is bounded by the region's area
 * rather than by the cells round it.
 */
export function streetMapLayers(index: StreetMapIndex, region: StreetMapRegion): StreetMapLayers {
  const found: Record<Layer, string[]> = { land: [], water: [], streets: [], paths: [], route: [] };
  const right = region.left + region.width;
  const bottom = region.top + region.height;
  const first = streetMapCell({ east: region.left, south: region.top });
  const last = streetMapCell({ east: right, south: bottom });
  for (let column = first.column - CELL_REACH; column <= last.column + CELL_REACH; column += 1) {
    for (let row = first.row - CELL_REACH; row <= last.row + CELL_REACH; row += 1) {
      const cell = index.cells.get(cellKey(column, row));
      if (cell === undefined) continue;
      for (const layer of LAYERS) {
        for (const shape of cell[layer]) {
          const off =
            shape.right < region.left ||
            shape.left > right ||
            shape.bottom < region.top ||
            shape.top > bottom;
          if (off) continue;
          if (RINGS.has(layer)) clippedRing(shape, region, found[layer]);
          else clippedLine(shape, region, found[layer]);
        }
      }
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
  return {
    east: onGrid(-local.x, STREET_MAP_STEP_METRES),
    south: onGrid(-local.z, STREET_MAP_STEP_METRES),
  };
}

/** A region as a `viewBox`. */
export function streetMapViewBox(region: StreetMapRegion): string {
  return [region.left, region.top, region.width, region.height].map(String).join(' ');
}

/** A number to a thousandth, with its unit. Never `-0`. */
function fixed(value: number, unit: string): string {
  return `${String(Math.round(value * 1000) / 1000 + 0)}${unit}`;
}

/**
 * How the sheet is placed so that `centre` is in the middle of the box —
 * #2380. Its height is the region's at the box's scale, where the box's
 * shorter side is {@link STREET_MAP_METRES}: `cqmin`, a hundredth of that side
 * (`theme.css` makes the box a size container). Its width follows from its
 * `viewBox`, and `theme.css` puts its top left corner in the middle of the
 * box; this translates it back by the centre's place on it, in percentages of
 * the sheet's own size (a percentage to a thousandth is a twentieth of a
 * metre), so no pixel is measured. Only the `transform` changes as the rider
 * moves, and only once per {@link STREET_MAP_STEP_METRES}.
 */
export function streetMapSheetStyle(
  region: StreetMapRegion,
  centre: StreetMapPoint,
): { readonly height: string; readonly transform: string } {
  const across = ((centre.east - region.left) / region.width) * 100;
  const down = ((centre.south - region.top) / region.height) * 100;
  return {
    height: fixed((region.height / STREET_MAP_METRES) * 100, 'cqmin'),
    transform: `translate(${fixed(-across, '%')}, ${fixed(-down, '%')})`,
  };
}
