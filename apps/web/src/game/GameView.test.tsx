// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The wiring, which is the thing #237 says no gate in this repository looks at.
 *
 * > *"⚠️ **A test that fails when the wiring is removed**, not only when the
 * > maths is wrong. The unit tests for `advanceBot` and `pacerGap` all pass
 * > today, against a product with no pacer in it — so a test at that level
 * > would not have caught this and will not catch its return."*
 *
 * So every assertion below reads what a **renderer** was handed and what a
 * **rider** can see on the HUD, driven through the real component, the real
 * simulation and the real scene builder. Nothing is stubbed except the three
 * things that genuinely cannot exist here: the store behind `GamePort`, the GL
 * context behind `GameRenderer`, and the clock.
 *
 * ⚠️ **`requestAnimationFrame` is stubbed rather than awaited**, and that is
 * not only for speed. jsdom's own rAF fires on a real timer, so a test that
 * waited for it would assert against however many frames the machine happened
 * to deliver — which is precisely the frame-rate coupling `simulation.ts`
 * exists to keep out of the ride. Pumping the queue by hand, with the clock
 * advanced explicitly, makes the number of ticks a property of the test.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GameView,
  RIDE_ENDED_LABEL,
  RIDE_ENDED_TEXT,
  RIDER_GHOST_REFUSAL_TEXT,
  type GamePort,
  type RidableRoute,
  type RiderGhostLoad,
} from './GameView';
import { NO_GAME_TRAINER, type GameTrainerPort } from './trainer-port';
import { END_RIDE_TEXT } from '../ride/EndRideQuestion';
import { rideBack, RideBackContext, type RideBack } from '../shell/ride-back';
import type { GameRenderer, SceneFrame } from './port';
import { CAMERA_MAXIMUM_YAW_RATE, REDUCED_MOTION_MAXIMUM_YAW_RATE } from './camera';
import type { CalendarDay, Season } from './season';
import {
  FRAME_MS_REDUCE_ABOVE,
  QUALITY_LADDER,
  SUSTAINED_SAMPLES,
  qualitySettings,
  type QualitySettings,
} from './quality';
import { DEFAULT_PACER_INTENSITY } from './pacer-choice';
import { SCATTER_KINDS, STRUCTURE_KINDS } from './scatter';
import { NO_READING, type SensorReading } from './hud/fields';
import { HUD_LAYOUT_STORAGE_KEY, writeHudLayout } from './hud/hud-layout-preference';
import { NO_SENSORS } from './sensors';
import { NO_ROUTES_YET } from '../routes/two-importers';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';
import { tap } from '../design/touch-lock-testing';
import { TOUCH_LOCK_NAME } from '../design/TouchLockButton';
import type { CameraThrottle } from '../camera/session';
import {
  altitudeMetres,
  buildGhostTrack,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  kilograms,
  routeProfile,
  watts,
  type GhostTrack,
  type Kilograms,
  type RoutePoint,
} from '@onyourleft/domain';
import type { KitColour } from '@onyourleft/store';

import { DEFAULT_RIDER_MASS_KILOGRAMS } from '../athlete/mass';
import { UnitsProvider } from '../units/context';
import { START_WORD, toGoText } from './gantry-wording';
import { endRideAnswer } from './end-ride-testing';

/** Two kilometres of road that rises and falls, so a gradient is in play. */
function testRoute(samples = 200): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= samples; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index <= 100 ? index * 0.4 : (200 - index) * 0.4),
    });
  }
  return { id: 'route-1', name: 'Test hill', profile: routeProfile(points), attempts: 0 };
}

/**
 * A previous attempt that went round very much faster than this rider will.
 *
 * Fast on purpose: the gap to it has to be unmistakably different from the gap
 * to a bot crawling at 0.5 w/kg, or a test asserting "each gets its own number"
 * would pass against a HUD showing one number twice.
 */
const FAST_GHOST: GhostTrack = buildGhostTrack({
  elapsedSeconds: [0, 60],
  distanceMetres: [0, 1_200],
});

/**
 * A previous attempt at a walking pace — an hour at 1 m/s.
 *
 * ⚠️ **Slow on purpose, and the opposite purpose to {@link FAST_GHOST}'s.**
 * #254's test has to distinguish "the ghost advanced by the road the rider
 * rode" from "the ghost advanced by the whole stall", and a magnitude would do
 * it with a threshold nobody can defend. At this pace the answer is
 * **categorical**: after twenty-five seconds of riding the attempt is plainly
 * behind this rider, and after ten minutes of wall clock it is plainly in
 * front. The HUD says which, in words, so the assertion is a direction rather
 * than a number.
 */
const WALKING_GHOST: GhostTrack = buildGhostTrack({
  elapsedSeconds: [0, 3_600],
  distanceMetres: [0, 3_600],
});

/** What a rider with a cadence sensor on the bicycle is reporting. */
const LIVE_CADENCE: SensorReading = { value: 88, live: true, paired: true };

/** A rider on the trainer, pedalling steadily. */
function pedallingPort(
  route: RidableRoute,
  ghost?: GhostTrack,
  // ⚠️ Overridable since #349, because *no* cadence is the case that decides
  // what the cranks do — and it is the case every other test in this file has.
  // A thunk rather than a value, so a test can make a live sensor go quiet
  // mid-ride without rebuilding the port and restarting the ride.
  cadence: () => SensorReading = () => LIVE_CADENCE,
): GamePort {
  return {
    listRoutes: () => Promise.resolve([route]),
    loadGhost: () => Promise.resolve(ghost),
    readSensors: () => {
      sensorReads += 1;
      return {
        rider: { power: watts(220), live: true, paired: true },
        cadence: cadence(),
        heartRate: { value: 142, live: true, paired: true },
      };
    },
  };
}

/**
 * A renderer that draws nothing and keeps every frame it was given.
 *
 * ⚠️ It keeps every **rung** it was told about too, since #245. The scenery
 * budget reaches the screen down two paths — `sceneFrame` stops placing the
 * items and `setQuality` stops the belt submitting them — and only one of those
 * is visible in a `SceneFrame`. A fake that swallowed `setQuality` would leave
 * half the wiring assertable by nothing here.
 */
