// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Water, and the bridges that carry the road over it — #459.
 *
 * ## ⚠️ Where water goes, and where that comes from — ADR 0009, #248, ADR 0054
 *
 * **From the map where the corridor was read, and from the route's own
 * elevation everywhere else** — #2658. Until then this said *"from nothing
 * else. No map, no hydrography"*, which was ADR 0032 D-1's rule; ADR 0054
 * superseded it for the records its D-2 lists, water polygons among them, and
 * the land mask (`land-class.ts`) has read them since #1546 — but only to keep
 * trees off them, so a lake or the sea beside the road was drawn as bare
 * ground. Now:
 *
 * - **A mapped lake** — {@link mappedLakes}: where the mask's `water` runs
 *   beside the road for at least {@link LAKE_MIN_LENGTH_METRES} on one side,
 *   a {@link Lake} with the shores the mask measured, drawn by the same mesh
 *   and banks as an invented one. A mapped **wetland** is a lake whose ground
 *   stands just over its water ({@link WETLAND_GROUND_ABOVE_WATER_METRES}),
 *   flat, bare and wet-tinted, with no open water drawn over it.
 * - **A mapped stream** — #2659, {@link mappedCrossings}: wherever one of the
 *   corridor's rivers, streams or canals crosses the drawn road, a
 *   {@link Crossing}, bridged and channelled as an invented one is. A ditch
 *   or a drain is never bridged: a road crosses one in a culvert.
 * - **A mapped channel beside the road** — #2974, {@link mappedChannels}:
 *   wherever one of the corridor's water lines, of any of its five kinds,
 *   runs beside the drawn road, a {@link Lake} marked as a
 *   {@link Lake.channel}, its width, depth and banks by kind
 *   ({@link CHANNEL_SHAPES}), its water falling and rising with the road, and
 *   its surface laid on the drawn ground where the ground's columns are too
 *   far apart to cut a narrow channel ({@link waterSurface}).
 * - **No invented lake or stream in a stretch the map covers**: there the map
 *   says where water is and is not, so a seeded lake on mapped farmland, or a
 *   seeded bridge over a mapped field, is a lie.
 * - **A mapped river at its own width, on an open-world ride** — #3105,
 *   {@link waterUnderRoad}: where the mask's `water` lies under the road and
 *   on both sides of it, one {@link Crossing} as wide as that water
 *   ({@link Crossing.halfWidth}), so the bridge spans the river the map
 *   draws, not a stream's eight metres. An open-world ride's mask is its
 *   tiles' water and a buffer round it (`open-world/water-mask.ts`), so
 *   "covered" there is "beside real water".
 * - **Everywhere the map was not read** — no corridor, outside the archive,
 *   offline, a privacy zone — the world is exactly the one below, from the
 *   route and a seed (ADR 0054 D-4).
 *
 * ⚠️ **The gradient is the route's own either way.** Nothing here moves the
 * road: a mapped lake shapes the ground beside it as an invented one does.
 *
 * The invented water, from the route's own elevation — a `RouteProfile` says
 * only how high the road is at each metre of it, and that is enough to say
 * where water plausibly is:
 *
 * - **A stream crosses the road at a valley floor** — a point of the route that
 *   is the lowest within {@link VALLEY_WINDOW_METRES} either side of it, with
 *   the road climbing at least {@link VALLEY_DEPTH_METRES} out of it on BOTH
 *   sides within that window. Water runs downhill; where the road is lowest and
 *   the ground rises either way is where it would have to cross.
 * - **A lake lies beside a long, flat, low stretch** — at least
 *   {@link LAKE_MIN_LENGTH_METRES} of road no steeper than
 *   {@link LAKE_MAX_GRADE_PERCENT}, in the lowest part of the route's own
 *   elevation range. Which side, and whether a stretch that qualifies has one
 *   at all, is a seeded hash — the same principle `scatter.ts` §`scatterAt`
 *   states — so the same stretch has the same lake on every lap.
 *
 * Every threshold is a constant with its reasoning beside it, and none of them
 * is a measurement of anywhere: they are this repository's own, chosen so that
 * an ordinary rolling route gets a stream or two and a flat valley road a lake.
 *
 * ## The bridge, and what it must not change
 *
 * **The road deck is the road, unchanged.** A bridge here is parapets, a slab
 * under the road, two abutments and — since #468's review — a solid approach
 * from each abutment to where the channel's bank meets the road again
 * — {@link bridgeParts} — standing beside and
 * under a ribbon `terrain.ts` built exactly as it builds every other stretch,
 * and the channel `landform.ts` cuts in the ground beneath it. ⚠️ **The grade
 * a trainer is sent at a bridge is the route's**: nothing here reads or writes
 * a profile, and `waterways.test.ts` §"the trainer is told the route's
 * gradient at the bridge" reads what the gradient session would send.
 *
 * ## How the landform composes with it
 *
 * `landform.ts` asks {@link waterShaping} for every point it builds: the
 * **channel or lake bed** is a ceiling on the ground's height there, and the
 * invented relief is **damped** near water, so the banks fall to it rather
 * than a hillside standing over it. Both are functions of where on the route a
 * point is beside and how far from it — the frame the ground is built in — so
 * the ground a tree stands on and the ground that is drawn agree, and the
 * water is the same water on lap two.
 *
 * ## What there is not, and why
 *
 * - **A culvert** is what a real road does for a stream too small to bridge.
 *   Here every valley that qualifies gets a bridge, because a culvert is a pipe
 *   under an embankment and is invisible from a bicycle — it would be a stream
 *   that stops at the verge and starts again on the far side.
 * - **A tunnel** would need to know that there is ground ABOVE the road, and a
 *   `RouteProfile` cannot say that: it is a line, and the landform beside it is
 *   invented. A tunnel would be a claim about a hill that nothing in the route
 *   supports, so there are none.
 * - **Stone walls and fences** along field edges are #460's.
 *
 * Pure, and names no rendering library.
 */

import { distanceOnRoute, elevationAt, gradeAt, type RouteProfile } from '@onyourleft/domain';

import { BRIDGED_WATER_LINE_KINDS, type WaterLineFeature } from '@onyourleft/map-features';

import type { LandClassMask } from './land-class';
import { sceneryAnchor } from './scenery-anchor';
import { slotHash, uniformFrom } from './seeded';
import {
  ROAD_WIDTH_METRES,
  corridorOrigin,
  drawnRoadFrame,
  drawnRoadPosition,
  ribbonNormals,
  type CorridorOrigin,
  type CorridorPoint,
  type RoadCorridor,
} from './terrain';

/** Half the road. */
const ROAD_HALF_WIDTH_METRES = ROAD_WIDTH_METRES / 2;

/**
 * How far either side a valley floor must be the lowest point, in metres:
 * **300**. Long enough that a dip in a climb — a few metres of road that sag
 * between two steeper pitches — is not a valley; short enough that a road
 * which descends into a valley and climbs out within a kilometre is one.
 */
export const VALLEY_WINDOW_METRES = 300;

/**
 * How far the road must climb out of a valley floor on BOTH sides within
 * {@link VALLEY_WINDOW_METRES}, in metres: **8**. Enough that the land either
 * side is a valley rather than undulation, and enough to put a bridge
 * {@link BRIDGE_CLEARANCE_METRES} over a stream without the approaches having
 * to climb to meet it.
 */
export const VALLEY_DEPTH_METRES = 8;

/**
 * How far either side of a valley floor the road is looked along to tell a
 * turnaround from a valley, in metres: **30** — #3064. Where the road that
 * far before the floor and that far after it are nearer each other than
 * that, the road turned back at the floor rather than crossing it.
 *
 * ⚠️ **Why a low point is not always a valley.** A route that turns back on
 * itself — an open-world U-turn (`RollingRoute.uTurn`), whose road past the
 * rider is the road they came along, ridden back, or the far end of an
 * out-and-back — mirrors its profile about the turn. Turned on a descent, the
 * turn is the lowest point for a kilometre each way, and was read as a
 * valley floor: a stream, its banks and a bridge were put at the rider's
 * feet where there is no water, and the scenery round the turn was moved for
 * them. Measured on `rolling-testing`'s grid, a U-turn at 640 m on a descent
 * put a crossing at 640 m. A road that crosses a valley goes on across it: its
 * two ends are about twice this apart. A hairpin tighter than 15 m in radius
 * at a valley floor is read as a turnaround, and its stream is not drawn.
 */
export const TURNAROUND_REACH_METRES = 30;

/** The most elevation samples the valley and lake search reads, whatever the route's length. */
export const WATERWAY_SAMPLE_LIMIT = 4_096;

/** The most crossings and lakes one route may carry — a bound on every frame's work. */
export const MAXIMUM_WATERWAYS = 64;

/**
 * How far the water under a bridge is below the road, in metres: **3**. A
 * small stone bridge, which is what a valley road crosses; the deck is the road
 * and the trainer's grade does not see it.
 */
export const BRIDGE_CLEARANCE_METRES = 3;

/** How deep the stream's bed is under its surface, in metres: **0.8**. */
export const STREAM_DEPTH_METRES = 0.8;

/**
 * Half the width of the stream's deep middle, along the road, in metres: **4**
 * — what {@link CHANNEL_FLAT_METRES} is measured against. The water's SURFACE
 * is wider: {@link STREAM_SURFACE_HALF_WIDTH_METRES}.
 */
export const STREAM_HALF_WIDTH_METRES = 4;

/**
 * How far along the road either side of the stream the channel's bed is flat,
 * in metres: **8** — twice the stream's half-width, so the water always lies
 * on bed rather than on a bank however the ground's rows slide under it.
 */
export const CHANNEL_FLAT_METRES = STREAM_HALF_WIDTH_METRES * 2;

/**
 * Where the channel's banks meet the ground again, in metres along the road
 * either side of the stream: **30**. The bridge's abutments stand on the banks.
 */
export const CHANNEL_BANK_METRES = 30;

/**
 * How far along the road either side of the stream its surface reaches, in
 * metres: **16** — #501. ⚠️ **Past where the bank rises out of it, on purpose.**
 *
 * Until #501 the surface was {@link STREAM_HALF_WIDTH_METRES} wide and the
 * flat bed twice that, so beyond the water's straight edge lay four metres of
 * dry bed BELOW the water, and past that a bank rising over 22 m — on the
 * owner's tablet, *"a band laid on a meadow, not a stream in a channel"*
 * (validation 0002 Z10). The ground's rows are ten metres apart and slide with
 * the rider, so no bank the ground mesh draws can be steep enough to sit a
 * straight edge on; what it CAN do is rise through a level surface. So the
 * surface runs on under the bank, as a lake's does (`waterSurface`), and the
 * shoreline a rider sees is where the drawn ground comes up out of the water —
 * never the edge of a quad. `waterways.test.ts` §"the water has a bank" holds
 * the ground above the surface's edge for every place the rows can fall, and
 * risen a visible height above the water a few metres further out.
 *
 * 16 m is where {@link bankCeiling} stands above the water with the shallowest
 * bank a valley can have ({@link BRIDGE_CLEARANCE_METRES} plus the bed's depth
 * of fall), even when a row sits at the foot of the flat bed and the next one
 * ten metres on: the ground there is then 1.14 m over the bed, which is 0.34 m
 * over the surface.
 */
export const STREAM_SURFACE_HALF_WIDTH_METRES = 16;

/** How far out from the road the stream runs, either side, in metres: the ground's own reach. */
export const STREAM_REACH_METRES = 420;

/**
 * Half the length of a bridge along the road, abutment to abutment, in metres:
 * **12**. The stream is 8 m wide and its flat bed 16 m, and the abutments stand
 * a little up the banks.
 */
export const BRIDGE_HALF_SPAN_METRES = 12;

/** How high a parapet stands above the deck, in metres: **0.9**. */
export const PARAPET_HEIGHT_METRES = 0.9;

/** How thick a parapet is, in metres: **0.35** — a stone wall a rider could sit on. */
export const PARAPET_THICKNESS_METRES = 0.35;

/**
 * How deep a parapet's coping is, in metres: **0.12** — #501. The flat stones
 * laid along the top of a country bridge's wall, set within
 * {@link PARAPET_HEIGHT_METRES} rather than on it, so the parapet is no taller.
 */
export const COPING_DEPTH_METRES = 0.12;

/**
 * How far a coping stands out past the parapet's OUTER face, in metres:
 * **0.1**. Outward only: its inner face is the parapet's, so nothing of the
 * bridge overhangs the carriageway (`waterways.test.ts` §"the road is
 * continuous across the bridge").
 */
export const COPING_OVERHANG_METRES = 0.1;

/** How deep the slab under the deck is, in metres: **0.8**. */
export const DECK_DEPTH_METRES = 0.8;

/** How long each piece of a bridge's parapet and deck is, in metres: **4**. */
export const BRIDGE_PIECE_METRES = 4;

/**
 * The shortest run of level road that can carry a lake, in metres: **300**.
 * Anything shorter is a flat between two slopes rather than a valley floor.
 */
export const LAKE_MIN_LENGTH_METRES = 300;

/** The longest one lake runs beside the road, in metres: **600**. A long stretch gets several. */
export const LAKE_MAX_LENGTH_METRES = 600;

/** The steepest a stretch may be and still carry a lake, in percent: **1.5**. */
export const LAKE_MAX_GRADE_PERCENT = 1.5;

/**
 * How low a stretch must be to carry a lake: within this share of the route's
 * own elevation range of its lowest point — **a quarter** — or within
 * {@link LAKE_LOW_METRES} of it, whichever is more. Water collects at the
 * bottom of a route, not on a plateau at the top of one.
 */
export const LAKE_LOW_SHARE = 0.25;

/** @see LAKE_LOW_SHARE — **10 m**, so a nearly level route is low all the way along. */
export const LAKE_LOW_METRES = 10;

/**
 * The share of the stretches that qualify which actually carry a lake:
 * **0.6**. Seeded per stretch, so the same stretch always answers the same way;
 * less than one so that not every flat valley road is a lakeside.
 */
export const LAKE_CHANCE = 0.6;

/** How far from the centreline a lake's near shore is at its widest, in metres: **16**. */
export const LAKE_NEAR_METRES = 16;

/** How far from the centreline a lake's far shore is at its widest, in metres: **110**. */
export const LAKE_FAR_METRES = 110;

/** Over how much of each end a lake narrows to nothing, in metres: **80**. */
export const LAKE_TAPER_METRES = 80;

