// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useId, useRef, useState, type JSX } from 'react';

import { unixSeconds, type UnixSeconds } from '@onyourleft/domain';
import type { RecentlyDeletedRide } from '@onyourleft/store';

import { Button } from '../design/Button';
import { ConfirmDialog } from '../design/ConfirmDialog';
import { StatusMessage } from '../design/StatusMessage';
import { VisuallyHidden } from '../design/VisuallyHidden';
import { formatStartedAt } from '../format';
import type { LibraryPort } from './store-port';

/**
 * Recently deleted — #1431, the owner's ruling of 2026-10-19.
 *
 * A rider's *Delete* moves a ride here for thirty days, and from here it can
 * be brought back whole, deleted for good, or left to run out. Drawn at the
 * foot of the ride list and **only when it holds something** (or has just
 * been emptied, so the rider hears that it worked): a heading that says
 * "nothing here" on every visit is one a rider learns to skip, which is
 * `RideView.tsx` §`RecoveryOffer`'s reason.
 *
 * ## When a ride's thirty days run out
 *
 * Nothing runs while the app is closed and there is no server to run it, so
 * the purge happens when the app opens (`main.tsx`) and each time this list is
 * read — and the store's list leaves an expired ride out on its own, so a
 * device that was off on the day never shows it again.
 */
export interface RecentlyDeletedProps {
  readonly library: LibraryPort;
  /** Bumped by the ride list after a delete, so the new arrival is read. */
  readonly reloads: number;
  /** Called after a ride is brought back, so the ride list reads it. */
  readonly onRestored: () => void;
}

/** What Recently deleted is, said above it. */
export const RECENTLY_DELETED_TEXT =
  'A deleted ride stays here for 30 days, then it is removed for good. While it is here it is not in your activities or totals, and it is not synced, raced, matched to segments or included in an export.';

/** Said when the list could not be read. */
export const RECENTLY_DELETED_FAILED_TEXT =
  'Recently deleted could not be read from this device’s storage. Reload the page to try again.';

/** The device's clock, in whole seconds. */
function deviceNow(): UnixSeconds {
  return unixSeconds(Math.floor(Date.now() / 1000));
}

/** "Removed for good in 3 days" — whole days, rounded up, so never "in 0 days". */
export function removedInText(removedAt: UnixSeconds, now: UnixSeconds): string {
  const days = Math.max(1, Math.ceil((removedAt - now) / (24 * 60 * 60)));
  return `Removed for good in ${String(days)} day${days === 1 ? '' : 's'}`;
}

type Held =
  | { readonly kind: 'reading' }
  | { readonly kind: 'read'; readonly rides: readonly RecentlyDeletedRide[] }
  | { readonly kind: 'failed' };

