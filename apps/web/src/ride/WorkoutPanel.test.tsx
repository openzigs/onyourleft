// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The ride screen's workout panel (#14).
 *
 * What is asserted here is what a rider is *told* and *offered*: the controller
 * tests prove the loop, and this proves the screen never offers a control that
 * would fail — which is #48's rule and, for a trainer, a safety one.
 */

import {
  CADENCE_SILENT_REASON,
  createErgRescue,
  expandWorkout,
  revolutionsPerMinute,
  seconds,
  TREND_WINDOW,
  thresholdShare,
  unixSeconds,
  watts,
  type WorkoutBlock,
  type WorkoutRescue,
} from '@onyourleft/domain';
import { athleteId as toAthleteId, workoutId, type WorkoutRecord } from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import { workoutStub } from '../workouts/testing';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';

import {
  REPLAN_SWITCH_LABEL,
  replanDisclosure,
  replanDisclosureSentences,
} from '../workout/replan-disclosure';
import {
  PLAN_KEPT,
  REPLAN_DISCARDED,
  REPLAN_OFF_BUTTON,
  REPLAN_UNAVAILABLE,
  REPLANS_OFF,
  REPLANS_ON_BADGE,
} from '../workout/replan-text';

import type { RideWorkoutSnapshot, TrainerSnapshot } from './controller';
import { WorkoutPanel } from './WorkoutPanel';

const ATHLETE = toAthleteId('athlete-a');

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const blocks: readonly WorkoutBlock[] = [
  { kind: 'steady', seconds: seconds(600), target: thresholdShare(0.6) },
];

const record = (name = 'Sweet spot'): WorkoutRecord => ({
  id: workoutId('w1'),
  createdBy: ATHLETE,
  name,
  workout: { name, blocks },
  createdAt: unixSeconds(1),
  updatedAt: unixSeconds(1),
});

/**
 * ⚠️ **The `as TrainerSnapshot` this used to carry is gone, and its removal is
 * a finding rather than tidying** (#362). `canSimulate` was already in this
 * literal before `TrainerSnapshot` had the field — the assertion suppressed the
 * excess-property check, so a fixture describing a field the type did not have
 * compiled silently. Giving the snapshot its real field made the assertion
 * unnecessary, which is what `@typescript-eslint/no-unnecessary-type-assertion`
 * then said out loud.
 */
const trainer = (overrides: Partial<TrainerSnapshot> = {}): TrainerSnapshot => ({
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
  ergRescue: undefined,
  ergHeld: undefined,
  ...overrides,
});

const running = (overrides: Partial<RideWorkoutSnapshot> = {}): RideWorkoutSnapshot => ({
  name: 'Sweet spot',
  status: 'running',
  elapsedSeconds: 120,
  totalSeconds: 600,
  holdingWatts: 150,
  nowRiding: '10 min at 60%',
  fault: undefined,
  rescue: undefined,
  timeline: expandWorkout({ name: 'Sweet spot', blocks }),
  ...overrides,
});

async function render(props: Partial<Parameters<typeof WorkoutPanel>[0]> = {}) {
  const view = await mount(
    <WorkoutPanel
      trainer={trainer()}
      workout={undefined}
      port={workoutStub(ATHLETE, [record()])}
      thresholdPower={watts(250)}
      onStart={() => undefined}
      onEnd={() => undefined}
      {...props}
    />,
  );
  await settle();
  mounted = view;
  return view;
}

function buttonSaying(root: ParentNode, text: string): HTMLElement | undefined {
  return queryAll<HTMLButtonElement>(root, 'button').find((button) =>
    (button.textContent ?? '').includes(text),
  );
}

