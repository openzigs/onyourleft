// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #46's acceptance criteria, against the real IndexedDB store.
 *
 * ## Every criterion here is a round trip that discards the recorder first
 *
 * #46 names the trap by name: *"the natural test appends samples, then asserts
 * against the recorder's in-memory buffer. That test passes whether or not a
 * single byte reached durable storage."* So no assertion below reads
 * `recorder.session`. The recorder object is **dropped**, every connection is
 * closed, and what is asserted is what a fresh handle can produce — which is
 * what a rider gets back after a crash.
 *
 * `@onyourleft/store/testing`'s harness supplies that guarantee mechanically:
 * its `read` discards every open handle before it opens another, so there is no
 * code these tests could write that reads through the connection that wrote.
 */

import {
  beatsPerMinute,
  metresPerSecond,
  revolutionsPerMinute,
  seconds,
  unixSeconds,
  watts,
  type BeatsPerMinute,
  type MetresPerSecond,
  type UnixSeconds,
  type Watts,
} from '@onyourleft/domain';
import { deviceId, WEB_BLUETOOTH, type SensorMeasurement } from '@onyourleft/sensors';
import { athleteId, recordingSessionId, type RecordingSessionId } from '@onyourleft/store';
import {
  assertRecordingRecovers,
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RideReading } from './channels';
import {
  createRecorder,
  listRecoverableRecordings,
  MAX_DATA_LOSS_SECONDS,
  recoverRecorder,
  type Recorder,
  type RecordingCheckpointStore,
} from './recorder';

const T0 = 1_700_000_000;

let harness: StoreHarness;
let sessionCounter = 0;

beforeEach(async () => {
  sessionCounter = 0;
  harness = createStoreHarness();
  await seedAthletes(harness);
});

afterEach(async () => {
  await harness.destroy();
});

function nextSessionId(): RecordingSessionId {
  sessionCounter += 1;
  return recordingSessionId(`ride-${String(sessionCounter)}`);
}

/**
 * A checkpoint store that routes every call through the harness.
 *
 * Deliberately holds no handle of its own: it asks the harness for one on every
 * call, so `harness.discard()` — the closest a test gets to killing the tab —
 * really does take the recorder's connection with it.
 */
function harnessStore(): RecordingCheckpointStore {
  return {
    putRecordingSession: async (record) =>
      harness.write(async (store) => store.putRecordingSession(record)),
    appendRecordingChunk: async (chunk) =>
      harness.write(async (store) => store.appendRecordingChunk(chunk)),
    listRecordingSessions: async (owner) =>
      harness.write(async (store) => store.listRecordingSessions(owner)),
    recoverRecording: async (owner, id) =>
      harness.write(async (store) => store.recoverRecording(owner, id)),
    deleteRecordingSession: async (owner, id) =>
      harness.write(async (store) => store.deleteRecordingSession(owner, id)),
  };
}

function at(offset: number): UnixSeconds {
  return unixSeconds(T0 + offset);
}

function powerReading(offset: number, value: number): RideReading {
  return { channel: 'power', value: watts(value), at: at(offset) };
}

function speedReading(offset: number, value: number): RideReading {
  return { channel: 'speed', value: metresPerSecond(value), at: at(offset) };
}

/**
 * The speed `ride` feeds every second.
 *
 * It is fed at all because **power is deliberately not a movement signal**: an
 * ERG-mode trainer reports a power target to a rider who is off the bike, so a
 * ride with power alone auto-pauses after ten seconds. That is the intended
 * behaviour and it has its own test below; every other case here supplies a
 * movement signal so that auto-pause is not silently the subject.
 */
const RIDING_SPEED = metresPerSecond(9);

function newRecorder(overrides: Partial<Parameters<typeof createRecorder>[0]> = {}): Recorder {
  return createRecorder({
    store: harnessStore(),
    athleteId: ATHLETE_A,
    sessionId: nextSessionId(),
    sampleInterval: seconds(1),
    ...overrides,
  });
}

