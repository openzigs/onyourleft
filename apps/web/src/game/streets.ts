// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A village's street — #1535: a kerb and a pavement beside the road, on each
 * side of a village that has a house on it.
 *
 * ## What was wrong
 *
 * A village (`settlements.ts`, #460) was houses set back from a country road
 * whose grass verge ran straight through it: nothing said "street". Owner,
 * 2026-10-21 (#1533): *"Possibly some areas with city buildings, sidewalks in
 * areas."*
 *
 * ## ⚠️ Where a pavement goes — from the route, the seed and the layout only
 *
 * No map data: ADR 0032 D-1 still stands (#1533's phase A). A pavement is laid
 * along a side of a village exactly where that side's BUILT plots are, from
 * `settlements.ts` §`siteAt` and §`villagePlots` — the same decision the houses
 * are placed from, never a copy of it — from {@link PAVEMENT_END_INSET_METRES}
 * inside the first built plot's boundary to as far inside the last's. A side
 * with no house on it has no pavement, a farmstead has none (it is a farm, not
 * a street), and nothing outside a village has any.
 *
 * Its cross-section, from the road outwards:
 *
 * - a **kerb face**, {@link KERB_HEIGHT_METRES} high, standing on the road's
 *   own edge (`terrain.ts` §`ROAD_WIDTH_METRES` / 2) — the carriageway is never
 *   narrowed and never covered, and the road's surface and #628's wear are the
 *   road's mesh, untouched;
 * - the **pavement**, {@link PAVEMENT_WIDTH_METRES} wide, level with the kerb's
 *   top;
 * - a **back face** down to {@link PAVEMENT_FOOTING_METRES} below the road, so
 *   the verge `landform.ts` drops beside the road (0.25 m) never shows a gap
 *   under it.
 *
 * ## ⚠️ Never on the carriageway, never on water
 *
 * Sampled every {@link PAVEMENT_STEP_METRES} along the DRAWN road
 * (`terrain.ts` §`drawnRoadFrame`, the frame `settlements.ts` stands its
 * buildings in), and a sample is dropped — breaking the strip there — when:
 *
 * - any of its three edges comes within the road's half-width of ANY stretch of
 *   the drawn road (`road-grid.ts` §`distanceToDrawnRoad`), the rule
 *   `settlements.ts` §`structureClearance` holds a house to, at the
 *   carriageway's edge rather than the verge's because a kerb stands ON that
 *   edge. A hairpin's other leg, or the inside of a bend tighter than a village
 *   is built on, loses its pavement there rather than gaining one in the road;
 * - its middle stands in water or on a bank (`waterways.ts` §`inWater`).
 *
 * ## Cost, and why it is computed once
 *
 * A pavement is fixed in the corridor's frame (one origin a ride), so each
 * village's street is built once per route and kept in a `WeakMap` keyed on
 * the profile OBJECT — `waterways.ts` §`computed`'s argument, and its pattern.
 * A frame carries the streets in view by reference, and the renderer rebuilds
 * its one mesh only when that set changes. A 180 m village with both sides
 * built is about 2 × 92 samples, six vertices and six triangles a sample: about
 * 1 100 vertices and 1 100 triangles — `three-renderer.ts` §`PavementBelt`
 * draws every street in view in ONE call.
 *
 * Pure, and names no rendering library.
 */

import { distanceOnRoute, elevationAt, type RouteProfile } from '@onyourleft/domain';

import { distanceToDrawnRoad } from './road-grid';
import { PLOT_METRES, siteAt, siteSpacing, villagePlots, VILLAGE_METRES } from './settlements';
import { drawnRoadFrame, ROAD_WIDTH_METRES, type CorridorOrigin } from './terrain';
import { inWater, waterways } from './waterways';

/** How far from the centreline the kerb's face stands, in metres: the road's own edge, **3.5**. */
export const KERB_LATERAL_METRES = ROAD_WIDTH_METRES / 2;

/** How high the kerb stands above the road, in metres: **0.12** — a common kerb's upstand. */
export const KERB_HEIGHT_METRES = 0.12;

/** How wide the pavement is, kerb included, in metres: **2**. */
export const PAVEMENT_WIDTH_METRES = 2;

/**
 * How far below the road the pavement's back face reaches, in metres:
 * **0.45** — past the verge's 0.25 m drop (`landform.ts` §`VERGE_DROP_METRES`)
 * with room to spare, so no gap shows under its outer edge.
 */
export const PAVEMENT_FOOTING_METRES = 0.45;

/** How far apart a pavement's cross-sections are along the road, at most, in metres: **2**. */
export const PAVEMENT_STEP_METRES = 2;

/**
 * How far inside the first and last built plots' boundaries a pavement stops,
 * in metres: **1** — so it never reaches the signposts at a village's ways in,
 * which stand on the verge half a plot beyond its last plot.
 */
export const PAVEMENT_END_INSET_METRES = 1;

/**
 * The most triangles one village's street can be: **1 184**. Each side at its
 * longest — every plot built, {@link VILLAGE_METRES} and a plot, less the two
 * insets — is 98 steps of six triangles (the kerb's face, the top and the
 * back, two each) and its two ends; a section dropped takes twelve and its
 * break adds four, so a broken strip is never heavier. The SAME triangles in
 * both worlds, which is why `realistic-budget.ts` §`REALISTIC_FRAME_TRIANGLES`
 * does not count them, by its own rule for the corridor and the terrain; a
 * frame holds two villages at most (one ending, the next beginning, 700 m
 * apart against a 460 m view), so 2 368.
 *
 * @test-facing held by `streets.test.ts`
 */
export const PAVEMENT_TRIANGLES_PER_VILLAGE =
  2 *
  (6 *
    Math.ceil(
      (VILLAGE_METRES + PLOT_METRES - 2 * PAVEMENT_END_INSET_METRES) / PAVEMENT_STEP_METRES,
    ) +
    4);

/**
 * One village's pavements, as triangles in the corridor's local metres.
 *
 * `uvs` are in METRES of the surface — along the road and across it on the
 * top, along and up on the two faces and across and up on the ends — so a
 * renderer divides by its photograph's own size and a flag is the same size
 * everywhere.
 */
export interface PavementMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint32Array;
}

/** One village's street: which village, where along the road, and its pavements. */
export interface VillageStreet {
  /** The village's site on the route's first lap: one street per place, whichever lap. */
  readonly wrappedSite: number;
  /** Where its pavements start and end, on the odometer of the lap they were found on. */
  readonly from: number;
  readonly to: number;
  readonly pavement: PavementMesh;
}

/** One village's street, or `null` where its site has no village or no pavement. */
type Known = VillageStreet | null;

/** Every street of each route, by site, built on first sight. @see the header */
const built = new WeakMap<RouteProfile, Map<number, Known>>();

/**
 * Every village street whose pavements overlap the odometer span
 * `[fromMetres, toMetres)`, each once however many laps of a loop the span
 * covers. The same objects every call, so a renderer can tell "the same
 * streets" from "different ones" by identity.
 */
export function streetsAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  fromMetres: number,
  toMetres: number,
): readonly VillageStreet[] {
  const { sites, span } = siteSpacing(profile);
  const reach = VILLAGE_METRES / 2 + PLOT_METRES;
  const first = Math.floor((fromMetres - reach) / span);
  // Never more sites than the route has — `settlements.ts` §`settlementsAt`'s bound.
  const last = Math.min(Math.floor((toMetres + reach) / span), first + sites + 1);
  let known = built.get(profile);
  if (known === undefined) {
    known = new Map();
    built.set(profile, known);
  }
  const found: VillageStreet[] = [];
  for (let index = first; index <= last; index += 1) {
    const site = siteAt(profile, seed, index);
    if (site === undefined || site.kind !== 'village') continue;
    let street = known.get(site.wrappedSite);
    if (street === undefined) {
      street = streetOf(profile, origin, seed, site.wrappedSite, index);
      known.set(site.wrappedSite, street);
    }
    if (street === null || found.includes(street)) continue;
    // Where THIS lap's copy of it lies on the odometer.
    const lap = (index - site.wrappedSite) * span;
    if (street.from + lap < toMetres && street.to + lap >= fromMetres) found.push(street);
  }
  return found;
}

/** The street of the village at `site` (unwrapped `index`), or `null` if it has no pavement. */
function streetOf(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  wrappedSite: number,
  index: number,
): Known {
  const site = siteAt(profile, seed, index);
  if (site === undefined) return null;
  const { span } = siteSpacing(profile);
  // Built on the first lap's odometer, whichever lap it was first seen from.
  const lap = (index - wrappedSite) * span;
  const plots = villagePlots(seed, site);
  const mesh = new MeshBuilder();
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  for (const side of [1, -1] as const) {
    const mine = plots.filter((plot) => plot.side === side).map((plot) => plot.along - lap);
    if (mine.length === 0) continue;
    const start = Math.min(...mine) - PLOT_METRES / 2 + PAVEMENT_END_INSET_METRES;
    const end = Math.max(...mine) + PLOT_METRES / 2 - PAVEMENT_END_INSET_METRES;
    if (lay(mesh, profile, origin, seed, side, start, end)) {
      from = Math.min(from, start);
      to = Math.max(to, end);
    }
  }
  if (mesh.triangles === 0) return null;
  return { wrappedSite, from, to, pavement: mesh.done() };
}

/**
 * A pavement on `side` of the road from `start` to `end` (odometer), with
 * every rule a village's obeys, or `undefined` where none of it may stand.
 *
 * @test-facing `streets.test.ts` lays one along a hairpin and across a stream,
 * where the rules have something to refuse; a ride's pavements come from
 * {@link streetsAt}, which lays them by the same function.
 */
export function pavementAlong(
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  side: 1 | -1,
  start: number,
  end: number,
): PavementMesh | undefined {
  const mesh = new MeshBuilder();
  return lay(mesh, profile, origin, seed, side, start, end) ? mesh.done() : undefined;
}

/** One cross-section of a pavement: where its three edges are, and which way is along. */
interface Section {
  readonly along: number;
  readonly innerX: number;
  readonly innerZ: number;
  readonly outerX: number;
  readonly outerZ: number;
  /** The road's height here: the kerb's foot. */
  readonly y: number;
  /** Out from the road, on this side. */
  readonly outX: number;
  readonly outZ: number;
}

/**
 * Lays one side's pavement from `start` to `end` (odometer), as strips broken
 * wherever a section is dropped. Whether any strip was laid.
 */
function lay(
  mesh: MeshBuilder,
  profile: RouteProfile,
  origin: CorridorOrigin,
  seed: number,
  side: 1 | -1,
  start: number,
  end: number,
): boolean {
  const ways = waterways(profile, seed);
  const steps = Math.max(1, Math.ceil((end - start) / PAVEMENT_STEP_METRES));
  const before = mesh.triangles;
  let run: Section[] = [];
  const close = (): void => {
    if (run.length >= 2) mesh.strip(run, side);
    run = [];
  };
  for (let step = 0; step <= steps; step += 1) {
    const along = start + ((end - start) * step) / steps;
    const section = sectionAt(profile, origin, ways, side, along);
    if (section === undefined) close();
    else run.push(section);
  }
  close();
  return mesh.triangles > before;
}

/** The cross-section at `along`, or `undefined` where a pavement may not stand. */
function sectionAt(
  profile: RouteProfile,
  origin: CorridorOrigin,
  ways: ReturnType<typeof waterways>,
  side: 1 | -1,
  along: number,
): Section | undefined {
  const wrapped = distanceOnRoute(profile, along);
  const frame = drawnRoadFrame(profile, origin, wrapped);
  if (frame === undefined) return undefined;
  const middle = KERB_LATERAL_METRES + PAVEMENT_WIDTH_METRES / 2;
  if (inWater(ways, profile, wrapped, middle * side)) return undefined;
  const outX = frame.normalX * side;
  const outZ = frame.normalZ * side;
  const outer = KERB_LATERAL_METRES + PAVEMENT_WIDTH_METRES;
  // Off EVERY stretch of the drawn road, at each of its three edges. @see the header
  for (const lateral of [KERB_LATERAL_METRES, middle, outer]) {
    const x = frame.x + outX * lateral;
    const z = frame.z + outZ * lateral;
    if (distanceToDrawnRoad(profile, origin, x, z, outer + 1) < KERB_LATERAL_METRES - CHORD_SLACK)
      return undefined;
  }
  return {
    along,
    innerX: frame.x + outX * KERB_LATERAL_METRES,
    innerZ: frame.z + outZ * KERB_LATERAL_METRES,
    outerX: frame.x + outX * outer,
    outerZ: frame.z + outZ * outer,
    y: elevationAt(profile, wrapped) - origin.elevation,
    outX,
    outZ,
  };
}

/**
 * How much nearer than the road's half-width the kerb's own foot may read:
 * **2 cm**. `distanceToDrawnRoad` measures to two-metre CHORDS of the drawn
 * road, which lie inside the arc, so a point exactly on the road's edge reads a
 * little nearer than it is on a bend (4 cm at a 10 m radius, its own note).
 * Without this the kerb's foot, which stands on the edge by design, would drop
 * a section on every gentle curve; with it a section whose foot is truly more
 * than 2 cm into the carriageway is still dropped.
 */
const CHORD_SLACK = 0.02;

/** Triangles, growing. */
class MeshBuilder {
  readonly #positions: number[] = [];
  readonly #normals: number[] = [];
  readonly #uvs: number[] = [];
  readonly #indices: number[] = [];

  get triangles(): number {
    return this.#indices.length / 3;
  }

  /** One unbroken run of sections: the kerb face, the top, the back face and both ends. */
  strip(run: readonly Section[], side: 1 | -1): void {
    const top = (section: Section): number => section.y + KERB_HEIGHT_METRES;
    const foot = (section: Section): number => section.y - PAVEMENT_FOOTING_METRES;
    const first = run[0] as Section;
    const last = run[run.length - 1] as Section;
    for (let index = 0; index + 1 < run.length; index += 1) {
      const a = run[index] as Section;
      const b = run[index + 1] as Section;
      // The kerb's face, looking at the road.
      this.#quad(
        [a.innerX, a.y, a.innerZ, a.along, 0],
        [a.innerX, top(a), a.innerZ, a.along, KERB_HEIGHT_METRES],
        [b.innerX, b.y, b.innerZ, b.along, 0],
        [b.innerX, top(b), b.innerZ, b.along, KERB_HEIGHT_METRES],
        [-(a.outX + b.outX) / 2, 0, -(a.outZ + b.outZ) / 2],
      );
      // The pavement, looking up.
      this.#quad(
        [a.innerX, top(a), a.innerZ, a.along, 0],
        [a.outerX, top(a), a.outerZ, a.along, PAVEMENT_WIDTH_METRES],
        [b.innerX, top(b), b.innerZ, b.along, 0],
        [b.outerX, top(b), b.outerZ, b.along, PAVEMENT_WIDTH_METRES],
        [0, 1, 0],
      );
      // The back, looking away from the road.
      this.#quad(
        [a.outerX, foot(a), a.outerZ, a.along, -PAVEMENT_FOOTING_METRES],
        [a.outerX, top(a), a.outerZ, a.along, KERB_HEIGHT_METRES],
        [b.outerX, foot(b), b.outerZ, b.along, -PAVEMENT_FOOTING_METRES],
        [b.outerX, top(b), b.outerZ, b.along, KERB_HEIGHT_METRES],
        [(a.outX + b.outX) / 2, 0, (a.outZ + b.outZ) / 2],
      );
    }
    // The two ends, each looking along the road away from the strip. The
    // road's direction is the normal turned back a quarter: (normalZ, −normalX),
    // and `out` is the normal times the side.
    for (const [end, sign] of [
      [first, -1],
      [last, 1],
    ] as const) {
      const ax = end.outZ * side * sign;
      const az = -end.outX * side * sign;
      this.#quad(
        [end.innerX, end.y, end.innerZ, 0, 0],
        [end.innerX, top(end), end.innerZ, 0, KERB_HEIGHT_METRES],
        [end.outerX, foot(end), end.outerZ, PAVEMENT_WIDTH_METRES, -PAVEMENT_FOOTING_METRES],
        [end.outerX, top(end), end.outerZ, PAVEMENT_WIDTH_METRES, KERB_HEIGHT_METRES],
        [ax, 0, az],
      );
    }
  }

  /**
   * Two triangles over `a0 a1 b1 b0`, each corner `[x, y, z, u, v]`, wound so
   * the face is seen from the side `facing` points to.
   */
  #quad(
    a0: readonly [number, number, number, number, number],
    a1: readonly [number, number, number, number, number],
    b0: readonly [number, number, number, number, number],
    b1: readonly [number, number, number, number, number],
    facing: readonly [number, number, number],
  ): void {
    const base = this.#positions.length / 3;
    const length = Math.hypot(facing[0], facing[1], facing[2]) || 1;
    for (const corner of [a0, a1, b0, b1]) {
      this.#positions.push(corner[0], corner[1], corner[2]);
      this.#normals.push(facing[0] / length, facing[1] / length, facing[2] / length);
      this.#uvs.push(corner[3], corner[4]);
    }
    // The geometric normal of (a0, b0, a1) against the one wanted.
    const ex = b0[0] - a0[0];
    const ey = b0[1] - a0[1];
    const ez = b0[2] - a0[2];
    const fx = a1[0] - a0[0];
    const fy = a1[1] - a0[1];
    const fz = a1[2] - a0[2];
    const nx = ey * fz - ez * fy;
    const ny = ez * fx - ex * fz;
    const nz = ex * fy - ey * fx;
    const agrees = nx * facing[0] + ny * facing[1] + nz * facing[2] >= 0;
    const [p, q, r, s] = [base, base + 1, base + 2, base + 3];
    if (agrees) this.#indices.push(p, r, q, q, r, s);
    else this.#indices.push(p, q, r, q, s, r);
  }

  done(): PavementMesh {
    return {
      positions: new Float32Array(this.#positions),
      normals: new Float32Array(this.#normals),
      uvs: new Float32Array(this.#uvs),
      indices: new Uint32Array(this.#indices),
    };
  }
}
