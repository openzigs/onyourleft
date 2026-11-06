// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The instance's one way to Discord's API** — #874, from spike 0017 §3 and
 * spike 0018 §5.2 and §7, after the owner chose option A on #794.
 *
 * A handful of REST requests over the platform's own `fetch`, and **no
 * dependency**: spike 0017 §3.4 read the libraries and found six calls not
 * worth a dependency tree, and the manifest keeps "nothing but Node itself"
 * for this. No gateway connection either (0017 §3.2): the instance knows when
 * a room closes, so it never has to watch a channel empty.
 *
 * ## The bot token is a secret — 0017 §3.5
 *
 * It travels in the `Authorization: Bot …` header of a request to
 * {@link DISCORD_API} and nowhere else. A request that throws, or an answer
 * that will not parse, becomes {@link DiscordAnswer} `failed` carrying the
 * error's **name** alone, as `log.ts` logs an inbound exception: an error's
 * message is written by whatever threw it, and a message is where a token
 * would leak. Nothing here keeps an `Error`, and nothing here logs.
 * Redirects are refused, so the header is never replayed to another host.
 *
 * ## Rate limits are a term of the licence — spike 0018 §5.2, §7 items 6 and 7
 *
 * Discord's Developer Terms §2(b)(iv) make exceeding a limit a breach, and the
 * limits are deliberately not published per route, so none is hard-coded:
 *
 * - **a bucket that answered `X-RateLimit-Remaining: 0`** is waited out, by
 *   its `X-RateLimit-Reset-After`, before the next request on the same route;
 * - **a `429`** is retried after its `retry_after` (or `Retry-After`) —
 *   globally when it says it is global — at most {@link MAXIMUM_ATTEMPTS}
 *   times, and never after a wait longer than {@link MAXIMUM_WAIT_MS};
 * - **a `401` turns the client off for good** ({@link DiscordClient.off}):
 *   a token unused for 30 days may be suspended (Terms §9(a)), and every
 *   `401`, `403` and `429` counts toward a per-IP ban of 10 000 in ten minutes
 *   — on a home connection, the whole house's address. Nothing is sent after it;
 * - **a `403`, a `404` or a `5xx` is never retried.**
 */

/** Discord's REST API, version 10. */
export const DISCORD_API = 'https://discord.com/api/v10';

/** How many times one request is sent, the first included, while Discord answers `429`. */
export const MAXIMUM_ATTEMPTS = 3;

/**
 * The longest this client waits for a bucket or a `429` before giving up on
 * the request: a minute. ⚠️ The author's number — patience, not a Discord
 * limit. A room asks for voice as a rider is let in, and a rider is not kept
 * waiting longer than this for a link they may never press.
 */
export const MAXIMUM_WAIT_MS = 60_000;

/** How long one request may take before it is abandoned: ten seconds. The author's number. */
export const REQUEST_TIMEOUT_MS = 10_000;

/** What the operator configured: their own bot's token and their own server (spike 0018 §3). */
export interface DiscordSettings {
  readonly botToken: string;
  readonly guildId: string;
}

/**
 * Discord's answer to one request.
 *
 * - `ok` — a `2xx`, with its parsed body (`undefined` for a `204`);
 * - `refused` — any other status that is not a `401`: a `403`, a `404`, a
 *   `5xx`, or a `429` that outlasted {@link MAXIMUM_ATTEMPTS} or
 *   {@link MAXIMUM_WAIT_MS};
 * - `off` — the token was refused, by this request or an earlier one;
 * - `failed` — the request threw, or its body would not parse. `error` is the
 *   error's name, or `unknown`: never its message.
 */
export type DiscordAnswer =
  | { readonly kind: 'ok'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'refused'; readonly status: number }
  | { readonly kind: 'off' }
  | { readonly kind: 'failed'; readonly error: string };

export interface DiscordClient {
  /**
   * One request. `route` names its rate-limit bucket — the method and the
   * path with its ids left out, `POST /channels/:id/invites` — because a
   * bucket is not known until Discord has answered once.
   */
  request(route: string, method: string, path: string, body?: unknown): Promise<DiscordAnswer>;
  /** Whether a `401` turned the client off: nothing is sent once it is. */
  readonly off: boolean;
  readonly guildId: string;
}

export interface DiscordClientOptions {
  readonly settings: DiscordSettings;
  /** The instance's version, for the `User-Agent` Discord requires of a bot. */
  readonly version: string;
  /** The platform's `fetch` unless a test's. */
  readonly fetch?: typeof globalThis.fetch;
  /** Unix milliseconds. */
  readonly now?: () => number;
  /** Waits `ms`: a timer unless a test's. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** An error's name when it is a plain word, or `unknown` — never its message. */
export function errorName(error: unknown): string {
  return error instanceof Error && /^[A-Za-z]{1,64}$/.test(error.name) ? error.name : 'unknown';
}

/** Seconds as Discord writes them (`"1.5"`, `0.25`), in milliseconds, or `undefined`. */
function seconds(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0
    ? Math.ceil(parsed * 1000)
    : undefined;
}

export function createDiscordClient(options: DiscordClientOptions): DiscordClient {
  const { settings } = options;
  const send = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => Date.now());
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const headers = {
    Authorization: `Bot ${settings.botToken}`,
    'User-Agent': `DiscordBot (https://github.com/openzigs/onyourleft, ${options.version})`,
  };
  /** When each route's bucket may be asked again, Unix milliseconds. */
  const resumeAt = new Map<string, number>();
  let globalResumeAt = 0;
  let off = false;

  async function request(
    route: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<DiscordAnswer> {
    for (let attempt = 1; ; attempt += 1) {
      if (off) return { kind: 'off' };
      const wait = Math.max(resumeAt.get(route) ?? 0, globalResumeAt) - now();
      if (wait > MAXIMUM_WAIT_MS) return { kind: 'refused', status: 429 };
      if (wait > 0) await sleep(wait);
      if (off) return { kind: 'off' };
      let response: Response;
      try {
        response = await send(`${DISCORD_API}${path}`, {
          method,
          headers:
            body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          redirect: 'error',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        return { kind: 'failed', error: errorName(error) };
      }
      const remaining = response.headers.get('X-RateLimit-Remaining');
      const resetAfter = seconds(response.headers.get('X-RateLimit-Reset-After'));
      if (remaining === '0' && resetAfter !== undefined) resumeAt.set(route, now() + resetAfter);

      if (response.status === 401) {
        off = true;
        return { kind: 'off' };
      }
      if (response.status === 429) {
        let said: { retry_after?: unknown; global?: unknown } = {};
        try {
          said = (await response.json()) as typeof said;
        } catch {
          said = {};
        }
        const after =
          seconds(said.retry_after) ?? seconds(response.headers.get('Retry-After')) ?? 1000;
        const global = said.global === true || response.headers.get('X-RateLimit-Global') !== null;
        if (global) globalResumeAt = now() + after;
        else resumeAt.set(route, now() + after);
        if (attempt >= MAXIMUM_ATTEMPTS || after > MAXIMUM_WAIT_MS) {
          return { kind: 'refused', status: 429 };
        }
        continue;
      }
      if (response.status < 200 || response.status > 299) {
        return { kind: 'refused', status: response.status };
      }
      if (response.status === 204) return { kind: 'ok', status: 204, body: undefined };
      try {
        const parsed: unknown = await response.json();
        return { kind: 'ok', status: response.status, body: parsed };
      } catch (error) {
        return { kind: 'failed', error: errorName(error) };
      }
    }
  }

  return {
    request,
    get off() {
      return off;
    },
    guildId: settings.guildId,
  };
}
