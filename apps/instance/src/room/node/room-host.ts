// SPDX-License-Identifier: AGPL-3.0-or-later

import { encodeMessage, MAXIMUM_MESSAGE_BYTES } from '@onyourleft/protocol';
import type { WebSocket } from 'ws';

import { closeFrames, TOO_SLOW, type CloseFrame } from '../close-codes.ts';
import {
  createRoom,
  type Admission,
  type ConnectionId,
  type Outbound,
  type Room,
  type RoomPhase,
} from '../core/room.ts';
import type { RoomSettings } from '../core/settings.ts';

/**
 * The room core (#779) mounted on Node and `ws` — the self-host adapter,
 * [#780](https://github.com/openzigs/onyourleft/issues/780), ADR 0037 D-2's
 * first. One {@link RoomHost} is one room worker's rooms: every socket the
 * router handed this process, every room those sockets are in, and each
 * room's tick.
 *
 * ```text
 * a socket's text ─▶ (a hello: ask the HTTP process for the ticket, once) ─▶ room.receive ─┐
 * a socket closes ─▶ room.disconnect                                                        ├─▶ send / close
 * the tick timer  ─▶ room.tick ─────────────────────────────────────────────────────────────┘
 * ```
 *
 * The core is mounted **unchanged**, as the Durable Object adapter mounts it,
 * and `../conformance.test.ts` holds both to the core byte for byte.
 *
 * ## A ticket is looked up once, at hello, in another process
 *
 * The ticket book is the HTTP process's (`auth/tickets.ts`, minted by
 * `POST /v1/rooms/{roomId}/ticket`), and the room core's admission is
 * synchronous. So a hello is held while {@link HostOptions.admit} asks for
 * the ticket — one IPC round trip — and the room is then handed the answer:
 * its admission reads the one it was given and spends it. Everything the same
 * socket sends meanwhile waits behind the hello, in order; nothing else in
 * the room waits at all. A report never costs a round trip.
 *
 * ## Backpressure: a client that stops reading is let go
 *
 * `ws` never blocks a send; what a client does not read waits in its socket's
 * buffer, in THIS process's memory. After every send the host reads the
 * socket's `bufferedAmount`, and past {@link HostOptions.maxBufferedBytes} it
 * terminates the socket (its bytes cannot drain, so a close frame could not
 * reach it either) and tells the room the rider dropped — a held seat,
 * coasting, rejoinable (ADR 0028 D-2 rule 1). The tick for everybody else is
 * never waited on: it is one synchronous call and a write per socket.
 *
 * ## Keepalive — the tunnel closes an idle socket
 *
 * Every {@link HostOptions.pingIntervalMs} each socket is sent a WebSocket
 * protocol ping, which keeps a quiet lobby's socket alive through a proxy that
 * closes idle connections (Cloudflare's tunnel, ADR 0037 D-8.1: the host's
 * own ping, beside the client's). A socket that has not answered the previous
 * ping — no pong and no message — is terminated as dead.
 *
 * ## Results
 *
 * A race rider's result is final once they cross the line or run out of
 * rejoin window, and it is handed to {@link HostOptions.onResult} THEN, not at
 * the end of the race — so a shutdown mid-race loses nothing already final.
 * Room workers never open the database (ADR 0037 D-5); the HTTP process
 * writes it.
 */

/** A timer, as `setTimeout` gives one. */
export type TimerHandle = ReturnType<typeof setTimeout>;

