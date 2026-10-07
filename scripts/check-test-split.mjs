#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Assert that splitting the Vitest run three ways drops no test file and runs
 * none twice (#852, #1076).
 *
 * ## Why the run is split at all
 *
 * The required CI job runs the suite under `--coverage`, and some files spend
 * a large share of its time:
 *
 * - the #545 near-field rides, the FIT decode fuzz and — since #1076 — the
 *   realistic world's texture checks (`realistic-textures.test.ts`). V8's
 *   coverage instrumentation slows the first two about three times, and the
 *   third is the opt-in realistic world, which the owner moved to the nightly
 *   job (#866's class). `test:coverage` leaves them out with `--exclude`, and
 *   `test:uninstrumented` runs exactly them, with no coverage, NIGHTLY;
 * - since #1076, every `.a11y.test.` file. The `Accessibility` step runs them
 *   as `test:a11y`, under a name that says what broke, and until #1076
 *   `test:coverage` ran all fifty of them a second time. They now run once,
 *   in that step, and `test:coverage` excludes them.
 *
 * Coverage is REPORTED here, never gated (CLAUDE.md §5). What changes is the
 * report — it stops counting what those files alone execute — not what fails.
 *
 * ## The failure this exists to stop
 *
 * Three lists of one set of files, in three scripts, can come apart, and every
 * way they come apart is a green run over fewer tests:
 *
 * - a file renamed: the `--exclude` stops matching, so it is back under
 *   coverage, and the uninstrumented filter matches nothing;
 * - an exclude widened (`**` + `/decode-fuzz.test.ts` also matches
 *   `packages/protocol`'s fuzz): a file is in NO run;
 * - an accessibility test outside the project `test:a11y` names: the exclude
 *   takes it out of coverage and the accessibility run never selects it;
 * - a filter added without its exclude: a file runs twice, once instrumented,
 *   which is the cost this split exists to remove.
 *
 * ⚠️ An `--exclude` glob is matched against each Vitest PROJECT's root, not
 * the repository's — measured: `apps/web/src/game/near-field.test.ts` excludes
 * nothing, `src/game/near-field.test.ts` excludes it, and would exclude a file
 * of that name in every other project too. That is why this compares what
 * Vitest SELECTS rather than reading the globs.
 *
 * ## The rules
 *
 * 1. `test:coverage` is `vitest run --coverage` followed only by
 *    `--exclude <glob>` pairs; `test:uninstrumented` is `vitest run` followed
 *    only by path filters; `test:a11y` is `vitest run --project <name>`
 *    followed only by filters. Anything else is a shape this cannot check, and
 *    fails — and so is a script holding anything the shell would read before
 *    Vitest does: a quote that does not enclose a whole word, a backslash, an
 *    unquoted glob, `$`, a separator (#864). A whole word in SINGLE quotes is
 *    read (#1076): `sh` expands nothing inside them, so the word is exactly
 *    what is between them, and an exclude glob needs them.
 * 2. The uninstrumented run selects at least one file, and every one of its
 *    filters selects exactly one. The accessibility run selects at least one.
 * 3. No file is in two runs.
 * 4. Every file the whole suite (`vitest run`) selects is in one of the three.
 *
 * ## The seam its own suite uses
 *
 * `--lists <dir>` reads the four selections from `all.txt`,
 * `instrumented.txt`, `uninstrumented.txt` and `a11y.txt` in that directory
 * instead of asking Vitest, so `check-test-split.test.sh` can drive every rule
 * in milliseconds. CI runs this with no arguments, against Vitest itself.
 *
 * Usage: node scripts/check-test-split.mjs [--root <dir>] [--lists <dir>]
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The characters a script may hold, outside single quotes, for splitting it on
 * spaces to give the words `sh` would give (#864). pnpm runs a script through
 * `sh -c`, which reads quotes, backslashes, `$`, backticks, globs, `~`,
 * comments and command separators before Vitest sees an argument — so an
 * unquoted `*` names whatever files it matches in the directory the script
 * runs from. Rather than re-implement the shell's word splitting, a script
 * holding anything else is REFUSED: it fails closed, naming the characters,
 * and a path needing one is renamed.
 *
 * The one quoting read is a WHOLE word in single quotes (#1076): inside them
 * `sh` expands nothing and ends the word at nothing but the closing quote, so
 * the word is exactly the text between them. A quote that opens or closes
 * mid-word, a double quote, and an unclosed quote are still refused.
 */
const PLAIN_WORD = /^[A-Za-z0-9_./@:=+,%-]+$/;

/** The words of `script` as `sh` would split them. Throws if that is not certain. */
function shellWords(name, script) {
  const words = [];
  let rest = script.trim();
  let refused = false;
  while (rest !== '' && !refused) {
    const quoted = /^'([^']*)'(?= |$)/.exec(rest);
    const plain = /^([^ ]+)/.exec(rest);
    if (quoted !== null) {
      words.push(quoted[1]);
      rest = rest.slice(quoted[0].length).trimStart();
    } else if (plain !== null && PLAIN_WORD.test(plain[1])) {
      words.push(plain[1]);
      rest = rest.slice(plain[0].length).trimStart();
    } else {
      refused = true;
    }
  }
  if (refused) {
    const outsideQuotes = script.replace(/(^| )'[^']*'(?= |$)/g, '$1');
    const odd = [...new Set(outsideQuotes.replace(/[A-Za-z0-9_./@:=+,%\- ]/g, ''))]
      .map((character) => JSON.stringify(character))
      .join(' ');
    throw new Error(
      `\`${name}\` is \`${script}\`, which holds ${odd}: \`sh\` reads quoting, globs, ` +
        'variables and separators in a script before Vitest does, and this check splits on ' +
        'spaces and reads only a whole word in single quotes, so it refuses what it would ' +
        'read differently. Use plain paths, or single-quote the whole word.',
    );
  }
  return words;
}

/**
 * The `--exclude` globs `test:coverage` passes. Throws on any other shape.
 */
export function excludesFrom(script) {
  if (typeof script !== 'string' || script.trim() === '') {
    throw new Error('package.json has no `test:coverage` script for this check to verify.');
  }
  const tokens = shellWords('test:coverage', script);
  const shape =
    '`vitest run --coverage` followed only by `--exclude <glob>` pairs. ' +
    'Change this script and check-test-split.mjs together.';
  if (tokens[0] !== 'vitest' || tokens[1] !== 'run' || tokens[2] !== '--coverage') {
    throw new Error(`\`test:coverage\` is \`${script}\`; this check expects ${shape}`);
  }
  const rest = tokens.slice(3);
  const globs = [];
  for (let index = 0; index < rest.length; index += 2) {
    const glob = rest[index + 1];
    if (rest[index] !== '--exclude' || glob === undefined || glob.startsWith('-')) {
      throw new Error(`\`test:coverage\` is \`${script}\`; this check expects ${shape}`);
    }
    globs.push(glob);
  }
  return globs;
}

/**
 * The path filters `test:uninstrumented` passes. Throws on any other shape,
 * including a flag: `--coverage` there would put the cost back.
 */
export function filtersFrom(script) {
  if (typeof script !== 'string' || script.trim() === '') {
    throw new Error('package.json has no `test:uninstrumented` script for this check to verify.');
  }
  const tokens = shellWords('test:uninstrumented', script);
  const filters = tokens.slice(2);
  if (
    tokens[0] !== 'vitest' ||
    tokens[1] !== 'run' ||
    filters.length === 0 ||
    filters.some((token) => token.startsWith('-'))
  ) {
    throw new Error(
      `\`test:uninstrumented\` is \`${script}\`; this check expects \`vitest run\` followed ` +
        'only by the paths of the files it runs, and at least one. Change this script and ' +
        'check-test-split.mjs together.',
    );
  }
  return filters;
}

/**
 * The arguments `test:a11y` passes after `vitest run`: `--project <name>` and
 * at least one filter (#1076). Throws on any other shape — `--coverage` there
 * would put back the cost of running these files twice.
 */
export function a11yArgumentsFrom(script) {
  if (typeof script !== 'string' || script.trim() === '') {
    throw new Error('package.json has no `test:a11y` script for this check to verify.');
  }
  const tokens = shellWords('test:a11y', script);
  const filters = tokens.slice(4);
  if (
    tokens[0] !== 'vitest' ||
    tokens[1] !== 'run' ||
    tokens[2] !== '--project' ||
    tokens[3] === undefined ||
    tokens[3].startsWith('-') ||
    filters.length === 0 ||
    filters.some((token) => token.startsWith('-'))
  ) {
    throw new Error(
      `\`test:a11y\` is \`${script}\`; this check expects \`vitest run --project <name>\` ` +
        'followed only by filters, and at least one. Change this script and ' +
        'check-test-split.mjs together.',
    );
  }
  return tokens.slice(2);
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

/**
 * What is wrong, in the terms a fixer needs. Empty means the three runs are
 * exactly the whole suite, once each.
 */
export function problems({ all, instrumented, uninstrumented, a11y, filters }) {
  const found = [];
  const runs = [
    ['`test:coverage`', new Set(instrumented)],
    ['`test:uninstrumented`', new Set(uninstrumented)],
    ['`test:a11y`', new Set(a11y)],
  ];

  if (uninstrumented.length === 0) {
    found.push(
      '`test:uninstrumented` selects no files at all, so its step is green over nothing. ' +
        'A file it names has probably been renamed or deleted.',
    );
  }
  if (a11y.length === 0) {
    found.push(
      '`test:a11y` selects no files at all, so the Accessibility step is green over nothing.',
    );
  }
  for (const filter of filters) {
    const matches = uninstrumented.filter((path) => path.includes(filter));
    if (matches.length !== 1) {
      found.push(
        `\`test:uninstrumented\`'s filter \`${filter}\` selects ${String(matches.length)} ` +
          'files where it must select exactly one — name the file by its whole path from ' +
          'the repository root.',
      );
    }
  }
  const everywhere = new Set([...instrumented, ...uninstrumented, ...a11y]);
  for (const path of [...everywhere].sort()) {
    const holding = runs.filter(([, set]) => set.has(path)).map(([name]) => name);
    if (holding.length > 1) {
      found.push(
        `${path} runs in ${holding.join(' and ')} — more than one run. An \`--exclude\` ` +
          'is missing or no longer matches it (a glob there is relative to its Vitest ' +
          'project, not the repository).',
      );
    }
  }
  for (const path of all) {
    if (!everywhere.has(path)) {
      found.push(
        `${path} runs in NONE of \`test:coverage\`, \`test:uninstrumented\` and ` +
          '`test:a11y`, so CI never runs it. An `--exclude` matches it that neither other ' +
          'run selects.',
      );
    }
  }
  return found;
}

/** Ask Vitest which files a selection picks. */
function selectionFromVitest(root, args) {
  const output = execFileSync('pnpm', ['exec', 'vitest', 'list', '--filesOnly', ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return parseSelection(output);
}

/**
 * `vitest list` exits non-zero when a filter selects nothing. That is rule 2's
 * finding rather than a crash, so it is read as an empty selection.
 */
function selectionOrEmpty(root, args) {
  try {
    return selectionFromVitest(root, args);
  } catch {
    return [];
  }
}

// Compared through `realpathSync`: see check-a11y-suite.mjs for the measured
// reason the two simpler forms report success without running.
const entryPoint = process.argv[1];
const isEntryPoint = entryPoint !== undefined && import.meta.filename === realpathSync(entryPoint);
if (isEntryPoint) {
  const argv = process.argv.slice(2);
  const valueOf = (flag) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const root = valueOf('--root') ?? process.cwd();
  const lists = valueOf('--lists');

  let selections;
  let filters;
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const excludes = excludesFrom(manifest.scripts?.['test:coverage']);
    filters = filtersFrom(manifest.scripts?.['test:uninstrumented']);
    const a11yArguments = a11yArgumentsFrom(manifest.scripts?.['test:a11y']);
    const read = (name) => parseSelection(readFileSync(join(lists, name), 'utf8'));
    selections =
      lists === undefined
        ? {
            all: selectionFromVitest(root, []),
            instrumented: selectionFromVitest(
              root,
              excludes.flatMap((glob) => ['--exclude', glob]),
            ),
            uninstrumented: selectionOrEmpty(root, filters),
            a11y: selectionOrEmpty(root, a11yArguments),
          }
        : {
            all: read('all.txt'),
            instrumented: read('instrumented.txt'),
            uninstrumented: read('uninstrumented.txt'),
            a11y: read('a11y.txt'),
          };
  } catch (error) {
    console.error(`check-test-split: ${error.message}`);
    process.exit(1);
  }

  if (selections.all.length === 0) {
    console.error(
      'check-test-split: the whole suite selects no files, so there is nothing to compare.',
    );
    process.exit(1);
  }
  const found = problems({ ...selections, filters });
  if (found.length > 0) {
    console.error('check-test-split: the three Vitest runs are not the whole suite, once each.\n');
    for (const problem of found) console.error(`  - ${problem}`);
    console.error('\nSee docs/agents/ci.md §4c and scripts/check-test-split.mjs.');
    process.exit(1);
  }
  console.log(
    `check-test-split: all ${String(selections.all.length)} test files run once — ` +
      `${String(selections.instrumented.length)} under coverage, ` +
      `${String(selections.uninstrumented.length)} without it (nightly), ` +
      `${String(selections.a11y.length)} in the Accessibility step.`,
  );
}
