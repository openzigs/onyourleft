// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a ride that has just been SAVED is shown as — #1042, the result card.
 *
 * ## Facts only, and only the ones already computed
 *
 * The card states four numbers and, sometimes, one sentence:
 *
 * | what | where it was computed |
 * |---|---|
 * | the ride's elapsed time | the recording engine, written to the activity (`recording/finish.ts`) |
 * | its distance | `finish.ts` §`distanceOf`, written to the activity |
 * | its average power | `finish.ts` §`averagePowerOf`, written to the activity |
 * | its average heart rate, where there is one | {@link statedAverageHeartRate} — the figure the ride's page states in its heart rate trace's description (`detail/TraceChart.tsx` §`describeTrace`), computed by the page's OWN two steps over the samples the save wrote |
 * | how the race against the rider's own best ended, in the trainer game | `game/ghost-outcome.ts`, LATCHED — carried here, never re-derived |
 *
 * ⚠️ **No score, no grade, no load, and no trademarked name** (CLAUDE.md §6):
 * nothing here is weighted, ranked or compared with anybody. And nothing here
 * is about the rider's body (ADR 0030): a heart rate is a sensor reading,
 * reported as one.
 *
 * ⚠️ **The pacer has no outcome here, on purpose.** A bot pacer never
 * finishes — `pacer/gap.ts` gives a live gap and nothing settles it — so there
 * is no latched answer to carry, and computing one here would be the
 * re-derivation `ghost-outcome.ts` exists to forbid.
 *
 * ## Why the game's outcome travels to the Ride screen
 *
 * The trainer game does not save a ride. What is saved is the RECORDING, which
 * `RideSession` keeps above the router while the rider is in the game and
 * which is stopped — and so saved — on the Ride screen. So the game hands the
 * ride controller the latched outcome of each game ride as it ends
 * (`game/trainer-port.ts` §`noteGameRideEnded`), the controller keeps the last
 * one for the recording in progress, and the card says it when THAT recording
 * is saved. A game ride with no recording under it is saved nowhere, and has
 * no card: the card never appears for an unsaved ride.
 */

import {
  beatsPerMinute,
  type BeatsPerMinute,
  type Metres,
  type Seconds,
  type Watts,
} from '@onyourleft/domain';
import type { ActivityId } from '@onyourleft/store';

import { CHART_POINTS, downsample, traceMean } from '../detail/series';
import type { GhostOutcome } from '../game/ghost-outcome-kind';

/** A saved ride's facts, as the result card states them. */
export interface SavedRide {
  /** The activity the ride became — the card links to its page. */
  readonly activityId: ActivityId;
  readonly elapsedTime: Seconds;
  readonly distance: Metres;
  /** `undefined` for a ride with no power reading at all. */
  readonly averagePower: Watts | undefined;
  /** `undefined` for a ride with no heart rate reading at all. */
  readonly averageHeartRate: BeatsPerMinute | undefined;
  /**
   * How the last trainer-game ride ridden during this recording ended against
   * the rider's own best, once settled — or `undefined`: no game ride, no
   * ghost, or a race not settled when the game ride ended.
   */
  readonly gameOutcome: GhostOutcome | undefined;
}

/**
 * The game's latched outcome, in a sentence about the rider's best.
 *
 * ⚠️ **Who did what is said outright**, `hud/fields.ts` §`SETTLED`'s rule:
 * there is no reading of any of these in which the wrong one won. And it is
 * the LAST trainer-game ride's (#1049's review): a recording can hold several
 * game rides, on different routes, and "that route" is the route of the one
 * whose settled answer the controller kept (`controller.ts`
 * §`noteGameRideEnded`).
 */
export const GAME_OUTCOME_TEXT: Readonly<Record<GhostOutcome, string>> = {
  beaten: 'In your last trainer game ride, you beat your best on that route.',
  level: 'In your last trainer game ride, you matched your best on that route.',
  'not-beaten': 'In your last trainer game ride, your best on that route finished ahead of you.',
};

/**
 * The average heart rate the ride's page states, or `undefined` for a ride
 * with no reading at all — the card's figure.
 *
 * ⚠️ **Not the plain mean of the readings, and that is the point** (#1049's
 * review). The ride's page reads the stored heart rate channel, reduces it to
 * {@link CHART_POINTS} buckets (`detail/series.ts` §`downsample`, each the mean
 * of the readings it has) and states the mean of THOSE (§`traceMean`, rounded
 * to a whole beat by the series' `format`). For a ride over 600 samples with a
 * gap, that is a mean of bucket means and is not the plain mean, so a card
 * computing the plain mean would state a different number for the same ride.
 * This is the page's two steps, called, not restated.
 */
export function statedAverageHeartRate(
  heartRate: readonly (BeatsPerMinute | undefined)[] | undefined,
): BeatsPerMinute | undefined {
  if (heartRate === undefined) {
    return undefined;
  }
  const mean = traceMean(downsample(heartRate, CHART_POINTS));
  return mean === undefined ? undefined : beatsPerMinute(Math.round(mean));
}

/**
 * The saved ride the card is for, or `undefined` when there must be no card.
 *
 * ⚠️ **One rule, and every half of it is a criterion of #1042.** A card only
 * for a ride that is STOPPED (never while recording or paused, so it can never
 * cover a ride control), whose stop has SETTLED, and whose save SUCCEEDED — a
 * failed save keeps its own sentence and no card, and an `empty` or
 * `unavailable` one has no activity to show. And with the last checkpoint
 * written (`storage` `ok`): otherwise the screen is telling the rider not to
 * close the tab, and the card's *Done* hands focus to *Start a new ride*,
 * which `ride/controller.ts` §`canStartNewRide` offers on exactly this rule.
 */
export function rideResultOf(state: {
  readonly phase: string;
  readonly stopping: boolean;
  readonly storage: string;
  readonly saveState: string;
  readonly savedRide: SavedRide | undefined;
}): SavedRide | undefined {
  if (
    state.phase !== 'stopped' ||
    state.stopping ||
    state.storage !== 'ok' ||
    state.saveState !== 'saved'
  ) {
    return undefined;
  }
  return state.savedRide;
}
