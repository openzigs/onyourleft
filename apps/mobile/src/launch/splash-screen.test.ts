// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The page's release of the launch splash, on the Android side — #2051.
 *
 * Against a scripted plugin: the page asks once, with no options (8.0.2
 * ignores `fadeOutDuration` on the Android 12 path and warns when it is
 * given), and a refusal is swallowed. The plugin is registered under the name
 * its installed Java declares.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const registered = vi.hoisted(() => [] as string[]);
vi.mock('@capacitor/core', () => ({
  registerPlugin: (name: string) => {
    registered.push(name);
    return { hide: () => Promise.resolve() };
  },
}));

import {
  capacitorSplashScreenPlugin,
  hideCapacitorSplashScreen,
  type LaunchSplashPlugin,
} from './splash-screen';

describe('releasing the launch splash (#2051)', () => {
  it('asks the plugin once, with no options', async () => {
    const hide = vi.fn<LaunchSplashPlugin['hide']>(() => Promise.resolve());
    await hideCapacitorSplashScreen({ hide });
    expect(hide).toHaveBeenCalledTimes(1);
    expect(hide).toHaveBeenCalledWith();
  });

  it('resolves when the plugin refuses, because the launch timeout releases it anyway', async () => {
    const hide = vi.fn<LaunchSplashPlugin['hide']>(() =>
      Promise.reject(new Error('"SplashScreen" plugin is not implemented on android')),
    );
    await expect(hideCapacitorSplashScreen({ hide })).resolves.toBeUndefined();
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('registers the plugin under the name its installed Java declares, and only when asked', () => {
    expect(registered).toEqual([]);
    capacitorSplashScreenPlugin();
    expect(registered).toEqual(['SplashScreen']);
    const java = readFileSync(
      join(
        dirname(createRequire(import.meta.url).resolve('@capacitor/splash-screen/package.json')),
        'android/src/main/java/com/capacitorjs/plugins/splashscreen/SplashScreenPlugin.java',
      ),
      'utf8',
    );
    expect(java).toContain(`@CapacitorPlugin(name = "${registered[0] ?? ''}")`);
  });
});
