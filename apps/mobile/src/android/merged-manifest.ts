// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Locating the manifest the app actually ships, and the list somebody reviewed
 * it against ([#318](https://github.com/openzigs/onyourleft/issues/318)).
 *
 * `manifest.ts` reads a manifest as a document. This module answers the prior
 * question: **which** document. Until #318 the answer was the app's own
 * `AndroidManifest.xml`, which is not the file that ships — the Android Gradle
 * Plugin merges it with every library's, and the merge adds permissions,
 * components and package-visibility entries the app never declared.
 *
 * Measured on 2026-09-16: we declare **8** permissions and the merged manifest
 * carries **11**, plus one `<permission>` definition and one exported receiver
 * that came from nowhere in this repository. The three extra permissions are
 * each correct. That is the point rather than a mitigation: **nothing checked**,
 * so the merge could as easily have injected an unbounded location permission
 * and every test would still have been green, because the subject under test
 * was a different file from the artefact.
 *
 * ⚠️ **The expectation below is a REVIEWED LIST, not a derivation from our own
 * manifest.** Deriving it would re-create the original defect from the other
 * direction: an injected permission would either always fail (making the gate
 * useless, since three of them are right) or be filtered out by a rule that is
 * itself unreviewed. Somebody read each entry; each entry says who contributes
 * it and why it is acceptable. Adding one is a review decision with a diff.
 *
 * ⚠️ **It cannot run on a clean clone and must not pretend to.** CI does not
 * build Android at all ([`CLAUDE.md`](../../../../CLAUDE.md) §4c) and a clone
 * has never run Gradle, so the artefact is simply absent — `app/build/` is
 * generated and git-ignored. `mergedManifests` returns an empty array there and
 * `mergedManifestAbsence` is the sentence the test prints before it skips. A
 * green run on a machine with no merged manifest would be #318 recurring inside
 * its own fix.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `apps/mobile/android`, resolved from this file rather than from `cwd`. */
export const ANDROID_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'android');

/**
 * The build variants whose merged manifest is looked for.
 *
 * Both are read when both are present, and each is asserted separately: a
 * release build is a different merge (different `manifestPlaceholders`, and
 * `minifyEnabled` can change what survives), so asserting only the debug one
 * and calling the shipped artefact checked would be this issue again.
 */
export const BUILD_VARIANTS = ['debug', 'release'] as const;

export type BuildVariant = (typeof BUILD_VARIANTS)[number];

const capitalised = (variant: string): string =>
  `${variant.charAt(0).toUpperCase()}${variant.slice(1)}`;

/**
 * Where the Android Gradle Plugin writes the merged manifest for a variant.
 *
 * ⚠️ AGP writes three copies of this file and they were verified byte-identical
 * for `debug` on 2026-09-16: `merged_manifest/…/process<V>MainManifest`,
 * `merged_manifests/…/process<V>Manifest` and
 * `packaged_manifests/…/process<V>ManifestForPackage`. The first is the one
 * #318 names. Reading one of three identical files is a choice worth recording
 * rather than a fact worth relying on — if a future AGP makes them differ, the
 * one that ships is `packaged_manifests`.
 */
export function mergedManifestPath(androidRoot: string, variant: BuildVariant): string {
  return join(
    androidRoot,
    'app',
    'build',
    'intermediates',
    'merged_manifest',
    variant,
    `process${capitalised(variant)}MainManifest`,
    'AndroidManifest.xml',
  );
}

/** A merged manifest found on disk. */
export interface MergedManifest {
  readonly variant: BuildVariant;
  readonly path: string;
  readonly xml: string;
}

/**
 * Every merged manifest present under `androidRoot`, possibly none.
 *
 * ⚠️ **A file that is there but is not a manifest throws.** An empty or
 * truncated document parses as "declares nothing", and every "the merge adds
 * no X" assertion passes over it cheerfully. Absent and unreadable are
 * different answers and only one of them is allowed to be quiet.
 */
export function mergedManifests(androidRoot: string = ANDROID_ROOT): readonly MergedManifest[] {
  const found: MergedManifest[] = [];
  for (const variant of BUILD_VARIANTS) {
    const path = mergedManifestPath(androidRoot, variant);
    if (!existsSync(path)) {
      continue;
    }
    const xml = readFileSync(path, 'utf8');
    if (!xml.includes('<manifest')) {
      throw new Error(
        `${path} exists but has no <manifest> element; a partial build cannot be asserted against`,
      );
    }
    found.push({ variant, path, xml });
  }
  return found;
}

/**
 * The one line a reporter puts beside a skipped test.
 *
 * It is the FIRST line of `mergedManifestAbsence` rather than a second sentence
 * that says roughly the same thing, because two wordings of one fact drift and
 * the drift is invisible: the skip note is only ever read on the run where the
 * gate did not run.
 */
export const MERGED_MANIFEST_SKIPPED =
  'SKIPPED: no merged Android manifest here, so the manifest the app actually ships was NOT checked by this run.';

/** Why there is nothing to assert, and what a person would do about it. */
export function mergedManifestAbsence(androidRoot: string = ANDROID_ROOT): string {
  const looked = BUILD_VARIANTS.map((variant) => mergedManifestPath(androidRoot, variant)).join(
    '\n  ',
  );
  return [
    MERGED_MANIFEST_SKIPPED,
    'Looked in:',
    `  ${looked}`,
    'Build one with `cd apps/mobile/android && ./gradlew :app:processDebugMainManifest`',
    '(needs an Android SDK — apps/mobile/README.md §5). CI does not build Android,',
    'so this is expected there and is why these assertions are not a CI gate.',
  ].join('\n');
}

/**
 * The `applicationId` the merge stamps everywhere, including into the custom
 * permission `androidx.core` defines. Asserted rather than derived, so a change
 * of application id is a review decision too.
 */
export const APPLICATION_ID = 'dev.openzigs.onyourleft';

/** Who contributes an entry to the merge. */
export type Contributor = 'ours' | 'merged-in';

/** One reviewed `uses-permission` in the shipped manifest. */
export interface ReviewedPermission {
  readonly name: string;
  /** Exactly the value expected, `null` meaning the attribute is absent. */
  readonly maxSdkVersion: number | null;
  /** Exactly the `android:usesPermissionFlags` expected, `null` for absent. */
  readonly flags: string | null;
  readonly contributor: Contributor;
  /** Why this is acceptable in a shipped app. Read in review; never asserted. */
  readonly why: string;
}

/**
 * Every `uses-permission` the shipped app is permitted to carry.
 *
 * ⚠️ The `maxSdkVersion` column is load-bearing and not decoration. An injected
 * `BLUETOOTH` bounded at 30 applies only where the legacy permission is
 * genuinely required; the same permission unbounded is a runtime grant on every
 * Android version, and the two are one attribute apart. Dropping the attribute
 * from an entry here must fail this suite.
 *
 * Provenance for the three we do not declare is
 * `app/build/outputs/logs/manifest-merger-debug-report.txt`, read 2026-09-16.
 */
export const REVIEWED_PERMISSIONS: readonly ReviewedPermission[] = [
  {
    name: 'android.permission.INTERNET',
    maxSdkVersion: null,
    flags: null,
    contributor: 'ours',
    why: 'the WebView loads the app from the bundled assets, and #53 will add a tile origin',
  },
  {
    name: 'android.permission.BLUETOOTH_SCAN',
    maxSdkVersion: null,
    flags: 'neverForLocation',
    contributor: 'ours',
    why: 'the whole product. neverForLocation is what keeps the scan out of location policy',
  },
  {
    name: 'android.permission.BLUETOOTH_CONNECT',
    maxSdkVersion: null,
    flags: null,
    contributor: 'ours',
    why: 'holding the GATT link to a trainer or a sensor',
  },
  {
    name: 'android.permission.ACCESS_FINE_LOCATION',
    maxSdkVersion: 30,
    flags: null,
    contributor: 'ours',
    why: 'required to scan at all below API 31, and requested on nothing above it',
  },
  {
    name: 'android.permission.ACCESS_COARSE_LOCATION',
    maxSdkVersion: 30,
    flags: null,
    contributor: 'ours',
    why: 'the same, and bounded although the permission list in #87 does not name it',
  },
  {
    name: 'android.permission.CAMERA',
    maxSdkVersion: null,
    flags: null,
    contributor: 'ours',
    why: '#383. A rider points a phone at themselves on a trainer and takes still pictures on this device. It is NOT for scanning, not for a QR code and not for video calling; nothing is uploaded on the app’s own initiative — since #387 one picture can be sent, on a press, to a computer of the rider’s own that they configured on their own network and switched on — and the frame is thrown away once it has been looked at unless the rider turns on this ride’s keep (ADR 0029 D-2). Unbounded because a camera is not a legacy permission: there is no API level at which it stops being needed. The uses-feature beside it is required="false" so the app stays installable on a device with no camera — see REVIEWED_FEATURES',
  },
  {
    name: 'android.permission.FOREGROUND_SERVICE',
    maxSdkVersion: null,
    flags: null,
    contributor: 'ours',
    why: 'recording continues while the phone is in a jersey pocket',
  },
  {
    name: 'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE',
    maxSdkVersion: null,
    flags: null,
    contributor: 'ours',
    why: 'the typed half of the above; omitting it throws SecurityException on API 34+',
  },
  {
    name: 'android.permission.POST_NOTIFICATIONS',
    maxSdkVersion: null,
    flags: null,
    contributor: 'ours',
    why: 'a foreground service shows a notification, and API 33+ makes that a grant',
  },
  {
    name: 'android.permission.BLUETOOTH',
    maxSdkVersion: 30,
    flags: null,
    contributor: 'merged-in',
    why: '@capacitor-community/bluetooth-le 8.3.0. The pre-API-31 spelling of BLUETOOTH_CONNECT, and it already arrives bounded at 30, so it grants nothing on any version this app targets by default',
  },
  {
    name: 'android.permission.BLUETOOTH_ADMIN',
    maxSdkVersion: 30,
    flags: null,
    contributor: 'merged-in',
    why: '@capacitor-community/bluetooth-le 8.3.0. The pre-API-31 spelling of BLUETOOTH_SCAN, bounded the same way',
  },
  {
    name: `${APPLICATION_ID}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`,
    maxSdkVersion: null,
    flags: null,
    contributor: 'merged-in',
    why: 'androidx.core 1.17.0. Its own signature-level permission, held by this app alone, so that a receiver it registers at runtime is not reachable from another application. Grants nothing outside the app: see REVIEWED_DEFINED_PERMISSIONS for the protection level that makes that true',
  },
];

/**
 * One reviewed `uses-feature` in the shipped manifest.
 *
 * ⚠️ **A permission list cannot see this, and the consequence is a store
 * filter rather than a crash.** Google Play derives *implied* hardware
 * requirements from permissions — `CAMERA` implies `android.hardware.camera` —
 * and an implied requirement is `required="true"`, so a permission declared
 * without an explicit optional feature makes the app **uninstallable** on every
 * device that lacks the hardware. Nothing fails at build time, nothing fails on
 * a developer's phone, and the symptom is an app that is simply absent from a
 * store listing somebody else is looking at.
 */
export interface ReviewedFeature {
  readonly name: string;
  /** Exactly the `android:required` expected; `null` means the attribute is absent. */
  readonly required: string | null;
  readonly contributor: Contributor;
  readonly why: string;
}

/**
 * Every `uses-feature` the shipped app is permitted to declare.
 *
 * ⚠️ **`required` is asserted as a STRING, and `null` is a failure rather than
 * a default.** Android treats an absent `android:required` as `true`, which is
 * the value that filters the app off devices; so "the attribute is missing" and
 * "the attribute says true" must be distinguishable here, and only one of them
 * is a mistake somebody made by accident.
 */
export const REVIEWED_FEATURES: readonly ReviewedFeature[] = [
  {
    name: 'android.hardware.camera',
    required: 'false',
    contributor: 'ours',
    why: '#383. Declared optional so that adding CAMERA does not make this app uninstallable on a device with no camera — the feature is off by default and a rider need never turn it on. A ride, a trainer and every sensor work exactly as before on such a device',
  },
];

/** One reviewed `<permission>` DEFINITION in the shipped manifest. */
export interface ReviewedDefinedPermission {
  readonly name: string;
  readonly protectionLevel: string;
  readonly contributor: Contributor;
  readonly why: string;
}

/**
 * ⚠️ Defining a permission is not the same as using one, and it is the more
 * dangerous half: a custom permission at `normal` rather than `signature` can
 * be requested by any application on the device, which turns whatever it
 * guards into a public door. So the level is asserted, not just the name.
 */
export const REVIEWED_DEFINED_PERMISSIONS: readonly ReviewedDefinedPermission[] = [
  {
    name: `${APPLICATION_ID}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`,
    protectionLevel: 'signature',
    contributor: 'merged-in',
    why: 'androidx.core 1.17.0. signature means only a package signed with this key can hold it, which is the whole mechanism',
  },
];

/** One reviewed component that the shipped manifest exports. */
export interface ReviewedExportedComponent {
  readonly kind: string;
  readonly name: string;
  /** The `android:permission` a caller must hold, or null for none. */
  readonly permission: string | null;
  readonly contributor: Contributor;
  readonly why: string;
}

/**
 * Every component the shipped app exposes to the rest of the device.
 *
 * ⚠️ This is the criterion a permission list cannot reach. An exported
 * component is an entry point any application on the phone can invoke; the
 * merge adds them, and the app's own manifest says nothing about the ones it
 * adds. Everything not named here must be `android:exported="false"` —
 * including a component that simply omits the attribute, which is why
 * `Component.exported` is a three-valued answer rather than a defaulted
 * boolean.
 */
export const REVIEWED_EXPORTED_COMPONENTS: readonly ReviewedExportedComponent[] = [
  {
    kind: 'activity',
    name: `${APPLICATION_ID}.MainActivity`,
    permission: null,
    contributor: 'ours',
    why: 'the launcher activity. A launcher entry is exported by definition',
  },
  {
    kind: 'receiver',
    name: 'androidx.profileinstaller.ProfileInstallReceiver',
    permission: 'android.permission.DUMP',
    contributor: 'merged-in',
    why: 'androidx.profileinstaller 1.4.0, reached by `adb shell cmd package compile`. Exported, but guarded by the signature|privileged DUMP permission, which no ordinary application can hold',
  },
];

/**
 * Package-visibility entries the shipped app is permitted to declare.
 *
 * Deliberately empty and deliberately present: `<queries>` is the third thing a
 * merge injects, it appears in no permission list, and an empty expectation
 * that is asserted is a different thing from no assertion at all.
 */
export const REVIEWED_QUERIES: readonly string[] = [];
