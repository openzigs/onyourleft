// SPDX-License-Identifier: Apache-2.0

/**
 * The connection lifecycle, modelled rather than hidden.
 *
 * ## Why five states and not a boolean
 *
 * The three BLE stacks do not agree about what a connection is, and #39's
 * acceptance criteria require the differences to be visible rather than papered
 * over:
 *
 * - **Web Bluetooth** cannot begin a connection without a user gesture, and has
 *   no silent reconnect at all: a page reload drops every connection and the
 *   athlete has to press a button again. `reconnecting` is a state its transport
 *   will legitimately never enter.
 * - **CoreBluetooth and Android BLE** can restore a connection in the
 *   background, so a link drop is genuinely a `reconnecting` and not a
 *   `disconnected` — the difference matters because a recorder should hold the
 *   ride open through the first and close it on the second.
 * - **`unavailable`** is about the stack, not the device: Bluetooth switched
 *   off, permission withdrawn, a browser with no Web Bluetooth. A boolean
 *   `connected` reports all of that as "not connected" and the UI offers a
 *   retry that cannot work.
 *
 * A transport declares which of these it can reach through `TransportTraits`
 * (`transport.ts`), so a caller can render honestly without asking which
 * platform it is on.
 *
 * ## The rule that has a test
 *
 * **Only `connected` may deliver measurements.** `canReportMeasurements` is that
 * rule as a function, and `createDeviceSession` in `session.ts` is what enforces
 * it — so it is checked through the public surface rather than trusted to each
 * of the five transports that will implement this.
 */

/**
 * Where a device connection is.
 *
 * @remarks
 * `reconnecting` is deliberately distinct from `connecting`. The first is a
 * connection this program already had and expects to get back without asking
 * the athlete for anything; the second is a connection being established for
 * the first time, which on Web Bluetooth costs a user gesture. Collapsing them
 * means either nagging for a gesture that was not needed or waiting silently for
 * one that will never come.
 */
export type ConnectionState =
  /** No link, and none being established. The initial state of every device. */
  | 'disconnected'
  /** A link is being established, at this program's request. */
  | 'connecting'
  /** Linked. The only state in which measurements may be delivered. */
  | 'connected'
  /**
   * The link dropped and the transport is restoring it without further input
   * from the athlete. Native stacks reach this; Web Bluetooth does not.
   */
  | 'reconnecting'
  /**
   * The transport itself cannot be used — no BLE stack, permission withheld, or
   * the adapter switched off. A property of the platform, not of the device.
   */
  | 'unavailable';

/** Every connection state, in lifecycle order. */
export const CONNECTION_STATES: readonly ConnectionState[] = [
  'disconnected',
  'connecting',
  'connected',
  'reconnecting',
  'unavailable',
];

/**
 * Which states each state may move to.
 *
 * The shape of this table is the design. Two entries in particular:
 *
 * - **`disconnected` cannot reach `connected` directly.** Every connection
 *   passes through `connecting`, so a UI has somewhere to show a spinner and a
 *   cancel, and so a transport cannot report a link it has not established.
 * - **`unavailable` may only return to `disconnected`.** When Bluetooth comes
 *   back on, nothing is connected and nothing is connecting; the athlete starts
 *   again. Allowing `unavailable → connected` would let a transport skip the
 *   re-pair that Web Bluetooth requires after the adapter has been off.
 *
 * A move from a state to itself is allowed everywhere and is a no-op — see
 * `isConnectionTransitionAllowed`.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<ConnectionState, readonly ConnectionState[]>> = {
  disconnected: ['connecting', 'unavailable'],
  connecting: ['connected', 'disconnected', 'unavailable'],
  connected: ['reconnecting', 'disconnected', 'unavailable'],
  reconnecting: ['connected', 'disconnected', 'unavailable'],
  unavailable: ['disconnected'],
};

/**
 * Whether a transport may move a device from one state to another.
 *
 * A move to the same state is allowed and means nothing happened. That is not
 * laxity: BLE stacks re-announce the state they are already in — Android fires a
 * `STATE_CONNECTED` callback on a link that was already up, and a transport
 * polling `device.gatt.connected` sees the same value repeatedly — and a
 * lifecycle that treated a redundant announcement as a fault would fail on
 * correct adapters. `createDeviceSession` accepts it and emits nothing.
 */
export function isConnectionTransitionAllowed(from: ConnectionState, to: ConnectionState): boolean {
  return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Whether a device in this state may deliver measurements.
 *
 * `connected` and nothing else. `reconnecting` is excluded on purpose: a
 * transport that buffered notifications across a link drop and flushed them on
 * recovery would be delivering samples with receive instants that are minutes
 * old, and a recorder has no way to tell that from live data.
 */
export function canReportMeasurements(state: ConnectionState): boolean {
  return state === 'connected';
}
