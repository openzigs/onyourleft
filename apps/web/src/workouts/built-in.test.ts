// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  beatsPerMinute,
  BUILT_IN_WORKOUTS,
  seconds,
  TEMPLATE_LENGTHS_MINUTES,
  thresholdShare,
  workoutShapeText,
  type WorkoutTemplate,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { matchHash } from '../shell/routes';
import {
  BUILT_IN_CARDS,
  BUILT_IN_CATEGORIES,
  BUILT_IN_ID_PREFIX,
  builtInById,
  builtInFilterFromQuery,
  builtInFilterQuery,
  CATEGORY_NAMES,
  filterBuiltIns,
  hasHeartRateTarget,
  hrefForSavedWorkouts,
  hrefForWorkouts,
  isBuiltInId,
  isFiltered,
  LENGTH_CHOICES,
  lengthChoiceOf,
  lengthChoiceText,
  workoutsListOf,
} from './built-in';

const names = (cards: readonly { readonly name: string }[]): string[] =>
  cards.map((card) => card.name);

describe('every built-in is a card — #2304', () => {
  it('has one card per template the library ships, in its order', () => {
    expect(BUILT_IN_CARDS.map((card) => card.template)).toEqual(BUILT_IN_WORKOUTS);
    expect(BUILT_IN_CARDS.map((card) => card.id)).toEqual(
      BUILT_IN_WORKOUTS.map((template) => `${BUILT_IN_ID_PREFIX}${template.id}`),
    );
  });

  it('says the default workout’s shape, length and hardest target as a share of threshold', () => {
    const card = builtInById('built-in:sweet-spot-2x20');
    expect(card?.name).toBe('Sweet spot, two by twenty');
    expect(card?.duration).toBe('1 h 5 min');
    expect(card?.categoryName).toBe('Sweet spot');
    expect(card?.hardestPercent).toBe(89);
    expect(card?.shape).toBe(
      '10 min ramping 45% to 70%, 2 × 20 min at 89%, 5 min at 55%, 5 min ramping 60% to 45%',
    );
    for (const each of BUILT_IN_CARDS) {
      expect(each.shape).toBe(workoutShapeText(each.workout));
      // No watts on a card: a card is the same for every rider.
      expect(`${each.shape} ${each.duration}`).not.toMatch(/\d\s?W\b/);
    }
  });

  it('draws every card from its own default workout', () => {
    for (const card of BUILT_IN_CARDS) {
      expect(card.chart.rule, card.id).not.toBe('');
    }
  });

  it('names every category in plain words, and offers only the ones the library holds', () => {
    for (const category of BUILT_IN_CATEGORIES) {
      expect(CATEGORY_NAMES[category]).toMatch(/^[A-Z]/);
    }
    expect(BUILT_IN_CATEGORIES).toEqual([
      ...new Set(BUILT_IN_WORKOUTS.map((template) => template.category)),
    ]);
  });

  it('marks a template with a heart-rate range anywhere, and none without one', () => {
    expect(BUILT_IN_CARDS.filter((card) => card.heartRate).map((card) => card.template.id)).toEqual(
      ['endurance-heart-rate', 'endurance-heart-rate-low'],
    );
    const held: WorkoutTemplate = {
      ...(BUILT_IN_WORKOUTS[0] as WorkoutTemplate),
      coolDown: [
        {
          kind: 'heart-rate-hold',
          seconds: seconds(300),
          range: { low: beatsPerMinute(120), high: beatsPerMinute(130) },
          startShare: thresholdShare(0.5),
          ceilingShare: thresholdShare(0.6),
        },
      ],
    };
    expect(hasHeartRateTarget(held)).toBe(true);
  });

  it('tells a built-in’s id from a saved workout’s', () => {
    expect(isBuiltInId('built-in:tempo-2x20')).toBe(true);
    expect(isBuiltInId('workout-4f1c')).toBe(false);
    expect(isBuiltInId(undefined)).toBe(false);
    expect(builtInById('built-in:no-such-template')).toBeUndefined();
  });
});

describe('a length choice — #2304', () => {
  it('is the domain’s five lengths', () => {
    expect(LENGTH_CHOICES).toEqual(TEMPLATE_LENGTHS_MINUTES);
  });

  it.each([
    [20, 30],
    [37, 30],
    [37.5, 30],
    [38, 45],
    [47, 45],
    [52.5, 45],
    [53, 60],
    [82, 75],
    [83, 90],
    [150, 90],
  ])('lists a %s-minute workout under %s', (minutes, choice) => {
    expect(lengthChoiceOf(minutes * 60)).toBe(choice);
  });

  it('says the first and last as open-ended', () => {
    expect(LENGTH_CHOICES.map(lengthChoiceText)).toEqual([
      '30 min or less',
      '45 min',
      '60 min',
      '75 min',
      '90 min or more',
    ]);
  });
});

