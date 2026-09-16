// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #87's first acceptance criterion, against the artefact rather than a
 * neighbour of it ([#318](https://github.com/openzigs/onyourleft/issues/318)).
 *
 * ⚠️ **`manifest.test.ts` asserts against the app's own manifest, which is not
 * what ships.** That is the file a developer edits; the file the APK carries is
 * the Android Gradle Plugin's merge of it with every library's, and the merge
 * was measured on 2026-09-16 to add three permissions, one `<permission>`
 * definition and one exported receiver that appear nowhere in this repository.
 * A gate whose subject is not the artefact under test cannot fail for the right
 * reason — the same shape as #142 (a gate selecting on a directory name) and
 * #278 (a unit wired to nothing).
 *
 * The file splits into two halves that are read differently:
 *
 * 1. **Everything under "locating"** runs everywhere, including in CI and on a
 *    clean clone, because it works over throwaway trees. It is what says the
 *    reader can tell absent from unreadable, and that the sentence printed
 *    before a skip is a sentence somebody can act on.
 * 2. **Everything under "the manifest the app actually ships"** needs a Gradle
 *    build and **skips loudly** without one. CI does not build Android
 *    (`CLAUDE.md` §4c), so those assertions are not a CI gate and this file
 *    says so rather than letting a green run imply otherwise.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';
import type { TestContext } from 'vitest';

import { components, definedPermissions, queries, usesPermissions } from './manifest';
import {
  ANDROID_ROOT,
  APPLICATION_ID,
  BUILD_VARIANTS,
  MERGED_MANIFEST_SKIPPED,
  mergedManifestAbsence,
  mergedManifestPath,
  mergedManifests,
  REVIEWED_DEFINED_PERMISSIONS,
  REVIEWED_EXPORTED_COMPONENTS,
  REVIEWED_PERMISSIONS,
  REVIEWED_QUERIES,
  type BuildVariant,
  type MergedManifest,
} from './merged-manifest';

const HERE = dirname(fileURLToPath(import.meta.url));

const APP_MANIFEST = readFileSync(
  join(HERE, '..', '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
  'utf8',
);

/* -------------------------------------------------------------------------- *
 * Half one: locating the artefact. Runs everywhere.
 * -------------------------------------------------------------------------- */

const scratch: string[] = [];

/** A throwaway `android/` tree, optionally holding a merged manifest or two. */
function tree(files: Partial<Record<BuildVariant, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'oyl-merged-manifest-'));
  scratch.push(root);
  for (const [variant, xml] of Object.entries(files)) {
    const path = mergedManifestPath(root, variant as BuildVariant);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, xml, 'utf8');
  }
  return root;
}

afterAll(() => {
  for (const root of scratch) {
    rmSync(root, { recursive: true, force: true });
  }
});

const MINIMAL = '<?xml version="1.0" encoding="utf-8"?>\n<manifest package="x"></manifest>\n';

describe('locating the merged manifest', () => {
  it('finds nothing in a tree Gradle has never run in', () => {
    expect(mergedManifests(tree({}))).toEqual([]);
  });

  it('reads the variant that is there', () => {
    const found = mergedManifests(tree({ debug: MINIMAL }));
    expect(found.map((one) => one.variant)).toEqual(['debug']);
    expect(found[0]?.xml).toBe(MINIMAL);
  });

  it('reads BOTH variants when both are there', () => {
    // A release merge is a different merge. Asserting the debug one and calling
    // the shipped artefact checked is this issue with a smaller radius.
    const found = mergedManifests(tree({ debug: MINIMAL, release: MINIMAL }));
    expect(found.map((one) => one.variant)).toEqual(['debug', 'release']);
  });

  it('throws on a file that is there but is not a manifest', () => {
    // An interrupted build leaves a truncated file. Read as a document it
    // declares nothing, and every "the merge adds no X" assertion below would
    // pass over it. Absent and unreadable are different answers.
    expect(() => mergedManifests(tree({ debug: '' }))).toThrow(/no <manifest> element/);
  });

  it('names every path it looked in, and the command that would produce one', () => {
    // The reason is the entire value of a skip. A skip with no actionable
    // sentence is a silent pass with extra steps.
    const root = tree({});
    const reason = mergedManifestAbsence(root);
    for (const variant of BUILD_VARIANTS) {
      expect(reason).toContain(mergedManifestPath(root, variant));
    }
    expect(reason).toContain('gradlew');
    // The skip note a reporter shows is the first line of the same string, so
    // the one-liner and the full explanation cannot come to disagree.
    expect(reason.startsWith(MERGED_MANIFEST_SKIPPED)).toBe(true);
    expect(MERGED_MANIFEST_SKIPPED).toContain('NOT checked');
  });

  it('points at this package by default rather than at the working directory', () => {
    // `pnpm test` from the root and `pnpm --filter @onyourleft/mobile test` run
    // with different `cwd`s. A relative path would make the gate check the
    // artefact in one and skip in the other, for no reason a reader could see.
    expect(ANDROID_ROOT).toBe(join(HERE, '..', '..', 'android'));
    expect(existsSync(join(ANDROID_ROOT, 'app', 'src', 'main', 'AndroidManifest.xml'))).toBe(true);
  });
});

