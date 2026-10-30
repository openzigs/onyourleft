// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which US house a mapped residential footprint is — #1782, epic #1656, under
 * the owner's rulings D1 and D3 of 2026-10-27: an archetype chosen from what
 * the plan already has (its footprint, storeys, use and urban class, and no
 * region or era), which then sets the house's features together.
 *
 * Before this, every feature of a mapped house was its own seeded coin-flip
 * (`footprint-buildings.ts` §`HIP_SHARE`, `PORCH_SHARE`, `SHUTTER_SHARE`, …),
 * so a house could come out as a mix no real one is: a steep dormered cottage
 * with a ranch's garage. Here each archetype names the features it admits —
 * {@link ARCHETYPE_FEATURES} — and `planFootprint` draws only inside them, on
 * the footprint's own seeded streams, so a plan is the same on every read.
 *
 * ## The archetypes
 *
 * {@link ARCHETYPE_CUES} is the starting table, a design sketch to be tuned
 * on the owner's look pair (`?town=houses` against `levers=-house-archetypes`).
 * Its facts are from public US architectural style guides; no text of any is
 * copied.
 *
 * | archetype | footprint | storeys | roof | together |
 * |---|---|---|---|---|
 * | `ranch` | a long rectangle or L, its long side to the road, aspect ≥ 1.8, 120–250 m² | 1 | low hip or gable, 25° | picture window, garage, a canopy or no porch, no dormer |
 * | `cape` | a small rectangle, its long side to the road, 70–120 m² | 1 | steep side gable, 40–45° | dormers, shutters, no garage, no posted porch |
 * | `bungalow` | a rectangle deeper than wide, 80–140 m² | 1 | low front gable, 25–30° | front porch on posts, no shutters, siding |
 * | `colonial` | a rectangle, its long side to the road, aspect 1.3–2.2, 90–160 m² | 2 | side gable, 30–35° | shutters, a chimney, a canopy |
 * | `foursquare` | near square, aspect under 1.25, 70–110 m² | 2 | hip, 30–35° | front porch on posts, no garage |
 * | `farmhouse` | a rectangle or L deeper than wide on a rural stretch, 80–220 m² | 2 | steep front gable, 40–45° | front porch, siding, a brick foundation, no garage |
 * | `unknown` | anything else | – | – | the seeded plan as before #1782, byte for byte |
 *
 * Every terraced footprint is `unknown` (#1635's rule runs first and is
 * unchanged), and so is every one that is not residential, is in a city
 * centre (whose route-facing ground floors are shop fronts, #1636), or is
 * neither a clean rectangle nor a clean L: a T, U or Z is no archetype's.
 * "At the edge of a village" is read as #1633's `rural` class, the stretch
 * past a village's built-up run. Where an archetype wants a feature not built
 * yet — a full-width porch, a shed dormer — it takes the nearest one there
 * is, and the gap is a sibling issue under #1656. Since #1785 the gambrel,
 * the saltbox and the half-hipped and side-hipped roofs are built
 * ({@link ARCHETYPE_FEATURES}' `roofVariant`).
 *
 * Plan-time only, built once at the press: no draw call, no byte, and no
 * shader term. Formats no string, so names no vertex (ADR 0004 D).
 */

import type { UrbanClass } from './urban-class';

/** A US house type, or `unknown`: #1782's six and the rest. */
export type HouseArchetype =
  'ranch' | 'cape' | 'colonial' | 'foursquare' | 'bungalow' | 'farmhouse' | 'unknown';

/** Every archetype but `unknown`, in the order {@link houseArchetypeOf} tries them. */
export const HOUSE_ARCHETYPES = [
  'farmhouse',
  'ranch',
  'bungalow',
  'cape',
  'foursquare',
  'colonial',
] as const satisfies readonly Exclude<HouseArchetype, 'unknown'>[];

/** A footprint's outline: four clean corners, six in an L, or anything else. */
export type FootprintShape = 'rectangle' | 'L' | 'other';

/** What {@link houseArchetypeOf} reads: only what the plan already has (D3: no region, no era). */
export interface ArchetypeInput {
  /** The footprint's area, m². */
  readonly area: number;
  /** Its minimum-area rectangle's long side over its short, at least 1. */
  readonly aspect: number;
  /** Its area over that rectangle's. */
  readonly rectangularity: number;
  readonly shape: FootprintShape;
  readonly storeys: number;
  /** Residential land, or not: no other use has an archetype. */
  readonly residential: boolean;
  readonly urban: UrbanClass;
  /** #1635: it has a party wall. */
  readonly terraced: boolean;
  /** Its front — the wall the door is in — is across its long axis: it is deeper than wide. */
  readonly deep: boolean;
  /** Its roof is pitched: every archetype's is. */
  readonly pitched: boolean;
}

/** One archetype's footprint cue: a row of the module's table. */
export interface ArchetypeCue {
  /** Its area band, m², inclusive. */
  readonly area: readonly [least: number, most: number];
  /** Its aspect band, inclusive at the foot and exclusive at the head. */
  readonly aspect: readonly [least: number, most: number];
  readonly storeys: number;
  readonly shapes: readonly Exclude<FootprintShape, 'other'>[];
  /** Whether its front is its short side (`true`), its long side (`false`), or either (absent). */
  readonly deep?: boolean;
  /** The urban classes it stands in; absent, any but a city centre. */
  readonly urban?: readonly UrbanClass[];
}

/** A clean rectangle is at least this rectangular — `FOOTPRINT_GABLE_MIN_RECTANGULARITY`. */
export const ARCHETYPE_MIN_RECTANGULARITY = 0.85;

/** #1782's starting table, as {@link houseArchetypeOf} reads it. @see ArchetypeCue */
export const ARCHETYPE_CUES: Readonly<Record<Exclude<HouseArchetype, 'unknown'>, ArchetypeCue>> = {
  ranch: {
    area: [120, 250],
    aspect: [1.8, Number.POSITIVE_INFINITY],
    storeys: 1,
    shapes: ['rectangle', 'L'],
    deep: false,
  },
  cape: {
    area: [70, 120],
    aspect: [1, Number.POSITIVE_INFINITY],
    storeys: 1,
    shapes: ['rectangle'],
    deep: false,
  },
  bungalow: {
    area: [80, 140],
    aspect: [1, Number.POSITIVE_INFINITY],
    storeys: 1,
    shapes: ['rectangle'],
    deep: true,
  },
  colonial: {
    area: [90, 160],
    aspect: [1.3, 2.2],
    storeys: 2,
    shapes: ['rectangle'],
    deep: false,
  },
  foursquare: { area: [70, 110], aspect: [1, 1.25], storeys: 2, shapes: ['rectangle'] },
  farmhouse: {
    area: [80, 220],
    aspect: [1, Number.POSITIVE_INFINITY],
    storeys: 2,
    shapes: ['rectangle', 'L'],
    deep: true,
    urban: ['rural'],
  },
};

/** Whether `input` is what `cue` describes. */
function fits(input: ArchetypeInput, cue: ArchetypeCue): boolean {
  const [leastArea, mostArea] = cue.area;
  const [leastAspect, mostAspect] = cue.aspect;
  return (
    input.area >= leastArea &&
    input.area <= mostArea &&
    input.aspect >= leastAspect &&
    input.aspect < mostAspect &&
    input.storeys === cue.storeys &&
    input.shape !== 'other' &&
    cue.shapes.includes(input.shape) &&
    (cue.deep === undefined || cue.deep === input.deep) &&
    (cue.urban === undefined ? input.urban !== 'city-centre' : cue.urban.includes(input.urban))
  );
}

/**
 * The archetype a footprint is — the first of {@link HOUSE_ARCHETYPES} whose
 * cue it fits — or `unknown`: always for a terraced, non-residential or flat
 * one, and for one that is no clean rectangle or L.
 */
export function houseArchetypeOf(input: ArchetypeInput): HouseArchetype {
  if (input.terraced || !input.residential || !input.pitched) return 'unknown';
  if (input.shape === 'rectangle' && input.rectangularity < ARCHETYPE_MIN_RECTANGULARITY) {
    return 'unknown';
  }
  return HOUSE_ARCHETYPES.find((archetype) => fits(input, ARCHETYPE_CUES[archetype])) ?? 'unknown';
}

/**
 * The shape of a footprint drawn with `corners` corners whose #1660 split
 * (`rectilinear-roofs.ts` §`rectanglesOf`) is `rectangles` many, or
 * `undefined` where it has none.
 */
export function footprintShapeOf(corners: number, rectangles: number | undefined): FootprintShape {
  if (corners === 4) return 'rectangle';
  if (corners === 6 && rectangles === 2) return 'L';
  return 'other';
}

/**
 * How likely a feature is, in `[0, 1]`, drawn on the footprint's own stream
 * (0 never, 1 always where it fits), or `seeded`: the independent share it had
 * before #1782, `footprint-buildings.ts`' own constant.
 */
export type FeatureShare = number | 'seeded';

/**
 * Every pitched roof's shape beyond #1581's gable and hip — #1785, built by
 * `footprint-buildings.ts` §`variantRoof` on a rectangle and on each of
 * #1660's split rectangles: a two-pitch `gambrel`, a `half-hipped` gable
 * clipped at its top, a `saltbox` whose ridge stands toward the front, and a
 * `side-hipped` roof, a hip at one end and a gable at the other.
 */
export const ROOF_VARIANTS = ['gambrel', 'half-hipped', 'saltbox', 'side-hipped'] as const;

/** One of {@link ROOF_VARIANTS}, or `plain`: the gable or hip the plan drew before. */
export type RoofVariant = 'plain' | (typeof ROOF_VARIANTS)[number];

/** A variant an archetype may wear, and how likely, drawn on the footprint's own stream; or none. */
export type VariantShare =
  readonly [variant: Exclude<RoofVariant, 'plain'>, share: number] | 'none';

/**
 * A dormer's kind — #1786, built by `footprint-buildings.ts` §`dormers` and
 * §`dormerOf`: #1588's `gabled` dormer, a `shed` dormer (one wide front under
 * a single slope lower than the roof's), and a `hipped` one (its roof hipped
 * at its front).
 */
export const DORMER_KINDS = ['gabled', 'shed', 'hipped'] as const;

/** One of {@link DORMER_KINDS}. */
export type DormerKind = (typeof DORMER_KINDS)[number];

/**
 * The dormers an archetype calls for — #1786: their kind, and how many on the
 * roof's front slope; or none, where its `dormer` share and #1588's rule hold.
 */
export type DormerCall = readonly [kind: DormerKind, count: number] | 'none';

/** The features one archetype admits; `planFootprint` draws only inside them. */
export interface ArchetypeFeatures {
  /** A hip rather than a gable — `HIP_SHARE`. */
  readonly hip: FeatureShare;
  /** The pitches it is drawn from, degrees, each one of `ROOF_PITCHES_DEGREES`; `seeded`, every one. */
  readonly pitches: readonly number[] | 'seeded';
  /** `CHIMNEY_SHARE`. */
  readonly chimney: FeatureShare;
  /** A door canopy where no front porch stands — `PORCH_SHARE`. */
  readonly canopy: FeatureShare;
  /** Posts under that canopy — `PORCH_POSTS_SHARE`. */
  readonly canopyPosts: FeatureShare;
  /** #1589's front porch on posts — `FRONT_PORCH.share`. */
  readonly frontPorch: FeatureShare;
  /** `SHUTTER_SHARE`. */
  readonly shutters: FeatureShare;
  /** `PICTURE_SHARE`. */
  readonly picture: FeatureShare;
  /** `GARAGE_SHARE`. */
  readonly garage: FeatureShare;
  /** `DORMER_SHARE`, on a pitch of at least `DORMER_MIN_PITCH_DEGREES`. */
  readonly dormer: FeatureShare;
  /** Clapboard — `SIDING_SHARE`. */
  readonly siding: FeatureShare;
  /** Under clapboard, a brick foundation rather than block — `BRICK_FOUNDATION_SHARE`. */
  readonly brickFoundation: FeatureShare;
  /** #1785: the roof variant it may wear in place of its gable or hip. */
  readonly roofVariant: VariantShare;
  /**
   * #1786: the dormers it calls for, which take the place of `dormer`'s share
   * and #1588's count by the ridge's reach; with `-dormer-variants`, `dormer` as before.
   */
  readonly dormers: DormerCall;
  /**
   * #1784: how far its pitched roof's eaves overhang the walls across a slope,
   * metres; `seeded`, `EAVES_OVERHANG_METRES` as before. With
   * `-archetype-porches`, as before.
   */
  readonly eaves: number | 'seeded';
  /**
   * #1784: its front porch the front wall's whole width, less its end margins
   * and any garage's bay, on four posts (`full`); or #1589's seeded width.
   * With `-archetype-porches`, #1589's.
   */
  readonly porchWidth: 'full' | 'seeded';
}

/**
 * `unknown`'s features: every one its independent share, as before #1782 —
 * so a footprint no archetype fits is planned byte for byte as it was.
 */
export const SEEDED_FEATURES: ArchetypeFeatures = {
  hip: 'seeded',
  pitches: 'seeded',
  chimney: 'seeded',
  canopy: 'seeded',
  canopyPosts: 'seeded',
  frontPorch: 'seeded',
  shutters: 'seeded',
  picture: 'seeded',
  garage: 'seeded',
  dormer: 'seeded',
  siding: 'seeded',
  brickFoundation: 'seeded',
  roofVariant: 'none',
  dormers: 'none',
  eaves: 'seeded',
  porchWidth: 'seeded',
};

/**
 * What each archetype admits — the "together" column of the module's table.
 * A feature its row does not name keeps its seeded share. Since #1786 each
 * row also names its dormers ({@link DormerCall}): two gabled ones on a Cape,
 * one hipped one on a Foursquare's route-facing slope — its 30–35° under the
 * gabled dormer's 40° — and one wide shed dormer on a bungalow.
 *
 * Since #1784 its eaves and its porch's width too: wide eaves (**0.65 m**) on a
 * bungalow and a Foursquare, tight ones (**0.15 m**) on a Cape, and a
 * full-width front porch on posts on a Foursquare, a bungalow and a
 * farmhouse. A sketch, tuned on the look pair (`levers=-archetype-porches`).
 *
 * Since #1785 four of them may wear a {@link RoofVariant} in its gable's or
 * hip's place, on a share of their footprints: the farmhouse a gambrel, the
 * Colonial a saltbox, the bungalow a half-hipped gable, and the ranch — whose
 * roof is a low hip or a gable — a side-hipped one, half of each. The shares
 * are a sketch, tuned on the owner's look pair (`levers=-roof-variants`).
 */
export const ARCHETYPE_FEATURES: Readonly<
  Record<Exclude<HouseArchetype, 'unknown'>, ArchetypeFeatures>
> = {
  ranch: {
    ...SEEDED_FEATURES,
    pitches: [25],
    canopyPosts: 0,
    frontPorch: 0,
    picture: 1,
    garage: 1,
    dormer: 0,
    roofVariant: ['side-hipped', 0.3],
  },
  cape: {
    ...SEEDED_FEATURES,
    hip: 0,
    pitches: [40, 45],
    canopyPosts: 0,
    frontPorch: 0,
    shutters: 1,
    picture: 0,
    garage: 0,
    dormer: 1,
    dormers: ['gabled', 2],
    eaves: 0.15,
  },
  colonial: {
    ...SEEDED_FEATURES,
    hip: 0,
    pitches: [30, 35],
    chimney: 1,
    canopy: 1,
    canopyPosts: 0,
    frontPorch: 0,
    shutters: 1,
    dormer: 0,
    roofVariant: ['saltbox', 0.35],
  },
  foursquare: {
    ...SEEDED_FEATURES,
    hip: 1,
    pitches: [30, 35],
    canopy: 1,
    canopyPosts: 1,
    frontPorch: 1,
    picture: 0,
    garage: 0,
    dormer: 0,
    dormers: ['hipped', 1],
    eaves: 0.65,
    porchWidth: 'full',
  },
  bungalow: {
    ...SEEDED_FEATURES,
    hip: 0,
    pitches: [25, 30],
    canopy: 1,
    canopyPosts: 1,
    frontPorch: 1,
    shutters: 0,
    dormer: 0,
    siding: 1,
    roofVariant: ['half-hipped', 0.4],
    dormers: ['shed', 1],
    eaves: 0.65,
    porchWidth: 'full',
  },
  farmhouse: {
    ...SEEDED_FEATURES,
    hip: 0,
    pitches: [40, 45],
    canopy: 1,
    canopyPosts: 1,
    frontPorch: 1,
    picture: 0,
    garage: 0,
    siding: 1,
    brickFoundation: 1,
    roofVariant: ['gambrel', 0.4],
    porchWidth: 'full',
  },
};

/** What a plan that would pass a triangle cap gives up, in order: its dormers, then its porch. */
export const ARCHETYPE_DROPS = ['dormers', 'porch'] as const;

/**
 * `features` with the first `dropped` of {@link ARCHETYPE_DROPS} taken away —
 * #1782's rule that a plan over a cap loses features, in a stated order, and
 * is never truncated.
 */
export function droppedFeatures(features: ArchetypeFeatures, dropped: number): ArchetypeFeatures {
  const gone = new Set(ARCHETYPE_DROPS.slice(0, dropped));
  return {
    ...features,
    ...(gone.has('dormers') ? { dormer: 0, dormers: 'none' as const } : {}),
    ...(gone.has('porch') ? { canopy: 0, frontPorch: 0 } : {}),
  };
}
