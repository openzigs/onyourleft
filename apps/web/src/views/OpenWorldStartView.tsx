// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Choose where an open-world ride starts** — #2889, the owner's Q5 of
 * 2026-11-19: *"Pin first, address later"*.
 *
 * Three ways, each producing the same start (`game/open-world/start.ts`):
 *
 * - **A pin on the map.** A tap drops it and a drag moves it, on the route
 *   planner's map (`map/MapPanel.tsx` §`editing`). The keyboard's way is the
 *   buttons: *Put the pin at the map's centre*, then four nudges of about
 *   55 m each (WCAG 2.2 SC 2.1.1 and 2.5.7).
 * - **A saved route's start**, its first point.
 * - **A past ride's start**, its first recorded position, read only when the
 *   ride is chosen. The list is the rider's own (`start-port.ts`).
 *
 * *Start the ride* hands the start to the open-world session's entry
 * (`game/open-world/entry.ts`) and opens the ride. Nothing here sends a
 * request: the map draws its basemap as it does on every other screen, and
 * the start is read only by the device (ADR 0090; `OpenWorldStartView.test.tsx`
 * §"no request").
 *
 * ⚠️ **No coordinate is shown or said.** A refusal names the constraint and
 * never the value (ADR 0004 D); a chosen start is said by where it came from
 * ("the pin", a route's name, a ride's name and date), never by a number.
 *
 * ⚠️ **Map tiles off** (ADR 0090 D-7.2): an open-world ride reads its map as it
 * goes, and with tiles off it may ride only what is cached. Nothing is cached
 * until #2891, so the screen says the ride needs map tiles and offers no
 * *Start the ride*.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';

import type { GeographicPosition, UnixSeconds } from '@onyourleft/domain';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import { formatStartedAt } from '../format';
import { deviceStorage, type PreferenceStorage } from '../game/hud/announce-preference';
import type {
  OpenWorldStartPort,
  RideStartChoice,
  RouteStartChoice,
} from '../game/open-world/start-port';
import {
  describeStartRefusal,
  nudgePin,
  openWorldStart,
  type OpenWorldStartOutcome,
  type PinNudge,
} from '../game/open-world/start';
import type { BasemapConfig } from '../map/basemap';
import { MapPanel } from '../map/MapPanel';
import { useOnline } from '../map/online';
import type { MapPointerHandlers, MapPort, MapView, MapWaypoint } from '../map/port';
import { readMapTilesChoice } from '../map/tiles-preference';
import { EMPTY_PLANNER_VIEW } from '../routing/map-edit';

export interface OpenWorldStartViewProps {
  /** The rider's routes and rides, and where the start is handed; `undefined` with no store. */
  readonly port?: OpenWorldStartPort | undefined;
  /** How to get a map engine, as the route planner gets it. */
  readonly map?: (() => Promise<MapPort>) | undefined;
  readonly basemap?: BasemapConfig | undefined;
  /** Where the map-tiles choice is kept — this device's unless a test hands in a double. */
  readonly preferences?: PreferenceStorage | undefined;
}

/** What the map's one line says. */
export const START_MAP_TEXT = 'Tap the map to drop the pin, or drag the pin to move it.';

/** What the screen says when map tiles are off (ADR 0090 D-7.2). */
export const START_NEEDS_TILES_TEXT =
  'An open-world ride reads the map as you ride, and map tiles are off in Settings. Turn them on ' +
  'to start one.';

/** The pin's marker, as the map draws it. */
const PIN_ID = 'open-world-pin';

/** Which start the rider chose, and what it came to. */
type Chosen =
  | { readonly source: 'none' }
  | { readonly source: 'pin'; readonly outcome: OpenWorldStartOutcome }
  | {
      readonly source: 'route';
      readonly id: string;
      readonly name: string;
      readonly outcome: OpenWorldStartOutcome;
    }
  | {
      readonly source: 'ride';
      readonly id: string;
      readonly name: string;
      readonly outcome: OpenWorldStartOutcome | 'reading';
    };

type MapEngine =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly port: MapPort }
  | { readonly kind: 'failed' };

type Listed<T> =
  | { readonly kind: 'reading' }
  | { readonly kind: 'read'; readonly items: T }
  | { readonly kind: 'failed' };

