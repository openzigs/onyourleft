// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The calorie-inputs panel (#2432) on the Settings screen, over the real
 * store: a year saved and the screen reloaded shows what a fresh connection
 * reads back, blank clears it, a bad year is refused and writes nothing, and
 * the panel says what it cannot keep.
 *
 * Since the owner's ruling of 2026-11-20 the sex is not a control here: it is
 * the rider's one Female / Male choice under *Your rider*, which this panel
 * names (`calorieSexReading`) and never writes.
 */

import { kilograms, unixSeconds, type Kilograms } from '@onyourleft/domain';
import type { AthleteRecord, RiderBody } from '@onyourleft/store';
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
import { mount, settle, submitForm, typeInto, type Mounted } from '../testing/mount';
import { SettingsView } from '../views/SettingsView';
import { birthYearRefusal } from './calorie-inputs';
import type { CalorieInputsPort } from './calorie-inputs-port';
import {
  CALORIE_INPUTS_LEAD,
  CALORIE_INPUTS_NO_ATHLETE,
  CALORIE_INPUTS_NO_STORE,
  CALORIE_INPUTS_NO_WEIGHT,
  CALORIE_INPUTS_NOT_READ,
  CALORIE_INPUTS_SAVED,
  CALORIE_INPUTS_SET,
  CALORIE_INPUTS_UNSET,
  calorieInputsSaveFailure,
  calorieSexReading,
} from './CalorieInputsPanel';

const THIS_YEAR = new Date().getUTCFullYear();

/** A weight the rider entered, for the screens where one is. */
const ENTERED = kilograms(64.5);

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

/**
 * The Settings screen, in the `main` the shell renders it in, with this panel's
 * port, an entered weight — `null` for a rider who has entered none, since
 * `undefined` takes the default — and the rider choice the shell holds.
 */
