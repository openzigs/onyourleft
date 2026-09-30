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
import type { TreeLevels } from './tree-levels';

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
 * - `bicycle` 256 — #624: the realistic bicycle's drawn maps. A tyre at the
 *   chase camera is a dozen pixels across on the tablet, and a 256-texel tile
 *   of tread is 0.6 mm a texel; the maps are drawn at this size and never
 *   downsized, because there is no source larger than they are.
 * - `rider` 1024 — #623: the rider's kit, relief and occlusion maps, over the
 *   whole body's texture coordinates. The torso is about 600 texels round,
 *   under 2 mm a texel, which is finer than the chase camera shows; 1024 is
 *   what #618's compression makes affordable inside the 6 MiB #623 allows,
 *   where RGBA8 would have been 16 MiB for the three.
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
  bicycle: 256,
  rider: 1024,
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
  Record<RealisticVegetationKind | 'tree-middle' | 'rider' | 'structure', number>
> = {
  'tree-broadleaf': 28_000,
  'tree-conifer': 24_000,
  /**
   * A tree's middle level of detail, either kind — #617: **6 000**, the top of
   * the 4 000–6 000 the issue suggested. It is the most the frame's saving
   * leaves room for: {@link REALISTIC_TREE_LEVELS} draws up to six trees at
   * this level, and at 6 000 the worst frame still falls by 63 988, over the
   * 60 000 #617 asks; at 6 700 it would not. The most, rather than less,
   * because a middle tree is already a fifth of a near one's triangles, and
   * every triangle here is canopy a rider sees at 20 to 60 m.
   */
  'tree-middle': 6_000,
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
   * ⚠️ **The frame's triangles COUNT the structures since
   * [#506](https://github.com/openzigs/onyourleft/issues/506)**, and a reviewer
   * who remembers this note saying why they need not is reading the old file.
   * It argued that a realistic structure is no heavier than the stylised one
   * at the same place — which is still true, and `realistic-budget.test.ts`
   * still holds it kind by kind and shape by shape, under the lightest Kenney
   * house (770) — and concluded that the frame need not count them. The
   * conclusion did not follow: the stylised world has no triangle budget to be
   * no heavier than, and 240 buildings at this figure are 153 600 triangles a
   * frame that {@link REALISTIC_FRAME_TRIANGLES} never saw. It was over before
   * #500 as well, by less: 240 fences at 84 triangles are 20 160, against
   * 4 314 of room. {@link REALISTIC_STRUCTURE_ITEMS} is what bounds them now.
   */
  structure: 640,
};

/**
 * The most triangles the bicycle `three-renderer.ts` builds under the realistic
 * rider may have. It is this repository's own geometry, built from
 * `bicycle.ts`'s parts, so its count is asserted against the geometry the
 * renderer actually builds rather than read off a file.
 *
 * ⚠️ **A ceiling on the bicycle, and since #506 NOT a term of the frame's
 * sum**: {@link REALISTIC_FRAME_TRIANGLES}' test counts the bicycle as built
 * (5 308 today), as it counts every other asset. @see REALISTIC_STRUCTURE_ITEMS
 *
 * @test-facing held by `realistic-renderer.test.ts` §"the realistic bicycle —
 * #369", which holds the geometry the renderer builds to it (until #506 the
 * frame sum in `realistic-budget.test.ts` read it too)
 */
export const REALISTIC_BICYCLE_TRIANGLES = 12_000;

/**
 * How many SHRUBS and ROCKS are drawn as meshes in one frame — the nearest
 * ones; every one beyond is not drawn at all.
 *
 * ⚠️ **This is what bounds the frame's triangles, not the scenery density.**
 * `scatter.ts` places up to `SCATTER_MAX_ITEMS`, so a cap by distance alone
 * would put dozens of shrubs in the near band on an overgrown verge. A cap by
 * count holds whatever the road.
 *
 * ⚠️ **The trees are not here since #617**, and a reviewer who remembers
 * "the nearest 3 broadleaf and 3 conifer" is reading the old file: they have
 * three levels now, counted by {@link REALISTIC_TREE_LEVELS}.
 */
export const REALISTIC_NEAR_MESHES: Readonly<
  Record<Exclude<RealisticVegetationKind, 'tree-broadleaf' | 'tree-conifer'>, number>
> = {
  shrub: 8,
  rock: 12,
};

/**
 * How many realistic trees are drawn at each level of detail — #617:
 * **one** full mesh, **four** middle ones, and a band of one tree at each
 * hand-over drawn at both levels and dithered between them (`tree-levels.ts`
 * says how). Every tree beyond is its impostor.
 *
 * So at most **two** trees are ever submitted as the full mesh and **six** as
 * the middle one: `tree-levels.ts` §`treeSlots`.
 *
 * ## The worst frame, before and after
 *
 * | Trees | Triangles |
 * |---|--:|
 * | Before: 3 broadleaf at 28 000 and 3 conifer at 23 996, hard swap | 155 988 |
 * | Now: 2 full at 28 000 (either kind's heaviest) | 56 000 |
 * | Now: 6 middle at 5 998 (the heaviest committed middle file) | 35 988 |
 * | Now, together | 91 988 |
 *
 * — **64 000 fewer** (63 988 with every middle file at its 6 000 ceiling),
 * which is #617's "at least 60 000", and
 * `realistic-budget.test.ts` sums it off the committed files rather than
 * trusting this table.
 *
 * ## ⚠️ Both kinds ranked together, and why not a count per kind
 *
 * #617 asked for "a near count and a middle count per tree kind". With a
 * dithered hand-over that cannot fall by 60 000: a band tree is SUBMITTED at
 * both levels, so a kind with one full tree has two full slots, and two kinds
 * are four — 103 992 triangles before a single middle tree, where the whole
 * tree budget after a 60 000 cut is 95 988. One ranking over both kinds has
 * one band, and fits. What it changes is which kind the nearest tree is: the
 * nearest tree of EITHER kind is full, where before the nearest three of
 * EACH were — so a conifer at 15 m behind a broadleaf at 10 m is middle now.
 *
 * ## ⚠️ The triangles freed are NOT spent, and that is a decision
 *
 * #617 asks whether any go back to {@link REALISTIC_STRUCTURE_ITEMS}, restoring
 * field boundaries #506 took. They do not in this change: the tablet row
 * (validation 0002's Part for #616, a 20-minute pair) has not been taken, and
 * #506 was the lesson that a frame figure raised on arithmetic alone is a
 * figure nobody measured. The frame's worst case now sits 65 350 under
 * {@link REALISTIC_FRAME_TRIANGLES}; spending them is the change after the row.
 */
export const REALISTIC_TREE_LEVELS: TreeLevels = {
  near: 1,
  middle: 4,
  dithered: true,
  // Ten frames a level: a sixth of a second at 60 frames a second, a third at
  // 30. Long enough that a rank jump is a fade rather than a pop, short enough
  // that a tree the rider closes on at 12 m/s is at its level within 2 to 4 m.
  handOverFrames: 10,
  rankOnly: 'visible',
};

/**
 * The most draw calls the wooded view may make: **35** — #639, the 33 it made
 * before #617 and the +2 #617 allowed its middle level.
 *
 * ## Where the calls went, and where they came back
 *
 * An instanced mesh is a call per level per variant per MATERIAL, and every
 * committed tree carries three. #617's middle level, drawn beside the full
 * meshes and the impostors, took #617's wooded view from 33 to 39 (PR #637,
 * against `86cfa5c`); on `main` at `553ce05` the same view made 37, and the
 * owner's page at `at=2550` (#616's counter) 39. Since #639 each tree level
 * is ONE material with its scan's materials as layers
 * (`three-renderer.ts` §`mergeShapeMaterials`), so a level of a variant is one
 * call whatever the scan was made of, and the frame's triangles and texture
 * memory are what they were.
 *
 * | Wooded view, pinned Chromium, 2026-09-28 | Before #639 (`553ce05`) | After |
 * |---|--:|--:|
 * | `game-harness.ts` §`treeLevelProbe`, 900 m of the valley route | 37 | **27** |
 * | The owner's page, `realistic.html?at=2550` (#616's counter) | 39 | **31** |
 * | The gate's wooded view, triangles submitted | 181 606 | 181 606 |
 * | The gate's wooded view, pixels that differ (640 × 360) | — | 0 |
 *
 * So the wooded view is 6 under #617's 33 + 2, and 2 under the 33 it made
 * before #617 at all.
 *
 * ⚠️ **A browser-gate figure, not a device measurement.** The call count does
 * not depend on the GPU, so SwiftShader counts what the tablet would; what the
 * calls COST there is validation 0002 Part AH's row, which is the owner's.
 *
 * @test-facing held by `game.browser.spec.ts` §"#639", which counts the wooded
 * view's calls at the WebGL entry points against it, with the same view drawn
 * with each tree's layers apart as the control that must exceed it; and by
 * `realistic.browser.spec.ts`, which holds the owner's page at `at=2550` to it
 */
export const REALISTIC_WOODED_DRAW_CALLS = 35;

/**
 * The trees as they were drawn before #617 — the nearest six as full meshes,
 * a hard swap to the impostor, no middle level and no band — ranked together,
 * as {@link REALISTIC_TREE_LEVELS} ranks them.
 *
 * @test-facing the browser gate's control: `game-harness.ts` draws the same
 * view with it, whose triangles must be at least 60 000 more, and whose
 * hand-over must jump; the product never draws with it
 */
export const HARD_SWAP_TREE_LEVELS: TreeLevels = {
  near: 6,
  middle: 0,
  dithered: false,
  handOverFrames: 1,
  rankOnly: 'visible',
};

/**
 * How many structures a realistic frame may carry: **36** — on both
 * `quality.ts` §`REALISTIC_LADDER` rungs, where the stylised rungs they are
 * copied from carry 240 and 120. #506, option 2 of the three it names.
 *
 * ## Where 36 comes from
 *
 * It is what is left of {@link REALISTIC_FRAME_TRIANGLES} once every other
 * worst case is in, divided by a structure's own ceiling:
 *
 * | Part of the worst frame | Triangles |
 * |---|--:|
 * | Vegetation, every near slot its heaviest file | 232 692 |
 * | Three riders, the body's file and the bicycle as built (8 998 + 5 308) | 42 918 |
 * | Left for the structures | 24 390 |
 * | ÷ {@link REALISTIC_TRIANGLES}' `structure`, 640 | 38.1 |
 *
 * and 36 rather than 38, so the frame holds with 1 350 triangles to spare at
 * the ceiling — 3 510 at today's heaviest structure, a church at 580. Chosen,
 * not measured on a device, like every figure here.
 *
 * ⚠️ **Since #617 the vegetation line is 168 692**, not 232 692: the trees
 * have a middle level ({@link REALISTIC_TREE_LEVELS}) — two full trees at
 * 28 000 and six middle ones at the committed files' heaviest, 5 998 — with
 * the shrubs and rocks unchanged (47 904 + 28 800). The worst frame is 234 650
 * with every structure at its ceiling, 65 350 under the figure — the table
 * above is how 36 was reached and is kept as that record. The 36 did NOT move
 * with it: {@link REALISTIC_TREE_LEVELS} says why the freed triangles wait for
 * the tablet row.
 *
 * ## Why this option, and what it costs
 *
 * - **Option 1**, detail by distance — the nearest buildings detailed and a
 *   plain block beyond — **does not fit on its own**: the plainest shape
 *   `buildings.ts` builds is up to 98 triangles (a barn with no openings) and
 *   a fence is 84, so 240 structures with no detail at all are about 23 500,
 *   which is the whole of the room, and one detailed building fits beside
 *   them. It would also add a mesh per surface per plain shape, where #506
 *   asked for fewer.
 * - **Option 3**, raising the frame's figure, needs the post-#500 frame's
 *   WORST case measured on the tablet first. Validation 0002 Part AA's AA3
 *   measured one view beside a farmstead, which says nothing about a village
 *   at 240 structures, and its own row says so.
 * - **So this.** It is one number on two rungs, it moves no mesh, and it
 *   takes the far field boundaries rather than the houses:
 *   `settlements.ts` §`structuresAt` lists every building and signpost before
 *   any wall, hedge or fence, and a village is at most 22 buildings and two
 *   signposts. What a rider in the realistic world loses is the walls a field
 *   or two up the road; the stylised world keeps its 240.
 *
 * ⚠️ **The riders' bicycle is counted as built, not at its ceiling**, and that
 * moved with this: the frame sum read {@link REALISTIC_BICYCLE_TRIANGLES}'
 * 12 000 where every other term was the committed or built asset, which
 * overstated three bicycles by 20 076. The ceiling still holds the bicycle
 * (`realistic-renderer.test.ts`); the frame counts what is drawn, so a bicycle
 * grown towards its ceiling is a red frame test rather than a frame nobody
 * summed.
 */
export const REALISTIC_STRUCTURE_ITEMS = 36;

/**
 * How many ground blobs a realistic frame may draw — #620: **62**, one under
 * every item the realistic world draws as a MESH and every structure it may
 * carry. `three-renderer.ts` §`GroundBlobBelt` is built with exactly this
 * capacity.
 *
 * | Casters | Blobs |
 * |---|--:|
 * | Trees at the full or middle level ({@link REALISTIC_TREE_LEVELS}: 1 full, 4 middle, the full-to-middle band) | 6 |
 * | Shrubs and rocks drawn as meshes ({@link REALISTIC_NEAR_MESHES}) | 8 + 12 |
 * | Structures ({@link REALISTIC_STRUCTURE_ITEMS}) | 36 |
 *
 * ⚠️ **A tree in the middle-to-impostor band, or drawn as its impostor, has
 * none**: an impostor is 40 m and more away, where a blob is a few pixels the
 * fog is already taking, and #620's ceiling of 124 triangles is these 62 at
 * two each.
 *
 * ⚠️ **They are counted in the frame's triangles**:
 * `realistic-budget.test.ts` adds `REALISTIC_GROUND_BLOBS × 2` to the worst
 * frame, which the structures had left 1 350 triangles of room under
 * {@link REALISTIC_FRAME_TRIANGLES} — 124 of it spent, 1 226 left.
 */
export const REALISTIC_GROUND_BLOBS =
  REALISTIC_TREE_LEVELS.near +
  REALISTIC_TREE_LEVELS.middle +
  (REALISTIC_TREE_LEVELS.dithered ? 1 : 0) +
  REALISTIC_NEAR_MESHES.shrub +
  REALISTIC_NEAR_MESHES.rock +
  REALISTIC_STRUCTURE_ITEMS;

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
 * Part AA step AA3, run on 2026-09-23 with buildings in frame: **35 draw
 * calls** for the whole frame and **GPU 5 / 8 / 12 ms** at p50 / p90 / p99 —
 * Part Z's own p90 before #500 added a mesh. That is what #506 asked this
 * figure to be justified against, and it is why the figure is kept rather
 * than reduced — **for a farmstead**, which is what that view held and which
 * spends 7 of these meshes. A village spends up to 16 and was not in it;
 * validation 0002 Part AE is the row that takes one. #506's cut to the
 * structures' COUNT ({@link REALISTIC_STRUCTURE_ITEMS}) can only lower the
 * calls a frame spends, never raise them.
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
 * How many OTHER real riders in a room wear the realistic body — #783: **2**,
 * the nearest two. `three-renderer.ts` §`realisticRemoteSplit` is the rule.
 *
 * ⚠️ **Small on purpose, and this is not #681.** #681 (a pack of ~10 computer
 * riders with a rider level of detail) is blocked on the tablet showing room
 * for it; two remote bodies are 28 612 triangles (a body at 8 998 and a
 * bicycle at 5 308, twice), which the worst frame below has room for with the
 * stylised riders beside them, and nothing more is spent until the tablet has
 * measured a room.
 */
