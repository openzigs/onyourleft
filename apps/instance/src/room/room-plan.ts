// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the self-hosted room server opens a room from (#780): the room's row
 * and its course (migration 0005), turned into the room core's settings.
 *
 * A {@link RoomPlan} is plain data, because it crosses a process boundary:
 * the HTTP process reads it from the store — the one process that opens the
 * database (ADR 0037 D-5) — and hands it to the room worker that will hold
 * the room, which builds the settings from it with {@link settingsFromPlan}.
 * The course's grade is a step function over `[fromMetres, percent]` pairs,
 * so a function never has to be sent anywhere.
 */

import { PHYSICS_VERSION, type RidingPosition } from '@onyourleft/physics';
import type { RoomKind } from '@onyourleft/protocol';

import type { Room, RoomCourse } from '../store/sql-store.ts';
import { roomSettings, RoomSettingsError, type RoomSettings } from './core/settings.ts';

/**
 * Who may start a race — **the owner's ruling of 2026-09-30: its creator.**
 *
 * - `{ creator }` — a rider's room (#784): only the athlete who made it, and
 *   only while they are seated and connected in it. `{ creator: null }` is a
 *   rider's room whose creator row is gone: nobody may start it (erasing an
 *   account ends its rooms first, so this is a moment at most) — it fails
 *   closed rather than falling back to any rider.
 * - `'any-seated-rider'` — a room an operator opened from the command line
 *   (`operator/commands.ts` §`room open`), which has no creator: any rider
 *   seated and connected in it, as #785 first ruled for every room.
 *
 * Enforced by the room itself (`node/room-host.ts` §`start`); the HTTP
 * process only reads it from the store, as the rest of a plan.
 */
export type RaceStarter = { readonly creator: string | null } | 'any-seated-rider';

export interface RoomPlan {
  readonly roomId: string;
  readonly kind: RoomKind;
  readonly ridingPosition: RidingPosition;
  readonly routeSha256: string;
  readonly lengthMetres: number;
  readonly grades: readonly (readonly [number, number])[];
  readonly capacity: number | null;
  readonly countdownMs: number | null;
  readonly rejoinWindowMs: number | null;
  /** Who may start it, if it is a race: {@link RaceStarter}. */
  readonly startedBy: RaceStarter;
}

/**
 * The plan for a stored room, or `undefined` when it cannot be opened on this
 * build: it has no course, or it was made for another physics version (ADR
 * 0028 D-2 rule 5 — its riders would be simulated by different arithmetic).
 */
export function planFor(
  room: Room,
  course: RoomCourse | undefined,
  startedBy: RaceStarter,
): RoomPlan | undefined {
  if (course === undefined || room.physicsVersion !== PHYSICS_VERSION) return undefined;
  return {
    roomId: room.id,
    kind: room.kind === 'group' ? 'ride' : 'race',
    ridingPosition: course.ridingPosition,
    routeSha256: room.routeSha256,
    lengthMetres: course.lengthMetres,
    grades: course.grades,
    capacity: course.capacity,
    countdownMs: course.countdownMs,
    rejoinWindowMs: course.rejoinWindowMs,
    startedBy,
  };
}

/** The grade at `metres`: the last step that starts at or before it. */
export function gradeAt(grades: RoomPlan['grades'], metres: number): number {
  let grade = 0;
  for (const [from, percent] of grades) {
    if (from > metres) break;
    grade = percent;
  }
  return grade;
}

/**
 * The room core's settings for a plan.
 *
 * @throws RoomSettingsError for grade steps that do not start at 0, go
 * backwards, or hold a number that is not finite — and for everything
 * `roomSettings` refuses.
 */
export function settingsFromPlan(plan: RoomPlan): RoomSettings {
  let previous = -Infinity;
  for (const [index, step] of plan.grades.entries()) {
    const [from, percent] = step;
    if (!Number.isFinite(from) || !Number.isFinite(percent) || from <= previous) {
      throw new RoomSettingsError('a course’s grade steps must be finite and ascending');
    }
    if (index === 0 && from !== 0) {
      throw new RoomSettingsError('a course’s first grade step starts at 0 m');
    }
    previous = from;
  }
  const grades = plan.grades;
  return roomSettings({
    kind: plan.kind,
    ridingPosition: plan.ridingPosition,
    course: {
      sha256: plan.routeSha256,
      lengthMetres: plan.lengthMetres,
      gradePercentAt: (metres) => gradeAt(grades, metres),
    },
    ...(plan.capacity === null ? {} : { capacity: plan.capacity }),
    ...(plan.countdownMs === null ? {} : { countdownMs: plan.countdownMs }),
    ...(plan.rejoinWindowMs === null ? {} : { rejoinWindowMs: plan.rejoinWindowMs }),
  });
}
