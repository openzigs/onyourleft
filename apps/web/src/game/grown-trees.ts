// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Trees and bushes GROWN in code when the realistic world loads — #3252,
 * under [ADR 0099](../../../../docs/adr/0099-model-sources-for-modern-buildings-trees-and-track-and-what-a-new-model-owes.md)
 * D-1: *"Trees stay with the generator and the scans … [which] makes a tree
 * to a triangle budget from committed numbers, which no downloaded pack
 * does."*
 *
 * ## Why at load, and not through the pipeline
 *
 * The committed generated trees (`tools/realistic/generated-trees.ts`) are
 * made by a pinned generator and Blender, and each is three files of about
 * 700 KB together. On 2026-11-26 the realistic set was **231 387 bytes**
 * under `realistic-budget.ts` §`REALISTIC_BUILD_BYTES`, and ADR 0099 D-4
 * says no whole-world ceiling is raised for a model without a tablet
 * measurement first. So a new species cannot be a new file. It is NUMBERS:
 * {@link GROWN_SPECIES} is every parameter of each, {@link growTree} makes
 * its wood and leaf cards from them and a seed, and `three-renderer.ts`
 * §`grownShapeOf` dresses the result in the bark and the leaf card of a
 * committed tree that is already loaded — its {@link GrownSpecies.host}. No
 * file, no texture and no byte is added to the build.
 *
 * ## The generator is this repository's own
 *
 * A recursive branching generator of the usual kind, written here from its
 * description — a stem of sections that wander and taper, children leaving it
 * at an angle on a golden-angle spiral, cards on the last level — and not
 * from any other program's source. It is not the pinned EZ-Tree, which is a
 * tool of the pipeline and may not be imported under `src/`
 * (`tools/realistic/ez-tree.ts`).
 *
 * ## Three levels, kept
 *
 * - **full** — the species' own numbers.
 * - **middle** — the SAME skeleton meshed again with fewer sides round each
 *   branch, every other ring along it, its twigs' wood left out and one leaf
 *   card in three kept and enlarged ({@link GrownLevelPlan}). The skeleton is
 *   grown once and no number the random stream reads differs between the
 *   levels, so the middle level's stem and limbs are the full level's, and
 *   the hand-over (`tree-levels.ts`) dithers one shape into itself.
 * - **far** — its host's impostor, drawn at this tree's height
 *   (`three-renderer.ts` §`RealisticShape.far`): the same leaves and bark in
 *   the same light, in the host's outline. It is in the host's own instanced
 *   mesh, so a grown tree adds no far draw call.
 *
 * A bush has one level, as every shrub does.
 *
 * ## Seeded
 *
 * Every random number is drawn from one stream started from the species'
 * seed, so the same numbers are the same tree on every device and every
 * load — `grown-trees.test.ts` holds each by a digest of its arrays.
 *
 * Pure: no rendering library, no file, no network.
 */

/** A number for each branch level, the stem being level 0. */
export type PerLevel = readonly [number, number, number, number];

/** How one level of detail is meshed from a skeleton. No number here is read by the random stream. */
export interface GrownLevelPlan {
  /** Sides round a branch of each level. */
  readonly sides: PerLevel;
  /** The deepest branch level whose wood is kept. */
  readonly deepestWood: number;
  /** One ring in this many is kept along a branch, and always its last. */
  readonly ringEvery: number;
  /** One leaf card in this many is kept, in the order they were grown. */
  readonly leafEvery: number;
  /** How much a kept card is enlarged about the point it grows from. */
  readonly leafGrowth: number;
}

