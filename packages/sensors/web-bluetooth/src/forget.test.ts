// SPDX-License-Identifier: Apache-2.0

/**
 * `forget` on the Web Bluetooth adapter — #659, the Devices screen's *Forget*.
 *
 * The conformance suite (`../../src/simulator/conformance.ts`) holds the part
 * every transport shares: a forgotten id is refused until `discover` returns
 * it. What is this adapter's alone is the PERMISSION — `BluetoothDevice.forget()`
 * revokes the origin's grant, and it is optional in the wild — so that is what
 * is asserted here, against the scripted stack, whose `forget()` clears the
 * grant exactly as the specification says.
 */

import { describe, expect, it } from 'vitest';

import { isSensorError } from '../../src/errors';

import { createWebBluetoothTransport } from './transport';
import { createFakeBluetooth, type FakeDeviceSpec } from './testing/fake-bluetooth';
import {
  multiFrame,
  STUB_MULTI_CHARACTERISTIC,
  STUB_MULTI_SERVICE,
  stubMultiProfile,
  stubTrainerDevice,
} from './testing/profiles';

const flush = (): Promise<void> => new Promise((resolve) => void setTimeout(resolve, 0));

function fixture(spec: FakeDeviceSpec = stubTrainerDevice()) {
  const fake = createFakeBluetooth({ devices: [spec] });
  const transport = createWebBluetoothTransport({
    profiles: [stubMultiProfile],
    bluetooth: fake.bluetooth,
    hasUserActivation: () => true,
  });
  return { ...fake, transport };
}

describe('forgetting a device on Web Bluetooth', () => {
  it('revokes the origin’s grant through BluetoothDevice.forget(), once', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);
    const trainer = bench.device('stub-trainer');
    expect(trainer.allowedServices.length).toBeGreaterThan(0);

    await transport.forget(device.identity.id);

    expect(trainer.forgets).toBe(1);
    // The grant itself — which is the whole reason to call it rather than only
    // dropping the link — and the link, which the browser drops too.
    expect(trainer.allowedServices).toEqual([]);
    expect(trainer.connected).toBe(false);
    // A second press does not ask the browser again: the record is gone.
    await transport.forget(device.identity.id);
    expect(trainer.forgets).toBe(1);
  });

  it('still forgets in a browser that predates forget(), by dropping the link and the record', async () => {
    const { transport, bench } = fixture({ ...stubTrainerDevice(), withoutForget: true });
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);

    await transport.forget(device.identity.id);

    expect(bench.device('stub-trainer').connected).toBe(false);
    expect(bench.operations).toContain('stub-trainer:disconnect');
    expect(() => transport.connectionState(device.identity.id)).toThrow();
  });

  it('lets go of the record even when the browser refuses to revoke the grant', async () => {
    const { transport } = fixture({ ...stubTrainerDevice(), forgetRejects: true });
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);

    await expect(transport.forget(device.identity.id)).rejects.toThrow('forget refused');

    let refused: unknown;
    try {
      transport.connectionState(device.identity.id);
    } catch (error) {
      refused = error;
    }
    expect(isSensorError(refused, 'device-not-found')).toBe(true);
  });

  it('drives nothing from a disconnect event that lands after the forget', async () => {
    const { transport, bench } = fixture();
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);
    const heard: unknown[] = [];
    await transport.subscribe(device.identity.id, 'power', (m) => heard.push(m));

    await transport.forget(device.identity.id);
    await flush();

    const trainer = bench.device('stub-trainer');
    expect(trainer.disconnectListeners).toBe(0);
    trainer.notify(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC, multiFrame(200, 90, 90));
    expect(heard).toEqual([]);
  });

  it('can be chosen again, and the new grant reaches the device', async () => {
    const { transport, bench } = fixture();
    const first = await transport.discover({ capabilities: ['power'] });
    await transport.connect(first.identity.id);
    await transport.forget(first.identity.id);

    const again = await transport.discover({ capabilities: ['power'] });
    await transport.connect(again.identity.id);
    const heard: unknown[] = [];
    await transport.subscribe(again.identity.id, 'power', (m) => heard.push(m));
    bench
      .device('stub-trainer')
      .notify(STUB_MULTI_SERVICE, STUB_MULTI_CHARACTERISTIC, multiFrame(200, 90, 90));

    expect(transport.connectionState(again.identity.id)).toBe('connected');
    expect(heard.length).toBeGreaterThan(0);
  });
});
