// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { beatsPerMinute, seconds, watts } from '../quantities';
import {
  HEART_RATE_ZONE_LOWER_FRACTIONS,
  HEART_RATE_ZONE_NAMES,
  heartRateZones,
  POWER_ZONE_LOWER_FRACTIONS,
  POWER_ZONE_NAMES,
  powerZones,
  timeInZones,
  zoneOf,
} from './zones';

const THRESHOLD = watts(250);

describe('powerZones — derived from one threshold', () => {
  it('puts every boundary at its fraction of the threshold', () => {
    const zones = powerZones(THRESHOLD);

    // 0.56 × 250 = 140, 0.76 × 250 = 190, 0.91 × 250 = 227.5.
    expect(zones[0]?.lower).toBe(0);
    expect(zones[1]?.lower).toBeCloseTo(140, 9);
    expect(zones[2]?.lower).toBeCloseTo(190, 9);
    expect(zones[3]?.lower).toBeCloseTo(227.5, 9);
  });

  it('moves every zone when the threshold changes', () => {
    // #78's first criterion, asserted rather than assumed from the formula.
    const lower = powerZones(watts(200));
    const higher = powerZones(watts(300));

    // Zone 1 starts at 0 in both — it is the only boundary that does not move,
    // and it is 0 by definition rather than by threshold.
    expect(lower[0]?.lower).toBe(higher[0]?.lower);
    for (let index = 1; index < lower.length; index += 1) {
      expect(higher[index]?.lower).toBeGreaterThan(lower[index]?.lower ?? 0);
    }
    // And the ratio is exactly the ratio of thresholds, so nothing is rounded
    // into a zone it does not belong in.
    expect((higher[3]?.lower ?? 0) / (lower[3]?.lower ?? 1)).toBeCloseTo(1.5, 9);
  });

  it('leaves the top zone open above', () => {
    const zones = powerZones(THRESHOLD);
    expect(zones.at(-1)?.upper).toBeUndefined();
  });

  it('has a name for every zone', () => {
    // The names table and the fractions table must stay the same length: the
    // implementation falls back to "Zone N" rather than crashing, and this is
    // what stops that fallback ever being reached silently.
    expect(POWER_ZONE_NAMES).toHaveLength(POWER_ZONE_LOWER_FRACTIONS.length);
    expect(HEART_RATE_ZONE_NAMES).toHaveLength(HEART_RATE_ZONE_LOWER_FRACTIONS.length);
    expect(powerZones(THRESHOLD).map((zone) => zone.name)).toEqual(POWER_ZONE_NAMES);
  });

  it('gives heart rate five zones, not seven', () => {
    // Deliberate: heart rate lags and saturates, so the top power zones have no
    // heart-rate counterpart to report.
    expect(heartRateZones(beatsPerMinute(170))).toHaveLength(5);
    expect(powerZones(THRESHOLD)).toHaveLength(7);
  });
});

