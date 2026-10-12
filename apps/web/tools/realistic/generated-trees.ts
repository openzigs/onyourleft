// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The realistic world's GENERATED trees: every number each is made from, and
 * the geometry those numbers make — #1283, under
 * [ADR 0049](../../../../docs/adr/0049-open-asset-sources-for-the-realistic-world.md) D-1.
 *
 * ## What is recorded, and why it is here
 *
 * ADR 0049 D-1 admits a tree EZ-Tree writes **when the generator's version,
 * the seed and every parameter are committed beside the script that runs it**.
 * This file is that record:
 *
 * - `sources.ts` §`PINNED_EZ_TREE` names the one release, as `PINNED_BLENDER`
 *   names Blender's; `ez-tree.ts` loads it and refuses any other;
 * - {@link GENERATED_SPECIES} is every parameter of each species, written out
 *   in full — none is left to the generator's defaults, so a later release
 *   that changed a default could not move a tree — with the bark and leaves it
 *   wears, which are ambientCG's or, since #1294, Poly Haven's (`sources.ts`
 *   §`SOURCES`; ADR 0049's amendment of 2026-10-12);
 * - {@link GENERATED_TREES} is each tree: its species, its seed, and the
 *   SHA-256 of the geometry those make at each level of detail.
 *
 * ## The geometry is held by its digest, on every machine that runs the tests
 *
 * {@link geometryDigest} is over the bytes handed to Blender — float32
 * positions, normals and coordinates, and the indices. `generated-trees.test.ts`
 * generates every tree at every level and compares, in CI as well as on the
 * machine that made the committed files, so ADR 0049's open question — is
 * EZ-Tree's output byte-stable across machines and Node versions — is answered
 * by a red test rather than by a sentence. What was measured is in that
 * file's header.
 *
 * ## Three levels, each made to its budget
 *
 * A scan is cut down: its million leaf triangles are thinned and its wood is
 * collapsed until it fits. A generated tree is asked for at the size wanted.
 *
 * - **full** — the species' own parameters.
 * - **middle** — the SAME tree, generated again from the same seed with fewer
 *   sides round each branch, its finest twigs left out, and one leaf card in
 *   every few kept and enlarged ({@link LevelPlan}). ⚠️ **Only numbers the
 *   generator's random stream does not read are changed**: the count of sides
 *   round a branch draws nothing from it, where the count of sections along
 *   one, the count of children and the count of leaves all do — so the middle
 *   level's trunk and limbs are the full level's, point for point, and the
 *   hand-over between them (`tree-levels.ts`) dithers one shape into itself.
 *   `generated-trees.test.ts` holds that.
 * - **impostor** — Blender's eight views of the full level, as a scan's are.
 *
 * The fir (#1294) is made the same way with one difference a reader should
 * not have to find: its middle level keeps the stem's wood and NONE of its
 * boughs', whose sprig cards then stand where the boughs were. A bough is
 * a few centimetres thick and behind its own needles from 20 m.
 *
 * ⚠️ **Nothing of EZ-Tree's own images is read** (ADR 0049 D-1: its README
 * does not say where they came from). The generator's module asks for them
 * when it is loaded; `ez-tree.ts` answers every such request with nothing, and
 * what this file takes from a generated tree is its numbers alone.
 *
 * Pure: no file, no network, and no import of the generator — {@link treeLevel}
 * is handed one that `ez-tree.ts` loaded.
 */

import { createHash } from 'node:crypto';

/** A number for each branch level, the trunk being level 0. */
export type PerLevel = readonly [number, number, number, number];

/**
 * Every parameter EZ-Tree 1.1.0's `TreeOptions` reads to make a tree's shape
 * (its `src/lib/options.js`), in the generator's own names and units. The
 * trellis is left off (`trellis.enabled: false`), and the bark's and leaves'
 * `type`, `tint` and `textured` are not here because they only choose the
 * generator's own images, which are not taken.
 */
export interface TreeParameters {
  readonly type: 'deciduous' | 'evergreen';
  /** Branch recursion levels: 3 is a trunk, limbs, branches and twigs. */
  readonly levels: number;
  /** A child branch's angle from its parent, degrees; index 0 is unused. */
  readonly angle: PerLevel;
  /** Children per branch of each level; index 3 is unused. */
  readonly children: PerLevel;
  /** The growth force: its direction and strength. */
  readonly force: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly strength: number;
  };
  readonly gnarliness: PerLevel;
  readonly length: PerLevel;
  /** A child's radius as a share of its parent's where it leaves it; index 0 is the trunk's own. */
  readonly radius: PerLevel;
  /** Sections along a branch of each level. ⚠️ The random stream reads this. */
  readonly sections: PerLevel;
  /** Sides round a branch of each level. The random stream does NOT read this. */
  readonly segments: PerLevel;
  /** Where along its parent a child may start; index 0 is unused. */
  readonly start: PerLevel;
  readonly taper: PerLevel;
  readonly twist: PerLevel;
  readonly leaves: {
    readonly billboard: 'single' | 'double';
    readonly angle: number;
    /** Leaf cards along each twig, beside the one at its tip. */
    readonly count: number;
    readonly start: number;
    readonly size: number;
    readonly sizeVariance: number;
  };
}

