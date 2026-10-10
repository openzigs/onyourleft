// SPDX-License-Identifier: Apache-2.0

/**
 * The heart-rate hold's safety tests (#1239, ADR 0048 D-3), each named for the
 * criterion it answers and each run through the PLAYER — the one writer of a
 * target — rather than against the hold module alone, so what is asserted is
 * what the trainer would be sent.
 *
 * The closed loop against #1238's simulated heart is in `packages/sensors`
 * (`protocol/src/heart-rate-hold.closed-loop.test.ts`), because this package
 * may not depend on that one.
 */

import { describe, expect, it } from 'vitest';

import { beatsPerMinute, revolutionsPerMinute, seconds, watts, type Watts } from '../quantities';

import { RELIEF_SHARE, TREND_WINDOW, type CadenceReading } from './erg-safety';
import {
  HOLD_MAXIMUM_RISE_WATTS,
  HOLD_MAXIMUM_STEP_DOWN_WATTS,
  HOLD_MAXIMUM_STEP_UP_WATTS,
  HOLD_MEAN_SECONDS,
  HOLD_OVERSHOOT_RECOVERY_SECONDS,
  HOLD_OVERSHOOT_SECONDS,
  HOLD_RISE_WINDOW_SECONDS,
  HOLD_SETTLING_SECONDS,
  HOLD_SILENCE_FALLBACK_SECONDS,
  plausibleReadings,
  type HeartRateHoldContext,
  type HeartRateSample,
  type HoldReason,
} from './heart-rate-hold';
import { createWorkoutPlayer, type PlayerState, type WorkoutPlayer } from './player';
import { expandWorkout } from './timeline';
import { thresholdShare, type HeartRateHoldBlock, type ThresholdShare } from './workout';

const THRESHOLD = watts(250);
const OWN: HeartRateHoldContext = {
  thresholdHeartRate: beatsPerMinute(170),
  assumed: { power: false, heartRate: false },
};

const holdBlock = (overrides: Partial<HeartRateHoldBlock> = {}): HeartRateHoldBlock => ({
  kind: 'heart-rate-hold',
  seconds: seconds(3600),
  range: { low: beatsPerMinute(130), high: beatsPerMinute(140) },
  startShare: thresholdShare(0.5),
  ceilingShare: thresholdShare(0.8),
  ...overrides,
});

function holdPlayer(
  options: {
    readonly block?: HeartRateHoldBlock;
    readonly context?: HeartRateHoldContext | undefined;
    readonly threshold?: Watts;
  } = {},
): WorkoutPlayer {
  return createWorkoutPlayer({
    timeline: expandWorkout({ name: 'Hold', blocks: [options.block ?? holdBlock()] }),
    thresholdPower: options.threshold ?? THRESHOLD,
    heartRateHold: 'context' in options ? options.context : OWN,
  });
}

interface Written {
  readonly at: number;
  readonly watts: number;
  readonly hold: HoldReason | undefined;
}

/**
 * Ride `seconds` seconds from `from`, one tick a second, with the heart rate a
 * function of time (`undefined` for a second with no reading), and every write
 * acknowledged as the trainer would. Returns every write.
 */
function ride(
  subject: WorkoutPlayer,
  from: number,
  to: number,
  bpmAt: (second: number) => number | undefined,
  history: HeartRateSample[] = [],
  cadenceAt?: (second: number) => readonly CadenceReading[],
): Written[] {
  const written: Written[] = [];
  for (let second = from; second < to; second += 1) {
    const bpm = bpmAt(second);
    if (bpm !== undefined) {
      history.push({ at: seconds(second), bpm });
    }
    const state: PlayerState = subject.tick(seconds(second), {
      heartRate: history.slice(-40),
      ...(cadenceAt === undefined ? {} : { cadence: cadenceAt(second) }),
    });
    if (state.intent.kind === 'write-target') {
      written.push({ at: second, watts: state.intent.watts, hold: state.intent.hold });
      subject.acknowledge(state.intent.watts);
    }
  }
  return written;
}

