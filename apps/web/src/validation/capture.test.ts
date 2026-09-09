// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The recorder, driven through the **real** transport against the scripted
 * Bluetooth stack.
 *
 * Not against a hand-built double of the port: what this file has to establish
 * is that a capture taken during an ordinary session contains the bytes that
 * session actually exchanged, and a double of the port would only establish
 * that the wrapper forwards calls somebody wrote by hand. `createFakeBluetooth`
 * is the same stack `trainer.test.ts` drives, so the traffic here is the
 * traffic the adapter really generates — reads on connect, notifications,
 * control point writes.
 */

import {
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_FEATURE,
  FITNESS_MACHINE_SERVICE,
  FITNESS_MACHINE_STATUS,
  INDOOR_BIKE_DATA,
  SUPPORTED_POWER_RANGE,
  SUPPORTED_RESISTANCE_LEVEL_RANGE,
  createIndoorBikeDataProfile,
} from '@onyourleft/sensors/protocol';
import {
  createWebBluetoothTransport,
  isUsableBluetooth,
  readAvailability,
} from '@onyourleft/sensors/web-bluetooth';
import {
  createFakeBluetooth,
  domError,
  type FakeBluetooth,
  type FakeDeviceSpec,
} from '@onyourleft/sensors/web-bluetooth/testing';
import { deviceId } from '@onyourleft/sensors';
import { describe, expect, it } from 'vitest';

import { createCapture, recordingBluetooth, toHex } from './capture';

const TRAINER = deviceId('kickr');

const POWER_RANGE_BYTES = Uint8Array.from([0, 0, 0xd0, 0x07, 5, 0]);
const RESISTANCE_RANGE_BYTES = Uint8Array.from([0, 0, 200, 0, 5, 0]);
const FEATURE_BYTES = Uint8Array.from([0x82, 0, 0, 0, 0x08, 0x20, 0, 0]);

function trainer(): FakeDeviceSpec {
  return {
    id: 'kickr',
    // A name that would identify the owner if the log carried one. It does not,
    // and one of the assertions below is that it does not.
    name: "Alex Morgan's KICKR",
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
  };
}

/**
 * A steady clock, so the offsets in an assertion are the ones written here.
 *
 * ⚠️ **It starts at a plausible wall-clock instant, and that is load-bearing.**
 * An earlier version started at 1 000 ms, and the mutation that stamps every
 * event with `now()` instead of `now() - began` came back **green**: absolute
 * values of ~1 010 are indistinguishable from offsets to an assertion that only
 * bounds them. Starting where `Date.now()` actually is makes an absolute stamp
 * about 1.76e12, which no offset from a session that lasted a second can be.
 */
function steadyClock(): () => number {
  let at = 1_757_000_000_000;
  return () => {
    at += 10;
    return at;
  };
}

async function connected(capture = createCapture(steadyClock())) {
  const fake = createFakeBluetooth({ devices: [trainer()] });
  const transport = createWebBluetoothTransport({
    profiles: [createIndoorBikeDataProfile()],
    bluetooth: recordingBluetooth(fake.bluetooth, capture),
  });
  await transport.discover({ capabilities: ['power'] });
  await transport.connect(TRAINER);
  return { fake, transport, capture };
}

/** Let the fake stack's microtasks and the transport's queue turn. */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Refuse the write that is in flight, at the ATT layer.
 *
 * ⚠️ **`drop()` is a different case and would not exercise this at all.** A
 * dropped link is refused *above* the characteristic — the transport re-resolves
 * the service, finds no connection and rejects before a write is ever issued —
 * so nothing crosses the platform boundary and a capture correctly contains
 * nothing. #137's second item is the other one: the write reached the machine
 * and the machine said no. Holding the operation and failing it is the only way
 * to reach that from here.
 */
function refuseHeldWrite(fake: FakeBluetooth, error: Error): void {
  const held = fake.bench.held.find((each) => each.operation === 'writeValueWithResponse');
  if (held === undefined) {
    throw new Error('no control point write is in flight to refuse');
  }
  held.fail(error);
}

