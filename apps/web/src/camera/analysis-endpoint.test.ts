// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The rider's computer: nothing by default, only an address on their own
 * network, and a stored row re-decided on every read — #387.
 */

import { describe, expect, it } from 'vitest';

import {
  addressSpaceOf,
  ANALYSIS_ENDPOINT_STORAGE_KEY,
  completionsUrl,
  endpointDecision,
  ENDPOINT_REFUSAL_TEXT,
  forgetAnalysisEndpoint,
  readAnalysisEndpoint,
  writeAnalysisEndpoint,
  type EndpointStorage,
} from './analysis-endpoint';

/** A `localStorage` in a `Map`, so a test owns what is stored. */
function memoryStorage(initial: Record<string, string> = {}): EndpointStorage & {
  readonly rows: Map<string, string>;
} {
  const rows = new Map(Object.entries(initial));
  return {
    rows,
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => {
      rows.set(key, value);
    },
    removeItem: (key) => {
      rows.delete(key);
    },
  };
}

function decide(
  address: string,
  model = 'a-model',
  switchedOn = true,
): ReturnType<typeof endpointDecision> {
  return endpointDecision({ address, model, switchedOn });
}

describe('nothing is configured by default', () => {
  it('reads as nothing on a device that has never been set up', () => {
    expect(readAnalysisEndpoint(memoryStorage())).toBeUndefined();
  });

  it('reads as nothing where the device has no storage at all', () => {
    expect(readAnalysisEndpoint(undefined)).toBeUndefined();
  });

  it('refuses an empty address and an empty model, rather than defaulting either', () => {
    expect(decide('').refusal).toBe('no-address');
    expect(decide('http://192.168.1.20:8080', '  ').refusal).toBe('no-model');
  });
});

describe('only an address on the rider’s own network', () => {
  it.each([
    ['http://localhost:8080', 'loopback'],
    ['http://127.0.0.1:8080', 'loopback'],
    ['http://[::1]:8080', 'loopback'],
    ['http://box.localhost:8080', 'loopback'],
    ['http://10.0.0.5:8080', 'local'],
    ['http://172.16.0.1', 'local'],
    ['http://172.31.255.255', 'local'],
    ['http://192.168.1.20:11111', 'local'],
    ['http://169.254.1.1', 'local'],
    ['http://100.64.0.1', 'local'],
    ['http://100.127.255.254', 'local'],
    ['http://[fd12:3456::1]:8080', 'local'],
    ['http://[fe80::1]', 'local'],
    ['http://studio.local:8080', 'local'],
    ['https://studio.home.arpa', 'local'],
    ['http://gpu.internal', 'local'],
  ])('accepts %s as %s', (address, space) => {
    const decision = decide(address);
    expect(decision.refusal).toBeUndefined();
    expect(addressSpaceOf(new URL(address).hostname)).toBe(space);
  });

  it.each([
    'https://api.example.com',
    'https://studio.example.com',
    'http://8.8.8.8',
    'http://172.32.0.1',
    'http://172.15.0.1',
    'http://100.128.0.1',
    'http://192.169.1.1',
    'http://[2001:db8::1]',
    'http://[::ffff:192.168.1.1]',
    'http://my-pc:8080',
    'http://local',
    'http://evil.local.example.com',
    'http://0.0.0.0',
  ])('refuses %s as not local', (address) => {
    expect(decide(address).refusal).toBe('not-local');
  });

  it('refuses what is not an http address at all', () => {
    expect(decide('not a url').refusal).toBe('not-an-address');
    expect(decide('ftp://192.168.1.20').refusal).toBe('not-http');
    expect(decide('file:///etc/passwd').refusal).toBe('not-http');
  });

  it('refuses a name or a password in the address', () => {
    expect(decide('http://user:secret@192.168.1.20:8080').refusal).toBe('has-credentials');
  });

  it('refuses a query, a fragment, or a path of the rider’s own', () => {
    expect(decide('http://192.168.1.20:8080/?x=1').refusal).toBe('has-query');
    expect(decide('http://192.168.1.20:8080/#x').refusal).toBe('has-query');
    expect(decide('http://192.168.1.20:8080/elsewhere').refusal).toBe('unexpected-path');
  });

  it('accepts the paths a server’s own documentation prints, and keeps only the origin', () => {
    for (const typed of [
      'http://192.168.1.20:8080',
      'http://192.168.1.20:8080/',
      'http://192.168.1.20:8080/v1',
      'http://192.168.1.20:8080/v1/',
      'http://192.168.1.20:8080/v1/chat/completions',
    ]) {
      const decision = decide(typed);
      expect(decision.endpoint?.address, typed).toBe('http://192.168.1.20:8080');
      if (decision.endpoint !== undefined) {
        expect(completionsUrl(decision.endpoint)).toBe(
          'http://192.168.1.20:8080/v1/chat/completions',
        );
      }
    }
  });

  it('refuses a model name longer than any model tag', () => {
    expect(decide('http://192.168.1.20', 'm'.repeat(201)).refusal).toBe('model-too-long');
    expect(decide('http://192.168.1.20', 'm'.repeat(200)).refusal).toBeUndefined();
  });

  it('keeps "switched on" as its own answer', () => {
    expect(decide('http://192.168.1.20', 'm', false).endpoint?.switchedOn).toBe(false);
    expect(decide('http://192.168.1.20', 'm', true).endpoint?.switchedOn).toBe(true);
  });

  it('never repeats what was typed in a refusal', () => {
    // The address a rider types is theirs; a sentence quoting it back would
    // carry it into whatever reads the screen.
    for (const text of Object.values(ENDPOINT_REFUSAL_TEXT)) {
      expect(text).not.toContain('example.com');
      expect(text).not.toContain('secret');
    }
  });
});

