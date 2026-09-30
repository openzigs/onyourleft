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
import { readConfig } from './config.ts';

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
