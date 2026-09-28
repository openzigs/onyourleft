// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A transfer port over the real store, for a walk of every route in jsdom —
 * #666.
 *
 * `testing/populated-shell.tsx` hands the Files screen no port, because its
 * forms need a store and the fixture's ports are in-memory stubs. A walk that
 * asks what the Files screen SAYS then reads its not-available sentence and
 * none of the rest — the screen #654 measured at 3,554 px. This is the store
 * the Files screen's own tests use (`fake-indexeddb` under the round-trip
 * harness), empty, with its two browser side effects made inert.
 *
 * Test support: it opens a database, and the caller destroys the harness.
 */

import { unixSeconds } from '@onyourleft/domain';
import { activityId, routeId } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';

import { webCryptoDigest } from '../transfer/browser';
import type {
  AccountStore,
  CourseStore,
  TransferPort,
  TransferStore,
} from '../transfer/store-port';

/** An empty store behind a Files screen, and the harness to destroy after. */
export async function emptyTransferPort(): Promise<{
  readonly port: TransferPort;
  readonly harness: StoreHarness;
}> {
  const harness = createStoreHarness();
  await seedAthletes(harness);
  const store: TransferStore & AccountStore & CourseStore = await harness.write((handle) =>
    Promise.resolve(handle),
  );
  let next = 0;
  const port: TransferPort = {
    store,
    athleteId: ATHLETE_A,
    newActivityId: () => {
      next += 1;
      return activityId(`walk-${String(next)}`);
    },
    newRouteId: () => {
      next += 1;
      return routeId(`walk-route-${String(next)}`);
    },
    now: () => unixSeconds(1_760_000_000),
    timeZone: 'Europe/London',
    digest: webCryptoDigest,
    save: () => undefined,
    drafts: { forget: () => undefined },
    athleteRow: { id: ATHLETE_A, displayName: 'You', createdAt: unixSeconds(1_760_000_000) },
  };
  return { port, harness };
}
