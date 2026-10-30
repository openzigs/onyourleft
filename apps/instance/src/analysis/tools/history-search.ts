// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **`history_search`: the ADR 0040 history index, as a tool the model calls**
 * — #1099, ADR 0046 D-7 (ADR 0040 D-8 amended: retrieval is a tool on the
 * instance, not a device step).
 *
 * The model gives a query of its own and nothing else. What it gets back is
 * ADR 0040's, unchanged:
 *
 * - **Bounded**: at most {@link MAXIMUM_SEARCH_PASSAGES} passages and
 *   {@link MAXIMUM_SEARCH_CHARACTERS} of passage text a call, ALWAYS asked
 *   for at those bounds — the schema has no limit for a model to raise, and
 *   an argument it does not name is refused (`tools.ts`). At most
 *   {@link HISTORY_SEARCH_CALLS} calls a run.
 * - **Scoped**: the athlete is the JOB's (`ToolContext.athleteId`), handed to
 *   the index's own in-process search (`history.ts` §`History.searchFor`).
 * - **Labelled**: each passage carries the index's label, with a ride's
 *   relative age in whole weeks computed at retrieval (D-2).
 * - **Re-screened**: a `write-up` passage is screened again
 *   (`@onyourleft/analysis` §`screenWriteUp`) before the model sees it — a
 *   synced row can be edited on the instance — and one that fails is left out
 *   of that call, which says how many were.
 * - **Fenced** by the agent (`fenceData`), like every tool result: no passage
 *   can spell the fence's markers and close it early (D-8).
 * - **Never the pose summary**: `side-camera-report` is not an indexed kind
 *   (`passages.ts` §`INDEXED_KINDS`), and a passage of any kind outside that
 *   list is dropped here as well.
 * - **Never fatal**: with no index, an index whose model is off or failing,
 *   or a search that throws, the call answers {@link HISTORY_UNAVAILABLE} and
 *   the run goes on (D-8).
 *
 * On an `instance-hosted` job what it returns reaches the hosted model only
 * masked (#1101): the connection masks every tool result (`hosted.ts`).
 */

import { passedScreen, screenWriteUp, type UntrustedText } from '@onyourleft/analysis';

import {
  MAXIMUM_QUERY_CHARACTERS,
  MAXIMUM_SEARCH_CHARACTERS,
  MAXIMUM_SEARCH_PASSAGES,
} from '../../history/history.ts';
import { INDEXED_KINDS } from '../../history/passages.ts';
import type { SyncKind } from '../../store/sql-store.ts';
import type { AgentTool } from './tools.ts';

/** The most times one run may call `history_search`. */
export const HISTORY_SEARCH_CALLS = 3;

/** What the model is told when there is no history to search. */
export const HISTORY_UNAVAILABLE =
  'The cyclist’s history is not available for this write-up. Write it without it.';

/** What the model is told when nothing matched. */
export const HISTORY_EMPTY = 'Nothing in the cyclist’s history matched that query.';

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const INDEXED = new Set<string>(INDEXED_KINDS satisfies readonly SyncKind[]);

/** `history_search`. @see the file comment. */
export const HISTORY_SEARCH: AgentTool<{ readonly query: string }> = {
  spec: {
    name: 'history_search',
    description: `Search the cyclist’s own history — summaries and write-ups of other rides, their goals, notes and documents — for passages about a query. Returns at most ${String(MAXIMUM_SEARCH_PASSAGES)} passages.`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          minLength: 1,
          maxLength: MAXIMUM_QUERY_CHARACTERS,
          description: 'What to look for, in words.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  maximumCalls: HISTORY_SEARCH_CALLS,
  validate: (input) => {
    if (!isObject(input)) return { ok: false, error: 'The arguments must be a JSON object.' };
    if (Object.keys(input).some((key) => key !== 'query')) {
      return { ok: false, error: 'An argument this tool does not take was given.' };
    }
    const { query } = input;
    if (
      typeof query !== 'string' ||
      query.trim() === '' ||
      query.length > MAXIMUM_QUERY_CHARACTERS
    ) {
      return {
        ok: false,
        error: `query must be text of 1 to ${String(MAXIMUM_QUERY_CHARACTERS)} characters.`,
      };
    }
    return { ok: true, args: { query } };
  },
  run: async (context, { query }) => {
    if (context.history === undefined) return HISTORY_UNAVAILABLE;
    let found: Awaited<ReturnType<NonNullable<typeof context.history>['searchFor']>>;
    try {
      found = await context.history.searchFor(context.athleteId, {
        query,
        limit: MAXIMUM_SEARCH_PASSAGES,
        characters: MAXIMUM_SEARCH_CHARACTERS,
        ...(context.rideId === undefined ? {} : { rideId: context.rideId }),
      });
    } catch {
      return HISTORY_UNAVAILABLE;
    }
    if (!found.ok) return HISTORY_UNAVAILABLE;

    // The index already keeps to both bounds; they are held here as well, so
    // a search that one day returned more could not hand the model more.
    const lines: string[] = [];
    let withheld = 0;
    let spent = 0;
    for (const passage of found.value.passages.slice(0, MAXIMUM_SEARCH_PASSAGES)) {
      if (!INDEXED.has(passage.kind)) continue;
      if (spent + passage.text.length > MAXIMUM_SEARCH_CHARACTERS) continue;
      if (
        passage.kind === 'write-up' &&
        !passedScreen(screenWriteUp(passage.text as UntrustedText))
      ) {
        withheld += 1;
        continue;
      }
      spent += passage.text.length;
      lines.push(`${passage.label}: ${passage.text}`);
    }
    if (withheld > 0) {
      lines.push(
        `${String(withheld)} ${withheld === 1 ? 'passage was' : 'passages were'} withheld because ${withheld === 1 ? 'it' : 'they'} did not pass this app’s screen.`,
      );
    }
    return lines.length === 0 ? HISTORY_EMPTY : lines.join('\n');
  },
};
