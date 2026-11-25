// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #3152's wiring: capture mode, switched on as the capture tool switches it on
 * — `#/game?capture=route-hud` — and ridden through the real `GameView`, the
 * real picker and the real `GameSimulation`, on the capture's own stepped
 * clock (`tools/capture/capture-clock.ts`), installed over a stand-in for the
 * window whose base clock stands at nought.
 *
 * What is read back: how many animation frames each step ran and how many
 * drew the world (what the capture tool counts the video's frames by), where
 * the ride was at frame N against a simulation of the physics advanced on the
 * same instants, and what the HUD shows. That capture mode reaches no trainer
 * and records nothing is `simulated-rider-wiring.test.tsx`'s, on its bench,
 * beside the simulated rider it is built on.
 *
 * ⚠️ The route is synthetic: a straight line north from 0° 0°.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  kilograms,
  routeProfile,
  type RoutePoint,
} from '@onyourleft/domain';

import { installCaptureClock, type CaptureClockControl } from '../../tools/capture/capture-clock';
import { captureDeviceSettings } from '../../tools/capture/capture-device';
import { riderMassFor } from '../athlete/mass';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { CAPTURE_MODE, CAPTURE_SCENES, CaptureSensors, type CaptureTarget } from './capture-scene';
import { GameView, type GamePort, type RidableRoute } from './GameView';
import type { GameRenderer } from './port';
import type { QualitySettings } from './quality';
import { DEFAULT_RIDING_POSITION, rideConditionsFor } from './rider';
import { NO_SENSORS } from './sensors';
import { GameSimulation } from './simulation';

/** Three kilometres north from 0° 0°, climbing 1 %. */
function straightRoute(): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 300; index += 1) {
    points.push({
      position: geographicPosition(degreesLatitude((index * 10) / 111_320), degreesLongitude(0)),
      elevation: altitudeMetres(index * 0.1),
    });
  }
  return { id: 'route-own', name: 'Capture loop', profile: routeProfile(points), attempts: 0 };
}

const ROUTE = straightRoute();
const SCENE = CAPTURE_SCENES['route-hud'];
const RIDER_KG = 72;
const FPS = 60;
const STEP_MS = 1000 / FPS;

function gamePort(): GamePort {
  return {
    listRoutes: () => Promise.resolve([ROUTE]),
    loadGhost: () => Promise.resolve(undefined),
    // What a rider with nothing paired reads: capture mode must replace it.
    readSensors: () => NO_SENSORS,
  };
}

function renderer(): GameRenderer {
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

/**
 * A stand-in for the window: its own animation frames, which nothing runs
 * until the clock holds them, a base clock standing at nought, and the test
 * runner's own timers, so `settle` still turns the event loop. The game's
 * `requestAnimationFrame` is the stand-in's, and its `now` the stand-in's
 * `performance.now`, both as the capture clock replaced them.
 */
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

/** What the game published for the capture tool on its last drawn frame. */
function published(): CaptureTarget['__oylCapture'] {
  return (globalThis as CaptureTarget).__oylCapture;
}

let mounted: Mounted | undefined;
let on: ReturnType<typeof stage>;

beforeEach(() => {
  on = stage();
  // The capture tool's build (`vite build --mode capture`): the only one that reads the switch.
  vi.stubEnv('MODE', CAPTURE_MODE);
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  globalThis.location.hash = '';
  delete (globalThis as CaptureTarget).__oylCapture;
});

function buttonStarting(words: string): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find((button) =>
    (button.textContent ?? '').startsWith(words),
  );
}

/** The HUD field labelled `label`, as it reads. */
function field(label: string): string | undefined {
  const found = queryAll<HTMLElement>(mounted?.container ?? document, '.oyl-hud__field').find(
    (each) => (each.querySelector('dt')?.textContent ?? '').startsWith(label),
  );
  return found?.querySelector('dd')?.textContent ?? undefined;
}

/**
 * Open the game at `hash` with the clock running, hold it, press Ride, and
 * run frames at the instant of the press until one drew the world — what
 * `render-capture.ts` does before its first counted frame.
 */
async function startCapture(hash: string, drawing: GameRenderer = renderer()): Promise<void> {
  globalThis.location.hash = hash;
  mounted = await mount(
    <GameView
      port={gamePort()}
      renderer={() => Promise.resolve(drawing)}
      now={on.now}
      riderMass={kilograms(RIDER_KG)}
    />,
  );
  await settle();
  on.clock.hold();
  await act(async () => {
    buttonStarting('Ride ')?.click();
    await Promise.resolve();
  });
  await settle();
  for (let tries = 0; tries < 20 && (published()?.drawn ?? 0) === 0; tries += 1) {
    await act(async () => {
      on.clock.frame();
      await Promise.resolve();
    });
    await settle();
  }
}