describe('what the panel will not offer', () => {
  it('renders nothing at all with no controllable trainer', async () => {
    const view = await render({ trainer: trainer({ controllable: false }) });
    expect(view.container.textContent).toBe('');
  });

  it('asks for control first rather than offering a workout that would be refused', async () => {
    // ⚠️ A trainer that has not granted control answers every setpoint
    // 0x05 Control Not Permitted, so a Start here would run a clock and control
    // nothing — #14's revision block's named silent failure.
    const view = await render({ trainer: trainer({ hasControl: false }) });
    expect(view.container.textContent).toContain('Ask the trainer for control first');
    expect(buttonSaying(view.container, 'Ride ')).toBeUndefined();
  });

  it('refuses without a threshold rather than substituting one', async () => {
    // A workout's targets are shares of threshold, so a default would put a
    // made-up number on a trainer.
    const view = await render({ thresholdPower: undefined });
    expect(view.container.textContent).toContain('Set your threshold power');
    expect(buttonSaying(view.container, 'Ride ')).toBeUndefined();
  });

  it('says so when nothing is saved', async () => {
    const view = await render({ port: workoutStub(ATHLETE) });
    expect(view.container.textContent).toContain('No workouts saved on this device yet');
  });

  it('still offers the ride when the library cannot be read', async () => {
    const stub = workoutStub(ATHLETE, [record()]);
    stub.failNextList();
    const view = await render({ port: stub });
    expect(view.container.textContent).toContain('You can still ride without one');
  });
});

describe('starting one', () => {
  it('names the workout on its own button, and hands the record back', async () => {
    const started: string[] = [];
    const view = await render({
      onStart: (chosen) => {
        started.push(chosen.name);
      },
    });
    await activateWithKeyboard(buttonSaying(view.container, 'Ride Sweet spot') as HTMLElement);
    expect(started).toEqual(['Sweet spot']);
  });

  it('describes each workout before a rider commits to it', async () => {
    const view = await render();
    expect(view.container.textContent).toContain('10 min at 60%');
  });
});

describe('while one is running', () => {
  it('reports the block, the clock and what the trainer confirmed', async () => {
    const view = await render({ workout: running() });
    const text = view.container.textContent ?? '';
    expect(text).toContain('Riding');
    expect(text).toContain('2 min of 10 min');
    expect(text).toContain('10 min at 60%');
    expect(text).toContain('Holding 150 W');
  });

  it('says why the trainer holds more than the block asks, when the target was raised — #1305', async () => {
    const view = await render({
      workout: running({ holdingWatts: 100, raisedFromWatts: 75, nowRiding: '10 min at 30%' }),
    });
    const text = view.container.textContent ?? '';
    expect(text).toContain(
      'Holding 100 W. This block asks for 75 W, which is less than the lowest target this trainer accepts.',
    );
  });

  it('says nothing about a raise when the workout’s own number was written — #1305', async () => {
    const view = await render({ workout: running() });
    const text = view.container.textContent ?? '';
    expect(text).toContain('Holding 150 W.');
    expect(text).not.toContain('This block asks for');
  });

  it('says the trainer has not confirmed rather than quoting a number it has not', async () => {
    // ⚠️ `TrainerPanel.tsx`'s rule, applied here: the word "Holding" is the
    // guarantee, and it may not appear before the machine has answered.
    const view = await render({ workout: running({ holdingWatts: undefined }) });
    const text = view.container.textContent ?? '';
    expect(text).toContain('has not confirmed a target yet');
    expect(text).not.toContain('Holding');
  });

  it('does not say "Holding" once the link is lost — #605 review', async () => {
    // `holdingWatts` is the writer's last acknowledged write and outlives a
    // lost link; with control gone this app cannot say what the machine holds.
    const view = await render({
      workout: running(),
      trainer: trainer({
        hasControl: false,
        lost: 'link-lost',
        target: { kind: 'unknown', attempted: watts(150) } as TrainerSnapshot['target'],
      }),
    });
    const text = view.container.querySelector('section')?.textContent ?? '';
    expect(text).toContain('The trainer was last set to 150 W.');
    expect(text).not.toContain('Holding');
  });

  it('tells a paused rider it will pick up, not that it stopped', async () => {
    // A paused workout keeps every offset. Telling a rider it stopped would
    // invite them to restart a session they have not lost.
    const view = await render({ workout: running({ status: 'paused' }) });
    const text = view.container.textContent ?? '';
    expect(text).toContain('pick up where you left off');
    expect(text).not.toContain('Stopped');
  });

  it('surfaces a refused write without ending the workout', async () => {
    const view = await render({
      workout: running({ fault: 'The trainer refused that target.' }),
    });
    expect(view.container.textContent).toContain('The trainer refused that target');
    expect(buttonSaying(view.container, 'End workout')).toBeDefined();
  });

  it('offers a way out', async () => {
    let ended = 0;
    const view = await render({
      workout: running(),
      onEnd: () => {
        ended += 1;
      },
    });
    await activateWithKeyboard(buttonSaying(view.container, 'End workout') as HTMLElement);
    expect(ended).toBe(1);
  });

  it('does not offer the library while one is running', async () => {
    const view = await render({ workout: running() });
    expect(buttonSaying(view.container, 'Ride Sweet spot')).toBeUndefined();
  });
});

