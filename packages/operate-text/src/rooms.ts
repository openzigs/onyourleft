// SPDX-License-Identifier: Apache-2.0

/**
 * **Rooms**' words (#2612, ADR 0069 D-7): the sentences the Rooms section
 * says over what `GET /v1/operate/rooms` returns, and what ending a room
 * does. The instance's admin Rooms page (#2649) says the same — and since
 * #2649 each room's line, which both draw from {@link roomLine}.
 *
 * The route names a rider by display name alone — `null` where the owner may
 * not see it — and never by a place, a speed, a power or an id, so nothing
 * here formats one.
 *
 * ⚠️ **Every sentence here is DRAFT wording awaiting the owner's approval.**
 */

import { momentText } from './words';

/** A room's kind, as the route writes it. */
export type OperateRoomKind = 'group' | 'race' | 'lap-race';

/** Where a room is, as the route writes it. */
export type OperateRoomPhase = 'lobby' | 'countdown' | 'riding' | 'finished';

/** Why the owner ends a room: the instance's closed list (`ROOM_END_REASONS`). */
export type OperateRoomEndReason = 'abuse' | 'stuck' | 'maintenance' | 'other';

/** The reasons in the order they are offered. */
export const ROOM_END_REASONS: readonly OperateRoomEndReason[] = [
  'abuse',
  'stuck',
  'maintenance',
  'other',
];

export const ROOM_KIND_TEXT: Readonly<Record<OperateRoomKind, string>> = {
  group: 'Group ride',
  race: 'Race',
  'lap-race': 'Lap race',
};

export const ROOM_PHASE_TEXT: Readonly<Record<OperateRoomPhase, string>> = {
  lobby: 'waiting to start',
  countdown: 'counting down',
  riding: 'under way',
  finished: 'finished',
};

export const ROOM_END_REASON_TEXT: Readonly<Record<OperateRoomEndReason, string>> = {
  abuse: 'Abuse in the room',
  stuck: 'The room is stuck',
  maintenance: 'Maintenance on the instance',
  other: 'Another reason',
};

/** What the section is, above the list. */
export const ROOMS_LIST_TEXT =
  'The rooms riders have open on this instance, newest first, and who is in each.';

/** What the section never shows, in its help. */
export const ROOMS_NAMES_ONLY_TEXT =
  'Only names are shown: never where anyone is on the road, how fast or how hard they are riding.';

/** Said in place of the list when the owner's read of it did not come. */
export const ROOMS_UNREADABLE_TEXT =
  'The rooms could not be read from the instance, so they are not shown here.';

/** Said when no room is open. */
export const NO_ROOM_TEXT = 'No room is open.';

/** What ending a room does, said in its confirmation. */
export const END_ROOM_CONFIRM_TEXT =
  'Everyone in the room is told it has closed, and nobody can join it again. Each rider goes ' +
  'on riding on their own, and their own device keeps recording: nothing is sent to anyone’s ' +
  'trainer. Results already final are kept.';

/** How the owner confirms: the room's short code, typed. */
export function endRoomTypeText(shortCode: string): string {
  return `To end it, type the room’s code, ${shortCode}.`;
}

/** Said when ending a room did not happen. */
export const ROOM_NOT_ENDED_TEXT =
  'The instance did not end the room, so it is as it was. Read the list again and try once more.';

/** A rider the owner may not see by name. */
export const ROOM_UNNAMED_RIDER = 'a rider';

/** Who is in a room, with a count: "3 riders: Ann, Bea and a rider.", or "Nobody is in it." */
export function ridersText(riders: readonly (string | null)[]): string {
  const names = riders.map((name) => name ?? ROOM_UNNAMED_RIDER);
  if (names.length === 0) return 'Nobody is in it.';
  const listed =
    names.length === 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
  return `${String(names.length)} ${names.length === 1 ? 'rider' : 'riders'}: ${listed}.`;
}

/** Whether a room is listed, as the route writes it. */
export type OperateRoomVisibility = 'private' | 'public';

const VISIBILITY_TEXT: Readonly<Record<OperateRoomVisibility, string>> = {
  private: 'private',
  public: 'public',
};

/**
 * One room's line in the list (moved by #2649): its kind, drawn strong, and
 * the rest — private or public, its phase, when it opened and by whom, who
 * is in it, and its short code, as code.
 */
export function roomLine(room: {
  readonly kind: OperateRoomKind;
  readonly visibility: OperateRoomVisibility;
  readonly phase: OperateRoomPhase;
  /** ISO 8601, UTC. */
  readonly openedAt: string;
  readonly host: string | null;
  readonly riders: readonly (string | null)[];
  readonly shortCode: string;
}): { readonly kind: string; readonly rest: readonly (string | { readonly code: string })[] } {
  return {
    kind: ROOM_KIND_TEXT[room.kind],
    rest: [
      `, ${VISIBILITY_TEXT[room.visibility]}, ${ROOM_PHASE_TEXT[room.phase]}. Opened ${momentText(room.openedAt)} by ${room.host ?? ROOM_UNNAMED_RIDER}. ${ridersText(room.riders)} Code `,
      { code: room.shortCode },
      '.',
    ],
  };
}

/** The end form's two fields' labels. */
export const END_ROOM_REASON_LABEL = 'Why';