/** mulberry32, as `packages/fit/tools/fuzz/random.ts` — seeded, so a failure replays. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 2 ** 32;
  };
}

/** A random heart-rate trace: a wandering heart, with silences, spikes and nonsense. */
function randomTrace(random: () => number): (second: number) => number | undefined {
  let bpm = 80 + random() * 100;
  let silentUntil = -1;
  const trace = new Map<number, number | undefined>();
  return (second) => {
    if (!trace.has(second)) {
      const roll = random();
      if (second < silentUntil) {
        trace.set(second, undefined);
      } else if (roll < 0.01) {
        silentUntil = second + Math.floor(random() * 40);
        trace.set(second, undefined);
      } else if (roll < 0.03) {
        trace.set(second, [0, 255, 300, bpm + 60, bpm - 60][Math.floor(random() * 5)]);
      } else {
        bpm = Math.min(220, Math.max(40, bpm + (random() - 0.5) * 6));
        trace.set(second, Math.round(bpm));
      }
    }
    return trace.get(second);
  };
}

describe('hold never exceeds its ceiling', () => {
  it('over 150 seeded random traces, every target is inside min(ceiling, goal, 0.85) × own threshold and above the floor', () => {
    const random = seeded(1239);
    for (let run = 0; run < 150; run += 1) {
      const threshold = watts(150 + Math.round(random() * 250));
      const ceilingShare = thresholdShare(0.5 + random() * 0.35);
      const goal = random() < 0.5 ? thresholdShare(0.45 + random() * 0.4) : undefined;
      const subject = holdPlayer({
        threshold,
        block: holdBlock({ seconds: seconds(900), ceilingShare, startShare: thresholdShare(0.45) }),
        context: { ...OWN, goalCeiling: goal },
      });
      subject.start(seconds(0));
      const ceiling = Math.floor(threshold * Math.min(ceilingShare, goal ?? 1, 0.85));
      const floor = Math.ceil(threshold * 0.2);
      for (const write of ride(subject, 0, 900, randomTrace(random))) {
        expect(write.watts, `run ${String(run)} at ${String(write.at)} s`).toBeLessThanOrEqual(
          Math.max(ceiling, floor),
        );
        expect(write.watts, `run ${String(run)} at ${String(write.at)} s`).toBeGreaterThanOrEqual(
          floor,
        );
      }
    }
  });

  it('never above the machine’s own maximum, and never below its minimum', () => {
    const subject = createWorkoutPlayer({
      timeline: expandWorkout({ name: 'Hold', blocks: [holdBlock({ seconds: seconds(1200) })] }),
      thresholdPower: THRESHOLD,
      heartRateHold: OWN,
      trainerRange: { minimum: watts(110), maximum: watts(140) },
    });
    subject.start(seconds(0));
    const low = ride(subject, 0, 600, () => 90);
    expect(Math.max(...low.map((write) => write.watts))).toBe(140);
    const high = ride(subject, 600, 1200, () => 145);
    expect(Math.min(...high.map((write) => write.watts))).toBe(110);
  });
});

describe('hold steps are bounded', () => {
  it('over the same traces: up at most 5 W, down at most 10 W, and at most 15 W up in any 60 s', () => {
    const random = seeded(1239);
    for (let run = 0; run < 150; run += 1) {
      const subject = holdPlayer({ block: holdBlock({ seconds: seconds(900) }) });
      subject.start(seconds(0));
      let previous: number | undefined;
      const rises: { at: number; watts: number }[] = [];
      for (const write of ride(subject, 0, 900, randomTrace(random))) {
        const where = `run ${String(run)} at ${String(write.at)} s (${String(write.hold)})`;
        if (previous !== undefined) {
          const step = write.watts - previous;
          // EVERY rise is bounded, whatever the reason. A fall is bounded too,
          // except the two that go straight to a fixed number by rule: H6's
          // floor and H7's start share.
          expect(step, where).toBeLessThanOrEqual(HOLD_MAXIMUM_STEP_UP_WATTS);
          if (write.hold !== 'overshoot' && write.hold !== 'silent') {
            expect(-step, where).toBeLessThanOrEqual(HOLD_MAXIMUM_STEP_DOWN_WATTS);
          }
          if (step > 0) {
            rises.push({ at: write.at, watts: step });
            const inWindow = rises
              .filter((rise) => rise.at > write.at - HOLD_RISE_WINDOW_SECONDS)
              .reduce((sum, rise) => sum + rise.watts, 0);
            expect(inWindow, where).toBeLessThanOrEqual(HOLD_MAXIMUM_RISE_WATTS);
          }
        }
        previous = write.watts;
      }
    }
  });

  it('a heart rate far below the range raises the target 5 W at a time, and no faster than 15 W a minute', () => {
    const subject = holdPlayer();
    subject.start(seconds(0));
    const written = ride(subject, 0, HOLD_SETTLING_SECONDS + 120, () => 100);
    const raised = written.filter((write) => write.hold === 'raised');
    expect(raised.length).toBeGreaterThanOrEqual(6);
    expect(raised.slice(0, 3).map((write) => write.watts)).toEqual([130, 135, 140]);
    // The fourth rise waits until the first has left the 60 s window.
    expect(raised[3]?.at).toBeGreaterThanOrEqual((raised[0]?.at ?? 0) + HOLD_RISE_WINDOW_SECONDS);
  });
});

