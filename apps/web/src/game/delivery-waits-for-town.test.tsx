// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2392, the owner's ruling of 2026-11-08 on #2362: **a Delivery round on a
 * realistic ride does not count its first house until the realistic world has
 * loaded, or has failed to load.** The stylised world is drawn while the set
 * arrives, so a round begun at the press could score or miss houses before the
 * town's buildings were there to see.
 *
 * The real `GameView`, the real round, HUD and announcer, driven as
 * `delivery-wiring.test.tsx` drives them: the doubles are the store behind
 * `GamePort`, the GL context, the clock, the platform's random source and the
 * renderer's `loadRealisticWorld`, which here is a promise the test settles.
 * What is read is what a rider reads (the HUD), what each drawn frame carried
 * and what the device kept.
 *
 * The rider rides past the window of the first house a round begun at the
 * press would have held, while the load is pending; so a round counting from
 * the press is red here as a miss on the HUD.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watts } from '@onyourleft/domain';

import { riderMassFor } from '../athlete/mass';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { DELIVERY_PROGRESS_STORAGE_KEY, readDeliveryProgress } from './delivery/delivery-progress';
import { deliveryTown } from './delivery/delivery-town-testing';
import { startDeliveryRide } from './delivery/ride-round';
import type { WeekProgress } from './delivery/round';
import { THROW_WINDOW_AFTER_METRES } from './delivery/throw';
import { GameView, type GamePort, type RidableRoute } from './GameView';
import { endRideAnswer } from './end-ride-testing';
import { ANNOUNCEMENTS_STORAGE_KEY, DEFAULT_ANNOUNCEMENTS } from './hud/announce-preference';
import type { GameRenderer, SceneFrame } from './port';
import { REALISTIC_ARRIVAL_LIMIT_MS } from './quality';
import { lineOffsetAt, racingLine } from './racing-line';
import type { RealisticWorldOutcome } from './realistic-assets';
import { DEFAULT_RIDING_POSITION, rideConditionsFor } from './rider';
import { GameSimulation } from './simulation';
import { corridorOrigin } from './terrain';
import { writeRealisticWorldChoice } from './world-preference';

/** Every sentence the real announcer said, in order. */
const said = vi.hoisted((): string[] => []);
vi.mock('./hud/announce', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hud/announce')>();
  return {
    ...actual,
    announce: (...args: Parameters<typeof actual.announce>) => {
      const heard = actual.announce(...args);
      if (heard.sentence !== undefined) said.push(heard.sentence);
      return heard;
    },
  };
});

/** Where the rider was each time `GameView` began a round. */
const begunAt = vi.hoisted((): number[] => []);
vi.mock('./delivery/ride-round', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./delivery/ride-round')>();
  return {
    ...actual,
    startDeliveryRide: (...args: Parameters<typeof actual.startDeliveryRide>) => {
      begunAt.push(args[0].riderDistance);
      return actual.startDeliveryRide(...args);
    },
  };
});

const town = deliveryTown('delivery-waits');
const ROUTE: RidableRoute = {
  id: 'delivery-waits',
  name: 'Town',
  profile: town.profile,
  attempts: 0,
};
const WEEK: WeekProgress = { day: 2, houses: 3, score: 4 };
const SEED = 7;
const FRAME_MS = 200;
const START_MS = 1_000_000;

let nowMs = START_MS;
let pending: FrameRequestCallback[] = [];
let mounted: Mounted | undefined;

const port: GamePort = {
  listRoutes: () => Promise.resolve([ROUTE]),
  loadGhost: () => Promise.resolve(undefined),
  loadWorldCorridor: () => Promise.resolve({ kind: 'ready' as const, corridor: town.corridor }),
  readSensors: () => ({
    rider: { power: watts(300), live: true, paired: true },
    cadence: { value: 88, live: true, paired: true },
    heartRate: { value: 142, live: true, paired: true },
  }),
};

/** A renderer whose realistic world arrives when the test settles {@link settleLoad}. */
function arrivingRenderer(frames: SceneFrame[]): {
  readonly renderer: GameRenderer;
  readonly settleLoad: (outcome: RealisticWorldOutcome | Error) => Promise<void>;
  readonly asked: () => boolean;
} {
  let resolve: ((outcome: RealisticWorldOutcome) => void) | undefined;
  let reject: ((error: Error) => void) | undefined;
  return {
    renderer: {
      loadRealisticWorld: () =>
        new Promise<RealisticWorldOutcome>((yes, no) => {
          resolve = yes;
          reject = no;
        }),
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
    },
    settleLoad: async (outcome) => {
      await act(async () => {
        if (outcome instanceof Error) reject?.(outcome);
        else resolve?.(outcome);
        await Promise.resolve();
      });
      await settle();
    },
    asked: () => resolve !== undefined,
  };
}

