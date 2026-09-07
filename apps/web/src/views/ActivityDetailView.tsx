// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One stored ride, in full (#50) — the screen a library row opens.
 *
 * ## Two cases that are normal here rather than exceptional
 *
 * 1. **An indoor ride has no position at all.** #50 names this first, and it is
 *    half the activities this product will hold. There is no map in Phase 1 —
 *    the map moved to [#63](https://github.com/openzigs/onyourleft/issues/63)
 *    with this issue's revision block — so there is nothing to render at 0°, 0°
 *    and nothing to leave blank. What the view does instead is say so in words,
 *    which is the same answer #62's list gives.
 * 2. **Streams have gaps.** A strap that dropped for thirty seconds is thirty
 *    absent samples, and `detail/series.ts` carries that absence all the way to
 *    the drawing so the chart breaks the line rather than joining across it.
 *
 * ## The read budget is the design, not a later optimisation
 *
 * The panel at the top is rendered from the activity record and the **stream
 * summary**, which decodes nothing. A trace is read only when its series is
 * switched on. So opening a four-hour ride inflates two channels, not eight,
 * and hands the DOM {@link CHART_POINTS} points rather than 14 400 —
 * `detail/load.ts` is where that is enforced and `detail/load.test.ts` counts
 * it.
 *
 * ## The shared view
 *
 * The rider's own track is shown whole. ADR 0004 decision E and #51's export
 * path both say the athlete's own data is not obfuscated for the athlete, and
 * withholding a rider's own ride from them would be this product deciding it
 * knows better than the person who rode it.
 *
 * What the same ADR *also* requires — decision C — is that the difference be
 * explained on the athlete's own activity rather than discovered later. So
 * there is a shared view: what a published copy of this ride would contain,
 * computed from the data by `detail/privacy.ts` and never by hiding anything in
 * the renderer.
 */

import { lazy, Suspense, useCallback, useEffect, useState, type JSX } from 'react';

import type { Metres } from '@onyourleft/domain';
import { activityId as toActivityId, type ActivityId } from '@onyourleft/store';

import { Button } from '../design/Button';
import { ChartSlot } from '../design/ChartSlot';
import { StatusMessage } from '../design/StatusMessage';
import {
  DISTANCE_UNIT,
  formatDistanceValue,
  formatDuration,
  formatPowerValue,
  formatStartedAt,
  POWER_UNIT,
} from '../format';
import {
  loadOverview,
  loadOwnTrack,
  loadSharedTrack,
  loadTrace,
  type RideOverview,
  type Trace,
} from '../detail/load';
import type { SharedTrack } from '../detail/privacy';
import {
  CHART_POINTS,
  DEFAULT_SERIES,
  downsample,
  TABLE_ROWS,
  TRACE_SERIES,
  type TraceChannel,
} from '../detail/series';
import type { DetailPort } from '../detail/store-port';
import type { BasemapConfig } from '../map/basemap';
import { MapPanel } from '../map/MapPanel';
import type { MapPort } from '../map/port';
import { trackGeometry, type TrackGeometry } from '../map/track';
import { hrefFor, routeById } from '../shell/routes';

/**
 * The chart, loaded on demand.
 *
 * `React.lazy` rather than a plain import, and `design/ChartSlot.tsx` records
 * why in its own words: #48's seventh criterion is that a failed chart bundle
 * does not blank the page, and a chart imported eagerly fails at module load —
 * before any render boundary exists to catch it. Through `lazy` the failure
 * happens *during* render, which is precisely what `RenderBoundary` turns into
 * the table.
 */
const TraceChart = lazy(async () => import('../detail/TraceChart'));

export interface ActivityDetailViewProps {
  /**
   * The local store, or `undefined` where there is none.
   *
   * `undefined` is what the accessibility suite renders and what a browser with
   * no usable IndexedDB gets. It is not an error state and it does not claim
   * the ride is missing — which would be the one wrong answer, because a rider
   * would act on it.
   */
  readonly port?: DetailPort | undefined;
  /** The id from the route's `:activity` segment. */
  readonly activityId?: string | undefined;
  /**
   * How to get a map engine, or `undefined` where there is none.
   *
   * A **loader** rather than a port, so `maplibre-gl` is fetched only when a
   * ride with GPS is actually opened — `map/maplibre.ts` records why that split
   * matters for a product whose first milestone is mostly indoor rides. The
   * accessibility suite and the view's own tests pass a resolved stub.
   */
  readonly map?: (() => Promise<MapPort>) | undefined;
  /** Where the basemap is, or `undefined` until #53 publishes an archive. */
  readonly basemap?: BasemapConfig | undefined;
}

type OverviewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly overview: RideOverview }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed'; readonly reason: string };

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The links every terminal state offers, so no state is a dead end. */
function WayOut(): JSX.Element {
  return (
    <p>
      <a href={hrefFor(routeById('activities'))}>All rides on this device</a>
      {' · '}
      <a href={hrefFor(routeById('ride'))}>Start a ride</a>
    </p>
  );
}