export interface HostOptions {
  /** The rooms' time, in milliseconds. `Date.now` in production. */
  readonly now: () => number;
  /**
   * Run `fn` after `delayMs` of ROOM time. `setTimeout` in production; a test
   * may run the rooms' clock faster than the wall's.
   */
  readonly setTimer?: (fn: () => void, delayMs: number) => TimerHandle;
  readonly clearTimer?: (handle: TimerHandle) => void;
  /** The ticket's admission, looked up once per hello. `undefined` refuses it. */
  readonly admit: (roomId: string, ticket: string) => Promise<Admission | undefined>;
  /** A rider's final result: they finished, or did not and cannot come back. */
  readonly onResult?: (roomId: string, result: RoomResult) => void;
  /**
   * A race has left its lobby. From here it can never be opened again as a
   * lobby — not after it finishes, and not after the instance restarts in the
   * middle of it (#807: an interrupted race does not resume). The HTTP
   * process records it, as the Durable Object keeps its `left-lobby` marker.
   */
  readonly onRaceStarted?: (roomId: string) => void;
  /** A room has closed and holds no socket: forget where it was placed. */
  readonly onRoomClosed?: (roomId: string) => void;
  /** A socket this host held has closed, however it closed. */
  readonly onSocketClosed?: (socketId: string) => void;
  /** Unsent bytes past which a client is terminated. {@link DEFAULT_MAXIMUM_BUFFERED_BYTES}. */
  readonly maxBufferedBytes?: number;
  /** How often each socket is pinged, in wall milliseconds. `0` sends no ping. */
  readonly pingIntervalMs?: number;
  /**
   * `true` when a test fires the ticks itself (the conformance script): no
   * tick timer is ever set. Production leaves it unset.
   */
  readonly driven?: boolean;
  /** Called once a socket's message or close has been handled: tests wait on it. */
  readonly onHandled?: (roomId: string, connection: ConnectionId) => void;
}

export interface RoomResult {
  readonly athleteId: string;
  /** Milliseconds from the start to the line, or `null` for a rider who did not finish. */
  readonly finishMs: number | null;
  readonly flags: number;
}

/**
 * About twenty-five seconds of a 100-rider room's frames (~10 KB each at
 * 1 Hz, `@onyourleft/protocol`'s frame-size test) — room enough for a phone
 * changing network to catch up, and small enough that a thousand stalled
 * sockets hold 256 MB, not gigabytes. ⚠️ The author's choice, stated so an
 * operator can see it; #792's load run is what would move it.
 */
export const DEFAULT_MAXIMUM_BUFFERED_BYTES = 256 * 1024;

/**
 * Twenty-five seconds: under ADR 0037 D-8.1's thirty-second client ping, and
 * a quarter of the ~100 s idle timeout reported for Cloudflare's proxy — #807
 * records the timeout actually observed through the owner's tunnel.
 */
export const DEFAULT_PING_INTERVAL_MS = 25_000;

/** How many tick latenesses a host keeps for its percentiles: ten minutes of one room. */
const LATENESS_SAMPLES = 600;

interface Connection {
  readonly id: ConnectionId;
  readonly socketId: string;
  readonly socket: WebSocket;
  /** The room closed it: its later `close` event is not a rider dropping. */
  closedByRoom: boolean;
  /** Terminated or gone: nothing more is sent to it. */
  gone: boolean;
  /** Everything this socket sent is handled in order through this chain. */
  chain: Promise<void>;
  /** Answered the last ping, or sent something since it. */
  alive: boolean;
  /** Messages sent to it, closes included: tests compare it with what arrived. */
  sent: number;
}

interface HostedRoom {
  readonly roomId: string;
  readonly settings: RoomSettings;
  readonly room: Room;
  readonly connections: Map<ConnectionId, Connection>;
  nextConnection: number;
  /** Admissions fetched for a hello, spent by the room's own admission. */
  readonly admitted: Map<string, Admission | undefined>;
  timer: TimerHandle | undefined;
  nextTickAtMs: number | undefined;
  /** Athletes whose result has been handed on. */
  readonly reported: Set<string>;
  raceStarted: boolean;
}

export interface HostMetrics {
  readonly rooms: number;
  readonly connectedRiders: number;
  /** Milliseconds a tick ran after it was due: the 50th and 99th percentiles, or `null` before any tick. */
  readonly tickLatenessP50Ms: number | null;
  readonly tickLatenessP99Ms: number | null;
  readonly refusals: Readonly<Record<string, number>>;
}

function isTicking(phase: RoomPhase): boolean {
  return phase === 'countdown' || phase === 'running';
}

