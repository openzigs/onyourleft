// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Riders drawn in their draft order through a bend — #2427, ADR 0038 D-3.4:
 * *"a rider drawn behind another is behind them"*. The draft is computed from
 * odometers; since #1998 each rider is DRAWN at its odometer less a lag that
 * grows with its own speed (`bend-easing.ts`), so through a bend a faster
 * rider a few metres ahead could be drawn behind the slower one it shelters.
 * Read back from the markers `placedRiders` hands the renderer, projected on
 * the drawn path they are placed along.
 */

import { describe, expect, it } from 'vitest';

import {
  botPacerPlan,
  buildGhostTrack,
  gradePercent,
  kilograms,
  metres,
  metresPerSecond,
  seconds,
  watts,
  type GhostTrack,
  type RouteProfile,
} from '@onyourleft/domain';
import { ridingConditions } from '@onyourleft/physics';

import { EASED_LEAN_RADIANS, easedPlace, MAX_LAG_METRES } from './bend-easing';
import { combinedLean } from './bicycle';
import { drawnLine, drawnLineAt, type DrawnLine } from './drawn-line';
import type { RiderMarker } from './port';
import { hairpinRoute, plannerCornerRoute } from './route-fixtures-testing';
import { DRAWN_ORDER_SHARE, placedRiders, sceneFrame, type RemoteRiderInput } from './scene';
import { GameSimulation, atStartLine, type GameState } from './simulation';
import { corridorOrigin, roadCorridor, type RoadCorridor } from './terrain';

const KMH = 1 / 3.6;

/** How far past the easing's 25° a rider held in order may lean: rounding only. */
const LEAN_SLACK = 1e-9;

/** The two bends the issue names, and the stretch of odometer that rides into, through and out of each. */
interface Bend {
  readonly name: string;
  readonly route: RouteProfile;
  readonly line: DrawnLine;
  readonly corridor: RoadCorridor;
  readonly from: number;
  readonly to: number;
}

function bend(
  name: string,
  route: RouteProfile,
  corridorAt: number,
  from: number,
  to: number,
): Bend {
  const origin = corridorOrigin(route);
  return {
    name,
    route,
    line: drawnLine(route),
    // One corridor for the stretch: a marker is placed on the drawn path, and
    // this one reaches 60 m behind and 400 m past where it stands.
    corridor: roadCorridor(route, origin, corridorAt),
    from,
    to,
  };
}

const BENDS: readonly Bend[] = [
  // 400 m north, a 10 m hairpin, and back south.
  bend('a 10 m hairpin', hairpinRoute(10), 320, 340, 640),
  // 1 500 m north and a 120° corner at one sample (#2422).
  bend('a 120° corner drawn at one sample', plannerCornerRoute(120), 1_420, 1_440, 1_760),
];

/** One rider in a frame besides the rider: its kind, odometer and own speed. */
interface Other {
  readonly kind: 'bot' | 'ghost' | 'remote';
  readonly odometer: number;
  readonly speed: number;
}

/** A ghost track that holds `speed` from the start. */
function steadyGhost(speed: number): GhostTrack {
  return buildGhostTrack({ elapsedSeconds: [0, 1_000], distanceMetres: [0, speed * 1_000] });
}

/** The markers `placedRiders` draws for the rider at `odometer` and `speed` and the others, in input order. */
function frame(
  where: Bend,
  rider: { readonly odometer: number; readonly speed: number },
  others: readonly Other[],
): readonly RiderMarker[] {
  const start = atStartLine(where.route);
  const bot = others.find((other) => other.kind === 'bot');
  const ghost = others.find((other) => other.kind === 'ghost');
  const remotes: RemoteRiderInput[] = others
    .filter((other) => other.kind === 'remote')
    .map((other, index) => ({
      riderId: index + 1,
      distanceMetres: other.odometer,
      speedMetresPerSecond: other.speed,
    }));
  const state: GameState = {
    ...start,
    ride: { speed: metresPerSecond(rider.speed), distance: metres(rider.odometer) },
    // The ghost's clock: it has ridden its odometer at its steady speed.
    ridden: seconds(ghost === undefined ? 0 : ghost.odometer / ghost.speed),
    ...(bot === undefined
      ? {}
      : {
          bot: {
            state: { speed: metresPerSecond(bot.speed), distance: metres(bot.odometer) },
            distanceOnRoute: metres(bot.odometer),
            grade: gradePercent(0),
            power: watts(200),
          },
        }),
  };
  const placed = placedRiders(
    {
      profile: where.route,
      origin: corridorOrigin(where.route),
      state,
      ...(bot === undefined ? {} : { botDistance: bot.odometer }),
      ...(ghost === undefined ? {} : { ghost: steadyGhost(ghost.speed) }),
      ...(remotes.length === 0 ? {} : { remoteRiders: remotes }),
    },
    where.corridor,
  );
  return placed.map((each) => each.marker);
}

