// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  displayRoomCode,
  newRoomCode,
  normaliseRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_BITS,
  ROOM_CODE_LENGTH,
  roomCodeDigest,
} from './code.ts';

describe('a room code — #784', () => {
  it('carries at least 64 bits: fifteen symbols of five bits each, 75', () => {
    expect(ROOM_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(32);
    expect(ROOM_CODE_BITS).toBe(75);
    expect(ROOM_CODE_BITS).toBeGreaterThanOrEqual(64);
    expect(newRoomCode()).toMatch(
      new RegExp(`^[${ROOM_CODE_ALPHABET}]{${String(ROOM_CODE_LENGTH)}}$`),
    );
  });

  it('spends every random byte, so every symbol of the alphabet is as likely as any other', () => {
    // Every byte value fifteen times over, across 256 codes: each symbol must
    // come out exactly 120 times (256 × 15 / 32). A draw that used fewer bits,
    // or a modulus that did not divide 256, would not.
    const counts = new Map<string, number>();
    let next = 0;
    const counting = (count: number): Uint8Array =>
      Uint8Array.from({ length: count }, () => next++ % 256);
    for (let i = 0; i < (256 * 15) / ROOM_CODE_LENGTH; i += 1) {
      for (const symbol of newRoomCode(counting)) counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
    }
    expect([...counts.keys()].sort().join('')).toBe([...ROOM_CODE_ALPHABET].sort().join(''));
    expect(new Set(counts.values())).toEqual(new Set([(256 * 15) / 32]));
  });

  it('draws from the platform’s random source, not a sequence', () => {
    const codes = new Set(Array.from({ length: 200 }, () => newRoomCode()));
    expect(codes.size).toBe(200);
  });

  it('is shown in three groups of five, and read back however a person types it', () => {
    const code = 'ABCDE0123456789';
    expect(displayRoomCode(code)).toBe('ABCDE-01234-56789');
    expect(normaliseRoomCode('abcde-01234-56789')).toBe(code);
    expect(normaliseRoomCode(' abcde 01234 56789 ')).toBe(code);
    // The letters a person confuses with digits are read as the digits.
    expect(normaliseRoomCode('ABCDE-O1234-567B9')).toBe('ABCDE01234567B9');
    expect(normaliseRoomCode('ABCDE-0I2L4-56789')).toBe('ABCDE01214' + '56789');
  });

  it('refuses what cannot be a code, without guessing at it', () => {
    for (const typed of [
      '',
      'ABCDE-01234-5678',
      'ABCDE-01234-567890',
      'ABCDE-01234-5678U',
      7,
      null,
    ]) {
      expect(normaliseRoomCode(typed)).toBeUndefined();
    }
    expect(normaliseRoomCode('A'.repeat(65))).toBeUndefined();
  });

  it('is stored as its SHA-256, which is not the code', async () => {
    const digest = await roomCodeDigest('ABCDE0123456789');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain('ABCDE');
    expect(await roomCodeDigest('ABCDE0123456789')).toBe(digest);
  });
});
