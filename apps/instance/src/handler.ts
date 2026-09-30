// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Caller, Identity } from './auth/identity.ts';
import type { Config } from './config.ts';
import { errorResponse } from './errors.ts';
import { logRequest, logUnhandled, type LogSink } from './log.ts';
import { openApiDocument } from './openapi.ts';
import type { ClientInfo, InstanceProbes } from './route-kit.ts';
import type { History } from './history/history.ts';
import type { Rooms } from './rooms/rooms.ts';
import type { Sync } from './sync/sync.ts';
import { ROUTES, type Route } from './routes.ts';

/**
 * The instance, as ONE fetch-style function: `Request → Response` (#767,
 * ADR 0037 D-2).
 *
 * Nothing here names Node. `node-listener.ts` is the thin adapter that turns a
 * Node HTTP request into a `Request` and a `Response` back into bytes, and a
 * Durable Object (#781) or any other runtime that speaks WHATWG fetch mounts
 * this same function unchanged. `handler.test.ts` runs a request through each
 * adapter that exists.
 *
 * ## The order a request is answered in
 *
 * 1. **The body's size**, before anything else reads it. A request that
 *    declares more than the limit is refused on its `content-length`; one that
 *    declares nothing is read up to the limit and refused at the first byte
 *    past it — never buffered whole first. So a stranger cannot make the
 *    instance hold an unbounded upload in memory by leaving the header off.
 * 2. **The route**, by path: none is `not_found`; a path with no route for the
 *    method is `method_not_allowed` with an `Allow` header. A `{name}` segment
 *    matches one segment of letters, digits, `_` and `-`, and nothing else —
 *    so a value the route reads from `params` is never a path or a query.
 * 3. **What the route declares it needs** (#772): the instance's accounts
 *    (`unavailable` when this instance was given none), a signed-in session
 *    (`unauthenticated`, with `WWW-Authenticate: Bearer`) — one that is not
 *    awaiting approval unless the route `admitsPending` (#775,
 *    `registration_pending`), and not a suspended athlete's way-out session
 *    unless the route `admitsSuspended` (#898, `account_suspended`) — and a
 *    JSON object body (`validation_failed`).
 * 4. **Whom the route reaches** (#83) — THE choke point. A route that names
 *    another athlete in its path is called only when `moderation.ts`
 *    §`canSee` says the caller may see them; otherwise the answer is
 *    `not_found`, byte for byte what an athlete who does not exist gets, and
 *    it comes BEFORE the body is looked at, so not even a malformed request
 *    can tell the two apart. A moderators' route is `not_found` to everybody
 *    else. No route checks a block for itself.
 * 5. **The route's own answer**, and anything it throws is `internal` in the
 *    one error shape — no message, no stack, no path (#36, ADR 0004 D) — while
 *    the log gets the error's name alone (`log.ts`).
 *
 * ## A rider's app is on another origin — #777
 *
 * The app a rider connects from is served from its own origin (a web host, or
 * `https://localhost` inside the Android shell), never from the instance's, so
 * every call it makes is cross-origin and a browser refuses to hand it the
 * answer unless the instance says it may. So:
 *
 * - **Every response carries `Access-Control-Allow-Origin: *`**, errors
 *   included, so a refusal reaches the app as the refusal rather than as a
 *   network error the rider cannot act on.
 * - **An `OPTIONS` preflight to a path a route serves is `204`**, naming that
 *   path's methods and the two request headers the app sends
 *   (`authorization`, `content-type`). An `OPTIONS` to no route is `not_found`,
 *   as any other method there is.
 *
 * ⚠️ **`*` and not a list of origins, and that is safe here because nothing
 * rides on ambient authority**: the instance sets no cookie and reads none,
 * and a session is a bearer token the app puts in `Authorization` itself, so a
 * page on another origin that calls the instance holds exactly what it could
 * send with `curl`. `Access-Control-Allow-Credentials` is therefore never
 * sent, and must not be — with it, `*` is refused by browsers, and a list of
 * origins that did carry credentials would be a different threat model.
 *
 * **A preflight reaches nobody** (#891's choke point, step 4): it calls no
 * route and reads no store, and its answer depends on the PATH's shape alone
 * — the same `204` for an athlete who exists, one who blocked the caller and
 * one who does not, and for a moderators' route the same list of methods a
 * `method_not_allowed` there already names to anybody. A browser sends no
 * `Authorization` on a preflight, so there is no caller to ask the choke point
 * about; the real request that follows is asked, as every request is.
 */

export type Handler = (request: Request, client?: ClientInfo) => Promise<Response>;

