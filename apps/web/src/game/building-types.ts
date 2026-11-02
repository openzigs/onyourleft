// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a mapped building's type draws it as — #1791, epic #1656, under the
 * owner's rulings D1 and D4 of 2026-10-27: the `building_type` and `landmark`
 * #1789 decodes (`@onyourleft/map-features` §`BUILDING_TYPES`, §`LANDMARKS`)
 * pick a footprint's family, which **overrides** the land-use guess
 * (`footprint-buildings.ts` §`footprintUse`) and picks the archetypes it may
 * be (#1782's and #1783's); their shape rules then choose within it.
 *
 * | type | family | drawn as |
 * |---|---|---|
 * | `house`, `detached`, `semidetached_house`, `farm` | `house` | residential; #1782's shape rule picks the archetype |
 * | `bungalow` | `bungalow` | residential; the bungalow alone, where its shape fits |
 * | `terrace` | `terrace` | residential, and #1635's terrace rule in any urban class |
 * | `apartments`, and `residential` of 2+ storeys and {@link APARTMENT_MIN_AREA} | `apartments` | #1783's garage-free garden apartment |
 * | `residential` otherwise | `house` | as `house` |
 * | `garage`, `garages`, `carport` | `garage` | 1 storey, a low gable or flat roof, a garage door on the route-facing wall, no window, porch or chimney |
 * | `shed` | `shed` | 1 storey, a low gable or flat roof, no window, a plain door |
 * | `barn`, `farm_auxiliary`, `cowshed`, `stable` | `barn` | the farm building: planks, a gambrel (#1785) or else a steep gable |
 * | `commercial`, `retail`, `office`, `supermarket` | `commercial` | commercial: #1783's main-street block or strip front |
 * | `industrial`, `warehouse` | `industrial` | corrugated walls under a flat roof |
 * | `church`, `chapel`, `cathedral`, `school`, `civic`, `government`, `townhall`, or any `landmark` | `civic` | a plain civic block, brick or render, flat or a low hip, one central plain door |
 * | none (`yes` and unknown values decode to none) | — | today's rule and #1782's archetypes |
 *
 * A civic block's door and a shed's are plain: the leaf alone in the door's
 * paint, which takes no wreath in the winter lights (#1626's is drawn on a
 * door's face only) — so a civic plan takes no holiday decoration, as
 * `decorations.ts` never decorates the procedural church's plot. The church
 * and civic-building issues under #1656 replace the block with their own.
 * The shed's mono-pitch roof is not built: it takes the low gable.
 *
 * Plan-time only, built once at the press: no draw call, no byte, and no
 * shader term. Formats no string, so names no vertex (ADR 0004 D).
 */

import type { BuildingType, Landmark } from '@onyourleft/map-features';

import { BUILDING_CUES } from './building-archetypes';
import { SEEDED_FEATURES, type ArchetypeFeatures } from './house-archetypes';

/** What a typed footprint is drawn as — the module's table. `residential` is resolved by storeys and area. */
export type BuildingFamily =
  | 'house'
  | 'bungalow'
  | 'terrace'
  | 'apartments'
  | 'residential'
  | 'garage'
  | 'shed'
  | 'barn'
  | 'commercial'
  | 'industrial'
  | 'civic';

/** Every type's family — the module's table, one row a type of #1557's whitelist. */
export const TYPE_FAMILIES: Readonly<Record<BuildingType, BuildingFamily>> = {
  house: 'house',
  detached: 'house',
  semidetached_house: 'house',
  farm: 'house',
  bungalow: 'bungalow',
  terrace: 'terrace',
  apartments: 'apartments',
  residential: 'residential',
  garage: 'garage',
  garages: 'garage',
  carport: 'garage',
  shed: 'shed',
  barn: 'barn',
  farm_auxiliary: 'barn',
  cowshed: 'barn',
  stable: 'barn',
  commercial: 'commercial',
  retail: 'commercial',
  office: 'commercial',
  supermarket: 'commercial',
  industrial: 'industrial',
  warehouse: 'industrial',
  church: 'civic',
  chapel: 'civic',
  cathedral: 'civic',
  school: 'civic',
  civic: 'civic',
  government: 'civic',
  townhall: 'civic',
};

/**
 * A footprint's family from its decoded type and landmark, or `undefined`
 * where it has neither: then it is planned by today's rule. Any landmark is
 * civic, whatever its type.
 */
export function buildingFamilyOf(
  type: BuildingType | null,
  landmark: Landmark | null,
): BuildingFamily | undefined {
  if (landmark !== null) return 'civic';
  return type === null ? undefined : TYPE_FAMILIES[type];
}

/** A `residential` footprint is an apartment block from this area, m²: the garden apartment's least (#1783). */
export const APARTMENT_MIN_AREA = BUILDING_CUES['garden-apartment'].area[0];

/** A `residential` footprint is an apartment block from this many storeys: **2**. */
export const APARTMENT_MIN_STOREYS = 2;

/**
 * A `residential` footprint's family, now its storeys and area are known: an
 * apartment block where it has {@link APARTMENT_MIN_STOREYS} and
 * {@link APARTMENT_MIN_AREA}, else a house. Any other family is itself.
 */
export function resolvedFamily(
  family: BuildingFamily,
  storeys: number,
  area: number,
): Exclude<BuildingFamily, 'residential'> {
  if (family !== 'residential') return family;
  return storeys >= APARTMENT_MIN_STOREYS && area >= APARTMENT_MIN_AREA ? 'apartments' : 'house';
}

/** A garage's and a shed's features: a low gable, never a hip, where its roof is pitched. */
export const OUTBUILDING_FEATURES: ArchetypeFeatures = {
  ...SEEDED_FEATURES,
  hip: 0,
  pitches: [25],
};

/** A barn's: a steep gable, always a gambrel where #1785's variants are on and it fits the caps. */
export const BARN_FEATURES: ArchetypeFeatures = {
  ...SEEDED_FEATURES,
  hip: 0,
  pitches: [40, 45],
  roofVariant: ['gambrel', 1],
};

/** A civic block's: a low hip, where its roof is pitched. */
export const CIVIC_FEATURES: ArchetypeFeatures = {
  ...SEEDED_FEATURES,
  hip: 1,
  pitches: [25],
};
