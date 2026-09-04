// SPDX-License-Identifier: Apache-2.0

/**
 * The chooser: what it is asked for, what a refusal means, and the gesture.
 *
 * Revision 2 of #1: *"Pairing is one user gesture per device, by design.
 * `requestDevice()` requires a gesture and cannot be called programmatically,
 * and `optionalServices` must be declared up front or `getPrimaryService`
 * throws. A trainer plus two sensors is three separate clicks — #49's UX must
 * not be written as though one 'pair everything' button were possible."*
 */

import { describe, expect, it } from 'vitest';

import { isSensorError } from '../../src/errors';

import { canonicalUuid } from './profile';
import { createWebBluetoothTransport } from './transport';
import { createFakeBluetooth, domError } from './testing/fake-bluetooth';
import {
  STUB_HEART_RATE_SERVICE,
  STUB_MULTI_SERVICE,
  STUB_SINGLE_SERVICE,
  stubHeartRateProfile,
  stubMultiProfile,
  stubSingleProfile,
  stubStrapDevice,
  stubTrainerDevice,
} from './testing/profiles';

function fixture(options: { readonly gesture?: boolean } = {}) {
  const fake = createFakeBluetooth({ devices: [stubTrainerDevice(), stubStrapDevice()] });
  const transport = createWebBluetoothTransport({
    // Multi before single, so a device serving both takes power from multi.
    profiles: [stubMultiProfile, stubSingleProfile, stubHeartRateProfile],
    bluetooth: fake.bluetooth,
    hasUserActivation: () => options.gesture ?? true,
  });
  return { ...fake, transport };
}

