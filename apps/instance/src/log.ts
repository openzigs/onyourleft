// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the instance writes about a request, and — the point of the module —
 * what it never writes (#767).
 *
 * One JSON line per request: the method, the ROUTE it matched, the status and
 * how long it took. **Never** the request's path, its query, its headers or its
 * body:
 *
 * - a path or a query can carry a token or an id (`/v1/rides/<id>?token=…`), so
 *   an unmatched request is logged as `route: null` rather than by the path it
 *   asked for;
 * - a header is where the device's credential will travel (#772);
 * - a body is where a ride's coordinates will travel (#776), and ADR 0004
 *   decision D says a coordinate never reaches a log line.
 *
 * ⚠️ **An exception is logged by its NAME alone.** An error's message is
 * written by whatever threw it — a parser quoting its input, a driver quoting a
 * row — and a stack names paths on the host. `handler.ts` answers the client
 * with the one `internal` shape (#36) and this writes `TypeError`, nothing more.
 *
 * `log.test.ts` sends a request carrying a token, a coordinate and a body
 * through the real listener and reads every line written.
 *
 * ## One function every line goes through — {@link redacted} (#791)
 *
 * Every logger here writes through {@link writeRecord}, and that through
 * {@link redacted}: a record keeps a key only if it is on
 * {@link LOGGABLE_KEYS}, and a value only if it is a number, a boolean, `null`
 * or a short string — every other key's value is replaced whole. An
 * allowlist, not a denylist, because the thing to keep out is whatever
 * somebody passes in next week under a name nobody thought to ban: a session
 * token, a signature, a latitude, a display name. `log.test.ts` logs one of
 * each and reads the line.
 *
 * A key that would be dangerous on the shared list can still be kept for ONE
 * event, and then only a value of the one shape that event writes: see
 * {@link EVENT_KEYS} (#1402).
 */

/** Where lines go. `main.ts` writes them to standard output; a test keeps them. */
export type LogSink = (line: string) => void;

/**
 * The keys a log line may carry a value under: what happened, to what route,
 * how it ended, and the instance's own facts about itself. Nothing here is
 * about a rider.
 */
export const LOGGABLE_KEYS: ReadonlySet<string> = new Set([
  'event',
  'method',
  'route',
  'status',
  'ms',
  'error',
  'url',
  'version',
  'commit',
  'signal',
  'worker',
  'workers',
  'code',
  'roomsLost',
  'migrations',
  'command',
  'database',
  'rooms',
  'compression',
  'metrics',
  'registration',
  'identity',
  'state',
  // The history index (#835): the operator's own model, and how a catch-up went.
  'model',
  'indexed',
  'stopped',
  // #1097: one of `analysis/hosted-key.ts`'s two fixed sentences about a held
  // key the instance cannot read. Named for that one event, so no other
  // `reason` (a moderator's, a rider's) becomes loggable by it.
  'hostedKeyProblem',
  // #1189: what one pass over the instance's own keys did — booleans and a
  // count — and, when it could do nothing, one of `keys/instance-keys.ts`'s
  // fixed sentences. Never a key, a key id or a statement.
  'made',
  'rotated',
  'signed',
  'deleted',
  'keysProblem',
]);

/**
 * The fixed reasons a room closes a socket with, as `room/close-codes.ts`
 * spells them. Written out rather than imported so that what this module
 * reaches stays small (`analysis/agent-safety.test.ts` walks it);
 * `log.test.ts` fails if the two lists part.
 */
export const LOGGED_CLOSE_REASONS: ReadonlySet<string> = new Set([
  'protocol-mismatch',
  'physics-mismatch',
  'ticket-refused',
  'room-full',
  'room-closed',
  'hello-expected',
  'replaced',
  'server-stopping',
  'room-lost',
  'too-slow',
]);

/**
 * Keys one event may carry beyond {@link LOGGABLE_KEYS}, each with the only
 * value it may hold there. Not on the shared list, because `reason`, `room`
 * and `count` mean other things elsewhere — a moderator's reason is free
 * text — and a value that fails its check is {@link REDACTED} like any other.
 */
export const EVENT_KEYS: ReadonlyMap<
  string,
  Readonly<Record<string, (value: unknown) => boolean>>
> = new Map([
  // #1400 / #1402: why a room let a socket go. The room id is the opaque one
  // `rooms/rooms.ts` mints (16 random bytes, lowercase hex) — it names no
  // athlete and is not a credential: the route and the socket both still need
  // a session or a ticket. The reason is one of the fixed close reasons, the
  // count how many that room has closed for it so far.
  [
    'room-socket-closed',
    {
      room: (value) => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value),
      reason: (value) => typeof value === 'string' && LOGGED_CLOSE_REASONS.has(value),
      count: (value) => Number.isSafeInteger(value) && (value as number) >= 0,
    },
  ],
]);

/** A logged string longer than this is cut: a token or a signature is longer. */
const MAXIMUM_LOGGED_STRING = 120;

/** What stands in for a value that may not be logged. */
export const REDACTED = '[redacted]';

function loggable(value: unknown): unknown {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : REDACTED;
  if (typeof value === 'string') {
    return value.length <= MAXIMUM_LOGGED_STRING ? value : REDACTED;
  }
  return REDACTED;
}

/**
 * The one function every log line goes through: only {@link LOGGABLE_KEYS},
 * and only plain, short values under them, plus the record's own event's
 * {@link EVENT_KEYS} when their values pass. Anything else — a key not on
 * either list, an object, an array — is {@link REDACTED}, whatever it held.
 */
export function redacted(record: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  const own = typeof record.event === 'string' ? EVENT_KEYS.get(record.event) : undefined;
  for (const [key, value] of Object.entries(record)) {
    const check = own !== undefined && Object.hasOwn(own, key) ? own[key] : undefined;
    if (check !== undefined) kept[key] = check(value) ? value : REDACTED;
    else kept[key] = LOGGABLE_KEYS.has(key) ? loggable(value) : REDACTED;
  }
  return kept;
}

/** Writes one record as one line, through {@link redacted}. */
export function writeRecord(sink: LogSink, record: Readonly<Record<string, unknown>>): void {
  sink(JSON.stringify(redacted(record)));
}

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

/** The method, or `OTHER` — a method is the one request field logged as sent. */
export function loggedMethod(method: string): string {
  return METHODS.has(method) ? method : 'OTHER';
}

/** A request, logged. `route` is the pattern it matched, or `null`. */
export function logRequest(
  sink: LogSink,
  entry: {
    readonly method: string;
    readonly route: string | null;
    readonly status: number;
    readonly ms: number;
  },
): void {
  writeRecord(sink, {
    event: 'request',
    method: loggedMethod(entry.method),
    route: entry.route,
    status: entry.status,
    ms: Math.round(entry.ms),
  });
}

/** An exception a route did not handle, logged by the error's name alone. */
export function logUnhandled(sink: LogSink, route: string | null, error: unknown): void {
  const name =
    error instanceof Error && /^[A-Za-z]{1,64}$/.test(error.name) ? error.name : 'unknown';
  writeRecord(sink, { event: 'unhandled', route, error: name });
}

/** Something the instance itself did — started, stopped — with no request in it. */
export function logEvent(sink: LogSink, event: string, detail: Record<string, unknown> = {}): void {
  writeRecord(sink, { event, ...detail });
}