/** How one level of detail is made from a species' parameters. @see treeLevel */
export interface LevelPlan {
  /** Sides round a branch of each level, in place of the species' own. */
  readonly segments: PerLevel;
  /** The deepest branch level whose wood is kept: 3 keeps the twigs, 2 leaves them out. */
  readonly deepestWood: number;
  /** One leaf card in this many is kept, counted in the order they were generated. */
  readonly leafEvery: number;
  /** How much a kept card is enlarged about the point it grows from. */
  readonly leafGrowth: number;
}

/**
 * One rectangle of an atlas, holding one whole cutting — #1294. Poly Haven's
 * fir twig atlas is not a grid: its seven sprigs are of seven sizes, laid
 * where they fitted, so each is named by the rectangle it lies in.
 */
export interface AtlasRect {
  /** Its left and top edges, texels from the atlas's top left, at the size the lock pins. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Which way the cutting's tip points in the atlas, degrees anticlockwise from up. */
  readonly turn: number;
}

/**
 * Where an atlas keeps its leaves: a regular grid of single leaves all
 * pointing one way (#1283's ambientCG atlases), or a list of rectangles, each
 * a whole sprig with its own turn (#1294's fir twigs).
 */
export type AtlasCells =
  | {
      /** The atlas's grid of leaves: columns and rows. */
      readonly grid: readonly [number, number];
      /** Which way a leaf's tip points in the atlas, degrees anticlockwise from up. */
      readonly atlasTurn: number;
    }
  | { readonly rects: readonly AtlasRect[] };

/** How many leaves an atlas holds: the most a {@link SprigLeaf.cell} may name, and one more. */
export function cellCount(cells: AtlasCells): number {
  return 'rects' in cells ? cells.rects.length : cells.grid[0] * cells.grid[1];
}

/** One placement of a scanned leaf on a species' leaf card. @see GeneratedSpecies.sprig */
export interface SprigLeaf {
  /**
   * Which leaf of the atlas: counted along a grid's rows from the top left, or
   * an index into its rectangles.
   */
  readonly cell: number;
  /** Where the leaf's stalk end goes on the card, as shares of its side, from the bottom left. */
  readonly at: readonly [number, number];
  /** Which way the leaf points, degrees anticlockwise from up the card. */
  readonly turn: number;
  /** The leaf's length, as a share of the card's side. */
  readonly length: number;
}

/**
 * One shoot of a sprig: leaves set alternately down its two sides at even
 * steps, and one at its tip. @see sprigLeaves
 */
export interface Shoot {
  /** Where it starts on the card, as shares of its side, from the bottom left. */
  readonly from: readonly [number, number];
  /** Which way it grows, degrees anticlockwise from up the card. */
  readonly heading: number;
  /** How long it is, as a share of the card's side. */
  readonly length: number;
  /** How many leaves stand along it, beside the one at its tip. */
  readonly leaves: number;
  /** How far a side leaf leans away from the shoot, degrees. */
  readonly splay: number;
  /** A leaf's length, as a share of the card's side. */
  readonly leafLength: number;
}

/**
 * The leaves of a sprig, from its shoots: along each, `leaves` of them at even
 * steps from a step in, leaning left then right, and one at the tip pointing
 * the shoot's own way. The atlas's leaves are taken in turn, `cells` of them,
 * so neighbours on a shoot are different scans. Pure arithmetic: the same
 * shoots are the same sprig.
 */
export function sprigLeaves(shoots: readonly Shoot[], cells: number): readonly SprigLeaf[] {
  const leaves: SprigLeaf[] = [];
  const round = (value: number): number => Math.round(value * 1e4) / 1e4;
  for (const shoot of shoots) {
    const heading = (shoot.heading * Math.PI) / 180;
    const at = (share: number): readonly [number, number] => [
      round(shoot.from[0] - Math.sin(heading) * shoot.length * share),
      round(shoot.from[1] + Math.cos(heading) * shoot.length * share),
    ];
    for (let leaf = 0; leaf < shoot.leaves; leaf += 1) {
      leaves.push({
        cell: leaves.length % cells,
        at: at((leaf + 1) / (shoot.leaves + 1)),
        turn: shoot.heading + (leaf % 2 === 0 ? shoot.splay : -shoot.splay),
        length: shoot.leafLength,
      });
    }
    leaves.push({
      cell: leaves.length % cells,
      at: at(1),
      turn: shoot.heading,
      length: shoot.leafLength,
    });
  }
  return leaves;
}

