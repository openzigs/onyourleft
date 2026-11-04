// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #1992's wiring: the simulated rider, switched on as a developer switches it
 * on — `#/game?simulate=…` — and ridden through the real `GameView`, the real
 * picker, the real `GameSimulation` and the real scene. What is read back is
 * where the rider was drawn, what world was drawn around them, what the HUD
 * says, what a **trainer** was handed, what the **store** kept and what a
 * **room** was asked.
 *
 * Built in the style of `trainer-wiring.test.tsx` (#362): the only doubles
 * are the store behind `GamePort`, the GL context and the clock, and the last
 * block rides a real ride controller against the #44 simulator's FTMS
 * machine, with a real store and a scripted room underneath.
 *
 * ⚠️ Every route here is synthetic: a straight line north from 0° 0°.
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
  seconds,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';
import type { SimulationParameters } from '@onyourleft/sensors/protocol';
import { createSimulator, ftmsTrainer } from '@onyourleft/sensors/simulator';
import { activityId, lapId, recordingSessionId } from '@onyourleft/store';
import { ATHLETE_A, createStoreHarness, seedAthletes } from '@onyourleft/store/testing';

import { riderMassFor } from '../athlete/mass';
import { roomPortOver } from '../net/room-port';
import type { RoomsPort } from '../net/rooms-port';
import { ManualClock, ScriptedRoom } from '../net/testing';
import { createRideController } from '../ride/controller';
import { simulatedOpenTrainer } from '../ride/simulated-trainer-testing';
import { mount, queryAll, settle, typeInto, type Mounted } from '../testing/mount';

import { GameView, type GamePort, type RidableRoute } from './GameView';
import { HOUSES_NOT_READY_TEXT } from './hud/delivery-announce';
import type { GameRenderer, SceneFrame } from './port';
import { DEFAULT_RIDING_POSITION, rideConditionsFor } from './rider';
import { NO_SENSORS, type GameSensors } from './sensors';
import { GameSimulation } from './simulation';
import { simulatedRideText, type PreviewSpeedup } from './simulated-rider';
import { gameTrainerPortOver, type GameTrainerPort, type GradientTrainer } from './trainer-port';

/**
 * Every frame `sceneFrame` built, with where it drew the rider — the real
 * scene, recorded, so a case reads the world a ride was given at a known
 * place rather than inferring the place from the picture.
 */
const built = vi.hoisted(
  (): { readonly distance: number; readonly odometer: number; readonly frame: unknown }[] => [],
);
vi.mock('./scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./scene')>();
  return {
    ...actual,
    sceneFrame: (...args: Parameters<typeof actual.sceneFrame>) => {
      const frame = actual.sceneFrame(...args);
      built.push({
        distance: actual.drawnRiderDistance(args[0]),
        odometer: args[0].state.ride.distance,
        frame,
      });
      return frame;
    },
  };
});

/** Three kilometres north from 0° 0°, climbing 1 % — straight, so no bend eases the rider. */
function straightRoute(): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 300; index += 1) {
    points.push({
      position: geographicPosition(degreesLatitude((index * 10) / 111_320), degreesLongitude(0)),
      elevation: altitudeMetres(index * 0.1),
    });
  }
  return { id: 'route-own', name: 'My imported route', profile: routeProfile(points), attempts: 0 };
}

const ROUTE = straightRoute();
const POWER = 250;