export const REALISTIC_REMOTE_RIDERS = 2;

/**
 * How many more remote riders a realistic frame draws, with the STYLISED
 * rider (1 208 triangles each) — #783: **24**. Beyond those, a realistic frame
 * draws no more remote riders; the stylised world draws the room's whole K.
 *
 * | Part of the worst frame | Triangles |
 * |---|--:|
 * | The worst frame #617 left, every structure at its ceiling (§`REALISTIC_STRUCTURE_ITEMS`) | 234 650 |
 * | The gantries and the ground blobs at their ceilings | 1 124 |
 * | Two realistic remote riders, 2 × (8 998 + 5 308) | 28 612 |
 * | Left under {@link REALISTIC_FRAME_TRIANGLES} | 35 614 |
 * | ÷ the stylised rider's 1 208 | 29.5 |
 *
 * and 24 rather than 29, so the frame holds with about 6 600 triangles to
 * spare. `realistic-budget.test.ts` §"#783" re-adds it from the committed
 * files; the browser gate counts it with #616's counter.
 */
export const REALISTIC_REMOTE_STYLISED_RIDERS = 24;

/**
 * The most triangles a realistic frame may submit: **300 000**, about 1.2 times
 * the all-on 252 024 #457 drew on the tablet. What it is held against is the
 * worst case the caps above allow — every near slot filled with the heaviest
 * shape of its kind, three riders, and since #506
 * {@link REALISTIC_STRUCTURE_ITEMS} structures each its heaviest shape —
 * rather than any frame in particular. The corridor, the terrain and the water
 * sit under it on both worlds and are not counted here, because they do not
 * change with the world.
 *
 * ⚠️ **Until #506 the structures were left out too**, on the argument
 * {@link REALISTIC_TRIANGLES}' `structure` note now retracts, and the worst
 * frame since #500 was about 450 000.
 *
 * @test-facing held by `realistic-budget.test.ts`, which reads every committed
 * realistic file back off disk against it; the renderer spends it only on the
 * realistic path, which a ride takes only for a rider who chose it (#475)
 */
