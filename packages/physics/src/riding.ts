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

import type { PhysicsCoefficients } from './coefficients';
import { withDragArea } from './coefficients';

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
 */
export const PHYSICS_VERSION = 1;
