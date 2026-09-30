// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { PHYSICS_VERSION } from '@onyourleft/physics';

import type { Room, RoomCourse } from '../store/sql-store.ts';
import { RoomSettingsError } from './core/settings.ts';
import { gradeAt, planFor, settingsFromPlan } from './room-plan.ts';

const ROOM: Room = {
  id: 'room-1',
  kind: 'group',
  visibility: 'private',
  routeSha256: 'ab'.repeat(32),
  physicsVersion: PHYSICS_VERSION,
};
const COURSE: RoomCourse = {
  roomId: 'room-1',
  lengthMetres: 450,
  grades: [
    [0, 0],
    [150, 2],
    [300, -1],
  ],
  ridingPosition: 'drops',
  capacity: 80,
  countdownMs: null,
  rejoinWindowMs: 5_000,
  raceStartedAt: null,
};

describe('a stored room, as the room core’s settings — #780', () => {
  it('reads a group room as a ride, and carries its course and settings over', () => {
    const plan = planFor(ROOM, COURSE);
    expect(plan).toMatchObject({ kind: 'ride', ridingPosition: 'drops', lengthMetres: 450 });
    const settings = settingsFromPlan(plan!);
    expect(settings.kind).toBe('ride');
    expect(settings.capacity).toBe(80);
    expect(settings.rejoinWindowMs).toBe(5_000);
    expect(settings.countdownMs).toBe(10_000);
    expect(settings.course.sha256).toBe(ROOM.routeSha256);
    expect([0, 149.9, 150, 299, 300, 449].map(settings.course.gradePercentAt)).toEqual([
      0, 0, 2, 2, -1, -1,
    ]);
    expect(settingsFromPlan(planFor({ ...ROOM, kind: 'race' }, COURSE)!).kind).toBe('race');
  });

  it('opens nothing without a course, or for another physics version', () => {
    expect(planFor(ROOM, undefined)).toBeUndefined();
    expect(planFor({ ...ROOM, physicsVersion: PHYSICS_VERSION + 1 }, COURSE)).toBeUndefined();
  });

  it('refuses grade steps that do not start at 0 or that go backwards', () => {
    const plan = planFor(ROOM, COURSE)!;
    expect(() => settingsFromPlan({ ...plan, grades: [[10, 1]] })).toThrow(RoomSettingsError);
    expect(() =>
      settingsFromPlan({
        ...plan,
        grades: [
          [0, 1],
          [0, 2],
        ],
      }),
    ).toThrow(RoomSettingsError);
    expect(gradeAt([], 100)).toBe(0);
  });
});
