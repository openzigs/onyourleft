// SPDX-License-Identifier: Apache-2.0

/**
 * #92's pacing rule: the envelope, its shape, and the proof that the bot is
 * synthetic.
 *
 * Three of #92's seven acceptance criteria are checked here and the third is
 * the one that needs the most care:
 *
 * - *"A rider selects a target w/kg … and a bot rides the route at that
 *   intensity"* — the plan, its bounds and the flat power it implies.
 * - *"Dynamic pacing is implemented and testable: bot power on a +5 % gradient
 *   is above its flat power, and on a −5 % gradient is below it, within the
 *   stated ±10 %/−20 % envelope"* — the direction **and** the bounds, because
 *   a rule that responded to gradient by tripling the power would pass a
 *   direction-only assertion.
 * - *"The bot is synthetic and provably so: no stored ride data — from this
 *   rider or any other — is an input to bot behaviour. This is the criterion
 *   that keeps the feature outside the Peloton claim language, so it is
 *   checked, not assumed."*
 *
 * That last one cannot be discharged by a single assertion, so it is three:
 * a **compile-time** constraint on what the plan may hold, a **runtime** walk
 * over the object a bot is actually handed, and a **naming** check over the
 * exported surface. `pacing.ts`'s header explains why the fourth part — that
 * this package can perform no I/O at all — is already enforced elsewhere.
 */

import { describe, expect, it } from 'vitest';

import { gradePercent, kilograms } from '../quantities';

import { PacerError } from './errors';
import * as gapModule from './gap';
import * as pacingModule from './pacing';
import {
  BOT_MASS_KILOGRAMS,
  MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM,
  MINIMUM_INTENSITY_WATTS_PER_KILOGRAM,
  PACING_CLIMB_REFERENCE_GRADE_PERCENT,
  PACING_DESCENT_REFERENCE_GRADE_PERCENT,
  PACING_FACTOR_CEILING,
  PACING_FACTOR_FLOOR,
  PACING_MAXIMUM_EASING,
  PACING_MAXIMUM_UPLIFT,
  botPacerPlan,
  flatPowerWatts,
  pacedPowerWatts,
  pacingFactor,
  type BotPacerPlan,
} from './pacing';

const PLAN = botPacerPlan(2.5);

describe('the plan a rider selects', () => {
  it('rides the advertised intensity at the fixed bot mass', () => {
    expect(PLAN.intensityWattsPerKilogram).toBe(2.5);
    expect(PLAN.massKilograms).toBe(BOT_MASS_KILOGRAMS);
    expect(flatPowerWatts(PLAN)).toBe(2.5 * 75);
  });

  it('weighs 75 kg regardless of who is riding, which is the whole point of the number', () => {
    // The documented mechanic, and the reason it is a constant: two riders
    // comparing notes about a 2.5 w/kg pacer must be describing the same ride.
    expect(BOT_MASS_KILOGRAMS).toBe(75);
    expect(botPacerPlan(3).massKilograms).toBe(botPacerPlan(1).massKilograms);
  });

  it('refuses an intensity outside the range, naming the constraint', () => {
    expect(() => botPacerPlan(MINIMUM_INTENSITY_WATTS_PER_KILOGRAM - 0.01)).toThrow(PacerError);
    expect(() => botPacerPlan(MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM + 0.01)).toThrow(PacerError);
    expect(() => botPacerPlan(Number.NaN)).toThrow(PacerError);
    expect(() => botPacerPlan(25)).toThrow(/between 0.5 and 7 watts per kilogram/);

    // The bounds themselves are inside, not outside.
    expect(() => botPacerPlan(MINIMUM_INTENSITY_WATTS_PER_KILOGRAM)).not.toThrow();
    expect(() => botPacerPlan(MAXIMUM_INTENSITY_WATTS_PER_KILOGRAM)).not.toThrow();
  });

  it('carries the code as well as the message, so a caller can switch on it', () => {
    expect(() => botPacerPlan(0)).toThrow(
      expect.objectContaining({ code: 'intensity-out-of-range' }),
    );
    expect(() => botPacerPlan(2.5, 0)).toThrow(
      expect.objectContaining({ code: 'mass-out-of-range' }),
    );
    expect(() => botPacerPlan(2.5, Number.POSITIVE_INFINITY)).toThrow(PacerError);
  });
});

describe('dynamic pacing: the direction', () => {
  it('pushes harder up a +5 % gradient than on the flat', () => {
    expect(pacedPowerWatts(PLAN, gradePercent(5))).toBeGreaterThan(flatPowerWatts(PLAN));
  });

  it('eases off down a −5 % gradient', () => {
    expect(pacedPowerWatts(PLAN, gradePercent(-5))).toBeLessThan(flatPowerWatts(PLAN));
  });

  it('rides exactly the advertised power on the flat', () => {
    expect(pacingFactor(gradePercent(0))).toBe(1);
    expect(pacedPowerWatts(PLAN, gradePercent(0))).toBe(flatPowerWatts(PLAN));
  });
});