/** One species: its shape's parameters, what it wears, and how each level is made. */
export interface GeneratedSpecies {
  readonly id: string;
  /** The issue that adopted it (ADR 0049 D-11), as its files' records name it. */
  readonly adoptedBy: string;
  /** What the shape is meant to read as, for the record's words. */
  readonly words: string;
  readonly parameters: TreeParameters;
  /** Metres to one generator unit: what the generated numbers are multiplied by. */
  readonly metresPerUnit: number;
  /** The bark it wears (`sources.ts` §`SOURCES`), and how often it repeats. */
  readonly bark: {
    readonly source: string;
    /** Repeats round a branch and along one section of it. Whole numbers: a part closes on itself. */
    readonly repeat: readonly [number, number];
    /** The side of the shipped colour and normal maps, texels. */
    readonly pixels: number;
  };
  /**
   * The leaf card: a sprig drawn by `blender/process_generated_tree.py` from
   * the leaf atlas named — each of its leaves cut from the atlas by its own
   * opacity map, turned and laid where {@link SprigLeaf} says. The atlas is
   * ambientCG's or Poly Haven's; `sources.ts` §`generatedTreeMaps` knows which.
   */
  readonly sprig: AtlasCells & {
    readonly source: string;
    /**
     * What each of the atlas's colour channels is multiplied by. The leaves
     * were scanned flat under a lamp and are brighter and yellower than a
     * canopy standing in this world's light beside the scanned conifers; this
     * is the one number that is a judgement of the eye, and it is the owner's
     * to change.
     */
    readonly tone: readonly [number, number, number];
    readonly leaves: readonly SprigLeaf[];
    /** The side of the card's colour map, and of its normal map, texels. */
    readonly pixels: number;
    readonly normalPixels: number;
  };
  readonly middle: LevelPlan;
  /**
   * The impostor strip's frames, texels: each of the eight views of the colour
   * strip, and of the normal strip, which is rendered smaller — light varies
   * slowly across a crown, and the runtime reads both by one coordinate. The
   * frame's shape is the species': a spreading crown is as wide as it is tall.
   */
  readonly impostor: {
    readonly frame: readonly [number, number];
    readonly normalFrame: readonly [number, number];
  };
}

/** One generated tree: a species and a seed, and the geometry they make. */
export interface GeneratedTree {
  /** The files' stem: `<name>.glb`, `<name>-middle.glb`, `<name>-impostor.ktx2`. */
  readonly name: string;
  readonly species: string;
  readonly seed: number;
  /** {@link geometryDigest} of each level, as committed. */
  readonly geometry: { readonly full: string; readonly middle: string };
}

/** The two levels this file makes; the impostor is Blender's picture of `full`. */
export type GeneratedLevel = 'full' | 'middle';

/** What a generated level is: two triangle lists, the wood's and the leaf cards'. */
export interface TreeGeometry {
  readonly bark: MeshPart;
  readonly leaves: MeshPart;
}

/** One indexed triangle list. */
export interface MeshPart {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
}

/**
 * What {@link treeLevel} reads of a generator's tree — EZ-Tree 1.1.0's `Tree`,
 * `src/lib/tree.js`: its options, `generate()`, and the plain arrays
 * `generate()` fills before it builds any three.js geometry from them.
 */
export interface EzTree {
  readonly options: {
    seed: number;
    type: string;
    readonly bark: { textured: boolean };
    readonly branch: {
      levels: number;
      readonly angle: Record<number, number>;
      readonly children: Record<number, number>;
      readonly force: { readonly direction: { x: number; y: number; z: number }; strength: number };
      readonly gnarliness: Record<number, number>;
      readonly length: Record<number, number>;
      readonly radius: Record<number, number>;
      readonly sections: Record<number, number>;
      readonly segments: Record<number, number>;
      readonly start: Record<number, number>;
      readonly taper: Record<number, number>;
      readonly twist: Record<number, number>;
    };
    readonly leaves: {
      billboard: string;
      angle: number;
      count: number;
      start: number;
      size: number;
      sizeVariance: number;
    };
    readonly trellis: { enabled: boolean };
  };
  generate(): void;
  /** Called once a branch, after its vertices: `(indexOffset, branch)`. */
  generateBranchIndices(indexOffset: number, branch: { readonly level: number }): void;
  branches: {
    readonly verts: readonly number[];
    readonly normals: readonly number[];
    readonly uvs: readonly number[];
    readonly indices: readonly number[];
  };
  leaves: {
    readonly verts: readonly number[];
    readonly uvs: readonly number[];
    readonly indices: readonly number[];
  };
}

const OAK: GeneratedSpecies = {
  id: 'oak',
  adoptedBy: '#1283',
  words: 'a broad, spreading crown on a short trunk',
  parameters: {
    type: 'deciduous',
    levels: 3,
    angle: [0, 62, 52, 44],
    children: [5, 4, 3, 0],
    force: { x: 0, y: 1, z: 0, strength: 0.012 },
    gnarliness: [0.06, 0.16, 0.2, 0.06],
    length: [20, 20, 11, 4],
    radius: [1.5, 0.62, 0.62, 0.6],
    sections: [8, 7, 5, 2],
    segments: [8, 6, 4, 3],
    start: [0, 0.5, 0.3, 0.2],
    taper: [0.6, 0.65, 0.7, 0.7],
    twist: [0, 0, 0, 0],
    leaves: { billboard: 'double', angle: 35, count: 3, start: 0.1, size: 5, sizeVariance: 0.3 },
  },
  metresPerUnit: 0.065,
  bark: { source: 'Bark012', repeat: [2, 1], pixels: 256 },
  sprig: {
    source: 'LeafSet016',
    grid: [3, 2],
    atlasTurn: 0,
    tone: [0.62, 0.72, 0.5],
    leaves: sprigLeaves(
      [
        { from: [0.5, 0.02], heading: 0, length: 0.66, leaves: 8, splay: 52, leafLength: 0.3 },
        { from: [0.5, 0.2], heading: 48, length: 0.36, leaves: 3, splay: 48, leafLength: 0.27 },
        { from: [0.5, 0.3], heading: -46, length: 0.36, leaves: 3, splay: 48, leafLength: 0.27 },
      ],
      6,
    ),
    pixels: 256,
    normalPixels: 128,
  },
  middle: { segments: [6, 4, 3, 3], deepestWood: 2, leafEvery: 3, leafGrowth: 1.7 },
  impostor: { frame: [256, 256], normalFrame: [96, 96] },
};