/**
 * How far along the drawn path a marker is: the nearest point of the path
 * within the 40 m before `odometer` (a marker is never drawn past it, nor more
 * than 30 m behind it), refined along the path's heading there. A marker drawn
 * level with another is beside the path, across it, which this reads past.
 */
function drawnAlong(line: DrawnLine, marker: RiderMarker, odometer: number): number {
  let best = odometer;
  let nearest = Number.POSITIVE_INFINITY;
  for (let at = odometer - MAX_LAG_METRES - 10; at <= odometer + 1; at += 0.25) {
    const point = drawnLineAt(line, at);
    const away = Math.hypot(marker.x - point.x, marker.z - point.z);
    if (away < nearest) {
      nearest = away;
      best = at;
    }
  }
  for (let pass = 0; pass < 3; pass += 1) {
    const point = drawnLineAt(line, best);
    best += (marker.x - point.x) * point.headingX + (marker.z - point.z) * point.headingZ;
  }
  return best;
}

/**
 * Each frame through the bend for the rider and one other `gap` metres
 * ahead (or behind, negative), at their own speeds: the drawn places of both,
 * read back from the markers.
 */
function through(
  where: Bend,
  riderSpeed: number,
  other: { readonly kind: Other['kind']; readonly gap: number; readonly speed: number },
  step: number,
): {
  readonly at: number;
  readonly rider: number;
  readonly other: number;
  readonly lean: number;
}[] {
  const frames: { at: number; rider: number; other: number; lean: number }[] = [];
  for (let at = where.from; at <= where.to; at += step) {
    const odometer = at + other.gap;
    const markers = frame(where, { odometer: at, speed: riderSpeed }, [
      { kind: other.kind, odometer, speed: other.speed },
    ]);
    const [own, theirs] = markers;
    if (own === undefined || theirs === undefined)
      throw new Error(`a rider missing at ${String(at)}`);
    frames.push({
      at,
      rider: drawnAlong(where.line, own, at),
      other: drawnAlong(where.line, theirs, odometer),
      // The other's combined lean, as the renderer is handed it.
      lean: Math.abs(combinedLean(theirs.lean, theirs.bodyLean)),
    });
  }
  return frames;
}

describe('a slower rider behind a faster one is drawn behind them through a bend — #2427', () => {
  it.each(BENDS)(
    '$name: the rider at 30 km/h 5 m behind the pacer at 45 km/h is never drawn ahead of it',
    (where) => {
      const frames = through(where, 30 * KMH, { kind: 'bot', gap: 5, speed: 45 * KMH }, 1);
      // Both enter the bend: the pacer's drawn place is eased off its odometer somewhere.
      expect(frames.some((each) => each.other < each.at + 5 - 1)).toBe(true);
      for (const each of frames) {
        expect(
          each.other - each.rider,
          `at ${String(each.at)} m the rider is drawn at ${each.rider.toFixed(2)} and the pacer at ${each.other.toFixed(2)}: a drawn gap of ${(each.other - each.rider).toFixed(2)} m for 5 m of odometer`,
        ).toBeGreaterThan(0);
      }
    },
    60_000,
  );

  it.each(BENDS)(
    '$name: a room’s rider at 30 km/h 5 m behind the rider at 45 km/h is never drawn ahead of them',
    (where) => {
      const frames = through(where, 45 * KMH, { kind: 'remote', gap: -5, speed: 30 * KMH }, 1);
      for (const each of frames) {
        expect(
          each.rider - each.other,
          `at ${String(each.at)} m the rider is drawn at ${each.rider.toFixed(2)} and the room’s rider 5 m behind at ${each.other.toFixed(2)}`,
        ).toBeGreaterThan(0);
      }
    },
    60_000,
  );
});

/** The speeds the issue sweeps, 20 to 50 km/h. */
const SPEEDS = [20, 30, 40, 50].map((each) => each * KMH);
/** Odometer gaps from D-2's "level" to the draft's 30 m reach. */
const GAPS = [0.05, 2, 8, 20, 30];

