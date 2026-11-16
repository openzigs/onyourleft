// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the ground is, where map data was read — #1546, ADR 0054 D-4.2 and D-5.
 *
 * One mask per ride, built once at the press from the route's corridor
 * (`world-data/corridor.ts`, #1539): a sparse grid of
 * {@link LAND_CLASS_CELL_METRES} cells in chunks of
 * {@link LAND_CLASS_CHUNK_CELLS}², each chunk one `Uint8Array` in a `Map`
 * keyed by an integer chunk index. Every placement rule of phase B reads it —
 * `settlements.ts` (no procedural site on mapped land, no field boundary off
 * field ground — {@link fieldGround}), `scatter.ts` (no tree, shrub or rock on built-up
 * land or water) and `streets.ts` (no pavement for a site that is not built).
 * Since #1547 it also carries how far each cell is from built-up land
 * ({@link LandClassMask.builtUpDistances}), which `landform.ts` levels a mapped
 * town's ground by.
 *
 * ⚠️ **Read every frame, on the thread GATT notifications arrive on** (#240
 * NFR-2, #469), so {@link LandClassMask.classAt} is one `Map` lookup and one
 * typed-array index, and allocates nothing: the class is one of seven string
 * constants, the key is a small integer.
 *
 * ## The classes
 *
 * From Protomaps v4's `landuse.kind` and `water.kind` —
 * {@link LAND_CLASS_OF_KIND}. Where polygons overlap the class with the higher
 * precedence wins: **water > wood > park > built-up > farmland > other**, so a
 * wood drawn inside a residential block is a wood. A covered cell no polygon
 * reaches is `other`; a cell outside every covered tile is `unknown`, and there
 * the procedural world decides (P-8). An unknown `kind` is `other`, never
 * `built-up`.
 *
 * ## Bounded
 *
 * At most {@link LAND_CLASS_MAX_BYTES} a route. A corridor that would need
 * more is built for its first chunks in route order and the rest is `unknown`,
 * which is the procedural world — never a refusal.
 *
 * ## Inferred built-up land (#2684, ADR 0070)
 *
 * Many US suburbs map neither footprints nor `landuse=residential`: a dense
 * grid of residential streets with nothing drawn between them. Since #2684 a
 * covered cell no land-use polygon reaches is `built-up` where it is within
 * {@link INFERRED_REACH_METRES} of a residential street and the street
 * density about it is a suburb's ({@link INFERRED_MIN_STREET_DENSITY}) —
 * {@link inferBuiltUp}'s rule. Every reader then treats it as mapped built-up
 * land: lots stand there, field boundaries and trees do not.
 *
 * Names no rendering library and no coordinate in any string: it formats none.
 */

import {
  rasterise,
  type Box,
  type GridSpec,
  type LandUseFeature,
  type PlaceFeature,
} from '@onyourleft/map-features';

import type { WorldCorridor } from './world-data/corridor';

export type LandClass = 'unknown' | 'water' | 'wood' | 'park' | 'built-up' | 'farmland' | 'other';

/**
 * Every `landuse` kind this reads, and its class — #1546's table. A `water`
 * feature is `water` whatever its kind. Any other kind is `other`
 * ({@link landClassOfKind}).
 *
 * #1630: spike 0031 (`docs/spikes/0031-land-use-kinds-and-urban-density-in-our-archive.md`)
 * decoded eight corridors of our archive and removed the 13 kinds it counted
 * zero times in every one that no rule of Protomaps' `Landuse.java` emits:
 * `retail`, `neighbourhood` (Protomaps writes `place=neighbourhood` as
 * `other`), `marina`, `protected_area`, `townhall`, `library`,
 * `post_office`, `supermarket`, `grocery`, `hotel`, `stadium`, and `farmyard`
 * and `orchard` (written as `farmland`). Each now reads as `other`. A kind
 * unseen in the spike's corridors that a rule does emit — `forest`,
 * `national_park`, `zoo`, `military` — stays.
 */
export const LAND_CLASS_OF_KIND: Readonly<Record<string, Exclude<LandClass, 'unknown'>>> =
  Object.freeze({
    wetland: 'water',
    wood: 'wood',
    forest: 'wood',
    scrub: 'wood',
    park: 'park',
    garden: 'park',
    golf_course: 'park',
    nature_reserve: 'park',
    national_park: 'park',
    recreation_ground: 'park',
    cemetery: 'park',
    zoo: 'park',
    dog_park: 'park',
    playground: 'park',
    pitch: 'park',
    grass: 'park',
    residential: 'built-up',
    commercial: 'built-up',
    industrial: 'built-up',
    school: 'built-up',
    college: 'built-up',
    university: 'built-up',
    hospital: 'built-up',
    pedestrian: 'built-up',
    railway: 'built-up',
    military: 'built-up',
    farmland: 'farmland',
    meadow: 'farmland',
  });

/** One cell's side, in metres. */
export const LAND_CLASS_CELL_METRES = 5;

/** One chunk's side, in cells: 320 m chunks. */
export const LAND_CLASS_CHUNK_CELLS = 64;

/** The most a route's mask holds: 8 MiB. */
export const LAND_CLASS_MAX_BYTES = 8 * 1024 * 1024;

/**
 * The most edge-by-row steps the polygon pass may take, so a hostile or very
 * dense archive cannot freeze the press: a polygon's cost is its vertices times
 * the rows it crosses on each existing chunk. Past it the rest of the polygons
 * are not painted and their cells keep the class they hold (`other`), the same
 * answer as a tile with no land-use data.
 */
export const LAND_CLASS_MAX_WORK = 20_000_000;

/**
 * The streets a cell of inferred built-up land is near — #2684, ADR 0070
 * D-1: `kind_detail` `residential`, `living_street` or `service`, whatever
 * the `kind` ({@link StreetFeature}). A tunnel is not one: nothing beside it
 * faces it. Its metres still count to {@link INFERRED_DENSITY_STREET_DETAILS}'
 * density, which measures the street network, not what faces it.
 */
export const INFERRED_NEAR_STREET_DETAILS: ReadonlySet<string> = new Set([
  'residential',
  'living_street',
  'service',
]);

/**
 * The streets the density is measured over — ADR 0070 D-1:
 * `residential` and `living_street` only. A `service` road is near enough to
 * stand a house by, and is not counted: a car park's aisles and a mall's
 * delivery lanes are `service` too, and would make a suburb of them.
 */
export const INFERRED_DENSITY_STREET_DETAILS: ReadonlySet<string> = new Set([
  'residential',
  'living_street',
]);

/** How near a counted street an inferred cell's centre is, in metres: **60**. */
export const INFERRED_REACH_METRES = 60;

/**
 * The side of one cell of the street-density grid, in metres: **80**. The
 * density at a cell is the street metres of its {@link INFERRED_DENSITY_WINDOW_CELLS}
 * neighbourhood over that neighbourhood's area.
 */
export const INFERRED_DENSITY_CELL_METRES = 80;

/**
 * Density cells either side of a cell's own that its density is measured
 * over: **3**, a 560 m square of 31.36 ha — ADR 0070 D-1. A 400 m square read a
 * rural crossroads as densely as the thinnest public suburb measured; at
 * 560 m the two are apart. The corridor is read 250 m either side of the road
 * (`world-data/corridor.ts` §`CORRIDOR_HALF_WIDTH_METRES`) in whole z15 tiles,
 * so the last 30 m of a window beside the road may be unread where a tile
 * ends there: the density is then a little low, never high.
 */
export const INFERRED_DENSITY_WINDOW_CELLS = 3;

/**
 * The least street density that is a suburb's, in street metres a hectare:
 * **45** — ADR 0070 D-1, between what our own archive reads along a
 * residential street in six public suburbs (50 at the least, 60 to 117 at the
 * median) and along six rural roads (38 at the most).
 */
export const INFERRED_MIN_STREET_DENSITY = 45;

/**
 * ADR 0070 D-1.4, the owner's ruling of 2026-11-15: a join is a vertex of one
 * counted street within this many metres of another's segment — a side street
 * meeting a street, or two crossing — counted once a place: **6**.
 */
export const INFERRED_JOIN_SNAP_METRES = 6;

/**
 * Street joins a hectare, over the same 560 m square, from which the streets
 * read as a grid or a run of cul-de-sacs and not a road with a few driveways:
 * **0.15** (ADR 0070 D-1.4). One cue of five, never enough alone.
 */
export const INFERRED_MIN_JOINS_PER_HECTARE = 0.15;

/**
 * The share of the 560 m square that is mapped farmland, meadow or farmyard
 * (all `farmland` here) from which the ground reads as rural: **0.15** (ADR
 * 0070 D-1.5). A cue against, which one cue for cancels.
 */
export const INFERRED_RURAL_FARMLAND_SHARE = 0.15;

/**
 * Mapped footprints in the 560 m square, or this share of it mapped built-up
 * land, which are evidence of a suburb's edge (ADR 0070 D-1.6): **5**
 * footprints, or **0.05** of the square.
 */
export const INFERRED_EDGE_FOOTPRINTS = 5;
export const INFERRED_EDGE_BUILT_SHARE = 0.05;

/**
 * How far a `place` point speaks for the ground, in metres (ADR 0070 D-1.7):
 * a `suburb`, `quarter`, neighbourhood, `town` or `city` within **1 500** is
 * a cue for; a `hamlet` within **600** is a cue against. The nearest place
 * within the reach speaks, and a `village` speaks neither way.
 */
export const INFERRED_PLACE_REACH_METRES = 1_500;
export const INFERRED_HAMLET_REACH_METRES = 600;

/**
 * The most cell tests inference may take, so a hostile or very dense archive
 * cannot freeze the press: past it the rest of the cells are not inferred,
 * today's world. {@link LAND_CLASS_MAX_WORK}'s precedent.
 */
export const LAND_CLASS_MAX_INFERENCE_WORK = 20_000_000;

const CHUNK_METRES = LAND_CLASS_CELL_METRES * LAND_CLASS_CHUNK_CELLS;
const CHUNK_BYTES = LAND_CLASS_CHUNK_CELLS * LAND_CLASS_CHUNK_CELLS;

/**
 * Chunk columns and rows either side of the origin a key can name: 8 192
 * chunks, 2 621 km. Past it is `unknown`. Small enough that every key is a
 * small integer, which a `Map` looks up without boxing a number.
 */
const CHUNK_RANGE = 2 ** 13;
const CHUNK_STRIDE = 2 * CHUNK_RANGE;

/** Cells either side of the origin a chunk key can name: past it is far. */
const CELL_RANGE = CHUNK_RANGE * LAND_CLASS_CHUNK_CELLS;

/**
 * The classes by code, the code being the precedence: a cell keeps the
 * highest code written to it. 0 is `unknown`, which nothing writes.
 */
const CLASS_OF_CODE: readonly LandClass[] = [
  'unknown',
  'other',
  'farmland',
  'built-up',
  'park',
  'wood',
  'water',
  // #2684: `built-up` by inference, no polygon's. Last, so that no polygon's
  // class is its code: it is written once, after every polygon.
  'built-up',
];
const CODE_OTHER = 1;
const CODE_FARMLAND = CLASS_OF_CODE.indexOf('farmland');
const CODE_BUILT_UP = CLASS_OF_CODE.indexOf('built-up');
const CODE_INFERRED = CLASS_OF_CODE.length - 1;

/** Whether a stored code is built-up land, mapped or inferred. */
function isBuiltCode(code: number): boolean {
  return code === CODE_BUILT_UP || code === CODE_INFERRED;
}

/**
 * #2684: an `other` cell a land-use polygon covers — a beach, an aerodrome, a
 * heath — which {@link inferBuiltUp} leaves alone. Held only while the mask is
 * built, and `other` by precedence while it is; every one is `other` again
 * before the mask is returned.
 */
const CODE_MAPPED_OTHER = CLASS_OF_CODE.length;

/**
 * How far the levelling field reaches from mapped built-up land, in metres:
 * **250** — #1547.
 *
 * `landform.ts` holds the ground's invented relief to `RELIEF_SLOPE` times
 * {@link LandClassMask.builtUpDistances}, the rule its clear band already holds
 * beside the road, so a mapped town stands on the road's own height and the
 * hills rise from its edge no faster than they rise from the road. Its relief
 * is at most `RELIEF_MAX_METRES` (45 m) and `RELIEF_SLOPE` is 0.18, so past
 * 45 / 0.18 = 250 m nothing is held and the field need not reach further.
 * `landform.test.ts` holds the two files to that arithmetic.
 */
export const LEVELLING_REACH_METRES = 250;

/**
 * The most chunks the levelling field measures, in route order: **512** — #1547.
 *
 * Measuring a chunk is a chamfer over it and its neighbours' apron, about
 * 0.3 ms in Node on the development machine, and it runs at the press: 512 of
 * them is ~150 ms there, 52 km² of ground beside a town. Past it a town's
 * ground is not levelled — today's ground, never a refusal — the
 * {@link LAND_CLASS_MAX_BYTES} precedent. A chunk that is built-up throughout
 * costs nothing and is not counted.
 */
export const LEVELLING_MAX_CHUNKS = 512;

/** The stored distance past {@link LEVELLING_REACH_METRES}: a byte's most, in metres. */
const LEVEL_FAR = 255;

/** Cells of neighbouring chunk a chunk's distances are measured over: the reach, and one. */
const LEVEL_APRON_CELLS = Math.ceil(LEVELLING_REACH_METRES / LAND_CLASS_CELL_METRES) + 1;

/** The side of the grid one chunk's distances are measured on: the chunk and its apron. */
const LEVEL_SCRATCH_CELLS = LAND_CLASS_CHUNK_CELLS + 2 * LEVEL_APRON_CELLS;

/** Answers "what is the ground here?" in the corridor's local metres. */
export interface LandClassMask {
  /** O(1), no allocation. `'unknown'` outside every covered chunk. */
  classAt(x: number, z: number): LandClass;
  /** True where the corridor is covered (P-8), whatever the class. */
  covered(x: number, z: number): boolean;
  /**
   * #2684, ADR 0070 D-2: whether `classAt(x, z)` is `built-up` by inference
   * from the streets, not by a land-use polygon. A lot there is sparser than
   * one on mapped land ({@link PLOT_BUILT_SHARE}'s inferred share): the map
   * says people built there, and not how many.
   */
  inferredAt(x: number, z: number): boolean;
  /**
   * Metres to the nearest mapped built-up land at each of `count` points —
   * #1547 — `points` holding them as `x, z` pairs and `into` taking one
   * distance a point. Read off a field built once, with the mask, and
   * interpolated between cell centres, so it is continuous and the ground
   * levelled by it has no step; measured to a built-up cell's edge rather than
   * its centre, so it is 0 anywhere on one. `Infinity` where no built-up land
   * is within {@link LEVELLING_REACH_METRES}, outside every chunk the mask
   * holds, and everywhere in {@link NO_LAND_CLASS}.
   *
   * ⚠️ **Points in and distances out through arrays, never as numbers**: a
   * call that is not inlined boxes every number it is passed or returns, and
   * this is read for every vertex of the ground (#469). `landform-levelling.test.ts`
   * measures the heap a build.
   */
  builtUpDistances(points: Float64Array, count: number, into: Float64Array): void;
  /** What the mask holds, for the budget: the classes. */
  readonly bytes: number;
  /** What the levelling field holds, in bytes: 0 where no built-up land was mapped. */
  readonly levellingBytes: number;
}

/** Everything `unknown`: today's world, and what the scene takes with no corridor. */
export const NO_LAND_CLASS: LandClassMask = Object.freeze({
  classAt: (): LandClass => 'unknown',
  covered: (): boolean => false,
  inferredAt: (): boolean => false,
  builtUpDistances: (_points: Float64Array, count: number, into: Float64Array): void => {
    into.fill(Number.POSITIVE_INFINITY, 0, count);
  },
  bytes: 0,
  levellingBytes: 0,
});

/**
 * A `landuse` or `water` feature's class. Own properties only: a tile is
 * untrusted, and a `kind` of `constructor` must not find `Object`'s.
 */
export function landClassOfKind(
  layer: LandUseFeature['layer'],
  kind: string,
): Exclude<LandClass, 'unknown'> {
  if (layer === 'water') return 'water';
  return Object.hasOwn(LAND_CLASS_OF_KIND, kind)
    ? (LAND_CLASS_OF_KIND[kind] as Exclude<LandClass, 'unknown'>)
    : 'other';
}

/**
 * Whether `(x, z)` is `here`'s class and some ground `reach` metres to one of
 * its four sides is not — #1542's edge test: four lookups, no allocation. Ground
 * outside every covered chunk (`unknown`) is no edge, so the end of the map is
 * not read as the end of a wood.
 */
export function atClassEdge(
  land: LandClassMask,
  here: LandClass,
  x: number,
  z: number,
  reach: number,
): boolean {
  return (
    otherClass(land.classAt(x + reach, z), here) ||
    otherClass(land.classAt(x - reach, z), here) ||
    otherClass(land.classAt(x, z + reach), here) ||
    otherClass(land.classAt(x, z - reach), here)
  );
}

function otherClass(there: LandClass, here: LandClass): boolean {
  return there !== here && there !== 'unknown';
}

/** Whether nothing grows at `(x, z)`: mapped built-up land or water. */
export function builtUpOrWater(land: LandClassMask, x: number, z: number): boolean {
  const here = land.classAt(x, z);
  return here === 'built-up' || here === 'water';
}

/**
 * Whether a field boundary may run at `(x, z)`: ground that is not mapped as
 * built-up, water, wood or park — a field's, or the procedural world's.
 */
export function fieldGround(land: LandClassMask, x: number, z: number): boolean {
  const here = land.classAt(x, z);
  return here === 'unknown' || here === 'farmland' || here === 'other';
}

/**
 * What the countryside makes of the mask — #1542, one lever a change:
 *
 * - `planting`: the species mix and clustering by class (`scatter.ts`
 *   §`landPlanting`) — a wood planted throughout with a broadleaf and scrub edge,
 *   hedgerow trees and open pasture on farmland, specimen trees in a park.
 * - `boundaries`: field boundaries along farmland's edges rather than at the
 *   procedural field spacing (`settlements.ts` §`fieldEdgesAt`).
 * - `clutter`: field stones on pasture and rocks on a wood's floor — opaque, and
 *   out of the rocks' own near-mesh cap (`realistic-budget.ts`
 *   §`REALISTIC_NEAR_MESHES`).
 * - `hedge-breaks`: mapped farmland's roadside hedge lowered and broken up —
 *   gaps, a field gate, stretches of fence and of open verge
 *   (`settlements.ts` §`roadsidePiece`). The owner's ruling of 2026-10-24: the
 *   solid, head-high hedge boxed the view in. Reads nothing with `boundaries`
 *   off, which has no such hedge.
 * - `small-stones`: rocks on mapped farmland and a wood smaller, and none in
 *   the nearest bands (`scatter.ts` §`STONE_SCALE`). The same ruling.
 *
 * Each reads only covered land: where the mask is `unknown` the world is the
 * procedural one, item for item. Off, each is the world before #1542 exactly.
 */
export type CountrysideLever =
  'planting' | 'boundaries' | 'clutter' | 'hedge-breaks' | 'small-stones';

/** Which of {@link CountrysideLever}s are on. */
export type Countryside = Readonly<Record<CountrysideLever, boolean>>;

/** Every lever on: the product's countryside. */
export const COUNTRYSIDE: Countryside = Object.freeze({
  planting: true,
  boundaries: true,
  clutter: true,
  'hedge-breaks': true,
  'small-stones': true,
});

/** {@link COUNTRYSIDE} with `off` switched off — the levers' one reader. */
export function countrysideWithout(off: readonly CountrysideLever[]): Countryside {
  return {
    planting: !off.includes('planting'),
    boundaries: !off.includes('boundaries'),
    clutter: !off.includes('clutter'),
    'hedge-breaks': !off.includes('hedge-breaks'),
    'small-stones': !off.includes('small-stones'),
  };
}

/** One land-use polygon's bounding box, for {@link kindAt}'s first test. */
interface KindIndexEntry {
  readonly feature: LandUseFeature;
  readonly code: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Each corridor's land-use polygons with their boxes, built on first ask. */
const kindIndexes = new WeakMap<WorldCorridor, readonly KindIndexEntry[]>();

function kindIndexOf(corridor: WorldCorridor): readonly KindIndexEntry[] {
  const known = kindIndexes.get(corridor);
  if (known !== undefined) return known;
  const entries: KindIndexEntry[] = [];
  for (const feature of corridor.landUse) {
    const outer = feature.rings[0];
    if (outer === undefined || outer.length < 6) continue;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (let i = 0; i + 1 < outer.length; i += 2) {
      minX = Math.min(minX, outer[i] as number);
      maxX = Math.max(maxX, outer[i] as number);
      minZ = Math.min(minZ, outer[i + 1] as number);
      maxZ = Math.max(maxZ, outer[i + 1] as number);
    }
    const code = CLASS_OF_CODE.indexOf(landClassOfKind(feature.layer, feature.kind));
    entries.push({ feature, code, minX, maxX, minZ, maxZ });
  }
  kindIndexes.set(corridor, entries);
  return entries;
}

/** Even-odd: whether `(x, z)` is inside the polygon, holes and all. */
function insidePolygon(feature: LandUseFeature, x: number, z: number): boolean {
  let inside = false;
  for (const ring of feature.rings) {
    const n = ring.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
      const xi = ring[i * 2] as number;
      const zi = ring[i * 2 + 1] as number;
      const xj = ring[j * 2] as number;
      const zj = ring[j * 2 + 1] as number;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
  }
  return inside;
}

/**
 * The `landuse` (or `water`) `kind` at `(x, z)` — #1540: which built-up land a
 * mapped building stands on, `residential`, `commercial` or `industrial`,
 * which the mask's class does not keep. Of the polygons covering the point,
 * the one whose class wins by the mask's precedence (water > wood > park >
 * built-up > farmland > other), so it names the land {@link LandClassMask.classAt}
 * classes; `undefined` where none covers it. Read once a footprint at ride
 * start, never per frame: it tests every polygon's box.
 */
export function kindAt(corridor: WorldCorridor, x: number, z: number): string | undefined {
  let best: KindIndexEntry | undefined;
  for (const entry of kindIndexOf(corridor)) {
    if (x < entry.minX || x > entry.maxX || z < entry.minZ || z > entry.maxZ) continue;
    if (best !== undefined && entry.code <= best.code) continue;
    if (insidePolygon(entry.feature, x, z)) best = entry;
  }
  return best?.feature.kind;
}

function chunkKey(column: number, row: number): number {
  return (row + CHUNK_RANGE) * CHUNK_STRIDE + (column + CHUNK_RANGE);
}

function inRange(column: number, row: number): boolean {
  return column >= -CHUNK_RANGE && column < CHUNK_RANGE && row >= -CHUNK_RANGE && row < CHUNK_RANGE;
}

/** Cell index `[first, last]` within a chunk whose centres lie in `[min, max)`, from the chunk's own edge. */
function cellSpan(min: number, max: number, edge: number): readonly [number, number] {
  const first = Math.max(0, Math.ceil((min - edge) / LAND_CLASS_CELL_METRES - 0.5));
  const last = Math.min(
    LAND_CLASS_CHUNK_CELLS - 1,
    Math.ceil((max - edge) / LAND_CLASS_CELL_METRES - 0.5) - 1,
  );
  return [first, last];
}

/**
 * The mask for a ready corridor: its covered tiles as `other`, then every
 * land-use polygon over them by precedence. Built once, at the press.
 */
export function landClassMask(
  corridor: WorldCorridor,
  maxBytes: number = LAND_CLASS_MAX_BYTES,
  maxWork: number = LAND_CLASS_MAX_WORK,
  maxLevelledChunks: number = LEVELLING_MAX_CHUNKS,
  maxInferenceWork: number = LAND_CLASS_MAX_INFERENCE_WORK,
): LandClassMask {
  const chunks = new Map<number, Uint8Array>();
  const maxChunks = Math.floor(maxBytes / CHUNK_BYTES);
  // 1. The covered tiles, in route order, as `other`; past the cap, nothing.
  let full = false;
  for (const box of corridor.coveredBoxes) {
    if (full) break;
    full = !markCovered(chunks, box, maxChunks);
  }
  // 2. Every polygon, onto the chunks that exist, keeping the higher class.
  // #2684: a polygon whose class is `other` marks its cells as mapped, so
  // that inference leaves them alone — all but Protomaps' own `other` kind.
  let work = maxWork;
  let mappedOther = false;
  let polygonsPainted = true;
  for (const feature of corridor.landUse) {
    if (work <= 0) {
      polygonsPainted = false;
      break;
    }
    let code = CLASS_OF_CODE.indexOf(landClassOfKind(feature.layer, feature.kind));
    if (code === CODE_OTHER && feature.kind !== 'other') {
      code = CODE_MAPPED_OTHER;
      mappedOther = true;
    }
    work -= paint(chunks, feature, code);
  }
  // 2a. #2684: inferred built-up land — only where every polygon was painted,
  // so a wood the work cap left out is never read as open land beside a street.
  if (polygonsPainted && maxInferenceWork > 0) {
    inferBuiltUp(chunks, corridor, maxInferenceWork);
  }
  if (mappedOther) {
    for (const chunk of chunks.values()) {
      for (let cell = 0; cell < CHUNK_BYTES; cell += 1) {
        if (chunk[cell] === CODE_MAPPED_OTHER) chunk[cell] = CODE_OTHER;
      }
    }
  }
  // 3. #1547: how far every cell near built-up land is from it.
  const { levels, bytes: levellingBytes } = levellingField(chunks, maxLevelledChunks);

  const codeAt = (x: number, z: number): number => {
    const column = Math.floor(x / CHUNK_METRES);
    const row = Math.floor(z / CHUNK_METRES);
    // `NaN` fails both comparisons, so it is `unknown` too.
    if (!inRange(column, row)) return 0;
    const chunk = chunks.get(chunkKey(column, row));
    if (chunk === undefined) return 0;
    const cellX = Math.min(
      LAND_CLASS_CHUNK_CELLS - 1,
      Math.floor((x - column * CHUNK_METRES) / LAND_CLASS_CELL_METRES),
    );
    const cellZ = Math.min(
      LAND_CLASS_CHUNK_CELLS - 1,
      Math.floor((z - row * CHUNK_METRES) / LAND_CLASS_CELL_METRES),
    );
    return chunk[cellZ * LAND_CLASS_CHUNK_CELLS + cellX] as number;
  };
  const classAt = (x: number, z: number): LandClass => CLASS_OF_CODE[codeAt(x, z)] as LandClass;
  /** The stored distance at a cell, by its index across the whole grid. */
  const levelCell = (cellX: number, cellZ: number): number => {
    const column = Math.floor(cellX / LAND_CLASS_CHUNK_CELLS);
    const row = Math.floor(cellZ / LAND_CLASS_CHUNK_CELLS);
    if (!inRange(column, row)) return LEVEL_FAR;
    const chunk = levels.get(chunkKey(column, row));
    if (chunk === undefined) return LEVEL_FAR;
    const at =
      (cellZ - row * LAND_CLASS_CHUNK_CELLS) * LAND_CLASS_CHUNK_CELLS +
      (cellX - column * LAND_CLASS_CHUNK_CELLS);
    return chunk[at] as number;
  };
  /**
   * Every point's distance, into `into`. The four stored distances around a
   * point come from one chunk where all four are in it — all but one row and
   * one column of it — and cell by cell across a chunk's edge.
   */
  const builtUpDistances = (points: Float64Array, count: number, into: Float64Array): void => {
    for (let point = 0; point < count; point += 1) {
      // Between the four cell centres around the point, so the field is continuous.
      const fx = (points[point * 2] as number) / LAND_CLASS_CELL_METRES - 0.5;
      const fz = (points[point * 2 + 1] as number) / LAND_CLASS_CELL_METRES - 0.5;
      const cellX = Math.floor(fx);
      const cellZ = Math.floor(fz);
      // `NaN` and the infinities: nothing is near.
      if (!(Math.abs(cellX) < CELL_RANGE && Math.abs(cellZ) < CELL_RANGE)) {
        into[point] = Number.POSITIVE_INFINITY;
        continue;
      }
      const column = Math.floor(cellX / LAND_CLASS_CHUNK_CELLS);
      const row = Math.floor(cellZ / LAND_CLASS_CHUNK_CELLS);
      const localX = cellX - column * LAND_CLASS_CHUNK_CELLS;
      const localZ = cellZ - row * LAND_CLASS_CHUNK_CELLS;
      let a: number;
      let b: number;
      let c: number;
      let d: number;
      if (localX < LAND_CLASS_CHUNK_CELLS - 1 && localZ < LAND_CLASS_CHUNK_CELLS - 1) {
        const chunk = inRange(column, row) ? levels.get(chunkKey(column, row)) : undefined;
        if (chunk === undefined) {
          into[point] = Number.POSITIVE_INFINITY;
          continue;
        }
        const at = localZ * LAND_CLASS_CHUNK_CELLS + localX;
        a = chunk[at] as number;
        b = chunk[at + 1] as number;
        c = chunk[at + LAND_CLASS_CHUNK_CELLS] as number;
        d = chunk[at + LAND_CLASS_CHUNK_CELLS + 1] as number;
      } else {
        a = levelCell(cellX, cellZ);
        b = levelCell(cellX + 1, cellZ);
        c = levelCell(cellX, cellZ + 1);
        d = levelCell(cellX + 1, cellZ + 1);
      }
      if (a === LEVEL_FAR && b === LEVEL_FAR && c === LEVEL_FAR && d === LEVEL_FAR) {
        into[point] = Number.POSITIVE_INFINITY;
        continue;
      }
      const tx = fx - cellX;
      const near = a + (b - a) * tx;
      const far = c + (d - c) * tx;
      // From the cells' centres to their edge: a built-up cell is built-up to
      // its edge, so a point inside one, or half a cell off it, is on the town.
      into[point] = Math.max(0, near + (far - near) * (fz - cellZ) - LAND_CLASS_CELL_METRES / 2);
    }
  };
  return {
    classAt,
    covered: (x, z) => codeAt(x, z) !== 0,
    inferredAt: (x, z) => codeAt(x, z) === CODE_INFERRED,
    builtUpDistances,
    bytes: chunks.size * CHUNK_BYTES,
    levellingBytes,
  };
}

/** The chamfer's step to a side neighbour and to a diagonal one, in metres. */
const SIDE_STEP = LAND_CLASS_CELL_METRES;
const DIAGONAL_STEP = LAND_CLASS_CELL_METRES * Math.SQRT2;

/**
 * Every chunk's distance to the nearest built-up cell, in whole metres up to
 * {@link LEVEL_FAR} — #1547. A chunk with no built-up cell in it or in any of
 * its eight neighbours gets none, and reads as far: a 320 m chunk is wider
 * than the reach, so nothing further away can be within it.
 *
 * Each chunk is measured on its own grid with an apron of its neighbours'
 * cells, by a two-pass chamfer (side and diagonal steps, within 8 % of the
 * straight-line distance), so a town across a chunk's edge is as near as it
 * is. Built once, at the press, with the mask; one scratch grid for all of it.
 * A chunk built-up throughout is 0 throughout, and shares one array; past
 * `maxChunks` measured, in route order, the rest get none.
 */
function levellingField(
  chunks: Map<number, Uint8Array>,
  maxChunks: number,
): { readonly levels: Map<number, Uint8Array>; readonly bytes: number } {
  const levels = new Map<number, Uint8Array>();
  const builtUp = new Set<number>();
  const throughout = new Set<number>();
  for (const [key, chunk] of chunks) {
    if (!chunk.includes(CODE_BUILT_UP) && !chunk.includes(CODE_INFERRED)) continue;
    builtUp.add(key);
    let every = true;
    for (let cell = 0; cell < CHUNK_BYTES && every; cell += 1) {
      every = isBuiltCode(chunk[cell] as number);
    }
    if (every) throughout.add(key);
  }
  if (builtUp.size === 0) return { levels, bytes: 0 };
  const onTheTown = throughout.size > 0 ? new Uint8Array(CHUNK_BYTES) : undefined;
  const side = LEVEL_SCRATCH_CELLS;
  const scratch = new Float32Array(side * side);
  let measured = 0;
  for (const key of chunks.keys()) {
    if (onTheTown !== undefined && throughout.has(key)) {
      levels.set(key, onTheTown);
      continue;
    }
    if (measured >= maxChunks) continue;
    const column = (key % CHUNK_STRIDE) - CHUNK_RANGE;
    const row = Math.floor(key / CHUNK_STRIDE) - CHUNK_RANGE;
    let near = false;
    for (let dRow = -1; dRow <= 1 && !near; dRow += 1) {
      for (let dColumn = -1; dColumn <= 1 && !near; dColumn += 1) {
        near =
          inRange(column + dColumn, row + dRow) &&
          builtUp.has(chunkKey(column + dColumn, row + dRow));
      }
    }
    if (!near) continue;
    measured += 1;
    scratch.fill(Number.POSITIVE_INFINITY);
    // The seeds: every built-up cell of this chunk and of its neighbours' aprons.
    for (let dRow = -1; dRow <= 1; dRow += 1) {
      for (let dColumn = -1; dColumn <= 1; dColumn += 1) {
        if (!inRange(column + dColumn, row + dRow)) continue;
        const neighbourKey = chunkKey(column + dColumn, row + dRow);
        if (!builtUp.has(neighbourKey)) continue;
        const neighbour = chunks.get(neighbourKey) as Uint8Array;
        const offsetX = dColumn * LAND_CLASS_CHUNK_CELLS + LEVEL_APRON_CELLS;
        const offsetZ = dRow * LAND_CLASS_CHUNK_CELLS + LEVEL_APRON_CELLS;
        const fromX = Math.max(0, -offsetX);
        const toX = Math.min(LAND_CLASS_CHUNK_CELLS, side - offsetX);
        const fromZ = Math.max(0, -offsetZ);
        const toZ = Math.min(LAND_CLASS_CHUNK_CELLS, side - offsetZ);
        for (let cellZ = fromZ; cellZ < toZ; cellZ += 1) {
          for (let cellX = fromX; cellX < toX; cellX += 1) {
            if (isBuiltCode(neighbour[cellZ * LAND_CLASS_CHUNK_CELLS + cellX] as number)) {
              scratch[(cellZ + offsetZ) * side + cellX + offsetX] = 0;
            }
          }
        }
      }
    }
    chamfer(scratch, side);
    const level = new Uint8Array(CHUNK_BYTES);
    for (let cellZ = 0; cellZ < LAND_CLASS_CHUNK_CELLS; cellZ += 1) {
      const from = (cellZ + LEVEL_APRON_CELLS) * side + LEVEL_APRON_CELLS;
      for (let cellX = 0; cellX < LAND_CLASS_CHUNK_CELLS; cellX += 1) {
        const metres = scratch[from + cellX] as number;
        level[cellZ * LAND_CLASS_CHUNK_CELLS + cellX] =
          metres >= LEVEL_FAR ? LEVEL_FAR : Math.round(metres);
      }
    }
    levels.set(key, level);
  }
  return { levels, bytes: (measured + (onTheTown === undefined ? 0 : 1)) * CHUNK_BYTES };
}

/**
 * A two-pass chamfer distance transform over a square grid, in place.
 *
 * ⚠️ The grid's first and last columns, and its first and last rows, are
 * written out beside the loop over its interior rather than tested for in it
 * (#1688): the same neighbours of every cell, and the same least of them,
 * with no branch per cell. Under the nightly coverage run V8 counts every
 * branch taken, and the per-cell tests made this loop most of the time of
 * every test that presses a mapped town (`mapped-paint.test.ts`,
 * `worship-steeple.test.ts`), past their 5 s timeout on the slower runners.
 *
 * Exported for `land-class.test.ts` §"the chamfer, cell by cell", which holds
 * it to the two passes with a test per cell; the product's one caller is
 * {@link levellingField}, in this module.
 */
export function chamfer(grid: Float32Array, side: number): void {
  const last = side - 1;
  // Forward: from the left, above-left, above and above-right.
  for (let x = 1; x < side; x += 1) {
    grid[x] = Math.min(grid[x] as number, (grid[x - 1] as number) + SIDE_STEP);
  }
  for (let row = side; row < side * side; row += side) {
    grid[row] = Math.min(
      grid[row] as number,
      (grid[row - side] as number) + SIDE_STEP,
      (grid[row - side + 1] as number) + DIAGONAL_STEP,
    );
    for (let at = row + 1; at < row + last; at += 1) {
      grid[at] = Math.min(
        grid[at] as number,
        (grid[at - 1] as number) + SIDE_STEP,
        (grid[at - side] as number) + SIDE_STEP,
        (grid[at - side - 1] as number) + DIAGONAL_STEP,
        (grid[at - side + 1] as number) + DIAGONAL_STEP,
      );
    }
    const end = row + last;
    grid[end] = Math.min(
      grid[end] as number,
      (grid[end - 1] as number) + SIDE_STEP,
      (grid[end - side] as number) + SIDE_STEP,
      (grid[end - side - 1] as number) + DIAGONAL_STEP,
    );
  }
  // Backward: from the right, below-right, below and below-left.
  const bottom = last * side;
  for (let x = last - 1; x >= 0; x -= 1) {
    grid[bottom + x] = Math.min(
      grid[bottom + x] as number,
      (grid[bottom + x + 1] as number) + SIDE_STEP,
    );
  }
  for (let row = bottom - side; row >= 0; row -= side) {
    const end = row + last;
    grid[end] = Math.min(
      grid[end] as number,
      (grid[end + side] as number) + SIDE_STEP,
      (grid[end + side - 1] as number) + DIAGONAL_STEP,
    );
    for (let at = end - 1; at > row; at -= 1) {
      grid[at] = Math.min(
        grid[at] as number,
        (grid[at + 1] as number) + SIDE_STEP,
        (grid[at + side] as number) + SIDE_STEP,
        (grid[at + side + 1] as number) + DIAGONAL_STEP,
        (grid[at + side - 1] as number) + DIAGONAL_STEP,
      );
    }
    grid[row] = Math.min(
      grid[row] as number,
      (grid[row + 1] as number) + SIDE_STEP,
      (grid[row + side] as number) + SIDE_STEP,
      (grid[row + side + 1] as number) + DIAGONAL_STEP,
    );
  }
}

/** Marks a covered box's cells `other`, making chunks as needed. `false` once the cap is reached. */
function markCovered(chunks: Map<number, Uint8Array>, box: Box, maxChunks: number): boolean {
  const firstColumn = Math.floor(box.minX / CHUNK_METRES);
  const lastColumn = Math.floor(box.maxX / CHUNK_METRES);
  const firstRow = Math.floor(box.minZ / CHUNK_METRES);
  const lastRow = Math.floor(box.maxZ / CHUNK_METRES);
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      if (!inRange(column, row)) continue;
      const [x0, x1] = cellSpan(box.minX, box.maxX, column * CHUNK_METRES);
      const [z0, z1] = cellSpan(box.minZ, box.maxZ, row * CHUNK_METRES);
      // No cell centre in this chunk: make none, so the cap is not spent on nothing.
      if (x0 > x1 || z0 > z1) continue;
      const key = chunkKey(column, row);
      let chunk = chunks.get(key);
      if (chunk === undefined) {
        if (chunks.size >= maxChunks) return false;
        chunk = new Uint8Array(CHUNK_BYTES);
        chunks.set(key, chunk);
      }
      for (let cellZ = z0; cellZ <= z1; cellZ += 1) {
        const start = cellZ * LAND_CLASS_CHUNK_CELLS;
        // `other` is the least class, so writing it over a cell that holds it is nothing.
        chunk.fill(CODE_OTHER, start + x0, start + x1 + 1);
      }
    }
  }
  return true;
}

/**
 * Writes `code` into every covered cell of every existing chunk the polygon covers, where it outranks.
 * Returns the work it cost: edges times the rows of each chunk it rasterised.
 */
function paint(chunks: Map<number, Uint8Array>, feature: LandUseFeature, code: number): number {
  const outer = feature.rings[0];
  if (outer === undefined || outer.length < 6) return 0;
  let edges = 0;
  for (const ring of feature.rings) edges += ring.length / 2;
  let cost = 0;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let i = 0; i + 1 < outer.length; i += 2) {
    minX = Math.min(minX, outer[i] as number);
    maxX = Math.max(maxX, outer[i] as number);
    minZ = Math.min(minZ, outer[i + 1] as number);
    maxZ = Math.max(maxZ, outer[i + 1] as number);
  }
  for (let row = Math.floor(minZ / CHUNK_METRES); row <= Math.floor(maxZ / CHUNK_METRES); row++) {
    for (
      let column = Math.floor(minX / CHUNK_METRES);
      column <= Math.floor(maxX / CHUNK_METRES);
      column++
    ) {
      if (!inRange(column, row)) continue;
      const chunk = chunks.get(chunkKey(column, row));
      if (chunk === undefined) continue;
      const grid: GridSpec = {
        originX: column * CHUNK_METRES,
        originZ: row * CHUNK_METRES,
        cellMetres: LAND_CLASS_CELL_METRES,
        columns: LAND_CLASS_CHUNK_CELLS,
        rows: LAND_CLASS_CHUNK_CELLS,
      };
      cost += edges * LAND_CLASS_CHUNK_CELLS;
      rasterise(feature, grid, (cell) => {
        const held = chunk[cell] as number;
        // An uncovered cell stays `unknown`: a tile's buffer reaches past it.
        if (held !== 0 && precedence(held) < precedence(code)) chunk[cell] = code;
      });
    }
  }
  return cost;
}

