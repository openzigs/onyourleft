// SPDX-License-Identifier: Apache-2.0

/**
 * The coefficient set a ride is simulated with — the game's, and a race's.
 *
 * ## Why this is here and not in `apps/web/src/game/rider.ts`
 *
 * Until [#487](https://github.com/openzigs/onyourleft/issues/487) the three
 * drag areas and the rolling resistance lived in the game, under `apps/`.
 * [ADR 0028](../../../docs/adr/0028-racing-fairness.md) D-1 decides that a race
 * runs **exactly** that set — `MARTIN_1998_COEFFICIENTS` with two overrides —
 * so that a rider is not quicker alone than in a race. A room is under
 * `apps/instance`, may not import `apps/web`, and nothing under `packages/` may
 * import `apps/` at all (`eslint.config.js` §`boundaries/dependencies`). A
 * room restating the numbers would be a second set that can drift from the
 * first, which is the defect D-1 exists to prevent. So the numbers moved here,
 * and the game reads them from here — one set, two readers.
 *
 * What stayed in the game is what is the game's: the labels a picker shows,
 * the order it offers them in, and the rider's default position.
 *
 * The provenance of every number is unchanged by the move and is recorded
 * where it always was, at `apps/web/src/game/rider.ts` §`ridingPositionDragArea`
 * and §`GAME_ROLLING_RESISTANCE_COEFFICIENT` (#365). They are **this project's
 * defaults and not measurements**.
 */

import { altitudeMetres, degreesCelsius, kilograms, type Kilograms } from '@onyourleft/domain';

import { airDensityKilogramsPerCubicMetre } from './air';
import type { PhysicsCoefficients } from './coefficients';
import { withDragArea } from './coefficients';
import { PhysicsError } from './physics-error';
import type { RideConditions } from './simulate';

/**
 * Where a rider's hands are — #365. In a race it is the race's, never the
 * rider's (ADR 0028 D-1).
 */
export type RidingPosition = 'upright' | 'hoods' | 'drops';

/**
 * `c_d · A` for each position, in square metres.
 *
 * A `Record` keyed by the union, so a lookup is total and a fourth position is
 * a compile error here rather than a fallback somewhere else.
 */
export const RIDING_POSITION_DRAG_AREAS: Readonly<Record<RidingPosition, number>> = {
  upright: 0.42,
  hoods: 0.36,
  drops: 0.31,
};

/**
 * `C_RR` for every ride, whatever the position — 0.005, a road bike on
 * ordinary tarmac, where Martin's 0.0032 is high-pressure clinchers on smooth
 * asphalt (#365). One figure, deliberately not per position: a tyre on a
 * surface does not change with where the rider's hands are.
 */
export const ROAD_ROLLING_RESISTANCE_COEFFICIENT = 0.005;

/**
 * The overrides a ride in `position` is simulated with — **exactly two**, as
 * ADR 0028 D-1's table says: the drag area through {@link withDragArea}, and
 * {@link ROAD_ROLLING_RESISTANCE_COEFFICIENT}. Every other field is the
 * package default, filled in by `advance`.
 *
 * ⚠️ Set through `withDragArea`, never by editing one factor: Martin measures
 * the product and only the product (`README.md` §2).
 */
export function ridingCoefficients(
  position: RidingPosition,
): Pick<
  PhysicsCoefficients,
  'dragCoefficient' | 'frontalAreaSquareMetres' | 'rollingResistanceCoefficient'
> {
  return {
    ...withDragArea(RIDING_POSITION_DRAG_AREAS[position]),
    rollingResistanceCoefficient: ROAD_ROLLING_RESISTANCE_COEFFICIENT,
  };
}

/**
 * What the bicycle under every rider weighs, in kilograms — ADR 0028 D-1's
 * "one bicycle".
 *
 * Moved here from `apps/web/src/game/rider.ts` by #779 for the reason the
 * drag areas moved in #487: a race room adds it to a declared mass, may not
 * import `apps/web`, and a second 9 written under `apps/instance` could drift.
 * Its provenance — a road bike a rider owns, with pedals; a **default and not
 * a measurement** — is recorded where it always was, at `rider.ts`.
 */
export const BICYCLE_MASS_KILOGRAMS = 9;

/**
 * Sea level at 15 °C, the ISO 2533 reference, through `air.ts` — the air every
 * ride and every race is simulated in (ADR 0028 D-1: one air).
 *
 * ⚠️ `air.ts` uses `Math.pow`, which IEEE 754 does not specify exactly. At
 * altitude 0 its base is `1 − L·0/T₀ = 1` exactly, and `pow(1, y)` is `1` by
 * the ECMAScript specification on every engine, so this one value is as
 * portable as the four operations. A race at altitude would not be.
 */
export const SEA_LEVEL_AIR_DENSITY = airDensityKilogramsPerCubicMetre(
  altitudeMetres(0),
  degreesCelsius(15),
);

/**
 * Everything `advance` needs to ride an athlete of `athleteMass` in `position`
 * — the game's ride and a race room's re-simulation, built one way (#779).
 *
 * @param athleteMass the **athlete's** declared mass; the bicycle is added here
 * and only here.
 * @param dragFactor ADR 0038's draft multiplier `k` on the position's `C_D·A`
 * (`draft.ts`); `1`, the default, is riding alone and is byte for byte the
 * conditions before drafting existed.
 */
export function ridingConditions(
  athleteMass: Kilograms,
  position: RidingPosition,
  dragFactor = 1,
): RideConditions {
  if (!(dragFactor > 0 && dragFactor <= 1)) {
    throw new PhysicsError('a draft multiplier is in (0, 1]');
  }
  // `1 × area` is `area` exactly, so riding alone is `ridingCoefficients(position)` to the bit.
  return {
    totalMass: kilograms(athleteMass + BICYCLE_MASS_KILOGRAMS),
    airDensityKilogramsPerCubicMetre: SEA_LEVEL_AIR_DENSITY,
    coefficients: {
      ...withDragArea(dragFactor * RIDING_POSITION_DRAG_AREAS[position]),
      rollingResistanceCoefficient: ROAD_ROLLING_RESISTANCE_COEFFICIENT,
    },
  };
}

/**
 * The version of this package's **answer** — ADR 0028 D-2 rule 5.
 *
 * A room re-simulates every rider and its position is the one that counts, so
 * a client whose arithmetic differs from the room's would be raced on a
 * different bicycle without either side knowing. This number travels in the
 * handshake (`@onyourleft/protocol`'s `hello`), and a room refuses a client
 * that does not share it.
 *
 * ⚠️ **Bump it in the same commit as any change that moves a vector in
 * `agreement.test.ts`**, including the race-configuration vector. That file
 * pins this number beside the vectors it versions, so the two are read and
 * changed together.
 *
 * **2** since #786: the draft model (`draft.ts`, ADR 0038) is part of the
 * answer a room computes, so a version-1 client — which drafts nobody — is
 * refused rather than raced on a different model.
 */
export const PHYSICS_VERSION = 2;
