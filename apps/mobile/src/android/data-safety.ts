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
 * ⚠️ Every collected row is OPTIONAL and leaves only by a path the rider
 * chose (`DATA_PATHS`), and that is a statement about the PRODUCT, not a
 * convenience: no analytics, and nothing sent anywhere a rider did not
 * choose. A reviewer who remembers "every row but seven is `collected:
 * false`" is reading the old file: since #778 answered sync (#1195), ten
 * rows are collected and three — Email address, App activity and Audio —
 * are not; `data-safety.test.ts` lists them. ⚠️ "Phase 1 has no server" was the
 * reason this line gave until ADR 0036 lifted owner decision D6; an instance is
 * now something a rider may connect to, and the three rows #777 moved say
 * what that sends. Play's definition of
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
 * requests' IP addresses are visible in the tile host's analytics for up to
 * 7 days, which is not ephemeral processing. See the row.
 *
 * ⚠️ **Since #804 the two health rows are collected too**, and a reviewer who
 * remembers "every row but two" is reading the old file: the post-ride ask
 * sends a ride's numbers to the rider's own computer on a press. See the rows.
 * ⚠️ **Since #803 they are SHARED as well**: the same ask can go to a hosted
 * model on the rider's own key, which is a third party.
 *
 * ⚠️ **Since #777 the device's public key and the rider's display name are
 * collected too**, when the rider connects to an instance: see the Device or
 * other IDs, Personal info — Name and Personal info — User IDs rows. This
 * build sends an instance nothing else — no ride, route, position or health
 * data — so every other row is unmoved by it, and each says so where it used
 * to say "this project runs no server". ⚠️ The rows are revised for the build
 * that ships instance support (#778), and a later build that syncs rides
 * (#776) or joins a room moves the precise-location and health rows
 * again, in its own pull request. ⚠️ #782 shipped the room code — power and
 * cadence twice a second, and the declared weight once, to the instance
 * running a room — with NO way into a room in the product: the first build
 * that offers one (#784's room code) is the one that moves the health rows.
 * ⚠️ **#784 and #785 are that build**, and a reviewer who remembers "no way
 * into a room" is reading the old file: a rider may now make a private room
 * on one of their own routes, or join one by its code. That moves the
 * PRECISE LOCATION row to collected — the route of a room the rider makes is
 * sent to the instance and shown to the riders they invite — and adds the
 * room's power, cadence, declared weight and a race's result (place, time,
 * W/kg, flags) to the fitness row's words and to the instance's path. Draft
 * wording awaiting the owner's approval (#880; #784, #785).
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
    // and the host sees the rider's IP address with every request. MapLibre
    // makes the request inside the app's own WebView, which Play's definition
    // of *collect* counts ("data transmitted by libraries/SDKs and from
    // webviews under app control", Google Play Console Help, "Provide
    // information for Google Play's Data safety section", read 2026-09-25).
    //
    // The exemption assumed the host kept nothing. Measured 2026-09-26 through
    // the Cloudflare API (#558): the zone's standard HTTP analytics, present
    // on every zone and not switchable off, hold per-request records for
    // tiles.openzigs.com with the client IP, the time, the user agent, the
    // country and network (ASN) and the request path, queryable by this
    // project's account for up to 7 days on the Free plan (Cloudflare,
    // Security Analytics "Availability" table: Free and Pro "up to the last 7
    // days", Business 31). Seven days is not ephemeral, so the owner chose on
    // 2026-09-26 to disclose it.
    //
    // - **Approximate**, not precise — and ⚠️ NOT because "a tile names an
    //   area, not a point", which is the argument this row first carried and
    //   which does not hold. Play draws the line by AREA (approximate is
    //   ≥ 3 km², precise < 3 km²), and a z15 Web Mercator tile over the
    //   archive's 24–50°N is 0.64–1.23 km²: if the tile a rider asked for were
    //   in the kept record, this row would have to be PRECISE as well. It is
    //   not in the record. The basemap is ONE PMTiles file and pmtiles picks
    //   each tile out of it with an HTTP `Range` header, so every request has
    //   the same `clientRequestPath`, and `httpRequestsAdaptive` has no Range
    //   field. Measured 2026-09-26 (#559's review, grouping that dataset by
    //   `clientRequestPath` over 23 h): every app request was
    //   `/basemap-us-20260914.pmtiles`. The Range header is handled while the
    //   request is served and is not kept — Play's ephemeral case — so what is
    //   retained about location is the IP address and the country/ASN derived
    //   from it, which is IP-geolocation grade: approximate. The app requests
    //   no GPS fix and never transmits a ride's positions — see the Precise
    //   location row. ⚠️ If a tile setup ever puts the tile in the URL (a
    //   z/x/y server, a query string), the kept record names it and the
    //   Precise row flips; `apps/mobile/RELEASE.md` §8 re-runs the query.
    // - **`shared: false`**: Cloudflare processes the requests for this
    //   project as its service provider, which Play does not count as sharing.
    // - **`optional: true`**: a rider can turn map tiles off in Settings → Ride
    //   map, and the app then requests nothing and still draws the ride.
    // - **App functionality**: the request exists to draw the map; this
    //   project does not use the retained record.
    //
    // - **The instance (#777, #892's review)**: a rider who connects sends
    //   an instance their IP address with every request. The project's own
    //   instance writes it nowhere (`apps/instance/src/log.ts`) and holds it
    //   in memory for its rate limit only; Cloudflare Tunnel carries that
    //   instance's traffic, so the same 7-day record exists for it. The row
    //   was already `collected: true` for the tiles, so the answer does not
    //   change; the words name both.
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
    why: 'the ride map requests tiles from tiles.openzigs.com by default (#534; a rider can turn that off in Settings). Cloudflare, which serves that host for this project, keeps a record of each map request — the IP address, the time, and the device or browser type, not which part of the map — that this project’s Cloudflare account can see for up to 7 days in its standard HTTP analytics, which cannot be switched off (#558). The map is one file and each tile is picked out of it by a byte range that the record does not include, so the location it holds is what an IP address says. This project does not use or share that record, and it is not linked to any ride or account. Connecting to an instance (#777), which a rider chooses to do, also sends the IP address with each request to it: this project’s own instance does not write the address to its log or its database and holds it in memory only, for at most an hour, to limit how many requests one address can make; Cloudflare, which carries that instance’s traffic through Cloudflare Tunnel, keeps the same record of each request — the IP address, the time, and the device or browser type — that this project’s Cloudflare account can see for up to 7 days. This project does not use or share that record either, and does not link it to the rider’s account there',
  },
  {
    // ⚠️ **Re-answered by #784, and the answer CHANGED — collected: true.** A
    // reviewer who remembers "never transmits a position" is reading the old
    // file. A private room is made on one of the rider's own routes, and that
    // route — a line of positions, very likely starting near home — is sent to
    // the instance and shown to the riders the maker shares its code with. It
    // is not the DEVICE's location (the app still requests no GPS fix, and
    // `locationClaimFaults` still guards that), but Play's location type is the
    // user's location, and a route is that. `shared: false`: the instance is
    // the rider's or ours, and the riders who see the route are the ones the
    // maker chose to give the code to — a user-initiated transfer. Optional:
    // nothing is sent until the rider presses *Make a room*, and a route in a
    // privacy zone is refused before anything is sent.
    //
    // ⚠️ **Re-read by #778 for sync (#1195), and the answer is unchanged —
    // the WORDS changed.** A reviewer who remembers "never transmits a ride's
    // positions" is reading the old file: a sync sends each ride as the file
    // it was recorded or imported as, positions included and untrimmed (it is
    // the rider's own copy), to the instance the rider connected to — sealed
    // for that instance alone (ADR 0047 D-7), and shown by it to nobody else.
    // Still `shared: false` and optional: nothing syncs until the rider
    // presses Sync, which needs the instance's card. The row is answered for
    // the build that ships Sync before that build exists, so Play is never
    // told less than the app does (#1195 is blocked by #778 for this).
    dataType: 'Location — precise location',
    collected: true,
    shared: false,
    optional: true,
    purposes: ['App functionality'],
    why: 'a recorded ride carries positions and they stay in IndexedDB on the device; the app requests no GPS fix. A ride’s positions leave the device only when the rider syncs with an instance they connected to (#1195): the ride goes to that instance as the file it was recorded or imported as, positions included and not trimmed by privacy zones, because it is the rider’s own copy, sealed on the device for that instance alone (ADR 0047), which shows it to no other rider. Nothing syncs until the rider presses Sync, which needs the instance’s card. The one route that leaves the device is one the rider chooses to make a private room on (#784): its positions and heights — not its name, and no times — go to the instance the rider connected to, which shows it to the riders the maker shares the room’s code with and deletes it when the room is over: a race finished, a group ride empty for a minute, a race interrupted by the instance restarting, nobody riding in it a day after it was made, or the maker erasing their account there. A route that starts, ends or passes inside one of the rider’s privacy zones is refused before anything is sent. Connecting to an instance (#777) sends no position of its own. The location permissions in the manifest exist only so that a BLE scan works below API 31, which Android required, and they are bounded at API 30 — see locationClaimFaults. The map tile request is the other location signal: which part of the map it asks for is handled while the request is served and not kept, and what is kept is the IP address, answered under approximate location',
  },
  {
    // ⚠️ **Re-answered by #804, and the answer CHANGED — collected: true.** A
    // reviewer who remembers `collected: false` "because nothing transmits it"
    // is reading the old file: the post-ride ask sends a ride's heart rate, as
    // numbers, to the rider's own computer when they press the button on the
    // ride's page (ADR 0035 D-9 B). That is transmission off the device, so it
    // is collected, on the Photos row's reasoning; `shared: false` and
    // `optional: true` on the same words — the destination is the rider's own
    // computer, the transfer is a specific user-initiated action, and nothing
    // is set up by default.
    //
    // ⚠️ **Re-answered by #803, and the answer CHANGED — shared: true.** A
    // reviewer who remembers `shared: false` is reading #804's file. The
    // hosted model on the rider's own key is now sent a ride's heart rate when
    // the rider asks for an analysis on the hosted source (the owner's ruling 4
    // on #795: *"health and fitness data shared with a third party the rider
    // chose"*; ADR 0035 D-9 C; ADR 0029's 2026-09-29 amendment). That service
    // is a third party — not the rider's own machine — so this is SHARING in
    // Play's sense, and #803's criterion, written from that ruling, files it
    // as shared rather than arguing Play's user-initiated exemption for a
    // third party. Still optional: off by default,
    // separately consented, and off again whenever the app is opened.
    dataType: 'Health and fitness — health info',
    collected: true,
    shared: true,
    optional: true,
    purposes: ['App functionality'],
    why: 'heart rate from a BLE strap, stored locally. In scope of the Health apps policy because it advances gameplay (#85). When the rider presses the button on a ride’s page that asks for a write-up (#804), that ride’s heart rate — as numbers, section by section — is sent to the source they chose: one computer the rider configured at an address on their own network and switched on, the same computer and rules as the Photos row; or (#803) a hosted model service the rider chose, at the https address they typed, on their own key, which is a third party — hence shared. The hosted path is off by default, separately consented, off again whenever the app is opened, and gated on that consent at every step. Nothing is set up by default, nothing is sent until the press, and nothing is sent in the background. It is not sent to this project by that press. When the rider syncs with an instance they connected to (#1195), each ride’s heart rate goes to that instance inside the ride’s file, sealed on the device for that instance alone (ADR 0047), which shows it to no other rider; nothing syncs until the rider presses Sync, which needs the instance’s card. That is the rider’s own copy on an instance they chose — their own, or this project’s, whose traffic Cloudflare carries for us without being able to read what is sealed — not a third party, so it does not add to shared',
  },
  {
    // ⚠️ **Re-answered by #804, and the answer CHANGED — collected: true.** A
    // reviewer who remembers "#518: the row the hosted path would move, and it
    // has not moved yet" is reading the old file. The post-ride ask sends a
    // ride's power, cadence, weight, watts per kilogram, threshold power and
    // length, section by section, to the rider's OWN computer on the press
    // (ADR 0035 D-9 B). Collected, not shared, optional — the health-info
    // row's reasoning, and the Photos row's.
    //
    // ⚠️ **Re-answered by #803, and the answer CHANGED — shared: true**, on
    // the health-info row's reasoning: the hosted model on the rider's own key
    // is now sent these numbers when the rider asks for an analysis on the
    // hosted source (ruling 4 on #795; ADR 0035 D-9 C).
    dataType: 'Health and fitness — fitness info',
    collected: true,
    shared: true,
    optional: true,
    purposes: ['App functionality'],
    why: 'power, cadence, speed and distance from BLE sensors and the trainer, stored locally. When the rider presses the button on a ride’s page that asks for a write-up (#804), that ride’s power, cadence, the rider’s weight and watts per kilogram, their threshold power if set, and the ride’s length and distance, with each section’s gradient and total climb (the height gained over the section, a difference between two heights and never an altitude), section by section, are sent as numbers to the source they chose: one computer the rider configured at an address on their own network and switched on — the same computer and rules as the Photos row — or (#803) a hosted model service the rider chose, at the https address they typed, on their own key, which is a third party — hence shared. The hosted path is off by default, separately consented, off again whenever the app is opened, and gated on that consent at every step. Nothing is set up by default and nothing is sent until the press. It is not sent to this project. No position, altitude, date or identifier is sent on either path. In a private room the rider makes or joins on an instance they connected to (#784, #785): their power and cadence twice a second while they ride in it, and the weight they declare once as they join, for the room to simulate them — never shown to anybody; the other riders see where they are on the room’s road. After a race, the instance keeps each rider’s result — place, time, power-to-weight (W/kg) over the race and any plausibility flag — shown to that race’s riders only, until the rider’s account there is erased; beside another rider it is power-to-weight and never watts. When the rider syncs with an instance they connected to (#1195), each ride goes to that instance whole — power, cadence, speed and distance with the rest of its file — with its write-up, its side-camera report and the summary of how the rider’s position changed (differences, never a picture), and a short summary the device writes from the ride’s numbers for a later analysis to look back at, with no position, date or name in it. All of it is sealed on the device for that instance alone (ADR 0047), and the instance shows none of it to another rider. Nothing syncs until the rider presses Sync, which needs the instance’s card',
  },
  {
    // ⚠️ **Split by #777, and the Name answer CHANGED — collected: true.** A
    // reviewer who remembers one `Personal info` row answering "there is no
    // account, no sign-in and no name" is reading the old file. A rider may
    // connect to an instance and type the name other riders will see; it is
    // sent to that instance on every Connect with a name typed, and kept only
    // when the instance has not seen the device before (#892's review: this
    // said it was SENT only then, which `sign-in.ts` never did). A rename on
    // the instance keeps each earlier name for moderation (migration 0004). Collected on #387's reasoning even for an instance the rider
    // runs themselves, and plainly so for the project's own instance, which is
    // ours. `shared: false`: the instance is the rider's or ours, and the
    // project's traffic passes through Cloudflare as our service provider.
    // Optional: nothing is sent until the rider types an address and presses
    // Connect, and the name itself is optional.
    dataType: 'Personal info — Name',
    collected: true,
    shared: false,
    optional: true,
    purposes: ['App functionality', 'Account management'],
    why: 'only when the rider connects to an instance (#777): the name other riders will see there, if they type one, sent to that instance each time the rider presses Connect with a name typed, and kept by it with the rider’s account only when it has not seen this device before. If the name is later changed on the instance, the instance also keeps each earlier name, and when it changed, with the account, for moderation. Nothing is sent until the rider types the instance’s address and presses Connect. An instance is one the rider chose — their own, or this project’s, whose traffic Cloudflare carries for us as our service provider. It is not kept on the device',
  },
  {
    // #777: the account an instance gives a rider, and the session that
    // identifies them to it, are an account ID in Play's sense. ⚠️ And, when
    // voice chat arrives (#794, option A; #778's comment of 2026-09-29), a
    // rider who links their Discord account has their Discord id kept by the
    // instance with their account — named here now so the filing does not
    // change silently when it ships.
    dataType: 'Personal info — User IDs',
    collected: true,
    shared: false,
    optional: true,
    purposes: ['App functionality', 'Account management'],
    why: 'only when the rider connects to an instance (#777): the instance creates an account for the rider and a sign-in session for this device, which the app sends back to it with each request so it knows who is asking. Where an instance offers voice chat on Discord (#794), a rider who links their Discord account has their Discord id kept by the instance with their account. Nothing is sent until the rider presses Connect',
  },
  {
    dataType: 'Personal info — Email address',
    collected: false,
    shared: false,
    why: 'the app has no email field anywhere. An instance’s operator may offer email recovery of an account, but this app sends no email address to an instance (#773, #777)',
  },
  {
    // ⚠️ **Re-answered by #778 for sync (#1195), and the answer CHANGED —
    // collected: true.** A reviewer who remembers "Nothing is uploaded" is
    // reading the old file. A sync sends each ride as its original activity
    // file, and the documents the rider added for the analysis (#836), to the
    // instance the rider connected to, sealed for it alone (ADR 0047 D-7).
    // Collected on #387's reasoning even for an instance the rider runs;
    // `shared: false` (the rider's instance or ours); optional (nothing syncs
    // until the press). Answered before the build that ships Sync, so Play is
    // never told less than the app does.
    dataType: 'Files and docs',
    collected: true,
    shared: false,
    optional: true,
    purposes: ['App functionality'],
    why: 'FIT, GPX and TCX files are read and written on the device at the athlete’s own request (#51). When the rider syncs with an instance they connected to (#1195), each ride’s file — the one it was recorded or imported as — and the documents the rider added for the analysis (#836) go to that instance, sealed on the device for that instance alone (ADR 0047), which keeps them with the rider’s account and shows them to no other rider. Nothing syncs until the rider presses Sync, which needs the instance’s card',
  },
  {
    dataType: 'App activity',
    collected: false,
    shared: false,
    why: 'no analytics SDK, no crash reporter and no telemetry of any kind is linked into this app. What the rider writes is answered on its own row, Other user-generated content',
  },
  {
    // #778 for sync (#1195), ADR 0040 D-11: the rider's own text is Play's
    // "Other user-generated content" (an App activity type), and it needs a
    // row of its own. A sync sends the rider's goals, ride notes and
    // documents (#836), and each ride's write-up and side-camera report, to
    // the instance they connected to, sealed for it alone. Collected,
    // optional, not shared — the Files and docs row's reasoning.
    dataType: 'App activity — Other user-generated content',
    collected: true,
    shared: false,
    optional: true,
    purposes: ['App functionality'],
    why: 'the rider’s goals, notes on their rides and the documents they added for the analysis (#836), and each ride’s write-up and side-camera report, stay on the device until the rider syncs with an instance they connected to (#1195): then they go to that instance, sealed on the device for that instance alone (ADR 0047), which keeps them with the rider’s account so a later analysis can look back at them, and shows them to no other rider. Nothing syncs until the rider presses Sync, which needs the instance’s card',
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
    // body names `shared: yes` for a HOSTED path carrying pictures, and since
    // #518 there IS a hosted path — which is never sent a picture.** The owner
    // ruled on 2026-09-28 (ADR 0029's amendment of that date): a hosted model
    // on the rider's own key, *"NUMBERS ONLY and never a picture"*, and in
    // terms that Photos and videos stays `shared: false`.
    // `apps/web/src/camera/hosted-transport.test.ts` §"a picture cannot reach
    // it" holds that by type, at run time and by what the modules can name, so
    // this row is unchanged by the hosted path, and its `why` says so.
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
    // ⚠️ **Since #553 the side camera CAN send its pictures on to the
    // rider's computer** (ADR 0033 D-11), and a reviewer who remembers "D-11
    // is not built" is reading the old file. That is #387's non-exempt path
    // carrying a continuous stream — about five a second while the side
    // camera films — so the answer stays `collected: true` and the `why`
    // names the stream, which #553's criterion asks for in terms.
    // `shared: false` still holds on Play's own words: the destination is the
    // rider's computer, and the stream runs only after the rider ticked a
    // second switch, off by default, beside a sentence saying exactly this —
    // *"a specific user-initiated action, where the user reasonably expects
    // the data to be shared"*. `optional: true` holds for the same reason.
    // Inside the shell the request is Capacitor's native HTTP rather than the
    // WebView's (the owner's 2026-09-26 ruling), which changes how it
    // travels and nothing about what this row answers.
    dataType: 'Photos and videos',
    collected: true,
    shared: false,
    optional: true,
    purposes: ['App functionality'],
    why: 'a still picture from the camera (#382, #383) is sent — only when the rider presses the button that sends it — to one computer the rider configured at an address on their own network and switched on (#387). Nothing is set up by default and nothing is sent until it is. It is not sent to this project or to an instance (#777), and not to any third party: an address that is not on the rider’s own network is refused. A picture is otherwise discarded after it has been looked at unless the rider turns on this ride’s keep (ADR 0029 D-2). Separately, a side-camera phone the rider paired by scanning sends its pictures to the rider’s own tablet over an end-to-end encrypted WebRTC data channel with no relay (#530, ADR 0033 D-1), where each is analysed on the tablet and discarded at once, never stored, shown or sent on (ADR 0033 D-6) — end-to-end encrypted transfer between the rider’s own devices, which Play exempts, and so not what makes this row collected. The one exception is a stream the rider switches on (#553, ADR 0033 D-11): with a second switch, off by default, ticked beside a sentence saying so, every side-camera picture — about five a second while the side camera films — is sent on to that same computer of the rider’s instead of being analysed on the tablet, over the same path as above, and is still not kept on the tablet. A hosted model the rider sets up on their own key (#518) is never sent a picture, nor anything made from one',
  },
  {
    // ⚠️ **Re-answered by #777, and the answer CHANGED — collected: true.** A
    // reviewer who remembers the public half travelling "only inside a file
    // the athlete exports themselves" is reading the old file: signing in to
    // an instance sends it, and the instance keeps it as one of the athlete's
    // devices (#772, #773). The private half still never leaves.
    dataType: 'Device or other IDs',
    collected: true,
    shared: false,
    optional: true,
    purposes: ['App functionality', 'Account management'],
    why: 'the device signing keypair (#61): its private half never leaves the device — it is a non-extractable CryptoKey — and its public half travels inside a file the athlete exports themselves and, only when the rider connects to an instance (#777), to that instance, which keeps it as one of the rider’s devices with when it was added and last used. Nothing is sent until the rider types the instance’s address and presses Connect',
  },
  {
    // #778's comment of 2026-09-29 (#794, option A): voice chat in a room is
    // on Discord, through Discord's own app, never through this one.
    dataType: 'Audio — Voice or sound recordings',
    collected: false,
    shared: false,
    why: 'this app records no audio and sends none. Where an instance offers voice chat in a room, it happens on Discord, a separate service the rider chooses to use through Discord’s own app: Discord receives the rider’s voice, and other riders in the voice channel see the rider’s Discord username and picture',
  },
];

/**
 * One way a collected row's data leaves the device
 * ([#562](https://github.com/openzigs/onyourleft/issues/562)).
 *
 * Play's section-level question *"Is all of the user data collected by your
 * app encrypted in transit?"* is about PATHS, not data types: one type can
 * leave by two paths, one encrypted and one not (Photos and videos does). So
 * the answer is checked against this list rather than typed beside it, and
 * {@link sectionAnswerFaults} requires every collected row to leave by at
 * least one path here — a new collected row with no path cannot slip past the
 * encryption check by being absent from it.
 */
export interface DataPath {
  /** A stable name, which {@link EncryptedInTransitAnswer.exceptions} cites. */
  readonly id: string;
  /** The {@link DataSafetyAnswer.dataType}s that travel by it. */
  readonly dataTypes: readonly string[];
  /**
   * Whether EVERY request on this path is encrypted between the device and
   * where it goes. `false` when any address the app accepts for it can be a
   * plain `http:` one across a network. `data-safety.test.ts` holds each
   * answer to the rule in `apps/web` that decides which addresses are
   * accepted, in both directions.
   */
  readonly encryptedInTransit: boolean;
  /** Why. Read in review; never asserted. */
  readonly why: string;
}

/** Every path a collected row leaves the device by. #562. */
export const DATA_PATHS: readonly DataPath[] = [
  {
    id: 'map-tiles',
    dataTypes: ['Location — approximate location'],
    encryptedInTransit: true,
    why: 'the basemap is fetched from https://tiles.openzigs.com (apps/web/src/map/basemap.ts §PUBLISHED_BASEMAP_URL); the IP address the row declares is seen over that TLS connection',
  },
  {
    id: 'instance',
    dataTypes: [
      'Location — approximate location',
      // #784: the route of a private room the rider makes.
      'Location — precise location',
      // #784, #785: power, cadence and declared weight in a room, and a race's result.
      'Health and fitness — fitness info',
      'Personal info — Name',
      'Personal info — User IDs',
      'Device or other IDs',
      // #778, #1195: what a sync sends — a ride's file, positions and heart
      // rate included, the rider's documents and their own text. Sealed
      // inside the TLS connection as well (ADR 0047 D-7).
      'Health and fitness — health info',
      'Files and docs',
      'App activity — Other user-generated content',
    ],
    encryptedInTransit: true,
    why: 'an instance is reached over https:// and wss:// only; a plain http:// address is refused unless it is this device’s own loopback (localhost), where nothing crosses a network (apps/web/src/instance/address.ts §instanceAddress). The project’s own instance is reached through Cloudflare Tunnel: TLS to Cloudflare’s edge, and an encrypted tunnel from there',
  },
  {
    id: 'own-computer',
    dataTypes: [
      'Photos and videos',
      'Health and fitness — health info',
      'Health and fitness — fitness info',
    ],
    encryptedInTransit: false,
    why: 'a picture (#387, #553) or a ride’s numbers (#804) go to a computer the rider named on their own network, and the address may be plain http:// (apps/web/src/camera/analysis-endpoint.ts §endpointDecision). It is encrypted only when the rider’s address starts with https://',
  },
  {
    id: 'hosted-model',
    dataTypes: ['Health and fitness — health info', 'Health and fitness — fitness info'],
    encryptedInTransit: true,
    why: 'a hosted model on the rider’s own key is reached over https:// only; an http:// address is refused before anything is sent (apps/web/src/camera/hosted-model.ts §hostedModelDecision, #803)',
  },
  {
    id: 'side-camera',
    dataTypes: ['Photos and videos'],
    encryptedInTransit: true,
    why: 'pictures from a paired side-camera phone to the rider’s tablet go over a WebRTC data channel, which is DTLS-encrypted and cannot be switched off (ADR 0033 D-1). Play exempts end-to-end encrypted transfer, so this path is not what makes the Photos row collected; it is listed so the encryption answer covers every way a picture moves',
  },
];

/**
 * The Play Console Help page the section-level answers were read against, and
 * what it said. #562's criterion asks for a cited reading, dated.
 */
export const SECTION_ANSWERS_PLAY_HELP = {
  title: 'Provide information for Google Play’s Data safety section',
  url: 'https://support.google.com/googleplay/android-developer/answer/10787469',
  read: '2026-09-30',
  encryption:
    'the form asks “whether or not all of the user data collected by your app is encrypted in transit”, answered Yes or No, and says to “follow best industry standards to safely encrypt your app’s data in transit. Common encryption protocols include TLS (Transport Layer Security) and HTTPS.” The form has no field for an exception',
  deletion:
    'the form asks “whether or not you provide a way for users to request that their data is deleted”, answered Yes or No. “There is no prescribed mechanism … Common examples … may include but are not limited to: in-app features, contact forms, or a dedicated email alias.” Its FAQ allows the answer “if you provide users with a mechanism to request data deletion; or automatically initiate deletion or anonymization of collected data within 90 days of collection”',
} as const;

/** Where a rider sends a request to delete what this project holds. #562. */
export const DELETION_REQUEST_EMAIL = 'matt@openzigs.ai';

/** Play's *"Is all of the user data collected by your app encrypted in transit?"* */
export interface EncryptedInTransitAnswer {
  readonly answer: boolean;
  /**
   * The {@link DataPath.id}s of every path that is NOT encrypted, when the
   * answer is Yes anyway. Play's form cannot carry them; the privacy policy
   * does, and `data-safety.test.ts` holds it to saying so.
   */
  readonly exceptions: readonly string[];
  readonly why: string;
}

/** Play's *"Do you provide a way for users to request that their data is deleted?"* */
export interface DeletionRequestAnswer {
  readonly answer: boolean;
  /** How a rider asks, in words. Required when the answer is Yes. */
  readonly how: string;
  readonly why: string;
}

/** The section-level answers, filed once for the whole form. #562. */
export interface DataSafetySectionAnswers {
  readonly encryptedInTransit: EncryptedInTransitAnswer;
  readonly deletionRequests: DeletionRequestAnswer;
}

/**
 * The section-level answers filed on Play, beside the per-type rows above.
 *
 * ⚠️ **Both are the owner's decisions of 2026-09-30, on #562**, and the
 * owner enters them in Play Console; this file is the record a reviewer reads.
 *
 * ⚠️ **"Encrypted in transit" is Yes with one exception, and Play's form has
 * no place to state the exception.** #562's own body expected No, because the
 * rider's own computer can be a plain `http:` address. The owner chose Yes and
 * to disclose the exception, which the privacy policy does (**Pictures sent to
 * your own computer**, **A ride sent to your own computer**). The owner's
 * words named *"a picture"*; the same path carries a ride's numbers since
 * #804, so the exception is the PATH, and both are named.
 */
export const DATA_SAFETY_SECTION_ANSWERS: DataSafetySectionAnswers = {
  encryptedInTransit: {
    answer: true,
    exceptions: ['own-computer'],
    why: 'the owner’s decision of 2026-09-30 (#562): Yes, with one stated exception. Map tile requests, an instance and a hosted model are reached over https:// (or wss://) only, and a side camera’s pictures travel over an encrypted WebRTC channel. The exception is a picture or a ride’s numbers the rider sends to a computer on their own home network, which can travel over plain http:// — the privacy policy says so where it describes that computer. Play’s form is Yes or No and cannot carry the exception',
  },
  deletionRequests: {
    answer: true,
    how: `by email to ${DELETION_REQUEST_EMAIL}, until in-app deletion on an instance (#906) ships`,
    why: `the owner’s decision of 2026-09-30 (#562): Yes. What this project holds about a rider is their account on the project’s own instance — its device keys, display name and earlier names, account id and any linked Discord id, which private rooms they made or joined and their results in any race they rode there, and, while a room they made is open, its route, which erasing the account ends the room and deletes — and everything the rider synced to it (#1195): their rides and their files, write-ups, side-camera reports, ride summaries, goals, notes and documents — and a request to ${DELETION_REQUEST_EMAIL} is how it is deleted until #906 adds deletion in the app. Cloudflare’s record of map and instance requests (the IP address, the time, and the device or browser type) is Cloudflare’s, not this project’s: this project can see it for up to 7 days and cannot delete it on request, and how long Cloudflare itself keeps it is not something this project controls or can confirm. This answer rests on the deletion requests this project can act on, not on that record. A picture or a ride’s numbers sent to the rider’s own computer is held by that computer, and anything sent to a hosted service on the rider’s own key is held by that service, not by this project. Everything else is on the device, where Files → Erase this device deletes it`,
  },
};

