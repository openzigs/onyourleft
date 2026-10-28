// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The assisted Delivery setting on the Settings screen — #1813, DL10. What a
 * rider chooses here is read back through `assist-preference.ts`' own
 * reader, the one #1816's round will call, over the same storage; and every
 * number the screen says is held to the constant that applies it.
 */

import { act } from 'react';
import { describe, expect, it } from 'vitest';

import {
  DELIVERY_ASSIST_STORAGE_KEY,
  readDeliveryAssist,
} from '../game/delivery/assist-preference';
import { FEWER_OBSTACLES_KEEP_ONE_IN, OBSTACLE_SPACING_METRES } from '../game/delivery/obstacles';
import { ASSISTED_THROW_SCALE } from '../game/delivery/throw';
import type { PreferenceStorage } from '../game/hud/announce-preference';
import { mount, queryAll } from '../testing/mount';
import {
  ANNOUNCEMENTS_NOT_KEPT,
  ANNOUNCEMENTS_SAVED,
  DELIVERY_ASSIST_TEXT,
  SettingsView,
} from './SettingsView';

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

const PANEL = '.oyl-delivery-assist';

function controls(root: ParentNode) {
  const switches = queryAll<HTMLInputElement>(root, `${PANEL} input[role="switch"]`);
  const radios = queryAll<HTMLInputElement>(root, `${PANEL} input[type="radio"]`);
  return { wider: switches[0], noFail: switches[1], radios, switches };
}

async function press(input: HTMLInputElement | undefined): Promise<void> {
  await act(async () => {
    input?.click();
    await Promise.resolve();
  });
}

describe('the assisted Delivery setting on Settings — #1813', () => {
  it('starts with nothing assisted, and keeps each choice where the round reads it', async () => {
    const store = disk();
    const mounted = await settings(store);
    const { wider, noFail, radios, switches } = controls(mounted.container);
    expect(switches).toHaveLength(2);
    expect(wider?.checked).toBe(false);
    expect(noFail?.checked).toBe(false);
    expect(radios.map((radio) => radio.value)).toEqual(['normal', 'fewer', 'none']);
    expect(radios.find((radio) => radio.checked)?.value).toBe('normal');

    await press(wider);
    expect(readDeliveryAssist(store)).toEqual({
      widerWindows: true,
      obstacles: 'normal',
      noFail: false,
    });
    expect(mounted.container.textContent).toContain(ANNOUNCEMENTS_SAVED);

    await press(radios.find((radio) => radio.value === 'none'));
    await press(noFail);
    expect(readDeliveryAssist(store)).toEqual({
      widerWindows: true,
      obstacles: 'none',
      noFail: true,
    });

    // …and off again, which is a choice kept too.
    await press(wider);
    await press(radios.find((radio) => radio.value === 'fewer'));
    expect(readDeliveryAssist(store)).toEqual({
      widerWindows: false,
      obstacles: 'fewer',
      noFail: true,
    });
    mounted.unmount();

    // A fresh screen over the same storage shows what was kept.
    const again = await settings(store);
    const read = controls(again.container);
    expect(read.wider?.checked).toBe(false);
    expect(read.noFail?.checked).toBe(true);
    expect(read.radios.find((radio) => radio.checked)?.value).toBe('fewer');
    again.unmount();
  });

  it('shows a stored value it cannot read as nothing assisted', async () => {
    const store = disk();
    store.setItem(DELIVERY_ASSIST_STORAGE_KEY, '{"widerWindows":true');
    const mounted = await settings(store);
    const { wider, noFail, radios } = controls(mounted.container);
    expect(wider?.checked).toBe(false);
    expect(noFail?.checked).toBe(false);
    expect(radios.find((radio) => radio.checked)?.value).toBe('normal');
    mounted.unmount();
  });

  it('says the chosen obstacle setting under the group, and every one in the help', async () => {
    const mounted = await settings(disk());
    const detail = (): string =>
      mounted.container.querySelector('#oyl-delivery-obstacles-detail')?.textContent ?? '';
    expect(detail()).toBe(DELIVERY_ASSIST_TEXT.obstacles.normal.detail);
    await press(controls(mounted.container).radios.find((radio) => radio.value === 'none'));
    expect(detail()).toBe(DELIVERY_ASSIST_TEXT.obstacles.none.detail);
    const help = mounted.container.querySelector(`${PANEL} .oyl-section-help`)?.textContent ?? '';
    for (const option of Object.values(DELIVERY_ASSIST_TEXT.obstacles)) {
      expect(help).toContain(option.detail);
    }
    expect(help).toContain(DELIVERY_ASSIST_TEXT.stays);
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
    await press(controls(mounted.container).noFail);
    expect(mounted.container.textContent).toContain(ANNOUNCEMENTS_NOT_KEPT);
    mounted.unmount();
  });

  it('says the numbers the modules apply', () => {
    const words = ['', '', 'twice', 'three times', 'four times'];
    expect(DELIVERY_ASSIST_TEXT.widerDetail).toContain(
      `${words[ASSISTED_THROW_SCALE] ?? '?'} as far`,
    );
    expect(DELIVERY_ASSIST_TEXT.obstacles.normal.detail).toContain(
      `every ${String(OBSTACLE_SPACING_METRES)} metres`,
    );
    expect(FEWER_OBSTACLES_KEEP_ONE_IN).toBe(2);
    expect(DELIVERY_ASSIST_TEXT.obstacles.fewer.detail).toContain('Half as many');
    expect(DELIVERY_ASSIST_TEXT.obstacles.fewer.detail).toContain(
      `one every ${String(OBSTACLE_SPACING_METRES * FEWER_OBSTACLES_KEEP_ONE_IN)} metres`,
    );
  });
});
