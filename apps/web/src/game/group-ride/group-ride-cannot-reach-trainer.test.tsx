// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **A group ride reaches no trainer write** — the `group-ride-cannot-reach-trainer`
 * gate of ADR 0101 D-6.6 and the owner's ruling 4 of 2026-11-26. **Its
 * first case is #3303's and the presses are #3307's; #3308 completes it**
 * (the worst case, ERG, the release through the Ride screen) and names it in
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
 * ## The worst case (#3308, ADR 0101 D-6.1 to D-6.6)
 *
 * One scripted ride, on a road with a rise and a climb, in which **every cue
 * kind is selected** (kept by wrapping `hud/group-ride-hud.ts`
 * §`groupRideCueSelected`, which hands each to the HUD's line and the
 * announcer, with announcements on) and the rider takes two pulls, surges,
 * presses pull off, sits in and out, rides off the front, closes a gap, loses
 * the power reading as they pull off so the line **waits to a stop**, eases
 * too much latching on, is **gapped** and **swept**, and lets the line go at a
 * climb's crest so it **regroups over the climb** while they are **off the
 * back**. Each frame's power is chosen from the line as the newest step left
 * it. Its twin is **the same power and reading on the same frames at the same
 * draft factors with no group**, and every write is equal, in order, the
 * release when the ride is left included. Both are ridden a part at a time, a
 * case to a part (#1688: cheaper, never a longer timeout), and the file's
 * hooks leave a ride alone while it is part of the way through.
 *
 * ⚠️ **Each stage of it rests on a rule of the line, and the order is not
 * free.** `eased-too-much` needs the rider latching more than 5 m back, which
 * the rotation ends at once inside 5 m, so it is reached only as the line's
 * first hold ends and it rides away unpaced: after any wait or regroup the
 * line is paced to the rider (ADR 0101's Amendments) and never pulls away
 * again. So the wait comes first and the climb last. No sound plays: #3306's
 * sounds are not built, and its own criterion adds a ride with every sound
 * fired to this gate when they are.
 *
 * ## ERG (#3308, ADR 0101 D-6.3)
 *
 * A workout in ERG on a real ride controller over the #44 simulated FTMS
 * trainer, with the group **forced** on beside it (`choice.ts`
 * §`groupRideUnavailable` wrapped: the chooser offers no group beside a
 * workout, D-1.5), against the same ride with no group: every byte on the
 * wire the same at the same frame, and the release after *End ride* the same
 * bytes. The release when a ride is left is the worst case's.
 *
 * The static half, that no module of the mode imports the trainer, is
 * `group-ride-imports-cannot-reach-trainer.test.ts` beside this file, and
 * `check:wiring`'s WIRE005.
 *
 * The existing gates (`draft-cannot-reach-trainer.test.tsx`,
 * `solo-draft-cannot-reach-trainer.test.tsx`,
 * `lap-race/lap-race-cannot-reach-trainer.test.ts`, `model-pacer-wiring.test.tsx`)
 * are kept green unmodified.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BOT_TACTIC_WHEEL_GAP_METRES,
  CUE_KINDS,
  seconds,
  thresholdShare,
  unixSeconds,
  watts,
  type CueKind,
} from '@onyourleft/domain';
import type { SimulationParameters } from '@onyourleft/sensors/protocol';
import { createSimulator, ftmsTrainer } from '@onyourleft/sensors/simulator';
import { recordingSessionId, workoutId, type WorkoutRecord } from '@onyourleft/store';
import { ATHLETE_A } from '@onyourleft/store/testing';

import type { RecordingCheckpointStore } from '../../recording/recorder';
import { createRideController, type RideController } from '../../ride/controller';
import { simulatedOpenTrainer } from '../../ride/simulated-trainer-testing';
import { chooseOption, mount, queryAll, settle, type Mounted } from '../../testing/mount';
import { endRideAnswer } from '../end-ride-testing';
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
  /** Every cue kind the selector chose, in order, as the HUD was handed it (#3308). */
  cued: [] as CueKind[],
  /** Offer the group whatever holds the trainer: the ERG case forces it beside a workout (#3308). */
  forceOffered: false,
}));

vi.mock('./choice', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./choice')>();
  return {
    ...actual,
    groupRideUnavailable: (...args: Parameters<typeof actual.groupRideUnavailable>) =>
      seen.forceOffered ? undefined : actual.groupRideUnavailable(...args),
  };
});

