// SPDX-License-Identifier: AGPL-3.0-or-later

import { useId, useRef, useState, type JSX } from 'react';

import type { Watts } from '@onyourleft/domain';

import type { AnalysisPort } from '../analysis/store-port';
import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import {
  conventionText,
  suggestionText,
  type TestRideEstimate,
} from '../workouts/threshold-test-result';

/**
 * A threshold test's estimate, offered after the ride — #2307, under the
 * library epic #2295.
 *
 * ## A suggestion, and only the rider's tap changes anything
 *
 * The estimate is said as a suggestion beside the threshold the rider has now,
 * with a line saying it is a convention (`threshold-test-result.ts`), and two
 * answers: set it, or keep what they have. Nothing is written until they
 * press the first; the second, *Done* on the result card, or leaving the
 * screen, writes nothing. A test that made no estimate says why and offers
 * nothing to accept.
 *
 * ## One place writes a threshold
 *
 * The answer is written through the analysis port's `setAthleteThresholds`,
 * the write the Analysis screen's threshold form makes and the only one there
 * is (`analysis/store-port.ts`). It replaces BOTH thresholds, so the rider's
 * threshold heart rate is read first and written back as it was: only the
 * power changes, and heart rate is never inferred from a power test.
 *
 * Both answers are secondary buttons: the result card's *Done* is the Ride
 * screen's one primary while the card is up (#668).
 */
export interface ThresholdOfferProps {
  readonly offer: TestRideEstimate;
  /** The rider's threshold power now, or `undefined` with none set. */
  readonly current: Watts | undefined;
  /** Where the answer is written; `undefined` where this browser has no store. */
  readonly analysis: AnalysisPort | undefined;
  /** The rider set the estimate as their threshold power. */
  readonly onAccepted: (power: Watts) => void;
}

/** What the offer says. */
export const THRESHOLD_OFFER_TEXT = {
  heading: 'Threshold estimate',
  accept: (power: Watts): string => `Set my threshold to ${String(power)} W`,
  keep: 'Keep my threshold as it is',
  accepted: (power: Watts): string =>
    `Your threshold power is now ${String(power)} W. Workouts and zones use it from now on.`,
  kept: 'Your threshold power is as it was. Nothing was changed.',
  failed:
    'Your threshold could not be saved on this device, so it is as it was. You can set it on ' +
    'the Analysis screen.',
  noStore: 'This browser has no local store, so the estimate cannot be set from here.',
} as const;

type Answer = 'accepted' | 'kept' | 'failed';

export function ThresholdOffer({
  offer,
  current,
  analysis,
  onAccepted,
}: ThresholdOfferProps): JSX.Element {
  const headingId = useId();
  const [answer, setAnswer] = useState<Answer | undefined>(undefined);
  // A ref, not state: two presses inside one render both see the same state.
  const busy = useRef(false);
  /*
   * The threshold the rider had when they answered: the screen reads theirs
   * again once they accept, and "it is 247 W now" beside a suggestion of
   * 247 W would describe the answer rather than the question.
   */
  const [before, setBefore] = useState<Watts | undefined>(undefined);
  const shownCurrent = answer === undefined ? current : before;
  const estimate = offer.estimate.kind === 'estimate' ? offer.estimate.thresholdPower : undefined;

  async function accept(power: Watts): Promise<void> {
    if (analysis === undefined || busy.current) return;
    busy.current = true;
    setBefore(current);
    try {
      // Read first: the write replaces both thresholds, and heart rate stays.
      const athlete = await analysis.store.getAthlete(analysis.athleteId);
      await analysis.store.setAthleteThresholds(analysis.athleteId, {
        thresholdPower: power,
        thresholdHeartRate: athlete?.thresholdHeartRate,
      });
      setAnswer('accepted');
      onAccepted(power);
    } catch {
      setAnswer('failed');
    } finally {
      busy.current = false;
    }
  }

  return (
    <section aria-labelledby={headingId} data-oyl-threshold-offer="">
      <h3 id={headingId}>{THRESHOLD_OFFER_TEXT.heading}</h3>
      <p>{suggestionText(offer, shownCurrent)}</p>
      {estimate === undefined ? null : (
        <>
          <p className="oyl-muted">{conventionText(offer.test)}</p>
          {answer !== undefined ? null : analysis === undefined ? (
            <p>{THRESHOLD_OFFER_TEXT.noStore}</p>
          ) : (
            <p>
              <Button
                variant="secondary"
                type="button"
                onClick={() => {
                  void accept(estimate);
                }}
              >
                {THRESHOLD_OFFER_TEXT.accept(estimate)}
              </Button>{' '}
              <Button
                variant="secondary"
                type="button"
                onClick={() => {
                  setBefore(current);
                  setAnswer('kept');
                }}
              >
                {THRESHOLD_OFFER_TEXT.keep}
              </Button>
            </p>
          )}
        </>
      )}
      {answer === undefined || estimate === undefined ? null : (
        // The answer to the rider's own press, so it is `live` (#445's rule).
        <StatusMessage tone={answer === 'failed' ? 'warning' : 'success'} live>
          {answer === 'accepted'
            ? THRESHOLD_OFFER_TEXT.accepted(estimate)
            : answer === 'kept'
              ? THRESHOLD_OFFER_TEXT.kept
              : THRESHOLD_OFFER_TEXT.failed}
        </StatusMessage>
      )}
    </section>
  );
}
