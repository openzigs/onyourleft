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
import { createShellRideController, type ShellRecordingService } from './shell-ride-controller';

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
    listRecordingSessions: async (owner) =>
      harness.write(async (store) => store.listRecordingSessions(owner)),
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

function controllerOver(mobile: ShellRecordingService) {
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
