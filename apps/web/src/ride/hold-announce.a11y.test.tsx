// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The heart-rate hold on the Ride screen — #1240: shown with its range, its
 * target and one sentence, and said by the screen's one region when the
 * sentence changes, announcements on only, at most once a minute.
 *
 * ⚠️ What this cannot establish: that TalkBack speaks it. That is
 * `docs/validation/0003` (#393), and #1246 adds the hold's steps.
 */

import {
  beatsPerMinute,
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
import { HOLD_SPOKEN_EVERY_SECONDS, holdSentence, type WorkoutHold } from '../workout/hold-text';

import type { RideWorkoutSnapshot, TrainerSnapshot } from './controller';
import { WorkoutPanel } from './WorkoutPanel';

const ATHLETE = toAthleteId('athlete-a');
const range = { low: beatsPerMinute(130), high: beatsPerMinute(140) };
const blocks: readonly WorkoutBlock[] = [
  {
    kind: 'heart-rate-hold',
    seconds: seconds(1800),
    range,
    startShare: thresholdShare(0.5),
    ceilingShare: thresholdShare(0.8),
  },
];
const TIMELINE = expandWorkout({ name: 'Hold', blocks });
const record: WorkoutRecord = {
  id: workoutId('w1'),
  createdBy: ATHLETE,
  name: 'Hold',
  workout: { name: 'Hold', blocks },
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

const holding = (hold: WorkoutHold): RideWorkoutSnapshot => ({
  name: 'Hold',
  status: 'running',
  elapsedSeconds: 300,
  totalSeconds: 1800,
  holdingWatts: hold.target,
  nowRiding: '30 min holding 130–140 bpm',
  fault: undefined,
  rescue: undefined,
  hold,
  timeline: TIMELINE,
});

function storageWith(enabled: boolean): PreferenceStorage {
  const value = JSON.stringify({ ...DEFAULT_ANNOUNCEMENTS, enabled });
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

/** Ride the panel through holds at given instants of the announcer's clock. */
async function ride(
  steps: readonly (readonly [number, WorkoutHold])[],
  storage: PreferenceStorage,
): Promise<string[]> {
  let clock = 0;
  const panel = (hold: WorkoutHold) => (
    <WorkoutPanel
      trainer={trainer}
      workout={holding(hold)}
      port={workoutStub(ATHLETE, [record])}
      thresholdPower={watts(250)}
      onStart={() => undefined}
      onEnd={() => undefined}
      announcements={storage}
      announcerClock={() => clock}
    />
  );
  const heard: string[] = [];
  for (const [index, [at, hold]] of steps.entries()) {
    clock = at;
    if (index === 0) {
      mounted = await mount(panel(hold));
    } else {
      await mounted?.rerender(panel(hold));
    }
    await settle();
    heard.push(region());
  }
  return heard;
}

const LOWERED: WorkoutHold = { reason: 'lowered', range, target: 160 };
const RAISED: WorkoutHold = { reason: 'raised', range, target: 165 };
const SILENT: WorkoutHold = { reason: 'silent', range, target: 165 };

describe('the heart-rate hold on the Ride screen — #1240', () => {
  it('shows the range, the target and the sentence, and keeps them on the screen', async () => {
    await ride([[0, LOWERED]], storageWith(false));
    const shown = [...document.querySelectorAll('.oyl-status')].find((each) =>
      (each.textContent ?? '').includes(holdSentence(LOWERED)),
    );
    expect(shown?.textContent).toContain('Heart-rate hold');
    expect(shown?.textContent).toContain('Range 130–140 bpm, target 160 W.');
    expect(shown?.hasAttribute('data-oyl-kept-visible')).toBe(true);
    expect(shown?.getAttribute('role'), 'a second voice').toBeNull();
  });

  it('says a change, with announcements on, and not the first sentence it sees', async () => {
    const heard = await ride(
      [
        [10, LOWERED],
        [20, RAISED],
      ],
      storageWith(true),
    );
    expect(heard).toEqual(['', `Heart-rate hold: ${holdSentence(RAISED)}`]);
  });

  it('says nothing with announcements off', async () => {
    const heard = await ride(
      [
        [10, LOWERED],
        [20, RAISED],
      ],
      storageWith(false),
    );
    expect(heard).toEqual(['', '']);
  });

  it('says at most one a minute', async () => {
    const heard = await ride(
      [
        [10, LOWERED],
        [20, RAISED],
        [30, SILENT],
        [20 + HOLD_SPOKEN_EVERY_SECONDS + 1, LOWERED],
      ],
      storageWith(true),
    );
    expect(heard.at(1)).toBe(`Heart-rate hold: ${holdSentence(RAISED)}`);
    // The silent change, inside the minute, is shown and not said.
    expect(heard.at(2)).toBe(heard.at(1));
    expect(heard.at(3)).toBe(`Heart-rate hold: ${holdSentence(LOWERED)}`);
  });
});
