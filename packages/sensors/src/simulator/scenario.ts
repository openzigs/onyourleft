// SPDX-License-Identifier: Apache-2.0

/**
 * Scripted misbehaviour.
 *
 * Each variant is something a real device has been seen to do, and each has a
 * test in `scenarios.test.ts` or `control-point.test.ts` that scripts it and
 * asserts the consequence **through `SensorTransport`** — a state observer's
 * sequence, a subscriber's gap, a power stream that does not move. A scenario
 * with no observable consequence would be decoration; a scenario nobody has
 * watched fire is a documented reproduction of a fault it does not reproduce.
 *
 * The control-point refusals (`0x05`, `0xFD`, `0xFE`, the Reset revocation) are
 * not scenarios: they are the trainer's ordinary behaviour under the sequence
 * of writes that provokes them, so a client reaches them by writing, not by
 * scripting. See `ftms.ts`.
 *
 * `../README.md` has the worked example of adding one from a bug report.
 */

import type { Seconds } from '@onyourleft/domain';

import type { IndoorBikeDataField } from './ftms';

export type Scenario =
  /**
   * The link drops now.
   *
   * Without `recoverAfter` the device goes to `disconnected` and stays there —
   * the Web Bluetooth outcome, where a reconnect costs a gesture. With it, the
   * device goes to `reconnecting` and returns to `connected` on its own after
   * that long, which is only legal on a transport whose traits say
   * `canReconnectWithoutUserGesture`; on any other it is refused.
   *
   * Either way the ATT bearer is gone: a queued control-point response is
   * lost, indications are off, and control is not held.
   */
  | { readonly kind: 'disconnect'; readonly recoverAfter?: Seconds }
  /**
   * Notifications stop arriving for `duration`, while the connection state
   * stays `connected` throughout. The device keeps running — its counters
   * advance — so the first notification afterwards carries the whole gap, and
   * a gap past the event-time horizon is the case the client must drop.
   */
  | { readonly kind: 'notification-dropout'; readonly duration: Seconds }
  /**
   * Arm every revolution counter on the device to lap within the next two
   * seconds. Script it **before** connecting; see `counters.ts`. Refused on a
   * device with no counter to arm.
   */
  | { readonly kind: 'counter-wrap' }
  /**
   * Fitness Machine Status `0xFF`: the trainer withdraws this client's control.
   * The current target stays in force; the client's next setpoint is refused
   * with `0x05`. Refused on a device with no FTMS service.
   */
  | { readonly kind: 'control-permission-lost' }
  /**
   * Change which fields Indoor Bike Data carries from the next notification.
   * The unusual-but-valid combinations live here — speed present with flag
   * bit 0 clear, total distance present, cadence absent. Refused on a device
   * with no FTMS service.
   */
  | {
      readonly kind: 'indoor-bike-data-fields';
      readonly fields: ReadonlySet<IndoorBikeDataField>;
    };
