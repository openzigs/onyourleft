// SPDX-License-Identifier: Apache-2.0

/**
 * The synthetic corpus, and the rides run against it.
 *
 * ⚠️ **#65's seventh criterion: no real person's ride files, from any platform,
 * may be used as a fixture** (#21). Everything here is generated from a seeded
 * PRNG, so the corpus is reproducible without being anybody's. That is not only
 * a privacy rule — a spike whose numbers came from one person's riding would be
 * measuring their commute rather than the algorithm.
 *
 * ## What "realistic" means here, and where it falls short
 *
 * The generator lays segments on a **grid of streets** over a city-sized area,
 * which gives the two properties the measurement needs: segments clustered
 * densely enough that a prefilter has real work to do, and roads that run
 * parallel a short distance apart so a false positive is *available* to be
 * made. It does not model junction density, elevation, or the way real riding
 * concentrates on a few corridors.
 *
 * ⚠️ **So the fan-out numbers are a lower bound on difficulty.** A real corpus
 * is more clustered than a uniform grid, so stage 1 would pass through more
 * candidates than measured here, not fewer. The write-up says so rather than
 * presenting the measurement as an upper bound it is not.
 */

import {
  createSegment,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  unixSeconds,
  type GeographicPosition,
  type Segment,
} from '@onyourleft/domain';

import type { RideTrace } from '../src/pipeline';

/**
 * Metres per degree of latitude on the sphere `@onyourleft/domain` uses.
 *
 * The same constant its own tests use. Longitude is scaled by the cosine of the
 * latitude at the point of use, because at 51° N a degree of longitude is 62%
 * of a degree of latitude and a generator that ignored that would lay "parallel
 * roads 20 m apart" that are really 32 m apart — quietly making the
 * false-positive case easier than it is.
 */
const METRES_PER_DEGREE_LATITUDE = 111_194.9;

/** The corner the synthetic city sits at. Arbitrary, and far from anywhere real. */
const ORIGIN_LATITUDE = 51.5;
const ORIGIN_LONGITUDE = -0.12;

/**
 * A seeded PRNG — mulberry32.
 *
 * Seeded rather than `Math.random` so a measurement is reproducible: a fan-out
 * that changed between runs would be unciteable. Thirty-two bits of state is
 * ample for laying out roads; nothing here is cryptographic and nothing
 * pretends to be.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Offset a position by metres north and east. */
export function offsetBy(
  from: GeographicPosition,
  northMetres: number,
  eastMetres: number,
): GeographicPosition {
  const latitude = from.latitude + northMetres / METRES_PER_DEGREE_LATITUDE;
  const metresPerDegreeLongitude =
    METRES_PER_DEGREE_LATITUDE * Math.cos((from.latitude * Math.PI) / 180);
  const longitude = from.longitude + eastMetres / metresPerDegreeLongitude;
  return geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));
}

/** A straight run of `points` positions from `from`, heading north-east by `bearing`. */
export function straightPath(
  from: GeographicPosition,
  bearingDegrees: number,
  lengthMetres: number,
  points: number,
): GeographicPosition[] {
  const radians = (bearingDegrees * Math.PI) / 180;
  return Array.from({ length: points }, (_unused, index) => {
    const along = (lengthMetres * index) / (points - 1);
    return offsetBy(from, along * Math.cos(radians), along * Math.sin(radians));
  });
}

/**
 * A corpus of `count` segments on a street grid.
 *
 * Each is 500 m — comfortably over `MINIMUM_SEGMENT_LENGTH_METRES` — and laid
 * along one of the grid's streets, so segments genuinely share roads with each
 * other rather than being scattered where no prefilter has to work.
 */
