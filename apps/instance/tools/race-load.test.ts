// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The race load run's own code (#464), raced against an instance on this
 * machine: a short race to the line with one socket dropped in the middle,
 * and the arithmetic its lateness figures rest on. The real run is through
 * the real tunnel, to the owner's instance.
 *
 * Each case runs inside Vitest's 5 s default (#1688, #2569). A room ticks once
 * a second (`FRAME_INTERVAL_MS`), so what a case costs is mostly how many
 * ticks its race lasts, so the courses here are the shortest that still let
 * each case happen inside the race. Every run's own limit
 * is {@link RUN_LIMIT_MS}, under the case's, so a race that never ends fails
 * on `raceOver` and not on the case's timeout.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';

import { startInstance, type StartedInstance } from '../src/instance.ts';
import { freeLoopbackPort, testConfig } from '../src/instance-testing.ts';
import { readServerConfig } from '../src/server-config.ts';
import { migrateForDeploy } from '../src/store/serving.ts';
import {
  latenessOf,
  missingTicksOf,
  newRiderKeys,
  percentile,
  raceLoad,
  riderProfile,
} from './race-load-run.ts';

const CLI = fileURLToPath(new URL('../src/operator/cli.ts', import.meta.url));

/** The longest any run here may take: under the case's 5 s, so a run that never ends fails on its report. */
const RUN_LIMIT_MS = 4_000;
/**
 * A course one tick long: a rider who rides from the start is over the line at
 * the first tick, and one who was away for it, at the first tick after rejoining.
 */
const ONE_TICK_METRES = 1;
/** A course two ticks long: a socket dropped at the first frame is back before the line. */
const TWO_TICK_METRES = 2;
/** The back-off before a rejoin: the tool's 500 ms is for a tunnel, and this is loopback. */
const BACKOFF_MS = 20;
/**
 * How late a slow answer comes (#1400): longer than the run's 500 ms report
 * interval, so a rider that reported before its welcome, or opened its socket
 * before its ticket came, would have done it inside this wait.
 */
const SLOW_MS = 600;
/** The header a trusted proxy names a client's address in, for the case that needs addresses. */
const ADDRESS_HEADER = 'x-forwarded-for';

let running: StartedInstance | undefined;
let directory: string | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await running?.stop();
  running = undefined;
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
});

async function instanceWithRace(
  lengthMetres: number,
  registration: 'open' | 'approval' = 'open',
  keyed = false,
  loadAccounts: readonly string[] = [],
  clientAddressHeader: string | null = null,
) {
  directory = await mkdtemp(join(tmpdir(), 'oyl-instance-race-load-'));
  const path = join(directory, 'instance.sqlite');
  await migrateForDeploy(path);
  if (loadAccounts.length > 0) {
    // As the owner's run did (#1383): approved throwaway accounts, not open registration.
    const added = spawnSync(process.execPath, [CLI, 'load-accounts', 'add'], {
      encoding: 'utf8',
      input: `${loadAccounts.join('\n')}\n`,
      env: {
        ...process.env,
        OYL_INSTANCE_DATABASE: path,
        OYL_INSTANCE_BLOBS: join(directory, 'blobs'),
      },
    });
    expect(added.status, added.stderr).toBe(0);
  }
  const opened = spawnSync(
    process.execPath,
    [
      CLI,
      'room-open',
      'race',
      '--kind',
      'race',
      '--length',
      String(lengthMetres),
      '--countdown',
      '0',
    ],
    { encoding: 'utf8', env: { ...process.env, OYL_INSTANCE_DATABASE: path } },
  );
  expect(opened.status, opened.stderr).toBe(0);
  const port = await freeLoopbackPort();
  const origin = `http://127.0.0.1:${String(port)}`;
  const server = readServerConfig({ database: path, origin, roomWorkers: '1' }, 1);
  if (!server.ok) throw new Error(server.problems.join(' '));
  running = await startInstance({
    config: testConfig({ port, bodyLimitBytes: 16_384, registration, clientAddressHeader }),
    // Keyed, it serves an encryption key, so signing in, the ticket and the
    // start are sealed-only (#1210): the run must seal them or be refused.
    server: { ...server.config, ...(keyed ? { secretKey: new Uint8Array(32).fill(7) } : {}) },
    version: '0',
    notices: '',
    log: () => undefined,
  });
  if (keyed) await running.keysMaintained;
  return origin;
}

