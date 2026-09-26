// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the tablet asks of a pose model, and what its screen may say about
 * the analysis** — [#530](https://github.com/openzigs/onyourleft/issues/530),
 * [ADR 0033](../../../../docs/adr/0033-side-camera-link.md) D-3, D-6 and D-7.
 *
 * Two seams, both small:
 *
 * - {@link SidePoseEstimator} — one picture in, the rider's near-side
 *   landmarks out, or a named reason there are none. `pose-estimator.ts` is
 *   the implementation, over a Web Worker running MediaPipe Pose Landmarker
 *   lite on the CPU, which is spike 0010 §7's candidate
 *   ([`docs/spikes/0010-on-device-pose-model-cost.md`](../../../../docs/spikes/0010-on-device-pose-model-cost.md)).
 * - {@link SideAnalysisPort} — what `views/SideCameraControl.tsx` reads: counts
 *   and the framing check, **and never a picture or a number about a body**.
 *
 * ## Why a `*-port.ts`, and the names
 *
 * CLAUDE.md §4j: `check:wiring` watches every `*-port.ts`, so a method here no
 * production code calls is a red `WIRE003`. The names are distinctive
 * (`estimateSidePose`, `closeSidePoseModel`, `sideAnalysisState`,
 * `onSideAnalysisChange`) for `camera-port.ts`' measured reason.
 *
 * ## What is NOT on the screen's port, on purpose
 *
 * The pose numbers themselves. They are kept, in memory, keyed only by the
 * picture's sequence number and milliseconds (D-3), for the post-ride report
 * ([#388](https://github.com/openzigs/onyourleft/issues/388)), which is the
 * one screen ADR 0033 D-6 lets read them — `side-analysis.ts`
 * §`SideAnalysis.poseSamples`. Nothing shown DURING a ride says anything about
 * a body (D-6: *"that is not live coaching"*), and a count of pictures looked
 * at is about the camera.
 */

import type { FramingLandmark, FramingVerdict } from './framing';

/**
 * Every landmark the tablet keeps, near side only: the seven a framing
 * reference is drawn from, and the heel and the toe, because a sagittal ankle
 * angle needs a foot segment and spike 0010 §7 chose the model partly because
 * it reports one.
 */
export const SIDE_POSE_LANDMARKS = [
  'ear',
  'shoulder',
  'elbow',
  'wrist',
  'hip',
  'knee',
  'ankle',
  'heel',
  'toe',
] as const satisfies readonly (FramingLandmark | 'heel' | 'toe')[];

export type SidePoseLandmark = (typeof SIDE_POSE_LANDMARKS)[number];

/** One landmark: where it is, as shares of the picture, and how sure the model is it is there. */
export interface SidePoseMark {
  readonly name: SidePoseLandmark;
  /** 0 is the left edge of the picture and 1 the right. */
  readonly x: number;
  /** 0 is the top edge of the picture and 1 the bottom. */
  readonly y: number;
  /** The model's own visibility, 0 to 1. */
  readonly visibility: number;
}

/**
 * The rider in one picture, as the camera sees them: the near side's
 * landmarks, and the picture's shape.
 *
 * ⚠️ **Image-plane positions, and nothing derived from them.** No angle, no
 * length and no body dimension is computed here, and none is ever rendered as
 * a number (ADR 0030 D-3's first sentence, which ADR 0033 D-7 does not touch).
 */
export interface SidePose {
  /** The picture's width over its height. */
  readonly aspect: number;
  /** Which side of the rider faced the camera. */
  readonly nearSide: 'left' | 'right';
  readonly landmarks: readonly SidePoseMark[];
}

/**
 * What one picture came to.
 *
 * - `pose` — a rider, with at least `framing.ts` §`MINIMUM_SHARED_LANDMARKS`
 *   landmarks the model was sure of.
 * - `no-rider` — the picture was looked at and nobody usable was in it.
 * - `unreadable` — the picture could not be decoded, or the model failed on
 *   it. The next one is tried.
 * - `unavailable` — the model could not be loaded at all. Nothing more is
 *   tried for the rest of the pairing, and the screen says so.
 */
export type SidePoseOutcome =
  | { readonly kind: 'pose'; readonly pose: SidePose }
  | { readonly kind: 'no-rider' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'unavailable' };

/** A pose model the tablet runs. */
export interface SidePoseEstimator {
  /**
   * Look at one picture.
   *
   * ⚠️ **The bytes are the estimator's to drop**: they may be transferred to a
   * worker and are unusable afterwards, which is the point — the caller holds
   * no copy of a picture it has handed over (D-6).
   *
   * Never rejects: every failure is a {@link SidePoseOutcome}.
   */
  estimateSidePose(picture: Uint8Array): Promise<SidePoseOutcome>;
  /** Let the model go — the worker, its memory and its runtime. Idempotent. */
  closeSidePoseModel(): void;
}

/**
 * Where the framing check has got to (D-7).
 *
 * - `no-reference` — there is no earlier session to line up with, so this one
 *   will be compared only with itself.
 * - `checking` — waiting for enough pictures with a rider in them.
 * - `matches` / `differs` — the check's result, which the phone is told.
 * - `not-checked` — the session ended before enough pictures had a rider in
 *   them to check anything.
 */
export type SideFramingState = 'no-reference' | 'checking' | FramingVerdict | 'not-checked';

/** Everything the tablet's screen may show about the analysis. Counts and words, never a picture. */
export interface SideAnalysisState {
  /** Whether the model is loaded. */
  readonly model: 'waiting' | 'loading' | 'ready' | 'unavailable';
  /** Pictures that came to a pose. */
  readonly posed: number;
  /** Pictures looked at with nobody usable in them. */
  readonly noRider: number;
  /** Pictures that could not be read. */
  readonly unreadable: number;
  /** Pictures dropped unexamined because a newer one arrived while the model was busy (D-6). */
  readonly skipped: number;
  readonly framing: SideFramingState;
  /** Whether the session is over, so the numbers are held for the report and nothing more is added. */
  readonly finished: boolean;
}

/** What the tablet's screen reads. */
export interface SideAnalysisPort {
  /** The current state. The same object until something changes. */
  sideAnalysisState(): SideAnalysisState;
  /** Call `listener` whenever {@link sideAnalysisState} would answer differently. */
  onSideAnalysisChange(listener: () => void): () => void;
}
