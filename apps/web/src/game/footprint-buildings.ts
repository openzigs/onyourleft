// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A mapped building, planned from its footprint — #1540, ADR 0054 D-5 and D-7.
 *
 * For every footprint in the ride's corridor (`world-data/corridor.ts`, #1539)
 * that passes the placement rules, a plan: walls extruded from the footprint,
 * a plinth that meets the drawn ground, a roof, a door on the wall nearest the
 * road, and the surfaces they wear — triangles by role, the same kind of thing
 * `buildings.ts` §`BuildingPlan` is, naming no rendering library. A footprint
 * is unique, so unlike `buildings.ts`' kinds it cannot be instanced: #1549
 * merges these plans per surface and draws them, and this file only makes them.
 *
 * Plans are built **once, at ride start**, never per frame: `GameView` makes
 * them at the press, and `mapped-buildings.ts` indexes them for #1549's belt.
 * Since #1550 the ride also reads their footprints ({@link mappedTown}): a
 * procedural lot keeps clear of every kept one.
 *
 * ## The placement rules (#1538's P-9), in order
 *
 * The first a footprint fails is its verdict, and every verdict is counted
 * ({@link FootprintVerdicts}) so a review sees what the rules drop:
 *
 * 1. **Kind.** `building` and `building_part`; a `building_part` with a
 *    `min_height` stands on that height and has no plinth.
 * 2. **Land** (#1546): any of the centroid and the footprint's vertices on a
 *    mapped wood, water or park, and it is dropped — `on-excluded-land`. A
 *    building inside a mapped park is dropped deliberately: the owner's rule
 *    (ADR 0054 D-5.2) is categorical, and D-5.2's one possible exception is
 *    not taken.
 * 3. **The road** (D-5.4): any edge within `landform.ts`
 *    §`ROAD_CLEARANCE_METRES` of ANY stretch of the drawn road, and it is
 *    dropped — `on-road`. The `settlements.ts` §`footprintClearance` measure,
 *    generalised to a polygon: on a hairpin a footprint beside one leg may
 *    reach the other, which is #468's defect.
 * 4. **The ground**: the plinth runs from the lowest drawn ground under the
 *    footprint (`landform.ts` §`terrainHeightAt` at every vertex and the
 *    centroid, the surface the renderer's ground is built from) less
 *    `buildings.ts` §`FOUNDATION_METRES`. Ground that varies by more than
 *    {@link FOOTPRINT_MAX_GROUND_RANGE_METRES} under it — after #1547 has
 *    levelled built-up land — and it is dropped: `too-steep`.
 * 5. **Size**: under {@link FOOTPRINT_MIN_AREA} m², a shed the map drew, is
 *    `too-small`; over {@link FOOTPRINT_MAX_AREA} m² is `too-large`.
 * 6. **Simplified** to at most {@link FOOTPRINT_MAX_VERTICES} outer vertices
 *    (`simplifyRing`, {@link FOOTPRINT_SIMPLIFY_METRES} and raised until it
 *    fits). Its holes are kept if the plan still fits its budget, and filled
 *    otherwise. ⚠️ The simplified ring is what rules 3 and 4 measure, since it
 *    is what is drawn; rule 2 reads every vertex of the ring as mapped.
 *
 * ## The shape (P-10, P-11; the owner's ruling of 2026-10-21 on #1540)
 *
 * Storeys are the mapped `height` over {@link STOREY_METRES}, rounded, and at
 * least one; two where the height is missing; `L` where the height is
 * Protomaps' levels-derived `3L + 2` (#1629, {@link storeysFor}). The eaves
 * stand at the mapped height where there is one and at the storeys' where
 * there is not. The roof
 * is a gable along the long axis of the footprint's minimum-area rectangle
 * where the footprint is small, rectangular, low and residential or farmland
 * ({@link FOOTPRINT_GABLE_MAX_AREA}, {@link FOOTPRINT_GABLE_MIN_RECTANGULARITY},
 * {@link FOOTPRINT_GABLE_MAX_EAVES_METRES}), and flat behind a
 * {@link PARAPET_METRES} parapet otherwise. **No windows are cut**: a
 * footprint can have forty walls, and the openings `buildings.ts` cuts would
 * not fit in {@link FOOTPRINT_MAX_TRIANGLES}.
 *
 * ## The detail (#1581, the owner's ruling of 2026-10-22)
 *
 * #1549 drew these plans as boxes, and the owner's verdict was that they
 * "look terrible and do not have enough variety". Since #1581:
 *
 * - **Windows and a front door, in no triangle.** Every wall vertex carries
 *   its place in whole bays and storeys and where the eaves are
 *   ({@link FACADE_FLOATS}), and `three-renderer.ts` §`withFacade` draws a
 *   window in every bay of every storey from `facade.ts`' layout, and the
 *   door and its surround on the door's quad ({@link DOOR_FACE}). No window
 *   stands behind the door, nor above the eaves.
 * - **The roof's shape**, seeded: a gable or a hip ({@link HIP_SHARE}) at one
 *   of {@link ROOF_PITCHES_DEGREES}, overhanging at the eaves and the verges,
 *   with painted soffits and fascias (`trim`).
 * - **A chimney** on most pitched houses ({@link CHIMNEY_SHARE}) and **a
 *   canopy over the front door** on about half, on posts or brackets
 *   ({@link PORCH_SHARE}), only where it stands clear of the road.
 * - **Paint**, seeded per plan from its footprint and never a neighbour's
 *   (`paintTown`, {@link PAINT_NEIGHBOUR_METRES}): `building-paint.ts`.
 *
 * ## The US house (#1588, the owner's ruling of 2026-10-22)
 *
 * A residential plan is drawn as a US house, mostly in the shader, so that it
 * costs no download. Each vertex carries its face's cladding and its windows'
 * style ({@link STYLE_FLOATS}) besides its facade:
 *
 * - **Clapboard** on most houses' walls ({@link SIDING_SHARE}), its courses
 *   {@link CLAPBOARD_COURSE_METRES} apart, seeded, in `render`'s eight house
 *   paints; brick and render stay for the rest and for every other use.
 * - **Asphalt shingles** on most pitched roofs ({@link SHINGLE_SHARE}), in
 *   `building-paint.ts` §`SHINGLE_PAINTS`; clay tile and slate for the rest.
 * - **Double-hung sash windows** on every residential wall, paired in a wide
 *   bay, a picture window beside the door of some single-storey houses
 *   ({@link PICTURE_SHARE}), and shutters on some ({@link SHUTTER_SHARE}):
 *   `facade.ts` lays them out.
 * - **A foundation band** of block or brick under a clapboard house.
 * - **A garage** on some wide fronts ({@link GARAGE_SHARE}): a panelled door
 *   over an end bay of the front, and a driveway from it to the road's edge,
 *   kept off every other footprint.
 * - **Gutters and a downpipe** under a pitched roof's eaves, and **dormers**
 *   on a steep one ({@link DORMER_MIN_PITCH_DEGREES}).
 *
 * The near level stays inside {@link FOOTPRINT_MAX_TRIANGLES} and the far
 * level, walls and roof, inside {@link FOOTPRINT_MAX_FAR_TRIANGLES}: a house's
 * detail is about 40 triangles, and since #1588 about 60 more — gutters, a
 * downpipe, dormers, a garage door and a driveway — and none of it is on the
 * far level but the roof's overhang.
 *
 * ## The main street (#1590, the owner's ruling of 2026-10-22)
 *
 * A commercial plan — land the map calls retail, commercial or anything
 * built up but houses and industry ({@link footprintUse}) — is drawn as a
 * main-street shop, mostly in the shader, so it costs no download:
 *
 * - **Its windows** are taller ({@link STYLE_COMMERCIAL}, `facade.ts`
 *   §`COMMERCIAL_WINDOW`), every storey.
 * - **A shop front** over the ground storey of the wall the door is on, where
 *   that wall is at least {@link SHOP_FRONT_MIN_WALL_METRES} long: one quad,
 *   a centimetre proud ({@link FACADE_SHOPFRONT}), on which the shader draws
 *   glass across most of the wall, a stall riser, mullions and a transom; the
 *   door in its middle is a shop's glazed door in a recess.
 * - **A sign band** over it ({@link FACADE_SIGN}): one quad, a plain panel in
 *   a seeded `building-paint.ts` §`SIGN_PAINTS` in its moulding. **No text,
 *   brand or logo.**
 * - **An awning** on a seeded share of shop fronts ({@link AWNING}'s
 *   `share`): a sloped canvas quad, its underside, a valance and two cheeks,
 *   striped or plain ({@link FACADE_AWNING}), and none where it would reach
 *   the road's clearance.
 * - **A cornice** along the top of its flat roof's parapet ({@link CORNICE}),
 *   in the trim's paint: a front, a soffit and a top along each outer wall,
 *   so about 24 triangles on a rectangle; dropped from a plan it would put
 *   past {@link FOOTPRINT_MAX_TRIANGLES}.
 *
 * The shop front, the sign and the awning are `shopfront`, which wears the
 * walls and is painted by the shader alone; the cornice is `trim`. None of it
 * is on the far level.
 *
 * ## The front porch (#1589, the owner's ruling of 2026-10-22)
 *
 * About half of the residential houses with a front door have a **front
 * porch** round it ({@link FRONT_PORCH}'s `share`, seeded per footprint), laid
 * out by `porch.ts`: a deck at the floor's height, three or four posts under
 * a header, a shed or hip roof tied to the wall under the eaves, a railing
 * whose rails and balusters the shader draws ({@link FACADE_RAILING}), and two
 * or three steps down to the ground. It replaces #1581's canopy, keeps clear
 * of the garage's bay, and keeps #1540's road clearance: a porch that would
 * reach within {@link ROAD_CLEARANCE_METRES} of the drawn road is shortened,
 * and dropped where it still would ({@link frontPorchOf}). Its roof is
 * `porch-roof` and wears the house's roof; its steps and fascia are
 * `porch-trim`, and the rest is `porch`, all painted in the trim. About 75 to
 * 100 triangles, none of them on the far level.
 *
 * ⚠️ **A porch's triangles are written the first time they are read**, not at
 * the press ({@link FootprintPlan.triangles}): writing them was a third of
 * #1540's 400 ms town (`corridor.browser.spec.ts`), 1 041 porches in its
 * 2 000 footprints, where the most a refill reads is a few dozen. Whether a
 * plan has one, and how many triangles, is decided at the press like
 * everything else.
 *
 * ## The surfaces
 *
 * By the land use under the centroid ({@link FootprintUse}, from `land-class.ts`
 * §`kindAt`), with #1548's town surfaces (`render`, `concrete`, `flat-roof`) in
 * the places #1548 named: {@link wallSurfaceOf}, {@link roofSurfaceOf}.
 *
 * ## Bounded
 *
 * The plans are bounded by the corridor's buildings, which #1544 bounds at
 * 60 000 a corridor, and each plan by {@link FOOTPRINT_MAX_TRIANGLES}. No
 * coordinate is formatted into any string here.
 */

import type { RouteProfile } from '@onyourleft/domain';
import {
  simplifyRing,
  triangulate,
  type BuildingFeature,
  type Ring,
} from '@onyourleft/map-features';

import {
  AWNING_PAINTS,
  DOOR_PAINTS,
  paintsOf,
  roofPaintsOf,
  SHINGLE_SHARE,
  SIDING_SHARE,
  SIGN_PAINTS,
  TRIM_PAINTS,
} from './building-paint';
import { DOOR, FOUNDATION_METRES, PLINTH_TOP_METRES } from './buildings';
import {
  FRONT_PORCH,
  hipFits,
  porchPieces,
  porchPitchOf,
  porchReachOf,
  porchSpanOf,
  porchStepsOf,
  porchTriangleCount,
  type PorchPiece,
  type PorchPoint,
  type PorchSpec,
} from './porch';
import { frontOf, houseModelsFitting, placeHouseModel, type HousePlacement } from './house-models';
import { MASONRY_TINT, packedInstanceTint } from './instance-tint';
import { kindAt, type LandClass, type LandClassMask } from './land-class';
import { ROAD_CLEARANCE_METRES, terrainHeightAt } from './landform';
import { REALISTIC_TRIANGLES } from './realistic-budget';
import type { StructureSurface } from './realistic-assets';
import {
  nearestOnRoadSegments,
  roadSegmentsNear,
  squaredToSegment,
  type BesideTheRoad,
  type DrawnRoadPoints,
} from './road-grid';
import { scatterSeed } from './scatter';
import { footprintIndexOf, type MappedTown } from './settlements';
import { slotHash, uniformFrom } from './seeded';
import { ROAD_WIDTH_METRES, type CorridorOrigin } from './terrain';
import type { UrbanClass, UrbanClassMap } from './urban-class';
import type { WorldCorridor } from './world-data/corridor';

/** What became of a footprint: planned, or the rule that dropped it. */
export type FootprintVerdict =
  'kept' | 'on-excluded-land' | 'on-road' | 'too-steep' | 'too-small' | 'too-large';

/**
 * Every verdict, in the rules' order.
 *
 * @test-facing held by `footprint-buildings.test.ts`, which names each verdict
 * the fixture comes to; the ride reads only the kept plans
 */
export const FOOTPRINT_VERDICTS: readonly FootprintVerdict[] = [
  'kept',
  'on-excluded-land',
  'on-road',
  'too-steep',
  'too-small',
  'too-large',
];

/** How many footprints came to each verdict. */
export type FootprintVerdicts = Readonly<Record<FootprintVerdict, number>>;

/**
 * The parts a plan's triangles are made of — #1549 dresses each by its
 * surface. Since #1581: `chimney`, a stack on a pitched house, and `trim`, the
 * painted timber — a roof's soffits and fascias, and a porch. Since #1588:
 * `dormer`, a dormer's front and cheeks, which wear the walls; `dormer-roof`,
 * its roof, which wears the roof; and `driveway`, the paved strip from a
 * garage to the road, which the shader paints. A garage's door is a `door`,
 * and the gutters and the downpipe are `trim`. Since #1589: `porch`, a front
 * porch's deck, ceiling, posts and railing, painted and wearing the walls;
 * `porch-roof`, its roof, which wears the roof; and `porch-trim`, its steps
 * and its fascia, painted in the trim as `trim` is. Since #1590: `shopfront`, a
 * shop's front, its sign band and its awning, which wear the walls and which
 * the shader paints; a commercial roof's cornice is `trim`.
 */
export type FootprintRole =
  | 'wall'
  | 'plinth'
  | 'roof'
  | 'parapet'
  | 'door'
  | 'chimney'
  | 'trim'
  | 'dormer'
  | 'dormer-roof'
  | 'driveway'
  | 'shopfront'
  | 'porch'
  | 'porch-roof'
  | 'porch-trim';

/** Every {@link FootprintRole}, in a fixed order. */
export const FOOTPRINT_ROLES: readonly FootprintRole[] = [
  'wall',
  'plinth',
  'roof',
  'parapet',
  'door',
  'chimney',
  'trim',
  'dormer',
  'dormer-roof',
  'driveway',
  'shopfront',
  'porch',
  'porch-roof',
  'porch-trim',
];

/**
 * A front porch's roles — #1589, written the first time they are read
 * ({@link FootprintPlan.triangles}).
 */
export const PORCH_ROLES: readonly PorchRole[] = ['porch', 'porch-roof', 'porch-trim'];

/** One of {@link PORCH_ROLES}. */
export type PorchRole = Extract<FootprintRole, 'porch' | 'porch-roof' | 'porch-trim'>;

/** The roles that wear a plan's roof surface — #1588, #1589; every other wears its wall surface. */
export const ROOF_ROLES: ReadonlySet<FootprintRole> = new Set([
  'roof',
  'dormer-roof',
  'porch-roof',
]);

/**
 * What a vertex tells the facade shader — #1581, four floats: `u` and `v`,
 * then `top` and `skip`. `three-renderer.ts` §`withFacade` draws from them,
 * so a window costs no triangle, no texture and no draw call.
 *
 * - **`top > 0`, a windowed wall.** `u` counts bays round the wall, a window
 *   in each, every wall's bays a whole number laid end to end
 *   ({@link baysOf}); `v` counts storeys up from the floor. A window stands
 *   in every bay of every storey whose window top is at most `top` storeys up,
 *   which is the eaves — so none is cut by a roof. On the ground storey,
 *   bay `skip` has none: the front door is there (−1 where it is not).
 * - **`top = 0`, plain**: the photograph and nothing on it.
 * - **`top = −1`, a door**: `u` and `v` across its quad, `[0, 1]`, which
 *   holds the leaf and its surround ({@link DOOR_SURROUND_METRES}).
 * - **`top = −2`, paint**: the trim's colour in place of the photograph.
 * - **`top = −3`, a dormer's front**, and **`top = −4`, a garage's door**
 *   (#1588): `u` and `v` in metres across the face and up it, from its
 *   lower left corner; the style says how wide and how high
 *   ({@link STYLE_FLOATS}).
 * - **`top = −6`, a shop front; `−7`, a sign band; `−8`, an awning** (#1590):
 *   `u` and `v` in metres across the face and up it (down an awning's slope);
 *   the style's `width` is the face's width, and its `extra` a shop front's or
 *   a sign's height, or an awning's paint; a sign's `flags` are its paint, and
 *   an awning's 1 where it is striped.
 * - **`top = −5`, a porch's railing** (#1589): `u` and `v` in metres along
 *   it and up it; the style's `width` is its length and its `extra` its
 *   height.
 *
 * On a plain face whose cladding has courses (`clad` ≥ {@link CLAD_SHINGLE}),
 * `u` and `v` are metres across and up the face too: along a roof's eaves and
 * up its slope, along a plinth and down from the floor, across a driveway and
 * along it. A clapboard wall's are the bays and storeys above.
 */
export const FACADE_FLOATS = 4;

/** `top` of a plain face. @see FACADE_FLOATS */
export const FACADE_PLAIN = 0;
/** `top` of a door's face. @see FACADE_FLOATS */
export const FACADE_DOOR = -1;
/** `top` of a painted face. @see FACADE_FLOATS */
export const FACADE_PAINT = -2;
/** `top` of a dormer's front — #1588. @see FACADE_FLOATS */
export const FACADE_DORMER = -3;
/** `top` of a garage's door — #1588. @see FACADE_FLOATS */
export const FACADE_GARAGE = -4;
/** `top` of a shop front — #1590. @see FACADE_FLOATS */
export const FACADE_SHOPFRONT = -6;
/** `top` of a sign band — #1590. @see FACADE_FLOATS */
export const FACADE_SIGN = -7;
/** `top` of an awning's canvas — #1590. @see FACADE_FLOATS */
export const FACADE_AWNING = -8;
/** `top` of a porch's railing — #1589. @see FACADE_FLOATS */
export const FACADE_RAILING = -5;

/**
 * What a vertex tells the shader of its face's cladding and its windows'
 * style — #1588, four floats after the facade's: `clad`, `flags`, `width` and
 * `extra`.
 *
 * - **`clad`**: what the face is clad in, `CLAD_*`, in its integer part; for
 *   clapboard and shingles the course, in metres, in its fraction (a course is
 *   under a metre). {@link CLAD_PHOTOGRAPH} is the surface's photograph.
 * - **`flags`**, summed: {@link STYLE_SASH} (US double-hung windows rather
 *   than #1581's casements), {@link STYLE_SHUTTERS}, {@link STYLE_EAVES} (an
 *   overhanging roof shades the wall's top) and
 *   {@link STYLE_BRICK_FOUNDATION} (a clapboard wall's foundation band is
 *   brick, not block).
 * - **`width`**: a windowed wall's bay, in metres — what pairs its windows;
 *   a dormer's or a garage's face's width.
 * - **`extra`**: a windowed wall's picture-window bay on the ground storey,
 *   or −1; a dormer front's height; a garage door's leaf's height.
 */
export const STYLE_FLOATS = 4;

/** Where a vertex's facade floats start, after its position, normal and texture coordinate: **8**. */
export const FACADE_OFFSET = 3 + 3 + 2;

/** Where a vertex's style floats start, after its facade: **12**. @see STYLE_FLOATS */
export const STYLE_OFFSET = FACADE_OFFSET + FACADE_FLOATS;

/**
 * How many floats one vertex of a plan's triangles is: **16** — position
 * (three), normal (three), texture coordinate (two), since #1581 the facade's
 * four ({@link FACADE_FLOATS}) and since #1588 the style's four
 * ({@link STYLE_FLOATS}), in that order. Three vertices a triangle and no
 * index: the triangles are appended into #1549's merged buffers, whose
 * indices are theirs to write.
 */
export const FOOTPRINT_VERTEX_FLOATS = STYLE_OFFSET + STYLE_FLOATS;
/** `clad`: the surface's photograph, as #1581 drew every face. @see STYLE_FLOATS */
export const CLAD_PHOTOGRAPH = 0;
/** `clad`: clapboard siding, its course in the fraction. @see STYLE_FLOATS */
export const CLAD_CLAPBOARD = 1;
/** `clad`: asphalt shingles, their course in the fraction. @see STYLE_FLOATS */
export const CLAD_SHINGLE = 2;
/** `clad`: concrete block, a foundation. @see STYLE_FLOATS */
export const CLAD_BLOCK = 3;
/** `clad`: brick, a foundation. @see STYLE_FLOATS */
export const CLAD_BRICK = 4;
/** `clad`: concrete paving, a driveway. @see STYLE_FLOATS */
export const CLAD_PAVING = 5;

/** `flags`: US double-hung sash windows. @see STYLE_FLOATS */
export const STYLE_SASH = 1;
/** `flags`: painted shutters either side of each window. @see STYLE_FLOATS */
export const STYLE_SHUTTERS = 2;
/** `flags`: an overhanging roof above, whose shade darkens the wall's top. @see STYLE_FLOATS */
export const STYLE_EAVES = 4;
/** `flags`: a clapboard wall's foundation band is brick. @see STYLE_FLOATS */
export const STYLE_BRICK_FOUNDATION = 8;
/**
 * `flags`: a commercial building's — #1590: taller windows on its walls, and on
 * its door's face a shop's glazed door in a recess. @see STYLE_FLOATS
 */
export const STYLE_COMMERCIAL = 16;

/** What a plan is clad in — #1588. */
export interface FootprintCladding {
  readonly wall: 'clapboard' | 'photograph';
  readonly roof: 'shingle' | 'photograph';
  /** A clapboard course, in metres, seeded in {@link CLAPBOARD_COURSE_METRES}; 0 for none. */
  readonly course: number;
}

/** The roof shapes a plan can have: since #1581 a hip as well as a gable, seeded. */
export type FootprintRoof = 'gable' | 'hip' | 'flat';

/**
 * What a plan is painted — #1581: an entry of each of `building-paint.ts`'
 * lists, its wall surface's, its roof surface's, the trim's and the door's.
 * Seeded from the footprint, and never the same as a neighbour's
 * ({@link PAINT_NEIGHBOUR_METRES}).
 */
export interface FootprintPaint {
  readonly wall: number;
  readonly roof: number;
  readonly trim: number;
  readonly door: number;
}

/** One mapped building, planned. */
export interface FootprintPlan {
  /** The footprint's centroid, in local metres: what #1549's index is keyed by. */
  readonly centroid: { readonly x: number; readonly z: number };
  /**
   * The outer ring as drawn — simplified by rule 6 — in local metres, `x, z`
   * pairs. #1549's clearing reads it (no tree, shrub or rock stands inside it
   * or within #1534's margin of it, `mapped-buildings.ts`), and #1550's
   * procedural lots keep clear of it (`settlements.ts` §`footprintIndexOf`).
   */
  readonly footprint: Ring;
  /** Metres, local: the plinth's foot — or, for a part on a `min_height`, its base. */
  readonly base: number;
  readonly storeys: number;
  /** Metres, local: where the walls end and the roof starts. #1657's ground blob is cast from it. */
  readonly eaves: number;
  readonly roof: FootprintRoof;
  /** A pitched roof's pitch, degrees, seeded ({@link ROOF_PITCHES_DEGREES}); 0 on a flat one. */
  readonly pitchDegrees: number;
  readonly surfaces: { readonly wall: StructureSurface; readonly roof: StructureSurface };
  /** What it is clad in — #1588. A clapboard house wears `render`, a shingled roof `slate`. */
  readonly cladding: FootprintCladding;
  /** What it is painted — #1581. */
  readonly paint: FootprintPaint;
  /** Whether it has a garage on its front — #1588. */
  readonly garage: boolean;
  /**
   * The garage's driveway, from the garage to the road's edge, as `x, z`
   * pairs round it in local metres; empty without a garage — #1588. Cleared of
   * trees and lots, as the footprint is.
   */
  readonly driveway: Ring;
  /** How many dormers its roof has — #1588. */
  readonly dormers: number;
  /** Whether it has a shop front and a sign band, an awning, and a cornice — #1590. */
  readonly shop: { readonly front: boolean; readonly awning: boolean; readonly cornice: boolean };
  /** Whether it has a front porch — #1589. */
  readonly porch: boolean;
  /**
   * How built-up the stretch of route it stands beside is — #1633
   * (`urban-class.ts`), read at the route distance its centroid is nearest;
   * `unknown` where the press had no map, or no class, there. What #1634–#1637
   * style a footprint by; nothing draws from it yet.
   */
  readonly urban: UrbanClass;
  /**
   * The house model it is drawn as at the near level, where one fits — #1585
   * (`house-models.ts`); `undefined` for every other plan, which keeps its
   * extrusion. A modelled plan keeps its extrusion too: it is its far level,
   * and what is drawn where the models are not loaded.
   */
  readonly model: HousePlacement | undefined;
  /** `instance-tint.ts`' seeded tint, packed, keyed by the centroid (#621). */
  readonly tint: number;
  /**
   * Each role's triangles, {@link FOOTPRINT_VERTEX_FLOATS} floats a vertex in
   * local metres, wound counter-clockwise seen from the side the normal faces.
   * ⚠️ Since #1589 the {@link PORCH_ROLES}' are written the first time any of
   * them is read, and kept: the same triangles every read.
   */
  readonly triangles: Readonly<Record<FootprintRole, Float32Array>>;
  /** ≤ {@link FOOTPRINT_MAX_TRIANGLES}. */
  readonly triangleCount: number;
  /** Walls and roof only — #1549's far level, ≤ {@link FOOTPRINT_MAX_FAR_TRIANGLES}. */
  readonly farTriangleCount: number;
}

/** A storey, in metres: **3.0** (P-10, the owner's ruling of 2026-10-21). */
export const STOREY_METRES = 3;

/**
 * One bay of the facade texture, in metres: **3.6** — one repeat across.
 * Written as a fraction because `3.6` is also the m/s-to-km/h factor that
 * `units/no-inline-units.ts` keeps out of the client, and this is a length.
 */
export const BAY_METRES = 36 / 10;

/** The storeys a building with no mapped height has: **2**. */
export const DEFAULT_STOREYS = 2;

/** The most outer vertices a planned footprint keeps: **48**. */
export const FOOTPRINT_MAX_VERTICES = 48;

/** `simplifyRing`'s tolerance before it is raised to fit: **0.5 m**. */
export const FOOTPRINT_SIMPLIFY_METRES = 0.5;

/** Below this many square metres a footprint is `too-small`: **12**. */
export const FOOTPRINT_MIN_AREA = 12;

/** Above this many square metres it is `too-large`: **20 000**, out of frame anyway. */
export const FOOTPRINT_MAX_AREA = 20_000;

/** The most the drawn ground may vary under a footprint: **2.5 m**. */
export const FOOTPRINT_MAX_GROUND_RANGE_METRES = 2.5;

/** The most triangles a plan is: `realistic-budget.ts` §`REALISTIC_TRIANGLES.structure`, **640**. */
export const FOOTPRINT_MAX_TRIANGLES = REALISTIC_TRIANGLES.structure;

/** The most triangles a plan's far level is — its walls and roof: **200**. */
export const FOOTPRINT_MAX_FAR_TRIANGLES = 200;

/** A flat roof's parapet, above the eaves: **0.5 m**. */
export const PARAPET_METRES = 0.5;

/** A gable only on a footprint of at most this many square metres: **300**. */
export const FOOTPRINT_GABLE_MAX_AREA = 300;

/** A gable only on a footprint at least this much of its minimum-area rectangle: **0.85**. */
export const FOOTPRINT_GABLE_MIN_RECTANGULARITY = 0.85;

/** A gable only under eaves at most this high: **12 m**. */
export const FOOTPRINT_GABLE_MAX_EAVES_METRES = 12;

/**
 * A pitched roof's pitch, seeded — #1581: **25° to 45°** in fives, round
 * #1540's 35°, which is near `buildings.ts`' houses. A low-pitched bungalow
 * and a steep cottage, where #1549 drew every roof alike.
 */
export const ROOF_PITCHES_DEGREES: readonly number[] = [25, 30, 35, 40, 45];

/** The share of pitched roofs that are hipped rather than gabled: **0.35** (#1581). */
export const HIP_SHARE = 0.35;

/** How far the eaves overhang the walls, across a slope: **0.4 m** (#1581). */
export const EAVES_OVERHANG_METRES = 0.4;

/** How far a gable's verges overhang its ends: **0.25 m** (#1581). */
export const VERGE_OVERHANG_METRES = 0.25;

/** How thick a pitched roof is drawn at its edges — its fascia: **0.15 m** (#1581). */
export const ROOF_THICKNESS_METRES = 0.15;

/** The share of pitched houses with a chimney: **0.7** (#1581). */
export const CHIMNEY_SHARE = 0.7;

/** A chimney's breadth along the ridge, its depth across it, and its height above the ridge (#1581). */
export const CHIMNEY = { along: 0.6, across: 0.9, above: 0.9 } as const;

/** The share of houses whose front door has a canopy over it: **0.55** (#1581). */
export const PORCH_SHARE = 0.55;

/** The share of those canopies that stand on two posts — a porch — rather than on brackets. */
export const PORCH_POSTS_SHARE = 0.5;

/** A door canopy: its width, how far it stands out from the wall, and its thickness (#1581). */
export const PORCH = { width: 2, depth: 1, thickness: 0.15, post: 0.12 } as const;

/** How wide a front door's painted surround is, either side and over it: **0.15 m** (#1581). */
export const DOOR_SURROUND_METRES = 0.15;

/** The shortest wall that has a window in it: **2 m**; below it a wall is blank (#1581). */
export const WINDOW_MIN_WALL_METRES = 2;

/**
 * How near two plans' centroids are for them to be neighbours that may not be
 * painted alike: **30 m** (#1581), a house and the two or three either side
 * of it and across a lane.
 */
export const PAINT_NEIGHBOUR_METRES = 30;

/** Over this many storeys a building wears `concrete`: **5** (#1548, was `stone`). */
export const TOWER_STOREYS = 5;

/** The share of residential buildings in `brick` rather than `render`: **0.6**. */
export const BRICK_SHARE = 0.6;

/**
 * The share of residential houses clad in clapboard — #1588: **0.7**, the
 * default; the rest are #1540's brick and render. `building-paint.ts`'
 * own, which a lot reads too.
 */
export { SIDING_SHARE, SHINGLE_SHARE } from './building-paint';

/**
 * The surface a clapboard house wears — #1588: `render`, whose photograph the
 * shader paints over, so its eight house paints are the siding's and no
 * surface — no draw call — is added.
 */
export const SIDING_SURFACE: StructureSurface = 'render';

/** A clapboard course, seeded per house between these, in metres: **0.10 to 0.15** (#1588). */
export const CLAPBOARD_COURSE_METRES = { least: 0.1, most: 0.15 } as const;

/** The surface a shingled roof wears — #1588: `slate`, whose photograph the shader paints over. */
export const SHINGLE_SURFACE: StructureSurface = 'slate';

/** A shingle course's exposure, in metres: **0.14**, a standard strip's 5⅝ inches (#1588). */
export const SHINGLE_COURSE_METRES = 0.14;

/** The share of US houses with shutters at their windows — #1588: **0.4**. */
export const SHUTTER_SHARE = 0.4;

/** The share of single-storey houses with a picture window beside the front door — #1588: **0.5**. */
export const PICTURE_SHARE = 0.5;

/** The share of clapboard houses on a brick foundation rather than block — #1588: **0.3**. */
export const BRICK_FOUNDATION_SHARE = 0.3;

/** The share of wide residential fronts with a garage — #1588: **0.6**. */
export const GARAGE_SHARE = 0.6;

/** The fewest bays a front has for a garage to take one of them, the door another: **3** (#1588). */
export const GARAGE_MIN_BAYS = 3;

/**
 * A garage door — #1588: its leaf's height (**2.13 m**, seven feet), how high
 * above the floor its face reaches — over the ground storey's window in its
 * bay, which it covers — and its painted surround's width.
 */
export const GARAGE = { leaf: 2.13, reach: 2.5, surround: 0.12 } as const;

/**
 * A driveway — #1588: how far above the drawn ground it is laid (**5 cm**),
 * the longest piece it is laid in before it is bent to the ground again, how
 * much narrower than its garage's bay it is either side, the longest it may
 * be, and how far short of the carriageway's edge it stops.
 */
export const DRIVEWAY = { lift: 0.05, piece: 2, inset: 0.15, longest: 40, short: 0.1 } as const;

/** A gutter under a pitched roof's eaves — #1588: its width, its depth, and its top under the roof's edge. */
export const GUTTER = { width: 0.12, depth: 0.12, below: 0.03 } as const;

/** A downpipe — #1588: its breadth, and its middle's distance from the wall's corner. */
export const DOWNPIPE = { size: 0.08, fromCorner: 0.15 } as const;

/** A dormer only on a roof at least this steep: **40°** (#1588). */
export const DORMER_MIN_PITCH_DEGREES = 40;

/** The share of steep residential roofs with dormers: **0.8** (#1588). */
export const DORMER_SHARE = 0.8;

/**
 * A gabled dormer — #1588: its width, its front wall's height, how far inside
 * the wall's line its front stands, and the least its ridge is under the
 * roof's.
 */
export const DORMER = { width: 1.5, front: 1.5, setBack: 0.5, belowRidge: 0.25 } as const;

/**
 * How far along the ridge from its middle a roof reaches — the ridge's half,
 * and no more than the walls' — for one dormer in the middle, clear of a
 * chimney at 0.7 of it: **1.8 m**; and for two either side of the middle at
 * 0.35 of it, twice that (#1588).
 */
export const DORMER_ONE_REACH_METRES = 1.8;
export const DORMER_TWO_REACH_METRES = 2 * DORMER_ONE_REACH_METRES;

/** The shortest front wall that has a shop front — #1590: **4 m**; a shorter one keeps its door alone. */
export const SHOP_FRONT_MIN_WALL_METRES = 4;

/**
 * A shop front's place on its wall — #1590: how far in from either end it
 * stops (`inset`, a pilaster's width of wall), how high it reaches above the
 * floor (`height`) and the least it may (`least`), and how far proud of the
 * wall it stands — under the door's 2 cm, so the door is in front of it.
 */
export const SHOP_FRONT_PLACE = { inset: 0.3, height: 2.7, least: 2.4, proud: 0.01 } as const;

/** A sign band — #1590: its gap over the shop front, its height, and how proud it stands. */
export const SIGN_BAND = { gap: 0.05, height: 0.6, proud: 0.03 } as const;

/**
 * An awning — #1590: the share of shop fronts with one, its depth out from the
 * wall, seeded, and the least it is shortened to before it is dropped, how far
 * its outer edge drops below where it meets the wall, its valance's depth,
 * and how far it stops short of the shop front's ends.
 */
export const AWNING = {
  share: 0.5,
  depth: { least: 1, most: 1.4 },
  leastDepth: 0.7,
  drop: 0.45,
  valance: 0.22,
  inset: 0.1,
} as const;

/** The share of awnings that are striped — #1590; the rest are plain. */
export const AWNING_STRIPED_SHARE = 0.5;

/**
 * A commercial roof's cornice — #1590: how far it projects past the parapet,
 * how deep its band is down from the parapet's top, and how far it caps it.
 */
export const CORNICE = { projection: 0.25, depth: 0.3, cap: 0.02 } as const;

/** How far a door stands proud of its wall: **2 cm**, so it never fights the facade's depth. */
const DOOR_PROUD_METRES = 0.02;

/** A door with its surround: what {@link door} draws, and the shader's `[0, 1]` across it. */
export const DOOR_FACE = {
  width: DOOR.width + 2 * DOOR_SURROUND_METRES,
  height: DOOR.height + DOOR_SURROUND_METRES,
} as const;

/** What a footprint's land is used for, as its surfaces and its roof read it. */
export type FootprintUse = 'residential' | 'commercial' | 'industrial' | 'farmland';

/** The kinds that are industrial — #1540's table: industrial and railway, and military land. */
const INDUSTRIAL_KINDS = new Set(['industrial', 'railway', 'military']);

/** The kinds that are residential; every other built-up kind is commercial. */
const RESIDENTIAL_KINDS = new Set(['residential', 'neighbourhood']);

/**
 * What the land under a footprint is used for. Farmland by class; built-up by
 * its `kind` — residential and neighbourhood land residential, industrial,
 * railway and military land industrial, and every other built-up kind (retail,
 * a school, a hospital) commercial. ⚠️ A footprint on land the map classes as
 * neither — `other`, or `unknown` where no tile was read — is residential:
 * most buildings are houses, and a mapped house on unmapped land is still one.
 */
export function footprintUse(landClass: LandClass, kind: string | undefined): FootprintUse {
  if (landClass === 'farmland') return 'farmland';
  if (landClass !== 'built-up' || kind === undefined) return 'residential';
  if (RESIDENTIAL_KINDS.has(kind)) return 'residential';
  if (INDUSTRIAL_KINDS.has(kind)) return 'industrial';
  return 'commercial';
}

/**
 * A plan's walls' surface — #1540's table with #1548's swap. Over
 * {@link TOWER_STOREYS} `concrete`; residential `brick` or `render` by a
 * seeded {@link BRICK_SHARE}; commercial `render`; industrial `corrugated`;
 * farmland `planks` under a flat roof (a barn) and `brick` under a gable.
 * `share` is the footprint's seeded draw in `[0, 1)`.
 */
export function wallSurfaceOf(
  use: FootprintUse,
  storeys: number,
  roof: FootprintRoof,
  share: number,
): StructureSurface {
  if (storeys > TOWER_STOREYS) return 'concrete';
  switch (use) {
    case 'residential':
      return share < BRICK_SHARE ? 'brick' : 'render';
    case 'commercial':
      return 'render';
    case 'industrial':
      return 'corrugated';
    case 'farmland':
      return roof === 'flat' ? 'planks' : 'brick';
  }
}

/** A plan's roof's surface: `roof-tiles` or `slate` on a gable, by a seeded half; `flat-roof` (#1548) on a flat one. */
export function roofSurfaceOf(roof: FootprintRoof, share: number): StructureSurface {
  if (roof === 'flat') return 'flat-roof';
  return share < 0.5 ? 'roof-tiles' : 'slate';
}

/**
 * Every surface a plan can wear — the range of {@link wallSurfaceOf} and
 * {@link roofSurfaceOf}.
 *
 * `three-renderer.ts` §`MappedBuildingBelt` builds one material for each, and
 * `realistic-renderer.test.ts` §"has no surface nothing wears" holds #1548's
 * town surfaces to being among them.
 */
export const FOOTPRINT_SURFACES: readonly StructureSurface[] = [
  'brick',
  'render',
  'concrete',
  'corrugated',
  'planks',
  'roof-tiles',
  'slate',
  'flat-roof',
];

/** The seeded streams a footprint draws from. */
const STREAM_WALL = 0;
const STREAM_ROOF = 1;
// #1581's: the shape's detail and the paint, each its own.
const STREAM_PITCH = 2;
const STREAM_HIP = 3;
const STREAM_CHIMNEY = 4;
const STREAM_PORCH = 5;
const STREAM_POSTS = 6;
const STREAM_PAINT_WALL = 7;
const STREAM_PAINT_ROOF = 8;
const STREAM_PAINT_TRIM = 9;
const STREAM_PAINT_DOOR = 10;
// #1588's, each its own.
const STREAM_SIDING = 11;
const STREAM_SHINGLE = 12;
const STREAM_COURSE = 13;
const STREAM_SHUTTERS = 14;
const STREAM_PICTURE = 15;
const STREAM_FOUNDATION = 16;
const STREAM_GARAGE = 17;
const STREAM_GARAGE_END = 18;
const STREAM_DORMER = 19;
// #1590's, each its own (#1589 holds 20 to 25).
const STREAM_SIGN = 26;
const STREAM_AWNING = 27;
const STREAM_AWNING_PAINT = 28;
const STREAM_AWNING_STRIPES = 29;
const STREAM_AWNING_DEPTH = 30;
// #1589's, each its own.
const STREAM_FRONT_PORCH = 20;
const STREAM_PORCH_WIDTH = 21;
const STREAM_PORCH_DEPTH = 22;
const STREAM_PORCH_POSTS = 23;
const STREAM_PORCH_SIDE = 24;
const STREAM_PORCH_ROOF = 25;
/** #1585: which of the house models that fit a footprint it is drawn as. */
const STREAM_HOUSE_MODEL = 31;

/** The key under which {@link slotHash} hashes footprints, apart from every other placement. */
const FOOTPRINT_KEY = 0x15_40;

/** A seeded draw in `[0, 1)` for a footprint, keyed by its centroid to the decimetre. */
function footprintShare(seed: number, x: number, z: number, stream: number): number {
  const cell = Math.imul(Math.round(x * 10), 0x9e37_79b1) ^ Math.round(z * 10);
  return uniformFrom(slotHash(seed, cell, FOOTPRINT_KEY), stream);
}

/** The signed area of a ring, positive counter-clockwise in `(x, z)`. */
function signedArea(ring: Ring): number {
  const n = ring.length / 2;
  let twice = 0;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    twice +=
      (ring[j * 2] as number) * (ring[i * 2 + 1] as number) -
      (ring[i * 2] as number) * (ring[j * 2 + 1] as number);
  }
  return twice / 2;
}

/** The area centroid of a ring; its vertices' mean where it has no area. */
function centroidOf(ring: Ring): { readonly x: number; readonly z: number } {
  const n = ring.length / 2;
  let twice = 0;
  let cx = 0;
  let cz = 0;
  let mx = 0;
  let mz = 0;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xj = ring[j * 2] as number;
    const zj = ring[j * 2 + 1] as number;
    const xi = ring[i * 2] as number;
    const zi = ring[i * 2 + 1] as number;
    const cross = xj * zi - xi * zj;
    twice += cross;
    cx += (xj + xi) * cross;
    cz += (zj + zi) * cross;
    mx += xi;
    mz += zi;
  }
  if (Math.abs(twice) < 1e-9) return { x: mx / n, z: mz / n };
  return { x: cx / (3 * twice), z: cz / (3 * twice) };
}

/** The footprint's area: its outer ring less its holes. */
function footprintArea(rings: readonly Ring[]): number {
  let area = 0;
  rings.forEach((ring, index) => {
    area += index === 0 ? Math.abs(signedArea(ring)) : -Math.abs(signedArea(ring));
  });
  return Math.max(0, area);
}

/** Whether `(x, z)` is inside a ring, by crossings. */
function insideRing(ring: Ring, x: number, z: number): boolean {
  const n = ring.length / 2;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const xi = ring[i * 2] as number;
    const zi = ring[i * 2 + 1] as number;
    const xj = ring[j * 2] as number;
    const zj = ring[j * 2 + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether two segments cross or touch. */
function segmentsMeet(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): boolean {
  const side = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number): number =>
    Math.sign((qx - px) * (rz - pz) - (qz - pz) * (rx - px));
  return (
    side(ax, az, bx, bz, cx, cz) * side(ax, az, bx, bz, dx, dz) <= 0 &&
    side(cx, cz, dx, dz, ax, az) * side(cx, cz, dx, dz, bx, bz) <= 0
  );
}

/** The squared distance between two segments. */
function segmentToSegmentSquared(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): number {
  if (segmentsMeet(ax, az, bx, bz, cx, cz, dx, dz)) return 0;
  const abx = bx - ax;
  const abz = bz - az;
  const cdx = dx - cx;
  const cdz = dz - cz;
  return Math.min(
    squaredToSegment(cx, cz, ax, az, abx, abz, abx * abx + abz * abz),
    squaredToSegment(dx, dz, ax, az, abx, abz, abx * abx + abz * abz),
    squaredToSegment(ax, az, cx, cz, cdx, cdz, cdx * cdx + cdz * cdz),
    squaredToSegment(bx, bz, cx, cz, cdx, cdz, cdx * cdx + cdz * cdz),
  );
}

/**
 * How near the ring comes to any of the road's `segments`, in metres: 0 where
 * a segment crosses it or lies inside it.
 */
function ringToRoad(ring: Ring, road: DrawnRoadPoints, segments: readonly number[]): number {
  const n = ring.length / 2;
  const points = road.points;
  let least = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    const ax = points[segment * 2] as number;
    const az = points[segment * 2 + 1] as number;
    const bx = points[segment * 2 + 2] as number;
    const bz = points[segment * 2 + 3] as number;
    if (insideRing(ring, ax, az)) return 0;
    for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
      least = Math.min(
        least,
        segmentToSegmentSquared(
          ring[j * 2] as number,
          ring[j * 2 + 1] as number,
          ring[i * 2] as number,
          ring[i * 2 + 1] as number,
          ax,
          az,
          bx,
          bz,
        ),
      );
    }
  }
  return Math.sqrt(least);
}