describe('what a capture contains after an ordinary session', () => {
  it('records the reads the adapter performs when the machine is opened', async () => {
    // The three FTMS descriptor-shaped characteristics are reads rather than
    // notifications, and #49 makes reading them a requirement: a setpoint has
    // to be bounded by the range the device reported. So they are the first
    // thing a real capture should show, and their absence in one would say the
    // machine never reported its limits.
    const { capture, transport } = await connected();
    const machine = await transport.openFitnessMachine(TRAINER);

    const reads = capture.events.filter((event) => event.kind === 'read');
    expect(reads.map((event) => event.characteristic)).toEqual(
      expect.arrayContaining([
        SUPPORTED_POWER_RANGE,
        SUPPORTED_RESISTANCE_LEVEL_RANGE,
        FITNESS_MACHINE_FEATURE,
      ]),
    );
    // The bytes, not our reading of them — #134 wants the wire form so a
    // disagreement between the spec and a real device is visible.
    const range = reads.find((event) => event.characteristic === SUPPORTED_POWER_RANGE);
    expect(range?.hex).toBe('0000d0070500');
    expect(machine.powerRange).toEqual({ minimum: 0, maximum: 2000, increment: 5 });
  });

  it('records a notification as the bytes the device sent', async () => {
    const { capture, fake, transport } = await connected();
    await transport.subscribe(TRAINER, 'power', () => {});

    // Flags with instantaneous power present, then 180 W little-endian.
    fake.bench
      .device('kickr')
      .notify(
        FITNESS_MACHINE_SERVICE,
        INDOOR_BIKE_DATA,
        Uint8Array.from([0x40, 0x00, 0x00, 0x00, 0xb4, 0x00]),
      );

    const notifications = capture.events.filter((event) => event.kind === 'notify');
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.characteristic).toBe(INDOOR_BIKE_DATA);
    expect(notifications[0]?.hex).toBe('400000 00b400'.replaceAll(' ', ''));
  });

  it('stamps an offset from the start rather than a wall-clock instant', async () => {
    // A committed fixture that says when somebody was riding is a small fact
    // about their life, and the analysis needs the intervals anyway.
    const { capture, transport } = await connected();
    // Connecting alone exchanges nothing worth recording — the FTMS reads are
    // performed when the machine is opened, so that is where the first event is.
    await transport.openFitnessMachine(TRAINER);

    expect(capture.events.length).toBeGreaterThan(0);
    for (const event of capture.events) {
      expect(event.atMs).toBeGreaterThanOrEqual(0);
      expect(event.atMs).toBeLessThan(60_000);
    }
  });

  it('carries no device name, and only the hardware a person typed', async () => {
    // The one assertion about what is NOT in the file. A trainer's advertised
    // name is routinely the owner's, and a capture is committed as a fixture.
    const { capture } = await connected();

    const serialised = JSON.stringify(capture.log('Wahoo KICKR CORE, firmware 4.2.1'));
    expect(serialised).not.toContain('Alex Morgan');
    expect(serialised).toContain('Wahoo KICKR CORE, firmware 4.2.1');
  });

  it('is a document that says what it is, and its version', async () => {
    const { capture } = await connected();
    const log = capture.log('a trainer');

    // ADR 0017 D-3's shape: one key that is both identity and version, so the
    // two cannot disagree with each other.
    expect(log.onYourLeftCapture).toBe(1);
    expect(() => JSON.parse(JSON.stringify(log)) as unknown).not.toThrow();
  });
});