function capturingRenderer(frames: SceneFrame[]): GameRenderer {
  return {
    // #475: never asked — no ride in this file chose the realistic world.
    loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
    create: () => ({
      hasContext: true,
      prepare: () => Promise.resolve(),
      render: (frame: SceneFrame) => {
        frames.push(frame);
      },
      setQuality: (settings: QualitySettings) => {
        rungs.push(settings);
      },
      setRiderKit: (chosen: KitColour | undefined) => {
        kitsHanded.push({ chosen, framesBefore: frames.length });
      },
      setSeason: (season: Season) => {
        seasonsHanded.push(season);
      },
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };
}

/**
 * Every kit colour a view was told this test, and how many frames it had
 * drawn by then — #623. @see capturingRenderer
 */
let kitsHanded: { readonly chosen: KitColour | undefined; readonly framesBefore: number }[] = [];
/** Every season a view was told this test — #1622. @see capturingRenderer */
let seasonsHanded: Season[] = [];

let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let mounted: Mounted | undefined;
/** Every quality rung a renderer was handed this test. @see capturingRenderer */
let rungs: QualitySettings[] = [];
/**
 * How many times the port's sensors were read this test — once per animation
 * frame by the loop and once per render by the HUD, which is how #482's first
 * finding counts renders without reaching into React.
 */
let sensorReads = 0;

beforeEach(() => {
  kitsHanded = [];
  seasonsHanded = [];
  pending = [];
  rungs = [];
  sensorReads = 0;
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

/** Click a control and let React settle, inside `act` so no update escapes it. */
async function clickThrough(element: HTMLElement | undefined): Promise<void> {
  await act(async () => {
    element?.click();
    await Promise.resolve();
  });
  await settle();
}

/**
 * How much wall clock one pumped frame covers, in milliseconds.
 *
 * ⚠️ Deliberately far longer than a real frame. The corridor samples the route
 * on its own 10 m grid, so a marker's *position* only moves once the rider or
 * the bot has crossed a grid point — two seconds of riding leaves both snapped
 * to the start line and an assertion about movement reads as a wiring failure
 * when it is a resolution one. Covering a quarter of a second per frame rides
 * fifteen seconds in sixty frames, and the simulation is indifferent to the
 * frame rate by construction (#91) so nothing is distorted by it.
 */
const FRAME_PERIOD_MS = 250;

/**
 * How much wall clock a frame covers when the cranks are what is being measured.
 *
 * ⚠️ Shorter than {@link FRAME_PERIOD_MS} on purpose: `bicycle.ts` bounds one
 * step at `MAXIMUM_CRANK_STEP_SECONDS`, which is 250 ms, so a frame of exactly
 * that length would sit on the bound and an assertion about the *rate* would be
 * measuring the stall guard instead.
 */
const CRANK_FRAME_MS = 100;

/** A turn, in radians. @see bicycle.ts */
const TAU = Math.PI * 2;

/** Run `count` frames, advancing the clock by a frame period each time. */
async function pump(count: number, framePeriodMs = FRAME_PERIOD_MS): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const next = pending.shift();
    if (next === undefined) {
      return;
    }
    nowMs += framePeriodMs;
    await act(async () => {
      next(nowMs);
      await Promise.resolve();
    });
  }
}

/** Start a ride, optionally against a pacer. Returns the frames the renderer saw. */
async function startRiding(options: {
  readonly pacer: boolean;
  readonly intensity?: string;
  /** Whether to also race a previous attempt. @see FAST_GHOST */
  readonly ghost?: boolean;
  /** Which attempt, when the default is the wrong shape for the assertion. */
  readonly track?: GhostTrack;
  /** What the cadence channel is reporting — #349. @see LIVE_CADENCE */
  readonly cadence?: () => SensorReading;
  /** The camera the ladder throttles — #514. @see recordingCamera */
  readonly camera?: CameraThrottle;
  /** The rider's local day — #1622. @see GameViewProps.today */
  readonly today?: () => CalendarDay;
}): Promise<SceneFrame[]> {
  const route = options.ghost === true ? { ...testRoute(), attempts: 1 } : testRoute();
  const frames: SceneFrame[] = [];
  mounted = await mount(
    <GameView
      port={pedallingPort(
        route,
        options.ghost === true ? (options.track ?? FAST_GHOST) : undefined,
        options.cadence ?? (() => LIVE_CADENCE),
      )}
      renderer={() => Promise.resolve(capturingRenderer(frames))}
      now={() => nowMs}
      camera={options.camera}
      today={options.today}
    />,
  );
  await settle();

  if (options.pacer) {
    const box = queryAll<HTMLInputElement>(mounted.container, 'input[type="checkbox"]').find(
      (input) => (input.closest('label')?.textContent ?? '').includes('pacer'),
    );
    expect(box).toBeDefined();
    await clickThrough(box);
  }
  if (options.ghost === true) {
    const box = queryAll<HTMLInputElement>(mounted.container, 'input[type="checkbox"]').find(
      (input) => (input.closest('label')?.textContent ?? '').includes('Race your'),
    );
    expect(box?.disabled).toBe(false);
    await clickThrough(box);
  }
  if (options.intensity !== undefined) {
    await typeIntensity(options.intensity);
  }

  const ride = queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
    (button.textContent ?? '').startsWith('Ride '),
  );
  expect(ride?.disabled).toBe(false);
  await clickThrough(ride);
  // The renderer is loaded asynchronously and the first frames draw nothing —
  // exactly as on a device whose GPU is slow to hand over a context.
  await pump(2, 1000 / 30);
  await settle();
  return frames;
}

/** Type into the intensity box, through the native setter React 19 needs. */
async function typeIntensity(value: string): Promise<void> {
  const input = queryAll<HTMLInputElement>(
    mounted?.container ?? document,
    'input[type="number"]',
  )[0];
  expect(input).toBeDefined();
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  await act(async () => {
    descriptor?.set?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}

/** The ghost control on the picker, found the way a rider finds it. */
function ghostCheckbox(): HTMLInputElement | undefined {
  return queryAll<HTMLInputElement>(mounted?.container ?? document, 'input[type="checkbox"]').find(
    (input) => (input.closest('label')?.textContent ?? '').includes('Race your'),
  );
}

/** The control that starts a ride. */
function rideButton(): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find((button) =>
    (button.textContent ?? '').startsWith('Ride '),
  );
}

/** The control that ends one, on the HUD. */
function endRideButton(): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find(
    (button) => button.textContent === 'End ride',
  );
}

/**
 * #2349, #2381: *End ride*, then the question's *End ride* — how a game ride with nothing
 * recorded under it ends now that *End ride* asks first.
 */
async function endTheRide(
  press: (element: HTMLElement | undefined) => Promise<void> = clickThrough,
): Promise<void> {
  await press(endRideButton());
  await press(endRideAnswer(document, 'End ride'));
}

/** The value a HUD field is showing, found by its label. */
function hudField(label: string): string {
  const rows = queryAll(mounted?.container ?? document, '.oyl-hud__field');
  const row = rows.find((each) => each.querySelector('dt')?.textContent === label);
  return row?.querySelector('dd')?.textContent ?? '';
}

describe('riding against a pacer', () => {
  /**
   * The gentlest pace the rule allows: about 38 W, against a rider on 220 W.
   *
   * ⚠️ Chosen rather than left at the default, and the reason is the mutation
   * this file has to survive. A `botDistance` wired to the **rider's own**
   * odometer draws a marker that moves and produces a gap that formats — so a
   * test riding a bot at a similar pace would pass against it. At 0.5 w/kg the
   * two are unambiguously in different places, and every assertion below is
   * about the difference rather than about the bot alone.
   */
  const SLOW = '0.5';

  it('puts the bot on the road, moving, and not where the rider is', async () => {
    const frames = await startRiding({ pacer: true, intensity: SLOW });
    await pump(60);

    const drawn = frames.filter((frame) => frame.markers.some((marker) => marker.kind === 'bot'));
    expect(drawn.length).toBeGreaterThan(0);

    const botAt = (frame: SceneFrame | undefined): number | undefined =>
      frame?.markers.find((marker) => marker.kind === 'bot')?.z;
    const last = drawn[drawn.length - 1];

    // It moved…
    expect(botAt(drawn[0])).toBeDefined();
    expect(botAt(last)).not.toBe(botAt(drawn[0]));
    // …and it is not simply the rider drawn twice.
    expect(botAt(last)).not.toBe(last?.markers.find((marker) => marker.kind === 'rider')?.z);
  });

  it('reports a real gap in the HUD rather than a dash', async () => {
    await startRiding({ pacer: true, intensity: SLOW });
    await pump(60);

    const gap = hudField('Pacer');
    expect(gap).not.toContain(NO_READING);
    // `pacer/gap.ts` carries the sign in a word rather than in a minus sign, so
    // a magnitude and a direction are both required — and the magnitude must
    // not be nought, which is what a gap measured against the rider themselves
    // would read.
    const parsed = /^(\d+) s (ahead of you|behind you)$/.exec(gap);
    expect(parsed).not.toBeNull();
    expect(Number(parsed?.[1])).toBeGreaterThan(0);
  });

  it('tells the rider which side of the bot they are on', async () => {
    await startRiding({ pacer: true, intensity: SLOW });
    await pump(60);

    // ⚠️ The rider is on 2.75 w/kg against the bot's 0.5, so they are in front
    // — and this field is labelled **Pacer**, so what it says is that the
    // **pacer** is behind. This assertion read `toContain('ahead')` until #255,
    // which is the defect in one line: the same true fact, stated about the
    // rider under a label naming the bot.
    expect(hudField('Pacer')).toContain('behind you');
    expect(hudField('Pacer')).not.toContain('ahead');
  });
});

describe('racing another rider’s ghost (#331)', () => {
  /** A port offering another rider's ghost, with spies on both ghost reads. */
  function riderPort(route: RidableRoute, answer: RiderGhostLoad) {
    const loadGhost = vi.fn(() => Promise.resolve<GhostTrack | undefined>(FAST_GHOST));
    const loadRiderGhost = vi.fn(() => Promise.resolve(answer));
    const port: GamePort = {
      ...pedallingPort(route, FAST_GHOST),
      loadGhost,
      riderGhostOffered: () => true,
      loadRiderGhost,
    };
    return { port, loadGhost, loadRiderGhost };
  }

  const toggle = (text: string): HTMLInputElement | undefined =>
    queryAll<HTMLInputElement>(mounted?.container ?? document, 'input[type="checkbox"]').find(
      (input) => (input.closest('label')?.textContent ?? '').includes(text),
    );

  async function rideWith(port: GamePort, frames: SceneFrame[], ownFirst = false): Promise<void> {
    mounted = await mount(
      <GameView
        port={port}
        renderer={() => Promise.resolve(capturingRenderer(frames))}
        now={() => nowMs}
      />,
    );
    await settle();
    if (ownFirst) await clickThrough(toggle('Race your own'));
    await clickThrough(toggle('Race another rider'));
    const ride = queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    );
    await clickThrough(ride);
    await pump(2, 1000 / 30);
    await settle();
  }

  const bea: RiderGhostLoad = { kind: 'ghost', rider: 'Bea', track: FAST_GHOST };

  it('races ONE ghost, labelled with whose it is, in place of the rider’s own', async () => {
    const route = { ...testRoute(), attempts: 1 };
    const { port, loadGhost, loadRiderGhost } = riderPort(route, bea);
    const frames: SceneFrame[] = [];
    // The rider's own best first, then another rider's: the second replaces it.
    await rideWith(port, frames, true);
    await pump(60);

    expect(loadRiderGhost).toHaveBeenCalledTimes(1);
    expect(loadGhost).not.toHaveBeenCalled();
    const last = frames[frames.length - 1];
    expect(last?.markers.map((marker) => marker.kind).sort()).toEqual(['ghost', 'rider']);
    expect(hudField('Bea')).toContain('ahead of you');
    expect(hudField('Your best')).toBe('');
  });

  it('hands the recording no outcome for another rider’s ghost, even when the rider beats it', async () => {
    const route = { ...testRoute(), attempts: 1 };
    const hopeless = buildGhostTrack({ elapsedSeconds: [0, 4], distanceMetres: [0, 3] });
    const { port } = riderPort(route, { kind: 'ghost', rider: 'Bea', track: hopeless });
    const handed: (string | undefined)[] = [];
    const trainer: GameTrainerPort = {
      readTrainer: () => NO_GAME_TRAINER,
      askForControlOnRide: () => Promise.resolve(),
      workoutRescue: () => undefined,
      recordingMayStop: () => false,
      gameRideEnded: (outcome) => {
        handed.push(outcome);
      },
      rideMovingSeconds: () => undefined,
      watchRide: () => () => undefined,
    };
    mounted = await mount(<GameView port={port} trainer={trainer} now={() => nowMs} />);
    await settle();
    await clickThrough(toggle('Race another rider'));
    await clickThrough(
      queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
        (button.textContent ?? '').startsWith('Ride '),
      ),
    );
    await pump(60);
    expect(hudField('Bea')).toBe('Beaten by you');
    await endTheRide();
    pending = [];
    // A comparison with another rider is never a result about the rider's own best.
    expect(handed).toEqual([undefined]);
  });

  it('turns the rider’s own ghost off when another rider’s is turned on', async () => {
    const route = { ...testRoute(), attempts: 1 };
    mounted = await mount(
      <GameView
        port={riderPort(route, bea).port}
        renderer={() => Promise.resolve(capturingRenderer([]))}
      />,
    );
    await settle();
    await clickThrough(toggle('Race your own'));
    expect(toggle('Race your own')?.checked).toBe(true);
    await clickThrough(toggle('Race another rider'));
    expect(toggle('Race another rider')?.checked).toBe(true);
    expect(toggle('Race your own')?.checked).toBe(false);
    await clickThrough(toggle('Race your own'));
    expect(toggle('Race another rider')?.checked).toBe(false);
  });

  it('stops racing it when the rider says so: off the road and off the HUD', async () => {
    const { port } = riderPort(testRoute(), bea);
    const frames: SceneFrame[] = [];
    await rideWith(port, frames);
    await pump(10);
    expect(hudField('Bea')).not.toBe('');

    const stop = queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find(
      (button) => button.textContent === 'Stop ghost of Bea',
    );
    expect(stop).toBeDefined();
    await clickThrough(stop);
    await pump(10);

    expect(hudField('Bea')).toBe('');
    const last = frames[frames.length - 1];
    expect(last?.markers.map((marker) => marker.kind)).toEqual(['rider']);
  });

  it('does not start the ride, and says why, when nobody who agreed has ridden the route', async () => {
    const { port } = riderPort(testRoute(), { kind: 'none' });
    const frames: SceneFrame[] = [];
    await rideWith(port, frames);

    expect(mounted?.container.textContent).toContain(RIDER_GHOST_REFUSAL_TEXT.none);
    expect(frames).toEqual([]);
    expect(
      queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').some((button) =>
        (button.textContent ?? '').startsWith('Ride '),
      ),
    ).toBe(true);
  });

  it('does not start the ride when the instance did not answer with a ghost', async () => {
    const { port } = riderPort(testRoute(), { kind: 'unavailable' });
    const frames: SceneFrame[] = [];
    await rideWith(port, frames);

    expect(mounted?.container.textContent).toContain(RIDER_GHOST_REFUSAL_TEXT.unavailable);
    expect(frames).toEqual([]);
  });

  it('offers no such choice on a device with no instance', async () => {
    mounted = await mount(
      <GameView
        port={{ ...pedallingPort(testRoute()), riderGhostOffered: () => false }}
        renderer={() => Promise.resolve(capturingRenderer([]))}
      />,
    );
    await settle();
    expect(toggle('Race another rider')).toBeUndefined();
  });
});

describe('riding without one', () => {
  it('draws no bot and shows no gap, which is what #237 observed on a device', async () => {
    const frames = await startRiding({ pacer: false });
    await pump(60);

    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((frame) => frame.markers.every((marker) => marker.kind !== 'bot'))).toBe(
      true,
    );
    expect(hudField('Pacer')).toContain(NO_READING);
  });
});

describe('riding against both a pacer and your own best (#253)', () => {
  /**
   * The path nothing drove before this issue.
   *
   * ⚠️ `withGhost` and `withPacer` are independent checkboxes, so a rider can
   * take both — and the HUD had **one** gap slot, which resolved to the bot.
   * Every unit test of `pacerGap` passed against a product that computed the
   * ghost's gap nowhere, which is #237's lesson arriving a second time: the
   * assertions below read what a rider can see, driven through the real
   * component.
   */
  it('gives each of them its own gap, rather than the pacer’s twice', async () => {
    const frames = await startRiding({ pacer: true, intensity: '0.5', ghost: true });
    await pump(60);

    // Both are on the road…
    const last = frames[frames.length - 1];
    expect(last?.markers.map((marker) => marker.kind).sort()).toEqual(['bot', 'ghost', 'rider']);

    // …and both are in the HUD, with their own numbers.
    const pacer = hudField('Pacer');
    const best = hudField('Your best');
    expect(pacer).not.toContain(NO_READING);
    expect(best).not.toContain(NO_READING);
    expect(pacer).not.toBe(best);
    // The rider is on 2.75 w/kg against a bot on 0.5 and a ghost on 20 m/s, so
    // the two directions are opposite — which no single gap under two labels
    // could produce.
    expect(pacer).toContain('behind you');
    expect(best).toContain('ahead of you');
  });
});

describe('a phone backgrounded mid-ride (#254)', () => {
  /**
   * The wiring #254 was about, driven the way a rider would produce it: frames
   * stop arriving for ten minutes, then one arrives.
   *
   * ⚠️ **No unit test could see this and that is the finding, not an excuse.**
   * `ghostDistanceAt` replaying a recording against recorded time is right,
   * `MAXIMUM_STEPS_PER_ADVANCE` bounding a catch-up burst is right, and
   * crediting the whole outstanding amount to the ride's clock is right. The
   * ghost went up the road because the first of those was asked at the third's
   * clock, and only a test that owns all three at once can watch it happen.
   */
  const BACKGROUNDED_MS = 600_000;

  it('does not hand the ghost road the rider never covered', async () => {
    const frames = await startRiding({ pacer: false, ghost: true, track: WALKING_GHOST });
    await pump(60);

    // Fifteen seconds in, the rider is comfortably up the road on an attempt
    // that went round at a walking pace.
    expect(hudField('Your best')).toContain('behind you');

    await pump(1, BACKGROUNDED_MS);

    // Ten minutes of wall clock later — and ten seconds of riding later, which
    // is what MAXIMUM_STEPS_PER_ADVANCE allows — the attempt is still behind.
    // Read against `elapsed` it would have walked another six hundred metres
    // while the rider covered fifty, and this field would say 'ahead of you'.
    expect(hudField('Your best')).toContain('behind you');
    expect(hudField('Your best')).not.toContain('ahead');

    // And it is still on the road: a ghost that vanished would also stop
    // reporting a direction, so the assertions above need this one beside them.
    const last = frames[frames.length - 1];
    expect(last?.markers.map((marker) => marker.kind).sort()).toEqual(['ghost', 'rider']);
  });
});

/**
 * #259 — the third time in `game/` that something built, exported, unit-tested
 * and green turned out to be reachable by nobody.
 *
 * `scene.ts` §`ghostFinished` had a unit test in `scene.test.ts` and no
 * production consumer, so after the attempt crossed the line the HUD went on
 * quoting a gap against a rider who had stopped — a screen on which *"it is
 * 40 s up the road"* and *"it finished 40 s ago and you are still riding"* look
 * identical. Both assertions below are about what a rider can **see**, driven
 * through the real component, the real simulation and the real HUD, for the
 * reason #237 gives: a unit test of the predicate is what let this ship.
 */
