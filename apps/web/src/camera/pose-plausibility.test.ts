// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Whether a pose could be a person on a bicycle — #761. Each rule is broken
 * on its own, from a pose every rule passes, so deleting any one rule turns
 * exactly its case red.
 */

import { describe, expect, it } from 'vitest';

import {
  EAR_BELOW_SHOULDER_TOLERANCE,
  implausibility,
  LIMB_RATIO_BOUNDS,
  MAXIMUM_KNEE_OPENING_COSINE,
  PLAUSIBILITY_LANDMARKS,
} from './pose-plausibility';
import type { SidePose, SidePoseLandmark } from './side-analysis-port';

/**
 * The rider spike 0016 §5.2 drew, as shares of its 256 × 192 picture: the
 * pixel each landmark was drawn at (`make_frames.py`, inlined in the spike's
 * §5.5) over the picture's size. The ear is the head's centre.
 */
const DRAWN: Readonly<Record<SidePoseLandmark, readonly [number, number]>> = {
  ear: [169 / 256, 43 / 192],
  shoulder: [160 / 256, 55 / 192],
  elbow: [172 / 256, 75 / 192],
  wrist: [186 / 256, 90 / 192],
  hip: [105 / 256, 85 / 192],
  knee: [135 / 256, 110 / 192],
  ankle: [128 / 256, 150 / 192],
  heel: [122 / 256, 152 / 192],
  toe: [142 / 256, 152 / 192],
};

const ASPECT = 256 / 192;

function pose(
  changes: Partial<Record<SidePoseLandmark, readonly [number, number] | null>> = {},
  aspect = ASPECT,
): SidePose {
  const merged = { ...DRAWN, ...changes };
  return {
    aspect,
    nearSide: 'right',
    landmarks: (Object.keys(merged) as SidePoseLandmark[]).flatMap((name) => {
      const point = merged[name];
      return point === null ? [] : [{ name, x: point[0], y: point[1], visibility: 1 }];
    }),
  };
}

