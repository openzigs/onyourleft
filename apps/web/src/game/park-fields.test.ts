// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pitches and playgrounds — #2688. Read through `fieldPieces`,
 * `parkDressingInView` and `sceneFrame`, the path a ride's frames take: a
 * pitch's lines and its goals, net, hoops or backstop by its mapped sport, a
 * playground's structures, and the room they are drawn in.
 */

import { describe, expect, it } from 'vitest';

import { metres, type RouteProfile } from '@onyourleft/domain';
import type { Box, LandUseFeature, PitchSport } from '@onyourleft/map-features';

import { landClassMask, type LandClassMask } from './land-class';
import { standingOnGround } from './landform';
import {
  NO_PARK_DRESSING,
  parkDressingInView,
  PARK_DRESSING_CAPACITY,
  type ParkDressingInView,
  type ParkPiece,
} from './park-dressing';
import {
  apexEnd,
  FIELD_ROAD_CLEARANCE_METRES,
  fieldFrame,
  fieldPieces,
  PARK_FIELD_CAPACITY,
  PITCH_LINE_GROUND_METRES,
  PITCH_LINE_INSET_METRES,
} from './park-fields';
import { distanceToDrawnRoad } from './road-grid';
import { northRoute } from './route-fixtures-testing';
import { sceneFrame } from './scene';
import { scatterSeed } from './scatter';
import { atStartLine } from './simulation';
import { corridorOrigin } from './terrain';
import type { WorldCorridor } from './world-data/corridor';

/** A level 6 km road due north: local `z` is distance along, `x` is across, the road on `x = 0`. */
const ROUTE = northRoute(6_000, () => 10);
const ORIGIN = corridorOrigin(ROUTE);
const SEED = scatterSeed(ROUTE);
const MIDDLE: Box = { minX: -1_000, maxX: 1_000, minZ: 2_000, maxZ: 4_000 };

