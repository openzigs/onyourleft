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
  WAHOO_TRAINER_CONTROL_POINT,
  createCyclingPowerProfile,
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

    const { connection } = await openWebBluetoothTrainer(transport)(TRAINER);

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

    await expect(openWebBluetoothTrainer(transport)(TRAINER)).resolves.toMatchObject({
      connection: undefined,
    });
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

    const { connection } = await openWebBluetoothTrainer(transport)(TRAINER);

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

    const { connection } = await openWebBluetoothTrainer(transport)(TRAINER);

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
    await expect(openWebBluetoothTrainer(transport)(TRAINER)).resolves.toMatchObject({
      connection: undefined,
    });
  });
});

/**
 * #370 — what the machine OFFERS, which is a different question from whether
 * this app will drive it.
 *
 * Before this, `openWebBluetoothTrainer` answered `TrainerConnection |
 * undefined`, so a trainer whose only control point is its manufacturer's was
 * indistinguishable from a heart rate strap and the screen said *"no
 * controllable trainer"*. `chooseTrainerControl` had always been able to tell
 * the difference and had nothing to read; the wiring gate reported it as three
 * unwired exports on the first run over the trainer-command seam (#363).
 *
 * ⚠️ **None of this is exercised on hardware.** Nobody in the loop has a
 * vendor-only trainer — the owner's machine serves FTMS — so what is asserted
 * below is the decision and the plumbing, against a scripted stack.
 * `docs/validation/0002-android-shell-and-game.md` Part M is the step for
 * somebody who has one.
 */
