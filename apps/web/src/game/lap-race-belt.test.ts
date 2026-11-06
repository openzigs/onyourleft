// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1902's renderer half: `three-renderer.ts` §`LapRaceBelt` draws a lap-race
 * frame's pick-up points, puddles and hit effects as three instanced meshes —
 * one each, whatever the count — and a race's bots ride in the riders' own
 * instanced meshes, so a frame of eight racers, every pick-up point and ten
 * puddles submits the same draws as one with one puddle.
 *
 * A draw here is a visible mesh: each `InstancedMesh` is one call whatever
 * its instance count. What jsdom cannot do — count three's own calls — the
 * browser gate does: `lap-race.browser.spec.ts`.
 */

import { describe, expect, it } from 'vitest';

import { hitLook, lapRaceInView, laneLateral } from './lap-race/in-view';
import type { LapRaceInView, LapRacePiece, RiderMarker, SceneFrame } from './port';
import { northRoute } from './route-fixtures-testing';
import { sceneFrame, type RaceBotInput } from './scene';
import { atStartLine } from './simulation';
import { CENTRE_LINE_LIFT_METRES, ROAD_WIDTH_METRES, corridorOrigin } from './terrain';
import { PUDDLE_WARNING_METRES } from './hud/lap-race-hud';
import {
  LAP_RACE_PIECE_CAPACITY,
  LapRaceBelt,
  PICK_UP_SEEN_FROM_METRES,
  RiderBelt,
  type LapRacePieceKind,
} from './three-renderer';
import { PEAK_IRRADIANCE } from './world';
import {
  createItemRace,
  metres,
  raceCourse,
  type Hazard,
  type ItemRaceState,
} from '@onyourleft/domain';

const KINDS: readonly LapRacePieceKind[] = ['pickUps', 'hazards', 'hits'];
const HIT = { glow: 0.8, scale: 1, spin: 0 } as const;

const ROUTE = northRoute(2_000, () => 10);
const ORIGIN = corridorOrigin(ROUTE);
const RIDER = 400;
/** A race started at the rider's place, laps short enough that all its pick-up points are in view. */
const COURSE = raceCourse(40, 3);

/** `count` puddles, a metre apart, in turn across the three lanes, on the road ahead. */
function puddles(count: number): readonly Hazard[] {
  return Array.from({ length: count }, (_, index) => ({
    position: 10 + index,
    lane: index % 3,
    ownerId: 'bot-1',
    untilMs: 30_000,
    hitIds: [],
  }));
}

/** A race of eight on the line, with `hazards` on the road. */
function race(hazards: readonly Hazard[]): ItemRaceState {
  const made = createItemRace({
    course: COURSE,
    seed: 3,
    itemsOn: true,
    racerIds: ['rider', ...Array.from({ length: 7 }, (_, index) => `bot-${index + 1}`)],
    startMs: 0,
  });
  return { ...made, hazards };
}

/** Seven bots ahead of the rider, a lane each in turn, every other one hit. */
const BOTS: readonly RaceBotInput[] = Array.from({ length: 7 }, (_, index) => ({
  distanceMetres: RIDER + 6 + 4 * index,
  speedMetresPerSecond: 9,
  lateralMetres: laneLateral(index % 3),
  ...(index % 2 === 0 ? { hit: HIT } : {}),
}));

/** A frame of the rider, hit, and the seven bots, with the race's pieces and `hazards`. */
function frameOf(hazards: readonly Hazard[]): SceneFrame {
  const start = atStartLine(ROUTE);
  const frame = sceneFrame({
    profile: ROUTE,
    origin: ORIGIN,
    state: { ...start, ride: { ...start.ride, distance: metres(RIDER) } },
    raceBots: BOTS,
    riderHit: HIT,
  });
  return {
    ...frame,
    lapRace: lapRaceInView({ corridor: frame.corridor, race: race(hazards), startAlong: RIDER }),
  };
}

/** Anything three can draw: a mesh, shown or not. */
interface Drawable {
  readonly visible: boolean;
  readonly isMesh?: boolean;
  traverseVisible(visit: (object: Drawable) => void): void;
}

/** The draws `groups` submit: one for each mesh in them that is shown, however deep. */
function draws(groups: readonly Drawable[]): number {
  let count = 0;
  for (const group of groups) {
    group.traverseVisible((object) => {
      if (object.isMesh === true) count += 1;
    });
  }
  return count;
}

