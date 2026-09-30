// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **"May be raced" — the consent on a ride's own page** (#793, ADR 0021
 * D-5.1, ADR 0039 D-2.1).
 *
 * One checkbox, per ride, **off unless the rider turns it on**, and revocable
 * the same way. It is the one place in the client that sets
 * `ActivityRecord.mayBeRaced`, and it is deliberately NOT the share setting:
 * ADR 0021 D-5.1 says sharing a ride is not consent to being raced, so the
 * sentence beside the box says so in plain words.
 *
 * ## What it says, and why that sentence is kept on the screen
 *
 * {@link RACE_CONSENT_SENTENCE} says what the box allows — what another rider
 * would race and where — that it is off by default, that it can be turned
 * off, and that sharing does not turn it on. It is privacy text in #666's
 * sense, so it is marked {@link KeptVisible} and listed in
 * `a11y/kept-visible.a11y.test.tsx` for this route: it can never be tucked
 * into a "More about" disclosure.
 *
 * ## What it reads back
 *
 * A change is written through the store's narrow write and then **read back**
 * through `getActivity`; the box shows what the read says, never what was
 * asked for. A write that reported success and did not land (CLAUDE.md §5)
 * leaves the box where the disk is, and says so.
 *
 * ## The privacy-zone refusal, beside it
 *
 * For a ride on a saved route, the route and the rider's zones are read and
 * `race-consent.ts` §`offeredAsGhost` asked. Where a zone touches the route
 * (ADR 0021 D-5.2), the page says the ride will never be offered, whatever
 * the box says. A free ride has no route to race and reads no zone.
 *
 * ⚠️ **Nothing in this build races another rider's ghost** — #331 does, later
 * — so {@link RACE_CONSENT_NOT_YET} says the answer is kept for when it does,
 * rather than letting the box read as a feature that exists.
 */

import { useEffect, useId, useState, type JSX } from 'react';

import type { ActivityRecord } from '@onyourleft/store';

import { KeptVisible } from '../design/MoreAbout';
import { StatusMessage } from '../design/StatusMessage';

import { offeredAsGhost } from './race-consent';
import type { DetailPort } from './store-port';

export const RACE_CONSENT_HEADING = 'Racing this ride';

/** What the box allows, in plain words. Kept visible (#666). */
export const RACE_CONSENT_SENTENCE =
  'If you allow it, another rider can race a ghost of this ride on the same route: how far along ' +
  'the route you were at each moment, replayed on their own screen. It is off unless you turn it ' +
  'on, you can turn it off at any time, and sharing a ride does not turn it on.';

export const RACE_CONSENT_LABEL = 'Allow other riders to race a ghost of this ride';

/** Said beside the box, because the feature it consents to is not built yet. */
export const RACE_CONSENT_NOT_YET =
  'This version of the app does not race another rider’s ghost yet. Your answer is kept for when one does.';

/** ADR 0021 D-5.2: the route touches one of the rider's zones. */
export const RACE_CONSENT_ZONE_REFUSAL =
  'This ride’s route passes through one of your privacy zones, so it will never be offered as ' +
  'a ghost, whatever you choose here.';

/** The write was refused, or did not land. */
export const RACE_CONSENT_NOT_SAVED = 'Your choice could not be saved, so nothing changed.';

type ZoneState = 'unknown' | 'clear' | 'touches';

export function RaceConsentSection({
  port,
  activity,
}: {
  readonly port: DetailPort;
  readonly activity: ActivityRecord;
}): JSX.Element {
  const [consented, setConsented] = useState(activity.mayBeRaced);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [zones, setZones] = useState<ZoneState>('unknown');
  const headingId = useId();
  const sentenceId = useId();
  const boxId = useId();

  useEffect(() => {
    setConsented(activity.mayBeRaced);
  }, [activity]);

  useEffect(() => {
    const { routeId } = activity;
    if (routeId === undefined) return;
    let live = true;
    void (async () => {
      try {
        const [route, own] = await Promise.all([
          port.store.getRoute(port.athleteId, routeId),
          port.store.listPrivacyZones(port.athleteId),
        ]);
        if (!live || route === undefined) return;
        setZones(offeredAsGhost(route.profile.positions, own) ? 'clear' : 'touches');
      } catch {
        // Nothing is said about zones that could not be read: the refusal is
        // made where an offer is decided (#331), not only here.
      }
    })();
    return () => {
      live = false;
    };
  }, [port, activity]);

  const choose = async (wanted: boolean): Promise<void> => {
    // One write at a time: a second press while one is in flight is ignored,
    // rather than disabling the box and taking it out of the tab order.
    if (saving) return;
    setSaving(true);
    setFailed(false);
    try {
      await port.store.setActivityMayBeRaced(port.athleteId, activity.id, wanted);
      const read = await port.store.getActivity(port.athleteId, activity.id);
      const stored = read?.mayBeRaced ?? consented;
      setConsented(stored);
      if (stored !== wanted) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="oyl-race-consent" role="group" aria-labelledby={headingId}>
      <h3 id={headingId}>{RACE_CONSENT_HEADING}</h3>
      <KeptVisible>
        <p id={sentenceId}>{RACE_CONSENT_SENTENCE}</p>
      </KeptVisible>
      <p>
        <label htmlFor={boxId}>
          <input
            id={boxId}
            type="checkbox"
            checked={consented}
            aria-describedby={sentenceId}
            onChange={(event) => {
              void choose(event.target.checked);
            }}
          />{' '}
          {RACE_CONSENT_LABEL}
        </label>
      </p>
      <p className="oyl-muted">{RACE_CONSENT_NOT_YET}</p>
      {zones === 'touches' ? (
        <StatusMessage tone="warning">{RACE_CONSENT_ZONE_REFUSAL}</StatusMessage>
      ) : null}
      {failed ? (
        <StatusMessage tone="danger" live>
          {RACE_CONSENT_NOT_SAVED}
        </StatusMessage>
      ) : null}
    </div>
  );
}
