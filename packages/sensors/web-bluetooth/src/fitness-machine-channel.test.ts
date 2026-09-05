// SPDX-License-Identifier: Apache-2.0

/**
 * The control point over a real GATT stack, and the one line in it that a
 * comment cannot protect.
 *
 * `../../protocol/src/fitness-machine-control.ts` warns that filling
 * `writeControlPoint` with an unacknowledged write *"compiles, satisfies every
 * test in this file, and reintroduces exactly the fire-and-forget failure the
 * client exists to prevent"*. This is the file where that stops being true:
 * `testing/fake-bluetooth.ts` models both writes, both succeed, and the
 * assertion below is on which one the adapter reached for.
 */

import { watts } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_FEATURE,
  FITNESS_MACHINE_SERVICE,
  FITNESS_MACHINE_STATUS,
  INDOOR_BIKE_DATA,
  SUPPORTED_POWER_RANGE,
  SUPPORTED_RESISTANCE_LEVEL_RANGE,
  createIndoorBikeDataProfile,
} from '../../protocol/src/fitness-machine';
import {
  FTMS_OP_CODE,
  createTrainerControl,
  type FitnessMachineChannel,
} from '../../protocol/src/fitness-machine-control';
import {
  HEART_RATE_MEASUREMENT,
  HEART_RATE_SERVICE,
  heartRateProfile,
} from '../../protocol/src/heart-rate';
import type { SupportedPowerRange } from '../../protocol/src/fitness-machine';
import { deviceId, type DeviceId } from '../../src/device';
import { isSensorError } from '../../src/errors';

import { createFakeBluetooth, type FakeBluetooth } from './testing/fake-bluetooth';
import {
  createWebBluetoothTransport,
  type FitnessMachine,
  type WebBluetoothTransport,
} from './transport';

const TRAINER = deviceId('kickr');
const STRAP = deviceId('strap');

/** 0 W to 2000 W in 5 W steps, as the three sint16 fields of `0x2AD8`. */
const POWER_RANGE_BYTES = Uint8Array.from([0, 0, 0xd0, 0x07, 5, 0]);

/** 0 to 20 in steps of 0.5, as the three fields of `0x2AD6`, each tenths. */
const RESISTANCE_RANGE_BYTES = Uint8Array.from([0, 0, 200, 0, 5, 0]);

/**
 * Two 32-bit fields. The second carries Target Setting bit 3 (power target) and
 * bit 13 (indoor bike simulation parameters) — the two #49's revision block
 * says the ERG and gradient controls are gated on.
 */
const FEATURE_BYTES = Uint8Array.from([0x82, 0, 0, 0, 0x08, 0x20, 0, 0]);

interface Bench {
  readonly fake: FakeBluetooth;
  readonly transport: WebBluetoothTransport;
}

function bench(): Bench {
  const fake = createFakeBluetooth({
    devices: [
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
              SUPPORTED_RESISTANCE_LEVEL_RANGE,
              FITNESS_MACHINE_FEATURE,
            ],
            readValues: {
              [SUPPORTED_POWER_RANGE]: POWER_RANGE_BYTES,
              [SUPPORTED_RESISTANCE_LEVEL_RANGE]: RESISTANCE_RANGE_BYTES,
              [FITNESS_MACHINE_FEATURE]: FEATURE_BYTES,
            },
          },
        ],
      },
      {
        id: 'strap',
        name: 'HRM 04B1',
        services: [{ uuid: HEART_RATE_SERVICE, characteristics: [HEART_RATE_MEASUREMENT] }],
      },
    ],
  });
  const transport = createWebBluetoothTransport({
    profiles: [createIndoorBikeDataProfile(), heartRateProfile],
    bluetooth: fake.bluetooth,
  });
  return { fake, transport };
}

async function connectedTrainer(): Promise<
  Bench & { channel: FitnessMachineChannel; machine: FitnessMachine }
