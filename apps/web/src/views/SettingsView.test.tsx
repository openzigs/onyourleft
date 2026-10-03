// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The screen a rider chooses their units on (#238).
 *
 * The cases that matter are the two failure shapes, not the happy path:
 *
 * - **The choice is told to the store before it is told to the screen.** A view
 *   that switched to miles and then failed to persist would show a rider miles
 *   until they reloaded and kilometres afterwards, with nothing saying which is
 *   real.
 * - **The current choice is visible.** #238 is explicit that a default must not
 *   be a silent guess, so the selected radio *is* the setting rather than a
 *   separate label that could drift from it.
 */

import type { AthleteId, AthleteRecord, KitColour, UnitSystem } from '@onyourleft/store';
import { KIT_COLOURS } from '@onyourleft/store';
import { athleteId } from '@onyourleft/store';
import { act } from 'react';
import { describe, expect, it } from 'vitest';

import { kilograms, KILOGRAMS_PER_POUND } from '@onyourleft/domain';

import { DEFAULT_RIDER_MASS_KILOGRAMS, MASS_REFUSAL } from '../athlete/mass';
import type { AthleteMassPort } from '../athlete/store-port';
import { mount, queryAll, settle, typeInto } from '../testing/mount';
import type { UnitsPort } from '../units/store-port';

import {
  MASS_CLEARED,
  MASS_NO_ATHLETE,
  MASS_NO_STORE,
  MASS_SAVED,
  SettingsView,
  UNITS_NO_ATHLETE,
  UNITS_NO_STORE,
  UNITS_SAVED,
  ANNOUNCEMENTS_NOT_KEPT,
  ANNOUNCEMENTS_SAVED,
  APPEARANCE_STARTS_DARK,
  KIT_NO_ATHLETE,
  KIT_KEPT,
  KIT_NO_STORE,
  KIT_SAVED,
  APPEARANCE_STAYS_HERE,
  SETTINGS_CARD_TITLES,
} from './SettingsView';
import type { AthleteKitColourPort } from '../athlete/kit-colour-port';
import { KIT_PALETTE } from '../game/bicycle';
import {
  THEME_OVERRIDE_ATTRIBUTE,
  THEME_STORAGE_KEY,
  type ThemeStorage,
} from '../design/theme-selection';
import {
  readAnnouncementPreference,
  type PreferenceStorage,
} from '../game/hud/announce-preference';
import { DEFAULT_CUES, readCuePreference } from '../game/cue-preference';
import { readRealisticWorldChoice } from '../game/world-preference';
import { OSM_ATTRIBUTION, readBasemapConfig, type BasemapConfig } from '../map/basemap';
import { MAP_TILES_STORAGE_KEY, readMapTilesChoice } from '../map/tiles-preference';

const OWNER = athleteId('local');

interface Recorded {
  readonly port: UnitsPort;
  readonly writes: { id: AthleteId; units: UnitSystem }[];
}

function recordingPort(options: { readonly fail?: string } = {}): Recorded {
  const writes: { id: AthleteId; units: UnitSystem }[] = [];
  return {
    writes,
    port: {
      athleteId: OWNER,
      store: {
        setAthleteUnits: (id, units): Promise<AthleteRecord | undefined> => {
          if (options.fail !== undefined) {
            return Promise.reject(new Error(options.fail));
          }
          writes.push({ id, units });
          return Promise.resolve({
            id,
            displayName: 'You',
            createdAt: 0 as AthleteRecord['createdAt'],
            units,
          });
        },
      },
    },
  };
}

/**
 * The UNITS radios. ⚠️ Scoped by name since #623 put a second radio group — the
 * kit colour — on this screen; `kitRadios` below reads that one.
 */
function radios(container: HTMLElement): HTMLInputElement[] {
  return queryAll<HTMLInputElement>(container, 'input[type="radio"][name="oyl-units"]');
}

