// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **Every junction with a public street offers a turn, including after a
 * U-turn; and where none is offered, the reason is written down** — #3124.
 *
 * The owner's open-world tablet ride of 2026-11-24: "There are still a number
 * of streets that don't offer the option to turn onto. I also noticed i turned
 * off a street then did a u turn and was not offered to turn back onto the
 * street I originally turned off … If there are limitations we just need to
 * make that known".
 *
 * Every case rides the real game screen over the product's own session, its
 * area reader, decoder, street graph, rolling route, junction choice, prompt
 * and HUD, on fixture streets (`fixture-testing.ts` and below: lines written
 * here, no map data, no place), and reads back the junction pop-up the rider
 * was shown on each frame (`offered-ways-testing.ts`):
 *
 * - **A town of crossroads**: a pop-up at every junction ridden through,
 *   offering all three ways before its choice is final; a turn taken; and,
 *   after a U-turn made more than the lock's 100 m past the junction, a
 *   pop-up there again offering the street turned off from, both ways.
 * - **Each limit kept on purpose** (`turn-limits.ts`): a junction of that kind
 *   offers no choice, and the limit's words are in the open-world start
 *   screen's help. A service road, a private road, a motorway, a footway, a
 *   farm track and a street mapped to stop 6 m short of the road, along one
 *   street, raise no pop-up at all, while a public crossroads after them does;
 *   a junction 70 m after the last one is shown locked, its default alone; and
 *   so is the junction a U-turn 60 m past it rides back to, which is how the
 *   owner's U-turn was not offered the street turned off from.
 *
 * ⚠️ **The U-turn case is not a defect past the lock.** Turned round more than
 * 100 m from the junction, the rider is offered the street turned off from,
 * both ways, before and after this change. Within 100 m the choice is already
 * final (ADR 0088 D-1.5, ADR 0087 D-6.2), and that is a rule kept on purpose,
 * now written down.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { JUNCTION_LOCK_METRES } from '@onyourleft/domain';

import type { GraphFixtureStreet } from '@onyourleft/map-features/testing';

import { OPEN_WORLD_ROUTE } from '../../shell/routes';
import type { SceneInput } from '../scene';
import {
  MAIN_STREET_ROW,
  OPEN_WORLD_GRID_STREETS,
  START_COLUMN,
  START_ROW,
} from './fixture-testing';
import { JUNCTION_PROMPT_METRES } from './junction-choice';
import {
  sceneInputs,
  startOfferedWaysRide,
  type OfferedWaysRide,
  type RiddenFrame,
} from './offered-ways-testing';
import { TURN_LIMIT_WORDS, type TurnLimit } from './turn-limits';

vi.mock('../scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scene')>();
  return {
    ...actual,
    sceneFrame: (input: SceneInput) => {
      sceneInputs.push(input);
      return actual.sceneFrame(input);
    },
  };
});

/** About how many metres a fixture pixel is: what a column is in ride metres east of the start. */
const METRES_PER_PIXEL = 0.2335;

/** The row the side streets of {@link LIMIT_STREETS} run south to. */
const SOUTH_ROW = 3148;

/** Main street, west to east, as the grid has it: a residential street. */
const MAIN: GraphFixtureStreet = {
  tags: { kind: 'minor_road', kind_detail: 'residential', name: 'Main Street' },
  line: [
    [-4000, MAIN_STREET_ROW],
    [3500, MAIN_STREET_ROW],
  ],
};

/** A street south from Main street at `column`, from `fromRow`, with `tags`. */
function southFrom(
  column: number,
  tags: GraphFixtureStreet['tags'],
  fromRow = MAIN_STREET_ROW,
): GraphFixtureStreet {
  return {
    tags,
    line: [
      [column, fromRow],
      [column, SOUTH_ROW],
    ],
  };
}

/** The public crossroads past the limits, which the pop-up does offer. */
const CONTROL_COLUMN = 3000;

