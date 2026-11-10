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
 * summary**, which decodes nothing. Since #2068 every recorded channel has its
 * own small chart, stacked on one time axis, and a chart's channel is read only
 * once its slot scrolls into view (`detail/visibility.ts`). So opening a
 * four-hour ride inflates the channels on screen, not eight, and hands the DOM
 * {@link CHART_POINTS} points a chart rather than 14 400 — `detail/load.ts` is
 * where that is enforced and `detail/load.test.ts` counts it.
 *
 * ## The power curve, the laps and the read-out (#2081)
 *
 * The stack's laps are bands on every chart, and a tap or a hover on any
 * chart moves its one cursor, whose `<output>` says every channel's reading
 * (a polite live region, so the slider's keyboard moves are announced too).
 * A ride with a speed channel may be drawn against the distance ridden
 * instead of time (`detail/axis.ts`). Below the stack, the ride's power curve
 * from five seconds to an hour beside the all-time one: the ride's line comes
 * with the power chart's read and the distance with the speed chart's
 * (`detail/load.ts` §`loadTrace`), so neither decodes a channel twice.
 *
 * ## The side camera (#388)
 *
 * A ride the side camera filmed carries a report: sentences, saved with the
 * ride when the session ended (the owner's ruling of 2026-09-26). It is read
 * with the overview — one point lookup, no picture and no number on the row —
 * and rendered by `detail/SideCameraSection.tsx`, only for a ride that has one.
 *
 * ## A model's write-up (#804, #805)
 *
 * Below it, on every ride: the write-up saved with the ride, read with the
 * overview and screened again before it is shown, and the press that asks the
 * rider's model for a new one. `detail/RideWriteUpSection.tsx` is all of it.
 *
 * ## "May be raced" (#793)
 *
 * Below the write-up, on every ride: the rider's consent to another rider
 * racing a ghost of it, off by default and revocable, and never the share
 * setting (ADR 0021 D-5.1). `detail/RaceConsentSection.tsx` is all of it.
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

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';

import { metres, type Metres, type PowerDurationCurve } from '@onyourleft/domain';
import { activityId as toActivityId, type ActivityId, type UnitSystem } from '@onyourleft/store';

import { Button } from '../design/Button';
import { ChartSlot } from '../design/ChartSlot';
import { Reading } from '../design/Reading';
import { StatusMessage } from '../design/StatusMessage';
import {
  ELAPSED_TIME_LABEL,
  formatDuration,
  formatPowerValue,
  MOVING_TIME_LABEL,
  formatStartedAt,
  POWER_UNIT,
  noPowerText,
  shownAveragePower,
} from '../format';
import { useUnits } from '../units/context';
import { distanceUnit, formatDistance, shownDistance } from '../units/format';
import {
  loadOverview,
  loadOwnTrack,
  loadSharedTrack,
  loadTrace,
  readWriteUp,
  type RideOverview,
  type Trace,
} from '../detail/load';
import {
  distanceAt,
  distanceAxis,
  lapAt,
  lapBands,
  timeAxis,
  type AxisKind,
  type DistanceProfile,
  type LapBand,
  type RideAxis,
} from '../detail/axis';
import { curveRows, onRideDurations } from '../detail/curve';
import type { PickKind } from '../detail/TraceChart';
import type { SharedTrack } from '../detail/privacy';
import { CaloriesFact } from '../detail/CaloriesFact';
import { LapsTable } from '../detail/LapsTable';
import { WorkoutBlocksTable } from '../detail/WorkoutBlocksTable';
import { SideCameraSection } from '../detail/SideCameraSection';
import { RideSnapshotsSection } from '../detail/RideSnapshotsSection';
import type { RideSnapshotsPort } from '../detail/ride-snapshots-port';
import { RideWriteUpSection } from '../detail/RideWriteUpSection';
import { RaceConsentSection } from '../detail/RaceConsentSection';
import { MAXIMUM_RIDE_NOTE_CHARACTERS } from '@onyourleft/store';
import { RiderTextBox } from '../rider-text/RiderTextBox';
import type { RiderTextPort } from '../rider-text/rider-text-port';
import { NOTE_WORDS } from '../rider-text/words';
import type { InstanceAnalysisPort } from '../ride-analysis/instance-analysis-port';
import { loadLibraryBests, loadRideZones, type RideZoneAnalysis } from '../analysis/load';
import type { AnalysisPort } from '../analysis/store-port';
import { ZoneTable } from '../analysis/ZoneTable';
import {
  CHART_POINTS,
  downsample,
  TABLE_ROWS,
  pointAt,
  traceSeries,
  type TraceChannel,
  type TraceSeriesDefinition,
} from '../detail/series';
import type { DetailPort } from '../detail/store-port';
import { watchUntilSeen } from '../detail/visibility';
import type { BasemapConfig } from '../map/basemap';
import { MapPanel } from '../map/MapPanel';
import { readMapTilesChoice } from '../map/tiles-preference';
import { deviceStorage, type PreferenceStorage } from '../game/hud/announce-preference';
import type { MapPort } from '../map/port';
import { trackGeometry, type TrackGeometry } from '../map/track';
import { raceFactTerm, raceFactText } from '../rooms/race-result';
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

/** #2081: the ride's power curve, loaded on demand for the same reason. */
const PowerCurveChart = lazy(async () => import('../detail/PowerCurveChart'));

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
  /** Where the basemap is, or `undefined` for a build configured with none (#534). */
  readonly basemap?: BasemapConfig | undefined;
  /**
   * Where the rider's map-tiles choice is kept (`map/tiles-preference.ts`) —
   * this DEVICE's `localStorage` unless a test hands in a double, the shape
   * `SettingsView`'s `announcements` prop has.
   */
  readonly preferences?: PreferenceStorage | undefined;
  /**
   * A write-up asked of the rider's instance (#1102), or `undefined` where
   * this browser cannot hold a sign-in: `detail/RideWriteUpSection.tsx` then
   * says in one sentence that no write-up can be asked for here (#1103).
   */
  readonly instanceWriteUp?: InstanceAnalysisPort | undefined;
  /**
   * Where the rider's note on this ride is kept (#836), or `undefined` where
   * there is no store — the box then says so and offers no control.
   */
  readonly riderText?: RiderTextPort | undefined;
  /**
   * #2069: where the ride's time in zone is read — the analysis screen's own
   * port, so the zones here are the ones Analysis shows, from the rider's
   * thresholds. `undefined` and the page has no "Time in zone" section.
   */
  readonly analysis?: AnalysisPort | undefined;
  /**
   * This ride's side-camera snapshots (#1063), read only once the rider opens
   * their section, or `undefined` where there is no store — and then the
   * section is absent.
   */
  readonly snapshots?: RideSnapshotsPort | undefined;
  /**
   * #1439: drawn inside History's detail pane, which is the ride's one page
   * there. The pane heads it with the ride's name (`shell/ListDetail.tsx`
   * §`SELECTED_HEADING_ID`, from the list's own row, so focus has somewhere to land before
   * this read is back) and has its own way back to the list, so the page
   * draws neither its own name nor {@link WayOut}.
   */
  readonly embedded?: boolean | undefined;
}

/**
 * What the page says while the ride's overview is still being read.
 *
 * Exported for a test to wait on (#575): a read through a real store is a chain
 * of IndexedDB tasks, and a test that waits a fixed number of turns for it
 * races the machine it runs on. Named here rather than retyped in the test so
 * that rewording it cannot turn that wait into one that is over before the
 * read has begun.
 */
export const READING_RIDE_TEXT = 'Reading this ride from the store on this device…';

type OverviewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly overview: RideOverview }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed'; readonly reason: string };

