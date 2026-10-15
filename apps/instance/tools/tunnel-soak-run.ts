// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The tunnel soak's riders (#807, #780) — `tunnel-soak.ts` is the command.
 * Exported apart from it so `tunnel-soak.test.ts` can ride the same code
 * against an instance on this machine, with a disconnect forced in the
 * middle.
 */

import { PHYSICS_VERSION } from '@onyourleft/physics';
import { decodeRoomMessage, encodeMessage, PROTOCOL_VERSION } from '@onyourleft/protocol';
import { WebSocket } from 'ws';

import { signedInDevice, type Device } from './replan-round-trip-run.ts';

export interface SoakOptions {
  /** The instance's origin: `https://rides.example.org`, or `http://127.0.0.1:8787`. */
  readonly url: string;
  readonly roomId: string;
  readonly durationMs: number;
  readonly riders: number;
  /** How often each rider pings when it has sent nothing else — ADR 0037 D-8.1's 30 s. */
  readonly keepaliveMs: number;
  /** Called with each rider's live socket as it opens: the test closes one to force a rejoin. */
  readonly onSocket?: (rider: number, socket: WebSocket) => void;
}

export interface SoakReport {
  readonly startedAt: string;
  readonly minutes: number;
  readonly riders: number;
  readonly keepaliveSeconds: number;
  /** Every socket that closed without the soak closing it, with its close code. */
  readonly disconnects: readonly { rider: number; atSecond: number; code: number }[];
  /** For each disconnect: from the close to the next welcome. */
  readonly rejoinMs: readonly number[];
  readonly framesReceived: readonly number[];
  /** The longest any rider went between two messages from the room while connected. */
  readonly longestSilenceMs: number;
}

/**
 * A throwaway device, signed in. Sealed on an instance that serves keys:
 * since #1210 (phase 2 of ADR 0047 D-7) signing in and a room's ticket are
 * sealed-only there, so a plaintext soak would be refused `sealed_required`.
 * In plaintext on one that serves none, which has no sealed routes. The
 * sealed device is `replan-round-trip-run.ts`'s, and what its header says
 * sealing is worth from a tool that pins no card holds here too.
 */
async function signIn(instance: string, displayName: string): Promise<Device> {
  const served = (await (await fetch(`${instance}/v1/instance/keys`)).json().catch(() => ({}))) as {
    statements?: unknown[];
  };
  const transport = (served.statements?.length ?? 0) > 0 ? 'sealed' : 'plaintext';
  return signedInDevice(instance, instance, transport, displayName);
}

async function ticketFor(device: Device, roomId: string): Promise<string> {
  const answer = await device.call('POST', `/v1/rooms/${roomId}/ticket`, {
    declaredMassKilograms: 75,
  });
  const ticket = (answer.body as { ticket?: unknown } | null)?.ticket;
  if (answer.status !== 200 || typeof ticket !== 'string') {
    throw new Error(`a ticket was refused: ${String(answer.status)}`);
  }
  return ticket;
}

function socketUrl(instance: string, roomId: string): string {
  return `${instance.replace(/^http/, 'ws')}/v1/rooms/${roomId}/socket`;
}

function hello(ticket: string): string {
  return JSON.stringify({
    type: 'hello',
    protocol: PROTOCOL_VERSION,
    physicsVersion: PHYSICS_VERSION,
    ticket,
  });
}

/** The origin the instance's devices sign: the URL given, which is its public hostname. */
function originOf(url: string): string {
  return new URL(url).origin;
}

