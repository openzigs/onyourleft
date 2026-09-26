// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Which ride a side-camera session's report is saved with** — #388. A
 * scripted ride controller, driven through the same snapshot sequence
 * `ride/controller.ts` produces, and the real store read back through a fresh
 * connection (CLAUDE.md §5).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { activityId, type ActivityId, type SideCameraReportRecord } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  resetFixtureIds,
  seedAthletes,
  seedRide,
  type StoreHarness,
} from '@onyourleft/store/testing';

import { sideReportKeeper, type RideProgress, type RideProgressSource } from './side-report-keeper';
import type { SideReport } from './side-report';
import { SIDE_OBSERVATION_SENTENCES, SIDE_REPORT_OBSERVED } from './side-report-wording';

const REPORT: SideReport = {
  summary: SIDE_REPORT_OBSERVED,
  observations: [SIDE_OBSERVATION_SENTENCES.torso.decreased],
};

/** A ride controller that moves when the test says, notifying as the real one does. */
function scriptedRides(initial: Partial<RideProgress> = {}) {
  let snapshot: RideProgress = {
    phase: 'idle',
    saveState: 'unavailable',
    savedActivityId: undefined,
    ...initial,
  };
  const listeners = new Set<() => void>();
  const source: RideProgressSource = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const set = (change: Partial<RideProgress>): void => {
    snapshot = { ...snapshot, ...change };
    for (const listener of [...listeners]) {
      listener();
    }
  };
  return {
    source,
    listening: () => listeners.size,
    start: () => {
      set({ phase: 'recording' });
    },
    /** Stop and save, in the order `confirmStop` and `saveTheRide` notify. */
    stopAndSave: (id: ActivityId | undefined, outcome: RideProgress['saveState'] = 'saved') => {
      set({ phase: 'stopped' });
      set({ saveState: 'saving' });
      set({ saveState: outcome, savedActivityId: outcome === 'saved' ? id : undefined });
    },
    set,
  };
}

function recordingStore() {
  const puts: SideCameraReportRecord[] = [];
  return {
    puts,
    store: {
      putSideCameraReport: async (record: SideCameraReportRecord) => {
        puts.push(record);
        return Promise.resolve();
      },
    },
  };
}

const RIDE = activityId('ride-filmed');

