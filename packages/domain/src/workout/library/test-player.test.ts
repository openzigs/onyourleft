// SPDX-License-Identifier: Apache-2.0

/**
 * The threshold-test player, against a simulated rider — #2303.
 *
 * ⚠️ The #44 simulator is `packages/sensors`, which this package cannot
 * import, so — as `erg-safety.test.ts` does — the rider here is the cadence a
 * person produces against a load: steady while the trainer holds what their
 * legs can, collapsing when it holds more, and spinning back up once it lets
 * go. The spinning back up is what matters: a rider who stays stopped is never
 * asked for anything, by any player, and a test of that could not fail.
 */

import { describe, expect, it } from 'vitest';

import { estimateThreshold } from '../../analysis/threshold-estimate';
import { revolutionsPerMinute, seconds, watts, type Watts } from '../../quantities';
import type { CadenceReading } from '../erg-safety';
import { WorkoutError } from '../errors';
import type { PlayerIntent } from '../player';

import {
  RAMP_MAXIMUM_SHARE,
  RAMP_TEST,
  THRESHOLD_TESTS,
  TWENTY_MINUTE_TEST,
  type ThresholdTest,
} from './test';
import {
  createThresholdTestPlayer,
  TEST_OVER_REASON,
  type ThresholdTestPlayer,
  type ThresholdTestState,
} from './test-player';

const THRESHOLD = watts(250);
/** What the caller writes for a `release`: the machine's own lowest target. */
const FLOOR = 25;
const RAMP_EFFORT_STARTS = 480;
const RAMP_WRITTEN_END = 480 + 24 * 60;

interface Rider {
  /** The most the rider's legs can turn against, in watts. */
  readonly capacity: number;
  /** Cadence lost a second while the load is more than {@link capacity}. */
  readonly collapse?: number;
  /** The rider's *I'm done*, at this second. */
  readonly doneAt?: number;
  /** A collapse forced over these seconds, whatever the load: a rider who stops dead. */
  readonly stopDead?: { readonly from: number; readonly to: number };
}

interface Ride {
  readonly writes: readonly { readonly at: number; readonly watts: number }[];
  readonly intents: readonly { readonly at: number; readonly intent: PlayerIntent }[];
  readonly final: ThresholdTestState;
  /** 1 Hz power as the rider made it: the load, up to their capacity, while pedalling. */
  readonly power: readonly Watts[];
  /** The tick on which the effort ended early, if it did. */
  readonly endedAt: number | undefined;
}

/** Ride `test` to its end, one tick a second, with a simulated rider. */
function ride(test: ThresholdTest, rider: Rider, player = playerFor(test)): Ride {
  const writes: { at: number; watts: number }[] = [];
  const intents: { at: number; intent: PlayerIntent }[] = [];
  const power: Watts[] = [];
  let history: CadenceReading[] = [];
  let cadence = 90;
  let held = FLOOR;
  let endedAt: number | undefined;
  player.start(seconds(0));
  let state = player.state();
  for (let at = 0; at < 4000 && state.status !== 'finished'; at += 1) {
    const dead =
      rider.stopDead !== undefined && at >= rider.stopDead.from && at < rider.stopDead.to;
    cadence = dead
      ? 5
      : held > rider.capacity
        ? Math.max(0, cadence - (rider.collapse ?? 6))
        : Math.min(90, cadence + 10);
    power.push(watts(cadence > 0 ? Math.min(held, rider.capacity) : 0));
    history = [...history.filter((reading) => reading.at > at - 30), reading(at, cadence)];
    state =
      rider.doneAt === at
        ? player.done(seconds(at))
        : player.tick(seconds(at), { cadence: history });
    if (endedAt === undefined && state.test.endedBy !== undefined) {
      endedAt = at;
    }
    intents.push({ at, intent: state.intent });
    if (state.intent.kind === 'write-target') {
      writes.push({ at, watts: state.intent.watts });
      held = state.intent.watts;
      state = player.acknowledge(state.intent.watts);
    } else if (state.intent.kind === 'release') {
      held = FLOOR;
    }
  }
  return { writes, intents, final: state, power, endedAt };
}

