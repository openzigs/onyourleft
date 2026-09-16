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
 * ⚠️ **Since [#318](https://github.com/openzigs/onyourleft/issues/318) that
 * last sentence is only half true, and a reviewer who remembers this file as
 * the whole of criterion 1 is reading the old one.** An Android SDK is
 * available now, `merged-manifest.test.ts` reads the artefact the merge
 * produces, and it is that file — not this one — that discharges the criterion.
 * The division is worth keeping straight: **this file is about the INPUTS to
 * the merge and runs everywhere; that one is about its OUTPUT and skips loudly
 * where Gradle has never run**, which is CI and every clean clone.
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

import {
  components,
  definedPermissions,
  permission,
  queries,
  services,
  startTags,
  UNNAMED,
  usesPermissions,
  withoutComments,
} from './manifest';

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

/* -------------------------------------------------------------------------- *
 * #318: the three shapes a merge injects, read out of synthetic documents.
 *
 * These run everywhere, including on a clean clone and in CI, because they need
 * no Gradle. `merged-manifest.test.ts` points the same readers at the artefact
 * and skips where there is not one; without the cases below, a reader bug would
 * be invisible in exactly the environment where the artefact is missing.
 * -------------------------------------------------------------------------- */

describe('reading the shapes a permission list cannot see', () => {
  it('counts nothing that is only mentioned in a comment', () => {
    // Both manifests in this repository carry long prose comments that quote
    // permission names at each other, and the generated merged manifest
    // reproduces every one of them verbatim.
    const xml = `<manifest>
      <!-- we deliberately do NOT declare
           <uses-permission android:name="android.permission.CAMERA" /> -->
      <uses-permission android:name="android.permission.INTERNET" />
    </manifest>`;
    expect(usesPermissions(xml).map((one) => one.name)).toEqual(['android.permission.INTERNET']);
    expect(withoutComments(xml)).not.toContain('CAMERA');
  });

  it('leaves no comment opener in its own output', () => {
    // CodeQL's js/incomplete-multi-character-sanitization, at high severity, on
    // this issue's own pull request: a single non-greedy replace can leave a
    // `<!--` behind, and a caller that believed the result was comment-free
    // would then read a permission out of prose.
    const xml = '<manifest><!--a--><!--b--><uses-permission android:name="x" /></manifest>';
    expect(withoutComments(xml)).not.toContain('<!--');
    expect(usesPermissions(xml).map((one) => one.name)).toEqual(['x']);
  });

  it('throws on a comment that is never closed', () => {
    // DOC002's failure mode. Leaving it in place makes every scan below report
    // that the rest of the document contains nothing. XML002 forbids this in a
    // committed file and checks no generated one, which is this reader's input.
    expect(() => usesPermissions('<manifest><!-- never closed')).toThrow(/never closed/);
  });

  it('reads an element that has children, not the first child that closes', () => {
    // The trap the whole-element regexes above fall into: a lazy match from
    // `<activity` to the first `/>` stops inside `<action … />`.
    const xml = `<manifest><application>
      <activity android:name=".Main" android:exported="true">
        <intent-filter><action android:name="android.intent.action.MAIN" /></intent-filter>
      </activity>
    </application></manifest>`;
    expect(components(xml)).toEqual([
      { kind: 'activity', name: '.Main', exported: true, permission: null },
    ]);
  });

  it('reports an absent android:exported as unknown rather than as false', () => {
    // The platform's default depends on the target SDK and on whether the
    // component has an intent filter. A reader that guessed would be answering
    // the question the caller asked it.
    const xml = '<manifest><application><service android:name=".S" /></application></manifest>';
    expect(components(xml)[0]?.exported).toBeNull();
  });

  it('keeps the permission that guards an exported component', () => {
    const xml =
      '<manifest><application><receiver android:name="R" android:exported="true" ' +
      'android:permission="android.permission.DUMP" /></application></manifest>';
    expect(components(xml)[0]?.permission).toBe('android.permission.DUMP');
  });

  it('does not end a tag at a greater-than inside an attribute value', () => {
    const xml = '<manifest><application><service android:name="a>b" /></application></manifest>';
    expect(components(xml).map((one) => one.name)).toEqual(['a>b']);
  });

  it('throws on a start tag that is never closed', () => {
    // `DOC002`'s failure mode in XML: a scanner that returns what it found so
    // far reports "no exported components" for a truncated document.
    expect(() => components('<manifest><application><service android:name=".S"')).toThrow(
      /never closed/,
    );
  });

  it('names an unnamed component rather than dropping it from the list', () => {
    // Dropping it is the failure #318 is about, one layer down: an exported
    // component that is absent from the exported list makes "the merge exports
    // nothing new" true by omission. `android:name` is mandatory and AGP
    // rejects a manifest without it, so this is a belt on a brace.
    const xml =
      '<manifest><application><receiver android:exported="true" /></application></manifest>';
    expect(components(xml)).toEqual([
      { kind: 'receiver', name: UNNAMED, exported: true, permission: null },
    ]);
  });

  it('names an unnamed permission definition the same way', () => {
    expect(
      definedPermissions('<manifest><permission android:protectionLevel="normal" /></manifest>'),
    ).toEqual([{ name: UNNAMED, protectionLevel: 'normal' }]);
  });

  it('steps over a bare less-than in text rather than reading it as a tag', () => {
    // `<` that starts no name: the scan moves past it. Asserted through
    // `startTags` rather than `components`, because a bogus tag that is not a
    // component kind would be filtered out and the mis-scan would not show.
    const xml =
      '<manifest><application><service android:name=".S" android:exported="false" />' +
      '< 3 is text, not a tag</application></manifest>';
    expect(startTags(xml).map((one) => one.name)).toEqual(['manifest', 'application', 'service']);
    expect(components(xml).map((one) => one.name)).toEqual(['.S']);
  });

  it('reads a defined permission and its protection level', () => {
    // Defining one is the dangerous half: at `normal` any application on the
    // device can hold it.
    const xml =
      '<manifest><permission android:name="x.P" android:protectionLevel="signature" /></manifest>';
    expect(definedPermissions(xml)).toEqual([{ name: 'x.P', protectionLevel: 'signature' }]);
  });

  it('separates defining a permission from using one', () => {
    const xml =
      '<manifest><permission android:name="x.P" /><uses-permission android:name="x.P" /></manifest>';
    expect(definedPermissions(xml).map((one) => one.name)).toEqual(['x.P']);
    expect(usesPermissions(xml).map((one) => one.name)).toEqual(['x.P']);
  });

  it('lists the direct children of a queries block and nothing else', () => {
    // Package visibility is not a permission and appears in no permission list.
    const xml = `<manifest>
      <queries>
        <package android:name="com.example.other" />
        <intent><action android:name="android.intent.action.VIEW" /></intent>
        <provider android:authorities="com.example.provider" />
      </queries>
      <application><service android:name=".S" android:exported="false" /></application>
    </manifest>`;
    expect(queries(xml)).toEqual([
      'package:com.example.other',
      'intent',
      'provider:com.example.provider',
    ]);
  });

  it('reports no queries for a manifest that declares none', () => {
    expect(queries(APP_MANIFEST)).toEqual([]);
  });

  it('stops listing queries at the end of the block', () => {
    const xml = `<manifest>
      <queries><package android:name="com.example.other" /></queries>
      <application><service android:name=".S" android:exported="false" /></application>
    </manifest>`;
    expect(queries(xml)).toEqual(['package:com.example.other']);
  });
});