const NUDGES: readonly PinNudge[] = ['north', 'south', 'east', 'west'];

function rideLabel(ride: RideStartChoice): string {
  return `${ride.name}, ${formatStartedAt(ride.startedAt as UnixSeconds, ride.timeZone)}`;
}

/** Where the chosen start came from, in words that name no place. */
function chosenWords(chosen: Chosen): string | undefined {
  switch (chosen.source) {
    case 'none':
      return undefined;
    case 'pin':
      return 'Starting from the pin on the map.';
    case 'route':
      return `Starting where your route “${chosen.name}” starts.`;
    case 'ride':
      return `Starting where your ride “${chosen.name}” started.`;
  }
}

export function OpenWorldStartView({
  port,
  map,
  basemap,
  preferences,
}: OpenWorldStartViewProps): JSX.Element {
  const [engine, setEngine] = useState<MapEngine>({ kind: 'loading' });
  const [tiles] = useState(() => readMapTilesChoice(preferences ?? deviceStorage()));
  const online = useOnline();
  const [pin, setPin] = useState<GeographicPosition | undefined>(undefined);
  const [chosen, setChosen] = useState<Chosen>({ source: 'none' });
  const [routes, setRoutes] = useState<Listed<readonly RouteStartChoice[]>>({ kind: 'reading' });
  const [rides, setRides] = useState<Listed<readonly RideStartChoice[]>>({ kind: 'reading' });
  /** The live map, for its centre: the keyboard's way to drop the pin where the rider is looking. */
  const [mapView, setMapView] = useState<MapView | undefined>(undefined);
  /** The ride whose start is being read, so a slower earlier read cannot overwrite a later choice. */
  const reading = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (map === undefined) return undefined;
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
  }, [map]);

  useEffect(() => {
    if (port === undefined) return undefined;
    let live = true;
    port.listRouteStarts().then(
      (items) => {
        if (live) setRoutes({ kind: 'read', items });
      },
      () => {
        if (live) setRoutes({ kind: 'failed' });
      },
    );
    port.listRideStarts().then(
      (items) => {
        if (live) setRides({ kind: 'read', items });
      },
      () => {
        if (live) setRides({ kind: 'failed' });
      },
    );
    return () => {
      live = false;
    };
  }, [port]);

  const placePin = useCallback((position: GeographicPosition) => {
    reading.current = undefined;
    setPin(position);
    setChosen({ source: 'pin', outcome: openWorldStart(position, 'pin') });
  }, []);

  const pointer: MapPointerHandlers = {
    tap: placePin,
    moveWaypoint: (_id, position) => {
      placePin(position);
    },
    // There is no line to pull on this map.
    dragLine: () => undefined,
  };
  const markers = useMemo(
    (): readonly MapWaypoint[] =>
      pin === undefined ? [] : [{ id: PIN_ID, position: pin, label: 'S' }],
    [pin],
  );
  const onView = useCallback((view: MapView | undefined) => {
    setMapView(view);
  }, []);

  const chooseRide = (ride: RideStartChoice): void => {
    if (port === undefined) return;
    reading.current = ride.id;
    setChosen({ source: 'ride', id: ride.id, name: ride.name, outcome: 'reading' });
    port.rideStart(ride.id).then(
      (outcome) => {
        if (reading.current === ride.id) {
          setChosen({ source: 'ride', id: ride.id, name: ride.name, outcome });
        }
      },
      () => {
        if (reading.current === ride.id) {
          setChosen({
            source: 'ride',
            id: ride.id,
            name: ride.name,
            outcome: { kind: 'refused', refusal: 'no-position' },
          });
        }
      },
    );
  };

  const outcome = chosen.source === 'none' ? undefined : chosen.outcome;
  const start =
    outcome !== undefined && outcome !== 'reading' && outcome.kind === 'start'
      ? outcome.start
      : undefined;
  const words = chosenWords(chosen);
  const source = chosen.source === 'none' ? 'pin' : chosen.source;

  return (
    <>
      <section aria-labelledby="oyl-open-world-pin">
        <h2 id="oyl-open-world-pin">Drop a pin</h2>
        {map === undefined ? null : engine.kind === 'failed' ? (
          <p className="oyl-muted">
            The map could not be loaded on this device. Start from a saved route or a past ride.
          </p>
        ) : engine.kind === 'loading' ? (
          <p className="oyl-muted">Loading the map…</p>
        ) : (
          <>
            {basemap !== undefined && (online || !tiles) ? <p>{START_MAP_TEXT}</p> : null}
            <MapPanel
              port={engine.port}
              basemap={basemap}
              tiles={tiles}
              track={undefined}
              subject="start"
              offline={!online}
              editing={{ waypoints: markers, pointer, emptyView: EMPTY_PLANNER_VIEW, onView }}
            />
          </>
        )}
        {/*
          The keyboard's way to every gesture: drop the pin where the map is
          looking, then nudge it. A control that cannot act is absent, not
          disabled (`design/Button.tsx`).
        */}
        {mapView === undefined && pin === undefined ? null : (
          <div className="oyl-map__moves" role="group" aria-label="Place the pin">
            {mapView === undefined ? null : (
              <Button
                variant="secondary"
                onClick={() => {
                  placePin(mapView.centre());
                }}
              >
                Put the pin at the map’s centre
              </Button>
            )}
            {pin === undefined
              ? null
              : NUDGES.map((direction) => (
                  <Button
                    key={direction}
                    variant="secondary"
                    onClick={() => {
                      placePin(nudgePin(pin, direction));
                    }}
                  >
                    {`Move the pin ${direction}`}
                  </Button>
                ))}
          </div>
        )}
      </section>

      <section aria-labelledby="oyl-open-world-route">
        <h2 id="oyl-open-world-route">Start where a saved route starts</h2>
        {port === undefined ? (
          <p className="oyl-muted">Saved routes cannot be read in this browser.</p>
        ) : routes.kind === 'reading' ? (
          <p className="oyl-muted">Reading your routes…</p>
        ) : routes.kind === 'failed' ? (
          <p className="oyl-muted">Your routes could not be read on this device.</p>
        ) : routes.items.length === 0 ? (
          <p>You have no saved routes.</p>
        ) : (
          <ul className="oyl-open-world__choices">
            {routes.items.map((route) => (
              <li key={route.id}>
                <Button
                  variant="toggle"
                  pressed={chosen.source === 'route' && chosen.id === route.id}
                  onClick={() => {
                    reading.current = undefined;
                    setChosen({
                      source: 'route',
                      id: route.id,
                      name: route.name,
                      outcome: route.start,
                    });
                  }}
                >
                  {route.name}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="oyl-open-world-ride">
        <h2 id="oyl-open-world-ride">Start where a past ride started</h2>
        {port === undefined ? (
          <p className="oyl-muted">Past rides cannot be read in this browser.</p>
        ) : rides.kind === 'reading' ? (
          <p className="oyl-muted">Reading your rides…</p>
        ) : rides.kind === 'failed' ? (
          <p className="oyl-muted">Your rides could not be read on this device.</p>
        ) : rides.items.length === 0 ? (
          <p>You have no ride with a recorded position yet.</p>
        ) : (
          <ul className="oyl-open-world__choices">
            {rides.items.map((ride) => (
              <li key={ride.id}>
                <Button
                  variant="toggle"
                  pressed={chosen.source === 'ride' && chosen.id === ride.id}
                  onClick={() => {
                    chooseRide(ride);
                  }}
                >
                  {rideLabel(ride)}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="oyl-open-world-start">
        <h2 id="oyl-open-world-start">Start the ride</h2>
        <div role="status">
          {outcome === undefined ? (
            <p>Choose a start: a pin, a saved route or a past ride.</p>
          ) : outcome === 'reading' ? (
            <p>Reading where that ride started…</p>
          ) : outcome.kind === 'refused' ? (
            <StatusMessage tone="warning" label="Cannot start there">
              {describeStartRefusal(outcome.refusal, source)}
            </StatusMessage>
          ) : (
            <p>{words}</p>
          )}
        </div>
        {tiles ? null : (
          <StatusMessage tone="info" label="Map tiles are off">
            {START_NEEDS_TILES_TEXT}
          </StatusMessage>
        )}
        {start !== undefined && tiles && port !== undefined ? (
          <Button
            onClick={() => {
              port.begin(start);
            }}
          >
            Start the ride
          </Button>
        ) : null}
      </section>
    </>
  );
}
