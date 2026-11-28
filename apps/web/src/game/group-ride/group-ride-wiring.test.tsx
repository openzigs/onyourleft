// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **A group ride chosen on the picker is a group in the ride** — #3303, epic
 * #3296, ADR 0101. The named failure is state a control writes and nothing
 * reads: a switch, a speed and a size on *Your ride* that start an ordinary
 * ride.
 *
 * Every case drives the real `GameView` through the real picker, presses the
 * real *Ride*, and rides the real simulation on frames this file hands out.
 * What it reads back is what a consumer reads:
 *
 * - **the simulation's own draft factor** (`GameSimulation.draftFactor`, the
 *   multiplier the rider's next step is ridden at), kept by wrapping the real
 *   class and calling nothing on it;
 * - **the frame's scene input** (`sceneFrame`'s argument): the bots the pack
 *   layout drew, and the rider's own drawn place;
 * - **what the ride is handed for the recording** through the game's port:
 *   the group's fact, and the draft that marks the ride as drafted;
 * - **the picker itself** after a remount, for what the device remembers.
 *
 * `check:wiring` covers the seam between the modules
 * (`group-ride/choice.ts`, `group-ride/ride-group.ts` and the port's
 * `groupRideStepped`); it cannot see a call deleted from the tick, and these
 * cases can.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BOT_TACTIC_WHEEL_GAP_METRES, watts, type CueKind } from '@onyourleft/domain';
import type { GroupRideFact } from '@onyourleft/store';

import { chooseOption, mount, queryAll, settle, typeInto, type Mounted } from '../../testing/mount';
import { RIDE_MAY_STOP_SPOKEN } from '../../ride/controller';
import { GROUP_RIDE_CUE_SOUND, RIDE_CUE_LEVEL } from '../audio-cues';
import type { CueOutput } from '../audio-port';
import { recordingOutput, type RecordedCall } from '../audio-testing';
import { CUES_STORAGE_KEY } from '../cue-preference';
import { GameView, type GamePort, type RidableRoute } from '../GameView';
import { ANNOUNCEMENTS_STORAGE_KEY } from '../hud/announce-preference';
import type { PadSnapshot } from '../gamepad-port';
import { PULL_OFF_BUTTON_LABEL, SIT_IN_BUTTON_LABEL } from '../hud/GroupRideControls';
import { LANE_OFFSETS_METRES } from '../lanes';
import type { GameRenderer } from '../port';
import { DEFAULT_LAP_RACE_CHOICE } from '../lap-race/choice';
import { circuitRoute, northRoute } from '../route-fixtures-testing';
import type { SceneInput } from '../scene';
import type { GameSensors } from '../sensors';
import type { GameSimulation } from '../simulation';
import { SOLO_DRAFT_STORAGE_KEY } from '../solo-draft-preference';
import type { SoloDraftState } from '../solo-draft';
import { NO_GAME_TRAINER, type GameTrainerPort } from '../trainer-port';
import { REALISTIC_WORLD_STORAGE_KEY } from '../world-preference';

import { GROUP_RIDE_STORAGE_KEY, GROUP_RIDE_UNAVAILABLE_TEXT } from './choice';
import type { GroupRideSession } from './ride-group';

/** What the wrapped seams saw, for one case. Reset before each. */
const seen = vi.hoisted(() => ({
  /** Every `GameSimulation` built, newest last: read, never called. */
  simulations: [] as Pick<GameSimulation, 'draftFactor' | 'state'>[],
  /** Every frame's scene input, in order. */
  frames: [] as Pick<SceneInput, 'raceBots' | 'steeredLateral' | 'botDistance' | 'state'>[],
  /** The group's session as the ride's newest step left it (#3307): read, never called. */
  session: undefined as GroupRideSession | undefined,
  /** Each cue the group's steps selected (#3306), and the frame whose steps selected it. */
  selected: [] as { readonly kind: CueKind; readonly frame: number }[],
  /** How many frames {@link frames} has run, for {@link selected}. */
  frame: 0,
}));

vi.mock('./ride-group', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ride-group')>();
  return {
    ...actual,
    stepGroupRideSession: (...args: Parameters<typeof actual.stepGroupRideSession>) => {
      seen.session = actual.stepGroupRideSession(...args);
      const cue = seen.session.cue;
      if (cue !== undefined && cue !== args[0].cue) {
        seen.selected.push({ kind: cue.kind, frame: seen.frame });
      }
      return seen.session;
    },
  };
});

vi.mock('../simulation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../simulation')>();
  class WatchedSimulation extends actual.GameSimulation {
    constructor(...args: ConstructorParameters<typeof actual.GameSimulation>) {
      super(...args);
      seen.simulations.push(this);
    }
  }
  return { ...actual, GameSimulation: WatchedSimulation };
});

vi.mock('../scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scene')>();
  return {
    ...actual,
    sceneFrame: (...args: Parameters<typeof actual.sceneFrame>) => {
      seen.frames.push(args[0]);
      return actual.sceneFrame(...args);
    },
  };
});

/** Five level kilometres of the rider's own: a road a group's plan is solved on. */
const ROUTE: RidableRoute = {
  id: 'route-level',
  name: 'Level',
  profile: northRoute(5_000, () => 0),
  attempts: 0,
};

/** A loop of about 250 m of the rider's own, where a lap race is offered and a group is not (#3369). */
const LOOP: RidableRoute = {
  id: 'route-loop',
  name: 'Loop',
  profile: circuitRoute(40, () => 0),
  attempts: 0,
};

/** A short level road with a finish, reached inside a minute: where the group ride ends. */
const SHORT: RidableRoute = {
  id: 'route-short',
  name: 'Short',
  profile: northRoute(300, () => 0),
  attempts: 0,
};

/** The power the rider holds: under the group's, so they sit on a wheel and do not ride off the front. */
const RIDER_WATTS = 120;

function sensors(live = true): GameSensors {
  return {
    rider: { power: watts(live ? RIDER_WATTS : 0), live, paired: true },
    cadence: { value: 90, live: true, paired: true },
    heartRate: { value: 140, live: true, paired: true },
  };
}

