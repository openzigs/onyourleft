// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2982 through the real game screen: an open-world ride ridden **past its
 * first view**, on hilly synthetic streets, with a trainer that takes the
 * road's grade. Everything is read back from what a consumer was handed —
 * the profile and distances `sceneFrame` was given each frame, and the grades
 * the trainer was asked for — never from the road itself.
 *
 * The session is a double that hands over a rolling route on
 * `@onyourleft/domain/rolling-testing`'s grid, because the map archive's
 * fixture is flat until #2899 reads heights, and a flat road would write one
 * grade for the whole ride. The game, the simulation, the road follower, the
 * gradient session and the trainer port are the product's.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RollingRoute,
  buildGhostTrack,
  distanceBetween,
  gradeAt,
  metres,
  positionAt,
  watts,
  type GeographicPosition,
  type GhostTrack,
  type RollingEdge,
} from '@onyourleft/domain';
import { gridGraph, roughGround } from '@onyourleft/domain/rolling-testing';
import type { SimulationParameters } from '@onyourleft/sensors/protocol';

import { mount, queryAll, settle, type Mounted } from '../../testing/mount';
import { GameView, type GamePort } from '../GameView';
import type { GameRenderer } from '../port';
import type { SceneInput } from '../scene';
import { OPEN_WORLD_ALONE_TEXT } from '../StageChooser';
import { ANNOUNCEMENTS_STORAGE_KEY, DEFAULT_ANNOUNCEMENTS } from '../hud/announce-preference';
import { NO_READING } from '../hud/fields';
import { slopeAhead, slopeSentence, slopesOf } from '../hud/climb-ahead';
import { gameTrainerPortOver, type GameTrainerPort, type GradientTrainer } from '../trainer-port';
import { fixtureStart, START_COLUMN, START_ROW } from './fixture-testing';
import { OPEN_WORLD_ROUTE_ID, type OpenWorldSessions } from './ride';
import { OpenWorldRoad } from './road';

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

/** Half a second a frame: the ride is long, and the simulation's fixed step is not the frame. */
const FRAME_MS = 2_000;

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
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function pump(): Promise<void> {
  const next = pending.shift();
  if (next === undefined) return;
  nowMs += FRAME_MS;
  await act(async () => {
    next(nowMs);
    await Promise.resolve();
  });
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

/** A grid of hilly streets, spaced unevenly, ridden east from its corner along row 3. */
function hillyRoute(): RollingRoute {
  const { graph, edges } = gridGraph(
    [0, 180, 410, 600, 870, 1_050, 1_330, 1_520, 1_790, 2_000, 2_260, 2_450],
    [0, 230, 400, 650, 820, 1_090, 1_280, 1_510],
    roughGround,
    3,
  );
  return new RollingRoute(graph, edges.find((edge) => edge.id === 'h0,3') as RollingEdge);
}

/**
 * The game port's open-world sessions: one start, ready at once on {@link hillyRoute}.
 * `attempts` is the card's: one with an attempt offers the rider's own ghost.
 */
function sessions(attempts = 0): OpenWorldSessions {
  let start = fixtureStart(START_COLUMN, START_ROW) as ReturnType<typeof fixtureStart> | undefined;
  return {
    take: () => {
      const taken = start;
      start = undefined;
      return taken;
    },
    open: () => ({
      ready: Promise.resolve({
        kind: 'ready' as const,
        route: {
          id: OPEN_WORLD_ROUTE_ID,
          name: 'Open world',
          profile: hillyRoute().view(),
          attempts,
        },
        road: () => new OpenWorldRoad(hillyRoute()),
      }),
      stop: () => undefined,
    }),
  };
}

/** A trainer that takes the road, and keeps every grade it was asked for with the frame it came on. */
function trainer(
  written: { readonly grade: number; readonly frame: number }[],
  courseLines: unknown[] = [],
): GameTrainerPort {
  const facts = { paired: true, controllable: true, canSimulate: true, hasControl: true };
  const control: GradientTrainer = {
    setSimulationParameters: (parameters: SimulationParameters) => {
      written.push({ grade: parameters.grade, frame: inputs.length });
      return Promise.resolve();
    },
    letGo: () => Promise.resolve({ kind: 'stopped' as const }),
  };
  const port = gameTrainerPortOver({
    getSnapshot: () => ({ trainer: facts, workout: undefined }),
    simulationControl: () => control,
    requestTrainerControl: () => Promise.resolve(),
    noteGameRideEnded: () => undefined,
    subscribe: () => () => undefined,
  });
  // A recording under the ride, as the Ride screen's is: every course-line
  // event the game hands it is kept here.
  return {
    ...port,
    courseLine: (event) => {
      courseLines.push(event);
      return [];
    },
  };
}

function port(attempts = 0): GamePort {
  return {
    listRoutes: () => Promise.resolve([]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(300), live: true, paired: true },
      cadence: { value: 90, live: true, paired: true },
      heartRate: { value: 140, live: true, paired: true },
    }),
    openWorld: sessions(attempts),
  };
}

