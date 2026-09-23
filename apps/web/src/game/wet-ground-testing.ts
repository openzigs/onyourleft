// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where the wet margin lands on a route that HAS water — #501's review.
 *
 * The first check that dry ground stays untinted rode a route with no water at
 * all, so it could not see the tint reaching dry ground on a route that has
 * some — and on the soak route it reached a hillside 200 to 420 m past a
 * lake's far shore. So this reads a frame of a route with water, and sorts
 * every vertex of its ground into near the water and far from it by bounds
 * written here from the public constants, not by asking `waterShaping`.
 *
 * A **`-testing.ts`**: test support, which `check:wiring` does not count as a
 * module the product fails to import.
 */

import { metres, type RouteProfile } from '@onyourleft/domain';

import { scatterSeed } from './scatter';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { corridorOrigin } from './terrain';
import { WET_GROUND_TINT, wetness } from './landform';
import {
  CHANNEL_BANK_METRES,
  LAKE_BANK_METRES,
  LAKE_FAR_METRES,
  waterShaping,
  waterways,
} from './waterways';

/** What one frame's ground says about the wet margin. */
export interface WetGroundAudit {
  /** Vertices far from every water that carry a tint. Must be 0. */
  readonly farTinted: number;
  /**
   * Vertices far from every water whose ground lies BELOW a lake's surface —
   * the ground a tint by height alone would have darkened. What makes a
   * `farTinted` of 0 mean something.
   */
  readonly farBelowWater: number;
  /** Vertices far from every water, all told. */
  readonly far: number;
  /** Vertices carrying a tint at all — the margin is still there. */
  readonly tinted: number;
  /**
   * Vertices wetter than `WaterShaping.shore` allows there — the margin not
   * fading out as it leaves the water. Must be 0.
   */
  readonly overShore: number;
  /**
   * Vertices part-way out of the shore's reach whose height alone would make
   * them wetter than the shore allows — where the fade actually bites, so what
   * makes an `overShore` of 0 mean something.
   */
  readonly fading: number;
}

/**
 * How wet a vertex was drawn, read back off its colour: the tint multiplies
 * red and blue by different amounts, so their ratio says how much of it
 * applies whatever the ground's own grey was.
 */
function drawnWetness(r: number, b: number): number {
  const [red, , blue] = WET_GROUND_TINT;
  const ratio = b / r;
  // ratio = (1 + (blue − 1)·w) / (1 + (red − 1)·w), solved for w.
  return (ratio - 1) / (blue - 1 - ratio * (red - 1));
}

/**
 * Audit the ground of the frame drawn at `odometer` on `profile`, which must
 * not be a loop: the ground's `fields` carry the odometer, which is route
 * distance only on a route that does not wrap.
 */
export function auditWetGround(profile: RouteProfile, odometer: number): WetGroundAudit {
  if (profile.loop) throw new Error('auditWetGround reads route distance off the odometer');
  const origin = corridorOrigin(profile);
  const ways = waterways(profile, scatterSeed(profile));
  const start = atStartLine(profile);
  const { vertices, colours, fields } = sceneFrame({
    profile,
    origin,
    state: { ...start, ride: { ...start.ride, distance: metres(odometer) } },
  }).terrain.mesh;
  let farTinted = 0;
  let farBelowWater = 0;
  let far = 0;
  let tinted = 0;
  let overShore = 0;
  let fading = 0;
  for (let at = 0; at * 3 < colours.length; at += 1) {
    const r = colours[at * 3] as number;
    const g = colours[at * 3 + 1] as number;
    const b = colours[at * 3 + 2] as number;
    // The ground's own mottle is grey; only the wet tint makes it not.
    const isTinted = !(r === g && g === b);
    if (isTinted) tinted += 1;
    const distance = fields[at * 2] as number;
    const lateral = fields[at * 2 + 1] as number;
    const height = vertices[at * 3 + 1] as number;
    // `road` moves only the ceiling, which is not read here.
    const { level, shore } = waterShaping(ways, profile, origin, distance, lateral, 0);
    if (isTinted && drawnWetness(r, b) > shore + 1e-4) overShore += 1;
    if (shore > 0 && wetness(height, level) > shore + 0.05) fading += 1;
    const nearStream = ways.crossings.some(
      (crossing) => Math.abs(distance - crossing.distance) <= CHANNEL_BANK_METRES,
    );
    const nearLake = ways.lakes.some(
      (lake) =>
        Math.sign(lateral) === lake.side &&
        distance >= lake.from &&
        distance <= lake.to &&
        Math.abs(lateral) <= LAKE_FAR_METRES + LAKE_BANK_METRES,
    );
    if (nearStream || nearLake) continue;
    far += 1;
    if (isTinted) farTinted += 1;
    if (ways.lakes.some((lake) => height < lake.waterElevation - origin.elevation)) {
      farBelowWater += 1;
    }
  }
  return { farTinted, farBelowWater, far, tinted, overShore, fading };
}
