// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The building fields this project's archive adds (#1557), as the comparison
 * checks them in a built archive. The profile that writes them is
 * `profile/src/main/java/dev/openzigs/onyourleft/basemap/BuildingTags.java`,
 * and its lists are the schema: this file repeats them so that a built archive
 * is checked from outside the JVM, by a second implementation, before anybody
 * publishes it. #1789's decoder in `@onyourleft/map-features` is the third,
 * and the one the client runs. `building-fields.test.ts` holds this file to the
 * Java source, list for list, so the two cannot drift apart unnoticed.
 */

import type { MvtValue } from './mvt';

export const BUILDING_TYPES = [
  'house',
  'detached',
  'semidetached_house',
  'terrace',
  'bungalow',
  'farm',
  'apartments',
  'residential',
  'garage',
  'garages',
  'carport',
  'shed',
  'barn',
  'farm_auxiliary',
  'cowshed',
  'stable',
  'commercial',
  'retail',
  'office',
  'supermarket',
  'industrial',
  'warehouse',
  'church',
  'chapel',
  'cathedral',
  'school',
  'civic',
  'government',
  'townhall',
] as const;

export const ROOF_SHAPES = [
  'flat',
  'gabled',
  'hipped',
  'pyramidal',
  'skillion',
  'half-hipped',
  'gambrel',
  'side_hipped',
  'mansard',
  'saltbox',
] as const;

export const ROOF_ORIENTATIONS = ['along', 'across'] as const;
export const WALL_MATERIALS = [
  'brick',
  'wood',
  'stone',
  'concrete',
  'glass',
  'metal',
  'plaster',
] as const;
export const ROOF_MATERIALS = ['roof_tiles', 'slate', 'metal', 'asphalt', 'concrete'] as const;
export const LANDMARKS = ['worship', 'townhall', 'school'] as const;

/** `BuildingPalette.ENTRIES.size()`: a colour is an index below this. */
export const PALETTE_SIZE = 20;

type Rule =
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | {
      readonly kind: 'integer';
      readonly min: number;
      readonly max: number;
      readonly step?: number;
    };

/**
 * Every key the profile may write, with what its value may be. `start_year`'s
 * upper bound is the build year, which the comparison is given.
 */
export function buildingFieldRules(buildYear: number): ReadonlyMap<string, Rule> {
  return new Map<string, Rule>([
    ['building_type', { kind: 'enum', values: BUILDING_TYPES }],
    ['levels', { kind: 'integer', min: 1, max: 100 }],
    ['roof_levels', { kind: 'integer', min: 0, max: 5 }],
    ['roof_shape', { kind: 'enum', values: ROOF_SHAPES }],
    ['roof_orientation', { kind: 'enum', values: ROOF_ORIENTATIONS }],
    ['roof_direction', { kind: 'integer', min: 0, max: 345, step: 15 }],
    ['wall_colour', { kind: 'integer', min: 0, max: PALETTE_SIZE - 1 }],
    ['roof_colour', { kind: 'integer', min: 0, max: PALETTE_SIZE - 1 }],
    ['wall_material', { kind: 'enum', values: WALL_MATERIALS }],
    ['roof_material', { kind: 'enum', values: ROOF_MATERIALS }],
    ['start_year', { kind: 'integer', min: 1600, max: buildYear }],
    ['landmark', { kind: 'enum', values: LANDMARKS }],
  ]);
}

/** Whether one value is what its key's rule admits. A key with no rule is not one of these fields. */
export function admits(rule: Rule, value: MvtValue): boolean {
  if (rule.kind === 'enum') return typeof value === 'string' && rule.values.includes(value);
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= rule.min &&
    value <= rule.max &&
    (rule.step === undefined || value % rule.step === 0)
  );
}
