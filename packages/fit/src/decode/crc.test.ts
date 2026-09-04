// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { FIT_CRC_INITIAL_VALUE, FIT_CRC_REFLECTED_POLYNOMIAL, fitCrc16 } from './crc';

/**
 * The published check value pins this implementation to CRC-16/ARC without
 * reference to anything of Garmin's: the CRC catalogue defines the check value
 * of an algorithm as its output over the nine ASCII bytes `123456789`, and for
 * CRC-16/ARC that is `0xBB3D`.
 */
const CHECK_INPUT = Uint8Array.from([...'123456789'].map((character) => character.charCodeAt(0)));
const CHECK_VALUE = 0xbb3d;

/**
 * The same function expressed as the sixteen-entry nibble table the public
 * documentation gives, **derived from the polynomial rather than transcribed**
 * — ADR 0006 R3 permits recording the number that describes the wire format
 * and forbids copying anyone's expression of it. If the two disagree, one of
 * them is not CRC-16/ARC.
 */
function nibbleTable(): readonly number[] {
  return Array.from({ length: 16 }, (_unused, nibble) => {
    let value = nibble;
    for (let bit = 0; bit < 4; bit += 1) {
      value = (value & 1) === 1 ? (value >>> 1) ^ FIT_CRC_REFLECTED_POLYNOMIAL : value >>> 1;
    }
    return value & 0xffff;
  });
}

function crcByNibbleTable(input: Uint8Array): number {
  const table = nibbleTable();
  let crc = FIT_CRC_INITIAL_VALUE;
  for (const byte of input) {
    for (const nibble of [byte & 0x0f, (byte >> 4) & 0x0f]) {
      const carry = table[crc & 0x0f] ?? 0;
      crc = (crc >> 4) & 0x0fff;
      crc = crc ^ carry ^ (table[nibble] ?? 0);
    }
  }
  return crc & 0xffff;
}

describe('fitCrc16', () => {
  it('reproduces the published CRC-16/ARC check value', () => {
    expect(fitCrc16(CHECK_INPUT)).toBe(CHECK_VALUE);
  });

  it('agrees with the nibble-table form of the same polynomial', () => {
    for (const length of [0, 1, 2, 7, 16, 255]) {
      const input = Uint8Array.from({ length }, (_unused, index) => (index * 37 + 11) & 0xff);
      expect(fitCrc16(input)).toBe(crcByNibbleTable(input));
    }
  });

  it('is zero over no bytes at all, which is the initial value', () => {
    expect(fitCrc16(new Uint8Array(0))).toBe(FIT_CRC_INITIAL_VALUE);
  });

  it('checksums a range rather than the whole array', () => {
    const padded = Uint8Array.from([0xaa, 0xbb, ...CHECK_INPUT, 0xcc]);
    expect(fitCrc16(padded, 2, 2 + CHECK_INPUT.length)).toBe(CHECK_VALUE);
  });

  it('changes when any byte changes, which is what makes it a check', () => {
    const clean = fitCrc16(CHECK_INPUT);
    for (let index = 0; index < CHECK_INPUT.length; index += 1) {
      const damaged = Uint8Array.from(CHECK_INPUT);
      damaged[index] = (damaged[index] ?? 0) ^ 0x01;
      expect(fitCrc16(damaged)).not.toBe(clean);
    }
  });
});