/**
 * How far either side of a level stretch the road must climb out of it for the
 * stretch to be a valley floor that can hold a lake, in metres: **600**, by
 * {@link VALLEY_DEPTH_METRES} on each side.
 *
 * ⚠️ **What keeps a lake off a plain.** Water collects where the ground rises
 * round it; a level route is level from end to end and has no bottom for water
 * to lie in, so it gets none. Without this rule every level fixture in
 * `scatter.test.ts` grew lakes, and the measurements of how much scenery stands
 * near the road there — #351's and #353's — stopped measuring the scenery.
 */
export const LAKE_ENCLOSURE_METRES = 600;

/**
 * #2658: how far out from the road's edge the map's water is looked for,
 * either side, in metres: **100**. Water that begins further out is not
 * beside the road, and the ground's own relief is drawn there.
 */
export const MAPPED_WATER_REACH_METRES = 100;

/**
 * #2658: the step the search for the map's water takes outward from the
 * road, in metres: **5**, one mask cell (`land-class.ts`
 * §`LAND_CLASS_CELL_METRES`).
 */
export const MAPPED_WATER_STEP_METRES = 5;

/**
 * #2658: the furthest a mapped lake's far shore is drawn, in metres from the
 * centreline: **240**, inside the corridor's 250 m (`world-data/corridor.ts`
 * §`CORRIDOR_HALF_WIDTH_METRES`), past which the mask is `unknown`. The sea
 * beside a coast road runs on to this, and the ground's own reach hides the
 * rest.
 */
export const MAPPED_LAKE_FAR_METRES = 240;

/**
 * #2658: the narrowest mapped water that is drawn as a lake, shore to shore,
 * in metres: **20**. A ditch or the corner of a pond is less, and is left to
 * the mask, which keeps trees off it.
 */
export const MAPPED_LAKE_MIN_WIDTH_METRES = 20;

/**
 * #2658: how far the road beside one mapped lake may rise and fall, in
 * metres: **6**. Water is level and the road beside it is not always: past
 * this one lake ends and the next begins at its own level, so no bank falls
 * further than a lake's own does.
 */
export const MAPPED_LAKE_RISE_METRES = 6;

/**
 * #2754: the nearest a mapped lake's near shore is drawn to the centreline,
 * in metres: **8**, the ground's third column (`landform.ts`
 * §`TERRAIN_COLUMN_OFFSETS`), so its bank is the one band of ground from the
 * verge's foot down to it ({@link nearBank}) and the water shows from about
 * 5 m out: 1.5 m past the road's edge.
 *
 * ⚠️ **Not {@link LAKE_NEAR_METRES}**, the invented lake's 16 m, which a
 * mapped lake was held to until #2754. Where the map has the sea at the road,
 * the drawn water started 14 m out, and the 10 m between was drawn as grass:
 * measured on 2026-11-16 through `corridor-source.ts` from the published
 * archive at NH 1A, Hampton Beach NH (public), where the map's shore is 6 to
 * 10 m from the centreline. The owner saw 5 to 10 m of grass there at North
 * Hampton.
 */
export const MAPPED_LAKE_NEAR_METRES = 8;

/**
 * #2754: over how much of each end a mapped lake narrows to nothing, in
 * metres: **20**, two of its samples. An invented lake narrows over
 * {@link LAKE_TAPER_METRES}, which drew the sea 80 m back from the road at
 * each end of every run of the map's water, where the map has it at the road.
 */
export const MAPPED_LAKE_TAPER_METRES = 20;

/**
 * #2658: how far above its water a mapped wetland's ground stands, in
 * metres: **0.25** — well inside `landform.ts` §`WET_MARGIN_METRES`, so the
 * whole of it wears the wet margin's tint: level, bare and dark, a marsh
 * rather than a dry field. No open water is drawn over it.
 */
export const WETLAND_GROUND_ABOVE_WATER_METRES = 0.25;

/**
 * How far past each of its shores a lake's surface is drawn, in metres: **2**,
 * under the bank, so the water meets the ground rather than stopping short of
 * it. Since #2728 {@link onOpenWater} reads it too, so what stands nothing on
 * the water is the water drawn.
 */
export const LAKE_SURFACE_PAST_SHORE_METRES = 2;

/** How far below the lowest road beside it a lake's surface lies, in metres: **0.8**. */
export const LAKE_BELOW_ROAD_METRES = 0.8;

/** How deep a lake is, in metres: **1.5**. */
export const LAKE_DEPTH_METRES = 1.5;

/** How far out from a lake's shore its bank climbs back to the ground, in metres: **14**. */
export const LAKE_BANK_METRES = 14;

/**
 * How far past a bank's top the ceiling keeps climbing before it lets go of
 * the ground altogether, as a multiple of the bank: **3**. @see bankCeiling
 */
const BANK_RELEASE = 3;

/**
 * How far along the road from a crossing its channel shapes the ground at
 * all, in metres: the flat bottom, the bank, and the {@link BANK_RELEASE}
 * banks the ceiling lets go over — **96**. Past it {@link bankCeiling} has
 * let go and a crossing is skipped.
 *
 * ⚠️ **ONE number read by two functions, and they are only correct together**
 * (#581). {@link waterShaping} skips a crossing past it, and
 * {@link waterNearRoute} answers "dry" for a whole row past it, so
 * `landform.ts` never asks `waterShaping` there at all. It was written out
 * twice until #581: narrowing `waterNearRoute`'s copy was caught by one test,
 * and widening `waterShaping`'s was caught by nothing — the ground would have
 * skipped water shaping on rows that needed it. `waterways.test.ts`
 * §"#581" sweeps a crossing and requires every non-dry answer to fall on a row
 * `waterNearRoute` calls wet.
 */
const STREAM_ALONG_REACH_METRES =
  CHANNEL_FLAT_METRES + (CHANNEL_BANK_METRES - CHANNEL_FLAT_METRES) * (1 + BANK_RELEASE);

/** How much the ceiling rises over its release, in metres: more than any relief can reach. */
const CEILING_RELEASE_METRES = 50;

/** How far along the road either side {@link inWater} looks for a lake's shore: a row's spacing. */
const SHORE_SEARCH_METRES = 12;

/** The band index lakes are hashed under, outside any `scatter.ts` or `landform.ts` uses. */
const LAKE_KEY = 0x3_0000;

/** A stream crossing under the road. */
export interface Crossing {
  /** Where on the route, wrapped. */
  readonly distance: number;
  /** The water's surface, as an elevation — the same datum as the profile's. */
  readonly waterElevation: number;
  /**
   * #3105: half the water's width along the road, in metres, where the map
   * measured it ({@link waterUnderRoad}). Absent on every other crossing,
   * whose water is {@link STREAM_HALF_WIDTH_METRES} either side: an invented
   * stream, and a mapped line with no width (#2659). @see crossingWiden
   */
  readonly halfWidth?: number;
}

/**
 * #3105: how far past a stream's own every measure of a crossing lies, along
 * the road either side, in metres: its {@link Crossing.halfWidth} less
 * {@link STREAM_HALF_WIDTH_METRES}, and nought on a crossing with none. The
 * bed, the banks, the surface, the bridge's span and its approaches all lie
 * this much further from the crossing's middle, so a river 80 m across is 80 m
 * of water under an 96 m deck, shaped at each bank exactly as a stream's is.
 */
export function crossingWiden(crossing: Crossing): number {
  return Math.max(0, (crossing.halfWidth ?? STREAM_HALF_WIDTH_METRES) - STREAM_HALF_WIDTH_METRES);
}

/** A lake beside a stretch of the route. */
export interface Lake {
  /** Where on the route it starts and ends, wrapped; `from < to`. */
  readonly from: number;
  readonly to: number;
  /**
   * Which side of the road, positive on the normal's — the RIGHT since #583,
   * called the left before — the frame `terrain.ts` builds in.
   */
  readonly side: 1 | -1;
  readonly waterElevation: number;
  /**
   * #2658: the shores at the lake's widest, in metres from the centreline —
   * the map's, for a mapped lake. Absent on an invented lake, whose shores
   * are {@link LAKE_NEAR_METRES} and {@link LAKE_FAR_METRES}.
   */
  readonly near?: number;
  readonly far?: number;
  /** #2658: a mapped wetland — wet ground at its water's level, and no open water. */
  readonly wetland?: boolean;
  /**
   * #2974: a mapped water line beside the road, drawn as a channel of this
   * kind — {@link mappedChannels}. Its shores are the line's place either
   * side of its {@link CHANNEL_SHAPES} half-width; its water follows the road
   * sample by sample ({@link LakeShores.level}), and its bed, its banks and
   * how far its surface is drawn are the kind's, not a lake's.
   */
  readonly channel?: WaterLineFeature['kind'];
  /**
   * #2754: a mapped lake's shores where the map measured them, from the
   * centreline, one pair every {@link LakeShores.spacing} metres of road from
   * {@link from}; {@link near} and {@link far} are then its widest.
   */
  readonly shores?: LakeShores;
}

/**
 * #2754: a mapped lake's shores along its run, one pair a sample of the
 * route. Until #2754 a mapped lake was drawn between its run's MEDIAN
 * shores, and a run ended where a shore wandered 20 m from them; on a coast
 * the shore wanders that far every few hundred metres, so the runs came out
 * shorter than {@link LAKE_MIN_LENGTH_METRES} and no sea was drawn at all.
 * Measured on 2026-11-16 through `corridor-source.ts` from the published
 * archive on NH 1A, North Hampton NH (public): the first 2.8 km of its sea
 * side broke into runs of 20 to 280 m, every one dropped; and where a run
 * was drawn, its median put the water up to 9 m off the map's shore either
 * way.
 */
export interface LakeShores {
  /** The road between two samples, in metres. */
  readonly spacing: number;
  /** One float a sample: the near shore, and the far. */
  readonly near: Float32Array;
  readonly far: Float32Array;
  /**
   * #2974: one float a sample, the water's surface as an elevation — a
   * {@link Lake.channel}'s, which falls and rises with the road beside it.
   * Absent on a lake, whose water is level at {@link Lake.waterElevation}.
   */
  readonly level?: Float32Array;
}

/** Every stream and lake a route implies. */
export interface Waterways {
  readonly crossings: readonly Crossing[];
  readonly lakes: readonly Lake[];
}

/**
 * The waterways of each route, computed once.
 *
 * ⚠️ **A cache keyed on the profile OBJECT, and this is the one place in
 * `game/` that keeps one.** `scene.ts` recomputes its per-route answers every
 * frame and says why: a cache keyed on a profile is a second source of truth a
 * route change has to remember to clear. That holds for a cache keyed on a
 * route's identity or content; it does not hold for a `WeakMap` keyed on the
 * object, which a new route cannot share and which is collected with the old
 * one. The search is a pass over up to {@link WATERWAY_SAMPLE_LIMIT} samples
 * with a window each — too much to repeat sixty times a second on the thread
 * GATT notifications arrive on, for an answer that cannot change.
 */
const computed = new WeakMap<LandClassMask, WeakMap<RouteProfile, Waterways>>();

/**
 * Every stream and lake a route implies, beside the ride's map — #2658. Pure;
 * cached per mask object and profile object, both collected with their ride.
 *
 * ⚠️ **`land` is required, and every caller passes the ride's.** A tree is
 * kept out of the lake {@link inWater} reports and the ground is shaped by the
 * lake {@link waterShaping} reports, so a caller asking without the map would
 * stand things in a lake that another caller drew. `NO_LAND_CLASS` is the
 * world with no corridor, and gives exactly the waterways of before #2658.
 */
export function waterways(profile: RouteProfile, seed: number, land: LandClassMask): Waterways {
  let byProfile = computed.get(land);
  if (byProfile === undefined) {
    byProfile = new WeakMap();
    computed.set(land, byProfile);
  }
  const known = byProfile.get(profile);
  if (known !== undefined) {
    return known;
  }
  const found = besideTheMap(profile, findWaterways(profile, seed), land);
  byProfile.set(profile, found);
  return found;
}

/**
 * The invented waterways with the map's laid over them — #2658, #2659: every
 * invented lake and crossing in a stretch the map covers dropped, and
 * {@link mappedLakes} and {@link mappedCrossings} put first, all within
 * {@link MAXIMUM_WATERWAYS}. With no map read beside the route, `invented`
 * itself.
 */
function besideTheMap(profile: RouteProfile, invented: Waterways, land: LandClassMask): Waterways {
  if (land.bytes === 0 && land.waterLines.length === 0) return invented;
  const origin = corridorOrigin(profile);
  const mapped = mappedLakes(profile, origin, land);
  const channels = mappedChannels(profile, origin, land, mapped);
  const kept = invented.lakes.filter((lake) => !lakeMapped(profile, origin, land, lake));
  const lines = mappedCrossings(profile, origin, land);
  // #3105: on an open-world view, the water the map draws under the road too,
  // at its own width. A route's crossings are its water lines' alone, as before.
  const bridged =
    sceneryAnchor(profile) === undefined ? lines : waterUnderRoad(profile, origin, land, lines);
  const unmapped = invented.crossings.filter(
    (crossing) =>
      !crossingMapped(profile, origin, land, crossing) &&
      !bridged.some(
        (mappedCrossing) =>
          Math.abs(routeOffset(profile, mappedCrossing.distance, crossing.distance)) <
          MAPPED_CROSSING_SPACING_METRES,
      ),
  );
  if (
    mapped.length === 0 &&
    channels.length === 0 &&
    kept.length === invented.lakes.length &&
    bridged.length === 0 &&
    unmapped.length === invented.crossings.length
  ) {
    return invented;
  }
  return {
    crossings: [...bridged, ...unmapped]
      .slice(0, MAXIMUM_WATERWAYS)
      .sort((a, b) => a.distance - b.distance),
    lakes: [...mapped, ...channels, ...kept].slice(0, MAXIMUM_WATERWAYS),
  };
}

/**
 * #2659: the route's step between the points of the drawn road the map's
 * water lines are crossed against, in metres: **10**, as the lakes'. The
 * crossing's place along a step is interpolated, so it is not rounded to one.
 */
const CROSSING_SAMPLE_METRES = 10;

/**
 * #2659: the side of the grid cells the drawn road's steps are filed under,
 * in metres: **100**. A water line's segment is tested only against the
 * steps filed in the cells its box reaches.
 */
const CROSSING_CELL_METRES = 100;

/**
 * #2659: the most grid cells the water lines' segments may visit, all told:
 * **200 000**. A corridor's lines are bounded at decode (`map-features`
 * `limits.ts`), but a hostile segment can be kilometres long; past this the
 * rest of the lines are not crossed, and their stretches keep what they have.
 */
export const MAPPED_CROSSING_MAX_WORK = 200_000;

/**
 * #2659: the nearest two crossings of the map's water may be, along the road,
 * in metres: **90**, three channel banks ({@link CHANNEL_BANK_METRES}) — a
 * meandering stream that crosses back and forth under one bridge's reach is
 * one crossing, the first.
 */
