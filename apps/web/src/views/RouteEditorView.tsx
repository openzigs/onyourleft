// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useId, useMemo, useRef, useState, type JSX } from 'react';

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  RouteError,
  RoutingError,
  unixSeconds,
  type GeographicPosition,
  type RoutingProvider,
} from '@onyourleft/domain';
import type { RouteId, RouteRecord } from '@onyourleft/store';

import { Button } from '../design/Button';
import { SectionHeading } from '../design/SectionHelp';
import { StatusMessage } from '../design/StatusMessage';
import { deviceStorage, type PreferenceStorage } from '../game/hud/announce-preference';
import type { BasemapConfig } from '../map/basemap';
import { MapPanel } from '../map/MapPanel';
import { useOnline } from '../map/online';
import type { MapPointerHandlers, MapPort, MapWaypoint } from '../map/port';
import { readMapTilesChoice } from '../map/tiles-preference';
import { routeGeometry } from '../map/track';
import {
  canRedo,
  canUndo,
  newHistory,
  record,
  redo,
  undo,
  type DraftHistory,
} from '../routing/history';
import { EMPTY_PLANNER_VIEW } from '../routing/map-edit';
import { RIDING_DEFAULTS } from '../routing/preferences';
import {
  canReturnToStart,
  distanceAt,
  drawStretch,
  heightAt,
  lastSample,
  lineOf,
  nearestSample,
  outAndBack,
  rampedLength,
  replaceRouteLine,
  replaceStretch,
  returnToStart,
  reverseLine,
  routeFromEdit,
  sampleAt,
  type EditedLine,
  type Stretch,
} from '../routing/route-edit';
import type { SaveRefusal } from '../routes/save';
import type { RoutePort } from '../routes/store-port';
import { hrefForSelection, routeById } from '../shell/routes';
import { useUnits } from '../units/context';
import {
  distanceIn,
  distanceUnit,
  formatDistance,
  formatSmallDistance,
  measurementText,
} from '../units/format';
import { NUDGE_DEGREES } from './RouteBuilderView';

/**
 * Editing a saved route, keeping its line — [#2007](https://github.com/openzigs/onyourleft/issues/2007).
 *
 * Reached from a saved route's page (*Edit in planner*). The route's line is
 * kept as it was saved, and each change replaces one stretch of it
 * (`routing/route-edit.ts` says how, and why the line is never turned back
 * into waypoints):
 *
 * - **Redraw a stretch** between two places on the line.
 * - **Change the start** or **the end**: a new place, and where it joins.
 * - **Out and back**, **Reverse** and **Return to start**.
 * - **Undo** and **Redo** through the whole edit.
 * - **Save** as a new route, or over the original with the "edited elsewhere"
 *   guard a rename has.
 *
 * ## The keyboard's way is distances
 *
 * A place on the line is a distance along it, typed into a labelled field in
 * the rider's units, and a new start or end is moved from where it starts with
 * the planner's four nudges (`RouteBuilderView` §`NUDGE_DEGREES`). The map is
 * the second way: a tap near the line picks a place on it, a tap anywhere picks
 * a new start or end, and a marker drags (WCAG 2.2 SC 2.1.1 and 2.5.7). It is
 * never the only way.
 *
 * ⚠️ **With no routing service a stretch is a straight line**, and the screen
 * says so first, as the planner does. Nothing on this screen needs an instance
 * (CLAUDE.md §1): the routing service is used when there is one.
 *
 * ⚠️ **No coordinate appears in anything this screen says** (ADR 0004
 * decision D): places on the line are distances along it.
 */

export interface RouteEditorViewProps {
  /** The saved routes' store, or `undefined` with none. */
  readonly routes?: RoutePort | undefined;
  /** The route being edited: the address's parameter. */
  readonly selected?: string | undefined;
  /** A routing service, or `undefined` where there is none: every stretch is then freehand. */
  readonly provider?: RoutingProvider | undefined;
  /** How to get a map engine, or `undefined` where there is none. */
  readonly map?: (() => Promise<MapPort>) | undefined;
  /** Where the basemap is, or `undefined` for a build configured with none. */
  readonly basemap?: BasemapConfig | undefined;
  /** Where the rider's map-tiles choice is kept. */
  readonly preferences?: PreferenceStorage | undefined;
  /** The instant to stamp a save with. Injected so a test can assert what was written. */
  readonly now?: (() => number) | undefined;
}

