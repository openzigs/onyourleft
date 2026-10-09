// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #95's fifth criterion, in the only form a repository can hold it.
 *
 * The criterion is *"the Data Safety form declares no location collection, and
 * a reviewer has confirmed the merged manifest supports that claim"*. A
 * reviewer's confirmation is a moment; this is the part of it that survives the
 * next dependency bump.
 *
 * Three layers, deliberately, because each can be green while the next is red:
 *
 * 1. **The rule against fixtures.** `locationClaimFaults` is the thing doing
 *    the work, so it gets a permission list it should accept and four it must
 *    not. Without these the rule could return `[]` unconditionally and every
 *    assertion below would agree with it.
 * 2. **The rule against the reviewed list.** `REVIEWED_PERMISSIONS` is what
 *    #318 established the shipped app carries, and it runs on a clean clone.
 * 3. **The rule against the artefact.** The merged manifest, when a Gradle
 *    build has produced one. It **skips loudly** otherwise — CI does not build
 *    Android (docs/agents/ci.md §4c) — because a silent skip here is exactly #318's
 *    defect, one layer in.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import type { TestContext } from 'vitest';

import { endpointDecision } from '../../../web/src/camera/analysis-endpoint';
import { hostedModelDecision } from '../../../web/src/camera/hosted-model';
import { instanceAddress } from '../../../web/src/instance/address';
import {
  DATA_PATHS,
  DATA_SAFETY_SECTION_ANSWERS,
  DELETION_REQUEST_EMAIL,
  SECTION_ANSWERS_PLAY_HELP,
  sectionAnswerFaults,
  type DataPath,
  type DataSafetySectionAnswers,
  DATA_SAFETY_DECLARATION,
  FORBIDDEN_LOCATION_PERMISSIONS,
  LEGACY_SCAN_MAX_SDK,
  LOCATION_PERMISSIONS,
  NEVER_FOR_LOCATION,
  SCAN_PERMISSION,
  locationClaimFaults,
  type PermissionLike,
} from './data-safety';
import { usesPermissions } from './manifest';
import {
  MERGED_MANIFEST_SKIPPED,
  REVIEWED_PERMISSIONS,
  mergedManifestAbsence,
  mergedManifests,
  type MergedManifest,
} from './merged-manifest';

/** The permission list a compliant build has, reduced to what the rule reads. */
const COMPLIANT: readonly PermissionLike[] = [
  { name: SCAN_PERMISSION, maxSdkVersion: null, flags: NEVER_FOR_LOCATION },
  { name: 'android.permission.BLUETOOTH_CONNECT', maxSdkVersion: null, flags: null },
  {
    name: 'android.permission.ACCESS_FINE_LOCATION',
    maxSdkVersion: LEGACY_SCAN_MAX_SDK,
    flags: null,
  },
];

describe('the rule that decides whether the declaration is still true', () => {
  it('accepts a legacy location permission bounded at the version it stopped being needed', () => {
    expect(locationClaimFaults(COMPLIANT)).toEqual([]);
  });

  it('rejects a location permission with no bound at all', () => {
    const faults = locationClaimFaults([
      ...COMPLIANT.filter((one) => one.name !== 'android.permission.ACCESS_FINE_LOCATION'),
      { name: 'android.permission.ACCESS_FINE_LOCATION', maxSdkVersion: null, flags: null },
    ]);
    expect(faults).toHaveLength(1);
    expect(faults[0]).toContain('ACCESS_FINE_LOCATION');
    expect(faults[0]).toContain('unbounded');
  });

  it('rejects a bound above the level at which a scan stopped needing one', () => {
    // One apart from the compliant case, and it is the whole difference between
    // "applies to Android 11 and older" and "applies to the phone in your hand".
    const faults = locationClaimFaults([
      {
        name: 'android.permission.ACCESS_COARSE_LOCATION',
        maxSdkVersion: LEGACY_SCAN_MAX_SDK + 1,
        flags: null,
      },
    ]);
    expect(faults).toHaveLength(1);
    expect(faults[0]).toContain(`API ${String(LEGACY_SCAN_MAX_SDK + 1)}`);
  });

  it('rejects background location however it is bounded', () => {
    for (const bound of [null, LEGACY_SCAN_MAX_SDK, 36]) {
      const faults = locationClaimFaults([
        {
          name: 'android.permission.ACCESS_BACKGROUND_LOCATION',
          maxSdkVersion: bound,
          flags: null,
        },
      ]);
      expect(faults, `bounded at ${String(bound)}`).toHaveLength(1);
      expect(faults[0]).toContain('no version range in which it is needed');
    }
  });

  it('rejects a scan that does not assert it is never for location', () => {
    const faults = locationClaimFaults([
      { name: SCAN_PERMISSION, maxSdkVersion: null, flags: null },
    ]);
    expect(faults).toHaveLength(1);
    expect(faults[0]).toContain(NEVER_FOR_LOCATION);
  });

  it('reads the flag out of a list rather than requiring it to stand alone', () => {
    // android:usesPermissionFlags is a flag set. A future second flag beside
    // neverForLocation must not read as its absence.
    expect(
      locationClaimFaults([
        {
          name: SCAN_PERMISSION,
          maxSdkVersion: null,
          flags: `${NEVER_FOR_LOCATION}|someFutureFlag`,
        },
      ]),
    ).toEqual([]);
  });

  it('names every location permission Android has, not only the two we declare', () => {
    // A list that had drifted to hold only the permissions this app already
    // carries would accept an injected one silently, which is the case it
    // exists for.
    expect(LOCATION_PERMISSIONS).toContain('android.permission.ACCESS_BACKGROUND_LOCATION');
    for (const forbidden of FORBIDDEN_LOCATION_PERMISSIONS) {
      expect(LOCATION_PERMISSIONS).toContain(forbidden);
    }
  });
});

