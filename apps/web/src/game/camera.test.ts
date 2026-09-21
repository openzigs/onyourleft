// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The chase camera's arithmetic — #424, with #423's frame.
 *
 * `camera.ts` makes claims about geometry in prose: how much of the frame the
 * rider fills, where the road shows over their helmet, what a hill does to the
 * frame, what an upright phone sees. #348 → #355 was four passes of tuning
 * against exactly that kind of prose, which nobody had computed. Every figure
 * quoted in that file is asserted here.
 *
 * ⚠️ **The projection below is this file's own**, a twelve-line pinhole camera
 * written from the definition, and deliberately not `riderFrameBox`'s
 * arithmetic rearranged: the point of `camera.ts` §`cameraRig` is that three
 * is handed an eye and a target, so what has to be checked is where things land
 * when an eye and a target are all a projection knows. Whether the *renderer*
 * then agrees is `browser/game.browser.spec.ts`'s, which reads the rider's
 * extent back off the drawing buffer.
 */

import { describe, expect, it } from 'vitest';

import {
  BICYCLE_REAR_CONTACT_METRES,
  RIDER_HEIGHT_METRES,
  RIDER_HELMET_AHEAD_METRES,
} from './bicycle';
import {
  CAMERA_ABOVE_METRES,
  CAMERA_BEHIND_METRES,
  CAMERA_FIELD_OF_VIEW_DEGREES,
  CAMERA_TARGET_AHEAD_METRES,
  FRUSTUM_SPREAD,
  MAXIMUM_FIELD_OF_VIEW_DEGREES,
  MINIMUM_HORIZONTAL_SPREAD,
  MINIMUM_RIDER_FRAME_SHARE,
  NARROWEST_ASPECT,
  REFERENCE_ASPECT,
  WORST_CASE_ASPECT,
  cameraRig,
  horizontalSpread,
  riderFrameBox,
  roadAppearsOverRiderMetres,
  verticalFieldOfViewDegrees,
  verticalHalfTangent,
  type CameraRig,
} from './camera';
import type { CameraPose } from './port';
import { VIEW_AHEAD_METRES } from './terrain';

const tanHalf = (degrees: number): number => Math.tan((degrees / 2) * (Math.PI / 180));

/**
 * A rider at the origin heading +z on a road of constant grade, so the road's
 * height at `along` metres is `grade · along`.
 */
function poseOn(grade: number): CameraPose {
  return {
    x: 0,
    y: 0,
    z: 0,
    headingX: 0,
    headingZ: 1,
    eyeRoadY: grade * -CAMERA_BEHIND_METRES,
    targetRoadY: grade * CAMERA_TARGET_AHEAD_METRES,
  };
}

/**
 * How far down the frame a point lands, 0 at the top and 1 at the bottom, for a
 * camera with no roll looking along +z. A pinhole camera from its definition.
 */
function downTheFrame(rig: CameraRig, along: number, height: number, aspect: number): number {
  const axisZ = rig.target.z - rig.eye.z;
  const axisY = rig.target.y - rig.eye.y;
  const length = Math.hypot(axisZ, axisY);
  const forward = { z: axisZ / length, y: axisY / length };
  // Perpendicular to the axis, in the vertical plane, pointing up.
  const up = { z: -forward.y, y: forward.z };
  const toPoint = { z: along - rig.eye.z, y: height - rig.eye.y };
  const depth = toPoint.z * forward.z + toPoint.y * forward.y;
  const above = toPoint.z * up.z + toPoint.y * up.y;
  return (1 - above / (depth * verticalHalfTangent(aspect))) / 2;
}

/** The rig #424 replaced: a level gaze from behind the rider, whatever the road does. */
function levelGaze(): CameraRig {
  return cameraRig(poseOn(0));
}

