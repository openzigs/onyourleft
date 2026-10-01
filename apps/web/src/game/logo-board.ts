// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The board the game's wordmark is painted on — #966 — and where it stands on
 * the starting gate.
 *
 * ## One shape, two places
 *
 * The owner ruled that the logo goes on a race's **starting gate** and on a
 * few **billboards** along a course, in both worlds. Both are this one shape,
 * built from numbers the way `buildings.ts` builds a barn: a board
 * {@link LOGO_BOARD_WIDTH_METRES} × {@link LOGO_BOARD_HEIGHT_METRES} — the
 * wordmark texture's own 8 : 1 (`tools/brand/game-wordmark.ts`) — on two
 * posts. A billboard stands on its posts beside the road (`billboards.ts`); on
 * the gate the same board sits on the gantry's beam (`gantry.ts`), and its
 * posts are folded up into it by {@link LogoPlace.foot}, so that one instanced
 * mesh — one draw call, one texture — draws every board in a frame.
 *
 * ## Its frame
 *
 * `x` along the board (to the reader's right), `y` up from where it stands,
 * `z` out of its face, toward whoever reads it. The front face carries the
 * wordmark with `u` along `x` and `v` up `y`, so it reads left to right from
 * in front; every other face is the board's own white, and the posts are
 * galvanised grey.
 *
 * Pure: names no rendering library.
 */

import type { Billboard } from './billboards';
import {
  GANTRY_BEAM_HEIGHT_METRES,
  GANTRY_BEAM_UNDERSIDE_METRES,
  LINE_LAPS_IN_REACH,
  standPoint,
  type PlacedStand,
} from './gantry';

/** The board: **8 m** wide and **1 m** tall — the wordmark's 8 : 1. */
export const LOGO_BOARD_WIDTH_METRES = 8;
export const LOGO_BOARD_HEIGHT_METRES = 1;

/** The board's thickness: **0.15 m**. */
export const LOGO_BOARD_DEPTH_METRES = 0.15;

/** A billboard's board, its lower edge above the ground: **2 m** — over a wall or a hedge in front of it. */
export const BILLBOARD_BOARD_BOTTOM_METRES = 2;

/** A post's side, square: **0.15 m**. */
export const LOGO_POST_METRES = 0.15;

/** Where the posts stand along the board, either side of its middle: **3.2 m**. */
export const LOGO_POST_ACROSS_METRES = 3.2;

/** How far a post reaches into the ground: **1.5 m** — enough for a verge that falls away. */
export const LOGO_POST_BELOW_METRES = 1.5;

/** One box of the shape, in its own frame: its middle and its size on each axis. */
export interface LogoBox {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly role: 'board' | 'post';
}

/** The board and its two posts. */
export function logoBoxes(): readonly LogoBox[] {
  const top = BILLBOARD_BOARD_BOTTOM_METRES + LOGO_BOARD_HEIGHT_METRES;
  const postHeight = top + LOGO_POST_BELOW_METRES;
  return [
    {
      x: 0,
      y: BILLBOARD_BOARD_BOTTOM_METRES + LOGO_BOARD_HEIGHT_METRES / 2,
      z: 0,
      width: LOGO_BOARD_WIDTH_METRES,
      height: LOGO_BOARD_HEIGHT_METRES,
      depth: LOGO_BOARD_DEPTH_METRES,
      role: 'board',
    },
    ...[-1, 1].map((side): LogoBox => ({
      x: side * LOGO_POST_ACROSS_METRES,
      y: top - postHeight / 2,
      // Behind the board, so its face is whole.
      z: -(LOGO_BOARD_DEPTH_METRES + LOGO_POST_METRES) / 2,
      width: LOGO_POST_METRES,
      height: postHeight,
      depth: LOGO_POST_METRES,
      role: 'post',
    })),
  ];
}

/**
 * How much ground a billboard covers in its own frame, as `settlements.ts`
 * §`STRUCTURE_FOOTPRINTS` gives a structure's: half its width along `x`, and
 * how far it reaches behind (`back`) and in front (`front`) along `z`. Read off
 * {@link logoBoxes}, with a little to spare; `billboards.test.ts` holds every
 * box inside it.
 */
export const BILLBOARD_FOOTPRINT = {
  x: LOGO_BOARD_WIDTH_METRES / 2 + 0.1,
  back: -(LOGO_BOARD_DEPTH_METRES / 2 + LOGO_POST_METRES) - 0.1,
  front: LOGO_BOARD_DEPTH_METRES / 2 + 0.1,
} as const;

/**
 * One board, placed: where its frame's origin is, its axes, and the lowest a
 * vertex of it may be drawn, in its own frame — `-Infinity` for a billboard,
 * whose posts reach into the ground, and the board's lower edge on the gate,
 * which folds the posts away.
 */
export interface LogoPlace {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Its `x` axis, a unit vector in the ground plane. */
  readonly acrossX: number;
  readonly acrossZ: number;
  /** Its `z` axis — out of its face — a unit vector in the ground plane. */
  readonly faceX: number;
  readonly faceZ: number;
  readonly foot: number;
}

/**
 * The most wordmark boards one frame draws — #966: the size of
 * `three-renderer.ts` §`LogoBelt`'s one instanced mesh.
 */
export const LOGO_BOARDS_PER_FRAME = 8;

/**
 * The most START-GATE boards one frame can hold: one stand carries the logo
 * ({@link carriesTheLogo}), and a short loop places it once a lap for
 * `gantry.ts` §`LINE_LAPS_IN_REACH` laps.
 */
export const GATE_LOGO_BOARDS_PER_FRAME = LINE_LAPS_IN_REACH;

/**
 * The most billboards one frame carries — #966's review: what the belt has
 * left once every gate board is drawn. `scene.ts` takes the nearest this many
 * BEFORE it clears the scenery for them (`billboards.ts`
 * §`nearestBillboards`), so the belt's capacity can never drop a board whose
 * patch of ground was already cleared.
 */
export const BILLBOARDS_PER_FRAME = LOGO_BOARDS_PER_FRAME - GATE_LOGO_BOARDS_PER_FRAME;

/**
 * The board on a gate: sitting on the beam's top, its middle over the road's
 * centreline, its face toward the rider riding at the gate — the banner's own
 * frame (`three-renderer.ts` §`GantryBelt`): across is the road's normal, the
 * rider's right, and the face is against the heading.
 */
export function gateLogoPlace(line: PlacedStand): LogoPlace {
  const beamTop = GANTRY_BEAM_UNDERSIDE_METRES + GANTRY_BEAM_HEIGHT_METRES;
  const at = standPoint(line, 0, beamTop - BILLBOARD_BOARD_BOTTOM_METRES, 0);
  return {
    x: at.x,
    y: at.y,
    z: at.z,
    acrossX: -line.headingZ,
    acrossZ: line.headingX,
    faceX: -line.headingX,
    faceZ: -line.headingZ,
    foot: BILLBOARD_BOARD_BOTTOM_METRES,
  };
}

/** A billboard as a board's place: standing on its posts, facing as it was turned. */
export function billboardLogoPlace(board: Billboard): LogoPlace {
  // A yaw maps the board's `z` to `(sin, cos)` and its `x` to `(cos, −sin)`.
  const sin = Math.sin(board.rotation);
  const cos = Math.cos(board.rotation);
  return {
    x: board.x,
    y: board.y,
    z: board.z,
    acrossX: cos,
    acrossZ: -sin,
    faceX: sin,
    faceZ: cos,
    foot: Number.NEGATIVE_INFINITY,
  };
}

/** Which line a gate's logo goes on: the start, or a loop's one line — the race's start. */
export function carriesTheLogo(line: PlacedStand): boolean {
  return line.stand.kind === 'gantry' && line.stand.distance === 0;
}
