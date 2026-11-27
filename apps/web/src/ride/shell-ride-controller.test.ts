// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The shell → controller → plugin link for #524, which `check:wiring` cannot
 * follow and `main.tsx` has no harness for.
 *
 * ⚠️ The adapters are the REAL ones from `@onyourleft/mobile`; only the
 * Capacitor plugin at the bottom is scripted, because `registerPlugin` answers
 * nothing outside a device. So a ride's start and stop are read where the Java
 * would receive them — as `RecordingServicePlugin.start` and `.stop` — and the
 * test fails if any link above that is cut: the module no longer handing the
 * controller a keep-alive, the adapter no longer calling the plugin, or the
 * controller no longer asking.
 */

import {
  recordingServiceKeepAlive,
  recordingServiceNotificationPermission,
  type NotificationPermissionState,
  type RecordingServicePlugin,
} from '@onyourleft/mobile';
import { createSimulator } from '@onyourleft/sensors/simulator';
import { recordingSessionId } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RecordingCheckpointStore } from '../recording/recorder';
import { RIDE_NOTIFICATION_REFUSED } from './controller';
import { createRememberedSensors } from './remembered-sensors';
import {
  androidRecordingService,
  createShellRideController,
  type ShellRecordingService,
} from './shell-ride-controller';

let harness: StoreHarness;

beforeEach(async () => {
  harness = createStoreHarness();
  await seedAthletes(harness);
});

afterEach(async () => {
  await harness.destroy();
});

function checkpointStore(): RecordingCheckpointStore {
  return {
    putRecordingSession: async (record) =>
      harness.write(async (store) => store.putRecordingSession(record)),
    appendRecordingChunk: async (chunk) =>
      harness.write(async (store) => store.appendRecordingChunk(chunk)),
    readRecordingSessions: async (owner) =>
      harness.write(async (store) => store.readRecordingSessions(owner)),
    recoverRecording: async (owner, id) =>
      harness.write(async (store) => store.recoverRecording(owner, id)),
    deleteRecordingSession: async (owner, id) =>
      harness.write(async (store) => store.deleteRecordingSession(owner, id)),
  };
}

/** `RecordingServicePlugin` as the bridge would answer, logging every call. */
function scriptedPlugin(
  answer: {
    readonly start?: () => Promise<void>;
    readonly permission?: NotificationPermissionState;
  } = {},
): RecordingServicePlugin & { readonly calls: string[] } {
  const calls: string[] = [];
  const state = answer.permission ?? 'granted';
  return {
    calls,
    start: () => {
      calls.push('start');
      return answer.start === undefined ? Promise.resolve() : answer.start();
    },
    stop: () => {
      calls.push('stop');
      return Promise.resolve();
    },
    notificationPermission: () => {
      calls.push('check');
      return Promise.resolve({ state });
    },
    requestNotificationPermission: () => {
      calls.push('request');
      return Promise.resolve({ state: 'granted' });
    },
  };
}

/** The mobile module as `main.tsx` loads it, with only the plugin scripted. */
function shellWith(plugin: RecordingServicePlugin): {
  readonly mobile: ShellRecordingService;
  readonly constructed: () => number;
} {
  let constructed = 0;
  return {
    mobile: {
      capacitorRecordingServicePlugin: () => {
        constructed += 1;
        return plugin;
      },
      recordingServiceKeepAlive,
      recordingServiceNotificationPermission,
    },
    constructed: () => constructed,
  };
}

function controllerOver(mobile: ShellRecordingService | undefined) {
  const { transport, bench } = createSimulator({ devices: [] });
  let sessions = 0;
  return createShellRideController(mobile, {
    transport,
    store: checkpointStore(),
    athleteId: ATHLETE_A,
    newSessionId: () => {
      sessions += 1;
      return recordingSessionId(`shell-ride-${String(sessions)}`);
    },
    now: () => bench.now,
    // #2669: required in the shell. A memory with no storage, holding nothing.
    remembered: createRememberedSensors(undefined),
  });
}

/** Let fire-and-forget calls and the permission question settle. */
async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

