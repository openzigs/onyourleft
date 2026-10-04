// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A workout's eased target, in the trainer game — #585.
 *
 * A workout started on the Ride screen keeps ticking above the router while
 * the rider is in the game (`trainer-port.ts` §`GameTrainerKind` `workout`),
 * so its stall rescue can ease the trainer mid-ride. The HUD shows why, and
 * says it through its ONE region (`announce.ts`, as `workout-fault`) rather
 * than a region of its own.
 *
 * ⚠️ **Through `AppShell` and the REAL `gameTrainerPortOver`**, over a
 * controller double whose snapshot the test moves — so a port that stopped
 * reading `workout.rescue`, and a `GameView` that stopped asking the port, are
 * both red here.
 *
 * What this cannot establish: whether TalkBack speaks the region. That is
 * `docs/validation/0003` (#393).
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  altitudeMetres,
  CADENCE_SILENT_REASON,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  watts,
  type RoutePoint,
  type WorkoutRescue,
} from '@onyourleft/domain';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import type { GamePort, RidableRoute } from './GameView';
import type { GameRenderer } from './port';
import { gameTrainerPortOver } from './trainer-port';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

function flatRoute(): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 400; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(10),
    });
  }
  return { id: 'route-flat', name: 'Flat', profile: routeProfile(points), attempts: 0 };
}

const PORT: GamePort = {
  listRoutes: () => Promise.resolve([flatRoute()]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(230), live: true, paired: true },
    cadence: { value: 90, live: true, paired: true },
    heartRate: { value: 140, live: true, paired: true },
  }),
};

const RENDERER: GameRenderer = {
  loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
  create: () => ({
    hasContext: true,
    prepare: () => Promise.resolve(),
    render: () => undefined,
    setQuality: () => undefined,
    setRiderKit: () => undefined,
    resize: () => undefined,
    destroy: () => undefined,
  }),
};

const STALLED: WorkoutRescue = {
  kind: 'floor',
  reason: 'Pedalling has stopped, so the target has been dropped to the trainer’s lowest.',
};
const SILENT: WorkoutRescue = { kind: 'floor', reason: CADENCE_SILENT_REASON };

/** What the running workout's rescue is right now. The test moves it. */
let rescue: WorkoutRescue | undefined;

/** The ride controller, as far as the game's port reads it: a workout owns the trainer. */
const CONTROLLER = {
  getSnapshot: () => ({
    trainer: { paired: true, controllable: true, canSimulate: true, hasControl: true },
    workout: { status: 'running', rescue },
  }),
  simulationControl: () => undefined,
  requestTrainerControl: () => Promise.resolve(),
  noteGameRideEnded: () => undefined,
  subscribe: () => () => undefined,
};

let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let mounted: Mounted | undefined;