/**
 * Rides `duration` seconds, feeding power every second and a movement signal
 * with it, with an optional heart-rate dropout.
 *
 * @returns the samples that were *offered*, so a test can compare what survived
 * against what was ridden rather than against what the recorder says it holds.
 */
async function ride(
  recorder: Recorder,
  duration: number,
  options: { readonly dropoutFrom?: number; readonly dropoutCount?: number } = {},
): Promise<{
  power: Watts[];
  heartRate: (BeatsPerMinute | undefined)[];
  speed: MetresPerSecond[];
}> {
  const power: Watts[] = [];
  const heartRate: (BeatsPerMinute | undefined)[] = [];
  const speed: MetresPerSecond[] = [];
  const dropoutFrom = options.dropoutFrom ?? -1;
  const dropoutCount = options.dropoutCount ?? 0;

  await recorder.start(at(0));
  for (let t = 0; t < duration; t += 1) {
    const watt = watts(offeredWatt(t));
    recorder.observeReading({ channel: 'power', value: watt, at: at(t) });
    recorder.observeReading(speedReading(t, 9));
    power[t] = watt;
    speed[t] = RIDING_SPEED;
    const dropped = t >= dropoutFrom && t < dropoutFrom + dropoutCount;
    if (!dropped) {
      const beats = beatsPerMinute(140 + (t % 20));
      recorder.observeReading({ channel: 'heartRate', value: beats, at: at(t) });
      heartRate[t] = beats;
    } else {
      heartRate[t] = undefined;
    }
    await recorder.tick(at(t));
  }
  return { power, heartRate, speed };
}

describe('a whole ride survives the tab being killed', () => {
  it('reinstantiates a 60-minute ride from local storage alone, in order and with gaps intact', async () => {
    const recorder = newRecorder();
    const offered = await ride(recorder, 3_600, { dropoutFrom: 600, dropoutCount: 30 });
    await recorder.stop(at(3_599));

    const sessionId = recorder.sessionId;
    const connectionsBefore = harness.connectionsOpened;

    // Everything in memory is gone from here on. `assertRecordingRecovers`
    // closes every connection before it reads, so nothing below can be served
    // by the handle that wrote.
    const recovered = await assertRecordingRecovers(harness, ATHLETE_A, sessionId, {
      sampleCount: 3_600,
      channels: { power: offered.power, heartRate: offered.heartRate, speed: offered.speed },
    });

    expect(harness.connectionsOpened).toBeGreaterThan(connectionsBefore);
    expect(recovered.startedAt).toBe(at(0));
    expect(recovered.state).toBe('stopped');
    expect(recovered.chunksAfterGap).toBe(0);
    // The thirty-second dropout came back as absence, not as thirty seconds at
    // 0 bpm. A recovery that filled its gaps would read as a complete ride.
    expect(recovered.channels.heartRate?.slice(600, 630)).toEqual(
      new Array<undefined>(30).fill(undefined),
    );
    expect(recovered.channels.heartRate?.[599]).toBe(159);
    expect(recovered.channels.heartRate?.[630]).toBe(150);
  });

  it('offers the interrupted ride back through the recovery list', async () => {
    const recorder = newRecorder();
    await ride(recorder, 60);

    await harness.discard();
    const listed = await listRecoverableRecordings(harnessStore(), ATHLETE_A);
    expect(listed.map((row) => row.id)).toEqual([recorder.sessionId]);
    expect(listed[0]?.state).toBe('recording');
  });
});