describe('SettingsView', () => {
  it('shows the current choice rather than implying it', async () => {
    const { port } = recordingPort();
    const mounted = await mount(
      <SettingsView
        port={port}
        units="metric"
        onUnitsChange={() => undefined}
        onRiderMassChange={() => undefined}
      />,
    );

    const chosen = radios(mounted.container).filter((radio) => radio.checked);
    expect(chosen).toHaveLength(1);
    expect(chosen[0]?.value).toBe('metric');
    mounted.unmount();
  });

  it('shows imperial as the current choice when that is what is stored', async () => {
    const { port } = recordingPort();
    const mounted = await mount(
      <SettingsView
        port={port}
        units="imperial"
        onUnitsChange={() => undefined}
        onRiderMassChange={() => undefined}
      />,
    );

    expect(radios(mounted.container).find((radio) => radio.checked)?.value).toBe('imperial');
    mounted.unmount();
  });

  it('names both units in words, so neither has to be guessed at', async () => {
    const { port } = recordingPort();
    const mounted = await mount(
      <SettingsView
        port={port}
        units="metric"
        onUnitsChange={() => undefined}
        onRiderMassChange={() => undefined}
      />,
    );

    const text = mounted.container.textContent ?? '';
    expect(text).toContain('Kilometres');
    expect(text).toContain('Miles');
    mounted.unmount();
  });

  it('draws the choice as a segmented control of native radios, with a visible legend (#668)', async () => {
    const { port } = recordingPort();
    const mounted = await mount(
      <SettingsView
        port={port}
        units="imperial"
        onUnitsChange={() => undefined}
        onRiderMassChange={() => undefined}
      />,
    );

    const group = mounted.container.querySelector('fieldset.oyl-segmented');
    expect(group, 'the units choice is not a segmented control').not.toBeNull();
    expect(group?.querySelector(':scope > legend')?.textContent).toBe(
      'Which units do you ride in?',
    );
    // Each segment is a label wrapping its own native radio, which is what the
    // stylesheet draws and what gives the 44 px row.
    const segments = [...(group?.querySelectorAll('.oyl-segmented__options > label') ?? [])];
    expect(segments.map((label) => label.textContent?.trim())).toEqual(['Kilometres', 'Miles']);
    for (const segment of segments) {
      expect(segment.querySelector(':scope > input[type="radio"]')).not.toBeNull();
    }
    // The chosen option's meaning is said, and the group points at it.
    const detail = document.getElementById(group?.getAttribute('aria-describedby') ?? '');
    expect(detail?.textContent).toBe('Distance in mi, speed in mph, climbing in ft.');
    mounted.unmount();
  });

  it('writes the choice to the store, scoped to the athlete', async () => {
    const { port, writes } = recordingPort();
    const mounted = await mount(
      <SettingsView
        port={port}
        units="metric"
        onUnitsChange={() => undefined}
        onRiderMassChange={() => undefined}
      />,
    );

    radios(mounted.container)
      .find((radio) => radio.value === 'imperial')
      ?.click();
    await settle();

    expect(writes).toEqual([{ id: OWNER, units: 'imperial' }]);
    mounted.unmount();
  });

  it('tells the shell only after the store has answered', async () => {
    // The ordering is the assertion. A view that called `onUnitsChange` first
    // would leave a rider looking at miles that were never written.
    const order: string[] = [];
    const port: UnitsPort = {
      athleteId: OWNER,
      store: {
        setAthleteUnits: async (id, units): Promise<AthleteRecord | undefined> => {
          await Promise.resolve();
          order.push('stored');
          // ⚠️ A **record**, not `undefined`. `undefined` is the store's answer
          // for "there is no such athlete", i.e. nothing was written, and the
          // case below is what asserts that. A fake returning it here would
          // have made this test assert an ordering that never happens.
          return { id, displayName: 'You', createdAt: 0 as AthleteRecord['createdAt'], units };
        },
      },
    };
    const mounted = await mount(
      <SettingsView
        port={port}
        units="metric"
        onUnitsChange={() => {
          order.push('told');
        }}
        onRiderMassChange={() => undefined}
      />,
    );

    radios(mounted.container)
      .find((radio) => radio.value === 'imperial')
      ?.click();
    await settle();

    expect(order).toEqual(['stored', 'told']);
    mounted.unmount();
  });

  it('does not tell the shell when the write failed, and says what went wrong', async () => {
    const { port } = recordingPort({ fail: 'site data is blocked' });
    let told = 0;
    const mounted = await mount(
      <SettingsView
        port={port}
        units="metric"
        onUnitsChange={() => {
          told += 1;
        }}
        onRiderMassChange={() => undefined}
      />,
    );

    radios(mounted.container)
      .find((radio) => radio.value === 'imperial')
      ?.click();
    await settle();

    expect(told).toBe(0);
    expect(mounted.container.textContent).toContain('site data is blocked');
    mounted.unmount();
  });

  it('does not tell the shell when the store wrote nothing, and says so', async () => {
    // ⚠️ The defect this case exists for: `setAthleteUnits` answers `undefined`
    // for "there is no such athlete" and does **not** throw, so a caller that
    // only catches sees a resolved promise. `main.tsx` builds the port
    // unconditionally while `renderAfterAthlete` swallows a failed
    // `ensureLocalAthlete`, so this is a start-up state a rider can reach: the
    // screen would flip every other screen to miles, say "Saved", and be back
    // in kilometres on the next reload.
    let told = 0;
    const port: UnitsPort = {
      athleteId: OWNER,
      store: { setAthleteUnits: () => Promise.resolve(undefined) },
    };
    const mounted = await mount(
      <SettingsView
        port={port}
        units="metric"
        onUnitsChange={() => {
          told += 1;
        }}
        onRiderMassChange={() => undefined}
      />,
    );

    radios(mounted.container)
      .find((radio) => radio.value === 'imperial')
      ?.click();
    await settle();

    expect(told).toBe(0);
    const text = mounted.container.textContent ?? '';
    expect(text).toContain(UNITS_NO_ATHLETE);
    expect(text).not.toContain(UNITS_SAVED);
    mounted.unmount();
  });

  it('confirms a save, so the rider knows it stuck', async () => {
    const { port } = recordingPort();
    const mounted = await mount(
      <SettingsView
        port={port}
        units="metric"
        onUnitsChange={() => undefined}
        onRiderMassChange={() => undefined}
      />,
    );

    radios(mounted.container)
      .find((radio) => radio.value === 'imperial')
      ?.click();
    await settle();

    expect(mounted.container.textContent).toContain(UNITS_SAVED);
    mounted.unmount();
  });

  it('does not write when the rider picks what is already chosen', async () => {
    const { port, writes } = recordingPort();
    const mounted = await mount(
      <SettingsView
        port={port}
        units="metric"
        onUnitsChange={() => undefined}
        onRiderMassChange={() => undefined}
      />,
    );

    radios(mounted.container)
      .find((radio) => radio.value === 'metric')
      ?.click();
    await settle();

    expect(writes).toEqual([]);
    mounted.unmount();
  });

  it('offers no control at all where there is nothing to write to, and explains', async () => {
    // ⚠️ Absent rather than disabled: a disabled control leaves the tab order,
    // so a keyboard user never reaches it and never hears why.
    const mounted = await mount(
      <SettingsView
        units="metric"
        onUnitsChange={() => undefined}
        onRiderMassChange={() => undefined}
      />,
    );

    expect(radios(mounted.container)).toEqual([]);
    expect(mounted.container.textContent).toContain(UNITS_NO_STORE);
    mounted.unmount();
  });

  it('says the choice does not reach a stored ride or an exported file', async () => {
    // #238's fourth criterion, said to the rider rather than only asserted in
    // `packages/store`: somebody about to send a file to a coach should not
    // have to guess whether their display setting went with it.
    const { port } = recordingPort();
    const mounted = await mount(
      <SettingsView
        port={port}
        units="metric"
        onUnitsChange={() => undefined}
        onRiderMassChange={() => undefined}
      />,
    );

    const text = mounted.container.textContent ?? '';
    expect(text).toContain('unaffected');
    expect(text).toMatch(/FIT, GPX or TCX/);
    mounted.unmount();
  });
});

/**
 * The weight box (#325).
 *
 * ⚠️ **This is the half that makes the game's new read of `AthleteRecord.mass`
 * mean anything.** The field had been on the row since schema 6 with two
 * readers and no writer; a fix that added a third reader and no writer would
 * have been the same defect with more code in it.
 *
 * The cases that matter are the same two shapes as the units panel above, plus
 * one that is specific to a quantity rather than a preference: **the box is in
 * the rider's units and the store's is not**, so a value that survived a switch
 * from kilometres to miles unconverted would sit under a `lb` label reading
 * 2.2 times light, and be entirely plausible.
 */
