// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The ride screen's workout panel (#14).
 *
 * What is asserted here is what a rider is *told* and *offered*: the controller
 * tests prove the loop, and this proves the screen never offers a control that
 * would fail — which is #48's rule and, for a trainer, a safety one.
 */

import { seconds, thresholdShare, unixSeconds, watts, type WorkoutBlock } from '@onyourleft/domain';
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

const trainer = (overrides: Partial<TrainerSnapshot> = {}): TrainerSnapshot =>
  ({
    paired: true,
    controllable: true,
    canSetPower: true,
    canSimulate: false,
    powerRange: undefined,
    hasControl: true,
    target: { kind: 'none' },
    requested: undefined,
    lost: undefined,
    refusal: undefined,
    ...overrides,
  }) as TrainerSnapshot;

const running = (overrides: Partial<RideWorkoutSnapshot> = {}): RideWorkoutSnapshot => ({
  name: 'Sweet spot',
  status: 'running',
  elapsedSeconds: 120,
  totalSeconds: 600,
  holdingWatts: 150,
  nowRiding: '10 min at 60%',
  fault: undefined,
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
