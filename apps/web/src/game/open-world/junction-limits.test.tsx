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
 *   street, raise no pop-up at all, while a public crossroads after them does.
 *
 * #3129, the owner's rulings of 2026-11-24 on #3124's questions (ADR 0088's
 * amendment of that date):
 *
 * - **A town of blocks 60 to 90 m long** offers every way of every junction
 *   before its choice is final: while the next junction's choice is final,
 *   the pop-up is for the first junction after it whose choice is not, and
 *   says which junction ahead it is ("At the 2nd junction"). Each junction's
 *   lock is still said once, with the way taken, as the pop-up moves on from
 *   it (ADR 0088 D-3, from the review of #3130).
 * - **A U-turn 60 m past the junction turned at** rides back onto the street
 *   the rider came along: the way back is that junction's default, set by
 *   the U-turn, since the junction is inside its lock from then on.
 * - **A junction locked on the first frame it is prompted** says "Too close
 *   to the last junction to choose" in place of "Choice locked"; a junction
 *   offered first, then locked, says only "Choice locked".
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  distanceBetween,
  geographicPosition,
  JUNCTION_LOCK_METRES,
  positionAt,
} from '@onyourleft/domain';

import type { GraphFixtureStreet } from '@onyourleft/map-features/testing';

import { OPEN_WORLD_ROUTE } from '../../shell/routes';
import { ANNOUNCEMENTS_STORAGE_KEY, DEFAULT_ANNOUNCEMENTS } from '../hud/announce-preference';
import { JUNCTION_LOCKED_LINE, JUNCTION_TOO_CLOSE_LINE } from '../hud/junction-text';
import type { SceneInput } from '../scene';
import {
  fixturePosition,
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

/** Every sentence the game screen's announcer said, in turn, repeats included. */
const { heard } = vi.hoisted(() => ({ heard: [] as string[] }));

vi.mock('../hud/announce', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hud/announce')>();
  return {
    ...actual,
    announce: (...args: Parameters<typeof actual.announce>) => {
      const said = actual.announce(...args);
      if (said.sentence !== undefined) heard.push(said.sentence);
      return said;
    },
  };
});

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

/** A public street across Main street, north to south, at `column`. */
function across(column: number): GraphFixtureStreet {
  return {
    tags: { kind: 'minor_road', kind_detail: 'residential' },
    line: [
      [column, 300],
      [column, SOUTH_ROW],
    ],
  };
}

/**
 * #3129: the columns of a town of blocks 60 to 90 m long (260 to 380 pixels),
 * after a first block of about 260 m from the start, so the first junction is
 * prompted whole.
 */
const DENSE_TOWN_COLUMNS: readonly number[] = [-1900, -1640, -1340, -1000, -620, -340, -20];

/** #3129: Main street, crossed by a public street at each of {@link DENSE_TOWN_COLUMNS}. */
const DENSE_TOWN_STREETS: readonly GraphFixtureStreet[] = [MAIN, ...DENSE_TOWN_COLUMNS.map(across)];

/** The column of {@link NEAR_START_STREETS}' second crossroads: about 330 m from the start. */
const FAR_COLUMN_NEAR_START = -1600;

/** Where the junction across {@link DENSE_TOWN_COLUMNS}' `index`th column is, in ride metres. */
function denseAt(index: number): number {
  return ((DENSE_TOWN_COLUMNS[index] as number) - START_COLUMN) * METRES_PER_PIXEL;
}

/**
 * #3129: a crossroads 300 pixels (about 70 m) from the start, so its choice is
 * final on the ride's first frame, and a second about 260 m after it.
 */