function rideButton(): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find((button) =>
    (button.textContent ?? '').startsWith('Ride '),
  );
}

/** Where the scene put the rider's odometer, as a place. */
function placeOf(input: SceneInput): GeographicPosition {
  return positionAt(input.profile, input.state.ride.distance);
}

describe('an open-world ride past its first view — #2982', () => {
  it('rides on through new views of the road with a moving origin, the rider never jumping, and the trainer on the road’s grade', async () => {
    const written: { grade: number; frame: number }[] = [];
    mounted = await mount(
      <GameView
        port={port()}
        trainer={trainer(written)}
        renderer={() => Promise.resolve(capturingRenderer())}
        now={() => nowMs}
      />,
    );
    for (let tries = 0; tries < 50 && rideButton()?.textContent !== 'Ride Open world'; tries++) {
      await settle();
    }
    expect(rideButton()?.textContent).toBe('Ride Open world');
    await act(async () => {
      rideButton()?.click();
      await Promise.resolve();
    });
    await settle();
    const firstView = () => inputs[0]?.profile;
    for (let frames = 0; frames < 400; frames += 1) {
      const last = inputs[inputs.length - 1];
      // Past the first view's 2 km, and past a second advance of the road.
      if (last !== undefined && last.profile !== firstView() && views() >= 3 && moved() > 1_500)
        break;
      await pump();
    }

    function views(): number {
      return new Set(inputs.map((input) => input.profile)).size;
    }
    function moved(): number {
      const last = inputs[inputs.length - 1];
      const first = firstView();
      if (last === undefined || first === undefined) return 0;
      // How far the view's distance zero is from the first view's: the origin.
      return distanceBetween(
        last.profile.positions[0] as GeographicPosition,
        first.positions[0] as GeographicPosition,
      );
    }

    expect(views()).toBeGreaterThanOrEqual(3);
    expect(moved()).toBeGreaterThan(1_500);
    // Frame to frame, the rider moved by the distance ridden, at most 90 km/h
    // down these hills — never by the kilometres between two views' origins,
    // which is what a distance read on the wrong view would be.
    let travelled = 0;
    for (let index = 1; index < inputs.length; index += 1) {
      const before = inputs[index - 1] as SceneInput;
      const after = inputs[index] as SceneInput;
      const step = distanceBetween(placeOf(before), placeOf(after));
      expect(step, `frame ${index}`).toBeLessThan(25 * (FRAME_MS / 1000));
      travelled += step;
    }
    expect(travelled).toBeGreaterThan(2_500);
    // The drawn rider is on the same view, within a step of the odometer.
    for (const input of inputs) {
      expect(
        distanceBetween(
          placeOf(input),
          positionAt(input.profile, metres(input.riderDistance ?? 0)),
        ),
      ).toBeLessThan(15);
    }
    // The simulation's grade is the view's at the rider: the hill the physics
    // rode is the hill drawn.
    for (const input of inputs) {
      expect(
        Math.abs(
          (input.state.grade as number) -
            (gradeAt(input.profile, input.state.ride.distance) as number),
        ),
      ).toBeLessThan(1e-6);
    }
    // The HUD reads the same view at the same distance: part of the way along
    // it, never the end of it, which is where the ride distance on a view a
    // kilometre and more behind would put it.
    const strip = queryAll(mounted.container, '[aria-label^="Route profile"]')[0];
    const percent = Number(/(\d+) per cent/.exec(strip?.getAttribute('aria-label') ?? '')?.[1]);
    expect(percent).toBeGreaterThan(10);
    expect(percent).toBeLessThan(90);
    // And each grade the trainer was asked for is the road's at the rider on
    // the view drawn that frame or the one before: the same road, read at the
    // same distance, past the first view as before it.
    const pastFirst = written.filter((write) => inputs[write.frame - 1]?.profile !== firstView());
    expect(pastFirst.length).toBeGreaterThan(5);
    for (const write of written) {
      const near = [inputs[write.frame - 1], inputs[write.frame]].filter(
        (input): input is SceneInput => input !== undefined,
      );
      const off = Math.min(
        ...near.map((input) =>
          Math.abs((gradeAt(input.profile, input.state.ride.distance) as number) - write.grade),
        ),
      );
      expect(off, `the write on frame ${write.frame}`).toBeLessThan(1e-6);
    }
  });
});

