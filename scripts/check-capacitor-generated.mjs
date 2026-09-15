#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Assert that the files `cap sync` generates and this repository commits still
 * say what the generator writes today.
 *
 * ## The failure this exists to stop
 *
 * [#276](https://github.com/openzigs/onyourleft/pull/276) and
 * [#277](https://github.com/openzigs/onyourleft/pull/277) took
 * `@capacitor/core` and `@capacitor/android` from 8.5.1 to 8.5.2.
 * `apps/mobile/android/capacitor.settings.gradle` went on naming
 *
 *     node_modules/.pnpm/@capacitor+android@8.5.1_@capacitor+core@8.5.1/…
 *
 * — a directory the bump deleted. pnpm's store path carries the **peer**
 * version as well as the package's own, so *any* Capacitor bump invalidates
 * that file, and nothing in this repository could tell:
 *
 * - **CI never builds Android.** `rules.yml` runs the web gates; `release.yml`
 *   is tag-triggered and has never run.
 * - ⚠️ **The local build hides it.** `apps/mobile/README.md` §1's sequence is
 *   `build` → `cap sync` → `gradlew`, and `cap sync` regenerates the file
 *   *before* Gradle reads it. The person most likely to notice is the one whose
 *   workflow guarantees they cannot.
 * - **`check:wiring` cannot see it** — it walks the TypeScript module graph
 *   from the web entry point, and a Gradle settings file is outside that graph
 *   entirely.
 *
 * This is the third variant of a shape this repository keeps finding (#299): a
 * unit wired to nothing (#278), a guard that cannot fire (#229, #225), and now
 * **a generated artefact that has drifted from its source**. The common
 * property is that the green result is indistinguishable from the correct one —
 * the file parses, Gradle's syntax is fine, every test passes, and the path
 * simply is not there any more.
 *
 * ## What it does
 *
 * The primitive `packages/fit`'s fixture corpus already uses: **regenerate, and
 * fail if the tree changes.** Four steps, and the order of the first two is the
 * whole of what #299's review comment added:
 *
 * 1. `pnpm install --frozen-lockfile`, and a non-zero exit is this check's own
 *    failure. ⚠️ **This is not ceremony.** `cap update` faithfully encodes
 *    whatever `node_modules` holds and says *nothing* about whether that
 *    matches the lockfile, so a regenerate-and-diff built on an unverified
 *    install proves only that two wrong things agree. That is not hypothetical:
 *    [#298](https://github.com/openzigs/onyourleft/pull/298) regenerated this
 *    very file from a `node_modules` holding `@capacitor/android@8.5.1` while
 *    the lockfile said 8.5.2, and committed
 *    `@capacitor+android@8.5.1_@capacitor+core@8.5.2` — a fix for stale drift
 *    that committed different stale drift, corrected in #300.
 * 2. `cap update android`, which rewrites exactly the two files below.
 *    (`cap sync` is `copy` + `update`; `copy` is the half that copies the web
 *    build into the gitignored asset tree, which is why only `update` is run —
 *    a "run it and diff the tree" over `sync` would report every asset.)
 *    ⚠️ **No web build is needed, but only because of `GENERATED_DIRECTORIES`**
 *    — read that comment before moving this step in CI.
 * 3. Compare each file against the bytes that were there before, then **put the
 *    original bytes back**, so the check reports drift rather than quietly
 *    repairing it and leaving a clean `git status` behind.
 * 4. Report, naming the file and the lines.
 *
 * ⚠️ Step 2 is preceded by overwriting both files with a marker, so that a
 * generator which exits 0 without writing one of them is reported rather than
 * read as agreement. A check that compares a file with itself is the shape this
 * repository keeps filing issues about; see `capacitorDrift`.
 *
 * ## Why not the cheaper check, which was the first thing tried
 *
 * #299 floats a cheaper option: assert that every `node_modules/.pnpm/…` path
 * named in the file exists on disk. It needs no `cap update` and it is a few
 * lines. ⚠️ **It does not work, and the measurement is worth keeping**: on
 * 2026-09-15, on a machine that had installed both versions in turn,
 * `node_modules/.pnpm/@capacitor+android@8.5.1_@capacitor+core@8.5.2` was still
 * present and fully populated. pnpm leaves an orphaned store directory behind
 * rather than pruning it, so the existence check would have looked at #298's
 * artefact — the one where the `core` half is right and the `android` half is
 * wrong — and passed. A gate whose answer depends on what a developer happened
 * to install last week is not a gate.
 *
 * ## §Limits — what a green run does and does not say
 *
 * - It says the two files agree with the generator **for the dependency set the
 *   lockfile describes**. It says nothing about whether that set is the right
 *   one, which is `check:licences`' and Dependabot's question.
 * - It does **not** run Gradle, so it does not say the project builds. Nobody
 *   in this environment can: `apps/mobile/README.md` §4 records that six of
 *   #87's eight criteria are unverified for exactly that reason.
 * - It compares **only** the two files `cap update` owns and this repository
 *   commits. Everything else `cap sync` writes — the copied web build under
 *   `android/app/src/main/assets/public`, `res/xml/config.xml` and
 *   `capacitor-cordova-android-plugins/` — is gitignored and pruned (CLAUDE.md
 *   §3a), and a naive "run it and diff the tree" would report every asset.
 * - The diff it prints is **positional**, line against line. That is the right
 *   shape for a version bump, which rewrites a line in place; a file that grew
 *   a line reports every line after it as differing, which is why the output is
 *   capped rather than complete.
 *
 * Usage: node scripts/check-capacitor-generated.mjs [--root <dir>] [--assume-installed]
 */

import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** The Capacitor project, relative to the repository root. */
export const PROJECT = 'apps/mobile';

/**
 * The files `cap update` writes that this repository commits, relative to
 * `PROJECT`. Written down rather than discovered, so that a Capacitor release
 * generating a *third* committed file is a thing somebody has to notice — the
 * same posture `check-wiring.mjs` takes with `WATCHED_PREFIXES`, and for the
 * same reason: a discovered set fails open against something new appearing.
 */
export const GENERATED_FILES = [
  'android/capacitor.settings.gradle',
  'android/app/capacitor.build.gradle',
];

/**
 * Directories `cap update` needs that a clean clone does not have.
 *
 * ⚠️ **Both were found by CI, not locally, and that is the point.** Each is
 * `cap copy`'s output and gitignored, so both exist on the machine of anybody
 * who has ever run `cap sync` and on no fresh checkout — the "worked on my
 * machine because of leftover state" shape in its purest form, twice:
 *
 * - `assets/` is where `update` writes `capacitor.plugins.json`. Without it the
 *   run dies on `ENOENT … capacitor.plugins.json`.
 * - `assets/public/` is the copied web build, and ⚠️ **`update` falls back to a
 *   full `copy` when it is missing** (`@capacitor/cli`'s `android/update.js`:
 *   `if (!pathExists(config.android.webDirAbs)) await copy(…)`). `copy` runs
 *   `checkWebDir`, which refuses to start without `apps/web/dist`. Creating the
 *   directory is what keeps this gate independent of the web build rather than
 *   ordered after it; the two files it compares are the same either way,
 *   because `copy` writes neither.
 *
 * Each is created if absent and **removed again** if this check was the one
 * that created it, so a run leaves the tree exactly as it found it.
 */
export const GENERATED_DIRECTORIES = [
  'android/app/src/main/assets',
  'android/app/src/main/assets/public',
];

/** How the two files are put back the way they should be. */
export const REPAIR =
  'pnpm install --frozen-lockfile && pnpm --filter @onyourleft/mobile exec cap sync android';

/**
 * The lines on which two texts disagree, by position, capped.
 *
 * Positional rather than a real diff: see §Limits. `undefined` for a line the
 * shorter side does not have is rendered by the caller rather than here.
 */
export function differingLines(committed, generated, limit = 6) {
  const before = committed.split('\n');
  const after = generated.split('\n');
  const found = [];
  for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
    if (before[index] === after[index]) continue;
    if (found.length === limit) {
      found.push({ truncated: true });
      break;
    }
    found.push({ line: index + 1, committed: before[index], generated: after[index] });
  }
  return found;
}

const show = (value) => (value === undefined ? '(no such line)' : `\`${value}\``);

/** The last few lines of a failed command's output, for a message that has to fit on a screen. */
const tail = (text) => {
  const lines = text.trim().split('\n');
  return lines.slice(-3).join(' / ') || '(no output)';
};

/**
 * What a failed command said.
 *
 * ⚠️ `stderr` first but only when it holds something. pnpm reports
 * `ERR_PNPM_OUTDATED_LOCKFILE` on **stdout** and leaves stderr empty, and `??`
 * does not fall through an empty string — a detail that turns the one message
 * a reader needs into `(no output)`.
 */
const outputOf = (result) =>
  tail([result.stderr, result.stdout].find((stream) => (stream ?? '').trim() !== '') ?? '');

/**
 * Regenerate and compare. Returns the problems found and the files compared.
 *
 * ⚠️ **The originals are restored in a `finally`.** A checker that leaves the
 * repaired file in the tree turns a red gate into a silent commit-time
 * surprise: `git status` would be dirty, the next `git add -A` would sweep it
 * up, and the drift would be fixed by somebody who never read the report.
 */
export function capacitorDrift({ root, assumeInstalled = false }) {
  const problems = [];
  const projectDir = join(root, PROJECT);

  if (!existsSync(projectDir)) {
    problems.push(
      `CAP002 ${PROJECT} — the Capacitor project is not in this tree, so there is nothing to ` +
        'regenerate. If the shell has moved, this checker moves with it.',
    );
    return { problems, compared: [] };
  }

  if (!assumeInstalled) {
    const install = spawnSync('pnpm', ['install', '--frozen-lockfile'], {
      cwd: root,
      encoding: 'utf8',
    });
    if (install.error !== undefined || install.status !== 0) {
      const detail = install.error?.message ?? outputOf(install);
      problems.push(
        'CAP001 pnpm install --frozen-lockfile — the installed tree could not be verified ' +
          `against the lockfile, so nothing was regenerated: ${detail}`,
      );
      return { problems, compared: [] };
    }
  }

  const files = GENERATED_FILES.map((relative) => ({ relative, path: join(projectDir, relative) }));
  for (const file of files) {
    if (existsSync(file.path)) continue;
    problems.push(
      `CAP002 ${PROJECT}/${file.relative} — a file \`cap update\` generates and this ` +
        'repository commits is not in the tree. Regenerate it and commit it: ' +
        `${REPAIR}`,
    );
  }
  if (problems.length > 0) return { problems, compared: [] };

  const original = files.map((file) => readFileSync(file.path));

  // ⚠️ The anti-vacuity guard, and the reason this checker is not a comparison
  // of a file with itself. Each file is overwritten with a marker BEFORE the
  // generator runs, so a marker that survives means the generator did not write
  // that file at all — a platform argument it did not understand, a Capacitor
  // release that moved the file, a plugin whose Android half went away. Without
  // this, every one of those reads as agreement, which is the exact failure
  // shape #299 is about.
  //
  // A marker rather than a modification time: a timestamp depends on the
  // filesystem's granularity, and it would report a generator that skips a
  // write when the content is already correct as a failure. A marker makes the
  // content differ, so such a generator writes and is measured properly.
  const marker = Buffer.from(
    `// check-capacitor-generated ${String(process.pid)}-${String(Date.now())}\n` +
      '// If you are reading this in a committed file, a check was killed mid-run.\n' +
      `// Put it back: ${REPAIR}\n`,
  );

  const madeDirectories = GENERATED_DIRECTORIES.map((relative) =>
    join(projectDir, relative),
  ).filter((directory) => !existsSync(directory));

  try {
    for (const directory of madeDirectories) mkdirSync(directory, { recursive: true });
    for (const file of files) writeFileSync(file.path, marker);

    const cap = join(projectDir, 'node_modules', '.bin', 'cap');
    if (!existsSync(cap)) {
      problems.push(
        `CAP003 ${PROJECT} — the Capacitor CLI is not installed, so nothing could be ` +
          'regenerated and this check would otherwise have passed having compared a file ' +
          'against itself.',
      );
      return { problems, compared: [] };
    }

    const update = spawnSync(cap, ['update', 'android'], { cwd: projectDir, encoding: 'utf8' });
    if (update.error !== undefined || update.status !== 0) {
      const detail = update.error?.message ?? outputOf(update);
      problems.push(
        `CAP003 ${PROJECT} — \`cap update android\` failed: ${detail}\n` +
          '        ⚠️ If it could not find the web assets directory, the copied-build ' +
          'directory was missing and `update` fell back to a full `copy` — see ' +
          '`GENERATED_DIRECTORIES`, or run `pnpm run build` first.',
      );
      return { problems, compared: [] };
    }

    for (const file of files) {
      if (existsSync(file.path) && !readFileSync(file.path).equals(marker)) continue;
      problems.push(
        `CAP003 ${PROJECT}/${file.relative} — \`cap update android\` exited 0 without ` +
          'writing this file, so comparing it proves nothing: it would agree with whatever ' +
          'the file said.',
      );
    }
    if (problems.length > 0) return { problems, compared: [] };

    for (const [index, file] of files.entries()) {
      const generated = readFileSync(file.path);
      if (generated.equals(original[index])) continue;
      const lines = differingLines(original[index].toString('utf8'), generated.toString('utf8'))
        .map((entry) =>
          entry.truncated === true
            ? '        …and more'
            : `        line ${String(entry.line)}: committed ${show(entry.committed)}, ` +
              `generated ${show(entry.generated)}`,
        )
        .join('\n');
      problems.push(
        `CAP004 ${PROJECT}/${file.relative} — the committed file is not what \`cap update ` +
          `android\` writes against this lockfile.\n${lines}\n        Regenerate it and commit ` +
          `the result: ${REPAIR}`,
      );
    }
  } finally {
    for (const directory of madeDirectories) rmSync(directory, { recursive: true, force: true });
    for (const [index, file] of files.entries()) {
      if (!existsSync(file.path)) {
        writeFileSync(file.path, original[index]);
        continue;
      }
      if (readFileSync(file.path).equals(original[index])) continue;
      writeFileSync(file.path, original[index]);
    }
  }

  return { problems, compared: files.map((file) => `${PROJECT}/${file.relative}`) };
}

// ----------------------------------------------------------------------- main

// Compared through `realpathSync` for the reason check-wiring.mjs records:
// every fixture tree this repository's suites build sits behind the `/var` →
// `/private/var` symlink on macOS, and the simpler predicates are false there —
// which would make this exit 0 having checked nothing.
const invoked = process.argv[1];
if (invoked !== undefined && import.meta.filename === realpathSync(invoked)) {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  const root = resolve(flag('--root') ?? process.cwd());
  // ⚠️ The fixture suite is the ONLY caller that passes this, because a
  // throwaway tree has no lockfile to install from. Passing it in CI would
  // reintroduce #298 exactly: a regenerate-and-diff over a `node_modules`
  // nobody checked against the lockfile.
  const assumeInstalled = argv.includes('--assume-installed');

  let result;
  try {
    result = capacitorDrift({ root, assumeInstalled });
  } catch (error) {
    console.error(`check-capacitor-generated: ${error.message}`);
    process.exit(1);
  }

  if (result.problems.length > 0) {
    console.error(
      'check-capacitor-generated: a generated-and-committed file no longer matches its ' +
        'generator.\n',
    );
    for (const problem of result.problems) console.error(`  - ${problem}`);
    console.error('\nSee CLAUDE.md §4k and scripts/check-capacitor-generated.mjs §Limits.');
    process.exit(1);
  }

  console.log(
    'check-capacitor-generated: regenerated and byte-identical ' +
      `(${result.compared.join(', ')}).`,
  );
}
