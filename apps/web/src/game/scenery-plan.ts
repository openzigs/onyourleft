// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which tree, bush, rock seat and boundary the realistic world draws WHERE —
 * #3252, under [ADR 0099](../../../../docs/adr/0099-model-sources-for-modern-buildings-trees-and-track-and-what-a-new-model-owes.md).
 *
 * ## A setting, and what grows in it
 *
 * `scatter.ts` knows what the ground is where a ride has map data — a wood,
 * its edge, a field's hedgerow, open pasture, a park — and until #3252 the
 * renderer threw that away: an item carried a kind and a variant slot, and
 * every broadleaf anywhere was one of the same four shapes. An item now
 * carries its {@link ScenerySetting}, and this file says which shape each
 * slot of each kind is drawn as there ({@link shapeNameFor}). So a hedgerow
 * is field maples and thorn, a park is limes and poplars, and a wood is still
 * the forest it was.
 *
 * ## ⚠️ `wild` is the world as it was, shape for shape
 *
 * An item with no setting — every item of a ride with no map data, the
 * stylised world's, the browser gate's wooded and village views — is `wild`,
 * and `wild`'s tables are exactly what `variant % count` gave before #3252
 * (`scenery-plan.test.ts` holds that against `realistic-assets.ts`). No size
 * or shape there moved, so no figure the gate measures there did.
 *
 * ## ⚠️ No setting draws more shapes of a kind than `wild` does
 *
 * A shape is a draw call a level (`realistic-budget.ts`
 * §`REALISTIC_WOODED_DRAW_CALLS`). The trees' full and middle levels are
 * bounded by `tree-levels.ts`' slots whatever the number of shapes, and a
 * grown tree's far band is its host's impostor mesh (`grown-trees.ts`), so
 * the trees' worst frame makes the calls it made. A shrub is a call a shape
 * among the nearest eight: each setting names at most two, as `wild` does,
 * and a frame that straddles two settings can draw one or two more.
 * `scenery-plan.test.ts` holds the per-setting count.
 *
 * ## Seeded, by where an item stands
 *
 * {@link ageScale}, {@link instanceBuild} and {@link rockSeat} are hashed
 * from an item's position with `seeded.ts`, each on a stream of its own, as
 * `instance-tint.ts` §`packedInstanceTint` is (#621): the same on every
 * frame, on lap two and on the next ride, and costing no geometry, no
 * texture and no draw call.
 *
 * Pure: no rendering library, no file, no network.
 */

import { mixInto, uniformFrom } from './seeded';

/**
 * Where an item stands, as `scatter.ts` reads it off the ride's land-class
 * mask (#1542's plantings):
 *
 * - `wild` — no map data here: the procedural world, as it was;
 * - `open` — mapped, and no land use says what it is: unclassified countryside;
 * - `wood`, `wood-edge` — a mapped wood, and the scrubby strip at its edge;
 * - `hedgerow`, `pasture` — a mapped field's roadside or edge, and its open middle;
 * - `park` — a mown park, a cemetery, a playground, a golf course's stand.
 */
export type ScenerySetting =
  'wild' | 'open' | 'wood' | 'wood-edge' | 'hedgerow' | 'pasture' | 'park';

/** Every setting, in a fixed order. */
export const SCENERY_SETTINGS: readonly ScenerySetting[] = [
  'wild',
  'open',
  'wood',
  'wood-edge',
  'hedgerow',
  'pasture',
  'park',
];

/** The kinds this file plans: the four the realistic world has shapes for. */
export type PlannedKind = 'tree-broadleaf' | 'tree-conifer' | 'shrub' | 'rock';

/** How many variant slots a table has: `scatter.ts` §`SCATTER_VARIANT_SLOTS`. */
export const PLAN_SLOTS = 6;

/**
 * One kind of tree or bush: what it reads as, the shapes it is drawn as, and
 * how it is made. `committed` shapes are files under `public/realistic/`
 * (`realistic-assets.ts`); `grown` ones are generated in code when the world
 * loads (`grown-trees.ts`), which adds no file to the build.
 */
export interface ScenerySpecies {
  readonly id: string;
  readonly kind: Exclude<PlannedKind, 'rock'>;
  readonly words: string;
  readonly making: 'committed' | 'grown';
  /** Its shapes, by `RealisticShape.name`. */
  readonly shapes: readonly string[];
}

/**
 * Every tree and bush species the realistic world draws: **seven trees** —
 * five broadleaves and two conifers — and **three bushes**.
 *
 * ⚠️ **A grown species is named for its FORM.** It wears the scanned bark
 * and leaves of the committed tree it is hosted by (`grown-trees.ts`), which
 * is all the build's ceiling has room for (`realistic-budget.ts`
 * §`REALISTIC_BUILD_BYTES`, 231 387 bytes under on 2026-11-26): a lime here
 * is a clear stem under a dense ovoid crown in a hornbeam's leaves, not a
 * botanist's lime.
 */
export const SCENERY_SPECIES: readonly ScenerySpecies[] = [
  {
    id: 'oak',
    kind: 'tree-broadleaf',
    words: 'a broad, spreading crown on a short trunk',
    making: 'committed',
    shapes: ['generated_oak_a', 'generated_oak_c'],
  },
  {
    id: 'hornbeam',
    kind: 'tree-broadleaf',
    words: 'a tall, narrow crown of ascending limbs',
    making: 'committed',
    shapes: ['generated_hornbeam_a', 'generated_hornbeam_c'],
  },
  {
    id: 'lime',
    kind: 'tree-broadleaf',
    words: 'a clear stem under a dense ovoid crown: a park and avenue tree',
    making: 'grown',
    shapes: ['grown_lime'],
  },
  {
    id: 'field-maple',
    kind: 'tree-broadleaf',
    words: 'a short trunk under a low, wide, rounded crown: a hedgerow tree',
    making: 'grown',
    shapes: ['grown_field_maple'],
  },
  {
    id: 'poplar',
    kind: 'tree-broadleaf',
    words: 'a tall column of limbs held close to the stem: a windbreak tree',
    making: 'grown',
    shapes: ['grown_poplar'],
  },
  {
    id: 'fir',
    kind: 'tree-conifer',
    words: 'a narrow cone of drooping boughs on one straight stem',
    making: 'committed',
    shapes: ['generated_fir_a', 'generated_fir_b'],
  },
  {
    id: 'spruce',
    kind: 'tree-conifer',
    words: 'a broad, skirted cone whose boughs sweep down and lift at their tips',
    making: 'grown',
    shapes: ['grown_spruce'],
  },
  {
    id: 'scrub',
    kind: 'shrub',
    words: 'a ragged wild shrub',
    making: 'committed',
    shapes: ['shrub_02_a', 'shrub_02_c'],
  },
  {
    id: 'thorn',
    kind: 'shrub',
    words: 'a dense, rounded thorn bush: a hedgerow bush',
    making: 'grown',
    shapes: ['grown_thorn'],
  },
  {
    id: 'laurel',
    kind: 'shrub',
    words: 'a compact evergreen dome: a park and garden bush',
    making: 'grown',
    shapes: ['grown_laurel'],
  },
];

const ROCK = ['boulder_01'] as const;

/** A table: the shape each of the {@link PLAN_SLOTS} variant slots is drawn as. */
type Slots = readonly [string, string, string, string, string, string];

const OAK_A = 'generated_oak_a';
const OAK_C = 'generated_oak_c';
const HORNBEAM_A = 'generated_hornbeam_a';
const HORNBEAM_C = 'generated_hornbeam_c';
const FIR_A = 'generated_fir_a';
const FIR_B = 'generated_fir_b';
const LIME = 'grown_lime';
const MAPLE = 'grown_field_maple';
const POPLAR = 'grown_poplar';
const SPRUCE = 'grown_spruce';
const SCRUB_A = 'shrub_02_a';
const SCRUB_C = 'shrub_02_c';
const THORN = 'grown_thorn';
const LAUREL = 'grown_laurel';

/** The forest, as `variant % 4`, `% 2` and `% 2` drew it before #3252. */
const FOREST: Readonly<Record<Exclude<PlannedKind, 'rock'>, Slots>> = {
  'tree-broadleaf': [OAK_A, HORNBEAM_A, OAK_C, HORNBEAM_C, OAK_A, HORNBEAM_A],
  'tree-conifer': [FIR_A, FIR_B, FIR_A, FIR_B, FIR_A, FIR_B],
  shrub: [SCRUB_A, SCRUB_C, SCRUB_A, SCRUB_C, SCRUB_A, SCRUB_C],
};

/**
 * What each slot of each kind is drawn as in each setting. A table and not a
 * rule, so that what a hedgerow is can be read here and changed here.
 */
export const SCENERY_PLAN: Readonly<
  Record<ScenerySetting, Readonly<Record<Exclude<PlannedKind, 'rock'>, Slots>>>
> = {
  wild: FOREST,
  // A mapped wood is the forest too: plantations and old woodland alike.
  wood: FOREST,
  open: {
    'tree-broadleaf': [OAK_A, MAPLE, HORNBEAM_C, OAK_C, MAPLE, OAK_A],
    'tree-conifer': [FIR_A, SPRUCE, FIR_A, SPRUCE, FIR_A, SPRUCE],
    shrub: [THORN, SCRUB_A, THORN, SCRUB_A, THORN, SCRUB_A],
  },
  'wood-edge': {
    'tree-broadleaf': [MAPLE, OAK_A, HORNBEAM_A, MAPLE, OAK_C, MAPLE],
    'tree-conifer': [SPRUCE, FIR_A, SPRUCE, FIR_A, SPRUCE, FIR_A],
    shrub: [THORN, SCRUB_C, THORN, SCRUB_C, THORN, THORN],
  },
  hedgerow: {
    'tree-broadleaf': [MAPLE, OAK_A, MAPLE, MAPLE, OAK_C, MAPLE],
    'tree-conifer': [SPRUCE, FIR_B, SPRUCE, FIR_B, SPRUCE, FIR_B],
    shrub: [THORN, THORN, SCRUB_A, THORN, THORN, SCRUB_A],
  },
  pasture: {
    'tree-broadleaf': [OAK_A, OAK_C, POPLAR, OAK_A, MAPLE, OAK_C],
    'tree-conifer': [SPRUCE, FIR_A, SPRUCE, FIR_A, SPRUCE, FIR_A],
    shrub: [THORN, SCRUB_A, THORN, SCRUB_A, THORN, SCRUB_A],
  },
  park: {
    'tree-broadleaf': [LIME, LIME, HORNBEAM_A, POPLAR, LIME, OAK_A],
    'tree-conifer': [SPRUCE, SPRUCE, FIR_B, SPRUCE, SPRUCE, FIR_B],
    shrub: [LAUREL, LAUREL, THORN, LAUREL, LAUREL, THORN],
  },
};

/** An item's variant folded into the slots, as `three-renderer.ts` §`variantOf` folds one. */
function slotOf(variant: number): number {
  const wanted = Number.isInteger(variant) ? variant : 0;
  return ((wanted % PLAN_SLOTS) + PLAN_SLOTS) % PLAN_SLOTS;
}

/** The shape a `kind` in a `setting` is drawn as, for an item's `variant`. */
export function shapeNameFor(
  kind: PlannedKind,
  setting: ScenerySetting | undefined,
  variant: number,
): string {
  if (kind === 'rock') return ROCK[0];
  return SCENERY_PLAN[setting ?? 'wild'][kind][slotOf(variant)] as string;
}

/** The species a shape is of, or `undefined` for a shape this file does not name. */
export function speciesOfShape(shape: string): ScenerySpecies | undefined {
  return SPECIES_OF_SHAPE.get(shape);
}

/** Each shape's species, looked up and not searched for: a frame asks for every item. */
const SPECIES_OF_SHAPE: ReadonlyMap<string, ScenerySpecies> = new Map(
  SCENERY_SPECIES.flatMap((species) => species.shapes.map((shape) => [shape, species] as const)),
);

/**
 * The species a setting grows of one kind, each once, in slot order.
 *
 * @test-facing held by `scenery-plan.test.ts`, which reads what each setting
 * grows off it; a frame asks {@link shapeNameFor} through {@link slotTable}
 */
export function speciesIn(
  setting: ScenerySetting,
  kind: Exclude<PlannedKind, 'rock'>,
): readonly ScenerySpecies[] {
  const found: ScenerySpecies[] = [];
  for (const shape of SCENERY_PLAN[setting][kind]) {
    const species = speciesOfShape(shape);
    if (species !== undefined && !found.includes(species)) found.push(species);
  }
  return found;
}

/**
 * The indices into `shapes` (a loaded world's shapes of one kind, by name)
 * that each slot of `setting` is drawn as — or `undefined` when the world
 * does not hold every shape the table names: a world loaded from the scans
 * (`realistic-assets.ts` §`RealisticTrees`), or a test's. Its caller then
 * folds the variant into what it has, as every world did before #3252.
 */
export function slotTable(
  kind: PlannedKind,
  setting: ScenerySetting,
  shapes: readonly string[],
): readonly number[] | undefined {
  const table: number[] = [];
  for (let slot = 0; slot < PLAN_SLOTS; slot += 1) {
    const index = shapes.indexOf(shapeNameFor(kind, setting, slot));
    if (index < 0) return undefined;
    table.push(index);
  }
  return table;
}

/** A range a seeded number is drawn from, lowest then highest. */
export type Range = readonly [number, number];

/**
 * How much bigger than its kind's fitted size a species stands in a setting —
 * its AGE there: a lone field oak is old and big, a hedgerow maple is cut
 * back, a park's lime is a specimen. Multiplies `ScatterItem.scale`, which
 * already spreads every item 0.7 to 1.4 (`scatter.ts`).
 *
 * ⚠️ `wild` and `wood` have no entry and are 1, exactly: the forest is the
 * size it was. The most any entry reaches is {@link AGE_SCALE_HIGHEST}.
 */
export const AGE_SCALE: Readonly<Partial<Record<ScenerySetting, Readonly<Record<string, Range>>>>> =
  {
    open: { oak: [1, 1.35], 'field-maple': [0.85, 1.15], spruce: [0.9, 1.25] },
    'wood-edge': { 'field-maple': [0.8, 1.1], thorn: [0.9, 1.3], spruce: [0.8, 1.1] },
    hedgerow: { 'field-maple': [0.8, 1.15], oak: [1.05, 1.4], thorn: [0.9, 1.35] },
    pasture: { oak: [1.2, 1.5], poplar: [1.3, 1.5], 'field-maple': [0.9, 1.2] },
    park: { lime: [1.15, 1.5], poplar: [1.3, 1.5], hornbeam: [1, 1.3], oak: [1.1, 1.4] },
  };

/**
 * The most {@link ageScale} returns: **1.5**. Every guard that clears an
 * item reads {@link drawnScale}, which carries it.
 */
export const AGE_SCALE_HIGHEST = 1.5;

/** The seeds of this file's hashes — each its own, as `instance-tint.ts` §`TINT_SEED` is. */
const AGE_SEED = 0x3252_a6e5;
const BUILD_SEED = 0x3252_b01d;
const SEAT_SEED = 0x3252_5ea7;

/** Where an item stands, to a sixteenth of a metre: `instance-tint.ts`' key. */
const KEY_STEPS_PER_METRE = 16;

function keyOf(seed: number, x: number, z: number): number {
  return mixInto(
    mixInto(seed, Math.round(x * KEY_STEPS_PER_METRE)),
    Math.round(z * KEY_STEPS_PER_METRE),
  );
}

const lerp = (range: Range, share: number): number => range[0] + (range[1] - range[0]) * share;

/**
 * How big the item standing at `(x, z)` is drawn, of its fitted size: its
 * species' {@link AGE_SCALE} in its setting, by a hash of where it stands.
 * 1 where the setting or the species has no entry.
 */
export function ageScale(
  setting: ScenerySetting | undefined,
  shape: string,
  x: number,
  z: number,
): number {
  if (setting === undefined) return 1;
  const species = speciesOfShape(shape);
  const range = species === undefined ? undefined : AGE_SCALE[setting]?.[species.id];
  if (range === undefined) return 1;
  return Math.min(AGE_SCALE_HIGHEST, lerp(range, uniformFrom(keyOf(AGE_SEED, x, z), 0)));
}

/** How far an instance's height and girth may each move from its size: ±8 % and ±10 %. */
export const BUILD_BOUND = { height: 0.08, girth: 0.1 } as const;

/** One instance's build. @see instanceBuild */
export interface InstanceBuild {
  /** What its height is multiplied by. */
  readonly height: number;
  /** What its width, both ways, is multiplied by. */
  readonly girth: number;
}

/**
 * The build of the item standing at `(x, z)`: a little taller or shorter and
 * a little stouter or slimmer than the next one, each from its own stream, so
 * that two trees of one shape at one scale are still not copies. Written into
 * `out`, which is returned: a frame calls it for every item it draws.
 *
 * ⚠️ `wild` — no setting — is `1, 1`: the procedural world is drawn as it was.
 */
export function instanceBuild(
  setting: ScenerySetting | undefined,
  x: number,
  z: number,
  out: { height: number; girth: number },
): InstanceBuild {
  if (setting === undefined || setting === 'wild') {
    out.height = 1;
    out.girth = 1;
    return out;
  }
  const key = keyOf(BUILD_SEED, x, z);
  out.height = 1 + (2 * uniformFrom(key, 0) - 1) * BUILD_BOUND.height;
  out.girth = 1 + (2 * uniformFrom(key, 1) - 1) * BUILD_BOUND.girth;
  return out;
}

/** What {@link drawnScale} reads of an item. */
export interface ScaledItem {
  readonly kind: string;
  readonly x: number;
  readonly z: number;
  readonly scale: number;
  readonly variant: number;
  readonly setting?: ScenerySetting;
}

/** How big an item is drawn, of its kind's fitted size: across, both ways in plan, and up. */
export interface DrawnScale {
  readonly across: number;
  readonly up: number;
}

const PLANNED: ReadonlySet<string> = new Set(['tree-broadleaf', 'tree-conifer', 'shrub', 'rock']);
const BUILD_SCRATCH = { height: 1, girth: 1 };
const SCALE_SCRATCH = { across: 1, up: 1 };

/**
 * How big an item is DRAWN, of its kind's fitted size — its `scale`, its
 * species' age in its setting ({@link ageScale}) and its own build
 * ({@link instanceBuild}), together.
 *
 * ⚠️ **The one statement of it, and every reader takes it from here** —
 * #3252's review: the renderer sized a tree by all three while the guards
 * that keep it out of the camera, off a side road and in the ranking read
 * `scale` alone, so a park's lime drawn 1.5 × 1.1 times wider than its
 * clearance could stand across a driveway. `three-renderer.ts`
 * §`RealisticVegetationBelt` draws by this, `near-field.ts` §`intrudes` and
 * §`shapeMeets` cut by it, and `scene.ts` §`sideRoadNaturalMargin` clears by
 * it. A structure, a post and every item with no setting is its `scale`,
 * both ways.
 *
 * The species is the one the PLAN names for the item's slot
 * ({@link shapeNameFor}), whatever shapes a world holds, so a guard that has
 * no world to ask reads the same number the renderer does.
 *
 * ⚠️ Returns ONE object, rewritten by the next call: read it before calling
 * again. A frame calls this for every item, and allocates nothing.
 */
export function drawnScale(item: ScaledItem): DrawnScale {
  if (item.setting === undefined || !PLANNED.has(item.kind)) {
    SCALE_SCRATCH.across = item.scale;
    SCALE_SCRATCH.up = item.scale;
    return SCALE_SCRATCH;
  }
  const shape = shapeNameFor(item.kind as PlannedKind, item.setting, item.variant);
  const aged = item.scale * ageScale(item.setting, shape, item.x, item.z);
  const build = instanceBuild(item.setting, item.x, item.z, BUILD_SCRATCH);
  SCALE_SCRATCH.across = aged * build.girth;
  SCALE_SCRATCH.up = aged * build.height;
  return SCALE_SCRATCH;
}

/**
 * The most {@link drawnScale} can make of a `scale` of 1, either way: the
 * oldest tree at its stoutest or its tallest.
 *
 * @test-facing held by `scenery-plan.test.ts`, which holds every drawn scale
 * under it; the guards read {@link drawnScale} for the item in hand
 */
export const DRAWN_SCALE_HIGHEST =
  AGE_SCALE_HIGHEST * (1 + Math.max(BUILD_BOUND.height, BUILD_BOUND.girth));

/**
 * How a rock sits: sunk into the ground by a share of its height, and tipped.
 *
 * A boulder used to stand ON the ground at its lowest point, level, so on any
 * slope one side of it hung in the air and every rock was the same rock the
 * same way up. It is now set {@link ROCK_SEAT}'s `sink` of its height into
 * the ground and tipped up to its `tiltRadians` about a horizontal axis of
 * its own, both hashed from where it stands.
 */
export const ROCK_SEAT = {
  /** The share of its height below the ground: 18 % to 38 %. */
  sink: [0.18, 0.38] as Range,
  /** The most it is tipped, radians: 14°. */
  tiltRadians: (14 * Math.PI) / 180,
} as const;

/** One rock's seat. @see rockSeat */
export interface RockSeat {
  /** The share of its drawn height that is below the ground. */
  readonly sink: number;
  /** How far it is tipped, radians, and about which horizontal direction. */
  readonly tilt: number;
  readonly azimuth: number;
}

/** The seat of the rock standing at `(x, z)`, written into `out`, which is returned. */
export function rockSeat(
  x: number,
  z: number,
  out: { sink: number; tilt: number; azimuth: number },
): RockSeat {
  const key = keyOf(SEAT_SEED, x, z);
  out.sink = lerp(ROCK_SEAT.sink, uniformFrom(key, 0));
  out.tilt = uniformFrom(key, 1) * ROCK_SEAT.tiltRadians;
  out.azimuth = uniformFrom(key, 2) * Math.PI * 2;
  return out;
}

/**
 * The boundaries the realistic world builds, and the setting each stands in.
 * `three-renderer.ts` builds each from numbers (`BOUNDARY_STYLE`,
 * `stoneWallGeometry`, `builtFenceGeometry`); nothing is downloaded.
 */
export type BoundaryType =
  'stone-wall' | 'hedge' | 'post-and-rail' | 'timber-fence' | 'chain-link' | 'noise-barrier';

/** What a boundary stands beside. @see boundaryFor */
export type BoundarySetting =
  'upland-field' | 'field' | 'field-by-wood' | 'garden' | 'works' | 'highway';

/**
 * Which boundary a setting gets:
 *
 * | Beside | Boundary | Placed by |
 * |---|---|---|
 * | a field on high or steep ground | a drystone wall | `settlements.ts` (walled) |
 * | a field | a hedge | `settlements.ts` |
 * | a field where it meets a wood or a park | a post-and-rail fence | `settlements.ts` §`landEdgesAt` |
 * | allotments or a mapped garden | a close-board timber fence | `chain-link.ts` §`TIMBER_FENCE_KINDS` |
 * | an industrial, school or sports ground | a chain-link fence | `chain-link.ts` (#1274) |
 * | a highway where it passes built-up land | a noise barrier | `chain-link.ts` §`noiseBarrierPieces` |
 */
export const BOUNDARY_PLAN: Readonly<Record<BoundarySetting, BoundaryType>> = {
  'upland-field': 'stone-wall',
  field: 'hedge',
  'field-by-wood': 'post-and-rail',
  garden: 'timber-fence',
  works: 'chain-link',
  highway: 'noise-barrier',
};

/** The boundary a setting gets. @see BOUNDARY_PLAN */
export function boundaryFor(setting: BoundarySetting): BoundaryType {
  return BOUNDARY_PLAN[setting];
}

/**
 * The shapes the realistic world draws a `fence` item as, by its `variant`:
 * the field's post-and-rail, with the chain-link folded into its mesh
 * (`three-renderer.ts` §`chainLinkFenceGeometry`, #1274), and the BUILT
 * fences, the timber fence with the noise barrier folded into its mesh
 * (§`builtFenceGeometry`). The stylised world has one fence, and folds every
 * variant into it.
 */
export const FENCE_VARIANTS = ['field', 'built'] as const;

/** The `variant` a `fence` item of a boundary type carries: 1 for a built fence, 0 for every other. */
export function fenceVariantOf(type: BoundaryType): number {
  return type === 'timber-fence' || type === 'noise-barrier'
    ? FENCE_VARIANTS.indexOf('built')
    : FENCE_VARIANTS.indexOf('field');
}

/**
 * Whether a `fence` item is drawn in its own vertices' colours and not the
 * planks' photograph — 1 for the chain-link and the noise barrier, 0 for the
 * field fence and the timber fence. It is what the fence's material is told
 * for each instance (`three-renderer.ts` §`ScatterFold`).
 */
export function fenceFoldOf(item: {
  readonly chainLink?: true;
  readonly boundary?: 'timber-fence' | 'noise-barrier';
}): number {
  return item.chainLink === true || item.boundary === 'noise-barrier' ? 1 : 0;
}
