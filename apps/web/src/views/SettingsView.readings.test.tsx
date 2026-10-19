// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #1433 on Settings: a rider ranks the Ride screen's readings and turns them
 * on and off, once, and the RIDE SCREEN — mounted afterwards, reading this
 * device's storage the way it does on a ride — draws what was chosen. The
 * panel's own state is never the assertion.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { RIDE_READINGS_STORAGE_KEY } from '../ride/reading-choice';
import { ridingSnapshot, stubRideController } from '../ride/testing';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';

import { RideView } from './RideView';
import { ANNOUNCEMENTS_NOT_KEPT, RIDE_READINGS_ONE_STAYS, SettingsView } from './SettingsView';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  localStorage.removeItem(RIDE_READINGS_STORAGE_KEY);
});

async function settings(store: Pick<Storage, 'getItem' | 'setItem'> = localStorage): Promise<void> {
  mounted?.unmount();
  mounted = await mount(
    <SettingsView
      units="metric"
      onUnitsChange={() => undefined}
      onRiderMassChange={() => undefined}
      announcements={store}
    />,
  );
  await settle();
}

/** The Ride screen as a rider next opens it, and the readings it draws. */
async function rideScreenCards(): Promise<string[]> {
  mounted?.unmount();
  mounted = await mount(<RideView controller={stubRideController(ridingSnapshot()).controller} />);
  await settle();
  return queryAll(document, '.oyl-metric-grid > .oyl-metric').map(
    (card) => card.querySelector('.oyl-metric__label')?.textContent ?? '',
  );
}

function rows(): string[] {
  return queryAll(document, '.oyl-ride-readings__row').map((row) => {
    const box = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
    return `${box?.checked === true ? '[x]' : '[ ]'} ${row.querySelector('label')?.textContent?.trim() ?? ''}`;
  });
}

function button(name: string): HTMLButtonElement {
  const found = queryAll<HTMLButtonElement>(document, '.oyl-ride-readings button').find(
    (each) => each.textContent?.replace(/\s+/g, ' ').trim() === name,
  );
  if (found === undefined) throw new Error(`no button named "${name}"`);
  return found;
}

function checkbox(label: string): HTMLInputElement {
  const row = queryAll(document, '.oyl-ride-readings__row').find(
    (each) => each.querySelector('label')?.textContent?.trim() === label,
  );
  const box = row?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (box === null || box === undefined) throw new Error(`no checkbox for "${label}"`);
  return box;
}

describe('Ride screen readings, on Settings', () => {
  it('lists the four in the Ride screen’s order, every one shown', async () => {
    await settings();
    expect(rows()).toEqual(['[x] Power', '[x] Cadence', '[x] Heart rate', '[x] Speed']);
  });

  it('moves a reading, keeps focus on the button pressed, and the Ride screen draws the new order', async () => {
    await settings();
    const down = button('Move Power Down');
    await activateWithKeyboard(down);
    expect(rows()).toEqual(['[x] Cadence', '[x] Power', '[x] Heart rate', '[x] Speed']);
    expect(document.activeElement?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Move Power Down',
    );
    expect(document.body.textContent).toContain('Power is now 2 of 4.');

    await activateWithKeyboard(button('Move Speed Up'));
    expect(rows()).toEqual(['[x] Cadence', '[x] Power', '[x] Speed', '[x] Heart rate']);

    expect(await rideScreenCards()).toEqual(['Cadence', 'Power', 'Speed', 'Heart rate']);
  });

  it('says the ends cannot move, and moves nothing when pressed', async () => {
    await settings();
    const up = button('Move Power Up');
    expect(up.getAttribute('aria-disabled')).toBe('true');
    expect(button('Move Speed Down').getAttribute('aria-disabled')).toBe('true');
    expect(button('Move Cadence Up').getAttribute('aria-disabled')).toBeNull();
    await activateWithKeyboard(up);
    expect(rows()[0]).toBe('[x] Power');
    expect(localStorage.getItem(RIDE_READINGS_STORAGE_KEY)).toBeNull();
  });

  it('hides a reading from the Ride screen, and keeps the last one shown', async () => {
    await settings();
    for (const label of ['Power', 'Cadence', 'Heart rate']) {
      await activateWithKeyboard(checkbox(label));
    }
    expect(rows()).toEqual(['[ ] Power', '[ ] Cadence', '[ ] Heart rate', '[x] Speed']);

    await activateWithKeyboard(checkbox('Speed'));
    expect(checkbox('Speed').checked).toBe(true);
    expect(document.body.textContent).toContain(RIDE_READINGS_ONE_STAYS);

    expect(await rideScreenCards()).toEqual(['Speed']);
  });

  it('says so when this device will not keep the choice', async () => {
    const refusing = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    await settings(refusing);
    await activateWithKeyboard(button('Move Power Down'));
    expect(document.body.textContent).toContain(ANNOUNCEMENTS_NOT_KEPT);
  });
});
