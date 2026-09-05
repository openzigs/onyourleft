// SPDX-License-Identifier: Apache-2.0

/**
 * The recording session: a state machine, and the merge that turns several
 * irregular sensor feeds into one regular record series (#45).
 *
 * ## Time arrives; it is never read and never scheduled
 *
 * There is no `Date.now()` here, no `setTimeout`, and no clock of any kind.
 * That is not only style: `packages/domain/tsconfig.json` narrows `lib` to
 * `ES2024` with `types: []`, so `setTimeout` is not a declared name in this
 * package and a session that wanted to auto-pause "after 30 seconds" could not
 * schedule it if it tried. Every instant is a parameter — `start(at)`,
 * `observe({ at })`, `advanceTo(now)` — which makes every timing case in this
 * file testable without fake timers, and makes the engine identical on the
 * browser (#46) and in a native shell (#85).
 *
 * ## The timeline is a ratchet, because device clocks step
 *
 * A device clock corrected by NTP mid-ride steps, in either direction. A
 * backwards step must not produce out-of-order or duplicated samples, so the
 * session keeps its own timeline and **only ever moves it forward**: a call to
 * `advanceTo` with an earlier instant is ignored and counted in
 * {@link RecordingSession.clockRegressions}. A forward step is honoured, and
 * shows up as what it is — a gap.
 *
 * ## The grid is indexed on wall time, and pauses are recorded separately
 *
 * Slot `i` covers `[startedAt + i * interval, startedAt + (i + 1) * interval)`,
 * so a sample's index *is* its instant. Two consequences, both deliberate:
 *
 * - **Out-of-order arrival is structurally impossible to get wrong.** A reading
 *   is written to the slot its own timestamp names, so the series is strictly
 *   monotonic and duplicate-free whatever order notifications arrive in. There
 *   is no append, so there is nothing to sort.
 * - **A pause leaves empty slots**, exactly like a dropout does. Those two mean
 *   opposite things, so the pauses are recorded as intervals in their own right
 *   ({@link RecordedPause}) rather than left to be inferred from the holes. An
 *   analysis pass that guessed "a long gap in every channel is a pause" would be
 *   wrong precisely when a rider's whole sensor set drops at once.
 *
 * The alternative — indexing the grid on *moving* time so a pause is invisible
 * — was rejected: it makes sample `i`'s instant unrecoverable without replaying
 * the pause list, and ADR 0011's stored `StreamSet` states that sample `i` is at
 * `startedAt + i * sampleInterval`.
 *
 * ## Sensor data is untrusted input
 *
 * `CLAUDE.md` section 6: malformed or hostile GATT payloads come from a device
 * that may not be what it claims. A reading's `at` is a number that came off
 * such a device, and the only thing a recorder does with it is size an array.
 * So a reading far in the future is refused rather than allocating up to it,
 * and the series is capped at {@link DEFAULT_MAX_SAMPLE_COUNT} slots however
 * long the session runs. Neither refusal throws: an exception here would let one
 * bad notification end a four-hour ride, which is a worse outcome than the
 * dropped sample it is trying to report.
 *
 * **Every instant that arrives from outside the caller's own clock is checked
 * by the same helper, before anything moves.** There are three such paths —
 * `observe`, `sensorConnected` and `sensorDisconnected` — and the timeline is a
 * quantity a state transition mutates, so a check written *after* a transition
 * compares that quantity against itself and can never fire. `observe`'s check
 * therefore runs above the auto-pause wake, which resumes at the reading's own
 * instant, and the other two go through `ratchetExternal`. The host's own
 * lifecycle instants (`start`, `pause`, `resume`, `stop`, `advanceTo`) are
 * deliberately *not* held to the tolerance: a throttled tab that resumes after
 * ten minutes has to be able to say so, and a forward step there is a gap
 * rather than an allocation.
 */

import { seconds, unixSeconds, type Seconds, type UnixSeconds } from '../quantities';

import type {
  ChannelOf,
  ChannelReading,
  PauseReason,
  RecordedChannels,
  RecordedPause,
  RecordedSamples,
  RecordedSeries,
  RecordedSlice,
  RecordingChannelMap,
} from './channels';
import { RecordingError } from './errors';

/** Where a session is in its lifecycle. */
export type RecordingState = 'idle' | 'recording' | 'paused' | 'stopped';