describe('a dropped heart rate is not a zero', () => {
  it('a stream that stops never raises the target, and after 15 s it is back at the start share', () => {
    const subject = holdPlayer();
    subject.start(seconds(0));
    const history: HeartRateSample[] = [];
    const raised = ride(subject, 0, 300, () => 110, history);
    const top = raised.at(-1)?.watts ?? 0;
    expect(top).toBeGreaterThan(125);

    const silent = ride(subject, 300, 400, () => undefined, history);
    expect(silent.every((write) => write.watts <= top)).toBe(true);
    expect(silent).toHaveLength(1);
    expect(silent[0]).toMatchObject({ watts: 125, hold: 'silent' });
    expect(silent[0]?.at).toBeLessThanOrEqual(300 + HOLD_SILENCE_FALLBACK_SECONDS);
    expect(subject.state().hold).toMatchObject({ reason: 'silent', target: 125 });
  });

  it('a silence after the target was LOWERED leaves it lowered: never up', () => {
    const subject = holdPlayer();
    subject.start(seconds(0));
    const history: HeartRateSample[] = [];
    const lowered = ride(subject, 0, 200, () => 145, history);
    const bottom = lowered.at(-1)?.watts ?? 0;
    expect(bottom).toBeLessThan(125);
    expect(ride(subject, 200, 400, () => undefined, history)).toEqual([]);
    expect(subject.state().hold?.target).toBe(bottom);
  });

  it('readings of 0 and 255 bpm are silence, not a rider far below the range', () => {
    const subject = holdPlayer();
    subject.start(seconds(0));
    const history: HeartRateSample[] = [];
    ride(subject, 0, 300, () => 110, history);
    const nonsense = ride(subject, 300, 400, (second) => (second % 2 === 0 ? 0 : 255), history);
    expect(nonsense).toEqual([{ at: expect.any(Number) as number, watts: 125, hold: 'silent' }]);
  });

  it('H8: a jump of more than 40 bpm inside 2 s is dropped, and judged against the last good reading', () => {
    const kept = plausibleReadings([
      { at: seconds(0), bpm: 120 },
      { at: seconds(1), bpm: 170 },
      { at: seconds(2), bpm: 121 },
      { at: seconds(5), bpm: 165 },
      { at: seconds(6), bpm: 25 },
      { at: seconds(7), bpm: 231 },
    ]);
    expect(kept.map((reading) => reading.bpm)).toEqual([120, 121, 165]);
  });
});

describe('no heart rate strap', () => {
  it('runs the block steady at its start share, saying the hold is ineligible', () => {
    const subject = holdPlayer();
    subject.start(seconds(0));
    const written: Written[] = [];
    for (let second = 0; second < 600; second += 1) {
      const state = subject.tick(seconds(second), { heartRate: undefined });
      if (state.intent.kind === 'write-target') {
        written.push({ at: second, watts: state.intent.watts, hold: state.intent.hold });
        subject.acknowledge(state.intent.watts);
      }
    }
    expect(written).toEqual([{ at: 0, watts: 125, hold: 'ineligible' }]);
    expect(subject.state().hold).toMatchObject({ reason: 'ineligible', target: 125 });
  });
});

