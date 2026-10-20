// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1435: a reading in words, and when the screen may ask for one. The screen's
 * use of both is `views/DevicesView.shell.test.tsx` §"#1435".
 */

import { describe, expect, it } from 'vitest';

import { idleSnapshot } from './testing';
import { maySignalBeRead, signalWords } from './signal-strength';

describe('signalWords', () => {
  it.each([
    [-40, 'Signal strong'],
    [-70, 'Signal strong'],
    [-71, 'Signal fair'],
    [-85, 'Signal fair'],
    [-86, 'Signal weak — bring the phone closer to it'],
    [-127, 'Signal weak — bring the phone closer to it'],
  ])('%s dBm reads "%s"', (dbm, words) => {
    expect(signalWords(dbm)).toBe(words);
  });
});

describe('maySignalBeRead', () => {
  it('reads with no ride and no control held', () => {
    expect(maySignalBeRead(idleSnapshot())).toBe(true);
  });

  it('reads after a ride has stopped', () => {
    expect(maySignalBeRead({ ...idleSnapshot(), phase: 'stopped' })).toBe(true);
  });

  it.each(['recording', 'paused'] as const)('does not read while a ride is %s', (phase) => {
    expect(maySignalBeRead({ ...idleSnapshot(), phase })).toBe(false);
  });

  it('does not read while this app holds trainer control', () => {
    const idle = idleSnapshot();
    expect(maySignalBeRead({ ...idle, trainer: { ...idle.trainer, hasControl: true } })).toBe(
      false,
    );
  });
});
