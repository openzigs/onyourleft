// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  type GeographicPosition,
  type RidingPreferences,
  type RoutingProvider,
  type SurfaceTolerance,
} from '@onyourleft/domain';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import { VisuallyHidden } from '../design/VisuallyHidden';
import { useUnits } from '../units/context';
import {
  distanceUnit,
  formatDistance,
  formatSmallDistance,
  measurementText,
} from '../units/format';
import {
  addWaypoint,
  clear,
  deleteWaypoint,
  draftDistance,
  isEmpty,
  moveWaypoint,
  resolveDraft,
  reverse,
  setLegMode,
  type DraftEdit,
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
import { RIDING_DEFAULTS, strandingRisk, SURFACE_LABELS } from '../routing/preferences';
import {
  elevationSentence,
  GRADE_BANDS,
  profileRows,
  surfaceSummary,
  unresolvedSentence,
} from '../routing/present';

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
 * ⚠️ **There is no map on this screen yet, and that is #53 rather than an
 * omission here.** `map/port.ts` exists and `MapPanel` renders through it, but
 * ADR 0010 D-1's tile archive is not published, so a map would be a grey
 * rectangle. Everything this screen does works without one, which is the
 * property that made the list-first ordering worth choosing.
 *
 * ⚠️ **And there is no routing engine.** `routing/testing.ts` says why at
 * length: ADR 0010 D-4 chose Valhalla and nothing is running, so the provider
 * arrives as a prop and this screen explains itself when there is none. Every
 * decision about *what to ask* is made here and is tested; the asking is #53's.
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
  /** Where a first waypoint lands when there is nothing to place it relative to. */
  readonly origin?: GeographicPosition | undefined;
}

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
}: RouteBuilderViewProps): JSX.Element {
  const keep = useRef<DraftStorage>(
    storage ?? browserDraftStorage(typeof localStorage === 'undefined' ? undefined : localStorage),
  );
  const [history, setHistory] = useState<DraftHistory>(() => newHistory(keep.current.read()));
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [preferences, setPreferences] = useState<RidingPreferences>(RIDING_DEFAULTS);
  const [elevation, setElevation] = useState<PlannedElevation | undefined>(undefined);
  const [elevationFault, setElevationFault] = useState<string | undefined>(undefined);
  const [clearArmed, setClearArmed] = useState(false);
  const units = useUnits();

  const draft = history.present;

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
        if (live) setElevation(planned);
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

  const place = (): void => {
    const last = draft.waypoints.at(-1)?.position ?? origin ?? DEFAULT_ORIGIN;
    const next =
      draft.waypoints.length === 0
        ? last
        : geographicPosition(
            degreesLatitude(last.latitude + NUDGE_DEGREES * 4),
            degreesLongitude(last.longitude),
          );
    apply(addWaypoint(draft, next));
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
          Waypoints can be placed and moved, but nothing can work out the roads between them until a
          routing service is configured. Distance and climbing stay empty until then.
        </StatusMessage>
      ) : null}

      <h2>Waypoints</h2>
      <p>
        Place waypoints in order; the roads between them are worked out for you. Every control here
        works from the keyboard — a nudge moves a waypoint about{' '}
        {measurementText(formatSmallDistance(NUDGE_DEGREES * METRES_PER_DEGREE_LATITUDE, units))}.
      </p>

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
            onClick={() => {
              setHistory(undo(history));
            }}
          >
            Undo
          </Button>
        ) : null}
        {canRedo(history) ? (
          <Button
            onClick={() => {
              setHistory(redo(history));
            }}
          >
            Redo
          </Button>
        ) : null}
        {draft.waypoints.length >= 2 ? (
          <Button
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
              onClick={() => {
                apply(clear(draft));
                setSelected(undefined);
                setClearArmed(false);
              }}
            >
              Yes, clear the route
            </Button>
            <Button
              onClick={() => {
                setClearArmed(false);
              }}
            >
              Keep the route
            </Button>
          </>
        ) : isEmpty(draft) ? null : (
          <Button
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

      {isEmpty(draft) ? (
        <p>No waypoints yet. Add one to start a route.</p>
      ) : (
        <ol>
          {draft.waypoints.map((waypoint, index) => (
            <li key={waypoint.id}>
              <Button
                onClick={() => {
                  setSelected(waypoint.id === selected ? undefined : waypoint.id);
                }}
              >
                {waypoint.id === selected
                  ? `Waypoint ${String(index + 1)}, selected`
                  : `Waypoint ${String(index + 1)}`}
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
                  key={label}
                  onClick={() => {
                    nudge(waypoint.id, north, east);
                  }}
                >
                  {`Move waypoint ${String(index + 1)} ${label.toLowerCase()}`}
                </Button>
              ))}
              <Button
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
        <table>
          <caption>
            Each leg runs from one waypoint to the next. A freehand leg is a straight line you drew
            yourself, so its distance is a lower bound and nothing knows its surface.
          </caption>
          <thead>
            <tr>
              <th scope="col">Leg</th>
              <th scope="col">Drawn</th>
              <th scope="col">Surface</th>
              <th scope="col">State</th>
              <th scope="col">
                <VisuallyHidden>Change how this leg is drawn</VisuallyHidden>
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
        {`${measurementText(formatDistance(draftDistance(draft), units))} over ${String(draft.legs.length)} ${draft.legs.length === 1 ? 'leg' : 'legs'}.`}
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
          <table>
            <caption>
              The gradient along the route. Each row names its band, so nothing here is carried by
              colour alone. Bands: {GRADE_BANDS.map((band) => band.name).join(', ')}.
            </caption>
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
          </table>
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
