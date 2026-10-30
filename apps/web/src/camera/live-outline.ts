// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The live pose outline, as lines and points to draw over the picture it
 * came from** — [#1061](https://github.com/openzigs/onyourleft/issues/1061),
 * [ADR 0044](../../../../docs/adr/0044-side-camera-live-view-and-snapshot.md)
 * D-9.
 *
 * In picture HEIGHTS across and down, the unit `framing.ts` §`FRAMING_GUIDE`
 * and §`referenceOutline` are in, so the guide, the ghost and this outline are
 * drawn in one `viewBox` of `aspect × 1` and none is stretched.
 *
 * ⚠️ **Drawing, not measuring.** It joins the near side's landmarks the model
 * reported, as the model reported them: no angle, no length, no verdict (D-9),
 * and nothing across the rider — every bone joins two points on the near side,
 * so no line is in the frontal plane (ADR 0030 D-4). A landmark the model did
 * not keep leaves a gap rather than a line to somewhere invented.
 */

import type { OutlineSegment } from './framing';
import { SIDE_POSE_LANDMARKS, type SidePose, type SidePoseLandmark } from './side-analysis-port';

/** The bones drawn, head to foot and then shoulder to hand: all on the near side. */
export const LIVE_OUTLINE_BONES: readonly (readonly [SidePoseLandmark, SidePoseLandmark])[] = [
  ['ear', 'shoulder'],
  ['shoulder', 'hip'],
  ['hip', 'knee'],
  ['knee', 'ankle'],
  ['ankle', 'heel'],
  ['heel', 'toe'],
  ['shoulder', 'elbow'],
  ['elbow', 'wrist'],
];

/** One joint of the outline, in picture heights. */
export interface OutlinePoint {
  readonly name: SidePoseLandmark;
  readonly x: number;
  readonly y: number;
}

/** The outline of `pose`, drawn over a picture `aspect` wide and 1 high. */
export function liveOutline(
  pose: SidePose,
  aspect: number,
): { readonly bones: readonly OutlineSegment[]; readonly joints: readonly OutlinePoint[] } {
  const joints = pose.landmarks.map((mark) => ({
    name: mark.name,
    x: mark.x * aspect,
    y: mark.y,
  }));
  const at = new Map(joints.map((joint) => [joint.name, joint]));
  const bones: OutlineSegment[] = [];
  for (const [from, to] of LIVE_OUTLINE_BONES) {
    const start = at.get(from);
    const end = at.get(to);
    if (start !== undefined && end !== undefined) {
      bones.push({ x1: start.x, y1: start.y, x2: end.x, y2: end.y });
    }
  }
  return { bones, joints };
}

/**
 * The outline a side-camera snapshot was SHOWN with, from the numbers its row
 * keeps — #1063, ADR 0044 D-3: *"stored as numbers and drawn when shown"*.
 *
 * A stored name this build does not draw is left out rather than drawn as
 * something it is not; the rest is {@link liveOutline}, unchanged, so a
 * snapshot's outline is the live view's outline and nothing more (D-9).
 */
export function storedOutline(outline: {
  readonly aspect: number;
  readonly landmarks: readonly { readonly name: string; readonly x: number; readonly y: number }[];
}): { readonly bones: readonly OutlineSegment[]; readonly joints: readonly OutlinePoint[] } {
  const drawn = new Set<string>(SIDE_POSE_LANDMARKS);
  const landmarks = outline.landmarks
    .filter((mark): mark is typeof mark & { name: SidePoseLandmark } => drawn.has(mark.name))
    .map((mark) => ({ name: mark.name, x: mark.x, y: mark.y, visibility: 1 }));
  return liveOutline({ aspect: outline.aspect, nearSide: 'right', landmarks }, outline.aspect);
}
