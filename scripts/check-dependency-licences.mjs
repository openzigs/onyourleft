#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Assert that every dependency's own licence is permitted under the path its
 * package lands in.
 *
 * ## The half of the HARD RULE that was not enforced
 *
 * CLAUDE.md §3 makes the licence boundary a **path**: everything under
 * `packages/` is Apache-2.0, everything under `apps/` is AGPL-3.0-or-later.
 * `scripts/check-repo-rules.sh` enforces that for files we write — the SPDX
 * header (LIC001/LIC002) and the manifest field (LIC003). Nothing enforced it
 * for the code we *pull in*, which is the direction the rule actually protects
 * against: a GPL dependency inside an Apache-2.0 leaf package is a licensing
 * incident, and it arrives as an ordinary-looking version bump.
 *
 * ADR 0001's *Constraints* item 3 states the rule — "#23 must not add a
 * dependency whose licence conflicts with the package it lands in" — and
 * [ADR 0015](../docs/adr/0015-dependency-licences.md) is what makes it
 * checkable: which licences, in which closure, under which path.
 *
 * This is not theoretical. Two traps recorded in #24, both invisible in a
 * diff: `webbluetooth` publishes **licence-variant majors** (3.x MIT, 4.x
 * BSD-3, 5.x GPL-3.0, 6.x BUSL-1.1), so a careless major bump silently
 * relicenses whatever depends on it; and `flutter_blue_plus` relicensed from
 * BSD-3 to a proprietary licence between versions.
 *
 * ## Two closures, because "distributed" is the question the licence asks
 *
 * A licence's obligations attach to what you **distribute**. A test runner is
 * not distributed, so the same licence can be fine at build time and wrong in
 * a shipped artefact. The checker therefore reads two closures per package and
 * judges them by different tables — see ADR 0015 D-2, and `POLICY` below.
 *
 * Today that distinction is the whole reason this gate can be strict without
 * being a lie: `packages/domain`, `fit`, `physics` and `sensors` have **zero**
 * production dependencies, `store` has one (`dexie`, Apache-2.0), and
 * `apps/web` has 28, all permissive. Every one of the licences CLAUDE.md §3
 * listed as "not ruled on yet" reaches every package **only** through Vitest.
 *
 * ## Where the closures come from, and the probe that does not work
 *
 * From `pnpm licenses list --json --filter <pkg> [--prod]`, which is pnpm's
 * own resolution of its own lockfile. Not from a hand-rolled walk of
 * `node_modules`, and not from `require.resolve`: CLAUDE.md §3 records that a
 * clean `require.resolve` probe "is not evidence of anything", because under
 * pnpm's isolated `node_modules` it returns *not resolvable* for every
 * transitive dependency — including ones that genuinely do reach the package.
 *
 * ⚠️ **`--filter` does NOT follow workspace links.** Measured, not assumed:
 * `apps/web` declares `@onyourleft/store` as a production dependency and
 * `store` declares `dexie`, yet `dexie` does not appear in
 * `--filter @onyourleft/web --prod`. It appears under
 * `--filter @onyourleft/store --prod`, where the licence question actually
 * belongs — `dexie` lands in `store`, so `store`'s path is what governs it.
 *
 * The consequence is the one design constraint here: **the union over every
 * workspace package is what makes the check complete**, so the package list is
 * discovered from the workspace rather than written down. A hard-coded list
 * would silently stop covering a package the day someone adds one, which is
 * the vacuous-pass shape this repository has now shipped five times.
 * `--packages` below is the seam for the suite, and an empty discovery is a
 * failure rather than a clean run.
 *
 * ## Fails closed
 *
 * An unrecognised licence is a violation, not a pass. The point of the gate is
 * the licence nobody has considered yet, so "not in any table" has to be the
 * failing branch — a permissive licence this list does not name costs one line
 * in ADR 0015 and a reviewer's attention, which is the intended price.
 *
 * Rule:
 *   DEP001  a dependency's licence is not permitted in the closure and path
 *           where it was found
 *
 * Usage: node scripts/check-dependency-licences.mjs [--root <dir>]
 *                                                   [--closures <file>]
 *                                                   [--packages <list>]
 * Exit:  0 clean, 1 if any rule is violated.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/**
 * The licence tables, as data.
 *
 * Every name here is an SPDX identifier. The classification and its reasoning
 * are ADR 0015; this is the machine-readable copy, and the ADR is the prose
 * one. Adding a name here without amending the ADR is how the two drift.
 */
