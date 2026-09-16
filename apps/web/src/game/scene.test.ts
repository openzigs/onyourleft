// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where the three markers go, and where the camera looks.
 *
 * This is the half of the renderer that jsdom can check. `three-renderer.ts`
 * turns the result into pixels and the browser gate checks that it can; nothing
 * about *placement* needs a GL context, so none of it is deferred there.
 */

import { describe, expect, it } from 'vitest';

import { gapAgainst } from './hud/fields';
import type { RiderMarker, SceneFrame } from './port';
import { SCATTER_MAX_ITEMS, type ScatterItem } from './scatter';
import { cameraPose, ghostFinished, sceneFrame } from './scene';
import { VIEW_AHEAD_METRES, VIEW_BEHIND_METRES, corridorOrigin, roadCorridor } from './terrain';
import {
  GameSimulation,
  MAXIMUM_STEPS_PER_ADVANCE,
  SIMULATION_STEP_SECONDS,
  atStartLine,
  type GameState,
  type SimulationSetup,
} from './simulation';
import {
  altitudeMetres,
  buildGhostTrack,
  degreesCelsius,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  kilograms,
  metres,
  pacerGap,
  routeProfile,
  seconds,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';
import { airDensityKilogramsPerCubicMetre } from '@onyourleft/physics';

function straightRoute(): SimulationSetup {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 200; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index * 0.2),
    });
  }
  return {
    profile: routeProfile(points),
    conditions: {
      totalMass: kilograms(80),
      airDensityKilogramsPerCubicMetre: airDensityKilogramsPerCubicMetre(
        altitudeMetres(0),
        degreesCelsius(15),
      ),
    },
  };
}

/**
 * A square loop, so an odometer past `totalDistance` has somewhere to wrap to.
 *
 * ⚠️ **The fixture this file did not have, and #253 is what that cost.** Every
 * route fixture in the pacer work is point-to-point — `routeProfile` defaults
 * `loop` to `false` — so the wrap the corridor and the odometers disagree about
 * was exercised nowhere, and the bot and the rider collapsed onto one point from
 * lap two of a real loop onward. Four hundred metres a side is long enough that
 * a hundred metres of separation is unambiguous and short enough that lap two
 * arrives in one test.
 */
function loopRoute(): SimulationSetup {
  const side = 400;
  const spacing = 10;
  const corners: [number, number][] = [
    [0, 0],
    [0, side],
    [side, side],
    [side, 0],
  ];
  const perDegreeLongitude = 111_320 * Math.cos((51.5 * Math.PI) / 180);
  const points: RoutePoint[] = [];
  for (let leg = 0; leg < corners.length; leg += 1) {
    const from = corners[leg] as [number, number];
    const to = corners[(leg + 1) % corners.length] as [number, number];
    const steps = side / spacing;
    for (let step = 0; step < steps; step += 1) {
      points.push({
        position: geographicPosition(
          degreesLatitude(51.5 + (from[0] + ((to[0] - from[0]) * step) / steps) / 111_320),
          degreesLongitude(
            -0.12 + (from[1] + ((to[1] - from[1]) * step) / steps) / perDegreeLongitude,
          ),
        ),
        elevation: altitudeMetres(0),
      });
    }
  }
  return {
    profile: routeProfile(points, { loop: true }),
    conditions: {
      totalMass: kilograms(80),
      airDensityKilogramsPerCubicMetre: airDensityKilogramsPerCubicMetre(
        altitudeMetres(0),
        degreesCelsius(15),
      ),
    },
  };
}

const GHOST = buildGhostTrack({
  elapsedSeconds: [0, 10, 20, 30, 40],
  distanceMetres: [0, 60, 130, 210, 300],
});

