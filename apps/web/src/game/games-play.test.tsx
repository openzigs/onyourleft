// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The setup a course chosen on the Games tab opens — #2292.
 *
 * A course picker's *Choose this course* is `shell/routes.ts`
 * §`hrefForGamePlay`'s link: the trainer game on that route with the game
 * switched on. Mounted through the real `GameView` at that address, and read
 * back the way a rider meets it: the chosen card, the switch's state, and,
 * once *Ride* is pressed, **the game that runs** — the lap race's frames, or
 * Delivery's notice for a route whose houses were not read, which only a ride
 * that asked for a round puts on the HUD. Each with its control: the same
 * route with no game asked for, and the game's switch turned off again, which
 * must be a ride with no game (the switch is the rider's once the page opens).
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watts } from '@onyourleft/domain';
import { circuitRouteId } from '@onyourleft/store';

import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';
import { hrefForGamePlay, hrefForGameRoute } from '../shell/routes';

import { GameView, type GamePort, type RidableRoute } from './GameView';
import { HOUSES_NOT_READY_TEXT } from './hud/delivery-announce';
import type { GameRenderer, SceneFrame } from './port';
import { circuitRoute, northRoute } from './route-fixtures-testing';
import { DELIVERY_CHOICE_TEXT, LAP_RACE_CHOICE_TEXT } from './StageChooser';
import { writeRealisticWorldChoice } from './world-preference';

const OUT: RidableRoute = {
  id: 'out',
  name: 'Out to the coast',
  profile: northRoute(2_000, () => 0),
  attempts: 0,
};
const LOOP: RidableRoute = {
  id: 'loop',
  name: 'Park loop',
  profile: circuitRoute(60),
  attempts: 0,
};

/** No corridor is read, so a round's press finds no mapped houses: the HUD says so. */
const PORT: GamePort = {
  listRoutes: () => Promise.resolve([OUT, LOOP]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(220), live: true, paired: true },
    cadence: { value: 88, live: true, paired: true },
    heartRate: { value: 140, live: true, paired: true },
  }),
};

let drawn: SceneFrame[] = [];
const RENDERER: GameRenderer = {
  loadRealisticWorld: () =>
    Promise.resolve({ loaded: false, offline: false, detail: 'no realistic world here' }),
  create: () => ({
    hasContext: true,
    prepare: () => Promise.resolve(),
    render: (frame: SceneFrame) => {
      drawn.push(frame);
    },
    setQuality: () => undefined,
    setRiderKit: () => undefined,
    setSeason: () => undefined,
    resize: () => undefined,
    destroy: () => undefined,
  }),
};

let pending: FrameRequestCallback[] = [];
let nowMs = 1_000_000;
let mounted: Mounted | undefined;

beforeEach(() => {
  pending = [];
  drawn = [];
  nowMs = 1_000_000;
  localStorage.clear();
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
  localStorage.clear();
  globalThis.location.hash = '';
});

/** The game's setup, opened at `hash` as the shell would open it. */
async function setupAt(hash: string, port: GamePort = PORT): Promise<void> {
  globalThis.location.hash = hash;
  mounted = await mount(
    <main>
      <h1>Trainer game</h1>
      <GameView port={port} renderer={() => Promise.resolve(RENDERER)} now={() => nowMs} />
    </main>,
  );
  await settle();
}

function switchNamed(words: string): HTMLInputElement | undefined {
  return queryAll<HTMLInputElement>(document.body, 'input[role="switch"]').find((box) =>
    (box.closest('label')?.textContent ?? '').includes(words),
  );
}

function chosenCard(): string | undefined {
  const radio = queryAll<HTMLInputElement>(
    document.body,
    '.oyl-chooser__card input[type="radio"]',
  ).find((each) => each.checked);
  return radio?.closest('.oyl-chooser__card')?.querySelector('h3')?.textContent ?? undefined;
}

