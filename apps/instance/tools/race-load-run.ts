// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The race-room load run's riders (#464) — `race-load.ts` is the command.
 * Exported apart from it so `race-load.test.ts` can ride the same code
 * against an instance on this machine.
 *
 * Each rider is what a client does in a race: it signs in with its own device
 * key, takes a ticket with its declared mass, says hello, and reports power
 * twice a second once the room has welcomed it; the first rider starts the
 * race once every rider is seated (an operator's room has no creator, so any
 * seated rider may). A dropped socket is a rejoin: a new ticket, then a new
 * socket and its hello. The ticket is taken BEFORE the socket opens and no
 * report is sent before the welcome (#1400): through a loaded tunnel a ticket
 * took longer than a report interval, a report reached the room first, and
 * the room closed the socket `1008 hello-expected`, over and over. The run ends when
 * the room says the race is over, or at the time limit.
 *
 * What it measures is what reaches a RIDER: every frame's arrival against the
 * tick it carries (lateness), ticks that never arrived, every close the run
 * did not ask for, and the application bytes each way. It reports no token,
 * no athlete id, no display name and no coordinate.
 */

import { webcrypto } from 'node:crypto';

import { fromHex, toHex } from '@onyourleft/domain';
import { decodeRoomMessage, encodeMessage } from '@onyourleft/protocol';
import { WebSocket } from 'ws';

import type { Device } from './replan-round-trip-run.ts';
import { hello, originOf, signIn, socketUrl, ticketFor } from './tunnel-soak-run.ts';

/** One rider's device key, as the keys file holds it: hex public key, base64 PKCS #8 private key. */
export interface RiderKey {
  readonly publicKey: string;
  readonly privateKey: string;
}

/** `count` new Ed25519 device keys, in the keys file's shape. */
export async function newRiderKeys(count: number): Promise<RiderKey[]> {
  const keys: RiderKey[] = [];
  for (let i = 0; i < count; i += 1) {
    const pair = (await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ])) as unknown as webcrypto.CryptoKeyPair;
    keys.push({
      publicKey: toHex(new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey))),
      privateKey: Buffer.from(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey)).toString(
        'base64',
      ),
    });
  }
  return keys;
}

async function pairOf(key: RiderKey): Promise<webcrypto.CryptoKeyPair> {
  return {
    publicKey: await webcrypto.subtle.importKey(
      'raw',
      new Uint8Array(fromHex(key.publicKey, 'a rider’s public key', 32)),
      { name: 'Ed25519' },
      true,
      ['verify'],
    ),
    privateKey: await webcrypto.subtle.importKey(
      'pkcs8',
      new Uint8Array(Buffer.from(key.privateKey, 'base64')),
      { name: 'Ed25519' },
      false,
      ['sign'],
    ),
  };
}

/** Frames either side of a frame that its lateness baseline is taken over. */
export const BASELINE_WINDOW_FRAMES = 120;

/**
 * Each frame's lateness, in milliseconds: its arrival against the tick it
 * carries, measured from the soonest frame NEAR it. A frame for tick `k` is
 * due one interval after tick `k - 1`'s; the baseline is the smallest
 * `arrival - k × interval` within `windowFrames` frames either side, so the
 * soonest frame of a stretch is 0 and every other is how far behind that
 * schedule it arrived. The window is rolling, not the whole run's: the room
 * reschedules from now after a late tick and does not catch up, so one server
 * stall shifts every later frame for good, and a whole-run baseline would
 * report that permanent schedule slip as lateness. This figure is therefore
 * per-stretch network and scheduling lateness, NOT accumulated slip. It needs
 * no clock shared with the room.
 */