describe('the frame carries every rider that is in play', () => {
  it('always places the rider', () => {
    const setup = straightRoute();
    const frame = sceneFrame({
      profile: setup.profile,
      origin: corridorOrigin(setup.profile),
      state: atStartLine(setup.profile),
    });

    expect(frame.markers.map((marker) => marker.kind)).toEqual(['rider']);
  });

  it('places the bot and the ghost when both are chosen', () => {
    const setup = straightRoute();
    const frame = sceneFrame({
      profile: setup.profile,
      origin: corridorOrigin(setup.profile),
      state: atStartLine(setup.profile),
      botDistance: 120,
      ghost: GHOST,
    });

    expect(frame.markers.map((marker) => marker.kind).sort()).toEqual(['bot', 'ghost', 'rider']);
  });

  it('omits the ghost entirely when the rider has no previous attempt', () => {
    // #93's fourth criterion: no ghost rather than an empty one sitting on the
    // start line pretending to be a rider.
    const setup = straightRoute();
    const frame = sceneFrame({
      profile: setup.profile,
      origin: corridorOrigin(setup.profile),
      state: atStartLine(setup.profile),
      ghost: undefined,
    });

    expect(frame.markers.some((marker) => marker.kind === 'ghost')).toBe(false);
  });

  it('gives every marker a finite position', () => {
    const setup = straightRoute();
    const frame = sceneFrame({
      profile: setup.profile,
      origin: corridorOrigin(setup.profile),
      state: atStartLine(setup.profile),
      botDistance: 5_000,
      ghost: GHOST,
    });

    for (const marker of frame.markers) {
      expect(Number.isFinite(marker.x)).toBe(true);
      expect(Number.isFinite(marker.y)).toBe(true);
      expect(Number.isFinite(marker.z)).toBe(true);
    }
  });
});

/**
 * A ride `t` seconds in, with nothing stalled.
 *
 * ⚠️ **Both clocks, set to the same number, and that is the point** — #254.
 * `elapsed` is the wall clock and `ridden` is what was actually integrated, and
 * on an ordinary ride they are equal. A fixture that set only one of them would
 * be asserting against a state the simulation cannot produce.
 */
function atRaceTime(base: GameState, atSeconds: number): GameState {
  return { ...base, elapsed: seconds(atSeconds), ridden: seconds(atSeconds) };
}

describe('the ghost is raced, not merely replayed alongside', () => {
  it('moves the ghost to where it was at this point in the race', () => {
    const setup = straightRoute();
    const origin = corridorOrigin(setup.profile);
    const simulation = new GameSimulation(setup);
    simulation.advanceTo(0, { power: watts(200), live: true });

    const early = sceneFrame({
      profile: setup.profile,
      origin,
      state: atRaceTime(simulation.state, 5),
      ghost: GHOST,
    });
    const later = sceneFrame({
      profile: setup.profile,
      origin,
      state: atRaceTime(simulation.state, 30),
      ghost: GHOST,
    });

    const earlyGhost = early.markers.find((marker) => marker.kind === 'ghost');
    const laterGhost = later.markers.find((marker) => marker.kind === 'ghost');
    // The ghost covered ground between the two moments, so its marker moved.
    expect(laterGhost?.z).toBeGreaterThan(earlyGhost?.z ?? 0);
  });

  it('leaves the ghost at its finishing distance rather than removing it', () => {
    const setup = straightRoute();
    const state = atRaceTime(atStartLine(setup.profile), 600);
    const frame = sceneFrame({
      profile: setup.profile,
      origin: corridorOrigin(setup.profile),
      state,
      ghost: GHOST,
    });

    expect(frame.markers.some((marker) => marker.kind === 'ghost')).toBe(true);
    expect(ghostFinished(GHOST, state)).toBe(true);
  });
});

/**
 * The seam #254 was, driven end to end — a real {@link GameSimulation} stalled
 * for five minutes, and a real {@link sceneFrame} built from what it says.
 *
 * ⚠️ **Nothing below could be caught one file at a time, which is why it
 * shipped.** `ghostDistanceAt` is right, {@link MAXIMUM_STEPS_PER_ADVANCE} is
 * right, and crediting the whole outstanding amount to the clock is right. The
 * defect was only in how they met, so the fixture has to be a simulation that
 * has actually stalled rather than a hand-written state.
 */
