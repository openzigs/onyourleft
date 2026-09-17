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
 * ⚠️ **#348 moved it, deliberately, and #351 moved it back — every number here
 * was re-taken after each** — so for those two issues and for those two alone
 * they are a record rather than a guard. The assertion below says so where
 * somebody reading a red run will be, and says what discharges them instead.
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
 * A 3 km route that bends one way the whole time, runs level, then climbs and
 * descends.
 *
 * Deliberately not straight and not level: `scatter.ts` reads the route's own
 * latitude and altitude for the tree line, and a flat straight fixture would
 * leave both of those unexercised while looking like a thorough one.
 *
 * ⚠️ **The first 500 m are level, and #348 is why** — a reviewer who remembers
 * a route that climbed from the start line is reading the old file. Every
 * metre of the old fixture was on a 4 % gradient, so nothing on it ever met
 * `kindWeights`' settlement test and the only buildings it produced were the
 * handful of cells either side of the summit where the gradient passes through
 * zero. #348 roughly halved how much scenery a stretch carries, and those few
 * cells stopped producing one at all — which turned *"still uses every kind"*
 * below into a test that could not be satisfied. A level valley floor is the
 * place a building belongs, and putting one in the fixture is a better repair
 * than weakening the assertion to five kinds.
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
      elevation: altitudeMetres(
        along <= 500 ? 0 : along <= 1750 ? (along - 500) * 0.04 : (3000 - along) * 0.04,
      ),
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
    // ⚠️ **Regenerated for #348, again for #351 and again for #353, and a
    // scenery-tuning issue is the one kind of change this number is allowed to
    // move for.** The original was computed on `main` before a line of #341 was
    // written, which is what made it evidence about #341; this one was computed
    // *after* #353's own change, so it is **not** evidence about #353. It
    // cannot be: #353 exists to move the arrangement, and a golden cannot both
    // permit a change and guard against it.
    //
    // What discharges #353 instead is `scatter.test.ts`, which asserts the
    // properties that must survive the move — determinism, call-order
    // independence, the seam, the carriageway, the separation, how much of the
    // world stands in the near field, and since #353 how far from the
    // centreline it stands — and does it without naming a coordinate. **This
    // digest goes back to being what it was written for the moment the next
    // change arrives**: the next model swap, renderer change or refactor that
    // says it leaves placement alone is measured against it, and D-4's *"a
    // different arrangement is a defect"* applies to that one exactly as it
    // applied to #341.
    expect(digest(placed.map(serialise))).toBe('b8ec5156');
  });

  it('places a world at all, so the digest is not over an empty sweep', () => {
    // 7 680 items over 32 frames, standing in 1 120 distinct places — an item is
    // placed again in every frame that can still see it, which is what makes
    // this a sweep rather than a snapshot.
    //
    // ⚠️ **7 680 in 1 233 places before #348, 6 291 in 839 after it, and 7 680
    // in 1 120 since #351.** The drop was #348's whole content and the recovery
    // is #351's: the grid went from ten metres to twenty and back to twelve, a
    // clustering that left half the route bare was brought back to a quarter of
    // it, and the band went from 16 m to 35 m to 25 m to 15 m.
    //
    // ⚠️ **#353 took the band from 25 m to 15 m and moved NEITHER of these two
    // numbers**, which is not luck and is the clearest available statement of
    // what that constant does. The band decides how far from the centreline an
    // item stands and plays no part in deciding whether one is placed, so the
    // sweep offers the same 1 120 places, the budget binds on the same 32
    // frames, and only the digest above moves. The issue's own expectation was
    // the opposite; `scatter.test.ts` §"how much is placed does not depend on
    // how deep the band is — #353" is where that is asserted.
    //
    // ⚠️ **The item count is 7 680 again for a reason that is not a
    // coincidence, and reading it as one would be the trap here.** It is
    // 32 × 240: the budget binds on every frame of this sweep, exactly as it
    // did before #348 and did **not** between the two. Two arrangements that
    // both saturate the budget agree on this number and on nothing else, which
    // is why the count of distinct *places* sits beside it — 1 233, 839, 1 120
    // are three different worlds.
    expect(placed.length).toBe(7680);
    expect(new Set(placed.map((item) => `${item.x},${item.z}`)).size).toBe(1120);
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
      'building 80.760 0.000 223.265 0.895 1.142',
    );
    expect(middle === undefined ? '' : serialise(middle)).toBe(
      'tree-conifer 700.338 17.759 298.028 1.009 0.837',
    );
    expect(last === undefined ? '' : serialise(last)).toBe(
      'tree-conifer 698.805 42.691 -294.119 0.240 1.178',
    );
  });
});