export const REALISTIC_FRAME_TRIANGLES = 300_000;

/**
 * The most triangles the start and finish gantries may add to a frame:
 * **1 000** — #679's ceiling, against the 1 350 its research found spare in the
 * worst frame before #617 freed more. Spent only within
 * `gantry.ts` §`LINE_DRAW_AHEAD_METRES` of a line, and nothing anywhere else.
 * The worst a frame carries is two gantries and a board — a point-to-point
 * route shorter than the reach, whose start and finish are both in view —
 * which `realistic-budget.test.ts` counts from `gantry.ts`' own boxes: 858.
 *
 * @test-facing held by `realistic-budget.test.ts`, and by
 * `game.browser.spec.ts` §"#679", which counts what a gantry submits at the
 * WebGL entry points
 */
export const REALISTIC_GANTRY_TRIANGLES = 1_000;

/**
 * The most GPU texture memory the realistic set may hold, estimated: **160 MiB**,
 * under half the 355 MiB all-on estimate #457 drew on the tablet.
 *
 * ⚠️ **An estimate, and labelled one** — the same estimate #457 published:
 * width × height × bytes a texel, a third again for mipmaps, the HDR at
 * half-float. A driver may pad, compress or evict; nothing in a browser reports
 * what it actually did. {@link estimatedTextureBytes} is the arithmetic.
 *
 * ## ⚠️ Since #618 the estimate assumes the TABLET'S COMPRESSED FORMATS
 *
 * Every realistic texture but the sky is KTX2 since #618 (ADR 0026 D-8's
 * 2026-09-27 amendment), and the estimate prices each as the owner's Pixel
 * Tablet is handed it — {@link DEVICE_BYTES_PER_TEXEL}: a Basis ETC1S colour
 * map as **ETC2 RGB, half a byte a texel**, one with alpha as **ETC2 RGBA, a
 * byte**, and a UASTC normal map as **ASTC 4×4, a byte**; the HDR sky still at
 * half-float, eight bytes, with its prefiltered environment. A reviewer who
 * remembers every texture at four bytes — RGBA8, which three decoded every
 * JPEG and PNG to — is reading the old file: that estimate was **136 MiB** for
 * the same set and `realistic-budget.test.ts` still computes it, as the
 * "before" the compressed one is held under. A device with neither ASTC nor
 * ETC (a desktop, say) is handed BC7, a byte a texel, or at worst RGBA8; this
 * figure is the tablet's, because the tablet is the device the budget is for.
 *
 * The 160 MiB ceiling itself did not move: #618 lowers what the set asks for,
 * and the ceiling on what it may ask for is a D-6 decision this change does
 * not take.
 *
 * @test-facing held by `realistic-budget.test.ts`, which reads every committed
 * realistic file back off disk against it; the renderer spends it only on the
 * realistic path, which a ride takes only for a rider who chose it (#475)
 */
