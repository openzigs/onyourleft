// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The composition root's two jobs: turning a sensor measurement into a reading,
 * and deciding what counts as movement.
 *
 * Both are small and both are the kind of code a wrong line survives in
 * silently — a cadence written into the speed channel is a plausible number in
 * a plausible place, and an `isMoving` that answers `true` for power turns
 * auto-pause off for every ERG ride in the product.
 */

import {
  beatsPerMinute,
  metresPerSecond,
  revolutionsPerMinute,
  unixSeconds,
  watts,
} from '@onyourleft/domain';
import { deviceId, WEB_BLUETOOTH, type SensorMeasurement } from '@onyourleft/sensors';
import { describe, expect, it } from 'vitest';

import {
  isMovingReading,
  MOVEMENT_CADENCE_THRESHOLD_RPM,
  MOVEMENT_SPEED_THRESHOLD_METRES_PER_SECOND,
  readingFor,
} from './channels';

const AT = unixSeconds(1_700_000_000);
const DEVICE = { id: deviceId('sensor-1'), transport: WEB_BLUETOOTH } as const;

describe('a measurement becomes a reading on the right channel', () => {
  it('maps each capability to its own channel, carrying the value and the instant', () => {
    const cases: readonly [SensorMeasurement, string, number][] = [
      [
        { capability: 'heart-rate', device: DEVICE, at: AT, heartRate: beatsPerMinute(150) },
        'heartRate',
        150,
      ],
      [{ capability: 'power', device: DEVICE, at: AT, power: watts(240) }, 'power', 240],
      [
        { capability: 'cadence', device: DEVICE, at: AT, cadence: revolutionsPerMinute(90) },
        'cadence',
        90,
      ],
      [{ capability: 'speed', device: DEVICE, at: AT, speed: metresPerSecond(9.5) }, 'speed', 9.5],
    ];

    for (const [measurement, channel, value] of cases) {
      const reading = readingFor(measurement);
      expect(reading.channel).toBe(channel);
      expect(reading.value).toBe(value);
      expect(reading.at).toBe(AT);
    }
  });

  it('carries the transport’s receive instant, not a fresh one', () => {
    const earlier = unixSeconds(1_600_000_000);
    const reading = readingFor({
      capability: 'power',
      device: DEVICE,
      at: earlier,
      power: watts(200),
    });
    expect(reading.at).toBe(earlier);
  });
});

describe('what counts as movement', () => {
  it('treats a speed above the threshold as movement and one below it as not', () => {
    const above = MOVEMENT_SPEED_THRESHOLD_METRES_PER_SECOND + 0.01;
    expect(isMovingReading({ channel: 'speed', value: metresPerSecond(above), at: AT })).toBe(true);
    // A trainer's simulated speed and a wheel magnet both settle to a small
    // non-zero value, so `> 0` would keep a stationary ride recording forever.
    expect(
      isMovingReading({
        channel: 'speed',
        value: metresPerSecond(MOVEMENT_SPEED_THRESHOLD_METRES_PER_SECOND),
        at: AT,
      }),
    ).toBe(false);
    expect(isMovingReading({ channel: 'speed', value: metresPerSecond(0), at: AT })).toBe(false);
  });

  it('treats any cadence at all as movement, because an indoor ride reports no speed', () => {
    expect(
      isMovingReading({
        channel: 'cadence',
        value: revolutionsPerMinute(MOVEMENT_CADENCE_THRESHOLD_RPM),
        at: AT,
      }),
    ).toBe(true);
    expect(isMovingReading({ channel: 'cadence', value: revolutionsPerMinute(0), at: AT })).toBe(
      false,
    );
  });

  it('does not treat power as movement — an ERG trainer holds a target for an empty bike', () => {
    expect(isMovingReading({ channel: 'power', value: watts(250), at: AT })).toBe(false);
  });

  it('does not treat heart rate as movement — a strap reports a resting rider', () => {
    expect(isMovingReading({ channel: 'heartRate', value: beatsPerMinute(160), at: AT })).toBe(
      false,
    );
  });
});
