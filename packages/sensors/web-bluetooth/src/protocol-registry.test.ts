// SPDX-License-Identifier: Apache-2.0

/**
 * The protocol clients (#41, #42, #43) driven through the real adapter (#40).
 *
 * **This is the first consumer the profile seam has ever had**, and building it
 * is what surfaces the seam's defects rather than the decoders'. Three things
 * are checked here that no decoder test can reach:
 *
 * 1. **The UUID transcription.** The decoders carry 128-bit literals; the
 *    adapter compares canonicalised UUIDs. A literal with a transposed digit
 *    produces a sensor that pairs and then reports nothing — the hardest
 *    failure in this stack to diagnose, and one that every unit test in
 *    `protocol/` passes with, because they never resolve a characteristic.
 * 2. **The per-link accumulator.** `derivation.ts` keys its state on the sink
 *    the adapter builds, because the seam offers nothing else with the right
 *    lifetime. If that identity ever stops being stable per link, a cadence
 *    profile silently reports *no cadence at all* rather than failing — so it
 *    is checked here, through the path a rider uses, not asserted about.
 * 3. **The receive instant.** #41 added a third parameter to
 *    `GattProfile.decode`. This is where it is proved to arrive, and to be the
 *    transport's own clock rather than a decoder's.
 */

import { describe, expect, it } from 'vitest';

import { metres, unixSeconds, type UnixSeconds } from '@onyourleft/domain';

import type { SensorMeasurement } from '../../src/measurement';
import {
  BODY_SENSOR_LOCATION,
  createCyclingPowerProfile,
  createCyclingSpeedCadenceProfile,
  createIndoorBikeDataProfile,
  CSC_FEATURE,
  CSC_MEASUREMENT,
  CYCLING_POWER_FEATURE,
  CYCLING_POWER_MEASUREMENT,
  CYCLING_POWER_SENSOR_LOCATION,
  CYCLING_SPEED_CADENCE_SERVICE,
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_FEATURE,
  FITNESS_MACHINE_SERVICE,
  FITNESS_MACHINE_STATUS,
  HEART_RATE_MEASUREMENT,
  HEART_RATE_SERVICE,
  heartRateProfile,
  INDOOR_BIKE_DATA,
  SUPPORTED_POWER_RANGE,
  SUPPORTED_RESISTANCE_LEVEL_RANGE,
  CYCLING_POWER_SERVICE,
} from '../../protocol/src/index';

import { canonicalUuid } from './profile';
import { createFakeBluetooth, type FakeDeviceSpec } from './testing/fake-bluetooth';
import { createWebBluetoothTransport } from './transport';

const WHEEL_700_25C = metres(2.105);
const START = 1_800_000_000;

