// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The lint block that keeps the re-plan validator pure (#1296, for #1242 and
 * ADR 0048 D-5): `eslint.config.js` refuses `Date` and `Math.random` in
 * `packages/domain/src/workout/replan.ts`, and until this file nothing showed
 * that it does. A block whose `files` glob stopped matching would lint clean.
 *
 * The fixture is linted as the real `pnpm run lint` would lint that file: the
 * repository's own ESLint, its own config, the text on stdin under the
 * validator's path. Nothing is written to the tree. ESLint is started twice
 * for the whole file, before the tests, because starting it takes seconds on
 * a busy runner.
 *
 * It lives here because it needs a process and a file path, and
 * `packages/domain` is typed with no platform API at all.
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const VALIDATOR = 'packages/domain/src/workout/replan.ts';
const NEIGHBOUR = 'packages/domain/src/workout/heart-rate-hold.ts';

/** One statement a line, so a finding's line says which statement it is about. */
const FIXTURE = [
  '// SPDX-License-Identifier: Apache-2.0',
  '',
  'export const lead = 30;',
  'export const clock = Date.now();',
  'export const calendar = new Date();',
  'export const roll = Math.random();',
  "export const answer = fetch('https://example.invalid');",
  '',
].join('\n');
const LINE = { pure: 3, clock: 4, calendar: 5, roll: 6, answer: 7 } as const;

interface Finding {
  readonly ruleId: string | null;
  readonly line: number;
  readonly message: string;
}

/** What ESLint says about {@link FIXTURE} if it were the file at `path`. */
function lint(path: string): readonly Finding[] {
  const run = spawnSync(
    process.execPath,
    [
      join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js'),
      '--stdin',
      '--stdin-filename',
      path,
      '--format',
      'json',
    ],
    { cwd: ROOT, input: FIXTURE, encoding: 'utf8' },
  );
  // 1 is "there are findings"; anything else is not a lint of this fixture.
  expect(run.status, run.stderr).toBe(1);
  const files = JSON.parse(run.stdout) as readonly { readonly messages: readonly Finding[] }[];
  expect(files).toHaveLength(1);
  return files[0]?.messages ?? [];
}

describe('the lint block for replan.ts — #1296', () => {
  let validator: readonly Finding[] = [];
  let neighbour: readonly Finding[] = [];
  beforeAll(() => {
    validator = lint(VALIDATOR);
    neighbour = lint(NEIGHBOUR);
  }, 120_000);

  const on = (findings: readonly Finding[], line: number): readonly Finding[] =>
    findings.filter((each) => each.line === line);

  it('finds nothing in a pure line, so a finding below is the statement and not the harness', () => {
    expect(on(validator, LINE.pure)).toStrictEqual([]);
    expect(validator.filter((each) => each.line < LINE.pure)).toStrictEqual([]);
  });

  it('refuses a clock', () => {
    for (const line of [LINE.clock, LINE.calendar]) {
      const findings = on(validator, line);
      expect(findings.map((each) => each.ruleId)).toStrictEqual(['no-restricted-globals']);
      expect(findings[0]?.message).toContain('`now` arrives as a parameter');
    }
  });

  it('refuses a random number', () => {
    const findings = on(validator, LINE.roll);
    expect(findings.map((each) => each.ruleId)).toStrictEqual(['no-restricted-properties']);
    expect(findings[0]?.message).toContain('replan.ts is deterministic');
  });

  it('still refuses a platform global, which the block repeats from the domain block', () => {
    const findings = on(validator, LINE.answer);
    expect(findings.map((each) => each.ruleId)).toContain('no-restricted-globals');
  });

  it('is scoped to the validator: its neighbour is not held to it', () => {
    expect(neighbour.filter((each) => each.message.includes('replan.ts'))).toStrictEqual([]);
    // The neighbour is still linted: the platform global is refused there too.
    expect(on(neighbour, LINE.answer).map((each) => each.ruleId)).toContain(
      'no-restricted-globals',
    );
  });
});
