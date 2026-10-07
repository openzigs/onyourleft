// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useId, useRef, useState, type JSX } from 'react';

import type { ActivityId, ActivityOrder, ActivitySummary, SortDirection } from '@onyourleft/store';

import { Button, ButtonLink } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { Reading } from '../design/Reading';
import { EmptyState } from '../design/EmptyState';
import { KeptVisible } from '../design/KeptVisible';
import { StatusMessage } from '../design/StatusMessage';
import { VisuallyHidden } from '../design/VisuallyHidden';
import { POWER_UNIT } from '../format';
import { useUnits } from '../units/context';
import { distanceUnit } from '../units/format';
import { orderedRows, PAGE_SIZE, rowFor, type LibraryRow } from '../library/rows';
import type { LibraryPort } from '../library/store-port';
import { ListDetail, SELECTED_HEADING_ID } from '../shell/ListDetail';
import { hrefFor, hrefForActivity, hrefForSelection, routeById } from '../shell/routes';

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
 *
 * ## A list beside its detail — #670
 *
 * Since #670 the name SELECTS the ride — `#/activities/selected/<id>` — and
 * the ride's summary is drawn in a detail pane beside the list on a wide
 * window, or in place of it on a narrow one (`shell/ListDetail.tsx`). The
 * summary links to the ride's own full page, which is still
 * `#/activities/<id>`. A selected ride outside the page the list read is read
 * on its own ({@link LibraryStore.getActivity}), so a shared link to an old
 * ride is not called "not found" because it is ride fifty-one.
 *
 * *Start a ride* comes FIRST since #670, above the sort control: #668 measured
 * it 5,560 px down a populated library, below forty rides.
 *
 * ## Every ride a card, at every width — #1041
 *
 * Until #1041 the library was a table wherever its six columns fitted and a
 * list of cards below that (#660, measured by a `ResizeObserver` from the
 * width the list was given). It is cards everywhere now, laid out in a grid
 * that is one column on a phone and more where the pane is wider
 * (`theme.css` §`.oyl-activity-cards`) — so there is nothing left to measure,
 * and no frame in which one layout is drawn and then swapped for the other.
 *
 * **The read budget is unchanged: one `listActivitySummaries` per page of
 * {@link PAGE_SIZE}, and no read per card.** A card is drawn from its summary
 * alone, which is why it draws no shape — {@link RideCard} says why.
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
  /** The selected ride's id, from `#/activities/selected/<id>` — #670. */
  readonly selected?: string | undefined;
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

/** The selected ride, when it is not in the page the list read. */
type Fetched =
  | { readonly id: string; readonly kind: 'found'; readonly summary: ActivitySummary }
  | { readonly id: string; readonly kind: 'missing' }
  | { readonly id: string; readonly kind: 'failed' };

type LoadState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly rows: readonly LibraryRow[]; readonly total: number }
  | { readonly kind: 'failed'; readonly reason: string };

/**
 * What the Activities screen keeps on the screen whatever its length — #1013:
 * that the rides are here and nowhere else, and that clearing this browser's
 * site data deletes them.
 */
export const ACTIVITIES_KEPT_VISIBLE: readonly string[] = [
  'Rides are stored on this device and nowhere else.',
  'clearing this browser’s site data deletes them',
];

/** Said inside the confirmation when the store refused the delete — #959. */
export const DELETE_FAILED_TEXT =
  'The ride could not be deleted, and it is still on this device. Try again, or keep the ride.';

