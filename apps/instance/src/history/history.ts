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
 * items wait, and nothing is embedded anywhere else (D-6).
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
import type { HistoryIndexSummary, SqlStore, SyncKind } from '../store/sql-store.ts';
import type { EmbedFailure, Embedder } from './embedder.ts';
import { cutSource, INDEXED_KINDS, RIDE_KINDS } from './passages.ts';

/** The most passages one search may return (ADR 0040 D-8). */
export const MAXIMUM_SEARCH_PASSAGES = 6;

/** The largest character budget one search may state: six passages of 900 (D-8). */
export const MAXIMUM_SEARCH_CHARACTERS = 5_400;

/** The longest query the instance embeds. */
export const MAXIMUM_QUERY_CHARACTERS = 2_000;

/** How many passages go in one embedding request. */
export const EMBEDDING_BATCH = 16;

/** How many pending items one round of a catch-up reads. */
const SWEEP_PAGE = 16;

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
  /** Items written: with passages, or found to have none. */
  readonly indexed: number;
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
const RIDE_ID = /^[A-Za-z0-9_-]{1,128}$/;

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

/** When each of an athlete's rides started, by its activity id, read from its signed records. */
function rideStarts(
  records: readonly { readonly signedRecord: Uint8Array }[],
): ReadonlyMap<string, number> {
  const starts = new Map<string, number>();
  for (const record of records) {
    try {
      const claims = (
        JSON.parse(new TextDecoder().decode(record.signedRecord)) as {
          claims?: { activityId?: unknown; startedAt?: unknown };
        }
      ).claims;
      if (typeof claims?.activityId === 'string' && typeof claims.startedAt === 'number') {
        starts.set(claims.activityId, claims.startedAt);
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
    if (embedder === undefined) return { indexed: 0, stopped: 'off' };
    let indexed = 0;
    const write = async (
      source: { athleteId: string; kind: SyncKind; key: string; digest: string },
      outcome: 'indexed' | 'empty' | 'too-long' | 'picture',
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
    };
    // Bounded, so a store that kept answering the same page could not spin for ever.
    for (let round = 0; round < 100_000; round += 1) {
      const pending = await store.listPendingHistorySources(
        INDEXED_KINDS,
        embedder.model,
        embedder.convention,
        SWEEP_PAGE,
      );
      if (pending.length === 0) return { indexed, stopped: null };
      for (const source of pending) {
        const cut = cutSource(source.kind, source.body);
        if (cut.kind !== 'passages') {
          await write(source, cut.kind, []);
          continue;
        }
        const vectors: Float32Array[] = [];
        let tooLong = false;
        for (let at = 0; at < cut.passages.length; at += EMBEDDING_BATCH) {
          const answer = await embedder.embed(
            cut.passages.slice(at, at + EMBEDDING_BATCH),
            'document',
          );
          if (!answer.ok && answer.why === 'too-long') {
            tooLong = true;
            break;
          }
          if (!answer.ok) return { indexed, stopped: answer.why };
          vectors.push(...answer.vectors);
        }
        if (tooLong) {
          await write(source, 'too-long', []);
          continue;
        }
        if (vectors.some((vector) => vector.length !== vectors[0]?.length)) {
          return { indexed, stopped: 'malformed' };
        }
        await write(
          source,
          'indexed',
          cut.passages.map((text, ordinal) => ({
            ordinal,
            text,
            vector: vectors[ordinal] ?? new Float32Array(),
          })),
        );
      }
    }
    return { indexed, stopped: null };
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

    search: async (caller, body) => {
      const request = parseSearch(body);
      if (!request.ok) return request;
      if (embedder === undefined) return { ok: false, code: 'unavailable' };
      const asked = await embedder.embed([request.query], 'query');
      const [query] = asked.ok ? asked.vectors : [];
      if (query === undefined) return { ok: false, code: 'unavailable' };

      // The caller's own rows, of exactly this model, dimension and convention.
      const candidates = await store.listHistoryPassages(
        caller.athleteId,
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

      const dated = chosen.some(({ passage }) => RIDE_KINDS.includes(passage.kind));
      const starts = dated
        ? rideStarts(await store.listActivityRecords(caller.athleteId))
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
    },
  };
}
