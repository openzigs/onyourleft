// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which mapped houses a Delivery round's parcels go to — #1808, resting on the
 * owner's rulings DL6 and DL11 of 2026-10-27 (epic #1803), recorded as
 * ADR 0059 D-3 and D-4.
 *
 * @unwired Nothing runs a Delivery round yet. #1816 gives this module its
 * production caller when it runs a round inside a game ride, picking the
 * round's targets at its start; until then only its tests reach it.
 *
 * ## Only houses the town already draws
 *
 * A target is a mapped house's front step (`footprint-buildings.ts`
 * §`FrontStep`): the foot of its porch steps, or its doorstep. A plan with
 * none (a shop, a part, a building that is not a home) is never a target.
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
 * {@link TARGET_WINDOW_HALF_METRES}, {@link TARGET_GAP_METRES},
 * {@link TARGET_MOST_FROM_ROAD_METRES} and {@link TARGET_TAKE_SHARE}.
 *
 * No error message here formats a coordinate, a distance or a seed
 * (CLAUDE.md §6, ADR 0004 D): each names the field and the constraint.
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

import { MOST_HOUSES } from './round';

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

/** The farthest a house's front step stands from the drawn road's centreline to be a target: **25 m**. */
export const TARGET_MOST_FROM_ROAD_METRES = 25;

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

/** A plan whose front step or centroid is not finite cannot be placed. No value is formatted. */
function checkPlan(plan: FootprintPlan): void {
  if (!Number.isFinite(plan.centroid.x) || !Number.isFinite(plan.centroid.z)) {
    refuse('a mapped building’s centroid needs a finite x and z');
  }
  const step = plan.frontStep;
  if (step === undefined) return;
  if (
    !Number.isFinite(step.x) ||
    !Number.isFinite(step.y) ||
    !Number.isFinite(step.z) ||
    !Number.isFinite(step.yaw)
  ) {
    refuse('a mapped building’s front step needs a finite x, y, z and yaw');
  }
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
  for (const plan of buildings.plans) checkPlan(plan);

  const total = profile.totalDistance;
  /** The earliest a window may open: the start of the chunk after the rider's. */
  const firstOpen = (mappedChunk(riderDistance) + 1) * MAPPED_CHUNK_METRES;
  /** The latest a window may close: the route's end, or a lap on from the rider. */
  const lastClose = profile.loop ? riderDistance + total : total;
  const half = TARGET_WINDOW_HALF_METRES;

  const candidates: Candidate[] = [];
  buildings.plans.forEach((plan, index) => {
    const step = plan.frontStep;
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
  // Ties broken by index, so the same input orders the same way every time.
  candidates.sort((a, b) => a.distance - b.distance || a.index - b.index);

  const selection = new MappedSelection();
  /** The plans drawn at each sampled rider distance, kept for the one pick. */
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
  const drawnThroughout = (candidate: Candidate): boolean => {
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

  const targets = taken.map((candidate, position): DeliveryTarget => ({
    position,
    distance: candidate.distance,
    side: candidate.lateral >= 0 ? 1 : -1,
    fromRoad: candidate.fromRoad,
    kind: candidate.step.kind,
    x: candidate.step.x,
    y: candidate.step.y,
    z: candidate.step.z,
    yaw: candidate.step.yaw,
  }));
  return { targets, wanted: houses, complete: targets.length === houses };
}
