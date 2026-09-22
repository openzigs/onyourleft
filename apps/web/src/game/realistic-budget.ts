// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the realistic world may cost — [ADR 0026](../../../../docs/adr/0026-realistic-game-world.md)
 * D-6, written into source beside `quality.ts` with a test, because *"a budget
 * in a comment is not a budget"*.
 *
 * ## ⚠️ PROVISIONAL, every number, and why
 *
 * D-6 says the numbers are **measured by #457 before deciding**. #457's device
 * run is the only measurement there is: the owner's Pixel Tablet on
 * 2026-09-22, posted on #471 — every configuration held the 60 Hz vsync in a
 * **30-second window**; all-on at full resolution drew 45 calls and about
 * 252 000 triangles and put the GPU at 10 ms at the 50th percentile and 19 ms
 * at the 90th (against 3 and 14 for the product as it was), with an
 * estimated 355 MiB of textures of which the trees were about 187 MiB and 2K
 * surfaces 128 MiB. Thermal status stayed 0.
 *
 * **The twenty-minute soak has not been run.** A 30-second window says the
 * GPU fits; it says nothing about a phone that has been working for a quarter
 * of an hour, which is the case a quality ladder exists for. So every figure
 * below is set well inside what that run showed rather than at it, and each
 * says so:
 *
 * - **Textures at less than half** the all-on estimate (160 MiB against 355),
 *   by taking the two levers that run itself named — 1K surfaces rather than
 *   2K, and trees at 512 px with their roughness maps dropped — and nothing
 *   else.
 * - **Triangles at about 1.2 times** the all-on count, and bounded by the
 *   near-mesh caps below rather than by the scenery density. The run's p90 of
 *   19 ms was over the 16.7 ms frame at the tail. ⚠️ `quality.ts` declares a
 *   30 fps cap that would double that budget, and **nothing in the product
 *   reads it** — found while writing this, and filed as
 *   [#476](https://github.com/openzigs/onyourleft/issues/476) — so the frame is
 *   drawn at the display's rate and no figure here leans on the cap.
 *
 * `docs/validation/0002-android-shell-and-game.md` Part Z is the soak, with
 * its cells empty; [#475](https://github.com/openzigs/onyourleft/issues/475)
 * owns running it and re-setting these from it. `realistic-budget.test.ts`
 * reads every committed realistic file back off disk and holds it here, so a
 * pipeline recipe that asks for more fails before it ships.
 *
 * ⚠️ **Per renderer.** These are three.js numbers (D-6's closing note): a
 * native renderer, if #434 adopts one, has its own.
 */

import type { RealisticVegetationKind } from './realistic-assets';

const MEBIBYTE = 1024 * 1024;

/**
 * The largest side any committed realistic texture may have: **2048** — D-6's
 * hard ceiling, decided in the ADR rather than here. 4K and 8K source maps are
 * downsized by the pipeline and never committed at source resolution.
 *
 * @test-facing held by `realistic-budget.test.ts`, which reads every committed
 * realistic file back off disk against it; the renderer spends it only on the
 * realistic path, which nothing the shipped app runs reaches until #475
 */
export const REALISTIC_TEXTURE_CEILING_PIXELS = 2048;

/**
 * The largest side a texture of each class may have, inside that ceiling.
 *
 * - `sky` 2048 — the equirectangular HDR, the size the owner looked at;
 * - `surface` 1024 — #457's device run put 2K surfaces at 128 MiB and 1K at 32;
 * - `model` 512 — every map inside a tree, shrub or rock GLB;
 * - `impostor` 2048 — the strip is eight 256-pixel frames side by side.
 *
 * @test-facing held by `realistic-budget.test.ts`, which reads every committed
 * realistic file back off disk against it; the renderer spends it only on the
 * realistic path, which nothing the shipped app runs reaches until #475
 */
export const REALISTIC_TEXTURE_PIXELS = {
  sky: 2048,
  surface: 1024,
  model: 512,
  impostor: 2048,
} as const;

/**
 * The most triangles one committed model of each class may have.
 *
 * The trees' figures are what `tools/realistic/sources.ts` asks the pipeline
 * for; the pipeline stops at or under them, and the test reads what it
 * actually shipped. #457 drew 20 000 and its write-up says the thinned canopy
 * is visible up close at that budget, which is why these are a little higher
 * and the near band is capped by count instead (below).
 *
 * @test-facing held by `realistic-budget.test.ts`, which reads every committed
 * realistic file back off disk against it; the renderer spends it only on the
 * realistic path, which nothing the shipped app runs reaches until #475
 */
export const REALISTIC_TRIANGLES: Readonly<Record<RealisticVegetationKind | 'rider', number>> = {
  'tree-broadleaf': 28_000,
  'tree-conifer': 24_000,
  shrub: 6_500,
  rock: 2_500,
  rider: 9_000,
};

/**
 * The most triangles the bicycle `three-renderer.ts` builds under the realistic
 * rider may have. It is this repository's own geometry, built from
 * `bicycle.ts`'s parts, so its count is asserted against the geometry the
 * renderer actually builds rather than read off a file.
 *
 * @test-facing held by `realistic-budget.test.ts`, which reads every committed
 * realistic file back off disk against it; the renderer spends it only on the
 * realistic path, which nothing the shipped app runs reaches until #475
 */
export const REALISTIC_BICYCLE_TRIANGLES = 12_000;

/**
 * How many items of each kind are drawn as MESHES in one frame — the nearest
 * ones; every tree beyond is an impostor, and every shrub and rock beyond is
 * not drawn.
 *
 * ⚠️ **This is what bounds the frame's triangles, not the scenery density.**
 * `scatter.ts` places up to `SCATTER_MAX_ITEMS` and a forest is nearly all
 * conifer, so a cap by distance alone would put thirty 24 000-triangle trees in
 * the near band on a wooded road. A cap by count holds whatever the road.
 *
 * Six trees is the chase camera's near field: #424's camera sees the road about
 * 4.5 m behind the rider, and the scatter's own near-60 m gate
 * (`scatter.test.ts` §"#351") counts well under that inside 25 m.
 */
export const REALISTIC_NEAR_MESHES: Readonly<Record<RealisticVegetationKind, number>> = {
  'tree-broadleaf': 3,
  'tree-conifer': 3,
  shrub: 8,
  rock: 12,
};

/**
 * The most triangles a realistic frame may submit: **300 000**, about 1.2 times
 * the all-on 252 024 #457 drew on the tablet. What it is held against is the
 * worst case the caps above allow — every near slot filled with the heaviest
 * shape of its kind, and three riders — rather than any frame in particular.
 * The stylised world's corridor, terrain and structures sit under it on both
 * worlds and are not counted here, because they do not change with the world.
 *
 * @test-facing held by `realistic-budget.test.ts`, which reads every committed
 * realistic file back off disk against it; the renderer spends it only on the
 * realistic path, which nothing the shipped app runs reaches until #475
 */
export const REALISTIC_FRAME_TRIANGLES = 300_000;

/**
 * The most GPU texture memory the realistic set may hold, estimated: **160 MiB**,
 * under half the 355 MiB all-on estimate #457 drew on the tablet.
 *
 * ⚠️ **An estimate, and labelled one** — the same estimate #457 published:
 * width × height × bytes a texel, a third again for mipmaps, the HDR at
 * half-float. A driver may pad, compress or evict; nothing in a browser reports
 * what it actually did. {@link estimatedTextureBytes} is the arithmetic.
 *
 * @test-facing held by `realistic-budget.test.ts`, which reads every committed
 * realistic file back off disk against it; the renderer spends it only on the
 * realistic path, which nothing the shipped app runs reaches until #475
 */
export const REALISTIC_TEXTURE_MEMORY_BYTES = 160 * MEBIBYTE;

/**
 * The most bytes the realistic set may add to the build — and so to the APK,
 * where `capacitor.config.ts` copies all of `dist` (ADR 0026 D-7): **40 MiB**.
 *
 * Nobody measured what an APK this size costs a rider to install; the figure is
 * a ceiling on growth rather than a target, and the pull request that lands the
 * set states the number it actually adds.
 *
 * @test-facing held by `realistic-budget.test.ts`, which reads every committed
 * realistic file back off disk against it; the renderer spends it only on the
 * realistic path, which nothing the shipped app runs reaches until #475
 */
export const REALISTIC_BUILD_BYTES = 40 * MEBIBYTE;

/**
 * The shape of one texture, for {@link estimatedTextureBytes}.
 *
 * @test-facing held by `realistic-budget.test.ts`, which reads every committed
 * realistic file back off disk against it; the renderer spends it only on the
 * realistic path, which nothing the shipped app runs reaches until #475
 */
export interface TextureShape {
  readonly width: number;
  readonly height: number;
  /** 4 for 8-bit RGBA; 8 for half-float RGBA, which is what three makes of an HDR. */
  readonly bytesPerTexel: number;
  readonly mipmapped: boolean;
}

/**
 * What one texture costs the GPU, estimated. @see REALISTIC_TEXTURE_MEMORY_BYTES
 *
 * @test-facing held by `realistic-budget.test.ts`, which reads every committed
 * realistic file back off disk against it; the renderer spends it only on the
 * realistic path, which nothing the shipped app runs reaches until #475
 */
export function estimatedTextureBytes(shape: TextureShape): number {
  const base = shape.width * shape.height * shape.bytesPerTexel;
  return shape.mipmapped ? (base * 4) / 3 : base;
}

/**
 * What prefiltering an equirectangular sky into an environment map costs.
 *
 * three's `PMREMGenerator` renders it into one atlas whose cube face is the
 * largest power of two not over a quarter of the image's width, three faces
 * wide and four high — `_setSize` and `_allocateTargets` in
 * `PMREMGenerator.js`, three 0.185.1, read rather than guessed — at half-float
 * RGBA with no mipmaps. The generator's own ping-pong target, the same size, is
 * released when the generator is disposed, which `three-renderer.ts` does as
 * soon as the map is made.
 *
 * @test-facing held by `realistic-budget.test.ts`, which reads every committed
 * realistic file back off disk against it; the renderer spends it only on the
 * realistic path, which nothing the shipped app runs reaches until #475
 */
export function environmentMapBytes(skyWidth: number): number {
  const cube = 2 ** Math.floor(Math.log2(skyWidth / 4));
  const width = 3 * Math.max(cube, 16 * 7);
  const height = 4 * cube;
  return width * height * 8;
}