describe('the composition — #424', () => {
  it('is lower and closer than the camera it replaced', () => {
    expect(CAMERA_BEHIND_METRES).toBeLessThan(8);
    expect(CAMERA_ABOVE_METRES).toBeLessThan(3);
  });

  it('fills at least a quarter of a 16 : 9 frame’s height with the rider', () => {
    const box = riderFrameBox(REFERENCE_ASPECT);

    expect(box.bottom - box.top).toBeGreaterThanOrEqual(MINIMUM_RIDER_FRAME_SHARE);
    // The figures `camera.ts` quotes.
    expect(box.top).toBeCloseTo(0.525, 3);
    expect(box.bottom).toBeCloseTo(0.799, 3);
    expect(box.bottom - box.top).toBeCloseTo(0.273, 3);
  });

  it('quotes an upright phone correctly too', () => {
    const box = riderFrameBox(9 / 19.5);

    expect(box.top).toBeCloseTo(0.518, 3);
    expect(box.bottom).toBeCloseTo(0.709, 3);
  });

  /**
   * {@link riderFrameBox} for an arbitrary camera on the reference lens family,
   * from the definition — so the two claims below are about cameras that do
   * not ship, which the production function cannot be asked about.
   */
  const shareFor = (behind: number, above: number, fovDegrees: number): number => {
    const pitch = Math.atan2(above, behind + CAMERA_TARGET_AHEAD_METRES);
    const down = (ahead: number, height: number): number => {
      const forward = behind + ahead;
      const rise = height - above;
      return (
        (forward * Math.sin(pitch) + rise * Math.cos(pitch)) /
        ((forward * Math.cos(pitch) - rise * Math.sin(pitch)) * tanHalf(fovDegrees))
      );
    };
    return (
      (down(RIDER_HELMET_AHEAD_METRES, RIDER_HEIGHT_METRES) -
        down(BICYCLE_REAR_CONTACT_METRES, 0)) /
      2
    );
  };

  it('agrees with that definition for the camera that ships', () => {
    const box = riderFrameBox(REFERENCE_ASPECT);

    expect(
      shareFor(CAMERA_BEHIND_METRES, CAMERA_ABOVE_METRES, CAMERA_FIELD_OF_VIEW_DEGREES),
    ).toBeCloseTo(box.bottom - box.top, 10);
  });

  it('would have failed the camera #424 was filed about', () => {
    // ⚠️ The bound's non-vacuity. 8 m back and 3 m up on a 60° lens filled
    // 18.1 % of the frame — "a speck". A minimum the old camera passed would
    // not be a minimum.
    expect(shareFor(8, 3, 60)).toBeCloseTo(0.181, 3);
    expect(shareFor(8, 3, 60)).toBeLessThan(MINIMUM_RIDER_FRAME_SHARE);
  });

  it('is out of reach of any camera on this lens that holds #355’s old gate', () => {
    // ⚠️ `camera.ts`'s header table, asserted. #355 wanted scenery at the verge
    // in shot level with the rider, which pins `B · tan(fov / 2)` at `w / a`.
    // On this lens that is a camera 5.2 m back at 16 : 9, 5.8 m on the owner's
    // tablet and 7.0 m at 4 : 3 — and the rider each of those leaves is under a
    // quarter of the frame. The two requirements do not overlap; one is given
    // up, on purpose, and `three-renderer.test.ts` holds what replaced it.
    const NEAREST_SCENERY_METRES = 6.5;
    const heldBack = (aspect: number): number =>
      NEAREST_SCENERY_METRES / (aspect * tanHalf(CAMERA_FIELD_OF_VIEW_DEGREES));

    const ceilings = [REFERENCE_ASPECT, 16 / 10, 4 / 3].map((aspect) =>
      shareFor(heldBack(aspect), CAMERA_ABOVE_METRES, CAMERA_FIELD_OF_VIEW_DEGREES),
    );

    expect(ceilings[0]).toBeCloseTo(0.232, 3);
    expect(ceilings[1]).toBeCloseTo(0.206, 3);
    expect(ceilings[2]).toBeCloseTo(0.169, 3);
    for (const ceiling of ceilings) {
      expect(ceiling).toBeLessThan(MINIMUM_RIDER_FRAME_SHARE);
    }
  });

  it('follows the first-order law the header states, to within the rear wheel', () => {
    // `h / (2 · B · t)`. The projection is exact and this is not: the law puts
    // the whole rider at the depth they are placed at, and the rear wheel is
    // half a metre nearer. So the law runs about three points LOW — which is
    // the direction that makes the header's argument conservative.
    const law =
      RIDER_HEIGHT_METRES / (2 * CAMERA_BEHIND_METRES * tanHalf(CAMERA_FIELD_OF_VIEW_DEGREES));
    const box = riderFrameBox(REFERENCE_ASPECT);

    expect(box.bottom - box.top - law).toBeGreaterThan(0);
    expect(box.bottom - box.top - law).toBeLessThan(0.04);
  });

  it('agrees with a pinhole camera handed the same eye and target', () => {
    // `riderFrameBox` is closed-form; this is the rig, projected. They are two
    // derivations of one rectangle.
    const rig = cameraRig(poseOn(0));
    const box = riderFrameBox(REFERENCE_ASPECT);

    expect(
      downTheFrame(rig, RIDER_HELMET_AHEAD_METRES, RIDER_HEIGHT_METRES, REFERENCE_ASPECT),
    ).toBeCloseTo(box.top, 6);
    expect(downTheFrame(rig, BICYCLE_REAR_CONTACT_METRES, 0, REFERENCE_ASPECT)).toBeCloseTo(
      box.bottom,
      6,
    );
  });

  it('puts the rider below the middle of the frame and wholly inside it', () => {
    for (const aspect of [
      WORST_CASE_ASPECT,
      REFERENCE_ASPECT,
      16 / 10,
      4 / 3,
      1,
      NARROWEST_ASPECT,
    ]) {
      const box = riderFrameBox(aspect);

      expect(box.top, String(aspect)).toBeGreaterThan(0.5);
      expect(box.bottom, String(aspect)).toBeLessThan(0.9);
      expect(box.left, String(aspect)).toBeGreaterThan(0);
      expect(box.right, String(aspect)).toBeLessThan(1);
      expect(box.right - box.left, String(aspect)).toBeGreaterThan(0);
    }
  });
});

