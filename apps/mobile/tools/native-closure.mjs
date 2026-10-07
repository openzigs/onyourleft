// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Ask Gradle what the APK links, and write the answer where
 * `src/android/native-closure.test.ts` looks for it — #664.
 *
 * ```bash
 * pnpm --filter @onyourleft/mobile run native:closure
 * ```
 *
 * Runs `./gradlew :app:dependencies --configuration releaseRuntimeClasspath`
 * in `apps/mobile/android` and writes its output, under a digest of the
 * Gradle files that decide it, to `android/app/build/reports/oyl/`. That
 * directory is gitignored with the rest of `build/`, so the report is a local
 * artefact exactly as the merged manifest `merged-manifest.test.ts` reads is.
 *
 * ⚠️ **It needs a JDK and an Android SDK**, and CI has neither (docs/agents/ci.md §4c),
 * which is why this is a tool somebody runs and the test beside the module
 * skips loudly without its output. It decides nothing: which libraries are
 * acceptable is `apps/mobile/native-closure.json`, reviewed by a person.
 *
 * Imports the module as `.ts`, which Node 24 runs with its types stripped;
 * the module names only Node builtins, so nothing else needs resolving.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  ANDROID_ROOT,
  NATIVE_CLOSURE_COMMAND,
  NATIVE_CLOSURE_REPORT,
  gradleInputsDigest,
  nativeClosureReportText,
  resolvedRuntimeClosure,
} from '../src/android/native-closure.ts';

const [executable, ...args] = NATIVE_CLOSURE_COMMAND.split(' ');
const result = spawnSync(executable, [...args, '-q'], {
  cwd: ANDROID_ROOT,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
if (result.error !== undefined || result.status !== 0) {
  console.error(
    `native-closure: \`${NATIVE_CLOSURE_COMMAND}\` failed in ${ANDROID_ROOT}:\n` +
      `${result.error?.message ?? result.stderr}\n` +
      'On a fresh clone Gradle needs the directories `cap sync` writes first — measured on ' +
      'this tool’s own first run, which failed on a missing capacitor-cordova-android-plugins/. ' +
      '`pnpm --filter @onyourleft/mobile exec cap update android` writes them without a web ' +
      'build, provided android/app/src/main/assets/public exists (docs/agents/generated-and-cost-gates.md §4k).',
  );
  process.exit(1);
}

// Read before writing: a report this module cannot read is not written, so a
// broken Gradle answer never becomes the artefact the test trusts.
const closure = resolvedRuntimeClosure(result.stdout);

const path = join(ANDROID_ROOT, NATIVE_CLOSURE_REPORT);
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, nativeClosureReportText(result.stdout, gradleInputsDigest()));
console.log(
  `native-closure: ${String(closure.libraries.size)} libraries and ` +
    `${String(closure.projects.size)} projects, written to ${path}`,
);