/** What became of a reading handed to {@link RecordingSession.observe}. */
export type RecordingOutcome =
  /** Merged into its slot. */
  | 'recorded'
  /** The session is idle or stopped, so there is no series to merge into. */
  | 'not-recording'
  /** The session is paused and the reading is not evidence of movement. */
  | 'paused'
  /** Its slot has already been sealed and handed to persistence. */
  | 'late'
  /** Its timestamp is further ahead of the timeline than the engine will trust. */
  | 'future'
  /** Its slot is beyond the session's sample cap. */
  | 'overflow';

/**
 * How long after the timeline has passed a slot that slot may still be written.
 *
 * Not zero. Sensors notify with the instant they were *received*, and a
 * notification received at 12:00:00.980 belongs in the slot starting at
 * 12:00:00 — but by the time the recorder's next tick runs the timeline may
 * already be at 12:00:01. A zero tolerance would drop those, which is a real
 * sample lost to arithmetic.
 *
 * It is not larger than this because the tolerance is the delay before a
 * sample can be persisted, and #46's data-loss bound is stated in terms of it.
 */
export const DEFAULT_LATE_TOLERANCE_SECONDS = 2;

/**
 * How far ahead of the timeline a reading's own timestamp may be.
 *
 * A sensor whose clock is minutes fast, or a hostile one reporting the year
 * 2100, must not size this engine's arrays. Sixty seconds is well beyond any
 * plausible skew between a receive instant stamped by the host and the host's
 * own clock, and well below anything that costs memory.
 */
export const DEFAULT_FUTURE_TOLERANCE_SECONDS = 60;

/**
 * The largest series this engine will grow, whatever the clock says.
 *
 * 30 days at 1 Hz — deliberately generous, and the same ceiling
 * `@onyourleft/store`'s `MAX_INFLATED_SAMPLES` uses for the same reason. A
 * legitimate recording must never meet it; a session left running by a tab
 * nobody closed, or fed a crafted timestamp, must not grow without bound.
 */
export const DEFAULT_MAX_SAMPLE_COUNT = 30 * 24 * 60 * 60;

/** Auto-pause: how it decides the rider has stopped, and after how long. */
export interface AutoPausePolicy<Channels extends RecordingChannelMap> {
  /** How long without movement before the session pauses itself. */
  readonly after: Seconds;
  /**
   * Whether a reading is evidence the rider is moving.
   *
   * A predicate rather than a channel name and a threshold, because "moving"
   * is not one channel's business: a trainer reports speed, a wheel magnet
   * reports speed, and an indoor ride with neither is moving when the cranks
   * turn. The composition root knows which sensors are connected; this engine
   * does not and should not.
   */
  isMoving(reading: ChannelReading<Channels>): boolean;
}

/** @see createRecordingSession */
export interface RecordingSessionOptions<Channels extends RecordingChannelMap> {
  /**
   * This session's identity, generated by the caller.
   *
   * Supplied rather than generated here: `crypto.randomUUID` is a platform API
   * this package may not name, and a counter would collide across two tabs —
   * which is exactly the case #46 has to keep isolated.
   */
  readonly id: string;
  /** The grid spacing. `seconds(1)` matches what FIT expects. */
  readonly sampleInterval: Seconds;
  /** Absent disables auto-pause entirely. */
  readonly autoPause?: AutoPausePolicy<Channels>;
  /** @see DEFAULT_LATE_TOLERANCE_SECONDS */
  readonly lateToleranceSeconds?: number;
  /** @see DEFAULT_FUTURE_TOLERANCE_SECONDS */
  readonly futureToleranceSeconds?: number;
  /** @see DEFAULT_MAX_SAMPLE_COUNT */
  readonly maxSampleCount?: number;
}

/**
 * Everything needed to continue a session that was interrupted — #46's
 * recovery hands one of these back.
 *
 * It is deliberately the same shape a {@link RecordedSeries} has, plus the
 * session's identity, so that "what was persisted" and "what can be resumed"
 * are the same document and nothing has to be reconstructed.
 */
export interface RecordingSnapshot<Channels extends RecordingChannelMap> {
  readonly id: string;
  readonly startedAt: UnixSeconds;
  readonly sampleInterval: Seconds;
  readonly sampleCount: number;
  readonly channels: RecordedChannels<Channels>;
  readonly pauses: readonly RecordedPause[];
}

