// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2079 on Settings: a rider turns the ride HUD's panels off and chooses a
 * text size, and what is asserted is what a later screen reads back from this
 * device — Settings mounted again, and `readHudLayout`, which is how the next
 * ride reads it (`GameView.test.tsx` §"#2079" holds that the ride does).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { HUD_LAYOUT_STORAGE_KEY, readHudLayout } from '../game/hud/hud-layout-preference';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { ANNOUNCEMENTS_NOT_KEPT, SettingsView } from './SettingsView';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  localStorage.removeItem(HUD_LAYOUT_STORAGE_KEY);
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

function choice(text: string): HTMLInputElement {
  const label = queryAll(document, '.oyl-hud-layout__choice').find((each) =>
    (each.textContent ?? '').trim().startsWith(text),
  );
  const input = label?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`no HUD layout choice "${text}"`);
  return input;
}

async function press(input: HTMLInputElement): Promise<void> {
  input.click();
  await settle();
}

describe('the Ride HUD panel in Settings — #2079', () => {
  it('turns panels off and chooses a text size, kept on the device and read back', async () => {
    await settings();
    expect(choice('The route').checked).toBe(true);
    expect(choice('Normal').checked).toBe(true);

    await press(choice('The route'));
    await press(choice('A race’s standings'));
    await press(choice('Extra large'));

    // What the next ride reads.
    expect(readHudLayout(localStorage)).toEqual({
      hidden: ['route', 'standings'],
      textSize: 'extra-large',
      arrangement: 'full',
      route: 'full',
    });
    // And Settings, opened again, says the same.
    await settings();
    expect(choice('The route').checked).toBe(false);
    expect(choice('A race’s standings').checked).toBe(false);
    expect(choice('Ride readings').checked).toBe(true);
    expect(choice('Extra large').checked).toBe(true);

    // Turned back on, it is shown again.
    await press(choice('The route'));
    expect(readHudLayout(localStorage).hidden).toEqual(['standings']);
  });

  it('offers no way to hide power, the ride controls or a notice', async () => {
    await settings();
    const offered = queryAll(document, '.oyl-hud-layout__choice').map((each) =>
      (each.textContent ?? '').trim(),
    );
    // Four panels, three sizes, (#2383) two arrangements and (#2385) two
    // route panels.
    expect(offered).toHaveLength(11);
    for (const word of ['Power', 'Pause', 'notice']) {
      expect(offered.some((each) => each.startsWith(word))).toBe(false);
    }
  });

  it('chooses the focus arrangement, kept on the device beside the other choices — #2383', async () => {
    await settings();
    // Full is the default.
    expect(choice('Full').checked).toBe(true);
    expect(choice('Focus').checked).toBe(false);

    await press(choice('Large'));
    await press(choice('Focus'));

    // What the next ride reads.
    expect(readHudLayout(localStorage)).toEqual({
      hidden: [],
      textSize: 'large',
      arrangement: 'focus',
      route: 'full',
    });
    // And Settings, opened again, says the same.
    await settings();
    expect(choice('Focus').checked).toBe(true);
    expect(choice('Full').checked).toBe(false);
    expect(choice('Large').checked).toBe(true);

    // And back.
    await press(choice('Full'));
    expect(readHudLayout(localStorage).arrangement).toBe('full');
  });

  it('chooses the compact route panel, kept beside the route turned off — #2385', async () => {
    await settings();
    // The full route panel is the default.
    expect(choice('Height profile and map').checked).toBe(true);
    expect(choice('Compact').checked).toBe(false);

    await press(choice('Compact'));
    // The checkbox that shows the route names no view, so with the compact
    // panel chosen it promises no height profile.
    const show = choice('The route');
    expect(show.closest('label')?.textContent?.trim()).toBe('The route panel');
    expect(show.closest('label')?.textContent).not.toMatch(/height profile/i);
    expect(readHudLayout(localStorage)).toEqual({
      hidden: [],
      textSize: 'normal',
      arrangement: 'full',
      route: 'compact',
    });

    // Turning the route off keeps the choice of how it is drawn, and hides it.
    await press(choice('The route'));
    expect(readHudLayout(localStorage)).toEqual({
      hidden: ['route'],
      textSize: 'normal',
      arrangement: 'full',
      route: 'compact',
    });

    // And Settings, opened again, says the same.
    await settings();
    expect(choice('Compact').checked).toBe(true);
    expect(choice('Height profile and map').checked).toBe(false);
    expect(choice('The route').checked).toBe(false);

    // And back.
    await press(choice('Height profile and map'));
    expect(readHudLayout(localStorage).route).toBe('full');
  });

  it('says so when the device will not keep the choice', async () => {
    await settings({
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    await press(choice('Large'));
    expect(document.querySelector('.oyl-hud-layout')?.textContent).toContain(
      ANNOUNCEMENTS_NOT_KEPT,
    );
  });
});