/** What the editor says when there is no route to edit. */
export const NO_ROUTE_TO_EDIT_TEXT =
  'There is no saved route to edit here. Choose one in Routes, then choose Edit in planner.';

/** What the editor says with no routing service: the planner's line, for a stretch. */
export const FREEHAND_STRETCH_TEXT =
  'Nothing can work out the roads until a routing service is configured, so a redrawn stretch ' +
  'is a straight line, and its heights are an even slope between its two ends.';

/** What the editor's map does, in one line. */
export const EDITOR_MAP_TEXT =
  'Tap near the line to choose a place on it, or tap anywhere for a new start or end. Markers drag.';

/** The three kinds of change that pick places. */
type Change = 'stretch' | 'start' | 'end';

type Loaded =
  | { readonly kind: 'loading' }
  | { readonly kind: 'found'; readonly route: RouteRecord }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed' };

type MapEngine =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly port: MapPort }
  | { readonly kind: 'failed' };

type Said = { readonly tone: 'success' | 'warning'; readonly text: string };

type Saved =
  | { readonly kind: 'saved'; readonly id: string; readonly name: string; readonly over: boolean }
  | { readonly kind: 'refused'; readonly refusal: SaveRefusal };

export function RouteEditorView({
  routes,
  selected,
  provider,
  map,
  basemap,
  preferences: tilePreferences,
  now,
}: RouteEditorViewProps): JSX.Element {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  useEffect(() => {
    if (routes === undefined || selected === undefined) return undefined;
    let live = true;
    routes.store.getRoute(routes.athleteId, selected as RouteId).then(
      (route) => {
        if (live) setLoaded(route === undefined ? { kind: 'missing' } : { kind: 'found', route });
      },
      () => {
        if (live) setLoaded({ kind: 'failed' });
      },
    );
    return () => {
      live = false;
    };
  }, [routes, selected]);

  if (routes === undefined || selected === undefined) {
    return <p>{NO_ROUTE_TO_EDIT_TEXT}</p>;
  }
  if (loaded.kind === 'loading') return <p>Reading this route…</p>;
  if (loaded.kind !== 'found') {
    return (
      <p>
        {loaded.kind === 'missing'
          ? 'No route with that address is saved on this device. It may have been deleted.'
          : 'This route is stored on this device and could not be read back. Reload the page to ' +
            'try again.'}
      </p>
    );
  }
  return (
    <Editor
      key={loaded.route.id}
      route={loaded.route}
      routes={routes}
      provider={provider}
      map={map}
      basemap={basemap}
      tilePreferences={tilePreferences}
      now={now}
    />
  );
}

interface EditorProps {
  readonly route: RouteRecord;
  readonly routes: RoutePort;
  readonly provider: RoutingProvider | undefined;
  readonly map: (() => Promise<MapPort>) | undefined;
  readonly basemap: BasemapConfig | undefined;
  readonly tilePreferences: PreferenceStorage | undefined;
  readonly now: (() => number) | undefined;
}