describe('the assigned numbers this program hard-codes', () => {
  /**
   * Read on **2026-09-04** from the Bluetooth SIG's own machine-readable
   * assigned numbers — the `bluetooth-SIG/public` repository,
   * `assigned_numbers/uuids/service_uuids.yaml` and
   * `characteristic_uuids.yaml`. #41 requires the re-verification because both
   * issue bodies carried values corroborated from secondary sources during
   * planning. All ten matched.
   *
   * The seven FTMS entries were added by #43 and checked on **2026-09-04**
   * against the same assigned characteristic numbers. ⚠️ **#43's issue body
   * names `0x2AD3` for Indoor Bike Data and is wrong** — `0x2AD3` is Training
   * Status. Its own revision block corrects it to `0x2AD2`, and this table is
   * where that correction is enforced rather than merely written down: a client
   * subscribed to Training Status pairs, reports connected, and delivers
   * nothing.
   */
  const assigned: readonly (readonly [string, number, string])[] = [
    ['Heart Rate', 0x180d, HEART_RATE_SERVICE],
    ['Heart Rate Measurement', 0x2a37, HEART_RATE_MEASUREMENT],
    ['Body Sensor Location', 0x2a38, BODY_SENSOR_LOCATION],
    ['Cycling Speed and Cadence', 0x1816, CYCLING_SPEED_CADENCE_SERVICE],
    ['CSC Measurement', 0x2a5b, CSC_MEASUREMENT],
    ['CSC Feature', 0x2a5c, CSC_FEATURE],
    ['Cycling Power', 0x1818, CYCLING_POWER_SERVICE],
    ['Cycling Power Measurement', 0x2a63, CYCLING_POWER_MEASUREMENT],
    ['Cycling Power Feature', 0x2a65, CYCLING_POWER_FEATURE],
    ['Sensor Location', 0x2a5d, CYCLING_POWER_SENSOR_LOCATION],
    ['Fitness Machine', 0x1826, FITNESS_MACHINE_SERVICE],
    ['Fitness Machine Feature', 0x2acc, FITNESS_MACHINE_FEATURE],
    ['Indoor Bike Data', 0x2ad2, INDOOR_BIKE_DATA],
    ['Supported Resistance Level Range', 0x2ad6, SUPPORTED_RESISTANCE_LEVEL_RANGE],
    ['Supported Power Range', 0x2ad8, SUPPORTED_POWER_RANGE],
    ['Fitness Machine Control Point', 0x2ad9, FITNESS_MACHINE_CONTROL_POINT],
    ['Fitness Machine Status', 0x2ada, FITNESS_MACHINE_STATUS],
  ];

  for (const [name, number, literal] of assigned) {
    it(`writes ${name} (0x${number.toString(16).toUpperCase()}) in the form the adapter compares`, () => {
      // The adapter canonicalises before it compares anything, so a literal
      // that does not equal `canonicalUuid` of its own assigned number is a
      // service that is never resolved.
      expect(literal).toBe(canonicalUuid(number));
    });
  }

  it('uses a distinct UUID for every entry', () => {
    // A copy-paste that left two constants equal would otherwise pass every
    // assertion above except its own.
    expect(new Set(assigned.map(([, , literal]) => literal)).size).toBe(assigned.length);
  });

  it('does not name Training Status, which is the UUID #43 s body got wrong', () => {
    // The specific transposition, pinned. 0x2AD3 is Training Status and a
    // client that subscribed to it would deliver nothing at all.
    expect(INDOOR_BIKE_DATA).not.toBe(canonicalUuid(0x2ad3));
  });
});

/** A combined speed-and-cadence sensor, serving the real CSC service. */
function cscSensor(): FakeDeviceSpec {
  return {
    id: 'csc-sensor',
    name: 'CSC 4F21',
    services: [
      { uuid: CYCLING_SPEED_CADENCE_SERVICE, characteristics: [CSC_MEASUREMENT, CSC_FEATURE] },
    ],
  };
}

/** A crank-based power meter, serving the real Cycling Power service. */
function powerMeter(): FakeDeviceSpec {
  return {
    id: 'power-meter',
    name: 'POWER 9C03',
    services: [
      {
        uuid: CYCLING_POWER_SERVICE,
        characteristics: [CYCLING_POWER_MEASUREMENT, CYCLING_POWER_FEATURE],
      },
    ],
  };
}

/** A smart trainer, serving the real Fitness Machine service. */
function ftmsTrainerDevice(): FakeDeviceSpec {
  return {
    id: 'ftms-trainer',
    name: 'KICKR 1F2A',
    services: [
      {
        uuid: FITNESS_MACHINE_SERVICE,
        characteristics: [
          INDOOR_BIKE_DATA,
          FITNESS_MACHINE_FEATURE,
          FITNESS_MACHINE_CONTROL_POINT,
          FITNESS_MACHINE_STATUS,
          SUPPORTED_POWER_RANGE,
        ],
      },
    ],
  };
}

/**
 * One Indoor Bike Data notification carrying speed, cadence and power.
 *
 * ⚠️ Flag bit 0 is More Data and is **clear** here, which is what makes the
 * speed present. Written with literal offsets rather than through
 * `protocol/src/testing.ts`, so this fixture and the decoder do not share an
 * arithmetic mistake.
 */
function indoorBikeDataFrame(hundredthsKph: number, halfRpm: number, watts: number): Uint8Array {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, (1 << 2) | (1 << 6), true);
  view.setUint16(2, hundredthsKph, true);
  view.setUint16(4, halfRpm, true);
  view.setInt16(6, watts, true);
  return bytes;
}

/** A heart rate strap. */
function strap(): FakeDeviceSpec {
  return {
    id: 'strap',
    name: 'STRAP 1B7E',
    services: [{ uuid: HEART_RATE_SERVICE, characteristics: [HEART_RATE_MEASUREMENT] }],
  };
}

/** A clock the test drives, so the ambiguity horizon is reachable on demand. */
function scriptedClock(): { now: () => UnixSeconds; advance: (by: number) => void } {
  let second = START;
  return {
    now: () => unixSeconds(second),
    advance: (by) => {
      second += by;
    },
  };
}

