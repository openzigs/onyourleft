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
 *
 * ## Recent problems, in memory — #2614
 *
 * A sink the instance names with {@link keepProblems} also keeps its last
 * {@link RECENT_PROBLEMS_KEPT} PROBLEM lines ({@link isProblem}), for the
 * owner's Operate area (`GET /v1/operate/logs`). It keeps **exactly the line
 * {@link writeRecord} wrote**, after {@link redacted}, so it can never hold
 * what standard output did not. Memory only: gone when the process stops,
 * never in the database or a backup. The main process's lines only: a room
 * worker writes its own to standard output, and `room-worker-died` is the
 * main process's.
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
 * A lap race's item keys and what can happen to one, as
 * `@onyourleft/protocol` spells them (#1909). Written out, for the reason
 * {@link LOGGED_CLOSE_REASONS} is; `log.test.ts` fails if they part.
 */
export const LOGGED_ITEM_KEYS: ReadonlySet<string> = new Set([
  'tailwind',
  'tow',
  'puddle',
  'crosswind-gust',
  'rain-cape',
]);
export const LOGGED_ITEM_EVENTS: ReadonlySet<string> = new Set(['pick-up', 'use', 'hit']);

/**
 * A room's id as `rooms/rooms.ts` mints it: 16 random bytes, lowercase hex. It
 * names no athlete and is not a credential.
 */
function isRoomId(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}

/** A whole number from 0 up: a count, or a time in whole milliseconds. */
function isCount(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/**
 * Keys one event may carry beyond {@link LOGGABLE_KEYS}, each with the only
 * value it may hold there. Not on the shared list, because `reason`, `room`
 * and `count` mean other things elsewhere — a moderator's reason is free
 * text — and a value that fails its check is {@link REDACTED} like any other.
 */
export const EVENT_KEYS: ReadonlyMap<
  string,
  Readonly<Record<string, (value: unknown) => boolean>>
> = new Map<string, Readonly<Record<string, (value: unknown) => boolean>>>([
  // #1400 / #1402: why a room let a socket go. The room id is the opaque one
  // `rooms/rooms.ts` mints (16 random bytes, lowercase hex) — it names no
  // athlete and is not a credential: the route and the socket both still need
  // a session or a ticket. The reason is one of the fixed close reasons, the
  // count how many that room has closed for it so far.
  [
    'room-socket-closed',
    {
      room: isRoomId,
      reason: (value) => typeof value === 'string' && LOGGED_CLOSE_REASONS.has(value),
      count: (value) => Number.isSafeInteger(value) && (value as number) >= 0,
    },
  ],
  // #1909: a lap race's item event — the room, the rider's number in it (a
  // seat, not an athlete), what happened and the item's key. Never a place, a
  // name or an athlete id.
  [
    'room-item-event',
    {
      room: isRoomId,
      riderId: (value) =>
        Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 2_147_483_647,
      itemEvent: (value) => typeof value === 'string' && LOGGED_ITEM_EVENTS.has(value),
      item: (value) => typeof value === 'string' && LOGGED_ITEM_KEYS.has(value),
    },
  ],
  // #2840: what one write-up's run came to — its model turns, tool calls,
  // how many of the tools it used, the tokens sent and answered — beside the
  // job's state. Whole numbers only: never a tool's name or the model's text.
  [
    'analysis-job',
    {
      turns: isCount,
      toolCalls: isCount,
      toolsUsed: isCount,
      tokensIn: isCount,
      tokensOut: isCount,
    },
  ],
  // #2609: where the analysis model's settings come from — the operator's
  // row in the app, `.env`, or nowhere. Never the model's name or address.
  [
    'analysis-model',
    {
      setIn: (value) => value === 'app' || value === 'env' || value === 'none',
    },
  ],
  // #2836 (ADR 0081 D-5.2): one bot-tactics call on the local model — which
  // prompt, how it ended, and the model server's own figures for it: its load
  // time, the tokens in and out, and the time reading and writing. The
  // model's name and the whole call's `ms` are on the shared list. Numbers
  // and closed words only: never the model's text, a move, or anything of
  // the race, the rider or a place.
  [
    'tactics-call',
    {
      prompt: (value) => typeof value === 'string' && /^tactics-[0-9]{1,4}$/.test(value),
      state: (value) => value === 'decision' || value === 'invalid' || value === 'failed',
      loadMs: isCount,
      tokensIn: isCount,
      tokensOut: isCount,
      promptEvalMs: isCount,
      evalMs: isCount,
    },
  ],
  // #2781 (ADR 0080 D-4): which secret came from its file in the secrets
  // folder, whether this start made it, and whether that folder keeps
  // permission bits at all. Never the secret, and never the file's path.
  [
    'secret',
    {
      variable: (value) =>
        value === 'OYL_INSTANCE_SECRET_KEY' || value === 'OYL_INSTANCE_METRICS_TOKEN',
      from: (value) => value === 'file' || value === 'generated',
      permissions: (value) => value === 'not-kept',
    },
  ],
  // #2784 (ADR 0080 D-2): where the first-run setup is and where its code
  // IS — the file in the secrets folder, or the command that prints one —
  // and when the code ends. Never the code: standard output is not private.
  [
    'first-run-setup',
    {
      open: (value) =>
        typeof value === 'string' && /^http:\/\/localhost:[0-9]{1,5}\/setup$/.test(value),
      codeIn: (value) => value === 'secrets/setup-code' || value === 'operator setup-code',
      validUntil: (value) =>
        typeof value === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]{8,12}Z$/.test(value),
      // #2858: the same moment by this machine's clock, its zone named (`localTimeText`).
      validUntilLocal: (value) =>
        typeof value === 'string' &&
        /^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2} [A-Za-z0-9+:-]{1,12}$/.test(value),
    },
  ],
  // #2855: the instance's address is still the template's example, and
  // where the page that says what to set is. Never the address it was given.
  [
    'example-address',
    {
      open: (value) =>
        typeof value === 'string' && /^http:\/\/localhost:[0-9]{1,5}\/setup$/.test(value),
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

/** How many problem lines a sink keeps (#2614): the newest, the oldest dropped first. */
export const RECENT_PROBLEMS_KEPT = 200;

/**
 * Close reasons that are the INSTANCE's trouble, not a client's (#2614): a
 * worker that died under its room. `server-stopping` is a stop the operator
 * asked for; every other reason is a client's (`room/close-codes.ts`).
 */
const SERVER_SIDE_CLOSES: ReadonlySet<string> = new Set(['room-lost']);

/**
 * Whether a written line is a PROBLEM (#2614) — the one closed list,
 * read off what the line says once {@link redacted} has kept it:
 *
 * - a request answered 5xx, and an exception no route handled;
 * - a room worker that died, a room's result or flag the instance could not
 *   write, a rooms sweep or a history catch-up that failed, a voice request
 *   that failed;
 * - an analysis job that failed; the analysis model, the picture model or
 *   the history index off for a reason other than not being set (#2859: each
 *   is optional, and not set is not a problem); the instance keys not `ready`; a hosted model key
 *   held with no secret or one that will not open; voice turned off by a
 *   refusal (not merely unset); a refusal to serve over migrations;
 * - a room socket closed for a server-side reason (`room-lost`).
 *
 * `docs/operating-an-instance.md` has a sentence for each.
 */
export function isProblem(line: Readonly<Record<string, unknown>>): boolean {
  const { event, state, code } = line;
  switch (event) {
    case 'request':
      return typeof line.status === 'number' && line.status >= 500;
    case 'unhandled':
    case 'room-worker-died':
    case 'room-write-failed':
    case 'rooms-sweep-failed':
    case 'history-index-failed':
    case 'voice-failed':
    case 'refusing':
      return true;
    case 'analysis-job':
      return state === 'failed';
    case 'analysis-model':
    case 'picture-model':
    case 'history-index':
      // #2859: each is optional, and not set is not a problem — only one set and not working.
      return state === 'off' && code !== 'not-set';
    case 'instance-keys':
      return state !== 'ready';
    case 'hosted-model-key':
      return state === 'no-secret' || state === 'unreadable';
    case 'voice':
      return state === 'off' && code !== 'not-set';
    case 'room-socket-closed':
      return typeof line.reason === 'string' && SERVER_SIDE_CLOSES.has(line.reason);
    default:
      return false;
  }
}

/** One problem line as it was written (#2614), and when, Unix milliseconds. */
export interface RecentProblem {
  readonly at: number;
  readonly line: string;
}

/** The problem lines a sink keeps (#2614). */
export interface RecentProblems {
  /** `kept` is the record AS WRITTEN — after {@link redacted} — and `line` its text. */
  offer(kept: Readonly<Record<string, unknown>>, line: string): void;
  /** Newest first. */
  list(): readonly RecentProblem[];
}

/** An empty ring of at most `kept` problem lines, stamped by `now` (Unix milliseconds). */
export function createRecentProblems(
  now: () => number,
  kept: number = RECENT_PROBLEMS_KEPT,
): RecentProblems {
  const ring: RecentProblem[] = [];
  return {
    offer(record, line) {
      if (!isProblem(record)) return;
      ring.push({ at: now(), line });
      if (ring.length > kept) ring.splice(0, ring.length - kept);
    },
    list: () => [...ring].reverse(),
  };
}

/** Which sinks keep their problem lines, and where. */
const problemsKept = new WeakMap<LogSink, RecentProblems>();

/** From now on `sink`'s problem lines are kept in `problems` (#2614): the instance's own sink. */
export function keepProblems(sink: LogSink, problems: RecentProblems): void {
  problemsKept.set(sink, problems);
}

/** Writes one record as one line, through {@link redacted} — and keeps it if it is a problem. */
export function writeRecord(sink: LogSink, record: Readonly<Record<string, unknown>>): void {
  const kept = redacted(record);
  const line = JSON.stringify(kept);
  sink(line);
  // The line as written, never the record before it was redacted.
  problemsKept.get(sink)?.offer(kept, line);
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
