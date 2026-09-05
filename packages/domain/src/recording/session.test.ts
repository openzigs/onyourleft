// SPDX-License-Identifier: Apache-2.0

/**
 * The recording session and the stream merge — #45's acceptance criteria.
 *
 * Every case below drives the engine through its **public** surface and reads
 * the result out of `series()`, never out of an internal. The one thing this
 * file must not do is assert against the readings it just constructed: the
 * merge is the thing under test, so a test that compares its input to itself
 * would pass against an engine that merged nothing at all.
 */

import { describe, expect, it } from 'vitest';

import {
  beatsPerMinute,
  metresPerSecond,
  revolutionsPerMinute,
  seconds,
  unixSeconds,
  watts,
  type BeatsPerMinute,
  type MetresPerSecond,
  type RevolutionsPerMinute,
  type Watts,
} from '../quantities';

import { seriesTimestamps, type ChannelReading } from './channels';
import { RecordingError } from './errors';
import {
  createRecordingSession,
  restoreRecordingSession,
  type RecordingSession,
  type RecordingSessionOptions,
} from './session';

/**
 * The channel map these tests instantiate the engine at.
 *
 * Four channels rather than the store's eight: the engine is generic and knows
 * nothing about how many there are, so eight would exercise nothing five does
 * not. `apps/web` is where the real eight are bound.
 */
interface TestChannels {
  power: Watts;
  heartRate: BeatsPerMinute;
  cadence: RevolutionsPerMinute;
  speed: MetresPerSecond;
}

const T0 = 1_700_000_000;

function at(offset: number) {
  return unixSeconds(T0 + offset);
}

function power(offset: number, value: number): ChannelReading<TestChannels> {
  return { channel: 'power', value: watts(value), at: at(offset) };
}

function heartRate(offset: number, value: number): ChannelReading<TestChannels> {
  return { channel: 'heartRate', value: beatsPerMinute(value), at: at(offset) };
}

function speed(offset: number, value: number): ChannelReading<TestChannels> {
  return { channel: 'speed', value: metresPerSecond(value), at: at(offset) };
}

function cadence(offset: number, value: number): ChannelReading<TestChannels> {
  return { channel: 'cadence', value: revolutionsPerMinute(value), at: at(offset) };
}

function newSession(
  overrides: Partial<RecordingSessionOptions<TestChannels>> = {},
): RecordingSession<TestChannels> {
  return createRecordingSession<TestChannels>({
    id: 'session-under-test',
    sampleInterval: seconds(1),
    ...overrides,
  });
}

/** A session already recording, with the whole ride's clock ticks driven from outside. */
function started(
  overrides: Partial<RecordingSessionOptions<TestChannels>> = {},
): RecordingSession<TestChannels> {
  const session = newSession(overrides);
  session.start(at(0));
  return session;
}

