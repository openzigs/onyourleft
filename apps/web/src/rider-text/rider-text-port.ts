// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the goals, documents and ride-note screens may do to the rider's own
 * text (#836): read, write and delete the goals, a ride's note and the
 * documents — `packages/store` §`RiderTextRecord` — and nothing else of the
 * store.
 *
 * A port of its own for the reason `athlete/masked-words-port.ts` gives: a
 * screen offered one narrow write is not thereby entitled to another.
 *
 * ⚠️ **It is a `*-port.ts`, so `check:wiring` watches it** (§4j): `WIRE003`
 * fails if a method here has no production caller.
 */

import type { UnixSeconds } from '@onyourleft/domain';
import type { ActivityStore, AthleteId } from '@onyourleft/store';

export type RiderTextStore = Pick<
  ActivityStore,
  'getRiderText' | 'putRiderText' | 'listRiderTexts' | 'deleteRiderText'
>;

export interface RiderTextPort {
  readonly store: RiderTextStore;
  /** Whose text this is. Every read and write is scoped by it. */
  readonly athleteId: AthleteId;
  /** The instant a text is saved at. */
  readonly now: () => UnixSeconds;
  /** A new document's id: letters, digits and hyphens — `crypto.randomUUID` in production. */
  readonly newDocumentId: () => string;
}
