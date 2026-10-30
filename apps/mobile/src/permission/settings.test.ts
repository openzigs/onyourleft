// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1436: the way to Android's settings after a denial. Against the scripted
 * port, not a phone — that the Intent opens the right page is the plugin's
 * (`BluetoothLe.kt` §`openAppSettings`) and is not claimed here.
 */

import { describe, expect, it } from 'vitest';

import type { ScriptedPort } from '../ble/testing';
import { scriptedPort } from '../ble/testing';

import { openCapacitorSettings } from './settings';

describe('openCapacitorSettings', () => {
  it('opens the app’s own page for "app", and nothing else', async () => {
    const port = scriptedPort();

    await expect(openCapacitorSettings(port, 'app')).resolves.toBe(true);
    expect(port.calls).toEqual(['openAppSettings']);
  });

  it('opens Bluetooth settings for "bluetooth"', async () => {
    const port = scriptedPort();

    await expect(openCapacitorSettings(port, 'bluetooth')).resolves.toBe(true);
    expect(port.calls).toEqual(['openBluetoothSettings']);
  });

  it('needs no initialised stack — it is offered when the stack would not start', async () => {
    const port = scriptedPort({ initializeRejectsWith: new Error('Permission denied.') });

    await expect(openCapacitorSettings(port, 'app')).resolves.toBe(true);
    expect(port.calls).not.toContain('initialize');
  });

  it('says it could not, rather than rejecting, when the plugin refuses', async () => {
    const port: ScriptedPort = {
      ...scriptedPort(),
      openAppSettings: () => Promise.reject(new Error('no activity')),
    };

    await expect(openCapacitorSettings(port, 'app')).resolves.toBe(false);
  });
});
