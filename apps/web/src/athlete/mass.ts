// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the rider weighs, and the **one** place a default is substituted for a
 * rider who has never said (#325).
 *
 * ## The defect this module is the fix for
 *
 * `apps/web/src/game/rider.ts` rode everyone at a hard-coded 80 kg while
 * `AthleteRecord.mass` sat on the athlete row, migrated since schema 6, read by
 * the segment matcher and by the account export, and **written by nothing at
 * all**. Mass is not decoration in `packages/physics`: it enters
 * `gravityForceNewtons` directly, so on a gradient it is very nearly the whole
 * of the resistance, and it enters `effectiveMassKilograms`, so every
 * acceleration is wrong too. A 60 kg rider modelled at 80 climbs with twenty
 * kilograms they do not have, and the error is largest exactly where a rider
 * cares most.
 *
 * ## Why the substitution is here and not at the call site
 *
 * `analysis/thresholds.ts` states the argument for the threshold default and it
 * is the same one: a claim like *"the game rides at the athlete's mass"* is
 * about the program rather than about a record field, and it is false the
 * moment two callers each write `athlete.mass ?? 80`. Two places would agree
 * until somebody changed one, and then they would disagree silently — the only
 * way a rider's simulated speed goes wrong without anyone noticing.
 *
 * So `packages/store` reads the field **faithfully** — absent stays absent,
 * because that is what is on disk — and {@link riderMassFor} is the only
 * substitution. The `??` below appears once in this client.
 *
 * ## A default is not a measurement, and the screen says so
 *
 * {@link RiderMass.assumed} carries the distinction up to the settings screen
 * and to anything else that renders one, for the reason
 * `AthleteThresholds.assumed` does: a guess presented in the same typeface as a
 * measurement teaches a rider to trust it.
 */

import { kilograms, KILOGRAMS_PER_POUND, type Kilograms } from '@onyourleft/domain';
import type { UnitSystem } from '@onyourleft/store';

/**
 * What a rider who has entered nothing is ridden at, in kilograms.
 *
 * ⚠️ **The rider alone, without the bicycle.** `AthleteRecord.mass` is the
 * athlete's own mass — `records.ts` says so, and `segments/backfill.ts` freezes
 * it onto an effort as a weight class — whereas `packages/physics`'
 * `RideConditions.totalMass` is `m_T`, *"rider plus bicycle plus anything
 * either is carrying"*. The two are not the same number and confusing them is
 * the quietest way to get this wrong: handing a 60 kg athlete's mass straight
 * to the physics rides them on no bicycle, which is a 13 % error in the
 * opposite direction to the one #325 is about. `game/rider.ts`
 * §`BICYCLE_MASS_KILOGRAMS` is where the other half is added, and it is the
 * only place that adds it.
 *
 * **Provenance**: 71 kg is an adult recreational cyclist, and it is not picked
 * at random — Martin et al. 1998, the paper `packages/physics` takes its whole
 * model and every coefficient from, describes its subjects as *"mass
 * 71.9 ± 6.3 kg"* and applies the model to *"a hypothetical subject who had the
 * average characteristics of our subjects"*. So this is the rider the drag area
 * and rolling-resistance constants beside it already assume, which makes the
 * default at least self-consistent.
 *
 * ⚠️ **It is still a default and not a measurement**, and it is wrong for
 * almost every individual rider. That is what {@link RiderMass.assumed} is for.
 */
export const DEFAULT_RIDER_MASS_KILOGRAMS = 71;

/**
 * The lightest mass this client will accept, in kilograms.
 *
 * A bound rather than a validation of a person: `kilograms()` already refuses
 * zero and negatives, and what this catches is a typed decimal point — 6.5 for
 * 65 — which is a number the physics would accept and ride absurdly.
 */
export const MINIMUM_MASS_KILOGRAMS = 20;

/** The heaviest. The same argument: 800 for 80 is a slipped digit, not a rider. */
export const MAXIMUM_MASS_KILOGRAMS = 300;

/** What the rider is ridden at, and whether they ever said so. */
export interface RiderMass {
  readonly mass: Kilograms;
  /** True when {@link DEFAULT_RIDER_MASS_KILOGRAMS} was substituted. */
  readonly assumed: boolean;
}

/**
 * The mass to ride at, the default filled in.
 *
 * ⚠️ **Takes the recorded mass, not the athlete row**, unlike
 * `analysis/thresholds.ts` §`thresholdsFor`, which takes the record. That is
 * not an inconsistency for its own sake: every caller here — the shell, the
 * game screen, the settings screen — holds the *value*, because the shell owns
 * the live one from start-up onwards and a row would be stale the moment a
 * rider saved. A second overload taking a record was written and deleted,
 * because it had no caller: "this device has no athlete row at all" already
 * arrives here as `undefined`, which is exactly what it means.
 */
export function riderMassFor(recorded: Kilograms | undefined): RiderMass {
  return {
    mass: recorded ?? kilograms(DEFAULT_RIDER_MASS_KILOGRAMS),
    assumed: recorded === undefined,
  };
}

/** What a typed weight should do. @see massToSave */
export type MassSave =
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'save'; readonly mass: Kilograms | undefined };

/** Said when the box holds something that is not a weight. */
export const MASS_REFUSAL =
  `Your weight must be a number between ${String(MINIMUM_MASS_KILOGRAMS)} and ` +
  `${String(MAXIMUM_MASS_KILOGRAMS)} kilograms (${String(Math.round(MINIMUM_MASS_KILOGRAMS / KILOGRAMS_PER_POUND))}–` +
  `${String(Math.round(MAXIMUM_MASS_KILOGRAMS / KILOGRAMS_PER_POUND))} pounds), or blank.`;

/**
 * Turn what the rider typed into either a write or a refusal.
 *
 * ⚠️ **A pure function rather than a branch inside the click handler**, for the
 * reason `analysis/thresholds.ts` §`thresholdsToSave` gives at length: in the
 * handler the guard is untestable, because the fall-through hits `kilograms()`,
 * which throws, so the write does not happen *anyway* and the only outward tell
 * is an unhandled rejection. A guard nothing can prove is a guard nothing is
 * keeping.
 *
 * **Blank is a save, not a refusal.** It clears the setting and returns the
 * rider to {@link DEFAULT_RIDER_MASS_KILOGRAMS}, which is the only way somebody
 * who typed a weight by mistake can undo it.
 *
 * ⚠️ **The units are the rider's and the result is always kilograms.** An
 * imperial rider types pounds; the store's unit is a kilogram and always has
 * been, so the conversion is here, at the boundary, through
 * `@onyourleft/domain`'s constant rather than a factor written out locally. A
 * conversion applied twice, or not at all, is the shape this is arranged to
 * make impossible: there is one multiplication and it is in one branch.
 */
export function massToSave(text: string, units: UnitSystem): MassSave {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { kind: 'save', mass: undefined };
  }
  const typed = Number(trimmed);
  if (!Number.isFinite(typed) || typed <= 0) {
    return { kind: 'refused', reason: MASS_REFUSAL };
  }
  const value = units === 'imperial' ? typed * KILOGRAMS_PER_POUND : typed;
  if (value < MINIMUM_MASS_KILOGRAMS || value > MAXIMUM_MASS_KILOGRAMS) {
    return { kind: 'refused', reason: MASS_REFUSAL };
  }
  return { kind: 'save', mass: kilograms(value) };
}
