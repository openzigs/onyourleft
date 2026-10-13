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
import type { JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ANNOUNCEMENTS_STORAGE_KEY,
  DEFAULT_ANNOUNCEMENTS,
  type PreferenceStorage,
} from '../game/hud/announce-preference';
import { auditAccessibility, formatViolations, tabbableElements } from '../a11y/audit';
import { activateWithKeyboard, mount, settle, type Mounted } from '../testing/mount';
import { workoutStub } from '../workouts/testing';
import {
  REPLAN_SWITCH_LABEL,
  replanDisclosure,
  replanDisclosureSentences,
} from '../workout/replan-disclosure';
import {
  REPLAN_DISCARDED,
  REPLAN_OFF_BUTTON,
  REPLANS_OFF,
  type WaitingReplan,
} from '../workout/replan-text';

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
  discarded?: number,
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
  replan: { waiting, kept: false, notice: undefined, discarded },
});

function storageWith(enabled: boolean): PreferenceStorage {
  const value = JSON.stringify({ ...DEFAULT_ANNOUNCEMENTS, enabled, intervalLeadSeconds: 'never' });
  return {
    getItem: (key) => (key === ANNOUNCEMENTS_STORAGE_KEY ? value : null),
    setItem: () => undefined,
  };
}

/**
 * The panel where the Ride screen puts it: in the page's `main`, under its
 * `h1` and the group's `h2`, so the whole-document audit judges the panel and
 * not the absence of a page around it.
 */
const onTheRideScreen = (panel: JSX.Element): JSX.Element => (
  <main>
    <h1>Ride</h1>
    <h2>Trainer</h2>
    {panel}
  </main>
);

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const region = (): string =>
  document.querySelector('[data-oyl-announcer="ride"]')?.textContent ?? '<no region>';

