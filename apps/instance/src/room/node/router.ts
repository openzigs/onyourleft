// SPDX-License-Identifier: AGPL-3.0-or-later

import { fork, type ChildProcess } from 'node:child_process';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { encodeMessage } from '@onyourleft/protocol';
import { WebSocketServer } from 'ws';

import { REFUSAL_CLOSE, ROOM_LOST, type CloseFrame } from '../close-codes.ts';
import type { Admission, RoomPhase } from '../core/room.ts';
import type { RoomPlan } from '../room-plan.ts';
import type { FromWorker, ToWorker, UpgradeRequest, WorkerSettings } from './ipc.ts';
import type { HostMetrics, RoomFlagRaised, RoomResult, RoomSeat } from './room-host.ts';

/**
 * The self-hosted room server's front half (#780): one room-worker process
 * per core, and the router that puts every socket for one room on one of them
 * — spike 0013 §4.1's "a four-vCPU box needs four processes and a way to put
 * rooms on them", which nobody had written.
 *
 * ```text
 *           GET /v1/rooms/{roomId}/socket  (Upgrade: websocket)
 * client ─────────────────────────────────▶ HTTP process: ready? a room? which worker?
 *                                                │ the socket, as a handle, over IPC
 *                                                ▼
 *                                         room worker n: the handshake, the room, its tick
 * ```
 *
 * ## Placement: one room, one worker
 *
 * A room's first socket places it on a live worker, chosen by a hash of its
 * id over the workers alive at that moment; every later socket for the same
 * id goes wherever it was placed, until its worker says the room has closed.
 * The table, not the hash, is the rule — so a worker dying and a new one
 * starting never splits a room that is still open.
 *
 * ## A worker that dies
 *
 * The router keeps its own copy of every socket it hands over (`keepOpen`),
 * unread. When a worker exits, the router writes a WebSocket close frame —
 * `1011 room-lost` (`close-codes.ts`) — to each socket it had handed that
 * worker, forgets the worker's rooms, and starts a new worker in its place;
 * no room is placed on the dead one again. ⚠️ A worker killed in the middle of
 * writing a frame leaves that frame half-sent, and the close frame after it
 * is then read as garbage and the client closes anyway: a client that sees
 * no reason is to treat the room as lost too.
 *
 * ## What is refused before any room state changes
 *
 * - **Not ready** (the database is still being migrated, `serve.ts`):
 *   `503` before the upgrade.
 * - **No such room**, or one this build cannot open (`room-plan.ts`): `404`.
 * - **A race that has left its lobby and that no live worker holds** —
 *   finished and emptied, or interrupted by a restart (#807: an interrupted
 *   race does not resume): the handshake is completed HERE and the socket is
 *   sent `refuse room-closed` and closed `4005`, so a rejoining client is told
 *   in words rather than by a failed upgrade. A started race a worker DOES
 *   hold is routed to it, so a rider who dropped mid-race rejoins
 *   (#895's review, B1). ⚠️ "Holds" is the router's placement, which a
 *   worker's `room-closed` clears only when it ARRIVES: a rejoin routed while
 *   it is in flight reaches a worker that has let the room go, and that
 *   worker refuses it `room-closed` rather than opening a lobby (#897,
 *   `room-host.ts` §`accept`).
 * - **A room the rooms' sweep is ending** (#948, `rooms/rooms.ts` §`sweep`):
 *   refused `room-closed` the same way, even when its lookup read it as open
 *   just before the sweep closed it — so a rider is never placed in a room
 *   whose route is being deleted.
 * - A ticket that is missing, wrong or spent is the ROOM's refusal, at hello
 *   (`room-host.ts`, `close-codes.ts`).
 */

export const ROOM_SOCKET_PATH = /^\/v1\/rooms\/([A-Za-z0-9_-]{1,128})\/socket$/;

/**
 * What the router is told about a room id.
 *
 * `started` is a race that has left its lobby. It is still LIVE while a
 * worker holds it — a rider who dropped rejoins it there, into the same
 * seat — and it is closed only when no worker does: after it finished and
 * emptied, or after the instance restarted in the middle of it (#807: an
 * interrupted race does not resume). The router decides which, because only
 * the router knows where rooms are placed.
 */
