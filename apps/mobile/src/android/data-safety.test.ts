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
 *    Android (CLAUDE.md §4c) — because a silent skip here is exactly #318's
 *    defect, one layer in.
 */

import { describe, expect, it } from 'vitest';
import type { TestContext } from 'vitest';

import {
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
    // analytics keep the IP address and the tile path for up to 7 days.
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

  it('declares no precise location collection and no sharing of it', () => {
    const precise = DATA_SAFETY_DECLARATION.find(
      (answer) => answer.dataType === 'Location — precise location',
    );
    expect(
      precise,
      'the form has a precise-location row whether or not we collect any',
    ).toBeDefined();
    expect(precise?.collected).toBe(false);
    expect(precise?.shared).toBe(false);
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
    for (const answer of health) {
      expect(answer.collected, answer.dataType).toBe(false);
    }
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

  it('collects nothing else — the map and the camera, and nothing more', () => {
    const collected = DATA_SAFETY_DECLARATION.filter((answer) => answer.collected).map(
      (answer) => answer.dataType,
    );
    expect(collected).toStrictEqual(['Location — approximate location', 'Photos and videos']);
    for (const answer of DATA_SAFETY_DECLARATION) {
      expect(answer.shared, answer.dataType).toBe(false);
    }
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

  it('gives a reason for every answer', () => {
    for (const answer of DATA_SAFETY_DECLARATION) {
      expect(answer.why.length, answer.dataType).toBeGreaterThan(20);
    }
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
