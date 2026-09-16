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

import type { AthleteId, AthleteRecord, UnitSystem } from '@onyourleft/store';
import { athleteId } from '@onyourleft/store';
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
} from './SettingsView';

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

function radios(container: HTMLElement): HTMLInputElement[] {
  return queryAll<HTMLInputElement>(container, 'input[type="radio"]');
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
