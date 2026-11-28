// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which files each scenery kind's shapes come from, and what a model is
 * allowed to reach for — #341, #366, #367.
 *
 * ## Why this is a file of its own rather than a table in the renderer
 *
 * `three-renderer.ts` is the one file in this repository that may name `three`
 * (§4h, `three-seam.test.ts`), which makes it the one file jsdom cannot drive:
 * a `WebGLRenderer` cannot be constructed there at all. Everything below is a
 * table of strings and one pure function, and both are things that can go wrong
 * in ways a reviewer would not see — so they live where the fast suite can read
 * them.
 *
 * ## The five kinds, and the sixth that is deliberately absent
 *
 * [ADR 0022](../../../../docs/adr/0022-game-scenery-model-pack.md) D-3 replaces **five**
 * of `scatter.ts`'s six kinds and leaves `post` as a five-sided cylinder, in
 * its own words: *"A shape with no silhouette to buy is not worth buying."* A
 * marker post is 1.1 m tall and 14 cm across, and at the distances fog leaves
 * visible a model of one and a cylinder are the same handful of pixels. So
 * {@link SCENERY_MODELS} is a `Partial` record on purpose, and
 * `scenery-models.test.ts` asserts which key is missing rather than letting an
 * omission look like an oversight.
 *
 * ⚠️ **And the set stays at six.** A pack of forty thousand assets being
 * available is not a reason to place a seventh kind — that is a `scatter.ts`
 * change with its own placement question, and ADR 0022 D-3 says it arrives as
 * its own issue.
 *
 * ## ⚠️ Each kind now has SEVERAL shapes, and that is #367
 *
 * A reviewer who remembers this file mapping one `.glb` to each kind is reading
 * the old one. Every building in the world used to be the same building, and so
 * was every tree; each kind carries a **list** now, and which entry an item
 * gets is a function of where it stands — `scatter.ts` §`ScatterItem.variant`,
 * drawn from the same seeded hash that already decided the kind, so a rider
 * riding the same road twice sees the same village.
 *
 * ⚠️ **{@link MAXIMUM_SCENERY_VARIANTS} is the budget, and it is the whole
 * decision.** A variant is a distinct merged geometry and therefore a distinct
 * `InstancedMesh`, and an `InstancedMesh` is a draw call — #240's NFR-2, the
 * budget `three-renderer.ts` calls *"the one thing a model is most likely to
 * spend without anybody noticing"*. So the number of variants a kind may have
 * is capped in source and asserted, rather than being however many files
 * somebody felt like adding.
 *
 * ⚠️ **Since #3287 a shape is no longer a mesh, and the budget is unmoved.**
 * Each mesh {@link SCENERY_MODELS} gives a kind is drawn with more shapes than
 * its model: {@link STYLISED_FOLD_MODELS} puts a City Kit (Suburban) house
 * and a City Kit (Commercial) building beside each building, and Nature Kit
 * trees and stones beside each of those, in the mesh's ONE draw call
 * (`three-renderer.ts` §`ScatterBelt`, a `BatchedMesh`). So a kind has more
 * shapes and exactly the meshes, and the draw calls, it had, and an item
 * submits the triangles of the one shape it is; `stylised-shapes.ts`
 * §`STYLISED_SHAPE_TRIANGLES` holds the heaviest a kind may be.
 * `SCENERY_MODELS` is still the mesh count.
 *
 * ## Provenance
 *
 * Every file is the **upstream artefact, byte for byte**: extracted from the
 * archive Kenney publishes and committed unconverted, which is D-1(a)'s whole
 * argument for choosing a source that ships glTF. `ASSETS.toml` carries the
 * pack, the URL, the licence, the date they were read and a SHA-256 of each,
 * and `scripts/check-repo-rules.sh` §`ASSET001`–`ASSET005` is what makes those
 * rows more than a promise. ⚠️ Nothing here is derived from another product:
 * ADR 0009 L2, and ADR 0022 D-6 answers the question this file most invites.
 *
 * ## What is bought, and what is not
 *
 * ⚠️ **Since #366 the colour is bought too, and that is this file's other
 * change of mind.** It used to say *"the geometry, and nothing else"*, and that
 * every kind kept the colour `three-renderer.ts` §`SCATTER_STYLE` gave it —
 * *"which is what keeps `LIT_COLOURS` a complete statement of the palette"*. A
 * reviewer who remembers that paragraph is reading the old file. The cost it
 * stated was real and visible: a Kenney tree is authored with a separate trunk
 * material, so the trunk was drawn in the canopy's green, and a building whose
 * colour lives entirely in an atlas was drawn in one flat beige. #366 bakes
 * each part's own colour into a `COLOR_0` attribute at load, which keeps one
 * merged geometry, one material and one draw call per mesh.
 *
 * What D-7 was protecting is not given up with it: `scenery-palette.ts`
 * §`SCENERY_PALETTE` records every colour the committed models contribute and
 * `scenery-palette.test.ts` reproduces it from the bytes, so the palette is
 * still enumerable and still asserted — by a gate rather than by a table
 * somebody has to keep up to date. **Nothing else is bought**: a model's own
 * `MeshStandardMaterial` still never reaches the scene, which is the half of
 * D-7 that `three-seam.test.ts` cannot see and that {@link sceneryResourceUrl}
 * and `prepareSceneryGeometry` together enforce.
 */

