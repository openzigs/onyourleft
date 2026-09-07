// SPDX-License-Identifier: AGPL-3.0-or-later

import { lazy, Suspense, useCallback, useEffect, useState, type JSX } from 'react';

import { LOAD_AT_THRESHOLD_FOR_ONE_HOUR, type RideLoad } from '@onyourleft/domain';
import { activityId, type ActivityId, type ActivitySummary } from '@onyourleft/store';

import {
  loadLibraryBests,
  loadRideChoices,
  loadRideZones,
  type LibraryBests,
  type RideZoneAnalysis,
  type ZoneBreakdown,
} from '../analysis/load';
import {
  coverageNote,
  durationLabel,
  formatLoad,
  LOAD_BASIS_TEXT,
  ZONE_BOUNDARY_NOTE,
  zoneRows,
} from '../analysis/present';
import {
  backfillLoadSummaries,
  loadFitnessHistory,
  type FitnessHistory,
} from '../analysis/history';
import { sampledPoints, trendReadings, trendSentence } from '../analysis/trend';
import { ChartSlot } from '../design/ChartSlot';
import type { AnalysisPort } from '../analysis/store-port';
import { thresholdsToSave } from '../analysis/thresholds';
import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import { VisuallyHidden } from '../design/VisuallyHidden';
import { formatDuration, formatPowerValue, formatStartedAt, POWER_UNIT } from '../format';
import { hrefFor, routeById } from '../shell/routes';

/**
 * Training zones and duration personal bests (#78).
 *
 * ## Colour carries nothing here, and that is the design rather than a gap
 *
 * #78's seventh criterion is that *"colour is never the only carrier of which
 * zone is which"*. The strong form of passing that is to not encode anything in
 * colour at all, which is what this screen does: every zone is a labelled row
 * carrying its **name**, its **range in watts or beats**, its **time** and its
 * **share**, and the bar beside them is one accent fill whose only job is
 * length. It is `aria-hidden`, because it repeats the percentage that is
 * already in the row and a screen reader announcing both would read the same
 * number twice.
 *
 * A seven-hue intensity ramp would be prettier. It would also be seven new
 * colour tokens that each have to clear WCAG 2.2 SC 1.4.11 against two
 * backgrounds *and* stay distinguishable under the common colour-vision
 * deficiencies, and #48's contrast gate is where that would have to be ruled
 * on. That is a design decision with a gate attached, not a tidy-up, so it is
 * not made here as a side effect of a feature that needs no colour to be
 * correct.
 *
 * ## Duration bests are not segment bests, and the screen says so
 *
 * #78's eighth criterion: *"my best 20 minutes" and "my best on Box Hill" are
 * never confused*. They are different objects — one is the best average power
 * over a **span of time**, anywhere in any ride; the other is the best time
 * over a **named piece of road**. Segment bests are #67 and do not exist on
 * this device yet, so the honest thing is not to leave a silent absence: the
 * bests panel names what it is measuring in its own caption, and says in words
 * that segment bests are a separate thing this device does not hold. A rider
 * who later sees both will already have been told they are different.
 */
export interface AnalysisViewProps {
  /**
   * The local store, or `undefined` where there is none.
   *
   * `undefined` is not an error state: it is what the accessibility suite
   * renders and what a browser with no usable IndexedDB gets. The view says so
   * plainly rather than showing empty tables, which would claim the rider has
   * no rides and no bests.
   */
  readonly port?: AnalysisPort | undefined;
}

/**
 * The chart, fetched on first use.
 *
 * `React.lazy` rather than a static import, for the reason `design/ChartSlot.tsx`
 * records: a chart imported eagerly throws during the page's own render, before
 * the boundary that is supposed to replace it with its table can run. #48's
 * seventh criterion is that a failing chart does not take the page with it, and
 * this is the half of it that lives at the call site.
 */
const FitnessChart = lazy(async () => import('../analysis/FitnessChart'));

type LoadState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly rides: readonly ActivitySummary[];
      readonly bests: LibraryBests;
    }
  | { readonly kind: 'failed'; readonly reason: string };

