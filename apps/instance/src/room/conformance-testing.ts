// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One script, any adapter — the conformance suite's driver (#781, ADR 0037
 * D-2). Test support, never mounted.
 *
 * An adapter is held to the room core through the calls a real client and a
 * real clock make: sockets open, text arrives, sockets close, a race is
 * started, the room ticks. Every one of them happens at a room time the script
 * names, so two adapters driven by it must send **byte-identical text** to
 * every socket. The reference is the core driven directly ({@link coreRoom});
 * the Durable Object adapter is held to it under fakes in every test run and
 * under a real `workerd` by `test:workerd`; #780 adds the Node adapter as one
 * more {@link RoomUnderTest} and changes nothing else.
 */

import { encodeMessage } from '@onyourleft/protocol';

import { createRoom, type Admit, type Outbound } from './core/room.ts';
import { helloText, reportText } from './core/room-testing.ts';
import type { RoomSettings } from './core/settings.ts';

/** What a transcript records when the ROOM closes a socket. A client's own hang-up records nothing. */
export const CLOSED_BY_ROOM = '⟂ closed by the room';

/** Every text each socket was sent, by the script's name for it, in order. */
export type Transcript = Readonly<Record<string, readonly string[]>>;

/**
 * An adapter, as the script drives it. Each method resolves only once the
 * adapter has finished with the call, so the next one is not raced against it.
 */
export interface RoomUnderTest {
  readonly name: string;
  /** Opens a socket the script will call `label`. */
  connect(label: string): Promise<void>;
  /** The socket `label` sends `text`, arriving at room time `atMs`. */
  send(label: string, text: string, atMs: number): Promise<void>;
  /** The client closes socket `label` at room time `atMs`. */
  hangUp(label: string, atMs: number): Promise<void>;
  start(atMs: number): Promise<void>;
  /** The room's tick falls due at `atMs`. */
  tick(atMs: number): Promise<void>;
  transcript(): Promise<Transcript>;
  dispose(): Promise<void>;
}

/** The reference: the core itself, its outbound encoded as every adapter must encode it. */
export function coreRoom(settings: RoomSettings, admit: Admit): RoomUnderTest {
  const room = createRoom(settings, admit);
  const connections = new Map<string, number>();
  const sent = new Map<string, string[]>();
  const labels = new Map<number, string>();

  function apply(out: readonly Outbound[]): void {
    for (const o of out) {
      const label = labels.get(o.connection);
      if (label === undefined) continue;
      sent.get(label)?.push(o.kind === 'send' ? encodeMessage(o.message) : CLOSED_BY_ROOM);
    }
  }
  function id(label: string): number {
    const connection = connections.get(label);
    if (connection === undefined) throw new Error(`no socket called ${label}`);
    return connection;
  }

  return {
    name: 'the room core (reference)',
    connect(label) {
      const connection = connections.size + 1;
      connections.set(label, connection);
      labels.set(connection, label);
      sent.set(label, []);
      return Promise.resolve();
    },
    send(label, text, atMs) {
      apply(room.receive(id(label), text, atMs));
      return Promise.resolve();
    },
    hangUp(label, atMs) {
      apply(room.disconnect(id(label), atMs));
      return Promise.resolve();
    },
    start(atMs) {
      apply(room.start(atMs));
      return Promise.resolve();
    },
    tick(atMs) {
      apply(room.tick(atMs));
      return Promise.resolve();
    },
    transcript() {
      return Promise.resolve(Object.fromEntries(sent));
    },
    dispose() {
      return Promise.resolve();
    },
  };
}

/** When the script's ticks fall due: the first a second after `start`, and 66 of them. */
export const SCRIPT_TICKS = Array.from({ length: 66 }, (_, k) => 1_500 + k * 1_000);

/**
 * join → start → sixty ticks → finish → rejoin, with the awkward parts a real
 * room meets on the way: a forged ticket, a report in the lobby, two clients
 * whose clocks are nowhere near the room's, a malformed report, a replayed
 * sequence, a rider who drops out for five seconds and comes back on a new
 * socket, and a rider who tries to come back after the race is over.
 */
export async function rideTheScript(room: RoomUnderTest): Promise<Transcript> {
  // Each client's own clock: Ann's phone is a million milliseconds ahead of the
  // room; Bea's tab has counted from when it opened; her second socket is a
  // relaunched app, counting from somewhere else again.
  const annClock = (t: number) => t + 1_000_000;
  const beaClock = (t: number) => t + 42;
  const beaAgainClock = (t: number) => t + 9_000;

  await room.connect('ann');
  await room.send('ann', helloText('ticket-ann'), 0);
  await room.connect('bea');
  await room.send('bea', helloText('ticket-bea'), 10);
  await room.connect('forger');
  await room.send('forger', helloText('forged'), 20);
  await room.send('ann', reportText(1, annClock(100), 90), 100);
  await room.start(500);

  let annSequence = 2;
  let beaSequence = 1;
  let beaSocket: 'bea' | 'bea-again' | undefined = 'bea';
  for (const [index, tickAtMs] of SCRIPT_TICKS.entries()) {
    const reportAtMs = tickAtMs - 500;
    const power = 240 + ((index * 37) % 80);
    await room.send('ann', reportText(annSequence, annClock(reportAtMs), power), reportAtMs);
    if (index === 9) {
      // A replay of the report just admitted: refused, and Ann coasts nothing for it.
      await room.send('ann', reportText(annSequence, annClock(reportAtMs), 900), reportAtMs + 50);
    }
    if (index === 12) {
      await room.send('ann', '{"type":"report"}', reportAtMs + 60);
    }
    annSequence += 1;
    if (index === 18) {
      await room.hangUp('bea', reportAtMs + 100);
      beaSocket = undefined;
    }
    if (index === 23) {
      await room.connect('bea-again');
      await room.send('bea-again', helloText('ticket-bea'), reportAtMs + 100);
      beaSocket = 'bea-again';
      beaSequence = 1;
    }
    if (beaSocket !== undefined) {
      const clock = beaSocket === 'bea' ? beaClock : beaAgainClock;
      await room.send(
        beaSocket,
        reportText(beaSequence, clock(reportAtMs + 150), power - 20),
        reportAtMs + 150,
      );
      beaSequence += 1;
    }
    await room.tick(tickAtMs);
  }
  const afterMs = (SCRIPT_TICKS.at(-1) ?? 0) + 500;
  await room.connect('ann-again');
  await room.send('ann-again', helloText('ticket-ann'), afterMs);
  return room.transcript();
}