> {
  const it = bench();
  await it.transport.discover({ capabilities: ['power'] });
  await it.transport.connect(TRAINER);
  const machine = await it.transport.openFitnessMachine(TRAINER);
  return { ...it, machine, channel: machine.channel };
}

/** The power range as the trainer itself reported it. */
function powerRange(machine: FitnessMachine): SupportedPowerRange {
  const range = machine.powerRange;
  if (range === undefined) {
    throw new Error('the trainer reported no Supported Power Range');
  }
  return range;
}

/** Let the queue and the fake stack's microtasks turn. */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

const controlPointWrites = (fake: FakeBluetooth): readonly Uint8Array[] =>
  fake.bench.device('kickr').writes(FITNESS_MACHINE_SERVICE, FITNESS_MACHINE_CONTROL_POINT);

/** The machine's answer to the last write: `0x80`, the request op code, success. */
function answerLastWrite(fake: FakeBluetooth): void {
  const writes = controlPointWrites(fake);
  const last = writes.at(-1);
  if (last === undefined) {
    throw new Error('nothing has been written to the control point');
  }
  fake.bench
    .device('kickr')
    .notify(
      FITNESS_MACHINE_SERVICE,
      FITNESS_MACHINE_CONTROL_POINT,
      Uint8Array.from([0x80, last[0] ?? 0, 0x01]),
    );
}

describe('opening the channel', () => {
  it('refuses a device that serves no Fitness Machine Service', async () => {
    const { transport } = bench();
    await transport.discover({ capabilities: ['heart-rate'] });
    await transport.connect(STRAP);

    await expect(transport.openFitnessMachine(STRAP)).rejects.toSatisfy(
      (error: unknown) => isSensorError(error) && error.code === 'capability-unsupported',
    );
  });

  it('refuses a device that is not connected, rather than resolving a dead handle', async () => {
    const { transport } = bench();
    await transport.discover({ capabilities: ['power'] });

    await expect(transport.openFitnessMachine(TRAINER)).rejects.toSatisfy(
      (error: unknown) => isSensorError(error) && error.code === 'not-connected',
    );
  });

  it('refuses an id this transport never issued', async () => {
    const { transport } = bench();
    await expect(
      transport.openFitnessMachine('never-seen' as unknown as DeviceId),
    ).rejects.toSatisfy(
      (error: unknown) => isSensorError(error) && error.code === 'device-not-found',
    );
  });

  it('resolves the service once per link, however many procedures run', async () => {
    const { fake, channel } = await connectedTrainer();
    const afterOpening = serviceResolutions(fake);

    await channel.enableControlPointIndications();
    await channel.enableControlPointIndications();
    await channel.writeControlPoint(Uint8Array.from([0x00]));

    // `getPrimaryService` is a queued round trip. Resolving it per procedure
    // would put one in front of every setpoint in a workout, and would leave
    // two characteristic objects for one attribute if two procedures raced.
    expect(serviceResolutions(fake)).toBe(afterOpening);
  });
});

