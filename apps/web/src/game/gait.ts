// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How a person walks and runs — #1541, the owner's ruling of 2026-10-24: a
 * **parametric gait written in code**, as the rider's motion already is
 * (`bicycle.ts` §`riderMotion`), so no animation source is admitted.
 *
 * ## What it is
 *
 * One function, {@link gaitPose}, from a gait and a phase of its cycle to the
 * angles of each joint the MakeHuman body's skeleton bends, in radians, and
 * how far the body is lifted clear of the ground. The renderer poses the body
 * from it at {@link GAIT_PHASES} phases a gait and bakes the result into a
 * vertex-animation texture (`three-renderer.ts` §`PeopleBelt`), so nothing
 * here runs per frame.
 *
 * A cycle is one STRIDE — two steps. Phase 0 is the LEFT foot's contact with
 * the ground; the right leg and arm are the left's half a cycle on, which is
 * what a symmetrical gait is.
 *
 * ## Where the curves come from
 *
 * Each joint's curve is a periodic sum of a constant, a cosine and Gaussian
 * bumps, shaped to the published mean sagittal-plane curves — not fitted to
 * any one dataset, and no data is copied:
 *
 * - **Walking** — D. A. Winter, *The Biomechanics and Motor Control of Human
 *   Gait* (2nd ed., 1991), and J. Perry, *Gait Analysis* (1992): the hip
 *   flexed about 30° at contact and extended about 10° at 50 %, the knee's
 *   loading bump of about 15–20° at 15 % and its swing peak of about 60° at
 *   70 %, the ankle's plantarflexion of about 20° at toe-off (62 %).
 * - **Running** — T. F. Novacheck, "The biomechanics of running", *Gait &
 *   Posture* 7 (1998) 77–95: a stance of about 40 % of the cycle, the knee
 *   flexed about 40° in stance and about 100° in swing, the hip's range about
 *   60°, and the trunk leaning forward.
 * - **The arms** swing against the leg on their own side — S. H. Collins,
 *   P. G. Adamczyk and A. D. Kuo, "Dynamic arm swinging in human walking",
 *   *Proc. R. Soc. B* 276 (2009) 3679–3688 — and a runner carries the elbow
 *   bent near a right angle.
 *
 * Pure, and names no rendering library.
 */

/** A walk or a run. */
export type Gait = 'walk' | 'run';

/** Every {@link Gait}, in the order the animation texture holds them. */
export const GAITS: readonly Gait[] = ['walk', 'run'];

/**
 * How many phases of a cycle the renderer bakes a gait at: **24**. The shader
 * blends between the two nearest, so the motion is continuous; 24 keeps the
 * knee's 60° swing peak within 15° a step, under the blend's error at the
 * distance a person is drawn from.
 */
export const GAIT_PHASES = 24;

/** The angles of one side's joints, in radians. */
export interface LimbAngles {
  /** The hip: positive brings the thigh FORWARD (flexion). */
  readonly hip: number;
  /** The knee: positive bends it, the shin swinging back. Never negative. */
  readonly knee: number;
  /** The ankle: positive lifts the toes (dorsiflexion). */
  readonly ankle: number;
  /** The shoulder: positive swings the arm forward. */
  readonly shoulder: number;
  /** The elbow: positive bends it. Never negative. */
  readonly elbow: number;
}

/** A whole body's pose at one phase of a gait. */
export interface GaitPose {
  readonly left: LimbAngles;
  readonly right: LimbAngles;
  /** The trunk's lean forward, radians. */
  readonly lean: number;
  /** The pelvis turned about the vertical, radians: positive brings the LEFT hip forward. */
  readonly pelvisTurn: number;
  /** How far the whole body is lifted off the ground, metres at a 1.75 m body: a run's flight. */
  readonly lift: number;
}

/** A Gaussian bump on the cycle, centred at `centre` with width `width`, wrapped. */
function bump(phase: number, centre: number, width: number): number {
  let distance = Math.abs(phase - centre) % 1;
  if (distance > 0.5) distance = 1 - distance;
  return Math.exp(-(distance * distance) / (2 * width * width));
}

