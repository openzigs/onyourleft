// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the rider rides under, and the three things #325 asks this layer to
 * prove.
 *
 * 1. **Mass has an effect at all.** The defect was that it did not: everybody
 *    rode at a hard-coded 80 kg whatever the athlete row said. So the assertion
 *    is about a *difference* — the same power on the same gradient has to
 *    produce a different speed at two different masses — and deliberately not
 *    about any particular number, which would pin the integrator's output and
 *    turn red the next time `SIMULATION_STEP_SECONDS` is tuned.
 * 2. **The bot is unmoved by it.** #92 criterion 5 and ADR 0007 D4 rest on the
 *    pacer being synthetic, and making the rider's mass dynamic makes that
 *    easier to break rather than harder. The assertion runs the *same* pacer
 *    plan against two different rider masses and requires the bot's trajectory
 *    to be bit-identical while the rider's is not.
 * 3. **Nothing moved for a rider who has said nothing.** 71 + 9 = 80, which is
 *    the constant this file used to carry, so a rider with no recorded mass
 *    rides exactly as they did before. That is a property worth pinning rather
 *    than describing, because the two halves live in different modules and
 *    either could be adjusted alone.
 */

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  botPacerPlan,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  kilograms,
  routeProfile,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';

import { MARTIN_1998_COEFFICIENTS } from '@onyourleft/physics';

import { riderMassFor } from '../athlete/mass';
import {
  DEFAULT_RIDING_POSITION,
  GAME_ROLLING_RESISTANCE_COEFFICIENT,
  RIDING_POSITIONS,
  RIDING_POSITION_ORDER,
  rideConditionsFor,
  type RidingPosition,
} from './rider';
import { GameSimulation, SIMULATION_STEP_SECONDS, type RiderInput } from './simulation';

/** What the whole client rode at before #325, as one number. */
const THE_OLD_HARD_CODED_TOTAL = 80;

/**
 * A kilometre of steady 6 % climb.
 *
 * Steady, and a climb, because that is where the defect is largest: on the flat
 * aerodynamic drag dominates and mass barely shows, so a flat fixture would
 * make a correct implementation and the broken one look almost alike. A
 * *constant* gradient is what lets "the same gradient" in #325's third
 * criterion be a fact about the fixture rather than about where each rider got
 * to.
 */
function steadyClimb(): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 100; index += 1) {
    const alongMetres = index * 10;
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + alongMetres / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(alongMetres * 0.06),
    });
  }
  return routeProfile(points);
}

const PEDALLING: RiderInput = { power: watts(250), live: true };

/** The same ride, at the same power, for the same wall-clock minute. */
function climbAt(
  riderMassKilograms: number,
  pacer?: ReturnType<typeof botPacerPlan>,
): GameSimulation {
  const simulation = new GameSimulation({
    profile: steadyClimb(),
    conditions: rideConditionsFor(kilograms(riderMassKilograms)),
    ...(pacer === undefined ? {} : { pacer }),
  });
  const startMs = 1_000_000;
  simulation.advanceTo(startMs, PEDALLING);
  simulation.advanceTo(startMs + 60_000, PEDALLING);
  return simulation;
}

describe('rideConditionsFor', () => {
  it('adds the bicycle, because the athlete row holds the athlete and the physics wants both', () => {
    // ⚠️ The mistake this is here to catch: handing `AthleteRecord.mass`
    // straight to `RideConditions.totalMass` rides a rider on no bicycle. It is
    // an error in the *opposite* direction to the one #325 fixes and it would
    // look exactly like a fix.
    const light = rideConditionsFor(kilograms(60));
    const heavy = rideConditionsFor(kilograms(90));

    expect(light.totalMass).toBeGreaterThan(60);
    expect(heavy.totalMass).toBeGreaterThan(90);
    // One for one: whatever the bicycle weighs, thirty kilograms of rider is
    // thirty kilograms of system. A bicycle that scaled with the rider would
    // pass the two lines above.
    expect(heavy.totalMass - light.totalMass).toBeCloseTo(30, 9);
  });

  it('leaves a rider who has said nothing exactly where they were', () => {
    // 71 + 9 = 80, the constant `rider.ts` used to export. The two halves live
    // in different modules — the default in `athlete/mass.ts`, the bicycle here
    // — so this is the only place the sum is checked.
    expect(rideConditionsFor(riderMassFor(undefined).mass).totalMass).toBe(
      THE_OLD_HARD_CODED_TOTAL,
    );
  });

  it('rides everybody through the same air', () => {
    // The other half of `RideConditions` is not the rider's, and a change that
    // made air density a function of mass would be nonsense that no speed
    // assertion would notice.
    expect(rideConditionsFor(kilograms(60)).airDensityKilogramsPerCubicMetre).toBe(
      rideConditionsFor(kilograms(90)).airDensityKilogramsPerCubicMetre,
    );
  });
});

