// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The mapped footways DRAWN — #2972, from the mapped-features audit of
 * 2026-11-20 and the owner's ruling of 2026-11-15 (draw everything that is
 * marked). `footways.ts` (#1551) decodes the corridor's footways, sidewalks,
 * cycleways, park paths and steps and draws nothing of its own; this file
 * makes them surfaces on the ground, and the mapped crossings zebra stripes on
 * the road.
 *
 * ## What is drawn
 *
 * - **A ribbon per footway**, {@link FOOTWAY_SURFACE_WIDTHS} wide, along
 *   `footways.ts` §`footwayNetwork`'s 2 m lines (every footway but a
 *   crossing, clipped to the corridor and the land that was read), by kind
 *   ({@link surfaceKindOf}): a paved footway, a cycleway, a park path or
 *   steps, each its own colour ({@link FOOTWAY_SURFACE_COLOURS}), steps in
 *   alternating treads every {@link STEP_TREAD_METRES}. It lies
 *   {@link FOOTWAY_LIFT_METRES} over the ground (`landform.ts`
 *   §`terrainHeightAt`, read as `people.ts` §`groundOf` reads it), as a side
 *   road does.
 * - **A zebra** wherever a mapped `crossing` crosses the drawn road
 *   ({@link zebraAlongs}): {@link ZEBRA_STRIPES} stripes along the road, laid
 *   across the carriageway, just over the centre line's marks.
 *
 * ## ⚠️ Never on the carriageway, a side road, the water or a pavement
 *
 * A ribbon point is kept only where its middle is
 * {@link ROAD_HALF_WIDTH_METRES} and its own half-width from every stretch of
 * the drawn road AND from every arm of the corridor's mapped junctions
 * (`people.ts` §`besideSideRoads`, the rule #1619 keeps people off them by),
 * so neither edge is ever over a carriageway; nowhere on mapped water (a
 * footbridge is not drawn, and nor is a path under a lake the map draws); and
 * — **#1620's rule** — nowhere a drawn village pavement already lies
 * (`people.ts` §`onPavement`, tested at the middle and both edges): the
 * pavement is the surface there, and a second would be the doubled one #1620
 * took out of the walkers. A segment is drawn only between two kept points.
 *
 * ## The budget
 *
 * Built once a corridor as plan-only chunks of at most
 * {@link FOOTWAY_CHUNK_SEGMENTS} segments; a chunk's heights and clearances are
 * read the first time it comes within {@link FOOTWAY_DRAW_METRES} of the
 * camera, and never again. A frame draws the chunks and zebras within that
 * reach, nearest first, up to {@link FOOTWAY_FRAME_TRIANGLES} — one mesh and
 * one draw call (`three-renderer.ts` §`FootwayBelt`), on the ground as the
 * side roads are, so outside `realistic-budget.ts` §`REALISTIC_FRAME_TRIANGLES`
 * by that constant's own rule for the corridor and the terrain.
 *
 * ⚠️ **Location data** (ADR 0004 D): nothing here formats a message. It reads
 * a footway's `kind`, `kindDetail` and line, and never a name.
 *
 * Pure, cached on the corridor object, and names no rendering library.
 */

import type { RouteProfile } from '@onyourleft/domain';
import type { PathFeature } from '@onyourleft/map-features';

import { linearColour, mappedJunctions } from './cross-streets';
import { FOOTWAY_MAX_LINES, FOOTWAY_MAX_METRES, footwayNetwork, isFootway } from './footways';
import type { LandClassMask } from './land-class';
import { terrainHeightAt } from './landform';
import {
  armLines,
  besideSideRoads,
  groundOf,
  onPavement,
  pavementBands,
  type PavementBands,
  type RoadDistance,
} from './people';
import { distanceToDrawnRoad, nearestOnDrawnRoad } from './road-grid';
import type { VillageStreet } from './streets';
import {
  CENTRE_LINE_LIFT_METRES,
  drawnRoadFrame,
  MARKING_COLOUR,
  ROAD_WIDTH_METRES,
  type CorridorOrigin,
} from './terrain';
import type { WorldCorridor } from './world-data/corridor';

/** Half the carriageway, in metres: **3.5**. */
export const ROAD_HALF_WIDTH_METRES = ROAD_WIDTH_METRES / 2;

/** What a drawn footway surface is. */
export type FootwaySurfaceKind = 'footway' | 'cycleway' | 'park-path' | 'steps' | 'crossing';

/** The kinds drawn as a ribbon along the footway: every kind but a crossing. */
export type FootwayRibbonKind = Exclude<FootwaySurfaceKind, 'crossing'>;

/**
 * How wide each ribbon is drawn, in metres: a paved footway **2**, a cycleway
 * **2.5**, a park path **1.8** and steps **2**.
 */
export const FOOTWAY_SURFACE_WIDTHS: Readonly<Record<FootwayRibbonKind, number>> = {
  footway: 2,
  cycleway: 2.5,
  'park-path': 1.8,
  steps: 2,
};

/**
 * Each kind's colour, packed sRGB: a paved footway light concrete, a cycleway
 * a red asphalt (the commonest marked cycleway surface), a park path fine
 * gravel, steps stone and a crossing the road's own marking paint.
 */
export const FOOTWAY_SURFACE_COLOURS: Readonly<Record<FootwaySurfaceKind, number>> = {
  footway: 0xa19e97,
  cycleway: 0x8c5a4f,
  'park-path': 0xb8a684,
  steps: 0xb3afa7,
  crossing: MARKING_COLOUR,
};

/** The darker of two alternating step treads, packed sRGB: **0x86827b**. */
export const STEP_SHADE_COLOUR = 0x86827b;

/** How deep one step's tread is drawn, in metres: **0.5**. */
export const STEP_TREAD_METRES = 0.5;

/** How far above the ground a ribbon lies, in metres: **0.04**, a side road's lift and a little. */
export const FOOTWAY_LIFT_METRES = 0.04;

/** How many segments one chunk of a footway holds at most: **32**, 64 m of a 2 m line. */
export const FOOTWAY_CHUNK_SEGMENTS = 32;

/** How far from the camera a chunk or a zebra is drawn, in metres: **200**. */
export const FOOTWAY_DRAW_METRES = 200;

/** The most triangles a frame's footways and zebras draw: **16 384**, nearest first. */
export const FOOTWAY_FRAME_TRIANGLES = 16_384;

/** How many stripes a zebra has across the carriageway: **7**. */
export const ZEBRA_STRIPES = 7;

/** How wide one stripe is, across the road, in metres: **0.5**, with a 0.5 m gap. */
export const ZEBRA_STRIPE_METRES = 0.5;

/** How long a zebra is, along the road, in metres: **3**. */
export const ZEBRA_LENGTH_METRES = 3;

/** How far above the road a zebra lies, in metres: just over the centre line's marks. */
export const ZEBRA_LIFT_METRES = CENTRE_LINE_LIFT_METRES + 0.005;

/** Two crossings nearer than this along the road, in metres, are one zebra: **6**. */
export const ZEBRA_MERGE_METRES = 2 * ZEBRA_LENGTH_METRES;

/** One drawn surface: a chunk of a footway's ribbon or one zebra. */
export interface FootwayPiece {
  readonly kind: FootwaySurfaceKind;
  /** `x, y, z` a vertex, in the corridor frame. */
  readonly positions: Float32Array;
  /** Linear `r, g, b` a vertex. */
  readonly colours: Float32Array;
  readonly indices: Uint32Array;
}

/** No footways: a frame with no corridor, or with the lever off. */
export const NO_FOOTWAYS: readonly FootwayPiece[] = [];

/**
 * What a footway is drawn as, by its `kind_detail` and the land at its middle:
 * steps and cycleways by their tags; a sidewalk or a pedestrian way paved; a
 * mapped `footway` paved but in a park or a wood, where it is a park path; and
 * a plain path (`path`, or no `kind_detail`) a park path but on built-up land,
 * where it is paved.
 */
export function surfaceKindOf(
  detail: string,
  land: LandClassMask,
  x: number,
  z: number,
): FootwayRibbonKind {
  if (detail === 'steps') return 'steps';
  if (detail === 'cycleway') return 'cycleway';
  if (detail === 'sidewalk' || detail === 'pedestrian') return 'footway';
  const here = land.classAt(x, z);
  if (detail === 'footway') return here === 'park' || here === 'wood' ? 'park-path' : 'footway';
  return here === 'built-up' ? 'footway' : 'park-path';
}

/** One chunk of a footway: its plan, and — once read — its ground. */
interface Chunk {
  readonly kind: FootwayRibbonKind;
  /** `x, z` a point, `FOOTWAY_CHUNK_SEGMENTS + 1` at most. */
  readonly points: Float32Array;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** The most triangles it can draw: what the frame's cap counts. */
  readonly triangles: number;
  ground?: ChunkGround;
  /** The piece last drawn, and the streets it was cut against. */
  cut?: { readonly streets: readonly VillageStreet[]; readonly piece: FootwayPiece | undefined };
}

/** A chunk's edges and heights, read once. */
interface ChunkGround {
  /** `x, y, z` a point: the left edge, then the right. */
  readonly left: Float32Array;
  readonly right: Float32Array;
  /** 1 where a point is off the road, the side roads and the water, and on ground. */
  readonly kept: Uint8Array;
}

/** One zebra, built once a corridor. */
interface Zebra {
  readonly piece: FootwayPiece;
  readonly x: number;
  readonly z: number;
  readonly triangles: number;
}

/** A corridor's surfaces, as {@link footwaysInView} reads them. */
interface Surfaces {
  readonly profile: RouteProfile;
  readonly land: LandClassMask;
  readonly chunks: readonly Chunk[];
  readonly zebras: readonly Zebra[];
  /** The road and the corridor's side roads, as the clearance reads them. */
  readonly road: RoadDistance;
}

const built = new WeakMap<WorldCorridor, Surfaces[]>();

/** The triangles one segment of `kind` draws at most, `metres` long. */
function segmentTriangles(kind: FootwayRibbonKind, metres: number): number {
  return kind === 'steps' ? 2 * Math.max(1, Math.round(metres / STEP_TREAD_METRES)) : 2;
}

/** `line` cut into chunks of at most {@link FOOTWAY_CHUNK_SEGMENTS}, each sharing its end with the next. */
function chunksOf(line: Float32Array, kind: FootwayRibbonKind): Chunk[] {
  const out: Chunk[] = [];
  const points = line.length / 2;
  const half = FOOTWAY_SURFACE_WIDTHS[kind] / 2;
  for (let first = 0; first + 1 < points; first += FOOTWAY_CHUNK_SEGMENTS) {
    const last = Math.min(points - 1, first + FOOTWAY_CHUNK_SEGMENTS);
    const slice = line.slice(first * 2, last * 2 + 2);
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    let triangles = 0;
    for (let at = 0; at + 1 < slice.length; at += 2) {
      const x = slice[at] as number;
      const z = slice[at + 1] as number;
      minX = Math.min(minX, x - half);
      maxX = Math.max(maxX, x + half);
      minZ = Math.min(minZ, z - half);
      maxZ = Math.max(maxZ, z + half);
      if (at >= 2) {
        triangles += segmentTriangles(
          kind,
          Math.hypot(x - (slice[at - 2] as number), z - (slice[at - 1] as number)),
        );
      }
    }
    out.push({ kind, points: slice, minX, maxX, minZ, maxZ, triangles });
  }
  return out;
}

/** The corridor's surfaces, built once a corridor, profile and mask. */
function surfacesOf(
  corridor: WorldCorridor,
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  land: LandClassMask,
): Surfaces {
  const cached = built.get(corridor) ?? [];
  const found = cached.find((entry) => entry.profile === profile && entry.land === land);
  if (found !== undefined) return found;
  const network = footwayNetwork(corridor, profile, origin, {
    maxLines: FOOTWAY_MAX_LINES,
    maxMetres: FOOTWAY_MAX_METRES,
  });
  const chunks: Chunk[] = [];
  network.lines.forEach((line, index) => {
    const middle = Math.floor(line.length / 4) * 2;
    const kind = surfaceKindOf(
      network.details[index] ?? '',
      land,
      line[middle] as number,
      line[middle + 1] as number,
    );
    chunks.push(...chunksOf(line, kind));
  });
  const road = besideSideRoads(
    (x, z, reach) => distanceToDrawnRoad(profile, origin, x, z, reach),
    armLines(mappedJunctions(corridor, profile, origin, seed, land)),
  );
  const zebras = zebraAlongs(corridor.paths, profile, origin).map((along) =>
    zebraAt(profile, origin, seed, land, along),
  );
  const surfaces: Surfaces = {
    profile,
    land,
    chunks,
    zebras: zebras.filter((zebra): zebra is Zebra => zebra !== undefined),
    road,
  };
  cached.push(surfaces);
  built.set(corridor, cached);
  return surfaces;
}

// --- Zebras ---------------------------------------------------------------

/** How far apart a crossing's line is read, in metres: **1**. */
const CROSSING_STEP_METRES = 1;

/**
 * A crossing longer than this, in metres (**100**), is not read: a mapped
 * crossing spans a carriageway, and reading a hostile tile's kilometre-long
 * "crossing" a metre at a time would be work without bound.
 */
export const CROSSING_MAX_METRES = 100;

/** How long a line is, in metres; `+Infinity` with a coordinate that is not finite. */
function lineMetres(line: Float32Array): number {
  let total = 0;
  for (let at = 0; at + 3 < line.length; at += 2) {
    total += Math.hypot(
      (line[at + 2] as number) - (line[at] as number),
      (line[at + 3] as number) - (line[at + 1] as number),
    );
  }
  return Number.isFinite(total) ? total : Number.POSITIVE_INFINITY;
}

/**
 * The route distances at which a mapped `crossing` crosses the drawn road:
 * wherever two consecutive points of its line, each within the carriageway and
 * a few metres of it, lie on opposite sides of the same stretch. Two within
 * {@link ZEBRA_MERGE_METRES} of each other are one, so a crossing mapped as two
 * ways is one zebra. Sorted along the route.
 */
export function zebraAlongs(
  paths: readonly PathFeature[],
  profile: RouteProfile,
  origin: CorridorOrigin,
): number[] {
  const reach = ROAD_HALF_WIDTH_METRES + 4;
  const alongs: number[] = [];
  for (const path of paths) {
    if (path.kindDetail !== 'crossing' || !isFootway(path)) continue;
    if (lineMetres(path.line) > CROSSING_MAX_METRES) continue;
    const line = path.line;
    let before: { along: number; lateral: number } | undefined;
    for (let at = 0; at + 3 < line.length; at += 2) {
      const ax = line[at] as number;
      const az = line[at + 1] as number;
      const bx = line[at + 2] as number;
      const bz = line[at + 3] as number;
      if (![ax, az, bx, bz].every(Number.isFinite)) break;
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / CROSSING_STEP_METRES));
      for (let step = at === 0 ? 0 : 1; step <= steps; step += 1) {
        const x = ax + ((bx - ax) * step) / steps;
        const z = az + ((bz - az) * step) / steps;
        const near = nearestOnDrawnRoad(profile, origin, x, z, reach);
        if (
          near !== undefined &&
          before !== undefined &&
          Math.sign(near.lateral) !== Math.sign(before.lateral) &&
          Math.abs(near.along - before.along) < ZEBRA_LENGTH_METRES
        ) {
          const share =
            Math.abs(before.lateral) / (Math.abs(before.lateral) + Math.abs(near.lateral));
          alongs.push(before.along + (near.along - before.along) * (share > 0 ? share : 0));
        }
        before = near;
      }
    }
  }
  alongs.sort((a, b) => a - b);
  const merged: number[] = [];
  for (const along of alongs) {
    const last = merged[merged.length - 1];
    if (last !== undefined && along - last < ZEBRA_MERGE_METRES) continue;
    merged.push(along);
  }
  return merged;
}