describe('#524 — the shell’s ride controller reaches RecordingServicePlugin', () => {
  it('starts the service when a ride starts, keeps it through a pause, and stops it once', async () => {
    const plugin = scriptedPlugin();
    const shell = shellWith(plugin);
    const controller = controllerOver(shell.mobile);
    await settle();
    expect(plugin.calls).toEqual([]);

    await controller.start();
    await settle();
    expect(plugin.calls.filter((call) => call === 'start')).toEqual(['start']);

    await controller.pause();
    await controller.resume();
    await settle();
    expect(plugin.calls.filter((call) => call === 'start' || call === 'stop')).toEqual(['start']);

    controller.armStop();
    await controller.confirmStop();
    controller.dispose();
    await settle();
    expect(plugin.calls.filter((call) => call === 'start' || call === 'stop')).toEqual([
      'start',
      'stop',
    ]);
    // One plugin for the service and its notification, as `MainActivity` registers one.
    expect(shell.constructed()).toBe(1);
  });

  it('asks the notification question of the same plugin — #526', async () => {
    const plugin = scriptedPlugin({ permission: 'prompt' });
    const controller = controllerOver(shellWith(plugin).mobile);
    await controller.start();
    await settle();
    // The service first and never behind the dialog; a grant re-starts it.
    expect(plugin.calls).toEqual(['start', 'check', 'request', 'start']);
    controller.dispose();
  });

  it('records the ride when the plugin refuses to start the service', async () => {
    const plugin = scriptedPlugin({
      start: () =>
        Promise.reject(
          new Error(
            'The Bluetooth permission is not granted, so the recording service cannot start',
          ),
        ),
    });
    const controller = controllerOver(shellWith(plugin).mobile);
    await controller.start();
    await settle();
    expect(controller.getSnapshot().phase).toBe('recording');
    controller.armStop();
    await controller.confirmStop();
    expect(controller.getSnapshot().phase).toBe('stopped');
    expect(plugin.calls.filter((call) => call === 'start' || call === 'stop')).toEqual([
      'start',
      'stop',
    ]);
    controller.dispose();
  });
});

describe('#1755 — the iOS app’s ride controller asks for no RecordingService', () => {
  const ios = { isNativePlatform: () => true, getPlatform: () => 'ios' };
  const android = { isNativePlatform: () => true, getPlatform: () => 'android' };

  it('constructs no RecordingService plugin, and records a ride with no keep-alive', async () => {
    const plugin = scriptedPlugin();
    const shell = shellWith(plugin);
    const controller = controllerOver(androidRecordingService(ios, shell.mobile));
    await controller.start();
    await settle();
    // Read back through the ride: it is recording, and no keep-alive was
    // refused, because there was none to ask — the browser's no-op.
    expect(controller.getSnapshot().phase).toBe('recording');
    expect(controller.getSnapshot().keepAliveFailed).toBe(false);
    controller.armStop();
    await controller.confirmStop();
    controller.dispose();
    await settle();
    expect(controller.getSnapshot().phase).toBe('stopped');
    expect(shell.constructed()).toBe(0);
    expect(plugin.calls).toEqual([]);
  });

  it('gives a native shell that names no known platform none either', () => {
    const shell = shellWith(scriptedPlugin());
    expect(androidRecordingService({ isNativePlatform: () => true }, shell.mobile)).toBeUndefined();
    expect(androidRecordingService(undefined, shell.mobile)).toBeUndefined();
  });

  it('still starts the service in the Android shell', async () => {
    const plugin = scriptedPlugin();
    const shell = shellWith(plugin);
    const controller = controllerOver(androidRecordingService(android, shell.mobile));
    await controller.start();
    await settle();
    expect(plugin.calls.filter((call) => call === 'start')).toEqual(['start']);
    expect(shell.constructed()).toBe(1);
    controller.dispose();
  });
});

/**
 * #3239: `RIDE_NOTIFICATION_REFUSED` names Android's notification, and the iOS
 * app never says it, because it asks no notification question at all: it has
 * no `RecordingService` (#1755). Read back as the ride's own snapshot.
 */
describe('#3239 — the iOS app never says Android’s notification refusal', () => {
  /** A plugin whose rider says no to the notification. */
  function refusing(): RecordingServicePlugin {
    return {
      start: async () => Promise.resolve(),
      stop: async () => Promise.resolve(),
      notificationPermission: async () => Promise.resolve({ state: 'prompt' }),
      requestNotificationPermission: async () => Promise.resolve({ state: 'denied' }),
    };
  }

  it('records with no notification notice in the iOS app', async () => {
    const ios = { isNativePlatform: () => true, getPlatform: () => 'ios' };
    const controller = controllerOver(androidRecordingService(ios, shellWith(refusing()).mobile));
    await controller.start();
    await settle();
    expect(controller.getSnapshot().notificationNotice).toBeUndefined();
    controller.dispose();
  });

  it('says it in the Android shell, where the question was asked', async () => {
    const android = { isNativePlatform: () => true, getPlatform: () => 'android' };
    const controller = controllerOver(
      androidRecordingService(android, shellWith(refusing()).mobile),
    );
    await controller.start();
    await settle();
    expect(controller.getSnapshot().notificationNotice).toBe(RIDE_NOTIFICATION_REFUSED);
    controller.dispose();
  });
});
