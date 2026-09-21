// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A workout's next block, announced BEFORE it changes — #398.
 *
 * ⚠️ **No assertion here establishes that a rider was warned in time.** It
 * establishes what the region says and when, against the player's own clock;
 * whether a screen reader in the Android WebView speaks it early enough to
 * matter is `docs/validation/0003` (#393), and its tables are empty.
 */

import {
  expandWorkout,
  seconds,
  thresholdShare,
  unixSeconds,
  watts,
  type WorkoutBlock,
} from '@onyourleft/domain';
import { athleteId as toAthleteId, workoutId, type WorkoutRecord } from '@onyourleft/store';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ANNOUNCEMENTS_STORAGE_KEY,
  DEFAULT_ANNOUNCEMENTS,
  type PreferenceStorage,
} from '../game/hud/announce-preference';
import { mount, settle, type Mounted } from '../testing/mount';
import { workoutStub } from '../workouts/testing';

import type { RideWorkoutSnapshot, TrainerSnapshot } from './controller';
import { WorkoutPanel } from './WorkoutPanel';

const ATHLETE = toAthleteId('athlete-a');
const blocks: readonly WorkoutBlock[] = [
  { kind: 'steady', seconds: seconds(600), target: thresholdShare(0.6) },
  { kind: 'steady', seconds: seconds(300), target: thresholdShare(0.95) },
];
const TIMELINE = expandWorkout({ name: 'Sweet spot', blocks });
const record: WorkoutRecord = {
  id: workoutId('w1'),
  createdBy: ATHLETE,
  name: 'Sweet spot',
  workout: { name: 'Sweet spot', blocks },
  createdAt: unixSeconds(1),
  updatedAt: unixSeconds(1),
};

const trainer: TrainerSnapshot = {
  paired: true,
  controllable: true,
  controlChoice: { kind: 'none' },
  canSetPower: true,
  canSimulate: false,
  powerRange: undefined,
  hasControl: true,
  target: { kind: 'none' },
  requested: undefined,
  lost: undefined,
  refusal: undefined,
  releaseFault: undefined,
};

function at(elapsedSeconds: number, status: RideWorkoutSnapshot['status'] = 'running') {
  return {
    name: 'Sweet spot',
    status,
    elapsedSeconds,
    totalSeconds: 900,
    holdingWatts: 150,
    nowRiding: '10 min at 60%',
    fault: undefined,
    timeline: TIMELINE,
  } satisfies RideWorkoutSnapshot;
}

function storageWith(enabled: boolean): PreferenceStorage {
  const value = JSON.stringify({ ...DEFAULT_ANNOUNCEMENTS, enabled, intervalLeadSeconds: 10 });
  return {
    getItem: (key) => (key === ANNOUNCEMENTS_STORAGE_KEY ? value : null),
    setItem: () => undefined,
  };
}

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.restoreAllMocks();
});

const panel = (workout: RideWorkoutSnapshot, storage: PreferenceStorage) => (
  <WorkoutPanel
    trainer={trainer}
    workout={workout}
    port={workoutStub(ATHLETE, [record])}
    thresholdPower={watts(250)}
    onStart={() => undefined}
    onEnd={() => undefined}
    announcements={storage}
  />
);

const region = (): string =>
  document.querySelector('[data-oyl-announcer="ride"]')?.textContent ?? '<no region>';

/** Ride the panel through a list of instants, collecting what the region said at each. */
async function ride(
  steps: readonly RideWorkoutSnapshot[],
  storage: PreferenceStorage,
): Promise<string[]> {
  const heard: string[] = [];
  for (const [index, step] of steps.entries()) {
    if (index === 0) {
      mounted = await mount(panel(step, storage));
    } else {
      await mounted?.rerender(panel(step, storage));
    }
    await settle();
    heard.push(region());
  }
  return heard;
}

const HARDER = 'In 10 seconds: harder — 5 minutes at 95 percent of your threshold.';

describe('the next block, before it changes — #398', () => {
  it('is said at T − N and not at T − N − ε', async () => {
    const heard = await ride([at(589.9), at(590)], storageWith(true));
    expect(heard).toEqual(['', HARDER]);
  });

  it('is said ONCE for one boundary, however many ticks cross the window', async () => {
    const heard = await ride(
      [at(580), at(590), at(592), at(594), at(597), at(599.5)],
      storageWith(true),
    );
    expect(heard.filter((text) => text === HARDER)).toHaveLength(5);
    // …and the region was written once: after the first, nothing replaced it.
    expect(heard.slice(1).every((text) => text === HARDER)).toBe(true);
    expect(heard[0]).toBe('');
  });

  it('does not count down while the workout is paused, and re-arms on resume', async () => {
    const heard = await ride(
      [at(585), at(592, 'paused'), at(592, 'paused'), at(592)],
      storageWith(true),
    );
    expect(heard.slice(0, 3)).toEqual(['', '', '']);
    // Eight seconds, because the player's clock stood still at 592 while
    // paused — it resumes counting from where it stopped.
    expect(heard[3]).toBe('In 8 seconds: harder — 5 minutes at 95 percent of your threshold.');
  });

  it('says nothing to a rider who has not turned announcements on — the default', async () => {
    const heard = await ride([at(585), at(592), at(599)], storageWith(false));
    expect(heard).toEqual(['', '', '']);
  });

  it('keeps the ride’s clock as the only one: wall time moving changes nothing', async () => {
    const storage = storageWith(true);
    mounted = await mount(panel(at(585), storage));
    await settle();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3_600_000);
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 3_600_000);
    await mounted.rerender(panel(at(585), storage));
    await settle();
    expect(region()).toBe('');
  });

  it('never names a watt figure for a target the trainer has not acknowledged', async () => {
    const heard = await ride([at(585), at(592)], storageWith(true));
    expect(heard.join(' ')).not.toMatch(/\bW\b|watt/i);
  });
});
