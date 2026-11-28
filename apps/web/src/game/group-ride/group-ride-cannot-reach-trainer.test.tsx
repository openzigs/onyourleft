// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **A group ride reaches no trainer write** — the `group-ride-cannot-reach-trainer`
 * gate of ADR 0101 D-6.6 and the owner's ruling 4 of 2026-11-26. **Its
 * first case is #3303's and the presses are #3307's; #3308 completes it**
 * (ERG, the worst case, the release through the Ride screen) and names it in
 * `docs/agents/game.md` beside the others.
 *
 * ## The first case: simulation mode, write for write
 *
 * A draft changes WHEN a grade arrives, never WHAT is sent (ADR 0067 D-3.3):
 * a sheltered rider reaches the next rise sooner. So a ride with the group is
 * not compared with a ride alone, whose grades arrive later. It is compared
 * with **the same ride at the same draft factors without the group**:
 *
 * 1. **With the group.** The real picker, *Ride with a group* switched on,
 *    the real *Ride*, a ready trainer through the real `gameTrainerPortOver`.
 *    Every factor `GameView` hands `GameSimulation.draftWith` is kept, in
 *    order, by wrapping the real class.
 * 2. **Without it, at those factors.** The same picker with the switch left
 *    off, the same power on the same frames. `GameView` hands this ride no
 *    draft at all, so the wrapped class hands it the kept factors, one after
 *    each frame whose steps ran, which is when the first ride was handed them.
 * 3. **Alone**, with neither, to show that the factors matter: its writes
 *    differ, so the equality above is not two rides that never drafted.
 *
 * **Every write of 1 equals the write of 2 at the same place in the order**:
 * each Set Indoor Bike Simulation Parameters the gradient session sent, and
 * the release when the ride is left. The group stepped, rotated, waited and
 * was drawn through the whole of 1, and not a write moved.
 *
 * ## The presses (#3307, ADR 0101 D-6.5)
 *
 * The pull-off press and the sit-in choice are inputs to the rotation and to
 * a drawing. A fourth ride, **pressed**, holds a wheel (its power chosen each
 * frame from the line, kept frame by frame), presses pull off before every
 * frame by the lane key and by the HUD's button in turn, takes a pull and
 * ends it by a press, toggles sit-in on and off, eases off the back so the
 * line waits, and comes back. A pull-off and a sat-out turn both change the
 * rider's shelter, so, as above, it is compared with **the same power on the
 * same frames at the same draft factors, with no group and so no press**:
 * every write equal, in order, the release included. The second case of its
 * block shows the presses bit, so the equality is not two rides in which
 * nothing was pressed.
 *
 * The existing gates (`draft-cannot-reach-trainer.test.tsx`,
 * `solo-draft-cannot-reach-trainer.test.tsx`,
 * `lap-race/lap-race-cannot-reach-trainer.test.ts`) are kept green unmodified.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BOT_TACTIC_WHEEL_GAP_METRES, watts } from '@onyourleft/domain';
import type { SimulationParameters } from '@onyourleft/sensors/protocol';

import { chooseOption, mount, queryAll, settle, type Mounted } from '../../testing/mount';
import { GameView, type GamePort, type RidableRoute } from '../GameView';
import { ANNOUNCEMENTS_STORAGE_KEY } from '../hud/announce-preference';
import { PULL_OFF_BUTTON_LABEL, SIT_IN_BUTTON_LABEL } from '../hud/GroupRideControls';
import type { GameRenderer } from '../port';
import { northRoute } from '../route-fixtures-testing';
import { gameTrainerPortOver, type GameTrainerPort, type GradientTrainer } from '../trainer-port';

import type { GroupRideSession } from './ride-group';

/** What the wrapped simulation kept and was told to replay, for one ride. */
const seen = vi.hoisted(() => ({
  /** Every factor the ride handed `draftWith`, in order. */
  given: [] as number[],
  /** Factors to hand a ride that is handed none, or `undefined` to hand nothing. */
  replay: undefined as readonly number[] | undefined,
  replayed: 0,
  /** The newest simulation's odometer, read after each frame. */
  odometer: () => Number.NaN,
  /** The group's session as the ride's newest step left it (#3307): read, never called. */
  session: undefined as GroupRideSession | undefined,
}));