function cscFrame(
  wheel: { revolutions: number; ticks: number },
  crank: { revolutions: number; ticks: number },
): Uint8Array {
  const bytes = new Uint8Array(11);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, 0b11);
  view.setUint32(1, wheel.revolutions, true);
  view.setUint16(5, wheel.ticks, true);
  view.setUint16(7, crank.revolutions, true);
  view.setUint16(9, crank.ticks, true);
  return bytes;
}

function powerFrame(power: number, crank: { revolutions: number; ticks: number }): Uint8Array {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 1 << 5, true);
  view.setInt16(2, power, true);
  view.setUint16(4, crank.revolutions, true);
  view.setUint16(6, crank.ticks, true);
  return bytes;
}

describe('a heart rate strap, end to end', () => {
  it('resolves the real service and delivers beats per minute', async () => {
    const fake = createFakeBluetooth({ devices: [strap()] });
    const transport = createWebBluetoothTransport({
      profiles: [heartRateProfile],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
    });

    const device = await transport.discover({ capabilities: ['heart-rate'] });
    await transport.connect(device.identity.id);
    const delivered: SensorMeasurement[] = [];
    await transport.subscribe(device.identity.id, 'heart-rate', (m) => delivered.push(m));

    // Flags 0b110: contact supported and detected, 8-bit value.
    fake.bench
      .device('strap')
      .notify(HEART_RATE_SERVICE, HEART_RATE_MEASUREMENT, Uint8Array.from([0b110, 148]));

    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ capability: 'heart-rate', heartRate: 148 });
  });

  it('delivers nothing for a strap reporting lost contact', async () => {
    const fake = createFakeBluetooth({ devices: [strap()] });
    const transport = createWebBluetoothTransport({
      profiles: [heartRateProfile],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
    });
    const device = await transport.discover({ capabilities: ['heart-rate'] });
    await transport.connect(device.identity.id);
    const delivered: SensorMeasurement[] = [];
    await transport.subscribe(device.identity.id, 'heart-rate', (m) => delivered.push(m));

    // Flags 0b100: contact supported, not detected. The strap transmits zero.
    fake.bench
      .device('strap')
      .notify(HEART_RATE_SERVICE, HEART_RATE_MEASUREMENT, Uint8Array.from([0b100, 0]));

    expect(delivered).toEqual([]);
  });
});

