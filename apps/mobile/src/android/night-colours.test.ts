// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Android shell is the page's colour before the page paints, in both
 * palettes (#672 part b).
 *
 * `res/values/colors.xml` and `res/values-night/colors.xml` each declare
 * `oyl_canvas`, and this holds each equal to the web client's own canvas
 * token for that palette — imported from `apps/web`, not copied, so the two
 * cannot drift. And it holds the themes and `MainActivity` to actually USE
 * it, because a colour declared and read by nothing is a resource that
 * passes this file and changes nothing on the screen.
 *
 * ⚠️ **The import crosses from one app into another, and that is permitted.**
 * `eslint.config.js`' `boundaries/dependencies` lets an app import an app (it
 * forbids only a package importing one), and a relative path is the one
 * spelling available: `@onyourleft/web` already depends on
 * `@onyourleft/mobile`, so declaring the reverse would make the workspace a
 * cycle. It is a test importing a table of constants, and nothing the shell
 * ships.
 *
 * ⚠️ **What this does not prove**: that the tablet shows no wrong-coloured
 * frame. The resources resolve per palette in a built APK (read with
 * `aapt2 dump resources` on 2026-09-28), but a cold start in a dark room is
 * the owner's check, recorded in #672's pull request.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { COLOUR_TOKENS, DARK_COLOUR_TOKENS } from '../../../web/src/design/tokens';

import { styleItems, valueResources } from './resources';

const MAIN = join(import.meta.dirname, '../../android/app/src/main');
const read = (path: string): string => readFileSync(join(MAIN, path), 'utf8');

const lightColours = valueResources(read('res/values/colors.xml'), 'color');
const nightColours = valueResources(read('res/values-night/colors.xml'), 'color');
const lightDrawables = valueResources(read('res/values/colors.xml'), 'drawable');
const nightDrawables = valueResources(read('res/values-night/colors.xml'), 'drawable');
const styles = read('res/values/styles.xml');

describe('the shell before the page paints is the page’s canvas — #672', () => {
  it('is the light canvas token in the light palette', () => {
    expect(lightColours.get('oyl_canvas')?.toLowerCase()).toBe(COLOUR_TOKENS.canvas);
  });

  it('is the dark canvas token in the device’s dark mode', () => {
    expect(nightColours.get('oyl_canvas')?.toLowerCase()).toBe(DARK_COLOUR_TOKENS.canvas);
  });

  it('declares nothing in the night file the light file does not', () => {
    // A night-only name would be a resource the light palette cannot build.
    for (const name of nightColours.keys()) expect(lightColours.has(name), name).toBe(true);
    for (const name of nightDrawables.keys()) expect(lightDrawables.has(name), name).toBe(true);
  });

  it('paints the system splash screen with it (Android 12 and later)', () => {
    expect(
      styleItems(styles, 'AppTheme.NoActionBarLaunch')?.get('windowSplashScreenBackground'),
    ).toBe('@color/oyl_canvas');
  });

  it('paints the launch window with the canvas in dark mode, and the splash picture in light (Android 7 to 11)', () => {
    expect(styleItems(styles, 'AppTheme.NoActionBarLaunch')?.get('android:background')).toBe(
      '@drawable/oyl_launch_background',
    );
    expect(nightDrawables.get('oyl_launch_background')).toBe('@color/oyl_canvas');
    expect(lightDrawables.get('oyl_launch_background')).toBe('@drawable/splash');
  });

  it('paints the window behind the WebView with it', () => {
    expect(styleItems(styles, 'AppTheme.NoActionBar')?.get('android:windowBackground')).toBe(
      '@color/oyl_canvas',
    );
  });

  it('paints the WebView’s own background with it, after the bridge exists', () => {
    const activity = read('java/dev/openzigs/onyourleft/MainActivity.java');
    const created = activity.indexOf('super.onCreate(savedInstanceState);');
    const fetched = activity.indexOf('Bridge bridge = getBridge();');
    const guarded = activity.indexOf('if (bridge != null && bridge.getWebView() != null) {');
    const painted = activity.indexOf(
      'bridge.getWebView().setBackgroundColor(ContextCompat.getColor(this, R.color.oyl_canvas));',
    );
    expect(created).toBeGreaterThan(0);
    // After: the bridge, and with it the WebView, is built inside onCreate.
    expect(fetched).toBeGreaterThan(created);
    // Guarded: on Capacitor's no_webview path onCreate returns before load(), so there is no
    // bridge, and an unguarded call crashes the one screen that tells a rider to install a WebView.
    expect(guarded).toBeGreaterThan(fetched);
    expect(painted).toBeGreaterThan(guarded);
    // Nothing reaches the WebView through getBridge() unguarded.
    expect(activity).not.toMatch(/getBridge\(\)\s*\.\s*getWebView\(\)/);
  });
});

describe('the values reader', () => {
  it('reads a value, trimmed, and ignores one inside a comment', () => {
    const xml =
      '<resources><!-- <color name="a">#000000</color> --><color name="a"> #121816 </color></resources>';
    expect(valueResources(xml, 'color')).toEqual(new Map([['a', '#121816']]));
  });

  it('refuses a name declared twice, which aapt would refuse too', () => {
    const xml =
      '<resources><color name="a">#ffffff</color><color name="a">#121816</color></resources>';
    expect(() => valueResources(xml, 'color')).toThrow(/declared twice/);
  });

  it('reads one style’s items and not its neighbour’s', () => {
    const xml =
      '<resources><style name="A.B" parent="X"><item name="k">1</item></style>' +
      '<style name="A"><item name="k">2</item></style></resources>';
    expect(styleItems(xml, 'A.B')).toEqual(new Map([['k', '1']]));
    expect(styleItems(xml, 'A')).toEqual(new Map([['k', '2']]));
    expect(styleItems(xml, 'C')).toBeUndefined();
  });
});
