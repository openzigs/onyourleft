// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A race's names and standings — #1347, ADR 0051 — through the real room
 * core, read back from what it SENDS: the messages a client decodes, never
 * the core's own state. The gaps are checked against an independent
 * computation from the room's own positions (`view()`, tick by tick), so a
 * room that sent a gap it did not derive from where its riders were is red.
 */

import { describe, expect, it } from 'vitest';

import {
  encodeMessage,
  FLAG_COASTING,
  FLAG_FINISHED,
  type Standings,
  type StandingsRider,
} from '@onyourleft/protocol';

import type { Outbound, Room } from './room.ts';
import { FLAT_COURSE, helloText, reportText, sentTo, testRoom } from './room-testing.ts';

const SECOND = 1000;

/** The standings one connection was sent in `out`, or `undefined`. */
function standingsTo(out: readonly Outbound[], connection: number): Standings | undefined {
  return sentTo(out, connection).find((m): m is Standings => m.type === 'standings');
}

function row(standings: Standings | undefined, riderId: number): StandingsRider {
  const found = standings?.riders.find((each) => each.riderId === riderId);
  if (found === undefined) throw new Error(`rider ${String(riderId)} is not in the standings`);
  return found;
}

/**
 * One second of a race: each connection in `powers` reports its power half a
 * second in, and the room ticks at the second. `null` reports nothing.
 */
function second(room: Room, t: number, powers: Readonly<Record<number, number | null>>) {
  const now = t * SECOND;
  for (const [connection, power] of Object.entries(powers)) {
    if (power === null) continue;
    room.receive(Number(connection), reportText(t + 1, now + 500, power), now + 500);
  }
  return room.tick(now + SECOND);
}

/** A race of two, Ann on connection 1 and Bea on 2, started with no countdown. */
function raceOfTwo(input: Parameters<typeof testRoom>[0] = {}) {
  const room = testRoom({ countdownMs: 0, ...input }, { bea: 62 });
  const annIn = room.receive(1, helloText('ticket-ann'), 0);
  const beaIn = room.receive(2, helloText('ticket-bea'), 0);
  room.start(0);
  return { room, annIn, beaIn };
}

/** When the distance series `at` (index = tick) passed `metres`, interpolated — the test's own. */
function passed(at: readonly number[], metres: number): number {
  for (let k = 1; k < at.length; k += 1) {
    const before = at[k - 1] as number;
    const after = at[k] as number;
    if (after >= metres && after > before) return k - 1 + (metres - before) / (after - before);
  }
  throw new Error('never passed');
}

describe('names — #1347', () => {
  it('names the whole field to a rider as they are seated, and the newcomer to everybody already there', () => {
    const { annIn, beaIn } = raceOfTwo();
    expect(sentTo(annIn, 1).filter((m) => m.type === 'name')).toEqual([
      { type: 'name', riderId: 0, displayName: 'Ann' },
    ]);
    // Ann is told Bea's name as Bea is seated; Bea is told both.
    expect(sentTo(beaIn, 1)).toEqual([{ type: 'name', riderId: 1, displayName: 'Bea' }]);
    expect(sentTo(beaIn, 2).filter((m) => m.type === 'name')).toEqual([
      { type: 'name', riderId: 0, displayName: 'Ann' },
      { type: 'name', riderId: 1, displayName: 'Bea' },
    ]);
  });

  it('names the field again on a rejoin, on the new socket', () => {
    const { room } = raceOfTwo();
    second(room, 0, { 1: 200, 2: 200 });
    room.disconnect(2, 1_200);
    const back = room.receive(3, helloText('ticket-bea'), 1_400);
    expect(sentTo(back, 3).filter((m) => m.type === 'name')).toEqual([
      { type: 'name', riderId: 0, displayName: 'Ann' },
      { type: 'name', riderId: 1, displayName: 'Bea' },
    ]);
  });

  it('never names anybody in a group ride, and sends it no standings — ADR 0028 D-7.2', () => {
    const room = testRoom({ kind: 'ride', countdownMs: 0 });
    const out = [
      ...room.receive(1, helloText('ticket-ann'), 0),
      ...room.receive(2, helloText('ticket-bea'), 0),
    ];
    for (let t = 0; t < 5; t += 1) out.push(...second(room, t, { 1: 250, 2: 150 }));
    const types = new Set(out.flatMap((o) => (o.kind === 'send' ? [o.message.type] : [])));
    expect(types.has('frame')).toBe(true);
    expect(types.has('name')).toBe(false);
    expect(types.has('standings')).toBe(false);
  });
});