describe('the data-loss bound between checkpoints', () => {
  it('never holds more than the stated bound in memory alone', async () => {
    const recorder = newRecorder();
    await recorder.start(at(0));

    let worst = 0;
    for (let t = 0; t < 300; t += 1) {
      recorder.observeReading(powerReading(t, 200));
      recorder.observeReading(speedReading(t, 9));
      await recorder.tick(at(t));
      // Everything the tab holds that the disk does not. If the tab died right
      // now, this is exactly what the rider would lose.
      worst = Math.max(worst, recorder.session.sampleCount - recorder.flushedThrough);
    }

    expect(worst).toBeGreaterThan(0);
    expect(worst).toBeLessThanOrEqual(MAX_DATA_LOSS_SECONDS);
  });

  it('loses no more than the bound when the tab really dies, measured against disk', async () => {
    const recorder = newRecorder();
    const offered = await ride(recorder, 304);
    const sessionId = recorder.sessionId;
    const heldInMemory = recorder.session.sampleCount - recorder.flushedThrough;

    // The tab dies here: no `stop`, no final flush.
    await harness.discard();

    const recovered = await harness.read(async (store) =>
      store.recoverRecording(ATHLETE_A, sessionId),
    );
    const lost = offered.power.length - (recovered?.sampleCount ?? 0);

    expect(lost).toBeLessThanOrEqual(MAX_DATA_LOSS_SECONDS);
    // The recorder's own accounting agrees with the disk, which is what makes
    // `flushedThrough` safe for a UI to show.
    expect(recovered?.sampleCount).toBe(recorder.flushedThrough);
    expect(lost).toBe(heldInMemory);
    // What did survive is the ride, not a plausible-looking prefix.
    expect(recovered?.channels.power?.slice(0, 10)).toEqual(offered.power.slice(0, 10));
  });
});

describe('a notification that arrives late', () => {
  it('still reaches the disk, because a slot is not flushed until it is sealed', async () => {
    // A strap whose notification is stamped one second behind the recorder's
    // own clock — the ordinary case, not a fault. Flushing the open slots would
    // put those seconds on disk before their samples exist, and every late
    // sample would then be recorded in memory and never written.
    const recorder = newRecorder();
    await recorder.start(at(0));
    for (let t = 0; t < 60; t += 1) {
      recorder.observeReading(powerReading(t, 200));
      recorder.observeReading(speedReading(t, 9));
      if (t >= 1) {
        expect(
          recorder.observeReading({
            channel: 'heartRate',
            value: beatsPerMinute(140 + (t % 10)),
            at: at(t - 1),
          }),
        ).toBe('recorded');
      }
      await recorder.tick(at(t));
    }
    await recorder.stop(at(59));

    await harness.discard();
    const recovered = await harness.read(async (store) =>
      store.recoverRecording(ATHLETE_A, recorder.sessionId),
    );
    expect(recovered?.sampleCount).toBe(60);
    // Every late sample is on disk, at the second it belongs to.
    for (let t = 0; t < 59; t += 1) {
      expect(recovered?.channels.heartRate?.[t]).toBe(140 + ((t + 1) % 10));
    }
  });
});

