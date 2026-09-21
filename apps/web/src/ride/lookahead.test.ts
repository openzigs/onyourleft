// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The lookahead arithmetic — #398. Pure, so a plain `*.test.ts`; what the
 * rider is told through the region is `workout-lookahead.a11y.test.tsx`.
 */

import { expandWorkout, seconds, thresholdShare, type WorkoutBlock } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { upcomingBlock } from './lookahead';

const blocks: readonly WorkoutBlock[] = [
  { kind: 'steady', seconds: seconds(600), target: thresholdShare(0.6) },
  { kind: 'steady', seconds: seconds(300), target: thresholdShare(0.95) },
  { kind: 'steady', seconds: seconds(300), target: thresholdShare(0.5) },
];
const TIMELINE = expandWorkout({ name: 'Test', blocks });
const LEAD = 10;

describe('the lookahead — #398', () => {
  it('says the next block at T − N, and not a moment before', () => {
    expect(upcomingBlock(TIMELINE, 600 - LEAD - 0.1, LEAD)).toBeUndefined();
    expect(upcomingBlock(TIMELINE, 600 - LEAD, LEAD)).toEqual({
      boundary: 600,
      sentence: 'In 10 seconds: harder — 5 minutes at 95 percent of your threshold.',
    });
  });

  it('tells a target going UP from one going DOWN, in different words', () => {
    const up = upcomingBlock(TIMELINE, 595, LEAD)?.sentence ?? '';
    const down = upcomingBlock(TIMELINE, 895, LEAD)?.sentence ?? '';
    expect(up).toContain('harder');
    expect(down).toContain('easier');
    expect(up.split(':')[1]?.split('—')[0]).not.toBe(down.split(':')[1]?.split('—')[0]);
  });

  it('announces the END at the last block, never a phantom next one', () => {
    const last = upcomingBlock(TIMELINE, 1200 - LEAD, LEAD);
    expect(last?.sentence).toBe('In 10 seconds, the workout ends.');
    expect(last?.sentence).not.toMatch(/percent|harder|easier/);
  });

  it('keys each change by its boundary, so a caller can say it once', () => {
    const early = upcomingBlock(TIMELINE, 591, LEAD);
    const late = upcomingBlock(TIMELINE, 598, LEAD);
    expect(early?.boundary).toBe(late?.boundary);
  });

  it('never speaks a watt figure — the next target has not been acknowledged', () => {
    for (const at of [595, 895, 1195]) {
      expect(upcomingBlock(TIMELINE, at, LEAD)?.sentence).not.toMatch(/\bW\b|watt/i);
    }
  });

  it('says nothing past the end', () => {
    expect(upcomingBlock(TIMELINE, 1200, LEAD)).toBeUndefined();
  });
});