describe('which ride a session’s report goes with', () => {
  it('waits for a ride under way when the session ends, and saves with it once it is saved', () => {
    const rides = scriptedRides();
    const { puts, store } = recordingStore();
    const session = sideReportKeeper({
      rides: rides.source,
      store,
      athleteId: ATHLETE_A,
    }).beginSideReportSession();
    rides.start();
    session.endSideReportSession(REPORT);
    // Not yet: the ride is not an activity until it is saved.
    expect(puts).toStrictEqual([]);
    rides.stopAndSave(RIDE);
    expect(puts).toStrictEqual([
      {
        athleteId: ATHLETE_A,
        activityId: RIDE,
        summary: REPORT.summary,
        observations: REPORT.observations,
      },
    ]);
    expect(rides.listening()).toBe(0);
  });

  it('does not treat the moment between Stop and the save as the end of the ride', () => {
    // `confirmStop` notifies with the phase `stopped` BEFORE `saveTheRide`
    // says `saving` — and the save state then is still the previous ride's.
    const rides = scriptedRides({ saveState: 'saved', savedActivityId: activityId('yesterday') });
    const { puts, store } = recordingStore();
    const session = sideReportKeeper({
      rides: rides.source,
      store,
      athleteId: ATHLETE_A,
    }).beginSideReportSession();
    rides.start();
    session.endSideReportSession(REPORT);
    rides.set({ phase: 'stopped' });
    expect(puts).toStrictEqual([]);
    rides.set({ saveState: 'saving' });
    rides.set({ saveState: 'saved', savedActivityId: RIDE });
    expect(puts.map((put) => put.activityId)).toStrictEqual([RIDE]);
  });

  it('saves at once with a ride that was ridden and saved while the session was open', () => {
    const rides = scriptedRides();
    const { puts, store } = recordingStore();
    const session = sideReportKeeper({
      rides: rides.source,
      store,
      athleteId: ATHLETE_A,
    }).beginSideReportSession();
    rides.start();
    rides.stopAndSave(RIDE);
    expect(puts).toStrictEqual([]);
    session.endSideReportSession(REPORT);
    expect(puts.map((put) => put.activityId)).toStrictEqual([RIDE]);
  });

  it('drops the report when the ride it waited for was never saved', () => {
    const rides = scriptedRides();
    const { puts, store } = recordingStore();
    const session = sideReportKeeper({
      rides: rides.source,
      store,
      athleteId: ATHLETE_A,
    }).beginSideReportSession();
    rides.start();
    session.endSideReportSession(REPORT);
    rides.stopAndSave(undefined, 'empty');
    expect(puts).toStrictEqual([]);
    expect(rides.listening()).toBe(0);
  });

  it('drops the report, and stops listening, when the save it waited for failed', () => {
    // #561's review: the controller never returns to idle, so the drop has to
    // happen on the save's outcome. A failed save is the one a rider sees most.
    const rides = scriptedRides();
    const { puts, store } = recordingStore();
    const session = sideReportKeeper({
      rides: rides.source,
      store,
      athleteId: ATHLETE_A,
    }).beginSideReportSession();
    rides.start();
    session.endSideReportSession(REPORT);
    rides.stopAndSave(undefined, 'failed');
    // The phase stays `stopped`, as the real controller leaves it.
    expect(rides.source.getSnapshot().phase).toBe('stopped');
    expect(puts).toStrictEqual([]);
    expect(rides.listening()).toBe(0);
  });

  it('does not give a failed ride’s report to the next ride that saves', () => {
    const rides = scriptedRides();
    const { puts, store } = recordingStore();
    const session = sideReportKeeper({
      rides: rides.source,
      store,
      athleteId: ATHLETE_A,
    }).beginSideReportSession();
    rides.start();
    session.endSideReportSession(REPORT);
    rides.stopAndSave(undefined, 'failed');
    // A later ride (after #548's reset) saves; the report was already dropped.
    rides.set({ phase: 'idle', saveState: 'unavailable' });
    rides.start();
    rides.stopAndSave(activityId('the-next-ride'));
    expect(puts).toStrictEqual([]);
  });

  it('drops the report when a stopped ride is reset to idle without being saved (#548)', () => {
    // Stopped, never saved — `saveState` stays what it was — then reset.
    const rides = scriptedRides();
    const { puts, store } = recordingStore();
    const session = sideReportKeeper({
      rides: rides.source,
      store,
      athleteId: ATHLETE_A,
    }).beginSideReportSession();
    rides.start();
    session.endSideReportSession(REPORT);
    rides.set({ phase: 'stopped' });
    expect(rides.listening()).toBe(1);
    rides.set({ phase: 'idle' });
    expect(puts).toStrictEqual([]);
    expect(rides.listening()).toBe(0);
  });

  it('drops the report when no ride was under way at any point in the session', () => {
    const rides = scriptedRides();
    const { puts, store } = recordingStore();
    const session = sideReportKeeper({
      rides: rides.source,
      store,
      athleteId: ATHLETE_A,
    }).beginSideReportSession();
    session.endSideReportSession(REPORT);
    expect(puts).toStrictEqual([]);
    expect(rides.listening()).toBe(0);
  });

  it('does not give the report to a ride saved from the leftovers list, which it never filmed', () => {
    // A recovered ride is saved with no recording phase first: the controller
    // goes straight from idle to saving.
    const rides = scriptedRides();
    const { puts, store } = recordingStore();
    const session = sideReportKeeper({
      rides: rides.source,
      store,
      athleteId: ATHLETE_A,
    }).beginSideReportSession();
    rides.set({ saveState: 'saving' });
    rides.set({ saveState: 'saved', savedActivityId: activityId('recovered') });
    session.endSideReportSession(REPORT);
    expect(puts).toStrictEqual([]);
  });

  it('does not give the report to a ride saved before the session began', () => {
    const rides = scriptedRides({ saveState: 'saved', savedActivityId: activityId('earlier') });
    const { puts, store } = recordingStore();
    const session = sideReportKeeper({
      rides: rides.source,
      store,
      athleteId: ATHLETE_A,
    }).beginSideReportSession();
    session.endSideReportSession(REPORT);
    expect(puts).toStrictEqual([]);
  });

  it('saves nothing, and stops listening, for a session with nothing to report', () => {
    const rides = scriptedRides();
    const { puts, store } = recordingStore();
    const session = sideReportKeeper({
      rides: rides.source,
      store,
      athleteId: ATHLETE_A,
    }).beginSideReportSession();
    rides.start();
    session.endSideReportSession(undefined);
    rides.stopAndSave(RIDE);
    expect(puts).toStrictEqual([]);
    expect(rides.listening()).toBe(0);
  });

  it('ends once — a second end is ignored', () => {
    const rides = scriptedRides();
    const { puts, store } = recordingStore();
    const session = sideReportKeeper({
      rides: rides.source,
      store,
      athleteId: ATHLETE_A,
    }).beginSideReportSession();
    rides.start();
    rides.stopAndSave(RIDE);
    session.endSideReportSession(REPORT);
    session.endSideReportSession(REPORT);
    expect(puts).toHaveLength(1);
  });

  it('survives a store that will not keep the report', async () => {
    const rides = scriptedRides();
    const session = sideReportKeeper({
      rides: rides.source,
      store: { putSideCameraReport: async () => Promise.reject(new Error('QuotaExceededError')) },
      athleteId: ATHLETE_A,
    }).beginSideReportSession();
    rides.start();
    rides.stopAndSave(RIDE);
    expect(() => {
      session.endSideReportSession(REPORT);
    }).not.toThrow();
    await Promise.resolve();
  });
});

describe('against the real store (CLAUDE.md §5)', () => {
  let harness: StoreHarness;

  beforeEach(async () => {
    resetFixtureIds();
    harness = createStoreHarness();
    await seedAthletes(harness);
  });

  afterEach(async () => {
    await harness.destroy();
  });

  it('is on the ride’s own row when read back through a connection nothing wrote on', async () => {
    const ride = await seedRide(harness, ATHLETE_A);
    const rides = scriptedRides();
    const writes: Promise<void>[] = [];
    const session = sideReportKeeper({
      rides: rides.source,
      store: {
        putSideCameraReport: async (record) => {
          const write = harness.write(async (store) => store.putSideCameraReport(record));
          writes.push(write);
          return write;
        },
      },
      athleteId: ATHLETE_A,
    }).beginSideReportSession();
    rides.start();
    session.endSideReportSession(REPORT);
    rides.stopAndSave(ride.id);
    await Promise.all(writes);
    expect(writes).toHaveLength(1);
    const kept = await harness.read(async (store) => store.getSideCameraReport(ATHLETE_A, ride.id));
    expect(kept?.summary).toBe(REPORT.summary);
    expect(kept?.observations).toStrictEqual(REPORT.observations);
  });
});
