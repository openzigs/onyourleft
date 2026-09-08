// SPDX-License-Identifier: Apache-2.0

/**
 * `@onyourleft/physics` — the cycling power/speed model of Martin et al. 1998,
 * as separately testable terms.
 *
 * Pure computation. This package depends on **no rendering, BLE or platform
 * API**: `tsconfig.json` narrows `lib` to ES2024 and empties `types`, and
 * `eslint.config.js` closes the two gaps that narrowing leaves — the module
 * specifiers a `lib` cannot see, and `Date` and `Math.random`, which are
 * ECMAScript built-ins and therefore survive it. See docs/architecture.md and
 * `README.md`.
 *
 * Everything the rest of the program uses is re-exported here, so a consumer
 * imports from `@onyourleft/physics` and never from a file inside it.
 *
 * ```ts
 * // What does 250 W get me up a 5 % climb?
 * const speed = steadyStateSpeedMetresPerSecond({
 *   powerWatts: 250,
 *   totalMass: kilograms(82),
 *   grade: gradePercent(5),
 *   airDensityKilogramsPerCubicMetre: airDensityKilogramsPerCubicMetre(
 *     altitudeMetres(0),
 *     degreesCelsius(15),
 *   ),
 * });
 *
 * // Where am I a second after starting to push?
 * const next = advance(START_OF_RIDE, { power, grade, duration }, conditions);
 * ```
 */

// --- Errors -----------------------------------------------------------------

export { PhysicsError } from './physics-error';

// --- Constants --------------------------------------------------------------

export {
  GRAVITY_METRES_PER_SECOND_SQUARED,
  gradeRatio,
  PERCENT_PER_UNIT_RATIO,
  STANDARD_GRAVITY_METRES_PER_SECOND_SQUARED,
} from './constants';

// --- Coefficients: the six tunables, and the three Martin's equations add ---

export type { PhysicsCoefficients } from './coefficients';
export {
  DEFAULT_COEFFICIENTS,
  dragAreaSquareMetres,
  drivetrainEfficiency,
  MARTIN_1998_COEFFICIENTS,
  withDefaultCoefficients,
  withDragArea,
} from './coefficients';

// --- Air density ------------------------------------------------------------

export {
  airDensityKilogramsPerCubicMetre,
  ISO_2533_GAS_CONSTANT_JOULES_PER_MOLE_KELVIN,
  MOLAR_MASS_OF_DRY_AIR_KILOGRAMS_PER_MOLE,
  SEA_LEVEL_STANDARD_PRESSURE_PASCALS,
  SEA_LEVEL_STANDARD_TEMPERATURE_KELVIN,
  standardAtmospherePressurePascals,
  TROPOSPHERE_CEILING_METRES,
  TROPOSPHERIC_LAPSE_RATE_KELVIN_PER_METRE,
} from './air';

// --- The force balance, one function per term -------------------------------

export type { ResistiveForces } from './terms';
export {
  aerodynamicDragForceNewtons,
  airSpeedMetresPerSecond,
  bearingFrictionForceNewtons,
  effectiveMassKilograms,
  gravityForceNewtons,
  resistiveForces,
  rollingResistanceForceNewtons,
} from './terms';

// --- Power required, and its inverse at equilibrium -------------------------

export type {
  PowerRequirement,
  PowerRequirementInput,
  SteadyStateInput,
  VelocityChange,
} from './power';
export { powerRequired, steadyStateSpeedMetresPerSecond } from './power';

// --- The tick ---------------------------------------------------------------

export type { RideConditions, RideState, RideStep } from './simulate';
export {
  advance,
  DEFAULT_INTEGRATION_STEP_SECONDS,
  MAXIMUM_SUB_STEPS_PER_TICK,
  START_OF_RIDE,
} from './simulate';

// --- The bot pacer's rider (#92) --------------------------------------------
//
// The synthetic rider `@onyourleft/domain`'s pacing rule paces. It computes no
// speed of its own: it calls `advance` above, which is what makes "the bot goes
// through the same physics model as the rider" a fact about the call graph
// rather than a claim in a comment. Nothing in its inputs is a recorded ride —
// see `pacer.ts`'s header and ADR 0007 D4.

export type { BotCourse, BotPacerDriver, BotTick } from './pacer';
export { advanceBot, BOT_AT_START_LINE, botDemand, createBotPacer } from './pacer';