/** Calls `then` on the first message of `type` the socket is sent, after the run has read it. */
function onFirst(socket: WebSocket, type: string, then: () => void): void {
  let seen = false;
  socket.on('message', (data) => {
    if (seen || !(data as Buffer).toString('utf8').includes(`"type":"${type}"`)) return;
    seen = true;
    then();
  });
}

describe('the race load run — #464, raced locally', () => {
  it('seats every rider, starts the race, rides it to the line, and counts a dropped socket and its rejoin', async () => {
    const url = await instanceWithRace(TWO_TICK_METRES);
    let dropped = false;
    const report = await raceLoad({
      url,
      roomId: 'race',
      keys: await newRiderKeys(3),
      namePrefix: 'Load',
      maximumMs: RUN_LIMIT_MS,
      backoffMs: BACKOFF_MS,
      onSocket: (rider, socket) => {
        if (rider === 2 && !dropped) {
          dropped = true;
          // After the start, once frames are flowing: a rejoin into a running race.
          onFirst(socket, 'frame', () => socket.terminate());
        }
      },
    });
    expect(report.riders).toBe(3);
    expect(report.raceOver).toBe(true);
    // Over at the line, not at the time limit: the riders leave when the room says so.
    expect(report.raceSeconds).toBeLessThan(RUN_LIMIT_MS / 1000);
    expect(report.finishers).toBe(3);
    expect(report.disconnects).toEqual([
      { rider: 2, atSecond: expect.any(Number) as number, code: 1006 },
    ]);
    expect(report.rejoinMs).toHaveLength(1);
    expect(report.frames.fewestToOneRider).toBeGreaterThan(0);
    expect(report.frameLatenessMs.p50).not.toBeNull();
    expect(report.applicationBytes.received).toBeGreaterThan(0);
    expect(report.applicationBytes.sent).toBeGreaterThan(0);
  });

  it('seals signing in, the tickets and the start on an instance that holds keys (#1210)', async () => {
    const url = await instanceWithRace(ONE_TICK_METRES, 'open', true);
    const served = (await (await fetch(`${url}/v1/instance/keys`)).json()) as {
      statements?: unknown[];
    };
    expect(served.statements?.length ?? 0).toBeGreaterThan(0);
    const report = await raceLoad({
      url,
      roomId: 'race',
      keys: await newRiderKeys(2),
      namePrefix: 'Sealed',
      maximumMs: RUN_LIMIT_MS,
    });
    expect(report.abortReason).toBeNull();
    expect(report.raceOver).toBe(true);
    expect(report.finishers).toBe(2);
  });
});

/**
 * What each socket a rider opened sent, in order, and whether the room had
 * welcomed it yet: `onSocket` hands over the socket, and its `send` is read.
 */
function recordSends(): {
  onSocket: (rider: number, socket: WebSocket) => void;
  sockets: { rider: number; sent: string[] }[];
} {
  const sockets: { rider: number; sent: string[] }[] = [];
  return {
    sockets,
    onSocket: (rider, socket) => {
      const record = { rider, sent: [] as string[] };
      sockets.push(record);
      let welcomed = false;
      socket.on('message', (data) => {
        if ((data as Buffer).toString('utf8').includes('"type":"welcome"')) welcomed = true;
      });
      const send = socket.send.bind(socket);
      socket.send = ((text: string) => {
        const type = (JSON.parse(text) as { type: string }).type;
        record.sent.push(welcomed ? type : `${type} before welcome`);
        send(text);
      }) as typeof socket.send;
    },
  };
}

/** The room's answers to `socket` held back {@link SLOW_MS}, as a loaded tunnel holds them. */
function holdAnswers(socket: WebSocket): void {
  socket.pause();
  setTimeout(() => socket.resume(), SLOW_MS);
}

/**
 * `fetch` as through a loaded tunnel, which is what the owner's run met (#1400).
 * Every sealed request carrying a session (a ticket, the start) for which
 * `slow()` says so is answered {@link SLOW_MS} late. With `addresses`, every
 * request names a client address in {@link ADDRESS_HEADER}, and the address
 * moves on after each `429` the instance answers: see the fifty-rider case.
 */
