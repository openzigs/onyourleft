// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { DEFAULT_HOST, DEFAULT_PORT, readConfig, readHistorySettings } from './config.ts';

const COMMIT = 'fedcba9876543210fedcba9876543210fedcba98';

describe('readConfig', () => {
  it('builds the source URL from the commit, on this repository', () => {
    const result = readConfig({ commit: COMMIT });
    expect(result).toEqual({
      ok: true,
      config: {
        host: DEFAULT_HOST,
        port: DEFAULT_PORT,
        commit: COMMIT,
        sourceUrl: `https://github.com/openzigs/onyourleft/tree/${COMMIT}`,
        bodyLimitBytes: 1024 * 1024,
        registration: 'closed',
        moderators: {},
        publicRooms: { minimumAccountDays: 7, minimumCompletedRides: 3 },
        clientAddressHeader: null,
        trustedProxies: [],
        history: {
          kind: 'off',
          code: 'not-set',
          reason: 'OYL_INSTANCE_EMBEDDING_URL is not set, so no embedding model is configured.',
        },
      },
    });
  });

  it('refuses to start knowing neither the commit nor the source (AGPL-3.0 §13)', () => {
    const result = readConfig({});
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.problems.join(' ')).toContain('OYL_INSTANCE_COMMIT');
  });

  it('prefers an operator’s own source URL, and requires it to be https', () => {
    const ours = readConfig({ commit: COMMIT, sourceUrl: 'https://example.org/fork' });
    expect(ours.ok && ours.config.sourceUrl).toBe('https://example.org/fork');
    const plain = readConfig({ sourceUrl: 'http://example.org/fork' });
    expect(plain.ok).toBe(false);
    const nonsense = readConfig({ sourceUrl: 'not a url' });
    expect(nonsense.ok).toBe(false);
  });

  it('refuses a commit that is not a full id, rather than guessing', () => {
    for (const commit of ['abc123', COMMIT.toUpperCase(), `${COMMIT}0`]) {
      const result = readConfig({ commit });
      expect(result.ok ? [] : result.problems).toEqual([
        'OYL_INSTANCE_COMMIT must be a full 40-character lower-case commit id.',
      ]);
    }
  });

  it('reads a host and a port, and refuses a port that is not one', () => {
    const result = readConfig({ commit: COMMIT, host: '0.0.0.0', port: '9000' });
    expect(result.ok && [result.config.host, result.config.port]).toEqual(['0.0.0.0', 9000]);
    for (const port of ['-1', '65536', '80a', '1.5']) {
      expect(readConfig({ commit: COMMIT, port }).ok).toBe(false);
    }
  });

  it('reports every problem, not only the first', () => {
    const result = readConfig({ commit: 'nope', port: 'nope', sourceUrl: 'nope' });
    expect(result.ok ? 0 : result.problems.length).toBe(3);
  });

  it('registers nobody when nothing is set (#891 merge review), and reads each mode', () => {
    const unset = readConfig({ commit: COMMIT });
    expect(unset.ok && unset.config.registration).toBe('closed');
    for (const mode of ['open', 'approval', 'invite', 'closed']) {
      const result = readConfig({ commit: COMMIT, registration: ` ${mode} ` });
      expect(result.ok && result.config.registration).toBe(mode);
    }
    expect(readConfig({ commit: COMMIT, registration: 'anyone' }).ok).toBe(false);
  });

  it('reads the registration mode whatever its case, as main’s reader did (`Closed`, `APPROVAL`)', () => {
    for (const [given, mode] of [
      ['Closed', 'closed'],
      ['APPROVAL', 'approval'],
      ['Invite', 'invite'],
    ] as const) {
      const result = readConfig({ commit: COMMIT, registration: given });
      expect(result.ok && result.config.registration, given).toBe(mode);
    }
  });

  it('names the owner and the deputy by device key, and refuses anything else (#83, ruling Q13)', () => {
    const owner = 'a'.repeat(64);
    const deputy = 'b'.repeat(64);
    const named = readConfig({ commit: COMMIT, ownerKey: owner, deputyKey: deputy });
    expect(named.ok && named.config.moderators).toEqual({ owner, deputy });
    expect(readConfig({ commit: COMMIT, ownerKey: owner.toUpperCase() }).ok).toBe(false);
    expect(readConfig({ commit: COMMIT, deputyKey: 'abc' }).ok).toBe(false);
    const same = readConfig({ commit: COMMIT, ownerKey: owner, deputyKey: owner });
    expect(same.ok ? [] : same.problems).toEqual([
      'OYL_INSTANCE_OWNER_KEY and OYL_INSTANCE_DEPUTY_KEY must be two different keys.',
    ]);
  });

  it('reads the public-room thresholds, defaulting to a week and three rides', () => {
    const unset = readConfig({ commit: COMMIT });
    expect(unset.ok && unset.config.publicRooms).toEqual({
      minimumAccountDays: 7,
      minimumCompletedRides: 3,
    });
    const set = readConfig({
      commit: COMMIT,
      publicRoomMinAccountDays: '30',
      publicRoomMinRides: '0',
    });
    expect(set.ok && set.config.publicRooms).toEqual({
      minimumAccountDays: 30,
      minimumCompletedRides: 0,
    });
    expect(readConfig({ commit: COMMIT, publicRoomMinRides: '-1' }).ok).toBe(false);
  });

  it('reads the client address header in lower case, and refuses one that is not a name', () => {
    const set = readConfig({ commit: COMMIT, clientAddressHeader: 'CF-Connecting-IP' });
    expect(set.ok && set.config.clientAddressHeader).toBe('cf-connecting-ip');
    expect(readConfig({ commit: COMMIT, clientAddressHeader: 'a header' }).ok).toBe(false);
  });

  it('reads the trusted proxies as exact addresses, and refuses anything else (#891)', () => {
    const set = readConfig({
      commit: COMMIT,
      trustedProxies: ' 172.17.0.1, ::FFFF:10.0.0.2 ,fd00::1',
    });
    expect(set.ok && set.config.trustedProxies).toEqual(['172.17.0.1', '10.0.0.2', 'fd00::1']);
    for (const bad of ['172.17.0.0/16', 'proxy.local', '172.17.0.1,,10.0.0.1']) {
      const refused = readConfig({ commit: COMMIT, trustedProxies: bad });
      expect(refused.ok, bad).toBe(false);
      expect(refused.ok ? '' : refused.problems.join(' '), bad).toContain(
        'OYL_INSTANCE_TRUSTED_PROXIES',
      );
    }
  });
});