describe('why the target is eased — #585', () => {
  /**
   * The rescue's own steps, from the real latch rather than typed here, so
   * the sentences asserted are the ones `erg-safety.ts` actually produces.
   */
  function rescueSteps(): { stalled: WorkoutRescue; silent: WorkoutRescue } {
    const rescue = createErgRescue();
    const stall = [
      { at: seconds(4), cadence: revolutionsPerMinute(30) },
      { at: seconds(10), cadence: revolutionsPerMinute(4) },
    ];
    const stalled = rescue.judge(stall, seconds(10));
    const silent = rescue.judge(stall, seconds(10 + TREND_WINDOW + 1));
    if (stalled.kind === 'full' || silent.kind === 'full') throw new Error('expected a rescue');
    return { stalled, silent };
  }

  /**
   * The panel's own section. ⚠️ Not the container: the ride's one announcement
   * region is rendered first inside it and says the stall too, so a
   * container-wide "does not contain" would read the region's LAST sentence.
   */
  const shown = (root: ParentNode): string => {
    const section = root.querySelector('section');
    if (section === null) return '';
    // ⚠️ Since #605 the way back and the way out sit in a CLOSED `<details>`
    // under the sentence, and `textContent` reads a closed disclosure's body
    // as though it were on screen. What is SHOWN is the summary alone, so a
    // closed disclosure is read as its summary here (#605's review).
    const copy = section.cloneNode(true) as HTMLElement;
    for (const details of queryAll<HTMLDetailsElement>(copy, 'details')) {
      if (details.open) continue;
      for (const child of [...details.children]) {
        if (child.tagName !== 'SUMMARY') child.remove();
      }
    }
    return copy.textContent ?? '';
  };

  /** What the rider reads once they open *How the target comes back*. */
  const disclosed = (root: ParentNode): string =>
    root.querySelector('section details')?.textContent ?? '';

  const easedNotice = (root: ParentNode) =>
    queryAll<HTMLElement>(root, '*').find((element) =>
      (element.textContent ?? '').startsWith('Eased'),
    );

  it('says the stall, then the silent sensor, then nothing once the target is back', async () => {
    const { stalled, silent } = rescueSteps();
    expect(silent.reason).toBe(CADENCE_SILENT_REASON);

    const view = await render({ workout: running() });
    expect(shown(view.container)).not.toContain('Eased');

    await view.rerender(
      <WorkoutPanel
        trainer={trainer()}
        workout={running({ rescue: stalled })}
        port={workoutStub(ATHLETE, [record()])}
        thresholdPower={watts(250)}
        onStart={() => undefined}
        onEnd={() => undefined}
      />,
    );
    let text = shown(view.container);
    expect(text).toContain(stalled.reason);
    // The floor's way back is two steps, and the way out is the panel's button
    // — both behind the disclosure since #605, so NOT shown until it is opened.
    expect(text).not.toContain('steps up to a lighter target first');
    expect(text).not.toContain('Press End workout to leave it.');
    expect(disclosed(view.container)).toContain('steps up to a lighter target first');
    expect(disclosed(view.container)).toContain('Press End workout to leave it.');
    expect(easedNotice(view.container)).toBeDefined();

    await view.rerender(
      <WorkoutPanel
        trainer={trainer()}
        workout={running({ rescue: silent })}
        port={workoutStub(ATHLETE, [record()])}
        thresholdPower={watts(250)}
        onStart={() => undefined}
        onEnd={() => undefined}
      />,
    );
    text = shown(view.container);
    expect(text).toContain(CADENCE_SILENT_REASON);
    expect(text).not.toContain(stalled.reason);

    await view.rerender(
      <WorkoutPanel
        trainer={trainer()}
        workout={running({ rescue: undefined })}
        port={workoutStub(ATHLETE, [record()])}
        thresholdPower={watts(250)}
        onStart={() => undefined}
        onEnd={() => undefined}
      />,
    );
    expect(shown(view.container)).not.toContain('Eased');
    expect(shown(view.container)).not.toContain(CADENCE_SILENT_REASON);
  });
});