/** The ticket a text carries if it is a hello, without deciding anything else about it. */
function helloTicket(text: string): string | undefined {
  if (text.length > MAXIMUM_MESSAGE_BYTES) return undefined;
  try {
    const parsed = JSON.parse(text) as { type?: unknown; ticket?: unknown };
    return parsed.type === 'hello' && typeof parsed.ticket === 'string' ? parsed.ticket : undefined;
  } catch {
    return undefined;
  }
}

function percentile(sorted: readonly number[], share: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? null;
}

export class RoomHost {
  readonly #options: HostOptions;
  readonly #rooms = new Map<string, HostedRoom>();
  readonly #lateness: number[] = [];
  readonly #refusals = new Map<string, number>();
  readonly #pinger: TimerHandle | undefined;
  #stopping = false;

  constructor(options: HostOptions) {
    this.#options = options;
    const interval = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
    if (interval > 0) {
      this.#pinger = setInterval(() => this.#ping(), interval);
      this.#pinger.unref();
    }
  }

  /** Takes a socket the router placed here, for room `roomId` with these settings. */
  accept(roomId: string, settings: RoomSettings, socket: WebSocket, socketId: string): void {
    if (this.#stopping) {
      socket.close(1001, 'server-stopping');
      return;
    }
    const hosted = this.#rooms.get(roomId) ?? this.#open(roomId, settings);
    const connection: Connection = {
      id: hosted.nextConnection,
      socketId,
      socket,
      closedByRoom: false,
      gone: false,
      chain: Promise.resolve(),
      alive: true,
      sent: 0,
    };
    hosted.nextConnection += 1;
    hosted.connections.set(connection.id, connection);
    socket.on('message', (data, isBinary) => {
      connection.alive = true;
      // The protocol is text; a binary frame is not a message and is dropped,
      // as a malformed report from a rider is (and as the Durable Object does).
      if (isBinary) return;
      const text = (data as Buffer).toString('utf8');
      connection.chain = connection.chain.then(() => this.#receive(hosted, connection, text));
    });
    socket.on('pong', () => {
      connection.alive = true;
    });
    socket.on('error', () => {
      // A socket error is followed by its close; the close is what is handled.
    });
    socket.on('close', () => {
      connection.chain = connection.chain.then(() => this.#closed(hosted, connection));
    });
  }

  /**
   * Starts a race's countdown. With `athleteId`, only if that athlete has a
   * connected seat in it — the provisional rule until #785 decides who may.
   */
  start(roomId: string, athleteId?: string): boolean {
    const hosted = this.#rooms.get(roomId);
    if (hosted === undefined) return false;
    if (
      athleteId !== undefined &&
      !hosted.room
        .view()
        .seats.some((seat) => seat.athleteId === athleteId && seat.state === 'connected')
    ) {
      return false;
    }
    this.#call(hosted, (room) => room.start(this.#options.now()));
    return true;
  }

  /** One tick of `roomId` now — what the timer does, and what a driven test does itself. */
  tick(roomId: string): void {
    const hosted = this.#rooms.get(roomId);
    if (hosted !== undefined) this.#tick(hosted, undefined);
  }

  /** Where a room is, for a test or a status line. */
  view(roomId: string) {
    return this.#rooms.get(roomId)?.room.view();
  }

  /** How many messages (closes included) each connection of a room has been sent. */
  sentCounts(roomId: string): ReadonlyMap<ConnectionId, number> {
    const hosted = this.#rooms.get(roomId);
    return new Map([...(hosted?.connections ?? [])].map(([id, c]) => [id, c.sent]));
  }

  /** Forgets every tick lateness so far: the next percentiles are of a window that starts now. */
  resetTickLateness(): void {
    this.#lateness.length = 0;
  }

  metrics(): HostMetrics {
    const sorted = [...this.#lateness].sort((a, b) => a - b);
    let riders = 0;
    for (const hosted of this.#rooms.values()) {
      for (const seat of hosted.room.view().seats) if (seat.state === 'connected') riders += 1;
    }
    return {
      rooms: this.#rooms.size,
      connectedRiders: riders,
      tickLatenessP50Ms: percentile(sorted, 0.5),
      tickLatenessP99Ms: percentile(sorted, 0.99),
      refusals: Object.fromEntries(this.#refusals),
    };
  }

  /**
   * The instance is stopping: every socket is closed `1001 server-stopping`,
   * no room ticks again, and a race in progress is not resumed — its results
   * already final were handed on when they became final. Resolves once every
   * socket has closed, or after `graceMs`.
   */
  async stop(frame: CloseFrame, graceMs = 2_000): Promise<void> {
    this.#stopping = true;
    if (this.#pinger !== undefined) clearInterval(this.#pinger);
    const closing: Promise<void>[] = [];
    for (const hosted of this.#rooms.values()) {
      this.#stopTimer(hosted);
      for (const connection of hosted.connections.values()) {
        if (connection.gone) continue;
        connection.closedByRoom = true;
        closing.push(
          new Promise((done) => {
            connection.socket.once('close', () => done());
          }),
        );
        connection.socket.close(frame.code, frame.reason);
      }
    }
    let timer: TimerHandle | undefined;
    await Promise.race([
      Promise.all(closing),
      new Promise<void>((done) => {
        timer = setTimeout(done, graceMs);
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    for (const hosted of this.#rooms.values()) {
      for (const connection of hosted.connections.values()) connection.socket.terminate();
    }
  }

  #open(roomId: string, settings: RoomSettings): HostedRoom {
    const admitted = new Map<string, Admission | undefined>();
    const hosted: HostedRoom = {
      roomId,
      settings,
      // The core's admission is synchronous; the answer was fetched before the
      // hello reached it (`#receive`), and is spent here.
      room: createRoom(settings, (ticket) => {
        const admission = admitted.get(ticket);
        admitted.delete(ticket);
        return admission;
      }),
      connections: new Map(),
      nextConnection: 1,
      admitted,
      timer: undefined,
      nextTickAtMs: undefined,
      reported: new Set(),
      raceStarted: false,
    };
    this.#rooms.set(roomId, hosted);
    return hosted;
  }

  async #receive(hosted: HostedRoom, connection: Connection, text: string): Promise<void> {
    if (connection.gone) return;
    const ticket = helloTicket(text);
    if (ticket !== undefined && !hosted.admitted.has(ticket)) {
      const admission = await this.#options.admit(hosted.roomId, ticket).catch(() => undefined);
      hosted.admitted.set(ticket, admission);
    }
    if (!connection.gone) {
      this.#call(hosted, (room) => room.receive(connection.id, text, this.#options.now()));
    }
    // An admission the room did not spend (the socket was already seated) is dropped.
    if (ticket !== undefined) hosted.admitted.delete(ticket);
    this.#options.onHandled?.(hosted.roomId, connection.id);
  }

  #closed(hosted: HostedRoom, connection: Connection): void {
    const wasGone = connection.gone;
    connection.gone = true;
    // A socket the room closed, or one terminated for backpressure (the room
    // was told then), is not a rider dropping now.
    if (!connection.closedByRoom && !wasGone) {
      this.#call(hosted, (room) => room.disconnect(connection.id, this.#options.now()));
    }
    hosted.connections.delete(connection.id);
    this.#options.onSocketClosed?.(connection.socketId);
    this.#options.onHandled?.(hosted.roomId, connection.id);
    this.#closeIfDone(hosted);
  }

  /** One call to the core, what it says applied, and the next tick asked for. */
  #call(hosted: HostedRoom, run: (room: Room) => Outbound[]): void {
    this.#apply(hosted, run(hosted.room));
    this.#afterCall(hosted);
  }

  #afterCall(hosted: HostedRoom): void {
    this.#reportResults(hosted);
    const phase = hosted.room.view().phase;
    if (hosted.settings.kind === 'race' && phase !== 'lobby' && !hosted.raceStarted) {
      hosted.raceStarted = true;
      this.#options.onRaceStarted?.(hosted.roomId);
    }
    if (isTicking(phase)) this.#scheduleTick(hosted);
    else this.#stopTimer(hosted);
    this.#closeIfDone(hosted);
  }

  #apply(hosted: HostedRoom, out: readonly Outbound[]): void {
    const frames = closeFrames(out);
    const maximum = this.#options.maxBufferedBytes ?? DEFAULT_MAXIMUM_BUFFERED_BYTES;
    const dropped: Connection[] = [];
    for (const o of out) {
      const connection = hosted.connections.get(o.connection);
      if (connection === undefined || connection.gone) continue;
      if (o.kind === 'send') {
        if (o.message.type === 'refuse') this.#count(o.message.reason);
        connection.sent += 1;
        connection.socket.send(encodeMessage(o.message));
        if (connection.socket.bufferedAmount > maximum && !dropped.includes(connection)) {
          dropped.push(connection);
        }
      } else {
        const frame = frames.get(o.connection);
        connection.closedByRoom = true;
        connection.sent += 1;
        connection.socket.close(frame?.code, frame?.reason);
      }
    }
    for (const connection of dropped) {
      if (connection.gone) continue;
      // Its bytes cannot drain, so a close frame would not reach it: terminate.
      connection.gone = true;
      this.#count(TOO_SLOW.reason);
      connection.socket.terminate();
      this.#apply(hosted, hosted.room.disconnect(connection.id, this.#options.now()));
    }
  }

  #count(reason: string): void {
    this.#refusals.set(reason, (this.#refusals.get(reason) ?? 0) + 1);
  }

  #reportResults(hosted: HostedRoom): void {
    if (hosted.settings.kind !== 'race' || this.#options.onResult === undefined) return;
    for (const seat of hosted.room.view().seats) {
      if (hosted.reported.has(seat.athleteId)) continue;
      if (seat.state !== 'finished' && seat.state !== 'dnf') continue;
      hosted.reported.add(seat.athleteId);
      this.#options.onResult(hosted.roomId, {
        athleteId: seat.athleteId,
        finishMs:
          seat.finishedAtTicks === null
            ? null
            : Math.round(seat.finishedAtTicks * hosted.settings.frameIntervalMs),
        flags: seat.flags,
      });
    }
  }

