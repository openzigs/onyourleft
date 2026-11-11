// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The recording's half of a solo draft — #2451, ADR 0066 D-5.3 and D-5.6: the
 * game's in-draft state, kept with the ride being recorded so that the saved
 * ride says whether it was drafted, and when.
 *
 * The game hands over what its simulation stepped (`GameState.soloDraft`): the
 * in-draft state and the metres behind it, counted on the fixed step. Nothing
 * here computes a `k` or an in-draft state of its own, so what the rider saw
 * and what is saved can never disagree (D-5.6).
 *
 * - **Drafted** is the simulation's own rule (`game/solo-draft.ts`
 *   §`draftedRide`) over the metres ridden WHILE RECORDING, summed over every
 *   game ride the recording holds: a game ride's metres before the recording
 *   began, or while it was paused, are not the saved ride's.
 * - **The spans** are when, on the recording's own clock, the rider was in the
 *   draft: what marks a segment effort found in the ride later, by the share
 *   of its own distance inside them (`segments/backfill.ts`).
 */

import type { UnixSeconds } from '@onyourleft/domain';
import type { DraftSpan, RideFacts } from '@onyourleft/store';

import { draftedRide, type SoloDraftState } from '../game/solo-draft';

/** What the game hands over on each frame of a solo ride with a draft to give. */
export type SoloDraftReading = Pick<SoloDraftState, 'inDraft' | 'inDraftMetres' | 'riddenMetres'>;

/** The draft of the ride being recorded so far. */
export interface SoloDraftRecord {
  /** Metres ridden in the draft while recording, over every game ride. */
  readonly inDraftMetres: number;
  /** Metres ridden while recording, over every game ride with a draft to give. */
  readonly riddenMetres: number;
  /** The spans already ended, oldest first. */
  readonly spans: readonly DraftSpan[];
  /** Where the span in progress began, or `undefined` out of the draft. */
  readonly openFrom: UnixSeconds | undefined;
  /**
   * The game ride's last reading, recorded or not: the next one is counted
   * from it. `undefined` before a game ride's first.
   */
  readonly last: SoloDraftReading | undefined;
}

/** A recording with no draft in it yet. */
export const NO_SOLO_DRAFT: SoloDraftRecord = {
  inDraftMetres: 0,
  riddenMetres: 0,
  spans: [],
  openFrom: undefined,
  last: undefined,
};

/**
 * One reading from the game. `at` is the recording's clock while it records,
 * and `undefined` otherwise — the reading is then only what the next is
 * counted from.
 */
export function noteSoloDraftReading(
  record: SoloDraftRecord,
  reading: SoloDraftReading,
  at: UnixSeconds | undefined,
): SoloDraftRecord {
  const before = record.last;
  if (at === undefined) {
    return { ...record, last: reading };
  }
  // A game ride counts from nought: a reading below the last is a new ride.
  const fresh = before === undefined || reading.riddenMetres < before.riddenMetres;
  const inDraftBefore = fresh ? 0 : before.inDraftMetres;
  const riddenBefore = fresh ? 0 : before.riddenMetres;
  let { spans, openFrom } = record;
  if (reading.inDraft && openFrom === undefined) {
    openFrom = at;
  } else if (!reading.inDraft && openFrom !== undefined) {
    spans = [...spans, { from: openFrom, to: at }];
    openFrom = undefined;
  }
  return {
    inDraftMetres: record.inDraftMetres + reading.inDraftMetres - inDraftBefore,
    riddenMetres: record.riddenMetres + reading.riddenMetres - riddenBefore,
    spans,
    openFrom,
    last: reading,
  };
}

/**
 * The game ride has ended: a span in progress ends `at` (or, with nothing
 * recording, is let go), and the next game ride counts from nought.
 */
export function endSoloDraftRide(
  record: SoloDraftRecord,
  at: UnixSeconds | undefined,
): SoloDraftRecord {
  return {
    ...record,
    spans:
      record.openFrom === undefined || at === undefined
        ? record.spans
        : [...record.spans, { from: record.openFrom, to: at }],
    openFrom: undefined,
    last: undefined,
  };
}

/**
 * What the saved ride says of its draft, a span in progress ending `at` —
 * `{}` for a ride with none.
 */
export function soloDraftFacts(
  record: SoloDraftRecord,
  at: UnixSeconds,
): Pick<RideFacts, 'drafted' | 'draftSpans'> {
  const spans = endSoloDraftRide(record, at).spans;
  const drafted = draftedRide({
    k: 1,
    inDraft: false,
    inDraftMetres: record.inDraftMetres,
    riddenMetres: record.riddenMetres,
  });
  return {
    ...(drafted ? { drafted: true } : {}),
    ...(spans.length === 0 ? {} : { draftSpans: spans }),
  };
}
