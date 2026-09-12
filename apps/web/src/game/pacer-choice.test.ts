// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The rider's pacer choice, and the two things #237 asks this layer to prove.
 *
 * The first is the bounds: the intensity arrives from a control on a screen, so
 * a slipped decimal point has to be refused with a message rather than ridden
 * away from — `pacer/pacing.ts` §`botPacerPlan` says exactly that where it
 * throws.
 *
 * The second is the mass. #237's third criterion is that *"the bot's power is a
 * fraction of a flat 75 kg figure and never a recorded one"*, and this file is
 * the only place in the client that builds a plan — so it is the only place the
 * rider's own mass could get into one. The assertion below pins it against
 * `RIDER_MASS_KILOGRAMS`, the number `GameView` rides the *rider* at, rather
 * than only against the constant: a plan built from the rider's conditions
 * would satisfy "is a number" and "is 80" and fail this.
 */

import { describe, expect, it } from 'vitest';

import {
  BOT_MASS_KILOGRAMS,
  MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM,
  MINIMUM_INTENSITY_WATTS_PER_KILOGRAM,
  flatPowerWatts,
} from '@onyourleft/domain';

import { DEFAULT_PACER_INTENSITY, pacerChoice } from './pacer-choice';
import { RIDER_MASS_KILOGRAMS } from './rider';

describe('a rider who did not ask for a pacer', () => {
  it('gets no plan and — this is the point — no complaint about the box', () => {
    // Nonsense in the intensity box while the checkbox is clear must not block
    // a ride that has no pacer in it. A refusal a rider cannot act on is worse
    // than no refusal.
    const choice = pacerChoice(false, 'not a number at all');

    expect(choice.plan).toBeUndefined();
    expect(choice.problem).toBeUndefined();
  });
});

describe('a rider who did ask for one', () => {
  it('rides against a bot at the bot’s mass, never their own', () => {
    const choice = pacerChoice(true, String(DEFAULT_PACER_INTENSITY));

    expect(choice.problem).toBeUndefined();
    expect(choice.plan?.massKilograms).toBe(BOT_MASS_KILOGRAMS);
    // The rider's mass is a different number, and a plan carrying it would be
    // the defect #237's third criterion names.
    expect(choice.plan?.massKilograms).not.toBe(RIDER_MASS_KILOGRAMS);
    expect(choice.plan?.intensityWattsPerKilogram).toBe(DEFAULT_PACER_INTENSITY);
  });

  it('carries the intensity they typed through to the flat power', () => {
    const plan = pacerChoice(true, '3.25').plan;

    expect(plan).toBeDefined();
    // Read through the rule rather than off the field, so a plan that stored
    // the number and ignored it would fail here.
    expect(flatPowerWatts(plan as NonNullable<typeof plan>)).toBeCloseTo(
      3.25 * BOT_MASS_KILOGRAMS,
      6,
    );
  });

  it('accepts the ends of the range', () => {
    expect(pacerChoice(true, String(MINIMUM_INTENSITY_WATTS_PER_KILOGRAM)).problem).toBeUndefined();
    expect(pacerChoice(true, String(MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM)).problem).toBeUndefined();
  });
});

describe('what a rider is told when the number is not usable', () => {
  it('refuses a blank box, naming the range', () => {
    const choice = pacerChoice(true, '   ');

    expect(choice.plan).toBeUndefined();
    expect(choice.problem).toContain(String(MINIMUM_INTENSITY_WATTS_PER_KILOGRAM));
    expect(choice.problem).toContain(String(MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM));
  });

  it('refuses text', () => {
    expect(pacerChoice(true, 'fast').plan).toBeUndefined();
    expect(pacerChoice(true, 'fast').problem).toBeDefined();
  });

  it('refuses a slipped decimal point in either direction', () => {
    const tooLow = pacerChoice(true, String(MINIMUM_INTENSITY_WATTS_PER_KILOGRAM / 10));
    const tooHigh = pacerChoice(true, String(MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM * 10));

    expect(tooLow.plan).toBeUndefined();
    expect(tooLow.problem).toBeDefined();
    expect(tooHigh.plan).toBeUndefined();
    expect(tooHigh.problem).toBeDefined();
  });

  it('says nothing about the value in a way that hides which bound was missed', () => {
    // Not a coordinate, so the value itself is the diagnostic and is quoted —
    // ADR 0004 decision D applies to coordinates only, and an intensity is the
    // one thing a rider needs read back to them to see the slipped decimal.
    expect(pacerChoice(true, '70').problem).toContain('70');
  });
});

describe('the default', () => {
  it('is inside the range the rule accepts', () => {
    expect(DEFAULT_PACER_INTENSITY).toBeGreaterThanOrEqual(MINIMUM_INTENSITY_WATTS_PER_KILOGRAM);
    expect(DEFAULT_PACER_INTENSITY).toBeLessThanOrEqual(MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM);
  });
});