describe('a recovered ride can be continued, not merely read', () => {
  it('resumes into the same recording and keeps writing to the same rows', async () => {
    const first = newRecorder();
    await ride(first, 120);
    const sessionId = first.sessionId;
    const flushedBefore = first.flushedThrough;

    await harness.discard();

    const resumed = await recoverRecorder({
      store: harnessStore(),
      athleteId: ATHLETE_A,
      sessionId,
    });
    expect(resumed).toBeDefined();
    const recorder = resumed?.recorder;
    if (recorder === undefined) {
      throw new Error('the recovered recorder is the subject of this test');
    }

    // Paused, with the crash recorded as an automatic pause: the rider was not
    // pedalling while the tab was dead.
    expect(recorder.session.state).toBe('paused');
    expect(recorder.session.pauseReason).toBe('automatic');
    expect(recorder.flushedThrough).toBe(flushedBefore);

    // Five minutes later they reopen the tab and carry on.
    await recorder.resume(at(420));
    for (let t = 420; t < 480; t += 1) {
      recorder.observeReading(powerReading(t, 250));
      recorder.observeReading(speedReading(t, 9));
      await recorder.tick(at(t));
    }
    await recorder.stop(at(479));

    const recovered = await harness.read(async (store) =>
      store.recoverRecording(ATHLETE_A, sessionId),
    );
    expect(recovered?.sampleCount).toBe(480);
    expect(recovered?.state).toBe('stopped');
    // The first ride's samples, the crash gap, and the continuation — one
    // series on one grid, with no shift at the join.
    expect(recovered?.channels.power?.[10]).toBe(offeredWatt(10));
    expect(recovered?.channels.power?.[300]).toBeUndefined();
    expect(recovered?.channels.power?.[460]).toBe(250);
    expect(recovered?.chunksAfterGap).toBe(0);
    // The interruption is paused time, not moving time.
    expect(recorder.session.pausedTime).toBeGreaterThanOrEqual(300);
  });

  it('finds nothing to recover for a recording that was never started', async () => {
    await expect(
      recoverRecorder({
        store: harnessStore(),
        athleteId: ATHLETE_A,
        sessionId: recordingSessionId('never'),
      }),
    ).resolves.toBeUndefined();
  });

  it('discards a recovered recording when the rider declines it', async () => {
    const recorder = newRecorder();
    await ride(recorder, 30);
    const sessionId = recorder.sessionId;

    await recorder.discard();

    await harness.discard();
    await expect(
      harness.read(async (store) => store.recoverRecording(ATHLETE_A, sessionId)),
    ).resolves.toBeUndefined();
    await expect(
      harness.read(async (store) => store.listRecordingSessions(ATHLETE_A)),
    ).resolves.toEqual([]);
  });
});

describe('two tabs recording at once', () => {
  it('does not let a second tab destroy the first tab’s ride', async () => {
    const first = newRecorder();
    const second = newRecorder();
    expect(first.sessionId).not.toBe(second.sessionId);

    await first.start(at(0));
    await second.start(at(0));
    for (let t = 0; t < 120; t += 1) {
      first.observeReading(powerReading(t, 100 + (t % 10)));
      first.observeReading(speedReading(t, 9));
      second.observeReading(powerReading(t, 300 + (t % 10)));
      second.observeReading(speedReading(t, 9));
      await first.tick(at(t));
      await second.tick(at(t));
    }
    await first.stop(at(119));
    await second.stop(at(119));

    await harness.discard();
    const firstRead = await harness.read(async (store) =>
      store.recoverRecording(ATHLETE_A, first.sessionId),
    );
    const secondRead = await harness.read(async (store) =>
      store.recoverRecording(ATHLETE_A, second.sessionId),
    );

    expect(firstRead?.sampleCount).toBe(120);
    expect(secondRead?.sampleCount).toBe(120);
    expect(firstRead?.channels.power?.[7]).toBe(107);
    expect(secondRead?.channels.power?.[7]).toBe(307);
  });

  it('does not let one athlete’s recorder reach another athlete’s recording', async () => {
    const mine = newRecorder();
    await ride(mine, 30);

    await harness.discard();
    await expect(
      recoverRecorder({
        store: harnessStore(),
        athleteId: ATHLETE_B,
        sessionId: mine.sessionId,
      }),
    ).resolves.toBeUndefined();
    await expect(listRecoverableRecordings(harnessStore(), ATHLETE_B)).resolves.toEqual([]);
  });
});