describe('your own best crossing the line (#259)', () => {
  /**
   * An attempt that stops after four seconds, three metres up the road.
   *
   * Deliberately hopeless, so this rider is unambiguously past it by the time
   * it finishes and stays past it — the win is categorical rather than a
   * margin somebody has to defend.
   */
  const BEATEN_GHOST: GhostTrack = buildGhostTrack({
    elapsedSeconds: [0, 4],
    distanceMetres: [0, 3],
  });

  /**
   * One that stops just as soon, forty metres up the road.
   *
   * ⚠️ **Both of those numbers are load-bearing.** At the frame it finishes
   * this rider is about eleven metres in, so they lost; ten seconds later they
   * are past forty metres, so the *live* gap to the stopped attempt has changed
   * sign. That is the window in which a screen deriving the result from the gap
   * congratulates a rider on a ride they were plainly slower than, and it is
   * why `ghost-outcome.ts` settles the answer once.
   */
  const OUTPACED_GHOST: GhostTrack = buildGhostTrack({
    elapsedSeconds: [0, 4],
    distanceMetres: [0, 40],
  });

  it('tells a rider who got there first that they beat it', async () => {
    const frames = await startRiding({ pacer: false, ghost: true, track: BEATEN_GHOST });
    await pump(60);

    expect(hudField('Your best')).toBe('Beaten by you');
    // Without the wiring this field reads `12 s behind you` — true of a race
    // that is still on, and the attempt finished ten seconds ago.
    expect(hudField('Your best')).not.toContain('behind you');

    // ⚠️ And the marker is still on the road, which `scene.ts` is careful about
    // for the same reason. A ghost that vanished would also stop quoting a gap,
    // so the assertions above need this one beside them.
    const last = frames[frames.length - 1];
    expect(last?.markers.map((marker) => marker.kind).sort()).toEqual(['ghost', 'rider']);
  });

  it('does not congratulate a slower rider who later passes its distance', async () => {
    await startRiding({ pacer: false, ghost: true, track: OUTPACED_GHOST });

    // Five seconds in: the attempt has finished forty metres up the road and
    // this rider is nowhere near it.
    await pump(20);
    expect(hudField('Your best')).toBe('Finished ahead of you');

    // Ten seconds later they are well past forty metres — and they are still
    // the slower of the two, because the four seconds it took have gone.
    await pump(40);
    expect(hudField('Your best')).toBe('Finished ahead of you');
    expect(hudField('Your best')).not.toContain('Beaten');
  });

  /**
   * The second ride, which is where a latched answer goes wrong if nothing
   * clears it.
   *
   * ⚠️ **The latch is what makes this reachable.** `ghost-outcome.ts` returns
   * `settled` unchanged whenever it is defined — that is the whole of its
   * defence against a rider who keeps riding — so a verdict that survives into
   * the next ride is never revisited and never corrected. A rider who beat
   * their best on one route, ended the ride and started another would be
   * congratulated on frame one, about an attempt that is no longer loaded.
   *
   * It is the same false congratulation the module exists to prevent, arriving
   * from the other direction, and no assertion in this file could see it: the
   * `End ride` control had never been clicked by a test at all.
   */
  it('does not carry one ride’s result into the next', async () => {
    const route = { ...testRoute(), attempts: 1 };
    // Beaten first, then an attempt still out on the road — so the second ride
    // has a live gap to quote and a stale verdict would be visible as one.
    const tracks: GhostTrack[] = [BEATEN_GHOST, WALKING_GHOST];
    let loaded = 0;
    const port: GamePort = {
      ...pedallingPort(route),
      loadGhost: () => {
        const track = tracks[loaded] ?? WALKING_GHOST;
        loaded += 1;
        return Promise.resolve(track);
      },
    };
    mounted = await mount(<GameView port={port} now={() => nowMs} />);
    await settle();

    await clickThrough(ghostCheckbox());
    await clickThrough(rideButton());
    await pump(60);
    expect(hudField('Your best')).toBe('Beaten by you');

    await endTheRide();
    // ⚠️ `cancelAnimationFrame` is stubbed to do nothing, so the frame the
    // ended ride had already requested is still in the queue and would advance
    // the *new* simulation under the *old* loop's closure. A rider's browser
    // really does cancel it; the test has to.
    pending = [];

    // The ghost box is still ticked — ending a ride does not un-choose it — so
    // this is the picker as a rider leaves it.
    await clickThrough(rideButton());
    await pump(60);
    expect(loaded).toBe(2);

    // Racing a walking pace, fifteen seconds in: a gap, in front of them, and
    // nothing settled. Left over, the field would still read `Beaten by you`.
    expect(hudField('Your best')).not.toContain('Beaten');
    expect(hudField('Your best')).toContain('behind you');
  });

  /**
   * #1042: the game saves no ride, so the LATCHED outcome travels to the
   * recording under it — the result card states it when that is saved. Once
   * per ride that was on the stage, and the latched answer rather than the
   * live gap: the outpaced rider below has passed the attempt's distance by
   * the time they press End ride, and is still handed `not-beaten`.
   */
  it('hands the recording each ended ride’s latched outcome, and nothing for the picker (#1042)', async () => {
    const route = { ...testRoute(), attempts: 1 };
    const tracks: (GhostTrack | undefined)[] = [BEATEN_GHOST, OUTPACED_GHOST];
    let loaded = 0;
    const port: GamePort = {
      ...pedallingPort(route),
      loadGhost: () => {
        const track = tracks[loaded];
        loaded += 1;
        return Promise.resolve(track);
      },
    };
    const handed: (string | undefined)[] = [];
    const trainer: GameTrainerPort = {
      readTrainer: () => NO_GAME_TRAINER,
      askForControlOnRide: () => Promise.resolve(),
      workoutRescue: () => undefined,
      recordingMayStop: () => false,
      gameRideEnded: (outcome) => {
        handed.push(outcome);
      },
      rideMovingSeconds: () => undefined,
      watchRide: () => () => undefined,
    };
    mounted = await mount(<GameView port={port} trainer={trainer} now={() => nowMs} />);
    await settle();
    // The picker alone hands over nothing.
    expect(handed).toEqual([]);

    await clickThrough(ghostCheckbox());
    await clickThrough(rideButton());
    await pump(60);
    expect(hudField('Your best')).toBe('Beaten by you');
    await endTheRide();
    pending = [];
    expect(handed).toEqual(['beaten']);

    await clickThrough(rideButton());
    await pump(20);
    await pump(40);
    expect(hudField('Your best')).toBe('Finished ahead of you');
    await endTheRide();
    pending = [];
    expect(handed).toEqual(['beaten', 'not-beaten']);

    // Leaving from the picker is not a third ride ending, so it must not wipe
    // what the last one settled.
    mounted?.unmount();
    mounted = undefined;
    expect(handed).toEqual(['beaten', 'not-beaten']);
  });
});

describe('the ride’s moving time on the HUD — #1111', () => {
  /**
   * ⚠️ `HudPanel`'s `movingSeconds` is an optional prop threaded through JSX,
   * which `check:wiring` cannot follow (docs/agents/wiring-gate.md §4j §Limits) — so this drives
   * the real `GameView` and reads the HUD, rather than trusting that the port
   * method being called means the field shows what it returned.
   */
  it('shows the recorder’s figure from the port, and nothing the simulation counted', async () => {
    let recorded: number | undefined = 65;
    const trainer: GameTrainerPort = {
      readTrainer: () => NO_GAME_TRAINER,
      askForControlOnRide: () => Promise.resolve(),
      workoutRescue: () => undefined,
      recordingMayStop: () => false,
      gameRideEnded: () => undefined,
      rideMovingSeconds: () => recorded,
      watchRide: () => () => undefined,
    };
    mounted = await mount(
      <GameView port={pedallingPort(testRoute())} trainer={trainer} now={() => nowMs} />,
    );
    await settle();
    await clickThrough(rideButton());
    await pump(60);
    expect(hudField('Moving')).toBe('0:01:05');

    // Ten seconds of frames: the simulation's clock runs, the field does not —
    // the recorder (paused, say) has not moved, so neither does the HUD.
    await pump(600);
    expect(hudField('Moving')).toBe('0:01:05');

    recorded = 3725;
    await pump(2);
    expect(hudField('Moving')).toBe('1:02:05');

    // No recording under the ride: a dash, and no "Sensor lost".
    recorded = undefined;
    await pump(2);
    expect(hudField('Moving')).toBe(NO_READING);
  });
});

describe('the ride clock from the first second — #2382', () => {
  /** Whole seconds of an `h:mm:ss` the HUD shows. */
  function inSeconds(shown: string): number {
    const [hours = 0, minutes = 0, secs = 0] = shown.split(':').map(Number);
    return hours * 3600 + minutes * 60 + secs;
  }

  /** Every label the HUD shows, so a field's absence can be asserted. */
  function hudLabels(): (string | null)[] {
    return queryAll(mounted?.container ?? document, '.oyl-hud__field dt').map(
      (each) => each.textContent,
    );
  }

  it('runs the ride’s own clock, labelled Ride, on a ride that records nothing', async () => {
    mounted = await mount(<GameView port={pedallingPort(testRoute())} now={() => nowMs} />);
    await settle();
    await clickThrough(rideButton());
    // The ride's first frames: a time, not a dash, before a second has passed.
    await pump(2);
    expect(hudField('Ride')).toMatch(/^0:00:0\d$/);
    expect(hudLabels()).not.toContain('Elapsed');
    // And it runs: a second and a half of frames later it reads later.
    const first = inSeconds(hudField('Ride'));
    await pump(90);
    expect(inSeconds(hudField('Ride'))).toBeGreaterThan(first);
    // The moving time is still the recorder's, and there is none.
    expect(hudField('Moving')).toBe(NO_READING);
  });

  it('shows the recorder’s elapsed time, labelled Elapsed, whenever a recording runs', async () => {
    let recorded: number | undefined = 125;
    const trainer: GameTrainerPort = {
      readTrainer: () => NO_GAME_TRAINER,
      askForControlOnRide: () => Promise.resolve(),
      workoutRescue: () => undefined,
      recordingMayStop: () => false,
      gameRideEnded: () => undefined,
      rideMovingSeconds: () => (recorded === undefined ? undefined : 65),
      rideElapsedSeconds: () => recorded,
      watchRide: () => () => undefined,
    };
    mounted = await mount(
      <GameView port={pedallingPort(testRoute())} trainer={trainer} now={() => nowMs} />,
    );
    await settle();
    await clickThrough(rideButton());
    await pump(60);
    expect(hudField('Elapsed')).toBe('0:02:05');
    expect(hudLabels()).not.toContain('Ride');

    // Ten seconds of frames: the simulation's clock runs, the recorder's
    // figure (paused, say) does not, and the HUD shows the recorder's.
    await pump(600);
    expect(hudField('Elapsed')).toBe('0:02:05');

    // The recording gone: the ride's own clock, under its own label, which
    // has been running since the first frame — never the recorder's figure.
    recorded = undefined;
    await pump(2);
    expect(hudLabels()).not.toContain('Elapsed');
    expect(inSeconds(hudField('Ride'))).toBeGreaterThanOrEqual(10);
  });

  function rideButton(): HTMLButtonElement | undefined {
    return queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    );
  }
});

describe('the ride’s moving time while the GAME is paused — #1111’s review', () => {
  /**
   * The game's *Pause* stops the render loop and does NOT pause the recording,
   * which goes on counting until its own auto-pause. A figure read only on the
   * tick's render froze at the press. The HUD re-renders when the controller
   * says it changed (`trainer-port.ts` §`GameTrainerPort.watchRide`).
   */
  it('keeps agreeing with the recorder while no frame is drawn', async () => {
    let recorded = 65;
    const listeners = new Set<() => void>();
    const trainer: GameTrainerPort = {
      readTrainer: () => NO_GAME_TRAINER,
      askForControlOnRide: () => Promise.resolve(),
      workoutRescue: () => undefined,
      recordingMayStop: () => false,
      gameRideEnded: () => undefined,
      rideMovingSeconds: () => recorded,
      watchRide: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    mounted = await mount(
      <GameView port={pedallingPort(testRoute())} trainer={trainer} now={() => nowMs} />,
    );
    await settle();
    await clickThrough(rideButton());
    await pump(60);
    expect(hudField('Moving')).toBe('0:01:05');

    const pause = queryAll<HTMLButtonElement>(mounted.container, 'button').find(
      (button) => button.textContent === 'Pause',
    );
    await clickThrough(pause);
    expect(pause?.textContent).toBe('Resume');
    // What a browser's `cancelAnimationFrame` does, which this file's stub
    // does not: the frame the paused loop had already asked for never comes.
    pending.length = 0;

    // The recorder counts on — the rider is still pedalling. The precondition:
    // the game really is paused, so no frame re-renders the HUD, and without
    // the subscription the field would stay where the press left it.
    recorded = 75;
    await pump(60);
    expect(hudField('Moving')).toBe('0:01:05');

    // The controller tells its subscribers on its own tick.
    await act(async () => {
      for (const listener of [...listeners]) listener();
      await Promise.resolve();
    });
    expect(hudField('Moving')).toBe('0:01:15');

    // And it stops telling the HUD once the game is gone.
    mounted.unmount();
    mounted = undefined;
    expect(listeners.size).toBe(0);
  });
});

describe('the choice itself', () => {
  /** The pacer's switch, found by the words beside it. */
  function pacerSwitch(): HTMLInputElement | undefined {
    return queryAll<HTMLInputElement>(
      mounted?.container ?? document,
      'input[type="checkbox"]',
    ).find((input) => (input.closest('label')?.textContent ?? '').includes('pacer'));
  }

  /** The intensity box, found by its label rather than by its position. */
  function intensityBox(): HTMLInputElement | undefined {
    return queryAll<HTMLInputElement>(mounted?.container ?? document, 'input[type="number"]').find(
      (input) => (input.labels?.[0]?.textContent ?? '').includes('Pacer intensity'),
    );
  }

  function rideButton(): HTMLButtonElement | undefined {
    return queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    );
  }

  it('offers the pacer the way the ghost is offered, with a default already in the box', async () => {
    mounted = await mount(<GameView port={pedallingPort(testRoute())} now={() => nowMs} />);
    await settle();

    const text = mounted.container.textContent ?? '';
    expect(text).toContain('pacer');
    await clickThrough(pacerSwitch());
    expect(intensityBox()?.value).toBe(String(DEFAULT_PACER_INTENSITY));
  });

  it('shows the intensity box only while the pacer is on (#2338)', async () => {
    mounted = await mount(<GameView port={pedallingPort(testRoute())} now={() => nowMs} />);
    await settle();

    const toggle = pacerSwitch();
    expect(toggle?.checked).toBe(false);
    expect(intensityBox()).toBeUndefined();

    await clickThrough(toggle);
    expect(intensityBox()).toBeDefined();

    await clickThrough(pacerSwitch());
    expect(pacerSwitch()?.checked).toBe(false);
    expect(intensityBox()).toBeUndefined();
  });

  it('keeps a typed intensity for when the pacer is switched back on (#2338)', async () => {
    mounted = await mount(<GameView port={pedallingPort(testRoute())} now={() => nowMs} />);
    await settle();

    await clickThrough(pacerSwitch());
    await typeIntensity('1.8');
    expect(intensityBox()?.value).toBe('1.8');

    await clickThrough(pacerSwitch());
    expect(intensityBox()).toBeUndefined();
    await clickThrough(pacerSwitch());
    expect(intensityBox()?.value).toBe('1.8');
  });

  it('does not let a refused intensity in the hidden box block the ride (#2338)', async () => {
    mounted = await mount(<GameView port={pedallingPort(testRoute())} now={() => nowMs} />);
    await settle();

    await clickThrough(pacerSwitch());
    await typeIntensity('70');
    expect(rideButton()?.getAttribute('aria-disabled')).toBe('true');

    await clickThrough(pacerSwitch());
    expect(intensityBox()).toBeUndefined();
    expect(rideButton()?.getAttribute('aria-disabled')).toBeNull();
    expect(mounted.container.querySelector('.oyl-game__problem')).toBeNull();
  });

  it('refuses to start on an intensity the rule would reject, and says why', async () => {
    mounted = await mount(<GameView port={pedallingPort(testRoute())} now={() => nowMs} />);
    await settle();

    const box = queryAll<HTMLInputElement>(mounted.container, 'input[type="checkbox"]').find(
      (input) => (input.closest('label')?.textContent ?? '').includes('pacer'),
    );
    await clickThrough(box);
    await typeIntensity('70');

    const ride = queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    );
    // ⚠️ `aria-disabled` rather than the `disabled` attribute since #255, so
    // that a keyboard user still reaches the control and hears why — which
    // means the refusal is now a guard in the handler rather than something the
    // browser does. Clicking it is the half that matters: without the guard,
    // this change would trade an accessibility defect for a rider being paced
    // by a bot `botPacerPlan` rejected.
    expect(ride?.getAttribute('aria-disabled')).toBe('true');
    expect(ride?.disabled).toBe(false);
    expect(mounted.container.textContent ?? '').toContain('70');

    await clickThrough(ride);

    expect(mounted.container.querySelector('canvas')).toBeNull();
  });
});