describe('the history index’s settings (#835, ADR 0040 D-5, D-6)', () => {
  it('turns the index off, never the instance, when no address is set', () => {
    expect(readHistorySettings({})).toEqual({
      kind: 'off',
      code: 'not-set',
      reason: 'OYL_INSTANCE_EMBEDDING_URL is not set, so no embedding model is configured.',
    });
    expect(readHistorySettings({ embeddingUrl: '  ' }).kind).toBe('off');
  });

  it('defaults to nomic-embed-text with its own prefixes, and to no prefix for any other model', () => {
    expect(readHistorySettings({ embeddingUrl: 'http://ollama:11434' })).toEqual({
      kind: 'on',
      embedding: {
        endpoint: new URL('http://ollama:11434'),
        model: 'nomic-embed-text',
        documentPrefix: 'search_document: ',
        queryPrefix: 'search_query: ',
      },
    });
    const other = readHistorySettings({
      embeddingUrl: 'http://127.0.0.1:11434/',
      embeddingModel: 'all-minilm:l6-v2',
    });
    expect(other.kind === 'on' && other.embedding).toMatchObject({
      model: 'all-minilm:l6-v2',
      documentPrefix: '',
      queryPrefix: '',
    });
  });

  it('uses a prefix exactly as set, trailing space included, and reads a blank one as unset', () => {
    const set = readHistorySettings({
      embeddingUrl: 'http://ollama:11434',
      embeddingDocumentPrefix: 'passage: ',
      embeddingQueryPrefix: '',
    });
    expect(set.kind === 'on' && set.embedding.documentPrefix).toBe('passage: ');
    expect(set.kind === 'on' && set.embedding.queryPrefix).toBe('search_query: ');
    const control = readHistorySettings({
      embeddingUrl: 'http://ollama:11434',
      embeddingQueryPrefix: 'a\u0007b',
    });
    expect(control.kind).toBe('off');
  });

  it.each([
    ['a public name', 'http://embeddings.example.org:11434', 'not-local', 'refused'],
    ['a .local name', 'http://box.local:11434', 'not-local', 'refused'],
    ['a .internal name', 'http://ollama.internal:11434', 'not-local', 'refused'],
    ['a public address', 'http://8.8.8.8:11434', 'not-local', 'refused'],
    ['a path', 'http://ollama:11434/api', 'not-origin', 'no path'],
    ['credentials', 'http://user:secret@ollama:11434', 'not-origin', 'address alone'],
    ['a query', 'http://ollama:11434/?a=b', 'not-origin', 'address alone'],
    ['another scheme', 'ftp://ollama', 'not-a-url', 'http:'],
    ['not a URL', 'ollama:11434', 'not-a-url', 'http:'],
    ['nonsense', '::::', 'not-a-url', 'not a URL'],
  ])('turns the index off for %s, and says why', (_case, embeddingUrl, code, why) => {
    const settings = readHistorySettings({ embeddingUrl });
    expect(settings.kind === 'off' && settings.code).toBe(code);
    expect(settings.kind === 'off' ? settings.reason : '').toContain(why);
  });

  it('refuses a model name that is not one, and starts the instance anyway', () => {
    const settings = readHistorySettings({
      embeddingUrl: 'http://ollama:11434',
      embeddingModel: 'a model; rm -rf',
    });
    expect(settings.kind).toBe('off');
    const whole = readConfig({
      commit: COMMIT,
      embeddingUrl: 'http://embeddings.example.org',
    });
    expect(whole.ok).toBe(true);
    expect(whole.ok && whole.config.history.kind).toBe('off');
  });
});
