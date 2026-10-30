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
 *
 * ## The US house (#1588)
 *
 * A residential wall's vertices also carry a style (`footprint-buildings.ts`
 * §`STYLE_FLOATS`), and with `STYLE_SASH` its windows are laid in metres
 * rather than as shares of the bay, so that a window keeps its proportions
 * however its bay is stretched:
 *
 * - a **double-hung sash** ({@link SASH}), about 1 : 1.7, with a **meeting
 *   rail** across its middle; **two** either side of a mullion in a bay at
 *   least {@link PAIR_MIN_BAY_METRES} wide; a **picture window**
 *   ({@link PICTURE}) in the bay the style names, beside the door;
 * - an **inset reveal** ({@link REVEAL}): since #1659 every kind's, and
 *   drawn from the view ({@link revealOf});
 * - **shutters** ({@link SHUTTER}) either side, in the trim's paint, where the
 *   style asks for them and the bay is wide enough.
 *
 * And the face's cladding, under the openings ({@link claddingPartAt}):
 * **clapboard** courses with a shadow under each lap ({@link CLAPBOARD}),
 * **asphalt shingles** in staggered tabs ({@link SHINGLE}), a **foundation**
 * of block or brick ({@link FOUNDATION}), and a driveway's **paving**
 * ({@link PAVING}); and its shade ({@link FACADE_AO}): under the eaves, at a
 * wall's foot. A dormer's front holds one sash ({@link DORMER_SASH}) and a
 * garage's face a panelled door ({@link GARAGE_DOOR}).
 *
 * ## The main street (#1590)
 *
 * A commercial building's walls carry `STYLE_COMMERCIAL`, and their windows
 * are taller ({@link COMMERCIAL_WINDOW_IN_BAY}). Its front wall's ground
 * storey is covered by a shop front's face (`FACADE_SHOPFRONT`, laid out by
 * {@link shopFrontPartAt}): glass across most of the wall over a stall riser,
 * mullions and a transom, and the door's place, where its door stands — a
 * glazed door in a recess, the door's face with the commercial style. Over
 * it a sign band (`FACADE_SIGN`), a plain painted panel in a moulding: **no
 * text, brand or logo**. Under the sign, on some, an awning (`FACADE_AWNING`)
 * of canvas, striped or plain.
 *
 * ## The reveal (#1659)
 *
 * Every window kind — the sash, single, paired or a picture window, #1581's
 * casement, #1590's commercial window and a dormer's sash — is glazed
 * {@link REVEAL_DEPTH_METRES} behind its frame, and one rule ({@link revealOf},
 * the shader's `oylRevealOf`) draws what that depth does as the view and the
 * sun move, in the face's own frame ({@link FacadeView}):
 *
 * - **parallax**: the glass is seen through the opening shifted by the depth
 *   along the eye's slant, and the strip it uncovers inside the far jamb is
 *   the opening's side, a `reveal`;
 * - **the sun's shadow** on the glass, from the head and from the jamb on the
 *   sun's side, as deep as the sun's slant makes it — a `reveal` too — and
 *   none where the sun is behind the face;
 * - **the sill's shadow** down the wall below it ({@link SILL}'s depth), a
 *   `shadow`.
 *
 * ## The overhang's shadow (#1658)
 *
 * Under a pitched roof's eaves a wall the sun lights is in the sun's own
 * shadow from the eaves' edge down, as deep as the sun's slant makes it
 * ({@link overhangShadowDepth}, {@link overhangShadowAt}, the shader's
 * `oylOverhangShadow`); a wall the sun is behind keeps #1588's soft band
 * ({@link FACADE_AO}), and {@link eavesShadeAt} is both. Since #1679 a
 * cornice's shadow falls the same way on the parapet's face under it and on
 * the wall below ({@link corniceShadeAt}; the wall's flag
 * `footprint-buildings.ts` §`STYLE_CORNICE`, the parapet's `skip`), and an
 * awning's on the shop front under it ({@link awningShadeAt}; the shop
 * front's `skip` is the awning's depth). Every one is
 * {@link overhangShadeAt}, the shader's `oylOverhangShadeOf`.
 *
 * ## The weathering (#1661)
 *
 * No mapped wall is as clean as a render: {@link WEATHERING} is one constant
 * an effect — splash grime at a wall's foot, streaks under the sills, a flat
 * roof's drip, a roof's eaves courses and moss, a parged plinth, and noise
 * that breaks the photograph's repeat — each scaled by the building's seeded
 * age ({@link weatheringAgeOf}), and {@link weatheringAt} is the shader's
 * `oylWeather*` functions in TypeScript. The photograph itself is laid
 * differently on each building ({@link photographShiftOf}), so that two
 * neighbours do not share one brick's phase. No texture, no second fetch.
 *
 * ## The tower (#1636)
 *
 * A building of `footprint-buildings.ts` §`GLAZED_MIN_STOREYS` or more in a
 * covered urban class carries `STYLE_GLAZED`, and its walls are a curtain
 * wall in place of windows ({@link CURTAIN_WALL}, {@link curtainWallPartAt}):
 * a band of glass every storey over an opaque spandrel, a transom between
 * them and thin mullions at an even module across each bay. **No texture and
 * no new material**: the flag is a bit of the style the wall already carries.
 * The glass gives back the sky, and since #1662 an office stands behind it.
 *
 * ## The rooms behind the glass (#1662)
 *
 * Every pane — a sash, a casement, a commercial window, a dormer's, a curtain
 * wall's, a fanlight, a shop door's and a shop front's — shows a room
 * ({@link INTERIOR}, {@link interiorAt}, the shader's `oylInterior`): the
 * eye's ray through the glass followed into a box behind it, its back wall,
 * floor, ceiling and side walls painted from a home's, a shop's or an
 * office's palette ({@link INTERIOR_PALETTES}) by a seed of the window's cell
 * and its building ({@link roomSeedAt}), sometimes a blind or a plain dark
 * shape against the back wall, and #1581's one lit room in five
 * ({@link litRoomAt}) warm. The pane is a dielectric: the environment it gives
 * back is weighted by Schlick's Fresnel from F0 0.04, and the room by what is
 * left ({@link glassWeightsAt}), so a pane is its room head-on and the sky at
 * a graze. Far off a sash's, a casement's and a curtain wall's pane fades to
 * the same mean as before; the dormer's, the fanlight, the shop door's and
 * the shop front's have no far fade and show the room at any distance. **No texture, no
 * cubemap, no atlas.**
 *
 * ## The porch (#1589)
 *
 * A front porch's railing is one quad (`footprint-buildings.ts`
 * §`FACADE_RAILING`), and on it a top rail, a bottom rail and a baluster
 * every `porch.ts` §`FRONT_PORCH`'s `railing.spacing`, with the porch's
 * shade between them ({@link RAILING}): drawn, not cut, so the railing is
 * four triangles a run and no `discard` in a material every wall shares.
 */

import { linearFromSrgb, type Rgb } from './building-paint';
import { OPENING_RECESS_METRES, WINDOW } from './buildings';
import {
  AWNING,
  BAY_METRES,
  CLAD_BLOCK,
  CLAD_BRICK,
  CLAD_CLAPBOARD,
  CLAD_PAVING,
  CLAD_SHINGLE,
  CORNICE,
  DOOR_FACE,
  DOOR_SURROUND_METRES,
  EAVES_OVERHANG_METRES,
  FACADE_DOOR,
  FACADE_DORMER,
  FACADE_GARAGE,
  FACADE_AWNING,
  FACADE_PAINT,
  FACADE_SHOPFRONT,
  FACADE_SIGN,
  FACADE_RAILING,
  GARAGE,
  PARAPET_METRES,
  ROOF_PITCHES_DEGREES,
  ROOF_THICKNESS_METRES,
  STOREY_METRES,
  STYLE_COMMERCIAL,
  STYLE_GLAZED,
  STYLE_SASH,
  STYLE_SHUTTERS,
} from './footprint-buildings';
import { FRONT_PORCH } from './porch';
import { SUN_ELEVATION_AT_POLE_DEGREES } from './world';

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

/**
 * A commercial building's window — #1590: **1.2 m by 1.8 m**, its sill 0.75 m
 * above its floor, as #1581's casement is laid out but taller, as a shop's
 * upper floors' sashes are; the numbers both {@link facadePartAt} and the
 * shader read, as shares of the bay across and the storey up.
 */
export const COMMERCIAL_WINDOW = { width: 1.2, height: 1.8, sill: 0.75 } as const;

/** {@link COMMERCIAL_WINDOW} in its bay, as {@link WINDOW_IN_BAY} lays #1581's. */
export const COMMERCIAL_WINDOW_IN_BAY = {
  left: 0.5 - COMMERCIAL_WINDOW.width / BAY_METRES / 2,
  right: 0.5 + COMMERCIAL_WINDOW.width / BAY_METRES / 2,
  bottom: COMMERCIAL_WINDOW.sill / STOREY_METRES,
  top: (COMMERCIAL_WINDOW.sill + COMMERCIAL_WINDOW.height) / STOREY_METRES,
  frameAcross: FRAME_METRES / BAY_METRES,
  frameUp: FRAME_METRES / STOREY_METRES,
  barAcross: GLAZING_BAR_METRES / BAY_METRES / 2,
  barUp: GLAZING_BAR_METRES / STOREY_METRES / 2,
  /** The transom, a share of the storey up: a quarter of the way down the window. */
  transom: (COMMERCIAL_WINDOW.sill + (COMMERCIAL_WINDOW.height * 3) / 4) / STOREY_METRES,
  sillAcross: SILL.overrun / BAY_METRES,
  sillUp: SILL.depth / STOREY_METRES,
} as const;

