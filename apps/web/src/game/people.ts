// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * People walking and running — #1541: where they walk, how many, and where
 * each one is at a given second of the ride. Draws nothing:
 * `three-renderer.ts` §`PeopleBelt` draws what {@link peopleAt} places.
 *
 * ## Where people walk
 *
 * Only where a person may walk, and nowhere else:
 *
 * - a village's **pavements**, along the line `streets.ts` §`walkOf` gives
 *   each unbroken run, and its **front paths** (#1564), between the pavement
 *   and the door (`streets.ts` §`DoorPath.walk`);
 * - the corridor's mapped **footways** (#1551's `footways.ts`
 *   §`footwayNetwork`, crossings already out), on the ground beside them.
 *
 * Each is a {@link WalkLine}. A person walks one line to its end and back,
 * so they never step off it.
 *
 * ## ⚠️ Never on the carriageway — the rule
 *
 * Every place a person is put is first held off EVERY stretch of the drawn
 * road by {@link PERSON_CLEARANCE_METRES} — the road's half-width and a
 * person's half-width (`road-grid.ts` §`distanceToDrawnRoad`). Twice: a line
 * is broken where a point of it fails ({@link walkLine}), so a walker turns
 * back before the kerb rather than vanishing at it; and a person placed
 * between two kept points that still fails (the inside of a bend between two
 * points 2 m apart) is not drawn ({@link peopleAt}). The browser gate holds
 * what the renderer DREW to it, and its control is {@link PeopleOptions.rule}
 * off: a mapped sidewalk a little nearer the road than a person's half-width
 * then puts somebody's shoulder over the kerb line.
 *
 * ## A pavement walked once — #1620
 *
 * Where a village's (or a city centre's) pavement is laid on the side a
 * sidewalk is mapped (#1551), the mapped line and the pavement's own walk
 * would both be walked, and a person on the mapped one stands on the ground
 * under the pavement, a kerb's height below its top. So a mapped footway is
 * broken wherever it is ON a drawn pavement ({@link clearOfPavements}): the
 * pavement's own walk carries its people, at its own density and on its top,
 * and the mapped line carries its people everywhere else.
 *
 * ## Who walks, and how many
 *
 * By settlement size (phase A) and land use (phase B), in people per metre of
 * line ({@link PEOPLE_PER_METRE}): a village's pavements by how many of its
 * houses have a front path; a mapped footway by the land at its middle
 * (`land-class.ts`) and, on built-up land, its `kind` (commercial and retail
 * busier than residential). **Runners** keep to paths and parks
 * ({@link RUNNER_SHARE}): a sidewalk, a pavement and a front path have none.
 *
 * ## Where each one is — a function of the second, not a walk forward
 *
 * A line's people are seeded from the line and their slot, so the same
 * second of the same ride puts everybody in the same place whatever was drawn
 * before, as `scatter.ts` places its trees. Each one's start, speed, height,
 * gait and look are drawn from `seeded.ts`; where they are is their start plus
 * their speed times the ride's clock, folded back and forth along the line.
 * Their gait's phase advances by the ground covered over their stride
 * (`gait.ts` §`STRIDE_PER_HEIGHT`), so a foot does not slide. A ride that is
 * held holds them, as #625's breath is held.
 *
 * ## The budget — the issue's
 *
 * At most {@link PEOPLE_NEAR_MAX} people within {@link PEOPLE_NEAR_METRES} of
 * the rider, drawn as bodies (`people-body.ts`: about 2 000 triangles each,
 * 32 000 in all, one instanced draw); beyond that, out to
 * {@link PEOPLE_FAR_METRES}, at most {@link PEOPLE_FAR_MAX} impostors in one
 * more draw. The nearest first. A rung that draws no people asks for none.
 *
 * ⚠️ **Location data** (ADR 0004 D): nothing here formats a message.
 *
 * Pure, and names no rendering library.
 */

import type { RouteProfile } from '@onyourleft/domain';

import { FOOTWAY_MAX_LINES, FOOTWAY_MAX_METRES, footwayNetwork } from './footways';
import { GAITS, STRIDE_PER_HEIGHT, wrappedPhase, type Gait } from './gait';
import { kindAt, type LandClassMask } from './land-class';
import { terrainHeightAt } from './landform';
import { distanceToDrawnRoad, nearestOnDrawnRoad } from './road-grid';
import { slotHash, uniformFrom } from './seeded';
import { PLOT_METRES, VILLAGE_METRES } from './settlements';
import { WALK_FROM_KERB_METRES, type VillageStreet } from './streets';
import { ROAD_WIDTH_METRES, type CorridorOrigin } from './terrain';
import { CORRIDOR_HALF_WIDTH_METRES, type WorldCorridor } from './world-data/corridor';

/** The most people drawn as bodies: **16** — the issue's "at most 16 people within 60 m". */
export const PEOPLE_NEAR_MAX = 16;

/** How near the rider a person is drawn as a body, in metres: **60** — the issue's. */
export const PEOPLE_NEAR_METRES = 60;

/**
 * How far from the rider a person is drawn at all, in metres: **150** — beyond
 * {@link PEOPLE_NEAR_METRES}, as an impostor. A 1.75 m person is under 10
 * pixels tall there on the tablet's 1 200-pixel-high screen through
 * `camera.ts`' lens, and the fog has most of them.
 */
export const PEOPLE_FAR_METRES = 150;

/** The most impostors drawn: **32**, the nearest first. */
export const PEOPLE_FAR_MAX = 32;

/** Half a person's width at the shoulders, arms swinging, in metres: **0.3**. */
export const PERSON_HALF_WIDTH_METRES = 0.3;

/**
 * How near the drawn road's centreline a person's middle may come, in metres:
 * **3.8** — the carriageway's half-width (`terrain.ts` §`ROAD_WIDTH_METRES` /
 * 2) and {@link PERSON_HALF_WIDTH_METRES}, so no part of anybody is over the
 * kerb line. @see the header's rule
 */
export const PERSON_CLEARANCE_METRES = ROAD_WIDTH_METRES / 2 + PERSON_HALF_WIDTH_METRES;

/** What a line is. */
export type WalkKind = 'pavement' | 'door-path' | 'sidewalk' | 'footway' | 'park';

/**
 * People per metre of line, by what it is — #1541's density:
 *
 * - `pavement`: a village's, at its fullest — scaled by how many of its houses
 *   have a front path ({@link villageDensity}), so a hamlet's street is
 *   quieter than a full village's;
 * - `door-path`: a front path is short, so this is the chance somebody is on
 *   one: about one path in five, over a path's 3 to 8 m;
 * - a mapped footway by its land: `commercial` and `retail` built-up land the
 *   busiest, other built-up land half that, a park's paths a little less, and
 *   anything else — fields, woods, unclassed — the quietest.
 */
export const PEOPLE_PER_METRE = {
  pavement: 0.06,
  'door-path': 0.04,
  commercial: 0.08,
  'built-up': 0.04,
  park: 0.03,
  elsewhere: 0.01,
} as const;

/**
 * The share of a line's people who run, by what it is: **0.5** in a park,
 * **0.3** on a plain path or footway, and none on a sidewalk, a pavement or a
 * front path — the issue's "runners on paths and in parks".
 */
export const RUNNER_SHARE: Readonly<Record<WalkKind, number>> = {
  pavement: 0,
  'door-path': 0,
  sidewalk: 0,
  footway: 0.3,
  park: 0.5,
};

/** How fast a walker goes, metres a second: **1.1** to **1.6**. */
export const WALK_SPEED = [1.1, 1.6] as const;

/** How fast a runner goes, metres a second: **2.5** to **3.5**. */
export const RUN_SPEED = [2.5, 3.5] as const;

/** How tall a person is, metres: **1.55** to **1.9**. */
export const PERSON_HEIGHT = [1.55, 1.9] as const;

/** One line people walk, built once. */
export interface WalkLine {
  /** `x, y, z` a point, corridor frame. A `y` that is `NaN` is read when first needed. */
  readonly points: Float32Array;
  /** Metres along the line at each point. */
  readonly along: Float32Array;
  readonly length: number;
  readonly kind: WalkKind;
  /** People per metre of it, as it was built: what a piece of it carries (#1620). */
  readonly perMetre: number;
  /** How many people walk it. */
  readonly people: number;
  /** The seed of its people. */
  readonly key: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** What a person wears, as sRGB hex: skin, top, bottoms, shoes and hair. */
export interface PersonLook {
  readonly skin: number;
  readonly top: number;
  readonly bottoms: number;
  readonly shoes: number;
  readonly hair: number;
}

/** One person, where a frame draws them. */
export interface Person {
  readonly x: number;
  /** The ground under their feet. */
  readonly y: number;
  readonly z: number;
  /** Which way they face: three's yaw, so a body facing `+z` turns to face it. */
  readonly yaw: number;
  readonly gait: Gait;
  /** Where in their gait's cycle they are, `[0, 1)`. */
  readonly phase: number;
  /** Metres. */
  readonly height: number;
  readonly look: PersonLook;
  /** How far from the rider, in plan. */
  readonly distance: number;
}

/** The people a frame draws: bodies near, impostors beyond. */
export interface PeopleInView {
  readonly near: readonly Person[];
  readonly far: readonly Person[];
}

/** Nobody. */
export const NO_PEOPLE: PeopleInView = Object.freeze({ near: [], far: [] });

/**
 * Skin tones, as sRGB — a spread from light to deep, so a street is not one
 * person repeated.
 */
export const SKIN_TONES: readonly number[] = [
  0xf1c6a6, 0xe0ac8a, 0xc68863, 0xa86b4a, 0x8a5536, 0x6b3f28, 0x4f2e1e,
];

/** Clothes' colours, as sRGB: muted, as a street's are. */
export const CLOTHES: readonly number[] = [
  0x2b3a55, 0x4a4a4a, 0x7a2e2e, 0x2f5d50, 0xc9c1b1, 0x1f1f24, 0x8c6a3f, 0x5d6d7e, 0xb04a32,
  0x3d5a80, 0xd9d4c7, 0x6b4e71,
];

/** Shoes, as sRGB. */
export const SHOES: readonly number[] = [0x1a1a1a, 0x3b2a1e, 0xe8e8e8, 0x5a5a5a];

/** Hair, as sRGB. */
export const HAIR: readonly number[] = [0x1b1410, 0x3b2617, 0x6a4a2c, 0xa7834f, 0x8a8a8a, 0x2a1a12];

function pick(list: readonly number[], share: number): number {
  return list[Math.min(list.length - 1, Math.floor(share * list.length))] as number;
}

/** A person's seeded look, from their hash. */
export function personLook(hash: number): PersonLook {
  return {
    skin: pick(SKIN_TONES, uniformFrom(hash, 10)),
    top: pick(CLOTHES, uniformFrom(hash, 11)),
    bottoms: pick(CLOTHES, uniformFrom(hash, 12)),
    shoes: pick(SHOES, uniformFrom(hash, 13)),
    hair: pick(HAIR, uniformFrom(hash, 14)),
  };
}

/** The most houses a village's street has: every plot on both sides but its crossroads'. */
const VILLAGE_MOST_HOUSES = 2 * (Math.floor(VILLAGE_METRES / PLOT_METRES) + 1) - 2;

/**
 * People per metre of a village's pavement — phase A's "density by settlement
 * size": a quarter of {@link PEOPLE_PER_METRE}'s `pavement` at the least, and
 * all of it at a street whose every plot has a house with a front path.
 */
export function villageDensity(houses: number): number {
  const share = Math.min(1, Math.max(0, houses / VILLAGE_MOST_HOUSES));
  return PEOPLE_PER_METRE.pavement * (0.25 + 0.75 * share);
}

/**
 * Where the drawn road is, for the rule: how near ANY stretch of it `(x, z)`
 * comes, searched out to `reach` (`road-grid.ts` §`distanceToDrawnRoad`).
 */
export type RoadDistance = (x: number, z: number, reach: number) => number;

/**
 * One line, `x, y, z` a point (or `x, z` with `stride` 2, every `y` read
 * later), broken wherever a point comes within
 * {@link PERSON_CLEARANCE_METRES} of the road — the rule, unless `rule` is
 * off — into the runs people walk, each with `perMetre` people (rounded by
 * `key`'s hash).
 */
export function walkLine(
  points: ArrayLike<number>,
  stride: 2 | 3,
  kind: WalkKind,
  perMetre: number,
  key: number,
  road: RoadDistance,
  rule: boolean,
): WalkLine[] {
  const runs: number[][] = [];
  let run: number[] = [];
  const close = (): void => {
    if (run.length >= 6) runs.push(run);
    run = [];
  };
  for (let at = 0; at + stride - 1 < points.length; at += stride) {
    const x = points[at] as number;
    const z = points[at + stride - 1] as number;
    const y = stride === 3 ? (points[at + 1] as number) : Number.NaN;
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      close();
      continue;
    }
    if (rule && road(x, z, PERSON_CLEARANCE_METRES + 1) < PERSON_CLEARANCE_METRES) {
      close();
      continue;
    }
    run.push(x, y, z);
  }
  close();
  return runs.map((kept, index) => lineOf(kept, kind, perMetre, slotHash(key, index, 0x51)));
}

function lineOf(kept: readonly number[], kind: WalkKind, perMetre: number, key: number): WalkLine {
  const count = kept.length / 3;
  const along = new Float32Array(count);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let length = 0;
  for (let point = 0; point < count; point += 1) {
    const x = kept[point * 3] as number;
    const z = kept[point * 3 + 2] as number;
    if (point > 0) {
      length += Math.hypot(
        x - (kept[point * 3 - 3] as number),
        z - (kept[point * 3 - 1] as number),
      );
    }
    along[point] = length;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const expected = length * perMetre;
  // Rounded up or down by the line's own hash, so the mean is the density.
  const people = Math.floor(expected) + (uniformFrom(key, 0) < expected % 1 ? 1 : 0);
  return {
    points: Float32Array.from(kept),
    along,
    length,
    kind,
    perMetre,
    people,
    key,
    minX,
    maxX,
    minZ,
    maxZ,
  };
}

/** The pavements' and front paths' lines of each street, once a street and rule. */
const streetLines = new WeakMap<VillageStreet, Map<boolean, readonly WalkLine[]>>();

/** A village street's lines. @see the header */
export function streetWalks(
  street: VillageStreet,
  road: RoadDistance,
  rule = true,
): readonly WalkLine[] {
  let byRule = streetLines.get(street);
  if (byRule === undefined) {
    byRule = new Map();
    streetLines.set(street, byRule);
  }
  const known = byRule.get(rule);
  if (known !== undefined) return known;
  const density = villageDensity(street.doorPaths.length);
  const lines: WalkLine[] = [];
  street.walks.forEach((walk, index) => {
    lines.push(
      ...walkLine(walk, 3, 'pavement', density, slotHash(street.wrappedSite, index, 1), road, rule),
    );
  });
  street.doorPaths.forEach((path, index) => {
    lines.push(
      ...walkLine(
        path.walk,
        3,
        'door-path',
        PEOPLE_PER_METRE['door-path'],
        slotHash(street.wrappedSite, index, 2),
        road,
        rule,
      ),
    );
  });
  byRule.set(rule, lines);
  return lines;
}

/** What a footway is, by its `kind_detail` and the land at its middle. */
function footwayKind(detail: string, land: LandClassMask, x: number, z: number): WalkKind {
  if (land.classAt(x, z) === 'park') return 'park';
  return detail === 'sidewalk' ? 'sidewalk' : 'footway';
}

/** People per metre of a mapped footway, by the land at its middle. @see PEOPLE_PER_METRE */
function footwayDensity(
  corridor: WorldCorridor,
  land: LandClassMask,
  x: number,
  z: number,
): number {
  const here = land.classAt(x, z);
  if (here === 'park') return PEOPLE_PER_METRE.park;
  if (here === 'built-up') {
    const kind = kindAt(corridor, x, z);
    return kind === 'commercial' || kind === 'retail'
      ? PEOPLE_PER_METRE.commercial
      : PEOPLE_PER_METRE['built-up'];
  }
  return PEOPLE_PER_METRE.elsewhere;
}

/** The corridor's footways' lines, once a corridor, profile, mask and rule. */
const footwayLines = new WeakMap<
  WorldCorridor,
  { profile: RouteProfile; land: LandClassMask; rule: boolean; lines: readonly WalkLine[] }[]
>();

/**
 * The corridor's mapped footways as lines people walk — #1551's network,
 * bounded as `footways.ts` bounds it, each line's density and kind from the
 * land at its middle. Built once per corridor. @see the header
 */
export function footwayWalks(
  corridor: WorldCorridor,
  profile: RouteProfile,
  origin: CorridorOrigin,
  land: LandClassMask,
  rule = true,
): readonly WalkLine[] {
  const cached = footwayLines.get(corridor) ?? [];
  const found = cached.find(
    (entry) => entry.profile === profile && entry.land === land && entry.rule === rule,
  );
  if (found !== undefined) return found.lines;
  const network = footwayNetwork(corridor, profile, origin, {
    maxLines: FOOTWAY_MAX_LINES,
    maxMetres: FOOTWAY_MAX_METRES,
  });
  const road: RoadDistance = (x, z, reach) => distanceToDrawnRoad(profile, origin, x, z, reach);
  const lines: WalkLine[] = [];
  network.lines.forEach((line, index) => {
    const middle = Math.floor(line.length / 4) * 2;
    const x = line[middle] as number;
    const z = line[middle + 1] as number;
    const kind = footwayKind(network.details[index] ?? '', land, x, z);
    lines.push(
      ...walkLine(
        line,
        2,
        kind,
        footwayDensity(corridor, land, x, z),
        slotHash(0x1541, index, 3),
        road,
        rule,
      ),
    );
  });
  cached.push({ profile, land, rule, lines });
  footwayLines.set(corridor, cached);
  return lines;
}

/** A street's pavements as {@link clearOfPavements} reads them: segments, reaches, and their box. */
interface PavementBands {
  /** Every walk's segments, five floats a segment: `ax, az, bx, bz` and the pavement's reach. */
  readonly segments: Float32Array;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

const bandsOf = new WeakMap<VillageStreet, PavementBands>();

/**
 * A street's pavements as bands round its walks: each reaches
 * `streets.ts` §`WALK_FROM_KERB_METRES` in, to the kerb, and its width less
 * that out, to its back — so a band read the same distance both ways reaches
 * the back and, kerbside, only onto the carriageway the rule already keeps
 * people off. Built once a street.
 */
function pavementBands(street: VillageStreet): PavementBands {
  const known = bandsOf.get(street);
  if (known !== undefined) return known;
  const segments: number[] = [];
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  street.walks.forEach((walk, index) => {
    const reach = (street.walkWidths[index] ?? 0) - WALK_FROM_KERB_METRES;
    for (let at = 0; at + 5 < walk.length; at += 3) {
      const ax = walk[at] as number;
      const az = walk[at + 2] as number;
      const bx = walk[at + 3] as number;
      const bz = walk[at + 5] as number;
      segments.push(ax, az, bx, bz, reach);
      minX = Math.min(minX, ax - reach, bx - reach);
      maxX = Math.max(maxX, ax + reach, bx + reach);
      minZ = Math.min(minZ, az - reach, bz - reach);
      maxZ = Math.max(maxZ, az + reach, bz + reach);
    }
  });
  const bands = { segments: Float32Array.from(segments), minX, maxX, minZ, maxZ };
  bandsOf.set(street, bands);
  return bands;
}

/** Whether `(x, z)` is on any of `bands`' pavements. */
function onPavement(bands: readonly PavementBands[], x: number, z: number): boolean {
  for (const band of bands) {
    if (x < band.minX || x > band.maxX || z < band.minZ || z > band.maxZ) continue;
    const s = band.segments;
    for (let at = 0; at + 4 < s.length; at += 5) {
      const ax = s[at] as number;
      const az = s[at + 1] as number;
      const dx = (s[at + 2] as number) - ax;
      const dz = (s[at + 3] as number) - az;
      const span = dx * dx + dz * dz;
      const t = span > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / span)) : 0;
      if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) <= (s[at + 4] as number)) return true;
    }
  }
  return false;
}