describe('the road over the rider’s helmet — #93 criterion 3', () => {
  /** How far up a rider standing `ahead` metres up a level road the sight line over the helmet passes. */
  const hiddenBelow = (ahead: number): number =>
    CAMERA_ABOVE_METRES -
    ((CAMERA_ABOVE_METRES - RIDER_HEIGHT_METRES) * (ahead + CAMERA_BEHIND_METRES)) /
      CAMERA_BEHIND_METRES;

  it('shows the tarmac from 18.6 m out', () => {
    expect(roadAppearsOverRiderMetres()).toBeCloseTo(18.56, 2);
    // The sight line meets the road exactly there: nothing is hidden beyond it.
    expect(hiddenBelow(roadAppearsOverRiderMetres() - CAMERA_BEHIND_METRES)).toBeCloseTo(0, 10);
  });

  it('has a camera above the helmet, which is the only kind that sees over it', () => {
    // ⚠️ #424's prose floats "shoulder height or below". Directly behind the
    // rider that is a camera that never sees the road over them at ANY distance
    // — the expression has a pole at H = h — and the pacer is behind the
    // rider's back for the whole ride.
    expect(CAMERA_ABOVE_METRES).toBeGreaterThan(RIDER_HEIGHT_METRES);
  });

  it('shows most of a pacer 10 m up a straight road, and all of one at 50 m and 200 m', () => {
    // 10 m: the pacer's wheels are behind the rider and everything above
    // 0.44 m of it is over their shoulder. On any bend at all it is beside them.
    expect(hiddenBelow(10)).toBeCloseTo(0.437, 2);
    expect(hiddenBelow(10)).toBeLessThan(RIDER_HEIGHT_METRES / 3);
    // Negative: the sight line is under the road by then.
    expect(hiddenBelow(50)).toBeLessThan(0);
    expect(hiddenBelow(200)).toBeLessThan(0);
  });
});

