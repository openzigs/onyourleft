// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The open-world session — #2896: a start read into its blocks, a graph, a
 * snapped start and a rolling route, over the synthetic fixture archive beside
 * this file (`fixture-testing.ts`) through the product's own archive reader
 * (`corridor-source.ts` §`corridorArchiveFrom`), decoder and graph. What the
 * session hands out is read back as the game reads it: the card's profile,
 * position by position. The ride through the game screen is
 * `session-ride.test.tsx`'s.
 */

import { distanceBetween, type GeographicPosition, type RouteProfile } from '@onyourleft/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FIXTURE_TILE, graphFixtureTile, starTile } from '@onyourleft/map-features/testing';

import { buildArchive, countingSource } from '../../world-data/archive-testing';
import { corridorArchiveFrom } from '../../world-data/corridor-source';
import type { CorridorArchive } from '../world-data/corridor';
import {
  FAR_COLUMN,
  FAR_ROW,
  fixturePosition,
  fixtureStart,
  MAIN_STREET_ROW,
  OPEN_WORLD_FIXTURE_STREETS,
  OPEN_WORLD_FIXTURE_TILES,
  openWorldFixtureArchive,
  RING_LAST,
  RING_NODE,
  START_COLUMN,
  START_ROW,
  TURNING_CIRCLE_STREETS,
} from './fixture-testing';
import {
  describeOpenWorldRefusal,
  OPEN_WORLD_ROUTE_ID,
  OPEN_WORLD_START_REACH_METRES,
  type OpenWorldReady,
  type OpenWorldRefusal,
} from './ride';
import { createOpenWorldSession, OPEN_WORLD_START_TIMEOUT_MS } from './session';
import type { OpenWorldStart } from './start';
import { describeTilePlanFailure } from './tile-planner';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The position `distance` metres along `profile`, as the game reads one: between samples. */
function positionAlong(profile: RouteProfile, distance: number): GeographicPosition {
  const step = profile.resolution as number;
  const index = Math.min(profile.positions.length - 2, Math.floor(distance / step));
  const share = (distance - index * step) / step;
  const a = profile.positions[index] as GeographicPosition;
  const b = profile.positions[index + 1] as GeographicPosition;
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * share,
    longitude: a.longitude + (b.longitude - a.longitude) * share,
  } as GeographicPosition;
}

/** `east` metres due east of `from`, by the game's equirectangular frame. */
function eastOf(from: GeographicPosition, east: number): GeographicPosition {
  return {
    latitude: from.latitude,
    longitude: from.longitude + east / (111_320 * Math.cos((from.latitude * Math.PI) / 180)),
  } as GeographicPosition;
}

async function fixtureArchive(): Promise<{
  archive: CorridorArchive;
  calls: () => number;
}> {
  const source = countingSource(await openWorldFixtureArchive());
  return { archive: corridorArchiveFrom(source), calls: () => source.calls.length };
}

async function ready(start: OpenWorldStart, archive: CorridorArchive): Promise<OpenWorldReady> {
  const session = createOpenWorldSession({
    start,
    archive,
    mapTilesOn: () => true,
    yieldToIdle: () => Promise.resolve(),
  });
  try {
    return await session.ready;
  } finally {
    session.stop();
  }
}

