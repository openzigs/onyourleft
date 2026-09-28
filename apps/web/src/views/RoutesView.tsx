// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useId, useState, type FormEvent, type JSX } from 'react';

import { LOOP_CLOSURE_METRES, unixSeconds, type Metres } from '@onyourleft/domain';
import type { RouteId, RouteRecord, UnitSystem, Visibility } from '@onyourleft/store';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import { checkName, editRoute, LOOP_CHECKBOX_LABEL, type SaveRefusal } from '../routes/save';
import { FILE_FIELD, LOOP_FIELD, routeFromImportForm } from '../routes/import-form';
import { PUBLIC_ROUTE_WARNING } from '../routes/share';
import { exportedFrom, ROUTE_FILE_FORMATS, type RouteFileFormat } from '../routes/export';
import type { DownloadableFile } from '../transfer/store-port';
import { ROUTE_LIST_LIMIT, type RoutePort } from '../routes/store-port';
import { ROUTES_IMPORT_MEANS } from '../routes/two-importers';
import { ListDetail, SELECTED_HEADING_ID } from '../shell/ListDetail';
import { hrefFor, hrefForSelection, routeById, ROUTE_BUILDER_ROUTE } from '../shell/routes';
import { useUnits } from '../units/context';
import { formatDistance, formatSmallDistance, measurementText } from '../units/format';

/**
 * Routes (#73) — the ones this device holds, and importing one from a file.
 *
 * ## What this screen is careful about
 *
 * **It never widens a route's visibility on the rider's behalf.** Every route
 * arrives `private` and stays there until a rider chooses otherwise in the form
 * below, and the choice goes through `routes/save.ts`, which refuses it
 * outright for a route a privacy zone would truncate. The refusal is not a
 * label here — nothing is written — for `SegmentsView.tsx`'s reason: a screen
 * that showed one thing and stored another would be lying in whichever
 * direction was convenient.
 *
 * **The public warning is a constant, not a sentence typed here.**
 * `PUBLIC_ROUTE_WARNING` is asserted word for word in `share.test.ts`, and
 * #73's fifth criterion is about the words rather than about the presence of a
 * warning: *"A generic 'this will be public' notice does not convey the actual
 * risk."*
 *
 * **Deleting asks first**, and the confirmation names the route. #73's third
 * criterion asks for a confirmation and for the geometry to be gone
 * afterwards; the second half is `packages/store`'s and is asserted there.
 *
 * **Colour carries nothing.** A route's visibility is a word in its own cell,
 * for `AnalysisView.tsx`'s reason.
 *
 * **A list beside its detail — #670.** The saved routes are the list, headed
 * by the way into drawing one; choosing a route (`#/routes/selected/<id>`)
 * puts it — its downloads, its edit form and its delete — at the head of the
 * detail pane, above the import that the pane always holds. *Import route* is the one primary and comes first in that
 * pane: #668 measured it just below the fold on a landscape tablet. A route
 * not in the list the screen read is read on its own with `getRoute`, so a
 * shared link to it is not called "not found" because the list is bounded.
 *
 * ⚠️ **There is no map here, and the drawing canvas is its own screen.** #71's
 * canvas is `RouteBuilderView` at `/routes/new`, linked from the top of this
 * one — it is a screenful of controls in its own right and folding it in would
 * make this page two things. #63's map still needs a published tile archive
 * (#53) that does not exist yet, so a saved route here is a name, a distance, a
 * climb and a visibility. ⚠️ A reviewer who remembers this paragraph saying
 * "no drawing canvas" is reading the old file.
 */

