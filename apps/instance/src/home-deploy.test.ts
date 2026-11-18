// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `deploy/home/deploy.sh` under Git Bash (#807's Windows run). Git Bash rewrites
 * every argument that looks like a path before a native program sees it, so
 * the pre-deploy snapshot's `/backups/pre-deploy` reached docker as
 * `C:/Program Files/Git/backups/pre-deploy`, and EVERY update on Windows
 * stopped at "the pre-deploy snapshot failed". The scheduled backup kept
 * working — its paths are inside compose.yaml — so nothing else showed it.
 *
 * The script runs here for real, against stand-ins for `docker` and `git` that
 * record what they were given: MSYSTEM is what Git Bash sets, and
 * MSYS_NO_PATHCONV is what turns its rewriting off.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const DEPLOY = new URL('../deploy/home/deploy.sh', import.meta.url);

function executable(path: string, body: string): void {
  writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(path, 0o755);
}

/** Every `docker` call a deploy over a running instance makes, with the setting it saw. */
function dockerCalls(msystem: string | undefined): string[] {
  const root = mkdtempSync(join(tmpdir(), 'oyl-deploy-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  copyFileSync(DEPLOY, join(root, 'deploy.sh'));
  writeFileSync(join(root, '.env'), '');
  // A deploy before this one, and an instance running: so the snapshot is taken.
  writeFileSync(join(root, '.deployed'), 'image=onyourleft-instance:before\n');
  executable(join(bin, 'git'), 'case "$*" in *--show-toplevel*) pwd ;; *) echo 0123abc ;; esac');
  executable(
    join(bin, 'docker'),
    [
      'printf "%s|%s\\n" "${MSYS_NO_PATHCONV:-}" "$*" >> "${OYL_TEST_LOG}"',
      'case "$*" in',
      '  *" ps -q "*) echo running ;;',
      '  *" run "*) echo \'{"snapshot":"/backups/pre-deploy/snapshot-x"}\' ;;',
      '  *" up "*) exit 1 ;;',
      'esac',
    ].join('\n'),
  );
  const log = join(root, 'docker.log');
  writeFileSync(log, '');
  const setMsystem = msystem === undefined ? 'unset MSYSTEM' : `export MSYSTEM=${msystem}`;
  spawnSync(
    'bash',
    ['-c', `unset MSYS_NO_PATHCONV; ${setMsystem}; PATH="$PWD/bin:$PATH"; . ./deploy.sh`],
    { cwd: root, env: { ...process.env, OYL_TEST_LOG: log }, encoding: 'utf8', timeout: 30_000 },
  );
  return readFileSync(log, 'utf8').split('\n').filter(Boolean);
}

describe('deploy/home/deploy.sh — container paths under Git Bash (#807)', () => {
  it('turns Git Bash’s path rewriting off for the pre-deploy snapshot', () => {
    const snapshot = dockerCalls('MINGW64').find((call) => call.includes('/backups/pre-deploy'));
    expect(snapshot).toBeDefined();
    expect(snapshot?.split('|')[0]).toBe('1');
  });

  it('leaves the environment alone everywhere else', () => {
    const calls = dockerCalls(undefined);
    expect(calls.some((call) => call.includes('/backups/pre-deploy'))).toBe(true);
    for (const call of calls) expect(call.split('|')[0]).toBe('');
  });
});

/**
 * The pull path (#2786): a release bundle holds `deploy.sh`, `compose.yaml` and
 * `release.image`, which names the published image by digest, and no git
 * checkout. The deploy pulls that image instead of building one, and keeps
 * everything else — the snapshot first, the migrate step, the ready wait, and
 * the rollback when the new image never becomes ready.
 *
 * The stand-in `docker` keeps what a real one would: which images this machine
 * holds, and which image the running instance is. An image named in
 * `broken` starts and never becomes ready, which is the failing deploy.
 */
const PREVIOUS = `ghcr.io/openzigs/onyourleft-instance@sha256:${'a'.repeat(64)}`;
const NEXT = `ghcr.io/openzigs/onyourleft-instance@sha256:${'b'.repeat(64)}`;

interface Bundle {
  readonly root: string;
  readonly fake: string;
}

function bundle(options: {
  readonly releaseImage?: string;
  readonly deployed?: string;
  readonly running?: string;
  readonly held?: readonly string[];
  readonly broken?: readonly string[];
}): Bundle {
  const root = mkdtempSync(join(tmpdir(), 'oyl-bundle-'));
  const bin = join(root, 'bin');
  const fake = join(root, 'fake');
  mkdirSync(bin);
  mkdirSync(fake);
  copyFileSync(DEPLOY, join(root, 'deploy.sh'));
  writeFileSync(join(root, '.env'), '');
  if (options.releaseImage !== undefined) {
    writeFileSync(join(root, 'release.image'), `${options.releaseImage}\n`);
  }
  if (options.deployed !== undefined) {
    writeFileSync(join(root, '.deployed'), `image=${options.deployed}\nprevious=\nsnapshot=\n`);
  }
  if (options.running !== undefined) writeFileSync(join(fake, 'running'), options.running);
  const lines = (images: readonly string[] | undefined): string =>
    (images ?? []).map((image) => `${image}\n`).join('');
  writeFileSync(join(fake, 'held'), lines(options.held));
  writeFileSync(join(fake, 'broken'), lines(options.broken));
  writeFileSync(join(fake, 'missing'), '');
  writeFileSync(join(fake, 'calls'), '');
  // A bundle is not a checkout: git is not needed, and asking it is a finding.
  executable(join(bin, 'git'), 'echo "git $*" >> "${OYL_FAKE}/calls"; exit 128');
  executable(join(bin, 'sleep'), 'exit 0');
  executable(
    join(bin, 'docker'),
    [
      'fake="${OYL_FAKE}"',
      'printf "docker %s|%s\\n" "$*" "${OYL_INSTANCE_IMAGE:-}" >> "${fake}/calls"',
      'is() { grep -qxF -- "$1" "${fake}/$2"; }',
      'case "$1" in',
      '  image) is "${@: -1}" held ;;',
      '  pull) is "${@: -1}" missing && exit 1; printf "%s\\n" "${@: -1}" >> "${fake}/held" ;;',
      '  build) exit 1 ;;',
      '  tag) exit 0 ;;',
      '  compose)',
      '    case "$*" in',
      '      *" ps -q "*) [ -f "${fake}/running" ] && echo container ;;',
      '      *" up "*" instance"*)',
      '        printf "%s" "${OYL_INSTANCE_IMAGE}" > "${fake}/running"',
      '        is "${OYL_INSTANCE_IMAGE}" broken && exit 1; exit 0 ;;',
      '      *" up "*) exit 0 ;;',
      '      *" exec "*) ! is "$(cat "${fake}/running")" broken ;;',
      '      *" stop "*) rm -f "${fake}/running" ;;',
      '      *" run "*" backup "*) echo \'{"snapshot":"/backups/pre-deploy/snapshot-1"}\' ;;',
      '      *" run "*) exit 0 ;;',
      '    esac ;;',
      '  *) exit 99 ;;',
      'esac',
    ].join('\n'),
  );
  return { root, fake };
}

function deploy(where: Bundle, ...args: string[]): { status: number | null; output: string } {
  // The stand-ins go first on PATH from inside bash, as `dockerCalls` above does.
  const script = 'PATH="$1:$PATH"; shift; exec bash "$@"';
  const deployScript = join(where.root, 'deploy.sh');
  const run = spawnSync(
    'bash',
    ['-c', script, '_', join(where.root, 'bin'), deployScript, ...args],
    {
      cwd: tmpdir(),
      env: { ...process.env, OYL_FAKE: where.fake, MSYSTEM: '' },
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

const read = (path: string): string => readFileSync(path, 'utf8');
const deployedImage = (where: Bundle): string | undefined =>
  /^image=(.*)$/m.exec(read(join(where.root, '.deployed')))?.[1];
const calls = (where: Bundle): string[] => read(join(where.fake, 'calls')).split('\n');
const running = (where: Bundle): string => read(join(where.fake, 'running'));

describe('deploy/home/deploy.sh — from a release bundle, with no checkout (#2786)', () => {
  it('pulls the image release.image names, builds nothing, asks no git, and records it deployed', () => {
    const where = bundle({ releaseImage: NEXT });
    const { status, output } = deploy(where);
    expect(output).toContain(`${NEXT} is ready`);
    expect(status).toBe(0);
    expect(calls(where)).toContain(`docker pull --quiet ${NEXT}|`);
    expect(calls(where).some((call) => call.startsWith('docker build'))).toBe(false);
    expect(calls(where).some((call) => call.startsWith('git'))).toBe(false);
    expect(running(where)).toBe(NEXT);
    expect(deployedImage(where)).toBe(NEXT);
  });

  it('does not pull an image this machine already holds', () => {
    const where = bundle({ releaseImage: NEXT, held: [NEXT] });
    expect(deploy(where).status).toBe(0);
    expect(calls(where).some((call) => call.startsWith('docker pull'))).toBe(false);
    expect(running(where)).toBe(NEXT);
  });

  it('starts the instance through compose, whose migrate step it waits on, with the pulled image', () => {
    const where = bundle({ releaseImage: NEXT });
    deploy(where);
    expect(calls(where)).toContain(
      `docker compose --project-directory ${where.root} -f ${where.root}/compose.yaml up -d --wait --wait-timeout 120 instance|${NEXT}`,
    );
  });

  it('forced not ready: snapshots first, rolls back, and the PREVIOUS digest is the one running afterwards', () => {
    const where = bundle({
      releaseImage: NEXT,
      deployed: PREVIOUS,
      running: PREVIOUS,
      held: [PREVIOUS],
      broken: [NEXT],
    });
    const { status, output } = deploy(where);
    expect(status).toBe(1);
    expect(output).toContain(`${NEXT} did not become ready`);
    expect(output).toContain(`rolled back to ${PREVIOUS}`);
    expect(running(where)).toBe(PREVIOUS);
    expect(deployedImage(where)).toBe(PREVIOUS);
    const order = calls(where);
    const snapshot = order.findIndex((call) => call.includes('backup /backups/pre-deploy'));
    const failed = order.findIndex((call) => call.includes(' up -d --wait') && call.endsWith(NEXT));
    const restore = order.findIndex((call) =>
      call.includes('restore /backups/pre-deploy/snapshot-1'),
    );
    expect(snapshot).toBeGreaterThanOrEqual(0);
    expect(snapshot).toBeLessThan(failed);
    expect(failed).toBeLessThan(restore);
  });

  it('--image deploys the image it names, over the one release.image names', () => {
    const where = bundle({ releaseImage: NEXT, held: [PREVIOUS] });
    expect(deploy(where, '--image', PREVIOUS).status).toBe(0);
    expect(running(where)).toBe(PREVIOUS);
    expect(deployedImage(where)).toBe(PREVIOUS);
  });

  it('refuses, and changes nothing, when the image cannot be pulled', () => {
    const where = bundle({ releaseImage: NEXT, deployed: PREVIOUS, running: PREVIOUS });
    writeFileSync(join(where.fake, 'missing'), `${NEXT}\n`);
    const { status, output } = deploy(where);
    expect(status).toBe(1);
    expect(output).toContain(`${NEXT} could not be pulled`);
    expect(running(where)).toBe(PREVIOUS);
    expect(deployedImage(where)).toBe(PREVIOUS);
  });

  it('says what to do, outside a checkout with no release.image beside it', () => {
    const where = bundle({});
    const { status, output } = deploy(where);
    expect(status).toBe(1);
    expect(output).toContain('there is no release.image beside it');
    expect(calls(where).some((call) => call.startsWith('docker build'))).toBe(false);
  });
});
