// SPDX-License-Identifier: Apache-2.0

/**
 * The Cycling Power Feature characteristic is **read when the link comes up**
 * (#134 part 1, and #42's sixth criterion).
 *
 * ## The defect this closes
 *
 * `CYCLING_POWER_FEATURE` (`0x2A65`) was defined, exported, and never read.
 * A device's capability set came from which *characteristics* it served, so any
 * meter serving Cycling Power Measurement had `cadence` claimed on its behalf —
 * including a single-sided crank meter that cannot report it and never will.
 *
 * #134 states the consequence, and it is the reason this is worth a read rather
 * than being left to the frames: with only per-frame flags to go on, **"this
 * meter has no cadence" and "cadence dropped out" are the same observation.**
 * A meter that reports crank revolutions only while the crank turns is
 * indistinguishable from one that cannot report them at all, so a screen either
 * offers a number that will never arrive or hides one that would.
 *
 * ## ⚠️ The mutation #134 names, and why the obvious test does not catch it
 *
 * > *the mutation to run is **skip the read and fall back to flags**, which
 * > must go red. A test that merely asserts the parse of a Feature value it
 * > constructed itself does not prove the read happened.*
 *
 * So every assertion below goes through the **transport**, against a scripted
 * device whose Feature value disagrees with what the profile would claim on its
 * own. `decodeCyclingPowerFeature` already had unit tests and they all passed
 * while nothing read the characteristic.
 */

import { describe, expect, it } from 'vitest';

import {
  createCyclingPowerProfile,
  CYCLING_POWER_FEATURE,
  CYCLING_POWER_MEASUREMENT,
  CYCLING_POWER_SERVICE,
} from '../../protocol/src/index';

import type { GattProfile } from './profile';

import { createFakeBluetooth, type FakeDeviceSpec } from './testing/fake-bluetooth';
import { createWebBluetoothTransport } from './transport';

import type { Metres } from '@onyourleft/domain';
import type { SensorMeasurement } from '../../src/measurement';

/** A Cycling Power Feature value with the given bits set. */
function featureValue(...bits: readonly number[]): Uint8Array {
  const flags = bits.reduce((mask, bit) => mask | (1 << bit), 0);
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, flags, true);
  return bytes;
}

/** Bit 2 is wheel revolution data; bit 3 is crank revolution data. */
const WHEEL_DATA = 2;
const CRANK_DATA = 3;

/**
 * A power meter serving Cycling Power, with a scripted Feature value.
 *
 * @param feature the bytes `0x2A65` answers with, or `undefined` for a device
 * that serves Measurement and not Feature — out of specification, and common.
 */
function powerMeter(feature: Uint8Array | undefined, id = 'meter'): FakeDeviceSpec {
  return {
    id,
    name: 'STUB METER 7A1C',
    services: [
      {
        uuid: CYCLING_POWER_SERVICE,
        characteristics:
          feature === undefined
            ? [CYCLING_POWER_MEASUREMENT]
            : [CYCLING_POWER_MEASUREMENT, CYCLING_POWER_FEATURE],
        ...(feature === undefined ? {} : { readValues: { [CYCLING_POWER_FEATURE]: feature } }),
      },
    ],
  };
}

function fixture(device: FakeDeviceSpec, wheelCircumference?: Metres) {
  const fake = createFakeBluetooth({ devices: [device] });
  const transport = createWebBluetoothTransport({
    profiles: [
      createCyclingPowerProfile(wheelCircumference === undefined ? {} : { wheelCircumference }),
    ],
    bluetooth: fake.bluetooth,
    hasUserActivation: () => true,
  });
  return { ...fake, transport };
}

describe('the device’s own declaration decides what it supplies', () => {
  it('a meter declaring NO crank data does not claim cadence', async () => {
    // ⚠️ The whole issue in one assertion. The profile declares `cadence`, the
    // Measurement characteristic is present, and before #134 that was enough:
    // this meter reported a cadence capability it can never satisfy.
    const { transport } = fixture(powerMeter(featureValue()));
    const device = await transport.discover({ capabilities: [] });

    await transport.connect(device.identity.id);

    expect(new Set(device.capabilities)).toEqual(new Set(['power']));
  });

  it('a meter declaring crank data does claim cadence, so the gate is not simply shut', async () => {
    const { transport } = fixture(powerMeter(featureValue(CRANK_DATA)));
    const device = await transport.discover({ capabilities: [] });

    await transport.connect(device.identity.id);

    expect(new Set(device.capabilities)).toEqual(new Set(['power', 'cadence']));
  });

  it('reads the Feature characteristic exactly once per link', async () => {
    // "Read once when the link comes up." A read per notification would be a
    // GATT operation per second per device, on a queue #40 bounds deliberately.
    const { transport, bench } = fixture(powerMeter(featureValue(CRANK_DATA)));
    const device = await transport.discover({ capabilities: [] });

    await transport.connect(device.identity.id);

    // `operations` is a flat `deviceId:operation:subject` log, which is what
    // makes "exactly once" observable rather than inferred from a spy.
    const reads = bench.operations.filter(
      (operation) => operation === `meter:readValue:${CYCLING_POWER_FEATURE}`,
    );
    expect(reads).toHaveLength(1);
  });
});

