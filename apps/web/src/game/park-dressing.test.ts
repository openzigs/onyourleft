// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2685, round two: what a golf course and a cemetery are drawn with, so each
 * reads from the bike — the owner held PR #2689 on 2026-11-16 because in the
 * screenshots the cemetery was barely visible and the golf course showed no
 * difference. Read through `parkDressingInView` and `sceneFrame`, the path the
 * renderer is handed; every rule has its control (the same ground as a plain
 * `park`, or the rule's other side). **No OpenStreetMap data and no real
 * place**: rectangles from arithmetic.
 */

import { describe, expect, it } from 'vitest';

import { metres } from '@onyourleft/domain';
import type { Box, LandUseFeature } from '@onyourleft/map-features';

import { parksFixture } from './footprint-fixtures-testing';
import { landClassMask, type LandClassMask } from './land-class';
import { standingOnGround } from './landform';
import {
  CEMETERY_WALL_PIECE_METRES,
  CEMETERY_WALL_ROAD_CLEARANCE_METRES,
  GOLF_GREEN_ROAD_CLEARANCE_METRES,
  HEADSTONE_INSET_METRES,
  HEADSTONE_PITCH_METRES,
  HEADSTONE_ROAD_CLEARANCE_METRES,
  HEADSTONE_ROW_METRES,
  isCrossPathSlot,
  isPathRow,
  NO_PARK_DRESSING,
  PARK_DRESSING_CAPACITY,
  PARK_DRESSING_REACH_METRES,
  PARK_LOOK_CELLS,
  parkDressingInView,
  SAND_POLYGONS_MAX,
  type GolfGreen,
  type ParkDressingInView,
  type ParkGround,
  type ParkPiece,
} from './park-dressing';
import { distanceToDrawnRoad } from './road-grid';
import { bentValleyRoute, northRoute } from './route-fixtures-testing';
import { sceneFrame } from './scene';
import { GOLF_STAND_METRES, golfStandAt, scatterAt, scatterSeed } from './scatter';
import { atStartLine } from './simulation';
import { corridorOrigin } from './terrain';
import type { WorldCorridor } from './world-data/corridor';

/** A level 6 km road due north: local `z` is distance along, `x` is across, the road on `x = 0`. */
const ROUTE = northRoute(6_000, () => 10);
const ORIGIN = corridorOrigin(ROUTE);
const SEED = scatterSeed(ROUTE);
const MIDDLE: Box = { minX: -1_000, maxX: 1_000, minZ: 2_000, maxZ: 4_000 };

function rectangle(kind: string, box: Box): LandUseFeature {
  return {
    layer: 'landuse',
    kind,
    rings: [
      Float32Array.of(
        box.minX,
        box.minZ,
        box.maxX,
        box.minZ,
        box.maxX,
        box.maxZ,
        box.minX,
        box.maxZ,
      ),
    ],
  };
}

/** A corridor of `landUse` and its mask — a fresh corridor each, so no dressing is shared. */
function place(...landUse: LandUseFeature[]): {
  readonly corridor: WorldCorridor;
  readonly land: LandClassMask;
} {
  const corridor: WorldCorridor = {
    routeId: 'park-dressing-fixture',
    origin: ORIGIN,
    covered: (x, z) => x >= MIDDLE.minX && x < MIDDLE.maxX && z >= MIDDLE.minZ && z < MIDDLE.maxZ,
    coveredBoxes: [MIDDLE],
    landUse,
    buildings: [],
    paths: [],
    streets: [],
  };
  return { corridor, land: landClassMask(corridor) };
}

function view(
  at: { readonly corridor: WorldCorridor; readonly land: LandClassMask },
  x: number,
  z: number,
): ParkDressingInView {
  return parkDressingInView(at.corridor, ROUTE, ORIGIN, SEED, at.land, x, z);
}

const ofKind = (pieces: readonly ParkPiece[], kind: ParkPiece['kind']): readonly ParkPiece[] =>
  pieces.filter((piece) => piece.kind === kind);

/** The texel of a window holding `(x, z)`, as RGBA. */
function texel(ground: ParkGround, x: number, z: number): readonly number[] {
  const column = Math.floor((x - ground.originX) / ground.cellMetres);
  const row = Math.floor((z - ground.originZ) / ground.cellMetres);
  expect(column >= 0 && column < ground.cells && row >= 0 && row < ground.cells).toBe(true);
  const at = (row * ground.cells + column) * 4;
  return [...ground.looks.slice(at, at + 4)];
}

const CEMETERY: Box = { minX: 20, maxX: 140, minZ: 2_550, maxZ: 2_650 };

describe('#2685 a cemetery: rows of headstones, paths and a wall', () => {
  const cemetery = place(rectangle('cemetery', CEMETERY));
  const dressed = view(cemetery, 80, 2_600);
  const stones = ofKind(dressed.pieces, 'headstone');

  it('stands rows of headstones inside it, set in from its edge, and none on a path', () => {
    expect(stones.length).toBeGreaterThan(400);
    const rows = new Set<number>();
    for (const stone of stones) {
      // Inside the cemetery and in from its edge by the inset, every way.
      expect(stone.x).toBeGreaterThanOrEqual(CEMETERY.minX + HEADSTONE_INSET_METRES - 1);
      expect(stone.x).toBeLessThanOrEqual(CEMETERY.maxX - HEADSTONE_INSET_METRES + 1);
      expect(stone.z).toBeGreaterThanOrEqual(CEMETERY.minZ + HEADSTONE_INSET_METRES - 1);
      expect(stone.z).toBeLessThanOrEqual(CEMETERY.maxZ - HEADSTONE_INSET_METRES + 1);
      const row = Math.floor(stone.x / HEADSTONE_ROW_METRES);
      const slot = Math.floor(stone.z / HEADSTONE_PITCH_METRES);
      // Its grave's place, and the cemetery the inset away from it every way.
      const x = (row + 0.5) * HEADSTONE_ROW_METRES;
      const z = (slot + 0.5) * HEADSTONE_PITCH_METRES;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        expect(
          cemetery.land.parkLookAt(
            x + dx * HEADSTONE_INSET_METRES,
            z + dz * HEADSTONE_INSET_METRES,
          ),
        ).toBe('cemetery');
      }
      expect(isPathRow(row), `row ${String(row)}`).toBe(false);
      expect(isCrossPathSlot(slot), `slot ${String(slot)}`).toBe(false);
      rows.add(row);
      expect(stone.height).toBeGreaterThan(0.3);
    }
    // Non-vacuity: the paths cross it, so some rows and slots inside it ARE paths.
    const inside = (from: number, to: number, step: number): number[] => {
      const all: number[] = [];
      for (let at = Math.ceil(from / step); at < Math.floor(to / step); at += 1) all.push(at);
      return all;
    };
    expect(inside(CEMETERY.minX, CEMETERY.maxX, HEADSTONE_ROW_METRES).some(isPathRow)).toBe(true);
    expect(inside(CEMETERY.minZ, CEMETERY.maxZ, HEADSTONE_PITCH_METRES).some(isCrossPathSlot)).toBe(
      true,
    );
    // And the stones stand in many rows, not one: the nearest 512 or so, round the camera.
    expect(rows.size).toBeGreaterThan(12);
  });

  it('sets every stone of a small cemetery in from its edge, the edge rows included', () => {
    // Small enough that every stone is drawn, so the rows by its edge are read too.
    const small: Box = { minX: 40, maxX: 75, minZ: 2_600, maxZ: 2_640 };
    const yard = place(rectangle('cemetery', small));
    const kept = ofKind(view(yard, 57, 2_620).pieces, 'headstone');
    expect(kept.length).toBeGreaterThan(50);
    expect(kept.length).toBeLessThan(PARK_DRESSING_CAPACITY / 2);
    for (const stone of kept) {
      const x = (Math.floor(stone.x / HEADSTONE_ROW_METRES) + 0.5) * HEADSTONE_ROW_METRES;
      const z = (Math.floor(stone.z / HEADSTONE_PITCH_METRES) + 0.5) * HEADSTONE_PITCH_METRES;
      expect(x - HEADSTONE_INSET_METRES).toBeGreaterThanOrEqual(small.minX);
      expect(x + HEADSTONE_INSET_METRES).toBeLessThanOrEqual(small.maxX);
      expect(z - HEADSTONE_INSET_METRES).toBeGreaterThanOrEqual(small.minZ);
      expect(z + HEADSTONE_INSET_METRES).toBeLessThanOrEqual(small.maxZ);
    }
  });

  it('walls it along its outline, the road’s gate left open', () => {
    const walls = ofKind(dressed.pieces, 'wall');
    // Its four sides, in pieces of at most 4 m, every one in reach.
    const perimeter = 2 * (CEMETERY.maxX - CEMETERY.minX) + 2 * (CEMETERY.maxZ - CEMETERY.minZ);
    expect(walls.length).toBe(perimeter / CEMETERY_WALL_PIECE_METRES);
    for (const wall of walls) {
      const off = Math.min(
        Math.abs(wall.x - CEMETERY.minX),
        Math.abs(wall.x - CEMETERY.maxX),
        Math.abs(wall.z - CEMETERY.minZ),
        Math.abs(wall.z - CEMETERY.maxZ),
      );
      expect(off).toBeLessThan(1e-3);
    }
    // Mapped across the road: no piece on it, and the far sides still walled.
    const across = place(rectangle('cemetery', { ...CEMETERY, minX: -30 }));
    const crossing = ofKind(view(across, 60, 2_600).pieces, 'wall');
    expect(crossing.length).toBeGreaterThan(0);
    for (const wall of crossing) {
      expect(Math.abs(wall.x)).toBeGreaterThanOrEqual(CEMETERY_WALL_ROAD_CLEARANCE_METRES);
    }
    // Control: the side at x = −30 is far enough off the road to keep its pieces.
    expect(crossing.some((wall) => Math.abs(wall.x + 30) < 1e-3)).toBe(true);
  });

  it('keeps every stone off the road, where the cemetery is mapped up to it', () => {
    const near = place(rectangle('cemetery', { ...CEMETERY, minX: -40 }));
    const kept = ofKind(view(near, 0, 2_600).pieces, 'headstone');
    expect(kept.length).toBeGreaterThan(100);
    for (const stone of kept) {
      expect(Math.abs(stone.x)).toBeGreaterThanOrEqual(HEADSTONE_ROAD_CLEARANCE_METRES - 0.7);
    }
    // Control: the cemetery reaches the road's own side too, so the rule is what kept it clear.
    expect(kept.some((stone) => stone.x < 0)).toBe(true);
  });

  it('paints its ground in the window: green channel on the cemetery, nothing off it', () => {
    const ground = dressed.ground as ParkGround;
    expect(ground).toBeDefined();
    expect(texel(ground, 80, 2_600)).toEqual([0, 255, 0, 0]);
    expect(texel(ground, -80, 2_600)).toEqual([0, 0, 0, 0]);
    expect(ground.cells).toBe(PARK_LOOK_CELLS);
    expect(ground.greens).toEqual([]);
  });

  it('dresses nothing for the same ground as a plain park, or out of reach', () => {
    expect(view(place(rectangle('park', CEMETERY)), 80, 2_600)).toBe(NO_PARK_DRESSING);
    // Far along the road from it: no window holds it, and no piece is in reach.
    expect(view(cemetery, 0, 3_800)).toBe(NO_PARK_DRESSING);
  });

  it('hands back the same object while the camera stays in its square', () => {
    const again = place(rectangle('cemetery', CEMETERY));
    const first = view(again, 80, 2_600);
    expect(view(again, 81, 2_601)).toBe(first);
    expect(view(again, 80, 2_640)).not.toBe(first);
  });
});

