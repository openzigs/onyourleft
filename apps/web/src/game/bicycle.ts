// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The rider, as a bicycle and somebody on it — #349.
 *
 * ⚠️ **The rider used to be a blue sphere, and a reviewer who remembers
 * `MARKER_STYLE.rider` carrying a radius is reading the old file.** ADR 0008
 * D-5 fixes the camera behind the rider, so this is the most-looked-at object
 * in the frame for the whole of every ride; #341 gave everything *beside* the
 * road a silhouette and left the thing in the middle of it a ball.
 *
 * ## Why this is built from numbers rather than loaded from a pack
 *
 * #349 was filed asking for a **rigged** model with a pedalling clip, driven by
 * an `AnimationMixer`. Its own two surveys then found there is no such thing to
 * download: ADR 0022's pack (Kenney) has no bicycle at all, Quaternius'
 * universal animation library has no pedalling clip, and the rigged-and-animated
 * cyclists that do exist are on marketplaces whose licence has to be read per
 * model from its own page. So a pedalling animation would have to be *authored*.
 *
 * The survey's own alternative is what is built here, and it is better on the
 * axis the issue cares most about rather than merely cheaper:
 *
 * | | a rigged clip | **this** |
 * |---|---|---|
 * | asset | rigged, skinned, with a pedalling clip | **none** |
 * | three API | `SkinnedMesh`, `AnimationMixer`, a per-frame `update` | ⚠️ nothing new |
 * | honest at `—` rpm | the clip has to be paused deliberately | ⚠️ **falls out** — no cadence, no rotation |
 * | driven by real cadence | a clip's playback rate, retargeted | **exactly**: the angle *is* the integral of the cadence |
 *
 * ⚠️ **The last two rows are the argument, and they are the issue's own.** #349
 * worries that *"a rider pedalling at a fixed rate while the HUD reads 92 rpm is
 * worse than a sphere, because it claims something false"*. Deriving the crank
 * angle from the cadence reading makes that structurally impossible: the cranks
 * turn **exactly when the HUD shows a cadence number**, at exactly that number,
 * and `bicycle.test.ts` asserts the first half against `hud/fields.ts` itself
 * rather than against a restatement of its rule.
 *
 * It also settles two licence questions by not raising them. Nothing here is
 * anybody's asset, so ADR 0022 D-1's *"one CC0 source"* is untouched, ADR 0023's
 * attribution obligation is not engaged, and `ASSETS.toml` gains no row —
 * ⚠️ which is the **stronger** answer to ADR 0009 L2 than a provenance record
 * would have been. An animated cyclist avatar is the single most recognisable
 * element of this product category, and the defence that it is derived from
 * nobody is a property of the file rather than a claim about a download.
 *
 * ## The seam, which is the same one everything else in `game/` observes
 *
 * ⚠️ **No `three` here, and that is not a formality.** This file emits
 * *numbers* — solids, offsets, angles — exactly as `terrain.ts` emits vertices
 * and `scatter.ts` emits placements, and `three-renderer.ts` is the one file
 * that turns any of it into geometry. Which means the whole of the rider's
 * shape, and the whole of the pedalling, is asserted in the fast jsdom suite
 * where a `WebGLRenderer` cannot even be constructed.
 *
 * ## The frame these numbers are in
 *
 * Right-handed, metres, origin **on the road surface** midway between the two
 * contact patches: `+Y` is up, `+Z` is the direction of travel, `+X` is one
 * side. The model is mirror-symmetric about `x = 0` apart from the drivetrain,
 * so which side `+X` is does not need deciding.
 *
 * ⚠️ **Every part's `y` is at or above zero**, which is why the renderer places
 * the rider at the marker's own `y` and not lifted by a radius the way the bot
 * and the ghost still are. A model that floated would be invisible at a glance
 * from a chase camera and obvious to nobody.
 *
 * ## What this deliberately does not do
 *
 * - **No lean.** A bicycle leans into a corner, and the corridor gives no
 *   lateral acceleration to lean by; inventing one from the centreline's
 *   curvature would be a second source of truth about where the rider is.
 * - **No steering, and no pitch on a gradient.** Both are below what a 1.6 m
 *   object 8 m from the camera resolves, and both would need state this file
 *   does not have.
 * - **Nothing for the bot or the ghost.** They keep their cone and their
 *   octahedron, which is #93 criterion 3 taken seriously: **three different
 *   silhouettes beat three bicycles in three colours**, and the per-frame cost
 *   of the pedalling stays at one rider rather than three. #349 asks the
 *   question and this is the answer.
 */

