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

import { mount, queryAll, settle } from '../testing/mount';
import type { UnitsPort } from '../units/store-port';

import { SettingsView, UNITS_NO_STORE, UNITS_SAVED } from './SettingsView';

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
      <SettingsView port={port} units="metric" onUnitsChange={() => undefined} />,
    );

    const chosen = radios(mounted.container).filter((radio) => radio.checked);
    expect(chosen).toHaveLength(1);
    expect(chosen[0]?.value).toBe('metric');
    mounted.unmount();
  });

  it('shows imperial as the current choice when that is what is stored', async () => {
    const { port } = recordingPort();
    const mounted = await mount(
      <SettingsView port={port} units="imperial" onUnitsChange={() => undefined} />,
    );

    expect(radios(mounted.container).find((radio) => radio.checked)?.value).toBe('imperial');
    mounted.unmount();
  });

  it('names both units in words, so neither has to be guessed at', async () => {
    const { port } = recordingPort();
    const mounted = await mount(
      <SettingsView port={port} units="metric" onUnitsChange={() => undefined} />,
    );

    const text = mounted.container.textContent ?? '';
    expect(text).toContain('Kilometres');
    expect(text).toContain('Miles');
    mounted.unmount();
  });

  it('writes the choice to the store, scoped to the athlete', async () => {
    const { port, writes } = recordingPort();
    const mounted = await mount(
      <SettingsView port={port} units="metric" onUnitsChange={() => undefined} />,
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
        setAthleteUnits: async (): Promise<AthleteRecord | undefined> => {
          await Promise.resolve();
          order.push('stored');
          return undefined;
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

  it('confirms a save, so the rider knows it stuck', async () => {
    const { port } = recordingPort();
    const mounted = await mount(
      <SettingsView port={port} units="metric" onUnitsChange={() => undefined} />,
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
      <SettingsView port={port} units="metric" onUnitsChange={() => undefined} />,
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
    const mounted = await mount(<SettingsView units="metric" onUnitsChange={() => undefined} />);

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
      <SettingsView port={port} units="metric" onUnitsChange={() => undefined} />,
    );

    const text = mounted.container.textContent ?? '';
    expect(text).toContain('unaffected');
    expect(text).toMatch(/FIT, GPX or TCX/);
    mounted.unmount();
  });
});