const HORNBEAM: GeneratedSpecies = {
  id: 'hornbeam',
  adoptedBy: '#1283',
  words: 'a tall, narrow crown of ascending limbs',
  parameters: {
    type: 'deciduous',
    levels: 3,
    angle: [0, 38, 40, 42],
    children: [6, 3, 3, 0],
    force: { x: 0, y: 1, z: 0, strength: 0.02 },
    gnarliness: [0.03, 0.1, 0.16, 0.05],
    length: [30, 14, 8, 3.5],
    radius: [1.2, 0.5, 0.6, 0.6],
    sections: [9, 6, 4, 2],
    segments: [8, 5, 4, 3],
    start: [0, 0.3, 0.25, 0.2],
    taper: [0.65, 0.7, 0.7, 0.7],
    twist: [0, 0, 0, 0],
    leaves: { billboard: 'double', angle: 30, count: 3, start: 0.1, size: 4.4, sizeVariance: 0.3 },
  },
  metresPerUnit: 0.065,
  bark: { source: 'Bark005', repeat: [2, 1], pixels: 256 },
  sprig: {
    source: 'LeafSet014',
    grid: [3, 2],
    atlasTurn: 0,
    tone: [0.62, 0.72, 0.5],
    leaves: sprigLeaves(
      [
        { from: [0.5, 0.02], heading: 0, length: 0.7, leaves: 9, splay: 58, leafLength: 0.26 },
        { from: [0.5, 0.16], heading: 40, length: 0.4, leaves: 4, splay: 55, leafLength: 0.24 },
        { from: [0.5, 0.26], heading: -38, length: 0.4, leaves: 4, splay: 55, leafLength: 0.24 },
      ],
      6,
    ),
    pixels: 256,
    normalPixels: 128,
  },
  middle: { segments: [6, 4, 3, 3], deepestWood: 2, leafEvery: 3, leafGrowth: 1.7 },
  impostor: { frame: [160, 256], normalFrame: [80, 128] },
};

/**
 * The fir — #1294: the generator's `evergreen`, which tapers every branch to a
 * point, grows no terminal branch from one, and shortens a limb by how far up
 * the trunk it starts (`src/lib/tree.js`, 1.1.0) — a cone of boughs on one
 * straight stem. ONE branch level: a bough carries its sprig cards itself,
 * because a card here is already a whole photographed sprig with its side
 * twigs, where a broadleaf's card is a handful of single leaves.
 *
 * It wears Poly Haven's `fir_tree_01`: its bark, and four of the seven
 * sprigs of its twig atlas, each named by the rectangle it lies in.
 * `sources.ts` §`POLY_HAVEN_TREE_MAPS` says why that asset and not
 * `fir_sapling_medium`, and why four.
 */
const FIR: GeneratedSpecies = {
  id: 'fir',
  adoptedBy: '#1294',
  words: 'a narrow cone of drooping boughs on one straight stem',
  parameters: {
    type: 'evergreen',
    levels: 1,
    angle: [0, 100, 0, 0],
    children: [100, 0, 0, 0],
    force: { x: 0, y: 1, z: 0, strength: 0 },
    gnarliness: [0.01, 0.02, 0, 0],
    length: [92, 30, 0, 0],
    radius: [1.6, 0.3, 0, 0],
    sections: [12, 4, 1, 1],
    segments: [8, 3, 3, 3],
    start: [0, 0.18, 0, 0],
    taper: [1, 1, 1, 1],
    twist: [0, 0, 0, 0],
    leaves: { billboard: 'single', angle: 50, count: 11, start: 0.18, size: 6, sizeVariance: 0.2 },
  },
  metresPerUnit: 0.07,
  bark: { source: 'fir_tree_01', repeat: [1, 1], pixels: 256 },
  sprig: {
    source: 'fir_tree_01',
    rects: [
      { x: 311, y: 410, width: 338, height: 386, turn: 0 },
      { x: 666, y: 39, width: 296, height: 341, turn: 0 },
      { x: 192, y: 46, width: 249, height: 275, turn: 0 },
      { x: 550, y: 99, width: 55, height: 137, turn: 0 },
    ],
    tone: [1, 1, 1],
    leaves: [
      { cell: 2, at: [0.5, 0.06], turn: 62, length: 0.46 },
      { cell: 1, at: [0.5, 0.06], turn: -62, length: 0.46 },
      { cell: 3, at: [0.2, 0.62], turn: 24, length: 0.3 },
      { cell: 3, at: [0.8, 0.6], turn: -28, length: 0.3 },
      { cell: 0, at: [0.5, 0.02], turn: 0, length: 0.96 },
    ],
    pixels: 256,
    normalPixels: 128,
  },
  middle: { segments: [6, 3, 3, 3], deepestWood: 0, leafEvery: 3, leafGrowth: 1.4 },
  impostor: { frame: [128, 256], normalFrame: [64, 128] },
};

/** Every species, in a fixed order. */
export const GENERATED_SPECIES: readonly GeneratedSpecies[] = [OAK, HORNBEAM, FIR];

/** The species a generated tree is of. */
export function speciesOf(tree: GeneratedTree): GeneratedSpecies {
  const species = GENERATED_SPECIES.find((each) => each.id === tree.species);
  if (species === undefined) throw new Error(`${tree.name}: no species ${tree.species}`);
  return species;
}