describe('the declaration filed on Play', () => {
  it('declares approximate location collected for the map, optional and not shared — #558', () => {
    // ⚠️ #534's answer was `collected: false` on Play's ephemeral-processing
    // exemption, and #558 measured it false: the tile host's standard
    // analytics keep the IP address, the time and the user agent of each
    // request for up to 7 days.
    const approximate = DATA_SAFETY_DECLARATION.find(
      (answer) => answer.dataType === 'Location — approximate location',
    );
    expect(approximate, 'the form has no approximate-location row').toBeDefined();
    expect(approximate?.collected).toBe(true);
    // Cloudflare is a service provider processing for this project.
    expect(approximate?.shared).toBe(false);
    // Settings → Ride map turns the request off and the app still works.
    expect(approximate?.optional).toBe(true);
    expect(approximate?.purposes).toStrictEqual(['App functionality']);
    // The `why` is what is filed; it has to say what is kept and for how long.
    expect(approximate?.why).toContain('up to 7 days');
    expect(approximate?.why).toContain('IP address');
    expect(approximate?.why).toContain('does not use or share');
  });

  it('names the instance’s traffic under approximate location, and when a name is sent — #892 review', () => {
    const approximate = DATA_SAFETY_DECLARATION.find(
      (answer) => answer.dataType === 'Location — approximate location',
    );
    const name = DATA_SAFETY_DECLARATION.find(
      (answer) => answer.dataType === 'Personal info — Name',
    );
    // The instance sees the IP address too; what the project's own keeps, and
    // Cloudflare's record of it, are said, not left to the tile clause.
    expect(approximate?.why).toContain('Connecting to an instance (#777)');
    expect(approximate?.why).toContain('does not write the address to its log or its database');
    expect(approximate?.why).toContain('Cloudflare Tunnel');
    // A typed name is sent on every Connect, kept only the first time.
    expect(name?.why).toContain('each time the rider presses Connect with a name typed');
    expect(name?.why).toContain('only when it has not seen this device before');
    expect(name?.why).toContain('each earlier name');
    expect(name?.why).not.toContain(
      'sent to that instance when it has not seen this device before',
    );
  });

  it('rests approximate-not-precise on what is KEPT, not on a tile being an area — #559', () => {
    // #559's review: Play draws the line by area (precise < 3 km²) and a z15
    // tile is 0.64–1.23 km², so "a tile names an area, not a point" would make
    // the row PRECISE if the tile were retained. It is not: the basemap is one
    // PMTiles file, the tile is chosen by a Range header the analytics do not
    // record, and every request's path is the same (measured 2026-09-26). The
    // filed words have to say that, or the next reader flips the row for the
    // wrong reason — or keeps it for one.
    const approximate = DATA_SAFETY_DECLARATION.find(
      (answer) => answer.dataType === 'Location — approximate location',
    );
    const precise = DATA_SAFETY_DECLARATION.find(
      (answer) => answer.dataType === 'Location — precise location',
    );
    expect(approximate?.why).toContain('not which part of the map');
    expect(approximate?.why).toContain('byte range that the record does not include');
    expect(approximate?.why).not.toContain('tile path');
    expect(approximate?.why).not.toContain('roughly where the ride was');
    expect(precise?.why).toContain('handled while the request is served and not kept');
  });

  it('declares a room’s route as precise location collected, optional and not shared — #784', () => {
    // Until #784 this row was `collected: false`: no position ever left. A
    // private room's route does — to the instance, and to the riders its maker
    // gives the code to — so the row says so, and says what keeps it narrow.
    const precise = DATA_SAFETY_DECLARATION.find(
      (answer) => answer.dataType === 'Location — precise location',
    );
    expect(
      precise,
      'the form has a precise-location row whether or not we collect any',
    ).toBeDefined();
    expect(precise?.collected).toBe(true);
    expect(precise?.shared).toBe(false);
    expect(precise?.optional).toBe(true);
    expect(precise?.why).toContain('make a private room on');
    expect(precise?.why).toContain('refused before anything is sent');
    expect(precise?.why).toContain('deletes it when the room is over');
    // #784's review (B1, B2): every way a room is over, the unridden one's bound
    // and the maker's erasure included — the instance's rooms.ts does all five.
    expect(precise?.why).toContain('nobody riding in it a day after it was made');
    expect(precise?.why).toContain('the maker erasing their account there');
    expect(DATA_SAFETY_SECTION_ANSWERS.deletionRequests.why).toContain(
      'which erasing the account ends the room and deletes',
    );
    // Still never the device's own location: no GPS fix. A ride's positions
    // leave only by a sync the rider presses (#778, #1195).
    expect(precise?.why).toContain('the app requests no GPS fix');
    expect(precise?.why).toContain(
      'A ride’s positions leave the device only when the rider syncs with an instance',
    );
    expect(precise?.why).not.toContain('never transmits a ride’s positions');
  });

  it('gives every collected row a purpose, and no uncollected row one', () => {
    for (const answer of DATA_SAFETY_DECLARATION) {
      if (answer.collected) {
        expect(answer.purposes?.length ?? 0, answer.dataType).toBeGreaterThan(0);
        expect(answer.optional, answer.dataType).toBeDefined();
      } else {
        expect(answer.purposes, answer.dataType).toBeUndefined();
      }
    }
  });

  it('answers the health rows rather than omitting them', () => {
    // Play's Health policy covers an app that is not primarily a health app but
    // advances gameplay with activity data, which is this one (#95). Omitting
    // the rows is the failure, not answering them "no".
    const health = DATA_SAFETY_DECLARATION.filter((answer) =>
      answer.dataType.startsWith('Health and fitness'),
    );
    expect(health.length).toBeGreaterThanOrEqual(2);
  });

  it('answers both health rows as collected, optional and SHARED — #804, #803', () => {
    // #804's press sends a ride's heart rate, power and cadence, as numbers,
    // to the rider's own computer — collected. #803 sends the same to a hosted
    // model on the rider's own key, a third party the rider chose — shared
    // (the owner's ruling 4 on #795), re-filed in the same pull request.
    for (const dataType of [
      'Health and fitness — health info',
      'Health and fitness — fitness info',
    ]) {
      const answer = DATA_SAFETY_DECLARATION.find((row) => row.dataType === dataType);
      expect(answer, dataType).toBeDefined();
      expect(answer?.collected, dataType).toBe(true);
      expect(answer?.shared, dataType).toBe(true);
      expect(answer?.optional, dataType).toBe(true);
      expect(answer?.purposes, dataType).toStrictEqual(['App functionality']);
      expect(answer?.why, dataType).toContain('#804');
      expect(answer?.why, dataType).toContain('their own network');
      expect(answer?.why, dataType).toContain('#803');
      expect(answer?.why, dataType).toContain('hosted model service the rider chose');
    }
  });

  it('says the climb a ride analysis sends is a difference, not an altitude — #847', () => {
    // The row declares no location, and says no altitude is sent. A total
    // climb is a height, so the row says what kind: #848's review asked for
    // it in words rather than left for a reviewer to infer.
    const fitness = DATA_SAFETY_DECLARATION.find(
      (row) => row.dataType === 'Health and fitness — fitness info',
    );
    expect(fitness?.why).toContain('total climb (the height gained over the section');
    expect(fitness?.why).toContain('a difference between two heights and never an altitude');
    expect(fitness?.why).toContain('No position, altitude, date or identifier is sent');
  });

  it('answers the photos row as collected, optional and not shared — #387', () => {
    // ⚠️ **Re-filed in the same pull request as the first byte**, which is
    // #377's epic criterion: the declaration is true of the shipped app at
    // every point, not only at the end. `apps/web/src/privacy/no-network.test.ts`
    // permits exactly one network call in the client, and it sends a picture
    // to the rider's own computer — so this row cannot say `false` any more.
    const photos = DATA_SAFETY_DECLARATION.find((answer) => answer.dataType.startsWith('Photos'));
    expect(photos, 'the app has a camera and the form has no Photos row').toBeDefined();
    expect(photos?.collected).toBe(true);
    expect(photos?.optional).toBe(true);
    // Not a third party: the rider's own machine, on a press. A hosted path
    // would make this `true`, and is not built.
    expect(photos?.shared).toBe(false);
    expect(photos?.why).toContain('#387');
  });

  it('answers the photos row for the side camera too — #530, ADR 0033 D-10', () => {
    // D-10: *"#530 reads Play's text first-hand and answers for BOTH paths in
    // one row"*. A `why` that still described only #387's path would be a
    // filing that says nothing about the pictures the side camera sends.
    const photos = DATA_SAFETY_DECLARATION.find((answer) => answer.dataType.startsWith('Photos'));
    expect(photos?.why).toContain('#530');
    expect(photos?.why).toContain('end-to-end encrypted');
    expect(photos?.why).toContain('never stored, shown or sent on');
  });

  it('names the side camera’s stream to the rider’s computer — #553, ADR 0033 D-11', () => {
    // #553's criterion: "The Photos row's `why` names the stream."
    const photos = DATA_SAFETY_DECLARATION.find((answer) => answer.dataType.startsWith('Photos'));
    expect(photos?.why).toContain('#553');
    expect(photos?.why).toContain('about five a second');
    expect(photos?.why).toContain('off by default');
    expect(photos?.collected).toBe(true);
    expect(photos?.shared).toBe(false);
  });

  it('collects nothing else — the map, the camera, the post-ride ask, an instance and its rooms, and nothing more', () => {
    const collected = DATA_SAFETY_DECLARATION.filter((answer) => answer.collected).map(
      (answer) => answer.dataType,
    );
    expect(collected).toStrictEqual([
      'Location — approximate location',
      // #784: the route of a private room the rider makes.
      'Location — precise location',
      'Health and fitness — health info',
      'Health and fitness — fitness info',
      'Personal info — Name',
      'Personal info — User IDs',
      // #778, #1195: what a sync sends.
      'Files and docs',
      'App activity — Other user-generated content',
      'Photos and videos',
      'Device or other IDs',
    ]);
    // Shared: the health rows alone, since #803. Photos and videos, and every
    // location row, stay `shared: false` — the hosted path is never sent a
    // picture and nothing it is sent carries a coordinate.
    expect(
      DATA_SAFETY_DECLARATION.filter((answer) => answer.shared).map((answer) => answer.dataType),
    ).toStrictEqual(['Health and fitness — health info', 'Health and fitness — fitness info']);
  });

  it('adding the camera permission leaves the location claim untouched', () => {
    // ⚠️ #383's own criterion: *"`locationClaimFaults` still passes"*. A camera
    // is not a location permission, and `ACCESS_MEDIA_LOCATION` — which IS one,
    // and which an app that read images off the device would be tempted by — is
    // in `FORBIDDEN_LOCATION_PERMISSIONS` and stays out of the manifest. This
    // app never reads an image it did not just take.
    const camera = REVIEWED_PERMISSIONS.find((one) => one.name === 'android.permission.CAMERA');
    expect(camera, 'the reviewed list has no CAMERA entry').toBeDefined();
    expect(locationClaimFaults(REVIEWED_PERMISSIONS)).toEqual([]);
    expect(LOCATION_PERMISSIONS).not.toContain('android.permission.CAMERA');
  });

  it('answers what connecting to an instance sends, optional and not shared — #777, #778', () => {
    // #778's criterion: the answers are revised for the build that ships
    // instance support. Signing in sends the device's public key and, when
    // typed, a display name; the instance gives the rider an account.
    for (const dataType of [
      'Device or other IDs',
      'Personal info — Name',
      'Personal info — User IDs',
    ]) {
      const answer = DATA_SAFETY_DECLARATION.find((row) => row.dataType === dataType);
      expect(answer, dataType).toBeDefined();
      expect(answer?.collected, dataType).toBe(true);
      expect(answer?.shared, dataType).toBe(false);
      expect(answer?.optional, dataType).toBe(true);
      expect(answer?.purposes, dataType).toStrictEqual(['App functionality', 'Account management']);
      expect(answer?.why, dataType).toContain('#777');
      expect(answer?.why, dataType).toContain('Connect');
    }
    // The old single row, and its "no sign-in" claim, are gone rather than
    // left beside the new ones.
    expect(DATA_SAFETY_DECLARATION.some((row) => row.dataType === 'Personal info')).toBe(false);
    expect(DATA_SAFETY_DECLARATION.map((row) => row.why).join(' ')).not.toContain('no sign-in');
    // No email: the app has no field for one.
    const email = DATA_SAFETY_DECLARATION.find(
      (row) => row.dataType === 'Personal info — Email address',
    );
    expect(email?.collected).toBe(false);
  });

  it('names Discord for voice chat, and collects no audio itself — #778, #794', () => {
    const audio = DATA_SAFETY_DECLARATION.find((row) => row.dataType.startsWith('Audio'));
    expect(audio?.collected).toBe(false);
    expect(audio?.why).toContain('Discord');
    expect(audio?.why).toContain('username and picture');
    const ids = DATA_SAFETY_DECLARATION.find((row) => row.dataType === 'Personal info — User IDs');
    expect(ids?.why).toContain('Discord id');
  });

  it('sends an instance a position only as a room’s route or a synced ride — #777, #784, #778', () => {
    // #778: the location rule must pass with the new declaration, not be
    // deleted. Connecting sends no position; making a room sends its route.
    const precise = DATA_SAFETY_DECLARATION.find(
      (answer) => answer.dataType === 'Location — precise location',
    );
    expect(precise?.why).toContain('Connecting to an instance (#777) sends no position of its own');
    expect(locationClaimFaults(REVIEWED_PERMISSIONS)).toEqual([]);
    // The route leaves by the instance's path, which is encrypted.
    const instance = DATA_PATHS.find((path) => path.id === 'instance');
    expect(instance?.dataTypes).toContain('Location — precise location');
    expect(instance?.encryptedInTransit).toBe(true);
  });

  it('answers what a sync sends before the build that offers it — #778, #1195', () => {
    // #1195 is blocked by #778: Play must never be told less than the app
    // does, so every row a sync moves is answered here, before Sync ships.
    const row = (dataType: string) =>
      DATA_SAFETY_DECLARATION.find((answer) => answer.dataType === dataType);
    const instance = DATA_PATHS.find((path) => path.id === 'instance');
    for (const dataType of [
      'Location — precise location',
      'Health and fitness — health info',
      'Health and fitness — fitness info',
      'Files and docs',
      'App activity — Other user-generated content',
    ]) {
      const answer = row(dataType);
      expect(answer?.collected, dataType).toBe(true);
      expect(answer?.optional, dataType).toBe(true);
      expect(answer?.why, dataType).toContain('#1195');
      expect(answer?.why, dataType).toContain('sealed on the device for that instance alone');
      expect(answer?.why, dataType).toContain('which needs the instance’s card');
      expect(instance?.dataTypes, dataType).toContain(dataType);
    }
    // The rider's own copy on an instance they chose is not a third party:
    // the rows sync alone moves stay unshared.
    expect(row('Files and docs')?.shared).toBe(false);
    expect(row('App activity — Other user-generated content')?.shared).toBe(false);
    expect(row('Files and docs')?.why).not.toContain('Nothing is uploaded');
    expect(row('Health and fitness — health info')?.why).not.toContain(
      'sends none of it to an instance',
    );
    expect(DATA_SAFETY_SECTION_ANSWERS.deletionRequests.why).toContain(
      'everything the rider synced to it',
    );
    // #1215's review: a ride is sent as a FIT file this app writes, and its
    // signed record carries the ride's name and date.
    for (const dataType of ['Location — precise location', 'Files and docs']) {
      const why = row(dataType)?.why ?? '';
      expect(why, dataType).not.toContain('as the file it was recorded or imported as');
      expect(why, dataType).toContain('a FIT file the app writes from the ride');
    }
    // And the location rule still passes with the new declaration (#778).
    expect(locationClaimFaults(REVIEWED_PERMISSIONS)).toEqual([]);
  });

  it('names what a room sends and what a race publishes in the fitness row — #784, #785', () => {
    const fitness = DATA_SAFETY_DECLARATION.find(
      (answer) => answer.dataType === 'Health and fitness — fitness info',
    );
    expect(fitness?.why).toContain('their power and cadence twice a second while they ride in it');
    expect(fitness?.why).toContain('the weight they declare once as they join');
    expect(fitness?.why).toContain('power-to-weight and never watts');
    expect(DATA_PATHS.find((path) => path.id === 'instance')?.dataTypes).toContain(
      'Health and fitness — fitness info',
    );
  });

  it('gives a reason for every answer', () => {
    for (const answer of DATA_SAFETY_DECLARATION) {
      expect(answer.why.length, answer.dataType).toBeGreaterThan(20);
    }
  });
});