describe('#2685 a golf course: stripes, greens, flags and bunkers', () => {
  const COURSE: Box = { minX: 10, maxX: 900, minZ: 2_000, maxZ: 3_400 };
  const SAND_IN: Box = { minX: 401, maxX: 421, minZ: 2_701, maxZ: 2_721 };
  const SAND_OUT: Box = { minX: -91, maxX: -71, minZ: 2_701, maxZ: 2_721 };
  const golf = place(
    rectangle('golf_course', COURSE),
    rectangle('sand', SAND_IN),
    rectangle('farmland', { minX: -900, maxX: -10, minZ: 2_000, maxZ: 3_400 }),
    rectangle('sand', SAND_OUT),
  );
  const dressed = view(golf, 300, 2_700);
  const ground = dressed.ground as ParkGround;

  it('puts greens where the course is all round them, away from the road and its trees', () => {
    expect(ground.greens.length).toBeGreaterThan(2);
    for (const green of ground.greens) {
      for (let index = 0; index < 8; index += 1) {
        const angle = (index * Math.PI) / 4;
        const reach = green.radius + 6;
        expect(
          golf.land.parkLookAt(
            green.x + Math.cos(angle) * reach,
            green.z + Math.sin(angle) * reach,
          ),
        ).toBe('golf');
      }
      expect(green.x - green.radius).toBeGreaterThanOrEqual(GOLF_GREEN_ROAD_CLEARANCE_METRES);
      // No stand of trees reaches it.
      const reach = green.radius + 2;
      for (let x = green.x - reach; x <= green.x + reach; x += GOLF_STAND_METRES / 4) {
        for (let z = green.z - reach; z <= green.z + reach; z += GOLF_STAND_METRES / 4) {
          expect(golfStandAt(SEED, x, z)).toBe(false);
        }
      }
      expect(Math.hypot(green.pinX - green.x, green.pinZ - green.z)).toBeLessThan(green.radius);
      for (const bunker of green.bunkers) {
        expect(golf.land.parkLookAt(bunker.x, bunker.z)).toBe('golf');
        expect(Math.hypot(bunker.x - green.x, bunker.z - green.z)).toBeGreaterThan(green.radius);
      }
    }
    // The course is stood in by stands, so the rule is a real one: some are near the greens.
    expect(ground.greens.some((green) => green.bunkers.length > 0)).toBe(true);
  });

  it('keeps every green off the road where the course is mapped across it', () => {
    const across = place(rectangle('golf_course', { ...COURSE, minX: -900 }));
    const greens = (view(across, 0, 2_700).ground as ParkGround).greens;
    expect(greens.length).toBeGreaterThan(2);
    for (const green of greens) {
      expect(Math.abs(green.x) - green.radius).toBeGreaterThanOrEqual(
        GOLF_GREEN_ROAD_CLEARANCE_METRES,
      );
    }
    // Control: both sides of the road hold greens, so the course really is across it.
    expect(greens.some((green) => green.x < 0) && greens.some((green) => green.x > 0)).toBe(true);
  });

  it('keeps every green clear of a road that crosses the course on a diagonal', () => {
    // The 45° leg runs from (0, 1 000) north-east — toward −x in local
    // metres — across the greens' squares rather than along their edges.
    const bent = bentValleyRoute(45);
    const box: Box = { minX: -1_600, maxX: 200, minZ: 800, maxZ: 2_600 };
    const corridor: WorldCorridor = {
      routeId: 'park-dressing-bent',
      origin: corridorOrigin(bent),
      covered: (x, z) => x >= box.minX && x < box.maxX && z >= box.minZ && z < box.maxZ,
      coveredBoxes: [box],
      landUse: [rectangle('golf_course', box)],
      buildings: [],
      paths: [],
      streets: [],
    };
    const land = landClassMask(corridor);
    const greens: GolfGreen[] = [];
    for (const [x, z] of [
      [-300, 1_300],
      [-700, 1_700],
      [-1_100, 2_100],
    ] as const) {
      const at = parkDressingInView(
        corridor,
        bent,
        corridorOrigin(bent),
        scatterSeed(bent),
        land,
        x,
        z,
      );
      greens.push(...(at.ground as ParkGround).greens);
    }
    expect(greens.length).toBeGreaterThan(5);
    for (const green of greens) {
      const clearance = green.radius + GOLF_GREEN_ROAD_CLEARANCE_METRES;
      expect(
        distanceToDrawnRoad(bent, corridorOrigin(bent), green.x, green.z, clearance),
      ).toBeGreaterThanOrEqual(clearance);
    }
  });

  it('puts no green on a strip of course too narrow to hold one with its surround', () => {
    // 30 m across: a green of 11 m and its 6 m of course all round needs 34.
    const strip = place(rectangle('golf_course', { minX: 30, maxX: 60, minZ: 2_000, maxZ: 3_400 }));
    expect((view(strip, 45, 2_700).ground as ParkGround).greens).toEqual([]);
  });

  it('plants no tree on a green, where the course has trees', () => {
    const trees = scatterAt(
      ROUTE,
      ORIGIN,
      SEED,
      2_000,
      3_400,
      { maxItems: 100_000, riderMetres: 0 },
      golf.land,
    ).filter((item) => item.kind === 'tree-broadleaf' || item.kind === 'tree-conifer');
    expect(trees.filter((tree) => tree.x > COURSE.minX).length).toBeGreaterThan(20);
    for (const green of ground.greens) {
      for (const tree of trees) {
        expect(Math.hypot(tree.x - green.x, tree.z - green.z)).toBeGreaterThan(green.radius);
      }
    }
  });

  it('stands a flag on its pole at each green in reach', () => {
    const poles = ofKind(dressed.pieces, 'flag-pole');
    const flags = ofKind(dressed.pieces, 'flag');
    const inReach = ground.greens.filter(
      (green) => Math.hypot(green.pinX - 300, green.pinZ - 2_700) <= PARK_DRESSING_REACH_METRES - 1,
    );
    expect(inReach.length).toBeGreaterThan(0);
    expect(poles.length).toBeGreaterThanOrEqual(inReach.length);
    for (const green of inReach) {
      expect(poles.some((pole) => pole.x === green.pinX && pole.z === green.pinZ)).toBe(true);
    }
    for (const flag of flags) {
      // At the top of a pole.
      const pole = poles.find((each) => Math.abs(each.z - flag.z) < 1e-9);
      expect(pole).toBeDefined();
      expect(flag.lift + flag.height).toBeCloseTo((pole as ParkPiece).height, 6);
    }
    expect(ofKind(dressed.pieces, 'headstone')).toEqual([]);
  });

  it('paints the course red in the window, and mapped sand blue only inside it', () => {
    expect(texel(ground, 300, 2_700)[0]).toBe(255);
    expect(texel(ground, SAND_IN.minX + 10, SAND_IN.minZ + 10)).toEqual([255, 0, 255, 0]);
    // Control: the same sand on farmland is not a bunker.
    expect(texel(ground, SAND_OUT.minX + 10, SAND_OUT.minZ + 10)).toEqual([0, 0, 0, 0]);
    expect(texel(ground, -60, 2_700)).toEqual([0, 0, 0, 0]);
  });

  it('rasterises at most SAND_POLYGONS_MAX mapped bunkers a window', () => {
    // 300 squares of sand, 20 m apart, each over exactly four 5 m cells' centres.
    const sands: LandUseFeature[] = [];
    for (let index = 0; index < 300; index += 1) {
      const x = 100 + (index % 20) * 20 + 1;
      const z = 2_500 + Math.floor(index / 20) * 20 + 1;
      sands.push(rectangle('sand', { minX: x, maxX: x + 10, minZ: z, maxZ: z + 10 }));
    }
    const many = view(place(rectangle('golf_course', COURSE), ...sands), 300, 2_700);
    const window = many.ground as ParkGround;
    let blue = 0;
    for (let at = 2; at < window.looks.length; at += 4)
      if ((window.looks[at] as number) > 0) blue += 1;
    expect(blue).toBe(SAND_POLYGONS_MAX * 4);
  });
});