export function AnalysisView({ port }: AnalysisViewProps): JSX.Element {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [selected, setSelected] = useState<ActivityId | undefined>(undefined);
  const [zones, setZones] = useState<RideZoneAnalysis | undefined>(undefined);
  /** What the threshold form holds, as typed. Empty means "not set". */
  const [powerField, setPowerField] = useState('');
  const [heartRateField, setHeartRateField] = useState('');
  const [saved, setSaved] = useState<string | undefined>(undefined);
  /** Bumped on save, so the zones and the load reload against the new numbers. */
  const [thresholdVersion, setThresholdVersion] = useState(0);
  const [history, setHistory] = useState<FitnessHistory | undefined>(undefined);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillNote, setBackfillNote] = useState<string | undefined>(undefined);

  const load = useCallback(async (): Promise<void> => {
    if (port === undefined) {
      return;
    }
    setState({ kind: 'loading' });
    // `thresholdVersion` is read so that saving a threshold redraws the history
    // too — every point of it is derived from the number that just changed.
    void thresholdVersion;
    try {
      const rides = await loadRideChoices(port);
      const bests = await loadLibraryBests(port);
      setState({ kind: 'ready', rides, bests });
      // Separate from the ready state deliberately: the history is one list
      // read and no decode, so it does not need to hold up the rest of the
      // screen, and a failure to draw it must not empty the page.
      setHistory(await loadFitnessHistory(port));
      // The newest ride, so the screen opens on something rather than on a
      // prompt to choose. A rider arriving here has just finished a ride far
      // more often than they have come to compare an old one.
      setSelected(rides[0]?.id);
    } catch (error: unknown) {
      // Said out loud rather than rendered as empty tables. "You have no
      // rides" is indistinguishable from the truth and is the answer a rider
      // would act on.
      setState({ kind: 'failed', reason: error instanceof Error ? error.message : String(error) });
    }
  }, [port, thresholdVersion]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (port === undefined || selected === undefined) {
      setZones(undefined);
      return;
    }
    let live = true;
    void (async () => {
      const result = await loadRideZones(port, selected);
      if (live) {
        setZones(result);
      }
    })();
    return () => {
      live = false;
    };
  }, [port, selected, thresholdVersion]);

  // The form is seeded from what is stored, and only from what is *stored*: an
  // assumed default must not be typed into the box, or a rider who never set a
  // threshold would save 200 W as though they had chosen it.
  useEffect(() => {
    if (zones === undefined) {
      return;
    }
    setPowerField(
      zones.thresholds.assumed.power ? '' : String(Math.round(zones.thresholds.thresholdPower)),
    );
    setHeartRateField(
      zones.thresholds.assumed.heartRate
        ? ''
        : String(Math.round(zones.thresholds.thresholdHeartRate)),
    );
  }, [zones]);

  const runBackfill = useCallback(async (): Promise<void> => {
    if (port === undefined) {
      return;
    }
    setBackfilling(true);
    try {
      const outcome = await backfillLoadSummaries(port);
      setBackfillNote(
        `Measured ${String(outcome.computed)} more ${outcome.computed === 1 ? 'ride' : 'rides'}` +
          (outcome.skipped === 0
            ? ''
            : `, and could not measure ${String(outcome.skipped)} — too short, or no usable trace`) +
          (outcome.remaining === 0 ? '.' : `. ${String(outcome.remaining)} still to go.`),
      );
      setHistory(await loadFitnessHistory(port));
    } finally {
      setBackfilling(false);
    }
  }, [port]);

  const saveThresholds = useCallback(async (): Promise<void> => {
    if (port === undefined) {
      return;
    }
    const decision = thresholdsToSave(powerField, heartRateField);
    if (decision.kind === 'refused') {
      setSaved(decision.reason);
      return;
    }
    await port.store.setAthleteThresholds(port.athleteId, {
      thresholdPower: decision.thresholdPower,
      thresholdHeartRate: decision.thresholdHeartRate,
    });
    setSaved('Saved. Every zone and every load on this page now uses these numbers.');
    setThresholdVersion((version) => version + 1);
  }, [port, powerField, heartRateField]);

  if (port === undefined) {
    return (
      <>
        <StatusMessage tone="danger">
          No local store on this browser. Rides are kept in this browser&rsquo;s own storage and
          this page cannot reach it — a private window or blocked site data is the usual reason.
        </StatusMessage>
        <p>
          <a href={hrefFor(routeById('activities'))}>Your rides</a>
          {' · '}
          <a href={hrefFor(routeById('transfer'))}>Import or export files</a>
        </p>
      </>
    );
  }

  return (
    <>
      {state.kind === 'failed' ? (
        <StatusMessage tone="warning" live>
          Could not read the rides on this device. {state.reason}
        </StatusMessage>
      ) : undefined}

      <section className="oyl-panel" aria-labelledby="oyl-zones-heading">
        <h2 id="oyl-zones-heading">Time in zone</h2>

        <p>
          <label htmlFor="oyl-zone-ride">Ride</label>{' '}
          <select
            className="oyl-input"
            id="oyl-zone-ride"
            value={selected ?? ''}
            onChange={(event) => {
              setSelected(event.target.value === '' ? undefined : activityId(event.target.value));
            }}
          >
            {state.kind === 'ready' && state.rides.length > 0 ? (
              state.rides.map((ride) => (
                <option key={ride.id} value={ride.id}>
                  {ride.name} — {formatStartedAt(ride.startedAt, ride.startedAtTimeZone)}
                </option>
              ))
            ) : (
              <option value="">
                {state.kind === 'loading' ? 'Reading your rides…' : 'No rides on this device'}
              </option>
            )}
          </select>
        </p>

        {zones?.load === undefined ? undefined : <LoadPanel load={zones.load} />}

        {zones === undefined ? (
          <p className="oyl-muted">
            {state.kind === 'ready' && state.rides.length === 0
              ? 'Nothing recorded yet. Zones appear here the moment you finish a ride.'
              : 'Reading that ride…'}
          </p>
        ) : (
          <>
            {zones.power === undefined && zones.heartRate === undefined ? (
              <p className="oyl-muted">
                That ride has no power and no heart-rate data, so there are no zones to show. A ride
                recorded without a power meter or a strap carries neither.
              </p>
            ) : undefined}

            {zones.power === undefined ? undefined : (
              <ZoneTable
                breakdown={zones.power}
                movingTime={zones.movingTime}
                unit={POWER_UNIT}
                heading="Power zones"
                thresholdNoun="threshold power"
                assumed={zones.thresholds.assumed.power}
              />
            )}

            {zones.heartRate === undefined ? undefined : (
              <ZoneTable
                breakdown={zones.heartRate}
                movingTime={zones.movingTime}
                unit="bpm"
                heading="Heart-rate zones"
                thresholdNoun="threshold heart rate"
                assumed={zones.thresholds.assumed.heartRate}
              />
            )}
          </>
        )}
      </section>

      <section className="oyl-panel" aria-labelledby="oyl-fitness-heading">
        <h2 id="oyl-fitness-heading">Fitness and fatigue</h2>
        <p className="oyl-muted">
          Your training load, smoothed two ways: <strong>fitness</strong> over about six weeks and{' '}
          <strong>fatigue</strong> over about one. <strong>Freshness</strong> is the gap between
          them. Rising fatigue is what training looks like, not a warning — this page reports what
          moved and by how much, and does not tell you whether that is good.
        </p>

        {history === undefined ? (
          <p className="oyl-muted">Reading your history…</p>
        ) : (
          <FitnessPanel
            history={history}
            backfilling={backfilling}
            note={backfillNote}
            onBackfill={() => {
              void runBackfill();
            }}
          />
        )}
      </section>

      <section className="oyl-panel" aria-labelledby="oyl-thresholds-heading">
        <h2 id="oyl-thresholds-heading">Your thresholds</h2>
        <p className="oyl-muted">
          Every zone boundary and every load on this page is derived from these two numbers. Leave
          one blank to go back to the assumed default. Nothing is sent anywhere — they are stored on
          this device with your rides.
        </p>

        <div className="oyl-trainer__form">
          <p>
            <label htmlFor="oyl-threshold-power">Threshold power ({POWER_UNIT})</label>{' '}
            <input
              className="oyl-input"
              id="oyl-threshold-power"
              inputMode="numeric"
              value={powerField}
              placeholder="not set"
              onChange={(event) => {
                setPowerField(event.target.value);
                setSaved(undefined);
              }}
            />
          </p>
          <p>
            <label htmlFor="oyl-threshold-heart-rate">Threshold heart rate (bpm)</label>{' '}
            <input
              className="oyl-input"
              id="oyl-threshold-heart-rate"
              inputMode="numeric"
              value={heartRateField}
              placeholder="not set"
              onChange={(event) => {
                setHeartRateField(event.target.value);
                setSaved(undefined);
              }}
            />
          </p>
          <Button
            onClick={() => {
              void saveThresholds();
            }}
          >
            Save thresholds
          </Button>
        </div>

        {saved === undefined ? undefined : (
          <StatusMessage tone={saved.startsWith('Saved') ? 'success' : 'warning'} live>
            {saved}
          </StatusMessage>
        )}
      </section>

      <section className="oyl-panel" aria-labelledby="oyl-bests-heading">
        <h2 id="oyl-bests-heading">Duration personal bests</h2>
        <p className="oyl-muted">
          The best average power you have held for each length of time, anywhere in any ride on this
          device. These are <strong>not</strong> segment bests: a duration best is a span of time, a
          segment best is a named stretch of road. This device does not hold segment bests — they
          are a separate feature and they will be shown separately.
        </p>

        {state.kind === 'ready' ? <BestsTable bests={state.bests} /> : undefined}
      </section>

      <p>
        <a href={hrefFor(routeById('activities'))}>Your rides</a>
        {' · '}
        <a href={hrefFor(routeById('transfer'))}>Import or export files</a>
      </p>
    </>
  );
}