describe('a stall does not hand the ghost road the rider never rode (#254)', () => {
  const PEDALLING = { power: watts(200), live: true };

  /** Five minutes backgrounded, from one `advanceTo` to the next. */
  function stalledRide(setup: SimulationSetup): GameSimulation {
    const simulation = new GameSimulation(setup);
    simulation.advanceTo(0, PEDALLING);
    simulation.advanceTo(300_000, PEDALLING);
    return simulation;
  }

  /** The same ride, never backgrounded, run for the seconds the bound allows. */
  function unstalledRide(setup: SimulationSetup): GameSimulation {
    const simulation = new GameSimulation(setup);
    simulation.advanceTo(0, PEDALLING);
    const boundMs = MAXIMUM_STEPS_PER_ADVANCE * SIMULATION_STEP_SECONDS * 1000;
    for (let nowMs = 250; nowMs <= boundMs; nowMs += 250) {
      simulation.advanceTo(nowMs, PEDALLING);
    }
    return simulation;
  }

  function ghostMarker(setup: SimulationSetup, state: GameState): RiderMarker | undefined {
    return sceneFrame({
      profile: setup.profile,
      origin: corridorOrigin(setup.profile),
      state,
      ghost: GHOST,
    }).markers.find((marker) => marker.kind === 'ghost');
  }

  it('leaves the ghost where an unstalled ride of the same ridden time leaves it', () => {
    const setup = straightRoute();
    const stalled = stalledRide(setup);
    const smooth = unstalledRide(setup);

    // The two rides differ on the wall clock by the whole stall…
    expect(stalled.state.elapsed).toBeGreaterThan(smooth.state.elapsed + 280);
    // …and agree exactly on the road, which is #91's decoupling holding.
    expect(stalled.state.ridden).toBe(smooth.state.ridden);
    expect(stalled.state.ride.distance).toBe(smooth.state.ride.distance);

    // So the ghost is in the same place too, which is the criterion.
    expect(ghostMarker(setup, stalled.state)).toEqual(ghostMarker(setup, smooth.state));
  });

  it('does not place the ghost where the wall clock would have put it', () => {
    const setup = straightRoute();
    const stalled = stalledRide(setup);

    // The state the defect produced: the racing clock carrying the whole stall.
    // Asserting the difference is what stops the test above passing vacuously —
    // two markers can agree because both are clamped to the same corridor end.
    const onTheWallClock = { ...stalled.state, ridden: stalled.state.elapsed };

    expect(ghostMarker(setup, stalled.state)).not.toEqual(ghostMarker(setup, onTheWallClock));
  });

  it('does not declare the attempt finished on time the rider never rode', () => {
    const setup = straightRoute();
    const stalled = stalledRide(setup);

    // GHOST lasts 40 s. Five minutes of wall clock is past that; ten seconds of
    // riding is not, and the rider is still racing it.
    expect(stalled.state.elapsed).toBeGreaterThan(GHOST.totalTime);
    expect(stalled.state.ridden).toBeLessThan(GHOST.totalTime);
    expect(ghostFinished(GHOST, stalled.state)).toBe(false);
  });
});

describe('the chase camera', () => {
  it('faces the way the road goes', () => {
    const setup = straightRoute();
    const frame = sceneFrame({
      profile: setup.profile,
      origin: corridorOrigin(setup.profile),
      state: atStartLine(setup.profile),
    });

    // The route runs due north, so the heading is +z and not -z.
    expect(frame.camera.headingZ).toBeGreaterThan(0.9);
    expect(Math.abs(frame.camera.headingX)).toBeLessThan(0.1);
  });

  it('faces the way the road goes on a route that does not run north', () => {
    // ⚠️ **The test above passes for the wrong reason and cannot notice.** Its
    // fixture runs due north, which is also the arbitrary heading `cameraPose`
    // falls back to when it has no next point to take a direction from — so a
    // camera that had given up and a camera that had read the road were
    // indistinguishable in it.
    //
    // They were not the same thing. Before #253 every corridor point behind a
    // point-to-point route's start clamped to a route distance of nought, so
    // the search for the rider's own odometer stopped at the FIRST of them and
    // `centre[index + 1]` was the identical clamped point. A rider on an
    // east-running route was given a camera looking north — sideways at the
    // road — for the first sixty metres of every ride. Matching on the
    // unwrapped odometer picks the point the rider is actually at, and its
    // neighbour is a real one.
    const perDegreeLongitude = 111_320 * Math.cos((51.5 * Math.PI) / 180);
    const points: RoutePoint[] = [];
    for (let index = 0; index <= 200; index += 1) {
      points.push({
        position: geographicPosition(
          degreesLatitude(51.5),
          degreesLongitude(-0.12 + (index * 10) / perDegreeLongitude),
        ),
        elevation: altitudeMetres(0),
      });
    }
    const profile = routeProfile(points);

    const frame = sceneFrame({
      profile,
      origin: corridorOrigin(profile),
      state: atStartLine(profile),
    });

    expect(frame.camera.headingX).toBeGreaterThan(0.9);
    expect(Math.abs(frame.camera.headingZ)).toBeLessThan(0.1);
  });

  it('never produces a degenerate heading, which renders as a black screen', () => {
    // A corridor of one point has no next point to take a direction from. `three`
    // resolves a zero-length look-at to NaN and draws nothing.
    const setup = straightRoute();
    const corridor = {
      centre: [{ x: 0, y: 0, z: 0, distance: 0, along: 0 }],
      vertices: new Float32Array(6),
      colours: new Float32Array(6),
      indices: new Uint32Array(0),
      quadCount: 0,
    };
    const pose = cameraPose(corridor, 0);

    expect(Number.isFinite(pose.headingX)).toBe(true);
    expect(Number.isFinite(pose.headingZ)).toBe(true);
    expect(Math.hypot(pose.headingX, pose.headingZ)).toBeCloseTo(1, 6);
    expect(setup.profile.totalDistance).toBeGreaterThan(0);
  });
});

