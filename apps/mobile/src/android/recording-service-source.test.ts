// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The foreground service's three guards are written — #524.
 *
 * CI does not build Android and the Java is uncompiled, so this reads the
 * source, the way `plugin-registration.test.ts` does. It proves each guard is
 * there, not that it works: validation 0002 A5 and Part C are where it runs.
 * Each assertion is one a careless edit would delete, and each deletion is a
 * crash or a service that cannot be stopped from the background.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SOURCE = join(import.meta.dirname, '../../android/app/src/main/java/dev/openzigs/onyourleft');
const plugin = readFileSync(join(SOURCE, 'RecordingServicePlugin.java'), 'utf8');
const service = readFileSync(join(SOURCE, 'RecordingService.java'), 'utf8');

describe('the recording service cannot take the app down (#524)', () => {
  it('checks the Bluetooth permission before it starts the service on API 34+', () => {
    const check = plugin.indexOf('Manifest.permission.BLUETOOTH_CONNECT');
    const start = plugin.indexOf('RecordingService.start(getContext())');
    expect(check).toBeGreaterThan(0);
    expect(plugin).toMatch(/SDK_INT >= 34/);
    expect(start).toBeGreaterThan(check);
  });

  it('rejects, rather than throws, when Android refuses the start', () => {
    expect(plugin).toMatch(/catch \(IllegalStateException refused\)\s*\{[^}]*call\.reject/);
  });

  it('catches a refused startForeground inside the service and stops itself', () => {
    expect(service).toMatch(
      /catch \(SecurityException \| IllegalStateException refused\)\s*\{[^}]*stopSelf\(\)/,
    );
  });

  it('stops with stopService, which the background start limits do not refuse', () => {
    const stopHelper = service.slice(service.indexOf('public static void stop('));
    expect(stopHelper).toMatch(/context\.stopService\(/);
    expect(stopHelper.slice(0, stopHelper.indexOf('}'))).not.toMatch(/startService\(/);
  });
});
