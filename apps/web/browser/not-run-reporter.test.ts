// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `not-run-reporter.ts` — #1675. Drives the reporter the way Playwright does,
 * `onBegin` with a suite and `onEnd` with the run's result, over stand-in test
 * cases, and reads back what it printed and the status it returned.
 */

import type { FullResult, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { afterEach, describe, expect, it, vi } from 'vitest';

import config from '../playwright.config';

import NotRunReporter, { didNotRun, nameOf, notRunLines } from './not-run-reporter';

type Status = TestResult['status'];

function testCase(
  title: string,
  outcome: ReturnType<TestCase['outcome']>,
  statuses: Status[],
  expectedStatus: TestCase['expectedStatus'] = 'passed',
): TestCase {
  return {
    expectedStatus,
    location: { file: `${process.cwd()}/browser/realistic.browser.spec.ts`, line: 12, column: 3 },
    outcome: () => outcome,
    results: statuses.map((status) => ({ status }) as TestResult),
    titlePath: () => ['', 'nightly', 'realistic.browser.spec.ts', 'the levers', title],
  } as unknown as TestCase;
}

const suiteOf = (tests: TestCase[]): Suite => ({ allTests: () => tests }) as unknown as Suite;

async function run(tests: TestCase[], status: FullResult['status'], began = true) {
  const printed: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((line: string) => {
    printed.push(line);
  });
  const reporter = new NotRunReporter();
  reporter.onBegin({}, suiteOf(tests));
  if (began) reporter.onTestBegin();
  const returned = await reporter.onEnd({ status } as FullResult);
  log.mockRestore();
  return { printed, returned };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('which tests did not run — Playwright’s own predicate', () => {
  it('counts a test with no result, which is what a global timeout leaves', () => {
    expect(didNotRun(testCase('unreached', 'skipped', []))).toBe(true);
  });

  it('does not count a test that ran, passed or failed', () => {
    expect(didNotRun(testCase('passed', 'expected', ['passed']))).toBe(false);
    expect(didNotRun(testCase('failed', 'unexpected', ['failed']))).toBe(false);
  });

  it('does not count an interrupted test, which `list` already names', () => {
    expect(didNotRun(testCase('cut short', 'skipped', ['interrupted']))).toBe(false);
  });

  it('does not count a test that skipped itself on purpose', () => {
    expect(didNotRun(testCase('test.skip', 'skipped', ['skipped'], 'skipped'))).toBe(false);
  });

  it('counts a test skipped that was not meant to be', () => {
    expect(didNotRun(testCase('serial tail', 'skipped', ['skipped'], 'passed'))).toBe(true);
  });
});

describe('what it prints, and what it makes the run', () => {
  it('is a reporter of every run the config makes, beside `list`', () => {
    // One config stops the required gate and the nightly run alike, so both
    // name what they did not reach.
    expect(config.reporter).toEqual([['list'], ['./browser/not-run-reporter.ts']]);
  });

  it('names a test by project, file, line and titles', () => {
    expect(nameOf(testCase('a lever', 'skipped', []), process.cwd())).toBe(
      '[nightly] › browser/realistic.browser.spec.ts:12 › the levers › a lever',
    );
  });

  it('names every test a timed-out run did not reach, and none it did', async () => {
    const { printed, returned } = await run(
      [
        testCase('ran', 'expected', ['passed']),
        testCase('first unreached', 'skipped', []),
        testCase('second unreached', 'skipped', []),
      ],
      'timedout',
    );
    expect(printed).toEqual([
      '2 did not run, and this run fails for it — #1675:',
      '  - [nightly] › browser/realistic.browser.spec.ts:12 › the levers › first unreached',
      '  - [nightly] › browser/realistic.browser.spec.ts:12 › the levers › second unreached',
    ]);
    // Already a failure; the reporter leaves Playwright's own status.
    expect(returned).toBeUndefined();
  });

  it('turns a run that would pass into a failed one when a test did not run', async () => {
    const { returned } = await run([testCase('unreached', 'skipped', [])], 'passed');
    expect(returned).toEqual({ status: 'failed' });
  });

  it('names every test when the run stopped before its first one', async () => {
    const { printed } = await run([testCase('unreached', 'skipped', [])], 'timedout', false);
    expect(printed[0]).toBe('1 did not run, and this run fails for it — #1675:');
  });

  it('says nothing about a listing, `playwright test --list`, which runs no test and passes', async () => {
    const { printed, returned } = await run([testCase('listed', 'skipped', [])], 'passed', false);
    expect(printed).toEqual([]);
    expect(returned).toBeUndefined();
  });

  it('says nothing and changes nothing when every test ran', async () => {
    const { printed, returned } = await run([testCase('ran', 'expected', ['passed'])], 'passed');
    expect(printed).toEqual([]);
    expect(returned).toBeUndefined();
  });

  it('files one annotation naming them, on CI only', async () => {
    vi.stubEnv('CI', 'true');
    const { printed } = await run([testCase('unreached', 'skipped', [])], 'timedout');
    expect(printed.at(-1)).toBe(
      '::error title=1 browser tests did not run::1 did not run, and this run fails for it — #1675:%0A' +
        '[nightly] › browser/realistic.browser.spec.ts:12 › the levers › unreached',
    );
    vi.stubEnv('CI', '');
    const off = await run([testCase('unreached', 'skipped', [])], 'timedout');
    expect(off.printed.join('\n')).not.toContain('::error');
  });

  it('escapes what the runner would read as a command', () => {
    expect(notRunLines(['100% a\nb'], true).at(-1)).toContain('%0A100%25 a%0Ab');
  });
});