describe('the reviewed list is a review, not a derivation', () => {
  it('names exactly the entries nobody in this repository declares', () => {
    // If this goes red, a library started contributing a permission and the
    // question "is that acceptable in a shipped cycling app?" has not been
    // asked yet. Answer it in the list, with a reason, in the same diff.
    expect(
      REVIEWED_PERMISSIONS.filter((one) => one.contributor === 'merged-in').map((one) => one.name),
    ).toEqual([
      'android.permission.BLUETOOTH',
      'android.permission.BLUETOOTH_ADMIN',
      `${APPLICATION_ID}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`,
    ]);
  });

  it('covers every permission the app declares for itself', () => {
    // The other direction: a permission added to our own manifest and not to
    // the list is refused rather than merged in unread.
    const ours = REVIEWED_PERMISSIONS.filter((one) => one.contributor === 'ours').map(
      (one) => one.name,
    );
    expect([...usesPermissions(APP_MANIFEST)].map((one) => one.name).sort()).toEqual(
      [...ours].sort(),
    );
  });

  it('gives every entry a reason a reviewer can disagree with', () => {
    for (const entry of [
      ...REVIEWED_PERMISSIONS,
      ...REVIEWED_DEFINED_PERMISSIONS,
      ...REVIEWED_EXPORTED_COMPONENTS,
    ]) {
      expect(entry.why.length, `${entry.name} carries no reason`).toBeGreaterThan(20);
    }
  });
});

/* -------------------------------------------------------------------------- *
 * Half two: the artefact itself. Skips loudly without a Gradle build.
 * -------------------------------------------------------------------------- */

const SHIPPED = mergedManifests();

let announced = false;

/**
 * Every merged manifest to assert against, or a loud skip.
 *
 * ⚠️ **`process.stderr.write`, not `console.warn`, and that is load-bearing
 * rather than a style choice.** Under Vitest 4's default reporter — the one
 * `pnpm run test` and CI use — a `console.warn` from this suite prints nothing
 * at all; measured on 2026-09-16 with a throwaway spec, from a passing test and
 * from a skipping one alike, while a raw `process.stderr.write` from the same
 * place printed. A reason nobody sees is a silent skip, which is #318's own
 * defect one layer in, so the channel is the one that was observed to work.
 */
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

