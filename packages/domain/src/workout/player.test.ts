// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { revolutionsPerMinute, seconds, watts, type Seconds } from '../quantities';

import { COLLAPSE_RPM, RELIEF_SHARE, type CadenceReading } from './erg-safety';
import { createWorkoutPlayer, REFRESH_SECONDS, type PlayerIntent } from './player';
import { expandWorkout } from './timeline';
import { thresholdShare, type Workout, type WorkoutBlock } from './workout';

const steady = (length: number, share: number): WorkoutBlock => ({
  kind: 'steady',
  seconds: seconds(length),
  target: thresholdShare(share),
});

const freeRide = (length: number): WorkoutBlock => ({
  kind: 'free-ride',
  seconds: seconds(length),
});

const workout = (blocks: readonly WorkoutBlock[]): Workout => ({ name: 'Test', blocks });

const THRESHOLD = watts(250);

/** Two blocks with different targets, so a boundary crossing changes the number. */
const twoBlocks = () => expandWorkout(workout([steady(60, 0.6), steady(60, 1.0)]));

const player = (timeline = twoBlocks(), refreshSeconds?: number) =>
  createWorkoutPlayer({
    timeline,
    thresholdPower: THRESHOLD,
    ...(refreshSeconds === undefined ? {} : { refreshSeconds }),
  });

/** The watts a `write-target` intent asked for; fails loudly on any other kind. */
const wroteWatts = (intent: PlayerIntent): number => {
  if (intent.kind !== 'write-target') {
    throw new Error(`expected a write-target intent, got ${intent.kind}`);
  }
  return intent.watts;
};

/** A cadence history falling from `from` to `to` across the trend window. */
const falling = (from: number, to: number, endingAt: number): readonly CadenceReading[] => [
  { at: seconds(endingAt - 6), cadence: revolutionsPerMinute(from) },
  { at: seconds(endingAt), cadence: revolutionsPerMinute(to) },
];

describe('a workout does not run until it is started', () => {
  it('is idle, with no segment and nothing to write', () => {
    const state = player().state();
    expect(state.status).toBe('idle');
    expect(state.segment).toBeUndefined();
    expect(state.intent).toEqual({ kind: 'hold' });
  });

  it('ignores a tick before the start, rather than advancing an unstarted clock', () => {
    const subject = player();
    const state = subject.tick(seconds(1000));
    expect(state.status).toBe('idle');
    expect(state.elapsed).toBe(0);
    expect(state.intent).toEqual({ kind: 'hold' });
  });

  it('starts from zero however late in the day the clock says it is', () => {
    // The clock is a wall clock, not an offset: `start` anchors, it does not
    // adopt. A player that adopted `now` as its elapsed time would report an
    // hour-long workout as finished the moment it began.
    const state = player().start(seconds(86_400));
    expect(state.status).toBe('running');
    expect(state.elapsed).toBe(0);
  });
});