/** Each mapped line's pieces off the pavements, by the streets it was cut against. */
const offPavements = new WeakMap<
  WalkLine,
  { streets: readonly VillageStreet[]; lines: readonly WalkLine[] }
>();

/**
 * `lines`, every mapped footway among them broken wherever it is on the
 * pavement of one of `streets` — #1620. @see the header's "A pavement walked
 * once"
 *
 * A pavement's own walk and a front path are kept whole. A footway whose box
 * meets no street's is the same line, so its people stand where they stood;
 * one that does is cut once for the streets it meets, and again only when
 * those change. Each piece carries the line's own density.
 */
export function clearOfPavements(
  lines: readonly WalkLine[],
  streets: readonly VillageStreet[],
): readonly WalkLine[] {
  if (streets.length === 0) return lines;
  const all = streets.map((street) => ({ street, bands: pavementBands(street) }));
  const out: WalkLine[] = [];
  for (const line of lines) {
    if (line.kind === 'pavement' || line.kind === 'door-path') {
      out.push(line);
      continue;
    }
    const meets = all.filter(
      ({ bands }) =>
        line.maxX >= bands.minX &&
        line.minX <= bands.maxX &&
        line.maxZ >= bands.minZ &&
        line.minZ <= bands.maxZ,
    );
    if (meets.length === 0) {
      out.push(line);
      continue;
    }
    const known = offPavements.get(line);
    if (
      known !== undefined &&
      known.streets.length === meets.length &&
      known.streets.every((street, index) => street === meets[index]?.street)
    ) {
      out.push(...known.lines);
      continue;
    }
    const bands = meets.map((entry) => entry.bands);
    const runs: number[][] = [];
    let run: number[] = [];
    let cut = false;
    const close = (): void => {
      if (run.length >= 6) runs.push(run);
      run = [];
    };
    for (let at = 0; at + 2 < line.points.length; at += 3) {
      const x = line.points[at] as number;
      const z = line.points[at + 2] as number;
      if (onPavement(bands, x, z)) {
        cut = true;
        close();
        continue;
      }
      run.push(x, line.points[at + 1] as number, z);
    }
    close();
    const pieces = cut
      ? runs.map((kept, index) =>
          lineOf(kept, line.kind, line.perMetre, slotHash(line.key, index, 0x1620)),
        )
      : [line];
    offPavements.set(line, { streets: meets.map((entry) => entry.street), lines: pieces });
    out.push(...pieces);
  }
  return out;
}