function massPort(options: { readonly answer?: 'none' | 'throw' } = {}): {
  readonly port: AthleteMassPort;
  readonly writes: (number | undefined)[];
} {
  const writes: (number | undefined)[] = [];
  return {
    writes,
    port: {
      athleteId: OWNER,
      store: {
        setAthleteMass: (id, mass): Promise<AthleteRecord | undefined> => {
          if (options.answer === 'throw') {
            return Promise.reject(new Error('site data is blocked'));
          }
          writes.push(mass);
          if (options.answer === 'none') {
            return Promise.resolve(undefined);
          }
          return Promise.resolve({
            id,
            displayName: 'You',
            createdAt: 0 as AthleteRecord['createdAt'],
            ...(mass === undefined ? {} : { mass }),
          });
        },
      },
    },
  };
}

function massBox(container: HTMLElement): HTMLInputElement {
  const found = container.querySelector<HTMLInputElement>('#oyl-rider-mass');
  if (found === null) {
    throw new Error('the weight box is not rendered');
  }
  return found;
}

function saveButton(container: HTMLElement): HTMLButtonElement {
  const found = queryAll<HTMLButtonElement>(container, 'button').find(
    (button) => button.textContent === 'Save weight',
  );
  if (found === undefined) {
    throw new Error('the save button is not rendered');
  }
  return found;
}

describe('SettingsView — your weight (#325)', () => {
  it('describes the box with how to clear it, under it and never tucked — #1023', async () => {
    const { port } = massPort();
    const mounted = await mount(
      <SettingsView
        units="metric"
        onUnitsChange={() => undefined}
        mass={port}
        onRiderMassChange={() => undefined}
      />,
    );
    const ids = (massBox(mounted.container).getAttribute('aria-describedby') ?? '').split(' ');
    const hints = ids.map((id) => document.getElementById(id));
    expect(hints.map((hint) => hint?.textContent?.replace(/\s+/g, ' '))).toEqual([
      'Leave it blank to go back to the assumed 71.0 kg.',
    ]);
    // On the screen: no closed disclosure between the hint and the page.
    expect(hints[0]?.closest('details')).toBeNull();
    mounted.unmount();
  });

  it('writes what the rider typed, in kilograms, scoped to the athlete', async () => {
    const { port, writes } = massPort();
    const mounted = await mount(
      <SettingsView
        units="metric"
        onUnitsChange={() => undefined}
        mass={port}
        onRiderMassChange={() => undefined}
      />,
    );

    await typeInto(massBox(mounted.container), '62.4');
    saveButton(mounted.container).click();
    await settle();

    expect(writes).toEqual([62.4]);
    mounted.unmount();
  });

  it('converts a weight typed in pounds before it is stored', async () => {
    // ⚠️ The assertion this panel exists to get right. A screen that wrote 154
    // would tell the physics a rider weighs 154 kg; one that multiplied would
    // write 339 and be refused, which would look like a validation problem
    // rather than a conversion one.
    const { port, writes } = massPort();
    const mounted = await mount(
      <SettingsView
        units="imperial"
        onUnitsChange={() => undefined}
        mass={port}
        onRiderMassChange={() => undefined}
      />,
    );

    await typeInto(massBox(mounted.container), '154');
    saveButton(mounted.container).click();
    await settle();

    expect(writes).toHaveLength(1);
    expect(writes[0]).toBeCloseTo(69.853, 3);
    mounted.unmount();
  });

  it('shows a stored weight in the rider’s own units', async () => {
    // The other direction, and the one a units switch gets wrong: 69.853 kg is
    // 154.0 lb, and a box that showed 69.9 under a `lb` label would be telling
    // a rider they weigh five stone.
    const { port } = massPort();
    const mounted = await mount(
      <SettingsView
        units="imperial"
        onUnitsChange={() => undefined}
        mass={port}
        riderMass={kilograms(154 * KILOGRAMS_PER_POUND)}
        onRiderMassChange={() => undefined}
      />,
    );

    expect(massBox(mounted.container).value).toBe('154.0');
    expect(mounted.container.textContent).toContain('lb');
    mounted.unmount();
  });

  it('re-seeds the box when the rider switches units', async () => {
    // ⚠️ A **re-render**, not a fresh mount: the panel has to notice, which is
    // what the `key` in `WeightPanel` is for. Without it the kilogram figure
    // sits under the new label and the next save stores a weight 2.2 times
    // light — a number the bounds accept and the physics rides.
    const { port } = massPort();
    const mounted = await mount(
      <SettingsView
        units="metric"
        onUnitsChange={() => undefined}
        mass={port}
        riderMass={kilograms(70)}
        onRiderMassChange={() => undefined}
      />,
    );
    expect(massBox(mounted.container).value).toBe('70.0');

    await mounted.rerender(
      <SettingsView
        units="imperial"
        onUnitsChange={() => undefined}
        mass={port}
        riderMass={kilograms(70)}
        onRiderMassChange={() => undefined}
      />,
    );

    expect(massBox(mounted.container).value).toBe('154.3');
    mounted.unmount();
  });

  it('does not let a confirmation outlive the units it was saved in', async () => {
    // ⚠️ The other half of the panel's `key`. The confirmation is held by
    // `WeightPanel` so that a save cannot destroy it (see `SettingsView.tsx`),
    // and the thing that must still retire it is a units switch: "the trainer
    // game now rides you at this weight" sitting above a box that has just been
    // re-seeded in pounds is a sentence about a number no longer on screen.
    const { port } = massPort();
    const mounted = await mount(
      <SettingsView
        units="metric"
        onUnitsChange={() => undefined}
        mass={port}
        riderMass={kilograms(70)}
        onRiderMassChange={() => undefined}
      />,
    );

    await typeInto(massBox(mounted.container), '64');
    saveButton(mounted.container).click();
    await settle();
    expect(mounted.container.textContent).toContain(MASS_SAVED);

    await mounted.rerender(
      <SettingsView
        units="imperial"
        onUnitsChange={() => undefined}
        mass={port}
        riderMass={kilograms(70)}
        onRiderMassChange={() => undefined}
      />,
    );

    expect(mounted.container.textContent).not.toContain(MASS_SAVED);
    mounted.unmount();
  });

  it('treats a blank box as a clear, and says the default is back', async () => {
    const { port, writes } = massPort();
    const mounted = await mount(
      <SettingsView
        units="metric"
        onUnitsChange={() => undefined}
        mass={port}
        riderMass={kilograms(70)}
        onRiderMassChange={() => undefined}
      />,
    );

    await typeInto(massBox(mounted.container), '');
    saveButton(mounted.container).click();
    await settle();

    expect(writes).toEqual([undefined]);
    expect(mounted.container.textContent).toContain(MASS_CLEARED);
    mounted.unmount();
  });

  it('refuses a slipped decimal point without writing anything', async () => {
    const { port, writes } = massPort();
    const mounted = await mount(
      <SettingsView
        units="metric"
        onUnitsChange={() => undefined}
        mass={port}
        onRiderMassChange={() => undefined}
      />,
    );

    await typeInto(massBox(mounted.container), '6.5');
    saveButton(mounted.container).click();
    await settle();

    expect(writes).toEqual([]);
    expect(mounted.container.textContent).toContain(MASS_REFUSAL);
    mounted.unmount();
  });

  it('tells the shell what came back off the row, not what it sent', async () => {
    // ⚠️ `saved.mass`, not `decision.mass`. A store that stored something else
    // must not be papered over by the value the screen handed it — that is the
    // "a write that reports success while the read cannot see it" shape, one
    // layer above the store.
    const told: (number | undefined)[] = [];
    const { port } = massPort();
    const mounted = await mount(
      <SettingsView
        units="metric"
        onUnitsChange={() => undefined}
        mass={port}
        onRiderMassChange={(next) => {
          told.push(next);
        }}
      />,
    );

    await typeInto(massBox(mounted.container), '62.4');
    saveButton(mounted.container).click();
    await settle();

    expect(told).toEqual([62.4]);
    expect(mounted.container.textContent).toContain(MASS_SAVED);
    mounted.unmount();
  });

  it('does not tell the shell when the store wrote nothing, and says so', async () => {
    // `setAthleteMass` answers `undefined` for "there is no such athlete" and
    // does not throw, so a caller that only catches sees a resolved promise —
    // and a rider would be told the game was riding them at a weight that had
    // never been written down.
    const told: (number | undefined)[] = [];
    const { port } = massPort({ answer: 'none' });
    const mounted = await mount(
      <SettingsView
        units="metric"
        onUnitsChange={() => undefined}
        mass={port}
        onRiderMassChange={(next) => {
          told.push(next);
        }}
      />,
    );

    await typeInto(massBox(mounted.container), '62.4');
    saveButton(mounted.container).click();
    await settle();

    expect(told).toEqual([]);
    const text = mounted.container.textContent ?? '';
    expect(text).toContain(MASS_NO_ATHLETE);
    expect(text).not.toContain(MASS_SAVED);
    mounted.unmount();
  });

  it('does not tell the shell when the write threw, and names the failure', async () => {
    const told: (number | undefined)[] = [];
    const { port } = massPort({ answer: 'throw' });
    const mounted = await mount(
      <SettingsView
        units="metric"
        onUnitsChange={() => undefined}
        mass={port}
        onRiderMassChange={(next) => {
          told.push(next);
        }}
      />,
    );

    await typeInto(massBox(mounted.container), '62.4');
    saveButton(mounted.container).click();
    await settle();

    expect(told).toEqual([]);
    expect(mounted.container.textContent).toContain('site data is blocked');
    mounted.unmount();
  });

  it('says which weight is being ridden, and whether anybody chose it', async () => {
    // ⚠️ `assumed` carried up to the screen, `analysis/thresholds.ts`'s reason:
    // a guess in the same typeface as a measurement is one a rider learns to
    // trust.
    const { port } = massPort();
    const assumed = await mount(
      <SettingsView
        units="metric"
        onUnitsChange={() => undefined}
        mass={port}
        onRiderMassChange={() => undefined}
      />,
    );
    expect(assumed.container.textContent).toContain('assumed');
    expect(assumed.container.textContent).toContain(String(DEFAULT_RIDER_MASS_KILOGRAMS));
    assumed.unmount();

    const entered = await mount(
      <SettingsView
        units="metric"
        onUnitsChange={() => undefined}
        mass={port}
        riderMass={kilograms(62.4)}
        onRiderMassChange={() => undefined}
      />,
    );
    expect(entered.container.textContent).toContain('62.4');
    expect(entered.container.textContent).not.toContain('You have not entered one');
    entered.unmount();
  });

  it('offers no box at all where there is nothing to write to, and explains', async () => {
    const mounted = await mount(
      <SettingsView
        units="metric"
        onUnitsChange={() => undefined}
        onRiderMassChange={() => undefined}
      />,
    );

    expect(mounted.container.querySelector('#oyl-rider-mass')).toBeNull();
    expect(mounted.container.textContent).toContain(MASS_NO_STORE);
    mounted.unmount();
  });
});

