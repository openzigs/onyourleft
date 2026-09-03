// SPDX-License-Identifier: Apache-2.0

/**
 * The error taxonomy.
 *
 * The codes are the surface a caller branches on, and the reason there is a
 * taxonomy at all: three BLE stacks fail in three vocabularies, and a UI that
 * cannot tell "Bluetooth is switched off" from "this browser will never support
 * this" tells the athlete to buy a different trainer.
 */

import { describe, expect, it } from 'vitest';

import { isSensorError, SensorError } from './index';

describe('a sensor error', () => {
  it('carries its code and the device it is about', () => {
    const error = new SensorError('not-connected', 'no link', { deviceId: 'trainer' });

    expect(error.code).toBe('not-connected');
    expect(error.deviceId).toBe('trainer');
    expect(error.name).toBe('SensorError');
    expect(error.message).toBe('no link');
    expect(error).toBeInstanceOf(Error);
  });

  it('keeps the transport error as a cause without adopting its message', () => {
    // The platform error can name a device address or a nearby device's
    // advertised name, and SECURITY.md treats leaking that as in scope. It is
    // kept for a bug report and never rendered.
    const underlying = new Error('GATT operation failed for C4:2C:03:1A:9B:7E');
    const error = new SensorError('device-not-found', 'that device is not available', {
      cause: underlying,
    });

    expect(error.cause).toBe(underlying);
    expect(error.message).not.toContain('C4:2C');
  });

  it('has no cause and no device when it was given neither', () => {
    const error = new SensorError('transport-unsupported', 'this browser has no BLE stack');

    expect(error.cause).toBeUndefined();
    expect(error.deviceId).toBeUndefined();
  });
});

describe('narrowing a caught value', () => {
  it('accepts any sensor error when no code is named', () => {
    expect(isSensorError(new SensorError('not-permitted', 'denied'))).toBe(true);
  });

  it('accepts only the named code when one is named', () => {
    const error = new SensorError('not-permitted', 'denied');

    expect(isSensorError(error, 'not-permitted')).toBe(true);
    expect(isSensorError(error, 'adapter-unavailable')).toBe(false);
  });

  it('rejects anything that is not a sensor error', () => {
    // A DOMException from the platform arrives here as an ordinary Error, and
    // must not be mistaken for a code this program understands.
    expect(isSensorError(new Error('NotFoundError'))).toBe(false);
    expect(isSensorError(new Error('NotFoundError'), 'no-device-selected')).toBe(false);
    expect(isSensorError('not-permitted')).toBe(false);
    expect(isSensorError(undefined)).toBe(false);
  });
});