const NEAR_START_STREETS: readonly GraphFixtureStreet[] = [
  MAIN,
  across(START_COLUMN + 300),
  across(FAR_COLUMN_NEAR_START),
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
    await ride.press('ArrowDown');
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

describe('a town of blocks 60 to 90 m long: every junction offered before its lock, the pop-up saying which — #3129', () => {
  beforeAll(async () => {
    // Every junction sentence is said in the HUD's one region (#2898).
    localStorage.setItem(
      ANNOUNCEMENTS_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_ANNOUNCEMENTS, enabled: true }),
    );
    heard.length = 0;
    ride = await startOfferedWaysRide(DENSE_TOWN_STREETS, START_COLUMN, START_ROW);
    await ride.rideTo(denseAt(DENSE_TOWN_COLUMNS.length - 1) + 10);
  });
  afterAll(() => {
    ride?.end();
    ride = undefined;
    localStorage.clear();
  });

  it('says each junction’s lock once, with the way taken, though the pop-up has moved on from it', () => {
    // ADR 0088 D-3, as amended on 2026-11-24: the pop-up moves on to the next
    // junction as each choice becomes final, so the lock is said at the front
    // of that junction's first sentence. The last junction has none after it,
    // and the pop-up stays on it, saying its lock as before.
    const locks = heard.filter((sentence) => / locked: /.test(sentence));
    const ahead =
      'left, straight on along Main Street or right. The default is straight on along Main Street.';
    expect(locks).toEqual([
      // The 1st junction locks while it is the next one.
      `Junction choice locked: straight on along Main Street. At the 2nd junction: ${ahead}`,
      // Each after it locks while the junction before it is still ahead.
      ...DENSE_TOWN_COLUMNS.slice(2).map(
        () =>
          'Choice at the 2nd junction locked: straight on along Main Street. ' +
          `At the 3rd junction: ${ahead}`,
      ),
      // The last, with none after it: the pop-up stays on it.
      'Junction choice locked: straight on along Main Street.',
    ]);
  });

  it('offers every way of every junction before its choice is final', () => {
    const frames = (ride as OfferedWaysRide).frames;
    const junctions = prompted(frames);
    expect(junctions).toHaveLength(DENSE_TOWN_COLUMNS.length);
    for (const [index, junction] of junctions.entries()) {
      expect(Math.abs(junction - denseAt(index)), `junction ${index + 1}`).toBeLessThan(10);
      expectEveryWayOffered(frames, junction, 3);
    }
  });

  it('says which junction the pop-up is for while it is not the next one', () => {
    const frames = (ride as OfferedWaysRide).frames;
    const junctions = prompted(frames);
    for (const junction of junctions.slice(1)) {
      // Offered while the junction before it is still ahead, its choice final.
      const early = promptsFor(frames, junction).filter(
        (frame) =>
          frame.next !== undefined && frame.next.distance < junction && frame.offered.length === 3,
      );
      expect(early.length, `the junction at ${junction.toFixed(0)} m`).toBeGreaterThan(3);
      expect(early.map((frame) => frame.title)).toContain('At the 2nd junction');
    }
    // And the next junction is the junction ahead.
    expect(promptsFor(frames, junctions[0] as number).map((frame) => frame.title)).toContain(
      'Junction ahead',
    );
  });
});