export function ActivitiesView({ library, selected }: ActivitiesViewProps): JSX.Element {
  const [orderBy, setOrderBy] = useState<ActivityOrder>('startedAt');
  const [direction, setDirection] = useState<SortDirection>('descending');
  const [state, setState] = useState<LoadState>({ kind: 'idle' });
  /**
   * The ride a Delete press asked about, while the confirmation is open
   * (#950: a Radix alert dialog, where it used to be a second press on the
   * same button).
   */
  const [confirming, setConfirming] = useState<LibraryRow | undefined>(undefined);
  /** Set when a delete was confirmed, so focus does not go back to a row that is gone. */
  const deletedOne = useRef(false);
  const [reloads, setReloads] = useState(0);
  const units = useUnits();
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

  const inPage =
    selected === undefined || state.kind !== 'ready'
      ? undefined
      : state.rows.find((row) => row.id === selected);
  const readAlone =
    selected !== undefined &&
    inPage === undefined &&
    (state.kind === 'ready' || state.kind === 'failed');
  const [fetched, setFetched] = useState<Fetched | undefined>(undefined);
  /*
   * ⚠️ ONCE per selected id (and once more after a delete reloads the list),
   * which `store-port.ts` §`getActivity` promises and #670's review found
   * broken: with the load state in this effect's dependencies, every sort
   * change passed through `loading` and back and read the ride — original
   * file bytes included — again. The key is what has been asked for; the
   * row is derived at render, so a change of units needs no read either.
   */
  const asked = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!readAlone || library === undefined || selected === undefined) {
      return;
    }
    // The athlete is in the key: the same id asked of a different athlete is
    // a different question, and must not keep the first one's ride.
    const key = `${String(reloads)}\u0000${library.athleteId}\u0000${selected}`;
    if (asked.current === key) {
      return;
    }
    asked.current = key;
    const settleWith = (next: Fetched): void => {
      // Only the newest question's answer is shown: a slow read for a ride
      // the rider has already moved on from is dropped.
      if (asked.current === key) {
        setFetched(next);
      }
    };
    library.store.getActivity(library.athleteId, selected as ActivityId).then(
      (summary) => {
        settleWith(
          summary === undefined
            ? { id: selected, kind: 'missing' }
            : { id: selected, kind: 'found', summary },
        );
      },
      () => {
        settleWith({ id: selected, kind: 'failed' });
      },
    );
  }, [readAlone, library, selected, reloads]);

  const remove = useCallback(
    async (id: string): Promise<void> => {
      if (library === undefined) {
        return;
      }
      await library.store.deleteActivity(library.athleteId, id as never);
      setReloads((count) => count + 1);
    },
    [library],
  );

  if (library === undefined) {
    return (
      <>
        <StatusMessage tone="danger">
          No local store on this browser. Rides are kept in this browser&rsquo;s own storage and
          this page cannot reach it — a private window or blocked site data is the usual reason.
        </StatusMessage>
        {/*
          #668: both next steps are actions, so both are drawn as buttons
          rather than links in a sentence. Starting a ride is the primary —
          it is what this screen exists to show the result of.
        */}
        <p>
          <a className="oyl-button" href={hrefFor(routeById('ride'))}>
            Start a ride
          </a>{' '}
          <a className="oyl-button oyl-button--secondary" href={hrefFor(routeById('transfer'))}>
            Import or export files
          </a>
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
  // #943: read, and nothing in it — the one state the empty state is for. A
  // read still going, or one that failed, says so in the list instead.
  const empty = state.kind === 'ready' && rows.length === 0;
  const emptyState = (
    <EmptyState
      art="rider"
      heading="Your first ride"
      level={3}
      action={<ButtonLink href={hrefFor(routeById('ride'))}>Start a ride</ButtonLink>}
    >
      <p>{nothingYet}</p>
    </EmptyState>
  );
  const deleteButton = (row: LibraryRow): JSX.Element => (
    <Button
      variant="secondary"
      onClick={() => {
        setConfirming(row);
      }}
    >
      Delete
      <VisuallyHidden> {row.name}</VisuallyHidden>
    </Button>
  );
  // In words, not a colour or an icon. #48's criterion is that anything
  // meaning-bearing has a non-visual equivalent, and an indoor ride is the
  // common case here rather than the odd one.
  const indoor = (row: LibraryRow): JSX.Element | undefined =>
    row.hasPosition ? undefined : <span className="oyl-muted"> · indoor</span>;
  const selectLink = (row: LibraryRow): JSX.Element => (
    <a
      href={hrefForSelection(routeById('activities'), row.id)}
      data-oyl-select={row.id}
      aria-current={row.id === selected ? 'true' : undefined}
    >
      {row.name}
    </a>
  );

  const list = (
    <div className="oyl-library">
      {/*
        #668: the next steps are actions, so they are drawn as buttons rather
        than links in a sentence — on an empty library they are the only
        thing to do. *Start a ride* is this pane's one primary; every row's
        *Delete* is secondary. FIRST since #670: below the list they were
        5,560 px down a populated library.
      */}
      <p className="oyl-library__actions">
        {/* #943: with nothing recorded, *Start a ride* is the empty state's one
            action below, so it is not said twice. */}
        {empty ? null : (
          <>
            <ButtonLink href={hrefFor(routeById('ride'))}>Start a ride</ButtonLink>{' '}
          </>
        )}
        <ButtonLink variant="secondary" href={hrefFor(routeById('transfer'))}>
          Import or export files
        </ButtonLink>
      </p>
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

      {empty ? (
        <>
          <p className="oyl-muted">{caption}</p>
          {emptyState}
        </>
      ) : (
        <>
          <p className="oyl-muted" id={listCaptionId}>
            {caption}
          </p>
          {rows.length === 0 ? (
            <p>{nothingYet}</p>
          ) : (
            <ul className="oyl-activity-cards" aria-labelledby={listCaptionId}>
              {rows.map((row) => (
                <RideCard
                  key={row.id}
                  row={row}
                  link={selectLink(row)}
                  indoor={indoor(row)}
                  remove={deleteButton(row)}
                />
              ))}
            </ul>
          )}
        </>
      )}

      {/*
        #950: the question is a Radix alert dialog. Its first focus is *Keep
        the ride*, so two presses of Enter lose nothing, and while it is open
        Tab cannot leave it. The sentence is the one the armed button used to
        show beside the list, less "press again", which the dialog replaces.
      */}
      <ConfirmDialog
        open={confirming !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setConfirming(undefined);
          }
        }}
        title={`Delete “${confirming?.name ?? ''}”?`}
        confirmLabel="Delete the ride"
        cancelLabel="Keep the ride"
        failureText={DELETE_FAILED_TEXT}
        onConfirm={async () => {
          if (confirming === undefined) {
            return;
          }
          // #959: the dialog stays open, its answers busy, until the delete
          // settles. Only a delete that WORKED closes it and moves focus off
          // the row; one that failed leaves the dialog open saying so, with
          // the ride still in the list behind it.
          await remove(confirming.id);
          deletedOne.current = true;
        }}
        onClosed={() => {
          // The Delete button that opened it goes with its ride, so focus
          // moves to the sort control above the list rather than to the page.
          // A cancel leaves the button there, and the dialog hands focus back to it.
          if (!deletedOne.current) {
            return false;
          }
          deletedOne.current = false;
          document.getElementById(SORT_ID)?.focus();
          return true;
        }}
      >
        <p>
          Deleting a ride cannot be undone. There is no server and no backup, so the copy on this
          device may be the only one that exists — export it first if you want to keep it.
        </p>
      </ConfirmDialog>

      {/* #1013: where the rides are, and what clearing site data does to them,
        is kept on the screen whole. */}
      <KeptVisible>
        <p className="oyl-muted">
          Rides are stored on this device and nowhere else. There is no account and no server, so
          clearing this browser&rsquo;s site data deletes them — export anything you want to keep.
        </p>
      </KeptVisible>
    </div>
  );

  const shown:
    | { readonly kind: 'found'; readonly row: LibraryRow }
    | { readonly kind: 'missing' | 'failed' }
    | undefined =
    inPage !== undefined
      ? { kind: 'found', row: inPage }
      : fetched?.id !== selected || fetched === undefined
        ? undefined
        : fetched.kind === 'found'
          ? { kind: 'found', row: rowFor(fetched.summary, units) }
          : fetched;

  return (
    <ListDetail
      route={routeById('activities')}
      selection={selected}
      listLabel="Your rides"
      detailLabel="Ride summary"
      backLabel="All rides"
      detailWithoutSelection={false}
      list={list}
      detail={
        selected === undefined ? (
          <p className="oyl-muted">Choose a ride from the list to see its summary here.</p>
        ) : shown === undefined ? (
          <p>Reading this ride…</p>
        ) : shown.kind === 'found' ? (
          <RideSummary row={shown.row} />
        ) : shown.kind === 'missing' ? (
          <>
            <h2 id={SELECTED_HEADING_ID} tabIndex={-1}>
              Ride not found
            </h2>
            <p>
              No ride with that address is stored on this device. It may have been deleted, or the
              link may have come from another device — rides are never copied between them.
            </p>
          </>
        ) : (
          <>
            <h2 id={SELECTED_HEADING_ID} tabIndex={-1}>
              This ride could not be read
            </h2>
            <StatusMessage tone="warning">
              The ride could not be read from this device&rsquo;s storage. Reload the page to try
              again.
            </StatusMessage>
          </>
        )
      }
    />
  );
}