/**
 * Every reason the section-level answers are not supported by the rows and
 * the paths — empty when they are. #562.
 *
 * Reasons rather than a boolean, for {@link locationClaimFaults}' reason.
 */
export function sectionAnswerFaults(
  declaration: readonly DataSafetyAnswer[],
  paths: readonly DataPath[],
  section: DataSafetySectionAnswers | undefined,
): readonly string[] {
  const faults: string[] = [];
  const collected = declaration.filter((row) => row.collected).map((row) => row.dataType);
  if (collected.length === 0) {
    return faults;
  }
  if (section === undefined) {
    faults.push(
      `${String(collected.length)} rows are collected and the section-level answers are absent`,
    );
    return faults;
  }
  for (const dataType of collected) {
    if (!paths.some((path) => path.dataTypes.includes(dataType))) {
      faults.push(`${dataType} is collected and leaves by no recorded path`);
    }
  }
  for (const path of paths) {
    for (const dataType of path.dataTypes) {
      if (!collected.includes(dataType)) {
        faults.push(`path ${path.id} carries ${dataType}, which is not a collected row`);
      }
    }
  }
  const { encryptedInTransit, deletionRequests } = section;
  const unencrypted = paths.filter((path) => !path.encryptedInTransit).map((path) => path.id);
  if (encryptedInTransit.answer) {
    for (const id of unencrypted) {
      if (!encryptedInTransit.exceptions.includes(id)) {
        faults.push(
          `encrypted in transit is answered Yes, and path ${id} can be plain http without being a stated exception`,
        );
      }
    }
  }
  for (const id of encryptedInTransit.exceptions) {
    if (!unencrypted.includes(id)) {
      faults.push(`exception ${id} names no unencrypted path`);
    }
  }
  if (deletionRequests.answer && deletionRequests.how.trim() === '') {
    faults.push('deletion requests are answered Yes with no way to make one');
  }
  return faults;
}

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
