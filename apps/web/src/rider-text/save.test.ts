// SPDX-License-Identifier: AGPL-3.0-or-later

/** What *Save* does with the goals or a ride's note (#836). */

import { MAXIMUM_GOALS_CHARACTERS, MAXIMUM_RIDE_NOTE_CHARACTERS } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { riderTextLength, saveRiderText } from './save';
import { memoryRiderText } from './testing';

describe('saving the goals or a note (#836)', () => {
  it('writes the tidied text and answers what landed', async () => {
    const memory = memoryRiderText();
    const outcome = await saveRiderText(memory.port, 'goal', 'goals', '  A century.\r\n');
    expect(outcome).toMatchObject({ kind: 'saved', record: { text: 'A century.' } });
    expect(memory.kept.get('goal|goals')?.text).toBe('A century.');
  });

  it('deletes the text when the box is emptied', async () => {
    const memory = memoryRiderText();
    await saveRiderText(memory.port, 'note', 'ride-1', 'Windy.');
    await expect(saveRiderText(memory.port, 'note', 'ride-1', '  \n ')).resolves.toStrictEqual({
      kind: 'cleared',
    });
    expect(memory.kept.has('note|ride-1')).toBe(false);
    expect(memory.calls).toContain('deleteRiderText');
  });

  it('refuses over the limit before writing anything, and leaves the saved text alone', async () => {
    const memory = memoryRiderText();
    await saveRiderText(memory.port, 'note', 'ride-1', 'Windy.');
    const calls = memory.calls.length;
    await expect(
      saveRiderText(memory.port, 'note', 'ride-1', 'x'.repeat(MAXIMUM_RIDE_NOTE_CHARACTERS + 1)),
    ).resolves.toStrictEqual({ kind: 'too-long', maximum: MAXIMUM_RIDE_NOTE_CHARACTERS });
    expect(memory.calls.length).toBe(calls);
    expect(memory.kept.get('note|ride-1')?.text).toBe('Windy.');
    await expect(
      saveRiderText(memory.port, 'goal', 'goals', 'x'.repeat(MAXIMUM_GOALS_CHARACTERS)),
    ).resolves.toMatchObject({ kind: 'saved' });
  });

  it('answers a failed write with its reason', async () => {
    const memory = memoryRiderText();
    memory.failNext = new Error('the disk is full');
    await expect(saveRiderText(memory.port, 'goal', 'goals', 'A century.')).resolves.toStrictEqual({
      kind: 'failed',
      reason: 'the disk is full',
    });
  });

  it('counts what would be kept, not the white space around it', () => {
    expect(riderTextLength('  ab\r\n ')).toBe(2);
  });
});