/** One grown species: every number it is made from. */
export interface GrownSpecies {
  /** The shape's name: `scenery-plan.ts` names it in its tables. */
  readonly id: string;
  readonly kind: 'tree-broadleaf' | 'tree-conifer' | 'shrub';
  /**
   * The committed generated tree whose bark and leaf card it wears, and whose
   * impostor a grown TREE is drawn as beyond its middle level.
   */
  readonly host: string;
  readonly seed: number;
  /** Branch levels beyond the stem: 1 is a stem and boughs, 3 has limbs, branches and twigs. */
  readonly levels: number;
  /** Metres: the stem's, then a child branch's of each level. */
  readonly length: PerLevel;
  /** The stem's radius, metres; then a child's as a share of its parent's where it leaves. */
  readonly radius: PerLevel;
  /** Sections along a branch of each level. ⚠️ The random stream reads this. */
  readonly sections: PerLevel;
  /** Children of a branch of each level; the last level's is unused. */
  readonly children: PerLevel;
  /** Where along its parent a child may start; index 0 is unused. */
  readonly start: PerLevel;
  /** A child's angle from its parent, degrees; index 0 is unused. */
  readonly angle: PerLevel;
  /** How far a branch wanders at each section. */
  readonly gnarl: PerLevel;
  /** How far a branch is pulled up (or, negative, down) at each section. */
  readonly lift: PerLevel;
  /** The share of its radius a branch has lost by its tip. */
  readonly taper: PerLevel;
  /**
   * How long the stem's children are, of {@link length}, at the lowest and
   * the highest of them: the crown's outline. `[1, 0.1]` is a cone.
   */
  readonly crown: readonly [number, number];
  readonly leaves: {
    /** Cards along each last-level branch, beside the one at its tip. */
    readonly perTwig: number;
    readonly start: number;
    /** A card's side, metres, and how far it varies either way. */
    readonly size: number;
    readonly variance: number;
    /** Two cards crossed (a broadleaf's sprig) or one (a conifer's). */
    readonly crossed: boolean;
    /** How far a side card leans from its twig, degrees. */
    readonly splay: number;
  };
  /** Repeats of the bark round a branch and along one ring of it. */
  readonly barkRepeat: readonly [number, number];
  readonly full: GrownLevelPlan;
  /** A tree's middle level; a bush has none. */
  readonly middle?: GrownLevelPlan;
}

const FULL_BROADLEAF: GrownLevelPlan = {
  sides: [8, 6, 4, 3],
  deepestWood: 3,
  ringEvery: 1,
  leafEvery: 1,
  leafGrowth: 1,
};

const MIDDLE_BROADLEAF: GrownLevelPlan = {
  sides: [6, 4, 3, 3],
  deepestWood: 2,
  ringEvery: 2,
  leafEvery: 3,
  leafGrowth: 1.7,
};

/**
 * Every grown species. The seeds are this issue's number and its neighbours;
 * nothing was looked at to choose them but that the tree stands upright.
 */
