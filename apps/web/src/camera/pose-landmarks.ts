// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the pose model's 33 points become on the tablet: the near side's
 * nine, the ones the model was sure of, and nothing else** — #530.
 *
 * Pure. The worker (`pose-worker.ts`) hands back the model's output as flat
 * numbers; this decides what of it is kept.
 *
 * ## The model's numbering
 *
 * MediaPipe Pose Landmarker reports BlazePose's 33 keypoints in a fixed order.
 * The Pose Landmarker guide numbers them 0–32 ("7 - left ear, 8 - right ear
 * … 31 - left foot index, 32 - right foot index",
 * developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker, read
 * 2026-09-25). {@link MODEL_INDEX} is the part of that numbering this program
 * uses: odd indices are the rider's left and even their right, from 7 (ear)
 * down, and "foot index" is what this program calls the toe.
 *
 * ## Near side only (ADR 0030 D-4, ADR 0033 D-7)
 *
 * Side-on, one side of the body faces the camera and the other is behind the
 * bicycle. The far side's points are the model's guesses at a hidden limb, so
 * they are not kept at all: the side whose points the model reports as more
 * visible, summed, is the near side, and only its points are kept.
 *
 * ## What "sure" means
 *
 * A point is kept only when its visibility is at least
 * {@link MINIMUM_LANDMARK_VISIBILITY} and it lies inside the picture. A pose
 * with fewer kept points than `framing.ts` §`MINIMUM_SHARED_LANDMARKS` is
 * `no-rider`: too little to place anybody, and the safe direction.
 */

import { MINIMUM_SHARED_LANDMARKS } from './framing';
import type { SidePoseLandmark, SidePoseMark, SidePoseOutcome } from './side-analysis-port';

/** How many points the model reports per pose. */
export const MODEL_LANDMARK_COUNT = 33;

/** Numbers per point in what the worker hands back: `x`, `y`, visibility. */
export const MODEL_VALUES_PER_LANDMARK = 3;

/** Each landmark's index in the model's output, left and right. */
export const MODEL_INDEX: Readonly<
  Record<SidePoseLandmark, { readonly left: number; readonly right: number }>
> = {
  ear: { left: 7, right: 8 },
  shoulder: { left: 11, right: 12 },
  elbow: { left: 13, right: 14 },
  wrist: { left: 15, right: 16 },
  hip: { left: 23, right: 24 },
  knee: { left: 25, right: 26 },
  ankle: { left: 27, right: 28 },
  heel: { left: 29, right: 30 },
  toe: { left: 31, right: 32 },
};

/**
 * The least visibility a point is kept at: 0.5.
 *
 * ## Provenance — ⚠️ the author's choice, not a measurement
 *
 * The model card defines visibility as, after a sigmoid, *"the probability
 * that a keypoint is located within the frame and not occluded by another
 * bigger body part or another object"* (*MediaPipe BlazePose GHUM 3D* model
 * card, dated 2021-04-16, read 2026-09-25). 0.5 is the even-odds line: a
 * point below it is more likely hidden than not. #385's accuracy half, which
 * nobody has been able to run, is what would move it.
 */
export const MINIMUM_LANDMARK_VISIBILITY = 0.5;

/**
 * The near side's sure points from one picture, or `no-rider`.
 *
 * `values` is the model's output as the worker flattens it:
 * {@link MODEL_LANDMARK_COUNT} × {@link MODEL_VALUES_PER_LANDMARK} numbers,
 * or none at all when the model found nobody. Anything else is `unreadable`,
 * because the worker is this program's own and a wrong length is a fault.
 */
export function sidePoseFromModel(
  width: number,
  height: number,
  values: readonly number[],
): SidePoseOutcome {
  if (!positive(width) || !positive(height)) {
    return { kind: 'unreadable' };
  }
  if (values.length === 0) {
    return { kind: 'no-rider' };
  }
  if (
    values.length !== MODEL_LANDMARK_COUNT * MODEL_VALUES_PER_LANDMARK ||
    !values.every(Number.isFinite)
  ) {
    return { kind: 'unreadable' };
  }
  const point = (index: number): { x: number; y: number; visibility: number } => {
    const at = index * MODEL_VALUES_PER_LANDMARK;
    return { x: values[at] ?? NaN, y: values[at + 1] ?? NaN, visibility: values[at + 2] ?? 0 };
  };
  const names = Object.keys(MODEL_INDEX) as SidePoseLandmark[];
  const visibilityOf = (side: 'left' | 'right'): number =>
    names.reduce((sum, name) => sum + point(MODEL_INDEX[name][side]).visibility, 0);
  // Ties go to the left, so the answer does not depend on anything but the numbers.
  const nearSide = visibilityOf('left') >= visibilityOf('right') ? 'left' : 'right';
  const landmarks: SidePoseMark[] = [];
  for (const name of names) {
    const { x, y, visibility } = point(MODEL_INDEX[name][nearSide]);
    if (visibility >= MINIMUM_LANDMARK_VISIBILITY && share(x) && share(y)) {
      landmarks.push({ name, x, y, visibility });
    }
  }
  if (landmarks.length < MINIMUM_SHARED_LANDMARKS) {
    return { kind: 'no-rider' };
  }
  return { kind: 'pose', pose: { aspect: width / height, nearSide, landmarks } };
}

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function share(value: number): boolean {
  return value >= 0 && value <= 1;
}