describe('the state machine', () => {
  it('runs the whole legal lifecycle: idle -> recording -> paused -> recording -> stopped', () => {
    const session = newSession();
    expect(session.state).toBe('idle');

    session.start(at(0));
    expect(session.state).toBe('recording');

    session.pause(at(10));
    expect(session.state).toBe('paused');
    expect(session.pauseReason).toBe('manual');

    session.resume(at(20));
    expect(session.state).toBe('recording');
    expect(session.pauseReason).toBeUndefined();

    session.stop(at(30));
    expect(session.state).toBe('stopped');
  });

  it('rejects starting a session that is already recording', () => {
    const session = started();
    expect(() => {
      session.start(at(5));
    }).toThrow(RecordingError);
  });

  it('rejects recording from stopped — the criterion names this one', () => {
    const session = started();
    session.stop(at(5));

    let raised: unknown;
    try {
      session.start(at(6));
    } catch (error: unknown) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(RecordingError);
    expect((raised as RecordingError).code).toBe('illegal-transition');
    expect((raised as RecordingError).message).toContain('stopped');
    // And it is an error rather than a no-op: the session did not restart.
    expect(session.state).toBe('stopped');
  });

  it('rejects resuming from idle — the criterion names this one too', () => {
    const session = newSession();
    expect(() => {
      session.resume(at(1));
    }).toThrow(RecordingError);
    expect(session.state).toBe('idle');
  });

  it('rejects pausing an idle, a paused and a stopped session', () => {
    const idle = newSession();
    expect(() => {
      idle.pause(at(1));
    }).toThrow(RecordingError);

    const paused = started();
    paused.pause(at(1));
    expect(() => {
      paused.pause(at(2));
    }).toThrow(RecordingError);

    const stopped = started();
    stopped.stop(at(1));
    expect(() => {
      stopped.pause(at(2));
    }).toThrow(RecordingError);
  });

  it('rejects resuming a recording or a stopped session', () => {
    const recording = started();
    expect(() => {
      recording.resume(at(1));
    }).toThrow(RecordingError);

    const stopped = started();
    stopped.stop(at(1));
    expect(() => {
      stopped.resume(at(2));
    }).toThrow(RecordingError);
  });

  it('rejects stopping an idle or an already stopped session', () => {
    const idle = newSession();
    expect(() => {
      idle.stop(at(1));
    }).toThrow(RecordingError);

    const stopped = started();
    stopped.stop(at(1));
    expect(() => {
      stopped.stop(at(2));
    }).toThrow(RecordingError);
  });

  it('stops from paused, which is legal and is how a ride ends at a red light', () => {
    const session = started();
    session.pause(at(10));
    session.stop(at(15));
    expect(session.state).toBe('stopped');
  });

  it('refuses to advance a session that never started, and ignores ticks after stop', () => {
    const idle = newSession();
    expect(() => {
      idle.advanceTo(at(1));
    }).toThrow(RecordingError);

    const stopped = started();
    stopped.stop(at(10));
    stopped.advanceTo(at(600));
    // The stop instant, not the tick, decides where the ride ended.
    expect(stopped.elapsedTime).toBe(10);
  });

  it('reports an empty series while idle rather than a series starting at the epoch', () => {
    const session = newSession();
    expect(session.sampleCount).toBe(0);
    expect(session.sealedCount).toBe(0);
    expect(session.elapsedTime).toBe(0);
    expect(session.movingTime).toBe(0);
    expect(session.startedAt).toBeUndefined();
    expect(session.series().sampleCount).toBe(0);
    expect(session.slice(0, 10).sampleCount).toBe(0);
  });

  it('refuses options it cannot honour, at construction rather than at first use', () => {
    expect(() => newSession({ sampleInterval: seconds(0) })).toThrow(RecordingError);
    expect(() => newSession({ lateToleranceSeconds: -1 })).toThrow(RecordingError);
    expect(() => newSession({ futureToleranceSeconds: Number.NaN })).toThrow(RecordingError);
    expect(() => newSession({ maxSampleCount: 0 })).toThrow(RecordingError);
    expect(() => newSession({ autoPause: { after: seconds(0), isMoving: () => true } })).toThrow(
      RecordingError,
    );
  });
});

describe('gap versus zero', () => {
  it('leaves a 30-second heart-rate dropout absent, while zero power stays zero', () => {
    const session = started();
    for (let t = 0; t < 120; t += 1) {
      // The strap drops between t=30 and t=59 inclusive; the power meter keeps
      // reporting, and reports a genuine zero for the same window because the
      // rider is coasting.
      if (t < 30 || t >= 60) {
        session.observe(heartRate(t, 140));
      }
      session.observe(power(t, t >= 30 && t < 60 ? 0 : 220));
      session.advanceTo(at(t));
    }
    session.stop(at(119));

    const series = session.series();
    const hr = series.channels.heartRate;
    const watt = series.channels.power;

    expect(series.sampleCount).toBe(120);
    // The dropout is absent. Not zero, not interpolated, not a sentinel.
    for (let t = 30; t < 60; t += 1) {
      expect(hr?.[t]).toBeUndefined();
      // ...and over exactly the same window, power is a *value* that happens to
      // be zero. This is the pair the whole criterion is about.
      expect(watt?.[t]).toBe(0);
    }
    expect(hr?.[29]).toBe(140);
    expect(hr?.[60]).toBe(140);
    // 30 absent samples, and not one more.
    expect(hr?.filter((sample) => sample === undefined)).toHaveLength(30);
    expect(watt?.filter((sample) => sample === undefined)).toHaveLength(0);
  });

  it('keeps a pause distinguishable from a dropout, which are both runs of undefined', () => {
    const session = started();
    for (let t = 0; t < 10; t += 1) {
      session.observe(power(t, 200));
      session.advanceTo(at(t));
    }
    session.pause(at(10));
    session.advanceTo(at(40));
    session.resume(at(40));
    for (let t = 40; t < 50; t += 1) {
      session.observe(power(t, 200));
      session.advanceTo(at(t));
    }
    session.stop(at(49));

    const series = session.series();
    // The paused seconds are holes, exactly as a dropout would be...
    expect(series.channels.power?.[20]).toBeUndefined();
    // ...and the pause list is what says which kind of hole it is.
    expect(series.pauses).toEqual([
      { from: unixSeconds(T0 + 10), to: unixSeconds(T0 + 40), reason: 'manual' },
    ]);
  });
});

