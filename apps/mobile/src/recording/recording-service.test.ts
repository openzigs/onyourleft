// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  recordingServiceKeepAlive,
  recordingServiceNotificationPermission,
  type RecordingServicePlugin,
} from './recording-service';

function scripted(): RecordingServicePlugin & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    start: () => {
      calls.push('start');
      return Promise.resolve();
    },
    stop: () => {
      calls.push('stop');
      return Promise.resolve();
    },
    notificationPermission: () => {
      calls.push('check');
      return Promise.resolve({ state: 'prompt' });
    },
    requestNotificationPermission: () => {
      calls.push('request');
      return Promise.resolve({ state: 'prompt-with-rationale' });
    },
  };
}

describe('recordingServiceKeepAlive (#524)', () => {
  it('starts the service to keep a ride alive, and stops it to let the ride sleep', async () => {
    const plugin = scripted();
    const keepAlive = recordingServiceKeepAlive(plugin);
    await keepAlive.keepRideAlive();
    expect(plugin.calls).toEqual(['start']);
    await keepAlive.letRideSleep();
    expect(plugin.calls).toEqual(['start', 'stop']);
  });

  it('passes a refusal through, for the ride controller to decide about', async () => {
    const refusing: RecordingServicePlugin = {
      ...scripted(),
      start: () => Promise.reject(new Error('the Bluetooth permission is not granted')),
    };
    await expect(recordingServiceKeepAlive(refusing).keepRideAlive()).rejects.toThrow(
      'Bluetooth permission',
    );
  });
});

describe('recordingServiceNotificationPermission (#526)', () => {
  it('checks without asking, and asks only when asked to, unwrapping the state', async () => {
    const plugin = scripted();
    const permission = recordingServiceNotificationPermission(plugin);
    expect(await permission.notificationPermission()).toBe('prompt');
    expect(plugin.calls).toEqual(['check']);
    expect(await permission.askForNotificationPermission()).toBe('prompt-with-rationale');
    expect(plugin.calls).toEqual(['check', 'request']);
  });
});
