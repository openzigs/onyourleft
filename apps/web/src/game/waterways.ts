// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Water, and the bridges that carry the road over it — #459.
 *
 * ## ⚠️ Where water goes, and where that comes from — ADR 0009 and #248
 *
 * **From the route's own elevation, and from nothing else.** No map, no
 * hydrography, no other product: a `RouteProfile` says only how high the road
 * is at each metre of it, and that is enough to say where water plausibly is.
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

import {
  distanceOnRoute,
  elevationAt,
  gradeAt,
  positionAt,
  type RouteProfile,
} from '@onyourleft/domain';

import { slotHash, uniformFrom } from './seeded';
import {
  ROAD_WIDTH_METRES,
  localGroundPosition,
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
}

/** A lake beside a stretch of the route. */
export interface Lake {
  /** Where on the route it starts and ends, wrapped; `from < to`. */
  readonly from: number;
  readonly to: number;
  /** Which side of the road, left positive — the frame `terrain.ts` builds in. */
  readonly side: 1 | -1;
  readonly waterElevation: number;
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
const computed = new WeakMap<RouteProfile, Waterways>();

/** Every stream and lake a route implies. Pure; cached per profile object. */
export function waterways(profile: RouteProfile, seed: number): Waterways {
  const known = computed.get(profile);
  if (known !== undefined) {
    return known;
  }
  const found = findWaterways(profile, seed);
  computed.set(profile, found);
  return found;
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
    const u = Math.abs(routeOffset(profile, wrapped, crossing.distance));
    if (
      u > CHANNEL_FLAT_METRES + (CHANNEL_BANK_METRES - CHANNEL_FLAT_METRES) * (1 + BANK_RELEASE) ||
      lateral > STREAM_REACH_METRES + CHANNEL_BANK_METRES
    ) {
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
    const bed = lake.waterElevation - LAKE_DEPTH_METRES - origin.elevation;
    ceiling = Math.min(ceiling, bankCeiling(bed, road, outside, LAKE_BANK_METRES));
    relief = Math.min(relief, smoothstep(LAKE_BANK_METRES, LAKE_BANK_METRES * 4, outside));
    wet(shoreWeight(outside), lake.waterElevation - origin.elevation);
  }
  return { ceiling, relief, level, shore };
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
    const u = Math.abs(routeOffset(profile, wrapped, crossing.distance));
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
    if (lateral >= near - LAKE_BANK_METRES && lateral <= far + LAKE_BANK_METRES) {
      return true;
    }
  }
  return false;
}

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
 */