export const GROWN_SPECIES: readonly GrownSpecies[] = [
  {
    id: 'grown_lime',
    kind: 'tree-broadleaf',
    host: 'generated_hornbeam_a',
    seed: 3252,
    levels: 3,
    length: [5.2, 1.7, 0.85, 0.36],
    radius: [0.12, 0.45, 0.55, 0.6],
    sections: [8, 5, 3, 1],
    children: [9, 5, 4, 0],
    start: [0, 0.5, 0.25, 0.2],
    angle: [0, 50, 48, 40],
    gnarl: [0.02, 0.08, 0.12, 0.1],
    lift: [0, 0.05, 0.03, 0],
    taper: [0.55, 0.7, 0.75, 0.8],
    crown: [1.1, 0.55],
    leaves: { perTwig: 2, start: 0.3, size: 0.3, variance: 0.25, crossed: true, splay: 45 },
    barkRepeat: [2, 1],
    full: FULL_BROADLEAF,
    middle: MIDDLE_BROADLEAF,
  },
  {
    id: 'grown_field_maple',
    kind: 'tree-broadleaf',
    host: 'generated_oak_a',
    seed: 3253,
    levels: 3,
    length: [2.6, 1.9, 0.95, 0.4],
    radius: [0.13, 0.5, 0.55, 0.6],
    sections: [5, 5, 3, 1],
    children: [8, 5, 4, 0],
    start: [0, 0.42, 0.25, 0.2],
    angle: [0, 64, 52, 42],
    gnarl: [0.04, 0.14, 0.16, 0.1],
    lift: [0, 0.03, 0.02, 0],
    taper: [0.5, 0.7, 0.75, 0.8],
    crown: [1.1, 0.75],
    leaves: { perTwig: 2, start: 0.3, size: 0.32, variance: 0.3, crossed: true, splay: 50 },
    barkRepeat: [2, 1],
    full: FULL_BROADLEAF,
    middle: MIDDLE_BROADLEAF,
  },
  {
    id: 'grown_poplar',
    kind: 'tree-broadleaf',
    host: 'generated_hornbeam_c',
    seed: 3254,
    levels: 3,
    length: [8.5, 1.5, 0.7, 0.32],
    radius: [0.14, 0.32, 0.55, 0.6],
    sections: [10, 4, 3, 1],
    children: [18, 3, 3, 0],
    start: [0, 0.14, 0.2, 0.2],
    angle: [0, 26, 30, 34],
    gnarl: [0.01, 0.05, 0.08, 0.08],
    lift: [0, 0.22, 0.12, 0.05],
    taper: [0.7, 0.7, 0.75, 0.8],
    crown: [1.1, 0.5],
    leaves: { perTwig: 2, start: 0.3, size: 0.28, variance: 0.25, crossed: true, splay: 40 },
    barkRepeat: [2, 1],
    full: { ...FULL_BROADLEAF, sides: [8, 5, 4, 3] },
    middle: MIDDLE_BROADLEAF,
  },
  {
    id: 'grown_spruce',
    kind: 'tree-conifer',
    host: 'generated_fir_a',
    seed: 3255,
    levels: 1,
    length: [6.4, 1.75, 0, 0],
    radius: [0.11, 0.28, 0, 0],
    sections: [12, 4, 1, 1],
    children: [96, 0, 0, 0],
    start: [0, 0.14, 0, 0],
    angle: [0, 102, 0, 0],
    gnarl: [0.01, 0.03, 0, 0],
    lift: [0, 0.07, 0, 0],
    taper: [1, 1, 1, 1],
    crown: [1, 0.1],
    leaves: { perTwig: 9, start: 0.12, size: 0.5, variance: 0.2, crossed: false, splay: 50 },
    barkRepeat: [1, 1],
    full: { sides: [8, 3, 3, 3], deepestWood: 1, ringEvery: 1, leafEvery: 1, leafGrowth: 1 },
    // As the committed fir's: the stem's wood and none of its boughs'.
    middle: { sides: [6, 3, 3, 3], deepestWood: 0, ringEvery: 1, leafEvery: 3, leafGrowth: 1.4 },
  },
  {
    id: 'grown_thorn',
    kind: 'shrub',
    host: 'generated_oak_c',
    seed: 3256,
    levels: 2,
    length: [0.35, 0.95, 0.42, 0],
    radius: [0.05, 0.6, 0.6, 0],
    sections: [1, 4, 1, 1],
    children: [9, 6, 0, 0],
    start: [0, 0.1, 0.15, 0],
    angle: [0, 48, 50, 0],
    gnarl: [0, 0.2, 0.15, 0],
    lift: [0, 0.08, 0, 0],
    taper: [0.3, 0.7, 0.8, 0],
    crown: [1, 1],
    leaves: { perTwig: 2, start: 0.2, size: 0.28, variance: 0.3, crossed: true, splay: 50 },
    barkRepeat: [1, 1],
    full: { sides: [5, 4, 3, 3], deepestWood: 2, ringEvery: 1, leafEvery: 1, leafGrowth: 1 },
  },
  {
    id: 'grown_laurel',
    kind: 'shrub',
    host: 'generated_hornbeam_c',
    seed: 3257,
    levels: 2,
    length: [0.25, 0.7, 0.34, 0],
    radius: [0.05, 0.6, 0.6, 0],
    sections: [1, 4, 1, 1],
    children: [9, 6, 0, 0],
    start: [0, 0.1, 0.1, 0],
    angle: [0, 58, 45, 0],
    gnarl: [0, 0.12, 0.1, 0],
    lift: [0, 0.14, 0.05, 0],
    taper: [0.3, 0.7, 0.8, 0],
    crown: [1, 1],
    leaves: { perTwig: 2, start: 0.15, size: 0.24, variance: 0.2, crossed: true, splay: 55 },
    barkRepeat: [1, 1],
    full: { sides: [5, 4, 3, 3], deepestWood: 2, ringEvery: 1, leafEvery: 1, leafGrowth: 1 },
  },
];

