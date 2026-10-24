// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A person's body — #1541: MakeHuman's CC0 base mesh, the one the rider wears
 * (`realistic-assets.ts` §`REALISTIC_RIDER`, already admitted), cut to about
 * {@link PERSON_MAX_TRIANGLES} triangles when a view builds its realistic world,
 * dressed by region rather than by a texture, and the arithmetic of the
 * vertex-animation texture its walk and run are baked into.
 *
 * ## Cut at load, from the rider's own file — no new asset
 *
 * The rider's body is 8 636 triangles over 4 859 vertices; sixteen of them
 * would be 138 000, four times the issue's 32 000. {@link clusterDecimate} cuts
 * it by VERTEX CLUSTERING (Rossignac and Borrel, 1993): the body is divided
 * into cubes, every vertex in a cube becomes the one nearest the cube's mean,
 * and a triangle whose corners fall into fewer than three cubes is dropped.
 * The cube is the smallest that leaves at most the budget, found by bisection,
 * so the cut is decided by the file and the budget and by no typed size. A
 * cube never joins vertices of two different bones, so an arm never fuses to
 * the side it swings past.
 *
 * Every vertex kept IS one of the file's — the nearest to its cube's mean, not
 * the mean — so it keeps its own skin weights and the body bends at its own
 * joints when the renderer poses it.
 *
 * ## Dressed by region
 *
 * The rider's three maps are a cycling kit. A person wears clothes instead:
 * each kept vertex is {@link PersonRegion | skin, top, bottoms, shoes or hair}
 * by the bone that moves it most and where it is on the body
 * ({@link regionOf}), and a person's seeded colours (`people.ts`
 * §`personLook`) paint each region in the one draw.
 *
 * ## The animation texture
 *
 * Each kept vertex's position and normal, at {@link GAIT_PHASES} phases of the
 * walk and of the run (`gait.ts`), half-float RGBA: one column a vertex, one
 * row a phase's positions and one its normals. {@link animationBytes} is its
 * size, held under {@link PERSON_ANIMATION_MAX_BYTES}.
 *
 * Pure, and names no rendering library.
 */

import { GAIT_PHASES, GAITS } from './gait';

/** The most triangles one person's body may be: **2 000** — the issue's figure. */
export const PERSON_MAX_TRIANGLES = 2_000;

/**
 * The most bytes the people's animation texture may take: **1 MiB** — the
 * issue's "about 1 MiB of animation texture".
 *
 * @test-facing held by `people-body.test.ts`, which cuts the committed body,
 * and by `realistic-budget.test.ts`, which adds it to the texture estimate
 */
export const PERSON_ANIMATION_MAX_BYTES = 1024 * 1024;

/**
 * Bytes a texel of the animation texture: half-float RGBA.
 *
 * @test-facing held by {@link animationBytes}; the renderer's own size of the
 * texture (`three-renderer.ts` §`PeopleBelt.animationBytes`) is read only by
 * the browser gate
 */
export const ANIMATION_BYTES_PER_TEXEL = 8;

/** Rows of the animation texture: a position row and a normal row for every phase of every gait. */
export const ANIMATION_ROWS = 2 * GAITS.length * GAIT_PHASES;

/**
 * The animation texture's size in bytes for a body of `vertices` vertices: one column each.
 *
 * @test-facing held by `people-body.test.ts` against the committed body; the
 * renderer reads its own texture's size (`three-renderer.ts`
 * §`PeopleBelt.animationBytes`), which the browser gate holds to this
 */
export function animationBytes(vertices: number): number {
  return vertices * ANIMATION_ROWS * ANIMATION_BYTES_PER_TEXEL;
}

/** The row a gait's phase's positions are on; its normals are {@link ANIMATION_ROWS} / 2 below. */
export function animationRow(gaitIndex: number, phase: number): number {
  return gaitIndex * GAIT_PHASES + phase;
}

/** The kept vertices — indices into the source — and the triangles over them. */
export interface Decimated {
  /** For each kept vertex, its index in the source mesh. */
  readonly kept: Uint32Array;
  /** Three indices a triangle, into {@link kept}. */
  readonly indices: Uint32Array;
}

/** How many bisection steps {@link clusterDecimate} takes on the cube's size. */
const BISECTION_STEPS = 24;