describe('an interval has not begun until its target is acknowledged', () => {
  it('asks for the target of the segment it is in', () => {
    const subject = player();
    subject.start(seconds(100));
    const state = subject.tick(seconds(101));
    // 0.6 of 250 W.
    expect(wroteWatts(state.intent)).toBe(150);
    expect(state.pending).toBe(150);
  });

  it('asks for nothing more while the first ask is outstanding', () => {
    const subject = player();
    subject.start(seconds(100));
    subject.tick(seconds(101));
    // Far enough on to be in the second block, which wants a different number.
    const state = subject.tick(seconds(180));
    expect(state.intent).toEqual({ kind: 'hold' });
    expect(state.pending).toBe(150);
  });

  it('asks for the new segment as soon as the acknowledgement arrives', () => {
    const subject = player();
    subject.start(seconds(100));
    subject.tick(seconds(101));
    subject.acknowledge(watts(150));
    const state = subject.tick(seconds(180));
    // 1.0 of 250 W: the second block, and only now.
    expect(wroteWatts(state.intent)).toBe(250);
  });

  it('does not stop the clock while a target is pending', () => {
    // ⚠️ The counter-rule, and the one a reader is most likely to assume the
    // other way round. A machine that answers slowly does not lengthen the
    // interval: the rider is riding throughout.
    const subject = player();
    subject.start(seconds(100));
    subject.tick(seconds(101));
    const state = subject.tick(seconds(140));
    expect(state.elapsed).toBe(40);
    expect(state.segment?.startsAt).toBe(0);
  });

  it('reads a quantised acknowledgement as an answer, not as a change', () => {
    // ⚠️ The defect this test was written to find. `setTargetPower` quantises,
    // so a machine asked for 150 W answers 151 W. A player that compared the
    // next tick against the READBACK would see 0.604 where it wanted 0.6, call
    // that a change, and rewrite the same target on every tick forever — with
    // the refresh interval the only thing bounding the loop it was supposed to
    // be closing. The comparison is against what was asked.
    const subject = player(twoBlocks(), 1000);
    subject.start(seconds(100));
    subject.tick(seconds(101));
    subject.acknowledge(watts(151));
    const state = subject.tick(seconds(102));
    expect(state.intent).toEqual({ kind: 'hold' });
  });

  it('reports what the trainer holds beside what it was asked for', () => {
    const subject = player();
    subject.start(seconds(0));
    subject.tick(seconds(0));
    const state = subject.acknowledge(watts(151));
    expect(state.held).toBe(151);
    expect(state.pending).toBeUndefined();
  });

  it('forgets what the trainer held when a new workout starts', () => {
    const subject = player();
    subject.start(seconds(0));
    subject.tick(seconds(0));
    subject.acknowledge(watts(151));
    expect(subject.start(seconds(0)).held).toBeUndefined();
  });
});

describe('the loop stays closed by refreshing an unchanged target', () => {
  it('holds inside the refresh interval', () => {
    const subject = player(twoBlocks(), 5);
    subject.start(seconds(0));
    subject.tick(seconds(0));
    subject.acknowledge(watts(150));
    expect(subject.tick(seconds(3)).intent).toEqual({ kind: 'hold' });
  });

  it('rewrites the same target once the interval has passed', () => {
    // #14's revision block: an FTMS host writes continuously at about 1 Hz,
    // because a machine that has silently lost the session ignores what it was
    // told and a player that wrote once would never find out.
    const subject = player(twoBlocks(), 5);
    subject.start(seconds(0));
    subject.tick(seconds(0));
    subject.acknowledge(watts(150));
    expect(wroteWatts(subject.tick(seconds(5)).intent)).toBe(150);
  });

  it('refreshes about once a second by default', () => {
    expect(REFRESH_SECONDS).toBe(1);
    const subject = player();
    subject.start(seconds(0));
    subject.tick(seconds(0));
    subject.acknowledge(watts(150));
    expect(subject.tick(seconds(0.5)).intent).toEqual({ kind: 'hold' });
    expect(wroteWatts(subject.tick(seconds(1)).intent)).toBe(150);
  });
});

describe('a ramp is written as it climbs', () => {
  it('follows the interpolated target rather than the block it started in', () => {
    const timeline = expandWorkout(
      workout([
        {
          kind: 'ramp',
          seconds: seconds(100),
          from: thresholdShare(0.5),
          to: thresholdShare(1.5),
        },
      ]),
    );
    const subject = player(timeline);
    subject.start(seconds(0));
    expect(wroteWatts(subject.tick(seconds(0)).intent)).toBe(125);
    subject.acknowledge(watts(125));
    // Halfway up: 1.0 of threshold.
    expect(wroteWatts(subject.tick(seconds(50)).intent)).toBe(250);
  });
});