/**
 * One ride in the list — #1041: a card at every width, its name and date, and
 * its facts as large readings.
 *
 * ⚠️ **Drawn from the ride's {@link LibraryRow} and nothing else**, which is
 * the page's one `listActivitySummaries` read: a card issues no read of its
 * own (`ActivitiesView.test.tsx` §"#1041" counts them over fifty cards).
 *
 * ⚠️ **No drawn shape, on purpose.** #1041 asks for the ride's trace, or else
 * its power or elevation profile, from the illustration kit — but only from
 * data the library already reads or a summary already stored, and otherwise
 * none. An `ActivitySummary` carries no position, no power sample and no
 * altitude (`packages/store` §`summaryOf`), and no stored summary of a ride's
 * shape exists, so every card would need a stream read of its own to draw
 * one. So no card draws a shape, and none draws a stand-in: a road or a hill
 * that is not this ride's would be a picture of nothing. Because nothing here
 * draws a track, there is no privacy-zone trim to apply either — the day a
 * stored shape lands, it is trimmed as `detail/privacy.ts` trims the detail
 * view's.
 *
 * Average power is shown only where the ride has it. A ride with no power
 * meter is not drawn as "0 W" or "—": the reading is simply absent. So is
 * distance where the ride stored none — a ride recorded with no speed channel
 * stores 0 (`recording/finish.ts` §`distanceOf`), and "0.0 km" would be an
 * invented reading (#1041's review).
 */
