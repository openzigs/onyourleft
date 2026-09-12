// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useState, type JSX } from 'react';

import type { ActivityOrder, ActivitySummary, SortDirection } from '@onyourleft/store';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import { VisuallyHidden } from '../design/VisuallyHidden';
import { POWER_UNIT } from '../format';
import { useUnits } from '../units/context';
import { distanceUnit } from '../units/format';
import { orderedRows, PAGE_SIZE, type LibraryRow } from '../library/rows';
import type { LibraryPort } from '../library/store-port';
import { hrefFor, hrefForActivity, routeById } from '../shell/routes';

/**
 * The ride history: every activity stored on this device (#62).
 *
 * The screen the v0.1 milestone needs to be demonstrable. #49 records a ride and
 * #50 shows one; without this there is no way to get from "I finished a ride" to
 * "show me Tuesday's" except a URL the rider would have had to keep.
 *
 * ## Local, and provably so
 *
 * Every row comes from the local store through {@link LibraryPort}. Nothing
 * here fetches, and `activities.test.tsx` renders the whole view with `fetch`
 * stubbed to throw to prove it — the failure that guards against is a
 * "local-first" app that shows an empty list when the network is gone, which
 * looks exactly like having no rides.
 *
 * ## One read per page, not one per row
 *
 * The store's `listActivitySummaries` takes `offset` and `limit` and returns
 * **summaries**, which is `Omit<ActivityRecord, 'originalFile'>` — no streams,
 * no file bytes. Rendering a page issues one call. That is the stated bound in
 * {@link PAGE_SIZE} and a test seeds a thousand rides to hold it.
 *
 * It is also why an imported ride and a recorded ride are indistinguishable
 * here, which #62 asks for and this gets structurally rather than by care: the
 * projection the list reads has no field that says where a ride came from.
 *
 * ## A row opens the ride
 *
 * Since #50 the ride's name is a link to `#/activities/<id>`. A plain `<a>`
 * with an `href`, not a click handler on the row: `shell/routes.ts` records
 * that the browser's own activation is what gives Enter, middle-click and
 * "open in new tab" for free, and a whole row made clickable would be a control
 * with no name, no role and no keyboard path — which is what #48's first
 * criterion rejects.
 *
 * The link is on the name rather than on the row for the same reason the Delete
 * button carries the ride's name in visually hidden text: a screen-reader user
 * moving by link hears "Tuesday morning", not "row 4".
 */
export interface ActivitiesViewProps {
  /**
   * The local store, or `undefined` where there is none.
   *
   * `undefined` is not an error state: it is what the accessibility suite
   * renders, and what a browser with no usable IndexedDB gets. The view says so
   * plainly instead of showing an empty list, which would claim the rider has
   * no rides.
   */
  readonly library?: LibraryPort | undefined;
}

type LoadState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly rows: readonly LibraryRow[]; readonly total: number }
  | { readonly kind: 'failed'; readonly reason: string };