export function latenessOf(
  arrivals: readonly { readonly tick: number; readonly atMs: number }[],
  intervalMs: number,
  windowFrames = BASELINE_WINDOW_FRAMES,
): number[] {
  if (arrivals.length === 0) return [];
  const offsets = arrivals.map((a) => a.atMs - a.tick * intervalMs);
  return offsets.map((offset, i) => {
    let baseline = offset;
    const from = Math.max(0, i - windowFrames);
    const to = Math.min(offsets.length - 1, i + windowFrames);
    for (let j = from; j <= to; j += 1) baseline = Math.min(baseline, offsets[j] ?? offset);
    return offset - baseline;
  });
}

/** Ticks between the first and last a rider saw that never reached it. */
export function missingTicksOf(arrivals: readonly { readonly tick: number }[]): number {
  if (arrivals.length === 0) return 0;
  const ticks = new Set(arrivals.map((a) => a.tick));
  const first = Math.min(...ticks);
  const last = Math.max(...ticks);
  return last - first + 1 - ticks.size;
}

/** The nearest-rank percentile `p` (0–100) of `values`, or `null` for none. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] ?? null;
}

/** A small seeded generator, so a rider's power noise is the same on every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Rider `i`'s declared mass (60–90 kg) and power (3.0–4.0 W/kg): a spread field, the same every run. */
export function riderProfile(i: number): { massKilograms: number; wattsPerKilogram: number } {
  return { massKilograms: 60 + ((i * 7) % 31), wattsPerKilogram: 3 + ((i * 13) % 11) / 10 };
}

export interface RaceLoadOptions {
  /** The instance's origin: `https://rides.example.org`, or `http://127.0.0.1:8787`. */
  readonly url: string;
  readonly roomId: string;
  readonly keys: readonly RiderKey[];
  /** Display names are `<namePrefix> 1`, `<namePrefix> 2`, …: what a new account is called. */
  readonly namePrefix: string;
  /** The longest the run may take, if the race has not ended first. */
  readonly maximumMs: number;
  /** How long a rider waits after the instance answers `rate_limited` to signing in. */
  readonly rateLimitedWaitMs?: number;
  /** The first backoff after a socket drops; it doubles to `maximumBackoffMs`, and resets at a welcome. */
  readonly backoffMs?: number;
  readonly maximumBackoffMs?: number;
  /** Called with each rider's live socket as it opens: the test closes one to force a rejoin. */
  readonly onSocket?: (rider: number, socket: WebSocket) => void;
}

export interface RaceLoadReport {
  readonly startedAt: string;
  readonly riders: number;
  /** Seconds from the first sign-in to the last rider seated. */
  readonly seatingSeconds: number;
  /** Seconds from the start request to the end of the run. */
  readonly raceSeconds: number;
  /** Whether the room said the race is over before the time limit. */
  readonly raceOver: boolean;
  /** Why the run stopped before the race ended (a refused ticket, a refused start), or `null`. */
  readonly abortReason: string | null;
  readonly finishers: number;
  readonly frames: { readonly total: number; readonly fewestToOneRider: number };
  /** Ticks no frame arrived for, summed over riders, between each rider's first and last. */
  readonly missingTicks: number;
  /** Per-stretch lateness over a rolling baseline (`BASELINE_WINDOW_FRAMES`): not accumulated schedule slip. */
  readonly frameLatenessMs: {
    readonly p50: number | null;
    readonly p95: number | null;
    readonly p99: number | null;
    readonly max: number | null;
  };
  /** Every socket that closed without the run or the race's end closing it, with its close code. */
  readonly disconnects: readonly { rider: number; atSecond: number; code: number }[];
  /** For each disconnect: from the close to the next welcome. */
  readonly rejoinMs: readonly number[];
  /** Application payload, every rider together: what the room sent them and what they sent it. */
  readonly applicationBytes: { readonly received: number; readonly sent: number };
}

/**
 * Signs in, waiting out `rate_limited`: one address signing fifty riders in
 * meets the per-address limit. Sealed on an instance that serves keys, as
 * `tunnel-soak-run.ts` §`signIn` is: since #1210 signing in, a room's ticket
 * and its start are sealed-only there.
 */
