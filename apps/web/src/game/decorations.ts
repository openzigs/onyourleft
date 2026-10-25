// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where a village's holiday decorations go — #1624, the decoration belt's
 * placement half (epic #1621).
 *
 * Two steps, both pure and seeded:
 *
 * 1. **Anchors**, once a village — {@link villageAnchors}, called by
 *    `streets.ts` §`streetOf` when it builds the village's street, so each
 *    village's anchors are built once a route and carried on its
 *    `VillageStreet` by reference, as its pavements are. An anchor is a place
 *    an item may stand: a point in the corridor's frame, a yaw that turns an
 *    item's own `+z` to the road, and how far the point is from the
 *    carriageway's edge.
 * 2. **Items**, from the anchors in reach — {@link decorationsFor}: for the
 *    holiday on, each anchor takes at most one of that holiday's
 *    {@link DecorationKind}s, by a roll drawn from the anchor's own hash.
 *    No holiday is no item.
 *
 * ## The anchors, and where each comes from
 *
 * | kind | from | where |
 * |---|---|---|
 * | `lamp-post` | `streets.ts` §`furnish`'s lamp posts, every `LAMP_SPACING_METRES` | the post's foot, on the pavement |
 * | `doorstep` | `streets.ts` §`doorPathOf`, the path to a built plot's front door | the path's end at the door |
 * | `eave` | the same door, and the building's plan (`buildings.ts` §`buildingPlan`) | above the door, at the eaves: the lowest point of the plan's roof |
 * | `green` | `settlements.ts` §`everyVillagePlot`'s middle plot, the crossroads, which is never built | either side of the side road's mouth, on each side of the road |
 * | `porch-step` | — | **none yet**: no village building draws a porch, in either world. Porches are drawn on mapped houses (`footprint-buildings.ts` §`frontPorchOf`) and lots (`buildings.ts` §`LOT_PORCH`), which are not villages. The kind is in the type so #1625's table can name it; it places nothing until a village draws a porch |
 *
 * ⚠️ **Never the church plot**: a church's door and eaves are not decorated —
 * {@link villageAnchors} drops every anchor of a plot whose kind is
 * `church`. Its pavement and the lamp posts on it are the street's, not the
 * plot's, and keep theirs.
 *
 * ⚠️ **Never in the carriageway**: every anchor records its distance from the
 * carriageway's edge (`road-grid.ts` §`distanceToDrawnRoad`, the WHOLE road,
 * so a hairpin's other leg counts) and {@link decorationsFor} places no item
 * whose footprint {@link DecorationKind.radius} is wider than that. A green
 * anchor in water, or nearer the road than {@link GREEN_CLEAR_METRES}, is not
 * made at all.
 *
 * A village with no street (`streets.ts` returns none where no pavement can
 * be laid) has no anchors either: a lamp post, a front path and a crossroads
 * all belong to the street.
 *
 * Nothing here is fetched or sent anywhere, and no coordinate is formatted
 * into a string. Pure, and names no rendering library.
 */

import { distanceOnRoute, type RouteProfile } from '@onyourleft/domain';

import { buildingPlan, isBuiltKind, type BuiltKind } from './buildings';
import { VILLAGE_MOUTH_HALF_METRES } from './cross-streets';
import type { LandClassMask } from './land-class';
import { terrainHeightAt } from './landform';
import { distanceToDrawnRoad } from './road-grid';
import type { Holiday } from './season';
import { slotHash, uniformFrom } from './seeded';
import { everyVillagePlot, PLOT_METRES, SETBACK_METRES, type Plot, type Site } from './settlements';
import type { DoorPath, FurnitureItem } from './streets';
import { drawnRoadFrame, ROAD_WIDTH_METRES, type CorridorOrigin } from './terrain';
import { inWater, waterways } from './waterways';

/** The places an item may stand. @see the header */
export type AnchorKind = 'porch-step' | 'doorstep' | 'lamp-post' | 'eave' | 'green';

/**
 * Every {@link AnchorKind}, in a fixed order.
 *
 * @test-facing the owner's page's probe stands on every kind
 * (`browser/realistic/config.ts` §`PROBE_DECORATIONS`), as `decorations.test.ts`
 * and `decoration-belt.test.ts` do; a ride's kinds name their own anchors
 */
export const ANCHOR_KINDS: readonly AnchorKind[] = [
  'porch-step',
  'doorstep',
  'lamp-post',
  'eave',
  'green',
];

/** One place an item may stand, in the corridor's local metres. */
export interface DecorationAnchor {
  readonly kind: AnchorKind;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Yaw, radians: three's, so an item's own `+z` ends up facing the road. */
  readonly yaw: number;
  /** How far the point is from the carriageway's edge, metres. */
  readonly clear: number;
  /** The anchor's own hash, from the route's seed, its village and its place in it. */
  readonly hash: number;
}

/** One box of an item, item-local: `+z` faces the road, `y` up from the anchor. */
export interface DecorationPart {
  /** Width, height and depth, metres. */
  readonly size: readonly [number, number, number];
  /** Where the box's middle is, metres. */
  readonly at: readonly [number, number, number];
  /** Its colour, sRGB, as `0xrrggbb`. */
  readonly colour: number;
  /**
   * Whether it glows: drawn its own colour whatever the light, in the belt's
   * one call (`three-renderer.ts` §`DecorationBelt`). Steady — nothing about
   * it changes from frame to frame (WCAG 2.3.1).
   */
  readonly glows: boolean;
}

/** One kind of item a holiday may place. */
export interface DecorationKind {
  /** Its name, which {@link DecorationItem.item} carries. */
  readonly item: string;
  /** Where it may stand. */
  readonly anchors: readonly AnchorKind[];
  /** The share of those anchors it takes, 0 to 1, before any kind after it. */
  readonly chance: number;
  /** How far its footprint reaches from the anchor, metres: held off the carriageway by it. */
  readonly radius: number;
  /** Its boxes, built from these numbers in both worlds. */
  readonly parts: readonly DecorationPart[];
}

/** The kinds each holiday places, in the order an anchor is offered them. */
export type ItemTable = Readonly<Partial<Record<Holiday, readonly DecorationKind[]>>>;

/**
 * What a ride decorates with: **nothing yet**. #1625 (Halloween), #1626 and
 * #1627 (winter lights) fill it; until then a holiday places no item, and the
 * belt is not drawn. The owner's page registers a probe instead
 * (`browser/realistic/config.ts` §`PROBE_DECORATIONS`), which no rider reaches.
 */
export const HOLIDAY_DECORATIONS: ItemTable = {};

/** One item placed: where, which kind, and a seed of its own for its variation. */
export interface DecorationItem {
  readonly anchor: DecorationAnchor;
  readonly item: string;
  /** A `uint32` drawn from the anchor's hash, for whatever the item varies by. */
  readonly seed: number;
}

/**
 * How far from the carriageway's edge a green anchor must be, metres:
 * **4** — past the pavement's 2 m and the verge beyond it, so whatever stands
 * on the green stands on grass.
 */
export const GREEN_CLEAR_METRES = 4;

/** The hash key every anchor's hash is drawn under — its own, so no other placement correlates. */
const DECORATION_KEY = 0x16_2400;

/** The streams an item's draws come from. */
const STREAM_TAKES = 0;
const STREAM_SEED = 1;

/** How many anchors one village may number apart — far more than any has. */
const ANCHORS_PER_VILLAGE = 1_024;

/** A building's eaves, building-local, by kind and variant: the lowest point of its roof. */
const eaves = new Map<string, number | null>();

function eavesOf(kind: BuiltKind, variant: number): number | null {
  const key = `${kind}:${String(variant)}`;
  const known = eaves.get(key);
  if (known !== undefined) return known;
  const roof = buildingPlan(kind, variant, { openings: false }).triangles.roof;
  let lowest = Number.POSITIVE_INFINITY;
  for (let at = 1; at < roof.length; at += 3) lowest = Math.min(lowest, roof[at] as number);
  const found = Number.isFinite(lowest) ? lowest : null;
  eaves.set(key, found);
  return found;
}

/** One built plot's front door, as `streets.ts` laid its path. */
export interface DoorOfPlot {
  readonly plot: Plot;
  readonly path: DoorPath;
}

/**
 * Every anchor of one village — called once a route by `streets.ts`
 * §`streetOf`, which hands over what it built the street from: the village's
 * site (on the route's first lap), its built plots' front paths and its
 * street furniture. @see the header
 */
export function villageAnchors(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  site: Site,
  doors: readonly DoorOfPlot[],
  furniture: readonly FurnitureItem[],
  land: LandClassMask,
): readonly DecorationAnchor[] {
  const found: DecorationAnchor[] = [];
  const add = (
    kind: AnchorKind,
    x: number,
    y: number,
    z: number,
    yaw: number,
    clear: number,
  ): void => {
    const hash = slotHash(
      seed,
      site.wrappedSite * ANCHORS_PER_VILLAGE + found.length,
      DECORATION_KEY,
    );
    found.push({ kind, x, y, z, yaw, clear, hash });
  };
  const clearOf = (x: number, z: number): number =>
    distanceToDrawnRoad(profile, origin, x, z, SETBACK_METRES + PLOT_METRES) -
    ROAD_WIDTH_METRES / 2;

  for (const item of furniture) {
    if (item.kind !== 'lamp-post') continue;
    add('lamp-post', item.x, item.y, item.z, item.rotation, clearOf(item.x, item.z));
  }

  for (const { plot, path } of doors) {
    // ⚠️ Never the church plot. @see the header
    if (plot.kind === 'church') continue;
    const sections = path.walk.length / 3;
    if (sections < 2) continue;
    const doorX = path.walk[(sections - 1) * 3] as number;
    const doorY = path.walk[(sections - 1) * 3 + 1] as number;
    const doorZ = path.walk[(sections - 1) * 3 + 2] as number;
    // From the door back towards the pavement is towards the road.
    const towardX = (path.walk[0] as number) - doorX;
    const towardZ = (path.walk[2] as number) - doorZ;
    const yaw = Math.atan2(towardX, towardZ);
    add('doorstep', doorX, doorY, doorZ, yaw, clearOf(doorX, doorZ));
    if (!isBuiltKind(plot.kind)) continue;
    const top = eavesOf(plot.kind, plot.variant);
    const frame = drawnRoadFrame(profile, origin, distanceOnRoute(profile, plot.along));
    if (top === null || frame === undefined) continue;
    // The building stands where `settlements.ts` §`standing` stands it.
    const ground = terrainHeightAt(
      profile,
      origin,
      seed,
      distanceOnRoute(profile, plot.along),
      plot.lateral * plot.side,
      land,
    );
    add('eave', doorX, ground + top, doorZ, yaw, clearOf(doorX, doorZ));
  }

  // The crossroads green: the middle plot either side, which is never built,
  // on both sides of the side road's mouth.
  const ways = waterways(profile, seed);
  const offset = (VILLAGE_MOUTH_HALF_METRES + PLOT_METRES / 2) / 2;
  for (const plot of everyVillagePlot(seed, site)) {
    if (plot.built || Math.abs(plot.along - site.centre) > 1e-6) continue;
    for (const along of [plot.along - offset, plot.along + offset]) {
      const wrapped = distanceOnRoute(profile, along);
      const frame = drawnRoadFrame(profile, origin, wrapped);
      if (frame === undefined) continue;
      const lateral = plot.lateral * plot.side;
      if (inWater(ways, profile, wrapped, lateral)) continue;
      const x = frame.x + frame.normalX * lateral;
      const z = frame.z + frame.normalZ * lateral;
      const clear = clearOf(x, z);
      if (!(clear >= GREEN_CLEAR_METRES)) continue;
      const y = terrainHeightAt(profile, origin, seed, wrapped, lateral, land);
      add(
        'green',
        x,
        y,
        z,
        Math.atan2(-frame.normalX * plot.side, -frame.normalZ * plot.side),
        clear,
      );
    }
  }
  return found;
}

/**
 * The items for `holiday` on every village's anchors, in village and anchor
 * order: none with no holiday, and none where `kinds` names none for it. Each
 * anchor offers itself to the holiday's kinds in order, and takes the first
 * that may stand there, rolls under its {@link DecorationKind.chance} and is
 * no wider than the anchor's clearance from the carriageway. @see the header
 */
export function decorationsFor(
  villages: readonly { readonly anchors: readonly DecorationAnchor[] }[],
  holiday: Holiday | undefined,
  kinds: ItemTable,
): DecorationItem[] {
  if (holiday === undefined) return [];
  const offered = kinds[holiday];
  if (offered === undefined || offered.length === 0) return [];
  const items: DecorationItem[] = [];
  for (const village of villages) {
    for (const anchor of village.anchors) {
      for (const [which, kind] of offered.entries()) {
        if (!kind.anchors.includes(anchor.kind)) continue;
        if (kind.radius > anchor.clear) continue;
        const stream = which * 2;
        if (!(uniformFrom(anchor.hash, stream + STREAM_TAKES) < kind.chance)) continue;
        items.push({
          anchor,
          item: kind.item,
          seed: slotHash(anchor.hash, which, STREAM_SEED),
        });
        break;
      }
    }
  }
  return items;
}