/** The farthest any vertex of `ring` is from `(x, z)`. */
function radiusAbout(ring: Ring, x: number, z: number): number {
  let most = 0;
  for (let i = 0; i + 1 < ring.length; i += 2) {
    most = Math.max(most, Math.hypot((ring[i] as number) - x, (ring[i + 1] as number) - z));
  }
  return most;
}

/** The convex hull of a ring's vertices, counter-clockwise, as pairs. */
function convexHull(ring: Ring): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i + 1 < ring.length; i += 2) {
    points.push([ring[i] as number, ring[i + 1] as number]);
  }
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const point of points) {
    while (
      lower.length >= 2 &&
      cross(
        lower[lower.length - 2] as [number, number],
        lower[lower.length - 1] as [number, number],
        point,
      ) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: [number, number][] = [];
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const point = points[i] as [number, number];
    while (
      upper.length >= 2 &&
      cross(
        upper[upper.length - 2] as [number, number],
        upper[upper.length - 1] as [number, number],
        point,
      ) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** A rectangle: its centre, its long axis (unit) and its half-lengths along and across it. */
interface Rectangle {
  readonly cx: number;
  readonly cz: number;
  readonly ux: number;
  readonly uz: number;
  readonly halfLong: number;
  readonly halfShort: number;
}

/**
 * The minimum-area rectangle around a ring — by its hull's edges, one of
 * which a minimum-area rectangle always has a side along — with its long axis
 * named. #1540's roof rule reads its area and its long side.
 */
export function minimumAreaRectangle(ring: Ring): Rectangle & { readonly area: number } {
  const hull = convexHull(ring);
  let best: (Rectangle & { readonly area: number }) | undefined;
  for (let i = 0; i < hull.length; i += 1) {
    const [ax, az] = hull[i] as [number, number];
    const [bx, bz] = hull[(i + 1) % hull.length] as [number, number];
    const length = Math.hypot(bx - ax, bz - az);
    if (!(length > 0)) continue;
    const ex = (bx - ax) / length;
    const ez = (bz - az) / length;
    let minE = Number.POSITIVE_INFINITY;
    let maxE = Number.NEGATIVE_INFINITY;
    let minN = Number.POSITIVE_INFINITY;
    let maxN = Number.NEGATIVE_INFINITY;
    for (const [x, z] of hull) {
      const e = (x - ax) * ex + (z - az) * ez;
      const n = -(x - ax) * ez + (z - az) * ex;
      minE = Math.min(minE, e);
      maxE = Math.max(maxE, e);
      minN = Math.min(minN, n);
      maxN = Math.max(maxN, n);
    }
    const area = (maxE - minE) * (maxN - minN);
    if (best !== undefined && area >= best.area) continue;
    const midE = (minE + maxE) / 2;
    const midN = (minN + maxN) / 2;
    const cx = ax + ex * midE - ez * midN;
    const cz = az + ez * midE + ex * midN;
    const alongE = (maxE - minE) / 2;
    const alongN = (maxN - minN) / 2;
    best =
      alongE >= alongN
        ? { cx, cz, ux: ex, uz: ez, halfLong: alongE, halfShort: alongN, area }
        : { cx, cz, ux: -ez, uz: ex, halfLong: alongN, halfShort: alongE, area };
  }
  return best ?? { cx: 0, cz: 0, ux: 1, uz: 0, halfLong: 0, halfShort: 0, area: 0 };
}

/**
 * How far a height may sit from `3L + 2` and still be read as levels-derived:
 * **0.01 m** — #1629.
 */
export const LEVELS_HEIGHT_TOLERANCE_METRES = 0.01;

/**
 * The storeys for a mapped height, or {@link DEFAULT_STOREYS} for none: never 0.
 *
 * #1629: where OSM has `building:levels` and no `height`, Protomaps writes
 * `height = max(levels, 1) × 3 + 2` (`Buildings.java` §`parseHeight`, ADR 0054's
 * amendment of 2026-10-24). A height within {@link LEVELS_HEIGHT_TOLERANCE_METRES}
 * of `3L + 2` for a whole `L ≥ 1` is read as `L` storeys; every other height
 * is over {@link STOREY_METRES}, rounded, as P-10 has it.
 */
export function storeysFor(heightMetres: number | null): number {
  if (heightMetres === null || !Number.isFinite(heightMetres)) return DEFAULT_STOREYS;
  const levels = Math.round((heightMetres - 2) / STOREY_METRES);
  if (
    levels >= 1 &&
    Math.abs(heightMetres - (levels * STOREY_METRES + 2)) <= LEVELS_HEIGHT_TOLERANCE_METRES
  ) {
    return levels;
  }
  return Math.max(1, Math.round(heightMetres / STOREY_METRES));
}

/** A role's triangles while a plan is built: {@link FOOTPRINT_VERTEX_FLOATS} numbers a vertex. */
type Writing = Record<FootprintRole, number[]>;

type Vec = readonly [number, number, number];
type Pair = readonly [number, number];
type Three<T> = readonly [T, T, T];
type Four<T> = readonly [T, T, T, T];

/** A face's four style floats. @see STYLE_FLOATS */
type Style = Four<number>;

/** The photograph, with no style: what #1581 wrote on every face. */
const NO_STYLE: Style = [CLAD_PHOTOGRAPH, 0, 0, -1];

/**
 * What a face tells the facade shader besides its corners' `u, v`: its `top`
 * and `skip` ({@link FACADE_FLOATS}) and, since #1588, its style
 * ({@link STYLE_FLOATS}).
 */
interface Face {
  readonly top: number;
  readonly skip: number;
  readonly style: Style;
}

const PLAIN: Face = { top: FACADE_PLAIN, skip: -1, style: NO_STYLE };
const PAINTED: Face = { top: FACADE_PAINT, skip: -1, style: NO_STYLE };

/** A plain face in `style`. */
function plainIn(style: Style): Face {
  return { top: FACADE_PLAIN, skip: -1, style };
}

/** A cladding's `clad` float: its code, and its course in metres in the fraction. @see STYLE_FLOATS */
export function cladOf(code: number, course = 0): number {
  return code + course;
}
const AT_NOUGHT: Pair = [0, 0];
const NO_FACADE: Four<Pair> = [AT_NOUGHT, AT_NOUGHT, AT_NOUGHT, AT_NOUGHT];

/**
 * One triangle into `into`, wound counter-clockwise seen from `normal`'s side,
 * each corner with its photograph's `uv` and, since #1581, its facade's.
 */
function triangle(
  into: number[],
  corners: Three<Vec>,
  normal: Vec,
  uvs: Three<Pair>,
  face: Face = PLAIN,
  facade: Three<Pair> = [AT_NOUGHT, AT_NOUGHT, AT_NOUGHT],
): void {
  const [a, b, c] = corners;
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const facing =
    (uy * vz - uz * vy) * normal[0] +
    (uz * vx - ux * vz) * normal[1] +
    (ux * vy - uy * vx) * normal[2];
  const order = facing >= 0 ? [0, 1, 2] : [0, 2, 1];
  for (const corner of order) {
    const p = corners[corner] as Vec;
    const uv = uvs[corner] as Pair;
    const f = facade[corner] as Pair;
    into.push(p[0], p[1], p[2], normal[0], normal[1], normal[2], uv[0], uv[1]);
    into.push(f[0], f[1], face.top, face.skip);
    into.push(face.style[0], face.style[1], face.style[2], face.style[3]);
  }
}

/** A quad `a b c d` (in order round it) as two triangles facing `normal`. */
function quad(
  into: number[],
  corners: Four<Vec>,
  normal: Vec,
  uv: Four<Pair>,
  face: Face = PLAIN,
  facade: Four<Pair> = NO_FACADE,
): void {
  const [a, b, c, d] = corners;
  triangle(into, [a, b, c], normal, [uv[0], uv[1], uv[2]], face, [facade[0], facade[1], facade[2]]);
  triangle(into, [a, c, d], normal, [uv[0], uv[2], uv[3]], face, [facade[0], facade[2], facade[3]]);
}

/** Which of a box's ends {@link box} draws. */
interface BoxEnds {
  readonly top: boolean;
  readonly bottom: boolean;
}

/**
 * A box's four upright faces into `into`, and its top and bottom where asked —
 * #1581: a chimney, a canopy, a post. Centred on `centre`, `half` either way
 * along `axis` and along its normal `(az, −ax)`, from `bottom` to `top`;
 * `u, v` in bays and storeys of plan from `floor`.
 */
function box(
  into: number[],
  centre: Pair,
  axis: Pair,
  half: Pair,
  heights: readonly [bottom: number, top: number, floor: number],
  face: Face,
  ends: BoxEnds,
): void {
  const [cx, cz] = centre;
  const [ex, ez] = axis;
  const nx = ez;
  const nz = -ex;
  const [halfE, halfN] = half;
  const [bottom, top, floor] = heights;
  const at = (e: number, n: number, y: number): Vec => [
    cx + ex * e + nx * n,
    y,
    cz + ez * e + nz * n,
  ];
  const v0 = (bottom - floor) / STOREY_METRES;
  const v1 = (top - floor) / STOREY_METRES;
  // Each face's two bottom corners `(e, n)`, its normal, and its width.
  const sides: readonly (readonly [Pair, Pair, Vec, number])[] = [
    [[-halfE, halfN], [halfE, halfN], [nx, 0, nz], 2 * halfE],
    [[halfE, -halfN], [-halfE, -halfN], [-nx, 0, -nz], 2 * halfE],
    [[halfE, halfN], [halfE, -halfN], [ex, 0, ez], 2 * halfN],
    [[-halfE, -halfN], [-halfE, halfN], [-ex, 0, -ez], 2 * halfN],
  ];
  for (const [[e0, n0], [e1, n1], normal, width] of sides) {
    const u1 = width / BAY_METRES;
    quad(
      into,
      [at(e0, n0, bottom), at(e1, n1, bottom), at(e1, n1, top), at(e0, n0, top)],
      normal,
      [
        [0, v0],
        [u1, v0],
        [u1, v1],
        [0, v1],
      ],
      face,
    );
  }
  const cap = (y: number, normal: Vec): void => {
    const u = halfE / STOREY_METRES;
    const v = halfN / STOREY_METRES;
    quad(
      into,
      [at(-halfE, -halfN, y), at(halfE, -halfN, y), at(halfE, halfN, y), at(-halfE, halfN, y)],
      normal,
      [
        [-u, -v],
        [u, -v],
        [u, v],
        [-u, v],
      ],
      face,
    );
  };
  if (ends.top) cap(top, [0, 1, 0]);
  if (ends.bottom) cap(bottom, [0, -1, 0]);
}

/**
 * How many window bays a wall `length` metres long has — #1581: one a
 * {@link BAY_METRES}, rounded, and at least one, so every wall's bays are
 * whole and its windows centred in them, never cut by a corner; none on a
 * wall shorter than {@link WINDOW_MIN_WALL_METRES}.
 */
export function baysOf(length: number): number {
  if (!(length >= WINDOW_MIN_WALL_METRES)) return 0;
  return Math.max(1, Math.round(length / BAY_METRES));
}

/** Where a plan's windows go, for {@link ringWalls}: under `top` storeys, and none behind the door. */
interface Windows {
  /** The eaves, in storeys above the floor. @see FACADE_FLOATS */
  readonly top: number;
  /** The outer ring's edge the front door is on, or −1. */
  readonly doorEdge: number;
  /** #1588: the walls' `clad` and `flags` ({@link STYLE_FLOATS}). */
  readonly clad: number;
  readonly flags: number;
  /** #1588: the door edge's picture-window bay on the ground storey, or −1. */
  readonly picture: number;
  /**
   * The long axis (unit) of a gable roof: a wall across it is a gable end, which
   * stands the gable's triangle on its top and so has no eaves over it (#1658).
   */
  readonly gableAxis?: readonly [x: number, z: number];
}

/** How {@link ringWalls} draws. */
interface WallOptions {
  /** A second face the other way (a parapet's back). */
  readonly inside?: boolean;
  /** #1581's facade on every wall. */
  readonly windows?: Windows;
  /**
   * #1588: a plain face in this style, its `u, v` in metres round the ring
   * and up from `from` — a plinth's foundation.
   */
  readonly metres?: Style;
}

/**
 * Upright quads round each ring from `bottom` to `top`, facing away from the
 * building's material — out of the outer ring, into each hole — and, with
 * `inside`, a second face the other way (a parapet's back). `u` runs round
 * the ring in bays and `v` up it in storeys from `from`. With `windows`, each
 * wall carries #1581's facade ({@link FACADE_FLOATS}): its own whole bays
 * ({@link baysOf}), and on the door's edge no ground-floor window behind the
 * door — an odd count's middle bay; an even count's door stands between two
 * — and, since #1588, its style ({@link STYLE_FLOATS}): its cladding, its
 * windows' flags, its bay in metres and the door edge's picture window.
 */
function ringWalls(
  into: number[],
  rings: readonly Ring[],
  heights: readonly [bottom: number, top: number, from: number],
  options: WallOptions = {},
): void {
  const [bottom, top, from] = heights;
  const { inside = false, windows, metres } = options;
  rings.forEach((ring, index) => {
    const n = ring.length / 2;
    const counter = signedArea(ring) > 0;
    // Out of the outer ring is `(dz, −dx)` of a counter-clockwise edge; a
    // hole's walls face into the hole, which is the other way round it.
    const outward = (index === 0) === counter ? 1 : -1;
    let round = 0;
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      const ax = ring[i * 2] as number;
      const az = ring[i * 2 + 1] as number;
      const bx = ring[j * 2] as number;
      const bz = ring[j * 2 + 1] as number;
      const length = Math.hypot(bx - ax, bz - az);
      if (!(length > 1e-6)) continue;
      const normal: Vec = [((bz - az) / length) * outward, 0, (-(bx - ax) / length) * outward];
      const u0 = round / BAY_METRES;
      const u1 = (round + length) / BAY_METRES;
      const v0 = (bottom - from) / STOREY_METRES;
      const v1 = (top - from) / STOREY_METRES;
      const corners: Four<Vec> = [
        [ax, bottom, az],
        [bx, bottom, bz],
        [bx, top, bz],
        [ax, top, az],
      ];
      const uv: Four<Pair> = [
        [u0, v0],
        [u1, v0],
        [u1, v1],
        [u0, v1],
      ];
      const bays = windows === undefined ? 0 : baysOf(length);
      let face: Face = PLAIN;
      let facade: Four<Pair> = [
        [0, v0],
        [bays, v0],
        [bays, v1],
        [0, v1],
      ];
      if (windows !== undefined) {
        const front = index === 0 && i === windows.doorEdge;
        const axis = windows.gableAxis;
        // A gable end (its edge across the long axis) carries no eaves flag.
        const gableEnd =
          axis !== undefined &&
          Math.abs(((bx - ax) * axis[0] + (bz - az) * axis[1]) / length) < Math.SQRT1_2;
        const flags =
          gableEnd && Math.floor(windows.flags / STYLE_EAVES) % 2 === 1
            ? windows.flags - STYLE_EAVES
            : windows.flags;
        const style: Style = [
          windows.clad,
          flags,
          bays > 0 ? length / bays : 0,
          front && bays > 0 ? windows.picture : -1,
        ];
        face =
          bays === 0
            ? plainIn(style)
            : {
                top: windows.top,
                skip: front && bays % 2 === 1 ? (bays - 1) / 2 : -1,
                style,
              };
      } else if (metres !== undefined) {
        face = plainIn(metres);
        facade = [
          [round, bottom - from],
          [round + length, bottom - from],
          [round + length, top - from],
          [round, top - from],
        ];
      }
      quad(into, corners, normal, uv, face, facade);
      if (inside) {
        const back: Vec = [-normal[0], 0, -normal[2]];
        quad(into, corners, back, uv);
      }
      round += length;
    }
  });
}

/** A flat roof over the rings at `height`, facing up, `u, v` in storeys of plan. */
function flatRoof(into: number[], rings: readonly Ring[], height: number): void {
  const indices = triangulate({ rings });
  const flat: number[] = [];
  for (const ring of rings) for (const each of ring) flat.push(each);
  const up: Vec = [0, 1, 0];
  const at = (index: number): Vec => [
    flat[index * 2] as number,
    height,
    flat[index * 2 + 1] as number,
  ];
  const uv = (index: number): Pair => [
    (flat[index * 2] as number) / STOREY_METRES,
    (flat[index * 2 + 1] as number) / STOREY_METRES,
  ];
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i] as number;
    const b = indices[i + 1] as number;
    const c = indices[i + 2] as number;
    triangle(into, [at(a), at(b), at(c)], up, [uv(a), uv(b), uv(c)]);
  }
}

