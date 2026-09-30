// SPDX-License-Identifier: Apache-2.0

/**
 * What a race room checks about a rider — [ADR 0028](../../../docs/adr/0028-racing-fairness.md)
 * D-2 §"What a room checks", rules 1 to 4, as pure functions.
 *
 * [#487](https://github.com/openzigs/onyourleft/issues/487) carries this: the
 * ADR wrote the rule's shape and deliberately did not implement it while there
 * was no room, no transport and no thresholds. The server block is lifted
 * ([ADR 0036](../../../docs/adr/0036-a-self-hostable-instance-server-now.md))
 * and Q3 answered the thresholds, so the rule is written here — in
 * `packages/physics` because rule 1 coasts a rider **through `advance`**, and
 * a room (`apps/instance`, #779) and any client may both read it.
 *
 * ## The four rules, and the one thing none of them does
 *
 * 1. **Admissibility of a report, not of a rider** — {@link judgeReport}. An
 *    inadmissible report is discarded and the rider is **coasted at zero
 *    power**, never extrapolated: {@link powerToSimulate} and
 *    {@link advanceRider}. A room that invents a plausible power for a rider
 *    whose connection dropped has made up the race's result.
 * 2. **Plausibility over a window, never per sample** — {@link plausibility}.
 *    A power–duration ceiling in W/kg of **declared** mass.
 * 3. **A breach FLAGS.** {@link PlausibilityVerdict} has no "reject" in it,
 *    and nothing here stops a flagged rider being simulated. What is done
 *    about a flag is #69's, #785's and #789's.
 * 4. **The room's position wins, and the disagreement is a signal** —
 *    {@link disagreement}. ⚠️ A report carries power and never a position
 *    (ADR 0028 D-2, `@onyourleft/protocol`), so the room cannot see a client's
 *    own position: this is computed **by the client** against the room's frame
 *    (#782), and returned rather than hidden so it can be published.
 *
 * Rule 5 — the physics version on the wire — is `riding.ts`
 * §`PHYSICS_VERSION` and the protocol's handshake.
 *
 * ## Drafting does not reach this rule
 *
 * Drafting (#764, #786) changes the drag area a room simulates with. Every
 * judgement here is of **power for declared mass**, and none takes a
 * coefficient, so a draft factor cannot move a verdict. `plausibility.test.ts`
 * pins that by judging one trace ridden at two drag areas.
 */

import {
  bestMeanPower,
  watts,
  type Kilograms,
  type PowerSeries,
  type Watts,
} from '@onyourleft/domain';

import { PhysicsError } from './physics-error';
import { advance, type RideConditions, type RideState, type RideStep } from './simulate';

/**
 * One report as a room receives it — ADR 0028 D-2's
 * `{ riderId, sequence, atMs, powerWatts, cadenceRpm? }`, exactly.
 *
 * Plain numbers rather than brands: this is untrusted input straight off the
 * wire, and {@link judgeReport} is what decides whether any of it may become a
 * {@link Watts}.
 */
export interface RiderReport {
  readonly riderId: number;
  readonly sequence: number;
  readonly atMs: number;
  readonly powerWatts: number;
  readonly cadenceRpm?: number;
}

/**
 * What the room knows when a report arrives: the last sequence it **admitted**
 * from this rider, and the span of its own clock a report's `atMs` must fall
 * inside. The room chooses the span; this rule only applies it.
 */
export interface ReportWindow {
  readonly lastAdmittedSequence: number | undefined;
  readonly earliestAtMs: number;
  readonly latestAtMs: number;
}

/** One power–duration ceiling: the most W/kg of declared mass a best mean over `durationSeconds` may reach. */
export interface PowerDurationCeiling {
  readonly durationSeconds: number;
  readonly wattsPerKilogram: number;
}

/**
 * The numbers the rule is judged against. A **parameter with defaults**, so an
 * operator or a later amendment can change them without a code change (#487's
 * revision block).
 */
export interface PlausibilityLimits {
  /** A report above this is inadmissible (rule 1). */
  readonly maximumPowerWatts: number;
  /** A declared mass outside this range is inadmissible (rule 1). */
  readonly minimumMassKilograms: number;
  readonly maximumMassKilograms: number;
  /** Rule 2's ceilings, ascending by duration. */
  readonly ceilings: readonly PowerDurationCeiling[];
}

