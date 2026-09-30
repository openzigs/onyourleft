// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Node adapter's own behaviour (#780), over real `ws` sockets on loopback:
 * backpressure, the keepalive through a proxy that closes idle connections,
 * a dead peer, and results handed on as they become final.
 */

import { createServer, Socket, type AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import type { Frame } from '@onyourleft/protocol';

import { admitByTable, FLAT_COURSE, helloText, reportText } from '../core/room-testing.ts';
import { roomSettings, type RoomSettings } from '../core/settings.ts';
import { serveHost, until } from './node-room-testing.ts';
import { RoomHost, type HostOptions, type RoomResult } from './room-host.ts';

const admit = admitByTable();
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function hosted(settings: RoomSettings, options: Partial<HostOptions>) {
  const host = new RoomHost({
    now: () => Date.now(),
    admit: (_roomId, ticket) => Promise.resolve(admit(ticket)),
    pingIntervalMs: 0,
    ...options,
  });
  const served = await serveHost(() => host, settings);
  cleanups.push(async () => {
    await host.stop({ code: 1001, reason: 'server-stopping' }, 200);
    await served.close();
  });
  return { host, url: served.url };
}

function client(url: string, options: ConstructorParameters<typeof WebSocket>[2] = {}) {
  const socket = new WebSocket(url, options);
  const frames: Frame[] = [];
  let closed: { code: number } | undefined;
  socket.on('message', (data) => {
    const parsed = JSON.parse((data as Buffer).toString('utf8')) as { type: string };
    if (parsed.type === 'frame') frames.push(parsed as Frame);
  });
  socket.on('close', (code) => {
    closed = { code };
  });
  socket.on('error', () => undefined);
  cleanups.push(() => socket.terminate());
  const open = new Promise<void>((done, failed) => {
    socket.once('open', () => done());
    socket.once('error', failed);
  });
  return {
    socket,
    frames,
    open,
    get closed() {
      return closed;
    },
  };
}

describe('backpressure — #780 criterion 4', () => {
  it('lets go of a client that stops reading once its unsent bytes pass the limit, and never makes a tick wait for it', async () => {
    // Driven: the test fires the ticks itself, one room second apart, as fast
    // as the sockets drain — so a stalled socket fills in a second rather than
    // in the minutes a 1 Hz room would take — and times every tick.
    let nowMs = 0;
    const LIMIT = 64 * 1024;
    const { host, url } = await hosted(
      roomSettings({
        kind: 'ride',
        ridingPosition: 'hoods',
        course: FLAT_COURSE,
        countdownMs: 0,
        // Long enough that a dropped rider stays in every frame for the test.
        rejoinWindowMs: 1_000_000_000,
        capacity: 100,
      }),
      { now: () => nowMs, driven: true, maxBufferedBytes: LIMIT },
    );
    // Ninety-six riders seated and then dropped, so every frame carries a full
    // field (about 8 KB) while only four sockets are written to.
    const field = Array.from({ length: 96 }, () => client(url));
    await Promise.all(field.map((passing) => passing.open));
    field.forEach((passing, i) => passing.socket.send(helloText(`ticket-field-${String(i)}`)));
    await until(() => host.view('conformance')?.seats.length === 96, 'the field seated');
    for (const passing of field) passing.socket.close();
    await until(
      () => host.view('conformance')?.seats.every((seat) => seat.state === 'held') === true,
      'the field dropped',
    );
    const readers: ReturnType<typeof client>[] = [];
    for (let i = 0; i < 3; i += 1) {
      const reader = client(url);
      await reader.open;
      reader.socket.send(helloText(`ticket-reader-${String(i)}`));
      readers.push(reader);
    }
    const stalled = client(url);
    await stalled.open;
    stalled.socket.send(helloText('ticket-stalled'));
    await until(() => host.view('conformance')?.seats.length === 100, 'a full room');
    // It stops reading: nothing more is taken off its socket.
    stopReading((stalled.socket as unknown as { _socket: Socket })._socket);

    const tickMs: number[] = [];
    let ticks = 0;
    while ((host.metrics().refusals['too-slow'] ?? 0) === 0 && ticks < 5_000) {
      nowMs += 1_000;
      const started = performance.now();
      host.tick('conformance');
      tickMs.push(performance.now() - started);
      ticks += 1;
      // Let the sockets write, and the readers read, between ticks.
      await new Promise((done) => setImmediate(done));
    }
    expect(host.metrics().refusals['too-slow']).toBe(1);
    const seat = host.view('conformance')?.seats.find((s) => s.athleteId === 'stalled');
    // Let go, not thrown out: a held seat, coasting, rejoinable.
    expect(seat?.state).toBe('held');
    expect(stalled.frames.length).toBeLessThan(ticks);
    // Every reader was sent every tick's frame…
    await until(
      () => readers.every((r) => r.frames.length >= ticks),
      'every frame to arrive',
      10_000,
    );
    // …and no tick waited on the stalled socket. A 100-rider tick is about
    // 10 ms of physics on a developer's machine (measured: median 10.5 ms,
    // worst 147 ms with a collection in it), and coverage and a two-core
    // runner slow it several times over; the bound is half the frame
    // interval, 500 ms, which a tick that waited for the stalled socket to
    // drain would miss by the whole stall.
    tickMs.sort((a, b) => a - b);
    expect(tickMs[Math.floor(tickMs.length * 0.99)]).toBeLessThan(500);
  }, 60_000);
});

/** Stops a socket reading for good: the kernel's buffers fill, and then the sender's. */
function stopReading(socket: Socket): void {
  const handle = (socket as unknown as { _handle: { readStop(): number; reading: boolean } })
    ._handle;
  socket.pause();
  socket.resume = () => socket;
  socket._read = () => undefined;
  handle.reading = false;
  handle.readStop();
}

/** A TCP proxy that closes both sides after `idleMs` with no byte in either direction. */
async function idleClosingProxy(target: string, idleMs: number) {
  const { hostname, port } = new URL(target);
  let closedForIdle = 0;
  const server = createServer((inbound) => {
    const outbound = new Socket();
    outbound.connect(Number(port), hostname);
    let timer = setTimeout(close, idleMs);
    function touch(): void {
      clearTimeout(timer);
      timer = setTimeout(close, idleMs);
    }
    function close(): void {
      closedForIdle += 1;
      inbound.destroy();
      outbound.destroy();
    }
    inbound.on('data', (chunk) => {
      touch();
      outbound.write(chunk);
    });
    outbound.on('data', (chunk) => {
      touch();
      inbound.write(chunk);
    });
    inbound.on('close', () => {
      clearTimeout(timer);
      outbound.destroy();
    });
    outbound.on('close', () => {
      clearTimeout(timer);
      inbound.destroy();
    });
    inbound.on('error', () => undefined);
    outbound.on('error', () => undefined);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address() as AddressInfo;
  cleanups.push(
    () =>
      new Promise<void>((done) => {
        server.close(() => done());
      }),
  );
  return {
    url: target.replace(`:${port}`, `:${String(address.port)}`),
    get closedForIdle() {
      return closedForIdle;
    },
  };
}

describe('the keepalive — #780 criterion 8, through a proxy that closes idle sockets', () => {
  const lobby = () => roomSettings({ kind: 'race', ridingPosition: 'hoods', course: FLAT_COURSE });

  it('pings often enough that a quiet lobby’s socket outlives the proxy’s idle timeout several times over', async () => {
    const { url } = await hosted(lobby(), { pingIntervalMs: 250 });
    const proxy = await idleClosingProxy(url, 1_000);
    const rider = client(proxy.url);
    await rider.open;
    rider.socket.send(helloText('ticket-ann'));
    await new Promise((done) => setTimeout(done, 3_000));
    expect(rider.closed).toBeUndefined();
    expect(proxy.closedForIdle).toBe(0);
  }, 10_000);

  it('control: with no ping, the same proxy closes the same quiet socket', async () => {
    const { url } = await hosted(lobby(), { pingIntervalMs: 0 });
    const proxy = await idleClosingProxy(url, 1_000);
    const rider = client(proxy.url);
    await rider.open;
    rider.socket.send(helloText('ticket-ann'));
    await until(() => rider.closed !== undefined, 'the proxy to close it', 4_000);
    expect(proxy.closedForIdle).toBe(1);
  }, 10_000);

  it('terminates a peer that stops answering pings, and the room holds its seat', async () => {
    const { host, url } = await hosted(
      roomSettings({ kind: 'ride', ridingPosition: 'hoods', course: FLAT_COURSE, countdownMs: 0 }),
      { pingIntervalMs: 100 },
    );
    const silent = client(url, { autoPong: false });
    await silent.open;
    silent.socket.send(helloText('ticket-ann'));
    await until(() => silent.closed !== undefined, 'the silent peer to be let go', 3_000);
    expect(silent.closed?.code).toBe(1006);
    await until(() => host.view('conformance')?.seats[0]?.state === 'held', 'the seat to be held');
  }, 10_000);
});

describe('results — handed on as each becomes final, not at the end', () => {
  it('reports a finisher at once, with their time, while the rest of the race rides on', async () => {
    const results: RoomResult[] = [];
    let nowMs = 0;
    const { host, url } = await hosted(
      roomSettings({
        kind: 'race',
        ridingPosition: 'hoods',
        course: { ...FLAT_COURSE, lengthMetres: 40 },
        countdownMs: 0,
      }),
      { now: () => nowMs, driven: true, onResult: (_room, result) => results.push(result) },
    );
    const ann = client(url);
    const bob = client(url);
    await Promise.all([ann.open, bob.open]);
    ann.socket.send(helloText('ticket-ann'));
    bob.socket.send(helloText('ticket-bob'));
    await until(() => host.view('conformance')?.seats.length === 2, 'both seated');
    host.start('conformance');
    for (let second = 1; second <= 12 && results.length === 0; second += 1) {
      nowMs = second * 1000 - 500;
      ann.socket.send(reportText(second, nowMs, 600));
      await new Promise((done) => setTimeout(done, 5));
      nowMs = second * 1000;
      host.tick('conformance');
    }
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ athleteId: 'ann', flags: expect.any(Number) as number });
    expect(results[0]?.finishMs).toBeGreaterThan(0);
    expect(host.view('conformance')?.phase).toBe('running');
  }, 10_000);
});