import type { SensorReading } from './hud/fields';

/** A turn, in radians. Written out once so that no call site spells `2 * PI`. */
const TAU = Math.PI * 2;

/**
 * Every colour the rider is drawn in.
 *
 * ⚠️ **`jersey` is the blue the sphere wore** — `0x2f6fed`, unchanged — because
 * #93's third criterion is about telling the three apart and the rider's own
 * hue is half of how a rider already reads the frame. The shape is what
 * changed; the colour deliberately did not.
 *
 * ⚠️ **No skin tone appears here, and that is a decision rather than an
 * oversight.** At eight metres behind, on a phone, it conveys nothing, and it
 * is a choice with a cost and no benefit. The rider wears long tights, a
 * long-sleeved jersey and a helmet, so the question does not arise.
 *
 * Every value is bounded by `three-renderer.test.ts` §"lights no colour past
 * white", which multiplies each channel through `world.ts`'s `PEAK_IRRADIANCE`
 * in the linear space the shader works in: a brighter one than these turns that
 * test red, which is the intended way to find out.
 */
export const RIDER_PALETTE = {
  /** The rider's body: jersey, tights and arms. */
  jersey: 0x2f6fed,
  /** Legs and helmet — darker than the jersey, so the pedalling reads as motion. */
  limb: 0x1b3f8f,
  /** The machine's tubes. Pale, so the frame is a silhouette against the road. */
  frame: 0xd8dee3,
  /** Tyres, saddle and cranks. Near-black, so the wheels read as wheels. */
  tyre: 0x22262b,
} as const;

/**
 * The palette as a list, for the light budget.
 *
 * `three-renderer.ts` folds this into `LIT_COLOURS`, so a colour added above
 * lands in the brightness bound automatically — the same property that file's
 * own comment claims for the scenery and marker tables.
 */
export const BICYCLE_COLOURS: readonly number[] = Object.values(RIDER_PALETTE);

/** One of the four solids the rider is built out of. */
export type RiderSolid =
  | {
      readonly shape: 'box';
      readonly width: number;
      readonly height: number;
      readonly depth: number;
    }
  /** A cylinder along its own `+Y`, before the part's rotation. */
  | { readonly shape: 'tube'; readonly radius: number; readonly length: number }
  /** A torus in its own XY plane — a wheel whose axle points along `+Z`. */
  | { readonly shape: 'ring'; readonly radius: number; readonly thickness: number }
  | { readonly shape: 'ball'; readonly radius: number };

/**
 * One rigid piece of the rider.
 *
 * ⚠️ **The three rotations are applied X, then Y, then Z, and then the
 * translation** — `three-renderer.ts` builds each part with exactly that order
 * and says so. Stating it here is what lets this file's numbers be checked
 * without a renderer: a part's world-space extent is computable from these
 * fields alone, and `bicycle.test.ts` computes it.
 */
export interface RiderPart {
  /** For a failure message, and so the parts list reads as a bicycle. */
  readonly name: string;
  readonly solid: RiderSolid;
  readonly colour: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Rotation about `+X`, in radians: what tips a part forward or back. */
  readonly pitch: number;
  /** Rotation about `+Y`. */
  readonly yaw: number;
  /** Rotation about `+Z`: what lays a tube across the bicycle. */
  readonly roll: number;
}