/**
 * A shop front — #1590, in metres across its face and up from the floor:
 * `frame`, its surround's width; `riser`, the stall riser's height under the
 * glass, and `sill`, the sill on it; `transom`, the bar under the transom
 * lights, from and to; `mullion`, a mullion's width; and `light`, the widest
 * a pane is between them.
 */
export const SHOP_FRONT = {
  frame: 0.1,
  riser: 0.45,
  sill: 0.07,
  transom: [2.02, 2.1],
  mullion: 0.06,
  light: 1.4,
} as const;

/** A shop's door — #1590: its glazed leaf's frame, in metres, within the door's face. */
export const SHOP_DOOR = { frame: 0.09, rail: 0.14 } as const;

/** A sign band's moulding round its panel — #1590, in metres. */
export const SIGN_MOULDING_METRES = 0.05;

/** A striped awning's stripe — #1590: its width along the awning, in metres. */
export const AWNING_STRIPE_METRES = 0.3;

/**
 * What a point of a shop front is — #1590: its `frame` (surround, sill,
 * mullions and the transom bar), the stall `riser`, the `glass`, or the
 * `door`'s place, where the door's own face stands.
 *
 * @test-facing what {@link shopFrontPartAt} answers, for `main-street.test.ts`
 */
export type ShopFrontPart = 'frame' | 'riser' | 'glass' | 'door';

/**
 * The part of a shop front `width` by `height` at `(u, v)`, metres across it
 * and up from the floor — #1590, the layout `three-renderer.ts`
 * §`withFacade` draws from the same numbers. The door is in its middle, as
 * the front door is in its wall's; either side of it the glass is split into
 * equal panes no wider than {@link SHOP_FRONT}'s `light`.
 *
 * @test-facing held by `main-street.test.ts`; the product draws it in the shader
 */
export function shopFrontPartAt(
  u: number,
  v: number,
  width: number,
  height: number,
): ShopFrontPart {
  const { frame, riser, sill, transom, mullion, light } = SHOP_FRONT;
  if (u < frame || u > width - frame || v > height - frame) return 'frame';
  const doorHalf = DOOR_FACE.width / 2;
  if (Math.abs(u - width / 2) <= doorHalf) return 'door';
  if (v < riser) return 'riser';
  if (v < riser + sill) return 'frame';
  if (v >= transom[0] && v <= transom[1]) return 'frame';
  // Either side of the door, equal panes between the surround and the door.
  const from = u < width / 2 ? frame : width / 2 + doorHalf;
  const span = width / 2 - doorHalf - frame;
  const panes = Math.max(1, Math.round(span / light));
  const t = ((u - from) / span) * panes;
  const off = Math.abs(t - Math.round(t)) * (span / panes);
  return off <= mullion / 2 ? 'frame' : 'glass';
}

/** The door's parts in its quad, as shares of it across and up. */
export const DOOR_IN_FACE = {
  surroundAcross: DOOR_SURROUND_METRES / DOOR_FACE.width,
  surroundUp: DOOR_SURROUND_METRES / DOOR_FACE.height,
  fanlight: (DOOR_FACE.height - DOOR_SURROUND_METRES - FANLIGHT_METRES) / DOOR_FACE.height,
} as const;

/**
 * A US double-hung sash window — #1588: **0.85 m by 1.45 m**, about 1 : 1.7,
 * its sill 0.9 m above its floor as #1581's is; its frame, and the meeting
 * rail where the two sashes meet.
 */
export const SASH = { width: 0.85, height: 1.45, frame: 0.07, rail: 0.05 } as const;

/**
 * Two sashes share a bay at least this wide, either side of a mullion:
 * **3.6 m**, #1581's bay, so about half of a town's bays are paired.
 */
export const PAIR_MIN_BAY_METRES = BAY_METRES;

/** The mullion between a pair of sashes: **0.1 m**. */
export const MULLION_METRES = 0.1;

/** A picture window — #1588: a sash's height, its bay's width less `margin`, and at most `most`. */
export const PICTURE = { most: 2.2, margin: 0.8 } as const;

/**
 * Shutters — #1588: each half its window's width, `gap` off the frame,
 * louvred every `louvre`; only where the pair of them leaves `margin` of the
 * bay either side.
 */
export const SHUTTER = { share: 0.5, gap: 0.03, louvre: 0.05, margin: 0.05 } as const;

/**
 * The inset reveal — #1588: how much of the light a reveal's side out of the
 * sun, and the glass in its shadow, lose (`shade`). Since #1659 the shadow's
 * depth is the sun's ({@link revealOf}); `head` and `jamb` are only the
 * shadow, down from the head and in from the sun-side jamb, of the sun that a
 * caller who names no view is answered for ({@link viewOf}).
 */
export const REVEAL = { head: 0.09, jamb: 0.07, shade: 0.55 } as const;

/**
 * How far every mapped window's glass is set behind its frame — #1659: a
 * procedural house's real recess, `buildings.ts` §`OPENING_RECESS_METRES`.
 */
export const REVEAL_DEPTH_METRES = OPENING_RECESS_METRES;

/**
 * The least the eye's slant onto a face is divided by — #1659: a face seen
 * edge-on shifts its glass by at most five times the recess, not without
 * bound.
 */
export const REVEAL_GRAZE = 0.2;

/** A dormer's window — #1588: a sash at most this wide and high, its sill this far up its front. */
export const DORMER_SASH = { width: 0.7, height: 1.1, sill: 0.2, margin: 0.15 } as const;

/**
 * A garage door's leaf — #1588: four sections high, panels about 0.6 m wide,
 * and the grooves between them.
 */
export const GARAGE_DOOR = { sections: 4, panel: 0.6, groove: 0.015, inset: 0.06 } as const;

/** The top of a sash, as a share of the storey: what the eaves rule tests. */
export const SASH_TOP_SHARE = (WINDOW_SILL_METRES + SASH.height) / STOREY_METRES;

/**
 * Clapboard — #1588: the share of each course under the next one's lap that
 * is in its shadow, and how dark; the butt's lit strip at a course's foot,
 * and how bright; how far a board's face tilts its normal up, and a butt's
 * shadow down; and the white paint the house paints are laid over
 * (`building-paint.ts` §`WALL_PAINTS`' render list, 0xf2f0ea).
 */
export const CLAPBOARD = {
  lapShadow: 0.16,
  shadowDepth: 0.45,
  butt: 0.07,
  buttBright: 0.1,
  tilt: 0.12,
  buttTilt: 0.5,
  white: linearFromSrgb(0xf2 / 255),
} as const;

/**
 * A clad lot's clapboard course — #1588: **0.125 m**, in the middle of
 * {@link CLAPBOARD}'s range; a lot carries no seeded course, as a mapped
 * house does.
 */
export const LOT_CLAPBOARD_COURSE_METRES = 0.125;

/**
 * Asphalt shingles — #1588: a tab's width (a third of a 1 m strip), the
 * keyway between tabs, the share of a course in the shadow of the course
 * above's butt, how dark that and a keyway are, and how much one tab's
 * granules differ from the next.
 */
export const SHINGLE = {
  tab: 1 / 3,
  keyway: 0.012,
  buttShadow: 0.15,
  shadowDepth: 0.35,
  keywayDepth: 0.55,
  variation: 0.24,
} as const;

/**
 * A foundation — #1588: a concrete block's and a brick's face, the mortar
 * joint, how far up a clapboard wall the band runs above the floor (so that
 * with the plinth's 0.3 m it is about 0.5 m), the shade the band is drawn in
 * on the wall — the plinth's own (`three-renderer.ts`' plinth shade, 0.62),
 * so the band and the plinth under it match — and the three colours, linear.
 */
export const FOUNDATION = {
  block: [0.4, 0.2],
  brick: [0.2, 0.075],
  mortar: 0.012,
  onWall: 0.2,
  bandShade: 0.62,
  blockColour: [0.45, 0.44, 0.41] as Rgb,
  brickColour: [0.4, 0.14, 0.09] as Rgb,
  mortarColour: [0.55, 0.53, 0.5] as Rgb,
} as const;

/** A driveway's paving — #1588: a slab's length, its joint, and its colour, linear. */
export const PAVING = { slab: 1.5, joint: 0.015, colour: [0.36, 0.35, 0.33] as Rgb } as const;

/**
 * The facade's ambient occlusion — #1588: a wall darkened under overhanging
 * eaves (to `eaves`, over `eavesMetres` below them) and at its foot (to
 * `base`, over `baseMetres` above the floor); a soffit's and a gutter's
 * underside darkened at its vertices (`soffit`), by `three-renderer.ts`;
 * and since #1589 a porch's deck, under its roof, darkened at its vertices
 * (`porchFloor`) — its ceiling is a soffit.
 */
