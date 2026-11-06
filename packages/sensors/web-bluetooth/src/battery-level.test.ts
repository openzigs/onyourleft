// SPDX-License-Identifier: Apache-2.0

/**
 * `readBatteryLevel` — #2047, the transport half: a connected device's
 * Battery Level read once through the device's queue and #2046's parser.
 *
 * ⚠️ **The grant is the property under test as much as the read.** The
 * Battery Service is added to a request's `optionalServices` only when the
 * transport was built with `batteryLevel: true` (#132 keeps the grant to what
 * was asked for), and the fake refuses an ungranted service exactly as Chrome
 * does, so a transport built without it reads nothing from a strap that
 * serves a battery.
 *
 * ⚠️ **"No level" is `undefined`, never 0.** Every way there is no level to
 * report — no service, no link, a refused value, a read that failed — is
 * asserted to be `undefined`.
 */

import { describe, expect, it } from 'vitest';

import { BATTERY_LEVEL, BATTERY_SERVICE } from '../../protocol/src/battery';
import {
  HEART_RATE_MEASUREMENT,
  HEART_RATE_SERVICE,
  heartRateProfile,
} from '../../protocol/src/index';
import { deviceId } from '../../src/device';
import { isSensorError } from '../../src/errors';

import { createFakeBluetooth, domError, type FakeDeviceSpec } from './testing/fake-bluetooth';
import { createWebBluetoothTransport } from './transport';

const STRAP = deviceId('strap');

function strap(battery: readonly number[] | undefined): FakeDeviceSpec {
  return {
    id: 'strap',
    name: 'HRM 04B1',
    services: [
      { uuid: HEART_RATE_SERVICE, characteristics: [HEART_RATE_MEASUREMENT] },
      ...(battery === undefined
        ? []
        : [
            {
              uuid: BATTERY_SERVICE,
              characteristics: [BATTERY_LEVEL],
              readValues: { [BATTERY_LEVEL]: Uint8Array.from(battery) },
            },
          ]),
    ],
  };
}

function bench(device: FakeDeviceSpec, batteryLevel: boolean) {
  const fake = createFakeBluetooth({ devices: [device] });
  const errors: unknown[] = [];
  const transport = createWebBluetoothTransport({
    profiles: [heartRateProfile],
    bluetooth: fake.bluetooth,
    batteryLevel,
    onProtocolError: (error) => errors.push(error),
  });
  return { fake, transport, errors };
}

async function pairedStrap(battery: readonly number[] | undefined, batteryLevel = true) {
  const rig = bench(strap(battery), batteryLevel);
  await rig.transport.discover({ capabilities: ['heart-rate'] });
  await rig.transport.connect(STRAP);
  return rig;
}

describe('readBatteryLevel — #2047', () => {
  it('reads a connected strap’s level as a percent', async () => {
    const { transport, fake } = await pairedStrap([37]);
    expect(await transport.readBatteryLevel(STRAP)).toBe(37);
    // Asked for beside the heart rate service, and never as a filter.
    expect(fake.bench.requests.at(-1)?.optionalServices).toEqual([
      HEART_RATE_SERVICE,
      BATTERY_SERVICE,
    ]);
    expect(fake.bench.requests.at(-1)?.filters).toEqual([{ services: [HEART_RATE_SERVICE] }]);
  });

  it('reads an empty battery as 0 and a full one as 100 — the two ends are real levels', async () => {
    expect(await (await pairedStrap([0])).transport.readBatteryLevel(STRAP)).toBe(0);
    expect(await (await pairedStrap([100])).transport.readBatteryLevel(STRAP)).toBe(100);
  });

  it('built without batteryLevel, asks for no battery and reads none, even from a strap that has one', async () => {
    const { transport, fake } = await pairedStrap([37], false);
    expect(fake.bench.requests.at(-1)?.optionalServices).toEqual([HEART_RATE_SERVICE]);
    expect(await transport.readBatteryLevel(STRAP)).toBeUndefined();
  });

  it('a device that serves no Battery Service has no level — undefined, not 0', async () => {
    const { transport } = await pairedStrap(undefined);
    expect(await transport.readBatteryLevel(STRAP)).toBeUndefined();
  });

  it('no link, no level', async () => {
    const { transport } = await pairedStrap([37]);
    await transport.disconnect(STRAP);
    expect(await transport.readBatteryLevel(STRAP)).toBeUndefined();
  });

  it.each([
    ['a value past 100', [101], 'out-of-range'],
    ['two octets', [37, 0], 'wrong-length'],
  ] as const)('%s is refused: no level, and the reason reported', async (_name, bytes, kind) => {
    const { transport, errors } = await pairedStrap(bytes);
    expect(await transport.readBatteryLevel(STRAP)).toBeUndefined();
    expect(errors).toEqual([expect.objectContaining({ kind, field: 'battery level' })]);
  });

  it('a read the device fails is no level, not a rejection', async () => {
    const { transport, fake } = await pairedStrap([37]);
    fake.bench.hold('readValue');
    const read = transport.readBatteryLevel(STRAP);
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const held of fake.bench.held) {
      held.fail(domError('NetworkError', 'GATT operation failed'));
    }
    expect(await read).toBeUndefined();
  });

  it('an id this transport did not issue is refused, as resolvedUuids refuses it', async () => {
    const { transport } = bench(strap([37]), true);
    const refused = await transport.readBatteryLevel(deviceId('nobody')).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(isSensorError(refused, 'device-not-found')).toBe(true);
  });
});