export const MAPPED_CROSSING_SPACING_METRES = CHANNEL_BANK_METRES * 3;

/**
 * The places where the map's rivers, streams and canals cross the drawn road
 * — #2659 — as {@link Crossing}s, so they are bridged and channelled exactly
 * as an invented stream is, the water {@link BRIDGE_CLEARANCE_METRES} under
 * the road there. ⚠️ **The road is not moved**: the deck is the road, and the
 * gradient a trainer is sent is the route's own.
 *
 * The drawn road is stepped every {@link CROSSING_SAMPLE_METRES}, each step
 * filed in a grid of {@link CROSSING_CELL_METRES} cells, and each segment of
 * each line is tested against the steps in the cells its box reaches, within
 * {@link MAPPED_CROSSING_MAX_WORK}. Crossings nearer each other than
 * {@link MAPPED_CROSSING_SPACING_METRES} are one, the first along the road.
 */
function mappedCrossings(
  profile: RouteProfile,
  origin: CorridorOrigin,
  land: LandClassMask,
): readonly Crossing[] {
  if (land.waterLines.length === 0) return [];
  const total = profile.totalDistance;
  const steps = Math.max(
    2,
    Math.min(WATERWAY_SAMPLE_LIMIT, Math.round(total / CROSSING_SAMPLE_METRES)),
  );
  const spacing = total / steps;
  // The drawn road, `steps + 1` points; on a loop the last is the first again.
  const road = new Float64Array((steps + 1) * 2);
  for (let index = 0; index <= steps; index += 1) {
    const at = drawnRoadPosition(profile, origin, Math.min(total, index * spacing));
    road[index * 2] = at.x;
    road[index * 2 + 1] = at.z;
  }
  const cells = new Map<string, number[]>();
  const cellOf = (value: number): number => Math.floor(value / CROSSING_CELL_METRES);
  for (let index = 0; index < steps; index += 1) {
    const ax = road[index * 2] as number;
    const az = road[index * 2 + 1] as number;
    const bx = road[index * 2 + 2] as number;
    const bz = road[index * 2 + 3] as number;
    for (let column = cellOf(Math.min(ax, bx)); column <= cellOf(Math.max(ax, bx)); column += 1) {
      for (let row = cellOf(Math.min(az, bz)); row <= cellOf(Math.max(az, bz)); row += 1) {
        const key = `${String(column)},${String(row)}`;
        const filed = cells.get(key);
        if (filed === undefined) cells.set(key, [index]);
        else filed.push(index);
      }
    }
  }
  const found: number[] = [];
  let work = MAPPED_CROSSING_MAX_WORK;
  for (const water of land.waterLines) {
    // #2974: a ditch or a drain passes under the road in a culvert.
    if (!(BRIDGED_WATER_LINE_KINDS as readonly string[]).includes(water.kind)) continue;
    const line = water.line;
    for (let at = 0; at + 3 < line.length && work > 0; at += 2) {
      const cx = line[at] as number;
      const cz = line[at + 1] as number;
      const dx = line[at + 2] as number;
      const dz = line[at + 3] as number;
      if (![cx, cz, dx, dz].every(Number.isFinite)) continue;
      const tested = new Set<number>();
      for (let column = cellOf(Math.min(cx, dx)); column <= cellOf(Math.max(cx, dx)); column += 1) {
        for (let row = cellOf(Math.min(cz, dz)); row <= cellOf(Math.max(cz, dz)); row += 1) {
          work -= 1;
          if (work <= 0) break;
          for (const index of cells.get(`${String(column)},${String(row)}`) ?? []) {
            if (tested.has(index)) continue;
            tested.add(index);
            const t = segmentsCross(road, index, cx, cz, dx, dz);
            if (t !== undefined) found.push((index + t) * spacing);
          }
        }
        if (work <= 0) break;
      }
    }
  }
  found.sort((a, b) => a - b);
  const crossings: Crossing[] = [];
  for (const along of found) {
    if (crossings.length >= MAXIMUM_WATERWAYS) break;
    const distance = distanceOnRoute(profile, along);
    // Only on road the map was read beside: past the mask's cap, or through a
    // tile that reaches uncovered road, the water is not the map's to place.
    const at = drawnRoadPosition(profile, origin, distance);
    if (!land.covered(at.x, at.z)) continue;
    const near = crossings.some(
      (crossing) =>
        Math.abs(routeOffset(profile, distance, crossing.distance)) <
        MAPPED_CROSSING_SPACING_METRES,
    );
    if (near) continue;
    crossings.push({
      distance,
      waterElevation: elevationAt(profile, distance) - BRIDGE_CLEARANCE_METRES,
    });
  }
  return crossings;
}

/**
 * #3105: how far either side of the centreline the map's water must also lie
 * for the road to be over it, in metres: **12**. Water under the road and on
 * both sides of it is a river crossed; water under the centreline alone, or
 * on one side, is a shore the map draws a few metres off (#2754), and is the
 * lakes' ({@link mappedLakes}).
 */
export const WATER_UNDER_ROAD_ASIDE_METRES = 12;

/**
 * #3105: the widest water under the road that is one crossing, in metres:
 * **300**, {@link LAKE_MIN_LENGTH_METRES}. Past it the water beside the road
 * runs long enough to be a mapped lake on each side ({@link mappedLakes}),
 * which draws it from the road's edge out, and no channel is cut across it.
 */
export const WATER_UNDER_ROAD_MAX_METRES = LAKE_MIN_LENGTH_METRES;

/**
 * The crossings of an open-world view, with the water the map draws under the
 * road — #3105. The drawn road is stepped every {@link CROSSING_SAMPLE_METRES}
 * and each run of steps with the mask's open `water` under the centreline and
 * {@link WATER_UNDER_ROAD_ASIDE_METRES} either side of it is one
 * {@link Crossing} at the run's middle, {@link Crossing.halfWidth} half the
 * run; runs nearer than {@link MAPPED_CROSSING_SPACING_METRES} are one, and a
 * run past {@link WATER_UNDER_ROAD_MAX_METRES} is left to the lakes. A water
 * line's crossing (`lines`, #2659) within such a river is the river's own
 * centre line and is dropped; every other is kept. At most
 * {@link MAXIMUM_WATERWAYS}, and at most {@link WATERWAY_SAMPLE_LIMIT} steps of
 * three mask lookups each.
 */
function waterUnderRoad(
  profile: RouteProfile,
  origin: CorridorOrigin,
  land: LandClassMask,
  lines: readonly Crossing[],
): readonly Crossing[] {
  if (land.bytes === 0) return lines;
  const total = profile.totalDistance;
  const steps = Math.max(
    2,
    Math.min(WATERWAY_SAMPLE_LIMIT, Math.round(total / CROSSING_SAMPLE_METRES)),
  );
  const spacing = total / steps;
  const wet = (at: number): boolean => {
    const frame = drawnRoadFrame(profile, origin, at);
    if (frame === undefined) return false;
    for (const aside of [0, WATER_UNDER_ROAD_ASIDE_METRES, -WATER_UNDER_ROAD_ASIDE_METRES]) {
      const x = frame.x + frame.normalX * aside;
      const z = frame.z + frame.normalZ * aside;
      if (land.classAt(x, z) !== 'water' || land.wetlandAt(x, z)) return false;
    }
    return true;
  };
  const runs: { from: number; to: number }[] = [];
  let open: { from: number; to: number } | undefined;
  for (let index = 0; index <= steps; index += 1) {
    const at = Math.min(total, index * spacing);
    if (!wet(at)) {
      open = undefined;
      continue;
    }
    if (open !== undefined) {
      open.to = at;
      continue;
    }
    const before = runs[runs.length - 1];
    if (before !== undefined && at - before.to < MAPPED_CROSSING_SPACING_METRES) {
      // The same river past an island or a pier's worth of land: one crossing.
      before.to = at;
      open = before;
    } else {
      open = { from: at, to: at };
      runs.push(open);
    }
  }
  const rivers: Crossing[] = [];
  for (const run of runs) {
    if (rivers.length >= MAXIMUM_WATERWAYS) break;
    // Each step stands for the road half a step either side of it.
    const width = run.to - run.from + spacing;
    if (width > WATER_UNDER_ROAD_MAX_METRES) continue;
    const distance = distanceOnRoute(profile, (run.from + run.to) / 2);
    rivers.push({
      distance,
      waterElevation: elevationAt(profile, distance) - BRIDGE_CLEARANCE_METRES,
      halfWidth: Math.max(STREAM_HALF_WIDTH_METRES, width / 2),
    });
  }
  if (rivers.length === 0) return lines;
  const kept = lines.filter(
    (line) =>
      !rivers.some(
        (river) =>
          Math.abs(routeOffset(profile, line.distance, river.distance)) <
          MAPPED_CROSSING_SPACING_METRES + crossingWiden(river),
      ),
  );
  return [...rivers, ...kept].slice(0, MAXIMUM_WATERWAYS);
}

/**
 * Where along road step `index` (from point `index` to `index + 1` of `road`)
 * the segment from `(cx, cz)` to `(dx, dz)` crosses it, as a share of the
 * step in `[0, 1)`, or `undefined` where it does not. Parallel segments never
 * cross: a line that runs along the road is not a crossing.
 */
function segmentsCross(
  road: Float64Array,
  index: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): number | undefined {
  const ax = road[index * 2] as number;
  const az = road[index * 2 + 1] as number;
  const rx = (road[index * 2 + 2] as number) - ax;
  const rz = (road[index * 2 + 3] as number) - az;
  const sx = dx - cx;
  const sz = dz - cz;
  const denominator = rx * sz - rz * sx;
  if (!(Math.abs(denominator) > 1e-9)) return undefined;
  const t = ((cx - ax) * sz - (cz - az) * sx) / denominator;
  const u = ((cx - ax) * rz - (cz - az) * rx) / denominator;
  return t >= 0 && t < 1 && u >= 0 && u <= 1 ? t : undefined;
}

/**
 * Whether an invented crossing is where the map was read — #2659: its road
 * is covered, so the map says where the water is and the seeded stream is
 * not drawn.
 */
function crossingMapped(
  profile: RouteProfile,
  origin: CorridorOrigin,
  land: LandClassMask,
  crossing: Crossing,
): boolean {
  const at = drawnRoadPosition(profile, origin, crossing.distance);
  return land.covered(at.x, at.z);
}

/** #2658: the route's step between the points the map's water is looked for beside, in metres. */
const MAPPED_SAMPLE_METRES = 10;

/**
 * Whether any of an invented lake's stretch is where the map was read, on
 * its side, midway between its shores — #2658. There the map says where
 * water is and is not, and a seeded lake is not drawn.
 */
function lakeMapped(
  profile: RouteProfile,
  origin: CorridorOrigin,
  land: LandClassMask,
  lake: Lake,
): boolean {
  const middle = ((lake.near ?? LAKE_NEAR_METRES) + (lake.far ?? LAKE_FAR_METRES)) / 2;
  for (let at = lake.from; at <= lake.to; at += MAPPED_SAMPLE_METRES) {
    const frame = drawnRoadFrame(profile, origin, at);
    if (frame === undefined) continue;
    const x = frame.x + frame.normalX * middle * lake.side;
    const z = frame.z + frame.normalZ * middle * lake.side;
    if (land.covered(x, z)) return true;
  }
  return false;
}

/** The map's water beside one point of the road, on one side. */
interface MappedWaterAt {
  readonly near: number;
  readonly far: number;
  readonly wetland: boolean;
}

/**
 * The map's water beside the road at `frame`, on `side` — #2658 — or
 * `undefined` where no water at least {@link MAPPED_LAKE_MIN_WIDTH_METRES}
 * across begins within {@link MAPPED_WATER_REACH_METRES} of the road's edge.
 * Its near shore is the first such water stepping out — a narrower strip
 * nearer the road, a ditch, is stepped over — and its far shore the last of
 * the water that runs on unbroken from there, out to
 * {@link MAPPED_LAKE_FAR_METRES}; a wetland if its first cell is one.
 */
function mappedWaterAt(
  land: LandClassMask,
  frame: {
    readonly x: number;
    readonly z: number;
    readonly normalX: number;
    readonly normalZ: number;
  },
  side: 1 | -1,
): MappedWaterAt | undefined {
  let near = Number.NaN;
  let far = Number.NaN;
  let wetland = false;
  for (
    let lateral = ROAD_HALF_WIDTH_METRES + MAPPED_WATER_STEP_METRES;
    lateral <= MAPPED_LAKE_FAR_METRES;
    lateral += MAPPED_WATER_STEP_METRES
  ) {
    const x = frame.x + frame.normalX * lateral * side;
    const z = frame.z + frame.normalZ * lateral * side;
    const water = land.classAt(x, z) === 'water';
    if (Number.isNaN(near)) {
      if (lateral > ROAD_HALF_WIDTH_METRES + MAPPED_WATER_REACH_METRES) return undefined;
      if (!water) continue;
      // #2754: the shore lies between this step and the last, which was dry:
      // halfway, rather than the whole step out.
      near = lateral - MAPPED_WATER_STEP_METRES / 2;
      far = lateral;
      wetland = land.wetlandAt(x, z);
    } else if (water) {
      far = lateral;
    } else if (far - near < MAPPED_LAKE_MIN_WIDTH_METRES) {
      // A ditch between the road and the water beyond it: look on past it.
      near = Number.NaN;
    } else {
      break;
    }
  }
  // Water that runs on to the far end is wide enough: it began within reach.
  if (Number.isNaN(near)) return undefined;
  return { near, far, wetland };
}

/** A run of the road with the map's water beside it, on one side, being gathered. */
interface MappedRun {
  readonly from: number;
  readonly wetland: boolean;
  floor: number;
  top: number;
  to: number;
  readonly nears: number[];
  readonly fars: number[];
}

/**
 * The lakes the map puts beside the road — #2658. On each side, every run of
 * {@link mappedWaterAt} at least {@link LAKE_MIN_LENGTH_METRES} long, broken
 * where the water changes between open water and wetland or where the road
 * rises or falls more than {@link MAPPED_LAKE_RISE_METRES} within it. Since
 * #2754 a lake keeps its run's shores sample by sample ({@link LakeShores},
 * each the middle of it and its neighbours, so one stray cell is not a
 * cove), its near shore no nearer than {@link MAPPED_LAKE_NEAR_METRES}; its
 * water {@link LAKE_BELOW_ROAD_METRES} under its lowest road, as an invented
 * lake's. None where the mask holds nothing: every ride with no corridor.
 *
 * Read once per mask and route, at the first frame, by {@link waterways}: at
 * most {@link WATERWAY_SAMPLE_LIMIT} points of the route, two sides each and
 * at most 47 mask lookups a side.
 */
