// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import {
  currentKeyText,
  KEYS_CLI_COMMANDS,
  olderHeldText,
  ROTATE_CONFIRM_WORD,
  ROTATE_KEY_TEXT,
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
