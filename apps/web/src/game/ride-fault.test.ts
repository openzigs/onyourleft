// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { modeEndedText, rideFaultLog, rideStoppedText } from './ride-fault';

describe('what a fault in a frame says and logs — #3404', () => {
  it('names every mode it ended, in order', () => {
    expect(modeEndedText(['lap-race'])).toBe(
      'Something went wrong, so the lap race has ended. Your ride goes on.',
    );
    expect(modeEndedText(['delivery', 'ai-pacer'])).toBe(
      'Something went wrong, so the Delivery round and the AI pacer have ended. Your ride goes on.',
    );
    expect(rideFaultLog(['group-ride', 'lap-race', 'delivery'], new Error('x'))).toBe(
      "On Your Left: a fault in the ride's frame (Error) ended the group ride, the lap race and the Delivery round; the ride goes on.",
    );
  });

  it("logs the error's class and never its message, stack or value (ADR 0004 D)", () => {
    const error = new RangeError('latitude 51.501364 is out of range');
    const line = rideFaultLog([], error);
    expect(line).toBe("On Your Left: a fault in the ride's frame (RangeError) stopped the ride.");
    expect(line).not.toContain('51.501364');
    // A thrown value that is not an Error is named by its type alone.
    expect(rideFaultLog([], 51.501364)).toBe(
      "On Your Left: a fault in the ride's frame (number) stopped the ride.",
    );
  });

  it('says the trainer was asked to let go only when this ride was driving one', () => {
    expect(rideStoppedText(true)).toContain('asked to let go');
    expect(rideStoppedText(false)).not.toContain('trainer');
  });
});