/** A previous attempt, ahead of the rider: drawn as a ghost wherever one is loaded. */
const OWN_GHOST: GhostTrack = buildGhostTrack({
  elapsedSeconds: [0, 60],
  distanceMetres: [0, 1_200],
});

const toggle = (text: string): HTMLInputElement | undefined =>
  queryAll<HTMLInputElement>(mounted?.container ?? document, 'input[type="checkbox"]').find(
    (input) => (input.closest('label')?.textContent ?? '').includes(text),
  );

async function clickThrough(element: HTMLElement | undefined): Promise<void> {
  expect(element).toBeDefined();
  await act(async () => {
    element?.click();
    await Promise.resolve();
  });
  await settle();
}

async function untilTheCard(): Promise<void> {
  for (let tries = 0; tries < 50 && rideButton()?.textContent !== 'Ride Open world'; tries++) {
    await settle();
  }
  expect(rideButton()?.textContent).toBe('Ride Open world');
}

/** A saved route beside the open-world card: one with an attempt, so its ghost is offered. */
const SAVED = {
  id: 'saved-road',
  name: 'Saved road',
  profile: hillyRoute().view(),
  attempts: 1,
};

/** The radio of the route card whose label names `name`. */
function cardRadio(name: string): HTMLInputElement | undefined {
  return (
    queryAll<HTMLElement>(mounted?.container ?? document, '.oyl-chooser__card')
      .find((card) => (card.querySelector('label')?.textContent ?? '').includes(name))
      ?.querySelector<HTMLInputElement>('input[type="radio"]') ?? undefined
  );
}

/** #2990: the open-world card offers no ghost, pacer, round, race or preview, and says why. */
function expectRiddenAloneOffered(): void {
  const text = mounted?.container.textContent ?? '';
  expect(text).toContain(OPEN_WORLD_ALONE_TEXT);
  for (const label of ['pacer', 'Race your own', 'Race another rider', 'Deliver', 'lap race']) {
    expect(toggle(label), label).toBeUndefined();
  }
  const buttons = queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button');
  expect(buttons.filter((button) => /preview/i.test(button.textContent ?? ''))).toEqual([]);
}

/** The HUD field under `label`, as a rider reads it. */
function fieldSaying(label: string): string {
  const row = queryAll(mounted?.container ?? document, '.oyl-hud__field').find(
    (element) => element.querySelector('.oyl-hud__label')?.textContent === label,
  );
  return row?.querySelector('.oyl-hud__value')?.textContent ?? '';
}

const spoken = (): string =>
  mounted?.container.querySelector('[data-oyl-announcer="hud"]')?.textContent ?? '';

