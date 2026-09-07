// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The seam #184 fell through: a store, this client's athlete id, and a write
 * path that had never met.
 *
 * Every test in this file uses the **real** store through the #28 harness and
 * an **unseeded** database. That is the whole point — `seedAthletes` is what
 * hid the bug for four milestones, so a fixture that calls it would hide it
 * again. Nothing below writes an athlete except the code under test.
 */

import { metres, seconds, unixSeconds } from '@onyourleft/domain';
import { activityId, recordingSessionId, StoreReferentialError } from '@onyourleft/store';
import type { NewActivity, NewRecordingSession } from '@onyourleft/store';
import { createStoreHarness, type StoreHarness } from '@onyourleft/store/testing';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ensureLocalAthlete,
  LOCAL_ATHLETE,
  LOCAL_ATHLETE_DISPLAY_NAME,
  renderAfterAthlete,
} from './local-athlete';

const NOW = unixSeconds(1_760_000_000);

let harness: StoreHarness | undefined;

afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

/** A ride owned by the client's own athlete, as `import-batch.ts` writes one. */
function importedRide(): NewActivity {
  return {
    id: activityId('ride-1'),
    athleteId: LOCAL_ATHLETE,
    name: 'Imported ride',
    startedAt: NOW,
    startedAtTimeZone: 'Europe/London',
    elapsedTime: seconds(3600),
    movingTime: seconds(3500),
    distance: metres(30_000),
    hasPosition: false,
    createdAt: NOW,
  };
}

/** A recording header, as `recorder.ts` writes one on its first checkpoint. */
function recordingHeader(): NewRecordingSession {
  return {
    id: recordingSessionId('session-1'),
    athleteId: LOCAL_ATHLETE,
    state: 'recording',
    startedAt: NOW,
    updatedAt: NOW,
    sampleInterval: seconds(1),
    pauses: [],
  };
}

describe('the bug #184 records', () => {
  it('a write for an athlete with no row is refused, which is what was happening', async () => {
    // Not a hypothetical and not a regression guard on someone else's code:
    // this is the exact failure a rider hit on a browser that had never been
    // seeded by hand, and it is what the rest of this file exists to stop.
    harness = createStoreHarness();

    await expect(harness.write(async (store) => store.putActivity(importedRide()))).rejects.toThrow(
      StoreReferentialError,
    );
  });
});