describe('a speed and cadence sensor, end to end', () => {
  it('delivers a derived cadence and speed across several notifications', async () => {
    // The whole point of this file. A profile whose per-link state did not
    // survive between notifications would deliver NOTHING here, silently,
    // while every unit test in `protocol/` stayed green.
    const clock = scriptedClock();
    const fake = createFakeBluetooth({ devices: [cscSensor()] });
    const transport = createWebBluetoothTransport({
      profiles: [createCyclingSpeedCadenceProfile({ wheelCircumference: WHEEL_700_25C })],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
      now: clock.now,
    });

    const device = await transport.discover({ capabilities: ['cadence', 'speed'] });
    await transport.connect(device.identity.id);
    const cadences: SensorMeasurement[] = [];
    const speeds: SensorMeasurement[] = [];
    await transport.subscribe(device.identity.id, 'cadence', (m) => cadences.push(m));
    await transport.subscribe(device.identity.id, 'speed', (m) => speeds.push(m));

    const sensor = fake.bench.device('csc-sensor');
    sensor.notify(
      CYCLING_SPEED_CADENCE_SERVICE,
      CSC_MEASUREMENT,
      cscFrame({ revolutions: 1000, ticks: 0 }, { revolutions: 500, ticks: 0 }),
    );
    clock.advance(1);
    sensor.notify(
      CYCLING_SPEED_CADENCE_SERVICE,
      CSC_MEASUREMENT,
      cscFrame({ revolutions: 1010, ticks: 1024 }, { revolutions: 501, ticks: 1024 }),
    );

    expect(cadences).toHaveLength(1);
    expect(cadences[0]).toMatchObject({ capability: 'cadence', cadence: 60 });
    expect(speeds).toHaveLength(1);
    expect(speeds[0]).toMatchObject({ capability: 'speed', speed: 10 * 2.105 });
  });

  it('drops a sample the transport’s own clock says is too old to pair with', async () => {
    // This is what the third `decode` parameter is for, and the only place it
    // can be observed. The counter deltas below are perfectly ordinary; it is
    // the 70 seconds of wall-clock between the two notifications — which only
    // the transport knows — that makes the interval unrecoverable, because a
    // `uint16` at 1024 Hz laps every 64. A decoder handed no instant would
    // report about a thousand rpm here.
    const clock = scriptedClock();
    const fake = createFakeBluetooth({ devices: [cscSensor()] });
    const transport = createWebBluetoothTransport({
      profiles: [createCyclingSpeedCadenceProfile({ wheelCircumference: WHEEL_700_25C })],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
      now: clock.now,
    });
    const device = await transport.discover({ capabilities: ['cadence'] });
    await transport.connect(device.identity.id);
    const delivered: SensorMeasurement[] = [];
    await transport.subscribe(device.identity.id, 'cadence', (m) => delivered.push(m));

    const sensor = fake.bench.device('csc-sensor');
    sensor.notify(
      CYCLING_SPEED_CADENCE_SERVICE,
      CSC_MEASUREMENT,
      cscFrame({ revolutions: 1000, ticks: 0 }, { revolutions: 500, ticks: 0 }),
    );
    clock.advance(70);
    sensor.notify(
      CYCLING_SPEED_CADENCE_SERVICE,
      CSC_MEASUREMENT,
      cscFrame({ revolutions: 1010, ticks: 1024 }, { revolutions: 501, ticks: 1024 }),
    );

    expect(delivered).toEqual([]);

    // …and the sample after it, an ordinary second later, is reported. So the
    // test above is not passing because nothing is ever reported.
    clock.advance(1);
    sensor.notify(
      CYCLING_SPEED_CADENCE_SERVICE,
      CSC_MEASUREMENT,
      cscFrame({ revolutions: 1020, ticks: 2048 }, { revolutions: 502, ticks: 2048 }),
    );
    expect(delivered).toHaveLength(1);
  });

  it('stamps every measurement with the transport’s clock, not a decoder’s', async () => {
    const clock = scriptedClock();
    const fake = createFakeBluetooth({ devices: [cscSensor()] });
    const transport = createWebBluetoothTransport({
      profiles: [createCyclingSpeedCadenceProfile({ wheelCircumference: WHEEL_700_25C })],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
      now: clock.now,
    });
    const device = await transport.discover({ capabilities: ['cadence'] });
    await transport.connect(device.identity.id);
    const delivered: SensorMeasurement[] = [];
    await transport.subscribe(device.identity.id, 'cadence', (m) => delivered.push(m));

    const sensor = fake.bench.device('csc-sensor');
    sensor.notify(
      CYCLING_SPEED_CADENCE_SERVICE,
      CSC_MEASUREMENT,
      cscFrame({ revolutions: 1000, ticks: 0 }, { revolutions: 500, ticks: 0 }),
    );
    clock.advance(5);
    sensor.notify(
      CYCLING_SPEED_CADENCE_SERVICE,
      CSC_MEASUREMENT,
      cscFrame({ revolutions: 1010, ticks: 1024 }, { revolutions: 501, ticks: 1024 }),
    );

    expect(delivered[0]?.at).toBe(START + 5);
  });

  it('restarts its accumulator after a dropout rather than carrying one across', async () => {
    // A reconnect builds a new sink, so the state goes with the link. That is
    // the correct behaviour: the counters may have moved arbitrarily far while
    // the link was down and the sensor did not transmit the difference.
    const clock = scriptedClock();
    const fake = createFakeBluetooth({ devices: [cscSensor()] });
    const transport = createWebBluetoothTransport({
      profiles: [createCyclingSpeedCadenceProfile({ wheelCircumference: WHEEL_700_25C })],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
      now: clock.now,
    });
    const device = await transport.discover({ capabilities: ['cadence'] });
    await transport.connect(device.identity.id);
    const delivered: SensorMeasurement[] = [];
    await transport.subscribe(device.identity.id, 'cadence', (m) => delivered.push(m));

    const sensor = fake.bench.device('csc-sensor');
    sensor.notify(
      CYCLING_SPEED_CADENCE_SERVICE,
      CSC_MEASUREMENT,
      cscFrame({ revolutions: 1000, ticks: 0 }, { revolutions: 500, ticks: 0 }),
    );
    sensor.drop();
    await transport.connect(device.identity.id);
    clock.advance(1);
    sensor.notify(
      CYCLING_SPEED_CADENCE_SERVICE,
      CSC_MEASUREMENT,
      cscFrame({ revolutions: 1010, ticks: 1024 }, { revolutions: 501, ticks: 1024 }),
    );

    expect(delivered).toEqual([]);
  });
});

