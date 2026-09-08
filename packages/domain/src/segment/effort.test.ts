// SPDX-License-Identifier: Apache-2.0

/**
 * The two decisions #66 says must not be got wrong: the three-state visibility,
 * and attributes that freeze when the effort is made.
 */

import { describe, expect, it } from 'vitest';

import { distanceBetween } from '../geodesy';

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  kilograms,
  metres,
  seconds,
  unixSeconds,
} from '../quantities';

import {
  countsOnSharedBoard,
  countsTowardPersonalBest,
  createEffort,
  effortId,
  effortVisibility,
  personalBest,
  RANKING_BASIS,
  RANKING_BASIS_LABEL,
  rankEfforts,
  rankOrder,
  touchesPrivacyZone,
  type EffortContext,
  type EffortVisibility,
  type FrozenAttributes,
  type SegmentEffort,
} from './effort';

import type { GeographicPosition } from '../quantities';
import type { MatchedEffort } from './match';

const METRES_PER_DEGREE_LATITUDE = 111_194.9;
const HOME = geographicPosition(degreesLatitude(51.5), degreesLongitude(-0.12));

function northOf(from: GeographicPosition, distanceMetres: number): GeographicPosition {
  return geographicPosition(
    degreesLatitude(from.latitude + distanceMetres / METRES_PER_DEGREE_LATITUDE),
    degreesLongitude(from.longitude),
  );
}

/** A traversal whose ends are at ride samples 0 and 2. */
const MATCHED: MatchedEffort = {
  segmentId: 'segment-1',
  startIndex: 0,
  endIndex: 2,
  startedAt: unixSeconds(1_760_000_000),
  elapsed: seconds(96),
  deviation: metres(4),
};

function contextOf(overrides: Partial<EffortContext> = {}): EffortContext {
  return {
    activityId: 'activity-1',
    athleteId: 'athlete-a',
    // Sample 0 at HOME, then 400 m and 800 m north of it.
    positions: [HOME, northOf(HOME, 400), northOf(HOME, 800)],
    privacyZones: [],
    attributes: {},
    ...overrides,
  };
}

describe('visibility is a three-state, and each state is reachable', () => {
  it('is public when nothing is hidden and nothing is flagged', () => {
    expect(effortVisibility(MATCHED, contextOf())).toBe('public');
  });

  it('is private-match when the START falls inside a privacy zone', () => {
    const zone = { centre: HOME, radius: metres(200) };
    expect(effortVisibility(MATCHED, contextOf({ privacyZones: [zone] }))).toBe('private-match');
  });

  it('is private-match when the END falls inside one, not only the start', () => {
    // Asserted separately because a matcher that only tested the start would
    // pass the case above and still publish where the rider finished.
    const zone = { centre: northOf(HOME, 800), radius: metres(200) };
    expect(effortVisibility(MATCHED, contextOf({ privacyZones: [zone] }))).toBe('private-match');
  });

  it('is public when a zone sits in the MIDDLE of the effort', () => {
    // A segment that merely passes a zone exposes nothing: the road is public
    // and the effort says only that the rider rode along it. Forcing these
    // private would make the feature useless to anyone living near a segment.
    const zone = { centre: northOf(HOME, 400), radius: metres(100) };
    expect(effortVisibility(MATCHED, contextOf({ privacyZones: [zone] }))).toBe('public');
  });

  it('is public when the zone is near but does not contain either endpoint', () => {
    const zone = { centre: northOf(HOME, -300), radius: metres(200) };
    expect(effortVisibility(MATCHED, contextOf({ privacyZones: [zone] }))).toBe('public');
  });

  it('is excluded when flagged, and excluded WINS over private-match', () => {
    // An implausible effort is not a personal best whether or not it started
    // at the rider's front door, so the order of these two tests is the rule.
    const zone = { centre: HOME, radius: metres(200) };
    expect(effortVisibility(MATCHED, contextOf({ excluded: true, privacyZones: [zone] }))).toBe(
      'excluded',
    );
  });
});