/**
 * The body cut by vertex clustering to at most `maxTriangles` triangles, at
 * the smallest cube that does, never joining vertices whose `group` differs.
 * `positions` holds three numbers a vertex, `indices` three a triangle.
 * @see the header
 */
export function clusterDecimate(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  group: ArrayLike<number>,
  maxTriangles: number,
): Decimated {
  const vertices = Math.floor(positions.length / 3);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let vertex = 0; vertex < vertices; vertex += 1) {
    const x = positions[vertex * 3] as number;
    const y = positions[vertex * 3 + 1] as number;
    const z = positions[vertex * 3 + 2] as number;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  if (vertices === 0) return { kept: new Uint32Array(0), indices: new Uint32Array(0) };
  const diagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const origin = [minX, minY, minZ] as const;
  // The uncut mesh, if it is already inside the budget.
  if (indices.length / 3 <= maxTriangles) {
    return clustered(positions, indices, group, origin, 0);
  }
  let small = diagonal / 4096;
  let large = diagonal;
  let best = clustered(positions, indices, group, origin, large);
  for (let step = 0; step < BISECTION_STEPS; step += 1) {
    const middle = (small + large) / 2;
    const attempt = clustered(positions, indices, group, origin, middle);
    if (attempt.indices.length / 3 <= maxTriangles) {
      large = middle;
      best = attempt;
    } else {
      small = middle;
    }
  }
  return best;
}

/** One clustering at cube side `cell`; 0 keeps every vertex. */
function clustered(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  group: ArrayLike<number>,
  origin: readonly [number, number, number],
  cell: number,
): Decimated {
  const vertices = Math.floor(positions.length / 3);
  const clusterOf = new Int32Array(vertices);
  const keys = new Map<string, number>();
  const sums: number[] = [];
  for (let vertex = 0; vertex < vertices; vertex += 1) {
    const x = positions[vertex * 3] as number;
    const y = positions[vertex * 3 + 1] as number;
    const z = positions[vertex * 3 + 2] as number;
    const key =
      cell === 0
        ? String(vertex)
        : `${String(Math.floor((x - origin[0]) / cell))},${String(Math.floor((y - origin[1]) / cell))},${String(Math.floor((z - origin[2]) / cell))},${String(group[vertex] ?? 0)}`;
    let cluster = keys.get(key);
    if (cluster === undefined) {
      cluster = keys.size;
      keys.set(key, cluster);
      sums.push(0, 0, 0, 0);
    }
    clusterOf[vertex] = cluster;
    sums[cluster * 4] = (sums[cluster * 4] as number) + x;
    sums[cluster * 4 + 1] = (sums[cluster * 4 + 1] as number) + y;
    sums[cluster * 4 + 2] = (sums[cluster * 4 + 2] as number) + z;
    sums[cluster * 4 + 3] = (sums[cluster * 4 + 3] as number) + 1;
  }
  const clusters = keys.size;
  // Each cluster's representative: the source vertex nearest its mean.
  const representative = new Int32Array(clusters).fill(-1);
  const nearest = new Float64Array(clusters).fill(Number.POSITIVE_INFINITY);
  for (let vertex = 0; vertex < vertices; vertex += 1) {
    const cluster = clusterOf[vertex] as number;
    const count = sums[cluster * 4 + 3] as number;
    const dx = (positions[vertex * 3] as number) - (sums[cluster * 4] as number) / count;
    const dy = (positions[vertex * 3 + 1] as number) - (sums[cluster * 4 + 1] as number) / count;
    const dz = (positions[vertex * 3 + 2] as number) - (sums[cluster * 4 + 2] as number) / count;
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance < (nearest[cluster] as number)) {
      nearest[cluster] = distance;
      representative[cluster] = vertex;
    }
  }
  // The triangles that keep three distinct corners, each once.
  const seen = new Set<string>();
  const triangles: number[] = [];
  for (let at = 0; at + 2 < indices.length; at += 3) {
    const a = clusterOf[indices[at] as number] as number;
    const b = clusterOf[indices[at + 1] as number] as number;
    const c = clusterOf[indices[at + 2] as number] as number;
    if (a === b || b === c || a === c) continue;
    const sorted = [a, b, c].sort((first, second) => first - second);
    const key = sorted.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    triangles.push(a, b, c);
  }
  // Only the clusters a triangle uses, renumbered in first-use order.
  const renumbered = new Int32Array(clusters).fill(-1);
  const kept: number[] = [];
  const out = new Uint32Array(triangles.length);
  triangles.forEach((cluster, at) => {
    let index = renumbered[cluster] as number;
    if (index < 0) {
      index = kept.length;
      renumbered[cluster] = index;
      kept.push(representative[cluster] as number);
    }
    out[at] = index;
  });
  return { kept: Uint32Array.from(kept), indices: out };
}