/** What {@link peopleAt} needs beyond the lines. */
export interface PeopleOptions {
  /** Where the rider is, in plan. */
  readonly x: number;
  readonly z: number;
  /** The ride's clock, seconds. */
  readonly seconds: number;
  /** The most bodies the rung draws: {@link PEOPLE_NEAR_MAX} at most; 0 draws nobody at all. */
  readonly near: number;
  /**
   * Whether the rule holds — #1541's control. `false` draws people on a line's
   * every point and wherever between, carriageway or not: the browser gate's
   * control, and nothing else.
   */
  readonly rule: boolean;
  readonly road: RoadDistance;
  /** The ground at `(x, z)`, for a line whose `y` was not known. */
  readonly ground: (x: number, z: number) => number;
}

/** One person's seeded draw: start, speed, gait, height, look. */
interface Walker {
  readonly start: number;
  readonly speed: number;
  readonly gait: Gait;
  readonly height: number;
  readonly offset: number;
  readonly hash: number;
}

function walkerOf(line: WalkLine, slot: number): Walker {
  const hash = slotHash(line.key, slot, 0x1541);
  const gait: Gait = uniformFrom(hash, 1) < RUNNER_SHARE[line.kind] ? 'run' : 'walk';
  const [slow, fast] = gait === 'run' ? RUN_SPEED : WALK_SPEED;
  return {
    start: uniformFrom(hash, 0) * 2 * line.length,
    speed: slow + (fast - slow) * uniformFrom(hash, 2),
    gait,
    height: PERSON_HEIGHT[0] + (PERSON_HEIGHT[1] - PERSON_HEIGHT[0]) * uniformFrom(hash, 3),
    offset: uniformFrom(hash, 4),
    hash,
  };
}

