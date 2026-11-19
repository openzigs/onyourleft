// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Settings with a rider-body port — #2839: the two named options are native
 * radios with names, the default is shown as chosen, and the screen passes the
 * accessibility audit before and after a save. `SettingsKit.a11y.test.tsx`'s
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
import {
  KIT_NO_ATHLETE,
  RIDER_BODY_IS_A_LOOK,
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
  write: AthleteRiderBodyPort['store']['setAthleteRiderBody'] = (id, riderBody) =>
    Promise.resolve({
      id,
      displayName: 'You',
      createdAt: 0 as AthleteRecord['createdAt'],
      riderBody,
    }),
): AthleteRiderBodyPort {
  return { athleteId: OWNER, store: { setAthleteRiderBody: write } };
}

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
    // The group is named by its question, and the default is what is shown chosen.
    expect(radios[0]?.closest('fieldset')?.querySelector('legend')?.textContent).toBe(
      'Which rider are you in the trainer game?',
    );
    expect(radios.find((radio) => radio.checked)?.value).toBe('male');
    expectClean('Settings, with a rider-body port');

    await choose('female');
    expect(document.body.textContent).toContain(RIDER_BODY_SAVED);
    expect(riderRadios().find((radio) => radio.checked)?.value).toBe('female');
    expectClean('Settings, with a rider-body port, after a save');
  });

  it('says in its help that this is a look and not the calorie estimate’s sex', async () => {
    globalThis.location.hash = '#/settings';
    mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} athleteRider={riderPort()} />);
    await settle();

    expect(document.body.textContent).toContain(RIDER_BODY_IS_A_LOOK);
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
    expect(riderRadios().find((radio) => radio.checked)?.value).toBe('male');
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
    expect(riderRadios().find((radio) => radio.checked)?.value).toBe('male');
  });
});