export const REALISTIC_TEXTURE_MEMORY_BYTES = 160 * MEBIBYTE;

/**
 * What the owner's tablet is handed per texel, by Basis Universal encoding —
 * #618: what three's `KTX2Loader` transcodes each to where the device offers
 * both ASTC and ETC, which the Pixel Tablet's Mali-G710 does.
 *
 * - `etc1s` — ETC1S colour, transcoded to **ETC2 RGB**: 8 bytes a 4×4 block;
 * - `etc1s-alpha` — ETC1S with alpha, to **ETC2 RGBA** (EAC alpha): 16 bytes a block;
 * - `uastc` — UASTC, to **ASTC 4×4**: 16 bytes a block. (`KTX2Loader` sends
 *   ETC1S to ETC2 rather than ASTC where it has both, by its own priority
 *   table: ETC2 is half the memory and ETC1S is ETC1 underneath.)
 *
 * @test-facing held by `realistic-budget.test.ts`, which prices every
 * committed KTX2 file with it, and by `realistic-textures.test.ts`' reading of
 * what the real loader hands a device that offers ASTC and ETC
 */
export const DEVICE_BYTES_PER_TEXEL = {
  etc1s: 0.5,
  'etc1s-alpha': 1,
  uastc: 1,
} as const;

/**
 * What the realistic bicycle's surfaces may add — #624's own ceiling, inside
 * {@link REALISTIC_TEXTURE_MEMORY_BYTES} and {@link REALISTIC_BUILD_BYTES}:
 * **2 MiB** of texture memory as the tablet is handed it, and **0.5 MiB** of
 * build. What the four maps spend is 283 989 bytes estimated — three 256²
 * UASTC maps at a byte a texel and a 128² one, each a third again for its
 * mipmaps — and about 35 KB of KTX2 in the build; `realistic-budget.test.ts`
 * reads both off the committed files and prints them.
 *
 * ⚠️ **No triangles and no draw calls**: the maps go on the three meshes the
 * bicycle already was, so the frame's triangle sum and #506's 1 350 spare are
 * unchanged.
 *
 * @test-facing held by `realistic-budget.test.ts`, which reads the committed
 * bicycle maps back off disk against it; the renderer spends it only on the
 * realistic path
 */
