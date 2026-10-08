// SPDX-License-Identifier: Apache-2.0

/**
 * **The rider's history, asked of their own instance** — #835, ADR 0040 D-2,
 * D-8.
 *
 * Before a run, the post-ride ask (`ride-analysis.ts`) may ask the rider's
 * instance for the passages of their history — earlier write-ups, ride
 * summaries, goals, notes and documents — that best match this ride. The
 * instance ranks them; this module decides what of its answer may reach a
 * prompt:
 *
 * - **Only the shape asked for.** At most the template's passage count and
 *   character budget; each passage a kind the instance may return, a label of
 *   this app's own spelling, and text of at most 900 characters. An answer
 *   that is anything else is not used at all.
 * - **A retrieved write-up is screened again** (ADR 0035 D-4, `write-up-screen.ts`):
 *   the device saved it screened, so one that fails now changed on the
 *   instance. It is dropped from this run, and the rider is not shown it.
 * - **The rider's own text is otherwise kept whole** (ADR 0040 D-2 item 3): a
 *   note or a document is theirs. It is DATA, and the template's history step
 *   fences it (`template-v2.ts` §`HISTORY_FENCE_BEGIN`).
 *
 * Only {@link acceptHistoryAnswer} makes a {@link HistoryPassage}, so a
 * template builder cannot be handed text that did not come through it.
 *
 * ## It never fails a run
 *
 * An instance that is not connected is no history step and no sentence (a
 * rider with no instance loses nothing, ADR 0036 D-3(a)). One that is
 * connected and cannot be reached, or answers something unusable, is
 * `unreachable`: the run goes on without history and says so (ADR 0040 D-8).
 *
 * ## What this module does NOT do: talk to the network
 *
 * It names no `fetch`, for `instance/sync.ts`'s reason: it takes a
 * {@link HistoryTransport}, and #777 — the ONE module `privacy/no-network.test.ts`
 * will permit to call an instance — supplies the production one. Until then
 * `main.tsx` hands the ask no history source, so a shipped build asks for no
 * history and sends none. ⚠️ **Whoever wires it owes the disclosures first**:
 * the write-up's "what is sent" sentences, the privacy policy and Play Data
 * Safety must say that passages of the rider's history go to their own
 * computer's model (ADR 0040 D-11) — and to a hosted model only after ADR 0040
 * D-9's amendment, which is why `hosted-step.ts` refuses a history step.
 */

import { passedScreen, screenSavedWriteUp } from './screen/write-up-screen';

/** The kinds of passage the instance returns (the instance's `history/passages.ts` §`INDEXED_KINDS`). */
export const HISTORY_KINDS = ['write-up', 'ride-summary', 'goal', 'note', 'document'] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

/** The longest one passage may be: the instance splits a longer one when it indexes it (D-8). */
export const MAXIMUM_PASSAGE_CHARACTERS = 900;

/** The longest a passage's label may be (D-2: about 40 characters beside each passage). */
export const MAXIMUM_LABEL_CHARACTERS = 40;

declare const accepted: unique symbol;

/** A passage of the rider's history, as {@link acceptHistoryAnswer} accepted it. */
export interface HistoryPassage {
  readonly kind: HistoryKind;
  /** What it is, and for a ride how long before or after this one: `Your note`, `Write-up of a ride 3 weeks earlier`. */
  readonly label: string;
  readonly text: string;
  readonly [accepted]: true;
}

/** What the instance is asked. */
export interface HistoryRequest {
  /** What to match, from the template (`HistoryStep.query`). */
  readonly query: string;
  /** The ride being written about, by its id — which is also its synced key. */
  readonly rideId: string;
  /** The most passages, and the most characters of passage text, the template has room for. */
  readonly limit: number;
  readonly characters: number;
}

/** One request to the instance, with the device's session already attached. `instance/sync.ts` §`SyncTransport`'s shape. */
export interface HistoryTransport {
  json(
    method: 'POST',
    path: string,
    body: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly status: number; readonly body: unknown }>;
}

/** What asking came to. */
export type RetrievedHistory =
  | { readonly kind: 'passages'; readonly passages: readonly HistoryPassage[] }
  /** Not reached, refused, or an answer that could not be used: the run goes on without it. */
  | { readonly kind: 'unreachable' };

/** Where history comes from: the rider's instance, through its one transport. */
export interface HistorySource {
  retrieve(request: HistoryRequest): Promise<RetrievedHistory>;
}

/** The instance's search route (the instance's `history/routes.ts`). */
export const HISTORY_SEARCH_PATH = '/v1/history/search';

/** A ride id the instance takes: one path segment's characters (the instance's `handler.ts` §`PARAMETER`). */
const RIDE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** A label as the instance spells one: words, digits, spaces and hyphens. */
const LABEL = /^[A-Za-z0-9 -]{1,40}$/;

/** A lone half of a surrogate pair: not well-formed text. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Every control character but a newline and a tab. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The passages of an instance's answer that may reach a prompt, or
 * `undefined` when the answer is not the shape asked for. @see the file comment.
 */
export function acceptHistoryAnswer(
  body: unknown,
  request: Pick<HistoryRequest, 'limit' | 'characters'>,
): readonly HistoryPassage[] | undefined {
  if (!isObject(body) || Object.keys(body).join() !== 'passages') {
    return undefined;
  }
  const { passages } = body;
  if (!Array.isArray(passages) || passages.length > request.limit) {
    return undefined;
  }
  const kept: HistoryPassage[] = [];
  let characters = 0;
  for (const passage of passages as unknown[]) {
    if (!isObject(passage) || Object.keys(passage).sort().join() !== 'kind,label,text') {
      return undefined;
    }
    const { kind, label, text } = passage;
    if (
      !HISTORY_KINDS.includes(kind as HistoryKind) ||
      typeof label !== 'string' ||
      !LABEL.test(label) ||
      typeof text !== 'string' ||
      text.trim() === '' ||
      text.length > MAXIMUM_PASSAGE_CHARACTERS ||
      LONE_SURROGATE.test(text)
    ) {
      return undefined;
    }
    characters += text.length;
    if (characters > request.characters) {
      return undefined;
    }
    // Screened again: a write-up that fails now changed on the instance (D-8).
    if (kind === 'write-up' && !passedScreen(screenSavedWriteUp(text))) {
      continue;
    }
    kept.push({
      kind: kind as HistoryKind,
      label,
      text: text.replace(CONTROL, ' ').trim(),
    } as HistoryPassage);
  }
  return kept;
}

/** History from the rider's instance, through `transport`. Never rejects. */
export function instanceHistorySource(transport: HistoryTransport): HistorySource {
  return {
    async retrieve(request) {
      try {
        const answer = await transport.json('POST', HISTORY_SEARCH_PATH, {
          query: request.query,
          // A ride the instance could not name is left out, not refused: its
          // own passages may then come back, and nothing is dated.
          ...(RIDE_ID.test(request.rideId) ? { rideId: request.rideId } : {}),
          limit: request.limit,
          characters: request.characters,
        });
        if (answer.status !== 200) {
          return { kind: 'unreachable' };
        }
        const passages = acceptHistoryAnswer(answer.body, request);
        return passages === undefined ? { kind: 'unreachable' } : { kind: 'passages', passages };
      } catch {
        // Nothing of the error is read: it could name the instance's address.
        return { kind: 'unreachable' };
      }
    },
  };
}
