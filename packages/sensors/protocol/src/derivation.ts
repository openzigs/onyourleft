// SPDX-License-Identifier: Apache-2.0

/**
 * Where a stateful profile keeps its previous reading.
 *
 * ## The problem this solves, found by being the seam's first consumer
 *
 * Cadence and speed are **differences**. CSC and Cycling Power transmit
 * cumulative counters and an event clock; a client that does not remember the
 * previous notification cannot produce a rate at all. But `GattProfile` has no
 * per-link hook: `web-bluetooth/src/transport.ts` canonicalises the profile
 * array **once**, at `createWebBluetoothTransport`, and every device on that
 * transport decodes through the same profile object. So a profile that simply
 * closed over `let previous` would share one accumulator between the athlete's
 * speed sensor and their power meter, and the first notification from either
 * would be differenced against the other's counter. There is no single-device
 * test that fails, which is what makes it worth writing down.
 *
 * ## Sink identity is the per-link key, and it is exactly the right one
 *
 * The adapter builds a `MeasurementSink` in `buildLive`, **once per
 * characteristic per link**, and a `Link` holds "nothing that outlives it" — a
 * reconnect resolves a new link and builds new sinks. So the sink object is a
 * token whose lifetime is precisely the lifetime over which a difference is
 * meaningful:
 *
 * - Two devices on one transport are two sinks, so their counters never mix.
 * - Two characteristics on one device are two sinks, so a CSC packet and a
 *   Cycling Power packet do not difference against each other.
 * - A dropout discards the sink, so the first notification after a reconnect
 *   starts a fresh accumulator — which is the correct behaviour anyway: the
 *   counters may have moved arbitrarily far while the link was down, and
 *   `deriveRevolutionInterval`'s ambiguity horizon cannot see across a gap it
 *   was not told about.
 *
 * **A `WeakMap`, so this holds no sink alive.** `GattProfile` tells a decoder
 * not to retain the sink; a weak key is not a retention — when the link goes
 * and the adapter drops the sink, the entry goes with it. Nothing here has to
 * be told about a disconnect, which is the failure mode a manual registry keyed
 * by device id would have.
 *
 * ⚠️ **This depends on the adapter giving a stable sink per link.** That is
 * documented on `GattProfile.decode` and asserted by
 * `web-bluetooth/src/hot-path.test.ts` — but a decoder relying on it silently
 * produces *no cadence at all* if it ever stops being true, which is a quiet
 * failure. `web-bluetooth/src/protocol-registry.test.ts` therefore drives the
 * real transport across several notifications and requires a cadence out the
 * other end, so the assumption is checked through the path a rider uses rather
 * than asserted about.
 */

import type { MeasurementSink } from './profile';

/**
 * A per-link store of whatever a stateful profile needs to remember.
 *
 * @typeParam State - the profile's own accumulator.
 */
export interface DerivationStore<State> {
  /** The state for this link, created on first use. */
  for(sink: MeasurementSink): State;
}

export function createDerivationStore<State extends object>(
  initial: () => State,
): DerivationStore<State> {
  const states = new WeakMap<MeasurementSink, State>();
  return {
    for(sink) {
      const existing = states.get(sink);
      if (existing !== undefined) {
        return existing;
      }
      const created = initial();
      states.set(sink, created);
      return created;
    },
  };
}
