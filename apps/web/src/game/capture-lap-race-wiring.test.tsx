// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #3198: the demo video's lap race shows a race. The `lap-race` capture scene
 * (`capture-scene.ts`) is ridden as the capture tool rides it — its fragment
 * opened, *Ride* pressed on the shipped Bellwether Loop, the clock stepped a
 * frame at a time — through the real `GameView`, at the scene's scripted
 * power against its seeded `brisk` field, for as long as `--script youtube`
 * (`tools/capture/scripts/youtube.ts`) writes it. Read back from what the
 * renderer is handed on every frame, and from the race the frame was drawn
 * from:
 *
 * - **a bot is in the frame on every captioned frame**: drawn whole, inside a
 *   16 : 9 frame (the render's 1920×1080), no further than
 *   {@link IN_FRAME_METRES} from the eye;
 * - **an attack or a chase is in the frame on every frame of the tactics
 *   caption**: a bot in one of those states, by the same test;
 * - **no frame of the scene draws a rider the near plane cuts**: every bot
 *   whose body the solid between the eye and the near plane meets
 *   (`rider-box-testing.ts`) is faded out (`rider-fade.ts`).
 *
 * At {@link FPS} frames a second, the issue's preview's, rather than the
 * render's 60: the race steps at the simulation's 20 Hz whatever the frame
 * rate, and the power is read once a frame, so a higher rate rides the same
 * race to within the script's rounding. A frame between two of these is not
 * asked about.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { racePosition, type BotTactic } from '@onyourleft/domain';

import { installCaptureClock } from '../../tools/capture/capture-clock';
import { captureHash, captureRideName } from '../../tools/capture/capture-args';
import { YOUTUBE_SCRIPT } from '../../tools/capture/scripts/youtube';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { cameraRig, projectToFrame } from './camera';
import { CAPTURE_MODE, type CaptureTarget } from './capture-scene';
import { loadBuiltInCircuits } from './circuits/circuits';
import { GameView, type GamePort } from './GameView';
import { LAP_RACE_RIDER_ID, type LapRaceDrawing, type LapRaceRide } from './lap-race/ride-race';
import { nearPyramid } from './near-field';
import type { GameRenderer, RiderMarker, SceneFrame } from './port';
import { riderBoxCut } from './rider-box-testing';
import { emptyRiderFadeLine, riderFaded, riderFadeLine } from './rider-fade';
import { NO_SENSORS } from './sensors';
import { SHIPPED_LEVELS } from './shipped-levels';

/** The race as it stood after each step, and the drawing each frame was made from. */
const stepped: LapRaceRide[] = [];
const drawn: LapRaceDrawing[] = [];
vi.mock('./lap-race/ride-race', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lap-race/ride-race')>();
  return {
    ...actual,
    stepLapRaceRide: (...args: Parameters<typeof actual.stepLapRaceRide>) => {
      const ride = actual.stepLapRaceRide(...args);
      stepped.push(ride);
      return ride;
    },
    lapRaceDrawing: (...args: Parameters<typeof actual.lapRaceDrawing>) => {
      const drawing = actual.lapRaceDrawing(...args);
      drawn.push(drawing);
      return drawing;
    },
  };
});

/** The issue's preview's frame rate. */
const FPS = 5;
/** The render's frame: 1920×1080. */
const ASPECT = 16 / 9;
/** How far from the eye a bot still reads as a rider in a 1080p frame, metres. */
const IN_FRAME_METRES = 30;
/** How far above its road a bot is asked about: its back, between hips and shoulders. */
const BODY_METRES = 1.1;
/** What a bot attacking or chasing is in. */
const MOVES: readonly BotTactic[] = ['attack', 'chase'];

/** One frame the renderer was handed: its second of the ride, and the race it was drawn from. */
interface Drawn {
  readonly second: number;
  readonly frame: SceneFrame;
  readonly ride: LapRaceRide | undefined;
  readonly drawing: LapRaceDrawing | undefined;
}

const SCENE = YOUTUBE_SCRIPT.scenes.find((scene) => scene.capture === 'lap-race');
if (SCENE === undefined) throw new Error('the youtube script has a lap race');
const FROM = SCENE.from ?? 0;
const UNTIL = FROM + SCENE.seconds;
const TACTICS = SCENE.captions.find((caption) => caption.text.startsWith('Bots that'));
if (TACTICS === undefined) throw new Error('the lap race has its tactics caption');