function mappedLakes(
  profile: RouteProfile,
  origin: CorridorOrigin,
  land: LandClassMask,
): readonly Lake[] {
  if (land.bytes === 0) return [];
  const total = profile.totalDistance;
  const count = Math.max(
    2,
    Math.min(WATERWAY_SAMPLE_LIMIT, Math.round(total / MAPPED_SAMPLE_METRES)),
  );
  const spacing = total / count;
  const samples = count + (profile.loop ? 0 : 1);
  const lakes: Lake[] = [];
  for (const side of [1, -1] as const) {
    let run: MappedRun | undefined;
    const finish = (): void => {
      if (run === undefined) return;
      const { from, to, floor, wetland } = run;
      const nears = middles(run.nears).map((near) => Math.max(MAPPED_LAKE_NEAR_METRES, near));
      const fars = middles(run.fars).map((far) => Math.min(MAPPED_LAKE_FAR_METRES, far));
      run = undefined;
      if (to - from < LAKE_MIN_LENGTH_METRES || lakes.length >= MAXIMUM_WATERWAYS) return;
      const widths = fars.map((far, at) => far - (nears[at] as number));
      if (median(widths) < MAPPED_LAKE_MIN_WIDTH_METRES) return;
      lakes.push({
        from,
        to,
        side,
        waterElevation: floor - LAKE_BELOW_ROAD_METRES,
        near: Math.min(...nears),
        far: Math.max(...fars),
        shores: { spacing, near: Float32Array.from(nears), far: Float32Array.from(fars) },
        ...(wetland ? { wetland: true } : {}),
      });
    };
    for (let index = 0; index < samples; index += 1) {
      const at = Math.min(total, index * spacing);
      const frame = drawnRoadFrame(profile, origin, at);
      const water = frame === undefined ? undefined : mappedWaterAt(land, frame, side);
      const elevation = elevationAt(profile, at);
      if (
        run !== undefined &&
        (water === undefined ||
          water.wetland !== run.wetland ||
          Math.max(run.top, elevation) - Math.min(run.floor, elevation) > MAPPED_LAKE_RISE_METRES)
      ) {
        finish();
      }
      if (water === undefined) continue;
      run ??= {
        from: at,
        to: at,
        floor: elevation,
        top: elevation,
        wetland: water.wetland,
        nears: [],
        fars: [],
      };
      run.floor = Math.min(run.floor, elevation);
      run.top = Math.max(run.top, elevation);
      run.to = at;
      run.nears.push(water.near);
      run.fars.push(water.far);
    }
    finish();
  }
  return lakes;
}

/**
 * Each value's middle with its two neighbours — #2754: a run's shore with
 * one stray sample taken out (a cell of land in the water, or of water in the
 * land), and a cove or a headland two samples wide or more kept.
 */
function middles(values: readonly number[]): number[] {
  return values.map((value, at) => {
    const before = values[at - 1] ?? value;
    const after = values[at + 1] ?? value;
    return Math.max(Math.min(before, value), Math.min(Math.max(before, value), after));
  });
}

/** The middle value of a list that is never empty, sorting a copy. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

/** #2974: how a {@link Lake.channel} of one kind is drawn. @see CHANNEL_SHAPES */
export interface ChannelShape {
  /** Half its water's width, in metres. */
  readonly halfWidth: number;
  /** How far its bed lies under its surface, in metres. */
  readonly depth: number;
  /** How far out from its water its banks climb back to the ground, in metres. */
  readonly bank: number;
  /** How far under the road beside it its surface lies, in metres. */
  readonly belowRoad: number;
}

/**
 * #2974: each water line kind's channel, in metres — this repository's own,
 * none of them a measurement of anywhere. The map holds a waterway as a line
 * with no width (`map-features` §`WaterLineFeature`), so the width is the
 * kind's:
 *
 * - a **river** whose banks the map does not draw as water polygons (one
 *   that does is a mapped lake, {@link mappedLakes}, and no channel is drawn
 *   over it): 12 m of water, 1.2 m deep, in banks 6 m wide;
 * - a **canal**: 10 m, in steep made banks, 2.5 m;
 * - a **stream**: 3 m, shallow, in banks 3 m wide;
 * - a **ditch** and a **drain**: a metre or so of water a hand's depth under
 *   the verge, its bank a step.
 *
 * Each surface lies no more than 0.8 m under the road: measured in
 * `town=water`'s frames on 2026-11-21, a river 1.5 m down 34 to 46 m out was
 * hidden by its own near bank from a rider's eye.
 */
export const CHANNEL_SHAPES: Readonly<Record<WaterLineFeature['kind'], ChannelShape>> = {
  river: { halfWidth: 6, depth: 1.2, bank: 6, belowRoad: 0.8 },
  canal: { halfWidth: 5, depth: 1.2, bank: 2.5, belowRoad: 0.6 },
  stream: { halfWidth: 1.5, depth: 0.5, bank: 3, belowRoad: 0.5 },
  ditch: { halfWidth: 0.6, depth: 0.3, bank: 1.2, belowRoad: 0.3 },
  drain: { halfWidth: 0.5, depth: 0.3, bank: 1, belowRoad: 0.3 },
};

/**
 * #2974: how far from the centreline a water line is looked for beside the
 * road, in metres: **60**. Past it the ground's columns are 20 m apart and
 * more, and a channel there is a line in the distance rather than a bank
 * beside the rider.
 */
export const CHANNEL_REACH_METRES = 60;

/**
 * #2974: the nearest a channel's near shore is drawn to the centreline, in
 * metres: **4.5** — past the road's edge (3.5 m) and its verge (0.6 m,
 * `landform.ts` §`VERGE_METRES`). A line nearer than that is under the road
 * or at its kerb, mapped where it passes in a pipe, and is not drawn.
 */
export const CHANNEL_NEAR_METRES = 4.5;

/** #2974: the shortest run of road a channel is drawn beside, in metres: **40**. */
export const CHANNEL_MIN_LENGTH_METRES = 40;

/**
 * #2974: how near parallel to the road a water line's segment must run to be
 * beside it rather than across it: within **30°**, as a cosine. A line that
 * turns to cross the road ends its channel there, and {@link mappedCrossings}
 * bridges it.
 */
export const CHANNEL_PARALLEL_COSINE = Math.cos(Math.PI / 6);

/**
 * #2974: how far a channel's line may move out or in between two samples of
 * the road and still be the same channel, in metres: **8**. Further, and it
 * is another line, or the same one turning away.
 */
export const CHANNEL_JUMP_METRES = 8;

/** #2974: the most channels one route carries, within {@link MAXIMUM_WATERWAYS}. */
export const MAXIMUM_CHANNELS = 32;

/**
 * #2974: the most segment tests and grid cells the search for channels may
 * spend, all told: **400 000**, as {@link MAPPED_CROSSING_MAX_WORK} bounds the
 * crossings'. Past it the rest of the road has no channel.
 */
export const MAPPED_CHANNEL_MAX_WORK = 400_000;

/** #2974: the side of the grid cells the water lines' segments are filed under, in metres. */
const CHANNEL_CELL_METRES = 50;

/** #2974: over how much of each end a channel narrows to nothing, in metres: **10**. */
const CHANNEL_TAPER_METRES = 10;

/** #2974: the narrowest half-width a channel's tapering end is drawn at, in metres. */
const CHANNEL_MIN_HALF_METRES = 0.2;

/**
 * #2974: how far over the drawn ground a channel's surface is laid where the
 * ground stands above its water, in metres: **0.06**. @see waterSurface
 */
export const CHANNEL_DRAPE_METRES = 0.06;

/** A run of the road with one channel beside it, on one side, being gathered. */
interface ChannelRun {
  readonly from: number;
  readonly kind: WaterLineFeature['kind'];
  to: number;
  lateral: number;
  readonly nears: number[];
  readonly fars: number[];
  readonly levels: number[];
}

/**
 * The channels the map's water lines make beside the road — #2974. Each
 * sample of the drawn road ({@link MAPPED_SAMPLE_METRES} apart), each side,
 * finds the nearest segment of any water line abeam it that runs within
 * {@link CHANNEL_PARALLEL_COSINE} of the road and lies within
 * {@link CHANNEL_REACH_METRES} of it, and a run of such samples of one kind,
 * at least {@link CHANNEL_MIN_LENGTH_METRES} long, is one {@link Lake} with
 * its {@link Lake.channel} set: its shores the line's place either side of
 * the kind's half-width, its water the kind's depth under the road at each
 * sample. None is drawn over a mapped lake (`lakes`), so a river whose
 * banks the map draws as water is the lake it already is; none on road the
 * map was not read beside.
 *
 * Bounded twice: at most {@link MAXIMUM_CHANNELS}, and at most
 * {@link MAPPED_CHANNEL_MAX_WORK} cells and segment tests, so a corridor of
 * hostile lines costs its budget and not the press.
 */
function mappedChannels(
  profile: RouteProfile,
  origin: CorridorOrigin,
  land: LandClassMask,
  lakes: readonly Lake[],
): readonly Lake[] {
  if (land.waterLines.length === 0) return [];
  let work = MAPPED_CHANNEL_MAX_WORK;
  // Every finite segment, filed under the cells its box reaches.
  const cells = new Map<string, number[]>();
  const segments: number[] = [];
  const kinds: WaterLineFeature['kind'][] = [];
  const cellOf = (value: number): number => Math.floor(value / CHANNEL_CELL_METRES);
  for (const water of land.waterLines) {
    const line = water.line;
    for (let at = 0; at + 3 < line.length && work > 0; at += 2) {
      const ax = line[at] as number;
      const az = line[at + 1] as number;
      const bx = line[at + 2] as number;
      const bz = line[at + 3] as number;
      if (![ax, az, bx, bz].every(Number.isFinite)) continue;
      const index = kinds.length;
      kinds.push(water.kind);
      segments.push(ax, az, bx, bz);
      for (let column = cellOf(Math.min(ax, bx)); column <= cellOf(Math.max(ax, bx)); column += 1) {
        for (let row = cellOf(Math.min(az, bz)); row <= cellOf(Math.max(az, bz)); row += 1) {
          work -= 1;
          if (work <= 0) break;
          const key = `${String(column)},${String(row)}`;
          const filed = cells.get(key);
          if (filed === undefined) cells.set(key, [index]);
          else filed.push(index);
        }
        if (work <= 0) break;
      }
    }
  }
  const total = profile.totalDistance;
  const count = Math.max(
    2,
    Math.min(WATERWAY_SAMPLE_LIMIT, Math.round(total / MAPPED_SAMPLE_METRES)),
  );
  const spacing = total / count;
  const samples = count + (profile.loop ? 0 : 1);
  // Per sample and side (0 the normal's), the nearest line's distance from the centreline and kind.
  const nearest = new Float64Array(samples * 2).fill(Number.NaN);
  const nearestKind = new Array<WaterLineFeature['kind'] | undefined>(samples * 2);
  for (let index = 0; index < samples && work > 0; index += 1) {
    const at = Math.min(total, index * spacing);
    const frame = drawnRoadFrame(profile, origin, at);
    if (frame === undefined) continue;
    const { x, z, normalX, normalZ } = frame;
    // The road runs along (normalZ, −normalX): the normal is (−tz, tx).
    const tx = normalZ;
    const tz = -normalX;
    const tested = new Set<number>();
    for (
      let column = cellOf(x - CHANNEL_REACH_METRES);
      column <= cellOf(x + CHANNEL_REACH_METRES) && work > 0;
      column += 1
    ) {
      for (
        let row = cellOf(z - CHANNEL_REACH_METRES);
        row <= cellOf(z + CHANNEL_REACH_METRES) && work > 0;
        row += 1
      ) {
        for (const segment of cells.get(`${String(column)},${String(row)}`) ?? []) {
          if (tested.has(segment)) continue;
          tested.add(segment);
          work -= 1;
          const ax = segments[segment * 4] as number;
          const az = segments[segment * 4 + 1] as number;
          const ex = (segments[segment * 4 + 2] as number) - ax;
          const ez = (segments[segment * 4 + 3] as number) - az;
          const length = Math.hypot(ex, ez);
          const along = ex * tx + ez * tz;
          if (!(length > 0) || Math.abs(along) < CHANNEL_PARALLEL_COSINE * length) continue;
          // Where the line across the road at this sample meets the segment.
          const share = ((x - ax) * tx + (z - az) * tz) / along;
          if (!(share >= 0 && share <= 1)) continue;
          const lateral = (ax + share * ex - x) * normalX + (az + share * ez - z) * normalZ;
          const distance = Math.abs(lateral);
          if (distance > CHANNEL_REACH_METRES) continue;
          const slot = index * 2 + (lateral >= 0 ? 0 : 1);
          const known = nearest[slot] as number;
          if (Number.isNaN(known) || distance < known) {
            nearest[slot] = distance;
            nearestKind[slot] = kinds[segment];
          }
        }
      }
    }
  }
  const channels: Lake[] = [];
  for (const side of [1, -1] as const) {
    let run: ChannelRun | undefined;
    const finish = (): void => {
      if (run === undefined) return;
      const { from, to, kind } = run;
      const nears = middles(run.nears);
      const fars = middles(run.fars);
      const levels = run.levels;
      run = undefined;
      if (to - from < CHANNEL_MIN_LENGTH_METRES || channels.length >= MAXIMUM_CHANNELS) return;
      channels.push({
        from,
        to,
        side,
        waterElevation: Math.min(...levels),
        near: Math.min(...nears),
        far: Math.max(...fars),
        shores: {
          spacing,
          near: Float32Array.from(nears),
          far: Float32Array.from(fars),
          level: Float32Array.from(levels),
        },
        channel: kind,
      });
    };
    for (let index = 0; index < samples; index += 1) {
      const at = Math.min(total, index * spacing);
      const slot = index * 2 + (side === 1 ? 0 : 1);
      const kind = nearestKind[slot];
      const lateral = nearest[slot] as number;
      let near = 0;
      let far = 0;
      let found = false;
      if (kind !== undefined) {
        const shape = CHANNEL_SHAPES[kind];
        near = Math.max(CHANNEL_NEAR_METRES, lateral - shape.halfWidth);
        far = lateral + shape.halfWidth;
        found =
          far - near >= shape.halfWidth &&
          !inMappedLake(lakes, profile, at, side, near, far) &&
          coveredBeside(profile, origin, land, at, side, (near + far) / 2);
      }
      if (
        run !== undefined &&
        (!found || kind !== run.kind || Math.abs(lateral - run.lateral) > CHANNEL_JUMP_METRES)
      ) {
        finish();
      }
      if (!found || kind === undefined) continue;
      run ??= { from: at, to: at, kind, lateral, nears: [], fars: [], levels: [] };
      run.to = at;
      run.lateral = lateral;
      run.nears.push(near);
      run.fars.push(far);
      run.levels.push(elevationAt(profile, at) - CHANNEL_SHAPES[kind].belowRoad);
    }
    finish();
  }
  return channels;
}

