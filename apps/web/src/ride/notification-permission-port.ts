// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Whether the ride's notification may be shown, and asking for it** —
 * [#526](https://github.com/openzigs/onyourleft/issues/526).
 *
 * #524 started the `connectedDevice` foreground service while a ride is
 * active. Its "Recording ride" notification is the rider's only sign, with the
 * screen off, that a ride is still recording, and their way back into it. From
 * Android 13 (API 33) `POST_NOTIFICATIONS` is a RUNTIME permission, so the
 * manifest's declaration is not enough, and until #526 nothing asked for it:
 * the service ran and its notification was never shown.
 *
 * On Android this is `RecordingServicePlugin.java`, through
 * `apps/mobile/src/recording/recording-service.ts`. In a browser there is no
 * notification to ask about and the controller is handed no port.
 *
 * ## Why this is a `*-port.ts`
 *
 * CLAUDE.md §4j: the suffix makes both methods `WIRE003` targets, so a
 * controller that stopped asking — or stopped checking before it asked, which
 * would ask on every ride — is a red gate. ⚠️ The provider half is the §Limits
 * case, exactly as `keep-alive-port.ts` records: `main.tsx` passes it as an
 * optional option, and nothing covers that line.
 *
 * ## ⚠️ Neither method may stop a ride
 *
 * A refusal, a "don't ask again" or a rejected call leaves the ride recording
 * and the keep-alive going ahead — #525's *degraded, not lost*. What a denial
 * costs is the notification, and the rider is told that once, in words.
 */

/**
 * Capacitor's four permission states. `prompt` is the only one that is asked
 * about: `prompt-with-rationale` is a permission this rider has already refused
 * once, and `denied` one they refused for good.
 */
export type NotificationPermissionState = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale';

/** The two calls a ride makes about its notification. */
export interface RideNotificationPermissionPort {
  /**
   * Where the permission stands, WITHOUT asking. Below API 33 it is
   * `granted`: the permission is granted at install there.
   */
  notificationPermission(): Promise<NotificationPermissionState>;
  /**
   * Ask the rider. Resolves when they have answered, with the state after the
   * answer. Called only when {@link notificationPermission} said `prompt`.
   */
  askForNotificationPermission(): Promise<NotificationPermissionState>;
}