interface ZoneTableProps {
  readonly breakdown: ZoneBreakdown;
  readonly movingTime: number;
  readonly unit: string;
  readonly heading: string;
  /** "threshold power" or "threshold heart rate" — the words, not the number. */
  readonly thresholdNoun: string;
  readonly assumed: boolean;
}

function ZoneTable({
  breakdown,
  movingTime,
  unit,
  heading,
  thresholdNoun,
  assumed,
}: ZoneTableProps): JSX.Element {
  const rows = zoneRows(breakdown.zones, breakdown.time, unit);
  const coverage = coverageNote(breakdown.time.covered, movingTime);
  // The number the boundaries came from, shown so a rider can check the table
  // against it rather than take the rows on trust.
  const thresholdLabel = `${thresholdNoun} ${String(Math.round(breakdown.threshold))} ${unit}`;
  return (
    <>
      <h3>{heading}</h3>
      {assumed ? (
        <StatusMessage tone="info">
          These zones use an assumed {thresholdLabel}, because none is set on this device. They are
          the right shape and almost certainly the wrong numbers — set your own threshold to make
          them mean anything about you.
        </StatusMessage>
      ) : undefined}
      <table className="oyl-table">
        <caption>
          {heading}, from {thresholdLabel}. {ZONE_BOUNDARY_NOTE}
        </caption>
        <thead>
          <tr>
            <th scope="col">Zone</th>
            <th scope="col">Range</th>
            <th scope="col">Time</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.index}>
              <th scope="row">
                {String(row.index)}. {row.name}
              </th>
              <td>{row.range}</td>
              <td>{row.time}</td>
              <td>
                {row.share}
                {/*
                  The bar repeats the percentage in the same cell, so it is
                  hidden from assistive technology rather than announced twice.
                  It carries no colour meaning — see the file comment.
                */}
                <span aria-hidden="true" className="oyl-zone-bar">
                  <span className="oyl-zone-bar__fill" style={{ width: row.width }} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="oyl-muted">
        Shares are of the {formatDuration(breakdown.time.covered)} the sensor actually reported.
        {coverage === undefined ? '' : ` ${coverage}`}
      </p>
    </>
  );
}