describe('an open-world ride is ridden alone — #2982', () => {
  it('rides past its first view with a pacer, a ghost and a Delivery round asked for, and has none of them, no course line, no "to go" and the new view’s climbs', async () => {
    localStorage.setItem(
      ANNOUNCEMENTS_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_ANNOUNCEMENTS, enabled: true, distanceEvery: 0.5 }),
    );
    const loadGhost = vi.fn(() => Promise.resolve<GhostTrack | undefined>(OWN_GHOST));
    const courseLines: unknown[] = [];
    mounted = await mount(
      <GameView
        port={{ ...port(1), loadGhost, listRoutes: () => Promise.resolve([SAVED]) }}
        trainer={trainer([], courseLines)}
        renderer={() => Promise.resolve(capturingRenderer())}
        now={() => nowMs}
        delivery
      />,
    );
    await untilTheCard();
    // #2990: the card offers none of them, says why, and offers no preview.
    expectRiddenAloneOffered();
    // Everything the picker offers a saved route that a solo ride would ride,
    // switched on there and carried to the open-world card.
    await clickThrough(cardRadio(SAVED.name));
    await clickThrough(toggle('pacer'));
    const intensity = queryAll<HTMLInputElement>(mounted.container, 'input[type="number"]')[0];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    await act(async () => {
      setter?.set?.call(intensity, '3');
      intensity?.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
    await clickThrough(toggle('Race your own'));
    await clickThrough(cardRadio('Open world'));
    expect(rideButton()?.textContent).toBe('Ride Open world');
    expectRiddenAloneOffered();
    await clickThrough(rideButton());

    const firstView = () => inputs[0]?.profile;
    const heard: string[] = [];
    let slopesPastFirst = 0;
    for (let frames = 0; frames < 400; frames += 1) {
      // Past a second advance of the road, with new views' slopes said.
      if (new Set(inputs.map((input) => input.profile)).size >= 3 && slopesPastFirst >= 3) break;
      const before = spoken();
      await pump();
      const said = spoken();
      const at = inputs[inputs.length - 1];
      if (said === before || said === '' || at === undefined) continue;
      heard.push(said);
      if (/^(Climb|Descent) /.test(said)) {
        // The climb said is the one ahead on the view drawn this frame, from
        // that view's own slopes: a climb read off the first view's would be
        // one the rider is not approaching.
        const ahead = slopeAhead(
          slopesOf(at.profile),
          at.profile,
          at.state.ride.distance,
          DEFAULT_ANNOUNCEMENTS.climbLeadMetres as number,
        );
        expect(ahead, `"${said}"`).toBeDefined();
        if (ahead !== undefined) expect(said).toBe(slopeSentence(ahead, 'metric'));
        if (at.profile !== firstView()) slopesPastFirst += 1;
      }
    }

    // Ridden on past the first view: a pacer the road moved under would have
    // stopped the loop at the first new one.
    expect(new Set(inputs.map((input) => input.profile)).size).toBeGreaterThanOrEqual(3);
    // And the climbs and descents of each new view are said on it, as the
    // first view's were: slopes kept from the first view go quiet there.
    expect(slopesPastFirst).toBeGreaterThanOrEqual(3);
    // No pacer, no ghost of the rider's own: nothing drawn beside the rider.
    expect(inputs.every((input) => input.botDistance === undefined)).toBe(true);
    expect(inputs.every((input) => input.ghost === undefined)).toBe(true);
    expect(loadGhost).not.toHaveBeenCalled();
    // No course: the recording under the ride is handed no line, no lap and no progress.
    expect(courseLines).toEqual([]);
    // No distance to go, which a view's end is not, and no Delivery round.
    expect(heard.filter((sentence) => sentence.includes('to go'))).toEqual([]);
    expect(heard.filter((sentence) => /deliver|house|round/i.test(sentence))).toEqual([]);
    // #2990: and the HUD shows none either: a dash where the distance to go
    // would be (the totals strip's is `totals-strip.test.ts`').
    expect(fieldSaying('To go')).toBe(`${NO_READING} km`);
  });

  it('races no other rider’s ghost: the press asks for none and rides alone', async () => {
    const loadRiderGhost = vi.fn(() =>
      Promise.resolve({ kind: 'ghost' as const, rider: 'Bea', track: OWN_GHOST }),
    );
    mounted = await mount(
      <GameView
        port={{
          ...port(),
          riderGhostOffered: () => true,
          loadRiderGhost,
          listRoutes: () => Promise.resolve([SAVED]),
        }}
        renderer={() => Promise.resolve(capturingRenderer())}
        now={() => nowMs}
      />,
    );
    await untilTheCard();
    expect(toggle('Race another rider')).toBeUndefined();
    // Asked for on a saved route, and carried to the open-world card.
    await clickThrough(cardRadio(SAVED.name));
    await clickThrough(toggle('Race another rider'));
    await clickThrough(cardRadio('Open world'));
    expect(toggle('Race another rider')).toBeUndefined();
    await clickThrough(rideButton());
    for (let frames = 0; frames < 20; frames += 1) await pump();

    expect(loadRiderGhost).not.toHaveBeenCalled();
    expect(inputs.length).toBeGreaterThan(10);
    expect(inputs.every((input) => input.ghost === undefined)).toBe(true);
  });

  it('is no ride in a room: a room’s road is the room’s', async () => {
    mounted = await mount(
      <GameView
        port={port()}
        roomId="room-1"
        renderer={() => Promise.resolve(capturingRenderer())}
        now={() => nowMs}
      />,
    );
    await untilTheCard();
    await clickThrough(rideButton());
    for (let frames = 0; frames < 20; frames += 1) await pump();

    expect(inputs).toEqual([]);
    expect(rideButton()?.textContent).toBe('Ride Open world');
  });
});
