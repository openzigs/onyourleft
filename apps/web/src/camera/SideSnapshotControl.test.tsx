// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **One press of *Save snapshot* keeps exactly one picture** — #1063, ADR 0044
 * D-3: *"never held down to save a run of pictures"*.
 *
 * Driven through the real control, the real keeper and the real store: the
 * rider presses once while pictures keep arriving, the ride is saved, and a
 * fresh connection reads back exactly one record.
 */

import { act } from 'react';
import { unixSeconds } from '@onyourleft/domain';
import { openActivityStore, type ActivityStore } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  resetFixtureIds,
  seedAthletes,
  seedRide,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { activateWithKeyboard, mount, settle, type Mounted } from '../testing/mount';
import type { RideProgress, RideProgressSource } from './side-report-keeper';
import type { SideLivePicture } from './side-live-view-port';
import type { SideSnapshotSource } from './side-snapshot-port';
import {
  SAVE_SNAPSHOT_LABEL,
  SNAPSHOT_WHERE_IT_GOES,
  SideSnapshotControl,
  snapshotHeldText,
} from './SideSnapshotControl';
import { sideSnapshotKeeper } from './snapshot-keeper';
import { cleanFrameBytes, scriptedLiveView } from './testing';

let harness: StoreHarness;
let writer: ActivityStore;
let mounted: Mounted | undefined;

beforeEach(async () => {
  resetFixtureIds();
  harness = createStoreHarness();
  await seedAthletes(harness);
  writer = openActivityStore(harness.databaseName);
});

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  writer.close();
  await harness.destroy();
});

/** A picture on the live view; its pixels are never drawn here. */
function shown(sequence: number): SideLivePicture {
  return {
    sequence,
    pixels: { width: 256, height: 144, close: () => undefined },
    pose: undefined,
  };
}

function ridesUnderWay() {
  let snapshot: RideProgress = {
    phase: 'recording',
    saveState: 'unavailable',
    savedActivityId: undefined,
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
    for (const listener of [...listeners]) listener();
  };
  return { source, set };
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === name,
  );
}

describe('Save snapshot', () => {
  it('is absent with no picture on screen, and says where a snapshot goes once there is one', async () => {
    const view = scriptedLiveView();
    const keeper = sideSnapshotKeeper({
      rides: ridesUnderWay().source,
      store: writer,
      athleteId: ATHLETE_A,
      newFrameId: () => 'never',
      now: () => unixSeconds(1),
    });
    const source: SideSnapshotSource = { takeSideSnapshot: () => undefined };
    mounted = await mount(<SideSnapshotControl view={view} source={source} snapshots={keeper} />);
    expect(buttonNamed(SAVE_SNAPSHOT_LABEL)).toBeUndefined();
    await act(async () => {
      view.show({ picture: shown(1), reference: undefined });
      await Promise.resolve();
    });
    expect(buttonNamed(SAVE_SNAPSHOT_LABEL)).toBeDefined();
    expect(document.body.textContent).toContain(SNAPSHOT_WHERE_IT_GOES);
  });

  it('keeps exactly one picture for one press, however many arrive after it', async () => {
    const rides = ridesUnderWay();
    let ids = 0;
    const keeper = sideSnapshotKeeper({
      rides: rides.source,
      store: writer,
      athleteId: ATHLETE_A,
      newFrameId: () => {
        ids += 1;
        return `pressed-${String(ids)}`;
      },
      now: () => unixSeconds(1_760_000_000),
    });
    const view = scriptedLiveView({ picture: shown(1), reference: undefined });
    let taken = 0;
    const source: SideSnapshotSource = {
      takeSideSnapshot: () => {
        taken += 1;
        return { bytes: cleanFrameBytes(), width: 256, height: 144, outline: undefined };
      },
    };
    mounted = await mount(<SideSnapshotControl view={view} source={source} snapshots={keeper} />);

    await activateWithKeyboard(buttonNamed(SAVE_SNAPSHOT_LABEL) as HTMLElement);
    // Pictures keep arriving after the press, as they do at five a second.
    for (let sequence = 2; sequence < 8; sequence += 1) {
      await act(async () => {
        view.show({ picture: shown(sequence), reference: undefined });
        await Promise.resolve();
      });
    }
    await settle();
    expect(document.body.textContent).toContain(
      snapshotHeldText({ kind: 'held', joins: 'this-ride', held: 1 }),
    );

    const ride = await seedRide(harness, ATHLETE_A);
    rides.set({ phase: 'stopped' });
    rides.set({ saveState: 'saving' });
    rides.set({ saveState: 'saved', savedActivityId: ride.id });
    // Counted rather than listed: under jsdom a typed array read back from
    // the fake IndexedDB is another realm's, which the store's decoder
    // refuses. `snapshot-keeper.test.ts` reads the bytes back in Node.
    await vi.waitFor(async () => {
      const read = await harness.read(async (store) =>
        store.countRideSnapshots(ATHLETE_A, ride.id),
      );
      expect(read).toBe(1);
    });
    expect(taken).toBe(1);
    // Read once more, settled: still exactly one.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(harness.read(async (store) => store.countCameraFrames(ATHLETE_A))).resolves.toBe(
      1,
    );
  });
});