import type { ScatterItem, SceneryKind } from './scatter';
import { stylisedFoldOf } from './stylised-shapes';

/**
 * The file each kind's shape is read from.
 *
 * ⚠️ **`?url` imports rather than paths in a string**, which is not a style
 * choice: Vite resolves these at build time, so a typo or a deleted file is a
 * build error rather than a 404 on a rider's phone mid-ride. It also puts the
 * bytes through the bundler's own asset pipeline, so each one is emitted with a
 * content hash and can be cached for ever.
 *
 * The values are therefore URLs and not paths, and nothing may assume their
 * shape — a small enough asset is inlined as a `data:` URI by the same
 * pipeline. {@link sceneryResourceUrl} compares against them by identity for
 * exactly that reason.
 */
import atlasUrl from './models/colormap.png?url';
import commercialAtlasUrl from './models/colormap-city-kit-commercial.png?url';
import buildingHUrl from './models/building-type-h.glb?url';
import buildingIUrl from './models/building-type-i.glb?url';
import buildingKUrl from './models/building-type-k.glb?url';
import buildingLUrl from './models/building-type-l.glb?url';
import buildingPUrl from './models/building-type-p.glb?url';
import buildingQUrl from './models/building-type-q.glb?url';
import commercialEUrl from './models/building-e.glb?url';
import commercialGUrl from './models/building-g.glb?url';
import commercialHUrl from './models/building-h.glb?url';
import bushUrl from './models/plant_bush.glb?url';
import bushTriangleUrl from './models/plant_bushLargeTriangle.glb?url';
import stoneAUrl from './models/stone_largeA.glb?url';
import stoneBUrl from './models/stone_largeB.glb?url';
import stoneCUrl from './models/stone_largeC.glb?url';
import stoneDUrl from './models/stone_largeD.glb?url';
import stoneFUrl from './models/stone_largeF.glb?url';
import oakUrl from './models/tree_oak.glb?url';
import pineRoundUrl from './models/tree_pineRoundD.glb?url';
import pineSmallBUrl from './models/tree_pineSmallB.glb?url';
import pineSmallCUrl from './models/tree_pineSmallC.glb?url';
import pineSmallDUrl from './models/tree_pineSmallD.glb?url';
import pineTallUrl from './models/tree_pineTallA.glb?url';
import treeDefaultUrl from './models/tree_default.glb?url';
import treeFatUrl from './models/tree_fat.glb?url';
import treeSimpleUrl from './models/tree_simple.glb?url';
import treeTallUrl from './models/tree_tall.glb?url';

/** One shape a kind may be drawn as. */
export interface SceneryModel {
  /**
   * The file's own name, without its extension.
   *
   * ⚠️ **Not derivable from {@link SceneryModel.url}**, which Vite hashes, and
   * that is why it is written down: `scenery-palette.ts` §`SCENERY_PALETTE` is
   * keyed on it, and `scenery-models.test.ts` asserts the two tables name the
   * same set. A model added without a palette entry — or a palette entry left
   * behind by a model that was removed — is a red build rather than a colour
   * nobody recorded.
   */
  readonly name: string;
  readonly url: string;
}

/**
 * The most shapes one kind may be drawn as: **3**.
 *
 * ⚠️ **A budget rather than an observation, and #367's sixth criterion.** Each
 * variant is one more merged geometry, one more `InstancedMesh` and therefore
 * one more draw call — #240's NFR-2. Twelve meshes is what the tables below
 * come to, against six before #367, and `game.browser.spec.ts` measures what
 * that actually costs a frame and prints it rather than reasoning about it.
 *
 * Raising this number means meeting that gate again: a measurement on the
 * device, published in `docs/validation/0002-android-shell-and-game.md` the way
 * Part H publishes the geometry cost. It is deliberately not a number the
 * renderer derives from however many files a table happens to hold, because
 * then adding a file would raise the budget silently, which is the growth this
 * constant exists to stop.
 *
 * ⚠️ It is also the ceiling the **quality ladder** works down from:
 * `quality.ts` §`QualitySettings.sceneryVariants` lets a throttling phone draw
 * fewer distinct shapes before it starts losing items, which is #367's own
 * suggestion and is why this is a maximum rather than a fixed count.
 */
