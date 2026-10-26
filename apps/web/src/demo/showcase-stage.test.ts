// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The showcase on the stage — #1653. Each cue is shown to change what is
 * drawn by reading the renderer back — the world its last rung draws
 * (`fakeDrawnWorld`, as `three-renderer.ts` §`drawnWorldOf` reads a real
 * view's), the season it was told (`fakeDrawnSeason`, as §`seasonOf`) — and
 * the frame it was handed, never the timeline's own state.
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
import {
  REALISTIC_WORLD_LEFT_NOTICE,
  realisticWorldNotice,
  type RealisticWorldOutcome,
} from '../game/realistic-assets';
import { loadBakedRoute, type BakedRoute } from './baked-route';
import { createDemoPlayer } from './player';
import { CLIMB_PRESET, GROUP_PRESET } from './presets';
import type { DemoPreset } from './script';
import {
  SHOWCASE_TIMELINE,
  showcaseShots,
  type ShowcaseFeature,
  type ShowcaseTimeline,
} from './showcase';
import { startDemoStage, type DemoSnapshot } from './stage';
import {
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
  readonly view: FakeView;
  readonly frames: SteppedFrames;
}

interface RunOptions {
  readonly outcome?: RealisticWorldOutcome;
  readonly route?: BakedRoute;
  readonly timeline?: ShowcaseTimeline;
  readonly reducedMotion?: boolean;
  /** The group's, as `query.ts` rides the showcase, unless a case needs another road. */
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
  const player = createDemoPlayer(options.preset ?? GROUP_PRESET, {
    reducedMotion: options.reducedMotion ?? false,
    route: options.route,
    shots: showcaseShots(timeline),
  });
  if (options.reducedMotion !== true) player.play();
  const snapshots: DemoSnapshot[] = [];
  startDemoStage({
    canvas: {} as HTMLCanvasElement,
    renderer,
    drawnWorld: fakeDrawnWorld,
    drawnSeason: fakeDrawnSeason,
    player,
    frames,
    showcase: { timeline, features: ALL_FEATURES },
    publish: (snapshot) => void snapshots.push(snapshot),
  });
  // The realistic world's load settles before the ride starts.
  await Promise.resolve();
  await Promise.resolve();
  const stepMs = options.stepMs ?? STEP_MS;
  frames.step(Math.ceil(((options.seconds ?? timeline.seconds) * 1000) / stepMs), stepMs);
  return { snapshots, view: views[0] as FakeView, frames };
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

  it('under reduced motion, waits for Play, and every camera move is a cut', async () => {
    const { snapshots } = await run({ reducedMotion: true, seconds: 10 });
    // Every rider on its start line: the group's lead starts 30 m up the road.
    expect(snapshots.every((each) => each.state === 'paused' && each.distance === 30)).toBe(true);
    expect(snapshots.at(-1)?.showcase?.fired).toBe(5);
    const player = createDemoPlayer(GROUP_PRESET, {
      reducedMotion: true,
      shots: showcaseShots(SHOWCASE_TIMELINE),
    });
    expect(player.tour.shots.map((shot) => shot.into)).toEqual(
      showcaseShots(SHOWCASE_TIMELINE).map(() => 'cut'),
    );
    expect(player.tour.pans).toBe(false);
  });
});
