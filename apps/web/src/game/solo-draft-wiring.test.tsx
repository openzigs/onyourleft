// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2425 through the real game: a SOLO ride behind the bot pacer and the
 * rider's own ghost, driven through the real `GameView`, the real picker and
 * the real `GameSimulation`, and read back off the rendered HUD, its announcer
 * region and what the game hands the ride controller — never off a store.
 *
 * ADR 0066: the Draft field shows the solo `k` with the device's switch on
 * and the display preference on (D-6, R-13), the solo draft is never spoken
 * (D-5.5), "Your best" says *"with its draft"* after a drafted attempt (D-5.1),
 * and another rider's ghost gives no draft (D-3). The doubles are the store
 * behind `GamePort`, the GL context behind `GameRenderer` and the clock.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  altitudeMetres,
  buildGhostTrack,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  watts,
  type GhostTrack,
  type RoutePoint,
} from '@onyourleft/domain';

import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import { endRideAnswer } from './end-ride-testing';
import { GameView, type GamePort, type RidableRoute, type RiderGhostLoad } from './GameView';
import type { GameRenderer } from './port';
import { DRAFT_READING_STORAGE_KEY } from './draft-preference';
import type { GhostOutcome } from './ghost-outcome';
import { ANNOUNCEMENTS_STORAGE_KEY } from './hud/announce-preference';
import { SOLO_DRAFT_STORAGE_KEY } from './solo-draft-preference';
import { draftedRide, type SoloDraftState } from './solo-draft';
import type { LapRaceChoice } from './lap-race/choice';
import { circuitRoute } from './route-fixtures-testing';
import type { SimulationParameters } from '@onyourleft/sensors/protocol';
import {
  gameTrainerPortOver,
  NO_GAME_TRAINER,
  type GameTrainerPort,
  type GradientTrainer,
} from './trainer-port';

/** The ride's odometer at each frame the game drew, read from the simulation's own state. */
const odometers = vi.hoisted((): number[] => []);
vi.mock('./scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./scene')>();
  return {
    ...actual,
    sceneFrame: (...args: Parameters<typeof actual.sceneFrame>) => {
      odometers.push(args[0].state.ride.distance);
      return actual.sceneFrame(...args);
    },
  };
});

/** Every distance the ride sampled the trainer's gradient session at. */
const sampled = vi.hoisted((): number[] => []);
vi.mock('./gradient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./gradient')>();
  return {
    ...actual,
    createGradientSession: (...args: Parameters<typeof actual.createGradientSession>) => {
      const session = actual.createGradientSession(...args);
      return {
        ...session,
        sample: (at: Parameters<typeof session.sample>[0], distance: number, bounded?: boolean) => {
          sampled.push(distance);
          session.sample(at, distance, bounded);
        },
      };
    },
  };
});

/** Five level kilometres, with one attempt on it so a ghost can be raced. */
function levelRoute(): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 500; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(10),
    });
  }
  return { id: 'route-level', name: 'Level', profile: routeProfile(points), attempts: 1 };
}

/**
 * An attempt that rides away from the line as a rider does, then holds about
 * 9.5 m/s for a minute: close enough ahead to sit in.
 */
const STEADY_GHOST: GhostTrack = buildGhostTrack({
  elapsedSeconds: [0, 4, 8, 68],
  distanceMetres: [0, 10, 40, 610],
});

/** An attempt that stopped forty metres up the road after four seconds. */
const SHORT_GHOST: GhostTrack = buildGhostTrack({
  elapsedSeconds: [0, 4],
  distanceMetres: [0, 40],
});

function pedallingPort(
  route: RidableRoute,
  ghost?: RiderGhostLoad,
  own: GhostTrack = STEADY_GHOST,
): GamePort {
  return {
    listRoutes: () => Promise.resolve([route]),
    loadGhost: () => Promise.resolve(own),
    ...(ghost === undefined
      ? {}
      : { riderGhostOffered: () => true, loadRiderGhost: () => Promise.resolve(ghost) }),
    readSensors: () => ({
      rider: { power: watts(220), live: true, paired: true },
      cadence: { value: 90, live: true, paired: true },
      heartRate: { value: 140, live: true, paired: true },
    }),
  };
}

/** A loop of about 250 m with one attempt on it, so a lap race can be raced with the own ghost ticked. */
function loopRoute(rolling = false): RidableRoute {
  const elevation = rolling ? (along: number) => 2.5 * Math.sin(along / 20) : () => 0;
  return { id: 'route-loop', name: 'Loop', profile: circuitRoute(40, elevation), attempts: 1 };
}

