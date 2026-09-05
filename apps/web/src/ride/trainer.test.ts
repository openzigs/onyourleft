// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The composition root for trainer control, over the **real browser transport**
 * and a scripted Web Bluetooth stack.
 *
 * `controller.test.ts` drives the #44 simulator, which models a trainer's
 * behaviour and not a browser's. This file is the other half: it goes through
 * `createWebBluetoothTransport`, `openFitnessMachine` and the production
 * `FitnessMachineChannel`, so the gating decisions here are made against
 * characteristics that were actually read off a device rather than against
 * values a test constructed.
 *
 * The two decisions being checked are both refusals, and both are refusals in
 * the safe direction: no ERG client for a machine that will not say what it can
 * take, and no ERG control for a machine whose Target Setting bit 3 is clear.
 */

import {
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_FEATURE,
  FITNESS_MACHINE_SERVICE,
  FITNESS_MACHINE_STATUS,
  INDOOR_BIKE_DATA,
  SUPPORTED_POWER_RANGE,
  SUPPORTED_RESISTANCE_LEVEL_RANGE,
  CYCLING_POWER_MEASUREMENT,
  CYCLING_POWER_SERVICE,
  createIndoorBikeDataProfile,
} from '@onyourleft/sensors/protocol';
import {
  createWebBluetoothTransport,
  type WebBluetoothTransport,
} from '@onyourleft/sensors/web-bluetooth';
import {
  createFakeBluetooth,
  type FakeDeviceSpec,
  type FakeServiceSpec,
} from '@onyourleft/sensors/web-bluetooth/testing';
import { deviceId } from '@onyourleft/sensors';
import { describe, expect, it, vi } from 'vitest';

import { browserTimeouts, openWebBluetoothTrainer, TRAINER_PROCEDURE_TIMEOUT } from './trainer';

const TRAINER = deviceId('kickr');

/** 0 W to 2000 W in 5 W steps. Three sint16 fields, little-endian. */
const POWER_RANGE_BYTES = Uint8Array.from([0, 0, 0xd0, 0x07, 5, 0]);
/** 0 to 20 in steps of 0.5, in tenths. */
const RESISTANCE_RANGE_BYTES = Uint8Array.from([0, 0, 200, 0, 5, 0]);

/**
 * A Fitness Machine Feature value with the two Target Setting bits #49 gates
 * on set or clear.
 *
 * Bit 3 is Power Target and bit 13 is Indoor Bike Simulation Parameters, both
 * in the **second** 32-bit field. A value with only the first field would leave
 * both gates reading `false` for every trainer ever made.
 */
function featureBytes(powerTarget: boolean, simulation: boolean): Uint8Array {
  const target = (powerTarget ? 1 << 3 : 0) | (simulation ? 1 << 13 : 0);
  return Uint8Array.from([
    0x82,
    0,
    0,
    0,
    target & 0xff,
    (target >>> 8) & 0xff,
    (target >>> 16) & 0xff,
    (target >>> 24) & 0xff,
  ]);
}

function trainerDevice(service: Partial<FakeServiceSpec>): FakeDeviceSpec {
  return {
    id: 'kickr',
    name: 'KICKR 1F2A',
    services: [
      {
        uuid: FITNESS_MACHINE_SERVICE,
        characteristics: [INDOOR_BIKE_DATA, FITNESS_MACHINE_CONTROL_POINT, FITNESS_MACHINE_STATUS],
        ...service,
      },
    ],
  };
}

/** A fully-featured trainer: both ranges and both feature bits. */
function completeTrainer(): FakeDeviceSpec {
  return trainerDevice({
    characteristics: [
      INDOOR_BIKE_DATA,
      FITNESS_MACHINE_CONTROL_POINT,
      FITNESS_MACHINE_STATUS,
      SUPPORTED_POWER_RANGE,
      SUPPORTED_RESISTANCE_LEVEL_RANGE,
      FITNESS_MACHINE_FEATURE,
    ],
    readValues: {
      [SUPPORTED_POWER_RANGE]: POWER_RANGE_BYTES,
      [SUPPORTED_RESISTANCE_LEVEL_RANGE]: RESISTANCE_RANGE_BYTES,
      [FITNESS_MACHINE_FEATURE]: featureBytes(true, true),
    },
  });
}

async function connect(devices: readonly FakeDeviceSpec[]): Promise<WebBluetoothTransport> {
  const fake = createFakeBluetooth({ devices: [...devices] });
  const transport = createWebBluetoothTransport({
    profiles: [createIndoorBikeDataProfile()],
    bluetooth: fake.bluetooth,
  });
  await transport.discover({ capabilities: ['power'] });
  await transport.connect(TRAINER);
  return transport;
}

