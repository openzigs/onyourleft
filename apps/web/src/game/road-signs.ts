// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Road signs placed from the route itself — #3279: a steep-climb sign at the
 * foot of a climb, a steep-descent sign at the top of one, chevrons on the
 * outside of a tight bend and a summit board at the top of a long climb.
 *
 * ## From the route alone, and read through the HUD's own function
 *
 * No map data and no place data (ADR 0009): every sign is a function of the
 * route, its origin and its seed, so lap two's are lap one's and the next
 * ride's are this one's. The slopes are `hud/climb-ahead.ts` §`slopesOf` over
 * the ride's own profile, the function the HUD's climb caption and the
 * announcer read, and the number a sign wears is §`wholePercent` of the
 * slope's grade — the same whole percent the HUD says for the same stretch.
 * A second reading of "how steep" here could disagree with the caption a
 * rider is looking at the same moment. The bends are `billboards.ts`
 * §`turnAt`, the DRAWN road's turn, which is what a rider sees bend.
 *
 * ## Thresholds, so a flat route has none and a mountain is not a forest
 *
 * - {@link SIGNED_GRADE_PERCENT} and {@link SIGNED_SLOPE_METRES}: a climb or a
 *   descent is signed when the HUD would say at least 6 % and it runs at
 *   least 200 m. `slopesOf` already calls 3 % over 100 m a slope; a sign is
 *   for the hills a rider must prepare for, so the bar is twice that.
 * - {@link SUMMIT_GAIN_METRES}: a summit board stands at the top of a climb
 *   (of any steepness `slopesOf` counts) that gains at least 40 m and is the
 *   highest road for {@link SUMMIT_CLEAR_METRES} after it, so a flat
 *   shoulder half way up is not called a top.
 * - `scatter.ts` §`TIGHT_BEND_RADIANS_PER_METRE`: chevrons where the drawn
 *   road turns tighter than a 50 m radius, the same bar `billboards.ts`
 *   keeps its boards off as "a bend tight enough that a real road would be
 *   posted".
 * - {@link SIGN_SPACING_METRES}: no two signs nearer than 40 m along the road,
 *   chevrons of one bend apart. Where two would be, the one that matters most
 *   to a rider stays, in {@link SIGN_PRIORITY}'s order: a bend, a descent, a
 *   climb, a summit.
 *
 * ## Where a sign stands
 *
 * On the verge, {@link SIGN_LATERAL_METRES} from the centreline, its plate
 * square to the road and facing the rider who rides at it. Climb, descent and
 * summit on the rider's right, the side the racing line keeps
 * (`racing-line.ts` §`ROAD_SIDE`); chevrons on a bend's OUTSIDE, pointing
 * the way the road turns.
 *
 * ⚠️ **Never on the road, a pavement, a side-road mouth or a driveway**, each
 * by the rule that already keeps a structure off it: the whole plate
 * ({@link SIGN_FOOTPRINT}) `landform.ts` §`ROAD_CLEARANCE_METRES` off every
 * stretch of the route (`settlements.ts` §`footprintClearance`, the hairpin
 * rule), and out of the water, here; and in {@link signsClearOf}, off this
 * frame's side roads (`cross-streets.ts` §`boardsClearOfSideRoads`), its
 * mapped driveways and aprons (`mapped-buildings.ts` §`onDriveway`) and its
 * village pavements (`people.ts` §`onPavement`). A sign that would stand on
 * one is not built: a sign is never moved somewhere it does not belong.
 *
 * ## The kit
 *
 * Every sign is a post and one plate, in one of four shapes
 * (`road-sign-atlas.ts` §`PlateShape`), wearing one cell of one atlas (`tools/realistic/
 * draw-sign-atlas.ts` draws it to `road-sign-atlas.ts`' layout), and a percent
 * from the atlas's own numerals. `three-renderer.ts` §`RoadSignBelt` draws
 * every sign in view in one instanced call. The diamond and the round plate
 * are drawn blank: the kit #3008's mapped signs will reuse.
 *
 * Pure, and names no rendering library.
 */

import { distanceOnRoute, type RouteProfile } from '@onyourleft/domain';

import { turnAt } from './billboards';
import {
  boardsClearOfSideRoads,
  SIDE_ROAD_STRUCTURE_MARGIN_METRES,
  type SideRoad,
  type SideRoadClearance,
} from './cross-streets';
import { slopesOf, wholePercent } from './hud/climb-ahead';
import type { SignFace } from './road-sign-atlas';
import { NO_LAND_CLASS, type LandClassMask } from './land-class';
import { ROAD_CLEARANCE_METRES, terrainHeightAt } from './landform';
import { onDriveway, type MappedBuildings } from './mapped-buildings';
import { onPavement, pavementBands } from './people';
import { TIGHT_BEND_RADIANS_PER_METRE } from './scatter';
import { footprintClearance, type Footprint } from './settlements';
import type { VillageStreet } from './streets';
import { drawnRoadFrame, type CorridorOrigin } from './terrain';
import { inWater, waterways } from './waterways';

/* ============================================================================
 * The thresholds
 * ========================================================================== */

/** The least whole percent, as the HUD says it, a signed climb or descent has: **6**. */
export const SIGNED_GRADE_PERCENT = 6;

/** The shortest signed climb or descent: **200 m**. */
export const SIGNED_SLOPE_METRES = 200;

/** The least height a climb gains to have a summit board at its top: **40 m**. */
export const SUMMIT_GAIN_METRES = 40;

/** How far past a summit no road may stand higher than it: **300 m**. */
export const SUMMIT_CLEAR_METRES = 300;

/** The tightest the drawn road may turn unsigned, radians a metre: a 50 m radius. */
export const BEND_SIGN_RADIANS_PER_METRE = TIGHT_BEND_RADIANS_PER_METRE;

/** How far apart the drawn road's turn is read when looking for a bend: **5 m**. */
export const BEND_STEP_METRES = 5;

/** How far apart a bend's chevrons stand along its outside: **10 m**. */
export const CHEVRON_SPACING_METRES = 10;

/** The most chevrons one bend carries: **5**, its tightest point and two either side. */
export const CHEVRONS_PER_BEND = 5;

/** The least distance along the road between two signs, chevrons of one bend apart: **40 m**. */
export const SIGN_SPACING_METRES = 40;

/** Which sign stays where two would stand nearer than {@link SIGN_SPACING_METRES}: first first. */
export const SIGN_PRIORITY: readonly RoadSignKind[] = ['chevron', 'descent', 'climb', 'summit'];

/* ============================================================================
 * The kit's dimensions
 * ========================================================================== */

/**
 * How far from the centreline a sign's post stands: **5 m**, on the verge —
 * its plate's near edge 4.4 m out, clear of `landform.ts`
 * §`ROAD_CLEARANCE_METRES`' 4.1, and inside a field's wall or hedge line.
 */
export const SIGN_LATERAL_METRES = 5;

/**
 * The side of the square every plate is drawn in: **1.2 m**, the largest
 * warning triangle a fast road carries. Large on purpose: a rider reads it
 * on a tablet's 800 rows from the chase camera, where a 0.9 m plate's
 * numerals were a few pixels high at 40 m (the screenshots of #3279's pull
 * request).
 */
export const SIGN_PLATE_METRES = 1.2;

/** How high a plate's middle stands above the ground: **2.2 m**, its bottom edge 1.6 m up, over a hedge. */
export const SIGN_PLATE_HEIGHT_METRES = 2.2;

/** The post's side, square: **6 cm**. */
export const SIGN_POST_METRES = 0.06;

/** How far into the ground the post is set: **0.3 m**, so it never floats over a dip. */
export const SIGN_POST_FOOTING_METRES = 0.3;

/**
 * A sign seen from above, in its own frame (its `z` the way it faces): the
 * whole plate's width across and the post's depth. What the footprint rules
 * hold off the road, the side roads, the driveways and the pavements.
 */
export const SIGN_FOOTPRINT: Footprint = {
  x: SIGN_PLATE_METRES / 2,
  back: -SIGN_POST_METRES,
  front: SIGN_POST_METRES,
};

/* ============================================================================
 * What a sign is
 * ========================================================================== */

/** What a sign is for. */
export type RoadSignKind = 'climb' | 'descent' | 'chevron' | 'summit';

/** A sign, placed in the corridor's frame. */
export interface RoadSign {
  readonly kind: RoadSignKind;
  readonly face: SignFace;
  /** Local metres; `y` is the ground at the post's foot. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Yaw, radians: the plate's face points `(sin, cos)` of it. */
  readonly rotation: number;
  /** The odometer it stands at, unwrapped. */
  readonly along: number;
  /** Which side of the road: `+1` the rider's right, `−1` the left. */
  readonly side: 1 | -1;
  /** The whole percent a climb or descent sign reads; none on the others. */
  readonly percent?: number;
}

/* ============================================================================
 * Where the signs are on a route
 * ========================================================================== */

/** A sign on the route, before it is placed: its route distance, wrapped, and its side. */
export interface RouteSign {
  readonly kind: RoadSignKind;
  readonly face: SignFace;
  /** Route distance, in `[0, total)` on a loop and `[0, total]` on a point-to-point route. */
  readonly distance: number;
  readonly side: 1 | -1;
  readonly percent?: number;
  /** Which bend a chevron is of; every other sign is its own group. */
  readonly group: number;
}

/** The despiked elevation at a route distance, off the profile's own grid. */
function elevationOn(profile: RouteProfile, distance: number): number {
  const resolution = profile.resolution as number;
  const heights = profile.elevations as readonly number[];
  const last = heights.length - 1;
  const at = distanceOnRoute(profile, distance) / resolution;
  const low = Math.max(0, Math.min(last, Math.floor(at)));
  const high = Math.min(last, low + 1);
  const share = at - low;
  return (heights[low] as number) * (1 - share) + (heights[high] as number) * share;
}

/** The climbs', descents' and summits' signs, from the HUD's own slopes. */
function slopeSigns(profile: RouteProfile, firstGroup: number): RouteSign[] {
  const total = profile.totalDistance as number;
  const found: RouteSign[] = [];
  let group = firstGroup;
  for (const slope of slopesOf(profile)) {
    const percent = wholePercent(slope.grade);
    const top = slope.start + slope.length;
    if (percent >= SIGNED_GRADE_PERCENT && slope.length >= SIGNED_SLOPE_METRES) {
      // A climb's sign at its foot, a descent's at its top: where it starts.
      found.push({
        kind: slope.kind,
        face: slope.kind,
        distance: distanceOnRoute(profile, slope.start),
        side: 1,
        percent,
        group: group++,
      });
    }
    if (slope.kind !== 'climb') continue;
    if (!profile.loop && top > total - SIGN_SPACING_METRES) continue;
    const summit = elevationOn(profile, top);
    if (summit - elevationOn(profile, slope.start) < SUMMIT_GAIN_METRES) continue;
    let highest = true;
    for (let past = BEND_STEP_METRES; past <= SUMMIT_CLEAR_METRES; past += BEND_STEP_METRES) {
      if (!profile.loop && top + past > total) break;
      if (elevationOn(profile, top + past) > summit + 0.5) {
        highest = false;
        break;
      }
    }
    if (!highest) continue;
    found.push({
      kind: 'summit',
      face: 'summit',
      distance: distanceOnRoute(profile, top),
      side: 1,
      group: group++,
    });
  }
  return found;
}

/** The tight bends' chevrons, on each one's outside, pointing the way it turns. */
function bendSigns(profile: RouteProfile, origin: CorridorOrigin, firstGroup: number): RouteSign[] {
  const total = profile.totalDistance as number;
  const end = profile.loop ? total - BEND_STEP_METRES / 2 : total;
  const turns: { readonly at: number; readonly turn: number }[] = [];
  for (let at = 0; at <= end; at += BEND_STEP_METRES) {
    turns.push({ at, turn: turnAt(profile, origin, at) ?? 0 });
  }
  const tight = (index: number): boolean =>
    Math.abs((turns[index] as { turn: number }).turn) >= BEND_SIGN_RADIANS_PER_METRE;
  const found: RouteSign[] = [];
  let group = firstGroup;
  // On a loop a bend may run across the line: start the walk where the road is not tight.
  let start = 0;
  if (profile.loop) {
    while (start < turns.length && tight(start)) start += 1;
    if (start === turns.length) return [];
  }
  const count = turns.length;
  for (let step = 0; step < count; step += 1) {
    const index = (start + step) % count;
    if (!tight(index)) continue;
    // Walk the whole bend: every tight sample, turning the same way.
    const direction = Math.sign((turns[index] as { turn: number }).turn);
    let peak = index;
    let length = 0;
    while (
      length < count &&
      tight((start + step + length) % count) &&
      Math.sign((turns[(start + step + length) % count] as { turn: number }).turn) === direction
    ) {
      const here = (start + step + length) % count;
      if (
        Math.abs((turns[here] as { turn: number }).turn) >
        Math.abs((turns[peak] as { turn: number }).turn)
      ) {
        peak = here;
      }
      length += 1;
    }
    const from = (turns[index] as { at: number }).at;
    const to = from + (length - 1) * BEND_STEP_METRES;
    const peakAt = (turns[peak] as { at: number }).at;
    const peakAlong = peakAt < from ? peakAt + total : peakAt;
    // A turn toward the normal (positive) is to the rider's right: its outside is the left.
    const side: 1 | -1 = direction > 0 ? -1 : 1;
    const face: SignFace = direction > 0 ? 'chevron-right' : 'chevron-left';
    const half = Math.floor(CHEVRONS_PER_BEND / 2);
    for (let k = -half; k <= half; k += 1) {
      const along = peakAlong + k * CHEVRON_SPACING_METRES;
      if (k !== 0 && (along < from || along > to)) continue;
      found.push({
        kind: 'chevron',
        face,
        distance: distanceOnRoute(profile, along),
        side,
        group,
      });
    }
    group += 1;
    step += length - 1;
  }
  return found;
}

/** How far apart two route distances are along the road: round the line on a loop. */
function apart(profile: RouteProfile, one: number, other: number): number {
  const gap = Math.abs(one - other);
  return profile.loop ? Math.min(gap, (profile.totalDistance as number) - gap) : gap;
}

/** The signs kept, by {@link SIGN_PRIORITY}, none nearer another group's than {@link SIGN_SPACING_METRES}. */
function spaced(profile: RouteProfile, candidates: readonly RouteSign[]): RouteSign[] {
  const groups = new Map<number, RouteSign[]>();
  for (const sign of candidates) {
    const members = groups.get(sign.group);
    if (members === undefined) groups.set(sign.group, [sign]);
    else members.push(sign);
  }
  const ordered = [...groups.values()].sort((one, other) => {
    const a = one[0] as RouteSign;
    const b = other[0] as RouteSign;
    return SIGN_PRIORITY.indexOf(a.kind) - SIGN_PRIORITY.indexOf(b.kind) || a.distance - b.distance;
  });
  const kept: RouteSign[] = [];
  for (const members of ordered) {
    const clear = members.every((sign) =>
      kept.every((held) => apart(profile, held.distance, sign.distance) >= SIGN_SPACING_METRES),
    );
    if (clear) kept.push(...members);
  }
  return kept.sort((one, other) => one.distance - other.distance);
}

/**
 * Every sign a route carries, by route distance, before any is placed — the
 * thresholds and the spacing applied, nothing else. Pure; the same route,
 * the same signs.
 */
export function routeSigns(profile: RouteProfile, origin: CorridorOrigin): readonly RouteSign[] {
  const slopes = slopeSigns(profile, 0);
  return spaced(profile, [...slopes, ...bendSigns(profile, origin, slopes.length)]);
}

/* ============================================================================
 * Placed in the corridor, and kept off the road and the water
 * ========================================================================== */

/** A route sign stood on the verge, or none where the road or the water leaves no room. */
function placed(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  land: LandClassMask,
  sign: RouteSign,
): Omit<RoadSign, 'along'> | undefined {
  const frame = drawnRoadFrame(profile, origin, sign.distance);
  if (frame === undefined) return undefined;
  const lateral = SIGN_LATERAL_METRES * sign.side;
  // Facing back along the road, toward a rider riding at it: the road runs
  // `(normalZ, −normalX)`.
  const rotation = Math.atan2(-frame.normalZ, frame.normalX);
  const at = {
    x: frame.x + frame.normalX * lateral,
    z: frame.z + frame.normalZ * lateral,
    rotation,
  };
  if (footprintClearance(profile, origin, at, SIGN_FOOTPRINT) < ROAD_CLEARANCE_METRES) {
    return undefined;
  }
  if (inWater(waterways(profile, seed, land), profile, sign.distance, lateral)) return undefined;
  return {
    kind: sign.kind,
    face: sign.face,
    ...at,
    y: terrainHeightAt(profile, origin, seed, sign.distance, lateral, NO_LAND_CLASS),
    side: sign.side,
    ...(sign.percent === undefined ? {} : { percent: sign.percent }),
  };
}

/** One route's placed signs, worked out once. */
interface Placed {
  readonly origin: CorridorOrigin;
  readonly seed: number;
  readonly land: LandClassMask;
  readonly signs: readonly { readonly distance: number; readonly sign: Omit<RoadSign, 'along'> }[];
}

const placedByProfile = new WeakMap<RouteProfile, Placed>();

function placedSigns(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  land: LandClassMask,
): Placed['signs'] {
  const known = placedByProfile.get(profile);
  if (
    known !== undefined &&
    known.seed === seed &&
    known.land === land &&
    known.origin.latitude === origin.latitude &&
    known.origin.longitude === origin.longitude &&
    known.origin.elevation === origin.elevation
  ) {
    return known.signs;
  }
  const signs = routeSigns(profile, origin).flatMap((sign) => {
    const stood = placed(profile, origin, seed, land, sign);
    return stood === undefined ? [] : [{ distance: sign.distance, sign: stood }];
  });
  placedByProfile.set(profile, { origin, seed, land, signs });
  return signs;
}

/**
 * Every sign beside the road between two odometer readings, in order along
 * it. Half-open, as `billboards.ts` §`billboardsAt` is; on a loop every lap's
 * copy in the span, each at its own odometer.
 */
export function roadSignsAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  fromMetres: number,
  toMetres: number,
  land: LandClassMask = NO_LAND_CLASS,
): readonly RoadSign[] {
  const signs = placedSigns(profile, origin, seed, land);
  if (signs.length === 0 || !(toMetres > fromMetres)) return [];
  const total = profile.totalDistance as number;
  const found: RoadSign[] = [];
  const firstLap = profile.loop ? Math.floor(fromMetres / total) : 0;
  const lastLap = profile.loop ? Math.floor(toMetres / total) : 0;
  for (let lap = firstLap; lap <= lastLap; lap += 1) {
    for (const { distance, sign } of signs) {
      const along = distance + lap * total;
      if (along >= fromMetres && along < toMetres) found.push({ ...sign, along });
    }
  }
  return found;
}