/** A part with no rotation, which is most of them. */
function part(
  name: string,
  solid: RiderSolid,
  colour: number,
  at: { readonly x?: number; readonly y: number; readonly z: number },
  turned: { readonly pitch?: number; readonly yaw?: number; readonly roll?: number } = {},
): RiderPart {
  return {
    name,
    solid,
    colour,
    x: at.x ?? 0,
    y: at.y,
    z: at.z,
    pitch: turned.pitch ?? 0,
    yaw: turned.yaw ?? 0,
    roll: turned.roll ?? 0,
  };
}

/**
 * A tube between two points that share an `x`, as the part that spans them.
 *
 * Every frame tube, every stay and every limb is one of these, so the numbers
 * below are the bicycle's **joints** rather than a list of centres and angles
 * somebody worked out by hand — which is what makes moving the saddle a change
 * to one number instead of three.
 */
function tube(
  name: string,
  colour: number,
  radius: number,
  from: { readonly x?: number; readonly y: number; readonly z: number },
  to: { readonly y: number; readonly z: number },
): RiderPart {
  const span = spanBetween(from.y, from.z, to.y, to.z);
  return part(
    name,
    { shape: 'tube', radius, length: span.length },
    colour,
    { x: from.x ?? 0, y: span.y, z: span.z },
    { pitch: span.pitch },
  );
}

/** Where a segment's centre is, how long it is, and how far it is tipped. */
function spanBetween(
  fromY: number,
  fromZ: number,
  toY: number,
  toZ: number,
): { readonly y: number; readonly z: number; readonly length: number; readonly pitch: number } {
  const dy = toY - fromY;
  const dz = toZ - fromZ;
  return {
    y: (fromY + toY) / 2,
    z: (fromZ + toZ) / 2,
    length: Math.hypot(dy, dz),
    // A tube stands along `+Y`; a rotation about `+X` by `atan2(dz, dy)` takes
    // `(0, 1, 0)` to `(0, cos, sin)`, which is the direction from `from` to `to`.
    pitch: Math.atan2(dz, dy),
  };
}

/** Where the cranks turn, in the model's own frame: the bottom bracket. */
export const CRANK_AXIS_Y = 0.27;
/** @see CRANK_AXIS_Y */
export const CRANK_AXIS_Z = -0.06;

/** How long a crank arm is, in metres. 170 mm is the commonest road length. */
export const CRANK_LENGTH_METRES = 0.17;

/** Where the hip joint sits. The saddle is set from it, not the other way round. */
const HIP_Y = 0.97;
const HIP_Z = -0.26;
/** How far either hip is from the bicycle's own plane. */
const HIP_ACROSS = 0.09;

/**
 * Hip to knee, and knee to ankle, in metres.
 *
 * ⚠️ **Their sum, 0.895 m, is 3 mm SHORT of the furthest the pedal ever gets
 * from the hip (0.898 m), and that is the fit rather than a rounding error.** A
 * bicycle is set up so that the leg is all but straight at the bottom of the
 * stroke, which is what these two numbers and {@link HIP_Y} together say; the
 * consequence is that {@link legBones}'s clamp is a path the model actually
 * takes, over about 24° of every revolution, rather than a guard nothing can
 * reach and no test can prove. @see legBones
 */
const THIGH_METRES = 0.4475;
const SHIN_METRES = 0.4475;

/** How thick a leg segment is drawn. @see legBones */
export const LIMB_RADIUS_METRES = 0.055;

const SHOULDER_Y = 1.3;
const SHOULDER_Z = 0.06;
const SHOULDER_ACROSS = 0.16;
const GRIP_Y = 0.96;
const GRIP_Z = 0.36;

/**
 * A wheel's **outer** radius, tyre included: 0.34 m, which is a 700 × 25 C.
 *
 * ⚠️ The torus is built at `WHEEL_RADIUS − TYRE_RADIUS` with a tube of
 * `TYRE_RADIUS`, so that this number is the distance from the hub to the road
 * and the hub can sit at exactly this height. Building it at the outer radius
 * would sink every tyre 28 mm into the carriageway, which is `bicycle.test.ts`
 * §"stands on the road" and is not otherwise visible from anywhere in jsdom.
 */