describe('assumed thresholds disable the hold', () => {
  const cases: readonly [string, HeartRateHoldContext | undefined][] = [
    ['an assumed threshold power', { ...OWN, assumed: { power: true, heartRate: false } }],
    ['an assumed threshold heart rate', { ...OWN, assumed: { power: false, heartRate: true } }],
    ['no context at all', undefined],
    [
      'a range above the rider’s own threshold heart rate',
      { ...OWN, thresholdHeartRate: beatsPerMinute(139) },
    ],
    [
      'a range above the rider’s "do not go above"',
      { ...OWN, goalHeartRateAbove: beatsPerMinute(138) },
    ],
  ];
  for (const [name, context] of cases) {
    it(`with ${name}, the block is steady at its start share whatever the heart does`, () => {
      const subject = holdPlayer({ context });
      subject.start(seconds(0));
      expect(ride(subject, 0, 600, () => 100)).toEqual([{ at: 0, watts: 125, hold: 'ineligible' }]);
    });
  }
});

describe('the rescue wins', () => {
  const steadyCadence = (second: number): readonly CadenceReading[] => [
    { at: seconds(Math.max(0, second - 1)), cadence: revolutionsPerMinute(85) },
    { at: seconds(second), cadence: revolutionsPerMinute(85) },
  ];

  it('a cadence collapse gives the relief target, freezes the hold, and resumes from the eased target', () => {
    const subject = holdPlayer();
    subject.start(seconds(0));
    const history: HeartRateSample[] = [];
    ride(subject, 0, 300, () => 110, history, steadyCadence);
    const before = subject.state().hold?.target ?? 0;
    expect(before).toBeGreaterThan(125);

    // Cadence collapses: 85 → 60 rpm over the trend window, with the heart rate
    // still far below the range — the hold would RAISE if it were asked.
    const collapse = (second: number): readonly CadenceReading[] => [
      { at: seconds(second - 8), cadence: revolutionsPerMinute(85) },
      { at: seconds(second), cadence: revolutionsPerMinute(45) },
    ];
    const eased = ride(subject, 300, 301, () => 110, history, collapse);
    expect(eased).toEqual([
      { at: 300, watts: Math.round(before * RELIEF_SHARE), hold: expect.any(String) as string },
    ]);

    // While the latch holds: nothing but the relief, however low the heart rate.
    const latched = ride(subject, 301, 301 + TREND_WINDOW - 1, () => 110, history, steadyCadence);
    expect(latched).toEqual([]);

    // Latch cleared: the hold resumes from the EASED target, and climbs from
    // there 5 W at a time — never straight back to where it was.
    const after = ride(subject, 301 + TREND_WINDOW - 1, 400, () => 110, history, steadyCadence);
    expect(after[0]?.watts).toBeLessThanOrEqual(
      Math.round(before * RELIEF_SHARE) + HOLD_MAXIMUM_STEP_UP_WATTS,
    );
    expect(after.every((write) => write.watts < before)).toBe(true);
  });

  it('a stopped rider is released; the rescue steps back up; the hold resumes from what it last wrote', () => {
    const subject = holdPlayer();
    subject.start(seconds(0));
    const history: HeartRateSample[] = [];
    ride(subject, 0, 300, () => 110, history, steadyCadence);
    const before = subject.state().hold?.target ?? 0;
    const stopped = subject.tick(seconds(300), {
      heartRate: history,
      cadence: [
        { at: seconds(296), cadence: revolutionsPerMinute(30) },
        { at: seconds(300), cadence: revolutionsPerMinute(4) },
      ],
    });
    expect(stopped.intent.kind).toBe('release');
    const after = ride(subject, 301 + TREND_WINDOW, 400, () => 110, history, steadyCadence);
    // The rescue's own stepped return first (#441): relief of the target it found.
    expect(after[0]?.watts).toBe(Math.round(before * RELIEF_SHARE));
    // Then the hold, from there, a bounded step at a time, never back to `before`.
    for (const [index, write] of after.entries()) {
      expect(write.watts).toBeLessThan(before);
      if (index > 0) {
        expect(write.watts - (after[index - 1]?.watts ?? 0)).toBeLessThanOrEqual(
          HOLD_MAXIMUM_STEP_UP_WATTS,
        );
      }
    }
  });
});

