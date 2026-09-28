// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Settings screen WITH a kit port — #623, and the owner's ruling of
 * 2026-09-28.
 *
 * `routes.a11y.test.tsx` and the rest of the route walk render Settings with
 * no kit port, where the kit control is absent and `KIT_NO_STORE` stands in
 * its place. So the "Your kit" radio group — the one five-option column of
 * #667's radio rows on this screen — is audited nowhere in the walk. This file
 * is that audit: the real shell, at the real route, handed a port, before and
 * after a save. A screen audited only in its no-store state has not been
 * audited.
 */

import { athleteId as toAthleteId, KIT_COLOURS, type AthleteRecord } from '@onyourleft/store';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { AthleteKitColourPort } from '../athlete/kit-colour-port';
import { accessibleName, auditAccessibility, formatViolations } from '../a11y/audit';
import { KIT_PALETTE } from '../game/bicycle';
import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import { KIT_SAVED } from './SettingsView';

const OWNER = toAthleteId('athlete-a');
const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

function kitPort(): AthleteKitColourPort {
  return {
    athleteId: OWNER,
    store: {
      setAthleteKitColour: (id, kitColour): Promise<AthleteRecord | undefined> =>
        Promise.resolve({
          id,
          displayName: 'You',
          createdAt: 0 as AthleteRecord['createdAt'],
          kitColour,
        }),
    },
  };
}

function kitRadios(): HTMLInputElement[] {
  return queryAll<HTMLInputElement>(document.body, 'input[type="radio"][name="oyl-kit"]');
}

function expectClean(where: string): void {
  const violations = auditAccessibility(document);
  expect(violations.length === 0 ? '' : `${where}\n${formatViolations(violations)}`).toBe('');
}

describe('Settings with a kit port — #623', () => {
  it('renders the five named options, and the screen passes the audit before and after a save', async () => {
    globalThis.location.hash = '#/settings';
    mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} athleteKit={kitPort()} />);
    await settle();

    // Not vacuous: the group is on the screen, every option named by its NAME.
    const radios = kitRadios();
    expect(radios.map((radio) => radio.value)).toEqual([...KIT_COLOURS]);
    for (const radio of radios) {
      expect(accessibleName(radio)).toContain(
        KIT_PALETTE[radio.value as (typeof KIT_COLOURS)[number]].name,
      );
    }
    expectClean('Settings, with a kit port');

    await act(async () => {
      radios.find((radio) => radio.value === 'lime')?.click();
      await Promise.resolve();
    });
    await settle();
    expect(document.body.textContent).toContain(KIT_SAVED);
    expectClean('Settings, with a kit port, after a save');
  });
});