  #scheduleTick(hosted: HostedRoom): void {
    if (this.#options.driven === true || hosted.timer !== undefined || this.#stopping) return;
    const now = this.#options.now();
    const { frameIntervalMs } = hosted.settings;
    let at = (hosted.nextTickAtMs ?? now) + frameIntervalMs;
    // A tick that ran more than a frame late does not try to catch up.
    if (at <= now) at = now + frameIntervalMs;
    hosted.nextTickAtMs = at;
    const set = this.#options.setTimer ?? setTimeout;
    hosted.timer = set(() => {
      hosted.timer = undefined;
      this.#tick(hosted, at);
    }, at - now);
  }

  #stopTimer(hosted: HostedRoom): void {
    if (hosted.timer !== undefined) (this.#options.clearTimer ?? clearTimeout)(hosted.timer);
    hosted.timer = undefined;
    hosted.nextTickAtMs = undefined;
  }

  #tick(hosted: HostedRoom, dueAtMs: number | undefined): void {
    const now = this.#options.now();
    if (dueAtMs !== undefined) {
      this.#lateness.push(Math.max(0, now - dueAtMs));
      if (this.#lateness.length > LATENESS_SAMPLES) this.#lateness.shift();
    }
    this.#call(hosted, (room) => room.tick(now));
  }

  #closeIfDone(hosted: HostedRoom): void {
    if (hosted.connections.size > 0) return;
    const phase = hosted.room.view().phase;
    // A room nobody is in and nothing is ticking for is let go: a closed ride,
    // a finished race, or a lobby everybody left. A race still running keeps
    // ticking with nobody connected until its rejoin windows close (#781's
    // rule, the same on this adapter).
    if (isTicking(phase)) return;
    this.#stopTimer(hosted);
    this.#rooms.delete(hosted.roomId);
    this.#options.onRoomClosed?.(hosted.roomId);
  }

  #ping(): void {
    for (const hosted of this.#rooms.values()) {
      for (const connection of hosted.connections.values()) {
        if (connection.gone) continue;
        if (!connection.alive) {
          connection.socket.terminate();
          continue;
        }
        connection.alive = false;
        connection.socket.ping();
      }
    }
  }
}