/** Ride the panel through snapshots; the announcer's clock is the workout's here. */
async function ride(
  steps: readonly (readonly [number, WaitingReplan | undefined, number?])[],
  storage: PreferenceStorage,
): Promise<string[]> {
  let clock = 0;
  const panel = (elapsed: number, waiting: WaitingReplan | undefined, discarded?: number) =>
    onTheRideScreen(
      <WorkoutPanel
        trainer={trainer}
        workout={riding(elapsed, waiting, discarded)}
        port={workoutStub(ATHLETE, [record])}
        thresholdPower={watts(250)}
        onStart={() => undefined}
        onEnd={() => undefined}
        onKeepPlan={() => undefined}
        announcements={storage}
        announcerClock={() => clock}
      />,
    );
  const heard: string[] = [];
  for (const [index, [at, waiting, discarded]] of steps.entries()) {
    clock = at;
    if (index === 0) {
      mounted = await mount(panel(at, waiting, discarded));
    } else {
      await mounted?.rerender(panel(at, waiting, discarded));
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

describe('a waiting move a pause or a lost trainer discarded, on the Ride screen — #1244', () => {
  const DISCARDED = `Plan change: ${REPLAN_DISCARDED}`;

  it('says so once, after the move’s own sentence, and not again while the line stands', async () => {
    const heard = await ride(
      [
        [100, undefined],
        [110, FIRST],
        [120, undefined, 1],
        [130, undefined, 1],
        [140, undefined, 1],
      ],
      storageWith(true),
    );
    expect(heard).toEqual(['', `Plan change: ${SENTENCE}`, DISCARDED, DISCARDED, DISCARDED]);
    // One node: the discard's sentence was written once, over the move's.
    expect(document.querySelectorAll('[data-oyl-announcer="ride"] span')).toHaveLength(1);
    // And it is on the screen, with no control beside it.
    expect(document.body.textContent).toContain(REPLAN_DISCARDED);
    expect(
      [...document.querySelectorAll('button')].some((each) => each.textContent === 'Keep the plan'),
    ).toBe(false);
  });

  it('says it above threshold power too: a pause is not a moment to hold a sentence for', async () => {
    const heard = await ride(
      [
        [100, undefined],
        // Said in the easy block, then discarded 20 s into the block at 110 %.
        [110, FIRST],
        [620, undefined, 1],
      ],
      storageWith(true),
    );
    expect(heard.at(-1)).toBe(DISCARDED);
  });

  it('takes away in silence a move whose own sentence was held back and never said', async () => {
    const heard = await ride(
      [
        [590, undefined],
        // Accepted 20 s into the block at 110 %: held, not said.
        [620, FIRST],
        [640, undefined, 1],
        [660, undefined, 1],
      ],
      storageWith(true),
    );
    expect(heard).toEqual(['', '', '', '']);
    // It is still on the screen: the rider could have read the move there.
    expect(document.body.textContent).toContain(REPLAN_DISCARDED);
  });

  it('says nothing with announcements off, and still shows it', async () => {
    const heard = await ride(
      [
        [100, undefined],
        [110, undefined, 1],
      ],
      storageWith(false),
    );
    expect(heard).toEqual(['', '']);
    expect(document.body.textContent).toContain(REPLAN_DISCARDED);
  });

  it('does not say a discard that already stood when the screen appeared', async () => {
    const heard = await ride(
      [
        [100, undefined, 1],
        [110, undefined, 1],
      ],
      storageWith(true),
    );
    expect(heard).toEqual(['', '']);
  });

  it('audits clean', async () => {
    await ride([[100, undefined, 1]], storageWith(true));
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });
});

describe('the switch and its disclosure, where a workout is chosen — #1244, #1245', () => {
  const chooser = () =>
    onTheRideScreen(
      <WorkoutPanel
        trainer={trainer}
        workout={undefined}
        port={workoutStub(ATHLETE, [record])}
        thresholdPower={watts(250)}
        onStart={() => undefined}
        onEnd={() => undefined}
        replansAvailable
        announcements={storageWith(true)}
      />,
    );
  const theSwitch = (): HTMLInputElement | null =>
    document.querySelector<HTMLInputElement>('input[role="switch"]');

  it('audits clean with the switch off, and again with it on', async () => {
    mounted = await mount(chooser());
    await settle();
    expect(theSwitch()?.checked).toBe(false);
    expect(formatViolations(auditAccessibility(document))).toBe('');

    await activateWithKeyboard(theSwitch() as HTMLElement);
    expect(theSwitch()?.checked).toBe(true);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('is a switch named by its label and described by the disclosure’s headline', async () => {
    mounted = await mount(chooser());
    await settle();
    const input = theSwitch();
    expect(input?.closest('label')?.textContent).toBe(REPLAN_SWITCH_LABEL);
    expect(input?.getAttribute('aria-checked') ?? String(input?.checked)).toBe('false');
    const described = document.getElementById(input?.getAttribute('aria-describedby') ?? '');
    expect(described?.textContent).toBe(replanDisclosure().headline);
    // In the tab order, and reached before the text that describes it ends.
    expect(tabbableElements(document)).toContain(input);
  });

  it('shows every sentence as text a screen reader meets in order, none in a live region', async () => {
    mounted = await mount(chooser());
    await settle();
    const block = document.querySelector('[data-oyl-replan-disclosure]');
    const sentences = replanDisclosureSentences(replanDisclosure());
    let from = 0;
    for (const sentence of sentences) {
      const at = (block?.textContent ?? '').indexOf(sentence, from);
      expect(at, sentence).toBeGreaterThanOrEqual(from);
      from = at + sentence.length;
    }
    expect(block?.closest('[role="status"], [aria-live]')).toBeNull();
    expect(block?.querySelector('[role="status"], [aria-live]')).toBeNull();
  });
});

describe('switching re-plans off while the workout runs, on the Ride screen — #1244', () => {
  const panel = (off: boolean) =>
    onTheRideScreen(
      <WorkoutPanel
        trainer={trainer}
        workout={{
          ...riding(100, undefined),
          replan: { waiting: undefined, kept: false, notice: undefined, off },
        }}
        port={workoutStub(ATHLETE, [record])}
        thresholdPower={watts(250)}
        onStart={() => undefined}
        onEnd={() => undefined}
        onKeepPlan={() => undefined}
        onReplansOff={() => undefined}
        announcements={storageWith(true)}
      />,
    );

  it('audits clean with the control on the screen, and it is in the tab order after End workout', async () => {
    mounted = await mount(panel(false));
    await settle();
    expect(formatViolations(auditAccessibility(document))).toBe('');
    const names = tabbableElements(document).map((each) => each.textContent);
    expect(names).toContain(REPLAN_OFF_BUTTON);
    expect(names.indexOf(REPLAN_OFF_BUTTON)).toBe(names.indexOf('End workout') + 1);
  });

  it('audits clean once off, and says so in a region of its own: the answer to the rider’s press', async () => {
    mounted = await mount(panel(false));
    await settle();
    await mounted.rerender(panel(true));
    await settle();
    expect(formatViolations(auditAccessibility(document))).toBe('');
    const said = [...document.querySelectorAll('[role="status"]')].filter((each) =>
      (each.textContent ?? '').includes(REPLANS_OFF),
    );
    expect(said).toHaveLength(1);
    // Not through the announcer's region: that one says plan changes.
    expect(region()).toBe('');
  });
});
