// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A private lap race on the room panel — #1912: offered on a loop, its laps
 * and items sent as chosen, never listed, refused in words on a route that is
 * not a loop, said to the rider in it — and every state audited.
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { circuitRoute } from '../game/route-fixtures-testing';
import type { EnteredRoom, RoomsPort } from '../net/rooms-port';
import { mount, settle, type Mounted } from '../testing/mount';
import { RaceResult } from './RaceResult';
import { ROOM_LAP_RACE_TEXT, RoomPanel, type RoomPanelProps } from './RoomPanel';
import { northProfile } from './rooms-testing';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const LOOP = { id: 'loop', name: 'Round the park', profile: circuitRoute(60) };
const OUT_AND_BACK = { id: 'line', name: 'Up the hill', profile: northProfile(1_000) };

type Asked = Parameters<RoomsPort['create']>[0];

function rooms(asked: Asked[]): RoomsPort {
  return {
    create: (request) => {
      asked.push(request);
      return Promise.resolve({
        kind: 'created',
        room: {
          roomId: 'room-lap',
          kind: request.kind,
          ridingPosition: request.ridingPosition,
          drafting: request.drafting,
          code: 'ABCDE-FGHJK-MNPQR',
          madeIt: true,
          ...(request.lapRace === undefined ? {} : { lapRace: request.lapRace }),
          profile: LOOP.profile,
          routeSha256: 'a'.repeat(64),
        },
      });
    },
    join: () => Promise.resolve({ kind: 'refused', reason: 'no-such-room' }),
    listPublic: () => Promise.resolve({ kind: 'refused', reason: 'no-public-rooms' }),
    joinPublic: () => Promise.resolve({ kind: 'refused', reason: 'no-such-room' }),
    start: () => Promise.resolve({ kind: 'started' }),
    results: () => Promise.resolve({ kind: 'unreachable' }),
    blockRider: () => Promise.resolve({ kind: 'unreachable' }),
    noticePage: () => undefined,
  };
}

function panel(overrides: Partial<RoomPanelProps>): RoomPanelProps {
  return {
    rooms: rooms([]),
    routes: [LOOP, OUT_AND_BACK],
    weightDeclared: true,
    position: 'hoods',
    entered: undefined,
    onEnter: () => undefined,
    onRide: () => undefined,
    ...overrides,
  };
}

function audit(): void {
  const violations = auditAccessibility(document);
  expect(violations, formatViolations(violations)).toEqual([]);
}

async function shown(props: RoomPanelProps): Promise<void> {
  mounted = await mount(
    <main>
      <h1>Game</h1>
      <RoomPanel {...props} />
    </main>,
  );
  await settle();
  audit();
}

async function click(element: Element | null | undefined): Promise<void> {
  expect(element).toBeTruthy();
  await act(async () => {
    (element as HTMLElement).click();
    await Promise.resolve();
  });
  await settle();
}

function labelled(words: string): HTMLInputElement | undefined {
  return [...document.querySelectorAll<HTMLInputElement>('input')].find((each) =>
    (each.closest('label')?.textContent ?? '').startsWith(words),
  );
}

function makeButton(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find(
    (each) => each.textContent === 'Make a room',
  );
}