/**
 * Every generated tree, in the order the pipeline makes them. Two seeds a
 * species, so the trees along a road differ in SHAPE (#621 already varies
 * their size and tint): the seed is the only number that differs between two
 * trees of a species, and it moves every limb.
 *
 * ⚠️ **Two, not three, and the names skip `_b` on purpose.** A tree is a draw
 * call a level a SHAPE, and three seeds a species put the owner's page at
 * `REALISTIC_WOODED_DRAW_CALLS` exactly (#1289's review). Three were made and
 * the two of each species that differ most in silhouette were kept: each
 * full level drawn from eight sides onto a 0.125 m grid, and two seeds
 * compared by the share of covered cells they have in common, the same side
 * to the same side —
 *
 * | Species | a and b | a and c | b and c |
 * |---|--:|--:|--:|
 * | oak (seeds 1283, 2566, 3849) | 0.701 | **0.689** | 0.727 |
 * | hornbeam (seeds 617, 621, 639) | 0.766 | **0.699** | 0.763 |
 *
 * — so `a` and `c` of both, the pair with least in common, and averaged over
 * the eight turns one may stand at to the other it is the same pair (0.696
 * and 0.699). They keep their names and their seeds, so the files kept are
 * byte for byte the ones first committed; seeds 2566 and 621 make no tree.
 *
 * ## The fir's two seeds — #1294
 *
 * Two, for the same draw-call reason, and the scanned firs they stand in for
 * are two shapes as well. ⚠️ **Chosen, and by a measure**: the generator
 * starts each of a fir's hundred boughs at a random height, and its random
 * stream leaves gaps — with the issue's own number as the seed, 1294, one
 * half-metre of the trunk between 4.5 m and 5 m carried a single bough, and
 * the tree was drawn with a bare waist. The forty seeds 1294 to 1333 were
 * generated and the boughs starting in each half metre of the trunk from 1 m
 * to 6.5 m counted; eight seeds had at least six in every one, the most any
 * had, and 1313 and 1324 are two of those. Nothing else was looked at to
 * choose them.
 */
export const GENERATED_TREES: readonly GeneratedTree[] = [
  {
    name: 'generated_oak_a',
    species: 'oak',
    seed: 1283,
    geometry: {
      full: 'fbfb235a6127720c1862f52dddd1b038664da820546c9385d5238f6ad9f95d12',
      middle: 'a289191e6c64d96c0d1148377e619d5c6e1669c6363e6c6c7ddd8d3b80965b01',
    },
  },
  {
    name: 'generated_oak_c',
    species: 'oak',
    seed: 3849,
    geometry: {
      full: '9bd296b18f269e522c08dab66e3222504187f6d221abc0ecea2b6cc0e8a1d912',
      middle: '487c0877fea5007c6abf3394e0cc5b3bf561fe7dbbbe2bde4b344945aa6ebc3a',
    },
  },
  {
    name: 'generated_hornbeam_a',
    species: 'hornbeam',
    seed: 617,
    geometry: {
      full: '6eafa3703a8a3229b8fc2be1cebb108536ea3abb24b6957b3e3be750dbde6062',
      middle: 'c746479543729d4a231a45423c685d6017694e0778fb008b0519af1f7c64a854',
    },
  },
  {
    name: 'generated_hornbeam_c',
    species: 'hornbeam',
    seed: 639,
    geometry: {
      full: '4d8a7275c0ca642beb0d1ad0afd60432fd99210bec10661ffe7f2f25bfdc50a3',
      middle: 'bf2c4837ec166573a967b4659d590e6215f0d33b390014af108a012164af0f08',
    },
  },
  {
    name: 'generated_fir_a',
    species: 'fir',
    seed: 1313,
    geometry: {
      full: '59c9e8f5bf2995b51c1c8b88b4bbf33750c0b8053339981340be4057aa6d068e',
      middle: '09270a644896f387d4c8f3b25aeaf96b46a4cfa4f47f2e691940a5bdf4470ef4',
    },
  },
  {
    name: 'generated_fir_b',
    species: 'fir',
    seed: 1324,
    geometry: {
      full: '63a7a4cd3cbf401561af898f6230466cba22ed0c215f8996a140145486310667',
      middle: '5f2c7dd6cdd3b42295c67c2a4712a22644820cb07b1ce7a5b864e401eca88d0b',
    },
  },
];

/** The plan that makes a species' FULL level: its own numbers, nothing left out. */
export function fullPlan(species: GeneratedSpecies): LevelPlan {
  return {
    segments: species.parameters.segments,
    deepestWood: species.parameters.levels,
    leafEvery: 1,
    leafGrowth: 1,
  };
}

/** The plan for one level of a species. */
export function levelPlan(species: GeneratedSpecies, level: GeneratedLevel): LevelPlan {
  return level === 'full' ? fullPlan(species) : species.middle;
}

