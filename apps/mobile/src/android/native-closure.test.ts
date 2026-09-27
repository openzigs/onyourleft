// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The reviewed native licence list, held to what Gradle says the APK links —
 * #664.
 *
 * Two halves, as `merged-manifest.test.ts` has:
 *
 * 1. the **reader and the comparison**, over Gradle output written here, which
 *    run everywhere — so the parsing of `->`, `(c)` and `FAILED` is proved on
 *    every machine, not only on one with an Android SDK; and
 * 2. the **shipped** half, which reads the report `native:closure` left behind
 *    and **skips loudly** without one, naming the command. CI does not build
 *    Android, so it skips there by design and is not a CI gate.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  GRADLE_INPUTS,
  NATIVE_CLOSURE_COMMAND,
  NATIVE_CLOSURE_REPORT,
  NATIVE_CLOSURE_SKIPPED,
  NATIVE_CLOSURE_WRITE,
  gradleInputsDigest,
  nativeClosureAbsence,
  nativeClosureFaults,
  nativeClosureReportText,
  readNativeClosureReport,
  readReviewedNativeClosure,
  resolvedRuntimeClosure,
  type ReviewedNativeClosure,
} from './native-closure';

/** A slice of the real report, taken on 2026-09-27, with each shape it uses. */
const REPORT = [
  '',
  'releaseRuntimeClasspath - Resolved configuration for runtime for variant: release',
  '+--- androidx.appcompat:appcompat:1.7.1',
  '|    +--- androidx.activity:activity:1.8.1 -> 1.11.0',
  '|    |    +--- org.jetbrains.kotlin:kotlin-stdlib:1.8.10 -> 2.2.20 (*)',
  '|    |    \\--- androidx.lifecycle:lifecycle-common:2.6.2 (c)',
  '|    \\--- androidx.appcompat:appcompat-resources:1.7.1 (c)',
  '+--- androidx.core:core-splashscreen:1.2.0',
  '|    \\--- org.jetbrains.kotlin:kotlin-stdlib -> 2.2.20 (*)',
  '\\--- project :capacitor-community-bluetooth-le',
  '     +--- project :capacitor-android (*)',
  '     \\--- androidx.core:core-ktx:1.12.0 -> 1.17.0 (*)',
  '',
  '(c) - A dependency constraint, not a dependency.',
].join('\n');

describe('reading what Gradle resolved', () => {
  it('takes the version conflict resolution CHOSE, not the one requested', () => {
    const { libraries } = resolvedRuntimeClosure(REPORT);
    expect(libraries.has('androidx.activity:activity:1.11.0')).toBe(true);
    expect(libraries.has('androidx.activity:activity:1.8.1')).toBe(false);
    expect(libraries.has('androidx.core:core-ktx:1.17.0')).toBe(true);
  });

  it('reads a request that named no version at all', () => {
    expect(
      resolvedRuntimeClosure(REPORT).libraries.has('org.jetbrains.kotlin:kotlin-stdlib:2.2.20'),
    ).toBe(true);
  });

  it('leaves out a constraint, which is not a dependency', () => {
    const { libraries } = resolvedRuntimeClosure(REPORT);
    // Both are constraints here and nowhere a dependency, so neither ships.
    expect(libraries.has('androidx.lifecycle:lifecycle-common:2.6.2')).toBe(false);
    expect(libraries.has('androidx.appcompat:appcompat-resources:1.7.1')).toBe(false);
  });

  it('reads the projects, including one only reached as a repeat', () => {
    expect([...resolvedRuntimeClosure(REPORT).projects].sort()).toEqual([
      ':capacitor-android',
      ':capacitor-community-bluetooth-le',
    ]);
  });

  it('is exactly the set, with nothing invented', () => {
    expect([...resolvedRuntimeClosure(REPORT).libraries].sort()).toEqual([
      'androidx.activity:activity:1.11.0',
      'androidx.appcompat:appcompat:1.7.1',
      'androidx.core:core-ktx:1.17.0',
      'androidx.core:core-splashscreen:1.2.0',
      'org.jetbrains.kotlin:kotlin-stdlib:2.2.20',
    ]);
  });

  it('refuses a report where a dependency FAILED to resolve', () => {
    expect(() => resolvedRuntimeClosure(`${REPORT}\n+--- com.example:gone:1.0 FAILED`)).toThrow(
      /could not resolve com\.example:gone:1\.0/,
    );
  });

  it('refuses a report with no dependency in it, rather than reading an empty closure', () => {
    expect(() => resolvedRuntimeClosure('releaseRuntimeClasspath\nNo dependencies\n')).toThrow(
      /no dependency edge/,
    );
  });
});

const REVIEWED: ReviewedNativeClosure = {
  reviewed: '2026-09-27',
  libraries: [
    { coordinate: 'androidx.activity:activity:1.11.0', licence: 'Apache-2.0', pom: 'x' },
    { coordinate: 'androidx.appcompat:appcompat:1.7.1', licence: 'Apache-2.0', pom: 'x' },
    { coordinate: 'androidx.core:core-ktx:1.17.0', licence: 'Apache-2.0', pom: 'x' },
    { coordinate: 'androidx.core:core-splashscreen:1.2.0', licence: 'Apache-2.0', pom: 'x' },
    { coordinate: 'org.jetbrains.kotlin:kotlin-stdlib:2.2.20', licence: 'Apache-2.0', pom: 'x' },
  ],
  projects: [
    { project: ':capacitor-android', package: '@capacitor/android', why: 'x' },
    { project: ':capacitor-community-bluetooth-le', package: 'x', why: 'x' },
  ],
};

