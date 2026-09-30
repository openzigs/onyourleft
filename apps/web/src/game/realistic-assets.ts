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
 *   SHAPES are built from numbers — a building's in `buildings.ts` since #500,
 *   with its doors and windows — because no source in D-4's list publishes a
 *   whole country building — see that table.
 * - {@link REALISTIC_RIDER} is the body; the bicycle under it is built in
 *   `three-renderer.ts` from `bicycle.ts`'s own parts, because no road bicycle
 *   whose own page states CC0 or CC-BY-4.0 was found (spike 0005).
 * - {@link REALISTIC_BICYCLE_MAPS} are that bicycle's surfaces since #624:
 *   four small maps this repository draws, on the geometry it already had.
 *
 * `realistic-assets.test.ts` holds these tables to the pipeline's own list of
 * what it ships, in both directions.

 */

import { isNativeShell, platformCapacitor } from '../support/capacitor';

import type { BuildingRole, BuiltKind } from './buildings';
import type { ScatterKind, StructureKind } from './scatter';

/**
 * Where the realistic files are in the build, relative to its root.
 */
export const REALISTIC_DIRECTORY = 'realistic/';

/**
 * The URL one realistic file is served at, under whatever base the build has.
 */
export function realisticUrl(file: string): string {
  return `${import.meta.env.BASE_URL}${REALISTIC_DIRECTORY}${file}`;
}

/**
 * The HDR sky: background and environment light at once.
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

/**
 * The road's and the ground's surfaces — and since #627 the two the ground
 * blends into: `verge`, earth and gravel along the road's edge, and `rock`,
 * bare stone on a steep bank and scree above the tree line
 * (`ground-blend.ts`). Their repeats are this repository's own: gravel at
 * 2.5 m and stones at 3 m, near the scans' own sizes (Poly Haven's
 * `dimensions`, 2.48 m and 3 m) so a pebble is about a pebble's size.
 */
export const REALISTIC_SURFACES: {
  readonly road: SurfaceMaps;
  readonly ground: SurfaceMaps;
  readonly verge: SurfaceMaps;
  readonly rock: SurfaceMaps;
} = {
  road: {
    colour: 'asphalt_02_diff_1k.ktx2',
    normal: 'asphalt_02_nor_gl_1k.ktx2',
    tileMetres: 3,
  },
  ground: {
    colour: 'sparse_grass_diff_1k.ktx2',
    normal: 'sparse_grass_nor_gl_1k.ktx2',
    tileMetres: 4,
  },
  verge: {
    colour: 'gravelly_sand_diff_512.ktx2',
    normal: 'gravelly_sand_nor_gl_512.ktx2',
    tileMetres: 2.5,
  },
  rock: {
    colour: 'rocks_ground_05_diff_512.ktx2',
    normal: 'rocks_ground_05_nor_gl_512.ktx2',
    tileMetres: 3,
  },
};

/**
 * A photographic surface a realistic structure wears — ADR 0026 D-12 layer 3,
 * #475 — and the two that wear no photograph: `painted`, a signpost's pole,
 * and — since #500 — `glass`, a window's pane, which takes its look from the
 * environment the sky already lights the world with and costs no texture.
 */
export type StructureSurface =
  | 'brick'
  | 'roof-tiles'
  | 'slate'
  | 'stone'
  | 'planks'
  | 'corrugated'
  | 'hedge'
  | 'painted'
  | 'glass';

/** A surface that is a photograph. */
export type PhotographicSurface = Exclude<StructureSurface, 'painted' | 'glass'>;

/** Whether a surface is a photograph — every one but `painted` and `glass`. */
export function isPhotographic(surface: StructureSurface): surface is PhotographicSurface {
  return surface !== 'painted' && surface !== 'glass';
}