/** One text field of a submitted form. See `SegmentsView.tsx` for why this narrows. */
function fieldOf(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

/**
 * A route's length, at the scale a route is discussed in — kilometres, or
 * miles for a rider who reads in them (#238).
 */
function routeLength(distance: number, units: UnitSystem): string {
  return measurementText(formatDistance(distance as Metres, units));
}

/**
 * A route's climb, at the small scale. Rounding it to a kilometre — or to a
 * mile — would erase the number.
 */
function routeClimb(climb: number, units: UnitSystem): string {
  return measurementText(formatSmallDistance(climb, units));
}

export interface RoutesViewProps {
  /**
   * `undefined` where this browser has no local store — the same shape every
   * other screen's port has, and for the same reason: the accessibility suite
   * renders every route on a machine with no IndexedDB worth the name.
   */
  readonly port?: RoutePort | undefined;
  /**
   * The instant to stamp a save with.
   *
   * Injected rather than read here so the suite can assert what was written.
   * `main.tsx` passes the real clock; nothing else does.
   */
  readonly now?: () => number;
  /**
   * How a file reaches the rider's disk (#74).
   *
   * ⚠️ Injected for the same reason the transfer screen injects it, and it is
   * not squeamishness: `saveWithAnchor` creates an object URL and clicks an
   * anchor, which jsdom neither performs nor can be asked to. A screen that
   * called it directly would be a screen the accessibility suite could not
   * render. `main.tsx` passes the real one.
   *
   * Absent means export is unavailable and the buttons are not rendered — the
   * same shape as an absent `port`, and better than a button that does nothing.
   */
  readonly save?: ((file: DownloadableFile) => void) | undefined;
  /** The selected route's id, from `#/routes/selected/<id>` — #670. */
  readonly selected?: string | undefined;
}

/** A selected route that was not in the list, read on its own. */
type Fetched =
  | { readonly id: string; readonly kind: 'found'; readonly route: RouteRecord }
  | { readonly id: string; readonly kind: 'missing' }
  | { readonly id: string; readonly kind: 'failed' };

export function RoutesView({ port, now, save, selected }: RoutesViewProps): JSX.Element {
  const [routes, setRoutes] = useState<readonly RouteRecord[] | undefined>(undefined);
  const [loadFault, setLoadFault] = useState<string | undefined>(undefined);
  const [refusal, setRefusal] = useState<SaveRefusal | undefined>(undefined);
  const [saved, setSaved] = useState<string | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<RouteRecord | undefined>(undefined);
  const [exported, setExported] = useState<string | undefined>(undefined);
  const [fetched, setFetched] = useState<Fetched | undefined>(undefined);
  const listCaptionId = useId();
  const units = useUnits();

  const clock = useCallback((): number => (now === undefined ? Date.now() / 1000 : now()), [now]);

  const reload = useCallback(async (): Promise<void> => {
    if (port === undefined) {
      setRoutes([]);
      return;
    }
    try {
      const list = await port.store.listRoutes(port.athleteId, ROUTE_LIST_LIMIT);
      setRoutes(list);
      setLoadFault(undefined);
    } catch {
      // #73 criterion 7: the list works offline. A store that throws is the
      // shape that failure takes on this device — there is no network to be
      // offline from — and the screen says so rather than rendering nothing.
      setRoutes([]);
      setLoadFault(
        'Your saved routes could not be read on this device. Everything here is stored locally, ' +
          'so this is not a connection problem — reload the page to try again.',
      );
    }
  }, [port]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const inList =
    selected === undefined ? undefined : routes?.find((route) => route.id === selected);
  const readAlone = selected !== undefined && routes !== undefined && inList === undefined;
  useEffect(() => {
    if (!readAlone || port === undefined || selected === undefined) {
      return undefined;
    }
    let live = true;
    port.store.getRoute(port.athleteId, selected as RouteId).then(
      (route) => {
        if (live) {
          setFetched(
            route === undefined
              ? { id: selected, kind: 'missing' }
              : { id: selected, kind: 'found', route },
          );
        }
      },
      () => {
        if (live) setFetched({ id: selected, kind: 'failed' });
      },
    );
    return () => {
      live = false;
    };
    // `routes` is here so a reload — after a delete — reads the route again.
  }, [readAlone, port, selected, routes]);

  /**
   * Write one route to a file.
   *
   * ⚠️ **Synchronous, and it re-encodes from the row already in hand rather
   * than reading the store again.** The list read already decoded the whole
   * profile — that is what `ROUTE_LIST_LIMIT` budgets for — so a second read
   * would decode the same megabytes to produce the same bytes. `exportRoute`
   * exists for a caller that holds only an id; this screen never does.
   *
   * The `lost` sentences are shown whether or not there are any surprises in
   * them, because there always is at least one: gradient is in no format.
   */
  const onExport = useCallback(
    (route: RouteRecord, format: RouteFileFormat): void => {
      if (save === undefined) return;
      const { file, lost } = exportedFrom(route, format);
      save(file);
      setExported([`${file.fileName} is ready. Copy it to your head unit.`, ...lost].join(' '));
    },
    [save],
  );

  const onImport = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      if (port === undefined) return;
      // ⚠️ **Every decision this handler makes is in `import-form.ts`**, which
      // takes the `FormData` and hands back what to save or what to say. Not
      // for tidiness: jsdom cannot put a file into a file input, so a test that
      // submitted this form could never reach a decoded route — and #296 was
      // precisely a wiring defect of that shape, where the loop flag worked
      // everywhere except on the one path a rider uses. What is left here is
      // the one expression no test can witness.
      const outcome = await routeFromImportForm(new FormData(event.currentTarget), {
        id: `route-${String(Math.round(clock() * 1000))}` as RouteId,
        owner: port.athleteId,
        now: unixSeconds(Math.floor(clock())),
      });
      if (outcome.status === 'refused') {
        setRefusal(outcome.refusal);
        setSaved(undefined);
        return;
      }
      await port.store.putRoute(outcome.record);
      setRefusal(undefined);
      setSaved(`Saved “${outcome.record.name}”. It is private.`);
      await reload();
    },
    [clock, port, reload],
  );

  const onEdit = useCallback(
    async (event: FormEvent<HTMLFormElement>, route: RouteRecord): Promise<void> => {
      event.preventDefault();
      if (port === undefined) return;
      const form = new FormData(event.currentTarget);
      const name = fieldOf(form, 'name');
      const visibility = fieldOf(form, 'visibility') as Visibility;
      const nameFault = checkName(name);
      if (nameFault !== undefined) {
        setRefusal(nameFault);
        return;
      }
      // ⚠️ A FRESH read, not the row this list is holding. Comparing the
      // editor's own copy with itself would make the guard fire never.
      const stored = await port.store.getRoute(port.athleteId, route.id);
      if (stored === undefined) {
        setRefusal({
          code: 'edited-elsewhere',
          message: 'This route has been deleted somewhere else. Nothing has been saved.',
        });
        await reload();
        return;
      }
      const zones = await port.store.listPrivacyZones(port.athleteId);
      const outcome = editRoute(
        stored,
        { name, visibility, readAt: route.updatedAt },
        unixSeconds(Math.floor(clock())),
        zones,
      );
      if (outcome.status === 'refused') {
        setRefusal(outcome.refusal);
        setSaved(undefined);
        return;
      }
      await port.store.putRoute(outcome.record);
      setRefusal(undefined);
      setSaved(`Saved “${outcome.record.name}”.`);
      await reload();
    },
    [clock, port, reload],
  );

  const onDelete = useCallback(
    async (route: RouteRecord): Promise<void> => {
      if (port === undefined) return;
      await port.store.deleteRoute(port.athleteId, route.id);
      setPendingDelete(undefined);
      setExported(undefined);
      setSaved(`Deleted “${route.name}”.`);
      await reload();
      // The selection named what was just deleted; the list is where to be.
      if (selected === route.id) {
        globalThis.location.hash = hrefFor(routeById('routes'));
      }
    },
    [port, reload, selected],
  );

  if (port === undefined) {
    return (
      <div>
        <h2>Routes are not available in this browser</h2>
        <p>
          Routes are stored on this device, and this browser has no local store this app can use.
          Nothing has been lost — a browser with local storage available will show your routes.
        </p>
      </div>
    );
  }

  const shown: Fetched | { readonly kind: 'found'; readonly route: RouteRecord } | undefined =
    inList !== undefined
      ? { kind: 'found', route: inList }
      : fetched?.id === selected
        ? fetched
        : undefined;

  /*
   * #668: the next step is an action, so it is drawn as a button rather than
   * left as a link in a sentence — secondary, because the detail pane's
   * *Import route* is the primary. At the head of the LIST since #670: on one
   * pane the list comes first, and this is where a phone's first control is.
   */
  const drawOne = (
    <p>
      <a className="oyl-button oyl-button--secondary" href={hrefFor(ROUTE_BUILDER_ROUTE)}>
        Draw a route on this device
      </a>{' '}
      — place waypoints and have the roads between them worked out. A half-drawn route survives
      closing the tab.
    </p>
  );

  const listed =
    routes === undefined ? (
      <p>Reading your saved routes…</p>
    ) : routes.length === 0 ? (
      <>
        {loadFault !== undefined && <StatusMessage tone="warning">{loadFault}</StatusMessage>}
        <p>You have no saved routes yet. Import a GPX file to add one.</p>
      </>
    ) : (
      <>
        {loadFault !== undefined && <StatusMessage tone="warning">{loadFault}</StatusMessage>}
        <p className="oyl-muted" id={listCaptionId}>
          Your saved routes, newest first. At most {ROUTE_LIST_LIMIT} are shown.
        </p>
        <ul className="oyl-pane-list" aria-labelledby={listCaptionId}>
          {routes.map((route) => (
            <li key={route.id} className="oyl-pane-list__item">
              <a
                href={hrefForSelection(routeById('routes'), route.id)}
                data-oyl-select={route.id}
                aria-current={route.id === selected ? 'true' : undefined}
              >
                {route.name}
              </a>
              <p className="oyl-muted">
                {routeLength(route.profile.totalDistance, units)} · climb{' '}
                {routeClimb(route.profile.totalAscent, units)} ·{' '}
                {route.profile.loop ? 'loop' : 'point to point'} · {route.visibility}
              </p>
            </li>
          ))}
        </ul>
      </>
    );

  const list = (
    <>
      {drawOne}
      {listed}
    </>
  );

  const chosen =
    selected === undefined ? null : shown === undefined ? (
      <p>Reading this route…</p>
    ) : shown.kind === 'found' ? (
      <SelectedRoute
        route={shown.route}
        units={units}
        save={save}
        onExport={onExport}
        onEdit={onEdit}
        exported={exported}
        pendingDelete={pendingDelete}
        setPendingDelete={setPendingDelete}
        onDelete={onDelete}
      />
    ) : (
      <div className="oyl-selected">
        <h2 id={SELECTED_HEADING_ID} tabIndex={-1}>
          {shown.kind === 'missing' ? 'Route not found' : 'This route could not be read'}
        </h2>
        <p>
          {shown.kind === 'missing'
            ? 'No route with that address is saved on this device. It may have been deleted, or ' +
              'the link may have come from another device — routes are never copied between them.'
            : 'It is stored on this device and could not be read back. Reload the page to try ' +
              'again.'}
        </p>
      </div>
    );

  return (
    <ListDetail
      route={routeById('routes')}
      selection={selected}
      listLabel="Saved routes"
      detailLabel="Route"
      backLabel="All routes"
      detailWithoutSelection
      list={list}
      detail={
        <>
          {chosen}
          <h2>Import a route</h2>
          <p>
            A GPX file from a route planner. The file is read on this device and never sent
            anywhere.
          </p>
          {/*
        #232's third criterion. The wording is a constant in
        `routes/two-importers.ts`, shared with the Files screen and the Trainer
        game's empty picker, so one distinction is not explained three ways.
      */}
          <p>
            {ROUTES_IMPORT_MEANS} <a href={hrefFor(routeById('transfer'))}>Files</a> is where those
            go.
          </p>
          {/* Named: #670's audit of a populated screen found two unnamed forms. */}
          <form aria-label="Import a route" onSubmit={(event) => void onImport(event)}>
            <p>
              <label htmlFor="route-file">GPX file</label>
              <input id="route-file" name={FILE_FIELD} type="file" />
            </p>
            {/*
          #296. Until this box existed, nothing in this product could produce a
          route with `loop: true` — so the game's lap counting, its wrapped road
          markers and the plan view's "on lap 2" were all correct, all tested
          and all unreachable.

          ⚠️ **Declared, not inferred.** The geometry is right there and 25 m is
          already the threshold, and `import-form.ts` records why reading it
          silently would be worse: an out-and-back that happens to finish in the
          same car park would start wrapping, a lap of a lake ending 30 m along
          the towpath would not, and neither screen would say which happened.
        */}
            <p>
              <label htmlFor="route-loop">{LOOP_CHECKBOX_LABEL}</label>
              <input id="route-loop" name={LOOP_FIELD} type="checkbox" />
            </p>
            {/*
          ⚠️ The threshold is shown in the rider's own units (#238) while the
          refusal quotes the importer's metres, because the refusal's numbers
          come from `packages/domain`, which has no unit preference and must not
          acquire one — a profile is arithmetic and a rider's choice of units is
          a client's. Both name the same distance.
        */}
            <p>
              Tick it for a circuit that finishes where it starts, so riding past the finish begins
              another lap. The file has to close: if its two ends are more than{' '}
              {measurementText(formatSmallDistance(LOOP_CLOSURE_METRES, units))} apart, nothing is
              saved and the import says how far apart they are.
            </p>
            <Button type="submit">Import route</Button>
          </form>

          {refusal !== undefined && (
            <StatusMessage tone="warning" live>
              {refusal.message}
            </StatusMessage>
          )}
          {saved !== undefined && (
            <StatusMessage tone="success" live>
              {saved}
            </StatusMessage>
          )}
          {loadFault !== undefined && <StatusMessage tone="warning">{loadFault}</StatusMessage>}

          {refusal !== undefined && (
            <StatusMessage tone="warning" live>
              {refusal.message}
            </StatusMessage>
          )}
          {saved !== undefined && (
            <StatusMessage tone="success" live>
              {saved}
            </StatusMessage>
          )}
          <h2>Before you share a route</h2>
          <p>{PUBLIC_ROUTE_WARNING}</p>
        </>
      }
    />
  );
}