/**
 * #2081: the all-time power curve beside the ride's, before and after the
 * library is read. `none` with no analysis port: the ride's line alone.
 */
type AllTimeState =
  | { readonly kind: 'waiting' }
  | {
      readonly kind: 'ready';
      readonly curve: PowerDurationCurve;
      /** The line rests on the most recent rides only (`analysis/load.ts` §`BESTS_ACTIVITY_LIMIT`). */
      readonly truncated: boolean;
      readonly ridesRead: number;
    }
  | { readonly kind: 'none' }
  | { readonly kind: 'failed'; readonly reason: string };

/**
 * #2081: the distance axis, as the rider's choice finds it — still to be read
 * (it comes with the speed chart's read), or read and covering no ground.
 * #2194: or the speed read failed, with why.
 */
type DistanceState =
  | { readonly kind: 'reading' | 'ready' | 'none' }
  | { readonly kind: 'failed'; readonly reason: string };

/**
 * #2194: how long a mouse must rest on a chart before the read-out says where
 * it is. A tap, a click and the keyboard are said at once; a hover moves the
 * line at once and is said only when it stops, so a screen-reader user who
 * also uses a mouse hears one reading, not one for every step it crossed.
 */
export const HOVER_SETTLE_MS = 400;

/** #2069: the ride's time in zone, before and after its section is read. */
type ZonesState =
  | { readonly kind: 'waiting' }
  | { readonly kind: 'ready'; readonly zones: RideZoneAnalysis }
  | { readonly kind: 'none' }
  | { readonly kind: 'failed'; readonly reason: string };

/** #2081: a distance ridden, in the rider's unit, with it. */
function distanceText(metresRidden: number, units: UnitSystem): string {
  return `${formatDistance(metres(metresRidden), units).value} ${distanceUnit(units)}`;
}

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

/**
 * What a ride's page keeps on the screen whatever its length — #1013: whose
 * track the rider is looking at, and what a published copy would have done to
 * it first.
 */
export const ACTIVITY_DETAIL_KEPT_VISIBLE: readonly string[] = [
  'Your own view shows your own track, whole — this ride is yours.',
  'A copy published anywhere else would have your privacy zones applied to it first.',
];