describe('a free ride releases the trainer rather than writing a small number', () => {
  it('releases inside a free-ride block', () => {
    const subject = player(expandWorkout(workout([freeRide(60), steady(60, 0.8)])));
    subject.start(seconds(0));
    const state = subject.tick(seconds(10));
    expect(state.intent.kind).toBe('release');
    expect(state.pending).toBeUndefined();
  });

  it('picks the target up again on the far side of it', () => {
    const subject = player(expandWorkout(workout([freeRide(60), steady(60, 0.8)])));
    subject.start(seconds(0));
    subject.tick(seconds(10));
    expect(wroteWatts(subject.tick(seconds(70)).intent)).toBe(200);
  });
});

describe('the ERG spiral is broken by easing the target, not by ending the interval', () => {
  it('holds the full target for a rider who is simply grinding', () => {
    // 60 rpm steadily is a choice, not a spiral, and interrupting it would be
    // the workout deciding the rider failed.
    const subject = player();
    subject.start(seconds(0));
    const steadyGrind: readonly CadenceReading[] = [
      { at: seconds(0), cadence: revolutionsPerMinute(62) },
      { at: seconds(6), cadence: revolutionsPerMinute(60) },
    ];
    const state = subject.tick(seconds(6), { cadence: steadyGrind });
    expect(wroteWatts(state.intent)).toBe(150);
    expect(state.intent).toMatchObject({ eased: false });
  });

  it('eases the target when cadence collapses under it', () => {
    const subject = player();
    subject.start(seconds(0));
    const state = subject.tick(seconds(10), { cadence: falling(70, 70 - COLLAPSE_RPM - 5, 10) });
    expect(wroteWatts(state.intent)).toBe(Math.round(250 * 0.6 * RELIEF_SHARE));
    expect(state.intent).toMatchObject({ eased: true, share: 0.6 });
  });

  it('reports the share the workout asked for beside the reduced watts', () => {
    // A screen showing "60%" beside an eased wattage is telling the truth about
    // both, which it could not do if the player collapsed them into one number.
    const subject = player();
    subject.start(seconds(0));
    const state = subject.tick(seconds(10), { cadence: falling(70, 45, 10) });
    if (state.intent.kind !== 'write-target') throw new Error('expected a write');
    expect(state.intent.share).toBe(0.6);
    expect(state.intent.watts).toBeLessThan(150);
  });

  it('releases entirely when the rider has stopped pedalling', () => {
    const subject = player();
    subject.start(seconds(0));
    const stopped: readonly CadenceReading[] = [
      { at: seconds(4), cadence: revolutionsPerMinute(30) },
      { at: seconds(10), cadence: revolutionsPerMinute(4) },
    ];
    const state = subject.tick(seconds(10), { cadence: stopped });
    expect(state.intent.kind).toBe('release');
    expect(state.pending).toBeUndefined();
  });

  it('reads the cadence history on the clock it was given, not on elapsed time', () => {
    // ⚠️ The defect this test was written to find, and every other case in
    // this file was blind to it: they all start at zero, where `now` and
    // `elapsed` are the same number. A caller whose clock is a wall clock — the
    // ride screen — stamps readings in the thousands while `elapsed` is in the
    // tens, so a player judging at `elapsed` finds an empty window on every
    // tick and the spiral rule never fires at all.
    const subject = player();
    const startedAt = 1_700_000_000;
    subject.start(seconds(startedAt));
    const collapsing: readonly CadenceReading[] = [
      { at: seconds(startedAt + 4), cadence: revolutionsPerMinute(70) },
      { at: seconds(startedAt + 10), cadence: revolutionsPerMinute(45) },
    ];
    const state = subject.tick(seconds(startedAt + 10), { cadence: collapsing });
    expect(state.intent).toMatchObject({ eased: true });
  });

  it('runs no spiral check at all when the trainer reports no cadence', () => {
    // A trainer with no cadence is a trainer, not a stalled rider. Treating
    // silence as a fault would ease every target on such a machine forever.
    const subject = player();
    subject.start(seconds(0));
    expect(wroteWatts(subject.tick(seconds(10)).intent)).toBe(150);
  });

  it('restores the full target once cadence recovers', () => {
    const subject = player();
    subject.start(seconds(0));
    const eased = subject.tick(seconds(10), { cadence: falling(70, 45, 10) });
    subject.acknowledge(watts(wroteWatts(eased.intent)));
    const recovered: readonly CadenceReading[] = [
      { at: seconds(14), cadence: revolutionsPerMinute(80) },
      { at: seconds(20), cadence: revolutionsPerMinute(85) },
    ];
    const state = subject.tick(seconds(20), { cadence: recovered });
    expect(wroteWatts(state.intent)).toBe(150);
    expect(state.intent).toMatchObject({ eased: false });
  });
});