describe('GameView — a picker with nothing in it', () => {
  /** The port a rider with no saved routes has. */
  const EMPTY: GamePort = {
    listRoutes: () => Promise.resolve([]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => NO_SENSORS,
  };

  it('says how a route gets here, and links to both ways', async () => {
    // #232's second criterion. The screen used to say only that there were
    // none, plus one of the two ways, with no link to either.
    mounted = await mount(<GameView port={EMPTY} renderer={() => Promise.resolve(NO_RENDERER)} />);
    await settle();

    const text = mounted.container.textContent ?? '';
    expect(text).toContain(NO_ROUTES_YET);

    const targets = queryAll<HTMLAnchorElement>(mounted.container, 'a').map(
      (anchor) => anchor.getAttribute('href') ?? '',
    );
    expect(targets).toContain('#/routes');
    expect(targets).toContain('#/routes/new');
  });

  it('names the mistake a rider looking for this screen has probably made', async () => {
    // The observation in #232: the rider went to Files, the import succeeded as
    // a ride, and the picker stayed empty with nothing anywhere saying why.
    mounted = await mount(<GameView port={EMPTY} renderer={() => Promise.resolve(NO_RENDERER)} />);
    await settle();

    const text = mounted.container.textContent ?? '';
    expect(text).toContain('Files screen');
    expect(text).toContain('will not appear here');
  });
});

/**
 * The world moves between simulation steps, rather than three times a second —
 * #323.
 *
 * ⚠️ **The assertion is DISTINCTNESS, because the defect is duplicate frames.**
 * The simulation ticks at 20 Hz and the loop renders at whatever the phone
 * gives it, so every test that asks "is the rider in the right place" passed
 * against a world that stood still for two frames out of three and then
 * jumped. Only "were these three consecutive frames different from each other"
 * fails against it.
 *
 * ⚠️ **And it is driven through the real component, the real simulation and
 * the real scene builder**, for the reason the header of this file gives about
 * #237: the pieces are all unit-tested and a hole between them is invisible to
 * every one of those tests. #323 needed three separate wirings to hold — the
 * simulation keeping its previous step, `sceneFrame` being handed the blended
 * distance rather than the state's own, and the corridor placing a marker
 * between its points instead of on the nearest one — and removing any one of
 * the three leaves the other two green. This is the test that fails for all
 * three.
 */
describe('GameView — the world moves rather than steps (#323)', () => {
  /**
   * Three frames at 8 ms, which is 24 ms and therefore inside one 50 ms step
   * for at least two of the three gaps.
   *
   * ⚠️ Deliberately far shorter than {@link FRAME_PERIOD_MS}, which exists to
   * step *over* the corridor's own resolution. This one has to land several
   * frames **inside** one simulation step, which is the whole question.
   */
  const INSIDE_ONE_STEP_MS = 8;

  /**
   * How many {@link FRAME_PERIOD_MS} frames get the rider moving — one fewer
   * than the ladder needs to step down.
   *
   * ⚠️ **It was sixty, and since #476 sixty is a different test.** A 250 ms
   * frame is a hot sample, and sixty of them walk the ladder to level 2, whose
   * 30 fps cap (24 before #482) does what it says: three frames 8 ms apart
   * draw ONE. That
   * is the cap working, not interpolation failing — so the warm-up stays on
   * the uncapped top rung, where every animation frame is drawn, which is the
   * rung whose frames land several to a simulation step.
   */
  const WARM_UP_FRAMES = SUSTAINED_SAMPLES - 1;

  /**
   * How far up the road a frame put something, in the corridor's own metres.
   *
   * ⚠️ **`z` alone, and NOT a key built from `x`, `y` and `z` — which is what
   * this was, and it made the bot's assertion pass over a defect.** The
   * fixture runs due north, so `z` is the along-the-road axis and `x` never
   * moves. `y` does: the corridor's heights are sampled at distances that
   * shift with the rider every frame, so piecewise-linear interpolation of a
   * hill gives a marker a slightly different height on every frame **whatever
   * distance it was placed at**. A three-distinct-keys assertion therefore
   * went green against a `GameView` handing `sceneFrame` the bot's *stepped*
   * odometer. Asserting that the marker advanced up the road cannot be
   * satisfied that way.
   */
  function alongTheRoad(frame: SceneFrame, kind: 'rider' | 'bot' | 'camera'): number {
    if (kind === 'camera') {
      return frame.camera.z;
    }
    const marker = frame.markers.find((each) => each.kind === kind);
    expect(marker).toBeDefined();
    return marker?.z ?? Number.NaN;
  }

  /** Assert three consecutive frames each moved something further up the road. */
  function movedEveryFrame(frames: readonly SceneFrame[], kind: 'rider' | 'bot' | 'camera'): void {
    const zs = frames.map((frame) => alongTheRoad(frame, kind));
    expect(zs[1] as number).toBeGreaterThan(zs[0] as number);
    expect(zs[2] as number).toBeGreaterThan(zs[1] as number);
  }

  it('hands the renderer a different rider and camera on every frame of a step', async () => {
    const frames = await startRiding({ pacer: false });
    // Seven seconds of riding, so the rider is moving at a real speed. @see WARM_UP_FRAMES
    await pump(WARM_UP_FRAMES);
    frames.length = 0;

    await pump(3, INSIDE_ONE_STEP_MS);

    expect(frames).toHaveLength(3);
    movedEveryFrame(frames, 'camera');
    movedEveryFrame(frames, 'rider');
  });

  it('moves the bot on every frame too, not only the rider', async () => {
    // #323's first criterion names all three — the rider, the bot and the
    // camera — and the bot is the one a rider watching a pacer would see step,
    // because it is the only thing on the road that is not directly under the
    // camera.
    const frames = await startRiding({ pacer: true, intensity: '2.5' });
    await pump(WARM_UP_FRAMES);
    frames.length = 0;

    await pump(3, INSIDE_ONE_STEP_MS);

    expect(frames).toHaveLength(3);
    expect(frames.every((frame) => frame.markers.some((each) => each.kind === 'bot'))).toBe(true);
    movedEveryFrame(frames, 'bot');
  });

  it('draws no further than the newest step even when the loop is starved', async () => {
    // The backgrounded phone, through the component: one frame covering five
    // minutes. `MAXIMUM_STEPS_PER_ADVANCE` throws most of it away, and the
    // blend must not spend the discarded wall clock projecting the rider up a
    // road nothing integrated.
    const frames = await startRiding({ pacer: false });
    await pump(20);
    const before = frames[frames.length - 1] as SceneFrame;
    frames.length = 0;

    await pump(1, 300_000);
    const after = frames[0] as SceneFrame;

    // It moved — the bound still integrates ten seconds of road…
    expect(alongTheRoad(after, 'rider')).toBeGreaterThan(alongTheRoad(before, 'rider'));
    // …and it is still on the corridor this frame built, which is the whole of
    // "does not extrapolate a rider through scenery": every marker is placed
    // between two of these points or clamped to one of them.
    const zs = after.corridor.centre.map((point) => point.z);
    const rider = after.markers.find((each) => each.kind === 'rider');
    expect(rider?.z).toBeGreaterThanOrEqual(Math.min(...zs));
    expect(rider?.z).toBeLessThanOrEqual(Math.max(...zs));
  });
});

/** A renderer nothing reaches: this screen never leaves the picker. */
const NO_RENDERER: GameRenderer = {
  // #475: never asked — no ride in this file chose the realistic world.
  loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
  create: () => {
    throw new Error('the empty picker must not build a renderer');
  },
};

/**
 * The rider's own mass reaches the physics (#325).
 *
 * ⚠️ **The wiring, not the maths.** `rider.test.ts` proves that two masses
 * produce two speeds through `GameSimulation` directly. That test passes
 * whether or not anything hands this component a mass — which is precisely the
 * shape #237 and #278 are about, and it is why this one is here: it drives the
 * real component, from the prop, through a real ride, and reads what the
 * renderer was handed.
 *
 * Deleting `riderMass={…}` from the simulation's `conditions` turns this red and
 * leaves the rest of this file green.
 */
async function rideAtMass(
  riderMass: Kilograms | undefined,
  kitColour?: KitColour,
): Promise<SceneFrame[]> {
  // ⚠️ Both runs start from the same clock and an empty frame queue. `nowMs`
  // and `pending` are module state reset per *test*, and this helper is called
  // twice inside one — without this the second ride starts wherever the first
  // left off and the two differ for a reason that has nothing to do with mass.
  pending = [];
  nowMs = 1_000_000;
  const frames: SceneFrame[] = [];
  mounted = await mount(
    <GameView
      port={pedallingPort(testRoute())}
      renderer={() => Promise.resolve(capturingRenderer(frames))}
      now={() => nowMs}
      {...(riderMass === undefined ? {} : { riderMass })}
      {...(kitColour === undefined ? {} : { kitColour })}
    />,
  );
  await settle();
  const ride = queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
    (button.textContent ?? '').startsWith('Ride '),
  );
  await clickThrough(ride);
  await pump(2, 1000 / 30);
  await settle();
  await pump(40);
  mounted.unmount();
  mounted = undefined;
  return frames;
}

describe('the ride is at the athlete’s own weight (#325)', () => {
  /**
   * How far up the road the last frame drew the rider.
   *
   * The **marker**, which is what a rider on a phone actually sees, rather than
   * an internal number: `z` is measured from `corridorOrigin(profile)`, which is
   * a function of the route alone, so two runs over the same route are
   * comparable.
   */
  function finishedAt(frames: readonly SceneFrame[]): number {
    // A fixture guard as well as a read: an empty frame list would make every
    // comparison below pass over nothing.
    expect(frames.length).toBeGreaterThan(10);
    const last = frames[frames.length - 1] as SceneFrame;
    const rider = last.markers.find((each) => each.kind === 'rider');
    expect(rider).toBeDefined();
    return rider?.z ?? Number.NaN;
  }

  it('covers different ground for a light rider than for a heavy one', async () => {
    // ⚠️ The same route, the same power, the same clock and the same number of
    // frames. The only difference is the prop, so a component that ignored it
    // — which is what this component did before #325 — makes these identical.
    const light = await rideAtMass(kilograms(55));
    const heavy = await rideAtMass(kilograms(105));

    expect(light.length).toBe(heavy.length);
    expect(finishedAt(light)).not.toBe(finishedAt(heavy));
  });

  it('rides a rider who has never entered one at the documented default', async () => {
    // Not "at some number": at the *same* number as a rider whose row says 71.
    // A component that fell back to its own literal would pass an assertion
    // that only checked the ride happened.
    const assumed = await rideAtMass(undefined);
    const stated = await rideAtMass(kilograms(DEFAULT_RIDER_MASS_KILOGRAMS));

    expect(finishedAt(assumed)).toBe(finishedAt(stated));
  });
});

/**
 * The rider's kit colour reaches the renderer (#623) — the wiring, driven from
 * the prop through a real ride, read off what the view was handed. Deleting
 * `view.setRiderKit(…)` from `GameView.tsx` turns both red.
 */
