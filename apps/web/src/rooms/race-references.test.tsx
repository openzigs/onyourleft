// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A race's result names each of its rows, and its route, by the identifier
 * the instance's notice page takes (#907), so a rider can report ONE row — or
 * the route — and copy the reference from the app.
 */

import { parseModerationItem } from '@onyourleft/domain';
import { afterEach, describe, expect, it } from 'vitest';

import type { RaceResultRow, RoomsPort } from '../net/rooms-port';
import { mount, settle, type Mounted } from '../testing/mount';
import { RACE_REFERENCES_SUMMARY, RaceResult } from './RaceResult';

const ROOM = '0123456789abcdef0123456789abcdef';

const ROWS: readonly RaceResultRow[] = [
  {
    place: 1,
    displayName: 'Ann',
    you: false,
    finishMs: 3_600_000,
    wattsPerKilogram: 4.1,
    flags: [],
  },
  {
    place: 2,
    displayName: null,
    you: false,
    finishMs: 3_700_000,
    wattsPerKilogram: 3.3,
    flags: [],
  },
  { place: null, displayName: 'Me', you: true, finishMs: null, wattsPerKilogram: 2.9, flags: [] },
];

const ROOMS: RoomsPort = {
  create: () => Promise.resolve({ kind: 'unreachable' }),
  join: () => Promise.resolve({ kind: 'refused', reason: 'no-such-room' }),
  start: () => Promise.resolve({ kind: 'started' }),
  results: () => Promise.resolve({ kind: 'result', rows: ROWS }),
};

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

describe('a race result’s references (#907)', () => {
  it('names the route and every row, in the result’s own order, as identifiers the notice page takes', async () => {
    mounted = await mount(
      <RaceResult rooms={ROOMS} roomId={ROOM} finishers={2} ownWatts={undefined} />,
    );
    await settle();
    const details = mounted.container.querySelector('details');
    expect(details?.querySelector('summary')?.textContent).toBe(RACE_REFERENCES_SUMMARY);
    const codes = [...(details?.querySelectorAll('code') ?? [])].map((each) => each.textContent);
    expect(codes).toEqual([
      `route:${ROOM}`,
      `result:${ROOM}:1`,
      `result:${ROOM}:2`,
      `result:${ROOM}:3`,
    ]);
    for (const code of codes) expect(parseModerationItem(code ?? '')).toBeDefined();
  });
});
