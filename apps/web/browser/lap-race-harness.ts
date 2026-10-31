// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The lap race's belt in a real WebGL context — #1902. What jsdom cannot do
 * for `lap-race-belt.test.ts`: draw and count the draw calls. The drawing is
 * `three-renderer.ts`' own (`threeGameRenderer`, `lapRaceCallsProbe`),
 * because nothing but that file may import three (`three-seam.test.ts`).
 *
 * Published on `window.__oylLapRace`:
 *
 * 1. **`viewCalls(hazards)`** — a REAL view (`threeGameRenderer.create`)
 *    drawing a real frame (`scene.ts` §`sceneFrame`, the stylised world) of
 *    the rider and seven race bots (`SceneInput.raceBots`), five of the eight
 *    hit, with every pick-up point of a three-lap race and `hazards` puddles
 *    on the road ahead (`lap-race/in-view.ts` §`lapRaceInView`): every draw
 *    call the page makes, counted at WebGL's own entry points
 *    (`realistic/draws.ts`), each frame drawn twice and the second read, so
 *    an upload is not counted as a draw. Beside it, the same eight racers
 *    with no race, and the rider alone, so what the bots cost is read too.
 * 2. **`probeCalls(world, hazards)`** — the belt alone in each world's
 *    materials, three's `renderer.info.render.calls` shown and hidden.
 * 3. **`showcase()`** — a real view's frame with a pick-up point, two puddles
 *    and two racers hit, on a canvas the spec photographs for the owner
 *    (ADR 0060 D-1: new art is proposed in its pull request).
 */

import { createItemRace, metres, raceCourse, type Hazard } from '@onyourleft/domain';

import { hitLook, lapRaceInView, laneLateral } from '../src/game/lap-race/in-view';
import type { GameView, RaceHitLook, SceneFrame } from '../src/game/port';
import { qualitySettings } from '../src/game/quality';
import { northRoute } from '../src/game/route-fixtures-testing';
import { sceneFrame, type RaceBotInput } from '../src/game/scene';
import { atStartLine } from '../src/game/simulation';
import { corridorOrigin } from '../src/game/terrain';
import {
  lapRaceCallsProbe,
  lapRaceDrawnOf,
  threeGameRenderer,
  type LapRaceCalls,
} from '../src/game/three-renderer';

import { drawCounter } from './realistic/draws';

/** What {@link viewCalls} counted. */
export interface LapRaceViewCalls {
  /** Calls for the rider alone, with no race. */
  readonly alone: number;
  /** Calls for the rider and the seven bots, with no race on the frame. */
  readonly without: number;
  /** Calls for the same eight carrying the race's pieces and five hit effects. */
  readonly with: number;
  /** What the view's belt drew of each, read back off its instances. */
  readonly drawn: Readonly<Record<'pickUps' | 'hazards' | 'hits', number>>;
  /** How many racers the frame drew. */
  readonly racers: number;
}

declare global {
  interface Window {
    __oylLapRace?: {
      readonly ready: boolean;
      viewCalls(hazards: number): LapRaceViewCalls;
      probeCalls(world: 'stylised' | 'realistic', hazards: number): LapRaceCalls;
      showcase(): void;
    };
  }
}

const counter = drawCounter(WebGL2RenderingContext.prototype);

/** A fresh canvas a call, so no reading inherits another's context. */
function canvas(width = 320, height = 180): HTMLCanvasElement {
  const made = document.createElement('canvas');
  made.width = width;
  made.height = height;
  document.body.append(made);
  return made;
}

const ROUTE = northRoute(2_000, () => 10);
const ORIGIN = corridorOrigin(ROUTE);
/** Where the rider is, and the race's start line: far enough in that the corridor runs its whole 60 m behind. */
const RIDER = 400;
/** Three laps short enough that every pick-up point is on the frame's road. */
const COURSE = raceCourse(40, 3);
/** A hit effect as `hitLook` draws one, with motion, half a second in. */
const HIT = hitLook(
  [{ rateMetresPerSecond: -2, fromMs: 0, untilMs: 4_000 }],
  500,
  false,
) as RaceHitLook;

/** Seven bots ahead of the rider, a lane each in turn, every other one hit. */
const BOTS: readonly RaceBotInput[] = Array.from({ length: 7 }, (_, index) => ({
  distanceMetres: RIDER + 6 + 4 * index,
  speedMetresPerSecond: 9,
  lateralMetres: laneLateral(index % 3),
  ...(index % 2 === 0 ? { hit: HIT } : {}),
}));

