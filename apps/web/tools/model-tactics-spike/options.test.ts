// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2715: a flag given with no value is refused, by `live.ts` and by the
 * harness, before anything is ridden, asked or written. Each case below would
 * otherwise reach the network (`bench` asks Ollama over SSH, the harness its
 * loopback), so a refusal that went missing turns it red rather than writing
 * over a committed result.
 */

import { describe, expect, it, vi } from 'vitest';

import type { Production } from './harness/production';
import { main as harnessMain } from './harness/main';
import { main as liveMain } from './live';
import { missingValue, option } from './options';

describe('a flag and its value (#2715)', () => {
  it('takes a flag and its value out of the arguments', () => {
    expect(option(['race', '--run', '2720', 'flat'], '--run')).toEqual([['race', 'flat'], '2720']);
    expect(option(['race', 'flat'], '--run')).toEqual([['race', 'flat'], undefined]);
  });

  it('names a flag given last with no value, or with the next flag where its value goes', () => {
    expect(missingValue(['race', 'flat', '--run'], ['--host', '--run'])).toBe('--run');
    expect(missingValue(['race', '--run', '--seed', '1'], ['--run', '--seed'])).toBe('--run');
    expect(missingValue(['race', '--host', '-x'], ['--host'])).toBe('--host');
  });

  it('names none when each flag is given its value, or not given at all', () => {
    expect(
      missingValue(['race', 'flat', '--run', '2720', '--seed', '1'], ['--run', '--seed']),
    ).toBe(undefined);
    expect(missingValue(['compare'], ['--host', '--run', '--seed'])).toBeUndefined();
  });
});

describe('the tools refuse a flag with no value (#2715)', () => {
  it('live.ts exits 2 for a `--run` with no name, and says which flag', async () => {
    const written: string[] = [];
    const write = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    try {
      // No `--host`: had the refusal gone, `bench` would ride and then throw asking for one.
      expect(await liveMain(['bench', '--run'])).toBe(2);
      expect(await liveMain(['bench', '--run', '--seed', '1'])).toBe(2);
    } finally {
      write.mockRestore();
    }
    expect(written).toEqual(['--run takes a value\n', '--run takes a value\n']);
  });

  it('the harness exits 2 for a `--results` with no directory, and prints its usage', async () => {
    const printed: string[] = [];
    // Port 9 on the loopback refuses: had the refusal gone, the warm-up call would reject.
    const code = await harnessMain(
      ['bots', '--url', 'http://127.0.0.1:9', '--results'],
      {} as Production,
      { print: (line) => printed.push(line) },
    );
    expect(code).toBe(2);
    expect(printed.join('\n')).toContain('usage: run-harness.mjs');
  });
});