export const MAXIMUM_SCENERY_VARIANTS = 3;

/**
 * The shapes each kind is drawn with, by kind.
 *
 * ⚠️ **`Partial`, and `post` is the key that is missing** — ADR 0022 D-3. A
 * kind with no entry keeps the primitive `SCATTER_STYLE` builds for it, which
 * is also what a kind whose model fails to load falls back to.
 *
 * ⚠️ **Order is load-bearing.** `ScatterItem.variant` indexes into these lists,
 * so reordering one changes which shape stands where along every route — which
 * is a change to the world and is the kind of thing
 * `arrangement-unchanged.test.ts` exists to make visible. Adding an entry at
 * the **end** moves the least.
 *
 * The three buildings are the pack's cheapest distinct silhouettes — a long low
 * one, an L-shaped one and a two-storey one, at 770, 800 and 1 024 triangles
 * against the 1 174 to 2 062 of the rest of the kit. The natural kinds take a
 * second shape each rather than a second *size*: `sceneryFitMetres` normalises
 * every model to the space its primitive occupied, so a "small" rock and a
 * "large" one are the same rock at this scale and buy nothing.
 */
export const SCENERY_MODELS: Partial<Record<SceneryKind, readonly SceneryModel[]>> = {
  'tree-broadleaf': [
    { name: 'tree_default', url: treeDefaultUrl },
    { name: 'tree_oak', url: oakUrl },
  ],
  'tree-conifer': [
    { name: 'tree_pineTallA', url: pineTallUrl },
    { name: 'tree_pineRoundD', url: pineRoundUrl },
  ],
  shrub: [
    { name: 'plant_bush', url: bushUrl },
    { name: 'plant_bushLargeTriangle', url: bushTriangleUrl },
  ],
  rock: [
    { name: 'stone_largeA', url: stoneAUrl },
    { name: 'stone_largeC', url: stoneCUrl },
  ],
  building: [
    { name: 'building-type-h', url: buildingHUrl },
    { name: 'building-type-i', url: buildingIUrl },
    { name: 'building-type-k', url: buildingKUrl },
  ],
};

/**
 * The files folded into each kind's meshes BESIDE the model each already has
 * — #3287: by kind, then by mesh ({@link SCENERY_MODELS}' order), then by
 * fold, the mesh's own model being fold 0.
 *
 * | kind | mesh | folded in |
 * |---|---|---|
 * | building | `building-type-h` | `building-type-l`, `building-e` |
 * | building | `building-type-i` | `building-type-p`, `building-h` |
 * | building | `building-type-k` | `building-type-q`, `building-g` |
 * | broadleaf | `tree_default` | `tree_fat`, `tree_simple` |
 * | broadleaf | `tree_oak` | `tree_tall` |
 * | conifer | `tree_pineTallA` | `tree_pineSmallC`, `tree_pineSmallB` |
 * | conifer | `tree_pineRoundD` | `tree_pineSmallD` |
 * | rock | `stone_largeA` | `stone_largeB`, `stone_largeD` |
 * | rock | `stone_largeC` | `stone_largeF` |
 *
 * ⚠️ **A building's two are its settings, in this order**: fold 1 a City Kit
 * (Suburban) house — the kit's three modern ones, a dark single pitch (`l`),
 * a flat roof on columns (`p`) and a flat roof with a carport (`q`) — and
 * fold 2 a City Kit (Commercial) building. `stylised-shapes.ts`
 * §`stylisedFoldOf` reads a lot's setting as that index. A natural kind's are
 * picked by where the item stands.
 *
 * ⚠️ **Order is load-bearing**, as `SCENERY_MODELS`' is: reordering a list
 * changes what stands where on every route.
 *
 * ⚠️ **An item costs the triangles of the one file it is drawn as**, and no
 * other's: `stylised-shapes.ts` §`STYLISED_SHAPE_TRIANGLES` holds the
 * heaviest a kind may be. The commercial buildings are the kit's with an
 * awning over a shop window — `building-e` low and wide under a green one,
 * `building-h` dark over a green one, `building-g` over an orange one.
 *
 * ⚠️ **Drawn only where the driver has `WEBGL_multi_draw`.** Without it a
 * mesh draws its own model alone, as before #3287 (`ScatterBelt`).
 *
 * Every file is the upstream artefact byte for byte, as the models above are,
 * from the archives the owner placed on 2026-11-26 (`ASSETS.toml` records
 * each archive's SHA-256, ADR 0049 D-11).
 */
