// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The workouts screen (#14) — the library and the builder.
 *
 * What is asserted here rather than in `build.ts` and `library.ts` is what a
 * *rider* is told and what gets written: the two pure modules decide, and this
 * file proves the screen reports the decision rather than something adjacent
 * to it.
 *
 * The claim running through it, and it is `RoutesView.test.tsx`'s: **the screen
 * reports what was written, never what was asked for.** A screen that showed a
 * target it did not store is one where a rider rides a different session from
 * the one on the page — and here the difference reaches a trainer.
 */

import { athleteId as toAthleteId, workoutId, type WorkoutRecord } from '@onyourleft/store';
import { seconds, thresholdShare, unixSeconds, type WorkoutBlock } from '@onyourleft/domain';
import { afterEach, describe, expect, it } from 'vitest';

import {
  activateWithKeyboard,
  chooseOption,
  mount,
  queryAll,
  settle,
  submitForm,
  typeInto,
  type Mounted,
} from '../testing/mount';
import type { DownloadableFile } from '../transfer/store-port';
import { WORKOUT_LIST_LIMIT } from '../workouts/store-port';
import { workoutStub, type WorkoutStub } from '../workouts/testing';
import { WorkoutsView } from './WorkoutsView';

const ATHLETE = toAthleteId('athlete-a');

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function workout(overrides: Partial<WorkoutRecord> = {}): WorkoutRecord {
  const blocks: readonly WorkoutBlock[] = [
    { kind: 'steady', seconds: seconds(600), target: thresholdShare(0.6) },
  ];
  return {
    id: workoutId('workout-1'),
    createdBy: ATHLETE,
    name: 'Sweet spot',
    workout: { name: 'Sweet spot', blocks },
    createdAt: unixSeconds(1_700_000_000),
    updatedAt: unixSeconds(1_700_000_000),
    ...overrides,
  };
}

async function render(stub: WorkoutStub | undefined, now = 1_700_000_500): Promise<Mounted> {
  const view = await mount(<WorkoutsView port={stub} now={() => now} />);
  await settle();
  mounted = view;
  return view;
}

async function renderWithSave(
  stub: WorkoutStub,
  saved: DownloadableFile[],
  now = 1_700_000_500,
): Promise<Mounted> {
  const view = await mount(
    <WorkoutsView
      port={stub}
      now={() => now}
      save={(file) => {
        saved.push(file);
      }}
    />,
  );
  await settle();
  mounted = view;
  return view;
}

/**
 * The form a field belongs to.
 *
 * ⚠️ `closest('form')` rather than `form:has(#id)` — jsdom's selector engine
 * does not implement `:has()`, and it returns `null` for it rather than
 * throwing, so the version using it failed at `dispatchEvent` with a message
 * about `null` and said nothing about selectors.
 */
function formOf(input: HTMLElement): HTMLFormElement {
  const form = input.closest('form');
  if (form === null) throw new Error('that field is not in a form');
  return form;
}

function buttonSaying(root: ParentNode, text: string): HTMLElement | undefined {
  return queryAll<HTMLButtonElement>(root, 'button').find((button) =>
    (button.textContent ?? '').includes(text),
  );
}

function field(root: ParentNode, id: string): HTMLInputElement {
  const input = root.querySelector<HTMLInputElement>(`#${id}`);
  if (input === null) throw new Error(`no field ${id} on this screen`);
  return input;
}

describe('the library', () => {
  it('lists a saved workout by name, length and shape', async () => {
    const view = await render(workoutStub(ATHLETE, [workout()]));
    const text = view.container.textContent ?? '';
    expect(text).toContain('Sweet spot');
    expect(text).toContain('10 min');
    expect(text).toContain('10 min at 60%');
  });

  it('states its own read budget rather than reading everything', async () => {
    // ⚠️ An unbounded read on a growing library is a screen that gets slower
    // every month until somebody notices.
    const stub = workoutStub(ATHLETE, [workout()]);
    await render(stub);
    expect(stub.lastLimit()).toBe(WORKOUT_LIST_LIMIT);
  });

  it('says so when there is nothing saved', async () => {
    const view = await render(workoutStub(ATHLETE));
    expect(view.container.textContent).toContain('No workouts saved on this device yet');
  });

  it('still renders when the local store throws', async () => {
    // There is no network to be offline from: a store that throws is what that
    // failure looks like on this device, and the screen says so rather than
    // rendering nothing.
    const stub = workoutStub(ATHLETE, [workout()]);
    stub.failNextList();
    const view = await render(stub);
    expect(view.container.textContent).toContain('not a connection problem');
  });

  it('says what a browser with no local store can and cannot do', async () => {
    const view = await render(undefined);
    expect(view.container.textContent).toContain('Nothing has been lost');
  });
});