export interface HandlerOptions {
  readonly config: Config;
  readonly version: string;
  readonly notices: string;
  readonly log: LogSink;
  /** The route table. The production one unless a test hands its own. */
  readonly routes?: readonly Route[];
  /** Milliseconds, for the log's duration. */
  readonly now?: () => number;
  /**
   * The instance's accounts (#772). Absent, every route that needs them
   * answers `unavailable`: the Node entry point does not open a database yet
   * (the self-hosted box's wiring is #780's), so it serves the metadata alone.
   */
  readonly identity?: Identity;
  /** What `/ready`, `/metrics` and a room's start ask (#780, #791). */
  readonly probes?: InstanceProbes;
  /**
   * Called as each response goes out: the route PATTERN it matched (or
   * `null`), its status, and its error code when it is an error — what
   * `/metrics` counts (`metrics.ts`). Never the path, never a value.
   */
  readonly observe?: (route: string | null, status: number, code: string | undefined) => void;
  /**
   * Sync (#37, #776): the store and the blobs a device syncs through. Absent,
   * every route that needs it answers `unavailable`, as for identity.
   */
  readonly sync?: Sync;
  /**
   * The history index (#835, ADR 0040). Absent, every route that needs it
   * answers `unavailable`, and a device's analysis runs without history.
   */
  readonly history?: History;
  /**
   * Riders' rooms (#784, #785). Absent, every route that needs them answers
   * `unavailable`: an instance with no accounts has no rooms to make.
   */
  readonly rooms?: Rooms;
}

/** A path parameter's value: one segment, of these characters only. */
const PARAMETER = /^[A-Za-z0-9_-]{1,128}$/;

/** The route's `{name}` values when `pathname` matches its pattern, or `undefined`. */
export function matchPath(pattern: string, pathname: string): Record<string, string> | undefined {
  const want = pattern.split('/');
  const have = pathname.split('/');
  if (want.length !== have.length) return undefined;
  const params: Record<string, string> = {};
  for (const [index, segment] of want.entries()) {
    const value = have[index] as string;
    const name = /^\{([A-Za-z]+)\}$/.exec(segment)?.[1];
    if (name === undefined) {
      if (segment !== value) return undefined;
    } else {
      if (!PARAMETER.test(value)) return undefined;
      params[name] = value;
    }
  }
  return params;
}

/**
 * The body as a JSON object, or `undefined` when it is not one. No body at all
 * — none, or none of length — is the empty object: a `DELETE` sent with
 * nothing is then told what the route wants (#898's step-up), not that
 * nothing is not JSON.
 */
