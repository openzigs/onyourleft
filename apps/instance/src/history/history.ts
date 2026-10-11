// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The history index: keeping it, and asking it** — ADR 0040 (#835).
 *
 * ## Keeping it (D-1, D-4, D-7)
 *
 * {@link History.catchUp} indexes every live synced item that has no index
 * rows for its current body under the configured model and prefix convention:
 * it cuts the item into passages (`passages.ts`), embeds them (`embedder.ts`)
 * and writes them in ONE transaction that first checks the item is still live
 * with that body (`sql-store.ts` §`putHistoryIndex`) — so a passage is never
 * kept for a body that changed or went while it was being embedded. Every
 * row is derived from a synced item, so deleting them all loses nothing: a
 * catch-up makes them again. A change of model makes every item pending again,
 * and the index returns fewer passages, or none, until it has caught up —
 * never a mixture (D-7).
 *
 * It **fails closed**: when the model cannot be reached the sweep stops, the
 * items wait, and nothing is embedded anywhere else (D-6). A running instance
 * tries again every {@link RETRY_PERIOD_MS} (`instance.ts`), so a model started
 * after the instance is picked up with no sync and no restart (#918).
 *
 * ⚠️ **One item the model refuses does not stop the rest** (#918). A model
 * that answers one item `refused` or `malformed` has answered — it is
 * reachable — so that item is marked `failed` and the sweep goes on past it.
 * Before #918 the sweep stopped there, and the same oldest item came first
 * again on every sweep, so one bad item stopped indexing for the whole
 * instance. A marked item is tried again {@link FAILED_RETRY_SECONDS} later.
 *
 * ⚠️ **A 5xx is pinned on an item only when another item succeeds** (#928's
 * second review). A 5xx may be about the server or about the input, so the
 * item is held unmarked and the NEXT item is asked about: if the model
 * answers that, the held item is marked `failed`; if not, the sweep stops
 * with neither marked, as it does for an unreachable model.
 *
 * ## Asking it (D-2, D-3, D-8)
 *
 * {@link History.search} ranks the CALLER's passages — the athlete is the
 * session's, never a parameter (D-3) — of the configured model, dimension and
 * convention only, by a dot product of unit vectors (D-4), and returns at
 * most the passage count and the character budget the caller's template
 * states. A passage is never cut to fit: one that would pass the budget is
 * left out. The ride being written about, named by its synced activity id,
 * is left out of its own history, and a passage about another ride carries a
 * label saying how many whole weeks before or after it that ride was —
 * computed here, now, from the two rides' own dates, and never stored (D-2).
 */

import type { Caller, Outcome } from '../auth/identity.ts';
import type { FieldProblem } from '../errors.ts';
import { logEvent, type LogSink } from '../log.ts';
import type {
  HistoryIndexSummary,
  HistoryOutcome,
  SqlStore,
  SyncKind,
} from '../store/sql-store.ts';
import type { EmbedFailure, Embedder } from './embedder.ts';
import { cutSource, INDEXED_KINDS, RIDE_KINDS } from './passages.ts';

/** The most passages one search may return (ADR 0040 D-8). */
export const MAXIMUM_SEARCH_PASSAGES = 6;

/** The largest character budget one search may state: six passages of 900 (D-8). */
export const MAXIMUM_SEARCH_CHARACTERS = 5_400;

/**
 * How many times one athlete may search their history a minute, unless the
 * operator's limits say otherwise (#918): `identity.ts`
 * §`IdentityLimits.historySearchesPerAthlete` says why. Here rather than
 * there so the route's description can name it without importing the
 * accounts.
 */
export const DEFAULT_HISTORY_SEARCHES = { limit: 30, windowMs: 60_000 } as const;

/** The longest query the instance embeds. */
export const MAXIMUM_QUERY_CHARACTERS = 2_000;

/** How many passages go in one embedding request. */
export const EMBEDDING_BATCH = 16;

/** How many pending items one round of a catch-up reads. */
const SWEEP_PAGE = 16;

/**
 * How often a running instance starts a catch-up of its own (#918): **5
 * minutes**. What it is for is a model that was not running when the instance
 * started, or went away: nothing else would try again until the next sync.
 * One query when nothing is pending. Chosen.
 */
export const RETRY_PERIOD_MS = 5 * 60_000;

/**
 * How long an item the model refused waits before it is tried again (#918):
 * **one hour** — a transient refusal heals, and an item the model will never
 * take costs one request an hour. Chosen.
 */
export const FAILED_RETRY_SECONDS = 60 * 60;

/** One passage, as the caller is sent it. */
export interface RetrievedPassage {
  readonly kind: SyncKind;
  /**
   * What the passage is, and for a ride how long before or after the ride
   * being written about it was — at most 40 characters, beside the passage and
   * never inside it (D-2).
   */
  readonly label: string;
  readonly text: string;
}

/** What a search is sent. */
export interface HistorySearch {
  readonly passages: readonly RetrievedPassage[];
}

/** How a catch-up ended. */
export interface CatchUpReport {
  /** Items written: with passages, or found to have none, or marked `failed`. */
  readonly indexed: number;
  /** Of those, the items the model refused or answered wrongly for, marked and gone past (#918). */
  readonly failed: number;
  /** Why it stopped early, or `null` when nothing was left to index. */
  readonly stopped: EmbedFailure | 'off' | null;
}

export interface History {
  /** Index every pending item, oldest first, until none is left or the model fails. */
  catchUp(): Promise<CatchUpReport>;
  /** Start a catch-up without waiting for it, or mark one to run again after the one running. */
  schedule(): void;
  /** Resolves when no catch-up is running. */
  idle(): Promise<void>;
  /** The caller's passages for `body`'s query. @see the file comment. */
  search(caller: Caller, body: Readonly<Record<string, unknown>>): Promise<Outcome<HistorySearch>>;
  /**
   * The same search, in-process, for `athleteId` (#1099): the analysis
   * agent's `history_search` tool, whose athlete is the JOB's — the
   * device-key session that created it — never a model's argument. The
   * request is checked exactly as {@link search}'s is.
   */
  searchFor(
    athleteId: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<Outcome<HistorySearch>>;
  /** The export's line about the index: which model built it, and how much of it (D-10). */
  summarise(athleteId: string): Promise<readonly HistoryIndexSummary[]>;
}

export interface HistoryOptions {
  readonly store: SqlStore;
  /** `undefined` when no embedding model is configured, or its address was refused: history is off. */
  readonly embedder: Embedder | undefined;
  readonly log?: LogSink;
  /** Unix milliseconds. */
  readonly now?: () => number;
}

const WEEK_SECONDS = 7 * 24 * 60 * 60;

/** A ride's key, as a device names it: one path segment's characters (`handler.ts` §`PARAMETER`). */
export const RIDE_ID = /^[A-Za-z0-9_-]{1,128}$/;

type Refusal = Extract<Outcome<never>, { readonly ok: false }>;

const invalid = (field: string, problem: string): Refusal => ({
  ok: false,
  code: 'validation_failed',
  fields: [{ field, problem } satisfies FieldProblem],
});

/** The request, checked: every field, each bound, and nothing else. */
function parseSearch(body: Readonly<Record<string, unknown>>):
  | Refusal
  | {
      readonly ok: true;
      readonly query: string;
      readonly passages: number;
      readonly characters: number;
      readonly rideId: string | undefined;
    } {
  const known = new Set(['query', 'limit', 'characters', 'rideId']);
  const extra = Object.keys(body).find((key) => !known.has(key));
  if (extra !== undefined) {
    return invalid('body', 'must hold only query, limit, characters and rideId');
  }
  const { query, limit: passages, characters, rideId } = body;
  if (typeof query !== 'string' || query.trim() === '' || query.length > MAXIMUM_QUERY_CHARACTERS) {
    return invalid('query', `must be text of 1 to ${String(MAXIMUM_QUERY_CHARACTERS)} characters`);
  }
  if (
    typeof passages !== 'number' ||
    !Number.isInteger(passages) ||
    passages < 1 ||
    passages > MAXIMUM_SEARCH_PASSAGES
  ) {
    return invalid('limit', `must be a whole number from 1 to ${String(MAXIMUM_SEARCH_PASSAGES)}`);
  }
  if (
    typeof characters !== 'number' ||
    !Number.isInteger(characters) ||
    characters < 1 ||
    characters > MAXIMUM_SEARCH_CHARACTERS
  ) {
    return invalid(
      'characters',
      `must be a whole number from 1 to ${String(MAXIMUM_SEARCH_CHARACTERS)}`,
    );
  }
  if (rideId !== undefined && (typeof rideId !== 'string' || !RIDE_ID.test(rideId))) {
    return invalid('rideId', 'must be the synced id of one of your rides');
  }
  return { ok: true, query, passages, characters, rideId };
}

/** The dot product of two vectors of one length: their cosine, for unit vectors. */
export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let index = 0; index < a.length; index += 1) sum += (a[index] ?? 0) * (b[index] ?? 0);
  return sum;
}

/**
 * When each ride in `wanted` started, by its activity id, read from the
 * athlete's signed records — and no more of them than it takes (#918 item 5):
 * a search dates at most six passages and the ride it is about, and used to
 * parse every record the athlete had to do it.
 */
export function rideStarts(
  records: readonly { readonly signedRecord: Uint8Array }[],
  wanted: ReadonlySet<string>,
): ReadonlyMap<string, number> {
  const starts = new Map<string, number>();
  const decoder = new TextDecoder();
  for (const record of records) {
    if (starts.size === wanted.size) break;
    try {
      const claims = (
        JSON.parse(decoder.decode(record.signedRecord)) as {
          claims?: { activityId?: unknown; startedAt?: unknown };
        }
      ).claims;
      const id = claims?.activityId;
      if (typeof id === 'string' && wanted.has(id) && typeof claims?.startedAt === 'number') {
        starts.set(id, claims.startedAt);
      }
    } catch {
      // A record that does not parse dates nothing.
    }
  }
  return starts;
}

/** How long before (or after) `about` the ride that started at `then` was, in whole weeks. */
export function relativeAge(then: number | undefined, about: number | undefined): string {
  if (then === undefined || about === undefined) return '';
  const weeks = Math.trunc((about - then) / WEEK_SECONDS);
  if (weeks === 0) return ' the same week';
  const count = Math.abs(weeks);
  return ` ${String(count)} ${count === 1 ? 'week' : 'weeks'} ${weeks > 0 ? 'earlier' : 'later'}`;
}

/** The label beside a passage. @see RetrievedPassage.label */
export function labelFor(kind: SyncKind, age: string): string {
  switch (kind) {
    case 'write-up':
      return `Write-up of a ride${age}`;
    case 'ride-summary':
      return `Summary of a ride${age}`;
    case 'goal':
      return 'Your goal';
    case 'note':
      return 'Your note';
    case 'document':
      return 'Your document';
    default:
      return 'Your history';
  }
}

/** The history index. @see the file comment. */
export function createHistory(options: HistoryOptions): History {
  const { store, embedder } = options;
  const now = options.now ?? (() => Date.now());
  let running: Promise<void> | undefined;
  let again = false;

  const catchUp = async (): Promise<CatchUpReport> => {
    if (embedder === undefined) return { indexed: 0, failed: 0, stopped: 'off' };
    let indexed = 0;
    let failed = 0;
    const write = async (
      source: { athleteId: string; kind: SyncKind; key: string; digest: string },
      outcome: HistoryOutcome,
      passages: readonly { ordinal: number; text: string; vector: Float32Array }[],
    ): Promise<void> => {
      await store.putHistoryIndex({
        ...source,
        model: embedder.model,
        convention: embedder.convention,
        dimension: passages[0]?.vector.length ?? 0,
        outcome,
        passages,
        now: Math.floor(now() / 1000),
      });
      indexed += 1;
      if (outcome === 'failed') failed += 1;
    };
    // One item's passages, embedded: its vectors, an outcome about THIS item
    // to mark it with, or a reason to stop the sweep.
    const embedAll = async (
      passages: readonly string[],
    ): Promise<
      | { readonly kind: 'vectors'; readonly vectors: readonly Float32Array[] }
      | { readonly kind: 'mark'; readonly outcome: 'too-long' | 'failed' }
      | { readonly kind: 'stop'; readonly why: EmbedFailure }
    > => {
      const vectors: Float32Array[] = [];
      for (let at = 0; at < passages.length; at += EMBEDDING_BATCH) {
        const answer = await embedder.embed(passages.slice(at, at + EMBEDDING_BATCH), 'document');
        if (answer.ok) {
          vectors.push(...answer.vectors);
          continue;
        }
        // An answer about THIS item — the model was reached, and said no, or
        // answered wrongly: mark it and go on (#918).
        if (answer.why === 'too-long') return { kind: 'mark', outcome: 'too-long' };
        if (answer.why === 'refused' || answer.why === 'malformed') {
          return { kind: 'mark', outcome: 'failed' };
        }
        // No answer at all, an address that may not be asked, a server that
        // answered about itself, or a 5xx that may be either.
        return { kind: 'stop', why: answer.why };
      }
      if (vectors.some((vector) => vector.length !== vectors[0]?.length)) {
        return { kind: 'mark', outcome: 'failed' };
      }
      return { kind: 'vectors', vectors };
    };
    // ⚠️ Items a 5xx was answered for, held UNMARKED while the sweep asks about
    // the ones after them (#928's reviews). A 5xx may be the server's or the
    // input's — Ollama answers 500 for a text its model makes a NaN of — and
    // the pending list is instance-wide and oldest first, so stopping on one
    // would stop every athlete's indexing behind it for ever. It is a SET, not
    // one item: a rider who saves the same text twice makes two such items side
    // by side, and holding only one of them brought the halt back (#928's third
    // review). The first time the model answers about any item, every held 5xx
    // was its own item's: each is marked `failed` (tried again in an hour, as a
    // refusal is) and the sweep goes on. Only a page in which the model answered
    // about nothing stops the sweep, with every held item still unmarked — so an
    // outage costs at most one page of requests a sweep.
    type Pending = Awaited<ReturnType<typeof store.listPendingHistorySources>>[number];
    const held: Pending[] = [];
    const isHeld = (source: Pending): boolean =>
      held.some(
        (item) =>
          source.athleteId === item.athleteId &&
          source.kind === item.kind &&
          source.key === item.key,
      );
    // Bounded, so a store that kept answering the same page could not spin for ever.
    for (let round = 0; round < 100_000; round += 1) {
      const pending = (
        await store.listPendingHistorySources(
          INDEXED_KINDS,
          embedder.model,
          embedder.convention,
          SWEEP_PAGE,
          Math.floor(now() / 1000) - FAILED_RETRY_SECONDS,
        )
      ).filter((source) => !isHeld(source));
      // Nothing else to ask about: held items stay unmarked, and wait.
      if (pending.length === 0) {
        return { indexed, failed, stopped: held.length === 0 ? null : 'server-error' };
      }
      let answered = false;
      for (const source of pending) {
        const cut = cutSource(source.kind, source.body);
        if (cut.kind !== 'passages') {
          await write(source, cut.kind, []);
          continue;
        }
        const result = await embedAll(cut.passages);
        if (result.kind === 'stop') {
          if (result.why === 'server-error') {
            held.push(source);
            continue;
          }
          // Every item after this one would fare the same. Stop, and let them
          // wait (D-6) — the held items with them, unmarked.
          return { indexed, failed, stopped: result.why };
        }
        // The model answered about this item, so every held 5xx was its own item's.
        answered = true;
        for (const item of held.splice(0)) await write(item, 'failed', []);
        if (result.kind === 'mark') {
          await write(source, result.outcome, []);
          continue;
        }
        await write(
          source,
          'indexed',
          cut.passages.map((text, ordinal) => ({
            ordinal,
            text,
            vector: result.vectors[ordinal] ?? new Float32Array(),
          })),
        );
      }
      // A whole page and not one answer: the server, not an input. Stop, marking nothing.
      if (held.length > 0 && !answered) return { indexed, failed, stopped: 'server-error' };
    }
    return { indexed, failed, stopped: null };
  };

  const schedule = (): void => {
    if (embedder === undefined) return;
    if (running !== undefined) {
      again = true;
      return;
    }
    running = (async () => {
      do {
        again = false;
        try {
          const report = await catchUp();
          if (options.log !== undefined && (report.indexed > 0 || report.stopped !== null)) {
            logEvent(options.log, 'history-indexed', {
              indexed: report.indexed,
              failed: report.failed,
              stopped: report.stopped,
            });
          }
        } catch (error) {
          if (options.log !== undefined) {
            logEvent(options.log, 'history-index-failed', {
              error: error instanceof Error ? error.name : 'unknown',
            });
          }
        }
      } while (again);
    })().finally(() => {
      running = undefined;
    });
  };

  return {
    catchUp,
    schedule,
    idle: () => running ?? Promise.resolve(),
    summarise: (athleteId) => store.summariseHistoryIndex(athleteId),

    search: (caller, body) => searchFor(caller.athleteId, body),
    searchFor,
  };

  async function searchFor(
    athleteId: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<Outcome<HistorySearch>> {
    const request = parseSearch(body);
    if (!request.ok) return request;
    if (embedder === undefined) return { ok: false, code: 'unavailable' };
    const asked = await embedder.embed([request.query], 'query');
    const [query] = asked.ok ? asked.vectors : [];
    if (query === undefined) return { ok: false, code: 'unavailable' };

    // The caller's own rows, of exactly this model, dimension and convention.
    const candidates = await store.listHistoryPassages(
      athleteId,
      embedder.model,
      query.length,
      embedder.convention,
    );
    const ranked = candidates
      .filter((passage) => !(RIDE_KINDS.includes(passage.kind) && passage.key === request.rideId))
      .map((passage) => ({ passage, score: dot(query, passage.vector) }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.passage.kind.localeCompare(b.passage.kind) ||
          a.passage.key.localeCompare(b.passage.key) ||
          a.passage.ordinal - b.passage.ordinal,
      );

    const chosen: typeof ranked = [];
    let spent = 0;
    for (const entry of ranked) {
      if (chosen.length >= request.passages) break;
      // Never cut to fit: a passage that would pass the budget is left out.
      if (spent + entry.passage.text.length > request.characters) continue;
      chosen.push(entry);
      spent += entry.passage.text.length;
    }

    // Only the rides a chosen passage is about, and the one being written about.
    const wanted = new Set(
      chosen
        .filter(({ passage }) => RIDE_KINDS.includes(passage.kind))
        .map(({ passage }) => passage.key),
    );
    if (wanted.size > 0 && request.rideId !== undefined) wanted.add(request.rideId);
    const starts =
      wanted.size > 0
        ? rideStarts(await store.listActivityRecords(athleteId), wanted)
        : new Map<string, number>();
    const about = request.rideId === undefined ? undefined : starts.get(request.rideId);
    return {
      ok: true,
      value: {
        passages: chosen.map(({ passage }) => ({
          kind: passage.kind,
          label: labelFor(
            passage.kind,
            RIDE_KINDS.includes(passage.kind) ? relativeAge(starts.get(passage.key), about) : '',
          ),
          text: passage.text,
        })),
      },
    };
  }
}
