// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  botPacerPlan,
  metres,
  metresPerSecond,
  MODEL_PACER_ASK_EVERY_S,
  MODEL_PACER_LAPSE_S,
  MODEL_PACER_LATE_S,
  MODEL_PACER_CODE_VERSION,
  MODEL_PACER_SAY_SHOWN_S,
  PACER_START_RAMP_S,
  PACER_WAIT_MOST,
  pacerDirectionAt,
  readModelPacerInput,
  readPacerDecisionRecord,
  seconds,
  watts,
  type ModelPacerInput,
  type PacerDecisionRecord,
  type PacerDirection,
  type PacerTerrain,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import type { PacerReply } from '../instance/pacer-port';
import { ALWAYS_SPOKEN, announce, INITIAL_ANNOUNCER, PRIORITY } from './hud/announce';
import { DEFAULT_ANNOUNCEMENTS } from './hud/announce-preference';
import type { TraceSample } from './hud/recent-trace';
import {
  CADENCE_DRIFT_ASKS,
  cadenceDrift,
  directionPercent,
  GAP_DRIFT_WINDOW_S,
  heartRateTrend,
  ModelPacer,
  modelPacerCourse,
  modelPacerInput,
  modelPacerSensorFields,
  modelPacerTerrain,
  powerTrend,
  secondsAtOrAbove,
  type ModelPacerLink,
  type ModelPacerRide,
  type ModelPacerSensors,
} from './model-pacer';
import { circuitRoute, northRoute, rollingRoute } from './route-fixtures-testing';

/** `length` seconds of trace, each sample from `at(index)`. */
const traceOf = (length: number, at: (index: number) => TraceSample): TraceSample[] =>
  Array.from({ length }, (_, index) => at(index));

const NO_SENSORS: ModelPacerSensors = {
  power3s: undefined,
  trace: [],
  cadenceRpm: undefined,
  heartRateBpm: undefined,
  thresholdPower: undefined,
  thresholdHeartRate: undefined,
};

/** A link whose every decision waits until the test answers it. */
function heldLink() {
  const asked: { input: ModelPacerInput; answer: (reply: PacerReply) => void }[] = [];
  const calls = { start: 0, end: 0 };
  const link: ModelPacerLink = {
    startPacerRide: () => {
      calls.start += 1;
      return Promise.resolve(true);
    },
    decidePacer: (input) =>
      new Promise((resolve) => {
        asked.push({ input, answer: resolve });
      }),
    endPacerRide: () => {
      calls.end += 1;
      return Promise.resolve();
    },
  };
  return { link, asked, calls };
}

/** The ride as the director reads it: the rider 3 m back in the draft, which is level at 10 m/s. */
const SEEN: ModelPacerRide = {
  pacerWPerKg: 2.5,
  riderGapM: -3,
  riderWPerKg: 2.4,
  riderInDraft: true,
  gradeAheadPct: 1,
  toFinishM: 900,
  rideS: 0,
  riderPlace: 'level',
};

/** The rider's speed in every director test: 10 m/s, so a gap in metres is ten times its seconds. */
const SPEED = 10;

/** What a state from `modelPacerInput` lacks, for reading it back as the domain's shape. */
const DECIDED = {
  plan: 'rolling',
  intent: 'hold',
  secondsInIntent: 0,
  reason: 'rider-level',
  byPct: 0,
  starting: false,
} as const;

