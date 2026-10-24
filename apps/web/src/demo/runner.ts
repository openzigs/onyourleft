// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The demo ride: every scripted rider in a preset, moved through the same
 * physics tick as a real rider — #1646.
 *
 * ## The same tick, and nothing else
 *
 * `packages/physics/src/pacer.ts` §`advanceBot` is the precedent: a bot does not
 * compute a speed, it calls `advance`, the one tick in `@onyourleft/physics`,
 * because "a bot on separate maths will diverge visibly on gradients and
 * destroy the illusion". Each demo rider here does the same — power from its
 * script, gradient from the preset's road at its own odometer, mass
 * `BOT_MASS_KILOGRAMS` — and `runner.test.ts` replaces `advance` with a
 * sentinel and requires the riders' distances to change, so a rider with its
 * own speed maths fails it.
 *
 * ## No clock, and no recorded ride
 *
 * Time arrives as a parameter to {@link DemoRide.sample}, as in
 * `pacer/pacing.ts`. The same sequence of `Seconds` gives byte-identical
 * frames, which `runner.test.ts` pins with a SHA-256 digest. The only inputs
 * are a preset's authored scalars (`script.ts`, ADR 0007 D4): the road is built
 * from `{ lengthMetres, gradePercent }` sections, laid due east from the
 * equator at the prime meridian so that it is visibly nowhere anybody rode.
 *
 * ## The lead rider is the HUD's
 *
 * `GameSimulation` has one pacer slot and this does not widen it. The first
 * rider is the lead and fills a {@link GameSensors}, always `live` and `paired`
 * — a demo never shows "Sensor lost". The others are reported alongside for a
 * renderer to draw as markers.
 */

import type { GradePercent, RouteProfile, RoutePoint, Seconds, Watts } from '@onyourleft/domain';
import {
  altitudeMetres,
  BOT_MASS_KILOGRAMS,
  degreesCelsius,
  degreesLatitude,
  degreesLongitude,
  distanceOnRoute,
  geographicPosition,
  gradeAt,
  kilograms,
  metres,
  metresPerSecond,
  routeProfile,
  seconds,
} from '@onyourleft/domain';
import type { RideConditions, RideState } from '@onyourleft/physics';
import { advance, airDensityKilogramsPerCubicMetre } from '@onyourleft/physics';

import type { GameSensors } from '../game/sensors';
import type { DemoKit, DemoPreset, RiderScript, RouteSection } from './script';
import { scriptedSample } from './script';

/** The spacing of the points a preset's road is laid out on. */
const ROUTE_POINT_SPACING_METRES = 10;

/** Metres per degree of longitude on the equator (WGS-84 mean radius, as `pacer.test.ts`). */
const METRES_PER_DEGREE_AT_EQUATOR = 111_194.9;

/** The height the road starts at. Any number would do; it is not a place. */
const ROAD_START_ALTITUDE_METRES = 100;

/**
 * Lay a preset's sections out as a road due east along the equator.
 *
 * ⚠️ `route/profile.ts` fits each gradient over a 100 m window, so a section
 * reads its nominal gradient only half a window in from either end. A preset's
 * sections are long enough for that, and `runner.test.ts` reads the gradient
 * the rider was actually on rather than the nominal one.
 */
export function demoRouteProfile(sections: readonly RouteSection[]): RouteProfile {
  const points: RoutePoint[] = [];
  let distance = 0;
  let elevation = ROAD_START_ALTITUDE_METRES;
  const push = (): void => {
    points.push({
      position: geographicPosition(
        degreesLatitude(0),
        degreesLongitude(distance / METRES_PER_DEGREE_AT_EQUATOR),
      ),
      elevation: altitudeMetres(elevation),
    });
  };
  push();
  for (const section of sections) {
    const steps = Math.round(section.lengthMetres / ROUTE_POINT_SPACING_METRES);
    for (let step = 0; step < steps; step += 1) {
      distance += ROUTE_POINT_SPACING_METRES;
      elevation += (ROUTE_POINT_SPACING_METRES * section.gradePercent) / 100;
      push();
    }
  }
  return routeProfile(points);
}

