// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  GAIT_PHASES,
  GAITS,
  STRIDE_PER_HEIGHT,
  gaitPose,
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

  it('lifts a runner clear only in the two flights, and never a walker', () => {
    for (const phase of PHASES) expect(gaitPose('walk', phase).lift).toBe(0);
    expect(gaitPose('run', 0.45).lift).toBeGreaterThan(0.05);
    expect(gaitPose('run', 0.95).lift).toBeGreaterThan(0.05);
    expect(gaitPose('run', 0.2).lift).toBeLessThan(0.005);
  });

  it('strides 1.4 m walking and 2.2 m running at 1.75 m tall', () => {
    expect(STRIDE_PER_HEIGHT.walk * 1.75).toBeCloseTo(1.4, 2);
    expect(STRIDE_PER_HEIGHT.run * 1.75).toBeCloseTo(2.19, 2);
    expect(GAIT_PHASES).toBe(24);
  });
});