describe('an open-world session on the fixture archive — #2896', () => {
  it('snaps the start to the street beside it and rides east along it on the default way', async () => {
    const { archive, calls } = await fixtureArchive();
    const outcome = await ready(fixtureStart(START_COLUMN, START_ROW), archive);
    expect(calls()).toBeGreaterThan(0);
    if (outcome.kind !== 'ready') throw new Error(`not ready: ${outcome.kind}`);
    const { route } = outcome;
    expect(route.id).toBe(OPEN_WORLD_ROUTE_ID);
    expect(route.attempts).toBe(0);
    const { profile } = route;
    // The first view: the rolling route's 2 km, on its exact 10 m grid, flat.
    expect(profile.totalDistance).toBe(2_000);
    expect(profile.loop).toBe(false);
    expect(new Set(profile.grades)).toStrictEqual(new Set([0]));
    // Its first point is the start snapped onto Main street: due north of the pin.
    const snapped = fixturePosition(START_COLUMN, MAIN_STREET_ROW);
    expect(distanceBetween(profile.positions[0] as GeographicPosition, snapped)).toBeLessThan(0.5);
    // 500 m on is still Main street, 500 m east: straight on at the western
    // cross street, the default way (the smallest turn).
    const at500 = positionAlong(profile, 500);
    expect(distanceBetween(at500, eastOf(snapped, 500))).toBeLessThan(2);
  });

  it('turns round onto the street behind the start at a dead end, never back and forth on it', async () => {
    const { archive } = await fixtureArchive();
    // Near Main street's east end: the way on east is 200-odd m long and ends.
    const outcome = await ready(fixtureStart(3000, START_ROW), archive);
    if (outcome.kind !== 'ready') throw new Error(`not ready: ${outcome.kind}`);
    const { profile } = outcome.route;
    const start = fixturePosition(3000, MAIN_STREET_ROW);
    const end = fixturePosition(4000, MAIN_STREET_ROW);
    const toEnd = distanceBetween(start, end);
    // Back past the start by as far again as the end is from it: the half of
    // the street behind the start is a way on from the start.
    const past = positionAlong(profile, 2 * toEnd + 300);
    expect(distanceBetween(past, eastOf(start, -300))).toBeLessThan(2);
  });

  it('offers a loop both ways round, and takes the way nearest straight on', async () => {
    const source = countingSource(await openWorldFixtureArchive(TURNING_CIRCLE_STREETS));
    // About 12 m east of the stem, 100 m short of the ring: the ride heads north.
    const outcome = await ready(fixtureStart(-2950, 3300), corridorArchiveFrom(source));
    if (outcome.kind !== 'ready') throw new Error(`not ready: ${outcome.kind}`);
    const { profile } = outcome.route;
    const node = fixturePosition(...RING_NODE);
    const last = fixturePosition(...RING_LAST);
    const atNode = distanceBetween(fixturePosition(-3000, 3300), node);
    // 30 m past the node the rider is on the ring's last side, ridden from the
    // node: about 7° left of straight on, not the first side's 84° right.
    const share = 30 / distanceBetween(node, last);
    const expected = fixturePosition(
      RING_NODE[0] + (RING_LAST[0] - RING_NODE[0]) * share,
      RING_NODE[1] + (RING_LAST[1] - RING_NODE[1]) * share,
    );
    expect(distanceBetween(positionAlong(profile, atNode + 30), expected)).toBeLessThan(2);
  });

  it('rides on past a hostile tile the graph refuses, and says so naming no place', async () => {
    // Main street's eastern tile is 3,000 streets through one point.
    const tiles = OPEN_WORLD_FIXTURE_TILES.map((tile) => ({
      x: tile.x,
      y: tile.y,
      bytes:
        tile.x === FIXTURE_TILE.x && tile.y === FIXTURE_TILE.y
          ? starTile(3000, 200)
          : graphFixtureTile(OPEN_WORLD_FIXTURE_STREETS, tile),
    }));
    const source = countingSource(await buildArchive({ tiles }));
    const lines: string[] = [];
    const start = fixtureStart(START_COLUMN, START_ROW);
    const session = createOpenWorldSession({
      start,
      archive: corridorArchiveFrom(source),
      mapTilesOn: () => true,
      yieldToIdle: () => Promise.resolve(),
      log: (line) => lines.push(line),
    });
    expect((await session.ready).kind).toBe('ready');
    session.stop();
    // #2901: this platform has no `Worker`, so the tile planner says its own
    // line too, which names nothing; the graph's is the other one.
    const planner = describeTilePlanFailure();
    expect(lines.filter((line) => line === planner)).toHaveLength(1);
    lines.splice(lines.indexOf(planner), 1);
    expect(lines).toHaveLength(1);
    // `describeStreetGraphRefusal`'s words: the constraint and its limit.
    expect(lines[0]).toMatch(/^street graph: the tile.* the limit of \d+/);
    for (const id of [FIXTURE_TILE.x, FIXTURE_TILE.y]) expect(lines[0]).not.toContain(String(id));
    for (const digits of [1, 2, 3, 4]) {
      expect(lines[0]).not.toContain(start.position.latitude.toFixed(digits));
      expect(lines[0]).not.toContain(start.position.longitude.toFixed(digits));
    }
  });

  it('refuses a start with no street within its reach, in words that name no coordinate', async () => {
    const { archive } = await fixtureArchive();
    const start = fixtureStart(FAR_COLUMN, FAR_ROW);
    const outcome = await ready(start, archive);
    expect(outcome).toStrictEqual({ kind: 'refused', refusal: 'no-street' });
    // The one number is the stated constraint, in the rider's units.
    expect(describeOpenWorldRefusal('no-street', 'metric')).toContain(
      `within ${String(OPEN_WORLD_START_REACH_METRES)} m of that start`,
    );
    expect(describeOpenWorldRefusal('no-street', 'imperial')).toContain('within 656 ft');
    for (const units of ['metric', 'imperial'] as const) {
      const words = describeOpenWorldRefusal('no-street', units);
      expect(words.match(/\d+/g)).toHaveLength(1);
      for (const digits of [1, 2, 3, 4, 5, 6]) {
        expect(words).not.toContain(start.position.latitude.toFixed(digits));
        expect(words).not.toContain(start.position.longitude.toFixed(digits));
      }
    }
  });

  it('says every refusal in words that hold no number but the reach', () => {
    const refusals: readonly OpenWorldRefusal[] = [
      'no-street',
      'map-tiles-off',
      'no-map',
      'wrong-schema',
      'unavailable',
    ];
    for (const refusal of refusals) {
      for (const units of ['metric', 'imperial'] as const) {
        const words = describeOpenWorldRefusal(refusal, units);
        expect(words.length).toBeGreaterThan(20);
        for (const number of words.match(/\d+(?:\.\d+)?/g) ?? []) {
          expect(['200', '656']).toContain(number);
        }
      }
    }
  });

  it('asks for nothing with map tiles off, and nothing with no archive', async () => {
    const { archive, calls } = await fixtureArchive();
    const start = fixtureStart(START_COLUMN, START_ROW);
    const off = createOpenWorldSession({ start, archive, mapTilesOn: () => false });
    expect(await off.ready).toStrictEqual({ kind: 'refused', refusal: 'map-tiles-off' });
    expect(calls()).toBe(0);
    const none = createOpenWorldSession({ start, archive: undefined, mapTilesOn: () => true });
    expect(await none.ready).toStrictEqual({ kind: 'refused', refusal: 'no-map' });
  });
});

