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
 * - the Ride screen (`#/ride`, `views/RideView.tsx`) shows ONE sentence beside
 *   the Live group's heading, in no `<details>`, and says it once through the
 *   ride's one region when announcements are on;
 * - the game's HUD shows the same sentence in its notice cell, through the
 *   REAL `gameTrainerPortOver`, and says it once through the HUD's region;
 * - both clear once a sensor pairs and the second ask succeeds.
 *
 * What this cannot establish: whether TalkBack speaks either region
 * (`docs/validation/0003`), and whether Android refuses the service on a
 * fresh install — that is the owner's hardware step on #647.
 */

import { act, type JSX } from 'react';
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
  type WorkoutRescue,
} from '@onyourleft/domain';
import { createSimulator, ftmsTrainer, type SimulatorBench } from '@onyourleft/sensors/simulator';
import { athleteId, recordingSessionId } from '@onyourleft/store';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { GameView, type GamePort, type RidableRoute } from '../game/GameView';
import * as core from '../game/hud/announce';
import {
  ANNOUNCEMENTS_STORAGE_KEY,
  DEFAULT_ANNOUNCEMENTS,
  writeAnnouncementPreference,
} from '../game/hud/announce-preference';
import type { GameRenderer } from '../game/port';
import {
  gameTrainerFrom,
  gameTrainerPortOver,
  type GameTrainerPort,
  type GradientTrainer,
} from '../game/trainer-port';
import type { RecordingCheckpointStore } from '../recording/recorder';
import { AppShell } from '../shell/AppShell';
import { hrefFor, routeById } from '../shell/routes';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { RideAnnouncer } from './RideAnnouncer';
import { ridingSnapshot, stubRideController } from './testing';
import {
  createRideController,
  KEEP_SCREEN_ON_LABEL,
  RIDE_MAY_STOP_SPOKEN,
  RIDE_MAY_STOP_WITH_SCREEN_OFF,
  type RideController,
  type TrainerSnapshot,
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
  vi.useRealTimers();
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

/**
 * How many times the core SAID it — #693's review. Not how many times it was
 * offered: since that review it is offered until it is said, so "said once"
 * is the claim and this is what reads it.
 */
const spokenTimes = (): number =>
  vi
    .mocked(core.announce)
    .mock.results.filter(
      (result) => result.type === 'return' && result.value.kind === 'screen-off-risk',
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
    // Beside the Live group's heading (#693's review): first in the group,
    // before the numbers and before Pause / Stop — `rideview.browser.spec.ts`
    // §"#647" measures what that costs them, and what under them cost it.
    expect(notice?.parentElement?.classList.contains('oyl-ride__heading')).toBe(true);
    const pause = queryAll<HTMLButtonElement>(document.body, 'button').find(
      (each) => each.textContent === 'Pause',
    );
    expect(pause?.compareDocumentPosition(notice as Node)).toBe(Node.DOCUMENT_POSITION_PRECEDING);
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

  it('is said once a higher sentence that took its window has been said — #693’s review', async () => {
    // `announce.ts` holds ONE pending event and a higher one replaces it. Until
    // #693's review this sentence was offered once, on the render it appeared,
    // so a "Not released" arriving while it waited displaced it for good.
    announcementsOn();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let now = 100;
    const trainer = ridingSnapshot().trainer;
    const region = (t: TrainerSnapshot, keepAliveFailed: boolean): JSX.Element => (
      <RideAnnouncer
        trainer={t}
        workout={undefined}
        keepAliveFailed={keepAliveFailed}
        clock={() => now}
      />
    );
    mounted = await mount(region(trainer, false));
    // t = 100: something outranking it is said, and the window closes.
    await mounted.rerender(region({ ...trainer, releaseFault: 'first' }, false));
    expect(rideRegion()).toBe('Not released: first');
    // t = 101: the refusal appears, and waits for the window.
    now = 101;
    await mounted.rerender(region({ ...trainer, releaseFault: 'first' }, true));
    expect(rideRegion()).toBe('Not released: first');
    // t = 102: a higher sentence arrives and takes its place.
    now = 102;
    await mounted.rerender(region({ ...trainer, releaseFault: 'second' }, true));
    now = 103.5;
    await act(async () => {
      vi.advanceTimersByTime(3_000);
      await Promise.resolve();
    });
    expect(rideRegion()).toBe('Not released: second');
    // The next window: it is said now, and once.
    now = 106.6;
    await act(async () => {
      vi.advanceTimersByTime(3_200);
      await Promise.resolve();
    });
    expect(rideRegion()).toBe(RIDE_MAY_STOP_SPOKEN);
    expect(spokenTimes()).toBe(1);
    now = 120;
    await act(async () => {
      vi.advanceTimersByTime(20_000);
      await Promise.resolve();
    });
    expect(spokenTimes()).toBe(1);
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
      setRiderKit: () => undefined,
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
    // SAID once — from the Ride screen's region never (it was not mounted),
    // and from the HUD's once, not per window while it stands. Offered on
    // every frame until then (#693's review), so the offers are not counted.
    await pump(20);
    expect(spokenTimes()).toBe(1);
  });

  it('is not said with announcements off', async () => {
    await rideTheGame();
    await pump(20);
    expect(hudNotice()).toBeDefined();
    // Offered — the apparatus — and never said.
    expect(handedOver()).toBeGreaterThan(0);
    expect(spokenTimes()).toBe(0);
    expect(hudRegion()).not.toContain(RIDE_MAY_STOP_WITH_SCREEN_OFF);
  });

  /**
   * The HUD over a stub trainer port, for the two cases the real controller
   * cannot stage: a higher sentence arriving on a frame of our choosing, and a
   * second ride over a refusal that never clears. A workout owns the trainer,
   * so each ride's first frame carries the road notice.
   */
  function refusedForGood(rescue: { current: WorkoutRescue | undefined }): GameTrainerPort {
    return {
      askForControlOnRide: () => Promise.resolve(),
      workoutRescue: () => rescue.current,
      recordingMayStop: () => true,
      gameRideEnded: () => undefined,
      rideMovingSeconds: () => undefined,
      watchRide: () => () => undefined,
      readTrainer: () =>
        gameTrainerFrom(
          { paired: true, controllable: true, canSimulate: true, hasControl: true },
          {
            setSimulationParameters: () => Promise.resolve(),
            letGo: () => Promise.resolve({ kind: 'stopped' as const }),
          } satisfies GradientTrainer,
          true,
        ),
    };
  }

  const STALLED: WorkoutRescue = {
    kind: 'floor',
    reason: 'Pedalling has stopped, so the target has been dropped to the trainer’s lowest.',
  };

  async function rideOnce(): Promise<void> {
    await press('Ride ');
    await pump(1);
  }

  /** The region's text after each of `frames` frames. */
  async function listen(frames: number): Promise<string[]> {
    const heard: string[] = [];
    for (let frame = 0; frame < frames; frame += 1) {
      await pump(1);
      heard.push(hudRegion());
    }
    return heard;
  }

  it('is said once a higher sentence that took its window has been said — #693’s review', async () => {
    // `announce.ts` holds ONE pending event and a higher one replaces it.
    // Until #693's review the HUD offered this once, on the frame after the
    // road notice, so an "Eased" arriving while it waited displaced it for
    // good and the ride never heard it.
    announcementsOn();
    const rescue: { current: WorkoutRescue | undefined } = { current: undefined };
    mounted = await mount(
      <GameView
        port={PORT}
        trainer={refusedForGood(rescue)}
        renderer={() => Promise.resolve(RENDERER)}
      />,
    );
    await settle();
    await rideOnce();
    expect(hudRegion()).toMatch(/^The road is not reaching your trainer/);
    // The next frame offers it; the window is still closed, so it waits.
    await pump(1);
    rescue.current = STALLED;
    // …and a workout's rescue, which outranks it, arrives behind it.
    const heard = await listen(24);
    const eased = heard.findIndex((each) => each.startsWith('Eased'));
    const said = heard.indexOf(RIDE_MAY_STOP_SPOKEN);
    expect(eased, heard.join(' | ')).toBeGreaterThanOrEqual(0);
    expect(said, heard.join(' | ')).toBeGreaterThan(eased);
    expect(spokenTimes()).toBe(1);
  });

  it('is said again on the next ride while the refusal still stands', async () => {
    // A ride's start clears what the last ride said: a rider who ends one ride
    // and starts another with the recording still refused has not been told
    // on THIS ride. The refusal here never clears, so nothing else resets it.
    announcementsOn();
    mounted = await mount(
      <GameView
        port={PORT}
        trainer={refusedForGood({ current: undefined })}
        renderer={() => Promise.resolve(RENDERER)}
      />,
    );
    await settle();
    await rideOnce();
    expect(await listen(12)).toContain(RIDE_MAY_STOP_SPOKEN);
    expect(spokenTimes()).toBe(1);

    await press('End ride');
    await rideOnce();
    expect(await listen(12)).toContain(RIDE_MAY_STOP_SPOKEN);
    expect(spokenTimes()).toBe(2);
  });

  /**
   * A window `ONE_NOTICE_ONLY_QUERY` does or does not name, as a
   * `MediaQueryList` that fires `change` when {@link turn} moves it — which is
   * what a rotation does.
   */
  function narrowWindow(initially: boolean): { turn: (narrow: boolean) => void } {
    let narrow = initially;
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() {
        return query.includes('width < 25rem') && narrow;
      },
      media: query,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }));
    return {
      turn: (next) => {
        narrow = next;
        act(() => {
          for (const listener of listeners) listener();
        });
      },
    };
  }

  it('takes the road notice and its control off the HUD on the narrowest upright phones only — #693’s review', async () => {
    // jsdom lays nothing out, so which window this is comes from `matchMedia`:
    // `ride.browser.spec.ts` §"#647" measures why, and where the line is.
    const narrow = narrowWindow(true);
    const refused = { current: true };
    const port: GameTrainerPort = {
      ...refusedForGood({ current: undefined }),
      recordingMayStop: () => refused.current,
      gameRideEnded: () => undefined,
      rideMovingSeconds: () => undefined,
      watchRide: () => () => undefined,
    };
    mounted = await mount(
      <GameView port={PORT} trainer={port} renderer={() => Promise.resolve(RENDERER)} />,
    );
    await settle();
    await rideOnce();
    const toggle = (): HTMLButtonElement | undefined =>
      queryAll<HTMLButtonElement>(document.body, 'button').find(
        (each) => each.textContent === 'Trainer notice',
      );
    const road = (): Element | null => document.querySelector('#oyl-hud-standing-notice');
    expect(hudNotice()?.textContent).toBe(SHOWN);
    expect(road()).toBeNull();
    expect(toggle()).toBeUndefined();

    // The service comes up: the road notice is back, control and all.
    refused.current = false;
    await pump(1);
    expect(road()).not.toBeNull();
    expect(toggle()).toBeDefined();

    // Refused again, on a wider window: nothing is taken off.
    refused.current = true;
    narrow.turn(false);
    await pump(1);
    expect(hudNotice()?.textContent).toBe(SHOWN);
    expect(road()).not.toBeNull();
    expect(toggle()).toBeDefined();
  });

  it('takes the road notice off when a PAUSED ride is turned into a narrow phone — #693’s re-review', async () => {
    // A paused ride draws no frame, so nothing re-renders the HUD on its own:
    // the window's own `change` has to. No `pump` after the turn, on purpose.
    const narrow = narrowWindow(false);
    mounted = await mount(
      <GameView
        port={PORT}
        trainer={refusedForGood({ current: undefined })}
        renderer={() => Promise.resolve(RENDERER)}
      />,
    );
    await settle();
    await rideOnce();
    const road = (): Element | null => document.querySelector('#oyl-hud-standing-notice');
    expect(hudNotice()?.textContent).toBe(SHOWN);
    expect(road()).not.toBeNull();

    await press('Pause');
    narrow.turn(true);
    expect(road()).toBeNull();
    expect(hudNotice()?.textContent).toBe(SHOWN);

    // And back, still paused.
    narrow.turn(false);
    expect(road()).not.toBeNull();
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
