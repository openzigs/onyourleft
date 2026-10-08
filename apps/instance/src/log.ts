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
 * and only plain, short values under them. Anything else — a key not on the
 * list, an object, an array — is {@link REDACTED}, whatever it held.
 */
export function redacted(record: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    kept[key] = LOGGABLE_KEYS.has(key) ? loggable(value) : REDACTED;
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
