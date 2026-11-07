// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride's running totals — #2076. That the saved ride and the HUD read them
 * from one place is `ride/controller.test.ts` §"#2076"; this is the rule.
 */

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  metres,
  metresPerSecond,
  recordedAscent,
  seconds,
  unixSeconds,
  watts,
  type RecordedSeries,
} from '@onyourleft/domain';
import type { StreamChannelValue } from '@onyourleft/store';

import { rideAveragePower, rideClimbed, rideDistance, rideTotals } from './totals';

function series(
  channels: RecordedSeries<StreamChannelValue>['channels'],
  sampleCount: number,
): RecordedSeries<StreamChannelValue> {
  return {
    startedAt: unixSeconds(1_800_000_000),
    sampleInterval: seconds(1),
    sampleCount,
    channels,
    pauses: [],
  };
}

describe('the ride so far (#2076)', () => {
  it('integrates the speed it has, and adds nothing for a dropout', () => {
    const ridden = series({ speed: [metresPerSecond(10), undefined, metresPerSecond(8)] }, 3);
    expect(rideDistance(ridden)).toBe(18);
    expect(rideDistance(series({}, 3))).toBe(0);
  });

  it('averages the power readings that exist, rounded, and has none with none', () => {
    expect(rideAveragePower([watts(200), undefined, watts(251)])).toBe(226);
    expect(rideAveragePower([undefined, undefined])).toBeUndefined();
    expect(rideAveragePower(undefined)).toBeUndefined();
  });

  it('climbs what the altitude readings climbed, by the saved ride’s own rule', () => {
    const altitude = [100, 104, 112, 109, 130, undefined, 131].map((each) =>
      each === undefined ? undefined : altitudeMetres(each),
    );
    const ridden = series({ altitude }, altitude.length);
    expect(rideClimbed(ridden, [{ ascent: metres(999) }])).toBe(recordedAscent(altitude));
  });

  it('with no altitude, climbs what its laps state, the lap in progress included', () => {
    const indoor = series({ power: [watts(200)] }, 1);
    expect(
      rideClimbed(indoor, [{ ascent: metres(14) }, { ascent: undefined }, { ascent: metres(4) }]),
    ).toBe(18);
  });

  it('climbs nothing anybody measured as undefined, never as nought', () => {
    const indoor = series({ power: [watts(200)] }, 1);
    expect(rideClimbed(indoor, [])).toBeUndefined();
    expect(rideClimbed(indoor, [{ ascent: undefined }])).toBeUndefined();
  });

  it('puts the three together', () => {
    const ridden = series(
      { speed: [metresPerSecond(5), metresPerSecond(5)], power: [watts(150), watts(250)] },
      2,
    );
    expect(rideTotals(ridden, [{ ascent: metres(3) }])).toEqual({
      distance: 10,
      climbed: 3,
      averagePower: 200,
    });
  });
});
