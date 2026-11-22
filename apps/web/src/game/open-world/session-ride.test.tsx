// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2896 through the real game screen: a start handed to the tab's entry, as
 * the picker hands it, becomes a card on the game's picker; pressing *Ride*
 * on it rides the rolling route's first view; and **the rider's position is
 * read back from what the scene was handed each frame** — the profile and the
 * ride distance `sceneFrame` draws the rider from — not from the session.
 *
 * The session is the product's (`session.ts`), behind the product's lazy
 * loader (`session-lazy.ts`), over the synthetic fixture archive beside this
 * file through the product's archive reader. The only doubles are the
 * archive's bytes, the GL context behind the renderer and the animation frame.
 */

import { Blob as NodeBlob } from 'node:buffer';

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  altitudeMetres,
  distanceBetween,
  routeProfile,
  watts,
  type GeographicPosition,
  type RouteProfile,
} from '@onyourleft/domain';

import { mount, queryAll, settle, type Mounted } from '../../testing/mount';
import { countingSource, type CountingSource } from '../../world-data/archive-testing';
import { corridorArchiveFrom } from '../../world-data/corridor-source';
import { hrefForGameRoute } from '../../shell/routes';
import { endRideAnswer } from '../end-ride-testing';
import { GameView, type GamePort, type RidableRoute } from '../GameView';
import type { GameRenderer } from '../port';
import type { SceneInput } from '../scene';
import { createOpenWorldEntry, type OpenWorldEntry } from './entry';
import {
  FAR_COLUMN,
  FAR_ROW,
  fixturePosition,
  fixtureStart,
  MAIN_STREET_ROW,
  openWorldFixtureArchive,
  START_COLUMN,
  START_ROW,
} from './fixture-testing';
import { createOpenWorldSession } from './session';
import { lazyOpenWorldSessions } from './session-lazy';

const inputs: SceneInput[] = [];

vi.mock('../scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scene')>();
  return {
    ...actual,
    sceneFrame: (input: SceneInput) => {
      inputs.push(input);
      return actual.sceneFrame(input);
    },
  };
});

const FRAME_MS = 250;

let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let mounted: Mounted | undefined;

beforeEach(() => {
  inputs.length = 0;
  pending = [];
  nowMs = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  // jsdom's `Blob` has no `stream()`, which the fixture archive's gzip and the
  // reader's gunzip use; Node's is the honest stand-in, as in
  // `world-data/corridor-wiring.test.tsx`.
  vi.stubGlobal('Blob', NodeBlob);
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
});

async function pump(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const next = pending.shift();
    if (next === undefined) return;
    nowMs += FRAME_MS;
    await act(async () => {
      next(nowMs);
      await Promise.resolve();
    });
  }
}

function capturingRenderer(): GameRenderer {
  return {
    loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
    create: () => ({
      hasContext: true,
      prepare: () => Promise.resolve(),
      render: () => undefined,
      setQuality: () => undefined,
      setRiderKit: () => undefined,
      setSeason: () => undefined,
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };
}

/** The game port with no saved route and the product's open-world sessions over `source`. */
function openWorldPort(entry: OpenWorldEntry, source: CountingSource): GamePort {
  return {
    listRoutes: () => Promise.resolve([]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(300), live: true, paired: true },
      cadence: { value: 90, live: true, paired: true },
      heartRate: { value: 140, live: true, paired: true },
    }),
    openWorld: lazyOpenWorldSessions(
      {
        entry,
        basemap: () => ({ archiveUrl: 'https://tiles.example.invalid/a.pmtiles', attribution: '' }),
        mapTilesOn: () => true,
      },
      () =>
        Promise.resolve((start) =>
          createOpenWorldSession({
            start,
            archive: corridorArchiveFrom(source),
            mapTilesOn: () => true,
            yieldToIdle: () => Promise.resolve(),
          }),
        ),
    ),
  };
}

const text = (): string => mounted?.container.textContent ?? '';

async function until(condition: () => boolean, tries = 400): Promise<void> {
  for (let i = 0; i < tries && !condition(); i++) await settle();
  expect(condition()).toBe(true);
}

