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
import { liveRegionsSaying, timesSaid } from '../testing/said-once';
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

/**
 * `selected` is the id in `#/workouts/selected/<id>` — #670. A saved workout's
 * own facts and controls are drawn once it is chosen, in the detail pane.
 */
async function render(
  stub: WorkoutStub | undefined,
  now = 1_700_000_500,
  selected?: string,
): Promise<Mounted> {
  const view = await mount(<WorkoutsView port={stub} now={() => now} selected={selected} />);
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
      selected="workout-1"
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
    const view = await render(workoutStub(ATHLETE, [workout()]), undefined, 'workout-1');
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
    const view = await render(workoutStub(ATHLETE, [workout()]), undefined, 'workout-1');
    await activateWithKeyboard(buttonSaying(view.container, 'Delete Sweet spot') as HTMLElement);
    expect(document.body.textContent).toContain('Delete “Sweet spot”?');
  });

  it('puts the safe answer first, filled and focused, and the delete as danger (#1002)', async () => {
    const view = await render(workoutStub(ATHLETE, [workout()]), undefined, 'workout-1');
    await activateWithKeyboard(buttonSaying(view.container, 'Delete Sweet spot') as HTMLElement);
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    const keep = buttonSaying(document.body, 'Keep it') as HTMLElement;
    const remove = buttonSaying(document.body, 'Delete “Sweet spot”') as HTMLElement;
    expect(document.activeElement).toBe(keep);
    expect(keep.className).toBe('oyl-button');
    expect(remove.className).toContain('oyl-button--danger');
  });

  it('keeps it when the rider says so', async () => {
    const stub = workoutStub(ATHLETE, [workout()]);
    const view = await render(stub, undefined, 'workout-1');
    await activateWithKeyboard(buttonSaying(view.container, 'Delete Sweet spot') as HTMLElement);
    await activateWithKeyboard(buttonSaying(document.body, 'Keep it') as HTMLElement);
    await settle();
    expect(stub.rows()).toHaveLength(1);
  });

  it('deletes it on the second press, and the row goes', async () => {
    const stub = workoutStub(ATHLETE, [workout()]);
    const view = await render(stub, undefined, 'workout-1');
    await activateWithKeyboard(buttonSaying(view.container, 'Delete Sweet spot') as HTMLElement);
    await activateWithKeyboard(buttonSaying(document.body, 'Delete “Sweet spot”') as HTMLElement);
    await settle();
    expect(stub.rows()).toEqual([]);
    // What the shell does when the delete moves the hash back to the list:
    // the builder is drawn again, and the sentence with it.
    await view.rerender(<WorkoutsView port={stub} now={() => 1_700_000_500} />);
    await settle();
    expect(view.container.textContent).toContain('Deleted “Sweet spot”');
  });
});

