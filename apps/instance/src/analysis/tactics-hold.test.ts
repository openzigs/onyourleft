// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The model slot** (#2709, ADR 0071 D-6.3 and D-6.4): one model race per
 * instance, and a hold that ends when the app says so, after a lapse with no
 * request, or at a fixed ceiling — whichever is first — on a clock the test
 * moves by hand. That held write-ups then run is `tactics-jobs.test.ts`'s.
 */

import { describe, expect, it } from 'vitest';

import { fakeTimers } from './jobs-testing.ts';
import { createRaceHold, TACTICS_HOLD_CEILING_MS, TACTICS_HOLD_LAPSE_MS } from './tactics-hold.ts';

function held(options: { lapseMs?: number; ceilingMs?: number; spentQuietMs?: number } = {}) {
  const timers = fakeTimers();
  const hold = createRaceHold({ now: timers.now, timers: timers.timers, ...options });
  let released = 0;
  hold.onRelease(() => {
    released += 1;
  });
  return { hold, timers, released: () => released };
}

describe('the model slot (#2709, ADR 0071 D-6)', () => {
  it('is one race’s at a time: another athlete is busy until it ends', () => {
    const { hold, released } = held();
    expect(hold.holding()).toBe(false);
    expect(hold.claim('a')).toBe('held');
    expect(hold.holding()).toBe(true);
    expect(hold.claim('a')).toBe('held');
    expect(hold.claim('b')).toBe('busy');
    // Somebody else's end is nothing.
    hold.end('b');
    expect(hold.holding()).toBe(true);
    hold.end('a');
    expect(hold.holding()).toBe(false);
    expect(released()).toBe(1);
    expect(hold.claim('b')).toBe('held');
  });

  it('ends a lapse after the last request, by its timer, with no request to end it', () => {
    const { hold, timers, released } = held();
    hold.claim('a');
    timers.advance(TACTICS_HOLD_LAPSE_MS - 1);
    expect(released()).toBe(0);
    // A claim, and an answer, each start the lapse again.
    hold.claim('a');
    timers.advance(TACTICS_HOLD_LAPSE_MS - 1);
    hold.touch('a');
    timers.advance(TACTICS_HOLD_LAPSE_MS - 1);
    expect(released()).toBe(0);
    expect(hold.holding()).toBe(true);
    timers.advance(1);
    expect(released()).toBe(1);
    expect(hold.holding()).toBe(false);
    expect(timers.pending()).toBe(0);
  });

  it('counts only the holder’s answers as activity', () => {
    const { hold, timers } = held();
    hold.claim('a');
    timers.advance(TACTICS_HOLD_LAPSE_MS - 1);
    hold.touch('b');
    timers.advance(1);
    expect(hold.holding()).toBe(false);
  });

  it('ends at its ceiling however often it is refreshed, and the slot is free to others at once', () => {
    const { hold, timers, released } = held();
    hold.claim('a');
    const step = TACTICS_HOLD_LAPSE_MS / 2;
    for (let at = step; at < TACTICS_HOLD_CEILING_MS; at += step) {
      timers.advance(step);
      expect(hold.claim('a'), `at ${String(at)} ms`).toBe('held');
    }
    expect(released()).toBe(0);
    // The ceiling, from the first claim: the last refresh was half a lapse ago.
    timers.advance(step);
    expect(released()).toBe(1);
    expect(hold.holding()).toBe(false);
    expect(hold.claim('b')).toBe('held');
  });

  it('keeps a ceiling-ended athlete busy while they keep asking, an end included, until they are quiet a whole spent-quiet period, not a lapse', () => {
    const { hold, timers } = held({ lapseMs: 1_000, ceilingMs: 5_000, spentQuietMs: 4_000 });
    hold.claim('a');
    for (let at = 0; at < 5_000; at += 500) {
      timers.advance(500);
      hold.claim('a');
    }
    expect(hold.holding()).toBe(false);
    // Still asking: busy, and an end does not start a fresh ceiling.
    expect(hold.claim('a')).toBe('busy');
    hold.end('a');
    timers.advance(999);
    expect(hold.claim('a')).toBe('busy');
    expect(hold.holding()).toBe(false);
    // Quiet for a lapse is not enough to claim afresh (each busy claim above counts as asking).
    timers.advance(1_000);
    expect(hold.holding()).toBe(false);
    timers.advance(2_999);
    // The busy claim at 999 ms is the last ask: it was quiet 3 999 ms.
    expect(hold.claim('a')).toBe('busy');
    timers.advance(4_000);
    expect(hold.claim('a')).toBe('held');
  });

  it('is a stopped timer after stop', () => {
    const { hold, timers } = held();
    hold.claim('a');
    expect(timers.pending()).toBe(1);
    hold.stop();
    expect(timers.pending()).toBe(0);
  });
});