/** Writes a species' parameters, a seed and a plan's sides onto a generator's options. */
function configure(tree: EzTree, parameters: TreeParameters, seed: number, plan: LevelPlan): void {
  const { options } = tree;
  options.seed = seed;
  options.type = parameters.type;
  // The generator's own images are not taken: no bark map is asked for.
  options.bark.textured = false;
  options.trellis.enabled = false;
  const branch = options.branch;
  branch.levels = parameters.levels;
  branch.force.direction.x = parameters.force.x;
  branch.force.direction.y = parameters.force.y;
  branch.force.direction.z = parameters.force.z;
  branch.force.strength = parameters.force.strength;
  for (let level = 0; level < 4; level += 1) {
    branch.angle[level] = parameters.angle[level] as number;
    branch.children[level] = parameters.children[level] as number;
    branch.gnarliness[level] = parameters.gnarliness[level] as number;
    branch.length[level] = parameters.length[level] as number;
    branch.radius[level] = parameters.radius[level] as number;
    branch.sections[level] = parameters.sections[level] as number;
    branch.segments[level] = plan.segments[level] as number;
    branch.start[level] = parameters.start[level] as number;
    branch.taper[level] = parameters.taper[level] as number;
    branch.twist[level] = parameters.twist[level] as number;
  }
  options.leaves.billboard = parameters.leaves.billboard;
  options.leaves.angle = parameters.leaves.angle;
  options.leaves.count = parameters.leaves.count;
  options.leaves.start = parameters.leaves.start;
  options.leaves.size = parameters.leaves.size;
  options.leaves.sizeVariance = parameters.leaves.sizeVariance;
}

/** The vertices one leaf card holds: a quad, or two crossed. */
function cardVertices(parameters: TreeParameters): number {
  return parameters.leaves.billboard === 'double' ? 8 : 4;
}

/**
 * One level of one tree, generated — the numbers Blender is handed.
 *
 * `tree` is a fresh EZ-Tree `Tree` from the pinned release (`ez-tree.ts`). Its
 * options are overwritten whole, `generate()` is run once, and its plain
 * arrays are read: every position multiplied by the species' metres a unit,
 * the bark's coordinates by its repeat, the wood deeper than the plan keeps
 * left out, and the leaf cards the plan does not keep left out with the rest
 * enlarged about the point each grows from.
 *
 * A leaf card's normal is its own face's, as the generator's
 * `computeVertexNormals` would give two triangles sharing an edge: computed
 * here from the card's first three corners so that it is these numbers and not
 * a three.js release's. Its coordinates are turned for glTF.
 */
export function treeLevel(
  tree: EzTree,
  species: GeneratedSpecies,
  seed: number,
  plan: LevelPlan,
): TreeGeometry {
  const { parameters, metresPerUnit: scale } = species;
  configure(tree, parameters, seed, plan);
  // Which of the wood's indices belong to a branch of which level: the
  // generator appends a branch's indices in one call, after its vertices.
  const spans: { readonly from: number; readonly level: number }[] = [];
  const appendIndices = tree.generateBranchIndices.bind(tree);
  tree.generateBranchIndices = (indexOffset, branch) => {
    spans.push({ from: tree.branches.indices.length, level: branch.level });
    appendIndices(indexOffset, branch);
  };
  tree.generate();
  const wood = tree.branches;
  const keptIndices: number[] = [];
  spans.forEach((span, at) => {
    if (span.level > plan.deepestWood) return;
    const to = spans[at + 1]?.from ?? wood.indices.length;
    for (let index = span.from; index < to; index += 1)
      keptIndices.push(wood.indices[index] as number);
  });
  // Only the vertices a kept triangle names, in their first-use order.
  const remap = new Map<number, number>();
  for (const index of keptIndices) if (!remap.has(index)) remap.set(index, remap.size);
  const barkPositions = new Float32Array(remap.size * 3);
  const barkNormals = new Float32Array(remap.size * 3);
  const barkUvs = new Float32Array(remap.size * 2);
  for (const [from, to] of remap) {
    for (let axis = 0; axis < 3; axis += 1) {
      barkPositions[to * 3 + axis] = (wood.verts[from * 3 + axis] as number) * scale;
      barkNormals[to * 3 + axis] = wood.normals[from * 3 + axis] as number;
    }
    barkUvs[to * 2] = (wood.uvs[from * 2] as number) * species.bark.repeat[0];
    barkUvs[to * 2 + 1] = (wood.uvs[from * 2 + 1] as number) * species.bark.repeat[1];
  }
  const bark: MeshPart = {
    positions: barkPositions,
    normals: barkNormals,
    uvs: barkUvs,
    indices: Uint32Array.from(keptIndices, (index) => remap.get(index) as number),
  };

  const perCard = cardVertices(parameters);
  const cards = tree.leaves.verts.length / 3 / perCard;
  const kept: number[] = [];
  for (let card = 0; card < cards; card += 1) if (card % plan.leafEvery === 0) kept.push(card);
  const leafPositions = new Float32Array(kept.length * perCard * 3);
  const leafNormals = new Float32Array(kept.length * perCard * 3);
  const leafUvs = new Float32Array(kept.length * perCard * 2);
  const leafIndices = new Uint32Array(kept.length * (perCard / 4) * 6);
  kept.forEach((card, slot) => {
    const first = card * perCard;
    // The card grows from the middle of its first quad's lower edge: corners 1 and 2.
    const root = [0, 1, 2].map(
      (axis) =>
        ((tree.leaves.verts[(first + 1) * 3 + axis] as number) +
          (tree.leaves.verts[(first + 2) * 3 + axis] as number)) /
        2,
    );
    for (let corner = 0; corner < perCard; corner += 1) {
      const from = first + corner;
      const to = slot * perCard + corner;
      for (let axis = 0; axis < 3; axis += 1) {
        const grown =
          (root[axis] as number) +
          ((tree.leaves.verts[from * 3 + axis] as number) - (root[axis] as number)) *
            plan.leafGrowth;
        leafPositions[to * 3 + axis] = grown * scale;
      }
      leafUvs[to * 2] = tree.leaves.uvs[from * 2] as number;
      // glTF's v runs DOWN a picture and the generator's runs up it: turned
      // here, so the card's root is the foot of the sprig's picture.
      leafUvs[to * 2 + 1] = 1 - (tree.leaves.uvs[from * 2 + 1] as number);
    }
    for (let quad = 0; quad < perCard / 4; quad += 1) {
      const base = slot * perCard + quad * 4;
      const corner = (which: number, axis: number): number =>
        leafPositions[(base + which) * 3 + axis] as number;
      const edge = (to: number): number[] =>
        [0, 1, 2].map((axis) => corner(to, axis) - corner(0, axis));
      const [ax, ay, az] = edge(1) as [number, number, number];
      const [bx, by, bz] = edge(2) as [number, number, number];
      const cross = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx] as const;
      const length = Math.hypot(cross[0], cross[1], cross[2]) || 1;
      for (let which = 0; which < 4; which += 1) {
        for (let axis = 0; axis < 3; axis += 1) {
          leafNormals[(base + which) * 3 + axis] = (cross[axis] as number) / length;
        }
      }
      leafIndices.set(
        [base, base + 1, base + 2, base, base + 2, base + 3],
        (slot * (perCard / 4) + quad) * 6,
      );
    }
  });
  return {
    bark,
    leaves: { positions: leafPositions, normals: leafNormals, uvs: leafUvs, indices: leafIndices },
  };
}