describe('the ride is in the athlete’s own kit colour (#623)', () => {
  it('dresses the view in the chosen colour before it draws the first frame', async () => {
    const frames = await rideAtMass(undefined, 'magenta');

    expect(frames.length).toBeGreaterThan(10);
    expect(kitsHanded.length).toBeGreaterThan(0);
    expect(kitsHanded.every((handed) => handed.chosen === 'magenta')).toBe(true);
    expect(kitsHanded[0]?.framesBefore).toBe(0);
  });

  it('hands a rider who never chose nothing at all, which the renderer draws as the house kit', async () => {
    // `undefined`, not a default the component invented: `bicycle.ts`
    // §`riderKitFor` is the one place it becomes the house kit.
    await rideAtMass(undefined);

    expect(kitsHanded.length).toBeGreaterThan(0);
    expect(kitsHanded.every((handed) => handed.chosen === undefined)).toBe(true);
  });
});

/**
 * The ride's season reaches the renderer — #1622. Read through what the
 * renderer double was HANDED, which is the path `three-renderer.ts`
 * §`ThreeGameView.setSeason` keeps and #1623 to #1627 draw from.
 */
describe('the ride’s season is the rider’s day at ride start (#1622)', () => {
  it('holds Halloween for a ride started on 1 Nov after the clock crosses into 2 Nov', async () => {
    let day: CalendarDay = { year: 2026, month: 11, day: 1 };
    let reads = 0;
    const today = (): CalendarDay => {
      reads += 1;
      return day;
    };
    await startRiding({ pacer: false, today });
    await pump(10);
    expect(seasonsHanded.map((season) => season.holiday)).toEqual(['halloween']);

    // Local midnight passes mid-ride.
    day = { year: 2026, month: 11, day: 2 };
    await pump(40);

    expect(reads).toBe(1);
    expect(seasonsHanded).toHaveLength(1);
    expect(seasonsHanded[0]?.holiday).toBe('halloween');
  });

  it('reads the day again for the NEXT ride, and only then', async () => {
    let day: CalendarDay = { year: 2026, month: 11, day: 1 };
    await startRiding({ pacer: false, today: () => day });
    await pump(5);
    await endTheRide();
    day = { year: 2026, month: 12, day: 1 };
    await clickThrough(rideButton());
    await pump(2, 1000 / 30);
    await settle();
    await pump(5);

    expect(seasonsHanded.map((season) => season.holiday)).toEqual(['halloween', 'winter-lights']);
  });

  it('never takes the day from a ghost: a 31 Oct attempt ridden on 15 Jul is no holiday', async () => {
    // A recorded attempt that carries the day it was ridden, as a stored
    // activity does. Nothing in the ride may read it.
    const recordedOnHalloween = {
      ...FAST_GHOST,
      startedAt: '2026-10-31T09:00:00Z',
      start: new Date('2026-10-31T09:00:00Z'),
    } as GhostTrack;
    const asked: unknown[][] = [];
    const today = (...args: unknown[]): CalendarDay => {
      asked.push(args);
      return { year: 2026, month: 7, day: 15 };
    };
    const frames = await startRiding({
      pacer: false,
      ghost: true,
      track: recordedOnHalloween,
      today,
    });
    await pump(10);

    // The ghost IS on the road, so the test is not vacuous…
    expect(frames.at(-1)?.markers.some((marker) => marker.kind === 'ghost')).toBe(true);
    // …and the day came from `today`, asked with nothing.
    expect(asked).toEqual([[]]);
    expect(seasonsHanded).toHaveLength(1);
    expect(seasonsHanded[0]?.holiday).toBeUndefined();
    // Mid-July on a northern route: summer, not the ghost's autumn.
    expect(seasonsHanded[0]?.nature).toEqual({ autumn: 0, winter: 0 });
  });
});

/**
 * #245's wiring, driven the way a rider on a hot phone would produce it.
 *
 * ⚠️ **Both halves or neither.** `quality.test.ts` proves the ladder carries a
 * scenery budget and `three-renderer.test.ts` proves a belt spends one, and
 * #278's gate is explicit that a correct, unit-tested, typechecked unit wired
 * to nothing passes both — `advanceBot` had a test proven to fail without it
 * and no caller at all. So this drives real frames through the real
 * `nextQuality` until the rung moves, and then asks what the renderer was
 * handed.
 *
 * The frames are long on purpose: {@link FRAME_PERIOD_MS} is already well past
 * `FRAME_MS_REDUCE_ABOVE`, so a phone this slow is a sustained hot measurement
 * — and since #2289 frame time is the ladder's only input.
 */
describe('GameView — a hot phone sheds scenery before frame rate (#245)', () => {
  it('tells the renderer a leaner rung, and stops placing what it stops drawing', async () => {
    const frames = await startRiding({ pacer: false });
    const atTheTop = frames[frames.length - 1] as SceneFrame;
    // ⚠️ **Two sustained windows, not one, and #348 is why** — a reviewer who
    // remembers a single `pump` here is reading the old file. The scenery is
    // clustered now, so a 460 m view of this fixture carries about 140 items
    // rather than the three hundred it carried before: rung 1's budget of 160
    // does not bind on it at all, and a test that stopped there would watch the
    // view hand the renderer a smaller number and shed nothing. Two windows
    // reach a rung that does bind, which is what makes the equality below an
    // assertion rather than a coincidence. ⚠️ **Three since #482**: level 2 is
    // level 1 capped at 30 and carries the same 160, so the first rung whose
    // budget binds here is level 3. The frames are shorter than
    // FRAME_PERIOD_MS but still hot, so the rider is no further up the road
    // than two windows used to leave them — further, and this fixture's view
    // holds fewer structures than level 3's budget and the equality below
    // stops binding.
    await pump(3 * (SUSTAINED_SAMPLES + 5), FRAME_MS_REDUCE_ABOVE + 5);
    const told = rungs[rungs.length - 1];
    const drawn = frames[frames.length - 1] as SceneFrame;

    expect(told).toBeDefined();
    expect(told?.scatterItems).toBeLessThan(qualitySettings(0).scatterItems);
    // Non-vacuity, and the one thing about this fixture that could quietly make
    // the whole test meaningless: a route too sparse to exceed the rung it
    // settles on would satisfy every assertion below with no reduction at all.
    // ⚠️ Measured against the rung it *reached* rather than against a rung
    // index written down here, so a ladder that grows a rung cannot leave this
    // guard comparing against the wrong one.
    //
    // ⚠️ **Counted over the NATURAL scenery since #460**, which puts buildings
    // and field boundaries in front of it on a budget of their own — asserted
    // separately below.
    const natural = (frame: SceneFrame) =>
      frame.scatter.filter((item) => (SCATTER_KINDS as readonly string[]).includes(item.kind));
    const built = (frame: SceneFrame) =>
      frame.scatter.filter((item) => (STRUCTURE_KINDS as readonly string[]).includes(item.kind));
    expect(natural(atTheTop).length).toBeGreaterThan(told?.scatterItems ?? 0);
    // **The budget bound.** `toBeLessThanOrEqual` alone is satisfied by a world
    // with nothing in it, which is exactly the shape the clustering can now
    // produce on a stretch of open road. ⚠️ Within a fifth of it rather than
    // exactly it since #460: scenery that would stand in a village's gardens
    // is taken out after the budget is spent (`settlements.ts`
    // §`clearOfBuildings`).
    expect(natural(drawn).length).toBeLessThanOrEqual(told?.scatterItems ?? 0);
    expect(natural(drawn).length).toBeGreaterThan((told?.scatterItems ?? 0) * 0.8);
    expect(natural(drawn).length).toBeLessThan(natural(atTheTop).length);
    // #460. The structures' own rung reaches the frame too — and binds on this
    // fixture, which is what makes it evidence that `GameView` passes it.
    expect(built(atTheTop).length).toBeGreaterThan(told?.structureItems ?? 0);
    expect(built(drawn).length).toBe(told?.structureItems ?? 0);
    // The rung it settled on is one of the ladder's, not a number this view
    // invented — `quality.ts` is where a scenery decision is taken.
    expect(QUALITY_LADDER).toContainEqual(told);
  });

  it('measures the frame it just drew, not the frame it is about to draw', async () => {
    // ⚠️ **The defect this pull request found, and it is older than #245.**
    // `setQuality`'s updater closed over `lastFrameAt` — a `let` in the loop's
    // own scope — and React invokes an updater during the *next* render, by
    // which time the loop had already moved it to `at`. So the ladder was fed
    // `frameMs: 0` on every frame of every ride: permanently "cool", never
    // once hot. Frame time was the only live input to the policy then (the
    // thermal forecast was `undefined` in the shipped app, and since #2289 it
    // is not read at all), so #91's whole reduction path was unreachable — and every test of it passed,
    // because `quality.ts` is pure and was being asked the right question by
    // nobody.
    //
    // Asserted at the threshold rather than with "slow" and "fast", because a
    // measurement that is merely *non-zero* would also satisfy the pair of
    // tests either side of this one.
    const frames = await startRiding({ pacer: false });
    frames.length = 0;

    await pump(SUSTAINED_SAMPLES + 5, FRAME_MS_REDUCE_ABOVE - 1);
    expect(rungs).toEqual([]);

    await pump(SUSTAINED_SAMPLES + 5, FRAME_MS_REDUCE_ABOVE + 1);
    expect(rungs.length).toBeGreaterThan(0);
  });

  it('keeps the scenery at the target rung while the frames are fine', async () => {
    // The control. A view that simply handed `sceneFrame` an ever-smaller
    // budget, or that thinned on every frame, would pass the test above.
    const frames = await startRiding({ pacer: false });

    await pump(SUSTAINED_SAMPLES + 5, 1000 / 60);
    const drawn = frames[frames.length - 1] as SceneFrame;

    expect(rungs.every((rung) => rung.scatterItems === qualitySettings(0).scatterItems)).toBe(true);
    // ⚠️ Against rung **3** — rung 2 since #348, for the reason the test
    // above gives: this fixture's view no longer clears rung 1's budget of 160,
    // so a comparison against that one would be red on a view that is behaving
    // perfectly, and since #482 rung 2 is rung 1 capped at 30 with the same
    // 160. What it still catches is the failure it was written for — a view
    // that thinned on every frame would fall under this.
    expect(drawn.scatter.length).toBeGreaterThan(
      QUALITY_LADDER[3]?.scatterItems ?? Number.POSITIVE_INFINITY,
    );
  });
});

/**
 * The frame cap, through the real loop — #476.
 *
 * `QualitySettings.frameCap` was declared on every rung and read by nothing,
 * so every rung drew at the display's rate. These count what the renderer is
 * actually handed, on a 60 Hz display, at each rung the ladder walks to.
 */
describe('GameView — each rung draws at its own frame cap (#476)', () => {
  const VSYNC_MS = 1000 / 60;
  /**
   * Nine-twentieths of a second of a 60 Hz display: short of the 30 cool
   * samples a climb needs, ON EVERY RUNG. ⚠️ It was 40 until #482, which was
   * short of 30 only on the capped rungs; level 1 now draws every frame, so
   * 40 cool samples there climbed it straight back to level 0 mid-measure.
   */
  const MEASURED_VSYNCS = 27;

  // ⚠️ **8 s, a ceiling rather than a budget — #682.** Vitest's default 5 s was nobody's choice for
  // this case: under coverage on CI it took 1.3 s to 2.4 s over thirteen green `main` runs on
  // 2026-09-28 (36370135206 to 36405580515), the slowest on 36371441351 (the slower of the two
  // runners, a job over 1 000 s) — 49 % of that default. 8 s is about three times the slowest, so a
  // slow-down is red, and so is a case left waiting on something that never settles. A loop that
  // never yields is caught only by the job’s own stop (docs/agents/ci.md §4c).
  it('draws every animation frame at the top two rungs, then 30, 24 and 20 a second — #482', async () => {
    const frames = await startRiding({ pacer: false });
    const drawnPerMeasure = async (): Promise<number> => {
      frames.length = 0;
      await pump(MEASURED_VSYNCS, VSYNC_MS);
      return frames.length;
    };
    const counts = [await drawnPerMeasure()];
    for (let level = 1; level < QUALITY_LADDER.length; level += 1) {
      // Hot frames walk the ladder one rung down…
      await pump(SUSTAINED_SAMPLES + 2);
      expect(rungs[rungs.length - 1]).toEqual(QUALITY_LADDER[level]);
      // …and the rung it reached decides how many of the next frames are drawn.
      counts.push(await drawnPerMeasure());
    }
    // The owner's ruling (#482): the first step down keeps every frame.
    expect(counts[0]).toBe(MEASURED_VSYNCS);
    expect(counts[1]).toBe(MEASURED_VSYNCS);
    // 30, 24 and 20 a second over 27 vsyncs: 13 or 14, 10 or 11, and 9.
    expect(counts[2]).toBeGreaterThanOrEqual(13);
    expect(counts[2]).toBeLessThanOrEqual(14);
    expect(counts[3]).toBeGreaterThanOrEqual(10);
    expect(counts[3]).toBeLessThanOrEqual(11);
    expect(counts[4]).toBe(9);
    // Each capped rung draws fewer than the one above it.
    expect(counts[4] ?? 0).toBeLessThan(counts[3] ?? 0);
    expect(counts[3] ?? 0).toBeLessThan(counts[2] ?? 0);
    expect(counts[2] ?? 0).toBeLessThan(counts[1] ?? 0);
  }, 8_000);

  it('re-renders the HUD only on the frames it draws, at every capped rung — #482', async () => {
    // ⚠️ #481's review: `if (paced.draw)` → `if (true)` left every test here
    // green, because only the world's draw was counted. The HUD is the other
    // half of what a cap skips, and a HUD reconciling at 60 Hz on a 20 fps
    // rung is heat the cap exists to save. `sensorReads` counts one read per
    // animation frame (the loop) plus one per render (the HUD).
    const frames = await startRiding({ pacer: false });
    const measured: { label: string; drawn: number; renders: number }[] = [];
    for (let level = 1; level < QUALITY_LADDER.length; level += 1) {
      await pump(SUSTAINED_SAMPLES + 2);
      expect(rungs[rungs.length - 1]).toEqual(QUALITY_LADDER[level]);
      frames.length = 0;
      sensorReads = 0;
      await pump(MEASURED_VSYNCS, VSYNC_MS);
      measured.push({
        label: QUALITY_LADDER[level]?.label ?? '',
        drawn: frames.length,
        renders: sensorReads - MEASURED_VSYNCS,
      });
    }
    const capped = measured.filter((each) => each.drawn < MEASURED_VSYNCS);
    expect(capped.map((each) => each.label)).toEqual(QUALITY_LADDER.slice(2).map((r) => r.label));
    for (const each of measured) expect(each.renders, each.label).toBe(each.drawn);
  });

  it('still moves the rider on every frame it draws at the floor rung — #323 under a cap', async () => {
    const frames = await startRiding({ pacer: false });
    for (let level = 1; level < QUALITY_LADDER.length; level += 1) {
      await pump(SUSTAINED_SAMPLES + 2);
    }
    frames.length = 0;
    await pump(MEASURED_VSYNCS, VSYNC_MS);
    const along = frames.map((frame) => frame.markers.find((each) => each.kind === 'rider')?.z);
    expect(along.length).toBeGreaterThanOrEqual(8);
    for (let index = 1; index < along.length; index += 1) {
      expect(along[index] as number).toBeGreaterThan(along[index - 1] as number);
    }
  });

  it('does not read a skipped animation frame as a fast frame', async () => {
    // Level 2 caps at 30 (level 1 since #482 draws at the display's rate), so
    // on a 60 Hz display every other animation frame is skipped. The ladder
    // climbs back after SUSTAINED_SAMPLES cool samples; a loop that fed it
    // every animation frame's gap would climb after 30 animation frames, when
    // only 15 frames have been drawn.
    await startRiding({ pacer: false });
    await pump(2 * (SUSTAINED_SAMPLES + 2));
    expect(rungs[rungs.length - 1]).toEqual(QUALITY_LADDER[2]);
    await pump(SUSTAINED_SAMPLES + 2, VSYNC_MS);
    expect(rungs[rungs.length - 1]).toEqual(QUALITY_LADDER[2]);
    // Twice as many animation frames is as many drawn frames: now it climbs.
    await pump(SUSTAINED_SAMPLES + 2, VSYNC_MS);
    expect(rungs[rungs.length - 1]).toEqual(QUALITY_LADDER[1]);
  });
});

