// SPDX-License-Identifier: Apache-2.0

/**
 * Putting a value in the wrong channel is a **compile** error.
 *
 * The same mechanism `unit-safety.test.ts` uses, for the same reason and with
 * the same caveat: the assertion is the `// @ts-expect-error` directive, not
 * the `expect` beside it. If a case below ever starts to compile, TypeScript
 * reports `TS2578: Unused '@ts-expect-error' directive`, `pnpm run typecheck`
 * fails, and CI fails with it.
 *
 * This is the guarantee that survives generalising the engine over a channel
 * map. A `ChannelReading` written as `{ channel: keyof Channels; value:
 * Channels[keyof Channels] }` would be shorter and would accept every value for
 * every channel — and a cadence, a heart rate and a power reading are all small
 * positive numbers, so nothing at run time could tell a transposition from a
 * ride. The union distributed per channel is what makes them different types.
 *
 * ⚠️ **Each reading is built as a `const` annotated with {@link ReadingFor},
 * not written inline in the `observe(...)` call.** Two things move where
 * TypeScript reports the error, and both were found by writing this file the
 * obvious way first and watching it fail for the wrong reason: an object
 * literal passed straight to a parameter is faulted at the *argument*, and a
 * literal assigned to a *union* is faulted at the binding, because the compiler
 * cannot say which member was meant. Either way a directive over the offending
 * property is unused and the file goes red with `TS2578` while the guarantee it
 * documents is intact. Annotating with the single member under test puts the
 * error back on the property, which is where a directive can name the specific
 * transposition rather than blanketing a statement.
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

import type { ChannelReading } from './channels';
import { createRecordingSession } from './session';

interface TestChannels {
  power: Watts;
  heartRate: BeatsPerMinute;
  cadence: RevolutionsPerMinute;
  speed: MetresPerSecond;
}

const AT = unixSeconds(1_700_000_000);

/**
 * The reading type for **one** channel.
 *
 * Annotating with the whole union reports a mismatch at the binding rather than
 * at the property — TypeScript cannot say which member was meant, so it faults
 * the assignment as a whole and a directive over `value` is unused. Narrowing
 * the annotation to the member under test puts the error back on the property,
 * which is what lets each directive name the specific transposition.
 */
type ReadingFor<C extends keyof TestChannels> = Extract<
  ChannelReading<TestChannels>,
  { channel: C }
>;

function session() {
  const created = createRecordingSession<TestChannels>({
    id: 'safety',
    sampleInterval: seconds(1),
  });
  created.start(AT);
  return created;
}

describe('a reading cannot carry the wrong quantity for its channel', () => {
  it('refuses a heart rate in the power channel', () => {
    const wrong: ReadingFor<'power'> = {
      channel: 'power',
      // @ts-expect-error a heart rate is not a power; both are small positive numbers
      value: beatsPerMinute(140),
      at: AT,
    };
    const recording = session();
    recording.observe(wrong);
    // The run-time consequence, which is why the compile error is worth having:
    // 140 bpm becomes 140 W and nothing anywhere can tell.
    expect(recording.series().channels.power?.[0]).toBe(140);
  });

  it('refuses a cadence in the speed channel', () => {
    const wrong: ReadingFor<'speed'> = {
      channel: 'speed',
      // @ts-expect-error 90 rpm is not 90 m/s, however alike the numbers look
      value: revolutionsPerMinute(90),
      at: AT,
    };
    const recording = session();
    recording.observe(wrong);
    expect(recording.series().channels.speed?.[0]).toBe(90);
  });

  it('refuses a bare number, which has not been validated at all', () => {
    const wrong: ReadingFor<'power'> = {
      channel: 'power',
      // @ts-expect-error a plain number carries no unit and has not been range-checked
      value: 240,
      at: AT,
    };
    const recording = session();
    recording.observe(wrong);
    expect(recording.series().channels.power?.[0]).toBe(240);
  });

  it('refuses an unvalidated instant', () => {
    const wrong: ReadingFor<'power'> = {
      channel: 'power',
      value: watts(240),
      // @ts-expect-error an instant is constructed by `unixSeconds`, which validates it
      at: 1_700_000_000,
    };
    const recording = session();
    recording.observe(wrong);
    expect(recording.series().channels.power?.[0]).toBe(240);
  });

  it('refuses a duration where an instant is required', () => {
    const wrong: ReadingFor<'speed'> = {
      channel: 'speed',
      value: metresPerSecond(9),
      // @ts-expect-error a duration is not an instant; this would date the sample to 1970
      at: seconds(30),
    };
    const recording = session();
    // The run-time consequence: `seconds(30)` reads as thirty seconds after
    // 1970, which is fifty-three years before the session started, so the
    // sample lands in a negative slot and is discarded without a word.
    expect(recording.observe(wrong)).toBe('late');
    expect(recording.series().channels.speed).toBeUndefined();
  });

  it('refuses a channel the map does not declare', () => {
    const recording = session();
    // @ts-expect-error `altitude` is not one of this map's four channels
    recording.observe({ channel: 'altitude', value: watts(1), at: AT });
    // At run time the engine is generic and cheerfully opens a ninth channel
    // for it — which is precisely why the compile error is the guarantee. A
    // channel the composition root never maps is a channel nothing persists.
    expect(recording.channels).toEqual(['altitude']);
  });
});

describe('the channel map is what makes a reading well typed', () => {
  it('accepts each of the four channels with its own quantity', () => {
    const readings: ChannelReading<TestChannels>[] = [
      { channel: 'power', value: watts(250), at: AT },
      { channel: 'heartRate', value: beatsPerMinute(150), at: AT },
      { channel: 'cadence', value: revolutionsPerMinute(90), at: AT },
      { channel: 'speed', value: metresPerSecond(9), at: AT },
    ];
    const recording = session();
    for (const reading of readings) {
      expect(recording.observe(reading)).toBe('recorded');
    }
    expect(recording.channels).toEqual(['power', 'heartRate', 'cadence', 'speed']);
  });
});
