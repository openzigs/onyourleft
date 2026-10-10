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