/** One scripted rider at one instant. */
export interface DemoRiderTick {
  readonly label: string;
  readonly kit: DemoKit;
  /** Speed and odometer, in the same type the rider's own ride reports. */
  readonly state: RideState;
  /** The gradient under the rider when this interval began, as the tick used it. */
  readonly grade: GradePercent;
  readonly watts: Watts;
  readonly cadence: number;
  /** A scripted number, labelled as such by the overlay (#1650). Not a reading. */
  readonly heartRate: number;
}

/** Every rider in a preset at one ride time. */
export interface DemoFrame {
  readonly rideSeconds: Seconds;
  /** The lead rider's numbers, as the game reads a real rider's: always live, always paired. */
  readonly lead: GameSensors;
  /** Every rider, the lead first. */
  readonly riders: readonly DemoRiderTick[];
}

/** A preset being ridden. */
export interface DemoRide {
  /** The preset's road, for a renderer to draw. */
  readonly profile: RouteProfile;
  /**
   * Advance every rider to this ride time and report them.
   *
   * A time that is not after the last advances nothing and returns the last
   * frame: a clock that went backwards must not wind the riders back.
   */
  sample(rideSeconds: Seconds): DemoFrame;
  /** The last frame, without advancing. */
  current(): DemoFrame;
}

const AIR_DENSITY = airDensityKilogramsPerCubicMetre(altitudeMetres(0), degreesCelsius(15));

const CONDITIONS: RideConditions = {
  totalMass: kilograms(BOT_MASS_KILOGRAMS),
  airDensityKilogramsPerCubicMetre: AIR_DENSITY,
};

function tickFor(
  script: RiderScript,
  state: RideState,
  grade: GradePercent,
  rideSeconds: Seconds,
): DemoRiderTick {
  const sample = scriptedSample(script, rideSeconds);
  return {
    label: script.label,
    kit: script.kit,
    state,
    grade,
    watts: sample.watts,
    cadence: sample.cadence,
    heartRate: sample.heartRate,
  };
}

function leadSensors(lead: DemoRiderTick): GameSensors {
  return {
    rider: { power: lead.watts, live: true, paired: true },
    cadence: { value: lead.cadence, live: true, paired: true },
    heartRate: { value: lead.heartRate, live: true, paired: true },
  };
}

function frameOf(rideSeconds: Seconds, riders: readonly DemoRiderTick[]): DemoFrame {
  const lead = riders[0];
  if (lead === undefined) {
    throw new RangeError('a demo preset must have at least one rider');
  }
  return { rideSeconds, lead: leadSensors(lead), riders };
}

/**
 * Start a preset at ride time zero, every rider stationary at its start line.
 *
 * Each {@link DemoRide.sample} hands each rider's scripted power at the new
 * time, and the gradient at its current odometer, to `advance` for the
 * interval since the last sample — the shape `GameSimulation.advanceTo` gives a
 * real rider's latest reading.
 */
export function createDemoRide(preset: DemoPreset): DemoRide {
  const profile = demoRouteProfile(preset.route);
  const gradeUnder = (state: RideState): GradePercent =>
    gradeAt(profile, distanceOnRoute(profile, state.distance));

  let last = seconds(0);
  let frame = frameOf(
    last,
    preset.riders.map((script) => {
      const state: RideState = {
        speed: metresPerSecond(0),
        distance: metres(script.startMetres),
      };
      return tickFor(script, state, gradeUnder(state), last);
    }),
  );

  return {
    profile,
    sample(rideSeconds: Seconds): DemoFrame {
      if (!(rideSeconds > last)) return frame;
      const duration = seconds(rideSeconds - last);
      const riders = preset.riders.map((script, index) => {
        const before = frame.riders[index];
        if (before === undefined) throw new RangeError('a demo rider went missing');
        const grade = gradeUnder(before.state);
        const power = scriptedSample(script, rideSeconds).watts;
        const state = advance(before.state, { power, grade, duration }, CONDITIONS);
        return tickFor(script, state, grade, rideSeconds);
      });
      last = rideSeconds;
      frame = frameOf(rideSeconds, riders);
      return frame;
    },
    current: () => frame,
  };
}