describe('a private lap race on the room panel — #1912', () => {
  it('makes one on a loop with the laps and items chosen, never listed', async () => {
    const asked: Asked[] = [];
    let entered: EnteredRoom | undefined;
    await shown(panel({ rooms: rooms(asked), onEnter: (room) => (entered = room) }));
    await click(labelled(ROOM_LAP_RACE_TEXT.kind));
    // Its laps and items appear; the public listing goes.
    expect(labelled('List it as a public room')).toBeUndefined();
    const laps = [...document.querySelectorAll('select')].find((each) =>
      (each.closest('label')?.textContent ?? '').startsWith(ROOM_LAP_RACE_TEXT.laps),
    );
    expect([...(laps?.options ?? [])].map((option) => option.value)).toEqual(
      Array.from({ length: 10 }, (_, index) => String(index + 1)),
    );
    await act(async () => {
      if (laps !== undefined) {
        laps.value = '4';
        laps.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await Promise.resolve();
    });
    await click(labelled(ROOM_LAP_RACE_TEXT.items));
    audit();
    await click(makeButton());
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ kind: 'race', lapRace: { laps: 4, items: false } });
    expect(asked[0]?.startsAt).toBeUndefined();
    expect(entered?.lapRace).toEqual({ laps: 4, items: false });
  });

  it('refuses a lap race on a route that is not a loop, in words, and sends nothing', async () => {
    const asked: Asked[] = [];
    await shown(panel({ rooms: rooms(asked), routes: [OUT_AND_BACK] }));
    await click(labelled(ROOM_LAP_RACE_TEXT.kind));
    expect(document.body.textContent).toContain(ROOM_LAP_RACE_TEXT.notALoop);
    expect(labelled(ROOM_LAP_RACE_TEXT.items)).toBeUndefined();
    audit();
    await click(makeButton());
    expect(asked).toEqual([]);
  });

  it('makes an ordinary race with no lapRace when the rider did not ask for one', async () => {
    const asked: Asked[] = [];
    await shown(panel({ rooms: rooms(asked) }));
    await click(labelled('Race'));
    await click(makeButton());
    expect(asked[0]?.kind).toBe('race');
    expect(asked[0]).not.toHaveProperty('lapRace');
  });

  it('tells the rider in one its laps and items, and the weight disclosure', async () => {
    await shown(
      panel({
        entered: {
          roomId: 'room-lap',
          kind: 'race',
          ridingPosition: 'hoods',
          drafting: true,
          madeIt: false,
          lapRace: { laps: 3, items: true },
          profile: LOOP.profile,
          routeSha256: 'a'.repeat(64),
        },
      }),
    );
    expect(document.body.textContent).toContain(ROOM_LAP_RACE_TEXT.entered(3, true));
    expect(document.body.textContent).toContain('watts per kilogram live');
  });

  it('shows a flagged rider’s flag in a lap race’s finish order, as the instance publishes it', async () => {
    // The rows `apps/instance` §`lap-race-rooms.test.ts` §"a lap race's result"
    // reads back through the result route: the sprinter over the 5-second
    // ceiling first, flagged, and nothing of the items.
    const published = {
      ...rooms([]),
      results: () =>
        Promise.resolve({
          kind: 'result' as const,
          rows: [
            {
              place: 1,
              displayName: 'Anna',
              you: false,
              finishMs: 81_000,
              wattsPerKilogram: 4.9,
              flags: [{ durationSeconds: 5, overWattsPerKilogram: 18 }],
            },
            {
              place: 2,
              displayName: 'Bea',
              you: true,
              finishMs: 84_000,
              wattsPerKilogram: 3.6,
              flags: [],
            },
          ],
        }),
    };
    mounted = await mount(
      <main>
        <h1>Game</h1>
        <RaceResult rooms={published} roomId="room-lap" finishers={2} ownWatts={250} />
      </main>,
    );
    await settle();
    await settle();
    audit();
    const lines = [...document.querySelectorAll('.oyl-race-result__rows li')];
    expect(lines).toHaveLength(2);
    expect(lines[0]?.querySelector('.oyl-race-result__flag')?.textContent).toContain(
      'Flagged: over 18.0 W/kg for 5 seconds.',
    );
    expect(lines[1]?.querySelector('.oyl-race-result__flag')).toBeNull();
  });

  it('says, with no instance, that racing others round a loop needs one', async () => {
    await shown(panel({ rooms: undefined }));
    expect(document.body.textContent).toContain(ROOM_LAP_RACE_TEXT.noInstance);
  });
});

/**
 * The owner's ruling on PR #2098 (2026-11-03): "Approve with the tidy-ups".
 * Each sentence is written out here as the owner wrote it, not read from
 * `ROOM_LAP_RACE_TEXT`, so a rewording of the constant is red.
 */
describe('a lap race’s words, as the owner approved them — #1912', () => {
  it('names the kind and the items box in the approved words', async () => {
    await shown(panel({}));
    expect(labelled('Lap race')?.closest('label')?.textContent).toBe(
      'Lap race — laps of a loop, then a finish order',
    );
    await click(labelled('Lap race'));
    expect(labelled('Race with items')?.closest('label')?.textContent).toBe(
      'Race with items — pick-ups round the lap; an item moves where you appear in the game, never your trainer',
    );
  });

  it('labels the status of a rider in one “Lap race:”, and an ordinary race still “Race:”', async () => {
    const entered: EnteredRoom = {
      roomId: 'room-lap',
      kind: 'race',
      ridingPosition: 'hoods',
      drafting: true,
      madeIt: false,
      lapRace: { laps: 3, items: true },
      profile: LOOP.profile,
      routeSha256: 'a'.repeat(64),
    };
    await shown(panel({ entered }));
    expect(document.querySelector('.oyl-status__label')?.textContent).toBe('Lap race: ');
    mounted?.unmount();
    await shown(panel({ entered: { ...entered, lapRace: undefined } }));
    expect(document.querySelector('.oyl-status__label')?.textContent).toBe('Race: ');
  });

  it('says, with no instance, the approved one line', async () => {
    await shown(panel({ rooms: undefined }));
    expect(
      [...document.querySelectorAll('.oyl-rooms p')].map((each) => each.textContent),
    ).toContain(
      'Connect this device to one in Settings to make a room or a lap race, or join one by its code.',
    );
  });
});