function BestsTable({ bests }: { readonly bests: LibraryBests }): JSX.Element {
  if (bests.curve.length === 0) {
    return (
      <p className="oyl-muted">
        {bests.activitiesRead === 0
          ? 'Nothing recorded yet. Duration bests appear here once you have ridden with a power meter.'
          : `None of the ${String(bests.activitiesRead)} rides on this device carries power data, so there are no duration bests to show yet.`}
      </p>
    );
  }
  return (
    <>
      <table className="oyl-table">
        <caption>
          Best average power over each duration, across {String(bests.activitiesWithPower)} of the{' '}
          {String(bests.activitiesRead)} rides on this device.
        </caption>
        <thead>
          <tr>
            <th scope="col">Duration</th>
            <th scope="col">Best average power ({POWER_UNIT})</th>
          </tr>
        </thead>
        <tbody>
          {bests.curve.map((effort) => (
            <tr key={effort.duration}>
              <th scope="row">
                {durationLabel(effort.duration)}
                <VisuallyHidden> ({formatDuration(effort.duration)})</VisuallyHidden>
              </th>
              <td>{formatPowerValue(effort.power)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {bests.truncated ? (
        <StatusMessage tone="info">
          These are your bests across the {String(bests.activitiesRead)} most recent rides on this
          device, not across every ride you have ever stored here.
        </StatusMessage>
      ) : undefined}
    </>
  );
}

/**
 * One ride's load, and — the part #76's fifth criterion is actually about —
 * which channel it came from.
 *
 * The basis is a sentence rather than a badge. "Heart rate" alone would tell a
 * rider which trace was used and not that the two numbers are on the same scale
 * without being the same measurement, which is the thing that would let them
 * compare Tuesday against Thursday and draw a wrong conclusion.
 */
function LoadPanel({ load }: { readonly load: RideLoad }): JSX.Element {
  return (
    <div className="oyl-ride-summary">
      <dl className="oyl-metric">
        <dt className="oyl-metric__label">Ride load</dt>
        <dd className="oyl-metric__value">{formatLoad(load.load)}</dd>
        <dd className="oyl-metric__note">
          An hour at your threshold is {String(LOAD_AT_THRESHOLD_FOR_ONE_HOUR)}. This one is{' '}
          {LOAD_BASIS_TEXT[load.basis]}
        </dd>
        <dd className="oyl-metric__note">
          Measured over the {formatDuration(load.coveredSeconds)} the sensor actually reported.
        </dd>
      </dl>
    </div>
  );
}

interface FitnessPanelProps {
  readonly history: FitnessHistory;
  readonly backfilling: boolean;
  readonly note: string | undefined;
  readonly onBackfill: () => void;
}

/**
 * The chart, its readings, what it rests on, and the offer to measure more.
 *
 * ⚠️ The **readings** are the non-visual equivalent #77's sixth criterion asks
 * for — current values, direction and recent change, in sentences. Not the
 * table: a decade of riding is 3 650 rows, and a table nobody can read is not
 * an equivalent of a picture anybody can. The table beside the chart is
 * sampled, and it is there for a reader who wants the numbers rather than for
 * one who cannot see the drawing.
 */
function FitnessPanel({ history, backfilling, note, onBackfill }: FitnessPanelProps): JSX.Element {
  const readings = trendReadings(history.points);
  const sampled = sampledPoints(history.points);

  if (history.points.length === 0) {
    return (
      <>
        <p className="oyl-muted">
          {history.ridesWithoutSummary === 0
            ? 'Nothing to chart yet. This fills in as you record or import rides.'
            : `None of the ${String(history.ridesWithoutSummary)} rides on this device has been measured for load yet.`}
        </p>
        {history.ridesWithoutSummary === 0 ? undefined : (
          <BackfillControl
            missing={history.ridesWithoutSummary}
            backfilling={backfilling}
            onBackfill={onBackfill}
          />
        )}
        <BackfillNote note={note} />
      </>
    );
  }

  return (
    <>
      <ul className="oyl-metric-grid">
        {readings.map((reading) => (
          <li className="oyl-metric" key={reading.label}>
            <span className="oyl-metric__label">{reading.label}</span>
            <span className="oyl-metric__value">{String(Math.round(reading.value))}</span>
            <span className="oyl-metric__note">{trendSentence(reading)}</span>
          </li>
        ))}
      </ul>

      <ChartSlot
        caption={`Fitness and fatigue across ${String(history.points.length)} days, from ${String(history.ridesCounted)} measured rides`}
        columns={['Day', 'Load', 'Fitness', 'Fatigue', 'Freshness']}
        rows={sampled.map((point) => [
          point.day,
          String(Math.round(point.load)),
          String(Math.round(point.base)),
          String(Math.round(point.recent)),
          String(Math.round(point.freshness)),
        ])}
        emptyMessage="Nothing to chart yet."
        chart={
          // ⚠️ The boundary is not optional. Without it the suspending chunk
          // suspends the *whole* tree, so the readings, the thresholds and the
          // personal bests all stop rendering while a drawing loads — which is
          // how this was found. `ActivityDetailView` wraps its trace the same
          // way, and `null` is the right fallback: `ChartSlot`'s table is
          // already beside it, so there is nothing missing to apologise for.
          <Suspense fallback={null}>
            <FitnessChart points={history.points} />
          </Suspense>
        }
        tablePosition="beside"
      />

      {history.points[0]?.warmingUp === true && history.points.at(-1)?.warmingUp === true ? (
        <StatusMessage tone="info">
          Both averages start from zero on the day of your first ride, because this device has no
          record of what you did before it. The first few weeks of this chart are therefore climbing
          out of nothing rather than describing your training.
        </StatusMessage>
      ) : undefined}

      <p className="oyl-muted">{basisNote(history)}</p>

      {history.ridesWithoutSummary === 0 ? undefined : (
        <BackfillControl
          missing={history.ridesWithoutSummary}
          backfilling={backfilling}
          onBackfill={onBackfill}
        />
      )}
      <BackfillNote note={note} />
    </>
  );
}

/**
 * What the last measuring pass did, kept alive after the control it came from.
 *
 * `live`, so a screen-reader user hears the outcome of a button they pressed
 * without having to go looking for it.
 */
function BackfillNote({ note }: { readonly note: string | undefined }): JSX.Element | undefined {
  return note === undefined ? undefined : (
    <StatusMessage tone="success" live>
      {note}
    </StatusMessage>
  );
}

/**
 * What the line is made of.
 *
 * #77's eighth criterion: the chart states the basis rather than silently
 * blending power-derived and heart-rate-derived loads. "Mixed" is the honest
 * answer for most real histories and is said plainly, because a rider comparing
 * this year against last needs to know if the measurement changed underneath
 * them.
 */
function basisNote(history: FitnessHistory): string {
  const from = `Built from ${String(history.ridesCounted)} measured ${history.ridesCounted === 1 ? 'ride' : 'rides'}`;
  if (history.bases.length === 0) {
    return `${from}.`;
  }
  if (history.bases.length > 1) {
    return `${from}, some measured from power and some from heart rate. The two share a scale without being the same measurement, so a stretch built from heart rate is a rougher estimate than one built from power.`;
  }
  return history.bases[0] === 'power'
    ? `${from}, all measured from power.`
    : `${from}, all measured from heart rate — a rougher estimate than power, because heart rate lags an effort and levels off near the top.`;
}

/** The offer to measure rides that carry no load summary yet. */
/**
 * The offer to measure rides that carry no load summary yet.
 *
 * ⚠️ It does **not** own the "what happened" message. This control disappears
 * the moment the last ride is measured — which is exactly when the rider most
 * needs to be told the work succeeded — so a note rendered inside it would
 * vanish in the same frame it was written. Found by a test asserting the
 * confirmation and getting a screen with no trace of it.
 */
function BackfillControl({
  missing,
  backfilling,
  onBackfill,
}: {
  readonly missing: number;
  readonly backfilling: boolean;
  readonly onBackfill: () => void;
}): JSX.Element {
  return (
    <>
      <StatusMessage tone="info">
        {String(missing)} {missing === 1 ? 'ride was' : 'rides were'} imported before this device
        measured load, so {missing === 1 ? 'it is' : 'they are'} not in the chart. Measuring{' '}
        {missing === 1 ? 'it' : 'them'} reads each ride&rsquo;s samples once and stores the result,
        so it only has to happen once.
      </StatusMessage>
      <Button onClick={onBackfill} disabled={backfilling}>
        {backfilling ? 'Measuring…' : `Measure ${String(missing)} more`}
      </Button>
    </>
  );
}