/** The rider's saved routes, and the given sensors — none at all, by default. */
function gamePort(sensors: GameSensors = NO_SENSORS): GamePort {
  return {
    listRoutes: () => Promise.resolve([ROUTE]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => sensors,
  };
}

/** A rider on a real power meter at {@link POWER} — the real ride a simulated one is held to. */
const PEDALLING: GameSensors = {
  rider: { power: watts(POWER), live: true, paired: true },
  cadence: { value: 88, live: true, paired: true },
  heartRate: { value: 142, live: true, paired: true },
};

function capturingRenderer(frames: SceneFrame[]): GameRenderer {
  return {
    loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
    create: () => ({
      hasContext: true,
      prepare: () => Promise.resolve(),
      render: (frame: SceneFrame) => {
        frames.push(frame);
      },
      setQuality: () => undefined,
      setRiderKit: () => undefined,
      setSeason: () => undefined,
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };
}

/** Everything a trainer was told. */
interface Commands {
  readonly written: SimulationParameters[];
  readonly releases: number[];
  readonly requests: number[];
}

/**
 * A paired, controllable trainer that would take a gradient — through the
 * real `gameTrainerPortOver`, as `trainer-wiring.test.tsx` builds one — that
 * has NOT yet been given control, so a ride that reached it would ask.
 */
function readyTrainer(commands: Commands): GameTrainerPort {
  const facts = { paired: true, controllable: true, canSimulate: true, hasControl: false };
  const control: GradientTrainer = {
    setSimulationParameters: async (parameters) => {
      commands.written.push(parameters);
      return Promise.resolve();
    },
    letGo: async () => {
      commands.releases.push(commands.written.length);
      return Promise.resolve({ kind: 'stopped' as const });
    },
  };
  return gameTrainerPortOver({
    getSnapshot: () => ({ trainer: facts, workout: undefined }),
    simulationControl: () => control,
    requestTrainerControl: async () => {
      commands.requests.push(commands.written.length);
      facts.hasControl = true;
      return Promise.resolve();
    },
    noteGameRideEnded: () => undefined,
    subscribe: () => () => undefined,
  });
}

let pending: FrameRequestCallback[] = [];
const START_MS = 1_000_000;
let nowMs = START_MS;
let mounted: Mounted | undefined;

beforeEach(() => {
  pending = [];
  nowMs = START_MS;
  built.length = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  globalThis.location.hash = '';
});

async function clickThrough(element: HTMLElement | undefined): Promise<void> {
  expect(element).toBeDefined();
  await act(async () => {
    element?.click();
    await Promise.resolve();
  });
  await settle();
}

function buttonStarting(words: string): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find((button) =>
    (button.textContent ?? '').startsWith(words),
  );
}

const FRAME_MS = 500;

async function pump(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const next = pending.shift();
    if (next === undefined) {
      return;
    }
    nowMs += FRAME_MS;
    await act(async () => {
      next(nowMs);
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

/** Open the game at `hash`, press Ride on the rider's route, and ride `frames` frames. */
async function ride(
  hash: string,
  options: {
    readonly port?: GamePort;
    readonly trainer?: GameTrainerPort;
    readonly frames?: number;
  } = {},
): Promise<void> {
  globalThis.location.hash = hash;
  mounted = await mount(
    <GameView
      port={options.port ?? gamePort()}
      {...(options.trainer === undefined ? {} : { trainer: options.trainer })}
      renderer={() => Promise.resolve(capturingRenderer([]))}
      now={() => nowMs}
    />,
  );
  await settle();
  await clickThrough(buttonStarting('Ride '));
  await pump(options.frames ?? 20);
  await settle();
}

/**
 * On the picker the game opens on, with NO address switch: set the preview's
 * power and speed-up, and press *Preview* — PR #2113's ruling, the way a rider
 * in the tablet app asks for the simulated ride.
 */
async function preview(power: string, speedup: PreviewSpeedup): Promise<void> {
  const container = mounted?.container ?? document.body;
  const box = container.querySelector<HTMLInputElement>('.oyl-chooser__preview input[type=number]');
  expect(box).not.toBeNull();
  if (box !== null) await typeInto(box, power);
  const choice = queryAll<HTMLLabelElement>(container, '.oyl-chooser__preview label').find(
    (label) => label.textContent === `${String(speedup)}×`,
  );
  await clickThrough(choice);
  await clickThrough(buttonStarting('Preview '));
  for (let index = 0; index < 5; index += 1) await settle();
}

/** Open the game with no switch at all, and ride a preview from its picker. */
async function ridePreview(
  power: string,
  speedup: PreviewSpeedup,
  options: { readonly trainer?: GameTrainerPort; readonly frames?: number } = {},
): Promise<void> {
  globalThis.location.hash = '#/game';
  mounted = await mount(
    <GameView
      port={gamePort()}
      {...(options.trainer === undefined ? {} : { trainer: options.trainer })}
      renderer={() => Promise.resolve(capturingRenderer([]))}
      now={() => nowMs}
    />,
  );
  await settle();
  await preview(power, speedup);
  await pump(options.frames ?? 20);
  await settle();
}

/**
 * Where a real ride at {@link POWER} is after `frames` frames of the test's
 * clock, run `speedup` times faster from the mount — `GameView`'s simulation,
 * built as it builds one and advanced on the same instants.
 */
function shadowDistance(frames: number, speedup: number): number {
  const simulation = new GameSimulation({
    profile: ROUTE.profile,
    conditions: rideConditionsFor(riderMassFor(undefined).mass, DEFAULT_RIDING_POSITION),
  });
  for (let frame = 1; frame <= frames; frame += 1) {
    const at = START_MS + frame * FRAME_MS * speedup;
    simulation.advanceTo(at, { power: watts(POWER), live: true });
  }
  return simulation.state.ride.distance;
}

/** What is mounted now — a read rather than a narrowed variable, as the cases remount. */
function screen(): HTMLElement | undefined {
  return mounted?.container;
}

/** The odometer of the last frame the scene built. */
function lastOdometer(): number | undefined {
  return built.at(-1)?.odometer;
}

describe('a simulated rider rides the rider’s own route with nothing paired — #1992', () => {
  it('moves along it at the chosen power, exactly as a real rider at that power would', async () => {
    await ride(`#/game?simulate=${String(POWER)}`, { frames: 20 });

    const along = lastOdometer() ?? 0;
    expect(along).toBeGreaterThan(30);
    expect(along).toBeCloseTo(shadowDistance(20, 1), 6);
  });

  it('stands still on the same screen with the switch off — the control', async () => {
    await ride('#/game', { frames: 20 });

    expect(built.length).toBeGreaterThan(0);
    expect(lastOdometer()).toBe(0);
  });

  it('rides faster than real time at the speed-up, and covers the road a real ride would', async () => {
    await ride(`#/game?simulate=${String(POWER)}&speedup=8`, { frames: 20 });

    const along = lastOdometer() ?? 0;
    expect(along).toBeCloseTo(shadowDistance(20, 8), 6);
    expect(along).toBeGreaterThan(shadowDistance(20, 1) * 6);
  });

  it('starts at the asked distance, and the world drawn there is the one a real ride draws there', async () => {
    // A real ride on a power meter, to a place on the road…
    await ride('#/game', { port: gamePort(PEDALLING), frames: 30 });
    const real = built.filter((each) => each.distance > 40)[0];
    expect(real).toBeDefined();
    const place = real?.distance ?? 0;
    mounted?.unmount();
    mounted = undefined;
    built.length = 0;
    pending = [];

    // …and a simulated one, from it.
    await ride(`#/game?simulate=${String(POWER)}&at=${String(place)}`, { frames: 1 });
    const first = built[0];
    expect(first?.distance).toBe(place);

    // The world is everything the scene builds around the place: the road,
    // the ground, the scenery, the streets, the water and the stands. Two
    // things in it are not the world: a buffer's `lease`, which counts the
    // frames that lent it, and the water's `seconds`, the ride clock its
    // ripples run on. The rider's own marker and the camera follow their
    // speed, and a simulated ride starts from rest, so neither is compared.
    const world = (frame: unknown): unknown => {
      const { corridor, terrain, scatter, streets, sideRoads, water, lines, billboards } =
        frame as SceneFrame;
      const style = (frame as SceneFrame).world;
      return JSON.parse(
        JSON.stringify(
          { corridor, terrain, scatter, streets, sideRoads, water, lines, billboards, style },
          (key, value: unknown) => (key === 'lease' || key === 'seconds' ? undefined : value),
        ),
      ) as unknown;
    };
    expect(world(first?.frame)).toEqual(world(real?.frame));
    // Not the start line's world: the jump moved it.
    const startLine = built.find((each) => each.distance === 0);
    expect(startLine).toBeUndefined();
  });

  it('marks the HUD as simulated for the whole ride, and an ordinary ride carries no mark', async () => {
    await ride(`#/game?simulate=${String(POWER)}&speedup=8`, { frames: 4 });
    const text = simulatedRideText({ watts: POWER, speedup: 8, startMetres: undefined });
    expect(screen()?.querySelector('.oyl-hud__simulated')?.textContent).toBe(text);
    await pump(10);
    expect(screen()?.querySelector('.oyl-hud__simulated')?.textContent).toBe(text);

    mounted?.unmount();
    mounted = undefined;
    pending = [];
    await ride('#/game', { port: gamePort(PEDALLING), frames: 4 });
    expect(screen()?.querySelector('.oyl-hud__simulated')).toBeNull();
    expect(screen()?.textContent).not.toContain('Simulated ride');
  });
});

describe('the picker’s Preview without a trainer — PR #2113’s ruling', () => {
  it('rides the chosen route at the power and speed-up set on the picker, with no switch in the address', async () => {
    await ridePreview(String(POWER), 8);

    expect(globalThis.location.hash).toBe('#/game');
    const along = lastOdometer() ?? 0;
    expect(along).toBeCloseTo(shadowDistance(20, 8), 6);
    expect(along).toBeGreaterThan(shadowDistance(20, 1) * 6);
  });

  it('rides in real time at 1×, so the speed-up is the one chosen', async () => {
    await ridePreview(String(POWER), 1);

    expect(lastOdometer() ?? 0).toBeCloseTo(shadowDistance(20, 1), 6);
  });

  it('carries the HUD’s note, worded for the power and speed-up chosen', async () => {
    await ridePreview(String(POWER), 4, { frames: 4 });

    expect(screen()?.querySelector('.oyl-hud__simulated')?.textContent).toBe(
      simulatedRideText({ watts: POWER, speedup: 4, startMetres: undefined }),
    );
  });

  it('refuses a power it cannot ride, and says why — nothing starts', async () => {
    globalThis.location.hash = '#/game';
    mounted = await mount(
      <GameView
        port={gamePort()}
        renderer={() => Promise.resolve(capturingRenderer([]))}
        now={() => nowMs}
      />,
    );
    await settle();
    await preview('20', 8);
    await pump(10);

    expect(buttonStarting('Preview ')?.getAttribute('aria-disabled')).toBe('true');
    expect(screen()?.querySelector('.oyl-chooser__preview [role=alert]')?.textContent).toBe(
      'Enter a whole number of watts from 50 to 1000.',
    );
    expect(built).toEqual([]);
    expect(screen()?.querySelector('.oyl-hud__simulated')).toBeNull();
  });

  it('rides the card the rider chose, and hands back the picker on that card', async () => {
    const other: RidableRoute = { ...ROUTE, id: 'route-other', name: 'My other route' };
    globalThis.location.hash = '#/game';
    mounted = await mount(
      <GameView
        port={{ ...gamePort(), listRoutes: () => Promise.resolve([ROUTE, other]) }}
        renderer={() => Promise.resolve(capturingRenderer([]))}
        now={() => nowMs}
      />,
    );
    await settle();
    const card = queryAll<HTMLInputElement>(screen() ?? document, 'input[type=radio]').find(
      (radio) => radio.labels?.[0]?.textContent?.includes(other.name) === true,
    );
    await clickThrough(card);
    expect(buttonStarting('Preview ')?.textContent).toBe(`Preview ${other.name}`);
    await preview(String(POWER), 8);
    await pump(4);
    expect(screen()?.querySelector('.oyl-hud__simulated')).not.toBeNull();
    await clickThrough(buttonStarting('End ride'));

    expect(buttonStarting('Ride ')?.textContent).toBe(`Ride ${other.name}`);
    expect(screen()?.querySelector('.oyl-hud__simulated')).toBeNull();
  });

  it('asks a ready trainer for nothing, writes nothing to it and releases nothing', async () => {
    const commands: Commands = { written: [], releases: [], requests: [] };
    await ridePreview(String(POWER), 8, { trainer: readyTrainer(commands), frames: 40 });
    expect(lastOdometer() ?? 0).toBeGreaterThan(100);
    await clickThrough(buttonStarting('End ride'));

    expect(commands).toEqual({ written: [], releases: [], requests: [] });
  });
});

describe('a sped-up ride is timed on the wall clock, so the world holds its rung — #1992', () => {
  /** The settings `setQuality` was handed over `frames` frames of `frameMs` each. */
  async function rungs(hash: string, frameMs: number, frames: number): Promise<string[]> {
    const seen: string[] = [];
    globalThis.location.hash = hash;
    const base = capturingRenderer([]);
    mounted = await mount(
      <GameView
        port={gamePort()}
        renderer={() =>
          Promise.resolve({
            ...base,
            create: (...args: Parameters<GameRenderer['create']>) => {
              const made = base.create(...args);
              return {
                ...made,
                setQuality: (quality: Parameters<typeof made.setQuality>[0]) => {
                  seen.push(JSON.stringify(quality));
                },
              };
            },
          })
        }
        now={() => nowMs}
      />,
    );
    await settle();
    await clickThrough(buttonStarting('Ride '));
    for (let index = 0; index < frames; index += 1) {
      const next = pending.shift();
      if (next === undefined) break;
      nowMs += frameMs;
      await act(async () => {
        next(nowMs);
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    return seen;
  }

  it('draws a 60 fps ride at 32x on the same rungs as at 1x, and the standard world is not dropped', async () => {
    const real = await rungs(`#/game?simulate=${String(POWER)}`, 16.7, 150);
    mounted?.unmount();
    mounted = undefined;
    pending = [];
    nowMs = START_MS;
    const fast = await rungs(`#/game?simulate=${String(POWER)}&speedup=32`, 16.7, 150);

    expect(fast).toEqual(real);
  });
});

describe('a simulated ride runs no Delivery round, so the week on this device is not its to count — #1992', () => {
  it('rides an ordinary ride when the developer route also asks for a round', async () => {
    await ride(`#/game?simulate=${String(POWER)}&delivery=on`, { frames: 4 });
    expect(mounted?.container.textContent).not.toContain(HOUSES_NOT_READY_TEXT);
  });

  it('answers the same ask for a round with the switch off — the control', async () => {
    await ride('#/game?delivery=on', { port: gamePort(PEDALLING), frames: 4 });
    expect(mounted?.container.textContent).toContain(HOUSES_NOT_READY_TEXT);
  });
});

describe('a simulated ride offers no room to make or join — #1992', () => {
  /** A rooms port whose every call fails the test: the picker must call none. */
  const ROOMS = new Proxy({} as RoomsPort, {
    get: (_target, member) => () => {
      throw new Error(`a simulated ride called rooms.${String(member)}`);
    },
  });

  async function picker(hash: string): Promise<string> {
    globalThis.location.hash = hash;
    mounted = await mount(
      <GameView
        port={gamePort()}
        renderer={() => Promise.resolve(capturingRenderer([]))}
        now={() => nowMs}
        rooms={ROOMS}
        riderMass={kilograms(72)}
      />,
    );
    await settle();
    return mounted.container.querySelector('.oyl-rooms')?.textContent ?? '';
  }

  it('shows the picker’s room panel with nothing to make or join', async () => {
    expect(await picker(`#/game?simulate=${String(POWER)}`)).toContain(
      'Connect this device to one in Settings',
    );
  });

  it('offers rooms on the same picker with the switch off — the control', async () => {
    expect(await picker('#/game')).not.toContain('Connect this device to one in Settings');
  });
});

describe('a simulated ride reaches no trainer — #1992, CLAUDE.md §6', () => {
  it('asks a ready trainer for nothing, writes nothing to it and releases nothing', async () => {
    const commands: Commands = { written: [], releases: [], requests: [] };
    await ride(`#/game?simulate=${String(POWER)}&speedup=8`, {
      trainer: readyTrainer(commands),
      frames: 40,
    });
    expect(lastOdometer() ?? 0).toBeGreaterThan(100);
    await clickThrough(buttonStarting('End ride'));

    expect(commands).toEqual({ written: [], releases: [], requests: [] });
  });

  it('asks, writes and releases on the same trainer with the switch off — the control', async () => {
    const commands: Commands = { written: [], releases: [], requests: [] };
    await ride('#/game', {
      port: gamePort(PEDALLING),
      trainer: readyTrainer(commands),
      frames: 40,
    });
    await clickThrough(buttonStarting('End ride'));

    expect(commands.requests.length).toBeGreaterThan(0);
    expect(commands.written.length).toBeGreaterThan(0);
    expect(commands.releases.length).toBeGreaterThan(0);
  });
});

describe('nothing from a simulated ride is kept or shared — the whole path (#1992)', () => {
  /**
   * The ride controller `main.tsx` builds, over the #44 simulator's FTMS
   * trainer, PAIRED, with the real store underneath it and a room to join —
   * everything a game ride can reach a machine, the library or another rider
   * through. Exports and sync read the library, so a ride the library never
   * held cannot reach either.
   */
  async function onTheBench() {
    const harness = createStoreHarness();
    await seedAthletes(harness);
    const savedIds: string[] = [];
    let mintedLaps = 0;
    const { transport, bench } = createSimulator({
      devices: [ftmsTrainer({ id: 'kickr', name: 'KICKR 1F2A' })],
    });
    const written: number[][] = [];
    const controller = createRideController({
      transport,
      store: {
        putRecordingSession: async (record) =>
          harness.write(async (store) => store.putRecordingSession(record)),
        appendRecordingChunk: async (chunk) =>
          harness.write(async (store) => store.appendRecordingChunk(chunk)),
        readRecordingSessions: async (owner) =>
          harness.write(async (store) => store.readRecordingSessions(owner)),
        recoverRecording: async (owner, id) =>
          harness.write(async (store) => store.recoverRecording(owner, id)),
        deleteRecordingSession: async (owner, id) =>
          harness.write(async (store) => store.deleteRecordingSession(owner, id)),
      },
      athleteId: ATHLETE_A,
      newSessionId: () => recordingSessionId('ride-1'),
      now: () => bench.now,
      openTrainer: simulatedOpenTrainer(bench, { written, refuseControl: false }),
      rideSave: {
        newActivityId: () => activityId('the-ride'),
        newLapId: () => lapId(`lap-${String((mintedLaps += 1))}`),
        timeZone: 'UTC',
        store: {
          putFinishedRide: (finished) =>
            harness.write(async (store) => {
              const id = await store.putFinishedRide(finished);
              savedIds.push(id);
              return id;
            }),
        },
      },
    });
    await controller.pair('trainer');
    const room = new ScriptedRoom();
    const clock = new ManualClock();
    return {
      controller,
      written,
      bench,
      room,
      clock,
      savedIds,
      sessions: async () =>
        (await harness.write(async (store) => store.readRecordingSessions(ATHLETE_A))).sessions,
      done: async () => {
        controller.dispose();
        await harness.destroy();
      },
    };
  }

  type Bench = Awaited<ReturnType<typeof onTheBench>>;

  async function openTheGame(rig: Bench, hash: string): Promise<void> {
    globalThis.location.hash = hash;
    mounted = await mount(
      <GameView
        port={gamePort(PEDALLING)}
        trainer={gameTrainerPortOver(rig.controller)}
        renderer={() => Promise.resolve(capturingRenderer([]))}
        now={() => nowMs}
        room={roomPortOver(() => rig.room.link(), { timers: rig.clock, now: () => nowMs })}
        roomId="room-1"
        riderMass={kilograms(72)}
      />,
    );
    await settle();
  }

  async function rideFor(rig: Bench, frames: number): Promise<void> {
    for (let index = 0; index < frames; index += 1) {
      await rig.clock.advance(FRAME_MS);
      if (index % 2 === 1) {
        rig.bench.advance(seconds(1));
        await rig.controller.tick(rig.bench.now);
      }
      await pump(1);
    }
    for (let index = 0; index < 10; index += 1) await settle();
  }

  it('writes nothing to the machine, records nothing, saves nothing and joins no room', async () => {
    const rig = await onTheBench();
    await openTheGame(rig, `#/game?simulate=${String(POWER)}&speedup=8`);
    // No *Record this ride* is offered on the picker.
    expect(buttonStarting('Record this ride')).toBeUndefined();
    await clickThrough(buttonStarting('Ride '));
    await rideFor(rig, 30);
    expect(lastOdometer() ?? 0).toBeGreaterThan(100);
    await clickThrough(buttonStarting('End ride'));
    for (let index = 0; index < 10; index += 1) await settle();

    expect(rig.written).toEqual([]);
    expect(rig.controller.getSnapshot().phase).toBe('idle');
    expect(await rig.sessions()).toEqual([]);
    expect(rig.savedIds).toEqual([]);
    expect(rig.room.tickets).toEqual([]);
    expect(rig.room.sockets).toEqual([]);
    await rig.done();
  });

  it('from the picker’s Preview: writes nothing, records nothing, saves nothing and joins no room — then rides for real after', async () => {
    const rig = await onTheBench();
    await openTheGame(rig, '#/game');
    await preview(String(POWER), 8);
    await rideFor(rig, 30);
    expect(lastOdometer() ?? 0).toBeGreaterThan(100);
    expect(screen()?.querySelector('.oyl-hud__simulated')).not.toBeNull();
    await clickThrough(buttonStarting('End ride'));
    for (let index = 0; index < 10; index += 1) await settle();

    expect(rig.written).toEqual([]);
    expect(rig.controller.getSnapshot().phase).toBe('idle');
    expect(await rig.sessions()).toEqual([]);
    expect(rig.savedIds).toEqual([]);
    expect(rig.room.tickets).toEqual([]);
    expect(rig.room.sockets).toEqual([]);

    // The control, on the same bench: the preview handed back an ORDINARY
    // picker, on the route it rode, whose Ride takes the machine and records.
    expect(buttonStarting('Ride ')?.textContent).toBe(`Ride ${ROUTE.name}`);
    await clickThrough(buttonStarting('Ride '));
    for (let index = 0; index < 10; index += 1) await settle();
    rig.room.accept();
    rig.room.welcome(0);
    await rideFor(rig, 30);
    expect(screen()?.querySelector('.oyl-hud__simulated')).toBeNull();
    expect(rig.written.length).toBeGreaterThan(0);
    expect(rig.controller.getSnapshot().phase).toBe('recording');
    expect((await rig.sessions()).length).toBeGreaterThan(0);
    await rig.done();
  });

  it('takes the machine, records and joins the room on the same bench with the switch off — the control', async () => {
    const rig = await onTheBench();
    await openTheGame(rig, '#/game');
    await clickThrough(buttonStarting('Ride '));
    for (let index = 0; index < 10; index += 1) await settle();
    rig.room.accept();
    rig.room.welcome(0);
    await rideFor(rig, 30);

    expect(rig.written.length).toBeGreaterThan(0);
    expect(rig.room.tickets.length).toBeGreaterThan(0);
    expect(rig.controller.getSnapshot().phase).toBe('recording');
    expect((await rig.sessions()).length).toBeGreaterThan(0);
    await rig.done();
  });
});
