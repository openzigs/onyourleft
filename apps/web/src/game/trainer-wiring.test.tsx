// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #362's wiring: the road the game draws, reaching a real trainer.
 *
 * `packages/domain/src/trainer/simulation.test.ts` proves the driver picks the
 * right gradient. `packages/sensors/protocol/src/simulation-writer.test.ts`
 * proves the writer paces them onto the wire without piling up.
 * `gradient.test.ts` proves the two compose. **None of those says whether a
 * ride can ever cause one**, and that was precisely the defect: both halves of
 * #90 were written, unit-tested and green, and `grep -rn createSimulationWriter
 * apps/` returned nothing. A rider on a real trainer on a real route produced
 * 252 inbound Indoor Bike Data notifications and **zero** writes.
 *
 * ⚠️ **#362's fifth criterion is that a unit test calling the writer is not
 * sufficient evidence** — every one of #278's five defects had one. So every
 * assertion below is driven through the real component, the real picker, the
 * real `GameSimulation`, the real `createSimulationDriver` and the real
 * `createSimulationWriter`, and it reads what a **trainer** was handed. The
 * only doubles are the three things that genuinely cannot exist in jsdom: the
 * store behind `GamePort`, the GL context behind `GameRenderer`, and the clock.
 *
 * ⚠️ **`check:wiring` could not have caught this and now can** — #363. Both
 * halves live in `packages/`, which the gate's watched set deliberately
 * excluded; the trainer-command seam is what closed it, and
 * `scripts/check-wiring.test.sh` §"#362" reproduces this tree as it actually
 * was and requires the gate to go red on it. That gate and this test fail for
 * different reasons and neither replaces the other: deleting the `sample` call
 * in the tick leaves `check:wiring` green, because `GameView` still names
 * `createGradientSession`.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GameView, STANDING_NOTICE_SECONDS, type GamePort, type RidableRoute } from './GameView';
import { createGradientSession } from './gradient';
import {
  gameTrainerPortOver,
  type GameTrainer,
  type GameTrainerPort,
  type GradientTrainer,
} from './trainer-port';
import type { GameRenderer, SceneFrame } from './port';
import { browserScreenLockSource, type ScreenLockSource } from './hud/wake-lock';
import { hideablePage, type HideablePage } from './hud/wake-lock-testing';

/**
 * #509: the real `createGradientSession`, counted. A session built and never
 * sampled writes nothing, so "one gradient session per press" is not visible
 * on the wire — this is what makes it visible. Every call still goes through
 * to the real implementation; nothing about the sessions changes.
 */
vi.mock('./gradient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./gradient')>();
  return { ...actual, createGradientSession: vi.fn(actual.createGradientSession) };
});
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';
import type { SimulationParameters } from '@onyourleft/sensors/protocol';
import { deviceId } from '@onyourleft/sensors';
import { createSimulator, ftmsTrainer } from '@onyourleft/sensors/simulator';
import { recordingSessionId } from '@onyourleft/store';
import { ATHLETE_A, createStoreHarness, seedAthletes } from '@onyourleft/store/testing';

import { createRideController } from '../ride/controller';
import { simulatedOpenTrainer } from '../ride/simulated-trainer-testing';

/**
 * Two kilometres that climb at 4 % and then fall at 4 %.
 *
 * Steep enough that a gradient reaching the trainer is unmistakable, and signed
 * both ways so "the value tracks the route's grade at the rider's distance" is
 * a direction rather than a magnitude.
 */
function hillRoute(): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 200; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index <= 100 ? index * 0.4 : (200 - index) * 0.4),
    });
  }
  return { id: 'route-hill', name: 'Test hill', profile: routeProfile(points), attempts: 0 };
}

/** A rider putting out enough to get up it. */
function pedallingPort(route: RidableRoute): GamePort {
  return {
    listRoutes: () => Promise.resolve([route]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(300), live: true, paired: true },
      cadence: { value: 88, live: true, paired: true },
      heartRate: { value: 142, live: true, paired: true },
    }),
  };
}

function capturingRenderer(frames: SceneFrame[]): GameRenderer {
  return {
    // #475: never asked — no ride in this file chose the realistic world.
    loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
    create: () => ({
      hasContext: true,
      render: (frame: SceneFrame) => {
        frames.push(frame);
      },
      setQuality: () => undefined,
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };
}

/** Everything a trainer was told this test. */
interface Commands {
  readonly written: SimulationParameters[];
  readonly releases: number[];
  /** #503: each request for control, recorded as the write count at the time. */
  readonly requests: number[];
}

/**
 * A trainer port built the way `main.tsx` builds one.
 *
 * ⚠️ Through the **real** `gameTrainerPortOver` — and so the real
 * `gameTrainerFrom` — rather than by returning a hand-made `GameTrainer`, so
 * that a case asserting "a machine with no simulation bit is not written to"
 * or "a workout's trainer is never asked for control" exercises the
 * production decision rather than a fixture's opinion of it. Only the ride
 * controller underneath is a double; the last `describe` below rides a real
 * one against the #44 simulator.
 *
 * @param grants whether the trainer grants control when the Ride press asks
 * for it (#503). A request that is refused leaves `hasControl` as it was.
 */
function trainerPort(
  snapshot: {
    readonly paired: boolean;
    readonly controllable: boolean;
    readonly canSimulate: boolean;
    readonly hasControl: boolean;
    readonly releaseFault?: string | undefined;
  },
  commands: Commands,
  workoutRunning = false,
  grants = true,
): GameTrainerPort {
  const facts = { ...snapshot };
  const control: GradientTrainer = {
    setSimulationParameters: async (parameters) => {
      commands.written.push(parameters);
      return Promise.resolve();
    },
    // #372: the controller's one release — `stop` is no longer on the type.
    letGo: async () => {
      commands.releases.push(commands.written.length);
      return Promise.resolve({ kind: 'stopped' as const });
    },
  };
  return gameTrainerPortOver({
    getSnapshot: () => ({
      trainer: facts,
      workout: workoutRunning ? { status: 'running' } : undefined,
    }),
    simulationControl: () => control,
    requestTrainerControl: async () => {
      commands.requests.push(commands.written.length);
      if (grants) {
        facts.hasControl = true;
      }
      return Promise.resolve();
    },
  });
}

const READY = {
  paired: true,
  controllable: true,
  canSimulate: true,
  hasControl: true,
} as const;

let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let mounted: Mounted | undefined;

beforeEach(() => {
  pending = [];
  nowMs = 1_000_000;
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
});

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

/**
 * How much wall clock one pumped frame covers.
 *
 * ⚠️ Half a second, which is **above** the driver's one-second rate limit only
 * every other frame — so a ride of sixty frames is thirty seconds of road and
 * the write count is bounded by the driver rather than by the frame rate. That
 * is the property under test in "at most one write a second", and a shorter
 * frame would make it vacuous.
 */
const FRAME_MS = 500;

async function pump(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const next = pending.shift();
    if (next === undefined) {
      return;
    }
    nowMs += FRAME_MS;
    await act(async () => {
      next(nowMs);
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

/** Mount the game, start a ride on the hill, pump `frames` frames. */
async function ride(
  port: GameTrainerPort | undefined,
  frames = 60,
): Promise<{ readonly drawn: SceneFrame[] }> {
  const drawn: SceneFrame[] = [];
  mounted = await mount(
    <GameView
      port={pedallingPort(hillRoute())}
      {...(port === undefined ? {} : { trainer: port })}
      renderer={() => Promise.resolve(capturingRenderer(drawn))}
      now={() => nowMs}
    />,
  );
  await settle();
  await clickThrough(buttonStarting('Ride '));
  await pump(frames);
  await settle();
  return { drawn };
}

describe('the road the game draws reaches the trainer', () => {
  it('writes the route’s gradient while the rider is riding', async () => {
    const commands: Commands = { written: [], releases: [], requests: [] };
    const { drawn } = await ride(trainerPort(READY, commands));

    // The renderer really was driven, or "no gradient" could be "no ride".
    expect(drawn.length).toBeGreaterThan(10);
    // ⚠️ **The assertion that was false for the whole of #362.** It goes red the
    // moment `GameView.start` stops building a session, or the tick stops
    // sampling one — and nothing else in this repository does.
    expect(commands.written.length).toBeGreaterThan(0);
  });

  it('sends the grade at the rider’s distance, climbing', async () => {
    const commands: Commands = { written: [], releases: [], requests: [] };
    await ride(trainerPort(READY, commands));

    // Every write is on the first kilometre at 300 W, which is the climb — so
    // every one of them must be a climb. A driver fed the wrong distance, or a
    // sign lost anywhere between the profile and the control point, lands here.
    expect(commands.written.length).toBeGreaterThan(0);
    for (const parameters of commands.written) {
      expect(parameters.grade).toBeGreaterThan(0);
      expect(parameters.grade).toBeLessThan(5);
    }
    // ⚠️ And at least one of them is the road's **own** 4 %, not merely
    // positive. The rider starts at distance zero, where `route/profile.ts`'s
    // three gradient windows are still filling and the grade reads about 2 % —
    // so a bound of "greater than three" on every write would fail against a
    // perfectly correct ride, and a bound of "greater than zero" alone would
    // pass against a driver stuck on the first sample for ever.
    expect(commands.written.some((parameters) => parameters.grade > 3.5)).toBe(true);
  });

  it('does not write faster than the driver allows', async () => {
    const commands: Commands = { written: [], releases: [], requests: [] };
    await ride(trainerPort(READY, commands), 60);
    // Thirty seconds of road at one write a second, and a deadband on top —
    // never sixty, which is what a tick with no rate limit would produce.
    expect(commands.written.length).toBeLessThanOrEqual(31);
  });

  it('writes nothing to a trainer that does not offer simulation mode', async () => {
    // #362's fourth criterion. The one case no trainer in this loop can make.
    const commands: Commands = { written: [], releases: [], requests: [] };
    const { drawn } = await ride(trainerPort({ ...READY, canSimulate: false }, commands));
    expect(drawn.length).toBeGreaterThan(10);
    expect(commands.written).toHaveLength(0);
  });

  it('writes nothing to a trainer that refused control when Ride asked — #503', async () => {
    const commands: Commands = { written: [], releases: [], requests: [] };
    const { drawn } = await ride(
      trainerPort({ ...READY, hasControl: false }, commands, false, false),
    );
    // The ride still starts…
    expect(drawn.length).toBeGreaterThan(10);
    // …the press asked, once, before anything was written…
    expect(commands.requests).toStrictEqual([0]);
    // …and a refused request writes nothing.
    expect(commands.written).toHaveLength(0);
  });

  it('tells the rider in a sentence when the trainer refused control — #503', async () => {
    const commands: Commands = { written: [], releases: [], requests: [] };
    await ride(trainerPort({ ...READY, hasControl: false }, commands, false, false));
    const text = mounted?.container.textContent ?? '';
    expect(text).toContain('did not grant control when you pressed Ride');
    expect(text).toContain('hills on this route are not being sent to it');
  });

  it('writes nothing to a trainer a workout is already driving', async () => {
    // ⚠️ The hazard the review of #362 found, ridden end to end rather than
    // argued at the pure function. `RideSession` is mounted above the router,
    // so a workout started on the Ride screen keeps writing ERG targets to the
    // one control point while the rider is in the game. A second writer at
    // about 1 Hz is the mild half; the sharp half is the release below.
    const commands: Commands = { written: [], releases: [], requests: [] };
    const { drawn } = await ride(trainerPort(READY, commands, true));
    expect(drawn.length).toBeGreaterThan(10);
    expect(commands.written).toHaveLength(0);
    // #503: and the Ride press did not ask for control over it.
    expect(commands.requests).toHaveLength(0);
  });

  it('sends no release when a workout holds the trainer', async () => {
    // ⚠️ **The assertion that is really about safety.** A release is an FTMS
    // Stop, which makes the machine stop listening to this client — so a game
    // ride that ended while a workout was running would leave the workout's
    // clock going and every one of its targets refused or ignored — the silent
    // failure `startWorkout` refuses to start into, arriving after the guard.
    const commands: Commands = { written: [], releases: [], requests: [] };
    await ride(trainerPort(READY, commands, true));
    await act(async () => {
      mounted?.unmount();
      await Promise.resolve();
      await Promise.resolve();
    });
    mounted = undefined;
    expect(commands.releases).toHaveLength(0);
  });

  it('tells the rider the workout has the trainer, not that the trainer is broken', async () => {
    const commands: Commands = { written: [], releases: [], requests: [] };
    await ride(trainerPort(READY, commands, true));
    const text = mounted?.container.textContent ?? '';
    expect(text).toContain('workout is driving your trainer');
    expect(text).not.toContain('cannot be controlled');
  });

  it('tells the rider, rather than leaving them to believe the road is flat', async () => {
    const commands: Commands = { written: [], releases: [], requests: [] };
    await ride(trainerPort({ ...READY, canSimulate: false }, commands));
    const text = mounted?.container.textContent ?? '';
    expect(text).toContain('does not offer simulation mode');
  });

  it('says on the picker, before the press, that the trainer will follow the hills — #503', async () => {
    const commands: Commands = { written: [], releases: [], requests: [] };
    mounted = await mount(
      <GameView
        port={pedallingPort(hillRoute())}
        trainer={trainerPort({ ...READY, hasControl: false }, commands)}
        renderer={() => Promise.resolve(capturingRenderer([]))}
        now={() => nowMs}
      />,
    );
    await settle();
    const text = mounted.container.textContent ?? '';
    expect(text).toContain('Your trainer will follow this route’s hills');
    expect(text).toContain('Pressing Ride asks it for control');
    // ⚠️ Not the detour #503 removed, and not a warning that contradicts it.
    expect(text).not.toContain('Ride screen');
    expect(text).not.toContain('will not reach your trainer');
  });

  it('tells the rider on the picker when the last release was not confirmed — #372', async () => {
    // A game ride ends on the picker, not on the Ride screen, and a trainer
    // that refused the Stop may still be holding the hill.
    const commands: Commands = { written: [], releases: [], requests: [] };
    mounted = await mount(
      <GameView
        port={pedallingPort(hillRoute())}
        trainer={trainerPort(
          { ...READY, releaseFault: 'The trainer may still be holding resistance.' },
          commands,
        )}
        renderer={() => Promise.resolve(capturingRenderer([]))}
        now={() => nowMs}
      />,
    );
    await settle();
    const text = mounted.container.textContent ?? '';
    expect(text).toContain('Not released');
    expect(text).toContain('may still be holding resistance');
  });

  it('says nothing about a release when there is nothing to say', async () => {
    const commands: Commands = { written: [], releases: [], requests: [] };
    mounted = await mount(
      <GameView
        port={pedallingPort(hillRoute())}
        trainer={trainerPort(READY, commands)}
        renderer={() => Promise.resolve(capturingRenderer([]))}
        now={() => nowMs}
      />,
    );
    await settle();
    expect(mounted.container.textContent ?? '').not.toContain('Not released');
  });

  it('says nothing about the road when there is no trainer at all', async () => {
    // A rider on a power meter has not asked to be driven and is not nagged.
    const commands: Commands = { written: [], releases: [], requests: [] };
    await ride(trainerPort({ ...READY, paired: false }, commands));
    const text = mounted?.container.textContent ?? '';
    expect(text).not.toContain('will not reach your trainer');
    expect(text).not.toContain('is not reaching your trainer');
  });

  it('is happy with no trainer port at all', async () => {
    // Safari, Firefox, and the accessibility suite, which renders this route
    // with no ports whatever.
    const { drawn } = await ride(undefined);
    expect(drawn.length).toBeGreaterThan(10);
  });

  it('shows the rider what the trainer is being told', async () => {
    // The rider-visible evidence `docs/validation/0002` Part I asks somebody
    // with a trainer in front of them to read.
    const commands: Commands = { written: [], releases: [], requests: [] };
    await ride(trainerPort(READY, commands));
    expect(mounted?.container.textContent ?? '').toContain('Trainer: simulating');
  });

  it('releases the trainer when the rider ends the ride', async () => {
    const commands: Commands = { written: [], releases: [], requests: [] };
    await ride(trainerPort(READY, commands));
    expect(commands.releases).toHaveLength(0);

    await clickThrough(buttonStarting('End ride'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(commands.releases).toHaveLength(1);
  });

  it('releases the trainer when the rider navigates away mid-ride', async () => {
    // The effect's cleanup path — validation 0002 L7, a different line of code
    // making the same claim as End ride. A leaked simulation setpoint is
    // resistance left on a machine with nothing on screen to explain it.
    const commands: Commands = { written: [], releases: [], requests: [] };
    await ride(trainerPort(READY, commands));
    await act(async () => {
      mounted?.unmount();
      await Promise.resolve();
      await Promise.resolve();
    });
    mounted = undefined;
    expect(commands.releases).toHaveLength(1);
  });
});

describe('the Ride press asks the trainer for control — #503', () => {
  it('asks for nothing and writes nothing until the rider presses Ride', async () => {
    const commands: Commands = { written: [], releases: [], requests: [] };
    mounted = await mount(
      <GameView
        port={pedallingPort(hillRoute())}
        trainer={trainerPort({ ...READY, hasControl: false }, commands)}
        renderer={() => Promise.resolve(capturingRenderer([]))}
        now={() => nowMs}
      />,
    );
    await settle();
    // Re-rendering the picker reads the trainer again; reading is not asking.
    await settle();
    expect(commands.requests).toHaveLength(0);
    expect(commands.written).toHaveLength(0);
    expect(commands.releases).toHaveLength(0);

    await clickThrough(buttonStarting('Ride '));
    await pump(20);
    await settle();

    // Exactly one request, before the first write, and then the road.
    expect(commands.requests).toStrictEqual([0]);
    expect(commands.written.length).toBeGreaterThan(0);
    expect(mounted.container.textContent ?? '').toContain('Trainer: simulating');
  });

  it('does not ask a trainer that already has control', async () => {
    const commands: Commands = { written: [], releases: [], requests: [] };
    await ride(trainerPort(READY, commands));
    expect(commands.requests).toHaveLength(0);
    expect(commands.written.length).toBeGreaterThan(0);
  });

  for (const [state, snapshot] of [
    ['no-simulation', { ...READY, hasControl: false, canSimulate: false }],
    ['not-controllable', { ...READY, hasControl: false, controllable: false }],
  ] as const) {
    it(`asks nothing of and writes nothing to a ${state} trainer`, async () => {
      const commands: Commands = { written: [], releases: [], requests: [] };
      const { drawn } = await ride(trainerPort(snapshot, commands));
      expect(drawn.length).toBeGreaterThan(10);
      expect(commands.requests).toHaveLength(0);
      expect(commands.written).toHaveLength(0);
    });
  }

  it('asks nothing when a workout is holding the trainer without control — the workout notice shows', async () => {
    const commands: Commands = { written: [], releases: [], requests: [] };
    await ride(trainerPort({ ...READY, hasControl: false }, commands, true));
    expect(commands.requests).toHaveLength(0);
    expect(commands.written).toHaveLength(0);
    expect(mounted?.container.textContent ?? '').toContain('workout is driving your trainer');
  });

  /**
   * ⚠️ A port that asks whenever it is asked — NOT `gameTrainerPortOver`,
   * whose own guard would hide a `GameView` that asked in the wrong state. This
   * is what holds the component's gate on its own.
   */
  function rawPort(kind: GameTrainer['kind'], requests: number[], fails = false): GameTrainerPort {
    return {
      readTrainer: () => ({ kind, control: undefined }),
      askForControlOnRide: async () => {
        requests.push(requests.length);
        return fails ? Promise.reject(new Error('Control Not Permitted')) : Promise.resolve();
      },
    };
  }

  for (const kind of ['none', 'workout', 'not-controllable', 'no-simulation'] as const) {
    it(`GameView itself asks nothing of a ${kind} trainer, whatever the port would do`, async () => {
      const requests: number[] = [];
      const { drawn } = await ride(rawPort(kind, requests), 4);
      expect(drawn.length).toBeGreaterThan(0);
      expect(requests).toHaveLength(0);
    });
  }

  it('starts the ride and says so when the request itself throws', async () => {
    const requests: number[] = [];
    const { drawn } = await ride(rawPort('no-control', requests, true), 4);
    expect(requests).toHaveLength(1);
    expect(drawn.length).toBeGreaterThan(0);
    expect(mounted?.container.textContent ?? '').toContain(
      'did not grant control when you pressed Ride',
    );
  });

  it('asks again on the next ride after a refusal, and only on the press', async () => {
    const commands: Commands = { written: [], releases: [], requests: [] };
    await ride(trainerPort({ ...READY, hasControl: false }, commands, false, false), 4);
    expect(commands.requests).toHaveLength(1);
    await clickThrough(buttonStarting('End ride'));
    await settle();
    // Back on the picker: nothing asked by being there.
    expect(commands.requests).toHaveLength(1);
    await clickThrough(buttonStarting('Ride '));
    await settle();
    expect(commands.requests).toHaveLength(2);
  });
});

describe('a standing notice gives the route panel back once it has been read — #437', () => {
  // `FRAME_MS` is half a second of ride per pumped frame.
  const framesFor = (seconds: number): number => Math.ceil((seconds * 1000) / FRAME_MS);

  function noticeParts() {
    const container = mounted?.container ?? document;
    const wrapper = container.querySelector<HTMLElement>('.oyl-hud__notices');
    const toggle = queryAll<HTMLButtonElement>(container, 'button').find(
      (button) => button.textContent === 'Trainer notice',
    );
    return { wrapper, toggle };
  }

  it('stands open at the start of a ride, with a control that says so', async () => {
    await ride(trainerPort(READY, { written: [], releases: [], requests: [] }, true), 4);
    const { wrapper, toggle } = noticeParts();

    expect(wrapper?.classList.contains('oyl-hud__notices--collapsed')).toBe(false);
    expect(wrapper?.textContent).toContain('workout is driving your trainer');
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(toggle?.getAttribute('aria-controls')).toBe(
      wrapper?.querySelector('[id]')?.getAttribute('id'),
    );
  });

  it(`puts itself away after ${String(STANDING_NOTICE_SECONDS)} s of ride — and the sentence is still there to be read`, async () => {
    await ride(
      trainerPort(READY, { written: [], releases: [], requests: [] }, true),
      framesFor(STANDING_NOTICE_SECONDS) + 4,
    );
    const { wrapper, toggle } = noticeParts();

    expect(wrapper?.classList.contains('oyl-hud__notices--collapsed')).toBe(true);
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    // ⚠️ Collapsed is visually hidden by CLIP, never removed: a screen-reader
    // user who has not reached the sentence yet still can. None of the three
    // things that would take it out of the accessibility tree is present.
    expect(wrapper?.textContent).toContain('workout is driving your trainer');
    // Every element from the sentence up to the wrapper — the status glyph is
    // `aria-hidden` on purpose and is not the sentence.
    const sentence = wrapper?.querySelector('p');
    const chain: Element[] = [];
    for (let at: Element | null | undefined = sentence; at && at !== wrapper?.parentElement;) {
      chain.push(at);
      at = at.parentElement;
    }
    expect(chain.length).toBeGreaterThanOrEqual(3);
    for (const element of chain) {
      expect(element.hasAttribute('hidden')).toBe(false);
      expect(element.getAttribute('aria-hidden')).not.toBe('true');
      expect((element as HTMLElement).style.display).not.toBe('none');
    }
  });

  it('is the rider’s to open and close, whatever the clock says', async () => {
    await ride(
      trainerPort(READY, { written: [], releases: [], requests: [] }, true),
      framesFor(STANDING_NOTICE_SECONDS) + 4,
    );
    await clickThrough(noticeParts().toggle);
    expect(noticeParts().toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(noticeParts().wrapper?.classList.contains('oyl-hud__notices--collapsed')).toBe(false);

    await pump(20);
    // Opened by the rider, it stays open: the clock only decides for a rider
    // who has not chosen.
    expect(noticeParts().toggle?.getAttribute('aria-expanded')).toBe('true');

    await clickThrough(noticeParts().toggle);
    expect(noticeParts().wrapper?.classList.contains('oyl-hud__notices--collapsed')).toBe(true);
  });

  // #437's first criterion names the four noticed trainer states, and each has
  // its own sentence in `trainer-port.ts` §`trainerRoadNotice`.
  for (const [state, snapshot, workoutRunning] of [
    ['workout', READY, true],
    ['not-controllable', { ...READY, controllable: false }, false],
    ['no-simulation', { ...READY, canSimulate: false }, false],
    ['no-control', { ...READY, hasControl: false }, false],
  ] as const) {
    it(`gives the route panel back in the ${state} state`, async () => {
      await ride(
        // #503: `no-control` stands only once the Ride press has been refused.
        trainerPort(snapshot, { written: [], releases: [], requests: [] }, workoutRunning, false),
        framesFor(STANDING_NOTICE_SECONDS) + 4,
      );
      const { wrapper, toggle } = noticeParts();
      expect(toggle).toBeDefined();
      expect(wrapper?.classList.contains('oyl-hud__notices--collapsed')).toBe(true);
      expect(mounted?.container.querySelector('.oyl-hud__route')).not.toBeNull();
    });
  }

  it('stands open again at the start of the next ride', async () => {
    // A rider who put the notice away on one ride has not read the next one's.
    await ride(trainerPort(READY, { written: [], releases: [], requests: [] }, true), 4);
    await clickThrough(noticeParts().toggle);
    expect(noticeParts().toggle?.getAttribute('aria-expanded')).toBe('false');

    await clickThrough(buttonStarting('End ride'));
    await clickThrough(buttonStarting('Ride '));
    await pump(2);
    expect(noticeParts().toggle?.getAttribute('aria-expanded')).toBe('true');
  });

  it('offers no toggle when there is nothing standing', async () => {
    await ride(trainerPort(READY, { written: [], releases: [], requests: [] }), 4);
    expect(noticeParts().toggle).toBeUndefined();
    expect(noticeParts().wrapper).toBeNull();
  });
});

describe('pair, open the game, press Ride — the whole path, against the #44 simulator (#503)', () => {
  /**
   * The owner's afternoon on 2026-09-23, without the detour: a trainer paired
   * and never given control, the game opened, *Ride* pressed — and no visit to
   * the Ride screen. Everything below the port is real: the ride controller
   * `main.tsx` builds, its `requestTrainerControl`, `createTrainerControl`, and
   * the simulator's own FTMS state machine, which refuses a gradient from a
   * client that does not hold control. What is read back is what the MACHINE
   * holds, not what a double was handed.
   */
  async function onTheBench(refuseControl: boolean) {
    const harness = createStoreHarness();
    await seedAthletes(harness);
    const { transport, bench } = createSimulator({
      devices: [ftmsTrainer({ id: 'kickr', name: 'KICKR 1F2A' })],
    });
    const written: number[][] = [];
    const controller = createRideController({
      transport,
      store: {
        putRecordingSession: async (record) =>
          harness.write(async (store) => store.putRecordingSession(record)),
        appendRecordingChunk: async (chunk) =>
          harness.write(async (store) => store.appendRecordingChunk(chunk)),
        listRecordingSessions: async (owner) =>
          harness.write(async (store) => store.listRecordingSessions(owner)),
        recoverRecording: async (owner, id) =>
          harness.write(async (store) => store.recoverRecording(owner, id)),
        deleteRecordingSession: async (owner, id) =>
          harness.write(async (store) => store.deleteRecordingSession(owner, id)),
      },
      athleteId: ATHLETE_A,
      newSessionId: () => recordingSessionId('ride-1'),
      now: () => bench.now,
      openTrainer: simulatedOpenTrainer(bench, { written, refuseControl }),
    });
    await controller.pair('trainer');
    return {
      controller,
      written,
      machine: () => bench.device(deviceId('kickr')).inspect().ftms,
      done: async () => {
        controller.dispose();
        await harness.destroy();
      },
    };
  }

  async function openTheGame(trainer: GameTrainerPort): Promise<void> {
    mounted = await mount(
      <GameView
        port={pedallingPort(hillRoute())}
        trainer={trainer}
        renderer={() => Promise.resolve(capturingRenderer([]))}
        now={() => nowMs}
      />,
    );
    await settle();
  }

  /** Let the control point's queue reach its writes and hear their answers. */
  async function flush(): Promise<void> {
    for (let index = 0; index < 10; index += 1) {
      await settle();
    }
  }

  it('takes control on the press and the trainer holds the route’s climb', async () => {
    const rig = await onTheBench(false);
    expect(rig.controller.getSnapshot().trainer.hasControl).toBe(false);

    await openTheGame(gameTrainerPortOver(rig.controller));
    // Entering the game screen writes nothing at all to the machine.
    expect(rig.written).toHaveLength(0);

    await clickThrough(buttonStarting('Ride '));
    await flush();
    await pump(30);
    await flush();

    // One Request Control, first, and it was the rider's press that sent it.
    expect(rig.written[0]?.[0]).toBe(0x00);
    expect(rig.written.filter((write) => write[0] === 0x00)).toHaveLength(1);
    expect(rig.controller.getSnapshot().trainer.hasControl).toBe(true);
    // ⚠️ Read from the machine: the simulator accepts a gradient only from a
    // client that holds control, so a grade here is the whole path working.
    expect(rig.written.some((write) => write[0] === 0x11)).toBe(true);
    expect(rig.machine()?.simulation?.grade).toBeGreaterThan(0);
    await rig.done();
  });

  it('starts the ride, writes no gradient and says so, when the trainer refuses', async () => {
    const rig = await onTheBench(true);
    await openTheGame(gameTrainerPortOver(rig.controller));

    await clickThrough(buttonStarting('Ride '));
    await flush();
    await pump(30);
    await flush();

    expect(rig.written.filter((write) => write[0] === 0x00)).toHaveLength(1);
    expect(rig.written.some((write) => write[0] === 0x11)).toBe(false);
    expect(rig.machine()?.simulation).toBeUndefined();
    const text = mounted?.container.textContent ?? '';
    expect(text).toContain('End ride');
    expect(text).toContain('did not grant control when you pressed Ride');
    // The refusal is also where the Ride screen reads it — and, since #509,
    // the game's own sentence carries the same reason.
    const reason = rig.controller.getSnapshot().trainer.refusal;
    expect(reason).toBeDefined();
    expect(text).toContain(reason ?? '<no reason recorded>');
    await rig.done();
  });
});

describe('a press on Ride while the trainer is being asked — #509', () => {
  /**
   * A trainer whose answer to the Ride press is the TEST's to give. Until
   * `grant()` the request stays pending — the FTMS procedure is bounded at
   * five seconds after the write, and the write itself can take longer — and
   * `readTrainer` goes on saying `no-control`, so a second press that reached
   * `askForControlOnRide` would be a second request.
   */
  function deferredPort(commands: Commands): {
    readonly port: GameTrainerPort;
    grant(): void;
    reads(): number;
  } {
    let granted = false;
    let reads = 0;
    const waiting: (() => void)[] = [];
    const control: GradientTrainer = {
      setSimulationParameters: async (parameters) => {
        commands.written.push(parameters);
        return Promise.resolve();
      },
      letGo: async () => {
        commands.releases.push(commands.written.length);
        return Promise.resolve({ kind: 'stopped' as const });
      },
    };
    return {
      port: {
        readTrainer: () => {
          reads += 1;
          return granted ? { kind: 'ready', control } : { kind: 'no-control', control: undefined };
        },
        askForControlOnRide: () => {
          commands.requests.push(commands.written.length);
          return new Promise<void>((resolve) => {
            waiting.push(resolve);
          });
        },
      },
      grant: () => {
        granted = true;
        for (const resolve of waiting.splice(0)) resolve();
      },
      reads: () => reads,
    };
  }

  /** A screen lock that records every acquire and every release. */
  function lockSource(defer = false): {
    readonly source: ScreenLockSource;
    readonly acquired: number[];
    readonly released: number[];
    settle(): void;
  } {
    const acquired: number[] = [];
    const released: number[] = [];
    const waiting: (() => void)[] = [];
    return {
      source: {
        acquire: async () => {
          const id = acquired.length + 1;
          acquired.push(id);
          if (defer) {
            await new Promise<void>((resolve) => {
              waiting.push(resolve);
            });
          }
          return {
            held: true,
            release: async () => {
              released.push(id);
              return Promise.resolve();
            },
          };
        },
      },
      acquired,
      released,
      settle: () => {
        for (const resolve of waiting.splice(0)) resolve();
      },
    };
  }

  async function openTheGame(trainer: GameTrainerPort, lock: ScreenLockSource): Promise<void> {
    mounted = await mount(
      <GameView
        port={pedallingPort(hillRoute())}
        trainer={trainer}
        renderer={() => Promise.resolve(capturingRenderer([]))}
        now={() => nowMs}
        screenLock={lock}
      />,
    );
    await settle();
  }

  beforeEach(() => {
    vi.mocked(createGradientSession).mockClear();
  });

  it('says it is asking, marks Ride unavailable, and starts ONE ride however often Ride is pressed', async () => {
    const commands: Commands = { written: [], releases: [], requests: [] };
    const trainer = deferredPort(commands);
    const lock = lockSource();
    await openTheGame(trainer.port, lock.source);

    await clickThrough(buttonStarting('Ride '));
    // Pending: the picker says so, and the control says it is unavailable.
    const picker = mounted?.container.textContent ?? '';
    expect(picker).toContain('Asking your trainer for control');
    expect(buttonStarting('Ride ')?.getAttribute('aria-disabled')).toBe('true');
    expect(commands.requests).toHaveLength(1);

    // ⚠️ `aria-disabled` is a promise to a screen reader and nothing to a
    // click, so the presses are made anyway.
    await clickThrough(buttonStarting('Ride '));
    await clickThrough(buttonStarting('Ride '));
    expect(commands.requests).toHaveLength(1);

    trainer.grant();
    await settle();
    await pump(10);
    await settle();

    const text = mounted?.container.textContent ?? '';
    expect(text).toContain('End ride');
    expect(text).not.toContain('Asking your trainer for control');
    // One request, one session, one lock — and the road reached the trainer.
    expect(commands.requests).toHaveLength(1);
    expect(vi.mocked(createGradientSession)).toHaveBeenCalledTimes(1);
    expect(lock.acquired).toHaveLength(1);
    expect(commands.written.length).toBeGreaterThan(0);
  });

  it('is ready for the next press once the trainer has answered', async () => {
    const commands: Commands = { written: [], releases: [], requests: [] };
    const trainer = deferredPort(commands);
    const lock = lockSource();
    await openTheGame(trainer.port, lock.source);
    await clickThrough(buttonStarting('Ride '));
    trainer.grant();
    await settle();
    await pump(4);
    await clickThrough(buttonStarting('End ride'));
    await settle();

    expect(buttonStarting('Ride ')?.getAttribute('aria-disabled')).toBeNull();
    await clickThrough(buttonStarting('Ride '));
    await pump(4);
    expect(mounted?.container.textContent ?? '').toContain('End ride');
    expect(vi.mocked(createGradientSession)).toHaveBeenCalledTimes(2);
  });

  it('leaving the screen while the trainer is being asked acquires no lock and builds no session', async () => {
    const commands: Commands = { written: [], releases: [], requests: [] };
    const trainer = deferredPort(commands);
    const lock = lockSource();
    await openTheGame(trainer.port, lock.source);
    await clickThrough(buttonStarting('Ride '));
    expect(commands.requests).toHaveLength(1);

    mounted?.unmount();
    mounted = undefined;
    // `teardown` itself reads the trainer once, for the audio (#447); what is
    // counted from here is whether `start` reads it AGAIN after the answer.
    const readsAfterLeaving = trainer.reads();
    trainer.grant();
    await settle();
    await settle();

    // Nothing after the answer ran: the trainer was not re-read, no session
    // was built, no lock was taken — the control, if it was granted, is simply
    // kept (#372). Without the check, `start` resumes into a component that
    // is gone and acquires a lock nothing will ever release.
    expect(lock.acquired).toHaveLength(0);
    expect(vi.mocked(createGradientSession)).not.toHaveBeenCalled();
    expect(trainer.reads()).toBe(readsAfterLeaving);
    expect(commands.written).toHaveLength(0);
  });

  it('releases a lock that arrives after the rider has left', async () => {
    // The same shape one await later: the lock's own `acquire` is in flight
    // when the rider navigates away, and `teardown` has already released the
    // placeholder. The lock that then arrives is released on the spot.
    const commands: Commands = { written: [], releases: [], requests: [] };
    const lock = lockSource(true);
    await openTheGame(trainerPort(READY, commands), lock.source);
    await clickThrough(buttonStarting('Ride '));
    expect(lock.acquired).toHaveLength(1);
    expect(lock.released).toHaveLength(0);

    mounted?.unmount();
    mounted = undefined;
    lock.settle();
    await settle();
    await settle();

    expect(lock.released).toEqual([1]);
  });

  it('leaving the screen while the ghost loads builds no session and takes no lock', async () => {
    // The shape #509 names as older than the control request: `start` awaited
    // `loadGhost` before it awaited anything else, and a rider who left during
    // that load got the same leaked lock. One await earlier, same check.
    const commands: Commands = { written: [], releases: [], requests: [] };
    const lock = lockSource();
    let releaseGhost: () => void = () => undefined;
    const route: RidableRoute = { ...hillRoute(), attempts: 1 };
    mounted = await mount(
      <GameView
        port={{
          ...pedallingPort(route),
          loadGhost: () =>
            new Promise((resolve) => {
              releaseGhost = () => {
                resolve(undefined);
              };
            }),
        }}
        trainer={trainerPort(READY, commands)}
        renderer={() => Promise.resolve(capturingRenderer([]))}
        now={() => nowMs}
        screenLock={lock.source}
      />,
    );
    await settle();
    const ghost = queryAll<HTMLInputElement>(
      mounted.container,
      'input[type="checkbox"]:not([disabled])',
    ).find((box) => (box.parentElement?.textContent ?? '').includes('Race your own best attempt'));
    expect(ghost).toBeDefined();
    await clickThrough(ghost);
    await clickThrough(buttonStarting('Ride '));

    mounted.unmount();
    mounted = undefined;
    releaseGhost();
    await settle();
    await settle();

    expect(lock.acquired).toHaveLength(0);
    expect(vi.mocked(createGradientSession)).not.toHaveBeenCalled();
    expect(commands.written).toHaveLength(0);
  });
});

describe('the ride gives the screen back, and does not take it again — #566’s review', () => {
  /**
   * The real `browserScreenLockSource` over a page that can be hidden, with
   * each `release()` the component makes counted on the way through.
   *
   * ⚠️ Since #566 an unreleased lock takes itself back on every return to the
   * page, so a `GameView` that forgot to release it would keep the tablet
   * awake after every app switch for the rest of the tab's life. `wake-lock.test.ts`
   * proves the lock lets go when asked; this proves the component asks.
   */
  function watchedLock(): {
    readonly page: HideablePage;
    readonly source: ScreenLockSource;
    readonly released: () => number;
  } {
    const page = hideablePage();
    const real = browserScreenLockSource(page.api, page.page);
    let released = 0;
    return {
      page,
      source: {
        acquire: async () => {
          const lock = await real.acquire();
          return {
            get held() {
              return lock.held;
            },
            release: async () => {
              released += 1;
              return lock.release();
            },
          };
        },
      },
      released: () => released,
    };
  }

  async function rideWith(lock: ScreenLockSource): Promise<void> {
    const commands: Commands = { written: [], releases: [], requests: [] };
    mounted = await mount(
      <GameView
        port={pedallingPort(hillRoute())}
        trainer={trainerPort(READY, commands)}
        renderer={() => Promise.resolve(capturingRenderer([]))}
        now={() => nowMs}
        screenLock={lock}
      />,
    );
    await settle();
    await clickThrough(buttonStarting('Ride '));
    await pump(4);
    await settle();
  }

  it('releases once when the rider presses End ride, and a page shown afterwards asks for nothing', async () => {
    const lock = watchedLock();
    await rideWith(lock.source);
    expect(lock.page.requests()).toBe(1);
    expect(lock.page.live()).toBe(1);
    // Mid-ride, a page hidden and shown takes the lock back — the control
    // that makes the "asks for nothing" below mean something.
    lock.page.hide();
    lock.page.show();
    await settle();
    expect(lock.page.requests()).toBe(2);
    expect(lock.page.live()).toBe(1);

    await clickThrough(buttonStarting('End ride'));
    await settle();
    expect(lock.released()).toBe(1);
    expect(lock.page.live()).toBe(0);
    expect(lock.page.watching()).toBe(0);

    lock.page.hide();
    lock.page.show();
    await settle();
    expect(lock.page.requests()).toBe(2);
    expect(lock.page.live()).toBe(0);
  });

  it('releases once when the rider leaves mid-ride, and never takes it back', async () => {
    const lock = watchedLock();
    await rideWith(lock.source);
    expect(lock.page.live()).toBe(1);

    mounted?.unmount();
    mounted = undefined;
    await settle();
    expect(lock.released()).toBe(1);
    expect(lock.page.live()).toBe(0);

    lock.page.hide();
    lock.page.show();
    await settle();
    expect(lock.page.requests()).toBe(1);
    expect(lock.page.live()).toBe(0);
  });
});