describe('opening trainer control on a real transport', () => {
  it('builds a client bounded by the range the trainer reported', async () => {
    const transport = await connect([completeTrainer()]);

    const connection = await openWebBluetoothTrainer(transport)(TRAINER);

    expect(connection?.powerRange).toEqual({ minimum: 0, maximum: 2000, increment: 5 });
    expect(connection?.canSetPower).toBe(true);
    expect(connection?.canSimulate).toBe(true);
    connection?.control.close();
  });

  it('refuses to build one for a machine that will not report its power range', async () => {
    // The safe direction. `createTrainerControl` requires the range because a
    // setpoint has to be bounded by what the device said, and the alternative
    // to refusing here is inventing limits for a machine that applies physical
    // resistance to a person.
    const transport = await connect([
      trainerDevice({
        characteristics: [
          INDOOR_BIKE_DATA,
          FITNESS_MACHINE_CONTROL_POINT,
          FITNESS_MACHINE_STATUS,
          FITNESS_MACHINE_FEATURE,
        ],
        readValues: { [FITNESS_MACHINE_FEATURE]: featureBytes(true, true) },
      }),
    ]);

    await expect(openWebBluetoothTrainer(transport)(TRAINER)).resolves.toBeUndefined();
  });

  it('reports no ERG when Target Setting bit 3 is clear', async () => {
    const transport = await connect([
      trainerDevice({
        characteristics: [
          INDOOR_BIKE_DATA,
          FITNESS_MACHINE_CONTROL_POINT,
          FITNESS_MACHINE_STATUS,
          SUPPORTED_POWER_RANGE,
          FITNESS_MACHINE_FEATURE,
        ],
        readValues: {
          [SUPPORTED_POWER_RANGE]: POWER_RANGE_BYTES,
          [FITNESS_MACHINE_FEATURE]: featureBytes(false, false),
        },
      }),
    ]);

    const connection = await openWebBluetoothTrainer(transport)(TRAINER);

    // Built, because the range is there — but the screen must not offer the
    // control. Offering one the trainer will refuse is worse than not offering
    // it.
    expect(connection).not.toBeUndefined();
    expect(connection?.canSetPower).toBe(false);
    expect(connection?.canSimulate).toBe(false);
    connection?.control.close();
  });

  it('gates nothing when the machine reported no features at all', async () => {
    // `TrainerControlOptions.features` states this rule: an absent feature set
    // must not have every setpoint refused, because a transport that could not
    // read the characteristic would otherwise take ERG away from a trainer
    // that has it.
    const transport = await connect([
      trainerDevice({
        characteristics: [
          INDOOR_BIKE_DATA,
          FITNESS_MACHINE_CONTROL_POINT,
          FITNESS_MACHINE_STATUS,
          SUPPORTED_POWER_RANGE,
        ],
        readValues: { [SUPPORTED_POWER_RANGE]: POWER_RANGE_BYTES },
      }),
    ]);

    const connection = await openWebBluetoothTrainer(transport)(TRAINER);

    expect(connection?.canSetPower).toBe(true);
    expect(connection?.canSimulate).toBe(true);
    connection?.control.close();
  });

  it('answers undefined for a device that serves no Fitness Machine Service', async () => {
    const fake = createFakeBluetooth({
      devices: [
        {
          id: 'kickr',
          name: 'KICKR 1F2A',
          services: [{ uuid: CYCLING_POWER_SERVICE, characteristics: [CYCLING_POWER_MEASUREMENT] }],
        },
      ],
    });
    const transport = createWebBluetoothTransport({
      profiles: [
        {
          service: CYCLING_POWER_SERVICE,
          characteristic: CYCLING_POWER_MEASUREMENT,
          capabilities: ['power'],
          // Never invoked: this device is here to be *rejected* as a trainer.
          decode: () => undefined,
        },
      ],
      bluetooth: fake.bluetooth,
    });
    await transport.discover({ capabilities: ['power'] });
    await transport.connect(TRAINER);

    // A power meter, not a trainer. Not an error and not reported as one.
    await expect(openWebBluetoothTrainer(transport)(TRAINER)).resolves.toBeUndefined();
  });
});

describe('the procedure timeout', () => {
  it('is injected, so a hung machine fails visibly rather than wedging the queue', async () => {
    const transport = await connect([completeTrainer()]);
    const scheduled: number[] = [];

    const connection = await openWebBluetoothTrainer(transport, {
      scheduleTimeout: (afterSeconds) => {
        scheduled.push(afterSeconds);
        return () => undefined;
      },
    })(TRAINER);

    // Reaching the schedule at all needs a procedure. The fake stack never
    // indicates, so this one never completes — which is the case the timeout
    // exists for.
    void connection?.control.requestControl().catch(() => undefined);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(scheduled).toEqual([5]);
    connection?.control.close();
  });

  describe('browserTimeouts — the scheduler production actually uses', () => {
    // The default is what ships; every case above injects a substitute for it,
    // which is exactly how a default goes untested. Seconds to milliseconds is
    // the whole of its logic and it is a factor of a thousand wrong when it is
    // wrong: a five-second bound becomes five milliseconds or eighty minutes,
    // and neither turns a hung trainer into a visible refusal.

    it('runs after the stated number of seconds, and not before', () => {
      vi.useFakeTimers();
      try {
        let ran = 0;
        browserTimeouts(TRAINER_PROCEDURE_TIMEOUT, () => {
          ran += 1;
        });

        vi.advanceTimersByTime(TRAINER_PROCEDURE_TIMEOUT * 1000 - 1);
        expect(ran).toBe(0);
        vi.advanceTimersByTime(1);
        expect(ran).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('cancels, so a procedure that answered does not time out afterwards', () => {
      vi.useFakeTimers();
      try {
        let ran = 0;
        const cancel = browserTimeouts(TRAINER_PROCEDURE_TIMEOUT, () => {
          ran += 1;
        });

        cancel();
        vi.advanceTimersByTime(TRAINER_PROCEDURE_TIMEOUT * 1000 * 2);

        // A timeout that fired after its own procedure completed would reject a
        // setpoint the trainer had already accepted.
        expect(ran).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