describe('a U-turn 60 m past the junction turned at rides back onto the street came along — #3129', () => {
  let uTurnAt = 0;
  let back = 0;
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
    await ride.press('ArrowDown');
    // The turn is on the next 10 m sample, so the junction is up to 20 m further.
    await ride.rideTo(turnedAt + (uTurnAt - turnedAt) * 2 + 120);
    back = prompted(ride.frames.filter((frame) => frame.odometer > uTurnAt))[0] ?? 0;
  });
  afterAll(() => {
    ride?.end();
    ride = undefined;
  });

  it('rides west along Main street past the junction, undoing the turn', () => {
    const frames = (ride as OfferedWaysRide).frames;
    const last = frames.at(-1) as RiddenFrame;
    // Read off the road the scene was handed, as the game draws the rider.
    const origin = last.odometer - (last.input.state.ride.distance as number);
    const at = (ride: number) => positionAt(last.input.profile, ride - origin);
    const junction = at(back);
    const main = fixturePosition(0, MAIN_STREET_ROW).latitude;
    for (const past of [40, 100]) {
      const here = at(back + past);
      // On Main street's line, and that far west of the junction.
      expect(distanceBetween(geographicPosition(main, here.longitude), here)).toBeLessThan(1);
      expect(here.longitude).toBeLessThan(junction.longitude);
      expect(distanceBetween(junction, here)).toBeGreaterThan(past - 5);
    }
  });

  it('shows the way back onto Main street as the junction’s way, with no choice made inside its lock', () => {
    const frames = (ride as OfferedWaysRide).frames;
    const shown = promptsFor(frames, back);
    expect(shown.length).toBeGreaterThan(5);
    // The junction turned at, ridden back to: inside its lock from the U-turn on.
    expect(back - uTurnAt).toBeLessThanOrEqual(JUNCTION_LOCK_METRES);
    const junction = (shown.at(-1) as RiddenFrame).junction;
    const taken = junction?.ways.find((way) => way.edge.id === junction.taken);
    expect(taken?.edge.name).toBe('Main Street');
    expect(junction?.taken).toBe(junction?.defaultWay);
    for (const frame of shown) {
      // Locked from the U-turn on: the way back alone, when the pop-up shows.
      expect(frame.offered.length, `at ${frame.odometer.toFixed(0)} m`).toBeLessThanOrEqual(1);
      for (const words of frame.offered) expect(words).toContain('onto Main Street');
    }
    // Once the U-turn's notice has gone, the pop-up shows it.
    expect(shown.some((frame) => frame.offered[0]?.startsWith('Left onto Main Street'))).toBe(true);
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

  describe('a junction locked on the first frame it is prompted, and one that is not — #3129', () => {
    beforeAll(async () => {
      ride = await startOfferedWaysRide(NEAR_START_STREETS, START_COLUMN, START_ROW);
      await ride.rideTo((FAR_COLUMN_NEAR_START - START_COLUMN) * METRES_PER_PIXEL - 60);
    });
    afterAll(() => {
      ride?.end();
      ride = undefined;
    });

    it('says the first was too close to choose, in place of Choice locked, and the second only that its choice is locked', () => {
      const frames = (ride as OfferedWaysRide).frames;
      const [near, far] = prompted(frames);
      if (near === undefined || far === undefined) throw new Error('two junctions not prompted');
      // The first is inside the lock from the ride's first frame: never offered.
      const nearShown = promptsFor(frames, near).filter((frame) => frame.lockLine !== undefined);
      expect(nearShown.length).toBeGreaterThan(0);
      for (const frame of nearShown) {
        expect(frame.lockLine, `at ${frame.odometer.toFixed(0)} m`).toBe(JUNCTION_TOO_CLOSE_LINE);
      }
      // The second is offered, then locked: said so, and never too close.
      expectEveryWayOffered(frames, far, 3);
      const farLocked = promptsFor(frames, far).filter(
        (frame) => far - frame.odometer < JUNCTION_LOCK_METRES - 10 && frame.lockLine !== undefined,
      );
      expect(farLocked.length).toBeGreaterThan(0);
      for (const frame of farLocked) {
        expect(frame.lockLine, `at ${frame.odometer.toFixed(0)} m`).toBe(JUNCTION_LOCKED_LINE);
      }
      expect(frames.map((frame) => frame.lockLine)).toContain(JUNCTION_TOO_CLOSE_LINE);
    });

    it('says the 100 m rule, as rulings 1 and 2 of #3129 left it, in the open-world start screen’s help', () => {
      const help = startScreenHelp();
      expect(help).toContain(TURN_LIMIT_WORDS['too-close']);
      expect(help).toContain('says which junction it is for');
      expect(help).toContain('back onto the street you came along');
    });
  });
});
