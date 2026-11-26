// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #3153's wiring: capture mode's scenes for Delivery, the lap race, a workout
 * and the pacer, each opened as the capture tool opens it
 * (`tools/capture/capture-args.ts` §`captureHash`) and ridden through the real
 * `GameView` on the capture's stepped clock (`tools/capture/capture-clock.ts`),
 * with the app's own built-in levels and circuits behind the port, as
 * `main.tsx` builds it.
 *
 * What is read back: the HUD each scene is for, in the DOM; the event log the
 * page publishes for the capture tool (`window.__oylCapture.events`), from
 * two captures of one scene; what the device's storage holds afterwards; and
 * what the port was asked. That a capture reaches no trainer and records
 * nothing is `simulated-rider-wiring.test.tsx`'s.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { kilograms } from '@onyourleft/domain';

import { installCaptureClock, type CaptureClockControl } from '../../tools/capture/capture-clock';
import { captureHash, captureRideName } from '../../tools/capture/capture-args';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import {
  CAPTURE_MODE,
  CAPTURE_SCENES,
  type CaptureEvent,
  type CaptureTarget,
} from './capture-scene';
import { loadBuiltInCircuits } from './circuits/circuits';
import { DELIVERY_PROGRESS_STORAGE_KEY } from './delivery/delivery-progress';
import { LEVEL_PROGRESS_STORAGE_KEY } from './delivery/level-progress';
import { GameView, type GamePort, type RidableRoute } from './GameView';
import type { GameRenderer } from './port';
import { circuitRoute, northRoute } from './route-fixtures-testing';
import { NO_SENSORS } from './sensors';
import { SHIPPED_LEVELS } from './shipped-levels';

/** The capture tool's own synthetic route stands in as a straight 3 km road. */
const OWN: RidableRoute = {
  id: 'route-own',
  name: captureRideName('workout'),
  profile: northRoute(3_000, () => 0),
  attempts: 1,
};
/** Four frames a second: the capture's `--fps 4`, so a scene's seconds are few steps. */
const STEP_MS = 250;

let asked: string[] = [];
/** What the port was asked to keep as a best lap, as `[route, lap]` — #2319. */
let keptLaps: [string, number][] = [];
/** The routes the port lists: the capture tool's own, unless a test rides a loop. */
let own: RidableRoute = OWN;
/** The built-in circuits the port lists: the shipped ones, unless a test rides a shorter one. */
let circuits: () => Promise<readonly RidableRoute[]> = () => loadBuiltInCircuits();

/**
 * Every read the port has started in the running case. The circuits and the
 * levels are `import.meta.glob` loaders, and in Vitest each `import()` is a
 * round trip to the main process that a loaded CI runner under coverage may
 * not answer inside forty event-loop turns: the first case then found no
 * *Ride Morning Round* (#3206, the shape `testing/mount.tsx` §`readsSettled`
 * names for #1939). {@link arrived} waits for the reads themselves instead.
 */
let reads: Promise<unknown>[] = [];

function read<T>(started: Promise<T>): Promise<T> {
  reads.push(started);
  return started;
}

/**
 * Let every read the port has started resolve, however long that takes, then
 * let React render what each resolved to. A read that starts another (the
 * listing, then the level it names) is waited for on the next call.
 */
async function arrived(): Promise<void> {
  await act(async () => {
    await Promise.allSettled(reads);
  });
  await settle();
}

function gamePort(): GamePort {
  return {
    listRoutes: () => read(Promise.resolve([own])),
    listCircuits: () => read(circuits()),
    listDeliveryLevels: () => read(Promise.resolve(SHIPPED_LEVELS.list())),
    loadDeliveryLevel: (id) => read(SHIPPED_LEVELS.load(id)),
    // The rider's own data: a capture must ask for none of it.
    loadGhost: (routeId) => {
      asked.push(`loadGhost:${routeId}`);
      return Promise.resolve(undefined);
    },
    loadRiderGhost: (routeId) => {
      asked.push(`loadRiderGhost:${routeId}`);
      return Promise.resolve({ kind: 'unavailable' });
    },
    readSensors: () => NO_SENSORS,
    recordBestLap: (route, lap) => {
      keptLaps.push([route, lap]);
      return Promise.resolve();
    },
  };
}

