// SPDX-License-Identifier: Apache-2.0

/**
 * Device identity is scoped to the transport that issued it.
 *
 * The test that matters here is the second one. Comparing two devices on their
 * id alone passes every test a single-platform suite contains, because within
 * one platform the transport is always the same — it is the shape CLAUDE.md §5
 * calls out as "a query matching on an entity id without the column that scopes
 * it", and it surfaces for the first time when a remembered device from one
 * stack is checked against a device on another.
 */

import { describe, expect, it } from 'vitest';

import {
  ANDROID_BLE,
  CORE_BLUETOOTH,
  deviceId,
  deviceProvides,
  isSensorError,
  sameDevice,
  SIMULATED,
  transportId,
  WEB_BLUETOOTH,
  type SensorDevice,
} from './index';

describe('labelling a device id', () => {
  it('accepts the opaque strings the stacks actually issue', () => {
    // A Web Bluetooth per-origin id, a CoreBluetooth peripheral UUID and an
    // Android MAC. Nothing about their shape is checked, deliberately: they are
    // opaque, and a format guard here would reject the next stack.
    expect(deviceId('DdaWNVCJUqIGdgJDN0hnbQ==')).toBe('DdaWNVCJUqIGdgJDN0hnbQ==');
    expect(deviceId('4E7B2F9C-1A3D-4F58-9E21-0C6A7B8D1E2F')).toBe(
      '4E7B2F9C-1A3D-4F58-9E21-0C6A7B8D1E2F',
    );
    expect(deviceId('C4:2C:03:1A:9B:7E')).toBe('C4:2C:03:1A:9B:7E');
  });

  it('rejects an empty or blank id, because a blank id aliases every device', () => {
    expect(() => deviceId('')).toThrow(/must not be empty/);
    expect(() => deviceId('   ')).toThrow(/must not be empty/);
    try {
      deviceId('');
      expect.unreachable('deviceId("") must throw');
    } catch (error) {
      expect(isSensorError(error, 'invalid-device-id')).toBe(true);
    }
  });

  it('rejects an empty transport id for the same reason', () => {
    expect(() => transportId(' ')).toThrow(/must not be empty/);
  });
});

describe('two devices are the same only if the transport agrees', () => {
  const id = deviceId('shared-opaque-string');

  it('matches when the transport and the id both match', () => {
    expect(sameDevice({ transport: WEB_BLUETOOTH, id }, { transport: WEB_BLUETOOTH, id })).toBe(
      true,
    );
  });

  it('does not match the same id issued by a different stack', () => {
    // Nothing about the two strings distinguishes them. A CoreBluetooth UUID
    // and a Web Bluetooth id are both opaque, and the only thing that stops a
    // remembered one satisfying a check meant for the other is this comparison.
    expect(sameDevice({ transport: WEB_BLUETOOTH, id }, { transport: CORE_BLUETOOTH, id })).toBe(
      false,
    );
    expect(sameDevice({ transport: ANDROID_BLE, id }, { transport: SIMULATED, id })).toBe(false);
  });

  it('does not match a different id on the same stack', () => {
    expect(
      sameDevice(
        { transport: WEB_BLUETOOTH, id },
        { transport: WEB_BLUETOOTH, id: deviceId('another') },
      ),
    ).toBe(false);
  });
});

describe('one physical device carries several capabilities', () => {
  const trainer: SensorDevice = {
    identity: { transport: WEB_BLUETOOTH, id: deviceId('trainer') },
    name: 'KICKR CORE 1F2A',
    capabilities: new Set(['power', 'cadence', 'speed', 'trainer-control']),
  };

  it('is one device with four capabilities, not four devices', () => {
    // The acceptance criterion in prose: "the UI must not show it three times
    // as three devices". In types: one SensorDevice, one identity.
    expect(trainer.capabilities.size).toBe(4);
    expect(deviceProvides(trainer, 'power')).toBe(true);
    expect(deviceProvides(trainer, 'cadence')).toBe(true);
    expect(deviceProvides(trainer, 'trainer-control')).toBe(true);
  });

  it('does not claim a capability it was not given', () => {
    expect(deviceProvides(trainer, 'heart-rate')).toBe(false);
  });
});
