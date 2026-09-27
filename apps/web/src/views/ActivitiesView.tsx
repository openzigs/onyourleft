// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type RefObject,
} from 'react';

import type { ActivityOrder, ActivitySummary, SortDirection } from '@onyourleft/store';

import { Button } from '../design/Button';
import { ScrollTable } from '../design/ScrollTable';
import { StatusMessage } from '../design/StatusMessage';
import { VisuallyHidden } from '../design/VisuallyHidden';
import { POWER_UNIT } from '../format';
import { useUnits } from '../units/context';
import { distanceUnit } from '../units/format';
import { libraryLayout, type LibraryLayout } from '../library/layout';
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

/** The sort control's `id`, for its `<label>`. One library per page. */
const SORT_ID = 'oyl-library-sort';

/** One order the library can be read in. */
interface SortOption {
  readonly value: string;
  readonly label: string;
  readonly orderBy: ActivityOrder;
  readonly direction: SortDirection;
}

/**
 * The four orders, as the choices of one control — #660.
 *
 * They were two filled primary buttons that each toggled half of the state,
 * labelled with the order you would get rather than the one you had. A choice
 * among four named orders is what a `<select>` is, and the label of the chosen
 * option is also the caption, so what the control says and what the list says
 * cannot disagree.
 */
const SORT_OPTIONS: readonly SortOption[] = [
  {
    value: 'startedAt:descending',
    label: 'Newest first',
    orderBy: 'startedAt',
    direction: 'descending',
  },
  {
    value: 'startedAt:ascending',
    label: 'Oldest first',
    orderBy: 'startedAt',
    direction: 'ascending',
  },
  {
    value: 'distance:descending',
    label: 'Longest first',
    orderBy: 'distance',
    direction: 'descending',
  },
  {
    value: 'distance:ascending',
    label: 'Shortest first',
    orderBy: 'distance',
    direction: 'ascending',
  },
];

function sortOptionFor(orderBy: ActivityOrder, direction: SortDirection): SortOption {
  return (
    SORT_OPTIONS.find((option) => option.orderBy === orderBy && option.direction === direction) ??
    (SORT_OPTIONS[0] as SortOption)
  );
}

/**
 * Table or cards, from the width the library is given — `library/layout.ts`.
 *
 * ⚠️ **Measured once, synchronously, before the first paint, and then watched.**
 * A `ResizeObserver` alone is not enough: its first notification does arrive
 * before the first paint, but a state update from inside it is not flushed by
 * React until after that paint, so a phone drew one frame of the table and
 * then swapped it — sampled per animation frame in #683's review, three runs
 * of three. An update made in a LAYOUT effect is flushed before the browser
 * paints, so the width is read here first and the observer only follows later
 * changes. `reflow.browser.spec.ts` §"the first frame" samples every frame
 * from navigation and fails on a table before cards.
 *
 * Where there is no `ResizeObserver` — jsdom — nothing is measured and it
 * stays a table. A width of nought is read as "not laid out" rather than as a
 * phone, because jsdom reports nought for every box and a real container of
 * nought width has nothing to lay out.
 */
function useLibraryLayout(present: boolean): [RefObject<HTMLDivElement | null>, LibraryLayout] {
  const container = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<LibraryLayout>('table');
  useLayoutEffect(() => {
    const element = container.current;
    if (element === null || typeof ResizeObserver !== 'function') {
      return undefined;
    }
    const rem = (): number =>
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    const initial = contentWidth(element);
    if (initial > 0) {
      setLayout(libraryLayout(initial, rem()));
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]?.contentRect.width;
      setLayout(libraryLayout(width, rem()));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
    // Re-attached when a library arrives: with none, there is no container.
  }, [present]);
  return [container, layout];
}