describe('the drawn order is the odometer order, every frame, every kind — #2427', () => {
  it.each(BENDS)(
    '$name: the rider and a pacer, a ghost or a room’s rider, ahead or behind, at 20–50 km/h',
    (where) => {
      const kinds: readonly Other['kind'][] = ['bot', 'ghost', 'remote'];
      let checked = 0;
      let leanest = { lean: 0, said: 'nobody leant' };
      for (const riderSpeed of SPEEDS) {
        for (const otherSpeed of SPEEDS) {
          for (const gap of GAPS) {
            for (const side of [1, -1]) {
              // One kind a combination, in turn, so all three meet every speed and side.
              const kind = kinds[checked % kinds.length] as Other['kind'];
              const frames = through(
                where,
                riderSpeed,
                { kind, gap: side * gap, speed: otherSpeed },
                4,
              );
              for (const each of frames) {
                const odometerGap = side * gap;
                const drawnGap = each.other - each.rider;
                const said = `${kind} ${side > 0 ? 'ahead' : 'behind'} by ${String(gap)} m at ${(otherSpeed / KMH).toFixed(0)} km/h, the rider at ${(riderSpeed / KMH).toFixed(0)} km/h, at ${String(each.at)} m: drawn gap ${drawnGap.toFixed(3)}`;
                expect(Math.sign(drawnGap), said).toBe(side);
                expect(Math.abs(drawnGap - odometerGap), said).toBeLessThanOrEqual(
                  MAX_LAG_METRES + 1e-6,
                );
                // Never past its own odometer, never more than 30 m behind it.
                const odometer = each.at + odometerGap;
                expect(each.other, said).toBeLessThanOrEqual(odometer + 1e-6);
                expect(each.other, said).toBeGreaterThanOrEqual(odometer - MAX_LAG_METRES - 1e-6);
                if (each.lean > leanest.lean) leanest = { lean: each.lean, said };
                checked += 1;
              }
            }
          }
        }
      }
      expect(checked).toBeGreaterThan(10_000);
      // Held in order, a rider is drawn no faster than the steady-turn speed
      // where it is held (`bend-easing.ts` §`steadyTurnSpeed`), so it leans no
      // further than the easing's 25°. Without that cap it leant 27.5° here.
      expect(leanest.lean, leanest.said).toBeLessThanOrEqual(EASED_LEAN_RADIANS + LEAN_SLACK);
    },
    300_000,
  );

  it.each(BENDS)(
    '$name: three room riders a few metres apart at three speeds, none of them the rider, are drawn in order',
    (where) => {
      for (let at = where.from; at <= where.to; at += 2) {
        const riders: Other[] = [
          { kind: 'remote', odometer: at, speed: 50 * KMH },
          { kind: 'remote', odometer: at + 4, speed: 20 * KMH },
          { kind: 'remote', odometer: at + 9, speed: 45 * KMH },
        ];
        // The rider at rest well behind them, where the corridor still reaches.
        const markers = frame(where, { odometer: where.from - 40, speed: 0 }, riders);
        const drawn = markers
          .slice(1)
          .map((marker, index) =>
            drawnAlong(where.line, marker, (riders[index] as Other).odometer),
          );
        expect(drawn[0], `at ${String(at)} m`).toBeLessThan(drawn[1] as number);
        expect(drawn[1], `at ${String(at)} m`).toBeLessThan(drawn[2] as number);
      }
    },
    60_000,
  );
});

/** Each rider's drawn place and combined lean as one odometer is swept through the other's, `step` metres a frame. */
function overtaking(
  where: Bend,
  rider: { readonly at: number; readonly speed: number },
  other: { readonly kind: Other['kind']; readonly speed: number },
  step: number,
): { readonly places: readonly number[]; readonly leans: readonly number[] }[] {
  const places: number[][] = [[], []];
  const leans: number[][] = [[], []];
  for (let gap = -45; gap <= 45; gap += step) {
    const odometer = rider.at + gap;
    const markers = frame(where, { odometer: rider.at, speed: rider.speed }, [
      { kind: other.kind, odometer, speed: other.speed },
    ]);
    markers.forEach((marker, index) => {
      (places[index] as number[]).push(
        drawnAlong(where.line, marker, index === 0 ? rider.at : odometer),
      );
      (leans[index] as number[]).push(Math.abs(combinedLean(marker.lean, marker.bodyLean)));
    });
  }
  return places.map((each, index) => ({ places: each, leans: leans[index] as number[] }));
}