/** `count` puddles a metre apart from 10 m into the race, in turn across the three lanes. */
function puddles(count: number): readonly Hazard[] {
  return Array.from({ length: count }, (_, index) => ({
    position: 10 + index,
    lane: index % 3,
    ownerId: 'bot-1',
    untilMs: 30_000,
    hitIds: [],
  }));
}

function frameAt(bots: readonly RaceBotInput[], riderHit: RaceHitLook | undefined): SceneFrame {
  const start = atStartLine(ROUTE);
  return sceneFrame({
    profile: ROUTE,
    origin: ORIGIN,
    state: { ...start, ride: { ...start.ride, distance: metres(RIDER) } },
    raceBots: bots,
    riderHit,
  });
}

/** `frame` carrying a three-lap race's pick-up points and `hazards`. */
function racing(frame: SceneFrame, hazards: readonly Hazard[]): SceneFrame {
  const race = createItemRace({
    course: COURSE,
    seed: 1,
    itemsOn: true,
    racerIds: ['rider', ...BOTS.map((_, index) => `bot-${index + 1}`)],
    startMs: 0,
  });
  return {
    ...frame,
    lapRace: lapRaceInView({
      corridor: frame.corridor,
      race: { ...race, hazards },
      startAlong: RIDER,
    }),
  };
}

/** Every draw call one render of `frame` makes, the second of two. */
function callsOf(view: GameView, frame: SceneFrame): number {
  view.render(frame);
  counter.takeCalls();
  view.render(frame);
  return counter.takeCalls();
}

function viewCalls(hazards: number): LapRaceViewCalls {
  const view = threeGameRenderer.create(canvas(), qualitySettings(0));
  view.resize(320, 180);
  const alone = callsOf(view, frameAt([], undefined));
  // The same eight, none of them hit.
  const eight = frameAt(
    BOTS.map((bot) => ({ ...bot, hit: undefined })),
    undefined,
  );
  const without = callsOf(view, eight);
  const raced = racing(frameAt(BOTS, HIT), puddles(hazards));
  const withRace = callsOf(view, raced);
  const drawn = {
    pickUps: lapRaceDrawnOf(view, 'pickUps').length,
    hazards: lapRaceDrawnOf(view, 'hazards').length,
    hits: lapRaceDrawnOf(view, 'hits').length,
  };
  view.destroy();
  return { alone, without, with: withRace, drawn, racers: raced.markers.length };
}

function probeCalls(world: 'stylised' | 'realistic', hazards: number): LapRaceCalls {
  const frame = racing(frameAt(BOTS, HIT), puddles(hazards));
  return lapRaceCallsProbe(canvas(64, 32), world, frame.lapRace!, frame.markers);
}

/** One frame for the owner's photograph: a pick-up point, two puddles, two racers hit. */
function showcase(): void {
  const shown = canvas(960, 540);
  shown.id = 'lap-race-showcase';
  const view = threeGameRenderer.create(shown, qualitySettings(0));
  view.resize(960, 540);
  const bots: RaceBotInput[] = [
    { distanceMetres: RIDER + 5, speedMetresPerSecond: 9, lateralMetres: laneLateral(0), hit: HIT },
    { distanceMetres: RIDER + 12, speedMetresPerSecond: 9, lateralMetres: laneLateral(2) },
  ];
  const start = atStartLine(ROUTE);
  const frame = sceneFrame({
    profile: ROUTE,
    origin: ORIGIN,
    state: { ...start, ride: { ...start.ride, distance: metres(RIDER) } },
    raceBots: bots,
    riderHit: HIT,
  });
  const race = createItemRace({
    course: raceCourse(400, 3),
    seed: 1,
    itemsOn: true,
    racerIds: ['rider', 'bot-1', 'bot-2'],
    startMs: 0,
  });
  // The race started 92 m back, so its first pick-up point, a quarter of a
  // 400 m lap in, stands 8 m ahead of the rider, with a puddle on it in two lanes.
  const hazards: Hazard[] = [
    { position: 100, lane: 1, ownerId: 'bot-2', untilMs: 30_000, hitIds: [] },
    { position: 100, lane: 2, ownerId: 'bot-2', untilMs: 30_000, hitIds: [] },
  ];
  view.render({
    ...frame,
    lapRace: lapRaceInView({
      corridor: frame.corridor,
      race: { ...race, hazards },
      startAlong: RIDER - 92,
    }),
  });
}

window.__oylLapRace = { ready: true, viewCalls, probeCalls, showcase };
