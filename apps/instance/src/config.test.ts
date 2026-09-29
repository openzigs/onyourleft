// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { DEFAULT_HOST, DEFAULT_PORT, readConfig } from './config.ts';

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
});
