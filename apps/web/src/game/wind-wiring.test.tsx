// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #326's wiring: a wind a **rider** set, reaching the physics.
 *
 * `wind.test.ts` proves the simulation does the right thing when it is handed
 * a wind. `wind-choice.test.ts` proves a typed pair of numbers becomes one.
 * Neither says anything about whether a rider can ever cause it — which is
 * exactly the gap #326 is about, and the gap `advanceBot` (#237),
 * `ghostFinished` (#259) and the segment matcher (#282) each sat in with a
 * green unit suite above them. ⚠️ `check:wiring` cannot close it either: it
 * would see `windChoice` imported by `GameView.tsx` and stop there, and an
 * *optional* `SimulationSetup.wind` that nobody supplies is perfectly well
 * typed.
 *
 * So the assertions here are driven through the real component, the real
 * picker controls, the real `windChoice` and the real `GameSimulation`, and
 * they read what a renderer was handed. Deleting the line in `GameView.start`
 * that passes the wind through turns them red; nothing else in this repository
 * does.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GameView, type GamePort, type RidableRoute } from './GameView';
import type { GameRenderer, SceneFrame } from './port';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import { UnitsProvider } from '../units/context';
import type { UnitSystem } from '@onyourleft/store';
import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';

/** Two kilometres of flat road running due **north**, so a northerly is a headwind. */
function northRoute(): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 200; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(20),
    });
  }
  return { id: 'route-north', name: 'Test straight', profile: routeProfile(points), attempts: 0 };
}