export function syntheticCorpus(count: number, seed = 1): Segment[] {
  const random = seededRandom(seed);
  const origin = geographicPosition(
    degreesLatitude(ORIGIN_LATITUDE),
    degreesLongitude(ORIGIN_LONGITUDE),
  );
  // A square-ish grid: enough streets that `count` segments spread over a
  // city rather than stacking on one road.
  const streets = Math.max(4, Math.ceil(Math.sqrt(count)));
  const spacingMetres = 200;

  return Array.from({ length: count }, (_unused, index) => {
    const street = index % streets;
    const alongStreet = Math.floor(index / streets);
    // Northbound streets, segments spaced along each.
    const start = offsetBy(origin, alongStreet * 600, street * spacingMetres);
    // A little jitter so no two segments are byte-identical, which would make
    // the corpus compress in ways a real one does not.
    const bearing = random() * 4 - 2;
    return createSegment({
      id: `segment-${String(index)}`,
      createdBy: 'athlete-a',
      name: `Segment ${String(index)}`,
      sport: 'ride',
      geometry: straightPath(start, bearing, 500, 26),
      elevationSource: 'none',
      visibility: 'private',
      createdAt: unixSeconds(1_760_000_000),
    });
  });
}

/**
 * A four-hour ride at 1 Hz — **14 400 samples**, the size #65's second
 * criterion names.
 *
 * It rides straight up the first street of the grid and then wanders, so it
 * genuinely traverses some of the corpus and merely passes near much more of
 * it. A ride that traversed everything would make the endpoint gate look
 * useless; one that traversed nothing would make it look perfect.
 */
export function fourHourRide(corpus: readonly Segment[], seed = 2): RideTrace {
  const random = seededRandom(seed);
  const positions: GeographicPosition[] = [];
  const times: number[] = [];

  const first = corpus[0];
  const origin =
    first?.geometry[0] ??
    geographicPosition(degreesLatitude(ORIGIN_LATITUDE), degreesLongitude(ORIGIN_LONGITUDE));

  // ~8.3 m per second is 30 km/h.
  let north = 0;
  let east = 0;
  let heading = 0;
  for (let second = 0; second < 4 * 60 * 60; second += 1) {
    // Straight for the first few kilometres — through the corpus's first
    // street — then a slow random walk.
    if (second > 600) {
      heading += (random() - 0.5) * 0.04;
    }
    north += 8.3 * Math.cos(heading);
    east += 8.3 * Math.sin(heading);
    positions.push(offsetBy(origin, north, east));
    times.push(second);
  }
  return { positions, times };
}

/**
 * A ride that traverses `segment` exactly, with GNSS noise added.
 *
 * The known-good traversal the miss-rate measurement counts against: if this
 * does not match, the matcher missed an effort a rider really made.
 *
 * `noiseMetres` is the standard deviation of an independent offset per sample.
 * Real GNSS error is strongly autocorrelated — a receiver under tree cover is
 * wrong in the same direction for many seconds — so independent noise is the
 * *easier* case, and the write-up says so rather than letting a good miss rate
 * stand unqualified.
 */
export function traversalOf(
  segment: Segment,
  options: { readonly noiseMetres?: number; readonly seed?: number; readonly lead?: number } = {},
): RideTrace {
  const random = seededRandom(options.seed ?? 3);
  const noise = options.noiseMetres ?? 0;
  const lead = options.lead ?? 5;

  const positions: GeographicPosition[] = [];
  const times: number[] = [];

  const head = segment.geometry[0];
  if (head === undefined) {
    return { positions, times };
  }

  // A short run-in so the first sample inside the start radius has a heading —
  // `sampleHeading` needs a previous position, and a ride that begins exactly
  // on the start line has none.
  for (let index = 0; index < lead; index += 1) {
    const back = (lead - index) * 20;
    positions.push(offsetBy(head, -back, 0));
    times.push(positions.length - 1);
  }

  for (const point of segment.geometry) {
    const northNoise = noise === 0 ? 0 : (random() - 0.5) * 2 * noise;
    const eastNoise = noise === 0 ? 0 : (random() - 0.5) * 2 * noise;
    positions.push(offsetBy(point, northNoise, eastNoise));
    times.push(positions.length - 1);
  }

  return { positions, times };
}