describe('a write, and a write that was refused', () => {
  it('records the control point write the client actually made', async () => {
    const { capture, transport } = await connected();
    const machine = await transport.openFitnessMachine(TRAINER);

    await machine.channel.writeControlPoint(Uint8Array.from([0x00]));

    const writes = capture.events.filter((event) => event.kind === 'write');
    expect(writes.map((event) => event.characteristic)).toContain(FITNESS_MACHINE_CONTROL_POINT);
    expect(writes.at(-1)?.hex).toBe('00');
  });

  it('records a refusal as a refusal, with the reason', async () => {
    // #137's second item, and the only place an ATT error is observable: a
    // refused command is a rejected promise and nothing else. A capture that
    // showed the write and not the refusal would read as a command that took
    // effect.
    const { capture, fake, transport } = await connected();
    const machine = await transport.openFitnessMachine(TRAINER);

    fake.bench.hold('writeValueWithResponse');
    // 0x05 is Set Target Power; 0x00c8 is 200 W little-endian.
    const refused = machine.channel.writeControlPoint(Uint8Array.from([0x05, 0xc8, 0x00]));
    await settle();
    refuseHeldWrite(fake, domError('NetworkError', 'GATT operation failed for unknown reason'));

    await expect(refused).rejects.toThrow();

    const rejections = capture.events.filter((event) => event.kind === 'write-rejected');
    expect(rejections).toHaveLength(1);
    expect(rejections[0]?.error).toContain('GATT operation failed');
    // The bytes that were refused, so the write-up can say which command it was.
    expect(rejections[0]?.hex).toBe('05c800');
    // And it is NOT also recorded as a write. A capture that carried both would
    // say the machine was set to 200 W, which is the reading this whole event
    // kind exists to prevent.
    expect(
      capture.events.filter(
        (event) => event.kind === 'write' && event.characteristic === FITNESS_MACHINE_CONTROL_POINT,
      ),
    ).toEqual([]);
  });

  it('rethrows rather than swallowing, so the client still sees the failure', async () => {
    // The recorder must not change the behaviour under observation. On the one
    // path that applies resistance to a rider, a tidier log is not a trade
    // worth making — and the error the client catches has to be the one the
    // stack raised, because that is what names the ATT reason.
    const { fake, transport } = await connected();
    const machine = await transport.openFitnessMachine(TRAINER);

    fake.bench.hold('writeValueWithResponse');
    const refused = machine.channel.writeControlPoint(Uint8Array.from([0x00]));
    await settle();
    refuseHeldWrite(fake, domError('NetworkError', 'GATT operation failed for unknown reason'));

    await expect(refused).rejects.toThrow(/GATT operation failed/);
  });
});

describe('the wrapper does not deform the port', () => {
  // ⚠️ **What `capture.browser.spec.ts` asserts against the real
  // `navigator.bluetooth`, asserted here against the scripted one.** That spec
  // cannot be run in this container — the pinned Chromium is not fetchable
  // behind the egress proxy — so the claim it makes in CI is duplicated here in
  // the suite a contributor runs on every save. The two are not redundant: only
  // the browser can say the wrapper survives contact with a real Bluetooth
  // object, and only this can be run before pushing.

  it('answers availability the same way wrapped as unwrapped', async () => {
    const fake = createFakeBluetooth({ devices: [trainer()] });
    const capture = createCapture(steadyClock());

    const wrapped = recordingBluetooth(fake.bluetooth, capture);
    expect((await readAvailability(wrapped)).kind).toBe(
      (await readAvailability(fake.bluetooth)).kind,
    );
    // And it is a usable port by #40's own two-method test, which is what the
    // transport gates on before it will drive anything.
    expect(isUsableBluetooth(wrapped)).toBe(true);
    // Asking is not traffic. An availability probe crosses no GATT boundary, so
    // a capture that recorded one would be recording our own questions.
    expect(capture.events).toEqual([]);
  });

  it('reports the radio being off as the raw port does', async () => {
    const fake = createFakeBluetooth({ devices: [trainer()] });
    fake.bench.setAvailability(false);

    const wrapped = recordingBluetooth(fake.bluetooth, createCapture(steadyClock()));

    expect((await readAvailability(wrapped)).kind).toBe('adapter-unavailable');
  });
});

describe('the file name', () => {
  it('carries a counter rather than a wall-clock instant', () => {
    // The same rule as the events: a committed fixture should not say when
    // somebody was riding, and a file *name* is the easy place to leak it back.
    const capture = createCapture(steadyClock());

    expect(capture.fileName()).toBe('capture-1.json');
    expect(capture.fileName()).toBe('capture-2.json');
    expect(capture.fileName()).not.toMatch(/\d{10,}/);
  });
});

describe('toHex', () => {
  it('is lowercase, zero-padded and unseparated', () => {
    // The shape a fixture is diffed in. A separator or a capital would make two
    // captures of the same frame look different in review.
    expect(toHex(new DataView(Uint8Array.from([0x00, 0x0f, 0xa0, 0xff]).buffer))).toBe('000fa0ff');
  });

  it('is empty for an empty payload rather than throwing', () => {
    expect(toHex(new DataView(new ArrayBuffer(0)))).toBe('');
  });
});
