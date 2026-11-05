// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readDiscordTokenFile, readServerConfig, type DiscordTokenFile } from './server-config.ts';

describe('readServerConfig (#780, #791)', () => {
  it('defaults: compression OFF (ruling Q16), metrics off, a worker per core', () => {
    const result = readServerConfig({}, 4);
    expect(result).toMatchObject({
      ok: true,
      config: {
        databasePath: 'data/instance.sqlite',
        origin: null,
        roomWorkers: 4,
        compression: false,
        metrics: false,
      },
    });
  });

  it('turns compression and metrics on only for the word on', () => {
    const on = readServerConfig(
      { compression: 'on', metrics: 'ON', metricsToken: 'k'.repeat(32) },
      1,
    );
    expect(on.ok && [on.config.compression, on.config.metrics]).toEqual([true, true]);
    expect(readServerConfig({ compression: 'yes' }, 1).ok).toBe(false);
  });

  it('takes an origin alone, https unless it is this machine', () => {
    const ok = readServerConfig({ origin: 'https://ride.example' }, 1);
    expect(ok.ok && ok.config.origin).toBe('https://ride.example');
    const local = readServerConfig({ origin: 'http://127.0.0.1:8787' }, 1);
    expect(local.ok && local.config.origin).toBe('http://127.0.0.1:8787');
    for (const origin of ['http://ride.example', 'https://ride.example/path', 'nonsense']) {
      expect(readServerConfig({ origin }, 1).ok, origin).toBe(false);
    }
  });

  it('refuses a worker count that is not one, and reports every problem', () => {
    expect(readServerConfig({ roomWorkers: '0' }, 1).ok).toBe(false);
    expect(readServerConfig({ roomWorkers: '2' }, 8)).toMatchObject({ config: { roomWorkers: 2 } });
    const many = readServerConfig({ roomWorkers: 'x', pingIntervalMs: '50', metrics: '1' }, 1);
    expect(many.ok ? 0 : many.problems.length).toBe(3);
  });

  it('pings every 25 s unless told otherwise, and 0 turns the ping off (to measure a tunnel’s idle timeout)', () => {
    expect(readServerConfig({}, 1)).toMatchObject({ config: { pingIntervalMs: 25_000 } });
    expect(readServerConfig({ pingIntervalMs: '0' }, 1)).toMatchObject({
      config: { pingIntervalMs: 0 },
    });
    expect(readServerConfig({ pingIntervalMs: '10000' }, 1)).toMatchObject({
      config: { pingIntervalMs: 10_000 },
    });
    expect(readServerConfig({ pingIntervalMs: '50' }, 1).ok).toBe(false);
  });

  it('beats an analysis stream every 25 s unless told otherwise, 0 for #1105’s control, and never slower than 60 s (#1095)', () => {
    expect(readServerConfig({}, 1)).toMatchObject({ config: { analysisHeartbeatMs: 25_000 } });
    for (const [given, read] of [
      ['0', 0],
      ['1000', 1_000],
      ['60000', 60_000],
    ] as const) {
      expect(readServerConfig({ analysisHeartbeatMs: given }, 1)).toMatchObject({
        config: { analysisHeartbeatMs: read },
      });
    }
    for (const refused of ['60001', '120000', '999', '25s', '-1']) {
      const answer = readServerConfig({ analysisHeartbeatMs: refused }, 1);
      expect(answer.ok, refused).toBe(false);
      expect(answer.ok ? '' : answer.problems.join(' ')).toContain(
        'OYL_INSTANCE_ANALYSIS_HEARTBEAT_MS',
      );
    }
  });

  it('refuses metrics on with no token, or with one too short to be one — #895 N3', () => {
    expect(readServerConfig({ metrics: 'on' }, 1).ok).toBe(false);
    expect(readServerConfig({ metrics: 'on', metricsToken: 'short' }, 1).ok).toBe(false);
    const on = readServerConfig({ metrics: 'on', metricsToken: 'a'.repeat(32) }, 1);
    expect(on.ok && on.config.metricsToken).toBe('a'.repeat(32));
  });

  describe('Discord voice (#874)', () => {
    const TOKEN = 'test-bot-token.not-real.oyl-874-fixture-0123456789';
    const GUILD = '100000000000000001';
    const tokenFile = (text: string): DiscordTokenFile => ({ kind: 'read', text });

    it('is off — not a problem — with neither variable set', () => {
      expect(readServerConfig({}, 1)).toMatchObject({ ok: true, config: { discord: undefined } });
      expect(
        readServerConfig({ discordBotTokenFile: tokenFile(' '), discordGuildId: '' }, 1),
      ).toMatchObject({
        ok: true,
        config: { discord: undefined },
      });
    });

    it('is on with both, trimmed', () => {
      expect(
        readServerConfig(
          { discordBotTokenFile: tokenFile(` ${TOKEN}\n`), discordGuildId: ` ${GUILD}\n` },
          1,
        ),
      ).toMatchObject({ ok: true, config: { discord: { botToken: TOKEN, guildId: GUILD } } });
    });

    it('refuses half of it, or a malformed one, naming the variable and never the value', () => {
      const cases = [
        { discordBotTokenFile: tokenFile(TOKEN) },
        { discordGuildId: GUILD },
        { discordBotTokenFile: tokenFile('short'), discordGuildId: GUILD },
        { discordBotTokenFile: tokenFile(`${TOKEN} with spaces`), discordGuildId: GUILD },
        // #2146: a file holding the token and anything else is not a token file.
        { discordBotTokenFile: tokenFile(`${TOKEN}\nwith spaces`), discordGuildId: GUILD },
        { discordBotTokenFile: tokenFile(TOKEN), discordGuildId: 'my-server' },
      ];
      for (const raw of cases) {
        const read = readServerConfig(raw, 1);
        expect(read.ok, JSON.stringify(Object.keys(raw))).toBe(false);
        const problems = (read.ok ? [] : read.problems).join(' ');
        expect(problems).toMatch(/OYL_INSTANCE_DISCORD_(BOT_TOKEN|GUILD_ID)/);
        expect(problems).not.toContain(TOKEN);
        expect(problems).not.toContain('with spaces');
        expect(problems).not.toContain('my-server');
      }
    });

    it('reads the token from the file the variable names, as serve.ts reads it — #2146', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'oyl-2146-'));
      const path = join(directory, 'discord-bot-token');
      await writeFile(path, `${TOKEN}\n`, { mode: 0o600 });
      const readFile = (named: string): string => readFileSync(named, 'utf8');

      expect(readDiscordTokenFile(undefined, readFile)).toEqual({ kind: 'unset' });
      expect(readDiscordTokenFile('  ', readFile)).toEqual({ kind: 'unset' });
      const file = readDiscordTokenFile(` ${path} `, readFile);
      expect(file).toEqual({ kind: 'read', text: `${TOKEN}\n` });
      expect(
        readServerConfig({ discordBotTokenFile: file, discordGuildId: GUILD }, 1),
      ).toMatchObject({ ok: true, config: { discord: { botToken: TOKEN, guildId: GUILD } } });
    });

    it('refuses a token file it cannot read, naming the variable and saying nothing the read said', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'oyl-2146-'));
      const readFile = (named: string): string => readFileSync(named, 'utf8');
      // A file that is not there, and a directory where the file should be.
      for (const path of [join(directory, 'missing'), directory]) {
        const file = readDiscordTokenFile(path, readFile);
        expect(file).toEqual({ kind: 'unreadable' });
        for (const guild of [GUILD, undefined]) {
          const read = readServerConfig({ discordBotTokenFile: file, discordGuildId: guild }, 1);
          expect(read.ok).toBe(false);
          const problems = read.ok ? [] : read.problems;
          expect(problems).toEqual([
            expect.stringContaining('OYL_INSTANCE_DISCORD_BOT_TOKEN_FILE'),
          ]);
          expect(problems.join(' ')).not.toMatch(/ENOENT|EISDIR|oyl-2146/);
        }
      }
      // A read that throws with the token in its message: dropped, never kept.
      const leaky = readDiscordTokenFile('/run/secrets/token', () => {
        throw new Error(`could not read ${TOKEN}`);
      });
      expect(JSON.stringify(leaky)).not.toContain(TOKEN);
    });
  });
});