/**
 * The cadence reaches the cranks — #349.
 *
 * ⚠️ **This is the half no other file can see, and the reason it exists is
 * `SceneInput.botDistance`.** That field was declared, optional, unit-tested
 * and supplied by nobody, so a built and green bot pacer drew nothing on a real
 * route (#237). `RiderMarker.crankAngle` is the same shape, so what is asserted
 * here is what the renderer was actually **handed**, frame after frame, rather
 * than what `bicycle.ts` would do with a number if somebody passed it one.
 */
/**
 * The board before a line reads in the rider's own units — #679. The frame is
 * where they arrive, so what is asserted is what the renderer was HANDED, for
 * `SceneInput.botDistance`'s reason below.
 */
describe('GameView — the lines read in the rider’s own units (#679)', () => {
  it('hands the renderer the start gantry, and a board in miles to a rider in miles', async () => {
    const frames: SceneFrame[] = [];
    mounted = await mount(
      <UnitsProvider units="imperial">
        <GameView
          port={pedallingPort(testRoute(195), undefined, () => LIVE_CADENCE)}
          renderer={() => Promise.resolve(capturingRenderer(frames))}
          now={() => nowMs}
        />
      </UnitsProvider>,
    );
    await settle();
    await clickThrough(rideButton());
    await pump(4, CRANK_FRAME_MS);
    const texts = new Set(frames.flatMap((frame) => frame.lines.map((line) => line.stand.text)));
    expect(texts.has(START_WORD)).toBe(true);
    // A 1.95 km route: a mile before its end, 341 m on, is within
    // `LINE_DRAW_AHEAD_METRES` (375) of its start.
    expect(texts.has(toGoText('imperial'))).toBe(true);
    expect(texts.has(toGoText('metric'))).toBe(false);
  });

  it('and no board in miles to a rider in kilometres', async () => {
    const frames = await startRiding({ pacer: false });
    await pump(4, CRANK_FRAME_MS);
    const texts = new Set(frames.flatMap((frame) => frame.lines.map((line) => line.stand.text)));
    expect(texts.has(START_WORD)).toBe(true);
    expect(texts.has(toGoText('imperial'))).toBe(false);
  });
});

describe('GameView — the cranks turn at the rider’s own cadence (#349)', () => {
  /** How far the cranks had turned on each frame the renderer was given. */
  function crankAngles(frames: readonly SceneFrame[]): readonly number[] {
    expect(frames.length).toBeGreaterThan(4);
    return frames.map((frame) => {
      const rider = frame.markers.find((each) => each.kind === 'rider');
      expect(rider).toBeDefined();
      return rider?.crankAngle ?? Number.NaN;
    });
  }

  /** One frame's worth of turn, unwrapped across the revolution boundary. */
  function turnBetween(before: number, after: number): number {
    return (((after - before) % TAU) + TAU) % TAU;
  }

  it('turns them, frame after frame, while a sensor is reporting', async () => {
    const frames = await startRiding({ pacer: false });
    await pump(8, CRANK_FRAME_MS);
    const angles = crankAngles(frames).slice(-6);

    for (const [index, angle] of angles.entries()) {
      expect(Number.isFinite(angle)).toBe(true);
      if (index > 0) {
        expect(angle).not.toBe(angles[index - 1]);
      }
    }
  });

  it('turns them at the rate the sensor reports, not at one of its own', async () => {
    // ⚠️ **88 rpm is the number the HUD is showing on the same frame**, so this
    // is the whole of #349's second criterion: the angle *is* the integral of
    // the cadence. A renderer given a rate of its own — a constant, or one
    // derived from speed — passes every other assertion in this file.
    const frames = await startRiding({ pacer: false });
    await pump(8, CRANK_FRAME_MS);
    expect(hudField('Cadence')).toBe('88 rpm');
    const angles = crankAngles(frames).slice(-6);
    const expected = ((88 * TAU) / 60) * (CRANK_FRAME_MS / 1000);

    for (let index = 1; index < angles.length; index += 1) {
      expect(turnBetween(angles[index - 1] as number, angles[index] as number)).toBeCloseTo(
        expected,
        6,
      );
    }
  });

  it('leaves them exactly where they were when nothing reports a cadence', async () => {
    // A rider with a power meter and no cadence sensor: the HUD shows a dash,
    // and the cranks say the same thing by not moving. `bicycle.ts`
    // §`advanceCrank` states the trade this makes and why it is the right one.
    const frames = await startRiding({
      pacer: false,
      cadence: () => ({ value: undefined, live: false, paired: false }),
    });
    await pump(8, CRANK_FRAME_MS);
    expect(hudField('Cadence')).toBe(`${NO_READING} rpm`);
    expect(new Set(crankAngles(frames))).toEqual(new Set([0]));
  });

  it('stops them when a sensor that was reporting goes quiet', async () => {
    let reported: SensorReading = LIVE_CADENCE;
    const frames = await startRiding({ pacer: false, cadence: () => reported });
    await pump(8, CRANK_FRAME_MS);
    const whilePedalling = crankAngles(frames);
    const stoppedAt = whilePedalling[whilePedalling.length - 1] as number;
    expect(stoppedAt).not.toBe(0);

    // ⚠️ Paired and not live, which is `game/sensors.ts`'s **stale** — the case
    // that tells a dropped sensor from one nobody owns, and the one where the
    // cranks must stop rather than carry on at the last rate reported.
    reported = { value: undefined, live: false, paired: true };
    await pump(8, CRANK_FRAME_MS);
    const afterwards = crankAngles(frames).slice(whilePedalling.length);
    expect(afterwards.length).toBeGreaterThan(4);
    expect(new Set(afterwards)).toEqual(new Set([stoppedAt]));
  });

  /** Whether the rider was drawn pedalling on each frame — #625. */
  function pedalling(frames: readonly SceneFrame[]): readonly number[] {
    return frames.map(
      (frame) => frame.markers.find((each) => each.kind === 'rider')?.pedalling ?? Number.NaN,
    );
  }

  it('hands the renderer a pedalling rider exactly while a cadence reports, and a still one when it goes — #625', async () => {
    // ⚠️ `SceneInput.pedalling` is optional the safe way round, so a GameView
    // that stopped supplying it would draw every realistic rider still and
    // pass every other test. This reads what the renderer was handed.
    let reported: SensorReading = LIVE_CADENCE;
    const frames = await startRiding({ pacer: false, cadence: () => reported });
    await pump(8, CRANK_FRAME_MS);
    const whilePedalling = pedalling(frames).slice(-4);
    expect(new Set(whilePedalling)).toEqual(new Set([1]));
    const seen = frames.length;
    reported = { value: undefined, live: false, paired: true };
    await pump(8, CRANK_FRAME_MS);
    const afterwards = pedalling(frames.slice(seen)).slice(-4);
    expect(afterwards).toHaveLength(4);
    expect(new Set(afterwards)).toEqual(new Set([0]));
  });

  it('hands the renderer the cadence the rider’s position is chosen from, and none when it goes — #1999', async () => {
    // ⚠️ `RiderMarker.riding` is optional the UNSAFE way round: a GameView
    // that stopped supplying the cadence would never stand a rider for one.
    // This reads what the renderer was handed.
    let reported: SensorReading = LIVE_CADENCE;
    const frames = await startRiding({ pacer: false, cadence: () => reported });
    await pump(8, CRANK_FRAME_MS);
    const cadence = (frame: SceneFrame): number | undefined =>
      frame.markers.find((each) => each.kind === 'rider')?.riding?.cadence;
    expect(new Set(frames.slice(-4).map(cadence))).toEqual(new Set([88]));
    const seen = frames.length;
    reported = { value: undefined, live: false, paired: true };
    await pump(8, CRANK_FRAME_MS);
    const afterwards = frames.slice(seen).slice(-4);
    expect(afterwards).toHaveLength(4);
    expect(new Set(afterwards.map(cadence))).toEqual(new Set([undefined]));
  });
});

/**
 * A camera that remembers what the ladder last allowed it — #514.
 *
 * Only the latest answer to each question is kept, because that is the state a
 * `CameraController` is left in: `throttle` and `throttlePresence` each set one
 * flag, and the next screen inherits whatever the last call said.
 */
function recordingCamera(): CameraThrottle & {
  readonly captureAllowed: () => boolean | undefined;
  readonly presenceAllowed: () => boolean | undefined;
} {
  let capture: boolean | undefined;
  let presence: boolean | undefined;
  return {
    throttle: (allowed) => {
      capture = allowed;
    },
    throttlePresence: (allowed) => {
      presence = allowed;
    },
    captureAllowed: () => capture,
    presenceAllowed: () => presence,
  };
}

/**
 * What a game ride's throttle leaves behind — #514 part 3.
 *
 * The ladder withdraws capture and presence when the phone steps down. Until
 * #514 nothing handed them back when the game unmounted, so a rider whose
 * phone warmed up during a game ride and who then rode an ERG workout on the
 * Ride screen had presence read `unknown` for that workout, with nothing on
 * screen to say so. Leaving the game now returns both to `true`: the ladder is
 * the game's, and no other screen runs one.
 */
describe('GameView — leaving the game hands the camera back (#514)', () => {
  it('withdraws capture and presence when a hot phone steps down during the ride', async () => {
    // The control. Without it, the test below would pass against a view that
    // never throttled anything, because a camera nobody touched is also "true".
    const camera = recordingCamera();
    await startRiding({ pacer: false, camera });
    expect(camera.captureAllowed()).toBe(true);
    expect(camera.presenceAllowed()).toBe(true);

    await pump(SUSTAINED_SAMPLES + 2, FRAME_MS_REDUCE_ABOVE + 5);

    expect(rungs[rungs.length - 1]).toEqual(QUALITY_LADDER[1]);
    expect(QUALITY_LADDER[1]?.capture).toBe(false);
    expect(QUALITY_LADDER[1]?.presence).toBe(false);
    expect(camera.captureAllowed()).toBe(false);
    expect(camera.presenceAllowed()).toBe(false);
  });

  it('returns both to true when the game unmounts after a step down', async () => {
    const camera = recordingCamera();
    await startRiding({ pacer: false, camera });
    await pump(SUSTAINED_SAMPLES + 2, FRAME_MS_REDUCE_ABOVE + 5);
    expect(camera.presenceAllowed()).toBe(false);

    mounted?.unmount();
    mounted = undefined;

    expect(camera.captureAllowed()).toBe(true);
    expect(camera.presenceAllowed()).toBe(true);
  });

  it('hands a replaced camera back, and throttles the new one from the current rung', async () => {
    // The other way the effect's cleanup runs: the camera prop changes under a
    // live view. The old camera must not be left withdrawn, and the new one
    // must be told the rung the ride is actually on rather than the top one.
    const first = recordingCamera();
    const frames: SceneFrame[] = [];
    const view = (camera: CameraThrottle) => (
      <GameView
        port={pedallingPort(testRoute())}
        renderer={() => Promise.resolve(capturingRenderer(frames))}
        now={() => nowMs}
        camera={camera}
      />
    );
    mounted = await mount(view(first));
    await settle();
    await clickThrough(rideButton());
    await pump(2, 1000 / 30);
    await settle();
    await pump(SUSTAINED_SAMPLES + 2, FRAME_MS_REDUCE_ABOVE + 5);
    expect(first.presenceAllowed()).toBe(false);

    const second = recordingCamera();
    await mounted.rerender(view(second));

    expect(first.captureAllowed()).toBe(true);
    expect(first.presenceAllowed()).toBe(true);
    expect(second.captureAllowed()).toBe(false);
    expect(second.presenceAllowed()).toBe(false);
  });
});