export const STYLISED_FOLD_MODELS: Partial<
  Record<SceneryKind, readonly (readonly SceneryModel[])[]>
> = {
  'tree-broadleaf': [
    [
      { name: 'tree_fat', url: treeFatUrl },
      { name: 'tree_simple', url: treeSimpleUrl },
    ],
    [{ name: 'tree_tall', url: treeTallUrl }],
  ],
  'tree-conifer': [
    [
      { name: 'tree_pineSmallC', url: pineSmallCUrl },
      { name: 'tree_pineSmallB', url: pineSmallBUrl },
    ],
    [{ name: 'tree_pineSmallD', url: pineSmallDUrl }],
  ],
  rock: [
    [
      { name: 'stone_largeB', url: stoneBUrl },
      { name: 'stone_largeD', url: stoneDUrl },
    ],
    [{ name: 'stone_largeF', url: stoneFUrl }],
  ],
  building: [
    [
      { name: 'building-type-l', url: buildingLUrl },
      { name: 'building-e', url: commercialEUrl },
    ],
    [
      { name: 'building-type-p', url: buildingPUrl },
      { name: 'building-h', url: commercialHUrl },
    ],
    [
      { name: 'building-type-q', url: buildingQUrl },
      { name: 'building-g', url: commercialGUrl },
    ],
  ],
};

/**
 * The name of the file an item is drawn as, with `meshes` shapes a kind at
 * this rung (`quality.ts` §`sceneryVariants`) — #3287: its mesh's own model,
 * or a file folded in beside it. `undefined` for a kind drawn from no table —
 * a post, a barn, a wall.
 *
 * @test-facing the scenery plan read as shapes, for
 * `stylised-settings.test.ts`; the renderer draws by mesh and fold and needs
 * no name
 */
export function stylisedShapeNameOf(
  item: Pick<ScatterItem, 'kind' | 'x' | 'z' | 'lotSetting' | 'variant'>,
  meshes: number = MAXIMUM_SCENERY_VARIANTS,
): string | undefined {
  const models = SCENERY_MODELS[item.kind] ?? [];
  const shapes = Math.min(models.length, meshes);
  if (!(shapes > 0)) return undefined;
  const wanted = Number.isInteger(item.variant) ? item.variant : 0;
  const mesh = ((wanted % shapes) + shapes) % shapes;
  const folded = STYLISED_FOLD_MODELS[item.kind]?.[mesh] ?? [];
  const fold = stylisedFoldOf(item, 1 + folded.length);
  return fold === 0 ? models[mesh]?.name : folded[fold - 1]?.name;
}

/**
 * The colour atlas the City Kit paints every building from — #366.
 *
 * ⚠️ **Committed, and that is a change from #341.** The buildings' colour is
 * not in their `.glb` at all: each declares one external resource,
 * `Textures/colormap.png`, and until #366 that resource was refused and the
 * building was drawn in one flat colour of this repository's own. #366 samples
 * it once at load, writes the result into `COLOR_0` and throws the image away,
 * so the atlas is **fetched** where it was previously refused and still never
 * reaches the GPU. It is 11 784 bytes and one request, shared by all three
 * buildings.
 *
 * ⚠️ It is the same Kenney *City Kit (Suburban)* archive as the buildings, so
 * `ASSETS.toml` gains a row and nothing else changes: `ASSET004` admits
 * `CC0-1.0` under `apps/`, and ADR 0022 D-2's *"one source and one house
 * style"* is untouched.
 */
export const SCENERY_ATLAS: SceneryModel = { name: 'colormap', url: atlasUrl };

/**
 * The atlas the City Kit (Commercial) paints ITS buildings from — #3287.
 *
 * ⚠️ **A different image under the same declared name.** Every building of
 * both kits declares `Textures/colormap.png`, and the two files are not the
 * same bytes: a commercial building painted from the suburban atlas comes out
 * in another kit's colours. So the file is committed beside the first under a
 * name of its own (its bytes are the archive's), and
 * {@link sceneryResourceUrl} answers a model with the atlas of the kit it
 * came from ({@link COMMERCIAL_KIT_URLS}). Sampled at load and thrown away,
 * as the first is: it never reaches the GPU.
 */
export const COMMERCIAL_ATLAS: SceneryModel = {
  name: 'colormap-city-kit-commercial',
  url: commercialAtlasUrl,
};