function jsonObject(body: Uint8Array | null): Record<string, unknown> | undefined {
  if (body === null || body.byteLength === 0) return {};
  try {
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Headers every response carries, whatever produced it. */
const ALWAYS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  // #777: a rider's app is on another origin. See the header.
  'access-control-allow-origin': '*',
};

/** The request headers a rider's app sends, which a preflight must allow. */
const PREFLIGHT_HEADERS = 'authorization, content-type';

/** How long a browser may keep a preflight's answer, in seconds. */
const PREFLIGHT_MAX_AGE_SECONDS = 600;

/** Past the limit: the request is refused rather than read further. */
const TOO_LARGE = Symbol('too large');

/**
 * The body's bytes, reading at most `limit + 1` of them, or {@link TOO_LARGE}.
 * `null` when the request has no body.
 */
async function boundedBody(
  request: Request,
  limit: number,
): Promise<Uint8Array | null | typeof TOO_LARGE> {
  const declared = request.headers.get('content-length');
  if (declared !== null && /^[0-9]+$/.test(declared) && Number(declared) > limit) return TOO_LARGE;
  if (request.body === null) return null;
  // `@types/node` types a request body as `ReadableStream<any>`; a WHATWG body is bytes.
  const reader = (request.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let read = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value.byteLength;
      if (read > limit) return TOO_LARGE;
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const body = new Uint8Array(read);
  let at = 0;
  for (const chunk of chunks) {
    body.set(chunk, at);
    at += chunk.byteLength;
  }
  return body;
}

/** An error response's `error.code`, read from a copy of its body; `undefined` for anything else. */
async function errorCodeOf(response: Response): Promise<string | undefined> {
  if (response.status < 400) return undefined;
  if (!(response.headers.get('content-type') ?? '').startsWith('application/json'))
    return undefined;
  try {
    const body = (await response.clone().json()) as { error?: { code?: unknown } };
    return typeof body.error?.code === 'string' ? body.error.code : undefined;
  } catch {
    return undefined;
  }
}

function withHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(ALWAYS)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createHandler(options: HandlerOptions): Handler {
  const routes = options.routes ?? ROUTES;
  const now = options.now ?? (() => performance.now());
  const specification = openApiDocument(routes);

  /** Step 4: whether the caller may reach whom the route reaches. */
  async function reachable(
    matched: Route,
    params: Record<string, string>,
    caller: Caller | undefined,
  ): Promise<boolean> {
    const reach = matched.reaches;
    if (reach === 'own') return true;
    if (typeof reach === 'object' && 'exempt' in reach) return true;
    const moderation = options.identity?.moderation;
    if (caller === undefined || moderation === undefined) return false;
    if (reach === 'moderation') return (await moderation.roleOf(caller.athleteId)) !== undefined;
    const subject = params[reach.athlete];
    return subject !== undefined && (await moderation.canSee(caller.athleteId, subject));
  }

  async function answer(
    matched: Route,
    params: Record<string, string>,
    request: Request,
    url: URL,
    body: Uint8Array | null,
    client: ClientInfo,
  ): Promise<Response> {
    const identity = options.identity;
    if (matched.identity === true && identity === undefined) return errorResponse('unavailable');
    if (matched.sync === true && options.sync === undefined) return errorResponse('unavailable');
    if (matched.history === true && options.history === undefined) {
      return errorResponse('unavailable');
    }
    if (matched.rooms === true && options.rooms === undefined) return errorResponse('unavailable');
    let caller: Caller | undefined;
    if (matched.auth === 'session') {
      caller = await identity?.authenticate(request.headers.get('authorization'));
      if (caller === undefined) {
        return errorResponse('unauthenticated', { headers: { 'www-authenticate': 'Bearer' } });
      }
      // An athlete awaiting approval reaches their own account and nothing
      // else (#775): not other riders, not rooms, not reports.
      if (caller.standing === 'pending' && matched.admitsPending !== true) {
        return errorResponse('registration_pending');
      }
      // A suspended athlete's way-out session (#898) reaches the account
      // export and deletion, and nothing else: not even their own profile.
      if (caller.standing === 'suspended' && matched.admitsSuspended !== true) {
        return errorResponse('account_suspended');
      }
    }
    if (!(await reachable(matched, params, caller))) return errorResponse('not_found');
    const parsed = matched.request === undefined ? {} : jsonObject(body);
    if (parsed === undefined) {
      return errorResponse('validation_failed', {
        fields: [{ field: 'body', problem: 'must be a JSON object' }],
      });
    }
    return matched.handle({
      request,
      url,
      body,
      json: parsed,
      params,
      client,
      config: options.config,
      version: options.version,
      notices: options.notices,
      specification,
      identity,
      caller,
      sync: options.sync,
      history: options.history,
      rooms: options.rooms,
      probes: options.probes,
    });
  }

  return async (request, client = { address: null }) => {
    const started = now();
    let route: Route | undefined;
    let response: Response;
    try {
      const url = new URL(request.url);
      const body = await boundedBody(request, options.config.bodyLimitBytes);
      if (body === TOO_LARGE) {
        response = errorResponse('payload_too_large');
      } else {
        const atPath = routes.flatMap((candidate) => {
          const params = matchPath(candidate.path, url.pathname);
          return params === undefined ? [] : [{ candidate, params }];
        });
        const found = atPath.find(({ candidate }) => candidate.method === request.method);
        route = found?.candidate;
        if (found === undefined && request.method === 'OPTIONS' && atPath.length > 0) {
          // #777: a CORS preflight. The header says why this is safe.
          response = new Response(null, {
            status: 204,
            headers: {
              'access-control-allow-methods': [
                ...new Set(atPath.map(({ candidate }) => candidate.method)),
              ].join(', '),
              'access-control-allow-headers': PREFLIGHT_HEADERS,
              'access-control-max-age': String(PREFLIGHT_MAX_AGE_SECONDS),
            },
          });
        } else if (found !== undefined) {
          response = await answer(found.candidate, found.params, request, url, body, client);
        } else if (atPath.length > 0) {
          response = errorResponse('method_not_allowed', {
            headers: {
              allow: [...new Set(atPath.map(({ candidate }) => candidate.method))].join(', '),
            },
          });
        } else {
          response = errorResponse('not_found');
        }
      }
    } catch (error) {
      logUnhandled(options.log, route?.path ?? null, error);
      response = errorResponse('internal');
    }
    logRequest(options.log, {
      method: request.method,
      route: route?.path ?? null,
      status: response.status,
      ms: now() - started,
    });
    if (options.observe !== undefined) {
      options.observe(route?.path ?? null, response.status, await errorCodeOf(response));
    }
    return withHeaders(response);
  };
}