/**
 * ADR 0028's Q3 ceilings, as the owner answered them on 2026-09-22.
 *
 * The provenance of each number is ADR 0028 §Amendments §"Q3's four ceilings,
 * and where each number comes from", and it is repeated here because a number
 * without its provenance stops being re-examined:
 *
 * | Duration | W/kg | Anchor | Provenance |
 * |---|---|---|---|
 * | 5 s | 18 | Sir Chris Hoy, 2500 W peak at 92 kg (UCI, *Track Sprinting: a question of watts?*) — an **instantaneous peak**, not a 5 s mean | first-hand, read 2026-09-22 |
 * | 1 min | 10 | none: no maximal 1-minute figure for a named individual was found | unsourced, and marked so |
 * | 20 min | 6.5 | Chris Froome, a reported ~6.25 W/kg over 20–40 min (Bell et al. 2017) | unsourced — the article was not read |
 * | 1 h | 5.5 | Miguel Indurain's 1994 hour record, ~6.29 W/kg (Padilla et al. 2000) | unsourced — the article was not read |
 *
 * ⚠️ **The 1 h ceiling is about 13 % BELOW the hour-record lead**, so it
 * flags a published world hour record. The owner accepted that *"some genuinely
 * strong riders will be flagged"*, and a breach only flags (rule 3).
 */
export const Q3_CEILINGS: readonly PowerDurationCeiling[] = [
  { durationSeconds: 5, wattsPerKilogram: 18 },
  { durationSeconds: 60, wattsPerKilogram: 10 },
  { durationSeconds: 1200, wattsPerKilogram: 6.5 },
  { durationSeconds: 3600, wattsPerKilogram: 5.5 },
];

/**
 * The defaults.
 *
 * - **2500 W**: the one first-hand figure in Q3's table is Hoy's 2500 W
 *   *instantaneous* peak. A report above the highest peak this project has a
 *   source for is not a sprint, it is a broken or lying meter.
 * - **20–300 kg**: the range the settings screen accepts for a rider's weight
 *   (`apps/web/src/athlete/mass.ts` reads these two fields, so the screen and
 *   the room cannot disagree about what a declarable mass is).
 */
export const DEFAULT_PLAUSIBILITY_LIMITS: PlausibilityLimits = {
  maximumPowerWatts: 2500,
  minimumMassKilograms: 20,
  maximumMassKilograms: 300,
  ceilings: Q3_CEILINGS,
};

/** Why a report was not admitted. Each is its own reason so a room can count them apart. */
export type InadmissibleReason =
  'sequence-not-increasing' | 'outside-window' | 'power-out-of-range' | 'not-a-number';

/** Rule 1's answer about one report. */
export type ReportVerdict =
  | { readonly admissible: true; readonly power: Watts }
  | { readonly admissible: false; readonly reason: InadmissibleReason };

/**
 * Rule 1: is this report admissible?
 *
 * ⚠️ The caller advances {@link ReportWindow.lastAdmittedSequence} only on an
 * admitted report. A report refused for its power has still been seen, but
 * nothing about it — its sequence included — is trusted.
 */
export function judgeReport(
  report: RiderReport,
  window: ReportWindow,
  limits: PlausibilityLimits = DEFAULT_PLAUSIBILITY_LIMITS,
): ReportVerdict {
  if (
    !Number.isInteger(report.sequence) ||
    !Number.isFinite(report.atMs) ||
    !Number.isFinite(report.powerWatts)
  ) {
    return { admissible: false, reason: 'not-a-number' };
  }
  if (window.lastAdmittedSequence !== undefined && report.sequence <= window.lastAdmittedSequence) {
    return { admissible: false, reason: 'sequence-not-increasing' };
  }
  if (report.atMs < window.earliestAtMs || report.atMs > window.latestAtMs) {
    return { admissible: false, reason: 'outside-window' };
  }
  if (report.powerWatts < 0 || report.powerWatts > limits.maximumPowerWatts) {
    return { admissible: false, reason: 'power-out-of-range' };
  }
  return { admissible: true, power: watts(report.powerWatts) };
}

/** Rule 1, for the rider rather than the report: is this a mass a person can declare? */
export function declaredMassAdmissible(
  mass: number,
  limits: PlausibilityLimits = DEFAULT_PLAUSIBILITY_LIMITS,
): boolean {
  return (
    Number.isFinite(mass) &&
    mass >= limits.minimumMassKilograms &&
    mass <= limits.maximumMassKilograms
  );
}