beforeEach(() => {
  pending = [];
  nowMs = START_MS;
  said.length = 0;
  begunAt.length = 0;
  localStorage.clear();
  localStorage.setItem(
    ANNOUNCEMENTS_STORAGE_KEY,
    JSON.stringify({ ...DEFAULT_ANNOUNCEMENTS, enabled: true }),
  );
  localStorage.setItem(DELIVERY_PROGRESS_STORAGE_KEY, JSON.stringify(WEEK));
  writeRealisticWorldChoice(localStorage, true);
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
    <T extends ArrayBufferView>(array: T): T => {
      (array as unknown as Uint32Array)[0] = SEED;
      return array;
    },
  );
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

/** One animation frame, `ms` of wall clock after the last. */
async function pump(ms = FRAME_MS): Promise<void> {
  const due = pending;
  if (due.length === 0) throw new Error('the ride asked for no frame');
  pending = [];
  nowMs += ms;
  await act(async () => {
    for (const callback of due) callback(nowMs);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function clickThrough(element: HTMLElement | undefined): Promise<void> {
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

/** The HUD's Delivery field by its label: its value and the phrase under it. */
function field(label: string): { readonly value: string; readonly detail: string } | undefined {
  const items = queryAll<HTMLElement>(mounted?.container ?? document, '.oyl-hud__field--delivery');
  const found = items.find((each) => (each.textContent ?? '').startsWith(label));
  if (found === undefined) return undefined;
  return {
    value: found.querySelector('.oyl-hud__value')?.firstChild?.textContent ?? '',
    detail: (found.querySelector('.oyl-hud__detail')?.textContent ?? '').trim(),
  };
}

function notices(): string {
  return mounted?.container.querySelector('.oyl-hud__notices')?.textContent ?? '';
}

/**
 * How many frames of this file's ride carry the rider past the close of the
 * first house's window on the round a press would have begun: the ride's own
 * simulation, built as `GameView` builds one, and the round's own pick.
 */
const FRAMES_PAST_FIRST_HOUSE = ((): number => {
  const store = new Map([[DELIVERY_PROGRESS_STORAGE_KEY, JSON.stringify(WEEK)]]);
  const spy = vi
    .spyOn(globalThis.crypto, 'getRandomValues')
    .mockImplementation(<T extends ArrayBufferView>(array: T): T => {
      (array as unknown as Uint32Array)[0] = SEED;
      return array;
    });
  const atPress = startDeliveryRide({
    buildings: town.buildings,
    profile: town.profile,
    origin: corridorOrigin(town.profile),
    riderDistance: 0,
    lineOffset: lineOffsetAt(racingLine(town.profile), 0),
    storage: { getItem: (key) => store.get(key) ?? null, setItem: () => undefined },
  });
  spy.mockRestore();
  const first = atPress?.throwTargets[0];
  if (first === undefined) throw new Error('the town gave a press no round');
  const simulation = new GameSimulation({
    profile: town.profile,
    conditions: rideConditionsFor(riderMassFor(undefined).mass, DEFAULT_RIDING_POSITION),
  });
  for (let frame = 1; frame < 2_000; frame += 1) {
    simulation.advanceTo(START_MS + frame * FRAME_MS, { power: watts(300), live: true });
    // Two metres on, so the round's own sweep of the frame is past it too.
    if (simulation.state.ride.distance > first.along + THROW_WINDOW_AFTER_METRES + 2) {
      return frame + 1;
    }
  }
  throw new Error('the ride never passed the first house');
})();

/** Mount the game with a round on and the realistic world chosen, and press Ride. */
async function pressRide(
  renderer: GameRenderer,
  load: () => Promise<GameRenderer> = () => Promise.resolve(renderer),
): Promise<void> {
  mounted = await mount(<GameView port={port} renderer={load} now={() => nowMs} delivery />);
  await settle();
  await clickThrough(buttonStarting('Ride '));
}

describe('a Delivery round waits for the realistic town before counting a house — #2392', () => {
  it('scores and misses nothing while the town loads, then counts from where the rider is', async () => {
    const drawn: SceneFrame[] = [];
    const arriving = arrivingRenderer(drawn);
    await pressRide(arriving.renderer);
    for (let index = 0; index < FRAMES_PAST_FIRST_HOUSE; index += 1) await pump();
    await settle();
    // Non-vacuity: the load was asked for and the stylised world was drawn meanwhile.
    expect(arriving.asked()).toBe(true);
    expect(drawn.length).toBeGreaterThan(10);
    // No round while it loads: none begun, none on the HUD, none drawn, none said.
    expect(begunAt).toEqual([]);
    expect(field('Houses')).toBeUndefined();
    expect(mounted?.container.querySelector('[aria-label="Throw a parcel"]')).toBeNull();
    expect(drawn.every((frame) => frame.delivery === undefined)).toBe(true);
    expect(said.filter((text) => /^(Delivered|Missed|Crashed|Round over)/.test(text))).toEqual([]);
    const loadedFrom = drawn.length;

    await arriving.settleLoad({ loaded: true });
    for (let index = 0; index < 3; index += 1) await pump();
    await settle();
    // Begun once, past where a round begun at the press would already have missed a house.
    expect(begunAt).toHaveLength(1);
    expect(begunAt[0]).toBeGreaterThan(0);
    expect(field('Houses')).toEqual({
      value: String(WEEK.houses),
      detail: '0 delivered, 0 missed',
    });
    expect(mounted?.container.querySelector('[aria-label="Throw a parcel"]')).not.toBeNull();
    const after = drawn.slice(loadedFrom);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((frame) => (frame.delivery?.markers.length ?? 0) > 0)).toBe(true);
    expect(said.filter((text) => text.startsWith('Missed'))).toEqual([]);

    // A ride ended now has passed no house of its round, so the week is as it was.
    await clickThrough(buttonStarting('End ride'));
    await clickThrough(endRideAnswer(document, 'End ride'));
    expect(readDeliveryProgress(localStorage)).toEqual(WEEK);
  });

  it.each([
    ['fails', { loaded: false, offline: true, detail: 'offline' }],
    ['rejects', new Error('the set could not be read')],
  ] as const)(
    'begins the round in the stylised world the ride falls back to when the load %s',
    async (_how, outcome) => {
      const drawn: SceneFrame[] = [];
      const arriving = arrivingRenderer(drawn);
      await pressRide(arriving.renderer);
      for (let index = 0; index < 10; index += 1) await pump();
      expect(begunAt).toEqual([]);
      expect(field('Houses')).toBeUndefined();

      await arriving.settleLoad(outcome);
      // D-7's fallback is said, and the round is ridden in that world.
      expect(notices().length).toBeGreaterThan(0);
      for (let index = 0; index < 3; index += 1) await pump();
      await settle();
      expect(begunAt).toHaveLength(1);
      expect(begunAt[0]).toBeGreaterThan(0);
      expect(field('Houses')).toEqual({
        value: String(WEEK.houses),
        detail: '0 delivered, 0 missed',
      });
      expect(drawn.at(-1)?.delivery?.markers.length).toBeGreaterThan(0);
    },
  );

  it('holds the round no longer than the arrival window when the load never settles', async () => {
    const arriving = arrivingRenderer([]);
    await pressRide(arriving.renderer);
    for (let index = 0; index < 5; index += 1) await pump();
    // One frame short of the window: still waiting.
    await pump(REALISTIC_ARRIVAL_LIMIT_MS - 6 * FRAME_MS);
    await settle();
    expect(begunAt).toEqual([]);
    await pump(2 * FRAME_MS);
    await settle();
    expect(begunAt).toHaveLength(1);
  });

  it('begins the round when the renderer module itself fails to load', async () => {
    const arriving = arrivingRenderer([]);
    await pressRide(arriving.renderer, () => Promise.reject(new Error('three did not arrive')));
    for (let index = 0; index < 3; index += 1) await pump();
    await settle();
    expect(begunAt).toHaveLength(1);
    expect(field('Houses')?.value).toBe(String(WEEK.houses));
  });

  it('begins the round at the press on a ride in the standard world, which loads nothing', async () => {
    writeRealisticWorldChoice(localStorage, false);
    const arriving = arrivingRenderer([]);
    await pressRide(arriving.renderer);
    expect(arriving.asked()).toBe(false);
    expect(begunAt).toEqual([0]);
    await pump();
    expect(field('Houses')?.value).toBe(String(WEEK.houses));
  });
});