/** One indexed triangle list, with a colour a vertex: the shade its place in the crown keeps. */
export interface GrownMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly colours: Float32Array;
  readonly indices: Uint32Array;
}

/** One level of a grown tree: its wood and its leaf cards. */
export interface GrownLevel {
  readonly bark: GrownMesh;
  readonly leaves: GrownMesh;
  readonly triangles: number;
}

/** A grown tree or bush, at every level it has. */
export interface GrownTree {
  readonly full: GrownLevel;
  readonly middle?: GrownLevel;
  /** From the ground to the full level's highest point, metres. */
  readonly heightMetres: number;
  /** Twice the full level's furthest reach from the stem's axis in plan, metres. */
  readonly widthMetres: number;
}

type Vec = [number, number, number];

interface Branch {
  readonly level: number;
  /** `sections + 1` points, and the radius and the direction at each. */
  readonly points: Vec[];
  readonly radii: number[];
  readonly directions: Vec[];
}

interface Card {
  readonly root: Vec;
  readonly up: Vec;
  readonly right: Vec;
  readonly size: number;
}

interface Skeleton {
  readonly branches: Branch[];
  readonly cards: Card[];
}

/** The golden angle, radians: successive children leave on a spiral that never lines up. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** A stream of uniform numbers in `[0, 1)` from one seed (mulberry32). */
function stream(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b_79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const add = (a: Vec, b: Vec, scale = 1): Vec => [
  a[0] + b[0] * scale,
  a[1] + b[1] * scale,
  a[2] + b[2] * scale,
];
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function unit(a: Vec): Vec {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
}
const mix = (a: Vec, b: Vec, share: number): Vec => [
  a[0] + (b[0] - a[0]) * share,
  a[1] + (b[1] - a[1]) * share,
  a[2] + (b[2] - a[2]) * share,
];

/** Two unit vectors square to `axis` and to each other. */
function squareTo(axis: Vec): [Vec, Vec] {
  const helper: Vec = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = unit(cross(helper, axis));
  return [u, cross(axis, u)];
}

/** `axis` leant `angle` radians toward the direction `azimuth` round it. */
function leant(axis: Vec, angle: number, azimuth: number): Vec {
  const [u, v] = squareTo(axis);
  const side = add(
    [u[0] * Math.cos(azimuth), u[1] * Math.cos(azimuth), u[2] * Math.cos(azimuth)],
    v,
    Math.sin(azimuth),
  );
  return unit(
    add(
      [axis[0] * Math.cos(angle), axis[1] * Math.cos(angle), axis[2] * Math.cos(angle)],
      side,
      Math.sin(angle),
    ),
  );
}

/** The skeleton of a species: every branch and every leaf card, from its seed. */
function skeletonOf(species: GrownSpecies): Skeleton {
  const next = stream(species.seed);
  const branches: Branch[] = [];
  const cards: Card[] = [];
  const radians = (degrees: number): number => (degrees * Math.PI) / 180;

  const grow = (level: number, origin: Vec, heading: Vec, length: number, radius: number): void => {
    const sections = Math.max(1, species.sections[level] as number);
    const step = length / sections;
    const points: Vec[] = [origin];
    const radii: number[] = [radius];
    const directions: Vec[] = [];
    let direction = unit(heading);
    let point = origin;
    for (let section = 1; section <= sections; section += 1) {
      const wander = species.gnarl[level] as number;
      direction = unit([
        direction[0] + (2 * next() - 1) * wander,
        direction[1] + (2 * next() - 1) * wander + (species.lift[level] as number),
        direction[2] + (2 * next() - 1) * wander,
      ]);
      point = add(point, direction, step);
      points.push(point);
      directions.push(direction);
      radii.push(
        Math.max(0.004, radius * (1 - ((species.taper[level] as number) * section) / sections)),
      );
    }
    // The direction AT each point: the section's that arrives there; at the
    // foot the branch's own heading, so a stem's first ring lies on the ground.
    directions.unshift(unit(heading));
    branches.push({ level, points, radii, directions });

    const at = (share: number): { point: Vec; direction: Vec; radius: number } => {
      const along = Math.min(sections - 1e-6, Math.max(0, share * sections));
      const from = Math.floor(along);
      const part = along - from;
      return {
        point: mix(points[from] as Vec, points[from + 1] as Vec, part),
        direction: directions[from + 1] as Vec,
        radius:
          (radii[from] as number) + ((radii[from + 1] as number) - (radii[from] as number)) * part,
      };
    };

    if (level < species.levels) {
      const child = level + 1;
      const count = species.children[level] as number;
      const first = species.start[child] as number;
      const turn = next() * Math.PI * 2;
      for (let index = 0; index < count; index += 1) {
        const up = (index + next()) / count;
        const from = at(first + (1 - first) * up);
        const angle = radians(species.angle[child] as number) * (0.85 + 0.3 * next());
        const outline =
          level === 0 ? species.crown[0] + (species.crown[1] - species.crown[0]) * up : 1;
        grow(
          child,
          from.point,
          leant(from.direction, angle, turn + index * GOLDEN_ANGLE + next() * 0.9),
          (species.length[child] as number) * (0.75 + 0.5 * next()) * outline,
          from.radius * (species.radius[child] as number),
        );
      }
      // The stem carries on as a leader, so the crown has a top and not a hole.
      if (level === 0) {
        const tip = at(1);
        grow(
          child,
          tip.point,
          tip.direction,
          (species.length[child] as number) * species.crown[1] * 0.9,
          tip.radius,
        );
      }
      return;
    }

    const { perTwig, start, size, variance, splay } = species.leaves;
    const sized = (): number => size * (1 + variance * (2 * next() - 1));
    const card = (root: Vec, up: Vec): void => {
      const [u, v] = squareTo(up);
      // A broadleaf's crossed cards turn any way round their twig. A
      // conifer's one card is a frond: it lies across its bough, level, and
      // is rolled up to 50 degrees out of level so it is never seen edge-on
      // from every side at once.
      const level = unit(cross(up, [0, 1, 0]));
      const flat = !species.leaves.crossed && Math.abs(up[1]) < 0.95;
      const roll = flat ? (2 * next() - 1) * 0.87 : next() * Math.PI * 2;
      const [a, b] = flat ? [level, cross(up, level)] : [u, v];
      cards.push({
        root,
        up,
        right: unit(
          add(
            [a[0] * Math.cos(roll), a[1] * Math.cos(roll), a[2] * Math.cos(roll)],
            b,
            Math.sin(roll),
          ),
        ),
        size: sized(),
      });
    };
    const turn = next() * Math.PI * 2;
    for (let leaf = 0; leaf < perTwig; leaf += 1) {
      const from = at(start + ((1 - start) * (leaf + 0.5)) / perTwig);
      card(from.point, leant(from.direction, radians(splay), turn + leaf * GOLDEN_ANGLE));
    }
    const tip = at(1);
    card(tip.point, tip.direction);
  };

  grow(0, [0, 0, 0], [0, 1, 0], species.length[0], species.radius[0]);
  return { branches, cards };
}

/** The middle of the leaf cards' roots, and how far the furthest is from it. */
function crownOf(cards: readonly Card[]): { centre: Vec; radius: number } {
  const centre: Vec = [0, 0, 0];
  for (const { root } of cards) {
    centre[0] += root[0] / cards.length;
    centre[1] += root[1] / cards.length;
    centre[2] += root[2] / cards.length;
  }
  let radius = 0;
  for (const { root } of cards) {
    radius = Math.max(
      radius,
      Math.hypot(root[0] - centre[0], root[1] - centre[1], root[2] - centre[2]),
    );
  }
  return { centre, radius: radius || 1 };
}

/** The lowest share of the light a point deep in the crown keeps: its baked shade. */
export const GROWN_CROWN_SHADE = 0.42;

/**
 * How far a leaf card's normal may lean off level, as its rise over its run:
 * up to **0.4** upward and **0.2** downward. @see levelOf
 */
export const GROWN_NORMAL_LEAN = { up: 0.4, down: 0.2 } as const;

/** The light a point keeps by how far out of the crown's middle it is, 0 to 1. */
function shadeAt(point: Vec, crown: { centre: Vec; radius: number }): number {
  const out = Math.min(
    1,
    Math.hypot(point[0] - crown.centre[0], point[1] - crown.centre[1], point[2] - crown.centre[2]) /
      crown.radius,
  );
  // The underside of a crown is darker than its top at the same depth.
  const height = Math.min(1, Math.max(0, (point[1] - crown.centre[1]) / crown.radius / 2 + 0.5));
  return (GROWN_CROWN_SHADE + (1 - GROWN_CROWN_SHADE) * out ** 1.5) * (0.85 + 0.15 * height);
}

function meshOf(
  positions: number[],
  normals: number[],
  uvs: number[],
  colours: number[],
  indices: number[],
): GrownMesh {
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: Float32Array.from(uvs),
    colours: Float32Array.from(colours),
    indices: Uint32Array.from(indices),
  };
}

