// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the room core's tests share: a room built from a table of tickets, and
 * a client that speaks the wire format. Test support, never mounted.
 */

import {
  encodeMessage,
  PROTOCOL_VERSION,
  type Frame,
  type RoomMessage,
} from '@onyourleft/protocol';
import { PHYSICS_VERSION } from '@onyourleft/physics';

import { createRoom, type Admission, type ConnectionId, type Outbound, type Room } from './room.ts';
import { roomSettings, type RoomSettingsInput } from './settings.ts';

/** A route, by a content hash nobody computed: the core only passes it on. */
export const COURSE_SHA256 = 'ab'.repeat(32);

/** A flat 10 km course. */
export const FLAT_COURSE = {
  sha256: COURSE_SHA256,
  lengthMetres: 10_000,
  gradePercentAt: () => 0,
} as const;

/** `ticket-<athlete>` is admitted as that athlete at 70 kg; anything else is refused. */
export function admitByTable(masses: Readonly<Record<string, number>> = {}) {
  return (ticket: string): Admission | undefined => {
    const match = /^ticket-(.+)$/.exec(ticket);
    if (match === null) return undefined;
    const athleteId = match[1] as string;
    return { athleteId, declaredMassKilograms: masses[athleteId] ?? 70 };
  };
}

export function testRoom(
  input: Partial<RoomSettingsInput> = {},
  masses: Readonly<Record<string, number>> = {},
): Room {
  return createRoom(
    roomSettings({ kind: 'race', ridingPosition: 'hoods', course: FLAT_COURSE, ...input }),
    admitByTable(masses),
  );
}

export function helloText(
  ticket: string,
  versions: { protocol?: number; physicsVersion?: number } = {},
): string {
  return JSON.stringify({
    type: 'hello',
    protocol: versions.protocol ?? PROTOCOL_VERSION,
    physicsVersion: versions.physicsVersion ?? PHYSICS_VERSION,
    ticket,
  });
}

export function reportText(sequence: number, atMs: number, powerWatts: number): string {
  return encodeMessage({ type: 'report', sequence, atMs, powerWatts });
}

/** Every message sent to one connection, in order. */
export function sentTo(out: readonly Outbound[], connection: ConnectionId): RoomMessage[] {
  return out.flatMap((o) => (o.kind === 'send' && o.connection === connection ? [o.message] : []));
}

export function closed(out: readonly Outbound[]): ConnectionId[] {
  return out.flatMap((o) => (o.kind === 'close' ? [o.connection] : []));
}

/** The last frame one connection was sent. */
export function lastFrame(out: readonly Outbound[], connection: ConnectionId): Frame {
  const frames = sentTo(out, connection).filter((m): m is Frame => m.type === 'frame');
  const frame = frames.at(-1);
  if (frame === undefined) throw new Error('no frame was sent to that connection');
  return frame;
}
