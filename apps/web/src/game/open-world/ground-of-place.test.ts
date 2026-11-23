// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * An open-world view's ground is the place's, whichever street the view runs
 * along — #3094.
 *
 * A route's ground is a function of "this far along the road, this far to its
 * side" (`landform.ts` §`terrainHeightAt`). An open-world view's road is the
 * street the route takes, so a junction choice made another street the road
 * past the junction, and the hills along every way out were redrawn on the
 * frame of the press. Here two views of one ride on a level street grid, one
 * straight on through a junction and one turning there, are asked for the
 * ground at the same places past the junction: each place is at a column of
 * both views' ground, so each answer is a vertex the renderer draws, and the
 * two must be the same.
 *
 * The real game screen through three presses is `junction-corner.test.tsx`'s.
 */

import { describe, expect, it } from 'vitest';

import { RollingRoute, type RollingEdge, type RouteProfile } from '@onyourleft/domain';
import { gridGraph, placeAt, type SyntheticGround } from '@onyourleft/domain/rolling-testing';

import { NO_LAND_CLASS } from '../land-class';
import { RELIEF_CLEAR_METRES, terrainHeightAt } from '../landform';
import { anchorScenery } from '../scenery-anchor';
import { StreetLevels } from '../street-levels';
import {
  corridorOrigin,
  drawProfileIn,
  drawnRoadFrame,
  localGroundPosition,
  type CorridorOrigin,
} from '../terrain';

const COLUMNS = [0, 180, 410, 600, 870, 1_050];
const ROWS = [0, 230, 400, 650, 820, 1_090];

/** The junction turned at: column 1 of row 3, the major road ridden east. */
const JUNCTION_EAST = COLUMNS[1] as number;
const JUNCTION_NORTH = ROWS[3] as number;

/** Level streets: the open world's, until #2899 reads real heights. */
const LEVEL: SyntheticGround = () => 120;

/** The ride's seed: any. */
const SEED = 0x5eed;

/**
 * How far east (or west) and north of the junction each place is, metres:
 * columns of the ground (`TERRAIN_COLUMN_OFFSETS`) clear of the corner the
 * drawn road rounds, and never the same both ways, so a place's distance from
 * the one road is never its distance from the other.
 */
const OFFSETS = [60, 90, 135, 200];

/** West of the junction, the approach reaches back this far from it. */
const WEST = [-60, -90, -135];

interface View {
  readonly profile: RouteProfile;
  readonly origin: CorridorOrigin;
  /** The junction's distance on the profile. */
  readonly junction: number;
}

/** The ride's two views: straight on through the junction, and turning north there. */
function views(levels: StreetLevels | undefined): {
  readonly straight: View;
  readonly turned: View;
} {
  const { graph, edges } = gridGraph(COLUMNS, ROWS, LEVEL, 3);
  const route = new RollingRoute(graph, edges.find((edge) => edge.id === 'h0,3') as RollingEdge);
  const frame = corridorOrigin(route.view());
  const junction = route.nextJunctionAfter(0);
  if (junction === undefined) throw new Error('no junction');
  const taking = route.taking(junction.distance, `v1,3`);
  if (taking === undefined) throw new Error('no way north');
  const view = (each: RollingRoute): View => {
    const profile = each.view();
    drawProfileIn(profile, frame);
    anchorScenery(profile, { seed: SEED, origin: each.origin, levels });
    return { profile, origin: frame, junction: junction.distance - each.origin };
  };
  return { straight: view(route), turned: view(taking) };
}

/** Every street of the grid, in the ride's frame, as the session hands the streets held. */
function heldStreets(frame: CorridorOrigin): { readonly line: Float32Array }[] {
  const { edges } = gridGraph(COLUMNS, ROWS, LEVEL, 3);
  return edges.map((edge) => ({
    line: Float32Array.from(
      edge.points.flatMap((point) => {
        const { x, z } = localGroundPosition(frame, point.position);
        return [x, z];
      }),
    ),
  }));
}

/** The ground `view` draws at `place`, `along` its road from the junction. */
function groundAt(view: View, along: number, place: { x: number; z: number }): number {
  const distance = view.junction + along;
  const frame = drawnRoadFrame(view.profile, view.origin, distance);
  if (frame === undefined) throw new Error('off the view');
  const lateral = (place.x - frame.x) * frame.normalX + (place.z - frame.z) * frame.normalZ;
  // On the road's square through the place: nothing of it along the road.
  expect(
    Math.abs((place.x - frame.x) * frame.normalZ - (place.z - frame.z) * frame.normalX),
  ).toBeLessThan(0.05);
  return terrainHeightAt(view.profile, view.origin, SEED, distance, lateral, NO_LAND_CLASS);
}

/** Each place, east (negative: west) and north of the junction, and its ground on each view. */
function compared(
  levelled: boolean,
): { readonly place: string; readonly straight: number; readonly turned: number }[] {
  const frame = corridorOrigin(views(undefined).straight.profile);
  const streets = heldStreets(frame);
  const { straight, turned } = views(levelled ? new StreetLevels(() => streets) : undefined);
  const out: { place: string; straight: number; turned: number }[] = [];
  for (const east of [...OFFSETS, ...WEST]) {
    for (const north of OFFSETS) {
      if (Math.abs(east) === north) continue;
      const place = localGroundPosition(
        frame,
        placeAt(JUNCTION_EAST + east, JUNCTION_NORTH + north),
      );
      out.push({
        place: `${String(east)} east, ${String(north)} north`,
        straight: groundAt(straight, east, place),
        turned: groundAt(turned, north, place),
      });
    }
  }
  return out;
}

describe('an open-world view’s ground is the place’s, whichever street it runs along — #3094', () => {
  it('draws the same ground at every place past the junction on the view straight on and on the view turning there', () => {
    const places = compared(true);
    expect(places).toHaveLength(21);
    for (const { place, straight, turned } of places) {
      // Within 5 cm: a place is found on each view by projecting it, and the
      // synthetic grid's metres are not quite the frame's, so it falls a few
      // centimetres off a column, where the ground is read between two.
      expect(turned, place).toBeCloseTo(straight, 1);
    }
    // And it is ground with hills on it, not a plain every view agrees on.
    const heights = places.map(({ straight }) => straight);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(5);
  });

  it('levels it beside every street held: without them each view levels beside its own road alone, and they disagree', () => {
    // The control: the same places, each view levelling beside only the road
    // it runs along, so each is a different distance from "the road".
    const apart = compared(false).map(({ straight, turned }) => Math.abs(straight - turned));
    expect(Math.max(...apart)).toBeGreaterThan(1);
  });

  it('keeps the road clear: no relief within the clear band of the view’s road', () => {
    const frame = corridorOrigin(views(undefined).straight.profile);
    const streets = heldStreets(frame);
    const { straight } = views(new StreetLevels(() => streets));
    for (const along of [60, 120, 240]) {
      for (const lateral of [-RELIEF_CLEAR_METRES, -5, 5, RELIEF_CLEAR_METRES]) {
        const height = terrainHeightAt(
          straight.profile,
          straight.origin,
          SEED,
          straight.junction + along,
          lateral,
          NO_LAND_CLASS,
        );
        // Level streets at 120 m, drawn in a frame at the first point's height.
        expect(height).toBeLessThanOrEqual(1e-9);
        expect(height).toBeGreaterThanOrEqual(-0.25 - 1e-9);
      }
    }
  });
});
