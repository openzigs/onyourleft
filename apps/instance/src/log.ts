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
 */

/** Where lines go. `main.ts` writes them to standard output; a test keeps them. */
export type LogSink = (line: string) => void;

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
  sink(
    JSON.stringify({
      event: 'request',
      method: loggedMethod(entry.method),
      route: entry.route,
      status: entry.status,
      ms: Math.round(entry.ms),
    }),
  );
}

/** An exception a route did not handle, logged by the error's name alone. */
export function logUnhandled(sink: LogSink, route: string | null, error: unknown): void {
  const name =
    error instanceof Error && /^[A-Za-z]{1,64}$/.test(error.name) ? error.name : 'unknown';
  sink(JSON.stringify({ event: 'unhandled', route, error: name }));
}

/** Something the instance itself did — started, stopped — with no request in it. */
export function logEvent(sink: LogSink, event: string, detail: Record<string, unknown> = {}): void {
  sink(JSON.stringify({ event, ...detail }));
}