vi.mock('./ride-group', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ride-group')>();
  return {
    ...actual,
    stepGroupRideSession: (...args: Parameters<typeof actual.stepGroupRideSession>) => {
      seen.session = actual.stepGroupRideSession(...args);
      return seen.session;
    },
  };
});

vi.mock('../simulation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../simulation')>();
  class WatchedSimulation extends actual.GameSimulation {
    constructor(...args: ConstructorParameters<typeof actual.GameSimulation>) {
      super(...args);
      seen.odometer = () => this.state.ride.distance;
    }

    override draftWith(k: number): void {
      seen.given.push(k);
      super.draftWith(k);
    }

    override advanceTo(
      ...args: Parameters<InstanceType<typeof actual.GameSimulation>['advanceTo']>
    ) {
      const tick = super.advanceTo(...args);
      // A ride with no group is handed no draft by `GameView`: hand it the
      // kept one where the grouped ride was handed its own, after a frame
      // whose steps ran, to be ridden from the next step on.
      if (seen.replay !== undefined && tick.steps > 0) {
        const k = seen.replay[seen.replayed];
        seen.replayed += 1;
        if (k !== undefined) super.draftWith(k);
      }
      return tick;
    }
  }
  return { ...actual, GameSimulation: WatchedSimulation };
});

/** A rolling road of the rider's own: 3 m up and down every 300 m, so the grade the trainer is sent keeps changing. */
const ROUTE: RidableRoute = {
  id: 'route-rolling',
  name: 'Rolling',
  profile: northRoute(4_000, (along) => 3 * Math.sin((along / 300) * Math.PI * 2)),
  attempts: 0,
};

/** The power the rider holds on the frame being ridden: 150 W unless a ride scripts it (#3307). */
let powerNow = 150;

const port: GamePort = {
  listRoutes: () => Promise.resolve([ROUTE]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(powerNow), live: true, paired: true },
    cadence: { value: 90, live: true, paired: true },
    heartRate: { value: 140, live: true, paired: true },
  }),
};

/** A view with no drawing context (#2524): the frame is built once and the ride is ridden in full. */
const renderer: GameRenderer = {
  loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
  create: () => ({
    hasContext: false,
    prepare: () => Promise.resolve(),
    render: () => undefined,
    setQuality: () => undefined,
    setRiderKit: () => undefined,
    setSeason: () => undefined,
    resize: () => undefined,
    destroy: () => undefined,
  }),
};

/** One thing the trainer was sent. */
type Write =
  | { readonly kind: 'simulation'; readonly parameters: SimulationParameters }
  | { readonly kind: 'release' };

/** A ready trainer in simulation mode through the real `gameTrainerPortOver`, keeping everything it is sent. */
function writingTrainer(written: Write[]): GameTrainerPort {
  const control: GradientTrainer = {
    setSimulationParameters: (parameters) => {
      written.push({ kind: 'simulation', parameters });
      return Promise.resolve();
    },
    letGo: () => {
      written.push({ kind: 'release' });
      return Promise.resolve({ kind: 'stopped' as const });
    },
  };
  return gameTrainerPortOver({
    getSnapshot: () => ({
      trainer: { paired: true, controllable: true, canSimulate: true, hasControl: true },
      workout: undefined,
    }),
    simulationControl: () => control,
    requestTrainerControl: () => Promise.resolve(),
    noteGameRideEnded: () => undefined,
    subscribe: () => () => undefined,
  });
}

const FRAME_MS = 250;
/** Sixty seconds: the rider crosses a rise and a fall of the road. */
const FRAMES = 240;
let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let mounted: Mounted | undefined;

