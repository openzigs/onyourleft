// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The rule that a stale number is never shown, at the one place it is decided.
 *
 * The interesting case is the last one: a `stale` state must not carry the
 * value anywhere at all, not even in a field nothing currently renders. A field
 * that exists is a field somebody renders.
 */

import { unixSeconds } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { isReadable, metricStateFor, METRIC_STALE_AFTER_SECONDS } from './metrics';

const at = (offset: number) => unixSeconds(1_800_000_000 + offset);

describe('what a live number is allowed to say', () => {
  it('is unpaired when nothing supplies the channel, however recent the reading', () => {
    // A reading may linger from a sensor that has since been forgotten. The
    // rider has no sensor, so the honest answer is "none", not "was 220".
    expect(metricStateFor({ value: 220, at: at(0) }, false, at(0))).toEqual({ kind: 'unpaired' });
  });

  it('is waiting when a sensor is connected and has said nothing yet', () => {
    expect(metricStateFor(undefined, true, at(0))).toEqual({ kind: 'waiting' });
  });

  it('is live inside the threshold', () => {
    expect(metricStateFor({ value: 220, at: at(0) }, true, at(METRIC_STALE_AFTER_SECONDS))).toEqual(
      {
        kind: 'live',
        value: 220,
        at: at(0),
      },
    );
  });

  it('goes stale one second past the threshold, and not before', () => {
    const reading = { value: 220, at: at(0) };
    expect(metricStateFor(reading, true, at(METRIC_STALE_AFTER_SECONDS)).kind).toBe('live');
    expect(metricStateFor(reading, true, at(METRIC_STALE_AFTER_SECONDS + 1)).kind).toBe('stale');
  });

  it('carries no value at all once stale, so nothing can render the last number', () => {
    const state = metricStateFor({ value: 220, at: at(0) }, true, at(60));

    expect(state).toEqual({ kind: 'stale', silentForSeconds: 60 });
    // Structural, not a property lookup: a `lastValue` added later would pass a
    // `state.value === undefined` check and fail this one.
    expect(JSON.stringify(state)).not.toContain('220');
    expect(isReadable(state)).toBe(false);
  });

  it('rounds the silence down to whole seconds, so it never reads ahead of itself', () => {
    const state = metricStateFor({ value: 220, at: at(0) }, true, unixSeconds(1_800_000_009.9));
    expect(state).toEqual({ kind: 'stale', silentForSeconds: 9 });
  });

  it('treats a reading from the future as live rather than as a negative silence', () => {
    // A device clock ahead of this one. The recorder's own future tolerance
    // handles the sample; here the only question is whether the screen shows a
    // number, and a reading that has not aged has not gone stale.
    expect(metricStateFor({ value: 220, at: at(5) }, true, at(0)).kind).toBe('live');
  });
});