/** The point `s` metres along `line`, and the segment it is on. */
function pointOn(
  line: WalkLine,
  s: number,
  ground: (x: number, z: number) => number,
): { x: number; y: number; z: number; dx: number; dz: number } {
  const along = line.along;
  let low = 0;
  let high = along.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if ((along[middle] as number) <= s) low = middle;
    else high = middle;
  }
  const a = low;
  const b = Math.min(along.length - 1, low + 1);
  const span = (along[b] as number) - (along[a] as number);
  const t = span > 0 ? Math.min(1, Math.max(0, (s - (along[a] as number)) / span)) : 0;
  const p = line.points;
  const ax = p[a * 3] as number;
  const az = p[a * 3 + 2] as number;
  const bx = p[b * 3] as number;
  const bz = p[b * 3 + 2] as number;
  // A `y` not known yet is read once and kept: the line is built once a ride.
  for (const point of [a, b]) {
    if (Number.isNaN(p[point * 3 + 1])) {
      p[point * 3 + 1] = ground(p[point * 3] as number, p[point * 3 + 2] as number);
    }
  }
  const ay = p[a * 3 + 1] as number;
  const by = p[b * 3 + 1] as number;
  return {
    x: ax + (bx - ax) * t,
    y: ay + (by - ay) * t,
    z: az + (bz - az) * t,
    dx: bx - ax,
    dz: bz - az,
  };
}