describe('running out of storage', () => {
  /**
   * A store that refuses every append after `after` of them, the way a full
   * device does — and **counts the attempts**, because "stopped retrying" is a
   * statement about calls made and not about rows written.
   */
  function quotaBoundStore(after: number): {
    store: RecordingCheckpointStore;
    attempts: () => number;
  } {
    const real = harnessStore();
    let appends = 0;
    return {
      attempts: () => appends,
      store: {
        ...real,
        appendRecordingChunk: async (chunk) => {
          appends += 1;
          if (appends > after) {
            throw new DOMException('the device is out of space', 'QuotaExceededError');
          }
          return real.appendRecordingChunk(chunk);
        },
      },
    };
  }

  it('keeps recording, keeps what is already written, and says what happened', async () => {
    const recorder = newRecorder({ store: quotaBoundStore(4).store });
    const offered = await ride(recorder, 120);
    const sessionId = recorder.sessionId;

    // Not thrown out of the ride. The rider is still riding.
    expect(recorder.session.state).toBe('recording');
    expect(recorder.session.sampleCount).toBe(120);
    expect(recorder.storageState).toBe('quota-exceeded');
    expect(recorder.storageError?.name).toBe('QuotaExceededError');
    // Four flushes landed and no more were attempted; the cursor stopped with
    // them rather than pretending the rest are safe.
    expect(recorder.checkpoints).toBe(4);
    expect(recorder.flushedThrough).toBeLessThan(120);

    // The whole series is still in memory, gaps and all — nothing was thrown
    // away to make room.
    expect(recorder.session.series().channels.power).toHaveLength(120);

    // And what did reach the disk is intact and readable, not half a chunk.
    await harness.discard();
    const recovered = await harness.read(async (store) =>
      store.recoverRecording(ATHLETE_A, sessionId),
    );
    expect(recovered?.sampleCount).toBe(recorder.flushedThrough);
    expect(recovered?.channels.power?.slice(0, 5)).toEqual(offered.power.slice(0, 5));
    expect(recovered?.chunksAfterGap).toBe(0);
  });

  it('stops attempting once quota is refused, because a retry costs a window and fails alike', async () => {
    const bounded = quotaBoundStore(1);
    const recorder = newRecorder({ store: bounded.store });
    await ride(recorder, 60);

    // Two appends: the one that landed, and the one that was refused. Twelve
    // flushes were due over sixty seconds, so the recorder stopped asking after
    // the refusal rather than throwing eleven more at a full device.
    expect(bounded.attempts()).toBe(2);
    expect(recorder.storageState).toBe('quota-exceeded');

    await recorder.flush();
    await recorder.flush();
    expect(bounded.attempts()).toBe(2);
    expect(recorder.checkpoints).toBe(1);
  });

  it('retries the same window after a transient failure, and catches up', async () => {
    const real = harnessStore();
    let failNext = false;
    const flaky: RecordingCheckpointStore = {
      ...real,
      appendRecordingChunk: async (chunk) => {
        if (failNext) {
          failNext = false;
          throw new Error('the transaction was aborted');
        }
        return real.appendRecordingChunk(chunk);
      },
    };

    const recorder = newRecorder({ store: flaky });
    await recorder.start(at(0));
    for (let t = 0; t < 30; t += 1) {
      recorder.observeReading(powerReading(t, 200 + t));
      recorder.observeReading(speedReading(t, 9));
      // One flush fails, and only one.
      failNext = t === 10;
      await recorder.tick(at(t));
    }
    await recorder.stop(at(29));

    // A transient failure is not terminal: the recorder came back to 'ok' and
    // the window it could not write was written by the next flush.
    expect(recorder.storageState).toBe('ok');
    await harness.discard();
    const recovered = await harness.read(async (store) =>
      store.recoverRecording(ATHLETE_A, recorder.sessionId),
    );
    expect(recovered?.sampleCount).toBe(30);
    expect(recovered?.channels.power?.[10]).toBe(210);
    expect(recovered?.channels.power?.[29]).toBe(229);
  });

  it('writes the header on a later flush when the first attempt failed', async () => {
    // A device that was momentarily busy at the moment `start` ran. The ride is
    // not abandoned for it: the header is retried on the next flush, and once
    // it lands the samples follow — from the beginning of the ride, because the
    // cursor never moved while the writes were failing.
    const real = harnessStore();
    let refuse = true;
    const recorder = newRecorder({
      store: {
        ...real,
        putRecordingSession: async (record) => {
          if (refuse) {
            throw new Error('the transaction was aborted');
          }
          return real.putRecordingSession(record);
        },
      },
    });

    await recorder.start(at(0));
    expect(recorder.storageState).toBe('failed');
    for (let t = 0; t < 6; t += 1) {
      recorder.observeReading(powerReading(t, 200));
      recorder.observeReading(speedReading(t, 9));
      await recorder.tick(at(t));
    }
    // The first flush could not write the header either, so it wrote no chunk:
    // a chunk pointing at a recording nothing knows about is unreachable.
    expect(recorder.checkpoints).toBe(0);

    refuse = false;
    for (let t = 6; t < 12; t += 1) {
      recorder.observeReading(powerReading(t, 200));
      recorder.observeReading(speedReading(t, 9));
      await recorder.tick(at(t));
    }
    await recorder.stop(at(11));

    expect(recorder.storageState).toBe('ok');
    await harness.discard();
    const recovered = await harness.read(async (store) =>
      store.recoverRecording(ATHLETE_A, recorder.sessionId),
    );
    expect(recovered?.sampleCount).toBe(12);
    expect(recovered?.channels.power?.[0]).toBe(200);
  });

  it('treats a rejection that is not an object as a plain failure, not as quota', async () => {
    const real = harnessStore();
    const recorder = newRecorder({
      store: {
        ...real,
        appendRecordingChunk: () => {
          // A rejection from a layer below is not guaranteed to be an `Error`,
          // and `isQuotaExceeded` must not read `.name` off a string.
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 'the worker went away';
        },
      },
    });
    await recorder.start(at(0));
    for (let t = 0; t < 8; t += 1) {
      recorder.observeReading(powerReading(t, 200));
      recorder.observeReading(speedReading(t, 9));
      await recorder.tick(at(t));
    }
    expect(recorder.storageState).toBe('failed');
    expect(recorder.storageError?.message).toBe('the worker went away');
  });

  it('does not throw out of start when the header cannot be written', async () => {
    const real = harnessStore();
    const refusing: RecordingCheckpointStore = {
      ...real,
      putRecordingSession: () => {
        throw new DOMException('the device is out of space', 'QuotaExceededError');
      },
    };
    const recorder = newRecorder({ store: refusing });
    await expect(recorder.start(at(0))).resolves.toBeUndefined();
    expect(recorder.session.state).toBe('recording');
    expect(recorder.storageState).toBe('quota-exceeded');
  });
});