describe('announcements — #397', () => {
  function disk(): { readonly store: PreferenceStorage; readonly values: Map<string, string> } {
    const values = new Map<string, string>();
    return {
      values,
      store: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
          values.set(key, value);
        },
      },
    };
  }

  it('is off until the rider turns it on, and keeps the choice on this device', async () => {
    const { store, values } = disk();
    const mounted = await mount(
      <SettingsView
        units="metric"
        onUnitsChange={() => undefined}
        onRiderMassChange={() => undefined}
        announcements={store}
      />,
    );
    const toggle = mounted.container.querySelector<HTMLInputElement>('.oyl-announce input');
    expect(toggle?.checked).toBe(false);

    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });

    expect(readAnnouncementPreference(store).enabled).toBe(true);
    expect(values.size).toBe(1);
    expect(mounted.container.textContent).toContain(ANNOUNCEMENTS_SAVED);
    mounted.unmount();
  });

  it('says so when the device will not keep it', async () => {
    const refusing: PreferenceStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };
    const mounted = await mount(
      <SettingsView
        units="metric"
        onUnitsChange={() => undefined}
        onRiderMassChange={() => undefined}
        announcements={refusing}
      />,
    );
    await act(async () => {
      mounted.container.querySelector<HTMLInputElement>('.oyl-announce input')?.click();
      await Promise.resolve();
    });
    expect(mounted.container.textContent).toContain(ANNOUNCEMENTS_NOT_KEPT);
    mounted.unmount();
  });

  it('offers "never" on every row', async () => {
    const mounted = await mount(
      <SettingsView
        units="imperial"
        onUnitsChange={() => undefined}
        onRiderMassChange={() => undefined}
        announcements={disk().store}
      />,
    );
    // #1031: chips — a fieldset of native radios each — where they were selects.
    const groups = [
      ...mounted.container.querySelectorAll<HTMLFieldSetElement>('.oyl-announce fieldset'),
    ];
    // Four since #399: power, distance to go, the next block, a climb ahead.
    expect(groups).toHaveLength(4);
    expect(mounted.container.querySelectorAll('.oyl-announce select')).toHaveLength(0);
    for (const group of groups) {
      expect(group.classList.contains('oyl-chips')).toBe(true);
      const radios = [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
      expect(radios.map((radio) => radio.value)).toContain('never');
      // One group, one name: the platform's one tab stop and arrow keys.
      expect(new Set(radios.map((radio) => radio.name)).size).toBe(1);
    }
    // The distance row is in the rider's own unit.
    expect(mounted.container.textContent).toContain('every 1 mi');
    // #399: the climb row is STORED in metres and LABELLED in the rider's
    // unit — 250 m is 820 ft, and the value submitted is still the metres.
    const climb = mounted.container.querySelector<HTMLFieldSetElement>('#oyl-announce-climb');
    const chosen = climb?.querySelector<HTMLInputElement>('input:checked');
    expect(chosen?.value).toBe('250');
    expect(chosen?.closest('label')?.textContent).toContain('820 ft before it starts');
    mounted.unmount();
  });

  it('writes the value a chip names, which is the one the select wrote — #1031', async () => {
    const { store } = disk();
    const mounted = await mount(
      <SettingsView
        units="imperial"
        onUnitsChange={() => undefined}
        onRiderMassChange={() => undefined}
        announcements={store}
      />,
    );
    function chip(group: string, text: string): HTMLInputElement {
      const label = [
        ...mounted.container.querySelectorAll<HTMLLabelElement>(`#${group} label`),
      ].find((each) => each.textContent?.trim() === text);
      const input = label?.querySelector<HTMLInputElement>('input[type="radio"]');
      if (input === null || input === undefined) throw new Error(`no chip “${text}” in ${group}`);
      return input;
    }
    async function press(input: HTMLInputElement): Promise<void> {
      await act(async () => {
        input.click();
        await Promise.resolve();
      });
    }
    // Each group is named by its legend, the question the select's label asked.
    expect(mounted.container.querySelector('#oyl-announce-power > legend')?.textContent).toBe(
      'Say your power',
    );

    await press(chip('oyl-announce-power', 'every 2 min'));
    expect(readAnnouncementPreference(store).powerEverySeconds).toBe(120);
    expect(chip('oyl-announce-power', 'every 2 min').checked).toBe(true);

    await press(chip('oyl-announce-power', 'never'));
    expect(readAnnouncementPreference(store).powerEverySeconds).toBe('never');

    await press(chip('oyl-announce-distance', 'every 0.5 mi'));
    expect(readAnnouncementPreference(store).distanceEvery).toBe(0.5);

    await press(chip('oyl-announce-interval', '30 seconds before it starts'));
    expect(readAnnouncementPreference(store).intervalLeadSeconds).toBe(30);

    // Labelled in feet, stored in metres (#399).
    await press(chip('oyl-announce-climb', '1640 ft before it starts'));
    expect(readAnnouncementPreference(store).climbLeadMetres).toBe(500);
    mounted.unmount();
  });

  it('gives every chip an id a selector can name, and its label points at it — #1031', async () => {
    const mounted = await mount(
      <SettingsView
        units="imperial"
        onUnitsChange={() => undefined}
        onRiderMassChange={() => undefined}
        announcements={disk().store}
      />,
    );
    const radios = [
      ...mounted.container.querySelectorAll<HTMLInputElement>('.oyl-chips input[type="radio"]'),
    ];
    // The distance row's half-mile chip is the one whose value has a `.` in it.
    expect(radios.some((radio) => radio.value === '0.5')).toBe(true);
    for (const radio of radios) {
      expect(radio.id).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(mounted.container.querySelector(`#${radio.id}`)).toBe(radio);
      expect(radio.closest('label')?.htmlFor).toBe(radio.id);
    }
    mounted.unmount();
  });
});

