// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A side-camera snapshot: one still, saved by one press, kept with its
 * ride** — [#1063](https://github.com/openzigs/onyourleft/issues/1063),
 * [ADR 0044](../../../../docs/adr/0044-side-camera-live-view-and-snapshot.md)
 * D-3, D-4 and D-5.
 *
 * ## Two seams
 *
 * - {@link SideSnapshotSource} — the live view's half: the picture on screen
 *   now, as the bytes the phone sent and the outline it was drawn with, or
 *   nothing. `side-analysis.ts` §`SideAnalysis` is the one production source.
 * - {@link SideSnapshotPort} — what *Save snapshot* hands it to:
 *   `snapshot-keeper.ts`, which holds it in this tab's memory and writes it
 *   with the ride it joins, after that ride's save, and never before.
 *
 * ⚠️ **A `*-port.ts`, so `check:wiring`'s `WIRE003` watches every method**
 * (docs/agents/wiring-gate.md §4j): a keeper that nothing called `forget` on
 * would hold a setup snapshot through an erase.
 *
 * ## What is NOT here
 *
 * No position in the ride, no reading, no lap (D-3's *"never shows where in
 * the ride it was taken, nor any reading"*), and no network: a snapshot is
 * never sent to the rider's computer, a hosted model or an instance (D-11).
 * `no-picture-reachable.test.ts` holds that no request module reaches this
 * file.
 */

/** One landmark of the outline a snapshot was shown with, as shares of the picture. */
export interface SideSnapshotLandmark {
  readonly name: string;
  readonly x: number;
  readonly y: number;
}

/** The outline a snapshot was shown with — numbers, drawn when shown and never into the bytes. */
export interface SideSnapshotOutline {
  /** The picture's width over its height. */
  readonly aspect: number;
  readonly landmarks: readonly SideSnapshotLandmark[];
}

/** The picture on the live view when *Save snapshot* was pressed. */
export interface SideSnapshotTaken {
  /**
   * The JPEG the phone sent, which the phone stripped by re-encoding it from
   * pixels (ADR 0029 D-9; ADR 0044 D-2, branch A). A copy that belongs to
   * whoever took it.
   */
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  /** The outline drawn over it, or `undefined` when the model found nobody. */
  readonly outline: SideSnapshotOutline | undefined;
}

/** Where a snapshot is taken from: the live view. */
export interface SideSnapshotSource {
  /**
   * The picture on screen now, or `undefined` when there is none — before the
   * first picture, once the link is lost, or with nobody watching.
   */
  takeSideSnapshot(): SideSnapshotTaken | undefined;
}

/** Whether an analysis can also hand over the picture on screen — `side-analysis.ts` can. */
export function snapshotSourceOf(analysis: object | undefined): SideSnapshotSource | undefined {
  return analysis !== undefined &&
    'takeSideSnapshot' in analysis &&
    typeof analysis.takeSideSnapshot === 'function'
    ? (analysis as SideSnapshotSource)
    : undefined;
}

/**
 * What became of one press.
 *
 * - `held` — in this tab's memory; `joins` says which ride it will be kept
 *   with, and `held` how many are waiting now.
 * - `refused` — nothing was kept, and why:
 *   - `none-on-screen` — there was no picture to take;
 *   - `full` — {@link MAXIMUM_HELD_SNAPSHOTS} are already waiting;
 *   - `not-clean` — the bytes are not a whole JPEG, or carry a metadata
 *     marker (ADR 0044 D-4), so they are not kept;
 *   - `recovered-ride` — the ride under way was recovered from an earlier
 *     visit, and a snapshot never joins a ride the rider was not on when it
 *     was taken (D-3 rule 5).
 */
export type SnapshotHeld =
  | { readonly kind: 'held'; readonly joins: 'this-ride' | 'next-ride'; readonly held: number }
  | {
      readonly kind: 'refused';
      readonly reason: 'none-on-screen' | 'full' | 'not-clean' | 'recovered-ride';
    };

/**
 * The most snapshots this tab holds at once, waiting for a ride's save: ten.
 *
 * ## Provenance — ⚠️ the author's choice, not a measurement (D-3 leaves it to #1063)
 *
 * A side-camera picture is about 256 px and a few tens of kilobytes (spike
 * 0010 §2's input was 26 KB; `side-link-pictures.ts` caps one at 64 KiB), so
 * ten is at most 640 KiB of memory. What it bounds is not memory but what one
 * ride can collect: the snapshot section of a ride's page, and every one of
 * them in the account export, is a photograph of the inside of somebody's
 * house, and a press held down or a stuck button must not fill either. A
 * press past it is refused in words (D-3), never dropped in silence.
 */
export const MAXIMUM_HELD_SNAPSHOTS = 10;

/** What *Save snapshot* hands a picture to — `snapshot-keeper.ts`. */
export interface SideSnapshotPort {
  /** Hold one picture for the ride it joins. One call, one picture, at most. */
  holdSideSnapshot(taken: SideSnapshotTaken | undefined): SnapshotHeld;
  /**
   * Throw away every snapshot this tab is holding — the erase (D-3 rule 4).
   * Nothing held was ever written, so nothing else has to go.
   */
  forget(): void;
  /**
   * How many snapshots this tab held for a ride that was saved and then could
   * not write (#1063's review): a full device, or a ride the store refused.
   * A count and nothing else — no picture, and nothing of the store's error
   * (ADR 0029 D-8). Back to nought on {@link forget}.
   */
  snapshotsNotKept(): number;
  /** Called whenever {@link snapshotsNotKept} changes. Returns the unsubscribe. */
  onSnapshotsNotKept(listener: () => void): () => void;
}