describe('a loop, once the rider has been round once (#253)', () => {
  /** Where a marker of a kind ended up, in the corridor's local metres. */
  function placed(frame: SceneFrame, kind: RiderMarker['kind']): readonly [number, number] {
    const marker = frame.markers.find((each) => each.kind === kind);
    expect(marker).toBeDefined();
    return [marker?.x ?? Number.NaN, marker?.z ?? Number.NaN];
  }

  /** How far apart two placements are, on the ground. */
  function apart(a: readonly [number, number], b: readonly [number, number]): number {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  }

  /** The rider `odometer` metres in, with a bot a hundred metres up the road. */
  function frameAt(setup: SimulationSetup, odometer: number): SceneFrame {
    const base = atStartLine(setup.profile);
    return sceneFrame({
      profile: setup.profile,
      origin: corridorOrigin(setup.profile),
      state: { ...base, ride: { ...base.ride, distance: metres(odometer) } },
      botDistance: odometer + 100,
    });
  }

  it('draws the rider and the bot in two places, not one', () => {
    // ⚠️ The defect in one assertion. Both odometers are unwrapped and every
    // corridor point's route distance was wrapped, so from lap two onward every
    // point compared smaller than the value being searched for and BOTH markers
    // landed on the corridor's far end — two riders, one place, for the rest of
    // the ride.
    const setup = loopRoute();
    const total: number = setup.profile.totalDistance;

    const frame = frameAt(setup, total + 200);

    const between = apart(placed(frame, 'rider'), placed(frame, 'bot'));
    expect(between).toBeGreaterThan(50);
    expect(between).toBeLessThan(150);
  });

  it('draws them where lap one drew them, because a loop comes back round', () => {
    const setup = loopRoute();
    const total: number = setup.profile.totalDistance;

    const lapOne = frameAt(setup, 200);
    const lapTwo = frameAt(setup, total + 200);

    expect(apart(placed(lapOne, 'rider'), placed(lapTwo, 'rider'))).toBeLessThan(1);
    expect(apart(placed(lapOne, 'bot'), placed(lapTwo, 'bot'))).toBeLessThan(1);
    // And the camera goes with them, rather than being left at the far end of
    // the corridor looking at road the rider is nowhere near. It is placed by
    // the same lookup, so it failed in the same way and is fixed by the same
    // line — which is exactly why it is asserted here rather than assumed.
    expect(
      Math.hypot(lapOne.camera.x - lapTwo.camera.x, lapOne.camera.z - lapTwo.camera.z),
    ).toBeLessThan(1);
  });

  it('leaves the odometers unwrapped, so the HUD still reads a lap as a lap', () => {
    // ⚠️ #253's second acceptance criterion, and the same bug facing the other
    // way: wrapping the odometer would place the markers correctly and make a
    // bot about to lap the rider read as level with them. `pacer/gap.ts`'s
    // header argues the whole case; this is the assertion that stops the fix
    // being applied on the wrong side of the seam, in the package that would
    // apply it.
    const setup = loopRoute();
    const total: number = setup.profile.totalDistance;
    const base = atStartLine(setup.profile);
    const state = { ...base, ride: { ...base.ride, distance: metres(200) } };

    const gap = pacerGap(gapAgainst(state, 200 + total));

    expect(gap.metres).toBeCloseTo(total, 6);
  });
});