describe('a failed write is retried rather than forgotten', () => {
  it('asks again on the next tick, inside the refresh interval', () => {
    const subject = player(twoBlocks(), 1000);
    subject.start(seconds(0));
    subject.tick(seconds(0));
    subject.writeFailed();
    // The refresh is far away, so only the forgotten share can explain a write.
    expect(wroteWatts(subject.tick(seconds(1)).intent)).toBe(150);
  });

  it('clears the pending target, so the player is not wedged', () => {
    const subject = player();
    subject.start(seconds(0));
    subject.tick(seconds(0));
    expect(subject.writeFailed().pending).toBeUndefined();
  });
});

describe('a trainer disconnect pauses the workout and preserves it', () => {
  it('keeps the elapsed time it had reached', () => {
    const subject = player();
    subject.start(seconds(100));
    subject.tick(seconds(130));
    const state = subject.linkLost(seconds(140));
    expect(state.status).toBe('paused');
    expect(state.elapsed).toBe(40);
  });

  it('says what happened, in words a rider can act on', () => {
    const subject = player();
    subject.start(seconds(0));
    const state = subject.linkLost(seconds(10));
    if (state.intent.kind !== 'release') throw new Error('expected a release');
    expect(state.intent.reason).toContain('paused');
    expect(state.intent.reason).toContain('Nothing has been lost');
  });

  it('does not advance while the link is down', () => {
    const subject = player();
    subject.start(seconds(0));
    subject.linkLost(seconds(10));
    expect(subject.tick(seconds(600)).elapsed).toBe(10);
  });

  it('resumes from where it stopped rather than from the wall clock', () => {
    const subject = player();
    subject.start(seconds(0));
    subject.linkLost(seconds(10));
    subject.resume(seconds(600));
    expect(subject.tick(seconds(605)).elapsed).toBe(15);
  });

  it('clears an outstanding write, so a reconnection is not waiting on a dead one', () => {
    const subject = player();
    subject.start(seconds(0));
    subject.tick(seconds(0));
    expect(subject.linkLost(seconds(10)).pending).toBeUndefined();
  });

  it('does not resurrect a finished workout', () => {
    const subject = player();
    subject.stop();
    expect(subject.linkLost(seconds(10)).status).toBe('finished');
  });
});

