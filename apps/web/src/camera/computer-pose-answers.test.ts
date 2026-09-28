// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the product's own reader makes of answers a vision model on a rider's
 * computer actually gave — #761, from spike 0016 §5.4. Every answer is read by
 * the real `sidePoseFromAnswer`, at the pictures' own shape.
 */

import { describe, expect, it } from 'vitest';

import type { UntrustedText } from './analysis-port';
import { sidePoseFromAnswer } from './computer-pose';
import {
  ISSUE_761_BLANK_ANSWERS,
  ISSUE_761_NOISE_ANSWERS,
  ISSUE_761_RIDER_ANSWERS,
  SPIKE_0016_BLANK_ANSWERS,
  SPIKE_0016_NOISE_ANSWERS,
  SPIKE_0016_RIDER_ANSWERS,
} from './model-answers-testing';
import type { SidePoseOutcome } from './side-analysis-port';

/** The spike's pictures are 256 × 192. */
const ASPECT = 256 / 192;

function outcome(answer: string): string {
  const read: SidePoseOutcome = sidePoseFromAnswer(answer as UntrustedText, ASPECT);
  return read.kind === 'no-rider' ? `no-rider:${read.cause}` : read.kind;
}

function tally(answers: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const answer of answers) {
    const kind = outcome(answer);
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return counts;
}

describe('answers about pictures with nobody in them — #761', () => {
  it('accepts no pose from any of the spike’s blank or noise answers', () => {
    // #553's reader took one blank answer and four noise answers as poses.
    for (const answer of [...SPIKE_0016_BLANK_ANSWERS, ...SPIKE_0016_NOISE_ANSWERS]) {
      expect(outcome(answer), answer).not.toBe('pose');
    }
  });

  it('says WHY each was nobody, which #553’s one outcome could not', () => {
    // Every one of these twelve answers said "rider":true. Four all-null
    // blank answers and two all-null noise answers placed too little; the
    // five that placed a whole rider placed one that could not be one; one
    // blank answer's JSON does not close.
    expect(tally(SPIKE_0016_BLANK_ANSWERS)).toEqual({
      'no-rider:too-few-points': 4,
      'no-rider:implausible': 1,
      unreadable: 1,
    });
    expect(tally(SPIKE_0016_NOISE_ANSWERS)).toEqual({
      'no-rider:too-few-points': 2,
      'no-rider:implausible': 4,
    });
  });

  it('hears nobody said, to #761’s question, about all fourteen blank and noise pictures', () => {
    expect(tally([...ISSUE_761_BLANK_ANSWERS, ...ISSUE_761_NOISE_ANSWERS])).toEqual({
      'no-rider:said-nobody': 14,
    });
  });
});

describe('answers about the drawn rider — what the check costs', () => {
  it('turns away every pose the model placed on it, because none could be a rider', () => {
    // Recorded, not a target. Spike 0016 §5.4 found the head and shoulder
    // never placed where they were drawn; read by the check, fifteen of #553's
    // seventeen accepted poses put the hip ABOVE the shoulder and two the ear
    // below it. To #761's question the model still answers "rider":true for
    // the drawn rider, and five of its seven answers put the hip above the
    // shoulder or the ankle above the hip. So on this evidence a general
    // vision model gives the report nothing, and the report says it could not
    // read the pictures, rather than comparing positions nobody was in.
    expect(tally(SPIKE_0016_RIDER_ANSWERS)).toEqual({
      'no-rider:implausible': 17,
      unreadable: 4,
    });
    expect(tally(ISSUE_761_RIDER_ANSWERS)).toEqual({
      'no-rider:implausible': 5,
      unreadable: 2,
    });
  });
});