describe('settling', () => {
  it('makes no heart-rate-driven change in the first 90 s, whatever the heart rate does', () => {
    const subject = holdPlayer();
    subject.start(seconds(0));
    const wild = (second: number): number => (second % 20 < 10 ? 60 : 200);
    const written = ride(subject, 0, HOLD_SETTLING_SECONDS, wild);
    expect(written).toEqual([{ at: 0, watts: 125, hold: 'settling' }]);
    expect(subject.state().hold?.reason).toBe('settling');
  });

  it('settles again after a pause, because the hold keeps no state past one', () => {
    const subject = holdPlayer();
    subject.start(seconds(0));
    const history: HeartRateSample[] = [];
    ride(subject, 0, 200, () => 110, history);
    subject.pause(seconds(200));
    subject.resume(seconds(260));
    const resumed = ride(subject, 260, 260 + HOLD_SETTLING_SECONDS, () => 110, history);
    expect(resumed).toEqual([{ at: 260, watts: 125, hold: 'settling' }]);
  });
});

describe('overshoot', () => {
  it('10 bpm over the top for 30 s gives one floor target, held until 60 s inside the range', () => {
    const subject = holdPlayer();
    subject.start(seconds(0));
    const history: HeartRateSample[] = [];
    ride(subject, 0, 100, () => 135, history);
    const over = ride(subject, 100, 100 + HOLD_OVERSHOOT_SECONDS + 10, () => 151, history);
    // The deadband lowers first (H5). The 5 s mean is over the line from the
    // fifth reading at 151, and 30 s later comes one write straight to the floor.
    const floorWrites = over.filter((write) => write.hold === 'overshoot');
    expect(floorWrites).toEqual([
      { at: 100 + HOLD_MEAN_SECONDS - 1 + HOLD_OVERSHOOT_SECONDS, watts: 50, hold: 'overshoot' },
    ]);

    // Still above the range: held at the floor, nothing written.
    expect(ride(subject, 140, 200, () => 145, history)).toEqual([]);
    // Back inside: still held for 60 s…
    const inside = ride(
      subject,
      200,
      200 + HOLD_OVERSHOOT_RECOVERY_SECONDS - 1,
      () => 135,
      history,
    );
    expect(inside).toEqual([]);
    expect(subject.state().hold?.reason).toBe('overshoot');
    // …then the hold runs again from the floor.
    ride(subject, 200 + HOLD_OVERSHOOT_RECOVERY_SECONDS - 1, 300, () => 135, history);
    expect(subject.state().hold?.reason).not.toBe('overshoot');
  });
});

describe('no new writer', () => {
  it('emits at most one write a tick, and acknowledge and writeFailed behave as for any block', () => {
    const subject = holdPlayer();
    subject.start(seconds(0));
    const first = subject.tick(seconds(0), { heartRate: [] });
    expect(first.intent).toMatchObject({ kind: 'write-target', watts: 125, hold: 'settling' });
    // Pending: nothing more until it is answered.
    expect(subject.tick(seconds(1), { heartRate: [] }).intent.kind).toBe('hold');
    // Refused: the same target again on the next tick.
    subject.writeFailed();
    expect(subject.tick(seconds(2), { heartRate: [] }).intent).toMatchObject({
      kind: 'write-target',
      watts: 125,
    });
    // Acknowledged: not written again while it stands.
    subject.acknowledge(watts(125));
    expect(subject.tick(seconds(3), { heartRate: [] }).intent.kind).toBe('hold');
    expect(subject.state().held).toBe(125);
  });

  it('a steady block after a hold is ridden as before, and the hold status goes', () => {
    const subject = createWorkoutPlayer({
      timeline: expandWorkout({
        name: 'Two',
        blocks: [
          holdBlock({ seconds: seconds(120) }),
          { kind: 'steady', seconds: seconds(60), target: thresholdShare(0.6) },
        ],
      }),
      thresholdPower: THRESHOLD,
      heartRateHold: OWN,
    });
    subject.start(seconds(0));
    const written = ride(subject, 0, 150, () => 110);
    expect(written.at(-1)).toEqual({ at: 120, watts: 150, hold: undefined });
    expect(subject.state().hold).toBeUndefined();
  });
});

