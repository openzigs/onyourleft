// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which commercial or multi-family building a mapped footprint is — #1783,
 * epic #1656, under the owner's rulings D1 and D3 of 2026-10-27: #1782's rule
 * (`house-archetypes.ts`) carried from houses to the footprints houses are
 * not. An archetype is chosen from what the plan already has — its use, its
 * storeys, its area and shape, its urban class and whether it is terraced,
 * and no region or era — and then sets the building's cladding, its roof, its
 * ground floor and its upper windows together, where before each came from
 * the use and the class on its own, so that a one-storey retail box on an
 * arterial could wear a three-storey main-street block's sash rhythm.
 *
 * ## The archetypes
 *
 * {@link BUILDING_CUES} is the starting table, a sketch to be tuned on the
 * owner's look pair (`?town=commercial` against `levers=-commercial-archetypes`).
 *
 * | archetype | cue | storeys | roof | together |
 * |---|---|---|---|---|
 * | `main-street` | commercial, in a `town` or `city-centre`, or terraced (#1635) | 2–3 | flat behind a parapet under #1590's cornice | brick, a shop front on the route-facing ground floor, sash windows above in the bay rhythm, an awning on two in three shop fronts |
 * | `strip-front` | commercial, 400 m² or more, in a `village` or an unclassed stretch | 1 | flat | render, a shop front along the whole front under its sign band (the front lowered for the band where the storey is low), no window above the ground floor (it is one storey) |
 * | `garden-apartment` | residential, 300–1 200 m², aspect 2 or more, a clean rectangle, not terraced | 2–3 | a low hip or gable, 25–30° | clapboard or brick, one entry door, no garage, no picture window |
 * | `unknown` | anything else | – | – | the plan as before #1783, byte for byte |
 *
 * #1633's classes have no suburb, so the strip front's "suburb" is read as
 * an unclassed stretch (`unknown`), where #1633 draws no built-up run.
 * Industrial footprints are no archetype, and keep their corrugated walls and
 * flat roofs; nor is a tower of `GLAZED_MIN_STOREYS` or more, which keeps
 * #1636's curtain wall. Party walls are #1635's: nothing here looks between
 * neighbours. The city streetscape's terraced blocks (#1719) are planned
 * without an archetype and are unchanged.
 *
 * Plan-time only, built once at the press: no draw call, no byte, and no
 * shader term. Formats no string, so names no vertex (ADR 0004 D).
 */

import {
  ARCHETYPE_MIN_RECTANGULARITY,
  SEEDED_FEATURES,
  type ArchetypeFeatures,
} from './house-archetypes';
import type { UrbanClass } from './urban-class';

/** A commercial or multi-family building type, or `unknown`: #1783's three and the rest. */
export type BuildingArchetype = 'main-street' | 'strip-front' | 'garden-apartment' | 'unknown';

/** Every archetype but `unknown`, in the order {@link buildingArchetypeOf} tries them. */
export const BUILDING_ARCHETYPES = [
  'main-street',
  'strip-front',
  'garden-apartment',
] as const satisfies readonly Exclude<BuildingArchetype, 'unknown'>[];

/** What {@link buildingArchetypeOf} reads: only what the plan already has (D3: no region, no era). */
export interface BuildingArchetypeInput {
  /** The footprint's area, m². */
  readonly area: number;
  /** Its minimum-area rectangle's long side over its short, at least 1. */
  readonly aspect: number;
  /** Its area over that rectangle's. */
  readonly rectangularity: number;
  /** Whether it is drawn with four corners. */
  readonly fourCorners: boolean;
  readonly storeys: number;
  readonly use: 'residential' | 'commercial' | 'industrial' | 'farmland';
  readonly urban: UrbanClass;
  /** #1635: it has a party wall. */
  readonly terraced: boolean;
}

/** One archetype's cue: a row of the module's table. */
export interface BuildingCue {
  readonly use: BuildingArchetypeInput['use'];
  /** Its storeys, inclusive. */
  readonly storeys: readonly [least: number, most: number];
  /** Its area band, m², inclusive. */
  readonly area: readonly [least: number, most: number];
  /** Its least aspect. */
  readonly aspect: number;
  /** The urban classes it stands in. */
  readonly urban: readonly UrbanClass[];
  /** Whether a terraced footprint is one whatever its class (`true`), never is (`false`), or either. */
  readonly terraced?: boolean;
  /** Whether it must be a clean rectangle. */
  readonly rectangle: boolean;
}

/** #1783's starting table, as {@link buildingArchetypeOf} reads it. @see BuildingCue */
export const BUILDING_CUES: Readonly<Record<Exclude<BuildingArchetype, 'unknown'>, BuildingCue>> = {
  'main-street': {
    use: 'commercial',
    storeys: [2, 3],
    area: [0, Number.POSITIVE_INFINITY],
    aspect: 1,
    urban: ['town', 'city-centre'],
    terraced: true,
    rectangle: false,
  },
  'strip-front': {
    use: 'commercial',
    storeys: [1, 1],
    area: [400, Number.POSITIVE_INFINITY],
    aspect: 1,
    urban: ['village', 'unknown'],
    terraced: false,
    rectangle: false,
  },
  'garden-apartment': {
    use: 'residential',
    storeys: [2, 3],
    area: [300, 1_200],
    aspect: 2,
    urban: ['unknown', 'rural', 'village', 'town'],
    terraced: false,
    rectangle: true,
  },
};

/** Whether `input` is what `cue` describes. */
function fits(input: BuildingArchetypeInput, cue: BuildingCue): boolean {
  const [leastStoreys, mostStoreys] = cue.storeys;
  const [leastArea, mostArea] = cue.area;
  if (input.use !== cue.use) return false;
  if (input.storeys < leastStoreys || input.storeys > mostStoreys) return false;
  if (input.area < leastArea || input.area > mostArea || input.aspect < cue.aspect) return false;
  if (
    cue.rectangle &&
    !(input.fourCorners && input.rectangularity >= ARCHETYPE_MIN_RECTANGULARITY)
  ) {
    return false;
  }
  // A terraced footprint: one wherever the cue takes it, and never where it refuses it.
  if (input.terraced) return cue.terraced !== false;
  return cue.urban.includes(input.urban);
}

/**
 * The archetype a footprint is — the first of {@link BUILDING_ARCHETYPES}
 * whose cue it fits — or `unknown`. No cue takes an industrial or farm
 * footprint, nor more than three storeys, so a glazed tower of
 * `GLAZED_MIN_STOREYS` or more is `unknown` too.
 */
export function buildingArchetypeOf(input: BuildingArchetypeInput): BuildingArchetype {
  return (
    BUILDING_ARCHETYPES.find((archetype) => fits(input, BUILDING_CUES[archetype])) ?? 'unknown'
  );
}

/**
 * The garden apartment's features as #1782's houses carry theirs
 * (`house-archetypes.ts` §`ArchetypeFeatures`): a low hip or gable, clapboard
 * on half of them and brick on the rest, no garage, no picture window, no
 * dormer, and #1589's porch at its share.
 */
export const GARDEN_APARTMENT_FEATURES: ArchetypeFeatures = {
  ...SEEDED_FEATURES,
  pitches: [25, 30],
  picture: 0,
  garage: 0,
  dormer: 0,
  siding: 0.5,
};

/** The share of main-street shop fronts with an awning — #1783: **two in three**. */
export const MAIN_STREET_AWNING_SHARE = 2 / 3;
