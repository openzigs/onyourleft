// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The owner's tool check (#2610), against the fake OpenAI-compatible model
 * server, through `model.ts` as a job's turns go. The route over it — who may
 * call it, and its operator log entry — is
 * `operate/analysis-models-route.test.ts`'s.
 *
 * Time is an injected clock, never a slow stub: the out-of-time case moves
 * the clock past the budget between the turns.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { Resolver } from '../history/address.ts';
import { TOOL_CHECK_MILLISECONDS, TOOL_CHECK_OUTPUT_TOKENS } from './agent.ts';
import {
  startFakeModelServer,
  WITHOUT_TOOLS_REPLY,
  type FakeModelServer,
  type ScriptedReply,
} from './fake-model-server-testing.ts';
import { createLocalModel } from './model.ts';
import {
  createToolCheck,
  TOOL_CHECK_QUESTION,
  TOOL_CHECK_SYSTEM,
  TOOL_CHECK_TOOL,
  type ToolCheckOptions,
} from './tool-check.ts';

let server: FakeModelServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const loopback = (): Promise<readonly string[]> => Promise.resolve(['127.0.0.1']);

const CALLS_THE_TOOL: ScriptedReply = {
  kind: 'tool-calls',
  calls: [{ name: 'fixed_number', arguments: '{}' }],
};
const ANSWERS: ScriptedReply = { kind: 'text', text: 'The number is 42.' };

async function serving(script: readonly ScriptedReply[]): Promise<URL> {
  server = await startFakeModelServer(script);
  return new URL(`http://models-box:${server.baseUrl.port}/v1`);
}

/** The check's options, its connection `model.ts`'s as the instance builds it. */
const options = (
  extra: Partial<Omit<ToolCheckOptions, 'connect'>> & {
    readonly resolve?: Resolver;
    readonly fetch?: typeof globalThis.fetch;
  } = {},
): ToolCheckOptions => {
  const { resolve = loopback, fetch, ...rest } = extra;
  return {
    connect: (settings) =>
      createLocalModel({ settings, resolve, ...(fetch === undefined ? {} : { fetch }) }),
    now: () => 1_790_000_000_000,
    ...rest,
  };
};

describe('the tool check’s outcomes (#2610, ADR 0046 D-7)', () => {
  it('is tools-ok when the model calls the tool and then answers', async () => {
    const baseUrl = await serving([CALLS_THE_TOOL, ANSWERS]);
    expect(await createToolCheck(options()).run({ baseUrl, model: 'alpha:14b' })).toBe('tools-ok');
    expect(server?.requests).toHaveLength(2);
  });

  it('sends nothing but the fixed instruction, the fixed question, the one tool and its fixed answer', async () => {
    const baseUrl = await serving([CALLS_THE_TOOL, ANSWERS]);
    await createToolCheck(options()).run({ baseUrl, model: 'alpha:14b', reasoningTokens: 512 });
    const [first, second] = server?.requests ?? [];
    const tools = [
      {
        type: 'function',
        function: {
          name: TOOL_CHECK_TOOL.name,
          description: TOOL_CHECK_TOOL.description,
          parameters: TOOL_CHECK_TOOL.parameters,
        },
      },
    ];
    expect(first).toEqual({
      model: 'alpha:14b',
      max_tokens: TOOL_CHECK_OUTPUT_TOKENS + 512,
      messages: [
        { role: 'system', content: TOOL_CHECK_SYSTEM },
        { role: 'user', content: TOOL_CHECK_QUESTION },
      ],
      tools,
      tool_choice: 'auto',
    });
    expect(second).toEqual({
      model: 'alpha:14b',
      max_tokens: TOOL_CHECK_OUTPUT_TOKENS + 512,
      messages: [
        { role: 'system', content: TOOL_CHECK_SYSTEM },
        { role: 'user', content: TOOL_CHECK_QUESTION },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1_0',
              type: 'function',
              function: { name: 'fixed_number', arguments: '{}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1_0', content: '42' },
      ],
      tools,
      tool_choice: 'auto',
    });
  });

  it('is no-tool-call when the model answers without calling it', async () => {
    const baseUrl = await serving([ANSWERS]);
    expect(await createToolCheck(options()).run({ baseUrl, model: 'm' })).toBe('no-tool-call');
    expect(server?.requests).toHaveLength(1);
  });

  it('is no-tool-call when the model calls some other tool', async () => {
    const baseUrl = await serving([
      { kind: 'tool-calls', calls: [{ name: 'set_resistance', arguments: '{}' }] },
    ]);
    expect(await createToolCheck(options()).run({ baseUrl, model: 'm' })).toBe('no-tool-call');
  });

  it('is no-tool-call when the model calls it and then says nothing', async () => {
    const baseUrl = await serving([CALLS_THE_TOOL, { kind: 'text', text: '  ' }]);
    expect(await createToolCheck(options()).run({ baseUrl, model: 'm' })).toBe('no-tool-call');
  });

  it('is does-not-support-tools when the server says so', async () => {
    const baseUrl = await serving([WITHOUT_TOOLS_REPLY]);
    expect(await createToolCheck(options()).run({ baseUrl, model: 'm' })).toBe(
      'does-not-support-tools',
    );
  });

  it('is server-error for a 5xx, on either turn', async () => {
    const failing: ScriptedReply = { kind: 'status', status: 500, body: '{}' };
    const baseUrl = await serving([failing]);
    expect(await createToolCheck(options()).run({ baseUrl, model: 'm' })).toBe('server-error');
    await server?.close();
    const again = await serving([CALLS_THE_TOOL, failing]);
    expect(await createToolCheck(options()).run({ baseUrl: again, model: 'm' })).toBe(
      'server-error',
    );
  });

  it('is not-local, sending nothing, when the name resolves outside the local ranges', async () => {
    const baseUrl = await serving([CALLS_THE_TOOL, ANSWERS]);
    const check = createToolCheck(options({ resolve: () => Promise.resolve(['8.8.8.8']) }));
    expect(await check.run({ baseUrl, model: 'm' })).toBe('not-local');
    expect(server?.requests).toEqual([]);
  });
});

