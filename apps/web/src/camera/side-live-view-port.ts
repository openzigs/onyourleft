// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The side camera's live picture on the tablet, with the outline of where
 * the model found the rider in THAT picture** —
 * [#1061](https://github.com/openzigs/onyourleft/issues/1061),
 * [ADR 0044](../../../../docs/adr/0044-side-camera-live-view-and-snapshot.md)
 * D-1, D-6, D-7 and D-9.
 *
 * ADR 0044 D-1 superseded ADR 0033 D-6's *"No picture is ever displayed on the
 * tablet"* on this path: while the rider is setting the side camera up on the
 * Camera screen, the tablet shows the latest picture with the pose outline the
 * model drew from that picture, and drops it once the next one replaces it.
 *
 * ## Two seams
 *
 * - {@link SideLiveViewPort} — what `camera/SideLiveView.tsx` reads. One
 *   {@link SideLiveView} at a time, which holds AT MOST ONE picture (D-1:
 *   *"The live view adds at most one more held picture: the one on screen. It
 *   never holds a second"*).
 * - {@link SideLiveEstimator} — a pose model that can hand back the decoded
 *   picture it looked at, with its answer. The picture on screen is therefore
 *   the very pixels the model read, and the outline is of the frame it is drawn
 *   on by construction rather than by matching two streams up afterwards.
 *
 * ## Why the picture comes back from the worker
 *
 * `pose-worker.ts` already decodes each JPEG into an `ImageBitmap` for the
 * model. Handing that bitmap back (a transfer, not a copy) means the page
 * decodes nothing, holds no copy of the bytes while the model works, and can
 * never pair a picture with another picture's landmarks. No object URL is ever
 * made: the bitmap is drawn onto a `<canvas>` (D-1's table, *"No object URL —
 * stands for the live view"*).
 *
 * ## What is NOT here
 *
 * Any number derived from the landmarks — an angle, a length, a difference, a
 * verdict (D-1, D-9). The landmarks are here to be DRAWN, and only over the
 * picture they came from.
 */

import type { FramingReference } from './framing';
import type { SidePose, SidePoseEstimator, SidePoseOutcome } from './side-analysis-port';

/**
 * One picture on screen, and the pose the model found in it — or none, when
 * the model found nobody usable (D-11: a refused answer draws no outline).
 *
 * ⚠️ **The picture belongs to whoever holds this object**, and is closed by it
 * when the next one replaces it (`side-analysis.ts`). A reader draws it and
 * keeps nothing.
 */
export interface SideLivePicture {
  /** The picture's sequence number, from the phone. Never a clock. */
  readonly sequence: number;
  /** The decoded picture, exactly as the model looked at it. */
  readonly pixels: ImageBitmap;
  /** Where the model found the rider in {@link pixels}, or `undefined` for nobody. */
  readonly pose: SidePose | undefined;
}

/** Everything the live view draws. The same object until something changes. */
export interface SideLiveView {
  /** The latest picture, or `undefined` before the first and after the link is lost or stopped. */
  readonly picture: SideLivePicture | undefined;
  /** Last session's placement, drawn dashed as the ghost (ADR 0033 D-7), when one is stored. */
  readonly reference: FramingReference | undefined;
}

/** What the tablet's live view reads. */
export interface SideLiveViewPort {
  /** The current view. */
  sideLiveView(): SideLiveView;
  /**
   * Call `listener` whenever {@link sideLiveView} would answer differently.
   *
   * ⚠️ **Watching is what turns the pictures on.** With nobody watching, the
   * model is not asked for its picture back and no picture is held at all, so
   * a pairing whose Camera screen is closed holds nothing for display.
   *
   * @returns the unsubscribe.
   */
  onSideLiveView(listener: () => void): () => void;
}

/** A model's answer, and the decoded picture it was the answer about. */
export interface SideShownLook {
  readonly outcome: SidePoseOutcome;
  /**
   * The picture the model looked at, handed over to the caller to show and
   * then close; `undefined` when there was none to give (it could not be
   * decoded, or the model was unavailable).
   */
  readonly pixels: ImageBitmap | undefined;
}

/** A pose model that can hand back the picture it looked at — the tablet's own, `pose-estimator.ts`. */
export interface SideLiveEstimator extends SidePoseEstimator {
  /**
   * {@link SidePoseEstimator.estimateSidePose}, and the decoded picture with
   * the answer. The same rules: the bytes are the estimator's, and it never
   * rejects.
   */
  estimateSidePoseShowingPicture(picture: Uint8Array): Promise<SideShownLook>;
}

/** Whether `estimator` can hand its picture back. */
export function canShowPicture(estimator: SidePoseEstimator): estimator is SideLiveEstimator {
  return (
    'estimateSidePoseShowingPicture' in estimator &&
    typeof estimator.estimateSidePoseShowingPicture === 'function'
  );
}

/** Whether an analysis can also show its pictures — `side-analysis.ts` §`SideAnalysis` can. */
export function liveViewOf(analysis: object | undefined): SideLiveViewPort | undefined {
  return analysis !== undefined &&
    'sideLiveView' in analysis &&
    typeof analysis.sideLiveView === 'function' &&
    'onSideLiveView' in analysis &&
    typeof analysis.onSideLiveView === 'function'
    ? (analysis as SideLiveViewPort)
    : undefined;
}