describe('what each state means at the two read paths — #66’s seventh criterion', () => {
  const zone = { centre: HOME, radius: metres(200) };
  const shown = createEffort(MATCHED, contextOf());
  const hidden = createEffort(MATCHED, contextOf({ privacyZones: [zone] }));
  const flagged = createEffort(MATCHED, contextOf({ excluded: true }));

  it('a private-match effort IS returned by the athlete’s own personal best', () => {
    expect(hidden.visibility).toBe('private-match');
    expect(countsTowardPersonalBest(hidden)).toBe(true);
  });

  it('and is ABSENT from any shared board — both halves, as the criterion asks', () => {
    expect(countsOnSharedBoard(hidden)).toBe(false);
  });

  it('a public effort counts on both', () => {
    expect(countsTowardPersonalBest(shown)).toBe(true);
    expect(countsOnSharedBoard(shown)).toBe(true);
  });

  it('an excluded effort counts on neither', () => {
    expect(countsTowardPersonalBest(flagged)).toBe(false);
    expect(countsOnSharedBoard(flagged)).toBe(false);
  });
});

describe('attributes freeze at effort time', () => {
  it('changing the athlete’s recorded weight afterwards does not alter a stored effort', () => {
    // ⚠️ #66's eighth criterion, and the only test shape that catches the bug.
    // A matcher that read the athlete's CURRENT weight at ranking time produces
    // a board that looks right and rewrites history every time somebody edits
    // their profile; no test of a single ranking sees it.
    const profile: { riderMass?: ReturnType<typeof kilograms> } = { riderMass: kilograms(78) };
    const effort = createEffort(MATCHED, contextOf({ attributes: profile }));

    profile.riderMass = kilograms(72);

    expect(effort.attributes.riderMass).toBe(78);
  });

  it('records no attribute the athlete never recorded, rather than inventing one', () => {
    // A leaderboard that requires a weight before it will time you is a worse
    // product than one with an unbucketed row.
    const attributes: FrozenAttributes = {};
    expect(createEffort(MATCHED, contextOf({ attributes })).attributes).toEqual({});
  });
});

describe('the effort id is derived, which is what makes re-matching idempotent', () => {
  it('is the same for the same traversal found again', () => {
    expect(effortId('segment-1', 'activity-1', unixSeconds(1_760_000_000))).toBe(
      effortId('segment-1', 'activity-1', unixSeconds(1_760_000_000)),
    );
  });

  it('differs for the same segment ridden twice in one activity', () => {
    // The two traversals have different start instants, so a rider's second and
    // often faster effort is not silently written over their first.
    expect(effortId('segment-1', 'activity-1', unixSeconds(1_760_000_000))).not.toBe(
      effortId('segment-1', 'activity-1', unixSeconds(1_760_003_600)),
    );
  });

  it('differs across segments and across activities', () => {
    const base = effortId('segment-1', 'activity-1', unixSeconds(1));
    expect(base).not.toBe(effortId('segment-2', 'activity-1', unixSeconds(1)));
    expect(base).not.toBe(effortId('segment-1', 'activity-2', unixSeconds(1)));
  });
});

describe('the privacy test itself', () => {
  it('is false when the athlete has no zones', () => {
    expect(touchesPrivacyZone([HOME, HOME], 0, 1, [])).toBe(false);
  });

  it('treats the zone edge as inside', () => {
    // Inclusive, so a zone's stated radius is the distance it actually covers.
    // The alternative leaves a ring one float wide where an address leaks.
    //
    // ⚠️ The radius is the MEASURED distance, not the 400 the fixture asked
    // for. `northOf` converts with a degrees-per-metre constant and
    // `distanceBetween` walks the sphere, so the two disagree in the last few
    // decimal places — and a test written as `radius: metres(400)` fails for
    // that reason rather than for the one it is about.
    const edge = northOf(HOME, 400);
    const zone = { centre: HOME, radius: metres(distanceBetween(HOME, edge)) };
    expect(touchesPrivacyZone([edge], 0, 0, [zone])).toBe(true);
  });

  it('does not fall over on an index outside the ride', () => {
    expect(touchesPrivacyZone([HOME], 0, 99, [{ centre: HOME, radius: metres(1) }])).toBe(true);
  });
});

// --- Ranking (#67) -----------------------------------------------------------

/** An effort with just the fields ranking reads. */
function effort(
  id: string,
  elapsedSeconds: number,
  startedAtSeconds: number,
  visibility: EffortVisibility = 'public',
): SegmentEffort {
  return {
    id,
    segmentId: 'segment-1',
    activityId: `activity-${id}`,
    athleteId: 'athlete-a',
    startedAt: unixSeconds(startedAtSeconds),
    elapsed: seconds(elapsedSeconds),
    deviation: metres(5),
    visibility,
    attributes: {},
  };
}