function Editor({
  route,
  routes,
  provider,
  map,
  basemap,
  tilePreferences,
  now,
}: EditorProps): JSX.Element {
  const units = useUnits();
  const online = useOnline();
  const [tiles] = useState(() => readMapTilesChoice(tilePreferences ?? deviceStorage()));
  /** The stored route an "over the original" save is guarded against: its `updatedAt` is the token. */
  const [original, setOriginal] = useState(route);
  /** The route as first opened: what a save counts the redrawn stretches against. */
  const [opened] = useState(route);
  const [history, setHistory] = useState<DraftHistory<EditedLine>>(() => newHistory(lineOf(route)));
  const line = history.present;
  const [change, setChange] = useState<Change>('stretch');
  const [fromText, setFromText] = useState('');
  const [toText, setToText] = useState('');
  const [joinText, setJoinText] = useState('');
  const [newPlace, setNewPlace] = useState<GeographicPosition | undefined>(undefined);
  const [tapNext, setTapNext] = useState<'first' | 'second'>('first');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said | undefined>(undefined);
  const [saved, setSaved] = useState<Saved | undefined>(undefined);
  const [engine, setEngine] = useState<MapEngine>({ kind: 'loading' });
  const nameId = useId();
  const fromId = useId();
  const toId = useId();
  const joinId = useId();
  const changeName = useId();

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

  /** A distance along the line, in the rider's units, as a field shows it. */
  const shown = useCallback(
    (index: number): string => distanceIn(distanceAt(line, index), units).toFixed(2),
    [line, units],
  );
  /** The sample a field names, or `undefined` for a field that names no distance. */
  const sampleOf = useCallback(
    (text: string): number | undefined => {
      const value = Number.parseFloat(text);
      if (!Number.isFinite(value) || value < 0) return undefined;
      return sampleAt(line, value / distanceIn(1, units));
    },
    [line, units],
  );
  const lengthText = (value: number): string =>
    measurementText(formatDistance(metres(value), units));
  const saveForm = useRef<HTMLFormElement>(null);
  /** The line on screen now, for a stretch that finishes after the line moved on. */
  const latestLine = useRef(line);
  useEffect(() => {
    latestLine.current = line;
  }, [line]);
  /** Whether a save is being written: a second press meanwhile writes nothing. */
  const saving = useRef(false);

  /** Record an edit, and say what it did. */
  const recordEdit = (next: EditedLine, text: string): void => {
    setHistory((current) => record(current, next));
    setSaid({ tone: 'success', text });
    setSaved(undefined);
  };

  /**
   * Draw a stretch, then apply it — unless the line changed while the stretch
   * was being drawn, for `RouteBuilderView` §`apply`'s reason.
   */
  const withStretch = async (
    from: GeographicPosition,
    to: GeographicPosition,
    heights: Parameters<typeof drawStretch>[2],
    then: (stretch: Stretch) => { readonly next: EditedLine; readonly text: string },
  ): Promise<void> => {
    // A press while a stretch is being drawn is refused: the button says it is busy.
    if (busy) return;
    const startedOn = line;
    setBusy(true);
    try {
      const stretch = await drawStretch(from, to, heights, provider, RIDING_DEFAULTS);
      // Reverse, Out and back, Undo and Redo stay pressable while a stretch is
      // being drawn, so the line may have moved on: say so, rather than
      // announcing a redraw that was thrown away.
      if (latestLine.current !== startedOn) {
        setSaid({
          tone: 'warning',
          text: 'The route changed while that stretch was being drawn, so it was not applied.',
        });
        return;
      }
      const { next, text } = then(stretch);
      setHistory((current) => record(current, next));
      setSaid({ tone: 'success', text });
      setSaved(undefined);
    } catch (error: unknown) {
      setSaid({ tone: 'warning', text: refusalText(error) });
    } finally {
      setBusy(false);
    }
  };

  const positions = line.profile.positions;
  const last = lastSample(line);

  const redrawStretch = (): void => {
    const first = sampleOf(fromText);
    const second = sampleOf(toText);
    if (first === undefined || second === undefined || first === second) {
      setSaid({
        tone: 'warning',
        text: 'Choose two different places on the route, as distances from its start.',
      });
      return;
    }
    const [from, to] = first < second ? [first, second] : [second, first];
    void withStretch(
      positions[from]!,
      positions[to]!,
      { from: heightAt(line, from), to: heightAt(line, to) },
      (stretch) => {
        const next = replaceStretch(line, from, to, stretch);
        const redrawn = next.profile.totalDistance - line.profile.totalDistance;
        return {
          next,
          text:
            `Redrew the stretch from ${shown(from)} to ${shown(to)} ${distanceUnit(units)}. ` +
            `The route is now ${lengthText(next.profile.totalDistance)}, ` +
            `${lengthText(Math.abs(redrawn))} ${redrawn >= 0 ? 'longer' : 'shorter'}.`,
        };
      },
    );
  };

  const moveEnd = (which: 'start' | 'end'): void => {
    const join = sampleOf(joinText);
    if (join === undefined || newPlace === undefined) {
      setSaid({
        tone: 'warning',
        text: `Choose the new ${which} and where it joins the route, as a distance from its start.`,
      });
      return;
    }
    const kept = positions[join]!;
    void withStretch(
      which === 'start' ? newPlace : kept,
      which === 'start' ? kept : newPlace,
      which === 'start' ? { to: heightAt(line, join) } : { from: heightAt(line, join) },
      (stretch) => {
        const next =
          which === 'start'
            ? replaceStretch(line, 'new-start', join, stretch)
            : replaceStretch(line, join, 'new-end', stretch);
        return {
          next,
          text:
            `Changed the ${which}: it joins the route at ${shown(join)} ${distanceUnit(units)}. ` +
            `The route is now ${lengthText(next.profile.totalDistance)}.`,
        };
      },
    );
  };

  const goBack = (): void => {
    void withStretch(
      positions[last]!,
      positions[0]!,
      { from: heightAt(line, last), to: heightAt(line, 0) },
      (stretch) => {
        const next = returnToStart(line, stretch);
        return {
          next,
          text: `It now returns to its start, and is saved as a loop of ${lengthText(next.profile.totalDistance)}.`,
        };
      },
    );
  };

  /** A new start or end, moved by one nudge. It starts where the route's own start or end is. */
  const nudge = (north: number, east: number): void => {
    const from = newPlace ?? (change === 'start' ? positions[0]! : positions[last]!);
    setNewPlace(
      geographicPosition(
        degreesLatitude(from.latitude + north * NUDGE_DEGREES),
        degreesLongitude(from.longitude + east * NUDGE_DEGREES),
      ),
    );
  };

  const choose = (next: Change): void => {
    setChange(next);
    setNewPlace(undefined);
    setTapNext('first');
  };

  // The map: the line, and a marker at each place chosen.
  const track = useMemo(() => routeGeometry(line.profile.positions), [line]);
  const markers = useMemo((): readonly MapWaypoint[] => {
    const at = (id: string, label: string, text: string): MapWaypoint[] => {
      const index = sampleOf(text);
      return index === undefined ? [] : [{ id, label, position: positions[index]! }];
    };
    if (change === 'stretch') return [...at('from', 'A', fromText), ...at('to', 'B', toText)];
    const placed: MapWaypoint[] =
      newPlace === undefined
        ? []
        : [{ id: 'new', label: change === 'start' ? 'S' : 'E', position: newPlace }];
    return [...placed, ...at('join', 'J', joinText)];
  }, [change, fromText, toText, joinText, newPlace, positions, sampleOf]);

  const pointer: MapPointerHandlers = {
    tap: (position) => {
      if (change === 'stretch') {
        const text = shown(nearestSample(line, position));
        if (tapNext === 'first') {
          setFromText(text);
          setToText('');
          setTapNext('second');
        } else {
          setToText(text);
          setTapNext('first');
        }
        return;
      }
      // "Pick a new point, then where it joins the route."
      if (tapNext === 'first') {
        setNewPlace(position);
        setTapNext('second');
      } else {
        setJoinText(shown(nearestSample(line, position)));
        setTapNext('first');
      }
    },
    moveWaypoint: (id, position) => {
      if (id === 'new') {
        setNewPlace(position);
        return;
      }
      const text = shown(nearestSample(line, position));
      if (id === 'from') setFromText(text);
      else if (id === 'to') setToText(text);
      else setJoinText(text);
    },
    // The line is the route's own: pulling it changes nothing.
    dragLine: () => undefined,
  };

  const onSave = async (over: boolean, form: HTMLFormElement | null): Promise<void> => {
    if (saving.current) return;
    saving.current = true;
    try {
      await save(over, form);
    } finally {
      saving.current = false;
    }
  };

  const save = async (over: boolean, form: HTMLFormElement | null): Promise<void> => {
    const instant = now === undefined ? Date.now() / 1000 : now();
    const stamp = unixSeconds(Math.floor(instant));
    let outcome;
    try {
      if (over) {
        const stored = await routes.store.getRoute(routes.athleteId, original.id);
        if (stored === undefined) {
          setSaved({
            kind: 'refused',
            refusal: {
              code: 'edited-elsewhere',
              message:
                'This route is no longer saved on this device. Save the edit as a new route instead.',
            },
          });
          return;
        }
        const zones = await routes.store.listPrivacyZones(routes.athleteId);
        outcome = replaceRouteLine(stored, line, original.updatedAt, stamp, zones, opened);
      } else {
        const name = form === null ? null : new FormData(form).get('name');
        outcome = routeFromEdit(opened, line, {
          id: `route-${String(Math.round(instant * 1000))}` as RouteId,
          name: typeof name === 'string' ? name : '',
          now: stamp,
        });
      }
      if (outcome.status === 'refused') {
        setSaved({ kind: 'refused', refusal: outcome.refusal });
        return;
      }
      await routes.store.putRoute(outcome.record);
    } catch {
      setSaved({
        kind: 'refused',
        refusal: {
          code: 'could-not-store',
          message: 'The route could not be saved on this device. Nothing was lost from the edit.',
        },
      });
      return;
    }
    if (over) setOriginal(outcome.record);
    setSaved({ kind: 'saved', id: outcome.record.id, name: outcome.record.name, over });
  };

  const ramped = rampedLength(line);

  return (
    <>
      <h2>{route.name}</h2>
      {provider === undefined ? (
        <StatusMessage tone="warning" label="No routing service">
          {FREEHAND_STRETCH_TEXT}
        </StatusMessage>
      ) : null}
      <p>
        {`${lengthText(line.profile.totalDistance)} · climb ${measurementText(
          formatSmallDistance(line.profile.totalAscent, units),
        )} · ${line.profile.loop ? 'loop' : 'point to point'}.`}
        {ramped > 0
          ? ` ${lengthText(ramped)} of it has no measured height: a redrawn stretch's slope.`
          : ''}
      </p>

      <SectionHeading
        level={2}
        help={
          <p>
            A place on the route is a distance from its start, in {distanceUnit(units)}. Everything
            outside the stretch you change stays exactly as it was.
          </p>
        }
      >
        Change part of the route
      </SectionHeading>
      <fieldset>
        <legend>What to change</legend>
        {(
          [
            ['stretch', 'A stretch of it'],
            ['start', 'Its start'],
            ['end', 'Its end'],
          ] as const
        ).map(([value, label]) => (
          <p key={value}>
            <label>
              <input
                type="radio"
                name={changeName}
                value={value}
                checked={change === value}
                onChange={() => {
                  choose(value);
                }}
              />{' '}
              {label}
            </label>
          </p>
        ))}
      </fieldset>

      {change === 'stretch' ? (
        <>
          <p>
            <label htmlFor={fromId}>{`Stretch starts at (${distanceUnit(units)})`}</label>{' '}
            <input
              id={fromId}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              className="oyl-input"
              value={fromText}
              onChange={(event) => {
                setFromText(event.target.value);
              }}
            />
          </p>
          <p>
            <label htmlFor={toId}>{`Stretch ends at (${distanceUnit(units)})`}</label>{' '}
            <input
              id={toId}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              className="oyl-input"
              value={toText}
              onChange={(event) => {
                setToText(event.target.value);
              }}
            />
          </p>
          <Button onClick={redrawStretch} unavailable={busy} busy={busy}>
            Redraw this stretch
          </Button>
        </>
      ) : (
        <>
          <p>
            <label htmlFor={joinId}>{`It joins the route at (${distanceUnit(units)})`}</label>{' '}
            <input
              id={joinId}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              className="oyl-input"
              value={joinText}
              onChange={(event) => {
                setJoinText(event.target.value);
              }}
            />
          </p>
          <p>
            {newPlace === undefined
              ? `The new ${change} starts where the route’s ${change} is. Move it, or tap the map.`
              : `The new ${change} has been moved.`}
          </p>
          <div>
            {(
              [
                ['north', 1, 0],
                ['south', -1, 0],
                ['east', 0, 1],
                ['west', 0, -1],
              ] as const
            ).map(([label, north, east]) => (
              <Button
                key={label}
                variant="secondary"
                onClick={() => {
                  nudge(north, east);
                }}
              >
                {`Move the new ${change} ${label}`}
              </Button>
            ))}
          </div>
          <Button
            onClick={() => {
              moveEnd(change);
            }}
            unavailable={busy}
            busy={busy}
          >
            {change === 'start' ? 'Change the start' : 'Change the end'}
          </Button>
        </>
      )}

      {/* The map after the controls, as the planner's (#666: controls first). */}
      {map === undefined ? null : engine.kind === 'failed' ? (
        <p className="oyl-muted">
          The map could not be loaded on this device. The controls below make every change.
        </p>
      ) : engine.kind === 'loading' ? (
        <p className="oyl-muted">Loading the map…</p>
      ) : (
        <>
          {basemap !== undefined && (online || !tiles) ? <p>{EDITOR_MAP_TEXT}</p> : null}
          <MapPanel
            port={engine.port}
            basemap={basemap}
            tiles={tiles}
            track={track}
            subject="edit"
            offline={!online}
            editing={{ waypoints: markers, pointer, emptyView: EMPTY_PLANNER_VIEW }}
          />
        </>
      )}

      <h2>Change the whole route</h2>
      <div className="oyl-route-editor__actions">
        <Button
          variant="secondary"
          onClick={() => {
            recordEdit(
              outAndBack(line),
              `It now goes out and back, ${lengthText(line.profile.totalDistance * 2)} in all.`,
            );
          }}
        >
          Out and back
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            recordEdit(reverseLine(line), 'It now runs the other way.');
          }}
        >
          Reverse
        </Button>
        {canReturnToStart(line) ? (
          <Button variant="secondary" onClick={goBack} unavailable={busy} busy={busy}>
            Return to start
          </Button>
        ) : null}
        {canUndo(history) ? (
          <Button
            variant="secondary"
            onClick={() => {
              setHistory(undo(history));
              setSaid({ tone: 'success', text: 'Undone.' });
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
              setSaid({ tone: 'success', text: 'Redone.' });
            }}
          >
            Redo
          </Button>
        ) : null}
      </div>
      {/* On the page from the start, so a change inside it is announced. */}
      <div role="status">{said === undefined ? null : <p>{said.text}</p>}</div>

      <h2>Save the edit</h2>
      <form
        ref={saveForm}
        aria-label="Save the edit"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(false, event.currentTarget);
        }}
      >
        <p>
          <label htmlFor={nameId}>Name of the new route</label>{' '}
          <input
            id={nameId}
            name="name"
            type="text"
            autoComplete="off"
            defaultValue={`${route.name} (edited)`}
            className="oyl-input oyl-planner__name"
          />
        </p>
        <Button type="submit" variant="secondary">
          Save as a new route
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            void onSave(true, saveForm.current);
          }}
        >
          {`Save over “${original.name}”`}
        </Button>
      </form>
      {saved?.kind === 'refused' ? (
        <StatusMessage tone="warning" live>
          {saved.refusal.message}
        </StatusMessage>
      ) : null}
      {saved?.kind === 'saved' ? (
        <StatusMessage tone="success" live>
          {saved.over
            ? `Saved the edit over “${saved.name}”.`
            : `Saved “${saved.name}” to your routes. It is private.`}{' '}
          <a href={hrefForSelection(routeById('routes'), saved.id)}>Open it in Routes</a>
        </StatusMessage>
      ) : null}
    </>
  );
}

/** What the rider is told when a change could not be made. Never a coordinate. */
function refusalText(error: unknown): string {
  if (error instanceof RoutingError) {
    return `The routing service could not draw that stretch: ${error.message} Nothing was changed.`;
  }
  if (error instanceof RouteError) {
    return `That change was not made: ${error.message}.`;
  }
  return 'That change could not be made. Nothing was changed.';
}