describe('pausing and resuming', () => {
  it('excludes the paused stretch from elapsed time', () => {
    const subject = player();
    subject.start(seconds(0));
    subject.pause(seconds(20));
    subject.resume(seconds(300));
    expect(subject.tick(seconds(310)).elapsed).toBe(30);
  });

  it('writes immediately on resume rather than waiting out the refresh', () => {
    const subject = player(twoBlocks(), 1000);
    subject.start(seconds(0));
    subject.tick(seconds(0));
    subject.acknowledge(watts(150));
    subject.pause(seconds(1));
    subject.resume(seconds(500));
    // A rider pressing resume should feel the trainer pick up; with a refresh
    // of 1000 s only the cleared bookkeeping can explain this write.
    expect(wroteWatts(subject.tick(seconds(500)).intent)).toBe(150);
  });

  it('releases the trainer while paused', () => {
    const subject = player();
    subject.start(seconds(0));
    expect(subject.pause(seconds(5)).intent.kind).toBe('release');
  });

  it('reports no segment while paused, because nothing is being ridden', () => {
    const subject = player();
    subject.start(seconds(0));
    expect(subject.pause(seconds(5)).segment).toBeUndefined();
  });

  it('ignores a pause when nothing is running', () => {
    const subject = player();
    expect(subject.pause(seconds(5)).status).toBe('idle');
  });

  it('ignores a resume of a workout that is already running', () => {
    // ⚠️ Asserted through the CLOCK rather than the status, because the status
    // is `running` either way and a test reading it cannot tell the guard from
    // its absence. A resume that fell through would rebase the offset onto the
    // instant it was called, so a stray resume — a double-tapped button, a
    // reconnection racing a resume — would quietly hand the rider back time
    // they had already ridden.
    const subject = player();
    subject.start(seconds(0));
    subject.tick(seconds(10));
    subject.resume(seconds(1000));
    expect(subject.tick(seconds(1010)).elapsed).toBe(1010);
  });

  it('does not restart a workout that has finished', () => {
    const subject = player();
    subject.start(seconds(0));
    subject.tick(seconds(10));
    subject.stop();
    expect(subject.resume(seconds(20)).status).toBe('finished');
  });
});

describe('the end of the workout', () => {
  it('finishes at the total length, not one tick after it', () => {
    const subject = player();
    subject.start(seconds(0));
    const state = subject.tick(seconds(120));
    expect(state.status).toBe('finished');
    expect(state.intent).toEqual({ kind: 'finished' });
  });

  it('drops an outstanding target when it finishes', () => {
    const subject = player();
    subject.start(seconds(0));
    subject.tick(seconds(119));
    const state = subject.tick(seconds(120));
    expect(state.pending).toBeUndefined();
  });

  it('stays finished however long the ticks keep coming', () => {
    const subject = player();
    subject.start(seconds(0));
    subject.tick(seconds(200));
    const state = subject.tick(seconds(400));
    expect(state.status).toBe('finished');
    expect(state.elapsed).toBe(200);
  });

  it('can be ended deliberately mid-ride', () => {
    const subject = player();
    subject.start(seconds(0));
    subject.tick(seconds(10));
    const state = subject.stop();
    expect(state.status).toBe('finished');
    expect(state.pending).toBeUndefined();
    expect(state.intent).toEqual({ kind: 'finished' });
  });
});

describe('the target does not depend on how the rider got there', () => {
  it('writes the same number after a pause as it would have without one', () => {
    // The bug a timeline exists to make impossible, asserted through the player
    // that would exhibit it: `targetAt` takes no state, so a scrubbed or
    // interrupted workout cannot drift from a clean one.
    const timeline = expandWorkout(
      workout([
        { kind: 'ramp', seconds: seconds(100), from: thresholdShare(0.5), to: thresholdShare(1.5) },
      ]),
    );

    const clean = player(timeline);
    clean.start(seconds(0));
    const straight = wroteWatts(clean.tick(seconds(40)).intent);

    const interrupted = player(timeline);
    interrupted.start(seconds(0));
    interrupted.tick(seconds(10));
    interrupted.acknowledge(watts(1));
    interrupted.pause(seconds(20));
    interrupted.resume(seconds(900));
    const afterPause = wroteWatts(interrupted.tick(seconds(920)).intent);

    expect(afterPause).toBe(straight);
  });
});

describe('the elapsed clock is reported in seconds', () => {
  it('hands back a Seconds, not a bare number', () => {
    const subject = player();
    subject.start(seconds(0));
    const elapsed: Seconds = subject.tick(seconds(7)).elapsed;
    expect(elapsed).toBe(7);
  });
});
