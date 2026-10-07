// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the APK links, held to a reviewed list** — #664.
 *
 * The Android app carries the web build (`capacitor.config.ts` `webDir`) and,
 * beside it, native code: Capacitor's Android runtime, the Bluetooth LE
 * plugin, and every Gradle runtime dependency they pull in — AndroidX, the
 * Kotlin standard library, the coroutines library, Apache Cordova's framework.
 * Each of those is somebody else's code under a licence that asks for its
 * notice to travel with copies, and until #664 nothing shipped one.
 *
 * ## A reviewed list, because CI cannot ask Gradle
 *
 * CI does not build Android (docs/agents/ci.md §4c), so nothing a pull request runs
 * can say what `:app` links. The list is therefore **reviewed and committed**
 * — `apps/mobile/native-closure.json` — and `scripts/check-third-party-notices.mjs`
 * renders it into the notices document the app ships. What this module adds
 * is the check that the review still describes the build: it reads Gradle's
 * own answer to {@link NATIVE_CLOSURE_COMMAND} out of a report
 * {@link NATIVE_CLOSURE_WRITE} leaves behind, and compares the two in both
 * directions. Where Gradle has never run — CI, and every clean clone — the
 * test **skips loudly**, naming the command, which is the shape
 * `merged-manifest.ts` set for #318.
 *
 * ⚠️ **A stale report is a failure, not a skip.** The report records a digest
 * of the Gradle files that decide the closure ({@link GRADLE_INPUTS}); when
 * they have moved since it was written, comparing against it would be a
 * comparison with last month's build. `capacitor.settings.gradle` carries the
 * installed Capacitor versions in its paths (#299), so a Capacitor bump moves
 * the digest too.
 *
 * ## What "resolved" means here
 *
 * Gradle's tree prints what was *requested* and, after `->`, what conflict
 * resolution *chose*. Only the chosen version ships. A line ending `(c)` is a
 * dependency **constraint**, not a dependency, and `(n)` is a configuration
 * nobody resolved; neither is in the APK. `(*)` is a repeat of a subtree
 * already printed. A `FAILED` line means the report describes no build at
 * all, and is refused rather than read as a shorter closure.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `apps/mobile/android`, resolved from this file rather than from `cwd`. */
export const ANDROID_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'android');

/** `apps/mobile/native-closure.json`, the reviewed list. */
export const REVIEWED_NATIVE_CLOSURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'native-closure.json',
);

/** The question the reviewed list answers, in Gradle's own words. */
export const NATIVE_CLOSURE_COMMAND =
  './gradlew :app:dependencies --configuration releaseRuntimeClasspath';

/** What writes the report this module reads. */
export const NATIVE_CLOSURE_WRITE = 'pnpm --filter @onyourleft/mobile run native:closure';

/** Where that report lands, relative to `apps/mobile/android`. Gitignored with `build/`. */
export const NATIVE_CLOSURE_REPORT = join('app', 'build', 'reports', 'oyl', 'native-closure.txt');

/**
 * The Gradle files that decide `:app`'s runtime closure, relative to
 * `apps/mobile/android`. Their digest is stamped into the report so a stale
 * one is refused.
 */
export const GRADLE_INPUTS: readonly string[] = [
  'build.gradle',
  'settings.gradle',
  'variables.gradle',
  'capacitor.settings.gradle',
  join('app', 'build.gradle'),
  join('app', 'capacitor.build.gradle'),
];

/** The first line of the report: the digest of {@link GRADLE_INPUTS} it was taken over. */
const DIGEST_PREFIX = '# gradle-inputs-sha256 ';

/** The skip note a reporter shows. The first line of {@link nativeClosureAbsence}. */
export const NATIVE_CLOSURE_SKIPPED =
  'SKIPPED: Gradle has not reported the release runtime closure in this tree, so the reviewed ' +
  'native licence list was not checked against what the APK links.';

/** Why the Gradle half did not run, and what would make it run. */
export function nativeClosureAbsence(androidRoot: string = ANDROID_ROOT): string {
  return [
    NATIVE_CLOSURE_SKIPPED,
    `Looked for: ${join(androidRoot, NATIVE_CLOSURE_REPORT)}`,
    `Write one with \`${NATIVE_CLOSURE_WRITE}\`, which runs`,
    `\`cd apps/mobile/android && ${NATIVE_CLOSURE_COMMAND}\``,
    '(needs a JDK and an Android SDK — apps/mobile/README.md §5). CI does not build Android,',
    'so this is expected there and is why this assertion is not a CI gate.',
  ].join('\n');
}

/** A SHA-256 over the Gradle files that decide the closure, in a fixed order. */
export function gradleInputsDigest(androidRoot: string = ANDROID_ROOT): string {
  const hash = createHash('sha256');
  for (const input of GRADLE_INPUTS) {
    const path = join(androidRoot, input);
    hash.update(`${input}\n`);
    hash.update(existsSync(path) ? readFileSync(path) : '(absent)');
    hash.update('\n');
  }
  return hash.digest('hex');
}

/** The report's text: the digest line, then Gradle's own output verbatim. */
export function nativeClosureReportText(gradleOutput: string, digest: string): string {
  return `${DIGEST_PREFIX}${digest}\n${gradleOutput}`;
}

/** A report found on disk, and whether it still describes these Gradle files. */
export interface NativeClosureReport {
  readonly path: string;
  readonly gradleOutput: string;
  /** `undefined` when current; otherwise why it cannot be trusted. */
  readonly stale: string | undefined;
}