export function RecentlyDeleted({
  library,
  reloads,
  onRestored,
}: RecentlyDeletedProps): JSX.Element | null {
  const now = library.now ?? deviceNow;
  const [held, setHeld] = useState<Held>({ kind: 'reading' });
  const [said, setSaid] = useState<string | undefined>(undefined);
  const [forGood, setForGood] = useState<RecentlyDeletedRide | undefined>(undefined);
  const [emptying, setEmptying] = useState(false);
  const [rereads, setRereads] = useState(0);
  const headingId = useId();
  /** Set when a confirmation went through, so focus does not go back to a row that is gone. */
  const acted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const at = (library.now ?? deviceNow)();
    // The purge first, so what is removed for good is removed before the list
    // is drawn. A purge that fails is not the rider's problem: the list still
    // leaves an expired ride out, and the next open purges it.
    library.store
      .purgeRecentlyDeleted(library.athleteId, at)
      .catch(() => 0)
      .then(async () => library.store.listRecentlyDeleted(library.athleteId, at))
      .then(
        (rides) => {
          if (!cancelled) setHeld({ kind: 'read', rides });
        },
        () => {
          if (!cancelled) setHeld({ kind: 'failed' });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [library, reloads, rereads]);

  const focusHeading = (): void => {
    document.getElementById(headingId)?.focus();
  };

  if (
    held.kind === 'reading' ||
    (held.kind === 'read' && held.rides.length === 0 && said === undefined)
  ) {
    return null;
  }

  const restore = async (ride: RecentlyDeletedRide): Promise<void> => {
    try {
      const outcome = await library.store.restoreRecentlyDeleted(library.athleteId, ride.id, now());
      setSaid(
        outcome === 'restored'
          ? `“${ride.summary.name}” is back in your activities.`
          : outcome === 'already-there'
            ? `“${ride.summary.name}” is already in your activities, so it was not brought back a second time.`
            : `“${ride.summary.name}” is no longer in Recently deleted.`,
      );
      if (outcome === 'restored') onRestored();
    } catch {
      setSaid(`“${ride.summary.name}” could not be brought back. It is still in Recently deleted.`);
    }
    setRereads((count) => count + 1);
    focusHeading();
  };

  const rides = held.kind === 'read' ? held.rides : [];
  return (
    <section className="oyl-recently-deleted" aria-labelledby={headingId}>
      <h3 id={headingId} tabIndex={-1}>
        Recently deleted
      </h3>
      <p className="oyl-muted">{RECENTLY_DELETED_TEXT}</p>
      {said === undefined ? null : (
        <StatusMessage tone="info" live>
          {said}
        </StatusMessage>
      )}
      {held.kind === 'failed' ? (
        <StatusMessage tone="warning">{RECENTLY_DELETED_FAILED_TEXT}</StatusMessage>
      ) : rides.length === 0 ? (
        <p>Recently deleted is empty.</p>
      ) : (
        <ul className="oyl-recently-deleted__list" aria-labelledby={headingId}>
          {rides.map((ride) => (
            <li key={ride.id}>
              <p>
                <strong>{ride.summary.name}</strong>
                {' · '}
                {formatStartedAt(ride.summary.startedAt, ride.summary.startedAtTimeZone)}
                <br />
                <span className="oyl-muted">{removedInText(ride.removedAt, now())}</span>
              </p>
              <p className="oyl-recently-deleted__actions">
                <Button
                  variant="secondary"
                  onClick={() => {
                    void restore(ride);
                  }}
                >
                  Restore
                  <VisuallyHidden> {ride.summary.name}</VisuallyHidden>
                </Button>{' '}
                <Button
                  variant="tertiary"
                  onClick={() => {
                    setForGood(ride);
                  }}
                >
                  Delete for good
                  <VisuallyHidden> {ride.summary.name}</VisuallyHidden>
                </Button>
              </p>
            </li>
          ))}
        </ul>
      )}
      {rides.length > 1 ? (
        <p>
          <Button
            variant="tertiary"
            onClick={() => {
              setEmptying(true);
            }}
          >
            Empty Recently deleted
          </Button>
        </p>
      ) : null}

      <ConfirmDialog
        open={forGood !== undefined}
        onOpenChange={(open) => {
          if (!open) setForGood(undefined);
        }}
        title={`Delete “${forGood?.summary.name ?? ''}” for good?`}
        confirmLabel="Delete for good"
        cancelLabel="Keep it in Recently deleted"
        failureText="The ride could not be deleted, and it is still in Recently deleted. Try again, or keep it."
        onConfirm={async () => {
          if (forGood === undefined) return;
          const name = forGood.summary.name;
          await library.store.deleteRecentlyDeletedForGood(library.athleteId, forGood.id);
          setSaid(`“${name}” was deleted for good.`);
          setRereads((count) => count + 1);
          acted.current = true;
        }}
        onClosed={() => {
          // A cancel gives focus back to the button that opened it. A delete
          // took that button with its row, so focus goes to the heading,
          // which stays.
          if (!acted.current) return false;
          acted.current = false;
          focusHeading();
          return true;
        }}
      >
        <p>
          It is removed from this device now, with its samples, laps and note, and cannot be brought
          back.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={emptying}
        onOpenChange={setEmptying}
        title="Empty Recently deleted?"
        confirmLabel="Delete them all for good"
        cancelLabel="Keep them"
        failureText="Recently deleted could not be emptied, and its rides are still there. Try again, or keep them."
        onConfirm={async () => {
          const removed = await library.store.emptyRecentlyDeleted(library.athleteId);
          setSaid(`${String(removed)} ride${removed === 1 ? ' was' : 's were'} deleted for good.`);
          setRereads((count) => count + 1);
          acted.current = true;
        }}
        onClosed={() => {
          if (!acted.current) return false;
          acted.current = false;
          focusHeading();
          return true;
        }}
      >
        <p>
          Every ride in Recently deleted is removed from this device now, with its samples, laps and
          notes, and cannot be brought back.
        </p>
      </ConfirmDialog>
    </section>
  );
}