function throughATunnel(
  slow: () => boolean,
  addresses = false,
): { readonly refusals: () => number } {
  const real = globalThis.fetch;
  let refusals = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const headers = new Headers(init?.headers);
    if (headers.has('authorization') && slow()) {
      await new Promise((done) => setTimeout(done, SLOW_MS));
    }
    if (addresses) headers.set(ADDRESS_HEADER, `198.51.100.${String(refusals + 1)}`);
    const response = await real(input, { ...init, headers });
    if (response.status === 429) refusals += 1;
    return response;
  });
  return { refusals: () => refusals };
}

describe('a rider says hello before anything else, and only then reports — #1400', () => {
  it('sends nothing but its hello until the room answers it, however slow the ticket and the answer', async () => {
    const url = await instanceWithRace(ONE_TICK_METRES, 'open', true);
    // The two tickets come late; the start, which is the third session call, does not.
    let sessionCalls = 0;
    throughATunnel(() => (sessionCalls += 1) <= 2);
    const sends = recordSends();
    const report = await raceLoad({
      url,
      roomId: 'race',
      keys: await newRiderKeys(2),
      namePrefix: 'Slow',
      maximumMs: RUN_LIMIT_MS,
      onSocket: (rider, socket) => {
        sends.onSocket(rider, socket);
        // The room's answer held back past a report interval: a report sent meanwhile would precede it.
        holdAnswers(socket);
      },
    });
    // No `1008 hello-expected`, and no other close.
    expect(report.disconnects).toEqual([]);
    expect(report.abortReason).toBeNull();
    expect(report.raceOver).toBe(true);
    expect(sends.sockets).toHaveLength(2);
    for (const socket of sends.sockets) {
      expect(socket.sent[0]).toBe('hello before welcome');
      expect(socket.sent.slice(1).filter((each) => each.endsWith('before welcome'))).toEqual([]);
      // It did report once welcomed, so the line above is not empty for want of reports.
      expect(socket.sent).toContain('report');
    }
  });

  it('does the same on a rejoin into the started race, however slow the new ticket and the answer', async () => {
    const url = await instanceWithRace(ONE_TICK_METRES, 'open', true);
    // Fast until the drop; from then on, the rejoin's ticket comes late and its answer is held.
    let dropped = false;
    throughATunnel(() => dropped);
    const sends = recordSends();
    const report = await raceLoad({
      url,
      roomId: 'race',
      keys: await newRiderKeys(2),
      namePrefix: 'Slow',
      maximumMs: RUN_LIMIT_MS,
      backoffMs: BACKOFF_MS,
      onSocket: (rider, socket) => {
        sends.onSocket(rider, socket);
        if (dropped) holdAnswers(socket);
        if (rider === 1 && !dropped) {
          // Dropped once the room has started the race: the rejoin is into it.
          onFirst(socket, 'countdown', () => {
            dropped = true;
            socket.terminate();
          });
        }
      },
    });
    // The one drop the test made, and no `1008 hello-expected`.
    expect(report.disconnects).toEqual([
      { rider: 1, atSecond: expect.any(Number) as number, code: 1006 },
    ]);
    expect(report.rejoinMs).toHaveLength(1);
    expect(report.abortReason).toBeNull();
    expect(report.raceOver).toBe(true);
    // Rider 0's socket, and rider 1's first and its rejoin.
    expect(sends.sockets.map((socket) => socket.rider).sort()).toEqual([0, 1, 1]);
    const rejoin = sends.sockets.at(-1);
    expect(rejoin?.rider).toBe(1);
    expect(rejoin?.sent[0]).toBe('hello before welcome');
    expect(rejoin?.sent.slice(1).filter((each) => each.endsWith('before welcome'))).toEqual([]);
    expect(rejoin?.sent).toContain('report');
  });

  it('seats fifty riders through a slow ticket on an instance that holds keys, with no close at all, inside the sign-in limit', async () => {
    const keys = await newRiderKeys(50);
    const url = await instanceWithRace(
      ONE_TICK_METRES,
      'approval',
      true,
      keys.map((key) => key.publicKey),
      ADDRESS_HEADER,
    );
    // Fifty tickets come late; the start, the fifty-first session call, does not.
    let sessionCalls = 0;
    // The instance takes 30 sealed sign-ins an address a minute
    // (`sessionlessSealedPerAddress`), so fifty from one address meet that
    // limit at the thirty-first, and the run must wait it out and not stop. The
    // refusal is the instance's own; the address moving on after it stands
    // for the minute running out, which here would be the case's whole cost.
    const tunnel = throughATunnel(() => (sessionCalls += 1) <= 50, true);
    const report = await raceLoad({
      url,
      roomId: 'race',
      keys,
      namePrefix: 'Load',
      maximumMs: RUN_LIMIT_MS,
      rateLimitedWaitMs: BACKOFF_MS,
    });
    expect(tunnel.refusals()).toBe(1);
    expect(report.abortReason).toBeNull();
    expect(report.disconnects).toEqual([]);
    expect(report.raceOver).toBe(true);
    expect(report.finishers).toBe(50);
  });
});