/** Where a pitched roof's ridge is, for a chimney to stand astride it. */
interface Ridge {
  readonly top: number;
  /** Half the ridge's length, along the long axis. */
  readonly half: number;
}

/** How a pitched roof is dressed — #1588. */
interface RoofDress {
  /** The slopes' style: shingles' course, or the photograph. */
  readonly roof: Style;
  /** A gable end's style: the walls' cladding. */
  readonly gable: Style;
  /**
   * Gutters under both long eaves, and a downpipe under the `side` one (`1`
   * along the rectangle's `+v`) at its `end` (`1` along `+u`), down to
   * `ground`; none where absent.
   */
  readonly gutters?: { readonly side: number; readonly end: number; readonly ground: number };
}

/** A face of a box {@link boxFaces} draws: its normal, along the long axis, across it, or down. */
type BoxFace = 'a+' | 'a-' | 'c+' | 'y-';

/** No photograph on a painted face: its corners' texture coordinates, all nought. */
const UNMAPPED: Four<Pair> = [AT_NOUGHT, AT_NOUGHT, AT_NOUGHT, AT_NOUGHT];

/**
 * The asked `faces` of a box in a rectangle's frame — #1588: `a` along its
 * long axis, `c` across it on `side`, `y` up — painted (`trim`). A gutter, a
 * downpipe and its neck.
 */
