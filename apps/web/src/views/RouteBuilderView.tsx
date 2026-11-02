// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type JSX,
} from 'react';

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  unixSeconds,
  type GeographicPosition,
  type RidingPreferences,
  type RoutingProvider,
  type SurfaceTolerance,
} from '@onyourleft/domain';
import type { RouteId } from '@onyourleft/store';

import { Button } from '../design/Button';
import { SectionHeading } from '../design/SectionHelp';
import { StatusMessage } from '../design/StatusMessage';
import { VisuallyHidden } from '../design/VisuallyHidden';
import { useUnits } from '../units/context';
import {
  distanceUnit,
  formatDistance,
  formatSmallDistance,
  measurementText,
} from '../units/format';
import { deviceStorage, type PreferenceStorage } from '../game/hud/announce-preference';
import type { BasemapConfig } from '../map/basemap';
import { MapPanel } from '../map/MapPanel';
import { useOnline } from '../map/online';
import type { MapPointerHandlers, MapPort, MapView } from '../map/port';
import { readMapTilesChoice } from '../map/tiles-preference';
import {
  addWaypoint,
  clear,
  deleteWaypoint,
  draftDistance,
  insertWaypoint,
  isEmpty,
  moveWaypoint,
  resolveDraft,
  reverse,
  setLegMode,
  type DraftEdit,
  type LegMode,
  type RouteDraft,
} from '../routing/draft';
import { browserDraftStorage, type DraftStorage } from '../routing/draft-storage';
import { planElevation, type PlannedElevation } from '../routing/elevation';
import {
  canRedo,
  canUndo,
  newHistory,
  record,
  redo,
  settle,
  undo,
  type DraftHistory,
} from '../routing/history';
import {
  draftGeometry,
  EMPTY_PLANNER_VIEW,
  legMidpoint,
  mapWaypoints,
  nearestLeg,
} from '../routing/map-edit';
import { RIDING_DEFAULTS, strandingRisk, SURFACE_LABELS } from '../routing/preferences';
import {
  elevationSentence,
  GRADE_BANDS,
  profileRows,
  surfaceSummary,
  unresolvedSentence,
} from '../routing/present';
import { ScrollTable } from '../design/ScrollTable';
import { FLAT_DRAWN_ROUTE_TEXT, routeFromDraft, type SaveRefusal } from '../routes/save';
import type { RoutePort } from '../routes/store-port';
import { hrefForSelection, routeById } from '../shell/routes';

/**
 * The route drawing canvas — [#71](https://github.com/openzigs/onyourleft/issues/71)
 * — and the profile it produces — [#72](https://github.com/openzigs/onyourleft/issues/72).
 *
 * ## Why the waypoints are a list and not only pins on a map
 *
 * #71's eighth criterion: *"the canvas is operable **without a mouse**:
 * waypoints can be added, selected and moved from the keyboard, per #48's
 * baseline. A map-only interaction excludes users the project has committed to
 * supporting."*
 *
 * A drag on a canvas is not operable from a keyboard and cannot be made so by
 * adding a `tabindex` to it. So the waypoints are a real ordered list of real
 * controls — select, nudge in four directions, delete — and the map, when there
 * is one to draw on, is a second way to do the same things rather than the only
 * way. That ordering is deliberate: the list is what the accessibility suite
 * audits and what a screen-reader user actually operates, and building it first
 * means the keyboard path is the one that cannot rot.
 *
 * ## The map — #2006
 *
 * Under the list's buttons, the published basemap (ADR 0062) is the second
 * way: a tap adds a waypoint there, a marker drags, and pulling the line
 * between two waypoints puts a new one where it is let go
 * (`routing/map-edit.ts` decides which leg). The first waypoint the list adds
 * lands at the map's centre, where the rider has been looking, rather than at
 * a fixed default. Each gesture has a list equivalent — *Add a waypoint*, the
 * nudges, and *Add a waypoint halfway along* on a leg's row — so the map is
 * never the only way (WCAG 2.2 SC 2.1.1 and 2.5.7). With no WebGL, no basemap
 * or no network, the panel says so and the list carries on; with map tiles
 * turned off the line is drawn on a plain background, offline too. ⚠️ A
 * reviewer who remembers this paragraph saying there is no tile archive is
 * reading the old file.
 *
 * ⚠️ **There is no routing engine.** `routing/testing.ts` says why at length:
 * ADR 0010 D-4 chose Valhalla and nothing is running, so the provider arrives
 * as a prop and this screen explains itself when there is none. With none, a
 * new leg is freehand — a straight line whose distance is a lower bound — so
 * a route can still be drawn and saved (#2006).
 *
 * ## Saving it — #2006
 *
 * *Save to your routes* writes the drawn line as an ordinary saved route
 * (`routes/save.ts` §`routeFromDraft`), in the same list as an import, ridden
 * and downloaded the same way. The draft stays on screen afterwards.
 *
 * ## What this screen is careful about
 *
 * **Clear asks first.** #71: *"an unconfirmed clear that destroys an hour of
 * planning is the single most expensive UI mistake available here."* The same
 * arm-then-confirm shape the ride screen's Stop uses.
 *
 * **A failed leg fails on its own row**, with the rest of the route still
 * editable, and the row says whether asking again could work.
 *
 * **Nothing on this screen is carried by colour.** Every gradient band has a
 * name and the table prints it — #72's last criterion and `AnalysisView.tsx`'s
 * standing rule.
 */

