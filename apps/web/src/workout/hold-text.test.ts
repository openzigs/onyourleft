// SPDX-License-Identifier: AGPL-3.0-or-later

import { beatsPerMinute, expandWorkout, seconds, thresholdShare } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { PRIORITY } from '../game/hud/announce';
import {
  HOLD_QUIET_BEFORE_HARD_END_SECONDS,
  HOLD_SENTENCES,
  HOLD_SPOKEN_EVERY_SECONDS,
  holdAnnouncement,
  holdHudLine,
  holdMayBeSpoken,
  holdReading,
  holdSentence,
  NOTHING_ANNOUNCED,
  type WorkoutHold,
} from './hold-text';

const range = { low: beatsPerMinute(130), high: beatsPerMinute(140) };
const hold = (overrides: Partial<WorkoutHold> = {}): WorkoutHold => ({
  reason: 'lowered',
  range,
  target: 165,
  ...overrides,
});

/**
 * ADR 0048 D-12's banned words, and the ways a number becomes a limit. A
 * sentence about the workout, never about the body; a range the rider chose,
 * never a limit for health or safety.
 */
const BANNED: readonly RegExp[] = [
  /cardiac/i,
  /heart condition/i,
  /rehabilitation/i,
  /patient/i,
  /therapy/i,
  /safe/i,
  /protects? your heart/i,
  /medical/i,
  /clinical/i,
  /limit/i,
  /prevent/i,
  /risk/i,
  /\bFTP\b/,
  /adaptive training/i,
];

describe('the heart-rate hold’s words', () => {
  it('says each reason in one sentence, and says why a hold is off', () => {
    expect(holdSentence(hold())).toBe(
      'Target lowered to keep your heart rate in the range you chose.',
    );
    expect(holdSentence(hold({ reason: 'ineligible', off: 'no-strap' }))).toBe(
      'No heart rate: holding the planned target.',
    );
    expect(holdSentence(hold({ reason: 'ineligible', off: 'thresholds' }))).toBe(
      'Heart-rate hold is off: set your own threshold power and heart rate on the Analysis screen.',
    );
    expect(holdSentence(hold({ reason: 'silent' }))).toContain('No heart rate');
    expect(holdReading(hold())).toBe('Range 130–140 bpm, target 165 W.');
    expect(holdHudLine(hold())).toBe('Hold 130–140 bpm: 165 W');
  });

  it('carries none of ADR 0048 D-12’s banned words, and calls no number a limit', () => {
    for (const sentence of [...HOLD_SENTENCES, holdReading(hold()), holdHudLine(hold())]) {
      for (const word of BANNED) {
        expect(sentence, `"${sentence}" carries ${String(word)}`).not.toMatch(word);
      }
    }
  });
});

describe('when the hold is spoken', () => {
  it('ranks below trainer-lost, workout-fault and erg-held', () => {
    const at = (kind: (typeof PRIORITY)[number]): number => PRIORITY.indexOf(kind);
    expect(at('hold-changed')).toBeGreaterThan(at('trainer-lost'));
    expect(at('hold-changed')).toBeGreaterThan(at('workout-fault'));
    expect(at('hold-changed')).toBeGreaterThan(at('erg-held'));
  });

  it('never on first appearance, then on a change, at most once a minute', () => {
    const lowered = holdSentence(hold());
    const raised = holdSentence(hold({ reason: 'raised' }));
    const first = holdAnnouncement(NOTHING_ANNOUNCED, lowered, 100, undefined);
    expect(first.event).toBeUndefined();

    const changed = holdAnnouncement(first.next, raised, 110, undefined);
    expect(changed.event).toEqual({ kind: 'hold-changed', text: `Heart-rate hold: ${raised}` });

    const tooSoon = holdAnnouncement(
      changed.next,
      lowered,
      110 + HOLD_SPOKEN_EVERY_SECONDS - 1,
      undefined,
    );
    expect(tooSoon.event).toBeUndefined();
    const unchanged = holdAnnouncement(
      tooSoon.next,
      lowered,
      110 + HOLD_SPOKEN_EVERY_SECONDS + 5,
      undefined,
    );
    expect(unchanged.event).toBeUndefined();
    const later = holdAnnouncement(
      unchanged.next,
      raised,
      110 + HOLD_SPOKEN_EVERY_SECONDS + 6,
      undefined,
    );
    expect(later.event?.kind).toBe('hold-changed');
  });

  it('never inside the last 30 s of a hard segment', () => {
    const timeline = expandWorkout({
      name: 'x',
      blocks: [
        { kind: 'steady', seconds: seconds(120), target: thresholdShare(1.05) },
        { kind: 'steady', seconds: seconds(120), target: thresholdShare(0.6) },
      ],
    });
    expect(holdMayBeSpoken(timeline, 120 - HOLD_QUIET_BEFORE_HARD_END_SECONDS - 1)).toBe(true);
    expect(holdMayBeSpoken(timeline, 120 - HOLD_QUIET_BEFORE_HARD_END_SECONDS)).toBe(false);
    expect(holdMayBeSpoken(timeline, 230)).toBe(true);
    const seen = { sentence: holdSentence(hold()), offeredAt: undefined };
    expect(
      holdAnnouncement(seen, holdSentence(hold({ reason: 'raised' })), 500, {
        timeline,
        elapsedSeconds: 100,
      }).event,
    ).toBeUndefined();
  });
});