/**
 * A code's place in the precedence: {@link CODE_MAPPED_OTHER} is above a
 * covered cell no polygon reaches and below every other class, so a wood
 * drawn over a beach is still a wood.
 */
function precedence(code: number): number {
  return code === CODE_MAPPED_OTHER ? CODE_OTHER + 0.5 : code;
}

/** Density cells either side of the origin a key can name: the chunks' own 2 621 km. */
const DENSITY_RANGE = Math.ceil((CHUNK_RANGE * CHUNK_METRES) / INFERRED_DENSITY_CELL_METRES);

/** Land-class cells in one density cell: 256. */
const DENSITY_CELL_CELLS = (INFERRED_DENSITY_CELL_METRES / LAND_CLASS_CELL_METRES) ** 2;

/** The density window's area, in hectares: 31.36. */
const DENSITY_WINDOW_HECTARES =
  ((2 * INFERRED_DENSITY_WINDOW_CELLS + 1) * INFERRED_DENSITY_CELL_METRES) ** 2 / 10_000;

function densityKey(column: number, row: number): number {
  return (row + DENSITY_RANGE) * (2 * DENSITY_RANGE) + (column + DENSITY_RANGE);
}

function densityInRange(column: number, row: number): boolean {
  return (
    column >= -DENSITY_RANGE &&
    column < DENSITY_RANGE &&
    row >= -DENSITY_RANGE &&
    row < DENSITY_RANGE
  );
}

