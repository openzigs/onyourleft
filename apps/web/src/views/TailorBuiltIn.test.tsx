// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Tailoring a built-in on the Workouts screen — #2305.
 *
 * Everything here is read from the DOM the rider sees: the preview's words,
 * the graph's drawn paths, a refusal beside its control. The workout each
 * choice should make is asked of `tailorWorkout` itself, so the screen is held
 * to the domain's answer rather than to a copy of it written here.
 */

import {
  BUILT_IN_WORKOUTS,
  tailorWorkout,
  watts,
  workoutShapeText,
  type WorkoutTemplate,
} from '@onyourleft/domain';
import { athleteId } from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import type { AnalysisPort, AnalysisStore } from '../analysis/store-port';
import { chooseOption, mount, queryAll, settle, typeInto, type Mounted } from '../testing/mount';
import { workoutStub, type WorkoutStub } from '../workouts/testing';
import { WorkoutsView } from './WorkoutsView';

const OWNER = athleteId('athlete-a');

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function template(id: string): WorkoutTemplate {
  const found = BUILT_IN_WORKOUTS.find((each) => each.id === id);
  if (found === undefined) throw new Error(`no built-in ${id}`);
  return found;
}

const SWEET_SPOT = template('sweet-spot-3x12');

/** An analysis port whose athlete has these thresholds, and nothing else. */
function thresholds(power?: number, heartRate?: number): AnalysisPort {
  const store = {
    getAthlete: () =>
      Promise.resolve({
        id: OWNER,
        ...(power === undefined ? {} : { thresholdPower: watts(power) }),
        ...(heartRate === undefined ? {} : { thresholdHeartRate: heartRate }),
      }),
  } as unknown as AnalysisStore;
  return { athleteId: OWNER, store };
}

async function open(
  id: string,
  options: { readonly analysis?: AnalysisPort; readonly stub?: WorkoutStub } = {},
): Promise<Mounted> {
  mounted = await mount(
    <WorkoutsView
      port={options.stub ?? workoutStub(OWNER)}
      selected={`built-in:${id}`}
      analysis={options.analysis}
      now={() => 1_800_000_000}
    />,
  );
  await settle();
  return mounted;
}

function pane(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[data-oyl-built-in-detail]');
  if (found === null) throw new Error('no tailor pane');
  return found;
}

function preview(): HTMLElement {
  const found = pane().querySelector<HTMLElement>('[data-oyl-tailor-preview]');
  if (found === null) throw new Error('no preview');
  return found;
}

/** The preview's facts, by their term: what the rider reads. */
function fact(term: string): string {
  const entry = queryAll(preview(), 'dt').find((each) => each.textContent === term);
  return entry?.nextElementSibling?.textContent ?? '';
}

/** The graph's drawn paths, as drawn. */
function graph(): string[] {
  return queryAll<SVGPathElement>(preview(), 'svg path').map(
    (path) => path.getAttribute('d') ?? '',
  );
}

function control<T extends HTMLElement>(name: string, selector: string): T {
  const found = pane().querySelector<T>(`[data-oyl-tailor="${name}"] ${selector}`);
  if (found === null) throw new Error(`no ${name} control`);
  return found;
}

/** What is said beside a control, live. */
function saidBeside(name: string): string {
  return control(name, '[role="status"]').textContent ?? '';
}

function hasRefusal(name: string): boolean {
  return pane().querySelector(`[data-oyl-tailor="${name}"] [role="status"]`) !== null;
}

function buttonSaying(text: string): HTMLButtonElement {
  const found = queryAll<HTMLButtonElement>(pane(), 'button').find(
    (each) => each.textContent === text,
  );
  if (found === undefined) throw new Error(`no button ${text}`);
  return found;
}