describe('the frame carries the scenery for the road it drew', () => {
  function frameAt(setup: SimulationSetup, odometer: number): SceneFrame {
    const base = atStartLine(setup.profile);
    return sceneFrame({
      profile: setup.profile,
      origin: corridorOrigin(setup.profile),
      state: { ...base, ride: { ...base.ride, distance: metres(odometer) } },
    });
  }

  /** Where a frame's scatter sits along the route: the fixture runs north. */
  function reach(frame: SceneFrame): { readonly nearest: number; readonly furthest: number } {
    const zs = frame.scatter.map((item) => item.z);
    return { nearest: Math.min(...zs), furthest: Math.max(...zs) };
  }

  it('places scenery beside a road that has some', () => {
    // ⚠️ The whole point of asserting this in `scene.ts` rather than only in
    // `scatter.test.ts`: a `sceneFrame` that carried `scatter: []` would leave
    // every assertion in that file green and put nothing on screen. #240 names
    // that defect shape for this epic and `port.ts` repeats it.
    const setup = straightRoute();

    expect(frameAt(setup, 0).scatter.length).toBeGreaterThan(0);
  });

  it('never hands the renderer more than the budget', () => {
    const setup = straightRoute();

    expect(frameAt(setup, 600).scatter.length).toBeLessThanOrEqual(SCATTER_MAX_ITEMS);
  });

  it('covers the corridor it built and not some other stretch of road', () => {
    // The span is taken from the corridor's own first and last points, so the
    // scenery moves with the rider by construction. A frame 600 m up the road
    // that still carried the start line's trees would be a world that scrolled
    // without moving.
    const setup = straightRoute();
    const atStart = reach(frameAt(setup, 0));
    const alongTheWay = reach(frameAt(setup, 600));

    expect(atStart.furthest).toBeLessThan(VIEW_AHEAD_METRES + 20);
    expect(alongTheWay.nearest).toBeGreaterThan(600 - VIEW_BEHIND_METRES - 20);
    expect(alongTheWay.furthest).toBeLessThan(600 + VIEW_AHEAD_METRES + 20);
  });

  it('gives one place one world, however many times it is asked', () => {
    const setup = straightRoute();

    expect(frameAt(setup, 600).scatter).toEqual(frameAt(setup, 600).scatter);
  });

  it('brings the same scenery back round on lap two of a loop', () => {
    // The seam, through the frame: a rider rejoining a loop rides past the
    // trees they rode past on lap one. #243's own criterion is asserted on
    // `scatterAt`; this is the one that says `scene.ts` passes it odometers it
    // can wrap rather than something it has already wrapped itself.
    const setup = loopRoute();
    const total: number = setup.profile.totalDistance;

    const lapOne = frameAt(setup, 200).scatter;
    const lapTwo = frameAt(setup, total + 200).scatter;

    expect(lapOne.length).toBeGreaterThan(0);
    expect(lapTwo.length).toBe(lapOne.length);
    expect(lapTwo.map((item) => item.kind)).toEqual(lapOne.map((item) => item.kind));
    for (let index = 0; index < lapOne.length; index += 1) {
      const one = lapOne[index] as ScatterItem;
      const two = lapTwo[index] as ScatterItem;
      expect(Math.hypot(one.x - two.x, one.z - two.z)).toBeLessThan(1);
    }
  });
});

/**
 * A marker slides along the road rather than snapping to a corridor point —
 * #323.
 *
 * ⚠️ **The other half of "the world steps rather than moves", and the half
 * that decides whether interpolating the *simulation* is visible at all.**
 * `markerAt` placed a marker at the corridor point nearest its distance, so a
 * bot or a ghost moved in whole corridor points — about ten metres at a
 * route's nominal grid. Handing it a distance interpolated between two
 * simulation steps, a centimetre at a time, would have changed nothing on
 * screen for a second at a time and then jumped: the interpolation would have
 * been computed, tested, green, and thrown away by the next function down.
 * That is this repository's own named defect shape (`port.ts`, #240) reached
 * from inside `game/`.
 *
 * The rider's own marker was the exception, and it is why this was hard to
 * see: the corridor is *built* from the rider's distance, so a point lands on
 * the rider by construction and only the bot and the ghost were coarse.
 */
