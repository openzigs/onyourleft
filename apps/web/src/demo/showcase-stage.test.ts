// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The showcase on the stage — #1653. Each cue is shown to change what is
 * drawn by reading the renderer back — the world its last rung draws
 * (`fakeDrawnWorld`, as `three-renderer.ts` §`drawnWorldOf` reads a real
 * view's), the season it was told (`fakeDrawnSeason`, as §`seasonOf`), the
 * decorations its own `DecorationBelt` drew (`fakeDrawnDecorations`, as
 * §`decorationBeltOf`) — and the frame it was handed, never the timeline's
 * own state.
 *
 * The clock steps 1.1 s a frame: a gap over a second is never a frame time to
 * the quality ladder (`stage.ts` §`LONGEST_FRAME_MS`), so the fake renderer is
 * not walked out of the realistic world, which is the ladder's test, not this.
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bakeFixtureRouteInto, routeFilesIn } from '../../browser/demo-route-fixture';
import type { SceneFrame } from '../game/port';
import {
  REALISTIC_WORLD_LEFT_NOTICE,
  realisticWorldNotice,
  type RealisticWorldOutcome,
} from '../game/realistic-assets';
import { loadBakedRoute, type BakedRoute } from './baked-route';
import { projectThrough } from './camera-tour-testing';
import { createDemoPlayer, type DemoPlayer } from './player';
import { CLIMB_PRESET } from './presets';
import type { DemoPreset } from './script';
import {
  SHOWCASE_GROUP,
  SHOWCASE_TIMELINE,
  showcaseRides,
  showcaseShots,
  type ShowcaseFeature,
  type ShowcaseTimeline,
} from './showcase';
import { startDemoStage, type DemoSnapshot } from './stage';
import {
  fakeDrawnDecorations,
  fakeDrawnSeason,
  fakeDrawnWorld,
  fakeRenderer,
  SteppedFrames,
  type FakeView,
} from './stage-testing';

const STEP_MS = 1100;
const ALL_FEATURES: ReadonlySet<ShowcaseFeature> = new Set([
  'realistic',
  'season',
  'people',
  'countryside',
]);
const LOADED: RealisticWorldOutcome = { loaded: true };
const FAILED: RealisticWorldOutcome = { loaded: false, offline: false, detail: 'refused' };

const scratch = mkdtempSync(join(tmpdir(), 'oyl-demo-showcase-'));
let fixture: BakedRoute;