/** Step the clock once; how many animation frames it ran and how many drew the world. */
async function step(ms = STEP_MS): Promise<{ readonly ran: number; readonly drew: number }> {
  const before = published()?.drawn ?? 0;
  let ran = 0;
  await act(async () => {
    ran = on.clock.step(ms);
    await Promise.resolve();
  });
  await settle();
  return { ran, drew: (published()?.drawn ?? 0) - before };
}

/**
 * Where the physics puts a rider of {@link RIDER_KG} riding the scene's
 * script after `frames` frames of `STEP_MS` from nought: a `GameSimulation`
 * built as `GameView` builds one, advanced on the same instants with the
 * reading the script gives at each, and never told about a clock.
 */
function physicsAt(frames: number): { readonly distance: number; readonly elapsed: number } {
  const simulation = new GameSimulation({
    profile: ROUTE.profile,
    conditions: rideConditionsFor(riderMassFor(kilograms(RIDER_KG)).mass, DEFAULT_RIDING_POSITION),
  });
  const script = new CaptureSensors(SCENE ?? { id: 'none', keys: [] });
  script.start(0);
  simulation.advanceTo(0, script.read(0).rider);
  for (let frame = 1; frame <= frames; frame += 1) {
    const at = frame * STEP_MS;
    simulation.advanceTo(at, script.read(at).rider);
  }
  return { distance: simulation.state.ride.distance, elapsed: simulation.state.elapsed };
}

describe('capture mode rides on the stepped clock — #3152', () => {
  it('draws one frame per step, so the frames are seconds × fps, and the ride at frame N is the physics at N / fps s', async () => {
    await startCapture('#/game?capture=route-hud');
    expect(published()?.drawn).toBeGreaterThan(0);
    // The frames before the first counted one ran at the press: no ride yet.
    expect(published()?.distance).toBe(0);

    const seconds = 2;
    let frames = 0;
    for (let frame = 1; frame <= seconds * FPS; frame += 1) {
      const { ran, drew } = await step();
      expect({ frame, ran, drew }).toEqual({ frame, ran: 1, drew: 1 });
      frames += 1;
      if (frame === 45) {
        expect(published()?.distance).toBe(physicsAt(frame).distance);
        expect(published()?.elapsed).toBe(physicsAt(frame).elapsed);
      }
    }
    expect(frames).toBe(seconds * FPS);
    const physics = physicsAt(seconds * FPS);
    expect(physics.distance).toBeGreaterThan(2);
    expect(physics.elapsed).toBeCloseTo(seconds, 9);
    expect(published()?.distance).toBe(physics.distance);
    expect(published()?.elapsed).toBe(physics.elapsed);
  });

  it('is an ordinary ride in a release build, ?capture= or not: no script, nothing published (PR #3160)', async () => {
    vi.stubEnv('MODE', 'production');
    await startCapture('#/game?capture=route-hud');
    for (let frame = 1; frame <= 2 * FPS; frame += 1) await step();
    expect(published()).toBeUndefined();
    // The rider's own sensors, of which none is paired: no script's numbers.
    expect(field('Cadence')).not.toMatch(/\d/u);
    expect(field('Heart rate')).not.toMatch(/\d/u);
  });

  it('stands still on the stepped clock with the switch off — the control', async () => {
    await startCapture('#/game');
    for (let frame = 1; frame <= 30; frame += 1) await step();
    // An ordinary ride with nothing paired: drawn, but nothing published and nobody moving.
    expect(published()).toBeUndefined();
  });
});

describe('capture mode shows the HUD a rider sees — #3152', () => {
  it('reads the script’s power, cadence and heart rate, live', async () => {
    await startCapture('#/game?capture=route-hud');
    for (let frame = 1; frame <= 2 * FPS; frame += 1) await step();
    // Two seconds in: 188 W, 84 rpm, 123 bpm (`capture-scene.ts`).
    expect(field('Cadence')).toBe('84 rpm');
    expect(field('Heart rate')).toBe('123 bpm');
    expect(field('Power')).toMatch(/^1[78]\d W$/u);
  });

  it('carries no simulated mark, and the recorder’s figures are not dashes', async () => {
    await startCapture('#/game?capture=route-hud');
    for (let frame = 1; frame <= 3 * FPS; frame += 1) await step();
    expect(mounted?.container.querySelector('.oyl-hud__simulated')).toBeNull();
    expect(mounted?.container.textContent).not.toContain('Simulated ride');
    expect(field('Moving')).toBe('0:00:03');
    expect(field('Elapsed')).toBe('0:00:03');
    expect(field('Avg power')).toMatch(/^\d+ W$/u);
    expect(field('Calories')).toMatch(/\d/u);
    expect(field('W/kg')).toMatch(/^\d\.\d$/u);
  });

  it('marks a ?simulate= ride on the same clock, whose recorder figures stay dashes — the control', async () => {
    await startCapture('#/game?simulate=200');
    for (let frame = 1; frame <= 3 * FPS; frame += 1) await step();
    expect(mounted?.container.querySelector('.oyl-hud__simulated')).not.toBeNull();
    expect(field('Cadence')).not.toMatch(/\d/u);
    expect(field('Moving')).not.toMatch(/\d/u);
  });
});