describe('pause accounting', () => {
  it('makes elapsed and moving time differ by exactly the paused duration', () => {
    const session = started();
    session.advanceTo(at(600));
    session.pause(at(600));
    session.advanceTo(at(900));
    session.resume(at(900));
    session.advanceTo(at(1200));
    session.stop(at(1200));

    expect(session.elapsedTime).toBe(1200);
    expect(session.pausedTime).toBe(300);
    expect(session.movingTime).toBe(900);
    expect(session.elapsedTime - session.movingTime).toBe(session.pausedTime);
  });

  it('does not accumulate moving time while auto-paused, and back-dates the pause', () => {
    const session = started({
      autoPause: { after: seconds(10), isMoving: (reading) => reading.channel === 'speed' },
    });
    // Moving for the first 30 seconds.
    for (let t = 0; t <= 30; t += 1) {
      session.observe(speed(t, 8));
      session.advanceTo(at(t));
    }
    // Then the rider stops at a junction. Only heart rate keeps arriving, which
    // is not evidence of movement.
    for (let t = 31; t <= 90; t += 1) {
      session.observe(heartRate(t, 130));
      session.advanceTo(at(t));
    }

    expect(session.state).toBe('paused');
    expect(session.pauseReason).toBe('automatic');
    // Back-dated to 10 s after the last movement, not to the tick that noticed.
    expect(session.series().pauses).toEqual([{ from: unixSeconds(T0 + 40), reason: 'automatic' }]);
    expect(session.elapsedTime).toBe(90);
    expect(session.pausedTime).toBe(50);
    expect(session.movingTime).toBe(40);
    expect(session.elapsedTime - session.movingTime).toBe(session.pausedTime);
  });

  it('back-dates the auto-pause even when the tick that notices arrives much later', () => {
    // A tab that was throttled, or a caller that ticks every thirty seconds
    // rather than every second. A pause that began "when the recorder noticed"
    // would credit the rider with a minute of moving time they spent stationary
    // — and under a 1 Hz tick that bug is invisible, because the tick that
    // notices *is* the instant movement lapsed.
    const session = started({
      autoPause: { after: seconds(10), isMoving: (reading) => reading.channel === 'speed' },
    });
    session.observe(speed(30, 8));
    session.advanceTo(at(30));
    session.advanceTo(at(100));

    expect(session.state).toBe('paused');
    expect(session.series().pauses).toEqual([{ from: unixSeconds(T0 + 40), reason: 'automatic' }]);
    expect(session.elapsedTime).toBe(100);
    expect(session.pausedTime).toBe(60);
    expect(session.movingTime).toBe(40);
  });

  it('resumes automatically the moment movement returns, but never from a manual pause', () => {
    const auto = started({
      autoPause: { after: seconds(10), isMoving: (reading) => reading.channel === 'speed' },
    });
    auto.advanceTo(at(20));
    expect(auto.state).toBe('paused');
    expect(auto.observe(speed(21, 6))).toBe('recorded');
    expect(auto.state).toBe('recording');
    expect(auto.series().channels.speed?.[21]).toBe(6);

    const manual = started({
      autoPause: { after: seconds(10), isMoving: (reading) => reading.channel === 'speed' },
    });
    manual.pause(at(5));
    // A rider who pressed pause at a cafe and knocked the cranks has not
    // restarted their ride.
    expect(manual.observe(speed(6, 6))).toBe('paused');
    expect(manual.state).toBe('paused');
    expect(manual.dropped.paused).toBe(1);
  });

  it('records nothing while paused, and says so rather than throwing', () => {
    const session = started();
    session.pause(at(5));
    expect(session.observe(power(6, 300))).toBe('paused');
    expect(session.series().channels.power).toBeUndefined();
  });

  it('drops readings offered before start and after stop', () => {
    const session = newSession();
    expect(session.observe(power(0, 200))).toBe('not-recording');
    session.start(at(0));
    session.stop(at(10));
    expect(session.observe(power(11, 200))).toBe('not-recording');
    expect(session.dropped['not-recording']).toBe(2);
  });
});