describe('the preview follows every choice — #2305', () => {
  it('changes the rendered graph and words when the length goes from 60 to 45 minutes', async () => {
    await open('sweet-spot-3x12');
    await chooseOption(control<HTMLSelectElement>('length', 'select'), '60');
    const sixty = { shape: fact('Shape'), length: fact('Length'), graph: graph() };
    expect(sixty.shape).toBe(workoutShapeText(tailorWorkout(SWEET_SPOT, { targetMinutes: 60 })));

    await chooseOption(control<HTMLSelectElement>('length', 'select'), '45');
    const fortyFive = { shape: fact('Shape'), length: fact('Length'), graph: graph() };
    expect(fortyFive.shape).toBe(
      workoutShapeText(tailorWorkout(SWEET_SPOT, { targetMinutes: 45 })),
    );
    expect(fortyFive.shape).not.toBe(sixty.shape);
    expect(fortyFive.length).toBe('47 min');
    expect(sixty.length).toBe('1 h 3 min');
    expect(fortyFive.graph).not.toEqual(sixty.graph);
    expect(fortyFive.graph.length).toBeGreaterThan(0);
  });

  it('scales the main set with the intensity, and leaves the warm-up as written', async () => {
    await open('sweet-spot-3x12');
    await typeInto(control<HTMLInputElement>('intensity', 'input'), '-5');
    expect(fact('Shape')).toBe(
      workoutShapeText(tailorWorkout(SWEET_SPOT, { intensityPercent: -5 })),
    );
    expect(fact('Shape')).toContain('10 min ramping 45% to 70%');
    expect(fact('Shape')).toContain('3 × 12 min at 86%');
  });

  it('sets the repeats and the recovery where the template offers them', async () => {
    await open('sweet-spot-3x12');
    await typeInto(control<HTMLInputElement>('repeats', 'input'), '5');
    await typeInto(control<HTMLInputElement>('recovery', 'input'), '180');
    expect(fact('Shape')).toContain('5 × 12 min at 90%, 3 min at 55%');
  });

  it('offers nothing to change on a test ridden as written', async () => {
    await open('ramp-test');
    expect(pane().querySelectorAll('select, input')).toHaveLength(0);
    expect(pane().textContent).toContain('This workout is ridden as written');
  });
});

describe('watts only from the rider’s own threshold — #2305', () => {
  it('reads a 0.90 block as 225 W with a threshold of 250 W, and names its zone', async () => {
    await open('sweet-spot-3x12', { analysis: thresholds(250) });
    const rows = queryAll(preview(), 'ol li').map((row) => row.textContent ?? '');
    expect(rows).toContain(
      '3 × 12 min at 90%, 4 min at 55% — 225 W, then 138 W, zone 3 Tempo, then zone 1 Recovery',
    );
    expect(preview().textContent).toContain('your threshold power of 250 W');
  });

  it('shows no watts anywhere in the pane without one, and says where to set it', async () => {
    await open('sweet-spot-3x12', { analysis: thresholds(undefined) });
    expect(pane().textContent).not.toMatch(/\d\s?W\b/);
    expect(pane().textContent).toContain('zone 3 Tempo');
    const link = queryAll<HTMLAnchorElement>(preview(), 'a').find(
      (each) => each.textContent === 'Analysis',
    );
    expect(link?.getAttribute('href')).toBe('#/analysis');
  });

  it('shows no watts with no analysis port at all', async () => {
    await open('sweet-spot-3x12');
    expect(pane().textContent).not.toMatch(/\d\s?W\b/);
  });

  it('shows a heart-rate hold’s range from the rider’s threshold heart rate, and that it needs a strap', async () => {
    await open('endurance-heart-rate', { analysis: thresholds(250, 170) });
    const rows = queryAll(preview(), 'ol li').map((row) => row.textContent ?? '');
    const hold = tailorWorkout(template('endurance-heart-rate'), { thresholdHeartRate: 170 })
      .blocks[1];
    if (hold?.kind !== 'heart-rate-hold') throw new Error('no hold tailored');
    expect(rows).toContain(
      `45 min holding ${String(hold.range.low)}–${String(hold.range.high)} bpm. Needs a heart-rate strap.`,
    );
  });
});

describe('a refusal is shown beside its control, and the preview keeps the last valid workout — #2305', () => {
  it('for a length the template cannot make', async () => {
    await open('sweet-spot-3x12');
    // 45 minutes, not the template as written: what stays must be the LAST valid workout.
    await chooseOption(control<HTMLSelectElement>('length', 'select'), '45');
    const valid = { shape: fact('Shape'), graph: graph() };
    expect(valid.shape).toBe(workoutShapeText(tailorWorkout(SWEET_SPOT, { targetMinutes: 45 })));
    await chooseOption(control<HTMLSelectElement>('length', 'select'), '30');
    expect(saidBeside('length')).toContain(
      '"Sweet spot, three by twelve" can be no shorter than 40 minutes; you asked for 30 minutes.',
    );
    expect(hasRefusal('intensity')).toBe(false);
    expect(fact('Shape')).toBe(valid.shape);
    expect(graph()).toEqual(valid.graph);
    // What the rider asked for is still what the control says.
    expect(control<HTMLSelectElement>('length', 'select').value).toBe('30');

    await chooseOption(control<HTMLSelectElement>('length', 'select'), '60');
    expect(hasRefusal('length')).toBe(false);
  });

  it('for an intensity outside the template’s range', async () => {
    await open('sweet-spot-3x12');
    const before = fact('Shape');
    await typeInto(control<HTMLInputElement>('intensity', 'input'), '20');
    expect(saidBeside('intensity')).toContain('can be set from −25% to +10%; you asked for +20%');
    expect(hasRefusal('length')).toBe(false);
    expect(fact('Shape')).toBe(before);
  });
});

