// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import {
  END_ROOM_CONFIRM_TEXT,
  endRoomTypeText,
  ROOM_END_REASON_TEXT,
  ROOM_END_REASONS,
  ROOM_KIND_TEXT,
  ROOM_PHASE_TEXT,
  ridersText,
} from './rooms';

describe('the Rooms section’s words — #2612', () => {
  it('says who is in a room by name, and an unnamed rider as “a rider”', () => {
    expect(ridersText([])).toBe('Nobody is in it.');
    expect(ridersText(['Ann'])).toBe('1 rider: Ann.');
    expect(ridersText(['Ann', 'Bea'])).toBe('2 riders: Ann and Bea.');
    expect(ridersText(['Ann', null, 'Cal'])).toBe('3 riders: Ann, a rider and Cal.');
    expect(ridersText([null])).toBe('1 rider: a rider.');
  });

  it('names every kind, phase and reason the instance writes', () => {
    expect(Object.keys(ROOM_KIND_TEXT)).toEqual(['group', 'race', 'lap-race']);
    expect(Object.keys(ROOM_PHASE_TEXT)).toEqual(['lobby', 'countdown', 'riding', 'finished']);
    expect(Object.keys(ROOM_END_REASON_TEXT)).toEqual([...ROOM_END_REASONS]);
  });

  it('says what ending does to a rider: alone, recording, and no trainer touched', () => {
    expect(END_ROOM_CONFIRM_TEXT).toContain('riding on their own');
    expect(END_ROOM_CONFIRM_TEXT).toContain('keeps recording');
    expect(END_ROOM_CONFIRM_TEXT).toContain('nothing is sent to anyone’s trainer');
    expect(endRoomTypeText('a1b2c3')).toBe('To end it, type the room’s code, a1b2c3.');
  });
});