const POLICY = {
  /**
   * Permissive. No obligation that survives into a distributed artefact beyond
   * attribution, so these pass everywhere, in both closures, under both paths.
   * This is CLAUDE.md §3's list verbatim.
   */
  permissive: ['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'ISC'],

  /**
   * Ruled on by ADR 0015 D-2, and the reason this checker exists rather than a
   * simple denylist. Weak file-level copyleft and permissive licences the list
   * above does not name. All six are in the tree today and all six arrive
   * through Vitest.
   *
   * Permitted in the build-time-only closure anywhere, and in a distributed
   * closure under `apps/` — where the artefact is AGPL and a file-level
   * obligation changes nothing. **Forbidden in a distributed closure under
   * `packages/`**: an Apache-2.0 leaf package is meant to be droppable into
   * anything, and a shipped MPL file carries obligations that the package's
   * own LICENSE does not describe.
   */
  weak: ['MPL-2.0', 'BlueOak-1.0.0', 'CC0-1.0', 'MIT-0', '0BSD'],

  /**
   * Strong copyleft. Permitted under `apps/` only — the application is
   * AGPL-3.0-or-later, so GPL-family code is compatible there.
   *
   * ⚠️ Forbidden under `packages/` in **both** closures, deliberately. That is
   * stricter than the distributed-artefact argument alone would require, and
   * it is CLAUDE.md §3 verbatim: "A GPL or AGPL dependency anywhere under
   * `packages/` fails CI. If a package needs one, the code moves to `apps/` or
   * the dependency is replaced. There is no third option and no exemption."
   * ADR 0015 D-3 keeps that as it stands rather than relaxing it.
   */
  copyleft: [
    'GPL-2.0',
    'GPL-2.0-only',
    'GPL-2.0-or-later',
    'GPL-3.0',
    'GPL-3.0-only',
    'GPL-3.0-or-later',
    'LGPL-2.1',
    'LGPL-2.1-only',
    'LGPL-2.1-or-later',
    'LGPL-3.0',
    'LGPL-3.0-only',
    'LGPL-3.0-or-later',
    'AGPL-3.0',
    'AGPL-3.0-only',
    'AGPL-3.0-or-later',
  ],
};

/** Which licence sets a given (path, closure) pair admits. ADR 0015 D-1..D-3. */
function admitted(tree, closure) {
  const app = tree === 'apps';
  if (closure === 'distributed') {
    return app
      ? [...POLICY.permissive, ...POLICY.weak, ...POLICY.copyleft]
      : [...POLICY.permissive];
  }
  // Build-time only: nothing here is distributed, so the weak set is admitted
  // under either path. Copyleft still is not, under `packages/`, per D-3.
  return app
    ? [...POLICY.permissive, ...POLICY.weak, ...POLICY.copyleft]
    : [...POLICY.permissive, ...POLICY.weak];
}

/**
 * Evaluate an SPDX licence expression against a set of admitted identifiers.
 *
 * Supports the two operators npm packages actually publish — `OR` and `AND` —
 * with parentheses. `(MIT OR Apache-2.0)` is in the tree today, via
 * `@maplibre/mlt`.
 *
 * The semantics are the ones that matter for a gate:
 *
 * - **OR** passes if ANY operand is admitted. A dual-licensed package lets the
 *   recipient choose, so one acceptable option is enough.
 * - **AND** passes only if EVERY operand is admitted. A combined work imposes
 *   all of its licences at once, so one unacceptable option is fatal.
 *
 * Anything that is not a bare identifier or one of those forms — a `WITH`
 * exception, a `+` suffix, a malformed string — is not recognised and
 * therefore fails, per "fails closed" above. Returns `true` for admitted.
 */
export function expressionAdmitted(expression, allowed) {
  const tokens = String(expression)
    .replace(/([()])/g, ' $1 ')
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return false;

  let index = 0;
  let malformed = false;

  // expr := term (OR term)*   — OR binds loosest, so it is the outer level.
  const parseExpression = () => {
    let value = parseTerm();
    while (tokens[index] === 'OR') {
      index += 1;
      const right = parseTerm();
      value = value || right;
    }
    return value;
  };

  // term := atom (AND atom)*
  const parseTerm = () => {
    let value = parseAtom();
    while (tokens[index] === 'AND') {
      index += 1;
      const right = parseAtom();
      value = value && right;
    }
    return value;
  };

  // atom := '(' expr ')' | identifier
  const parseAtom = () => {
    const token = tokens[index];
    if (token === '(') {
      index += 1;
      const value = parseExpression();
      if (tokens[index] !== ')') {
        malformed = true;
        return false;
      }
      index += 1;
      return value;
    }
    if (token === undefined || token === ')' || token === 'OR' || token === 'AND') {
      malformed = true;
      return false;
    }
    index += 1;
    return allowed.includes(token);
  };

  const result = parseExpression();
  // Trailing tokens mean the expression was not fully consumed, which is a
  // shape this cannot evaluate — and an expression it cannot evaluate is one
  // it must not approve.
  if (malformed || index !== tokens.length) return false;
  return result;
}

/** `packages/domain` -> `packages`. The path IS the boundary (CLAUDE.md §3). */
function treeOf(directory) {
  const normalised = directory.split(path.sep).join('/');
  const segments = normalised.replace(/^\.\//, '').split('/');
  return segments[0];
}

function runPnpm(root, args) {
  return execFileSync('pnpm', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Every workspace package, discovered rather than listed.
 *
 * `pnpm list --recursive --depth -1 --json` reports one entry per importer,
 * which is pnpm's own answer to "what does this workspace contain" and so
 * cannot disagree with the globs in `pnpm-workspace.yaml`. The root importer
 * has no `name` we care about and is dropped by the tree filter below.
 */
function discoverPackages(root) {
  const raw = runPnpm(root, ['list', '--recursive', '--depth', '-1', '--json']);
  const entries = JSON.parse(raw);
  return entries
    .map((entry) => ({
      name: entry.name,
      directory: path.relative(root, entry.path),
    }))
    .filter((entry) => entry.name && ['apps', 'packages'].includes(treeOf(entry.directory)));
}

/** How pnpm says a closure has nothing in it. Prose, on stdout, exit 0. */
const EMPTY_CLOSURE = /No licenses in packages found/;

/** One closure of one package, as `{ name, license }[]`. */
function readClosure(root, packageName, production) {
  const args = ['licenses', 'list', '--json', '--filter', packageName];
  if (production) args.push('--prod');
  let raw;
  try {
    raw = runPnpm(root, args);
  } catch (error) {
    // An empty closure is a legitimate answer — four of the six packages give
    // it for `--prod` — and pnpm reports it as prose rather than as `{}`.
    // Anything else is a real failure and is rethrown.
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    if (EMPTY_CLOSURE.test(output)) return [];
    throw error;
  }
  // ⚠️ And it reports it on **stdout, exiting 0**, so the catch above is not
  // where that case is handled. Checking the text rather than the exit code is
  // the only thing that covers both, and the first version of this file parsed
  // the prose as JSON and crashed.
  if (raw.trim().length === 0 || EMPTY_CLOSURE.test(raw)) return [];
  const byLicence = JSON.parse(raw);
  const found = [];
  for (const group of Object.values(byLicence)) {
    for (const entry of group) {
      found.push({ name: entry.name, license: entry.license });
    }
  }
  return found;
}

/**
 * The closures for every package, in the shape the policy is applied to.
 *
 * `distributed` is `--prod`. `build` is everything else — the full closure
 * minus the distributed one, matched on name, because a package that is both a
 * production dependency here and a dev dependency there is governed by the
 * stricter of the two and would otherwise be reported twice.
 */
function collectClosures(root, packages) {
  const closures = {};
  for (const entry of packages) {
    const all = readClosure(root, entry.name, false);
    const distributed = readClosure(root, entry.name, true);
    const shipped = new Set(distributed.map((dependency) => dependency.name));
    closures[entry.name] = {
      directory: entry.directory,
      distributed,
      build: all.filter((dependency) => !shipped.has(dependency.name)),
    };
  }
  return closures;
}

/** Apply the policy. Returns a list of human-readable findings. */
export function findViolations(closures) {
  const findings = [];
  for (const [packageName, closure] of Object.entries(closures)) {
    const tree = treeOf(closure.directory);
    for (const which of ['distributed', 'build']) {
      const allowed = admitted(tree, which);
      for (const dependency of closure[which] ?? []) {
        if (expressionAdmitted(dependency.license, allowed)) continue;
        findings.push(
          `${packageName} (${closure.directory}): ${dependency.name} is ` +
            `${dependency.license || '<no licence declared>'}, which is not permitted in the ` +
            `${which === 'distributed' ? 'distributed' : 'build-time'} closure of ` +
            `${tree === 'apps' ? 'an AGPL-3.0-or-later application' : 'an Apache-2.0 package'}`,
        );
      }
    }
  }
  return findings.sort((left, right) => left.localeCompare(right));
}

function main(argv) {
  let root = process.cwd();
  let closuresFile = null;
  let packagesOverride = null;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--root') root = argv[(index += 1)];
    else if (flag === '--closures') closuresFile = argv[(index += 1)];
    else if (flag === '--packages') packagesOverride = argv[(index += 1)];
    else {
      process.stderr.write(`check-dependency-licences: unknown argument ${flag}\n`);
      return 1;
    }
  }

  let closures;
  if (closuresFile) {
    // The seam the suite drives. Same shape `collectClosures` produces, so a
    // fixture cannot describe a situation the real path could not.
    closures = JSON.parse(readFileSync(closuresFile, 'utf8'));
  } else {
    const packages = packagesOverride
      ? JSON.parse(readFileSync(packagesOverride, 'utf8'))
      : discoverPackages(root);
    if (packages.length === 0) {
      process.stderr.write(
        'DEP001: no workspace package was discovered under apps/ or packages/, so this ' +
          'check verified nothing. A gate that checks nothing is not a pass.\n',
      );
      return 1;
    }
    closures = collectClosures(root, packages);
  }

  if (Object.keys(closures).length === 0) {
    process.stderr.write('DEP001: no package closures to check, so this check verified nothing.\n');
    return 1;
  }

  const findings = findViolations(closures);
  for (const finding of findings) {
    process.stderr.write(`DEP001: ${finding}\n`);
  }
  if (findings.length > 0) {
    process.stderr.write(
      `\ncheck-dependency-licences: ${String(findings.length)} violation(s). ` +
        'The classification and its reasoning are docs/adr/0015-dependency-licences.md; ' +
        'a licence that belongs in a table is added there and in POLICY together.\n',
    );
    return 1;
  }

  const packageCount = Object.keys(closures).length;
  const dependencyCount = Object.values(closures).reduce(
    (total, closure) => total + (closure.distributed?.length ?? 0) + (closure.build?.length ?? 0),
    0,
  );
  process.stdout.write(
    `check-dependency-licences: ${String(dependencyCount)} dependency licences across ` +
      `${String(packageCount)} workspace packages are permitted where they land.\n`,
  );
  return 0;
}

process.exitCode = main(process.argv.slice(2));
