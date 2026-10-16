// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A race that is over with no result (#948 N-d): the instance says so apart
 * from "not over yet", and the result panel says there is none — once, with
 * no asking again — rather than telling the rider to come back later for ever.
 * The press path, through the shell, is `rooms-shell.test.tsx`'s.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { RoomsPort } from '../net/rooms-port';
import { mount, settle, type Mounted } from '../testing/mount';
import { RACE_NO_RESULT_TEXT, RaceResult } from './RaceResult';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

describe('a race with no result — #948 N-d', () => {
  it('says so on the first answer, and asks no more', async () => {
    let asks = 0;
    const rooms: RoomsPort = {
      create: () => Promise.resolve({ kind: 'unreachable' }),
      join: () => Promise.resolve({ kind: 'refused', reason: 'no-such-room' }),
      listPublic: () => Promise.resolve({ kind: 'refused', reason: 'no-public-rooms' }),
      joinPublic: () => Promise.resolve({ kind: 'refused', reason: 'no-such-room' }),
      start: () => Promise.resolve({ kind: 'started' }),
      results: () => {
        asks += 1;
        return Promise.resolve({ kind: 'no-result' });
      },
    };
    mounted = await mount(
      <RaceResult
        rooms={rooms}
        roomId="0123456789abcdef0123456789abcdef"
        finishers={2}
        ownWatts={undefined}
        wait={() => Promise.resolve()}
      />,
    );
    await settle();
    expect(mounted.container.textContent).toContain(RACE_NO_RESULT_TEXT);
    expect(mounted.container.querySelector('ol')).toBeNull();
    expect(asks).toBe(1);
  });
});
