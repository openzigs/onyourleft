// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The chase camera, as one composition — #424.
 *
 * Height, distance behind, look-ahead and field of view were four constants in
 * two files until #424, and four gates were stated against them without any of
 * the four knowing about the others. #348 → #351 → #353 → #355 was four passes
 * of tuning scenery constants by eye against a camera nobody had done the
 * arithmetic for; this file is that arithmetic, written down once, so that the
 * next person to move the camera moves the numbers that follow from it in the
 * same edit — or is told by a red test which one they forgot.
 *
 * Pure, and it imports nothing from `three`: `scene.ts` and `world.test.ts`
 * both need it and neither may name the renderer (`three-seam.test.ts`). ADR
 * 0008 **D-5** fixes the camera — there is no free-look, and adding one is a
 * change to that ADR. Nothing here is a free-look: every function below is a
 * function of the route and of the shape of the frame.
 *
 * ## The composition
 *
 * | | before #424 | now |
 * |---|--:|--:|
 * | {@link CAMERA_BEHIND_METRES} | 8 | **4.5** |
 * | {@link CAMERA_ABOVE_METRES} | 3 | **2** |
 * | {@link CAMERA_TARGET_AHEAD_METRES} | 25 | 25 |
 * | {@link CAMERA_FIELD_OF_VIEW_DEGREES} | 60 | **70** |
 * | the rider's share of frame height | 18.1 % | **27.3 %** |
 *
 * ## ⚠️ The law that ties the four together, which is the substance of #424
 *
 * Write `t = tan(fov / 2)`, `a` for the frame's aspect ratio, `h` for the
 * rider's height and `w` for how far the nearest scenery stands from the
 * centreline (`ROAD_WIDTH_METRES / 2 + SCATTER_VERGE_METRES`, 6.5 m). Then, on
 * a level road and to first order in the camera's small pitch:
 *
 * - the rider fills `h / (2 · B · t)` of the frame's height;
 * - scenery at the verge enters the frame `w / (a · t) − B` metres ahead of the
 *   rider.
 *
 * Both depend on the camera through **the same product `B · t`**. So moving
 * the camera in or tightening the lens makes the rider larger and pushes the
 * verge's entry point up the road, in lockstep, and widening the lens to bring
 * the verge back makes the rider smaller again. They are one dial.
 *
 * #355's gate was *"the nearest thing the verge permits is in shot beside the
 * rider"* — an entry point at or behind the rider. Hold that, and `B · t` is
 * pinned at `w / a` or more, and the rider's share is whatever that leaves.
 * {@link riderFrameBox}, which is exact rather than first-order, gives what it
 * leaves on this lens:
 *
 * | frame | the most the rider can fill with #355's gate held | this camera |
 * |---|--:|--:|
 * | 16 : 9 | 23.2 % | **27.3 %** |
 * | 16 : 10 — the owner's tablet | 20.6 % | **27.3 %** |
 * | 4 : 3 | 16.9 % | **27.3 %** |
 *
 * The camera #424 was filed about filled 18.1 %. So on the tablet this is
 * ridden on, holding #355's gate is worth two and a half points over the speck
 * — and {@link MINIMUM_RIDER_FRAME_SHARE}, a quarter, is out of its reach at
 * all three. A prominent rider costs the scenery level with them, by geometry,
 * and only a lens past 100° gets both.
 *
 * What #424 therefore does is say which one is given up, and hold on to what
 * #355 was actually *for*:
 *
 * - **Given up:** scenery in shot *level with* the rider. The verge now enters
 *   a 16 : 9 frame {@link vergeEntersFrameMetres} ≈ **0.7 m ahead** of the
 *   rider, where it was 1.7 m behind. `three-renderer.test.ts` §"the verge and
 *   the camera cone" holds that to a stated bound rather than to zero.
 * - **Kept:** the measurement #355 was filed on — the share of what stands in
 *   the first 25 m of road that a rider can see. **73.8 %** at 16 : 9 with this
 *   camera, against the same 72 % bound #355 set and the 77.3 % the old camera
 *   reached. The field of view is what bought it back: at the old 60° this
 *   camera position measures 64.7 %, *below* the 67.8 % #355 was filed about.
 *   That is why the lens is 70° and not the 60° it was — it is solved against
 *   that gate, not chosen for a look.
 *
 * ⚠️ **#499 moves the camera across the road, and both figures above are
 * for a camera on the centreline.** The camera follows the rider's racing line
 * sideways (`scene.ts` §`cameraPose`), up to `racing-line.ts`
 * §`LINE_LIMIT_METRES` = 2.9 m from the middle. Where it is, the verge on the
 * FAR side is 2.9 m further off and enters a 16 : 9 frame **3.05 m** ahead of
 * the rider rather than 0.72 m (3.89 m on the owner's tablet), and the NEAR
 * side's is in shot **1.61 m behind** them. That is restated, not re-pinned:
 * the line only moves across in a bend, so on a straight the camera is on the
 * centreline and the 73.8 % above is still measured through the camera it was
 * set on. `three-renderer.test.ts` §"the verge and the camera cone" asserts
 * both halves.
 *
 * ⚠️ **What the wider lens costs** is stated too: 70° vertical is 102°
 * horizontal at 16 : 9 and 113° on a 19.5 : 9 phone, and a rectilinear lens that
 * wide stretches whatever is at the edge of the frame. That stretch is also
 * most of what makes 30 km/h read as fast from a low camera, which is #424's
 * own argument — but whether it looks *right* is not something any gate in this
 * repository can say, and `docs/validation/0002-android-shell-and-game.md`
 * Part Q asks the person holding the tablet.
 *
 * ## The frame is not 16 : 9 any more — #423
 *
 * The world was a 16 : 9 letterbox; it now fills the viewport. three's
 * projection takes a **vertical** field of view, so a fixed 70° on a phone held
 * upright (9 : 19.5) is a 36° horizontal slot with the road's own edges outside
 * it. {@link verticalHalfTangent} opens the lens as the frame narrows.
 */

import {
  BICYCLE_REAR_CONTACT_METRES,
  RIDER_HALF_WIDTH_METRES,
  RIDER_HEIGHT_METRES,
  RIDER_HELMET_AHEAD_METRES,
} from './bicycle';
import type { CameraPose } from './port';

/**
 * How far behind the rider the chase camera sits, in metres.
 *
 * ⚠️ **8 until #424, and in `port.ts`.** A reviewer who remembers it there is
 * reading the old file: it lived in `port.ts` because `world.test.ts` needs it
 * and must not import `three`, and this file meets the same need while keeping
 * the four numbers of one composition in one place.
 *
 * 4.5 m is about two bicycle lengths. Closer than that and the rider's own back
 * wheel leaves the bottom of the frame at {@link CAMERA_FIELD_OF_VIEW_DEGREES};
 * further and the share of frame height falls back towards the speck #424 was
 * filed about — this file's header has the law.
 */
export const CAMERA_BEHIND_METRES = 4.5;

/**
 * How far above the road the chase camera sits, in metres.
 *
 * ⚠️ **Above the ROAD UNDER THE CAMERA, not above the rider** — see
 * {@link cameraRig}. It was `pose.y + 3`, the rider's own elevation, which on a
 * 15 % descent puts a camera 4.5 m back two-thirds of a metre nearer the tarmac
 * than this number says.
 *
 * **Not "shoulder height or below", which is what #424's prose suggests**, and
 * the reason is {@link roadAppearsOverRiderMetres}: a camera below the top of
 * the helmet, directly behind a rider, cannot see the road over them *at any
 * distance* — the rider's own back is the whole of the middle of the frame and
 * the pacer 50 m up the road is behind it. 2 m is 0.485 m over a 1.515 m rider,
 * which shows the tarmac from 18.6 m out. It is still a metre lower than it
 * was.
 */
export const CAMERA_ABOVE_METRES = 2;

/** How far ahead of the rider, along the road, the camera looks. @see cameraRig */
export const CAMERA_TARGET_AHEAD_METRES = 25;

/**
 * The camera's **vertical** field of view on a frame wide enough not to need
 * more, in degrees — three's own convention.
 *
 * ⚠️ **70, solved rather than chosen** — this file's header says against what.
 * It is a floor on the vertical angle, not the angle: {@link verticalHalfTangent}
 * opens it on a narrow frame.
 */
export const CAMERA_FIELD_OF_VIEW_DEGREES = 70;

/**
 * The widest the vertical field of view is ever opened, in degrees: a right
 * angle.
 *
 * A rectilinear projection stretches what is off-axis by `1 / cos²`, which is
 * 2× at the edge of a 90° lens and 2.4× at the edge of a 100° one. A right angle
 * is the conventional place to stop. On a phone held upright the top and bottom
 * of the frame — where the stretch is — are sky and tarmac, and are behind the
 * HUD's panels besides.
 */
export const MAXIMUM_FIELD_OF_VIEW_DEGREES = 90;

const halfTangent = (degrees: number): number => Math.tan((degrees / 2) * (Math.PI / 180));

/**
 * The least a frame ever sees to the side, per metre of depth, until
 * {@link MAXIMUM_FIELD_OF_VIEW_DEGREES} stops it: what a **square** frame sees
 * at {@link CAMERA_FIELD_OF_VIEW_DEGREES}. `tan 35°` ≈ 0.700.
 *
 * Derived from the lens rather than chosen beside it, so the two cannot drift:
 * every frame at least as wide as it is tall gets exactly the reference lens,
 * and a frame taller than it is wide is treated as a square one with sky added
 * above and tarmac below — until the vertical angle that needs reaches 90°.
 */
export const MINIMUM_HORIZONTAL_SPREAD = halfTangent(CAMERA_FIELD_OF_VIEW_DEGREES);

/**
 * `tan(verticalFov / 2)` for a frame of this aspect ratio.
 *
 * | frame | aspect | vertical | horizontal |
 * |---|--:|--:|--:|
 * | a phone in landscape, 19.5 : 9 | 2.17 | 70° | 113° |
 * | 16 : 9 | 1.78 | 70° | 102° |
 * | the owner's tablet, 16 : 10 | 1.60 | 70° | 96° |
 * | 4 : 3 | 1.33 | 70° | 86° |
 * | square | 1.00 | 70° | 70° |
 * | a tablet upright, 10 : 16 | 0.63 | 96° → **90°** | 64° |
 * | a phone upright, 9 : 19.5 | 0.46 | 113° → **90°** | 50° |
 *
 * The arrow is {@link MAXIMUM_FIELD_OF_VIEW_DEGREES} binding. Below an aspect
 * of 0.70 the lens is at its stop and the horizontal view narrows with the
 * frame, which is simply what an upright phone is.
 */
export function verticalHalfTangent(aspect: number): number {
  const wanted = Math.max(
    halfTangent(CAMERA_FIELD_OF_VIEW_DEGREES),
    MINIMUM_HORIZONTAL_SPREAD / aspect,
  );
  return Math.min(wanted, halfTangent(MAXIMUM_FIELD_OF_VIEW_DEGREES));
}

/** {@link verticalHalfTangent} as the angle three's `PerspectiveCamera.fov` takes. */
export function verticalFieldOfViewDegrees(aspect: number): number {
  return 2 * Math.atan(verticalHalfTangent(aspect)) * (180 / Math.PI);
}

/**
 * How many metres to each side of its axis the camera sees, per metre of depth,
 * on a frame of this aspect ratio. three derives the same number per frame as
 * `aspect · tan(fov / 2)`; this is that, with the lens {@link verticalHalfTangent}
 * gives it.
 */
export function horizontalSpread(aspect: number): number {
  return aspect * verticalHalfTangent(aspect);
}

/**
 * The widest the world can be for its height: **6 : 1**, by construction.
 *
 * ⚠️ **Re-derived for #423, and it is a different kind of number now.** Until
 * then this was an argument about what a rider could plausibly produce: the
 * canvas was 16 : 9 inside a 68ch column with `max-height: 60vh`, and a table
 * showed that 6 : 1 needed a viewport 142 px tall. The world is full-bleed now,
 * that column is gone, and the same argument would have to be about how far
 * somebody will drag a desktop window — 2560×400 is 6.4 : 1 and is not absurd.
 *
 * So it is no longer argued, it is **enforced**: `theme.css`
 * §`.oyl-game__world` sets `max-width: 600vh` in the overlay layouts and
 * `240vh` in the stacked one (a 40vh letterbox), so a frame wider than 6 : 1
 * is pillarboxed rather than drawn. `browser/ride.browser.spec.ts` §"the world
 * is never wider than the cull allows" measures it at 2600×400.
 *
 * It bounds {@link FRUSTUM_SPREAD}, which bounds the scenery cull, which must
 * never drop something a rider can see — so it has to be the *widest* frame
 * there is. `three-renderer.ts` §`lateralReachMetres` has the cost of it and
 * where the cull actually fails.
 */
export const WORST_CASE_ASPECT = 6;

/**
 * The horizontal spread at {@link WORST_CASE_ASPECT}: 6 × tan 35° ≈ 4.20.
 *
 * ⚠️ 3.46 until #424, which widened the lens. Every metre of depth now admits
 * 0.74 m more to each side, so the cull keeps more — the direction that costs
 * instances and never a visible item.
 */
export const FRUSTUM_SPREAD = horizontalSpread(WORST_CASE_ASPECT);

/**
 * The narrowest the world can be for its height: **9 : 21**, a tall phone held
 * upright.
 *
 * ⚠️ **16 : 9 until #423, and that was a property of the stylesheet that the
 * stylesheet no longer has.** `.oyl-game__world` was `aspect-ratio: 16 / 9`
 * with a `max-height` that could only widen it, so 16 : 9 was a floor. The
 * world fills the viewport now, so the floor is the narrowest viewport there
 * is. 9 : 21 is the tallest phone aspect on sale; with a browser's own chrome
 * showing the same phone is nearer 9 : 16, which is wider and therefore kinder.
 *
 * @test-facing the narrow frame is what a rider gets and not what the renderer
 * computes against: three takes the live aspect from the canvas every frame,
 * and the cull deliberately uses the wide bound above. It is a bound
 * `three-renderer.test.ts` measures the near field against.
 */
export const NARROWEST_ASPECT = 9 / 21;

/**
 * The frame every near-field measurement since #355 has been taken in: 16 : 9.
 *
 * ⚠️ **This is what `NARROWEST_ASPECT` used to mean, and the two came apart in
 * #423.** #355's bound — 72 % of what stands in the first 25 m of road, in shot
 * — was measured at 16 : 9 *because 16 : 9 was the narrowest frame there was*.
 * It is not any more, and the honest thing to do with a bound taken at one
 * aspect is to keep taking it there rather than to quietly re-point it at a
 * frame it was never measured in: on a phone held upright the same measurement
 * is about 13 %, which is what a frame less than half as wide as it is tall looks like
 * and not a defect in anybody's constants. `three-renderer.test.ts` holds the
 * 16 : 9 bound where it was, and *adds* rows for the owner's 16 : 10 tablet, a
 * 4 : 3 one and an upright phone, each with its own measured floor.
 *
 * A landscape phone is wider than this, so for a phone on the bars it is still
 * the worst case.
 *
 * @test-facing {@link NARROWEST_ASPECT}'s reason applies unchanged.
 */
export const REFERENCE_ASPECT = 16 / 9;

/**
 * How far ahead of the **rider** something standing `acrossMetres` from the
 * centreline first enters a frame of this aspect, on a straight level road.
 * Negative means it is already in shot level with the rider.
 *
 * A perspective cone has an apex: an item `across` metres out is off the side
 * of the frame until it is `across / spread` metres ahead of the **camera**,
 * and the camera sits {@link CAMERA_BEHIND_METRES} behind the rider. That is
 * the whole of #355, and this file's header says what #424 did to it.
 *
 * @test-facing a statement of the composition that `three-renderer.test.ts` holds
 * the scenery's verge against. The renderer has no use for it: three clips.
 */
export function vergeEntersFrameMetres(acrossMetres: number, aspect: number): number {
  return acrossMetres / horizontalSpread(aspect) - CAMERA_BEHIND_METRES;
}

/**
 * How far ahead of the **camera** the road first shows over the rider's helmet,
 * on a level road: `B · H / (H − h)` — 18.6 m, which is 14.1 m ahead of the
 * rider.
 *
 * The line from the eye over the top of the helmet meets the road there.
 * Everything nearer, directly ahead, is behind the rider — which is correct and
 * is what "close" means — and everything further is visible over them. The
 * expression has a pole at `H = h`: a camera level with the helmet never sees
 * the road over it at all, which is why {@link CAMERA_ABOVE_METRES} is not the
 * shoulder height #424's prose floats.
 *
 * ⚠️ **#93's third criterion rests on this**: a pacer 10 m up the road is
 * 14.5 m from the camera, inside that distance, so on a dead-straight road its
 * wheels are behind the rider and its body is over their shoulder — the sight
 * line is `H − (H − h) · 14.5 / B` = 0.44 m up the pacer at that depth. At 50 m
 * and 200 m the whole of it is clear. `camera.test.ts` asserts all three.
 *
 * @test-facing a consequence of the composition, asserted in `camera.test.ts` so
 * that lowering the camera is a red test rather than a rider who cannot see
 * who they are chasing.
 */
export function roadAppearsOverRiderMetres(): number {
  return (CAMERA_BEHIND_METRES * CAMERA_ABOVE_METRES) / (CAMERA_ABOVE_METRES - RIDER_HEIGHT_METRES);
}

/** A point in the corridor's local metres. */
export interface RigPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Where the camera is and what it looks at. @see cameraRig */
export interface CameraRig {
  readonly eye: RigPoint;
  readonly target: RigPoint;
}

/**
 * Where the camera stands and what it looks at, for a pose — **how the camera
 * pitches with grade**, which #424 asks to have stated.
 *
 * Both ends ride the ROAD:
 *
 * - the **eye** is {@link CAMERA_ABOVE_METRES} over the road
 *   {@link CAMERA_BEHIND_METRES} behind the rider — `pose.eyeRoadY`;
 * - the **target** is ON the road {@link CAMERA_TARGET_AHEAD_METRES} ahead of
 *   them — `pose.targetRoadY`.
 *
 * So the view axis is, to a very good approximation, **parallel to the road
 * between those two points**, tipped down by the same `atan(2 / 29.5)` ≈ 3.9°
 * it has on the flat. On a steady 12 % climb the eye is 0.54 m lower than the
 * rider and the target 3 m higher, the axis rises with the hill, and what is
 * ON the road stays where it is on a level one.
 *
 * ⚠️ **What it replaces, and what that did on a hill — computed, because the
 * first draft of this paragraph guessed and was wrong.** Both ends used
 * `pose.y`, the rider's own elevation: a level gaze from behind the rider,
 * whatever the road did. The road does not leave such a frame — at ±20 % it is
 * still in shot — and the rider does not move in it at all. What moves is
 * **everything up the road**, which is where the pacer and the ghost are:
 *
 * | the road | a pacer 50 m ahead, level gaze | the same, this rig |
 * |---|--:|--:|
 * | 20 % climb | 33.5 % down the frame | 46.9 % |
 * | 12 % climb | 38.9 % | 46.8 % |
 * | level | 46.8 % | 46.8 % |
 * | 12 % descent | 54.6 % | 46.9 % |
 * | 20 % descent | **59.8 %** | 47.0 % |
 *
 * The rider's own body spans 52 % to 80 % of the frame ({@link riderFrameBox}),
 * and the HUD's top panels reach 35 % of a landscape phone
 * (`browser/ride.browser.spec.ts`). So under a level gaze a pacer 50 m ahead
 * goes **behind the rider's back** on a steep descent and **under the HUD** on
 * a steep climb — the crest-and-dip failure #424 names, as it actually lands
 * with a low camera. With the camera 3 m up and looking over the rider's head
 * it was survivable. This rig holds the pacer within a fifth of a point of
 * where it is on the flat, at every grade in that table; `camera.test.ts`
 * §"how the camera pitches with grade" asserts it, with the level gaze as its
 * control.
 *
 * What still moves is the rider's FEET, by two or three points: the rider
 * stands plumb while the road tilts under them, which is simply true.
 *
 * ⚠️ **The ACTUAL road, not `grade × distance`.** Approaching a crest the local
 * grade is still +8 % while the road 25 m ahead has already flattened;
 * extrapolating the grade would aim the camera at a hill that is not there.
 * `scene.ts` §`cameraPose` reads both heights off the corridor, which is the
 * same profile the road is drawn from, so the camera and the tarmac cannot
 * disagree. At either end of a point-to-point route the corridor clamps, so the
 * two heights are the first or last point's and the gaze settles to level.
 *
 * The heading is horizontal and is the road's own (`scene.ts` §`headingAt`), as
 * it always was.
 */
export function cameraRig(pose: CameraPose): CameraRig {
  return {
    eye: {
      x: pose.x - pose.headingX * CAMERA_BEHIND_METRES,
      y: pose.eyeRoadY + CAMERA_ABOVE_METRES,
      z: pose.z - pose.headingZ * CAMERA_BEHIND_METRES,
    },
    target: {
      x: pose.x + pose.headingX * CAMERA_TARGET_AHEAD_METRES,
      y: pose.targetRoadY,
      z: pose.z + pose.headingZ * CAMERA_TARGET_AHEAD_METRES,
    },
  };
}

/**
 * A rectangle in the frame, as fractions of its width and height from the top left.
 *
 * @test-facing the return type of {@link riderFrameBox}, whose reason applies unchanged.
 */
export interface FrameBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * Where the rider is drawn in a frame of this aspect, on a level road.
 *
 * The rectangle runs from the top of the helmet to where the REAR tyre meets
 * the road, each projected at its own depth through the pitched camera.
 *
 * ⚠️ **At its own depth, and the first version of this function did not.** It
 * projected a box {@link RIDER_HEIGHT_METRES} tall standing at the point the
 * rider is placed at, which is how a marker is usually thought about and is
 * wrong for a camera 4.5 m behind a bicycle 1.7 m long: the rear wheel is half
 * a metre nearer the eye than that point, and the first run of
 * `browser/game.browser.spec.ts` measured the rendered rider ending **4.4
 * points lower in the frame** than the box said. `bicycle.ts`
 * §`BICYCLE_REAR_CONTACT_METRES` is the correction. The width is taken at that
 * nearest depth too, so the box errs wide — which is the safe direction for the
 * first of its two readers.
 *
 * Two things read it, which is why it is a function rather than a comment:
 *
 * - `browser/ride.browser.spec.ts` lays the HUD out at eight viewports and
 *   requires that **no panel is over this rectangle** — so *"anchor to the
 *   edges, keep the centre clear"* (#423) is a measurement about where the
 *   rider actually is, not about where the middle of a diagram is.
 * - `browser/game.browser.spec.ts` renders the real rider through the real
 *   renderer, reads the drawing buffer back, and requires the rider's measured
 *   extent to agree with this — so the arithmetic above is checked against
 *   pixels, and "prominent" cannot drift back to "speck" (#424).
 *
 * | frame | top | bottom | share of height |
 * |---|--:|--:|--:|
 * | 16 : 9, and every frame at least as wide as it is tall | 52.5 % | 79.9 % | **27.3 %** |
 * | a phone upright, 9 : 19.5 | 51.8 % | 70.9 % | 19.1 % |
 *
 * ⚠️ On a level road. {@link cameraRig} holds the rider in nearly the same
 * place on a hill, and `camera.test.ts` says how nearly.
 *
 * ⚠️ **Upright unless `leanRadians` says otherwise — #499.** The camera follows
 * the rider across the road (`scene.ts` §`cameraPose`), so the BICYCLE stays at
 * the middle of the frame on the racing line; what moves is the top of the
 * rider, because the bicycle rolls about its tyres' contact line. At
 * `racing-line.ts` §`MAXIMUM_LEAN_RADIANS` (38.7°) the helmet is 0.95 m to one
 * side, where the upright box allowed 0.2 m. The box widens and does not move
 * down, so it still errs tall (a leaning helmet is lower, not higher):
 *
 * | frame | upright, left → right | at the lean cap |
 * |---|--:|--:|
 * | 16 : 9 | 48.1 % → 51.9 % | **39.3 % → 60.7 %** |
 * | a phone upright, 9 : 19.5 | 44.8 % → 55.2 % | **21.1 % → 78.9 %** |
 *
 * `ride.browser.spec.ts` asks for the box AT THE CAP, because a panel over a
 * leaning rider is over the rider as much as one over an upright rider is —
 * at every overlay viewport but one: at 736 × 360 the corner panels DO cover
 * a rider leaning past about 20°, which is #512, pinned there from the other
 * side so that it cannot be forgotten;
 * `game.browser.spec.ts` compares the rendered rider on a straight, where
 * nobody leans, with the upright box.
 *
 * @test-facing the renderer never needs to know where the rider ended up — three
 * projects them. It is the composition stated as a rectangle, for the two
 * browser gates above to hold the layout and the renderer to.
 */
export function riderFrameBox(aspect: number, leanRadians = 0): FrameBox {
  const t = verticalHalfTangent(aspect);
  const pitch = Math.atan2(CAMERA_ABOVE_METRES, CAMERA_BEHIND_METRES + CAMERA_TARGET_AHEAD_METRES);
  // Depth along the view axis and height above it, for a point `height` metres
  // up and `ahead` metres in front of where the rider is placed. The axis
  // points `pitch` below the horizontal.
  const project = (
    ahead: number,
    height: number,
  ): { readonly ndcY: number; readonly depth: number } => {
    const forward = CAMERA_BEHIND_METRES + ahead;
    const rise = height - CAMERA_ABOVE_METRES;
    const depth = forward * Math.cos(pitch) - rise * Math.sin(pitch);
    const above = forward * Math.sin(pitch) + rise * Math.cos(pitch);
    return { ndcY: above / (depth * t), depth };
  };
  const head = project(RIDER_HELMET_AHEAD_METRES, RIDER_HEIGHT_METRES);
  const foot = project(BICYCLE_REAR_CONTACT_METRES, 0);
  // #499: rolled about the contact line, a point `y` up and `x` across lands
  // `x · cos φ + y · sin φ` across, so the farthest the rider reaches either
  // side is the handlebar's half-width rolled plus the helmet's height rolled.
  // Symmetric, because the rider leans either way; at φ = 0 it is the upright
  // half-width exactly. Projected at the rear wheel's depth like the upright
  // width, which is nearer the eye than the helmet — so it errs wide.
  const lean = Math.abs(leanRadians);
  const reach = RIDER_HALF_WIDTH_METRES * Math.cos(lean) + RIDER_HEIGHT_METRES * Math.sin(lean);
  const halfWidth = reach / (foot.depth * t * aspect);
  return {
    left: 0.5 - halfWidth / 2,
    right: 0.5 + halfWidth / 2,
    top: (1 - head.ndcY) / 2,
    bottom: (1 - foot.ndcY) / 2,
  };
}

/**
 * The least of the frame's height the rider may fill, at {@link REFERENCE_ASPECT}:
 * **a quarter**.
 *
 * #424's first criterion: *"a number, so 'prominent' cannot drift back to
 * 'speck'."* The composition gives 27.3 %; the old one gave 18.1 %, and the
 * most #355's gate leaves room for on the owner's tablet is 20.6 % — this
 * file's header has the table. A quarter is above both and under what ships.
 * `camera.test.ts` holds {@link riderFrameBox} to it, and
 * `browser/game.browser.spec.ts` holds the **rendered** rider to it, read back
 * off the drawing buffer — because the first is arithmetic that could agree
 * with itself over a renderer that draws the rider somewhere else, and on its
 * first run it had.
 *
 * ⚠️ It is a share of frame HEIGHT at 16 : 9 because that is what #424 asks
 * for. A frame taller than it is wide opens the lens
 * ({@link verticalHalfTangent}), so the same rider is a smaller share of a much
 * taller frame — 19.1 % of an upright phone — and a larger share of its width.
 *
 * @test-facing a bound two test suites hold the composition to.
 */
export const MINIMUM_RIDER_FRAME_SHARE = 0.25;