/** The zebra at `along`, its stripes laid across the drawn road. */
function zebraAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  land: LandClassMask,
  along: number,
): Zebra | undefined {
  const start = Math.max(0, along - ZEBRA_LENGTH_METRES / 2);
  const end = Math.min(profile.totalDistance, along + ZEBRA_LENGTH_METRES / 2);
  const from = drawnRoadFrame(profile, origin, start);
  const to = drawnRoadFrame(profile, origin, end);
  const middle = drawnRoadFrame(profile, origin, along);
  if (from === undefined || to === undefined || middle === undefined) return undefined;
  const fromY = terrainHeightAt(profile, origin, seed, start, 0, land) + ZEBRA_LIFT_METRES;
  const toY = terrainHeightAt(profile, origin, seed, end, 0, land) + ZEBRA_LIFT_METRES;
  const colour = linearColour(FOOTWAY_SURFACE_COLOURS.crossing);
  const positions: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  const pitch = 2 * ZEBRA_STRIPE_METRES;
  for (let stripe = 0; stripe < ZEBRA_STRIPES; stripe += 1) {
    const centre = (stripe - (ZEBRA_STRIPES - 1) / 2) * pitch;
    const first = positions.length / 3;
    for (const [frame, y] of [
      [from, fromY],
      [to, toY],
    ] as const) {
      for (const lateral of [centre - ZEBRA_STRIPE_METRES / 2, centre + ZEBRA_STRIPE_METRES / 2]) {
        positions.push(frame.x + frame.normalX * lateral, y, frame.z + frame.normalZ * lateral);
        colours.push(colour[0], colour[1], colour[2]);
      }
    }
    quad(indices, first);
  }
  return {
    piece: {
      kind: 'crossing',
      positions: Float32Array.from(positions),
      colours: Float32Array.from(colours),
      indices: Uint32Array.from(indices),
    },
    x: middle.x,
    z: middle.z,
    triangles: ZEBRA_STRIPES * 2,
  };
}

