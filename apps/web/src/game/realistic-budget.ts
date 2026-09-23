// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the realistic world may cost — [ADR 0026](../../../../docs/adr/0026-realistic-game-world.md)
 * D-6, written into source beside `quality.ts` with a test, because *"a budget
 * in a comment is not a budget"*.
 *
 * ## Where every number comes from — #457's windows, then the soak
 *
 * D-6 says the numbers are **measured by #457 before deciding**. #457's device
 * run was the first measurement: the owner's Pixel Tablet on 2026-09-22,
 * posted on #471 — every configuration held the 60 Hz vsync in a **30-second
 * window**; all-on at full resolution drew 45 calls and about 252 000
 * triangles and put the GPU at 10 ms at the 50th percentile and 19 ms at the
 * 90th (against 3 and 14 for the product as it was), with an estimated
 * 355 MiB of textures of which the trees were about 187 MiB and 2K surfaces
 * 128 MiB. Thermal status stayed 0. A 30-second window says the GPU fits and
 * nothing about a device that has been working for a quarter of an hour, so
 * every figure below was set well inside it rather than at it:
 *
 * - **Textures at less than half** the all-on estimate (160 MiB against 355),
 *   by taking the two levers that run itself named — 1K surfaces rather than
 *   2K, and trees at 512 px with their roughness maps dropped — and nothing
 *   else.
 * - **Triangles at about 1.2 times** the all-on count, and bounded by the
 *   near-mesh caps below rather than by the scenery density. Since
 *   [#476](https://github.com/openzigs/onyourleft/issues/476) **both realistic
 *   rungs draw at the display's rate** by the owner's ruling (`quality.ts`
 *   §`QUALITY_LADDER`), so the 16.7 ms frame is the budget these figures
 *   answer to and no figure here leans on a cap.
 *
 * ## ⚠️ Re-set from the twenty-minute soak — #475, and every number stands
 *
 * `docs/validation/0002-android-shell-and-game.md` Part Z is the soak D-6 was
 * waiting for, run on the same tablet on **2026-09-23** with a debug APK built
 * from `main` at `0530883`, at these figures exactly: every one of the
 * nineteen captured minutes on the realistic TOP rung at the display's rate,
 * 32 to 37 draw calls, zero stalls, thermal status 0 throughout, and over
 * 72 275 frames **GPU 5 / 8 / 12 ms** at p50 / p90 / p99 — p90 under half the
 * 16.7 ms frame, with the GPU sensor flat at 51–56 °C. #475 asked for these
 * constants to be re-set from that run, and the answer is that **none moves**:
 *
 * - **Nothing is raised**, although the soak left headroom. The run is ONE
 *   tablet, on charge, in a cool room; D-3 keeps the stylised world the
 *   default until a device CLASS is measured, and ADR 0008 D-4's floor device
 *   — 3 GB — has never run this at all. A budget raised on the evidence of the
 *   best device there is would be a budget for that device.
 * - **Nothing is lowered**, because nothing failed: the top rung held for the
 *   whole soak and the ladder never had to leave it.
 * - ⚠️ **Memory is the finding, and it is recorded rather than acted on.** The
 *   driver held **310 MiB** under `GL mtrack` at minute 10, about 2.3 times
 *   the 136 MiB this file's arithmetic estimates for the committed set
 *   ({@link REALISTIC_TEXTURE_MEMORY_BYTES}). The estimate counts texture
 *   images and their mipmaps; the driver's figure also holds the 2560 × 1600
 *   render targets and every vertex buffer, and the run did not separate them.
 *   So the 160 MiB ceiling stays a ceiling on what the SET may ask for — the
 *   one thing a pipeline recipe can change — and is not a claim about what a
 *   device holds. Separating the driver's figure is the next device run's.
 *
 * `realistic-budget.test.ts` reads every committed realistic file back off
 * disk and holds it here, so a pipeline recipe that asks for more fails before
 * it ships.
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
 * realistic path, which a ride takes only for a rider who chose it (#475)
 */
export const REALISTIC_TEXTURE_CEILING_PIXELS = 2048;

/**
 * The largest side a texture of each class may have, inside that ceiling.
 *
 * - `sky` 2048 — the equirectangular HDR, the size the owner looked at;
 * - `surface` 1024 — #457's device run put 2K surfaces at 128 MiB and 1K at 32;
 * - `model` 512 — every map inside a tree, shrub or rock GLB;
 * - `impostor` 2048 — the strip is eight 256-pixel frames side by side;
 * - `structure` 512 — #475: a structure's photographic surfaces, colour and
 *   normal, downsized by the pipeline. A wall a rider passes at 10 m fills
 *   about a tenth of the screen's height, and 512 px over Poly Haven's 2 m
 *   repeat is 4 mm a texel, which is finer than the tablet can show there.
 *   Chosen, like every figure here, not measured on a device.
 *
 * @test-facing held by `realistic-budget.test.ts`, which reads every committed
 * realistic file back off disk against it; the renderer spends it only on the
 * realistic path, which a ride takes only for a rider who chose it (#475)
 */
export const REALISTIC_TEXTURE_PIXELS = {
  sky: 2048,
  surface: 1024,
  model: 512,
  impostor: 2048,
  structure: 512,
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
 * realistic path, which a ride takes only for a rider who chose it (#475)
 */
export const REALISTIC_TRIANGLES: Readonly<
  Record<RealisticVegetationKind | 'rider' | 'structure', number>
> = {
  'tree-broadleaf': 28_000,
  'tree-conifer': 24_000,
  shrub: 6_500,
  rock: 2_500,
  rider: 9_000,
  /**
   * One realistic structure, every surface together, in its heaviest shape —
   * #475, and since #500 a building with its doors, windows, eaves and
   * chimneys: **640**. Built in `three-renderer.ts` from `buildings.ts`'
   * numbers rather than read off a file, so it is held there
   * (`realisticStructureTriangles`). The heaviest today is a church at 580:
   * six arched nave windows, an arched door and window in the tower, each
   * framed, recessed and glazed.
   *
   * ⚠️ **It was 96 until #500**, when the heaviest built shape was a fence's
   * five posts and two rails and a house was 18 triangles. A reviewer who
   * remembers a house cheaper than a fence is reading the old file.
   *
   * ⚠️ **Why the frame's triangles still do not count the structures**, which
   * {@link REALISTIC_FRAME_TRIANGLES} says of the stylised world's: a realistic
   * structure is drawn with **no more** triangles than the stylised world
   * draws at the same place — the SAME triangles for the four buildings
   * `buildings.ts` builds in both worlds and for the four boundaries, and for
   * a house no more than the lightest Kenney house the stylised world draws
   * there (770) — and `realistic-budget.test.ts` holds that, kind by kind and
   * shape by shape. The same test holds this figure under that house, so no
   * built shape costs the stylised world more a building than the pack's own
   * houses always have.
   */
  structure: 640,
};

/**
 * The most triangles the bicycle `three-renderer.ts` builds under the realistic
 * rider may have. It is this repository's own geometry, built from
 * `bicycle.ts`'s parts, so its count is asserted against the geometry the
 * renderer actually builds rather than read off a file.
 *
 * @test-facing held by `realistic-budget.test.ts`, which reads every committed
 * realistic file back off disk against it; the renderer spends it only on the
 * realistic path, which a ride takes only for a rider who chose it (#475)
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
 * The most instanced meshes the realistic STRUCTURES may cost: **35** — #482,
 * from #481's review (finding 6), which found the figure bounded and stated
 * nowhere; and since #500, which gave every building two shapes and dressed
 * its frames in timber and its panes in glass.
 *
 * `three-renderer.ts` §`RealisticStructureBelts` builds one belt a surface and,
 * in each, one mesh for every kind **and shape** that wears that surface — so
 * the count is the (surface, kind, shape) triples `buildings.ts` and
 * `realistic-assets.ts` §`REALISTIC_BUILDING_SURFACES` produce, and the pairs
 * of §`REALISTIC_BOUNDARY_PARTS`: a house 4 surfaces (brick, tiles, timber,
 * glass), a church 4 (stone, slate, timber, glass), a row of shops 4 (brick,
 * slate, timber, glass), a barn 2 (timber, iron) and a shed 1, each in two
 * shapes — 30 — and a wall, a hedge and a fence 1 each and a signpost 2.
 *
 * ⚠️ **15 → 35 with #500, deliberately, and what it costs is not 20 draw
 * calls.** A mesh with no instance this frame is not drawn (three's
 * `renderInstances` returns early on a count of zero), so the calls a frame
 * spends are the (surface, shape) pairs of the buildings actually in view: a
 * farmstead of one house, a barn and a shed is 4 + 2 + 1 = 7 where it was
 * 2 + 2 + 1 = 5, and a village showing both shapes of house, a row of shops
 * and a church is at most 8 + 4 + 4 = 16 where it was 2 + 3 + 2 = 7. The
 * glass is a surface of its own because it is a material of its own, and it
 * costs no texture. What those calls cost on the tablet is validation 0002
 * Part Z step Z9's re-run, which #500 asks for and which needs the tablet.
 *
 * ⚠️ **A statement of what is built, not a measurement of what it costs.**
 * What this number buys is that a new structure kind, surface or shape GROWS
 * it visibly: the test counts the meshes the real belts build, so an added one
 * is a red test and an edit here, rather than a draw call nobody decided to
 * spend.
 *
 * @test-facing held by `three-renderer.test.ts` §"#482", which counts the
 * meshes `RealisticStructureBelts` actually builds against it
 */
export const REALISTIC_STRUCTURE_MESHES = 35;

/**
 * The most triangles a realistic frame may submit: **300 000**, about 1.2 times
 * the all-on 252 024 #457 drew on the tablet. What it is held against is the
 * worst case the caps above allow — every near slot filled with the heaviest
 * shape of its kind, and three riders — rather than any frame in particular.
 * The stylised world's corridor, terrain and structures sit under it on both
 * worlds and are not counted here, because they do not change with the world
 * — and since #475 the realistic structures are no heavier than the stylised
 * ones at the same place ({@link REALISTIC_TRIANGLES}' `structure`).
 *
 * @test-facing held by `realistic-budget.test.ts`, which reads every committed
 * realistic file back off disk against it; the renderer spends it only on the
 * realistic path, which a ride takes only for a rider who chose it (#475)
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
 * realistic path, which a ride takes only for a rider who chose it (#475)
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
 * realistic path, which a ride takes only for a rider who chose it (#475)
 */
export const REALISTIC_BUILD_BYTES = 40 * MEBIBYTE;

/**
 * The shape of one texture, for {@link estimatedTextureBytes}.
 *
 * @test-facing held by `realistic-budget.test.ts`, which reads every committed
 * realistic file back off disk against it; the renderer spends it only on the
 * realistic path, which a ride takes only for a rider who chose it (#475)
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
 * realistic path, which a ride takes only for a rider who chose it (#475)
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
 * realistic path, which a ride takes only for a rider who chose it (#475)
 */
export function environmentMapBytes(skyWidth: number): number {
  const cube = 2 ** Math.floor(Math.log2(skyWidth / 4));
  const width = 3 * Math.max(cube, 16 * 7);
  const height = 4 * cube;
  return width * height * 8;
}