describe('a sensor that drops and reconnects mid-ride', () => {
  it('resumes into the same session with one continuous record series', () => {
    const session = started();
    session.sensorConnected('strap-1', at(0));
    session.sensorConnected('trainer-1', at(0));

    for (let t = 0; t < 30; t += 1) {
      session.observe(heartRate(t, 150));
      session.observe(power(t, 210));
      session.advanceTo(at(t));
    }
    session.sensorDisconnected('strap-1', at(30));
    for (let t = 30; t < 60; t += 1) {
      session.observe(power(t, 210));
      session.advanceTo(at(t));
    }
    // The same physical strap, re-paired by the rider.
    session.sensorConnected('strap-1', at(60));
    for (let t = 60; t < 90; t += 1) {
      session.observe(heartRate(t, 150));
      session.observe(power(t, 210));
      session.advanceTo(at(t));
    }
    session.stop(at(89));

    // One session, unchanged identity, one start instant, never re-entered.
    expect(session.id).toBe('session-under-test');
    expect(session.startedAt).toBe(unixSeconds(T0));
    expect(session.state).toBe('stopped');
    expect(session.connectedSensors).toEqual(['trainer-1', 'strap-1']);

    const series = session.series();
    // One continuous series across the drop: the power channel has no hole at
    // all, and the heart-rate channel has exactly the 30 seconds the strap was
    // gone. A second session would have produced two series starting at zero.
    expect(series.sampleCount).toBe(90);
    expect(series.channels.power?.filter((sample) => sample === undefined)).toHaveLength(0);
    expect(series.channels.heartRate?.filter((sample) => sample === undefined)).toHaveLength(30);
    expect(series.pauses).toEqual([]);
    expect(seriesTimestamps(series)[89]).toBe(unixSeconds(T0 + 89));
  });

  it('tracks a sensor connected before the ride starts and after it ends', () => {
    // A transport pairs devices before the rider presses start, and reports the
    // drop after they press stop. Neither may move a timeline that has not
    // begun or has already ended.
    const session = newSession();
    session.sensorConnected('strap-1', at(0));
    expect(session.connectedSensors).toEqual(['strap-1']);
    expect(session.state).toBe('idle');

    session.start(at(10));
    session.stop(at(20));
    session.sensorDisconnected('strap-1', at(9_999));
    expect(session.connectedSensors).toEqual([]);
    // The stop instant still decides where the ride ended.
    expect(session.elapsedTime).toBe(10);
  });

  it('does not let a disconnect change the session state', () => {
    const session = started();
    session.sensorConnected('strap-1', at(0));
    session.sensorDisconnected('strap-1', at(5));
    expect(session.state).toBe('recording');
    expect(session.connectedSensors).toEqual([]);
    // Disconnecting something that was never connected is not an error: a
    // transport may report a drop for a device it failed to finish pairing.
    session.sensorDisconnected('never-seen', at(6));
    expect(session.connectedSensors).toEqual([]);
  });
});