/**
 * Two triangles over four vertices from `first`: the near pair, then the far
 * pair, each left then right — wound so the face looks up.
 */
function quad(indices: number[], first: number): void {
  indices.push(first, first + 1, first + 2, first + 1, first + 3, first + 2);
}

// --- Ribbons --------------------------------------------------------------

/** `chunk`'s edges, heights and clearances, read the first time it is wanted. */
function groundOfChunk(
  chunk: Chunk,
  surfaces: Surfaces,
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
): ChunkGround {
  if (chunk.ground !== undefined) return chunk.ground;
  const points = chunk.points;
  const count = points.length / 2;
  const half = FOOTWAY_SURFACE_WIDTHS[chunk.kind] / 2;
  const clearance = ROAD_HALF_WIDTH_METRES + half;
  const height = groundOf(profile, origin, seed, surfaces.land);
  const left = new Float32Array(count * 3);
  const right = new Float32Array(count * 3);
  const kept = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    const x = points[index * 2] as number;
    const z = points[index * 2 + 1] as number;
    // The line's heading here, over its neighbours.
    const before = Math.max(0, index - 1);
    const after = Math.min(count - 1, index + 1);
    const dx = (points[after * 2] as number) - (points[before * 2] as number);
    const dz = (points[after * 2 + 1] as number) - (points[before * 2 + 1] as number);
    const length = Math.hypot(dx, dz);
    const nx = length > 0 ? -dz / length : 0;
    const nz = length > 0 ? dx / length : 0;
    const lx = x - nx * half;
    const lz = z - nz * half;
    const rx = x + nx * half;
    const rz = z + nz * half;
    const ly = height(lx, lz);
    const ry = height(rx, rz);
    left.set([lx, ly + FOOTWAY_LIFT_METRES, lz], index * 3);
    right.set([rx, ry + FOOTWAY_LIFT_METRES, rz], index * 3);
    const clear =
      length > 0 &&
      Number.isFinite(ly) &&
      Number.isFinite(ry) &&
      surfaces.road(x, z, clearance + 1) >= clearance &&
      surfaces.land.classAt(x, z) !== 'water';
    kept[index] = clear ? 1 : 0;
  }
  chunk.ground = { left, right, kept };
  return chunk.ground;
}

