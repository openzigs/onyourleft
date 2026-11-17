// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import {
  currentKeyText,
  KEYS_CLI_COMMANDS,
  olderHeldText,
  ROTATE_CONFIRM_WORD,
  ROTATE_KEY_TEXT,
  keyFactRows,
} from './keys';

describe('the Keys section’s words — #2613', () => {
  it('says the rotation needs nobody to pin again, and the word typed is the route’s', () => {
    expect(ROTATE_KEY_TEXT).toContain('nobody needs to pin the card again');
    expect(ROTATE_CONFIRM_WORD).toBe('rotate');
  });

  it('names the three commands that stay on the CLI, and no other', () => {
    expect(KEYS_CLI_COMMANDS.map((each) => each.command.split('instance-key ')[1])).toEqual([
      'rotate --drop-old',
      'rotate-identity',
      'reset',
    ]);
  });

  it('says the current key and the older ones held', () => {
    expect(currentKeyText(7, '2026-11-14 08:00 UTC')).toBe('7, made 2026-11-14 08:00 UTC');
    expect(olderHeldText(0)).toBe('none');
    expect(olderHeldText(2)).toBe('2, each kept 7 days after the next was made');
  });
});

describe('the keys’ facts but the card (#2650)', () => {
  it('says the state, the current key and its rotation, and the older keys — and no card or fingerprint', () => {
    const rows = keyFactRows({
      state: 'ready',
      current: {
        serial: 1_790_000_000,
        createdAt: '2026-10-22T08:00:00.000Z',
        rotatesAt: '2026-11-21T08:00:00.000Z',
      },
      olderHeld: 0,
    });
    expect(rows.map((row) => [row.label, row.value])).toEqual([
      ['State', 'ready'],
      ['Encryption key', '1790000000, made 2026-10-22 08:00 UTC'],
      ['Rotates by itself', '2026-11-21 08:00 UTC'],
      ['Older keys held', 'none'],
    ]);
    expect(
      keyFactRows({ state: 'no-keys', current: null, olderHeld: 0 }).map((row) => row.label),
    ).toEqual(['State', 'Older keys held']);
  });
});