describe('the merged series is a grid, so ordering is structural', () => {
  it('is strictly monotonic with no duplicate timestamps when notifications arrive shuffled', () => {
    const session = started({ lateToleranceSeconds: 10 });
    const readings = [
      power(4, 204),
      power(1, 201),
      heartRate(3, 143),
      power(0, 200),
      heartRate(0, 140),
      power(3, 203),
      heartRate(1, 141),
      power(2, 202),
      heartRate(4, 144),
      heartRate(2, 142),
    ];
    for (const reading of readings) {
      expect(session.observe(reading)).toBe('recorded');
    }
    session.advanceTo(at(4));
    session.stop(at(4));

    const series = session.series();
    const timestamps = seriesTimestamps(series);
    expect(timestamps).toHaveLength(5);
    for (let index = 1; index < timestamps.length; index += 1) {
      expect(timestamps[index]).toBeGreaterThan(timestamps[index - 1] as number);
    }
    expect(new Set(timestamps).size).toBe(timestamps.length);
    // And every shuffled reading landed in the slot its own timestamp names.
    expect(series.channels.power).toEqual([200, 201, 202, 203, 204]);
    expect(series.channels.heartRate).toEqual([140, 141, 142, 143, 144]);
  });

  it('keeps the last reading when two arrive within the same slot', () => {
    const session = started();
    session.observe(power(0, 200));
    session.observe(power(0, 260));
    session.advanceTo(at(0));
    // Not two samples, and not the first one: a 1 Hz record carries the most
    // recent value for the second it covers.
    expect(session.series().channels.power).toEqual([260]);
  });

  it('drops a reading whose slot has already been sealed, and counts it', () => {
    const session = started({ lateToleranceSeconds: 2 });
    session.advanceTo(at(60));
    expect(session.observe(power(59, 200))).toBe('recorded');
    expect(session.observe(power(10, 200))).toBe('late');
    expect(session.dropped.late).toBe(1);
    expect(session.series().channels.power?.[10]).toBeUndefined();
  });

  it('seals only the prefix that can no longer change', () => {
    const session = started({ lateToleranceSeconds: 2 });
    session.advanceTo(at(10));
    expect(session.sampleCount).toBe(11);
    expect(session.sealedCount).toBe(9);
  });
});

describe('untrusted timestamps', () => {
  it('refuses a reading far in the future rather than sizing an array to it', () => {
    const session = started({ futureToleranceSeconds: 60 });
    session.advanceTo(at(10));
    expect(session.observe(power(10_000_000, 200))).toBe('future');
    expect(session.dropped.future).toBe(1);
    // The series did not grow to ten million slots.
    expect(session.sampleCount).toBe(11);
  });

  it('accepts a reading inside the future tolerance and lets it move the timeline', () => {
    const session = started({ futureToleranceSeconds: 60 });
    session.advanceTo(at(10));
    expect(session.observe(power(40, 200))).toBe('recorded');
    expect(session.timeline).toBe(unixSeconds(T0 + 40));
    expect(session.sampleCount).toBe(41);
  });

  it('caps the series however long the session runs', () => {
    const session = started({ maxSampleCount: 100, futureToleranceSeconds: 10_000 });
    session.advanceTo(at(5_000));
    expect(session.sampleCount).toBe(100);
    expect(session.observe(power(4_000, 200))).toBe('overflow');
    expect(session.dropped.overflow).toBe(1);
  });
});

describe('a device clock that steps backwards', () => {
  it('ignores the step, counts it, and produces no out-of-order samples', () => {
    const session = started();
    for (let t = 0; t <= 100; t += 1) {
      session.observe(power(t, 200 + t));
      session.advanceTo(at(t));
    }
    const before = session.sampleCount;

    // An NTP correction pulls the clock back thirty seconds.
    session.advanceTo(at(70));
    session.advanceTo(at(71));

    expect(session.clockRegressions).toBe(2);
    expect(session.timeline).toBe(unixSeconds(T0 + 100));
    expect(session.sampleCount).toBe(before);

    // Readings that arrive stamped with the corrected clock land behind the
    // seal and are dropped rather than overwriting samples already persisted.
    expect(session.observe(power(72, 999))).toBe('late');

    session.stop(at(105));
    const timestamps = seriesTimestamps(session.series());
    for (let index = 1; index < timestamps.length; index += 1) {
      expect(timestamps[index]).toBeGreaterThan(timestamps[index - 1] as number);
    }
    expect(session.series().channels.power?.[72]).toBe(272);
    expect(session.elapsedTime).toBe(105);
  });

  it('honours a forward step, which shows up as a gap and not as a shifted series', () => {
    const session = started();
    session.observe(power(0, 200));
    session.advanceTo(at(0));
    // The clock jumps forward five minutes.
    session.advanceTo(at(300));
    session.observe(power(300, 210));
    session.stop(at(300));

    const series = session.series();
    expect(series.sampleCount).toBe(301);
    expect(series.channels.power?.[0]).toBe(200);
    expect(series.channels.power?.[300]).toBe(210);
    expect(series.channels.power?.[150]).toBeUndefined();
  });
});

