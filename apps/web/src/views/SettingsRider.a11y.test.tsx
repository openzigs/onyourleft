// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Settings with a rider-body port — #2839: the two named options are native
 * radios with names, and the screen passes the accessibility audit before and
 * after a save. Since the owner's ruling of 2026-11-20 it is the ONE Female /
 * Male control on the screen (the calorie estimate's sex is this choice), and a
 * rider who never chose sees no option selected and is told what that means. `SettingsKit.a11y.test.tsx`'s
 * shape, for the control beside it; without a port the route's own audit
 * (`routes.a11y.test.tsx`) renders the "no local store" explanation instead.
 */

import { athleteId as toAthleteId, RIDER_BODIES, type AthleteRecord } from '@onyourleft/store';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { AthleteRiderBodyPort } from '../athlete/rider-body-port';
import { accessibleName, auditAccessibility, formatViolations } from '../a11y/audit';
import { RIDER_BODY_NAMES } from '../game/rider-body';
import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import type { CalorieInputsPort } from '../athlete/calorie-inputs-port';
import {
  KIT_NO_ATHLETE,
  RIDER_BODY_IS_ONE_CHOICE,
  RIDER_BODY_NOT_CHOSEN,
  RIDER_BODY_SAVED,
  riderBodySaveFailure,
} from './SettingsView';

const OWNER = toAthleteId('athlete-a');
const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

function riderPort(
  write: AthleteRiderBodyPort['store']['setAthleteRider'] = (id, rider) =>
    Promise.resolve({
      id,
      displayName: 'You',
      createdAt: 0 as AthleteRecord['createdAt'],
      riderBody: rider,
      calorieSex: rider,
    }),
): AthleteRiderBodyPort {
  return { athleteId: OWNER, store: { setAthleteRider: write } };
}

/** A calorie panel with a row to read, so its form is drawn beside the rider choice. */
const CALORIE_INPUTS: CalorieInputsPort = {
  athleteId: OWNER,
  store: {
    getAthlete: (id) =>
      Promise.resolve({ id, displayName: 'You', createdAt: 0 as AthleteRecord['createdAt'] }),
    setAthleteBirthYear: () => Promise.resolve(undefined),
  },
};

function riderRadios(): HTMLInputElement[] {
  return queryAll<HTMLInputElement>(document.body, 'input[type="radio"][name="oyl-rider-body"]');
}

function expectClean(where: string): void {
  const violations = auditAccessibility(document);
  expect(violations.length === 0 ? '' : `${where}\n${formatViolations(violations)}`).toBe('');
}

async function choose(value: string): Promise<void> {
  await act(async () => {
    riderRadios()
      .find((radio) => radio.value === value)
      ?.click();
    await Promise.resolve();
  });
  await settle();
}

describe('Settings with a rider-body port — #2839', () => {
  it('renders the two named options in a named group, and passes the audit before and after a save', async () => {
    globalThis.location.hash = '#/settings';
    mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} athleteRider={riderPort()} />);
    await settle();

    const radios = riderRadios();
    expect(radios.map((radio) => radio.value)).toEqual([...RIDER_BODIES]);
    for (const radio of radios) {
      expect(accessibleName(radio)).toContain(
        RIDER_BODY_NAMES[radio.value as (typeof RIDER_BODIES)[number]],
      );
    }
    // The group is named by its question. A rider who never chose has nothing
    // selected, and is told they are drawn as the male rider meanwhile.
    expect(radios[0]?.closest('fieldset')?.querySelector('legend')?.textContent).toBe(
      'Are you a female or a male rider?',
    );
    expect(radios.find((radio) => radio.checked)).toBeUndefined();
    expect(document.body.textContent).toContain(RIDER_BODY_NOT_CHOSEN);
    expectClean('Settings, with a rider-body port');

    await choose('female');
    expect(document.body.textContent).toContain(RIDER_BODY_SAVED);
    expect(riderRadios().find((radio) => radio.checked)?.value).toBe('female');
    expect(document.body.textContent).not.toContain(RIDER_BODY_NOT_CHOSEN);
    expectClean('Settings, with a rider-body port, after a save');
  });

  it('shows a stored choice as selected', async () => {
    globalThis.location.hash = '#/settings';
    mounted = await mount(
      <AppShell capabilities={NO_BLUETOOTH} athleteRider={riderPort()} riderBody="male" />,
    );
    await settle();

    expect(riderRadios().find((radio) => radio.checked)?.value).toBe('male');
    expect(document.body.textContent).not.toContain(RIDER_BODY_NOT_CHOSEN);
  });

  it('is the only Female / Male control on Settings, and says on the screen it is both (2026-11-20)', async () => {
    globalThis.location.hash = '#/settings';
    mounted = await mount(
      <AppShell
        capabilities={NO_BLUETOOTH}
        athleteRider={riderPort()}
        calorieInputs={CALORIE_INPUTS}
      />,
    );
    await settle();
    await settle();

    // The calorie panel's form is drawn, so a second sex control would be here.
    expect(document.querySelector('.oyl-calorie-inputs form')).not.toBeNull();
    const offersFemale = queryAll(
      document.body,
      'input[value="female"], option[value="female"], input[value="Female"], option[value="Female"]',
    );
    expect(offersFemale).toHaveLength(1);
    expect(offersFemale[0]?.getAttribute('name')).toBe('oyl-rider-body');
    // Kept visible rather than behind the ⓘ: it is about a health input.
    expect(document.body.textContent).toContain(RIDER_BODY_IS_ONE_CHOICE);
    expectClean('Settings, with the rider choice and the calorie panel');
  });

  it('says so, and keeps the rider they had, when the row is not there to write to', async () => {
    globalThis.location.hash = '#/settings';
    mounted = await mount(
      <AppShell
        capabilities={NO_BLUETOOTH}
        athleteRider={riderPort(() => Promise.resolve(undefined))}
      />,
    );
    await settle();

    await choose('female');
    expect(document.body.textContent).not.toContain(RIDER_BODY_SAVED);
    // The reason it gives is that there is no row — not whatever reading a
    // missing row's field would have thrown.
    expect(document.body.textContent).toContain(riderBodySaveFailure(KIT_NO_ATHLETE));
    // Nothing landed, so nothing is shown as chosen that is not on disk.
    expect(riderRadios().find((radio) => radio.checked)).toBeUndefined();
    expectClean('Settings, after a rider-body write that landed nowhere');
  });

  it('names the failure when the write throws', async () => {
    globalThis.location.hash = '#/settings';
    mounted = await mount(
      <AppShell
        capabilities={NO_BLUETOOTH}
        athleteRider={riderPort(() => Promise.reject(new Error('quota exceeded')))}
      />,
    );
    await settle();

    await choose('female');
    expect(document.body.textContent).toContain(riderBodySaveFailure('quota exceeded'));
    expect(riderRadios().find((radio) => radio.checked)).toBeUndefined();
  });
});