/** A ready trainer through the real `gameTrainerPortOver`, keeping every simulation write it is handed. */
function writingTrainer(written: SimulationParameters[]): GameTrainerPort {
  const control: GradientTrainer = {
    setSimulationParameters: (parameters) => {
      written.push(parameters);
      return Promise.resolve();
    },
    letGo: () => Promise.resolve({ kind: 'stopped' as const }),
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
/** What the game handed the ride controller as each ride ended. */
let handed: { readonly outcome: GhostOutcome | undefined; readonly drafted: boolean | undefined }[];
/** Every solo draft the game handed the recording, frame by frame — #2451. */
let stepped: SoloDraftState[];

const trainer: GameTrainerPort = {
  readTrainer: () => NO_GAME_TRAINER,
  askForControlOnRide: () => Promise.resolve(),
  workoutRescue: () => undefined,
  recordingMayStop: () => false,
  gameRideEnded: (outcome, drafted) => {
    handed.push({ outcome, drafted });
  },
  soloDraftStepped: (draft) => {
    stepped.push(draft);
  },
  rideMovingSeconds: () => undefined,
  watchRide: () => () => undefined,
};

beforeEach(() => {
  odometers.length = 0;
  sampled.length = 0;
  pending = [];
  nowMs = 1_000_000;
  handed = [];
  stepped = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  // Announcements on, every reading and optional row silenced, so only events speak.
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

const toggle = (text: string): HTMLInputElement | undefined =>
  queryAll<HTMLInputElement>(mounted?.container ?? document, 'input[type="checkbox"]').find(
    (input) => (input.closest('label')?.textContent ?? '').includes(text),
  );

/** The value a HUD field shows, by its label as the rider reads it; `undefined` when absent. */
function field(label: string): string | undefined {
  const term = queryAll(mounted?.container ?? document, 'dt').find(
    (dt) => dt.textContent === label,
  );
  return term === undefined ? undefined : (term.nextElementSibling?.textContent ?? '');
}

const spoken = (): string =>
  mounted?.container.querySelector('[data-oyl-announcer="hud"]')?.textContent ?? '';

/** Choose on the picker, press Ride, and ride `frames` quarter-seconds; each frame's Draft field and region. */
async function rideSolo(options: {
  readonly pacer?: boolean;
  readonly ownGhost?: boolean;
  readonly riderGhost?: RiderGhostLoad;
  readonly own?: GhostTrack;
  /** A lap race on a loop, as the chooser sends it alongside the own-ghost flag. */
  readonly lapRace?: LapRaceChoice;
  /** The shell's room for this ride: a ride in a room has the room's `k`, never a solo one. */
  readonly roomId?: string;
  /** Ride a rolling loop through the real trainer port, every write kept here. */
  readonly written?: SimulationParameters[];
  readonly frames: number;
}): Promise<{ readonly draft: (string | undefined)[]; readonly heard: string[] }> {
  mounted = await mount(
    <GameView
      port={pedallingPort(
        options.lapRace === undefined && options.written === undefined
          ? levelRoute()
          : loopRoute(options.written !== undefined),
        options.riderGhost,
        options.own,
      )}
      {...(options.lapRace === undefined ? {} : { lapRace: options.lapRace })}
      {...(options.roomId === undefined ? {} : { roomId: options.roomId })}
      renderer={() => Promise.resolve(renderer)}
      trainer={options.written === undefined ? trainer : writingTrainer(options.written)}
      now={() => nowMs}
    />,
  );
  await settle();
  if (options.pacer === true) {
    await clickThrough(toggle('pacer'));
    const intensity = queryAll<HTMLInputElement>(mounted.container, 'input[type="number"]')[0];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    await act(async () => {
      setter?.set?.call(intensity, '3');
      intensity?.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
  }
  if (options.ownGhost === true) await clickThrough(toggle('Race your own'));
  if (options.riderGhost !== undefined) await clickThrough(toggle('Race another rider'));
  await clickThrough(
    queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    ),
  );
  const draft: (string | undefined)[] = [];
  const heard: string[] = [];
  for (let frame = 0; frame < options.frames; frame += 1) {
    const next = pending.shift();
    if (next === undefined) break;
    nowMs += FRAME_MS;
    await act(async () => {
      next(nowMs);
      await Promise.resolve();
    });
    draft.push(field('Draft'));
    heard.push(spoken());
  }
  return { draft, heard };
}

function unmountForReride(): void {
  mounted?.unmount();
  mounted = undefined;
  pending = [];
}

async function endTheRide(): Promise<void> {
  await clickThrough(
    queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find(
      (button) => button.textContent === 'End ride',
    ),
  );
  await clickThrough(endRideAnswer(document, 'End ride'));
  pending = [];
}

/** The percentage a Draft field reads, or `undefined` for none. */
const percentOf = (text: string | undefined): number | undefined => {
  const found = /^(\d+) %/.exec(text ?? '');
  return found === null ? undefined : Number(found[1]);
};

describe('the solo Draft field — #2425, ADR 0066 D-5, D-6', () => {
  it('shows the pacer’s draft as a share of drag with its gauge, and never says it', async () => {
    const { draft, heard } = await rideSolo({ pacer: true, frames: 160 });
    const readings = draft.map(percentOf);
    // Present from the first frame, on the gauge's own scale.
    // #2472: as a screen reader reads it, "of drag" after the drawn `%`.
    expect(draft.every((text) => /^\d+ % of drag at most 59 %$/.test(text ?? ''))).toBe(true);
    expect(Math.max(...readings.map((value) => value ?? 0))).toBeGreaterThanOrEqual(10);
    expect(mounted?.container.querySelectorAll('.oyl-hud__gauge')).toHaveLength(1);
    // D-5.5: the solo draft has no spoken cue, entering or leaving.
    expect(heard.filter((sentence) => /draft/i.test(sentence))).toEqual([]);
  });

  it('shows no Draft field with the switch off — the ride is today’s', async () => {
    localStorage.setItem(SOLO_DRAFT_STORAGE_KEY, 'off');
    const { draft } = await rideSolo({ pacer: true, frames: 60 });
    expect(draft.every((text) => text === undefined)).toBe(true);
  });

  it('hides the field with the display preference off, the draft ridden all the same (R-13)', async () => {
    localStorage.setItem(DRAFT_READING_STORAGE_KEY, 'off');
    const { draft } = await rideSolo({ pacer: true, frames: 60 });
    expect(draft.every((text) => text === undefined)).toBe(true);
  });

  it('shows no Draft field on a ride with nobody to give a draft', async () => {
    const { draft } = await rideSolo({ frames: 40 });
    expect(draft.every((text) => text === undefined)).toBe(true);
  });

  it('gives no draft from another rider’s ghost (D-3)', async () => {
    const { draft } = await rideSolo({
      riderGhost: { kind: 'ghost', rider: 'Bea', track: STEADY_GHOST },
      frames: 80,
    });
    expect(field('Bea')).toBeDefined();
    expect(draft.every((text) => text === undefined)).toBe(true);
  });
});

describe('the trainer never feels a solo draft — #2425, ADR 0066 D-1, through the real GameView', () => {
  it('writes the same kinds of parameter drafted and undrafted: a grade, no draft term', async () => {
    const drafted: SimulationParameters[] = [];
    const { draft } = await rideSolo({ pacer: true, written: drafted, frames: 120 });
    expect(Math.max(...draft.map((text) => percentOf(text) ?? 0))).toBeGreaterThanOrEqual(10);
    expect(drafted.length).toBeGreaterThan(5);
    await endTheRide();
    unmountForReride();
    localStorage.setItem(SOLO_DRAFT_STORAGE_KEY, 'off');
    const alone: SimulationParameters[] = [];
    await rideSolo({ pacer: true, written: alone, frames: 120 });
    expect(alone.length).toBeGreaterThan(5);
    const shape = (written: SimulationParameters[]) =>
      written.map((parameters) => Object.keys(parameters).sort().join());
    expect(new Set(shape(drafted))).toEqual(new Set(shape(alone)));
    // Everything but the grade is the ride's constant: the draft is in none of it.
    const constants = (written: SimulationParameters[]) =>
      new Set(written.map((parameters) => JSON.stringify({ ...parameters, grade: undefined })));
    expect(constants(drafted)).toEqual(constants(alone));
    // The only input a draft could reach a write by is the distance the gradient
    // session is sampled at: it is the simulation's own odometer, the one the
    // frame is drawn from, and never a place a draft moved.
    expect(sampled.length).toBeGreaterThan(5);
    for (const distance of sampled) expect(odometers).toContain(distance);
  });
});

describe('no solo draft in a room — #2425, ADR 0066 D-1.5', () => {
  it('hands a ride in a room no solo k, pacer or not: the room’s is the only one', async () => {
    const { draft } = await rideSolo({ pacer: true, roomId: 'room-1', frames: 60 });
    expect(draft.every((text) => text === undefined)).toBe(true);
    await endTheRide();
    expect(handed.every((ended) => ended.drafted !== true)).toBe(true);
  });
});

describe('no solo draft in a lap race — #2425, ADR 0066 D-2', () => {
  it('drafts nobody behind the own ghost the chooser sends with a lap race', async () => {
    const race: LapRaceChoice = { laps: 2, bots: 3, tier: 'brisk', itemsOn: false };
    const { draft } = await rideSolo({ ownGhost: true, lapRace: race, frames: 80 });
    expect(draft.every((text) => text === undefined)).toBe(true);
    await endTheRide();
    expect(handed.every((ended) => ended.drafted !== true)).toBe(true);
  });
});

describe('“Your best” after a drafted attempt — #2425, ADR 0066 D-5.1, D-5.6', () => {
  it('says “with its draft” on the settled field, and hands the recording that it was drafted', async () => {
    const { draft } = await rideSolo({ ownGhost: true, frames: 300 });
    expect(Math.max(...draft.map((text) => percentOf(text) ?? 0))).toBeGreaterThanOrEqual(10);
    const best = field('Your best') ?? '';
    expect(best).toMatch(/^(Beaten|Matched|Finished)/);
    expect(best).toMatch(/, with its draft$/);
    await endTheRide();
    expect(handed).toHaveLength(1);
    expect(handed[0]?.outcome).toBeDefined();
    expect(handed[0]?.drafted).toBe(true);
  });

  it('hands the recording the in-draft state and the road behind it, frame by frame — #2451, D-5.3', async () => {
    const { draft } = await rideSolo({ ownGhost: true, frames: 300 });
    expect(Math.max(...draft.map((text) => percentOf(text) ?? 0))).toBeGreaterThanOrEqual(10);
    expect(stepped.length).toBeGreaterThan(100);
    // The simulation's own counts, never falling within one ride: what the
    // recording sums is what the rider rode.
    for (let index = 1; index < stepped.length; index += 1) {
      expect(stepped[index]!.riddenMetres).toBeGreaterThanOrEqual(stepped[index - 1]!.riddenMetres);
    }
    expect(stepped.some((each) => each.inDraft)).toBe(true);
    expect(draftedRide(stepped.at(-1))).toBe(true);
  });

  it('hands the recording no solo draft with the switch off — #2451', async () => {
    localStorage.setItem(SOLO_DRAFT_STORAGE_KEY, 'off');
    await rideSolo({ ownGhost: true, frames: 120 });
    expect(stepped).toEqual([]);
  });

  it('latches it with the outcome: riding on alone afterwards never takes it away', async () => {
    // Settled after four seconds, most of them in the attempt's draft…
    await rideSolo({ ownGhost: true, own: SHORT_GHOST, frames: 24 });
    expect(field('Your best')).toBe('Finished ahead of you, with its draft');
    // …then a hundred seconds alone, in which the ride's own share in the
    // draft falls far below DRAFTED_SHARE: the attempt's is what was settled.
    for (let frame = 0; frame < 400; frame += 1) {
      const next = pending.shift();
      if (next === undefined) break;
      nowMs += FRAME_MS;
      await act(async () => {
        next(nowMs);
        await Promise.resolve();
      });
    }
    expect(field('Your best')).toBe('Finished ahead of you, with its draft');
  });

  it('marks it all the same with the display preference off (R-13)', async () => {
    // The owner's ruling R-13: the display preference hides the Draft field,
    // and the draft is ridden and the attempt marked exactly as with it on.
    localStorage.setItem(DRAFT_READING_STORAGE_KEY, 'off');
    const { draft } = await rideSolo({ ownGhost: true, frames: 300 });
    expect(draft.every((text) => text === undefined)).toBe(true);
    const best = field('Your best') ?? '';
    expect(best).toMatch(/^(Beaten|Matched|Finished)/);
    expect(best).toMatch(/, with its draft$/);
    await endTheRide();
    expect(handed).toHaveLength(1);
    expect(handed[0]?.outcome).toBeDefined();
    expect(handed[0]?.drafted).toBe(true);
  });

  it('reads as before with the switch off', async () => {
    localStorage.setItem(SOLO_DRAFT_STORAGE_KEY, 'off');
    await rideSolo({ ownGhost: true, frames: 300 });
    const best = field('Your best') ?? '';
    expect(best).toMatch(/^(Beaten|Matched|Finished)/);
    expect(best).not.toContain('draft');
    await endTheRide();
    expect(handed[0]?.outcome).toBeDefined();
    expect(handed[0]?.drafted).toBe(false);
  });
});
