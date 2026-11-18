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

interface Deployed {
  readonly status: number | null;
  readonly out: string;
  /** Every `docker` call, as `<the profiles compose saw>|<its arguments>`. */
  readonly calls: readonly string[];
}

/**
 * A fresh deploy (no instance running before it) against a `docker` stand-in
 * that answers what compose would (#2805): `config --services` with the
 * services `.env`'s profiles turn on, Tailscale's status, and the origin the
 * running instance holds.
 */
function deployWith(options: {
  readonly env: string;
  /** What `docker compose config --services` lists: compose reads the profiles, not this script. */
  readonly services: (profiles: string) => readonly string[];
  readonly tailscaleStatus?: string;
  readonly runningOrigin?: string;
}): Deployed {
  const root = mkdtempSync(join(tmpdir(), 'oyl-deploy-remote-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  copyFileSync(DEPLOY, join(root, 'deploy.sh'));
  writeFileSync(join(root, '.env'), options.env);
  executable(join(bin, 'git'), 'case "$*" in *--show-toplevel*) pwd ;; *) echo 0123abc ;; esac');
  const answers = join(root, 'answers');
  mkdirSync(answers);
  // The profiles compose would see: this shell's COMPOSE_PROFILES, else .env's.
  for (const profiles of [
    '',
    'cloudflare',
    'tailscale',
    'cloudflare,tailscale',
    'history',
    'history,cloudflare',
  ]) {
    writeFileSync(join(answers, `services-${profiles}`), options.services(profiles).join('\n'));
  }
  writeFileSync(join(answers, 'status'), options.tailscaleStatus ?? '');
  writeFileSync(join(answers, 'origin'), options.runningOrigin ?? '');
  executable(
    join(bin, 'docker'),
    [
      'profiles="${COMPOSE_PROFILES-$(sed -n "s/^COMPOSE_PROFILES=//p" .env | tail -n 1 | tr -d "\\r")}"',
      'printf "%s|%s\\n" "${profiles}" "$*" >> "${OYL_TEST_LOG}"',
      'case "$*" in',
      `  *" config --services"*) cat "${answers}/services-\${profiles}" ;;`,
      `  *" exec -T tailscale "*) cat "${answers}/status" ;;`,
      `  *" exec -T instance node -e process.stdout.write"*) cat "${answers}/origin" ;;`,
      'esac',
      'exit 0',
    ].join('\n'),
  );
  const log = join(root, 'docker.log');
  writeFileSync(log, '');
  const ran = spawnSync(
    'bash',
    ['-c', 'unset MSYSTEM COMPOSE_PROFILES; PATH="$PWD/bin:$PATH"; . ./deploy.sh'],
    {
      cwd: root,
      env: { ...process.env, OYL_TEST_LOG: log, OYL_DEPLOY_READY_SECONDS: '4' },
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
  return {
    status: ran.status,
    out: `${ran.stdout}${ran.stderr}`,
    calls: readFileSync(log, 'utf8').split('\n').filter(Boolean),
  };
}

/** Each `up -d` after the instance's own: the profiles compose saw, and the services named. */
const ups = (deployed: Deployed): string[] =>
  deployed.calls
    .filter((call) => / up -d (?!--wait)/.test(call))
    .map((call) => call.replace(/\|.* up -d /, ': '));
const built = (deployed: Deployed): boolean =>
  deployed.calls.some((call) => call.includes('|build '));

/** What each profile turns on, as compose.yaml says. */
const PROFILE_SERVICES = (profiles: string): string[] => [
  'migrate',
  'instance',
  'backup',
  ...(profiles.split(',').includes('cloudflare') ? ['tunnel'] : []),
  ...(profiles.split(',').includes('tailscale') ? ['tailscale'] : []),
  ...(profiles.split(',').includes('history') ? ['ollama'] : []),
];

const RUNNING = (name: string): string =>
  `{\n  "Version": "1.104.7",\n  "BackendState": "Running",\n  "Self": {\n    "HostName": "onyourleft",\n    "DNSName": "${name}",\n    "OS": "linux"\n  }\n}\n`;

describe('deploy/home/deploy.sh — the remote path (#2805, ADR 0079)', () => {
  it('starts the tunnel with the cloudflare profile, as it always did', () => {
    const deployed = deployWith({
      env: 'COMPOSE_PROFILES=cloudflare\nCLOUDFLARE_TUNNEL_TOKEN=token\n',
      services: PROFILE_SERVICES,
    });
    expect(deployed.status, deployed.out).toBe(0);
    expect(ups(deployed)).toEqual(['cloudflare: tunnel backup']);
  });

  it('keeps the tunnel of a .env from before the profile, with whatever profiles it had, and says to name it', () => {
    const deployed = deployWith({
      env: 'COMPOSE_PROFILES=history\nCLOUDFLARE_TUNNEL_TOKEN=token\r\n',
      services: PROFILE_SERVICES,
    });
    expect(deployed.status, deployed.out).toBe(0);
    // Its own profiles kept beside the tunnel's: `--profile` would have replaced them.
    expect(ups(deployed)).toEqual(['history,cloudflare: tunnel backup']);
    expect(deployed.out).toContain('Add cloudflare to COMPOSE_PROFILES in .env');
  });

  it('starts no remote path with neither profile and no token, and says the instance is this machine’s only', () => {
    const deployed = deployWith({ env: '', services: PROFILE_SERVICES });
    expect(deployed.status, deployed.out).toBe(0);
    expect(ups(deployed)).toEqual([': backup']);
    expect(deployed.out).toContain('reachable on this machine only');
  });

  it.each([
    [
      'both profiles',
      'COMPOSE_PROFILES=cloudflare,tailscale\nCLOUDFLARE_TUNNEL_TOKEN=t\nOYL_INSTANCE_REMOTE_PATH=tailnet\n',
      'an instance has one origin',
    ],
    [
      'the cloudflare profile with no token',
      'COMPOSE_PROFILES=cloudflare\n',
      'needs CLOUDFLARE_TUNNEL_TOKEN',
    ],
    [
      'the cloudflare profile with the tailnet path',
      'COMPOSE_PROFILES=cloudflare\nCLOUDFLARE_TUNNEL_TOKEN=t\nOYL_INSTANCE_REMOTE_PATH=tailnet\n',
      'needs OYL_INSTANCE_REMOTE_PATH=cloudflare',
    ],
    [
      'the tailscale profile with no path',
      'COMPOSE_PROFILES=tailscale\n',
      'needs OYL_INSTANCE_REMOTE_PATH=tailnet',
    ],
    [
      'the tailscale profile with the cloudflare path',
      'COMPOSE_PROFILES=tailscale\nOYL_INSTANCE_REMOTE_PATH=cloudflare\n',
      'needs OYL_INSTANCE_REMOTE_PATH=tailnet',
    ],
  ])('refuses %s before it builds anything', (_, env, says) => {
    const deployed = deployWith({ env, services: PROFILE_SERVICES });
    expect(deployed.status).toBe(1);
    expect(deployed.out).toContain(says);
    expect(built(deployed)).toBe(false);
  });

  it('on the tailnet: starts tailscale, and reads back from the running instance the origin serve answers on', () => {
    const deployed = deployWith({
      // As Notepad saves it: CRLF, and the value quoted.
      env: 'COMPOSE_PROFILES=tailscale\r\nOYL_INSTANCE_REMOTE_PATH="tailnet"\r\n',
      services: PROFILE_SERVICES,
      tailscaleStatus: RUNNING('onyourleft.example-tailnet.ts.net.'),
      runningOrigin: 'https://onyourleft.example-tailnet.ts.net',
    });
    expect(deployed.status, deployed.out).toBe(0);
    expect(ups(deployed)).toEqual(['tailscale: tailscale backup']);
    expect(deployed.out).toContain(
      'reached on your tailnet at https://onyourleft.example-tailnet.ts.net',
    );
  });

  it('fails, naming both, when the running instance’s origin is not the name serve answers on', () => {
    // Tailscale named the machine onyourleft-1: another machine already had the name.
    const deployed = deployWith({
      env: 'COMPOSE_PROFILES=tailscale\nOYL_INSTANCE_REMOTE_PATH=funnel\n',
      services: PROFILE_SERVICES,
      tailscaleStatus: RUNNING('onyourleft-1.example-tailnet.ts.net.'),
      runningOrigin: 'https://onyourleft.example-tailnet.ts.net',
    });
    expect(deployed.status).toBe(1);
    expect(deployed.out).toContain(
      "the instance's origin is https://onyourleft.example-tailnet.ts.net, and tailscale serve answers on https://onyourleft-1.example-tailnet.ts.net",
    );
  });

  it('prints Tailscale’s sign-in link once while it waits, and fails if it is never signed in', () => {
    const deployed = deployWith({
      env: 'COMPOSE_PROFILES=tailscale\nOYL_INSTANCE_REMOTE_PATH=tailnet\n',
      services: PROFILE_SERVICES,
      tailscaleStatus:
        '{\n  "BackendState": "NeedsLogin",\n  "AuthURL": "https://login.tailscale.com/a/example",\n  "Self": {\n    "DNSName": ""\n  }\n}\n',
      runningOrigin: 'https://onyourleft.example-tailnet.ts.net',
    });
    expect(deployed.status).toBe(1);
    const links = deployed.out
      .split('\n')
      .filter((line) => line.startsWith('deploy: sign this machine in'));
    expect(links).toEqual([
      'deploy: sign this machine in to your tailnet: open https://login.tailscale.com/a/example',
    ]);
    expect(deployed.out).toContain('Tailscale did not sign in');
  });
});