const WHEEL_RADIUS = 0.34;
const TYRE_RADIUS = 0.028;
const REAR_HUB_Z = -0.5;
const FRONT_HUB_Z = 0.52;
const SADDLE_Y = 0.94;
const SADDLE_Z = -0.28;
const HEAD_TUBE_TOP_Y = 0.96;
const HEAD_TUBE_TOP_Z = 0.34;
const HEAD_TUBE_FOOT_Y = 0.72;
const HEAD_TUBE_FOOT_Z = 0.38;

/**
 * The rider's back, as the segment between the two joints that define it.
 *
 * Taken from the same {@link spanBetween} a frame tube uses, so the torso lies
 * along the hip–shoulder line rather than at an angle somebody chose — and
 * moving either joint moves the back with it.
 */
const TORSO_SPAN = spanBetween(HIP_Y, HIP_Z, SHOULDER_Y, SHOULDER_Z);

/**
 * The bicycle and the body: everything that does **not** turn with the cranks.
 *
 * ⚠️ **One merged geometry and one draw call**, which is the same trade
 * `terrain.ts` makes for the road: the parts carry their colours as vertex
 * data, so a bicycle of four colours is still one material. #240's NFR-2 says
 * draw calls are the budget that matters here, and the rider costs **three** in
 * total — this, the cranks, and the four leg segments as one instanced mesh —
 * against the one the sphere cost.
 */
export const RIDER_BODY_PARTS: readonly RiderPart[] = [
  // ---------------------------------------------------------------- the wheels
  // A torus stands in its own XY plane with its axle along `+Z`; a quarter turn
  // about `+Y` puts the axle across the bicycle, which is where an axle goes.
  part(
    'rear wheel',
    { shape: 'ring', radius: WHEEL_RADIUS - TYRE_RADIUS, thickness: TYRE_RADIUS },
    RIDER_PALETTE.tyre,
    { y: WHEEL_RADIUS, z: REAR_HUB_Z },
    { yaw: Math.PI / 2 },
  ),
  part(
    'front wheel',
    { shape: 'ring', radius: WHEEL_RADIUS - TYRE_RADIUS, thickness: TYRE_RADIUS },
    RIDER_PALETTE.tyre,
    { y: WHEEL_RADIUS, z: FRONT_HUB_Z },
    { yaw: Math.PI / 2 },
  ),
  // ----------------------------------------------------------------- the frame
  tube(
    'seat tube',
    RIDER_PALETTE.frame,
    0.022,
    { y: CRANK_AXIS_Y, z: CRANK_AXIS_Z },
    { y: SADDLE_Y, z: SADDLE_Z },
  ),
  tube(
    'down tube',
    RIDER_PALETTE.frame,
    0.024,
    { y: CRANK_AXIS_Y, z: CRANK_AXIS_Z },
    { y: HEAD_TUBE_FOOT_Y, z: HEAD_TUBE_FOOT_Z },
  ),
  tube(
    'top tube',
    RIDER_PALETTE.frame,
    0.02,
    { y: SADDLE_Y, z: SADDLE_Z },
    { y: HEAD_TUBE_TOP_Y, z: HEAD_TUBE_TOP_Z },
  ),
  tube(
    'head tube',
    RIDER_PALETTE.frame,
    0.024,
    { y: HEAD_TUBE_FOOT_Y, z: HEAD_TUBE_FOOT_Z },
    { y: HEAD_TUBE_TOP_Y, z: HEAD_TUBE_TOP_Z },
  ),
  ...[-1, 1].flatMap((side) => [
    tube(
      `seat stay ${side}`,
      RIDER_PALETTE.frame,
      0.013,
      { x: side * 0.045, y: SADDLE_Y - 0.02, z: SADDLE_Z + 0.01 },
      { y: WHEEL_RADIUS, z: REAR_HUB_Z },
    ),
    tube(
      `chain stay ${side}`,
      RIDER_PALETTE.frame,
      0.013,
      { x: side * 0.05, y: CRANK_AXIS_Y, z: CRANK_AXIS_Z - 0.02 },
      { y: WHEEL_RADIUS, z: REAR_HUB_Z },
    ),
    tube(
      `fork ${side}`,
      RIDER_PALETTE.frame,
      0.016,
      { x: side * 0.05, y: HEAD_TUBE_FOOT_Y, z: HEAD_TUBE_FOOT_Z },
      { y: WHEEL_RADIUS, z: FRONT_HUB_Z },
    ),
    // The arms. Same solid as a frame tube because at this distance an arm is a
    // segment between two joints and nothing else.
    tube(
      `arm ${side}`,
      RIDER_PALETTE.jersey,
      0.032,
      { x: side * SHOULDER_ACROSS, y: SHOULDER_Y, z: SHOULDER_Z },
      { y: GRIP_Y, z: GRIP_Z },
    ),
  ]),
  // A handlebar lies across the bicycle, so its tube is rolled a quarter turn.
  part(
    'handlebar',
    { shape: 'tube', radius: 0.014, length: 0.4 },
    RIDER_PALETTE.tyre,
    { y: HEAD_TUBE_TOP_Y + 0.02, z: HEAD_TUBE_TOP_Z },
    { roll: Math.PI / 2 },
  ),
  part('saddle', { shape: 'box', width: 0.1, height: 0.035, depth: 0.24 }, RIDER_PALETTE.tyre, {
    y: SADDLE_Y + 0.025,
    z: SADDLE_Z - 0.02,
  }),
  // ----------------------------------------------------------------- the rider
  part(
    'torso',
    { shape: 'box', width: 0.34, height: TORSO_SPAN.length, depth: 0.22 },
    RIDER_PALETTE.jersey,
    { y: TORSO_SPAN.y, z: TORSO_SPAN.z },
    { pitch: TORSO_SPAN.pitch },
  ),
  part('helmet', { shape: 'ball', radius: 0.115 }, RIDER_PALETTE.limb, { y: 1.4, z: 0.19 }),
];

