// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2663: **the realistic world is never drawn into a shown frame before the
 * view has been prepared with it.** A realistic ride draws the stylised world
 * while the realistic set arrives (#475), and a lap race counts down ten
 * seconds from the press (#2546), so on the tablet the set lands inside the
 * countdown or just after Go. Until #2663 the swap's next frame was drawn at
 * once, and three linked the realistic world's programs and uploaded its
 * textures inside that one frame — `quality.ts` §`REALISTIC_SETTLING_SAMPLES`
 * said so — which is the 1.5–3 s frame the owner's tablet logged around a lap
 * race's start. Now the arrival unprepares the view, the next frame the loop
 * builds is the one it is prepared with (#547's order), and nothing is drawn
 * until that `prepare` settles.
 *
 * The real `GameView`, the real lap race, simulation and HUD. The doubles are
 * the store behind `GamePort`, the GL context and the clock, and the
 * renderer: its `loadRealisticWorld` and every `prepare` are promises the test
 * settles, and its view writes down, in order, every call `GameView` makes on
 * it. What is read is that order — the one a real view would draw in.
 *
 * ⚠️ What this cannot say: how long a real `prepare` of the realistic world
 * takes, or that it leaves the next frames cheap. The browser gate's
 * realistic describe measures that (`game.browser.spec.ts` §"#2663"), and only
 * the tablet's moving-ride frame check measures the stall itself.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { kilograms, watts } from '@onyourleft/domain';

import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { GameView, type GamePort, type RidableRoute } from './GameView';
import type { LapRaceChoice } from './lap-race/choice';
import { LAP_RACE_COUNTDOWN_MS } from './lap-race/ride-race';
import type { GameRenderer } from './port';
import type { QualitySettings } from './quality';
import type { RealisticWorldOutcome } from './realistic-assets';
import { RACE_TEXT } from './room-ride';
import { circuitRoute } from './route-fixtures-testing';
import { writeRealisticWorldChoice } from './world-preference';

/** A loop of about 250 m, as `lap-race-countdown-wiring.test.tsx` rides. */
const CIRCUIT = circuitRoute(40, () => 0);
const ROUTE: RidableRoute = { id: 'lap-race', name: 'Race loop', profile: CIRCUIT, attempts: 0 };
const RACE: LapRaceChoice = { laps: 2, bots: 3, tier: 'hard', itemsOn: true };

const FRAME_MS = 100;
const START_MS = 1_000_000;

/** One call `GameView` made on the view, in the order it made them. */
type Call =
  | { readonly kind: 'prepare'; readonly world: QualitySettings['world'] }
  | { readonly kind: 'render'; readonly world: QualitySettings['world'] }
  | { readonly kind: 'setQuality'; readonly world: QualitySettings['world'] };

let nowMs = START_MS;
let pending: FrameRequestCallback[] = [];
let mounted: Mounted | undefined;

const port: GamePort = {
  listRoutes: () => Promise.resolve([ROUTE]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(250), live: true, paired: true },
    cadence: { value: 88, live: true, paired: true },
    heartRate: { value: 142, live: true, paired: true },
  }),
};

/**
 * A renderer whose realistic world arrives when the test says, and whose
 * view's every `prepare` settles when the test says. The view draws the world
 * its last `setQuality` asked for once the set has arrived — `three-renderer.ts`
 * §`#applyWorld` — and the stylised world before then, so each call records the
 * world a real view would be drawing at that moment.
 */
function arrivingRenderer(calls: Call[]): {
  readonly renderer: GameRenderer;
  readonly arrive: () => Promise<void>;
  /** Settles the oldest `prepare` still in flight. */
  readonly settlePrepare: () => Promise<void>;
  readonly preparesInFlight: () => number;
} {
  let resolveLoad: ((outcome: RealisticWorldOutcome) => void) | undefined;
  let loaded = false;
  let asked: QualitySettings['world'] = 'stylised';
  const prepares: (() => void)[] = [];
  const drawing = (): QualitySettings['world'] =>
    loaded && asked === 'realistic' ? 'realistic' : 'stylised';
  return {
    renderer: {
      loadRealisticWorld: () =>
        new Promise<RealisticWorldOutcome>((resolve) => {
          resolveLoad = (outcome) => {
            loaded = outcome.loaded;
            resolve(outcome);
          };
        }),
      create: (_canvas, settings) => {
        asked = settings.world;
        return {
          hasContext: true,
          prepare: () => {
            calls.push({ kind: 'prepare', world: drawing() });
            return new Promise<void>((resolve) => {
              prepares.push(resolve);
            });
          },
          render: () => {
            calls.push({ kind: 'render', world: drawing() });
          },
          setQuality: (settings: QualitySettings) => {
            asked = settings.world;
            calls.push({ kind: 'setQuality', world: drawing() });
          },
          setRiderKit: () => undefined,
          setSeason: () => undefined,
          resize: () => undefined,
          destroy: () => undefined,
        };
      },
    },
    arrive: async () => {
      if (resolveLoad === undefined)
        throw new Error('the ride never asked for the realistic world');
      await act(async () => {
        resolveLoad?.({ loaded: true });
        await Promise.resolve();
      });
      await settle();
    },
    settlePrepare: async () => {
      const resolve = prepares.shift();
      if (resolve === undefined) throw new Error('no prepare is in flight');
      await act(async () => {
        resolve();
        await Promise.resolve();
      });
    },
    preparesInFlight: () => prepares.length,
  };
}

beforeEach(() => {
  pending = [];
  nowMs = START_MS;
  localStorage.clear();
  writeRealisticWorldChoice(localStorage, true);
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
  vi.restoreAllMocks();
  localStorage.clear();
});

/** `count` animation frames, {@link FRAME_MS} of wall clock apart. */
async function pump(count = 1): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    const due = pending;
    if (due.length === 0) throw new Error('the ride asked for no frame');
    pending = [];
    nowMs += FRAME_MS;
    await act(async () => {
      for (const callback of due) callback(nowMs);
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

/** Mounts a game ride with a solo lap race on the realistic world, and presses *Ride*. */
async function rideARace(renderer: GameRenderer): Promise<HTMLElement> {
  mounted = await mount(
    <GameView
      port={port}
      renderer={() => Promise.resolve(renderer)}
      now={() => nowMs}
      riderMass={kilograms(72)}
      lapRace={RACE}
    />,
  );
  await settle();
  const ride = queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
    (button.textContent ?? '').startsWith('Ride '),
  );
  await act(async () => {
    ride?.click();
    await Promise.resolve();
  });
  await settle();
  return mounted.container;
}

/** The calls made after the first call that matches `match`. */
function after(calls: readonly Call[], match: Call): readonly Call[] {
  const at = calls.findIndex((each) => each.kind === match.kind && each.world === match.world);
  if (at < 0) throw new Error(`no ${match.kind} of the ${match.world} world was made`);
  return calls.slice(at + 1);
}

/** What the HUD's *Race* notice says. */
function raceNotice(root: ParentNode): string {
  return root.querySelector('.oyl-hud__race')?.textContent ?? '';
}

describe('the realistic world arriving in a lap race’s countdown is prepared before it is drawn — #2663', () => {
  it('draws no realistic frame until a prepare of the realistic world has settled, and then draws it', async () => {
    const calls: Call[] = [];
    const { renderer, arrive, settlePrepare } = arrivingRenderer(calls);
    const root = await rideARace(renderer);
    // The ride's first frame prepares the stylised view; it settles and the
    // stylised world is drawn, as on main.
    await pump();
    await settlePrepare();
    await pump(5);
    expect(calls.filter((each) => each.kind === 'render' && each.world === 'stylised').length).toBe(
      5,
    );
    // The countdown is running: the set arrives inside it, as on the tablet.
    expect(raceNotice(root)).toContain(RACE_TEXT.counting(10));
    await arrive();
    expect(calls.at(-1)).toEqual({ kind: 'setQuality', world: 'realistic' });

    // The next frame is the one the realistic world is prepared with, and no
    // frame is drawn while that prepare is in flight — however long it takes.
    await pump(20);
    const sinceSwap = after(calls, { kind: 'setQuality', world: 'realistic' });
    expect(sinceSwap[0]).toEqual({ kind: 'prepare', world: 'realistic' });
    expect(sinceSwap.filter((each) => each.kind === 'render')).toEqual([]);
    // Asked once, not once a frame.
    expect(sinceSwap.filter((each) => each.kind === 'prepare')).toHaveLength(1);
    // The countdown went on meanwhile: the HUD is not the world.
    expect(raceNotice(root)).toContain(RACE_TEXT.counting(8));

    // Once it settles the realistic world is drawn, every frame.
    await settlePrepare();
    await pump(3);
    const sincePrepared = after(calls, { kind: 'prepare', world: 'realistic' });
    expect(sincePrepared).toEqual([
      { kind: 'render', world: 'realistic' },
      { kind: 'render', world: 'realistic' },
      { kind: 'render', world: 'realistic' },
    ]);
  });

  it('lets a first prepare the arrival overtook ready nothing: only the prepare of the realistic world does', async () => {
    const calls: Call[] = [];
    const { renderer, arrive, settlePrepare, preparesInFlight } = arrivingRenderer(calls);
    await rideARace(renderer);
    // The stylised warm-up is still in flight when the set lands.
    await pump();
    expect(preparesInFlight()).toBe(1);
    await arrive();
    await pump();
    expect(preparesInFlight()).toBe(2);
    // The stylised warm-up settles first. Drawing now would be the realistic
    // world's first frame, unprepared: the stall.
    await settlePrepare();
    await pump(10);
    expect(calls.filter((each) => each.kind === 'render')).toEqual([]);
    // The realistic world's own prepare readies the view.
    await settlePrepare();
    await pump(2);
    expect(after(calls, { kind: 'prepare', world: 'realistic' })).toEqual([
      { kind: 'render', world: 'realistic' },
      { kind: 'render', world: 'realistic' },
    ]);
  });

  it('lets a prepare that settles before the next frame ready nothing: the arrival bumps the round itself', async () => {
    const calls: Call[] = [];
    const { renderer, arrive, settlePrepare } = arrivingRenderer(calls);
    await rideARace(renderer);
    // The stylised warm-up is in flight when the set lands, and it settles in
    // the window between the arrival and the next animation frame: its round
    // is still the current one unless the arrival moved it on.
    await pump();
    await arrive();
    await settlePrepare();
    await pump(10);
    expect(calls.filter((each) => each.kind === 'render')).toEqual([]);
    expect(after(calls, { kind: 'setQuality', world: 'realistic' })[0]).toEqual({
      kind: 'prepare',
      world: 'realistic',
    });
  });

  it('still counts the race down on the ride’s frames while the realistic world is prepared', async () => {
    const calls: Call[] = [];
    const { renderer, arrive, settlePrepare } = arrivingRenderer(calls);
    const root = await rideARace(renderer);
    await pump();
    await settlePrepare();
    await arrive();
    // Every second of the countdown and Go, with the prepare never settling.
    const notices: string[] = [];
    for (let frame = 0; frame < LAP_RACE_COUNTDOWN_MS / FRAME_MS; frame += 1) {
      await pump();
      notices.push(raceNotice(root));
    }
    expect(notices.some((each) => each.includes(RACE_TEXT.counting(1)))).toBe(true);
    expect(notices.at(-1)).toContain(RACE_TEXT.go);
    expect(calls.filter((each) => each.kind === 'render' && each.world === 'realistic')).toEqual(
      [],
    );
  });
});