const renderer: GameRenderer = {
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

const FRAME_MS = 250;
let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let mounted: Mounted | undefined;
/** Every group fact the game handed the recording, frame by frame. */
let facts: GroupRideFact[];
/** Every solo draft the game handed the recording, frame by frame. */
let drafts: SoloDraftState[];

/** The game's port to the ride, keeping what it is handed. */
function ridePort(
  options: {
    readonly workout?: boolean;
    readonly autoPaused?: () => boolean;
    /** Whether the ride may stop with the screen off (#647); never unless said. */
    readonly mayStop?: () => boolean;
  } = {},
): GameTrainerPort {
  return {
    readTrainer: () =>
      options.workout === true ? { kind: 'workout', control: undefined } : NO_GAME_TRAINER,
    askForControlOnRide: () => Promise.resolve(),
    workoutRescue: () => undefined,
    recordingMayStop: options.mayStop ?? (() => false),
    gameRideEnded: () => undefined,
    soloDraftStepped: (draft) => {
      drafts.push(draft);
    },
    groupRideStepped: (fact) => {
      facts.push(fact);
    },
    ...(options.autoPaused === undefined ? {} : { recordingPaused: options.autoPaused }),
    rideMovingSeconds: () => undefined,
    // A recording begun at the press, as a game ride's is: the group's clock is tied to it.
    rideElapsedSeconds: () => 0,
    watchRide: () => () => undefined,
  };
}

beforeEach(() => {
  seen.simulations.length = 0;
  seen.frames.length = 0;
  seen.session = undefined;
  seen.selected.length = 0;
  seen.frame = 0;
  pending = [];
  nowMs = 1_000_000;
  facts = [];
  drafts = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  // Announcements silenced, so no reading speaks over a case.
  localStorage.setItem(
    ANNOUNCEMENTS_STORAGE_KEY,
    JSON.stringify({
      enabled: false,
      powerEverySeconds: 'never',
      distanceEvery: 'never',
      intervalLeadSeconds: 'never',
      climbLeadMetres: 'never',
    }),
  );
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  localStorage.clear();
  globalThis.location.hash = '';
  vi.unstubAllGlobals();
});

async function clickThrough(element: HTMLElement | undefined): Promise<void> {
  expect(element).toBeDefined();
  await act(async () => {
    element?.click();
    await Promise.resolve();
  });
  await settle();
}

const root = (): ParentNode => mounted?.container ?? document;

const toggle = (text: string): HTMLInputElement | undefined =>
  queryAll<HTMLInputElement>(root(), 'input[type="checkbox"]').find((input) =>
    (input.closest('label')?.textContent ?? '').includes(text),
  );

const groupSwitch = (): HTMLInputElement | undefined => toggle('Ride with a group');

const labelled = <T extends HTMLElement>(text: string): T | undefined => {
  const label = queryAll<HTMLLabelElement>(root(), 'label').find((each) =>
    (each.textContent ?? '').startsWith(text),
  );
  return label?.htmlFor === undefined || label.htmlFor === ''
    ? undefined
    : ((document.getElementById(label.htmlFor) as T | null) ?? undefined);
};

const speedBox = (): HTMLInputElement | undefined => labelled('Group average speed');
const sizeSelect = (): HTMLSelectElement | undefined => labelled('Riders in the group');

const rideButton = (): HTMLButtonElement | undefined =>
  queryAll<HTMLButtonElement>(root(), 'button').find((button) =>
    (button.textContent ?? '').startsWith('Ride '),
  );

/** The value a HUD field shows, by its label; `undefined` when the field is absent. */
function field(label: string): string | undefined {
  const term = queryAll(root(), 'dt').find((dt) => dt.textContent === label);
  return term === undefined ? undefined : (term.nextElementSibling?.textContent ?? '');
}

interface Setup {
  /** Switch the group ride on at the picker. Off leaves the switch as the device kept it. */
  readonly group?: boolean;
  readonly speed?: string;
  readonly size?: string;
  readonly port?: GameTrainerPort | undefined;
  /** The rider's readings on each frame; live at {@link RIDER_WATTS} unless said. */
  readonly read?: () => GameSensors;
  /** The route on the picker; {@link ROUTE} unless said. */
  readonly route?: RidableRoute;
  /** Props the shell or a test hands the screen, beside the picker. */
  readonly shell?: Pick<Parameters<typeof GameView>[0], 'roomId' | 'delivery' | 'lapRace'>;
  /** Where the ride's sounds go (#3306): the platform's no-op in jsdom unless said. */
  readonly sounds?: CueOutput;
}

async function open(setup: Setup = {}): Promise<void> {
  const port: GamePort = {
    listRoutes: () => Promise.resolve([setup.route ?? ROUTE]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: setup.read ?? (() => sensors()),
  };
  mounted = await mount(
    <GameView
      port={port}
      renderer={() => Promise.resolve(renderer)}
      {...(setup.port === undefined ? {} : { trainer: setup.port })}
      {...setup.shell}
      {...(setup.sounds === undefined ? {} : { sounds: setup.sounds })}
      now={() => nowMs}
    />,
  );
  await settle();
  if (setup.group === true) await clickThrough(groupSwitch());
  if (setup.speed !== undefined) {
    await typeInto(speedBox() as HTMLInputElement, setup.speed);
    await settle();
  }
  if (setup.size !== undefined) {
    await chooseOption(sizeSelect() as HTMLSelectElement, setup.size);
    await settle();
  }
}

/** Run `frames` quarter-second frames of the ride in progress; the draft factor after each. */
async function frames(count: number): Promise<number[]> {
  const factors: number[] = [];
  for (let frame = 0; frame < count; frame += 1) {
    // Every callback waiting: the ride's, and since #3307 the one poll the
    // HUD's gamepad reader makes as a group ride mounts it.
    const due = pending;
    if (due.length === 0) break;
    pending = [];
    nowMs += FRAME_MS;
    seen.frame += 1;
    await act(async () => {
      for (const next of due) next(nowMs);
      await Promise.resolve();
    });
    factors.push(seen.simulations.at(-1)?.draftFactor ?? Number.NaN);
  }
  return factors;
}

/** Open the picker, press *Ride*, and ride. */
async function ride(setup: Setup, count: number): Promise<number[]> {
  await open(setup);
  await clickThrough(rideButton());
  return frames(count);
}

const lastFrame = () => seen.frames.at(-1);

describe('a group ride started from Your ride puts the group in the ride — #3303', () => {
  it('drafts the rider on a wheel, draws the bots, and hands the ride its group and its draft', async () => {
    const factors = await ride({ group: true, port: ridePort() }, 80);
    // The simulation's own factor: alone at the press, sheltered once on a wheel.
    expect(factors).toHaveLength(80);
    expect(factors[0]).toBe(1);
    expect(Math.min(...factors)).toBeLessThan(0.7);
    expect(factors.at(-1)).toBeLessThan(1);
    // The HUD's Draft field reads the same draft, as on any drafted solo ride.
    expect(field('Draft')).toMatch(/^[1-9]\d? ?%/);
    // The frame draws the default five bots through the pack layout, and the
    // rider at their own odometer, in the line's lane.
    const frame = lastFrame();
    expect(frame?.raceBots).toHaveLength(5);
    expect(frame?.raceBots?.every((bot) => bot.laidOut === true)).toBe(true);
    expect(frame?.steeredLateral).toBe(0);
    // No pacer rides beside a group.
    expect(frame?.botDistance).toBeUndefined();
    const odometer = frame?.state.ride.distance ?? 0;
    for (const bot of frame?.raceBots ?? []) {
      expect(Math.abs(bot.distanceMetres - odometer)).toBeLessThan(60);
    }
    // The recording is handed the group: the default average and size, and a log.
    const fact = facts.at(-1);
    expect(fact?.bots).toBe(5);
    expect(fact?.targetSpeed).toBeCloseTo(30 / 3.6, 9);
    expect(Number.isSafeInteger(fact?.seed)).toBe(true);
    // Tied to the recording's timeline, which began at the press (the review of PR #3364).
    expect(fact?.startedAt).toBeLessThanOrEqual(0);
    expect(fact?.startedAt).toBeGreaterThan(-1);
    expect(fact?.log[0]).toMatchObject({ at: 0, phase: 'forming' });
    expect(fact?.log.some((entry) => entry.phase === 'steady')).toBe(true);
    // And the draft that marks the saved ride as drafted (ADR 0101 Q14).
    const draft = drafts.at(-1);
    expect(draft?.inDraft).toBe(true);
    expect(draft?.inDraftMetres ?? 0).toBeGreaterThan(0.1 * (draft?.riddenMetres ?? Infinity));
  });

  it('rides the same press without the switch alone: no draft, no bots, no group kept', async () => {
    const factors = await ride({ port: ridePort() }, 40);
    expect(new Set(factors)).toStrictEqual(new Set([1]));
    expect(seen.frames.length).toBeGreaterThan(0);
    expect(seen.frames.every((frame) => frame.raceBots === undefined)).toBe(true);
    expect(lastFrame()?.steeredLateral).toBeUndefined();
    expect(facts).toStrictEqual([]);
    expect(field('Draft')).toBeUndefined();
  });

  it('rides the average speed and the size the rider chose', async () => {
    await ride({ group: true, speed: '26', size: '3', port: ridePort() }, 12);
    expect(lastFrame()?.raceBots).toHaveLength(3);
    const fact = facts.at(-1);
    expect(fact?.bots).toBe(3);
    expect(fact?.targetSpeed).toBeCloseTo(26 / 3.6, 9);
  });

  it('is reached by a simulated ride, which has no trainer and records nothing', async () => {
    globalThis.location.hash = '#/game?simulate=120';
    const factors = await ride({ group: true, port: ridePort() }, 80);
    expect(Math.min(...factors)).toBeLessThan(0.7);
    expect(lastFrame()?.raceBots).toHaveLength(5);
    // A simulated ride is handed no port (`useSimulatedRide`), so nothing is kept of it.
    expect(facts).toStrictEqual([]);
    expect(drafts).toStrictEqual([]);
  });
});

describe('the line waits for a rider who has stopped — ADR 0101 D-4.4, D-6.11', () => {
  const phaseNow = (): string | undefined => facts.at(-1)?.log.at(-1)?.phase;

  it('rides on while the rider pedals with a live power reading', async () => {
    await ride({ group: true, port: ridePort({ autoPaused: () => false }) }, 40);
    expect(facts.at(-1)?.log.some((entry) => entry.phase === 'waiting')).toBe(false);
  });

  it('waits while the recording under the ride is paused: the recorder’s auto-pause', async () => {
    let paused = false;
    await ride({ group: true, port: ridePort({ autoPaused: () => paused }) }, 20);
    expect(phaseNow()).not.toBe('waiting');
    paused = true;
    await frames(12);
    expect(phaseNow()).toBe('waiting');
    // And rides again when it resumes.
    paused = false;
    await frames(12);
    expect(phaseNow()).not.toBe('waiting');
  });

  it('waits while the power reading is not live: sensor loss', async () => {
    let live = true;
    await ride({ group: true, port: ridePort(), read: () => sensors(live) }, 20);
    expect(phaseNow()).not.toBe('waiting');
    live = false;
    await frames(12);
    expect(phaseNow()).toBe('waiting');
  });
});

describe('the setup is remembered on the device — #3303', () => {
  it('reads back the switch, the speed and the size after a reload, on the picker and in the ride', async () => {
    await open({ group: true, speed: '27', size: '4' });
    expect(localStorage.getItem(GROUP_RIDE_STORAGE_KEY)).not.toBeNull();
    mounted?.unmount();
    mounted = undefined;

    // A reload: a new screen over the same device, which nobody has touched.
    await open({ port: ridePort() });
    expect(groupSwitch()?.checked).toBe(true);
    expect(speedBox()?.value).toBe('27');
    expect(sizeSelect()?.value).toBe('4');
    // And *Ride*, pressed as it stands, rides what was remembered.
    await clickThrough(rideButton());
    await frames(8);
    expect(lastFrame()?.raceBots).toHaveLength(4);
    expect(facts.at(-1)?.targetSpeed).toBeCloseTo(27 / 3.6, 9);
  });

  it('remembers the switch turned off again', async () => {
    await open({ group: true });
    await clickThrough(groupSwitch());
    mounted?.unmount();
    mounted = undefined;
    await open();
    expect(groupSwitch()?.checked).toBe(false);
    expect(speedBox()).toBeUndefined();
  });

  it('touches nothing on the device until the rider changes the setup', async () => {
    await open();
    expect(localStorage.getItem(GROUP_RIDE_STORAGE_KEY)).toBeNull();
  });
});

describe('one mode a ride', () => {
  /** Each switch turns the group off as it goes on, and is turned off as the group goes on. */
  async function expectEitherOr(other: string): Promise<void> {
    await clickThrough(toggle(other));
    expect(toggle(other)?.checked).toBe(true);
    await clickThrough(groupSwitch());
    expect(groupSwitch()?.checked).toBe(true);
    expect(toggle(other)?.checked).toBe(false);
    await clickThrough(toggle(other));
    expect(toggle(other)?.checked).toBe(true);
    expect(groupSwitch()?.checked).toBe(false);
    // And the device remembers the group switched off by it.
    expect(JSON.parse(localStorage.getItem(GROUP_RIDE_STORAGE_KEY) ?? '{}')).toMatchObject({
      on: false,
    });
  }

  it('the pacer or the group', async () => {
    await open();
    await expectEitherOr('Ride against a pacer');
  });

  it('a Delivery round or the group, in the realistic world', async () => {
    localStorage.setItem(REALISTIC_WORLD_STORAGE_KEY, 'on');
    await open();
    await expectEitherOr('Ride a Delivery round');
  });

  it('a course opened for a game starts with the group off, and forgets nothing', async () => {
    const kept = JSON.stringify({ on: true, targetSpeed: 30 / 3.6, bots: 5 });
    localStorage.setItem(GROUP_RIDE_STORAGE_KEY, kept);
    // A Delivery round, on a road the group is offered on: a loop is offered none (#3369).
    localStorage.setItem(REALISTIC_WORLD_STORAGE_KEY, 'on');
    globalThis.location.hash = '#/game?play=delivery';
    await open();
    expect(toggle('Ride a Delivery round')?.checked).toBe(true);
    expect(groupSwitch()?.disabled).toBe(false);
    expect(groupSwitch()?.checked).toBe(false);
    expect(localStorage.getItem(GROUP_RIDE_STORAGE_KEY)).toBe(kept);
  });

  it('rides no group in a room, whose road and draft are the room’s', async () => {
    await ride({ group: true, port: ridePort(), shell: { roomId: 'room-one' } }, 20);
    expect(seen.simulations).toHaveLength(1);
    expect(facts).toStrictEqual([]);
    expect(seen.frames.every((frame) => frame.raceBots === undefined)).toBe(true);
  });

  it('rides no group beside a Delivery round', async () => {
    await ride({ group: true, port: ridePort(), shell: { delivery: true } }, 20);
    expect(seen.simulations).toHaveLength(1);
    expect(facts).toStrictEqual([]);
    expect(seen.frames.every((frame) => frame.raceBots === undefined)).toBe(true);
  });

  it('rides no group beside a lap race', async () => {
    await ride(
      {
        group: true,
        route: LOOP,
        port: ridePort(),
        shell: { lapRace: { ...DEFAULT_LAP_RACE_CHOICE, bots: 2, itemsOn: false } },
      },
      // Past the race's 10 s countdown, during which nothing steps.
      60,
    );
    expect(seen.simulations).toHaveLength(1);
    expect(seen.simulations[0]?.state.ride.distance ?? 0).toBeGreaterThan(5);
    expect(facts).toStrictEqual([]);
    // The bots drawn are the race's two, not a group's five.
    expect(lastFrame()?.raceBots).toHaveLength(2);
  });
});

describe('what a group ride is not offered beside — ADR 0101 D-1.5', () => {
  it('a workout holding the trainer: the switch is off and disabled, and Ride rides no group', async () => {
    // The device remembers the switch on, from a ride before the workout began.
    localStorage.setItem(
      GROUP_RIDE_STORAGE_KEY,
      JSON.stringify({ on: true, targetSpeed: 30 / 3.6, bots: 5 }),
    );
    await open({ port: ridePort({ workout: true }) });
    expect(groupSwitch()?.disabled).toBe(true);
    expect(groupSwitch()?.checked).toBe(false);
    expect(speedBox()).toBeUndefined();
    expect(root().textContent).toContain(GROUP_RIDE_UNAVAILABLE_TEXT.workout);
    await clickThrough(rideButton());
    const factors = await frames(40);
    expect(factors.length).toBeGreaterThan(0);
    expect(new Set(factors)).toStrictEqual(new Set([1]));
    expect(seen.frames.every((frame) => frame.raceBots === undefined)).toBe(true);
    expect(facts).toStrictEqual([]);
  });

  it('a loop: the same, with its own sentence, because the plan is one pass (#3369)', async () => {
    localStorage.setItem(
      GROUP_RIDE_STORAGE_KEY,
      JSON.stringify({ on: true, targetSpeed: 30 / 3.6, bots: 5 }),
    );
    await open({ route: LOOP, port: ridePort() });
    expect(groupSwitch()?.disabled).toBe(true);
    expect(groupSwitch()?.checked).toBe(false);
    expect(speedBox()).toBeUndefined();
    expect(root().textContent).toContain(GROUP_RIDE_UNAVAILABLE_TEXT.loop);
    // The lap race is still offered on a loop, and is not switched off by the group.
    expect(toggle('Ride a lap race')?.disabled).toBe(false);
    await clickThrough(rideButton());
    const factors = await frames(40);
    expect(factors.length).toBeGreaterThan(0);
    expect(new Set(factors)).toStrictEqual(new Set([1]));
    expect(seen.frames.every((frame) => frame.raceBots === undefined)).toBe(true);
    expect(facts).toStrictEqual([]);
  });

  it('the draft switched off on this device: the same, with its own sentence', async () => {
    localStorage.setItem(SOLO_DRAFT_STORAGE_KEY, 'off');
    localStorage.setItem(
      GROUP_RIDE_STORAGE_KEY,
      JSON.stringify({ on: true, targetSpeed: 30 / 3.6, bots: 5 }),
    );
    await open({ port: ridePort() });
    expect(groupSwitch()?.disabled).toBe(true);
    expect(root().textContent).toContain(GROUP_RIDE_UNAVAILABLE_TEXT['draft-off']);
    await clickThrough(rideButton());
    await frames(20);
    expect(seen.frames.every((frame) => frame.raceBots === undefined)).toBe(true);
    expect(facts).toStrictEqual([]);
  });
});

describe('the group ride ends at the finish — the review of PR #3364', () => {
  it('rides in the line to the finish, and on alone past it: no draft, no bots, nothing more kept', async () => {
    const factors = await ride({ group: true, route: SHORT, port: ridePort() }, 240);
    const distances = seen.frames.map((frame) => frame.state.ride.distance);
    const finish = SHORT.profile.totalDistance;
    expect(distances.at(-1)).toBeGreaterThan(finish + 30);
    // The finish question is asked, and the ride runs on under it (*Keep riding*).
    expect(root().textContent).toContain('End ride');
    // In the line before the finish.
    const before = distances.findIndex((distance) => distance >= finish);
    expect(before).toBeGreaterThan(0);
    expect(Math.min(...factors.slice(0, before))).toBeLessThan(0.7);
    expect(seen.frames[before - 1]?.raceBots).toHaveLength(5);
    // Alone a frame after it, and from then on.
    const after = before + 2;
    expect(new Set(factors.slice(after))).toStrictEqual(new Set([1]));
    expect(seen.frames.slice(after).every((frame) => frame.raceBots === undefined)).toBe(true);
    // The fact the recording keeps is the one the group ended with.
    const kept = facts.length;
    expect(kept).toBeGreaterThan(0);
    await frames(20);
    expect(facts).toHaveLength(kept);
  });
});

describe('a group the setup cannot make blocks the ride', () => {
  it('says the most the group can average on the route, and starts nothing', async () => {
    await open({ group: true, speed: '90', port: ridePort() });
    const problem = queryAll(root(), '[role="alert"]').find((alert) =>
      (alert.textContent ?? '').startsWith('The group cannot average 90 km/h on this route.'),
    );
    expect(problem).toBeDefined();
    expect(rideButton()?.getAttribute('aria-describedby')).toContain(problem?.id);
    await clickThrough(rideButton());
    expect(seen.simulations).toHaveLength(0);
    expect(rideButton()).toBeDefined();
    // Corrected, the same press rides.
    await typeInto(speedBox() as HTMLInputElement, '30');
    await settle();
    await clickThrough(rideButton());
    await frames(8);
    expect(lastFrame()?.raceBots).toHaveLength(5);
  });
});

describe('a whole group ride with no network — ADR 0101 D-1.2', () => {
  it('rides in the line’s draft with every network primitive refused and no instance port', async () => {
    const refuse = (name: string) =>
      function refused(): never {
        throw new Error(`a group ride reached for ${name}`);
      };
    vi.stubGlobal('fetch', refuse('fetch'));
    vi.stubGlobal('XMLHttpRequest', refuse('XMLHttpRequest'));
    vi.stubGlobal('WebSocket', refuse('WebSocket'));
    vi.stubGlobal('EventSource', refuse('EventSource'));
    // No `tactics`, `aiPacer`, `room` or `rooms` port is handed: there is no instance.
    const factors = await ride({ group: true, port: ridePort() }, 80);
    expect(Math.min(...factors)).toBeLessThan(0.7);
    expect(lastFrame()?.raceBots).toHaveLength(5);
    expect(facts.at(-1)?.log.length ?? 0).toBeGreaterThan(1);
  });
});

describe('the group on the HUD: the role strip and the cue line — #3305', () => {
  /** The cue line as the HUD draws it, label and sentence; `undefined` with none drawn. */
  const cueLine = (): string | undefined => {
    const line = queryAll(root(), '.oyl-hud__pacer-say')[0];
    return line === undefined ? undefined : (line.textContent ?? '').replace(/\s+/g, ' ').trim();
  };
  /** The HUD's one live region, as a screen reader reads it. */
  const region = (): string =>
    (queryAll(root(), '[data-oyl-announcer="hud"]')[0]?.textContent ?? '').trim();

  const REGROUP = 'The group is easing until you are back.';
  const announcementsOn = (): void => {
    localStorage.setItem(
      ANNOUNCEMENTS_STORAGE_KEY,
      JSON.stringify({
        enabled: true,
        powerEverySeconds: 'never',
        distanceEvery: 'never',
        intervalLeadSeconds: 'never',
        climbLeadMetres: 'never',
      }),
    );
  };

  it('shows the place in the line, the gap, the group’s speed now and the average chosen', async () => {
    await ride({ group: true, port: ridePort() }, 20);
    // The rider starts on the last wheel behind the default five bots.
    expect(field('In line')).toMatch(/^6 of 6 Gap \d+\.\d m$/);
    expect(field('Group')).toMatch(/^\d+ km\/h Target average 30$/);
    // No cue yet, and no countdown off the front.
    expect(cueLine()).toBeUndefined();
    expect(field('In line')).not.toContain('Pull');
  });

  it('shows neither on the same ride without the group', async () => {
    await ride({ port: ridePort() }, 20);
    expect(field('In line')).toBeUndefined();
    expect(field('Group')).toBeUndefined();
    expect(cueLine()).toBeUndefined();
  });

  it('puts a cue on the line when it is selected, says it once in the live region, and clears it after its shown time', async () => {
    announcementsOn();
    let paused = false;
    await ride({ group: true, port: ridePort({ autoPaused: () => paused }) }, 20);
    expect(cueLine()).toBeUndefined();
    expect(region()).toBe('');
    // The line begins waiting: the regroup cue.
    paused = true;
    await frames(4);
    expect(cueLine()).toBe(`iGroup ride: ${REGROUP}`);
    expect(region()).toBe(REGROUP);
    paused = false;
    // Whatever the ride cues next, the line is empty again within two shown
    // times of quarter-second frames, and each sentence heard was a cue's.
    const heard = new Set<string>([region()]);
    let emptied = false;
    for (let frame = 0; frame < 80 && !emptied; frame += 1) {
      await frames(1);
      heard.add(region());
      emptied = cueLine() === undefined;
    }
    expect(emptied).toBe(true);
    expect([...heard].every((sentence) => !/\d/.test(sentence))).toBe(true);
  });

  it('shows the cue with announcements off, and says nothing', async () => {
    let paused = false;
    await ride({ group: true, port: ridePort({ autoPaused: () => paused }) }, 20);
    paused = true;
    await frames(4);
    expect(cueLine()).toBe(`iGroup ride: ${REGROUP}`);
    expect(region()).toBe('');
  });

  it('with no power reading shows dashes on the strip and no cue: the line waits in silence', async () => {
    let live = true;
    await ride({ group: true, port: ridePort(), read: () => sensors(live) }, 20);
    live = false;
    await frames(12);
    expect(facts.at(-1)?.log.at(-1)?.phase).toBe('waiting');
    expect(field('In line')).toMatch(/^— of 6/);
    expect(field('Group')).toMatch(/^— km\/h/);
    expect(field('In line')).not.toMatch(/\d+ of|Gap|Pull/);
    expect(cueLine()).toBeUndefined();
  });
});

/**
 * **The pull-off press and the sit-in choice, through the ride** — #3307,
 * ADR 0101 D-3.7. The named failure is an input the HUD takes and the line
 * never hears: a button, a key and a pad that end no pull.
 *
 * The rider here holds a wheel, which a rider at one power cannot (they have
 * no brake, and drift through the line): each frame's power is chosen from
 * the group's own session as the ride's newest step left it, read by wrapping
 * the real `stepGroupRideSession` and calling nothing on it. A wheel gap
 * behind the member ahead in the line; on the front, the group's speed now,
 * so the rider never fades and only a press can end the pull early.
 */
describe('the pull-off press and the sit-in choice reach the line — #3307', () => {
  /** What `navigator.getGamepads()` lists now. */
  let pads: (PadSnapshot | null)[] = [];

  beforeEach(() => {
    pads = [];
    Object.defineProperty(window.navigator, 'getGamepads', {
      configurable: true,
      value: () => pads,
    });
    // One line for every case: the seed `ride-group.ts` draws at the press.
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
      <T extends ArrayBufferView>(array: T): T => {
        (array as unknown as Uint32Array)[0] = 7;
        return array;
      },
    );
  });

  afterEach(() => {
    Reflect.deleteProperty(window.navigator, 'getGamepads');
    vi.restoreAllMocks();
  });

  /** The power that holds the wheel, from the line as the newest step left it. */
  function holdingWatts(): number {
    const session = seen.session;
    if (session === undefined) return RIDER_WATTS;
    const { order } = session.state.rotation;
    const seat = order.indexOf('rider');
    const wheelId = seat === 0 ? undefined : seat > 0 ? order[seat - 1] : order[order.length - 1];
    const wheel = wheelId === undefined ? undefined : session.state.bots[wheelId];
    const { distanceM, speedMps } = session.rider;
    const asked =
      wheel === undefined
        ? 180 + 400 * (session.groupSpeedMps - speedMps)
        : 110 +
          60 * (wheel.distanceM - BOT_TACTIC_WHEEL_GAP_METRES - distanceM) +
          250 * (wheel.speedMps - speedMps);
    return Math.max(0, Math.min(500, asked));
  }

  const holding = (): GameSensors => ({
    rider: { power: watts(holdingWatts()), live: true, paired: true },
    cadence: { value: 90, live: true, paired: true },
    heartRate: { value: 140, live: true, paired: true },
  });

  /** One quarter-second frame: every callback waiting, the ride's and the pad's poll. */
  async function pump(): Promise<void> {
    const due = pending;
    if (due.length === 0) throw new Error('the ride asked for no frame');
    pending = [];
    nowMs += FRAME_MS;
    seen.frame += 1;
    await act(async () => {
      for (const callback of due) callback(nowMs);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  const hudButton = (name: string): HTMLButtonElement | undefined =>
    queryAll<HTMLButtonElement>(root(), 'button').find((button) => button.textContent === name);

  async function pressKey(init: KeyboardEventInit): Promise<void> {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { cancelable: true, ...init }));
      await Promise.resolve();
    });
  }

  /** What the ride keeps of the line: its newest phase and role, as the recording was handed them. */
  const kept = () => facts.at(-1)?.log.at(-1);

  /**
   * Start a group of three bots and ride, holding the wheel, until the rider
   * is on the front of a steady line; `each` runs before every frame on the
   * way. Returns the log the recording had been handed by then.
   */
  async function rideToTheFront(each: () => Promise<void> = () => Promise.resolve()) {
    await open({ group: true, size: '3', port: ridePort(), read: holding });
    await clickThrough(rideButton());
    for (let frame = 0; frame < 1_600; frame += 1) {
      if (seen.session?.role === 'on-front' && seen.session.phase === 'steady') {
        return facts.at(-1)?.log ?? [];
      }
      await each();
      await pump();
    }
    throw new Error(`the rider never reached the front: ${JSON.stringify(kept())}`);
  }

  /** Six frames, a second and a half: one decision window, and the frame that hands it the press. */
  async function aWindowOn(): Promise<void> {
    for (let frame = 0; frame < 6; frame += 1) await pump();
  }

  function expectPulledOff(): void {
    // The line itself: changing, the rider aside and drifting back.
    expect(seen.session?.phase).toBe('changing');
    expect(seen.session?.role).toBe('drifting-back');
    expect(seen.session?.state.rotation.aside).toBe('rider');
    // What the recording is handed says the same, and keeps the press, once.
    expect(kept()).toMatchObject({ phase: 'changing', role: 'drifting-back' });
    expect(facts.at(-1)?.presses?.map((each) => each.press)).toStrictEqual(['pull-off']);
    // The rider is drawn a lane to their left, and the button is unavailable again.
    expect(lastFrame()?.steeredLateral).toBe(LANE_OFFSETS_METRES[0]);
    expect(hudButton(PULL_OFF_BUTTON_LABEL)?.getAttribute('aria-disabled')).toBe('true');
  }

  /**
   * The log an unpressed ride to the front was handed, kept by the control
   * case for the lane-key case to compare with. Every ride here starts from
   * the same seed, clock and readings, so the two cases' unpressed rides are
   * one ride; riding it twice in the lane-key case ran it past Vitest's 5 s
   * on CI (#3391). A copy, so the control's later frames cannot reach it.
   */
  let unpressedLog: Awaited<ReturnType<typeof rideToTheFront>> | undefined;

  /** The unpressed ride's log: the control case's, or ridden here when the case runs alone. */
  async function unpressedRide(): Promise<Awaited<ReturnType<typeof rideToTheFront>>> {
    if (unpressedLog !== undefined) return unpressedLog;
    const log = structuredClone(await rideToTheFront());
    mounted?.unmount();
    mounted = undefined;
    facts = [];
    seen.session = undefined;
    seen.frames.length = 0;
    nowMs = 1_000_000;
    // The picker as a first visit finds it, so the switch is pressed on again.
    localStorage.removeItem(GROUP_RIDE_STORAGE_KEY);
    return log;
  }

  it('leaves a rider who presses nothing on the front: the control for the three below', async () => {
    unpressedLog = structuredClone(await rideToTheFront());
    // On the front the button is available, and the rider is drawn in the line's lane.
    expect(hudButton(PULL_OFF_BUTTON_LABEL)?.hasAttribute('aria-disabled')).toBe(false);
    await aWindowOn();
    expect(seen.session?.phase).toBe('steady');
    expect(seen.session?.role).toBe('on-front');
    expect(kept()).toMatchObject({ phase: 'steady', role: 'on-front' });
    expect(lastFrame()?.steeredLateral).toBe(0);
    expect(facts.at(-1)?.presses).toBeUndefined();
  });

  it('ends the pull on the lane key toward the pull-off side, and hears no key off the front', async () => {
    const unpressed = await unpressedRide();
    // The same line again, the key pressed before every frame in every role but on-front…
    const roles = new Set<string>();
    const pressed = await rideToTheFront(() => {
      const role = seen.session?.role ?? 'last-wheel';
      if (role === 'on-front') return Promise.resolve();
      roles.add(role);
      return pressKey({ key: 'a' });
    });
    // …is the unpressed ride: no rotation started, no order changed, the lane never moved.
    expect(roles.has('second-wheel')).toBe(true);
    expect(pressed.length).toBeGreaterThan(4);
    expect(pressed).toStrictEqual(unpressed);
    expect(seen.frames.every((frame) => (frame.steeredLateral ?? 0) === 0)).toBe(true);

    // Held on the front: one press, and its repeats.
    await pressKey({ key: 'a' });
    for (let repeat = 0; repeat < 20; repeat += 1) await pressKey({ key: 'a', repeat: true });
    await aWindowOn();
    expectPulledOff();
  });

  it('ends the pull on the HUD’s button, pressed 20 times', async () => {
    await rideToTheFront();
    for (let press = 0; press < 20; press += 1) {
      await act(async () => {
        hudButton(PULL_OFF_BUTTON_LABEL)?.click();
        await Promise.resolve();
      });
    }
    await aWindowOn();
    expectPulledOff();
  });

  it('ends the pull on a gamepad’s button', async () => {
    await rideToTheFront();
    // A standard pad's A, the button a lap race uses its item on.
    pads = [
      {
        connected: true,
        mapping: 'standard',
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: index === 0 })),
      },
    ];
    await act(async () => {
      window.dispatchEvent(new Event('gamepadconnected'));
      await Promise.resolve();
    });
    await aWindowOn();
    expectPulledOff();
  });

  it('sits the rider in from the HUD’s toggle, and takes them out of it again', async () => {
    await open({ group: true, size: '3', port: ridePort(), read: holding });
    await clickThrough(rideButton());
    for (let frame = 0; frame < 8; frame += 1) await pump();
    expect(seen.session?.sittingIn).toBe(false);
    expect(hudButton(SIT_IN_BUTTON_LABEL)?.getAttribute('aria-pressed')).toBe('false');

    await clickThrough(hudButton(SIT_IN_BUTTON_LABEL));
    // Drawn at once, before the ride's next frame.
    expect(hudButton(SIT_IN_BUTTON_LABEL)?.getAttribute('aria-pressed')).toBe('true');
    for (let frame = 0; frame < 8; frame += 1) await pump();
    // The line heard it: the rider's role is the choice's, and the recording is handed it.
    expect(seen.session?.sittingIn).toBe(true);
    expect(seen.session?.role).toBe('sitting-in');
    expect(kept()?.role).toBe('sitting-in');

    await clickThrough(hudButton(SIT_IN_BUTTON_LABEL));
    expect(hudButton(SIT_IN_BUTTON_LABEL)?.getAttribute('aria-pressed')).toBe('false');
    for (let frame = 0; frame < 8; frame += 1) await pump();
    expect(seen.session?.role).not.toBe('sitting-in');
    expect(kept()?.role).not.toBe('sitting-in');
    // Both choices are kept with the ride, in order, each at its ride time:
    // eight frames a choice, and the ride's first frame runs no step.
    expect(facts.at(-1)?.presses).toStrictEqual([
      { at: 1.75, press: 'sit-in' },
      { at: 3.75, press: 'sit-out' },
    ]);
  });

  it('shows neither control on a ride with no group', async () => {
    await ride({ port: ridePort() }, 8);
    expect(hudButton('End ride')).toBeDefined();
    expect(hudButton(PULL_OFF_BUTTON_LABEL)).toBeUndefined();
    expect(hudButton(SIT_IN_BUTTON_LABEL)).toBeUndefined();
  });
});