export async function soak(options: SoakOptions): Promise<SoakReport> {
  const instance = originOf(options.url);
  const started = Date.now();
  const disconnects: { rider: number; atSecond: number; code: number }[] = [];
  const rejoinMs: number[] = [];
  const frames: number[] = [];
  let longestSilenceMs = 0;
  let finished = false;
  const open = new Set<WebSocket>();

  async function ride(rider: number): Promise<void> {
    const device = await signIn(instance, `Soak ${String(rider + 1)}`);
    frames[rider] = 0;
    let closedAt: number | undefined;
    let sequence = 0;
    while (!finished) {
      const socket = new WebSocket(socketUrl(instance, options.roomId), {
        perMessageDeflate: false,
      });
      open.add(socket);
      let lastHeard = Date.now();
      let lastSent = Date.now();
      const done = new Promise<number>((resolve) => {
        socket.on('close', (code) => resolve(code));
        socket.on('error', () => undefined);
      });
      socket.on('open', () => {
        options.onSocket?.(rider, socket);
        void ticketFor(device, options.roomId).then(
          (ticket) => socket.send(hello(ticket)),
          () => socket.close(),
        );
      });
      socket.on('message', (data) => {
        const now = Date.now();
        longestSilenceMs = Math.max(longestSilenceMs, now - lastHeard);
        lastHeard = now;
        const decoded = decodeRoomMessage((data as Buffer).toString('utf8'));
        if (!decoded.ok) return;
        if (decoded.message.type === 'welcome' && closedAt !== undefined) {
          rejoinMs.push(now - closedAt);
          closedAt = undefined;
        }
        if (decoded.message.type === 'frame') frames[rider] = (frames[rider] ?? 0) + 1;
      });
      const report = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) return;
        sequence += 1;
        socket.send(encodeMessage({ type: 'report', sequence, atMs: Date.now(), powerWatts: 150 }));
        lastSent = Date.now();
      }, 500);
      const keepalive = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN && Date.now() - lastSent >= options.keepaliveMs) {
          socket.ping();
          lastSent = Date.now();
        }
      }, 1_000);
      const code = await done;
      open.delete(socket);
      clearInterval(report);
      clearInterval(keepalive);
      if (finished) break;
      closedAt = Date.now();
      disconnects.push({ rider, atSecond: Math.round((closedAt - started) / 1000), code });
      // A new socket and a new ticket at once: the rejoin a client makes.
      sequence = 0;
    }
  }

  const riders = Array.from({ length: options.riders }, (_, rider) => ride(rider));
  await new Promise((done) => setTimeout(done, options.durationMs));
  finished = true;
  // Close whatever is open; each rider's loop ends on its close.
  for (const socket of open) socket.close(1000, 'the soak is over');
  await Promise.race([Promise.all(riders), new Promise((done) => setTimeout(done, 5_000))]);
  return {
    startedAt: new Date(started).toISOString(),
    minutes: Math.round((options.durationMs / 60_000) * 100) / 100,
    riders: options.riders,
    keepaliveSeconds: options.keepaliveMs / 1000,
    disconnects,
    rejoinMs,
    framesReceived: frames,
    longestSilenceMs,
  };
}

export interface IdleReport {
  readonly startedAt: string;
  /** How long the idle socket lived, or `null` if it outlived the probe. */
  readonly idleClosedAfterSeconds: number | null;
  readonly closeCode: number | null;
  readonly note: string;
}

/**
 * One socket, a hello into a race lobby (so the room sends nothing), and
 * then silence: no report, no ping, and no pong to the server's ping.
 */
export async function idleProbe(options: {
  readonly url: string;
  readonly roomId: string;
  readonly maximumMs: number;
}): Promise<IdleReport> {
  const instance = originOf(options.url);
  const device = await signIn(instance, 'Idle probe');
  const started = Date.now();
  const socket = new WebSocket(socketUrl(instance, options.roomId), {
    perMessageDeflate: false,
    autoPong: false,
  });
  let pinged = false;
  socket.on('ping', () => {
    pinged = true;
  });
  socket.on('error', () => undefined);
  socket.on('open', () => {
    void ticketFor(device, options.roomId).then((ticket) => socket.send(hello(ticket)));
  });
  const closed = await Promise.race([
    new Promise<number>((resolve) => socket.on('close', (code) => resolve(code))),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), options.maximumMs)),
  ]);
  socket.terminate();
  return {
    startedAt: new Date(started).toISOString(),
    idleClosedAfterSeconds: closed === null ? null : Math.round((Date.now() - started) / 1000),
    closeCode: closed,
    note: pinged
      ? 'The instance pinged this socket, so it was never idle and this measured nothing: run it with OYL_INSTANCE_PING_INTERVAL_MS=0.'
      : 'No ping from the instance: the socket was idle, and this is the tunnel’s idle timeout.',
  };
}
