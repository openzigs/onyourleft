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
 * rider's own mass could get into one.
 *
 * ⚠️ **That assertion used to be written against `RIDER_MASS_KILOGRAMS`, a
 * constant this client no longer has, and a reviewer who remembers it is
 * reading the old file.** #325 made the rider's mass the athlete's own, so
 * there is no single number to be "not equal to" any more — and the old
 * assertion was weaker than it looked, because it passed for any rider who did
 * not happen to weigh 75 kg. What replaces it is stronger and is stated over a
 * *range* of rider masses: the plan this function builds is the same plan
 * whatever the rider weighs, including when they weigh exactly what the bot
 * does. `simulation.test.ts` §"regardless of the rider's mass" is the other
 * half, one layer down, where the two masses actually meet.
 */

import { describe, expect, it } from 'vitest';

import {
  kilograms,
  BOT_MASS_KILOGRAMS,
  MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM,
  MINIMUM_INTENSITY_WATTS_PER_KILOGRAM,
  flatPowerWatts,
} from '@onyourleft/domain';

import { DEFAULT_PACER_INTENSITY, pacerChoice } from './pacer-choice';

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
    expect(choice.plan?.intensityWattsPerKilogram).toBe(DEFAULT_PACER_INTENSITY);
  });

  it('cannot be told what the rider weighs, which is what keeps the two apart', () => {
    // ⚠️ **A compile-time guarantee, mutation-tested the way CLAUDE.md §5
    // prescribes**: give `pacerChoice` a third parameter for the rider's mass
    // and this file fails to compile with TS2578, an unused
    // '@ts-expect-error'. It replaces an assertion that used to read
    // `not.toBe(RIDER_MASS_KILOGRAMS)` — which #325 removed the constant for,
    // and which was in any case satisfied by every rider who did not weigh
    // 75 kg. This one is satisfied by nobody who adds the parameter.
    const choice = pacerChoice(
      true,
      String(DEFAULT_PACER_INTENSITY),
      // @ts-expect-error `pacerChoice` takes no rider mass, and must not.
      kilograms(55),
    );

    expect(choice.plan?.massKilograms).toBe(BOT_MASS_KILOGRAMS);
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
