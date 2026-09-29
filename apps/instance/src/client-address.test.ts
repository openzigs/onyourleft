// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which address a per-address limit counts (#775's carried points): the
 * proxy's header, believed from a local peer only, and an IPv6 client by its
 * /64.
 */

import { connect } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { addressKey } from './auth/rate-limit.ts';
import { clientAddress, isLocalAddress } from './client-address.ts';
import type { Handler } from './handler.ts';
import { listen, type Listening } from './node-listener.ts';

const HEADER = 'cf-connecting-ip';
const headers = (value?: string): Headers =>
  new Headers(value === undefined ? {} : { [HEADER]: value });

describe('clientAddress', () => {
  it('reads the named header from a local peer — a proxy the operator runs', () => {
    for (const peer of [
      '127.0.0.1',
      '::1',
      '::ffff:127.0.0.1',
      '10.0.0.3',
      '172.17.0.2',
      '192.168.1.9',
      'fd00::2',
    ]) {
      expect(clientAddress(peer, headers('203.0.113.9'), HEADER), peer).toBe('203.0.113.9');
    }
  });

  it('ignores the header from a public peer, who could have typed it', () => {
    for (const peer of ['203.0.113.50', '172.32.0.1', '2001:db8::1', '8.8.8.8']) {
      expect(clientAddress(peer, headers('198.51.100.1'), HEADER), peer).toBe(peer);
    }
  });

  it('ignores the header when the operator named none, and one that is not an address', () => {
    expect(clientAddress('127.0.0.1', headers('203.0.113.9'), null)).toBe('127.0.0.1');
    expect(clientAddress('127.0.0.1', headers('203.0.113.9, 10.0.0.1'), HEADER)).toBe('127.0.0.1');
    expect(clientAddress('127.0.0.1', headers(), HEADER)).toBe('127.0.0.1');
    expect(clientAddress(null, headers('203.0.113.9'), HEADER)).toBeNull();
  });

  it('knows a local address from a public one', () => {
    expect(isLocalAddress('172.15.255.255')).toBe(false);
    expect(isLocalAddress('172.16.0.0')).toBe(true);
    expect(isLocalAddress('172.31.255.255')).toBe(true);
    expect(isLocalAddress('fe80::1')).toBe(true);
    expect(isLocalAddress('2001:db8::1')).toBe(false);
  });
});

describe('addressKey', () => {
  it('counts IPv4 as it is, and an IPv4-mapped IPv6 address as the IPv4 it is', () => {
    expect(addressKey('203.0.113.7')).toBe('203.0.113.7');
    expect(addressKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('counts IPv6 by its first 64 bits, however it is written', () => {
    const one = addressKey('2001:db8:1:2::5');
    for (const address of [
      '2001:0db8:0001:0002:ffff::1',
      '2001:DB8:1:2:0:0:0:9',
      '2001:db8:1:2::',
    ]) {
      expect(addressKey(address), address).toBe(one);
    }
    expect(addressKey('2001:db8:1:3::5')).not.toBe(one);
    expect(addressKey('::1')).toBe('0:0:0:0::/64');
  });
});

describe('the Node listener (#775)', () => {
  let running: Listening | undefined;
  afterEach(async () => {
    await running?.close();
    running = undefined;
  });

  /** A listener whose answer is the client address the handler was handed. */
  async function echoAddress(clientAddressHeader: string | null): Promise<Listening> {
    const handler: Handler = (_request, client) =>
      Promise.resolve(Response.json({ address: client?.address ?? null }));
    running = await listen(handler, { host: '127.0.0.1', port: 0, clientAddressHeader });
    return running;
  }

  function ask(listening: Listening, header?: string): Promise<unknown> {
    const { hostname, port } = new URL(listening.url);
    return new Promise((resolve, reject) => {
      const socket = connect(Number(port), hostname, () => {
        socket.write(
          `GET / HTTP/1.1\r\nHost: x\r\n${header === undefined ? '' : `${HEADER}: ${header}\r\n`}Connection: close\r\n\r\n`,
        );
      });
      let text = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => (text += chunk));
      socket.on('end', () => {
        const body = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
        resolve(JSON.parse(body) as unknown);
      });
      socket.on('error', reject);
    });
  }

  it('hands the handler the proxy’s header when the operator named it', async () => {
    const listening = await echoAddress(HEADER);
    expect(await ask(listening, '203.0.113.9')).toEqual({ address: '203.0.113.9' });
    expect(await ask(listening)).toEqual({ address: '127.0.0.1' });
  });

  it('hands the handler the socket’s peer when the operator named no header', async () => {
    const listening = await echoAddress(null);
    expect(await ask(listening, '203.0.113.9')).toEqual({ address: '127.0.0.1' });
  });
});
