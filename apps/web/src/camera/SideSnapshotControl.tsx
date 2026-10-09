// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Save snapshot: one press, one picture** —
 * [#1063](https://github.com/openzigs/onyourleft/issues/1063),
 * [ADR 0044](../../../../docs/adr/0044-side-camera-live-view-and-snapshot.md)
 * D-3.
 *
 * Shown beside the side camera's live view and only while it has a picture on
 * screen: a press keeps **exactly one** still — the picture on screen at that
 * moment, with the outline it was drawn with — and hands it to
 * `snapshot-keeper.ts`, which holds it in this tab's memory until the ride it
 * joins is saved. It is never a switch and never a press held down to keep a
 * run of pictures: the control acts on `click` and on nothing else, so
 * holding it does what one press does.
 *
 * Beside it, before any press, the rider is told in words where a snapshot
 * goes, and that one taken during setup is thrown away if no ride is saved
 * (D-3: *"The rider is told that beside the control, before pressing"*).
 * After a press, what became of it — held, or refused and why — in one
 * polite sentence.
 *
 * ⚠️ **Nothing here is about the body** (ADR 0030, D-9): what is kept and
 * where, never what the picture shows.
 */

import { useCallback, useState, useSyncExternalStore, type JSX } from 'react';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import type { SideLiveViewPort } from './side-live-view-port';
import {
  MAXIMUM_HELD_SNAPSHOTS,
  type SideSnapshotPort,
  type SideSnapshotSource,
  type SnapshotHeld,
} from './side-snapshot-port';

/** The control's name. */
export const SAVE_SNAPSHOT_LABEL = 'Save snapshot';

/** What the rider is told beside the control, before pressing (D-3). */
export const SNAPSHOT_WHERE_IT_GOES =
  'A snapshot keeps the picture on the screen now, with its outline, with a ride: the ride under ' +
  'way, or, before a ride, the next ride you save. It is thrown away if you save none, and shown ' +
  'only on that ride’s page.';

/** What the rider is told after a press, one sentence per outcome. */
export function snapshotHeldText(outcome: SnapshotHeld): string {
  if (outcome.kind === 'held') {
    return outcome.joins === 'this-ride'
      ? 'Snapshot held. It is kept with this ride once the ride is saved.'
      : 'Snapshot held. It joins the next ride you save, and is thrown away if you save none.';
  }
  switch (outcome.reason) {
    case 'none-on-screen':
      return 'No snapshot was kept: there is no picture on the screen.';
    case 'full':
      return `No snapshot was kept: ${String(MAXIMUM_HELD_SNAPSHOTS)} are already waiting for a ride. Save the ride first.`;
    case 'not-clean':
      return 'No snapshot was kept: that picture could not be kept safely.';
    case 'recovered-ride':
      return 'No snapshot was kept: this ride was recovered from an earlier visit, so a snapshot cannot join it.';
  }
}

/**
 * What the rider is told when snapshots held for a saved ride could not be
 * written (#1063's review). A count: no picture, no ride, and nothing of the
 * store's error (ADR 0029 D-8).
 */
export function snapshotsNotKeptText(count: number): string {
  return count === 1
    ? 'A snapshot could not be kept with its ride: it was not saved on this device.'
    : `${String(count)} snapshots could not be kept with their rides: they were not saved on this device.`;
}

/** {@link snapshotsNotKeptText}, while the count is above nought. */
export function SnapshotsNotKept({
  snapshots,
}: {
  readonly snapshots: SideSnapshotPort;
}): JSX.Element | null {
  const subscribe = useCallback(
    (listener: () => void) => snapshots.onSnapshotsNotKept(listener),
    [snapshots],
  );
  const read = useCallback(() => snapshots.snapshotsNotKept(), [snapshots]);
  const count = useSyncExternalStore(subscribe, read, read);
  return count === 0 ? null : (
    <StatusMessage tone="warning" live>
      {snapshotsNotKeptText(count)}
    </StatusMessage>
  );
}

export interface SideSnapshotControlProps {
  /** Whether a picture is on screen — the control is absent without one. */
  readonly view: SideLiveViewPort;
  /** Where the picture on screen is taken from. */
  readonly source: SideSnapshotSource;
  /** Where it is held for its ride. */
  readonly snapshots: SideSnapshotPort;
}

/** The control, or nothing while there is no picture on screen. */
export function SideSnapshotControl({
  view,
  source,
  snapshots,
}: SideSnapshotControlProps): JSX.Element | null {
  const subscribe = useCallback((listener: () => void) => view.onSideLiveView(listener), [view]);
  const read = useCallback(() => view.sideLiveView().picture !== undefined, [view]);
  const showing = useSyncExternalStore(subscribe, read, read);
  const [outcome, setOutcome] = useState<SnapshotHeld | undefined>(undefined);

  const save = useCallback(() => {
    // One press, one picture: the picture on screen NOW, taken once.
    setOutcome(snapshots.holdSideSnapshot(source.takeSideSnapshot()));
  }, [snapshots, source]);

  if (!showing && outcome === undefined) {
    return null;
  }
  return (
    <div data-oyl-side-snapshot="">
      <p>{SNAPSHOT_WHERE_IT_GOES}</p>
      {showing ? (
        <Button variant="secondary" onClick={save}>
          {SAVE_SNAPSHOT_LABEL}
        </Button>
      ) : null}
      {outcome === undefined ? null : (
        <StatusMessage tone={outcome.kind === 'held' ? 'success' : 'warning'} live>
          {snapshotHeldText(outcome)}
        </StatusMessage>
      )}
    </div>
  );
}
