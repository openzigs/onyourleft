// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a route IS: the types the route table is written in, and the one JSON
 * response helper (#36). A module of its own so `routes.ts` and
 * `auth/routes.ts` can both use it without importing each other.
 */

import type { Readiness } from './readiness.ts';
import type { Caller, Identity } from './auth/identity.ts';
import type { Config } from './config.ts';
import type { History } from './history/history.ts';
import type { Sync } from './sync/sync.ts';
import { JSON_TYPE, type ErrorCode } from './errors.ts';

/** The subset of JSON Schema the specification uses, and the contract test checks. */
export type Schema =
  | {
      readonly type: 'object';
      readonly properties: Readonly<Record<string, Schema>>;
      readonly required: readonly string[];
      readonly additionalProperties: false;
    }
  | { readonly type: 'object'; readonly description: string }
  | { readonly type: 'array'; readonly items: Schema }
  | { readonly type: 'string' | ['string', 'null']; readonly format?: 'uri' }
  | {
      readonly type:
        | 'integer'
        | 'number'
        | 'boolean'
        | ['integer', 'null']
        | ['number', 'null']
        | ['boolean', 'null'];
    }
  | { readonly type: 'string'; readonly enum: readonly string[] }
  | { readonly $ref: string };

/** Who sent a request, as far as the adapter in front of the handler knows. */
export interface ClientInfo {
  /** The peer's address, for rate limits only — never logged. `null` when unknown. */
  readonly address: string | null;
}

/**
 * What a running instance can say about itself and its rooms (#780, #791),
 * handed to the handler by `instance.ts`. Absent — a test's handler, or a
 * mount with no rooms — `/ready` is not ready and `/metrics` is not served.
 */
export interface InstanceProbes {
  ready(): Promise<Readiness>;
  /**
   * The metrics document, when the operator turned it on
   * (`OYL_INSTANCE_METRICS`) — for a request whose `Authorization` carries
   * the operator's token; `undefined` for any other.
   */
  readonly metrics?: (authorization: string | null) => Promise<string | undefined>;
  /** Start a race's countdown, for an athlete seated in it. */
  readonly startRoom?: (roomId: string, athleteId: string) => Promise<'started' | 'not_found'>;
}

/** What a route is handed. */
export interface RouteContext {
  readonly request: Request;
  readonly url: URL;
  /**
   * The request's body, already read — within the instance's limit, or the
   * route would not have been called. `null` when there is none. A route reads
   * this and never `request.body`, which the size check has consumed.
   */
  readonly body: Uint8Array | null;
  /** The body parsed as a JSON object, for a route that declares a `request` schema. */
  readonly json: Readonly<Record<string, unknown>>;
  /** The values of the path's `{name}` segments. */
  readonly params: Readonly<Record<string, string>>;
  readonly client: ClientInfo;
  readonly config: Config;
  /** The instance's package version. */
  readonly version: string;
  /** The instance's own third-party notices document. */
  readonly notices: string;
  /** The generated specification. */
  readonly specification: unknown;
  /** Identity (#772). Present for every route that declares `identity`; the handler sees to it. */
  readonly identity: Identity | undefined;
  /** The signed-in caller, for a route that declares `auth: 'session'`. */
  readonly caller: Caller | undefined;
  /** Sync (#37, #776). Present for every route that declares `sync`; the handler sees to it. */
  readonly sync: Sync | undefined;
  /** The history index (#835). Present for every route that declares `history`; the handler sees to it. */
  readonly history: History | undefined;
  readonly probes: InstanceProbes | undefined;
}

/**
 * Whether, and how, a route reaches ANOTHER athlete (#83). Required on every
 * route, so a new one cannot be added without saying — and
 * `moderation/choke-point.test.ts` walks the table and holds each to it.
 *
 * - `'own'` — the instance's metadata, or the caller's own account and data.
 * - `{ athlete: name }` — the path's `{name}` segment is another athlete. The
 *   handler asks the choke point (`moderation.ts` §`canSee`) before calling the
 *   route, and answers `not_found` when the caller may not see them: the same
 *   answer as for an athlete who does not exist.
 * - `'moderation'` — the instance's moderators only; anybody else gets
 *   `not_found`, as though the route were not there.
 * - `{ exempt: reason }` — it reaches other athletes, and does not ask the
 *   choke point, for the reason given.
 */
export type Reach =
  'own' | { readonly athlete: string } | 'moderation' | { readonly exempt: string };

export interface Route {
  readonly method: 'GET' | 'POST' | 'DELETE';
  /** The path, with `{name}` for a segment the route reads from `params`. */
  readonly path: string;
  readonly operationId: string;
  readonly summary: string;
  /**
   * The route needs the instance's accounts (#772). An instance handed no
   * identity answers `unavailable` without calling it.
   */
  readonly identity?: true;
  /**
   * The route needs the instance's sync store and blobs (#37). An instance
   * handed none answers `unavailable` without calling it.
   */
  readonly sync?: true;
  /**
   * The route needs the history index (#835, ADR 0040). An instance handed
   * none answers `unavailable` without calling it.
   */
  readonly history?: true;
  /** Whether the route reaches another athlete, and how (#83). */
  readonly reaches: Reach;
  /**
   * An athlete awaiting approval (#775) may call this route. Every other
   * session route answers such a caller `registration_pending`.
   */
  readonly admitsPending?: true;
  /** The route needs a signed-in device: `Authorization: Bearer <session token>`. */
  readonly auth?: 'session';
  /** The JSON body the route reads, for the specification. */
  readonly request?: Schema;
  /** The error codes this route answers with beyond every route's. */
  readonly errors?: readonly ErrorCode[];
  readonly response:
    | { readonly contentType: 'application/json'; readonly schema: Schema }
    | { readonly contentType: 'text/plain' }
    /** Bytes, exactly as they were stored: an original activity file (#35, #776). */
    | { readonly contentType: 'application/octet-stream' }
    /** 204, no body. */
    | { readonly contentType: 'none' };
  readonly handle: (context: RouteContext) => Response | Promise<Response>;
}

/** A JSON body, with the media type every JSON body here carries. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': JSON_TYPE } });
}

/** `204 No Content`. */
export function noContent(): Response {
  return new Response(null, { status: 204 });
}