export type RoomLookup =
  | { readonly kind: 'open'; readonly plan: RoomPlan }
  | { readonly kind: 'started'; readonly plan: RoomPlan }
  | { readonly kind: 'ended' }
  | { readonly kind: 'unknown' };

export interface RouterOptions {
  /** How many room workers: one per core unless the operator says otherwise. */
  readonly workers: number;
  readonly worker: Omit<WorkerSettings, 'index'>;
  readonly lookup: (roomId: string) => Promise<RoomLookup>;
  /** The HTTP process's ticket book (`auth/tickets.ts`), asked once per hello. */
  readonly admit: (roomId: string, ticket: string) => Admission | undefined;
  readonly onResult?: (roomId: string, result: RoomResult) => Promise<void>;
  /** A room raised a plausibility flag (#789): filed as a report. */
  readonly onFlag?: (roomId: string, flag: RoomFlagRaised) => Promise<void>;
  readonly onRaceStarted?: (roomId: string) => Promise<void>;
  /** A race is over (#785): its results may be read from now. */
  readonly onRaceFinished?: (roomId: string) => Promise<void>;
  /**
   * A worker let a room go (#784): `phase` is where the room was — `finished`
   * or `closed` when it is over, `lobby` when its lobby only emptied and a later
   * socket may open it again.
   */
  readonly onRoomClosed?: (roomId: string, phase: RoomPhase) => Promise<void>;
  /** Whether rooms may be admitted at all yet (`/ready`). */
  readonly ready?: () => boolean;
  /** Something happened an operator should see. No coordinate, no id, no secret. */
  readonly event?: (event: string, detail?: Record<string, unknown>) => void;
  /** The worker module to fork. `worker-main.ts` unless a test hands its own. */
  readonly workerModule?: string;
  /** Start a new worker when one dies. On by default. */
  readonly respawn?: boolean;
}

export interface WorkerStatus {
  readonly index: number;
  readonly pid: number | undefined;
  readonly alive: boolean;
}

export interface WorkerMetrics extends HostMetrics {
  readonly index: number;
  readonly rssBytes: number;
}

interface Slot {
  readonly index: number;
  child: ChildProcess;
  alive: boolean;
  ready: Promise<void>;
  /** Sockets handed to this child that it has not yet reported closed. */
  readonly sockets: Map<string, Duplex>;
}

const WORKER_MODULE = fileURLToPath(new URL('./worker-main.ts', import.meta.url));

