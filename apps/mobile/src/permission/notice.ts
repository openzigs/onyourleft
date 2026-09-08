// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What to tell a rider when Bluetooth will not work (#87, criterion 8).
 *
 * > *"Denying a permission produces an explanatory screen, not a crash or an
 * > empty device list."*
 *
 * The failure this exists to prevent is the quiet one. A denied permission and
 * a room with no sensors in it produce the same thing from a naive shell — a
 * list with nothing in it — and a rider reading that concludes their trainer is
 * broken. So `permissionNotice` is **total over `TransportAvailability`**: every
 * outcome that is not `available` has a notice, and the compiler is what makes
 * that true rather than a reviewer.
 *
 * Pure, and deliberately so. It renders nothing, touches no DOM and reads no
 * platform API, which is what lets the wording be tested here rather than in a
 * screenshot — the shell renders whatever it returns.
 */

import type { TransportAvailability } from '@onyourleft/sensors';

/** What the shell shows. */
export interface PermissionNotice {
  /** A heading that says what happened, not what the rider did wrong. */
  readonly title: string;
  /** Why, in one sentence, in the rider's terms rather than Android's. */
  readonly explanation: string;
  /**
   * The one thing worth doing next, or `null` when there is nothing.
   *
   * ⚠️ `null` is a real answer, not a missing one. On an unsupported stack there
   * is no action, and a "Try again" button that cannot help is worse than no
   * button: it invites a rider to keep pressing it.
   */
  readonly action: PermissionAction | null;
}

export interface PermissionAction {
  readonly label: string;
  /**
   * What the shell should do — a hint, not a handler, so this module stays pure.
   *
   * `open-settings` is the app's own settings page, where Android lets a
   * previously-denied permission be granted again; `retry` re-runs
   * `availability()`; `open-bluetooth-settings` is the system Bluetooth toggle.
   */
  readonly kind: 'open-settings' | 'retry' | 'open-bluetooth-settings';
}

/**
 * The notice for an availability, or `null` when everything is fine.
 *
 * ⚠️ The `switch` is **exhaustive with no `default`**. `TransportAvailability`
 * is a union of four; a fifth arriving makes this a compile error rather than
 * silently falling through to a generic message, which is the failure mode a
 * `default` branch buys.
 */
export function permissionNotice(availability: TransportAvailability): PermissionNotice | null {
  switch (availability.kind) {
    case 'available':
      return null;

    case 'not-permitted':
      return {
        title: 'On Your Left needs Bluetooth permission',
        // Says what the permission is FOR. Android's own prompt calls this
        // "Nearby devices", which tells a rider nothing about why a cycling app
        // wants it, and the honest answer is short.
        explanation:
          'Android asks before an app can talk to sensors. Without it, your trainer, heart rate strap and power meter cannot be found — this app never asks for your location.',
        action: { label: 'Open app settings', kind: 'open-settings' },
      };

    case 'adapter-unavailable':
      return {
        title: 'Bluetooth is switched off',
        explanation: 'Turn Bluetooth on and your sensors will appear.',
        action: { label: 'Open Bluetooth settings', kind: 'open-bluetooth-settings' },
      };

    case 'unsupported':
      return {
        title: 'This device cannot use Bluetooth sensors',
        explanation:
          'No Bluetooth Low Energy support was found. Rides can still be imported from a file.',
        // No action. Nothing the rider does changes this, and a retry button
        // here would be an invitation to keep pressing something that cannot
        // work.
        action: null,
      };
  }
}

/**
 * Whether a device list may be shown at all.
 *
 * The direct expression of criterion 8: an empty list is only ever the right
 * screen when discovery genuinely found nothing. Every other case has a notice,
 * and a shell that asks this question cannot render the ambiguous one by
 * accident.
 */
export function mayShowDeviceList(availability: TransportAvailability): boolean {
  return availability.kind === 'available';
}
