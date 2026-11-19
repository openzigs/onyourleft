// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2838: one model call, read: the seed the harness adds, what Ollama's
 * answer comes to, recorded answers given back in order, and the spread of
 * some timings. No test here reaches a model.
 */

import { describe, expect, it } from 'vitest';

import { callFromChat, ollamaAsk, recordedAsk, recording, seeded, spread } from './model-call';

describe('the seed the harness adds to a request', () => {
  it('adds a seed and keeps every other part of the body as it was written', () => {
    const body = { model: 'm', options: { temperature: 0.6, num_predict: 256 }, messages: [1] };
    expect(seeded(body, 11_003)).toEqual({
      model: 'm',
      options: { temperature: 0.6, num_predict: 256, seed: 11_003 },
      messages: [1],
    });
    // The instance's own body is not changed under it.
    expect(body.options).toEqual({ temperature: 0.6, num_predict: 256 });
  });

  it('seeds a body that has no options', () => {
    expect(seeded({ model: 'm' }, 7)).toEqual({ model: 'm', options: { seed: 7 } });
  });
});

describe('what Ollama’s answer came to', () => {
  it('reads the text, the server’s own time and the tokens', () => {
    expect(
      callFromChat(
        {
          message: { content: '{"bots":[]}' },
          total_duration: 3_446_400_000,
          prompt_eval_count: 2_345,
          eval_count: 72,
        },
        9_000,
      ),
    ).toEqual({ text: '{"bots":[]}', latencyMs: 3_446, promptTokens: 2_345, outputTokens: 72 });
  });

  it('books the time waited where the server gives none', () => {
    expect(callFromChat({ message: { content: 'x' } }, 1_234)).toEqual({
      text: 'x',
      latencyMs: 1_234,
      promptTokens: undefined,
      outputTokens: undefined,
    });
  });

  it.each([
    ['an error', { error: 'model not found', message: { content: 'x' } }],
    ['no message', { total_duration: 5 }],
    ['content that is not text', { message: { content: 7 } }],
    ['nothing readable', undefined],
    ['a body that is not an object', 'busy'],
  ])('reads %s as no answer', (_, answer) => {
    expect(callFromChat(answer, 800).text).toBeUndefined();
  });
});

describe('recorded answers', () => {
  it('are given back in order whatever is asked, and none past the last', async () => {
    const ask = recordedAsk([
      { text: 'one', latencyMs: 10 },
      { text: 'two', latencyMs: 20 },
    ]);
    expect(await ask({ any: 'body' })).toEqual({ text: 'one', latencyMs: 10 });
    expect(await ask({})).toEqual({ text: 'two', latencyMs: 20 });
    expect(await ask({})).toEqual({ text: undefined, latencyMs: 0 });
  });

  it('are kept as a run makes them, oldest first', async () => {
    const kept = recording(recordedAsk([{ text: 'one', latencyMs: 10 }]));
    await kept.ask({});
    await kept.ask({});
    expect(kept.calls).toEqual([
      { text: 'one', latencyMs: 10 },
      { text: undefined, latencyMs: 0 },
    ]);
  });
});

describe('the spread of some numbers', () => {
  it('is the nearest-rank middle, ninth decile and most', () => {
    expect(spread([5, 1, 4, 2, 3, 10, 9, 8, 7, 6])).toEqual({ median: 5, p90: 9, most: 10 });
    expect(spread([3])).toEqual({ median: 3, p90: 3, most: 3 });
  });

  it('is nought with none', () => {
    expect(spread([])).toEqual({ median: 0, p90: 0, most: 0 });
  });
});

describe('where a prompt may be sent', () => {
  it('refuses an address that is not loopback, and an SSH host ssh would read as an option', () => {
    expect(() => ollamaAsk({ kind: 'loopback', origin: 'http://models.example:11434' })).toThrow(
      /loopback/u,
    );
    expect(() => ollamaAsk({ kind: 'ssh', host: '-oProxyCommand=x' })).toThrow(/SSH host/u);
    expect(() => ollamaAsk({ kind: 'ssh', host: '' })).toThrow(/SSH host/u);
    expect(typeof ollamaAsk({ kind: 'loopback', origin: 'http://127.0.0.1:11434' })).toBe(
      'function',
    );
  });
});
