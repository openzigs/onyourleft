// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A re-plan during the ride on the Ride screen — #1244, ADR 0048 D-7 and
 * D-12: an accepted move is said by the screen's one region, once, with
 * announcements on only, and never in a stretch above threshold power.
 *
 * ⚠️ What this cannot establish: that TalkBack speaks it. That is
 * `docs/validation/0003` (#393) and validation 0004 (#1246).
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
import { afterEach, describe, expect, it } from 'vitest';

import {
  ANNOUNCEMENTS_STORAGE_KEY,
  DEFAULT_ANNOUNCEMENTS,
  type PreferenceStorage,
} from '../game/hud/announce-preference';
import { mount, settle, type Mounted } from '../testing/mount';
import { workoutStub } from '../workouts/testing';
import type { WaitingReplan } from '../workout/replan-text';

import type { RideWorkoutSnapshot, TrainerSnapshot } from './controller';
import { WorkoutPanel } from './WorkoutPanel';

const ATHLETE = toAthleteId('athlete-a');
const steady = (length: number, share: number): WorkoutBlock => ({
  kind: 'steady',
  seconds: seconds(length),
  target: thresholdShare(share),
});
/** An easy block, one above threshold, and an easy one. */
const blocks: readonly WorkoutBlock[] = [steady(600, 0.6), steady(300, 1.1), steady(600, 0.6)];
const TIMELINE = expandWorkout({ name: 'Efforts', blocks });
const record: WorkoutRecord = {
  id: workoutId('w1'),
  createdBy: ATHLETE,
  name: 'Efforts',
  workout: { name: 'Efforts', blocks },
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
  requested: undefined,
  target: { kind: 'none' },
  lost: undefined,
  refusal: undefined,
  releaseFault: undefined,
  ergRescue: undefined,
  ergHeld: undefined,
};

const SENTENCE =
  'Main set ended early, so the cool-down is next, because your cadence was falling.';
const FIRST: WaitingReplan = { revision: 1, sentence: SENTENCE };
const SECOND: WaitingReplan = {
  revision: 2,
  sentence: 'Next block shortened by 2 minutes, to fit the duration you chose.',
};

const riding = (
  elapsedSeconds: number,
  waiting: WaitingReplan | undefined,
): RideWorkoutSnapshot => ({
  name: 'Efforts',
  status: 'running',
  elapsedSeconds,
  totalSeconds: 1500,
  holdingWatts: 150,
  // The same block throughout, so no "Now: …" competes for the window.
  nowRiding: 'the block',
  fault: undefined,
  rescue: undefined,
  timeline: TIMELINE,
  replan: { waiting, kept: false, notice: undefined },
});

function storageWith(enabled: boolean): PreferenceStorage {
  const value = JSON.stringify({ ...DEFAULT_ANNOUNCEMENTS, enabled, intervalLeadSeconds: 'never' });
  return {
    getItem: (key) => (key === ANNOUNCEMENTS_STORAGE_KEY ? value : null),
    setItem: () => undefined,
  };
}

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const region = (): string =>
  document.querySelector('[data-oyl-announcer="ride"]')?.textContent ?? '<no region>';

/** Ride the panel through snapshots; the announcer's clock is the workout's here. */
async function ride(
  steps: readonly (readonly [number, WaitingReplan | undefined])[],
  storage: PreferenceStorage,
): Promise<string[]> {
  let clock = 0;
  const panel = (elapsed: number, waiting: WaitingReplan | undefined) => (
    <WorkoutPanel
      trainer={trainer}
      workout={riding(elapsed, waiting)}
      port={workoutStub(ATHLETE, [record])}
      thresholdPower={watts(250)}
      onStart={() => undefined}
      onEnd={() => undefined}
      onKeepPlan={() => undefined}
      announcements={storage}
      announcerClock={() => clock}
    />
  );
  const heard: string[] = [];
  for (const [index, [at, waiting]] of steps.entries()) {
    clock = at;
    if (index === 0) {
      mounted = await mount(panel(at, waiting));
    } else {
      await mounted?.rerender(panel(at, waiting));
    }
    await settle();
    heard.push(region());
  }
  return heard;
}

describe('a re-plan on the Ride screen — #1244', () => {
  it('says an accepted move once, with its label, and not again while it waits', async () => {
    const heard = await ride(
      [
        [100, undefined],
        [110, FIRST],
        [120, FIRST],
        [130, FIRST],
      ],
      storageWith(true),
    );
    expect(heard).toEqual([
      '',
      `Plan change: ${SENTENCE}`,
      `Plan change: ${SENTENCE}`,
      `Plan change: ${SENTENCE}`,
    ]);
    // One node for one sentence: it was written to the region once.
    expect(document.querySelectorAll('[data-oyl-announcer="ride"] span')).toHaveLength(1);
  });

  it('says a second move as its own sentence', async () => {
    const heard = await ride(
      [
        [100, undefined],
        [110, FIRST],
        [300, undefined],
        [310, SECOND],
      ],
      storageWith(true),
    );
    expect(heard.at(-1)).toBe(`Plan change: ${SECOND.sentence}`);
  });

  it('says nothing with announcements off, and still shows it', async () => {
    const heard = await ride(
      [
        [100, undefined],
        [110, FIRST],
      ],
      storageWith(false),
    );
    expect(heard).toEqual(['', '']);
    expect(document.body.textContent).toContain(SENTENCE);
  });

  it('does not say a move that was already waiting when the screen appeared', async () => {
    const heard = await ride(
      [
        [100, FIRST],
        [110, FIRST],
      ],
      storageWith(true),
    );
    expect(heard).toEqual(['', '']);
  });

  it('holds its tongue above threshold power, and says it when that block has ended', async () => {
    const heard = await ride(
      [
        [590, undefined],
        // 20 s into the block at 110 %.
        [620, FIRST],
        [800, FIRST],
        // The easy block after it.
        [905, FIRST],
      ],
      storageWith(true),
    );
    expect(heard.slice(0, 3)).toEqual(['', '', '']);
    expect(heard.at(3)).toBe(`Plan change: ${SENTENCE}`);
  });

  it('is not a second voice: the sentence on the screen is in no live region of its own', async () => {
    await ride([[100, FIRST]], storageWith(true));
    const shown = [...document.querySelectorAll('.oyl-status')].find((each) =>
      (each.textContent ?? '').includes(SENTENCE),
    );
    expect(shown).toBeDefined();
    expect(shown?.getAttribute('role')).toBeNull();
    expect(shown?.getAttribute('aria-live')).toBeNull();
  });
});
