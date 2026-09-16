// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #326's wind control, as a pure function — the `pacer-choice.test.ts` shape.
 *
 * The two properties that carry the most weight are the ones a screen cannot
 * be relied on to show: that a refusal is produced for **every** unusable box
 * rather than the ride quietly starting in still air, and that the number the
 * rider typed is read in the unit their own screens are in.
 */

import { describe, expect, it } from 'vitest';

import {
  kilometresPerHourToMetresPerSecond,
  kilometresPerHour,
  MAXIMUM_WIND_SPEED_METRES_PER_SECOND,
  metresPerSecond,
  metresPerSecondToKilometresPerHour,
  milesPerHour,
  milesPerHourToMetresPerSecond,
} from '@onyourleft/domain';

import { DEFAULT_WIND_FROM_BEARING, MAXIMUM_BEARING_DEGREES, windChoice } from './wind-choice';

describe('a rider who did not ask for a wind', () => {
  it('gets still air and no complaint about boxes they are not using', () => {
    const choice = windChoice(false, '', '', 'metric');
    expect(choice.wind).toBeUndefined();
    expect(choice.problem).toBeUndefined();
  });

  it('gets no complaint even when the boxes hold nonsense', () => {
    // `pacer-choice.ts`'s rule: a refusal a rider cannot act on trains them to
    // ignore refusals. They have not ticked the box, so there is nothing to
    // act on.
    expect(windChoice(false, 'gale', '-7', 'metric').problem).toBeUndefined();
  });
});

describe('a rider who did', () => {
  it('gets the wind they typed, in their own units', () => {
    const metric = windChoice(true, '12', '315', 'metric');
    expect(metric.problem).toBeUndefined();
    expect(metric.wind?.fromBearing).toBe(315);
    expect(metric.wind?.speedMetresPerSecond).toBeCloseTo(
      kilometresPerHourToMetresPerSecond(kilometresPerHour(12)),
      9,
    );
  });

  it('reads the same digits as miles per hour for an imperial rider', () => {
    const imperial = windChoice(true, '12', '315', 'imperial');
    expect(imperial.wind?.speedMetresPerSecond).toBeCloseTo(
      milesPerHourToMetresPerSecond(milesPerHour(12)),
      9,
    );
    // And the two really are different winds, or the conversion is doing
    // nothing and this pair of cases is one case written twice.
    expect(imperial.wind?.speedMetresPerSecond).not.toBeCloseTo(
      windChoice(true, '12', '315', 'metric').wind?.speedMetresPerSecond ?? Number.NaN,
      3,
    );
  });

  it('takes a zero as a wind rather than as an empty box', () => {
    const calm = windChoice(true, '0', '90', 'metric');
    expect(calm.problem).toBeUndefined();
    expect(calm.wind?.speedMetresPerSecond).toBe(0);
  });

  it('refuses an empty speed box, and says what the box wants', () => {
    const choice = windChoice(true, '', String(DEFAULT_WIND_FROM_BEARING), 'metric');
    expect(choice.wind).toBeUndefined();
    expect(choice.problem).toMatch(/wind speed/);
  });

  it('refuses a speed that is not a number, and a negative one', () => {
    expect(windChoice(true, 'brisk', '0', 'metric').wind).toBeUndefined();
    expect(windChoice(true, '-4', '0', 'metric').problem).toMatch(/wind speed/);
  });

  it('refuses a speed past the domain’s own bound, in the rider’s units', () => {
    // 40 m/s is 144 km/h, so 500 km/h is comfortably over it and the refusal
    // has to come back naming a **kilometre-per-hour** figure — `wind`'s own
    // message names metres per second, which is not the unit in the box.
    const metric = windChoice(true, '500', '0', 'metric');
    expect(metric.wind).toBeUndefined();
    expect(metric.problem).toMatch(/144\.0 km\/h/);
    expect(metric.problem).not.toMatch(/metres per second/);
    expect(windChoice(true, '500', '0', 'imperial').problem).toMatch(/mph/);
  });

  it('accepts a speed exactly on that bound', () => {
    // Expressed in km/h, so the boundary case goes through the same conversion
    // a rider's typing does rather than past it.
    const most = String(
      metresPerSecondToKilometresPerHour(metresPerSecond(MAXIMUM_WIND_SPEED_METRES_PER_SECOND)),
    );
    expect(windChoice(true, most, '0', 'metric').problem).toBeUndefined();
  });

  it('refuses a bearing outside the circle rather than silently wrapping it', () => {
    // `degreesBearing` would take 3600 and hand back a northerly without
    // complaint. A rider who typed that meant something else.
    expect(windChoice(true, '10', '3600', 'metric').problem).toMatch(/wind direction/);
    expect(windChoice(true, '10', '-1', 'metric').problem).toMatch(/wind direction/);
    expect(windChoice(true, '10', String(MAXIMUM_BEARING_DEGREES + 1), 'metric').problem).toMatch(
      /wind direction/,
    );
    expect(
      windChoice(true, '10', String(MAXIMUM_BEARING_DEGREES), 'metric').problem,
    ).toBeUndefined();
  });

  it('refuses an empty bearing box, and says so about the direction', () => {
    const choice = windChoice(true, '10', '  ', 'metric');
    expect(choice.wind).toBeUndefined();
    expect(choice.problem).toMatch(/wind direction/);
  });

  it('complains about the speed first when both boxes are wrong', () => {
    // One refusal at a time, and it is the first box on the screen — a rider
    // fixes one thing and is told about the next.
    expect(windChoice(true, '', '3600', 'metric').problem).toMatch(/wind speed/);
  });
});
