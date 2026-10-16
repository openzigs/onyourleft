// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The race load run's own code (#464), raced against an instance on this
 * machine: a short race to the line with one socket dropped in the middle,
 * and the arithmetic its lateness figures rest on. The real run is through
 * the real tunnel, to the owner's instance.
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
    config: testConfig({ port, bodyLimitBytes: 16_384, registration }),
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

describe('the race load run — #464, raced locally', () => {
  it('seats every rider, starts the race, rides it to the line, and counts a dropped socket and its rejoin', async () => {
    const url = await instanceWithRace(40);
    let dropped = false;
    const report = await raceLoad({
      url,
      roomId: 'race',
      keys: await newRiderKeys(3),
      namePrefix: 'Load',
      maximumMs: 45_000,
      onSocket: (rider, socket) => {
        if (rider === 2 && !dropped) {
          dropped = true;
          // After the start, once frames are flowing: a rejoin into a running race.
          setTimeout(() => socket.terminate(), 2_500);
        }
      },
    });
    expect(report.riders).toBe(3);
    expect(report.raceOver).toBe(true);
    // Over at the line, not at the time limit: the riders leave when the room says so.
    expect(report.raceSeconds).toBeLessThan(40);
    expect(report.finishers).toBe(3);
    expect(report.disconnects).toEqual([
      { rider: 2, atSecond: expect.any(Number) as number, code: 1006 },
    ]);
    expect(report.rejoinMs).toHaveLength(1);
    expect(report.frames.fewestToOneRider).toBeGreaterThan(0);
    expect(report.frameLatenessMs.p50).not.toBeNull();
    expect(report.applicationBytes.received).toBeGreaterThan(0);
    expect(report.applicationBytes.sent).toBeGreaterThan(0);
  }, 60_000);

  it('seals signing in, the tickets and the start on an instance that holds keys (#1210)', async () => {
    const url = await instanceWithRace(20, 'open', true);
    const served = (await (await fetch(`${url}/v1/instance/keys`)).json()) as {
      statements?: unknown[];
    };
    expect(served.statements?.length ?? 0).toBeGreaterThan(0);
    const report = await raceLoad({
      url,
      roomId: 'race',
      keys: await newRiderKeys(2),
      namePrefix: 'Sealed',
      maximumMs: 45_000,
    });
    expect(report.abortReason).toBeNull();
    expect(report.raceOver).toBe(true);
    expect(report.finishers).toBe(2);
  }, 60_000);
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

/**
 * Every sealed request carrying a session (a ticket, the start) answered
 * `delayMs` late, as through a loaded tunnel: what the owner's run met (#1400).
 */
function slowSessionCalls(delayMs: number): void {
  const real = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const headers = new Headers(init?.headers);
    if (headers.has('authorization')) await new Promise((done) => setTimeout(done, delayMs));
    return real(input, init);
  });
}

describe('a rider says hello before anything else, and only then reports — #1400', () => {
  it('sends nothing but its hello until the room answers it, on a first join and on a rejoin, however slow the ticket and the answer', async () => {
    const url = await instanceWithRace(40, 'open', true);
    slowSessionCalls(1_500);
    const sends = recordSends();
    let dropped = false;
    const report = await raceLoad({
      url,
      roomId: 'race',
      keys: await newRiderKeys(2),
      namePrefix: 'Slow',
      maximumMs: 50_000,
      onSocket: (rider, socket) => {
        sends.onSocket(rider, socket);
        // The room's answer held back past several report intervals, as a
        // loaded tunnel holds it: a report sent meanwhile would precede it.
        socket.pause();
        setTimeout(() => socket.resume(), 1_500);
        if (rider === 1 && !dropped) {
          dropped = true;
          // A rejoin into the running race: dropped at its third frame.
          let frames = 0;
          socket.on('message', (data) => {
            if (!(data as Buffer).toString('utf8').includes('"type":"frame"')) return;
            frames += 1;
            if (frames === 3) socket.terminate();
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
    expect(sends.sockets).toHaveLength(3);
    for (const socket of sends.sockets) {
      expect(socket.sent[0]).toBe('hello before welcome');
      expect(socket.sent.slice(1).filter((each) => each.endsWith('before welcome'))).toEqual([]);
    }
  }, 70_000);

  it('seats fifty riders through a slow ticket on an instance that holds keys, with no close at all, inside the sign-in limit', async () => {
    const keys = await newRiderKeys(50);
    const url = await instanceWithRace(
      30,
      'approval',
      true,
      keys.map((key) => key.publicKey),
    );
    slowSessionCalls(1_000);
    const report = await raceLoad({
      url,
      roomId: 'race',
      keys,
      namePrefix: 'Load',
      maximumMs: 60_000,
      rateLimitedWaitMs: 2_000,
    });
    expect(report.abortReason).toBeNull();
    expect(report.disconnects).toEqual([]);
    expect(report.raceOver).toBe(true);
    expect(report.finishers).toBe(50);
  }, 150_000);
});

describe('a misconfigured run stops instead of looping', () => {
  it('aborts with a reason, and reconnects nowhere, against an instance that holds new riders for approval', async () => {
    const url = await instanceWithRace(40, 'approval');
    const report = await raceLoad({
      url,
      roomId: 'race',
      keys: await newRiderKeys(3),
      namePrefix: 'Load',
      maximumMs: 20_000,
    });
    expect(report.raceOver).toBe(false);
    expect(report.abortReason).toMatch(/ticket was refused/);
    expect(report.disconnects.length).toBeLessThanOrEqual(3);
    // It stopped at the refusal, not at the 20 s limit.
    expect(report.raceSeconds).toBeLessThan(10);
  }, 30_000);
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