describe('the manifest the app actually ships', () => {
  it('is the merge of our manifest, not our manifest', (ctx) => {
    // The control. Without it every assertion below could be passing because
    // it was handed our own file, which is the defect #318 is about.
    for (const merged of shipped(ctx)) {
      const shippedNames = usesPermissions(merged.xml).map((one) => one.name);
      const ourNames = usesPermissions(APP_MANIFEST).map((one) => one.name);
      expect(shippedNames.length, `${merged.variant}: ${merged.path}`).toBeGreaterThan(
        ourNames.length,
      );
    }
  });

  it('is stamped with the application id the reviewed list assumes', (ctx) => {
    for (const merged of shipped(ctx)) {
      expect(merged.xml, merged.path).toContain(`package="${APPLICATION_ID}"`);
    }
  });

  it('carries every reviewed permission, with exactly its reviewed bound', (ctx) => {
    for (const merged of shipped(ctx)) {
      const shippedPermissions = usesPermissions(merged.xml);
      for (const reviewed of REVIEWED_PERMISSIONS) {
        const actual = shippedPermissions.find((one) => one.name === reviewed.name);
        expect(
          actual,
          `${merged.variant}: ${reviewed.name} is reviewed but not shipped`,
        ).toBeDefined();
        // maxSdkVersion is the whole safety of the two legacy Bluetooth
        // permissions the merge injects: bounded at 30 they apply where they
        // are required and nowhere else, unbounded they are a grant on every
        // Android version. One attribute apart.
        expect(actual?.maxSdkVersion, `${merged.variant}: ${reviewed.name} maxSdkVersion`).toBe(
          reviewed.maxSdkVersion,
        );
        expect(actual?.flags, `${merged.variant}: ${reviewed.name} usesPermissionFlags`).toBe(
          reviewed.flags,
        );
      }
    }
  });

  it('carries no permission nobody reviewed', (ctx) => {
    // The half that catches an injected permission. An injected permission is
    // not automatically wrong — three of the shipped eleven are injected and
    // all three are right — so the test is against the reviewed list rather
    // than against our own manifest.
    const reviewed = new Set(REVIEWED_PERMISSIONS.map((one) => one.name));
    for (const merged of shipped(ctx)) {
      for (const one of usesPermissions(merged.xml)) {
        expect(
          reviewed,
          `${merged.variant}: ${one.name} is in the shipped manifest and in nobody's reviewed list`,
        ).toContain(one.name);
      }
    }
  });

  it('defines no permission nobody reviewed, at no weaker level', (ctx) => {
    // Defining a permission is the more dangerous half of the two: a custom
    // permission at `normal` can be held by any application on the device.
    for (const merged of shipped(ctx)) {
      expect(
        definedPermissions(merged.xml).map((one) => ({
          name: one.name,
          protectionLevel: one.protectionLevel,
        })),
        merged.path,
      ).toEqual(
        REVIEWED_DEFINED_PERMISSIONS.map((one) => ({
          name: one.name,
          protectionLevel: one.protectionLevel,
        })),
      );
    }
  });

  it('exports exactly the components somebody reviewed, with their guards', (ctx) => {
    // What a permission list cannot say. An exported component is an entry
    // point any application on the phone can invoke, and the merge adds them.
    for (const merged of shipped(ctx)) {
      const exported = components(merged.xml)
        .filter((one) => one.exported !== false)
        .map((one) => ({ kind: one.kind, name: one.name, permission: one.permission }));
      expect(exported, merged.path).toEqual(
        REVIEWED_EXPORTED_COMPONENTS.map((one) => ({
          kind: one.kind,
          name: one.name,
          permission: one.permission,
        })),
      );
    }
  });

  it('declares no package-visibility query nobody reviewed', (ctx) => {
    // The third thing a merge injects, and it is in no permission list.
    for (const merged of shipped(ctx)) {
      expect(queries(merged.xml), merged.path).toEqual(REVIEWED_QUERIES);
    }
  });

  it('requests no location permission on API 31 and above', (ctx) => {
    // #87 criterion 1 in its literal wording, at last against the right file.
    // `tools:replace` beating the plugin's unconstrained declaration was an
    // assumption until a build existed; it is now an assertion that re-runs.
    for (const merged of shipped(ctx)) {
      for (const name of [
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.ACCESS_COARSE_LOCATION',
      ]) {
        expect(
          usesPermissions(merged.xml).find((one) => one.name === name)?.maxSdkVersion,
          `${merged.variant}: ${name}`,
        ).toBe(30);
      }
      expect(
        usesPermissions(merged.xml).find((one) => one.name === 'android.permission.BLUETOOTH_SCAN')
          ?.flags,
        `${merged.variant}: BLUETOOTH_SCAN`,
      ).toBe('neverForLocation');
    }
  });

  it('keeps every declaration our own manifest makes', (ctx) => {
    // A red here is one of two things and the message says both: the merged
    // manifest on this machine is older than the source that produced it (run
    // Gradle), or the merge dropped something we declared. There is no third
    // reading, and neither may be discovered by a reviewer reading the diff.
    for (const merged of shipped(ctx)) {
      const shippedPermissions = usesPermissions(merged.xml);
      for (const ours of usesPermissions(APP_MANIFEST)) {
        const actual = shippedPermissions.find((one) => one.name === ours.name);
        expect(
          actual === undefined
            ? null
            : { maxSdkVersion: actual.maxSdkVersion, flags: actual.flags },
          `${ours.name}: either ${merged.path} predates the app manifest (rebuild), or the merge dropped it`,
        ).toEqual({ maxSdkVersion: ours.maxSdkVersion, flags: ours.flags });
      }
    }
  });
});