/** Whether `(x, z)` is within `reach` of the segment from `(ax, az)` to `(bx, bz)`. */
function nearSegment(
  x: number,
  z: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  reach: number,
): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const span = dx * dx + dz * dz;
  const t = span > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / span)) : 0;
  const ox = ax + dx * t - x;
  const oz = az + dz * t - z;
  return ox * ox + oz * oz <= reach * reach;
}

/** The sum of a per-density-cell count over the window about a cell. */
function windowSum(counts: ReadonlyMap<number, number>, column: number, row: number): number {
  const window = INFERRED_DENSITY_WINDOW_CELLS;
  let sum = 0;
  for (let dRow = -window; dRow <= window; dRow += 1) {
    for (let dColumn = -window; dColumn <= window; dColumn += 1) {
      if (!densityInRange(column + dColumn, row + dRow)) continue;
      sum += counts.get(densityKey(column + dColumn, row + dRow)) ?? 0;
    }
  }
  return sum;
}

/** What the nearest `place` within reach says of a window: for a suburb, against, or nothing. */
export type PlaceCue = 'suburban' | 'hamlet' | 'none';

/**
 * ADR 0070 D-1.7: the nearest `place` point within
 * {@link INFERRED_PLACE_REACH_METRES} of `(x, z)`. A `suburb`, `quarter`,
 * neighbourhood, `town` or `city` is for a suburb; a `hamlet` within
 * {@link INFERRED_HAMLET_REACH_METRES} is against; a `village`, or a hamlet
 * further off, is nearer than what it hides and speaks neither way.
 */