vi.mock('../hud/group-ride-hud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hud/group-ride-hud')>();
  return {
    ...actual,
    groupRideCueSelected: (...args: Parameters<typeof actual.groupRideCueSelected>) => {
      const [, selected] = args;
      if (selected !== null) seen.cued.push(selected.kind);
      return actual.groupRideCueSelected(...args);
    },
  };
});

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
/** Whether the power reading is live on the frame being ridden: always, unless a ride scripts a loss (#3308). */
let liveNow = true;

const port: GamePort = {
  listRoutes: () => Promise.resolve([ROUTE]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(powerNow), live: liveNow, paired: true },
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
  // A ride part of the way through rides on from where the last case left it.
  if (partRide !== undefined) return;
  pending = [];
  nowMs = 1_000_000;
  powerNow = 150;
  liveNow = true;
  seen.session = undefined;
  seen.given = [];
  seen.replay = undefined;
  seen.replayed = 0;
  seen.forceOffered = false;
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
  if (partRide !== undefined) return;
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
async function oneFrame(frame: number, frameMs = FRAME_MS): Promise<void> {
  const due = pending;
  if (due.length === 0) throw new Error(`the ride stopped asking for frames at ${String(frame)}`);
  pending = [];
  nowMs += frameMs;
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
  /** How many frames the rider spent on the front of a steady line before the first of those. */
  readonly framesOnFront: number;
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
const SIT_IN_FRAMES = 80;
const SIT_IN_EVERY = 20;
const EASED_FRAMES = 40;
const BACK_FRAMES = 30;
/** The most frames the rider is given to reach the front and pull off. */
const TO_THE_FRONT_MOST = 600;
/**
 * The pressed ride's frame: half a second, ten simulation steps, so its three
 * minutes are ridden in half the frames (#1688's ruling: a slow case is made
 * cheaper, never given a longer timeout).
 */
const PRESSED_FRAME_MS = 500;

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
  // One line every time: the seed `ride-group.ts` draws at the press.
  const seeded = vi
    .spyOn(globalThis.crypto, 'getRandomValues')
    .mockImplementation(<T extends ArrayBufferView>(array: T): T => {
      (array as unknown as Uint32Array)[0] = 7;
      return array;
    });
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
  let framesOnFront = 0;
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
    await oneFrame(frame, PRESSED_FRAME_MS);
    states.add(stateNow());
    if (pulledOffAt === undefined && stateNow() === 'steady/on-front') framesOnFront += 1;
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
  seeded.mockRestore();
  return {
    written: [...written],
    given,
    distance,
    powers,
    pressedIn,
    toggledIn,
    states,
    pullOffs,
    framesOnFront,
  };
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
    // …and it bit: the rider took the front and a press ended the pull, inside
    // a decision window of the line settling (a second and a half of frames),
    // where a rider who only fades is left there five seconds and more.
    expect(pressed.pullOffs).toBeGreaterThan(0);
    expect(pressed.framesOnFront).toBeLessThanOrEqual(6);
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

/** Where the worst case's rise starts, metres: 500 m at 2.5 %, short of a climb, for the rider to stop on. */
const RISE_FROM = 2_200;
const RISE_TO = RISE_FROM + 500;
const RISE_GRADE = 0.025;
/** Where its climb starts and ends: 220 m at 6 %. */
const CLIMB_FROM = RISE_TO + 60;
const CLIMB_TO = CLIMB_FROM + 220;
const CLIMB_GRADE = 0.06;
/** How far up the rise the rider, on the front since their second turn came, presses pull off. */
const PULL_OFF_ON_THE_RISE = 50;
/** How far behind the line's last wheel the rider ends its wait: inside the latching band, only just. */
const WAIT_ENDED_METRES = 4.5;
/** How far before the crest the rider lets the line go, and how far behind its front they ride then. */
const GAPPED_BEFORE_CREST = 60;
const CREST_BEHIND_METRES = 22;

/** The worst case's road: half a metre up and down every 300 m, so the grade keeps changing; a rise; a climb. */
const WORST_ROUTE: RidableRoute = {
  id: 'route-worst',
  name: 'Rolling with a climb',
  profile: northRoute(
    CLIMB_TO + 500,
    (along) =>
      0.5 * Math.sin((along / 300) * Math.PI * 2) +
      RISE_GRADE * (Math.min(Math.max(along, RISE_FROM), RISE_TO) - RISE_FROM) +
      CLIMB_GRADE * (Math.min(Math.max(along, CLIMB_FROM), CLIMB_TO) - CLIMB_FROM),
  ),
  attempts: 0,
};

/** A threshold the rider's pull is well over, so `shorter-pull` is due after it. */
const WORST_THRESHOLD = watts(100);

const worstPort: GamePort = {
  ...port,
  listRoutes: () => Promise.resolve([WORST_ROUTE]),
  ownThresholdPower: () => Promise.resolve(WORST_THRESHOLD),
};

/** The worst case's frame: one second, twenty simulation steps (#1688: cheaper, never a longer timeout). */
const WORST_FRAME_MS = 1_000;
/** How many frames one case rides of it: fewer in the first, which mounts the game and starts the ride. */
const WORST_FIRST_PART_FRAMES = 20;
const WORST_PART_FRAMES = 60;
/** How many cases ride it: enough parts for the ride, and the last says it ended inside them. */
const WORST_PARTS = 10;
/** The most frames the worst case is given: a stage that never ends throws, naming it. */
const WORST_FRAMES_MOST = WORST_FIRST_PART_FRAMES + WORST_PART_FRAMES * (WORST_PARTS - 1);
/** The frames ridden on a wheel once everything has happened, before the ride is left. */
const AFTER_FRAMES = 10;

/** The stages of the worst case, in order. */
type WorstStage =
  | 'to-the-front'
  | 'surge'
  | 'pull'
  | 'back-in-line'
  | 'sit-in'
  | 'close-gap'
  | 'past-front'
  | 'rejoin'
  | 'to-the-front-again'
  | 'second-pull'
  | 'alongside'
  | 'reading-lost'
  | 'eased'
  | 'back-on'
  | 'to-the-climb'
  | 'gapped-at-the-crest'
  | 'off-the-back'
  | 'regrouped'
  | 'after';

/** The power that rides `gapMetres` behind the wheel the line gives the rider, from the newest step. */
function wheelWatts(session: GroupRideSession, gapMetres: number): number {
  const { order } = session.state.rotation;
  const seat = order.indexOf('rider');
  const wheelId = seat === 0 ? undefined : seat > 0 ? order[seat - 1] : order[order.length - 1];
  const wheel = wheelId === undefined ? undefined : session.state.bots[wheelId];
  const { distanceM, speedMps } = session.rider;
  const asked =
    wheel === undefined
      ? 180 + 400 * (session.groupSpeedMps - speedMps)
      : 110 + 60 * (wheel.distanceM - gapMetres - distanceM) + 250 * (wheel.speedMps - speedMps);
  return Math.max(0, Math.min(500, Math.round(asked)));
}

/** The power that rides the group's speed and `overMps` more on the front, from the newest step. */
function pullWatts(session: GroupRideSession, overMps: number): number {
  const asked = 260 + 700 * (session.groupSpeedMps + overMps - session.rider.speedMps);
  return Math.max(0, Math.min(500, Math.round(asked)));
}

/** Where the line's front is, metres: a bot's odometer, or the rider's on the front. */
function frontAt(session: GroupRideSession): number {
  const frontId = session.state.rotation.order[0];
  return frontId === 'rider'
    ? session.rider.distanceM
    : (session.state.bots[frontId ?? '']?.distanceM ?? Number.NaN);
}

/** The power that rides `behindMetres` behind the line's front, from the newest step. */
function frontWatts(session: GroupRideSession, behindMetres: number): number {
  const frontId = session.state.rotation.order[0];
  const front = frontId === undefined ? undefined : session.state.bots[frontId];
  const { distanceM, speedMps } = session.rider;
  if (front === undefined) return wheelWatts(session, BOT_TACTIC_WHEEL_GAP_METRES);
  const asked =
    110 + 60 * (front.distanceM - behindMetres - distanceM) + 250 * (front.speedMps - speedMps);
  return Math.max(0, Math.min(500, Math.round(asked)));
}

/** Roles in which the rider is on a wheel of the line. */
const ON_A_WHEEL: ReadonlySet<string> = new Set([
  'second-wheel',
  'in-line',
  'last-wheel',
  'sitting-in',
]);

/** What the worst case did, beside what it wrote. */
interface WorstRun extends Run {
  readonly powers: readonly number[];
  /** Whether the power reading was live on each frame. */
  readonly lives: readonly boolean[];
  /** How many kept factors this file handed a groupless ride. */
  readonly replayed: number;
  /** Every cue kind the selector chose, in order. */
  readonly cued: readonly CueKind[];
  /** Every phase and every role the line passed through. */
  readonly phases: ReadonlySet<string>;
  readonly roles: ReadonlySet<string>;
  /** The stages, each with the frame it began on. */
  readonly stages: readonly { readonly stage: WorstStage; readonly frame: number }[];
  /** Whether a sweep bot dropped back to the rider. */
  readonly swept: boolean;
  /** The group's slowest while it waited, m/s. */
  readonly slowestWaiting: number;
  /** What the rider pressed and chose, as the group kept it. */
  readonly presses: readonly string[];
  /** How many frames drew a cue on the HUD's cue line. */
  readonly cueLineFrames: number;
}

/**
 * **The worst case** (#3308): one ride in which every cue kind is selected,
 * the rider takes a pull, presses pull off, sits in, is gapped, falls off the
 * back, the sweep drops back, the group waits to a stop and regroups over a
 * climb; or, handed one, **the same power and reading on the same frames at
 * the same draft factors with no group**.
 *
 * Ridden a part at a time: it yields how many writes the trainer has been
 * sent after every {@link WORST_PART_FRAMES} frames, so each part is a case of
 * its own (#1688: a slow case is made cheaper, never given a longer timeout).
 *
 * Each frame's power is chosen from the group's session as the newest step
 * left it, read and never called, by the stage the ride is in; a stage that
 * never ends throws, naming it, at {@link WORST_FRAMES_MOST}.
 */
async function* rideWorst(replayOf?: WorstRun): AsyncGenerator<number, WorstRun> {
  seen.given = [];
  seen.replay = replayOf?.given;
  seen.replayed = 0;
  seen.session = undefined;
  seen.cued = [];
  powerNow = 150;
  // Announcements on, so every cue is said in the live region as well as drawn.
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
  const seeded = vi
    .spyOn(globalThis.crypto, 'getRandomValues')
    .mockImplementation(<T extends ArrayBufferView>(array: T): T => {
      (array as unknown as Uint32Array)[0] = 7;
      return array;
    });
  const written: Write[] = [];
  mounted = await mount(
    <GameView
      port={worstPort}
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
  const lives: boolean[] = [];
  const phases = new Set<string>();
  const roles = new Set<string>();
  const stages: { stage: WorstStage; frame: number }[] = [];
  let swept = false;
  let slowestWaiting = Number.POSITIVE_INFINITY;
  let cueLineFrames = 0;
  let stage = 'to-the-front' as WorstStage;
  let since = 0;
  const line = (): GroupRideSession | undefined => seen.session;
  const cued = (kind: CueKind): boolean => seen.cued.includes(kind);
  const press = async (pressing: () => void): Promise<void> => {
    await act(async () => {
      pressing();
      await Promise.resolve();
    });
  };
  const pullOff = (): Promise<void> =>
    press(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', cancelable: true })));
  const next = (to: WorstStage, frame: number): void => {
    stage = to;
    since = 0;
    stages.push({ stage: to, frame });
  };
  stages.push({ stage, frame: 0 });
  for (let frame = 0; ; frame += 1) {
    if (replayOf === undefined) {
      if (frame >= WORST_FRAMES_MOST) {
        throw new Error(
          `the worst case stuck in ${stage}: ${line()?.phase ?? 'none'}/${line()?.role ?? 'none'}, cued ${seen.cued.join(' ')}`,
        );
      }
      const session = line();
      const role = session?.role ?? 'none';
      const phase = session?.phase ?? 'none';
      since += 1;
      if (session === undefined) {
        powerNow = 150;
      } else {
        switch (stage) {
          case 'to-the-front':
            powerNow = wheelWatts(session, BOT_TACTIC_WHEEL_GAP_METRES);
            if (role === 'on-front') next('surge', frame);
            break;
          case 'surge':
            powerNow = pullWatts(session, 1.2);
            if (cued('surging')) next('pull', frame);
            break;
          case 'pull':
            powerNow = pullWatts(session, 0);
            if (cued('pull-off')) {
              await pullOff();
              next('back-in-line', frame);
            }
            break;
          case 'back-in-line':
            powerNow = wheelWatts(session, BOT_TACTIC_WHEEL_GAP_METRES);
            if (ON_A_WHEEL.has(role)) {
              await press(() => hudButton(SIT_IN_BUTTON_LABEL)?.click());
              next('sit-in', frame);
            }
            break;
          case 'sit-in':
            powerNow = wheelWatts(session, BOT_TACTIC_WHEEL_GAP_METRES);
            if (cued('shorter-pull') && role === 'sitting-in') {
              await press(() => hudButton(SIT_IN_BUTTON_LABEL)?.click());
              next('close-gap', frame);
            }
            break;
          case 'close-gap':
            powerNow = wheelWatts(session, 3.5);
            if (cued('close-gap') && since > 4) next('past-front', frame);
            break;
          case 'past-front':
            powerNow = frontWatts(session, -8);
            if (cued('past-front')) next('rejoin', frame);
            break;
          case 'rejoin':
            powerNow = wheelWatts(session, BOT_TACTIC_WHEEL_GAP_METRES);
            if (ON_A_WHEEL.has(role) && since > 5) next('to-the-front-again', frame);
            break;
          case 'to-the-front-again':
            powerNow = wheelWatts(session, BOT_TACTIC_WHEEL_GAP_METRES);
            if (role === 'on-front') next('second-pull', frame);
            break;
          case 'second-pull':
            // On the front, past the pull's end, until the rise.
            powerNow = pullWatts(session, 0);
            if (session.rider.distanceM >= RISE_FROM + PULL_OFF_ON_THE_RISE) {
              await pullOff();
              next('alongside', frame);
            }
            break;
          case 'alongside':
            // Aside and level with the line a frame after the press: the reading is lost here.
            powerNow = 0;
            liveNow = false;
            next('reading-lost', frame);
            break;
          case 'reading-lost':
            powerNow = 0;
            if (session.rider.speedMps <= 0.05 && session.groupSpeedMps <= 0.05) {
              liveNow = true;
              next('eased', frame);
            }
            break;
          case 'eased':
            // Back up to the waiting line to end its wait, then let it go.
            powerNow = phase === 'waiting' ? wheelWatts(session, WAIT_ENDED_METRES) : 0;
            if (cued('eased-too-much')) next('back-on', frame);
            break;
          case 'back-on':
            // Chased at full power to a wheel: the line does not ease for a gapped rider.
            powerNow = ON_A_WHEEL.has(role)
              ? wheelWatts(session, BOT_TACTIC_WHEEL_GAP_METRES)
              : 500;
            if (ON_A_WHEEL.has(role) && since > 3) next('to-the-climb', frame);
            break;
          case 'to-the-climb': {
            powerNow = wheelWatts(session, BOT_TACTIC_WHEEL_GAP_METRES);
            if (frontAt(session) >= CLIMB_TO - GAPPED_BEFORE_CREST) {
              next('gapped-at-the-crest', frame);
            }
            break;
          }
          case 'gapped-at-the-crest':
            powerNow = frontWatts(session, CREST_BEHIND_METRES);
            if (phase === 'regrouping') next('off-the-back', frame);
            break;
          case 'off-the-back':
            powerNow = 0;
            if (role === 'off-the-back') next('regrouped', frame);
            break;
          case 'regrouped':
            powerNow = ON_A_WHEEL.has(role)
              ? wheelWatts(session, BOT_TACTIC_WHEEL_GAP_METRES)
              : 400;
            if (ON_A_WHEEL.has(role) && phase !== 'regrouping') next('after', frame);
            break;
          case 'after':
            powerNow = wheelWatts(session, BOT_TACTIC_WHEEL_GAP_METRES);
            break;
        }
      }
      if (stage === 'after' && since > AFTER_FRAMES) break;
    } else {
      if (frame >= replayOf.powers.length) break;
      powerNow = replayOf.powers[frame] as number;
      liveNow = replayOf.lives[frame] as boolean;
    }
    powers.push(powerNow);
    lives.push(liveNow);
    await oneFrame(frame, WORST_FRAME_MS);
    const ridden = frame + 1 - WORST_FIRST_PART_FRAMES;
    if (ridden >= 0 && ridden % WORST_PART_FRAMES === 0) yield written.length;
    const session = line();
    if (session !== undefined) {
      phases.add(session.phase);
      roles.add(session.role);
      swept ||= session.state.noDrop.sweep !== null;
      if (session.phase === 'waiting') {
        slowestWaiting = Math.min(slowestWaiting, session.groupSpeedMps);
      }
    }
    if (queryAll(mounted.container, '.oyl-hud__pacer-say').length > 0) cueLineFrames += 1;
  }
  await settle();
  const distance = seen.odometer();
  const given = [...seen.given];
  const presses = (line()?.presses ?? []).map((each) => each.press);
  mounted.unmount();
  mounted = undefined;
  await settle();
  seeded.mockRestore();
  return {
    written: [...written],
    given,
    distance,
    powers,
    lives,
    replayed: seen.replayed,
    cued: [...seen.cued],
    phases,
    roles,
    stages,
    swept,
    slowestWaiting,
    presses,
    cueLineFrames,
  };
}

/**
 * The ride that is part of the way through, if any. While it is, the file's
 * hooks leave the screen, the clock, the stubs and the device's storage
 * alone, so the next case rides on from the frame this one stopped at.
 */
let partRide:
  { readonly name: 'worst' | 'twin'; readonly ride: AsyncGenerator<number, WorstRun> } | undefined;
const worstDone = new Map<'worst' | 'twin', WorstRun>();

/**
 * Ride the next part of `name`: the worst case, or its twin once the worst
 * case has been ridden. Resolves to the writes so far, or the run once it is over.
 */
async function worstPart(name: 'worst' | 'twin'): Promise<number | WorstRun> {
  const done = worstDone.get(name);
  if (done !== undefined) return done;
  if (partRide !== undefined && partRide.name !== name) await worstRide(partRide.name);
  if (partRide === undefined) {
    partRide = {
      name,
      ride: name === 'worst' ? rideWorst() : rideWorst(await worstRide('worst')),
    };
  }
  try {
    const step = await partRide.ride.next();
    if (!step.done) return step.value;
    worstDone.set(name, step.value);
    partRide = undefined;
    return step.value;
  } catch (error) {
    partRide = undefined;
    mounted?.unmount();
    mounted = undefined;
    throw error;
  }
}

/** The whole of `name`, riding whatever parts are left of it. */
async function worstRide(name: 'worst' | 'twin'): Promise<WorstRun> {
  for (;;) {
    const part = await worstPart(name);
    if (typeof part !== 'number') return part;
  }
}

describe('the worst case reaches no trainer write in simulation mode — #3308, ADR 0101 D-6.1 to D-6.6', () => {
  let writesBefore = 0;
  for (let part = 1; part <= WORST_PARTS; part += 1) {
    it(`rides part ${String(part)} of ${String(WORST_PARTS)} with the group, the trainer sent the road all the while`, async () => {
      const ridden = await worstPart('worst');
      if (typeof ridden === 'number') {
        expect(ridden).toBeGreaterThan(writesBefore);
        writesBefore = ridden;
      }
      // The ride ends inside its parts: a longer ride is a policy that lost its way.
      if (part === WORST_PARTS) expect(typeof ridden).not.toBe('number');
    });
  }

  it('selects every cue kind, events and corrections, and draws them on the cue line', async () => {
    const worst = await worstRide('worst');
    expect(new Set(worst.cued)).toStrictEqual(new Set(CUE_KINDS));
    expect(worst.cueLineFrames).toBeGreaterThan(CUE_KINDS.length);
  });

  it('takes a pull, presses pull off, sits in, is gapped, falls off the back, is swept, waits to a stop and regroups over a climb', async () => {
    const worst = await worstRide('worst');
    expect([...worst.roles]).toStrictEqual(
      expect.arrayContaining([
        'on-front',
        'drifting-back',
        'latching',
        'sitting-in',
        'gapped',
        'off-the-back',
        'off-the-front',
      ]),
    );
    expect([...worst.phases]).toStrictEqual(
      expect.arrayContaining(['steady', 'changing', 'latching', 'waiting', 'regrouping']),
    );
    expect(worst.presses).toStrictEqual(expect.arrayContaining(['pull-off', 'sit-in', 'sit-out']));
    expect(worst.swept).toBe(true);
    // The line waited for a rider who had stopped, to a stop of its own.
    expect(worst.slowestWaiting).toBeLessThanOrEqual(0.05);
    expect(worst.lives).toContain(false);
    // It regrouped as its front came over the climb, with the rider gapped behind.
    const at = (stage: WorstStage): number =>
      worst.stages.find((each) => each.stage === stage)?.frame ?? Number.NaN;
    expect(at('off-the-back')).toBeGreaterThan(at('gapped-at-the-crest'));
    // And the trainer was sent the rise and the climb, grade by grade.
    const sent = grades(worst);
    expect(Math.max(...sent)).toBeGreaterThan(5);
    expect(sent.some((grade) => grade > 1.5 && grade < 3.5)).toBe(true);
    // The rider was sheltered, so nothing below holds because the group never took effect.
    expect(Math.min(...worst.given)).toBeLessThan(0.7);
  });

  let twinBefore = 0;
  for (let part = 1; part <= WORST_PARTS; part += 1) {
    it(`rides part ${String(part)} of ${String(WORST_PARTS)} of the same power and reading, at the same draft factors, with no group`, async () => {
      const ridden = await worstPart('twin');
      if (typeof ridden === 'number') {
        expect(ridden).toBeGreaterThan(twinBefore);
        twinBefore = ridden;
      }
      if (part === WORST_PARTS) expect(typeof ridden).not.toBe('number');
    });
  }

  it('sends the same writes, write for write and in order, as the twin, the release included', async () => {
    const worst = await worstRide('worst');
    const twin = await worstRide('twin');
    // The twin had no line, was handed nothing by the game, and every kept factor by this file.
    expect(twin.phases).toStrictEqual(new Set());
    expect(twin.given).toStrictEqual([]);
    expect(twin.replayed).toBe(worst.given.length);
    expect(twin.powers).toStrictEqual(worst.powers);
    expect(twin.lives).toStrictEqual(worst.lives);
    expect(twin.distance).toBe(worst.distance);
    expect(twin.written.length).toBe(worst.written.length);
    worst.written.forEach((write, index) => {
      expect(twin.written[index], `write ${String(index)}`).toStrictEqual(write);
    });
    // Leaving the group ride let the trainer go exactly as leaving the twin did.
    expect(worst.written.at(-1)).toStrictEqual({ kind: 'release' });
    expect(worst.written.filter((write) => write.kind === 'release')).toHaveLength(
      twin.written.filter((write) => write.kind === 'release').length,
    );
  });
});

/** A recording nobody keeps: the ERG case ends its ride by discarding it. */
const CHECKPOINTS: RecordingCheckpointStore = {
  putRecordingSession: (record) => Promise.resolve(record.id),
  appendRecordingChunk: () => Promise.resolve(1),
  readRecordingSessions: () => Promise.resolve({ sessions: [], unreadable: [] }),
  recoverRecording: () => Promise.resolve(undefined),
  deleteRecordingSession: () => Promise.resolve(true),
};

/** A workout whose ERG target changes three times inside the ride. */
const INTERVALS: WorkoutRecord = {
  id: workoutId('w3308-intervals'),
  createdBy: ATHLETE_A,
  name: 'Intervals',
  workout: {
    name: 'Intervals',
    blocks: [
      { kind: 'steady', seconds: seconds(15), target: thresholdShare(0.6) },
      { kind: 'steady', seconds: seconds(15), target: thresholdShare(1.05) },
      { kind: 'steady', seconds: seconds(15), target: thresholdShare(0.75) },
      { kind: 'steady', seconds: seconds(600), target: thresholdShare(0.9) },
    ],
  },
  createdAt: unixSeconds(1),
  updatedAt: unixSeconds(1),
};
const ERG_THRESHOLD = watts(250);
/** A minute of one-second frames: the workout's first three changes of target. */
const ERG_FRAMES = 60;
const SET_TARGET_POWER = 0x05;

/** One control point write, as octets, with the frame it was made on. */
interface Wire {
  readonly bytes: readonly number[];
  readonly frame: number;
}

/** What an ERG ride sent the trainer, and whether a group rode it. */
interface ErgRun {
  /** Every write while the ride was ridden, in order. */
  readonly riding: readonly Wire[];
  /** Every write from *End ride* on: the release. */
  readonly release: readonly Wire[];
  /** Every factor the ride handed the simulation. */
  readonly given: readonly number[];
  /** Whether a group's line was stepped. */
  readonly grouped: boolean;
}

async function flush(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await settle();
}

/**
 * A workout in ERG on a real ride controller over the #44 simulated FTMS
 * trainer, the game ridden from the real picker beside it, with the group
 * **forced** on for `group` (the chooser offers none beside a workout, ADR 0101
 * D-1.5), and the ride ended through the Ride screen's own *End ride*.
 */
async function rideErg(group: boolean): Promise<ErgRun> {
  seen.given = [];
  seen.session = undefined;
  seen.forceOffered = group;
  powerNow = 200;
  const { transport, bench } = createSimulator({
    devices: [ftmsTrainer({ id: 'kickr', name: 'KICKR 1F2A' })],
  });
  const written: number[][] = [];
  const frames: number[] = [];
  const controller: RideController = createRideController({
    transport,
    store: CHECKPOINTS,
    athleteId: ATHLETE_A,
    newSessionId: () => recordingSessionId('ride-3308'),
    now: () => bench.now,
    openTrainer: simulatedOpenTrainer(bench, { written }),
  });
  let frame = 0;
  const stamp = (): void => {
    while (frames.length < written.length) frames.push(frame);
  };
  try {
    await controller.pair('trainer');
    await controller.requestTrainerControl();
    await controller.start();
    expect(controller.startWorkout(INTERVALS, ERG_THRESHOLD)).toBe(true);
    mounted = await mount(
      <GameView
        port={port}
        renderer={() => Promise.resolve(renderer)}
        trainer={gameTrainerPortOver(controller)}
        now={() => nowMs}
      />,
    );
    await flush();
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
    stamp();
    for (frame = 1; frame <= ERG_FRAMES; frame += 1) {
      const due = pending;
      if (due.length === 0)
        throw new Error(`the ride stopped asking for frames at ${String(frame)}`);
      pending = [];
      nowMs += 1_000;
      await act(async () => {
        bench.advance(seconds(1));
        await controller.tick(bench.now);
        for (const next of due) next(nowMs);
        await Promise.resolve();
        await Promise.resolve();
      });
      await settle();
      stamp();
    }
    const grouped = seen.session !== undefined;
    const given = [...seen.given];
    const endedAt = written.length;
    await clickThrough(
      queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
        (button.textContent ?? '').startsWith('End ride'),
      ),
    );
    await clickThrough(endRideAnswer(document, 'Discard ride'));
    await clickThrough(endRideAnswer(document, 'Discard ride'));
    controller.endWorkout();
    await flush();
    stamp();
    const wire = written.map((bytes, index) => ({ bytes, frame: frames[index] ?? Number.NaN }));
    return { riding: wire.slice(0, endedAt), release: wire.slice(endedAt), given, grouped };
  } finally {
    mounted?.unmount();
    mounted = undefined;
    controller.dispose();
    await flush();
    seen.forceOffered = false;
  }
}

/** Each ERG ride, ridden once by the first case that asks for it. @see ridden */
const ergRuns = new Map<boolean, Promise<ErgRun>>();
function ergRide(group: boolean): Promise<ErgRun> {
  let run = ergRuns.get(group);
  if (run === undefined) {
    run = rideErg(group);
    ergRuns.set(group, run);
    run.catch(() => ergRuns.delete(group));
  }
  return run;
}

describe('a group ride forced beside a workout reaches no ERG write — #3308, ADR 0101 D-6.3', () => {
  it('rides the workout in ERG with the group forced on: the rider is drafted, the targets change', async () => {
    const grouped = await ergRide(true);
    expect(grouped.grouped).toBe(true);
    expect(grouped.given.length).toBeGreaterThan(ERG_FRAMES / 2);
    expect(Math.min(...grouped.given)).toBeLessThan(0.7);
    const targets = grouped.riding.filter((write) => write.bytes[0] === SET_TARGET_POWER);
    expect(new Set(targets.map((write) => write.bytes.join(','))).size).toBeGreaterThan(2);
  });

  it('sends the same bytes at the same frames with and without the group, and ends with the same release', async () => {
    const grouped = await ergRide(true);
    const alone = await ergRide(false);
    expect(alone.grouped).toBe(false);
    expect(alone.given).toStrictEqual([]);
    expect(grouped.riding).toStrictEqual(alone.riding);
    expect(grouped.release.length).toBeGreaterThan(0);
    expect(grouped.release.map((write) => write.bytes)).toStrictEqual(
      alone.release.map((write) => write.bytes),
    );
  });
});
