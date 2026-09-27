// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The `connectedDevice` foreground service, reached from the web client — #524.
 *
 * `RecordingServicePlugin.java` has exposed `start` and `stop` since #87, and
 * `MainActivity` registers it, but until #524 nothing on this side of the
 * bridge named it, so no ride on Android ever ran with the service. This is
 * that side. It answers `apps/web/src/ride/keep-alive-port.ts`'s two calls by
 * shape rather than by importing the type, because `apps/web` depends on this
 * package and an import back would be a workspace cycle — `camera/camera.ts`
 * gives the same reason.
 *
 * ⚠️ `capacitorRecordingServicePlugin()` runs only on a device, so no test
 * here reaches the Java. It HAS run since: validation 0002 A5 (the
 * notification) and Part C (a ten-hour ride with the screen off) passed on a
 * Pixel Tablet on 2026-09-25 — with Part C on USB power, where Doze never
 * starts, so the battery run is still owed. `apps/web/src/ride/
 * shell-ride-controller.test.ts` drives these adapters from the ride
 * controller down to a scripted plugin.
 */

import { registerPlugin } from '@capacitor/core';

/**
 * Capacitor's four permission states, as `PermissionState.java` spells them.
 * `prompt-with-rationale` is a permission refused once and still askable.
 */
export type NotificationPermissionState = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale';

/** The four methods `RecordingServicePlugin.java` declares. */
export interface RecordingServicePlugin {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** #526. Whether the ride's notification may be shown, without asking. */
  notificationPermission(): Promise<{ state: NotificationPermissionState }>;
  /** #526. Ask Android for `POST_NOTIFICATIONS`. Below API 33 it asks nothing. */
  requestNotificationPermission(): Promise<{ state: NotificationPermissionState }>;
}

/**
 * The real plugin, registered under the name `@CapacitorPlugin(name =
 * "RecordingService")` declares. Constructed rather than a constant, so that
 * importing this module has no side effect on the web build.
 */
export function capacitorRecordingServicePlugin(): RecordingServicePlugin {
  return registerPlugin<RecordingServicePlugin>('RecordingService');
}

/**
 * The ride's keep-alive, over the plugin: keeping a ride alive starts the
 * service and letting it sleep stops it. A rejection is passed through for the
 * ride controller to swallow; this layer does not decide what a refusal means.
 */
export function recordingServiceKeepAlive(plugin: RecordingServicePlugin): {
  keepRideAlive(): Promise<void>;
  letRideSleep(): Promise<void>;
} {
  return {
    keepRideAlive: async () => plugin.start(),
    letRideSleep: async () => plugin.stop(),
  };
}

/**
 * The notification permission the ride's service needs to be SEEN — #526.
 * Answers `apps/web/src/ride/notification-permission-port.ts` by shape, for the
 * reason the top of this file gives.
 *
 * Below API 33 the Java answers `granted` to both calls and shows nothing, so
 * the web client, which asks only on `prompt`, never asks there. When to ask is
 * the ride controller's decision, not this layer's.
 */
export function recordingServiceNotificationPermission(plugin: RecordingServicePlugin): {
  notificationPermission(): Promise<NotificationPermissionState>;
  askForNotificationPermission(): Promise<NotificationPermissionState>;
} {
  return {
    notificationPermission: async () => (await plugin.notificationPermission()).state,
    askForNotificationPermission: async () => (await plugin.requestNotificationPermission()).state,
  };
}
