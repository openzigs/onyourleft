// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  BODY_SHARE,
  GAITS,
  MOTIONS,
  STILL_POSES,
  STRIDE_PER_HEIGHT,
  gaitPose,
  isGait,
  motionPose,
  sitBlend,
  sitSeatShare,
  stillBlend,
  stillPose,
  wrappedPhase,
  type Gait,
  type LimbAngles,
} from './gait';

const DEGREE = Math.PI / 180;

/** A cycle sampled finely. */
const PHASES = [...Array(200).keys()].map((index) => index / 200);

function series(gait: Gait, read: (limb: LimbAngles) => number): number[] {
  return PHASES.map((phase) => read(gaitPose(gait, phase).left) / DEGREE);
}

function peakAt(values: readonly number[]): number {
  return (PHASES[values.indexOf(Math.max(...values))] as number) ?? Number.NaN;
}

function correlation(a: readonly number[], b: readonly number[]): number {
  const mean = (values: readonly number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
  const ma = mean(a);
  const mb = mean(b);
  let ab = 0;
  let aa = 0;
  let bb = 0;
  a.forEach((value, index) => {
    const other = b[index] as number;
    ab += (value - ma) * (other - mb);
    aa += (value - ma) ** 2;
    bb += (other - mb) ** 2;
  });
  return ab / Math.sqrt(aa * bb);
}

describe('a parametric gait — #1541, the owner’s ruling of 2026-10-24', () => {
  it('is symmetrical: the right side is the left half a cycle on, in both gaits', () => {
    for (const gait of GAITS) {
      for (const phase of PHASES) {
        const now = gaitPose(gait, phase);
        const later = gaitPose(gait, phase + 0.5);
        expect(now.right.hip).toBeCloseTo(later.left.hip, 9);
        expect(now.right.knee).toBeCloseTo(later.left.knee, 9);
        expect(now.right.ankle).toBeCloseTo(later.left.ankle, 9);
        expect(now.right.shoulder).toBeCloseTo(later.left.shoulder, 9);
      }
    }
  });

  it('is a cycle: no jump where the phase wraps, and any real phase is wrapped', () => {
    for (const gait of GAITS) {
      const end = gaitPose(gait, 1 - 1e-7);
      const start = gaitPose(gait, 0);
      for (const key of ['hip', 'knee', 'ankle', 'shoulder', 'elbow'] as const) {
        expect(Math.abs(end.left[key] - start.left[key])).toBeLessThan(1e-4);
      }
      expect(gaitPose(gait, 3.25)).toEqual(gaitPose(gait, 0.25));
      expect(gaitPose(gait, -0.75)).toEqual(gaitPose(gait, 0.25));
    }
    expect(wrappedPhase(-0.25)).toBeCloseTo(0.75, 12);
    expect(wrappedPhase(2)).toBe(0);
  });

  it('bends the knee and the elbow one way only', () => {
    for (const gait of GAITS) {
      for (const phase of PHASES) {
        const pose = gaitPose(gait, phase);
        expect(pose.left.knee).toBeGreaterThanOrEqual(0);
        expect(pose.left.elbow).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('walks as Winter and Perry describe: hip about 30° to −10°, knee peaking near 60° late in swing', () => {
    const hip = series('walk', (limb) => limb.hip);
    expect(Math.max(...hip)).toBeGreaterThan(25);
    expect(Math.max(...hip)).toBeLessThan(35);
    expect(Math.min(...hip)).toBeLessThan(-5);
    expect(Math.min(...hip)).toBeGreaterThan(-15);
    const knee = series('walk', (limb) => limb.knee);
    expect(Math.max(...knee)).toBeGreaterThan(55);
    expect(Math.max(...knee)).toBeLessThan(65);
    expect(peakAt(knee)).toBeGreaterThan(0.65);
    expect(peakAt(knee)).toBeLessThan(0.78);
    // The loading bump: flexed at 15 %, straighter at 40 %.
    expect(gaitPose('walk', 0.15).left.knee / DEGREE).toBeGreaterThan(15);
    expect(gaitPose('walk', 0.4).left.knee / DEGREE).toBeLessThan(10);
    // Toe-off's plantarflexion, about 20°.
    expect(Math.min(...series('walk', (limb) => limb.ankle))).toBeLessThan(-15);
  });

  it('runs as Novacheck describes: a hip range near 60°, the knee near 100° in swing, a forward lean', () => {
    const hip = series('run', (limb) => limb.hip);
    expect(Math.max(...hip) - Math.min(...hip)).toBeGreaterThan(55);
    expect(Math.max(...hip) - Math.min(...hip)).toBeLessThan(65);
    const knee = series('run', (limb) => limb.knee);
    expect(Math.max(...knee)).toBeGreaterThan(90);
    expect(gaitPose('run', 0).lean).toBeGreaterThan(gaitPose('walk', 0).lean);
    // The runner's elbow, near a right angle.
    expect(gaitPose('run', 0.3).left.elbow / DEGREE).toBeGreaterThan(80);
  });

  it('swings each arm against the leg on its own side (Collins et al.)', () => {
    for (const gait of GAITS) {
      const hip = series(gait, (limb) => limb.hip);
      const shoulder = series(gait, (limb) => limb.shoulder);
      expect(correlation(hip, shoulder)).toBeLessThan(-0.95);
    }
  });

  it('carries a runner’s arms: the elbow driven back, the hand up to the chest and in — PR #2844', () => {
    const shoulder = series('run', (limb) => limb.shoulder);
    const elbow = series('run', (limb) => limb.elbow);
    const carry = series('run', (limb) => limb.carry);
    const mean = shoulder.reduce((sum, value) => sum + value, 0) / shoulder.length;
    // The swing is centred behind the trunk: both forearms were held out ahead.
    expect(mean).toBeLessThan(-8);
    expect(Math.min(...shoulder)).toBeLessThan(-30);
    expect(Math.max(...shoulder)).toBeLessThan(18);
    expect(Math.max(...shoulder)).toBeGreaterThan(5);
    // Near a right angle throughout, closing as the hand comes up in front.
    expect(Math.min(...elbow)).toBeGreaterThan(70);
    expect(Math.max(...elbow)).toBeLessThan(110);
    expect(Math.max(...elbow) - Math.min(...elbow)).toBeGreaterThan(20);
    expect(correlation(shoulder, elbow)).toBeGreaterThan(0.95);
    // Turned in, and most with the hand in front — but never across the body.
    expect(Math.min(...carry)).toBeGreaterThanOrEqual(15);
    expect(Math.max(...carry)).toBeLessThanOrEqual(35);
    expect(peakAt(carry)).toBeCloseTo(peakAt(shoulder), 1);
    // A walker's arm hangs: turned in a little, and less than any runner's.
    const walking = series('walk', (limb) => limb.carry);
    expect(Math.min(...walking)).toBeGreaterThan(0);
    expect(Math.max(...walking)).toBeLessThan(Math.min(...carry));
  });

  it('lifts a runner clear only in the two flights, and never a walker', () => {
    for (const phase of PHASES) expect(gaitPose('walk', phase).lift).toBe(0);
    expect(gaitPose('run', 0.45).lift).toBeGreaterThan(0.05);
    expect(gaitPose('run', 0.95).lift).toBeGreaterThan(0.05);
    expect(gaitPose('run', 0.2).lift).toBeLessThan(0.005);
  });

  it('strides 1.4 m walking and 2.2 m running at 1.75 m tall', () => {
    expect(STRIDE_PER_HEIGHT.walk * 1.75).toBeCloseTo(1.4, 2);
    expect(STRIDE_PER_HEIGHT.run * 1.75).toBeCloseTo(2.19, 2);
  });
});

describe('still poses — #3285, written in code as the gaits are', () => {
  it('holds the texture’s order: the gaits, then standing, sitting and clapping', () => {
    expect(MOTIONS).toEqual(['walk', 'run', 'stand', 'sit', 'clap']);
    expect(STILL_POSES.some(isGait)).toBe(false);
    expect(GAITS.every(isGait)).toBe(true);
    // A gait is posed by its gait, a still pose by its own.
    expect(motionPose('walk', 0.3)).toEqual(gaitPose('walk', 0.3));
    expect(motionPose('sit', 0.2)).toEqual(stillPose('sit', 0.2));
  });

  it('blends a still pose to its second row at phase ½ and back, as the shader does', () => {
    expect(stillBlend(0)).toBe(0);
    expect(stillBlend(0.25)).toBeCloseTo(0.5, 12);
    expect(stillBlend(0.5)).toBe(1);
    expect(stillBlend(0.75)).toBeCloseTo(0.5, 12);
    expect(stillBlend(1.25)).toBeCloseTo(0.5, 12);
    for (const pose of STILL_POSES) {
      const there = stillPose(pose, 0.2);
      const back = stillPose(pose, 0.8);
      for (const key of ['hip', 'knee', 'shoulder', 'elbow', 'carry'] as const) {
        expect(there.left[key]).toBeCloseTo(back.left[key], 12);
        expect(there.right[key]).toBeCloseTo(back.right[key], 12);
      }
      expect(there.pelvisTurn).toBeCloseTo(back.pelvisTurn, 12);
    }
  });

  it('keeps every joint inside what a body does at rest: no pose of harm', () => {
    for (const pose of STILL_POSES) {
      for (const phase of PHASES) {
        const at = stillPose(pose, phase);
        expect(at.lift).toBe(0);
        expect(Math.abs(at.lean) / DEGREE).toBeLessThanOrEqual(5);
        for (const limb of [at.left, at.right]) {
          expect(limb.hip / DEGREE).toBeGreaterThanOrEqual(-5);
          expect(limb.hip / DEGREE).toBeLessThanOrEqual(95);
          expect(limb.knee).toBeGreaterThanOrEqual(0);
          expect(limb.knee / DEGREE).toBeLessThanOrEqual(95);
          expect(limb.elbow).toBeGreaterThanOrEqual(0);
          expect(limb.elbow / DEGREE).toBeLessThanOrEqual(100);
          expect(limb.shoulder / DEGREE).toBeGreaterThanOrEqual(0);
          expect(limb.shoulder / DEGREE).toBeLessThanOrEqual(50);
          expect(limb.carry / DEGREE).toBeLessThanOrEqual(60);
        }
      }
    }
  });

  it('stands with the weight shifting from one leg to the other, the arms hanging', () => {
    const first = stillPose('stand', 0);
    const second = stillPose('stand', 0.5);
    expect(first.left.hip).toBeCloseTo(-second.left.hip, 12);
    expect(first.left.hip).toBeCloseTo(-first.right.hip, 12);
    expect(Math.abs(first.left.hip) / DEGREE).toBeGreaterThan(1);
    expect(first.left.shoulder).toBe(0);
  });

  it('claps: forearms raised before the chest, turned in further at phase ½ than at 0', () => {
    const apart = stillPose('clap', 0);
    const together = stillPose('clap', 0.5);
    expect(apart.left.shoulder / DEGREE).toBeGreaterThan(30);
    expect(apart.left.elbow / DEGREE).toBeGreaterThan(80);
    expect(together.left.carry - apart.left.carry).toBeGreaterThan(20 * DEGREE);
    expect(together.left).toEqual(together.right);
  });

  it('sits with the shin vertical, deep in the seat at phase 0 and perched at ½', () => {
    const deep = stillPose('sit', 0);
    const perched = stillPose('sit', 0.5);
    expect(deep.left.hip / DEGREE).toBeCloseTo(90, 9);
    expect(perched.left.hip / DEGREE).toBeCloseTo(70, 9);
    for (const at of [deep, perched]) expect(at.left.knee).toBeCloseTo(at.left.hip, 12);
    // Winter's segments: the knee 0.285 of stature; the seat a popliteal height below the hip.
    expect(BODY_SHARE.ankle + BODY_SHARE.shank).toBeCloseTo(0.285, 9);
    expect(sitSeatShare(0)).toBeCloseTo(0.25, 9);
    expect(sitSeatShare(0.5)).toBeGreaterThan(0.33);
    expect(sitSeatShare(0.25)).toBeCloseTo((sitSeatShare(0) + sitSeatShare(0.5)) / 2, 12);
  });

  it('blends the sit pose to put a sitter’s hips on a seat, whatever their height, inside [0, ½]', () => {
    for (const height of [1.45, 1.55, 1.7, 1.88]) {
      const phase = sitBlend(height, 0.47);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThanOrEqual(0.5);
      expect(sitSeatShare(phase) * height).toBeCloseTo(0.47, 9);
    }
    // Taller than any seat fits, held deep in it; shorter, held perched.
    expect(sitBlend(2.2, 0.47)).toBe(0);
    expect(sitBlend(1.2, 0.47)).toBe(0.5);
  });
});
