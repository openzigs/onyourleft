// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Names every test a run did not reach — #1675.
 *
 * When a run reaches its `--global-timeout`, Playwright's own summary says
 * `9 did not run` and names none of them, and the step's log then lists only
 * what passed. A test that never ran is invisible: nobody reads a count of
 * them as "these nine checks are off". This reporter, beside `list`, prints
 * each by its project, file, line and titles, and on GitHub Actions files one
 * `::error` annotation with the same list, so the run's summary page names
 * them too.
 *
 * ⚠️ **A run that left tests unrun is a failed run**, whatever else it
 * reports: `onEnd` returns `failed` for a run that would otherwise pass.
 * Playwright already exits non-zero on a global timeout; this holds the same
 * of any other road to an unrun test.
 *
 * "Did not run" is Playwright's own predicate, from its summary in
 * `playwright/lib/runner` 1.63.0: skipped, not interrupted (an interrupted test
 * is named by `list` already), and either with no result at all or skipped
 * when it was not meant to be. A `test.skip()` is meant to be, and is not
 * named here.
 *
 * ⚠️ **`playwright test --list` runs reporters too**, and every test in it has
 * no result. A run that began no test and still passed is that listing, not
 * a run that stopped, so it says nothing: a run that stops before its first
 * test is not `passed` and is named in full.
 */

import { relative } from 'node:path';

import type { FullResult, Reporter, Suite, TestCase } from '@playwright/test/reporter';

/** The part of a `TestCase` the predicate and the line read. */
export type NotRunCase = Pick<
  TestCase,
  'expectedStatus' | 'location' | 'outcome' | 'results' | 'titlePath'
>;

/** Whether Playwright counts this test among those that "did not run". */
export function didNotRun(test: NotRunCase): boolean {
  if (test.outcome() !== 'skipped') return false;
  if (test.results.some((result) => result.status === 'interrupted')) return false;
  return test.results.length === 0 || test.expectedStatus !== 'skipped';
}

/** `[project] › file:line › describe › title`, as the `list` reporter names a test. */
export function nameOf(test: NotRunCase, rootDir: string): string {
  // titlePath() is ['', project, file, ...describes, title].
  const [, project = '', , ...titles] = test.titlePath();
  const where = `${relative(rootDir, test.location.file)}:${String(test.location.line)}`;
  return [`[${project}]`, where, ...titles].join(' › ');
}

/** A GitHub workflow command's message, escaped as the runner reads it. */
const escapeAnnotation = (text: string): string =>
  text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

/** The lines this reporter prints for the tests that did not run; none if every test ran. */
export function notRunLines(names: readonly string[], github: boolean): string[] {
  if (names.length === 0) return [];
  const heading = `${String(names.length)} did not run, and this run fails for it — #1675:`;
  const lines = [heading, ...names.map((name) => `  - ${name}`)];
  if (github) {
    lines.push(
      `::error title=${String(names.length)} browser tests did not run::${escapeAnnotation(
        [heading, ...names].join('\n'),
      )}`,
    );
  }
  return lines;
}

export default class NotRunReporter implements Reporter {
  private suite: Suite | undefined;
  private began = false;

  onBegin(_config: unknown, suite: Suite): void {
    this.suite = suite;
  }

  onTestBegin(): void {
    this.began = true;
  }

  onEnd(result: FullResult): Promise<{ status: FullResult['status'] } | undefined> {
    // A listing: see the file header.
    if (!this.began && result.status === 'passed') return Promise.resolve(undefined);
    const names = (this.suite?.allTests() ?? [])
      .filter(didNotRun)
      .map((test) => nameOf(test, process.cwd()));
    // `CI`, which GitHub's runner sets, rather than a GitHub-only name: the
    // repository's env-template rule (ENV001) admits CI as built in.
    const lines = notRunLines(names, process.env['CI'] === 'true');
    for (const line of lines) console.log(line);
    if (names.length > 0 && result.status === 'passed') {
      return Promise.resolve({ status: 'failed' });
    }
    return Promise.resolve(undefined);
  }

  printsToStdio(): boolean {
    return true;
  }
}
