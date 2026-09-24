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

import { GameView, type GamePort, type RidableRoute } from './GameView';
import type { GameRenderer, SceneFrame } from './port';
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
import { NO_SENSORS } from './sensors';
import { NO_ROUTES_YET } from '../routes/two-importers';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import type { CameraThrottle } from '../camera/session';
import type { ThermalPort } from './thermal-port';
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

import { DEFAULT_RIDER_MASS_KILOGRAMS } from '../athlete/mass';

/** Two kilometres of road that rises and falls, so a gradient is in play. */
function testRoute(): RidableRoute {
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
      render: (frame: SceneFrame) => {
        frames.push(frame);
      },
      setQuality: (settings: QualitySettings) => {
        rungs.push(settings);
      },
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };
}

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
  /** The platform's thermal forecast — #247. */
  readonly thermal?: ThermalPort;
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
      thermal={options.thermal}
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

    await clickThrough(endRideButton());
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
});

describe('the choice itself', () => {
  it('offers the pacer the way the ghost is offered, with a default already in the box', async () => {
    mounted = await mount(<GameView port={pedallingPort(testRoute())} now={() => nowMs} />);
    await settle();

    const text = mounted.container.textContent ?? '';
    expect(text).toContain('pacer');
    const intensity = queryAll<HTMLInputElement>(mounted.container, 'input[type="number"]')[0];
    expect(intensity?.value).toBe(String(DEFAULT_PACER_INTENSITY));
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
async function rideAtMass(riderMass: Kilograms | undefined): Promise<SceneFrame[]> {
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
 * and nothing has to reach for the thermal API — which, per
 * `docs/validation/0002-android-shell-and-game.md` Part E, is `undefined` in
 * the shipped app in any case.
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
    // once hot. With `thermalHeadroom` `undefined` in the shipped app
    // (validation 0002 Part E) that was the only live input to the policy, so
    // #91's whole reduction path was unreachable — and every test of it passed,
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
  });

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
 * The thermal forecast reaches the ladder — #247.
 *
 * Until #247 `quality.ts`'s headroom half had no caller: the ladder was asked
 * `{ frameMs }` and nothing else, so `HEADROOM_REDUCE_ABOVE` could not fire on
 * any device. These drive the real loop at comfortable frame times, so frame
 * time alone would never step down, and read the rung the renderer was told.
 */
describe('GameView — a hot forecast steps the world down (#247)', () => {
  /** A port that always answers the same forecast. */
  const forecasting = (headroom: number | undefined): ThermalPort => ({
    readThermalHeadroom: () => Promise.resolve(headroom),
  });
  const COMFORTABLE_MS = 1000 / 60;

  it('steps down on a hot forecast even though every frame is comfortable', async () => {
    await startRiding({ pacer: false, thermal: forecasting(0.95) });
    await pump(SUSTAINED_SAMPLES + 2, COMFORTABLE_MS);
    expect(rungs[rungs.length - 1]).toEqual(QUALITY_LADDER[1]);
  });

  /**
   * The review finding on #523. The forecast is read every ten seconds and the
   * ladder counts pressure per FRAME, so one reading handed to every frame
   * until the next was hundreds of samples: one hot reading walked the ride to
   * the floor, and one cool one climbed it straight back. A reading may now
   * move the ladder one rung at most.
   */
  describe('one reading moves the ladder one rung at most', () => {
    /** The poll `GameView` starts, run by the test. @see thermal.ts §everyInterval */
    let polls: (() => void)[] = [];
    beforeEach(() => {
      polls = [];
      vi.stubGlobal('setInterval', (task: () => void) => {
        polls.push(task);
        return polls.length;
      });
      vi.stubGlobal('clearInterval', () => undefined);
    });

    /** A port answering whatever the test last set. */
    function settable(first: number): ThermalPort & { set: (next: number) => void } {
      let headroom = first;
      return {
        readThermalHeadroom: () => Promise.resolve(headroom),
        set: (next) => {
          headroom = next;
        },
      };
    }

    /** Take the next reading, as the ten-second poll would. */
    async function poll(): Promise<void> {
      await act(async () => {
        for (const task of polls) {
          task();
        }
        await Promise.resolve();
      });
    }

    const LONG_AFTER = 20 * SUSTAINED_SAMPLES;

    it('steps down one rung on one hot reading, however many frames it is held for', async () => {
      await startRiding({ pacer: false, thermal: settable(0.95) });
      await pump(LONG_AFTER, COMFORTABLE_MS);
      expect(rungs).toEqual([QUALITY_LADDER[1]]);
    });

    it('steps down one more rung on the next hot reading', async () => {
      const port = settable(0.95);
      await startRiding({ pacer: false, thermal: port });
      await pump(LONG_AFTER, COMFORTABLE_MS);
      await poll();
      await pump(LONG_AFTER, COMFORTABLE_MS);
      expect(rungs).toEqual([QUALITY_LADDER[1], QUALITY_LADDER[2]]);
    });

    it('climbs one rung, not all of them, on one cool reading', async () => {
      const port = settable(0.95);
      await startRiding({ pacer: false, thermal: port });
      await pump(LONG_AFTER, COMFORTABLE_MS);
      await poll();
      await pump(LONG_AFTER, COMFORTABLE_MS);
      port.set(0.2);
      await poll();
      await pump(LONG_AFTER, COMFORTABLE_MS);
      expect(rungs).toEqual([QUALITY_LADDER[1], QUALITY_LADDER[2], QUALITY_LADDER[1]]);
    });
  });

  it('stays on the top rung under a cool forecast', async () => {
    // The control: the same ride, the same frames, a forecast well clear.
    await startRiding({ pacer: false, thermal: forecasting(0.2) });
    await pump(SUSTAINED_SAMPLES + 2, COMFORTABLE_MS);
    // The renderer is told a rung only when it changes, so "no rung at all" is
    // "never left the top one" — the same reading the threshold test above makes.
    expect(rungs).toEqual([]);
  });

  it('reads a NaN forecast as no opinion, so comfortable frames keep the top rung', async () => {
    await startRiding({ pacer: false, thermal: forecasting(Number.NaN) });
    await pump(SUSTAINED_SAMPLES + 2, COMFORTABLE_MS);
    // The renderer is told a rung only when it changes, so "no rung at all" is
    // "never left the top one" — the same reading the threshold test above makes.
    expect(rungs).toEqual([]);
  });
});