/** Whether a chunk's box meets a street's pavements' box. */
function meets(chunk: Chunk, bands: PavementBands): boolean {
  return (
    chunk.maxX >= bands.minX &&
    chunk.minX <= bands.maxX &&
    chunk.maxZ >= bands.minZ &&
    chunk.minZ <= bands.maxZ
  );
}

/** `chunk` drawn, cut wherever it is on one of `streets`' pavements (#1620); `undefined` if nothing is left. */
function pieceOf(
  chunk: Chunk,
  ground: ChunkGround,
  streets: readonly VillageStreet[],
): FootwayPiece | undefined {
  const met = streets.filter((street) => meets(chunk, pavementBands(street)));
  const bands = met.map(pavementBands);
  const known = chunk.cut;
  if (
    known !== undefined &&
    known.streets.length === met.length &&
    known.streets.every((street, index) => street === met[index])
  ) {
    return known.piece;
  }
  const count = chunk.points.length / 2;
  const on = new Uint8Array(count);
  if (bands.length > 0) {
    for (let index = 0; index < count; index += 1) {
      const x = chunk.points[index * 2] as number;
      const z = chunk.points[index * 2 + 1] as number;
      const l = index * 3;
      on[index] =
        onPavement(bands, x, z) ||
        onPavement(bands, ground.left[l] as number, ground.left[l + 2] as number) ||
        onPavement(bands, ground.right[l] as number, ground.right[l + 2] as number)
          ? 1
          : 0;
    }
  }
  const positions: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  const surface = linearColour(FOOTWAY_SURFACE_COLOURS[chunk.kind]);
  const shade = linearColour(STEP_SHADE_COLOUR);
  const corner = (edge: Float32Array, index: number, t: number, nextIndex: number): number[] => {
    const a = index * 3;
    const b = nextIndex * 3;
    return [0, 1, 2].map(
      (axis) =>
        (edge[a + axis] as number) + ((edge[b + axis] as number) - (edge[a + axis] as number)) * t,
    );
  };
  for (let index = 0; index + 1 < count; index += 1) {
    const next = index + 1;
    if (ground.kept[index] !== 1 || ground.kept[next] !== 1 || on[index] === 1 || on[next] === 1)
      continue;
    const metres = Math.hypot(
      (chunk.points[next * 2] as number) - (chunk.points[index * 2] as number),
      (chunk.points[next * 2 + 1] as number) - (chunk.points[index * 2 + 1] as number),
    );
    const treads = chunk.kind === 'steps' ? segmentTriangles('steps', metres) / 2 : 1;
    for (let tread = 0; tread < treads; tread += 1) {
      const colour = chunk.kind === 'steps' && tread % 2 === 1 ? shade : surface;
      const first = positions.length / 3;
      for (const t of [tread / treads, (tread + 1) / treads]) {
        positions.push(
          ...corner(ground.left, index, t, next),
          ...corner(ground.right, index, t, next),
        );
        colours.push(...colour, ...colour);
      }
      quad(indices, first);
    }
  }
  const piece =
    indices.length === 0
      ? undefined
      : {
          kind: chunk.kind,
          positions: Float32Array.from(positions),
          colours: Float32Array.from(colours),
          indices: Uint32Array.from(indices),
        };
  chunk.cut = { streets: met, piece };
  return piece;
}

