// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Which rule rejects each answer a model actually gave** — #813, as #808's
 * review asked: count it, rather than trust a comment's claimed evidence.
 *
 * Every saved answer in `model-answers-testing.ts` that parses and places the
 * whole chain `pose-plausibility.ts` reads is handed to `implausibility`, and
 * the first rule it fails is tallied. `computer-pose-answers.test.ts` says
 * what the product's reader makes of the same answers; this file says which
 * geometric rule did it, which that reader deliberately does not report.
 */

import { describe, expect, it } from 'vitest';

import {
  ISSUE_761_RIDER_ANSWERS,
  SPIKE_0016_BLANK_ANSWERS,
  SPIKE_0016_NOISE_ANSWERS,
  SPIKE_0016_RIDER_ANSWERS,
} from './model-answers-testing';
import { implausibility, MAXIMUM_KNEE_OPENING_COSINE } from './pose-plausibility';
import type { SidePose, SidePoseLandmark, SidePoseMark } from './side-analysis-port';

/** The spike's pictures are 256 × 192. */
const ASPECT = 256 / 192;

/**
 * The points an answer gave, or a word for why there are none. Deliberately
 * NOT the product's reader, which keeps no pose it refuses: a fence is taken
 * off and the JSON parsed, and nothing else is checked.
 */
function pointsOf(answer: string): SidePose | 'unreadable' | 'said-nobody' {
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer.replace(/^```json\n/, '').replace(/\n```$/, '')) as unknown;
  } catch {
    return 'unreadable';
  }
  const { rider, landmarks } = parsed as {
    rider: boolean;
    landmarks?: Record<string, [number, number] | null>;
  };
  if (rider !== true || landmarks === undefined) {
    return 'said-nobody';
  }
  const marks: SidePoseMark[] = Object.entries(landmarks).flatMap(([name, point]) =>
    point === null
      ? []
      : [{ name: name as SidePoseLandmark, x: point[0], y: point[1], visibility: 1 }],
  );
  return { aspect: ASPECT, nearSide: 'left', landmarks: marks };
}

function firstRule(answer: string): string {
  const points = pointsOf(answer);
  return typeof points === 'string' ? points : (implausibility(points) ?? 'plausible');
}

function tally(answers: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const answer of answers) {
    const rule = firstRule(answer);
    counts[rule] = (counts[rule] ?? 0) + 1;
  }
  return counts;
}

describe('which rule rejects each saved answer — #813', () => {
  it('blank pictures: shoulder-below-hip rejects the one whole chain; the answer #761 cited does not parse', () => {
    expect(tally(SPIKE_0016_BLANK_ANSWERS)).toEqual({
      'missing-landmark': 4,
      'shoulder-below-hip': 1,
      unreadable: 1,
    });
    // The pose the knee rule's comment used to cite, opening at about 174°:
    // its last landmark is `[0.58,1.0}`, so it never reaches the rules.
    expect(firstRule(SPIKE_0016_BLANK_ANSWERS[2] ?? '')).toBe('unreadable');
  });

  it('noise pictures: shoulder-below-hip rejects all four whole chains', () => {
    expect(tally(SPIKE_0016_NOISE_ANSWERS)).toEqual({
      'missing-landmark': 2,
      'shoulder-below-hip': 4,
    });
  });

  it('the drawn rider: the order rules reject every one, and the knee and proportion rules none', () => {
    expect(tally(SPIKE_0016_RIDER_ANSWERS)).toEqual({
      'shoulder-below-hip': 15,
      'head-below-shoulder': 2,
      unreadable: 4,
    });
    expect(tally(ISSUE_761_RIDER_ANSWERS)).toEqual({
      'shoulder-below-hip': 4,
      'ankle-above-hip': 1,
      unreadable: 2,
    });
  });

  it('the knee rule catches a saved noise answer once its trunk is put the right way up', () => {
    // Noise answer 3 draws hip, knee and ankle almost on one line down the
    // picture (about 175°) and its shoulder below its hip, which is what
    // rejects it. Lift the shoulder above the hip and nothing but the knee
    // rule stands in the way: the failure it guards against, from a real answer.
    const answer = pointsOf(SPIKE_0016_NOISE_ANSWERS[3] ?? '');
    if (typeof answer === 'string') {
      throw new Error('noise answer 3 no longer parses');
    }
    const lifted: SidePose = {
      ...answer,
      landmarks: answer.landmarks.map((mark) =>
        mark.name === 'shoulder' ? { ...mark, x: 0.45, y: 0.1 } : mark,
      ),
    };
    expect(implausibility(lifted)).toBe('knee-straight');
    expect(MAXIMUM_KNEE_OPENING_COSINE).toBeLessThan(-0.98);
  });
});
