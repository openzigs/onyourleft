// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which file each scenery kind's shape comes from, and what a model is allowed
 * to reach for — #341.
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
 * {@link SCENERY_MODEL_FILES} is a `Partial` record on purpose, and
 * `scenery-models.test.ts` asserts which key is missing rather than letting an
 * omission look like an oversight.
 *
 * ⚠️ **And the set stays at six.** A pack of forty thousand assets being
 * available is not a reason to place a seventh kind — that is a `scatter.ts`
 * change with its own placement question, and ADR 0022 D-3 says it arrives as
 * its own issue.
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
 * ⚠️ **The geometry, and nothing else.** #341 is explicit — *"Each currently
 * renders as a generated solid in `three-renderer.ts`. This issue replaces the
 * **geometry** and nothing else"* — so a model's own materials never reach the
 * scene. Every kind keeps the colour `three-renderer.ts` §`SCATTER_STYLE`
 * already gave it, which is what keeps `LIT_COLOURS` a complete statement of
 * the palette and keeps the world's colours a function of this repository
 * rather than of a pack's house style.
 *
 * The visible cost is stated rather than left to be discovered: a Kenney tree
 * is authored with a separate trunk material, and one colour per kind spends
 * that — the trunk is drawn in the canopy's green. It buys the silhouette,
 * which is what #302 asked for, and it keeps the belt at **one material and one
 * draw call per kind**.
 *
 * {@link sceneryResourceUrl} is the enforcement half of the same sentence.
 */

import type { ScatterKind } from './scatter';

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
import buildingUrl from './models/building-type-h.glb?url';
import shrubUrl from './models/plant_bush.glb?url';
import rockUrl from './models/stone_largeA.glb?url';
import broadleafUrl from './models/tree_default.glb?url';
import coniferUrl from './models/tree_pineTallA.glb?url';

/**
 * The shape each kind is drawn with, by kind.
 *
 * ⚠️ **`Partial`, and `post` is the key that is missing** — ADR 0022 D-3. A
 * kind with no entry keeps the primitive `SCATTER_STYLE` builds for it, which
 * is also what a kind whose model fails to load falls back to.
 */
export const SCENERY_MODEL_FILES: Partial<Record<ScatterKind, string>> = {
  'tree-broadleaf': broadleafUrl,
  'tree-conifer': coniferUrl,
  shrub: shrubUrl,
  rock: rockUrl,
  building: buildingUrl,
};

/**
 * A 1 × 1 transparent PNG, as a `data:` URI. 68 bytes.
 *
 * What {@link sceneryResourceUrl} answers a model's own texture with. Not a
 * placeholder that might one day be replaced by the real thing: the point is
 * that it is never fetched and never drawn.
 */
const NOTHING_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=';

/**
 * What a model is allowed to fetch: its own bytes, and nothing else.
 *
 * ## The hole this closes, which is not hypothetical
 *
 * A glTF may declare an **external** resource — a texture, a buffer — by URI,
 * and a loader will fetch whatever it finds there. `building-type-h.glb`
 * declares exactly one: `Textures/colormap.png`, the shared atlas its pack
 * paints every building from. #240's NFR-5 says this epic *"makes no network
 * request"*, and until #341 that was true because there was no file to declare
 * one. A committed model turns it into something that has to be **enforced**,
 * because the answer is now inside a binary nobody reads in review.
 *
 * So the loader is handed this as its URL modifier, and every resource that is
 * not one of {@link SCENERY_MODEL_FILES}' own values is answered with
 * {@link NOTHING_IMAGE} — 68 bytes of transparent PNG that is already in the
 * bundle. Two things follow, and the second is the one worth having:
 *
 * - The atlas is not fetched, which is correct rather than merely cheap: the
 *   materials it paints are discarded on the next line anyway, because this
 *   change buys geometry and not colour. A model that arrived with its own PBR
 *   material and kept it would change how the **whole scene** is shaded with no
 *   gate going red — ADR 0022 D-7 is about precisely that, and it is a hole
 *   `three-seam.test.ts` cannot see because a `MeshStandardMaterial` built by a
 *   loader from a binary appears in no source file.
 * - **A model cannot reach a third party.** A future asset whose glTF names
 *   `https://…` gets the same 68 bytes, and the world is drawn without it —
 *   rather than a rider's ride quietly contacting a host nobody chose.
 *
 * ⚠️ **A resource is matched by identity against the table, not by extension
 * or by prefix.** `endsWith('.glb')` would admit any `.glb` a model referenced,
 * which is the same mistake in a new place, and a path prefix cannot be written
 * at all because Vite chooses where these land.
 */
export function sceneryResourceUrl(url: string): string {
  return Object.values(SCENERY_MODEL_FILES).includes(url) ? url : NOTHING_IMAGE;
}
