// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #87's first acceptance criterion, and the honest boundary of it.
 *
 * The criterion asks that `ACCESS_FINE_LOCATION` carry `maxSdkVersion="30"` and
 * `BLUETOOTH_SCAN` carry `neverForLocation` **in the merged manifest**, because
 * *"the plugin's manifest is what makes this fail silently"*.
 *
 * ⚠️ **These tests do NOT read a merged manifest, and they must not be read as
 * though they did.** The merge is `:app:processDebugManifest`, performed by the
 * Android Gradle Plugin, which needs an Android SDK that could not be installed
 * in the environment this was written in (`apps/mobile/README.md` §4). Asserting
 * against the app's own manifest and calling the criterion met is precisely the
 * false pass the criterion exists to prevent, so it is reported undischarged.
 *
 * What these tests *can* establish is everything the merge is a function of:
 *
 * 1. **the plugin still declares the problem** — asserted against the real file
 *    in `node_modules`, so an upgrade that fixes it upstream turns this red and
 *    somebody re-reads whether the override is still needed;
 * 2. **the app declares the fix**, with the `tools:replace` that makes the
 *    merger take this file's value rather than reporting a conflict;
 * 3. **every permission the plugin gets wrong is covered** — derived from the
 *    plugin's manifest rather than from a list typed out here, so a permission
 *    the plugin adds in a later version fails this suite instead of shipping.
 *
 * (3) is the one worth having. A hand-written list of "the two the issue named"
 * would pass forever while the plugin grew a third.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { permission, services, usesPermissions } from './manifest';

const HERE = dirname(fileURLToPath(import.meta.url));

const APP_MANIFEST = readFileSync(
  join(HERE, '..', '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
  'utf8',
);

const PLUGIN_MANIFEST = readFileSync(
  join(
    dirname(
      createRequire(import.meta.url).resolve('@capacitor-community/bluetooth-le/package.json'),
    ),
    'android',
    'src',
    'main',
    'AndroidManifest.xml',
  ),
  'utf8',
);

/** A permission the merge would get wrong if the app said nothing about it. */
const unconstrainedByThePlugin = usesPermissions(PLUGIN_MANIFEST).filter(
  (one) =>
    (one.name.endsWith('_LOCATION') && one.maxSdkVersion === null) ||
    (one.name.endsWith('BLUETOOTH_SCAN') && one.flags === null),
);

describe('the plugin still declares the problem this override exists for', () => {
  it('requests location on every Android version', () => {
    // If this goes red because the plugin fixed it, that is good news and the
    // override may be removable -- but it is a decision, not a cleanup, because
    // removing tools:replace while any dependency still declares it unbounded
    // puts the app straight back into Google Play's location-policy review.
    expect(permission(PLUGIN_MANIFEST, 'ACCESS_FINE_LOCATION')?.maxSdkVersion).toBeNull();
  });

  it('declares BLUETOOTH_SCAN without neverForLocation', () => {
    expect(permission(PLUGIN_MANIFEST, 'BLUETOOTH_SCAN')?.flags).toBeNull();
  });

  it('gets THREE permissions wrong, not the two #87 names', () => {
    // ACCESS_COARSE_LOCATION is unbounded too, and the issue body does not
    // mention it. Leaving the third unconstrained would defeat the point of
    // constraining the other two.
    expect(unconstrainedByThePlugin.map((one) => one.name).sort()).toEqual([
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.BLUETOOTH_SCAN',
    ]);
  });
});

describe('the app overrides every one of them', () => {
  it.each(unconstrainedByThePlugin.map((one) => one.name))(
    'constrains %s with an explicit tools:replace',
    (name) => {
      const ours = usesPermissions(APP_MANIFEST).find((one) => one.name === name);
      expect(ours, `${name} is unconstrained in the plugin and absent from the app`).toBeDefined();
      // tools:replace is what makes the merger take this file's value. Without
      // it the outcome depends on merger behaviour that is not worth
      // reproducing from memory.
      expect(ours?.replaces).not.toBeNull();
    },
  );

  it('bounds both location permissions at API 30', () => {
    expect(permission(APP_MANIFEST, 'ACCESS_FINE_LOCATION')?.maxSdkVersion).toBe(30);
    expect(permission(APP_MANIFEST, 'ACCESS_COARSE_LOCATION')?.maxSdkVersion).toBe(30);
  });

  it('declares BLUETOOTH_SCAN neverForLocation', () => {
    expect(permission(APP_MANIFEST, 'BLUETOOTH_SCAN')?.flags).toBe('neverForLocation');
    expect(permission(APP_MANIFEST, 'BLUETOOTH_SCAN')?.replaces).toBe(
      'android:usesPermissionFlags',
    );
  });
});

describe('the foreground service permissions and declaration', () => {
  it.each([
    'BLUETOOTH_CONNECT',
    'FOREGROUND_SERVICE',
    'FOREGROUND_SERVICE_CONNECTED_DEVICE',
    'POST_NOTIFICATIONS',
  ])('declares %s', (name) => {
    expect(permission(APP_MANIFEST, name)).toBeDefined();
  });

  it('declares the service with the connectedDevice type', () => {
    // Mandatory since Android 14 (API 34), not 15: a missing type throws
    // MissingForegroundServiceTypeException and a missing
    // FOREGROUND_SERVICE_CONNECTED_DEVICE throws SecurityException.
    const service = services(APP_MANIFEST).find((one) => one.name === '.RecordingService');
    expect(service?.foregroundServiceType).toBe('connectedDevice');
  });

  it('does not export the service', () => {
    const service = services(APP_MANIFEST).find((one) => one.name === '.RecordingService');
    expect(service?.exported).toBe('false');
  });
});

describe('what the app does NOT ask for', () => {
  it('declares no permission outside the set #87 allows, plus INTERNET', () => {
    // A permission creeping in is the thing nobody notices in a diff, and it is
    // the one that costs a store review.
    const allowed = new Set([
      'android.permission.INTERNET',
      'android.permission.BLUETOOTH_SCAN',
      'android.permission.BLUETOOTH_CONNECT',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE',
      'android.permission.POST_NOTIFICATIONS',
    ]);
    for (const one of usesPermissions(APP_MANIFEST)) {
      expect(allowed, `${one.name} is not in #87's permission set`).toContain(one.name);
    }
  });

  it('never names BLUETOOTH_BACKGROUND, which does not exist', () => {
    // #87 records this as a widely-circulated blog claim that is simply wrong.
    // The complete set is BLUETOOTH, BLUETOOTH_ADMIN, BLUETOOTH_ADVERTISE,
    // BLUETOOTH_CONNECT, BLUETOOTH_PRIVILEGED and BLUETOOTH_SCAN.
    expect(APP_MANIFEST).not.toContain('BLUETOOTH_BACKGROUND');
  });
});
