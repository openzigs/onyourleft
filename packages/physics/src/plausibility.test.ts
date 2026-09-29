// SPDX-License-Identifier: Apache-2.0

/**
 * ADR 0028 D-2 rules 1–4 — #487's acceptance criteria, one describe each.
 *
 * Every rejection case has a partner that is NOT rejected, so a rule that
 * refused everything would fail here rather than pass.
 */

import { describe, expect, it } from 'vitest';

import { gradePercent, kilograms, seconds, watts, type Watts } from '@onyourleft/domain';

import {
  advanceRider,
  declaredMassAdmissible,
  DEFAULT_PLAUSIBILITY_LIMITS,
  disagreement,
  judgeReport,
  plausibility,
  powerToSimulate,
  Q3_CEILINGS,
  type ReportVerdict,
  type ReportWindow,
  type RiderReport,
} from './plausibility';
import { PhysicsError } from './physics-error';
import { RIDING_POSITION_DRAG_AREAS, ridingCoefficients } from './riding';
import { advance, START_OF_RIDE, type RideConditions } from './simulate';

const WINDOW: ReportWindow = { lastAdmittedSequence: 4, earliestAtMs: 1_000, latestAtMs: 2_000 };

function report(overrides: Partial<RiderReport> = {}): RiderReport {
  return { riderId: 7, sequence: 5, atMs: 1_500, powerWatts: 250, ...overrides };
}

/** `seconds` of constant power, as the 1 Hz series the room simulated. */
function held(power: number, count: number): Watts[] {
  return Array.from({ length: count }, () => watts(power));
}

const CONDITIONS: RideConditions = {
  totalMass: kilograms(80),
  airDensityKilogramsPerCubicMetre: 1.225,
  coefficients: ridingCoefficients('hoods'),
};

describe('rule 1 — admissibility of a report, not of a rider', () => {
  it('admits an ordinary report and hands back its power', () => {
    expect(judgeReport(report(), WINDOW)).toEqual({ admissible: true, power: 250 });
  });

  it('admits zero watts and the ceiling itself, which are the two edges of [0, ceiling]', () => {
    expect(judgeReport(report({ powerWatts: 0 }), WINDOW).admissible).toBe(true);
    expect(
      judgeReport(report({ powerWatts: DEFAULT_PLAUSIBILITY_LIMITS.maximumPowerWatts }), WINDOW)
        .admissible,
    ).toBe(true);
  });

  it('refuses a sequence that does not move forward, a repeat included', () => {
    expect(judgeReport(report({ sequence: 4 }), WINDOW)).toEqual({
      admissible: false,
      reason: 'sequence-not-increasing',
    });
    expect(judgeReport(report({ sequence: 3 }), WINDOW).admissible).toBe(false);
    // The first report a room hears has nothing to be monotone against.
    expect(
      judgeReport(report({ sequence: 0 }), { ...WINDOW, lastAdmittedSequence: undefined })
        .admissible,
    ).toBe(true);
  });

  it('refuses a report stamped outside the room’s own window, on either side', () => {
    for (const atMs of [999, 2_001]) {
      expect(judgeReport(report({ atMs }), WINDOW)).toEqual({
        admissible: false,
        reason: 'outside-window',
      });
    }
    expect(judgeReport(report({ atMs: 1_000 }), WINDOW).admissible).toBe(true);
    expect(judgeReport(report({ atMs: 2_000 }), WINDOW).admissible).toBe(true);
  });

  it('refuses negative power and power over the ceiling', () => {
    for (const powerWatts of [-1, DEFAULT_PLAUSIBILITY_LIMITS.maximumPowerWatts + 1]) {
      expect(judgeReport(report({ powerWatts }), WINDOW)).toEqual({
        admissible: false,
        reason: 'power-out-of-range',
      });
    }
  });

  it('refuses a number that is not one, before any comparison could be fooled by it', () => {
    // NaN compares false against everything, so without its own check a NaN
    // power sails through `< 0 || > ceiling` and is simulated.
    for (const bad of [
      { powerWatts: NaN },
      { atMs: NaN },
      { sequence: 5.5 },
      { powerWatts: Infinity },
    ]) {
      expect(judgeReport(report(bad), WINDOW)).toEqual({
        admissible: false,
        reason: 'not-a-number',
      });
    }
  });

  it('takes its ceiling as a parameter', () => {
    const lower = { ...DEFAULT_PLAUSIBILITY_LIMITS, maximumPowerWatts: 200 };
    expect(judgeReport(report(), WINDOW, lower).admissible).toBe(false);
  });

  it('admits a declared mass inside the range and refuses one outside it', () => {
    expect(declaredMassAdmissible(71)).toBe(true);
    expect(declaredMassAdmissible(20)).toBe(true);
    expect(declaredMassAdmissible(300)).toBe(true);
    expect(declaredMassAdmissible(19.9)).toBe(false);
    expect(declaredMassAdmissible(300.1)).toBe(false);
    expect(declaredMassAdmissible(NaN)).toBe(false);
  });
});