/** Whether `[near, far]` beside the road at `at` lies on a mapped lake's water or its bank. */
function inMappedLake(
  lakes: readonly Lake[],
  profile: RouteProfile,
  at: number,
  side: 1 | -1,
  near: number,
  far: number,
): boolean {
  for (const lake of lakes) {
    if (lake.side !== side) continue;
    const shore = lakeShore(lake, profile, at);
    if (shore !== undefined && far >= shore.near - LAKE_BANK_METRES && near <= shore.far) {
      return true;
    }
  }
  return false;
}

/** Whether the map was read `lateral` metres out on `side` of the road at `at`. */
function coveredBeside(
  profile: RouteProfile,
  origin: CorridorOrigin,
  land: LandClassMask,
  at: number,
  side: 1 | -1,
  lateral: number,
): boolean {
  const frame = drawnRoadFrame(profile, origin, at);
  if (frame === undefined) return false;
  return land.covered(
    frame.x + frame.normalX * lateral * side,
    frame.z + frame.normalZ * lateral * side,
  );
}

/** What the water does to the ground at one point beside the route. */
export interface WaterShaping {
  /**
   * The highest the ground may be here, as a local height (relative to the
   * route's first elevation), or `+Infinity` where no water is near.
   */
  readonly ceiling: number;
  /** How much of the invented relief survives here, 0 to 1. */
  readonly relief: number;
  /**
   * The surface of the water whose shore this is, as a local height, or
   * `-Infinity` where no water is near — #501. What `landform.ts` darkens the
   * ground just above it by: the wet margin where water meets grass.
   *
   * ⚠️ **Reported on the SHORE only, never across a whole side of the road**
   * — #501's review. It used to be a lake's level at any distance on the
   * lake's side, and `wetness` darkens any ground below the level, so on the
   * soak route a hillside 200 to 420 m past the far shore, falling 6 to 31 m
   * below the lake, wore the full tint. Ground far from water is dry however
   * low it lies; {@link shore} is how near the water this point is.
   */
  readonly level: number;
  /**
   * How much of the wet margin applies here, 0 to 1 — #501's review: 1 on and
   * near the water, falling to 0 by {@link WET_REACH_METRES} past its edge.
   * `landform.ts` multiplies its wetness by this, so the margin fades out
   * rather than stopping at a line.
   */
  readonly shore: number;
}

/**
 * How far past the water's edge the wet margin may reach, in metres: **14** —
 * #501's review. One lake bank ({@link LAKE_BANK_METRES}), which is also how
 * far a stream's bank rises past its surface
 * ({@link CHANNEL_BANK_METRES} − {@link STREAM_SURFACE_HALF_WIDTH_METRES}): the
 * margin lives on the bank the water sits in, and fades out over its outer
 * half. `WaterShaping.shore`.
 */
export const WET_REACH_METRES = LAKE_BANK_METRES;

/** How much of the wet margin applies `outside` metres past the water's edge. */
function shoreWeight(outside: number): number {
  return 1 - smoothstep(WET_REACH_METRES / 2, WET_REACH_METRES, outside);
}

/** No water anywhere near. */
export const DRY: WaterShaping = {
  ceiling: Number.POSITIVE_INFINITY,
  relief: 1,
  level: Number.NEGATIVE_INFINITY,
  shore: 0,
};

/**
 * The channel and lake beds as a ceiling on the ground, and how much relief
 * they leave — at a point `signedLateral` from the centreline beside route
 * distance `wrapped`.
 */
export function waterShaping(
  ways: Waterways,
  profile: RouteProfile,
  origin: CorridorOrigin,
  wrapped: number,
  signedLateral: number,
  road: number,
): WaterShaping {
  let ceiling = Number.POSITIVE_INFINITY;
  let relief = 1;
  let level = Number.NEGATIVE_INFINITY;
  let shore = 0;
  // The nearest water's level, where more than one is in reach.
  const wet = (weight: number, surface: number): void => {
    if (weight > shore) {
      shore = weight;
      level = surface;
    }
  };
  const lateral = Math.abs(signedLateral);
  for (const crossing of ways.crossings) {
    const u = alongFromChannel(profile, wrapped, crossing);
    if (u > STREAM_ALONG_REACH_METRES || lateral > STREAM_REACH_METRES + CHANNEL_BANK_METRES) {
      continue;
    }
    const bed = crossing.waterElevation - STREAM_DEPTH_METRES - origin.elevation;
    ceiling = Math.min(
      ceiling,
      bankCeiling(bed, road, u - CHANNEL_FLAT_METRES, CHANNEL_BANK_METRES - CHANNEL_FLAT_METRES),
    );
    relief = Math.min(relief, smoothstep(CHANNEL_BANK_METRES, CHANNEL_BANK_METRES * 3, u));
    wet(
      shoreWeight(u - STREAM_SURFACE_HALF_WIDTH_METRES),
      crossing.waterElevation - origin.elevation,
    );
  }
  for (const lake of ways.lakes) {
    if (Math.sign(signedLateral) !== lake.side) {
      continue;
    }
    const shore = lakeShore(lake, profile, wrapped);
    if (shore === undefined) {
      continue;
    }
    const outside = Math.max(0, shore.near - lateral, lateral - shore.far);
    if (lake.channel !== undefined) {
      // #2974: the channel's own bed, under water that follows the road, and
      // its own banks, which meet the ground at its water's edge.
      const shape = CHANNEL_SHAPES[lake.channel];
      const surface = lakeLevel(lake, profile, wrapped) - origin.elevation;
      const bank =
        lateral < shore.near
          ? Math.max(0.5, Math.min(shape.bank, shore.near - ROAD_HALF_WIDTH_METRES))
          : shape.bank;
      ceiling = Math.min(
        ceiling,
        outside > 0 ? bankCeiling(surface, road, outside, bank) : surface - shape.depth,
      );
      relief = Math.min(relief, smoothstep(bank, bank * 4, outside));
      wet(1 - smoothstep(bank / 2, bank, outside), surface);
      continue;
    }
    // #2658: a wetland's ground stands just over its water, all of it in the wet margin.
    const bed =
      lake.waterElevation +
      (lake.wetland === true ? WETLAND_GROUND_ABOVE_WATER_METRES : -LAKE_DEPTH_METRES) -
      origin.elevation;
    const bank = lateral < shore.near ? nearBank(lake, shore.near) : LAKE_BANK_METRES;
    ceiling = Math.min(ceiling, bankCeiling(bed, road, outside, bank));
    relief = Math.min(relief, smoothstep(LAKE_BANK_METRES, LAKE_BANK_METRES * 4, outside));
    wet(shoreWeight(outside), lake.waterElevation - origin.elevation);
  }
  return { ceiling, relief, level, shore };
}

/**
 * How wide a lake's bank is between the road and its near shore `near` — #2754:
 * {@link LAKE_BANK_METRES}, but for a mapped lake no wider than the ground
 * from the road's edge out to it, so a shore nearer than
 * {@link LAKE_NEAR_METRES} climbs to the road's own height by the road's edge
 * rather than cutting into it. Steep, where the map has the sea at the road:
 * a sea wall's bank. An invented lake's is its own, item for item.
 */
function nearBank(lake: Lake, near: number): number {
  if (lake.shores === undefined) return LAKE_BANK_METRES;
  return Math.max(1, Math.min(LAKE_BANK_METRES, near - ROAD_HALF_WIDTH_METRES));
}

/**
 * Whether {@link waterShaping} can answer anything but {@link DRY} anywhere
 * across the route at `wrapped` — #569.
 *
 * Exactly the two tests in {@link waterShaping} that do not depend on how far
 * out the point is: a crossing too far along the road, and a lake with no
 * shore here. When both hold for every water, every point of the cross-section
 * is dry, so `landform.ts` asks once a row instead of once a vertex. #543 made
 * that 3 500 calls a frame, nearly all of them far from any water.
 */
