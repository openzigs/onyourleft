// SPDX-License-Identifier: AGPL-3.0-or-later

import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { CRANK_AXIS_Y, CRANK_AXIS_Z, CRANK_LENGTH_METRES, legBones } from '../../src/game/bicycle';
import { riderJoints, twoBoneJoint } from './rider';

describe('where the realistic rider’s joints go — #457 (4)', () => {
  it('puts each foot on its own pedal, half a turn apart', () => {
    for (const angle of [0, 0.7, Math.PI / 2, 2, Math.PI, 4.4]) {
      const joints = riderJoints(angle);
      const pedal = (a: number): Vector3 =>
        new Vector3(
          0,
          CRANK_AXIS_Y + CRANK_LENGTH_METRES * Math.cos(a),
          CRANK_AXIS_Z + CRANK_LENGTH_METRES * Math.sin(a),
        );
      expect(joints.foot[0].y).toBeCloseTo(pedal(angle).y, 6);
      expect(joints.foot[0].z).toBeCloseTo(pedal(angle).z, 6);
      expect(joints.foot[1].y).toBeCloseTo(pedal(angle + Math.PI).y, 6);
      expect(joints.foot[1].z).toBeCloseTo(pedal(angle + Math.PI).z, 6);
      // The rider's left (+X) and right (−X) stay on their own sides.
      expect(joints.foot[0].x).toBeGreaterThan(0);
      expect(joints.foot[1].x).toBeLessThan(0);
    }
  });

  it('takes the knee from bicycle.ts rather than inventing one', () => {
    const joints = riderJoints(1.1);
    const thigh = legBones(1.1)[0];
    if (thigh === undefined) throw new Error('no thigh');
    const kneeFromBicycle = new Vector3(
      thigh.x,
      thigh.y + (thigh.length * Math.cos(thigh.pitch)) / 2,
      thigh.z + (thigh.length * Math.sin(thigh.pitch)) / 2,
    );
    expect(joints.knee[0].distanceTo(kneeFromBicycle)).toBeLessThan(1e-9);
    // And the knee is forward of the hip, the way bicycle.ts bends it.
    expect(joints.knee[0].z).toBeGreaterThan(joints.hips.z);
  });

  it('sits the hips behind and below the shoulders, and the hands forward on the bars', () => {
    const joints = riderJoints(0);
    expect(joints.shoulders.y).toBeGreaterThan(joints.hips.y);
    expect(joints.shoulders.z).toBeGreaterThan(joints.hips.z);
    expect(joints.grip[0].z).toBeGreaterThan(joints.shoulders.z);
    expect(joints.grip[0].x).toBeCloseTo(-joints.grip[1].x, 9);
  });
});

describe('the two-bone joint', () => {
  const root = new Vector3(0, 1, 0);

  it('keeps both bones at their lengths', () => {
    const target = new Vector3(0, 0.3, 0.3);
    const joint = twoBoneJoint(root, target, 0.45, 0.45, new Vector3(0, 0, 1));
    expect(joint.distanceTo(root)).toBeCloseTo(0.45, 6);
    expect(joint.distanceTo(target)).toBeCloseTo(0.45, 6);
  });

  it('bends towards the pole, and the other way for the opposite pole', () => {
    const target = new Vector3(0, 0.3, 0);
    expect(twoBoneJoint(root, target, 0.45, 0.45, new Vector3(0, 0, 1)).z).toBeGreaterThan(0);
    expect(twoBoneJoint(root, target, 0.45, 0.45, new Vector3(0, 0, -1)).z).toBeLessThan(0);
  });

  it('straightens rather than breaking when the target is out of reach', () => {
    const joint = twoBoneJoint(root, new Vector3(0, -5, 0), 0.45, 0.45, new Vector3(0, 0, 1));
    expect(joint.distanceTo(root)).toBeCloseTo(0.45, 6);
    expect(Math.abs(joint.z)).toBeLessThan(0.01);
    expect(Number.isFinite(joint.y)).toBe(true);
  });
});