/**
 * A recording in progress.
 *
 * Every mutating method takes the instant it happened at. Every reader is a
 * getter, so a consumer can hold the session and re-read rather than
 * subscribing to a stream of numbers.
 */
export interface RecordingSession<Channels extends RecordingChannelMap> {
  readonly id: string;
  readonly state: RecordingState;
  /** Why the session is paused, or `undefined` when it is not. */
  readonly pauseReason: PauseReason | undefined;
  /** The instant `start` was called at, or `undefined` while idle. */
  readonly startedAt: UnixSeconds | undefined;
  /** The furthest instant the session has been told about. Never decreases. */
  readonly timeline: UnixSeconds;
  /** Wall time from the start, pauses **included**. */
  readonly elapsedTime: Seconds;
  /** Wall time from the start, pauses **excluded**. */
  readonly movingTime: Seconds;
  /** Time spent paused. `elapsedTime - movingTime`, exactly. */
  readonly pausedTime: Seconds;
  /** How many slots the series has, gaps included. */
  readonly sampleCount: number;
  /**
   * How many leading slots can no longer change, and are therefore safe to
   * persist. #46 flushes exactly this prefix.
   */
  readonly sealedCount: number;
  /** Channels something has been recorded for, in first-seen order. */
  readonly channels: readonly ChannelOf<Channels>[];
  /** Sensors currently reporting, in first-connected order. */
  readonly connectedSensors: readonly string[];
  /** Readings refused, by reason. Every one of them is a dropped sample. */
  readonly dropped: Readonly<Record<Exclude<RecordingOutcome, 'recorded'>, number>>;
  /** How many times a clock was told to go backwards. */
  readonly clockRegressions: number;

  /** idle → recording. @throws {RecordingError} `illegal-transition` otherwise. */
  start(at: UnixSeconds): void;
  /** recording → paused (manual). @throws {RecordingError} `illegal-transition` otherwise. */
  pause(at: UnixSeconds): void;
  /** paused → recording. @throws {RecordingError} `illegal-transition` otherwise. */
  resume(at: UnixSeconds): void;
  /** recording | paused → stopped. @throws {RecordingError} `illegal-transition` otherwise. */
  stop(at: UnixSeconds): void;

  /**
   * Moves the timeline forward and runs the auto-pause rule.
   *
   * The tick the composition root drives. A no-op once stopped.
   *
   * @throws {RecordingError} `not-started` if the session is idle.
   */
  advanceTo(now: UnixSeconds): void;

  /** Merges one sensor reading. Never throws. @see RecordingOutcome */
  observe(reading: ChannelReading<Channels>): RecordingOutcome;

  /** Notes a sensor as reporting. Does **not** change the session's state. */
  sensorConnected(sensorId: string, at: UnixSeconds): void;
  /** Notes a sensor as gone. Does **not** change the session's state. */
  sensorDisconnected(sensorId: string, at: UnixSeconds): void;

  /** The whole merged series. */
  series(): RecordedSeries<Channels>;
  /** A contiguous window `[fromIndex, toIndex)` of it — what an incremental flush writes. */
  slice(fromIndex: number, toIndex: number): RecordedSlice<Channels>;
  /** Everything #46 needs to continue this session after a crash. */
  snapshot(): RecordingSnapshot<Channels>;
}

/** A pause while it is being accumulated. `to` is filled in when it closes. */
interface OpenPause {
  from: number;
  to?: number;
  reason: PauseReason;
}

/**
 * Creates an idle session. Nothing is recorded until {@link
 * RecordingSession.start}.
 *
 * @throws {RecordingError} `invalid-option` if an option is outside what the
 * engine can honour. Validated at construction rather than at first use, so a
 * misconfigured recorder fails before an athlete has ridden into it.
 */
export function createRecordingSession<Channels extends RecordingChannelMap>(
  options: RecordingSessionOptions<Channels>,
): RecordingSession<Channels> {
  return newSession(options, undefined);
}

