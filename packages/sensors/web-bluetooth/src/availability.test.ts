// SPDX-License-Identifier: Apache-2.0

/**
 * #40's fourth acceptance criterion, and Revision 2 of #1's addition to it.
 *
 * *"A test proves the adapter reports `unavailable` cleanly when
 * `navigator.bluetooth` is absent, rather than throwing — this is the Safari and
 * Firefox path and it must be graceful."* And: *"the adapter's `unavailable`
 * path must cover Linux-without-the-flag, not only '`navigator.bluetooth` is
 * absent' — on Linux the object may be present and the adapter still unusable."*
 *
 * Every one of these runs under Vitest's `node` environment, where `navigator`
 * exists and has no `bluetooth` on it. That is not a contrivance: it is the same
 * shape as Safari, as Firefox, and as any browser on a page served over plain
 * HTTP, and it is why the last test in this file constructs the adapter with no
 * `bluetooth` option at all rather than passing `undefined` explicitly.
 */

import { describe, expect, it } from 'vitest';

import { isSensorError } from '../../src/errors';
import type { TransportAvailability } from '../../src/transport';

import { isUsableBluetooth, readAvailability } from './availability';
import type { BluetoothPort } from './gatt';
import { createWebBluetoothTransport } from './transport';
import { createFakeBluetooth } from './testing/fake-bluetooth';
import { stubHeartRateProfile } from './testing/profiles';

const transportFor = (bluetooth: BluetoothPort | undefined) =>
  createWebBluetoothTransport({ profiles: [stubHeartRateProfile], bluetooth });

describe('readAvailability', () => {
  it('reports unsupported when there is no Bluetooth object at all', async () => {
    await expect(readAvailability(undefined)).resolves.toEqual({ kind: 'unsupported' });
  });

  it('reports unsupported for a partial implementation missing getAvailability', async () => {
    // Chrome on Linux without chrome://flags/#enable-experimental-web-platform-features:
    // the object is there and the API is not all there. A feature detect written
    // as `'bluetooth' in navigator` calls this available.
    const partial = { requestDevice: () => Promise.reject(new Error('never')) };
    await expect(readAvailability(partial as unknown as BluetoothPort)).resolves.toEqual({
      kind: 'unsupported',
    });
  });

  it('reports unsupported for a partial implementation missing requestDevice', async () => {
    const partial = { getAvailability: () => Promise.resolve(true) };
    await expect(readAvailability(partial as unknown as BluetoothPort)).resolves.toEqual({
      kind: 'unsupported',
    });
  });

  it('reports unsupported when getAvailability itself rejects', async () => {
    const { bluetooth, bench } = createFakeBluetooth({ devices: [] });
    bench.setAvailabilityThrows(true);
    await expect(readAvailability(bluetooth)).resolves.toEqual({ kind: 'unsupported' });
  });

  it('distinguishes a radio that is switched off from a browser that cannot', async () => {
    const { bluetooth, bench } = createFakeBluetooth({ devices: [] });
    bench.setAvailability(false);
    // `adapter-unavailable`, not `unsupported`: this one is recoverable, and the
    // honest UI is "switch Bluetooth on" rather than "install the app".
    await expect(readAvailability(bluetooth)).resolves.toEqual({ kind: 'adapter-unavailable' });
  });

  it('reports available when the stack is whole and the radio is on', async () => {
    const { bluetooth } = createFakeBluetooth({ devices: [] });
    await expect(readAvailability(bluetooth)).resolves.toEqual({ kind: 'available' });
  });
});

describe('isUsableBluetooth', () => {
  it('requires both methods, not either', () => {
    expect(isUsableBluetooth(undefined)).toBe(false);
    expect(
      isUsableBluetooth({
        requestDevice: () => Promise.reject(new Error('never')),
      } as unknown as BluetoothPort),
    ).toBe(false);
    expect(
      isUsableBluetooth({
        getAvailability: () => Promise.resolve(true),
      } as unknown as BluetoothPort),
    ).toBe(false);
    expect(isUsableBluetooth(createFakeBluetooth({ devices: [] }).bluetooth)).toBe(true);
  });
});

describe('the adapter on a browser that cannot run it', () => {
  it('constructs without throwing when there is no Bluetooth at all', () => {
    expect(() => transportFor(undefined)).not.toThrow();
  });

  it('answers availability rather than throwing', async () => {
    await expect(transportFor(undefined).availability()).resolves.toEqual({ kind: 'unsupported' });
  });

  it('refuses discovery with transport-unsupported rather than a TypeError', async () => {
    const transport = createWebBluetoothTransport({
      profiles: [stubHeartRateProfile],
      bluetooth: undefined,
      hasUserActivation: () => true,
    });
    await transport.discover({ capabilities: ['heart-rate'] }).then(
      () => expect.unreachable('Safari and Firefox cannot discover anything'),
      (error: unknown) => {
        expect(isSensorError(error, 'transport-unsupported')).toBe(true);
        expect(error).not.toBeInstanceOf(TypeError);
      },
    );
  });

  it('refuses discovery with adapter-unavailable when the radio is off', async () => {
    const { bluetooth, bench } = createFakeBluetooth({ devices: [] });
    bench.setAvailability(false);
    const transport = createWebBluetoothTransport({
      profiles: [stubHeartRateProfile],
      bluetooth,
      hasUserActivation: () => true,
    });
    await transport.discover({ capabilities: ['heart-rate'] }).then(
      () => expect.unreachable('a switched-off radio cannot show a chooser'),
      (error: unknown) => expect(isSensorError(error, 'adapter-unavailable')).toBe(true),
    );
  });

  it('reads navigator.bluetooth by default, and finds none under Node', async () => {
    // No `bluetooth` key at all, so the default path runs. Under Vitest's `node`
    // environment `navigator` exists and has no `bluetooth`, which is the same
    // shape Safari and Firefox present — the answer must be an availability
    // rather than a `TypeError` reading a property of undefined.
    const transport = createWebBluetoothTransport({ profiles: [stubHeartRateProfile] });
    const availability: TransportAvailability = await transport.availability();
    expect(availability).toEqual({ kind: 'unsupported' });
  });

  it('tolerates a stack with no availabilitychanged event', async () => {
    const { bluetooth } = createFakeBluetooth({ devices: [], withoutEvents: true });
    const transport = createWebBluetoothTransport({
      profiles: [stubHeartRateProfile],
      bluetooth,
    });
    await expect(transport.availability()).resolves.toEqual({ kind: 'available' });
  });
});