describe('sounds — #400', () => {
  it('is off until the rider turns it on, and keeps the choice and the volume on this device', async () => {
    const values = new Map<string, string>();
    const store: PreferenceStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    };
    const mounted = await mount(
      <SettingsView
        units="metric"
        onUnitsChange={() => undefined}
        onRiderMassChange={() => undefined}
        announcements={store}
      />,
    );
    const toggle = mounted.container.querySelector<HTMLInputElement>(
      '.oyl-sounds input[type="checkbox"]',
    );
    expect(toggle?.checked).toBe(false);
    // #400's review: the distance note is played only on the frame its sentence
    // is said (a sound is never the only carrier), so the copy must not promise
    // it to a rider who has Sounds on and announcements off.
    // #666: the explanation is in the panel's ⓘ (#1031; "More about sounds" until then).
    const copy = mounted.container.querySelector('.oyl-sounds')?.textContent ?? '';
    expect(copy.replace(/\s+/g, ' ')).toContain(
      'That note plays only with its spoken sentence, so it needs announcements turned on above, with ' +
        '“Say the distance to go” set to a distance.',
    );
    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });
    expect(readCuePreference(store)).toEqual({ ...DEFAULT_CUES, enabled: true });
    // The mute is NOT here: it is on the ride's own screen, where the sound is.
    expect(
      [...mounted.container.querySelectorAll('button')].some(
        (each) => each.textContent === 'Mute sounds',
      ),
    ).toBe(false);
    mounted.unmount();
  });
});

describe('the game world — #475', () => {
  function disk(): PreferenceStorage {
    const values = new Map<string, string>();
    return {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    };
  }

  async function settings(store: PreferenceStorage) {
    return mount(
      <SettingsView
        units="metric"
        onUnitsChange={() => undefined}
        onRiderMassChange={() => undefined}
        announcements={store}
      />,
    );
  }

  it('draws every on/off setting on the screen as a switch, still a checkbox (#994)', async () => {
    const mounted = await settings(disk());
    for (const panel of ['.oyl-announce', '.oyl-sounds', '.oyl-world']) {
      const box = mounted.container.querySelector<HTMLInputElement>(
        `${panel} input[role="switch"]`,
      );
      expect(box?.type, panel).toBe('checkbox');
    }
    mounted.unmount();
  });

  it('is the standard world until the rider chooses otherwise, and keeps the choice on this device', async () => {
    const store = disk();
    const mounted = await settings(store);
    const toggle = mounted.container.querySelector<HTMLInputElement>(
      '.oyl-world input[type="checkbox"]',
    );
    expect(toggle?.checked).toBe(false);
    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });
    expect(readRealisticWorldChoice(store)).toBe(true);
    expect(mounted.container.textContent).toContain(ANNOUNCEMENTS_SAVED);
    // …and back off again, which is a choice kept too, not a deletion.
    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });
    expect(readRealisticWorldChoice(store)).toBe(false);
    mounted.unmount();

    // A fresh screen reads what was kept.
    const on = disk();
    on.setItem('oyl.game.realisticWorld.v1', 'on');
    const again = await settings(on);
    expect(
      again.container.querySelector<HTMLInputElement>('.oyl-world input[type="checkbox"]')?.checked,
    ).toBe(true);
    again.unmount();
  });

  it('says what happens offline before the rider chooses it — ADR 0026 D-7', async () => {
    const mounted = await settings(disk());
    const copy = (mounted.container.querySelector('.oyl-world')?.textContent ?? '').replace(
      /\s+/g,
      ' ',
    );
    expect(copy).toContain('not kept on this device for use offline');
    expect(copy).toContain('the ride is in the standard world instead and the ride screen says so');
    mounted.unmount();
  });

  it('says so when the device will not keep it', async () => {
    const refusing: PreferenceStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };
    const mounted = await settings(refusing);
    await act(async () => {
      mounted.container
        .querySelector<HTMLInputElement>('.oyl-world input[type="checkbox"]')
        ?.click();
      await Promise.resolve();
    });
    expect(mounted.container.textContent).toContain(ANNOUNCEMENTS_NOT_KEPT);
    mounted.unmount();
  });
});