export const REALISTIC_BICYCLE_SURFACES = {
  textureBytes: 2 * MEBIBYTE,
  buildBytes: MEBIBYTE / 2,
} as const;

/**
 * What dressing the realistic rider may add — #623's own ceiling, inside
 * {@link REALISTIC_TEXTURE_MEMORY_BYTES} and {@link REALISTIC_BUILD_BYTES}:
 * **6 MiB** of texture memory as the tablet is handed it, and **1 MiB** of
 * build over what the rider was before (`buildBefore`, the undressed
 * `rider.glb`). What the three maps spend is 3.3 MiB estimated — a 1024²
 * ETC1S colour map at half a byte a texel and two 1024² UASTC maps at a byte,
 * each a third again for its mipmaps — and the build FALLS: the body is
 * smooth-shaded since #623, which stopped every vertex being split three ways,
 * and that saves more than the three maps cost. `realistic-budget.test.ts`
 * reads both off the committed files and prints them.
 *
 * ⚠️ **No triangles and no draw calls**: the helmet and glasses are paid for
 * inside {@link REALISTIC_TRIANGLES}' `rider`, which the body is decimated to
 * make room for, and they are the one instanced mesh the sphere cap was.
 *
 * @test-facing held by `realistic-budget.test.ts`, which reads the committed
 * rider files back off disk against it; the renderer spends it only on the
 * realistic path
 */