/* -------------------------------------------------------------------------- *
 * The section-level answers — #562.
 * -------------------------------------------------------------------------- */

const pathById = (id: string): DataPath => {
  const found = DATA_PATHS.find((path) => path.id === id);
  if (found === undefined) {
    throw new Error(`no path ${id}`);
  }
  return found;
};

const POLICY = readFileSync(
  new URL('../../../../docs/privacy-policy.md', import.meta.url),
  'utf8',
).replace(/\s+/g, ' ');

const policySection = (heading: string): string => {
  const start = POLICY.indexOf(`## ${heading}`);
  expect(start, heading).toBeGreaterThanOrEqual(0);
  const end = POLICY.indexOf('## ', start + 3);
  return POLICY.slice(start, end === -1 ? undefined : end);
};

describe('the section-level answers filed on Play — #562', () => {
  it('are supported by the rows and the paths as filed', () => {
    expect(
      sectionAnswerFaults(DATA_SAFETY_DECLARATION, DATA_PATHS, DATA_SAFETY_SECTION_ANSWERS),
    ).toEqual([]);
  });

  it('are required once any row is collected', () => {
    // The declaration as filed collects seven rows, so this is the live case.
    expect(DATA_SAFETY_DECLARATION.some((row) => row.collected)).toBe(true);
    const faults = sectionAnswerFaults(DATA_SAFETY_DECLARATION, DATA_PATHS, undefined);
    expect(faults).toHaveLength(1);
    expect(faults[0]).toContain('section-level answers are absent');
  });

  it('are not required when nothing is collected', () => {
    const nothing = DATA_SAFETY_DECLARATION.map((row) => ({ ...row, collected: false }));
    expect(sectionAnswerFaults(nothing, [], undefined)).toEqual([]);
  });

  it('refuse a Yes to encrypted in transit while an http path is not a stated exception', () => {
    const unstated: DataSafetySectionAnswers = {
      ...DATA_SAFETY_SECTION_ANSWERS,
      encryptedInTransit: { ...DATA_SAFETY_SECTION_ANSWERS.encryptedInTransit, exceptions: [] },
    };
    const faults = sectionAnswerFaults(DATA_SAFETY_DECLARATION, DATA_PATHS, unstated);
    expect(faults).toEqual([
      'encrypted in transit is answered Yes, and path own-computer can be plain http without being a stated exception',
    ]);
  });

  it('accept a No to encrypted in transit with an http path', () => {
    const no: DataSafetySectionAnswers = {
      ...DATA_SAFETY_SECTION_ANSWERS,
      encryptedInTransit: { answer: false, exceptions: [], why: 'a control' },
    };
    expect(sectionAnswerFaults(DATA_SAFETY_DECLARATION, DATA_PATHS, no)).toEqual([]);
  });

  it('refuse an exception that names no unencrypted path', () => {
    const stale: DataSafetySectionAnswers = {
      ...DATA_SAFETY_SECTION_ANSWERS,
      encryptedInTransit: {
        ...DATA_SAFETY_SECTION_ANSWERS.encryptedInTransit,
        exceptions: ['own-computer', 'map-tiles'],
      },
    };
    expect(sectionAnswerFaults(DATA_SAFETY_DECLARATION, DATA_PATHS, stale)).toEqual([
      'exception map-tiles names no unencrypted path',
    ]);
  });

  it('refuse a collected row that leaves by no recorded path', () => {
    // Without this a new collected row could escape the encryption check by
    // simply not being in DATA_PATHS.
    const without = DATA_PATHS.map((path) => ({
      ...path,
      dataTypes: path.dataTypes.filter((type) => type !== 'Personal info — Name'),
    }));
    expect(
      sectionAnswerFaults(DATA_SAFETY_DECLARATION, without, DATA_SAFETY_SECTION_ANSWERS),
    ).toEqual(['Personal info — Name is collected and leaves by no recorded path']);
  });

  it('refuse a path that carries a row declared not collected', () => {
    const extra = [
      ...DATA_PATHS,
      { id: 'extra', dataTypes: ['App activity'], encryptedInTransit: true, why: 'a control' },
    ];
    expect(
      sectionAnswerFaults(DATA_SAFETY_DECLARATION, extra, DATA_SAFETY_SECTION_ANSWERS),
    ).toEqual(['path extra carries App activity, which is not a collected row']);
  });

  it('refuse a Yes to deletion requests with no way to make one', () => {
    const blank: DataSafetySectionAnswers = {
      ...DATA_SAFETY_SECTION_ANSWERS,
      deletionRequests: { ...DATA_SAFETY_SECTION_ANSWERS.deletionRequests, how: ' ' },
    };
    expect(sectionAnswerFaults(DATA_SAFETY_DECLARATION, DATA_PATHS, blank)).toEqual([
      'deletion requests are answered Yes with no way to make one',
    ]);
  });

  it('record the owner’s answers of 2026-09-30: Yes, and Yes by email', () => {
    const { encryptedInTransit, deletionRequests } = DATA_SAFETY_SECTION_ANSWERS;
    expect(encryptedInTransit.answer).toBe(true);
    expect(encryptedInTransit.exceptions).toEqual(['own-computer']);
    expect(deletionRequests.answer).toBe(true);
    expect(DELETION_REQUEST_EMAIL).toBe('matt@openzigs.ai');
    expect(deletionRequests.how).toContain(DELETION_REQUEST_EMAIL);
    expect(deletionRequests.how).toContain('#906');
    for (const answer of [encryptedInTransit, deletionRequests]) {
      expect(answer.why).toContain('2026-09-30');
    }
  });

  it('cite the Play Console Help page they were read against, dated', () => {
    expect(SECTION_ANSWERS_PLAY_HELP.url).toMatch(/^https:\/\/support\.google\.com\//);
    expect(SECTION_ANSWERS_PLAY_HELP.read).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(SECTION_ANSWERS_PLAY_HELP.encryption).toContain('encrypted in transit');
    expect(SECTION_ANSWERS_PLAY_HELP.deletion).toContain('request that their data is deleted');
  });

  it('give a reason for every path', () => {
    for (const path of DATA_PATHS) {
      expect(path.why.length, path.id).toBeGreaterThan(20);
    }
  });
});

describe('each path’s encryption answer is the one the client enforces — #562', () => {
  // A path's `encryptedInTransit` is a claim about which addresses the client
  // accepts. Each is held to the rule that decides it, in the direction that
  // would make the answer wrong.

  it('the rider’s own computer accepts a plain http address, so that path is not encrypted', () => {
    const plain = endpointDecision({
      address: 'http://192.168.1.20:8080',
      model: 'a-model',
      switchedOn: true,
    });
    expect(plain.refusal).toBeUndefined();
    expect(pathById('own-computer').encryptedInTransit).toBe(plain.endpoint === undefined);
  });

  it('a hosted model refuses a plain http address, so that path is encrypted', () => {
    const plain = hostedModelDecision({
      address: 'http://models.example',
      model: 'a-model',
      key: 'a-key',
    });
    expect(plain.refusal).toBe('not-https');
    expect(pathById('hosted-model').encryptedInTransit).toBe(plain.model === undefined);
  });

  it('an instance refuses plain http across a network, and admits it only to this device', () => {
    expect(instanceAddress('http://ride.example').kind).toBe('refused');
    expect(instanceAddress('http://192.168.1.20:8787').kind).toBe('refused');
    // Loopback is admitted, and never leaves the device, so it is not transit.
    expect(instanceAddress('http://localhost:8787').kind).toBe('accepted');
    expect(pathById('instance').encryptedInTransit).toBe(true);
  });

  it('the map is fetched over https', () => {
    // Read as text: `basemap.ts` reads `import.meta.env`, which this package's
    // program has no types for, so importing it would not typecheck here.
    const basemap = readFileSync(
      new URL('../../../web/src/map/basemap.ts', import.meta.url),
      'utf8',
    );
    const published = /PUBLISHED_BASEMAP_URL = '([^']+)'/.exec(basemap)?.[1];
    expect(published, 'PUBLISHED_BASEMAP_URL').toBeDefined();
    expect(new URL(published ?? '').protocol).toBe('https:');
    expect(pathById('map-tiles').encryptedInTransit).toBe(true);
  });
});