const playerFor = (test: ThresholdTest): ThresholdTestPlayer =>
  createThresholdTestPlayer({ test, thresholdPower: THRESHOLD });

const reading = (at: number, cadence: number): CadenceReading => ({
  at: seconds(at),
  cadence: revolutionsPerMinute(cadence),
});

describe('a rider who fails the ramp is released, and never asked for more', () => {
  it('ends the ramp on the stall rescue’s first verdict, and writes nothing higher after it', () => {
    // Holds 300 W, not 315: the 12th step (at 1140 s) is the one they fail.
    const run = ride(RAMP_TEST, { capacity: 300 });

    expect(run.endedAt).toBeDefined();
    const endedAt = run.endedAt ?? Infinity;
    expect(run.final.test).toEqual({
      effortStartsAt: RAMP_EFFORT_STARTS,
      effortEndsAt: endedAt,
      endedBy: 'stalled',
    });
    // The step they stalled in: the last target written before the end.
    const stalledStep = Math.max(...run.writes.filter((w) => w.at < endedAt).map((w) => w.watts));
    expect(stalledStep).toBe(315);
    // The end itself is the release, through the player's own release path.
    expect(run.intents.find((entry) => entry.at === endedAt)?.intent).toEqual({
      kind: 'release',
      reason: TEST_OVER_REASON,
    });
    // ⚠️ The whole point: no target above the stalled step afterwards. The
    // rider spun back up against the released trainer, and a player that went
    // on with the ramp would have handed them the next step in full.
    const after = run.writes.filter((w) => w.at >= endedAt);
    expect(after.filter((w) => w.watts > stalledStep)).toEqual([]);
    // And the ride then runs the cool-down's length from the end, and stops.
    expect(run.final.status).toBe('finished');
    expect(run.final.elapsed).toBe(endedAt + 600);
  });

  it('ends it the same way for a rider who stops dead, whose first verdict is the floor', () => {
    const run = ride(RAMP_TEST, { capacity: 1000, stopDead: { from: 900, to: 906 } });
    expect(run.final.test.endedBy).toBe('stalled');
    const endedAt = run.endedAt ?? Infinity;
    expect(endedAt).toBeGreaterThanOrEqual(900);
    expect(endedAt).toBeLessThan(910);
    const stalledStep = Math.max(...run.writes.filter((w) => w.at < endedAt).map((w) => w.watts));
    expect(run.writes.filter((w) => w.at >= endedAt && w.watts > stalledStep)).toEqual([]);
    expect(run.intents.find((entry) => entry.at === endedAt)?.intent.kind).toBe('release');
  });

  it('gives the estimate of the test as it was ridden: 0.75 × the best minute', () => {
    const run = ride(RAMP_TEST, { capacity: 300 });
    const estimate = estimateThreshold('ramp', {
      power: run.power,
      effortStartsAt: run.final.test.effortStartsAt,
      effortEndsAt: run.final.test.effortEndsAt,
    });
    expect(estimate).toMatchObject({ kind: 'estimate', basis: 300, thresholdPower: 225 });
  });
});

describe('a rider who never fails the ramp', () => {
  it('rides every step to the cap, and is released into the cool-down', () => {
    const run = ride(RAMP_TEST, { capacity: 10_000 });
    expect(run.final.test).toEqual({
      effortStartsAt: RAMP_EFFORT_STARTS,
      effortEndsAt: RAMP_WRITTEN_END,
      endedBy: undefined,
    });
    const top = Math.max(...run.writes.map((w) => w.watts));
    expect(top).toBe(Math.round(1.98 * THRESHOLD));
    expect(top).toBeLessThanOrEqual(RAMP_MAXIMUM_SHARE * THRESHOLD);
    expect(run.writes.filter((w) => w.at >= RAMP_WRITTEN_END)).toEqual([]);
    expect(run.intents.find((entry) => entry.at === RAMP_WRITTEN_END)?.intent.kind).toBe('release');
    expect(run.final.elapsed).toBe(RAMP_WRITTEN_END + 600);
  });
});