describe('what is stored is re-decided, not trusted', () => {
  it('reads back what was written, through the same read a press uses', () => {
    const storage = memoryStorage();
    const endpoint = decide('http://192.168.1.20:8080', 'vision').endpoint;
    expect(endpoint).toBeDefined();
    if (endpoint === undefined) {
      return;
    }
    expect(writeAnalysisEndpoint(endpoint, storage)).toBe(true);
    expect(readAnalysisEndpoint(storage)).toStrictEqual(endpoint);
  });

  it('reads a hand-edited row naming a public address as nothing', () => {
    // The row a hosted path would need, written by hand into localStorage. It
    // is refused on the way OUT, exactly as it would have been on the way in.
    const storage = memoryStorage({
      [ANALYSIS_ENDPOINT_STORAGE_KEY]: JSON.stringify({
        address: 'https://api.example.com',
        model: 'somebody-elses',
        switchedOn: true,
      }),
    });
    expect(readAnalysisEndpoint(storage)).toBeUndefined();
  });

  it('reads "switched on" as off unless it is exactly true', () => {
    const storage = memoryStorage({
      [ANALYSIS_ENDPOINT_STORAGE_KEY]: JSON.stringify({
        address: 'http://192.168.1.20',
        model: 'm',
        switchedOn: 'yes',
      }),
    });
    expect(readAnalysisEndpoint(storage)?.switchedOn).toBe(false);
  });

  it('reads a malformed row as nothing', () => {
    for (const row of ['{', 'null', '"x"', JSON.stringify({ address: 1, model: 'm' })]) {
      expect(readAnalysisEndpoint(memoryStorage({ [ANALYSIS_ENDPOINT_STORAGE_KEY]: row }))).toBe(
        undefined,
      );
    }
  });

  it('forgets', () => {
    const storage = memoryStorage();
    const endpoint = decide('http://192.168.1.20').endpoint;
    if (endpoint === undefined) {
      expect.unreachable('no endpoint');
      return;
    }
    writeAnalysisEndpoint(endpoint, storage);
    forgetAnalysisEndpoint(storage);
    expect(readAnalysisEndpoint(storage)).toBeUndefined();
    expect(storage.rows.size).toBe(0);
  });

  it('reports a device that will not keep it', () => {
    const endpoint = decide('http://192.168.1.20').endpoint;
    if (endpoint === undefined) {
      expect.unreachable('no endpoint');
      return;
    }
    const full: EndpointStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    expect(writeAnalysisEndpoint(endpoint, full)).toBe(false);
    expect(writeAnalysisEndpoint(endpoint, undefined)).toBe(false);
  });
});