beforeAll(async () => {
  await bakeFixtureRouteInto(scratch);
  const files = routeFilesIn(scratch);
  const loaded = await loadBakedRoute('fixture', (path) => {
    const bytes = files.get(path);
    return bytes === undefined ? Promise.reject(new Error(path)) : Promise.resolve(bytes);
  });
  if (loaded.kind !== 'ready') throw new Error('the fixture route did not load');
  fixture = loaded.route;
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

interface Run {
  readonly snapshots: DemoSnapshot[];
  /** The ride each snapshot was published with, for the HUD, its distance then, and the run's. */
  readonly drawn: { readonly ride: DemoPlayer; readonly distance: number; readonly run: number }[];
  readonly village: DemoPlayer;
  readonly view: FakeView;
  readonly frames: SteppedFrames;
}

interface RunOptions {
  readonly outcome?: RealisticWorldOutcome;
  readonly route?: BakedRoute;
  readonly timeline?: ShowcaseTimeline;
  readonly reducedMotion?: boolean;
  /** The showcase's own group (`showcase.ts` §`SHOWCASE_GROUP`), unless a case needs another road. */
  readonly preset?: DemoPreset;
  /** Ride seconds to step through; one pass by default. */
  readonly seconds?: number;
  /** Milliseconds a frame takes; over a second by default, so the ladder never sees a frame time. */
  readonly stepMs?: number;
}

/** The showcase on a stage with every browser seam replaced, stepped from ride time 0. */
async function run(options: RunOptions = {}): Promise<Run> {
  const timeline = options.timeline ?? SHOWCASE_TIMELINE;
  const frames = new SteppedFrames();
  const { renderer, views } = fakeRenderer(Promise.resolve(options.outcome ?? LOADED));
  const reducedMotion = options.reducedMotion ?? false;
  const rides = showcaseRides(timeline, { reducedMotion, route: options.route });
  const player =
    options.preset === undefined
      ? rides.player
      : createDemoPlayer(options.preset, {
          reducedMotion,
          route: options.route,
          shots: showcaseShots(timeline),
        });
  if (!reducedMotion) player.play();
  const snapshots: DemoSnapshot[] = [];
  const drawn: { ride: DemoPlayer; distance: number; run: number }[] = [];
  startDemoStage({
    canvas: {} as HTMLCanvasElement,
    renderer,
    drawnWorld: fakeDrawnWorld,
    drawnSeason: fakeDrawnSeason,
    drawnDecorations: fakeDrawnDecorations,
    player,
    frames,
    showcase: { timeline, features: ALL_FEATURES, village: rides.village },
    publish: (snapshot, ride) => {
      snapshots.push(snapshot);
      drawn.push({ ride, distance: ride.state.ride.distance, run: player.state.ride.distance });
    },
  });
  // The realistic world's load settles before the ride starts.
  await Promise.resolve();
  await Promise.resolve();
  const stepMs = options.stepMs ?? STEP_MS;
  frames.step(Math.ceil(((options.seconds ?? timeline.seconds) * 1000) / stepMs), stepMs);
  return { snapshots, drawn, village: rides.village, view: views[0] as FakeView, frames };
}

/**
 * The snapshots of pass `number` published for a frame drawn — the frame count
 * moved — so a publish between frames (the realistic world's load) is not one.
 */
function pass(snapshots: readonly DemoSnapshot[], number = 1): DemoSnapshot[] {
  return snapshots.filter(
    (each, index) =>
      each.showcase?.pass === number &&
      each.state === 'playing' &&
      each.framesDrawn > (snapshots[index - 1]?.framesDrawn ?? 0),
  );
}

/** The last snapshot of pass 1 at or before ride second `seconds`. */
function at(snapshots: readonly DemoSnapshot[], seconds: number): DemoSnapshot | undefined {
  return pass(snapshots)
    .filter((each) => (each.showcase?.seconds ?? 0) <= seconds)
    .at(-1);
}

describe('the showcase on the stage — #1653', () => {
  it('a world cue changes the world the renderer draws', async () => {
    const { snapshots } = await run({ seconds: 12 });
    expect(at(snapshots, 6)?.world).toBe('stylised');
    expect(at(snapshots, 9)?.world).toBe('realistic');
    expect(at(snapshots, 9)?.skipped).not.toContain('world realistic at 7');
  });

  it('with the realistic world unloaded, skips its cue and its caption, and says why', async () => {
    const { snapshots } = await run({ outcome: FAILED, seconds: 12 });
    expect(pass(snapshots).every((each) => each.world === 'stylised')).toBe(true);
    expect(at(snapshots, 9)?.skipped).toEqual(
      expect.arrayContaining(['world realistic at 7', 'caption at 7.5']),
    );
    expect(pass(snapshots).map((each) => each.showcase?.caption)).not.toContain(
      'And the realistic world',
    );
    expect(snapshots.at(-1)?.notice).toBe(realisticWorldNotice(FAILED));
  });

  it('does not put the realistic world back on the next pass once the ladder has left it', async () => {
    // Slow frames walk the ladder off the realistic world after its cue; the
    // timeline loops and its cue comes round again on a device the ladder
    // judged unable to draw it.
    const timeline: ShowcaseTimeline = {
      seconds: 6,
      cues: [
        { at: 0, kind: 'shot', shot: 'behind', into: 'cut' },
        { at: 0, kind: 'world', world: 'stylised' },
        { at: 1, kind: 'world', world: 'realistic' },
      ],
    };
    const { snapshots, view } = await run({ timeline, seconds: 14, stepMs: 50 });
    // The cue at 1 s made the world realistic once; the ladder then left it.
    const worlds = view.qualities.map((each) => each.world);
    expect(worlds.slice(worlds.lastIndexOf('realistic'))).toEqual(
      worlds
        .slice(worlds.lastIndexOf('realistic'))
        .map((_, index) => (index === 0 ? 'realistic' : 'stylised')),
    );
    expect(pass(snapshots, 1).some((each) => each.world === 'realistic')).toBe(true);
    // The second pass rides all of its length in the stylised world.
    expect(pass(snapshots, 2).length).toBeGreaterThan(0);
    expect(pass(snapshots, 2).every((each) => each.world === 'stylised')).toBe(true);
    const last = snapshots.at(-1);
    expect(last?.showcase?.pass).toBeGreaterThan(1);
    expect(last).toMatchObject({ world: 'stylised', notice: REALISTIC_WORLD_LEFT_NOTICE });
    expect(last?.skipped).toContain('world realistic at 1');
  });

  it('a season cue changes the season the view holds: none, then Halloween, then winter lights', async () => {
    const { snapshots, view } = await run({ seconds: 46 });
    expect(at(snapshots, 33)?.showcase?.holiday).toBe('none');
    expect(at(snapshots, 36)?.showcase?.holiday).toBe('halloween');
    expect(at(snapshots, 45)?.showcase?.holiday).toBe('winter-lights');
    // From a fixed date, so the same days every time; the synthetic road is
    // on the equator, so its nature has no autumn or winter.
    expect(view.seasons.map((each) => each.holiday)).toEqual([
      undefined,
      undefined,
      'halloween',
      'winter-lights',
    ]);
  });

  it('a people cue changes how many people the frame drawn carries', async () => {
    // People stand on a village's pavements: the climb's synthetic road has
    // one from its start (the group's has none), so the climb rides it here.
    const on = await run({ preset: CLIMB_PRESET, seconds: 34 });
    const off = await run({
      preset: CLIMB_PRESET,
      seconds: 34,
      timeline: {
        ...SHOWCASE_TIMELINE,
        cues: SHOWCASE_TIMELINE.cues.filter((cue) => !(cue.kind === 'people' && cue.on)),
      },
    });
    expect(pass(off.snapshots).every((each) => each.showcase?.people === 0)).toBe(true);
    expect(
      pass(on.snapshots)
        .filter((each) => (each.showcase?.seconds ?? 0) < 26)
        .every((each) => each.showcase?.people === 0),
    ).toBe(true);
    expect(
      Math.max(...pass(on.snapshots).map((each) => each.showcase?.people ?? 0)),
    ).toBeGreaterThan(0);
  });

  it('a countryside cue changes the scenery the frame drawn carries, on mapped land', async () => {
    // #1542's levers read mapped land only, which on the fixture route the
    // group reaches after about a minute: so a timeline that switches the
    // countryside on there, against the same timeline that never does.
    const timeline = (on: boolean): ShowcaseTimeline => ({
      seconds: 90,
      cues: [
        { at: 0, kind: 'shot', shot: 'behind', into: 'cut' },
        { at: 0, kind: 'countryside', on: false },
        ...(on ? [{ at: 70, kind: 'countryside' as const, on: true }] : []),
      ],
    });
    const on = await run({ route: fixture, timeline: timeline(true) });
    const off = await run({ route: fixture, timeline: timeline(false) });
    const digests = (snapshots: readonly DemoSnapshot[], from: number, to: number): number[] =>
      pass(snapshots)
        .filter(
          (each) => (each.showcase?.seconds ?? 0) >= from && (each.showcase?.seconds ?? 0) < to,
        )
        .map((each) => each.showcase?.scenery ?? 0);
    expect(digests(on.snapshots, 0, 70)).toEqual(digests(off.snapshots, 0, 70));
    expect(digests(on.snapshots, 70, 90)).not.toEqual(digests(off.snapshots, 70, 90));
    // And without map data the cue is skipped, as `showcase-features.test.ts` reads.
    expect(on.snapshots.at(-1)?.skipped).toEqual([]);
  });

  it('shows each caption for at least 3 s of ride, in order', async () => {
    const { snapshots } = await run({ route: fixture });
    const shown = new Map<string, number[]>();
    for (const each of pass(snapshots)) {
      const caption = each.showcase?.caption;
      if (caption !== undefined)
        shown.set(caption, [...(shown.get(caption) ?? []), each.showcase?.seconds ?? 0]);
    }
    expect([...shown.keys()]).toEqual([
      'The stylised world',
      'And the realistic world',
      'Countryside planted by what the map says the land is',
      'People on the pavements and paths',
      'The season from the date: Halloween',
      'And winter lights in December',
      'Ride as a group',
    ]);
    for (const [caption, seconds] of shown) {
      // From its first frame to the first frame after it: at least 3 s up.
      expect(
        Math.max(...seconds) - Math.min(...seconds) + STEP_MS / 1000,
        caption,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('is deterministic: two runs fire the same cues at the same times and publish the same snapshots', async () => {
    const first = await run({ route: fixture });
    const second = await run({ route: fixture });
    const firings = (snapshots: readonly DemoSnapshot[]): [number, number][] =>
      pass(snapshots).flatMap((each, index, all) =>
        each.showcase?.fired !== all[index - 1]?.showcase?.fired
          ? [[each.showcase?.seconds ?? 0, each.showcase?.fired ?? 0] as [number, number]]
          : [],
      );
    expect(firings(first.snapshots).length).toBeGreaterThan(10);
    expect(firings(second.snapshots)).toEqual(firings(first.snapshots));
    expect(JSON.stringify(second.snapshots)).toBe(JSON.stringify(first.snapshots));
  });

  it('loops: after the last cue it rides again from 0 without a reload, and the second pass is the first', async () => {
    const { snapshots } = await run({ route: fixture, seconds: 2 * SHOWCASE_TIMELINE.seconds + 2 });
    const digest = (number: number): string =>
      createHash('sha256')
        .update(
          JSON.stringify(
            // The frame count runs on across passes, and the pass is the pass.
            pass(snapshots, number).map((each) => ({
              ...each,
              framesDrawn: 0,
              showcase: { ...each.showcase, pass: 0 },
            })),
          ),
        )
        .digest('hex');
    expect(pass(snapshots, 2).length).toBeGreaterThan(10);
    expect(pass(snapshots, 2)[0]?.distance).toBeLessThan(pass(snapshots, 1).at(-1)?.distance ?? 0);
    expect(digest(2)).toBe(digest(1));
  });

  it('a season cue puts the holiday’s decorations in the scene, on the village stretch: read off the view’s belt', async () => {
    const { snapshots, drawn, village } = await run({ seconds: 70 });
    const drawnFrames = pass(snapshots);
    const between = (from: number, to: number): DemoSnapshot[] =>
      drawnFrames.filter(
        (each) => (each.showcase?.seconds ?? 0) >= from && (each.showcase?.seconds ?? 0) < to,
      );
    // On the run's road, before the season: no holiday and no village.
    expect(between(0, 34).length).toBeGreaterThan(10);
    expect(
      between(0, 34).every(
        (each) => each.showcase?.stretch === 'route' && each.showcase.decorations === 0,
      ),
    ).toBe(true);
    // On the village stretch from the season's first moment to the roadside
    // cut; Halloween's decorations, then the winter lights', on every frame
    // of the season's two moments.
    expect(between(34, 62).every((each) => each.showcase?.stretch === 'village')).toBe(true);
    const halloween = between(34, 42);
    const winter = between(42, 50);
    expect(halloween.length).toBeGreaterThan(5);
    for (const each of [...halloween, ...winter]) {
      expect(each.showcase?.decorations, String(each.showcase?.seconds)).toBeGreaterThan(0);
    }
    expect(halloween.every((each) => each.showcase?.holiday === 'halloween')).toBe(true);
    expect(winter.every((each) => each.showcase?.holiday === 'winter-lights')).toBe(true);
    // Each holiday places its own: the two moments draw different decorations.
    expect(halloween.at(-1)?.showcase?.decorations).not.toBe(winter.at(-1)?.showcase?.decorations);
    // Back on the run's road at the roadside cut, which has no village.
    expect(
      between(62, 70).every(
        (each) => each.showcase?.stretch === 'route' && each.showcase.decorations === 0,
      ),
    ).toBe(true);
    // The HUD reads the ride drawn: the village's, while it is drawn.
    snapshots.forEach((each, index) => {
      expect(drawn[index]?.ride === village).toBe(each.showcase?.stretch === 'village');
      expect(each.distance).toBe(drawn[index]?.distance);
    });
  });

  it('without the village stretch, the season moments draw no decoration: the group’s road has no village', async () => {
    const { snapshots } = await run({
      seconds: 50,
      timeline: {
        ...SHOWCASE_TIMELINE,
        cues: SHOWCASE_TIMELINE.cues.filter((cue) => cue.kind !== 'stretch'),
      },
    });
    const seasonal = pass(snapshots).filter((each) => (each.showcase?.seconds ?? 0) >= 34);
    expect(seasonal.length).toBeGreaterThan(5);
    expect(seasonal.every((each) => each.showcase?.holiday !== 'none')).toBe(true);
    expect(seasonal.every((each) => each.showcase?.decorations === 0)).toBe(true);
  });

  it.each([
    ['landscape', 16 / 9],
    ['portrait', 9 / 16],
  ])('the group overhead frames all four riders together (%s)', async (_, aspect) => {
    const { view, snapshots } = await run({ seconds: 62 });
    /** The furthest any rider's hips are from the middle of the frame, as the renderer aims it. */
    const worst = (frame: SceneFrame): number =>
      Math.max(
        ...frame.markers.map((marker) => {
          const seen = projectThrough(
            frame.camera,
            { x: marker.x, y: marker.y + 1, z: marker.z },
            aspect,
          );
          return seen.depth > 0 ? Math.max(Math.abs(seen.x), Math.abs(seen.y)) : Infinity;
        }),
      );
    // From the end of the overhead's blend to the roadside cut.
    const overhead = view.rendered.filter((_, index) => {
      const seconds = snapshots.filter((each) => each.framesDrawn === index + 1).at(-1)
        ?.showcase?.seconds;
      return seconds !== undefined && seconds >= 51.5 && seconds < 62;
    });
    expect(overhead.length).toBeGreaterThan(5);
    for (const frame of overhead) {
      expect(frame.markers).toHaveLength(SHOWCASE_GROUP.riders.length);
      expect(worst(frame)).toBeLessThan(0.9);
    }
  });

  it('publishes the drawn ride’s distance: the village’s on its stretch, where the run’s differs', async () => {
    // The climb's lone rider rides harder than the group: the two rides part.
    const { snapshots, drawn, village } = await run({ preset: CLIMB_PRESET, seconds: 40 });
    const stretch = drawn.filter((each) => each.ride === village);
    expect(stretch.length).toBeGreaterThan(3);
    expect(stretch.every((each) => each.distance !== each.run)).toBe(true);
    snapshots.forEach((each, index) => expect(each.distance).toBe(drawn[index]?.distance));
  });

  it('plays, pauses and stops the village stretch’s ride with the run’s, so both keep one clock', async () => {
    const frames = new SteppedFrames();
    const { renderer } = fakeRenderer(Promise.resolve(LOADED));
    const { player, village } = showcaseRides(SHOWCASE_TIMELINE, { reducedMotion: false });
    player.play();
    const stage = startDemoStage({
      canvas: {} as HTMLCanvasElement,
      renderer,
      drawnWorld: fakeDrawnWorld,
      player,
      frames,
      showcase: { timeline: SHOWCASE_TIMELINE, features: ALL_FEATURES, village },
      publish: () => undefined,
    });
    await Promise.resolve();
    frames.step(20, 500);
    expect(village.status).toBe('playing');
    expect(village.rideMs).toBe(player.rideMs);
    stage.pause();
    expect(village.status).toBe('paused');
    // Ten seconds of clock while paused, with a still frame drawn in them.
    frames.step(20, 500);
    stage.play();
    frames.step(20, 500);
    expect(village.rideMs).toBeGreaterThan(0);
    expect(village.rideMs).toBe(player.rideMs);
    stage.stop();
    expect(village.status).toBe('stopped');
    expect(village.rideMs).toBe(0);
    stage.play();
    frames.step(10, 500);
    expect(village.rideMs).toBe(player.rideMs);
  });

  it('under reduced motion, waits for Play, and every camera move is a cut', async () => {
    const { snapshots } = await run({ reducedMotion: true, seconds: 10 });
    // Every rider on its start line: the lead starts at the head of the group.
    const start = SHOWCASE_GROUP.riders[0]?.startMetres;
    expect(snapshots.every((each) => each.state === 'paused' && each.distance === start)).toBe(
      true,
    );
    expect(snapshots.at(-1)?.showcase?.fired).toBe(6);
    const player = createDemoPlayer(SHOWCASE_GROUP, {
      reducedMotion: true,
      shots: showcaseShots(SHOWCASE_TIMELINE),
    });
    expect(player.tour.shots.map((shot) => shot.into)).toEqual(
      showcaseShots(SHOWCASE_TIMELINE).map(() => 'cut'),
    );
    expect(player.tour.pans).toBe(false);
  });
});