async function signInPatiently(
  instance: string,
  displayName: string,
  pair: webcrypto.CryptoKeyPair,
  waitMs: number,
): Promise<Device> {
  for (;;) {
    try {
      return await signIn(instance, displayName, pair);
    } catch (error) {
      if (!(error instanceof Error) || !/refused: rate_limited\b/.test(error.message)) throw error;
      await new Promise((done) => setTimeout(done, waitMs));
    }
  }
}

export async function raceLoad(options: RaceLoadOptions): Promise<RaceLoadReport> {
  const instance = originOf(options.url);
  const started = Date.now();
  const count = options.keys.length;
  const disconnects: { rider: number; atSecond: number; code: number }[] = [];
  const rejoinMs: number[] = [];
  const arrivals: { tick: number; atMs: number }[][] = Array.from({ length: count }, () => []);
  const bytes = { received: 0, sent: 0 };
  const open = new Set<WebSocket>();
  let intervalMs = 1000;
  let finishers = 0;
  let raceOver = false;
  let stopping = false;
  let abortReason: string | undefined;
  let abortRun: () => void = () => undefined;
  const aborted = new Promise<void>((resolve) => {
    abortRun = resolve;
  });
  const abort = (reason: string): void => {
    abortReason ??= reason;
    stopping = true;
    abortRun();
  };
  let seatedAt: number | undefined;
  let startRequestedAt: number | undefined;
  const seated = new Set<number>();

  // Signed in one after another: the instance limits challenges per address.
  const devices: Device[] = [];
  for (const [i, key] of options.keys.entries()) {
    devices.push(
      await signInPatiently(
        instance,
        `${options.namePrefix} ${String(i + 1)}`,
        await pairOf(key),
        options.rateLimitedWaitMs ?? 10_000,
      ),
    );
  }

  async function startRace(device: Device | undefined): Promise<void> {
    if (device === undefined) throw new Error('there is no rider to start the race');
    startRequestedAt = Date.now();
    const answer = await device.call('POST', `/v1/rooms/${options.roomId}/start`);
    if (answer.status !== 200) throw new Error(`the start was refused: ${String(answer.status)}`);
  }

  async function ride(rider: number, device: Device): Promise<void> {
    const profile = riderProfile(rider);
    const noise = seeded(rider + 1);
    let closedAt: number | undefined;
    let sequence = 0;
    let finished = false;
    let backoff = options.backoffMs ?? 500;
    while (!stopping && !finished) {
      // The ticket first, then the socket (#1400): a socket opened before its
      // ticket is answered sits silent for a round trip, and a report sent in
      // that gap reaches the room before the hello — `1008 hello-expected`.
      let ticket: string;
      try {
        ticket = await ticketFor(device, options.roomId, profile.massKilograms);
      } catch (error) {
        // A refused ticket is a misconfiguration (an approval instance, a closed room), not a blip.
        const text = error instanceof Error ? error.message : '';
        if (text.startsWith('a ticket was refused')) {
          abort(text);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, backoff));
        backoff = Math.min(backoff * 2, options.maximumBackoffMs ?? 10_000);
        continue;
      }
      if (stopping) break;
      const socket = new WebSocket(socketUrl(instance, options.roomId), {
        perMessageDeflate: false,
      });
      open.add(socket);
      // Reports wait for the room's answer to the hello: before it, the room
      // reads anything but a hello as a protocol fault.
      let welcomed = false;
      const done = new Promise<number>((resolve) => {
        socket.on('close', (code) => resolve(code));
        socket.on('error', () => undefined);
      });
      const send = (text: string): void => {
        bytes.sent += Buffer.byteLength(text);
        socket.send(text);
      };
      socket.on('open', () => {
        options.onSocket?.(rider, socket);
        send(hello(ticket));
      });
      socket.on('message', (data) => {
        const now = Date.now();
        const text = (data as Buffer).toString('utf8');
        bytes.received += Buffer.byteLength(text);
        const decoded = decodeRoomMessage(text);
        if (!decoded.ok) return;
        const message = decoded.message;
        if (message.type === 'welcome') {
          welcomed = true;
          intervalMs = message.roomConfig.frameIntervalMs;
          backoff = options.backoffMs ?? 500;
          if (closedAt !== undefined) {
            rejoinMs.push(now - closedAt);
            closedAt = undefined;
          }
          seated.add(rider);
          if (seated.size === count && seatedAt === undefined) {
            seatedAt = now;
            void startRace(devices[0]).catch((error: unknown) =>
              abort(error instanceof Error ? error.message : 'the start failed'),
            );
          }
        }
        if (message.type === 'frame') arrivals[rider]?.push({ tick: message.tick, atMs: now });
        if (message.type === 'finish') {
          finished = true;
          if (!raceOver) {
            raceOver = true;
            finishers = message.order.length;
          }
          // A finisher may stay to watch; this one leaves, as a rider closing the race screen does.
          socket.close(1000, 'the race is over');
        }
      });
      const report = setInterval(() => {
        if (!welcomed || socket.readyState !== WebSocket.OPEN) return;
        sequence += 1;
        const watts = profile.wattsPerKilogram * profile.massKilograms * (0.95 + 0.1 * noise());
        send(
          encodeMessage({
            type: 'report',
            sequence,
            atMs: Date.now(),
            powerWatts: Math.round(watts),
          }),
        );
      }, 500);
      const code = await done;
      open.delete(socket);
      clearInterval(report);
      if (stopping || finished) break;
      if (code >= 4000 && code < 5000) {
        // The room refused this rider (ticket-refused, room-closed, …): reopening cannot change the answer.
        // After the finish that is simply the race being over for a rider whose socket was down.
        if (!raceOver) abort(`the room refused a rider: close code ${String(code)}`);
        break;
      }
      closedAt = Date.now();
      disconnects.push({ rider, atSecond: Math.round((closedAt - started) / 1000), code });
      sequence = 0;
      await new Promise((resolve) => setTimeout(resolve, backoff));
      backoff = Math.min(backoff * 2, options.maximumBackoffMs ?? 10_000);
    }
  }

  // Each rider's loop ends at the room's `finish`; the time limit ends the rest.
  const riders = devices.map((device, rider) => ride(rider, device));
  let limit: NodeJS.Timeout | undefined;
  await Promise.race([
    Promise.all(riders),
    aborted,
    new Promise((done) => {
      limit = setTimeout(done, options.maximumMs);
    }),
  ]);
  clearTimeout(limit);
  stopping = true;
  for (const socket of open) socket.close(1000, 'the run is over');
  await Promise.race([Promise.all(riders), new Promise((done) => setTimeout(done, 5_000))]);

  const lateness = arrivals.flatMap((each) => latenessOf(each, intervalMs));
  const ended = Date.now();
  return {
    startedAt: new Date(started).toISOString(),
    riders: count,
    seatingSeconds: Math.round(((seatedAt ?? ended) - started) / 1000),
    raceSeconds: Math.round((ended - (startRequestedAt ?? ended)) / 1000),
    raceOver,
    abortReason: abortReason ?? null,
    finishers,
    frames: {
      total: arrivals.reduce((sum, each) => sum + each.length, 0),
      fewestToOneRider: Math.min(...arrivals.map((each) => each.length)),
    },
    missingTicks: arrivals.reduce((sum, each) => sum + missingTicksOf(each), 0),
    frameLatenessMs: {
      p50: percentile(lateness, 50),
      p95: percentile(lateness, 95),
      p99: percentile(lateness, 99),
      max: percentile(lateness, 100),
    },
    disconnects,
    rejoinMs,
    applicationBytes: bytes,
  };
}