/**
 * The power a room simulates a rider at for a step: the admitted report's, or
 * **zero** — for an inadmissible report and for no report at all.
 *
 * ⚠️ **Never the last admitted power.** That would be extrapolation, and rule 1
 * forbids it: a dropped connection holding its last 400 W up a climb is a
 * result the room invented.
 */
export function powerToSimulate(verdict: ReportVerdict | undefined): Watts {
  return verdict?.admissible === true ? verdict.power : watts(0);
}

/**
 * One re-simulated step for a rider: `advance` at {@link powerToSimulate}.
 * The same `advance` the client runs, which is what makes the room's answer
 * comparable with the client's at all.
 */
export function advanceRider(
  state: RideState,
  step: { readonly verdict: ReportVerdict | undefined } & Omit<RideStep, 'power'>,
  conditions: RideConditions,
): RideState {
  return advance(
    state,
    { power: powerToSimulate(step.verdict), grade: step.grade, duration: step.duration },
    conditions,
  );
}

/** One ceiling a rider went over. */
export interface CeilingBreach {
  readonly durationSeconds: number;
  readonly bestWattsPerKilogram: number;
  readonly ceilingWattsPerKilogram: number;
}

/**
 * Rule 2's answer. **`flagged` and never `rejected`** — rule 3.
 */
export interface PlausibilityVerdict {
  readonly flagged: boolean;
  readonly breaches: readonly CeilingBreach[];
}

/**
 * Rule 2: judged over windows, never per sample.
 *
 * @param simulatedPower the **1 Hz power the room simulated** this rider at —
 * {@link powerToSimulate}'s answer each second, so a coasted second is a
 * **zero**, not a gap. ⚠️ That choice is deliberate: `bestMeanPower` skips a
 * window that spans a gap, so a series with gaps where reports were refused
 * would let a rider escape the 5 s ceiling by having one report in five
 * refused. The room judges what it simulated.
 * @param declaredMass the rider's own declared mass — not `totalMass`: the
 * ceilings are W/kg of the athlete, and the bicycle is not an athlete.
 */
export function plausibility(
  simulatedPower: PowerSeries,
  declaredMass: Kilograms,
  limits: PlausibilityLimits = DEFAULT_PLAUSIBILITY_LIMITS,
): PlausibilityVerdict {
  const breaches: CeilingBreach[] = [];
  for (const ceiling of limits.ceilings) {
    const best = bestMeanPower(simulatedPower, ceiling.durationSeconds);
    if (best === undefined) {
      continue;
    }
    const bestWattsPerKilogram = best / declaredMass;
    if (bestWattsPerKilogram > ceiling.wattsPerKilogram) {
      breaches.push({
        durationSeconds: ceiling.durationSeconds,
        bestWattsPerKilogram,
        ceilingWattsPerKilogram: ceiling.wattsPerKilogram,
      });
    }
  }
  return { flagged: breaches.length > 0, breaches };
}

/** Rule 4's answer: how far apart the two positions are, and whether the client must be corrected. */
export interface Disagreement {
  /** Client minus room, in metres: positive when the client is ahead of its own re-simulation. */
  readonly metres: number;
  readonly correct: boolean;
}

/**
 * Rule 4: the room's position wins, and the size of the disagreement is itself
 * a signal worth publishing.
 *
 * @param toleranceMetres the distance past which a client is corrected. ADR
 * 0028 says "a stated distance" and states none, so it is a **required**
 * parameter rather than a default this file would be inventing.
 * @throws PhysicsError for a tolerance that is not a finite distance of at
 * least 0 m. ⚠️ A NaN would make `correct` false for ever and a negative one
 * true for ever, each silently (#779, from #832's review).
 */
export function disagreement(
  clientMetres: number,
  roomMetres: number,
  toleranceMetres: number,
): Disagreement {
  if (!Number.isFinite(toleranceMetres) || toleranceMetres < 0) {
    throw new PhysicsError('a disagreement tolerance must be a finite distance of at least 0 m');
  }
  const metres = clientMetres - roomMetres;
  return { metres, correct: Math.abs(metres) > toleranceMetres };
}