describe('zoneOf — the boundary rule', () => {
  const zones = powerZones(THRESHOLD);

  it('puts a sample exactly on a boundary in the upper zone', () => {
    // The rule: inclusive below, exclusive above. 140 W is zone 2's lower
    // bound, so it is zone 2 and not zone 1. This is the assertion #78 asks
    // for, and the one that decides whether the totals can sum correctly.
    expect(zoneOf(zones, 140)?.index).toBe(2);
    expect(zoneOf(zones, 139.999)?.index).toBe(1);
    expect(zoneOf(zones, 190)?.index).toBe(3);
  });

  it('classifies zero, which is a coasting rider rather than a gap', () => {
    expect(zoneOf(zones, 0)?.index).toBe(1);
  });

  it('classifies a value above every boundary into the open top zone', () => {
    expect(zoneOf(zones, 5_000)?.index).toBe(7);
  });

  it('claims no zone for a reading that is not an intensity', () => {
    // Negative or non-finite. Excluded rather than forced into zone one, on
    // the same reasoning as a gap.
    expect(zoneOf(zones, -1)).toBeUndefined();
    expect(zoneOf(zones, Number.NaN)).toBeUndefined();
    expect(zoneOf(zones, Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it('claims exactly one zone for every value, so the totals can add up', () => {
    // The property the sum rests on: total and unambiguous. Walked across
    // every boundary rather than sampled at convenient points.
    for (const zone of zones) {
      const inside = zone.lower + (zone.upper === undefined ? 100 : (zone.upper - zone.lower) / 2);
      expect(zoneOf(zones, zone.lower)?.index).toBe(zone.index);
      expect(zoneOf(zones, inside)?.index).toBe(zone.index);
    }
  });
});

describe('timeInZones', () => {
  const zones = powerZones(THRESHOLD);
  const ONE_SECOND = seconds(1);

  it('sums to the ride’s moving time on a ride the sensor covered throughout', () => {
    // #78's headline assertion, "to the second". The fixture is built so that
    // every moving second carries a reading, which is the condition under which
    // covered time and moving time are the same number — see the file comment
    // in zones.ts for why they are not always.
    const movingTime = 600;
    const samples = [
      ...Array.from<number>({ length: 200 }).fill(100), // zone 1
      ...Array.from<number>({ length: 250 }).fill(200), // zone 3
      ...Array.from<number>({ length: 150 }).fill(240), // zone 4
    ];
    expect(samples).toHaveLength(movingTime);

    const result = timeInZones(zones, samples, ONE_SECOND);

    const total = result.perZone.reduce((sum, value) => sum + value, 0);
    expect(total).toBe(movingTime);
    expect(result.covered).toBe(movingTime);
  });

  it('puts each block in the zone its wattage belongs to', () => {
    const samples = [
      ...Array.from<number>({ length: 200 }).fill(100),
      ...Array.from<number>({ length: 250 }).fill(200),
      ...Array.from<number>({ length: 150 }).fill(240),
    ];

    const { perZone } = timeInZones(zones, samples, ONE_SECOND);

    // 100 W is below 140 → zone 1. 200 W is in [190, 227.5) → zone 3.
    // 240 W is in [227.5, 265) → zone 4.
    expect(perZone[0]).toBe(200);
    expect(perZone[2]).toBe(250);
    expect(perZone[3]).toBe(150);
    expect(perZone[1]).toBe(0);
  });

  it('excludes a recording gap from every zone rather than calling it zone one', () => {
    // #78's fourth criterion. The failure it names is specific: a gap counted
    // as zone one turns a dead sensor into recovery riding.
    const samples = [
      ...Array.from<number>({ length: 100 }).fill(200),
      ...Array.from<number | undefined>({ length: 300 }).fill(undefined),
      ...Array.from<number>({ length: 100 }).fill(200),
    ];

    const { perZone, covered } = timeInZones(zones, samples, ONE_SECOND);

    expect(perZone[0]).toBe(0);
    expect(perZone[2]).toBe(200);
    expect(covered).toBe(200);
    // 700 samples, 200 seconds covered. The 500-second shortfall is the gap,
    // and it is visible rather than absorbed.
    expect(samples).toHaveLength(500);
  });

  it('always sums to covered, whatever the data', () => {
    // The invariant that holds without knowing anything about the ride, and
    // the one a caller can rely on. Moving time is a comparison; this is a law.
    const messy = [200, undefined, 0, -5, Number.NaN, 140, 1_000, undefined, 139.999];

    const result = timeInZones(zones, messy, ONE_SECOND);

    const total = result.perZone.reduce((sum, value) => sum + value, 0);
    expect(total).toBe(result.covered);
    // Five of the nine are classifiable: 200, 0, 140, 1000, 139.999.
    expect(result.covered).toBe(5);
  });

  it('honours the sample interval rather than assuming one second', () => {
    // A stream stored at another rate must not silently report the wrong
    // durations, so the interval comes from the stream.
    const samples = Array.from<number>({ length: 60 }).fill(200);

    expect(timeInZones(zones, samples, seconds(1)).covered).toBe(60);
    expect(timeInZones(zones, samples, seconds(5)).covered).toBe(300);
  });

  it('reports all zeros for a ride with no readings at all', () => {
    // A ride with no power shows no power zones — the data half of #78's
    // "shows only that one rather than an empty chart".
    const none = Array.from<number | undefined>({ length: 3600 }).fill(undefined);

    const result = timeInZones(zones, none, ONE_SECOND);

    expect(result.covered).toBe(0);
    expect(result.perZone.every((value) => value === 0)).toBe(true);
  });

  it('moves time between zones when the threshold changes', () => {
    // The other half of criterion 1: not just that the boundaries move, but
    // that what the rider is told about their ride moves with them.
    const samples = Array.from<number>({ length: 100 }).fill(200);

    const atLowThreshold = timeInZones(powerZones(watts(200)), samples, ONE_SECOND);
    const atHighThreshold = timeInZones(powerZones(watts(300)), samples, ONE_SECOND);

    // 200 W is threshold itself at 200 (zone 4); it is 0.67 of 300 (zone 2).
    expect(atLowThreshold.perZone[3]).toBe(100);
    expect(atHighThreshold.perZone[1]).toBe(100);
    // And the total is unchanged — the ride did not get longer.
    expect(atLowThreshold.covered).toBe(atHighThreshold.covered);
  });
});

describe('heartRateZones', () => {
  it('classifies against threshold heart rate on the same boundary rule', () => {
    const zones = heartRateZones(beatsPerMinute(170));

    // ⚠️ The boundary is read from the zone rather than written as a decimal,
    // and the first version of this test did the latter and failed. `0.81 ×
    // 170` is 137.70000000000002, not 137.7, so a hand-written 137.7 is BELOW
    // the boundary and lands in zone 1 — the test would have been asserting
    // floating-point arithmetic rather than the boundary rule.
    //
    // It is not only a test problem: it is why nothing outside this module
    // should recompute a boundary it can ask for.
    const secondZoneStart = zones[1]?.lower ?? 0;
    expect(zoneOf(zones, secondZoneStart)?.index).toBe(2);
    expect(zoneOf(zones, secondZoneStart - 1e-9)?.index).toBe(1);

    // The boundaries are still where the fractions put them, to a tolerance
    // that says the fractions are right without pinning the last bit.
    expect(secondZoneStart).toBeCloseTo(137.7, 9);
    expect(zones[2]?.lower).toBeCloseTo(153, 9);
    expect(zoneOf(zones, 200)?.index).toBe(5);
  });
});