interface SelectedRouteProps {
  readonly route: RouteRecord;
  readonly units: UnitSystem;
  readonly save: ((file: DownloadableFile) => void) | undefined;
  readonly onExport: (route: RouteRecord, format: RouteFileFormat) => void;
  readonly onEdit: (event: FormEvent<HTMLFormElement>, route: RouteRecord) => Promise<void>;
  readonly exported: string | undefined;
  readonly pendingDelete: RouteRecord | undefined;
  readonly setPendingDelete: (route: RouteRecord | undefined) => void;
  readonly onDelete: (route: RouteRecord) => Promise<void>;
}

/** The chosen route, at the head of the detail pane — #670. */
function SelectedRoute({
  route,
  units,
  save,
  onExport,
  onEdit,
  exported,
  pendingDelete,
  setPendingDelete,
  onDelete,
}: SelectedRouteProps): JSX.Element {
  return (
    <div className="oyl-selected">
      <h2 id={SELECTED_HEADING_ID} tabIndex={-1}>
        {route.name}
      </h2>
      <dl className="oyl-activity-card__facts">
        <div>
          <dt>Distance</dt>
          <dd>{routeLength(route.profile.totalDistance, units)}</dd>
        </div>
        <div>
          <dt>Climb</dt>
          <dd>{routeClimb(route.profile.totalAscent, units)}</dd>
        </div>
        <div>
          <dt>Shape</dt>
          <dd>{route.profile.loop ? 'Loop' : 'Point to point'}</dd>
        </div>
        <div>
          <dt>Who can see it</dt>
          <dd>{route.visibility}</dd>
        </div>
      </dl>
      <h3>Send to a head unit</h3>
      <p>
        {save === undefined ? (
          <span>Downloading is not available in this browser.</span>
        ) : (
          ROUTE_FILE_FORMATS.map((format) => (
            <Button
              variant="secondary"
              key={format}
              type="button"
              onClick={() => {
                onExport(route, format);
              }}
            >
              {/* The format is in the label, not only in an icon or a
                  title: #48's audit counts an unnamed control as a
                  violation, and "which file am I getting" is the
                  whole question this control answers. */}
              Download {format.toUpperCase()} — {route.name}
            </Button>
          ))
        )}
      </p>
      {exported !== undefined && (
        <StatusMessage tone="success" live>
          {exported}
        </StatusMessage>
      )}
      <h3>Change</h3>
      <form aria-label={`Change ${route.name}`} onSubmit={(event) => void onEdit(event, route)}>
        <p>
          <label htmlFor={`name-${route.id}`}>Name</label>
          <input id={`name-${route.id}`} name="name" defaultValue={route.name} />
        </p>
        <p>
          <label htmlFor={`visibility-${route.id}`}>Who can see it</label>
          <select id={`visibility-${route.id}`} name="visibility" defaultValue={route.visibility}>
            <option value="private">Only me</option>
            <option value="followers">People who follow me</option>
            <option value="public">Anyone</option>
          </select>
        </p>
        <Button variant="secondary" type="submit">
          Save changes
        </Button>
      </form>
      <p>
        <Button variant="secondary" type="button" onClick={() => setPendingDelete(route)}>
          Delete
        </Button>
      </p>
      {pendingDelete !== undefined && (
        <div>
          <h3>Delete this route?</h3>
          <p>
            “{pendingDelete.name}” will be removed from this device, including the line itself. This
            cannot be undone.
          </p>
          <Button variant="secondary" type="button" onClick={() => void onDelete(pendingDelete)}>
            Delete “{pendingDelete.name}”
          </Button>
          <Button variant="secondary" type="button" onClick={() => setPendingDelete(undefined)}>
            Keep it
          </Button>
        </div>
      )}
    </div>
  );
}