describe('the rider’s I’m done', () => {
  it('ends the ramp where it is pressed and releases the trainer', () => {
    const run = ride(RAMP_TEST, { capacity: 10_000, doneAt: 700 });
    expect(run.final.test).toEqual({
      effortStartsAt: RAMP_EFFORT_STARTS,
      effortEndsAt: 700,
      endedBy: 'done',
    });
    expect(run.intents.find((entry) => entry.at === 700)?.intent).toEqual({
      kind: 'release',
      reason: TEST_OVER_REASON,
    });
    expect(run.writes.filter((w) => w.at >= 700)).toEqual([]);
    expect(run.final.elapsed).toBe(1300);
  });

  it('in the warm-up, ends the test before its effort, so the estimate is refused', () => {
    const run = ride(RAMP_TEST, { capacity: 10_000, doneAt: 300 });
    expect(run.final.test).toMatchObject({ effortEndsAt: 300, endedBy: 'done' });
    expect(
      estimateThreshold('ramp', {
        power: run.power,
        effortStartsAt: run.final.test.effortStartsAt,
        effortEndsAt: run.final.test.effortEndsAt,
      }),
    ).toMatchObject({ kind: 'refused' });
  });

  it('ends the 20-minute effort and rides the cool-down in ERG, from where it was pressed', () => {
    const player = playerFor(TWENTY_MINUTE_TEST);
    const effortStartsAt = 600 + 360 + 300;
    const run = ride(
      TWENTY_MINUTE_TEST,
      { capacity: 10_000, doneAt: effortStartsAt + 600 },
      player,
    );
    expect(run.final.test).toEqual({
      effortStartsAt,
      effortEndsAt: effortStartsAt + 600,
      endedBy: 'done',
    });
    // The cool-down's own ramp, 0.6 of threshold down to 0.45, from the press.
    const coolDown = run.writes.filter((w) => w.at >= effortStartsAt + 600);
    expect(coolDown[0]).toEqual({ at: effortStartsAt + 600, watts: 150 });
    expect(Math.max(...coolDown.map((w) => w.watts))).toBe(150);
    expect(run.final.elapsed).toBe(effortStartsAt + 600 + 600);
  });

  it('is nothing once the effort has run its course, or before the test has started', () => {
    const idle = playerFor(RAMP_TEST);
    expect(idle.done(seconds(10)).test.endedBy).toBeUndefined();
    expect(idle.state().status).toBe('idle');

    const player = playerFor(RAMP_TEST);
    player.start(seconds(0));
    player.tick(seconds(RAMP_WRITTEN_END + 10));
    const state = player.done(seconds(RAMP_WRITTEN_END + 11));
    expect(state.test.endedBy).toBeUndefined();
    expect(state.status).toBe('running');
  });

  it('never ends the effort past its written end, for a press a tick after it', () => {
    const player = playerFor(RAMP_TEST);
    player.start(seconds(0));
    // The last tick heard is in the last step; the press comes after the end.
    player.tick(seconds(RAMP_WRITTEN_END - 1));
    const state = player.done(seconds(RAMP_WRITTEN_END + 5));
    expect(state.test.effortEndsAt).toBe(RAMP_WRITTEN_END);
  });

  it('is nothing the second time', () => {
    const player = playerFor(RAMP_TEST);
    player.start(seconds(0));
    player.tick(seconds(600));
    player.done(seconds(600));
    player.tick(seconds(650));
    const again = player.done(seconds(700));
    expect(again.test.effortEndsAt).toBe(600);
    expect(again.elapsed).toBe(650);
  });
});

