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
 * ⚠️ **Since #558 "no location collection" means the DEVICE's location**, and
 * a reviewer who remembers the Location row answering `false` outright is
 * reading the old file. The ride map's tile requests are declared as
 * approximate location collected (see the row); what this rule still guards is
 * the precise row — that the app cannot read where the device is.
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
  /**
   * Play's *purposes* for a collected type — its own words, such as
   * `App functionality`. Absent on a row that is not collected, where the
   * question does not arise. #558.
   */
  readonly purposes?: readonly string[];
  /** Why the answer is what it is. Read in review; never asserted. */
  readonly why: string;
}

/**
 * The declaration filed for this app.
 *
 * ⚠️ Every row but two is `collected: false`, and that is a statement about
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
 * ⚠️ **Since #529 there is a second** — `camera/side-link-transport.ts`, the
 * side-camera link between a rider's tablet and a phone they paired by
 * scanning. #529 moved no row for it: it carried a start, a stop and the
 * phone's state words, which are none of Play's data types. ⚠️ **Since #530
 * it carries PICTURES**, phone → tablet, and ADR 0033 D-10 put the re-read of
 * the Photos row here; the row now answers for both paths, and its comment
 * says why the answer did not change.
 *
 * ⚠️ **Since #558 the other is approximate location**, and a reviewer who
 * remembers "every row but one" is reading the old file: the ride map's tile
 * requests are kept by the tile host's analytics for up to 7 days, which is
 * not ephemeral processing. See the row.
 *
 * ⚠️ The health rows are here because Play's Health Content and Services policy
 * covers apps that are not primarily health apps — its own example is a game
 * that uses activity data to advance play, which is this app exactly (#95). The
 * rows are declared and answered rather than omitted.
 */
export const DATA_SAFETY_DECLARATION: readonly DataSafetyAnswer[] = [
  {
    // ⚠️ **Re-answered by #558, and the answer CHANGED — collected: true.** A
    // reviewer who remembers this row answering `false` on Play's *ephemeral
    // processing* exemption is reading #534's file. Since #534 every build
    // that is not told otherwise draws a ride's map from tiles.openzigs.com,
    // and which tiles are asked for says roughly where the ride was. MapLibre
    // makes the request inside the app's own WebView, which Play's definition
    // of *collect* counts ("data transmitted by libraries/SDKs and from
    // webviews under app control", Google Play Console Help, "Provide
    // information for Google Play's Data safety section", read 2026-09-25).
    //
    // The exemption assumed the host kept nothing. Measured 2026-09-26 through
    // the Cloudflare API (#558): the zone's standard HTTP analytics, present
    // on every zone and not switchable off, hold per-request records for
    // tiles.openzigs.com with the client IP and the request path, queryable by
    // this project's account, for up to 7 days on the Free plan (Cloudflare,
    // Security Analytics "Availability" table: Free and Pro "up to the last 7
    // days", Business 31). Seven days is not ephemeral, so the owner chose on
    // 2026-09-26 to disclose it.
    //
    // - **Approximate**, not precise: a tile names a map area, not a point,
    //   and the app requests no GPS fix and never transmits a ride's
    //   positions — see the Precise location row.
    // - **`shared: false`**: Cloudflare processes the requests for this
    //   project as its service provider, which Play does not count as sharing.
    // - **`optional: true`**: a rider can turn map tiles off in Settings → Ride
    //   map, and the app then requests nothing and still draws the ride.
    // - **App functionality**: the request exists to draw the map; this
    //   project does not use the retained record.
    //
    // ⚠️ `apps/mobile/RELEASE.md` §8 re-checks before every tag that the
    // retention is still what this row and the privacy policy say — the plan
    // decides the period, and a Business plan keeps 31 days.
    // `apps/web/src/privacy/no-network.test.ts` fails if this `why` stops
    // naming the host or the 7 days.
    dataType: 'Location — approximate location',
    collected: true,
    shared: false,
    optional: true,
    purposes: ['App functionality'],
    why: 'the ride map requests tiles from tiles.openzigs.com by default (#534; a rider can turn that off in Settings), and which tiles are asked for says roughly where the ride was. Cloudflare, which serves that host for this project, keeps a record of recent requests — including the IP address and the tile path — for up to 7 days in its standard HTTP analytics, which cannot be switched off (#558). This project does not use or share that record, and it is not linked to any ride or account',
  },
  {
    dataType: 'Location — precise location',
    collected: false,
    shared: false,
    why: 'a recorded ride carries positions and they stay in IndexedDB on the device; the app requests no GPS fix and never transmits a position. The location permissions in the manifest exist only so that a BLE scan works below API 31, which Android required, and they are bounded at API 30 — see locationClaimFaults. The one location signal that leaves the device is a map tile request, answered under approximate location',
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
    //
    // ⚠️ **Re-read by #530 for the side camera, ADR 0033 D-10 — and the
    // answer is UNCHANGED, for a different reason on each path.** Play's text,
    // read first-hand 2026-09-25 (Google Play Console Help, "Provide
    // information for Google Play's Data safety section"): *"'Collect' means
    // transmitting data from your app off a user's device"*, and among the
    // exemptions, *"User data that is sent off device, but that is unreadable
    // by you or anyone other than the sender and recipient as a result of
    // end-to-end encryption does not need to be disclosed."*
    //
    // - **The side camera's pictures** go from one of the rider's devices to
    //   another over a WebRTC data channel, which is DTLS-encrypted end to end
    //   and cannot be switched off (ADR 0033 D-1), with no relay and no server
    //   of ours or anybody's between them. The sender and the recipient are
    //   the rider's own phone and tablet, and nobody else — this project
    //   included — can read them. **That path alone would be exempt**, and on
    //   the tablet a picture is analysed in memory and discarded (D-6), which
    //   is also *"only processed locally"*.
    // - **#387's path to the rider's computer is not exempt** — plain `http:`
    //   on a home network — and it still exists. So the row stays
    //   `collected: true`; ADR 0033 D-10 says as much: *"the row must stay
    //   `collected: true` while #387's path exists"*.
    //
    // ⚠️ The side camera does NOT send a picture on to the rider's computer
    // (ADR 0033 D-11 is not built), and if it ever does, that is #387's
    // non-exempt path carrying a continuous stream, and this row's `why`
    // changes with it.
    dataType: 'Photos and videos',
    collected: true,
    shared: false,
    optional: true,
    purposes: ['App functionality'],
    why: 'a still picture from the camera (#382, #383) is sent — only when the rider presses the button that sends it — to one computer the rider configured at an address on their own network and switched on (#387). Nothing is set up by default and nothing is sent until it is. It is not sent to this project, which runs no server, and not to any third party: an address that is not on the rider’s own network is refused. A picture is otherwise discarded after it has been looked at unless the rider turns on this ride’s keep (ADR 0029 D-2). Separately, a side-camera phone the rider paired by scanning sends its pictures to the rider’s own tablet over an end-to-end encrypted WebRTC data channel with no relay (#530, ADR 0033 D-1), where each is analysed on the tablet and discarded at once, never stored, shown or sent on (ADR 0033 D-6) — end-to-end encrypted transfer between the rider’s own devices, which Play exempts, and so not what makes this row collected',
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