/** How many triangles a level holds. */
export function trianglesOf(geometry: TreeGeometry): number {
  return (geometry.bark.indices.length + geometry.leaves.indices.length) / 3;
}

const PART_ARRAYS = ['positions', 'normals', 'uvs', 'indices'] as const;

const bytesOf = (array: Float32Array | Uint32Array): Uint8Array =>
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength);

/**
 * SHA-256 of a level's numbers: each array's name and length, then its bytes,
 * little-endian, the bark first. It is the digest of what Blender is handed,
 * whatever the JSON round it is written in looks like.
 */
export function geometryDigest(geometry: TreeGeometry): string {
  const hash = createHash('sha256');
  for (const part of ['bark', 'leaves'] as const) {
    for (const name of PART_ARRAYS) {
      const array = geometry[part][name];
      hash.update(`${part}.${name} ${String(array.length)}\n`);
      hash.update(bytesOf(array));
    }
  }
  return hash.digest('hex');
}

/** The material names a generated tree's two parts carry, in the file and at runtime. */
export const GENERATED_MATERIALS = { bark: 'bark', leaves: 'leaves' } as const;

/**
 * A level as a glTF 2.0 document and its one binary buffer — what
 * `blender/process_generated_tree.py` imports: ONE mesh of two primitives, the
 * bark and the leaf cards, each naming a material that carries nothing but its
 * name. The script gives each its maps.
 */
export function levelGltf(
  geometry: TreeGeometry,
  name: string,
  binaryName: string,
): { readonly json: string; readonly binary: Uint8Array } {
  const pieces: Uint8Array[] = [];
  const bufferViews: Record<string, number>[] = [];
  const accessors: Record<string, unknown>[] = [];
  let offset = 0;
  const add = (array: Float32Array | Uint32Array, type: string, bounds: boolean): number => {
    const bytes = bytesOf(array);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength });
    pieces.push(bytes);
    offset += bytes.byteLength;
    const width = type === 'VEC3' ? 3 : type === 'VEC2' ? 2 : 1;
    const accessor: Record<string, unknown> = {
      bufferView: bufferViews.length - 1,
      componentType: array instanceof Uint32Array ? 5125 : 5126,
      count: array.length / width,
      type,
    };
    if (bounds) {
      const low = [Infinity, Infinity, Infinity];
      const high = [-Infinity, -Infinity, -Infinity];
      for (let at = 0; at < array.length; at += 1) {
        const axis = at % 3;
        low[axis] = Math.min(low[axis] as number, array[at] as number);
        high[axis] = Math.max(high[axis] as number, array[at] as number);
      }
      accessor['min'] = low;
      accessor['max'] = high;
    }
    accessors.push(accessor);
    return accessors.length - 1;
  };
  const primitive = (part: MeshPart, material: number): Record<string, unknown> => ({
    attributes: {
      POSITION: add(part.positions, 'VEC3', true),
      NORMAL: add(part.normals, 'VEC3', false),
      TEXCOORD_0: add(part.uvs, 'VEC2', false),
    },
    indices: add(part.indices, 'SCALAR', false),
    material,
    mode: 4,
  });
  const primitives = [primitive(geometry.bark, 0), primitive(geometry.leaves, 1)];
  const binary = new Uint8Array(offset);
  let at = 0;
  for (const piece of pieces) {
    binary.set(piece, at);
    at += piece.byteLength;
  }
  const json = JSON.stringify({
    asset: { version: '2.0', generator: 'On Your Left generated-trees.ts' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [{ name, primitives }],
    materials: [{ name: GENERATED_MATERIALS.bark }, { name: GENERATED_MATERIALS.leaves }],
    accessors,
    bufferViews,
    buffers: [{ uri: binaryName, byteLength: binary.byteLength }],
  });
  return { json, binary };
}

