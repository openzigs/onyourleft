// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The workout goals screen (#1237), over the REAL store: what renders comes
 * from a store read — when it opens, and after a save, what the store wrote —
 * a refusal names its box, and Clear removes the row.
 */

import { beatsPerMinute, thresholdShare, unixSeconds } from '@onyourleft/domain';
import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  indexedDbStoreFactory,
  seedAthletes,
  type PersistentStore,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import {
  activateWithKeyboard,
  chooseOption,
  mount,
  settle,
  submitForm,
  typeInto,
  type Mounted,
} from '../testing/mount';
import { WorkoutGoalsPanel } from './WorkoutGoalsPanel';
import type { WorkoutGoalsPort } from './workout-goals-port';
import {
  CLEAR_GOALS,
  FIELD_WORDS,
  GOALS_CLEARED,
  GOALS_NO_STORE,
  GOALS_NOT_READ,
  GOALS_SAVED,
  POWER_CEILING_CONSTRAINT,
  WORKOUT_GOALS_SYNC_TEXT,
  fieldRefusal,
} from './wording';

let harness: StoreHarness;
let writer: PersistentStore;
let mounted: Mounted | undefined;

beforeEach(async () => {
  harness = createStoreHarness();
  await seedAthletes(harness);
  writer = indexedDbStoreFactory.open(harness.databaseName);
});

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  writer.close();
  await harness.destroy();
});

function portOver(store: PersistentStore, athleteId = ATHLETE_A): WorkoutGoalsPort {
  return { store, athleteId, now: () => unixSeconds(1_790_000_000) };
}

async function open(port: WorkoutGoalsPort | undefined): Promise<void> {
  mounted?.unmount();
  document.documentElement.lang = 'en';
  mounted = await mount(
    <main>
      <h1>Settings</h1>
      <h2>Your workout goals</h2>
      <WorkoutGoalsPanel port={port} />
    </main>,
  );
  await settle();
  await settle();
}

function field(label: string): HTMLInputElement & HTMLSelectElement {
  const found = [...document.querySelectorAll('label')].find(
    (each) => each.textContent?.trim() === label,
  );
  const control =
    found?.htmlFor === undefined || found.htmlFor === ''
      ? found?.querySelector('input')
      : document.getElementById(found.htmlFor);
  if (control === null || control === undefined) throw new Error(`no box labelled ${label}`);
  return control as HTMLInputElement & HTMLSelectElement;
}

async function save(): Promise<void> {
  const form = document.querySelector('form');
  if (form === null) throw new Error('no form');
  await submitForm(form);
  await settle();
  await settle();
}

function status(): string {
  return [...document.querySelectorAll('[role="status"], [role="alert"]')]
    .map((each) => each.textContent)
    .join(' ');
}

function expectClean(where: string): void {
  const violations = auditAccessibility(document);
  expect(violations.length === 0 ? '' : `${where}\n${formatViolations(violations)}`).toBe('');
}

const freshRead = () => harness.read((fresh) => fresh.getWorkoutGoals(ATHLETE_A));