/**
 * #3124: **one street of every way that is not offered**, each leaving Main
 * street to the south 700 pixels (about 160 m) after the last, then a public
 * crossroads. Every one but the last is drawn or mapped as a way a rider can
 * see, and none is a turn.
 */
const LIMIT_STREETS: readonly GraphFixtureStreet[] = [
  MAIN,
  southFrom(-2000, { kind: 'minor_road', kind_detail: 'service' }),
  southFrom(-1300, { kind: 'minor_road', kind_detail: 'residential', access: 'private' }),
  southFrom(-600, { kind: 'highway', kind_detail: 'motorway' }),
  southFrom(200, { kind: 'path', kind_detail: 'footway' }),
  southFrom(900, { kind: 'path', kind_detail: 'track' }),
  // About 6 m short of Main street: past the graph's 3 m T-snap.
  southFrom(1600, { kind: 'minor_road', kind_detail: 'residential' }, MAIN_STREET_ROW + 26),
  {
    tags: { kind: 'minor_road', kind_detail: 'residential' },
    line: [
      [CONTROL_COLUMN, 300],
      [CONTROL_COLUMN, SOUTH_ROW],
    ],
  },
];

/** The limit each of {@link LIMIT_STREETS}' side streets is, in its order. */
const LIMITS_ALONG: readonly TurnLimit[] = [
  'service',
  'private',
  'motorway',
  'path',
  'path',
  'not-joined',
];

/** The column of {@link CLOSE_STREETS}' second crossroads: 300 pixels, about 70 m, after the first. */
const CLOSE_COLUMN = -1700;

/** #3124: two public crossroads 70 m apart, then the grid's next. */
const CLOSE_STREETS: readonly GraphFixtureStreet[] = [
  MAIN,
  ...[-2000, CLOSE_COLUMN, -500].map((column): GraphFixtureStreet => ({
    tags: { kind: 'minor_road', kind_detail: 'residential' },
    line: [
      [column, 300],
      [column, SOUTH_ROW],
    ],
  })),
];

let ride: OfferedWaysRide | undefined;

/** The ride's junctions prompted, by ride distance, nearest the start first. */
function prompted(frames: readonly RiddenFrame[]): number[] {
  return [
    ...new Set(
      frames.flatMap((frame) => (frame.junction === undefined ? [] : [frame.junction.distance])),
    ),
  ].sort((a, b) => a - b);
}

/** The frames that prompt for the junction at `junction`, with the pop-up the rider was shown on each. */
function promptsFor(frames: readonly RiddenFrame[], junction: number): RiddenFrame[] {
  return frames.filter((frame) => frame.junction?.distance === junction);
}

/** The help the open-world start screen shows. */
function startScreenHelp(): string {
  return (OPEN_WORLD_ROUTE.help ?? []).join(' ');
}

/**
 * Holds that the pop-up for `junction` offered every one of its `ways` as a
 * button before the choice was final. Not on its first frame: the HUD is drawn
 * after the frame it reads, and a U-turn's notice stands in the pop-up's place
 * for its first two seconds (`junction-choice.ts` §`TURN_NOTICE_SECONDS`).
 */
function expectEveryWayOffered(
  frames: readonly RiddenFrame[],
  junction: number,
  ways: number,
): void {
  const shown = promptsFor(frames, junction);
  expect(shown.length, `the junction at ${junction.toFixed(0)} m`).toBeGreaterThan(10);
  expect(shown[0]?.junction?.ways).toHaveLength(ways);
  expect(
    shown
      .filter((frame) => junction - frame.odometer > JUNCTION_LOCK_METRES)
      .some((frame) => frame.offered.length === ways),
    `every way of the junction at ${junction.toFixed(0)} m offered`,
  ).toBe(true);
}