/** A tree's size as every level of it records it: the FULL level's. */
export interface TreeSize {
  /** From the ground to its highest point, metres. */
  readonly heightMetres: number;
  /** Twice its furthest reach from the trunk's axis, in any direction in plan, metres. */
  readonly widthMetres: number;
}

/**
 * The size of a FULL level — what the runtime sizes the tree, its middle
 * level and its impostor by. ⚠️ **About the trunk, not about the bounding
 * box's middle**: a generated tree stands with its trunk on the origin, where
 * the runtime lays its ground blob (#620), so its width is twice its reach
 * from there — a RADIUS, the furthest any point is from the axis in plan — and
 * the impostor's frame, centred on the trunk, holds all of it from each of its
 * eight sides, the diagonal ones too.
 */
export function treeSize(full: TreeGeometry): TreeSize {
  let height = 0;
  let reach = 0;
  for (const part of [full.bark, full.leaves]) {
    for (let at = 0; at < part.positions.length; at += 3) {
      height = Math.max(height, part.positions[at + 1] as number);
      reach = Math.max(
        reach,
        Math.hypot(part.positions[at] as number, part.positions[at + 2] as number),
      );
    }
  }
  return { heightMetres: height, widthMetres: reach * 2 };
}

/** Where the upstream maps a run reads are, on the machine that runs it. */
export interface RunPaths {
  readonly barkColour: string;
  readonly barkNormal: string;
  readonly leafColour: string;
  readonly leafOpacity: string;
  readonly leafNormal: string;
}

/**
 * Every number of a run that is this file's and NOT the geometry's: what
 * `blender/process_generated_tree.py` reads beside the level it imports — the
 * sprig's leaves, its atlas's grid and turn or its rectangles, its tone, the sizes of every map
 * and of the impostor's frames, and whether the level has maps at all.
 *
 * ⚠️ **{@link geometryDigest} sees none of these.** The generator does not
 * read them, so a shoot's heading can be edited and every tree's geometry is
 * the recorded one — while the leaf card Blender would draw is not the one
 * committed (#1289's review, which did exactly that and saw nothing go red).
 * {@link runNumbersDigest} is therefore part of a tree's recorded input
 * (`sources.ts` §`generatedInputDigest`), and {@link runPlan} is built from
 * this and nothing else of the species, so a number Blender is told cannot be
 * one the record leaves out; `generated-trees.test.ts` holds that.
 */
export interface RunNumbers {
  readonly name: string;
  readonly level: GeneratedLevel;
  /** A middle level wears the full level's maps at runtime (#617). */
  readonly maps: boolean;
  readonly impostor: GeneratedSpecies['impostor'] | null;
  readonly bark: { readonly pixels: number };
  readonly sprig: AtlasCells &
    Pick<GeneratedSpecies['sprig'], 'tone' | 'leaves' | 'pixels' | 'normalPixels'>;
}

/** @see RunNumbers. `species` is the tree's own unless a test hands it another. */
export function runNumbers(
  tree: GeneratedTree,
  level: GeneratedLevel,
  species: GeneratedSpecies = speciesOf(tree),
): RunNumbers {
  return {
    name: tree.name,
    level,
    maps: level === 'full',
    impostor: level === 'full' ? species.impostor : null,
    bark: { pixels: species.bark.pixels },
    sprig: {
      // The cells first, and a grid's two numbers in the order #1283 wrote
      // them: this object's JSON is digested, and the broadleaves' digests
      // are in sixteen committed rows.
      ...('rects' in species.sprig
        ? { rects: species.sprig.rects }
        : { grid: species.sprig.grid, atlasTurn: species.sprig.atlasTurn }),
      tone: species.sprig.tone,
      leaves: species.sprig.leaves,
      pixels: species.sprig.pixels,
      normalPixels: species.sprig.normalPixels,
    },
  };
}

/** SHA-256 of {@link runNumbers} as JSON: the half of a run's plan no geometry digest covers. */
export function runNumbersDigest(
  tree: GeneratedTree,
  level: GeneratedLevel,
  species: GeneratedSpecies = speciesOf(tree),
): string {
  return createHash('sha256')
    .update(JSON.stringify(runNumbers(tree, level, species)))
    .digest('hex');
}

/**
 * What `blender/process_generated_tree.py` is told about one level of one
 * tree: {@link runNumbers}, what the geometry measures, and the machine's
 * paths. Every number is this file's, and only the paths are the machine's.
 */
export function runPlan(
  tree: GeneratedTree,
  level: GeneratedLevel,
  geometry: TreeGeometry,
  size: TreeSize,
  paths: RunPaths,
): Readonly<Record<string, unknown>> {
  const numbers = runNumbers(tree, level);
  return {
    name: numbers.name,
    level: numbers.level,
    maps: numbers.maps,
    triangles: trianglesOf(geometry),
    heightMetres: size.heightMetres,
    widthMetres: size.widthMetres,
    impostor: numbers.impostor,
    bark: { colour: paths.barkColour, normal: paths.barkNormal, ...numbers.bark },
    sprig: {
      colour: paths.leafColour,
      opacity: paths.leafOpacity,
      normal: paths.leafNormal,
      ...numbers.sprig,
    },
  };
}