describe('building a workout', () => {
  it('writes the target a rider typed as a share of threshold, not as the number', async () => {
    // ⚠️ The assertion this screen exists for. `65` on the form is `0.65` in
    // the record, and the same digits stored unconverted would ask a trainer
    // for sixty-five times the rider's threshold.
    const stub = workoutStub(ATHLETE);
    const view = await render(stub);

    await typeInto(field(view.container, 'block-minutes'), '10');
    await typeInto(field(view.container, 'block-percent'), '65');
    await activateWithKeyboard(buttonSaying(view.container, 'Add block') as HTMLElement);
    await typeInto(field(view.container, 'workout-name'), 'Tempo');
    await activateWithKeyboard(buttonSaying(view.container, 'Save workout') as HTMLElement);
    await settle();

    const saved = stub.rows()[0];
    expect(saved?.name).toBe('Tempo');
    expect(saved?.workout.blocks).toEqual([{ kind: 'steady', seconds: 600, target: 0.65 }]);
  });

  it('shows a block in the workout before it is saved', async () => {
    const view = await render(workoutStub(ATHLETE));
    await typeInto(field(view.container, 'block-minutes'), '10');
    await typeInto(field(view.container, 'block-percent'), '65');
    await activateWithKeyboard(buttonSaying(view.container, 'Add block') as HTMLElement);
    expect(view.container.textContent).toContain('10 min at 65%');
  });

  it('offers the interval fields only for an intervals block', async () => {
    const view = await render(workoutStub(ATHLETE));
    expect(view.container.querySelector('#block-repeats')).toBeNull();

    const kind = view.container.querySelector<HTMLSelectElement>('#block-kind');
    if (kind === null) throw new Error('no kind picker');
    await chooseOption(kind, 'intervals');
    expect(view.container.querySelector('#block-repeats')).not.toBeNull();
    expect(view.container.querySelector('#block-easy-percent')).not.toBeNull();
  });

  it('hides the target field for a free ride, because there is no target', async () => {
    // ⚠️ A free ride releases the trainer. A form that asked for a target here
    // would be asking a rider to describe the one instruction the player is
    // careful never to send.
    const view = await render(workoutStub(ATHLETE));
    const kind = view.container.querySelector<HTMLSelectElement>('#block-kind');
    if (kind === null) throw new Error('no kind picker');
    await chooseOption(kind, 'free-ride');
    expect(view.container.querySelector('#block-percent')).toBeNull();
  });

  it('shows a refusal and writes nothing', async () => {
    const stub = workoutStub(ATHLETE);
    const view = await render(stub);
    await typeInto(field(view.container, 'block-minutes'), '10');
    await typeInto(field(view.container, 'block-percent'), '900');
    await activateWithKeyboard(buttonSaying(view.container, 'Add block') as HTMLElement);

    expect(view.container.textContent).toContain('20% to 300%');
    expect(view.container.textContent).not.toContain('10 min at 900%');
    expect(stub.rows()).toEqual([]);
  });

  it('refuses to save a workout with no blocks', async () => {
    const stub = workoutStub(ATHLETE);
    const view = await render(stub);
    await typeInto(field(view.container, 'workout-name'), 'Empty');
    await activateWithKeyboard(buttonSaying(view.container, 'Save workout') as HTMLElement);
    await settle();

    expect(view.container.textContent).toContain('Add at least one block');
    expect(stub.rows()).toEqual([]);
  });

  it('refuses to save a workout with no name', async () => {
    const stub = workoutStub(ATHLETE);
    const view = await render(stub);
    await typeInto(field(view.container, 'block-minutes'), '10');
    await typeInto(field(view.container, 'block-percent'), '65');
    await activateWithKeyboard(buttonSaying(view.container, 'Add block') as HTMLElement);
    await activateWithKeyboard(buttonSaying(view.container, 'Save workout') as HTMLElement);
    await settle();

    expect(view.container.textContent).toContain('Give this workout a name');
    expect(stub.rows()).toEqual([]);
  });

  it('lets a block be removed before the workout is saved', async () => {
    const view = await render(workoutStub(ATHLETE));
    await typeInto(field(view.container, 'block-minutes'), '10');
    await typeInto(field(view.container, 'block-percent'), '65');
    await activateWithKeyboard(buttonSaying(view.container, 'Add block') as HTMLElement);
    await activateWithKeyboard(buttonSaying(view.container, 'Remove block 1') as HTMLElement);
    expect(view.container.textContent).toContain('No blocks yet');
  });

  it('keeps the kind after adding a block, and clears everything else', async () => {
    // A rider adding six intervals blocks should not re-pick "Intervals" six
    // times, and a rider who wanted a different kind is one click from it.
    const view = await render(workoutStub(ATHLETE));
    const kind = view.container.querySelector<HTMLSelectElement>('#block-kind');
    if (kind === null) throw new Error('no kind picker');
    await chooseOption(kind, 'free-ride');
    await typeInto(field(view.container, 'block-minutes'), '7');
    await activateWithKeyboard(buttonSaying(view.container, 'Add block') as HTMLElement);

    expect(view.container.querySelector<HTMLSelectElement>('#block-kind')?.value).toBe('free-ride');
    expect(field(view.container, 'block-minutes').value).toBe('');
  });
});