describe('the ride map’s tiles — the owner’s decision of 2026-09-25', () => {
  function disk(): PreferenceStorage {
    const values = new Map<string, string>();
    return {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    };
  }

  const PUBLISHED = readBasemapConfig({});

  // An explicit parameter rather than a default: a default would turn the
  // no-map case's `undefined` back into the published archive.
  async function settings(store: PreferenceStorage, basemap: BasemapConfig | undefined) {
    return mount(
      <SettingsView
        units="metric"
        onUnitsChange={() => undefined}
        onRiderMassChange={() => undefined}
        announcements={store}
        basemap={basemap}
      />,
    );
  }

  function toggleIn(mounted: { container: HTMLElement }): HTMLInputElement | null {
    return mounted.container.querySelector<HTMLInputElement>(
      '.oyl-map-tiles input[type="checkbox"]',
    );
  }

  it('is on until the rider turns it off, and keeps the choice on this device', async () => {
    const store = disk();
    const mounted = await settings(store, PUBLISHED);
    const toggle = toggleIn(mounted);
    expect(toggle?.checked).toBe(true);
    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });
    expect(readMapTilesChoice(store)).toBe(false);
    expect(mounted.container.textContent).toContain(ANNOUNCEMENTS_SAVED);
    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });
    expect(readMapTilesChoice(store)).toBe(true);
    mounted.unmount();

    // A fresh screen reads what was kept.
    const off = disk();
    off.setItem(MAP_TILES_STORAGE_KEY, 'off');
    const again = await settings(off, PUBLISHED);
    expect(toggleIn(again)?.checked).toBe(false);
    again.unmount();
  });

  it('says what turning it on sends, and to the host the build actually uses', async () => {
    const mounted = await settings(disk(), PUBLISHED);
    const copy = (mounted.container.querySelector('.oyl-map-tiles')?.textContent ?? '').replace(
      /\s+/g,
      ' ',
    );
    expect(copy).toContain('asks tiles.openzigs.com for the map around where you rode');
    expect(copy).toContain('sends the map area and your device’s IP address to tiles.openzigs.com');
    expect(copy).toContain('It sends no ride data');
    // #558: about the host this project runs, the screen says what Cloudflare
    // keeps and for how long — the retired "no record" promise was false.
    expect(copy).toContain(
      'Cloudflare, which runs tiles.openzigs.com for us, keeps a record of each map request — your IP address, the time, and your device or browser type, not which part of the map — that our Cloudflare account can see for up to 7 days.',
    );
    expect(copy).toContain('We don’t use it or share it.');
    expect(copy).not.toContain('no record');
    // #559's review: the tile is chosen by a Range header the kept record does
    // not include, so the screen must not say the record names the tiles.
    expect(copy).not.toContain('which map tiles were asked for');
    mounted.unmount();

    // A self-hoster's build names its own host, not ours.
    const theirs = await settings(disk(), {
      archiveUrl: 'https://maps.example.net/a.pmtiles',
      attribution: OSM_ATTRIBUTION,
    });
    const theirCopy = theirs.container.querySelector('.oyl-map-tiles')?.textContent ?? '';
    expect(theirCopy).toContain('maps.example.net');
    expect(theirCopy).not.toContain('tiles.openzigs.com');
    // …and no retention claim is made either way about somebody else's server,
    // whose logs this app knows nothing about (#535 review, #558).
    expect(theirCopy).not.toContain('no record');
    expect(theirCopy).not.toContain('Cloudflare');
    expect(theirCopy).not.toContain('7 days');
    expect(theirCopy).not.toContain('keeps');
    theirs.unmount();
  });

  it('offers no switch in a build with no map, and says it asks for nothing', async () => {
    const mounted = await settings(disk(), undefined);
    expect(toggleIn(mounted)).toBeNull();
    expect(mounted.container.querySelector('.oyl-map-tiles')?.textContent).toContain(
      'never asks a tile server for anything',
    );
    mounted.unmount();
  });

  it('says so when the device will not keep it', async () => {
    const refusing: PreferenceStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };
    const mounted = await settings(refusing, PUBLISHED);
    await act(async () => {
      toggleIn(mounted)?.click();
      await Promise.resolve();
    });
    expect(mounted.container.textContent).toContain(ANNOUNCEMENTS_NOT_KEPT);
    mounted.unmount();
  });
});

/**
 * The rider's kit colour — #623's second half.
 *
 * A radio group of the fixed palette, each option its NAME, the current choice
 * always shown (ADR 0020 D-3), and the narrow write's `undefined` branched on
 * the way `UNITS_NO_ATHLETE` is.
 */