describe('one profile object, two sensors', () => {
  it('never differences one sensor’s counters against another’s', async () => {
    // The defect the per-link key exists for. A profile object outlives every
    // link it decodes for, so a single shared accumulator would give the
    // second sensor a first cadence derived from the first sensor's counter —
    // and there is no single-device test that fails.
    const clock = scriptedClock();
    const profile = createCyclingSpeedCadenceProfile({ wheelCircumference: WHEEL_700_25C });

    const connect = async (fake: ReturnType<typeof createFakeBluetooth>) => {
      const transport = createWebBluetoothTransport({
        profiles: [profile],
        bluetooth: fake.bluetooth,
        hasUserActivation: () => true,
        now: clock.now,
      });
      const device = await transport.discover({ capabilities: ['cadence'] });
      await transport.connect(device.identity.id);
      const delivered: SensorMeasurement[] = [];
      await transport.subscribe(device.identity.id, 'cadence', (m) => delivered.push(m));
      return delivered;
    };

    const firstBench = createFakeBluetooth({ devices: [cscSensor()] });
    const secondBench = createFakeBluetooth({ devices: [{ ...cscSensor(), id: 'second' }] });
    const fromFirst = await connect(firstBench);
    const fromSecond = await connect(secondBench);

    // The first sensor's counters are far ahead of the second's, so a shared
    // accumulator produces a large negative crank delta — which wraps to an
    // enormous positive one — on the second sensor's very first frame.
    firstBench.bench
      .device('csc-sensor')
      .notify(
        CYCLING_SPEED_CADENCE_SERVICE,
        CSC_MEASUREMENT,
        cscFrame({ revolutions: 50_000, ticks: 0 }, { revolutions: 40_000, ticks: 0 }),
      );
    clock.advance(1);
    secondBench.bench
      .device('second')
      .notify(
        CYCLING_SPEED_CADENCE_SERVICE,
        CSC_MEASUREMENT,
        cscFrame({ revolutions: 10, ticks: 512 }, { revolutions: 5, ticks: 512 }),
      );

    // Each sensor's first frame is its own first: nothing to difference.
    expect(fromSecond).toEqual([]);
    expect(fromFirst).toEqual([]);
  });
});

describe('a smart trainer over FTMS, end to end', () => {
  it('fans one Indoor Bike Data notification out into power, cadence and speed', async () => {
    // The arrangement `capability.ts` describes and `planCapabilitySources`
    // depends on: one connection covering three capabilities. Asserted here
    // through the real adapter rather than about the decoder, because it is the
    // adapter that resolves the characteristic and splits the frame.
    const clock = scriptedClock();
    const fake = createFakeBluetooth({ devices: [ftmsTrainerDevice()] });
    const transport = createWebBluetoothTransport({
      profiles: [createIndoorBikeDataProfile()],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
      now: clock.now,
    });

    const device = await transport.discover({ capabilities: ['power', 'cadence', 'speed'] });
    await transport.connect(device.identity.id);
    const received: SensorMeasurement[] = [];
    for (const capability of ['power', 'cadence', 'speed'] as const) {
      await transport.subscribe(device.identity.id, capability, (m) => received.push(m));
    }

    fake.bench
      .device('ftms-trainer')
      .notify(FITNESS_MACHINE_SERVICE, INDOOR_BIKE_DATA, indoorBikeDataFrame(2543, 180, 214));

    expect(received.map((m) => m.capability)).toEqual(['power', 'cadence', 'speed']);
    // One notification, one instant: a consumer can correlate the three.
    expect(new Set(received.map((m) => m.at))).toStrictEqual(new Set([START]));
    expect(received[0]).toMatchObject({ power: 214 });
    expect(received[1]).toMatchObject({ cadence: 90 });
    expect(received[2]).toMatchObject({ capability: 'speed' });
  });

  it('resolves the real Indoor Bike Data characteristic and not Training Status', async () => {
    // A trainer that serves ONLY 0x2AD2 — as every real one does. If the
    // profile named 0x2AD3 the characteristic would not resolve, the connect
    // would fail, and no unit test in `protocol/` would notice.
    const fake = createFakeBluetooth({
      devices: [
        {
          id: 'ftms-trainer',
          name: 'KICKR 1F2A',
          services: [{ uuid: FITNESS_MACHINE_SERVICE, characteristics: [INDOOR_BIKE_DATA] }],
        },
      ],
    });
    const transport = createWebBluetoothTransport({
      profiles: [createIndoorBikeDataProfile()],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
    });

    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);
    const powers: SensorMeasurement[] = [];
    await transport.subscribe(device.identity.id, 'power', (m) => powers.push(m));

    fake.bench
      .device('ftms-trainer')
      .notify(FITNESS_MACHINE_SERVICE, INDOOR_BIKE_DATA, indoorBikeDataFrame(2543, 180, 214));

    expect(powers).toHaveLength(1);
  });

  it('drops an Indoor Bike Data frame whose flags claim a field it does not carry', async () => {
    const fake = createFakeBluetooth({ devices: [ftmsTrainerDevice()] });
    const errors: unknown[] = [];
    const transport = createWebBluetoothTransport({
      profiles: [createIndoorBikeDataProfile()],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
      onProtocolError: (error) => errors.push(error),
    });

    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);
    const powers: SensorMeasurement[] = [];
    await transport.subscribe(device.identity.id, 'power', (m) => powers.push(m));

    // Flags claim cadence and power; the payload stops after the speed.
    const truncated = new Uint8Array(4);
    new DataView(truncated.buffer).setUint16(0, (1 << 2) | (1 << 6), true);
    fake.bench.device('ftms-trainer').notify(FITNESS_MACHINE_SERVICE, INDOOR_BIKE_DATA, truncated);

    expect(powers).toStrictEqual([]);
    expect(errors).toHaveLength(1);
    expect(transport.connectionState(device.identity.id)).toBe('connected');
  });
});