function boxFaces(
  into: number[],
  rectangle: Rectangle,
  side: number,
  extent: readonly [a: Pair, c: Pair, y: Pair],
  faces: readonly BoxFace[],
): void {
  const { cx, cz, ux, uz } = rectangle;
  const vx = -uz * side;
  const vz = ux * side;
  const [[a0, a1], [c0, c1], [y0, y1]] = extent;
  const at = (a: number, c: number, y: number): Vec => [
    cx + ux * a + vx * c,
    y,
    cz + uz * a + vz * c,
  ];
  for (const face of faces) {
    switch (face) {
      case 'a+':
      case 'a-': {
        const a = face === 'a+' ? a1 : a0;
        const sign = face === 'a+' ? 1 : -1;
        quad(
          into,
          [at(a, c0, y0), at(a, c1, y0), at(a, c1, y1), at(a, c0, y1)],
          [ux * sign, 0, uz * sign],
          UNMAPPED,
          PAINTED,
        );
        break;
      }
      case 'c+':
        quad(
          into,
          [at(a0, c1, y0), at(a1, c1, y0), at(a1, c1, y1), at(a0, c1, y1)],
          [vx, 0, vz],
          UNMAPPED,
          PAINTED,
        );
        break;
      case 'y-':
        quad(
          into,
          [at(a0, c0, y0), at(a1, c0, y0), at(a1, c1, y0), at(a0, c1, y0)],
          [0, -1, 0],
          UNMAPPED,
          PAINTED,
        );
        break;
    }
  }
}

/**
 * A pitched roof over the minimum-area rectangle, its ridge along the long
 * axis, rising from the eaves at `eaves` at `pitchDegrees` — #1540's gable,
 * and since #1581 a hip, both overhanging the walls
 * ({@link EAVES_OVERHANG_METRES}, {@link VERGE_OVERHANG_METRES}) and drawn
 * {@link ROOF_THICKNESS_METRES} thick: the slopes (`roof`), a gable's two
 * ends (`wall`), and the soffit under every slope and the fascia round every
 * edge (`trim`, painted). Since #1588 the slopes and the gable ends carry
 * `dress`'s styles — the slopes' facade `u, v` in metres along the eaves and
 * up the slope — and, with `dress.gutters`, a gutter hangs under each long
 * eave and a downpipe runs down one wall to the ground (`trim`).
 */
function pitchedRoof(
  writing: Writing,
  rectangle: Rectangle,
  heights: readonly [eaves: number, floor: number],
  shape: 'gable' | 'hip',
  pitchDegrees: number,
  dress: RoofDress,
): Ridge {
  const { cx, cz, ux, uz, halfLong, halfShort } = rectangle;
  const [eaves, floor] = heights;
  const vx = -uz;
  const vz = ux;
  const pitch = (pitchDegrees * Math.PI) / 180;
  const tan = Math.tan(pitch);
  const sin = Math.sin(pitch);
  const cos = Math.cos(pitch);
  const ridgeTop = eaves + halfShort * tan;
  const across = halfShort + EAVES_OVERHANG_METRES;
  const along = halfLong + (shape === 'gable' ? VERGE_OVERHANG_METRES : EAVES_OVERHANG_METRES);
  // Overhanging, the eaves line falls below the wall top by the overhang's drop.
  const eaveY = eaves - EAVES_OVERHANG_METRES * tan;
  const ridgeHalf = shape === 'gable' ? along : Math.max(0, halfLong - halfShort);
  const thick = ROOF_THICKNESS_METRES;
  const corner = (a: number, c: number, y: number): Vec => [
    cx + ux * a + vx * c,
    y,
    cz + uz * a + vz * c,
  ];
  const below = (p: Vec): Vec => [p[0], p[1] - thick, p[2]];
  const flip = (n: Vec): Vec => [-n[0], -n[1], -n[2]];
  const slopeUv = (a: number, upSlope: number): Pair => [
    a / STOREY_METRES,
    upSlope / STOREY_METRES,
  ];
  const inMetres = (uv: Pair): Pair => [uv[0] * STOREY_METRES, uv[1] * STOREY_METRES];
  const slopeFace = plainIn(dress.roof);
  const slopeLength = across / cos;
  // A slope: its top in `roof`, its soffit under it in `trim`.
  const slope = (corners: readonly Vec[], normal: Vec, uvs: readonly Pair[]): void => {
    if (corners.length === 4) {
      const c = corners as Four<Vec>;
      const u = uvs as Four<Pair>;
      quad(writing.roof, c, normal, u, slopeFace, [
        inMetres(u[0]),
        inMetres(u[1]),
        inMetres(u[2]),
        inMetres(u[3]),
      ]);
      quad(
        writing.trim,
        [below(c[0]), below(c[1]), below(c[2]), below(c[3])],
        flip(normal),
        u,
        PAINTED,
      );
    } else {
      const c = corners as Three<Vec>;
      const u = uvs as Three<Pair>;
      triangle(writing.roof, c, normal, u, slopeFace, [
        inMetres(u[0]),
        inMetres(u[1]),
        inMetres(u[2]),
      ]);
      triangle(writing.trim, [below(c[0]), below(c[1]), below(c[2])], flip(normal), u, PAINTED);
    }
  };
  // An edge of the roof, `p` to `q` along its top: the fascia under it, facing `normal`.
  const fascia = (p: Vec, q: Vec, normal: Vec): void => {
    const width = Math.hypot(q[0] - p[0], q[2] - p[2]) / BAY_METRES;
    quad(
      writing.trim,
      [below(p), below(q), q, p],
      normal,
      [
        [0, 0],
        [width, 0],
        [width, thick / STOREY_METRES],
        [0, thick / STOREY_METRES],
      ],
      PAINTED,
    );
  };
  for (const side of [1, -1]) {
    // Out and up, across the slope.
    const normal: Vec = [vx * side * sin, cos, vz * side * sin];
    const eaveA = corner(-along, across * side, eaveY);
    const eaveB = corner(along, across * side, eaveY);
    if (ridgeHalf > 1e-3) {
      slope(
        [eaveA, eaveB, corner(ridgeHalf, 0, ridgeTop), corner(-ridgeHalf, 0, ridgeTop)],
        normal,
        [
          slopeUv(-along, 0),
          slopeUv(along, 0),
          slopeUv(ridgeHalf, slopeLength),
          slopeUv(-ridgeHalf, slopeLength),
        ],
      );
    } else {
      // A hip over a square: a pyramid, its ridge a point.
      slope([eaveA, eaveB, corner(0, 0, ridgeTop)], normal, [
        slopeUv(-along, 0),
        slopeUv(along, 0),
        slopeUv(0, slopeLength),
      ]);
    }
    fascia(eaveA, eaveB, [vx * side, 0, vz * side]);
  }
  for (const end of [1, -1]) {
    const outward: Vec = [ux * end, 0, uz * end];
    if (shape === 'hip') {
      // A hipped end: the same pitch, from the eaves at the end up to the ridge's end.
      const normal: Vec = [ux * end * sin, cos, uz * end * sin];
      const left = corner(along * end, across, eaveY);
      const right = corner(along * end, -across, eaveY);
      slope([left, right, corner(ridgeHalf * end, 0, ridgeTop)], normal, [
        slopeUv(across, 0),
        slopeUv(-across, 0),
        slopeUv(0, slopeLength),
      ]);
      fascia(left, right, outward);
    } else {
      // A gable end: the wall's triangle up to the ridge, and a verge's fascia either side.
      const gableUv: Three<Pair> = [
        [halfShort / BAY_METRES, (eaves - floor) / STOREY_METRES],
        [-halfShort / BAY_METRES, (eaves - floor) / STOREY_METRES],
        [0, (ridgeTop - floor) / STOREY_METRES],
      ];
      triangle(
        writing.wall,
        [
          corner(halfLong * end, halfShort, eaves),
          corner(halfLong * end, -halfShort, eaves),
          corner(halfLong * end, 0, ridgeTop),
        ],
        outward,
        gableUv,
        plainIn(dress.gable),
        gableUv,
      );
      for (const side of [1, -1]) {
        fascia(
          corner(along * end, across * side, eaveY),
          corner(along * end, 0, ridgeTop),
          outward,
        );
      }
    }
  }
  if (dress.gutters !== undefined) {
    // #1588: a gutter hung on each long fascia, its top a little under the roof's edge.
    const top = eaveY - GUTTER.below;
    const bottom = top - GUTTER.depth;
    const out: Pair = [across, across + GUTTER.width];
    for (const side of [1, -1]) {
      boxFaces(
        writing.trim,
        rectangle,
        side,
        [[-along, along], out, [bottom, top]],
        ['c+', 'y-', 'a+', 'a-'],
      );
    }
    // And a downpipe down the wall near one corner, its neck out under the soffit to the gutter.
    const { side, end, ground } = dress.gutters;
    const a = end * (halfLong - DOWNPIPE.fromCorner);
    const half = DOWNPIPE.size / 2;
    const span: Pair = [a - half, a + half];
    boxFaces(
      writing.trim,
      rectangle,
      side,
      [span, [halfShort, halfShort + DOWNPIPE.size], [ground, bottom]],
      ['c+', 'a+', 'a-'],
    );
    boxFaces(
      writing.trim,
      rectangle,
      side,
      [span, [halfShort, across + GUTTER.width / 2], [bottom - DOWNPIPE.size, bottom]],
      ['y-', 'a+', 'a-'],
    );
  }
  return { top: ridgeTop, half: ridgeHalf };
}