describe('a stall outside the effort is the ordinary rescue, not the end of the test', () => {
  it('eases an opener of the 20-minute test, and the test goes on', () => {
    // A rider whose legs are gone in the openers (1.05 of threshold, 262 W).
    const player = playerFor(TWENTY_MINUTE_TEST);
    player.start(seconds(0));
    let history: CadenceReading[] = [];
    let state = player.state();
    for (let at = 0; at <= 640; at += 1) {
      const cadence = at < 605 ? 90 : Math.max(20, 90 - (at - 605) * 8);
      history = [...history.filter((r) => r.at > at - 30), reading(at, cadence)];
      state = player.tick(seconds(at), { cadence: history });
      if (state.intent.kind === 'write-target') {
        state = player.acknowledge(state.intent.watts);
      }
    }
    expect(state.rescue).toBeDefined();
    expect(state.test.endedBy).toBeUndefined();
    expect(state.segment?.block).toBe(1);
  });
});

describe('the player around the end', () => {
  it('records a stop during the effort as where the effort ended', () => {
    const player = playerFor(RAMP_TEST);
    player.start(seconds(0));
    player.tick(seconds(800));
    const stopped = player.stop();
    expect(stopped.status).toBe('finished');
    expect(stopped.test).toMatchObject({ effortEndsAt: 800, endedBy: 'stopped' });
  });

  it('records no end for a stop in the warm-up, which the estimate refuses anyway', () => {
    const player = playerFor(RAMP_TEST);
    player.start(seconds(0));
    player.tick(seconds(100));
    expect(player.stop().test.endedBy).toBeUndefined();
  });

  it('pauses, resumes, loses the link and stops the cool-down once the effort has ended', () => {
    const player = playerFor(TWENTY_MINUTE_TEST);
    player.start(seconds(0));
    player.tick(seconds(1300));
    const ended = player.done(seconds(1300));
    expect(ended.intent).toMatchObject({ kind: 'write-target', watts: 150 });
    expect(ended.segment).toMatchObject({ startsAt: 1300, endsAt: 1900, block: 4 });
    expect(player.writeFailed().pending).toBeUndefined();
    // Asked again after the failed write, and this time acknowledged.
    const again = player.tick(seconds(1301));
    expect(again.intent.kind).toBe('write-target');
    expect(player.acknowledge(watts(150)).held).toBe(150);

    const paused = player.pause(seconds(1310));
    expect(paused.status).toBe('paused');
    expect(paused.intent).toEqual({ kind: 'release', reason: 'Paused.' });
    expect(paused.elapsed).toBe(1310);
    expect(player.resume(seconds(1400)).status).toBe('running');
    expect(player.tick(seconds(1410)).elapsed).toBe(1320);

    const lost = player.linkLost(seconds(1420));
    expect(lost.status).toBe('paused');
    expect(lost.intent.kind).toBe('release');
    expect(lost.intent).not.toEqual({ kind: 'release', reason: TEST_OVER_REASON });

    expect(player.stop().status).toBe('finished');
    expect(player.state().test.endedBy).toBe('done');
  });

  it('is made for every built-in test, and refuses one with no cool-down to end into', () => {
    for (const test of THRESHOLD_TESTS) {
      expect(() => playerFor(test)).not.toThrow();
    }
    const bare: ThresholdTest = { ...RAMP_TEST, template: { ...RAMP_TEST.template, coolDown: [] } };
    expect(() => playerFor(bare)).toThrow(WorkoutError);
  });

  it('draws the test as written', () => {
    const player = playerFor(RAMP_TEST);
    expect(player.timeline.totalSeconds).toBe(RAMP_WRITTEN_END + 600);
    expect(player.state().test).toEqual({
      effortStartsAt: RAMP_EFFORT_STARTS,
      effortEndsAt: RAMP_WRITTEN_END,
      endedBy: undefined,
    });
  });
});