function rideButton(): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find((button) =>
    (button.textContent ?? '').startsWith('Ride '),
  );
}

/** The position `distance` metres along `profile`, between its samples, as the scene places the rider. */
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

describe('an open-world ride through the game screen — #2896', () => {
  it('starts from the handed start, rides 500 m, and the scene puts the rider 500 m along Main street', async () => {
    const source = countingSource(await openWorldFixtureArchive());
    const entry = createOpenWorldEntry();
    entry.hand(fixtureStart(START_COLUMN, START_ROW));
    mounted = await mount(
      <GameView
        port={openWorldPort(entry, source)}
        renderer={() => Promise.resolve(capturingRenderer())}
        now={() => nowMs}
      />,
    );
    // The start was taken once: a second screen would not ride it unasked.
    expect(entry.take()).toBeUndefined();
    await until(() => rideButton()?.textContent === 'Ride Open world');
    expect(source.calls.length).toBeGreaterThan(0);
    await act(async () => {
      rideButton()?.click();
      await Promise.resolve();
    });
    await settle();
    for (let frames = 0; frames < 800; frames += 1) {
      const last = inputs[inputs.length - 1];
      if (last !== undefined && last.state.ride.distance >= 500) break;
      await pump(1);
    }
    const last = inputs[inputs.length - 1] as SceneInput;
    const ridden = last.state.ride.distance;
    expect(ridden).toBeGreaterThanOrEqual(500);
    // The profile the scene was handed is the open-world ride's, starting at
    // the start snapped onto Main street.
    const snapped = fixturePosition(START_COLUMN, MAIN_STREET_ROW);
    expect(distanceBetween(last.profile.positions[0] as GeographicPosition, snapped)).toBeLessThan(
      0.5,
    );
    // And the rider is `ridden` metres east of it along Main street: the
    // fixture's own geometry, worked out here, not read from the session.
    const expected = {
      latitude: snapped.latitude,
      longitude:
        snapped.longitude + ridden / (111_320 * Math.cos((snapped.latitude * Math.PI) / 180)),
    } as GeographicPosition;
    expect(distanceBetween(positionAlong(last.profile, ridden), expected)).toBeLessThan(2);
  });

  it('keeps the session through the ride and stops it when the ride ends', async () => {
    const source = countingSource(await openWorldFixtureArchive());
    const entry = createOpenWorldEntry();
    entry.hand(fixtureStart(START_COLUMN, START_ROW));
    let stops = 0;
    const port: GamePort = {
      ...openWorldPort(entry, source),
      openWorld: lazyOpenWorldSessions(
        { entry, basemap: () => undefined, mapTilesOn: () => true },
        () =>
          Promise.resolve((start) => {
            const inner = createOpenWorldSession({
              start,
              archive: corridorArchiveFrom(source),
              mapTilesOn: () => true,
              yieldToIdle: () => Promise.resolve(),
            });
            return {
              ready: inner.ready,
              stop: () => {
                stops += 1;
                inner.stop();
              },
            };
          }),
      ),
    };
    mounted = await mount(
      <GameView
        port={port}
        renderer={() => Promise.resolve(capturingRenderer())}
        now={() => nowMs}
      />,
    );
    await until(() => rideButton()?.textContent === 'Ride Open world');
    await act(async () => {
      rideButton()?.click();
      await Promise.resolve();
    });
    await settle();
    await pump(40);
    expect(inputs.length).toBeGreaterThan(0);
    expect(stops).toBe(0);
    await act(async () => {
      queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button')
        .find((button) => (button.textContent ?? '').trim() === 'End ride')
        ?.click();
      await Promise.resolve();
    });
    await settle();
    await act(async () => {
      endRideAnswer(document, 'End ride').click();
      await Promise.resolve();
    });
    await settle();
    // Back on the picker, the screen still open: the ride's end stopped it.
    expect(rideButton()).toBeDefined();
    expect(stops).toBeGreaterThan(0);
  });

  it('chooses the open-world card once read, over a saved route the address named', async () => {
    const source = countingSource(await openWorldFixtureArchive());
    const entry = createOpenWorldEntry();
    entry.hand(fixtureStart(START_COLUMN, START_ROW));
    const saved: RidableRoute = {
      id: 'saved-route',
      name: 'Saved loop',
      profile: routeProfile(
        [fixturePosition(0, 0), fixturePosition(2000, 0), fixturePosition(2000, 2000)].map(
          (position) => ({ position, elevation: altitudeMetres(0) }),
        ),
      ),
      attempts: 0,
    };
    // ADR 0090 D-1: the open-world card is never read as a route's corridor.
    const corridorsAsked: string[] = [];
    const before = globalThis.location.hash;
    globalThis.location.hash = hrefForGameRoute(saved.id);
    try {
      mounted = await mount(
        <GameView
          port={{
            ...openWorldPort(entry, source),
            listRoutes: () => Promise.resolve([saved]),
            loadWorldCorridor: (route) => {
              corridorsAsked.push(route.id);
              return Promise.resolve({ kind: 'unavailable', why: 'refused' });
            },
          }}
          renderer={() => Promise.resolve(capturingRenderer())}
          now={() => nowMs}
        />,
      );
      await until(() => rideButton()?.textContent === 'Ride Open world');
      await settle();
      expect(corridorsAsked).toContain(saved.id);
      expect(corridorsAsked).not.toContain('open-world');
    } finally {
      globalThis.location.hash = before;
    }
  });

  it('says a start with no street near it, naming no place, and offers no card', async () => {
    const source = countingSource(await openWorldFixtureArchive());
    const entry = createOpenWorldEntry();
    const start = fixtureStart(FAR_COLUMN, FAR_ROW);
    entry.hand(start);
    mounted = await mount(
      <GameView
        port={openWorldPort(entry, source)}
        renderer={() => Promise.resolve(capturingRenderer())}
        now={() => nowMs}
      />,
    );
    const said = (): string =>
      queryAll(mounted?.container ?? document, '[role="status"]')
        .map((node) => node.textContent ?? '')
        .join(' ');
    await until(() => said().includes('no street'));
    const alert = said();
    expect(alert).toContain('no street a bike can ride within 200 m');
    for (const digits of [1, 2, 3, 4, 5, 6]) {
      expect(alert).not.toContain(start.position.latitude.toFixed(digits));
      expect(alert).not.toContain(start.position.longitude.toFixed(digits));
    }
    expect(text()).not.toContain('Open world');
  });

  it('opens nothing when no start was handed over', async () => {
    const source = countingSource(await openWorldFixtureArchive());
    mounted = await mount(
      <GameView
        port={openWorldPort(createOpenWorldEntry(), source)}
        renderer={() => Promise.resolve(capturingRenderer())}
        now={() => nowMs}
      />,
    );
    await settle();
    await settle();
    expect(source.calls).toHaveLength(0);
    expect(text()).not.toContain('open-world start');
  });

  it('stops the session when the screen is left mid-read: no request is left pending', async () => {
    let pendingRequests = 0;
    const entry = createOpenWorldEntry();
    entry.hand(fixtureStart(START_COLUMN, START_ROW));
    const port: GamePort = {
      ...openWorldPort(entry, countingSource(new Uint8Array(0))),
      openWorld: lazyOpenWorldSessions(
        { entry, basemap: () => undefined, mapTilesOn: () => true },
        () =>
          Promise.resolve((start) =>
            createOpenWorldSession({
              start,
              mapTilesOn: () => true,
              archive: {
                open: (signal) =>
                  new Promise((_resolve, reject) => {
                    pendingRequests += 1;
                    signal.addEventListener(
                      'abort',
                      () => {
                        pendingRequests -= 1;
                        reject(new DOMException('aborted', 'AbortError'));
                      },
                      { once: true },
                    );
                  }),
                tile: () => Promise.resolve(undefined),
              },
            }),
          ),
      ),
    };
    mounted = await mount(
      <GameView
        port={port}
        renderer={() => Promise.resolve(capturingRenderer())}
        now={() => nowMs}
      />,
    );
    await until(() => pendingRequests > 0);
    expect(text()).toContain('Reading the map round your open-world start');
    mounted.unmount();
    mounted = undefined;
    await settle();
    expect(pendingRequests).toBe(0);
  });
});
