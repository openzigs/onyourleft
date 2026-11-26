// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2967 through the real game: *Your ride*'s **Draft**, driven through the
 * real `GameView`, the real chooser and the real `GameSimulation`, and read
 * back off what the rider reads and rides — the rendered switch and HUD, the
 * simulation's own odometer at every frame the game drew, and every write the
 * real trainer port was handed. Never off a store the test wrote itself.
 *
 * - The switch is in *Your ride*, on by default, and kept on this device.
 * - Off, at the same power, the rider rides no faster behind the pacer or a
 *   lap race's bots than with no draft at all — frame for frame the ride the
 *   Settings switch's off rides — and slower than with it on.
 * - Off, the HUD's Draft reads *Off* and says it was the rider's choice.
 * - Off, the trainer is written exactly what an undrafted ride writes: the
 *   choice changes the simulated speed and nothing the trainer is sent.
 *
 * That the bots still draft each other is `lap-race/ride-race.test.ts`'s,
 * on the race the chooser's choice is handed to.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watts } from '@onyourleft/domain';
import type { SimulationParameters } from '@onyourleft/sensors/protocol';

import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import { GameView, type GamePort, type RidableRoute } from './GameView';
import type { GameRenderer } from './port';
import { ANNOUNCEMENTS_STORAGE_KEY } from './hud/announce-preference';
import type { LapRaceChoice } from './lap-race/choice';
import { LAP_RACE_COUNTDOWN_MS } from './lap-race/ride-race';
import { RIDER_DRAFT_STORAGE_KEY } from './rider-draft-preference';
import { circuitRoute } from './route-fixtures-testing';
import { SOLO_DRAFT_STORAGE_KEY } from './solo-draft-preference';
import { gameTrainerPortOver, type GameTrainerPort, type GradientTrainer } from './trainer-port';

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

const SWITCH = 'Draft behind the pacer, your best and the bots';

/** A rolling loop of about 250 m, so the trainer is written a grade that changes. */
function loopRoute(): RidableRoute {
  return {
    id: 'route-loop',
    name: 'Loop',
    profile: circuitRoute(40, (along) => 2.5 * Math.sin(along / 20)),
    attempts: 0,
  };
}

/** The same 220 W on every ride, so only the draft differs. */
const port: GamePort = {
  listRoutes: () => Promise.resolve([loopRoute()]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(220), live: true, paired: true },
    cadence: { value: 90, live: true, paired: true },
    heartRate: { value: 140, live: true, paired: true },
  }),
};

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
/**
 * A lap race's countdown (#2546), which holds the rider on the line, in four
 * frames of 2.5 s rather than forty of a quarter (#1688: make a slow case
 * cheaper). Fifty `SIMULATION_STEP_SECONDS` steps each, inside
 * `MAXIMUM_STEPS_PER_ADVANCE`, so none is skipped.
 */
const COUNTDOWN_FRAME_MS = 2_500;
let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let mounted: Mounted | undefined;