describe('the kit colour — #623', () => {
  function kitPort(answer: 'row' | 'nobody' | 'throws', writes: KitColour[]): AthleteKitColourPort {
    return {
      athleteId: OWNER,
      store: {
        setAthleteKitColour: (id, kitColour): Promise<AthleteRecord | undefined> => {
          writes.push(kitColour);
          if (answer === 'throws') return Promise.reject(new Error('the disk is full'));
          return Promise.resolve(
            answer === 'nobody'
              ? undefined
              : { id, displayName: 'You', createdAt: 0 as AthleteRecord['createdAt'], kitColour },
          );
        },
      },
    };
  }

  function kitRadios(container: HTMLElement): HTMLInputElement[] {
    return queryAll<HTMLInputElement>(container, 'input[type="radio"][name="oyl-kit"]');
  }

  async function mountWith(
    props: { kit?: AthleteKitColourPort; kitColour?: KitColour },
    told: (KitColour | undefined)[],
  ) {
    return mount(
      <SettingsView
        units="metric"
        onUnitsChange={() => undefined}
        onRiderMassChange={() => undefined}
        {...props}
        onKitColourChange={(chosen) => {
          told.push(chosen);
        }}
      />,
    );
  }

  it('offers every palette entry by name, in the palette’s order, the house kit first', async () => {
    const mounted = await mountWith({ kit: kitPort('row', []) }, []);
    const options = kitRadios(mounted.container);

    expect(options.map((radio) => radio.value)).toEqual([...KIT_COLOURS]);
    for (const radio of options) {
      const label = radio.closest('label');
      // A NAME, not only a swatch — and the swatch is hidden from assistive technology.
      expect(label?.textContent).toContain(KIT_PALETTE[radio.value as KitColour].name);
      expect(label?.querySelector('.oyl-kit__swatch')?.getAttribute('aria-hidden')).toBe('true');
    }
    expect(mounted.container.querySelector('legend')?.textContent).toBeTruthy();
    mounted.unmount();
  });

  it('shows the house kit chosen for a rider who never chose, and the stored choice otherwise', async () => {
    const unchosen = await mountWith({ kit: kitPort('row', []) }, []);
    expect(
      kitRadios(unchosen.container)
        .filter((radio) => radio.checked)
        .map((r) => r.value),
    ).toEqual(['house']);
    unchosen.unmount();

    const chosen = await mountWith({ kit: kitPort('row', []), kitColour: 'purple' }, []);
    expect(
      kitRadios(chosen.container)
        .filter((radio) => radio.checked)
        .map((r) => r.value),
    ).toEqual(['purple']);
    chosen.unmount();
  });

  it('writes the choice, then tells the shell what landed, and says it was saved', async () => {
    const writes: KitColour[] = [];
    const told: (KitColour | undefined)[] = [];
    const mounted = await mountWith({ kit: kitPort('row', writes) }, told);

    await act(async () => {
      kitRadios(mounted.container)
        .find((radio) => radio.value === 'lime')
        ?.click();
      await Promise.resolve();
    });
    await settle();

    expect(writes).toEqual(['lime']);
    expect(told).toEqual(['lime']);
    expect(mounted.container.textContent).toContain(KIT_SAVED);
    mounted.unmount();
  });

  it('does not tell the shell when the store wrote nothing, and says so', async () => {
    const told: (KitColour | undefined)[] = [];
    const mounted = await mountWith({ kit: kitPort('nobody', []) }, told);

    await act(async () => {
      kitRadios(mounted.container)
        .find((radio) => radio.value === 'green')
        ?.click();
      await Promise.resolve();
    });
    await settle();

    expect(told).toEqual([]);
    const text = mounted.container.textContent ?? '';
    expect(text).toContain(KIT_NO_ATHLETE);
    expect(text).not.toContain(KIT_SAVED);
    mounted.unmount();
  });

  it('names a failed write rather than swallowing it', async () => {
    const told: (KitColour | undefined)[] = [];
    const mounted = await mountWith({ kit: kitPort('throws', []) }, told);

    await act(async () => {
      kitRadios(mounted.container)
        .find((radio) => radio.value === 'green')
        ?.click();
      await Promise.resolve();
    });
    await settle();

    expect(told).toEqual([]);
    expect(mounted.container.textContent).toContain('the disk is full');
    mounted.unmount();
  });

  /*
   * The owner's ruling of 2026-09-28: with no store the control is ABSENT, as
   * the units' and the weight's are, and nothing is offered "for this visit".
   * The two cases are each other's control: the same markup must render the
   * five radios with a port and none without it.
   */
  it('with no store, offers no choice at all and says why, as the units and the weight do', async () => {
    const mounted = await mountWith({}, []);

    expect(kitRadios(mounted.container)).toEqual([]);
    expect(mounted.container.querySelector('fieldset.oyl-kit')).toBeNull();
    const heading = mounted.container.querySelector('#oyl-kit-heading');
    expect(heading?.textContent).toBe('Your kit');
    const warning = [...mounted.container.querySelectorAll('.oyl-status--warning')].find(
      (element) => (element.textContent ?? '').includes(KIT_NO_STORE),
    );
    expect(warning).toBeDefined();
    const text = mounted.container.textContent ?? '';
    // No ⓘ explaining a choice that is not on offer (#1031; a "More about your
    // kit" until then), and never "kept".
    expect(text).not.toContain('Help with Your kit');
    expect(text).not.toContain(KIT_KEPT);
    mounted.unmount();
  });

  it('with a store, offers the five and says the choice is kept with the rider’s rides', async () => {
    const mounted = await mountWith({ kit: kitPort('row', []) }, []);
    expect(kitRadios(mounted.container)).toHaveLength(KIT_COLOURS.length);
    expect(mounted.container.textContent).toContain(KIT_KEPT);
    expect(mounted.container.textContent).not.toContain(KIT_NO_STORE);
    mounted.unmount();
  });
});

