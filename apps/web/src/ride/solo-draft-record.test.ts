// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The recording's half of a solo draft — #2451, ADR 0066 D-5.3, D-5.6: the
 * metres counted while recording only, summed over game rides, and the spans
 * on the recording's clock.
 */

import { unixSeconds } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { DRAFTED_SHARE } from '../game/solo-draft';

import {
  endSoloDraftRide,
  NO_SOLO_DRAFT,
  noteSoloDraftReading,
  soloDraftFacts,
  type SoloDraftReading,
  type SoloDraftRecord,
} from './solo-draft-record';

const at = (seconds: number) => unixSeconds(1_800_000_000 + seconds);
const reading = (
  inDraft: boolean,
  inDraftMetres: number,
  riddenMetres: number,
): SoloDraftReading => ({
  inDraft,
  inDraftMetres,
  riddenMetres,
});

/** Feed readings in order, each with the clock it came with (`undefined`: not recording). */
function feed(
  steps: readonly (readonly [SoloDraftReading, number | undefined])[],
  from: SoloDraftRecord = NO_SOLO_DRAFT,
): SoloDraftRecord {
  return steps.reduce(
    (record, [each, clock]) =>
      noteSoloDraftReading(record, each, clock === undefined ? undefined : at(clock)),
    from,
  );
}

describe('the draft of a recorded ride — #2451', () => {
  it('says drafted, with the span, when the share in the draft reaches DRAFTED_SHARE', () => {
    const record = feed([
      [reading(false, 0, 10), 1],
      [reading(true, 0, 20), 2],
      [reading(true, 30, 50), 5],
      [reading(false, 30, 100), 9],
    ]);
    expect(record.inDraftMetres).toBe(30);
    expect(record.riddenMetres).toBe(100);
    expect(soloDraftFacts(record, at(20))).toStrictEqual({
      drafted: true,
      draftSpans: [{ from: at(2), to: at(9) }],
    });
  });

  it('is not drafted below the share, and still keeps its spans', () => {
    const under = Math.floor(DRAFTED_SHARE * 100) - 1;
    const record = feed([
      [reading(true, 0, 0), 1],
      [reading(false, under, 100), 4],
    ]);
    expect(soloDraftFacts(record, at(10))).toStrictEqual({
      draftSpans: [{ from: at(1), to: at(4) }],
    });
  });

  it('counts nothing ridden while not recording, nor before it began', () => {
    const record = feed([
      // Before the recording: what the next reading is counted from, and no more.
      [reading(true, 80, 100), undefined],
      [reading(true, 80, 200), 1],
      [reading(false, 80, 1000), 2],
    ]);
    expect(record.inDraftMetres).toBe(0);
    expect(record.riddenMetres).toBe(900);
    expect(soloDraftFacts(record, at(3)).drafted).toBeUndefined();
  });

  it('sums every game ride of the recording, each counted from nought', () => {
    let record = feed([
      [reading(false, 0, 10), 1],
      [reading(false, 0, 100), 2],
    ]);
    record = endSoloDraftRide(record, at(3));
    // The next game ride starts again from nought: none of its metres is lost.
    record = feed(
      [
        [reading(true, 5, 5), 4],
        [reading(true, 25, 25), 5],
      ],
      record,
    );
    expect(record.riddenMetres).toBe(125);
    expect(record.inDraftMetres).toBe(25);
    expect(soloDraftFacts(record, at(6))).toStrictEqual({
      drafted: true,
      // The span in progress ends where the ride is saved.
      draftSpans: [{ from: at(4), to: at(6) }],
    });
  });

  it('ends a span in progress with its game ride', () => {
    const record = endSoloDraftRide(feed([[reading(true, 0, 1), 1]]), at(7));
    expect(record.spans).toStrictEqual([{ from: at(1), to: at(7) }]);
    expect(record.openFrom).toBeUndefined();
    expect(record.last).toBeUndefined();
    // With nothing recording when it ended, a span in progress is let go.
    expect(endSoloDraftRide(feed([[reading(true, 0, 1), 1]]), undefined).spans).toEqual([]);
  });

  it('says nothing of a ride with no draft in it', () => {
    expect(soloDraftFacts(NO_SOLO_DRAFT, at(1))).toStrictEqual({});
  });
});