export function ActivityDetailView({
  port,
  activityId,
  map,
  basemap,
}: ActivityDetailViewProps): JSX.Element {
  const [state, setState] = useState<OverviewState>({ kind: 'loading' });
  const [enabled, setEnabled] = useState<readonly TraceChannel[]>(DEFAULT_SERIES);
  const [traces, setTraces] = useState<ReadonlyMap<TraceChannel, Trace>>(new Map());
  const [shared, setShared] = useState<SharedTrack | undefined>(undefined);
  const [showShared, setShowShared] = useState(false);
  const [mapPort, setMapPort] = useState<MapPort | undefined>(undefined);
  const [ownTrack, setOwnTrack] = useState<TrackGeometry | undefined>(undefined);

  const id: ActivityId | undefined =
    activityId === undefined || activityId === '' ? undefined : toActivityId(activityId);

  useEffect(() => {
    if (port === undefined || id === undefined) {
      return;
    }
    let live = true;
    setState({ kind: 'loading' });
    void (async () => {
      try {
        const overview = await loadOverview(port, id);
        if (!live) {
          return;
        }
        setState(overview === undefined ? { kind: 'missing' } : { kind: 'ready', overview });
      } catch (error: unknown) {
        if (live) {
          setState({ kind: 'failed', reason: reasonOf(error) });
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [port, id]);

  /**
   * Load the traces that are switched on and not already held.
   *
   * Keyed on the channel, so switching a series off and on again does not
   * re-read it — the samples do not change, and a second inflate of the same
   * blob is the read this whole module is arranged to avoid.
   */
  useEffect(() => {
    if (port === undefined || id === undefined || state.kind !== 'ready') {
      return;
    }
    const available = state.overview.streams?.channels ?? [];
    const wanted = enabled.filter((channel) => available.includes(channel) && !traces.has(channel));
    if (wanted.length === 0) {
      return;
    }
    let live = true;
    void (async () => {
      for (const channel of wanted) {
        const trace = await loadTrace(port, id, channel, CHART_POINTS);
        if (!live || trace === undefined) {
          continue;
        }
        setTraces((held) => new Map(held).set(channel, trace));
      }
    })();
    return () => {
      live = false;
    };
  }, [port, id, state, enabled, traces]);

  /**
   * Load the map engine and the rider's own track, for a ride that has one.
   *
   * Both are conditional on `hasPosition`, so an indoor ride — most rides in
   * this milestone — pays for neither: no `maplibre-gl` download and no
   * position decode. #63's first criterion is that such a ride renders no map,
   * and this is where that stops being a rendering decision and becomes a read
   * that never happens.
   */
  useEffect(() => {
    if (port === undefined || id === undefined || state.kind !== 'ready') {
      return;
    }
    if (!state.overview.activity.hasPosition || map === undefined) {
      return;
    }
    let live = true;
    void (async () => {
      const [engine, track] = await Promise.all([map(), loadOwnTrack(port, id)]);
      if (!live) {
        return;
      }
      setMapPort(engine);
      setOwnTrack(track === undefined ? undefined : trackGeometry(track.segments));
    })();
    return () => {
      live = false;
    };
  }, [port, id, state, map]);

  const toggle = useCallback((channel: TraceChannel): void => {
    setEnabled((current) =>
      current.includes(channel)
        ? current.filter((entry) => entry !== channel)
        : [...current, channel],
    );
  }, []);

  const revealShared = useCallback(async (): Promise<void> => {
    if (port === undefined || id === undefined) {
      return;
    }
    setShowShared(true);
    if (shared === undefined) {
      setShared(await loadSharedTrack(port, id));
    }
  }, [port, id, shared]);

  if (port === undefined) {
    return (
      <>
        <StatusMessage tone="danger">
          No local store on this browser. Rides are kept in this browser&rsquo;s own storage and
          this page cannot reach it — a private window or blocked site data is the usual reason.
        </StatusMessage>
        <WayOut />
      </>
    );
  }

  if (state.kind === 'loading') {
    return (
      <>
        <StatusMessage tone="info" live>
          Reading this ride from the store on this device…
        </StatusMessage>
        <WayOut />
      </>
    );
  }

  if (state.kind === 'failed') {
    return (
      <>
        <StatusMessage tone="warning" live>
          Could not read this ride from the store on this device. {state.reason}
        </StatusMessage>
        <WayOut />
      </>
    );
  }

  if (state.kind === 'missing') {
    return (
      <>
        {/*
          "No ride with that id" rather than "that ride is not yours". The
          store's reads are athlete-scoped, so a ride belonging to somebody else
          arrives here as absent — and a message that distinguished the two
          would confirm the id names a real ride, which is a fact this device
          should not hand out.
        */}
        <StatusMessage tone="warning">
          No ride on this device has that id. It may have been deleted, or the link may have come
          from a different browser — rides are not shared between them.
        </StatusMessage>
        <WayOut />
      </>
    );
  }

  const { activity, streams, laps } = state.overview;
  const available = streams?.channels ?? [];
  const chartable = TRACE_SERIES.filter((series) => available.includes(series.channel));

  return (
    <>
      <h2>{activity.name}</h2>

      <dl className="oyl-ride-summary">
        <div>
          <dt>Started</dt>
          <dd>{formatStartedAt(activity.startedAt, activity.startedAtTimeZone)}</dd>
        </div>
        <div>
          <dt>Elapsed</dt>
          <dd>{formatDuration(activity.elapsedTime)}</dd>
        </div>
        <div>
          <dt>Moving</dt>
          <dd>{formatDuration(activity.movingTime)}</dd>
        </div>
        <div>
          <dt>Distance</dt>
          <dd>
            {formatDistanceValue(activity.distance)} {DISTANCE_UNIT}
          </dd>
        </div>
        <div>
          <dt>Average power</dt>
          <dd>
            {activity.averagePower === undefined
              ? 'No power meter'
              : `${formatPowerValue(activity.averagePower)} ${POWER_UNIT}`}
          </dd>
        </div>
        <div>
          <dt>Position</dt>
          {/*
            In words. An indoor ride is the ordinary case here, and #50's first
            criterion is that it renders without a map rather than with an empty
            one — so the view says which it is rather than leaving a hole where
            a map would be.
          */}
          <dd>{activity.hasPosition ? 'Recorded with a GPS track' : 'Indoor — no GPS track'}</dd>
        </div>
      </dl>

      <h3>Traces</h3>

      {streams === undefined ? (
        <StatusMessage tone="info">
          This ride has no per-second data stored on this device, so there is nothing to chart. Its
          totals above are the whole of what was kept.
        </StatusMessage>
      ) : (
        <>
          <p className="oyl-muted">
            {/*
              The reduction, said out loud. #50's fourth criterion is a read
              budget, and a budget the rider cannot see is one that quietly
              stops being met.
            */}
            {String(streams.sampleCount)} readings a second apart, drawn at up to{' '}
            {String(CHART_POINTS)} points a trace.
          </p>
          <div className="oyl-library-controls">
            {chartable.map((series) => (
              <Button
                key={series.channel}
                variant={enabled.includes(series.channel) ? 'primary' : 'secondary'}
                onClick={() => {
                  toggle(series.channel);
                }}
              >
                {enabled.includes(series.channel) ? 'Hide' : 'Show'} {series.label.toLowerCase()}
              </Button>
            ))}
          </div>

          {chartable.length === 0 ? (
            <StatusMessage tone="info">
              This ride stored a track and no sensor channels, so there is nothing to chart.
            </StatusMessage>
          ) : undefined}

          {chartable
            .filter((series) => enabled.includes(series.channel))
            .map((series) => {
              const trace = traces.get(series.channel);
              if (trace === undefined) {
                return (
                  <p className="oyl-muted" key={series.channel}>
                    Reading {series.label.toLowerCase()}…
                  </p>
                );
              }
              // The table is the same trace at reading resolution rather than
              // at drawing resolution — `series.ts` records why six hundred
              // rows is not an equivalent of anything. Derived from the points
              // the chart already holds, so it costs no further read.
              const tableRows = downsample(trace.points, TABLE_ROWS);
              const secondsPerRow =
                tableRows.length === 0
                  ? 0
                  : (trace.points.length * trace.secondsPerPoint) / tableRows.length;
              const rows = tableRows.map((value, index) => [
                formatDuration(index * secondsPerRow),
                // Named rather than an em dash. A gap and a zero reading are
                // different facts and the table is where a reader who cannot
                // see the broken line finds that out.
                value === undefined ? 'no reading' : series.format(value),
              ]);
              return (
                <ChartSlot
                  key={series.channel}
                  caption={`${series.label} (${series.unit})`}
                  columns={['From', `${series.label} (${series.unit})`]}
                  rows={rows}
                  emptyMessage="No readings in this ride."
                  tablePosition="beside"
                  chart={
                    <Suspense fallback={null}>
                      <TraceChart
                        label={series.label}
                        unit={series.unit}
                        points={trace.points}
                        secondsPerPoint={trace.secondsPerPoint}
                        format={series.format}
                        missingSamples={trace.missingSamples}
                      />
                    </Suspense>
                  }
                />
              );
            })}
        </>
      )}

      <h3>Laps</h3>
      {laps.length === 0 ? (
        <p className="oyl-muted">This ride has no laps recorded.</p>
      ) : (
        <table className="oyl-table">
          <caption>Laps, in the order they were ridden</caption>
          <thead>
            <tr>
              <th scope="col">Lap</th>
              <th scope="col">Elapsed</th>
              <th scope="col">Moving</th>
              <th scope="col">Distance ({DISTANCE_UNIT})</th>
              <th scope="col">Avg power ({POWER_UNIT})</th>
            </tr>
          </thead>
          <tbody>
            {laps.map((lap) => (
              <tr key={lap.id}>
                <th scope="row">{String(lap.ordinal + 1)}</th>
                <td>{formatDuration(lap.elapsedTime)}</td>
                <td>{formatDuration(lap.movingTime)}</td>
                <td>{formatDistanceValue(lap.distance)}</td>
                <td>{lap.averagePower === undefined ? '—' : formatPowerValue(lap.averagePower)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {activity.hasPosition ? (
        <>
          <h3>Route</h3>
          {/*
            The geometry the map is handed is chosen here, and it is the whole
            of #63's sixth criterion: with the shared view open the map receives
            the **trimmed** segments, and the untrimmed ones are not in its
            props, its state or the DOM. ADR 0004 decision C — obfuscation is
            applied in the payload, never by the renderer.
          */}
          <MapPanel
            port={mapPort}
            basemap={basemap}
            track={showShared && shared !== undefined ? trackGeometry(shared.segments) : ownTrack}
          />

          <h3>What a shared copy would contain</h3>
          {showShared ? (
            <SharedSummary track={shared} own={activity.distance} />
          ) : (
            <>
              <p className="oyl-muted">
                Your own view shows your own track, whole — this ride is yours. A copy published
                anywhere else would have your privacy zones applied to it first.
              </p>
              <Button
                variant="secondary"
                onClick={() => {
                  void revealShared();
                }}
              >
                Show what a shared copy would contain
              </Button>
            </>
          )}
        </>
      ) : undefined}

      <WayOut />
    </>
  );
}

/** The shared-view panel, once its track has been computed. */
function SharedSummary({
  track,
  own,
}: {
  readonly track: SharedTrack | undefined;
  /** The rider's own distance, for the comparison ADR 0004 decision C asks for. */
  readonly own: Metres;
}): JSX.Element {
  if (track === undefined) {
    return (
      <p className="oyl-muted" role="status">
        Working out what a shared copy would contain…
      </p>
    );
  }
  if (track.zonesApplied === 0) {
    return (
      <StatusMessage tone="warning">
        You have no privacy zones, so a shared copy of this ride would carry the whole track —
        including wherever it started and finished.
      </StatusMessage>
    );
  }
  return (
    <>
      <dl className="oyl-ride-summary">
        <div>
          <dt>Positions withheld</dt>
          {/* A count, never a location. */}
          <dd>{String(track.trimmedPoints)}</dd>
        </div>
        <div>
          <dt>Shared distance</dt>
          <dd>
            {formatDistanceValue(track.distance)} {DISTANCE_UNIT}
          </dd>
        </div>
        <div>
          <dt>Your own distance</dt>
          <dd>
            {formatDistanceValue(own)} {DISTANCE_UNIT}
          </dd>
        </div>
        <div>
          <dt>Track parts</dt>
          <dd>{String(track.segments.length)}</dd>
        </div>
      </dl>
      <StatusMessage tone="warning">
        A privacy zone hides the start and end of a ride. It does not make where you live private:
        an observer with enough of your published rides can still work out the centre of the zone.
        The only complete protection is not publishing the ride.
      </StatusMessage>
    </>
  );
}