describe('#2685 within the belt’s capacity', () => {
  it('draws the nearest stones and the walls first, never more than the capacity', () => {
    const big = place(rectangle('cemetery', { minX: 12, maxX: 400, minZ: 2_300, maxZ: 2_900 }));
    const { pieces } = view(big, 150, 2_600);
    expect(pieces.length).toBe(PARK_DRESSING_CAPACITY);
    const walls = ofKind(pieces, 'wall');
    expect(walls.length).toBeGreaterThan(0);
    // The walls come first, and every wall in reach is kept.
    expect(pieces.slice(0, walls.length).every((piece) => piece.kind === 'wall')).toBe(true);
    const stones = pieces.slice(walls.length);
    const away = (piece: ParkPiece): number => Math.hypot(piece.x - 150, piece.z - 2_600);
    for (let index = 1; index < stones.length; index += 1) {
      expect(away(stones[index] as ParkPiece)).toBeGreaterThanOrEqual(
        away(stones[index - 1] as ParkPiece),
      );
    }
    // Nearest first: the kept stones are the near ones, well inside the reach.
    expect(away(stones[stones.length - 1] as ParkPiece)).toBeLessThan(
      PARK_DRESSING_REACH_METRES / 2,
    );
  });
});

describe('#2685 through sceneFrame', () => {
  const town = parksFixture();
  const land = landClassMask(town.corridor);
  const start = atStartLine(town.profile);
  const frameAt = (distance: number, extra: Record<string, unknown> = {}) =>
    sceneFrame({
      profile: town.profile,
      origin: town.origin,
      state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
      worldCorridor: town.corridor,
      landClass: land,
      ...extra,
    });

  it('carries the stones, the wall and the flags on the frame, stood on its ground', () => {
    const frame = frameAt(1_150);
    const dressing = frame.parkDressing as ParkDressingInView;
    expect(dressing).toBeDefined();
    expect(ofKind(dressing.pieces, 'headstone').length).toBeGreaterThan(100);
    expect(ofKind(dressing.pieces, 'wall').length).toBeGreaterThan(10);
    expect(ofKind(dressing.pieces, 'flag-pole').length).toBeGreaterThan(0);
    expect(dressing.ground?.greens.length).toBeGreaterThan(0);
    // Stood on this frame's drawn ground, as the scenery is: each at the
    // height of the triangle under it, which is not the 0 it was placed at.
    const placed = parkDressingInView(
      town.corridor,
      town.profile,
      town.origin,
      scatterSeed(town.profile),
      land,
      frame.camera.x,
      frame.camera.z,
    ).pieces;
    expect(dressing.pieces).toEqual(standingOnGround(placed, frame.terrain.mesh));
    expect(placed.every((piece) => piece.y === 0)).toBe(true);
    expect(dressing.pieces.some((piece) => Math.abs(piece.y) > 0.01)).toBe(true);
  });

  it('carries none with the lever off, or with no corridor', () => {
    expect(frameAt(1_150, { parkDressingOff: true }).parkDressing).toBeUndefined();
    expect(
      frameAt(1_150, { worldCorridor: undefined, landClass: undefined }).parkDressing,
    ).toBeUndefined();
  });
});
