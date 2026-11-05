// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where a village's litter lies — #1274, the owner's ruling of 2026-11-05:
 * sparse, in villages only, beside the street furniture it is drawn with.
 */

import { describe, expect, it } from 'vitest';

import {
  LITTER_BAG_BESIDE_METRES,
  LITTER_CAPACITY,
  LITTER_DOOR_CLEARANCE_METRES,
  LITTER_TYRE_BESIDE_METRES,
  litterOf,
} from './litter';
import { northRoute } from './route-fixtures-testing';
import { scatterSeed } from './scatter';
import {
  KERB_LATERAL_METRES,
  PAVEMENT_WIDTH_METRES,
  streetsAt,
  WALK_FROM_KERB_METRES,
  type VillageStreet,
} from './streets';
import { distanceToDrawnRoad } from './road-grid';
import { corridorOrigin } from './terrain';

const route = northRoute(30_000, () => 40);
const origin = corridorOrigin(route);
const streets = streetsAt(route, origin, scatterSeed(route), 0, route.totalDistance);
const villages = streets.filter((street) => street.wrappedSite >= 0);

describe('a village’s litter — #1274', () => {
  it('lies in some villages and not all, a few pieces each: sparse', () => {
    // Non-vacuity: a long road with villages on it.
    expect(villages.length).toBeGreaterThanOrEqual(6);
    const counts = villages.map((street) => litterOf(street).length);
    expect(counts.some((count) => count > 0)).toBe(true);
    for (const street of villages) {
      const pieces = litterOf(street);
      const bins = street.furniture.filter((item) => item.kind === 'bin').length;
      expect(pieces.filter((piece) => piece.kind === 'bag').length).toBeLessThanOrEqual(bins);
      expect(pieces.filter((piece) => piece.kind === 'tyre').length).toBeLessThanOrEqual(1);
    }
    // Sparse: at most half the bins have a bag.
    const bins = villages.reduce(
      (sum, street) => sum + street.furniture.filter((item) => item.kind === 'bin').length,
      0,
    );
    const bags = villages.reduce(
      (sum, street) => sum + litterOf(street).filter((piece) => piece.kind === 'bag').length,
      0,
    );
    expect(bags).toBeLessThanOrEqual(bins / 2);
    // Two villages in a frame at most are inside the belt's capacity.
    expect(2 * Math.max(...counts)).toBeLessThanOrEqual(LITTER_CAPACITY);
    // Both kinds lie somewhere.
    const kinds = new Set(
      villages.flatMap((street) => litterOf(street).map((piece) => piece.kind)),
    );
    expect([...kinds].sort()).toEqual(['bag', 'tyre']);
  });

  it('lays a bag beside its bin, on the side away from the bench', () => {
    let bags = 0;
    for (const street of villages) {
      for (const piece of litterOf(street)) {
        if (piece.kind !== 'bag') continue;
        bags += 1;
        expect(piece.anchor.kind).toBe('bin');
        expect(street.furniture).toContain(piece.anchor);
        expect(Math.hypot(piece.x - piece.anchor.x, piece.z - piece.anchor.z)).toBeCloseTo(
          LITTER_BAG_BESIDE_METRES,
          6,
        );
        expect(piece.y).toBe(piece.anchor.y);
        const bench = street.furniture
          .filter((item) => item.kind === 'bench')
          .reduce((best, item) =>
            Math.hypot(item.x - piece.anchor.x, item.z - piece.anchor.z) <
            Math.hypot(best.x - piece.anchor.x, best.z - piece.anchor.z)
              ? item
              : best,
          );
        // Further from the bench than the bin is.
        expect(Math.hypot(piece.x - bench.x, piece.z - bench.z)).toBeGreaterThan(
          Math.hypot(piece.anchor.x - bench.x, piece.anchor.z - bench.z),
        );
      }
    }
    expect(bags).toBeGreaterThan(0);
  });

  it('lays a tyre along the pavement from a lamp post, clear of every front path', () => {
    let tyres = 0;
    for (const street of villages) {
      for (const piece of litterOf(street)) {
        if (piece.kind !== 'tyre') continue;
        tyres += 1;
        expect(piece.anchor.kind).toBe('lamp-post');
        expect(Math.hypot(piece.x - piece.anchor.x, piece.z - piece.anchor.z)).toBeCloseTo(
          LITTER_TYRE_BESIDE_METRES,
          6,
        );
        for (const path of street.doorPaths) {
          for (let at = 0; at + 2 < path.walk.length; at += 3) {
            expect(
              Math.hypot(
                (path.walk[at] as number) - piece.x,
                (path.walk[at + 2] as number) - piece.z,
              ),
            ).toBeGreaterThanOrEqual(LITTER_DOOR_CLEARANCE_METRES);
          }
        }
      }
    }
    expect(tyres).toBeGreaterThan(0);
  });

  it('moves a tyre off a front path that would meet it, to another lamp post', () => {
    const street = villages.find((each) =>
      litterOf(each).some((piece) => piece.kind === 'tyre'),
    ) as VillageStreet;
    const tyre = litterOf(street).find((piece) => piece.kind === 'tyre');
    if (tyre === undefined) throw new Error('no tyre on the road');
    // The same street with a front path laid where its tyre lay.
    const path = { ...(street.doorPaths[0] as VillageStreet['doorPaths'][number]) };
    const crossed: VillageStreet = {
      ...street,
      doorPaths: [
        ...street.doorPaths,
        { ...path, walk: Float32Array.from([tyre.x, tyre.y, tyre.z]) },
      ],
    };
    const moved = litterOf(crossed).find((piece) => piece.kind === 'tyre');
    expect(moved).toBeDefined();
    expect(moved?.anchor).not.toBe(tyre.anchor);
    expect(
      Math.hypot((moved?.x ?? tyre.x) - tyre.x, (moved?.z ?? tyre.z) - tyre.z),
    ).toBeGreaterThanOrEqual(LITTER_DOOR_CLEARANCE_METRES);
  });

  it('lies on the pavement, behind the line people walk', () => {
    for (const street of villages) {
      for (const piece of litterOf(street)) {
        const fromCentre = distanceToDrawnRoad(route, origin, piece.x, piece.z, 20);
        // At its anchor's setback: by the back edge, never at the kerb.
        expect(fromCentre).toBeGreaterThan(KERB_LATERAL_METRES + WALK_FROM_KERB_METRES + 0.5);
        expect(fromCentre).toBeLessThan(KERB_LATERAL_METRES + PAVEMENT_WIDTH_METRES);
      }
    }
  });

  it('is the same litter every time its street is asked, and the same street every lap', () => {
    const street = villages.find((each) => litterOf(each).length > 0) as VillageStreet;
    expect(litterOf(street)).toBe(litterOf(street));
    // A street built again from the same route lies the same.
    const again = streetsAt(route, origin, scatterSeed(route), 0, route.totalDistance).find(
      (each) => each.wrappedSite === street.wrappedSite,
    ) as VillageStreet;
    expect(litterOf({ ...again }).map(({ kind, x, z }) => [kind, x, z])).toEqual(
      litterOf(street).map(({ kind, x, z }) => [kind, x, z]),
    );
  });

  it('lies on no city centre’s street: villages only', () => {
    const village = villages.find((each) => litterOf(each).length > 0) as VillageStreet;
    // The same street, as a city centre's piece is numbered (`streets.ts`).
    expect(litterOf({ ...village, wrappedSite: -1 - village.wrappedSite })).toEqual([]);
  });
});