/** The models that are City Kit (Commercial)'s, and so are painted from {@link COMMERCIAL_ATLAS}. */
const COMMERCIAL_KIT_URLS: ReadonlySet<string> = new Set([
  commercialEUrl,
  commercialGUrl,
  commercialHUrl,
]);

/**
 * The atlas a model's kit paints it from — #3287: {@link COMMERCIAL_ATLAS}
 * for a City Kit (Commercial) building, by its URL, {@link SCENERY_ATLAS} for
 * every other model, as it was.
 */
export function sceneryAtlasOf(modelUrl: string): SceneryModel {
  return COMMERCIAL_KIT_URLS.has(modelUrl) ? COMMERCIAL_ATLAS : SCENERY_ATLAS;
}

/**
 * The name the models' own glTF declares the atlas under.
 *
 * Read from the committed files: every City Kit `.glb` names
 * `Textures/colormap.png`. Matched on the final path segment because the URI is
 * resolved against wherever the bundler put the model, so the directory part is
 * not knowable here.
 */
const ATLAS_DECLARED_FILE = 'colormap.png';

/**
 * A 1 × 1 transparent PNG, as a `data:` URI. 68 bytes.
 *
 * What {@link sceneryResourceUrl} answers a resource nobody asked for with. Not
 * a placeholder that might one day be replaced by the real thing: the point is
 * that it is never fetched and never drawn.
 */
const NOTHING_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=';

/** Every URL this repository is willing to let a model reach. */
const OWN_URLS = new Set<string>([
  ...Object.values(SCENERY_MODELS).flatMap((models) => models.map((model) => model.url)),
  ...Object.values(STYLISED_FOLD_MODELS).flatMap((meshes) =>
    meshes.flatMap((folds) => folds.map((model) => model.url)),
  ),
  SCENERY_ATLAS.url,
  COMMERCIAL_ATLAS.url,
]);

/**
 * What a model is allowed to fetch: bytes this repository committed, and
 * nothing else.
 *
 * ## The hole this closes, which is not hypothetical
 *
 * A glTF may declare an **external** resource — a texture, a buffer — by URI,
 * and a loader will fetch whatever it finds there. Every City Kit building
 * declares exactly one: `Textures/colormap.png`, the shared atlas its pack
 * paints every building from. #240's NFR-5 says this epic *"makes no network
 * request"*, and until #341 that was true because there was no file to declare
 * one. A committed model turns it into something that has to be **enforced**,
 * because the answer is now inside a binary nobody reads in review.
 *
 * So the loader is handed this as its URL modifier, and **every answer it gives
 * is a URL of ours**:
 *
 * - one of {@link SCENERY_MODELS}' or {@link STYLISED_FOLD_MODELS}' own
 *   values, or an atlas's, matched by identity;
 * - `atlas`' own value, for a resource whose last path segment is the name
 *   the packs declare their atlas under — {@link SCENERY_ATLAS} unless the
 *   caller is loading a model of another kit ({@link sceneryAtlasOf}, #3287),
 *   and never anything but one of the two committed atlases;
 * - {@link NOTHING_IMAGE} for everything else — 68 bytes of transparent PNG
 *   that is already in the bundle.
 *
 * ⚠️ **The atlas case is a redirection and not an admission, and that is the
 * property worth stating.** A future model declaring
 * `https://example.invalid/colormap.png` is answered with *our* committed
 * atlas, not with that host's; one declaring anything else is answered with 68
 * bytes. So **a model cannot reach a third party** — the claim is about the
 * function's range rather than about its conditions, which is what
 * `scenery-models.test.ts` asserts over a list of hostile inputs, and it is a
 * stronger statement than the identity-only rule this function carried before
 * #366.
 *
 * ⚠️ **A model is still matched by identity, never by extension or by prefix.**
 * `endsWith('.glb')` would admit any `.glb` a model referenced, which is the
 * same mistake in a new place, and a path prefix cannot be written at all
 * because Vite chooses where these land.
 */
export function sceneryResourceUrl(url: string, atlas: SceneryModel = SCENERY_ATLAS): string {
  if (OWN_URLS.has(url)) {
    return url;
  }
  if (lastSegment(url) !== ATLAS_DECLARED_FILE) {
    return NOTHING_IMAGE;
  }
  // ⚠️ By identity, so the range stays "a URL of ours" whatever is passed in.
  return atlas.url === COMMERCIAL_ATLAS.url ? COMMERCIAL_ATLAS.url : SCENERY_ATLAS.url;
}

/** The part after the last `/`, with any query or fragment taken off. */
function lastSegment(url: string): string {
  const path = url.split('#')[0]?.split('?')[0] ?? '';
  return path.slice(path.lastIndexOf('/') + 1);
}
