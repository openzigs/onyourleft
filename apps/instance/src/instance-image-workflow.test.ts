// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `.github/workflows/instance-image.yml`, the published image's workflow
 * (#2786), held to the rules that are easy to break in a one-word diff and
 * that nothing else in CI reads: a standard runner only (CLAUDE.md §8, a
 * larger runner is billed), every third-party action pinned to a commit, the
 * build tooling's own images pinned by digest, no checkout in the job that
 * proves the bundle needs none, and the verify command the guide gives an
 * operator the same command the workflow runs against the pushed digest.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const WORKFLOW = readFileSync(
  new URL('../../../.github/workflows/instance-image.yml', import.meta.url),
  'utf8',
);
const GUIDE = readFileSync(
  new URL('../../../docs/self-hosting/home-machine.md', import.meta.url),
  'utf8',
);

/** The text of one job: from its key to the next job's key. */
function job(name: string): string {
  const start = WORKFLOW.indexOf(`\n  ${name}:\n`);
  if (start < 0) throw new Error(`no job ${name}`);
  const rest = WORKFLOW.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z-]+:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

const ISSUER = '--certificate-oidc-issuer https://token.actions.githubusercontent.com';
const IDENTITY =
  '^https://github\\.com/openzigs/onyourleft/\\.github/workflows/instance-image\\.yml@';

describe('instance-image.yml — what CLAUDE.md §8 asks of every workflow', () => {
  it('runs every job on ubuntu-latest and nothing else', () => {
    const runners = [...WORKFLOW.matchAll(/^\s*runs-on:\s*(.+)$/gm)].map((match) => match[1]);
    expect(runners.length).toBeGreaterThanOrEqual(3);
    for (const runner of runners) expect(runner?.trim()).toBe('ubuntu-latest');
  });

  it('pins every action to a full commit SHA', () => {
    const uses = [...WORKFLOW.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) expect(action).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
  });

  it('pins the emulator and the builder it runs by digest', () => {
    expect(WORKFLOW).toMatch(/image: docker\.io\/tonistiigi\/binfmt:[\w.-]+@sha256:[0-9a-f]{64}\n/);
    expect(WORKFLOW).toMatch(/driver-opts: image=moby\/buildkit:[\w.-]+@sha256:[0-9a-f]{64}\n/);
  });

  it('has no pull_request_target (WF001)', () => {
    expect(WORKFLOW).not.toMatch(/pull_request_target/);
  });

  it('builds both platforms', () => {
    expect(job('publish')).toContain('--platform linux/amd64,linux/arm64');
  });
});

describe('instance-image.yml — the bundle needs no checkout (#2786)', () => {
  it('the pull-only job checks nothing out, and fails if anything did', () => {
    const pullOnly = job('pull-only');
    expect(pullOnly).not.toMatch(/uses:\s*actions\/checkout@/);
    expect(pullOnly).toContain('The workspace is not empty');
    expect(pullOnly).toContain('bash deploy.sh --image onyourleft-instance:never-ready');
  });

  it('promotes a version only after the pull-only job passed, and only on a tag', () => {
    const promote = job('promote');
    expect(promote).toMatch(/needs: \[publish, pull-only\]/);
    expect(promote).toContain("if: startsWith(github.ref, 'refs/tags/v')");
    expect(promote).toContain('--preserve-digests');
  });
});

describe('the verify command the guide gives is the one the workflow runs', () => {
  const guideCommand =
    /cosign verify ghcr\.io\/openzigs\/onyourleft-instance@sha256:\S+ \\\n\s+(.+) \\\n\s+(.+)\n/.exec(
      GUIDE,
    );

  it('the guide has one, with the issuer and the release identity', () => {
    expect(guideCommand).not.toBeNull();
    expect(guideCommand?.[1]).toBe(ISSUER);
    expect(guideCommand?.[2]).toBe(`--certificate-identity-regexp '${IDENTITY}refs/tags/v'`);
  });

  it('the workflow runs it on the pushed digest, with the same issuer and identity', () => {
    const publish = job('publish');
    expect(publish).toContain('cosign verify "${IMAGE}@${DIGEST}"');
    expect(publish).toContain(ISSUER);
    expect(publish).toContain(`--certificate-identity-regexp "${IDENTITY}\${ref}"`);
    // On a release tag the identity is the guide's, character for character.
    expect(publish).toContain("refs/tags/v*) ref='refs/tags/v' ;;");
    expect(publish.indexOf('cosign sign --yes')).toBeLessThan(publish.indexOf('cosign verify'));
  });
});
