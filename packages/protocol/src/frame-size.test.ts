// SPDX-License-Identifier: Apache-2.0

/**
 * How big a frame is — #768's last criterion, recorded rather than guessed.
 *
 * Spike 0007 measured **709 bytes** for a 50-rider frame of `[id, dm, cm/s]`
 * as JSON. This format carries five slots a rider (draft and flags added for
 * #764 and ADR 0028 D-2 rule 3) and longer top-level names, so it is larger;
 * the figures below are computed from `encodeMessage` itself at a realistic
 * mid-race state and at every slot's bound.
 *
 * ## Is a compact binary encoding worth it? Not now
 *
 * At 1 Hz a 50-rider frame is 1 132 bytes to each of 50 riders: ~57 KB/s out of
 * a room, ~0.45 Mbit/s before WebSocket framing and TCP — the same order as
 * ADR 0037 D-8.3's 0.36 Mbit/s from spike 0013, which is what an operator
 * with a home upload has to budget. A binary frame (u16 id, u32 dm, u16 cm/s,
 * u8 draft, u8 flags = 10 bytes a rider) would be ~0.5 KB, about 2× smaller;
 * `permessage-deflate`, already an operator setting (ADR 0037 D-3), halved
 * outbound bytes in spike 0013 with no second format to keep in agreement.
 * A binary encoding is a second codec, a second fuzz target and a harder
 * thing to debug from a packet capture, for a saving compression already
 * offers. **Not built**; #763 did not ask for one, and #792's many-room hour
 * on the real runtime is what would say the upload binds first.
 */

import { describe, expect, it } from 'vitest';

import { decodeRoomMessage, encodeMessage, utf8ByteLength } from './codec';
import type { Frame } from './messages';
import { MAXIMUM_MESSAGE_BYTES, MAXIMUM_RIDERS } from './schema';

function midRace(count: number): Frame {
  return {
    type: 'frame',
    tick: 1_800,
    ackSequence: 3_599,
    riders: Array.from({ length: count }, (_, index) => ({
      riderId: index + 1,
      // Thirty minutes in, spread over a few hundred metres at 36–43 km/h.
      decimetres: 180_000 + index * 47,
      centimetresPerSecond: 1_000 + ((index * 37) % 200),
      draftPercent: index % 3 === 0 ? 0 : 20 + (index % 15),
      flags: index === 7 ? 1 : 0,
    })),
  };
}

function atEveryBound(count: number): Frame {
  return {
    type: 'frame',
    tick: Number.MAX_SAFE_INTEGER,
    ackSequence: Number.MAX_SAFE_INTEGER,
    riders: Array.from({ length: count }, (_, index) => ({
      riderId: 2_147_483_647 - index,
      decimetres: 1_000_000_000,
      centimetresPerSecond: 10_000,
      draftPercent: 100,
      flags: 3,
    })),
  };
}

describe('frame size — #768', () => {
  it('is 1 132 bytes for 50 riders mid-race', () => {
    const text = encodeMessage(midRace(50));
    expect(utf8ByteLength(text)).toBe(1_132);
  });

  it('fits the largest legal frame inside the byte limit, so a real room is never refused', () => {
    const largest = encodeMessage(atEveryBound(MAXIMUM_RIDERS));
    expect(utf8ByteLength(largest)).toBe(3_682);
    expect(utf8ByteLength(largest)).toBeLessThan(MAXIMUM_MESSAGE_BYTES);
    expect(decodeRoomMessage(largest).ok).toBe(true);
  });
});