describe('deleting a workout asks first', () => {
  it('names the workout in the confirmation', async () => {
    const view = await render(workoutStub(ATHLETE, [workout()]));
    await activateWithKeyboard(buttonSaying(view.container, 'Delete Sweet spot') as HTMLElement);
    expect(view.container.textContent).toContain('Delete “Sweet spot”?');
  });

  it('keeps it when the rider says so', async () => {
    const stub = workoutStub(ATHLETE, [workout()]);
    const view = await render(stub);
    await activateWithKeyboard(buttonSaying(view.container, 'Delete Sweet spot') as HTMLElement);
    await activateWithKeyboard(buttonSaying(view.container, 'Keep it') as HTMLElement);
    await settle();
    expect(stub.rows()).toHaveLength(1);
  });

  it('deletes it on the second press, and the row goes', async () => {
    const stub = workoutStub(ATHLETE, [workout()]);
    const view = await render(stub);
    await activateWithKeyboard(buttonSaying(view.container, 'Delete Sweet spot') as HTMLElement);
    await activateWithKeyboard(buttonSaying(view.container, 'Delete “Sweet spot”') as HTMLElement);
    await settle();

    expect(stub.rows()).toEqual([]);
    expect(view.container.textContent).toContain('Deleted “Sweet spot”');
  });
});

describe('what this screen does not claim', () => {
  it('quotes no watts and no load anywhere', async () => {
    // ⚠️ Every such number is a function of the rider's threshold, and this
    // screen deliberately holds none. A workout is threshold-independent, which
    // is the whole reason a target is a share.
    const view = await render(workoutStub(ATHLETE, [workout()]));
    const text = view.container.textContent ?? '';
    expect(text).not.toMatch(/\d\s?W\b/);
    expect(text.toLowerCase()).not.toContain('stress');
  });
});

describe('a workout can leave as a file and come back — #202, ADR 0017', () => {
  it('hands the browser a file named after the workout', async () => {
    const saved: DownloadableFile[] = [];
    const view = await renderWithSave(workoutStub(ATHLETE, [workout()]), saved);
    const button = buttonSaying(view.container, 'Export Sweet spot');
    expect(button).toBeDefined();
    await activateWithKeyboard(button!);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.fileName).toBe('Sweet spot.oylworkout.json');
  });

  it('does not offer an export this build cannot perform', async () => {
    // Offered and inert is worse than absent: a rider presses it, nothing
    // happens, and there is nothing on the screen that says why.
    const view = await render(workoutStub(ATHLETE, [workout()]));
    expect(buttonSaying(view.container, 'Export Sweet spot')).toBeUndefined();
    expect(buttonSaying(view.container, 'Delete Sweet spot')).toBeDefined();
  });

  it('asks for a file rather than doing nothing when none was chosen', async () => {
    const stub = workoutStub(ATHLETE);
    const view = await render(stub);
    await submitForm(formOf(field(view.container, 'workout-file')));
    expect(view.container.textContent ?? '').toContain('Choose a workout file');
  });
});