describe('rule 1 — an inadmissible report coasts the rider at zero, and nothing is extrapolated', () => {
  const grade = gradePercent(4);
  const duration = seconds(1);

  it('simulates an inadmissible report exactly as zero watts', () => {
    const moving = advance(
      START_OF_RIDE,
      { power: watts(300), grade: gradePercent(0), duration: seconds(10) },
      CONDITIONS,
    );
    const refused = judgeReport(report({ powerWatts: 1_800, atMs: 5_000 }), WINDOW);
    expect(refused.admissible).toBe(false);

    const coasted = advanceRider(moving, { verdict: refused, grade, duration }, CONDITIONS);
    const atZero = advance(moving, { power: watts(0), grade, duration }, CONDITIONS);
    expect(coasted).toEqual(atZero);
    // And not at the power it claimed: the difference is visible.
    const atClaimed = advance(moving, { power: watts(1_800), grade, duration }, CONDITIONS);
    expect(coasted.distance).toBeLessThan(atClaimed.distance);
  });

  it('coasts a rider whose report never came, rather than holding their last power', () => {
    const admitted: ReportVerdict = { admissible: true, power: watts(400) };
    let state = advanceRider(START_OF_RIDE, { verdict: admitted, grade, duration }, CONDITIONS);
    const afterAdmitted = state;
    // The connection drops: no verdict at all for the next step.
    state = advanceRider(state, { verdict: undefined, grade, duration }, CONDITIONS);
    expect(state).toEqual(advance(afterAdmitted, { power: watts(0), grade, duration }, CONDITIONS));
    expect(state).not.toEqual(
      advance(afterAdmitted, { power: watts(400), grade, duration }, CONDITIONS),
    );
    expect(powerToSimulate(undefined)).toBe(0);
  });

  it('simulates an admitted report at its own power', () => {
    const admitted = judgeReport(report({ powerWatts: 320 }), WINDOW);
    expect(powerToSimulate(admitted)).toBe(320);
    expect(advanceRider(START_OF_RIDE, { verdict: admitted, grade, duration }, CONDITIONS)).toEqual(
      advance(START_OF_RIDE, { power: watts(320), grade, duration }, CONDITIONS),
    );
  });
});

describe('rule 2 — a power–duration ceiling, judged over a window rather than per sample', () => {
  const mass = kilograms(75);

  it('rejects — flags — an implausible sustained power for the declared mass', () => {
    // 1800 W for five minutes at 75 kg is 24 W/kg over a minute: not a person.
    const verdict = plausibility(held(1_800, 300), mass);
    expect(verdict.flagged).toBe(true);
    expect(verdict.breaches.map((breach) => breach.durationSeconds)).toEqual([5, 60]);
    expect(verdict.breaches[1]?.bestWattsPerKilogram).toBe(24);
    expect(verdict.breaches[1]?.ceilingWattsPerKilogram).toBe(10);
  });

  it('does not flag a single 1800 W sample, which is a sprint', () => {
    // One second at 1800 W among an ordinary 250 W ride: the best 5 s mean is
    // (1800 + 4·250) / 5 = 560 W, 7.5 W/kg, well inside 18.
    const series = [...held(250, 30), watts(1_800), ...held(250, 30)];
    expect(plausibility(series, mass)).toEqual({ flagged: false, breaches: [] });
  });

  it('flags at a ceiling only when it is exceeded, not when it is met', () => {
    // Exactly 18 W/kg over five seconds is on the line and not over it.
    expect(plausibility(held(18 * 75, 5), mass).flagged).toBe(false);
    expect(plausibility(held(18 * 75 + 1, 5), mass).flagged).toBe(true);
  });

  it('judges the long ceilings too, and does not judge a duration the ride is too short for', () => {
    // 6 W/kg for an hour: inside 6.5 at 20 min, over 5.5 at 1 h.
    const hour = plausibility(held(6 * 75, 3_600), mass);
    expect(hour.breaches.map((breach) => breach.durationSeconds)).toEqual([3600]);
    // The same power for ten minutes has no 20 min or 1 h window at all.
    expect(plausibility(held(6 * 75, 600), mass).flagged).toBe(false);
  });

  it('divides by DECLARED mass, so the same watts on a heavier rider are not flagged', () => {
    expect(plausibility(held(900, 60), kilograms(80)).flagged).toBe(true);
    expect(plausibility(held(900, 60), kilograms(95)).flagged).toBe(false);
  });

  it('takes its ceilings as a parameter, with Q3’s as the default', () => {
    expect(DEFAULT_PLAUSIBILITY_LIMITS.ceilings).toBe(Q3_CEILINGS);
    expect(Q3_CEILINGS).toEqual([
      { durationSeconds: 5, wattsPerKilogram: 18 },
      { durationSeconds: 60, wattsPerKilogram: 10 },
      { durationSeconds: 1200, wattsPerKilogram: 6.5 },
      { durationSeconds: 3600, wattsPerKilogram: 5.5 },
    ]);
    const stricter = {
      ...DEFAULT_PLAUSIBILITY_LIMITS,
      ceilings: [{ durationSeconds: 60, wattsPerKilogram: 3 }],
    };
    expect(plausibility(held(250, 60), mass, stricter).flagged).toBe(true);
    expect(plausibility(held(250, 60), mass).flagged).toBe(false);
  });

  it('cannot be escaped by having every fifth report refused, because a coasted second is a zero', () => {
    // The room's series is what it SIMULATED: a refused report is 0 W there,
    // never a gap bestMeanPower would skip.
    const series = Array.from({ length: 60 }, (_, index) =>
      powerToSimulate(
        index % 5 === 4
          ? { admissible: false, reason: 'outside-window' }
          : { admissible: true, power: watts(2_000) },
      ),
    );
    expect(plausibility(series, mass).flagged).toBe(true);
  });
});

