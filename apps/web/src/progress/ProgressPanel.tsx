// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Home's streaks and badges — #947.
 *
 * Every badge is a list item of plain text — what was done, and when — so a
 * screen reader reads a badge as a sentence and nothing is told by a picture
 * or a colour alone (the medal beside each is decoration, `aria-hidden`).
 *
 * ## Wording
 *
 * Plain and encouraging. Nothing about weight or the body (ADR 0030; the
 * whole-tree gate `camera/no-absolute-angles.test.ts` reads this file), and no
 * trademarked metric name (docs/agents/scope-and-ip.md §6): a best is "best 1 min power". A
 * streak that has ended is never called lost: the current streak reads nought
 * and the next ride starts a new one (the owner's ruling).
 *
 * ## No celebration that moves
 *
 * Nothing here animates, so there is nothing for reduced motion to stop and
 * nothing to show on a ride route.
 */

import { metres } from '@onyourleft/domain';
import { Award } from 'lucide-react';
import { useState, type JSX } from 'react';

import type { AnalysisPort } from '../analysis/store-port';
import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import { formatStartedAt } from '../format';
import { useUnits } from '../units/context';
import { formatDistance, formatSmallDistance, type Measurement } from '../units/format';

import {
  durationWords,
  RIDE_MINIMUM_MOVING_SECONDS,
  type Badge,
  type FirstKind,
  type Progress,
} from './progress';
import { lookAtOlderRides } from './ride-facts';
import type { ActivitySummary } from '@onyourleft/store';

const FIRSTS: Readonly<Record<FirstKind, string>> = {
  ride: 'First ride',
  workout: 'First workout finished',
  route: 'First saved route ridden',
  ghost: 'First ride against your ghost',
};

/** A whole number with its thousands grouped, and its unit. */
function grouped(measurement: Measurement): string {
  const value = Number(measurement.value);
  return `${Number.isFinite(value) ? Math.round(value).toLocaleString('en-GB') : measurement.value} ${measurement.unit}`;
}

/** What a badge says. */
export function badgeText(badge: Badge, units: Parameters<typeof formatDistance>[1]): string {
  switch (badge.kind) {
    case 'distance':
      return `${grouped(formatDistance(metres(badge.metres), units, 0))} ridden in all`;
    case 'climbing':
      return `${grouped(formatSmallDistance(badge.metres, units))} climbed in all`;
    case 'first':
      return FIRSTS[badge.first];
    case 'best':
      return `New best ${durationWords(badge.duration)} power: ${String(Math.round(badge.power))} W`;
  }
}

/** The badges as shown: every one, except that only the newest best stands for each duration. */
export function shownBadges(badges: readonly Badge[]): Badge[] {
  const seen = new Set<number>();
  return badges.filter((badge) => {
    if (badge.kind !== 'best') return true;
    if (seen.has(badge.duration)) return false;
    seen.add(badge.duration);
    return true;
  });
}

function weeks(count: number): string {
  return count === 1 ? '1 week' : `${String(count)} weeks`;
}

/** The streak as a sentence. Never a loss: a run that ended reads as the next one to start. */
export function streakText(progress: Progress): string {
  const { current, longest } = progress.streak;
  if (progress.rides === 0) {
    return `Your first ride of ${String(RIDE_MINIMUM_MOVING_SECONDS / 60)} minutes or more starts a streak of weeks with a ride.`;
  }
  const now =
    current === 0
      ? 'Your next ride starts a new streak.'
      : `You have ridden in ${weeks(current)} running.`;
  return `${now} Your longest run is ${weeks(longest)}.`;
}

/**
 * What a rider is told when a look at older rides skipped some (#947's
 * review, N3): they are still unread, tried again on the next look, and a
 * new best power is not claimed over them until then.
 */
function skippedText(count: number): string {
  const which = count === 1 ? '1 older ride' : `${String(count)} older rides`;
  return `${which} could not be read just now. ${count === 1 ? 'It is' : 'They are'} tried again when you look next, and until then a new best power may not be shown.`;
}

export interface ProgressPanelProps {
  readonly progress: Progress;
  readonly summaries: readonly ActivitySummary[];
  readonly analysis: AnalysisPort | undefined;
  /** Asked once a look at older rides has written something, so Home reads again. */
  readonly onRead: () => void;
}

export function ProgressPanel({
  progress,
  summaries,
  analysis,
  onRead,
}: ProgressPanelProps): JSX.Element {
  const units = useUnits();
  const [looking, setLooking] = useState(false);
  const [failed, setFailed] = useState(false);
  // #947's review (N3): rides the last look skipped because their samples
  // could not be read. They stay unread, so they hold a new best back.
  const [skipped, setSkipped] = useState(0);
  const badges = shownBadges(progress.badges);

  function look(): void {
    if (analysis === undefined || looking) return;
    setLooking(true);
    setFailed(false);
    setSkipped(0);
    lookAtOlderRides(analysis, summaries).then(
      (outcome) => {
        setLooking(false);
        setSkipped(outcome.unreadable);
        onRead();
      },
      () => {
        setLooking(false);
        setFailed(true);
      },
    );
  }

  return (
    <section className="oyl-panel oyl-progress" aria-labelledby="oyl-home-progress">
      <h2 id="oyl-home-progress">Streaks and badges</h2>
      <p>{streakText(progress)}</p>
      {badges.length === 0 ? (
        <p className="oyl-muted">
          Badges arrive with your rides: distance, climbing and new bests.
        </p>
      ) : (
        <ul className="oyl-progress__badges" aria-label="Your badges">
          {badges.map((badge) => (
            <li
              key={`${badge.kind}-${badge.activityId}-${badge.kind === 'first' ? badge.first : badge.kind === 'best' ? String(badge.duration) : String(badge.metres)}`}
              className="oyl-badge"
            >
              <Award className="oyl-badge__mark" aria-hidden="true" focusable="false" />
              <span className="oyl-badge__words">
                <span className="oyl-badge__what">{badgeText(badge, units)}</span>{' '}
                <span className="oyl-badge__when">
                  {formatStartedAt(badge.earnedAt, badge.timeZone)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {progress.unread === 0 || analysis === undefined ? null : (
        <>
          <p className="oyl-muted">
            {progress.unread === 1
              ? '1 ride from before badges has not been looked at for climbing and best power yet.'
              : `${String(progress.unread)} rides from before badges have not been looked at for climbing and best power yet.`}
          </p>
          <p>
            <Button variant="secondary" onClick={look} unavailable={looking}>
              {looking ? 'Looking at older rides…' : 'Look at older rides'}
            </Button>
          </p>
        </>
      )}
      {failed ? (
        <StatusMessage tone="warning">Your older rides could not be read just now.</StatusMessage>
      ) : null}
      {skipped === 0 ? null : <StatusMessage tone="warning">{skippedText(skipped)}</StatusMessage>}
    </section>
  );
}