describe('a town of crossroads: a turn at every junction, and after a U-turn the street turned off from — #3124', () => {
  /** Where the U-turn is pressed, in ride metres. */
  let uTurnAt = 0;
  /** The second junction, where the ride turns right. */
  let turnedAt = 0;

  beforeAll(async () => {
    ride = await startOfferedWaysRide(OPEN_WORLD_GRID_STREETS, START_COLUMN, START_ROW);
    // Straight through the first junction, to inside the second's prompt.
    for (let frame = 0; frame < 400 && prompted(ride.frames).length < 2; frame += 1) {
      await ride.ridePumped(1, 500);
    }
    turnedAt = prompted(ride.frames)[1] as number;
    await ride.rideTo(turnedAt - 115);
    await ride.press('ArrowRight');
    // Turned round 200 m down the street turned into, past the lock's 100 m.
    await ride.rideTo(turnedAt + 200);
    uTurnAt = ride.frames.at(-1)?.odometer ?? 0;
    await ride.press('ArrowDown' as 'ArrowUp');
    // Back to the junction and through it.
    await ride.rideTo(uTurnAt + 260);
  });
  afterAll(() => {
    ride?.end();
    ride = undefined;
  });

  it('offers every way at each junction ridden through, before its choice is final', () => {
    const frames = (ride as OfferedWaysRide).frames;
    const [first, second] = prompted(frames);
    if (first === undefined || second === undefined) throw new Error('two junctions not prompted');
    // A fixture block apart, from the start pin.
    expect(first).toBeGreaterThan(225);
    expect(second - first).toBeGreaterThan(225);
    expectEveryWayOffered(frames, first, 3);
    expectEveryWayOffered(frames, second, 3);
    // The prompt appears 250 m before a junction, or as the previous one is passed.
    expect(promptsFor(frames, second)[0]?.odometer).toBeLessThan(first + 12);
    // And the turn pressed was taken.
    const after = promptsFor(frames, second).at(-1)?.junction;
    expect(after?.taken).not.toBe(after?.defaultWay);
  });

  it('offers the street turned off from, both ways, at the junction a U-turn rides back to', () => {
    const frames = (ride as OfferedWaysRide).frames;
    // The first junction prompted after the U-turn: the one turned at, ridden back to.
    const back = prompted(frames.filter((frame) => frame.odometer > uTurnAt))[0];
    if (back === undefined) throw new Error('no junction after the U-turn');
    expect(back - uTurnAt).toBeGreaterThan(190);
    expect(back - uTurnAt).toBeLessThan(215);
    expectEveryWayOffered(frames, back, 3);
    const offered = promptsFor(frames, back).find((frame) => frame.offered.length === 3)?.offered;
    expect(offered?.filter((words) => words.includes('Main Street'))).toHaveLength(2);
    expect(offered?.some((words) => words.startsWith('Left onto Main Street'))).toBe(true);
    expect(offered?.some((words) => words.startsWith('Right onto Main Street'))).toBe(true);
  });
});