describe('a refusal belongs beside the control that caused it, not the one touched last — #1165', () => {
  it('keeps a length refusal beside Length when the rider then types a valid intensity', async () => {
    await open('sweet-spot-3x12');
    await chooseOption(control<HTMLSelectElement>('length', 'select'), '30');
    await typeInto(control<HTMLInputElement>('intensity', 'input'), '-5');
    expect(saidBeside('length')).toContain('you asked for 30 minutes');
    expect(hasRefusal('intensity')).toBe(false);
  });

  it('keeps an intensity refusal beside Intensity when the rider then chooses a valid length', async () => {
    await open('sweet-spot-3x12');
    await typeInto(control<HTMLInputElement>('intensity', 'input'), '20');
    await chooseOption(control<HTMLSelectElement>('length', 'select'), '45');
    expect(saidBeside('intensity')).toContain('you asked for +20%');
    expect(hasRefusal('length')).toBe(false);
  });
});

describe('Save a copy — #2305', () => {
  it('adds the tailored workout to the rider’s own list, and opening it shows its blocks', async () => {
    const stub = workoutStub(OWNER);
    await open('sweet-spot-3x12', { stub });
    await chooseOption(control<HTMLSelectElement>('length', 'select'), '45');
    await typeInto(control<HTMLInputElement>('intensity', 'input'), '-5');
    buttonSaying('Save a copy').click();
    await settle();

    const expected = tailorWorkout(SWEET_SPOT, { targetMinutes: 45, intensityPercent: -5 });
    const [saved] = stub.rows();
    expect(saved?.name).toBe('Sweet spot, three by twelve (47 min, −5%)');
    expect(saved?.workout.blocks).toStrictEqual(expected.blocks);
    expect(saved?.createdBy).toBe(OWNER);
    expect(pane().textContent).toContain(
      'Saved “Sweet spot, three by twelve (47 min, −5%)” to your workouts.',
    );
    // "Open it" is that saved workout's own address.
    const link = queryAll<HTMLAnchorElement>(pane(), 'a').find(
      (each) => each.textContent === 'Open it',
    );
    const selected = decodeURIComponent(
      (link?.getAttribute('href') ?? '').replace('#/workouts/selected/', ''),
    );
    expect(selected).toBe(saved?.id);

    // Listed under the rider's own workouts, read back from the store by a
    // screen opened afresh on their list…
    mounted?.unmount();
    mounted = await mount(<WorkoutsView port={stub} />);
    await settle();
    expect(document.querySelector('[data-oyl-list="saved"]')?.textContent).toContain(
      'Sweet spot, three by twelve (47 min, −5%)',
    );
    // …and opening it shows its blocks.
    mounted.unmount();
    mounted = await mount(<WorkoutsView port={stub} selected={selected} />);
    await settle();
    expect(document.querySelector('.oyl-selected')?.textContent).toContain(
      workoutShapeText(expected),
    );
  });

  it('takes the Saved line down when a choice changes after it', async () => {
    await open('sweet-spot-3x12');
    buttonSaying('Save a copy').click();
    await settle();
    expect(pane().textContent).toContain('to your workouts.');
    await typeInto(control<HTMLInputElement>('intensity', 'input'), '-5');
    expect(pane().textContent).not.toContain('to your workouts.');
  });

  it('says so when the copy cannot be saved, and shows no Saved line', async () => {
    const stub = workoutStub(OWNER);
    const failing: WorkoutStub = {
      ...stub,
      store: {
        ...stub.store,
        putWorkout: () => Promise.reject(new Error('the local store is unavailable')),
      },
    };
    await open('sweet-spot-3x12', { stub: failing });
    buttonSaying('Save a copy').click();
    await settle();
    expect(pane().textContent).toContain('The copy could not be saved.');
    expect(pane().textContent).not.toContain('to your workouts.');
    expect(stub.rows()).toHaveLength(0);
  });

  it('writes one copy for two quick presses', async () => {
    const stub = workoutStub(OWNER);
    await open('sweet-spot-3x12', { stub });
    buttonSaying('Save a copy').click();
    buttonSaying('Save a copy').click();
    await settle();
    expect(stub.rows()).toHaveLength(1);
  });

  it('starts another built-in from its own defaults', async () => {
    const stub = workoutStub(OWNER);
    mounted = await mount(<WorkoutsView port={stub} selected="built-in:sweet-spot-3x12" />);
    await settle();
    await typeInto(control<HTMLInputElement>('intensity', 'input'), '-5');
    await mounted.rerender(<WorkoutsView port={stub} selected="built-in:sweet-spot-4x10" />);
    await settle();
    expect(control<HTMLInputElement>('intensity', 'input').value).toBe('0');
    expect(fact('Shape')).toBe(workoutShapeText(tailorWorkout(template('sweet-spot-4x10'), {})));
  });
});
