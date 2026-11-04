// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Every plugin in the app's own source tree is registered, and early enough —
 * #247.
 *
 * Capacitor discovers a plugin that ships as a package on its own. A plugin in
 * the application's source tree has to be registered by hand in `MainActivity`,
 * **before** `super.onCreate`. If it is missing, or registered after, there is
 * no build error and no crash: the web layer gets "plugin not implemented" the
 * first time it asks. For `ThermalPlugin` that reads as "no forecast", which is
 * indistinguishable from a device below API 30, so a ride would never show that
 * anything was wrong.
 *
 * CI does not build Android and the Java here is uncompiled, so this reads the
 * source. It proves the registration is written, not that it runs.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SOURCE = join(import.meta.dirname, '../../android/app/src/main/java/dev/openzigs/onyourleft');

/** Every class in the source tree annotated as a Capacitor plugin. */
function pluginClasses(): string[] {
  return readdirSync(SOURCE)
    .filter((file) => file.endsWith('.java'))
    .filter((file) => readFileSync(join(SOURCE, file), 'utf8').includes('@CapacitorPlugin('))
    .map((file) => file.replace(/\.java$/, ''));
}

describe('MainActivity registers every in-tree plugin before the bridge is built (#247)', () => {
  const activity = readFileSync(join(SOURCE, 'MainActivity.java'), 'utf8');
  const bridgeBuilt = activity.indexOf('super.onCreate(');

  it('finds the plugins it is checking', () => {
    // Non-vacuity: a moved directory would leave the loop below checking nothing.
    expect(pluginClasses()).toEqual(
      expect.arrayContaining(['RecordingServicePlugin', 'ThermalPlugin', 'SecureWindowPlugin']),
    );
    expect(bridgeBuilt).toBeGreaterThan(0);
  });

  it.each(pluginClasses())('registers %s before super.onCreate', (plugin) => {
    const registered = activity.indexOf(`registerPlugin(${plugin}.class)`);
    expect(registered).toBeGreaterThan(0);
    expect(registered).toBeLessThan(bridgeBuilt);
  });
});

/**
 * Every plugin that ships as a package reaches the Android build — #2050.
 *
 * Capacitor discovers a packaged plugin on its own, but only through the two
 * Gradle files `cap update` writes and this repository commits: a package
 * added to the manifest without regenerating them builds an APK with no native
 * half, and the web layer gets "plugin not implemented". `check:capacitor`
 * holds the files to the generator; this holds them to the manifest, and the
 * reviewed native licence list to both. The set is derived from the manifest
 * (a dependency whose own manifest declares `capacitor.android`), not written
 * down.
 */
describe('every packaged plugin is in the Android build and the licence review (#2050)', () => {
  const MOBILE = join(import.meta.dirname, '../..');
  const read = (path: string) => readFileSync(join(MOBILE, path), 'utf8');
  const dependencies = Object.keys(
    (JSON.parse(read('package.json')) as { dependencies: Record<string, string> }).dependencies,
  );
  // Read through this package's own `node_modules` link rather than resolved:
  // a workspace package's `exports` does not export its manifest.
  const packaged = dependencies.filter((name) => {
    const manifest = JSON.parse(read(`node_modules/${name}/package.json`)) as {
      capacitor?: { android?: unknown };
    };
    return manifest.capacitor?.android !== undefined;
  });
  const settings = read('android/capacitor.settings.gradle');
  const build = read('android/app/capacitor.build.gradle');
  const reviewed = (
    JSON.parse(read('native-closure.json')) as {
      projects: { project: string; package: string | null }[];
    }
  ).projects;

  it('finds the plugins it is checking', () => {
    // Non-vacuity, and the two this app installs today.
    expect(packaged).toEqual(
      expect.arrayContaining(['@capacitor-community/bluetooth-le', '@capacitor/splash-screen']),
    );
  });

  it.each(packaged)('includes %s as a Gradle project, depends on it and reviews it', (name) => {
    const project = `:${name.replace(/^@/, '').replace('/', '-')}`;
    expect(settings).toContain(`include '${project}'`);
    expect(build).toContain(`implementation project('${project}')`);
    expect(reviewed).toContainEqual(expect.objectContaining({ project, package: name }));
  });
});
