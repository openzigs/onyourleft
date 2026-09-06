#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Assert that the accessibility gate runs every accessibility test.
 *
 * ## The failure this exists to stop
 *
 * `pnpm run test:a11y` used to be `vitest run --project web a11y`, whose
 * trailing token is a path SUBSTRING. That fails closed against deleting
 * `apps/web/src/a11y/` — Vitest exits non-zero when a filter selects nothing —
 * and OPEN against renaming it. Measured on this repository before the change,
 * not reasoned about: renaming the directory to `src/accessibility/` dropped
 * `audit.test.ts`, the suite that proves every rule in `ACCESSIBILITY_RULES`
 * actually fires, and the step stayed green with 6 files and 61 tests instead
 * of 7 and 101. A gate that silently stops covering its own completeness check
 * is worse than no gate, because CI still reports success. #142.
 *
 * ## What replaced it, and what this script adds
 *
 * The filter is now `.a11y.test.`, which matches the FILENAME rather than the
 * folder, so no directory rename can drop a file out of the gate. That removes
 * the failure rather than detecting it — but it leaves one hole: a genuine
 * accessibility test added under a name that does not carry the convention is
 * silently outside the gate, which is the same vacuous pass wearing different
 * clothes.
 *
 * So this script asserts the selected set against the disk:
 *
 * 1. Every `*.a11y.test.{ts,tsx}` under `apps/*` is selected by the gate.
 * 2. Everything the gate selects carries that convention — a filter widened
 *    back to a directory substring fails here rather than passing quietly.
 * 3. Every `*.test.{ts,tsx}` inside a directory named `a11y` or `accessibility`
 *    carries the convention, so a new accessibility test that forgets it fails
 *    the build instead of being skipped. This is the criterion the naming
 *    convention alone cannot meet.
 * 4. The gate selects at least one file, so deletion still fails here as well
 *    as inside Vitest.
 *
 * ## Where the selector comes from
 *
 * Out of `package.json`'s `test:a11y` script, never duplicated here. A copy is
 * a second source of truth that agrees with the first exactly until someone
 * edits one — and it would agree while being wrong, which is the whole defect
 * class above. The script is required to read `vitest run <args...>`; anything
 * else fails, because a shape this cannot parse is a shape it cannot check.
 *
 * ## The seam its own suite uses
 *
 * `--selected <file>` supplies the selection instead of running Vitest, so
 * `check-a11y-suite.test.sh` can drive every branch against throwaway fixture
 * trees in milliseconds. The Vitest-invoking path is exercised for real by the
 * CI step that runs this with no arguments, immediately before the gate itself.
 *
 * Usage: node scripts/check-a11y-suite.mjs [--root <dir>] [--selected <file>]
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Directory names whose test files are accessibility tests whatever they are called. */
const ACCESSIBILITY_DIRECTORIES = new Set(['a11y', 'accessibility']);

/** The filename convention the gate selects on. */
const CONVENTION = /\.a11y\.test\.tsx?$/;

const ANY_TEST = /\.test\.tsx?$/;

/** Directories never worth walking into. */
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage', '.git']);

/**
 * The Vitest arguments the `test:a11y` script runs, so the check and the gate
 * cannot select differently.
 *
 * Throws rather than guessing: an unparseable script is a gate this cannot
 * verify, and returning "no problems" for one would be the vacuous pass again.
 */
export function vitestArgsFrom(script) {
  if (typeof script !== 'string' || script.trim() === '') {
    throw new Error('package.json has no `test:a11y` script for this check to verify.');
  }
  const tokens = script.trim().split(/\s+/);
  if (tokens[0] !== 'vitest' || tokens[1] !== 'run' || tokens.length < 3) {
    throw new Error(
      `\`test:a11y\` is \`${script}\`, which this check cannot read. It expects ` +
        '`vitest run <args...>` so it can re-run the same selection with `vitest list`. ' +
        'Change this script and check-a11y-suite.mjs together.',
    );
  }
  return tokens.slice(2);
}