describe('ensureLocalAthlete', () => {
  it('creates the row, so an imported ride has an owner', async () => {
    // #51's write path, on a database nobody seeded, read back on a connection
    // the writer never touched.
    harness = createStoreHarness();
    await harness.write(async (store) => ensureLocalAthlete(store, NOW));

    const ride = importedRide();
    const read = await harness.roundTrip(
      async (store) => store.putActivity(ride),
      async (store) => store.getActivity(LOCAL_ATHLETE, ride.id),
    );

    expect(read?.id).toBe(ride.id);
    expect(read?.athleteId).toBe(LOCAL_ATHLETE);
  });

  it('creates the row, so a recording can checkpoint', async () => {
    // The more serious half. `recorder.ts` catches its own write failure and
    // carries on in memory, so this one failed *silently*: the ride looked
    // normal until the tab closed and took all of it, against a README that
    // promises at most eight seconds can be lost.
    harness = createStoreHarness();
    await harness.write(async (store) => ensureLocalAthlete(store, NOW));

    const header = recordingHeader();
    const read = await harness.roundTrip(
      async (store) => store.putRecordingSession(header),
      async (store) => store.getRecordingSession(LOCAL_ATHLETE, header.id),
    );

    expect(read?.id).toBe(header.id);
  });

  it('writes the row this client actually names', async () => {
    // The id and the display name, read from disk rather than from the return
    // value: an `ensureAthlete` that answered correctly and wrote nothing is
    // CLAUDE.md §5's *wrong harness* cause, and `harness.test.ts` has the
    // red/green pair that proves the read-back is what notices.
    harness = createStoreHarness();

    await harness.write(async (store) => ensureLocalAthlete(store, NOW));
    const onDisk = await harness.read(async (store) => store.getAthlete(LOCAL_ATHLETE));

    expect(onDisk?.id).toBe(LOCAL_ATHLETE);
    expect(onDisk?.displayName).toBe(LOCAL_ATHLETE_DISPLAY_NAME);
    expect(onDisk?.createdAt).toBe(NOW);
  });

  it('is idempotent across reloads and does not rewrite the row', async () => {
    // ⚠️ The reason this is `ensureAthlete` and not `putAthlete`. Start-up runs
    // on every page load; a `put` would discard the rider's own display name
    // and — since #78 — both thresholds, every single time.
    harness = createStoreHarness();
    await harness.write(async (store) => ensureLocalAthlete(store, NOW));

    // The rider names themselves and sets a threshold. (#33 and #78's editor
    // will do this; the store already holds it.)
    await harness.write(async (store) => {
      const existing = await store.getAthlete(LOCAL_ATHLETE);
      if (existing === undefined) {
        throw new Error('the athlete row was not created');
      }
      return store.putAthlete({ ...existing, displayName: 'Rita' });
    });

    // Two more start-ups, with a later clock.
    const later = unixSeconds(NOW + 86_400);
    await harness.write(async (store) => ensureLocalAthlete(store, later));
    const returned = await harness.write(async (store) => ensureLocalAthlete(store, later));
    const onDisk = await harness.read(async (store) => store.getAthlete(LOCAL_ATHLETE));

    expect(returned.displayName).toBe('Rita');
    expect(onDisk?.displayName).toBe('Rita');
    // And the creation instant is the first one, not the most recent start-up.
    expect(onDisk?.createdAt).toBe(NOW);
  });

  it('takes the clock as a parameter rather than reading one', async () => {
    // A clock read inside the function is a fact a test cannot fix — the same
    // rule `packages/domain`'s recording engine is held to.
    harness = createStoreHarness();

    await harness.write(async (store) => ensureLocalAthlete(store, unixSeconds(1)));
    const onDisk = await harness.read(async (store) => store.getAthlete(LOCAL_ATHLETE));

    expect(onDisk?.createdAt).toBe(1);
  });
});

describe('renderAfterAthlete — the ordering #184 turns on', () => {
  it('does not render until the athlete row exists', async () => {
    // The assertion that matters. A control on screen before the row exists is
    // a control whose first write fails referentially, and the recorder reports
    // a failed checkpoint rather than crashing — so nobody finds out.
    let resolveEnsure: (() => void) | undefined;
    let ensured = false;
    let rendered = false;

    const started = renderAfterAthlete(
      async () =>
        new Promise<void>((resolve) => {
          resolveEnsure = () => {
            ensured = true;
            resolve();
          };
        }),
      () => {
        rendered = true;
      },
    );

    // The ensure is in flight and nothing has been rendered.
    await Promise.resolve();
    expect(ensured).toBe(false);
    expect(rendered).toBe(false);

    resolveEnsure?.();
    await started;

    expect(ensured).toBe(true);
    expect(rendered).toBe(true);
  });

  it('renders anyway when the store cannot be reached', async () => {
    // A private window, blocked site data, or a page opened off the disk. The
    // views that need a store explain themselves; a blank page does not.
    let rendered = false;

    await renderAfterAthlete(
      () => Promise.reject(new Error('site data is blocked')),
      () => {
        rendered = true;
      },
    );

    expect(rendered).toBe(true);
  });

  it('renders anyway when opening the store throws synchronously', async () => {
    // `localStore()` itself can throw before any promise exists, and a `try`
    // around only the `await` would let that take the whole page.
    let rendered = false;

    await renderAfterAthlete(
      () => {
        throw new Error('indexedDB is not available');
      },
      () => {
        rendered = true;
      },
    );

    expect(rendered).toBe(true);
  });
});
