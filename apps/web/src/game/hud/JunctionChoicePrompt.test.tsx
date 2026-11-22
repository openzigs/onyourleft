// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The HUD's junction prompt (#2898, ADR 0088 D-1.3, D-3.1, D-5.3): what a tap,
 * a key and a pad do, read back through the rolling route the ride rides
 * (`RollingRoute.view`, at ride distance minus its origin), never the prompt's
 * own state; which ways it draws; and the behavioural ride once more with the
 * turn taken by a tap. Its audit, its keyboard path, its announcements and its
 * touch lock are `JunctionChoicePrompt.a11y.test.tsx`'s.
 */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { distanceBetween } from '@onyourleft/domain';

import { tap } from '../../design/touch-lock-testing';
import { activateWithKeyboard, mount, type Mounted } from '../../testing/mount';
import type { PadSnapshot } from '../gamepad-port';
import { pressesOfWays, type JunctionPrompt } from '../open-world/junction-choice';
import {
  newRide,
  readAt,
  rideTrace,
  starRide,
  theJunction,
} from '../open-world/junction-ride-testing';
import { JunctionChoicePrompt } from './JunctionChoicePrompt';
import {
  JunctionHud,
  keysOn,
  pressKey,
  textOf,
  wayButton,
  wayButtons,
  wordOn,
} from './junction-prompt-testing';
import { U_TURN_NAME } from './junction-text';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

/** Where the ride is at `at`, read off the route as the game draws it. */
const placeAt = (route: Parameters<typeof readAt>[0], at: number) => readAt(route, at).position;

describe('a press in the prompt changes the branch the rolling route reads (#2898)', () => {
  it('a tap, Enter on a focused way and an arrow key each send the ride down that way', async () => {
    const { route, choice } = newRide();
    const junction = theJunction(route);
    const rider = junction.distance - 200;
    route.advance(rider);
    mounted = await mount(<JunctionHud choice={choice} rider={rider} />);
    const [left, straight, right] = junction.ways.map((way) => way.edge.id);
    // What the road past the junction is when each way is fixed, with no prompt.
    const roadPast = (id: string | undefined) => {
      const fixed = newRide();
      fixed.route.advance(rider);
      fixed.route.choose(junction.distance, id as string, rider);
      return placeAt(fixed.route, junction.distance + 60);
    };
    const past = () => placeAt(route, junction.distance + 60);

    expect(distanceBetween(past(), roadPast(straight))).toBeLessThan(1e-6);
    tap(wayButton(left as string));
    expect(distanceBetween(past(), roadPast(left))).toBeLessThan(1e-6);
    expect(wayButton(left as string).classList.contains('oyl-hud__junction-way--chosen')).toBe(
      true,
    );
    await activateWithKeyboard(wayButton(right as string));
    expect(distanceBetween(past(), roadPast(right))).toBeLessThan(1e-6);
    pressKey('ArrowUp');
    expect(distanceBetween(past(), roadPast(straight))).toBeLessThan(1e-6);
    pressKey('ArrowLeft');
    expect(distanceBetween(past(), roadPast(left))).toBeLessThan(1e-6);
    expect(textOf(wayButton(left as string))).toContain('Chosen');
  });

  it('a tap on U-turn turns the rider round, read back on the road ahead', async () => {
    const { route, choice } = newRide();
    const rider = 250;
    route.advance(rider);
    const behind = placeAt(route, rider - 50);
    mounted = await mount(<JunctionHud choice={choice} rider={rider} />);
    const uTurn = [...document.querySelectorAll('button')].find((each) =>
      textOf(each).startsWith(U_TURN_NAME),
    );
    tap(uTurn as HTMLButtonElement);
    // 50 m on is back where the rider was 50 m ago, give or take the sample it turned on.
    expect(distanceBetween(placeAt(route, rider + 60), behind)).toBeLessThan(25);
    expect(route.legs.some((leg) => leg.kind === 'u-turn')).toBe(true);
  });
});

describe('the prompt shows only the ways the graph has (#2898)', () => {
  it('offers no right turn at a junction whose ways go left and straight on', async () => {
    const { choice, rider } = starRide([-90, 0]);
    mounted = await mount(<JunctionHud choice={choice} rider={rider} />);
    expect(wayButtons().map(wordOn)).toEqual(['Left', 'Straight on']);
    for (const each of wayButtons()) expect(wordOn(each)).not.toMatch(/right/i);
  });

  it('draws every way the junction has, each arrow pointing the way’s own turn', async () => {
    for (const [turns, words] of [
      [
        [0, 90],
        ['Straight on', 'Right'],
      ],
      [
        [-90, -30, 0],
        ['Left', 'Bear left', 'Straight on'],
      ],
      [
        [-170, -45, 10, 160],
        ['Sharp left', 'Bear left', 'Straight on', 'Sharp right'],
      ],
    ] as const) {
      const { choice, rider, junction } = starRide(turns);
      mounted = await mount(<JunctionHud choice={choice} rider={rider} />);
      expect(wayButtons().map(wordOn), turns.join()).toEqual(words);
      expect(wayButtons().map((each) => each.dataset.oylWay)).toEqual(
        junction.ways.map((way) => way.edge.id),
      );
      const rotations = wayButtons().map((each) =>
        each.querySelector('svg g')?.getAttribute('transform'),
      );
      expect(rotations).toEqual(
        junction.ways.map((way) => `rotate(${String(Math.round(way.turnDegrees))})`),
      );
      mounted.unmount();
      mounted = undefined;
    }
  });
});