describe('what a stalled rider sees first — #605', () => {
  const STALLED: WorkoutRescue = {
    kind: 'floor',
    reason: 'Pedalling has stopped, so the target has been dropped to the trainer’s lowest.',
  };

  it('shows ONE sentence, with the way back and the way out behind a closed disclosure', async () => {
    const view = await render({ workout: running({ rescue: STALLED }) });
    const sentence = view.container.querySelector('section .oyl-status__sentence');
    expect(sentence?.textContent).toBe(`Eased: ${STALLED.reason}`);
    const details = view.container.querySelector('section .oyl-status details');
    expect(details).not.toBeNull();
    expect((details as HTMLDetailsElement).open).toBe(false);
    expect(details?.textContent).toContain('Press End workout to leave it.');
  });

  it('puts End workout before the notice, and the reading after both', async () => {
    const view = await render({ workout: running({ rescue: STALLED }) });
    const section = view.container.querySelector('section');
    const end = buttonSaying(section ?? view.container, 'End workout');
    const notice = section?.querySelector('.oyl-status');
    const holding = queryAll<HTMLElement>(section ?? view.container, 'p').find((each) =>
      (each.textContent ?? '').startsWith('Holding'),
    );
    if (end === undefined || notice === null || notice === undefined || holding === undefined) {
      throw new Error('the running section is missing a part');
    }
    const follows = (a: Node, b: Node): boolean =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(end, notice)).toBe(true);
    expect(follows(notice, holding)).toBe(true);
  });
});

describe('the running workout as a picture is not this panel’s — #1307', () => {
  it('draws no graph: the Ride screen draws it, in a group after this one', async () => {
    // `views/RideView.test.tsx` §"#1307" holds where it IS drawn. Here: the
    // panel keeps every sentence it had and holds no picture, so nothing
    // stands between *End workout* and the sentences under it.
    const view = await render({ workout: running() });
    const text = view.container.textContent ?? '';
    expect(text).toContain('Now: 10 min at 60%');
    expect(text).toContain('Holding 150 W.');
    expect(view.container.querySelector('[data-oyl-workout-graph]')).toBeNull();
    expect(view.container.querySelector('[role="img"]')).toBeNull();
  });
});