/**
 * #1482 — the HUD's touch lock, through the real game: what a tap on the
 * HUD's *Pause* or *End ride* does to the ride while it is on, read off the
 * HUD and the trainer port as a rider and the Ride screen would see them.
 * `hud/HudPanel.touch-lock.test.tsx` holds the rest of the HUD's controls and
 * the held release.
 */
describe('the touch lock on the HUD — #1482', () => {
  function hudButton(name: string): HTMLButtonElement | undefined {
    return queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find(
      (button) => button.textContent === name,
    );
  }

  async function tapThrough(element: HTMLElement | undefined): Promise<void> {
    if (element === undefined) {
      throw new Error('no such control on the HUD');
    }
    tap(element);
    await settle();
  }

  function countingTrainer(ended: { count: number }): GameTrainerPort {
    return {
      readTrainer: () => NO_GAME_TRAINER,
      askForControlOnRide: () => Promise.resolve(),
      workoutRescue: () => undefined,
      recordingMayStop: () => false,
      gameRideEnded: () => {
        ended.count += 1;
      },
      rideMovingSeconds: () => undefined,
      watchRide: () => () => undefined,
    };
  }

  it('ignores a tap on Pause while it is on, and a key still pauses', async () => {
    mounted = await mount(<GameView port={pedallingPort(testRoute())} now={() => nowMs} />);
    await settle();
    await clickThrough(rideButton());
    await pump(4);

    await tapThrough(hudButton(TOUCH_LOCK_NAME));
    expect(hudButton(TOUCH_LOCK_NAME)?.getAttribute('aria-pressed')).toBe('true');
    await tapThrough(hudButton('Pause'));
    expect(hudButton('Resume')).toBeUndefined();

    const pause = hudButton('Pause');
    if (pause === undefined) throw new Error('no Pause on the HUD');
    await activateWithKeyboard(pause);
    await settle();
    expect(hudButton('Resume')).toBeDefined();
  });

  it('lets a tap on End ride end the game ride while it is on, and the next ride starts unlocked', async () => {
    const ended = { count: 0 };
    mounted = await mount(
      <GameView
        port={pedallingPort(testRoute())}
        trainer={countingTrainer(ended)}
        now={() => nowMs}
      />,
    );
    await settle();
    await clickThrough(rideButton());
    await pump(4);
    await tapThrough(hudButton(TOUCH_LOCK_NAME));

    await endTheRide(tapThrough);
    pending = [];

    expect(ended.count).toBe(1);
    expect(endRideButton()).toBeUndefined();
    expect(rideButton()).toBeDefined();

    await clickThrough(rideButton());
    expect(hudButton(TOUCH_LOCK_NAME)?.getAttribute('aria-pressed')).toBe('false');
  });
});

/**
 * #2349 — *End ride* asks first: *Keep riding*, *Save ride* or *Discard ride*,
 * and a discard is asked once more. Read off the HUD and the trainer port, as
 * the rider and the ride controller see them.
 */
describe('ending a game ride asks first — #2349', () => {
  interface Seen {
    ended: number;
    saved: number;
    discarded: number;
    /** What happened, in order: `ended` is `gameRideEnded`, then the recording's. */
    readonly order: string[];
  }

  function recordingTrainer(
    seen: Seen,
    recording: { readonly savable: boolean } | undefined,
    gone = true,
  ): GameTrainerPort {
    return {
      readTrainer: () => NO_GAME_TRAINER,
      askForControlOnRide: () => Promise.resolve(),
      workoutRescue: () => undefined,
      recordingMayStop: () => false,
      gameRideEnded: () => {
        seen.ended += 1;
        seen.order.push('ended');
      },
      rideMovingSeconds: () => undefined,
      watchRide: () => () => undefined,
      rideRecording: () => recording,
      saveRideRecording: () => {
        seen.saved += 1;
        seen.order.push('saved');
        return Promise.resolve();
      },
      discardRideRecording: () => {
        seen.discarded += 1;
        seen.order.push('discarded');
        return Promise.resolve(gone);
      },
    };
  }

  const fresh = (): Seen => ({ ended: 0, saved: 0, discarded: 0, order: [] });
  const answers = (): string[] =>
    queryAll<HTMLButtonElement>(document, '[data-oyl-end-ride] button').map((button) =>
      (button.textContent ?? '').trim(),
    );
  const hudRegion = (): string =>
    document.querySelector('[data-oyl-announcer="hud"]')?.textContent ?? '';
  const picker = (): string => mounted?.container.textContent ?? '';

  async function onTheStage(trainer: GameTrainerPort, back?: RideBack): Promise<void> {
    const view = <GameView port={pedallingPort(testRoute())} trainer={trainer} now={() => nowMs} />;
    mounted = await mount(
      back === undefined ? view : <RideBackContext value={back}>{view}</RideBackContext>,
    );
    await settle();
    await clickThrough(rideButton());
    await pump(4);
  }

  it('opens the question on End ride and ends nothing: the stage stays, Pause and End ride give way, the one region says it', async () => {
    const seen = fresh();
    await onTheStage(recordingTrainer(seen, { savable: true }));
    await clickThrough(endRideButton());

    expect(answers()).toEqual(['Keep riding', 'Save ride', 'Discard ride']);
    expect(document.activeElement?.textContent).toBe('Keep riding');
    expect(endRideButton()).toBeUndefined();
    expect(document.querySelector('.oyl-game--riding')).not.toBeNull();
    expect(hudRegion()).toBe(`${END_RIDE_TEXT.askLabel} ${END_RIDE_TEXT.ask}`);
    // The HUD keeps its one region (#445): the question is no second one.
    expect(queryAll(document, '.oyl-game [role="status"], .oyl-game [aria-live]').length).toBe(1);
    expect(seen).toEqual(fresh());
  });

  it('keeps riding on Keep riding: nothing ends, and focus goes back to End ride', async () => {
    const seen = fresh();
    await onTheStage(recordingTrainer(seen, { savable: true }));
    await clickThrough(endRideButton());
    await clickThrough(endRideAnswer(document, 'Keep riding'));

    expect(answers()).toEqual([]);
    expect(endRideButton()).toBeDefined();
    expect(document.activeElement).toBe(endRideButton());
    expect(document.querySelector('.oyl-game--riding')).not.toBeNull();
    expect(seen).toEqual(fresh());
  });

  it('keeps riding on Escape, from the discard step too', async () => {
    const seen = fresh();
    await onTheStage(recordingTrainer(seen, { savable: true }));
    await clickThrough(endRideButton());
    await clickThrough(endRideAnswer(document, 'Discard ride'));
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await Promise.resolve();
    });
    await settle();
    expect(answers()).toEqual([]);
    expect(endRideButton()).toBeDefined();
    expect(seen).toEqual(fresh());
  });

  it('asks once, End ride or Keep riding, with nothing recorded under the ride, and ends it deleting nothing (#2381)', async () => {
    const seen = fresh();
    await onTheStage(recordingTrainer(seen, undefined));
    await clickThrough(endRideButton());
    expect(answers()).toEqual(['Keep riding', 'End ride']);
    expect(hudRegion()).toBe(`${END_RIDE_TEXT.askLabel} ${END_RIDE_TEXT.askNotRecorded}`);
    const asked = document.querySelector('[data-oyl-end-ride]')?.textContent ?? '';
    expect(asked).toContain(END_RIDE_TEXT.askNotRecorded);
    expect(asked).not.toContain('deleted from this device');

    await clickThrough(endRideAnswer(document, 'End ride'));
    await settle();
    // Ended on the one press: back on the picker, nothing saved or deleted.
    expect(document.querySelector('.oyl-game--riding')).toBeNull();
    expect(picker()).toContain(RIDE_ENDED_TEXT['not-recorded']);
    expect(seen.saved).toBe(0);
    expect(seen.discarded).toBe(0);
  });

  it('never discards on the one-step End ride: a recording that turned up since is asked about afresh, with the warning (#2381, round 3)', async () => {
    const seen = fresh();
    const under: { recording?: { readonly savable: boolean } } = {};
    await onTheStage({
      ...recordingTrainer(seen, undefined),
      rideRecording: () => under.recording,
    });
    await clickThrough(endRideButton());
    expect(answers()).toEqual(['Keep riding', 'End ride']);
    // A room reaching `joined` starts one while the question stands.
    under.recording = { savable: true };
    await clickThrough(endRideAnswer(document, 'End ride'));
    // Nothing ended and nothing was deleted: the ride is asked about again.
    expect(seen).toEqual(fresh());
    expect(document.querySelector('.oyl-game--riding')).not.toBeNull();
    expect(answers()).toEqual(['Keep riding', 'Save ride', 'Discard ride']);
    expect(hudRegion()).toBe(`${END_RIDE_TEXT.askLabel} ${END_RIDE_TEXT.ask}`);
    // And discarding it now takes the two steps and the owner's warning.
    await clickThrough(endRideAnswer(document, 'Discard ride'));
    expect(hudRegion()).toBe(`${END_RIDE_TEXT.discardLabel} ${END_RIDE_TEXT.discardWarning}`);
    expect(seen.discarded).toBe(0);
  });

  it('keeps both steps and the deletion warning for a ride with a recording under it, even one with nothing in it yet (#2381)', async () => {
    await onTheStage(recordingTrainer(fresh(), { savable: false }));
    await clickThrough(endRideButton());
    expect(answers()).toEqual(['Keep riding', 'Discard ride']);
    await clickThrough(endRideAnswer(document, 'Discard ride'));
    expect(hudRegion()).toBe(`${END_RIDE_TEXT.discardLabel} ${END_RIDE_TEXT.discardWarning}`);
    expect(document.querySelector('[data-oyl-end-ride]')?.textContent ?? '').toContain(
      END_RIDE_TEXT.discardWarning,
    );
  });

  it('offers no Save ride for a recording with nothing in it', async () => {
    await onTheStage(recordingTrainer(fresh(), { savable: false }));
    await clickThrough(endRideButton());
    expect(answers()).toEqual(['Keep riding', 'Discard ride']);
  });

  it('saves on Save ride: the game ride ends first, then the recording is saved, and the picker says where its result is', async () => {
    const seen = fresh();
    await onTheStage(recordingTrainer(seen, { savable: true }));
    await clickThrough(endRideButton());
    await clickThrough(endRideAnswer(document, 'Save ride'));
    pending = [];

    expect(seen.order).toEqual(['ended', 'saved']);
    expect(seen.discarded).toBe(0);
    expect(rideButton()).toBeDefined();
    expect(picker()).toContain(RIDE_ENDED_TEXT.saved);
    expect(
      queryAll<HTMLAnchorElement>(document, 'a').some(
        (link) => link.getAttribute('href') === '#/ride',
      ),
    ).toBe(true);
  });

  it('asks once more on Discard ride, and discards only on the second', async () => {
    const seen = fresh();
    await onTheStage(recordingTrainer(seen, { savable: true }));
    await clickThrough(endRideButton());
    await clickThrough(endRideAnswer(document, 'Discard ride'));

    expect(answers()).toEqual(['Discard ride', 'Keep riding']);
    expect(document.activeElement?.textContent).toBe('Keep riding');
    expect(hudRegion()).toBe(`${END_RIDE_TEXT.discardLabel} ${END_RIDE_TEXT.discardWarning}`);
    expect(seen).toEqual(fresh());

    await clickThrough(endRideAnswer(document, 'Discard ride'));
    pending = [];
    expect(seen.order).toEqual(['ended', 'discarded']);
    expect(seen.saved).toBe(0);
    expect(picker()).toContain(RIDE_ENDED_TEXT.discarded);
    // #2349's review (nit): labelled as the Ride screen labels it.
    expect(RIDE_ENDED_LABEL.discarded).toBe('Discarded');
    expect(picker()).toContain('Discarded:');
    expect(picker()).not.toContain('Ride ended:');
  });

  it('says “Not deleted”, with the way to the ride, when the discard throws (#2349’s review)', async () => {
    const trainer = recordingTrainer(fresh(), { savable: true });
    await onTheStage({
      ...trainer,
      discardRideRecording: () => Promise.reject(new Error('the device is unwell')),
    });
    await clickThrough(endRideButton());
    await clickThrough(endRideAnswer(document, 'Discard ride'));
    await clickThrough(endRideAnswer(document, 'Discard ride'));
    pending = [];
    expect(picker()).toContain('Not deleted:');
    expect(picker()).toContain(RIDE_ENDED_TEXT['not-deleted']);
    expect(
      queryAll<HTMLAnchorElement>(document, 'a').some(
        (link) => link.getAttribute('href') === '#/ride',
      ),
    ).toBe(true);
  });

  it('says the ride was not saved, and where it still is, when the save throws (#2349’s review)', async () => {
    const trainer = recordingTrainer(fresh(), { savable: true });
    await onTheStage({
      ...trainer,
      saveRideRecording: () => Promise.reject(new Error('the device is unwell')),
    });
    await clickThrough(endRideButton());
    await clickThrough(endRideAnswer(document, 'Save ride'));
    pending = [];
    expect(picker()).toContain('Not saved:');
    expect(picker()).toContain(RIDE_ENDED_TEXT['not-saved']);
    expect(picker()).not.toContain(RIDE_ENDED_TEXT.saved);
    expect(
      queryAll<HTMLAnchorElement>(document, 'a').some(
        (link) => link.getAttribute('href') === '#/ride',
      ),
    ).toBe(true);
  });

  it('says so when the delete did not go through, and where the ride still is', async () => {
    await onTheStage(recordingTrainer(fresh(), { savable: true }, false));
    await clickThrough(endRideButton());
    await clickThrough(endRideAnswer(document, 'Discard ride'));
    await clickThrough(endRideAnswer(document, 'Discard ride'));
    pending = [];
    expect(picker()).toContain(RIDE_ENDED_TEXT['not-deleted']);
    expect(picker()).not.toContain(RIDE_ENDED_TEXT.discarded);
  });

  it('ends a ride with nothing recorded on End ride, asked once, touching no recording (#2381)', async () => {
    const seen = fresh();
    await onTheStage(recordingTrainer(seen, undefined));
    await endTheRide();
    pending = [];
    expect(seen.order).toEqual(['ended']);
    expect(picker()).toContain(RIDE_ENDED_TEXT['not-recorded']);
  });

  it('takes Android’s back on the stage: it opens the question, then is Keep riding', async () => {
    const back = rideBack();
    const seen = fresh();
    await onTheStage(recordingTrainer(seen, { savable: true }), back);
    await act(async () => {
      expect(back.press()).toBe(true);
      await Promise.resolve();
    });
    await settle();
    expect(answers()).toEqual(['Keep riding', 'Save ride', 'Discard ride']);
    await act(async () => {
      expect(back.press()).toBe(true);
      await Promise.resolve();
    });
    await settle();
    expect(answers()).toEqual([]);
    expect(endRideButton()).toBeDefined();
    expect(seen).toEqual(fresh());
  });

  it('says nothing of the last ride once the next begins', async () => {
    await onTheStage(recordingTrainer(fresh(), undefined));
    await endTheRide();
    pending = [];
    expect(picker()).toContain(RIDE_ENDED_TEXT['not-recorded']);
    await clickThrough(rideButton());
    await pump(2);
    await endTheRide();
    pending = [];
    expect(picker().split(RIDE_ENDED_TEXT['not-recorded']).length).toBe(2);
  });
});

