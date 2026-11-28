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
 * from it at `people-body.ts` §`PHASES` phases a gait and bakes the result into a
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
 * - **A runner's arm carry** — R. N. Hinrichs, "Upper extremity function in
 *   running. II: Angular momentum considerations", *Int. J. Sport Biomech.* 3
 *   (1987) 242–263, describes the arms swinging against the legs with the
 *   hand crossing toward the body's midline in front and the elbow travelling
 *   mostly BEHIND the trunk. The figures here are this file's own, shaped to
 *   that description and to the owner's pictures of PR #2844, where both
 *   forearms were held straight out ahead: the swing is centred 12° behind
 *   the trunk, the elbow closes as the hand comes up in front and opens as it
 *   passes the hip, and the upper arm is turned in ({@link LimbAngles.carry})
 *   so the hand rises toward the breastbone, never across it.
 *
 * Pure, and names no rendering library.
 */

/** A walk or a run. #3285's still poses are §"Still poses", after {@link STRIDE_PER_HEIGHT}. */
export type Gait = 'walk' | 'run';

/** Every {@link Gait}, in the order the animation texture holds them. */
export const GAITS: readonly Gait[] = ['walk', 'run'];

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
  /**
   * The upper arm turned about its own length: positive brings the forearm
   * and hand IN, across the front of the body. Never negative.
   */
  readonly carry: number;
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

/** How far a walker's upper arm is turned in, degrees: the palm toward the thigh. */
const WALK_CARRY_DEGREES = 8;

/** How far behind the trunk a runner's arm swing is centred, degrees. */
const RUN_ARM_BEHIND_DEGREES = 12;

