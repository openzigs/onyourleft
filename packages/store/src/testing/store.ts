// SPDX-License-Identifier: Apache-2.0

/**
 * The store surface the harness talks to, and the factory that produces one.
 *
 * The harness is written against an **interface**, not against `ActivityStore`
 * itself, for one reason: #28's central acceptance criterion is that the
 * harness be proved by substituting a repository that does not persist and
 * watching the round trip go red. A harness hard-wired to the concrete class
 * cannot have anything substituted into it, so it can never be proved, so it
 * certifies without evidence — which #28 calls "worse than no harness".
 */

import type { ActivityStore } from '../activity-store';

/**
 * Every public member of `ActivityStore`, structurally.
 *
 * A homomorphic mapped type rather than a hand-written interface: it strips the
 * class's `#private` brand, which is what makes a substitute assignable, and it
 * stays in step by construction. A method added to `ActivityStore` appears here
 * the moment it is written, and `bindStore` in `fakes.ts` then fails to compile
 * until the fakes account for it — which is the forcing function that stops a
 * new write path shipping with no fake, and therefore with nothing proving the
 * harness catches it.
 */
export type PersistentStore = {
  [Member in keyof ActivityStore]: ActivityStore[Member];
};

/**
 * How the harness obtains and disposes of a store.
 *
 * `open` is called **once per connection**, not once per harness: the whole
 * point of the round-trip primitive is that the read runs on a connection the
 * write never touched, so this is called at least twice in any honest test.
 */
export interface StoreFactory {
  /** Opens a handle on the named database. Called afresh for every read. */
  open(name: string): PersistentStore;
  /** Removes the database entirely, if this factory has one. */
  destroy(name: string): Promise<void>;
}