describe('rule 3 — a breach flags; it does not eject', () => {
  it('still simulates a flagged rider at the power they reported', () => {
    const flagged = plausibility(held(1_800, 300), kilograms(75));
    expect(flagged.flagged).toBe(true);
    const verdict = judgeReport(report({ powerWatts: 1_800 }), WINDOW);
    expect(powerToSimulate(verdict)).toBe(1_800);
    expect(Object.keys(flagged).sort()).toEqual(['breaches', 'flagged']);
  });
});

describe('drafting cannot move a verdict (#764, #786)', () => {
  it('holds a flagged trace’s verdict equal ridden at two drag areas', () => {
    // The rule judges power for declared mass. Ride one trace with and without
    // a 30 % draft on the drag area; the power the room simulated is the same
    // series, so the verdict is too — while the ride itself differs.
    const trace = held(1_200, 120);
    const ride = (dragArea: number) => {
      const conditions: RideConditions = {
        ...CONDITIONS,
        coefficients: { ...ridingCoefficients('hoods'), dragCoefficient: dragArea },
      };
      let state = START_OF_RIDE;
      const simulated: Watts[] = [];
      for (const power of trace) {
        const verdict: ReportVerdict = { admissible: true, power };
        simulated.push(powerToSimulate(verdict));
        state = advanceRider(
          state,
          { verdict, grade: gradePercent(0), duration: seconds(1) },
          conditions,
        );
      }
      return { state, verdict: plausibility(simulated, kilograms(75)) };
    };
    const alone = ride(RIDING_POSITION_DRAG_AREAS.hoods);
    const drafting = ride(RIDING_POSITION_DRAG_AREAS.hoods * 0.7);
    expect(drafting.state.distance).toBeGreaterThan(alone.state.distance);
    expect(alone.verdict.flagged).toBe(true);
    expect(drafting.verdict).toEqual(alone.verdict);
  });
});

describe('rule 4 — the room’s position wins, and the disagreement is a signal', () => {
  it('reports how far ahead the client is, signed, and corrects past the tolerance', () => {
    expect(disagreement(105, 100, 3)).toEqual({ metres: 5, correct: true });
    expect(disagreement(97, 100, 3)).toEqual({ metres: -3, correct: false });
    expect(disagreement(96.5, 100, 3)).toEqual({ metres: -3.5, correct: true });
    expect(disagreement(100, 100, 0)).toEqual({ metres: 0, correct: false });
  });

  it('refuses a tolerance that would silently never, or always, correct — #779, from #832’s review', () => {
    for (const tolerance of [Number.NaN, -1, -0.001, Number.POSITIVE_INFINITY]) {
      expect(() => disagreement(105, 100, tolerance)).toThrow(PhysicsError);
    }
  });
});
