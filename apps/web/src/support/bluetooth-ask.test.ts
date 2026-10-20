// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1436: remembering that a rider has been told why Android asks. Read back
 * through a second port over the same storage, as the next visit reads it.
 */

import { describe, expect, it } from 'vitest';

import { BLUETOOTH_ASKED_STORAGE_KEY, BLUETOOTH_WHY, deviceBluetoothAsk } from './bluetooth-ask';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & {
  readonly map: Map<string, string>;
} {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe('deviceBluetoothAsk', () => {
  it('has not asked on a device that never pressed through', () => {
    expect(deviceBluetoothAsk(memoryStorage()).askedBefore()).toBe(false);
  });

  it('remembers the press for the next visit, under its own key', () => {
    const storage = memoryStorage();
    deviceBluetoothAsk(storage).noteAsked();

    expect(deviceBluetoothAsk(storage).askedBefore()).toBe(true);
    expect(storage.map.get(BLUETOOTH_ASKED_STORAGE_KEY)).toBe('yes');
  });

  it('reads anything else under the key as not asked', () => {
    const storage = memoryStorage();
    storage.setItem(BLUETOOTH_ASKED_STORAGE_KEY, 'true');

    expect(deviceBluetoothAsk(storage).askedBefore()).toBe(false);
  });

  it('explains every time, and never throws, where storage refuses', () => {
    const refusing = {
      getItem: (): string | null => {
        throw new Error('SecurityError');
      },
      setItem: (): void => {
        throw new Error('QuotaExceededError');
      },
    };
    const ask = deviceBluetoothAsk(refusing);

    expect(() => {
      ask.noteAsked();
    }).not.toThrow();
    expect(ask.askedBefore()).toBe(false);
    expect(deviceBluetoothAsk(undefined).askedBefore()).toBe(false);
  });
});

describe('BLUETOOTH_WHY', () => {
  it('says what the permission is for, and claims no "never asks" about location', () => {
    expect(BLUETOOTH_WHY).toContain('trainer and sensors');
    expect(BLUETOOTH_WHY).toContain('never reads your location');
    expect(BLUETOOTH_WHY).not.toContain('never asks');
  });
});
