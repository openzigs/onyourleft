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

  it('says the trainer has not confirmed rather than quoting a number it has not', async () => {
    // ⚠️ `TrainerPanel.tsx`'s rule, applied here: the word "Holding" is the
    // guarantee, and it may not appear before the machine has answered.
    const view = await render({ workout: running({ holdingWatts: undefined }) });
    const text = view.container.textContent ?? '';
    expect(text).toContain('has not confirmed a target yet');
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
  const shown = (root: ParentNode): string => root.querySelector('section')?.textContent ?? '';

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
    // The floor's way back is two steps, and the way out is the panel's button.
    expect(text).toContain('steps up to a lighter target first');
    expect(text).toContain('Press End workout to leave it.');
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