describe('what the machine says about itself, read from the machine', () => {
  it('reads the supported ranges and the feature bits the controls are gated on', async () => {
    const { machine } = await connectedTrainer();

    // The increment is the field a hard-coded range would get wrong and nobody
    // would notice: a 5 W trainer asked for 251 W does something unspecified
    // with the 1.
    expect(machine.powerRange).toEqual({ minimum: 0, maximum: 2000, increment: 5 });
    expect(machine.resistanceRange).toEqual({ minimum: 0, maximum: 20, increment: 0.5 });
    expect(machine.features?.targetSetting.powerTarget).toBe(true);
    expect(machine.features?.targetSetting.indoorBikeSimulationParameters).toBe(true);
  });

  it('reports an unreadable characteristic as not reported, rather than refusing the machine', async () => {
    // A trainer that serves the control point and answers no read at all. FTMS
    // makes the Feature characteristic mandatory and real hardware omits it;
    // refusing control here would take ERG away from a machine that has it.
    const fake = createFakeBluetooth({
      devices: [
        {
          id: 'kickr',
          name: 'KICKR 1F2A',
          services: [
            {
              uuid: FITNESS_MACHINE_SERVICE,
              characteristics: [INDOOR_BIKE_DATA, FITNESS_MACHINE_CONTROL_POINT],
            },
          ],
        },
      ],
    });
    const transport = createWebBluetoothTransport({
      profiles: [createIndoorBikeDataProfile()],
      bluetooth: fake.bluetooth,
    });
    await transport.discover({ capabilities: ['power'] });
    await transport.connect(TRAINER);

    const machine = await transport.openFitnessMachine(TRAINER);

    expect(machine.powerRange).toBeUndefined();
    expect(machine.resistanceRange).toBeUndefined();
    expect(machine.features).toBeUndefined();
    // And the channel still works, which is the point of not refusing.
    await expect(
      machine.channel.writeControlPoint(Uint8Array.from([0x00])),
    ).resolves.toBeUndefined();
  });
});

describe('the write is acknowledged, and that is not a matter of style', () => {
  it('writes the control point with a Write Request, never a Write Command', async () => {
    const { fake, channel } = await connectedTrainer();

    await channel.writeControlPoint(Uint8Array.from([FTMS_OP_CODE.requestControl]));

    // The payload landed either way — `writeValueWithoutResponse` records it
    // too — so the payload is not the assertion. Which ATT operation carried it
    // is.
    expect(controlPointWrites(fake).map((write) => [...write])).toEqual([[0x00]]);
    expect(fake.bench.operations).toContain(
      `kickr:writeValueWithResponse:${FITNESS_MACHINE_CONTROL_POINT}`,
    );
    expect(
      fake.bench.operations.filter((operation) => operation.includes('writeValueWithoutResponse')),
      'an unacknowledged control point write makes an unwritten setpoint indistinguishable ' +
        'from a machine that never answered — see gatt.ts',
    ).toEqual([]);
  });

  it('rejects when the ATT write is refused, so a refusal is not read as silence', async () => {
    const { fake, channel } = await connectedTrainer();
    fake.bench.device('kickr').drop();
    await settle();

    await expect(channel.writeControlPoint(Uint8Array.from([0x00]))).rejects.toThrow();
  });
});

describe('indications and status', () => {
  it('delivers a control point indication to the client', async () => {
    const { fake, channel } = await connectedTrainer();
    const seen: number[][] = [];
    channel.onControlPointIndication((value) => {
      seen.push([...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)]);
    });

    await channel.enableControlPointIndications();
    fake.bench
      .device('kickr')
      .notify(
        FITNESS_MACHINE_SERVICE,
        FITNESS_MACHINE_CONTROL_POINT,
        Uint8Array.from([0x80, 0x00, 0x01]),
      );

    expect(seen).toEqual([[0x80, 0x00, 0x01]]);
  });

  it('subscribes to Fitness Machine Status as well, so a withdrawn permission is heard', async () => {
    const { fake, channel } = await connectedTrainer();
    const seen: number[][] = [];
    channel.onStatus((value) => {
      seen.push([...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)]);
    });

    await channel.enableControlPointIndications();
    fake.bench
      .device('kickr')
      .notify(FITNESS_MACHINE_SERVICE, FITNESS_MACHINE_STATUS, Uint8Array.from([0xff]));

    expect(seen).toEqual([[0xff]]);
  });

  it('installs exactly one handler per characteristic across a reconnection', async () => {
    const { fake, transport, channel } = await connectedTrainer();
    const seen: number[][] = [];
    channel.onControlPointIndication((value) => {
      seen.push([...new Uint8Array(value.buffer, value.byteOffset, value.byteLength)]);
    });
    await channel.enableControlPointIndications();

    fake.bench.device('kickr').drop();
    await settle();
    await transport.connect(TRAINER);
    await channel.enableControlPointIndications();

    expect(
      fake.bench.device('kickr').listeners(FITNESS_MACHINE_SERVICE, FITNESS_MACHINE_CONTROL_POINT),
      'a second handler settles a procedure with the answer to another one',
    ).toBe(1);

    fake.bench
      .device('kickr')
      .notify(
        FITNESS_MACHINE_SERVICE,
        FITNESS_MACHINE_CONTROL_POINT,
        Uint8Array.from([0x80, 0x00, 0x01]),
      );
    expect(seen).toEqual([[0x80, 0x00, 0x01]]);
  });

  it('re-resolves the characteristics on the new link rather than writing to a dead one', async () => {
    const { fake, transport, channel } = await connectedTrainer();
    const resolutionsBefore = controlPointResolutions(fake);
    fake.bench.device('kickr').drop();
    await settle();
    await transport.connect(TRAINER);

    await channel.writeControlPoint(Uint8Array.from([0x00]));

    expect(controlPointWrites(fake)).toHaveLength(1);
    // Two links, two resolutions of the control point characteristic. The first
    // link's handle is dead — Chrome rejects a write on it with
    // `InvalidStateError` — so a channel that cached it would report a setpoint
    // refused rather than a link that went.
    expect(controlPointResolutions(fake)).toBe(resolutionsBefore + 1);
  });
});

