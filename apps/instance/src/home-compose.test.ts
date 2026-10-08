// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The home deployment's client-address settings (#903 item 4): the header is
 * believed only from a trusted proxy, so `compose.yaml` must name EXACTLY the
 * address it gives `cloudflared`, inside the subnet it declares. A compose file
 * that set the header and trusted nobody would count every rider as the
 * tunnel — one rate-limit bucket for everybody — with every other test green.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { clientAddress } from './client-address.ts';
import { readAnalysisModelSettings, readConfig, readHistorySettings } from './config.ts';

const COMPOSE = readFileSync(new URL('../deploy/home/compose.yaml', import.meta.url), 'utf8');

/** The one value a `KEY: value` line in the file sets, or `undefined`. */
function setting(key: string): string | undefined {
  return new RegExp(`^\\s*${key}:\\s*(\\S+)\\s*$`, 'm').exec(COMPOSE)?.[1];
}

describe('deploy/home/compose.yaml — the rider’s address behind the tunnel', () => {
  const header = setting('OYL_INSTANCE_CLIENT_ADDRESS_HEADER');
  const trusted = setting('OYL_INSTANCE_TRUSTED_PROXIES');
  const tunnel = setting('ipv4_address');
  const subnet = setting('- subnet');

  it('names the header, and trusts exactly the address it gives cloudflared', () => {
    expect(header).toBe('cf-connecting-ip');
    expect(tunnel).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(trusted).toBe(tunnel);
    const [network] = (subnet ?? '').split('/');
    expect(network?.split('.').slice(0, 3)).toEqual(tunnel?.split('.').slice(0, 3));
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
    expect(clientAddress(tunnel ?? '', sent, clientAddressHeader, trustedProxies)).toBe(
      '203.0.113.9',
    );
    expect(clientAddress('172.30.87.3', sent, clientAddressHeader, trustedProxies)).toBe(
      '172.30.87.3',
    );
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
    // And no service in the file publishes one at all, the debugging line aside.
    const published = COMPOSE.split('\n').filter((line) => /^\s*ports:/.test(line));
    expect(published).toStrictEqual([]);
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
});