/**
 * Gabled dormers on the `side` slope of a pitched roof — #1588: `count` of
 * them (one in the middle, or two either side of it), each {@link DORMER}'s
 * size, standing from the slope a little inside the wall's line, at the
 * roof's own pitch, its ridge under the roof's. The front and the cheeks
 * (`dormer`) wear the walls' cladding, the front a sash window in it
 * ({@link FACADE_DORMER}); the roof (`dormer-roof`) the roof's. Returns how
 * many it built: none where the slope is too low for one under the ridge.
 */
function dormers(
  writing: Writing,
  rectangle: Rectangle,
  heights: readonly [eaves: number, floor: number],
  ridge: Ridge,
  pitchDegrees: number,
  placing: { readonly side: number; readonly count: number; readonly reach: number },
  styles: { readonly wall: Style; readonly roof: Style },
): number {
  const { cx, cz, ux, uz, halfShort } = rectangle;
  const { side, count } = placing;
  const [eaves, floor] = heights;
  const pitch = (pitchDegrees * Math.PI) / 180;
  const tan = Math.tan(pitch);
  const sin = Math.sin(pitch);
  const cos = Math.cos(pitch);
  const vx = -uz * side;
  const vz = ux * side;
  // `c` from the ridge's line toward the eaves; the slope is at `ridge.top − c·tan`.
  const at = (a: number, c: number, y: number): Vec => [
    cx + ux * a + vx * c,
    y,
    cz + uz * a + vz * c,
  ];
  const half = DORMER.width / 2;
  const front = halfShort - DORMER.setBack;
  const foot = ridge.top - front * tan;
  const head = foot + DORMER.front;
  const apex = head + half * tan;
  if (!(apex <= ridge.top - DORMER.belowRidge) || !(foot >= eaves)) return 0;
  const back = (ridge.top - head) / tan;
  const end = (ridge.top - apex) / tan;
  const places = count === 1 ? [0] : [-0.35 * placing.reach, 0.35 * placing.reach];
  const storeys = (y: number): number => (y - floor) / STOREY_METRES;
  const outward: Vec = [vx, 0, vz];
  for (const a0 of places) {
    const left = a0 - half;
    const right = a0 + half;
    // The front, a window in it, its `u, v` in metres.
    quad(
      writing.dormer,
      [
        at(left, front, foot),
        at(right, front, foot),
        at(right, front, head),
        at(left, front, head),
      ],
      outward,
      [
        [0, storeys(foot)],
        [DORMER.width / BAY_METRES, storeys(foot)],
        [DORMER.width / BAY_METRES, storeys(head)],
        [0, storeys(head)],
      ],
      {
        top: FACADE_DORMER,
        skip: -1,
        style: [styles.wall[0], styles.wall[1], DORMER.width, DORMER.front],
      },
      [
        [0, 0],
        [DORMER.width, 0],
        [DORMER.width, DORMER.front],
        [0, DORMER.front],
      ],
    );
    // Its gable over the front.
    const gableUv: Three<Pair> = [
      [0, storeys(head)],
      [DORMER.width / BAY_METRES, storeys(head)],
      [half / BAY_METRES, storeys(apex)],
    ];
    triangle(
      writing.dormer,
      [at(left, front, head), at(right, front, head), at(a0, front, apex)],
      outward,
      gableUv,
      plainIn(styles.wall),
      gableUv,
    );
    // Its cheeks, from the front back to where its eaves meet the slope.
    for (const [a, sign] of [
      [left, -1],
      [right, 1],
    ] as const) {
      const cheekUv: Three<Pair> = [
        [0, storeys(foot)],
        [0, storeys(head)],
        [(front - back) / BAY_METRES, storeys(head)],
      ];
      triangle(
        writing.dormer,
        [at(a, front, foot), at(a, front, head), at(a, back, head)],
        [ux * sign, 0, uz * sign],
        cheekUv,
        plainIn(styles.wall),
        cheekUv,
      );
    }
    // Its roof: two slopes from its eaves to its ridge, back to the main slope.
    const slopeLength = half / cos;
    for (const [eave, sign] of [
      [left, -1],
      [right, 1],
    ] as const) {
      const uv: Four<Pair> = [
        [front / STOREY_METRES, 0],
        [front / STOREY_METRES, slopeLength / STOREY_METRES],
        [end / STOREY_METRES, slopeLength / STOREY_METRES],
        [back / STOREY_METRES, 0],
      ];
      quad(
        writing['dormer-roof'],
        [at(eave, front, head), at(a0, front, apex), at(a0, end, apex), at(eave, back, head)],
        [ux * sign * sin, cos, uz * sign * sin],
        uv,
        plainIn(styles.roof),
        [
          [front, 0],
          [front, slopeLength],
          [end, slopeLength],
          [back, 0],
        ],
      );
    }
  }
  return places.length;
}

/** The outer ring's edge a front door goes on, and how far its middle is from the road. */
interface DoorEdge {
  readonly edge: number;
  readonly distance: number;
  /** The edge's length, so a canopy is only put where it fits between the corners. */
  readonly length: number;
}

/**
 * The outer ring's edge whose middle is nearest the road and is wide enough
 * for a door in its surround ({@link DOOR_FACE}); none where no edge is.
 */
function doorEdgeOf(
  ring: Ring,
  road: DrawnRoadPoints,
  segments: readonly number[],
): DoorEdge | undefined {
  const n = ring.length / 2;
  const beside: BesideTheRoad = { along: 0, lateral: 0, distance: 0 };
  let best = -1;
  let bestLength = 0;
  let nearest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const ax = ring[i * 2] as number;
    const az = ring[i * 2 + 1] as number;
    const bx = ring[j * 2] as number;
    const bz = ring[j * 2 + 1] as number;
    const length = Math.hypot(bx - ax, bz - az);
    if (length < DOOR_FACE.width + 0.4) continue;
    if (!nearestOnRoadSegments(road, segments, (ax + bx) / 2, (az + bz) / 2, beside)) continue;
    if (beside.distance < nearest) {
      nearest = beside.distance;
      best = i;
      bestLength = length;
    }
  }
  return best < 0 ? undefined : { edge: best, distance: nearest, length: bestLength };
}

/** The middle of a ring's edge, its direction along, and its outward normal. */
interface EdgeFrame {
  readonly mx: number;
  readonly mz: number;
  readonly ex: number;
  readonly ez: number;
  readonly nx: number;
  readonly nz: number;
}

function edgeFrameOf(ring: Ring, edge: number): EdgeFrame {
  const n = ring.length / 2;
  const j = (edge + 1) % n;
  const ax = ring[edge * 2] as number;
  const az = ring[edge * 2 + 1] as number;
  const bx = ring[j * 2] as number;
  const bz = ring[j * 2 + 1] as number;
  const length = Math.hypot(bx - ax, bz - az);
  const outward = signedArea(ring) > 0 ? 1 : -1;
  const ex = (bx - ax) / length;
  const ez = (bz - az) / length;
  return { mx: (ax + bx) / 2, mz: (az + bz) / 2, ex, ez, nx: ez * outward, nz: -ex * outward };
}

/**
 * The front door — `buildings.ts` §`DOOR`'s leaf in a painted surround
 * ({@link DOOR_FACE}, #1581) — on the middle of its edge, standing on `floor`,
 * a little proud of the wall. The shader draws the leaf and the surround;
 * since #1590 a shop's (`style`, {@link STYLE_COMMERCIAL}) a glazed leaf in a
 * recess.
 */
function door(into: number[], at: EdgeFrame, floor: number, style: Style = NO_STYLE): void {
  const { ex, ez, nx, nz } = at;
  const mx = at.mx + nx * DOOR_PROUD_METRES;
  const mz = at.mz + nz * DOOR_PROUD_METRES;
  const half = DOOR_FACE.width / 2;
  const unit: Four<Pair> = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  quad(
    into,
    [
      [mx - ex * half, floor, mz - ez * half],
      [mx + ex * half, floor, mz + ez * half],
      [mx + ex * half, floor + DOOR_FACE.height, mz + ez * half],
      [mx - ex * half, floor + DOOR_FACE.height, mz - ez * half],
    ],
    [nx, 0, nz],
    unit,
    { top: FACADE_DOOR, skip: -1, style },
    unit,
  );
}

/** A shop's front, decided — #1590: its width and height on its wall, and its awning's depth, or 0. */
interface ShopPlan {
  readonly width: number;
  readonly height: number;
  /** The sign band's height, or 0 where there is no room under the eaves for one. */
  readonly sign: number;
  readonly signPaint: number;
  readonly awning: number;
  readonly awningPaint: number;
  readonly striped: boolean;
}

/**
 * A shop's front on the edge `at`, standing on `floor` — #1590: the shop
 * front's face over the ground storey ({@link FACADE_SHOPFRONT}), the sign
 * band's over it ({@link FACADE_SIGN}), and with `shop.awning` an awning
 * between them ({@link FACADE_AWNING}): its canvas and the canvas's
 * underside, its valance either side, and a cheek at either end. Every face's
 * `u, v` are metres; the shader paints all of it.
 */
function shopFront(into: number[], at: EdgeFrame, floor: number, shop: ShopPlan): void {
  const { ex, ez, nx, nz } = at;
  const point = (a: number, n: number, y: number): Vec => [
    at.mx + ex * a + nx * n,
    y,
    at.mz + ez * a + nz * n,
  ];
  const out: Vec = [nx, 0, nz];
  const half = shop.width / 2;
  const metres = (w: number, h: number): Four<Pair> => [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  quad(
    into,
    [
      point(-half, SHOP_FRONT_PLACE.proud, floor),
      point(half, SHOP_FRONT_PLACE.proud, floor),
      point(half, SHOP_FRONT_PLACE.proud, floor + shop.height),
      point(-half, SHOP_FRONT_PLACE.proud, floor + shop.height),
    ],
    out,
    UNMAPPED,
    {
      top: FACADE_SHOPFRONT,
      skip: -1,
      style: [CLAD_PHOTOGRAPH, STYLE_COMMERCIAL, shop.width, shop.height],
    },
    metres(shop.width, shop.height),
  );
  if (shop.sign > 0) {
    const bottom = floor + shop.height + SIGN_BAND.gap;
    quad(
      into,
      [
        point(-half, SIGN_BAND.proud, bottom),
        point(half, SIGN_BAND.proud, bottom),
        point(half, SIGN_BAND.proud, bottom + shop.sign),
        point(-half, SIGN_BAND.proud, bottom + shop.sign),
      ],
      out,
      UNMAPPED,
      {
        top: FACADE_SIGN,
        skip: -1,
        style: [CLAD_PHOTOGRAPH, shop.signPaint, shop.width, shop.sign],
      },
      metres(shop.width, shop.sign),
    );
  }
  if (shop.awning > 0) {
    const a0 = -half + AWNING.inset;
    const a1 = half - AWNING.inset;
    const length = a1 - a0;
    const top = floor + shop.height;
    const low = top - AWNING.drop;
    const d = shop.awning;
    const slope = Math.hypot(d, AWNING.drop);
    const face: Face = {
      top: FACADE_AWNING,
      skip: -1,
      style: [CLAD_PHOTOGRAPH, shop.striped ? 1 : 0, length, shop.awningPaint],
    };
    const up: Vec = [nx * (AWNING.drop / slope), d / slope, nz * (AWNING.drop / slope)];
    const corners: Four<Vec> = [
      point(a0, d, low),
      point(a1, d, low),
      point(a1, 0, top),
      point(a0, 0, top),
    ];
    const canvas: Four<Pair> = [
      [0, slope],
      [length, slope],
      [length, 0],
      [0, 0],
    ];
    quad(into, corners, up, UNMAPPED, face, canvas);
    quad(into, corners, [-up[0], -up[1], -up[2]], UNMAPPED, face, canvas);
    // The valance: a strip hanging from the outer edge, seen from either side.
    const valance: Four<Vec> = [
      point(a0, d, low - AWNING.valance),
      point(a1, d, low - AWNING.valance),
      point(a1, d, low),
      point(a0, d, low),
    ];
    const hanging: Four<Pair> = [
      [0, slope + AWNING.valance],
      [length, slope + AWNING.valance],
      [length, slope],
      [0, slope],
    ];
    quad(into, valance, out, UNMAPPED, face, hanging);
    quad(into, valance, [-nx, 0, -nz], UNMAPPED, face, hanging);
    // A cheek at either end, under the canvas.
    for (const [a, sign] of [
      [a0, -1],
      [a1, 1],
    ] as const) {
      triangle(
        into,
        [point(a, 0, top), point(a, d, low), point(a, 0, low)],
        [ex * sign, 0, ez * sign],
        [AT_NOUGHT, AT_NOUGHT, AT_NOUGHT],
        face,
        [
          [0, 0],
          [0, slope],
          [0, AWNING.drop],
        ],
      );
    }
  }
}

/**
 * A commercial roof's cornice along the top of its parapet, round the outer
 * ring — #1590, {@link CORNICE}'s size, painted (`trim`): along each wall a
 * front {@link CORNICE}'s projection out, a soffit under it back to the
 * wall, and a cap over it and the parapet's top. Its corners are mitred, the
 * projection taken along each corner's bisector.
 */
function cornice(into: number[], ring: Ring, top: number): void {
  const n = ring.length / 2;
  const outward = signedArea(ring) > 0 ? 1 : -1;
  const normals: Pair[] = [];
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const dx = (ring[j * 2] as number) - (ring[i * 2] as number);
    const dz = (ring[j * 2 + 1] as number) - (ring[i * 2 + 1] as number);
    const length = Math.hypot(dx, dz);
    normals.push(length > 1e-6 ? [(dz / length) * outward, (-dx / length) * outward] : [0, 0]);
  }
  // Each corner's projected point: along the bisector of its two walls' normals.
  const outer: Pair[] = [];
  for (let i = 0; i < n; i += 1) {
    const [ax, az] = normals[(i + n - 1) % n] as Pair;
    const [bx, bz] = normals[i] as Pair;
    const scale = CORNICE.projection / Math.max(0.3, 1 + ax * bx + az * bz);
    outer.push([
      (ring[i * 2] as number) + (ax + bx) * scale,
      (ring[i * 2 + 1] as number) + (az + bz) * scale,
    ]);
  }
  const bottom = top - CORNICE.depth;
  const cap = top + CORNICE.cap;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const [nx, nz] = normals[i] as Pair;
    if (nx === 0 && nz === 0) continue;
    const a: Pair = [ring[i * 2] as number, ring[i * 2 + 1] as number];
    const b: Pair = [ring[j * 2] as number, ring[j * 2 + 1] as number];
    const a1 = outer[i] as Pair;
    const b1 = outer[j] as Pair;
    const at = (p: Pair, y: number): Vec => [p[0], y, p[1]];
    quad(
      into,
      [at(a1, bottom), at(b1, bottom), at(b1, cap), at(a1, cap)],
      [nx, 0, nz],
      UNMAPPED,
      PAINTED,
    );
    quad(
      into,
      [at(a, bottom), at(b, bottom), at(b1, bottom), at(a1, bottom)],
      [0, -1, 0],
      UNMAPPED,
      PAINTED,
    );
    quad(into, [at(a1, cap), at(b1, cap), at(b, cap), at(a, cap)], [0, 1, 0], UNMAPPED, PAINTED);
  }
}

/** How far a canopy's underside is above the top of the door's surround: **0.1 m**. */
const PORCH_ABOVE_DOOR_METRES = 0.1;

/**
 * A canopy over the front door, {@link PORCH}'s size, and with `posts` the two
 * posts it stands on — #1581, painted (`trim`).
 */
function porch(into: number[], at: EdgeFrame, floor: number, posts: boolean): void {
  const bottom = floor + DOOR_FACE.height + PORCH_ABOVE_DOOR_METRES;
  const top = bottom + PORCH.thickness;
  const axis: Pair = [at.ex, at.ez];
  const out = PORCH.depth / 2;
  box(
    into,
    [at.mx + at.nx * out, at.mz + at.nz * out],
    axis,
    [PORCH.width / 2, out],
    [bottom, top, floor],
    PAINTED,
    { top: true, bottom: true },
  );
  if (!posts) return;
  const halfPost = PORCH.post / 2;
  const outward = PORCH.depth - halfPost;
  for (const end of [1, -1]) {
    const along = end * (PORCH.width / 2 - halfPost);
    box(
      into,
      [at.mx + at.ex * along + at.nx * outward, at.mz + at.ez * along + at.nz * outward],
      axis,
      [halfPost, halfPost],
      [floor, bottom, floor],
      PAINTED,
      { top: false, bottom: false },
    );
  }
}

/**
 * Where a front porch's roof may meet its wall at the most — #1589: under
 * the eaves, and on a house of more than one storey under the next storey's
 * floor, so that it is tied below the upstairs windows. Under a pitched roof
 * it is below the gutter's foot (`GUTTER`), so it passes under the gutter
 * and the soffit; under a flat roof, below the roof itself.
 */
export function porchWallTopOf(
  floor: number,
  eaves: number,
  roof: FootprintRoof,
  pitchDegrees: number,
): number {
  const storey = floor + STOREY_METRES - 0.05;
  if (roof === 'flat') return Math.min(storey, eaves - 0.15);
  const eaveY = eaves - EAVES_OVERHANG_METRES * Math.tan((pitchDegrees * Math.PI) / 180);
  return Math.min(storey, eaveY - GUTTER.below - GUTTER.depth - 0.03);
}

