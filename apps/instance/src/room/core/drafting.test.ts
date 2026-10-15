// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Drafting in a room — #787, ADR 0038 D-4: the room computes every rider's
 * `k` from the positions it holds, before it re-simulates anybody, and the
 * frame carries `(1 − k) × 100`. Read back from what the room SENDS and from
 * `view()`, and held to an independent re-simulation through
 * `@onyourleft/physics` itself: the same `fieldDraftFactors` and `advance`,
 * driven here tick by tick, so "by the amount the model predicts" is a number
 * this file computes rather than one it reads off the room.
 */

import { describe, expect, it } from 'vitest';

import { gradePercent, kilograms, seconds, watts } from '@onyourleft/domain';
import {
  advance,
  fieldDraftFactors,
  ridingConditions,
  START_OF_RIDE,
  type RideState,
} from '@onyourleft/physics';

import type { Outbound, Room } from './room.ts';
import { roomSettings } from './settings.ts';
import { FLAT_COURSE, helloText, lastFrame, reportText, testRoom } from './room-testing.ts';

const SECOND = 1000;
const LONG = { ...FLAT_COURSE, lengthMetres: 100_000 };

/** One second: each connection reports its power half a second in; the room ticks at the second. */
function second(room: Room, t: number, powers: Readonly<Record<number, number>>): Outbound[] {
  const now = t * SECOND;
  for (const [connection, power] of Object.entries(powers)) {
    room.receive(Number(connection), reportText(t + 1, now + 500, power), now + 500);
  }
  return room.tick(now + SECOND);
}

function distanceOf(room: Room, riderId: number): number {
  const seat = room.view().seats.find((s) => s.riderId === riderId);
  if (seat === undefined) throw new Error('no such rider');
  return seat.distanceMetres;
}

/** A started room of `riders`, A on connection 1 (rider 0), B on 2 (rider 1). */
function roomOf(riders: readonly string[], drafting: boolean, kind: 'race' | 'ride' = 'race') {
  const room = testRoom({ kind, course: LONG, countdownMs: 0, drafting });
  riders.forEach((who, index) => room.receive(index + 1, helloText(`ticket-${who}`), 0));
  room.start(0);
  return room;
}

const STEP = { grade: gradePercent(0), duration: seconds(1) } as const;
const ALONE = ridingConditions(kilograms(70), 'hoods');

/** The model's own ride of a field for one tick: every `k` first, from where everybody is. */
function modelTick(
  field: readonly RideState[],
  powers: readonly number[],
  drafting: boolean,
): RideState[] {
  const k = drafting ? fieldDraftFactors(field.map((ride) => ride.distance)) : field.map(() => 1);
  return field.map((ride, index) =>
    advance(
      ride,
      { ...STEP, power: watts(powers[index] as number) },
      ridingConditions(kilograms(70), 'hoods', k[index] as number),
    ),
  );
}

