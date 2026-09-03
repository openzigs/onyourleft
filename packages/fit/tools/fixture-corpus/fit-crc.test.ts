// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { FIT_CRC_REFLECTED_POLYNOMIAL, fitCrc16 } from './fit-crc';

const ascii = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0));

describe('fitCrc16', () => {
  // The CRC catalogue's check value for CRC-16/ARC. If this passes, the
  // implementation is that algorithm and not a near miss — an off-by-one in the
  // reflection or a wrong initial value both produce a different number here.
  it('reproduces the published CRC-16/ARC check value for "123456789"', () => {
    expect(fitCrc16(ascii('123456789'))).toBe(0xbb3d);
  });

  it('is zero over no bytes at all', () => {
    expect(fitCrc16(new Uint8Array(0))).toBe(0);
  });

  it('agrees with the nibble-table form the protocol documentation states', () => {
    // The documentation gives the algorithm as a sixteen-entry nibble table.
    // That table is not copied here (ADR 0006 R3 — numbers may be recorded,
    // expression may not); it is *derived* from the polynomial, which is what
    // makes this a check of the equivalence rather than a restatement of it.
    const table = Array.from({ length: 16 }, (_unused, nibble) => {
      let value = nibble;
      for (let bit = 0; bit < 4; bit += 1) {
        value = (value & 1) === 1 ? (value >>> 1) ^ FIT_CRC_REFLECTED_POLYNOMIAL : value >>> 1;
      }
      return value;
    });
    const nibbleCrc = (bytes: Uint8Array) => {
      let crc = 0;
      for (const byte of bytes) {
        crc = ((crc >>> 4) & 0x0fff) ^ (table[crc & 0xf] ?? 0) ^ (table[byte & 0xf] ?? 0);
        crc = ((crc >>> 4) & 0x0fff) ^ (table[crc & 0xf] ?? 0) ^ (table[(byte >> 4) & 0xf] ?? 0);
      }
      return crc;
    };

    // The first table entry is 0 and the ninth is the polynomial itself, which
    // is the shape a reflected nibble table always has.
    expect(table[0]).toBe(0);
    expect(table[8]).toBe(FIT_CRC_REFLECTED_POLYNOMIAL);

    for (const sample of ['', '.FIT', '123456789', 'the quick brown fox']) {
      expect(nibbleCrc(ascii(sample))).toBe(fitCrc16(ascii(sample)));
    }
  });

  it('detects a single flipped bit anywhere in a message', () => {
    const message = ascii('nominal-outdoor-ride');
    const baseline = fitCrc16(message);
    for (let index = 0; index < message.length; index += 1) {
      for (let bit = 0; bit < 8; bit += 1) {
        const mutated = Uint8Array.from(message);
        mutated[index] = (mutated[index] ?? 0) ^ (1 << bit);
        expect(fitCrc16(mutated)).not.toBe(baseline);
      }
    }
  });

  it('can be seeded, so a file CRC can be taken over the header then the data', () => {
    const header = ascii('header bytes');
    const data = ascii('data bytes');
    const together = Uint8Array.from([...header, ...data]);
    expect(fitCrc16(data, fitCrc16(header))).toBe(fitCrc16(together));
  });

  it('is zero over a message with its own CRC appended, which is why an empty FIT file ends 00 00', () => {
    const message = ascii('.FIT');
    const crc = fitCrc16(message);
    const withCrc = Uint8Array.from([...message, crc & 0xff, (crc >>> 8) & 0xff]);
    expect(fitCrc16(withCrc)).toBe(0);
  });
});