export function waterNearRoute(ways: Waterways, profile: RouteProfile, wrapped: number): boolean {
  for (const crossing of ways.crossings) {
    const u = alongFromChannel(profile, wrapped, crossing);
    if (!(u > STREAM_ALONG_REACH_METRES)) {
      return true;
    }
  }
  for (const lake of ways.lakes) {
    if (lakeShore(lake, profile, wrapped) !== undefined) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a point beside the route is in water or on its banks — where
 * nothing may stand: a stream's whole channel, and a lake with its bank.
 */
export function inWater(
  ways: Waterways,
  profile: RouteProfile,
  wrapped: number,
  signedLateral: number,
): boolean {
  const lateral = Math.abs(signedLateral);
  for (const crossing of ways.crossings) {
    const u = alongFromChannel(profile, wrapped, crossing);
    // ⚠️ **The whole channel, banks included** — not just the water and its
    // clearance. The banks fall about four metres over twenty-two, and the
    // ground's rows are ten metres apart, so a tree placed on one stood up to a
    // third of a metre off the triangles drawn under it. A stream's banks are
    // bare: a meadow each side of the water, which is what a rider sees there.
    if (u <= CHANNEL_BANK_METRES && lateral <= STREAM_REACH_METRES) {
      return true;
    }
  }
  for (const lake of ways.lakes) {
    if (Math.sign(signedLateral) !== lake.side) {
      continue;
    }
    // The bank too, for the channel's reason: it falls to the bed over
    // {@link LAKE_BANK_METRES}, and a shrub on it stood 46 cm off the drawn
    // ground. A lake's near shore is 16 m out, so its side of the road is bare
    // along it — a lakeside meadow. ⚠️ And the widest the shore reaches within
    // a row's spacing either side, because at a lake's tapered ends the shore
    // runs diagonally across the ground's rows, and a tree beside a bank the
    // rows sample ten metres apart stood 46 cm off them as well.
    let near = Number.POSITIVE_INFINITY;
    let far = Number.NEGATIVE_INFINITY;
    for (const offset of [-SHORE_SEARCH_METRES, 0, SHORE_SEARCH_METRES]) {
      const shore = lakeShore(lake, profile, distanceOnRoute(profile, wrapped + offset));
      if (shore === undefined) continue;
      near = Math.min(near, shore.near);
      far = Math.max(far, shore.far);
    }
    const bank = lake.channel === undefined ? LAKE_BANK_METRES : CHANNEL_SHAPES[lake.channel].bank;
    if (lateral >= near - bank && lateral <= far + bank) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a point beside the route is over open water the scene draws — #2728:
 * a lake between its shores and {@link LAKE_SURFACE_PAST_SHORE_METRES} past
 * each, as {@link waterSurface} draws it, or a stream's surface strip
 * ({@link STREAM_SURFACE_HALF_WIDTH_METRES} along the road either side of its
 * crossing, out to {@link STREAM_REACH_METRES}). Not a bank, which
 * {@link inWater} adds, and not a wetland, which has no open water.
 *
 * ⚠️ **The drawn water, not the map's.** A mapped lake is drawn between its
 * run's shores ({@link mappedLakes}): until #2754 its medians, which lay up
 * to 20 m past the map's own shore, and since then each sample's, the middle
 * of three, held {@link MAPPED_LAKE_NEAR_METRES} from the road and drawn
 * {@link LAKE_SURFACE_PAST_SHORE_METRES} past. So the mask can still say land
 * where the scene draws water. A house or a person stood
 * there by the mask alone stood in the drawn sea: the owner's "houses
 * floating in inlets". `footprint-buildings.ts` drops a footprint over it and
 * `scene.ts` §`people` draws nobody on it.
 */
export function onOpenWater(
  ways: Waterways,
  profile: RouteProfile,
  wrapped: number,
  signedLateral: number,
): boolean {
  const lateral = Math.abs(signedLateral);
  for (const crossing of ways.crossings) {
    const u = alongFromChannel(profile, wrapped, crossing);
    if (u <= STREAM_SURFACE_HALF_WIDTH_METRES && lateral <= STREAM_REACH_METRES) {
      return true;
    }
  }
  for (const lake of ways.lakes) {
    if (lake.wetland === true || Math.sign(signedLateral) !== lake.side) {
      continue;
    }
    const shore = lakeShore(lake, profile, wrapped);
    const past = surfacePastShore(lake);
    if (shore !== undefined && lateral >= shore.near - past && lateral <= shore.far + past) {
      return true;
    }
  }
  return false;
}

/**
 * What {@link waterSurface} reads of the frame's drawn ground to lay a
 * channel on it — #2974: `landform.ts` §`TerrainMesh`'s vertices and rows.
 * Vertex `(row, side, column)` is at `row · 2 · columns + side · columns +
 * column`, side 0 the road's right, column 0 the road's edge.
 */
export interface DrapeGround {
  readonly vertices: Float32Array;
  readonly rows: number;
}

/**
 * The drawn ground's height `lateral` metres out from `(x, z)`, the row's
 * centreline point, on `side` of row `row` — #2974, between the two columns
 * either side of it, measured from the centreline to each vertex as the mesh
 * laid it, so a column pulled in on the inside of a bend is read where it
 * is. {@link CHANNEL_DRAPE_METRES} over that, or `-Infinity` where there is
 * no ground, or no such row or reach.
 */
function drapedHeight(
  ground: DrapeGround | undefined,
  row: number,
  side: 0 | 1,
  x: number,
  z: number,
  lateral: number,
): number {
  if (ground === undefined || row >= ground.rows || ground.rows === 0) {
    return Number.NEGATIVE_INFINITY;
  }
  const vertices = ground.vertices;
  const columns = vertices.length / 3 / ground.rows / 2;
  const base = (row * 2 + side) * columns;
  let inner = Number.NaN;
  let innerHeight = Number.NaN;
  for (let column = 0; column < columns; column += 1) {
    const at = (base + column) * 3;
    const out = Math.hypot((vertices[at] as number) - x, (vertices[at + 2] as number) - z);
    const height = vertices[at + 1] as number;
    if (out >= lateral) {
      const share = Number.isNaN(inner) || !(out > inner) ? 1 : (lateral - inner) / (out - inner);
      const y = Number.isNaN(inner) ? height : lerp(innerHeight, height, share);
      return y + CHANNEL_DRAPE_METRES;
    }
    inner = out;
    innerHeight = height;
  }
  return Number.NEGATIVE_INFINITY;
}

/**
 * #2974: a mapped pool on the ground, ready for {@link waterSurface} —
 * `mapped-pools.ts` §`poolsInView` builds it.
 */
export interface PoolSurface {
  /** Its outline, `x, z` pairs in the corridor frame, open. */
  readonly ring: Float32Array;
  /** Its water's triangles, as indices into {@link ring}'s points. */
  readonly indices: Uint32Array;
  /** Its coping's outer edge, one point for each of {@link ring}'s, set out square to its sides. */
  readonly outer: Float32Array;
  /** Its middle: what a frame finds the nearest pools by. */
  readonly centreX: number;
  readonly centreZ: number;
  /** Its water's height, its coping's top and its skirt's foot, as local heights. */
  readonly water: number;
  readonly edge: number;
  readonly foot: number;
}

/**
 * #2974: the shore weights that mark a pool's faces in the water's mesh,
 * above a lake's and a stream's 0 to 1: its water ({@link POOL_WATER_SHORE}),
 * its coping's lip and top ({@link POOL_EDGE_SHORE}) and its skirt
 * ({@link POOL_SIDE_SHORE}). `three-renderer.ts` §`WATER_FRAGMENT` colours by
 * them, at the halfway marks between, and never blends one into another,
 * because no triangle has two marks.
 */
export const POOL_WATER_SHORE = 2;
export const POOL_EDGE_SHORE = 3;
export const POOL_SIDE_SHORE = 4;

/** A pool's three rings of faces, as the pairs of its six vertices a point that bound them. */
const POOL_FACES: readonly (readonly [number, number])[] = [
  [1, 2],
  [2, 3],
  [4, 5],
];

/** The water surfaces in one frame, ready to become a vertex buffer. */
export interface WaterSurface {
  /** Three floats a vertex. */
  readonly vertices: Float32Array;
  /**
   * One float a vertex: 0 at a shore, 1 in the middle. What the shader tints
   * the edges by — #459's "depth-tinted edges", from the geometry rather than
   * from a depth buffer, because reading one back is a second pass.
   */
  readonly shore: Float32Array;
  readonly indices: Uint32Array;
  /**
   * Which build lent these buffers — #469. Absent on a surface somebody owns
   * outright (a copy, or one built by hand in a test).
   *
   * ⚠️ **The three arrays are BORROWED, and valid until the next
   * {@link waterSurface}.** They are views over storage this module keeps and
   * writes again on the next build, so a surface held across another build
   * reads the newer one's water. `three-renderer.ts` §`WaterBelt.update`
   * refuses a stale lease rather than drawing it, and
   * `frame-testing.ts` §`retainedFrame` is how a caller that must hold two
   * frames at once takes a copy.
   */
  readonly lease?: number | undefined;
}

/** The lateral stations a stream's surface is built at, either side of the road. */
const STREAM_STATIONS: readonly number[] = [
  0,
  4,
  12,
  30,
  60,
  100,
  160,
  240,
  330,
  STREAM_REACH_METRES,
];

/**
 * Every stream and lake surface in view of this frame's corridor.
 *
 * A stream is a straight strip along the road's own normal at the crossing,
 * {@link STREAM_SURFACE_HALF_WIDTH_METRES} either side of it, out to
 * {@link STREAM_REACH_METRES} — under the bridge and across the road's width
 * too, which is what the rider looks down at over the parapet. A lake is a
 * strip beside the corridor's own rows, between its shores.
 *
 * A {@link Lake.channel} — #2974 — is a strip between its shores at its
 * water's height row by row, and **laid on `ground`** wherever this frame's
 * drawn ground stands over that water, {@link CHANNEL_DRAPE_METRES} above it:
 * the ground's columns are 4 to 20 m apart beside the road, so a ditch or a
 * stream between two of them cuts no channel the mesh can draw, and its
 * water, at its own height, would be under the grass. `ground` is the frame's
 * `landform.ts` §`terrainCorridor`, built from the same `corridor`, so its
 * rows are this corridor's. Without it a channel is drawn at its water's
 * height alone.
 *
 * A pool — #2974, `mapped-pools.ts` — is its outline's triangles at its
 * water's height, marked {@link POOL_WATER_SHORE}, and a coping round it:
 * a lip from its water up to the coping's top and the top itself, both
 * {@link POOL_EDGE_SHORE}, and a skirt down to the ground,
 * {@link POOL_SIDE_SHORE}. The shader colours each by its mark.
 */
export function waterSurface(
  profile: RouteProfile,
  origin: CorridorOrigin,
  corridor: RoadCorridor,
  ways: Waterways,
  ground?: DrapeGround,
  pools: readonly PoolSurface[] = [],
): WaterSurface {
  waterLease += 1;
  let vertexCount = 0;
  let indexCount = 0;
  const centre = corridor.centre;
  const first = centre[0] as CorridorPoint;
  const last = centre[centre.length - 1] as CorridorPoint;
  /**
   * One station — shore, middle, shore — its three points written in place;
   * `yMiddle` and `yFar` the middle's and the far shore's heights where they
   * are not the near shore's (#2974).
   */
  const station = (
    x: number,
    y: number,
    z: number,
    acrossX: number,
    acrossZ: number,
    near: number,
    far: number,
    yMiddle = y,
    yFar = y,
  ): void => {
    reserveWater(vertexCount + 3, indexCount);
    const { vertices, shore } = waterScratch;
    const middle = (near + far) / 2;
    for (let point = 0; point < 3; point += 1) {
      const across = point === 0 ? near : point === 1 ? middle : far;
      vertices[vertexCount * 3] = x + acrossX * across;
      vertices[vertexCount * 3 + 1] = point === 0 ? y : point === 1 ? yMiddle : yFar;
      vertices[vertexCount * 3 + 2] = z + acrossZ * across;
      shore[vertexCount] = point === 1 ? 1 : 0;
      vertexCount += 1;
    }
  };
  /** #2974: one vertex of a pool, marked, into storage {@link reserveWater} has made room in. */
  const put = (x: number, y: number, z: number, mark: number): void => {
    waterScratch.vertices[vertexCount * 3] = x;
    waterScratch.vertices[vertexCount * 3 + 1] = y;
    waterScratch.vertices[vertexCount * 3 + 2] = z;
    waterScratch.shore[vertexCount] = mark;
    vertexCount += 1;
  };
  /**
   * Two quads between each station of a run and the next, from vertex `base`.
   * A run of fewer than two stations draws nothing and gives its vertices back.
   */
  const strip = (base: number): void => {
    const stations = (vertexCount - base) / 3;
    if (stations < 2) {
      vertexCount = base;
      return;
    }
    reserveWater(vertexCount, indexCount + (stations - 1) * 12);
    const indices = waterScratch.indices;
    for (let at = 0; at + 1 < stations; at += 1) {
      for (let lane = 0; lane < 2; lane += 1) {
        const a = base + at * 3 + lane;
        const b = a + 1;
        const c = a + 3;
        const d = c + 1;
        indices[indexCount] = a;
        indices[indexCount + 1] = b;
        indices[indexCount + 2] = c;
        indices[indexCount + 3] = b;
        indices[indexCount + 4] = d;
        indices[indexCount + 5] = c;
        indexCount += 6;
      }
    }
  };

  for (const crossing of ways.crossings) {
    // ⚠️ **Once, however many laps of a short loop the corridor spans**: every
    // lap's crossing is the same place, and two copies of one strip would
    // fight for the same depth.
    const widen = crossingWiden(crossing);
    if (occurrences(profile, crossing.distance, first.along, last.along, widen).length > 0) {
      // ⚠️ On the DRAWN road, not the route's centreline — #543's review. The
      // strip runs under the bridge and across the carriageway, and in a bend
      // the ribbon is drawn up to ~1.9 m inside the route's vertex.
      const here = drawnRoadPosition(profile, origin, crossing.distance);
      const ahead = drawnRoadPosition(profile, origin, crossing.distance + 5);
      const behind = drawnRoadPosition(profile, origin, crossing.distance - 5);
      const dx = ahead.x - behind.x;
      const dz = ahead.z - behind.z;
      const length = Math.hypot(dx, dz);
      if (!(length > 0)) continue;
      const tx = dx / length;
      const tz = dz / length;
      const y = crossing.waterElevation - origin.elevation;
      const base = vertexCount;
      for (const lateral of STREAM_LATERALS) {
        // The normal is (−tz, tx): `terrain.ts`'s convention — the road's
        // right since #583, called its left before. Across the stream is along
        // the road.
        station(
          here.x - tz * lateral,
          y,
          here.z + tx * lateral,
          tx,
          tz,
          -STREAM_SURFACE_HALF_WIDTH_METRES - widen,
          STREAM_SURFACE_HALF_WIDTH_METRES + widen,
        );
      }
      strip(base);
    }
  }

  if (ways.lakes.length > 0) {
    const normals = ribbonNormals(centre);
    for (const lake of ways.lakes) {
      // #2658: a wetland is wet ground, and its water is not drawn over it.
      if (lake.wetland === true) continue;
      let base = vertexCount;
      const level = lake.waterElevation - origin.elevation;
      const past = surfacePastShore(lake);
      for (let row = 0; row < centre.length; row += 1) {
        const point = centre[row] as CorridorPoint;
        // #3103: and none beside a pass whose road is not drawn (`terrain.ts`
        // §`retracedRows`): the road there is the nearer pass's, and so is
        // the water. A recorded way back need not be at the way out's height,
        // and its lake, level under ITS lowest road, stood 0.8 m over the
        // drawn road of a way out climbing to the turn.
        const shoreAt =
          corridor.retraced[row] === 1 ? undefined : lakeShore(lake, profile, point.distance);
        if (shoreAt === undefined) {
          strip(base);
          base = vertexCount;
          continue;
        }
        const acrossX = (normals[row * 2] as number) * lake.side;
        const acrossZ = (normals[row * 2 + 1] as number) * lake.side;
        const near = shoreAt.near - past;
        const far = shoreAt.far + past;
        if (lake.channel === undefined) {
          // Past each shore, under the bank, so the water meets the ground
          // rather than stopping short of it; the bank hides the rest.
          station(point.x, level, point.z, acrossX, acrossZ, near, far);
          continue;
        }
        // #2974: the channel's water here, or the drawn ground over it.
        const y = lakeLevel(lake, profile, point.distance) - origin.elevation;
        const side = lake.side === 1 ? 0 : 1;
        const on = (lateral: number): number =>
          Math.max(y, drapedHeight(ground, row, side, point.x, point.z, lateral));
        station(
          point.x,
          on(near),
          point.z,
          acrossX,
          acrossZ,
          near,
          far,
          on((near + far) / 2),
          on(far),
        );
      }
      strip(base);
    }
  }

  for (const pool of pools) {
    const points = pool.ring.length / 2;
    reserveWater(vertexCount + points * 6, indexCount + pool.indices.length + points * 18);
    const { indices } = waterScratch;
    const base = vertexCount;
    // Six vertices a point of the outline: the water; the lip's foot and top
    // and the coping's outer top; the skirt's top and its foot. Where two
    // stand together they are marked apart, so a face never blends its
    // neighbour's mark.
    for (let point = 0; point < points; point += 1) {
      const x = pool.ring[point * 2] as number;
      const z = pool.ring[point * 2 + 1] as number;
      const ox = pool.outer[point * 2] as number;
      const oz = pool.outer[point * 2 + 1] as number;
      put(x, pool.water, z, POOL_WATER_SHORE);
      put(x, pool.water, z, POOL_EDGE_SHORE);
      put(x, pool.edge, z, POOL_EDGE_SHORE);
      put(ox, pool.edge, oz, POOL_EDGE_SHORE);
      put(ox, pool.edge, oz, POOL_SIDE_SHORE);
      put(ox, pool.foot, oz, POOL_SIDE_SHORE);
    }
    for (const index of pool.indices) {
      indices[indexCount] = base + index * 6;
      indexCount += 1;
    }
    for (let point = 0; point < points; point += 1) {
      const here = base + point * 6;
      const next = base + ((point + 1) % points) * 6;
      // The lip, the coping's top and its skirt: a quad each, point to point.
      for (const [from, to] of POOL_FACES) {
        indices[indexCount] = here + from;
        indices[indexCount + 1] = next + from;
        indices[indexCount + 2] = here + to;
        indices[indexCount + 3] = next + from;
        indices[indexCount + 4] = next + to;
        indices[indexCount + 5] = here + to;
        indexCount += 6;
      }
    }
  }

  return {
    vertices: waterScratch.vertices.subarray(0, vertexCount * 3),
    shore: waterScratch.shore.subarray(0, vertexCount),
    indices: waterScratch.indices.subarray(0, indexCount),
    lease: waterLease,
  };
}

/**
 * The stream's stations across the road, from the far bank on one side to the
 * far bank on the other: {@link STREAM_STATIONS} mirrored. Built once rather
 * than per crossing per frame — #469.
 */
const STREAM_LATERALS: readonly number[] = [
  ...STREAM_STATIONS.slice(1)
    .map((each) => -each)
    .reverse(),
  ...STREAM_STATIONS,
];

/**
 * The storage every {@link waterSurface} writes into and lends views of — #469.
 *
 * ⚠️ **Grown, never shrunk, and never allocated on a frame that fits.** Until
 * #469 a frame built three JavaScript arrays, a tuple a point and three typed
 * arrays copied out of them, sixty times a second on the thread GATT
 * notifications arrive on (#240's NFR-2), and #323 is what per-frame garbage
 * looks like on a phone: a periodic stall. The renderer copies what it is
 * handed (`three-renderer.ts` §`upload`), so lending is safe for it; the lease
 * is what makes it safe for everyone else.
 */
let waterScratch: {
  vertices: Float32Array;
  shore: Float32Array;
  indices: Uint32Array;
} = { vertices: new Float32Array(0), shore: new Float32Array(0), indices: new Uint32Array(0) };

/** The build that lent {@link waterScratch} last. @see WaterSurface.lease */
let waterLease = 0;

/** Whether a surface's buffers are still the ones its build wrote. @see WaterSurface.lease */
export function waterSurfaceIsCurrent(surface: WaterSurface): boolean {
  return surface.lease === undefined || surface.lease === waterLease;
}

/** Room for `vertices` vertices and `indices` indices, keeping what is written. */
function reserveWater(vertices: number, indices: number): void {
  if (waterScratch.shore.length < vertices) {
    const room = Math.max(vertices, waterScratch.shore.length * 2, 64);
    const grown = { vertices: new Float32Array(room * 3), shore: new Float32Array(room) };
    grown.vertices.set(waterScratch.vertices);
    grown.shore.set(waterScratch.shore);
    waterScratch = { ...waterScratch, ...grown };
  }
  if (waterScratch.indices.length < indices) {
    const room = Math.max(indices, waterScratch.indices.length * 2, 256);
    const grown = new Uint32Array(room);
    grown.set(waterScratch.indices);
    waterScratch = { ...waterScratch, indices: grown };
  }
}

/**
 * One block of a bridge: a box `length` long along `(axisX, axisY, axisZ)`,
 * `width` across it horizontally and `height` up, centred on `(x, y, z)`.
 */
export interface BridgePart {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly axisX: number;
  readonly axisY: number;
  readonly axisZ: number;
  readonly length: number;
  readonly width: number;
  readonly height: number;
  /**
   * What the block is dressed in — #2699. Absent, as every stream bridge's
   * block is: the bridges' stone. Otherwise an overpass's
   * (`overpasses.ts`): `'road'` for its deck, which carries a street and wears
   * the road's colour, and `'concrete'` for its edge beams and
   * abutments. `three-renderer.ts` §`BridgeBelt` draws the two apart.
   */
  readonly finish?: BridgeFinish;
}

/** An overpass block's dress — #2699. @see BridgePart.finish */
export type BridgeFinish = 'road' | 'concrete';

/** The most blocks one frame's bridges may be built from — a bound on the instance buffer. */
export const MAXIMUM_BRIDGE_PARTS = 128;

/**
 * The bridges in view of this frame's corridor: parapets along both edges of
 * the road over the span, each with a coping along its top (#501), a slab
 * under the deck, an abutment at each end, and
 * the approach beyond each abutment out to {@link CHANNEL_BANK_METRES}.
 *
 * ⚠️ **The deck is the road**, drawn by `terrain.ts` exactly as everywhere
 * else: every part here stands beside or under it, at the road's own height
 * read off the same profile, so the parapet follows the deck up and down
 * whatever the route does across the valley.
 */
export function bridgeParts(
  profile: RouteProfile,
  origin: CorridorOrigin,
  corridor: RoadCorridor,
  ways: Waterways,
): readonly BridgePart[] {
  const parts: BridgePart[] = [];
  const first = corridor.centre[0] as CorridorPoint;
  const last = corridor.centre[corridor.centre.length - 1] as CorridorPoint;
  const { under } = roadUnder(profile, origin, corridor);
  for (const crossing of ways.crossings) {
    // #3105: a mapped river's bridge is its water's width longer, each end.
    const widen = crossingWiden(crossing);
    const halfSpan = BRIDGE_HALF_SPAN_METRES + widen;
    // Once, for the reason `waterSurface` gives: every lap's bridge is the
    // same bridge, and `roadAt` wraps an odometer onto it.
    for (const centre of occurrences(
      profile,
      crossing.distance,
      first.along,
      last.along,
      widen,
    ).slice(0, 1)) {
      deckPieces(profile, origin, corridor, centre - halfSpan, centre + halfSpan, parts);
      const bed = crossing.waterElevation - STREAM_DEPTH_METRES - origin.elevation;
      const bottom = bed - 1;
      /** From the top of a block under the road down into the bed, at its middle. */
      const toBed = (top: BlockTop): number => (top.near.y + top.far.y) / 2 - bottom;
      for (const end of [-1, 1]) {
        // ⚠️ **Along the road's own slope, not level** — #501. This box was
        // level until then, three metres long under a road sloping down into
        // the valley, so its top stood above the road over the downhill half
        // of it: 4.5 cm on a 5 % approach, 9 cm on the soak route's 8 %. A lit
        // stone face through tarmac is the *"light seam across the road where
        // the bridge deck starts"* validation 0002 Z10 found on the tablet.
        // `waterways.test.ts` §"the road is continuous across the bridge".
        const abutment = centre + end * halfSpan;
        const top = under(
          abutment - ABUTMENT_HALF_LENGTH_METRES,
          abutment + ABUTMENT_HALF_LENGTH_METRES,
        );
        const block = hung(top, ROAD_WIDTH_METRES + PARAPET_THICKNESS_METRES * 4, toBed(top));
        if (block !== undefined) parts.push(block);
        // ⚠️ **The approach: solid under the road from the abutment to where
        // the bank meets it.** #468's review, B2. The channel lowers the ground
        // at the road's edge for {@link CHANNEL_BANK_METRES} either side of the
        // stream, and the bridge spans only {@link BRIDGE_HALF_SPAN_METRES} of
        // that: on the first head the road was 3.7 m over the ground 10 m out
        // and 1.9 m at 20 m, a strip of tarmac over an open trench for fifteen
        // metres past each abutment. Pieces that follow the road's slope, as
        // the deck's do, from the deck's top down into the bed — a causeway
        // with stone sides, which is what carries a lane down to a small bridge.
        const approach = CHANNEL_BANK_METRES - BRIDGE_HALF_SPAN_METRES;
        const steps = Math.ceil(approach / BRIDGE_PIECE_METRES);
        for (let piece = 0; piece < steps; piece += 1) {
          const top = under(
            centre + end * (halfSpan + (piece * approach) / steps),
            centre + end * (halfSpan + ((piece + 1) * approach) / steps),
          );
          const block = hung(top, ROAD_WIDTH_METRES + PARAPET_THICKNESS_METRES * 4, toBed(top));
          if (block !== undefined) parts.push(block);
        }
      }
      if (parts.length >= MAXIMUM_BRIDGE_PARTS) {
        return parts.slice(0, MAXIMUM_BRIDGE_PARTS);
      }
    }
  }
  return parts;
}

/**
 * The most pieces one deck is built from: **12** — #3105. A stream's bridge is
 * six pieces of {@link BRIDGE_PIECE_METRES}; a mapped river's is longer, and
 * past twelve pieces each piece is longer instead, so the longest bridge is
 * 60 boxes of the belt's {@link MAXIMUM_BRIDGE_PARTS}, and its abutments and
 * approaches (12 more), the rest of a mapped span's parapets and a side
 * street's deck beside it still fit. A piece is then a straight chord of up
 * to 25 m of a 300 m river's bridge: on a bridge that bends, its parapet
 * stands a few decimetres off the carriageway's edge at the chord's middle.
 */
export const BRIDGE_MAX_PIECES = 12;

/** The road at an odometer reading, and a block's top under a stretch of it. */
function roadUnder(
  profile: RouteProfile,
  origin: CorridorOrigin,
  corridor: RoadCorridor,
): {
  readonly roadAt: (distance: number) => { x: number; y: number; z: number };
  readonly under: (from: number, to: number) => BlockTop;
} {
  const roadAt = (distance: number): { x: number; y: number; z: number } => {
    const wrapped = distanceOnRoute(profile, distance);
    // ⚠️ The DRAWN road — #543's review. Until then this was the route's own
    // centreline, which is where the ribbon ran until #543 rounded its bends:
    // at a 45° corner on the valley floor that put the inner parapet 1.27 m
    // into the carriageway. The HEIGHT stays the route's, as the ribbon's does.
    const ground = drawnRoadPosition(profile, origin, wrapped);
    return { x: ground.x, y: elevationAt(profile, wrapped) - origin.elevation, z: ground.z };
  };
  /**
   * The top of a block under the road from odometer `from` to `to`: the
   * straight line between the road at each end, 3 cm down, and sunk by however
   * far it would otherwise stand over the road DRAWN anywhere between them.
   *
   * ⚠️ **The drawn road, not the route's height** — #1997. Until then this
   * sank a piece by how far its chord stood over the route's own height at
   * its middle (#501), but the ribbon's rows are not on the profile's own
   * corners: over one that crests, the DRAWN road is a chord below the
   * route's height, and the block stood over it — 12 cm on a rough 20 %
   * valley side (`route-fixtures-testing.ts` §`steepValleyRoute(0.3)`) with
   * the bridge past the corridor's two-metre rows, where they are a grid step
   * apart. The rows inside a piece cover what #501's middle did, so it is one
   * rule rather than two.
   */
  const under = (from: number, to: number): BlockTop => {
    const near = roadAt(from);
    const far = roadAt(to);
    const sink = sinkUnderDrawnRoad(corridor.centre, from, near.y, to, far.y);
    return {
      near: { x: near.x, y: near.y - sink - 0.03, z: near.z },
      far: { x: far.x, y: far.y - sink - 0.03, z: far.z },
    };
  };
  return { roadAt, under };
}

/**
 * A deck's own pieces along the road from odometer `from` to `to`, pushed
 * onto `parts`: a parapet along each edge with its coping (#501), and the slab
 * under the road — a stream's bridge between its abutments, and since #3105 a
 * mapped bridge's whole span (`mapped-spans.ts`). At most
 * {@link BRIDGE_MAX_PIECES} pieces, each {@link BRIDGE_PIECE_METRES} or longer
 * (`options.pieceMetres` where a caller cuts its own), and no slab where
 * `options.slab` is `false`: a deck with the ground under it.
 */
export function deckPieces(
  profile: RouteProfile,
  origin: CorridorOrigin,
  corridor: RoadCorridor,
  from: number,
  to: number,
  parts: BridgePart[],
  options: { readonly pieceMetres?: number; readonly slab?: boolean } = {},
): void {
  const { roadAt, under } = roadUnder(profile, origin, corridor);
  const span = to - from;
  if (!(span > 0)) return;
  const pieceMetres = Math.max(BRIDGE_PIECE_METRES, options.pieceMetres ?? BRIDGE_PIECE_METRES);
  const pieces = Math.min(BRIDGE_MAX_PIECES, Math.ceil(span / pieceMetres));
  const step = span / pieces;
  for (let piece = 0; piece < pieces; piece += 1) {
    const start = roadAt(from + piece * step);
    const end = roadAt(from + (piece + 1) * step);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dy, dz);
    if (!(length > 0)) continue;
    const flat = Math.hypot(dx, dz);
    const ax = dx / length;
    const ay = dy / length;
    const az = dz / length;
    // The normal in plan: `terrain.ts`'s convention — the road's right
    // since #583, called its left before.
    const nx = -dz / flat;
    const nz = dx / flat;
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2, z: (start.z + end.z) / 2 };
    for (const side of [1, -1]) {
      const out = ROAD_HALF_WIDTH_METRES + PARAPET_THICKNESS_METRES / 2;
      parts.push({
        x: mid.x + nx * out * side,
        y: mid.y + PARAPET_HEIGHT_METRES / 2 - 0.05,
        z: mid.z + nz * out * side,
        axisX: ax,
        axisY: ay,
        axisZ: az,
        length,
        width: PARAPET_THICKNESS_METRES,
        height: PARAPET_HEIGHT_METRES + 0.1,
      });
      // #501: the coping along its top, a little proud of its outer face.
      const coping = out + COPING_OVERHANG_METRES / 2;
      parts.push({
        x: mid.x + nx * coping * side,
        y: mid.y + PARAPET_HEIGHT_METRES - COPING_DEPTH_METRES / 2,
        z: mid.z + nz * coping * side,
        axisX: ax,
        axisY: ay,
        axisZ: az,
        length,
        width: PARAPET_THICKNESS_METRES + COPING_OVERHANG_METRES,
        height: COPING_DEPTH_METRES,
      });
    }
    // ⚠️ **Under the road, not under the chord** — #501. A piece is
    // straight between its two ends; where the valley's slope meets its
    // floor it spans the bend, and its middle stood above the road there —
    // 1.25 cm over the 5 % valley's floor, with the 3 cm clearance spent.
    // `under` sinks it by however far it stands over the road between.
    if (options.slab === false) continue;
    const slab = hung(
      under(from + piece * step, from + (piece + 1) * step),
      ROAD_WIDTH_METRES + PARAPET_THICKNESS_METRES * 2,
      DECK_DEPTH_METRES,
    );
    if (slab !== undefined) parts.push(slab);
  }
}

/** How long an abutment is along the road, either side of its middle: 1.5 m. */
const ABUTMENT_HALF_LENGTH_METRES = 1.5;

/** The line a block's top face runs along, from one end of it to the other. */
interface BlockTop {
  readonly near: { readonly x: number; readonly y: number; readonly z: number };
  readonly far: { readonly x: number; readonly y: number; readonly z: number };
}

/**
 * A block hung from its top: the top face runs straight along `top`, `width`
 * across, and the block's bottom face lies `drop` metres below the top face's
 * middle, square to the face (so plumb below that middle it is `drop` / cos² θ).
 * `undefined` where the line has no length in plan.
 *
 * ⚠️ **Hung from the top, not centred on the middle** — #1997.
 * `three-renderer.ts` §`BridgeBelt.update` stands a part's `height` square to
 * its sloping axis, not plumb, so a block centred under the road's middle on a
 * grade θ has its top face h/2·(sec θ − 1) higher than its middle says. That
 * is nothing on a 0.8 m deck slab and 8.3 cm on an approach piece, 8.4 m from
 * the road to the bed, on a 20 % valley side — 5.3 cm over the road once the
 * 3 cm under it is spent: the stone slab the owner rode through on the tablet.
 * So the middle is found from the top face, back along the block's own up.
 */
function hung(top: BlockTop, width: number, drop: number): BridgePart | undefined {
  const dx = top.far.x - top.near.x;
  const dy = top.far.y - top.near.y;
  const dz = top.far.z - top.near.z;
  const length = Math.hypot(dx, dy, dz);
  const flat = Math.hypot(dx, dz);
  if (!(flat > 0)) return undefined;
  const cos = flat / length;
  const sin = dy / length;
  const height = drop / cos;
  // The renderer's up, (−sin θ along the road in plan, cos θ), times −h/2.
  const back = (sin * height) / 2 / flat;
  return {
    x: (top.near.x + top.far.x) / 2 + dx * back,
    y: (top.near.y + top.far.y) / 2 - (cos * height) / 2,
    z: (top.near.z + top.far.z) / 2 + dz * back,
    axisX: dx / length,
    axisY: dy / length,
    axisZ: dz / length,
    length,
    width,
    height,
  };
}

/**
 * How far the straight line from height `fromY` at odometer `from` to `toY` at
 * `to` must sink to stand nowhere above the road DRAWN between them — #1997:
 * the corridor's rows, joined straight, as `terrain.ts` lays the ribbon. The
 * line and the ribbon are both straight between rows, so the rows inside and
 * the ribbon at the two ends are every place the line can be highest over it.
 * Zero where the corridor does not reach.
 */
export function sinkUnderDrawnRoad(
  rows: readonly CorridorPoint[],
  from: number,
  fromY: number,
  to: number,
  toY: number,
): number {
  const lineAt = (along: number): number => fromY + ((toY - fromY) * (along - from)) / (to - from);
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  let sink = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] as CorridorPoint;
    if (row.along > low && row.along < high) {
      sink = Math.max(sink, lineAt(row.along) - row.y);
    }
    const next = rows[index + 1];
    if (next === undefined || !(next.along > row.along)) continue;
    for (const end of [from, to]) {
      if (end < row.along || end > next.along) continue;
      const drawn = row.y + ((next.y - row.y) * (end - row.along)) / (next.along - row.along);
      sink = Math.max(sink, lineAt(end) - drawn);
    }
  }
  return sink;
}

