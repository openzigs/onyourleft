// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which files the realistic world is drawn from, and where they are served —
 * #425, #474, #369, under [ADR 0026](../../../../docs/adr/0026-realistic-game-world.md).
 *
 * ## Where they live, and why that is a rule rather than a list
 *
 * Every file is committed under `apps/web/public/realistic/`, which Vite copies
 * verbatim into `dist/realistic/` — so in the build they are exactly the files
 * whose path begins {@link REALISTIC_DIRECTORY}. ADR 0026 D-7 keeps them out of
 * the service worker's precache **by that location**
 * (`tools/precache/precache.ts` §`PRECACHE_EXCLUSIONS`), never by naming them:
 * a list of names fails open against a file added later, and a directory
 * cannot. Inside the Android shell there is no worker at all (ADR 0024 D-4) and
 * they ship in the APK with everything else in `dist` — which is D-6's
 * build-size budget.
 *
 * ⚠️ **Not hashed by the bundler**, unlike the stylised world's `?url` imports
 * in `scenery-models.ts`: a `public/` file keeps its name. That costs the
 * cache-busting a hash buys in a browser's HTTP cache, and it is the price of a
 * location a precache rule can name. The names are the pipeline's and change
 * when the pipeline's recipe does (`tools/realistic/sources.ts` §`OUTPUTS`).
 *
 * ## What is drawn with what
 *
 * - {@link REALISTIC_SKY} is both the background and — prefiltered — the
 *   environment that lights every physically based material (ADR 0026 D-9).
 * - {@link REALISTIC_SURFACES} are the road's and the ground's tiled maps.
 * - {@link REALISTIC_VEGETATION} is ADR 0026 D-12's second layer: the four
 *   kinds `scatter.ts` places that a photoscan can stand in for. Trees carry an
 *   impostor strip for the far band.
 * - {@link REALISTIC_STRUCTURE_SURFACES} are ADR 0026 D-12's third layer
 *   (#475): the photographic surfaces the structures wear. The structures'
 *   SHAPES are built in `three-renderer.ts` from numbers, because no source in
 *   D-4's list publishes a whole country building — see that table.
 * - {@link REALISTIC_RIDER} is the body; the bicycle under it is built in
 *   `three-renderer.ts` from `bicycle.ts`'s own parts, because no road bicycle
 *   whose own page states CC0 or CC-BY-4.0 was found (spike 0005).
 *
 * `realistic-assets.test.ts` holds these tables to the pipeline's own list of
 * what it ships, in both directions.

 */

import { isNativeShell, platformCapacitor } from '../support/capacitor';

import type { ScatterKind, StructureKind } from './scatter';

/**
 * Where the realistic files are in the build, relative to its root.
 *
 * @test-facing held by `precache.test.ts`, which builds the realistic set's
 * paths from it to show the precache rule excludes them
 */
export const REALISTIC_DIRECTORY = 'realistic/';

/**
 * The URL one realistic file is served at, under whatever base the build has.
 *
 * @unwired read by `three-renderer.ts` §`loadRealisticWorld` and the owner's
 * harness page, and by nothing the shipped app runs until #475 offers the
 * realistic world to a rider (ADR 0026 D-12)
 */
export function realisticUrl(file: string): string {
  return `${import.meta.env.BASE_URL}${REALISTIC_DIRECTORY}${file}`;
}

/**
 * The HDR sky: background and environment light at once.
 *
 * @unwired read by `three-renderer.ts` §`loadRealisticWorld` and the owner's
 * harness page, and by nothing the shipped app runs until #475 offers the
 * realistic world to a rider (ADR 0026 D-12)
 */
export const REALISTIC_SKY = 'farm_field_2k.hdr';

/** One tiled surface: its colour map and its normal map. */
export interface SurfaceMaps {
  readonly colour: string;
  readonly normal: string;
  /**
   * How many metres one repeat of the map covers on the ground. The asphalt's
   * 3 m and the grass's 4 m are #457's, read off its screenshots on the
   * tablet; the ground also samples at nine times that and blends by distance,
   * which is the cheapest cure for a tiling that reads as a grid at 150 m.
   */
  readonly tileMetres: number;
}

export const REALISTIC_SURFACES: { readonly road: SurfaceMaps; readonly ground: SurfaceMaps } = {
  road: {
    colour: 'asphalt_02_diff_1k.jpg',
    normal: 'asphalt_02_nor_gl_1k.jpg',
    tileMetres: 3,
  },
  ground: {
    colour: 'sparse_grass_diff_1k.jpg',
    normal: 'sparse_grass_nor_gl_1k.jpg',
    tileMetres: 4,
  },
};

/**
 * A photographic surface a realistic structure wears — ADR 0026 D-12 layer 3,
 * #475 — and `painted`, the one that wears no photograph.
 */
export type StructureSurface =
  'brick' | 'roof-tiles' | 'slate' | 'stone' | 'planks' | 'corrugated' | 'hedge' | 'painted';

/** The surfaces that are a photograph, in a fixed order. */
export const PHOTOGRAPHIC_STRUCTURE_SURFACES: readonly Exclude<StructureSurface, 'painted'>[] = [
  'brick',
  'roof-tiles',
  'slate',
  'stone',
  'planks',
  'corrugated',
  'hedge',
];

/**
 * The structures' photographic surfaces — #475. Each is a Poly Haven CC0
 * texture, downsized by the pipeline to 512 px (`tools/realistic/sources.ts`
 * §`STRUCTURE_TEXTURES` says which, and why these), and its `tileMetres` is
 * Poly Haven's own stated size for the texture.
 *
 * ⚠️ **Surfaces and not buildings, and that is a finding rather than a
 * shortcut.** ADR 0026 D-12 layer 3 asks for realistic structures sourced per
 * D-4; D-4's sources publish no whole country building a rider would pass —
 * Poly Haven's `buildings` category is urban facade kits of 118 000 to 175 000
 * triangles, gates and shutters (read 2026-09-22), and ambientCG publishes
 * materials only. So the shapes are `three-renderer.ts`'s own, from numbers,
 * as the stylised world's are, and what is photographic is what covers them.
 *
 * `painted` — a signpost's pole — carries no photograph: at 6 cm across there
 * is nothing on it for one to show.
 */
export const REALISTIC_STRUCTURE_SURFACES: Readonly<
  Record<Exclude<StructureSurface, 'painted'>, SurfaceMaps>
> = {
  brick: structureMaps('brick_wall_02', 2),
  'roof-tiles': structureMaps('clay_roof_tiles_02', 2.5),
  slate: structureMaps('grey_roof_tiles_02', 1.5),
  stone: structureMaps('old_stone_wall', 2),
  planks: structureMaps('dark_planks', 2),
  corrugated: structureMaps('corrugated_iron', 1.12),
  hedge: structureMaps('forest_leaves_02', 3),
};

function structureMaps(id: string, tileMetres: number): SurfaceMaps {
  return { colour: `${id}_diff_512.jpg`, normal: `${id}_nor_gl_512.jpg`, tileMetres };
}

/**
 * Which surface each part of each structure wears, in the order
 * `three-renderer.ts` builds the parts — #475. A building's parts are its
 * walls and its roof; every other kind's are `STRUCTURE_STYLE`'s own, part for
 * part, so the realistic shape is the stylised one with a surface on it.
 */
export const REALISTIC_STRUCTURE_PARTS: Readonly<
  Record<StructureKind, readonly StructureSurface[]>
> = {
  building: ['brick', 'roof-tiles'],
  barn: ['planks', 'corrugated'],
  church: ['stone', 'slate', 'stone', 'slate'],
  'shop-row': ['brick', 'planks', 'slate'],
  shed: ['corrugated', 'corrugated'],
  wall: ['stone'],
  hedge: ['hedge'],
  fence: ['planks'],
  signpost: ['painted', 'planks'],
};

/** The scatter kinds the realistic world has its own shape for — ADR 0026 D-12 layer 2. */
export type RealisticVegetationKind = Extract<
  ScatterKind,
  'tree-broadleaf' | 'tree-conifer' | 'shrub' | 'rock'
>;

/** One shape a realistic kind can wear. */
export interface RealisticModel {
  readonly name: string;
  /** The near-field model. */
  readonly file: string;
  /**
   * The far band's eight-view strip, for a tree — `undefined` for a shrub or a
   * rock, which is drawn only among the nearest few of its kind
   * (`realistic-budget.ts` §`REALISTIC_NEAR_MESHES` says why that is a saving
   * rather than a gap).
   */
  readonly impostor?: string;
}

/**
 * The shapes, by kind, in variant order. An item's `variant` picks among them
 * modulo their count, exactly as `three-renderer.ts` §`ScatterBelt` does for the
 * stylised world — so the same item wears the same variant slot in both worlds
 * and only the shape changes (ADR 0026 D-2).
 *
 * @unwired read by `three-renderer.ts` §`loadRealisticWorld` and the owner's
 * harness page, and by nothing the shipped app runs until #475 offers the
 * realistic world to a rider (ADR 0026 D-12)
 */
export const REALISTIC_VEGETATION: Readonly<
  Record<RealisticVegetationKind, readonly RealisticModel[]>
> = {
  'tree-broadleaf': [
    {
      name: 'island_tree_02',
      file: 'island_tree_02.glb',
      impostor: 'island_tree_02-impostor.png',
    },
    { name: 'tree_small_02', file: 'tree_small_02.glb', impostor: 'tree_small_02-impostor.png' },
  ],
  'tree-conifer': [
    {
      name: 'fir_sapling_medium_a',
      file: 'fir_sapling_medium_a.glb',
      impostor: 'fir_sapling_medium_a-impostor.png',
    },
    {
      name: 'fir_sapling_medium_b',
      file: 'fir_sapling_medium_b.glb',
      impostor: 'fir_sapling_medium_b-impostor.png',
    },
  ],
  shrub: [
    { name: 'shrub_02_a', file: 'shrub_02_a.glb' },
    { name: 'shrub_02_c', file: 'shrub_02_c.glb' },
  ],
  rock: [{ name: 'boulder_01', file: 'boulder_01.glb' }],
};

/** The four kinds, in a fixed order. */
export const REALISTIC_VEGETATION_KINDS: readonly RealisticVegetationKind[] = [
  'tree-broadleaf',
  'tree-conifer',
  'shrub',
  'rock',
];

/** Whether the realistic world has its own shape for a kind. */
export function isRealisticVegetation(kind: string): kind is RealisticVegetationKind {
  return (REALISTIC_VEGETATION_KINDS as readonly string[]).includes(kind);
}

/**
 * The rider's body — MakeHuman's CC0 base mesh, rigged and cut down (#369).
 *
 * @unwired read by `three-renderer.ts` §`loadRealisticWorld` and the owner's
 * harness page, and by nothing the shipped app runs until #475 offers the
 * realistic world to a rider (ADR 0026 D-12)
 */
export const REALISTIC_RIDER = 'rider.glb';

/**
 * Every file the tables above name, once.
 *
 * @test-facing held by `realistic-assets.test.ts`, `realistic-budget.test.ts`
 * and `precache.test.ts`, which hold the committed files to these tables
 */
export function realisticFiles(): readonly string[] {
  return [
    REALISTIC_SKY,
    REALISTIC_SURFACES.road.colour,
    REALISTIC_SURFACES.road.normal,
    REALISTIC_SURFACES.ground.colour,
    REALISTIC_SURFACES.ground.normal,
    ...REALISTIC_VEGETATION_KINDS.flatMap((kind) =>
      REALISTIC_VEGETATION[kind].flatMap((model) =>
        model.impostor === undefined ? [model.file] : [model.file, model.impostor],
      ),
    ),
    ...PHOTOGRAPHIC_STRUCTURE_SURFACES.flatMap((surface) => [
      REALISTIC_STRUCTURE_SURFACES[surface].colour,
      REALISTIC_STRUCTURE_SURFACES[surface].normal,
    ]),
    REALISTIC_RIDER,
  ];
}

/**
 * What came of asking for the realistic world — `three-renderer.ts`
 * §`loadRealisticWorld`. All of it loaded, or none of it did and the view
 * draws the stylised world.
 *
 * @unwired read by `three-renderer.ts` §`loadRealisticWorld` and the owner's
 * harness page, and by nothing the shipped app runs until #475 offers the
 * realistic world to a rider (ADR 0026 D-12)
 */
export type RealisticWorldOutcome =
  | { readonly loaded: true }
  | {
      readonly loaded: false;
      /** Whether the browser said it was offline when the load failed. */
      readonly offline: boolean;
      /** The failure, for a diagnostic line; never shown to a rider as it stands. */
      readonly detail: string;
    };

/**
 * What a rider is told when the realistic world was asked for and is not what
 * they are riding in — ADR 0026 D-7: *"offline with the realistic world chosen,
 * the game falls back to the stylised world and says so. A silent downgrade is
 * a rider wondering whether the setting broke."* `undefined` when there is
 * nothing to say.
 *
 * ⚠️ **Offline is its own sentence because it is the expected case**, not a
 * fault: the realistic set is deliberately not in the service worker's
 * precache (D-7), so a browser with no network cannot have it. The other
 * sentence is for everything else — a file that would not decode, a device
 * out of memory — and says only what happened, not why, because the rider
 * cannot act on why.
 *
 * ⚠️ **The offline sentence is a BROWSER's, and is never said inside the
 * Android shell** (#478). There the realistic set ships inside the APK (D-7),
 * so "not kept on this device" is false, and a failure there is not the
 * network's; and the shell's WebView reports `navigator.onLine === true` with
 * no network at all (validation 0002 Part P), so `outcome.offline` cannot be
 * trusted to say anything there either. In the shell a failure is always the
 * other sentence. Which one this is running in is `support/capacitor.ts`'s
 * question, asked the one way this client asks it.
 *
 * @param inShell whether this is the Android shell; read from the real
 * Capacitor global unless a caller says
 *
 * @unwired reached only from the owner's harness page until #475 offers the
 * realistic world to a rider and puts this in the ride UI.
 */
export function realisticWorldNotice(
  outcome: RealisticWorldOutcome,
  inShell: boolean = isNativeShell(platformCapacitor()),
): string | undefined {
  if (outcome.loaded) return undefined;
  return outcome.offline && !inShell
    ? 'The realistic world is not kept on this device for use offline, so this ride is in the standard world.'
    : 'The realistic world could not be loaded, so this ride is in the standard world.';
}
