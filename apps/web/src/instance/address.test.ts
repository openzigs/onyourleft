// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { ADDRESS_REFUSAL_TEXT, instanceAddress, isLoopbackHost } from './address';

describe('which instance addresses the app will talk to — #777', () => {
  it('accepts an https origin, and gives the wss origin a room will use', () => {
    expect(instanceAddress('https://ride.example')).toEqual({
      kind: 'accepted',
      origin: 'https://ride.example',
      socketOrigin: 'wss://ride.example',
    });
    expect(instanceAddress('  https://Ride.Example:8443/  ')).toEqual({
      kind: 'accepted',
      origin: 'https://ride.example:8443',
      socketOrigin: 'wss://ride.example:8443',
    });
  });

  it('reads a bare host as https, never as http', () => {
    expect(instanceAddress('ride.example')).toMatchObject({ origin: 'https://ride.example' });
  });

  it('refuses http to any other machine, with the sentence that says why', () => {
    for (const typed of ['http://ride.example', 'http://192.168.1.20:8787', 'http://10.0.0.2']) {
      expect(instanceAddress(typed)).toEqual({ kind: 'refused', why: 'not-encrypted' });
    }
    expect(ADDRESS_REFUSAL_TEXT['not-encrypted']).toContain('not encrypted');
    expect(ADDRESS_REFUSAL_TEXT['not-encrypted']).toContain('https://');
    expect(ADDRESS_REFUSAL_TEXT['not-encrypted']).toContain('localhost');
  });

  it('allows http to this machine only, for development, with a ws socket', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      expect(instanceAddress(`http://${host}:8787`)).toEqual({
        kind: 'accepted',
        origin: `http://${host}:8787`,
        socketOrigin: `ws://${host}:8787`,
      });
    }
    // A name that merely STARTS like one is another machine.
    expect(instanceAddress('http://localhost.evil.example')).toMatchObject({
      why: 'not-encrypted',
    });
    expect(isLoopbackHost('LOCALHOST')).toBe(true);
    expect(isLoopbackHost('127.0.0.2')).toBe(false);
  });

  it('refuses what is not just an address rather than dropping the rest', () => {
    for (const typed of [
      'https://ride.example/v1',
      'https://ride.example?x=1',
      'https://ride.example#top',
      'https://ride.example?',
      'https://rider@ride.example',
    ]) {
      expect(instanceAddress(typed), typed).toEqual({
        kind: 'refused',
        why: 'not-just-an-address',
      });
    }
  });

  it('refuses nothing, nonsense and other schemes', () => {
    expect(instanceAddress('   ')).toEqual({ kind: 'refused', why: 'empty' });
    expect(instanceAddress('https://')).toEqual({ kind: 'refused', why: 'unreadable' });
    for (const typed of ['wss://ride.example', 'ftp://ride.example', 'javascript:alert(1)']) {
      expect(instanceAddress(typed), typed).toEqual({ kind: 'refused', why: 'not-a-web-address' });
    }
  });
});