/**
 * Where on the route a point is from `target`, both wrapped: signed, the short
 * way round on a loop.
 */
/**
 * How far along the road `wrapped` is from where a stream's channel would
 * begin at `crossing` — #3105: its distance from the crossing's middle, less
 * {@link crossingWiden}, and never less than nought. On a crossing with no
 * mapped width it is the distance itself, as it was.
 */
function alongFromChannel(profile: RouteProfile, wrapped: number, crossing: Crossing): number {
  const u = Math.abs(routeOffset(profile, wrapped, crossing.distance));
  const widen = crossingWiden(crossing);
  return widen === 0 ? u : Math.max(0, u - widen);
}

function routeOffset(profile: RouteProfile, wrapped: number, target: number): number {
  const offset = wrapped - target;
  if (!profile.loop) {
    return offset;
  }
  const total = profile.totalDistance;
  return offset - Math.round(offset / total) * total;
}

/**
 * Every odometer reading at which route distance `wrapped` lies between `from`
 * and `to` — once on a point-to-point route, once a lap on a loop — widened by
 * a bridge's own reach so a crossing just outside the corridor still draws.
 */
function occurrences(
  profile: RouteProfile,
  wrapped: number,
  from: number,
  to: number,
  widen = 0,
): readonly number[] {
  // #3105: and by a mapped river's own width past a stream's.
  const margin = CHANNEL_BANK_METRES + widen;
  if (!profile.loop) {
    return wrapped >= from - margin && wrapped <= to + margin ? [wrapped] : [];
  }
  const total = profile.totalDistance;
  const found: number[] = [];
  const firstLap = Math.floor((from - margin - wrapped) / total);
  // ⚠️ **At most two laps' worth**: every caller uses one occurrence, and a
  // loop a few metres round — a hostile file's — would otherwise be walked a
  // lap at a time across the whole view, every frame. @see settlements.ts's
  // own bound, and `scatter.ts` §`scatterAt`'s.
  const lastLap = Math.min(Math.ceil((to + margin - wrapped) / total), firstLap + 2);
  for (let lap = firstLap; lap <= lastLap; lap += 1) {
    const odometer = wrapped + lap * total;
    if (odometer >= from - margin && odometer <= to + margin) {
      found.push(odometer);
    }
  }
  return found;
}