describe('dynamic pacing: the envelope', () => {
  it('never leaves +10 % / −20 % of the flat power, at any gradient', () => {
    // A sweep rather than three cases: the criterion states an envelope, and an
    // envelope is a claim about every gradient rather than about the two the
    // direction assertions happen to use. −60 % to +60 % covers everything
    // `MAX_SIMULATED_GRADE_PERCENT` would ever let a trainer see, and then some.
    for (let grade = -60; grade <= 60; grade += 0.25) {
      const factor = pacingFactor(gradePercent(grade));
      expect(factor).toBeLessThanOrEqual(PACING_FACTOR_CEILING);
      expect(factor).toBeGreaterThanOrEqual(PACING_FACTOR_FLOOR);
    }
    expect(PACING_FACTOR_CEILING).toBe(1.1);
    expect(PACING_FACTOR_FLOOR).toBe(0.8);
  });

  it('reaches both bounds rather than merely staying inside them', () => {
    // An envelope nothing touches would be satisfied by a rule that ignored the
    // gradient entirely, which is the failure the direction tests above catch
    // in only two places.
    expect(pacingFactor(gradePercent(PACING_CLIMB_REFERENCE_GRADE_PERCENT))).toBeCloseTo(
      PACING_FACTOR_CEILING,
      12,
    );
    expect(pacingFactor(gradePercent(-PACING_DESCENT_REFERENCE_GRADE_PERCENT))).toBeCloseTo(
      PACING_FACTOR_FLOOR,
      12,
    );
  });

  it('saturates beyond the reference gradients instead of running away', () => {
    expect(pacingFactor(gradePercent(20))).toBe(pacingFactor(gradePercent(40)));
    expect(pacingFactor(gradePercent(-20))).toBe(pacingFactor(gradePercent(-40)));
  });

  it('puts +5 % and −5 % strictly inside the envelope, not on its edge', () => {
    // Deliberate: the criterion's two named gradients should exercise the ramp,
    // not the clamp, or the assertions above would be testing the same code.
    const climb = pacingFactor(gradePercent(5));
    const descent = pacingFactor(gradePercent(-5));
    expect(climb).toBeLessThan(PACING_FACTOR_CEILING);
    expect(climb).toBeGreaterThan(1);
    expect(descent).toBeGreaterThan(PACING_FACTOR_FLOOR);
    expect(descent).toBeLessThan(1);
  });

  it('rises with the gradient everywhere, so a steeper hill is never easier', () => {
    let previous = pacingFactor(gradePercent(-60));
    for (let grade = -60; grade <= 60; grade += 0.25) {
      const factor = pacingFactor(gradePercent(grade));
      expect(factor).toBeGreaterThanOrEqual(previous);
      previous = factor;
    }
  });

  it('eases twice as far as it pushes, at the bounds', () => {
    expect(PACING_MAXIMUM_EASING).toBe(2 * PACING_MAXIMUM_UPLIFT);
  });

  it('also eases EARLIER than it pushes, which is a claim about the ramp', () => {
    // ⚠️ Found by mutation, and the reason this test is separate from the one
    // above. The obvious form — "±4 % moves the power further down than up" —
    // is **passed by `PACING_MAXIMUM_EASING` alone**, because the easing bound
    // is already twice the uplift bound. Changing
    // `PACING_CLIMB_REFERENCE_GRADE_PERCENT` from 8 to 6 left it green, so the
    // ramp asymmetry — the design claim that a rider soft-pedals as soon as the
    // road tips down, well before they are out of the saddle on the equivalent
    // climb — had nothing testing it at all.
    //
    // Normalising each direction against its OWN bound is what isolates it:
    // this asks how far along its ramp each side has travelled at the same
    // gradient, which the maxima cancel out of entirely.
    const magnitude = 4;
    const climbProgress = (pacingFactor(gradePercent(magnitude)) - 1) / PACING_MAXIMUM_UPLIFT;
    const descentProgress = (1 - pacingFactor(gradePercent(-magnitude))) / PACING_MAXIMUM_EASING;
    expect(descentProgress).toBeGreaterThan(climbProgress);

    // And the intent, stated where a reader will look for it. The two values
    // themselves are deliberately NOT pinned: `pacing.ts` flags both as feel
    // parameters rather than measured constants, so pinning 8 and 6 would be
    // pinning a preference. Their ORDER is the design decision.
    expect(PACING_DESCENT_REFERENCE_GRADE_PERCENT).toBeLessThan(
      PACING_CLIMB_REFERENCE_GRADE_PERCENT,
    );
  });

  it('treats a non-finite gradient as flat rather than throwing mid-ride', () => {
    expect(pacingFactor(Number.NaN)).toBe(1);
    expect(pacingFactor(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('scales with the advertised intensity, so the envelope is a fraction and not a constant', () => {
    const gentle = botPacerPlan(1.5);
    const hard = botPacerPlan(4.5);
    const grade = gradePercent(5);
    expect(pacedPowerWatts(hard, grade) / pacedPowerWatts(gentle, grade)).toBeCloseTo(3, 12);
  });
});

describe('the bot is synthetic, and that is checked rather than assumed', () => {
  /**
   * Every key a bot's pacing may read, named once.
   *
   * The point of writing them down is that adding a field to `BotPacerPlan`
   * fails this test until somebody has looked at the name and decided it is not
   * a recorded ride. That is the review step #92 asks for, made unskippable.
   */
  const ALLOWED_PLAN_KEYS = ['intensityWattsPerKilogram', 'massKilograms'];

  it('is built from nothing but a target intensity and a mass', () => {
    expect(Object.keys(botPacerPlan(2.5)).sort()).toEqual([...ALLOWED_PLAN_KEYS].sort());
  });

  it('holds no value that could be a recorded ride', () => {
    // Walked rather than asserted key by key: a nested object or an array is
    // where a sample series, an effort or an activity id would have to live, and
    // this rejects the shape rather than the name.
    for (const value of Object.values(botPacerPlan(2.5))) {
      expect(typeof value).toBe('number');
    }
  });

  it('will not compile if the plan gains a field that could carry one', () => {
    // The compile-time half, per CLAUDE.md §5 "Verifying a compile-time
    // guarantee". `BotPacerPlanIsSynthetic` applies `SyntheticInput` as a
    // CONSTRAINT, so a `readonly samples: readonly number[]` on `BotPacerPlan`
    // makes `pacing.ts` itself fail with:
    //
    //   error TS2344: Type 'BotPacerPlan' does not satisfy the constraint
    //   'SyntheticInput<BotPacerPlan>'.
    //
    // Verified by adding exactly that field and running
    // `pnpm --filter @onyourleft/domain run typecheck`. The directives below are
    // the part that goes red if the plan is ever widened to accept one at a
    // call site: each is an object that is not a `BotPacerPlan`, and if any of
    // them ever starts to typecheck, TS2578 fails the build.

    const withSamples: BotPacerPlan = {
      intensityWattsPerKilogram: 2.5,
      massKilograms: kilograms(75),
      // @ts-expect-error — a recorded power series is not a pacing input.
      samples: [210, 215, 220],
    };
    const withActivity: BotPacerPlan = {
      intensityWattsPerKilogram: 2.5,
      massKilograms: kilograms(75),
      // @ts-expect-error — nor is an activity somebody rode.
      activityId: 'a-previous-ride',
    };
    const withAthlete: BotPacerPlan = {
      intensityWattsPerKilogram: 2.5,
      massKilograms: kilograms(75),
      // @ts-expect-error — nor is another athlete.
      athleteId: 'somebody-else',
    };

    // The directives are the assertion; these keep the bindings used and pin
    // that the extra fields would otherwise have been carried along silently.
    expect(flatPowerWatts(withSamples)).toBe(187.5);
    expect(flatPowerWatts(withActivity)).toBe(187.5);
    expect(flatPowerWatts(withAthlete)).toBe(187.5);
  });

  it('is a pure function of its inputs, so two identical plans pace identically', () => {
    // Determinism is what "computed rather than replayed" means operationally:
    // there is no state, no clock and no source of variation to smuggle a
    // recorded ride in through.
    const grades = [-12, -5, -0.4, 0, 0.4, 5, 12];
    const first = grades.map((grade) => pacedPowerWatts(botPacerPlan(2.5), gradePercent(grade)));
    const second = grades.map((grade) => pacedPowerWatts(botPacerPlan(2.5), gradePercent(grade)));
    expect(first).toEqual(second);
  });
});

describe('no leaderboard, no ranking, no other person', () => {
  it('exports nothing named for a person, a ranking or a stored ride', () => {
    // #92's last criterion, checked over the surface of both files rather than
    // asserted in a comment. A `rankPacersAgainstAthletes` added to either one
    // fails this test; ADR 0007 D4 is why it must.
    const forbidden =
      /leaderboard|ranking|\brank\b|athlete|activity|effort|ghost|opponent|competitor|replay/i;
    for (const name of [...Object.keys(pacingModule), ...Object.keys(gapModule)]) {
      expect(name).not.toMatch(forbidden);
    }
  });
});