export function nearestPlace(
  places: readonly PlaceFeature[] | undefined,
  x: number,
  z: number,
): PlaceCue {
  if (places === undefined) return 'none';
  let best = INFERRED_PLACE_REACH_METRES * INFERRED_PLACE_REACH_METRES;
  let cue: PlaceCue = 'none';
  for (const place of places) {
    const d = (place.x - x) ** 2 + (place.z - z) ** 2;
    if (!(d <= best)) continue;
    best = d;
    if (
      place.kind !== 'locality' ||
      place.kindDetail === 'suburb' ||
      place.kindDetail === 'quarter' ||
      place.kindDetail === 'town' ||
      place.kindDetail === 'city'
    ) {
      cue = 'suburban';
    } else {
      cue =
        place.kindDetail === 'hamlet' && d <= INFERRED_HAMLET_REACH_METRES ** 2 ? 'hamlet' : 'none';
    }
  }
  return cue;
}

/**
 * ADR 0070 D-1.3 to D-1.7: whether the 560 m square about a cell is a
 * suburb's, from what the map holds there. The street density is **required**
 * ({@link INFERRED_MIN_STREET_DENSITY}). Beyond it, three cues are for a
 * suburb (a grid's joins, mapped footprints or built-up land near, a
 * suburban place near) and two against (mapped farmland, a hamlet near), and
 * the square reads as a suburb where the cues for outnumber those against.
 * So a dense street with none either way needs none (one cue for beats no
 * cue against is not asked): it needs **one for, net**. No cue alone is
 * enough: the density without a cue for is not.
 */
