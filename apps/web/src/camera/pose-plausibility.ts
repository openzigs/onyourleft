// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Whether a pose could be a person on a bicycle** —
 * [#761](https://github.com/openzigs/onyourleft/issues/761), found by
 * [spike 0016](../../../../docs/spikes/0016-live-in-ride-coaching.md) §5.4.
 *
 * `computer-pose.ts` §`sidePoseFromAnswer` checks an answer's shape, keys and
 * range, which is all a reader of JSON can check. A fluent wrong answer
 * passes: on the spike's pictures with nobody in them, a general vision model
 * on the rider's computer answered `"rider":true` every time, and the reader
 * accepted one of six blank pictures and four of six noise pictures as poses.
 * This is the check those poses fail. It asks nothing of a model and reads no
 * picture: it is geometry over the points the answer gave.
 *
 * ## What it checks
 *
 * A side view of somebody pedalling has an order no picture of them breaks,
 * whatever the bicycle, the riding position or the camera's height:
 *
 * 1. **The chain it reads is there**: {@link PLAUSIBILITY_LANDMARKS}. A pose
 *    missing any of them cannot be checked, and a pose that cannot be
 *    checked is not accepted.
 * 2. **Top to bottom**: the ear (when given) not far below the shoulder
 *    ({@link EAR_BELOW_SHOULDER_TOLERANCE}), the shoulder above the hip, the hip above the ankle, the knee above the ankle. The
 *    knee against the hip is deliberately not checked: at the top of the
 *    stroke a low saddle puts the knee level with the hip or above it.
 * 3. **The knee is bent**: {@link MAXIMUM_KNEE_OPENING_COSINE}.
 * 4. **The segments are in proportion**: {@link LIMB_RATIO_BOUNDS}.
 *
 * ## What it does NOT establish
 *
 * That a pose it passes is right. A model that draws a plausible cyclist
 * anywhere in a blank picture passes, and a correct pose of a rider in a
 * position these rules did not foresee fails. It raises the price of a
 * hallucination from "any JSON of the right shape" to "a figure in the right
 * order and proportion"; it does not measure accuracy, which is #385's.
 *
 * ⚠️ **Only the rider's computer's answers are held to it.** The tablet's own
 * model (`pose-landmarks.ts`) is a trained pose model that reports its own
 * visibility, and holding it to rules written for a general vision model's
 * hallucinations would drop real poses for a failure nobody has seen it make.
 *
 * ⚠️ **An angle is computed here and never leaves this file** — as a cosine,
 * compared with a bound, and answered as a reason word. ADR 0030 D-3 forbids
 * rendering one; nothing here is rendered, and the reason reaches no screen.
 */

import type { SidePose, SidePoseLandmark, SidePoseMark } from './side-analysis-port';

/** The landmarks every rule reads. A pose missing one is not checked, and not accepted. */
export const PLAUSIBILITY_LANDMARKS = [
  'shoulder',
  'hip',
  'knee',
  'ankle',
] as const satisfies readonly SidePoseLandmark[];

/**
 * The cosine of the knee's opening — the angle at the knee between the thigh
 * and the shin — above which the leg is too straight to be on a pedal:
 * `cos(170°)`, about −0.985. A straight leg is −1.
 *
 * ## Provenance — ⚠️ the author's choice, from a second-hand figure
 *
 * Bike-fit guidance commonly cites 25° to 35° of flexion at the bottom of the
 * stroke, which is an opening of about 145° to 155°; that figure is second-hand
 * and was not read from a primary source for this change. 170° leaves 15°
 * past the straightest of it for a model's placement error and a saddle set
 * too high.
 *
 * ## What it has caught — ⚠️ nothing yet, on the answers saved
 *
 * It is a guard against a failure not yet seen reaching it: the straight
 * line a hallucination might draw from hip to ankle. Run over every answer in
 * `model-answers-testing.ts` (`pose-plausibility-answers.test.ts` counts
 * them), it rejects **none**: every answer that places the whole chain breaks
 * the top-to-bottom order first, and shoulder-below-hip does almost all of
 * that work. Taken alone it would refuse three of the spike's noise answers,
 * whose legs open at 175° to 180°, but each of those had its shoulder below
 * its hip. ⚠️ **This comment used to cite "the spike's accepted blank-picture
 * pose", opening at about 174°, as what the rule catches**, and #808's review
 * found that answer's JSON does not close: it is unreadable and never reaches
 * this file (#813).
 */
export const MAXIMUM_KNEE_OPENING_COSINE = Math.cos((170 * Math.PI) / 180);

/**
 * How far below the shoulder the ear may be, as a share of the trunk's length
 * from shoulder to hip, before the head is said to be below the shoulder.
 *
 * ## Provenance — ⚠️ the author's choice (#813)
 *
 * A rider in the drops or on aerobars can carry their head level with their
 * shoulders, and a pose program of the rider's own — the use ADR 0033's
 * 2026-09-28 amendment keeps this path for — places each end with an error of
 * its own, so an ear a few pixels under a level shoulder is a rider, not a
 * hallucination. A quarter of the trunk is a head dropped well past level.
 * Scaled to the trunk so the allowance is the same whether the rider fills
 * the picture or a corner of it. The two saved answers this rule refuses put
 * the ear 0.34 and 2.2 trunks below the shoulder.
 */
export const EAR_BELOW_SHOULDER_TOLERANCE = 0.25;

/**
 * Each segment's length over another's, lowest and highest, in the picture's
 * own proportions (a share across is scaled by the picture's aspect so that a
 * share across and a share down are the same length).
 *
 * ## Provenance — ⚠️ the author's choice
 *
 * An adult's thigh and shin are close to the same length, and the trunk from
 * shoulder to hip is somewhat longer than the thigh. Seen from the side both
 * shorten as they turn toward or away from the camera, and a model places each
 * end with an error of its own, so the bounds are wide: a factor of two either
 * way for thigh against shin, and a half to three times the thigh for the
 * trunk. The drawn rider of spike 0016 §5.2 sits at 0.96 and 1.6.
 */
export const LIMB_RATIO_BOUNDS = {
  thighOverShin: { lowest: 0.5, highest: 2 },
  trunkOverThigh: { lowest: 0.5, highest: 3 },
} as const;

/**
 * Two given points closer than this share of the picture's height are one
 * point, and a segment between them has no direction to check.
 */
const COINCIDENT_SHARE = 0.01;

/** Why a pose could not be a person on a bicycle. */
export type Implausibility =
  | 'missing-landmark'
  | 'points-coincide'
  | 'head-below-shoulder'
  | 'shoulder-below-hip'
  | 'ankle-above-hip'
  | 'ankle-above-knee'
  | 'knee-straight'
  | 'out-of-proportion';

interface Point {
  readonly x: number;
  readonly y: number;
}

function within(value: number, bounds: { readonly lowest: number; readonly highest: number }) {
  return value >= bounds.lowest && value <= bounds.highest;
}

/**
 * Why `pose` could not be a person on a bicycle, or `undefined` when nothing
 * here rules it out. The rules are applied in the order the file's header
 * lists them, and the first to fail is the answer.
 */
export function implausibility(pose: SidePose): Implausibility | undefined {
  const byName = new Map<SidePoseLandmark, SidePoseMark>(
    pose.landmarks.map((mark) => [mark.name, mark]),
  );
  // Scaled so that one unit across is one unit down: shares of the height.
  const at = (name: SidePoseLandmark): Point | undefined => {
    const mark = byName.get(name);
    return mark === undefined ? undefined : { x: mark.x * pose.aspect, y: mark.y };
  };
  const shoulder = at('shoulder');
  const hip = at('hip');
  const knee = at('knee');
  const ankle = at('ankle');
  if (shoulder === undefined || hip === undefined || knee === undefined || ankle === undefined) {
    return 'missing-landmark';
  }
  const trunk = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y);
  const thigh = Math.hypot(knee.x - hip.x, knee.y - hip.y);
  const shin = Math.hypot(ankle.x - knee.x, ankle.y - knee.y);
  if (Math.min(trunk, thigh, shin) < COINCIDENT_SHARE) {
    return 'points-coincide';
  }
  // The picture's y grows downward, so "above" is a smaller y.
  const ear = at('ear');
  if (ear !== undefined && ear.y - shoulder.y > EAR_BELOW_SHOULDER_TOLERANCE * trunk) {
    return 'head-below-shoulder';
  }
  if (shoulder.y >= hip.y) {
    return 'shoulder-below-hip';
  }
  if (ankle.y <= hip.y) {
    return 'ankle-above-hip';
  }
  if (ankle.y <= knee.y) {
    return 'ankle-above-knee';
  }
  const opening =
    ((hip.x - knee.x) * (ankle.x - knee.x) + (hip.y - knee.y) * (ankle.y - knee.y)) /
    (thigh * shin);
  if (opening < MAXIMUM_KNEE_OPENING_COSINE) {
    return 'knee-straight';
  }
  if (
    !within(thigh / shin, LIMB_RATIO_BOUNDS.thighOverShin) ||
    !within(trunk / thigh, LIMB_RATIO_BOUNDS.trunkOverThigh)
  ) {
    return 'out-of-proportion';
  }
  return undefined;
}