describe('slices and snapshots', () => {
  it('slices a contiguous window with the same gaps the whole series has', () => {
    const session = started();
    for (let t = 0; t < 20; t += 1) {
      if (t !== 12) {
        session.observe(power(t, 100 + t));
      }
      session.advanceTo(at(t));
    }

    const slice = session.slice(10, 15);
    expect(slice.fromIndex).toBe(10);
    expect(slice.sampleCount).toBe(5);
    expect(slice.channels.power).toEqual([110, 111, undefined, 113, 114]);
  });

  it('clamps a slice to the series rather than inventing slots', () => {
    const session = started();
    session.observe(power(0, 200));
    session.advanceTo(at(2));

    expect(session.slice(-5, 99)).toEqual({
      fromIndex: 0,
      sampleCount: 3,
      channels: { power: [200, undefined, undefined] },
    });
    expect(session.slice(2, 1).sampleCount).toBe(0);
  });

  it('produces a snapshot that is the series plus the session identity', () => {
    const session = started();
    session.observe(power(0, 200));
    session.advanceTo(at(1));
    const snapshot = session.snapshot();
    expect(snapshot.id).toBe('session-under-test');
    expect(snapshot.startedAt).toBe(unixSeconds(T0));
    expect(snapshot.sampleInterval).toBe(1);
    expect(snapshot.sampleCount).toBe(2);
    expect(snapshot.channels.power).toEqual([200, undefined]);
  });
});