/**
 * Each vertex's normal, the area-weighted mean of its triangles' — what the
 * renderer writes into a normal row of the animation texture for each posed
 * phase. `positions` holds three numbers a vertex, `indices` three a triangle.
 */
export function vertexNormals(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let at = 0; at + 2 < indices.length; at += 3) {
    const a = (indices[at] as number) * 3;
    const b = (indices[at + 1] as number) * 3;
    const c = (indices[at + 2] as number) * 3;
    const abx = (positions[b] as number) - (positions[a] as number);
    const aby = (positions[b + 1] as number) - (positions[a + 1] as number);
    const abz = (positions[b + 2] as number) - (positions[a + 2] as number);
    const acx = (positions[c] as number) - (positions[a] as number);
    const acy = (positions[c + 1] as number) - (positions[a + 1] as number);
    const acz = (positions[c + 2] as number) - (positions[a + 2] as number);
    // The cross product is twice the triangle's area along its normal.
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const corner of [a, b, c]) {
      normals[corner] = (normals[corner] as number) + nx;
      normals[corner + 1] = (normals[corner + 1] as number) + ny;
      normals[corner + 2] = (normals[corner + 2] as number) + nz;
    }
  }
  for (let at = 0; at + 2 < normals.length; at += 3) {
    const length = Math.hypot(
      normals[at] as number,
      normals[at + 1] as number,
      normals[at + 2] as number,
    );
    if (length > 0) {
      normals[at] = (normals[at] as number) / length;
      normals[at + 1] = (normals[at + 1] as number) / length;
      normals[at + 2] = (normals[at + 2] as number) / length;
    } else {
      normals[at + 1] = 1;
    }
  }
  return normals;
}

/** What a part of a person's body wears. The numbers are what the renderer's attribute carries. */
export const PersonRegion = { skin: 0, top: 1, bottoms: 2, shoes: 3, hair: 4 } as const;

/** One of {@link PersonRegion}'s values. */
export type PersonRegion = (typeof PersonRegion)[keyof typeof PersonRegion];

/** Where on the rest body the regions part, in the body's own units. */
export interface BodyLandmarks {
  /** The waist: below it on the trunk is bottoms, above it top. The `spine04` joint's height. */
  readonly waistY: number;
  /** The `head` joint. */
  readonly headY: number;
  readonly headZ: number;
  /** The top of the head: the body's highest point. */
  readonly crownY: number;
}

/**
 * What a vertex moved most by `bone` (one of MakeHuman's default skeleton's
 * names), at `(y, z)` on the rest body, wears: shoes on the feet, bottoms on
 * the legs and the trunk below the waist, a short-sleeved top above it and on
 * the upper arms, hair on the crown and the back of the head, and skin on the
 * forearms, the hands, the neck and the face. The rest body faces `+z`.
 */
export function regionOf(bone: string, y: number, z: number, at: BodyLandmarks): PersonRegion {
  if (bone.startsWith('foot')) return PersonRegion.shoes;
  if (bone.startsWith('lowerleg') || bone.startsWith('upperleg') || bone.startsWith('pelvis')) {
    return PersonRegion.bottoms;
  }
  if (bone.startsWith('spine') || bone === 'root') {
    return y < at.waistY ? PersonRegion.bottoms : PersonRegion.top;
  }
  if (bone.startsWith('clavicle') || bone.startsWith('upperarm')) return PersonRegion.top;
  if (bone === 'head') {
    const height = at.crownY - at.headY;
    // The crown, and the back of the head above the nape.
    if (y > at.headY + 0.6 * height) return PersonRegion.hair;
    if (z < at.headZ - 0.1 * height && y > at.headY - 0.1 * height) return PersonRegion.hair;
  }
  return PersonRegion.skin;
}
