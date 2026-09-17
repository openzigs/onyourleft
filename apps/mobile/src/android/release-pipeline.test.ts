// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The release pipeline's own drift, which nothing else here can see
 * ([#95](https://github.com/openzigs/onyourleft/issues/95)).
 *
 * ⚠️ **`release.yml` is not a required check and cannot block a merge**, which
 * is right for a tag-triggered job and is exactly why it rots: CLAUDE.md §4c
 * records that its action pins had already drifted behind `rules.yml`'s with
 * nothing noticing. A workflow that only runs on a tag gets reviewed once and
 * then read by nobody until the day somebody needs a release.
 *
 * So the two things about it that are *statements of fact from outside the
 * workflow* are asserted from inside the test suite, which does run on every
 * pull request:
 *
 * 1. **The target API floor is one number in three languages** — Gradle, bash
 *    and YAML — and #95's second criterion is that the app targets it and that
 *    a regression fails. Three copies with no assertion between them is three
 *    chances to fix one and ship the other two.
 * 2. **Every action is pinned to a commit**, CLAUDE.md §8. A tag is mutable, so
 *    a tag pin in the one workflow that holds `contents: write` and decrypts a
 *    signing key is the highest-value supply-chain foothold in this repository.
 * 3. **Which inputs are read from `secrets` and which from `vars`**
 *    ([#338](https://github.com/openzigs/onyourleft/issues/338)). Actions
 *    redacts every occurrence of a secret's *value* from the log, so a
 *    non-secret stored as a secret blanks its own value out of every line that
 *    contains it — the key alias is the word "upload", which blanked the step
 *    name *"Decode the upload key"* and the pinned `actions/upload-artifact`
 *    out of the first run there ever was. Nothing but an assertion keeps a
 *    later hand from moving it back, because the pipeline goes green either
 *    way.
 *
 * ⚠️ **The signing step is EXECUTED here, not read.** Its two refusals — a tag
 * with no keystore, and a keystore with no alias — both have to fail a build
 * that the unsigned fallback would otherwise carry to a green finish, and a
 * test that only greps the YAML for an `exit 1` cannot tell a guard that fires
 * from one that is unreachable. The script is lifted out of the workflow and
 * run under the shell GitHub runs it under.
 *
 * ⚠️ **What this file deliberately does NOT claim.** It reads the workflow as
 * text. It says nothing about whether the pipeline works — that is settled by
 * running it, and `apps/mobile/RELEASE.md` §1 is where the result of doing so
 * is recorded rather than here.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** The repository root, resolved from this file rather than from `cwd`. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf8');

const WORKFLOW = read('.github', 'workflows', 'release.yml');
const REPO_RULES = read('scripts', 'check-repo-rules.sh');
const VARIABLES = read('apps', 'mobile', 'android', 'variables.gradle');

/**
 * The one number, read out of each file the way that file states it.
 *
 * Each reader is deliberately narrow: a permissive pattern that fell back to
 * "any number nearby" would keep agreeing after the declaration it is supposed
 * to be reading had been deleted.
 */
function gradleTarget(): number {
  const match = /targetSdkVersion\s*=\s*(\d+)/.exec(VARIABLES);
  expect(match, 'variables.gradle declares no targetSdkVersion').not.toBeNull();
  return Number(match?.[1]);
}

function repoRuleFloor(): number {
  const match = /^MINIMUM_TARGET_SDK=(\d+)$/m.exec(REPO_RULES);
  expect(match, 'check-repo-rules.sh declares no MINIMUM_TARGET_SDK').not.toBeNull();
  return Number(match?.[1]);
}

function workflowFloor(): number {
  const match = /MINIMUM_TARGET_SDK:\s*'(\d+)'/.exec(WORKFLOW);
  expect(match, 'release.yml declares no MINIMUM_TARGET_SDK').not.toBeNull();
  return Number(match?.[1]);
}

describe('the target API floor', () => {
  it('is the same number in the Gradle build, the repository rule and the release workflow', () => {
    const gradle = gradleTarget();
    expect(repoRuleFloor(), 'scripts/check-repo-rules.sh disagrees with variables.gradle').toBe(
      gradle,
    );
    expect(workflowFloor(), '.github/workflows/release.yml disagrees with variables.gradle').toBe(
      gradle,
    );
  });

  it('is at least the level Google Play requires of a new app or an update', () => {
    // Android 16. Enforced for new apps and updates from 2026-08-31; #95's
    // note that "sources disagree on the exact date" was resolved on
    // 2026-09-16 and the date is recorded in apps/mobile/RELEASE.md §7.
    expect(gradleTarget()).toBeGreaterThanOrEqual(36);
  });
});

describe('the release workflow', () => {
  it('pins every action to a full commit SHA rather than a tag', () => {
    const uses = [...WORKFLOW.matchAll(/^\s*-?\s*uses:\s*(\S+)\s*$/gm)].map((match) => match[1]);
    // A workflow whose `uses:` lines stopped being found would pass a loop over
    // an empty list, which is the shape this repository keeps finding.
    expect(uses.length, 'no `uses:` found in release.yml at all').toBeGreaterThan(0);
    for (const reference of uses) {
      expect(reference, `${reference} is not pinned to a commit`).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it('asks for no permission beyond writing the release it publishes', () => {
    // Every other workflow here is read-only. This one needs `contents: write`
    // to create a Release and must not quietly acquire anything else — it is
    // the job that holds the signing key.
    // `[ \t]` rather than `\s`, which matches a newline and would run the
    // block past the blank line into the next top-level key.
    const block = /^permissions:\n((?:[ \t]+\S+:[^\n]*\n)+)/m.exec(WORKFLOW);
    expect(block, 'release.yml declares no permissions block').not.toBeNull();
    const granted = (block?.[1] ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    expect(granted).toEqual(['contents: write']);
  });
});

/**
 * The `run:` block of a named step, lifted out of the workflow.
 *
 * Deliberately narrow, and it fails rather than returning something empty: an
 * extractor that quietly found nothing would hand every case below a script
 * that exits 0 and asserts about the shell rather than about this pipeline.
 */
function stepScript(stepName: string): string {
  const lines = WORKFLOW.split('\n');
  const start = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  expect(start, `release.yml has no step named ${stepName}`).toBeGreaterThanOrEqual(0);

  const after = lines.findIndex(
    (line, index) => index > start && /^\s*-\s+(name|uses):/.test(line),
  );
  const step = lines.slice(start, after === -1 ? lines.length : after);

  const runAt = step.findIndex((line) => /^\s*run: \|\s*$/.test(line));
  expect(runAt, `the ${stepName} step has no literal \`run: |\` block`).toBeGreaterThanOrEqual(0);
  const runLine = step[runAt] ?? '';
  const indent = runLine.length - runLine.trimStart().length;

  const body: string[] = [];
  for (const line of step.slice(runAt + 1)) {
    if (line.trim() !== '' && line.length - line.trimStart().length <= indent) break;
    body.push(line.slice(indent + 2));
  }
  const script = body.join('\n');
  expect(script.trim(), `extracted nothing from the ${stepName} step`).not.toBe('');
  return script;
}

const SIGNING_STEP = 'Decode the upload key, if this repository has one';

interface StepRun {
  /** The exit status the runner would see. */
  readonly status: number;
  /** stdout and stderr together, which is what a log line is. */
  readonly log: string;
  /** What the step appended to `$GITHUB_OUTPUT`. */
  readonly output: string;
  /** The decoded keystore, or `null` where the step wrote none. */
  readonly keystore: string | null;
}

/**
 * Run the signing step the way the runner does.
 *
 * `bash --noprofile --norc -eo pipefail` is GitHub's documented default shell
 * for a `run:` step on Linux. Running it under a bare `bash -c` would drop
 * `-e`, which is the difference between a failed decode aborting the step and
 * the step carrying on to report `signed=true`.
 */
function runSigningStep(environment: {
  readonly keystore?: string;
  readonly alias?: string;
  readonly ref: string;
}): StepRun {
  const directory = mkdtempSync(join(tmpdir(), 'oyl-release-'));
  try {
    const script = join(directory, 'step.sh');
    writeFileSync(script, stepScript(SIGNING_STEP));
    const outputFile = join(directory, 'github-output');
    writeFileSync(outputFile, '');

    const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
      encoding: 'utf8',
      env: {
        // Inherited rather than built from nothing, so `base64` is on the PATH.
        // Every variable the step reads is set below it, so nothing a
        // developer happens to export can change what this measures.
        ...process.env,
        KEYSTORE_BASE64: environment.keystore ?? '',
        KEY_ALIAS: environment.alias ?? '',
        REF: environment.ref,
        RUNNER_TEMP: directory,
        GITHUB_OUTPUT: outputFile,
      },
    });

    const keystore = join(directory, 'upload.jks');
    return {
      status: result.status ?? -1,
      log: `${result.stdout}${result.stderr}`,
      output: readFileSync(outputFile, 'utf8'),
      keystore: existsSync(keystore) ? readFileSync(keystore, 'utf8') : null,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Nothing key-shaped: the step decodes whatever it is given. */
const NOT_A_KEYSTORE = 'this is not a keystore';
const NOT_A_KEYSTORE_BASE64 = Buffer.from(NOT_A_KEYSTORE, 'utf8').toString('base64');

describe('the signing inputs', () => {
  /** Every `${{ secrets.X }}` the workflow reads. */
  function referenced(context: 'secrets' | 'vars'): string[] {
    const pattern = new RegExp(`\\$\\{\\{\\s*${context}\\.([A-Z0-9_]+)\\s*\\}\\}`, 'g');
    return [...new Set([...WORKFLOW.matchAll(pattern)].map((match) => match[1] ?? ''))].sort();
  }

  it('reads three secrets, and the key alias is not one of them', () => {
    const secrets = referenced('secrets');
    // A pattern that had stopped matching would pass an equality against the
    // list it also produced, so the count is asserted first.
    expect(secrets.length, 'no `${{ secrets.X }}` reference found in release.yml at all').toBe(3);
    expect(secrets).toEqual([
      'ANDROID_KEYSTORE_BASE64',
      'ANDROID_KEYSTORE_PASSWORD',
      'ANDROID_KEY_PASSWORD',
    ]);
  });

  it('reads the key alias from a repository variable, which Actions does not redact', () => {
    expect(referenced('vars')).toEqual(['ANDROID_KEY_ALIAS']);
    // Read in two places — the guard below and the Gradle invocation — and it
    // is the second that actually signs.
    expect(
      WORKFLOW.includes('ANDROID_KEY_ALIAS: ${{ vars.ANDROID_KEY_ALIAS }}'),
      'the Assemble step no longer passes the alias variable to Gradle',
    ).toBe(true);
  });
});

describe('the signing step, run under the shell the runner uses', () => {
  it('builds unsigned off a tag when the repository holds no keystore', () => {
    const run = runSigningStep({ ref: 'refs/heads/main' });
    expect(run.status, run.log).toBe(0);
    expect(run.output).toContain('signed=false');
    expect(run.keystore).toBeNull();
  });

  it('refuses a tag that has no keystore rather than publishing a debug build', () => {
    const run = runSigningStep({ ref: 'refs/tags/v0.1.0' });
    expect(run.status).toBe(1);
    expect(run.log).toContain('::error::');
    expect(run.output).not.toContain('signed=true');
  });

  it('refuses a keystore with no alias rather than falling through to unsigned', () => {
    const run = runSigningStep({ keystore: NOT_A_KEYSTORE_BASE64, ref: 'refs/heads/main' });
    expect(run.status, 'a keystore with no alias to open it built something anyway').toBe(1);
    expect(run.log).toContain('ANDROID_KEY_ALIAS');
    // The failure that would look like success: `signed=false` is a green
    // build and an unsigned APK.
    expect(run.output).toBe('');
  });

  it('decodes the keystore and reports signed when both are present', () => {
    const run = runSigningStep({
      keystore: NOT_A_KEYSTORE_BASE64,
      alias: 'oyl-upload',
      ref: 'refs/heads/main',
    });
    expect(run.status, run.log).toBe(0);
    expect(run.output).toContain('signed=true');
    expect(run.keystore, 'the step reported signed=true and wrote no keystore').toBe(
      NOT_A_KEYSTORE,
    );
  });
});
