// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A ride that may stop with the screen off — #647, through the real shell and
 * the REAL ride controller.
 *
 * Until #647 `ride/controller.ts` §`quietly` swallowed a refused keep-alive
 * (the Android recording service not starting) and nothing told the rider. The
 * controller here is `createRideController` over the sensor simulator, handed
 * a keep-alive port that refuses the way `RecordingServicePlugin.java` does
 * with no Bluetooth permission, and then accepts — so what is read off the
 * screen is what that refusal produces, not a snapshot this file typed.
 *
 * - the Ride screen (`#/ride`, `views/RideView.tsx`) shows ONE sentence under
 *   *Pause* / *Stop*, in no `<details>`, and says it once through the ride's
 *   one region when announcements are on;
 * - the game's HUD shows the same sentence in its notice cell, through the
 *   REAL `gameTrainerPortOver`, and says it once through the HUD's region;
 * - both clear once a sensor pairs and the second ask succeeds.
 *
 * What this cannot establish: whether TalkBack speaks either region
 * (`docs/validation/0003`), and whether Android refuses the service on a
 * fresh install — that is the owner's hardware step on #647.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  seconds,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';
import { createSimulator, ftmsTrainer, type SimulatorBench } from '@onyourleft/sensors/simulator';
import { athleteId, recordingSessionId } from '@onyourleft/store';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import type { GamePort, RidableRoute } from '../game/GameView';
import * as core from '../game/hud/announce';
import {
  ANNOUNCEMENTS_STORAGE_KEY,
  DEFAULT_ANNOUNCEMENTS,
  writeAnnouncementPreference,
} from '../game/hud/announce-preference';
import type { GameRenderer } from '../game/port';
import { gameTrainerPortOver } from '../game/trainer-port';
import type { RecordingCheckpointStore } from '../recording/recorder';
import { AppShell } from '../shell/AppShell';
import { hrefFor, routeById } from '../shell/routes';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { ridingSnapshot, stubRideController } from './testing';
import {
  createRideController,
  KEEP_SCREEN_ON_LABEL,
  RIDE_MAY_STOP_SPOKEN,
  RIDE_MAY_STOP_WITH_SCREEN_OFF,
  type RideController,
} from './controller';

vi.mock('../game/hud/announce', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../game/hud/announce')>();
  return { ...actual, announce: vi.fn(actual.announce) };
});

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };
const SHOWN = `!${KEEP_SCREEN_ON_LABEL}: ${RIDE_MAY_STOP_WITH_SCREEN_OFF}`;

/** Checkpoints that land and are never read back: not what this file is about. */
const CHECKPOINTS: RecordingCheckpointStore = {
  putRecordingSession: (record) => Promise.resolve(record.id),
  appendRecordingChunk: () => Promise.resolve(1),
  listRecordingSessions: () => Promise.resolve([]),
  recoverRecording: () => Promise.resolve(undefined),
  deleteRecordingSession: () => Promise.resolve(true),
};

interface Rig {
  readonly controller: RideController;
  readonly bench: SimulatorBench;
  /** Every `keepRideAlive` call, in order. */
  readonly asked: number[];
}

/** The real controller, whose keep-alive refuses the first ask and accepts after. */
function refusingRig(): Rig {
  const { transport, bench } = createSimulator({
    devices: [ftmsTrainer({ id: 'kickr', name: 'KICKR 1F2A' })],
  });
  const asked: number[] = [];
  const controller = createRideController({
    transport,
    store: CHECKPOINTS,
    athleteId: athleteId('rider'),
    newSessionId: () => recordingSessionId('ride-1'),
    now: () => bench.now,
    keepAlive: {
      keepRideAlive: () => {
        asked.push(asked.length);
        return asked.length === 1
          ? Promise.reject(new Error('The Bluetooth permission is not granted'))
          : Promise.resolve();
      },
      letRideSleep: () => Promise.resolve(),
    },
  });
  return { controller, bench, asked };
}

let mounted: Mounted | undefined;
let rig: Rig | undefined;

