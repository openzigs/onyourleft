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

import { GameView, type GamePort, type RidableRoute } from './GameView';
import { gameTrainerFrom, type GameTrainerPort, type GradientTrainer } from './trainer-port';
import type { GameRenderer, SceneFrame } from './port';
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
}

/**
 * A trainer port built the way `main.tsx` builds one.
 *
 * ⚠️ Through the **real** `gameTrainerFrom` rather than by returning a
 * hand-made `GameTrainer`, so that a case asserting "a machine with no
 * simulation bit is not written to" exercises the production decision rather
 * than a fixture's opinion of it.
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
): GameTrainerPort {
  const control: GradientTrainer = {
    setSimulationParameters: async (parameters) => {
      commands.written.push(parameters);
      return Promise.resolve();
    },
    // #372: a release, which is a Reset — `stop` is no longer on the type.
    release: async () => {
      commands.releases.push(commands.written.length);
      return Promise.resolve({ kind: 'reset' as const });
    },
  };
  return { readTrainer: () => gameTrainerFrom(snapshot, control, workoutRunning) };
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
    const commands: Commands = { written: [], releases: [] };
    const { drawn } = await ride(trainerPort(READY, commands));

    // The renderer really was driven, or "no gradient" could be "no ride".
    expect(drawn.length).toBeGreaterThan(10);
    // ⚠️ **The assertion that was false for the whole of #362.** It goes red the
    // moment `GameView.start` stops building a session, or the tick stops
    // sampling one — and nothing else in this repository does.
    expect(commands.written.length).toBeGreaterThan(0);
  });

  it('sends the grade at the rider’s distance, climbing', async () => {
    const commands: Commands = { written: [], releases: [] };
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
    const commands: Commands = { written: [], releases: [] };
    await ride(trainerPort(READY, commands), 60);
    // Thirty seconds of road at one write a second, and a deadband on top —
    // never sixty, which is what a tick with no rate limit would produce.
    expect(commands.written.length).toBeLessThanOrEqual(31);
  });

  it('writes nothing to a trainer that does not offer simulation mode', async () => {
    // #362's fourth criterion. The one case no trainer in this loop can make.
    const commands: Commands = { written: [], releases: [] };
    const { drawn } = await ride(trainerPort({ ...READY, canSimulate: false }, commands));
    expect(drawn.length).toBeGreaterThan(10);
    expect(commands.written).toHaveLength(0);
  });

  it('writes nothing to a trainer that has not granted control', async () => {
    const commands: Commands = { written: [], releases: [] };
    await ride(trainerPort({ ...READY, hasControl: false }, commands));
    expect(commands.written).toHaveLength(0);
  });

  it('writes nothing to a trainer a workout is already driving', async () => {
    // ⚠️ The hazard the review of #362 found, ridden end to end rather than
    // argued at the pure function. `RideSession` is mounted above the router,
    // so a workout started on the Ride screen keeps writing ERG targets to the
    // one control point while the rider is in the game. A second writer at
    // about 1 Hz is the mild half; the sharp half is the release below.
    const commands: Commands = { written: [], releases: [] };
    const { drawn } = await ride(trainerPort(READY, commands, true));
    expect(drawn.length).toBeGreaterThan(10);
    expect(commands.written).toHaveLength(0);
  });

  it('sends no release when a workout holds the trainer', async () => {
    // ⚠️ **The assertion that is really about safety.** A release is an FTMS
    // Reset since #372 (a Stop before it), and either makes the machine stop
    // listening to this client — so a game ride that ended while a workout was
    // running would leave the workout's clock going and every one of its
    // targets refused or ignored — the silent failure `startWorkout` refuses to
    // start into, arriving after the guard.
    const commands: Commands = { written: [], releases: [] };
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
    const commands: Commands = { written: [], releases: [] };
    await ride(trainerPort(READY, commands, true));
    const text = mounted?.container.textContent ?? '';
    expect(text).toContain('workout is driving your trainer');
    expect(text).not.toContain('cannot be controlled');
  });

  it('tells the rider, rather than leaving them to believe the road is flat', async () => {
    const commands: Commands = { written: [], releases: [] };
    await ride(trainerPort({ ...READY, canSimulate: false }, commands));
    const text = mounted?.container.textContent ?? '';
    expect(text).toContain('does not offer simulation mode');
  });

  it('warns before the ride starts, where the advice can still be taken', async () => {
    // "Take control on the Ride screen" is only actionable on the picker.
    const commands: Commands = { written: [], releases: [] };
    mounted = await mount(
      <GameView
        port={pedallingPort(hillRoute())}
        trainer={trainerPort({ ...READY, hasControl: false }, commands)}
        renderer={() => Promise.resolve(capturingRenderer([]))}
        now={() => nowMs}
      />,
    );
    await settle();
    expect(mounted.container.textContent ?? '').toContain('Ride screen');
  });

  it('tells the rider on the picker when the last release was not confirmed — #372', async () => {
    // A game ride ends on the picker, not on the Ride screen, and a trainer
    // that refused the Reset may still be holding the hill.
    const commands: Commands = { written: [], releases: [] };
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
    const commands: Commands = { written: [], releases: [] };
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
    const commands: Commands = { written: [], releases: [] };
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
    const commands: Commands = { written: [], releases: [] };
    await ride(trainerPort(READY, commands));
    expect(mounted?.container.textContent ?? '').toContain('Trainer: simulating');
  });

  it('releases the trainer when the rider ends the ride', async () => {
    const commands: Commands = { written: [], releases: [] };
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
    const commands: Commands = { written: [], releases: [] };
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