/**
 * #3175: a renderer whose realistic world arrives when {@link arrive} is
 * called, and whose views draw it as `three-renderer.ts` §`#applyWorld` does:
 * realistic only on a realistic rung given once the world is loaded.
 */
function realisticRenderer(): {
  readonly drawing: GameRenderer;
  readonly asked: () => number;
  readonly arrive: () => void;
  readonly rungs: QualitySettings['world'][];
} {
  let loaded = false;
  let asked = 0;
  let arrive = (): void => undefined;
  const rungs: QualitySettings['world'][] = [];
  const drawing: GameRenderer = {
    loadRealisticWorld: () => {
      asked += 1;
      return new Promise((resolve) => {
        arrive = () => {
          loaded = true;
          resolve({ loaded: true });
        };
      });
    },
    create: (_canvas, settings) => {
      let drawn: QualitySettings['world'] =
        settings.world === 'realistic' && loaded ? 'realistic' : 'stylised';
      rungs.push(settings.world);
      return {
        hasContext: true,
        get drawnWorld() {
          return drawn;
        },
        prepare: () => Promise.resolve(),
        render: () => undefined,
        setQuality: (next) => {
          rungs.push(next.world);
          drawn = next.world === 'realistic' && loaded ? 'realistic' : 'stylised';
        },
        setRiderKit: () => undefined,
        setSeason: () => undefined,
        resize: () => undefined,
        destroy: () => undefined,
      };
    },
  };
  return { drawing, asked: () => asked, arrive: () => arrive(), rungs };
}

/**
 * The realistic world arrives; then warm-up frames at the same instant, as
 * `render-capture.ts` §`warmUp` runs them, while the view is prepared again
 * (#2663) and draws nothing, until one is drawn realistic.
 */
async function arriveAndWarm(arrive: () => void): Promise<void> {
  await act(async () => {
    arrive();
    await Promise.resolve();
  });
  await settle();
  for (let tries = 0; tries < 20 && published()?.world !== 'realistic'; tries += 1) {
    await act(async () => {
      on.clock.frame();
      await Promise.resolve();
    });
    await settle();
  }
}

describe('capture mode rides the realistic world the capture’s device chose — #3175', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('reads the capture tool’s settings as a rider’s: a scene with no opt-out asks for the realistic world', async () => {
    for (const { name, value } of captureDeviceSettings()) localStorage.setItem(name, value);
    const world = realisticRenderer();
    await startCapture('#/game?capture=route-hud', world.drawing);
    expect(world.asked()).toBe(1);
    // Drawn while the world arrives: the stylised one, and said to be.
    expect(published()?.world).toBe('stylised');
    await arriveAndWarm(world.arrive);
    expect(published()?.world).toBe('realistic');
    await step();
    expect(published()?.world).toBe('realistic');
  });

  it('asks for no realistic world on a fresh device — the control', async () => {
    const world = realisticRenderer();
    await startCapture('#/game?capture=route-hud', world.drawing);
    for (let frame = 1; frame <= 5; frame += 1) await step();
    expect(world.asked()).toBe(0);
    expect(published()?.world).toBe('stylised');
  });

  it('holds the realistic world’s top rung on a slow step: the ladder is not fed on a capture', async () => {
    for (const { name, value } of captureDeviceSettings()) localStorage.setItem(name, value);
    const world = realisticRenderer();
    await startCapture('#/game?capture=route-hud', world.drawing);
    await arriveAndWarm(world.arrive);
    // 5 fps: every frame 200 ms, which an ordinary ride reads as a device far too slow.
    for (let frame = 1; frame <= 150; frame += 1) {
      const { drew } = await step(200);
      expect({ frame, drew }).toEqual({ frame, drew: 1 });
      expect({ frame, world: published()?.world }).toEqual({ frame, world: 'realistic' });
    }
    expect(world.rungs.every((rung) => rung === 'realistic')).toBe(true);
  });
});