async function ride(): Promise<void> {
  const button = queryAll<HTMLButtonElement>(document.body, 'button').find((each) =>
    (each.textContent ?? '').startsWith('Ride '),
  );
  if (button === undefined) throw new Error('the setup offers no Ride');
  await activateWithKeyboard(button);
  for (let frame = 0; frame < 4; frame += 1) {
    const due = pending;
    pending = [];
    nowMs += 500;
    await act(async () => {
      for (const callback of due) callback(nowMs);
      await Promise.resolve();
    });
  }
  await settle();
}

function noRoundSaid(): boolean {
  return [...document.querySelectorAll('.oyl-hud__notices .oyl-status')].some((element) =>
    (element.textContent ?? '').includes(HOUSES_NOT_READY_TEXT),
  );
}

describe('#2292 — a lap race course chosen on the Games tab', () => {
  it('opens the setup on that loop with the race switched on, and the race runs', async () => {
    await setupAt(hrefForGamePlay('lap-race', LOOP.id));
    expect(chosenCard()).toContain(LOOP.name);
    expect(switchNamed(LAP_RACE_CHOICE_TEXT.label)?.checked).toBe(true);
    await ride();
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.at(-1)?.lapRace).toBeDefined();
  });

  it('opens it switched off with no game asked for, and the ride has no race — the control', async () => {
    await setupAt(hrefForGameRoute(LOOP.id));
    expect(chosenCard()).toContain(LOOP.name);
    expect(switchNamed(LAP_RACE_CHOICE_TEXT.label)?.checked).toBe(false);
    await ride();
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every((frame) => frame.lapRace === undefined)).toBe(true);
  });

  it('rides no race once the rider switches it off again', async () => {
    await setupAt(hrefForGamePlay('lap-race', LOOP.id));
    await activateWithKeyboard(switchNamed(LAP_RACE_CHOICE_TEXT.label) as HTMLElement);
    expect(switchNamed(LAP_RACE_CHOICE_TEXT.label)?.checked).toBe(false);
    await ride();
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every((frame) => frame.lapRace === undefined)).toBe(true);
  });
});

describe('#2293 — a built-in circuit chosen on the Games tab', () => {
  /** A synthetic circuit, keyed as a shipped one is (ADR 0064 D-6.4). */
  const RING: RidableRoute = {
    id: circuitRouteId('fixture-ring'),
    name: 'Fixture ring',
    profile: circuitRoute(70),
    attempts: 0,
  };
  const WITH_CIRCUITS: GamePort = { ...PORT, listCircuits: () => Promise.resolve([RING]) };

  it('opens the setup on that circuit, not the rider’s first route, and the race runs', async () => {
    await setupAt(hrefForGamePlay('lap-race', RING.id), WITH_CIRCUITS);
    expect(chosenCard()).toContain(RING.name);
    await ride();
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.at(-1)?.lapRace).toBeDefined();
  });
});

describe('#2292 — a Delivery course chosen on the Games tab', () => {
  beforeEach(() => {
    // DL6: a round is offered with the realistic world chosen, and only then.
    writeRealisticWorldChoice(localStorage, true);
  });

  it('opens the setup on that route with the round switched on, and the press asks for one', async () => {
    await setupAt(hrefForGamePlay('delivery', OUT.id));
    expect(chosenCard()).toContain(OUT.name);
    expect(switchNamed(DELIVERY_CHOICE_TEXT.label)?.checked).toBe(true);
    await ride();
    expect(noRoundSaid()).toBe(true);
  });

  it('asks for no round with no game asked for — the control', async () => {
    await setupAt(hrefForGameRoute(OUT.id));
    expect(switchNamed(DELIVERY_CHOICE_TEXT.label)?.checked).toBe(false);
    await ride();
    expect(drawn.length).toBeGreaterThan(0);
    expect(noRoundSaid()).toBe(false);
  });

  it('asks for no round once the rider switches it off again', async () => {
    await setupAt(hrefForGamePlay('delivery', OUT.id));
    await activateWithKeyboard(switchNamed(DELIVERY_CHOICE_TEXT.label) as HTMLElement);
    expect(switchNamed(DELIVERY_CHOICE_TEXT.label)?.checked).toBe(false);
    await ride();
    expect(drawn.length).toBeGreaterThan(0);
    expect(noRoundSaid()).toBe(false);
  });
});
