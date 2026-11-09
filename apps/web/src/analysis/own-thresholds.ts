// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BeatsPerMinute, Watts } from '@onyourleft/domain';
import { useEffect, useState } from 'react';

import type { AnalysisPort } from './store-port';

/**
 * The rider's own thresholds, each `undefined` when they have not set it,
 * read through the analysis port — the one port that may read the athlete
 * record (`store-port.ts`). Moved here from `views/RideView.tsx` by #2305,
 * whose tailor pane on Workouts shows a built-in in watts from the same two
 * numbers.
 */
export interface OwnThresholds {
  readonly power: Watts | undefined;
  readonly heartRate: BeatsPerMinute | undefined;
}

const NO_THRESHOLDS: OwnThresholds = { power: undefined, heartRate: undefined };

/**
 * Read the athlete's thresholds once, for the ride screen's workout panel —
 * threshold heart rate too since #1240, which a heart-rate hold needs — and
 * since #2305 for the Workouts screen's tailor pane.
 *
 * `undefined` while it is being read and `undefined` when it is not set, and
 * the two are deliberately the same value: the panel's answer to both is the
 * same sentence, and a screen that distinguished "loading" from "not set" would
 * be offering a rider a state they cannot act on.
 */
export function useOwnThresholds(
  analysis: AnalysisPort | undefined,
  /**
   * Read again whenever this changes — #2307: the Ride screen bumps it once
   * the rider accepts a test's estimate, so the next workout started there is
   * ridden at the threshold they just set, not the one read on arrival.
   */
  version = 0,
): OwnThresholds {
  const [threshold, setThreshold] = useState<OwnThresholds>(NO_THRESHOLDS);
  useEffect(() => {
    if (analysis === undefined) {
      return;
    }
    let live = true;
    void analysis.store
      .getAthlete(analysis.athleteId)
      .then((athlete) => {
        if (live) {
          // The rider's own, and nothing substituted: `analysis/thresholds.ts`
          // is the one place a default is, and it is not for this screen.
          setThreshold({
            power: athlete?.thresholdPower,
            heartRate: athlete?.thresholdHeartRate,
          });
        }
      })
      .catch(() => {
        // A store that cannot be read leaves the threshold absent, which the
        // panel already explains. There is nothing else this screen can say
        // that a rider could act on.
      });
    return () => {
      live = false;
    };
  }, [analysis, version]);
  return threshold;
}