/** What {@link frontPorchOf} reads of a house besides its seeded draws. */
export interface PorchSite {
  /** The front edge's length, and the garage's bay along it where there is one. */
  readonly length: number;
  readonly garage?: { readonly along: number; readonly width: number };
  readonly floor: number;
  /** Where the roof may meet the wall at the most. @see porchWallTopOf */
  readonly wallTop: number;
  /** The drawn ground at `(a, n)` in the porch's frame. */
  readonly groundAt: (a: number, n: number) => number;
  /** The lowest drawn ground under the house, which the deck's skirt reaches below. */
  readonly lowest: number;
  /** Whether a ring of `(a, n)` corners in the porch's frame is clear of the road, every footprint, and every porch and driveway placed. */
  readonly clear: (corners: readonly (readonly [number, number])[]) => boolean;
}

/** A front porch's seeded draws, each in `[0, 1)`. */
export interface PorchDraws {
  readonly width: number;
  readonly depth: number;
  readonly posts: number;
  readonly side: number;
  readonly roof: number;
}

/**
 * The ground a front porch takes — #1589: its deck, its roof's overhang and
 * its steps, as `(a, n)` corners in its frame, from just off the wall.
 */
export function porchRingOf(
  spec: Pick<PorchSpec, 'from' | 'to' | 'depth' | 'steps'>,
): readonly (readonly [number, number])[] {
  const { overhang } = FRONT_PORCH;
  const reach = porchReachOf(spec);
  return [
    [spec.from - overhang, 0.05],
    [spec.to + overhang, 0.05],
    [spec.to + overhang, reach],
    [spec.from - overhang, reach],
  ];
}

/**
 * A house's front porch, or none — #1589. Its span along the wall
 * (`porch.ts` §`porchSpanOf`) keeps {@link FRONT_PORCH}'s `endMargin` from
 * either end and from a garage's bay. Its depth is seeded and **shortened**
 * by `shorten` at a time while the porch, its roof's overhang and its steps
 * would come within the road's clearance, onto any footprint, or (#1601)
 * onto a porch or a driveway already placed (`site.clear`, its ring
 * {@link porchRingOf}), and the porch is **dropped** where even `leastDepth`
 * would. It is dropped too where its roof cannot be tied under the eaves
 * with headroom under its header (`porchPitchOf`), or the ground is too far
 * below its deck for three steps (`porchStepsOf`).
 */
export function frontPorchOf(site: PorchSite, draws: PorchDraws): PorchSpec | undefined {
  const { endMargin, width, depth: depthRange, shorten, leastDepth } = FRONT_PORCH;
  let left = site.length / 2 - endMargin;
  let right = site.length / 2 - endMargin;
  if (site.garage !== undefined) {
    const { along, width: bay } = site.garage;
    if (along > 0) right = Math.min(right, along - bay / 2 - endMargin);
    else left = Math.min(left, -along - bay / 2 - endMargin);
  }
  const span = porchSpanOf(
    { left, right },
    width.least + (width.most - width.least) * draws.width,
    draws.posts < FRONT_PORCH.fourPostShare,
    draws.side < 0.5 ? 1 : -1,
  );
  if (span === undefined) return undefined;
  const { stepsAt } = span;
  for (
    let depth = depthRange.least + (depthRange.most - depthRange.least) * draws.depth;
    depth >= leastDepth - 1e-9;
    depth -= shorten
  ) {
    const foot = site.groundAt(stepsAt, depth + 2 * FRONT_PORCH.step.tread);
    const steps = porchStepsOf(site.floor - foot);
    if (steps === undefined) return undefined;
    if (!site.clear(porchRingOf({ ...span, depth, steps }))) continue;
    const hip = draws.roof < FRONT_PORCH.hipShare && hipFits(span.to - span.from, depth);
    const roof = hip ? 'hip' : 'shed';
    const pitchDegrees = porchPitchOf(
      site.floor,
      site.wallTop,
      depth,
      FRONT_PORCH.pitchDegrees[roof],
    );
    if (pitchDegrees === undefined) return undefined;
    return {
      ...span,
      depth,
      floor: site.floor,
      ground: foot,
      footing: Math.min(foot, site.lowest) - FOUNDATION_METRES / 2,
      wallY: site.wallTop,
      roof,
      pitchDegrees,
      steps,
    };
  }
  return undefined;
}

/**
 * A front porch's pieces into `writing` on the front edge `at` — #1589: its
 * roof `porch-roof` in the roof's `roofStyle`, the shingles' courses up its
 * slope in metres; its railing `porch` with {@link FACADE_RAILING}'s
 * pattern; its steps and its fascia `porch-trim`; and the rest `porch`, painted.
 */
function frontPorch(
  writing: Pick<Writing, 'porch' | 'porch-roof' | 'porch-trim'>,
  at: EdgeFrame,
  spec: PorchSpec,
  roofStyle: Style,
): void {
  const { mx, mz, ex, ez, nx, nz } = at;
  const world = (p: PorchPoint): Vec => [
    mx + ex * p[0] + nx * p[1],
    p[2],
    mz + ez * p[0] + nz * p[1],
  ];
  const direction = (p: PorchPoint): Vec => [ex * p[0] + nx * p[1], p[2], ez * p[0] + nz * p[1]];
  const sinPitch = Math.sin((spec.pitchDegrees * Math.PI) / 180);
  const draw = (
    into: number[],
    piece: PorchPiece,
    face: Face,
    facade: readonly Pair[],
    uv: readonly Pair[],
  ): void => {
    const corners = piece.corners.map(world);
    const normal = direction(piece.normal);
    if (corners.length === 4) {
      quad(
        into,
        corners as unknown as Four<Vec>,
        normal,
        uv as Four<Pair>,
        face,
        facade as Four<Pair>,
      );
    } else {
      triangle(
        into,
        corners as unknown as Three<Vec>,
        normal,
        uv as Three<Pair>,
        face,
        facade as Three<Pair>,
      );
    }
  };
  const nought = (piece: PorchPiece): Pair[] => piece.corners.map((): Pair => AT_NOUGHT);
  for (const piece of porchPieces(spec)) {
    switch (piece.part) {
      case 'roof': {
        // Along its eaves and up its slope, in metres: a hip's end runs out from the wall.
        const low = Math.min(...piece.corners.map((p) => p[2]));
        const across = Math.abs(piece.normal[0]) > Math.abs(piece.normal[1]) ? 1 : 0;
        const metres = piece.corners.map((p): Pair => [p[across], (p[2] - low) / sinPitch]);
        const uv = metres.map((m): Pair => [m[0] / BAY_METRES, m[1] / STOREY_METRES]);
        draw(writing['porch-roof'], piece, plainIn(roofStyle), metres, uv);
        break;
      }
      case 'railing': {
        const { length, height } = piece.railing ?? { length: 0, height: 0 };
        draw(
          writing.porch,
          piece,
          { top: FACADE_RAILING, skip: -1, style: [CLAD_PHOTOGRAPH, 0, length, height] },
          [
            [0, 0],
            [length, 0],
            [length, height],
            [0, height],
          ],
          nought(piece),
        );
        break;
      }
      case 'step':
      case 'fascia':
        draw(writing['porch-trim'], piece, PAINTED, nought(piece), nought(piece));
        break;
      default:
        draw(writing.porch, piece, PAINTED, nought(piece), nought(piece));
    }
  }
}

/**
 * A garage's door — #1588: over the whole of a front's bay, `along` from the
 * edge's middle and `width` wide, a little proud of the wall, from the ground
 * in front of it to {@link GARAGE}'s reach above the floor, so that it covers
 * the ground storey's window in that bay. The shader draws its panelled leaf
 * and its surround ({@link FACADE_GARAGE}); its `u, v` are metres.
 */
function garageDoor(
  into: number[],
  at: EdgeFrame,
  along: number,
  width: number,
  heights: readonly [ground: number, floor: number],
): void {
  const { ex, ez, nx, nz } = at;
  const [ground, floor] = heights;
  const mx = at.mx + ex * along + nx * DOOR_PROUD_METRES;
  const mz = at.mz + ez * along + nz * DOOR_PROUD_METRES;
  const half = width / 2;
  const top = floor + GARAGE.reach;
  const height = top - ground;
  quad(
    into,
    [
      [mx - ex * half, ground, mz - ez * half],
      [mx + ex * half, ground, mz + ez * half],
      [mx + ex * half, top, mz + ez * half],
      [mx - ex * half, top, mz - ez * half],
    ],
    [nx, 0, nz],
    UNMAPPED,
    { top: FACADE_GARAGE, skip: -1, style: [CLAD_PHOTOGRAPH, 0, width, GARAGE.leaf] },
    [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ],
  );
}

/** A driveway, planned: where it starts, which way it runs, how wide and how long. */
interface DrivewayPlan {
  readonly x: number;
  readonly z: number;
  /** Out from the wall, unit. */
  readonly nx: number;
  readonly nz: number;
  /** Along the wall, unit. */
  readonly ex: number;
  readonly ez: number;
  readonly width: number;
  readonly length: number;
}

/** A driveway's outline, its four corners round it. */
function drivewayRing(plan: DrivewayPlan): Ring {
  const { x, z, nx, nz, ex, ez, width, length } = plan;
  const h = width / 2;
  return Float32Array.of(
    x - ex * h,
    z - ez * h,
    x + ex * h,
    z + ez * h,
    x + ex * h + nx * length,
    z + ez * h + nz * length,
    x - ex * h + nx * length,
    z - ez * h + nz * length,
  );
}

/**
 * A driveway's paving — #1588: a strip `plan.length` long from the garage,
 * laid {@link DRIVEWAY}'s lift above the drawn ground in pieces no longer
 * than its `piece`, each corner on the ground beneath it, so it follows a
 * slope rather than floating over it or sinking into it. The shader paints
 * it ({@link CLAD_PAVING}); its `u, v` are metres across and along.
 */
function drivewayPaving(
  into: number[],
  plan: DrivewayPlan,
  groundAt: (x: number, z: number) => number,
): void {
  const { x, z, nx, nz, ex, ez, width, length } = plan;
  const pieces = Math.max(1, Math.ceil(length / DRIVEWAY.piece));
  const h = width / 2;
  const at = (t: number, side: number): Vec => {
    const px = x + nx * t + ex * h * side;
    const pz = z + nz * t + ez * h * side;
    return [px, groundAt(px, pz) + DRIVEWAY.lift, pz];
  };
  const face = plainIn([CLAD_PAVING, 0, width, -1]);
  for (let piece = 0; piece < pieces; piece += 1) {
    const t0 = (length * piece) / pieces;
    const t1 = (length * (piece + 1)) / pieces;
    quad(into, [at(t0, -1), at(t0, 1), at(t1, 1), at(t1, -1)], [0, 1, 0], UNMAPPED, face, [
      [0, t0],
      [width, t0],
      [width, t1],
      [0, t1],
    ]);
  }
}

/** The side of a cell of {@link RingGrid}: **32 m**. */
const RING_CELL_METRES = 32;

/**
 * Every footprint of a corridor in a grid — #1588, so a driveway can be kept
 * off every other building, planned or not. Since #1601 also every porch and
 * driveway placed so far, {@link RingGrid.add}ed as each plan is made.
 */
export class RingGrid {
  readonly #rings: Ring[] = [];
  readonly #cells = new Map<number, number[]>();

  constructor(rings: readonly Ring[]) {
    for (const ring of rings) this.add(ring);
  }

  /** Adds `ring`, as the next index. */
  add(ring: Ring): void {
    const index = this.#rings.length;
    this.#rings.push(ring);
    const [minX, maxX, minZ, maxZ] = boundsOf(ring);
    for (
      let ix = Math.floor(minX / RING_CELL_METRES);
      ix <= Math.floor(maxX / RING_CELL_METRES);
      ix += 1
    ) {
      for (
        let iz = Math.floor(minZ / RING_CELL_METRES);
        iz <= Math.floor(maxZ / RING_CELL_METRES);
        iz += 1
      ) {
        const key = (ix + 0x8000) * 0x1_0000 + (iz + 0x8000);
        const list = this.#cells.get(key);
        if (list === undefined) this.#cells.set(key, [index]);
        else list.push(index);
      }
    }
  }

