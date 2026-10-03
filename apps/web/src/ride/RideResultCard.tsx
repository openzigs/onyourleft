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
 * While the card is up, the saved ride's own sentence above it is not `live`
 * (`RideView.tsx` §`StoppedNotice`), so this is the one voice for the save.
 *
 * ⚠️ **Once per saved RIDE, not once per mount** (#1049's review). The Ride
 * screen is under the router and the ride controller above it, so a rider who
 * goes to Activities and back mounts a second card for the same ride. Whether
 * it may speak is therefore the controller's (`RideSnapshot.resultAnnounced`),
 * read ONCE as the card mounts, and the card tells the controller when it has
 * spoken. A re-render — the 1 Hz tick, a sensor notification, the controller
 * recording that it spoke — changes nothing in the region.
 *
 * ⚠️ **A change of units while the card is up re-announces nothing**, and that
 * is decided, not overlooked: the effect runs once per mount and reads the
 * sentence of that moment. The readings on the card follow the new unit at
 * once; the region keeps the words it already spoke, because writing the
 * sentence again in the new unit would be a second announcement of the same
 * save, which is what this section forbids.
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
import {
  formatDuration,
  formatPowerValue,
  noPowerText,
  POWER_UNIT,
  shownAveragePower,
} from '../format';
import { hrefForActivity } from '../shell/routes';
import { useUnits } from '../units/context';
import { distanceUnit, formatDistance, spokenDistanceUnit } from '../units/format';
import { GAME_OUTCOME_TEXT, type SavedRide } from './ride-result';

/** The unit a heart rate is shown in — `ride/MetricGrid.tsx`'s. */
const HEART_RATE_UNIT = 'bpm';

export interface RideResultCardProps {
  readonly result: SavedRide;
  /**
   * Whether this card may speak its sentence. `false` when it already has for
   * this ride (a card mounted again), and when another voice on the screen is
   * carrying the save (`RideView.tsx` §`StoppedNotice`'s leftover warning).
   * Read once, as the card mounts.
   */
  readonly announce: boolean;
  /** The card has filled its region — the controller records it. */
  readonly onAnnounced: () => void;
  /** *Done*: the card goes away. */
  readonly onDone: () => void;
}

/**
 * ⚠️ Mount it with `key={result.activityId}`: everything here that happens
 * once happens once per MOUNT, so a card for a different ride must be a
 * different mount.
 */
export function RideResultCard({
  result,
  announce,
  onAnnounced,
  onDone,
}: RideResultCardProps): JSX.Element {
  const units = useUnits();
  const headingId = useId();
  const distance = formatDistance(result.distance, units);
  // #1054: a ride whose power readings were all 0 saves an average of 0 W, and
  // that says nothing was measured — the card says what it says for no power.
  const averagePower = shownAveragePower(result.averagePower);
  const spoken = resultSentence(result, distance.value, spokenDistanceUnit(units));
  // Decided as the card mounts. The controller hearing `onAnnounced` turns the
  // prop to `false` on the very next render, and that must not empty the
  // region this card has just filled.
  const [speaks] = useState(announce);
  // Empty on the card's first render, then the sentence — the change is what a
  // screen reader announces.
  const [announced, setAnnounced] = useState('');
  useEffect(() => {
    if (!speaks) {
      return;
    }
    setAnnounced(spoken);
    onAnnounced();
    // Once per mount, deliberately — see "A change of units" above.
  }, []);

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
            {averagePower === undefined ? (
              noPowerText(result.averagePower)
            ) : (
              <Reading value={formatPowerValue(averagePower)} unit={POWER_UNIT} />
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
