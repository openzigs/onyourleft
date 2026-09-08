// SPDX-License-Identifier: Apache-2.0

/**
 * The gap to the bot — the arithmetic under #92's fourth criterion.
 *
 * The three cases that are easy to get wrong are all here: the **sign**, the
 * **lap** (two odometers, never wrapped), and the **standstill**, where the
 * time gap does not exist and a zero would be a lie about a division by zero.
 */

import { describe, expect, it } from 'vitest';

import { metres, metresPerSecond } from '../quantities';

import { botIsAhead, gapMagnitudeSeconds, pacerGap } from './gap';

describe('the gap between the rider and the bot', () => {
  it('is positive metres and positive seconds when the bot is ahead', () => {
    const gap = pacerGap({
      botDistance: metres(1200),
      riderDistance: metres(1000),
      referenceSpeed: metresPerSecond(10),
    });
    expect(gap.metres).toBe(200);
    expect(gap.seconds).toBe(20);
    expect(botIsAhead(gap)).toBe(true);
  });

  it('goes negative when the rider is ahead, in both units', () => {
    const gap = pacerGap({
      botDistance: metres(900),
      riderDistance: metres(1000),
      referenceSpeed: metresPerSecond(8),
    });
    expect(gap.metres).toBe(-100);
    expect(gap.seconds).toBe(-12.5);
    expect(botIsAhead(gap)).toBe(false);
  });

  it('reads level as level rather than as behind', () => {
    const gap = pacerGap({
      botDistance: metres(500),
      riderDistance: metres(500),
      referenceSpeed: metresPerSecond(9),
    });
    expect(gap.metres).toBe(0);
    expect(gap.seconds).toBe(0);
    expect(botIsAhead(gap)).toBe(false);
  });

  it('reports a lap as a lap, because neither odometer is wrapped', () => {
    // The behaviour on a loop, and the moment a rider most wants it right: a
    // bot about to lap you is 5 km ahead, not level with you. Wrapping either
    // distance onto the route first — which is what `distanceOnRoute` is for,
    // and it is for a different question — would report zero here.
    const gap = pacerGap({
      botDistance: metres(5200),
      riderDistance: metres(200),
      referenceSpeed: metresPerSecond(10),
    });
    expect(gap.metres).toBe(5000);
    expect(gap.seconds).toBe(500);
  });

  it('has no time gap at all when nothing is moving', () => {
    const gap = pacerGap({
      botDistance: metres(300),
      riderDistance: metres(0),
      referenceSpeed: metresPerSecond(0),
    });
    expect(gap.metres).toBe(300);
    expect(gap.seconds).toBeUndefined();
    expect(gapMagnitudeSeconds(gap)).toBeUndefined();
  });

  it('offers the magnitude for a label that renders the direction itself', () => {
    const behind = pacerGap({
      botDistance: metres(0),
      riderDistance: metres(120),
      referenceSpeed: metresPerSecond(6),
    });
    expect(behind.seconds).toBe(-20);
    expect(gapMagnitudeSeconds(behind)).toBe(20);
  });

  it('measures the rider against a computation and against nobody else', () => {
    // #92's last criterion, at the one place in this issue where a comparison
    // is made at all: the inputs are two distances and a speed. There is no
    // athlete, no ranking and nothing stored — see ADR 0007 D4.
    const input = {
      botDistance: metres(10),
      riderDistance: metres(4),
      referenceSpeed: metresPerSecond(2),
    };
    expect(Object.keys(input).sort()).toEqual(['botDistance', 'referenceSpeed', 'riderDistance']);
    expect(pacerGap(input)).toEqual({ metres: 6, seconds: 3 });
  });
});