/** One level of a skeleton, meshed. */
function levelOf(species: GrownSpecies, skeleton: Skeleton, plan: GrownLevelPlan): GrownLevel {
  const crown = crownOf(skeleton.cards);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  for (const branch of skeleton.branches) {
    if (branch.level > plan.deepestWood) continue;
    const sides = plan.sides[branch.level] as number;
    const last = branch.points.length - 1;
    const kept: number[] = [];
    for (let ring = 0; ring < last; ring += plan.ringEvery) kept.push(ring);
    kept.push(last);
    const first = positions.length / 3;
    kept.forEach((ring, row) => {
      const point = branch.points[ring] as Vec;
      const radius = branch.radii[ring] as number;
      const [u, v] = squareTo(branch.directions[ring] as Vec);
      const shade = shadeAt(point, crown);
      for (let side = 0; side <= sides; side += 1) {
        const angle = (side / sides) * Math.PI * 2;
        const out = add(
          [u[0] * Math.cos(angle), u[1] * Math.cos(angle), u[2] * Math.cos(angle)],
          v,
          Math.sin(angle),
        );
        positions.push(
          point[0] + out[0] * radius,
          point[1] + out[1] * radius,
          point[2] + out[2] * radius,
        );
        normals.push(out[0], out[1], out[2]);
        uvs.push((side / sides) * species.barkRepeat[0], ring * species.barkRepeat[1]);
        colours.push(shade, shade, shade);
      }
      if (row === 0) return;
      const a = first + (row - 1) * (sides + 1);
      const b = first + row * (sides + 1);
      for (let side = 0; side < sides; side += 1) {
        indices.push(a + side, a + side + 1, b + side, a + side + 1, b + side + 1, b + side);
      }
    });
  }
  const bark = meshOf(positions, normals, uvs, colours, indices);

  const leafPositions: number[] = [];
  const leafNormals: number[] = [];
  const leafUvs: number[] = [];
  const leafColours: number[] = [];
  const leafIndices: number[] = [];
  skeleton.cards.forEach((card, order) => {
    if (order % plan.leafEvery !== 0) return;
    const size = card.size * plan.leafGrowth;
    // A frond is seen from below, lit through: it keeps more of the light than a leaf deep in a crown.
    const shade = species.leaves.crossed
      ? shadeAt(card.root, crown)
      : 0.5 + 0.5 * shadeAt(card.root, crown);
    const outward = unit([
      card.root[0] - crown.centre[0],
      card.root[1] - crown.centre[1] + size / 2,
      card.root[2] - crown.centre[2],
    ]);
    const quad = (right: Vec): void => {
      const base = leafPositions.length / 3;
      const wound = unit(cross(right, card.up));
      const face: Vec = dot(wound, outward) < 0 ? [-wound[0], -wound[1], -wound[2]] : wound;
      // Mostly the crown's own way out, so a canopy shades as a mass and not as cards.
      const blended = unit(add([face[0] * 0.45, face[1] * 0.45, face[2] * 0.45], outward, 0.55));
      // ⚠️ Kept near the horizontal. A material drawn on both sides turns a
      // card's normal over for whoever looks at its back, and this world's
      // light from below the horizon is next to nothing: a normal that points
      // up from one side is a BLACK card from the other. Leaning it no more
      // than this far off level leaves both sides in the horizon's light.
      const away = Math.hypot(card.root[0], card.root[2]) || 1;
      const level = Math.hypot(blended[0], blended[2]);
      const normal = unit([
        level > 1e-3 ? blended[0] : card.root[0] / away,
        Math.min(GROWN_NORMAL_LEAN.up, Math.max(-GROWN_NORMAL_LEAN.down, blended[1])) *
          Math.max(level, 1e-3),
        level > 1e-3 ? blended[2] : card.root[2] / away,
      ]);
      const half = size / 2;
      const corners: readonly (readonly [number, number, number, number])[] = [
        [-half, 0, 0, 1],
        [half, 0, 1, 1],
        [half, size, 1, 0],
        [-half, size, 0, 0],
      ];
      for (const [across, along, u, v] of corners) {
        // The picture's foot is the card's root: glTF's v runs down a picture.
        leafPositions.push(
          card.root[0] + right[0] * across + card.up[0] * along,
          card.root[1] + right[1] * across + card.up[1] * along,
          card.root[2] + right[2] * across + card.up[2] * along,
        );
        leafNormals.push(normal[0], normal[1], normal[2]);
        leafUvs.push(u, v);
        leafColours.push(shade, shade, shade);
      }
      // The side the normal is on is the card's FRONT: a material drawn on
      // both sides turns a back face's normal over, so the winding has to
      // agree with the normal or the lit side is shaded as the dark one.
      const turned = dot(wound, normal) < 0;
      if (turned) leafIndices.push(base, base + 2, base + 1, base, base + 3, base + 2);
      else leafIndices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    quad(card.right);
    if (species.leaves.crossed) quad(cross(card.up, card.right));
  });
  const leaves = meshOf(leafPositions, leafNormals, leafUvs, leafColours, leafIndices);
  return { bark, leaves, triangles: (bark.indices.length + leaves.indices.length) / 3 };
}

/**
 * A species, grown: its full level, its middle level if it has one, and the
 * full level's size. The same species is the same arrays, to the bit.
 */
export function growTree(species: GrownSpecies): GrownTree {
  const skeleton = skeletonOf(species);
  const full = levelOf(species, skeleton, species.full);
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
  return {
    full,
    ...(species.middle === undefined ? {} : { middle: levelOf(species, skeleton, species.middle) }),
    heightMetres: height,
    widthMetres: reach * 2,
  };
}