describe('pose plausibility — #761', () => {
  it('passes the rider the spike drew, and the same rider without the points it needs no rule for', () => {
    expect(implausibility(pose())).toBeUndefined();
    expect(
      implausibility(pose({ ear: null, elbow: null, wrist: null, heel: null, toe: null })),
    ).toBeUndefined();
  });

  it('passes the same rider facing the other way', () => {
    const mirrored: Partial<Record<SidePoseLandmark, readonly [number, number]>> = {};
    for (const name of Object.keys(DRAWN) as SidePoseLandmark[]) {
      mirrored[name] = [1 - DRAWN[name][0], DRAWN[name][1]];
    }
    expect(implausibility(pose(mirrored))).toBeUndefined();
  });

  it.each(PLAUSIBILITY_LANDMARKS)('refuses to check a pose with no %s', (name) => {
    expect(implausibility(pose({ [name]: null }))).toBe('missing-landmark');
  });

  it('refuses a segment whose two ends are one point', () => {
    expect(implausibility(pose({ knee: DRAWN.hip }))).toBe('points-coincide');
  });

  /** The drawn rider's trunk, shoulder to hip, in shares of the picture's height. */
  const TRUNK = Math.hypot(
    (DRAWN.shoulder[0] - DRAWN.hip[0]) * ASPECT,
    DRAWN.shoulder[1] - DRAWN.hip[1],
  );

  it('refuses a head well below the shoulder, and passes one just inside the tolerance', () => {
    const below = (trunks: number) =>
      pose({ ear: [DRAWN.ear[0], DRAWN.shoulder[1] + trunks * TRUNK] });
    expect(implausibility(below(EAR_BELOW_SHOULDER_TOLERANCE + 0.02))).toBe('head-below-shoulder');
    expect(implausibility(below(EAR_BELOW_SHOULDER_TOLERANCE - 0.02))).toBeUndefined();
    expect(EAR_BELOW_SHOULDER_TOLERANCE).toBe(0.25);
  });

  it('passes a rider on aerobars, head level with the shoulders and the ear a few pixels under — #813', () => {
    // The drawn rider's legs, with the trunk laid almost flat along the top
    // tube and the head tucked between the shoulders: the ear 2 px below the
    // shoulder in the spike's 256 × 192 picture.
    const aero = pose({
      shoulder: [165 / 256, 72 / 192],
      ear: [178 / 256, 74 / 192],
      elbow: [168 / 256, 88 / 192],
      wrist: [190 / 256, 88 / 192],
    });
    expect(implausibility(aero)).toBeUndefined();
    // The same rider with the head dropped to the elbows is not a rider.
    expect(
      implausibility({
        ...aero,
        landmarks: aero.landmarks.map((mark) =>
          mark.name === 'ear' ? { ...mark, y: 88 / 192 } : mark,
        ),
      }),
    ).toBe('head-below-shoulder');
  });

  it('refuses a shoulder below the hip — the order the spike’s hallucinations broke', () => {
    expect(
      implausibility(pose({ ear: null, shoulder: [DRAWN.shoulder[0], DRAWN.hip[1] + 0.05] })),
    ).toBe('shoulder-below-hip');
  });

  it('refuses an ankle above the hip', () => {
    // The knee goes above both so that only the hip rule is broken first.
    expect(
      implausibility(
        pose({
          knee: [DRAWN.knee[0], DRAWN.hip[1] - 0.2],
          ankle: [DRAWN.ankle[0], DRAWN.hip[1] - 0.05],
        }),
      ),
    ).toBe('ankle-above-hip');
  });

  it('refuses an ankle above the knee, with both below the hip', () => {
    expect(
      implausibility(pose({ knee: [DRAWN.knee[0], 0.75], ankle: [DRAWN.knee[0] - 0.05, 0.62] })),
    ).toBe('ankle-above-knee');
  });

  it('refuses a leg straight from hip to ankle, and passes one just inside the bound', () => {
    // Hip, knee and ankle on one line: the straight line a hallucination draws.
    const straight = pose({
      hip: [0.4, 0.4],
      knee: [0.4 + 0.2 / ASPECT, 0.6],
      ankle: [0.4 + 0.4 / ASPECT, 0.8],
    });
    expect(implausibility(straight)).toBe('knee-straight');
    // A knee pushed forward far enough to open the leg to about 165°.
    const bent = pose({
      hip: [0.4, 0.4],
      knee: [0.4 + 0.2 / ASPECT + 0.02 / ASPECT, 0.6 - 0.02],
      ankle: [0.4 + 0.4 / ASPECT, 0.8],
    });
    expect(implausibility(bent)).toBeUndefined();
    expect(MAXIMUM_KNEE_OPENING_COSINE).toBeCloseTo(Math.cos((170 * Math.PI) / 180), 12);
  });

  it('refuses a thigh far longer than the shin, and a trunk far shorter than the thigh', () => {
    // Thigh 0.3 down, shin 0.1: 3 to 1, over the bound of 2.
    expect(
      implausibility(
        pose({
          hip: [0.4, 0.3],
          knee: [0.52, 0.6],
          ankle: [0.5, 0.7],
          shoulder: [0.6, 0.02],
          ear: null,
        }),
      ),
    ).toBe('out-of-proportion');
    // A trunk a fifth of the thigh.
    expect(
      implausibility(pose({ shoulder: [DRAWN.hip[0] + 0.02, DRAWN.hip[1] - 0.02], ear: null })),
    ).toBe('out-of-proportion');
    expect(LIMB_RATIO_BOUNDS.thighOverShin.highest).toBe(2);
  });

  it('measures across and down in the same unit, so the picture’s shape matters', () => {
    // A thigh drawn across the picture and a shin drawn down it, each 0.25 of
    // its own axis: equal as shares, 1.78 to 1 on a 16 : 9 picture.
    const across = pose(
      { ear: null, shoulder: [0.05, 0.1], hip: [0.2, 0.5], knee: [0.45, 0.55], ankle: [0.44, 0.8] },
      16 / 9,
    );
    expect(implausibility(across)).toBeUndefined();
    // The same shares on a picture four times as wide as it is tall: 4 to 1.
    expect(implausibility({ ...across, aspect: 4 })).toBe('out-of-proportion');
  });
});