/**
 * The cranks, the chainring and the pedals — **in the axis's own frame**.
 *
 * ⚠️ **Every `y` and `z` here is relative to the bottom bracket, not to the
 * road**, because this is the one piece of the rider that rotates: the renderer
 * mounts it at ({@link CRANK_AXIS_Y}, {@link CRANK_AXIS_Z}) and turns it about
 * its own `+X`. Writing these in road coordinates and subtracting would be the
 * same numbers with one more place to get a sign wrong.
 *
 * The two arms are 180° apart **and** on opposite sides of the bicycle, which is
 * what a crankset is; that is why one is at `+x, +y` and the other at `−x, −y`.
 */
export const RIDER_CRANK_PARTS: readonly RiderPart[] = [
  part(
    'chainring',
    { shape: 'ring', radius: 0.095, thickness: 0.011 },
    RIDER_PALETTE.tyre,
    { x: 0.055, y: 0, z: 0 },
    { yaw: Math.PI / 2 },
  ),
  ...[1, -1].map((side) =>
    part(
      `crank arm ${side}`,
      { shape: 'box', width: 0.022, height: CRANK_LENGTH_METRES, depth: 0.032 },
      RIDER_PALETTE.tyre,
      { x: side * 0.075, y: (side * CRANK_LENGTH_METRES) / 2, z: 0 },
    ),
  ),
  ...[1, -1].map((side) =>
    part(
      `pedal ${side}`,
      { shape: 'box', width: 0.09, height: 0.016, depth: 0.07 },
      RIDER_PALETTE.tyre,
      { x: side * 0.1, y: side * CRANK_LENGTH_METRES, z: 0 },
    ),
  ),
];

