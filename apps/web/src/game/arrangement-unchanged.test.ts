// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The same route still produces the same world — #341's own criterion.
 *
 * ## Why this file exists, and why it is not part of `scatter.test.ts`
 *
 * #341 replaces five generated solids with models from the CC0 pack
 * [ADR 0022](../../../../docs/adr/0022-game-scenery-model-pack.md) names. Its most
 * important requirement is a **negative** one, and both the issue and D-4 state
 * it in the same words: *"If a route produces a different arrangement of
 * scenery after this lands, that is a defect, and a test should say so."*
 *
 * `scatter.ts` decides **where** scenery goes — the seeded hash of position,
 * the verge, the budget and its distance-biased thinning, the tree line — and
 * none of it is touched by that change. But "none of it is touched" is a claim
 * about a diff, and a diff is exactly what a reviewer of a 300-line renderer
 * change stops reading carefully. So the claim is pinned to a number instead.
 *
 * ## What the number is, and what makes it evidence
 *
 * A digest of every field of every item of thirty-two frames of a bending,
 * climbing, 3 km route — kind, position, rotation and scale, at a fixed
 * precision — taken through the **real** `sceneFrame`, which is the path the
 * renderer is actually handed. ⚠️ **It was computed on `main`, before a line of
 * #341 was written**, and committed unchanged. A golden generated *after* a
 * change describes the change rather than guarding against it, which is this
 * repository's §5 trap in its purest form.
 *
 * ⚠️ **A digest alone can be satisfied by an empty world**, so the counts and
 * three fully written-out items sit beside it: a frame that stopped placing
 * anything, a kind that stopped appearing, or a thinning that started returning
 * the same item twice all fail on those before the digest is reached.
 *
 * ## What it deliberately does not say
 *
 * Nothing about what an item **looks like**. That is the half #341 changes, and
 * `three-renderer.test.ts` and `game.browser.spec.ts` are where it is asserted.
 * This file would be equally green with every kind drawn as a cube.
 */

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  routeProfile,
  type RoutePoint,
} from '@onyourleft/domain';

import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { corridorOrigin } from './terrain';
import { SCATTER_KINDS, type ScatterItem } from './scatter';

const LATITUDE_DEGREES = 51.5;
const METRES_PER_DEGREE_LATITUDE = 111_320;

/**
 * A 3 km route that bends one way the whole time and climbs then descends.
 *
 * Deliberately not straight and not level: `scatter.ts` reads the route's own
 * latitude and altitude for the tree line, and a flat straight fixture would
 * leave both of those unexercised while looking like a thorough one.
 */
function bendingRoute(): RoutePoint[] {
  const points: RoutePoint[] = [];
  const radius = 400;
  for (let along = 0; along <= 3000; along += 10) {
    const turned = along / radius;
    const north = radius * Math.sin(turned);
    const east = radius * (1 - Math.cos(turned));
    points.push({
      position: geographicPosition(
        degreesLatitude(LATITUDE_DEGREES + north / METRES_PER_DEGREE_LATITUDE),
        degreesLongitude(
          -0.12 +
            east / (METRES_PER_DEGREE_LATITUDE * Math.cos((LATITUDE_DEGREES * Math.PI) / 180)),
        ),
      ),
      elevation: altitudeMetres(along <= 1500 ? along * 0.04 : (3000 - along) * 0.04),
    });
  }
  return points;
}

/**
 * One item as a string, at a precision a floating-point round trip cannot move.
 *
 * Millimetres for a position, a thousandth of a radian for a rotation. Both are
 * far finer than anything a rider could see and far coarser than the last bit
 * of a double, so the digest pins the arrangement without pinning the exact
 * bit pattern of an intermediate — which would go red on a different CPU.
 */
function serialise(item: ScatterItem): string {
  return [
    item.kind,
    item.x.toFixed(3),
    item.y.toFixed(3),
    item.z.toFixed(3),
    item.rotation.toFixed(3),
    item.scale.toFixed(3),
  ].join(' ');
}

/** FNV-1a, 32-bit, as eight hex digits. Short enough to read in a diff. */
function digest(lines: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const line of lines) {
    for (let at = 0; at < line.length; at += 1) {
      hash ^= line.charCodeAt(at);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash ^= 0x0a;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Every item of every frame of a sweep along the fixture, in frame order. */
function sweep(): readonly ScatterItem[] {
  const profile = routeProfile(bendingRoute());
  const origin = corridorOrigin(profile);
  const start = atStartLine(profile);
  const items: ScatterItem[] = [];
  for (let at = 0; at < 1500; at += 47) {
    const frame = sceneFrame({
      profile,
      origin,
      state: { ...start, ride: { ...start.ride, distance: metres(at) } },
    });
    items.push(...frame.scatter);
  }
  return items;
}

describe('the arrangement a route produces — #341', () => {
  const placed = sweep();

  it('places the same scenery it placed before the models landed', () => {
    // ⚠️ **Computed on `main` on 2026-09-17, before #341 changed anything, and
    // pasted here unchanged.** If this goes red on a #341-shaped change, the
    // placement moved — which D-4 names as a defect rather than a difference,
    // whatever the world looks like afterwards.
    expect(digest(placed.map(serialise))).toBe('70b89108');
  });

  it('places a world at all, so the digest is not over an empty sweep', () => {
    // 7 680 items over 32 frames, standing in 1 233 distinct places — an item
    // is placed again in every frame that can still see it, which is what makes
    // this a sweep rather than a snapshot.
    expect(placed.length).toBe(7680);
    expect(new Set(placed.map((item) => `${item.x},${item.z}`)).size).toBe(1233);
  });

  it('still uses every kind `scatter.ts` can place', () => {
    // A model swap that dropped a kind would leave a digest that is *different*
    // rather than one that is wrong-looking, and this is what names which.
    expect([...new Set(placed.map((item) => item.kind))].sort()).toEqual([...SCATTER_KINDS].sort());
  });

  it('places its first, middle and last item exactly where it did', () => {
    // Three written-out anchors beside the digest, so a failure says *what*
    // moved rather than only *that* something did.
    const first = placed[0];
    const middle = placed[Math.floor(placed.length / 2)];
    const last = placed[placed.length - 1];

    expect(first === undefined ? '' : serialise(first)).toBe(
      'tree-conifer 73.898 10.647 256.351 5.361 1.179',
    );
    expect(middle === undefined ? '' : serialise(middle)).toBe(
      'tree-conifer 551.927 31.250 377.649 0.226 1.127',
    );
    expect(last === undefined ? '' : serialise(last)).toBe(
      'tree-conifer 551.709 50.728 -376.770 0.244 0.995',
    );
  });
});
