// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A scatter tree near the chase camera fades out, and never pops — #545, the
 * owner's ruling of 2026-11-02.
 *
 * ## The rule
 *
 * A realistic scatter tree whose trunk stands nearer the camera's EYE, in plan,
 * than {@link NEAR_TREE_FADE_METRES}' `whole` is drawn with only part of its
 * pixels, falling evenly to none at `gone`:
 *
 *     keep = clamp((distance − gone) / (whole − gone), 0, 1)
 *
 * `three-renderer.ts` §`RealisticVegetationBelt` scales the tree's share of the
 * screen-space dither #617's hand-over already reads (`tree-levels.ts`
 * §`writeInterval`) by `keep`, at every level the tree is drawn at, so a fading
 * tree is no new draw call, no blending and no sorting: the pixels of the hash
 * past `keep` are discarded by every level of that tree. A tree at `keep` 0 is
 * not drawn and not ranked, as a tree the camera cannot see is not
 * (`three-renderer.ts` §`treeCanBeSeen`, which is unchanged), and its ground
 * blob fades with it.
 *
 * ## Why, and why only trees
 *
 * The owner's ruling: #2011 (#1994) turns the camera to look round a bend,
 * which brings a roadside tree into the near-left view on the owner's course,
 * and a trunk there is #545's "flat grey wedge". It applies to scenery only —
 * never the road, the riders, the markers or the mapped buildings — and of
 * the scenery only the realistic trees carry #617's dither, so only they can
 * fade without a transparent pass per belt, which `near-field.ts` says #240's
 * draw-call budget does not have.
 *
 * ## The distances
 *
 * - **`whole`, 6 m**, the owner's "about 6 m in front of the chase camera".
 * - **`gone`, 4.5 m**, measured: over `near-field.test.ts`' fixture rides, with
 *   the camera on the racing line, the farthest trunk from the eye of a
 *   realistic tree the near plane cuts at the widest frame the stylesheet
 *   allows (6 : 1) was 4.37 m. A tree is gone before it is that near, so
 *   `near-field.ts` §`clearOfTheCamera` never drops a tree that is still drawn
 *   — its cull, which drops a tree whole in one frame, no longer pops one on
 *   any frame a device or a window can draw. `near-tree-fade.test.ts` rides
 *   the same routes and holds it. At 8 : 1, a frame nothing can produce, the
 *   farthest was 5.07 m.
 *
 * ⚠️ **It is the distance from the EYE, not from the rider**, and in plan:
 * the eye stands `camera.ts` §`CAMERA_BEHIND_METRES` behind the pose along its
 * heading, as `camera.ts` §`cameraRig` places it, so a pose that turns the
 * camera (#1994) moves the eye this measures from with it.
 *
 * ⚠️ **It touches ordinary roadside trees too, a little.** On the fixtures'
 * level road the nearest tree a camera can see passes 5.44 m from the eye, so
 * it is drawn at about 63 % of its pixels as it leaves the side of the frame.
 *
 * Pure, and naming no rendering library — `three-seam.test.ts`.
 */

import { CAMERA_BEHIND_METRES } from './camera';
import type { CameraPose } from './port';

/** Where the fade starts (`whole`) and where a tree is gone (`gone`), from the eye in plan. */
export const NEAR_TREE_FADE_METRES = { gone: 4.5, whole: 6 } as const;

/**
 * How a near tree is drawn: `'fade'` is the product; `'off'` draws it whole at
 * any distance, as before #545's ruling; `'cut'` drops it whole at the middle
 * of the fade, in one frame — the pop the fade replaces. The two others are
 * the owner's page's `-near-tree-fade` lever and the browser gate's controls.
 */
export type NearTreeFade = 'fade' | 'off' | 'cut';

/**
 * The share of its pixels a tree whose trunk stands at `(x, z)` keeps, for a
 * frame drawn from `pose` — 1 whole, 0 not drawn. Allocates nothing: the belt
 * asks it of every tree every frame.
 */
export function nearTreeKeep(x: number, z: number, pose: CameraPose, fade: NearTreeFade): number {
  if (fade === 'off') return 1;
  const distance = Math.hypot(
    x - (pose.x - pose.headingX * CAMERA_BEHIND_METRES),
    z - (pose.z - pose.headingZ * CAMERA_BEHIND_METRES),
  );
  const { gone, whole } = NEAR_TREE_FADE_METRES;
  if (fade === 'cut') return distance > (gone + whole) / 2 ? 1 : 0;
  return Math.min(1, Math.max(0, (distance - gone) / (whole - gone)));
}
