// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  botPacerPlan,
  metres,
  metresPerSecond,
  MODEL_PACER_ASK_EVERY_S,
  MODEL_PACER_LATE_S,
  MODEL_PACER_SAY_SHOWN_S,
  PACER_AHEAD_FLOOR_S,
  readModelPacerInput,
  seconds,
  watts,
  type ModelPacerInput,
  type PacerDecisionRecord,
  type PacerDirection,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import type { PacerReply } from '../instance/pacer-port';
import { ALWAYS_SPOKEN, announce, INITIAL_ANNOUNCER, PRIORITY } from './hud/announce';
import { DEFAULT_ANNOUNCEMENTS } from './hud/announce-preference';
import type { TraceSample } from './hud/recent-trace';
import {
  heartRateTrend,
  ModelPacer,
  modelPacerCourse,
  modelPacerInput,
  modelPacerSensorFields,
  powerTrend,
  secondsAtOrAbove,
  UNDIRECTED,
  type ModelPacerLink,
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

const STATE: ModelPacerInput = {
  pacerWPerKg: 2.5,
  plan: 'rolling',
  intent: 'hold',
  secondsInIntent: 0,
  riderGapM: -3,
  riderWPerKg: 2.4,
  riderInDraft: true,
  gradeAheadPct: 1,
  toFinishM: 900,
  rideS: 0,
};

/** One director, ridden frame by frame, with what it applied and logged. */
function ride(link: ModelPacerLink) {
  const records: PacerDecisionRecord[] = [];
  const applied: { direction: PacerDirection; from: number }[] = [];
  const pacer = new ModelPacer(link, (record) => records.push(record));
  const frame = (at: number) =>
    pacer.frame({
      riddenSeconds: at,
      input: (inForce) => ({
        ...STATE,
        plan: inForce.direction.plan,
        intent: inForce.direction.intent,
        rideS: Math.floor(at),
      }),
      direct: (direction, from) => applied.push({ direction, from }),
    });
  return { pacer, records, applied, frame };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const LIFT: PacerReply = {
  kind: 'answer',
  direction: { plan: 'climber', intent: 'lift' },
  say: 'Come with me up this rise.',
};

describe('the AI pacer during a ride — #2712, ADR 0072 D-7', () => {
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

  it('puts an answer in force from the seconds ridden it arrived at, logs it, and shows its line', async () => {
    const { link, asked } = heldLink();
    const { frame, records, applied, pacer } = ride(link);
    frame(10);
    asked[0]?.answer(LIFT);
    await flush();
    const arrived = frame(12.5);
    expect(applied).toEqual([{ direction: { plan: 'climber', intent: 'lift' }, from: 12.5 }]);
    expect(records).toEqual([
      { askedAtS: 10, arrivedAtS: 12.5, outcome: 'applied', plan: 'climber', intent: 'lift' },
    ]);
    expect(pacer.log()).toEqual(records);
    expect(arrived).toEqual({ arrived: LIFT.say, showing: LIFT.say });
    // Said once, shown for its time, then gone.
    expect(frame(13)).toEqual({ showing: LIFT.say });
    expect(frame(12.5 + MODEL_PACER_SAY_SHOWN_S)).toEqual({});
    // The next ask is told the direction in force and since when.
    asked[1]?.answer({ kind: 'failed' });
    expect(asked[1]?.input).toMatchObject({ plan: 'climber', intent: 'lift' });
  });

  it('logs a late answer and never rides it', async () => {
    const { link, asked } = heldLink();
    const { frame, records, applied } = ride(link);
    frame(0);
    asked[0]?.answer(LIFT);
    await flush();
    const late = frame(MODEL_PACER_LATE_S + 0.05);
    expect(applied).toEqual([]);
    expect(late).toEqual({});
    expect(records).toEqual([
      { askedAtS: 0, arrivedAtS: MODEL_PACER_LATE_S + 0.05, outcome: 'late' },
    ]);
  });

  it('logs an invalid and a failed answer and rides on, and stops asking after a refusal', async () => {
    const { link, asked } = heldLink();
    const { frame, records, applied } = ride(link);
    frame(0);
    asked[0]?.answer({ kind: 'invalid' });
    await flush();
    frame(1);
    frame(5);
    asked[1]?.answer({ kind: 'refused' });
    await flush();
    frame(6);
    frame(60);
    expect(asked).toHaveLength(2);
    expect(applied).toEqual([]);
    expect(records.map((each) => each.outcome)).toEqual(['invalid', 'refused']);
  });

  it('treats a link that throws as a failure', async () => {
    const link: ModelPacerLink = {
      startPacerRide: () => Promise.resolve(true),
      decidePacer: () => Promise.reject(new Error('unreachable')),
      endPacerRide: () => Promise.resolve(),
    };
    const { frame, records } = ride(link);
    frame(0);
    await flush();
    frame(1);
    expect(records).toEqual([{ askedAtS: 0, arrivedAtS: 1, outcome: 'failed' }]);
  });

  it('lets the slot go once at the end, and asks nothing after', async () => {
    const { link, asked, calls } = heldLink();
    const { frame, pacer } = ride(link);
    frame(0);
    pacer.end();
    pacer.end();
    expect(calls.end).toBe(1);
    asked[0]?.answer({ kind: 'failed' });
    await flush();
    frame(30);
    expect(asked).toHaveLength(1);
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
      inForce: { direction: UNDIRECTED, since: 40 },
    });
    expect(input).toMatchObject({
      pacerWPerKg: 2.5,
      plan: 'rolling',
      intent: 'hold',
      secondsInIntent: 21,
      riderGapM: -12.3,
      riderWPerKg: 2.4,
      riderInDraft: true,
      rideS: 61,
    });
    expect(input.toFinishM).toBe(profile.loop ? null : Math.round(profile.totalDistance - 252.36));
    expect(readModelPacerInput(input)).toEqual({ ok: true, value: input });
    expect(JSON.stringify(input)).not.toMatch(/latitude|longitude|position/);
  });

  it('says no W/kg with no live power, and no draft without one', () => {
    const input = modelPacerInput({
      state: { ...state, input: { power: watts(0), live: false }, soloDraft: undefined },
      plan: botPacerPlan(2.5),
      profile,
      riderMassKilograms: 75,
      inForce: { direction: UNDIRECTED, since: 0 },
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
      inForce: { direction: UNDIRECTED, since: 40 },
      sensors: { ...NO_SENSORS, power3s: 210, cadenceRpm: 72, heartRateBpm: 148 },
    });
    expect(input).toMatchObject({ rider3sWPerKg: 2.8, cadenceRpm: 72, heartRateBpm: 148 });
    expect(readModelPacerInput(input)).toEqual({ ok: true, value: input });
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
      inForce: { direction: UNDIRECTED, since: 0 },
    });
    const course = input.course;
    nearly(course?.climb?.inM, 800 - 250);
    nearly(course?.climb?.lengthM, 500);
    expect(course?.climb).toMatchObject({ avgPct: 6, maxPct: 6 });
    nearly(course?.descent?.inM, 1_800 - 250);
    expect(course?.descent).toMatchObject({ avgPct: -5, maxPct: -5 });
    expect(course?.lapLeftM).toBeNull();
    nearly(course?.climbLeftM, 30);
    expect(readModelPacerInput(input)).toEqual({ ok: true, value: input });
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

describe('where the rider is, and the floor under the intent — #2777, ADR 0078', () => {
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
      inForce: { direction: UNDIRECTED, since: 0 },
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
      inForce: { direction: UNDIRECTED, since: 0 },
    });
    expect(readModelPacerInput(ahead)).toEqual({ ok: true, value: ahead });
  });

  /** A director whose state at each second ridden is `stateAt`'s. */
  function placedRide(link: ModelPacerLink, stateAt: (at: number) => Partial<ModelPacerInput>) {
    const records: PacerDecisionRecord[] = [];
    const applied: PacerDirection[] = [];
    const pacer = new ModelPacer(link, (record) => records.push(record));
    const frame = (seconds: number) =>
      pacer.frame({
        riddenSeconds: seconds,
        input: (inForce) => ({
          ...STATE,
          plan: inForce.direction.plan,
          intent: inForce.direction.intent,
          rideS: Math.floor(seconds),
          ...stateAt(seconds),
        }),
        direct: (direction) => applied.push(direction),
      });
    return { records, applied, frame };
  }

  const ease = (say: string): PacerReply => ({
    kind: 'answer',
    direction: { plan: 'climber', intent: 'ease' },
    say,
  });

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

  it('tells the model how the gap moved since the last ask, for the rider', async () => {
    const { link, asked } = heldLink();
    const gaps: Record<number, number> = { 0: 0, 5: 4, 10: 4.5, 15: -1 };
    const { frame } = placedRide(link, (seconds) => ({ riderGapM: gaps[seconds] ?? 0 }));
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

  it('rides an ease as hold once the rider has been ahead for the floor’s time, and logs what it rode', async () => {
    const { link, asked } = heldLink();
    const { frame, records, applied } = placedRide(link, (seconds) => ({
      riderGapM: seconds < 20 ? 40 : 5,
      riderPlace: seconds < 20 ? 'ahead' : 'level',
    }));
    const lines = [
      'Stay smooth.',
      'Stay smooth.',
      'I am easing off so you can bridge.',
      'Stay with me up this rise.',
      'Stay smooth.',
    ];
    expect(PACER_AHEAD_FLOOR_S).toBe(10);
    const shown = await rideAsks(frame, asked, [0, 5, 10, 15, 20], (index) =>
      ease(lines[index] ?? ''),
    );
    // Ahead for 0 s and 5 s: the model's ease is ridden. From 10 s: hold.
    // At 20 s the rider is level again, and the run starts over.
    expect(applied.map((each) => each.intent)).toEqual(['ease', 'ease', 'hold', 'hold', 'ease']);
    expect(applied.every((each) => each.plan === 'climber')).toBe(true);
    expect(
      records.map((each) => (each.outcome === 'applied' ? each.intent : each.outcome)),
    ).toEqual(['ease', 'ease', 'hold', 'hold', 'ease']);
    // An easing line is not shown beside the hold it does not describe; another line is.
    expect(shown[2]).toEqual({ showing: 'Stay smooth.' });
    expect(shown[3]).toMatchObject({ arrived: 'Stay with me up this rise.' });
  });

  it('never lifts, and leaves a lift and a hold as the model chose them', async () => {
    const { link, asked } = heldLink();
    const { frame, applied } = placedRide(link, () => ({ riderGapM: 40, riderPlace: 'ahead' }));
    const replies: PacerReply[] = [
      ease(''),
      ease(''),
      { kind: 'answer', direction: { plan: 'even', intent: 'lift' }, say: '' },
      { kind: 'answer', direction: { plan: 'even', intent: 'hold' }, say: '' },
    ];
    await rideAsks(frame, asked, [0, 5, 10, 15], (index) => replies[index] ?? ease(''));
    expect(applied.map((each) => each.intent)).toEqual(['ease', 'ease', 'lift', 'hold']);
  });
});

describe('the model sees its own last lines, so it does not repeat itself — #2760', () => {
  const line = (say: string): PacerReply => ({
    kind: 'answer',
    direction: { plan: 'rolling', intent: 'hold' },
    say,
  });

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
