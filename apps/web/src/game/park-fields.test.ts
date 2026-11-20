// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pitches and playgrounds — #2688. Read through `fieldPieces`,
 * `parkDressingInView` and `sceneFrame`, the path a ride's frames take: a
 * pitch's lines and its goals, net, hoops or backstop by its mapped sport, a
 * playground's structures, and the room they are drawn in.
 */

import { describe, expect, it } from 'vitest';

import { metres } from '@onyourleft/domain';
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

  it('lays each line along a slope, both its ends on the ground under them', () => {
    // A 3 % grade: the PR's review measured a 98 m touch line 1.5 m off the
    // ground at its ends here, stood from the ground under its middle alone.
    const graded = northRoute(6_000, (along) => 10 + 0.03 * along);
    const origin = corridorOrigin(graded);
    const flat = place(rectangle('pitch', PITCH, 'soccer'));
    const corridor: WorldCorridor = { ...flat.corridor, origin };
    const start = atStartLine(graded);
    const frame = sceneFrame({
      profile: graded,
      origin,
      state: { ...start, ride: { ...start.ride, distance: metres(2_500) } },
      worldCorridor: corridor,
      landClass: landClassMask(corridor),
    });
    const lines = ofKind((frame.parkDressing as ParkDressingInView).pieces, 'pitch-line');
    expect(lines).toHaveLength(5);
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
        const base = line.y + line.lift + end * (line.width / 2) * Math.sin(tilt);
        // The ground at its end lies between its base and its top: neither floating nor buried.
        expect(under.y).toBeGreaterThanOrEqual(base - 0.01);
        expect(under.y).toBeLessThanOrEqual(base + line.height + 0.01);
      }
    }
    // The control: the ground under the pitch does slope.
    expect(steepest).toBeGreaterThan(0.005);
  });
});
