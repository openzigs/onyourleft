// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The embedding address rule (#835, ADR 0040 D-6): the configured spelling,
 * and — the half that makes it a promise — every address a name resolves to.
 */

import { describe, expect, it } from 'vitest';

import {
  configuredHostProblem,
  isAddressLiteral,
  isLocalAddress,
  localAddressesOnly,
  type Resolver,
} from './address.ts';

const answering =
  (...addresses: string[]): Resolver =>
  () =>
    Promise.resolve(addresses);

describe('an address in the local ranges', () => {
  it.each([
    '127.0.0.1',
    '127.255.0.9',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.20',
    '169.254.10.10',
    '100.64.0.1',
    '100.127.255.255',
    '::1',
    '[::1]',
    'fd12:3456:789a::1',
    'fc00::1',
    'fe80::1',
    '::ffff:10.0.0.1',
    '::ffff:7f00:1',
  ])('%s is local', (address) => {
    expect(isLocalAddress(address)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '172.15.0.1',
    '172.32.0.1',
    '192.169.1.1',
    '100.63.255.255',
    '100.128.0.1',
    '1.1.1.1',
    '2001:4860:4860::8888',
    '::ffff:8.8.8.8',
    '::',
    'ollama',
    'localhost',
    '999.1.1.1',
    '1::2::3',
  ])('%s is not', (address) => {
    expect(isLocalAddress(address)).toBe(false);
  });

  it('tells a literal from a name', () => {
    expect(isAddressLiteral('10.0.0.1')).toBe(true);
    expect(isAddressLiteral('[fd00::1]')).toBe(true);
    expect(isAddressLiteral('ollama')).toBe(false);
    expect(isAddressLiteral('10.0.0')).toBe(false);
  });
});

describe('the configured host (the owner’s three forms)', () => {
  it.each(['localhost', 'ollama', 'embed-1', '127.0.0.1', '192.168.1.20', '[fd00::1]', '[::1]'])(
    'accepts %s',
    (host) => {
      expect(configuredHostProblem(host)).toBeUndefined();
    },
  );

  it.each([
    'example.org',
    'ollama.internal',
    'box.local',
    'box.home.arpa',
    '8.8.8.8',
    '[2001:db8::1]',
    '-ollama',
  ])('refuses %s', (host) => {
    expect(configuredHostProblem(host)).toBeDefined();
  });
});

describe('the address connected to (the resolved answer)', () => {
  it('refuses a single-label name that resolves to a public address, and accepts it resolving privately — the control', async () => {
    expect(await localAddressesOnly('ollama', answering('93.184.216.34'))).toEqual({
      ok: false,
      why: 'not-local',
    });
    expect(await localAddressesOnly('ollama', answering('172.30.87.20'))).toEqual({
      ok: true,
      address: '172.30.87.20',
    });
  });

  it('refuses a name when ANY address it resolves to is outside the ranges', async () => {
    expect(await localAddressesOnly('ollama', answering('10.0.0.2', '8.8.8.8'))).toEqual({
      ok: false,
      why: 'not-local',
    });
  });

  it('refuses a name that resolves to nothing, or does not resolve', async () => {
    expect(await localAddressesOnly('ollama', answering())).toEqual({
      ok: false,
      why: 'unresolved',
    });
    expect(
      await localAddressesOnly('ollama', () => Promise.reject(new Error('ENOTFOUND'))),
    ).toEqual({ ok: false, why: 'unresolved' });
  });

  it('checks a literal as it stands, without resolving anything', async () => {
    let asked = 0;
    const resolve: Resolver = () => {
      asked += 1;
      return Promise.resolve(['10.0.0.1']);
    };
    expect(await localAddressesOnly('[fd00::5]', resolve)).toEqual({
      ok: true,
      address: 'fd00::5',
    });
    expect(await localAddressesOnly('8.8.4.4', resolve)).toEqual({ ok: false, why: 'not-local' });
    expect(asked).toBe(0);
  });
});
