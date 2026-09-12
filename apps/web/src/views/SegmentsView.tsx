// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react';

import { unixSeconds, type SegmentVisibility } from '@onyourleft/domain';
import {
  activityId,
  type ActivitySummary,
  type SegmentRecord,
  type UnitSystem,
} from '@onyourleft/store';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import {
  createSegmentFromRide,
  DUPLICATE_SCAN_LIMIT,
  segmentRefusals,
  type SegmentOverlap,
} from '../segments/create';
import type { SegmentPort } from '../segments/store-port';
import { hrefForSegment } from '../shell/routes';
import { useUnits } from '../units/context';
import { formatSmallDistance, measurementText } from '../units/format';

/**
 * One text field of a submitted form.
 *
 * `FormData.get` returns `string | File | null`, and `String(aFile)` is
 * `[object File]` — which would reach `activityId()` as an id nothing matches,
 * or a segment's name as that literal string. Narrowing to `string` here means
 * a file dropped onto a text input becomes an empty field, which every guard
 * below already handles.
 */
function fieldOf(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

/**
 * A segment's length, at the **small** scale — metres, or feet for a rider who
 * reads in them (#238).
 *
 * Not `units/format.ts`'s `formatDistance`, which renders kilometres or miles
 * to one decimal: a segment runs from the 400 m minimum to a few kilometres,
 * and "0.4 km" throws away the digit that distinguishes one climb from
 * another. The small scale is also what every other sentence on this screen
 * uses for a segment — the minimum length, the endpoint radius — so the screen
 * says one thing.
 */
function segmentLength(distance: number, units: UnitSystem): string {
  return measurementText(formatSmallDistance(distance, units));
}

/**
 * Segments (#64) — the ones this device holds, and making a new one from a
 * stretch of one of your own rides.
 *
 * ## What this screen is careful about
 *
 * **It never claims a segment is public when it is not.** #64's third and
 * fourth criteria both *downgrade* a requested visibility — a near-duplicate
 * and a start inside a privacy zone are each forced `private` — and the
 * downgrade is applied to the record that gets written, in `segments/create.ts`,
 * not to a label here. This screen reads the visibility **off the written
 * record** and reports what actually happened. ADR 0004 decision C's rule about
 * client-side hiding cuts the same way in reverse: a screen that showed one
 * thing and stored another would be lying in the safer-looking direction.
 *
 * **It says why, every time.** A downgrade with no explanation is how a rider
 * learns to distrust the setting. Each note is a sentence in `create.ts`, kept
 * beside the rule that produces it.
 *
 * **Colour carries nothing.** Every segment's visibility is a word in its own
 * cell, and every overlap is a named segment with a percentage, for
 * `AnalysisView.tsx`'s reason: #48's criteria are met most cheaply by not
 * encoding anything in colour in the first place.
 *
 * ⚠️ **There is no map here yet.** #63's map needs a published tile archive
 * (#53) and the span is chosen by sample index rather than by dragging on a
 * line. That is a real limitation of this screen and it is stated on it rather
 * than left for a rider to infer from an absence.
 */
export interface SegmentsViewProps {
  /**
   * The local store, or `undefined` where there is none.
   *
   * `undefined` is not an error state: it is what the accessibility suite
   * renders and what a browser with no usable IndexedDB gets. The view says so
   * plainly rather than showing an empty table, which would claim the rider has
   * no segments.
   */
  readonly port?: SegmentPort | undefined;
}

/**
 * How many rides the "cut a segment from" chooser offers.
 *
 * A bound rather than "all of them", for `analysis/load.ts`'s reason: a decade
 * of riding is thousands of rows and a `<select>` of thousands is not a chooser.
 * Newest first, which is what the store's default order already gives.
 */
export const RIDE_CHOICE_LIMIT = 100;

/** What the form is currently reporting. */
interface Outcome {
  readonly tone: 'success' | 'warning' | 'danger';
  readonly message: string;
  readonly notes: readonly string[];
  readonly overlaps: readonly SegmentOverlap[];
}

export function SegmentsView({ port }: SegmentsViewProps): JSX.Element {
  const [segments, setSegments] = useState<readonly SegmentRecord[] | undefined>(undefined);
  const [rides, setRides] = useState<readonly ActivitySummary[] | undefined>(undefined);
  const [outcome, setOutcome] = useState<Outcome | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const units = useUnits();

  const refresh = useCallback(async (): Promise<void> => {
    if (port === undefined) {
      return;
    }
    const [mine, library] = await Promise.all([
      port.store.listSegments(port.athleteId, DUPLICATE_SCAN_LIMIT),
      port.store.listActivitySummaries(port.athleteId, { limit: RIDE_CHOICE_LIMIT }),
    ]);
    setSegments(mine);
    setRides(library);
  }, [port]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (port === undefined || busy) {
      return;
    }
    const form = new FormData(event.currentTarget);
    const ride = fieldOf(form, 'ride');
    if (ride === '') {
      setOutcome({
        tone: 'danger',
        message: segmentRefusals(units).notYours,
        notes: [],
        overlaps: [],
      });
      return;
    }

    setBusy(true);
    try {
      const created = await createSegmentFromRide(port, {
        units,
        // The id is generated here rather than by the store, because there is
        // no server to allocate one (owner decision D6) and `crypto.randomUUID`
        // is the platform's own collision-resistant source.
        id: crypto.randomUUID(),
        activityId: activityId(ride),
        name: fieldOf(form, 'name'),
        from: Number(fieldOf(form, 'from')),
        to: Number(fieldOf(form, 'to')),
        requestedVisibility: (fieldOf(form, 'visibility') || 'private') as SegmentVisibility,
        createdAt: unixSeconds(Math.floor(Date.now() / 1000)),
      });

      if (created.kind === 'refused') {
        setOutcome({ tone: 'danger', message: created.message, notes: [], overlaps: [] });
        return;
      }

      // Read off the WRITTEN record, never off what was requested. This is the
      // sentence the file comment is about.
      const saved = created.record.visibility;
      setOutcome({
        tone: created.notes.length === 0 ? 'success' : 'warning',
        message: `Saved “${created.record.name}”, ${segmentLength(created.record.distance, units)} long, as ${saved}.`,
        notes: created.notes,
        overlaps: created.overlaps,
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (port === undefined) {
    return (
      <StatusMessage tone="info" label="No storage">
        This browser has no usable local database, so segments cannot be made or kept here. Nothing
        has been lost — the rides on other devices are unaffected.
      </StatusMessage>
    );
  }

  // Only rides with a track are offered — an indoor ride has no road.
  const withTrack = (rides ?? []).filter((ride) => ride.hasPosition);

  return (
    <>
      <section aria-labelledby="segments-make">
        <h2 id="segments-make">Make a segment</h2>
        <p className="oyl-muted">
          A segment is a stretch of road with a direction, cut from one of your own rides. The climb
          and its descent are two different segments, because they are two different efforts.
        </p>
        <p className="oyl-muted">
          There is no map on this screen yet, so the stretch is chosen by the first and last
          recorded second of the ride rather than by dragging on a line.
        </p>

        {rides === undefined ? (
          <p className="oyl-muted">Reading your rides…</p>
        ) : withTrack.length === 0 ? (
          <StatusMessage tone="info" label="Nothing to cut from">
            None of the rides on this device has position data. An indoor ride is recorded without
            one, which is normal and is not a fault.
          </StatusMessage>
        ) : (
          <form
            className="oyl-form"
            onSubmit={(event) => {
              void submit(event);
            }}
          >
            <p className="oyl-field">
              <label htmlFor="segment-ride">Ride</label>
              <select id="segment-ride" name="ride" defaultValue={withTrack[0]?.id ?? ''}>
                {withTrack.map((ride) => (
                  <option key={ride.id} value={ride.id}>
                    {ride.name}
                  </option>
                ))}
              </select>
            </p>
            <p className="oyl-field">
              <label htmlFor="segment-name">Name</label>
              <input id="segment-name" name="name" type="text" defaultValue="" />
            </p>
            <p className="oyl-field">
              <label htmlFor="segment-from">First second</label>
              <input id="segment-from" name="from" type="number" min="0" defaultValue="0" />
            </p>
            <p className="oyl-field">
              <label htmlFor="segment-to">Last second</label>
              <input id="segment-to" name="to" type="number" min="0" defaultValue="600" />
            </p>
            <p className="oyl-field">
              <label htmlFor="segment-visibility">Who can see it</label>
              <select id="segment-visibility" name="visibility" defaultValue="private">
                <option value="private">Only me</option>
                <option value="public">Anyone</option>
              </select>
            </p>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Make the segment'}
            </Button>
          </form>
        )}

        {outcome === undefined ? null : (
          <>
            <StatusMessage tone={outcome.tone} live>
              {outcome.message}
            </StatusMessage>
            {outcome.notes.map((note) => (
              <StatusMessage key={note} tone="info" label="Why">
                {note}
              </StatusMessage>
            ))}
            {outcome.overlaps.length === 0 ? null : (
              <>
                <h3>Segments this one runs along</h3>
                <ul>
                  {outcome.overlaps.map((overlap) => (
                    <li key={overlap.id}>
                      {overlap.name} — {Math.round(overlap.fraction * 100)}% of the new segment
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="segments-yours">
        <h2 id="segments-yours">Your segments</h2>
        {segments === undefined ? (
          <p className="oyl-muted">Reading your segments…</p>
        ) : segments.length === 0 ? (
          <p className="oyl-muted">No segments yet. Make one from a ride above.</p>
        ) : (
          <table className="oyl-data-table">
            <caption>Segments on this device, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Distance</th>
                <th scope="col">Climb</th>
                <th scope="col">Who can see it</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((segment) => (
                <tr key={segment.id}>
                  <td>
                    {/* The link is the row's only affordance, and a plain
                        anchor on purpose: the shell's hash routing means the
                        browser's own middle-click, open-in-new-tab and every
                        assistive technology's link handling work with no key
                        handler of ours in the path (`shell/routes.ts`). */}
                    <a href={hrefForSegment(segment.id)}>{segment.name}</a>
                  </td>
                  <td>{segmentLength(segment.distance, units)}</td>
                  {/*
                    "Not measured", never "0 m". An unmeasured climb and a flat
                    road are different claims, which is why the record's
                    elevation fields are optional rather than defaulted.
                  */}
                  <td>
                    {segment.elevationGain === undefined
                      ? 'Not measured'
                      : measurementText(formatSmallDistance(segment.elevationGain, units))}
                  </td>
                  {/* A word, not a colour. */}
                  <td>{segment.visibility === 'private' ? 'Only me' : 'Anyone'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