describe('what a declaration cannot do', () => {
  it('cannot widen a profile past what it can decode', async () => {
    // The device declares wheel revolution data, but the rider has told us no
    // wheel circumference — so revolutions are not a speed and the profile
    // never declared `speed` in the first place. Intersecting rather than
    // substituting is what stops a Feature value inventing a capability
    // nothing in this program can supply.
    const { transport } = fixture(powerMeter(featureValue(WHEEL_DATA, CRANK_DATA)));
    const device = await transport.discover({ capabilities: [] });

    await transport.connect(device.identity.id);

    expect(new Set(device.capabilities)).toEqual(new Set(['power', 'cadence']));
  });

  it('supplies speed when the device declares wheel data AND a circumference is known', async () => {
    const { transport } = fixture(
      powerMeter(featureValue(WHEEL_DATA, CRANK_DATA)),
      2.096 as Metres,
    );
    const device = await transport.discover({ capabilities: [] });

    await transport.connect(device.identity.id);

    expect(new Set(device.capabilities)).toEqual(new Set(['power', 'cadence', 'speed']));
  });
});

describe('the intersection, which no shipped profile can currently exercise', () => {
  /**
   * A profile whose `declared` over-claims: it decodes power only, and answers
   * that the device can also supply heart rate.
   *
   * ⚠️ **This exists because the guard was otherwise unreachable.** Mutating
   * the intersection to a substitution turned *nothing* red against the four
   * shipped profiles, because `cyclingPowerCapabilities` already returns a
   * subset of what `createCyclingPowerProfile` declares — the same wheel
   * circumference rule is applied in both places. `transport.ts`'s `accepts`
   * records the same smell in this package's own words: "a mutation that
   * deleted the fourth check turned nothing red, which is what a check with
   * nothing behind it looks like".
   *
   * `describe.declared` is a seam any future profile fills, so the guard is
   * worth keeping — and worth making real rather than decorative.
   */
  const overclaimingProfile: GattProfile = {
    service: CYCLING_POWER_SERVICE,
    characteristic: CYCLING_POWER_MEASUREMENT,
    capabilities: ['power'],
    describe: {
      characteristic: CYCLING_POWER_FEATURE,
      declared: () => ['power', 'heart-rate'],
    },
    decode: () => undefined,
  };

  it('ignores a declaration naming a capability the profile cannot decode', async () => {
    const fake = createFakeBluetooth({ devices: [powerMeter(featureValue())] });
    const transport = createWebBluetoothTransport({
      profiles: [overclaimingProfile],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
    });
    const device = await transport.discover({ capabilities: [] });

    await transport.connect(device.identity.id);

    // Not `heart-rate`, whatever the device said: a capability nothing can
    // supply would put a control on screen that never produces a number.
    expect(new Set(device.capabilities)).toEqual(new Set(['power']));
  });
});

describe('a device that will not answer keeps the profile’s full list', () => {
  it('serves Measurement and not Feature — out of spec, and common', async () => {
    // Refusing such a device every capability would be a worse answer than
    // trusting the profile: it works today, and it would stop working.
    const { transport } = fixture(powerMeter(undefined));
    const device = await transport.discover({ capabilities: [] });

    await transport.connect(device.identity.id);

    expect(new Set(device.capabilities)).toEqual(new Set(['power', 'cadence']));
  });

  it('answers with bytes too short to be a Feature value', async () => {
    // The decoder throws; the adapter reads that as "unreadable" rather than as
    // "declares nothing". A hostile or broken device must not be able to strip
    // a capability by answering badly (SECURITY.md: sensor data is untrusted).
    const { transport } = fixture(powerMeter(new Uint8Array([0x01, 0x02])));
    const device = await transport.discover({ capabilities: [] });

    await transport.connect(device.identity.id);

    expect(new Set(device.capabilities)).toEqual(new Set(['power', 'cadence']));
  });
});