describe('how the camera pitches with grade — #424', () => {
  const GRADES = [-0.2, -0.12, 0, 0.12, 0.2];
  /** A pacer's midriff, 50 m up a road of this grade. */
  const pacerDownTheFrame = (rig: CameraRig, grade: number): number =>
    downTheFrame(rig, 50, grade * 50 + RIDER_HEIGHT_METRES / 2, REFERENCE_ASPECT);

  it('stands the eye over the road under the CAMERA, not over the rider', () => {
    // On a 15 % descent the road 4.5 m back is 0.675 m higher than the rider.
    const { eye } = cameraRig(poseOn(-0.15));

    expect(eye.y).toBeCloseTo(0.15 * CAMERA_BEHIND_METRES + CAMERA_ABOVE_METRES, 10);
    expect(eye.z).toBeCloseTo(-CAMERA_BEHIND_METRES, 10);
  });

  it('looks at the road, where the road is', () => {
    const { target } = cameraRig(poseOn(0.12));

    expect(target.y).toBeCloseTo(0.12 * CAMERA_TARGET_AHEAD_METRES, 10);
    expect(target.z).toBeCloseTo(CAMERA_TARGET_AHEAD_METRES, 10);
  });

  it('holds a pacer 50 m ahead in the same place on every grade', () => {
    const onTheFlat = pacerDownTheFrame(cameraRig(poseOn(0)), 0);
    expect(onTheFlat).toBeCloseTo(0.468, 2);

    for (const grade of GRADES) {
      expect(
        Math.abs(pacerDownTheFrame(cameraRig(poseOn(grade)), grade) - onTheFlat),
        `${String(grade * 100)} %`,
      ).toBeLessThan(0.005);
    }
  });

  it('the control — a level gaze puts that pacer behind the rider, or under the HUD', () => {
    // ⚠️ What the case above would pass over if `cameraRig` ignored the two
    // road heights: the rig #424 replaced, on the same hills. On a 20 % descent
    // the pacer is 59.8 % down the frame, which is inside the rider's own body;
    // on a 20 % climb it is at 33.5 %, which is under a landscape phone's top
    // panels. If this stops being true the case above has stopped measuring.
    const rider = riderFrameBox(REFERENCE_ASPECT);

    expect(pacerDownTheFrame(levelGaze(), -0.2)).toBeCloseTo(0.598, 2);
    expect(pacerDownTheFrame(levelGaze(), -0.2)).toBeGreaterThan(rider.top);
    expect(pacerDownTheFrame(levelGaze(), 0.2)).toBeCloseTo(0.335, 2);
  });

  it('holds the rider’s helmet still and lets their feet follow the road', () => {
    const level = cameraRig(poseOn(0));
    for (const grade of GRADES) {
      const rig = cameraRig(poseOn(grade));
      const head = downTheFrame(rig, 0, RIDER_HEIGHT_METRES, REFERENCE_ASPECT);
      const foot = downTheFrame(rig, 0, 0, REFERENCE_ASPECT);

      expect(
        Math.abs(head - downTheFrame(level, 0, RIDER_HEIGHT_METRES, REFERENCE_ASPECT)),
      ).toBeLessThan(0.005);
      // The rider stands plumb while the road tilts, so the feet move — by
      // under four points at 20 %, and never out of the frame.
      expect(Math.abs(foot - downTheFrame(level, 0, 0, REFERENCE_ASPECT))).toBeLessThan(0.04);
      expect(foot).toBeLessThan(0.9);
    }
  });

  it('settles to a level gaze where the corridor has clamped both heights', () => {
    // The first 4.5 m and the last 25 m of a point-to-point route: `scene.ts`
    // reads the first or last point for both, and nothing degenerate follows.
    const rig = cameraRig({ ...poseOn(0), y: 12, eyeRoadY: 12, targetRoadY: 12 });

    expect(rig.eye.y - rig.target.y).toBeCloseTo(CAMERA_ABOVE_METRES, 10);
  });
});