function renderer(): GameRenderer {
  return {
    loadRealisticWorld: () => Promise.resolve({ loaded: true }),
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

/** A stand-in window on the capture clock, as `capture-wiring.test.tsx`'s. */
function stage(): { readonly clock: CaptureClockControl; readonly now: () => number } {
  let nextFrame = 0;
  const target = {
    performance: { now: () => 0 },
    Date,
    requestAnimationFrame: (): number => {
      nextFrame += 1;
      return nextFrame;
    },
    cancelAnimationFrame: () => undefined,
    setTimeout: (handler: unknown, timeout?: number) =>
      setTimeout(handler as () => void, timeout) as unknown as number,
    clearTimeout: (handle?: number) => {
      clearTimeout(handle);
    },
    setInterval: (handler: unknown, timeout?: number) =>
      setInterval(handler as () => void, timeout) as unknown as number,
    clearInterval: (handle?: number) => {
      clearInterval(handle);
    },
  };
  const clock = installCaptureClock(target);
  vi.stubGlobal('requestAnimationFrame', target.requestAnimationFrame);
  vi.stubGlobal('cancelAnimationFrame', target.cancelAnimationFrame);
  return { clock, now: () => target.performance.now() };
}

function published(): CaptureTarget['__oylCapture'] {
  return (globalThis as CaptureTarget).__oylCapture;
}

let mounted: Mounted | undefined;

/**
 * The case that is running: aborted once it ends, so a case that timed out
 * stops stepping its capture instead of riding on, in the background, into
 * the next case's mount and globals. Checked after every await in a capture.
 */
let running = new AbortController();
/**
 * The captures the running case started, until each has stopped. A case that
 * timed out leaves one inside `act()`; React would queue the next case's
 * renders into that scope and never draw them, so `afterEach` waits for it.
 */
let inFlight: Promise<unknown>[] = [];

/** Run `body` as one of the running case's captures, for `afterEach` to wait on. */
function tracked<T>(body: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const run = body(running.signal);
  inFlight.push(run.catch(() => undefined));
  return run;
}

/** Stop here if the case this capture belongs to has ended. */
function stillRunning(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('the case this capture belongs to has ended');
}

/** What a rider's device already holds: a week part-way through, and level 1 finished. */
const WEEK = JSON.stringify({ day: 4, houses: 9, score: 11 });
const LEVELS = JSON.stringify({ finished: ['morning-round'] });
const NO_LEVELS = JSON.stringify({ finished: [] });

beforeEach(() => {
  running = new AbortController();
  asked = [];
  keptLaps = [];
  reads = [];
  own = OWN;
  circuits = () => loadBuiltInCircuits();
  localStorage.clear();
  localStorage.setItem(DELIVERY_PROGRESS_STORAGE_KEY, WEEK);
  localStorage.setItem(LEVEL_PROGRESS_STORAGE_KEY, LEVELS);
  vi.stubEnv('MODE', CAPTURE_MODE);
});

afterEach(async () => {
  running.abort();
  await Promise.all(inFlight);
  inFlight = [];
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  localStorage.clear();
  globalThis.location.hash = '';
  delete (globalThis as CaptureTarget).__oylCapture;
});

function text(): string {
  return mounted?.container.textContent ?? '';
}

/** The HUD field labelled `label`, as it reads. */
function field(label: string): string | undefined {
  const found = queryAll<HTMLElement>(mounted?.container ?? document, '.oyl-hud__field').find(
    (each) => (each.querySelector('dt')?.textContent ?? '').startsWith(label),
  );
  return found?.querySelector('dd')?.textContent ?? undefined;
}

/**
 * Capture `scene` for `steps` frames as the capture tool does: open its
 * fragment, hold the clock, press its route's *Ride*, run frames at the
 * instant of the press until one drew the world, then step. Every step must
 * run one animation frame and draw the world once, or the capture tool stops.
 * `onFrame` returning `true` ends the capture at that frame.
 */
function capture(
  scene: string,
  steps: number,
  onFrame?: (frame: number) => boolean | void,
): Promise<readonly CaptureEvent[]> {
  return tracked((signal) => captureFor(signal, scene, steps, onFrame));
}

async function captureFor(
  signal: AbortSignal,
  scene: string,
  steps: number,
  onFrame?: (frame: number) => boolean | void,
): Promise<readonly CaptureEvent[]> {
  const on = stage();
  globalThis.location.hash = captureHash(scene);
  mounted = await mount(
    <GameView
      port={gamePort()}
      renderer={() => Promise.resolve(renderer())}
      now={on.now}
      riderMass={kilograms(72)}
    />,
  );
  const ride = `Ride ${captureRideName(scene)}`;
  for (let tries = 0; tries < 40; tries += 1) {
    if (rideButton(ride) !== undefined) break;
    await arrived();
    stillRunning(signal);
  }
  expect(rideButton(ride), ride).toBeDefined();
  on.clock.hold();
  await act(async () => {
    rideButton(ride)?.click();
    await Promise.resolve();
  });
  await settle();
  for (let tries = 0; tries < 40 && (published()?.drawn ?? 0) === 0; tries += 1) {
    await act(async () => {
      on.clock.frame();
      await Promise.resolve();
    });
    await arrived();
    stillRunning(signal);
  }
  expect(published()?.drawn).toBe(1);
  for (let frame = 1; frame <= steps; frame += 1) {
    const before = published()?.drawn ?? 0;
    let ran = 0;
    await act(async () => {
      ran = on.clock.step(STEP_MS);
      await Promise.resolve();
    });
    await settle();
    stillRunning(signal);
    expect([ran, (published()?.drawn ?? 0) - before]).toEqual([1, 1]);
    if (onFrame?.(frame) === true) break;
  }
  return published()?.events ?? [];
}

function rideButton(name: string): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find(
    (button) => button.textContent === name,
  );
}

/** Unmount, and stand everything a capture stubs back up, for a second capture. */
function again(): void {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  delete (globalThis as CaptureTarget).__oylCapture;
}

describe('a Delivery scene — #3153', () => {
  it('rides the first built-in level from the scene’s seed, with the round’s HUD, throwing as a house comes into reach', async () => {
    const events = await capture('delivery', 80);
    expect(field('Houses')).toBeDefined();
    expect(field('Next house')).toBeDefined();
    expect(field('Score')).toBeDefined();
    expect(mounted?.container.querySelector('.oyl-hud__throws')).not.toBeNull();
    const round = events.find((event) => event.kind === 'round');
    expect(round).toMatchObject({ frame: 0, seed: CAPTURE_SCENES['delivery']?.seed });
    expect(events.filter((event) => event.kind === 'cue' && event.cue === 'throw')).not.toEqual([]);
    // Aimed as a rider aims: the first house delivered, on the frame it lands.
    expect(events.filter((event) => event.kind === 'score')).toEqual([
      { kind: 'score', score: 1, frame: 68 },
    ]);
    expect(field('Houses')).toMatch(/1\sdelivered/u);
  });

  it('reads none of the rider’s week or levels, and writes none (no rider data in a capture)', async () => {
    // The rider's device is on day 4 of a week and has finished no level; the
    // round is ridden to its end, where a round writes both. Its last house is
    // settled some 260 frames in: the capture stops a few frames after the HUD
    // reads none left, rather than riding on to a fixed count.
    localStorage.setItem(LEVEL_PROGRESS_STORAGE_KEY, NO_LEVELS);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    let ended: number | undefined;
    const events = await capture('delivery', 400, (frame) => {
      if (ended === undefined && /^0\sleft/u.test(field('Houses') ?? '')) ended = frame;
      return ended !== undefined && frame >= ended + 8;
    });
    expect(ended, 'the round reached its end').toBeDefined();
    expect(events.filter((event) => event.kind === 'score').length).toBeGreaterThan(0);
    // Not the rider's week, nor their levels: written to none of them. (The
    // frame-time report is not rider data, and is not this test's.)
    expect(
      setItem.mock.calls
        .map(([key]) => key)
        .filter(
          (key) => key === DELIVERY_PROGRESS_STORAGE_KEY || key === LEVEL_PROGRESS_STORAGE_KEY,
        ),
    ).toEqual([]);
    // The round's HUD is the capture's own empty week's, not the device's day 4.
    expect(field('Score')).not.toContain('Day 4');
    expect(localStorage.getItem(DELIVERY_PROGRESS_STORAGE_KEY)).toBe(WEEK);
    expect(localStorage.getItem(LEVEL_PROGRESS_STORAGE_KEY)).toBe(NO_LEVELS);
    expect(asked).toEqual([]);
  });
});

describe('a lap race scene — #3153', () => {
  it('races a built-in circuit against the scene’s seeded field, no instance, with the race’s HUD', async () => {
    const events = await capture('lap-race', 80);
    expect(mounted?.container.querySelector('.oyl-hud__standings')).not.toBeNull();
    expect(mounted?.container.querySelector('.oyl-hud__item')).not.toBeNull();
    const race = events.find((event) => event.kind === 'race');
    expect(race).toMatchObject({ frame: 0, seed: CAPTURE_SCENES['lap-race']?.seed });
    expect(race?.kind === 'race' ? race.field : []).toHaveLength(5);
    // Its first pick-up is a quarter of the way round, minutes in: no item yet, so none used.
    expect(events.filter((event) => event.kind === 'cue')).toEqual([]);
    expect(asked).toEqual([]);
  });
});

describe('a lap race scene on a saved loop keeps no best lap — #2319', () => {
  const SAVED = 'saved-loop-lap-race';

  afterEach(() => {
    delete (CAPTURE_SCENES as Record<string, unknown>)[SAVED];
  });

  it('states its laps in memory only: the port is asked to keep none', async () => {
    // The scene's race on the capture tool's own route, here a 377 m loop the
    // port lists as a rider's saved one, started 20 m short of its line.
    const lapRace = CAPTURE_SCENES['lap-race'];
    (CAPTURE_SCENES as Record<string, unknown>)[SAVED] = {
      ...lapRace,
      route: undefined,
      startMetres: 357,
    };
    own = { ...OWN, profile: circuitRoute(60, () => 0) };
    const events = await capture(SAVED, 120);
    // The control: the capture did cross the line as a lap, so a kept lap
    // would have been offered.
    expect(events.some((event) => event.kind === 'lap')).toBe(true);
    expect(keptLaps).toEqual([]);
  });
});

describe('a lap race scene’s item — #3153', () => {
  it('is used once the rider holds one from a pick-up, as a rider uses it', async () => {
    // The scene's race, on a 377 m loop under the circuit's id: its first
    // pick-up a quarter of the way round, seconds after Go. Level since #3198
    // put the scene at the bots' 2.8 W/kg, which the fixture's own 8 m rise to
    // that quarter would hold to a walking pace.
    circuits = () =>
      Promise.resolve([
        {
          id: 'circuit:bellwether',
          name: 'Bellwether Loop',
          profile: circuitRoute(60, () => 0),
          attempts: 0,
        },
      ]);
    const held: boolean[] = [];
    const events = await capture('lap-race', 160, () => {
      held.push(mounted?.container.querySelector('.oyl-hud__item [aria-disabled="true"]') === null);
    });
    const used = events.filter((event) => event.kind === 'cue');
    // Both of the scene's cues, each once the rider holds an item: on the
    // level loop the second pick-up comes inside the capture too (#3198).
    expect(used.map((event) => event.kind === 'cue' && event.taken)).toEqual([true, true]);
    const first = used[0]?.frame ?? 0;
    // Held after the frame before the use, and gone after the frame that used it.
    expect(first).toBeGreaterThan(1);
    expect(held[first - 2]).toBe(true);
    expect(held[first - 1]).toBe(false);
  });
});

describe('a workout scene — #3153', () => {
  it('rides the tailored built-in in the game: the workout strip, its target held as the power, a block change in frame', async () => {
    const events = await capture('workout', 60);
    expect(mounted?.container.querySelector('.oyl-workout-strip')).not.toBeNull();
    expect(events.filter((event) => event.kind === 'block')).toEqual([
      { kind: 'block', block: 1, frame: 40 },
    ]);
    // Sweet spot at 5 % harder, of 250 W: what the trainer holds is what is read.
    expect(field('Power')).toMatch(/^2[34]\d/u);
    expect(asked).toEqual([]);
  });
});

describe('a pacer scene — #3153', () => {
  it('rides beside the pacer and races a bundled synthetic best, never the rider’s own', async () => {
    await capture('pacer', 40);
    expect(field('Pacer')).toBeDefined();
    expect(text()).toMatch(/best/iu);
    // The route has an attempt; a capture asks the store for none of it.
    expect(asked).toEqual([]);
  });
});

describe('a capture over a course’s line — #3153, the review of PR #3160', () => {
  it('ends a lap there: the lap panel has it, and *Lap* counts from the line, not from the start', async () => {
    // A 157 m loop under the synthetic route's name: a line every 20 s or so.
    own = { ...OWN, profile: circuitRoute(25) };
    const events = await capture('route-hud', 112);
    const laps = events.filter((event) => event.kind === 'lap');
    expect(laps.map((event) => event.kind === 'lap' && event.lap)).toEqual([1]);
    const rows = queryAll(mounted?.container ?? document, '.oyl-hud__laps-row').map(
      (row) => row.textContent,
    );
    // Lap 1 ended on the line at 25 s; lap 2 is three seconds old, not 28.
    expect(rows.slice(0, 2)).toEqual([
      'Now Lap 2 Time 0:03 Avg power —',
      'Last Lap 1 Time 0:25 Avg power 263 W',
    ]);
    expect(field('Elapsed')).toBe('0:00:28');
  });
});

describe('a scene renders the same twice — #3153', () => {
  it.each(['delivery', 'lap-race', 'workout'])(
    '%s: the same seed and the same events at the same frames, from the event log',
    async (scene) => {
      const first = await capture(scene, 80);
      again();
      const second = await capture(scene, 80);
      expect(first).not.toEqual([]);
      expect(second).toEqual(first);
    },
  );
});

describe('every other ride draws its own seed — #3153', () => {
  /** The draws of one 32-bit seed: `drawRoundSeed`'s and `drawRaceSeed`'s shape. */
  let seedDraws = 0;
  beforeEach(() => {
    seedDraws = 0;
    const real = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
      <T extends ArrayBufferView>(array: T): T => {
        if (array instanceof Uint32Array && array.length === 1) seedDraws += 1;
        return real(array as unknown as Uint8Array<ArrayBuffer>) as unknown as T;
      },
    );
  });

  /** Open `hash`, press `ride`, and run `steps` frames on the stand-in clock. */
  function ride(hash: string, name: string, steps: number): Promise<void> {
    return tracked((signal) => rideFor(signal, hash, name, steps));
  }

  async function rideFor(
    signal: AbortSignal,
    hash: string,
    name: string,
    steps: number,
  ): Promise<void> {
    const on = stage();
    globalThis.location.hash = hash;
    mounted = await mount(
      <GameView
        port={gamePort()}
        renderer={() => Promise.resolve(renderer())}
        now={on.now}
        riderMass={kilograms(72)}
      />,
    );
    for (let tries = 0; tries < 40 && rideButton(name) === undefined; tries += 1) {
      await arrived();
      stillRunning(signal);
    }
    on.clock.hold();
    await act(async () => {
      rideButton(name)?.click();
      await Promise.resolve();
    });
    await settle();
    for (let frame = 0; frame < steps; frame += 1) {
      await act(async () => {
        on.clock.step(STEP_MS);
        await Promise.resolve();
      });
      await settle();
      stillRunning(signal);
    }
  }

  it.each([
    ['delivery', 'a release build, ?capture= and all'],
    ['lap-race', 'a release build, ?capture= and all'],
  ])('%s, in %s: an ordinary ride whose seed is drawn from crypto', async (scene) => {
    vi.stubEnv('MODE', 'production');
    await ride(captureHash(scene), `Ride ${captureRideName(scene)}`, 8);
    expect(published()).toBeUndefined();
    // The round's HUD, or the race's: the mode is ridden, from a drawn seed.
    expect(
      mounted?.container.querySelector(
        scene === 'delivery' ? '.oyl-hud__throws' : '.oyl-hud__standings',
      ),
    ).not.toBeNull();
    expect(seedDraws).toBe(1);
  });

  it.each(['delivery', 'lap-race'])(
    '%s, in the capture build with no ?capture=: drawn from crypto too',
    async (scene) => {
      const hash = captureHash(scene).replace(/[?&]capture=[^&]*$/u, '');
      await ride(hash, `Ride ${captureRideName(scene)}`, 8);
      expect(published()).toBeUndefined();
      expect(seedDraws).toBe(1);
    },
  );

  it('and a capture draws none', async () => {
    await capture('delivery', 4);
    again();
    await capture('lap-race', 4);
    expect(seedDraws).toBe(0);
  });
});