/**
 * A lake's shores at a point of the route, as distances from the centreline,
 * or `undefined` where the lake has narrowed to nothing or is not.
 */
function lakeShore(
  lake: Lake,
  profile: RouteProfile,
  wrapped: number,
): { readonly near: number; readonly far: number } | undefined {
  const start = routeOffset(profile, wrapped, lake.from);
  const length = lake.to - lake.from;
  if (start < 0 || start > length) {
    return undefined;
  }
  const shores = lake.shores;
  const tapering =
    lake.channel !== undefined
      ? CHANNEL_TAPER_METRES
      : shores === undefined
        ? LAKE_TAPER_METRES
        : MAPPED_LAKE_TAPER_METRES;
  const taper = Math.min(smoothstep(0, tapering, start), smoothstep(0, tapering, length - start));
  // #2658: a mapped lake's shores are the map's; since #2754 where the map
  // measured them along the run, between its two samples either side.
  let nearest = lake.near ?? LAKE_NEAR_METRES;
  let furthest = lake.far ?? LAKE_FAR_METRES;
  if (shores !== undefined) {
    const last = shores.near.length - 1;
    const step = Math.min(last, Math.max(0, start / shores.spacing));
    const below = Math.floor(step);
    const above = Math.min(last, below + 1);
    const share = step - below;
    nearest = lerp(shores.near[below] as number, shores.near[above] as number, share);
    furthest = lerp(shores.far[below] as number, shores.far[above] as number, share);
  }
  const middle = (nearest + furthest) / 2;
  const half = ((furthest - nearest) / 2) * taper;
  if (!(half > (lake.channel === undefined ? 1 : CHANNEL_MIN_HALF_METRES))) {
    return undefined;
  }
  return { near: middle - half, far: middle + half };
}

/**
 * A lake's water at a point of the route, as an elevation — #2974: a
 * {@link Lake.channel}'s, between its two samples either side, and every
 * other lake's level {@link Lake.waterElevation}.
 */
function lakeLevel(lake: Lake, profile: RouteProfile, wrapped: number): number {
  const level = lake.shores?.level;
  if (level === undefined || level.length === 0) return lake.waterElevation;
  const start = Math.max(0, routeOffset(profile, wrapped, lake.from));
  const last = level.length - 1;
  const step = Math.min(last, start / (lake.shores as LakeShores).spacing);
  const below = Math.floor(step);
  const above = Math.min(last, below + 1);
  return lerp(level[below] as number, level[above] as number, step - below);
}

/**
 * How far past each shore a lake's surface is drawn: {@link
 * LAKE_SURFACE_PAST_SHORE_METRES}, under its bank, but for a
 * {@link Lake.channel}, whose surface stops at its shores — #2974: it is laid
 * on the ground where the ground stands over it, so a surface run on under a
 * bank would be drawn ON the bank, and a ditch a metre wide would be five.
 */
function surfacePastShore(lake: Lake): number {
  return lake.channel === undefined ? LAKE_SURFACE_PAST_SHORE_METRES : 0;
}

/** The search itself. @see waterways */
/**
 * How low each sample must be for a lake beside it, on an open-world view —
 * #3065: {@link LAKE_LOW_SHARE} of the way up, at least
 * {@link LAKE_LOW_METRES}, from the lowest to the highest of the samples
 * within `reach` of it, as a route reads its whole profile.
 *
 * ⚠️ **Why round each sample, and why that far.** A view's lowest and
 * highest samples move as road is added ahead and dropped behind, and a
 * level read off them moved every lake at a view change, or made one or took
 * one away. Read within `reach`, the lake enclosure's own distance, a lake
 * is decided by the road within that much of it, which a lake needs on the
 * view to be found at all (the road must climb out of it either side): so
 * any two views that can find a lake read it the same way. And it is still
 * the land round the lake that says how low is low, on a ride that climbs
 * a long way from where it started.
 */
function lowAround(elevation: Float64Array, reach: number): Float64Array {
  const count = elevation.length;
  const low = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    let lowest = Number.POSITIVE_INFINITY;
    let highest = Number.NEGATIVE_INFINITY;
    const last = Math.min(count - 1, index + reach);
    for (let near = Math.max(0, index - reach); near <= last; near += 1) {
      const each = elevation[near] as number;
      lowest = Math.min(lowest, each);
      highest = Math.max(highest, each);
    }
    low[index] = lowest + Math.max(LAKE_LOW_METRES, (highest - lowest) * LAKE_LOW_SHARE);
  }
  return low;
}

/**
 * Whether the road turns back on itself at route distance `at`: the drawn
 * road {@link TURNAROUND_REACH_METRES} before it and as far after it are
 * nearer each other than that — #3064. On a point-to-point route, a point
 * nearer an end than that is not judged, and does not turn back.
 */
function turnsBackAt(profile: RouteProfile, at: number): boolean {
  const before = at - TURNAROUND_REACH_METRES;
  const after = at + TURNAROUND_REACH_METRES;
  if (!profile.loop && (before < 0 || after > profile.totalDistance)) return false;
  const origin = corridorOrigin(profile);
  const from = drawnRoadPosition(profile, origin, before);
  const to = drawnRoadPosition(profile, origin, after);
  return Math.hypot(to.x - from.x, to.z - from.z) < TURNAROUND_REACH_METRES;
}

function findWaterways(profile: RouteProfile, seed: number): Waterways {
  const total = profile.totalDistance;
  const count = Math.max(2, Math.min(WATERWAY_SAMPLE_LIMIT, Math.round(total / 10)));
  const spacing = total / count;
  const samples = count + (profile.loop ? 0 : 1);
  const elevation = new Float64Array(samples);
  const grade = new Float64Array(samples);
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < samples; index += 1) {
    const at = Math.min(total, index * spacing);
    elevation[index] = elevationAt(profile, at);
    grade[index] = gradeAt(profile, at);
    lowest = Math.min(lowest, elevation[index] as number);
    highest = Math.max(highest, elevation[index] as number);
  }
  const at = (index: number): number | undefined => {
    if (profile.loop) {
      return elevation[((index % samples) + samples) % samples];
    }
    return index < 0 || index >= samples ? undefined : elevation[index];
  };
  const window = Math.max(1, Math.round(VALLEY_WINDOW_METRES / spacing));

  const crossings: Crossing[] = [];
  for (let index = 0; index < samples && crossings.length < MAXIMUM_WATERWAYS; index += 1) {
    const here = elevation[index] as number;
    let valley = true;
    let riseBefore = 0;
    let riseAfter = 0;
    for (let offset = 1; offset <= window && valley; offset += 1) {
      const before = at(index - offset);
      const after = at(index + offset);
      // Strictly lower on the near side of a plateau, level-or-lower on the
      // far: a flat floor is claimed once, by its first sample.
      if (before === undefined || after === undefined || before <= here || after < here) {
        valley = false;
        break;
      }
      riseBefore = Math.max(riseBefore, before - here);
      riseAfter = Math.max(riseAfter, after - here);
    }
    if (!valley || riseBefore < VALLEY_DEPTH_METRES || riseAfter < VALLEY_DEPTH_METRES) {
      continue;
    }
    // ⚠️ **The middle of a flat floor, not its first sample.** The profile's
    // despiking takes the point off a V, so the lowest few samples are often
    // level with each other; the stream runs down the middle of them.
    let end = index;
    while (end + 1 < samples + (profile.loop ? index : 0) && at(end + 1) === here) {
      end += 1;
    }
    const floor = ((index + end) / 2) * spacing;
    // #3064: a low point the road turns back at is not a valley it crosses.
    if (turnsBackAt(profile, floor)) continue;
    crossings.push({
      distance: distanceOnRoute(profile, floor),
      waterElevation: here - BRIDGE_CLEARANCE_METRES,
    });
  }

  const lakes: Lake[] = [];
  // #3065: on an open-world view, how low a stretch must be is read round
  // each sample (@see lowAround), and each lake is hashed on its ride
  // distance: the view's own range and distance move as road is added ahead
  // and dropped behind. A route reads its whole profile, as it always has.
  const anchor = sceneryAnchor(profile);
  const routeLow = lowest + Math.max(LAKE_LOW_METRES, (highest - lowest) * LAKE_LOW_SHARE);
  const low =
    anchor === undefined
      ? undefined
      : lowAround(elevation, Math.round(LAKE_ENCLOSURE_METRES / spacing));
  const shift = anchor?.origin ?? 0;
  const nearCrossing = (distance: number): boolean =>
    crossings.some(
      (crossing) =>
        Math.abs(routeOffset(profile, distance, crossing.distance)) <
        CHANNEL_BANK_METRES * 3 + LAKE_TAPER_METRES,
    );
  let runStart = -1;
  const finish = (endIndex: number): void => {
    if (runStart < 0) return;
    const from = runStart * spacing;
    const to = endIndex * spacing;
    const first = runStart;
    runStart = -1;
    let floor = Number.POSITIVE_INFINITY;
    for (let sample = first; sample <= endIndex; sample += 1) {
      floor = Math.min(floor, elevation[sample] as number);
    }
    // Enclosed on both sides: the road climbs out of the stretch either way.
    const reach = Math.round(LAKE_ENCLOSURE_METRES / spacing);
    let before = Number.NEGATIVE_INFINITY;
    let after = Number.NEGATIVE_INFINITY;
    for (let offset = 1; offset <= reach; offset += 1) {
      before = Math.max(before, at(first - offset) ?? Number.NEGATIVE_INFINITY);
      after = Math.max(after, at(endIndex + offset) ?? Number.NEGATIVE_INFINITY);
    }
    if (before - floor < VALLEY_DEPTH_METRES || after - floor < VALLEY_DEPTH_METRES) {
      return;
    }
    // One lake per LAKE_MAX_LENGTH_METRES of qualifying road.
    for (let start = from; to - start >= LAKE_MIN_LENGTH_METRES; start += LAKE_MAX_LENGTH_METRES) {
      if (lakes.length >= MAXIMUM_WATERWAYS) return;
      const end = Math.min(to, start + LAKE_MAX_LENGTH_METRES);
      if (end - start < LAKE_MIN_LENGTH_METRES) break;
      const hash = slotHash(seed, Math.round(start + shift), LAKE_KEY);
      if (uniformFrom(hash, 0) >= LAKE_CHANCE) continue;
      lakes.push({
        from: start,
        to: end,
        side: uniformFrom(hash, 1) < 0.5 ? 1 : -1,
        waterElevation: floor - LAKE_BELOW_ROAD_METRES,
      });
    }
  };
  for (let index = 0; index < samples; index += 1) {
    const qualifies =
      Math.abs(grade[index] as number) <= LAKE_MAX_GRADE_PERCENT &&
      (elevation[index] as number) <= (low?.[index] ?? routeLow) &&
      !nearCrossing(index * spacing);
    if (qualifies && runStart < 0) runStart = index;
    if (!qualifies) finish(index - 1);
  }
  finish(samples - 1);

  return { crossings, lakes };
}

/**
 * The ceiling a bed puts on the ground `outside` metres beyond its flat
 * bottom: the bed, rising to the road's own height over `bank` metres, and
 * then letting go over {@link BANK_RELEASE} more banks.
 *
 * ⚠️ **Relative to the road, and continuous**, and both were learned the hard
 * way. A bank that rose a fixed 60 m over 22 m was a cliff the ground's rows
 * could not sample — a tree on it stood a metre off the triangles under it —
 * and a ceiling that stopped applying at some distance put a step in the ground
 * wherever a hill beside the stream was taller than the road. So it climbs from
 * the bed to the road over the bank, gently, and then smoothly past anything
 * the relief can reach.
 */
function bankCeiling(bed: number, road: number, outside: number, bank: number): number {
  return (
    bed +
    (road - bed) * smoothstep(0, bank, outside) +
    CEILING_RELEASE_METRES * smoothstep(bank, bank * (1 + BANK_RELEASE), outside)
  );
}

function lerp(from: number, to: number, share: number): number {
  return from + (to - from) * share;
}

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}