export function ActivitiesView({ library }: ActivitiesViewProps): JSX.Element {
  const [orderBy, setOrderBy] = useState<ActivityOrder>('startedAt');
  const [direction, setDirection] = useState<SortDirection>('descending');
  const [state, setState] = useState<LoadState>({ kind: 'idle' });
  /** The row a first Delete press armed. A second press on the same row deletes. */
  const [armed, setArmed] = useState<string | undefined>(undefined);
  const [reloads, setReloads] = useState(0);
  const units = useUnits();

  const load = useCallback(async (): Promise<void> => {
    if (library === undefined) {
      return;
    }
    setState({ kind: 'loading' });
    try {
      const summaries: ActivitySummary[] = await library.store.listActivitySummaries(
        library.athleteId,
        { orderBy, direction, limit: PAGE_SIZE },
      );
      setState({
        kind: 'ready',
        rows: orderedRows(summaries, orderBy, direction, units),
        total: summaries.length,
      });
    } catch (error: unknown) {
      // A failed read is said out loud rather than rendered as an empty list.
      // "You have no rides" is the one wrong answer here: it is indistinguishable
      // from the truth and it is the answer a rider would act on.
      setState({
        kind: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }, [library, orderBy, direction, units]);

  useEffect(() => {
    void load();
  }, [load, reloads]);

  const remove = useCallback(
    async (id: string): Promise<void> => {
      if (library === undefined) {
        return;
      }
      if (armed !== id) {
        setArmed(id);
        return;
      }
      setArmed(undefined);
      await library.store.deleteActivity(library.athleteId, id as never);
      setReloads((count) => count + 1);
    },
    [library, armed],
  );

  if (library === undefined) {
    return (
      <>
        <StatusMessage tone="danger">
          No local store on this browser. Rides are kept in this browser&rsquo;s own storage and
          this page cannot reach it — a private window or blocked site data is the usual reason.
        </StatusMessage>
        <p>
          <a href={hrefFor(routeById('ride'))}>Start a ride</a>
          {' · '}
          <a href={hrefFor(routeById('transfer'))}>Import or export files</a>
        </p>
      </>
    );
  }

  return (
    <>
      <div className="oyl-library-controls">
        <Button
          onClick={() => {
            setOrderBy(orderBy === 'startedAt' ? 'distance' : 'startedAt');
          }}
        >
          Sort by {orderBy === 'startedAt' ? 'distance' : 'date'}
        </Button>
        <Button
          onClick={() => {
            setDirection(direction === 'descending' ? 'ascending' : 'descending');
          }}
        >
          {direction === 'descending' ? 'Show oldest first' : 'Show newest first'}
        </Button>
      </div>

      {state.kind === 'failed' ? (
        <StatusMessage tone="warning" live>
          Could not read the rides on this device. {state.reason}
        </StatusMessage>
      ) : undefined}

      <table className="oyl-table">
        <caption>
          Rides on this device, {orderBy === 'startedAt' ? 'by date' : 'by distance'},{' '}
          {direction === 'descending' ? 'newest first' : 'oldest first'}
        </caption>
        <thead>
          <tr>
            <th scope="col">Ride</th>
            <th scope="col">Started</th>
            <th scope="col">Duration</th>
            <th scope="col">Distance ({distanceUnit(units)})</th>
            <th scope="col">Avg power ({POWER_UNIT})</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {state.kind === 'ready' && state.rows.length > 0 ? (
            state.rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">
                  <a href={hrefForActivity(row.id)}>{row.name}</a>
                  {/*
                    In words, not a colour or an icon. #48's criterion is that
                    anything meaning-bearing has a non-visual equivalent, and an
                    indoor ride is the common case here rather than the odd one.
                  */}
                  {row.hasPosition ? undefined : <span className="oyl-muted"> · indoor</span>}
                </th>
                <td>{row.startedAt}</td>
                <td>{row.duration}</td>
                <td>{row.distance}</td>
                <td>{row.averagePower ?? '—'}</td>
                <td>
                  <Button
                    onClick={() => {
                      void remove(row.id);
                    }}
                  >
                    {armed === row.id ? 'Confirm delete' : 'Delete'}
                    <VisuallyHidden> {row.name}</VisuallyHidden>
                  </Button>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={6}>
                {state.kind === 'loading' || state.kind === 'idle'
                  ? 'Reading the rides on this device…'
                  : 'Nothing recorded yet. A ride appears here the moment you finish one.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {armed === undefined ? undefined : (
        <StatusMessage tone="warning" live>
          Deleting a ride cannot be undone. Press Confirm delete again to erase it. There is no
          server and no backup, so the copy on this device may be the only one that exists — export
          it first if you want to keep it.
        </StatusMessage>
      )}

      <p className="oyl-muted">
        Rides are stored on this device and nowhere else. There is no account and no server, so
        clearing this browser&rsquo;s site data deletes them — export anything you want to keep.
      </p>
      <p>
        <a href={hrefFor(routeById('ride'))}>Start a ride</a>
        {' · '}
        <a href={hrefFor(routeById('transfer'))}>Import or export files</a>
      </p>
    </>
  );
}