/** How far a runner's upper arm is turned in at the back of its swing, degrees. */
const RUN_CARRY_DEGREES = 20;

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
      // A hanging arm's palm faces the thigh: a little in, and no more.
      carry: WALK_CARRY_DEGREES * DEGREE,
    };
  }
  // Novacheck: ~40 % stance; the hip's range ~60°, the knee ~40° in stance and ~100° in swing.
  const hip = 15 + 30 * Math.cos(2 * Math.PI * (phase - 0.85));
  const knee = 12 + 28 * bump(phase, 0.17, 0.07) + 88 * bump(phase, 0.68, 0.11);
  const ankle = 12 * bump(phase, 0.2, 0.08) - 22 * bump(phase, 0.42, 0.06);
  // Against its own leg, as walking, and centred BEHIND the trunk: the elbow
  // drives back past the hip and the hand comes forward only to the chest.
  const swing = -0.8 * (hip - 15);
  const shoulder = swing - RUN_ARM_BEHIND_DEGREES;
  // How far forward the arm is, −1 at the back of its swing to 1 at the front.
  const forward = swing / 24;
  // A runner carries the elbow bent near a right angle: closed a little more
  // with the hand up in front, opened as it passes the hip.
  const elbow = 90 + 16 * forward;
  // Turned in, and further as the hand rises, so it comes up to the breastbone.
  const carry = RUN_CARRY_DEGREES + 10 * Math.max(0, forward);
  return {
    hip: hip * DEGREE,
    knee: knee * DEGREE,
    ankle: ankle * DEGREE,
    shoulder: shoulder * DEGREE,
    elbow: elbow * DEGREE,
    carry: carry * DEGREE,
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

/*
 * ## Still poses — #3285
 *
 * A person who is not going anywhere: standing with a small idle sway,
 * sitting, and clapping. Written in code as the gaits are (the owner's ruling
 * of 2026-10-24), on the same joints, and baked into the same animation
 * texture after the gaits (`people-body.ts` §`PHASES`), each at **two**
 * phases. The shader blends phase 0 into phase ½ and back, so a pose whose
 * phase runs on with the clock rocks between its two rows: a stander's weight
 * shifting, a spectator's hands meeting and parting.
 *
 * A sitter's phase is not a clock. It says how far between its two rows the
 * pose is ({@link sitBlend}): a deep seat, the thigh level, for the tallest,
 * and a perch on the seat's front, the thigh sloping down to a vertical shin,
 * for the shortest — so every sitter's feet are on the pavement and their
 * hips on the bench, whatever their height ({@link sitSeatShare}).
 *
 * No pose depicts harm, and none is a real person's.
 */

/** A pose that stays where it is: standing, sitting or clapping. */
export type StillPose = 'stand' | 'sit' | 'clap';

/** Every {@link StillPose}, in the order the animation texture holds them after the {@link GAITS}. */
export const STILL_POSES: readonly StillPose[] = ['stand', 'sit', 'clap'];

/** A gait or a still pose: what one instance of the people's draw is doing. */
export type Motion = Gait | StillPose;

/** Every {@link Motion}, in the animation texture's order: the gaits, then the still poses. */
export const MOTIONS: readonly Motion[] = [...GAITS, ...STILL_POSES];

/** Whether `motion` is a gait — a walk or a run — rather than a still pose. */
export function isGait(motion: Motion): motion is Gait {
  return motion === 'walk' || motion === 'run';
}

/**
 * How far between a still pose's two rows `phase` is: 0 at phase 0, 1 at
 * phase ½, and back to 0 at 1 — what the shader's blend of a two-row pose
 * draws.
 */
export function stillBlend(phase: number): number {
  const at = wrappedPhase(phase);
  return at <= 0.5 ? 2 * at : 2 - 2 * at;
}

/**
 * Body segments as shares of standing height — D. A. Winter, *Biomechanics
 * and Motor Control of Human Movement* (4th ed., 2009), §4.1: the ankle joint
 * **0.039** above the sole, the shank **0.246** and the thigh **0.245**
 * (hip 0.530, knee 0.285). `under` is this file's own figure: how far below
 * the hip joint a seated person's weight meets the seat, **0.035** — the
 * knee's height less the popliteal height of about a quarter of stature
 * that seat design is laid out by (S. Pheasant, *Bodyspace*, 1986).
 */
export const BODY_SHARE = { ankle: 0.039, shank: 0.246, thigh: 0.245, under: 0.035 } as const;

/**
 * A sitter's two rows, as the hip's flexion in degrees with the shin held
 * vertical (the knee bent as far as the hip): **90**, the thigh level, a deep
 * seat; and **70**, the thigh sloping down, perched on the seat's front.
 */
export const SIT_HIP_DEGREES = [90, 70] as const;

/**
 * How far the seat is below the hip joint and above the soles, as a share of
 * standing height, with the hip flexed `hipDegrees` and the shin vertical.
 */
function seatShareAt(hipDegrees: number): number {
  return (
    BODY_SHARE.ankle +
    BODY_SHARE.shank +
    BODY_SHARE.thigh * Math.cos(hipDegrees * DEGREE) -
    BODY_SHARE.under
  );
}

/**
 * Where a sitter's hips meet the seat, above their soles, as a share of their
 * height, at `phase` of the sit pose: the two rows' figures blended as the
 * shader blends their positions ({@link stillBlend}) — about **0.25** deep in
 * the seat and **0.33** perched.
 *
 * @test-facing `still-people.test.ts` holds a sitter's hips to the drawn
 * bench's seat by it; production places sitters by {@link sitBlend}, its inverse
 */
export function sitSeatShare(phase: number): number {
  const deep = seatShareAt(SIT_HIP_DEGREES[0]);
  const perched = seatShareAt(SIT_HIP_DEGREES[1]);
  return deep + (perched - deep) * stillBlend(phase);
}

/**
 * The sit pose's phase that puts a sitter `height` tall with their soles on
 * the ground and their hips on a seat `seat` metres above it: in `[0, ½]`,
 * and held there for a sitter too tall or too short to meet it exactly.
 */
export function sitBlend(height: number, seat: number): number {
  const deep = seatShareAt(SIT_HIP_DEGREES[0]);
  const perched = seatShareAt(SIT_HIP_DEGREES[1]);
  const share = (seat / height - deep) / (perched - deep);
  return Math.min(1, Math.max(0, share)) / 2;
}

/** How a stander's weight shifts: the hip, degrees, either way. */
const STAND_SWAY_DEGREES = 2;

/** How far a clapper's upper arm turns in with the hands apart and together, degrees. */
const CLAP_CARRY_DEGREES = [25, 55] as const;

function stillLimbs(
  pose: StillPose,
  phase: number,
): { readonly left: LimbAngles; readonly right: LimbAngles } {
  const blend = stillBlend(phase);
  if (pose === 'sit') {
    const hip = SIT_HIP_DEGREES[0] + (SIT_HIP_DEGREES[1] - SIT_HIP_DEGREES[0]) * blend;
    // The shin vertical, the foot flat; the hands resting on the thighs.
    const limb: LimbAngles = {
      hip: hip * DEGREE,
      knee: hip * DEGREE,
      ankle: 0,
      shoulder: 20 * DEGREE,
      elbow: 60 * DEGREE,
      carry: 15 * DEGREE,
    };
    return { left: limb, right: limb };
  }
  if (pose === 'clap') {
    // Forearms raised before the chest, turned in until the hands meet.
    const carry = CLAP_CARRY_DEGREES[0] + (CLAP_CARRY_DEGREES[1] - CLAP_CARRY_DEGREES[0]) * blend;
    const limb: LimbAngles = {
      hip: 0,
      knee: 3 * DEGREE,
      ankle: 0,
      shoulder: 45 * DEGREE,
      elbow: 95 * DEGREE,
      carry: carry * DEGREE,
    };
    return { left: limb, right: limb };
  }
  // Standing: the weight on one leg and then the other, the arms hanging.
  const shift = STAND_SWAY_DEGREES * (1 - 2 * blend);
  const side = (sign: number): LimbAngles => ({
    hip: sign * shift * DEGREE,
    knee: (3 + Math.max(0, -sign * shift)) * DEGREE,
    ankle: 0,
    shoulder: 0,
    elbow: 12 * DEGREE,
    carry: WALK_CARRY_DEGREES * DEGREE,
  });
  return { left: side(1), right: side(-1) };
}

/** The body's pose in a still pose at `phase`. Never lifted: the soles are on the ground. */
export function stillPose(pose: StillPose, phase: number): GaitPose {
  const { left, right } = stillLimbs(pose, phase);
  const blend = stillBlend(phase);
  return {
    left,
    right,
    // A sitter leans a little into the seat's back; a stander barely.
    lean: (pose === 'sit' ? -4 : 1) * DEGREE,
    pelvisTurn: pose === 'stand' ? (1 - 2 * blend) * 1.5 * DEGREE : 0,
    lift: 0,
  };
}

/** The pose of any {@link Motion} at `phase`: {@link gaitPose} or {@link stillPose}. */
export function motionPose(motion: Motion, phase: number): GaitPose {
  return isGait(motion) ? gaitPose(motion, phase) : stillPose(motion, phase);
}
