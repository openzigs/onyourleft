// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The calorie-inputs panel (#2432) on the Settings screen, over the real
 * store: a choice saved and the screen reloaded shows what a fresh connection
 * reads back, *Not set* clears, a bad year is refused and writes nothing, and
 * the panel says what it cannot keep.
 */

import { unixSeconds } from '@onyourleft/domain';
import type { AthleteRecord } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  indexedDbStoreFactory,
  seedAthletes,
  type PersistentStore,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { chooseOption, mount, settle, submitForm, typeInto, type Mounted } from '../testing/mount';
import { SettingsView } from '../views/SettingsView';
import { birthYearRefusal } from './calorie-inputs';
import type { CalorieInputsPort } from './calorie-inputs-port';
import {
  CALORIE_INPUTS_LEAD,
  CALORIE_INPUTS_NO_ATHLETE,
  CALORIE_INPUTS_NO_STORE,
  CALORIE_INPUTS_NOT_READ,
  CALORIE_INPUTS_SAVED,
  CALORIE_INPUTS_SET,
  CALORIE_INPUTS_UNSET,
  calorieInputsSaveFailure,
} from './CalorieInputsPanel';

const THIS_YEAR = new Date().getFullYear();

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

/** The Settings screen, in the `main` the shell renders it in, with this panel's port. */
async function openSettings(port: CalorieInputsPort | undefined): Promise<void> {
  mounted = await mount(
    <main>
      <h1>Settings</h1>
      <SettingsView
        units="metric"
        onUnitsChange={() => undefined}
        onRiderMassChange={() => undefined}
        calorieInputs={port}
      />
    </main>,
  );
  await settle();
  await settle();
}

/** Unmount and mount again over a new connection — what a reload is. */
async function reload(): Promise<void> {
  mounted?.unmount();
  writer.close();
  writer = indexedDbStoreFactory.open(harness.databaseName);
  await openSettings({ store: writer, athleteId: ATHLETE_A });
}

function panel(): HTMLElement {
  const found = document.querySelector<HTMLElement>('.oyl-calorie-inputs');
  if (found === null) throw new Error('no calorie-inputs panel');
  return found;
}

function controls() {
  const root = panel();
  const sex = root.querySelector('select');
  const year = root.querySelector<HTMLInputElement>('input');
  const form = root.querySelector('form');
  if (sex === null || year === null || form === null) throw new Error('no form');
  return { sex, year, form };
}

async function enter(sex: string, year: string): Promise<void> {
  const { sex: select, year: input, form } = controls();
  await chooseOption(select, sex);
  await typeInto(input, year);
  await submitForm(form);
  await settle();
}

function said(): string {
  return panel().textContent;
}

describe('the calorie-inputs panel on Settings (#2432)', () => {
  it('saves Female and 1985, and after a reload the screen shows Female and 1985', async () => {
    await openSettings({ store: writer, athleteId: ATHLETE_A });
    expect(controls().sex.value).toBe('');
    expect(said()).toContain(CALORIE_INPUTS_UNSET);

    await enter('female', '1985');
    expect(said()).toContain(CALORIE_INPUTS_SAVED);

    const onDisk = await harness.read(async (fresh) => fresh.getAthlete(ATHLETE_A));
    expect(onDisk?.calorieSex).toBe('female');
    expect(onDisk?.birthYear).toBe(1985);

    await reload();
    const { sex, year } = controls();
    expect(sex.value).toBe('female');
    expect(sex.selectedOptions[0]?.textContent).toBe('Female');
    expect(year.value).toBe('1985');
    expect(said()).toContain(CALORIE_INPUTS_SET);
  });

  it('Not set and a blank year remove the stored values, and the screen says no figure is shown', async () => {
    await writer.setAthleteCalorieInputs(ATHLETE_A, { calorieSex: 'male', birthYear: 1990 });
    await openSettings({ store: writer, athleteId: ATHLETE_A });
    expect(said()).toContain(CALORIE_INPUTS_SET);

    await enter('', '');
    const onDisk = await harness.read(async (fresh) => fresh.getAthlete(ATHLETE_A));
    expect(onDisk?.calorieSex).toBeUndefined();
    expect(onDisk?.birthYear).toBeUndefined();
    expect(said()).toContain(CALORIE_INPUTS_UNSET);
    expect(said()).not.toContain(CALORIE_INPUTS_SET);

    await reload();
    expect(controls().sex.value).toBe('');
    expect(controls().year.value).toBe('');
  });

  it.each([
    ['a year after this one', String(THIS_YEAR + 1)],
    ['a non-number', 'nineteen eighty'],
  ])('refuses %s with the field and the constraint, and writes nothing', async (_, typed) => {
    await openSettings({ store: writer, athleteId: ATHLETE_A });
    await enter('female', typed);
    expect(said()).toContain(birthYearRefusal(THIS_YEAR));
    expect(said()).toContain('Year of birth');
    const onDisk = await harness.read(async (fresh) => fresh.getAthlete(ATHLETE_A));
    expect(onDisk?.calorieSex).toBeUndefined();
    expect(onDisk?.birthYear).toBeUndefined();
  });

  it('labels both controls visibly, keeps its lead on the screen, and passes the audit', async () => {
    await openSettings({ store: writer, athleteId: ATHLETE_A });
    const { sex, year } = controls();
    expect(document.querySelector(`label[for="${sex.id}"]`)?.textContent).toBe('Sex');
    expect(document.querySelector(`label[for="${year.id}"]`)?.textContent).toBe('Year of birth');
    expect(said()).toContain(CALORIE_INPUTS_LEAD);
    expect([...sex.options].map((option) => option.textContent)).toStrictEqual([
      'Not set',
      'Female',
      'Male',
    ]);
    const violations = auditAccessibility(document);
    expect(formatViolations(violations)).toBe(formatViolations([]));
  });

  it('offers no control without a store, and says why', async () => {
    await openSettings(undefined);
    expect(said()).toContain(CALORIE_INPUTS_NO_STORE);
    expect(panel().querySelector('form')).toBeNull();
  });

  it('says the inputs could not be read rather than showing them unset', async () => {
    await openSettings({
      athleteId: ATHLETE_A,
      store: {
        getAthlete: async () => Promise.reject(new Error('blocked')),
        setAthleteCalorieInputs: async () => Promise.resolve(undefined),
      },
    });
    expect(said()).toContain(CALORIE_INPUTS_NOT_READ);
    expect(said()).not.toContain(CALORIE_INPUTS_UNSET);
  });

  it('does not claim a save the store did not make', async () => {
    const row: AthleteRecord = { id: ATHLETE_A, displayName: 'You', createdAt: unixSeconds(1) };
    await openSettings({
      athleteId: ATHLETE_A,
      store: {
        getAthlete: async () => Promise.resolve(row),
        setAthleteCalorieInputs: async () => Promise.resolve(undefined),
      },
    });
    await enter('male', '1990');
    expect(said()).toContain(calorieInputsSaveFailure(CALORIE_INPUTS_NO_ATHLETE));
    expect(said()).not.toContain(CALORIE_INPUTS_SAVED);
  });
});