/** FNV-1a, 32-bit: a stable, cheap spread of room ids over the workers. */
export function roomHash(roomId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < roomId.length; i += 1) {
    hash ^= roomId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** A WebSocket close frame as a server sends it: unmasked, code and reason. */
export function closeFrameBytes(frame: CloseFrame): Buffer {
  const reason = Buffer.from(frame.reason, 'utf8');
  const code = Buffer.alloc(2);
  code.writeUInt16BE(frame.code);
  return Buffer.concat([Buffer.from([0x88, 2 + reason.length]), code, reason]);
}

/**
 * Stops THIS process reading a socket it is about to hand a worker.
 *
 * ⚠️ `socket.pause()` is not enough, and was measured not to be: it stops the
 * stream flowing, but libuv goes on reading from the kernel into the paused
 * stream's buffer until that is full — so the client's hello was read here,
 * and the worker, which reads the same file descriptor, never saw it. Node
 * documents no public way to stop the read on a socket it has already
 * accepted (`pauseOnConnect` is only for a raw `net.Server`, which could not
 * read the path), so the handle's own `readStop` is called, and the router
 * test that exchanges a hello through a worker is what goes red if a Node
 * release changes it.
 */
function stopReading(socket: Duplex): void {
  socket.pause();
  const handle = (socket as { _handle?: { readStop?: () => number; reading?: boolean } })._handle;
  if (handle?.readStop !== undefined) {
    handle.reading = false;
    handle.readStop();
  }
}

function resumeReading(socket: Duplex): void {
  const handle = (socket as { _handle?: { readStart?: () => number; reading?: boolean } })._handle;
  if (handle?.readStart !== undefined) {
    handle.reading = true;
    handle.readStart();
  }
  socket.resume();
}

function refuseHttp(socket: Duplex, status: number, text: string): void {
  const body = `${text}\n`;
  // Read again, so the client's own close is seen and the socket let go.
  resumeReading(socket);
  setTimeout(() => socket.destroy(), 1_000).unref();
  socket.end(
    `HTTP/1.1 ${String(status)} ${text}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${String(Buffer.byteLength(body))}\r\nCache-Control: no-store\r\n\r\n${body}`,
  );
}

export class RoomRouter {
  readonly #options: RouterOptions;
  readonly #slots: Slot[] = [];
  readonly #placement = new Map<string, Slot>();
  readonly #pendingWrites = new Set<Promise<void>>();
  /**
   * Requests a worker has not answered yet, with the worker they went to, so
   * a worker that dies settles them rather than leaving them waiting for
   * ever (#895's review, N4): a start is `false`, metrics are left out.
   */
  readonly #metricsWaiting = new Map<
    number,
    { readonly slot: Slot; readonly resolve: (m: WorkerMetrics | undefined) => void }
  >();
  readonly #startsWaiting = new Map<
    number,
    { readonly slot: Slot; readonly resolve: (ok: boolean) => void }
  >();
  readonly #seatsWaiting = new Map<
    number,
    { readonly slot: Slot; readonly resolve: (seat: RoomSeat | undefined) => void }
  >();
  /**
   * Rooms the rooms' sweep is ending (#948), each `true` once the sweep is
   * done with it and kept only until no lookup that began before that is
   * still in flight: such a lookup may have read the room as open.
   */
  readonly #ending = new Map<string, boolean>();
  /** How many sockets' lookups of each room are in flight. */
  readonly #lookingUp = new Map<string, number>();
  /** Completes the handshake for a refusal the router gives itself. Never compresses. */
  readonly #refuser = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  #nextSocket = 0;
  #nextRequest = 0;
  #stopping = false;

  constructor(options: RouterOptions) {
    if (!Number.isInteger(options.workers) || options.workers < 1) {
      throw new RangeError('a room router needs at least one worker');
    }
    this.#options = options;
  }

  /** Forks every worker and resolves once each has said it is ready. */
  async start(): Promise<void> {
    for (let index = 0; index < this.#options.workers; index += 1) {
      this.#slots.push(this.#spawn(index));
    }
    await Promise.all(this.#slots.map((slot) => slot.ready));
  }

  /** The workers, for a test and for `/ready`. */
  workers(): readonly WorkerStatus[] {
    return this.#slots.map((slot) => ({
      index: slot.index,
      pid: slot.child.pid,
      alive: slot.alive,
    }));
  }

  /** Whether every worker is alive. */
  healthy(): boolean {
    return this.#slots.length > 0 && this.#slots.every((slot) => slot.alive);
  }

  /**
   * Whether a live worker holds `roomId` — somebody is in it, or a race is
   * still running in it (#784: the rooms' sweep ends only a room nobody is
   * riding).
   */
  holds(roomId: string): boolean {
    return this.#placement.get(roomId)?.alive === true;
  }

  /**
   * For the rooms' sweep (#948): `false` when a live worker holds `roomId`;
   * else `true`, and from now until {@link releaseEnding} no socket places it
   * — one whose lookup read the room as open before the sweep closed it is
   * refused `room-closed`, as a room that is over is.
   */
  claimForEnding(roomId: string): boolean {
    if (this.holds(roomId)) return false;
    this.#ending.set(roomId, false);
    return true;
  }

  /** The sweep is done with `roomId`: forgotten once no lookup that might have read it open is in flight. */
  releaseEnding(roomId: string): void {
    if ((this.#lookingUp.get(roomId) ?? 0) === 0) this.#ending.delete(roomId);
    else if (this.#ending.has(roomId)) this.#ending.set(roomId, true);
  }

  /** `lookup`, counted in flight, and whether the sweep was ending the room as it answered. */
  async #lookUp(roomId: string): Promise<{ found: RoomLookup; ending: boolean }> {
    this.#lookingUp.set(roomId, (this.#lookingUp.get(roomId) ?? 0) + 1);
    try {
      const found = await this.#options.lookup(roomId);
      return { found, ending: this.#ending.has(roomId) };
    } finally {
      const left = (this.#lookingUp.get(roomId) ?? 1) - 1;
      if (left > 0) this.#lookingUp.set(roomId, left);
      else {
        this.#lookingUp.delete(roomId);
        if (this.#ending.get(roomId) === true) this.#ending.delete(roomId);
      }
    }
  }

  /** Which worker holds a room, by process id, or `undefined` if it is not placed. */
  placementOf(roomId: string): number | undefined {
    return this.#placement.get(roomId)?.child.pid;
  }

  /**
   * Starts a race's countdown on the worker holding it, for the athlete who
   * may start it — its creator, seated and connected (the owner's ruling of
   * 2026-09-30), `room-host.ts` §`start`.
   */
  startRoom(roomId: string, athleteId: string): Promise<boolean> {
    const slot = this.#placement.get(roomId);
    if (slot === undefined || !slot.alive) return Promise.resolve(false);
    return new Promise((resolve) => {
      this.#nextRequest += 1;
      const id = this.#nextRequest;
      this.#startsWaiting.set(id, { slot, resolve });
      this.#post(slot, { type: 'start', id, roomId, athleteId });
    });
  }

  /**
   * Takes a rider out of a room on the worker holding it, for the room's life
   * (#789). `false` when no live worker holds it: there is nobody to take out,
   * and the instance's own record refuses them a ticket from now on.
   */
  removeFromRoom(roomId: string, athleteId: string): Promise<boolean> {
    const slot = this.#placement.get(roomId);
    if (slot === undefined || !slot.alive) return Promise.resolve(false);
    return new Promise((resolve) => {
      this.#nextRequest += 1;
      const id = this.#nextRequest;
      this.#startsWaiting.set(id, { slot, resolve });
      this.#post(slot, { type: 'remove', id, roomId, athleteId });
    });
  }

  /** Who sits in `riderId`'s seat of a room a live worker holds, and its tick (#789). */
  seatOf(roomId: string, riderId: number): Promise<RoomSeat | undefined> {
    const slot = this.#placement.get(roomId);
    if (slot === undefined || !slot.alive) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      this.#nextRequest += 1;
      const id = this.#nextRequest;
      this.#seatsWaiting.set(id, { slot, resolve });
      this.#post(slot, { type: 'seat', id, roomId, riderId });
    });
  }

  /** Each live worker's metrics. */
  async metrics(): Promise<readonly WorkerMetrics[]> {
    const live = this.#slots.filter((slot) => slot.alive);
    const answers = await Promise.all(
      live.map(
        (slot) =>
          new Promise<WorkerMetrics | undefined>((resolve) => {
            this.#nextRequest += 1;
            const id = this.#nextRequest;
            this.#metricsWaiting.set(id, { slot, resolve });
            this.#post(slot, { type: 'metrics', id });
          }),
      ),
    );
    return answers.filter((answer): answer is WorkerMetrics => answer !== undefined);
  }

  /**
   * A `node:http` server's `upgrade` event. Answers `true` when the path was a
   * room socket (handled, one way or another), `false` when it was not the
   * router's, so the caller can refuse it.
   */
  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const roomId = ROOM_SOCKET_PATH.exec(new URL(request.url ?? '/', 'http://x').pathname)?.[1];
    if (roomId === undefined) return false;
    stopReading(socket);
    void this.#route(roomId, request, socket, head).catch(() => {
      refuseHttp(socket, 500, 'Internal Server Error');
    });
    return true;
  }

  async #route(roomId: string, request: IncomingMessage, socket: Duplex, head: Buffer) {
    if (
      request.method !== 'GET' ||
      request.headers.upgrade?.toLowerCase() !== 'websocket' ||
      this.#stopping
    ) {
      refuseHttp(
        socket,
        this.#stopping ? 503 : 400,
        this.#stopping ? 'Service Unavailable' : 'Bad Request',
      );
      return;
    }
    if (this.#options.ready !== undefined && !this.#options.ready()) {
      refuseHttp(socket, 503, 'Service Unavailable');
      return;
    }
    const { found, ending } = await this.#lookUp(roomId);
    if (found.kind === 'unknown') {
      refuseHttp(socket, 404, 'Not Found');
      return;
    }
    // A started race is joined where it is still running, and only there: a
    // started race no live worker holds is never opened again as a lobby.
    const live = this.#placement.get(roomId);
    const running = found.kind === 'started' && live?.alive === true;
    // #948: a room the sweep is ending is over, whatever the lookup read of it.
    if (ending || found.kind === 'ended' || (found.kind === 'started' && !running)) {
      resumeReading(socket);
      this.#refuser.handleUpgrade(request, socket, head, (ws) => {
        ws.send(encodeMessage({ type: 'refuse', reason: 'room-closed' }));
        const frame = REFUSAL_CLOSE['room-closed'];
        ws.close(frame.code, frame.reason);
      });
      return;
    }
    const slot = this.#place(roomId);
    if (slot === undefined) {
      refuseHttp(socket, 503, 'Service Unavailable');
      return;
    }
    await slot.ready;
    this.#nextSocket += 1;
    const socketId = `${String(slot.index)}-${String(this.#nextSocket)}`;
    const copy: UpgradeRequest = {
      method: request.method,
      url: request.url ?? '/',
      headers: request.headers,
    };
    slot.sockets.set(socketId, socket);
    const message: ToWorker = {
      type: 'socket',
      socketId,
      plan: found.plan,
      // A started race is joined only where it is still held: the worker
      // checks, because a `room-closed` it sent may still be in flight (#897).
      started: found.kind === 'started',
      request: copy,
      head: head.toString('base64'),
    };
    // Node registers a child it sends a server's socket to as one of that
    // server's "workers", and `server.close()` then waits for the child to
    // report its connections — which a child that has exited never does, so
    // closing the HTTP server hung. The router tracks what it handed out
    // itself, so the socket is detached from that bookkeeping first.
    (socket as { server?: unknown }).server = null;
    slot.child.send(message, socket as never, { keepOpen: true }, (error) => {
      if (error !== null) {
        slot.sockets.delete(socketId);
        refuseHttp(socket, 503, 'Service Unavailable');
      }
    });
  }

  #place(roomId: string): Slot | undefined {
    const placed = this.#placement.get(roomId);
    if (placed?.alive === true) return placed;
    const live = this.#slots.filter((slot) => slot.alive);
    if (live.length === 0) return undefined;
    const slot = live[roomHash(roomId) % live.length] as Slot;
    this.#placement.set(roomId, slot);
    return slot;
  }

  #spawn(index: number): Slot {
    const settings: WorkerSettings = { ...this.#options.worker, index };
    const child = fork(this.#options.workerModule ?? WORKER_MODULE, [JSON.stringify(settings)], {
      serialization: 'json',
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    let readied: () => void = () => undefined;
    const slot: Slot = {
      index,
      child,
      alive: true,
      ready: new Promise<void>((done) => {
        readied = done;
      }),
      sockets: new Map(),
    };
    child.on('message', (message: FromWorker) => {
      this.#fromWorker(slot, message, readied);
    });
    child.on('exit', (code, signal) => {
      this.#died(slot, code, signal);
    });
    child.on('error', () => {
      // An error spawning or signalling is followed by `exit`, or nothing more.
    });
    return slot;
  }

  #fromWorker(slot: Slot, message: FromWorker, readied: () => void): void {
    switch (message.type) {
      case 'ready':
        readied();
        return;
      case 'admit': {
        const admission = this.#options.admit(message.roomId, message.ticket) ?? null;
        this.#post(slot, { type: 'admitted', id: message.id, admission });
        return;
      }
      case 'result':
        this.#track(this.#options.onResult?.(message.roomId, message.result));
        return;
      case 'flag':
        this.#track(this.#options.onFlag?.(message.roomId, message.flag));
        return;
      case 'race-started':
        this.#track(this.#options.onRaceStarted?.(message.roomId));
        return;
      case 'race-finished':
        this.#track(this.#options.onRaceFinished?.(message.roomId));
        return;
      case 'room-closed':
        if (this.#placement.get(message.roomId) === slot) this.#placement.delete(message.roomId);
        this.#track(this.#options.onRoomClosed?.(message.roomId, message.phase));
        return;
      case 'socket-closed': {
        const copy = slot.sockets.get(message.socketId);
        slot.sockets.delete(message.socketId);
        copy?.destroy();
        return;
      }
      case 'protocol-close':
        // So an operator's log shows why a room let sockets go (#1400): the
        // room, the close reason and how many so far — no athlete, no name.
        this.#options.event?.('room-socket-closed', {
          worker: slot.index,
          room: message.roomId,
          reason: message.reason,
          count: message.count,
        });
        return;
      case 'metrics': {
        const waiting = this.#metricsWaiting.get(message.id);
        this.#metricsWaiting.delete(message.id);
        waiting?.resolve({ ...message.metrics, index: slot.index, rssBytes: message.rssBytes });
        return;
      }
      case 'started':
      case 'removed': {
        const waiting = this.#startsWaiting.get(message.id);
        this.#startsWaiting.delete(message.id);
        waiting?.resolve(message.ok);
        return;
      }
      case 'seated': {
        const waiting = this.#seatsWaiting.get(message.id);
        this.#seatsWaiting.delete(message.id);
        waiting?.resolve(message.seat ?? undefined);
        return;
      }
      case 'stopped':
        return;
    }
  }

  #track(write: Promise<void> | undefined): void {
    if (write === undefined) return;
    const tracked = write
      .catch(() => this.#options.event?.('room-write-failed'))
      .finally(() => this.#pendingWrites.delete(tracked));
    this.#pendingWrites.add(tracked);
  }

  #died(slot: Slot, code: number | null, signal: NodeJS.Signals | null): void {
    slot.alive = false;
    for (const [id, waiting] of this.#startsWaiting) {
      if (waiting.slot !== slot) continue;
      this.#startsWaiting.delete(id);
      waiting.resolve(false);
    }
    for (const [id, waiting] of this.#metricsWaiting) {
      if (waiting.slot !== slot) continue;
      this.#metricsWaiting.delete(id);
      waiting.resolve(undefined);
    }
    for (const [id, waiting] of this.#seatsWaiting) {
      if (waiting.slot !== slot) continue;
      this.#seatsWaiting.delete(id);
      waiting.resolve(undefined);
    }
    if (this.#stopping) {
      // Every socket was closed `1001 server-stopping` by the worker already.
      for (const socket of slot.sockets.values()) socket.destroy();
      slot.sockets.clear();
      return;
    }
    const bytes = closeFrameBytes(ROOM_LOST);
    for (const socket of slot.sockets.values()) {
      socket.end(bytes);
      setTimeout(() => socket.destroy(), 1_000).unref();
    }
    slot.sockets.clear();
    let rooms = 0;
    for (const [roomId, placed] of this.#placement) {
      if (placed === slot) {
        this.#placement.delete(roomId);
        rooms += 1;
      }
    }
    this.#options.event?.('room-worker-died', {
      worker: slot.index,
      code,
      signal,
      roomsLost: rooms,
    });
    if (this.#options.respawn !== false) {
      const replacement = this.#spawn(slot.index);
      this.#slots[this.#slots.indexOf(slot)] = replacement;
    }
  }

  #post(slot: Slot, message: ToWorker): void {
    if (slot.alive && slot.child.connected) slot.child.send(message);
  }

  /**
   * Graceful shutdown: no socket is taken again, every worker closes its
   * sockets `1001 server-stopping` and exits, and every result a worker handed
   * over has been written before this resolves. A worker still running after
   * `graceMs` is killed.
   */
  async stop(graceMs = 5_000): Promise<void> {
    this.#stopping = true;
    const exits = this.#slots.map(
      (slot) =>
        new Promise<void>((done) => {
          if (slot.child.exitCode !== null || slot.child.signalCode !== null) {
            done();
            return;
          }
          slot.child.once('exit', () => done());
          this.#post(slot, { type: 'shutdown' });
        }),
    );
    const timer = setTimeout(() => {
      for (const slot of this.#slots) slot.child.kill('SIGKILL');
    }, graceMs);
    await Promise.all(exits);
    clearTimeout(timer);
    for (const slot of this.#slots) {
      for (const socket of slot.sockets.values()) socket.destroy();
      slot.sockets.clear();
    }
    while (this.#pendingWrites.size > 0) await Promise.all([...this.#pendingWrites]);
    this.#refuser.close();
  }
}
