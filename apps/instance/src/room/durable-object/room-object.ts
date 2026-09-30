// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The room core (#779) mounted as a Cloudflare Durable Object — one object per
 * room — [#781](https://github.com/openzigs/onyourleft/issues/781), ADR 0037 D-2's
 * second adapter. The self-host adapter (#780) is the reference; this one is
 * **built and not deployed** (the owner's Q3/Q6 answer, 2026-09-28).
 *
 * ```text
 * a socket's text ─▶ webSocketMessage ─▶ room.receive ─┐
 * a socket closes ─▶ webSocketClose   ─▶ room.disconnect ├─▶ Outbound[] ─▶ send / close
 * POST …/start    ─▶ fetch            ─▶ room.start     │
 * the alarm       ─▶ alarm            ─▶ room.tick ─────┘   and the next alarm, while it runs
 * ```
 *
 * The core is mounted **unchanged**. Everything here is what the core leaves
 * to an adapter: which socket is which connection, what time it is, when the
 * next tick is, and — the one thing a Durable Object needs that a Node process
 * does not — how a room survives being evicted from memory.
 *
 * ## The tick is an alarm, and a ticking room is billed for all of it
 *
 * While the room is in its countdown or running, each tick schedules the next
 * with `storage.setAlarm`, one `frameIntervalMs` on from the one it replaced.
 * When a tick leaves the room anywhere else — a race `finished` because every
 * rider crossed the line or ran out of rejoin window, a ride `closed` because
 * it stayed empty — **no next alarm is set, and the room stops**. That is what
 * stops a room with nobody in it billing for ever: the core already decides
 * when a held seat's rejoin window closes, so the adapter only has to stop
 * asking. ⚠️ An alarm prevents hibernation (developers.cloudflare.com, quoted
 * in #781), so a room is billed for the whole of a race (ADR 0037 D-4).
 *
 * ## The lobby hibernates, and comes back from a log
 *
 * Every socket is accepted through the Hibernation API
 * (`state.acceptWebSocket`), so a lobby with no alarm is evicted after about
 * ten seconds of quiet and costs nothing while it waits. Its sockets stay
 * open; everything in memory — the core's closure above all — is gone.
 *
 * What comes back, and from where:
 *
 * - **Which socket is which connection** from each socket's **attachment**
 *   (`serializeAttachment({ connection })`, a few bytes of the 16 384 allowed).
 * - **The room** by replaying the **lobby log** in storage: every call this
 *   adapter made to the core while it was in the lobby, with its time and the
 *   answers the admission gave, in order. Attachments alone cannot hold a
 *   lobby: a rider who left takes their socket and its attachment with them,
 *   and the next rider's seat number depends on them having been there.
 *   Replaying the core's own calls needs no knowledge of the core's insides:
 *   the same calls to the same core give the same room, which is
 *   `room.test.ts`'s determinism claim. ⚠️ **The same core** is the condition,
 *   and a code release breaks it: a release restarts the object (ADR 0037
 *   D-8.2), and the new core replays a log the old one wrote. If the core's
 *   behaviour changed in between, the restored lobby can differ from what its
 *   still-open sockets were told. The log carries no version, so nothing
 *   detects that; a lobby that spans a release is the case it can happen in.
 * - **The admission is not asked again** on a replay: the log holds what it
 *   answered, so a ticket that has since expired, or an admission that costs a
 *   round trip, does not change a restored lobby.
 *
 * ⚠️ **A room that has left the lobby is not restored.** Its log is deleted as
 * it leaves (it could not replay a race: a race is ticks, and ticks read the
 * clock), and a marker is written instead. A running room keeps an alarm and
 * so is not evicted for being idle, but the platform may still restart it — a
 * code release restarts servers and drops their WebSockets (ADR 0037 D-8.2).
 * An object that wakes to find the marker tells each socket it still holds
 * `refuse room-closed`, closes it, and refuses new ones with 410: a lost race is
 * said to be lost rather than reopened as an empty lobby.
 *
 * ## Tickets: one lookup at hello, and never per message
 *
 * The core asks its admission once, when a hello arrives, and never for a
 * report (`room.ts` §`hello`). So a ticket is verified **once per
 * connection**, and a report costs no round trip.
 *
 * **Which: one lookup, in this object's own book** (#780's wiring of #772's
 * `auth/tickets.ts`). A ticket is thirty seconds, one room and one hello, and
 * a room is one object — so the book that minted a ticket can be the book the
 * room asks, in memory, with nothing signed and no key to hold or rotate. The
 * Worker in front authenticates the rider's session and posts
 * `{athleteId, declaredMassKilograms}` to `POST …/tickets`; the object mints
 * from {@link DurableRoomOptions.tickets} and answers `{ticket, expiresAtMs}`.
 * ⚠️ That path trusts its caller: the Worker in front (#790) must never route
 * a client's own request to it. An eviction forgets every unspent ticket,
 * which only means a rider asks for another; a signed ticket would survive
 * one and was not worth a key for that.
 *
 * ## The keepalive is the platform's
 *
 * ADR 0037 D-4: on this adapter the keepalive must be a WebSocket **protocol**
 * ping, because the rate card charges an application-level heartbeat and does
 * not charge a protocol ping. The runtime answers a protocol ping itself,
 * without waking this object, so there is nothing to write here — and nothing
 * here may answer a text "ping", which would be billed.
 *
 * ## What this does not decide
 *
 * - **Which room an object serves, and where its course comes from.** The
 *   Worker in front routes a room's name to its object and supplies its
 *   settings; that is #790's, with the question of whether this platform hosts
 *   rooms only or the whole instance (ADR 0037 D-2).
 * - **Who may start a race.** `POST …/start` starts it; the Worker in front is
 *   what decides who may send that. #785 decided the rule — any rider seated
 *   and connected in the race (`room/node/room-host.ts` §`start`) — and the
 *   Worker in front (#790) is what will apply it here.
 */

import { encodeMessage, type RoomMessage } from '@onyourleft/protocol';

import { closeFrames } from '../close-codes.ts';

import {
  createRoom,
  type Admission,
  type Admit,
  type ConnectionId,
  type Outbound,
  type Room,
  type RoomPhase,
  type RoomView,
} from '../core/room.ts';
import type { RoomSettings } from '../core/settings.ts';
import type {
  DurableObjectContext,
  HibernatableSocket,
  IncomingRequest,
  WorkersPlatform,
} from './platform.ts';

/** Every lobby log entry's key starts with this, and sorts in the order it was written. */
export const LOBBY_LOG_PREFIX = 'lobby/';

/**
 * How many calls a lobby log holds before the lobby stops taking more. A
 * client has nothing to send in a lobby but its hello, so a lobby this busy is
 * being flooded: past the limit a new socket is refused with 503 and a socket
 * that sends anything is closed. Disconnects are still written after the
 * limit, because a seated rider leaving has to be in the log for the replay to
 * be right, and there are only as many of those as sockets already open.
 *
 * ⚠️ This is the one place this adapter can behave differently from the
 * reference for the same inputs, and only past 2 048 calls in one lobby.
 */
export const LOBBY_LOG_LIMIT = 2048;

/**
 * The most keys one storage call may take: 128 per `get`/`put`/`delete` on
 * this platform (developers.cloudflare.com, read 2026-09-29), where a lobby
 * log may hold up to {@link LOBBY_LOG_LIMIT}. So the log is deleted in batches
 * of this. ⚠️ A local `workerd` does not enforce the limit (#781's review
 * measured it), so `FakeStorage.delete` refuses a longer call instead, and is
 * the only thing that would go red if this were one call again.
 */
const STORAGE_KEYS_PER_CALL = 128;

const NEXT_CONNECTION_KEY = 'next-connection';
const LEFT_LOBBY_KEY = 'left-lobby';

/** One call the adapter made to the core while the room was in its lobby. */
export type LobbyEvent =
  | {
      readonly op: 'receive';
      readonly connection: ConnectionId;
      readonly text: string;
      readonly nowMs: number;
      /** What the admission answered during this call, in order; `null` is a refusal. */
      readonly admissions: readonly (Admission | null)[];
    }
  | { readonly op: 'disconnect'; readonly connection: ConnectionId; readonly nowMs: number }
  | { readonly op: 'start'; readonly nowMs: number }
  | { readonly op: 'tick'; readonly nowMs: number };

/** A lobby event before the admission's answers are attached. */
type Call =
  | Omit<Extract<LobbyEvent, { op: 'receive' }>, 'admissions'>
  | Exclude<LobbyEvent, { op: 'receive' }>;

/** A ticket book, as `auth/tickets.ts` builds one: what this adapter mints from and admits by. */
export interface RoomTickets {
  mint(
    roomId: string,
    admission: Admission,
  ): { readonly ticket: string; readonly expiresAtMs: number };
  admitterFor(roomId: string): Admit;
}

export interface DurableRoomOptions<Reply> {
  readonly settings: RoomSettings;
  /**
   * Verifies a hello's ticket. Called once per hello, never per report.
   * Absent, the room admits by {@link tickets}' book for {@link roomId}.
   */
  readonly admit?: Admit;
  /** The book `POST …/tickets` mints from, and the room admits by when no `admit` is given. */
  readonly tickets?: RoomTickets;
  /** This object's room, as the book names it. Required with `tickets`. */
  readonly roomId?: string;
  /** The room's time, in milliseconds. `Date.now` under `workerd`. */
  readonly now: () => number;
  readonly platform: WorkersPlatform<Reply>;
  /**
   * Asks for `alarm()` at room time `atMs`. `storage.setAlarm` unless a test
   * drives the ticks itself — the conformance suite does, at the times it names.
   */
  readonly scheduleTick?: (atMs: number) => Promise<void>;
}

/** What the adapter holds in memory, and loses on eviction. */
interface Live {
  room: Room;
  readonly sockets: Map<ConnectionId, HibernatableSocket>;
  nextConnection: number;
  lobbyLength: number;
  /** The object was evicted after its room left the lobby: nothing to restore. */
  lost: boolean;
  /** The alarm this adapter asked for and has not yet had. */
  nextTickAtMs: number | undefined;
  /** During a replay, the admission's recorded answers, consumed in order. */
  replaying: (Admission | null)[] | undefined;
  /** During a live call, the admission's answers, for the log. */
  recorded: (Admission | null)[];
}

function isTicking(phase: RoomPhase): boolean {
  return phase === 'countdown' || phase === 'running';
}

function pathOf(url: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*([^?#]*)/i.exec(url)?.[1] ?? '';
}

/** The connection a socket was accepted as, from its attachment. */
export function connectionOf(socket: HibernatableSocket): ConnectionId | undefined {
  const attachment: unknown = socket.deserializeAttachment();
  if (typeof attachment !== 'object' || attachment === null) return undefined;
  const { connection } = attachment as { readonly connection?: unknown };
  return typeof connection === 'number' && Number.isInteger(connection) && connection > 0
    ? connection
    : undefined;
}

function refusal(): string {
  const message: RoomMessage = { type: 'refuse', reason: 'room-closed' };
  return encodeMessage(message);
}

/**
 * The adapter. `workerd` constructs a Durable Object class with
 * `(state, env)`; whoever mounts this one subclasses it and turns `env` into
 * {@link DurableRoomOptions} (`worker-testing.ts` is the only one today).
 */
export class DurableRoom<Reply> {
  readonly #ctx: DurableObjectContext;
  readonly #options: DurableRoomOptions<Reply>;
  #live: Promise<Live> | undefined;

  constructor(ctx: DurableObjectContext, options: DurableRoomOptions<Reply>) {
    this.#ctx = ctx;
    this.#options = options;
  }

  /** A socket's upgrade, `POST …/start`, or 404. */
  async fetch(request: IncomingRequest): Promise<Reply> {
    const { platform } = this.#options;
    const live = await this.#ready();
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      if (live.lost) return platform.status(410, 'this room was lost when it was evicted');
      if (live.lobbyLength >= LOBBY_LOG_LIMIT) {
        return platform.status(503, 'this lobby is taking no more connections');
      }
      const connection = live.nextConnection;
      live.nextConnection += 1;
      await this.#ctx.storage.put(NEXT_CONNECTION_KEY, live.nextConnection);
      const { client, server } = platform.socketPair();
      this.#ctx.acceptWebSocket(server);
      server.serializeAttachment({ connection });
      live.sockets.set(connection, server);
      return platform.upgraded(client);
    }
    if (request.method === 'POST' && pathOf(request.url).endsWith('/tickets')) {
      return this.#mint(request);
    }
    if (request.method === 'POST' && pathOf(request.url).endsWith('/start')) {
      if (live.lost) return platform.status(410, 'this room was lost when it was evicted');
      const nowMs = this.#options.now();
      await this.#call(live, { op: 'start', nowMs }, (room) => room.start(nowMs));
      return platform.status(200, 'started');
    }
    return platform.status(404, 'not found');
  }

  /** `POST …/tickets` from the Worker in front: a ticket for one athlete, from this room's book. */
  async #mint(request: IncomingRequest): Promise<Reply> {
    const { platform, tickets, roomId } = this.#options;
    if (tickets === undefined || roomId === undefined || request.text === undefined) {
      return platform.status(404, 'not found');
    }
    let body: unknown;
    try {
      body = JSON.parse(await request.text());
    } catch {
      body = undefined;
    }
    const { athleteId, declaredMassKilograms } = (body ?? {}) as Record<string, unknown>;
    if (
      typeof athleteId !== 'string' ||
      athleteId === '' ||
      typeof declaredMassKilograms !== 'number' ||
      !Number.isFinite(declaredMassKilograms)
    ) {
      return platform.status(400, 'expected {athleteId, declaredMassKilograms}');
    }
    const minted = tickets.mint(roomId, { athleteId, declaredMassKilograms });
    return platform.status(
      200,
      JSON.stringify({ ticket: minted.ticket, expiresAtMs: minted.expiresAtMs }),
    );
  }

  async webSocketMessage(socket: HibernatableSocket, message: string | ArrayBuffer): Promise<void> {
    const live = await this.#ready();
    const connection = connectionOf(socket);
    if (connection === undefined || live.lost) {
      // A socket that throws on the refusal is still closed.
      try {
        if (live.lost) socket.send(refusal());
      } catch {
        // Already going.
      }
      socket.close(1011, 'no room for this socket');
      return;
    }
    // The protocol is text (`@onyourleft/protocol`); a binary frame is not a
    // message and is dropped, as a malformed report from a rider is.
    if (typeof message !== 'string') return;
    const nowMs = this.#options.now();
    if (this.#inLobby(live) && live.lobbyLength >= LOBBY_LOG_LIMIT) {
      live.sockets.delete(connection);
      socket.close(1008, 'this lobby is taking no more messages');
      await this.#call(live, { op: 'disconnect', connection, nowMs }, (room) =>
        room.disconnect(connection, nowMs),
      );
      return;
    }
    await this.#call(live, { op: 'receive', connection, text: message, nowMs }, (room) =>
      room.receive(connection, message, nowMs),
    );
  }

  async webSocketClose(socket: HibernatableSocket): Promise<void> {
    const live = await this.#ready();
    const connection = connectionOf(socket);
    if (connection === undefined) return;
    live.sockets.delete(connection);
    if (live.lost) return;
    const nowMs = this.#options.now();
    await this.#call(live, { op: 'disconnect', connection, nowMs }, (room) =>
      room.disconnect(connection, nowMs),
    );
  }

  /** A socket that errored is a socket that closed. */
  async webSocketError(socket: HibernatableSocket): Promise<void> {
    await this.webSocketClose(socket);
  }

  /** One tick, and the next alarm while the room is still counting down or running. */
  async alarm(): Promise<void> {
    const live = await this.#ready();
    if (live.lost) return;
    const scheduledAtMs = live.nextTickAtMs;
    live.nextTickAtMs = undefined;
    const nowMs = this.#options.now();
    await this.#call(live, { op: 'tick', nowMs }, (room) => room.tick(nowMs), scheduledAtMs);
  }

  /** What an observer may see of the room: a test, a log, a status route. */
  async view(): Promise<RoomView> {
    return (await this.#ready()).room.view();
  }

  /** The alarm this adapter is waiting for, if any. */
  async nextTickAtMs(): Promise<number | undefined> {
    return (await this.#ready()).nextTickAtMs;
  }

  #inLobby(live: Live): boolean {
    return live.room.view().phase === 'lobby';
  }

  /**
   * One call to the core: what it says to send is sent, a lobby call is
   * written to the log, and the next tick is asked for while the room runs.
   */
  async #call(
    live: Live,
    call: Call,
    run: (room: Room) => Outbound[],
    cadenceFromMs?: number,
  ): Promise<void> {
    const before = live.room.view().phase;
    live.recorded = [];
    const out = run(live.room);
    const after = live.room.view().phase;
    this.#apply(live, out);
    if (before === 'lobby') {
      if (after === 'lobby') {
        await this.#log(live, { ...call, admissions: live.recorded } as LobbyEvent);
      } else {
        await this.#leaveLobby(live);
      }
    }
    if (isTicking(after) && live.nextTickAtMs === undefined) {
      const nowMs = this.#options.now();
      const { frameIntervalMs } = this.#options.settings;
      let atMs = (cadenceFromMs ?? nowMs) + frameIntervalMs;
      // An alarm that fired more than a frame late does not try to catch up.
      if (atMs <= nowMs) atMs = nowMs + frameIntervalMs;
      live.nextTickAtMs = atMs;
      await (this.#options.scheduleTick ?? ((at) => this.#ctx.storage.setAlarm(at)))(atMs);
    }
  }

  #apply(live: Live, out: readonly Outbound[]): void {
    const frames = closeFrames(out);
    for (const o of out) {
      const socket = live.sockets.get(o.connection);
      if (socket === undefined) continue;
      if (o.kind === 'send') {
        try {
          socket.send(encodeMessage(o.message));
        } catch {
          // A socket going away while a frame is fanned out: its close event
          // is on its way, and the rest of the room still gets the frame.
        }
      } else {
        live.sockets.delete(o.connection);
        const frame = frames.get(o.connection);
        socket.close(frame?.code, frame?.reason);
      }
    }
  }

  async #log(live: Live, event: LobbyEvent): Promise<void> {
    const key = `${LOBBY_LOG_PREFIX}${String(live.lobbyLength).padStart(8, '0')}`;
    live.lobbyLength += 1;
    await this.#ctx.storage.put(key, event);
  }

  /**
   * ⚠️ The marker and the connection counter are **never cleared**: once a
   * room has left its lobby, this object answers 410 for ever and keeps those
   * two keys in billed storage. Whether a room's name is reused, and when its
   * object's storage is deleted, is the Worker in front's to decide —
   * [#790](https://github.com/openzigs/onyourleft/issues/790).
   */
  async #leaveLobby(live: Live): Promise<void> {
    const keys = [...(await this.#ctx.storage.list({ prefix: LOBBY_LOG_PREFIX })).keys()];
    for (let from = 0; from < keys.length; from += STORAGE_KEYS_PER_CALL) {
      await this.#ctx.storage.delete(keys.slice(from, from + STORAGE_KEYS_PER_CALL));
    }
    live.lobbyLength = 0;
    await this.#ctx.storage.put(LEFT_LOBBY_KEY, true);
  }

  #admitter(): Admit {
    const { admit, tickets, roomId } = this.#options;
    if (admit !== undefined) return admit;
    if (tickets !== undefined && roomId !== undefined) return tickets.admitterFor(roomId);
    return () => undefined;
  }

  #ready(): Promise<Live> {
    this.#live ??= this.#restore();
    return this.#live;
  }

  #admit(live: Live, ticket: string): Admission | undefined {
    if (live.replaying !== undefined) {
      return live.replaying.shift() ?? undefined;
    }
    const admission = this.#admitter()(ticket);
    live.recorded.push(admission ?? null);
    return admission;
  }

  /**
   * Everything in memory, from storage and the sockets' attachments — on the
   * object's first event, and on its first event after an eviction.
   */
  async #restore(): Promise<Live> {
    const { storage } = this.#ctx;
    const sockets = new Map<ConnectionId, HibernatableSocket>();
    for (const socket of this.#ctx.getWebSockets()) {
      const connection = connectionOf(socket);
      if (connection !== undefined) sockets.set(connection, socket);
    }
    const live: Live = {
      room: undefined as unknown as Room,
      sockets,
      nextConnection: (await storage.get<number>(NEXT_CONNECTION_KEY)) ?? 1,
      lobbyLength: 0,
      lost: (await storage.get<boolean>(LEFT_LOBBY_KEY)) === true,
      nextTickAtMs: undefined,
      replaying: undefined,
      recorded: [],
    };
    live.room = createRoom(this.#options.settings, (ticket) => this.#admit(live, ticket));
    if (live.lost) {
      for (const [connection, socket] of sockets) {
        sockets.delete(connection);
        try {
          socket.send(refusal());
          socket.close(1011, 'this room was lost when it was evicted');
        } catch {
          // Already going.
        }
      }
      await storage.deleteAlarm();
      return live;
    }
    const log = await storage.list<LobbyEvent>({ prefix: LOBBY_LOG_PREFIX });
    for (const event of log.values()) {
      live.replaying = [...(event.op === 'receive' ? event.admissions : [])];
      if (event.op === 'receive') live.room.receive(event.connection, event.text, event.nowMs);
      else if (event.op === 'disconnect') live.room.disconnect(event.connection, event.nowMs);
      else if (event.op === 'start') live.room.start(event.nowMs);
      else live.room.tick(event.nowMs);
    }
    live.replaying = undefined;
    live.lobbyLength = log.size;
    return live;
  }
}