export function ActivityDetailView({
  port,
  activityId,
  map,
  basemap,
  preferences,
  instanceWriteUp,
  riderText,
  analysis,
  snapshots,
  embedded = false,
}: ActivityDetailViewProps): JSX.Element {
  // Read once, when the screen opens: the switch is on the Settings screen, so
  // it cannot change while this one is showing.
  const [tiles] = useState(() => readMapTilesChoice(preferences ?? deviceStorage()));
  const [state, setState] = useState<OverviewState>({ kind: 'loading' });
  // #2068: the channels whose chart has been in view, and the slots that say so.
  const [seen, setSeen] = useState<ReadonlySet<TraceChannel>>(new Set());
  const slots = useRef(new Map<TraceChannel, Element>());
  const [traces, setTraces] = useState<ReadonlyMap<TraceChannel, Trace>>(new Map());
  // #2068: the shared cursor, in seconds into the ride.
  const [cursor, setCursor] = useState(0);
  // #2194: where the read-out says the cursor is — the cursor itself, except
  // while a mouse hovering has not yet rested (`HOVER_SETTLE_MS`).
  const [saidAt, setSaidAt] = useState(0);
  const settling = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // #2194: the channels whose read failed, and why. A later read that
  // succeeds puts its trace in `traces`, which every reader of this prefers.
  const [failedReads, setFailedReads] = useState<ReadonlyMap<TraceChannel, string>>(new Map());
  // The channels a read has been started for, and which units' reads count.
  const requested = useRef(new Set<TraceChannel>());
  const generation = useRef(0);
  // #2373: set once the page has unmounted, for the read that is not a reaction
  // to an effect and so has no cleanup of its own (`revealShared`).
  const gone = useRef(false);
  // #2069: the ride's time in zone, read once its section is in view.
  const zonesSlot = useRef<HTMLDivElement | null>(null);
  // Held with the ride they belong to: a page that moves to another ride must
  // neither show the old zones nor read the new ones before they are in view.
  const [zonesSeenFor, setZonesSeenFor] = useState<ActivityId | undefined>(undefined);
  const [heldZones, setHeldZones] = useState<
    { readonly id: ActivityId; readonly state: ZonesState } | undefined
  >(undefined);
  // #2081: the power curve's section, and the all-time line read once it is
  // in view — held with its ride, as the zones are.
  const curveSlot = useRef<HTMLDivElement | null>(null);
  const [curveSeenFor, setCurveSeenFor] = useState<ActivityId | undefined>(undefined);
  const [heldAllTime, setHeldAllTime] = useState<
    { readonly id: ActivityId; readonly state: AllTimeState } | undefined
  >(undefined);
  // #2081: which axis the charts share.
  const [axisKind, setAxisKind] = useState<AxisKind>('time');
  const [shared, setShared] = useState<SharedTrack | undefined>(undefined);
  const [showShared, setShowShared] = useState(false);
  const [mapPort, setMapPort] = useState<MapPort | undefined>(undefined);
  const [ownTrack, setOwnTrack] = useState<TrackGeometry | undefined>(undefined);
  const units = useUnits();

  const id: ActivityId | undefined =
    activityId === undefined || activityId === '' ? undefined : toActivityId(activityId);
  const zonesSeen = id !== undefined && zonesSeenFor === id;
  const rideZones: ZonesState =
    heldZones !== undefined && heldZones.id === id ? heldZones.state : { kind: 'waiting' };
  const curveSeen = id !== undefined && curveSeenFor === id;
  // #2068, #2081: the one time axis every chart is drawn on — the whole ride,
  // from the summary — and the distance axis once the speed has been read.
  // #2194: held, so a move of the cursor hands every chart the same axis and
  // none redraws its paths (`detail/TraceChart.tsx` §`lines`).
  const readyStreams = state.kind === 'ready' ? state.overview.streams : undefined;
  const rideSeconds =
    readyStreams === undefined ? 0 : readyStreams.sampleCount * Number(readyStreams.sampleInterval);
  const profile: DistanceProfile | undefined = traces.get('speed')?.distance;
  const timeline = useMemo(() => timeAxis(rideSeconds), [rideSeconds]);
  const coverage = useMemo(
    () =>
      profile === undefined
        ? undefined
        : distanceAxis(profile, DISTANCE_AXIS_TITLE, (metresRidden) =>
            distanceText(metresRidden, units),
          ),
    [profile, units],
  );

  // #2194: a hover still settling when the page goes is not said afterwards.
  useEffect(
    () => () => {
      clearTimeout(settling.current);
    },
    [],
  );
  const allTime: AllTimeState =
    analysis === undefined
      ? { kind: 'none' }
      : heldAllTime !== undefined && heldAllTime.id === id
        ? heldAllTime.state
        : { kind: 'waiting' };

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
   * Throw away every cached trace when the rider changes units (#238).
   *
   * ⚠️ **Without this the charts are a stale conversion and nothing says so.**
   * A `Trace` holds numbers that have already been through
   * `series.display` — miles per hour, or feet — so a cache keyed on the
   * channel alone would keep serving the *old* system's numbers under the new
   * system's axis label, which is a wrong number wearing a correct unit. That
   * is the worst of the shapes this issue is about, and it is invisible: the
   * chart redraws, the label changes, and the line does not move.
   *
   * Declared before the read below, so a change of units clears what has been
   * asked for before that effect asks again; and a read still in flight in the
   * old units is dropped by its generation.
   */
  useEffect(() => {
    generation.current += 1;
    requested.current.clear();
    setTraces(new Map());
    setFailedReads(new Map());
  }, [units]);

  /**
   * #2373: a read that settles after the page has gone reaches no setter.
   *
   * Unmounting does not change `generation` by itself, so a channel read still
   * in flight when the rider leaves would, on settling, pass its
   * `generation.current === asked` check and call `setTraces` on a page that is
   * not there — in a test, after the environment has torn `window` down, which
   * made that an unhandled rejection that dropped a merge-queue entry.
   */
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      generation.current += 1;
    };
  }, []);

  /**
   * Watch every chart's slot, and note each channel once it is in view — #2068.
   *
   * The slots are drawn as soon as the overview is ready, one per chartable
   * channel and kept across the read, so the elements watched here are the ones
   * the charts arrive in.
   */
  useEffect(() => {
    if (state.kind !== 'ready') {
      return;
    }
    return watchUntilSeen(new Map(slots.current), (channels) => {
      setSeen((held) => new Set([...held, ...channels]));
    });
  }, [state]);

  /**
   * Load the traces that have been in view and not yet asked for.
   *
   * Keyed on the channel, so a chart scrolled away and back is not re-read —
   * the samples do not change, and a second inflate of the same blob is the
   * read this whole module is arranged to avoid. Marked as asked for before the
   * read starts, so a second channel coming into view while the first is still
   * reading does not start the first again.
   */
  useEffect(() => {
    if (port === undefined || id === undefined || state.kind !== 'ready') {
      return;
    }
    const available = state.overview.streams?.channels ?? [];
    const wanted = traceSeries(units)
      .map((series) => series.channel)
      .filter(
        (channel) =>
          seen.has(channel) && available.includes(channel) && !requested.current.has(channel),
      );
    if (wanted.length === 0) {
      return;
    }
    for (const channel of wanted) {
      requested.current.add(channel);
    }
    const asked = generation.current;
    void (async () => {
      for (const channel of wanted) {
        // #2373: a page that has gone, or reads in other units now, wants none
        // of the channels still to come.
        if (generation.current !== asked) {
          return;
        }
        let trace: Trace | undefined;
        try {
          trace = await loadTrace(
            port,
            id,
            channel,
            units,
            CHART_POINTS,
            Number(state.overview.streams?.sampleInterval ?? 1),
          );
        } catch (error: unknown) {
          // A channel that will not read (a corrupt blob) must not stop the
          // channels after it, and may be asked for again on a later pass.
          requested.current.delete(channel);
          // #2194: and says so, rather than "Reading…" for good.
          if (generation.current === asked) {
            setFailedReads((held) => new Map(held).set(channel, reasonOf(error)));
          }
          continue;
        }
        if (trace === undefined || generation.current !== asked) {
          continue;
        }
        setTraces((held) => new Map(held).set(channel, trace));
      }
    })();
  }, [port, id, state, seen, units]);

  /**
   * #2069: the ride's time in zone, read when its section scrolls into view.
   *
   * `loadRideZones` decodes the power and heart-rate channels whole, which is
   * the read this page puts off until it is wanted, as the charts above do
   * (`detail/visibility.ts`).
   */
  useEffect(() => {
    if (state.kind !== 'ready' || zonesSlot.current === null) {
      return;
    }
    return watchUntilSeen(new Map([['zones', zonesSlot.current]]), () => {
      setZonesSeenFor(id);
    });
  }, [state, id]);

  useEffect(() => {
    if (!zonesSeen || analysis === undefined || id === undefined) {
      return;
    }
    let live = true;
    void (async () => {
      try {
        const zones = await loadRideZones(analysis, id);
        if (live) {
          setHeldZones({
            id,
            state: zones === undefined ? { kind: 'none' } : { kind: 'ready', zones },
          });
        }
      } catch (error: unknown) {
        if (live) {
          setHeldZones({ id, state: { kind: 'failed', reason: reasonOf(error) } });
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [zonesSeen, analysis, id]);

  /**
   * #2081: the ride's power curve, once its section scrolls into view. The
   * ride's own line comes with the power trace (`detail/load.ts`
   * §`loadTrace`), so the section asks for that chart's channel as well, in
   * case the rider jumped past it; the all-time line is Analysis' own library
   * read, through the analysis port where there is one.
   */
  useEffect(() => {
    if (state.kind !== 'ready' || curveSlot.current === null) {
      return;
    }
    return watchUntilSeen(new Map([['curve', curveSlot.current]]), () => {
      setCurveSeenFor(id);
      setSeen((held) => (held.has('power') ? held : new Set([...held, 'power'])));
    });
  }, [state, id]);

  useEffect(() => {
    if (!curveSeen || analysis === undefined || id === undefined) {
      return;
    }
    let live = true;
    void (async () => {
      try {
        const library = await loadLibraryBests(analysis);
        if (live) {
          setHeldAllTime({
            id,
            state: {
              kind: 'ready',
              curve: onRideDurations(library.curve),
              truncated: library.truncated,
              ridesRead: library.activitiesRead,
            },
          });
        }
      } catch (error: unknown) {
        if (live) {
          setHeldAllTime({ id, state: { kind: 'failed', reason: reasonOf(error) } });
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [curveSeen, analysis, id]);

  /**
   * #2081: the distance axis is the speed channel summed, which comes with the
   * speed chart's read (`detail/load.ts` §`loadTrace`). Picking that axis asks
   * for the speed chart, in case it has not scrolled into view yet; until then
   * nothing is read for it, so the time axis, the default, costs nothing.
   */
  const chooseAxis = useCallback((kind: AxisKind): void => {
    setAxisKind(kind);
    if (kind === 'distance') {
      setSeen((held) => (held.has('speed') ? held : new Set([...held, 'speed'])));
    }
  }, []);

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

  const revealShared = useCallback(async (): Promise<void> => {
    if (port === undefined || id === undefined) {
      return;
    }
    setShowShared(true);
    if (shared === undefined) {
      const track = await loadSharedTrack(port, id);
      if (!gone.current) {
        setShared(track);
      }
    }
  }, [port, id, shared]);

  if (port === undefined) {
    return (
      <>
        <StatusMessage tone="danger">
          No local store on this browser. Rides are kept in this browser&rsquo;s own storage and
          this page cannot reach it — a private window or blocked site data is the usual reason.
        </StatusMessage>
        {embedded ? null : <WayOut />}
      </>
    );
  }

  if (state.kind === 'loading') {
    return (
      <>
        <StatusMessage tone="info" live>
          {READING_RIDE_TEXT}
        </StatusMessage>
        {embedded ? null : <WayOut />}
      </>
    );
  }

  if (state.kind === 'failed') {
    return (
      <>
        <StatusMessage tone="warning" live>
          Could not read this ride from the store on this device. {state.reason}
        </StatusMessage>
        {embedded ? null : <WayOut />}
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
        {embedded ? null : <WayOut />}
      </>
    );
  }

  const { activity, streams, laps, sideCamera, writeUp: savedWriteUp } = state.overview;
  const available = streams?.channels ?? [];
  const chartable = traceSeries(units).filter((series) => available.includes(series.channel));
  // #2081: the laps as stretches of the ride's clock, and the axis the stack shares.
  const bands = streams === undefined ? [] : lapBands(laps, streams.startedAt, rideSeconds);
  const unit = distanceUnit(units);
  const byDistance = axisKind === 'distance' ? coverage : undefined;
  const speedFailed = failedReads.get('speed');
  const distanceState: DistanceState =
    profile !== undefined
      ? { kind: coverage === undefined ? 'none' : 'ready' }
      : speedFailed === undefined
        ? { kind: 'reading' }
        : { kind: 'failed', reason: speedFailed };
  const axis: RideAxis = byDistance ?? timeline;
  const step = cursorStep(rideSeconds);
  /**
   * #2194: the keyboard's slider and a tap move the cursor and the read-out
   * together; a mouse hovering moves the cursor at once and the read-out
   * once it has rested for {@link HOVER_SETTLE_MS}.
   */
  const moveCursor = (seconds: number, how: PickKind | 'key'): void => {
    setCursor(seconds);
    clearTimeout(settling.current);
    if (how === 'hover') {
      settling.current = setTimeout(() => {
        setSaidAt(seconds);
      }, HOVER_SETTLE_MS);
    } else {
      setSaidAt(seconds);
    }
  };
  const pickAt = (seconds: number, how: PickKind): void => {
    moveCursor(Math.min(rideSeconds, Math.round(seconds / step) * step), how);
  };
  // #1054: a stored average that shows as 0 W says nothing was measured.
  const averagePower = shownAveragePower(activity.averagePower);
  // #1070: a stored 0 m says no distance is known (`units/format.ts` §`shownDistance`).
  const distance = shownDistance(activity.distance);

  return (
    <>
      {embedded ? null : <h2>{activity.name}</h2>}

      {/*
        #2067: the ride's own page is two columns on a tablet — its figures,
        traces and laps, then everything else this device holds about it —
        in the order they are read. Inside a list–detail pane (embedded) the
        pane is the column, and the two groups simply follow each other.
      */}
      <div className={embedded ? undefined : 'oyl-sections oyl-sections--pair'}>
        <div>
          <dl className="oyl-ride-summary">
            <div>
              <dt>Started</dt>
              <dd>{formatStartedAt(activity.startedAt, activity.startedAtTimeZone)}</dd>
            </div>
            {/* #1437: the same two names as Home and History, moving first. */}
            <div>
              <dt>{MOVING_TIME_LABEL}</dt>
              <dd>
                <Reading value={formatDuration(activity.movingTime)} />
              </dd>
            </div>
            <div>
              <dt>{ELAPSED_TIME_LABEL}</dt>
              <dd>
                <Reading value={formatDuration(activity.elapsedTime)} />
              </dd>
            </div>
            {/* #1070: a ride recorded with no speed channel stored 0 m, which is no
            distance known — no row, as on Home and the result card. */}
            {distance === undefined ? null : (
              <div>
                <dt>Distance</dt>
                <dd>
                  <Reading
                    value={formatDistance(distance, units).value}
                    unit={distanceUnit(units)}
                  />
                </dd>
              </div>
            )}
            <div>
              <dt>Average power</dt>
              <dd>
                {averagePower === undefined ? (
                  noPowerText(activity.averagePower)
                ) : (
                  <Reading value={formatPowerValue(averagePower)} unit={POWER_UNIT} />
                )}
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
              <dd>
                {activity.hasPosition ? 'Recorded with a GPS track' : 'Indoor — no GPS track'}
              </dd>
            </div>
            {/* #2433: the estimate stored when the ride was saved, as the
            result card shows it. Read off the record, so a later change of
            weight or age in Settings does not move it. After *Position*, the
            sixth fact, because it takes a row of its own (`CaloriesFact.tsx`
            §`CaloriesFact`): placed after the fifth it left that one alone on
            a row of two on a phone. */}
            <CaloriesFact
              calories={activity.calories}
              hasPower={activity.averagePower !== undefined}
              hasHeartRate={available.includes('heartRate')}
            />
            {/* #785: the races this ride was ridden in, as each room said it —
            kept with the ride on this device, one line each, in order (#1360's
            review, N3). No row for a ride in no race. */}
            {activity.rideFacts?.races === undefined ||
            activity.rideFacts.races.length === 0 ? null : (
              <div>
                <dt>{raceFactTerm(activity.rideFacts.races)}</dt>
                {activity.rideFacts.races.map((race, index) => (
                  <dd key={index}>{raceFactText(race)}</dd>
                ))}
              </div>
            )}
          </dl>

          <h3>Traces</h3>

          {streams === undefined ? (
            <StatusMessage tone="info">
              This ride has no per-second data stored on this device, so there is nothing to chart.
              Its totals above are the whole of what was kept.
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

              {chartable.length === 0 ? (
                <StatusMessage tone="info">
                  This ride stored a track and no sensor channels, so there is nothing to chart.
                </StatusMessage>
              ) : (
                <>
                  {/* #2081: distance is the speed channel summed, so only a ride with one offers it. */}
                  {available.includes('speed') ? (
                    <AxisChoice
                      kind={axisKind}
                      onChange={chooseAxis}
                      distance={distanceState}
                      unit={unit}
                    />
                  ) : null}
                  <TraceCursor
                    seconds={cursor}
                    saidAt={saidAt}
                    rideSeconds={rideSeconds}
                    onChange={(seconds) => {
                      moveCursor(seconds, 'key');
                    }}
                    distance={
                      coverage === undefined || profile === undefined
                        ? undefined
                        : distanceText(distanceAt(profile, saidAt), units)
                    }
                    lap={lapAt(bands, saidAt)}
                    readings={chartable.flatMap((series) => {
                      const trace = traces.get(series.channel);
                      return trace === undefined ? [] : [{ series, trace }];
                    })}
                  />
                </>
              )}

              {/*
            #2068: every recorded channel, stacked, on one time axis — no
            toggles. Each slot is drawn now and watched; its channel is read
            when it scrolls into view, so the slot keeps its place meanwhile.
          */}
              {chartable.map((series) => {
                const trace = traces.get(series.channel);
                const failed = trace === undefined ? failedReads.get(series.channel) : undefined;
                // #2194, the owner's ruling of 2026-11-06: with the distance axis
                // chosen, a failed speed read is said once, by the axis choice,
                // which already gives the reason; the speed slot then says nothing.
                const saidByAxis =
                  series.channel === 'speed' &&
                  axisKind === 'distance' &&
                  distanceState.kind === 'failed';
                return (
                  <div
                    key={series.channel}
                    // #2194: a failed slot holds no chart, so it keeps no chart's height.
                    className={
                      failed === undefined
                        ? 'oyl-trace-slot'
                        : 'oyl-trace-slot oyl-trace-slot--failed'
                    }
                    data-oyl-trace-slot={series.channel}
                    ref={(element) => {
                      if (element === null) {
                        slots.current.delete(series.channel);
                      } else {
                        slots.current.set(series.channel, element);
                      }
                    }}
                  >
                    {trace === undefined ? (
                      failed !== undefined ? (
                        saidByAxis ? null : (
                          // #2194: a read that failed says so, not "Reading…" for good.
                          <StatusMessage tone="warning">
                            Could not read this ride&rsquo;s {series.label.toLowerCase()}. {failed}
                          </StatusMessage>
                        )
                      ) : (
                        <p className="oyl-muted">Reading {series.label.toLowerCase()}…</p>
                      )
                    ) : (
                      <TraceSlot
                        series={series}
                        trace={trace}
                        rideSeconds={rideSeconds}
                        cursor={cursor}
                        axis={axis}
                        laps={bands}
                        onPick={pickAt}
                      />
                    )}
                  </div>
                );
              })}
            </>
          )}

          {/*
        #2081: the ride's power curve, five seconds to an hour, with the
        all-time curve as a second line. Only for a ride with power; read once
        its section scrolls into view.
      */}
          {available.includes('power') ? (
            <div data-oyl-curve-slot="" ref={curveSlot}>
              <RideCurve
                ride={traces.get('power')?.curve}
                failed={traces.has('power') ? undefined : failedReads.get('power')}
                allTime={allTime}
              />
            </div>
          ) : null}

          {/*
        #2069: the ride's time in zone, as Analysis draws it — a bar chart and
        its table per basis. Only for a ride with power or heart rate, and only
        where there is an analysis port to read the rider's thresholds from.
      */}
          {analysis === undefined ||
          !(available.includes('power') || available.includes('heartRate')) ? null : (
            <div data-oyl-zones-slot="" ref={zonesSlot}>
              <RideZones state={rideZones} />
            </div>
          )}

          <h3>Laps</h3>
          {/* #1312: every figure a lap states, the best lap and a part lap marked. */}
          <LapsTable laps={laps} units={units} />
        </div>

        <div>
          {/*
        #1319: a ride with a workout lists its blocks, under their own
        heading after the laps — two tables, never one (WorkoutBlocksTable).
        A ride with no workout renders nothing here.
      */}
          {activity.rideFacts?.workoutBlocks === undefined ? null : (
            <>
              <h3>Workout blocks</h3>
              <WorkoutBlocksTable blocks={activity.rideFacts.workoutBlocks} />
            </>
          )}

          {/*
        #388. Only for a ride the side camera filmed — the owner's ruling puts
        the report on the ride's own page and nowhere else, and a ride with no
        report renders nothing here at all.
      */}
          <SideCameraSection sideCamera={sideCamera} />

          {/*
        #1063. The side camera's snapshots of this ride — counted in words and
        CLOSED until the rider opens them; no picture is read or mounted before
        that (ADR 0044 D-6). A ride with none renders nothing. Keyed by the
        ride (#1063's review): the shell keys this view by ROUTE, so moving
        between two rides' pages keeps it mounted, and an opened section must
        not stay open for the next ride. The page's own loading state
        unmounts it between rides today; the key does not rest on that.
      */}
          <RideSnapshotsSection key={activity.id} port={snapshots} activityId={activity.id} />

          {/*
        #804, #805. A model's write-up of this ride, on every ride's page and
        below the side camera's report, never in place of it (ADR 0035 D-3):
        the saved one, screened again, and the press that asks for a new one.
        It sends nothing until that is pressed. With no instance it is one
        sentence.
      */}
          <RideWriteUpSection
            instance={instanceWriteUp}
            activityId={activity.id}
            initial={savedWriteUp}
            reread={async () =>
              port === undefined ? { kind: 'none' } : readWriteUp(port, activity.id)
            }
          />

          {/*
        #793. The ride's "may be raced" consent (ADR 0021 D-5.1): off unless
        the rider turns it on here, revocable here, and never the share
        setting. On every ride, because consent is per ride.
      */}
          <RaceConsentSection port={port} activity={activity} />

          {/*
        #836. The rider's own note on this ride, for the analysis to look back
        on: one passage of at most 900 characters, kept here and synced.
      */}
          <RiderTextBox
            port={riderText}
            kind="note"
            textKey={activity.id}
            maximum={MAXIMUM_RIDE_NOTE_CHARACTERS}
            words={NOTE_WORDS}
            headingLevel={3}
          />

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
                tiles={tiles}
                track={
                  showShared && shared !== undefined ? trackGeometry(shared.segments) : ownTrack
                }
              />

              <h3>What a shared copy would contain</h3>
              {showShared ? (
                <SharedSummary track={shared} own={activity.distance} />
              ) : (
                <>
                  {/* #1013: what a published copy would hide is a privacy sentence,
                kept on the screen whole. */}
                  <p className="oyl-muted" data-oyl-kept-visible="">
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

          {embedded ? null : <WayOut />}
        </div>
      </div>
    </>
  );
}

/**
 * #2069: the ride's time in zone, in whichever state its read is in. A ride
 * the analysis port does not hold renders nothing, not a heading over nothing.
 */
function RideZones({ state }: { readonly state: ZonesState }): JSX.Element | null {
  if (
    state.kind === 'none' ||
    (state.kind === 'ready' &&
      state.zones.power === undefined &&
      state.zones.heartRate === undefined)
  ) {
    return null;
  }
  const heading = <h3>Time in zone</h3>;
  if (state.kind === 'waiting') {
    return (
      <>
        {heading}
        <p className="oyl-muted">Reading time in zone…</p>
      </>
    );
  }
  if (state.kind === 'failed') {
    return (
      <>
        {heading}
        <StatusMessage tone="warning">
          Could not read this ride&rsquo;s time in zone. {state.reason}
        </StatusMessage>
      </>
    );
  }
  const { zones } = state;
  return (
    <>
      {heading}
      {zones.power === undefined ? null : (
        <ZoneTable
          breakdown={zones.power}
          movingTime={zones.movingTime}
          unit={POWER_UNIT}
          heading="Power zones"
          thresholdNoun="threshold power"
          assumed={zones.thresholds.assumed.power}
          basis="power"
          headingLevel={4}
        />
      )}
      {zones.heartRate === undefined ? null : (
        <ZoneTable
          breakdown={zones.heartRate}
          movingTime={zones.movingTime}
          unit="bpm"
          heading="Heart-rate zones"
          thresholdNoun="threshold heart rate"
          assumed={zones.thresholds.assumed.heartRate}
          basis="heartRate"
          headingLevel={4}
        />
      )}
    </>
  );
}

/**
 * #2081: the ride's power curve — the drawing, and its table one press away —
 * in whichever state its read is in. A ride with no power renders nothing.
 */
function RideCurve({
  ride,
  failed,
  allTime,
}: {
  /** The ride's own curve, from the power trace; `undefined` until that is read. */
  readonly ride: PowerDurationCurve | undefined;
  /** #2194: why the power trace's read failed, while it has. */
  readonly failed?: string | undefined;
  readonly allTime: AllTimeState;
}): JSX.Element {
  const heading = <h3>Power curve</h3>;
  if (ride === undefined && failed !== undefined) {
    return (
      <>
        {heading}
        <StatusMessage tone="warning">
          Could not read this ride&rsquo;s power, so its power curve cannot be drawn. {failed}
        </StatusMessage>
      </>
    );
  }
  if (ride === undefined || allTime.kind === 'waiting') {
    return (
      <>
        {heading}
        <p className="oyl-muted">Reading the power curve…</p>
      </>
    );
  }
  const best = allTime.kind === 'ready' ? allTime.curve : undefined;
  return (
    <>
      {heading}
      <ChartSlot
        caption={`Best average power (${POWER_UNIT}) for each length of time`}
        columns={[
          'Duration',
          `This ride (${POWER_UNIT})`,
          ...(best === undefined ? [] : [`All-time best (${POWER_UNIT})`]),
        ]}
        rows={curveRows(ride, best)}
        emptyMessage="No stretch of power in this ride is long enough to measure."
        tablePosition="disclosed"
        chart={
          <Suspense fallback={null}>
            <PowerCurveChart ride={ride} allTime={best} />
          </Suspense>
        }
      />
      {allTime.kind === 'failed' ? (
        <StatusMessage tone="warning">
          Could not read your all-time bests, so only this ride&rsquo;s line is drawn.{' '}
          {allTime.reason}
        </StatusMessage>
      ) : null}
      {allTime.kind === 'ready' && allTime.truncated ? (
        <p className="oyl-muted">
          The all-time line is your best across the {String(allTime.ridesRead)} most recent rides on
          this device.
        </p>
      ) : null}
    </>
  );
}

/** The shared cursor's control: its `id`, for the label (#2068). */
const TRACE_CURSOR_ID = 'oyl-trace-cursor';

/** #2081: the distance axis' title. Its labels carry the rider's unit. */
export const DISTANCE_AXIS_TITLE = 'Distance ridden';

/**
 * One step of the cursor: one drawn point (the ride over {@link CHART_POINTS}),
 * at least a second. A tap lands on a step too, so the slider and the line
 * always agree.
 */
function cursorStep(rideSeconds: number): number {
  return Math.max(1, Math.ceil(rideSeconds / CHART_POINTS));
}

/**
 * #2081: which axis the stacked charts share — the time into the ride, or the
 * distance ridden. A native radio pair drawn as `.oyl-segmented`, so a
 * keyboard moves between the two with the arrow keys.
 */
function AxisChoice({
  kind,
  onChange,
  distance,
  unit,
}: {
  readonly kind: AxisKind;
  readonly onChange: (kind: AxisKind) => void;
  readonly distance: DistanceState;
  readonly unit: string;
}): JSX.Element {
  const options: readonly { readonly value: AxisKind; readonly label: string }[] = [
    { value: 'time', label: 'Time' },
    { value: 'distance', label: `Distance (${unit})` },
  ];
  return (
    <>
      <fieldset className="oyl-segmented">
        <legend>Draw the charts against</legend>
        <div className="oyl-segmented__options">
          {options.map((option) => (
            <label key={option.value}>
              <input
                type="radio"
                name="oyl-trace-axis"
                value={option.value}
                checked={kind === option.value}
                onChange={() => {
                  onChange(option.value);
                }}
              />{' '}
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
      {kind !== 'distance' ? null : distance.kind === 'none' ? (
        <StatusMessage tone="info">
          This ride&rsquo;s speed covers no distance, so its charts stay drawn against time.
        </StatusMessage>
      ) : distance.kind === 'failed' ? (
        // #2194: a speed read that failed says so, not "Reading…" for good.
        <StatusMessage tone="warning">
          Could not read this ride&rsquo;s speed, so its charts stay drawn against time.{' '}
          {distance.reason}
        </StatusMessage>
      ) : distance.kind === 'ready' ? null : (
        <p className="oyl-muted">Reading the distance ridden…</p>
      )}
    </>
  );
}

/**
 * The shared cursor — #2068. A native range input, so it is keyboard-operable
 * by the platform (arrows, Page Up and Down, Home and End), moving one line
 * across every chart in the stack; what each drawn chart reads at that moment
 * is said in words beside it, in an `<output>`, so the reading is text and
 * not only a position on a picture.
 *
 * One step is one drawn point (the ride over {@link CHART_POINTS}), at least a
 * second, so the arrow keys move the line by a point and no further.
 */
function TraceCursor({
  seconds,
  saidAt,
  rideSeconds,
  onChange,
  distance,
  lap,
  readings,
}: {
  readonly seconds: number;
  /**
   * #2194: the moment the read-out says — {@link seconds}, except while a
   * hover has not rested. The distance and the lap are the read-out's too.
   */
  readonly saidAt: number;
  readonly rideSeconds: number;
  readonly onChange: (seconds: number) => void;
  /** #2081: the distance ridden by then, with its unit, once the distance axis has been read. */
  readonly distance?: string | undefined;
  /** #2081: the lap being ridden then, if any. */
  readonly lap?: LapBand | undefined;
  /** The charts drawn so far, in stack order. A chart still to be read says nothing yet. */
  readonly readings: readonly { readonly series: TraceSeriesDefinition; readonly trace: Trace }[];
}): JSX.Element {
  const step = cursorStep(rideSeconds);
  const at = [
    formatDuration(saidAt),
    ...(distance === undefined ? [] : [distance]),
    ...(lap === undefined ? [] : [`lap ${String(lap.number)}`]),
  ].join(', ');
  const said = readings.map(({ series, trace }) => {
    const value = pointAt(trace.points, trace.secondsPerPoint, saidAt);
    return `${series.label} ${value === undefined ? 'no reading' : `${series.format(value)} ${series.unit}`}`;
  });
  return (
    <div className="oyl-trace-cursor">
      <label htmlFor={TRACE_CURSOR_ID}>Read every chart at</label>
      <input
        id={TRACE_CURSOR_ID}
        type="range"
        min={0}
        max={rideSeconds}
        step={step}
        value={seconds}
        aria-valuetext={formatDuration(seconds)}
        onChange={(event) => {
          onChange(Number(event.currentTarget.value));
        }}
      />
      {/* #2081: polite and whole, so a screen reader says every channel's
          reading each time the cursor moves — by key or tap at once, and by
          a hover once it rests (#2194). */}
      <output
        htmlFor={TRACE_CURSOR_ID}
        className="oyl-trace-cursor__reading"
        aria-live="polite"
        aria-atomic="true"
      >
        {at}
        {said.length === 0 ? '' : `: ${said.join(', ')}`}
      </output>
    </div>
  );
}

/** One channel's chart and its table, once its trace has been read. */
function TraceSlot({
  series,
  trace,
  rideSeconds,
  cursor,
  axis,
  laps,
  onPick,
}: {
  readonly series: TraceSeriesDefinition;
  readonly trace: Trace;
  /** The shared time axis' span, in seconds (#2068). */
  readonly rideSeconds: number;
  /** The shared cursor, in seconds (#2068). */
  readonly cursor: number;
  /** #2081: the axis the stack shares, its laps, and where a tap moves the cursor. */
  readonly axis: RideAxis;
  readonly laps: readonly LapBand[];
  readonly onPick: (seconds: number, how: PickKind) => void;
}): JSX.Element {
  const here = pointAt(trace.points, trace.secondsPerPoint, cursor);
  // The table is the same trace at reading resolution rather than at drawing
  // resolution — `series.ts` records why six hundred rows is not an equivalent
  // of anything. Derived from the points the chart already holds, so it costs
  // no further read.
  const tableRows = downsample(trace.points, TABLE_ROWS);
  const secondsPerRow =
    tableRows.length === 0 ? 0 : (trace.points.length * trace.secondsPerPoint) / tableRows.length;
  const rows = tableRows.map((value, index) => [
    formatDuration(index * secondsPerRow),
    // Named rather than an em dash. A gap and a zero reading are different
    // facts and the table is where a reader who cannot see the broken line
    // finds that out.
    value === undefined ? 'no reading' : series.format(value),
  ]);
  return (
    <ChartSlot
      caption={`${series.label} (${series.unit})`}
      columns={['From', `${series.label} (${series.unit})`]}
      rows={rows}
      emptyMessage="No readings in this ride."
      // #1439: the table is the chart's alternative, not a second screen of
      // numbers open under it by default.
      tablePosition="disclosed"
      chart={
        <Suspense fallback={null}>
          <TraceChart
            label={series.label}
            unit={series.unit}
            points={trace.points}
            secondsPerPoint={trace.secondsPerPoint}
            format={series.format}
            missingSamples={trace.missingSamples}
            timeSpan={rideSeconds}
            cursor={cursor}
            axis={axis}
            laps={laps}
            // A dropped sensor shows a dash, never a number.
            cursorReading={here === undefined ? '—' : `${series.format(here)} ${series.unit}`}
            onPick={onPick}
          />
        </Suspense>
      }
    />
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
  const units = useUnits();
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
            {formatDistance(track.distance, units).value} {distanceUnit(units)}
          </dd>
        </div>
        <div>
          <dt>Your own distance</dt>
          <dd>
            {formatDistance(own, units).value} {distanceUnit(units)}
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