describe('the tool check’s bounds (#2610)', () => {
  it('is out-of-time, and sends no second turn, once its budget has passed by the clock', async () => {
    const baseUrl = await serving([CALLS_THE_TOOL, ANSWERS]);
    const clock = { ms: 1_790_000_000_000 };
    const send = globalThis.fetch.bind(globalThis);
    // The clock moves, not the stub: the first answer arrives as the budget runs out.
    let sent = 0;
    const moving: typeof globalThis.fetch = async (input, init) => {
      sent += 1;
      const answer = await send(input, init);
      clock.ms += TOOL_CHECK_MILLISECONDS;
      return answer;
    };
    const check = createToolCheck(options({ now: () => clock.ms, fetch: moving }));
    expect(await check.run({ baseUrl, model: 'm' })).toBe('out-of-time');
    // Not sent and cut short: never sent at all.
    expect(sent).toBe(1);
    expect(server?.requests).toHaveLength(1);
  });

  it('refuses a second check while one is out, busy, sending nothing for it', async () => {
    const baseUrl = await serving([CALLS_THE_TOOL, ANSWERS, CALLS_THE_TOOL, ANSWERS]);
    const send = globalThis.fetch.bind(globalThis);
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    let first = true;
    const held: typeof globalThis.fetch = async (input, init) => {
      if (first) {
        first = false;
        await gate;
      }
      return send(input, init);
    };
    const check = createToolCheck(options({ fetch: held }));
    const out = check.run({ baseUrl, model: 'm' });
    expect(await check.run({ baseUrl, model: 'other' })).toBe('busy');
    open();
    expect(await out).toBe('tools-ok');
    expect(server?.requests.map((request) => request.model)).toEqual(['m', 'm']);
    // Once it is over, the next check runs.
    expect(await check.run({ baseUrl, model: 'm' })).toBe('tools-ok');
  });

  it('ends a check that is out when the instance stops, and runs none after', async () => {
    const baseUrl = await serving([CALLS_THE_TOOL, ANSWERS]);
    const stopping = new AbortController();
    const send = globalThis.fetch.bind(globalThis);
    const stopsMidway: typeof globalThis.fetch = async (input, init) => {
      stopping.abort();
      return send(input, init);
    };
    const check = createToolCheck(options({ fetch: stopsMidway, stopped: stopping.signal }));
    expect(await check.run({ baseUrl, model: 'm' })).toBe('stopped');
    expect(await check.run({ baseUrl, model: 'm' })).toBe('stopped');
  });
});