/**
 * **A distinct sound for each cue kind, through the ride** — #3306, ADR 0101
 * D-5. The real `GameView`, the real *Ride*, and the port double of
 * `audio-testing.ts` handed in as the ride's sounds, read against every cue
 * the group's real steps selected (by wrapping `stepGroupRideSession` and
 * calling nothing on it). `cue-sounds.test.ts` holds the table, the notes, a
 * scripted rotation and the quiet mark.
 *
 * A cue selected by one frame's steps is offered on the next frame, where its
 * sentence goes to the announcer and its sound to the port; so the sounds
 * owed after a run are those of every cue selected before its last frame.
 */
describe('the group ride’s cue sounds through the ride — #3306', () => {
  const soundsOn = (muted = false): void => {
    localStorage.setItem(CUES_STORAGE_KEY, JSON.stringify({ enabled: true, volume: 0.5, muted }));
  };
  const groupSounds = (calls: readonly RecordedCall[]): string[] =>
    calls.flatMap((call) =>
      call.kind === 'playCue' && call.cue.startsWith('group-') ? [call.cue] : [],
    );
  /** Leave the ride: the screen unmounts, as the ride's end releases its sounds. */
  const leave = (): void => {
    mounted?.unmount();
    mounted = undefined;
  };
  const owed = (): string[] =>
    seen.selected
      .filter((each) => each.frame < seen.frame)
      .map((each) => GROUP_RIDE_CUE_SOUND[each.kind]);

  /** A ride that cues: on a wheel, then the recorder auto-paused so the line waits, then on again. */
  async function cuedRide(setup: Setup): Promise<void> {
    let paused = false;
    await ride({ group: true, port: ridePort({ autoPaused: () => paused }), ...setup }, 20);
    paused = true;
    await frames(8);
    paused = false;
    await frames(80);
  }

  it('plays one sound per selected cue, in order, each its kind’s, with announcements off', async () => {
    soundsOn();
    const output = recordingOutput();
    await cuedRide({ sounds: output });
    // More than one kind, so the order is a claim.
    expect(new Set(seen.selected.map((each) => each.kind)).size).toBeGreaterThanOrEqual(2);
    expect(owed().length).toBeGreaterThanOrEqual(2);
    // Announcements are off (beforeEach): no sentence is said, and every sound plays.
    expect(groupSounds(output.calls)).toEqual(owed());
    expect(
      output.calls.every((call) => call.kind !== 'playCue' || call.gain === RIDE_CUE_LEVEL),
    ).toBe(true);
  });

  it('with sounds off: zero calls on the port across a ride that cues', async () => {
    const output = recordingOutput();
    await cuedRide({ sounds: output });
    expect(owed().length).toBeGreaterThan(0);
    expect(output.calls).toEqual([]);
  });

  it('muted: nothing on the port after the press’s own resume', async () => {
    soundsOn(true);
    const output = recordingOutput();
    await cuedRide({ sounds: output });
    expect(owed().length).toBeGreaterThan(0);
    expect(output.calls).toEqual([{ kind: 'resume' }]);
  });

  it('the ride not started: zero calls, with the group and the sounds on at the picker', async () => {
    soundsOn();
    const output = recordingOutput();
    await open({ group: true, port: ridePort(), sounds: output });
    await frames(40);
    expect(output.calls).toEqual([]);
  });

  it('no power reading: no cue is selected and no sound plays while it is gone', async () => {
    soundsOn();
    const output = recordingOutput();
    let live = true;
    await ride({ group: true, port: ridePort(), read: () => sensors(live), sounds: output }, 20);
    live = false;
    const lostAt = { calls: output.calls.length, selected: seen.selected.length };
    await frames(80);
    expect(facts.at(-1)?.log.at(-1)?.phase).toBe('waiting');
    expect(seen.selected.slice(lostAt.selected)).toEqual([]);
    expect(output.calls.slice(lostAt.calls)).toEqual([]);
  });

  it('plays a cue’s sound when a higher-ranked sentence takes its window, and the sentence is dropped', async () => {
    localStorage.setItem(
      ANNOUNCEMENTS_STORAGE_KEY,
      JSON.stringify({
        enabled: true,
        powerEverySeconds: 'never',
        distanceEvery: 'never',
        intervalLeadSeconds: 'never',
        climbLeadMetres: 'never',
      }),
    );
    soundsOn();
    const output = recordingOutput();
    let paused = false;
    // "The ride may stop with the screen off" (rank 5b, above the cue's 5d′)
    // becomes due on the very frame the regroup cue is offered: the frame
    // after the steps that selected it.
    const port = ridePort({
      autoPaused: () => paused,
      mayStop: () => seen.session?.cue?.kind === 'regroup',
    });
    await ride({ group: true, port, sounds: output }, 20);
    paused = true;
    let frame = 0;
    while (!groupSounds(output.calls).includes('group-regroup') && frame < 20) {
      await frames(1);
      frame += 1;
    }
    expect(groupSounds(output.calls)).toEqual(['group-regroup']);
    const region = (): string =>
      (queryAll(root(), '[data-oyl-announcer="hud"]')[0]?.textContent ?? '').trim();
    const cueLine = (): string =>
      (queryAll(root(), '.oyl-hud__pacer-say')[0]?.textContent ?? '').replace(/\s+/g, ' ').trim();
    expect(region()).toBe(RIDE_MAY_STOP_SPOKEN);
    expect(cueLine()).toBe('iGroup ride: The group is easing until you are back.');
    // Dropped, not queued: the regroup sentence never reaches the region.
    for (let more = 0; more < 20; more += 1) {
      await frames(1);
      expect(region()).not.toContain('The group is easing');
    }
  });

  it('leaves the port’s other calls as they are: the same ride without the group makes the same ones', async () => {
    soundsOn();
    const withGroup = recordingOutput();
    await cuedRide({ sounds: withGroup });
    expect(groupSounds(withGroup.calls).length).toBeGreaterThan(0);
    leave();
    pending = [];
    nowMs = 1_000_000;
    // The device remembers the switch: forget it, so this ride rides alone.
    localStorage.removeItem(GROUP_RIDE_STORAGE_KEY);
    const alone = recordingOutput();
    let paused = false;
    await ride({ port: ridePort({ autoPaused: () => paused }), sounds: alone }, 20);
    paused = true;
    await frames(8);
    paused = false;
    await frames(80);
    expect(field('In line'), 'the second ride rode with no group').toBeUndefined();
    // Both rides left, so each one's end is in its calls too.
    leave();
    const others = (calls: readonly RecordedCall[]): RecordedCall[] =>
      calls.filter((call) => call.kind !== 'playCue' || !call.cue.startsWith('group-'));
    expect(others(withGroup.calls)).toEqual(others(alone.calls));
    expect(groupSounds(alone.calls)).toEqual([]);
    // No tone on either: a ride with no workout holds no target.
    expect(withGroup.count('startTone')).toBe(0);
  });
});
