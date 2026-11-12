// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2513's round on the owner's page: the samples it holds, the ride as it
 * stands at each, the plan a target is and the side of the road a point is
 * on — so a red reading on the realistic page is about what the frame drew
 * and not about where the page held the rider or what it asked of the HUD.
 */

import { describe, expect, it } from 'vitest';

import { deliveryTown } from '../../src/game/delivery/delivery-town-testing';
import {
  nextHouse,
  startDeliveryRide,
  type DeliveryRide,
} from '../../src/game/delivery/ride-round';
import { MAPPED_CHUNK_METRES } from '../../src/game/realistic-budget';

import { planOfTarget, rideHeldAt, roundSamples, sideOfRoad } from './round';

const town = deliveryTown('round-sighting');

function round(): DeliveryRide {
  const ride = startDeliveryRide({
    buildings: town.buildings,
    profile: town.profile,
    origin: town.origin,
    riderDistance: 0,
    lineOffset: 0,
    storage: undefined,
    level: { houses: 6, hazardsPerKilometre: { static: 0, moving: 0 }, lengthMetres: 1 },
  });
  if (ride === undefined) throw new Error('the town gave the round no houses');
  return ride;
}

describe('the samples a round is sighted at — #2513', () => {
  it('holds every house at every lead, in route order, each with its refill chunk’s start', () => {
    const { targets } = round();
    const samples = roundSamples(targets, [100, 20, 0]);
    expect(samples).toHaveLength(targets.length * 3);
    for (let at = 1; at < samples.length; at += 1) {
      expect((samples[at]?.along ?? 0) >= (samples[at - 1]?.along ?? 0)).toBe(true);
    }
    for (const sample of samples) {
      const target = targets[sample.position];
      expect(sample.along).toBeCloseTo((target?.distance ?? Number.NaN) - sample.lead, 9);
      expect(sample.chunkStart % MAPPED_CHUNK_METRES).toBe(0);
      expect(sample.along - sample.chunkStart).toBeGreaterThanOrEqual(0);
      expect(sample.along - sample.chunkStart).toBeLessThan(MAPPED_CHUNK_METRES);
    }
  });

  it('leaves out a sample before the route’s start', () => {
    const { targets } = round();
    const first = targets[0];
    if (first === undefined) throw new Error('no house');
    const samples = roundSamples([first], [first.distance + 1, 0]);
    expect(samples.map((sample) => sample.lead)).toEqual([0]);
  });
});

describe('the ride held before one house — #2513', () => {
  it('is the next house on the HUD, the lead away, on the house’s own side', () => {
    const ride = round();
    for (const target of ride.targets) {
      const held = rideHeldAt(ride, target.position, target.distance - 40);
      expect(nextHouse(held)).toEqual({
        side: target.side === 1 ? 'right' : 'left',
        metres: expect.closeTo(40, 9) as number,
      });
      // Only the houses before it are taken off the round.
      expect(held.round.houses.filter((house) => house === 'delivered')).toHaveLength(
        target.position,
      );
    }
  });
});

describe('a target’s plan and its side of the road — #2513', () => {
  it('finds each target’s house by its front step, on the side the target says', () => {
    const ride = round();
    expect(ride.targets.length).toBeGreaterThan(1);
    const sides = new Set<string>();
    for (const target of ride.targets) {
      const plan = planOfTarget(town.buildings, target);
      expect(plan).toBeGreaterThanOrEqual(0);
      const centre = town.buildings.plans[plan]?.centroid;
      if (centre === undefined) throw new Error('no centroid');
      const side = sideOfRoad(town.profile, town.origin, centre.x, centre.z);
      expect(side).toBe(target.side === 1 ? 'right' : 'left');
      expect(sideOfRoad(town.profile, town.origin, target.x, target.z)).toBe(side);
      sides.add(String(side));
    }
    // Not vacuous: the town has houses either side, and the round found both.
    expect([...sides].sort()).toEqual(['left', 'right']);
  });

  it('finds no plan for a step no house has, and no side far from the road', () => {
    const [target] = round().targets;
    if (target === undefined) throw new Error('no house');
    expect(planOfTarget(town.buildings, { ...target, x: target.x + 0.5 })).toBe(-1);
    expect(sideOfRoad(town.profile, town.origin, target.x + 10_000, target.z)).toBeUndefined();
  });
});
