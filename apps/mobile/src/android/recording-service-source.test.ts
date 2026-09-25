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

describe('the notification permission is asked through the bridge (#526)', () => {
  it('declares POST_NOTIFICATIONS on the plugin under the alias it asks for', () => {
    expect(plugin).toMatch(
      /@Permission\(\s*strings = \{ Manifest\.permission\.POST_NOTIFICATIONS \},\s*alias = RecordingServicePlugin\.NOTIFICATIONS\s*\)/,
    );
    expect(plugin).toMatch(/static final String NOTIFICATIONS = "notifications";/);
  });

  it('asks through Capacitor, with a permission callback, and never through ActivityCompat', () => {
    const request = plugin.slice(plugin.indexOf('public void requestNotificationPermission('));
    expect(request).toMatch(
      /requestPermissionForAlias\(NOTIFICATIONS, call, "notificationPermissionAnswered"\)/,
    );
    expect(plugin).toMatch(
      /@PermissionCallback\s+private void notificationPermissionAnswered\(PluginCall call\)/,
    );
    expect(plugin).not.toMatch(/ActivityCompat\.requestPermissions/);
  });

  it('asks nothing below API 33, where the permission is granted at install', () => {
    const request = plugin.slice(plugin.indexOf('public void requestNotificationPermission('));
    const guard = request.indexOf('Build.VERSION.SDK_INT < NOTIFICATIONS_ARE_A_RUNTIME_PERMISSION');
    const ask = request.indexOf('requestPermissionForAlias(');
    expect(plugin).toMatch(/NOTIFICATIONS_ARE_A_RUNTIME_PERMISSION = 33;/);
    expect(guard).toBeGreaterThan(0);
    expect(ask).toBeGreaterThan(guard);
    // The guard returns before the ask.
    expect(request.slice(guard, ask)).toMatch(/call\.resolve\(notificationAnswer\(\)\);\s*return;/);
    // And the answer below 33 is granted before Capacitor's state is read.
    const answer = plugin.slice(plugin.indexOf('private JSObject notificationAnswer()'));
    expect(answer).toMatch(
      /SDK_INT < NOTIFICATIONS_ARE_A_RUNTIME_PERMISSION\) \{\s*answer\.put\("state", PermissionState\.GRANTED\.toString\(\)\);\s*return answer;/,
    );
  });
});
