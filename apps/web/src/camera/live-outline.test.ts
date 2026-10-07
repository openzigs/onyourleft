// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { LIVE_OUTLINE_BONES, liveOutline } from './live-outline';
import type { SidePose } from './side-analysis-port';

const POSE: SidePose = {
  aspect: 2,
  nearSide: 'left',
  landmarks: [
    { name: 'shoulder', x: 0.4, y: 0.3, visibility: 0.9 },
    { name: 'hip', x: 0.35, y: 0.5, visibility: 0.9 },
    { name: 'knee', x: 0.45, y: 0.7, visibility: 0.9 },
  ],
};

describe('the live outline — #1061, ADR 0044 D-9', () => {
  it('puts each joint where the model put its landmark, in picture heights', () => {
    const { joints } = liveOutline(POSE, 2);
    expect(joints).toStrictEqual([
      { name: 'shoulder', x: 0.8, y: 0.3 },
      { name: 'hip', x: 0.7, y: 0.5 },
      { name: 'knee', x: 0.9, y: 0.7 },
    ]);
  });

  it('joins only landmarks the model kept, leaving a gap rather than inventing one', () => {
    const { bones } = liveOutline(POSE, 2);
    expect(bones).toStrictEqual([
      { x1: 0.8, y1: 0.3, x2: 0.7, y2: 0.5 },
      { x1: 0.7, y1: 0.5, x2: 0.9, y2: 0.7 },
    ]);
  });

  it('draws nothing across the rider: every bone joins two near-side points', () => {
    // The landmark names carry no side: each pose holds the near side only,
    // so no bone can reach the far side (ADR 0030 D-4).
    for (const [from, to] of LIVE_OUTLINE_BONES) {
      expect(from).not.toMatch(/left|right/);
      expect(to).not.toMatch(/left|right/);
    }
  });
});