function pedallingPort(route: RidableRoute): GamePort {
  return {
    listRoutes: () => Promise.resolve([route]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(220), live: true, paired: true },
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

/** Type into a number box, through the native setter React 19 needs. */
async function type(input: HTMLInputElement | undefined, value: string): Promise<void> {
  expect(input).toBeDefined();
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  await act(async () => {
    descriptor?.set?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}

/** A control found the way a rider finds it: by the words next to it. */
function boxLabelled(words: string): HTMLInputElement | undefined {
  return queryAll<HTMLInputElement>(mounted?.container ?? document, 'input').find((input) =>
    (input.closest('label')?.textContent ?? '').includes(words),
  );
}

function rideButton(): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find((button) =>
    (button.textContent ?? '').startsWith('Ride '),
  );
}

async function pump(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const next = pending.shift();
    if (next === undefined) {
      return;
    }
    nowMs += 250;
    await act(async () => {
      next(nowMs);
      await Promise.resolve();
    });
  }
}

/**
 * The speed on the HUD, as a number — what the **rider** is shown.
 *
 * Read off the panel rather than out of the simulation, so that the whole
 * chain from a typed box to a number in front of somebody on a trainer is in
 * the assertion. ⚠️ `SceneFrame` deliberately carries no distance — it carries
 * a camera and markers in world space — so this is also the only rider-facing
 * scalar available to compare two rides by.
 */
function hudSpeed(): number {
  const field = queryAll(mounted?.container ?? document, '.oyl-hud__field').find(
    (element) => (element.querySelector('.oyl-hud__label')?.textContent ?? '') === 'Speed',
  );
  const text = field?.querySelector('.oyl-hud__value')?.textContent ?? '';
  return Number.parseFloat(text);
}

/**
 * Rides the northward route for sixty frames, optionally in a wind the rider
 * sets through the picker's own controls, and returns the speed they reached.
 */
async function rideWith(setWind: { speed: string; fromBearing: string } | undefined): Promise<{
  readonly speed: number;
  readonly frames: number;
  readonly refused: boolean;
}> {
  const frames: SceneFrame[] = [];
  mounted = await mount(
    <GameView
      port={pedallingPort(northRoute())}
      renderer={() => Promise.resolve(capturingRenderer(frames))}
      now={() => nowMs}
    />,
  );
  await settle();

  if (setWind !== undefined) {
    await clickThrough(boxLabelled('Ride in a wind'));
    await type(boxLabelled('Wind speed'), setWind.speed);
    await type(boxLabelled('Wind direction'), setWind.fromBearing);
  }

  const ride = rideButton();
  const refused = ride?.getAttribute('aria-disabled') === 'true';
  await clickThrough(ride);
  await pump(60);
  await settle();
  // The renderer really was driven, or "the ride is slower" could be "the ride
  // never started".
  return { speed: hudSpeed(), frames: frames.length, refused };
}

describe('a wind a rider sets on the picker reaches the physics', () => {
  it('makes the same rider on the same road slower into it', async () => {
    // ⚠️ The assertion that goes red the moment `GameView` stops passing the
    // wind to `GameSimulation`. Everything else about the two rides is
    // identical: same route, same power, same frames, same clock.
    const stillAir = await rideWith(undefined);
    mounted?.unmount();
    mounted = undefined;
    const intoAGale = await rideWith({ speed: '36', fromBearing: '0' });

    expect(stillAir.frames).toBeGreaterThan(50);
    expect(intoAGale.frames).toBeGreaterThan(50);
    expect(stillAir.speed).toBeGreaterThan(0);
    // 36 km/h of headwind is 10 m/s: worth several km/h, not a rounding
    // difference, and it is the number in the box that caused it.
    expect(intoAGale.speed).toBeLessThan(stillAir.speed - 5);
  });

  it('and faster with it behind them', async () => {
    const stillAir = await rideWith(undefined);
    mounted?.unmount();
    mounted = undefined;
    const pushedAlong = await rideWith({ speed: '36', fromBearing: '180' });
    expect(pushedAlong.speed).toBeGreaterThan(stillAir.speed + 2);
  });
});

describe('the ride control refuses a wind it cannot make', () => {
  it('blocks the ride and says why, rather than starting in still air', async () => {
    // #237's defect arriving from the side the rider can see: a ride that
    // quietly has no wind in it because the number in the box was unusable.
    mounted = await mount(<GameView port={pedallingPort(northRoute())} now={() => nowMs} />);
    await settle();
    await clickThrough(boxLabelled('Ride in a wind'));
    await type(boxLabelled('Wind speed'), '9000');

    const ride = rideButton();
    expect(ride?.getAttribute('aria-disabled')).toBe('true');
    const problemId = ride?.getAttribute('aria-describedby') ?? '';
    expect(problemId).not.toBe('');
    // The reference resolves — a dangling `aria-describedby` is silent to
    // everyone not using a screen reader, which is why `a11y/audit.ts` has a
    // rule for it and why this checks the element is really there.
    const problem = mounted.container.ownerDocument.getElementById(problemId.split(' ')[0] ?? '');
    expect(problem?.textContent ?? '').toMatch(/wind speed/);

    await clickThrough(ride);
    // Still on the picker: the ride did not start.
    expect(rideButton()).toBeDefined();
  });

  it('names BOTH refusals when the pacer box is wrong too', async () => {
    // One shared id would point the ride button at whichever of the two
    // happened to render, so a rider would be told about one problem and
    // blocked by two.
    mounted = await mount(<GameView port={pedallingPort(northRoute())} now={() => nowMs} />);
    await settle();
    await clickThrough(boxLabelled('Ride against a pacer'));
    await type(boxLabelled('Pacer intensity'), '70');
    await clickThrough(boxLabelled('Ride in a wind'));
    await type(boxLabelled('Wind speed'), '');

    const described = (rideButton()?.getAttribute('aria-describedby') ?? '').split(' ');
    expect(described).toHaveLength(2);
    for (const id of described) {
      expect(mounted.container.ownerDocument.getElementById(id)).not.toBeNull();
    }
  });

  it('lets the ride start once the wind is one the model accepts', async () => {
    const ridden = await rideWith({ speed: '20', fromBearing: '270' });
    expect(ridden.refused).toBe(false);
    expect(ridden.speed).toBeGreaterThan(0);
  });
});

describe("the wind box is read in the RIDER's own units (#238, #326)", () => {
  /**
   * ⚠️ **What this block is for, and why the cases above cannot do it.**
   *
   * `GameView` reads the rider's unit system from a React context and hands it
   * to two pure functions — `windChoice`, which reads the number in the box,
   * and `speedUnit`, which labels it. Both of those are mutation-tested against
   * their own `units` parameter in `wind-choice.test.ts` and
   * `units/format.test.ts`, and **neither says anything about the seam**:
   * replacing `useUnits()` with the literal `'metric'` at either call site left
   * the entire suite green, because every other test here mounts with no
   * provider and a rider with no preference *is* metric.
   *
   * That is the context-read seam, and it is invisible to both of this
   * repository's automatic gates: `check:wiring` states it cannot follow a prop
   * through JSX (§4j), and the typechecker is perfectly happy with a literal
   * where a variable was. The only thing that catches it is mounting under a
   * **non-default** provider and asserting the difference, which is what these
   * cases do.
   */
  async function pickerIn(units: UnitSystem | undefined, typed: string): Promise<void> {
    const view = <GameView port={pedallingPort(northRoute())} now={() => nowMs} />;
    mounted = await mount(
      units === undefined ? view : <UnitsProvider units={units}>{view}</UnitsProvider>,
    );
    await settle();
    await clickThrough(boxLabelled('Ride in a wind'));
    await type(boxLabelled('Wind speed'), typed);
  }

  function labelOf(words: string): string {
    return boxLabelled(words)?.closest('label')?.textContent ?? '';
  }

  function problemText(): string {
    return mounted?.container.querySelector('.oyl-game__problem')?.textContent ?? '';
  }

  /**
   * A speed that straddles the domain's own bound once it is converted.
   *
   * `route/wind.ts`'s `MAXIMUM_WIND_SPEED_METRES_PER_SECOND` is 40 m/s. 100 km/h is 27.8
   * m/s and is accepted; 100 mph is 44.7 m/s and is not. So the *same digits*
   * in the same box have to produce different answers for the two riders, and
   * a client that read every box as metric would accept both.
   */
  const STRADDLES_THE_BOUND = '100';

  it('labels the speed box in the unit that rider reads, not in a fixed one', async () => {
    await pickerIn('imperial', '');
    expect(labelOf('Wind speed')).toContain('mph');
    expect(labelOf('Wind speed')).not.toContain('km/h');
  });

  it('labels it in kilometres per hour for a rider who has chosen nothing', async () => {
    // The control case. Without it the assertion above could be passing
    // because the label is hard-coded to 'mph'.
    await pickerIn(undefined, '');
    expect(labelOf('Wind speed')).toContain('km/h');
  });

  it('accepts 100 from a metric rider and refuses it from an imperial one', async () => {
    await pickerIn(undefined, STRADDLES_THE_BOUND);
    // 100 km/h is a wind the model takes, so the ride is not blocked.
    expect(rideButton()?.getAttribute('aria-disabled')).toBeNull();

    mounted?.unmount();
    mounted = undefined;

    await pickerIn('imperial', STRADDLES_THE_BOUND);
    // The same digits are 100 mph, which is past the bound — and the bound is
    // in metres per second, so only a conversion that actually happened can
    // put these two rides on opposite sides of it.
    expect(rideButton()?.getAttribute('aria-disabled')).toBe('true');
  });

  it('quotes the bound back in the unit the box is in', async () => {
    await pickerIn('imperial', STRADDLES_THE_BOUND);
    // 40 m/s is 89.5 mph. A refusal naming 144.0 km/h would be the domain's
    // bound restated in a unit that is on none of this rider's screens.
    expect(problemText()).toMatch(/89\.5 mph/);
    expect(problemText()).not.toMatch(/km\/h/);
  });
});