describe('nobody jumps as one rider passes another — #2427', () => {
  const STEP = 0.05;
  const cases = [
    { rider: 30, other: 45, kind: 'bot' as const },
    { rider: 45, other: 30, kind: 'bot' as const },
    { rider: 20, other: 50, kind: 'remote' as const },
    { rider: 50, other: 20, kind: 'ghost' as const },
  ];
  it.each(BENDS.flatMap((where) => cases.map((each) => ({ where, ...each }))))(
    '$where.name: the $kind at $other km/h swept through the rider at $rider km/h moves no rider a jump in a frame, nor its lean',
    ({ where, rider, other, kind }) => {
      const at = (where.from + where.to) / 2;
      const swept = overtaking(
        where,
        { at, speed: rider * KMH },
        { kind, speed: other * KMH },
        STEP,
      );
      for (const each of swept) {
        for (let index = 1; index < each.places.length; index += 1) {
          const place = Math.abs(
            (each.places[index] as number) - (each.places[index - 1] as number),
          );
          const lean = Math.abs((each.leans[index] as number) - (each.leans[index - 1] as number));
          // A frame is 5 cm of odometer: a few centimetres of place, a fraction of a degree of lean.
          expect(
            place,
            `rider ${String(swept.indexOf(each))}’s place at step ${String(index)}: ${String(each.places[index - 1])} then ${String(each.places[index])}`,
          ).toBeLessThan(0.25);
          expect(lean, `lean at step ${String(index)}`).toBeLessThan((1 * Math.PI) / 180);
        }
      }
    },
    120_000,
  );
});

describe('only the drawing changes — #2427', () => {
  it.each(BENDS)(
    '$name: the rider is drawn exactly where their own easing puts them, with or without anyone beside them',
    (where) => {
      for (let at = where.from; at <= where.to; at += 3) {
        const speed = 30 * KMH;
        const alone = frame(where, { odometer: at, speed }, [])[0] as RiderMarker;
        const own = easedPlace(where.line, at, speed).distance;
        const point = drawnLineAt(where.line, own);
        // A lone rider on the path at their eased place, to the bit of the path's own point.
        expect([alone.x, alone.z]).toEqual([point.x, point.z]);
        // With a faster pacer just ahead the rider's own place does not move.
        const beside = frame(where, { odometer: at, speed }, [
          { kind: 'bot', odometer: at + 3, speed: 50 * KMH },
        ])[0] as RiderMarker;
        // (Beside the path when level with the pacer, so read to the millimetre.)
        expect(drawnAlong(where.line, beside, at)).toBeCloseTo(own, 3);
      }
    },
    60_000,
  );

  it('holds nobody apart who is far from everyone: more than 40 m apart, each is drawn by its own easing', () => {
    const where = BENDS[0] as Bend;
    const at = 360;
    const speed = 50 * KMH;
    const markers = frame(where, { odometer: at, speed: 20 * KMH }, [
      { kind: 'remote', odometer: at + 30 / (1 - DRAWN_ORDER_SHARE) + 1, speed },
    ]);
    const odometer = at + 30 / (1 - DRAWN_ORDER_SHARE) + 1;
    expect(drawnAlong(where.line, markers[1] as RiderMarker, odometer)).toBeCloseTo(
      easedPlace(where.line, odometer, speed).distance,
      6,
    );
  });

  it('keeps every odometer and the solo draft’s k to the bit: a solo ride behind the pacer through a hairpin, drawn in order or not drawn eased at all', () => {
    const ride = (uneased: boolean): { trace: number[]; drawn: number[] } => {
      const route = hairpinRoute(10);
      const simulation = new GameSimulation({
        profile: route,
        conditions: ridingConditions(kilograms(70), 'hoods'),
        pacer: botPacerPlan(3),
        soloDraft: {},
      });
      const origin = corridorOrigin(route);
      const trace: number[] = [];
      const drawn: number[] = [];
      // Advanced and drawn in the order `GameView`'s loop does it, a frame every 200 ms.
      for (let now = 0; now <= 120_000; now += 200) {
        simulation.advanceTo(now, { power: watts(260), live: true });
        const state = simulation.state;
        const frame = sceneFrame({
          profile: route,
          origin,
          state,
          botDistance: state.bot?.state.distance,
          uneased,
        });
        for (const marker of frame.markers) drawn.push(marker.x, marker.z);
        trace.push(
          state.ride.distance,
          state.ride.speed,
          state.bot?.state.distance ?? Number.NaN,
          simulation.draftFactor,
          state.soloDraft?.k ?? Number.NaN,
          state.soloDraft?.inDraftMetres ?? Number.NaN,
        );
      }
      expect(simulation.state.ride.distance).toBeGreaterThan(400 + 10 * Math.PI + 50);
      return { trace, drawn };
    };
    const eased = ride(false);
    const plain = ride(true);
    expect(eased.trace).toEqual(plain.trace);
    // Drafted somewhere: the solo k was not 1 throughout.
    expect(eased.trace.some((value, index) => index % 6 === 3 && value < 1)).toBe(true);
    // Non-vacuity: the two rides were DRAWN differently, so the easing ran. (This does not
    // show the ordering held anyone here: the sweeps above are what prove that.)
    expect(eased.drawn).not.toEqual(plain.drawn);
  }, 60_000);
});