describe('what the machine offers — #370', () => {
  /** Wahoo's control characteristic lives inside the standard power service. */
  function vendorOnlyTrainer(): FakeDeviceSpec {
    return {
      id: 'kickr',
      name: 'KICKR SNAP',
      services: [
        {
          uuid: CYCLING_POWER_SERVICE,
          characteristics: [CYCLING_POWER_MEASUREMENT, WAHOO_TRAINER_CONTROL_POINT],
        },
      ],
    };
  }

  /**
   * The grant a rider pairing a trainer actually gets.
   *
   * ⚠️ `connect()` above registers the Indoor Bike Data profile alone, so it
   * grants the Fitness Machine Service and nothing else — and `resolvedUuids`
   * is bounded by the grant, so a vendor characteristic inside the power
   * service would be **unreachable** under it. Pairing a trainer names power,
   * cadence, speed and control together (`controller.ts` §`PairingRole`), which
   * is what puts the power service in reach. Getting this wrong would make
   * every case below pass for the wrong reason: `none`, because nothing could
   * be seen, rather than `none` because nothing was there.
   */
  async function pairAsTrainer(devices: readonly FakeDeviceSpec[]): Promise<WebBluetoothTransport> {
    const fake = createFakeBluetooth({ devices: [...devices] });
    const transport = createWebBluetoothTransport({
      profiles: [createIndoorBikeDataProfile(), createCyclingPowerProfile()],
      bluetooth: fake.bluetooth,
    });
    await transport.discover({ capabilities: ['power', 'cadence', 'speed', 'trainer-control'] });
    await transport.connect(TRAINER);
    return transport;
  }

  it('tells a vendor-only trainer apart from no trainer at all', async () => {
    const real = await pairAsTrainer([vendorOnlyTrainer()]);
    let asked = 0;
    const transport: WebBluetoothTransport = {
      ...real,
      openFitnessMachine: (id) => {
        asked += 1;
        return real.openFitnessMachine(id);
      },
    };

    const attachment = await openWebBluetoothTrainer(transport)(TRAINER);

    expect(attachment.choice).toEqual({
      kind: 'vendor-not-implemented',
      controlPoint: WAHOO_TRAINER_CONTROL_POINT,
    });
    // ⚠️ And still nothing to drive. #370's fourth criterion: this is about a
    // message, not a capability. Nothing is ever written to that characteristic.
    expect(attachment.connection).toBeUndefined();
    // ⚠️ And the control point was never even asked for. Without this the
    // early return in `openWebBluetoothTrainer` is a surviving mutant —
    // measured: deleting it leaves every other assertion in this file green,
    // because `openFitnessMachine` rejects for this device anyway. What it
    // costs is a `getPrimaryService` for a service the grant does not cover,
    // which Chrome refuses with a `SecurityError` and logs, on every pair.
    expect(asked).toBe(0);
  });

  it('prefers the standard control point and reports that the vendor one is there', async () => {
    const transport = await pairAsTrainer([
      {
        id: 'kickr',
        name: 'KICKR 1F2A',
        services: [
          {
            uuid: FITNESS_MACHINE_SERVICE,
            characteristics: [
              INDOOR_BIKE_DATA,
              FITNESS_MACHINE_CONTROL_POINT,
              FITNESS_MACHINE_STATUS,
              SUPPORTED_POWER_RANGE,
            ],
            readValues: { [SUPPORTED_POWER_RANGE]: POWER_RANGE_BYTES },
          },
          {
            uuid: CYCLING_POWER_SERVICE,
            characteristics: [CYCLING_POWER_MEASUREMENT, WAHOO_TRAINER_CONTROL_POINT],
          },
        ],
      },
    ]);

    const attachment = await openWebBluetoothTrainer(transport)(TRAINER);

    expect(attachment.choice).toEqual({
      kind: 'fitness-machine',
      service: FITNESS_MACHINE_SERVICE,
      controlPoint: FITNESS_MACHINE_CONTROL_POINT,
      vendorAlsoPresent: true,
    });
    expect(attachment.connection).not.toBeUndefined();
    attachment.connection?.control.close();
  });

  it('reports no vendor control point on a machine that has none', async () => {
    const transport = await pairAsTrainer([completeTrainer()]);

    const attachment = await openWebBluetoothTrainer(transport)(TRAINER);

    expect(attachment.choice).toMatchObject({
      kind: 'fitness-machine',
      vendorAlsoPresent: false,
    });
    attachment.connection?.control.close();
  });

  /**
   * ⚠️ The no-regression property, and the reason `controlChoice` swallows.
   *
   * This call exists to make a message more specific. A transport that cannot
   * enumerate its services must leave a rider exactly where they were before
   * #370 — with a working trainer and the general sentence — rather than with a
   * trainer that stopped working. The same shape as #362, which computed a
   * gradient and sent nothing.
   */
  it('still builds the client when the transport cannot say what was resolved', async () => {
    const real = await pairAsTrainer([completeTrainer()]);
    const transport: WebBluetoothTransport = {
      ...real,
      resolvedUuids: () => Promise.reject(new Error('enumeration is unavailable')),
    };

    const attachment = await openWebBluetoothTrainer(transport)(TRAINER);

    expect(attachment.choice).toEqual({ kind: 'none' });
    expect(attachment.connection?.powerRange).toEqual({ minimum: 0, maximum: 2000, increment: 5 });
    attachment.connection?.control.close();
  });

  /**
   * The same, for the other way `chooseTrainerControl` can refuse: it throws a
   * `RangeError` on a UUID that is neither a 16-bit assigned number nor a
   * 128-bit one, deliberately, because *"a silently ignored misspelling would
   * be a controllable trainer reported as uncontrollable"*. Out of this
   * function that throw would be a pairing failure for the whole device.
   */
  it('does not lose the trainer to a UUID it cannot parse', async () => {
    const real = await pairAsTrainer([completeTrainer()]);
    const transport: WebBluetoothTransport = {
      ...real,
      resolvedUuids: () => Promise.resolve(['not-a-uuid']),
    };

    const attachment = await openWebBluetoothTrainer(transport)(TRAINER);

    expect(attachment.choice).toEqual({ kind: 'none' });
    expect(attachment.connection).not.toBeUndefined();
    attachment.connection?.control.close();
  });
});

describe('the procedure timeout', () => {
  it('is injected, so a hung machine fails visibly rather than wedging the queue', async () => {
    const transport = await connect([completeTrainer()]);
    const scheduled: number[] = [];

    const { connection } = await openWebBluetoothTrainer(transport, {
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
