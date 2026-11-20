// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The write-up measurement's runner (#2840), against the fake model server:
 * the shipped agent and connection run over the set, each turn's tokens are
 * read from what the server reported, and nothing it returns holds the
 * model's text.
 */

import { describe, expect, it } from 'vitest';

import { PASSING_WRITE_UP } from '../src/analysis/agent-testing.ts';
import { startFakeModelServer } from '../src/analysis/fake-model-server-testing.ts';
import {
  measureWriteUps,
  measuringFetch,
  OLLAMA_LOOPBACK,
  sendTo,
} from './write-up-measure-run.ts';
import { WRITE_UP_SET } from './write-up-set.ts';

describe('the measurement, against a scripted server', () => {
  it('runs the agent over a ride and books each turn at what the server reported', async () => {
    const server = await startFakeModelServer([
      { kind: 'tool-calls', calls: [{ name: 'goals', arguments: '{}' }] },
      { kind: 'text', text: PASSING_WRITE_UP, usage: { prompt: 1_480, completion: 212 } },
    ]);
    try {
      const result = await measureWriteUps({
        send: sendTo({ kind: 'loopback', origin: server.baseUrl.origin }),
        model: 'scripted',
        rides: WRITE_UP_SET.slice(1, 2),
      });
      expect(server.paths.filter((path) => path.endsWith('/chat/completions'))).toHaveLength(2);
      const [score] = result.scores;
      expect(score).toMatchObject({
        ride: 'ordinary-rolling',
        outcome: 'written',
        turns: 2,
        tools: { goals: 1 },
        promptTokensMost: 1_480,
        // The scripted write-up's "5.2% gradient" is no figure of this ride (its climbs are 5.5).
        unsupportedFigures: 1,
      });
      expect(score?.promptTokensByTurn.at(-1)).toBe(1_480);
      expect(score?.words).toBeGreaterThan(10);
      // The fake server has no `/api/ps`: the context is not known, and not guessed.
      expect(result.contextTokens).toBeUndefined();
      expect(result.template).toStrictEqual({ id: 'ride-write-up-agent', version: '1' });
      // Numbers and closed names only: nothing of the write-up or the prompt.
      const kept = JSON.stringify(result);
      expect(kept).not.toContain('climb took the most effort');
      expect(kept).not.toContain('Goal of');
    } finally {
      await server.close();
    }
  });

  it('reads the loaded context from /api/ps, and counts a turn past it', async () => {
    const turns: string[] = [];
    const send = (url: string): Promise<Response> => {
      turns.push(url);
      if (url.endsWith('/api/ps')) {
        return Promise.resolve(
          Response.json({ models: [{ name: 'm', model: 'm', context_length: 1_100 }] }),
        );
      }
      if (url.endsWith('/api/version'))
        return Promise.resolve(Response.json({ version: '0.40.16' }));
      return Promise.resolve(
        Response.json({
          id: 'x',
          object: 'chat.completion',
          created: 1,
          model: 'm',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: PASSING_WRITE_UP },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 980, completion_tokens: 150, total_tokens: 1_130 },
        }),
      );
    };
    const result = await measureWriteUps({ send, model: 'm', rides: WRITE_UP_SET.slice(3, 4) });
    expect(result.contextTokens).toBe(1_100);
    expect(result.ollama).toBe('0.40.16');
    // 980 read and 1 024 allowed is past 1 100.
    expect(result.scores[0]?.turnsOverContext).toBe(1);
    expect(result.shortfalls).toContain('1 turns passed the loaded context');
    expect(turns[0]).toBe(`${OLLAMA_LOOPBACK}/v1/chat/completions`);
  });

  it('keeps what the server reported per turn, and hands the SDK the same answer', async () => {
    const body = { usage: { prompt_tokens: 12, completion_tokens: 3 }, choices: [] };
    const measuring = measuringFetch(() => Promise.resolve(Response.json(body)));
    const response = await measuring.fetch(`${OLLAMA_LOOPBACK}/v1/chat/completions`, {
      method: 'POST',
      body: JSON.stringify({ max_tokens: 1_024, messages: [{ role: 'user', content: 'ride 42' }] }),
    });
    expect(await response.json()).toStrictEqual(body);
    expect(measuring.turns).toMatchObject([
      { promptTokens: 12, outputTokens: 3, maxOutputTokens: 1_024 },
    ]);
    expect(measuring.lastSent()).toBe('ride 42');
  });
});

describe('where the model may be', () => {
  it('refuses a loopback origin that is not loopback', () => {
    expect(() => sendTo({ kind: 'loopback', origin: 'http://192.168.1.20:11434' })).toThrow(
      /loopback/,
    );
  });

  it('refuses an SSH host the command line would read as an option', () => {
    expect(() => sendTo({ kind: 'ssh', host: '-oProxyCommand=x' })).toThrow(/SSH host/);
    expect(() => sendTo({ kind: 'ssh', host: '' })).toThrow(/SSH host/);
  });

  it('sends nothing over SSH but to Ollama on the far loopback', async () => {
    const send = sendTo({ kind: 'ssh', host: 'nowhere.invalid' });
    await expect(send('http://127.0.0.1:11434/v1/$(id)', { method: 'GET' })).rejects.toThrow(
      /loopback/,
    );
    await expect(send('http://example.com:11434/v1', { method: 'GET' })).rejects.toThrow(
      /loopback/,
    );
  });
});
