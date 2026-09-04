// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { FitDecodeError } from './errors';

describe('FitDecodeError', () => {
  const error = new FitDecodeError('truncated-record', 923, 'the record is short');

  it('carries the code and the byte offset as values, not only as prose', () => {
    expect(error.code).toBe('truncated-record');
    expect(error.byteOffset).toBe(923);
  });

  /**
   * #30: *"a structured error naming the byte offset"*. The offset is on the
   * instance for a caller and in the text for a rider's bug report, and both
   * halves are asserted because a decoder is usually met through a log line.
   */
  it('names the byte offset in its message', () => {
    expect(error.message).toBe('the record is short (at byte 923)');
    expect(error.message).toContain('923');
  });

  it('is an Error, so it survives a throw and a catch unchanged', () => {
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('FitDecodeError');
    try {
      throw error;
    } catch (caught) {
      expect(caught).toBeInstanceOf(FitDecodeError);
      expect((caught as FitDecodeError).byteOffset).toBe(923);
    }
  });

  it('names byte zero rather than omitting it', () => {
    expect(new FitDecodeError('file-too-short', 0, 'nothing here').message).toContain('at byte 0');
  });
});
