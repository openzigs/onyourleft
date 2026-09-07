// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `pmtiles://` registered **once per application lifetime**.
 *
 * #63's second acceptance criterion, and the failure it names: *"duplicate
 * protocol handlers leaking on every navigation."* Protomaps' own integration
 * note is the source of the rule — `addProtocol` is called once per application
 * lifecycle, from a root-level effect, never from a component render.
 *
 * ## Why this is a counter and not a boolean
 *
 * A boolean guard is the obvious implementation and it is not testable: with
 * one flag, "registered once" and "registered five times and the last four were
 * no-ops" produce the same observable state. The criterion asks for a *count*,
 * so the count is what this keeps, and `protocol.test.ts` reads it.
 *
 * ## Why the map view may call `ensure()` and must not call `release()`
 *
 * Both halves matter and they are asymmetric on purpose.
 *
 * `ensure()` is safe from anywhere, because it deduplicates. Putting it in the
 * component rather than only at the root is what makes the criterion's test
 * meaningful: mounting the map three times exercises the deduplication, where a
 * registration that only ever happened at the root would pass the test without
 * the guard existing at all.
 *
 * `release()` belongs to the application's teardown. A component that released
 * on unmount would tear the handler down on every navigation away from a ride
 * and rebuild it on every navigation back — which is not a leak, but it does
 * discard the `pmtiles` client's own state, including the archive header and
 * root directory it fetched. That is a range request per navigation, on an
 * archive ADR 0010 D-1 already warns is on a high-latency store.
 */

import type { ProtocolRegistrar, ProtocolRegistry } from './port';

/** The URL scheme MapLibre routes to the PMTiles handler. */
export const PMTILES_SCHEME = 'pmtiles';

/**
 * A registry over one registrar.
 *
 * The registrar is a parameter rather than a module import, so this file names
 * no library and its whole behaviour is decidable from a counter. `maplibre.ts`
 * builds the one real instance.
 *
 * @param handler what to register. A thunk, not a value: building the PMTiles
 * `Protocol` allocates a cache, and doing that at module load would pay for it
 * in every build that never shows a map — including a page opened on a browser
 * with no WebGL at all.
 */
export function createProtocolRegistry(
  registrar: ProtocolRegistrar,
  handler: () => unknown,
): ProtocolRegistry {
  let registered = false;
  let registrations = 0;
  let removals = 0;

  return {
    ensure(): void {
      if (registered) {
        return;
      }
      registrar.addProtocol(PMTILES_SCHEME, handler());
      registered = true;
      registrations += 1;
    },
    release(): void {
      if (!registered) {
        return;
      }
      registrar.removeProtocol(PMTILES_SCHEME);
      registered = false;
      removals += 1;
    },
    get registrations(): number {
      return registrations;
    },
    get removals(): number {
      return removals;
    },
  };
}
