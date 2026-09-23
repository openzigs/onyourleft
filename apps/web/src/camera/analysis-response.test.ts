// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the rider's computer said, read as untrusted input — #387, ADR 0029 D-8.
 */

import { describe, expect, it } from 'vitest';

import type { UntrustedText } from './analysis-port';
import {
  answeredReady,
  cleanedDescription,
  MAXIMUM_DESCRIPTION_CHARACTERS,
  MAXIMUM_RESPONSE_BYTES,
  readAnalysisReply,
} from './analysis-response';

function reply(content: unknown, status = 200): ReturnType<typeof readAnalysisReply> {
  return readAnalysisReply({
    status,
    body: JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }),
  });
}

describe('a well-formed answer', () => {
  it('is described', () => {
    expect(reply('ready')).toStrictEqual({ kind: 'described', description: 'ready' });
  });

  it('reads a list of text parts and skips every other part', () => {
    const outcome = reply([
      { type: 'text', text: 'one' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
      { type: 'text', text: 'two' },
    ]);
    expect(outcome).toStrictEqual({ kind: 'described', description: 'one\ntwo' });
  });
});

describe('a status is read before a body, and a server’s own words are dropped', () => {
  it.each([
    [401, 'refused'],
    [403, 'refused'],
    [404, 'not-a-model-server'],
    [405, 'not-a-model-server'],
    [413, 'picture-too-large'],
    [400, 'not-a-model-server'],
    [500, 'failed-on-machine'],
    [503, 'failed-on-machine'],
  ])('%i is %s', (status, failure) => {
    // A body that echoes the request — a picture's data URL — which a
    // careless reader would put in front of the rider.
    const outcome = readAnalysisReply({
      status,
      body: '{"error":"bad image data:image/jpeg;base64,/9j/4AAQ"}',
    });
    expect(outcome).toStrictEqual({ kind: 'failed', failure });
    expect(JSON.stringify(outcome)).not.toContain('base64');
  });
});

describe('the shape is checked, not assumed', () => {
  it.each([
    ['not JSON', 'not-a-model-server', '<html>hello</html>'],
    ['no choices', 'malformed', '{}'],
    ['empty choices', 'malformed', '{"choices":[]}'],
    ['a null choice', 'malformed', '{"choices":[null]}'],
    ['no message', 'malformed', '{"choices":[{}]}'],
    ['a number for content', 'malformed', '{"choices":[{"message":{"content":42}}]}'],
    ['an object for content', 'malformed', '{"choices":[{"message":{"content":{"a":1}}}]}'],
    ['only an image part', 'malformed', '{"choices":[{"message":{"content":[{"type":"image"}]}}]}'],
    ['a non-object part', 'malformed', '{"choices":[{"message":{"content":["x"]}}]}'],
    ['empty text', 'malformed', '{"choices":[{"message":{"content":"   "}}]}'],
    ['a JSON null', 'malformed', 'null'],
  ])('%s is %s', (_name, failure, body) => {
    expect(readAnalysisReply({ status: 200, body })).toStrictEqual({ kind: 'failed', failure });
  });

  it('never looks at a tool call a server volunteers', () => {
    const outcome = readAnalysisReply({
      status: 200,
      body: JSON.stringify({
        choices: [
          {
            message: {
              content: 'ready',
              tool_calls: [{ function: { name: 'setTargetPower', arguments: '{"watts":2000}' } }],
            },
          },
        ],
      }),
    });
    // What comes out is the text and nothing else: no field that could carry
    // the call anywhere.
    expect(outcome).toStrictEqual({ kind: 'described', description: 'ready' });
  });
});

describe('the answer is bounded', () => {
  it('refuses a body longer than the byte bound, before parsing it', () => {
    const body = JSON.stringify({ choices: [{ message: { content: 'x'.repeat(100) } }] }).padEnd(
      MAXIMUM_RESPONSE_BYTES + 1,
      ' ',
    );
    expect(readAnalysisReply({ status: 200, body })).toStrictEqual({
      kind: 'failed',
      failure: 'too-large',
    });
  });

  it('refuses a description longer than the character bound, rather than cutting it', () => {
    expect(reply('y'.repeat(MAXIMUM_DESCRIPTION_CHARACTERS + 1))).toStrictEqual({
      kind: 'failed',
      failure: 'too-large',
    });
    expect(reply('y'.repeat(MAXIMUM_DESCRIPTION_CHARACTERS)).kind).toBe('described');
  });
});

describe('the text is cleaned', () => {
  it('removes control characters and the bidirectional overrides, keeping lines', () => {
    const cleaned = cleanedDescription('a\u0000b\u001bc\u202Ed\u2066e\nf\tg\u0085h');
    expect(cleaned).toBe('abcde\nf\tgh');
  });

  it('normalises, so two spellings of one word are one word', () => {
    expect(cleanedDescription('cafe\u0301')).toBe('café');
  });

  it('reads nothing left as nothing', () => {
    expect(cleanedDescription('\u202E\u0000 ')).toBeUndefined();
  });
});

describe('whether a connection check was understood', () => {
  it.each(['ready', 'Ready.', ' READY! ', '"ready"'])('%s is understood', (text) => {
    expect(answeredReady(text as UntrustedText)).toBe(true);
  });

  it.each(['not ready', 'I see a person on a bicycle', 'readyready', ''])('%s is not', (text) => {
    expect(answeredReady(text as UntrustedText)).toBe(false);
  });
});

describe('UntrustedText is made in one place', () => {
  it('is not a type a plain string can be assigned to', () => {
    // §5's compile-time mutation: remove the brand from `UntrustedText` and
    // this directive is unused, which is `TS2578` and a red typecheck.
    // @ts-expect-error — only `analysis-response.ts` turns a string into one
    const forged: UntrustedText = 'anything a server said';
    expect(forged).toBe('anything a server said');
  });
});
