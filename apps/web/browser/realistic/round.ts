// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A real Delivery round on the owner's realistic page, sighted at each of its
 * houses — #2513.
 *
 * The owner, on the tablet's realistic world, 2026-11-12: "I still don't see
 * the houses I am supposed to deliver to", with the HUD reading "Next house
 * 0 ft on the right" beside an empty country road. #2453 had made the marker
 * big enough to see; this asks whether the house and its marker are DRAWN at
 * all, at every house of a round, through the product's own renderer.
 *
 * The page's `town=level` is the synthetic fixture level, never a shipped one
 * (ADR 0065 D-7.5: a frame of a real level is a Produced Work of its file).
 * The round is the product's own: `ride-round.ts` §`startDeliveryRide` picks
 * its houses from the town's planned buildings, `in-view.ts` places its
 * markers and `ride-round.ts` §`nextHouse` says what the HUD says. This module
 * holds what the page does with them that is not drawing: which samples to
 * hold, the ride as it stands at each, which plan a target is, and which side
 * of the drawn road a point is on. The page draws and reads back.
 *
 * ⚠️ **Where a refill happens.** The renderer re-selects its mapped buildings
 * once per 100 m chunk, on the first frame in it (`realistic-budget.ts`
 * §`MAPPED_CHUNK_METRES`), so a rider arriving in a chunk is selected for at
 * its start. Each sample is held at its chunk's start first and then where it
 * is, and the samples go in route order, so the page selects as a ride would.
 *
 * Nothing here formats a position into a string (CLAUDE.md §6).
 */

import type { RouteProfile } from '@onyourleft/domain';

import type { MappedBuildings } from '../../src/game/mapped-buildings';
import { MAPPED_CHUNK_METRES } from '../../src/game/realistic-budget';
import { nearestOnDrawnRoad } from '../../src/game/road-grid';
import type { CorridorOrigin } from '../../src/game/terrain';
import type { DeliveryRide } from '../../src/game/delivery/ride-round';
import type { DeliveryTarget } from '../../src/game/delivery/targets';

/** One place the page holds the rider: so far before one house of the round. */
export interface RoundSample {
  /** The house's round position. */
  readonly position: number;
  /** How far before the house the rider is held, metres along the road. */
  readonly lead: number;
  /** The rider's odometer there. */
  readonly along: number;
  /** The start of the refill chunk `along` is in, where the page draws first. */
  readonly chunkStart: number;
}

/** What the page read back at one {@link RoundSample}. */
export interface RoundSighting extends RoundSample {
  /** The side the HUD names, and how far it says the house's throw point is (#2513): `nextHouse`'s. */
  readonly hud: { readonly side: 'left' | 'right'; readonly metres: number } | undefined;
  /** The house's plan, by its front step; `-1` when no plan has it. */
  readonly plan: number;
  /** Whether the frame drew that plan: selected at its refill, and not hidden. */
  readonly houseDrawn: boolean;
  /** The side of the drawn road the house's middle stands on. */
  readonly houseSide: 'left' | 'right' | undefined;
  /** How far the nearest marker the frame drew stands from the house's front step, metres. */
  readonly markerFromStep: number | undefined;
  /** The side of the drawn road that marker stands on. */
  readonly markerSide: 'left' | 'right' | undefined;
}

/** How far from the drawn road a house's middle may stand and still be given a side, metres. */
const SIDE_REACH_METRES = 80;

/**
 * Every house of the round at every lead, in route order: the order a ride
 * would reach them in, so the refills fall as a ride's do. A sample before the
 * route's start is left out.
 */
export function roundSamples(
  targets: readonly DeliveryTarget[],
  leads: readonly number[],
): readonly RoundSample[] {
  const samples: RoundSample[] = [];
  for (const target of targets) {
    for (const lead of leads) {
      const along = target.distance - lead;
      if (along < 0) continue;
      samples.push({
        position: target.position,
        lead,
        along,
        chunkStart: Math.floor(along / MAPPED_CHUNK_METRES) * MAPPED_CHUNK_METRES,
      });
    }
  }
  return samples.sort((a, b) => a.along - b.along || a.position - b.position);
}

/**
 * The round as it stands with the rider at `along` on the way to the house at
 * `position`: every house before it delivered, so it is the next one, and
 * nothing stepped. The HUD and the markers read this.
 */
export function rideHeldAt(ride: DeliveryRide, position: number, along: number): DeliveryRide {
  return {
    ...ride,
    along,
    round: {
      ...ride.round,
      houses: ride.round.houses.map((house, index) => (index < position ? 'delivered' : house)),
    },
  };
}

/** The plan whose front step a target is, or `-1`. A target names no house, so it is found by its step. */
export function planOfTarget(buildings: MappedBuildings, target: DeliveryTarget): number {
  return buildings.plans.findIndex(
    (plan) =>
      plan.frontStep !== undefined &&
      plan.frontStep.x === target.x &&
      plan.frontStep.z === target.z,
  );
}

/** Which side of the drawn road `(x, z)` stands on, as the rider rides it, or `undefined` beyond reach. */
export function sideOfRoad(
  profile: RouteProfile,
  origin: CorridorOrigin,
  x: number,
  z: number,
): 'left' | 'right' | undefined {
  const near = nearestOnDrawnRoad(profile, origin, x, z, SIDE_REACH_METRES);
  if (near === undefined) return undefined;
  return near.lateral >= 0 ? 'right' : 'left';
}