/**
 * An archive whose every request waits until it is abandoned, counting the
 * requests still pending: what a host that never answers looks like.
 */
function hangingArchive(): {
  archive: CorridorArchive;
  pending: () => number;
  asked: () => number;
} {
  let pending = 0;
  let asked = 0;
  const hang = <T>(signal: AbortSignal): Promise<T> =>
    new Promise<T>((_resolve, reject) => {
      asked += 1;
      pending += 1;
      const quit = (): void => {
        pending -= 1;
        reject(new DOMException('aborted', 'AbortError'));
      };
      if (signal.aborted) quit();
      else signal.addEventListener('abort', quit, { once: true });
    });
  return {
    archive: { open: (signal) => hang(signal), tile: (_tile, signal) => hang(signal) },
    pending: () => pending,
    asked: () => asked,
  };
}

/** A `Worker` that counts what is made and what is still running. */
function countWorkers(): { made: () => number; running: () => number } {
  let made = 0;
  let running = 0;
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        made += 1;
        running += 1;
      }
      terminate(): void {
        running -= 1;
      }
    },
  );
  return { made: () => made, running: () => running };
}

/** Lets every settled promise run, with the timers faked. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

describe('the session ends with nothing left behind — #2896', () => {
  it('leaves no pending request, worker or timer when stopped during its start', async () => {
    vi.useFakeTimers();
    const workers = countWorkers();
    const host = hangingArchive();
    const session = createOpenWorldSession({
      start: fixtureStart(START_COLUMN, START_ROW),
      archive: host.archive,
      mapTilesOn: () => true,
      yieldToIdle: () => Promise.resolve(),
    });
    await flush();
    // The start is under way: the archive's header is asked for, and the
    // read's timeouts and the start's own deadline are set.
    expect(host.asked()).toBeGreaterThan(0);
    expect(host.pending()).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    session.stop();
    await flush();
    expect(await session.ready).toStrictEqual({ kind: 'stopped' });
    expect(host.pending()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(workers.running()).toBe(0);
    expect(workers.made()).toBe(0);
  });

  it('bounds a start whose every request hangs, and leaves nothing behind it', async () => {
    vi.useFakeTimers();
    const host = hangingArchive();
    const session = createOpenWorldSession({
      start: fixtureStart(START_COLUMN, START_ROW),
      archive: host.archive,
      mapTilesOn: () => true,
      yieldToIdle: () => Promise.resolve(),
    });
    await flush();
    const unanswered = Symbol('unanswered');
    await vi.advanceTimersByTimeAsync(OPEN_WORLD_START_TIMEOUT_MS - 1);
    expect(await Promise.race([session.ready, Promise.resolve(unanswered)])).toBe(unanswered);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(await Promise.race([session.ready, Promise.resolve(unanswered)])).toStrictEqual({
      kind: 'refused',
      refusal: 'unavailable',
    });
    expect(host.pending()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    session.stop();
  });

  it('leaves no timer once ready, and none after the ride ends', async () => {
    const { archive } = await fixtureArchive();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const session = createOpenWorldSession({
      start: fixtureStart(START_COLUMN, START_ROW),
      archive,
      mapTilesOn: () => true,
      yieldToIdle: () => Promise.resolve(),
    });
    expect((await session.ready).kind).toBe('ready');
    expect(vi.getTimerCount()).toBe(0);
    session.stop();
    session.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