describe('#325 criterion 3 — the same power on the same gradient at two masses', () => {
  it('covers different ground, which it did not before', () => {
    const light = climbAt(60);
    const heavy = climbAt(100);

    // ⚠️ `not.toBe` is the whole criterion. Before #325 both of these were
    // `rideConditionsFor` of nothing at all — a hard-coded 80 — and this
    // assertion is the one that could not have passed.
    expect(heavy.state.ride.distance).not.toBe(light.state.ride.distance);
    expect(heavy.state.ride.speed).not.toBe(light.state.ride.speed);
  });

  it('puts the lighter rider ahead, because this is a climb', () => {
    // The direction, not only the difference. A sign error in
    // `gravityForceNewtons`' caller would satisfy the case above and send the
    // heavier rider up the hill faster.
    const light = climbAt(60);
    const heavy = climbAt(100);

    expect(light.state.ride.distance).toBeGreaterThan(heavy.state.ride.distance);
  });

  it('moves the speed by an amount a rider would notice, not by a rounding', () => {
    // ⚠️ A floor rather than an exact figure. `not.toBe` above is satisfied by
    // a difference in the fifteenth decimal place, which is what a mass that
    // reached only the rotational-inertia term would produce — the gravity term
    // is the one that matters on a hill, and this is what says it is connected.
    const light = climbAt(60);
    const heavy = climbAt(100);

    expect(light.state.ride.speed - heavy.state.ride.speed).toBeGreaterThan(0.5);
  });
});

describe('#325 criterion 4 — the bot stays at its own mass', () => {
  const plan = botPacerPlan(2.5);

  it('rides the identical line whatever the rider weighs', () => {
    const light = climbAt(60, plan);
    const heavy = climbAt(100, plan);

    // ⚠️ **`toBe`, not `toBeCloseTo`.** The bot's course is built from the
    // rider's *environment* and its own mass, so the two runs integrate the
    // same arithmetic and are bit-identical. A tolerance here would admit a
    // bot that was slightly the rider's, which is exactly the failure — and
    // `simulation.ts` §`botCourseFor` is the one line that keeps it true.
    expect(heavy.state.bot?.state.distance).toBe(light.state.bot?.state.distance);
    expect(heavy.state.bot?.state.speed).toBe(light.state.bot?.state.speed);
  });

  it('is riding at all, so the case above is not two absences agreeing', () => {
    const paced = climbAt(60, plan);

    expect(paced.state.bot?.state.distance).toBeGreaterThan(0);
    expect(plan.massKilograms).toBe(75);
  });

  it('goes red if the two are ever read from one source', () => {
    // The pair. The riders differ and the bots do not, in the same two runs —
    // so a `botCourseFor` that passed `conditions.totalMass` through would turn
    // the first assertion red while leaving this one green, and nothing else in
    // this repository would notice.
    const light = climbAt(60, plan);
    const heavy = climbAt(100, plan);

    expect(heavy.state.ride.distance).not.toBe(light.state.ride.distance);
    expect(heavy.state.bot?.state.distance).toBe(light.state.bot?.state.distance);
  });

  it('runs long enough for a divergence to show', () => {
    // A guard on the fixture rather than on the code: sixty seconds at 0.05 s
    // is 1 200 steps, and a fixture that advanced zero steps would make every
    // `toBe` above pass over two start lines.
    expect(60 / SIMULATION_STEP_SECONDS).toBeGreaterThan(1000);
    expect(climbAt(60).state.ride.distance).toBeGreaterThan(0);
  });
});

