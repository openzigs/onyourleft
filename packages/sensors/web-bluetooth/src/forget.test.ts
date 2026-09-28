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

import { seconds, type Seconds } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { isSensorError } from '../../src/errors';

import { DEFAULT_GATT_OPERATION_TIMEOUT } from './queue';
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

describe('a forget the browser never answers — #716', () => {
  /** Deadlines the test fires by hand, so the bound is a decision and not a race. */
  function manualClock() {
    const pending: { readonly fire: () => void; readonly after: Seconds }[] = [];
    return {
      pending,
      schedule: (callback: () => void, after: Seconds) => {
        const entry = { fire: callback, after };
        pending.push(entry);
        return () => {
          const index = pending.indexOf(entry);
          if (index !== -1) {
            pending.splice(index, 1);
          }
        };
      },
    };
  }

  function bounded(spec: FakeDeviceSpec, operationTimeout?: Seconds) {
    const fake = createFakeBluetooth({ devices: [spec] });
    const clock = manualClock();
    const transport = createWebBluetoothTransport({
      profiles: [stubMultiProfile],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
      schedule: clock.schedule,
      ...(operationTimeout === undefined ? {} : { operationTimeout }),
    });
    return { ...fake, transport, clock };
  }

  it('gives up at the queue’s own bound, and the device is forgotten here', async () => {
    const { transport, clock } = bounded(
      { ...stubTrainerDevice(), forgetNeverSettles: true },
      seconds(12),
    );
    const device = await transport.discover({ capabilities: ['power'] });
    await transport.connect(device.identity.id);

    let outcome: unknown = 'pending';
    const forgetting = transport.forget(device.identity.id).then(
      () => 'resolved',
      (error: unknown) => error,
    );
    void forgetting.then((settled) => {
      outcome = settled;
    });
    await flush();
    // Still waiting on the browser, and bounded by the SAME number the queue
    // holds a GATT operation to — the option, not a second constant.
    expect(outcome).toBe('pending');
    expect(clock.pending.map((deadline) => deadline.after)).toEqual([seconds(12)]);

    clock.pending[0]?.fire();
    await forgetting;

    expect(isSensorError(outcome, 'forget-timed-out')).toBe(true);
    expect(() => transport.connectionState(device.identity.id)).toThrow(
      expect.objectContaining({ code: 'device-not-found' }),
    );
  });

  it('can be chosen again and connects after the bound has passed', async () => {
    const { transport, clock } = bounded({ ...stubTrainerDevice(), forgetNeverSettles: true });
    const first = await transport.discover({ capabilities: ['power'] });
    await transport.connect(first.identity.id);
    const forgetting = transport.forget(first.identity.id).catch((error: unknown) => error);
    await flush();
    clock.pending.find((deadline) => deadline.after === DEFAULT_GATT_OPERATION_TIMEOUT)?.fire();
    expect(isSensorError(await forgetting, 'forget-timed-out')).toBe(true);

    const again = await transport.discover({ capabilities: ['power'] });
    await transport.connect(again.identity.id);
    expect(transport.connectionState(again.identity.id)).toBe('connected');
  });

  it('defaults to the queue’s default bound', async () => {
    const { transport, clock } = bounded({ ...stubTrainerDevice(), forgetNeverSettles: true });
    const device = await transport.discover({ capabilities: ['power'] });
    void transport.forget(device.identity.id).catch(() => undefined);
    await flush();
    expect(clock.pending.map((deadline) => deadline.after)).toEqual([
      DEFAULT_GATT_OPERATION_TIMEOUT,
    ]);
  });

  it('leaves no deadline behind when the browser answers, either way', async () => {
    const answered = bounded(stubTrainerDevice());
    const one = await answered.transport.discover({ capabilities: ['power'] });
    await answered.transport.forget(one.identity.id);
    expect(answered.clock.pending).toEqual([]);

    const refused = bounded({ ...stubTrainerDevice(), forgetRejects: true });
    const two = await refused.transport.discover({ capabilities: ['power'] });
    await expect(refused.transport.forget(two.identity.id)).rejects.toThrow('forget refused');
    expect(refused.clock.pending).toEqual([]);
  });
});