describe('the FTMS client, over this channel', () => {
  it('reports a target as confirmed only once the machine has answered', async () => {
    const { fake, channel, machine } = await connectedTrainer();
    const control = createTrainerControl(channel, { powerRange: powerRange(machine) });

    const requested = control.requestControl();
    await settle();
    answerLastWrite(fake);
    await requested;
    expect(control.hasControl()).toBe(true);

    const setting = control.setTargetPower(watts(250));
    await settle();
    // Written, and not yet answered: the client must not be claiming a target.
    expect(control.targetPower()).toEqual({ kind: 'none' });
    answerLastWrite(fake);
    await expect(setting).resolves.toBe(250);
    expect(control.targetPower()).toEqual({ kind: 'confirmed', target: 250 });

    control.close();
  });

  it('hears a withdrawn control permission through the status characteristic', async () => {
    const { fake, channel, machine } = await connectedTrainer();
    const control = createTrainerControl(channel, {
      powerRange: powerRange(machine),
      reacquireControl: false,
    });
    const lost: string[] = [];
    control.onControlLost((reason) => lost.push(reason));

    const requested = control.requestControl();
    await settle();
    answerLastWrite(fake);
    await requested;

    fake.bench
      .device('kickr')
      .notify(FITNESS_MACHINE_SERVICE, FITNESS_MACHINE_STATUS, Uint8Array.from([0xff]));

    expect(lost).toEqual(['permission-lost']);
    expect(control.hasControl()).toBe(false);

    control.close();
  });
});

/**
 * How many times the Fitness Machine Service has been resolved.
 *
 * Counted rather than asserted absolutely: `resolveLink` resolves the same
 * service for Indoor Bike Data when the link comes up, so the interesting
 * quantity is how the count *moves*, not what it is.
 */
function serviceResolutions(fake: FakeBluetooth): number {
  return fake.bench.operations.filter(
    (operation) => operation === `kickr:getPrimaryService:${FITNESS_MACHINE_SERVICE}`,
  ).length;
}

/**
 * How many times the control point *characteristic* has been resolved.
 *
 * Unlike the service, nothing else in the adapter asks for it — `resolveLink`
 * resolves Indoor Bike Data — so this counts exactly this channel's work.
 */
function controlPointResolutions(fake: FakeBluetooth): number {
  return fake.bench.operations.filter(
    (operation) => operation === `kickr:getCharacteristic:${FITNESS_MACHINE_CONTROL_POINT}`,
  ).length;
}