  /** Whether `quad` (four corners) meets any ring but the `own`th. */
  meets(quad: Ring, own: number): boolean {
    const [minX, maxX, minZ, maxZ] = boundsOf(quad);
    const seen = new Set<number>();
    for (
      let ix = Math.floor(minX / RING_CELL_METRES);
      ix <= Math.floor(maxX / RING_CELL_METRES);
      ix += 1
    ) {
      for (
        let iz = Math.floor(minZ / RING_CELL_METRES);
        iz <= Math.floor(maxZ / RING_CELL_METRES);
        iz += 1
      ) {
        for (const index of this.#cells.get((ix + 0x8000) * 0x1_0000 + (iz + 0x8000)) ?? []) {
          if (index === own || seen.has(index)) continue;
          seen.add(index);
          if (ringsMeet(quad, this.#rings[index] as Ring)) return true;
        }
      }
    }
    return false;
  }
}

/** A ring's bounding box: `minX, maxX, minZ, maxZ`. */
function boundsOf(ring: Ring): readonly [number, number, number, number] {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let i = 0; i + 1 < ring.length; i += 2) {
    minX = Math.min(minX, ring[i] as number);
    maxX = Math.max(maxX, ring[i] as number);
    minZ = Math.min(minZ, ring[i + 1] as number);
    maxZ = Math.max(maxZ, ring[i + 1] as number);
  }
  return [minX, maxX, minZ, maxZ];
}

/** Whether two rings overlap: an edge of one crosses the other's, or one stands inside the other. */
function ringsMeet(a: Ring, b: Ring): boolean {
  if (b.length < 6 || a.length < 6) return false;
  if (insideRing(b, a[0] as number, a[1] as number)) return true;
  if (insideRing(a, b[0] as number, b[1] as number)) return true;
  const n = a.length / 2;
  const m = b.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    for (let k = 0, l = m - 1; k < m; l = k, k += 1) {
      if (
        segmentsMeet(
          a[j * 2] as number,
          a[j * 2 + 1] as number,
          a[i * 2] as number,
          a[i * 2 + 1] as number,
          b[l * 2] as number,
          b[l * 2 + 1] as number,
          b[k * 2] as number,
          b[k * 2 + 1] as number,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

/** How far along the ridge from its middle a chimney stands, as a share of its half: **0.7**. */
const CHIMNEY_ALONG_RIDGE = 0.7;

/** A chimney astride the ridge, toward its `end` — #1581, {@link CHIMNEY}'s size, wearing the walls. */
function chimney(
  into: number[],
  rectangle: Rectangle,
  ridge: Ridge,
  heights: readonly [eaves: number, floor: number],
  end: number,
): void {
  const along = end * CHIMNEY_ALONG_RIDGE * Math.min(ridge.half, rectangle.halfLong);
  box(
    into,
    [rectangle.cx + rectangle.ux * along, rectangle.cz + rectangle.uz * along],
    [rectangle.ux, rectangle.uz],
    [CHIMNEY.along / 2, CHIMNEY.across / 2],
    [heights[0], ridge.top + CHIMNEY.above, heights[1]],
    PLAIN,
    { top: true, bottom: false },
  );
}

/** How many triangles a role's floats are. */
function trianglesOf(floats: readonly number[]): number {
  return floats.length / (3 * FOOTPRINT_VERTEX_FLOATS);
}

/**
 * The reaches the nearest stretch of road is looked for within, doubling from
 * a cell of `road-grid.ts`' grid to past a tile's far corner: a search costs
 * its reach squared, and most footprints are near the road.
 */
const GROUND_REACHES = [32, 64, 128, 256, 512, 1_024, 2_560] as const;

/** Scratch: the road segments near the footprint being planned. */
const nearSegments: number[] = [];

/** Scratch: the road segments near a front porch being placed — #1589. */
const porchSegments: number[] = [];

/**
 * Every mapped footprint in the corridor, planned or dropped — #1540.
 *
 * `land` is the ride's land-class mask (#1546), built from the same corridor;
 * `NO_LAND_CLASS` reads every footprint as on unmapped land, which is rule 2
 * switched off. `urban` is the ride's urban class (#1633), built at the press
 * beside the mask; with none every plan's {@link FootprintPlan.urban} is
 * `unknown`. `maxVertices` is rule 6's cap, a parameter so the triangle
 * budget's control can lift it.
 */
export function footprintPlans(
  corridor: WorldCorridor,
  land: LandClassMask,
  profile: RouteProfile,
  origin: CorridorOrigin,
  maxVertices: number = FOOTPRINT_MAX_VERTICES,
  urban?: UrbanClassMap,
): { readonly plans: readonly FootprintPlan[]; readonly verdicts: FootprintVerdicts } {
  const seed = scatterSeed(profile);
  const counts: Record<FootprintVerdict, number> = {
    kept: 0,
    'on-excluded-land': 0,
    'on-road': 0,
    'too-steep': 0,
    'too-small': 0,
    'too-large': 0,
  };
  const plans: FootprintPlan[] = [];
  // #1588: every footprint, planned or not, so a driveway keeps off each.
  const others = new RingGrid(
    corridor.buildings.map((building) => building.rings[0] ?? new Float32Array(0)),
  );
  // #1601: every porch and driveway placed so far, so a porch keeps off a
  // neighbour's porch and drive, and a driveway off a neighbour's porch.
  const porches = new RingGrid([]);
  const driveways = new RingGrid([]);
  for (const [index, building] of corridor.buildings.entries()) {
    const planned = planFootprint(
      building,
      corridor,
      land,
      urban,
      profile,
      origin,
      seed,
      maxVertices,
      { grid: others, own: index, porches, driveways },
    );
    if (typeof planned === 'string') {
      counts[planned] += 1;
    } else {
      counts.kept += 1;
      plans.push(planned);
    }
  }
  return { plans: paintTown(plans), verdicts: counts };
}

/** The entry a seeded draw in `[0, 1)` comes to, of `count`. */
function seededEntry(share: number, count: number): number {
  return Math.min(count - 1, Math.floor(share * count));
}

/** Whether two plans are painted alike: the same surfaces, in the same four paints. */
export function paintedAlike(a: FootprintPlan, b: FootprintPlan): boolean {
  return (
    a.surfaces.wall === b.surfaces.wall &&
    a.surfaces.roof === b.surfaces.roof &&
    a.paint.wall === b.paint.wall &&
    a.paint.roof === b.paint.roof &&
    a.paint.trim === b.paint.trim &&
    a.paint.door === b.paint.door
  );
}

/**
 * The entry of `count`, from `start` round, whose nearest wearer is farthest
 * away (`nearest`, infinite for one no neighbour wears): the first free one,
 * and where none is free, the one worn farthest off — so a list that runs out
 * repeats across the street before it repeats next door.
 */
function farthestEntry(start: number, count: number, nearest: (entry: number) => number): number {
  let best = start;
  let farthest = -1;
  for (let step = 0; step < count; step += 1) {
    const entry = (start + step) % count;
    const apart = nearest(entry);
    if (apart === Number.POSITIVE_INFINITY) return entry;
    if (apart > farthest) {
      farthest = apart;
      best = entry;
    }
  }
  return best;
}

/** A plan already painted within {@link PAINT_NEIGHBOUR_METRES}, and how far off. */
interface Neighbour {
  readonly plan: FootprintPlan;
  readonly apart: number;
}

/** How near the nearest of `near` that `wears` is: infinite where none does. */
function nearestWearer(
  near: readonly Neighbour[],
  wears: (plan: FootprintPlan) => boolean,
): number {
  let least = Number.POSITIVE_INFINITY;
  for (const { plan, apart } of near) if (apart < least && wears(plan)) least = apart;
  return least;
}

/**
 * The town's plans, painted so that no two neighbours match — #1581.
 *
 * In the corridor's order, each plan keeps its seeded paint where no plan
 * already painted within {@link PAINT_NEIGHBOUR_METRES} of it wears it, and
 * otherwise takes the next entry along that none does — or, where every one
 * is worn, the one worn farthest off ({@link farthestEntry}):
 *
 * 1. its **wall** paint, against the neighbours of the same wall surface;
 * 2. its **roof** paint, against those of the same roof surface — since
 *    #1588 a shingled roof's list is the shingles', and it wears `slate`;
 * 3. its **trim** and its **door**, against every neighbour.
 *
 * A list can run out — a street of more brick houses within 30 m than brick
 * has paints — and where one does that entry repeats; but the four together
 * do not: a plan still painted like a neighbour walks its trims and doors
 * until it is not, and there are 42 of those. So **no two plans within 30 m
 * are painted alike** ({@link paintedAlike}) while fewer than 42 neighbours
 * share both its surfaces, which `footprint-buildings.test.ts` holds over the
 * dense town. The order is the corridor's, so the same corridor paints the
 * same town.
 *
 * "Alike" compares the surface and the paint entry, not the cladding the rider
 * sees: shingled and plain slate roofs, or clapboard and plastered walls, with
 * the same entry count as alike. That only over-constrains the choice.
 */
function paintTown(plans: readonly FootprintPlan[]): FootprintPlan[] {
  const reach = PAINT_NEIGHBOUR_METRES;
  const cells = new Map<number, number[]>();
  const painted: FootprintPlan[] = [];
  const near: Neighbour[] = [];
  const key = (ix: number, iz: number): number => (ix + 0x8000) * 0x1_0000 + (iz + 0x8000);
  const alike = (each: FootprintPlan): boolean =>
    near.some((other) => paintedAlike(other.plan, each));
  for (const plan of plans) {
    const ix = Math.floor(plan.centroid.x / reach);
    const iz = Math.floor(plan.centroid.z / reach);
    near.length = 0;
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        for (const index of cells.get(key(ix + dx, iz + dz)) ?? []) {
          const other = painted[index] as FootprintPlan;
          const apart = Math.hypot(
            other.centroid.x - plan.centroid.x,
            other.centroid.z - plan.centroid.z,
          );
          if (apart <= reach) near.push({ plan: other, apart });
        }
      }
    }
    const { wall: wallSurface, roof: roofSurface } = plan.surfaces;
    const shingled = plan.cladding.roof === 'shingle';
    const paint: FootprintPaint = {
      wall: farthestEntry(plan.paint.wall, paintsOf(wallSurface)?.length ?? 1, (entry) =>
        nearestWearer(
          near,
          (other) => other.surfaces.wall === wallSurface && other.paint.wall === entry,
        ),
      ),
      roof: farthestEntry(
        plan.paint.roof,
        roofPaintsOf(roofSurface, shingled)?.length ?? 1,
        (entry) =>
          nearestWearer(
            near,
            (other) => other.surfaces.roof === roofSurface && other.paint.roof === entry,
          ),
      ),
      trim: farthestEntry(plan.paint.trim, TRIM_PAINTS.length, (entry) =>
        nearestWearer(near, (other) => other.paint.trim === entry),
      ),
      door: farthestEntry(plan.paint.door, DOOR_PAINTS.length, (entry) =>
        nearestWearer(near, (other) => other.paint.door === entry),
      ),
    };
    let candidate: FootprintPlan = { ...plan, paint };
    const combinations = TRIM_PAINTS.length * DOOR_PAINTS.length;
    for (let step = 1; alike(candidate) && step < combinations; step += 1) {
      candidate = {
        ...plan,
        paint: {
          ...paint,
          trim: (paint.trim + Math.floor(step / DOOR_PAINTS.length)) % TRIM_PAINTS.length,
          door: (paint.door + step) % DOOR_PAINTS.length,
        },
      };
    }
    const cell = key(ix, iz);
    const list = cells.get(cell);
    if (list === undefined) cells.set(cell, [painted.length]);
    else list.push(painted.length);
    painted.push(candidate);
  }
  return painted;
}

/**
 * What #1550's procedural lots read of a corridor (`settlements.ts`
 * §`MappedTown`): every kept plan's footprint, in a grid, and whether a place's
 * land is mapped `commercial`.
 *
 * ⚠️ Takes the plans, never plans them (#1583): `GameView` plans a corridor
 * once, at the press, and hands the same plans here and to #1549's belt, so
 * the first scene frame never pays #1540's 400 ms budget. The town is built
 * at the press too and carried on `SceneInput.mappedTown`.
 *
 * ⚠️ `commercialAt` reads `land-class.ts` §`kindAt`, which tests every
 * land-use polygon's box: so each answer is kept, by the place to the
 * decimetre, and a lot's place is a pure function of the route, so every
 * later frame and lap is a lookup.
 */
export function mappedTown(corridor: WorldCorridor, plans: readonly FootprintPlan[]): MappedTown {
  // #1588: a lot keeps off a driveway as it does off the house.
  const index = footprintIndexOf(
    plans.flatMap((plan) =>
      plan.driveway.length > 0 ? [plan.footprint, plan.driveway] : [plan.footprint],
    ),
  );
  // Keyed by decimetre, x then z: two small integers, never a boxed number.
  const commercial = new Map<number, Map<number, boolean>>();
  const town: MappedTown = {
    overlaps: (lot) => index.overlaps(lot),
    commercialAt(x, z) {
      const column = Math.round(x * 10);
      const row = Math.round(z * 10);
      let rows = commercial.get(column);
      if (rows === undefined) {
        rows = new Map();
        commercial.set(column, rows);
      }
      const known = rows.get(row);
      if (known !== undefined) return known;
      const answer = kindAt(corridor, x, z) === 'commercial';
      rows.set(row, answer);
      return answer;
    },
  };
  return town;
}

/** A plan with no driveway's outline: no ring. */
const NO_RING: Ring = new Float32Array(0);

/** A garage, planned — #1588: its bay of the front, where that is along it, and its driveway. */
interface Garage {
  readonly bay: number;
  /** From the front edge's middle to the bay's, along it. */
  readonly along: number;
  /** The bay's width: the garage door's. */
  readonly width: number;
  /** The drawn ground in front of it, which its door stands on. */
  readonly ground: number;
  readonly plan: DrivewayPlan;
}

/** How far a driveway is held off its own house's walls when it is checked against them: **5 cm**. */
const DRIVEWAY_CHECK_METRES = 0.05;

/**
 * A garage on bay `bay` of a front `length` metres long in `bays` — #1588,
 * with its driveway straight out from the wall to {@link DRIVEWAY}'s `short`
 * of the carriageway's edge, measured at the nearer of its far corners; or
 * none, where the wall does not face the road within {@link DRIVEWAY}'s
 * `longest`, or the driveway would cross any other footprint or its own, or
 * (#1601) a porch already placed in `others.porches`.
 */
export function garageOf(
  front: { readonly length: number; readonly bays: number; readonly bay: number },
  frame: EdgeFrame,
  road: DrawnRoadPoints,
  segments: readonly number[],
  own: {
    readonly ring: Ring;
    readonly others: {
      readonly grid: RingGrid;
      readonly own: number;
      readonly porches?: RingGrid;
    };
  },
  groundAt: (x: number, z: number) => number,
): Garage | undefined {
  const { length, bays, bay } = front;
  const bayWidth = length / bays;
  const along = (bay + 0.5) * bayWidth - length / 2;
  const x = frame.mx + frame.ex * along;
  const z = frame.mz + frame.ez * along;
  const width = bayWidth - 2 * DRIVEWAY.inset;
  const half = width / 2;
  const target = ROAD_WIDTH_METRES / 2 + DRIVEWAY.short;
  const beside: BesideTheRoad = { along: 0, lateral: 0, distance: 0 };
  const gap = (t: number): number => {
    let least = Number.POSITIVE_INFINITY;
    for (const side of [-1, 1]) {
      const px = x + frame.nx * t + frame.ex * half * side;
      const pz = z + frame.nz * t + frame.ez * half * side;
      if (nearestOnRoadSegments(road, segments, px, pz, beside)) {
        least = Math.min(least, beside.distance);
      }
    }
    return least - target;
  };
  // Out along the wall's normal by what is left to the road, until it is there.
  let t = 0;
  for (let step = 0; step < 16; step += 1) {
    const left = gap(t);
    if (!Number.isFinite(left)) return undefined;
    if (Math.abs(left) < 0.01) break;
    t += left;
  }
  if (!(t > 0 && t <= DRIVEWAY.longest) || !(Math.abs(gap(t)) < 0.05)) return undefined;
  const plan: DrivewayPlan = {
    x,
    z,
    nx: frame.nx,
    nz: frame.nz,
    ex: frame.ex,
    ez: frame.ez,
    width,
    length: t,
  };
  const checked = drivewayRing({
    ...plan,
    x: x + frame.nx * DRIVEWAY_CHECK_METRES,
    z: z + frame.nz * DRIVEWAY_CHECK_METRES,
    length: t - DRIVEWAY_CHECK_METRES,
  });
  if (
    own.others.grid.meets(checked, own.others.own) ||
    ringsMeet(checked, own.ring) ||
    own.others.porches?.meets(checked, -1) === true
  ) {
    return undefined;
  }
  return { bay, along, width: bayWidth, ground: groundAt(x, z), plan };
}

/** Scratch: the road segments near an awning being placed — #1590. */
const awningSegments: number[] = [];

/** A shop front's seeded draws, each in `[0, 1)` — #1590. */
interface ShopDraws {
  readonly sign: number;
  readonly awning: number;
  readonly paint: number;
  readonly stripes: number;
  readonly depth: number;
}

/**
 * A shop's front on a front wall `length` long, `room` from the floor to the
 * eaves — #1590, or none where the room is under {@link SHOP_FRONT_PLACE}'s
 * least. The front spans the wall less its `inset` either end, as tall as its
 * `height` or the room less 0.3 m; the sign band over it where it fits under
 * the eaves; and an awning on {@link AWNING}'s share, its depth seeded and
 * shortened 0.1 m at a time while its ring (`(a, n)` corners in the wall's
 * frame) is not `clear`, and none below its least.
 */
export function shopOf(
  length: number,
  room: number,
  clear: (corners: readonly (readonly [number, number])[]) => boolean,
  draws: ShopDraws,
): ShopPlan | undefined {
  const height = Math.min(SHOP_FRONT_PLACE.height, room - 0.3);
  if (height < SHOP_FRONT_PLACE.least) return undefined;
  const width = length - 2 * SHOP_FRONT_PLACE.inset;
  const sign = height + SIGN_BAND.gap + SIGN_BAND.height <= room - 0.05 ? SIGN_BAND.height : 0;
  let awning = 0;
  if (draws.awning < AWNING.share) {
    const half = width / 2 - AWNING.inset;
    const { least, most } = AWNING.depth;
    for (
      let depth = least + (most - least) * draws.depth;
      depth >= AWNING.leastDepth - 1e-9;
      depth -= 0.1
    ) {
      const ring = [
        [-half, 0.05],
        [half, 0.05],
        [half, depth],
        [-half, depth],
      ] as const;
      if (clear(ring)) {
        awning = depth;
        break;
      }
    }
  }
  return {
    width,
    height,
    sign,
    signPaint: seededEntry(draws.sign, SIGN_PAINTS.length),
    awning,
    awningPaint: seededEntry(draws.paint, AWNING_PAINTS.length),
    striped: draws.stripes < AWNING_STRIPED_SHARE,
  };
}

/**
 * Makes `triangles`' {@link PORCH_ROLES} written the first time any of them is
 * read — #1589 — by `write`, once, and kept: every later read is the same
 * array. @see FootprintPlan.triangles
 */
function porchOnRead(
  triangles: Record<FootprintRole, Float32Array>,
  write: () => Record<'porch' | 'porch-roof' | 'porch-trim', number[]>,
): void {
  let written: Record<'porch' | 'porch-roof' | 'porch-trim', Float32Array> | undefined;
  const read = (): typeof written & object => {
    if (written === undefined) {
      const floats = write();
      written = {
        porch: Float32Array.from(floats.porch),
        'porch-roof': Float32Array.from(floats['porch-roof']),
        'porch-trim': Float32Array.from(floats['porch-trim']),
      };
    }
    return written;
  };
  for (const role of PORCH_ROLES) {
    Object.defineProperty(triangles, role, { enumerable: true, get: () => read()[role] });
  }
}

/** One footprint: its plan, or the verdict that dropped it. */
function planFootprint(
  building: BuildingFeature,
  corridor: WorldCorridor,
  land: LandClassMask,
  urban: UrbanClassMap | undefined,
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  maxVertices: number,
  others: {
    readonly grid: RingGrid;
    readonly own: number;
    readonly porches: RingGrid;
    readonly driveways: RingGrid;
  },
): FootprintPlan | Exclude<FootprintVerdict, 'kept'> {
  const outer = building.rings[0];
  if (outer === undefined || outer.length < 6) return 'too-small';
  const centroid = centroidOf(outer);

  // 2. The land: the centroid and every vertex the map drew.
  const excluded = (x: number, z: number): boolean => {
    const here = land.classAt(x, z);
    return here === 'wood' || here === 'water' || here === 'park';
  };
  if (excluded(centroid.x, centroid.z)) return 'on-excluded-land';
  for (let i = 0; i + 1 < outer.length; i += 2) {
    if (excluded(outer[i] as number, outer[i + 1] as number)) return 'on-excluded-land';
  }

  // 6, ahead of its turn: the ring the rules below measure is the one drawn.
  const drawn = simplifyRing(outer, FOOTPRINT_SIMPLIFY_METRES, maxVertices);
  const radius = radiusAbout(drawn, centroid.x, centroid.z);

  // 3. The road: every stretch of it near enough to matter.
  let road = roadSegmentsNear(
    profile,
    origin,
    centroid.x,
    centroid.z,
    radius + ROAD_CLEARANCE_METRES,
    nearSegments,
  );
  if (nearSegments.length > 0 && ringToRoad(drawn, road, nearSegments) < ROAD_CLEARANCE_METRES) {
    return 'on-road';
  }

  // 4. The ground, beside the stretch of road each point is nearest. The
  // nearest stretch to any vertex is within the centroid's distance and twice
  // the radius of the centroid, so one list serves them all.
  const beside: BesideTheRoad = { along: 0, lateral: 0, distance: 0 };
  let found = false;
  for (const reach of GROUND_REACHES) {
    road = roadSegmentsNear(profile, origin, centroid.x, centroid.z, reach, nearSegments);
    // Every segment within `reach` was searched, so a nearest within it is the nearest.
    if (!nearestOnRoadSegments(road, nearSegments, centroid.x, centroid.z, beside)) continue;
    if (beside.distance > reach) continue;
    road = roadSegmentsNear(
      profile,
      origin,
      centroid.x,
      centroid.z,
      beside.distance + 2 * radius + 1,
      nearSegments,
    );
    found = true;
    break;
  }
  // Farther from the road than any tile of a corridor can be: no ground to stand on.
  if (!found) return 'too-steep';
  // #1633: the stretch of route the centroid is beside, before `beside` is reused.
  const urbanClass = urban?.classAt(beside.along) ?? 'unknown';
  const groundAt = (x: number, z: number): number => {
    nearestOnRoadSegments(road, nearSegments, x, z, beside);
    return terrainHeightAt(profile, origin, seed, beside.along, beside.lateral, land);
  };
  let lowest = groundAt(centroid.x, centroid.z);
  let highest = lowest;
  for (let i = 0; i + 1 < drawn.length; i += 2) {
    const height = groundAt(drawn[i] as number, drawn[i + 1] as number);
    lowest = Math.min(lowest, height);
    highest = Math.max(highest, height);
  }
  if (highest - lowest > FOOTPRINT_MAX_GROUND_RANGE_METRES) return 'too-steep';

  // 5. The size, as mapped.
  const area = footprintArea(building.rings);
  if (area < FOOTPRINT_MIN_AREA) return 'too-small';
  if (area > FOOTPRINT_MAX_AREA) return 'too-large';

  // The shape.
  // Rule 1: only a `building_part` stands on its `min_height`.
  const raised = building.kind === 'building_part' ? building.minHeightMetres : null;
  const part = raised !== null;
  const minHeight = raised ?? 0;
  const span =
    building.heightMetres === null ? null : Math.max(0, building.heightMetres - minHeight);
  const storeys = storeysFor(span);
  const wallHeight = span !== null && span > 0 ? span : storeys * STOREY_METRES;
  const base = part ? lowest + minHeight : lowest - FOUNDATION_METRES;
  const floor = part ? base : highest + PLINTH_TOP_METRES;
  const eaves = floor + wallHeight;

  const landClass = land.classAt(centroid.x, centroid.z);
  const use = footprintUse(landClass, kindAt(corridor, centroid.x, centroid.z));
  const rectangle = minimumAreaRectangle(drawn);
  const rectangularity = rectangle.area > 0 ? Math.abs(signedArea(drawn)) / rectangle.area : 0;
  const share = (stream: number): number => footprintShare(seed, centroid.x, centroid.z, stream);
  const pitched =
    area <= FOOTPRINT_GABLE_MAX_AREA &&
    rectangularity >= FOOTPRINT_GABLE_MIN_RECTANGULARITY &&
    wallHeight <= FOOTPRINT_GABLE_MAX_EAVES_METRES &&
    (use === 'residential' || use === 'farmland');
  // #1581: a pitched roof is a gable or, seeded, a hip; a barn is always a gable.
  const roof: FootprintRoof = !pitched
    ? 'flat'
    : use === 'residential' && share(STREAM_HIP) < HIP_SHARE
      ? 'hip'
      : 'gable';
  const pitchDegrees =
    roof === 'flat'
      ? 0
      : (ROOF_PITCHES_DEGREES[
          Math.floor(share(STREAM_PITCH) * ROOF_PITCHES_DEGREES.length)
        ] as number);
  const front = part ? undefined : doorEdgeOf(drawn, road, nearSegments);
  const frontFrame = front === undefined ? undefined : edgeFrameOf(drawn, front.edge);
  const residential = use === 'residential';
  const withChimney = roof !== 'flat' && residential && share(STREAM_CHIMNEY) < CHIMNEY_SHARE;
  // A canopy only where it stands clear of the road's clearance, as the walls do.
  const withPorch =
    front !== undefined &&
    residential &&
    front.length >= PORCH.width &&
    front.distance - PORCH.depth >= ROAD_CLEARANCE_METRES &&
    share(STREAM_PORCH) < PORCH_SHARE;
  const withPosts = share(STREAM_POSTS) < PORCH_POSTS_SHARE;

  // #1588: the US house — its cladding, its windows' style, a garage.
  const clapboard =
    residential && !part && storeys <= TOWER_STOREYS && share(STREAM_SIDING) < SIDING_SHARE;
  const shingled = roof !== 'flat' && share(STREAM_SHINGLE) < SHINGLE_SHARE;
  const { least, most } = CLAPBOARD_COURSE_METRES;
  const course = clapboard ? least + (most - least) * share(STREAM_COURSE) : 0;
  const wallClad = clapboard ? cladOf(CLAD_CLAPBOARD, course) : CLAD_PHOTOGRAPH;
  const brickFoundation = clapboard && share(STREAM_FOUNDATION) < BRICK_FOUNDATION_SHARE;
  const flags =
    (residential ? STYLE_SASH : 0) +
    (residential && share(STREAM_SHUTTERS) < SHUTTER_SHARE ? STYLE_SHUTTERS : 0) +
    (roof === 'flat' ? 0 : STYLE_EAVES) +
    (brickFoundation ? STYLE_BRICK_FOUNDATION : 0) +
    (use === 'commercial' ? STYLE_COMMERCIAL : 0);
  const wallStyle: Style = [wallClad, flags, 0, -1];
  const roofStyle: Style = shingled
    ? [cladOf(CLAD_SHINGLE, SHINGLE_COURSE_METRES), 0, 0, -1]
    : NO_STYLE;
  const frontBays = front === undefined ? 0 : baysOf(front.length);
  const garage =
    front !== undefined &&
    frontFrame !== undefined &&
    residential &&
    frontBays >= GARAGE_MIN_BAYS &&
    share(STREAM_GARAGE) < GARAGE_SHARE
      ? garageOf(
          {
            length: front.length,
            bays: frontBays,
            bay: share(STREAM_GARAGE_END) < 0.5 ? 0 : frontBays - 1,
          },
          frontFrame,
          road,
          nearSegments,
          { ring: drawn, others },
          groundAt,
        )
      : undefined;
  // #1590: a shop's front on a commercial building's front wall, where it is long enough.
  const shop =
    front !== undefined &&
    frontFrame !== undefined &&
    use === 'commercial' &&
    front.length >= SHOP_FRONT_MIN_WALL_METRES
      ? shopOf(
          front.length,
          eaves - floor,
          (corners) => {
            const ring = Float32Array.from(
              corners.flatMap(([a, n]) => [
                frontFrame.mx + frontFrame.ex * a + frontFrame.nx * n,
                frontFrame.mz + frontFrame.ez * a + frontFrame.nz * n,
              ]),
            );
            const middle = centroidOf(ring);
            const near = roadSegmentsNear(
              profile,
              origin,
              middle.x,
              middle.z,
              radiusAbout(ring, middle.x, middle.z) + ROAD_CLEARANCE_METRES,
              awningSegments,
            );
            return (
              (awningSegments.length === 0 ||
                ringToRoad(ring, near, awningSegments) >= ROAD_CLEARANCE_METRES) &&
              !others.grid.meets(ring, others.own) &&
              // #1601: nor through the building's own wing, past a reflex corner.
              !ringsMeet(ring, drawn)
            );
          },
          {
            sign: share(STREAM_SIGN),
            awning: share(STREAM_AWNING),
            paint: share(STREAM_AWNING_PAINT),
            stripes: share(STREAM_AWNING_STRIPES),
            depth: share(STREAM_AWNING_DEPTH),
          },
        )
      : undefined;
  // #1589: whether a porch's ring is clear of the road. The front edge's
  // middle is exactly `front.distance` from the nearest stretch of it, so a
  // ring within that less the clearance of it is, and only one nearer asks
  // the road, as rule 3 asks it of a footprint.
  const clearOfRoad = (ring: Ring): boolean => {
    if (front !== undefined && frontFrame !== undefined) {
      const reach = radiusAbout(ring, frontFrame.mx, frontFrame.mz);
      if (front.distance - reach >= ROAD_CLEARANCE_METRES) return true;
    }
    const middle = centroidOf(ring);
    const near = roadSegmentsNear(
      profile,
      origin,
      middle.x,
      middle.z,
      radiusAbout(ring, middle.x, middle.z) + ROAD_CLEARANCE_METRES,
      porchSegments,
    );
    return (
      porchSegments.length === 0 || ringToRoad(ring, near, porchSegments) >= ROAD_CLEARANCE_METRES
    );
  };
  // #1589: a front porch's or its ring's `(a, n)` corners in the front's frame, in the world.
  const onFront = (corners: readonly (readonly [number, number])[]): Ring =>
    frontFrame === undefined
      ? NO_RING
      : Float32Array.from(
          corners.flatMap(([a, n]) => [
            frontFrame.mx + frontFrame.ex * a + frontFrame.nx * n,
            frontFrame.mz + frontFrame.ez * a + frontFrame.nz * n,
          ]),
        );
  // #1589: a front porch round the door, where it fits; it replaces the canopy.
  const frontPorchSpec =
    front !== undefined &&
    frontFrame !== undefined &&
    residential &&
    share(STREAM_FRONT_PORCH) < FRONT_PORCH.share
      ? frontPorchOf(
          {
            length: front.length,
            ...(garage === undefined
              ? {}
              : { garage: { along: garage.along, width: garage.width } }),
            floor,
            wallTop: porchWallTopOf(floor, eaves, roof, pitchDegrees),
            lowest,
            groundAt: (a, n) =>
              groundAt(
                frontFrame.mx + frontFrame.ex * a + frontFrame.nx * n,
                frontFrame.mz + frontFrame.ez * a + frontFrame.nz * n,
              ),
            clear: (corners) => {
              const ring = onFront(corners);
              return (
                clearOfRoad(ring) &&
                !others.grid.meets(ring, others.own) &&
                !ringsMeet(ring, drawn) &&
                // #1601: and off every porch and driveway placed before it.
                !others.porches.meets(ring, -1) &&
                !others.driveways.meets(ring, -1)
              );
            },
          },
          {
            width: share(STREAM_PORCH_WIDTH),
            depth: share(STREAM_PORCH_DEPTH),
            posts: share(STREAM_PORCH_POSTS),
            side: share(STREAM_PORCH_SIDE),
            roof: share(STREAM_PORCH_ROOF),
          },
        )
      : undefined;
  const middle = (frontBays - 1) / 2;
  const picture =
    storeys === 1 &&
    residential &&
    frontBays >= 3 &&
    frontBays % 2 === 1 &&
    share(STREAM_PICTURE) < PICTURE_SHARE
      ? garage === undefined
        ? middle + (share(STREAM_PICTURE) < PICTURE_SHARE / 2 ? -1 : 1)
        : middle + (garage.bay === 0 ? 1 : -1)
      : -1;
  const windows: Windows = {
    top: (eaves - floor) / STOREY_METRES,
    doorEdge: front?.edge ?? -1,
    clad: wallClad,
    flags,
    picture,
    ...(roof === 'gable' ? { gableAxis: [rectangle.ux, rectangle.uz] as const } : {}),
  };
  // The slope the gutters' downpipe and the dormers are on: the one facing the front.
  const facing =
    frontFrame === undefined
      ? 1
      : frontFrame.nx * -rectangle.uz + frontFrame.nz * rectangle.ux >= 0
        ? 1
        : -1;
  // The downpipe's end: away from the garage, where it is on that slope's wall.
  const garageEnd =
    garage === undefined
      ? share(STREAM_GARAGE_END) < 0.5
        ? 1
        : -1
      : (garage.plan.x - rectangle.cx) * rectangle.ux +
            (garage.plan.z - rectangle.cz) * rectangle.uz >=
          0
        ? 1
        : -1;
  const withDormers =
    roof !== 'flat' &&
    residential &&
    pitchDegrees >= DORMER_MIN_PITCH_DEGREES &&
    share(STREAM_DORMER) < DORMER_SHARE;

  const holes = building.rings
    .slice(1)
    .filter((hole) => hole.length >= 6)
    .map((hole) => simplifyRing(hole, FOOTPRINT_SIMPLIFY_METRES, maxVertices));
  /** What one build drew of #1588's extras, and #1590's cornice. */
  interface Extras {
    garage: boolean;
    dormers: number;
    cornice: boolean;
  }
  const build = (withHoles: boolean, withCornice: boolean): { writing: Writing; drew: Extras } => {
    const rings = withHoles ? [drawn, ...holes] : [drawn];
    const writing: Writing = {
      wall: [],
      plinth: [],
      roof: [],
      parapet: [],
      door: [],
      chimney: [],
      trim: [],
      dormer: [],
      'dormer-roof': [],
      driveway: [],
      shopfront: [],
      porch: [],
      'porch-roof': [],
      'porch-trim': [],
    };
    const drew: Extras = { garage: false, dormers: 0, cornice: false };
    if (!part) {
      ringWalls(
        writing.plinth,
        rings,
        [base, floor, floor],
        clapboard ? { metres: [cladOf(brickFoundation ? CLAD_BRICK : CLAD_BLOCK), 0, 0, -1] } : {},
      );
    }
    ringWalls(writing.wall, rings, [floor, eaves, floor], { windows });
    if (roof === 'flat') {
      flatRoof(writing.roof, rings, eaves);
      ringWalls(writing.parapet, rings, [eaves, eaves + PARAPET_METRES, floor], { inside: true });
      // #1590: a commercial roof's parapet under a cornice.
      if (withCornice && use === 'commercial' && !part) {
        cornice(writing.trim, drawn, eaves + PARAPET_METRES);
        drew.cornice = true;
      }
    } else {
      const ridge = pitchedRoof(writing, rectangle, [eaves, floor], roof, pitchDegrees, {
        roof: roofStyle,
        gable: wallStyle,
        ...(residential
          ? { gutters: { side: facing, end: -garageEnd, ground: base + FOUNDATION_METRES } }
          : {}),
      });
      if (withChimney) {
        const end = share(STREAM_CHIMNEY) < CHIMNEY_SHARE / 2 ? 1 : -1;
        chimney(writing.chimney, rectangle, ridge, [eaves, floor], end);
      }
      if (withDormers) {
        // Clear of the chimney: one in the middle, or two either side of it.
        const reach = Math.min(ridge.half, rectangle.halfLong);
        const count =
          reach >= DORMER_TWO_REACH_METRES ? 2 : reach >= DORMER_ONE_REACH_METRES ? 1 : 0;
        if (count > 0) {
          drew.dormers = dormers(
            writing,
            rectangle,
            [eaves, floor],
            ridge,
            pitchDegrees,
            { side: facing, count, reach },
            { wall: wallStyle, roof: roofStyle },
          );
        }
      }
    }
    if (frontFrame !== undefined) {
      door(
        writing.door,
        frontFrame,
        floor,
        shop === undefined ? NO_STYLE : [CLAD_PHOTOGRAPH, STYLE_COMMERCIAL, 0, -1],
      );
      if (shop !== undefined) shopFront(writing.shopfront, frontFrame, floor, shop);
      // #1589: a porch, written when it is first read, replaces the canopy.
      if (frontPorchSpec === undefined && withPorch) {
        porch(writing.trim, frontFrame, floor, withPosts);
      }
      if (garage !== undefined) {
        garageDoor(writing.door, frontFrame, garage.along, garage.width, [garage.ground, floor]);
        drivewayPaving(writing.driveway, garage.plan, groundAt);
        drew.garage = true;
      }
    }
    return { writing, drew };
  };
  const porchCount = frontPorchSpec === undefined ? 0 : porchTriangleCount(frontPorchSpec);
  const fits = (writing: Writing): boolean =>
    FOOTPRINT_ROLES.reduce((sum, role) => sum + trianglesOf(writing[role]), 0) + porchCount <=
      FOOTPRINT_MAX_TRIANGLES &&
    trianglesOf(writing.wall) + trianglesOf(writing.roof) <= FOOTPRINT_MAX_FAR_TRIANGLES;
  // Holes while they fit. #1588's and #1589's detail needs no such rule: a
  // flat plan of 48 walls with a garage, the longest driveway and a porch is
  // about 600 (`front-porches.test.ts` §"the most a plan can be").
  // #1590: a cornice round a footprint of many walls may not fit; the plan
  // does without it before it does without its holes, and only a plan that
  // drew one is built again for it.
  const holed = holes.length > 0;
  let built = build(holed, true);
  if (!fits(built.writing) && built.drew.cornice) built = build(holed, false);
  if (holed && !fits(built.writing)) built = build(false, false);
  const { writing, drew } = built;

  const triangles = Object.fromEntries(
    FOOTPRINT_ROLES.map((role) => [role, Float32Array.from(writing[role])]),
  ) as Record<FootprintRole, Float32Array>;
  if (frontPorchSpec !== undefined && frontFrame !== undefined) {
    porchOnRead(triangles, () => {
      const porchWriting = { porch: [], 'porch-roof': [], 'porch-trim': [] };
      frontPorch(porchWriting, frontFrame, frontPorchSpec, roofStyle);
      return porchWriting;
    });
  }
  // #1585: a house model, where one fits the footprint (`house-models.ts`).
  const fitting =
    part || frontFrame === undefined
      ? []
      : houseModelsFitting({
          long: 2 * rectangle.halfLong,
          short: 2 * rectangle.halfShort,
          rectangularity,
          storeys,
          use,
          front: frontOf(rectangle, frontFrame.nx, frontFrame.nz),
        });
  const model =
    fitting.length === 0
      ? undefined
      : placeHouseModel(
          fitting[seededEntry(share(STREAM_HOUSE_MODEL), fitting.length)] as number,
          rectangle,
          frontFrame?.nx ?? 0,
          frontFrame?.nz ?? 0,
          base,
        );
  const wallSurface = clapboard
    ? SIDING_SURFACE
    : wallSurfaceOf(use, storeys, roof, share(STREAM_WALL));
  const roofSurface = shingled ? SHINGLE_SURFACE : roofSurfaceOf(roof, share(STREAM_ROOF));
  const triangleCount =
    FOOTPRINT_ROLES.reduce((sum, role) => sum + trianglesOf(writing[role]), 0) + porchCount;
  const driveway = drew.garage && garage !== undefined ? drivewayRing(garage.plan) : NO_RING;
  // #1601: placed, so the plans after this one keep off them.
  if (frontPorchSpec !== undefined) others.porches.add(onFront(porchRingOf(frontPorchSpec)));
  if (driveway.length > 0) others.driveways.add(driveway);
  return {
    centroid,
    footprint: Float32Array.from(drawn),
    base,
    storeys,
    eaves,
    roof,
    pitchDegrees,
    surfaces: { wall: wallSurface, roof: roofSurface },
    cladding: {
      wall: clapboard ? 'clapboard' : 'photograph',
      roof: shingled ? 'shingle' : 'photograph',
      course,
    },
    // Where the paint starts; `paintTown` moves it off a neighbour's.
    paint: {
      wall: seededEntry(share(STREAM_PAINT_WALL), paintsOf(wallSurface)?.length ?? 1),
      roof: seededEntry(share(STREAM_PAINT_ROOF), roofPaintsOf(roofSurface, shingled)?.length ?? 1),
      trim: seededEntry(share(STREAM_PAINT_TRIM), TRIM_PAINTS.length),
      door: seededEntry(share(STREAM_PAINT_DOOR), DOOR_PAINTS.length),
    },
    garage: drew.garage,
    driveway,
    dormers: drew.dormers,
    shop: {
      front: shop !== undefined,
      awning: shop !== undefined && shop.awning > 0,
      cornice: drew.cornice,
    },
    porch: frontPorchSpec !== undefined,
    urban: urbanClass,
    model,
    tint: packedInstanceTint(centroid.x, centroid.z, MASONRY_TINT),
    triangles,
    triangleCount,
    farTriangleCount: trianglesOf(writing.wall) + trianglesOf(writing.roof),
  };
}