describe('a marker slides along the road rather than snapping to a corridor point — #323', () => {
  const setup = straightRoute();
  const origin = corridorOrigin(setup.profile);

  /** A frame with the rider at 100 m and the bot wherever it is asked for. */
  function botAt(distance: number): RiderMarker {
    const base = atStartLine(setup.profile);
    const frame = sceneFrame({
      profile: setup.profile,
      origin,
      state: { ...base, ride: { ...base.ride, distance: metres(100) } },
      botDistance: distance,
    });
    const marker = frame.markers.find((each) => each.kind === 'bot');
    expect(marker).toBeDefined();
    return marker as RiderMarker;
  }

  it('moves the bot for a step far smaller than the corridor’s own spacing', () => {
    // Two metres, against a corridor sampled every ten. Snapping to the
    // nearest point puts both in exactly the same place.
    const from = botAt(200);
    const to = botAt(202);

    const moved = Math.hypot(to.x - from.x, to.z - from.z);
    expect(moved).toBeGreaterThan(1.9);
    expect(moved).toBeLessThan(2.1);
  });

  it('places it in proportion between the two points either side', () => {
    const before = botAt(200);
    const after = botAt(210);
    const between = botAt(205);

    expect(between.z).toBeCloseTo((before.z + after.z) / 2, 3);
    expect(between.x).toBeCloseTo((before.x + after.x) / 2, 3);
  });

  it('anchors the camera on the rider, not on the corridor point nearest them', () => {
    // ⚠️ **Sub-step, and a test is the only thing that says which of the two it
    // is.** The corridor is built *from* the rider's distance, so the point
    // before them sits at a FIXED offset — it moves one-for-one with the rider
    // and a camera placed on it is just as smooth. It is simply in the wrong
    // place, by up to one corridor step, and nothing about motion can see
    // that. `cameraPose` returning the interpolated position rather than the
    // point it follows is what this pins.
    const base = atStartLine(setup.profile);
    const frame = sceneFrame({
      profile: setup.profile,
      origin,
      state: { ...base, ride: { ...base.ride, distance: metres(107.3) } },
    });
    const rider = frame.markers.find((each) => each.kind === 'rider');

    expect(frame.camera.x).toBeCloseTo(rider?.x ?? Number.NaN, 6);
    expect(frame.camera.y).toBeCloseTo(rider?.y ?? Number.NaN, 6);
    expect(frame.camera.z).toBeCloseTo(rider?.z ?? Number.NaN, 6);
  });

  it('keeps a heading at the corridor’s far end, where the position stops moving', () => {
    // ⚠️ The degenerate-heading case, reached from the direction interpolation
    // opens: at the far end the placement clamps, so a heading measured from
    // the *interpolated* point to the next one is zero-length and falls
    // through to the arbitrary north below — a camera that swings sideways for
    // a rider at the end of a point-to-point route. Measuring it between the
    // two corridor points either side cannot become degenerate that way.
    const perDegreeLongitude = 111_320 * Math.cos((51.5 * Math.PI) / 180);
    const points: RoutePoint[] = [];
    for (let index = 0; index <= 200; index += 1) {
      points.push({
        position: geographicPosition(
          degreesLatitude(51.5),
          degreesLongitude(-0.12 + (index * 10) / perDegreeLongitude),
        ),
        elevation: altitudeMetres(0),
      });
    }
    const profile = routeProfile(points);
    const corridor = roadCorridor(profile, corridorOrigin(profile), 100);
    const farEnd = corridor.centre[corridor.centre.length - 1];

    const pose = cameraPose(corridor, (farEnd?.along ?? 0) + 50);

    // The route runs due east, and so does the camera at its far end.
    expect(pose.headingX).toBeGreaterThan(0.9);
    expect(Math.abs(pose.headingZ)).toBeLessThan(0.1);
  });

  it('still clamps a bot beyond the corridor to its far end rather than extrapolating', () => {
    // `markerAt`'s own promise, unchanged: a rider far enough ahead to be
    // outside the built corridor is drawn at its far end rather than floating
    // in space beyond it, and the exact gap is the HUD's job.
    const beyond = botAt(5_000);
    const further = botAt(50_000);

    expect(beyond).toEqual(further);
    const base = atStartLine(setup.profile);
    const frame = sceneFrame({
      profile: setup.profile,
      origin,
      state: { ...base, ride: { ...base.ride, distance: metres(100) } },
    });
    const farEnd = frame.corridor.centre[frame.corridor.centre.length - 1];
    expect(beyond.z).toBeCloseTo(farEnd?.z ?? Number.NaN, 6);
  });
});