describe('re-plans during the ride — #1244', () => {
  const SENTENCE =
    'Next block shortened by 2 minutes, because your heart rate stayed above the range you chose.';
  const waiting = (overrides: Partial<NonNullable<RideWorkoutSnapshot['replan']>> = {}) =>
    running({
      replan: {
        waiting: { revision: 1, sentence: SENTENCE },
        kept: false,
        notice: undefined,
        ...overrides,
      },
    });
  const theSwitch = (root: ParentNode): HTMLInputElement | undefined =>
    queryAll<HTMLInputElement>(root, 'input[role="switch"]')[0];

  describe('the per-ride switch', () => {
    it('is not shown where no re-plan could happen', async () => {
      const view = await render();
      expect(theSwitch(view.container)).toBeUndefined();
      expect(view.container.textContent).not.toContain('instance');
    });

    /** The disclosure's sentences as the panel shows them, in order. */
    const shownDisclosure = (root: ParentNode): readonly string[] =>
      queryAll(root, '[data-oyl-replan-disclosure] p').map((each) => each.textContent ?? '');

    it('is shown, off, named as the owner named it, with #1245’s whole disclosure under it', async () => {
      const view = await render({ replansAvailable: true });
      const input = theSwitch(view.container);
      expect(input?.checked).toBe(false);
      expect(input?.closest('label')?.textContent).toBe('Re-plan during the ride');
      expect(REPLAN_SWITCH_LABEL).toBe('Re-plan during the ride');
      // Every sentence of `replanDisclosure()`, in its order, BEFORE the
      // switch is on — the same strings the privacy policy is held to.
      const disclosure = replanDisclosure();
      expect(shownDisclosure(view.container)).toEqual(replanDisclosureSentences(disclosure));
      expect(shownDisclosure(view.container)).toHaveLength(9);
    });

    it('describes the switch by the headline, and hides none of it behind a disclosure widget', async () => {
      const view = await render({ replansAvailable: true });
      const input = theSwitch(view.container);
      const described = view.container.querySelector(
        `#${input?.getAttribute('aria-describedby') ?? ''}`,
      );
      expect(described?.textContent).toBe(replanDisclosure().headline);
      const block = view.container.querySelector('[data-oyl-replan-disclosure]');
      expect(block?.closest('details')).toBeNull();
      // There BEFORE the switch is on: not hidden, and nothing in it hidden.
      expect(theSwitch(view.container)?.checked).toBe(false);
      expect(block?.closest('[hidden], [aria-hidden="true"]')).toBeNull();
      expect(block?.querySelector('details, [hidden], [aria-hidden="true"]')).toBeNull();
      // After the switch, so a rider reads on from the control.
      expect(
        (input as HTMLElement).compareDocumentPosition(block as Element) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('stops saying "This is off" once it is on, and keeps every other sentence', async () => {
      const view = await render({ replansAvailable: true });
      const disclosure = replanDisclosure();
      await activateWithKeyboard(theSwitch(view.container) as HTMLElement);
      expect(theSwitch(view.container)?.checked).toBe(true);
      expect(shownDisclosure(view.container)).toEqual(
        replanDisclosureSentences(disclosure).filter((each) => each !== disclosure.offUntilOn),
      );
      expect(view.container.textContent).not.toContain('This is off');
      await activateWithKeyboard(theSwitch(view.container) as HTMLElement);
      expect(view.container.textContent).toContain(disclosure.offUntilOn);
    });

    it('shows none of the disclosure where there is no switch', async () => {
      const view = await render();
      expect(shownDisclosure(view.container)).toEqual([]);
    });

    it('comes BEFORE the workouts, with the headline; the other eight sentences come after them — #1329', async () => {
      const view = await render({ replansAvailable: true });
      const ride = buttonSaying(view.container, 'Ride Sweet spot') as HTMLElement;
      const input = theSwitch(view.container) as HTMLElement;
      const follows = (a: Element, b: Element) =>
        (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      expect(follows(input, ride)).toBe(true);
      const headline = view.container.querySelector('#oyl-replan-disclosure-headline') as Element;
      expect(follows(input, headline)).toBe(true);
      expect(follows(headline, ride)).toBe(true);
      const rest = queryAll(view.container, '[data-oyl-replan-disclosure="rest"] p');
      expect(rest).toHaveLength(8);
      expect(follows(ride, rest[0] as Element)).toBe(true);
    });

    it('is not shown where no workout can be started', async () => {
      const noControl = await render({
        replansAvailable: true,
        trainer: trainer({ hasControl: false }),
      });
      expect(theSwitch(noControl.container)).toBeUndefined();
      noControl.unmount();
      const noThreshold = await render({ replansAvailable: true, thresholdPower: undefined });
      expect(theSwitch(noThreshold.container)).toBeUndefined();
    });

    it('starts a workout with re-plans off unless the rider turned it on', async () => {
      const started: unknown[] = [];
      const view = await render({
        replansAvailable: true,
        onStart: (_, choices) => {
          started.push(choices);
        },
      });
      await activateWithKeyboard(buttonSaying(view.container, 'Ride Sweet spot') as HTMLElement);
      expect(started).toEqual([{}]);

      await activateWithKeyboard(theSwitch(view.container) as HTMLElement);
      expect(theSwitch(view.container)?.checked).toBe(true);
      await activateWithKeyboard(buttonSaying(view.container, 'Ride Sweet spot') as HTMLElement);
      expect(started).toEqual([{}, { replans: true }]);
    });

    it('is off again for the next workout: a choice is for one ride', async () => {
      const props = {
        trainer: trainer(),
        port: workoutStub(ATHLETE, [record()]),
        thresholdPower: watts(250),
        onStart: () => undefined,
        onEnd: () => undefined,
        replansAvailable: true,
      };
      const view = await render(props);
      await activateWithKeyboard(theSwitch(view.container) as HTMLElement);
      expect(theSwitch(view.container)?.checked).toBe(true);
      await view.rerender(<WorkoutPanel {...props} workout={running()} />);
      await settle();
      expect(theSwitch(view.container)).toBeUndefined();
      await view.rerender(<WorkoutPanel {...props} workout={undefined} />);
      await settle();
      expect(theSwitch(view.container)?.checked).toBe(false);
    });
  });

  describe('Keep the plan', () => {
    it('shows the sentence, when it starts, and the one control while a move waits', async () => {
      let kept = 0;
      const view = await render({
        workout: waiting(),
        onKeepPlan: () => {
          kept += 1;
        },
      });
      expect(view.container.textContent).toContain(
        `Plan change: ${SENTENCE} It starts with the next block.`,
      );
      const button = buttonSaying(view.container, 'Keep the plan');
      expect(button?.textContent).toBe('Keep the plan');
      // A ride-time control: the 48 px floor (`design/ride-time-controls.ts`).
      expect(button?.classList.contains('oyl-button--ride')).toBe(true);
      await activateWithKeyboard(button as HTMLElement);
      expect(kept).toBe(1);
    });

    it('puts the sentence before the control, and both after End workout', async () => {
      const view = await render({ workout: waiting(), onKeepPlan: () => undefined });
      const text = view.container.textContent ?? '';
      expect(text.indexOf('End workout')).toBeLessThan(text.indexOf(SENTENCE));
      expect(text.indexOf(SENTENCE)).toBeLessThan(text.indexOf('Keep the plan'));
    });

    it('is not offered when no move is waiting', async () => {
      const view = await render({
        workout: waiting({ waiting: undefined }),
        onKeepPlan: () => undefined,
      });
      expect(buttonSaying(view.container, 'Keep the plan')).toBeUndefined();
      expect(view.container.textContent).not.toContain('Plan change');
    });

    it('is not offered for a workout with no re-plans at all', async () => {
      const view = await render({ workout: running(), onKeepPlan: () => undefined });
      expect(buttonSaying(view.container, 'Keep the plan')).toBeUndefined();
    });

    it('answers the press in a live region, and shows the control no more', async () => {
      const view = await render({
        workout: waiting({ waiting: undefined, kept: true }),
        onKeepPlan: () => undefined,
      });
      const answer = queryAll(view.container, '[role="status"]').find((each) =>
        (each.textContent ?? '').includes(PLAN_KEPT),
      );
      expect(answer).toBeDefined();
      expect(buttonSaying(view.container, 'Keep the plan')).toBeUndefined();
    });

    it('does not make the waiting sentence a second live region: the announcer says it', async () => {
      const view = await render({ workout: waiting(), onKeepPlan: () => undefined });
      const live = queryAll(view.container, '[role="status"], [aria-live]').filter(
        (each) =>
          (each.textContent ?? '').includes(SENTENCE) && !each.hasAttribute('data-oyl-announcer'),
      );
      expect(live).toEqual([]);
    });
  });

  describe('switching re-plans off while the workout runs — ADR 0048 D-7', () => {
    const on = () => waiting({ waiting: undefined });

    it('offers the control beside End workout while re-plans are on, as a ride-time control', async () => {
      let pressed = 0;
      const view = await render({
        workout: on(),
        onReplansOff: () => {
          pressed += 1;
        },
      });
      const off = buttonSaying(view.container, REPLAN_OFF_BUTTON);
      const end = buttonSaying(view.container, 'End workout');
      expect(off?.textContent).toBe('Switch re-plans off');
      expect(off?.classList.contains('oyl-button--ride')).toBe(true);
      // The same row as the other control that ends something, and after it.
      expect(off?.parentElement).toBe(end?.parentElement);
      expect(off?.parentElement?.classList.contains('oyl-workout-controls')).toBe(true);
      expect(
        (end as HTMLElement).compareDocumentPosition(off as HTMLElement) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      await activateWithKeyboard(off as HTMLElement);
      expect(pressed).toBe(1);
    });

    it('offers it with a move waiting too, above the plan change and its Keep the plan', async () => {
      const view = await render({
        workout: waiting(),
        onReplansOff: () => undefined,
        onKeepPlan: () => undefined,
      });
      const text = view.container.textContent ?? '';
      expect(text.indexOf(REPLAN_OFF_BUTTON)).toBeGreaterThan(text.indexOf('End workout'));
      expect(text.indexOf(REPLAN_OFF_BUTTON)).toBeLessThan(text.indexOf(SENTENCE));
      expect(buttonSaying(view.container, 'Keep the plan')).toBeDefined();
    });

    it('is not offered for a workout with no re-plans, or with nobody to hand the press to', async () => {
      const none = await render({ workout: running(), onReplansOff: () => undefined });
      expect(buttonSaying(none.container, REPLAN_OFF_BUTTON)).toBeUndefined();
      none.unmount();
      const unhandled = await render({ workout: on() });
      expect(buttonSaying(unhandled.container, REPLAN_OFF_BUTTON)).toBeUndefined();
    });

    it('once off, says so in a live region in place of the control, and offers no way back', async () => {
      const view = await render({
        workout: waiting({ waiting: undefined, off: true }),
        onReplansOff: () => undefined,
        onKeepPlan: () => undefined,
      });
      expect(buttonSaying(view.container, REPLAN_OFF_BUTTON)).toBeUndefined();
      expect(queryAll(view.container, 'input[role="switch"]')).toEqual([]);
      const said = queryAll(view.container, '[role="status"]').find((each) =>
        (each.textContent ?? '').includes(REPLANS_OFF),
      );
      expect(said).toBeDefined();
      expect(buttonSaying(view.container, 'End workout')).toBeDefined();
      expect(buttonSaying(view.container, 'Keep the plan')).toBeUndefined();
    });

    it('says nothing about being off while it is on', async () => {
      const view = await render({ workout: on(), onReplansOff: () => undefined });
      expect(view.container.textContent).not.toContain(REPLANS_OFF);
    });
  });

  describe('the switch’s state where Ride is pressed, and at the start of every ride', () => {
    const onLine = (root: ParentNode): string | undefined =>
      queryAll(root, '[data-oyl-replans-on]')[0]?.textContent ?? undefined;

    it('says beside the heading that it is on, only while it is on', async () => {
      const view = await render({ replansAvailable: true });
      expect(onLine(view.container)).toBeUndefined();
      await activateWithKeyboard(theSwitch(view.container) as HTMLElement);
      expect(onLine(view.container)).toBe(REPLANS_ON_BADGE);
      // Text, in a paragraph of its own, before the switch and the first
      // control that starts a workout (#1329: the switch is above the list).
      const badge = queryAll(view.container, '[data-oyl-replans-on]')[0] as HTMLElement;
      expect(badge.tagName).toBe('P');
      const ride = buttonSaying(view.container, 'Ride Sweet spot') as HTMLElement;
      expect(badge.compareDocumentPosition(ride) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const input = theSwitch(view.container) as HTMLElement;
      expect(badge.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      await activateWithKeyboard(theSwitch(view.container) as HTMLElement);
      expect(onLine(view.container)).toBeUndefined();
    });

    it('leaves the heading’s own name alone: the badge is beside the heading, not in it', async () => {
      const view = await render({ replansAvailable: true });
      const heading = () => view.container.querySelector('h3');
      expect(heading()?.textContent).toBe('Ride a workout');
      await activateWithKeyboard(theSwitch(view.container) as HTMLElement);
      // ⚠️ Still exactly this: a heading is what a screen-reader user moves by.
      expect(heading()?.textContent).toBe('Ride a workout');
      expect(heading()?.getAttribute('aria-label')).toBeNull();
      expect(heading()?.querySelector('[data-oyl-replans-on]')).toBeNull();
      // Straight after the heading, on its line: the heading's next sibling.
      expect(heading()?.nextElementSibling?.textContent).toBe(REPLANS_ON_BADGE);
      expect(heading()?.parentElement?.classList.contains('oyl-workout-heading')).toBe(true);
      // #1329: and the switch straight after the heading's row.
      expect(
        heading()?.parentElement?.nextElementSibling?.classList.contains('oyl-workout-replans'),
      ).toBe(true);
    });

    it('never says it where there is no switch', async () => {
      const view = await render();
      expect(onLine(view.container)).toBeUndefined();
    });

    it('is off again when a ride starts, and when one ends, though no workout was started', async () => {
      const props = {
        trainer: trainer(),
        port: workoutStub(ATHLETE, [record()]),
        thresholdPower: watts(250),
        onStart: () => undefined,
        onEnd: () => undefined,
        replansAvailable: true,
      };
      const view = await render({ ...props, rideInProgress: false });
      await activateWithKeyboard(theSwitch(view.container) as HTMLElement);
      expect(theSwitch(view.container)?.checked).toBe(true);
      // The ride starts: the choice made before it is not carried into it.
      await view.rerender(<WorkoutPanel {...props} workout={undefined} rideInProgress />);
      await settle();
      expect(theSwitch(view.container)?.checked).toBe(false);
      expect(onLine(view.container)).toBeUndefined();
      // Switched on during the ride, with no workout started; the ride ends.
      await activateWithKeyboard(theSwitch(view.container) as HTMLElement);
      expect(theSwitch(view.container)?.checked).toBe(true);
      await view.rerender(<WorkoutPanel {...props} workout={undefined} rideInProgress={false} />);
      await settle();
      expect(theSwitch(view.container)?.checked).toBe(false);
    });

    it('stays as the rider set it while the ride goes on', async () => {
      const props = {
        trainer: trainer(),
        port: workoutStub(ATHLETE, [record()]),
        thresholdPower: watts(250),
        onStart: () => undefined,
        onEnd: () => undefined,
        replansAvailable: true,
        rideInProgress: true,
      };
      const view = await render(props);
      await activateWithKeyboard(theSwitch(view.container) as HTMLElement);
      await view.rerender(<WorkoutPanel {...props} workout={undefined} power={200} />);
      await settle();
      expect(theSwitch(view.container)?.checked).toBe(true);
    });
  });

  describe('a waiting move a pause or a lost trainer discarded', () => {
    it('says so in one sentence, with no control and no waiting sentence', async () => {
      const view = await render({
        workout: waiting({ waiting: undefined, discarded: 1 }),
        onKeepPlan: () => undefined,
      });
      expect(view.container.textContent).toContain(`Plan change: ${REPLAN_DISCARDED}`);
      expect(view.container.textContent).not.toContain(SENTENCE);
      expect(buttonSaying(view.container, 'Keep the plan')).toBeUndefined();
    });

    it('is not a second live region: the announcer says it', async () => {
      const view = await render({ workout: waiting({ waiting: undefined, discarded: 1 }) });
      const live = queryAll(view.container, '[role="status"], [aria-live]').filter(
        (each) =>
          (each.textContent ?? '').includes(REPLAN_DISCARDED) &&
          !each.hasAttribute('data-oyl-announcer'),
      );
      expect(live).toEqual([]);
    });

    it('says nothing of it when no move was discarded', async () => {
      const view = await render({ workout: waiting() });
      expect(view.container.textContent).not.toContain(REPLAN_DISCARDED);
    });
  });

  it('shows the one short line after a request that failed, and nothing else', async () => {
    const view = await render({
      workout: waiting({ waiting: undefined, notice: REPLAN_UNAVAILABLE }),
    });
    expect(view.container.textContent).toContain(REPLAN_UNAVAILABLE);
    expect(buttonSaying(view.container, 'Keep the plan')).toBeUndefined();
  });

  it('renders only this module’s own words: nothing but the sentence the snapshot carries', async () => {
    // The snapshot is the only thing a proposal could reach a screen through,
    // and `controller.test.ts` §"no model text renders" holds what is in it.
    const view = await render({ workout: waiting({ waiting: undefined }) });
    expect(view.container.textContent).not.toContain('because');
  });
});
