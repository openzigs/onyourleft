// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A scripted room and a hand-wound clock, for `net/` and the game's tests
 * (#782). Test support, never shipped: nothing under `src/` but a test imports
 * it.
 *
 * ⚠️ **Not the room core.** `apps/instance` may not be imported by the client
 * (ADR 0036 D-3 (a), `boundaries/dependencies`), so this plays the room's
 * half of the wire by hand: it welcomes, refuses, sends frames and closes, and
 * keeps every message the client sent, decoded by the real
 * `@onyourleft/protocol` decoder. What a REAL room does with them is
 * `browser/room.browser.spec.ts`, against a running instance.
 */

import {
  decodeClientMessage,
  encodeMessage,
  FRAME_INTERVAL_MS,
  REPORT_INTERVAL_MS,
  type ClientMessage,
  type FrameRider,
  type RoomMessage,
} from '@onyourleft/protocol';
import { PHYSICS_VERSION } from '@onyourleft/physics';

import type { InstanceSocketEvents } from '../instance/instance-transport';
import type { RoomLink, RoomTimers, TicketAnswer } from './room-session';

/** Timers that fire only when the test says time has passed. */
export class ManualClock implements RoomTimers {
  #now = 0;
  #next = 1;
  readonly #pending = new Map<number, { readonly at: number; readonly run: () => void }>();

  now = (): number => this.#now;

  setTimeout(run: () => void, ms: number): unknown {
    const handle = this.#next;
    this.#next += 1;
    this.#pending.set(handle, { at: this.#now + ms, run });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.#pending.delete(handle as number);
  }

  /** Move time on by `ms`, firing every timer due on the way, in order. */
  async advance(ms: number): Promise<void> {
    const end = this.#now + ms;
    for (;;) {
      let due: [number, { readonly at: number; readonly run: () => void }] | undefined;
      for (const entry of this.#pending) {
        if (entry[1].at <= end && (due === undefined || entry[1].at < due[1].at)) due = entry;
      }
      if (due === undefined) break;
      this.#pending.delete(due[0]);
      this.#now = Math.max(this.#now, due[1].at);
      due[1].run();
      await flush();
    }
    this.#now = end;
    await flush();
  }
}

/** Lets every settled promise run its continuations. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

/** One socket the client opened on the scripted room. */
export interface ScriptedSocket {
  readonly events: InstanceSocketEvents;
  /** Every message the client sent on it, decoded by the room's own decoder. */
  readonly sent: ClientMessage[];
  /** The raw text, for a test that walks it. */
  readonly texts: string[];
  open: boolean;
  closedByClient: boolean;
}

/** A room played by hand. */
export class ScriptedRoom {
  readonly sockets: ScriptedSocket[] = [];
  readonly tickets: string[] = [];
  /** What a ticket request answers. */
  ticketAnswer: () => TicketAnswer = () => ({
    kind: 'ticket',
    ticket: `ticket-${String(this.tickets.length)}`,
  });
  /** The masses tickets were asked with. */
  readonly masses: number[] = [];

  /** The link a session reaches this room through. */
  link(declaredMassKilograms = 72): RoomLink {
    return {
      ticket: () => {
        this.masses.push(declaredMassKilograms);
        const answer = this.ticketAnswer();
        if (answer.kind === 'ticket') this.tickets.push(answer.ticket);
        return Promise.resolve(answer);
      },
      open: (_roomId, events) => {
        const socket: ScriptedSocket = {
          events,
          sent: [],
          texts: [],
          open: false,
          closedByClient: false,
        };
        this.sockets.push(socket);
        return {
          send: (text) => {
            if (!socket.open) return;
            socket.texts.push(text);
            const decoded = decodeClientMessage(text, { physicsVersion: PHYSICS_VERSION });
            if (decoded.ok) socket.sent.push(decoded.message);
          },
          close: () => {
            if (!socket.open) return;
            socket.open = false;
            socket.closedByClient = true;
            events.onClose(1000, 'left');
          },
        };
      },
    };
  }

  /** The newest socket. */
  get socket(): ScriptedSocket {
    const socket = this.sockets.at(-1);
    if (socket === undefined) throw new Error('no socket was opened');
    return socket;
  }

  /** The newest socket opens. */
  accept(): void {
    this.socket.open = true;
    this.socket.events.onOpen();
  }

  send(message: RoomMessage): void {
    this.socket.events.onText(encodeMessage(message));
  }

  welcome(riderId: number, kind: 'ride' | 'race' = 'ride'): void {
    this.send({
      type: 'welcome',
      riderId,
      routeRef: { sha256: 'a'.repeat(64) },
      roomConfig: {
        kind,
        ridingPosition: 'hoods',
        reportIntervalMs: REPORT_INTERVAL_MS,
        frameIntervalMs: FRAME_INTERVAL_MS,
      },
    });
  }

  frame(tick: number, riders: readonly FrameRider[]): void {
    this.send({ type: 'frame', tick, riders });
  }

  /** The room (or the tunnel in front of it) closes the newest socket. */
  closeFromServer(code = 1006, reason = ''): void {
    const socket = this.socket;
    if (!socket.open) return;
    socket.open = false;
    socket.events.onClose(code, reason);
  }
}

/** A frame rider at `metres` and `metresPerSecond`. */
export function frameRider(riderId: number, metres: number, metresPerSecond = 10): FrameRider {
  return {
    riderId,
    decimetres: Math.floor(metres * 10),
    centimetresPerSecond: Math.round(metresPerSecond * 100),
    draftPercent: 0,
    flags: 0,
  };
}