/** How far `(x, z)` is from a box, in plan: 0 inside it. */
function boxDistance(
  box: {
    readonly minX: number;
    readonly maxX: number;
    readonly minZ: number;
    readonly maxZ: number;
  },
  x: number,
  z: number,
): number {
  const dx = Math.max(box.minX - x, 0, x - box.maxX);
  const dz = Math.max(box.minZ - z, 0, z - box.maxZ);
  return Math.hypot(dx, dz);
}

/**
 * The footway surfaces and zebras a frame draws round the camera at
 * `(cameraX, cameraZ)`: every chunk and zebra within
 * {@link FOOTWAY_DRAW_METRES}, nearest first up to
 * {@link FOOTWAY_FRAME_TRIANGLES}, each chunk cut off `streets`' pavements
 * (#1620). Returned in the corridor's own order — the zebras, then the chunks
 * — and as the same objects while the same are in reach, so the renderer
 * rebuilds its mesh only when the set changes. @see the header
 */
export function footwaysInView(
  corridor: WorldCorridor,
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  land: LandClassMask,
  cameraX: number,
  cameraZ: number,
  streets: readonly VillageStreet[],
): readonly FootwayPiece[] {
  // #3107: a corridor with no mapped footway — an open-world ride's, which
  // carries streets alone — has no surface and no zebra, and is not read for
  // its junctions to keep them off: that reading is every street of it.
  if (corridor.paths.length === 0) return NO_FOOTWAYS;
  const surfaces = surfacesOf(corridor, profile, origin, seed, land);
  const candidates: { order: number; distance: number; triangles: number }[] = [];
  surfaces.zebras.forEach((zebra, order) => {
    const distance = Math.hypot(zebra.x - cameraX, zebra.z - cameraZ);
    if (distance <= FOOTWAY_DRAW_METRES)
      candidates.push({ order, distance, triangles: zebra.triangles });
  });
  const zebraCount = surfaces.zebras.length;
  surfaces.chunks.forEach((chunk, index) => {
    const distance = boxDistance(chunk, cameraX, cameraZ);
    if (distance <= FOOTWAY_DRAW_METRES) {
      candidates.push({ order: zebraCount + index, distance, triangles: chunk.triangles });
    }
  });
  if (candidates.length === 0) return NO_FOOTWAYS;
  candidates.sort((a, b) => a.distance - b.distance || a.order - b.order);
  const chosen: number[] = [];
  let triangles = 0;
  for (const candidate of candidates) {
    if (triangles + candidate.triangles > FOOTWAY_FRAME_TRIANGLES) continue;
    triangles += candidate.triangles;
    chosen.push(candidate.order);
  }
  chosen.sort((a, b) => a - b);
  const pieces: FootwayPiece[] = [];
  for (const order of chosen) {
    if (order < zebraCount) {
      pieces.push((surfaces.zebras[order] as Zebra).piece);
      continue;
    }
    const chunk = surfaces.chunks[order - zebraCount] as Chunk;
    const piece = pieceOf(chunk, groundOfChunk(chunk, surfaces, profile, origin, seed), streets);
    if (piece !== undefined) pieces.push(piece);
  }
  return pieces;
}

/**
 * How many triangles `pieces` draw.
 *
 * @test-facing read by `footway-surfaces.test.ts` and `realistic-textures.test.ts`, which
 * hold the frame's cap and the belt's mesh to it; the renderer counts its own buffers
 */
export function footwayTriangles(pieces: readonly FootwayPiece[]): number {
  return pieces.reduce((sum, piece) => sum + piece.indices.length / 3, 0);
}