beforeEach(() => {
  odometers.length = 0;
  pending = [];
  nowMs = 1_000_000;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  // Announcements on, every reading silenced, so nothing but events speaks.
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
  vi.restoreAllMocks();
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

/** Mount the game on the chooser, with every write to the trainer kept in `written`. */
async function openChooser(written: SimulationParameters[], lapRace?: LapRaceChoice) {
  mounted?.unmount();
  pending = [];
  mounted = await mount(
    <GameView
      port={port}
      {...(lapRace === undefined ? {} : { lapRace })}
      renderer={() => Promise.resolve(renderer)}
      trainer={writingTrainer(written)}
      now={() => nowMs}
    />,
  );
  await settle();
}

/**
 * Ride once: the pacer at 3 W/kg or the lap race, the rider's Draft as
 * `draft` says (`undefined` leaves the chooser as it opened), for `frames`
 * quarter-seconds. What the rider rode and read, and what the trainer was sent.
 */
async function ride(options: {
  readonly draft?: boolean;
  readonly lapRace?: LapRaceChoice;
  readonly frames: number;
  /** Each frame's length after any countdown, ms: {@link FRAME_MS} unless given. */
  readonly frameMs?: number;
}): Promise<{
  readonly along: readonly number[];
  readonly draft: readonly (string | undefined)[];
  readonly written: readonly SimulationParameters[];
}> {
  const written: SimulationParameters[] = [];
  await openChooser(written, options.lapRace);
  odometers.length = 0;
  if (options.lapRace === undefined) {
    await clickThrough(toggle('pacer'));
    const intensity = queryAll<HTMLInputElement>(
      mounted?.container ?? document,
      'input[type="number"]',
    )[0];
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    await act(async () => {
      setter?.set?.call(intensity, '3');
      intensity?.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
  }
  const chosen = toggle(SWITCH);
  if (options.draft !== undefined && chosen !== undefined && chosen.checked !== options.draft) {
    await clickThrough(chosen);
  }
  await clickThrough(
    queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    ),
  );
  const draft: (string | undefined)[] = [];
  const countdown = options.lapRace === undefined ? 0 : LAP_RACE_COUNTDOWN_MS / COUNTDOWN_FRAME_MS;
  for (let frame = 0; frame < countdown + options.frames; frame += 1) {
    const next = pending.shift();
    if (next === undefined) break;
    nowMs += frame < countdown ? COUNTDOWN_FRAME_MS : (options.frameMs ?? FRAME_MS);
    await act(async () => {
      next(nowMs);
      await Promise.resolve();
    });
    draft.push(field('Draft'));
  }
  return { along: [...odometers], draft, written };
}

/** The percentage a Draft field reads, or `undefined` for none. */
const percentOf = (text: string | undefined): number | undefined => {
  const found = /^(\d+) %/.exec(text ?? '');
  return found === null ? undefined : Number(found[1]);
};

describe('the Draft choice in Your ride — #2967', () => {
  it('is a switch in Your ride, on by default, and this device remembers it off for the next ride', async () => {
    await openChooser([]);
    const loadout = mounted?.container.querySelector('.oyl-chooser__loadout');
    const draft = toggle(SWITCH);
    expect(draft).toBeDefined();
    expect(loadout?.contains(draft ?? null)).toBe(true);
    expect(draft?.getAttribute('role')).toBe('switch');
    expect(draft?.checked).toBe(true);
    expect(loadout?.textContent).not.toContain('No draft for you on this ride');
    await clickThrough(draft);
    expect(toggle(SWITCH)?.checked).toBe(false);
    expect(loadout?.textContent).toContain(
      'No draft for you on this ride: your speed is your own effort. Bots in a lap race still draft each other. Your trainer is never sent a draft.',
    );
    expect(localStorage.getItem(RIDER_DRAFT_STORAGE_KEY)).toBe('off');
    // The next visit to the chooser, as the device kept it.
    await openChooser([]);
    expect(toggle(SWITCH)?.checked).toBe(false);
    await clickThrough(toggle(SWITCH));
    await openChooser([]);
    expect(toggle(SWITCH)?.checked).toBe(true);
  });

  it('is not offered with the draft off in Settings, and says where it was turned off', async () => {
    localStorage.setItem(SOLO_DRAFT_STORAGE_KEY, 'off');
    await openChooser([]);
    expect(toggle(SWITCH)).toBeUndefined();
    expect(mounted?.container.querySelector('.oyl-chooser__loadout')?.textContent).toContain(
      'The draft is off on this device, in Settings, so you ride with none.',
    );
  });
});

/**
 * Two cases a mode, two rides a case: a ride is the cost (#1688, make a slow
 * case cheaper), and three in one case came within a second of Vitest's 5 s
 * under coverage.
 */
describe('a pacer ride with the rider’s Draft off — #2967, at the same power', () => {
  const FRAMES = 32;

  it('rides slower than with it on, and the HUD reads Off and why on every frame', async () => {
    const drafted = await ride({ draft: true, frames: FRAMES });
    const declined = await ride({ draft: false, frames: FRAMES });
    // Not vacuous: on, the pacer's wheel takes 10 % or more of the drag, and the
    // same 220 W rides further.
    expect(Math.max(...drafted.draft.map((text) => percentOf(text) ?? 0))).toBeGreaterThanOrEqual(
      10,
    );
    expect(drafted.along.length).toBeGreaterThan(20);
    expect(drafted.along.at(-1) ?? 0).toBeGreaterThan(declined.along.at(-1) ?? 0);
    expect(declined.draft.every((text) => text === 'Off Your choice')).toBe(true);
  });

  it('rides the undrafted ride frame for frame, and writes the trainer what it writes', async () => {
    const declined = await ride({ draft: false, frames: FRAMES });
    localStorage.setItem(SOLO_DRAFT_STORAGE_KEY, 'off');
    const undrafted = await ride({ frames: FRAMES });
    // Off: no draft at all, frame for frame the ride with the draft off in Settings.
    expect(declined.along.length).toBeGreaterThan(20);
    expect(declined.along).toEqual(undrafted.along);
    expect(undrafted.draft.every((text) => text === undefined)).toBe(true);
    // Trainer safety: the choice reaches no write. The writes are the undrafted ride's, one for one.
    expect(declined.written.length).toBeGreaterThan(5);
    expect(declined.written).toEqual(undrafted.written);
  });
});

describe('a lap race with the rider’s Draft off — #2967, at the same power', () => {
  const race: LapRaceChoice = { laps: 2, bots: 3, tier: 'brisk', itemsOn: false };
  /**
   * 20 s of racing after the countdown, which `ride` runs first, in frames of
   * half a second: a frame's cost is its render, not its steps (#1688, #2770),
   * and ten steps a frame is well inside `MAXIMUM_STEPS_PER_ADVANCE`.
   */
  const racing = { lapRace: race, frames: 40, frameMs: 500 } as const;

  beforeEach(() => {
    // The race's seed, fixed, so each ride is dealt the same field.
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
      <T extends ArrayBufferView>(array: T): T => {
        (array as unknown as Uint32Array)[0] = 2;
        return array;
      },
    );
  });

  it('takes no draft from the bots: slower than with it on, and Off on the HUD', async () => {
    const drafted = await ride({ draft: true, ...racing });
    const declined = await ride({ draft: false, ...racing });
    // Not vacuous: with it on the rider sat in a bot's draft and rode further.
    expect(Math.max(...drafted.draft.map((text) => percentOf(text) ?? 0))).toBeGreaterThanOrEqual(
      10,
    );
    expect(drafted.along.at(-1) ?? 0).toBeGreaterThan(declined.along.at(-1) ?? 0);
    expect(declined.draft.every((text) => text === 'Off Your choice')).toBe(true);
  });

  it('rides the rider as the race with no draft, frame for frame, with the same writes', async () => {
    const declined = await ride({ draft: false, ...racing });
    localStorage.setItem(SOLO_DRAFT_STORAGE_KEY, 'off');
    const undrafted = await ride(racing);
    // Off: the rider at `k = 1` behind the same bots, frame for frame the race with no draft.
    expect(declined.along.length).toBeGreaterThan(40);
    expect(declined.along).toEqual(undrafted.along);
    expect(declined.written.length).toBeGreaterThan(5);
    expect(declined.written).toEqual(undrafted.written);
  });
});

describe('no Draft field where nothing would give a draft — #2967', () => {
  it('shows none on a ride with no pacer and no race, with the rider’s Draft off', async () => {
    const written: SimulationParameters[] = [];
    await openChooser(written);
    await clickThrough(toggle(SWITCH));
    await clickThrough(
      queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find((button) =>
        (button.textContent ?? '').startsWith('Ride '),
      ),
    );
    for (let frame = 0; frame < 8; frame += 1) {
      const next = pending.shift();
      if (next === undefined) break;
      nowMs += FRAME_MS;
      await act(async () => {
        next(nowMs);
        await Promise.resolve();
      });
      expect(field('Draft')).toBeUndefined();
    }
  });
});