export function suburbCues(window: {
  readonly metres: number;
  readonly joins: number;
  readonly farmland: number;
  readonly mapped: number;
  readonly footprints: number;
  readonly place: PlaceCue;
}): boolean {
  if (window.metres / DENSITY_WINDOW_HECTARES < INFERRED_MIN_STREET_DENSITY) return false;
  const cells = (2 * INFERRED_DENSITY_WINDOW_CELLS + 1) ** 2 * DENSITY_CELL_CELLS;
  let score = 0;
  if (window.joins / DENSITY_WINDOW_HECTARES >= INFERRED_MIN_JOINS_PER_HECTARE) score += 1;
  if (
    window.footprints >= INFERRED_EDGE_FOOTPRINTS ||
    window.mapped / cells >= INFERRED_EDGE_BUILT_SHARE
  ) {
    score += 1;
  }
  if (window.place === 'suburban') score += 1;
  if (window.farmland / cells >= INFERRED_RURAL_FARMLAND_SHARE) score -= 1;
  if (window.place === 'hamlet') score -= 1;
  return score >= 1;
}

/**
 * Inferred built-up land — #2684, ADR 0070 D-1. Every covered cell that
 * holds plain `other` (no land-use polygon reaches it, or only Protomaps' own
 * `other` kind) becomes `built-up` (code {@link CODE_INFERRED}) where both hold:
 *
 * 1. its centre is within {@link INFERRED_REACH_METRES} of a street whose
 *    `kind_detail` is one of {@link INFERRED_NEAR_STREET_DETAILS}, not in a
 *    tunnel; and
 * 2. the 560 m square about it reads as a suburb, {@link suburbCues}: the
 *    street density is {@link INFERRED_MIN_STREET_DENSITY} or more, and the
 *    other cues — joins, farmland, footprints and built-up land, places — do
 *    not cancel one another out. No cue but the density is enough alone.
 *
 * Never on farmland, meadow, wood, water or park, nor on any polygon of
 * another kind that classes `other` (an aerodrome, a beach, a heath): those
 * cells do not hold plain `other` ({@link CODE_MAPPED_OTHER}). Rail,
 * industrial and military land is already `built-up` and is not changed.
 * Built once, at the press, after the polygons; bounded by `maxWork` cell
 * tests, past which the rest is not inferred — today's world.
 */