/**
 * A Cycling Power Measurement frame carrying power and crank revolution data.
 *
 * Flags bit 5 is Crank Revolution Data Present. The layout is flags (`uint16`),
 * instantaneous power (`sint16`), then cumulative crank revolutions (`uint16`)
 * and last crank event time (`uint16`, 1/1024 s).
 */
function frameWithCrank(power: number, revolutions: number, eventTime: number): Uint8Array {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 1 << 5, true);
  view.setInt16(2, power, true);
  view.setUint16(4, revolutions, true);
  view.setUint16(6, eventTime, true);
  return bytes;
}

/** Let every queued microtask run. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('a device that disagrees with itself — #134’s third checkbox', () => {
  it('records a capability the device DELIVERED without DECLARING', async () => {
    // ⚠️ The regression this half exists to catch is the one the other half
    // introduces. Narrowing on the declaration is right, and it means a meter
    // that under-declares itself silently loses a measurement it was sending.
    // "Recorded rather than silently resolved" is what stops that being
    // invisible.
    const { transport, bench } = fixture(powerMeter(featureValue()));
    const device = await transport.discover({ capabilities: [] });
    await transport.connect(device.identity.id);

    expect([...device.undeclared]).toEqual([]);

    // ⚠️ Subscribed, because notifications only start once something is
    // listening — the adapter does not call `startNotifications` for a
    // characteristic nobody wants. A test that skipped this would emit frames
    // into a handler that is not running and conclude, wrongly, that nothing
    // was recorded.
    await transport.subscribe(device.identity.id, 'power', () => undefined);

    // Two frames, because cadence is a difference between two crank readings.
    bench
      .device('meter')
      .notify(CYCLING_POWER_SERVICE, CYCLING_POWER_MEASUREMENT, frameWithCrank(200, 10, 1024));
    await settle();
    bench
      .device('meter')
      .notify(CYCLING_POWER_SERVICE, CYCLING_POWER_MEASUREMENT, frameWithCrank(200, 11, 2048));
    await settle();

    expect([...device.undeclared]).toEqual(['cadence']);
  });

  it('does NOT act on it — the frame stays dropped', async () => {
    // Trusting the frame would put back exactly the ambiguity the Feature read
    // removes: a meter reporting crank data only while the crank turns would
    // again be indistinguishable from one that cannot report it.
    const { transport, bench } = fixture(powerMeter(featureValue()));
    const device = await transport.discover({ capabilities: [] });
    await transport.connect(device.identity.id);

    const seen: SensorMeasurement[] = [];
    await transport.subscribe(device.identity.id, 'power', (m) => seen.push(m));
    bench
      .device('meter')
      .notify(CYCLING_POWER_SERVICE, CYCLING_POWER_MEASUREMENT, frameWithCrank(200, 10, 1024));
    await settle();
    bench
      .device('meter')
      .notify(CYCLING_POWER_SERVICE, CYCLING_POWER_MEASUREMENT, frameWithCrank(200, 11, 2048));
    await settle();

    // Power arrives; the undeclared cadence does not, and `capabilities` is
    // unchanged — the record is a note, not a promotion.
    // Non-empty first: `every` over an empty array is vacuously true, so the
    // count is what makes the assertion below mean anything.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((measurement) => measurement.capability === 'power')).toBe(true);
    expect(new Set(device.capabilities)).toEqual(new Set(['power']));
  });

  it('says nothing about a device that agrees with itself', async () => {
    // The set is empty for almost every device, which is what makes a non-empty
    // one worth surfacing.
    const { transport, bench } = fixture(powerMeter(featureValue(CRANK_DATA)));
    const device = await transport.discover({ capabilities: [] });
    await transport.connect(device.identity.id);
    await transport.subscribe(device.identity.id, 'power', () => undefined);

    bench
      .device('meter')
      .notify(CYCLING_POWER_SERVICE, CYCLING_POWER_MEASUREMENT, frameWithCrank(200, 10, 1024));
    await settle();
    bench
      .device('meter')
      .notify(CYCLING_POWER_SERVICE, CYCLING_POWER_MEASUREMENT, frameWithCrank(200, 11, 2048));
    await settle();

    expect([...device.undeclared]).toEqual([]);
  });
});