export interface RouteBuilderViewProps {
  /**
   * The engine, or `undefined` where there is none.
   *
   * Optional like every other port in this shell, and for the same reason: the
   * accessibility suite renders every route with none of them. With no provider
   * a rider can still place, move and delete waypoints — what they cannot get
   * is geometry between them, and the screen says so rather than looking broken.
   */
  readonly provider?: RoutingProvider | undefined;
  /**
   * Where a half-drawn route is kept across a reload.
   *
   * Injected so a test can supply one that is not the browser's — `jsdom`'s
   * `localStorage` is real enough, but a test that shares it with every other
   * test in the file is a test that depends on its neighbours.
   */
  readonly storage?: DraftStorage | undefined;
  /**
   * Where a first waypoint lands when there is no map to read a centre from.
   * With a map, it lands at the map's centre (#2006).
   */
  readonly origin?: GeographicPosition | undefined;
  /** How to get a map engine (#2006), or `undefined` where there is none — `RoutesView`'s loader. */
  readonly map?: (() => Promise<MapPort>) | undefined;
  /** Where the basemap is, or `undefined` for a build configured with none (#534). */
  readonly basemap?: BasemapConfig | undefined;
  /** Where the rider's map-tiles choice is kept — this device's unless a test hands in a double. */
  readonly preferences?: PreferenceStorage | undefined;
  /** Where a drawn route is saved (#2006): the saved routes' store, or `undefined` with none. */
  readonly routes?: RoutePort | undefined;
  /** The instant to stamp a save with. Injected so a test can assert what was written. */
  readonly now?: (() => number) | undefined;
}

/** The map engine (#2006), loaded as `RoutesView` loads it. */
type MapEngine =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly port: MapPort }
  | { readonly kind: 'failed' };

/** What the planner says when the map engine itself could not be loaded (#2006). */
export const PLANNER_MAP_FAILED_TEXT =
  'The map could not be loaded on this device. The waypoint list places and moves every waypoint.';

/** The planner's one line about its map's gestures (#2006). */
export const PLANNER_MAP_TEXT =
  'Tap the map to add a waypoint, drag one to move it, or drag the line to add one there.';

/** A profile, and the draft it was worked out for — see `routeFromDraft`'s `elevation`. */
interface ElevationFor {
  readonly draft: RouteDraft;
  readonly planned: PlannedElevation;
}

/** The last save, said under the form. */
type Saved =
  | { readonly kind: 'saved'; readonly id: string; readonly name: string; readonly flat: boolean }
  | { readonly kind: 'refused'; readonly refusal: SaveRefusal };

/**
 * How far one nudge moves a waypoint: **0.0005°**, about 55 m north–south.
 *
 * A keyboard step has to be a stated distance rather than "a pixel", because
 * there is no pixel without a map. Fifty-odd metres is about the width of a
 * junction — small enough to place a waypoint on the right road, large enough
 * that reaching the next street does not take a hundred presses.
 */
