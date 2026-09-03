// SPDX-License-Identifier: Apache-2.0

/**
 * The guarantees this package makes at **compile** time.
 *
 * Every case is a `// @ts-expect-error` over something that must not typecheck.
 * The directive is the assertion: if the line ever starts to compile, TypeScript
 * reports `TS2578: Unused '@ts-expect-error' directive`, `pnpm run typecheck`
 * fails and CI fails with it. This file is inside
 * `packages/sensors/tsconfig.json`'s program, so that is not hypothetical.
 *
 * The `expect(...)` calls are deliberately *not* the assertion. Several of them
 * pin the fact that the rejected line would have produced a plausible wrong
 * value — a power of 210 that was never validated, a heart rate read off a
 * power measurement — which is what makes the compile error worth having.
 *
 * Verified the way CLAUDE.md §5 requires: by removing the brand or the type from
 * the declaration under test and confirming the suite goes red with TS2578,
 * against a clean working tree. The mutation list is in the pull request.
 */

import { beatsPerMinute, metresPerSecond, unixSeconds, watts } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  deviceId,
  isMeasurementOf,
  WEB_BLUETOOTH,
  type DeviceIdentity,
  type HeartRateMeasurement,
  type MeasurementFor,
  type PowerMeasurement,
  type SensorDevice,
} from './index';

const identity: DeviceIdentity = { transport: WEB_BLUETOOTH, id: deviceId('trainer') };

const aPowerMeasurement: PowerMeasurement = {
  capability: 'power',
  device: identity,
  at: unixSeconds(1_800_000_000),
  power: watts(210),
};

describe('an identity cannot be assembled from unlabelled strings', () => {
  it('does not accept a bare string as a device id', () => {
    const wrong: DeviceIdentity = {
      transport: WEB_BLUETOOTH,
      // @ts-expect-error an id read out of storage has not been labelled, and the label is what records which stack issued it
      id: 'DdaWNVCJUqIGdgJDN0hnbQ==',
    };
    expect(wrong.id).toBe('DdaWNVCJUqIGdgJDN0hnbQ==');
  });

  it('does not accept a transport id where a device id belongs', () => {
    const wrong: DeviceIdentity = {
      transport: WEB_BLUETOOTH,
      // @ts-expect-error a transport id and a device id are both opaque strings and are not interchangeable
      id: WEB_BLUETOOTH,
    };
    expect(wrong.id).toBe('web-bluetooth');
  });

  it('accepts the same strings once they have been labelled', () => {
    expect(identity.id).toBe('trainer');
    expect(identity.transport).toBe('web-bluetooth');
  });
});

describe('no raw number crosses the measurement boundary', () => {
  it('does not accept an unvalidated number as power', () => {
    const wrong: PowerMeasurement = {
      capability: 'power',
      device: identity,
      at: unixSeconds(1_800_000_000),
      // @ts-expect-error a decoded sint16 is a number until watts() has validated it
      power: 210,
    };
    // The point of the directive: the wrong version is perfectly plausible.
    expect(wrong.power).toBe(210);
  });

  it('does not accept a quantity in the wrong unit', () => {
    const wrong: PowerMeasurement = {
      capability: 'power',
      device: identity,
      at: unixSeconds(1_800_000_000),
      // @ts-expect-error a speed is not a power, however alike the numbers look
      power: metresPerSecond(210),
    };
    expect(wrong.power).toBe(210);
  });

  it('does not accept an unvalidated number as an instant', () => {
    const wrong: PowerMeasurement = {
      capability: 'power',
      device: identity,
      // @ts-expect-error milliseconds and seconds are both numbers; only one of them is a UnixSeconds
      at: 1_800_000_000_000,
      power: watts(210),
    };
    expect(wrong.at).toBe(1_800_000_000_000);
  });

  it('does not accept a heart rate where a power belongs', () => {
    const wrong: PowerMeasurement = {
      capability: 'power',
      device: identity,
      at: unixSeconds(1_800_000_000),
      // @ts-expect-error 142 bpm is a plausible power reading and is not one
      power: beatsPerMinute(142),
    };
    expect(wrong.power).toBe(142);
  });
});

describe('a measurement is narrowed by its capability', () => {
  it('does not let a power measurement be read as a heart rate', () => {
    const measurement: MeasurementFor<'power'> = aPowerMeasurement;
    // @ts-expect-error a power measurement has no heart-rate field to read
    expect(measurement.heartRate).toBeUndefined();
  });

  it('does not accept a power measurement where a heart-rate one is required', () => {
    // @ts-expect-error the discriminant does not match, so neither does the payload
    const wrong: HeartRateMeasurement = aPowerMeasurement;
    expect(wrong.capability).toBe('power');
  });

  it('does let the matching field be read with no narrowing at the call site', () => {
    const measurement: MeasurementFor<'power'> = aPowerMeasurement;
    expect(measurement.power).toBe(210);
  });
});

describe('trainer control is not a measurement stream', () => {
  it('cannot be used where a measurement capability is required', () => {
    // @ts-expect-error trainer-control carries no measurements; its command surface is #43
    expect(isMeasurementOf(aPowerMeasurement, 'trainer-control')).toBe(false);
  });

  it('can still be held in a capability set alongside the measurement ones', () => {
    const trainer: SensorDevice = {
      identity,
      capabilities: new Set(['power', 'cadence', 'trainer-control']),
    };
    expect(trainer.capabilities.has('trainer-control')).toBe(true);
  });
});