export const FACADE_AO = {
  eaves: 0.7,
  eavesMetres: 0.6,
  base: 0.82,
  baseMetres: 0.4,
  soffit: 0.65,
  porchFloor: 0.72,
} as const;

/** The middle of `footprint-buildings.ts` §`ROOF_PITCHES_DEGREES`: the pitch the eaves' edge is placed for. */
const MIDDLE_PITCH_DEGREES =
  [...ROOF_PITCHES_DEGREES].sort((a, b) => a - b)[Math.floor(ROOF_PITCHES_DEGREES.length / 2)] ??
  35;

/**
 * The sun's own shadow under an overhang — #1658: in the shadow, a wall keeps
 * `shade` of its light, as #1659's reveal does ({@link REVEAL}'s `shade`), at
 * a sun square to it at the lowest sun the world has
 * (`world.ts` §`SUN_ELEVATION_AT_POLE_DEGREES`, whose cosine is `square`)
 * and less as the sun comes round to graze it: a wall the sun grazes has
 * little of its light to lose. `edge` is how far the eaves' edge is below the
 * wall's top: a pitched roof's overhang falls by its slope across
 * `footprint-buildings.ts` §`EAVES_OVERHANG_METRES`, and its fascia is
 * `ROOF_THICKNESS_METRES` deep under that. ⚠️ A wall's floats do not carry its
 * roof's pitch, so the edge is placed for the middle pitch: on the shallowest
 * roof it is 9 cm too low and on the steepest 12 cm too high.
 *
 * Since #1679 the two other overhangs' edges: `corniceRise`, how far a
 * cornice's lower edge is **above** the wall's top — the parapet's height
 * less the cornice's band (`footprint-buildings.ts` §`CORNICE`'s `depth`) —
 * and `awningEdge`, how far an awning's valance's foot, its lowest edge,
 * `AWNING`'s `drop` and `valance`, is below the shop front's top.
 */
export const OVERHANG_SHADOW = {
  shade: REVEAL.shade,
  square: Math.cos((SUN_ELEVATION_AT_POLE_DEGREES * Math.PI) / 180),
  edge:
    ROOF_THICKNESS_METRES +
    EAVES_OVERHANG_METRES * Math.tan((MIDDLE_PITCH_DEGREES * Math.PI) / 180),
  corniceRise: PARAPET_METRES - CORNICE.depth,
  awningEdge: AWNING.drop + AWNING.valance,
} as const;

