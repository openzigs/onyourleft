// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The home deployment's client-address settings (#903 item 4): the header is
 * believed only from a trusted proxy, so `compose.yaml` must name EXACTLY the
 * address it gives `cloudflared`, inside the subnet it declares. A compose file
 * that set the header and trusted nobody would count every rider as the
 * tunnel — one rate-limit bucket for everybody — with every other test green.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { clientAddress } from './client-address.ts';
import { readAnalysisModelSettings, readConfig, readHistorySettings } from './config.ts';
import { readServerConfig } from './server-config.ts';

const COMPOSE = readFileSync(new URL('../deploy/home/compose.yaml', import.meta.url), 'utf8');

/** The one value a `KEY: value` line in the file sets, or `undefined`. */
function setting(key: string): string | undefined {
  return new RegExp(`^\\s*${key}:\\s*(\\S+)\\s*$`, 'm').exec(COMPOSE)?.[1];
}

describe('deploy/home/compose.yaml — registration (#775)', () => {
  it('registers by approval when .env leaves it empty, as the instance itself does', () => {
    expect(setting('OYL_INSTANCE_REGISTRATION')).toBe('${OYL_INSTANCE_REGISTRATION:-approval}');
    const example = readFileSync(
      new URL('../deploy/home/instance.env.example', import.meta.url),
      'utf8',
    );
    expect(example).toMatch(/^OYL_INSTANCE_REGISTRATION=approval$/m);
    const configured = readConfig({ commit: 'a'.repeat(40), registration: 'approval' });
    expect(configured.ok && configured.config.registration).toBe('approval');
  });
});

describe('deploy/home/compose.yaml — the rider’s address behind the tunnel', () => {
  const header = setting('OYL_INSTANCE_CLIENT_ADDRESS_HEADER');
  const trusted = setting('OYL_INSTANCE_TRUSTED_PROXIES');
  /** Every fixed address the tunnel has, one per network it is on. */
  const tunnelAddresses = [...service('tunnel').matchAll(/ipv4_address: (\S+)/g)].map(
    (match) => match[1] ?? '',
  );
  const subnets = [...COMPOSE.matchAll(/- subnet: (\S+)/g)].map((match) => match[1] ?? '');

  it('names the header, and trusts exactly the addresses it gives cloudflared, each in a subnet the file declares', () => {
    expect(header).toBe('cf-connecting-ip');
    // #2604: two networks, two addresses — Docker may answer `instance` with either.
    expect(tunnelAddresses).toHaveLength(2);
    expect(trusted?.split(',')).toEqual(tunnelAddresses);
    for (const address of tunnelAddresses) {
      expect(address).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
      const prefix = address.split('.').slice(0, 3).join('.');
      expect(subnets.map((subnet) => subnet.split('.').slice(0, 3).join('.'))).toContain(prefix);
    }
  });

  it('is a configuration the instance accepts, under which the tunnel’s header is believed and nobody else’s is', () => {
    const read = readConfig({
      commit: '0'.repeat(40),
      clientAddressHeader: header,
      trustedProxies: trusted,
    });
    if (!read.ok) throw new Error(read.problems.join(' '));
    const { clientAddressHeader, trustedProxies } = read.config;
    const sent = new Headers({ 'cf-connecting-ip': '203.0.113.9' });
    for (const address of tunnelAddresses) {
      expect(clientAddress(address, sent, clientAddressHeader, trustedProxies)).toBe('203.0.113.9');
      // Another container on the same network is counted as itself.
      const neighbour = address.replace(/\.\d+$/, '.3');
      expect(clientAddress(neighbour, sent, clientAddressHeader, trustedProxies)).toBe(neighbour);
    }
  });
});