function rectangle(kind: string, box: Box, sport?: PitchSport): LandUseFeature {
  return {
    layer: 'landuse',
    kind,
    ...(sport === undefined ? {} : { sport }),
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

/** A 100 by 60 m pitch from 40 m to 140 m off the road, its long axis across it. */
const PITCH: Box = { minX: 40, maxX: 140, minZ: 2_500, maxZ: 2_560 };

function place(...landUse: LandUseFeature[]): {
  readonly corridor: WorldCorridor;
  readonly land: LandClassMask;
} {
  const corridor: WorldCorridor = {
    routeId: 'park-fields-fixture',
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

describe('#2688 a pitch’s frame', () => {
  it('is its rectangle: its middle, its long axis, its length and its width, however it is turned', () => {
    const turn = Math.PI / 6;
    const [ux, uz] = [Math.cos(turn), Math.sin(turn)];
    const corner = (u: number, v: number): [number, number] => [
      300 + ux * u - uz * v,
      2_600 + uz * u + ux * v,
    ];
    const ring = Float32Array.from([
      ...corner(-50, -30),
      ...corner(50, -30),
      ...corner(50, 30),
      ...corner(-50, 30),
    ]);
    const frame = fieldFrame(ring);
    expect(frame?.x).toBeCloseTo(300, 3);
    expect(frame?.z).toBeCloseTo(2_600, 3);
    expect(frame?.length).toBeCloseTo(100, 3);
    expect(frame?.width).toBeCloseTo(60, 3);
    // The long axis, either way along it.
    expect(Math.abs((frame?.ax ?? 0) * ux + (frame?.az ?? 0) * uz)).toBeCloseTo(1, 5);
    expect(fieldFrame(Float32Array.of(0, 0, 1, 1))).toBeUndefined();
  });

  it('finds a fan’s apex — a diamond’s home plate — at its narrow end', () => {
    const fan = Float32Array.of(40, 2_530, 190, 2_490, 190, 2_570);
    const frame = fieldFrame(fan);
    if (frame === undefined) throw new Error('no frame');
    const end = apexEnd(fan, frame);
    const apexX = frame.x + frame.ax * end * (frame.length / 2);
    expect(apexX).toBeLessThan(frame.x);
  });
});

describe('#2688 what a pitch is drawn with, by its sport', () => {
  it('soccer: its lines, the halfway line, and a full-size goal at each end', () => {
    const pieces = fieldPieces(rectangle('pitch', PITCH, 'soccer'));
    expect(ofKind(pieces, 'pitch-line')).toHaveLength(5);
    // Each line's length is its width, and both its ends lie inside the pitch.
    for (const line of ofKind(pieces, 'pitch-line')) {
      expect(line.width).toBeGreaterThan(line.depth);
      for (const end of [-1, 1]) {
        const x = line.x + end * (line.width / 2) * Math.cos(line.yaw);
        const z = line.z - end * (line.width / 2) * Math.sin(line.yaw);
        expect(x).toBeGreaterThanOrEqual(PITCH.minX);
        expect(x).toBeLessThanOrEqual(PITCH.maxX);
        expect(z).toBeGreaterThanOrEqual(PITCH.minZ);
        expect(z).toBeLessThanOrEqual(PITCH.maxZ);
      }
    }
    const goals = ofKind(pieces, 'goal');
    expect(goals).toHaveLength(6);
    // A goal on each goal line, inside the frame by the lines' inset.
    const ends = [...new Set(goals.map((piece) => Math.round(piece.x)))].sort((a, b) => a - b);
    expect(ends).toEqual([40 + PITCH_LINE_INSET_METRES, 140 - PITCH_LINE_INSET_METRES]);
    // Its posts 7.32 m apart, and its bar 2.44 m up less the bar.
    const posts = goals.filter((piece) => piece.x < 90 && piece.lift === 0);
    expect(Math.abs((posts[0]?.z ?? 0) - (posts[1]?.z ?? 0))).toBeCloseTo(7.32, 3);
    expect(goals.find((piece) => piece.x < 90 && piece.lift > 0)?.lift).toBeCloseTo(2.32, 3);
  });

  it('soccer on a narrow pitch: small-sided goals', () => {
    const small = fieldPieces(
      rectangle('pitch', { minX: 40, maxX: 80, minZ: 2_500, maxZ: 2_520 }, 'soccer'),
    );
    const posts = ofKind(small, 'goal').filter((piece) => piece.x < 60 && piece.lift === 0);
    expect(Math.abs((posts[0]?.z ?? 0) - (posts[1]?.z ?? 0))).toBeCloseTo(5, 3);
  });

  it('rugby and football: an H of posts at each end', () => {
    for (const sport of ['rugby_union', 'rugby_league', 'american_football'] as const) {
      const goals = ofKind(fieldPieces(rectangle('pitch', PITCH, sport)), 'goal');
      expect([sport, goals.length]).toEqual([sport, 6]);
      expect(Math.max(...goals.map((piece) => piece.height))).toBe(8);
    }
  });

  it('tennis: its lines, no halfway line, and a net across its middle', () => {
    const court = { minX: 40, maxX: 76, minZ: 2_500, maxZ: 2_518 };
    const pieces = fieldPieces(rectangle('pitch', court, 'tennis'));
    expect(ofKind(pieces, 'pitch-line')).toHaveLength(4);
    const nets = ofKind(pieces, 'net');
    expect(nets).toHaveLength(1);
    expect(nets[0]?.x).toBeCloseTo(58, 3);
    expect(ofKind(pieces, 'goal')).toHaveLength(0);
  });

  it('basketball: its lines and a hoop on a pole at each end', () => {
    const court = { minX: 40, maxX: 70, minZ: 2_500, maxZ: 2_516 };
    const pieces = fieldPieces(rectangle('pitch', court, 'basketball'));
    expect(ofKind(pieces, 'pitch-line')).toHaveLength(5);
    expect(ofKind(pieces, 'hoop')).toHaveLength(4);
  });

  it('baseball: no lines, and a backstop at home plate', () => {
    const fan: LandUseFeature = {
      layer: 'landuse',
      kind: 'pitch',
      sport: 'baseball',
      rings: [Float32Array.of(40, 2_530, 190, 2_490, 190, 2_570)],
    };
    const pieces = fieldPieces(fan);
    expect(ofKind(pieces, 'pitch-line')).toHaveLength(0);
    const backstop = ofKind(pieces, 'backstop');
    expect(backstop).toHaveLength(3);
    // At the fan's narrow end (x 40), not its wide one (x 190).
    for (const panel of backstop) expect(panel.x).toBeLessThan(70);
    // One fence round home plate: the side panels stand on the back panel's
    // ends, no gap at its corners.
    const frame = fieldFrame(fan.rings[0] as Float32Array);
    if (frame === undefined) throw new Error('no frame');
    const across = (panel: ParkPiece) =>
      -(panel.x - frame.x) * frame.az + (panel.z - frame.z) * frame.ax;
    const [back, ...sides] = [...backstop].sort(
      (a, b) => Math.abs(across(a)) - Math.abs(across(b)),
    );
    for (const side of sides) {
      expect(Math.abs(across(side))).toBeCloseTo((back as ParkPiece).depth / 2, 3);
    }
  });

  it('no sport, or one it does not draw: the lines alone', () => {
    const pieces = fieldPieces(rectangle('pitch', PITCH));
    expect(pieces.map((piece) => piece.kind)).toEqual(Array(5).fill('pitch-line'));
  });

  it('a playground: a swing frame, a slide and a climbing frame; none where it is too narrow', () => {
    const play = fieldPieces(
      rectangle('playground', { minX: 40, maxX: 60, minZ: 2_500, maxZ: 2_515 }),
    );
    expect(ofKind(play, 'play')).toHaveLength(6);
    expect(
      fieldPieces(rectangle('playground', { minX: 40, maxX: 60, minZ: 2_500, maxZ: 2_506 })),
    ).toEqual([]);
    // Nothing on what is neither.
    expect(fieldPieces(rectangle('park', PITCH))).toHaveLength(0);
  });
});

describe('#2688 in the park dressing, through parkDressingInView and sceneFrame', () => {
  it('draws a pitch with no golf course or cemetery near, with no ground window', () => {
    const at = place(rectangle('pitch', PITCH, 'soccer'));
    const seen = view(at, 0, 2_530);
    expect(ofKind(seen.pieces, 'goal')).toHaveLength(6);
    expect(ofKind(seen.pieces, 'pitch-line')).toHaveLength(5);
    expect(seen.ground).toBeUndefined();
    // The control: no pitch, nothing.
    expect(view(place(rectangle('park', PITCH)), 0, 2_530)).toBe(NO_PARK_DRESSING);
  });

  it('draws nothing within its clearance of the road', () => {
    const beside = place(
      rectangle('pitch', { minX: 2, maxX: 102, minZ: 2_500, maxZ: 2_560 }, 'soccer'),
    );
    const pieces = view(beside, 0, 2_530).pieces;
    expect(pieces.length).toBeGreaterThan(0);
    // The goal line beside the road and the touch lines reaching it are left out.
    expect(ofKind(pieces, 'pitch-line').length).toBeLessThan(5);
    for (const piece of pieces) {
      expect(distanceToDrawnRoad(ROUTE, ORIGIN, piece.x, piece.z, 200)).toBeGreaterThanOrEqual(
        FIELD_ROAD_CLEARANCE_METRES + Math.max(piece.width, piece.depth) / 2,
      );
    }
  });

  it('draws no more than its own room, nearest first, after the golf and cemetery pieces', () => {
    const pitches: LandUseFeature[] = [];
    for (let row = 0; row < 24; row += 1) {
      for (const x0 of [40, 90, 140]) {
        const z0 = 2_500 + row * 30;
        const box = { minX: x0, maxX: x0 + 40, minZ: z0, maxZ: z0 + 20 };
        pitches.push(rectangle('pitch', box, 'soccer'));
      }
    }
    const at = place(...pitches);
    const seen = view(at, 90, 2_800);
    expect(seen.pieces.length).toBe(PARK_FIELD_CAPACITY);
    expect(seen.pieces.length).toBeLessThanOrEqual(PARK_DRESSING_CAPACITY + PARK_FIELD_CAPACITY);
    // Nearest first: none left out is nearer than any kept.
    const all = pitches.flatMap((pitch) => fieldPieces(pitch));
    const away = (piece: ParkPiece) => Math.hypot(piece.x - 90, piece.z - 2_800);
    const farthestKept = Math.max(...seen.pieces.map(away));
    const reached = all.filter((piece) => away(piece) <= 150);
    expect(reached.length).toBeGreaterThan(PARK_FIELD_CAPACITY);
    const dropped = reached.filter(
      (piece) =>
        !seen.pieces.some(
          (kept) =>
            kept.x === piece.x &&
            kept.z === piece.z &&
            kept.kind === piece.kind &&
            kept.width === piece.width,
        ),
    );
    for (const piece of dropped) expect(away(piece)).toBeGreaterThanOrEqual(farthestKept - 1e-6);
  });

  it('carries a pitch’s goals on the frame, stood on its ground', () => {
    const at = place(rectangle('pitch', PITCH, 'soccer'));
    const start = atStartLine(ROUTE);
    const frame = sceneFrame({
      profile: ROUTE,
      origin: ORIGIN,
      state: { ...start, ride: { ...start.ride, distance: metres(2_500) } },
      worldCorridor: at.corridor,
      landClass: at.land,
    });
    const dressing = frame.parkDressing as ParkDressingInView;
    expect(ofKind(dressing.pieces, 'goal')).toHaveLength(6);
    // The control: the lever off, none.
    const off = sceneFrame({
      profile: ROUTE,
      origin: ORIGIN,
      state: { ...start, ride: { ...start.ride, distance: metres(2_500) } },
      worldCorridor: at.corridor,
      landClass: at.land,
      parkDressingOff: true,
    });
    expect(off.parkDressing).toBeUndefined();
  });

  /**
   * Every drawn line piece on `frame`'s ground, read every 0.1 m along it: the
   * most its run stands above the ground and the ground above its run, and
   * how much of the pitch's lines its pieces cover, run end to end.
   */
  function offTheGround(frame: ReturnType<typeof sceneFrame>): {
    readonly pieces: readonly ParkPiece[];
    readonly floats: number;
    readonly buried: number;
    readonly run: number;
  } {
    const pieces = ofKind((frame.parkDressing as ParkDressingInView).pieces, 'pitch-line');
    let floats = 0;
    let buried = 0;
    let run = 0;
    for (const line of pieces) {
      const tilt = line.tilt ?? 0;
      const reach = (line.width / 2) * Math.cos(tilt);
      run += reach * 2;
      const steps = Math.max(1, Math.ceil((reach * 2) / 0.1));
      const points = [];
      for (let step = 0; step <= steps; step += 1) {
        const along = -reach + (step / steps) * reach * 2;
        points.push({
          x: line.x + along * Math.cos(line.yaw),
          y: 0,
          z: line.z - along * Math.sin(line.yaw),
          laid: line.y + along * Math.tan(tilt),
        });
      }
      const under = standingOnGround(points, frame.terrain.mesh);
      // Every point along it is over ground.
      expect(under).toHaveLength(points.length);
      for (const point of under) {
        floats = Math.max(floats, point.laid - point.y);
        buried = Math.max(buried, point.y - point.laid);
      }
    }
    return { pieces, floats, buried, run };
  }

  /**
   * The sceneFrame at any distance on `route`, the pitch (or `pitch`) beside
   * it — every frame given the same origin, corridor and land-class mask, as
   * a ride's frames are, so `park-dressing.ts` keeps its dressing and its
   * line pieces from one frame to the next and the cut cache can hit.
   */
  function framesOn(
    route: RouteProfile,
    pitch: LandUseFeature = rectangle('pitch', PITCH, 'soccer'),
  ): (distance: number) => ReturnType<typeof sceneFrame> {
    const origin = corridorOrigin(route);
    const corridor: WorldCorridor = { ...place(pitch).corridor, origin };
    const landClass = landClassMask(corridor);
    const start = atStartLine(route);
    return (distance) =>
      sceneFrame({
        profile: route,
        origin,
        state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
        worldCorridor: corridor,
        landClass,
      });
  }

  /** A sceneFrame at `distance` on `route`, the pitch (or `pitch`) beside it. */
  function frameOn(
    route: RouteProfile,
    distance: number,
    pitch?: LandUseFeature,
  ): ReturnType<typeof sceneFrame> {
    return framesOn(route, pitch)(distance);
  }

  it('lays every line along the ground in pieces, no point of it off the ground by more than its height', () => {
    // The PR's second review: one 98 m box tilted end to end still floated
    // 2.04 m mid-span on the level ROUTE, where the ground folds at the
    // terrain's columns, and the crest route buried a goal line 0.28 m.
    const turned = Math.PI / 7;
    const corner = (u: number, v: number): [number, number] => [
      -100 + Math.cos(turned) * u - Math.sin(turned) * v,
      2_530 + Math.sin(turned) * u + Math.cos(turned) * v,
    ];
    const askew: LandUseFeature = {
      layer: 'landuse',
      kind: 'pitch',
      sport: 'soccer',
      rings: [
        Float32Array.from([
          ...corner(-45, -28),
          ...corner(45, -28),
          ...corner(45, 28),
          ...corner(-45, 28),
        ]),
      ],
    };
    const routes = {
      level: ROUTE,
      grade: northRoute(6_000, (along) => 10 + 0.03 * along),
      crest: northRoute(6_000, (along) => 10 + 40 * Math.sin(along / 400)),
      rolling: northRoute(6_000, (along) => 10 + 15 * Math.sin(along / 150)),
    };
    // Each pitch's five lines, end to end: two touch lines and two goal lines
    // a line's width past its length and width less the inset, and the halfway line.
    const square = rectangle('pitch', PITCH, 'soccer');
    const lengths = new Map([
      [square, 2 * 98.2 + 2 * 58.2 + 58],
      [askew, 2 * 88.2 + 2 * 54.2 + 54],
    ]);
    let pieces = 0;
    for (const route of Object.values(routes)) {
      for (const [pitch, drawn] of lengths) {
        // Twice, 30 m apart, on the same corridor and mask, as a ride's frames
        // are: the second frame reads the cuts the first made.
        const at = framesOn(route, pitch);
        for (const distance of [2_500, 2_530]) {
          const seen = offTheGround(at(distance));
          expect(seen.floats).toBeLessThanOrEqual(PITCH_LINE_GROUND_METRES);
          expect(seen.buried).toBeLessThanOrEqual(PITCH_LINE_GROUND_METRES);
          // All five lines, whole: the pieces run end to end and leave none out.
          expect(seen.run).toBeCloseTo(drawn, 3);
          pieces = Math.max(pieces, seen.pieces.length);
        }
      }
    }
    // The control: the ground does fold under them, so a line is several pieces.
    expect(pieces).toBeGreaterThan(5);
  });

  it('lays each piece’s two ends on the ground under them, on a 3 % grade', () => {
    const graded = northRoute(6_000, (along) => 10 + 0.03 * along);
    const frame = frameOn(graded, 2_500);
    const lines = ofKind((frame.parkDressing as ParkDressingInView).pieces, 'pitch-line');
    let steepest = 0;
    for (const line of lines) {
      const tilt = line.tilt ?? 0;
      steepest = Math.max(steepest, Math.abs(tilt));
      const reach = (line.width / 2) * Math.cos(tilt);
      for (const end of [-1, 1]) {
        const x = line.x + end * reach * Math.cos(line.yaw);
        const z = line.z - end * reach * Math.sin(line.yaw);
        const [under] = standingOnGround([{ x, y: 0, z }], frame.terrain.mesh);
        if (under === undefined) throw new Error('no ground under a line’s end');
        expect(under.y).toBeCloseTo(line.y + end * reach * Math.tan(tilt), 4);
        // The ground at its end lies between its base and its top.
        const base = line.y + line.lift + end * (line.width / 2) * Math.sin(tilt);
        expect(under.y).toBeGreaterThanOrEqual(base - 0.01);
        expect(under.y).toBeLessThanOrEqual(base + line.height + 0.01);
      }
    }
    // The control: the ground under the pitch does slope.
    expect(steepest).toBeGreaterThan(0.005);
  });

  it('keeps a frame’s pitch and playground pieces within their room once its lines are cut', () => {
    const pitches: LandUseFeature[] = [];
    for (let row = 0; row < 8; row += 1) {
      for (const x0 of [-150, -90, 30, 90]) {
        const z0 = 2_400 + row * 40;
        pitches.push(
          rectangle('pitch', { minX: x0, maxX: x0 + 50, minZ: z0, maxZ: z0 + 30 }, 'soccer'),
        );
      }
    }
    const route = northRoute(6_000, (along) => 10 + 40 * Math.sin(along / 400));
    const origin = corridorOrigin(route);
    const corridor: WorldCorridor = { ...place(...pitches).corridor, origin };
    const start = atStartLine(route);
    const frame = sceneFrame({
      profile: route,
      origin,
      state: { ...start, ride: { ...start.ride, distance: metres(2_500) } },
      worldCorridor: corridor,
      landClass: landClassMask(corridor),
    });
    const pieces = (frame.parkDressing as ParkDressingInView).pieces;
    // The control: `park-dressing.ts` handed it the room's 80, a line as one.
    const handed = parkDressingInView(
      corridor,
      route,
      origin,
      scatterSeed(route),
      landClassMask(corridor),
      frame.camera.x,
      frame.camera.z,
    );
    expect(handed.pieces).toHaveLength(PARK_FIELD_CAPACITY);
    // Cut, its lines are more pieces than it was handed, and still the room holds.
    expect(ofKind(pieces, 'pitch-line').length).toBeGreaterThan(
      ofKind(handed.pieces, 'pitch-line').length,
    );
    expect(pieces.length).toBeLessThanOrEqual(PARK_FIELD_CAPACITY);
    expect(pieces.length).toBeGreaterThan(PARK_FIELD_CAPACITY / 2);
  });
});