beforeEach(() => {
  pending = [];
  nowMs = 1_000_000;
  rescue = undefined;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  localStorage.clear();
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

/** Half a second of ride per frame. */
async function pump(frames: number): Promise<void> {
  for (let index = 0; index < frames; index += 1) {
    const next = pending.shift();
    if (next === undefined) return;
    nowMs += 500;
    await act(async () => {
      next(nowMs);
      await Promise.resolve();
    });
  }
}

async function startRide(): Promise<void> {
  globalThis.location.hash = '#/game';
  mounted = await mount(
    <AppShell
      capabilities={NO_BLUETOOTH}
      game={PORT}
      gameRenderer={() => Promise.resolve(RENDERER)}
      gameTrainer={gameTrainerPortOver(CONTROLLER)}
    />,
  );
  await settle();
  await press('Ride ');
}

/** Press the button whose text starts with `label`, and let React settle. */
async function press(label: string): Promise<void> {
  const button = queryAll<HTMLButtonElement>(document.body, 'button').find((each) =>
    (each.textContent ?? '').startsWith(label),
  );
  if (button === undefined) throw new Error(`no "${label}" button`);
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
  await settle();
}

const trainerNoticeControl = (): HTMLButtonElement | undefined =>
  queryAll<HTMLButtonElement>(document.body, 'button').find(
    (each) => each.textContent === 'Trainer notice',
  );

const region = (): string =>
  document.querySelector('[data-oyl-announcer="hud"]')?.textContent ?? '<no region>';

/** The HUD's notices as a rider sees them. */
const notices = (): string =>
  [...document.querySelectorAll('.oyl-hud__notices .oyl-status')]
    .map((each) => each.textContent ?? '')
    .join(' | ');

const voicesOnTheStage = (): readonly Element[] => [
  ...document.querySelectorAll(
    '.oyl-game [role="status"], .oyl-game [role="alert"], .oyl-game [aria-live]',
  ),
];

describe('a workout’s stall rescue on the game’s HUD — #585', () => {
  it('shows the stall, then the silent sensor, and clears once the target is back', async () => {
    await startRide();
    await pump(2);
    expect(notices()).not.toContain('Eased');

    rescue = STALLED;
    await pump(1);
    // #605: ONE sentence on the HUD — the rescue's own reason — and nothing
    // after it: no way back, no way out, no disclosure. The region says those
    // (the next case). @see GameView.tsx §"#605: ONE sentence on the HUD"
    expect(notices()).toBe(
      '!Eased: Pedalling has stopped, so the target has been dropped to the trainer’s lowest.',
    );
    expect(document.querySelector('.oyl-hud__notices details')).toBeNull();

    rescue = SILENT;
    await pump(1);
    expect(notices()).toContain(CADENCE_SILENT_REASON);
    expect(notices()).not.toContain('Pedalling has stopped');

    rescue = undefined;
    await pump(1);
    expect(notices()).not.toContain('Eased');
  });

  it('says each reason through the HUD’s one region, with announcements OFF', async () => {
    // Off by default: `workout-fault` is one of the kinds said regardless.
    await startRide();
    await pump(10);

    rescue = STALLED;
    await pump(1);
    expect(region()).toMatch(/^Eased: Pedalling has stopped/);
    // #605: the HUD SHOWS the headline alone, so the region is where the rest
    // is — the game has no End workout button, so it says where the button is.
    expect(region()).toContain('End the workout on the Ride screen to leave it.');

    rescue = SILENT;
    // The window is three seconds of RIDE: six half-second frames and a spare.
    await pump(8);
    expect(region()).toMatch(/^Eased: No cadence is being reported/);
    expect(voicesOnTheStage()).toHaveLength(1);
  });

  it('says a rescue already in force when the ride starts, on its first frames', async () => {
    rescue = STALLED;
    await startRide();
    // The road notice (rank 1) takes the first window; the rescue is rank 2
    // and waits for the next rather than being dropped with it.
    const heard: string[] = [];
    for (let frame = 0; frame < 12; frame += 1) {
      await pump(1);
      heard.push(region());
    }
    expect(heard.some((each) => each.startsWith('The road is not reaching your trainer'))).toBe(
      true,
    );
    // ⚠️ The case that was dropped: said AFTER the road notice, not instead.
    expect(heard.at(-1)).toMatch(/^Eased: Pedalling has stopped/);
    expect(notices()).toContain('Pedalling has stopped');
  });

  it('gives the one notice cell to the Eased notice, and the road notice back once it clears', async () => {
    // PR #599's review, finding B1: on a phone the two share the route
    // panel's cell, and together they pushed Pause and End ride off a
    // landscape stage. `ride.browser.spec.ts` §"#585" measures the layout;
    // this pins the rule it rests on.
    await startRide();
    await pump(2);
    // The apparatus: before the rescue the road notice stands, with its control.
    expect(notices()).toContain('workout is driving your trainer');
    expect(trainerNoticeControl()).toBeDefined();

    rescue = STALLED;
    await pump(1);
    expect(notices()).toContain('Pedalling has stopped');
    expect(document.querySelector('.oyl-hud__notices')?.textContent ?? '').not.toContain(
      'workout is driving your trainer',
    );
    expect(trainerNoticeControl()).toBeUndefined();

    rescue = undefined;
    await pump(1);
    expect(notices()).not.toContain('Eased');
    expect(notices()).toContain('workout is driving your trainer');
    expect(trainerNoticeControl()).toBeDefined();
  });

  it('says a rescue still in force again when a second ride starts in the same view', async () => {
    // PR #599's review, N2: `start` clears what was last said, so a rescue that
    // outlasts one ride is said at the start of the next rather than taken as
    // already heard.
    rescue = STALLED;
    await startRide();
    await pump(12);
    expect(region()).toMatch(/^Eased: Pedalling has stopped/);

    await press('End ride');
    await press('Ride ');
    const heard: string[] = [];
    for (let frame = 0; frame < 12; frame += 1) {
      await pump(1);
      heard.push(region());
    }
    // The apparatus: the second ride's road notice was said, so the region
    // really did move on from the first ride's last sentence.
    expect(heard.some((each) => each.startsWith('The road is not reaching your trainer'))).toBe(
      true,
    );
    expect(heard.at(-1)).toMatch(/^Eased: Pedalling has stopped/);
  });

  it('does not say a rescue that cleared while its sentence was waiting — PR #599, N1', async () => {
    rescue = STALLED;
    await startRide();
    // The road notice takes the first window; the Eased sentence waits.
    await pump(2);
    expect(region()).toMatch(/^The road is not reaching your trainer/);

    // Cleared a second into the ride, before the window opens again.
    rescue = undefined;
    const heard: string[] = [];
    for (let frame = 0; frame < 12; frame += 1) {
      await pump(1);
      heard.push(region());
    }
    expect(heard.filter((each) => each.startsWith('Eased'))).toEqual([]);
  });

  it('passes the accessibility audit with the notice standing', async () => {
    rescue = STALLED;
    await startRide();
    await pump(2);
    const violations = auditAccessibility(document);
    expect(violations, formatViolations(violations)).toStrictEqual([]);
  });
});
