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
import { DEFAULT_PACER_INTENSITY } from './pacer-choice';
import { NO_READING } from './hud/fields';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  buildGhostTrack,
  routeProfile,
  watts,
  type GhostTrack,
  type RoutePoint,
} from '@onyourleft/domain';

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
 * A previous attempt on the same road, ridden faster than the rider is riding
 * now — so its gap is unmistakably its own rather than the bot's.
 */
const PREVIOUS_ATTEMPT = buildGhostTrack({
  elapsedSeconds: [0, 60],
  distanceMetres: [0, 1_200],
});

/** A rider on the trainer, pedalling steadily. */
function pedallingPort(route: RidableRoute, ghost?: GhostTrack): GamePort {
  return {
    listRoutes: () => Promise.resolve([route]),
    loadGhost: () => Promise.resolve(ghost),
    readSensors: () => ({
      rider: { power: watts(220), live: true, paired: true },
      cadence: { value: 88, live: true, paired: true },
      heartRate: { value: 142, live: true, paired: true },
    }),
  };
}

/** A renderer that draws nothing and keeps every frame it was given. */
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
  readonly ghost?: boolean;
}): Promise<SceneFrame[]> {
  const route = options.ghost === true ? { ...testRoute(), attempts: 1 } : testRoute();
  const frames: SceneFrame[] = [];
  mounted = await mount(
    <GameView
      port={pedallingPort(route, options.ghost === true ? PREVIOUS_ATTEMPT : undefined)}
      renderer={() => Promise.resolve(capturingRenderer(frames))}
      now={() => nowMs}
    />,
  );
  await settle();

  if (options.ghost === true) {
    const box = queryAll<HTMLInputElement>(mounted.container, 'input[type="checkbox"]').find(
      (input) => (input.closest('label')?.textContent ?? '').includes('Race your own'),
    );
    expect(box).toBeDefined();
    await clickThrough(box);
  }
  if (options.pacer) {
    const box = queryAll<HTMLInputElement>(mounted.container, 'input[type="checkbox"]').find(
      (input) => (input.closest('label')?.textContent ?? '').includes('pacer'),
    );
    expect(box).toBeDefined();
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
    const parsed = /^(\d+) s (ahead|behind)$/.exec(gap);
    expect(parsed).not.toBeNull();
    expect(Number(parsed?.[1])).toBeGreaterThan(0);
  });

  it('tells the rider which side of the bot they are on', async () => {
    await startRiding({ pacer: true, intensity: SLOW });
    await pump(60);

    // The rider is on 2.75 w/kg against the bot's 0.5, so they are in front.
    expect(hudField('Pacer')).toContain('ahead');
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
    expect(ride?.disabled).toBe(true);
    expect(mounted.container.textContent ?? '').toContain('70');
  });
});

/**
 * #253's second half: the path nothing drove.
 *
 * `withGhost` and `withPacer` are independent controls, so a rider can choose
 * both — and until #253 the HUD had one gap field with a `gapTo` discriminator
 * that resolved to `'bot'` whenever a bot existed, which silently dropped the
 * ghost's gap on exactly that ride. A rider racing their own best time was told
 * only about the bot.
 */
describe('riding against a ghost and a pacer at once', () => {
  const SLOW = '0.5';

  it('gives each chased rider a gap of its own rather than one shared field', async () => {
    await startRiding({ pacer: true, ghost: true, intensity: SLOW });
    await pump(60);

    const pacer = hudField('Pacer');
    const best = hudField('Your best');
    const shape = /^(\d+) s (ahead|behind)$/;

    expect(shape.test(pacer)).toBe(true);
    expect(shape.test(best)).toBe(true);
    // The bot is on 0.5 w/kg and the previous attempt rode 20 m/s, so the rider
    // is ahead of one and behind the other. Two gaps, two answers.
    expect(pacer).toContain('ahead');
    expect(best).toContain('behind');
    expect(pacer).not.toBe(best);
  });

  it('draws both of them on the road, in three different places', async () => {
    const frames = await startRiding({ pacer: true, ghost: true, intensity: SLOW });
    await pump(60);

    const last = frames[frames.length - 1];
    const kinds = (last?.markers ?? []).map((marker) => marker.kind).sort();
    expect(kinds).toEqual(['bot', 'ghost', 'rider']);

    const zs = (last?.markers ?? []).map((marker) => marker.z);
    expect(new Set(zs).size).toBe(3);
  });

  it('shows only the gap that exists when the rider chases one of them', async () => {
    await startRiding({ pacer: false, ghost: true });
    await pump(60);

    expect(hudField('Pacer')).toContain(NO_READING);
    // Asserted by shape rather than by "not a dash": a field that does not
    // exist at all also fails to contain a dash, which is a test that passes
    // for the wrong reason and is how the missing field got this far.
    expect(/^\d+ s (ahead|behind)$/.test(hudField('Your best'))).toBe(true);
  });
});
