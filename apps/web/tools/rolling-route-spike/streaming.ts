// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2882's spike: the two streaming numbers the write-up asks for, counted
 * over hour-long scripted rides on the real z15 grid. Throwaway (see
 * `rolling-profile.ts`); `run-streaming.mjs` writes `results/streaming.json`.
 *
 * - **Tiles read an hour**: every block that comes within the reach of a ride
 *   that turns 90° every 300 to 500 m, counted once (the ridden-tile cache).
 * - **The lead at 40 km/h**: the shortest extra reach, in 10 m steps, at which
 *   no block is needed before it is ready, when each is ready a measured time
 *   after it is asked for (the page's block read plus its plan latency).
 */

import { streamRide, type LatLon } from './block-grid';
import { ridden, turningLegs } from './turning-ride';

/** Long enough for an hour at 40 km/h: 40 km in legs of 300 to 500 m. */
const HOUR_LEGS = 110;

/**
 * How the turns are chosen. `random`: left or right from the seed, the page's
 * ride, which wanders and comes back over its own blocks. `staircase`: left
 * and right in turn, so the ride heads one way all hour and never comes back,
 * which is the most a turning ride can read.
 */
export type TurnPattern = 'random' | 'staircase';

/** The scripted ride's positions, one a second, at `kmh` for an hour from `start`. */
export function hourRide(
  start: LatLon,
  seed: number,
  kmh: number,
  pattern: TurnPattern = 'random',
): LatLon[] {
  const legs = turningLegs(seed, HOUR_LEGS).map((leg, index) =>
    pattern === 'random'
      ? leg
      : { ...leg, heading: index % 2 === 0 ? (0 as const) : (90 as const) },
  );
  const path = ridden(start, legs, kmh / 3.6, 1);
  return path.slice(0, 3_601);
}

/** The shortest lead, in `step`-metre steps up to `most`, with nothing late; `undefined` past it. */
export function leadNeeded(options: {
  readonly path: readonly LatLon[];
  readonly size: number;
  readonly need: number;
  readonly readyAfterMs: number;
  readonly step?: number;
  readonly most?: number;
}): number | undefined {
  const step = options.step ?? 10;
  const most = options.most ?? 2_000;
  for (let lead = 0; lead <= most; lead += step) {
    const count = streamRide({ ...options, stepSeconds: 1, lead });
    if (count.late === 0) return lead;
  }
  return undefined;
}