/** One segment of one leg, in the model's own frame. @see legBones */
export interface LimbBone {
  readonly name: string;
  /** The segment's midpoint. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Hip to knee, or knee to ankle. */
  readonly length: number;
  /** Rotation about `+X` that takes a `+Y` tube onto this segment. */
  readonly pitch: number;
}

/**
 * How many segments {@link legBones} returns, for a caller sizing a buffer.
 *
 * Two legs of two bones each. Exported rather than inferred from a call so that
 * the renderer can reserve its instanced mesh before the first frame — the same
 * reason `ScatterBelt` reserves per kind up front.
 */
export const LEG_BONE_COUNT = 4;

/**
 * Where the legs are, for a given crank angle.
 *
 * ## The whole of the animation, and it is arithmetic
 *
 * The foot is on the pedal; the pedal is on the crank; the crank angle comes
 * from the cadence. So the **only** unknown is the knee, and a knee is the
 * classic two-bone planar problem: two segments of known length between a fixed
 * hip and a known foot, solved by the law of cosines and resolved forwards.
 *
 * ⚠️ **Resolved forwards, deliberately.** The cosine rule gives the angle and
 * not the side, so both a knee ahead of the hip–foot line and one behind it
 * satisfy it — and the second is a leg bending backwards, which is the single
 * most obviously wrong thing this function could draw. The perpendicular is
 * therefore taken as `(uz, −uy)`, which is the `+Z` side of a line running down
 * and forward from the hip, and `bicycle.test.ts` asserts the knee is ahead of
 * that line at every angle of the stroke rather than at one.
 *
 * ⚠️ **The reach is clamped, and the clamp is reached.** `THIGH + SHIN` is
 * 0.895 m against a maximum hip-to-pedal distance of 0.898 m, so for about 24°
 * either side of the furthest point of the stroke the leg is drawn straight and
 * the shin is asked to span 3 mm more than it is — which is how a bicycle is
 * fitted, and is why the geometry above is written as joints.
 *
 * Without the clamp the cosine rule returns a value outside `[-1, 1]` there,
 * `Math.acos` returns `NaN`, and a `NaN` in an instance matrix takes the
 * **whole mesh** off the screen rather than one leg. `bicycle.test.ts` sweeps
 * the revolution finely enough to land inside that arc for exactly this
 * reason: a guard nothing can reach is a guard no test can prove.
 *
 * Both legs come from one solve, at `angle` and at `angle + π`, because a
 * crankset is one rigid body.
 */
export function legBones(crankAngle: number): readonly LimbBone[] {
  return [1, -1].flatMap((side) => {
    // `side` is both which side of the bicycle the leg is on and which crank arm
    // it is clipped to, and those are the same choice: the arm at `+x` is the
    // one pointing at `+y` at angle zero.
    const pedalAngle = side === 1 ? crankAngle : crankAngle + Math.PI;
    const footY = CRANK_AXIS_Y + CRANK_LENGTH_METRES * Math.cos(pedalAngle);
    const footZ = CRANK_AXIS_Z + CRANK_LENGTH_METRES * Math.sin(pedalAngle);
    const knee = kneeBetween(HIP_Y, HIP_Z, footY, footZ);
    const thigh = spanBetween(HIP_Y, HIP_Z, knee.y, knee.z);
    const shin = spanBetween(knee.y, knee.z, footY, footZ);
    const across = side * HIP_ACROSS;
    return [
      {
        name: `thigh ${side}`,
        x: across,
        y: thigh.y,
        z: thigh.z,
        length: thigh.length,
        pitch: thigh.pitch,
      },
      {
        name: `shin ${side}`,
        x: across,
        y: shin.y,
        z: shin.z,
        length: shin.length,
        pitch: shin.pitch,
      },
    ];
  });
}

