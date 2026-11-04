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

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import config from '../../capacitor.config';

import { withoutComments } from './manifest';
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
      // #2127: no exit fade of the plugin's own; see "leaves the splash in the
      // system's window" below.
      launchFadeOutDuration: 0,
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

/**
 * #2127: every launcher tap, cold or warm, shows the branded splash, with
 * the logo, and never a black or logo-less frame.
 *
 * On the tablet (Android 17) a cold start was right, but a warm one (process
 * alive, activity finished with Back) showed a near-black frame with no logo
 * for about 0.3 s, then the logo fading over a dimmed Home. Four causes are
 * removed here, each read from the file that ships it:
 *
 * 1. **The splash was copied into the app's own window.** A non-zero
 *    `launchFadeOutDuration` makes the plugin register an exit-animation
 *    listener, and with one registered Android hands its splash view to the
 *    app to animate. That view lives in the app's window, whose drawing the
 *    hold itself cancels, so it can be shown before its icon is: the
 *    logo-less frame, then the logo fading over Home. With none, the splash
 *    stays in the system's own window until Home has drawn.
 * 2. **The logo was a dangling reference.** core-splashscreen 1.2.0's
 *    API 31 `Theme.SplashScreen` sets the platform's icon to
 *    `?windowSplashScreenAnimatedIcon` and gives that attribute no value, so
 *    the system had to guess. Below 31 its default is Android's generic
 *    robot icon, not ours.
 * 3. **The app window was the platform's colour, not the canvas.**
 *    AppCompat reads `android:windowBackground` inside `super.onCreate`,
 *    while the activity still wears the launch theme (BridgeActivity
 *    switches theme after it). On API 31+ the launch theme left it at
 *    `Theme.DeviceDefault.DayNight`'s, near-black in the device's dark mode.
 *    The `android:background` item that was meant to paint it paints views,
 *    not windows.
 * 4. **Below API 31 the compat splash read the wrong theme.** The plugin
 *    installs the splash from `load()`, after BridgeActivity's `setTheme`, so
 *    the compat library reads its colour and logo from `AppTheme.NoActionBar`,
 *    which had neither.
 *
 * ⚠️ CI builds no Android: this proves what ships, not what the tablet
 * draws. The premises in 1, 2 and 4 that live in installed code are read
 * from it; core-splashscreen and AppCompat are Gradle artefacts this suite
 * cannot read, so 2's and 3's are the PR's record (javap of the cached
 * 1.2.0 and 1.7.1 jars) and the owner's device check.
 */
describe('every launch shows the branded splash, cold or warm (#2127)', () => {
  const RES = join(MOBILE, 'android/app/src/main/res');
  const styles = read(join(RES, 'values/styles.xml'));
  const launch = styleItems(styles, 'AppTheme.NoActionBarLaunch');
  const app = styleItems(styles, 'AppTheme.NoActionBar');
  const splash = read(join(PLUGIN_JAVA, 'SplashScreen.java'));
  const bridge = read(
    join(
      dirname(require.resolve('@capacitor/android/package.json')),
      'capacitor/src/main/java/com/getcapacitor/BridgeActivity.java',
    ),
  );

  /** Each `<item …>` of a layer-list drawable, as its attribute text. */
  function layers(file: string): string[] {
    return [...withoutComments(read(join(RES, file))).matchAll(/<item\b([^>]*)>/g)].map(
      (match) => match[1] ?? '',
    );
  }

  it('leaves the splash in the system’s window: no exit listener, so it is never copied into the app’s', () => {
    expect(config.plugins.SplashScreen.launchFadeOutDuration).toBe(0);
    // The premise: 8.0.2 registers its exit listener only for a positive fade,
    // and nowhere else.
    const hold = methodBody(splash, 'private void showWithAndroid12API(');
    expect(splash.match(/setOnExitAnimationListener\(/g)).toHaveLength(1);
    expect(hold).toMatch(
      /if \(config\.getLaunchFadeOutDuration\(\) > 0\) \{\s*(\/\/[^\n]*\n\s*)*windowSplashScreen\.setOnExitAnimationListener\(/,
    );
  });

  it('names the logo for the system splash, rather than leaving the library’s dangling reference', () => {
    expect(launch?.get('windowSplashScreenAnimatedIcon')).toBe('@mipmap/ic_launcher');
    // The launcher icon itself: an adaptive icon from API 26, a picture at
    // every density below it, so the reference resolves on every API level.
    expect(read(join(RES, 'mipmap-anydpi-v26/ic_launcher.xml'))).toContain('<adaptive-icon');
    for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
      expect(existsSync(join(RES, `mipmap-${density}/ic_launcher.png`)), density).toBe(true);
    }
  });

  it('asks for the icon even where Android would otherwise show a plain colour (API 33+)', () => {
    expect(launch?.get('android:windowSplashScreenBehavior')).toBe('icon_preferred');
  });

  it('paints the app window with the branded launch window, not the platform’s default', () => {
    expect(launch?.get('android:windowBackground')).toBe('@drawable/oyl_launch_window');
    // A view attribute in a theme paints every view without a background of
    // its own, and no window.
    expect(launch?.has('android:background')).toBe(false);
    for (const file of ['drawable/oyl_launch_window.xml', 'drawable-v31/oyl_launch_window.xml']) {
      const [canvas, ...rest] = layers(file);
      expect(canvas, file).toMatch(/android:drawable="@drawable\/oyl_launch_background"/);
      const logo = rest.find((layer) => layer.includes('android:drawable="@mipmap/ic_launcher"'));
      expect(logo, file).toMatch(/android:gravity="center"/);
    }
    // The premise: AppCompat's window set-up runs in super.onCreate, BEFORE
    // BridgeActivity switches the theme, so the launch theme is the one read.
    const created = bridge.indexOf('super.onCreate(savedInstanceState);');
    const switched = bridge.indexOf('setTheme(R.style.AppTheme_NoActionBar);');
    expect(created).toBeGreaterThan(0);
    expect(switched).toBeGreaterThan(created);
  });

  it('gives the compat splash (API 24 to 30) its colour and logo in the theme it reads them from', () => {
    expect(app?.get('windowSplashScreenBackground')).toBe('@color/oyl_canvas');
    // The launcher icon, inset to the circle the compat library masks it to.
    expect(app?.get('windowSplashScreenAnimatedIcon')).toBe('@drawable/oyl_splash_icon_compat');
    expect(withoutComments(read(join(RES, 'drawable/oyl_splash_icon_compat.xml')))).toMatch(
      /<inset[^>]*android:drawable="@mipmap\/ic_launcher"[^>]*android:inset="48dp"/,
    );
    // The premise: the splash is installed from the plugin's load(), which
    // BridgeActivity reaches only after its own setTheme.
    const switched = bridge.indexOf('setTheme(R.style.AppTheme_NoActionBar);');
    const loaded = bridge.indexOf('this.load();');
    expect(loaded).toBeGreaterThan(switched);
    expect(read(join(PLUGIN_JAVA, 'SplashScreenPlugin.java'))).toMatch(
      /public void load\(\) \{[\s\S]*?splashScreen\.showOnLaunch\(getActivity\(\)\)/,
    );
  });
});