/** No signs: a frame with none in reach. */
export const NO_ROAD_SIGNS: readonly RoadSign[] = [];

/** The most signs one frame carries: **32**, the nearest the rider. @see nearestSigns */
export const SIGNS_PER_FRAME = 32;

/** The {@link SIGNS_PER_FRAME} signs nearest the rider, in order along the road. */
export function nearestSigns(signs: readonly RoadSign[], riderMetres: number): readonly RoadSign[] {
  if (signs.length <= SIGNS_PER_FRAME) return signs;
  return signs
    .slice()
    .sort((one, other) => Math.abs(one.along - riderMetres) - Math.abs(other.along - riderMetres))
    .slice(0, SIGNS_PER_FRAME)
    .sort((one, other) => one.along - other.along);
}

/**
 * Whether a sign stands on a village street's pavement: its post, or either
 * edge of its plate, inside one. @see people.ts §onPavement
 */
export function signOnPavement(sign: RoadSign, streets: readonly VillageStreet[]): boolean {
  if (streets.length === 0) return false;
  const bands = streets.map(pavementBands);
  // A yaw maps the sign's `x` to `(cos, −sin)`: the plate's width runs that way.
  const acrossX = Math.cos(sign.rotation) * SIGN_FOOTPRINT.x;
  const acrossZ = -Math.sin(sign.rotation) * SIGN_FOOTPRINT.x;
  return [0, -1, 1].some((edge) =>
    onPavement(bands, sign.x + edge * acrossX, sign.z + edge * acrossZ),
  );
}

/**
 * `signs`, less every one that stands on a side road in view, on a mapped
 * building's driveway or apron, or on a village street's pavement — the
 * frame's half of the module's "never on" rule, by each surface's own
 * existing rule. The same array where nothing is in the way.
 */
export function signsClearOf(
  signs: readonly RoadSign[],
  sideRoads: readonly SideRoad[],
  clearance: SideRoadClearance,
  streets: readonly VillageStreet[],
  buildings: MappedBuildings | undefined,
): readonly RoadSign[] {
  if (signs.length === 0) return signs;
  const offRoads = boardsClearOfSideRoads(signs, sideRoads, SIGN_FOOTPRINT, clearance);
  const kept = offRoads.filter(
    (sign) =>
      !signOnPavement(sign, streets) &&
      (buildings === undefined ||
        buildings.plans.length === 0 ||
        !onDriveway(buildings, sign, SIGN_FOOTPRINT, SIDE_ROAD_STRUCTURE_MARGIN_METRES)),
  );
  return kept.length === signs.length ? signs : kept;
}