/** The content-box width a `ResizeObserver` would report as `contentRect.width`. */
function contentWidth(element: HTMLElement): number {
  const style = getComputedStyle(element);
  const edges = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'] as const;
  return edges.reduce(
    (width, edge) => width - (Number.parseFloat(style[edge]) || 0),
    element.getBoundingClientRect().width,
  );
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
  const [container, layout] = useLibraryLayout(library !== undefined);
  const listCaptionId = useId();

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

  const sort = sortOptionFor(orderBy, direction);
  const caption = `Rides on this device, ${sort.label.toLowerCase()}`;
  const rows = state.kind === 'ready' ? state.rows : [];
  const nothingYet =
    state.kind === 'loading' || state.kind === 'idle'
      ? 'Reading the rides on this device…'
      : 'Nothing recorded yet. A ride appears here the moment you finish one.';
  const deleteButton = (row: LibraryRow): JSX.Element => (
    <Button
      onClick={() => {
        void remove(row.id);
      }}
    >
      {armed === row.id ? 'Confirm delete' : 'Delete'}
      <VisuallyHidden> {row.name}</VisuallyHidden>
    </Button>
  );
  // In words, not a colour or an icon. #48's criterion is that anything
  // meaning-bearing has a non-visual equivalent, and an indoor ride is the
  // common case here rather than the odd one.
  const indoor = (row: LibraryRow): JSX.Element | undefined =>
    row.hasPosition ? undefined : <span className="oyl-muted"> · indoor</span>;

  return (
    <div className="oyl-library" data-layout={layout} ref={container}>
      <div className="oyl-library-controls">
        {/*
          A native select rather than two filled buttons (#660, #654's
          button-hierarchy finding): the sort is a CHOICE between four
          orders, and a primary button says "the thing this page is for".
          It inherits `theme.css` §`select`'s 44 px target.
        */}
        <label htmlFor={SORT_ID}>Sort</label>
        <select
          id={SORT_ID}
          value={sort.value}
          onChange={(event) => {
            const chosen = SORT_OPTIONS.find((option) => option.value === event.target.value);
            if (chosen !== undefined) {
              setOrderBy(chosen.orderBy);
              setDirection(chosen.direction);
            }
          }}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {state.kind === 'failed' ? (
        <StatusMessage tone="warning" live>
          Could not read the rides on this device. {state.reason}
        </StatusMessage>
      ) : undefined}

      {layout === 'cards' ? (
        <>
          <p className="oyl-muted" id={listCaptionId}>
            {caption}
          </p>
          {rows.length === 0 ? (
            <p>{nothingYet}</p>
          ) : (
            <ul className="oyl-activity-cards" aria-labelledby={listCaptionId}>
              {rows.map((row) => (
                <li key={row.id} className="oyl-panel oyl-activity-card">
                  <p className="oyl-activity-card__name oyl-library__name">
                    <a href={hrefForActivity(row.id)}>{row.name}</a>
                    {indoor(row)}
                  </p>
                  <dl className="oyl-activity-card__facts">
                    <div>
                      <dt>Started</dt>
                      <dd>{row.startedAt}</dd>
                    </div>
                    <div>
                      <dt>Duration</dt>
                      <dd>{row.duration}</dd>
                    </div>
                    <div>
                      <dt>Distance</dt>
                      <dd>
                        {row.distance} {distanceUnit(units)}
                      </dd>
                    </div>
                    <div>
                      <dt>Avg power</dt>
                      <dd>
                        {row.averagePower === undefined ? '—' : `${row.averagePower} ${POWER_UNIT}`}
                      </dd>
                    </div>
                  </dl>
                  {deleteButton(row)}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <ScrollTable className="oyl-table" caption={caption}>
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
            {rows.length > 0 ? (
              rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row" className="oyl-library__name">
                    <a href={hrefForActivity(row.id)}>{row.name}</a>
                    {indoor(row)}
                  </th>
                  <td>{row.startedAt}</td>
                  <td>{row.duration}</td>
                  <td>{row.distance}</td>
                  <td>{row.averagePower ?? '—'}</td>
                  <td>{deleteButton(row)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6}>{nothingYet}</td>
              </tr>
            )}
          </tbody>
        </ScrollTable>
      )}

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
    </div>
  );
}