describe('#365 — the rider is not a track racer unless they say so', () => {
  /**
   * A kilometre of flat road.
   *
   * ⚠️ **Flat on purpose, and the opposite purpose to {@link steadyClimb}'s.**
   * Drag scales with the square of speed and gravity does not, so the flat is
   * where the drag area is nearly the whole of the answer — a climbing fixture
   * would make a track racer and a rider sitting up look almost alike, which is
   * exactly how this defect survived #325's own suite.
   */
  function flatRoad(): ReturnType<typeof routeProfile> {
    const points: RoutePoint[] = [];
    for (let index = 0; index <= 200; index += 1) {
      points.push({
        position: geographicPosition(
          degreesLatitude(51.5 + (index * 10) / 111_320),
          degreesLongitude(-0.12),
        ),
        elevation: altitudeMetres(20),
      });
    }
    return routeProfile(points);
  }

  /**
   * Three minutes on the flat at 150 W, in one position.
   *
   * ⚠️ **Advanced in five-second steps rather than one jump**, and that is not
   * cosmetic: `MAXIMUM_STEPS_PER_ADVANCE` is 200, so a single `advanceTo` can
   * never carry more than ten seconds of road however far the clock moved. A
   * three-minute jump would leave the rider still accelerating at about
   * 19 km/h, and every speed band below would be measuring the stall guard
   * instead of the drag area.
   */
  function flatAt(position?: RidingPosition): GameSimulation {
    const simulation = new GameSimulation({
      profile: flatRoad(),
      conditions:
        position === undefined
          ? rideConditionsFor(kilograms(71))
          : rideConditionsFor(kilograms(71), position),
    });
    const startMs = 1_000_000;
    for (let at = 0; at <= 180_000; at += 5_000) {
      simulation.advanceTo(startMs + at, { power: watts(150), live: true });
    }
    return simulation;
  }

  it('sets a drag area at all, which is the whole of the defect', () => {
    // ⚠️ `RideConditions.coefficients` was `undefined` on every ride, so
    // `packages/physics` fell back to `DEFAULT_COEFFICIENTS` — Martin's
    // 0.264 m², a time-trial position on a track. This assertion is the one
    // that could not have passed.
    expect(rideConditionsFor(kilograms(71)).coefficients).toBeDefined();
  });

  it('sets it through the product, never a single factor', () => {
    // `packages/physics/README.md` §2: Martin measures the product and reports
    // only the product, the 0.88 × 0.30 split is that package's own, and a
    // single factor is "meaningless". `withDragArea` is the spelling that says
    // so, and it puts all of it in `dragCoefficient` with an area of 1.
    const coefficients = rideConditionsFor(kilograms(71), 'hoods').coefficients;
    expect(coefficients?.frontalAreaSquareMetres).toBe(1);
    expect(coefficients?.dragCoefficient).toBe(RIDING_POSITIONS.hoods.dragAreaSquareMetres);
  });

  it('is slower than the paper’s rider, and by an amount somebody reported', () => {
    // #365 measured this from the committed constants: 150 W on the flat at
    // 80 kg total gave 32.4 km/h against about 28.6 for a rider on the hoods.
    // The assertion is a *band* rather than a figure, because pinning the
    // integrator's output would turn red the next time the step is tuned.
    const kilometresPerHour = (flatAt().state.ride.speed * 3_600) / 1_000;
    expect(kilometresPerHour).toBeGreaterThan(26);
    expect(kilometresPerHour).toBeLessThan(31);
  });

  it('makes each position faster than the one above it', () => {
    const upright = flatAt('upright').state.ride.distance;
    const hoods = flatAt('hoods').state.ride.distance;
    const drops = flatAt('drops').state.ride.distance;

    expect(drops).toBeGreaterThan(hoods);
    expect(hoods).toBeGreaterThan(upright);
  });

  it('moves a rider’s speed by an amount they would read on the HUD', () => {
    // A floor, so a ladder whose rungs differ in the third decimal place — a
    // choice that is technically wired and practically inert — goes red.
    const upright = (flatAt('upright').state.ride.speed * 3_600) / 1_000;
    const drops = (flatAt('drops').state.ride.speed * 3_600) / 1_000;
    expect(drops - upright).toBeGreaterThan(1.5);
  });

  it('defaults to the hoods, so a rider who chooses nothing is a road rider', () => {
    expect(DEFAULT_RIDING_POSITION).toBe('hoods');
    expect(rideConditionsFor(kilograms(71)).coefficients).toEqual(
      rideConditionsFor(kilograms(71), 'hoods').coefficients,
    );
  });

  it('offers every position exactly once, in order of how much air is pushed', () => {
    // Fails closed: a fourth position added to the union without a line in the
    // order array is invisible on the picker, and the `Record` above only makes
    // the *lookup* total.
    expect([...RIDING_POSITION_ORDER].sort()).toEqual(Object.keys(RIDING_POSITIONS).sort());
    const areas = RIDING_POSITION_ORDER.map((id) => RIDING_POSITIONS[id].dragAreaSquareMetres);
    expect([...areas].sort((left, right) => right - left)).toEqual(areas);
  });

  it('keeps the rolling resistance off the position, because a hand is not a tyre', () => {
    // #365's third criterion, answered explicitly: chosen once for the game and
    // deliberately not per position. A table that moved `C_RR` with the hands
    // would be modelling something that is not there.
    const areas = RIDING_POSITION_ORDER.map(
      (id) => rideConditionsFor(kilograms(71), id).coefficients?.rollingResistanceCoefficient,
    );
    expect(new Set(areas).size).toBe(1);
    expect(areas[0]).toBe(GAME_ROLLING_RESISTANCE_COEFFICIENT);
  });

  it('does not ride the paper’s smooth-asphalt tyres', () => {
    // Kyle's 0.0032 is the average of ten high-pressure clinchers on asphalt
    // chosen to be smooth. `packages/physics` keeps it; the game does not.
    expect(GAME_ROLLING_RESISTANCE_COEFFICIENT).toBeGreaterThan(
      MARTIN_1998_COEFFICIENTS.rollingResistanceCoefficient,
    );
  });

  it('leaves `packages/physics` reproducing its own paper', () => {
    // ⚠️ The owner's decision on #365's open question, pinned rather than
    // described: the package keeps Martin's and the game picks its own. A later
    // change that "fixed" the defaults in `packages/physics` instead would
    // break `martin-1998.test.ts`, and this says why that is the wrong repair.
    expect(
      MARTIN_1998_COEFFICIENTS.dragCoefficient * MARTIN_1998_COEFFICIENTS.frontalAreaSquareMetres,
    ).toBeCloseTo(0.264, 6);
    expect(MARTIN_1998_COEFFICIENTS.rollingResistanceCoefficient).toBe(0.0032);
  });
});