describe('auto-pause, and why power is not a movement signal', () => {
  it('pauses a ride that reports power and nothing else, and checkpoints the pause', async () => {
    // The ERG case: a trainer holds a power target while the rider is off the
    // bike getting a drink, so power alone must not keep a ride "moving".
    const recorder = newRecorder();
    await recorder.start(at(0));
    for (let t = 0; t < 40; t += 1) {
      recorder.observeReading(powerReading(t, 200));
      await recorder.tick(at(t));
    }

    expect(recorder.session.state).toBe('paused');
    expect(recorder.session.pauseReason).toBe('automatic');
    // The last tick is at t=39, so 39 seconds elapsed: ten of them moving and
    // the twenty-nine after the back-dated pause not.
    expect(recorder.session.elapsedTime).toBe(39);
    expect(recorder.session.movingTime).toBe(10);
    expect(recorder.session.pausedTime).toBe(29);

    // The pause is on disk, so a crash during it does not come back as moving
    // time — and it is distinguishable from the dropout it looks like.
    await harness.discard();
    const listed = await harness.read(async (store) => store.listRecordingSessions(ATHLETE_A));
    expect(listed[0]?.state).toBe('paused');
    expect(listed[0]?.pauses).toEqual([{ from: at(10), reason: 'automatic' }]);
  });

  it('keeps recording while cadence says the rider is pedalling, with no speed at all', async () => {
    const recorder = newRecorder();
    await recorder.start(at(0));
    for (let t = 0; t < 40; t += 1) {
      recorder.observeReading(powerReading(t, 200));
      recorder.observeReading({
        channel: 'cadence',
        value: revolutionsPerMinute(88),
        at: at(t),
      });
      await recorder.tick(at(t));
    }
    expect(recorder.session.state).toBe('recording');
    expect(recorder.session.pausedTime).toBe(0);
  });

  it('records nothing while paused, and resumes into the same series', async () => {
    const recorder = newRecorder();
    await recorder.start(at(0));
    for (let t = 0; t < 10; t += 1) {
      recorder.observeReading(powerReading(t, 200));
      recorder.observeReading(speedReading(t, 9));
      await recorder.tick(at(t));
    }
    await recorder.pause(at(10));
    for (let t = 10; t < 40; t += 1) {
      expect(recorder.observeReading(powerReading(t, 999))).toBe('paused');
      await recorder.tick(at(t));
    }
    await recorder.resume(at(40));
    for (let t = 40; t < 60; t += 1) {
      recorder.observeReading(powerReading(t, 210));
      recorder.observeReading(speedReading(t, 9));
      await recorder.tick(at(t));
    }
    await recorder.stop(at(59));

    await harness.discard();
    const recovered = await harness.read(async (store) =>
      store.recoverRecording(ATHLETE_A, recorder.sessionId),
    );
    expect(recovered?.sampleCount).toBe(60);
    expect(recovered?.channels.power?.[5]).toBe(200);
    // The paused seconds are holes, and the pause list is what says they are a
    // pause and not a dropout.
    expect(recovered?.channels.power?.[25]).toBeUndefined();
    expect(recovered?.channels.power?.[50]).toBe(210);
    expect(recovered?.pauses).toEqual([{ from: at(10), to: at(40), reason: 'manual' }]);
  });
});