/** One director, ridden frame by frame, with what it applied and logged. */
function ride(
  link: ModelPacerLink,
  seenAt: (at: number) => Partial<ModelPacerRide> = () => ({}),
  terrainAt: (at: number) => PacerTerrain = () => 'none',
  speedAt: (at: number) => number = () => SPEED,
) {
  const records: PacerDecisionRecord[] = [];
  const applied: { direction: PacerDirection; from: number }[] = [];
  const pacer = new ModelPacer(link, (record) => records.push(record));
  const frame = (at: number) =>
    pacer.frame({
      riddenSeconds: at,
      ride: () => ({
        seen: { ...SEEN, rideS: Math.floor(at), ...seenAt(at) },
        riderSpeed: speedAt(at),
      }),
      terrain: () => terrainAt(at),
      direct: (direction, from) => applied.push({ direction, from }),
    });
  return { pacer, records, applied, frame };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const saying = (say: string): PacerReply => ({ kind: 'answer', say });
const LINE = saying('Come with me up this rise.');
const HOLD: PacerDirection = { plan: 'rolling', intent: 'hold' };

/** Ask at each of `asks`, answer each with `reply(index)` and let it arrive a second later. */
async function rideAsks(
  frame: (seconds: number) => unknown,
  asked: ReturnType<typeof heldLink>['asked'],
  asks: readonly number[],
  reply: (index: number) => PacerReply,
) {
  const shown: unknown[] = [];
  for (const [index, seconds] of asks.entries()) {
    frame(seconds);
    asked.at(-1)?.answer(reply(index));
    await flush();
    shown.push(frame(seconds + 1));
  }
  return shown;
}

describe('the AI pacer during a ride — #2712, ADR 0072 D-7; #2835, ADR 0083', () => {
  it('takes the slot at the start and asks every few seconds of riding, never waiting', async () => {
    const { link, asked, calls } = heldLink();
    const { frame } = ride(link);
    expect(calls.start).toBe(1);
    frame(0);
    expect(asked).toHaveLength(1);
    // Nothing more is asked while one is out, however long it takes.
    frame(MODEL_PACER_ASK_EVERY_S * 3);
    expect(asked).toHaveLength(1);
    asked[0]?.answer({ kind: 'failed' });
    await flush();
    frame(MODEL_PACER_ASK_EVERY_S * 3 + 0.05);
    // The next ask waits out its own interval from the last one.
    frame(MODEL_PACER_ASK_EVERY_S * 3 + 0.1);
    expect(asked).toHaveLength(2);
  });

  it('decides on the device and rides it at once, before the model has said anything', () => {
    const { link, asked } = heldLink();
    const { frame, applied, records } = ride(link, () => ({ riderGapM: -60, riderInDraft: false }));
    frame(70);
    // In force from the ask's own frame: no answer has come back, and none is waited for.
    expect(applied).toEqual([
      { direction: { plan: 'rolling', intent: 'ease', by: 0.1 }, from: 70 },
    ]);
    expect(records).toEqual([]);
    // And the model is told what the pacer is doing and why.
    expect(asked[0]?.input).toMatchObject({
      plan: 'rolling',
      intent: 'ease',
      byPct: 10,
      reason: 'rider-behind',
      starting: false,
      gapS: -6,
      secondsInIntent: 0,
    });
    expect(readModelPacerInput(asked[0]?.input).ok).toBe(true);
  });

  it('logs the decision when its line arrives, with where the rider was and why, and shows the line', async () => {
    const { link, asked } = heldLink();
    const { frame, records, applied, pacer } = ride(link);
    frame(70);
    asked[0]?.answer(LINE);
    await flush();
    const arrived = frame(72.5);
    expect(applied).toEqual([{ direction: HOLD, from: 70 }]);
    expect(records).toEqual([
      {
        askedAtS: 70,
        arrivedAtS: 72.5,
        outcome: 'applied',
        plan: 'rolling',
        intent: 'hold',
        reason: 'rider-level',
        place: 'level',
        gapS: -0.3,
        line: 'shown',
      },
    ]);
    expect(pacer.log()).toEqual(records);
    expect(arrived).toEqual({
      arrived: LINE.kind === 'answer' ? LINE.say : '',
      showing: 'Come with me up this rise.',
    });
    // Said once, shown for its time, then gone.
    expect(frame(73)).toEqual({ showing: 'Come with me up this rise.' });
    expect(frame(72.5 + MODEL_PACER_SAY_SHOWN_S)).toEqual({});
    // The log keeps a word for the line, never the line.
    expect(JSON.stringify(records)).not.toMatch(/rise|Come/);
  });

  it.each([
    ['failed', { kind: 'failed' }, 1, 'failed'],
    ['void', { kind: 'invalid' }, 1, 'invalid'],
    ['late', LINE, MODEL_PACER_LATE_S + 0.05, 'late'],
  ] as const)(
    'a %s answer costs a line, never the pacing',
    async (_what, reply, after, outcome) => {
      const { link, asked } = heldLink();
      // 6 s behind at the ask, and 10 s behind by the next one.
      const { frame, records, applied } = ride(link, (at) => ({
        riderGapM: at > 70 ? -100 : -60,
        riderInDraft: false,
      }));
      frame(70);
      asked[0]?.answer(reply);
      await flush();
      // No line is shown for it.
      expect(frame(70 + after)).toEqual({});
      expect(records[0]).toMatchObject({
        askedAtS: 70,
        outcome,
        line: 'none',
        intent: 'ease',
        by: 0.1,
      });
      // The pacer rode the device's decision all along, and decides again at the next ask.
      expect(applied[0]).toEqual({
        direction: { plan: 'rolling', intent: 'ease', by: 0.1 },
        from: 70,
      });
      frame(80);
      expect(applied).toHaveLength(2);
      expect(applied[1]?.direction).toEqual({
        plan: 'rolling',
        intent: 'ease',
        by: PACER_WAIT_MOST,
      });
    },
  );

  it('treats a link that throws as a failure, and still rides its decision', async () => {
    const { link } = heldLink();
    const throwing: ModelPacerLink = {
      ...link,
      decidePacer: () => Promise.reject(new Error('the wire fell out')),
    };
    const { frame, records, applied } = ride(throwing);
    frame(0);
    await flush();
    frame(1);
    expect(records.map((each) => each.outcome)).toEqual(['failed']);
    expect(applied).toHaveLength(1);
  });

  it('stops deciding and asking after a refusal: the decision in force lapses to #92’s rule', async () => {
    const { link, asked } = heldLink();
    const { frame, records, applied, pacer } = ride(link);
    frame(100);
    asked[0]?.answer({ kind: 'refused' });
    await flush();
    frame(101);
    frame(101 + MODEL_PACER_ASK_EVERY_S * 4);
    expect(asked).toHaveLength(1);
    expect(applied).toHaveLength(1);
    expect(records.map((each) => each.outcome)).toEqual(['refused']);
    expect(pacerDirectionAt(pacer.log(), 100 + MODEL_PACER_LAPSE_S - 0.05)).toEqual(HOLD);
    expect(pacerDirectionAt(pacer.log(), 100 + MODEL_PACER_LAPSE_S)).toBeUndefined();
  });

  it('lets the slot go once at the end, and asks nothing after', async () => {
    const { link, asked, calls } = heldLink();
    const { frame, pacer } = ride(link);
    frame(0);
    asked[0]?.answer({ kind: 'failed' });
    await flush();
    frame(1);
    pacer.end();
    pacer.end();
    expect(calls.end).toBe(1);
    frame(60);
    expect(asked).toHaveLength(1);
  });

  it('writes the record of an ask still out when the ride ends, so the log holds every decision ridden', () => {
    const { link } = heldLink();
    const { frame, records, applied, pacer } = ride(link, () => ({
      riderGapM: 60,
      riderInDraft: false,
    }));
    frame(70);
    expect(records).toEqual([]);
    pacer.end();
    pacer.end();
    expect(records).toEqual([
      {
        askedAtS: 70,
        arrivedAtS: null,
        outcome: 'failed',
        plan: 'rolling',
        intent: 'lift',
        by: 0.05,
        reason: 'rider-ahead',
        place: 'ahead',
        gapS: 6,
        line: 'none',
      },
    ]);
    // What the log replays is what was put in force.
    expect(pacerDirectionAt(pacer.log(), 71)).toEqual(applied[0]?.direction);
  });
});

describe('the pacer state the model is shown — #2712, ADR 0072 D-3', () => {
  const profile = rollingRoute();
  const state = {
    ride: { speed: metresPerSecond(8), distance: metres(240.04) },
    bot: {
      state: { speed: metresPerSecond(8), distance: metres(252.36) },
      distanceOnRoute: metres(252.36),
      grade: 0 as never,
      power: watts(190),
    },
    ridden: seconds(61.95),
    input: { power: watts(180), live: true },
    soloDraft: { k: 0.7, inDraft: true, inDraftMetres: 100, riddenMetres: 240 },
  };

  it('is built from the ride, holds no coordinate, and reads back as the domain’s shape', () => {
    const input = modelPacerInput({
      state,
      plan: botPacerPlan(2.5),
      profile,
      riderMassKilograms: 75,
    });
    // #2835: the state holds no direction; the director decides one and adds it.
    for (const decided of Object.keys(DECIDED)) expect(input).not.toHaveProperty(decided);
    expect(input).toMatchObject({
      pacerWPerKg: 2.5,
      riderGapM: -12.3,
      riderWPerKg: 2.4,
      riderInDraft: true,
      rideS: 61,
    });
    expect(input.toFinishM).toBe(profile.loop ? null : Math.round(profile.totalDistance - 252.36));
    expect(readModelPacerInput({ ...input, ...DECIDED }).ok).toBe(true);
    expect(JSON.stringify(input)).not.toMatch(/latitude|longitude|position/);
  });

  it('says no W/kg with no live power, and no draft without one', () => {
    const input = modelPacerInput({
      state: { ...state, input: { power: watts(0), live: false }, soloDraft: undefined },
      plan: botPacerPlan(2.5),
      profile,
      riderMassKilograms: 75,
    });
    expect(input.riderWPerKg).toBeNull();
    expect(input.riderInDraft).toBe(false);
  });

  it('carries the sensor fields, and reads back as the domain’s shape — #2760', () => {
    const input = modelPacerInput({
      state,
      plan: botPacerPlan(2.5),
      profile,
      riderMassKilograms: 75,
      sensors: { ...NO_SENSORS, power3s: 210, cadenceRpm: 72, heartRateBpm: 148 },
    });
    expect(input).toMatchObject({ rider3sWPerKg: 2.8, cadenceRpm: 72, heartRateBpm: 148 });
    expect(readModelPacerInput({ ...input, ...DECIDED }).ok).toBe(true);
  });
});

describe('the course ahead the model is shown — #2794', () => {
  /** 3 km to a finish: flat, 500 m up at 6 %, flat, 400 m down at 5 %, flat. */
  const finish = northRoute(3_000, (along) =>
    along < 800
      ? 100
      : along < 1_300
        ? 100 + (along - 800) * 0.06
        : along < 1_800
          ? 130
          : along < 2_200
            ? 130 - (along - 1_800) * 0.05
            : 110,
  );
  /** A 1 885 m loop: flat, 400 m up at 6 % from 200 m, 400 m down, flat to the line. */
  const loop = circuitRoute(300, (along) =>
    along < 200
      ? 100
      : along < 600
        ? 100 + (along - 200) * 0.06
        : along < 1_000
          ? 124 - (along - 600) * 0.06
          : 100,
  );
  const nearly = (got: number | undefined, want: number) => {
    expect(got).toBeDefined();
    // The profile's grade is smoothed over 50 m, so a pitch's ends move by a cell or two.
    expect(Math.abs((got as number) - want)).toBeLessThanOrEqual(30);
  };

  it('shows the next climb and descent and the climbing left to the finish, in the state it sends', () => {
    const input = modelPacerInput({
      state: {
        ride: { speed: metresPerSecond(8), distance: metres(240) },
        bot: {
          state: { speed: metresPerSecond(8), distance: metres(250) },
          distanceOnRoute: metres(250),
          grade: 0 as never,
          power: watts(190),
        },
        ridden: seconds(60),
        input: { power: watts(180), live: true },
        soloDraft: undefined,
      },
      plan: botPacerPlan(2.5),
      profile: finish,
      riderMassKilograms: 75,
    });
    const course = input.course;
    nearly(course?.climb?.inM, 800 - 250);
    nearly(course?.climb?.lengthM, 500);
    expect(course?.climb).toMatchObject({ avgPct: 6, maxPct: 6 });
    nearly(course?.descent?.inM, 1_800 - 250);
    expect(course?.descent).toMatchObject({ avgPct: -5, maxPct: -5 });
    expect(course?.lapLeftM).toBeNull();
    nearly(course?.climbLeftM, 30);
    expect(readModelPacerInput({ ...input, ...DECIDED }).ok).toBe(true);
  });

  it('says nothing ahead past the last hill of a route with a finish', () => {
    expect(modelPacerCourse(finish, 2_500)).toEqual({
      climb: null,
      descent: null,
      lapLeftM: null,
      climbLeftM: 0,
    });
  });

  it('on a loop, shows the metres left in the lap, its climbing, and the climb after the line', () => {
    const total = loop.totalDistance as number;
    const course = modelPacerCourse(loop, 1_500);
    expect(course.lapLeftM).toBe(Math.round((total - 1_500) / 10) * 10);
    expect(course.climbLeftM).toBe(0);
    nearly(course.climb?.inM, total - 1_500 + 200);
    // A pacer in its second lap reads the lap it is in.
    expect(modelPacerCourse(loop, total + 1_500)).toEqual(course);
    nearly(modelPacerCourse(loop, 100).climbLeftM, 24);
  });
});

describe('where the rider is, and what the device decides from it — #2777, #2835, ADR 0083', () => {
  const profile = rollingRoute();
  const at = (riderDistance: number, riderSpeed: number) => ({
    ride: { speed: metresPerSecond(riderSpeed), distance: metres(riderDistance) },
    bot: {
      state: { speed: metresPerSecond(8), distance: metres(500) },
      distanceOnRoute: metres(500),
      grade: 0 as never,
      power: watts(190),
    },
    ridden: seconds(120),
    input: { power: watts(180), live: true },
    soloDraft: undefined,
  });
  const placeOf = (riderDistance: number, riderSpeed: number) =>
    modelPacerInput({
      state: at(riderDistance, riderSpeed),
      plan: botPacerPlan(2.5),
      profile,
      riderMassKilograms: 75,
    }).riderPlace;

  it('says where the rider is at their own speed, and nothing at a standstill', () => {
    expect(placeOf(540, 10)).toBe('ahead');
    expect(placeOf(510, 10)).toBe('level');
    expect(placeOf(497, 10)).toBe('level');
    expect(placeOf(460, 10)).toBe('behind');
    expect(placeOf(540, 0)).toBeUndefined();
    const ahead = modelPacerInput({
      state: at(540, 10),
      plan: botPacerPlan(2.5),
      profile,
      riderMassKilograms: 75,
    });
    expect(readModelPacerInput({ ...ahead, ...DECIDED }).ok).toBe(true);
  });

  it('tells the model how the gap moved since the last ask, for the rider', async () => {
    const { link, asked } = heldLink();
    const gaps: Record<number, number> = { 0: 0, 5: 4, 10: 4.5, 15: -1 };
    const { frame } = ride(link, (seconds) => ({ riderGapM: gaps[seconds] ?? 0 }));
    await rideAsks(frame, asked, [0, 5, 10, 15], () => ({ kind: 'failed' }));
    expect(asked.map((each) => each.input.gapTrend)).toEqual([
      undefined,
      'rider-gaining',
      'steady',
      'rider-losing',
    ]);
    expect(asked[0]?.input).not.toHaveProperty('gapTrend');
    for (const each of asked) expect(readModelPacerInput(each.input).ok).toBe(true);
  });

  it('waits more the further back the rider drops, and chases more the further they pull away', async () => {
    const { link, asked } = heldLink();
    const gaps = [-10, -40, -80, -200, 0, 40, 80, 200];
    const asks = gaps.map((_, index) => 70 + index * 5);
    const { frame, applied, records } = ride(link, (at) => ({
      riderGapM: gaps[asks.indexOf(at)] ?? 0,
      riderInDraft: false,
    }));
    await rideAsks(frame, asked, asks, () => ({ kind: 'failed' }));
    expect(applied.map((each) => each.direction)).toEqual([
      HOLD,
      { plan: 'rolling', intent: 'ease', by: 0.05 },
      { plan: 'rolling', intent: 'ease', by: 0.15 },
      { plan: 'rolling', intent: 'ease', by: 0.2 },
      HOLD,
      { plan: 'rolling', intent: 'lift', by: 0.03 },
      { plan: 'rolling', intent: 'lift', by: 0.08 },
      { plan: 'rolling', intent: 'lift', by: 0.1 },
    ]);
    expect(
      records.map((each) => ('reason' in each ? [each.reason, each.place, each.gapS] : [])),
    ).toEqual([
      ['rider-level', 'level', -1],
      ['rider-behind', 'behind', -4],
      ['rider-behind', 'behind', -8],
      ['rider-behind', 'behind', -20],
      ['rider-level', 'level', 0],
      ['rider-ahead', 'ahead', 4],
      ['rider-ahead', 'ahead', 8],
      ['rider-ahead', 'ahead', 20],
    ]);
  });

  it('never eases with the rider ahead, from the very first ask — ADR 0078’s floor, at once', async () => {
    const { link, asked } = heldLink();
    const { frame, applied } = ride(
      link,
      () => ({ riderGapM: 45, riderInDraft: false }),
      // Before a climb, where the terrain rule eases for a rider on the wheel.
      () => 'before-climb',
    );
    await rideAsks(frame, asked, [0, 5, 10], () => saying('I will ease off for you.'));
    expect(applied.map((each) => each.direction.intent)).toEqual(['lift', 'lift', 'lift']);
  });

  it('waits as far as it may for a rider stopped behind it', () => {
    const { link } = heldLink();
    const { frame, applied, records, pacer } = ride(
      link,
      () => ({ riderGapM: -25, riderInDraft: false, riderPlace: undefined }),
      () => 'none',
      () => 0,
    );
    frame(90);
    expect(applied[0]?.direction).toEqual({ plan: 'rolling', intent: 'ease', by: PACER_WAIT_MOST });
    pacer.end();
    expect(records[0]).toMatchObject({ reason: 'rider-stopped' });
    expect(records[0]).not.toHaveProperty('place');
    expect(records[0]).not.toHaveProperty('gapS');
  });

  /** A pacer 300 m before a climb, on a descent, over a top, then on plain road. */
  const TERRAIN_ASKS = [100, 105, 110, 115];
  const terrainOf = (seconds: number): PacerTerrain =>
    (
      ({ 100: 'before-climb', 105: 'descent', 110: 'over-the-top' }) as Record<number, PacerTerrain>
    )[seconds] ?? 'none';

  it('with the rider level, eases before a climb and lifts on a descent and over the top, and logs why', async () => {
    const { link, asked } = heldLink();
    const { frame, applied, records } = ride(link, () => ({}), terrainOf);
    await rideAsks(frame, asked, TERRAIN_ASKS, () => saying(''));
    expect(applied.map((each) => each.direction)).toEqual([
      { plan: 'rolling', intent: 'ease' },
      { plan: 'rolling', intent: 'lift' },
      { plan: 'rolling', intent: 'lift' },
      HOLD,
    ]);
    expect(records.map((each) => ('reason' in each ? each.reason : undefined))).toEqual([
      'before-climb',
      'descent',
      'over-the-top',
      'rider-level',
    ]);
    // The model is told the terrain rule's fixed shares.
    expect(asked.map((each) => each.input.byPct)).toEqual([7, 5, 5, 0]);
    expect(asked.map((each) => each.input.secondsInIntent)).toEqual([0, 0, 5, 0]);
  });

  it('does the same with the rider in the draft, though the gap says behind, and not out of it', () => {
    const inDraft = heldLink();
    const drafting = ride(
      inDraft.link,
      () => ({ riderGapM: -30, riderInDraft: true }),
      () => 'descent',
    );
    drafting.frame(100);
    expect(drafting.applied[0]?.direction).toEqual({ plan: 'rolling', intent: 'lift' });
    const out = heldLink();
    const dropped = ride(
      out.link,
      () => ({ riderGapM: -30, riderInDraft: false }),
      () => 'descent',
    );
    dropped.frame(100);
    expect(dropped.applied[0]?.direction).toEqual({ plan: 'rolling', intent: 'ease', by: 0.03 });
  });

  it.each([
    ['I am going to push on now.', 'against'],
    ['I will ease off so you can get back on.', 'shown'],
    ['Stay smooth on my wheel.', 'shown'],
  ] as const)(
    'with the pacer easing, %j is logged as %s: a line against the intent is hidden, and nothing else changes',
    async (say, line) => {
      const { link, asked } = heldLink();
      const { frame, applied, records } = ride(link, () => ({
        riderGapM: -60,
        riderInDraft: false,
      }));
      frame(100);
      asked[0]?.answer(saying(say));
      await flush();
      const result = frame(101);
      expect(result).toEqual(line === 'shown' ? { arrived: say, showing: say } : {});
      expect(records[0]).toMatchObject({ outcome: 'applied', intent: 'ease', by: 0.1, line });
      expect(applied).toEqual([
        { direction: { plan: 'rolling', intent: 'ease', by: 0.1 }, from: 100 },
      ]);
    },
  );

  it('shows a line once: the same words again are no new line, whatever their case or punctuation', async () => {
    const { link, asked } = heldLink();
    const { frame, records } = ride(link);
    const shown = await rideAsks(frame, asked, [100, 105, 110, 115], (index) =>
      saying(
        ['Nice and steady.', 'nice and steady!', 'Find a lighter gear.', 'Nice and steady.'][
          index
        ] ?? '',
      ),
    );
    expect(shown).toEqual([
      { arrived: 'Nice and steady.', showing: 'Nice and steady.' },
      // Still on the screen from the first time, and not said again.
      { showing: 'Nice and steady.' },
      { arrived: 'Find a lighter gear.', showing: 'Find a lighter gear.' },
      { showing: 'Find a lighter gear.' },
    ]);
    expect(records.map((each) => ('line' in each ? each.line : undefined))).toEqual([
      'shown',
      'repeat',
      'shown',
      'repeat',
    ]);
    // A repeat is not one of the lines said: the model is sent each line once.
    expect(asked.at(-1)?.input.recentLines).toEqual(['Nice and steady.', 'Find a lighter gear.']);
  });

  it('tells the model how long the rider has been where they are, and how the gap drifted over half a minute', async () => {
    const { link, asked } = heldLink();
    // Level for two asks, then behind and dropping 2 m a second.
    const gapAt = (at: number): number => (at < 10 ? 0 : -30 - (at - 10) * 2);
    const { frame } = ride(link, (at) => ({ riderGapM: gapAt(at), riderInDraft: false }));
    const asks = Array.from({ length: 10 }, (_, index) => index * 5);
    await rideAsks(frame, asked, asks, () => ({ kind: 'failed' }));
    expect(asked.map((each) => each.input.placeForS)).toEqual([0, 5, 0, 5, 10, 15, 20, 25, 30, 35]);
    // No drift until a reading at least the window old exists.
    const drifts = asked.map((each) => each.input.gapDriftM);
    expect(drifts.slice(0, GAP_DRIFT_WINDOW_S / 5)).toEqual(
      Array.from({ length: GAP_DRIFT_WINDOW_S / 5 }, () => undefined),
    );
    expect(drifts[6]).toBe(gapAt(30) - gapAt(0));
    expect(drifts[9]).toBe(gapAt(45) - gapAt(15));
    expect(drifts[9]).toBe(-60);
    expect(asked.map((each) => each.input.starting)).toEqual(
      asks.map((at) => at < PACER_START_RAMP_S),
    );
    for (const each of asked) expect(readModelPacerInput(each.input).ok).toBe(true);
  });

  it('tells the model how cadence drifted over the last minute of asks, and nothing with too few', async () => {
    const { link, asked } = heldLink();
    const asks = Array.from({ length: CADENCE_DRIFT_ASKS + 1 }, (_, index) => index * 5);
    const { frame } = ride(link, (at) => ({ cadenceRpm: at < 30 ? 90 : 78 }));
    await rideAsks(frame, asked, asks, () => ({ kind: 'failed' }));
    expect(asked[CADENCE_DRIFT_ASKS - 2]?.input).not.toHaveProperty('cadenceDriftRpm');
    expect(asked[CADENCE_DRIFT_ASKS - 1]?.input.cadenceDriftRpm).toBe(-12);
    expect(
      cadenceDrift(Array.from({ length: CADENCE_DRIFT_ASKS }, () => undefined)),
    ).toBeUndefined();
    expect(
      cadenceDrift([
        ...Array.from({ length: 6 }, () => 80),
        82,
        84,
        undefined,
        86,
        undefined,
        undefined,
      ]),
    ).toBe(4);
    expect(
      cadenceDrift([
        ...Array.from({ length: 6 }, () => 80),
        82,
        84,
        undefined,
        undefined,
        undefined,
        undefined,
      ]),
    ).toBeUndefined();
  });

  it('says how far an intent moves the pacer, in whole percent', () => {
    expect(directionPercent(HOLD)).toBe(0);
    expect(directionPercent({ plan: 'rolling', intent: 'ease' })).toBe(7);
    expect(directionPercent({ plan: 'rolling', intent: 'lift' })).toBe(5);
    expect(directionPercent({ plan: 'rolling', intent: 'ease', by: 0.15 })).toBe(15);
    expect(directionPercent({ plan: 'rolling', intent: 'lift', by: 0.03 })).toBe(3);
  });

  it('replays from its log alone: the decision in force read off the log is what was ridden, start ramp and all', async () => {
    const { link, asked } = heldLink();
    const gaps = [-80, -40, 0, 50, 90];
    const asks = [40, 50, 55, 62, 70];
    const { frame, applied, pacer } = ride(
      link,
      (at) => ({ riderGapM: gaps[asks.indexOf(at)] ?? 0, riderInDraft: false }),
      (at) => (at === 55 ? 'before-climb' : 'none'),
    );
    // Applied, failed, void and refused-free: the outcome of the ask changes nothing ridden.
    const replies: readonly PacerReply[] = [
      saying('Easing so you can get back on.'),
      { kind: 'failed' },
      { kind: 'invalid' },
      saying(''),
      saying('Lifting to come back up to you.'),
    ];
    await rideAsks(frame, asked, asks, (index) => replies[index] ?? { kind: 'failed' });
    expect(MODEL_PACER_CODE_VERSION).toBe(2);
    const stored = JSON.parse(JSON.stringify(pacer.log())) as unknown[];
    const log = stored.map((each) => readPacerDecisionRecord(each) as PacerDecisionRecord);
    expect(log).toHaveLength(asks.length);
    for (const [index, each] of applied.entries()) {
      const until = applied[index + 1]?.from ?? each.from + 3;
      for (let at = each.from; at < until; at += 0.5) {
        // Inside the first minute the log replays the ramp the simulation rides.
        expect(pacerDirectionAt(log, at)).toEqual(
          at < PACER_START_RAMP_S
            ? { ...each.direction, startShare: at / PACER_START_RAMP_S }
            : each.direction,
        );
      }
    }
    expect(applied.map((each) => each.direction.intent)).toEqual([
      'ease',
      'ease',
      'ease',
      'lift',
      'lift',
    ]);
  });

  it('reads the terrain at the pacer, not the rider', () => {
    // Flat to 1 km, then 600 m at 6 %.
    const road = northRoute(2_000, (along) => (along < 1_000 ? 100 : 100 + (along - 1_000) * 0.06));
    const state = (pacerAt: number) => ({
      bot: {
        state: { speed: metresPerSecond(8), distance: metres(pacerAt) },
        distanceOnRoute: metres(pacerAt),
        grade: 0 as never,
        power: watts(190),
      },
    });
    expect(modelPacerTerrain(state(800), road)).toBe('before-climb');
    expect(modelPacerTerrain(state(400), road)).toBe('none');
    expect(modelPacerTerrain({ bot: undefined }, road)).toBe('none');
  });
});

describe('the model sees its own last lines, so it does not repeat itself — #2760', () => {
  const line = (say: string): PacerReply => ({ kind: 'answer', say });

  it('sends none before the first line, then the last three, oldest first, and keeps none in the log', async () => {
    const { link, asked } = heldLink();
    const { frame, pacer } = ride(link);
    const said = [
      'Nice and steady.',
      'Find a lighter gear.',
      '',
      'Stay with me.',
      'Ease a little.',
    ];
    let at = 0;
    frame(at);
    for (const say of said) {
      asked.at(-1)?.answer(line(say));
      await flush();
      at += MODEL_PACER_ASK_EVERY_S;
      frame(at);
    }
    expect(asked[0]?.input).not.toHaveProperty('recentLines');
    expect(asked[1]?.input.recentLines).toEqual(['Nice and steady.']);
    // An empty line says nothing, and is not one of the lines said.
    expect(asked[3]?.input.recentLines).toEqual(['Nice and steady.', 'Find a lighter gear.']);
    expect(asked.at(-1)?.input.recentLines).toEqual([
      'Find a lighter gear.',
      'Stay with me.',
      'Ease a little.',
    ]);
    for (const each of asked) expect(readModelPacerInput(each.input).ok).toBe(true);
    expect(JSON.stringify(pacer.log())).not.toMatch(/gear|steady|Ease/);
  });
});

describe('the rider’s own sensors in the state — #2760', () => {
  it('leaves every sensor out when none is live: nothing is guessed', () => {
    expect(modelPacerSensorFields(NO_SENSORS, 75)).toEqual({});
    const gaps = traceOf(120, () => ({ power: undefined, heartRate: undefined }));
    expect(modelPacerSensorFields({ ...NO_SENSORS, trace: gaps, thresholdPower: 250 }, 75)).toEqual(
      {},
    );
  });

  it('says power, its zone and the stretch above threshold, cadence, heart rate and its zone', () => {
    const trace = traceOf(60, (index) => ({
      power: index < 30 ? 300 : 240,
      heartRate: index < 30 ? 150 : 156,
    }));
    const fields = modelPacerSensorFields(
      {
        power3s: 240,
        trace,
        cadenceRpm: 61.6,
        heartRateBpm: 156.4,
        thresholdPower: 250,
        thresholdHeartRate: 170,
      },
      80,
    );
    expect(fields).toEqual({
      rider3sWPerKg: 3,
      riderMinuteWPerKg: 3.4,
      powerZone: 'Threshold',
      powerTrend: 'fading',
      // #2835: the same half-minutes as numbers: 300 W to 240 W, and 150 to 156 bpm.
      powerDriftPct: -20,
      heartRateDriftBpm: 6,
      aboveThresholdS: 0,
      cadenceRpm: 62,
      heartRateBpm: 156,
      // 156 of 170 is 92 %: tempo, 90 % to 94 %.
      heartRateZone: 'Tempo',
      heartRateTrend: 'rising',
    });
  });

  it('sends no minute average or trend once its sensor has dropped, though the trace still holds it', () => {
    const trace = traceOf(60, (index) => ({
      power: index < 30 ? 300 : 240,
      heartRate: index < 30 ? 150 : 156,
    }));
    const live = modelPacerSensorFields(
      { ...NO_SENSORS, power3s: 240, heartRateBpm: 156, trace },
      80,
    );
    expect(live).toHaveProperty('riderMinuteWPerKg');
    expect(live).toHaveProperty('powerTrend');
    expect(live).toHaveProperty('heartRateTrend');
    // Power dropped out, heart rate still reads.
    const noPower = modelPacerSensorFields({ ...NO_SENSORS, heartRateBpm: 156, trace }, 80);
    expect(noPower).not.toHaveProperty('riderMinuteWPerKg');
    expect(noPower).not.toHaveProperty('powerTrend');
    expect(noPower).toHaveProperty('heartRateTrend');
    // Heart rate dropped out, power still reads.
    const noHeart = modelPacerSensorFields({ ...NO_SENSORS, power3s: 240, trace }, 80);
    expect(noHeart).not.toHaveProperty('heartRateTrend');
    expect(noHeart).toHaveProperty('powerTrend');
  });

  it('leaves out a zone with no threshold set, and a reading out of range rather than clamping it', () => {
    const fields = modelPacerSensorFields(
      { ...NO_SENSORS, power3s: 200, cadenceRpm: 400, heartRateBpm: 5 },
      75,
    );
    expect(fields).toEqual({ rider3sWPerKg: 2.7 });
  });

  it('leaves out W/kg with no rider mass', () => {
    expect(modelPacerSensorFields({ ...NO_SENSORS, power3s: 200 }, 0)).toEqual({});
  });

  it('reads a trend only from a full minute with enough live seconds in each half', () => {
    const steady = traceOf(60, () => ({ power: 200, heartRate: 140 }));
    expect(powerTrend(steady)).toBe('steady');
    expect(heartRateTrend(steady)).toBe('steady');
    expect(powerTrend(steady.slice(1))).toBeUndefined();
    const rising = traceOf(60, (index) => ({
      power: index < 30 ? 200 : 211,
      heartRate: index < 30 ? 140 : 137,
    }));
    expect(powerTrend(rising)).toBe('rising');
    expect(heartRateTrend(rising)).toBe('falling');
    // Within 5 % and under 3 bpm is steady.
    const near = traceOf(60, (index) => ({
      power: index < 30 ? 200 : 209,
      heartRate: index < 30 ? 140 : 142,
    }));
    expect(powerTrend(near)).toBe('steady');
    expect(heartRateTrend(near)).toBe('steady');
    // A half with too few live seconds says nothing.
    const thin = traceOf(60, (index) => ({
      power: index < 30 && index % 4 !== 0 ? undefined : 200,
      heartRate: undefined,
    }));
    expect(powerTrend(thin)).toBeUndefined();
    expect(heartRateTrend(thin)).toBeUndefined();
  });

  it('counts the unbroken seconds at or above threshold, newest back, a gap ending it', () => {
    const trace = traceOf(10, (index) => ({
      power: [260, 200, undefined, 250, 270, 280, 300, 251, 255, 262][index],
      heartRate: undefined,
    }));
    expect(secondsAtOrAbove(trace, 250)).toBe(7);
    expect(secondsAtOrAbove(trace, 256)).toBe(1);
    expect(secondsAtOrAbove([], 250)).toBe(0);
    // A dropped second is not a second above threshold, and the stretch before it does not count.
    const dropped = [300, undefined, 260, 270].map((power) => ({ power, heartRate: undefined }));
    expect(secondsAtOrAbove(dropped, 250)).toBe(2);
  });
});

describe('the AI pacer’s line is spoken only with announcements on — #2712, the issue', () => {
  const said = (enabled: boolean) =>
    announce(INITIAL_ANNOUNCER, {
      now: 10,
      readings: [],
      events: [{ kind: 'pacer-say', text: 'Come with me up this rise.' }],
      preference: { ...DEFAULT_ANNOUNCEMENTS, enabled, powerEverySeconds: 'never' },
    }).sentence;

  it('says the line with announcements on, and nothing with them off', () => {
    expect(said(true)).toBe('Come with me up this rise.');
    expect(said(false)).toBeUndefined();
  });

  it('is the lowest event: any other event in the window wins', () => {
    expect(PRIORITY.indexOf('pacer-say')).toBe(PRIORITY.indexOf('lap-race-place') + 1);
    expect(PRIORITY.indexOf('pacer-say')).toBeLessThan(PRIORITY.indexOf('power-off-target'));
    expect(ALWAYS_SPOKEN).not.toContain('pacer-say');
  });
});
