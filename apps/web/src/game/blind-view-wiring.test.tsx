// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **A view with no drawing context is handed no frame after the one it is
 * prepared with, and the ride is otherwise the same** — #2524.
 *
 * `port.ts` §`hasContext`: a view whose WebGL context could not be had draws
 * nothing (`three-renderer.ts` §`render` returns at once), and the ride goes on
 * as a HUD over no world. `GameView` therefore builds that view no frame once
 * it is prepared: the frame was most of a frame's work, built for nobody. The
 * trainer gates ride such a view, so this file is what says it changes nothing
 * a trainer is sent.
 *
 * The same scripted ride is ridden twice through the real `GameView`, once
 * into a view that draws and once into one that cannot, and what is read is
 * what each consumer was handed: every simulation parameter written to the
 * trainer with the frame it was written on, the odometer the simulation
 * reached, and the HUD's figures on every frame.
 *
 * ⚠️ **This file is the drawing-view half of both trainer gates.** Those gates
 * (`draft-cannot-reach-trainer.test.tsx` and
 * `solo-draft-cannot-reach-trainer.test.tsx`) ride the blind view and prove
 * "blind and drafted writes what blind and alone writes". This file proves
 * "drawing writes what blind writes" for the same draft, so the two together
 * say what a device that draws sends. A frame-to-trainer coupling that exists
 * only while a draft does would pass an undrafted comparison, so there is one
 * trace per draft source: none, the gate's draft pinned with
 * `draftWith(DRAFTED)`, the bot pacer with the solo draft on, and the rider's
 * own ghost with the solo draft on. A new draft source adds its trace here.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildGhostTrack, watts, type GhostTrack } from '@onyourleft/domain';

import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { GameView, type GamePort, type RidableRoute } from './GameView';
import type { GameRenderer, SceneFrame } from './port';
import { northRoute } from './route-fixtures-testing';
import type { GameState } from './simulation';
import { SOLO_DRAFT_STORAGE_KEY } from './solo-draft-preference';
import { gameTrainerPortOver, type GameTrainerPort, type GradientTrainer } from './trainer-port';

/** A simulation as this file reads it: its odometer, its draft and its solo draft. */
interface Kept {
  readonly state: Pick<GameState, 'ride' | 'soloDraft'>;
  readonly draftFactor: number;
}

/**
 * Every `GameSimulation` built, newest last, so a ride's odometer can be read;
 * and the draft each is pinned at when it is built, as the draft gate pins it.
 */
const built = vi.hoisted(() => ({ simulations: [] as Kept[], k: undefined as number | undefined }));

vi.mock('./simulation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./simulation')>();
  class KeptSimulation extends actual.GameSimulation {
    constructor(...args: ConstructorParameters<typeof actual.GameSimulation>) {
      super(...args);
      if (built.k !== undefined) this.draftWith(built.k);
      built.simulations.push(this);
    }
  }
  return { ...actual, GameSimulation: KeptSimulation };
});

const START_MS = 1_000_000;
/** Four frames a second: several simulation steps a frame. */
const FRAME_MS = 250;
/** Fifteen seconds of ride: enough grades written to compare. */
const FRAMES = 60;

/** A road that climbs and falls, so the trainer is written often. */
const ROUTE: RidableRoute = {
  id: 'north',
  name: 'North road',
  profile: northRoute(2_000, (along) => 12 * Math.sin(along / 60)),
  attempts: 0,
};

/** The draft gate's figure, pinned the moment each simulation is built. */
const DRAFTED = 0.6;

/**
 * The rider's own earlier attempt: {@link GHOST_LEAD_METRES} up the road at
 * a steady {@link GHOST_SPEED}, close to this trace's own average, so the
 * rider rides inside its 30 m of draft for the whole ride.
 */
const GHOST_LEAD_METRES = 2;
const GHOST_SPEED = 2.4;
const OWN_GHOST: GhostTrack = buildGhostTrack({
  elapsedSeconds: [0, 600],
  distanceMetres: [GHOST_LEAD_METRES, GHOST_LEAD_METRES + 600 * GHOST_SPEED],
});

/** The pacer's W/kg: a touch stronger than the trace up this road, so the rider sits behind it. */
const PACER_INTENSITY = '4';

/** One ride's draft: none, the gate's pinned `k`, or a solo draft from the pacer or the ghost. */
type Draft = 'none' | 'pinned' | 'pacer' | 'ghost';