describe('a recorder that has not started', () => {
  it('writes nothing at all, so nothing is offered back as a ride to recover', async () => {
    const recorder = newRecorder();
    await expect(recorder.flush()).resolves.toBe(0);
    expect(recorder.checkpoints).toBe(0);

    await harness.discard();
    await expect(
      harness.read(async (store) => store.listRecordingSessions(ATHLETE_A)),
    ).resolves.toEqual([]);
  });
});

describe('turning auto-pause off', () => {
  it('keeps recording a ride with no movement signal at all when asked to', async () => {
    // #50's GPS-only case, and any ride the athlete has told the client not to
    // pause. Passing `null` is the deliberate spelling; omitting the option
    // gets the default policy.
    const recorder = newRecorder({ autoPause: null });
    await recorder.start(at(0));
    for (let t = 0; t < 60; t += 1) {
      recorder.observeReading(powerReading(t, 200));
      await recorder.tick(at(t));
    }
    expect(recorder.session.state).toBe('recording');
    expect(recorder.session.pausedTime).toBe(0);
    expect(recorder.session.movingTime).toBe(59);
  });
});

describe('the recorder as a sensor consumer', () => {
  it('merges a measurement from the sensor abstraction without an adapter in between', async () => {
    const recorder = newRecorder();
    await recorder.start(at(0));

    const measurement: SensorMeasurement = {
      capability: 'power',
      device: { id: deviceId('trainer-1'), transport: WEB_BLUETOOTH },
      at: at(0),
      power: watts(240),
    };
    expect(recorder.observe(measurement)).toBe('recorded');
    await recorder.stop(at(0));

    await harness.discard();
    const recovered = await harness.read(async (store) =>
      store.recoverRecording(ATHLETE_A, recorder.sessionId),
    );
    expect(recovered?.channels.power?.[0]).toBe(240);
  });

  it('refuses to record for an athlete that does not exist, without ending the ride', async () => {
    const recorder = createRecorder({
      store: harnessStore(),
      athleteId: athleteId('not-an-athlete'),
      sessionId: nextSessionId(),
    });
    await expect(recorder.start(at(0))).resolves.toBeUndefined();
    expect(recorder.storageState).toBe('failed');
    expect(recorder.session.state).toBe('recording');
  });
});

/** The watts `ride` offers at second `t`. Spelled once so a test cannot drift from it. */
function offeredWatt(t: number): number {
  return 180 + (t % 40);
}
