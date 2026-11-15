// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the rider's crash clip is made on — #2493.
 *
 * `blender/process_rider.py` step 10 poses the MakeHuman rider onto each
 * moment `blender/rider_crash.py` names and writes the poses into `rider.glb`
 * as the animation `realistic-assets.ts` §`REALISTIC_RIDER_CRASH_CLIP`. This is the half of it that is
 * not Blender's, written by `process-assets.ts` as a JSON file the script
 * reads, so the clip cannot disagree with the runtime about either thing it
 * shares with it:
 *
 * - **The riding pose** it starts and ends on: `rider-pack.ts` §`packPose`'s
 *   joints at crank angle 0 — `bicycle.ts` §`riderJoints`, on the hoods — and
 *   the hoods' stance, which every other moment's arms are solved with.
 * - **The timeline**: `delivery/crash-look.ts`' own fall, rise and end, so a
 *   moment named "as the fall ends" is at #2475's 0.45 s and not a copy of it.
 *
 * Pure: no file and no rendering library.
 */

import {
  CRASH_FALL_SECONDS,
  CRASH_RISE_AT_SECONDS,
  CRASH_SECONDS,
} from '../../src/game/delivery/crash-look';

import { packPose, type PackPhase, type PackPose } from './rider-pack';

/** What `process_rider.py` makes the crash clip from. */
export interface RiderCrashPose {
  /** The riding joints at crank angle 0: where the clip starts and ends. */
  readonly riding: PackPhase;
  readonly stance: PackPose['stance'];
  /** The leg the body is scaled to, as `RealisticRiderBelt` scales it. */
  readonly leg: number;
  /** `crash-look.ts`' times, in seconds after the crash. */
  readonly fall: number;
  readonly riseAt: number;
  readonly end: number;
}

export function riderCrashPose(): RiderCrashPose {
  const pose = packPose(2);
  const riding = pose.phases[0];
  if (riding === undefined) throw new Error('packPose returned no phase');
  return {
    riding,
    stance: pose.stance,
    leg: pose.leg,
    fall: CRASH_FALL_SECONDS,
    riseAt: CRASH_RISE_AT_SECONDS,
    end: CRASH_SECONDS,
  };
}
