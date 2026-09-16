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
 *
 * ⚠️ **What this file deliberately does NOT claim.** It reads the workflow as
 * text. It says nothing about whether the pipeline works — that is settled by
 * running it, and `apps/mobile/RELEASE.md` §1 is where the result of doing so
 * is recorded rather than here.
 */

import { readFileSync } from 'node:fs';
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