describe('discover', () => {
  it('refuses without a user gesture, before it touches the chooser', async () => {
    const { transport, bench } = fixture({ gesture: false });
    await transport.discover({ capabilities: ['power'] }).then(
      () => expect.unreachable('requestDevice cannot be called programmatically'),
      (error: unknown) => expect(isSensorError(error, 'user-gesture-required')).toBe(true),
    );
    // The check is *before* the call, not a mapping of the failure afterwards.
    // Chrome reports a missing gesture as `SecurityError` — the same name it
    // uses for a Permissions Policy refusal — so a mapping written afterwards
    // has to match on an unversioned exception message to tell them apart.
    expect(bench.requests).toHaveLength(0);
  });

  it('says so in its traits, so a caller does not offer scan-on-load', () => {
    expect(fixture().transport.traits.requiresUserGestureToDiscover).toBe(true);
  });

  it('filters on the services that supply the requested capabilities', async () => {
    const { transport, bench } = fixture();
    await transport.discover({ capabilities: ['heart-rate'] });

    const request = bench.requests[0];
    expect(request?.filters?.map((filter) => filter.services?.[0])).toEqual([
      canonicalUuid(STUB_HEART_RATE_SERVICE),
    ]);
  });

  it('declares every registered service as optional, not only the filtered ones', async () => {
    const { transport, bench } = fixture();
    await transport.discover({ capabilities: ['heart-rate'] });

    // `getPrimaryService` on a service that was in neither `filters` nor
    // `optionalServices` rejects with `SecurityError` whatever the device
    // offers. Passing only the filtered service is the mistake that makes a
    // trainer's second profile permanently unreachable.
    expect(new Set(bench.requests[0]?.optionalServices)).toEqual(
      new Set([
        canonicalUuid(STUB_MULTI_SERVICE),
        canonicalUuid(STUB_SINGLE_SERVICE),
        canonicalUuid(STUB_HEART_RATE_SERVICE),
      ]),
    );
  });

  it('offers one filter per supplying service, so either one matches', async () => {
    const { transport, bench } = fixture();
    await transport.discover({ capabilities: ['power'] });

    expect(new Set(bench.requests[0]?.filters?.map((filter) => filter.services?.[0]))).toEqual(
      new Set([canonicalUuid(STUB_MULTI_SERVICE), canonicalUuid(STUB_SINGLE_SERVICE)]),
    );
  });

  it('carries a name prefix into every filter', async () => {
    const { transport, bench } = fixture();
    await transport.discover({ capabilities: ['power'], namePrefix: 'STUB' });
    expect(bench.requests[0]?.filters?.every((filter) => filter.namePrefix === 'STUB')).toBe(true);
  });

  it('opens the chooser wide when no capability is named', async () => {
    const { transport, bench } = fixture();
    await transport.discover({ capabilities: [] });
    expect(bench.requests[0]?.acceptAllDevices).toBe(true);
    expect(bench.requests[0]?.filters).toBeUndefined();
  });

  it('narrows a wide chooser by name when one is given', async () => {
    const { transport, bench } = fixture();
    await transport.discover({ capabilities: [], namePrefix: 'STUB' });
    expect(bench.requests[0]?.acceptAllDevices).toBeUndefined();
    expect(bench.requests[0]?.filters).toEqual([{ namePrefix: 'STUB' }]);
  });

  it('refuses a capability no registered profile supplies', async () => {
    const fake = createFakeBluetooth({ devices: [stubStrapDevice()] });
    const transport = createWebBluetoothTransport({
      profiles: [stubHeartRateProfile],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
    });
    await transport.discover({ capabilities: ['power'] }).then(
      () => expect.unreachable('no profile supplies power here'),
      (error: unknown) => expect(isSensorError(error, 'capability-unsupported')).toBe(true),
    );
    expect(fake.bench.requests).toHaveLength(0);
  });

  it('renders a cancelled chooser as no-device-selected, not as a fault', async () => {
    const { transport, bench } = fixture();
    bench.setChooser({ kind: 'cancel' });
    await transport.discover({ capabilities: ['power'] }).then(
      () => expect.unreachable('the chooser was cancelled'),
      (error: unknown) => expect(isSensorError(error, 'no-device-selected')).toBe(true),
    );
  });

  it('maps a Permissions Policy refusal to not-permitted', async () => {
    const { transport, bench } = fixture();
    bench.setChooser({
      kind: 'fail',
      error: domError('SecurityError', 'requestDevice() called from cross-origin iframe'),
    });
    await transport.discover({ capabilities: ['power'] }).then(
      () => expect.unreachable('a cross-origin iframe may not pair'),
      (error: unknown) => expect(isSensorError(error, 'not-permitted')).toBe(true),
    );
  });

  it('maps NotSupportedError to transport-unsupported', async () => {
    const { transport, bench } = fixture();
    bench.setChooser({ kind: 'fail', error: domError('NotSupportedError') });
    await transport.discover({ capabilities: ['power'] }).then(
      () => expect.unreachable('this platform will not serve the request'),
      (error: unknown) => expect(isSensorError(error, 'transport-unsupported')).toBe(true),
    );
  });

  it('keeps the platform failure as cause, and out of the message', async () => {
    const { transport, bench } = fixture();
    const platform = domError('SecurityError', 'Bluetooth device 4C:0B:AE:12:34:56 refused');
    bench.setChooser({ kind: 'fail', error: platform });
    await transport.discover({ capabilities: ['power'] }).then(
      () => expect.unreachable('refused'),
      (error: unknown) => {
        // SECURITY.md treats a BLE error naming a device address as a
        // disclosure, and Chrome's messages name them.
        expect((error as Error).message).not.toContain('4C:0B:AE');
        expect((error as Error).cause).toBe(platform);
      },
    );
  });

  it('issues a device scoped to this transport, starting disconnected', async () => {
    const { transport } = fixture();
    const device = await transport.discover({ capabilities: ['power', 'cadence'] });

    expect(device.identity.transport).toBe(transport.traits.id);
    expect(device.identity.id).toBe('stub-trainer');
    expect(device.name).toBe('STUB TRAINER 1F2A');
    expect(device.capabilities).toEqual(new Set(['power', 'cadence']));
    expect(transport.connectionState(device.identity.id)).toBe('disconnected');
  });

  it('returns the same device for a second discovery of the same id', async () => {
    const { transport } = fixture();
    const first = await transport.discover({ capabilities: ['power'] });
    const second = await transport.discover({ capabilities: ['power'] });
    expect(second).toBe(first);
  });

  it('reports no known devices, because none can be reached without a gesture', async () => {
    const { transport } = fixture();
    await transport.discover({ capabilities: ['power'] });
    // `getDevices()` is behind chrome://flags and is not shippable in 2026.
    // Returning the paired device here would be reporting one that a page
    // reload cannot reconnect.
    await expect(transport.knownDevices()).resolves.toEqual([]);
  });

  it('rejects rather than throwing when the id the platform returned is blank', async () => {
    const fake = createFakeBluetooth({
      devices: [{ id: '   ', name: 'blank', services: [stubStrapDevice().services[0]!] }],
    });
    const transport = createWebBluetoothTransport({
      profiles: [stubHeartRateProfile],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
    });
    // A blank id aliases every device to every other in a `deviceId`-keyed
    // interface. `deviceId()` throws; `discover` must turn that into a rejection
    // rather than an exception in a click handler.
    await transport.discover({ capabilities: ['heart-rate'] }).then(
      () => expect.unreachable('a blank device id must not be accepted'),
      (error: unknown) => expect(isSensorError(error, 'invalid-device-id')).toBe(true),
    );
  });
});