async function openSettings(
  port: CalorieInputsPort | undefined,
  {
    riderMass = ENTERED,
    riderBody = 'female',
  }: { readonly riderMass?: Kilograms | null; readonly riderBody?: RiderBody | null } = {},
): Promise<void> {
  mounted = await mount(
    <main>
      <h1>Settings</h1>
      <SettingsView
        units="metric"
        onUnitsChange={() => undefined}
        onRiderMassChange={() => undefined}
        riderMass={riderMass ?? undefined}
        riderBody={riderBody ?? undefined}
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
  const year = root.querySelector<HTMLInputElement>('input');
  const form = root.querySelector('form');
  if (year === null || form === null) throw new Error('no form');
  return { year, form };
}

async function enter(year: string): Promise<void> {
  const { year: input, form } = controls();
  await typeInto(input, year);
  await submitForm(form);
  await settle();
}

function said(): string {
  return panel().textContent;
}

describe('the calorie-inputs panel on Settings (#2432)', () => {
  it('saves 1985, leaves the rider choice on disk, and after a reload shows 1985', async () => {
    await writer.setAthleteRider(ATHLETE_A, 'female');
    await openSettings({ store: writer, athleteId: ATHLETE_A });
    expect(controls().year.value).toBe('');
    expect(said()).toContain(CALORIE_INPUTS_UNSET);

    await enter('1985');
    expect(said()).toContain(CALORIE_INPUTS_SAVED);

    const onDisk = await harness.read(async (fresh) => fresh.getAthlete(ATHLETE_A));
    expect(onDisk?.birthYear).toBe(1985);
    expect(onDisk?.calorieSex).toBe('female');
    expect(onDisk?.riderBody).toBe('female');

    await reload();
    expect(controls().year.value).toBe('1985');
    expect(said()).toContain(CALORIE_INPUTS_SET);
  });

  it('a blank year removes the stored year and only the year, and the screen says no figure is shown', async () => {
    await writer.setAthleteRider(ATHLETE_A, 'male');
    await writer.setAthleteBirthYear(ATHLETE_A, 1990);
    await openSettings({ store: writer, athleteId: ATHLETE_A }, { riderBody: 'male' });
    expect(said()).toContain(CALORIE_INPUTS_SET);

    await enter('');
    const onDisk = await harness.read(async (fresh) => fresh.getAthlete(ATHLETE_A));
    expect(onDisk?.birthYear).toBeUndefined();
    expect(onDisk?.calorieSex).toBe('male');
    expect(said()).toContain(CALORIE_INPUTS_UNSET);
    expect(said()).not.toContain(CALORIE_INPUTS_SET);

    await reload();
    expect(controls().year.value).toBe('');
  });

  it('with sex and year but no weight entered, says a weight is needed and where, not that a ride gets a figure', async () => {
    await writer.setAthleteRider(ATHLETE_A, 'female');
    await writer.setAthleteBirthYear(ATHLETE_A, 1985);
    await openSettings({ store: writer, athleteId: ATHLETE_A }, { riderMass: null });
    expect(said()).toContain(CALORIE_INPUTS_NO_WEIGHT);
    expect(said()).toContain('Your weight');
    expect(said()).not.toContain(CALORIE_INPUTS_SET);
    expect(said()).not.toContain(CALORIE_INPUTS_UNSET);
  });

  it('names the rider choice as the sex it uses, and with none chosen says where to choose (2026-11-20)', async () => {
    await writer.setAthleteBirthYear(ATHLETE_A, 1985);
    await openSettings({ store: writer, athleteId: ATHLETE_A });
    expect(said()).toContain(calorieSexReading('female'));
    expect(calorieSexReading('female')).toBe(
      'Female, the rider you chose under Your rider, above.',
    );
    expect(panel().querySelector('dt')?.textContent).toBe('Sex');
    mounted?.unmount();

    await openSettings({ store: writer, athleteId: ATHLETE_A }, { riderBody: null });
    expect(said()).toContain(calorieSexReading(undefined));
    expect(calorieSexReading(undefined)).toBe(
      'Not set. Choose Female or Male under Your rider, above.',
    );
    // A year and a weight, and still no figure: the estimate has no sex.
    expect(said()).toContain(CALORIE_INPUTS_UNSET);
    expect(said()).not.toContain(CALORIE_INPUTS_SET);
  });

  it('shows what the store answered after a save, not what was typed', async () => {
    const row: AthleteRecord = { id: ATHLETE_A, displayName: 'You', createdAt: unixSeconds(1) };
    await openSettings({
      athleteId: ATHLETE_A,
      store: {
        getAthlete: async () => Promise.resolve(row),
        // Drops the year: the screen must show the year as unset.
        setAthleteBirthYear: async () => Promise.resolve(row),
      },
    });
    await enter('1985');
    expect(controls().year.value).toBe('');
    expect(said()).toContain(CALORIE_INPUTS_UNSET);
  });

  it.each([
    ['a year after this one', String(THIS_YEAR + 1)],
    ['a non-number', 'nineteen eighty'],
  ])('refuses %s with the field and the constraint, and writes nothing', async (_, typed) => {
    await openSettings({ store: writer, athleteId: ATHLETE_A });
    await enter(typed);
    expect(said()).toContain(birthYearRefusal(THIS_YEAR));
    expect(said()).toContain('Year of birth');
    const onDisk = await harness.read(async (fresh) => fresh.getAthlete(ATHLETE_A));
    expect(onDisk?.birthYear).toBeUndefined();
  });

  it('has no sex control of its own, labels the year visibly, keeps its lead on the screen, and passes the audit', async () => {
    await openSettings({ store: writer, athleteId: ATHLETE_A });
    const { year } = controls();
    expect(panel().querySelector('select')).toBeNull();
    expect(panel().querySelectorAll('input')).toHaveLength(1);
    expect(document.querySelector(`label[for="${year.id}"]`)?.textContent).toBe('Year of birth');
    expect(panel().querySelector('button')?.textContent).toBe('Save year of birth');
    expect(said()).toContain(CALORIE_INPUTS_LEAD);
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
        setAthleteBirthYear: async () => Promise.resolve(undefined),
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
        setAthleteBirthYear: async () => Promise.resolve(undefined),
      },
    });
    await enter('1990');
    expect(said()).toContain(calorieInputsSaveFailure(CALORIE_INPUTS_NO_ATHLETE));
    expect(said()).not.toContain(CALORIE_INPUTS_SAVED);
  });
});