/** One service's block of the file: from its name to the next line at the same indent. */
function service(name: string): string {
  const start = COMPOSE.search(new RegExp(`^  ${name}:\\s*$`, 'm'));
  if (start < 0) return '';
  const rest = COMPOSE.slice(start + 1);
  const end = rest.search(/^ {2}[a-z#]|^[a-z]/m);
  return end < 0 ? rest : rest.slice(0, end);
}

describe('deploy/home/compose.yaml — the embedding model (#835, ADR 0040 D-6)', () => {
  const ollama = service('ollama');

  it('runs Ollama only with the history or the analysis profile, pinned by digest', () => {
    expect(ollama).toMatch(/profiles: \['history', 'analysis'\]/);
    expect(ollama).toMatch(/image: ollama\/ollama:[0-9.]+@sha256:[0-9a-f]{64}/);
  });

  it('publishes no port for it, and exposes none: its API has no authentication', () => {
    expect(ollama).not.toBe('');
    // Every uncommented line of the service, so a comment naming ports is not a finding.
    const lines = ollama.split('\n').filter((line) => !/^\s*#/.test(line));
    expect(lines.join('\n')).not.toMatch(/^\s*(ports|expose|network_mode):/m);
    // And no service in the file publishes one but the instance, once: the
    // admin pages' loopback listener (#2643), the debugging line aside.
    const published = COMPOSE.split('\n').filter((line) => /^\s*ports:/.test(line));
    expect(published).toStrictEqual(['    ports:']);
    expect(service('instance')).toContain('\n    ports:\n');
  });

  it('is reached by a service name the instance accepts as local', () => {
    const settings = readHistorySettings({ embeddingUrl: 'http://ollama:11434' });
    expect(settings.kind).toBe('on');
    expect(COMPOSE).toMatch(/OYL_INSTANCE_EMBEDDING_URL: \$\{OYL_INSTANCE_EMBEDDING_URL:-\}/);
  });

  it('names no embedding model under a non-OSI licence (ADR 0040 D-5)', () => {
    const env = readFileSync(
      new URL('../deploy/home/instance.env.example', import.meta.url),
      'utf8',
    );
    for (const text of [COMPOSE, env]) expect(text).not.toMatch(/gemma/i);
  });
});

describe('deploy/home/compose.yaml — the analysis model (#1096, ADR 0046 D-9)', () => {
  it('is reached by a service name the instance accepts as local, at its OpenAI-compatible path', () => {
    const settings = readAnalysisModelSettings({
      analysisModelUrl: 'http://ollama:11434/v1',
      analysisModel: 'any',
    });
    expect(settings.kind).toBe('on');
    expect(COMPOSE).toMatch(
      /OYL_INSTANCE_ANALYSIS_MODEL_URL: \$\{OYL_INSTANCE_ANALYSIS_MODEL_URL:-\}/,
    );
  });

  it('names no model: the setting defaults to nothing, in the file and its template (ADR 0031 D-4)', () => {
    expect(COMPOSE).toMatch(/OYL_INSTANCE_ANALYSIS_MODEL: \$\{OYL_INSTANCE_ANALYSIS_MODEL:-\}$/m);
    const env = readFileSync(
      new URL('../deploy/home/instance.env.example', import.meta.url),
      'utf8',
    );
    expect(env).toMatch(/^OYL_INSTANCE_ANALYSIS_MODEL=$/m);
  });

  it('passes the picture model through, and names none (#1106)', () => {
    expect(COMPOSE).toMatch(/OYL_INSTANCE_PICTURE_MODEL: \$\{OYL_INSTANCE_PICTURE_MODEL:-\}$/m);
    const env = readFileSync(
      new URL('../deploy/home/instance.env.example', import.meta.url),
      'utf8',
    );
    expect(env).toMatch(/^OYL_INSTANCE_PICTURE_MODEL=$/m);
  });
});

/**
 * #807's Windows run: `OYL_INSTANCE_PING_INTERVAL_MS=0` in `.env`, as the guide's
 * idle probe says, reached nothing — compose never passed it on, and the probe
 * measured a socket the instance was still pinging. The list is DERIVED from
 * what `serve.ts` reads, so a setting added there and forgotten here is red.
 */
describe('deploy/home/compose.yaml — every setting the server reads reaches it (#807)', () => {
  const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
  const serverReads = new Set(
    [...read('./serve.ts').matchAll(/process\.env\.(OYL_INSTANCE_[A-Z_]+)/g)].map((m) => m[1]),
  );
  // The image sets these itself (its `ENV`): where the data is, and the commit it was built from.
  const imageSets = new Set(
    [...read('../Dockerfile').matchAll(/\b(OYL_INSTANCE_[A-Z_]+)=/g)].map((m) => m[1]),
  );
  // `\r?`: a Windows checkout (core.autocrlf) reads this file with CRLF.
  const instance = /^ {2}instance:\r?\n([\s\S]*?)^ {2}\w/m.exec(COMPOSE)?.[1] ?? '';

  it('reads the lists it compares from the files themselves', () => {
    expect(serverReads.size).toBeGreaterThan(10);
    expect(imageSets).toContain('OYL_INSTANCE_DATABASE');
    expect(instance).toContain('environment:');
  });

  it.each([...serverReads].filter((name) => name !== undefined && !imageSets.has(name)))(
    'passes %s from .env to the instance',
    (name) => {
      expect(instance).toMatch(new RegExp(`^ {6}${name}: `, 'm'));
    },
  );
});

describe('deploy/home/compose.yaml — the tunnel’s readiness (#2604)', () => {
  const tunnel = service('tunnel');
  const env = readFileSync(new URL('../deploy/home/instance.env.example', import.meta.url), 'utf8');
  /** The top-level `networks:` block. */
  const networks = /^networks:\n([\s\S]*?)(?=^\S)/m.exec(COMPOSE)?.[1] ?? '';
  /**
   * Every service a compose file declares, read from it, so a new one is held
   * too. The block ends at the next top-level key, not at any column-0 line,
   * so a `# comment` at column 0 inside it does not cut it short.
   */
  const serviceNames = (text: string): string[] => {
    const services = /^services:\n([\s\S]*?)(?=^[a-z])/m.exec(text)?.[1] ?? '';
    return [...services.matchAll(/^ {2}([a-z][a-z0-9_-]*):\s*$/gm)].map((match) => match[1] ?? '');
  };
  const SERVICES = serviceNames(COMPOSE);

  it('reads every service even past a column-0 comment inside `services:`', () => {
    const commented = COMPOSE.replace(/^ {2}tunnel:$/m, '# a column-0 comment\n  tunnel:');
    expect(commented).not.toBe(COMPOSE);
    expect(serviceNames(commented)).toEqual(SERVICES);
  });

  it('binds cloudflared’s metrics to its address on an internal network only it and the instance join', () => {
    const bound = /'--metrics', '(\d+\.\d+\.\d+\.\d+):(\d+)'/.exec(tunnel);
    expect(bound).not.toBeNull();
    const [, address = '', port = ''] = bound ?? [];
    // Not 0.0.0.0, which is every network the tunnel is on.
    expect(address).not.toBe('0.0.0.0');
    expect(tunnel).toMatch(
      new RegExp(`tunnel_metrics:\\s*\\n\\s*ipv4_address: ${address.replaceAll('.', '\\.')}`),
    );
    // Internal: no route out of it, and a subnet the address is in.
    const metrics =
      /^ {2}tunnel_metrics:\n([\s\S]*?)(?=^ {2}\S|$(?![\s\S]))/m.exec(networks)?.[1] ?? '';
    expect(metrics).toMatch(/^\s*internal: true$/m);
    const subnet = /subnet: (\d+\.\d+\.\d+)\.0\/24/.exec(metrics)?.[1];
    expect(address.split('.').slice(0, 3).join('.')).toBe(subnet);
    // Exactly the instance and the tunnel are on it, of every service in the file.
    expect(SERVICES).toEqual(
      expect.arrayContaining(['migrate', 'instance', 'tunnel', 'ollama', 'backup']),
    );
    expect(SERVICES.filter((name) => service(name).includes('tunnel_metrics'))).toEqual([
      'instance',
      'tunnel',
    ]);
    // No port for it, and the template asks that address, which the instance accepts.
    const lines = tunnel.split('\n').filter((line) => !/^\s*#/.test(line));
    expect(lines.join('\n')).not.toMatch(/^\s*(ports|expose|network_mode):/m);
    const url = /^OYL_INSTANCE_TUNNEL_READY_URL=(\S+)$/m.exec(env)?.[1];
    expect(url).toBe(`http://${address}:${port}/ready`);
    const read = readServerConfig({ tunnelReadyUrl: url }, 1);
    expect(read.ok && read.config.tunnelReadyUrl?.hostname).toBe(address);
    expect(COMPOSE).toMatch(/OYL_INSTANCE_TUNNEL_READY_URL: \$\{OYL_INSTANCE_TUNNEL_READY_URL:-\}/);
  });
});

/**
 * The longest the backup service's shell may run in a test (#1688): the
 * child's own limit, as `commands.test.ts`'s `CHILD_WAIT_MS` is, not a test
 * case's. Vitest cannot interrupt a synchronous child, so this is what stops
 * a shell that loops; it runs in a few milliseconds.
 */
const SHELL_WAIT_MS = 4_000;

describe('deploy/home/compose.yaml — the backup service (#2606)', () => {
  const backup = service('backup');

  /** The service's shell command as `sh` receives it: the folded lines, `$$` as `$`. */
  function script(): string {
    const block = /command:\n\s+- >-\n([\s\S]*?)\n\s{4}environment:/.exec(backup)?.[1] ?? '';
    return block
      .split('\n')
      .map((line) => line.trim())
      .join(' ')
      .replaceAll('$$', '$');
  }

  /**
   * Runs the command in a stand-in image whose `run.ts` is `runTs`, with a
   * `node` that writes its arguments and a `sleep` that ends the shell, so
   * the old shell loop runs once. Answers each `node` call's arguments.
   */
  function runIn(runTs: string, status?: { code: number | null }): string[] {
    const image = mkdtempSync(join(tmpdir(), 'oyl-backup-service-'));
    try {
      mkdirSync(join(image, 'src', 'operator'), { recursive: true });
      writeFileSync(join(image, 'src', 'operator', 'run.ts'), runTs);
      const bin = join(image, 'bin');
      mkdirSync(bin);
      writeFileSync(join(bin, 'node'), `#!/bin/sh\necho "$*" >> "${image}/calls"\n`, {
        mode: 0o755,
      });
      writeFileSync(join(bin, 'sleep'), '#!/bin/sh\nkill -TERM $PPID\n', { mode: 0o755 });
      const ran = spawnSync('/bin/sh', ['-c', script()], {
        cwd: image,
        env: {
          PATH: `${bin}:/usr/bin:/bin`,
          OYL_BACKUP_KEEP: '14',
          OYL_BACKUP_INTERVAL_SECONDS: '21600',
        },
        timeout: SHELL_WAIT_MS,
      });
      if (status !== undefined) status.code = ran.status;
      return readFileSync(join(image, 'calls'), 'utf8').trim().split('\n');
    } finally {
      rmSync(image, { recursive: true, force: true });
    }
  }

  it('runs backup-loop with today’s keep, off-box copy and interval, on an image that has it', () => {
    expect(runIn("      case 'backup-loop': {\n")).toEqual([
      'src/operator/cli.ts backup-loop /backups --keep 14 --copy-to /offbox --interval 21600',
    ]);
  });

  it('runs the shell loop it always ran on an image from before #2606, which a rollback starts — and stops it on SIGTERM', () => {
    const status: { code: number | null } = { code: null };
    expect(runIn("      case 'backup': {\n", status)).toEqual([
      'src/operator/cli.ts backup /backups --keep 14 --copy-to /offbox',
    ]);
    // The stub `sleep` sent the shell SIGTERM: it exited 0 by its trap, not killed by the signal.
    expect(status.code).toBe(0);
  });

  it('asks the image for the very word this checkout’s run.ts answers to', () => {
    const run = readFileSync(new URL('./operator/run.ts', import.meta.url), 'utf8');
    expect(run).toContain("case 'backup-loop':");
    expect(script()).toContain(`grep -q "'backup-loop'" src/operator/run.ts`);
  });

  it('is the only service that mounts the backup folders: the instance, which holds the secret key, does not', () => {
    const block = /^services:\n([\s\S]*?)(?=^[a-z])/m.exec(COMPOSE)?.[1] ?? '';
    const services = [...block.matchAll(/^ {2}([a-z][a-z0-9_-]*):\s*$/gm)].map(
      (match) => match[1] ?? '',
    );
    expect(services).toContain('instance');
    for (const folder of ['OYL_BACKUP_DIR', 'OYL_OFFBOX_DIR']) {
      expect(services.filter((name) => service(name).includes(folder))).toEqual(['backup']);
    }
  });
});

describe('deploy/home/compose.yaml — the admin pages’ loopback listener (#2643, ADR 0069 D-5)', () => {
  /** Every uncommented line of the instance's service. */
  const lines = (): string[] =>
    service('instance')
      .split('\n')
      .filter((line) => !/^\s*#/.test(line));

  it('publishes it on the host’s loopback only, the same port on both sides, and nothing else', () => {
    const at = lines().indexOf('    ports:');
    expect(at).toBeGreaterThan(-1);
    const published = lines()
      .slice(at + 1)
      .filter((line) => /^ {6}- /.test(line));
    expect(published).toEqual([
      "      - '127.0.0.1:${OYL_INSTANCE_ADMIN_LOOPBACK_PORT:-8788}:${OYL_INSTANCE_ADMIN_LOOPBACK_PORT:-8788}'",
    ]);
    // Never every interface, and never the main port.
    expect(lines().join('\n')).not.toMatch(/0\.0\.0\.0|\[::\]|:8787:/);
  });

  it('leaves it off unless .env turns it on, and passes the tunnel sign-in allowlist through empty', () => {
    expect(setting('OYL_INSTANCE_ADMIN_LOOPBACK_PORT')).toBe(
      '${OYL_INSTANCE_ADMIN_LOOPBACK_PORT:-}',
    );
    expect(setting('OYL_INSTANCE_ADMIN_ADDRESSES')).toBe('${OYL_INSTANCE_ADMIN_ADDRESSES:-}');
    const example = readFileSync(
      new URL('../deploy/home/instance.env.example', import.meta.url),
      'utf8',
    );
    expect(example).toMatch(/^OYL_INSTANCE_ADMIN_LOOPBACK_PORT=$/m);
    expect(example).toMatch(/^OYL_INSTANCE_ADMIN_ADDRESSES=$/m);
  });

  it('is a configuration the instance accepts with the admin pages on, and refuses without them', () => {
    const on = readServerConfig({ adminPages: 'on', adminLoopbackPort: '8788' }, 1);
    expect(on.ok && on.config.adminLoopbackPort).toBe(8788);
    const off = readServerConfig({ adminPages: 'off', adminLoopbackPort: '8788' }, 1);
    expect(off.ok).toBe(false);
  });
});