/** GLSL's `smoothstep`, and with `lo === hi` a step at it. */
function smoothstep(lo: number, hi: number, x: number): number {
  if (!(hi > lo)) return x < lo ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/**
 * How far down a wall a horizontal edge `projection` metres proud of it
 * throws the sun's shadow — #1658: `projection · s.y / s.z`, with the sun
 * `sun` in the face's frame, at most the wall's height `wall`; none where the
 * sun is behind the face.
 *
 * @test-facing held by `overhang-shadows.test.ts`; the shader's `oylOverhangShadow`
 */
export function overhangShadowDepth(
  projection: number,
  sun: FaceDirection,
  wall = Number.POSITIVE_INFINITY,
): number {
  const [, up, out] = sun;
  if (!(out > 0)) return 0;
  return Math.min((projection * Math.max(up, 0)) / out, wall);
}

/**
 * How much of a point `below` metres under an overhang's edge is in its
 * shadow, 0 to 1 — #1658, the shader's `oylOverhangShadow`: all of it inside
 * {@link overhangShadowDepth}, none past it, softened over `pw`, the
 * fragment's footprint in metres, so that the edge is crisp near and never
 * crawls, and at a far fade is the footprint's mean.
 *
 * @test-facing held by `overhang-shadows.test.ts`; the product draws it in the shader
 */
export function overhangShadowAt(
  below: number,
  projection: number,
  sun: FaceDirection,
  pw = 0,
  wall = Number.POSITIVE_INFINITY,
): number {
  if (!(sun[2] > 0)) return 0;
  const depth = overhangShadowDepth(projection, sun, wall);
  return 1 - smoothstep(depth - pw, depth + pw, below);
}

/**
 * What share of its light a point `below` metres under an overhang's edge
 * `projection` metres proud keeps in the sun `sun` — #1679, #1658's rule for
 * every overhang, the shader's `oylOverhangShadeOf`: in the shadow
 * ({@link overhangShadowAt}) it keeps {@link OVERHANG_SHADOW}'s `shade` at a
 * sun square to the face at the lowest sun the world has, and more as the
 * sun comes round to graze the face; where the sun is behind it, all of it.
 *
 * @test-facing held by `overhang-shadows.test.ts`; the product draws it in the shader
 */
export function overhangShadeAt(
  below: number,
  projection: number,
  sun: FaceDirection,
  options: { readonly pw?: number; readonly wall?: number } = {},
): number {
  const strength =
    (1 - OVERHANG_SHADOW.shade) * Math.min(1, Math.max(0, sun[2] / OVERHANG_SHADOW.square));
  return 1 - strength * overhangShadowAt(below, projection, sun, options.pw ?? 0, options.wall);
}

/**
 * What share of its light a point `below` metres under a wall's top keeps
 * under a cornice — #1679: in the shadow of the cornice's lower edge,
 * {@link OVERHANG_SHADOW}'s `corniceRise` above the wall's top and
 * `footprint-buildings.ts` §`CORNICE`'s `projection` proud. A `below` under
 * nought is up the parapet's face, between the wall's top and the cornice.
 * `wall` is how far the edge is above the floor: the most the shadow reaches.
 *
 * @test-facing held by `overhang-shadows.test.ts`; the product draws it in the shader
 */
export function corniceShadeAt(
  below: number,
  sun: FaceDirection,
  options: { readonly pw?: number; readonly wall?: number } = {},
): number {
  return overhangShadeAt(below + OVERHANG_SHADOW.corniceRise, CORNICE.projection, sun, options);
}

/**
 * What share of its light a point `below` metres under a shop front's top
 * keeps under an awning `depth` metres deep — #1679: in the shadow of the
 * valance's foot, {@link OVERHANG_SHADOW}'s `awningEdge` under the top, as
 * deep as `depth · s.y / s.z`; all of it with no awning (`depth` 0). `wall`
 * is how far the edge is above the shop front's foot.
 *
 * @test-facing held by `overhang-shadows.test.ts`; the product draws it in the shader
 */
export function awningShadeAt(
  below: number,
  depth: number,
  sun: FaceDirection,
  options: { readonly pw?: number; readonly wall?: number } = {},
): number {
  if (!(depth > 0)) return 1;
  return overhangShadeAt(below - OVERHANG_SHADOW.awningEdge, depth, sun, options);
}

/**
 * What share of its light a point `below` metres under a wall's top keeps
 * under its eaves — #1658, the shader's §"3. The shade": #1588's soft band
 * ({@link FACADE_AO}'s `eaves` over `eavesMetres`) on a face the sun is behind,
 * and on one it lights the darker of that and the sun's shadow from the
 * eaves' edge ({@link OVERHANG_SHADOW}), {@link EAVES_OVERHANG_METRES} proud.
 * With `shadows` false, #1588's band alone on every face: the owner's
 * `-overhang-shadows`, which is `main` before #1658.
 *
 * @test-facing held by `overhang-shadows.test.ts`; the product draws it in the shader
 */
export function eavesShadeAt(
  below: number,
  sun: FaceDirection,
  options: { readonly pw?: number; readonly wall?: number; readonly shadows?: boolean } = {},
): number {
  const ao = 1 - (1 - FACADE_AO.eaves) * (1 - smoothstep(0, FACADE_AO.eavesMetres, below));
  if (options.shadows === false) return ao;
  return Math.min(
    ao,
    overhangShadeAt(below - OVERHANG_SHADOW.edge, EAVES_OVERHANG_METRES, sun, options),
  );
}

/**
 * A porch's railing — #1589: what shows between its rails and balusters, as
 * a share of its paint's light — the porch behind it, in its own shade.
 */
export const RAILING = { gapShade: 0.22 } as const;

/**
 * The share of a railing's face its rails and balusters cover: what it fades
 * to far off — #1589.
 *
 * @test-facing held by `front-porches.test.ts`; the shader computes the same
 * share per fragment from the face's height (`oylCover`)
 */
export function railingCover(height: number): number {
  const { rail, bottom, baluster, spacing } = FRONT_PORCH.railing;
  const between = Math.max(0, height - rail - bottom[1]);
  return Math.min(1, (rail + (bottom[1] - bottom[0]) + (between * baluster) / spacing) / height);
}

/**
 * What a point of a facade is. Since #1588 `shutter`, and `reveal`: glass in
 * the inset reveal's shadow. Since #1590 a shop front's `riser`, a sign band's
 * `panel`, and an awning's `canvas` and `stripe`; a shop door's recess is a
 * `reveal`. Since #1589 `rail`, `baluster` and `gap`: a porch railing's.
 * Since #1659 a `reveal` is also an opening's side, seen past its glass, and
 * `shadow` the wall in a sill's shadow.
 *
 * @test-facing what {@link facadePartAt} answers, for `facade.test.ts`
 */
export type FacadePart =
  | 'wall'
  | 'frame'
  | 'glass'
  | 'sill'
  | 'surround'
  | 'leaf'
  | 'fanlight'
  | 'paint'
  | 'shutter'
  | 'reveal'
  | 'panel'
  | 'riser'
  | 'stripe'
  | 'canvas'
  | 'rail'
  | 'baluster'
  | 'gap'
  | 'shadow';

/**
 * A face's style, as `footprint-buildings.ts` §`STYLE_FLOATS` carries it —
 * #1588 — and the side the sun is on along the face's `u` (1 toward
 * increasing `u`, −1 the other way, 0 in shade), which the shader reads from
 * its light. What {@link facadePartAt} is asked with; the product's style is
 * the vertex's four floats.
 */
export interface FacadeStyle {
  readonly flags: number;
  readonly width: number;
  readonly extra: number;
  readonly sun?: number;
  /** #1659: where the eye and the sun are, in the face's frame; {@link viewOf}'s if absent. */
  readonly view?: FacadeView;
}

/** A direction in a face's frame — #1659: along its `u`, up its `v`, and out of it. */
export type FaceDirection = readonly [along: number, up: number, out: number];

/**
 * Where a face is seen from and lit from — #1659: unit vectors toward the eye
 * and toward the sun in the face's frame, as the shader's `oylToEyeV` and
 * `oylToSunV` are read in `oylFaceU`, `oylFaceUp` and `oylFaceN`. What
 * {@link facadePartAt} is asked with; the product's view is the shader's own.
 */
export interface FacadeView {
  readonly eye: FaceDirection;
  readonly sun: FaceDirection;
}

/**
 * The view a style that names none is answered for — #1659: the face seen
 * square on, and the sun whose shadow is {@link REVEAL}'s `head` down from the
 * head and, on the side the style's `sun` names, its `jamb` in from that
 * jamb: #1588's fixed band, as one sun of the many the rule takes.
 */
function viewOf(style?: FacadeStyle): FacadeView {
  if (style?.view !== undefined) return style.view;
  const along = (style?.sun ?? 0) * REVEAL.jamb;
  const length = Math.hypot(along, REVEAL.head, REVEAL_DEPTH_METRES);
  return {
    eye: [0, 0, 1],
    sun: [along / length, REVEAL.head / length, REVEAL_DEPTH_METRES / length],
  };
}

/** A rectangle in metres on a face: its low and high corners, across and up. */
interface Opening {
  readonly lo: readonly [number, number];
  readonly hi: readonly [number, number];
}

/**
 * What a point `(x, y)` of an opening shows — #1659, the shader's
 * `oylRevealOf`: the glass at `(gx, gy)`, the point of it seen through
 * `(x, y)`, unless the eye's slant shows the opening's `side` there instead;
 * and whether that glass is `shaded`, in the shadow of the head or of the
 * sun-side jamb. `(x, y)` and the opening are metres on the face.
 */
function revealOf(
  x: number,
  y: number,
  opening: Opening,
  view: FacadeView,
): { readonly gx: number; readonly gy: number; readonly side: boolean; readonly shaded: boolean } {
  const [ex, ey, ez] = view.eye;
  const [sx, sy, sz] = view.sun;
  const slant = Math.max(ez, REVEAL_GRAZE);
  const gx = x - (REVEAL_DEPTH_METRES * ex) / slant;
  const gy = y - (REVEAL_DEPTH_METRES * ey) / slant;
  const { lo, hi } = opening;
  const side = gx < lo[0] || gx > hi[0] || gy < lo[1] || gy > hi[1];
  if (!(sz > 0)) return { gx, gy, side, shaded: false };
  const head = (REVEAL_DEPTH_METRES * Math.max(sy, 0)) / sz;
  const jamb = (REVEAL_DEPTH_METRES * Math.abs(sx)) / sz;
  const byJamb = sx > 0 ? gx > hi[0] - jamb : sx < 0 && gx < lo[0] + jamb;
  return { gx, gy, side, shaded: gy > hi[1] - head || byJamb };
}

/**
 * Whether a point `(x, y)` of the wall is in the shadow of a sill whose face
 * is `sill` — #1659: the sill stands {@link SILL}'s depth proud, so the sun
 * throws it that depth along its slant, down and across.
 */
function inSillShadow(x: number, y: number, sill: Opening, view: FacadeView): boolean {
  const [sx, sy, sz] = view.sun;
  if (!(sz > 0)) return false;
  const down = (SILL.depth * Math.max(sy, 0)) / sz;
  const across = (SILL.depth * sx) / sz;
  return (
    y < sill.lo[1] &&
    y >= sill.lo[1] - down &&
    x >= sill.lo[0] - Math.max(across, 0) &&
    x <= sill.hi[0] - Math.min(across, 0)
  );
}

/**
 * A curtain wall — #1636, in metres: the opaque `spandrel` at the foot of
 * each storey, the width of a `mullion` and of the transom over the
 * spandrel, and the `module` the mullions are spaced at, as near as a whole
 * number of them fits a bay; and its colours, linear: the glass, a dark pane
 * that gives back the sky, the spandrel's panel and the mullions' aluminium.
 */
export const CURTAIN_WALL = {
  spandrel: 0.9,
  mullion: 0.06,
  module: 1.5,
  glassColour: [0.03, 0.045, 0.06] as Rgb,
  spandrelColour: [0.11, 0.12, 0.13] as Rgb,
  mullionColour: [0.33, 0.34, 0.35] as Rgb,
} as const;

/**
 * The part of a curtain wall at `(x, y)` — #1636: `x` metres across a bay
 * `bay` wide, `y` metres up from its storey's floor. A mullion or the
 * transom is `frame`, the spandrel `panel`, and the rest `glass` — set
 * {@link REVEAL_DEPTH_METRES} behind the mullions, the transom and the next
 * storey's spandrel, so that, as every window kind since #1659, it shows a
 * `reveal` from the side and in the sun's shadow ({@link revealOf}); `view`
 * is {@link viewOf}'s where none is named.
 *
 * @test-facing held by `city-centre.test.ts`; the product draws it in the shader
 */
export function curtainWallPartAt(
  x: number,
  y: number,
  bay: number,
  view: FacadeView = viewOf(),
): FacadePart {
  const { spandrel, mullion, module } = CURTAIN_WALL;
  const modules = Math.max(1, Math.round(bay / module));
  const width = bay / modules;
  if (offWhole(x / width) * width <= mullion / 2) return 'frame';
  if (Math.abs(y - spandrel) <= mullion / 2) return 'frame';
  if (y < spandrel) return 'panel';
  const k = Math.floor(x / width);
  const opening: Opening = {
    lo: [k * width + mullion / 2, spandrel + mullion / 2],
    hi: [(k + 1) * width - mullion / 2, STOREY_METRES],
  };
  const seen = revealOf(x, y, opening, view);
  return seen.side || seen.shaded ? 'reveal' : 'glass';
}

/** A sash window's size and place in its face, in metres. */
interface Sash {
  readonly width: number;
  readonly height: number;
  readonly sill: number;
}

/**
 * The part of a sash window at `(x, y)` — metres across from the window's
 * middle, up from the floor — or none: the wall round it. `bay` is the
 * bay's width; `paired` lays two sashes either side of a mullion, `picture`
 * one wide pane with no rail; `shutters` asks for shutters where they fit;
 * since #1659 `view` is where the eye and the sun are ({@link revealOf}).
 */
function sashPartAt(
  x: number,
  y: number,
  sash: Sash,
  layout: {
    readonly bay: number;
    readonly paired: boolean;
    readonly picture: boolean;
    readonly shutters: boolean;
    readonly view: FacadeView;
  },
): FacadePart | undefined {
  const { width, height, sill } = sash;
  const { bay, paired, picture, shutters, view } = layout;
  const half = width / 2;
  const head = sill + height;
  // Across one window from its middle: a pair's folded about the mullion, outward positive.
  const across = paired ? Math.abs(x) - (half + MULLION_METRES / 2) : x;
  const span = paired ? width + MULLION_METRES / 2 : half;
  if (Math.abs(x) <= span && y >= sill && y <= head) {
    const inner = half - SASH.frame;
    if (!(Math.abs(across) <= inner && y >= sill + SASH.frame && y <= head - SASH.frame)) {
      return 'frame';
    }
    // #1659: across this one window, unfolded, so that its +u jamb is on its +u side.
    const local = paired ? x - Math.sign(x) * (half + MULLION_METRES / 2) : x;
    const opening: Opening = { lo: [-inner, sill + SASH.frame], hi: [inner, head - SASH.frame] };
    const seen = revealOf(local, y, opening, view);
    if (seen.side) return 'reveal';
    // The meeting rail is the sashes', behind the frame: where the glass is seen.
    if (!picture && Math.abs(seen.gy - (sill + height / 2)) <= SASH.rail / 2) return 'frame';
    return seen.shaded ? 'reveal' : 'glass';
  }
  if (shutters && !picture && y >= sill && y <= head) {
    const shutter = width * SHUTTER.share;
    const out = paired ? across : Math.abs(x);
    const fits = 2 * (span + SHUTTER.gap + shutter + SHUTTER.margin) <= bay;
    if (fits && out >= half + SHUTTER.gap && out <= half + SHUTTER.gap + shutter) return 'shutter';
  }
  if (Math.abs(x) <= span + SILL.overrun && y >= sill - SILL.depth && y < sill) return 'sill';
  const sillFace: Opening = {
    lo: [-span - SILL.overrun, sill - SILL.depth],
    hi: [span + SILL.overrun, sill],
  };
  return inSillShadow(x, y, sillFace, view) ? 'shadow' : undefined;
}

/**
 * The part of a facade at `(u, v)` on a face whose `top` and `skip` are as
 * `footprint-buildings.ts` §`FACADE_FLOATS` says — #1581's layout, which
 * `three-renderer.ts` §`withFacade` draws from the same numbers.
 *
 * @test-facing held by `facade.test.ts`; the product draws it in the shader
 */
export function facadePartAt(
  u: number,
  v: number,
  top: number,
  skip: number,
  style?: FacadeStyle,
): FacadePart {
  if (top === FACADE_PAINT) return 'paint';
  if (top === FACADE_SHOPFRONT) {
    // #1590: the style's width and its extra are the shop front's, in metres;
    // behind the door is its recess.
    const part = shopFrontPartAt(u, v, style?.width ?? 0, style?.extra ?? 0);
    return part === 'door' ? 'reveal' : part;
  }
  if (top === FACADE_SIGN) {
    // #1590: a plain panel in its moulding — the style's width and its height, metres.
    const width = style?.width ?? 0;
    const height = style?.extra ?? 0;
    const m = SIGN_MOULDING_METRES;
    return u < m || u > width - m || v < m || v > height - m ? 'frame' : 'panel';
  }
  if (top === FACADE_AWNING) {
    // #1590: striped where the style's flags say, plain canvas otherwise.
    const striped = (style?.flags ?? 0) !== 0;
    return striped && Math.floor(u / AWNING_STRIPE_METRES) % 2 === 1 ? 'stripe' : 'canvas';
  }
  if (top === FACADE_RAILING) {
    // #1589: `u, v` in metres along and up; the style's extra is the railing's height.
    const { rail, bottom, baluster, spacing } = FRONT_PORCH.railing;
    const height = style?.extra ?? 0;
    if (v >= height - rail || (v >= bottom[0] && v <= bottom[1])) return 'rail';
    const off = Math.abs(u / spacing - Math.round(u / spacing)) * spacing;
    return v > bottom[1] && off <= baluster / 2 ? 'baluster' : 'gap';
  }
  if (top === FACADE_GARAGE) {
    // #1588: `u, v` in metres; the style's width is the face's, its extra the leaf's height.
    const s = GARAGE.surround;
    const width = style?.width ?? 0;
    const leaf = style?.extra ?? 0;
    return u < s || u > width - s || v > leaf ? 'surround' : 'leaf';
  }
  if (top === FACADE_DORMER) {
    // #1588: one sash in the middle of the front, in metres.
    const width = style?.width ?? 0;
    const height = style?.extra ?? 0;
    const sash: Sash = {
      width: Math.min(DORMER_SASH.width, width - 2 * DORMER_SASH.margin),
      height: Math.min(DORMER_SASH.height, height - DORMER_SASH.sill - DORMER_SASH.margin),
      sill: DORMER_SASH.sill,
    };
    const layout = {
      bay: width,
      paired: false,
      picture: false,
      shutters: false,
      view: viewOf(style),
    };
    return sashPartAt(u - width / 2, v, sash, layout) ?? 'wall';
  }
  if (top === FACADE_DOOR && style !== undefined && (style.flags & STYLE_COMMERCIAL) !== 0) {
    // #1590: a shop's door — a glazed leaf in a frame, in a recess its surround's width deep.
    const { surroundAcross, surroundUp } = DOOR_IN_FACE;
    if (u < surroundAcross || u > 1 - surroundAcross || v > 1 - surroundUp) return 'reveal';
    const x = u * DOOR_FACE.width;
    const y = v * DOOR_FACE.height;
    const inner = DOOR_FACE.width - DOOR_SURROUND_METRES;
    const head = DOOR_FACE.height - DOOR_SURROUND_METRES;
    if (
      x < DOOR_SURROUND_METRES + SHOP_DOOR.frame ||
      x > inner - SHOP_DOOR.frame ||
      y < SHOP_DOOR.rail ||
      y > head - SHOP_DOOR.frame
    ) {
      return 'frame';
    }
    return 'glass';
  }
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
  if (style !== undefined && (style.flags & STYLE_GLAZED) !== 0) {
    // #1636: a tower's curtain wall, every storey up to the eaves.
    if (storey < 0 || v > top) return 'wall';
    return curtainWallPartAt(x * style.width, y * STOREY_METRES, style.width, viewOf(style));
  }
  const commercial = style !== undefined && (style.flags & STYLE_COMMERCIAL) !== 0;
  const w = commercial ? COMMERCIAL_WINDOW_IN_BAY : WINDOW_IN_BAY;
  const sash = style !== undefined && (style.flags & STYLE_SASH) !== 0;
  if (storey < 0 || storey + (sash ? SASH_TOP_SHARE : w.top) > top) return 'wall';
  if (storey === 0 && bay === skip) return 'wall';
  if (sash) {
    // #1588: in metres, from the bay's middle and the storey's floor.
    const picture = storey === 0 && bay === style.extra;
    const layout = {
      bay: style.width,
      paired: !picture && style.width >= PAIR_MIN_BAY_METRES,
      picture,
      shutters: (style.flags & STYLE_SHUTTERS) !== 0,
      view: viewOf(style),
    };
    const window: Sash = {
      width: picture ? Math.min(style.width - PICTURE.margin, PICTURE.most) : SASH.width,
      height: SASH.height,
      sill: WINDOW_SILL_METRES,
    };
    return sashPartAt((x - 0.5) * style.width, y * STOREY_METRES, window, layout) ?? 'wall';
  }
  // #1659: the window in metres, for its reveal — its bay as wide as the style lays it.
  const bayMetres = style !== undefined && style.width > 0 ? style.width : BAY_METRES;
  const view = viewOf(style);
  if (x >= w.left && x <= w.right && y >= w.bottom && y <= w.top) {
    const inside =
      x >= w.left + w.frameAcross &&
      x <= w.right - w.frameAcross &&
      y >= w.bottom + w.frameUp &&
      y <= w.top - w.frameUp;
    if (!inside) return 'frame';
    const opening: Opening = {
      lo: [(w.left + w.frameAcross) * bayMetres, (w.bottom + w.frameUp) * STOREY_METRES],
      hi: [(w.right - w.frameAcross) * bayMetres, (w.top - w.frameUp) * STOREY_METRES],
    };
    const seen = revealOf(x * bayMetres, y * STOREY_METRES, opening, view);
    if (seen.side) return 'reveal';
    // The mullion and the transom are the glazing's, behind the frame: where the glass is seen.
    const gx = seen.gx / bayMetres;
    const gy = seen.gy / STOREY_METRES;
    if (Math.abs(gx - 0.5) <= w.barAcross || Math.abs(gy - w.transom) <= w.barUp) return 'frame';
    return seen.shaded ? 'reveal' : 'glass';
  }
  if (
    x >= w.left - w.sillAcross &&
    x <= w.right + w.sillAcross &&
    y >= w.bottom - w.sillUp &&
    y < w.bottom
  ) {
    return 'sill';
  }
  const sillFace: Opening = {
    lo: [(w.left - w.sillAcross) * bayMetres, (w.bottom - w.sillUp) * STOREY_METRES],
    hi: [(w.right + w.sillAcross) * bayMetres, w.bottom * STOREY_METRES],
  };
  return inSillShadow(x * bayMetres, y * STOREY_METRES, sillFace, view) ? 'shadow' : 'wall';
}

/**
 * What a point of a face's cladding is — #1588.
 *
 * @test-facing what {@link claddingPartAt} answers, for `facade.test.ts`
 */
export type CladdingPart =
  | 'photograph'
  | 'board'
  | 'lap-shadow'
  | 'butt'
  | 'tab'
  | 'keyway'
  | 'course-shadow'
  | 'unit'
  | 'mortar'
  | 'slab'
  | 'joint';

/** How far `t` is from the nearest whole number. */
function offWhole(t: number): number {
  return Math.abs(t - Math.round(t));
}

/**
 * The part of a face's cladding at `(x, y)`, metres across and up it, for a
 * `clad` float as `footprint-buildings.ts` §`STYLE_FLOATS` carries it — #1588,
 * the layout `three-renderer.ts` §`withFacade` draws from the same numbers.
 *
 * @test-facing held by `facade.test.ts`; the product draws it in the shader
 */
export function claddingPartAt(clad: number, x: number, y: number): CladdingPart {
  const code = Math.floor(clad + 1e-4);
  const course = clad - code;
  switch (code) {
    case CLAD_CLAPBOARD: {
      const f = y / course - Math.floor(y / course);
      if (f >= 1 - CLAPBOARD.lapShadow) return 'lap-shadow';
      return f < CLAPBOARD.butt ? 'butt' : 'board';
    }
    case CLAD_SHINGLE: {
      const row = Math.floor(y / course);
      const f = y / course - row;
      const tab = x / SHINGLE.tab + 0.5 * (((row % 2) + 2) % 2);
      if (offWhole(tab) * SHINGLE.tab <= SHINGLE.keyway / 2) return 'keyway';
      return f >= 1 - SHINGLE.buttShadow ? 'course-shadow' : 'tab';
    }
    case CLAD_BLOCK:
    case CLAD_BRICK: {
      const [along, up] = code === CLAD_BLOCK ? FOUNDATION.block : FOUNDATION.brick;
      const row = Math.floor(y / up);
      const t = x / along + 0.5 * (((row % 2) + 2) % 2);
      const joint = FOUNDATION.mortar / 2;
      return offWhole(t) * along <= joint || offWhole(y / up) * up <= joint ? 'mortar' : 'unit';
    }
    case CLAD_PAVING:
      return offWhole(y / PAVING.slab) * PAVING.slab <= PAVING.joint / 2 ? 'joint' : 'slab';
    default:
      return 'photograph';
  }
}

/**
 * A mapped building's weathering — #1661: grime, streaks, drips, moss and the
 * wear of years, which break the photograph's repeat and its freshly rendered
 * look at no byte and no draw call. One constant an effect, the same for
 * every land use: how much grime a US small town wants is the research's open
 * question 7, which the owner answers on the look pair, and these move to
 * match. Every length is metres.
 *
 * - `youngest`: the share of every effect a building shows at age 0
 *   ({@link weatheringAgeOf}); at age 1 it shows all of it.
 * - `tile`: the photograph's light moved up to `strength` either way by
 *   world-space value noise at two `scales`, in `weights`, so that a brick's
 *   repeat no longer reads along a 20 m wall. No second texture fetch: IQ's
 *   two-fetch technique doubles wall texture bandwidth, #1523's scarce
 *   resource.
 * - `splash`: grime at a wall's foot, solid to `solid` of the way up a band
 *   whose top the noise breaks between `top`'s two heights, every `edge`
 *   along the wall; at full age it takes `strength` of the light and greys it
 *   by `grey`. It extends #1588's `FACADE_AO.base`, which stays.
 * - `streak`: under a window's sill, across its width, a darkening that falls
 *   off over `metres`, in columns `column` wide; `brick`'s share of it on
 *   brick and stone, which show less of it than render, concrete and paint.
 * - `drip`: down `metres` from a flat roof's parapet, in columns.
 * - `courses`: a pitched roof's lowest courses darkened, over `metres` up the
 *   slope from its eaves. Shingles keep #1588's `SHINGLE.variation`.
 * - `moss`: anything that faces up from `facing`, a roof, tinted toward
 *   `colour` where low-frequency noise at `scale` passes `cover`, thicker and
 *   thinner by noise at `detail`.
 * - `parging`: a render or concrete plinth lightened by `lighten` and
 *   roughened to `rough`: the parged band a rendered house stands on.
 */
export const WEATHERING = {
  youngest: 0.5,
  tile: { scales: [1.7, 4.3], weights: [0.6, 0.4], strength: 0.05 },
  splash: { top: [0.6, 1.0], solid: 0.4, edge: 0.45, strength: 0.35, grey: 0.35 },
  streak: { metres: 1.0, column: 0.04, strength: 0.22, brick: 0.5 },
  drip: { metres: 0.5, column: 0.06, strength: 0.22 },
  courses: { metres: 0.6, strength: 0.25 },
  moss: {
    scale: 8,
    detail: 0.8,
    cover: [0.45, 0.75],
    facing: [0.3, 0.6],
    strength: 0.35,
    colour: [0.05, 0.07, 0.025] as Rgb,
  },
  parging: { lighten: 0.12, rough: 0.95 },
} as const;

/**
 * One of {@link WEATHERING}'s effects, and what the twin needs to know of a point for it.
 *
 * @test-facing what {@link weatheringAt} is asked, for `weathering.test.ts`
 */
export type WeatheringTerm =
  | { readonly effect: 'tile' }
  | { readonly effect: 'splash'; readonly up: number }
  | {
      readonly effect: 'streak';
      /** Metres under the sill's foot, and across from the window's middle. */
      readonly below: number;
      readonly across: number;
      /** Half the sill's width. */
      readonly half: number;
      /** {@link streakShareOf}'s. */
      readonly share: number;
    }
  | { readonly effect: 'drip'; readonly below: number; readonly flat: boolean }
  | { readonly effect: 'courses'; readonly upSlope: number; readonly pitched: boolean }
  | { readonly effect: 'moss'; readonly facing: number }
  | { readonly effect: 'parging'; readonly parged: boolean };

/**
 * Where a point is, for {@link weatheringAt}: `plane`, its place in metres on
 * the plane the noise is laid in (along a wall and up it, or a roof's `x` and
 * `z`; for a streak and a drip, along the wall, where their columns are); its
 * building's `age` ({@link weatheringAgeOf}); and `pw`, its fragment's
 * footprint in metres, from which every term with detail fades to its mean
 * far off. Nought, or none, is near.
 *
 * @test-facing what {@link weatheringAt} is asked, for `weathering.test.ts`
 */
export interface WeatheringAt {
  readonly plane: readonly [number, number];
  readonly age: number;
  readonly pw?: number;
}

/**
 * What a term does to a point: `light`, what its light is multiplied by;
 * `grey`, the share it is moved toward its own luminance; and `moss`, the
 * share it is moved toward {@link WEATHERING}'s moss.
 *
 * @test-facing what {@link weatheringAt} answers, for `weathering.test.ts`
 */
export interface Weathered {
  readonly light: number;
  readonly grey: number;
  readonly moss: number;
}

/** GLSL's `fract`. */
function fractOf(x: number): number {
  return x - Math.floor(x);
}

/** GLSL's `mod`. */
function modOf(x: number, y: number): number {
  return x - y * Math.floor(x / y);
}

/** GLSL's `mix`. */
function mixOf(a: number, b: number, t: number): number {
  return a * (1 - t) + b * t;
}

/** The shader's `oylFadeOf`: nought near, 1 once a pattern is a few pixels across. */
function fadeOf(perPixel: number): number {
  return Math.min(1, Math.max(0, perPixel * 4 - 0.5));
}

/**
 * The weathering's hash, 0 to 1 — the shader's `oylWeatherHash`: a lattice
 * point's, its numbers folded under a thousand so that the sine is taken of
 * a number the GPU holds well. `weathering.test.ts` runs the shader's own
 * text against it.
 */
export function weatheringHash(a: number, b: number): number {
  return fractOf(Math.sin(modOf(a, 1000) * 127.1 + modOf(b, 1000) * 311.7) * 43758.5453);
}

/** Value noise, 0 to 1, smooth between whole numbers — the shader's `oylWeatherNoise`. Its mean is a half. */
function weatheringNoise(a: number, b: number): number {
  const ia = Math.floor(a);
  const ib = Math.floor(b);
  const fa = a - ia;
  const fb = b - ib;
  const ua = fa * fa * (3 - 2 * fa);
  const ub = fb * fb * (3 - 2 * fb);
  const lo = mixOf(weatheringHash(ia, ib), weatheringHash(ia + 1, ib), ua);
  const hi = mixOf(weatheringHash(ia, ib + 1), weatheringHash(ia + 1, ib + 1), ua);
  return mixOf(lo, hi, ub);
}

/**
 * A building's age, 0 to 1, from its seeded tint as the shader decodes it
 * (`vOylTint`: hue in radians, saturation, brightness) — #1661: seeded by
 * where the building is, so that lap two weathers it as lap one did. The
 * shader's `oylWeatherAgeOf`.
 *
 * @test-facing held by `weathering.test.ts`; the product computes it in the shader
 */
export function weatheringAgeOf(tint: readonly [number, number, number]): number {
  return weatheringHash(tint[0] * 1000, tint[1] * 1000 + tint[2] * 7000);
}

/** How much of an effect a building of `age` shows. */
function ageShareOf(age: number): number {
  return WEATHERING.youngest + (1 - WEATHERING.youngest) * age;
}

/**
 * How a building's photograph is laid on it — #1661: `turn`, 1 or −1 (a half
 * turn, so that a brick's courses stay level), and `shift`, how far it is
 * moved along each of its texture coordinates, in repeats; from its seeded
 * tint (`vOylTint`), so that neighbours wearing one photograph do not share
 * one brick's phase. The shader's `oylPhotoTurn` and `oylPhotoShift`, laid on
 * the map's and the normal map's coordinates in the vertex shader.
 *
 * @test-facing held by `weathering.test.ts`; the product lays it in the shader
 */
export function photographShiftOf(tint: readonly [number, number, number]): {
  readonly turn: number;
  readonly shift: readonly [number, number];
} {
  const [h, s, b] = tint;
  return {
    turn: weatheringHash(s * 1000 + 41, b * 1000) < 0.5 ? -1 : 1,
    shift: [weatheringHash(h * 1000 + 13, s * 1000), weatheringHash(b * 1000 + 29, h * 1000)],
  };
}

/**
 * How much of {@link WEATHERING}'s `streak` a wall of `surface` shows: all of
 * it on render, concrete, paint and clapboard (`clapboard`, whatever its
 * surface), `brick`'s share on brick and stone.
 */
export function streakShareOf(surface: string, clapboard = false): number {
  if (clapboard) return 1;
  return surface === 'brick' || surface === 'stone' ? WEATHERING.streak.brick : 1;
}

/** A streak's or a drip's columns: a multiplier whose mean is 1, faded to it over `pw` of a `width`. */
function columnOf(along: number, width: number, seed: number, pw: number): number {
  return mixOf(0.4 + 1.2 * weatheringHash(Math.floor(along / width), seed), 1, fadeOf(pw / width));
}

/**
 * What one of {@link WEATHERING}'s effects does to a point — #1661, the
 * shader's `oylWeather*` functions, from the same numbers. Every term with
 * detail fades to its mean with `pw`, as #1581's layout does, so that a far
 * wall neither shimmers nor changes its brightness as it fades.
 *
 * @test-facing held by `weathering.test.ts`; the product draws it in the shader
 */
export function weatheringAt(term: WeatheringTerm, at: WeatheringAt): Weathered {
  const [a, b] = at.plane;
  const pw = at.pw ?? 0;
  const share = ageShareOf(at.age);
  const none: Weathered = { light: 1, grey: 0, moss: 0 };
  switch (term.effect) {
    case 'tile': {
      const { scales, weights, strength } = WEATHERING.tile;
      const [near, far] = scales;
      const n1 = mixOf(weatheringNoise(a / near, b / near), 0.5, fadeOf(pw / near));
      const n2 = mixOf(weatheringNoise(a / far + 31.7, b / far + 11.3), 0.5, fadeOf(pw / far));
      return { ...none, light: 1 + 2 * strength * (weights[0] * n1 + weights[1] * n2 - 0.5) };
    }
    case 'splash': {
      const { top, solid, edge, strength, grey } = WEATHERING.splash;
      const broken = mixOf(weatheringNoise(a / edge, 7), 0.5, fadeOf(pw / edge));
      const height = mixOf(top[0], top[1], broken);
      const grime = share * (1 - smoothstep(solid * height, height, term.up));
      return { light: 1 - strength * grime, grey: grey * grime, moss: 0 };
    }
    case 'streak': {
      const { metres, column, strength } = WEATHERING.streak;
      const under = smoothstep(-pw, pw, term.below) * (1 - smoothstep(0, metres, term.below));
      const within = 1 - smoothstep(term.half - pw, term.half + pw, Math.abs(term.across));
      const dark = strength * term.share * share * under * within * columnOf(a, column, 5, pw);
      return { ...none, light: 1 - dark };
    }
    case 'drip': {
      if (!term.flat) return none;
      const { metres, column, strength } = WEATHERING.drip;
      const under = smoothstep(-pw, pw, term.below) * (1 - smoothstep(0, metres, term.below));
      return { ...none, light: 1 - strength * share * under * columnOf(a, column, 9, pw) };
    }
    case 'courses': {
      if (!term.pitched) return none;
      const { metres, strength } = WEATHERING.courses;
      return { ...none, light: 1 - strength * share * (1 - smoothstep(0, metres, term.upSlope)) };
    }
    case 'moss': {
      const { scale, detail, cover, facing, strength } = WEATHERING.moss;
      // Where it grows: patches `scale` across, wider than 18 pixels anywhere
      // inside a mapped building's 400 m reach, so with nothing to fade.
      const where = smoothstep(
        cover[0],
        cover[1],
        weatheringNoise(a / scale + 3.1, b / scale + 5.7),
      );
      // How thick, finer: a multiplier whose mean is 1, faded to it.
      const thick = mixOf(
        0.4 + 1.2 * weatheringNoise(a / detail + 8.3, b / detail + 1.9),
        1,
        fadeOf(pw / detail),
      );
      const up = smoothstep(facing[0], facing[1], term.facing);
      return { ...none, moss: strength * share * where * thick * up };
    }
    case 'parging':
      return term.parged ? { ...none, light: 1 + WEATHERING.parging.lighten } : none;
  }
}

/**
 * The room behind a mapped window's glass — #1662, by interior mapping (van
 * Dongen 2008): the eye's ray through the glass is followed into a box set
 * behind the pane in the face's frame, and the plane it meets — the back
 * wall, the floor, the ceiling or a side wall — is painted from a short
 * palette by a seed of the window's cell and its building. **No texture, no
 * cubemap and no atlas**: every plane is a flat paint, shaded by how deep it
 * is. Every length is metres.
 *
 * - `depth`: the back wall, behind the glass.
 * - `side`, `below`, `above`: the box's side walls `side` beyond the pane's
 *   either edge, its floor `below` the pane's foot (a sill's height) and its
 *   ceiling `above` its head. The box is the pane's own, so that every
 *   window kind — a sash, a casement, a shop's light, a fanlight — is asked
 *   the same way, with its glass's rectangle.
 * - `graze`: the least slant the eye's ray is followed at, so that a ray
 *   along the glass meets a side wall rather than dividing by nought.
 * - `backShade`: the light at the back wall, as a share of the light just
 *   behind the glass: a room is darker the deeper it is seen into.
 * - `sideWall`: how much light a side wall keeps against the back wall's,
 *   so that a corner reads.
 * - `blind`: the `share` of rooms with a blind drawn down from the pane's
 *   head, `drop` of the pane's height, in one of `paints`.
 * - `silhouette`: the `share` of rooms with a plain dark shape against the
 *   back wall — a cabinet, a sofa's back — `width` and `height` metres, in
 *   `paint`. **Never text, a logo, a poster or a brand** (#1590's ruling).
 * - `unlit` and `lit`: what the room's paints are multiplied by — a room
 *   lit only through its windows, a little cool, or a lit room, warm; both
 *   below 1, so the palette's paints bound every colour a room shows
 *   (`three-renderer.ts` §`LIT_COLOURS`).
 * - `fresnel`: Schlick's F0, glass's 0.04: the share of the environment a
 *   pane gives back head-on ({@link glassWeightsAt}).
 */
export const INTERIOR = {
  depth: 3.5,
  side: 0.9,
  below: 0.9,
  above: 0.35,
  graze: 0.02,
  backShade: 0.55,
  sideWall: 0.85,
  blind: {
    share: 0.3,
    drop: [0.12, 0.4],
    paints: [0xe8_e0_cc, 0xc9_c2_b2, 0x8a_7f_6c],
  },
  silhouette: { share: 0.3, width: [0.5, 1.3], height: [0.6, 1.4], paint: 0x2a_26_22 },
  unlit: [0.1, 0.105, 0.115] as Rgb,
  lit: [0.3, 0.22, 0.13] as Rgb,
  fresnel: 0.04,
} as const;

/** How many walls, floors and ceilings each of {@link INTERIOR_PALETTES} holds: **6**. */
export const INTERIOR_PAINTS = 6;

/**
 * The palettes a room is painted from — #1662: a home's, a shop's and an
 * office's, {@link INTERIOR_PAINTS} walls, floors and ceilings apiece, sRGB.
 * Picked by the room's seed ({@link interiorAt}); a wall window's room takes
 * an even wall in an even bay and an odd one in an odd bay ({@link roomSeedAt}),
 * so each palette's walls alternate warm and cool, light and dark of each:
 * two rooms side by side differ in hue whatever their seeds draw.
 */
export const INTERIOR_PALETTES = {
  home: {
    walls: [0xd9_cf_bb, 0xb8_c4_c0, 0xc8_b0_a0, 0x6f_7a_86, 0x9c_8f_7e, 0xc4_d0_d8],
    floors: [0x6b_4f_35, 0x8c_6a_46, 0x4a_3a_2e, 0x7b_74_6a, 0x9a_8a_70, 0x55_48_40],
    ceilings: [0xee_ea_e0, 0xe2_dc_cc, 0xd8_d6_d0, 0xf0_e8_d8, 0xe6_e2_da, 0xdc_d4_c4],
  },
  shop: {
    walls: [0xe8_dc_c4, 0xc4_cc_d0, 0xd8_c8_b8, 0xe8_ec_ee, 0xb0_a8_98, 0xa8_b0_b8],
    floors: [0x8c_86_7c, 0x5a_52_4a, 0xa8_a0_94, 0x70_60_50, 0x4c_4c_4c, 0x9c_90_80],
    ceilings: [0xee_ee_e8, 0xe8_e8_e4, 0xdc_dc_d8, 0xf0_ec_e0, 0xe4_e0_d8, 0xec_ec_ec],
  },
  office: {
    walls: [0xd8_d4_cc, 0xc0_c4_c8, 0xe0_dc_d4, 0xa8_ac_b0, 0xb8_b4_ac, 0xcc_d0_d4],
    floors: [0x5c_60_64, 0x74_70_6c, 0x4a_4e_54, 0x88_84_7c, 0x60_58_50, 0x6c_74_7c],
    ceilings: [0xec_ec_ea, 0xe0_e2_e4, 0xf0_ee_ea, 0xe4_e4_e0, 0xd8_da_dc, 0xee_ec_e6],
  },
} as const;

/** {@link INTERIOR_PALETTES}' order, as the shader's `palette` argument numbers them: 0, 1, 2. */
export const INTERIOR_PALETTE_ORDER = ['home', 'shop', 'office'] as const;

/**
 * One of {@link INTERIOR_PALETTES}.
 *
 * @test-facing what {@link interiorAt} is asked with; the shader numbers it ({@link INTERIOR_PALETTE_ORDER})
 */
export type InteriorPalette = (typeof INTERIOR_PALETTE_ORDER)[number];

/**
 * The seeds' salts — #1662: added to a window's cell before it is hashed, so
 * that a room's seed is not its lit hash ({@link litRoomAt}), and a dormer's,
 * a front door's hall's and a shop's are not a wall window's.
 */
export const INTERIOR_SALT = {
  room: [37, 11],
  dormer: [5, 9],
  hall: [23, 41],
  shop: [13, 29],
} as const;

/**
 * Which plane of the room's box a ray meets, or the blind drawn over the glass.
 *
 * @test-facing what {@link interiorAt} answers, for `facade.test.ts` and `window-rooms.test.ts`
 */
export type InteriorSurface = 'back' | 'floor' | 'ceiling' | 'left' | 'right' | 'blind';

/**
 * What one point of a pane shows of the room behind it — #1662: the
 * `surface` the eye's ray meets, how `deep` behind the glass it meets it, in
 * metres, and its colour, linear, before the glass's Fresnel weight
 * ({@link glassWeightsAt}).
 *
 * @test-facing what {@link interiorAt} answers, for `facade.test.ts`
 */
export interface InteriorHit {
  readonly surface: InteriorSurface;
  readonly deep: number;
  readonly colour: Rgb;
}

/**
 * The hash a window is seeded by — #1581's, the shader's `oylWindowHash`:
 * `fract(sin(dot(cell, (12.9898, 78.233))) · 43758.5453)`. In double
 * precision here, so its values are not the GPU's for large arguments; its
 * share below a threshold is.
 */
function windowHash(x: number, y: number): number {
  return fractOf(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453);
}

/**
 * Whether the window in bay `cell` of a building of seeded `tint` is a lit
 * room — #1581's one in five, the shader's `oylLit`: its hash at least 0.8.
 *
 * @test-facing held by `facade.test.ts`; the product computes it in the shader
 */
export function litRoomAt(
  cell: readonly [number, number],
  tint: readonly [number, number, number],
): boolean {
  return (
    windowHash(cell[0] + Math.floor(tint[0] * 1000), cell[1] + Math.floor(tint[1] * 1000)) >= 0.8
  );
}

/**
 * The seed of the room behind the window in bay `cell` of a building of
 * seeded `tint` — #1662, the shader's `oylRoomSeedOf`: the window's hash with
 * {@link INTERIOR_SALT}'s `room`, so that it is not its lit hash; laid so
 * that its wall paint ({@link roomPaintOf}) is one of the palette's even
 * entries in an even bay and one of its odd entries in an odd bay, so two
 * rooms side by side on a storey never share a wall paint.
 *
 * @test-facing held by `facade.test.ts`; the product computes it in the shader
 */
export function roomSeedAt(
  cell: readonly [number, number],
  tint: readonly [number, number, number],
): number {
  const [sx, sy] = INTERIOR_SALT.room;
  const hash = windowHash(
    cell[0] + Math.floor(tint[0] * 1000) + sx,
    cell[1] + Math.floor(tint[1] * 1000) + sy,
  );
  const half = INTERIOR_PAINTS / 2;
  return (2 * Math.floor(hash * half) + modOf(cell[0], 2) + fractOf(hash * half)) / INTERIOR_PAINTS;
}

/** Draw `k` of a room of `seed`, 0 to 1 — the shader's `oylRoomDraw`: small arguments, so the GPU's sine holds them. */
function roomDraw(seed: number, k: number): number {
  return windowHash(seed * 61, k);
}

/** A `0xRRGGBB` sRGB colour, linear. */
export function interiorLinear(hex: number): Rgb {
  return [
    linearFromSrgb(((hex >> 16) & 0xff) / 255),
    linearFromSrgb(((hex >> 8) & 0xff) / 255),
    linearFromSrgb((hex & 0xff) / 255),
  ];
}

/** Entry `draw` (0 to 1) of `paints`, as the shader's `int(draw · n)` picks it. */
function pickOf(paints: readonly number[], draw: number): number {
  return paints[Math.min(paints.length - 1, Math.floor(draw * paints.length))] as number;
}

/**
 * The wall paint of a room of `seed` in `palette` — #1662, its sRGB: what
 * two neighbouring rooms are told apart by.
 *
 * @test-facing held by `facade.test.ts`; the product picks it in the shader
 */
export function roomPaintOf(seed: number, palette: InteriorPalette = 'home'): number {
  return pickOf(INTERIOR_PALETTES[palette].walls, seed);
}

/**
 * What a point of a pane shows of the room behind it — #1662, the shader's
 * `oylInterior`, from the same numbers. `pane` is the point on the glass, in
 * metres from the pane's middle across and up the face; `size` the glass's
 * width and height; `eye` the unit direction toward the eye in the face's
 * frame ({@link FaceDirection}); `seed` the room's ({@link roomSeedAt});
 * `lit` whether it is a lit room ({@link litRoomAt}).
 *
 * The ray runs from the point away from the eye, into the face; it meets the
 * back wall {@link INTERIOR}'s `depth` behind the glass unless a side wall,
 * the floor or the ceiling is nearer along it. "Right" is the box's `+u`
 * side, as the reveal's right-hand jamb is.
 *
 * @test-facing held by `facade.test.ts`; the product draws it in the shader
 */
export function interiorAt(
  pane: readonly [number, number],
  size: readonly [number, number],
  eye: FaceDirection,
  seed: number,
  palette: InteriorPalette,
  lit: boolean,
): InteriorHit {
  const [x, y] = pane;
  const [w, h] = size;
  const [ex, ey, ez] = eye;
  const { depth, side, below, above, graze, backShade, sideWall, blind, silhouette } = INTERIOR;
  const paints = INTERIOR_PALETTES[palette];
  const light = lit ? INTERIOR.lit : INTERIOR.unlit;
  const shaded = (hex: number, share: number, deep: number): Rgb => {
    const linear = interiorLinear(hex);
    const fall = mixOf(1, backShade, Math.min(deep / depth, 1)) * share;
    return [linear[0] * light[0] * fall, linear[1] * light[1] * fall, linear[2] * light[2] * fall];
  };
  // A blind, drawn down from the pane's head on the glass itself.
  if (roomDraw(seed, 5) < blind.share) {
    const drop = mixOf(blind.drop[0], blind.drop[1], roomDraw(seed, 6));
    if (y > h / 2 - drop * h) {
      const paint = pickOf(blind.paints, roomDraw(seed, 7));
      return { surface: 'blind', deep: 0, colour: shaded(paint, 1, 0) };
    }
  }
  const halfW = w / 2 + side;
  const floor = -(h / 2 + below);
  const ceiling = h / 2 + above;
  // Into the room: away from the eye.
  const dx = -ex;
  const dy = -ey;
  const dz = Math.max(ez, graze);
  const tBack = depth / dz;
  const tSide = dx > 0 ? (halfW - x) / dx : dx < 0 ? (-halfW - x) / dx : Number.POSITIVE_INFINITY;
  const tUp = dy > 0 ? (ceiling - y) / dy : dy < 0 ? (floor - y) / dy : Number.POSITIVE_INFINITY;
  const t = Math.min(tBack, tSide, tUp);
  const deep = t * dz;
  if (tSide <= t) {
    const surface = dx > 0 ? 'right' : 'left';
    return { surface, deep, colour: shaded(pickOf(paints.walls, seed), sideWall, deep) };
  }
  if (tUp <= t) {
    return dy > 0
      ? {
          surface: 'ceiling',
          deep,
          colour: shaded(pickOf(paints.ceilings, roomDraw(seed, 2)), 1, deep),
        }
      : {
          surface: 'floor',
          deep,
          colour: shaded(pickOf(paints.floors, roomDraw(seed, 1)), 1, deep),
        };
  }
  // The back wall, and a plain dark shape against it on a seeded share.
  if (roomDraw(seed, 3) < silhouette.share) {
    const width = mixOf(silhouette.width[0], silhouette.width[1], roomDraw(seed, 4));
    const height = mixOf(silhouette.height[0], silhouette.height[1], roomDraw(seed, 8));
    const left = mixOf(-halfW, halfW - width, roomDraw(seed, 9));
    const bx = x + dx * t;
    const by = y + dy * t;
    if (bx >= left && bx <= left + width && by <= floor + height) {
      return { surface: 'back', deep, colour: shaded(silhouette.paint, 1, deep) };
    }
  }
  return { surface: 'back', deep, colour: shaded(pickOf(paints.walls, seed), 1, deep) };
}

/**
 * How much of the environment and of the room a pane shows, seen `cosine`
 * off its normal (the eye's `out` in the face's frame) — #1662: Schlick's
 * Fresnel with {@link INTERIOR}'s F0, the environment weighted by it and the
 * room by what is left. Head-on a pane is the room; at a graze, the sky.
 *
 * @test-facing held by `facade.test.ts`; the product weights it in the shader
 */
export function glassWeightsAt(cosine: number): {
  readonly environment: number;
  readonly room: number;
} {
  const off = 1 - Math.min(Math.max(cosine, 0), 1);
  const environment = INTERIOR.fresnel + (1 - INTERIOR.fresnel) * off ** 5;
  return { environment, room: 1 - environment };
}