/** Every `*.test.ts`/`*.test.tsx` under `dir`, as paths relative to `root`. */
export function testFilesUnder(root, dir) {
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      found.push(...testFilesUnder(root, full));
    } else if (ANY_TEST.test(entry.name)) {
      found.push(relative(root, full).split(sep).join('/'));
    }
  }
  return found;
}

/** Every test file under every `apps/<app>/` directory, relative to `root`. */
export function appTestFiles(root) {
  let apps;
  try {
    apps = readdirSync(join(root, 'apps'), { withFileTypes: true });
  } catch {
    return [];
  }
  return apps
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => testFilesUnder(root, join(root, 'apps', entry.name)))
    .sort();
}

/** Whether any directory in this path is one accessibility tests live in. */
export function inAccessibilityDirectory(path) {
  return path
    .split('/')
    .slice(0, -1)
    .some((segment) => ACCESSIBILITY_DIRECTORIES.has(segment));
}

/**
 * What is wrong, in the terms a fixer needs. Empty means the gate covers
 * exactly the accessibility tests that exist.
 */
export function problems(selected, testFiles) {
  const expected = testFiles.filter((path) => CONVENTION.test(path));
  const selectedSet = new Set(selected);
  const expectedSet = new Set(expected);
  const found = [];

  if (selected.length === 0) {
    found.push(
      'The accessibility gate selects no files at all. Either every accessibility test has ' +
        'been deleted, or its filter no longer matches anything.',
    );
  }
  for (const path of expected) {
    if (!selectedSet.has(path)) {
      found.push(
        `${path} is an accessibility test the gate does not run. Its filter and the ` +
          '`*.a11y.test.*` convention have come apart.',
      );
    }
  }
  for (const path of selected) {
    if (!expectedSet.has(path)) {
      found.push(
        `${path} is selected by the accessibility gate but does not carry the ` +
          '`*.a11y.test.*` convention. A filter that matches a directory instead of a ' +
          'filename is the one #142 removed: it passes vacuously when the directory is renamed.',
      );
    }
  }
  for (const path of testFiles) {
    if (CONVENTION.test(path) || !inAccessibilityDirectory(path)) continue;
    found.push(
      `${path} is a test in an accessibility directory but is not named ` +
        '`*.a11y.test.*`, so the gate will not run it. Rename it — adding a file to the ' +
        'gate must not require editing CI config.',
    );
  }
  return found;
}

/** Ask Vitest which files the gate's own selector picks. */
function selectionFromVitest(root, args) {
  const output = execFileSync('pnpm', ['exec', 'vitest', 'list', '--filesOnly', ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  return parseSelection(output);
}

/** `[project] path` per line, as `vitest list --filesOnly` prints it. */
export function parseSelection(output) {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const match = /^\[[^\]]*]\s+(.*)$/.exec(line);
      return match === null ? line : match[1];
    })
    .sort();
}

const isEntryPoint = import.meta.url === `file://${process.argv[1]}`;
if (isEntryPoint) {
  const argv = process.argv.slice(2);
  const valueOf = (flag) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const root = valueOf('--root') ?? process.cwd();
  const selectedFile = valueOf('--selected');

  let selected;
  let testFiles;
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const args = vitestArgsFrom(manifest.scripts?.['test:a11y']);
    selected =
      selectedFile === undefined
        ? selectionFromVitest(root, args)
        : parseSelection(readFileSync(selectedFile, 'utf8'));
    testFiles = appTestFiles(root);
  } catch (error) {
    console.error(`check-a11y-suite: ${error.message}`);
    process.exit(1);
  }

  const found = problems(selected, testFiles);
  if (found.length > 0) {
    console.error('check-a11y-suite: the accessibility gate does not cover what it claims to.\n');
    for (const problem of found) console.error(`  - ${problem}`);
    console.error('\nSee CLAUDE.md §4e and scripts/check-a11y-suite.mjs.');
    process.exit(1);
  }
  console.log(
    `check-a11y-suite: the gate runs all ${String(selected.length)} accessibility test files.`,
  );
}
