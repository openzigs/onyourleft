// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The launch splash is held until the page has painted, or until a timeout —
 * #2050.
 *
 * The owner chose the official `@capacitor/splash-screen` plugin, pinned to
 * 8.0.2, over calling `installSplashScreen` in `MainActivity` by hand. So what
 * this app writes is configuration (`capacitor.config.ts` and the launch theme
 * in `styles.xml`), and what the hold depends on is the plugin's own Java. Both
 * halves are read here:
 *
 * 1. **The configuration**: a timeout, and the auto-hide that makes the plugin
 *    apply it, and the theme the window takes when the splash lets go.
 * 2. **The installed plugin**, because the configuration means what this file
 *    says only while the plugin works the way 8.0.2 does: the keep-on-screen
 *    condition is a flag `hide()` clears, and the duration's timer clears the
 *    same flag only when auto-hide is on. A bump that moved either would turn
 *    the timeout into nothing, and nothing else here would notice.
 *
 * CI does not build Android, so this proves the hold is configured and the
 * plugin is written to honour it, not that a device shows it: whether a cold
 * start on the tablet holds the splash until Home has painted, and whether the
 * hold survives `BridgeActivity`'s own `setTheme`, are owner device checks.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import config from '../../capacitor.config';

import { styleItems } from './resources';

const require = createRequire(import.meta.url);
const PACKAGE = '@capacitor/splash-screen';
const PINNED = '8.0.2';
const PLUGIN = dirname(require.resolve(`${PACKAGE}/package.json`));
const PLUGIN_JAVA = join(PLUGIN, 'android/src/main/java/com/capacitorjs/plugins/splashscreen');
const MOBILE = join(import.meta.dirname, '../..');

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

/** The text of a Java method, from its signature to the next method's. */
function methodBody(java: string, signature: string): string {
  const start = java.indexOf(signature);
  expect(start).toBeGreaterThan(0);
  const next = java.indexOf('\n    p', start + signature.length);
  return java.slice(start, next === -1 ? undefined : next);
}

describe('the launch splash is held until the page is ready or a timeout passes (#2050)', () => {
  it('pins the plugin exactly, and the installed copy is that version', () => {
    const manifest = JSON.parse(read(join(MOBILE, 'package.json'))) as {
      dependencies: Record<string, string>;
    };
    expect(manifest.dependencies[PACKAGE]).toBe(PINNED);
    expect((JSON.parse(read(join(PLUGIN, 'package.json'))) as { version: string }).version).toBe(
      PINNED,
    );
  });

  it('auto-hides at a 3 s timeout, which the page’s own hide() can only shorten', () => {
    expect(config.plugins.SplashScreen).toEqual({
      launchAutoHide: true,
      launchShowDuration: 3000,
    });
  });

  it('hands the window to the app theme when the splash lets go', () => {
    const styles = read(join(MOBILE, 'android/app/src/main/res/values/styles.xml'));
    expect(styleItems(styles, 'AppTheme.NoActionBarLaunch')?.get('postSplashScreenTheme')).toBe(
      '@style/AppTheme.NoActionBar',
    );
    // The theme it names exists, or the hand-over would name nothing.
    expect(styleItems(styles, 'AppTheme.NoActionBar')).toBeDefined();
  });
});

describe('the installed plugin honours that configuration (#2050)', () => {
  const plugin = read(join(PLUGIN_JAVA, 'SplashScreenPlugin.java'));
  const splash = read(join(PLUGIN_JAVA, 'SplashScreen.java'));

  it('reads both keys this app sets, under the names it sets them', () => {
    for (const key of Object.keys(config.plugins.SplashScreen)) {
      expect(plugin).toMatch(new RegExp(`getConfig\\(\\)\\.get(Boolean|Int)\\("${key}"`));
    }
  });

  it('holds the system splash with a keep condition the page’s hide() clears', () => {
    const hold = methodBody(splash, 'private void showWithAndroid12API(');
    expect(hold).toContain('SplashScreen.installSplashScreen(');
    expect(hold).toContain('setKeepOnScreenCondition(() -> isVisible || isHiding)');
    // The page's SplashScreen.hide() reaches this method, and on the Android 12
    // path it clears the flag the condition reads.
    expect(plugin).toMatch(/public void hide\(PluginCall call\)[\s\S]*?splashScreen\.hide\(/);
    const hide = methodBody(splash, 'private void hide(final int fadeOutDuration');
    expect(hide).toMatch(
      /if \(null != this\.onPreDrawListener\) \{[\s\S]*?this\.isVisible = false;/,
    );
  });

  it('clears the same flag at the duration, and only when auto-hide is on', () => {
    const hold = methodBody(splash, 'private void showWithAndroid12API(');
    expect(hold).toMatch(
      /postDelayed\(\(\) -> \{[\s\S]*?if \(settings\.isAutoHide\(\)\) \{\s*isVisible = false;[\s\S]*?\}, settings\.getShowDuration\(\)\)/,
    );
  });
});