describe('the limits kept on purpose: no choice there, and the reason written down — #3124', () => {
  describe('a service road, a private road, a motorway, a footway, a farm track and a street that stops short', () => {
    beforeAll(async () => {
      ride = await startOfferedWaysRide(LIMIT_STREETS, START_COLUMN, START_ROW);
      await ride.rideTo((CONTROL_COLUMN - START_COLUMN) * METRES_PER_PIXEL - 60);
    });
    afterAll(() => {
      ride?.end();
      ride = undefined;
    });

    it('raises no pop-up at any of them, and does at the public crossroads after them', () => {
      const frames = (ride as OfferedWaysRide).frames;
      const control = (CONTROL_COLUMN - START_COLUMN) * METRES_PER_PIXEL;
      // Only the crossroads is ever prompted, and only from 250 m short of it.
      const junctions = prompted(frames);
      expect(junctions).toHaveLength(1);
      expect(Math.abs((junctions[0] as number) - control)).toBeLessThan(10);
      expectEveryWayOffered(frames, junctions[0] as number, 3);
      const before = frames.filter(
        (frame) => frame.odometer < (junctions[0] as number) - JUNCTION_PROMPT_METRES - 10,
      );
      // Ridden past all six, a frame every few metres.
      expect(before.at(-1)?.odometer).toBeGreaterThan(
        (1600 - START_COLUMN) * METRES_PER_PIXEL + 10,
      );
      expect(before.length).toBeGreaterThan(150);
      for (const frame of before) {
        expect(frame.offered, `at ${frame.odometer.toFixed(0)} m`).toStrictEqual([]);
      }
    });

    it('says each of them in the open-world start screen’s help', () => {
      const help = startScreenHelp();
      for (const limit of new Set(LIMITS_ALONG)) {
        expect(help, limit).toContain(TURN_LIMIT_WORDS[limit]);
      }
    });
  });

  describe('a junction 70 m after the last one', () => {
    beforeAll(async () => {
      ride = await startOfferedWaysRide(CLOSE_STREETS, START_COLUMN, START_ROW);
      const second = (CLOSE_COLUMN - START_COLUMN) * METRES_PER_PIXEL;
      await ride.rideTo(second - 40);
      // A turn pressed for it, which the lock refuses.
      await ride.press('ArrowRight');
      await ride.rideTo(second + 20);
    });
    afterAll(() => {
      ride?.end();
      ride = undefined;
    });

    it('is shown locked from the moment it is prompted, its default alone, and a press changes nothing', () => {
      const frames = (ride as OfferedWaysRide).frames;
      const [first, second] = prompted(frames);
      if (first === undefined || second === undefined)
        throw new Error('two junctions not prompted');
      expect(second - first).toBeGreaterThan(65);
      expect(second - first).toBeLessThan(75);
      // The first is offered whole.
      expectEveryWayOffered(frames, first, 3);
      // The second: inside the lock from its first frame, one way shown, never more.
      const shown = promptsFor(frames, second);
      expect(shown.length).toBeGreaterThan(5);
      expect(second - (shown[0] as RiddenFrame).odometer).toBeLessThan(100);
      for (const frame of shown.slice(1)) {
        expect(frame.offered.length, `at ${frame.odometer.toFixed(0)} m`).toBeLessThanOrEqual(1);
      }
      expect(shown.at(-1)?.junction?.taken).toBe(shown.at(-1)?.junction?.defaultWay);
    });

    it('says why in the open-world start screen’s help', () => {
      expect(startScreenHelp()).toContain(TURN_LIMIT_WORDS['too-close']);
    });
  });

  describe('the junction a U-turn 60 m past it rides back to', () => {
    let uTurnAt = 0;
    beforeAll(async () => {
      ride = await startOfferedWaysRide(OPEN_WORLD_GRID_STREETS, START_COLUMN, START_ROW);
      for (let frame = 0; frame < 400 && prompted(ride.frames).length < 2; frame += 1) {
        await ride.ridePumped(1, 500);
      }
      const turnedAt = prompted(ride.frames)[1] as number;
      await ride.rideTo(turnedAt - 115);
      await ride.press('ArrowRight');
      await ride.rideTo(turnedAt + 60);
      uTurnAt = ride.frames.at(-1)?.odometer ?? 0;
      await ride.press('ArrowDown' as 'ArrowUp');
      await ride.rideTo(uTurnAt + 100);
    });
    afterAll(() => {
      ride?.end();
      ride = undefined;
    });

    it('is shown locked, the way straight on alone: the street turned off from is not offered', () => {
      const frames = (ride as OfferedWaysRide).frames;
      const back = prompted(frames.filter((frame) => frame.odometer > uTurnAt))[0];
      if (back === undefined) throw new Error('no junction after the U-turn');
      expect(back - uTurnAt).toBeLessThan(100);
      const shown = promptsFor(frames, back);
      expect(shown.length).toBeGreaterThan(5);
      expect(shown[0]?.junction?.ways).toHaveLength(3);
      for (const frame of shown) {
        expect(frame.offered.length, `at ${frame.odometer.toFixed(0)} m`).toBeLessThanOrEqual(1);
        expect(frame.offered.join(' ')).not.toContain('Main Street');
      }
    });

    it('says why in the open-world start screen’s help', () => {
      expect(startScreenHelp()).toContain(TURN_LIMIT_WORDS['too-close']);
    });
  });
});
