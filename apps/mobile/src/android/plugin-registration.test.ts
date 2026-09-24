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
      expect.arrayContaining(['RecordingServicePlugin', 'ThermalPlugin']),
    );
    expect(bridgeBuilt).toBeGreaterThan(0);
  });

  it.each(pluginClasses())('registers %s before super.onCreate', (plugin) => {
    const registered = activity.indexOf(`registerPlugin(${plugin}.class)`);
    expect(registered).toBeGreaterThan(0);
    expect(registered).toBeLessThan(bridgeBuilt);
  });
});
