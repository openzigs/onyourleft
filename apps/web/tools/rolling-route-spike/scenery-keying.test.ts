// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2882's question: *"How is stylised scenery keyed (by distance or by place):
 * does riding back down a street show the same scenery?"* — answered by
 * running the product's own `scatter.ts` §`scatterAt` on two profiles, and
 * held here so that the write-up's answer goes red if the keying changes.
 *
 * Today the answer is **by the route**: the seed is `scatterSeed(profile)` —
 * the route's first point and its rounded `totalDistance` — and a cell is a
 * stretch of odometer, `cellSpanMetres(profile)` long, which divides the
 * route's whole length. So (1) a rolling profile that grows re-seeds and
 * re-cuts every cell at every extension, and (2) the same street ridden as
 * part of another route, or the other way, grows other scenery.
 */

import { describe, expect, it } from 'vitest';

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  type GeographicPosition,
} from '@onyourleft/domain';

import { cellSpanMetres, scatterAt, scatterSeed, type ScatterItem } from '../../src/game/scatter';
import { corridorOrigin } from '../../src/game/terrain';

import { RollingProfile } from './rolling-profile';
import { moved } from './turning-ride';

const START = geographicPosition(degreesLatitude(41.9), degreesLongitude(-87.8));
const BUDGET = { maxItems: 400, riderMetres: 0 };

/** Points every 50 m along `heading` for `metres` from `from`. */
function road(from: GeographicPosition, heading: number, metres: number) {
  const points = [];
  for (let at = 50; at <= metres; at += 50) points.push({ position: moved(from, heading, at) });
  return points;
}

/** The items' places, rounded to a decimetre, for comparing two scatters. */
function places(items: readonly ScatterItem[]): string[] {
  return items.map((item) => `${item.kind}@${item.x.toFixed(1)},${item.z.toFixed(1)}`).sort();
}

describe('how the stylised scenery is keyed (#2882)', () => {
  it('re-seeds and re-cuts the cells when a rolling profile grows', () => {
    const rolling = new RollingProfile({ position: START, elevation: 0 });
    rolling.append(road(START, 0, 1_500));
    const before = rolling.view();
    rolling.append(road(moved(START, 0, 1_500), 0, 600));
    const after = rolling.view();
    expect(scatterSeed(after)).not.toBe(scatterSeed(before));
    expect(cellSpanMetres(after)).not.toBe(cellSpanMetres(before));
    // The origin is the first point's, so the two frames are the same frame.
    expect(corridorOrigin(after)).toEqual(corridorOrigin(before));
    const origin = corridorOrigin(before);
    // The same 300 m the rider is on, before and after the road ahead grew.
    const was = scatterAt(before, origin, scatterSeed(before), 600, 900, BUDGET);
    const now = scatterAt(after, origin, scatterSeed(after), 600, 900, BUDGET);
    expect(was.length).toBeGreaterThan(0);
    expect(places(now)).not.toEqual(places(was));
  });

  it('grows other scenery on the same street ridden the other way', () => {
    const far = moved(START, 0, 1_000);
    const north = new RollingProfile({ position: START, elevation: 0 });
    north.append(road(START, 0, 1_000));
    const south = new RollingProfile({ position: far, elevation: 0 });
    south.append(road(far, 180, 1_000));
    const up = north.view();
    const down = south.view();
    // One frame for both, the northbound ride's, so a place is the same (x, z) in both.
    const origin = corridorOrigin(up);
    const there = scatterAt(up, origin, scatterSeed(up), 400, 600, BUDGET);
    const back = scatterAt(down, origin, scatterSeed(down), 400, 600, BUDGET);
    expect(there.length).toBeGreaterThan(0);
    expect(back.length).toBeGreaterThan(0);
    // Both stretches are the street's middle 200 m, and nothing stands in the same place.
    const shared = places(there).filter((place) => places(back).includes(place));
    expect(shared).toEqual([]);
  });
});
