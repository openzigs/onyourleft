// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2616: when a logged decision is in force, by race time alone: from the
 * first 1 s window after it arrived, until the next replaces it or for 5 s;
 * and a late, invalid or failed call applies nothing.
 */

import { describe, expect, it } from 'vitest';

import type { ModelMove } from './decision';
import {
  appliedAtMs,
  MODEL_DECISION_HOLD_MS,
  MODEL_DECISION_LATE_MS,
  movesInForce,
  nextRequestAtMs,
  outcomeFor,
  type LoggedDecision,
} from './decision-log';

const ATTACK: readonly ModelMove[] = [{ bot: 0, move: 'attack' }];
const SIT: readonly ModelMove[] = [{ bot: 0, move: 'sit-in' }];

const entry = (
  requestedAtMs: number,
  arrivedAtMs: number,
  moves: readonly ModelMove[],
  outcome: LoggedDecision['outcome'] = 'decision',
): LoggedDecision => ({ requestedAtMs, arrivedAtMs, outcome, moves });

describe('the decision log (#2616)', () => {
  it('applies a decision at the start of the next window after it arrived, never on it', () => {
    expect(appliedAtMs(2_480)).toBe(3_000);
    expect(appliedAtMs(3_000)).toBe(4_000);
    expect(appliedAtMs(0)).toBe(1_000);
  });

  it('asks again at the next 4 s mark after an answer', () => {
    expect(nextRequestAtMs(6_480)).toBe(8_000);
    expect(nextRequestAtMs(8_000)).toBe(12_000);
  });

  it('books an answer later than 5 s as late, and an unreadable one as invalid', () => {
    expect(outcomeFor(true, MODEL_DECISION_LATE_MS)).toBe('decision');
    expect(outcomeFor(true, MODEL_DECISION_LATE_MS + 1)).toBe('late');
    expect(outcomeFor(false, 100)).toBe('invalid');
    expect(outcomeFor(false, MODEL_DECISION_LATE_MS + 1)).toBe('late');
  });

  it('holds a decision from its window until the next replaces it', () => {
    const log = [entry(4_000, 6_480, ATTACK), entry(8_000, 10_100, SIT)];
    expect(movesInForce(log, 6_950)).toBeUndefined();
    expect(movesInForce(log, 7_000)).toBe(ATTACK);
    expect(movesInForce(log, 10_950)).toBe(ATTACK);
    expect(movesInForce(log, 11_000)).toBe(SIT);
  });

  it('lets a decision lapse after 5 s with none to replace it', () => {
    const log = [entry(4_000, 6_480, ATTACK)];
    expect(movesInForce(log, 7_000 + MODEL_DECISION_HOLD_MS - 50)).toBe(ATTACK);
    expect(movesInForce(log, 7_000 + MODEL_DECISION_HOLD_MS)).toBeUndefined();
  });

  it('applies nothing from a late, invalid or failed call, and keeps the one before in force', () => {
    for (const outcome of ['late', 'invalid', 'failed'] as const) {
      const log = [entry(4_000, 6_480, ATTACK), entry(8_000, 9_100, SIT, outcome)];
      expect(movesInForce(log, 10_000), outcome).toBe(ATTACK);
      expect(movesInForce([entry(0, 100, SIT, outcome)], 1_000), outcome).toBeUndefined();
    }
  });
});