describe('the ranking basis is stated, and it is elapsed time', () => {
  it('names one basis, and the words the screen uses', () => {
    // #67's fourth criterion: pick one, name it in the UI, never mix bases.
    // Asserted so that changing the basis without changing the label — or the
    // reverse — fails rather than shipping a screen that lies about what it
    // ranked by.
    expect(RANKING_BASIS).toBe('elapsed');
    expect(RANKING_BASIS_LABEL).toContain('elapsed');
  });

  it('orders by elapsed time ascending, fastest first', () => {
    const ranked = rankEfforts([effort('c', 120, 300), effort('a', 90, 100), effort('b', 95, 200)]);
    expect(ranked.map((one) => one.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('the tie-break is deterministic and documented — #67’s fifth criterion', () => {
  it('breaks an equal time by the EARLIEST start', () => {
    const ranked = rankEfforts([effort('later', 90, 500), effort('earlier', 90, 100)]);
    expect(ranked.map((one) => one.id)).toEqual(['earlier', 'later']);
  });

  it('breaks an equal time AND an equal start by the effort id', () => {
    // Reached only when one ride was imported twice under two ids. Without it
    // the order of those two depends on the store's return order, which is not
    // part of any contract.
    const ranked = rankEfforts([effort('zzz', 90, 100), effort('aaa', 90, 100)]);
    expect(ranked.map((one) => one.id)).toEqual(['aaa', 'zzz']);
  });

  it('orders the same way on every render, whatever order it is handed', () => {
    // ⚠️ The criterion in its literal form: "a test asserts stability across
    // two runs". Reversing the input is the stronger version — a comparator
    // that stopped at elapsed time would rely on sort stability and therefore
    // on the INPUT order, so it passes a re-run and fails this.
    const all = [effort('c', 90, 300), effort('a', 90, 100), effort('b', 90, 200)];
    const forwards = rankEfforts(all).map((one) => one.id);
    const backwards = rankEfforts([...all].reverse()).map((one) => one.id);

    expect(forwards).toEqual(['a', 'b', 'c']);
    expect(backwards).toEqual(forwards);
  });

  it('the comparator itself is antisymmetric on every pair', () => {
    const pairs: readonly [SegmentEffort, SegmentEffort][] = [
      [effort('a', 90, 100), effort('b', 95, 100)],
      [effort('a', 90, 100), effort('b', 90, 200)],
      [effort('a', 90, 100), effort('b', 90, 100)],
    ];
    for (const [first, second] of pairs) {
      expect(Math.sign(rankOrder(first, second))).toBe(-Math.sign(rankOrder(second, first)));
    }
  });
});

describe('what ranking includes, and what it does not — #67’s first and sixth criteria', () => {
  it('includes a private-match effort, because it is the athlete’s own data', () => {
    const ranked = rankEfforts([
      effort('public', 95, 100),
      effort('hidden', 90, 200, 'private-match'),
    ]);
    expect(ranked.map((one) => one.id)).toEqual(['hidden', 'public']);
  });

  it('lets a private-match effort BE the personal best', () => {
    // The sharper version of the case above: not merely listed, but winning.
    // A reader who "simplified" the filter to `visibility === 'public'` would
    // silently delete the rider's best time on every segment near their home.
    const best = personalBest([
      effort('slower', 95, 100),
      effort('hidden', 90, 200, 'private-match'),
    ]);
    expect(best?.id).toBe('hidden');
  });

  it('drops an excluded effort, which is not a personal best at any time', () => {
    const ranked = rankEfforts([
      effort('real', 95, 100),
      effort('impossible', 12, 200, 'excluded'),
    ]);
    expect(ranked.map((one) => one.id)).toEqual(['real']);
  });

  it('has no personal best when the athlete has no efforts', () => {
    expect(personalBest([])).toBeUndefined();
    expect(personalBest([effort('only', 90, 100, 'excluded')])).toBeUndefined();
  });

  it('does not mutate the array it was handed', () => {
    // `sort` is in place, so ranking a store read would reorder the caller's
    // array under it — which is the kind of thing that only shows up as a
    // second render disagreeing with the first.
    const all = [effort('c', 120, 300), effort('a', 90, 100)];
    rankEfforts(all);
    expect(all.map((one) => one.id)).toEqual(['c', 'a']);
  });
});