export const REALISTIC_RIDER_SURFACES = {
  textureBytes: 6 * MEBIBYTE,
  buildBytes: MEBIBYTE,
  /** The undressed `rider.glb`, bytes, as #623 found it. */
  buildBefore: 1_789_800,
} as const;

/**
 * What the realistic riders' bike-shaped shadow may hold on the GPU — #626's
 * own ceiling, inside {@link REALISTIC_TEXTURE_MEMORY_BYTES}: **128 KiB**, one
 * texture. The silhouette spends 64 KiB — 256 × 128 texels, two bytes each,
 * no mipmaps (`rider-silhouette.ts` §`SILHOUETTE_TEXTURE_BYTES`) — and adds no
 * build byte: it is made from the rider when a view builds its realistic
 * world, never committed.
 *
 * ⚠️ **No triangles in the frame and no draw call**: two triangles a rider in
 * the one instanced draw the round blob was, which the realistic world no
 * longer draws.
 *
 * @test-facing held by `rider-silhouette.test.ts` and
 * `realistic-budget.test.ts`; the renderer spends it only on the realistic path
 */
export const REALISTIC_RIDER_SILHOUETTE_BYTES = 128 * 1024;

/**
 * The most bytes the realistic set may add to the build — and so to the APK,
 * where `capacitor.config.ts` copies all of `dist` (ADR 0026 D-7): **40 MiB**.
 *
 * Nobody measured what an APK this size costs a rider to install; the figure is
 * a ceiling on growth rather than a target, and the pull request that lands the
 * set states the number it actually adds.
 *
 * ⚠️ **Since #618 it counts the transcoder too** — `basis_transcoder.js` and
 * `.wasm`, 584 862 bytes, copied into `dist/realistic/basis/` out of `three` by
 * `tools/basis/transcoder-plugin.ts` — because they are in the build only for
 * the realistic world. `realistic-budget.test.ts` adds them.
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
  /**
   * 8 for half-float RGBA, which is what three makes of an HDR; 4 for 8-bit
   * RGBA; since #618 a compressed format's own, {@link DEVICE_BYTES_PER_TEXEL}.
   */
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
