// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A test double of the part of Discord's REST API the voice bot uses (#874):
 * one server, its channels and their invites, held as state — so a test reads
 * back what Discord would hold rather than what the bot said it sent. Test
 * support, never shipped.
 *
 * It answers `401` to any request without `Authorization: Bot <its token>`,
 * keeps every request it was sent, and fails a request on demand with a
 * status, a thrown error, or a body that will not parse.
 */

import { DISCORD_API } from './discord.ts';

/**
 * A fake bot token: three dotted parts, as Discord's are, but deliberately NOT
 * Discord's shape (which starts `M` or `N`), so secret scanning has nothing to
 * flag in a fixture.
 */
export const TEST_BOT_TOKEN = 'test-bot-token.not-real.oyl-874-fixture-0123456789';

/** The server the double holds. */
export const TEST_GUILD_ID = '100000000000000001';

export interface FakeChannel {
  readonly id: string;
  readonly name: string;
  readonly type: number;
  readonly user_limit?: number;
  readonly parent_id?: string | null;
  readonly topic?: string | null;
}

export interface FakeInvite {
  readonly code: string;
  readonly channelId: string;
  readonly max_age: unknown;
  readonly max_uses: unknown;
  readonly temporary: unknown;
  readonly unique: unknown;
}

export interface SentRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly redirect: RequestInit['redirect'];
}

/** How the next matching request is failed. */
export type Failure =
  | { readonly status: number; readonly body?: unknown; readonly headers?: Record<string, string> }
  | { readonly throws: Error }
  | { readonly unparsable: true };

export interface FakeDiscord {
  readonly fetch: typeof globalThis.fetch;
  readonly channels: Map<string, FakeChannel>;
  readonly invites: Map<string, FakeInvite>;
  readonly requests: SentRequest[];
  /** The server's features: `MEMBER_VERIFICATION_GATE_ENABLED` is Membership Screening. */
  features: string[];
  /** Fails the next request whose `METHOD path` matches `pattern`, once per call of this. */
  failNext(pattern: RegExp, failure: Failure): void;
  /** Adds a channel as though somebody — the operator, or an earlier run — made it. */
  addChannel(channel: Omit<FakeChannel, 'id'>): FakeChannel;
  /** The voice channels whose name starts `oyl-ride-`. */
  ourChannels(): FakeChannel[];
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

export function fakeDiscord(token = TEST_BOT_TOKEN, guildId = TEST_GUILD_ID): FakeDiscord {
  const channels = new Map<string, FakeChannel>();
  const invites = new Map<string, FakeInvite>();
  const requests: SentRequest[] = [];
  const failures: { pattern: RegExp; failure: Failure }[] = [];
  let nextId = 200_000_000_000_000_000n;
  let nextInvite = 0;
  const newId = (): string => {
    nextId += 1n;
    return nextId.toString();
  };

  const double: FakeDiscord = {
    channels,
    invites,
    requests,
    features: [],
    failNext(pattern, failure) {
      failures.push({ pattern, failure });
    },
    addChannel(channel) {
      const made = { ...channel, id: newId() };
      channels.set(made.id, made);
      return made;
    },
    ourChannels: () =>
      [...channels.values()].filter((each) => each.type === 2 && each.name.startsWith('oyl-ride-')),
    fetch: ((input: string | URL, init?: RequestInit): Promise<Response> => {
      const answered = answer(input, init);
      return answered instanceof Error ? Promise.reject(answered) : Promise.resolve(answered);
    }) as typeof globalThis.fetch,
  };

  /** What Discord would answer to one request, or the error its `fetch` would reject with. */
  function answer(input: string | URL, init?: RequestInit): Response | Error {
    const url = input.toString();
    if (!url.startsWith(DISCORD_API)) return new TypeError('the double answers Discord only');
    const path = url.slice(DISCORD_API.length);
    const method = init?.method ?? 'GET';
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ method, path, headers, body, redirect: init?.redirect });

    const line = `${method} ${path}`;
    const index = failures.findIndex((each) => each.pattern.test(line));
    if (index >= 0) {
      const { failure } = failures.splice(index, 1)[0] as { failure: Failure };
      if ('throws' in failure) return failure.throws;
      if ('unparsable' in failure) return new Response('<html>not json', { status: 200 });
      return json(failure.status, failure.body ?? { message: 'failed' }, failure.headers);
    }
    if (headers.authorization !== `Bot ${token}`)
      return json(401, { message: '401: Unauthorized' });

    let match: RegExpExecArray | null;
    if (method === 'GET' && path === `/guilds/${guildId}`) {
      return json(200, { id: guildId, features: double.features });
    }
    if (method === 'GET' && path === `/guilds/${guildId}/channels`) {
      return json(200, [...channels.values()]);
    }
    if (method === 'POST' && path === `/guilds/${guildId}/channels`) {
      const asked = body as { name: string; type: number; user_limit?: number };
      const made: FakeChannel = { ...asked, id: newId() };
      channels.set(made.id, made);
      return json(201, made);
    }
    if ((match = /^\/channels\/([0-9]+)\/invites$/.exec(path)) !== null) {
      const channelId = match[1] as string;
      if (!channels.has(channelId)) return json(404, { message: 'Unknown Channel' });
      if (method === 'GET') {
        return json(
          200,
          [...invites.values()].filter((each) => each.channelId === channelId),
        );
      }
      nextInvite += 1;
      const asked = body as Record<string, unknown>;
      const invite: FakeInvite = {
        code: `inv${String(nextInvite)}abc`,
        channelId,
        max_age: asked.max_age,
        max_uses: asked.max_uses,
        temporary: asked.temporary,
        unique: asked.unique,
      };
      invites.set(invite.code, invite);
      return json(200, { code: invite.code });
    }
    if (method === 'DELETE' && (match = /^\/invites\/([A-Za-z0-9-]+)$/.exec(path)) !== null) {
      const code = match[1] as string;
      if (!invites.delete(code)) return json(404, { message: 'Unknown Invite' });
      return json(200, { code });
    }
    if (method === 'DELETE' && (match = /^\/channels\/([0-9]+)$/.exec(path)) !== null) {
      const channelId = match[1] as string;
      const channel = channels.get(channelId);
      if (channel === undefined) return json(404, { message: 'Unknown Channel' });
      channels.delete(channelId);
      return json(200, channel);
    }
    return json(404, { message: 'the double does not know this route' });
  }
  return double;
}