describe('the lap race’s belt — #1902', () => {
  it('adds the same three draws for one puddle as for ten, with eight racers and every pick-up point in view', () => {
    const belt = new LapRaceBelt('stylised');
    const riders = new RiderBelt();
    const meshes = KINDS.map((what) => belt.meshOf(what));
    const counted = [1, 10].map((count) => {
      const frame = frameOf(puddles(count));
      // The controls: eight racers drawn, every pick-up point and every puddle in view, five hit.
      expect(frame.markers.map((marker) => marker.kind)).toEqual([
        'rider',
        ...BOTS.map(() => 'bot'),
      ]);
      expect(frame.lapRace?.pickUps).toHaveLength(COURSE.laps * 3);
      expect(frame.lapRace?.hazards).toHaveLength(count);
      belt.update(frame.lapRace, frame.markers);
      riders.place(frame.markers);
      KINDS.forEach((what, index) => expect(belt.meshOf(what), what).toBe(meshes[index]));
      expect(belt.drawn('pickUps')).toHaveLength(COURSE.laps * 3);
      expect(belt.drawn('hazards')).toHaveLength(count);
      expect(belt.drawn('hits')).toHaveLength(5);
      // The eight racers are eight instances of the riders' meshes, never more meshes.
      expect(riders.group.visible).toBe(true);
      expect(riders.meshes.bodies.count).toBe(8);
      return { belt: draws([belt.group]), all: draws([belt.group, riders.group]) };
    });
    expect(counted[0]?.belt).toBe(3);
    expect(counted[1]).toEqual(counted[0]);
    belt.dispose();
    riders.dispose();
  });

  it('draws each kind with ONE instanced mesh, casting and taking no shadow, nothing transparent', () => {
    const belt = new LapRaceBelt('stylised');
    for (const what of KINDS) {
      const mesh = belt.meshOf(what);
      expect(mesh.isInstancedMesh).toBe(true);
      expect(mesh.instanceMatrix.count).toBe(LAP_RACE_PIECE_CAPACITY);
      expect(mesh.castShadow).toBe(false);
      expect(mesh.receiveShadow).toBe(false);
      expect(mesh.material).not.toHaveProperty('transparent', true);
    }
    belt.dispose();
  });

  it('draws the first LAP_RACE_PIECE_CAPACITY of each, and never a second mesh, when handed more', () => {
    const belt = new LapRaceBelt('stylised');
    const piece: LapRacePiece = { x: 0, y: 0, z: 0, yaw: 0 };
    const many = Array.from({ length: LAP_RACE_PIECE_CAPACITY + 5 }, () => piece);
    const marker = frameOf([]).markers[0] as RiderMarker;
    belt.update(
      { pickUps: many, hazards: many },
      many.map(() => ({ ...marker, hit: HIT })),
    );
    for (const what of KINDS) expect(belt.drawn(what), what).toHaveLength(LAP_RACE_PIECE_CAPACITY);
    belt.dispose();
  });

  it('draws nothing on a frame with no lap race, whatever its markers carry', () => {
    const belt = new LapRaceBelt('realistic');
    const frame = frameOf(puddles(2));
    belt.update(frame.lapRace, frame.markers);
    belt.update(undefined, frame.markers);
    for (const what of KINDS) {
      expect(belt.meshOf(what).visible, what).toBe(false);
      expect(belt.drawn(what), what).toEqual([]);
    }
    belt.update({ ...(frame.lapRace as LapRaceInView), hazards: [] }, frame.markers);
    expect(belt.meshOf('hazards').visible).toBe(false);
    expect(belt.meshOf('pickUps').visible).toBe(true);
    belt.setShown(false);
    belt.update(frame.lapRace, frame.markers);
    for (const what of KINDS) expect(belt.meshOf(what).visible, what).toBe(false);
    belt.dispose();
  });

  it('draws each hit effect where its racer is drawn, at the brightness and size its look says', () => {
    const belt = new LapRaceBelt('stylised');
    const frame = frameOf([]);
    const look = hitLook(
      [{ rateMetresPerSecond: -2, fromMs: 1_000, untilMs: 5_000 }],
      1_100,
      false,
    );
    const markers = frame.markers.map((marker, index) =>
      index === 1 && look !== undefined ? { ...marker, hit: look } : marker,
    );
    belt.update(frame.lapRace, markers);
    const hit = markers.filter((marker) => marker.hit !== undefined);
    const drawn = belt.drawn('hits');
    expect(drawn).toHaveLength(hit.length);
    drawn.forEach((each, index) => {
      const marker = hit[index] as RiderMarker;
      // To a millimetre: the instance buffer is single precision.
      expect(each.x).toBeCloseTo(marker.x, 3);
      expect(each.y).toBeCloseTo(marker.y, 3);
      expect(each.z).toBeCloseTo(marker.z, 3);
      expect(each.glow).toBeCloseTo(marker.hit?.glow ?? Number.NaN, 5);
      expect(each.scale).toBeCloseTo(marker.hit?.scale ?? Number.NaN, 5);
    });
    expect(drawn[1]?.scale).toBeLessThan(1);
    belt.dispose();
  });

  it('turns each hit effect by its racer’s heading plus the look’s spin', () => {
    const belt = new LapRaceBelt('stylised');
    const frame = frameOf([]);
    const marker = frame.markers[0] as RiderMarker;
    const hit = { glow: 0.8, scale: 1, spin: 0.7 };
    belt.update(frame.lapRace, [{ ...marker, hit }]);
    const heading = Math.atan2(marker.headingX, marker.headingZ);
    expect(belt.drawn('hits')[0]?.yaw).toBeCloseTo(heading + 0.7, 5);
    belt.dispose();
  });

  it('marks every instance buffer it rewrites for upload, on every frame that carries pieces', () => {
    const belt = new LapRaceBelt('stylised');
    const frame = frameOf(puddles(3));
    const hits = belt.meshOf('hits');
    const versions = (): number[] => [
      belt.meshOf('pickUps').instanceMatrix.version,
      belt.meshOf('hazards').instanceMatrix.version,
      hits.instanceMatrix.version,
      hits.instanceColor?.version ?? -1,
    ];
    const start = versions();
    belt.update(frame.lapRace, frame.markers);
    const first = versions();
    belt.update(frame.lapRace, frame.markers);
    const second = versions();
    first.forEach((each, at) => expect(each).toBeGreaterThan(start[at] as number));
    second.forEach((each, at) => expect(each).toBeGreaterThan(first[at] as number));
    belt.dispose();
  });

  it('lights no lit part past white, glows every part of a hit, and lays nothing on the road inside its depth allowance', () => {
    const belt = new LapRaceBelt('stylised');
    for (const what of KINDS) {
      const geometry = belt.meshOf(what).geometry;
      const colour = geometry.getAttribute('color');
      const glow = geometry.getAttribute('oylGlow');
      const position = geometry.getAttribute('position');
      for (let at = 0; at < colour.count; at += 1) {
        // On the carriageway, clear of the road by its depth allowance; a post stands beside it.
        if (Math.abs(position.getX(at)) < ROAD_WIDTH_METRES / 2) {
          expect(position.getY(at), what).toBeGreaterThanOrEqual(CENTRE_LINE_LIFT_METRES - 1e-6);
        }
        if (glow.getX(at) === 1) continue;
        expect(what).not.toBe('hits');
        for (const channel of [colour.getX(at), colour.getY(at), colour.getZ(at)]) {
          expect(channel * PEAK_IRRADIANCE, what).toBeLessThanOrEqual(1);
        }
      }
    }
    belt.dispose();
  });

  it('flies each pick-up point’s glowing flags facing the rider, high and off the carriageway (#1969)', () => {
    // The distance the browser gate reads a pick-up point from is the HUD's puddle warning.
    expect(PICK_UP_SEEN_FROM_METRES).toBe(PUDDLE_WARNING_METRES);
    const belt = new LapRaceBelt('stylised');
    const geometry = belt.meshOf('pickUps').geometry;
    const glow = geometry.getAttribute('oylGlow');
    const position = geometry.getAttribute('position');
    const half = ROAD_WIDTH_METRES / 2;
    /** The glowing parts above head height: the flags, by side. */
    const flags = new Map<number, { xs: number[]; ys: number[]; zs: number[] }>();
    for (let at = 0; at < position.count; at += 1) {
      const [x, y, z] = [position.getX(at), position.getY(at), position.getZ(at)];
      // Nothing over the carriageway above the band: a rider and the camera ride through it.
      if (Math.abs(x) < half) expect(y, 'a part over the road').toBeLessThan(0.1);
      if (glow.getX(at) !== 1 || y < 1) continue;
      const side = Math.sign(x);
      const flag = flags.get(side) ?? { xs: [], ys: [], zs: [] };
      flag.xs.push(x);
      flag.ys.push(y);
      flag.zs.push(z);
      flags.set(side, flag);
    }
    expect([...flags.keys()].sort()).toEqual([-1, 1]);
    const span = (values: readonly number[]): number => Math.max(...values) - Math.min(...values);
    for (const [side, flag] of flags) {
      // Broad ACROSS the road, thin along it: its face is to the rider, never its edge.
      expect(span(flag.xs), `flag ${String(side)} across`).toBeGreaterThanOrEqual(1);
      expect(span(flag.ys), `flag ${String(side)} tall`).toBeGreaterThanOrEqual(1);
      expect(span(flag.zs), `flag ${String(side)} along`).toBeLessThan(0.1);
      // Over the verge, outside the road's edge.
      expect(
        Math.min(...flag.xs.map(Math.abs)),
        `flag ${String(side)} off the road`,
      ).toBeGreaterThan(half);
    }
    belt.dispose();
  });

  it('shades by the rung in the stylised world, and wears one physically based material in the realistic', () => {
    const stylised = new LapRaceBelt('stylised');
    stylised.setShading('flat');
    for (const what of KINDS) {
      expect((stylised.meshOf(what).material as { type: string }).type).toBe('MeshBasicMaterial');
    }
    stylised.setShading('lit');
    for (const what of KINDS) {
      expect((stylised.meshOf(what).material as { type: string }).type).toBe('MeshLambertMaterial');
    }
    const realistic = new LapRaceBelt('realistic');
    for (const shading of ['flat', 'lit'] as const) {
      realistic.setShading(shading);
      for (const what of KINDS) {
        expect((realistic.meshOf(what).material as { type: string }).type).toBe(
          'MeshStandardMaterial',
        );
      }
    }
    stylised.dispose();
    realistic.dispose();
  });
});