describe('the privacy policy agrees with the section-level answers — #562', () => {
  it('discloses the exception wherever the rider’s own computer is described', () => {
    // Play's form cannot carry the exception to its Yes, so the policy is the
    // only place a rider can read it.
    expect(pathById('own-computer').encryptedInTransit).toBe(false);
    expect(policySection('Pictures sent to your own computer')).toContain(
      'not encrypted on the way',
    );
    expect(policySection('A ride sent to your own computer')).toContain('not encrypted on the way');
  });

  it('says everything else travels encrypted, naming the one exception', () => {
    const leaves = policySection('What leaves the device');
    expect(leaves).toContain('encrypted on the way');
    expect(leaves).toContain('except');
    expect(leaves).toContain('your own computer');
  });

  it('names the deletion address where it says how to delete, and in Contact', () => {
    expect(policySection('Deleting your data')).toContain(DELETION_REQUEST_EMAIL);
    expect(policySection('Contact')).toContain(DELETION_REQUEST_EMAIL);
    expect(POLICY).toContain(`**Deleting what an instance holds.**`);
    const instance = POLICY.slice(POLICY.indexOf('**Deleting what an instance holds.**'));
    expect(instance.slice(0, 600)).toContain(DELETION_REQUEST_EMAIL);
  });
});