/** The report, or `undefined` where Gradle has not written one. */
export function readNativeClosureReport(
  androidRoot: string = ANDROID_ROOT,
): NativeClosureReport | undefined {
  const path = join(androidRoot, NATIVE_CLOSURE_REPORT);
  if (!existsSync(path)) {
    return undefined;
  }
  const text = readFileSync(path, 'utf8');
  const newline = text.indexOf('\n');
  const first = newline === -1 ? text : text.slice(0, newline);
  const gradleOutput = newline === -1 ? '' : text.slice(newline + 1);
  if (!first.startsWith(DIGEST_PREFIX)) {
    return {
      path,
      gradleOutput,
      stale: `${path} does not open with the digest line ${NATIVE_CLOSURE_WRITE} writes`,
    };
  }
  const recorded = first.slice(DIGEST_PREFIX.length).trim();
  const current = gradleInputsDigest(androidRoot);
  return {
    path,
    gradleOutput,
    stale:
      recorded === current
        ? undefined
        : `${path} was written before the Gradle files last changed. Re-run ` +
          `\`${NATIVE_CLOSURE_WRITE}\` and read the result before trusting either list.`,
  };
}

/** What Gradle resolved: `group:artifact:version` coordinates and `:project` paths. */
export interface ResolvedClosure {
  readonly libraries: ReadonlySet<string>;
  readonly projects: ReadonlySet<string>;
}

/** One edge of Gradle's printed tree: `+--- x` or `\--- x`, under any indent. */
const EDGE = /(?:\+|\\)--- (.+)$/;

/**
 * Every library and project in a `:app:dependencies` report.
 *
 * @throws on a `FAILED` resolution, on an edge this cannot read, and on a
 *   report with no edge at all — each is a report that describes no build,
 *   and reading any of them as a closure would be a comparison with nothing.
 */
export function resolvedRuntimeClosure(output: string): ResolvedClosure {
  const libraries = new Set<string>();
  const projects = new Set<string>();
  let edges = 0;
  for (const line of output.split('\n')) {
    const match = EDGE.exec(line.trimEnd());
    if (match === null) {
      continue;
    }
    edges += 1;
    let body = (match[1] ?? '').trim();
    if (/ FAILED$/.test(body)) {
      throw new Error(`Gradle could not resolve ${body}; the report describes no build`);
    }
    // A constraint is not a dependency, and `(n)` was never resolved.
    if (/ \((?:c|n)\)$/.test(body)) {
      continue;
    }
    body = body.replace(/ \(\*\)$/, '');
    const [requested = '', chosen] = body.split(' -> ');
    const target = chosen ?? requested;
    if (target.startsWith('project ')) {
      projects.add(target.slice('project '.length).trim());
      continue;
    }
    const [group, artifact, requestedVersion] = requested.split(':');
    // `group:artifact:1.0 -> 2.0` puts the chosen VERSION after the arrow;
    // `group:artifact -> 2.0` requested none at all.
    const version = chosen === undefined ? requestedVersion : chosen.trim();
    if (
      group === undefined ||
      artifact === undefined ||
      version === undefined ||
      version === '' ||
      version.includes(' ')
    ) {
      throw new Error(`cannot read the Gradle edge \`${body}\``);
    }
    libraries.add(`${group}:${artifact}:${version}`);
  }
  if (edges === 0) {
    throw new Error('the report holds no dependency edge; it describes no build');
  }
  return { libraries, projects };
}

/** One reviewed native library. */
export interface ReviewedLibrary {
  readonly coordinate: string;
  readonly licence: string;
  /** The licence its own POM declares, as read. Evidence for a reviewer, never asserted. */
  readonly pom: string;
  readonly notice?: { readonly source: string; readonly read: string; readonly text: string };
}

/** One reviewed Gradle project, and the npm package whose notice covers it. */
export interface ReviewedProject {
  readonly project: string;
  /** `null` when the project is generated and holds no third-party code. */
  readonly package: string | null;
  readonly why: string;
}

/** `apps/mobile/native-closure.json`. */
export interface ReviewedNativeClosure {
  readonly reviewed: string;
  readonly libraries: readonly ReviewedLibrary[];
  readonly projects: readonly ReviewedProject[];
}

/** The committed reviewed list. */
export function readReviewedNativeClosure(
  path: string = REVIEWED_NATIVE_CLOSURE_PATH,
): ReviewedNativeClosure {
  return JSON.parse(readFileSync(path, 'utf8')) as ReviewedNativeClosure;
}

/**
 * Every disagreement between the review and Gradle, in both directions.
 *
 * Both directions because they are different defects: a library Gradle links
 * that nobody reviewed ships with no notice, and a reviewed library Gradle no
 * longer links is a notice for code the app does not contain — a stale review
 * that would go on passing the day its replacement arrived unreviewed.
 */
export function nativeClosureFaults(
  resolved: ResolvedClosure,
  reviewed: ReviewedNativeClosure,
): readonly string[] {
  const faults: string[] = [];
  const reviewedLibraries = new Set(reviewed.libraries.map((library) => library.coordinate));
  const reviewedProjects = new Set(reviewed.projects.map((project) => project.project));
  for (const library of [...resolved.libraries].sort()) {
    if (!reviewedLibraries.has(library)) {
      faults.push(`${library} is linked into the APK and is not in the reviewed list`);
    }
  }
  for (const library of [...reviewedLibraries].sort()) {
    if (!resolved.libraries.has(library)) {
      faults.push(`${library} is in the reviewed list and Gradle no longer links it`);
    }
  }
  for (const project of [...resolved.projects].sort()) {
    if (!reviewedProjects.has(project)) {
      faults.push(`project ${project} is linked into the APK and is not in the reviewed list`);
    }
  }
  for (const project of [...reviewedProjects].sort()) {
    if (!resolved.projects.has(project)) {
      faults.push(`project ${project} is in the reviewed list and Gradle no longer links it`);
    }
  }
  return faults;
}
