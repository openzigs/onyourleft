// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **The end-to-end half of #238**: the choice a rider makes on one screen
 * changes what every other screen says, without a reload.
 *
 * The unit tests either side of this prove the pieces — `units/format.ts`
 * converts, `views/SettingsView.tsx` writes, `packages/store` persists. None of
 * them proves the wiring, and the wiring is where this issue's defect lived:
 * `format.ts`'s constants *did* have a single home and the game HUD still
 * carried its own literal, so the product was metric in two different ways and
 * the two could not be changed together.
 *
 * So this mounts the real shell, changes the setting through the real screen,
 * and reads two *other* screens back.
 */

import type { AthleteRecord } from '@onyourleft/store';
import { athleteId } from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import type { LibraryPort } from '../library/store-port';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import type { UnitsPort } from '../units/store-port';

import { AppShell } from './AppShell';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };
const OWNER = athleteId('local');

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

/** One stored ride: 42 195 m, which is 42.2 km and 26.2 mi. */
function library(): LibraryPort {
  return {
    athleteId: OWNER,
    store: {
      listActivitySummaries: () =>
        Promise.resolve([
          {
            id: 'ride-1',
            athleteId: OWNER,
            name: 'A marathon of a ride',
            startedAt: 1_700_000_000,
            startedAtTimeZone: 'Europe/London',
            elapsedTime: 3725,
            movingTime: 3600,
            distance: 42_195,
            visibility: 'private',
            hasPosition: false,
            createdAt: 1_700_000_000,
            updatedAt: 1_700_000_000,
          },
        ]),
      deleteActivity: () => Promise.resolve(true),
    } as unknown as LibraryPort['store'],
  };
}

function settings(written: string[]): UnitsPort {
  return {
    athleteId: OWNER,
    store: {
      // ⚠️ Answers with a **record**. `undefined` is this method's answer for
      // "there is no such athlete", i.e. nothing was written, and the screen
      // refuses to tell the shell on it — `views/SettingsView.tsx`
      // §`UNITS_NO_ATHLETE`. A fake returning `undefined` here would have made
      // this whole end-to-end case assert a path a rider never takes.
      setAthleteUnits: (id, units): Promise<AthleteRecord | undefined> => {
        written.push(units);
        return Promise.resolve({
          id,
          displayName: 'You',
          createdAt: 0 as AthleteRecord['createdAt'],
          units,
        });
      },
    },
  };
}

async function open(path: string, props: Parameters<typeof AppShell>[0]): Promise<void> {
  globalThis.location.hash = `#${path}`;
  mounted = await mount(<AppShell {...props} />);
  await settle();
}

/** The library table's distance heading, which carries the unit. */
function distanceHeading(): string {
  return (
    queryAll(document, 'th[scope="col"]').find((cell) =>
      (cell.textContent ?? '').startsWith('Distance'),
    )?.textContent ?? ''
  );
}

/**
 * The distance cell of the one row.
 *
 * Index 2 because the row is `th` (name), then started, duration, **distance**,
 * average power, actions — `ActivitiesView.tsx`'s column order. Named here so
 * a column inserted before it fails with a wrong number rather than silently
 * asserting a duration, which is what the first version of this helper did.
 */
function distanceCell(): string {
  return queryAll(document, 'tbody td')[2]?.textContent ?? '';
}

describe('the stored preference reaches the first paint', () => {
  it('renders the library in kilometres for a rider who has never chosen', async () => {
    await open('/activities', { capabilities: NO_BLUETOOTH, library: library() });

    expect(distanceHeading()).toBe('Distance (km)');
    expect(distanceCell()).toBe('42.2');
  });

  it('renders the same ride in miles when the athlete row says so', async () => {
    // ⚠️ Not after a reload and not after an effect: `main.tsx` reads the row
    // before it renders anything, so the first paint is already right. A
    // preference applied in a `useEffect` would flash kilometres.
    await open('/activities', {
      capabilities: NO_BLUETOOTH,
      library: library(),
      units: 'imperial',
    });

    expect(distanceHeading()).toBe('Distance (mi)');
    expect(distanceCell()).toBe('26.2');
  });
});

describe('changing the setting changes another screen, with no reload', () => {
  it('takes the library from kilometres to miles', async () => {
    const written: string[] = [];
    await open('/settings', {
      capabilities: NO_BLUETOOTH,
      library: library(),
      settings: settings(written),
    });

    queryAll<HTMLInputElement>(document, 'input[type="radio"]')
      .find((radio) => radio.value === 'imperial')
      ?.click();
    await settle();
    expect(written).toEqual(['imperial']);

    // Navigate to a completely different screen and read it back.
    globalThis.location.hash = '#/activities';
    await settle();

    expect(distanceHeading()).toBe('Distance (mi)');
    expect(distanceCell()).toBe('26.2');
  });

  it('takes it back again, so the choice is not one-way', async () => {
    const written: string[] = [];
    await open('/settings', {
      capabilities: NO_BLUETOOTH,
      library: library(),
      settings: settings(written),
      units: 'imperial',
    });

    queryAll<HTMLInputElement>(document, 'input[type="radio"]')
      .find((radio) => radio.value === 'metric')
      ?.click();
    await settle();

    globalThis.location.hash = '#/activities';
    await settle();

    expect(written).toEqual(['metric']);
    expect(distanceHeading()).toBe('Distance (km)');
  });
});