/**
 * Rebuilds a session from what was persisted, ready to continue.
 *
 * The restored session is **paused**, with an open automatic pause beginning at
 * the end of the last recovered slot. That is not a convenience: the rider was
 * not pedalling while the tab was dead, so the interruption is paused time and
 * not moving time, and `resume(now)` closes it and continues into the slots
 * after the gap. The gap itself stays a gap, which is the honest record of what
 * the device knows.
 *
 * @throws {RecordingError} `invalid-snapshot` if the snapshot's channel arrays
 * disagree with its `sampleCount`, or its interval is not one this engine can
 * continue on. A snapshot comes off disk, so it is checked rather than trusted.
 */
export function restoreRecordingSession<Channels extends RecordingChannelMap>(
  options: Omit<RecordingSessionOptions<Channels>, 'id' | 'sampleInterval'>,
  snapshot: RecordingSnapshot<Channels>,
): RecordingSession<Channels> {
  return newSession(
    { ...options, id: snapshot.id, sampleInterval: snapshot.sampleInterval },
    snapshot,
  );
}

/**
 * One closure holding one state machine. Everything above is a view of the
 * `let` bindings below; splitting it would mean exporting them.
 */
function newSession<Channels extends RecordingChannelMap>(
  options: RecordingSessionOptions<Channels>,
  snapshot: RecordingSnapshot<Channels> | undefined,
): RecordingSession<Channels> {
  const interval = options.sampleInterval;
  const lateTolerance = options.lateToleranceSeconds ?? DEFAULT_LATE_TOLERANCE_SECONDS;
  const futureTolerance = options.futureToleranceSeconds ?? DEFAULT_FUTURE_TOLERANCE_SECONDS;
  const maxSampleCount = options.maxSampleCount ?? DEFAULT_MAX_SAMPLE_COUNT;
  const autoPause = options.autoPause;

  requireOption(Number.isFinite(interval) && interval > 0, `sampleInterval must be positive`);
  requireOption(
    Number.isFinite(lateTolerance) && lateTolerance >= 0,
    'lateToleranceSeconds must be zero or more',
  );
  requireOption(
    Number.isFinite(futureTolerance) && futureTolerance >= 0,
    'futureToleranceSeconds must be zero or more',
  );
  requireOption(
    Number.isInteger(maxSampleCount) && maxSampleCount > 0,
    'maxSampleCount must be a positive integer',
  );
  requireOption(
    autoPause === undefined || (Number.isFinite(autoPause.after) && autoPause.after > 0),
    'autoPause.after must be positive',
  );

  let state: RecordingState = 'idle';
  let startedAt: number | undefined;
  let stoppedAt: number | undefined;
  let timeline = 0;
  let lastMovementAt = 0;
  let clockRegressions = 0;
  let highestSlotWritten = -1;

  const pauses: OpenPause[] = [];
  const order: ChannelOf<Channels>[] = [];
  const samples = new Map<ChannelOf<Channels>, unknown[]>();
  const sensors: string[] = [];
  const dropped: Record<Exclude<RecordingOutcome, 'recorded'>, number> = {
    'not-recording': 0,
    paused: 0,
    late: 0,
    future: 0,
    overflow: 0,
  };

  if (snapshot !== undefined) {
    restore(snapshot);
  }

  function restore(from: RecordingSnapshot<Channels>): void {
    requireSnapshot(
      Number.isInteger(from.sampleCount) && from.sampleCount >= 0,
      `sampleCount must be a non-negative integer, received ${String(from.sampleCount)}`,
    );
    requireSnapshot(
      from.sampleCount <= maxSampleCount,
      `sampleCount ${String(from.sampleCount)} is above the ${String(maxSampleCount)} slots ` +
        `this build will hold`,
    );
    for (const [channel, values] of Object.entries(from.channels) as [
      ChannelOf<Channels>,
      RecordedSamples<Channels, ChannelOf<Channels>> | undefined,
    ][]) {
      if (values === undefined) {
        continue;
      }
      requireSnapshot(
        values.length === from.sampleCount,
        `channel ${channel} has ${String(values.length)} samples but the snapshot declares ` +
          `${String(from.sampleCount)}. Every channel shares one time base`,
      );
      order.push(channel);
      samples.set(channel, [...values]);
    }

    startedAt = from.startedAt;
    highestSlotWritten = from.sampleCount - 1;
    // The **start** of the last recovered slot, not its end.
    //
    // The end reads as the more natural choice — it is the last instant the
    // recording knows anything about — and it makes `restore` grow the series
    // by one empty slot every time it runs, because the timeline would already
    // have entered the next slot. A recording recovered, snapshotted and
    // recovered again would gain a second each round. Anchoring on the last
    // slot's own instant makes snapshot and restore idempotent for every
    // snapshot a recording produces, and costs less than one sample interval of
    // precision on where the interruption began.
    //
    // **One snapshot is not one a recording produces, and it is not idempotent:
    // `sampleCount: 0`.** `session.snapshot()` of a started session always
    // reports at least one slot, because a recording that has started has by
    // definition entered its first second — but #46 writes the session header
    // before the first chunk, so a crash in that window recovers a header with
    // no samples. Restoring it yields one empty leading slot rather than none,
    // which is that first second and not an invented one. Restoring *that*
    // snapshot is stable, so nothing accumulates; `session.test.ts` pins both
    // halves.
    const lastRecoveredSlot = from.startedAt + Math.max(0, from.sampleCount - 1) * interval;
    timeline = Math.max(from.startedAt, lastRecoveredSlot);
    lastMovementAt = timeline;
    for (const pause of from.pauses) {
      pauses.push({
        from: pause.from,
        ...(pause.to === undefined ? {} : { to: pause.to }),
        reason: pause.reason,
      });
    }
    const open = pauses.at(-1);
    if (open === undefined || open.to !== undefined) {
      // The crash gap itself. Automatic, because nobody asked for it.
      pauses.push({ from: timeline, reason: 'automatic' });
    }
    state = 'paused';
  }

  function endInstant(): number {
    return stoppedAt ?? timeline;
  }

  function slotFor(at: number): number {
    return Math.floor((at - (startedAt ?? at)) / interval);
  }

  function computeSampleCount(): number {
    if (startedAt === undefined) {
      return 0;
    }
    // "How many slots has this recording entered", which is what makes a
    // sample's index its instant. `highestSlotWritten` keeps a reading that
    // arrived from just beyond the timeline inside the series it was written to.
    const entered = slotFor(endInstant()) + 1;
    return Math.min(Math.max(entered, highestSlotWritten + 1, 0), maxSampleCount);
  }

  function computeSealedCount(): number {
    if (startedAt === undefined) {
      return 0;
    }
    const sealed = slotFor(endInstant() - lateTolerance) + 1;
    return Math.min(Math.max(sealed, 0), computeSampleCount());
  }

  function pausedSeconds(): number {
    const end = endInstant();
    let total = 0;
    for (const pause of pauses) {
      total += Math.max(0, (pause.to ?? end) - pause.from);
    }
    return total;
  }

  function requireState(allowed: readonly RecordingState[], action: string): void {
    if (!allowed.includes(state)) {
      throw new RecordingError(
        'illegal-transition',
        `cannot ${action} a ${state} recording session; ${action} is legal only from ` +
          `${allowed.join(' or ')}`,
      );
    }
  }

  /** Moves the timeline to `at` if that is forward, and returns where it now is. */
  function ratchet(at: number): number {
    if (at > timeline) {
      timeline = at;
    }
    return timeline;
  }

  /**
   * Whether an instant that arrived from *outside* the caller's own clock is
   * close enough to the timeline to be allowed to move it.
   *
   * Read this against {@link ratchetExternal} below, and note where each is
   * called from. The distinction is the caller, not the value: `advanceTo`,
   * `start`, `pause`, `resume` and `stop` carry the host's own clock, and a
   * throttled tab that resumes after ten minutes has to be able to say so — so
   * those are not held to a tolerance. A sensor reading's `at` and a connection
   * event's `at` are the untrusted ones, and they are the ones that can size an
   * array.
   */
  function withinFutureTolerance(at: number): boolean {
    return at <= timeline + futureTolerance;
  }

  /**
   * The **only** way an instant from outside may move the timeline.
   *
   * Every such path goes through here rather than checking for itself, because
   * a check written next to one caller is a check the next caller does not
   * have — and because a guard placed *after* a call that ratchets is not a
   * guard at all: `resume()` and `ratchet()` both move the very quantity the
   * comparison is against, so by the time it runs it can only ever be false.
   *
   * @returns whether `at` was trusted. An untrusted instant moves nothing.
   */
  function ratchetExternal(at: number): boolean {
    if (!withinFutureTolerance(at)) {
      return false;
    }
    ratchet(at);
    return true;
  }

  function closeOpenPause(at: number): void {
    const open = pauses.at(-1);
    if (open !== undefined && open.to === undefined) {
      open.to = Math.max(open.from, at);
    }
  }

  function beginPause(at: number, reason: PauseReason): void {
    const from = Math.max(startedAt ?? at, Math.min(at, timeline));
    pauses.push({ from, reason });
    state = 'paused';
  }

  function densify<C extends ChannelOf<Channels>>(
    values: readonly unknown[] | undefined,
    from: number,
    count: number,
  ): RecordedSamples<Channels, C> {
    const out = new Array<Channels[C] | undefined>(count);
    for (let index = 0; index < count; index += 1) {
      out[index] = values?.[from + index] as Channels[C] | undefined;
    }
    return out;
  }

  function channelsBetween(from: number, count: number): RecordedChannels<Channels> {
    const out: Record<string, RecordedSamples<Channels, ChannelOf<Channels>>> = {};
    for (const channel of order) {
      out[channel] = densify(samples.get(channel), from, count);
    }
    return out as RecordedChannels<Channels>;
  }

  function frozenPauses(): readonly RecordedPause[] {
    return pauses.map((pause) => ({
      from: unixSeconds(pause.from),
      ...(pause.to === undefined ? {} : { to: unixSeconds(pause.to) }),
      reason: pause.reason,
    }));
  }

  const session: RecordingSession<Channels> = {
    id: options.id,
    get state() {
      return state;
    },
    get pauseReason(): PauseReason | undefined {
      if (state !== 'paused') {
        return undefined;
      }
      return pauses.at(-1)?.reason;
    },
    get startedAt(): UnixSeconds | undefined {
      return startedAt === undefined ? undefined : unixSeconds(startedAt);
    },
    get timeline(): UnixSeconds {
      return unixSeconds(timeline);
    },
    get elapsedTime(): Seconds {
      return seconds(startedAt === undefined ? 0 : Math.max(0, endInstant() - startedAt));
    },
    get movingTime(): Seconds {
      const elapsed = startedAt === undefined ? 0 : Math.max(0, endInstant() - startedAt);
      return seconds(Math.max(0, elapsed - pausedSeconds()));
    },
    get pausedTime(): Seconds {
      return seconds(Math.max(0, pausedSeconds()));
    },
    get sampleCount(): number {
      return computeSampleCount();
    },
    get sealedCount(): number {
      return computeSealedCount();
    },
    get channels(): readonly ChannelOf<Channels>[] {
      return [...order];
    },
    get connectedSensors(): readonly string[] {
      return [...sensors];
    },
    get dropped() {
      return { ...dropped };
    },
    get clockRegressions(): number {
      return clockRegressions;
    },

    start(at: UnixSeconds): void {
      requireState(['idle'], 'start');
      startedAt = at;
      timeline = at;
      lastMovementAt = at;
      state = 'recording';
    },

    pause(at: UnixSeconds): void {
      requireState(['recording'], 'pause');
      beginPause(ratchet(at), 'manual');
    },

    resume(at: UnixSeconds): void {
      requireState(['paused'], 'resume');
      const now = ratchet(at);
      closeOpenPause(now);
      lastMovementAt = now;
      state = 'recording';
    },

    stop(at: UnixSeconds): void {
      requireState(['recording', 'paused'], 'stop');
      const now = ratchet(at);
      closeOpenPause(now);
      stoppedAt = now;
      state = 'stopped';
    },

    advanceTo(now: UnixSeconds): void {
      if (state === 'idle') {
        throw new RecordingError('not-started', 'cannot advance a session that has not started');
      }
      if (state === 'stopped') {
        return;
      }
      if (now < timeline) {
        // An NTP correction, a suspended tab resuming with a corrected clock, or
        // a caller passing a stale instant. Whichever it is, the series must not
        // move backwards, so the step is recorded and discarded.
        clockRegressions += 1;
        return;
      }
      timeline = now;
      if (
        state === 'recording' &&
        autoPause !== undefined &&
        timeline - lastMovementAt >= autoPause.after
      ) {
        // Backdated to the instant movement actually stopped, not to now. The
        // paused duration is then a property of the ride rather than of how
        // often the caller happened to tick.
        beginPause(lastMovementAt + autoPause.after, 'automatic');
      }
    },

    observe(reading: ChannelReading<Channels>): RecordingOutcome {
      if (state === 'idle' || state === 'stopped') {
        dropped['not-recording'] += 1;
        return 'not-recording';
      }
      // Before the wake below, and before anything else that could move the
      // timeline. `session.resume(reading.at)` ratchets to this reading's own
      // instant, so a tolerance checked after it compares the instant against
      // itself and can never fire — and an untrusted instant that got that far
      // would seal every slot behind it, which silently ends the recording.
      if (!withinFutureTolerance(reading.at)) {
        dropped.future += 1;
        return 'future';
      }
      if (state === 'paused') {
        const wakes =
          pauses.at(-1)?.reason === 'automatic' &&
          autoPause !== undefined &&
          autoPause.isMoving(reading);
        if (!wakes) {
          dropped.paused += 1;
          return 'paused';
        }
        // Movement ends an automatic pause the moment it is seen. A *manual*
        // pause is never ended this way: a rider who pressed pause at a cafe
        // and knocked the cranks has not restarted their ride.
        session.resume(reading.at);
      }
      // A reading is itself evidence that time has passed, so it moves the
      // timeline — but only forward, exactly like `advanceTo`.
      ratchet(reading.at);
      const slot = slotFor(reading.at);
      if (slot < 0 || slot < computeSealedCount()) {
        dropped.late += 1;
        return 'late';
      }
      if (slot >= maxSampleCount) {
        dropped.overflow += 1;
        return 'overflow';
      }
      let values = samples.get(reading.channel);
      if (values === undefined) {
        values = [];
        samples.set(reading.channel, values);
        order.push(reading.channel);
      }
      values[slot] = reading.value;
      if (slot > highestSlotWritten) {
        highestSlotWritten = slot;
      }
      if (autoPause !== undefined && autoPause.isMoving(reading) && reading.at > lastMovementAt) {
        lastMovementAt = reading.at;
      }
      return 'recorded';
    },

    sensorConnected(sensorId: string, at: UnixSeconds): void {
      if (state !== 'idle' && state !== 'stopped') {
        // The instant is held to the same tolerance a reading's is, and for the
        // same reason: it comes from a device event. A refused instant costs
        // nothing — the next tick moves the timeline — while an accepted one in
        // the year 2150 would end the ride.
        ratchetExternal(at);
      }
      if (!sensors.includes(sensorId)) {
        sensors.push(sensorId);
      }
    },

    sensorDisconnected(sensorId: string, at: UnixSeconds): void {
      if (state !== 'idle' && state !== 'stopped') {
        ratchetExternal(at);
      }
      const index = sensors.indexOf(sensorId);
      if (index >= 0) {
        sensors.splice(index, 1);
      }
    },

    series(): RecordedSeries<Channels> {
      const count = computeSampleCount();
      return {
        startedAt: unixSeconds(startedAt ?? 0),
        sampleInterval: interval,
        sampleCount: count,
        channels: channelsBetween(0, count),
        pauses: frozenPauses(),
      };
    },

    slice(fromIndex: number, toIndex: number): RecordedSlice<Channels> {
      const count = computeSampleCount();
      const from = Math.min(Math.max(0, Math.trunc(fromIndex)), count);
      const to = Math.min(Math.max(from, Math.trunc(toIndex)), count);
      return {
        fromIndex: from,
        sampleCount: to - from,
        channels: channelsBetween(from, to - from),
      };
    },

    snapshot(): RecordingSnapshot<Channels> {
      const series = session.series();
      return {
        id: options.id,
        startedAt: series.startedAt,
        sampleInterval: series.sampleInterval,
        sampleCount: series.sampleCount,
        channels: series.channels,
        pauses: series.pauses,
      };
    },
  };

  return session;
}

function requireOption(held: boolean, message: string): void {
  if (!held) {
    throw new RecordingError('invalid-option', message);
  }
}

function requireSnapshot(held: boolean, message: string): void {
  if (!held) {
    throw new RecordingError('invalid-snapshot', `cannot restore this recording: ${message}`);
  }
}