beforeEach(() => {
  vi.mocked(core.announce).mockClear();
  localStorage.clear();
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  rig?.controller.dispose();
  rig = undefined;
  globalThis.location.hash = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

function announcementsOn(): void {
  writeAnnouncementPreference(localStorage, { ...DEFAULT_ANNOUNCEMENTS, enabled: true });
  expect(localStorage.getItem(ANNOUNCEMENTS_STORAGE_KEY)).not.toBeNull();
}

/** How many times the refusal was handed to the announcer core as an event. */
const handedOver = (): number =>
  vi
    .mocked(core.announce)
    .mock.calls.filter(([, input]) =>
      (input.events ?? []).some((event) => event.kind === 'screen-off-risk'),
    ).length;

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

async function tick(current: Rig, times: number): Promise<void> {
  for (let second = 0; second < times; second += 1) {
    await act(async () => {
      current.bench.advance(seconds(1));
      await current.controller.tick(current.bench.now);
    });
  }
  await settle();
}

/** The keep-the-screen-on notice wherever it is shown, as a rider reads it. */
function keepScreenOn(): Element | undefined {
  return queryAll(document.body, '.oyl-status').find((each) =>
    (each.querySelector('.oyl-status__label')?.textContent ?? '').startsWith(KEEP_SCREEN_ON_LABEL),
  );
}

describe('the Ride screen — #647', () => {
  const rideRegion = (): string =>
    document.querySelector('[data-oyl-announcer="ride"]')?.textContent ?? '<no region>';

  async function openRideScreen(): Promise<Rig> {
    const current = refusingRig();
    rig = current;
    globalThis.location.hash = hrefFor(routeById('ride'));
    mounted = await mount(
      <AppShell capabilities={NO_BLUETOOTH} rideController={current.controller} />,
    );
    await settle();
    return current;
  }

  it('says nothing before a ride, then shows the one sentence once the service is refused', async () => {
    const current = await openRideScreen();
    expect(keepScreenOn()).toBeUndefined();

    await press('Start recording');
    await tick(current, 1);
    expect(current.asked).toHaveLength(1);
    const notice = keepScreenOn();
    expect(notice?.textContent).toBe(SHOWN);
    // A safety sentence: the whole message, a warning, and in no disclosure.
    expect(notice?.classList.contains('oyl-status--warning')).toBe(true);
    expect(notice?.closest('details')).toBeNull();
    expect(notice?.querySelector('details')).toBeNull();
    // After Pause / Stop in the document, so it costs them nothing on screen.
    const pause = queryAll<HTMLButtonElement>(document.body, 'button').find(
      (each) => each.textContent === 'Pause',
    );
    expect(pause?.compareDocumentPosition(notice as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('says it through the ride’s one region, once, when announcements are on', async () => {
    announcementsOn();
    const current = await openRideScreen();
    await press('Start recording');
    await tick(current, 1);
    expect(rideRegion()).toBe(RIDE_MAY_STOP_SPOKEN);
    expect(handedOver()).toBe(1);

    // It stands for as long as the refusal does; it is not said again.
    await tick(current, 10);
    expect(keepScreenOn()).toBeDefined();
    expect(handedOver()).toBe(1);
  });

  it('is not said again when something else the region watches changes', async () => {
    // The region re-reads its inputs whenever any of them changes. A refusal
    // that STANDS must not be taken for one that appeared on each of those
    // renders. Through the stub controller, because the real one with no
    // workout gives the region nothing else to change.
    announcementsOn();
    const stub = stubRideController(ridingSnapshot());
    globalThis.location.hash = hrefFor(routeById('ride'));
    mounted = await mount(
      <AppShell capabilities={NO_BLUETOOTH} rideController={stub.controller} />,
    );
    await settle();
    await act(async () => {
      stub.set({ keepAliveFailed: true });
      await Promise.resolve();
    });
    await settle();
    expect(rideRegion()).toBe(RIDE_MAY_STOP_SPOKEN);
    expect(handedOver()).toBe(1);

    await act(async () => {
      stub.set({
        trainer: {
          ...ridingSnapshot().trainer,
          releaseFault: 'The trainer may still be holding resistance.',
        },
      });
      await Promise.resolve();
    });
    await settle();
    // The apparatus: the region DID hear the second change — handed over, and
    // waiting for the window the first sentence opened.
    expect(
      vi
        .mocked(core.announce)
        .mock.calls.some(([, input]) =>
          (input.events ?? []).some((event) => event.text.startsWith('Not released')),
        ),
    ).toBe(true);
    expect(handedOver()).toBe(1);
  });

  it('is not said with announcements off, and is still shown', async () => {
    const current = await openRideScreen();
    await press('Start recording');
    await tick(current, 4);
    expect(keepScreenOn()?.textContent).toBe(SHOWN);
    expect(rideRegion()).not.toContain(RIDE_MAY_STOP_WITH_SCREEN_OFF);
  });

  it('clears once a sensor pairs and the second ask succeeds', async () => {
    const current = await openRideScreen();
    await press('Start recording');
    await tick(current, 1);
    expect(keepScreenOn()).toBeDefined();

    await act(async () => {
      await current.controller.pair('trainer');
    });
    await tick(current, 1);
    expect(current.asked).toHaveLength(2);
    expect(keepScreenOn()).toBeUndefined();
    expect(current.controller.getSnapshot().phase).toBe('recording');
  });

  it('passes the accessibility audit with the notice standing', async () => {
    const current = await openRideScreen();
    await press('Start recording');
    await tick(current, 1);
    expect(keepScreenOn()).toBeDefined();
    const violations = auditAccessibility(document);
    expect(violations, formatViolations(violations)).toStrictEqual([]);
  });
});

describe('the game’s HUD — #647', () => {
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
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };

  let pending: FrameRequestCallback[] = [];
  let nowMs = 0;

  beforeEach(() => {
    pending = [];
    nowMs = 1_000_000;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      pending.push(callback);
      return pending.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
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

  const hudRegion = (): string =>
    document.querySelector('[data-oyl-announcer="hud"]')?.textContent ?? '<no region>';
  const hudNotice = (): Element | undefined =>
    keepScreenOn()?.closest('.oyl-hud__notices') === null ? undefined : keepScreenOn();

  /** A ride recording on the Ride screen's controller, then a game ride over it. */
  async function rideTheGame(): Promise<Rig> {
    const current = refusingRig();
    rig = current;
    await act(async () => {
      await current.controller.start();
    });
    await tick(current, 1);
    expect(current.controller.getSnapshot().keepAliveFailed).toBe(true);

    globalThis.location.hash = '#/game';
    mounted = await mount(
      <AppShell
        capabilities={NO_BLUETOOTH}
        rideController={current.controller}
        game={PORT}
        gameRenderer={() => Promise.resolve(RENDERER)}
        gameTrainer={gameTrainerPortOver(current.controller)}
      />,
    );
    await settle();
    await press('Ride ');
    return current;
  }

  it('shows the one sentence in the HUD’s notice cell, with no toggle and no disclosure', async () => {
    await rideTheGame();
    await pump(2);
    const notice = hudNotice();
    expect(notice?.textContent).toBe(SHOWN);
    expect(notice?.closest('details')).toBeNull();
    expect(notice?.closest('.oyl-visually-hidden')).toBeNull();
  });

  it('says it once through the HUD’s one region when announcements are on', async () => {
    announcementsOn();
    await rideTheGame();
    const heard: string[] = [];
    for (let frame = 0; frame < 12; frame += 1) {
      await pump(1);
      heard.push(hudRegion());
    }
    expect(heard).toContain(RIDE_MAY_STOP_SPOKEN);
    // Handed over once — from the Ride screen's region never (it was not
    // mounted), and from the HUD's once, not per window while it stands.
    await pump(20);
    expect(handedOver()).toBe(1);
  });

  it('is not said with announcements off', async () => {
    await rideTheGame();
    await pump(20);
    expect(hudNotice()).toBeDefined();
    expect(handedOver()).toBe(1);
    expect(hudRegion()).not.toContain(RIDE_MAY_STOP_WITH_SCREEN_OFF);
  });

  it('clears mid-ride once a sensor pairs and the second ask succeeds', async () => {
    const current = await rideTheGame();
    await pump(2);
    expect(hudNotice()).toBeDefined();

    await act(async () => {
      await current.controller.pair('trainer');
    });
    await pump(2);
    expect(hudNotice()).toBeUndefined();
  });

  it('passes the accessibility audit with the notice standing', async () => {
    await rideTheGame();
    await pump(2);
    expect(hudNotice()).toBeDefined();
    const violations = auditAccessibility(document);
    expect(violations, formatViolations(violations)).toStrictEqual([]);
  });
});