/**
 * The chase camera's heading is damped on the frames the renderer is handed —
 * #1994. `camera.ts` §`dampedHeading` is unit-tested and ridden through bends
 * in `chase-camera-bend.test.ts`; what only this file can see is that the loop
 * applies it, by the wall clock between drawn frames, and passes it the
 * rider's reduced-motion preference.
 */
describe('GameView — the chase camera turns at a bounded rate (#1994)', () => {
  /**
   * 60 m north, a U-turn (the two legs a metre apart), and back south: where
   * the road 25 m on comes back past the rider, the heading the camera aims at
   * goes through half a turn in a few frames — 29° in one 250 ms frame,
   * measured with the damping taken out, against the 22.5° the cap allows.
   */
  function turnaroundRoute(): RidableRoute {
    const perDegreeLongitude = 111_320 * Math.cos((51.5 * Math.PI) / 180);
    const points: RoutePoint[] = [];
    const push = (east: number, north: number): void => {
      points.push({
        position: geographicPosition(
          degreesLatitude(51.5 + north / 111_320),
          degreesLongitude(-0.12 + east / perDegreeLongitude),
        ),
        elevation: altitudeMetres(0),
      });
    };
    for (let north = 0; north <= 60; north += 10) push(0, north);
    for (let step = 1; step < 6; step += 1) {
      const angle = (step / 6) * Math.PI;
      push(0.5 * (1 - Math.cos(angle)), 60 + 0.5 * Math.sin(angle));
    }
    for (let north = 60; north >= -400; north -= 10) push(1, north);
    return { id: 'route-u', name: 'Turnaround', profile: routeProfile(points), attempts: 0 };
  }

  async function rideTheTurnaround(): Promise<readonly number[]> {
    const frames: SceneFrame[] = [];
    mounted = await mount(
      <GameView
        port={pedallingPort(turnaroundRoute())}
        renderer={() => Promise.resolve(capturingRenderer(frames))}
        now={() => nowMs}
      />,
    );
    await settle();
    await clickThrough(rideButton());
    await pump(120);
    return frames.map((frame) => Math.atan2(frame.camera.headingX, frame.camera.headingZ));
  }

  /** The largest turn between consecutive drawn frames, and the whole turn, radians. */
  function turns(drawn: readonly number[]): { readonly largest: number; readonly whole: number } {
    let largest = 0;
    let whole = 0;
    for (let index = 1; index < drawn.length; index += 1) {
      const step = (drawn[index] as number) - (drawn[index - 1] as number);
      const turn = Math.abs(Math.atan2(Math.sin(step), Math.cos(step)));
      largest = Math.max(largest, turn);
      whole += turn;
    }
    return { largest, whole };
  }

  it('turns through the turnaround no faster than the cap', async () => {
    const { largest, whole } = turns(await rideTheTurnaround());
    // It did turn round: a frozen camera would pass the bound below.
    expect(whole).toBeGreaterThan(Math.PI * 0.9);
    expect(largest).toBeLessThanOrEqual(CAMERA_MAXIMUM_YAW_RATE * (FRAME_PERIOD_MS / 1000) + 1e-6);
  });

  it('and no faster than the reduced-motion cap for a rider who asked for reduced motion', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const { largest, whole } = turns(await rideTheTurnaround());
    expect(whole).toBeGreaterThan(Math.PI * 0.9);
    expect(largest).toBeLessThanOrEqual(
      REDUCED_MOTION_MAXIMUM_YAW_RATE * (FRAME_PERIOD_MS / 1000) + 1e-6,
    );
  });
});

/**
 * #2077 — the rider's W/kg and zone, wired: the weight the shell hands the
 * game (the weight the physics rides) and the rider's own threshold, read
 * through the game's port. `fields.test.ts` holds the arithmetic.
 */
describe('the rider’s W/kg and zone on the HUD — #2077', () => {
  async function rideWith(port: GamePort, riderMass?: Kilograms): Promise<void> {
    mounted = await mount(<GameView port={port} riderMass={riderMass} now={() => nowMs} />);
    await settle();
    const ride = queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    );
    await clickThrough(ride);
    await pump(10);
  }

  it('draws the zone of the rider’s own threshold, and W/kg over their own weight', async () => {
    await rideWith(
      { ...pedallingPort(testRoute()), ownThresholdPower: () => Promise.resolve(watts(200)) },
      kilograms(80),
    );
    // 220 W over a 200 W threshold is 1.10 of it: zone 5.
    expect(hudField('Zone')).toMatch(/^5\s*VO₂/);
    // 220 W over 80 kg.
    expect(hudField('W/kg')).toBe('2.8');
  });

  it('draws no zone with no threshold set, and a dash for W/kg with no weight', async () => {
    await rideWith(pedallingPort(testRoute()));
    expect(
      queryAll(mounted?.container ?? document, '.oyl-hud__field dt').map((dt) => dt.textContent),
    ).not.toContain('Zone');
    expect(hudField('W/kg')).toBe(NO_READING);
  });
});

/**
 * #2078 — the recent graph, wired: written from the frame loop once a second
 * of the ride's clock, from the readings the HUD shows, and drawn in the
 * route panel. `recent-trace.test.ts` holds the ring; `RecentGraph.test.tsx`
 * the drawing.
 */
describe('the last ten minutes on the HUD — #2078', () => {
  it('writes one second of power and heart rate per second ridden, however many frames', async () => {
    mounted = await mount(<GameView port={pedallingPort(testRoute())} now={() => nowMs} />);
    await settle();
    const ride = queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    );
    await clickThrough(ride);
    // 40 frames at 250 ms: ten seconds of ride, and 40 frames that could each
    // have drawn the graph.
    await pump(40);
    const graph = mounted.container.querySelector('.oyl-hud__route [data-testid="oyl-hud-recent"]');
    expect(graph).not.toBeNull();
    const written = Number(graph?.getAttribute('data-oyl-graph-written'));
    expect(written).toBeGreaterThanOrEqual(8);
    expect(written).toBeLessThanOrEqual(11);
    // The port's live 220 W and 142 bpm, as one unbroken run each.
    expect(queryAll(graph ?? document, '.oyl-hud__recent-power')).toHaveLength(1);
    expect(queryAll(graph ?? document, '.oyl-hud__recent-heart')).toHaveLength(1);
  });

  /**
   * PR #2231's review: the frame loop is what decides a reading "dropped",
   * and it is the ring's only production writer. Each sensor goes quiet for
   * three seconds of the ride, as `sensors.ts` §`gameSensors` reports a
   * paired sensor that stopped — power `0` and not live, heart rate no value
   * and not live — and the drawn line is read back: two runs with a gap
   * between them, and no point on the zero line (`y` 100 in the drawing's
   * units; heart rate's floor clamps a zero there too).
   */
  for (const dropped of ['power', 'heart rate'] as const) {
    it(`draws a gap where ${dropped} dropped mid-ride, never a zero`, async () => {
      let quiet = false;
      const port: GamePort = {
        ...pedallingPort(testRoute()),
        readSensors: () => ({
          rider:
            quiet && dropped === 'power'
              ? { power: watts(0), live: false, paired: true }
              : { power: watts(220), live: true, paired: true },
          cadence: LIVE_CADENCE,
          heartRate:
            quiet && dropped === 'heart rate'
              ? { value: undefined, live: false, paired: true }
              : { value: 142, live: true, paired: true },
        }),
      };
      mounted = await mount(<GameView port={port} now={() => nowMs} />);
      await settle();
      const ride = queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
        (button.textContent ?? '').startsWith('Ride '),
      );
      await clickThrough(ride);
      // Three seconds live, three dropped, three live again, at 250 ms a frame.
      await pump(12);
      quiet = true;
      await pump(12);
      quiet = false;
      await pump(12);
      const graph = mounted.container.querySelector(
        '.oyl-hud__route [data-testid="oyl-hud-recent"]',
      );
      const line = dropped === 'power' ? '.oyl-hud__recent-power' : '.oyl-hud__recent-heart';
      const other = dropped === 'power' ? '.oyl-hud__recent-heart' : '.oyl-hud__recent-power';
      const runs = queryAll(graph ?? document, line).map((path) => path.getAttribute('d') ?? '');
      expect(runs).toHaveLength(2);
      for (const run of runs) expect(run).not.toMatch(/ 100\.00(?: |$)/);
      // The other sensor never dropped: one unbroken run.
      expect(queryAll(graph ?? document, other)).toHaveLength(1);
    });
  }
});

/**
 * #2079 — the rider's panels and text size, read from this device as the ride
 * starts: the choice Settings keeps (`SettingsView.hud-layout.test.tsx`) is
 * the one the next ride draws.
 */
describe('the HUD the rider chose — #2079', () => {
  afterEach(() => {
    localStorage.removeItem(HUD_LAYOUT_STORAGE_KEY);
  });

  async function rideOnce(): Promise<HTMLElement> {
    mounted = await mount(<GameView port={pedallingPort(testRoute())} now={() => nowMs} />);
    await settle();
    const ride = queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    );
    await clickThrough(ride);
    await pump(6);
    const hud = mounted.container.querySelector<HTMLElement>('.oyl-hud');
    if (hud === null) throw new Error('the ride did not start');
    return hud;
  }

  it('draws every panel at the normal size with nothing chosen', async () => {
    const hud = await rideOnce();
    expect(hud.getAttribute('data-oyl-hud-text')).toBe('normal');
    expect(hud.querySelector('.oyl-hud__route')).not.toBeNull();
    expect(hud.querySelector('[data-testid="oyl-hud-recent"]')).not.toBeNull();
    expect(hudField('Speed')).not.toBe('');
  });

  it('draws what the device says the rider chose', async () => {
    writeHudLayout(localStorage, { hidden: ['route', 'graph', 'readings'], textSize: 'large' });
    const hud = await rideOnce();
    expect(hud.getAttribute('data-oyl-hud-text')).toBe('large');
    expect(hud.classList).toContain('oyl-hud--text-large');
    // The route panel and the graph are gone…
    expect(hud.querySelector('.oyl-hud__route')).toBeNull();
    // …and the secondary readings but the ride's times…
    expect(queryAll(hud, '.oyl-hud__fields--secondary dt').map((dt) => dt.textContent)).toEqual([
      'Moving',
      // #2382: this ride records nothing, so the ride's own clock.
      'Ride',
      'Clock',
    ]);
    // …while power, the controls and the notices' cell are the HUD's still.
    expect(hudField('Power')).not.toBe('');
    expect(queryAll(hud, 'button').some((button) => button.textContent === 'Pause')).toBe(true);
  });

  it('keeps the graph when only the route is turned off, and the route when only the graph is', async () => {
    writeHudLayout(localStorage, { hidden: ['route'], textSize: 'normal' });
    let hud = await rideOnce();
    expect(hud.querySelector('.oyl-hud__route [data-testid="oyl-hud-recent"]')).not.toBeNull();
    expect(hud.querySelector('.oyl-hud__profile-svg')).toBeNull();
    mounted?.unmount();
    writeHudLayout(localStorage, { hidden: ['graph'], textSize: 'normal' });
    hud = await rideOnce();
    expect(hud.querySelector('.oyl-hud__route .oyl-hud__profile-svg')).not.toBeNull();
    expect(hud.querySelector('[data-testid="oyl-hud-recent"]')).toBeNull();
  });
});
