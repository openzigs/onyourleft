// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The windows and the front door of a mapped building, laid out — #1581.
 *
 * #1540 cut no windows, because a footprint can have forty walls and the
 * openings `buildings.ts` cuts would not fit in 640 triangles. #1549 drew its
 * plans as boxes with a door, and the owner's verdict on the screenshots was
 * that they "look terrible". #1581's ruling prefers a facade atlas to extra
 * geometry, so that windows cost no draw call; this is that atlas, written as
 * arithmetic rather than as a texture. Each wall vertex carries its place in
 * whole bays and storeys (`footprint-buildings.ts` §`FACADE_FLOATS`), and
 * `three-renderer.ts` §`withFacade` draws, at every fragment, the part of the
 * layout below that the fragment falls in: **no triangle, no texture, no
 * draw call and no download** for any number of windows.
 *
 * ## The layout, in a bay and a storey
 *
 * A bay is one window wide and one storey high. The window is
 * `buildings.ts` §`WINDOW`'s 1.0 m by 1.3 m at a {@link BAY_METRES} bay, with
 * its sill 0.9 m above its own floor, as a procedural house's is. A bay is
 * stretched to its wall's whole count (`baysOf`), so the window is widened
 * with it: between 0.6 m and 1.5 m on a real footprint's walls.
 *
 * - a **frame** round the glass, {@link FRAME_METRES} wide, and a mullion and
 *   a transom, in the trim's paint;
 * - the **glass**: a dark room behind a pane that gives back the sky the
 *   environment map holds, lighter toward its top; one window in five is a
 *   lit or curtained room, seeded by its place;
 * - a **sill** under it, a little wider than the frame, in the trim's paint.
 *
 * The door's quad holds the door and its surround (`DOOR_FACE`): the
 * **surround** in the trim's paint, the **leaf** in the door's, with two
 * fielded panels, and a glazed **fanlight** over it.
 *
 * {@link facadePartAt} is this layout in TypeScript, so a test can hold the
 * rules — no window above the eaves, none behind the door, every window
 * whole — to the same numbers the shader is generated from.
 */

import { WINDOW } from './buildings';
import {
  BAY_METRES,
  DOOR_FACE,
  DOOR_SURROUND_METRES,
  FACADE_DOOR,
  FACADE_PAINT,
  STOREY_METRES,
} from './footprint-buildings';

/** How far a window's sill is above its own floor: **0.9 m**, as a procedural house's is. */
export const WINDOW_SILL_METRES = 0.9;

/** How wide a window's frame is, round its glass: **0.08 m**, `buildings.ts`' own. */
export const FRAME_METRES = 0.08;

/** How wide a glazing bar is: **0.04 m**. */
export const GLAZING_BAR_METRES = 0.04;

/** How far a sill runs past its frame either side, and how deep it is: **0.06 m** and **0.07 m**. */
export const SILL = { overrun: 0.06, depth: 0.07 } as const;

/** How high the fanlight over a door is, inside its surround: **0.35 m**. */
export const FANLIGHT_METRES = 0.35;

/**
 * The window in its bay, as shares of the bay across and of the storey up —
 * the numbers both {@link facadePartAt} and the shader read.
 */
export const WINDOW_IN_BAY = {
  left: 0.5 - WINDOW.width / BAY_METRES / 2,
  right: 0.5 + WINDOW.width / BAY_METRES / 2,
  bottom: WINDOW_SILL_METRES / STOREY_METRES,
  top: (WINDOW_SILL_METRES + WINDOW.height) / STOREY_METRES,
  frameAcross: FRAME_METRES / BAY_METRES,
  frameUp: FRAME_METRES / STOREY_METRES,
  barAcross: GLAZING_BAR_METRES / BAY_METRES / 2,
  barUp: GLAZING_BAR_METRES / STOREY_METRES / 2,
  /** The transom, a share of the storey up: a third of the way down the window. */
  transom: (WINDOW_SILL_METRES + (WINDOW.height * 2) / 3) / STOREY_METRES,
  sillAcross: SILL.overrun / BAY_METRES,
  sillUp: SILL.depth / STOREY_METRES,
} as const;

/** The door's parts in its quad, as shares of it across and up. */
export const DOOR_IN_FACE = {
  surroundAcross: DOOR_SURROUND_METRES / DOOR_FACE.width,
  surroundUp: DOOR_SURROUND_METRES / DOOR_FACE.height,
  fanlight: (DOOR_FACE.height - DOOR_SURROUND_METRES - FANLIGHT_METRES) / DOOR_FACE.height,
} as const;

/**
 * What a point of a facade is.
 *
 * @test-facing what {@link facadePartAt} answers, for `facade.test.ts`
 */
export type FacadePart =
  'wall' | 'frame' | 'glass' | 'sill' | 'surround' | 'leaf' | 'fanlight' | 'paint';

/**
 * The part of a facade at `(u, v)` on a face whose `top` and `skip` are as
 * `footprint-buildings.ts` §`FACADE_FLOATS` says — #1581's layout, which
 * `three-renderer.ts` §`withFacade` draws from the same numbers.
 *
 * @test-facing held by `facade.test.ts`; the product draws it in the shader
 */
export function facadePartAt(u: number, v: number, top: number, skip: number): FacadePart {
  if (top === FACADE_PAINT) return 'paint';
  if (top === FACADE_DOOR) {
    const { surroundAcross, surroundUp, fanlight } = DOOR_IN_FACE;
    if (u < surroundAcross || u > 1 - surroundAcross || v > 1 - surroundUp) return 'surround';
    return v >= fanlight ? 'fanlight' : 'leaf';
  }
  if (!(top > 0)) return 'wall';
  const bay = Math.floor(u);
  const storey = Math.floor(v);
  const x = u - bay;
  const y = v - storey;
  const w = WINDOW_IN_BAY;
  if (storey < 0 || storey + w.top > top) return 'wall';
  if (storey === 0 && bay === skip) return 'wall';
  if (x >= w.left && x <= w.right && y >= w.bottom && y <= w.top) {
    const inside =
      x >= w.left + w.frameAcross &&
      x <= w.right - w.frameAcross &&
      y >= w.bottom + w.frameUp &&
      y <= w.top - w.frameUp;
    const bar = Math.abs(x - 0.5) <= w.barAcross || Math.abs(y - w.transom) <= w.barUp;
    return inside && !bar ? 'glass' : 'frame';
  }
  if (
    x >= w.left - w.sillAcross &&
    x <= w.right + w.sillAcross &&
    y >= w.bottom - w.sillUp &&
    y < w.bottom
  ) {
    return 'sill';
  }
  return 'wall';
}