describe('the workout goals screen (#1237)', () => {
  it('saves what a fresh connection reads back, and a reopened screen shows it from a fresh read', async () => {
    await open(portOver(writer));
    expectClean('an empty goals form');
    await chooseOption(field(FIELD_WORDS.sessionType.label), 'endurance');
    await typeInto(field(FIELD_WORDS.durationMinutes.label), '90');
    await typeInto(field(FIELD_WORDS.holdLow.label), '128');
    await typeInto(field(FIELD_WORDS.holdHigh.label), '138');
    await typeInto(field(FIELD_WORDS.heartRateAbove.label), '150');
    await typeInto(field(FIELD_WORDS.powerCeiling.label), '75');
    await save();
    expect(status()).toContain(GOALS_SAVED);
    expect(await freshRead()).toStrictEqual({
      status: 'kept',
      record: {
        athleteId: ATHLETE_A,
        goals: {
          sessionType: 'endurance',
          durationMinutes: 90,
          holdRange: { low: beatsPerMinute(128), high: beatsPerMinute(138) },
          heartRateAbove: beatsPerMinute(150),
          powerCeiling: thresholdShare(0.75),
        },
        savedAt: unixSeconds(1_790_000_000),
      },
    });
    expectClean('a saved goals form');

    // Reopened over a connection the save never touched: the boxes come from
    // the store, not from the component that typed them.
    writer.close();
    writer = indexedDbStoreFactory.open(harness.databaseName);
    await open(portOver(writer));
    expect(field(FIELD_WORDS.sessionType.label).value).toBe('endurance');
    expect(field(FIELD_WORDS.durationMinutes.label).value).toBe('90');
    expect(field(FIELD_WORDS.holdLow.label).value).toBe('128');
    expect(field(FIELD_WORDS.holdHigh.label).value).toBe('138');
    expect(field(FIELD_WORDS.heartRateAbove.label).value).toBe('150');
    expect(field(FIELD_WORDS.powerCeiling.label).value).toBe('75');
    expect(field(FIELD_WORDS.timeInRangeMinutes.label).value).toBe('');
  });

  it('shows the athlete’s own goals and never another’s', async () => {
    await writer.putWorkoutGoals({
      athleteId: ATHLETE_B,
      goals: { durationMinutes: 45 },
      savedAt: unixSeconds(1),
    });
    await open(portOver(writer));
    expect(field(FIELD_WORDS.durationMinutes.label).value).toBe('');
  });

  it('refuses a range under 6 bpm wide, naming the box, and writes nothing', async () => {
    await open(portOver(writer));
    await typeInto(field(FIELD_WORDS.holdLow.label), '130');
    await typeInto(field(FIELD_WORDS.holdHigh.label), '134');
    await save();
    const high = field(FIELD_WORDS.holdHigh.label);
    expect(status()).toContain(fieldRefusal('holdHigh', 'must be at least 6 bpm wide.'));
    expect(high.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(high);
    expect(await freshRead()).toStrictEqual({ status: 'none' });
    expectClean('a refused goals form');
  });

  it('refuses a ceiling over 85% in the percentage typed, and writes nothing', async () => {
    await open(portOver(writer));
    await typeInto(field(FIELD_WORDS.powerCeiling.label), '90');
    await save();
    expect(status()).toContain(fieldRefusal('powerCeiling', POWER_CEILING_CONSTRAINT));
    expect(field(FIELD_WORDS.powerCeiling.label).getAttribute('aria-invalid')).toBe('true');
    expect(await freshRead()).toStrictEqual({ status: 'none' });
  });

  it('clears the goals: the row is gone, and so are the boxes', async () => {
    await writer.putWorkoutGoals({
      athleteId: ATHLETE_A,
      goals: { durationMinutes: 45, effortCheckIns: true },
      savedAt: unixSeconds(1),
    });
    await open(portOver(writer));
    expect(field(FIELD_WORDS.effortCheckIns.label).checked).toBe(true);
    const clear = [...document.querySelectorAll('button')].find(
      (each) => each.textContent === CLEAR_GOALS,
    );
    if (clear === undefined) throw new Error('no Clear');
    await activateWithKeyboard(clear);
    await settle();
    await settle();
    expect(status()).toContain(GOALS_CLEARED);
    expect(field(FIELD_WORDS.durationMinutes.label).value).toBe('');
    expect(await freshRead()).toStrictEqual({ status: 'none' });
  });

  it('treats Save on an all-blank form as clearing the goals: the row is gone', async () => {
    await writer.putWorkoutGoals({
      athleteId: ATHLETE_A,
      goals: { durationMinutes: 45, effortCheckIns: true },
      savedAt: unixSeconds(1),
    });
    await open(portOver(writer));
    await typeInto(field(FIELD_WORDS.durationMinutes.label), '');
    act(() => {
      field(FIELD_WORDS.effortCheckIns.label).click();
    });
    await save();
    expect(status()).toContain(GOALS_CLEARED);
    expect(await freshRead()).toStrictEqual({ status: 'none' });
  });

  it('says goals it cannot read are not in use, and saves new ones over them', async () => {
    await writer.putWorkoutGoals({
      athleteId: ATHLETE_A,
      goals: { durationMinutes: 45 },
      savedAt: unixSeconds(1),
    });
    // A row the store reads back as a fault: a hand edit, as the store sees it.
    let reads = 0;
    const store: WorkoutGoalsPort['store'] = {
      getWorkoutGoals: async (owner) =>
        (reads += 1) === 1
          ? { status: 'fault', fault: 'workoutGoals.powerCeiling: must be a share' }
          : writer.getWorkoutGoals(owner),
      putWorkoutGoals: async (record) => writer.putWorkoutGoals(record),
      deleteWorkoutGoals: async (owner) => writer.deleteWorkoutGoals(owner),
    };
    await open({ ...portOver(writer), store });
    expect(document.body.textContent).toContain(GOALS_NOT_READ);
    expect(field(FIELD_WORDS.powerCeiling.label).value).toBe('');
    await typeInto(field(FIELD_WORDS.durationMinutes.label), '60');
    await save();
    expect(await freshRead()).toMatchObject({
      status: 'kept',
      record: { goals: { durationMinutes: 60 } },
    });
    expect(document.body.textContent).not.toContain(GOALS_NOT_READ);
  });

  it('keeps the sync sentence visible, and says when there is no store', async () => {
    for (const port of [portOver(writer), undefined]) {
      await open(port);
      const kept = document.querySelector('[data-oyl-kept-visible]');
      expect(kept?.textContent).toContain(WORKOUT_GOALS_SYNC_TEXT);
    }
    expect(document.body.textContent).toContain(GOALS_NO_STORE);
    expect(document.querySelector('form')).toBeNull();
  });
});