beforeEach(() => {
  pending = [];
  nowMs = 1_000_000;
  powerNow = 150;
  seen.session = undefined;
  seen.given = [];
  seen.replay = undefined;
  seen.replayed = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
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

/**
 * One quarter-second frame: every callback waiting. The ride's own, and,
 * since #3307, the one poll the HUD's gamepad reader makes as a group ride
 * mounts it (it finds no pad and asks for no more), which would otherwise be
 * handed a frame of the ride's.
 */
async function oneFrame(frame: number): Promise<void> {
  const due = pending;
  if (due.length === 0) throw new Error(`the ride stopped asking for frames at ${String(frame)}`);
  pending = [];
  nowMs += FRAME_MS;
  await act(async () => {
    for (const next of due) next(nowMs);
    await Promise.resolve();
    await Promise.resolve();
  });
}

interface Run {
  /** Everything the trainer was sent, in order, the release included. */
  readonly written: readonly Write[];
  /** Every factor the ride itself handed the simulation. */
  readonly given: readonly number[];
  /** Where the rider was when the ride was left, metres. */
  readonly distance: number;
}

/** Ride {@link FRAMES} frames from the real picker and leave; `replay` hands a groupless ride these factors. */
async function rideWith(group: boolean, replay?: readonly number[]): Promise<Run> {
  seen.given = [];
  seen.replay = replay;
  seen.replayed = 0;
  const written: Write[] = [];
  mounted = await mount(
    <GameView
      port={port}
      renderer={() => Promise.resolve(renderer)}
      trainer={writingTrainer(written)}
      now={() => nowMs}
    />,
  );
  await settle();
  if (group) {
    await clickThrough(
      queryAll<HTMLInputElement>(mounted.container, 'input[type="checkbox"]').find((input) =>
        (input.closest('label')?.textContent ?? '').includes('Ride with a group'),
      ),
    );
  }
  await clickThrough(
    queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    ),
  );
  for (let frame = 0; frame < FRAMES; frame += 1) await oneFrame(frame);
  await settle();
  const distance = seen.odometer();
  const given = [...seen.given];
  // Leaving the ride releases the trainer, as any game ride does.
  mounted.unmount();
  mounted = undefined;
  await settle();
  return { written: [...written], given, distance };
}

/**
 * Each ride, ridden once by the first case that asks for it and read by every
 * case after, so a case pays for one ride (#1688's ruling: a slow case is
 * made cheaper, never given a longer timeout).
 */
const runs = new Map<string, Promise<Run>>();
function ridden(name: 'grouped' | 'replayed' | 'alone'): Promise<Run> {
  let run = runs.get(name);
  if (run === undefined) {
    run =
      name === 'grouped'
        ? rideWith(true)
        : name === 'alone'
          ? rideWith(false)
          : ridden('grouped').then((grouped) => rideWith(false, grouped.given));
    runs.set(name, run);
    run.catch(() => runs.delete(name));
  }
  return run;
}

const grades = (run: Run): number[] =>
  run.written.flatMap((write) => (write.kind === 'simulation' ? [write.parameters.grade] : []));

describe('a group ride reaches no trainer write in simulation mode — #3303, ADR 0101 D-6.6', () => {
  it('rides with the group: the rider is sheltered, and the trainer is sent the road', async () => {
    const grouped = await ridden('grouped');
    // The rider WAS drafted, so nothing below can pass because the group never took effect.
    expect(grouped.given.length).toBeGreaterThan(FRAMES / 2);
    expect(Math.min(...grouped.given)).toBeLessThan(0.7);
    // And the trainer was sent a road that rises and falls, many times over.
    const sent = grades(grouped);
    expect(sent.length).toBeGreaterThan(15);
    expect(Math.max(...sent)).toBeGreaterThan(2);
    expect(Math.min(...sent)).toBeLessThan(-2);
  });

  it('rides alone: no factor is handed, the rider is slower, and the grades arrive differently', async () => {
    const grouped = await ridden('grouped');
    const alone = await ridden('alone');
    expect(alone.given).toStrictEqual([]);
    expect(grouped.distance).toBeGreaterThan(alone.distance + 10);
    expect(alone.written).not.toStrictEqual(grouped.written);
  });

  it('sends the same writes, write for write, as the same ride at the same draft factors without the group', async () => {
    const grouped = await ridden('grouped');
    const replayed = await ridden('replayed');
    // The groupless ride was handed nothing by the game, and every kept factor by this file.
    expect(replayed.given).toStrictEqual([]);
    expect(seen.replayed).toBe(grouped.given.length);
    expect(replayed.distance).toBe(grouped.distance);
    expect(replayed.written.length).toBe(grouped.written.length);
    grouped.written.forEach((write, index) => {
      expect(replayed.written[index], `write ${String(index)}`).toStrictEqual(write);
    });
    // The release too: leaving a group ride lets the trainer go exactly as leaving any ride does.
    expect(grouped.written.filter((write) => write.kind === 'release').length).toBeGreaterThan(0);
    expect(grouped.written.at(-1)).toStrictEqual({ kind: 'release' });
  });
});

/** What the pressed ride did, beside what it wrote. */
interface PressedRun extends Run {
  /** The power the rider held on each frame, in order. */
  readonly powers: readonly number[];
  /** Every `phase/role` the line was in as pull off was pressed. */
  readonly pressedIn: ReadonlySet<string>;
  /** Every `phase/role` the line was in as sit-in was toggled. */
  readonly toggledIn: ReadonlySet<string>;
  /** Every `phase/role` the line passed through. */
  readonly states: ReadonlySet<string>;
  /** How many times the rider went from the front to drifting back. */
  readonly pullOffs: number;
}

/** The power that holds the wheel, from the line as the newest step left it. */
function holdingWatts(): number {
  const session = seen.session;
  if (session === undefined) return 150;
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
  return Math.max(0, Math.min(500, Math.round(asked)));
}

const hudButton = (name: string): HTMLButtonElement | undefined =>
  queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find(
    (button) => button.textContent === name,
  );

/** Frames after the first pull-off: sit-in toggled, then the rider eases, then holds a wheel again. */
const SIT_IN_FRAMES = 160;
const SIT_IN_EVERY = 40;
const EASED_FRAMES = 70;
const BACK_FRAMES = 50;
/** The most frames the rider is given to reach the front and pull off. */
const TO_THE_FRONT_MOST = 1_200;

/**
 * The pressed ride, or, handed one, **the same power on the same frames at
 * the same draft factors with no group**: no line, no HUD control, no press.
 */
async function ridePressed(replayOf?: PressedRun): Promise<PressedRun> {
  seen.given = [];
  seen.replay = replayOf?.given;
  seen.replayed = 0;
  seen.session = undefined;
  powerNow = 150;
  const written: Write[] = [];
  mounted = await mount(
    <GameView
      port={port}
      renderer={() => Promise.resolve(renderer)}
      trainer={writingTrainer(written)}
      now={() => nowMs}
    />,
  );
  await settle();
  if (replayOf === undefined) {
    await clickThrough(
      queryAll<HTMLInputElement>(mounted.container, 'input[type="checkbox"]').find((input) =>
        (input.closest('label')?.textContent ?? '').includes('Ride with a group'),
      ),
    );
    // Three bots, so the rider's turn on the front comes round soonest.
    const size = queryAll<HTMLLabelElement>(mounted.container, 'label').find((label) =>
      (label.textContent ?? '').startsWith('Riders in the group'),
    );
    await chooseOption(document.getElementById(size?.htmlFor ?? '') as HTMLSelectElement, '3');
    await settle();
  }
  await clickThrough(
    queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    ),
  );
  const powers: number[] = [];
  const pressedIn = new Set<string>();
  const toggledIn = new Set<string>();
  const states = new Set<string>();
  let pullOffs = 0;
  /** The frame the rider first drifted back at, or `undefined` before it. */
  let pulledOffAt: number | undefined;
  let role = '';
  // Through a function: the mock writes `seen.session` where the compiler cannot see it.
  const line = (): GroupRideSession | undefined => seen.session;
  const stateNow = (): string => `${line()?.phase ?? 'none'}/${line()?.role ?? 'none'}`;
  for (let frame = 0; ; frame += 1) {
    if (replayOf === undefined) {
      const since = pulledOffAt === undefined ? -1 : frame - pulledOffAt;
      if (since >= SIT_IN_FRAMES + EASED_FRAMES + BACK_FRAMES) break;
      if (pulledOffAt === undefined && frame >= TO_THE_FRONT_MOST) {
        throw new Error(`the rider never pulled off: ${stateNow()}`);
      }
      // Eased right off after the sit-in stretch, so the line waits; a wheel held otherwise.
      powerNow =
        since >= SIT_IN_FRAMES && since < SIT_IN_FRAMES + EASED_FRAMES ? 0 : holdingWatts();
      // Pull off, before every frame: the lane key and the HUD's button in turn.
      pressedIn.add(stateNow());
      await act(async () => {
        if (frame % 2 === 0) {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', cancelable: true }));
        } else {
          hudButton(PULL_OFF_BUTTON_LABEL)?.click();
        }
        await Promise.resolve();
      });
      // Sit in, toggled through the stretch after the first pull-off and left off at its end.
      if (since >= 0 && since <= SIT_IN_FRAMES && since % SIT_IN_EVERY === 0) {
        toggledIn.add(stateNow());
        await act(async () => {
          hudButton(SIT_IN_BUTTON_LABEL)?.click();
          await Promise.resolve();
        });
      }
    } else {
      if (frame >= replayOf.powers.length) break;
      powerNow = replayOf.powers[frame] as number;
    }
    powers.push(powerNow);
    await oneFrame(frame);
    states.add(stateNow());
    const now: string = line()?.role ?? '';
    if (role === 'on-front' && now === 'drifting-back') {
      pullOffs += 1;
      pulledOffAt ??= frame;
    }
    role = now;
  }
  await settle();
  const distance = seen.odometer();
  const given = [...seen.given];
  mounted.unmount();
  mounted = undefined;
  await settle();
  return { written: [...written], given, distance, powers, pressedIn, toggledIn, states, pullOffs };
}

