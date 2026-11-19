// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A person's body — #1541, and since the owner's request of 2026-11-18 ("can
 * we use a real model for the pedestrian") a MODEL, not the rider's body cut
 * down: `realistic-assets.ts` §`REALISTIC_PEOPLE` is three dressed people,
 * MakeHuman's CC0 base mesh in MakeHuman's own CC0 clothes, made by
 * `tools/realistic/blender/process_people.py`. This file is the arithmetic of
 * the textures their walk, run and ride are baked into, and of drawing every
 * one of them in ONE instanced call.
 *
 * Until then a person was the rider's body cut by vertex clustering when the
 * page loaded and painted by region: one build, clothes that were the skin
 * stood 1.3 cm off itself, bare feet for shoes, and a face the clustering had
 * folded (the owner's pictures of 2026-11-18).
 *
 * ## One call for three different bodies: the slots
 *
 * Three bodies are three index buffers, and an instanced draw has one. So the
 * shared geometry holds no body at all: it is {@link PERSON_MAX_TRIANGLES}
 * triangles of numbered CORNERS ("slots"), and the vertex shader looks its
 * slot up in the SLOT TEXTURE at its instance's body — which column of the
 * animation texture it is, its region and its place in the atlas
 * ({@link slotTexel}). A body with fewer triangles leaves its last slots on
 * one column, which is a triangle of no size. Sixteen instances are therefore
 * sixteen bodies of their own triangles each, never three bodies' worth
 * folded away, and one call.
 *
 * ## The animation texture
 *
 * A COLUMN is one place on a body: every vertex of the model at that place —
 * split by a seam of the atlas or between two regions — is one column
 * ({@link weld}). The texture holds each column's position at
 * {@link PHASES} phases of the walk and of the run (`gait.ts`), and for the
 * first body at {@link RIDE_PHASES} of a cyclist's crank (#2722), as
 * half-float RGBA: the position in the first three, and in the fourth its
 * NORMAL, as one whole number ({@link packNormal}) — a normal row of its own
 * would have been half the texture again.
 *
 * {@link animationLayout} lays the bodies' columns side by side and wraps
 * them into as few BLOCKS as the narrowest device's texture needs
 * ({@link ANIMATION_MAX_WIDTH}); the ride's rows follow the last block, as
 * wide as the first body alone. {@link peopleTextureBytes} is what both
 * textures cost, held under {@link PERSON_ANIMATION_MAX_BYTES}.
 *
 * Pure, and names no rendering library.
 */

import { GAITS, type Gait } from './gait';

/** The most triangles one person's body may be: **2 000** — #1541's figure. */
export const PERSON_MAX_TRIANGLES = 2_000;

/**
 * The most bodies the people's model may hold: **4**, the rows of its atlas
 * (`process_people.py` §`TILE`). Three ship.
 */
export const PEOPLE_BODIES_MAX = 4;

/**
 * The most bytes the people's two data textures — the animation and the slots
 * — may take together: **1 MiB**, #1541's "about 1 MiB of animation texture".
 *
 * @test-facing held by `people-body.test.ts`, which reads the committed
 * model, and by `realistic-budget.test.ts`, which adds it to the texture estimate
 */
export const PERSON_ANIMATION_MAX_BYTES = 1024 * 1024;

/**
 * Bytes a texel of either texture: half-float RGBA.
 *
 * @test-facing held by {@link peopleTextureBytes}; the renderer's own size of
 * its textures (`three-renderer.ts` §`PeopleBelt.animationBytes`) is read
 * only by the browser gate
 */
export const ANIMATION_BYTES_PER_TEXEL = 8;

/**
 * How many phases of its cycle each gait is baked at: a walk at **12** and a
 * run at **8**. The shader blends the two nearest, so the motion is
 * continuous. `gait.ts` §`GAIT_PHASES` was 24 for both while one body filled
 * the texture; three bodies share it now, and at the 4 m and more a person is
 * drawn from, a walk's knee between two phases 30° of the cycle apart is
 * within a centimetre of the gait's own. Runners are few, and on paths only.
 */
export const PHASES: Readonly<Record<Gait, number>> = { walk: 12, run: 8 };

/**
 * How many phases of a crank's turn a scenery cyclist's body is baked at —
 * #2722: **12**, a phase every 30°. A foot on a 0.17 m crank cuts the corner
 * between two phases by under 6 mm.
 */
export const RIDE_PHASES = 12;

/**
 * Where the cyclists' phases are, as a gait's index: **after every gait**,
 * which is what an instance says in place of a gait to be drawn riding.
 */
export const RIDE_GAIT_INDEX = GAITS.length;

/** Rows of one block: every phase of every gait. */
export const GAIT_ROWS = GAITS.reduce((sum, gait) => sum + PHASES[gait], 0);

/** The first row of a gait's phases inside a block, by the gait's index. */
export function gaitRow(gaitIndex: number): number {
  let row = 0;
  for (let at = 0; at < gaitIndex; at += 1) row += PHASES[GAITS[at] as Gait];
  return row;
}

/**
 * The widest the animation texture may be: **2 048**, the least
 * `MAX_TEXTURE_SIZE` WebGL 2 allows a device to have.
 */
export const ANIMATION_MAX_WIDTH = 2048;

/** How the bodies' columns are laid into the animation texture. @see animationLayout */
export interface AnimationLayout {
  /** Texels across. */
  readonly width: number;
  /** How many times the columns wrap: a block is {@link GAIT_ROWS} rows. */
  readonly blocks: number;
  /** Texels down: every block, then the ride's rows. */
  readonly height: number;
  /** For each body, the first of its columns among all the bodies'. */
  readonly base: readonly number[];
}

/**
 * The animation texture's layout for bodies of `columns` columns each: the
 * columns side by side in the bodies' order, wrapped into the fewest blocks
 * no wider than {@link ANIMATION_MAX_WIDTH} and those made as narrow as they
 * can be. The first body's columns must fit one block's width, because the
 * ride's rows are theirs alone — a model that breaks that is refused.
 */
export function animationLayout(columns: readonly number[]): AnimationLayout {
  const total = columns.reduce((sum, each) => sum + each, 0);
  const blocks = Math.max(1, Math.ceil(total / ANIMATION_MAX_WIDTH));
  const width = Math.max(1, Math.ceil(total / blocks));
  if ((columns[0] ?? 0) > width) {
    throw new Error('the first body is wider than a block: its ride cannot be laid out');
  }
  const base: number[] = [];
  let next = 0;
  for (const each of columns) {
    base.push(next);
    next += each;
  }
  return { width, blocks, height: blocks * GAIT_ROWS + RIDE_PHASES, base };
}

/**
 * The texel a column's position is at, at one phase of a gait — or, at
 * {@link RIDE_GAIT_INDEX}, of the ride, which only the first body has.
 * `column` counts across every body ({@link AnimationLayout.base}).
 */
export function animationTexel(
  layout: AnimationLayout,
  column: number,
  gaitIndex: number,
  phase: number,
): { readonly x: number; readonly y: number } {
  if (gaitIndex === RIDE_GAIT_INDEX) return { x: column, y: layout.blocks * GAIT_ROWS + phase };
  return {
    x: column % layout.width,
    y: Math.floor(column / layout.width) * GAIT_ROWS + gaitRow(gaitIndex) + phase,
  };
}

/** Texels across the slot texture. */
export const SLOT_WIDTH = 256;

/** Rows of the slot texture one body takes, for bodies of at most `triangles` triangles. */
export function slotRows(triangles: number): number {
  return Math.ceil((3 * triangles) / SLOT_WIDTH);
}

/** The texel a body's slot is at, for bodies of at most `triangles` triangles. */
export function slotTexel(
  body: number,
  slot: number,
  triangles: number,
): { readonly x: number; readonly y: number } {
  return { x: slot % SLOT_WIDTH, y: body * slotRows(triangles) + Math.floor(slot / SLOT_WIDTH) };
}

/**
 * What a slot's second number carries: the column's block and the corner's
 * region, as `block * SLOT_REGIONS + region` — both small whole numbers, so
 * a half float holds them exactly.
 */
export const SLOT_REGIONS = 8;

/**
 * The bytes the people's two textures take, for bodies of `columns` columns
 * and `triangles` triangles each: the animation, a texel a column a row, and
 * the slots, a texel a corner of the largest body for every body.
 *
 * @test-facing held by `people-body.test.ts` against the committed model; the
 * renderer reads its own textures' size (`three-renderer.ts`
 * §`PeopleBelt.animationBytes`), which the browser gate holds to this
 */
export function peopleTextureBytes(
  columns: readonly number[],
  triangles: readonly number[],
): number {
  const layout = animationLayout(columns);
  const most = Math.max(0, ...triangles);
  return (
    (layout.width * layout.height + SLOT_WIDTH * slotRows(most) * columns.length) *
    ANIMATION_BYTES_PER_TEXEL
  );
}

/**
 * How finely a normal is kept: **64** steps along each of the two numbers an
 * octahedral map makes of it, so 4 096 normals — numbered from −2 048, since
 * a half float holds every whole number from −2 048 to 2 048 exactly and no
 * further. The worst a normal comes back turned is under 4°, on a body a few
 * hundred pixels tall wearing a photograph.
 */
export const NORMAL_STEPS = 64;

/** What {@link packNormal} takes off a normal's number so a half float holds it: half of them. */
const NORMAL_OFFSET = (NORMAL_STEPS * NORMAL_STEPS) / 2;

/**
 * A unit normal as one whole number in `[-NORMAL_STEPS² / 2, NORMAL_STEPS² / 2)`:
 * the octahedral map's two numbers (Meyer et al., 2010), each rounded to
 * {@link NORMAL_STEPS} steps. @see unpackNormal
 */
export function packNormal(x: number, y: number, z: number): number {
  const sum = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
  let u = x / sum;
  let v = z / sum;
  if (y < 0) {
    const foldedU = (1 - Math.abs(v)) * (u >= 0 ? 1 : -1);
    const foldedV = (1 - Math.abs(u)) * (v >= 0 ? 1 : -1);
    u = foldedU;
    v = foldedV;
  }
  const step = (value: number): number =>
    Math.min(NORMAL_STEPS - 1, Math.max(0, Math.round(((value + 1) / 2) * (NORMAL_STEPS - 1))));
  return step(u) + NORMAL_STEPS * step(v) - NORMAL_OFFSET;
}

/**
 * The unit normal {@link packNormal} packed — what the bodies' vertex shader
 * does in GLSL (`three-renderer.ts` §`PEOPLE_NORMAL_GLSL`).
 *
 * @test-facing the shader's twin: `people-body.test.ts` holds how far a
 * normal comes back turned, and the GLSL's own text to this
 */
export function unpackNormal(packed: number): readonly [number, number, number] {
  const at = packed + NORMAL_OFFSET;
  const row = Math.floor(at / NORMAL_STEPS);
  const u = ((at - row * NORMAL_STEPS) / (NORMAL_STEPS - 1)) * 2 - 1;
  const v = (row / (NORMAL_STEPS - 1)) * 2 - 1;
  const y = 1 - Math.abs(u) - Math.abs(v);
  const fold = Math.max(-y, 0);
  const x = u + (u >= 0 ? -fold : fold);
  const z = v + (v >= 0 ? -fold : fold);
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

/** A model's vertices gathered into columns. @see weld */
export interface Welded {
  /** For each vertex, its column. */
  readonly column: Uint32Array;
  /** For each column, the first vertex that is it: whose position and weights the column takes. */
  readonly first: Uint32Array;
}

/**
 * The vertices of a body gathered into columns: every vertex at exactly the
 * same place is one. A glTF file holds a vertex once for each texture
 * coordinate and region it has, at the same three numbers each time, so
 * exact equality is the test and no distance is typed. `positions` holds
 * three numbers a vertex.
 */
export function weld(positions: ArrayLike<number>): Welded {
  const vertices = Math.floor(positions.length / 3);
  const column = new Uint32Array(vertices);
  const first: number[] = [];
  const seen = new Map<string, number>();
  for (let vertex = 0; vertex < vertices; vertex += 1) {
    const key = `${String(positions[vertex * 3])},${String(positions[vertex * 3 + 1])},${String(positions[vertex * 3 + 2])}`;
    let at = seen.get(key);
    if (at === undefined) {
      at = first.length;
      seen.set(key, at);
      first.push(vertex);
    }
    column[vertex] = at;
  }
  return { column, first: Uint32Array.from(first) };
}

/**
 * Each vertex's normal, the area-weighted mean of its triangles' — what the
 * renderer packs beside each posed position. `positions` holds three numbers
 * a vertex, `indices` three a triangle.
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

/** What a part of a person's body wears. The numbers are what a slot carries. */
export const PersonRegion = { skin: 0, top: 1, bottoms: 2, shoes: 3, hair: 4 } as const;

/** One of {@link PersonRegion}'s values. */
export type PersonRegion = (typeof PersonRegion)[keyof typeof PersonRegion];

/**
 * The region a primitive of the people's model is, by the name the pipeline
 * gave its material (`process_people.py` §`REGION`), or `undefined` for a
 * name that is none of them — which the renderer refuses, never paints as skin.
 */
export function regionNamed(name: string): PersonRegion | undefined {
  return Object.hasOwn(PersonRegion, name)
    ? PersonRegion[name as keyof typeof PersonRegion]
    : undefined;
}
