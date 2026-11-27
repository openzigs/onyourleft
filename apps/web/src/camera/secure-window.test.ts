// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The secure window flag's one owner** — #1061, ADR 0044 D-12: set when the
 * first camera picture is on screen, cleared when the last is removed, and
 * never cleared on the way to the background.
 */

import { setCapacitorSecureWindow, type SecureWindowPlugin } from '@onyourleft/mobile';
import { describe, expect, it } from 'vitest';

import {
  SecureWindow,
  shellSecureWindowPort,
  type Foreground,
  type ShellSecureWindowModule,
} from './secure-window';
import { NO_SECURE_WINDOW } from './secure-window-port';

async function flush(): Promise<void> {
  for (let round = 0; round < 20; round += 1) {
    await Promise.resolve();
  }
}

function scripted() {
  const asked: boolean[] = [];
  let visible = true;
  const comeBack = new Set<() => void>();
  const foreground: Foreground = {
    inForeground: () => visible,
    onForeground: (listener) => {
      comeBack.add(listener);
      return () => comeBack.delete(listener);
    },
  };
  const owner = new SecureWindow(
    {
      setSecureWindow: async (secure) => {
        asked.push(secure);
        return Promise.resolve();
      },
    },
    foreground,
  );
  return {
    owner,
    asked,
    background() {
      visible = false;
    },
    foreground() {
      visible = true;
      for (const listener of [...comeBack]) {
        listener();
      }
    },
    waiting: () => comeBack.size,
  };
}

describe('the secure window flag — #1061, ADR 0044 D-12', () => {
  it('sets the flag for the first picture and clears it after the last', async () => {
    const { owner, asked } = scripted();
    const giveBack = owner.hold();
    await flush();
    expect(asked).toStrictEqual([true]);
    giveBack();
    await flush();
    expect(asked).toStrictEqual([true, false]);
  });

  it('keeps it while any picture is still on screen — two at once, or one replaced by the next', async () => {
    const { owner, asked } = scripted();
    const first = owner.hold();
    const second = owner.hold();
    first();
    await flush();
    expect(asked).toStrictEqual([true]);
    expect(owner.holds).toBe(1);
    second();
    await flush();
    expect(asked).toStrictEqual([true, false]);
  });

  it('counts a give-back once, however often it is called', async () => {
    const { owner, asked } = scripted();
    const first = owner.hold();
    const second = owner.hold();
    first();
    first();
    await flush();
    expect(owner.holds).toBe(1);
    expect(asked).toStrictEqual([true]);
    second();
  });

  it('is not cleared on the way to the background — only once the app is in front again', async () => {
    const harness = scripted();
    const giveBack = harness.owner.hold();
    harness.background();
    // The link dropped while the app was leaving: the picture is removed.
    giveBack();
    await flush();
    expect(harness.asked).toStrictEqual([true]);
    harness.foreground();
    await flush();
    expect(harness.asked).toStrictEqual([true, false]);
    expect(harness.waiting()).toBe(0);
  });

  it('stays set if a picture is back on screen by the time the app is in front', async () => {
    const harness = scripted();
    const first = harness.owner.hold();
    harness.background();
    first();
    // A picture comes back before the app does.
    const second = harness.owner.hold();
    harness.foreground();
    await flush();
    expect(harness.asked).toStrictEqual([true]);
    second();
    await flush();
    expect(harness.asked).toStrictEqual([true, false]);
  });

  it('swallows a platform that cannot set it, and goes on counting', async () => {
    const asked: boolean[] = [];
    const owner = new SecureWindow(
      {
        setSecureWindow: async (secure) => {
          asked.push(secure);
          return Promise.reject(new Error('not implemented'));
        },
      },
      { inForeground: () => true, onForeground: () => () => undefined },
    );
    const giveBack = owner.hold();
    await flush();
    giveBack();
    await flush();
    expect(asked).toStrictEqual([true, false]);
  });

  it('asks nothing of a browser, which has no flag', async () => {
    await expect(NO_SECURE_WINDOW.setSecureWindow(true)).resolves.toBeUndefined();
  });
});

describe('which port the flag is set through — #1755', () => {
  /** The mobile module as `main.tsx` loads it, with only the plugin scripted. */
  function shell() {
    const calls: string[] = [];
    let loads = 0;
    let made = 0;
    const plugin: SecureWindowPlugin = {
      secure: async () => {
        calls.push('secure');
        return Promise.resolve();
      },
      clear: async () => {
        calls.push('clear');
        return Promise.resolve();
      },
    };
    const mobile: ShellSecureWindowModule = {
      capacitorSecureWindowPlugin: () => {
        made += 1;
        return plugin;
      },
      setCapacitorSecureWindow,
    };
    return {
      calls,
      loads: () => loads,
      made: () => made,
      load: async () => {
        loads += 1;
        return Promise.resolve(mobile);
      },
    };
  }
  const always: Foreground = { inForeground: () => true, onForeground: () => () => undefined };

  it('loads nothing and makes no plugin in the iOS app, and a picture sets no flag', async () => {
    const mobile = shell();
    const port = await shellSecureWindowPort(
      { isNativePlatform: () => true, getPlatform: () => 'ios' },
      mobile.load,
    );
    expect(port).toBe(NO_SECURE_WINDOW);
    // Read back through the flag's owner, as the camera and a ride's snapshots hold it.
    const owner = new SecureWindow(port, always);
    const giveBack = owner.hold();
    await flush();
    giveBack();
    await flush();
    expect(mobile.calls).toEqual([]);
    expect(mobile.loads()).toBe(0);
    expect(mobile.made()).toBe(0);
  });

  it.each([
    ['a browser', undefined],
    ['a native shell naming no known platform', { isNativePlatform: () => true }],
  ])('loads nothing in %s', async (_name, capacitor) => {
    const mobile = shell();
    expect(await shellSecureWindowPort(capacitor, mobile.load)).toBe(NO_SECURE_WINDOW);
    expect(mobile.loads()).toBe(0);
  });

  it('sets and clears FLAG_SECURE through the plugin in the Android shell', async () => {
    const mobile = shell();
    const port = await shellSecureWindowPort(
      { isNativePlatform: () => true, getPlatform: () => 'android' },
      mobile.load,
    );
    const owner = new SecureWindow(port, always);
    const giveBack = owner.hold();
    await flush();
    giveBack();
    await flush();
    expect(mobile.calls).toEqual(['secure', 'clear']);
    expect(mobile.made()).toBe(1);
  });
});