describe('appearance — #672', () => {
  /** A device's `localStorage`, with the third method the palette needs. */
  function themeDisk(): {
    readonly store: ThemeStorage;
    readonly values: Map<string, string>;
    refuse: boolean;
  } {
    const values = new Map<string, string>();
    const disk = {
      values,
      refuse: false,
      store: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (disk.refuse) throw new DOMException('full', 'QuotaExceededError');
          values.set(key, value);
        },
        removeItem: (key: string) => {
          if (disk.refuse) throw new DOMException('full', 'QuotaExceededError');
          values.delete(key);
        },
      },
    };
    return disk;
  }

  async function mountWith(
    store: ThemeStorage,
    options: { readonly keepHeld?: boolean } = {},
  ): Promise<Awaited<ReturnType<typeof mount>>> {
    document.documentElement.removeAttribute('data-theme');
    if (options.keepHeld !== true) {
      document.documentElement.removeAttribute(THEME_OVERRIDE_ATTRIBUTE);
    }
    return mount(
      <SettingsView
        units="metric"
        onUnitsChange={() => undefined}
        onRiderMassChange={() => undefined}
        themeStorage={store}
      />,
    );
  }

  function radio(container: HTMLElement, label: string): HTMLInputElement {
    const found = [...container.querySelectorAll<HTMLInputElement>('input[name="oyl-theme"]')].find(
      (input) => input.closest('label')?.textContent?.trim() === label,
    );
    if (found === undefined) throw new Error(`no "${label}" choice`);
    return found;
  }

  it('offers three choices as native radios in one group, dark by default (#992)', async () => {
    const { store } = themeDisk();
    const mounted = await mountWith(store);
    const radios = [
      ...mounted.container.querySelectorAll<HTMLInputElement>('input[name="oyl-theme"]'),
    ];
    expect(radios.map((input) => input.closest('label')?.textContent?.trim())).toEqual([
      'Match this device',
      'Light',
      'Dark',
    ]);
    expect(radios.every((input) => input.type === 'radio')).toBe(true);
    expect(radios.find((input) => input.checked)?.value).toBe('dark');
    expect(radios[0]?.closest('fieldset')?.querySelector('legend')?.textContent).toBe(
      'Light or dark?',
    );
    mounted.unmount();
  });

  it('applies a choice to this page at once and keeps it on the device', async () => {
    const { store, values } = themeDisk();
    const mounted = await mountWith(store);
    await act(async () => {
      radio(mounted.container, 'Light').click();
      await Promise.resolve();
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(values.get(THEME_STORAGE_KEY)).toBe('light');
    expect(mounted.container.textContent).toContain(ANNOUNCEMENTS_SAVED);

    await act(async () => {
      radio(mounted.container, 'Dark').click();
      await Promise.resolve();
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(values.get(THEME_STORAGE_KEY)).toBe('dark');

    // #992: following the device is a stored word, because NO stored value is
    // now the dark default.
    await act(async () => {
      radio(mounted.container, 'Match this device').click();
      await Promise.resolve();
    });
    expect(values.get(THEME_STORAGE_KEY)).toBe('device');
    mounted.unmount();
  });

  it('reads a stored choice back when the screen is opened again', async () => {
    const { store, values } = themeDisk();
    values.set(THEME_STORAGE_KEY, 'dark');
    const mounted = await mountWith(store);
    expect(radio(mounted.container, 'Dark').checked).toBe(true);
    mounted.unmount();
  });

  it('still changes this page where the device will not keep it, and says so', async () => {
    const disk = themeDisk();
    disk.refuse = true;
    const mounted = await mountWith(disk.store);
    await act(async () => {
      radio(mounted.container, 'Light').click();
      await Promise.resolve();
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(mounted.container.textContent).toContain(ANNOUNCEMENTS_NOT_KEPT);
    mounted.unmount();
  });

  it('holds a refused choice for the page’s life, over an OLDER stored one (#744’s review)', async () => {
    // A full quota: the device still holds Light from before, and will not
    // take Dark. The page is Dark, and says so again when the screen reopens,
    // because the inline script and the module both read the held choice
    // before storage (`theme-selection.test.ts` holds the device-change half).
    const disk = themeDisk();
    disk.values.set(THEME_STORAGE_KEY, 'light');
    disk.refuse = true;
    const mounted = await mountWith(disk.store);
    await act(async () => {
      radio(mounted.container, 'Dark').click();
      await Promise.resolve();
    });
    expect(document.documentElement.getAttribute(THEME_OVERRIDE_ATTRIBUTE)).toBe('dark');
    expect(disk.values.get(THEME_STORAGE_KEY)).toBe('light');
    mounted.unmount();

    const reopened = await mountWith(disk.store, { keepHeld: true });
    expect(radio(reopened.container, 'Dark').checked).toBe(true);
    reopened.unmount();
    document.documentElement.removeAttribute(THEME_OVERRIDE_ATTRIBUTE);
  });

  it('says the ride screen does not change, beside the control', async () => {
    const mounted = await mountWith(themeDisk().store);
    expect(mounted.container.textContent).toContain(APPEARANCE_STAYS_HERE);
    mounted.unmount();
  });

  it('says a device that has not chosen starts dark, and keeps every choice’s sentence (#992)', async () => {
    const mounted = await mountWith(themeDisk().store);
    // #1031: in the Appearance section's ⓘ, where "More about light and dark" was.
    const more = [...mounted.container.querySelectorAll('details.oyl-section-help')].find(
      (details) => details.querySelector('summary')?.textContent === 'Help with Appearance',
    );
    expect(more?.textContent).toContain(APPEARANCE_STARTS_DARK);
    expect(more?.textContent).toContain(
      'Light or dark as this device is set, and it changes when the device does.',
    );
    mounted.unmount();
  });
});

describe('the cards — #1026', () => {
  /** Each card's title, and the `h3` of every section inside it, in order. */
  function cards(container: HTMLElement): { title: string; sections: string[] }[] {
    return queryAll<HTMLElement>(container, '.oyl-settings-card').map((card) => ({
      title: card.querySelector('h2')?.textContent ?? '',
      sections: queryAll<HTMLElement>(card, 'h3').map((heading) => heading.textContent ?? ''),
    }));
  }

  it('gives the words to mask, the goals and the documents a card each, in their order', async () => {
    // ⚠️ #942 put the three in one card, 1959 px tall at half a landscape
    // tablet; `browser/sections.browser.spec.ts` §"#1026" measures the rows
    // this makes, and this is the structure it measures.
    const { port } = recordingPort();
    const mounted = await mount(
      <SettingsView
        port={port}
        units="metric"
        onUnitsChange={() => undefined}
        onRiderMassChange={() => undefined}
      />,
    );

    const seen = cards(mounted.container);
    expect(seen.map((card) => card.title)).toEqual([
      SETTINGS_CARD_TITLES.you,
      SETTINGS_CARD_TITLES.look,
      SETTINGS_CARD_TITLES.ride,
      SETTINGS_CARD_TITLES.words,
      SETTINGS_CARD_TITLES.goals,
      SETTINGS_CARD_TITLES.documents,
      SETTINGS_CARD_TITLES.device,
    ]);
    const sectionsOf = (title: string): string[] | undefined =>
      seen.find((card) => card.title === title)?.sections;
    expect(sectionsOf(SETTINGS_CARD_TITLES.words)).toEqual(['Words to mask']);
    expect(sectionsOf(SETTINGS_CARD_TITLES.goals)).toEqual(['Goals and notes']);
    expect(sectionsOf(SETTINGS_CARD_TITLES.documents)).toEqual(['Documents for the analysis']);
    mounted.unmount();
  });
});
