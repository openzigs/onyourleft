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
 * - `town` 1024 — #1548: a mapped town's render, concrete and flat roof
 *   (`realistic-assets.ts` §`TOWN_STRUCTURE_SURFACES`), colour and normal,
 *   at the 1K ambientCG publishes them. The owner ruled on #1548 to keep them
 *   at 1K and raise {@link REALISTIC_BUILD_BYTES} rather than take them to
 *   `structure`'s 512. A town's wall fills more of the screen than a
 *   farmstead's, for longer, and is seen from the road at a few metres.
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
  town: 1024,
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
 * ## The generated trees, measured — #1283
 *
 * Since #1283 a ride's broadleaf trees are GENERATED to their size (ADR 0049
 * D-1) rather than scans cut down to these ceilings: 6 692 and 5 800
 * triangles at full detail against 28 000, and 2 208 and 2 004 at the middle
 * level against 6 000. **No ceiling here moved**: what is spent fell, and the
 * scans — still committed, still loadable on the owner's page — are held to
 * the same figures. Same route position, same camera, pinned Chromium on
 * 2026-10-12, the scans first:
 *
 * | | Scanned broadleaves | Generated broadleaves |
 * |---|--:|--:|
 * | The gate's wooded view (`game-harness.ts` §`treeLevelRun`, 900 m of the valley route), triangles a frame | 181 232 | **169 482** |
 * | The same view, draw calls | 27 | **29** |
 * | The owner's page held at `at=2550`, triangles a frame | 199 676 | **195 692** |
 * | The same page, draw calls | 31, and 32 in one run of seven | **33** in seven runs of seven |
 * | The same page, bytes of texture the load holds | 31 393 488 | **26 173 344** |
 * | Texture memory estimated on the tablet's formats, the whole set | 70.56 MiB | **65.58 MiB** |
 * | The worst vegetation the caps allow, triangles | 168 692 | **160 684** |
 * | A broadleaf wood's tree slots, every one filled | 91 940 | **26 632** |
 *
 * ⚠️ **The draw calls ROSE by two, and that is why there are two seeds a
 * species and not three.** A tree is a call a level a shape, and there are
 * four generated shapes where there were two scans. Both views are inside
 * {@link REALISTIC_WOODED_DRAW_CALLS} — which was not raised — with 6 and 2
 * to spare. As first written #1283 made SIX shapes, three seeds a species:
 * the gate's view then made 32 calls and the owner's page 35 in every run on
 * a Mac and 34 on the CI runner (38256459141) — the ceiling itself, on a
 * frame whose count is known to move by one between runs — so a seed of each
 * species was taken out again (#1289's review;
 * `tools/realistic/generated-trees.ts` §`GENERATED_TREES` says which, and
 * how they were chosen). The triangles did not move with the seeds: every
 * tree of a species is the same count. What the calls cost the tablet is
 * validation 0002's #1283 row, which is the owner's.
 *
 * ⚠️ **The ceiling is held at the two views the gate names, not by
 * construction, and it was not before #1283 either.** Elsewhere on the
 * owner's route a frame is over it with both sets: held at `at=700` the page
 * made 37 to 39 calls with the scans and 40 to 42 with the generated trees,
 * four runs each on 2026-10-12, and the count moved between runs of the one
 * held frame while its triangles did not. Why it moves was not looked for.
 *
 * ⚠️ **The build GREW, because both sets ship**: the realistic set is
 * 39 252 137 bytes where it was 36 440 765 — 2 811 372 for four trees at three
 * levels — and with the transcoder 39 836 999 of {@link REALISTIC_BUILD_BYTES}'
 * 41 943 040, 2 106 041 under it. The scanned broadleaves are
 * 10 616 301 of those bytes and go when the owner has judged the generated
 * ones on the tablet (ADR 0049 D-1, #1293), at which point the set is smaller
 * than it was before #1283.
 *
 * ## The generated firs, measured — #1294
 *
 * Since #1294 a ride's conifers are generated too: two firs, the pinned
 * generator's evergreen, each bough carrying cards of Poly Haven's
 * photographed fir sprigs — **4 792** triangles at full detail against the
 * scanned fir's 23 996, and **878** at the middle level against 5 998. **No
 * ceiling here moved.** Same route positions, same camera, pinned Chromium
 * on a Mac on 2026-10-12; the middle column is the world #1283 left:
 *
 * | | Every tree a scan | Generated broadleaves, scanned firs | Every tree generated |
 * |---|--:|--:|--:|
 * | The gate's wooded view, triangles a frame | 181 232 | 169 482 | **115 718** |
 * | The same view, draw calls | 27 | 29 | **29** |
 * | The owner's page held at `at=2550`, triangles a frame | 199 676 | 195 692 | **131 684** |
 * | The same frame, draw calls | 29 | 31 | **31** |
 * | The owner's page held at `at=700`, triangles a frame | 207 587 | 161 227 | **135 627** |
 * | The same frame, draw calls | 35 | 38 | **38** |
 * | The page, bytes of texture the load holds | 31 393 488 | 26 173 344 | **19 838 224** |
 * | Texture memory estimated on the tablet's formats, the whole set | 70.56 MiB | 65.58 MiB | **59.54 MiB** |
 * | The worst vegetation the caps allow, triangles | 168 692 | 160 684 | **103 336** |
 * | A conifer wood's tree slots, every one filled | 83 980 | 83 980 | **14 852** |
 *
 * ⚠️ **The draw calls in this table are one frame's, and the 33 and the 31
 * of the table above are the same frame.** The owner's page reports a mean
 * over its window, and until #1294 that window also held the warm-up and the
 * page's very first render, which makes about twice the calls of every later
 * frame — 60 and then 31 at `at=2550`, read frame by frame — so the page said
 * 33 where the frame made 31, and 32 to 35 as a busier machine fit fewer
 * frames into its four seconds
 * (`browser/realistic-harness.ts` §`RealisticSample.drawCalls`). The page now
 * counts from the end of the warm-up and reports each of this table's figures
 * as its own: 29, 31 and 31 at `at=2550`, 35, 38 and 38 at `at=700`. That is why
 * #1283's count "moved between runs of the one held frame while its triangles
 * did not". The frame's own count did not move in any run, and it is the same
 * with the generated firs as with the scanned ones at each of the seven
 * positions looked at: two shapes stand where two stood. Held at `at=700` the
 * frame is over {@link REALISTIC_WOODED_DRAW_CALLS} with every set, by three
 * with both of the last two, as it was before #1294.
 *
 * ⚠️ **What this does not measure is the cut-out.** A fir is drawn as 1 100
 * sprig cards of about 0.42 m, under a quarter of each covered by needles:
 * 196 m² of card to a tree, where a generated oak's leaf cards are 104 m²,
 * and every fragment of a card is run as far as the cut before it is
 * discarded. The middle level keeps one card in three, enlarged, for 129 m²
 * against the oak's 99. The triangles fell by a third on the owner's page;
 * whether the frame got cheaper on a tablet's GPU is not something a
 * triangle count says. In the software rasteriser the held frame at
 * `at=2550` was drawn 54 to 62 times in four seconds with the scanned firs
 * and 54 to 57 with the generated ones, on a machine busy with other work:
 * runs of one set differed by as much as the two sets did, so nothing was
 * learnt there either. Validation 0002's #1294 rows are the measurement, and
 * they are the owner's.
 *
 * ⚠️ **The build grew again, because every set ships**: the generated firs
 * are 1 307 982 bytes, and the realistic set with the transcoder is
 * 41 144 981 of {@link REALISTIC_BUILD_BYTES}' 41 943 040 — **798 059 under
 * it**, where it was 2 106 041 under. The scanned firs are 8 681 763 of those
 * bytes and the scanned broadleaves 10 616 301; which go is the owner's to
 * say after the tablet rows (ADR 0049 D-1, #1293).
 *
 * Held by `realistic-budget.test.ts`, which reads every committed realistic
 * file back off disk against it. Since #1549 the renderer reads its
 * `structure` figure too, to share the structure term between the procedural
 * structures and the mapped buildings (`three-renderer.ts`
 * §`RealisticDrawing.updateMapped`), and since #1550 `footprint-buildings.ts`
 * §`FOOTPRINT_MAX_TRIANGLES` reads it, which a ride with a corridor plans to.
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
 * ⚠️ **Since #1283 some of that room is spent**, and a reviewer who remembers
 * 27 and 31 is reading the scans' figures: with the four generated
 * broadleaves the gate's wooded view makes **29** calls and the owner's page
 * at `at=2550` **33** — 6 and 2 under this ceiling — because a tree is a call
 * a level a SHAPE and there are four shapes where there were two.
 * {@link REALISTIC_TRIANGLES} has the table, and says why it is four shapes
 * and not the six #1283 first made, which put the page AT 35. The scans,
 * loaded on the same views, still make 27 and 31 (32 in one run of seven:
 * the page's count moves by one between runs of the same held frame).
 *
 * ⚠️ **#1294 found what moves, and the page's 33 and 31 were a mean, not a
 * frame's count**: the page counted its very first render, which makes about
 * twice the calls of every later frame, so the held frame at `at=2550` makes
 * 31 with the generated broadleaves and 29 with the scans, and the page
 * added one to three to each by how few frames it drew before its sample.
 * It now counts from the end of its warm-up and says 31 and 29 itself. The
 * generated firs add no call to either view. {@link REALISTIC_TRIANGLES},
 * "The generated firs, measured".
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
 * The triangles the realistic structures may spend in a frame, procedural and
 * mapped together — #1549, #1538's P-12: **23 040**,
 * {@link REALISTIC_STRUCTURE_ITEMS} at {@link REALISTIC_TRIANGLES}' `structure`.
 * It is the structure term `realistic-budget.test.ts` has summed since #506,
 * and it is NOT raised for mapped buildings: they take what the procedural
 * structures in the frame leave of it, nearest first
 * (`three-renderer.ts` §`MappedBuildingBelt`). It is also the capacity, in
 * triangles, of the one buffer the belt preallocates, so no plan list,
 * however long, can grow it.
 *
 * ⚠️ **Mapped buildings carry no ground blob** (#620): a blob is an instance
 * under an instance, and a merged town has none. Whether a merged town wants
 * contact darkening is a by-eye call at #1553, and no follow-up is filed.
 * {@link REALISTIC_GROUND_BLOBS} is unchanged by them.
 */
export const MAPPED_BUILDING_TRIANGLES = REALISTIC_STRUCTURE_ITEMS * REALISTIC_TRIANGLES.structure;

/**
 * The most mapped buildings the realistic world draws at once — #1549:
 * **36**, ADR 0054 D-5.6's cap, {@link REALISTIC_STRUCTURE_ITEMS}' figure:
 * the nearest 36 footprints, and no more until #1523's fix and a measured
 * number raise it (owner ruling, 2026-10-22, on #1549's pull request). Most
 * are boxes of a few dozen triangles, so 36 of them fit well inside
 * {@link MAPPED_BUILDING_TRIANGLES}, and this count is the cap that bites
 * first. Written as the number, not as {@link REALISTIC_STRUCTURE_ITEMS}, so
 * that raising the procedural structures' count does not raise this one.
 *
 * ⚠️ **It was 240 in #1549's first draft**, read from the stylised world's
 * `scatter.ts` §`STRUCTURE_MAX_ITEMS`; the owner did not approve that reading
 * of D-5.6. A reviewer who remembers 240 is reading that draft.
 */
export const MAPPED_BUILDING_MAX = 36;

/**
 * Nearer than this a mapped building is drawn whole; further, at its far
 * level, its walls and roof only — #1549: **150 m**.
 */
export const MAPPED_BUILDING_NEAR_METRES = 150;

/**
 * How far from the rider a mapped building is drawn at all — #1549: **400 m**,
 * `terrain.ts` §`VIEW_AHEAD_METRES`, the road's own reach.
 */
export const MAPPED_BUILDING_REACH_METRES = 400;

/**
 * How far along the route the rider rides between two refills of the mapped
 * buildings — #1549: **100 m**, about ten seconds at 36 km/h. The set is
 * rebuilt only when the rider's chunk changes, never per frame.
 */
export const MAPPED_CHUNK_METRES = 100;

/**
 * The most draw calls the mapped buildings may spend — #1549: **6**, whatever
 * their count. The belt is one mesh with at most this many groups, one a
 * surface; a building whose surfaces would open a seventh waits for a refill
 * nearer it (`mapped-buildings.ts` §`selectMappedBuildings`).
 */
export const MAPPED_BUILDING_DRAW_CALLS = 6;

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
 * What a room's remote riders may add to a realistic frame, in triangles —
 * #783: **64 226**, all that the worst frame above leaves under
 * {@link REALISTIC_FRAME_TRIANGLES} (the first two rows of
 * {@link REALISTIC_REMOTE_STYLISED_RIDERS}' table). The rule spends 57 604 of
 * it at most; the browser gate counts what a frame with a full room actually
 * added with #616's counter and holds it here, and its control — every remote
 * rider drawn — must not fit.
 *
 * @test-facing held by `realistic-budget.test.ts` §"#783" and
 * `game.browser.spec.ts` §"#783"
 */
export const REALISTIC_REMOTE_TRIANGLES = 64_226;

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
 * The most triangles a frame's village streets may add — #1535's pavements
 * and #1536's street furniture: **23 104**, in either world.
 *
 * | | triangles |
 * |---|--:|
 * | Pavements: two villages in view at most, each at `streets.ts` §`PAVEMENT_TRIANGLES_PER_VILLAGE` | 2 × 1 184 = 2 368 |
 * | Furniture: `three-renderer.ts` §`FURNITURE_CAPACITY` of each kind, each at its shape's triangles (lamp post 88, bollard 64, bench 108, bin 64) | 64 × 324 = 20 736 |
 *
 * The furniture's row is the CAPACITY, a hard bound the belt cannot pass; a
 * village at its fullest has 16 lamp posts, 8 bollards, 2 benches and 2 bins
 * (2 264), and only what is within `streets.ts` §`FURNITURE_DRAW_METRES` of
 * the camera is drawn at all.
 *
 * ⚠️ **Outside {@link REALISTIC_FRAME_TRIANGLES}, by that constant's own
 * rule**: a street is the SAME triangles in both worlds, as the corridor, the
 * terrain and the water are, so it does not change with the world. It adds
 * no texture: the pavement's 512 px paving pair (0.5 MiB estimated) is
 * #1535's, counted with the rest of the set, and the bench wears `planks`,
 * already loaded for the barns.
 *
 * @test-facing held by `realistic-renderer.test.ts` §"the street furniture",
 * which counts the belt's own meshes
 */
export const REALISTIC_STREET_TRIANGLES = 23_104;

/**
 * The most triangles the start and finish gantries may add to a frame:
 * **1 000** — #679's ceiling, against the 1 350 its research found spare in the
 * worst frame before #617 freed more. Spent only within
 * `gantry.ts` §`LINE_DRAW_AHEAD_METRES` of a line, and nothing anywhere else.
 * The worst a frame carries is two gantries and a board — a point-to-point
 * route shorter than the reach, whose start and finish are both in view —
 * which `realistic-budget.test.ts` counts from `gantry.ts`' own boxes: 858;
 * and since #966 the wordmark's board on the start gate, 36 triangles
 * (`logo-board.ts`' three boxes), counted twice for a loop shorter than the
 * reach: **930**, still inside the 1 000. ⚠️ **#978 put a board on the finish
 * gate too, and 930 did NOT move**: the frame above — both gates of a short
 * point-to-point route — now holds two boards, the start's and the finish's,
 * which is exactly the two the sum already priced. A billboard's board spends
 * a STRUCTURE's slot (`scene.ts`), not this ceiling.
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
 * What a mapped town's three surfaces may add — #1548's own ceiling, inside
 * {@link REALISTIC_TEXTURE_MEMORY_BYTES} and {@link REALISTIC_BUILD_BYTES}:
 * **5 MiB** of texture memory as the tablet is handed it, and **3.5 MiB** of
 * build. What the six maps spend is exactly 5 MiB estimated — ETC1S colour
 * maps at half a byte a texel and UASTC normal maps at a byte, each a third
 * again for its mipmaps, two pairs at 1024² and the plaster's at 1024 × 512 —
 * and 3 587 223 bytes of KTX2 in the build; `realistic-budget.test.ts` reads
 * both off the committed files and prints them.
 *
 * ⚠️ **More texture memory than #1548 budgeted, and that is the owner's
 * ruling's consequence, not an overrun.** #1548's table asked for at most
 * +3 MiB, written for its recommended answer — 512² maps, and no normal map
 * on the flat roof. The owner ruled on #1548 (2026-10-21) to raise the build
 * ceiling rather than shrink them to 512², so they are 1K with normals, and
 * the set's estimate stays far inside the 160 MiB ceiling.
 *
 * ⚠️ **No triangles and no draw calls today**: nothing procedural wears them
 * (`realistic-assets.ts` §`TOWN_STRUCTURE_SURFACES`), so each is a belt with
 * no mesh in it; the mapped buildings that will wear them (#1549) spend
 * their own calls.
 *
 * @test-facing held by `realistic-budget.test.ts`, which reads the committed
 * town maps back off disk against it; the renderer spends it only on the
 * realistic path
 */
export const REALISTIC_TOWN_SURFACES = {
  textureBytes: 5 * MEBIBYTE,
  buildBytes: 3.5 * MEBIBYTE,
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
 * ## Raised to 43 MiB for the mapped towns — #1548
 *
 * **Old ceiling 40 MiB (41 943 040 bytes), new 43 MiB (45 088 768).** The
 * owner ruled on #1548 (2026-10-21) to raise it for the render, concrete and
 * flat-roof materials rather than shrink them to 512². Measured on the
 * committed files: the realistic set with its transcoder was 41 144 981
 * bytes, 798 059 under the old ceiling; the six maps add **3 587 223**
 * ({@link REALISTIC_TOWN_SURFACES}), so it is **44 732 204**, 356 564 under
 * the new one. 43 MiB is the smallest whole figure the set fits under, so the
 * next addition is again a decision rather than a margin.
 *
 * What that does to a download: the **APK** carries the same 3 587 223 bytes
 * more, since every file in `dist` ships in it (ADR 0026 D-7). The KTX2
 * payloads are BasisLZ and Zstandard already, so the APK's own zip is not
 * expected to win much back — expected, not measured: no APK was built for
 * #1548. A **browser's first download** of
 * the app does not move: the realistic files are outside the service worker's
 * precache by their location (`realistic-assets.ts` §`REALISTIC_DIRECTORY`),
 * and are fetched only when a rider picks the realistic world, which then
 * fetches the 3.4 MiB more.
 *
 * @test-facing held by `realistic-budget.test.ts`, which reads every committed
 * realistic file back off disk against it; the renderer spends it only on the
 * realistic path, which a ride takes only for a rider who chose it (#475)
 */
export const REALISTIC_BUILD_BYTES = 43 * MEBIBYTE;

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