const DEGREE = Math.PI / 180;

/** One leg and the arm on its own side, at `phase` of its OWN cycle (0 = its foot's contact). */
function limb(gait: Gait, phase: number): LimbAngles {
  if (gait === 'walk') {
    // Winter / Perry: flexed ~30° at contact, ~−10° at about 50 %, peak again late in swing.
    const hip = 10 + 20 * Math.cos(2 * Math.PI * (phase - 0.9));
    const knee = 4 + 14 * bump(phase, 0.15, 0.06) + 56 * bump(phase, 0.72, 0.1);
    const ankle =
      -6 * bump(phase, 0.07, 0.04) + 10 * bump(phase, 0.43, 0.09) - 22 * bump(phase, 0.63, 0.06);
    // Collins et al.: the arm swings against its own leg, about ±12° in walking.
    const shoulder = -0.6 * (hip - 10);
    // A little more bend as the arm comes forward.
    const elbow = 18 + 10 * Math.max(0, shoulder / 12);
    return {
      hip: hip * DEGREE,
      knee: knee * DEGREE,
      ankle: ankle * DEGREE,
      shoulder: shoulder * DEGREE,
      elbow: elbow * DEGREE,
    };
  }
  // Novacheck: ~40 % stance; the hip's range ~60°, the knee ~40° in stance and ~100° in swing.
  const hip = 15 + 30 * Math.cos(2 * Math.PI * (phase - 0.85));
  const knee = 12 + 28 * bump(phase, 0.17, 0.07) + 88 * bump(phase, 0.68, 0.11);
  const ankle = 12 * bump(phase, 0.2, 0.08) - 22 * bump(phase, 0.42, 0.06);
  const shoulder = -0.8 * (hip - 15);
  // A runner carries the elbow bent near a right angle.
  const elbow = 85 + 10 * Math.max(0, shoulder / 24);
  return {
    hip: hip * DEGREE,
    knee: knee * DEGREE,
    ankle: ankle * DEGREE,
    shoulder: shoulder * DEGREE,
    elbow: elbow * DEGREE,
  };
}

/** The phase brought into `[0, 1)`. */
export function wrappedPhase(phase: number): number {
  const wrapped = phase - Math.floor(phase);
  return wrapped >= 1 ? 0 : wrapped;
}

/**
 * The body's pose at `phase` of a `gait`'s cycle — phase 0 the left foot's
 * contact, the right side half a cycle on. Any real `phase`: it is wrapped.
 */
export function gaitPose(gait: Gait, phase: number): GaitPose {
  const at = wrappedPhase(phase);
  const left = limb(gait, at);
  const right = limb(gait, wrappedPhase(at + 0.5));
  const run = gait === 'run';
  return {
    left,
    right,
    // Novacheck: a runner leans forward; a walker barely.
    lean: (run ? 8 : 2) * DEGREE,
    // The pelvis turns the swinging leg's hip forward: with the left hip's flexion.
    pelvisTurn: ((run ? 6 : 4) * DEGREE * (left.hip - right.hip)) / ((run ? 60 : 40) * DEGREE),
    // A run's two flights, after each toe-off: about 6 cm at a 1.75 m body.
    lift: run ? 0.06 * Math.max(bump(at, 0.45, 0.05), bump(at, 0.95, 0.05)) : 0,
  };
}

/**
 * How far a person moves over one cycle — one stride, two steps — as a share
 * of their height: **0.8** walking and **1.25** running. A 1.75 m walker's
 * stride is 1.4 m, which at 1.4 m/s is 60 strides a minute (Winter's 105 to
 * 120 steps); a 1.75 m runner's is 2.2 m, which at 3 m/s is 165 steps a
 * minute. The renderer advances a person's phase by the ground they cover over
 * this, so a foot does not slide.
 */
export const STRIDE_PER_HEIGHT: Readonly<Record<Gait, number>> = { walk: 0.8, run: 1.25 };
