// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Data Safety answers this app files on Google Play, and the one of them a
 * manifest can falsify ([#95](https://github.com/openzigs/onyourleft/issues/95)).
 *
 * #95's fifth criterion is *"the Data Safety form declares no location
 * collection, and a reviewer has confirmed the merged manifest supports that
 * claim"*. Two halves, and only the first is a form:
 *
 * 1. **What we declare.** {@link DATA_SAFETY_DECLARATION} is the filed answer,
 *    written down as data rather than left in a screenshot of a console. A form
 *    nobody can read from the repository is a form nobody can review, and it is
 *    the artefact a policy strike is measured against.
 * 2. **What the shipped app could do.** A declaration of "no location" is a
 *    claim about permissions, and permissions arrive in the APK from the
 *    manifest MERGE rather than from the file we edit — see
 *    `merged-manifest.ts`. {@link locationClaimFaults} is the rule that reads a
 *    permission list and says whether the claim is still true of it.
 *
 * ⚠️ **This is a necessary condition, not a sufficient one.** A permission list
 * cannot see code: an app holding no location permission can still collect
 * location by asking a peripheral for one, and this module would call that
 * clean. What it catches is the failure that actually happens — a dependency
 * bump injecting `ACCESS_FINE_LOCATION`, or an edit dropping the
 * `maxSdkVersion` bound that keeps the legacy one off every modern device — and
 * that is worth having precisely because it arrives looking like a version bump
 * rather than like a policy decision.
 *
 * ⚠️ **`neverForLocation` is load-bearing and is not decoration.** Android
 * treats a Bluetooth scan as a way of deriving location unless the scan
 * permission asserts it is not used for that, and Play's location policy
 * follows Android. A `BLUETOOTH_SCAN` without the flag makes the declaration
 * below false without any location permission being involved at all, which is
 * why it is checked here rather than only in the permission list.
 */

/** One answer on Play's Data Safety form. */
export interface DataSafetyAnswer {
  /** Play's own data-type name, so the row can be matched to the console. */
  readonly dataType: string;
  /** Whether the data leaves the device to us or to anybody else. */
  readonly collected: boolean;
  /** Whether it is transferred to a third party. */
  readonly shared: boolean;
  /**
   * Whether collecting it is **optional** — Play's own word: *"a user has
   * control over its collection and can use the app without providing it."*
   * Absent on a row that is not collected at all, where the question does not
   * arise. #387.
   */
  readonly optional?: boolean;
  /** Why the answer is what it is. Read in review; never asserted. */
  readonly why: string;
}

/**
 * The declaration filed for this app.
 *
 * ⚠️ Every row but one is `collected: false`, and that is a statement about
 * the PRODUCT, not a convenience: Phase 1 has no server, no account and no
 * analytics (CLAUDE.md §1, owner decision D6). Play's definition of
 * "collected" is data transferred off the device; a ride the athlete exports
 * to a file themselves is not a collection, and neither is a measurement
 * written to IndexedDB on the phone.
 *
 * ⚠️ **The one is Photos and videos, since #387, and this paragraph said
 * "every row" until then.** `apps/web/src` now contains exactly one network
 * call — `camera/analysis-transport.ts`, pinned by
 * `privacy/no-network.test.ts` — which sends one picture to a computer the
 * rider configured on their own network and switched on. That is data
 * transferred off the device, so it is collected; see the row.
 *
 * ⚠️ The health rows are here because Play's Health Content and Services policy
 * covers apps that are not primarily health apps — its own example is a game
 * that uses activity data to advance play, which is this app exactly (#95). The
 * rows are declared and answered rather than omitted.
 */
export const DATA_SAFETY_DECLARATION: readonly DataSafetyAnswer[] = [
  {
    // ⚠️ **Re-read by #534, and the answer is UNCHANGED — but it now rests on
    // a condition a person has to keep true.** Since #534 every build that is
    // not told otherwise draws a ride's map from tiles.openzigs.com, and a tile
    // request says roughly where the ride was — MapLibre makes it inside the
    // app's own WebView, which Play's definition of *collect* counts ("data
    // transmitted by libraries/SDKs and from webviews under app control",
    // Google Play Console Help, "Provide information for Google Play's Data
    // safety section", read 2026-09-25).
    //
    // It stays `collected: false` on Play's *ephemeral processing* exemption:
    // the host is a static object on Cloudflare R2 that answers a byte range
    // and keeps nothing this project reads, and this project does not use the
    // requests to derive a location — Play's own test for an IP address.
    // ⚠️ **That is true only while nothing retains those requests for us**: an
    // R2 access log, a Logpush job or an analytics product turned on for that
    // host makes the exemption false, and this row becomes
    // `collected: true` for approximate location. Checking the bucket's
    // configuration needs the Cloudflare account, which no pull request has.
    dataType: 'Location (approximate or precise)',
    collected: false,
    shared: false,
    why: 'a recorded ride carries positions and they stay in IndexedDB on the device. The location permissions in the manifest exist only so that a BLE scan works below API 31, which Android required, and they are bounded at API 30 — see locationClaimFaults. Since #534 the ride map requests tiles from tiles.openzigs.com by default, and which tiles are asked for says roughly where the ride was; that request is processed ephemerally by a static file host that keeps nothing this project reads, and is not used to derive a location — see the comment above this row for the condition that keeps this answer true',
  },
  {
    dataType: 'Health and fitness — health info',
    collected: false,
    shared: false,
    why: 'heart rate from a BLE strap, stored locally. In scope of the Health apps policy because it advances gameplay (#85); not collected because nothing transmits it',
  },
  {
    dataType: 'Health and fitness — fitness info',
    collected: false,
    shared: false,
    why: 'power, cadence, speed and distance from BLE sensors and the trainer, stored locally',
  },
  {
    dataType: 'Personal info',
    collected: false,
    shared: false,
    why: 'there is no account, no sign-in and no name or email field anywhere in the client',
  },
  {
    dataType: 'Files and docs',
    collected: false,
    shared: false,
    why: 'FIT, GPX and TCX files are read and written on the device at the athlete’s own request (#51). Nothing is uploaded',
  },
  {
    dataType: 'App activity',
    collected: false,
    shared: false,
    why: 'no analytics SDK, no crash reporter and no telemetry of any kind is linked into this app',
  },
  {
    // ⚠️ **Re-answered by #387, and the answer CHANGED — collected: true.**
    // A reviewer who remembers this row answering `false` is reading #383's
    // file, which said in terms that the answer would change "on the day a
    // frame first leaves" and that #387 was that day. It is: a picture can now
    // be sent to the rider's own computer, and Play's definition of
    // *collected* is transmission off the device — Google Play Console Help,
    // "Provide information for Google Play's Data safety section", read
    // 2026-09-23. None of its exemptions fits honestly: the request is not
    // end-to-end encrypted on a plain-`http:` home network, and the
    // *ephemeral processing* exemption describes the developer's own handling,
    // not a machine this project never sees.
    //
    // ⚠️ **`shared: false`**, and the reasoning is two of Play's own words.
    // *Sharing* is *"transferring user data collected from your app to a third
    // party"*, and the destination is the rider's own computer; and Play
    // exempts a transfer *"based on a specific user-initiated action, where
    // the user reasonably expects the data to be shared"*, which a press of
    // "Send one picture" to an address the rider typed is. ⚠️ **ADR 0029's
    // amendment names `shared: yes` for the HOSTED path**, which is a third
    // party by any reading — that path is not built (the address rule refuses
    // anything off the rider's own network), and building it re-files this row.
    //
    // **`optional: true`**: off until the rider sets up a computer and
    // switches it on, and the app works in full without it.
    dataType: 'Photos and videos',
    collected: true,
    shared: false,
    optional: true,
    why: 'a still picture from the camera (#382, #383) is sent — only when the rider presses the button that sends it — to one computer the rider configured at an address on their own network and switched on (#387). Nothing is set up by default and nothing is sent until it is. It is not sent to this project, which runs no server, and not to any third party: an address that is not on the rider’s own network is refused. A picture is otherwise discarded after it has been looked at unless the rider turns on this ride’s keep (ADR 0029 D-2)',
  },
  {
    dataType: 'Device or other IDs',
    collected: false,
    shared: false,
    why: 'the device signing keypair (#61) never leaves the device — its private half is a non-extractable CryptoKey — and its public half travels only inside a file the athlete exports themselves',
  },
];

/**
 * The permissions Android counts as location access.
 *
 * ⚠️ `ACCESS_BACKGROUND_LOCATION` is in the list and is NOT bounded by
 * {@link LEGACY_SCAN_MAX_SDK} below: there is no version of Android on which
 * this app has a reason to hold it, so any value of `maxSdkVersion` on it is a
 * fault rather than a mitigation. It is the permission that triggers Play's
 * hardest review, and the one a careless library merge is most likely to add.
 */
export const LOCATION_PERMISSIONS: readonly string[] = [
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.ACCESS_MEDIA_LOCATION',
];

/** Location permissions with no legitimate version range in this app at all. */
export const FORBIDDEN_LOCATION_PERMISSIONS: readonly string[] = [
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.ACCESS_MEDIA_LOCATION',
];

/**
 * The last API level on which a BLE scan required a location permission.
 *
 * API 31 introduced `BLUETOOTH_SCAN`, so a location permission bounded at 30
 * grants nothing on any device running Android 12 or later. #87 chose this
 * bound; #95 is where it became the evidence for a Data Safety answer.
 */
export const LEGACY_SCAN_MAX_SDK = 30;

/** The permission whose flags decide whether a scan counts as location. */
export const SCAN_PERMISSION = 'android.permission.BLUETOOTH_SCAN';

/** The flag that says a scan is not used to derive a physical location. */
export const NEVER_FOR_LOCATION = 'neverForLocation';

/** The shape this rule needs from a permission, met by a manifest or a review. */
export interface PermissionLike {
  readonly name: string;
  readonly maxSdkVersion: number | null;
  readonly flags: string | null;
}

/**
 * Every reason the "no location collection" declaration is not supported by a
 * permission list — empty when it is.
 *
 * ⚠️ It returns REASONS rather than a boolean, and the reasons name the
 * permission. A boolean gate over a merged manifest tells a reviewer that
 * something among eleven permissions is wrong, which is the least useful moment
 * to withhold the name.
 *
 * ⚠️ **A missing `BLUETOOTH_SCAN` is not a fault here.** This rule answers "is
 * the location claim still true", and an app that cannot scan at all collects
 * no location. Requiring the permission's presence would make this function
 * quietly also a "the app still works" check, and the two have different right
 * answers for a fixture.
 */
export function locationClaimFaults(permissions: readonly PermissionLike[]): readonly string[] {
  const faults: string[] = [];
  for (const permission of permissions) {
    if (FORBIDDEN_LOCATION_PERMISSIONS.includes(permission.name)) {
      faults.push(
        `${permission.name} is declared; this app has no version range in which it is needed`,
      );
      continue;
    }
    if (!LOCATION_PERMISSIONS.includes(permission.name)) {
      continue;
    }
    if (permission.maxSdkVersion === null) {
      faults.push(
        `${permission.name} is unbounded; a location permission with no android:maxSdkVersion is a runtime grant on every Android version`,
      );
      continue;
    }
    if (permission.maxSdkVersion > LEGACY_SCAN_MAX_SDK) {
      faults.push(
        `${permission.name} is bounded at API ${String(permission.maxSdkVersion)}, above the ${String(LEGACY_SCAN_MAX_SDK)} at which a BLE scan stopped needing it`,
      );
    }
  }
  for (const permission of permissions) {
    if (permission.name !== SCAN_PERMISSION) {
      continue;
    }
    if (permission.flags === null || !permission.flags.split('|').includes(NEVER_FOR_LOCATION)) {
      faults.push(
        `${SCAN_PERMISSION} does not assert ${NEVER_FOR_LOCATION}; Android then treats the scan itself as location access`,
      );
    }
  }
  return faults;
}
