// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react';

import { unixSeconds } from '@onyourleft/domain';
import type { RouteId, RouteRecord, Visibility } from '@onyourleft/store';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import { checkName, editRoute, routeFromGpx, type SaveRefusal } from '../routes/save';
import { PUBLIC_ROUTE_WARNING } from '../routes/share';
import { exportedFrom, ROUTE_FILE_FORMATS, type RouteFileFormat } from '../routes/export';
import type { DownloadableFile } from '../transfer/store-port';
import { ROUTE_LIST_LIMIT, type RoutePort } from '../routes/store-port';

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
 * ⚠️ **There is no map and no drawing canvas here.** #71 owns the canvas and
 * #63's map needs a published tile archive (#53) that does not exist yet, so a
 * route is a name, a distance, a climb and a visibility. When those land this
 * screen is where they go.
 */

/** One text field of a submitted form. See `SegmentsView.tsx` for why this narrows. */
function fieldOf(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

/** A route's length in kilometres, to one decimal — the unit a route is discussed in. */
function routeLength(metres: number): string {
  return `${(metres / 1000).toFixed(1)} km`;
}

/** A route's climb in whole metres. Rounding to a kilometre would erase the number. */
function routeClimb(metres: number): string {
  return `${String(Math.round(metres))} m`;
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
}

export function RoutesView({ port, now, save }: RoutesViewProps): JSX.Element {
  const [routes, setRoutes] = useState<readonly RouteRecord[] | undefined>(undefined);
  const [loadFault, setLoadFault] = useState<string | undefined>(undefined);
  const [refusal, setRefusal] = useState<SaveRefusal | undefined>(undefined);
  const [saved, setSaved] = useState<string | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<RouteRecord | undefined>(undefined);
  const [exported, setExported] = useState<string | undefined>(undefined);

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
      const form = new FormData(event.currentTarget);
      const file = form.get('file');
      // ⚠️ `instanceof File` is NOT the test for "a file was chosen", and this
      // is the HTML specification rather than a quirk: a file input with no
      // selection still appends an entry, holding a `File` with an empty name,
      // a type of `application/octet-stream` and no body. So the obvious guard
      // passes, the empty body reaches `routeFromGpx`, and a rider who pressed
      // Import without choosing anything is told their file is not valid GPX.
      // The name is the discriminator — a chosen file always has one.
      //
      // Found in #202's review of the identical guard on the workouts screen.
      if (!(file instanceof File) || file.name === '') {
        setRefusal({ code: 'unreadable-file', message: 'Choose a GPX file to import.' });
        return;
      }
      const text = await file.text();
      const outcome = routeFromGpx(text, {
        id: `route-${String(Math.round(clock() * 1000))}` as RouteId,
        owner: port.athleteId,
        fileName: file.name,
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
      setSaved(`Deleted “${route.name}”.`);
      await reload();
    },
    [port, reload],
  );

  if (port === undefined) {
    return (
      <section>
        <h2>Routes are not available in this browser</h2>
        <p>
          Routes are stored on this device, and this browser has no local store this app can use.
          Nothing has been lost — a browser with local storage available will show your routes.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h2>Import a route</h2>
      <p>
        A GPX file from a route planner. The file is read on this device and never sent anywhere.
      </p>
      <form onSubmit={(event) => void onImport(event)}>
        <p>
          <label htmlFor="route-file">GPX file</label>
          <input id="route-file" name="file" type="file" accept=".gpx,application/gpx+xml" />
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

      {exported !== undefined && (
        <StatusMessage tone="success" live>
          {exported}
        </StatusMessage>
      )}

      <h2>Saved routes</h2>
      {routes === undefined ? (
        <p>Reading your saved routes…</p>
      ) : routes.length === 0 ? (
        <p>You have no saved routes yet. Import a GPX file above to add one.</p>
      ) : (
        <table>
          <caption>Your saved routes, newest first. At most {ROUTE_LIST_LIMIT} are shown.</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Distance</th>
              <th scope="col">Climb</th>
              <th scope="col">Shape</th>
              <th scope="col">Who can see it</th>
              <th scope="col">Send to a head unit</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((route) => (
              <tr key={route.id}>
                <td>{route.name}</td>
                <td>{routeLength(route.profile.totalDistance)}</td>
                <td>{routeClimb(route.profile.totalAscent)}</td>
                <td>{route.profile.loop ? 'Loop' : 'Point to point'}</td>
                <td>{route.visibility}</td>
                <td>
                  {save === undefined ? (
                    <span>Downloading is not available in this browser.</span>
                  ) : (
                    ROUTE_FILE_FORMATS.map((format) => (
                      <Button
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
                </td>
                <td>
                  <form onSubmit={(event) => void onEdit(event, route)}>
                    <label htmlFor={`name-${route.id}`}>Name</label>
                    <input id={`name-${route.id}`} name="name" defaultValue={route.name} />
                    <label htmlFor={`visibility-${route.id}`}>Who can see it</label>
                    <select
                      id={`visibility-${route.id}`}
                      name="visibility"
                      defaultValue={route.visibility}
                    >
                      <option value="private">Only me</option>
                      <option value="followers">People who follow me</option>
                      <option value="public">Anyone</option>
                    </select>
                    <Button type="submit">Save changes</Button>
                  </form>
                  <Button type="button" onClick={() => setPendingDelete(route)}>
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Before you share a route</h2>
      <p>{PUBLIC_ROUTE_WARNING}</p>

      {pendingDelete !== undefined && (
        <section>
          <h2>Delete this route?</h2>
          <p>
            “{pendingDelete.name}” will be removed from this device, including the line itself. This
            cannot be undone.
          </p>
          <Button type="button" onClick={() => void onDelete(pendingDelete)}>
            Delete “{pendingDelete.name}”
          </Button>
          <Button type="button" onClick={() => setPendingDelete(undefined)}>
            Keep it
          </Button>
        </section>
      )}
    </section>
  );
}