describe('a power meter, end to end', () => {
  it('delivers power from the first notification and cadence from the second', async () => {
    const clock = scriptedClock();
    const fake = createFakeBluetooth({ devices: [powerMeter()] });
    const transport = createWebBluetoothTransport({
      profiles: [createCyclingPowerProfile()],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
      now: clock.now,
    });

    const device = await transport.discover({ capabilities: ['power', 'cadence'] });
    await transport.connect(device.identity.id);
    const powers: SensorMeasurement[] = [];
    const cadences: SensorMeasurement[] = [];
    await transport.subscribe(device.identity.id, 'power', (m) => powers.push(m));
    await transport.subscribe(device.identity.id, 'cadence', (m) => cadences.push(m));

    const meter = fake.bench.device('power-meter');
    meter.notify(
      CYCLING_POWER_SERVICE,
      CYCLING_POWER_MEASUREMENT,
      powerFrame(240, { revolutions: 100, ticks: 0 }),
    );
    clock.advance(1);
    meter.notify(
      CYCLING_POWER_SERVICE,
      CYCLING_POWER_MEASUREMENT,
      powerFrame(255, { revolutions: 102, ticks: 1024 }),
    );

    expect(powers.map((m) => (m.capability === 'power' ? m.power : undefined))).toEqual([240, 255]);
    expect(cadences).toHaveLength(1);
    expect(cadences[0]).toMatchObject({ cadence: 120 });
  });

  it('reports a malformed notification through onProtocolError and keeps the link', async () => {
    // Sensor data is untrusted input. A decoder that threw into the browser's
    // event dispatch would be uncatchable; the adapter drops the notification.
    const fake = createFakeBluetooth({ devices: [powerMeter()] });
    const errors: unknown[] = [];
    const transport = createWebBluetoothTransport({
      profiles: [createCyclingPowerProfile()],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
      onProtocolError: (error) => errors.push(error),
    });
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);
    const powers: SensorMeasurement[] = [];
    await transport.subscribe(device.identity.id, 'power', (m) => powers.push(m));

    const meter = fake.bench.device('power-meter');
    // Flags claim crank revolution data; the packet stops after the power.
    meter.notify(
      CYCLING_POWER_SERVICE,
      CYCLING_POWER_MEASUREMENT,
      Uint8Array.from([0x20, 0x00, 0xf0, 0x00]),
    );
    meter.notify(
      CYCLING_POWER_SERVICE,
      CYCLING_POWER_MEASUREMENT,
      powerFrame(200, { revolutions: 1, ticks: 0 }),
    );

    expect(errors).toHaveLength(1);
    expect(powers).toHaveLength(1);
    expect(transport.connectionState(device.identity.id)).toBe('connected');
  });
});