/** Whether `second` of the ride is under a caption of the scene, or under `only`. */
function captioned(second: number, only = SCENE?.captions ?? []): boolean {
  return only.some(
    (caption) => second >= FROM + caption.at && second <= FROM + caption.at + caption.seconds,
  );
}

let mounted: Mounted | undefined;

beforeEach(() => {
  stepped.length = 0;
  drawn.length = 0;
  vi.stubEnv('MODE', CAPTURE_MODE);
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  globalThis.location.hash = '';
  delete (globalThis as CaptureTarget).__oylCapture;
});

/**
 * The scene, captured as `capture-modes-wiring.test.tsx` captures one, for
 * every frame to {@link UNTIL}: each frame the renderer was handed with the
 * newest race and drawing before it.
 */
async function ride(): Promise<readonly Drawn[]> {
  let nextFrame = 0;
  const target = {
    performance: { now: () => 0 },
    Date,
    requestAnimationFrame: (): number => (nextFrame += 1),
    cancelAnimationFrame: () => undefined,
    setTimeout: (handler: unknown, timeout?: number) =>
      setTimeout(handler as () => void, timeout) as unknown as number,
    clearTimeout: (handle?: number) => {
      clearTimeout(handle);
    },
    setInterval: (handler: unknown, timeout?: number) =>
      setInterval(handler as () => void, timeout) as unknown as number,
    clearInterval: (handle?: number) => {
      clearInterval(handle);
    },
  };
  const clock = installCaptureClock(target);
  vi.stubGlobal('requestAnimationFrame', target.requestAnimationFrame);
  vi.stubGlobal('cancelAnimationFrame', target.cancelAnimationFrame);
  let second = 0;
  const frames: Drawn[] = [];
  const port: GamePort = {
    listRoutes: () => Promise.resolve([]),
    listCircuits: () => loadBuiltInCircuits(),
    listDeliveryLevels: () => Promise.resolve(SHIPPED_LEVELS.list()),
    loadDeliveryLevel: (id) => SHIPPED_LEVELS.load(id),
    loadGhost: () => Promise.resolve(undefined),
    loadRiderGhost: () => Promise.resolve({ kind: 'unavailable' }),
    readSensors: () => NO_SENSORS,
  };
  const renderer: GameRenderer = {
    loadRealisticWorld: () => Promise.resolve({ loaded: true }),
    create: () => ({
      hasContext: true,
      prepare: () => Promise.resolve(),
      render: (frame) => {
        frames.push({ second, frame, ride: stepped.at(-1), drawing: drawn.at(-1) });
      },
      setQuality: () => undefined,
      setRiderKit: () => undefined,
      setSeason: () => undefined,
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };
  globalThis.location.hash = captureHash('lap-race');
  // No mass: the capture's browser has no athlete, so the default 71 kg.
  mounted = await mount(
    <GameView
      port={port}
      renderer={() => Promise.resolve(renderer)}
      now={() => target.performance.now()}
    />,
  );
  const name = `Ride ${captureRideName('lap-race')}`;
  const button = (): HTMLButtonElement | undefined =>
    queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find(
      (each) => each.textContent === name,
    );
  for (let tries = 0; tries < 40 && button() === undefined; tries += 1) await settle();
  expect(button(), name).toBeDefined();
  clock.hold();
  await act(async () => {
    button()?.click();
    await Promise.resolve();
  });
  await settle();
  const published = (): CaptureTarget['__oylCapture'] => (globalThis as CaptureTarget).__oylCapture;
  for (let tries = 0; tries < 40 && (published()?.drawn ?? 0) === 0; tries += 1) {
    await act(async () => {
      clock.frame();
      await Promise.resolve();
    });
    await settle();
  }
  expect(published()?.drawn).toBe(1);
  for (let frame = 1; frame <= UNTIL * FPS; frame += 1) {
    second = frame / FPS;
    await act(async () => {
      clock.step(1000 / FPS);
      await Promise.resolve();
    });
    await settle();
  }
  return frames.filter((each) => each.second >= FROM && each.second <= UNTIL);
}

/** Whether `marker` is drawn whole inside the frame, near enough to read as a rider. */
function inFrame(frame: SceneFrame, marker: RiderMarker): boolean {
  const line = riderFadeLine(frame.camera, frame.markers, emptyRiderFadeLine());
  const seen = projectToFrame(cameraRig(frame.camera), ASPECT, {
    x: marker.x,
    y: marker.y + BODY_METRES,
    z: marker.z,
  });
  return (
    seen !== undefined &&
    seen.left > 0 &&
    seen.left < 1 &&
    seen.top > 0 &&
    seen.top < 1 &&
    seen.depth <= IN_FRAME_METRES &&
    riderFaded(marker, line) === 0
  );
}

function bots(frame: SceneFrame): readonly RiderMarker[] {
  return frame.markers.filter((marker) => marker.kind === 'bot');
}

/**
 * The bot markers of the bots in `tactics` on this frame. A drawn bot is
 * matched to its marker by its place in the order the field is drawn in from
 * the back to the front: the drawing's by distance along the road, the
 * markers' by how far each is along the rider's heading, which a bend shortens
 * but, over the few tens of metres a field spans, does not reorder.
 */
function botsIn(each: Drawn, tactics: readonly BotTactic[]): readonly RiderMarker[] {
  const { frame, ride, drawing } = each;
  const rider = frame.markers.find((marker) => marker.kind === 'rider');
  if (ride === undefined || drawing === undefined || rider === undefined) return [];
  const markers = bots(frame)
    .map((marker) => ({
      marker,
      ahead: (marker.x - rider.x) * rider.headingX + (marker.z - rider.z) * rider.headingZ,
    }))
    .sort((one, other) => one.ahead - other.ahead);
  if (markers.length !== drawing.raceBots.length) return [];
  const ids = ride.race.racers
    .map((entry) => entry.racer.id)
    .filter((id) => id !== LAP_RACE_RIDER_ID);
  return drawing.raceBots
    .map((bot, at) => ({ bot, id: ids[at] }))
    .sort((one, other) => one.bot.distanceMetres - other.bot.distanceMetres)
    .flatMap(({ id }, rank) => {
      const tactic = ride.bots.find((one) => one.id === id)?.tactics.tactic;
      const marker = markers[rank]?.marker;
      return tactic !== undefined && tactics.includes(tactic) && marker !== undefined
        ? [marker]
        : [];
    });
}

let ridden: readonly Drawn[] | undefined;
async function scene(): Promise<readonly Drawn[]> {
  ridden ??= await ride();
  return ridden;
}

describe('the demo video’s lap race keeps the field in frame — #3198', () => {
  it('draws a bot in the frame on every captioned frame of the scene', async () => {
    const frames = await scene();
    const under = frames.filter((each) => captioned(each.second));
    expect(under.length).toBeGreaterThan(SCENE.captions.length * FPS * 3);
    const empty = under
      .filter((each) => !bots(each.frame).some((bot) => inFrame(each.frame, bot)))
      .map((each) => each.second);
    expect(empty, 'captioned seconds with no bot in the frame').toEqual([]);
  });

  it('shows a bot attacking or chasing on every frame of the tactics caption', async () => {
    const frames = await scene();
    const under = frames.filter((each) => captioned(each.second, [TACTICS]));
    expect(under.length).toBeGreaterThanOrEqual(TACTICS.seconds * FPS);
    const none = under
      .filter((each) => !botsIn(each, MOVES).some((bot) => inFrame(each.frame, bot)))
      .map((each) => each.second);
    expect(none, 'tactics-caption seconds with no attack or chase in the frame').toEqual([]);
  });

  it('rides the race the frames were drawn from: the scene’s rider in it, from the line', async () => {
    const frames = await scene();
    const last = frames.at(-1)?.ride;
    const rider = last?.race.racers.find((entry) => entry.racer.id === LAP_RACE_RIDER_ID);
    // Under way: well past the line by the scene's end, so the frames above
    // are of a race being ridden and not of the grid.
    expect(rider === undefined ? 0 : racePosition(rider.racer)).toBeGreaterThan(100);
  });

  it('draws no rider the near plane cuts, on any frame of the scene', async () => {
    const frames = await scene();
    let near = 0;
    const cut: string[] = [];
    for (const { second, frame } of frames) {
      const line = riderFadeLine(frame.camera, frame.markers, emptyRiderFadeLine());
      const pyramid = nearPyramid(cameraRig(frame.camera), ASPECT);
      for (const bot of bots(frame)) {
        const { eye } = cameraRig(frame.camera);
        if (Math.hypot(bot.x - eye.x, bot.z - eye.z) < 2) near += 1;
        if (riderBoxCut(bot, pyramid) && riderFaded(bot, line) < 1) cut.push(second.toFixed(1));
      }
    }
    expect(cut, 'seconds with a bot the near plane cuts drawn').toEqual([]);
    // Not vacuous: the pack rides close enough to the camera to be asked.
    expect(near).toBeGreaterThan(0);
  });
});