/**
 * The people a frame draws at `options.seconds` of the ride: every line's
 * people where they are then, kept off the carriageway by the rule, the
 * nearest {@link PeopleOptions.near} within {@link PEOPLE_NEAR_METRES} as
 * bodies and the nearest {@link PEOPLE_FAR_MAX} beyond it, to
 * {@link PEOPLE_FAR_METRES}, as impostors. @see the header
 */
export function peopleAt(lines: readonly WalkLine[], options: PeopleOptions): PeopleInView {
  if (options.near <= 0) return NO_PEOPLE;
  const reach = PEOPLE_FAR_METRES;
  const found: Person[] = [];
  for (const line of lines) {
    if (line.people === 0) continue;
    if (
      line.maxX < options.x - reach ||
      line.minX > options.x + reach ||
      line.maxZ < options.z - reach ||
      line.minZ > options.z + reach
    ) {
      continue;
    }
    for (let slot = 0; slot < line.people; slot += 1) {
      const walker = walkerOf(line, slot);
      const travelled = walker.start + walker.speed * options.seconds;
      const folded = travelled % (2 * line.length);
      const outward = folded <= line.length;
      const s = outward ? folded : 2 * line.length - folded;
      const at = pointOn(line, s, options.ground);
      const distance = Math.hypot(at.x - options.x, at.z - options.z);
      // Out of reach, or on ground no stretch of the road reaches to read.
      if (distance > reach || !Number.isFinite(at.y)) continue;
      // The rule, between two kept points. @see the header
      if (
        options.rule &&
        options.road(at.x, at.z, PERSON_CLEARANCE_METRES + 1) < PERSON_CLEARANCE_METRES
      ) {
        continue;
      }
      const sign = outward ? 1 : -1;
      found.push({
        x: at.x,
        y: at.y,
        z: at.z,
        yaw: Math.atan2(at.dx * sign, at.dz * sign),
        gait: walker.gait,
        phase: wrappedPhase(
          travelled / (STRIDE_PER_HEIGHT[walker.gait] * walker.height) + walker.offset,
        ),
        height: walker.height,
        look: personLook(walker.hash),
        distance,
      });
    }
  }
  found.sort((a, b) => a.distance - b.distance);
  const most = Math.min(PEOPLE_NEAR_MAX, options.near);
  const near = found.filter((person) => person.distance <= PEOPLE_NEAR_METRES).slice(0, most);
  const far = found
    .filter((person) => person.distance > PEOPLE_NEAR_METRES)
    .slice(0, PEOPLE_FAR_MAX);
  return { near, far };
}

/** The ground at a point of the corridor, as a person on a mapped footway stands on it. */
export function groundOf(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  land: LandClassMask,
): (x: number, z: number) => number {
  return (x, z) => {
    const near = nearestOnDrawnRoad(profile, origin, x, z, CORRIDOR_HALF_WIDTH_METRES);
    if (near === undefined) return Number.NaN;
    return terrainHeightAt(profile, origin, seed, near.along, near.lateral, land);
  };
}

/** Every gait's index in the animation texture. @see GAITS */
export function gaitIndex(gait: Gait): number {
  return GAITS.indexOf(gait);
}