describe('drafting in a room — #787', () => {
  it('is on unless the room is made with it off — the owner’s ruling of 2026-09-30', () => {
    const base = { kind: 'race', ridingPosition: 'hoods', course: LONG } as const;
    expect(roomSettings(base).drafting).toBe(true);
    expect(roomSettings({ ...base, drafting: false }).drafting).toBe(false);
  });

  it('lets B, about a metre behind A at equal power, gain on A by what the model predicts — and A a little over a solo A', () => {
    const room = roomOf(['a', 'b'], true);
    const solo = roomOf(['a'], true);
    // B sets off a second after A, which puts B about a metre behind.
    let field: RideState[] = [START_OF_RIDE, START_OF_RIDE];
    second(room, 0, { 1: 250, 2: 0 });
    second(solo, 0, { 1: 250 });
    field = modelTick(field, [250, 0], true);
    let soloA: RideState = advance(START_OF_RIDE, { ...STEP, power: watts(250) }, ALONE);
    const startGap = distanceOf(room, 0) - distanceOf(room, 1);
    expect(startGap).toBeGreaterThan(0.5);
    expect(startGap).toBeLessThan(2);

    let last: Outbound[] = [];
    /** A's lead over a solo A while A has led all the way: the leading-rider effect alone. */
    let leading: number | undefined;
    let ledAllTheWay = true;
    /** Where the room held both before the last tick: what that tick's `k` was taken from. */
    let before: number[] = [];
    for (let t = 1; t <= 60; t += 1) {
      before = [distanceOf(room, 0), distanceOf(room, 1)];
      last = second(room, t, { 1: 250, 2: 250 });
      second(solo, t, { 1: 250 });
      field = modelTick(field, [250, 250], true);
      soloA = advance(soloA, { ...STEP, power: watts(250) }, ALONE);
      // Every tick, exactly where the model puts both: the room drafts with
      // the model and nothing else.
      expect(distanceOf(room, 0)).toBe(field[0]?.distance);
      expect(distanceOf(room, 1)).toBe(field[1]?.distance);
      expect(distanceOf(solo, 0)).toBe(soloA.distance);
      ledAllTheWay &&= distanceOf(room, 0) - distanceOf(room, 1) > 0.05;
      if (ledAllTheWay) leading = distanceOf(room, 0) - distanceOf(solo, 0);
    }
    const endGap = distanceOf(room, 0) - distanceOf(room, 1);
    // B, sheltered, closes on A at the same power…
    expect(endGap).toBeLessThan(startGap);
    // …and A, with B on the wheel and before B comes past (single file, ADR
    // 0038 D-3.4), is a little further up the road than a solo A.
    expect(leading).toBeGreaterThan(0);
    expect(leading).toBeLessThan(1);

    // The frame says so, for the k its tick was ridden at — taken from where
    // the room held both BEFORE the tick: the one behind sheltered by about a
    // third, the one in front by a percent or two (ADR 0038 D-3.1, D-3.2).
    const k = fieldDraftFactors(before);
    const frame = lastFrame(last, 1);
    const drafts = [0, 1].map(
      (riderId) => frame.riders.find((rider) => rider.riderId === riderId)?.draftPercent,
    );
    expect(drafts).toEqual(k.map((each) => Math.round((1 - each) * 100)));
    expect(Math.max(...(drafts as number[]))).toBeGreaterThan(25);
    expect(Math.min(...(drafts as number[]))).toBeGreaterThanOrEqual(1);
    expect(Math.min(...(drafts as number[]))).toBeLessThan(5);
  });

  it('with drafting off, rides everybody at k = 1 through the same code, and every frame says 0', () => {
    const room = roomOf(['a', 'b'], false);
    let field: RideState[] = [START_OF_RIDE, START_OF_RIDE];
    second(room, 0, { 1: 250, 2: 0 });
    field = modelTick(field, [250, 0], false);
    for (let t = 1; t <= 60; t += 1) {
      const out = second(room, t, { 1: 250, 2: 250 });
      field = modelTick(field, [250, 250], false);
      expect(distanceOf(room, 1)).toBe(field[1]?.distance);
      expect(lastFrame(out, 1).riders.map((rider) => rider.draftPercent)).toEqual([0, 0]);
    }
  });

  it('drafts a group ride too: there is no per-kind switch (ADR 0038)', () => {
    const room = roomOf(['a', 'b'], true, 'ride');
    second(room, 0, { 1: 250, 2: 0 });
    const out = second(room, 1, { 1: 250, 2: 250 });
    expect(
      lastFrame(out, 2).riders.find((rider) => rider.riderId === 1)?.draftPercent,
    ).toBeGreaterThan(25);
  });

  it('shelters nobody behind a finisher: a rider over the line has left the road', () => {
    const room = testRoom({ course: { ...FLAT_COURSE, lengthMetres: 30 }, countdownMs: 0 });
    room.receive(1, helloText('ticket-a'), 0);
    room.receive(2, helloText('ticket-b'), 0);
    room.start(0);
    let t = 0;
    while (room.view().seats[0]?.state !== 'finished') second(room, t++, { 1: 400, 2: 100 });
    // Bea is still within reach of where Ann crossed, so a finisher that
    // still sheltered would show here.
    expect(distanceOf(room, 0) - distanceOf(room, 1)).toBeLessThan(25);
    const out = second(room, t, { 2: 100 });
    const b = lastFrame(out, 2).riders.find((rider) => rider.riderId === 1);
    expect(b?.draftPercent).toBe(0);
  });
});
