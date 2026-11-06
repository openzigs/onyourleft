// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Android 12+ splash shows the app's mark composed for the splash, on the
 * page's canvas, in both device modes — #2052.
 *
 * Read the way `aapt` resolves the launch theme on a device in each mode: the
 * style from the most specific `values*` directory that declares it, each
 * `@color/` and `@drawable/` alias from the most specific directory that
 * declares that name (`values-night` before `values` in dark mode), and a
 * drawable's picture from `drawable-night-<density>` before
 * `drawable-<density>`. So a theme that names a drawable no directory holds,
 * or a canvas that is not the page's, is red here in the mode it breaks.
 *
 * The art itself is the brand pipeline's (`derive_brand.py`, kind `splash`),
 * and `apps/web/tools/brand/provenance.test.ts` holds its mark inside the
 * 192 dp circle the system shows and its corners transparent, so the canvas is
 * all that is behind it.
 *
 * ⚠️ CI builds no Android: this proves what the theme names resolves to a
 * picture of the right size on the right colour in each mode, not that the
 * tablet draws it centred and uncropped. That is the owner's device check on
 * #2052's pull request.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_THEME_CHOICE, resolveTheme } from '../../../web/src/design/theme-selection';
import { paletteColours } from '../../../web/src/design/tokens';

import { styleItems, valueResources } from './resources';

const RES = join(import.meta.dirname, '../../android/app/src/main/res');
const LAUNCH = 'AppTheme.NoActionBarLaunch';
/** The density buckets a bitmap is shipped at, and each one's scale from dp to px. */
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 } as const;
/** The system splash's icon without an icon background: 288 dp square (developer.android.com, read 2026-11-03). */
const SPLASH_ICON_DP = 288;

interface DeviceMode {
  readonly mode: 'light' | 'dark';
  readonly devicePrefersDark: boolean;
  /** Resource qualifiers, most specific first, as Android picks among them. */
  readonly qualifiers: readonly string[];
}

const MODES: readonly DeviceMode[] = [
  { mode: 'light', devicePrefersDark: false, qualifiers: [''] },
  { mode: 'dark', devicePrefersDark: true, qualifiers: ['-night', ''] },
];

const read = (path: string): string => readFileSync(join(RES, path), 'utf8');

/** Every `<element name="…">` in one `values*` directory, across its files. */
function declared(directory: string, element: string): ReadonlyMap<string, string> {
  if (!existsSync(join(RES, directory))) return new Map();
  const merged = new Map<string, string>();
  for (const file of readdirSync(join(RES, directory)).filter((name) => name.endsWith('.xml'))) {
    for (const [name, value] of valueResources(read(join(directory, file)), element)) {
      merged.set(name, value);
    }
  }
  return merged;
}

/** The launch theme's item, from the most specific `styles.xml` that declares the theme. */
function themeItem(device: DeviceMode, item: string): string | undefined {
  for (const qualifier of device.qualifiers) {
    const path = `values${qualifier}/styles.xml`;
    if (!existsSync(join(RES, path))) continue;
    const items = styleItems(read(path), LAUNCH);
    if (items !== undefined) return items.get(item);
  }
  return undefined;
}

/** A `@type/name` value, followed through aliases to the value at the end. */
function alias(device: DeviceMode, reference: string, element: string): string | undefined {
  const name = new RegExp(`^@${element}/(\\w+)$`).exec(reference)?.[1];
  if (name === undefined) return undefined;
  for (const qualifier of device.qualifiers) {
    const value = declared(`values${qualifier}`, element).get(name);
    if (value !== undefined) return value;
  }
  return undefined;
}

function colour(device: DeviceMode, reference: string): string | undefined {
  const value = alias(device, reference, 'color');
  return value?.startsWith('@color/') ? colour(device, value) : value;
}

/**
 * The picture a `@drawable/` reference draws at each density, following
 * `<drawable>` aliases first: the path of the file Android would load, or
 * `undefined` for a density nothing covers.
 */
function pictures(
  device: DeviceMode,
  reference: string,
): Readonly<Record<keyof typeof DENSITIES, string | undefined>> {
  const value = alias(device, reference, 'drawable');
  if (value?.startsWith('@drawable/') === true) return pictures(device, value);
  const name = /^@drawable\/(\w+)$/.exec(reference)?.[1] ?? '';
  const find = (density: string): string | undefined => {
    for (const qualifier of device.qualifiers) {
      for (const directory of [`drawable${qualifier}-${density}`, `drawable${qualifier}`]) {
        for (const extension of ['png', 'webp', 'xml']) {
          const path = `${directory}/${name}.${extension}`;
          if (existsSync(join(RES, path))) return path;
        }
      }
    }
    return undefined;
  };
  return {
    mdpi: find('mdpi'),
    hdpi: find('hdpi'),
    xhdpi: find('xhdpi'),
    xxhdpi: find('xxhdpi'),
    xxxhdpi: find('xxxhdpi'),
  };
}

/** A PNG's width and height, from its IHDR chunk. */
function pngSize(path: string): readonly [number, number] {
  const bytes = readFileSync(join(RES, path));
  expect(bytes.subarray(12, 16).toString('latin1'), path).toBe('IHDR');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

describe.each(MODES)('the Android 12+ splash on a device in $mode mode — #2052', (device) => {
  it('is drawn on the canvas the page starts in', () => {
    const background = themeItem(device, 'windowSplashScreenBackground') ?? '';
    expect(colour(device, background)?.toLowerCase()).toBe(
      paletteColours(resolveTheme(DEFAULT_THEME_CHOICE, device.devicePrefersDark)).canvas,
    );
  });

  it('puts no second colour behind the mark: the canvas is the icon’s background', () => {
    expect(themeItem(device, 'windowSplashScreenIconBackgroundColor')).toBeUndefined();
  });

  it('names a splash icon that resolves to a picture at every density', () => {
    const icon = themeItem(device, 'windowSplashScreenAnimatedIcon') ?? '';
    // The mark composed for the splash, not the launcher icon on its blue tile.
    expect(icon).toBe('@drawable/oyl_splash_icon');
    const found = pictures(device, icon);
    for (const [density, path] of Object.entries(found)) {
      expect(path, `${density} has no picture for ${icon}`).toBeDefined();
    }
  });

  it('draws it at the 288 dp the system gives an icon with no background', () => {
    const found = pictures(device, themeItem(device, 'windowSplashScreenAnimatedIcon') ?? '');
    for (const [density, scale] of Object.entries(DENSITIES)) {
      const path = found[density as keyof typeof DENSITIES] ?? '';
      expect(path, density).toMatch(/\.png$/);
      expect(pngSize(path), path).toEqual([SPLASH_ICON_DP * scale, SPLASH_ICON_DP * scale]);
    }
  });
});

describe('the splash icon is named per palette, as the canvas is — #2052', () => {
  it('is declared in both values files, so either mode can point elsewhere', () => {
    for (const directory of ['values', 'values-night']) {
      expect(declared(directory, 'drawable').get('oyl_splash_icon'), directory).toBe(
        '@drawable/oyl_splash_mark',
      );
    }
  });

  it('would find no picture for a name no directory holds (the reader’s control)', () => {
    const [light] = MODES;
    if (light === undefined) throw new Error('no light mode');
    expect(Object.values(pictures(light, '@drawable/oyl_no_such_picture'))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});
