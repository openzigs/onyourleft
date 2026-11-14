// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which mapped houses a Delivery round's parcels go to — #1808, resting on the
 * owner's rulings DL6 and DL11 of 2026-10-27 (epic #1803), recorded as
 * ADR 0059 D-3 and D-4.
 *
 * A game ride picks the round's targets at its start, through
 * `ride-round.ts` (#1816).
 *
 * ## Only houses the town already draws
 *
 * A target is a mapped house's front step (`footprint-buildings.ts`
 * §`FrontStep`): the foot of its porch steps, or its doorstep. A plan with
 * none (a shop, a part, a building that is not a home) is never a target.
 *
 * ⚠️ **Nor is a house drawn as a model** (`house-models.ts`, #1585). Its front
 * step is its extrusion's, and near the rider, with the models loaded, the
 * renderer draws the model instead (`mapped-buildings.ts`
 * §`selectMappedBuildings`, `three-renderer.ts`' `modelled` branch): the
 * extrusion's porch is not drawn, and the model records which face its door
 * is on but not where along it the door stands. The same plan is drawn as its
 * extrusion when far or with the models unloaded, so its door would move
 * during the window it is a target in. A modelled plan is passed over.
 * Nothing is fetched or decoded for Delivery: the pick reads the plans
 * `mapped-buildings.ts` §`mappedBuildingsOf` indexed at the press.
 *
 * ⚠️ **The drawn set changes at a refill**, so a house in the town is not a
 * house on screen. A house is picked only where `mapped-buildings.ts`
 * §`selectMappedBuildings` draws it at every rider position its throw window
 * spans: every whole metre of the window, and the start of every refill
 * chunk the window touches, where the renderer refills. A window opens no
 * earlier than the start of the chunk after the rider's, so every refill a
 * window depends on is one still ahead of the rider.
 *
 * ⚠️ **What this cannot see**: the renderer ranks the mapped buildings with
 * the frame's procedural structures and, where they loaded, the house models
 * (`three-renderer.ts` §`refillMappedBuildings`). The pick asks the
 * selection at {@link TargetPickInput.triangleBudget} with neither; that the
 * frame's own selection keeps the picked houses is #1816's, which runs the
 * round inside a ride.
 *
 * ⚠️ **When the renderer re-selects, for #1816**: once per refill chunk
 * (`realistic-budget.ts` §`MAPPED_CHUNK_METRES`, 100 m), on the first frame
 * after the rider passes the chunk's start, at wherever the rider is on that
 * frame, and its selection then stands until the next chunk. The pick
 * samples each chunk exactly at its start, and every whole metre between,
 * which asks about selections the renderer never makes: conservative, since
 * it may pass over a house that would stay drawn. It cannot see the other
 * way: a house at the edge of the budget may be selected at the chunk's start
 * and not at the frame's position just past it. #1816 proves the frame's.
 *
 * ## The seed is the ride's, and nothing keeps it (DL11, ADR 0059 D-4)
 *
 * The pick is deterministic in its seed, so a seed kept beside a stored route
 * would recompute every target. {@link drawRoundSeed} draws it from the
 * platform's cryptographic random source when the round starts, and
 * {@link pickRoundTargets} draws one when it is handed none. The seed is held
 * by nothing here, and a target names no house: it is a round position, a
 * route distance and a point, held in memory for the ride.
 *
 * ## Never a name (ADR 0055)
 *
 * No name or address is read to choose, order or describe a target. The
 * plans carry none, and a target is built field by field from the plan's
 * front step, never by copying the plan.
 *
 * ## The numbers are this project's own, proposed for the owner's approval
 *
 * {@link TARGET_WINDOW_HALF_METRES}, {@link TARGET_GAP_METRES} and
 * {@link TARGET_TAKE_SHARE}. {@link TARGET_MOST_FROM_ROAD_METRES} is not a
 * number of its own: it is the throw's reach (#1856).
 *
 * No error message here formats a coordinate, a distance or a seed
 * (CLAUDE.md §6, ADR 0004 D): each names the field and the constraint. A
 * malformed plan is not an error: it is passed over, and nothing is said.
 *
 * ## Mailboxes and houses that get no parcel, on a level (#2365, ADR 0065 D-10.3)
 *
 * A built-in level's round asks for a share of its houses to be **mailboxes**
 * and a share to be **houses that must not get a parcel**
 * ({@link TargetPickInput.shares}). Both are chosen when the round starts,
 * from the same in-memory seed as the houses and from a stream of it nothing
 * else reads, and stored nowhere (ADR 0059 D-4, D-4.2): the level file holds
 * the shares, never a house.
 *
 * - The no-delivery houses are taken from the houses picked, so the round's
 *   spacing holds for them too, and at most as many as leave
 *   `round.ts` §`FEWEST_DELIVERY_HOUSES` to deliver to
 *   ({@link noDeliveryCount}). They are not on the round: {@link TargetPick}
 *   hands them over apart, and the round's positions number the rest.
 * - A mailbox is a house on the round whose target is a box **at the kerb**
 *   in front of it, {@link MAILBOX_FROM_KERB_METRES} off the carriageway's
 *   edge on the line from the road to its front step, with a smaller catch
 *   (`throw.ts` §`MAILBOX_CATCH_RADIUS_METRES`). It is worth what a doorstep is.
 */

import type { RouteProfile } from '@onyourleft/domain';

import type { FootprintPlan, FrontStep } from '../footprint-buildings';
import {
  mappedChunk,
  MappedSelection,
  selectMappedBuildings,
  type MappedBuildings,
} from '../mapped-buildings';
import { MAPPED_BUILDING_TRIANGLES, MAPPED_CHUNK_METRES } from '../realistic-budget';
import { nearestOnDrawnRoad } from '../road-grid';
import { fmix32, mixInto, uniformFrom } from '../seeded';
import { drawnRoadPosition, type CorridorOrigin } from '../terrain';

import { FEWEST_DELIVERY_HOUSES, MOST_HOUSES } from './round';
import { CARRIAGEWAY_HALF_WIDTH_METRES, PARCEL_REACH_METRES } from './throw';

/**
 * How far before and after a house its throw window is reserved, metres:
 * **20**. #1809's throw window must lie inside it; at 30 km/h the 40 m
 * reserved is about five seconds.
 */
export const TARGET_WINDOW_HALF_METRES = 20;

/** The least road between one target's reserved window and the next one's: **10 m**. */
export const TARGET_GAP_METRES = 10;

/** The least route distance between two targets, so no two windows overlap: **50 m**. */
export const TARGET_SPACING_METRES = 2 * TARGET_WINDOW_HALF_METRES + TARGET_GAP_METRES;

/**
 * The farthest a house's front step stands from the drawn road's centreline
 * to be a target: **12 m**, the throw's own reach, `throw.ts`
 * §`PARCEL_REACH_METRES` — the throw speed times the flight, 10 m/s for 1.2 s
 * (#1856, under the owner's ruling of 2026-10-29 that only a house a parcel
 * can reach is picked).
 *
 * The derivation, term by term:
 *
 * - **Where the throw leaves from.** `throw.ts` flies a parcel from the
 *   road's centre line at the rider's simulated distance, and `in-view.ts`
 *   draws it from there; neither reads where the rider is drawn across the
 *   road (the racing line, room made for a pacer level with them, or
 *   #1820's lanes). So the reach is measured from the centre line, as
 *   `fromRoad` is, and the place the rider is drawn takes nothing off it.
 *   `targets.test.ts` holds that: a round ridden at the drawn extremes
 *   delivers as one ridden on the centre line. A change that throws from the
 *   drawn rider must take the outermost drawn offset off this.
 * - **The catch radius.** `throw.ts` §`TARGET_CATCH_RADIUS_METRES` is along
 *   the route, not across it: a parcel is caught at the instant it reaches
 *   the step's depth, so it takes nothing off the reach either.
 * - **Inside the window.** A parcel reaching the deepest step flies 1.2 s, so
 *   a rider throws `1.2 × speed` before the house, inside
 *   `THROW_WINDOW_BEFORE_METRES` (20 m) at any speed to 60 km/h.
 *
 * A pick returning only houses a parcel can be delivered to is
 * `targets.test.ts`' (#1856), riding a round through `ride-round.ts`.
 */
export const TARGET_MOST_FROM_ROAD_METRES = PARCEL_REACH_METRES;

/**
 * The share of the houses that fit that a round's first pass takes: **0.5**,
 * seeded, so a round is not simply the next houses along. Where that leaves
 * the round short, a second pass takes every house that still fits.
 */
export const TARGET_TAKE_SHARE = 0.5;

/** One house on the round, in memory for the ride only. Never a name, never a map identifier. */
export interface DeliveryTarget {
  /** Its round position, `0` to `n - 1`, in route order: `round.ts`' house index. */
  readonly position: number;
  /** The odometer distance at which the front step is nearest the drawn road, metres. */
  readonly distance: number;
  /** Which side of the road it stands: `1` the road's normal side, its right; `-1` its left. */
  readonly side: 1 | -1;
  /** How far the front step is from the drawn road's centreline, metres. */
  readonly fromRoad: number;
  readonly kind: FrontStep['kind'];
  /**
   * A mailbox at the kerb rather than the front step (#2365): its point,
   * `fromRoad` and the catch are the box's. Absent, the front step.
   */
  readonly mailbox?: boolean;
  /** The front step, local metres, and its yaw toward the road. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

/** What a pick found. */
export interface TargetPick {
  /** In route order, at most {@link wanted}. */
  readonly targets: readonly DeliveryTarget[];
  /** The round size asked for. */
  readonly wanted: number;
  /** Whether as many were found as were wanted. `false` with none: a town with no house to deliver to. */
  readonly complete: boolean;
  /**
   * The picked houses that must not get a parcel (#2365), in route order,
   * each `position` its place in this list. Never on the round: the round is
   * {@link targets}. None unless {@link TargetPickInput.shares} asked.
   */
  readonly noDelivery: readonly DeliveryTarget[];
}

/** A level round's shares (#2365, ADR 0065 D-4.1), each from nought to one. */
export interface TargetShares {
  /** The share of the round's houses whose target is a mailbox at the kerb. */
  readonly mailbox: number;
  /** The share of the houses picked that must not get a parcel. */
  readonly noDelivery: number;
}

/**
 * How far off the carriageway's edge a mailbox stands, metres — #2365:
 * **0.6**, a box on a post at the kerb in front of its house. This project's
 * own number, for the owner's approval in #2365's pull request.
 */
export const MAILBOX_FROM_KERB_METRES = 0.6;

/** Folded into the round's seed for the roles' own stream: a constant nothing else uses. */
const ROLE_STREAM = 0x6d61_696c;

/**
 * How many of `picked` houses must not get a parcel, at `share` — #2365: the
 * share of them rounded, and never so many that fewer than
 * `round.ts` §`FEWEST_DELIVERY_HOUSES` are left to deliver to.
 */
export function noDeliveryCount(picked: number, share: number): number {
  return Math.max(0, Math.min(Math.round(share * picked), picked - FEWEST_DELIVERY_HOUSES));
}

export interface TargetPickInput {
  /** The ride's planned mapped buildings, indexed at the press. */
  readonly buildings: MappedBuildings;
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  /** The rider's odometer reading when the round starts, metres. */
  readonly riderDistance: number;
  /** The round size: a whole number from 1 to `round.ts` §`MOST_HOUSES`. */
  readonly houses: number;
  /**
   * The triangles the selection is asked to fit, as the renderer's refill
   * asks it; {@link MAPPED_BUILDING_TRIANGLES} by default.
   */
  readonly triangleBudget?: number;
  /** A level round's mailboxes and no-delivery houses (#2365). Absent, none. */
  readonly shares?: TargetShares | undefined;
}

/**
 * The round's seed, from the platform's cryptographic random source — one
 * draw, when the round starts. Never stored, exported, synced or logged, and
 * never derived from anything that is (ADR 0059 D-4 item 3).
 */
export function drawRoundSeed(): number {
  const drawn = new Uint32Array(1);
  crypto.getRandomValues(drawn);
  return drawn[0] as number;
}

/** A house the round could take, before the drawn check. */
interface Candidate {
  readonly index: number;
  readonly distance: number;
  readonly step: FrontStep;
  readonly lateral: number;
  readonly fromRoad: number;
}

function refuse(constraint: string): never {
  throw new RangeError(`Delivery target pick: ${constraint}`);
}

/**
 * A plan's front step, where it could be a target: a step with a finite
 * point and yaw, on a plan with no model (the header). A malformed step is
 * passed over rather than refusing the round. (A plan with no finite
 * centroid needs no check here: the selection never draws it.)
 */
function stepOf(plan: FootprintPlan): FrontStep | undefined {
  const step = plan.frontStep;
  if (step === undefined || plan.model !== undefined) return undefined;
  const finite =
    Number.isFinite(step.x) &&
    Number.isFinite(step.y) &&
    Number.isFinite(step.z) &&
    Number.isFinite(step.yaw);
  return finite ? step : undefined;
}

/**
 * Every house a round from `riderDistance` could take before the drawn
 * check, in route order, ties broken by index so the same input orders the
 * same way every time: a front step in a parcel's reach of the drawn road,
 * whose window opens no earlier than the start of the chunk after the
 * rider's and closes by the route's end (or a lap on from the rider, on a
 * loop).
 */
function candidatesOf(
  buildings: MappedBuildings,
  profile: RouteProfile,
  origin: CorridorOrigin,
  riderDistance: number,
): Candidate[] {
  const total = profile.totalDistance;
  /** The earliest a window may open: the start of the chunk after the rider's. */
  const firstOpen = (mappedChunk(riderDistance) + 1) * MAPPED_CHUNK_METRES;
  /** The latest a window may close: the route's end, or a lap on from the rider. */
  const lastClose = profile.loop ? riderDistance + total : total;
  const half = TARGET_WINDOW_HALF_METRES;

  const candidates: Candidate[] = [];
  buildings.plans.forEach((plan, index) => {
    const step = stepOf(plan);
    if (step === undefined) return;
    const near = nearestOnDrawnRoad(profile, origin, step.x, step.z, TARGET_MOST_FROM_ROAD_METRES);
    if (near === undefined) return;
    const laps =
      profile.loop && total > 0
        ? Math.max(0, Math.ceil((firstOpen + half - near.along) / total))
        : 0;
    const distance = near.along + laps * total;
    if (distance - half < firstOpen || distance + half > lastClose) return;
    candidates.push({ index, distance, step, lateral: near.lateral, fromRoad: near.distance });
  });
  candidates.sort((a, b) => a.distance - b.distance || a.index - b.index);
  return candidates;
}

/**
 * Whether a candidate is drawn throughout its throw window: at the start of
 * every refill chunk the window touches, and at every whole metre of it (the
 * header). The selections are kept for the one pick, or the one count.
 */
function drawnThroughoutOf(
  buildings: MappedBuildings,
  profile: RouteProfile,
  origin: CorridorOrigin,
  triangleBudget: number,
): (candidate: Candidate) => boolean {
  const half = TARGET_WINDOW_HALF_METRES;
  const selection = new MappedSelection();
  /** The plans drawn at each sampled rider distance. */
  const drawnAt = new Map<number, ReadonlySet<number>>();
  const drawnSet = (at: number): ReadonlySet<number> => {
    const known = drawnAt.get(at);
    if (known !== undefined) return known;
    const here = drawnRoadPosition(profile, origin, at);
    selectMappedBuildings(buildings, here.x, here.z, triangleBudget, selection);
    const found = new Set(selection.plans.subarray(0, selection.count));
    drawnAt.set(at, found);
    return found;
  };
  return (candidate) => {
    const from = candidate.distance - half;
    const to = candidate.distance + half;
    for (let chunk = mappedChunk(from); chunk <= mappedChunk(to); chunk += 1) {
      if (!drawnSet(chunk * MAPPED_CHUNK_METRES).has(candidate.index)) return false;
    }
    for (let at = Math.ceil(from); at <= to; at += 1) {
      if (!drawnSet(at).has(candidate.index)) return false;
    }
    return true;
  };
}

/**
 * The most houses a round started on the start line can hold, capped at
 * `round.ts` §`MOST_HOUSES` — #2294's course picker, which says before the
 * rider chooses which of their routes can hold a round.
 *
 * The candidates and the drawn check are {@link pickRoundTargets}' own, at
 * the same triangle budget, and no seed: the houses are taken in route
 * order, each one drawn throughout its window and at least
 * {@link TARGET_SPACING_METRES} past the last one taken. Every window is the
 * same length, so taking the earliest house that fits is the most houses
 * any spacing of them allows (the interval-scheduling argument), and **no
 * pick is longer than this, whatever its seed**. "Fewer than a round needs"
 * is therefore certain; "this many" is a ceiling, because a seeded pick can
 * take a house that rules out two and find fewer, which the press still
 * decides (`ride-round.ts` §`startDeliveryRide`).
 *
 * It returns one number: no seed, target or position leaves it.
 * `triangleBudget` is the pick's {@link TargetPickInput.triangleBudget}, and
 * the press asks the pick at the default, as this does.
 */
export function countRoundHouses(
  buildings: MappedBuildings,
  profile: RouteProfile,
  origin: CorridorOrigin,
  triangleBudget: number = MAPPED_BUILDING_TRIANGLES,
): number {
  const candidates = candidatesOf(buildings, profile, origin, 0);
  const drawnThroughout = drawnThroughoutOf(buildings, profile, origin, triangleBudget);
  let count = 0;
  let last = -Infinity;
  for (const candidate of candidates) {
    if (count === MOST_HOUSES) break;
    if (candidate.distance - last < TARGET_SPACING_METRES || !drawnThroughout(candidate)) continue;
    count += 1;
    last = candidate.distance;
  }
  return count;
}

/**
 * Pick a round of `input.houses` targets ahead of the rider, in route order,
 * no two closer than {@link TARGET_SPACING_METRES}, from the houses drawn
 * throughout their throw windows. @see the header
 *
 * The same seed and input give the same pick. With no seed, one is drawn by
 * {@link drawRoundSeed}: the production path, a fresh seed for each round.
 * Fewer houses than wanted return every one that fits, with `complete` false.
 */
export function pickRoundTargets(
  input: TargetPickInput,
  seed: number = drawRoundSeed(),
): TargetPick {
  const { buildings, profile, origin, riderDistance, houses } = input;
  const triangleBudget = input.triangleBudget ?? MAPPED_BUILDING_TRIANGLES;
  if (!Number.isInteger(houses) || houses < 1 || houses > MOST_HOUSES) {
    refuse(`the round size is a whole number from 1 to ${String(MOST_HOUSES)}`);
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    refuse('the seed is a whole number from 0 to 2³² − 1');
  }
  if (!Number.isFinite(riderDistance) || riderDistance < 0) {
    refuse('the rider’s distance is a finite number of metres, not below zero');
  }
  if (!(triangleBudget >= 0)) refuse('the triangle budget is a number, not below zero');

  const candidates = candidatesOf(buildings, profile, origin, riderDistance);
  const drawnThroughout = drawnThroughoutOf(buildings, profile, origin, triangleBudget);

  const base = fmix32(seed);
  const taken: Candidate[] = [];
  const fits = (candidate: Candidate): boolean =>
    taken.every((other) => Math.abs(other.distance - candidate.distance) >= TARGET_SPACING_METRES);
  // First pass, in route order: a seeded share of the houses that fit.
  for (const candidate of candidates) {
    if (taken.length === houses) break;
    if (uniformFrom(mixInto(base, candidate.index), 0) >= TARGET_TAKE_SHARE) continue;
    if (!fits(candidate) || !drawnThroughout(candidate)) continue;
    taken.push(candidate);
  }
  // Second pass, where the first left the round short: every house that still fits.
  for (const candidate of candidates) {
    if (taken.length === houses) break;
    if (taken.includes(candidate) || !fits(candidate) || !drawnThroughout(candidate)) continue;
    taken.push(candidate);
  }
  taken.sort((a, b) => a.distance - b.distance || a.index - b.index);

  // #2365: which picked houses get no parcel, and which of the rest are
  // mailboxes, each by a seeded rank from a stream nothing else reads.
  const shares = input.shares;
  const roles = mixInto(base, ROLE_STREAM);
  const ranked = (stream: number, among: readonly Candidate[]): readonly Candidate[] =>
    [...among].sort(
      (a, b) =>
        uniformFrom(mixInto(roles, a.index), stream) -
          uniformFrom(mixInto(roles, b.index), stream) || a.index - b.index,
    );
  const skipped = new Set(
    shares === undefined
      ? []
      : ranked(0, taken).slice(0, noDeliveryCount(taken.length, shares.noDelivery)),
  );
  const delivered = taken.filter((candidate) => !skipped.has(candidate));
  const mailboxes = new Set(
    shares === undefined
      ? []
      : ranked(1, delivered).slice(0, Math.round(shares.mailbox * delivered.length)),
  );
  const targetOf = (candidate: Candidate, position: number): DeliveryTarget => {
    const target: DeliveryTarget = {
      position,
      distance: candidate.distance,
      side: candidate.lateral >= 0 ? 1 : -1,
      fromRoad: candidate.fromRoad,
      kind: candidate.step.kind,
      x: candidate.step.x,
      y: candidate.step.y,
      z: candidate.step.z,
      yaw: candidate.step.yaw,
    };
    return mailboxes.has(candidate) ? atTheKerb(target, profile, origin) : target;
  };
  const targets = delivered.map(targetOf);
  const noDelivery = taken.filter((candidate) => skipped.has(candidate)).map(targetOf);
  return { targets, wanted: houses, complete: taken.length === houses, noDelivery };
}

/**
 * `target`'s mailbox (#2365): on the line from the drawn road at its
 * distance to its front step, {@link MAILBOX_FROM_KERB_METRES} off the
 * carriageway's edge, at the step's height and yaw. A step nearer the road
 * than that is its own mailbox.
 */
function atTheKerb(
  target: DeliveryTarget,
  profile: RouteProfile,
  origin: CorridorOrigin,
): DeliveryTarget {
  const fromRoad = CARRIAGEWAY_HALF_WIDTH_METRES + MAILBOX_FROM_KERB_METRES;
  if (!(target.fromRoad > fromRoad)) return { ...target, mailbox: true };
  const road = drawnRoadPosition(profile, origin, target.distance);
  const share = fromRoad / target.fromRoad;
  return {
    ...target,
    mailbox: true,
    fromRoad,
    x: road.x + (target.x - road.x) * share,
    z: road.z + (target.z - road.z) * share,
  };
}
