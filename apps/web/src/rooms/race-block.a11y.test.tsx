// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * *Block* on a race's result — #1516: offered on every row another rider's
 * NAME is on and on no other; a press asks first; *Block {name}* sends the
 * row and only the row; the answer takes focus; *Cancel* sends nothing and
 * puts focus back. Audited open and answered. That the instance blocks the
 * rider on that row, and the result reads it back, is
 * `net/rooms-sealed.test.ts` §"#1516".
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import type { RaceBlockAnswer, RaceResultRow, RoomsPort } from '../net/rooms-port';
import { mount, settle, type Mounted } from '../testing/mount';
import { RACE_BLOCK_TEXT, RaceResult } from './RaceResult';

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
  { place: 3, displayName: 'Me', you: true, finishMs: 3_800_000, wattsPerKilogram: 2.9, flags: [] },
  { place: null, displayName: 'Cai', you: false, finishMs: null, wattsPerKilogram: 2.1, flags: [] },
];

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function result(answer: RaceBlockAnswer = { kind: 'blocked' }) {
  const sent: { roomId: string; row: number }[] = [];
  const rooms: RoomsPort = {
    create: () => Promise.resolve({ kind: 'unreachable' }),
    join: () => Promise.resolve({ kind: 'refused', reason: 'no-such-room' }),
    listPublic: () => Promise.resolve({ kind: 'refused', reason: 'no-public-rooms' }),
    joinPublic: () => Promise.resolve({ kind: 'refused', reason: 'no-such-room' }),
    start: () => Promise.resolve({ kind: 'started' }),
    results: () => Promise.resolve({ kind: 'result', rows: ROWS }),
    blockRider: (roomId, row) => {
      sent.push({ roomId, row });
      return Promise.resolve(answer);
    },
  };
  mounted = await mount(
    <main>
      <h1>Game</h1>
      <RaceResult rooms={rooms} roomId={ROOM} finishers={2} ownWatts={undefined} />
    </main>,
  );
  await settle();
  return sent;
}

const text = (element: Element | null | undefined): string =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

const button = (name: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((each) => text(each) === name);

async function press(name: string): Promise<void> {
  const target = button(name);
  expect(target, name).toBeDefined();
  await act(async () => {
    target?.click();
    await Promise.resolve();
  });
  await settle();
}

const audit = (): string => formatViolations(auditAccessibility(document));

describe('Block on a race’s result — #1516', () => {
  it('is offered on every named row of another rider, and not on “a rider” or the rider’s own', async () => {
    await result();
    const blocks = [...document.querySelectorAll('button')]
      .map(text)
      .filter((name) => name.startsWith('Block'));
    expect(blocks).toEqual(['Block Ann', 'Block Cai']);
    // The visible word first, so a voice command of what is seen reaches it (SC 2.5.3).
    expect(button('Block Ann')?.firstChild?.textContent).toBe(RACE_BLOCK_TEXT.open);
    expect(audit()).toBe('');
  });

  it('asks first, then blocks by the row and nothing else, and moves focus to what became of it', async () => {
    const sent = await result();
    await press('Block Cai');
    // Asked, and nothing sent yet.
    expect(sent).toEqual([]);
    expect(document.body.textContent).toContain(RACE_BLOCK_TEXT.question('Cai'));
    expect(text(document.activeElement)).toBe(RACE_BLOCK_TEXT.confirm('Cai'));
    expect(audit()).toBe('');

    await press(RACE_BLOCK_TEXT.confirm('Cai'));
    // Cai's row is the fourth: the row, counted from 1, in the result's own order.
    expect(sent).toEqual([{ roomId: ROOM, row: 4 }]);
    expect(text(document.activeElement)).toBe(RACE_BLOCK_TEXT.answers.blocked('Cai'));
    // Cai's Block is gone; Ann's is untouched.
    expect(button('Block Cai')).toBeUndefined();
    expect(button('Block Ann')).toBeDefined();
    expect(audit()).toBe('');
  });

  for (const [answer, said] of [
    [{ kind: 'refused', reason: 'no-such-room' }, RACE_BLOCK_TEXT.answers.refused],
    [{ kind: 'unreachable' }, RACE_BLOCK_TEXT.answers.unreachable],
  ] as const) {
    it(`says a block was not made — ${answer.kind}, and keeps Block on the row`, async () => {
      const sent = await result(answer);
      await press('Block Ann');
      await press(RACE_BLOCK_TEXT.confirm('Ann'));
      expect(sent).toEqual([{ roomId: ROOM, row: 1 }]);
      expect(text(document.activeElement)).toBe(said);
      expect(button('Block Ann')).toBeDefined();
    });
  }

  it('sends nothing on Cancel, and puts focus back on Block', async () => {
    const sent = await result();
    await press('Block Ann');
    await press(RACE_BLOCK_TEXT.cancel);
    expect(sent).toEqual([]);
    expect(document.body.textContent).not.toContain(RACE_BLOCK_TEXT.question('Ann'));
    expect(document.activeElement).toBe(button('Block Ann'));
  });
});