describe('review of #1258: writes that do not land, and a pause', () => {
  const tickWith = (
    subject: WorkoutPlayer,
    history: HeartRateSample[],
    second: number,
    bpm: number,
  ): PlayerState => {
    history.push({ at: seconds(second), bpm });
    return subject.tick(seconds(second), { heartRate: history.slice(-40) });
  };

  it('a refused write does not wind the loop up: what finally lands is one bounded step', () => {
    const subject = holdPlayer();
    subject.start(seconds(0));
    const history: HeartRateSample[] = [];
    const before = ride(subject, 0, 100, () => 110, history);
    for (let second = 100; second < 300; second += 1) {
      if (tickWith(subject, history, second, 110).intent.kind === 'write-target') {
        subject.writeFailed();
      }
    }
    let last = before.at(-1)?.watts ?? 125;
    let landedAny = false;
    for (let second = 300; second < 330; second += 1) {
      const state = tickWith(subject, history, second, 110);
      if (state.intent.kind === 'write-target') {
        landedAny = true;
        expect(state.intent.watts - last).toBeLessThanOrEqual(HOLD_MAXIMUM_STEP_UP_WATTS);
        last = state.intent.watts;
        subject.acknowledge(state.intent.watts);
      }
    }
    expect(landedAny).toBe(true);
  });

  it('makes no heart-rate decision while a write is outstanding', () => {
    const subject = holdPlayer();
    subject.start(seconds(0));
    const history: HeartRateSample[] = [];
    ride(subject, 0, 100, () => 110, history);
    let asked: number | undefined;
    for (let second = 100; second < 200; second += 1) {
      const state = tickWith(subject, history, second, 110);
      if (state.intent.kind === 'write-target') {
        asked ??= state.intent.watts;
      }
    }
    expect(subject.state().hold?.target).toBe(asked);
  });

  it('a pause during an overshoot keeps the floor and the latch', () => {
    const subject = holdPlayer();
    subject.start(seconds(0));
    const history: HeartRateSample[] = [];
    ride(subject, 0, 100, () => 135, history);
    ride(subject, 100, 160, () => 160, history);
    expect(subject.state().hold?.reason).toBe('overshoot');
    subject.pause(seconds(160));
    subject.resume(seconds(190));
    const after = ride(subject, 190, 190 + HOLD_SETTLING_SECONDS + 100, () => 160, history);
    expect(after[0]).toEqual({ at: 190, watts: 50, hold: 'overshoot' });
    expect(Math.max(...after.map((write) => write.watts))).toBe(50);
  });
});

describe('a relief never writes below the hold floor — review of #1258', () => {
  it('writes the floor, so the hold resumes from what the rescue wrote', () => {
    const subject = holdPlayer({ block: holdBlock({ startShare: thresholdShare(0.2) }) });
    subject.start(seconds(0));
    const history: HeartRateSample[] = [];
    const falling = (second: number): readonly CadenceReading[] =>
      Array.from({ length: 12 }, (_, i) => ({
        at: seconds(Math.max(0, second - 11 + i)),
        cadence: revolutionsPerMinute(Math.max(30, 90 - (second - 11 + i) * 4)),
      }));
    const written = ride(subject, 0, 30, () => 135, history, falling);
    for (const write of written) {
      expect(write.watts).toBeGreaterThanOrEqual(50);
    }
  });
});

describe('the share a hold reports', () => {
  it('is the share of threshold the target is, so a screen showing a percentage is not lying', () => {
    const subject = holdPlayer();
    subject.start(seconds(0));
    const state = subject.tick(seconds(0), { heartRate: [] });
    expect(state.intent).toMatchObject({ share: 0.5 as ThresholdShare });
  });
});