describe('the reviewed permission list supports the declaration', () => {
  it('has no fault in it', () => {
    expect(locationClaimFaults(REVIEWED_PERMISSIONS)).toEqual([]);
  });

  it('is a list that would have faults if the bound were dropped', () => {
    // The control. `locationClaimFaults(REVIEWED_PERMISSIONS)` being empty is
    // only evidence if this list is one the rule can fail — a reviewed list
    // that happened to contain no location permission at all would pass the
    // assertion above while proving nothing.
    const unbounded = REVIEWED_PERMISSIONS.map((one) =>
      LOCATION_PERMISSIONS.includes(one.name) ? { ...one, maxSdkVersion: null } : one,
    );
    expect(locationClaimFaults(unbounded).length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- *
 * The artefact. Skips loudly without a Gradle build.
 * -------------------------------------------------------------------------- */

const SHIPPED = mergedManifests();

let announced = false;

function shipped(ctx: TestContext): readonly MergedManifest[] {
  if (SHIPPED.length === 0) {
    if (!announced) {
      announced = true;
      process.stderr.write(`\n${mergedManifestAbsence()}\n\n`);
    }
    ctx.skip(MERGED_MANIFEST_SKIPPED);
  }
  return SHIPPED;
}

describe('the manifest the app actually ships supports the declaration', () => {
  it('carries no location permission the declaration cannot survive', (ctx) => {
    for (const merged of shipped(ctx)) {
      expect(
        locationClaimFaults(usesPermissions(merged.xml)),
        `${merged.variant}: ${merged.path}`,
      ).toEqual([]);
    }
  });

  it('is a manifest the rule could have failed', (ctx) => {
    // The same control as above, against the real artefact: if the merge ever
    // stopped carrying a location permission the assertion above would pass
    // vacuously, and this is what notices.
    for (const merged of shipped(ctx)) {
      const permissions = usesPermissions(merged.xml);
      const located = permissions.filter((one) => LOCATION_PERMISSIONS.includes(one.name));
      expect(located.length, `${merged.variant}: no location permission to check`).toBeGreaterThan(
        0,
      );
      expect(
        locationClaimFaults(permissions.map((one) => ({ ...one, maxSdkVersion: null }))).length,
      ).toBeGreaterThan(0);
    }
  });
});