function RideCard({
  row,
  link,
  indoor,
  remove,
}: {
  readonly row: LibraryRow;
  readonly link: JSX.Element;
  readonly indoor: JSX.Element | undefined;
  readonly remove: JSX.Element;
}): JSX.Element {
  const units = useUnits();
  return (
    <li className="oyl-panel oyl-activity-card">
      <p className="oyl-activity-card__name oyl-library__name">
        {link}
        {indoor}
      </p>
      <p className="oyl-muted oyl-activity-card__date">{row.startedAt}</p>
      <dl className="oyl-activity-card__facts">
        <div>
          <dt>Duration</dt>
          <dd>
            <Reading value={row.duration} />
          </dd>
        </div>
        {row.distance === undefined ? null : (
          <div>
            <dt>Distance</dt>
            <dd>
              <Reading value={row.distance} unit={distanceUnit(units)} />
            </dd>
          </div>
        )}
        {row.averagePower === undefined ? null : (
          <div>
            <dt>Avg power</dt>
            <dd>
              <Reading value={row.averagePower} unit={POWER_UNIT} />
            </dd>
          </div>
        )}
      </dl>
      {remove}
    </li>
  );
}

/** The selected ride, in the detail pane — #670. Its full page is one link away. */
function RideSummary({ row }: { readonly row: LibraryRow }): JSX.Element {
  const units = useUnits();
  return (
    <>
      <h2 id={SELECTED_HEADING_ID} tabIndex={-1}>
        {row.name}
      </h2>
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
          <dd>{row.distance === undefined ? '—' : `${row.distance} ${distanceUnit(units)}`}</dd>
        </div>
        <div>
          <dt>Avg power</dt>
          <dd>{row.averagePower === undefined ? '—' : `${row.averagePower} ${POWER_UNIT}`}</dd>
        </div>
        <div>
          <dt>Where</dt>
          <dd>{row.hasPosition ? 'Outdoors, with a track' : 'Indoor, no track'}</dd>
        </div>
      </dl>
      {/* The detail pane's one primary (#670: one primary per pane). */}
      <p>
        <a className="oyl-button" href={hrefForActivity(row.id)}>
          Open ride details
        </a>
      </p>
    </>
  );
}