export function waterSurface(
  profile: RouteProfile,
  origin: CorridorOrigin,
  corridor: RoadCorridor,
  ways: Waterways,
): WaterSurface {
  waterLease += 1;
  let vertexCount = 0;
  let indexCount = 0;
  const centre = corridor.centre;
  const first = centre[0] as CorridorPoint;
  const last = centre[centre.length - 1] as CorridorPoint;
  /** One station — shore, middle, shore — its three points written in place. */
  const station = (
    x: number,
    y: number,
    z: number,
    acrossX: number,
    acrossZ: number,
    near: number,
    far: number,
  ): void => {
    reserveWater(vertexCount + 3, indexCount);
    const { vertices, shore } = waterScratch;
    const middle = (near + far) / 2;
    for (let point = 0; point < 3; point += 1) {
      const across = point === 0 ? near : point === 1 ? middle : far;
      vertices[vertexCount * 3] = x + acrossX * across;
      vertices[vertexCount * 3 + 1] = y;
      vertices[vertexCount * 3 + 2] = z + acrossZ * across;
      shore[vertexCount] = point === 1 ? 1 : 0;
      vertexCount += 1;
    }
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
    if (occurrences(profile, crossing.distance, first.along, last.along).length > 0) {
      const here = localGroundPosition(origin, positionAt(profile, crossing.distance));
      const ahead = localGroundPosition(
        origin,
        positionAt(profile, distanceOnRoute(profile, crossing.distance + 5)),
      );
      const behind = localGroundPosition(
        origin,
        positionAt(profile, distanceOnRoute(profile, crossing.distance - 5)),
      );
      const dx = ahead.x - behind.x;
      const dz = ahead.z - behind.z;
      const length = Math.hypot(dx, dz);
      if (!(length > 0)) continue;
      const tx = dx / length;
      const tz = dz / length;
      const y = crossing.waterElevation - origin.elevation;
      const base = vertexCount;
      for (const lateral of STREAM_LATERALS) {
        // The left normal is (−tz, tx): `terrain.ts`'s convention. Across the
        // stream is along the road.
        station(
          here.x - tz * lateral,
          y,
          here.z + tx * lateral,
          tx,
          tz,
          -STREAM_SURFACE_HALF_WIDTH_METRES,
          STREAM_SURFACE_HALF_WIDTH_METRES,
        );
      }
      strip(base);
    }
  }

  if (ways.lakes.length > 0) {
    const normals = ribbonNormals(centre);
    for (const lake of ways.lakes) {
      let base = vertexCount;
      const y = lake.waterElevation - origin.elevation;
      for (let row = 0; row < centre.length; row += 1) {
        const point = centre[row] as CorridorPoint;
        const shoreAt = lakeShore(lake, profile, point.distance);
        if (shoreAt === undefined) {
          strip(base);
          base = vertexCount;
          continue;
        }
        // Two metres past each shore, under the bank, so the water meets the
        // ground rather than stopping short of it; the bank hides the rest.
        station(
          point.x,
          y,
          point.z,
          (normals[row * 2] as number) * lake.side,
          (normals[row * 2 + 1] as number) * lake.side,
          shoreAt.near - 2,
          shoreAt.far + 2,
        );
      }
      strip(base);
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
}

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
  const roadAt = (distance: number): { x: number; y: number; z: number } => {
    const wrapped = distanceOnRoute(profile, distance);
    const ground = localGroundPosition(origin, positionAt(profile, wrapped));
    return { x: ground.x, y: elevationAt(profile, wrapped) - origin.elevation, z: ground.z };
  };
  for (const crossing of ways.crossings) {
    // Once, for the reason `waterSurface` gives: every lap's bridge is the
    // same bridge, and `roadAt` wraps an odometer onto it.
    for (const centre of occurrences(profile, crossing.distance, first.along, last.along).slice(
      0,
      1,
    )) {
      const pieces = Math.ceil((BRIDGE_HALF_SPAN_METRES * 2) / BRIDGE_PIECE_METRES);
      const step = (BRIDGE_HALF_SPAN_METRES * 2) / pieces;
      for (let piece = 0; piece < pieces; piece += 1) {
        const from = roadAt(centre - BRIDGE_HALF_SPAN_METRES + piece * step);
        const to = roadAt(centre - BRIDGE_HALF_SPAN_METRES + (piece + 1) * step);
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dz = to.z - from.z;
        const length = Math.hypot(dx, dy, dz);
        if (!(length > 0)) continue;
        const flat = Math.hypot(dx, dz);
        const ax = dx / length;
        const ay = dy / length;
        const az = dz / length;
        // Left normal in plan: `terrain.ts`'s convention.
        const nx = -dz / flat;
        const nz = dx / flat;
        const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, z: (from.z + to.z) / 2 };
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
        // So a piece sinks by however far its chord stands over the road at
        // its own middle.
        const sink = Math.max(
          0,
          mid.y - roadAt(centre - BRIDGE_HALF_SPAN_METRES + (piece + 0.5) * step).y,
        );
        parts.push({
          x: mid.x,
          y: mid.y - sink - DECK_DEPTH_METRES / 2 - 0.03,
          z: mid.z,
          axisX: ax,
          axisY: ay,
          axisZ: az,
          length,
          width: ROAD_WIDTH_METRES + PARAPET_THICKNESS_METRES * 2,
          height: DECK_DEPTH_METRES,
        });
      }
      const bed = crossing.waterElevation - STREAM_DEPTH_METRES - origin.elevation;
      for (const end of [-1, 1]) {
        const at = roadAt(centre + end * BRIDGE_HALF_SPAN_METRES);
        const before = roadAt(centre + end * BRIDGE_HALF_SPAN_METRES - 1);
        const after = roadAt(centre + end * BRIDGE_HALF_SPAN_METRES + 1);
        const dx = after.x - before.x;
        const dy = after.y - before.y;
        const dz = after.z - before.z;
        const run = Math.hypot(dx, dy, dz);
        if (!(Math.hypot(dx, dz) > 0)) continue;
        const top = at.y - 0.03;
        const bottom = bed - 1;
        // ⚠️ **Along the road's own slope, not level** — #501. This box was
        // level until then, three metres long under a road sloping down into
        // the valley, so its top stood above the road over the downhill half
        // of it: 4.5 cm on a 5 % approach, 9 cm on the soak route's 8 %. A lit
        // stone face through tarmac is the *"light seam across the road where
        // the bridge deck starts"* validation 0002 Z10 found on the tablet.
        // `waterways.test.ts` §"the road is continuous across the bridge".
        parts.push({
          x: at.x,
          y: (top + bottom) / 2,
          z: at.z,
          axisX: dx / run,
          axisY: dy / run,
          axisZ: dz / run,
          length: 3,
          width: ROAD_WIDTH_METRES + PARAPET_THICKNESS_METRES * 4,
          height: top - bottom,
        });
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
          const near = roadAt(
            centre + end * (BRIDGE_HALF_SPAN_METRES + (piece * approach) / steps),
          );
          const far = roadAt(
            centre + end * (BRIDGE_HALF_SPAN_METRES + ((piece + 1) * approach) / steps),
          );
          const ex = far.x - near.x;
          const ey = far.y - near.y;
          const ez = far.z - near.z;
          const length = Math.hypot(ex, ey, ez);
          if (!(length > 0)) continue;
          // Sunk under the road at its middle, as the deck's pieces are.
          const middle = Math.min(
            (near.y + far.y) / 2,
            roadAt(centre + end * (BRIDGE_HALF_SPAN_METRES + ((piece + 0.5) * approach) / steps)).y,
          );
          const height = middle - 0.03 - bottom;
          parts.push({
            x: (near.x + far.x) / 2,
            y: middle - 0.03 - height / 2,
            z: (near.z + far.z) / 2,
            axisX: ex / length,
            axisY: ey / length,
            axisZ: ez / length,
            length,
            width: ROAD_WIDTH_METRES + PARAPET_THICKNESS_METRES * 4,
            height,
          });
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
 * Where on the route a point is from `target`, both wrapped: signed, the short
 * way round on a loop.
 */
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
): readonly number[] {
  const margin = CHANNEL_BANK_METRES;
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
  const taper = Math.min(
    smoothstep(0, LAKE_TAPER_METRES, start),
    smoothstep(0, LAKE_TAPER_METRES, length - start),
  );
  const middle = (LAKE_NEAR_METRES + LAKE_FAR_METRES) / 2;
  const half = ((LAKE_FAR_METRES - LAKE_NEAR_METRES) / 2) * taper;
  if (!(half > 1)) {
    return undefined;
  }
  return { near: middle - half, far: middle + half };
}

/** The search itself. @see waterways */
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
    crossings.push({
      distance: distanceOnRoute(profile, ((index + end) / 2) * spacing),
      waterElevation: here - BRIDGE_CLEARANCE_METRES,
    });
  }

  const lakes: Lake[] = [];
  const low = lowest + Math.max(LAKE_LOW_METRES, (highest - lowest) * LAKE_LOW_SHARE);
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
      const hash = slotHash(seed, Math.round(start), LAKE_KEY);
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
      (elevation[index] as number) <= low &&
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

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}