describe('each way is labelled from the press that takes it (#2898, the review of #2964)', () => {
  it('at −90°, −30° and 0°, the right press takes −30°, and its key says so', async () => {
    const { route, choice, rider, junction, ids } = starRide([-90, -30, 0]);
    mounted = await mount(<JunctionHud choice={choice} rider={rider} />);
    expect(wayButtons().map(keysOn)).toEqual([['←'], ['→'], ['↑']]);
    // And pressing what the label says takes that way.
    pressKey('ArrowRight');
    expect(route.legs.find((leg) => leg.start === junction.distance)?.edge.id).toBe(ids[1]);
  });

  it('labels with the same mapping the press applies, at every shape of junction', async () => {
    const glyph = { left: '←', straight: '↑', right: '→' } as const;
    for (const turns of [
      [-90, 0, 90],
      [-15, 40, 95],
      [-90, 0],
      [-30, 30],
    ]) {
      const { choice, rider } = starRide(turns);
      mounted = await mount(<JunctionHud choice={choice} rider={rider} />);
      const shown = choice.prompt(rider) as JunctionPrompt;
      const presses = pressesOfWays(shown);
      expect(wayButtons().map(keysOn), turns.join()).toEqual(
        shown.ways.map((way) => (presses.get(way.edge.id) ?? []).map((press) => glyph[press])),
      );
      mounted.unmount();
      mounted = undefined;
    }
  });

  it('with more than three ways, a way no single press reaches shows no key, and a tap steps toward it', async () => {
    const { route, choice, rider, junction, ids } = starRide([-100, -45, 0, 45, 100]);
    mounted = await mount(<JunctionHud choice={choice} rider={rider} />);
    expect(wayButtons().map(keysOn)).toEqual([[], ['←'], ['↑'], ['→'], []]);
    const taken = () => route.legs.find((leg) => leg.start === junction.distance)?.edge.id;
    tap(wayButton(ids[0] as string));
    // One step, never a jump: D-1.3's stepping.
    expect(taken()).toBe(ids[1]);
    tap(wayButton(ids[0] as string));
    expect(taken()).toBe(ids[0]);
    tap(wayButton(ids[4] as string));
    expect(taken()).toBe(ids[1]);
    // The chosen way with no press of its own is already where the ride goes.
    tap(wayButton(ids[1] as string));
    expect(taken()).toBe(ids[1]);
  });
});

describe('a pad’s turn buttons choose through the HUD (#2898, ADR 0088 D-3)', () => {
  let listed: (PadSnapshot | null)[] = [];

  beforeEach(() => {
    listed = [];
    Object.defineProperty(window.navigator, 'getGamepads', {
      configurable: true,
      value: () => listed,
    });
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
    vi.useRealTimers();
    Reflect.deleteProperty(window.navigator, 'getGamepads');
  });

  const pad = (down: readonly number[]): PadSnapshot => ({
    connected: true,
    mapping: 'standard',
    axes: [0, 0],
    buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: down.includes(index) })),
  });

  it('face button 2 takes the left way, once per press', async () => {
    const { route, choice } = newRide();
    const junction = theJunction(route);
    const rider = junction.distance - 200;
    route.advance(rider);
    listed = [pad([])];
    mounted = await mount(<JunctionHud choice={choice} rider={rider} />);
    const taken = () => route.legs.find((leg) => leg.start === junction.distance)?.edge.id;
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    listed = [pad([2])];
    act(() => {
      vi.advanceTimersToNextFrame();
    });
    expect(taken()).toBe(junction.ways[0]?.edge.id);
    // Face button 1 is right; held over frames it is one press.
    listed = [pad([1])];
    for (let frame = 0; frame < 3; frame += 1) {
      act(() => {
        vi.advanceTimersToNextFrame();
      });
    }
    expect(taken()).toBe(junction.ways[2]?.edge.id);
  });
});

describe('the behavioural ride, the turn taken by a tap (ADR 0088 D-5.3)', () => {
  const DURATION = 200;

  it('a tap on the left way before the lock sends the same grades as that branch fixed with no press', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let tapped = false;
    try {
      const byTap = rideTrace(DURATION, ({ route, choice }, rider) => {
        const shown = choice.prompt(rider);
        act(() => {
          root.render(
            <JunctionChoicePrompt
              junction={{ prompt: shown, press: (press) => choice.press(press, rider) }}
              touchLocked={false}
              units="metric"
            />,
          );
        });
        const junction = theJunction(route);
        if (!tapped && shown?.distance === junction.distance && !shown.locked) {
          tap(wayButton(junction.ways[0]?.edge.id as string));
          tapped = true;
        }
      });
      expect(tapped).toBe(true);
      const fixed = rideTrace(
        DURATION,
        () => undefined,
        ({ route }) => {
          const junction = theJunction(route);
          expect(route.choose(junction.distance, junction.ways[0]?.edge.id as string, 0)).toBe(
            'swapped',
          );
        },
      );
      expect(byTap.grades).toEqual(fixed.grades);
      expect(byTap.distances).toEqual(fixed.distances);
      // And the turn is real: the default branch's grades differ.
      expect(rideTrace(DURATION, () => undefined).grades).not.toEqual(byTap.grades);
    } finally {
      act(() => {
        root.unmount();
      });
      host.remove();
    }
  });
});