describe('comparing the review with Gradle', () => {
  it('agrees when they name the same things', () => {
    expect(nativeClosureFaults(resolvedRuntimeClosure(REPORT), REVIEWED)).toEqual([]);
  });

  it('names a library the APK links that nobody reviewed', () => {
    const resolved = resolvedRuntimeClosure(`${REPORT}\n+--- com.example:new:2.0`);
    expect(nativeClosureFaults(resolved, REVIEWED)).toEqual([
      'com.example:new:2.0 is linked into the APK and is not in the reviewed list',
    ]);
  });

  it('names a version bump as both halves: the new one unreviewed, the old one stale', () => {
    const bumped = REPORT.replace('-> 1.11.0', '-> 1.12.0');
    expect(nativeClosureFaults(resolvedRuntimeClosure(bumped), REVIEWED)).toEqual([
      'androidx.activity:activity:1.12.0 is linked into the APK and is not in the reviewed list',
      'androidx.activity:activity:1.11.0 is in the reviewed list and Gradle no longer links it',
    ]);
  });

  it('names a project in either direction', () => {
    const resolved = resolvedRuntimeClosure(`${REPORT}\n+--- project :another-plugin`);
    const reviewed = { ...REVIEWED, projects: REVIEWED.projects.slice(1) };
    expect(nativeClosureFaults(resolved, reviewed)).toEqual([
      'project :another-plugin is linked into the APK and is not in the reviewed list',
      'project :capacitor-android is linked into the APK and is not in the reviewed list',
    ]);
  });
});

const made: string[] = [];
afterAll(() => {
  for (const directory of made) rmSync(directory, { recursive: true, force: true });
});

function androidTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'oyl-native-closure-'));
  made.push(root);
  mkdirSync(join(root, 'app'), { recursive: true });
  for (const input of GRADLE_INPUTS) writeFileSync(join(root, input), `// ${input}\n`);
  return root;
}

function writeReport(root: string, text: string): void {
  mkdirSync(join(root, NATIVE_CLOSURE_REPORT, '..'), { recursive: true });
  writeFileSync(join(root, NATIVE_CLOSURE_REPORT), text);
}

describe('the report native:closure leaves behind', () => {
  it('is absent where Gradle has never run, and the reason names the command', () => {
    const root = androidTree();
    expect(readNativeClosureReport(root)).toBeUndefined();
    const reason = nativeClosureAbsence(root);
    expect(reason.split('\n')[0]).toBe(NATIVE_CLOSURE_SKIPPED);
    expect(reason).toContain(NATIVE_CLOSURE_WRITE);
    expect(reason).toContain(NATIVE_CLOSURE_COMMAND);
    expect(reason).toContain(join(root, NATIVE_CLOSURE_REPORT));
  });

  it('is current while the Gradle files are the ones it was taken over', () => {
    const root = androidTree();
    writeReport(root, nativeClosureReportText(REPORT, gradleInputsDigest(root)));
    const report = readNativeClosureReport(root);
    expect(report?.stale).toBeUndefined();
    expect(report?.gradleOutput).toBe(REPORT);
  });

  it('is stale once any Gradle input moves — a Capacitor bump moves capacitor.settings.gradle', () => {
    const root = androidTree();
    writeReport(root, nativeClosureReportText(REPORT, gradleInputsDigest(root)));
    writeFileSync(join(root, 'capacitor.settings.gradle'), '// 8.5.3\n');
    expect(readNativeClosureReport(root)?.stale).toMatch(/written before the Gradle files/);
  });

  it('is refused when it carries no digest, rather than trusted', () => {
    const root = androidTree();
    writeReport(root, REPORT);
    expect(readNativeClosureReport(root)?.stale).toMatch(/does not open with the digest line/);
  });
});

describe('the reviewed list itself', () => {
  const reviewed = readReviewedNativeClosure();

  it('names every library once, at one version', () => {
    const coordinates = reviewed.libraries.map((library) => library.coordinate);
    expect(new Set(coordinates).size).toBe(coordinates.length);
    for (const coordinate of coordinates) expect(coordinate.split(':')).toHaveLength(3);
  });

  it('holds more than a handful — an emptied list would agree with nothing and say so', () => {
    expect(reviewed.libraries.length).toBeGreaterThan(10);
    expect(reviewed.projects.map((project) => project.project)).toContain(':capacitor-android');
  });

  it('carries the two NOTICE files Apache-2.0 §4(d) asks to travel', () => {
    const noticed = reviewed.libraries
      .filter((library) => library.notice !== undefined)
      .map((library) => library.coordinate);
    expect(noticed).toEqual([
      'org.apache.cordova:framework:14.0.1',
      'org.jetbrains.kotlin:kotlin-stdlib:2.2.20',
    ]);
  });
});

describe('the review against what the APK actually links', () => {
  it('agrees with Gradle, in both directions', (ctx) => {
    const report = readNativeClosureReport();
    if (report === undefined) {
      // `process.stderr.write` rather than `console.warn`, for the reason
      // `merged-manifest.test.ts` records: Vitest's default reporter swallowed
      // the console from a skipping test, and a reason nobody sees is a silent
      // skip.
      process.stderr.write(`\n${nativeClosureAbsence()}\n\n`);
      ctx.skip(NATIVE_CLOSURE_SKIPPED);
      return;
    }
    expect(report.stale, report.stale).toBeUndefined();
    expect(
      nativeClosureFaults(resolvedRuntimeClosure(report.gradleOutput), readReviewedNativeClosure()),
    ).toEqual([]);
  });
});