/** The surfaces that are a photograph, in a fixed order. */
export const PHOTOGRAPHIC_STRUCTURE_SURFACES: readonly PhotographicSurface[] = [
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
 * materials only. So the shapes are this repository's own, from numbers
 * (`buildings.ts` since #500), the same triangles the stylised world draws,
 * and what is photographic is what covers them.
 *
 * `painted` — a signpost's pole — carries no photograph: at 6 cm across there
 * is nothing on it for one to show.
 */
export const REALISTIC_STRUCTURE_SURFACES: Readonly<Record<PhotographicSurface, SurfaceMaps>> = {
  brick: structureMaps('brick_wall_02', 2),
  'roof-tiles': structureMaps('clay_roof_tiles_02', 2.5),
  slate: structureMaps('grey_roof_tiles_02', 1.5),
  stone: structureMaps('old_stone_wall', 2),
  planks: structureMaps('dark_planks', 2),
  corrugated: structureMaps('corrugated_iron', 1.12),
  hedge: structureMaps('forest_leaves_02', 3),
};

function structureMaps(id: string, tileMetres: number): SurfaceMaps {
  return { colour: `${id}_diff_512.ktx2`, normal: `${id}_nor_gl_512.ktx2`, tileMetres };
}

/**
 * What each part of each BUILDING wears, by what it is made of — #475, and
 * since #500 by `buildings.ts`' roles rather than by a list of parts, because a
 * building is walls with openings, a plinth, a roof with a ridge, joinery and
 * glass now rather than a block and a gable.
 *
 * ⚠️ **Every photograph here is one #475 already committed**: #500 adds no
 * texture. The joinery, the doors and a barn's base wear `planks`; a plinth, a
 * ridge and a door are the same photograph as their neighbour, darkened in the
 * vertex colour (`three-renderer.ts` §`REALISTIC_ROLE_SHADE`); and a pane is
 * `glass`, which is a material and no map at all.
 */
export const REALISTIC_BUILDING_SURFACES: Readonly<
  Record<BuiltKind, Readonly<Record<BuildingRole, StructureSurface>>>
> = {
  building: {
    wall: 'brick',
    plinth: 'brick',
    roof: 'roof-tiles',
    ridge: 'roof-tiles',
    chimney: 'brick',
    joinery: 'planks',
    door: 'planks',
    glass: 'glass',
  },
  barn: {
    wall: 'planks',
    plinth: 'planks',
    roof: 'corrugated',
    ridge: 'corrugated',
    chimney: 'planks',
    joinery: 'planks',
    door: 'planks',
    glass: 'glass',
  },
  church: {
    wall: 'stone',
    plinth: 'stone',
    roof: 'slate',
    ridge: 'slate',
    chimney: 'stone',
    joinery: 'planks',
    door: 'planks',
    glass: 'glass',
  },
  'shop-row': {
    wall: 'brick',
    plinth: 'brick',
    roof: 'slate',
    ridge: 'slate',
    chimney: 'brick',
    joinery: 'planks',
    door: 'planks',
    glass: 'glass',
  },
  shed: {
    wall: 'corrugated',
    plinth: 'corrugated',
    roof: 'corrugated',
    ridge: 'corrugated',
    chimney: 'corrugated',
    joinery: 'corrugated',
    door: 'corrugated',
    glass: 'glass',
  },
};

/**
 * Which surface each part of each field boundary and signpost wears, in the
 * order `three-renderer.ts` §`BOUNDARY_STYLE` builds the parts — #475. Each is
 * that table's own parts, part for part, so the realistic shape is the
 * stylised one with a surface on it.
 */
export const REALISTIC_BOUNDARY_PARTS: Readonly<
  Record<Exclude<StructureKind, BuiltKind>, readonly StructureSurface[]>
> = {
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
  /**
   * The same eight views' normals, for a tree — #630: what lights the far band
   * by the world's sun (`three-renderer.ts` §`impostorMaterial`). Present
   * exactly when {@link impostor} is.
   */
  readonly impostorNormals?: string;
  /**
   * The middle level of detail, for a tree — #617: the same scan thinned to
   * `realistic-budget.ts` §`REALISTIC_TRIANGLES`' `tree-middle`, carrying no
   * image, drawn between the nearest trees and the impostors
   * (`realistic-budget.ts` §`REALISTIC_TREE_LEVELS`). `undefined` for a shrub
   * or a rock, which have no far band to hand over to.
   */
  readonly middle?: string;
}

/**
 * The shapes, by kind, in variant order. An item's `variant` picks among them
 * modulo their count, exactly as `three-renderer.ts` §`ScatterBelt` does for the
 * stylised world — so the same item wears the same variant slot in both worlds
 * and only the shape changes (ADR 0026 D-2).
 */
export const REALISTIC_VEGETATION: Readonly<
  Record<RealisticVegetationKind, readonly RealisticModel[]>
> = {
  'tree-broadleaf': [
    {
      name: 'island_tree_02',
      file: 'island_tree_02.glb',
      impostor: 'island_tree_02-impostor.ktx2',
      impostorNormals: 'island_tree_02-impostor-normals.ktx2',
      middle: 'island_tree_02-middle.glb',
    },
    {
      name: 'tree_small_02',
      file: 'tree_small_02.glb',
      impostor: 'tree_small_02-impostor.ktx2',
      impostorNormals: 'tree_small_02-impostor-normals.ktx2',
      middle: 'tree_small_02-middle.glb',
    },
  ],
  'tree-conifer': [
    {
      name: 'fir_sapling_medium_a',
      file: 'fir_sapling_medium_a.glb',
      impostor: 'fir_sapling_medium_a-impostor.ktx2',
      impostorNormals: 'fir_sapling_medium_a-impostor-normals.ktx2',
      middle: 'fir_sapling_medium_a-middle.glb',
    },
    {
      name: 'fir_sapling_medium_b',
      file: 'fir_sapling_medium_b.glb',
      impostor: 'fir_sapling_medium_b-impostor.ktx2',
      impostorNormals: 'fir_sapling_medium_b-impostor-normals.ktx2',
      middle: 'fir_sapling_medium_b-middle.glb',
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
 * The rider's body — MakeHuman's CC0 base mesh, rigged and cut down (#369) —
 * and since #623 the helmet and glasses beside it, one mesh coloured per vertex.
 */
export const REALISTIC_RIDER = 'rider.glb';

/**
 * The rider's three maps — #623, drawn and baked by
 * `tools/realistic/blender/process_rider.py` onto the body's own texture
 * coordinates, dedicated `CC0-1.0` with the MakeHuman skin and eyebrow they
 * carry:
 *
 * - `colour` — the On Your Left house kit and the skin, BLACK where the kit's
 *   main colour is: that colour is not in any map. `orm`'s blue channel holds
 *   how much of it each texel is, and the renderer adds that share of one
 *   colour, which is what lets a rider's own colour (#623's second half) be
 *   one uniform;
 * - `normal` — baked from the full-resolution body, with the kit's seams and
 *   the riding pose's creases added;
 * - `orm` — three's own channel order: occlusion R, roughness G, and in B the
 *   main colour's share, which three does not read (no metalness map is set).
 */
export const REALISTIC_RIDER_MAPS = {
  colour: 'rider_kit_1024.ktx2',
  normal: 'rider_nor_gl_1024.ktx2',
  orm: 'rider_orm_1024.ktx2',
} as const;

/**
 * The rider's maps, averaged over every texel, in linear light — #623:
 * `unmasked` the colour map's mean (skin, bib, white, shoes; black where the
 * main colour is), and `shade` the mean of `orm`'s blue channel, the main
 * colour's share. The kit's mean under a main colour `c` is
 * `unmasked + shade · c`.
 *
 * It is what the browser gate's control draws the whole body in
 * (`three-renderer.ts` §`riderBodyMaterial`), so the kit's pattern is compared
 * with its own mean colour rather than with some other flat colour. Read off
 * the pipeline's pictures; `realistic-textures.test.ts` decodes the committed
 * maps and holds these to what they carry.
 */
export const REALISTIC_RIDER_KIT_MEAN = {
  unmasked: [0.2169, 0.1493, 0.1163],
  shade: 0.1776,
} as const;

/** Which of the rider's maps. */
export type RealisticRiderMap = keyof typeof REALISTIC_RIDER_MAPS;

/** The rider's maps, in a fixed order. */
export const REALISTIC_RIDER_MAP_NAMES: readonly RealisticRiderMap[] = ['colour', 'normal', 'orm'];

/**
 * The realistic bicycle's four small maps — #624: drawn from arithmetic by
 * `tools/realistic/draw-bicycle-maps.ts`, nothing downloaded (ADR 0026 D-4,
 * ADR 0032 D-1), dedicated `CC0-1.0` as this repository's icons are. What each
 * part samples on them is `bicycle-surfaces.ts`.
 *
 * - `rubberNormal` — the tyres' tread, shoulder and sidewall, and the bar tape;
 * - `metalNormal` and `metalRoughness` — the chainring's teeth and chain, and
 *   the cassette on the rear hub's drive side;
 * - `paintRoughness` — the frame's clear coat, as roughness alone: not
 *   `MeshPhysicalMaterial`, whose clear-coat term is a second specular lobe on
 *   every fragment the frame covers.
 */
export const REALISTIC_BICYCLE_MAPS = {
  rubberNormal: 'bicycle_rubber_nor_gl_256.ktx2',
  metalNormal: 'bicycle_metal_nor_gl_256.ktx2',
  metalRoughness: 'bicycle_metal_rough_256.ktx2',
  paintRoughness: 'bicycle_paint_rough_128.ktx2',
} as const;

/** Which of the bicycle's maps. */
export type RealisticBicycleMap = keyof typeof REALISTIC_BICYCLE_MAPS;

/** The bicycle's maps, in a fixed order. */
export const REALISTIC_BICYCLE_MAP_NAMES: readonly RealisticBicycleMap[] = [
  'rubberNormal',
  'metalNormal',
  'metalRoughness',
  'paintRoughness',
];

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
    REALISTIC_SURFACES.verge.colour,
    REALISTIC_SURFACES.verge.normal,
    REALISTIC_SURFACES.rock.colour,
    REALISTIC_SURFACES.rock.normal,
    ...REALISTIC_VEGETATION_KINDS.flatMap((kind) =>
      REALISTIC_VEGETATION[kind].flatMap((model) =>
        [model.file, model.impostor, model.impostorNormals, model.middle].filter(
          (file): file is string => file !== undefined,
        ),
      ),
    ),
    ...PHOTOGRAPHIC_STRUCTURE_SURFACES.flatMap((surface) => [
      REALISTIC_STRUCTURE_SURFACES[surface].colour,
      REALISTIC_STRUCTURE_SURFACES[surface].normal,
    ]),
    REALISTIC_RIDER,
    ...REALISTIC_RIDER_MAP_NAMES.map((map) => REALISTIC_RIDER_MAPS[map]),
    ...REALISTIC_BICYCLE_MAP_NAMES.map((map) => REALISTIC_BICYCLE_MAPS[map]),
  ];
}

/**
 * What came of asking for the realistic world — `three-renderer.ts`
 * §`loadRealisticWorld`. All of it loaded, or none of it did and the view
 * draws the stylised world.
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
 * Since #475 it is on the ride's stage (`GameView.tsx` §`worldNotice`) as well
 * as the owner's harness page.
 *
 * @param inShell whether this is the Android shell; read from the real
 * Capacitor global unless a caller says
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

/**
 * What a rider who chose the realistic world is told BEFORE a ride, on the
 * route picker — #475's *"the offline fallback stated in the ride UI"*.
 *
 * ⚠️ **Before as well as after**, because the after is conditional: a rider who
 * is offline finds out only once the ride has started, and a rider deciding
 * whether to ride in a basement should not have to start one to learn it. The
 * two sentences differ for {@link realisticWorldNotice}'s reason: inside the
 * Android shell the set ships in the APK (D-7), so "not kept for offline use"
 * would be false there.
 *
 * @param inShell whether this is the Android shell; read from the real
 * Capacitor global unless a caller says
 */
export function realisticWorldChosenText(
  inShell: boolean = isNativeShell(platformCapacitor()),
): string {
  return inShell
    ? 'Your rides are in the realistic world. If it cannot be loaded, the ride is in the standard world instead and the ride screen says so.'
    : 'Your rides are in the realistic world. It is fetched when a ride starts and is not kept on this device for use offline, so with no network — or if it cannot be loaded — the ride is in the standard world instead and the ride screen says so.';
}

/**
 * What a rider is told when the device ran too hot for the realistic world and
 * the ride stepped down to the standard one — `quality.ts`
 * §`nextWorldQuality`, which never climbs back.
 *
 * ⚠️ **Said, not silent**, on D-7's argument turned to heat: *"a silent
 * downgrade is a rider wondering whether the setting broke"*, and a rider who
 * chose the realistic world and watched it turn into the standard one mid-ride
 * has exactly that question. It says what happened and that it lasts the ride,
 * and nothing about temperatures a rider cannot act on.
 */
export const REALISTIC_WORLD_LEFT_NOTICE =
  'This device was working too hard for the realistic world, so the rest of this ride is in the standard world.';