function inferBuiltUp(
  chunks: Map<number, Uint8Array>,
  corridor: WorldCorridor,
  maxWork: number,
): void {
  const streets = corridor.streets;
  let work = maxWork;
  // 1. The counted streets' metres, and their joins, in each density cell.
  const metres = new Map<number, number>();
  const joins = new Map<number, number>();
  // Every counted segment, filed under the density cells its pieces pass through.
  const segments: number[] = [];
  const segmentsIn = new Map<number, number[]>();
  const counted: { readonly line: Float32Array; readonly owner: number }[] = [];
  const piece = INFERRED_DENSITY_CELL_METRES / 4;
  let owner = 0;
  for (const street of streets) {
    if (!INFERRED_DENSITY_STREET_DETAILS.has(street.kindDetail)) continue;
    owner += 1;
    const line = street.line;
    counted.push({ line, owner });
    for (let at = 0; at + 3 < line.length; at += 2) {
      const ax = line[at] as number;
      const az = line[at + 1] as number;
      const dx = (line[at + 2] as number) - ax;
      const dz = (line[at + 3] as number) - az;
      const length = Math.hypot(dx, dz);
      if (!Number.isFinite(length) || length === 0) continue;
      // A segment with an end past the grid's reach is nothing: it is skipped
      // before it is charged, so a corrupt one cannot turn inference off for the ride.
      if (
        !densityInRange(
          Math.floor(ax / INFERRED_DENSITY_CELL_METRES),
          Math.floor(az / INFERRED_DENSITY_CELL_METRES),
        ) ||
        !densityInRange(
          Math.floor((ax + dx) / INFERRED_DENSITY_CELL_METRES),
          Math.floor((az + dz) / INFERRED_DENSITY_CELL_METRES),
        )
      ) {
        continue;
      }
      const pieces = Math.ceil(length / piece);
      if (pieces > work) return;
      work -= pieces;
      for (let p = 0; p < pieces; p += 1) {
        const t = (p + 0.5) / pieces;
        const column = Math.floor((ax + dx * t) / INFERRED_DENSITY_CELL_METRES);
        const row = Math.floor((az + dz * t) / INFERRED_DENSITY_CELL_METRES);
        if (!densityInRange(column, row)) continue;
        const key = densityKey(column, row);
        metres.set(key, (metres.get(key) ?? 0) + length / pieces);
        const filed = segmentsIn.get(key);
        const index = segments.length / 5;
        if (filed === undefined) segmentsIn.set(key, [index]);
        else if (filed[filed.length - 1] !== index) filed.push(index);
      }
      segments.push(ax, az, ax + dx, az + dz, owner);
    }
  }
  // 1+. Joins: a vertex of one counted street within the snap of another's
  // segment, counted once a place. OpenStreetMap's nodes are not all kept by
  // the tiles, so the test is by distance and not by a shared vertex.
  const joined = new Set<number>();
  const snap = INFERRED_JOIN_SNAP_METRES;
  for (const { line, owner: mine } of counted) {
    for (let at = 0; at + 1 < line.length; at += 2) {
      const x = line[at] as number;
      const z = line[at + 1] as number;
      const column = Math.floor(x / INFERRED_DENSITY_CELL_METRES);
      const row = Math.floor(z / INFERRED_DENSITY_CELL_METRES);
      if (!densityInRange(column, row)) continue;
      const spot = Math.round(x / snap) * 2 ** 22 + Math.round(z / snap);
      if (joined.has(spot)) continue;
      let found = false;
      for (let dRow = -1; dRow <= 1 && !found; dRow += 1) {
        for (let dColumn = -1; dColumn <= 1 && !found; dColumn += 1) {
          if (!densityInRange(column + dColumn, row + dRow)) continue;
          const filed = segmentsIn.get(densityKey(column + dColumn, row + dRow));
          if (filed === undefined) continue;
          if (filed.length > work) return;
          work -= filed.length;
          for (const index of filed) {
            const base = index * 5;
            if ((segments[base + 4] as number) === mine) continue;
            if (
              nearSegment(
                x,
                z,
                segments[base] as number,
                segments[base + 1] as number,
                segments[base + 2] as number,
                segments[base + 3] as number,
                snap,
              )
            ) {
              found = true;
              break;
            }
          }
        }
      }
      if (!found) continue;
      joined.add(spot);
      const cell = densityKey(column, row);
      joins.set(cell, (joins.get(cell) ?? 0) + 1);
    }
  }
  if (metres.size === 0) return;
  // 1a. Farmland, and mapped built-up land, by density cell: read off the mask
  // before a single cell is inferred, so the cue is the map's alone.
  const farmland = new Map<number, number>();
  const mapped = new Map<number, number>();
  const cellsPerDensity = INFERRED_DENSITY_CELL_METRES / LAND_CLASS_CELL_METRES;
  const densityPerChunk = LAND_CLASS_CHUNK_CELLS / cellsPerDensity;
  for (const [key, chunk] of chunks) {
    if (CHUNK_BYTES > work) return;
    work -= CHUNK_BYTES;
    const column = (key % CHUNK_STRIDE) - CHUNK_RANGE;
    const row = Math.floor(key / CHUNK_STRIDE) - CHUNK_RANGE;
    for (let cellZ = 0; cellZ < LAND_CLASS_CHUNK_CELLS; cellZ += 1) {
      const start = cellZ * LAND_CLASS_CHUNK_CELLS;
      const rowKey = row * densityPerChunk + Math.floor(cellZ / cellsPerDensity);
      for (let cellX = 0; cellX < LAND_CLASS_CHUNK_CELLS; cellX += 1) {
        const code = chunk[start + cellX] as number;
        if (code !== CODE_FARMLAND && code !== CODE_BUILT_UP) continue;
        const cell = densityKey(
          column * densityPerChunk + Math.floor(cellX / cellsPerDensity),
          rowKey,
        );
        const into = code === CODE_FARMLAND ? farmland : mapped;
        into.set(cell, (into.get(cell) ?? 0) + 1);
      }
    }
  }
  // 1b. Mapped footprints, by density cell: the first vertex of the first ring.
  const footprints = new Map<number, number>();
  for (const building of corridor.buildings) {
    if (work <= 0) return;
    work -= 1;
    const ring = building.rings[0];
    if (ring === undefined || ring.length < 2) continue;
    const column = Math.floor((ring[0] as number) / INFERRED_DENSITY_CELL_METRES);
    const row = Math.floor((ring[1] as number) / INFERRED_DENSITY_CELL_METRES);
    if (!densityInRange(column, row)) continue;
    const cell = densityKey(column, row);
    footprints.set(cell, (footprints.get(cell) ?? 0) + 1);
  }
  // 2. Whether a density cell's window is a suburb's, asked once a cell.
  const suburb = new Map<number, boolean>();
  const suburbAt = (column: number, row: number): boolean => {
    const key = densityKey(column, row);
    const known = suburb.get(key);
    if (known !== undefined) return known;
    const is = suburbCues({
      metres: windowSum(metres, column, row),
      joins: windowSum(joins, column, row),
      farmland: windowSum(farmland, column, row),
      mapped: windowSum(mapped, column, row),
      footprints: windowSum(footprints, column, row),
      place: nearestPlace(
        corridor.places,
        (column + 0.5) * INFERRED_DENSITY_CELL_METRES,
        (row + 0.5) * INFERRED_DENSITY_CELL_METRES,
      ),
    });
    suburb.set(key, is);
    return is;
  };
  // 3. Every plain `other` cell near a near street, where its window is a suburb's.
  const reach = INFERRED_REACH_METRES;
  const reachSquared = reach * reach;
  for (const street of streets) {
    if (street.grade === 'tunnel' || !INFERRED_NEAR_STREET_DETAILS.has(street.kindDetail)) {
      continue;
    }
    const line = street.line;
    for (let at = 0; at + 3 < line.length; at += 2) {
      const ax = line[at] as number;
      const az = line[at + 1] as number;
      const bx = line[at + 2] as number;
      const bz = line[at + 3] as number;
      const firstX = Math.floor((Math.min(ax, bx) - reach) / LAND_CLASS_CELL_METRES);
      const lastX = Math.floor((Math.max(ax, bx) + reach) / LAND_CLASS_CELL_METRES);
      const firstZ = Math.floor((Math.min(az, bz) - reach) / LAND_CLASS_CELL_METRES);
      const lastZ = Math.floor((Math.max(az, bz) + reach) / LAND_CLASS_CELL_METRES);
      // `NaN` and the infinities fail these, and a segment past the grid's reach is nothing.
      if (!(Math.abs(firstX) < CELL_RANGE && Math.abs(lastX) < CELL_RANGE)) continue;
      if (!(Math.abs(firstZ) < CELL_RANGE && Math.abs(lastZ) < CELL_RANGE)) continue;
      const dx = bx - ax;
      const dz = bz - az;
      const span = dx * dx + dz * dz;
      for (let cellZ = firstZ; cellZ <= lastZ; cellZ += 1) {
        const row = Math.floor(cellZ / LAND_CLASS_CHUNK_CELLS);
        const z = (cellZ + 0.5) * LAND_CLASS_CELL_METRES;
        // Only the stretch of the row the segment's reach can touch, not its
        // whole box: a long diagonal segment's box is mostly out of reach.
        let from = 0;
        let to = 1;
        if (dz !== 0) {
          const near = (z - reach - az) / dz;
          const far = (z + reach - az) / dz;
          from = Math.max(0, Math.min(near, far));
          to = Math.min(1, Math.max(near, far));
        } else if (Math.abs(z - az) > reach) {
          continue;
        }
        if (from > to) continue;
        const rowFirstX = Math.max(
          firstX,
          Math.floor((Math.min(ax + dx * from, ax + dx * to) - reach) / LAND_CLASS_CELL_METRES),
        );
        const rowLastX = Math.min(
          lastX,
          Math.floor((Math.max(ax + dx * from, ax + dx * to) + reach) / LAND_CLASS_CELL_METRES),
        );
        const cells = rowLastX - rowFirstX + 1;
        if (cells > work) return;
        work -= Math.max(0, cells);
        let chunkColumn = Number.NaN;
        let chunk: Uint8Array | undefined;
        for (let cellX = rowFirstX; cellX <= rowLastX; cellX += 1) {
          const column = Math.floor(cellX / LAND_CLASS_CHUNK_CELLS);
          if (column !== chunkColumn) {
            chunkColumn = column;
            chunk = inRange(column, row) ? chunks.get(chunkKey(column, row)) : undefined;
          }
          if (chunk === undefined) continue;
          const cell =
            (cellZ - row * LAND_CLASS_CHUNK_CELLS) * LAND_CLASS_CHUNK_CELLS +
            (cellX - column * LAND_CLASS_CHUNK_CELLS);
          if (chunk[cell] !== CODE_OTHER) continue;
          const x = (cellX + 0.5) * LAND_CLASS_CELL_METRES;
          const t = span > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / span)) : 0;
          const ox = ax + dx * t - x;
          const oz = az + dz * t - z;
          if (ox * ox + oz * oz > reachSquared) continue;
          const densityColumn = Math.floor(x / INFERRED_DENSITY_CELL_METRES);
          const densityRow = Math.floor(z / INFERRED_DENSITY_CELL_METRES);
          if (suburbAt(densityColumn, densityRow)) chunk[cell] = CODE_INFERRED;
        }
      }
    }
  }
}
