// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A race's standings on the HUD — #1347, ADR 0051: `room-ride.ts`
 * §`raceStandings`, through the production room port over a scripted room —
 * the same `roomPortOver` and `RoomSession` the game is handed — so the words
 * are read back from what the room sent and nothing in between is a fake.
 */

import { FLAG_COASTING, FLAG_FINISHED, FLAG_PLAUSIBILITY } from '@onyourleft/protocol';
import { describe, expect, it } from 'vitest';

import { roomPortOver, type RoomConnection } from '../net/room-port';
import { flush, frameRider, ManualClock, ScriptedRoom, standingsRider } from '../net/testing';
import { gapText, raceStandings, STANDINGS_LINES } from './room-ride';

async function race(kind: 'race' | 'ride' = 'race'): Promise<{
  readonly room: ScriptedRoom;
  readonly clock: ManualClock;
  readonly connection: RoomConnection;
}> {
  const room = new ScriptedRoom();
  const clock = new ManualClock();
  const connection = roomPortOver(() => room.link(), { timers: clock, now: clock.now }).join({
    roomId: 'room-1',
    declaredMassKilograms: 70,
    sample: () => ({ powerWatts: 200 }),
  });
  await flush();
  room.accept();
  room.welcome(3, kind);
  return { room, clock, connection };
}

describe('the words of a line — #1347', () => {
  it('says a gap behind as +, ahead as a minus sign, and minutes past a minute', () => {
    expect(gapText(12.4)).toBe('+12 s');
    expect(gapText(-8.4)).toBe('−8 s');
    expect(gapText(0.3)).toBe('0 s');
    expect(gapText(65)).toBe('+1:05');
    expect(gapText(-3_725)).toBe('−1:02:05');
  });

  it('names each rider by the room’s word, marks this rider’s own line, and puts W/kg — never watts — beside each', async () => {
    const { room, connection } = await race();
    room.name(5, 'Ann');
    room.name(3, 'Me');
    room.frame(1, [frameRider(5, 40), frameRider(3, 30)]);
    room.standings(1, [
      standingsRider(5, -8.4, 3.9, FLAG_PLAUSIBILITY),
      standingsRider(3, 0, 3.46),
      standingsRider(7, 12, 0, FLAG_COASTING),
      standingsRider(8, 30, 0, FLAG_FINISHED),
    ]);
    const view = raceStandings(connection);
    expect(view).toEqual({
      place: 2,
      of: 4,
      lines: [
        {
          riderId: 5,
          place: 1,
          who: 'Ann',
          gap: '−8 s',
          figure: '3.9 W/kg',
          flagged: true,
          you: false,
        },
        {
          riderId: 3,
          place: 2,
          who: 'You',
          gap: '',
          figure: '3.5 W/kg',
          flagged: false,
          you: true,
        },
        // Not named yet, coasting: "A rider", and no W/kg made up for them.
        {
          riderId: 7,
          place: 3,
          who: 'A rider',
          gap: '+12 s',
          figure: 'Coasting',
          flagged: false,
          you: false,
        },
        {
          riderId: 8,
          place: 4,
          who: 'A rider',
          gap: '+30 s',
          figure: 'Finished',
          flagged: false,
          you: false,
        },
      ],
    });
    expect(JSON.stringify(view)).not.toMatch(/\d W(?!\/kg)|watts/i);
  });
});

describe('which lines, and when — #1347', () => {
  it(`shows at most ${String(STANDINGS_LINES)} lines, around this rider’s own, each keeping its place`, async () => {
    const { room, connection } = await race();
    const field = Array.from({ length: 20 }, (_, index) =>
      // Rider 3 is twelfth.
      standingsRider(index === 11 ? 3 : 100 + index, index - 11, 3),
    );
    room.frame(1, [frameRider(3, 30)]);
    room.standings(1, field);
    const view = raceStandings(connection);
    expect(view?.lines.map((line) => line.place)).toEqual([9, 10, 11, 12, 13, 14, 15]);
    expect(view?.lines.find((line) => line.you)?.place).toBe(12);
    expect(view?.of).toBe(20);
    // At the front, the window is the front.
    room.standings(2, [standingsRider(3, 0, 3), ...field.filter((row) => row.riderId !== 3)]);
    expect(raceStandings(connection)?.lines.map((line) => line.place)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
    // At the back, the back.
    room.standings(3, [...field.filter((row) => row.riderId !== 3), standingsRider(3, 0, 3)]);
    expect(raceStandings(connection)?.lines.map((line) => line.place)).toEqual([
      14, 15, 16, 17, 18, 19, 20,
    ]);
  });

  it('has no list before the room’s first standings, nor in a group ride', async () => {
    const before = await race();
    expect(raceStandings(before.connection)).toBeUndefined();
    const ride = await race('ride');
    ride.room.frame(1, [frameRider(3, 30), frameRider(4, 40)]);
    expect(raceStandings(ride.connection)).toBeUndefined();
  });

  it('takes the list away while the room is lost, and brings it back with the room', async () => {
    const { room, clock, connection } = await race();
    room.frame(1, [frameRider(3, 30)]);
    room.standings(1, [standingsRider(3, 0, 3)]);
    expect(raceStandings(connection)).toBeDefined();
    room.closeFromServer();
    expect(connection.status().kind).toBe('lost');
    expect(raceStandings(connection)).toBeUndefined();
    await clock.advance(1_000);
    room.accept();
    room.welcome(3, 'race');
    // Back in, the old gaps are not shown again: the room's next ones are.
    expect(raceStandings(connection)).toBeUndefined();
    room.standings(9, [standingsRider(3, 0, 3.1)]);
    expect(raceStandings(connection)?.lines[0]?.figure).toBe('3.1 W/kg');
  });
});
