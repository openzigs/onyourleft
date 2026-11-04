// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { formatModerationItem, parseModerationItem, type ModerationItem } from './moderation-item';

const ROOM = '0123456789abcdef0123456789abcdef';

describe('a moderation item’s identifier (#907)', () => {
  const items: readonly [string, ModerationItem][] = [
    [`room:${ROOM}`, { kind: 'room', roomId: ROOM }],
    [`route:${ROOM}`, { kind: 'route', roomId: ROOM }],
    [`result:${ROOM}:12`, { kind: 'result', roomId: ROOM, row: 12 }],
  ];

  it.each(items)('reads %s, and writes it back the same', (text, item) => {
    expect(parseModerationItem(text)).toEqual(item);
    expect(parseModerationItem(`  ${text}\n`)).toEqual(item);
    expect(formatModerationItem(item)).toBe(text);
  });

  it.each([
    '',
    // A display name is not an item a notice can name (#1381): the app never holds
    // another rider's athlete id, so no screen shows one.
    'rider:athlete_A-1',
    'rider:',
    'room:0123',
    `room:${ROOM.toUpperCase()}`,
    `route:${ROOM}x`,
    `result:${ROOM}`,
    `result:${ROOM}:0`,
    `result:${ROOM}:01`,
    `result:${ROOM}:10000`,
    `name:${ROOM}`,
    `https://example.com/room:${ROOM}`,
  ])('refuses %j', (text) => {
    expect(parseModerationItem(text)).toBeUndefined();
  });
});