/** The knee, forward of the hip–foot line. @see legBones */
function kneeBetween(
  hipY: number,
  hipZ: number,
  footY: number,
  footZ: number,
): { readonly y: number; readonly z: number } {
  const dy = footY - hipY;
  const dz = footZ - hipZ;
  // ⚠️ **No guard against a `reach` of zero, deliberately.** A foot exactly at
  // the hip would have no direction to resolve against and the division below
  // would be a `NaN` in every matrix of the frame — but the pedal is never
  // nearer the hip than 0.558 m, because both are fixed numbers in the
  // geometry above. A branch no test can take is a branch nothing proves, which
  // is the shape this repository keeps finding; `bicycle.test.ts` §"keeps the
  // pedal well clear of the hip" states the invariant instead, where it goes
  // red if somebody moves the saddle onto the bottom bracket.
  const reach = Math.hypot(dy, dz);
  const unitY = dy / reach;
  const unitZ = dz / reach;
  const cosine = clamp(
    (THIGH_METRES * THIGH_METRES + reach * reach - SHIN_METRES * SHIN_METRES) /
      (2 * THIGH_METRES * reach),
    -1,
    1,
  );
  const opening = Math.acos(cosine);
  // The `+Z` perpendicular of a line running down and forward: the knee side.
  return {
    y: hipY + THIGH_METRES * (Math.cos(opening) * unitY + Math.sin(opening) * unitZ),
    z: hipZ + THIGH_METRES * (Math.cos(opening) * unitZ - Math.sin(opening) * unitY),
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * The longest step {@link advanceCrank} will integrate in one call: 250 ms.
 *
 * ⚠️ **The same argument `simulation.ts` makes for `MAXIMUM_STEPS_PER_ADVANCE`,
 * and the same failure it guards.** A backgrounded phone hands the next frame a
 * gap of minutes, and without a bound the cranks would spin through hundreds of
 * revolutions on one frame — which is invisible in the wrap but is a claim
 * about pedalling that did not happen, and at a big enough gap it is arithmetic
 * on a number with no useful precision left. The rider comes back to cranks
 * where they left them, which is what a rider who was not pedalling did.
 */
export const MAXIMUM_CRANK_STEP_SECONDS = 0.25;

/**
 * Advances the crank angle by whatever the cadence says — and by nothing at all
 * when there is no cadence.
 *
 * ⚠️ **The condition is `hud/fields.ts`'s own, restated in one place.** A
 * reading is drawn as a number when it is `live`, has a value, and that value is
 * finite; anything else renders as `NO_READING`. So a rider with no cadence
 * sensor, a sensor that has gone quiet, and a trainer that has connected and not
 * yet notified all get **still cranks**, which is #349's *"does something stated
 * when there is not"*: the cranks stop rather than inventing a rate.
 *
 * ⚠️ That is a deliberate trade and it has a cost worth naming: a rider whose
 * power meter reports watts but whose cadence channel is unpaired is pedalling
 * in front of a bicycle that is not. The alternative is a rate this program made
 * up, and #349 is explicit that a made-up rate *"is worse than a sphere, because
 * it claims something false"*.
 *
 * Wrapped into `[0, 2π)` so the number a caller carries between frames stays
 * small however long a ride runs.
 */
export function advanceCrank(angle: number, cadence: SensorReading, seconds: number): number {
  const turning =
    cadence.live && cadence.value !== undefined && Number.isFinite(cadence.value)
      ? cadence.value
      : undefined;
  if (turning === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return wrapped(angle);
  }
  const step = Math.min(seconds, MAXIMUM_CRANK_STEP_SECONDS);
  // Revolutions a minute into radians a second, which is the whole conversion:
  // the crank angle *is* the integral of the number on the HUD.
  return wrapped(angle + ((turning * TAU) / 60) * step);
}

/** Into `[0, 2π)`, for a negative angle as well as a large one. */
function wrapped(angle: number): number {
  if (!Number.isFinite(angle)) {
    // A caller that has somehow carried a `NaN` in gets a defined angle back
    // rather than passing one into a rotation matrix. @see legBones
    return 0;
  }
  return ((angle % TAU) + TAU) % TAU;
}