describe('standings — #1347', () => {
  it('sends each rider, after every frame, the field furthest first, with gaps the room took from its own positions', () => {
    const { room } = raceOfTwo();
    const ann: number[] = [0];
    const bea: number[] = [0];
    let last: readonly Outbound[] = [];
    for (let t = 0; t < 40; t += 1) {
      last = second(room, t, { 1: 300, 2: 180 });
      const [a, b] = room.view().seats;
      ann.push(a?.distanceMetres ?? Number.NaN);
      bea.push(b?.distanceMetres ?? Number.NaN);
      // The standings come after the frame of the same tick, to both.
      for (const connection of [1, 2]) {
        const types = sentTo(last, connection).map((m) => m.type);
        expect(types).toEqual(['frame', 'standings']);
      }
    }
    const toAnn = standingsTo(last, 1);
    const toBea = standingsTo(last, 2);
    expect(toAnn?.tick).toBe(40);
    // Ann is ahead: first in both.
    expect(toAnn?.riders.map((r) => r.riderId)).toEqual([0, 1]);
    expect(toBea?.riders.map((r) => r.riderId)).toEqual([0, 1]);
    // The test's own reading of the same positions: Bea is where Ann was
    // `40 − passed(ann, bea now)` seconds ago.
    const expected = Math.round((40 - passed(ann, bea.at(-1) as number)) * 10);
    expect(expected).toBeGreaterThan(30);
    expect(row(toAnn, 1).gapDeciseconds).toBe(expected);
    // Bea is told the same gap from her side: Ann ahead, negative.
    expect(row(toBea, 0).gapDeciseconds).toBe(-expected);
    // Your own row is nought.
    expect(row(toAnn, 0).gapDeciseconds).toBe(0);
    expect(row(toBea, 1).gapDeciseconds).toBe(0);
  });

  it('carries live W/kg from the power the room simulated over the mass it holds — and the mass never', () => {
    const { room } = raceOfTwo();
    const out: Outbound[] = [];
    for (let t = 0; t < 3; t += 1) out.push(...second(room, t, { 1: 280, 2: 155 }));
    const toAnn = standingsTo(second(room, 3, { 1: 280, 2: 155 }), 1);
    // Ann 280 W at 70 kg is 4.0; Bea 155 W at 62 kg is 2.5.
    expect(row(toAnn, 0).wattsPerKilogramTenths).toBe(40);
    expect(row(toAnn, 1).wattsPerKilogramTenths).toBe(25);
    // Live: the tick's power, not a mean — Ann eases and her figure follows at once.
    const eased = standingsTo(second(room, 4, { 1: 140, 2: 155 }), 2);
    expect(row(eased, 0).wattsPerKilogramTenths).toBe(20);
    // Nothing anybody is sent spells a mass or a power (ruling Q17; ADR 0028 D-3).
    const everything = out
      .flatMap((o) => (o.kind === 'send' ? [encodeMessage(o.message)] : []))
      .join('\n');
    expect(everything).not.toMatch(/mass|"watts|power/i);
  });

  it('keeps a dropped rider listed, coasting at 0 W/kg, until the rejoin window ends', () => {
    const { room } = raceOfTwo({ rejoinWindowMs: 3_000 });
    second(room, 0, { 1: 250, 2: 250 });
    room.disconnect(2, 1_200);
    const held = standingsTo(second(room, 1, { 1: 250, 2: null }), 1);
    expect(row(held, 1)).toMatchObject({ wattsPerKilogramTenths: 0, flags: FLAG_COASTING });
    // Past the window the room gives the seat up (`dnf`), and the row goes.
    let gone: Standings | undefined;
    for (let t = 2; t < 7; t += 1) gone = standingsTo(second(room, t, { 1: 250, 2: null }), 1);
    expect(gone?.riders.map((r) => r.riderId)).toEqual([0]);
  });

  it('puts finishers first by their finish, marked, with the gap between their crossings', () => {
    const course = { ...FLAT_COURSE, lengthMetres: 120 };
    const room = testRoom({ countdownMs: 0, course });
    for (const [connection, who] of [
      [1, 'ann'],
      [2, 'bea'],
      [3, 'cai'],
    ] as const) {
      room.receive(connection, helloText(`ticket-${who}`), 0);
    }
    room.start(0);
    let last: readonly Outbound[] = [];
    for (let t = 0; room.view().seats.filter((s) => s.state === 'finished').length < 2; t += 1) {
      // Bea is strongest, then Ann; Cai rides gently and finishes last.
      last = second(room, t, { 1: 300, 2: 400, 3: 120 });
    }
    const seats = room.view().seats;
    const toCai = standingsTo(last, 3);
    expect(toCai?.riders.map((r) => r.riderId)).toEqual([1, 0, 2]);
    const [bea, ann] = [row(toCai, 1), row(toCai, 0)];
    expect(bea.flags & FLAG_FINISHED).toBe(FLAG_FINISHED);
    expect(ann.flags & FLAG_FINISHED).toBe(FLAG_FINISHED);
    expect(row(toCai, 2).flags & FLAG_FINISHED).toBe(0);
    // A finisher is no longer simulated, so has no live W/kg.
    expect(bea.wattsPerKilogramTenths).toBe(0);
    // To Ann, Bea is ahead by exactly the difference of their crossings.
    const crossing = (riderId: number) =>
      seats.find((s) => s.riderId === riderId)?.finishedAtTicks ?? Number.NaN;
    const toAnn = standingsTo(last, 1);
    expect(row(toAnn, 1).gapDeciseconds).toBe(Math.round((crossing(1) - crossing(0)) * 10));
    expect(row(toAnn, 1).gapDeciseconds).toBeLessThan(0);
  });

  it('sends nothing to a rider before the race runs: no standings in the lobby or the countdown', () => {
    const room = testRoom({ countdownMs: 3_000 });
    room.receive(1, helloText('ticket-ann'), 0);
    room.start(0);
    const out = [...room.tick(1_000), ...room.tick(2_000)];
    expect(out.some((o) => o.kind === 'send' && o.message.type === 'standings')).toBe(false);
  });
});