describe('the lens opens as the frame narrows — #423', () => {
  it('is the reference lens on every frame at least as wide as it is tall', () => {
    for (const aspect of [WORST_CASE_ASPECT, 19.5 / 9, REFERENCE_ASPECT, 16 / 10, 4 / 3, 1]) {
      expect(verticalFieldOfViewDegrees(aspect)).toBeCloseTo(CAMERA_FIELD_OF_VIEW_DEGREES, 10);
    }
  });

  it('never sees less to the side than a square frame, until the lens is at its stop', () => {
    // 0.70 is where 90° binds. Between there and square the horizontal view
    // does not move at all.
    for (const aspect of [0.99, 0.9, 0.8, 0.71]) {
      expect(horizontalSpread(aspect)).toBeCloseTo(MINIMUM_HORIZONTAL_SPREAD, 10);
      expect(verticalFieldOfViewDegrees(aspect)).toBeGreaterThan(CAMERA_FIELD_OF_VIEW_DEGREES);
      expect(verticalFieldOfViewDegrees(aspect)).toBeLessThan(MAXIMUM_FIELD_OF_VIEW_DEGREES);
    }
  });

  it('stops at a right angle, and narrows with the frame after that', () => {
    for (const aspect of [0.69, 10 / 16, 9 / 19.5, NARROWEST_ASPECT]) {
      expect(verticalFieldOfViewDegrees(aspect)).toBeCloseTo(MAXIMUM_FIELD_OF_VIEW_DEGREES, 10);
      expect(horizontalSpread(aspect)).toBeCloseTo(aspect, 10);
    }
  });

  it('has no step in it, so a window being resized does not jump', () => {
    let previous = verticalHalfTangent(0.3);
    for (let aspect = 0.3; aspect <= 3; aspect += 0.001) {
      const next = verticalHalfTangent(aspect);
      expect(Math.abs(next - previous)).toBeLessThan(0.005);
      previous = next;
    }
  });

  it('shows an upright phone more than twice what a fixed lens would', () => {
    // ⚠️ Why the policy exists. A fixed 70° on a 9 : 19.5 frame is a 36°
    // horizontal slot; the road is 7 m wide and its edges would be out of shot
    // until 7.7 m ahead of the rider.
    const fixed = (9 / 19.5) * tanHalf(CAMERA_FIELD_OF_VIEW_DEGREES);

    expect((2 * Math.atan(fixed) * 180) / Math.PI).toBeCloseTo(35.8, 0);
    expect((2 * Math.atan(horizontalSpread(9 / 19.5)) * 180) / Math.PI).toBeCloseTo(49.6, 0);
    expect(horizontalSpread(9 / 19.5)).toBeGreaterThan(fixed * 1.4);
  });

  it('quotes the table in `camera.ts` correctly', () => {
    const horizontal = (aspect: number): number =>
      (2 * Math.atan(horizontalSpread(aspect)) * 180) / Math.PI;

    expect(horizontal(19.5 / 9)).toBeCloseTo(113, 0);
    expect(horizontal(REFERENCE_ASPECT)).toBeCloseTo(102, 0);
    expect(horizontal(16 / 10)).toBeCloseTo(96, 0);
    expect(horizontal(4 / 3)).toBeCloseTo(86, 0);
    expect(horizontal(1)).toBeCloseTo(70, 0);
    expect(horizontal(10 / 16)).toBeCloseTo(64, 0);
  });
});

describe('the bounds the cull and the fog rest on', () => {
  it('builds the cull’s spread from the widest frame and the reference lens', () => {
    expect(FRUSTUM_SPREAD).toBeCloseTo(
      WORST_CASE_ASPECT * tanHalf(CAMERA_FIELD_OF_VIEW_DEGREES),
      10,
    );
    // The cull must never be written against a narrower frame than a rider can
    // produce. `theme.css` caps the world at 600vh wide — 6 : 1.
    expect(WORST_CASE_ASPECT).toBeGreaterThan(REFERENCE_ASPECT);
    expect(NARROWEST_ASPECT).toBeLessThan(1);
  });

  it('the fog solve’s premise — the cut end is at least as deep as the solve assumed', () => {
    // `world.ts` solves its density so that something `VIEW_AHEAD_METRES` away
    // is 95 % faded, and means "from the rider". three fogs by depth along the
    // CAMERA's axis. The solve is conservative for as long as the corridor's
    // cut end is at least that deep from the eye — which a camera behind the
    // rider gives it, and a camera moved in front of them would not.
    for (const grade of [-0.15, -0.08, 0, 0.08, 0.15]) {
      const { eye, target } = cameraRig(poseOn(grade));
      const axisZ = target.z - eye.z;
      const axisY = target.y - eye.y;
      const length = Math.hypot(axisZ, axisY);
      const depth =
        ((VIEW_AHEAD_METRES - eye.z) * axisZ + (grade * VIEW_AHEAD_METRES - eye.y) * axisY) /
        length;

      expect(depth, `${String(grade * 100)} %`).toBeGreaterThanOrEqual(VIEW_AHEAD_METRES);
    }
    // The figure `three-renderer.ts` §`FOGGED_OUT_METRES` quotes for the flat.
    const flat = cameraRig(poseOn(0));
    const length = Math.hypot(flat.target.z - flat.eye.z, flat.target.y - flat.eye.y);
    expect(
      ((VIEW_AHEAD_METRES - flat.eye.z) * (flat.target.z - flat.eye.z) +
        (0 - flat.eye.y) * (flat.target.y - flat.eye.y)) /
        length,
    ).toBeCloseTo(403.7, 1);
  });
});