describe('a misconfigured run stops instead of looping', () => {
  it('aborts with a reason, and reconnects nowhere, against an instance that holds new riders for approval', async () => {
    const url = await instanceWithRace(ONE_TICK_METRES, 'approval');
    const started = Date.now();
    const report = await raceLoad({
      url,
      roomId: 'race',
      keys: await newRiderKeys(3),
      namePrefix: 'Load',
      maximumMs: RUN_LIMIT_MS,
    });
    expect(report.raceOver).toBe(false);
    expect(report.abortReason).toMatch(/ticket was refused/);
    expect(report.disconnects.length).toBeLessThanOrEqual(3);
    // It stopped at the refusal, not at the run's limit.
    expect(Date.now() - started).toBeLessThan(RUN_LIMIT_MS);
  });
});

describe('the arithmetic the figures rest on', () => {
  it('measures lateness from the soonest frame, needing no clock shared with the room', () => {
    // Ticks 1–4 due a second apart; the room's clock is 10 000 ms off the rider's.
    const arrivals = [
      { tick: 1, atMs: 11_050 },
      { tick: 2, atMs: 12_020 },
      { tick: 3, atMs: 13_300 },
      { tick: 4, atMs: 14_020 },
    ];
    expect(latenessOf(arrivals, 1000)).toEqual([30, 0, 280, 0]);
    expect(latenessOf([], 1000)).toEqual([]);
  });

  it('does not report a permanent schedule slip as lateness', () => {
    // A server stall at tick 300 delays every later frame by 400 ms for good.
    const arrivals = Array.from({ length: 600 }, (_, i) => ({
      tick: i,
      atMs: i * 1000 + (i >= 300 ? 400 : 0) + (i === 500 ? 50 : 0),
    }));
    const lateness = latenessOf(arrivals, 1000);
    expect(Math.max(...lateness.slice(430))).toBe(50);
    expect(lateness[500]).toBe(50);
  });

  it('counts the ticks that never arrived, between the first and the last', () => {
    expect(missingTicksOf([{ tick: 3 }, { tick: 4 }, { tick: 7 }])).toBe(2);
    expect(missingTicksOf([{ tick: 5 }, { tick: 5 }])).toBe(0);
    expect(missingTicksOf([])).toBe(0);
  });

  it('takes the nearest-rank percentile', () => {
    const values = [5, 1, 4, 2, 3, 10, 9, 8, 7, 6];
    expect(percentile(values, 50)).toBe(5);
    expect(percentile(values, 95)).toBe(10);
    expect(percentile(values, 100)).toBe(10);
    expect(percentile(values, 0)).toBe(1);
    expect(percentile([], 50)).toBeNull();
  });

  it('gives a spread field inside the ticket’s mass and a race’s power', () => {
    const field = Array.from({ length: 50 }, (_, i) => riderProfile(i));
    for (const rider of field) {
      expect(rider.massKilograms).toBeGreaterThanOrEqual(60);
      expect(rider.massKilograms).toBeLessThanOrEqual(90);
      expect(rider.wattsPerKilogram).toBeGreaterThanOrEqual(3);
      expect(rider.wattsPerKilogram).toBeLessThanOrEqual(4);
    }
    expect(new Set(field.map((r) => r.wattsPerKilogram)).size).toBe(11);
  });
});