describe('#1043 — the block chart', () => {
  const chart = (root: ParentNode): Element | null => root.querySelector('[data-oyl-block-chart]');
  const bandsDrawn = (root: ParentNode): string[] =>
    queryAll<SVGPathElement>(root, '[data-oyl-block-chart] path')
      .map((path) => path.getAttribute('class') ?? '')
      .filter((name) => name.includes('__band-'))
      .sort();

  async function addSteady(view: Mounted, minutes: string, percent: string): Promise<void> {
    await typeInto(field(view.container, 'block-minutes'), minutes);
    await typeInto(field(view.container, 'block-percent'), percent);
    await activateWithKeyboard(buttonSaying(view.container, 'Add block') as HTMLElement);
  }

  it('follows the builder as blocks are added and removed', async () => {
    const view = await render(workoutStub(ATHLETE));
    expect(chart(view.container)).toBeNull();

    await addSteady(view, '10', '65');
    expect(bandsDrawn(view.container)).toEqual(['oyl-block-chart__band-endurance']);

    await addSteady(view, '3', '110');
    expect(bandsDrawn(view.container)).toEqual([
      'oyl-block-chart__band-endurance',
      'oyl-block-chart__band-vo2',
    ]);

    await activateWithKeyboard(buttonSaying(view.container, 'Remove block 1') as HTMLElement);
    expect(bandsDrawn(view.container)).toEqual(['oyl-block-chart__band-vo2']);

    await activateWithKeyboard(buttonSaying(view.container, 'Remove block 1') as HTMLElement);
    expect(chart(view.container)).toBeNull();
  });

  it('draws the builder’s chart below Save workout, so it pushes the primary down by nothing — #1050', async () => {
    const view = await render(workoutStub(ATHLETE));
    await addSteady(view, '10', '65');
    const drawn = chart(view.container);
    const save = buttonSaying(view.container, 'Save workout');
    expect(drawn).not.toBeNull();
    expect(save).toBeDefined();
    expect(
      (save as HTMLElement).compareDocumentPosition(drawn as Element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('draws a saved workout below its own controls, hidden from assistive technology', async () => {
    const view = await render(workoutStub(ATHLETE, [workout()]), undefined, 'workout-1');
    const drawn = chart(view.container);
    expect(drawn).not.toBeNull();
    expect(drawn?.getAttribute('aria-hidden')).toBe('true');
    expect(drawn?.textContent).toBe('');
    expect(bandsDrawn(view.container)).toEqual(['oyl-block-chart__band-endurance']);
    // The words it repeats are on the page beside it.
    expect(view.container.textContent).toContain('10 min at 60%');
    const remove = buttonSaying(view.container, 'Delete Sweet spot');
    expect(remove).toBeDefined();
    expect(
      (remove as HTMLElement).compareDocumentPosition(drawn as Element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('what this screen does not claim', () => {
  it('quotes no watts and no load anywhere', async () => {
    // ⚠️ Every such number is a function of the rider's threshold, and this
    // screen deliberately holds none. A workout is threshold-independent, which
    // is the whole reason a target is a share.
    const view = await render(workoutStub(ATHLETE, [workout()]), undefined, 'workout-1');
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
    const view = await render(workoutStub(ATHLETE, [workout()]), undefined, 'workout-1');
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

describe('#670 — a selected workout', () => {
  it('is read on its own when the list did not hold it, rather than called "not found"', async () => {
    // The list is bounded (WORKOUT_LIST_LIMIT); a reload or a shared link can
    // name one past it. A stub whose list leaves it out stands for that.
    const stub = workoutStub(ATHLETE, [workout()]);
    const asked: string[] = [];
    const port: WorkoutStub = {
      ...stub,
      store: {
        ...stub.store,
        listWorkouts: () => Promise.resolve([]),
        getWorkout: (owner, id) => {
          asked.push(id);
          return stub.store.getWorkout(owner, id);
        },
      },
    };
    const view = await render(port, undefined, 'workout-1');
    await settle();
    expect(asked).toEqual(['workout-1']);
    expect(view.container.querySelector('#oyl-selected-heading')?.textContent).toBe('Sweet spot');
  });

  it('says a workout this device does not hold is not found', async () => {
    const view = await render(workoutStub(ATHLETE, [workout()]), undefined, 'nobody-knows');
    await settle();
    expect(view.container.querySelector('#oyl-selected-heading')?.textContent).toBe(
      'Workout not found',
    );
    // #670's review (N1): the builder is not drawn under a chosen workout;
    // the list's *Build a workout* is the way back to it, and the primary.
    expect(view.container.querySelector('#workout-name')).toBeNull();
    const build = view.container.querySelector('[data-oyl-pane="list"] a[data-oyl-create]');
    expect(build?.textContent).toBe('Build a workout');
    expect(build?.getAttribute('href')).toBe('#/workouts');
    expect(build?.className).toBe('oyl-button');
  });

  it('says another athlete’s workout is not found, even though this device holds it', async () => {
    // #670's review (N3): the id is on the device, under somebody else.
    const stub = workoutStub(ATHLETE, [workout({ createdBy: toAthleteId('athlete-b') })]);
    const view = await render(stub, undefined, 'workout-1');
    await settle();
    expect(view.container.querySelector('#oyl-selected-heading')?.textContent).toBe(
      'Workout not found',
    );
    expect(view.container.textContent).not.toContain('Sweet spot');
  });

  it('with nothing chosen, draws the builder, and the list’s way to it is secondary', async () => {
    const view = await render(workoutStub(ATHLETE, [workout()]));
    expect(view.container.querySelector('#workout-name')).not.toBeNull();
    const build = view.container.querySelector('[data-oyl-pane="list"] a[data-oyl-create]');
    expect(build?.className).toBe('oyl-button oyl-button--secondary');
  });

  it('keeps the name typed into the builder across choosing a workout and coming back', async () => {
    // #670's second review: choosing a workout unmounts the builder, and the
    // name box was uncontrolled — the blocks came back and the name did not.
    const stub = workoutStub(ATHLETE, [workout()]);
    const view = await render(stub);
    await typeInto(field(view.container, 'block-minutes'), '10');
    await typeInto(field(view.container, 'block-percent'), '65');
    await activateWithKeyboard(buttonSaying(view.container, 'Add block') as HTMLElement);
    await typeInto(field(view.container, 'workout-name'), 'Tempo');
    await view.rerender(
      <WorkoutsView port={stub} now={() => 1_700_000_500} selected="workout-1" />,
    );
    await settle();
    expect(view.container.querySelector('#workout-name')).toBeNull();
    await view.rerender(<WorkoutsView port={stub} now={() => 1_700_000_500} />);
    await settle();
    expect(field(view.container, 'workout-name').value).toBe('Tempo');
    await activateWithKeyboard(buttonSaying(view.container, 'Save workout') as HTMLElement);
    await settle();
    expect(stub.rows().map((row) => row.name)).toContain('Tempo');
  });

  it('does not bring back what the builder last said after a workout is chosen', async () => {
    // #670's second review: the builder's messages outlived a visit to a
    // chosen workout and came back in a re-mounted live region.
    const stub = workoutStub(ATHLETE, [workout()]);
    const view = await render(stub);
    await typeInto(field(view.container, 'block-minutes'), '10');
    await typeInto(field(view.container, 'block-percent'), '65');
    await activateWithKeyboard(buttonSaying(view.container, 'Add block') as HTMLElement);
    await typeInto(field(view.container, 'workout-name'), 'Tempo');
    await activateWithKeyboard(buttonSaying(view.container, 'Save workout') as HTMLElement);
    await settle();
    await submitForm(formOf(field(view.container, 'workout-file')));
    expect(view.container.textContent).toContain('Saved “Tempo”.');
    expect(view.container.textContent).toContain('Choose a workout file to import.');
    await view.rerender(
      <WorkoutsView port={stub} now={() => 1_700_000_500} selected="workout-1" />,
    );
    await settle();
    await view.rerender(<WorkoutsView port={stub} now={() => 1_700_000_500} />);
    await settle();
    expect(view.container.textContent).not.toContain('Saved “Tempo”.');
    expect(view.container.textContent).not.toContain('Choose a workout file to import.');
    expect(queryAll(view.container, '[role="status"], [aria-live]').length).toBe(0);
  });

  it('does not carry one workout’s confirmation or export note to the next one chosen — #723', async () => {
    // Two panes let a rider go straight from one list link to another, with no
    // stop at the list between. The "Delete …?" and "… is ready" belonged to
    // the first workout and were drawn on the second's page.
    const stub = workoutStub(ATHLETE, [
      workout(),
      workout({ id: workoutId('workout-2'), name: 'Threshold', createdAt: unixSeconds(1) }),
    ]);
    const files: DownloadableFile[] = [];
    const saveFile = (file: DownloadableFile): void => {
      files.push(file);
    };
    const view = await renderWithSave(stub, files);
    await activateWithKeyboard(buttonSaying(view.container, 'Export Sweet spot') as HTMLElement);
    await activateWithKeyboard(buttonSaying(view.container, 'Delete Sweet spot') as HTMLElement);
    expect(document.body.textContent).toContain('Delete “Sweet spot”?');
    expect(view.container.textContent).toContain('Sweet spot.oylworkout.json is ready');

    await view.rerender(
      <WorkoutsView port={stub} now={() => 1_700_000_500} selected="workout-2" save={saveFile} />,
    );
    await settle();
    expect(view.container.querySelector('#oyl-selected-heading')?.textContent).toBe('Threshold');
    expect(document.body.textContent).not.toContain('Delete “Sweet spot”?');
    expect(view.container.textContent).not.toContain('is ready');
    expect(buttonSaying(document.body, 'Delete “Sweet spot”')).toBeUndefined();

    // And coming back to the first does not bring them back either.
    await view.rerender(
      <WorkoutsView port={stub} now={() => 1_700_000_500} selected="workout-1" save={saveFile} />,
    );
    await settle();
    expect(document.body.textContent).not.toContain('Delete “Sweet spot”?');
    expect(view.container.textContent).not.toContain('is ready');
    expect(stub.rows()).toHaveLength(2);
  });

  it('empties the name box with the blocks once a workout is saved — #723', async () => {
    // Decided in #723: the builder is a fresh workout after a save. A name
    // left in the box would be inherited by the next workout built here.
    const stub = workoutStub(ATHLETE);
    const view = await render(stub);
    await typeInto(field(view.container, 'block-minutes'), '10');
    await typeInto(field(view.container, 'block-percent'), '65');
    await activateWithKeyboard(buttonSaying(view.container, 'Add block') as HTMLElement);
    await typeInto(field(view.container, 'workout-name'), 'Tempo');
    await activateWithKeyboard(buttonSaying(view.container, 'Save workout') as HTMLElement);
    await settle();
    expect(stub.rows().map((row) => row.name)).toEqual(['Tempo']);
    expect(field(view.container, 'workout-name').value).toBe('');
    expect(view.container.textContent).toContain('No blocks yet.');
    expect(view.container.textContent).toContain('Saved “Tempo”.');
  });

  it('keeps the name when a save is refused, so the rider can fix what was wrong — #723', async () => {
    const stub = workoutStub(ATHLETE);
    const view = await render(stub);
    await typeInto(field(view.container, 'workout-name'), 'Tempo');
    await activateWithKeyboard(buttonSaying(view.container, 'Save workout') as HTMLElement);
    await settle();
    expect(stub.rows()).toEqual([]);
    expect(field(view.container, 'workout-name').value).toBe('Tempo');
  });

  it('goes back to the list once the chosen workout is deleted', async () => {
    globalThis.location.hash = '#/workouts/selected/workout-1';
    const stub = workoutStub(ATHLETE, [workout()]);
    const view = await render(stub, undefined, 'workout-1');
    await activateWithKeyboard(buttonSaying(view.container, 'Delete Sweet spot') as HTMLElement);
    await activateWithKeyboard(buttonSaying(document.body, 'Delete “Sweet spot”') as HTMLElement);
    await settle();
    expect(globalThis.location.hash).toBe('#/workouts');
    globalThis.location.hash = '';
  });
});

/**
 * #670's review (B1): a message rendered twice is invisible to `toContain`;
 * these count what is said, and in how many live regions.
 */
describe('each message is said once, in one live region', () => {
  function saidOnce(root: Element, text: string): void {
    expect(timesSaid(root, text), `“${text}” is on the screen`).toBe(1);
    expect(liveRegionsSaying(root, text), `“${text}” is in live regions`).toBe(1);
  }

  it('after a delete', async () => {
    const stub = workoutStub(ATHLETE, [workout()]);
    const view = await render(stub, undefined, 'workout-1');
    await activateWithKeyboard(buttonSaying(view.container, 'Delete Sweet spot') as HTMLElement);
    await activateWithKeyboard(buttonSaying(document.body, 'Delete “Sweet spot”') as HTMLElement);
    await settle();
    await view.rerender(<WorkoutsView port={stub} now={() => 1_700_000_500} />);
    await settle();
    saidOnce(view.container, 'Deleted “Sweet spot”.');
  });

  it('after a refused import', async () => {
    const view = await render(workoutStub(ATHLETE));
    await submitForm(formOf(field(view.container, 'workout-file')));
    saidOnce(view.container, 'Choose a workout file to import.');
  });

  it('after a save', async () => {
    const view = await render(workoutStub(ATHLETE));
    await typeInto(field(view.container, 'block-minutes'), '10');
    await typeInto(field(view.container, 'block-percent'), '65');
    await activateWithKeyboard(buttonSaying(view.container, 'Add block') as HTMLElement);
    await typeInto(field(view.container, 'workout-name'), 'Tempo');
    await activateWithKeyboard(buttonSaying(view.container, 'Save workout') as HTMLElement);
    await settle();
    saidOnce(view.container, 'Saved “Tempo”.');
  });

  it('after a refused save', async () => {
    const view = await render(workoutStub(ATHLETE));
    await typeInto(field(view.container, 'workout-name'), 'Empty');
    await activateWithKeyboard(buttonSaying(view.container, 'Save workout') as HTMLElement);
    await settle();
    const refusal = queryAll(view.container, '.oyl-status')
      .map((element) => element.textContent ?? '')
      .find((text) => text.includes('Add at least one block'));
    expect(refusal).toBeDefined();
    saidOnce(view.container, 'Add at least one block');
  });
});
