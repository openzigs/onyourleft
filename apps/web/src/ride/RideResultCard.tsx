// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The result card a rider sees once a ride is saved — #1042, epic #935.
 *
 * Like the end of a race in a game: the ride's numbers, large, and one thing
 * to press. What it may say is `ride-result.ts`'s, and when it is shown is
 * `ride-result.ts` §`rideResultOf`'s: only for a ride that is stopped and
 * SAVED, so never over a ride control and never for a ride that is not in the
 * rider's activities.
 *
 * ## A section of the page, not a dialog
 *
 * Nothing behind it is blocked: the stopped ride's own sentence stays above
 * it and *Start a new ride* below it, so a modal would trap focus away from a
 * screen that has nothing to protect. It is a GROUP named by its heading, in
 * the document where the tab order meets it — *Done*, then the ride's page.
 * ⚠️ Not a `section` landmark: the screen already has one unnamed `section`
 * (`WorkoutPanel`'s), and a second makes the two indistinguishable
 * (`a11y/audit.ts` §`landmarks-are-distinguishable`, which caught it).
 *
 * ## Announced politely, once
 *
 * One `role="status"` region, rendered EMPTY with the card and filled once in
 * an effect, so a screen reader hears the change (a region mounted with its
 * words already in it is read twice or not at all, `StatusMessage` §`live`).
 * It is filled once per saved ride: a re-render — the 1 Hz tick, a sensor
 * notification — writes the same words into a region already holding them,
 * which says nothing. While the card is up, the saved ride's own sentence
 * above it is not `live` (`RideView.tsx` §`StoppedNotice`), so this is the
 * one voice for the save.
 *
 * ⚠️ ***Done* is not a ride-time control** (`design/ride-time-controls.ts`):
 * it is pressed after the ride has ended, not to move one on, so it is 44 px
 * like every other button. It puts the card away and hands focus to *Start a
 * new ride*, which the card is only ever shown above (`rideResultOf` requires
 * what `canStartNewRide` requires).
 */

import { useEffect, useId, useState, type JSX } from 'react';

import { Button, ButtonLink } from '../design/Button';
import { Reading } from '../design/Reading';
import { formatDuration, formatPowerValue, POWER_UNIT } from '../format';
import { hrefForActivity } from '../shell/routes';
import { useUnits } from '../units/context';
import { distanceUnit, formatDistance, spokenDistanceUnit } from '../units/format';
import { GAME_OUTCOME_TEXT, type SavedRide } from './ride-result';

/** The unit a heart rate is shown in — `ride/MetricGrid.tsx`'s. */
const HEART_RATE_UNIT = 'bpm';

export interface RideResultCardProps {
  readonly result: SavedRide;
  /** *Done*: the card goes away. */
  readonly onDone: () => void;
}

export function RideResultCard({ result, onDone }: RideResultCardProps): JSX.Element {
  const units = useUnits();
  const headingId = useId();
  const distance = formatDistance(result.distance, units);
  const spoken = resultSentence(result, distance.value, spokenDistanceUnit(units));
  // Empty on the card's first render, then the sentence — the change is what a
  // screen reader announces. Keyed on the activity, so a re-render of the same
  // card writes nothing new.
  const [announced, setAnnounced] = useState('');
  useEffect(() => {
    setAnnounced(spoken);
  }, [result.activityId]);

  return (
    <div className="oyl-result" role="group" aria-labelledby={headingId} data-oyl-result-card="">
      <h3 id={headingId} className="oyl-result__heading">
        Ride saved
      </h3>
      <dl className="oyl-result__facts">
        <div>
          <dt>Elapsed</dt>
          <dd>
            <Reading value={formatDuration(result.elapsedTime)} />
          </dd>
        </div>
        <div>
          <dt>Distance</dt>
          <dd>
            <Reading value={distance.value} unit={distanceUnit(units)} />
          </dd>
        </div>
        <div>
          <dt>Average power</dt>
          <dd>
            {result.averagePower === undefined ? (
              'No power meter'
            ) : (
              <Reading value={formatPowerValue(result.averagePower)} unit={POWER_UNIT} />
            )}
          </dd>
        </div>
        {result.averageHeartRate === undefined ? null : (
          <div>
            <dt>Average heart rate</dt>
            <dd>
              <Reading value={String(result.averageHeartRate)} unit={HEART_RATE_UNIT} />
            </dd>
          </div>
        )}
      </dl>
      {result.gameOutcome === undefined ? null : (
        <p className="oyl-result__outcome">{GAME_OUTCOME_TEXT[result.gameOutcome]}</p>
      )}
      <div className="oyl-result__actions">
        <Button onClick={onDone}>Done</Button>
        <ButtonLink href={hrefForActivity(result.activityId)} variant="secondary">
          Open this ride
        </ButtonLink>
      </div>
      <p className="oyl-visually-hidden" role="status">
        {announced}
      </p>
    </div>
  );
}

/**
 * What the card's region says, once — the save, the two facts every ride has,
 * and the game's outcome where there is one. Distance in the unit's spoken
 * word, `units/format.ts` §`spokenDistanceUnit`'s reason.
 */
export function resultSentence(result: SavedRide, distance: string, spokenUnit: string): string {
  const facts = `Ride saved: ${formatDuration(result.elapsedTime)} elapsed, ${distance} ${spokenUnit}.`;
  return result.gameOutcome === undefined
    ? facts
    : `${facts} ${GAME_OUTCOME_TEXT[result.gameOutcome]}`;
}