export const NUDGE_DEGREES = 0.0005;

/**
 * Metres in a degree of latitude, near enough for a sentence about a keyboard
 * step.
 *
 * Named rather than left as the bare `111_320` it was before #238, because the
 * sentence it feeds now goes through `units/format.ts` and a reader needs to
 * see that this is a latitude conversion and not a unit one. It is an average:
 * a degree of latitude varies by about 1 % between the equator and the poles,
 * which does not matter for "about 55 m".
 */
const METRES_PER_DEGREE_LATITUDE = 111_320;

const DEFAULT_ORIGIN = geographicPosition(degreesLatitude(51.5), degreesLongitude(-0.12));

export function RouteBuilderView({
  provider,
  storage,
  origin,
  map,
  basemap,
  preferences: tilePreferences,
  routes,
  now,
}: RouteBuilderViewProps): JSX.Element {
  const keep = useRef<DraftStorage>(
    storage ?? browserDraftStorage(typeof localStorage === 'undefined' ? undefined : localStorage),
  );
  const [history, setHistory] = useState<DraftHistory>(() => newHistory(keep.current.read()));
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [preferences, setPreferences] = useState<RidingPreferences>(RIDING_DEFAULTS);
  const [elevationFor, setElevation] = useState<ElevationFor | undefined>(undefined);
  const elevation = elevationFor?.planned;
  const [elevationFault, setElevationFault] = useState<string | undefined>(undefined);
  const [clearArmed, setClearArmed] = useState(false);
  const [engine, setEngine] = useState<MapEngine>({ kind: 'loading' });
  const [saved, setSaved] = useState<Saved | undefined>(undefined);
  // Read once, as `RoutesView` reads it: the switch is on the Settings screen.
  const [tiles] = useState(() => readMapTilesChoice(tilePreferences ?? deviceStorage()));
  const online = useOnline();
  const nameId = useId();
  /** The live map, for its centre (#2006). */
  const mapView = useRef<MapView | undefined>(undefined);
  const units = useUnits();

  const draft = history.present;
  /** With no routing service a new leg is a straight line (#2006). */
  const newLegMode: LegMode = provider === undefined ? 'freehand' : 'snapped';

  /**
   * Route the stale legs, then keep the answer without making a history step.
   *
   * ⚠️ `settle`, not `record`. A routing answer is not an edit — see
   * `history.ts` — and recording it would cost the rider two presses of undo
   * for one move, the first of which would appear to do nothing.
   */
  const apply = useCallback(
    (edit: DraftEdit) => {
      setHistory((current) => record(current, edit.draft));
      if (provider === undefined || edit.stale.length === 0) {
        return;
      }
      void resolveDraft(edit.draft, edit.stale, provider, preferences).then((resolved) => {
        setHistory((current) =>
          current.present === edit.draft ? settle(current, resolved) : current,
        );
      });
    },
    [provider, preferences],
  );

  // Keep the draft across a reload. Waypoints and leg modes only — see
  // `draft-storage.ts` on why the geometry is dropped.
  useEffect(() => {
    if (isEmpty(draft)) keep.current.forget();
    else keep.current.write(draft);
  }, [draft]);

  // Legs restored from storage arrive unrouted, so ask for them on mount.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || provider === undefined) return;
    restored.current = true;
    const stale = draft.legs.flatMap((leg, index) =>
      leg.state === 'pending' && leg.mode === 'snapped' ? [index] : [],
    );
    if (stale.length === 0) return;
    void resolveDraft(draft, stale, provider, preferences).then((resolved) => {
      // ⚠️ **The same guard `apply` uses, and it was missing here.** A rider
      // who places a waypoint while the restore is still in flight would
      // otherwise have their edit silently replaced by the pre-edit draft —
      // and `history` would keep the edit, so undo and the screen would then
      // disagree about what the route is. Found by review.
      setHistory((current) => (current.present === draft ? settle(current, resolved) : current));
    });
  }, [draft, provider, preferences]);

  // The profile follows the geometry rather than the edit, so it is not
  // recomputed while a leg is still being routed.
  const routedLegs = draft.legs.filter((leg) => leg.state === 'routed').length;
  useEffect(() => {
    if (provider === undefined || routedLegs === 0) {
      setElevation(undefined);
      return;
    }
    let live = true;
    setElevationFault(undefined);
    void planElevation(draft, provider)
      .then((planned) => {
        if (live) setElevation(planned === undefined ? undefined : { draft, planned });
      })
      .catch((error: unknown) => {
        if (!live) return;
        setElevation(undefined);
        // ⚠️ One place for one failure. A height lookup is about the whole
        // route rather than about one leg, which is why `planElevation` — unlike
        // `resolveDraft` — is allowed to reject.
        setElevationFault(
          error instanceof Error ? error.message : 'The elevation service could not be reached.',
        );
      });
    return () => {
      live = false;
    };
  }, [draft, provider, routedLegs]);

  // The map engine, fetched once (#2006): the loader is the module's `import()`.
  useEffect(() => {
    if (map === undefined || engine.kind !== 'loading') return undefined;
    let live = true;
    map().then(
      (loaded) => {
        if (live) setEngine({ kind: 'ready', port: loaded });
      },
      () => {
        if (live) setEngine({ kind: 'failed' });
      },
    );
    return () => {
      live = false;
    };
  }, [map, engine.kind]);

  const place = (): void => {
    const last =
      draft.waypoints.at(-1)?.position ?? mapView.current?.centre() ?? origin ?? DEFAULT_ORIGIN;
    const next =
      draft.waypoints.length === 0
        ? last
        : geographicPosition(
            degreesLatitude(last.latitude + NUDGE_DEGREES * 4),
            degreesLongitude(last.longitude),
          );
    apply(addWaypoint(draft, next, newLegMode));
  };

  /** What the map's gestures do to the draft (#2006). Read at the gesture, through a ref. */
  const pointer: MapPointerHandlers = {
    tap: (position) => {
      apply(addWaypoint(draft, position, newLegMode));
    },
    moveWaypoint: (id, position) => {
      apply(moveWaypoint(draft, id, position));
    },
    dragLine: (from, to) => {
      const leg = nearestLeg(draft, from);
      if (leg !== undefined) apply(insertWaypoint(draft, leg, to));
    },
  };
  const geometry = useMemo(() => draftGeometry(draft), [draft]);
  const markers = useMemo(() => mapWaypoints(draft), [draft]);
  const onView = useCallback((view: MapView | undefined) => {
    mapView.current = view;
  }, []);

  const onSave = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (routes === undefined) return;
    const name = new FormData(event.currentTarget).get('name');
    const instant = now === undefined ? Date.now() / 1000 : now();
    const planned = elevationFor?.draft === draft ? elevationFor.planned : undefined;
    const outcome = routeFromDraft(draft, {
      id: `route-${String(Math.round(instant * 1000))}` as RouteId,
      owner: routes.athleteId,
      name: typeof name === 'string' ? name : '',
      now: unixSeconds(Math.floor(instant)),
      elevation: planned,
    });
    if (outcome.status === 'refused') {
      setSaved({ kind: 'refused', refusal: outcome.refusal });
      return;
    }
    try {
      await routes.store.putRoute(outcome.record);
    } catch {
      setSaved({
        kind: 'refused',
        refusal: {
          code: 'not-a-route',
          message: 'The route could not be saved on this device. Nothing was lost from the plan.',
        },
      });
      return;
    }
    setSaved({
      kind: 'saved',
      id: outcome.record.id,
      name: outcome.record.name,
      flat: outcome.record.elevation === undefined,
    });
  };

  const nudge = (id: string, north: number, east: number): void => {
    const waypoint = draft.waypoints.find((candidate) => candidate.id === id);
    if (waypoint === undefined) return;
    apply(
      moveWaypoint(
        draft,
        id,
        geographicPosition(
          degreesLatitude(waypoint.position.latitude + north * NUDGE_DEGREES),
          degreesLongitude(waypoint.position.longitude + east * NUDGE_DEGREES),
        ),
      ),
    );
  };

  const surfaces = surfaceSummary(draft);
  const unresolved = unresolvedSentence(draft.legs);
  const risk = strandingRisk(preferences.surface);

  return (
    <>
      {provider === undefined ? (
        <StatusMessage tone="warning" label="No routing service">
          Nothing can work out the roads between waypoints until a routing service is configured, so
          each leg is a straight line: the distance is at least the one shown, and climbing stays
          empty.
        </StatusMessage>
      ) : null}

      {/* #1013: how waypoints work and the keyboard are the section's help, so
        an empty route keeps its one line, "No waypoints yet". */}
      <SectionHeading
        level={2}
        help={
          <p>
            Place waypoints in order, on the map or from this list. Every control here works from
            the keyboard — a nudge moves a waypoint about{' '}
            {measurementText(
              formatSmallDistance(NUDGE_DEGREES * METRES_PER_DEGREE_LATITUDE, units),
            )}
            .
          </p>
        }
      >
        Waypoints
      </SectionHeading>

      {/*
        ⚠️ **A control that cannot act is absent, not disabled.**
        `design/Button.tsx` states the rule and #48's first criterion is behind
        it: a disabled button leaves the tab order, so a keyboard user never
        reaches it and never hears why. There is nothing to explain here either
        — "Undo" with nothing to undo is not a thing a rider is owed a sentence
        about — so these simply appear when they mean something.
      */}
      <div>
        <Button onClick={place}>Add a waypoint</Button>
        {canUndo(history) ? (
          <Button
            variant="secondary"
            onClick={() => {
              setHistory(undo(history));
            }}
          >
            Undo
          </Button>
        ) : null}
        {canRedo(history) ? (
          <Button
            variant="secondary"
            onClick={() => {
              setHistory(redo(history));
            }}
          >
            Redo
          </Button>
        ) : null}
        {draft.waypoints.length >= 2 ? (
          <Button
            variant="secondary"
            onClick={() => {
              apply(reverse(draft));
            }}
          >
            Reverse
          </Button>
        ) : null}
        {clearArmed ? (
          <>
            <Button
              variant="secondary"
              onClick={() => {
                apply(clear(draft));
                setSelected(undefined);
                setClearArmed(false);
              }}
            >
              Yes, clear the route
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setClearArmed(false);
              }}
            >
              Keep the route
            </Button>
          </>
        ) : isEmpty(draft) ? null : (
          <Button
            variant="secondary"
            onClick={() => {
              setClearArmed(true);
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {clearArmed ? (
        <StatusMessage tone="warning" label="Clear the whole route?">
          This removes all {String(draft.waypoints.length)} waypoints. Undo brings them back.
        </StatusMessage>
      ) : null}

      {map === undefined ? null : engine.kind === 'failed' ? (
        <p className="oyl-muted">{PLANNER_MAP_FAILED_TEXT}</p>
      ) : engine.kind === 'loading' ? (
        <p className="oyl-muted">Loading the map…</p>
      ) : (
        <>
          {/* Only over a map there is to tap: with no basemap, or offline with
              tiles on, the panel says why there is none instead. */}
          {basemap !== undefined && (online || !tiles) ? <p>{PLANNER_MAP_TEXT}</p> : null}
          <MapPanel
            port={engine.port}
            basemap={basemap}
            tiles={tiles}
            track={geometry}
            subject="draft"
            offline={!online}
            editing={{
              waypoints: markers,
              pointer,
              emptyView: EMPTY_PLANNER_VIEW,
              onView,
            }}
          />
        </>
      )}

      {isEmpty(draft) ? (
        <p>No waypoints yet. Add one to start a route.</p>
      ) : (
        <ol>
          {draft.waypoints.map((waypoint, index) => (
            <li key={waypoint.id}>
              {/*
                #668: selecting a waypoint changes what the nudges act on, not
                the route, so it is a toggle. Its name stays "Waypoint N" and
                `aria-pressed` says whether it is the selected one — a name
                that changed with the state would be announced as a different
                control on every press.
              */}
              <Button
                variant="toggle"
                pressed={waypoint.id === selected}
                onClick={() => {
                  setSelected(waypoint.id === selected ? undefined : waypoint.id);
                }}
              >
                {`Waypoint ${String(index + 1)}`}
              </Button>
              {(
                [
                  ['North', 1, 0],
                  ['South', -1, 0],
                  ['East', 0, 1],
                  ['West', 0, -1],
                ] as const
              ).map(([label, north, east]) => (
                <Button
                  variant="secondary"
                  key={label}
                  onClick={() => {
                    nudge(waypoint.id, north, east);
                  }}
                >
                  {`Move waypoint ${String(index + 1)} ${label.toLowerCase()}`}
                </Button>
              ))}
              <Button
                variant="secondary"
                onClick={() => {
                  apply(deleteWaypoint(draft, waypoint.id));
                  if (selected === waypoint.id) setSelected(undefined);
                }}
              >
                {`Delete waypoint ${String(index + 1)}`}
              </Button>
            </li>
          ))}
        </ol>
      )}

      <h2>Legs</h2>
      {draft.legs.length === 0 ? (
        <p>A route needs two waypoints before it has a leg.</p>
      ) : (
        <ScrollTable
          caption={
            <>
              Each leg runs from one waypoint to the next. A freehand leg is a straight line you
              drew yourself, so its distance is a lower bound and nothing knows its surface.
            </>
          }
        >
          <thead>
            <tr>
              <th scope="col">Leg</th>
              <th scope="col">Drawn</th>
              <th scope="col">Surface</th>
              <th scope="col">State</th>
              <th scope="col">
                <VisuallyHidden>Change or split this leg</VisuallyHidden>
              </th>
            </tr>
          </thead>
          <tbody>
            {draft.legs.map((leg, index) => (
              <tr key={`leg-${String(index)}`}>
                <th scope="row">{`${String(index + 1)} to ${String(index + 2)}`}</th>
                <td>{leg.mode === 'snapped' ? 'Following roads' : 'Freehand'}</td>
                <td>{surfaceWord(leg.surface)}</td>
                <td>
                  {leg.state === 'routed'
                    ? measurementText(formatDistance(leg.distance, units))
                    : (leg.failure?.message ?? 'Being routed')}
                  {leg.failure?.retryable === true ? ' This one is worth trying again.' : ''}
                </td>
                <td>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      apply(
                        setLegMode(draft, index, leg.mode === 'snapped' ? 'freehand' : 'snapped'),
                      );
                    }}
                  >
                    {leg.mode === 'snapped'
                      ? `Draw leg ${String(index + 1)} freehand`
                      : `Follow roads on leg ${String(index + 1)}`}
                  </Button>
                  {/* #2006: the list's way to do what pulling the line does. */}
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const middle = legMidpoint(draft, index);
                      if (middle !== undefined) apply(insertWaypoint(draft, index, middle));
                    }}
                  >
                    {`Add a waypoint halfway along leg ${String(index + 1)}`}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}
      {unresolved === undefined ? null : (
        <StatusMessage tone="warning" label="Some legs have no route">
          {unresolved}
        </StatusMessage>
      )}

      <h2>How it should be routed</h2>
      <p>
        <label htmlFor="surface-tolerance">What you will ride on</label>
      </p>
      <select
        id="surface-tolerance"
        value={preferences.surface}
        onChange={(event) => {
          setPreferences({ ...preferences, surface: event.target.value as SurfaceTolerance });
        }}
      >
        {Object.entries(SURFACE_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {risk === undefined ? null : (
        <StatusMessage tone="warning" label="This setting can refuse a route">
          {risk}
        </StatusMessage>
      )}

      <h2>Distance, climbing and surface</h2>
      <p>
        {/* #2006: a freehand leg's length is a lower bound, so a total with one is a minimum. */}
        {`${surfaces.freehandLegs > 0 ? 'At least ' : ''}${measurementText(formatDistance(draftDistance(draft), units))} over ${String(draft.legs.length)} ${draft.legs.length === 1 ? 'leg' : 'legs'}.`}
      </p>
      <p>
        {`Paved ${measurementText(formatDistance(metres(surfaces.pavedMetres), units))}, unpaved ${measurementText(formatDistance(metres(surfaces.unpavedMetres), units))}, unknown ${measurementText(formatDistance(metres(surfaces.unknownMetres), units))}.`}
        {surfaces.freehandLegs > 0
          ? ` ${String(surfaces.freehandLegs)} freehand ${surfaces.freehandLegs === 1 ? 'leg is' : 'legs are'} counted as unknown, because nothing was asked about them.`
          : ''}
      </p>

      {elevationFault === undefined ? null : (
        <StatusMessage tone="danger" label="No elevation">
          {elevationFault}
        </StatusMessage>
      )}
      {elevation === undefined ? (
        <p>No elevation profile yet.</p>
      ) : (
        <>
          <p>{elevationSentence(elevation, units)}</p>
          <ScrollTable
            caption={
              <>
                The gradient along the route. Each row names its band, so nothing here is carried by
                colour alone. Bands: {GRADE_BANDS.map((band) => band.name).join(', ')}.
              </>
            }
          >
            {/*
              ⚠️ **The unit is in the column heading, not beside every number,
              and that is a decision rather than a side effect of the #238
              refactor.** #238's third criterion reads *"the unit is always
              shown beside the number, never implied"*, and a review asked
              whether this is a step away from it. It is not, for a reason
              specific to a table: `scope="col"` is the association HTML
              provides, so a screen reader announces "From (km), 0.0" for the
              cell — the unit is *carried* rather than implied, which a caption
              or a paragraph above the table would not do. Repeating it on
              every row of a twenty-row gradient table would also be read out
              twenty times. The library table and the laps table already work
              this way; a number outside a table — the elevation sentence
              above, every reading on the ride screen — still carries its own
              unit, which is where the criterion bites.
            */}
            <thead>
              <tr>
                <th scope="col">From ({distanceUnit(units)})</th>
                <th scope="col">To ({distanceUnit(units)})</th>
                <th scope="col">Gradient</th>
                <th scope="col">Steepest</th>
                <th scope="col">Measured</th>
              </tr>
            </thead>
            <tbody>
              {profileRows(elevation, units).map((row) => (
                <tr key={`${row.from}-${row.to}`}>
                  <th scope="row">{row.from}</th>
                  <td>{row.to}</td>
                  <td>{row.band}</td>
                  <td>{`${String(row.steepest)}%`}</td>
                  <td>{row.measured ? 'Yes' : 'No — the dataset has no height here'}</td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        </>
      )}

      {/* #2006: the drawn route, into the same library as an imported one. */}
      {routes === undefined ? null : (
        <>
          <h2>Save this route</h2>
          {draft.waypoints.length < 2 ? (
            <p>A route needs two waypoints before it can be saved.</p>
          ) : (
            <form aria-label="Save this route" onSubmit={(event) => void onSave(event)}>
              <p>
                <label htmlFor={nameId}>Name</label>{' '}
                <input id={nameId} name="name" type="text" autoComplete="off" />
              </p>
              <Button type="submit" variant="secondary">
                Save to your routes
              </Button>
            </form>
          )}
          {saved?.kind === 'refused' ? (
            <StatusMessage tone="warning" live>
              {saved.refusal.message}
            </StatusMessage>
          ) : null}
          {saved?.kind === 'saved' ? (
            <StatusMessage tone="success" live>
              {`Saved “${saved.name}” to your routes. It is private.`}
              {saved.flat ? ` ${FLAT_DRAWN_ROUTE_TEXT}` : ''}{' '}
              <a href={hrefForSelection(routeById('routes'), saved.id)}>Open it in Routes</a>
            </StatusMessage>
          ) : null}
        </>
      )}
    </>
  );
}

function surfaceWord(surface: 'paved' | 'unpaved' | 'unknown'): string {
  if (surface === 'paved') return 'Paved';
  if (surface === 'unpaved') return 'Unpaved';
  // ⚠️ Never "Paved" by default. #72: assuming paved is how a road bike ends up
  // on a gravel track.
  return 'Unknown';
}
