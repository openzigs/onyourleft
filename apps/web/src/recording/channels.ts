// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where the recording engine meets the eight stream channels and the sensors.
 *
 * `@onyourleft/domain`'s engine is generic over a channel map because it cannot
 * import either of the two packages that already name the channels — both
 * depend on it (`packages/domain/src/recording/channels.ts` records why). This
 * file is the composition root that closes the loop: it instantiates the engine
 * at `@onyourleft/store`'s `StreamChannelValue`, so a recorded series is
 * *already* the shape the store persists, and it adapts
 * `@onyourleft/sensors`' `SensorMeasurement` into a reading.
 *
 * Both halves are one-way and both are checked by the compiler:
 *
 * - Instantiating at `StreamChannelValue` means adding a ninth channel to
 *   ADR 0011's list is a change in one place, and this file follows without
 *   being edited.
 * - `readingFor`'s `switch` is exhaustive over `SensorMeasurement`'s
 *   discriminant, so a capability added to `packages/sensors` fails to compile
 *   here rather than being silently dropped from every ride.
 */

import type { ChannelReading, ChannelOf } from '@onyourleft/domain';
import type { SensorMeasurement } from '@onyourleft/sensors';
import type { StreamChannelValue } from '@onyourleft/store';

/** A reading in the eight-channel map the store persists. */
export type RideReading = ChannelReading<StreamChannelValue>;

/** One of the eight channels, named through the engine's own accessor. */
export type RideChannel = ChannelOf<StreamChannelValue>;

/**
 * Turns a sensor measurement into a reading the recorder can merge.
 *
 * `measurement.at` is the transport's **receive** instant, which
 * `packages/sensors`' `MeasurementEnvelope` documents as the thing a recorder
 * should align samples on: almost nothing in BLE cycling telemetry carries an
 * absolute time, and the wrapping 1/1024 s counters CSC and CPS report are good
 * for an interval and useless as an instant.
 *
 * The four capabilities map to four of the eight channels. Latitude, longitude,
 * altitude and temperature have no BLE source in this milestone — they arrive
 * from geolocation (#50) and from Environmental Sensing later — and the engine
 * needs no change for them, because a channel exists the moment something is
 * observed on it.
 */
export function readingFor(measurement: SensorMeasurement): RideReading {
  switch (measurement.capability) {
    case 'heart-rate':
      return { channel: 'heartRate', value: measurement.heartRate, at: measurement.at };
    case 'power':
      return { channel: 'power', value: measurement.power, at: measurement.at };
    case 'cadence':
      return { channel: 'cadence', value: measurement.cadence, at: measurement.at };
    case 'speed':
      return { channel: 'speed', value: measurement.speed, at: measurement.at };
  }
}

/**
 * Below what ground speed the rider counts as stopped, in metres per second.
 *
 * 0.5 m/s is 1.8 km/h — slower than a walk. A trainer's simulated speed and a
 * wheel magnet both settle to a small non-zero value rather than to exactly
 * zero, so a threshold of `> 0` would keep a stationary ride recording forever.
 */
export const MOVEMENT_SPEED_THRESHOLD_METRES_PER_SECOND = 0.5;

/**
 * Below what cadence the rider counts as stopped, in revolutions per minute.
 *
 * Cadence is a second movement signal because an indoor ride on a trainer that
 * reports no speed at all is still a ride, and because a rider soft-pedalling
 * downhill at a red light is not. One revolution per minute is the smallest
 * non-zero value the unit admits.
 */
export const MOVEMENT_CADENCE_THRESHOLD_RPM = 1;

/** How long without a movement signal before the recorder pauses itself. */
export const DEFAULT_AUTO_PAUSE_AFTER_SECONDS = 10;

/**
 * Whether a reading is evidence the rider is moving.
 *
 * Deliberately **not** power: an ERG-mode trainer reports a power target while
 * a rider is off the bike getting a drink, and a crank-based meter reports the
 * torque of a bike being wheeled. Speed and cadence are the two signals that
 * mean movement, and either alone is enough — a trainer supplies one and a
 * bare crank sensor the other.
 */
export function isMovingReading(reading: RideReading): boolean {
  switch (reading.channel) {
    case 'speed':
      return reading.value > MOVEMENT_SPEED_THRESHOLD_METRES_PER_SECOND;
    case 'cadence':
      return reading.value >= MOVEMENT_CADENCE_THRESHOLD_RPM;
    default:
      return false;
  }
}

/**
 * What the camera says about whether anybody is on the bike — #390.
 *
 * ⚠️ **Three answers, not two**, and the third is the one that matters most:
 * `unknown` is *"the camera could not tell"* — a dark room, a lens pointing at
 * a wall, a camera that is off, throttled or was never allowed — and it is not
 * `absent`. Collapsing the two is how a rider mid-interval gets paused because
 * somebody switched a light off.
 */
export type RiderPresence = 'present' | 'absent' | 'unknown';

/**
 * The movement predicate, with the camera's answer folded in — #390.
 *
 * ⚠️ **This is advisory to the ONE auto-pause, not a second pauser.** The only
 * thing in the program that pauses a ride on its own is
 * `packages/domain`'s recording engine, when no reading has been movement for
 * {@link DEFAULT_AUTO_PAUSE_AFTER_SECONDS}. This does not pause anything and
 * holds no timer: it takes one thing away — while the camera is sure nobody is
 * there, a reading stops *counting* as movement — and the engine then does
 * what it always does. `recording/one-pauser.test.ts` asserts that shape by
 * name, because two independent pausers is the arrangement that produces a
 * ride which pauses and resumes in a loop.
 *
 * The defect it answers is `CLAUDE.md` §8's converse: an ERG-mode trainer
 * holds a power target at a rider who is not there, and reports a speed that
 * is the flywheel it is spinning, so {@link isMovingReading} says "moving" for
 * as long as the rider is off getting a drink.
 *
 * - `absent` → no reading is movement. The engine pauses after its own
 *   interval, and an automatic pause is not woken by the trainer's speed.
 * - `present` and `unknown` → exactly {@link isMovingReading}. ⚠️ **`unknown`
 *   never pauses**, and `present` never keeps a ride going that the existing
 *   rule would pause — the camera can only ever remove evidence, never add it.
 *
 * `presence` is read on every reading rather than captured once, because it
 * changes during a ride; it is a function so this module holds no state.
 */
export function presenceAwareMovement(
  presence: () => RiderPresence,
): (reading: RideReading) => boolean {
  return (reading) => presence() !== 'absent' && isMovingReading(reading);
}
