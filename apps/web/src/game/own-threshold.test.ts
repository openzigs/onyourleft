// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `GamePort.ownThresholdPower` as `main.tsx` §`buildGamePort` supplies it —
 * #2077, from PR #2225's review.
 *
 * Over the REAL store, through the #28 harness: the threshold is written the
 * way Settings writes it (`setAthleteThresholds`) on one connection and read
 * through the function `main.tsx` hands `GameView`, on another. Every other
 * #2077 test hands `GameView` a port of its own, so this is the one that reads
 * the shipped supplier; `check:wiring` is what goes red if `main.tsx` stops
 * importing it.
 */

import { unixSeconds, watts } from '@onyourleft/domain';
import { athleteId } from '@onyourleft/store';
import { createStoreHarness, type StoreHarness } from '@onyourleft/store/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { ensureLocalAthlete } from '../local-athlete';
import { ownThresholdPowerFrom } from './own-threshold';

const NOW = unixSeconds(1_760_000_000);

let harness: StoreHarness | undefined;

afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

describe('ownThresholdPowerFrom — #2077', () => {
  it("reads the local athlete's threshold, as Settings saved it", async () => {
    harness = createStoreHarness();
    const read = await harness.roundTrip(
      async (store) => {
        const local = await ensureLocalAthlete(store, NOW);
        await store.setAthleteThresholds(local.id, { thresholdPower: watts(247) });
      },
      async (store) => ownThresholdPowerFrom(store)(),
    );

    expect(read).toBe(watts(247));
  });

  it('is undefined with no threshold set, so the HUD draws no indicator', async () => {
    harness = createStoreHarness();
    const read = await harness.roundTrip(
      async (store) => ensureLocalAthlete(store, NOW),
      async (store) => ownThresholdPowerFrom(store)(),
    );

    expect(read).toBeUndefined();
  });

  it("never reads another athlete's row", async () => {
    harness = createStoreHarness();
    const read = await harness.roundTrip(
      async (store) => {
        await ensureLocalAthlete(store, NOW);
        const other = athleteId('someone-else');
        await store.ensureAthlete({ id: other, displayName: 'Bea', createdAt: NOW });
        await store.setAthleteThresholds(other, { thresholdPower: watts(310) });
      },
      async (store) => ownThresholdPowerFrom(store)(),
    );

    expect(read).toBeUndefined();
  });
});