describe('a filter — #2304', () => {
  it('leaves the cards of one category and one length', () => {
    expect(names(filterBuiltIns(BUILT_IN_CARDS, { category: 'sweet-spot', length: 45 }))).toEqual([
      'Sweet spot, rising block',
      'Sweet spot, one long block',
    ]);
  });

  it('leaves only those with a heart-rate target when asked', () => {
    expect(names(filterBuiltIns(BUILT_IN_CARDS, { heartRate: true }))).toEqual([
      'Endurance by heart rate',
      'Low endurance by heart rate',
    ]);
  });

  it('leaves every card with no filter set', () => {
    expect(filterBuiltIns(BUILT_IN_CARDS, {})).toEqual(BUILT_IN_CARDS);
    expect(filterBuiltIns(BUILT_IN_CARDS, { heartRate: false })).toEqual(BUILT_IN_CARDS);
    expect(isFiltered({})).toBe(false);
    expect(isFiltered({ heartRate: false })).toBe(false);
    expect(isFiltered({ length: 60 })).toBe(true);
  });

  it('round-trips through the address', () => {
    const filter = { category: 'tempo', length: 75, heartRate: true } as const;
    const query = builtInFilterQuery(filter);
    expect(query).toBe('category=tempo&length=75&heart-rate=yes');
    expect(builtInFilterFromQuery(query)).toEqual(filter);
    expect(builtInFilterQuery({})).toBe('');
  });

  it('ignores what is not a filter rather than failing', () => {
    expect(builtInFilterFromQuery(undefined)).toEqual({});
    expect(builtInFilterFromQuery('')).toEqual({});
    // A category the library holds nothing in, one off Object's prototype, a
    // length that is no choice, and a heart-rate flag that is not `yes`.
    expect(builtInFilterFromQuery('category=toString&length=40&heart-rate=true&other=1')).toEqual(
      {},
    );
    expect(builtInFilterFromQuery('category=no-such&length=abc')).toEqual({});
  });
});

describe('which list the screen shows — #2304', () => {
  it('is the rider’s own unless the address asks for the built-ins or chose one', () => {
    expect(workoutsListOf(undefined, undefined)).toBe('saved');
    expect(workoutsListOf('category=tempo', undefined)).toBe('saved');
    expect(workoutsListOf(undefined, 'workout-4f1c')).toBe('saved');
    expect(workoutsListOf('list=built-in', undefined)).toBe('built-in');
    expect(workoutsListOf('list=built-in', 'workout-4f1c')).toBe('built-in');
    expect(workoutsListOf(undefined, 'built-in:tempo-2x20')).toBe('built-in');
    expect(workoutsListOf('list=other', undefined)).toBe('saved');
  });

  it('is an address each, the rider’s own being the screen’s own', () => {
    expect(hrefForSavedWorkouts()).toBe('#/workouts');
    expect(workoutsListOf(matchHash(hrefForWorkouts({})).query, undefined)).toBe('built-in');
  });
});

describe('the address a filter lives at — #2304', () => {
  it('is the built-in list’s, with the filter as its query', () => {
    expect(hrefForWorkouts({})).toBe('#/workouts?list=built-in');
    expect(hrefForWorkouts({ category: 'sweet-spot', length: 45 })).toBe(
      '#/workouts?list=built-in&category=sweet-spot&length=45',
    );
    expect(hrefForWorkouts({ length: 30 }, 'built-in:tempo-2x20')).toBe(
      '#/workouts/selected/built-in%3Atempo-2x20?list=built-in&length=30',
    );
  });

  it('is read back by the router as the Workouts route, its selection and its query', () => {
    expect(matchHash('#/workouts?list=built-in&category=sweet-spot&length=45')).toEqual({
      route: matchHash('#/workouts').route,
      query: 'list=built-in&category=sweet-spot&length=45',
    });
    const selected = matchHash(hrefForWorkouts({ length: 30 }, 'built-in:tempo-2x20'));
    expect(selected.route.id).toBe('workouts');
    expect(selected.parameter).toBe('built-in:tempo-2x20');
    expect(builtInFilterFromQuery(selected.query)).toEqual({ length: 30 });
    // No query, no `query`: the match is exactly what it was before #2304.
    expect(matchHash('#/workouts')).toEqual({ route: matchHash('#/workouts').route });
  });

  it('is read on Workouts — and since #2306 on Ride — and on no other route', () => {
    expect(matchHash('#/ride?workout=built-in%3Atempo-2x20').query).toBe(
      'workout=built-in%3Atempo-2x20',
    );
    expect(matchHash('#/routes?category=tempo').query).toBeUndefined();
    expect(matchHash('#/game?route=r1').query).toBeUndefined();
  });
});