/** The pressed ride and its groupless twin, each ridden once. @see ridden */
const pressedRuns = new Map<string, Promise<PressedRun>>();
function pressedRide(name: 'pressed' | 'twin'): Promise<PressedRun> {
  let run = pressedRuns.get(name);
  if (run === undefined) {
    run = name === 'pressed' ? ridePressed() : pressedRide('pressed').then(ridePressed);
    pressedRuns.set(name, run);
    run.catch(() => pressedRuns.delete(name));
  }
  return run;
}

describe('a pull-off press and a sit-in choice reach no trainer write — #3307, ADR 0101 D-6.5', () => {
  it('presses pull off and toggles sit-in through a ride: a pull ended by a press, turns sat out, a wait', async () => {
    const pressed = await pressedRide('pressed');
    const phases = (states: ReadonlySet<string>): Set<string> =>
      new Set([...states].map((state) => state.split('/')[0] as string));
    const roles = (states: ReadonlySet<string>): Set<string> =>
      new Set([...states].map((state) => state.split('/')[1] as string));
    // Pull off was pressed in every phase and role the line passed through
    // (`none` is the line at the press, forming, before its first step)…
    for (const state of pressed.states) expect([...pressed.pressedIn]).toContain(state);
    expect([...phases(pressed.pressedIn)]).toStrictEqual(
      expect.arrayContaining(['none', 'steady', 'changing', 'latching', 'waiting']),
    );
    expect([...roles(pressed.pressedIn)]).toStrictEqual(
      expect.arrayContaining([
        'last-wheel',
        'second-wheel',
        'on-front',
        'drifting-back',
        'latching',
        'sitting-in',
        'off-the-back',
      ]),
    );
    // …and it bit: the rider took the front and a press ended the pull.
    expect(pressed.pullOffs).toBeGreaterThan(0);
    // Sit-in was toggled on and off, and the line heard it.
    expect(pressed.toggledIn.size).toBeGreaterThan(1);
    expect([...roles(pressed.states)]).toContain('sitting-in');
    // The trainer was sent a road that rises and falls all the while.
    const sent = grades(pressed);
    expect(sent.length).toBeGreaterThan(30);
    expect(Math.max(...sent)).toBeGreaterThan(2);
    expect(Math.min(...sent)).toBeLessThan(-2);
  });

  it('sends the same writes, write for write, as the same power at the same draft factors with no group and no press', async () => {
    const pressed = await pressedRide('pressed');
    const twin = await pressedRide('twin');
    // The twin had no line to press on, was handed nothing by the game, and every kept factor by this file.
    expect(twin.states).toStrictEqual(new Set(['none/none']));
    expect(twin.given).toStrictEqual([]);
    expect(seen.replayed).toBe(pressed.given.length);
    expect(twin.powers).toStrictEqual(pressed.powers);
    expect(twin.distance).toBe(pressed.distance);
    expect(twin.written.length).toBe(pressed.written.length);
    pressed.written.forEach((write, index) => {
      expect(twin.written[index], `write ${String(index)}`).toStrictEqual(write);
    });
    expect(pressed.written.at(-1)).toStrictEqual({ kind: 'release' });
    expect(pressed.written.filter((write) => write.kind === 'release')).toHaveLength(
      twin.written.filter((write) => write.kind === 'release').length,
    );
  });
});