describe('restoring an interrupted session', () => {
  it('continues the same series, and counts the interruption as paused time', () => {
    const crashed = started();
    for (let t = 0; t < 60; t += 1) {
      crashed.observe(power(t, 200));
      crashed.advanceTo(at(t));
    }
    const snapshot = crashed.snapshot();

    // The tab dies here. Five minutes later the rider reopens it.
    const restored = restoreRecordingSession<TestChannels>({}, snapshot);
    expect(restored.id).toBe(crashed.id);
    expect(restored.state).toBe('paused');
    expect(restored.pauseReason).toBe('automatic');
    expect(restored.startedAt).toBe(unixSeconds(T0));
    expect(restored.series().channels.power?.[59]).toBe(200);

    restored.resume(at(360));
    expect(restored.state).toBe('recording');
    for (let t = 360; t < 400; t += 1) {
      restored.observe(power(t, 205));
      restored.advanceTo(at(t));
    }
    restored.stop(at(399));

    const series = restored.series();
    expect(series.sampleCount).toBe(400);
    // Everything recovered is still there, the crash window is a gap, and the
    // new samples continue the same grid.
    expect(series.channels.power?.[10]).toBe(200);
    expect(series.channels.power?.[200]).toBeUndefined();
    expect(series.channels.power?.[380]).toBe(205);
    // The rider was not pedalling while the tab was dead, so it is paused time.
    // The pause is anchored on the last recovered slot's own instant rather
    // than on its end, which is what makes snapshot and restore idempotent.
    expect(restored.elapsedTime).toBe(399);
    expect(restored.pausedTime).toBe(301);
    expect(restored.movingTime).toBe(98);
  });

  it('carries the pauses recorded before the interruption through the restore', () => {
    const crashed = started();
    crashed.advanceTo(at(10));
    crashed.pause(at(10));
    crashed.advanceTo(at(40));
    crashed.resume(at(40));
    crashed.observe(power(41, 200));
    crashed.advanceTo(at(41));

    const restored = restoreRecordingSession<TestChannels>({}, crashed.snapshot());
    expect(restored.series().pauses).toEqual([
      { from: unixSeconds(T0 + 10), to: unixSeconds(T0 + 40), reason: 'manual' },
      { from: unixSeconds(T0 + 41), reason: 'automatic' },
    ]);
  });

  it('ignores a channel a snapshot names with no samples at all', () => {
    // What `JSON.parse` of a hand-edited checkpoint, or a future encoder that
    // writes a channel key before its bytes, would produce.
    const restored = restoreRecordingSession<TestChannels>(
      {},
      {
        id: 'sparse',
        startedAt: unixSeconds(T0),
        sampleInterval: seconds(1),
        sampleCount: 2,
        channels: { power: [watts(1), watts(2)], heartRate: undefined },
        pauses: [],
      },
    );
    expect(restored.channels).toEqual(['power']);
    expect(restored.series().channels.heartRate).toBeUndefined();
    expect(restored.series().channels.power).toEqual([1, 2]);
  });

  it('is idempotent: restoring a snapshot and taking another produces the same series', () => {
    const crashed = started();
    for (let t = 0; t < 30; t += 1) {
      crashed.observe(power(t, 200 + t));
      crashed.advanceTo(at(t));
    }
    const first = crashed.snapshot();

    // Twice, because the interesting failure is a series that grows by one
    // empty slot each time the tab is reopened without a ride being resumed.
    const once = restoreRecordingSession<TestChannels>({}, first).snapshot();
    const twice = restoreRecordingSession<TestChannels>({}, once).snapshot();

    expect(once.sampleCount).toBe(first.sampleCount);
    expect(twice.sampleCount).toBe(first.sampleCount);
    expect(twice.channels.power).toEqual(first.channels.power);
  });

  it('refuses a snapshot whose channel lengths disagree with its sample count', () => {
    let raised: unknown;
    try {
      restoreRecordingSession<TestChannels>(
        {},
        {
          id: 'corrupt',
          startedAt: unixSeconds(T0),
          sampleInterval: seconds(1),
          sampleCount: 10,
          channels: { power: [watts(1), watts(2)] },
          pauses: [],
        },
      );
    } catch (error: unknown) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(RecordingError);
    expect((raised as RecordingError).code).toBe('invalid-snapshot');
  });

  it('refuses a snapshot claiming more slots than this build will hold', () => {
    expect(() =>
      restoreRecordingSession<TestChannels>(
        { maxSampleCount: 10 },
        {
          id: 'oversized',
          startedAt: unixSeconds(T0),
          sampleInterval: seconds(1),
          sampleCount: 1_000,
          channels: {},
          pauses: [],
        },
      ),
    ).toThrow(RecordingError);
    expect(() =>
      restoreRecordingSession<TestChannels>(
        {},
        {
          id: 'fractional',
          startedAt: unixSeconds(T0),
          sampleInterval: seconds(1),
          sampleCount: 1.5,
          channels: {},
          pauses: [],
        },
      ),
    ).toThrow(RecordingError);
  });
});

describe('the four-hour case #46 has to persist', () => {
  it('merges four irregular feeds into 14,400 slots with the dropout intact', () => {
    const session = started();
    const total = 4 * 60 * 60;
    for (let t = 0; t < total; t += 1) {
      session.observe(power(t, 180));
      // A cadence sensor that notifies every other second.
      if (t % 2 === 0) {
        session.observe(cadence(t, 88));
      }
      // A strap that drops for thirty seconds ten minutes in.
      if (t < 600 || t >= 630) {
        session.observe(heartRate(t, 148));
      }
      session.observe(speed(t, 9));
      session.advanceTo(at(t));
    }
    session.stop(at(total - 1));

    const series = session.series();
    expect(series.sampleCount).toBe(total);
    expect(series.channels.power).toHaveLength(total);
    expect(series.channels.heartRate?.filter((s) => s === undefined)).toHaveLength(30);
    // The odd seconds of cadence are gaps, not zeros — a sensor that notifies
    // at 0.5 Hz has told the recorder nothing about the seconds in between.
    expect(series.channels.cadence?.[1]).toBeUndefined();
    expect(series.channels.cadence?.[2]).toBe(88);
    expect(session.movingTime).toBe(total - 1);
  });
});