/** The scripted power: a function of the ride's clock alone, the same in both rides. */
function powerAt(nowMs: number): number {
  return 260 + 80 * Math.sin((nowMs - START_MS) / 2_000);
}

/**
 * The device's time of day both rides are ridden at — #2573. The HUD's
 * `Clock` field reads `Date` (`design/time-of-day.ts`), not the ride's
 * injected clock, so a minute that turned between the drawing ride and the
 * blind one changed that field and nothing else, and the HUD comparison went
 * red on a ride that was the same. `Date`, and only `Date`, is faked and frozen
 * here: the frames, the trainer and the simulation stay on `nowMs`, and every
 * timer stays real. The instant is a tenth of a second before a minute turns,
 * so a clock that is not frozen crosses that minute in every run and fails at
 * once, rather than once in a long while.
 */
const TIME_OF_DAY = new Date(2026, 10, 12, 4, 43, 59, 900);
/** {@link TIME_OF_DAY} as the HUD shows it. */
const CLOCK_SHOWN = 'Clock04:43';

let nowMs = START_MS;
let pending: FrameRequestCallback[] = [];
let mounted: Mounted | undefined;

beforeEach(() => {
  pending = [];
  nowMs = START_MS;
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TIME_OF_DAY);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

function port(draft: Draft): GamePort {
  return {
    listRoutes: () => Promise.resolve([{ ...ROUTE, attempts: draft === 'ghost' ? 1 : 0 }]),
    loadGhost: () => Promise.resolve(draft === 'ghost' ? OWN_GHOST : undefined),
    readSensors: () => ({
      rider: { power: watts(powerAt(nowMs)), live: true, paired: true },
      cadence: { value: 88, live: true, paired: true },
      heartRate: { value: 142, live: true, paired: true },
    }),
  };
}

function toggle(words: string): HTMLInputElement | undefined {
  return queryAll<HTMLInputElement>(mounted?.container ?? document, 'input[type="checkbox"]').find(
    (input) => (input.closest('label')?.textContent ?? '').includes(words),
  );
}

/** The control a `<label>` with exactly this text names, as a screen reader finds it. */
function labelled(words: string): HTMLInputElement {
  const label = queryAll<HTMLLabelElement>(mounted?.container ?? document, 'label').find(
    (candidate) => candidate.textContent === words,
  );
  const control = label?.control;
  if (!(control instanceof HTMLInputElement)) throw new Error(`no control labelled “${words}”`);
  return control;
}

async function press(element: HTMLElement | undefined): Promise<void> {
  if (element === undefined) throw new Error('no such control');
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
  await settle();
}

/** A trainer that keeps every simulation parameter it is sent, with the frame it came on. */
function trainerPort(written: unknown[], frame: () => number): GameTrainerPort {
  const control: GradientTrainer = {
    setSimulationParameters: async (parameters) => {
      written.push({ parameters, frame: frame() });
      return Promise.resolve();
    },
    letGo: async () => Promise.resolve({ kind: 'stopped' as const }),
  };
  return gameTrainerPortOver({
    getSnapshot: () => ({
      trainer: { paired: true, controllable: true, canSimulate: true, hasControl: true },
      workout: undefined,
    }),
    simulationControl: () => control,
    requestTrainerControl: async () => Promise.resolve(),
    noteGameRideEnded: () => undefined,
    subscribe: () => () => undefined,
  });
}

/** What one view was handed. */
interface Handed {
  prepared: number;
  rendered: SceneFrame[];
}

function renderer(hasContext: boolean, handed: Handed): GameRenderer {
  return {
    loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
    create: () => ({
      hasContext,
      prepare: () => {
        handed.prepared += 1;
        return Promise.resolve();
      },
      render: (frame: SceneFrame) => {
        handed.rendered.push(frame);
      },
      setQuality: () => undefined,
      setRiderKit: () => undefined,
      setSeason: () => undefined,
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };
}

/** Everything one ride left. */
interface Ridden {
  readonly handed: Handed;
  readonly written: readonly unknown[];
  readonly odometer: number;
  /** The HUD's fields as the rider reads them, frame by frame. */
  readonly hud: readonly string[];
  /** The simulation's draft at the end of the ride, and its solo draft. */
  readonly draftFactor: number;
  readonly soloDraft: GameState['soloDraft'];
}

async function ride(hasContext: boolean, draft: Draft): Promise<Ridden> {
  pending = [];
  nowMs = START_MS;
  localStorage.clear();
  // The solo draft is on by default; the two rides with no solo source say so.
  localStorage.setItem(SOLO_DRAFT_STORAGE_KEY, 'on');
  const handed: Handed = { prepared: 0, rendered: [] };
  const written: unknown[] = [];
  let frame = 0;
  built.simulations.length = 0;
  built.k = draft === 'pinned' ? DRAFTED : undefined;
  mounted = await mount(
    <GameView
      port={port(draft)}
      trainer={trainerPort(written, () => frame)}
      renderer={() => Promise.resolve(renderer(hasContext, handed))}
      now={() => nowMs}
    />,
  );
  await settle();
  if (draft === 'pacer') {
    await press(toggle('pacer'));
    const intensity = labelled('Pacer intensity, watts per kilogram');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    await act(async () => {
      setter?.set?.call(intensity, PACER_INTENSITY);
      intensity.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
  }
  if (draft === 'ghost') await press(toggle('Race your own'));
  await press(
    queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    ),
  );
  const hud: string[] = [];
  for (frame = 1; frame <= FRAMES; frame += 1) {
    const due = pending;
    if (due.length === 0) throw new Error(`the ride asked for no frame at ${String(frame)}`);
    pending = [];
    nowMs += FRAME_MS;
    await act(async () => {
      for (const callback of due) callback(nowMs);
      await Promise.resolve();
      await Promise.resolve();
    });
    hud.push(
      queryAll(mounted.container, '.oyl-hud__field')
        .map((field) => field.textContent ?? '')
        .join(' | '),
    );
  }
  await settle();
  const simulation = built.simulations.at(-1);
  const odometer = simulation?.state.ride.distance ?? Number.NaN;
  mounted.unmount();
  mounted = undefined;
  return {
    handed,
    written,
    odometer,
    hud,
    draftFactor: simulation?.draftFactor ?? Number.NaN,
    soloDraft: simulation?.state.soloDraft,
  };
}

/**
 * That the draft took effect in the ride that drew, so no row can pass
 * because its draft never did: the gate's pinned `k` is still the one ridden
 * at the end, and a solo draft rode some of its metres in the draft.
 */
function expectDrafted(draft: Draft, drawing: Ridden): void {
  if (draft === 'none') {
    expect(drawing.draftFactor).toBe(1);
    expect(drawing.soloDraft).toBeUndefined();
  } else if (draft === 'pinned') {
    expect(drawing.draftFactor).toBe(DRAFTED);
    expect(drawing.soloDraft).toBeUndefined();
  } else {
    expect(drawing.soloDraft?.inDraftMetres).toBeGreaterThan(20);
  }
}

describe('a view with no drawing context — #2524', () => {
  // Two rides of 60 frames a row: 0.30 to 0.43 s a row under `--coverage`
  // (Apple M4 Pro, Node 26.13.0, load average 5, 2026-11-12; #2535).
  it.each([
    ['ridden alone', 'none'],
    ["drafted at the draft gate's pinned k", 'pinned'],
    ['drafted behind the pacer, the solo draft on', 'pacer'],
    ["drafted behind the rider's own ghost, the solo draft on", 'ghost'],
  ] as const)(
    'is prepared once and handed no frame after it, where a view that draws is handed one a frame — %s',
    async (_name, draft: Draft) => {
      const drawing = await ride(true, draft);
      const blind = await ride(false, draft);
      // The control: the view that draws is prepared once and handed every
      // frame after it, so the ride did ask for frames.
      expect(drawing.handed.prepared).toBe(1);
      expect(drawing.handed.rendered.length).toBeGreaterThan(FRAMES - 5);
      // The view that cannot draw is still prepared, with one frame, and handed none.
      expect(blind.handed.prepared).toBe(1);
      expect(blind.handed.rendered).toEqual([]);
      expectDrafted(draft, drawing);
      // And the ride is the same: the same trainer writes on the same frames,
      // the same odometer, the same draft, the same HUD on every frame.
      expect(drawing.written.length).toBeGreaterThan(10);
      expect(blind.written).toStrictEqual(drawing.written);
      expect(drawing.odometer).toBeGreaterThan(20);
      expect(blind.odometer).toBe(drawing.odometer);
      expect(blind.soloDraft).toStrictEqual(drawing.soloDraft);
      expect(drawing.hud.every((line) => line.length > 0)).toBe(true);
      // The clock is still compared, and both rides read the frozen time of
      // day on every frame (#2573), so the comparison below sees the ride only.
      expect(drawing.hud.every((line) => line.split(' | ').includes(CLOCK_SHOWN))).toBe(true);
      expect(blind.hud).toEqual(drawing.hud);
    },
  );
});
