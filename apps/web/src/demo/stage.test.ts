// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The demo's loop — #1647: which frames it asks for, which world it draws,
 * and what it says when the realistic world will not load. The renderer and
 * the frame clock are replaced; the player, the pacer and the ladder are the
 * real ones.
 */

import { describe, expect, it } from 'vitest';

import {
  INITIAL_QUALITY,
  INITIAL_REALISTIC_QUALITY,
  qualitySettings,
  REALISTIC_LADDER,
  SUSTAINED_SAMPLES,
  worldRung,
} from '../game/quality';
import {
  REALISTIC_WORLD_LEFT_NOTICE,
  realisticWorldNotice,
  type RealisticWorldOutcome,
} from '../game/realistic-assets';
import { createDemoPlayer } from './player';
import { CLIMB_PRESET } from './presets';
import { startDemoStage, type DemoSnapshot } from './stage';
import { fakeDrawnWorld, fakeRenderer, SteppedFrames, type FakeView } from './stage-testing';

/**
 * Slow frames enough to walk off the bottom of the realistic ladder and no
 * more: each rung takes {@link SUSTAINED_SAMPLES} slow frames, and the pacer's
 * first frame has no frame time to give. Stepping further only rides the real
 * player down the stylised ladder too, which is what made these tests slow.
 */
const FRAMES_TO_LEAVE_REALISM = 1 + REALISTIC_LADDER.length * SUSTAINED_SAMPLES;
/** A frame time the ladder reads as slow — over `FRAME_MS_REDUCE_ABOVE`. */
const SLOW_FRAME_MS = 50;

function stageWith(outcome: Promise<RealisticWorldOutcome> = new Promise(() => undefined)) {
  const frames = new SteppedFrames();
  const { renderer, views } = fakeRenderer(outcome);
  const player = createDemoPlayer(CLIMB_PRESET);
  const snapshots: DemoSnapshot[] = [];
  const stage = startDemoStage({
    canvas: {} as HTMLCanvasElement,
    renderer,
    drawnWorld: fakeDrawnWorld,
    player,
    frames,
    publish: (snapshot) => void snapshots.push(snapshot),
  });
  return { frames, view: views[0] as FakeView, player, stage, snapshots };
}

describe('the demo stage — #1647', () => {
  it('draws one still frame of a paused player, and then asks for nothing', () => {
    const { frames, view, player } = stageWith();
    frames.step(10);
    expect(view.rendered).toHaveLength(1);
    expect(frames.pending).toBe(0);
    expect(player.state.ride.distance).toBe(0);
  });

  it('asks for a frame on every frame while playing, and draws the ride moving', () => {
    const { frames, view, stage, player, snapshots } = stageWith();
    stage.play();
    frames.step(120);
    expect(view.rendered.length).toBeGreaterThan(100);
    expect(frames.pending).toBe(1);
    expect(player.state.ride.distance).toBeGreaterThan(0);
    const last = snapshots.at(-1);
    expect(last).toMatchObject({ state: 'playing', preset: 'climb' });
    expect(last?.framesDrawn).toBe(view.rendered.length);
    expect(last?.distance).toBe(player.state.ride.distance);
  });

  it.each([
    [
      'the page is hidden',
      (stage: ReturnType<typeof stageWith>['stage'], seen: boolean) => stage.setPageVisible(seen),
    ],
    [
      'the canvas is scrolled out of view',
      (stage: ReturnType<typeof stageWith>['stage'], seen: boolean) => stage.setInView(seen),
    ],
  ])('runs no frame callback while %s, and rides none of that time', (_what, set) => {
    const { frames, view, stage, player } = stageWith();
    stage.play();
    frames.step(60);
    const drawn = view.rendered.length;
    const at = player.state.ride.distance;
    set(stage, false);
    const ran = frames.ran;
    frames.step(600);
    expect(frames.ran).toBe(ran);
    expect(frames.pending).toBe(0);
    expect(view.rendered).toHaveLength(drawn);
    set(stage, true);
    frames.step(1);
    // The first frame back draws where the riders were, not ten seconds on.
    expect(player.state.ride.distance).toBe(at);
    frames.step(60);
    expect(player.state.ride.distance).toBeGreaterThan(at);
    expect(player.state.ride.distance - at).toBeLessThan(20);
  });

  it('a pause asks for one still frame and then nothing; play asks again', () => {
    const { frames, view, stage } = stageWith();
    stage.play();
    frames.step(30);
    stage.pause();
    frames.step(1);
    const drawn = view.rendered.length;
    frames.step(120);
    expect(view.rendered).toHaveLength(drawn);
    expect(frames.pending).toBe(0);
    stage.play();
    frames.step(10);
    expect(view.rendered.length).toBeGreaterThan(drawn);
  });

  it('starts in the realistic world, at the top of its ladder', () => {
    const { view, snapshots } = stageWith();
    expect(view.qualities[0]).toEqual(worldRung(INITIAL_REALISTIC_QUALITY));
    expect(snapshots[0]?.world).toBe('realistic');
  });

  it('falls back to the stylised world when the realistic world cannot load, and says so', async () => {
    const outcome: RealisticWorldOutcome = { loaded: false, offline: false, detail: 'refused' };
    const { frames, view, snapshots } = stageWith(Promise.resolve(outcome));
    await Promise.resolve();
    await Promise.resolve();
    expect(view.qualities.at(-1)).toEqual(qualitySettings(INITIAL_QUALITY.level));
    expect(view.qualities.at(-1)?.world).toBe('stylised');
    const notice = realisticWorldNotice(outcome);
    expect(notice).toBeDefined();
    expect(snapshots.at(-1)).toMatchObject({ world: 'stylised', notice });
    // And the paused page draws the stylised world it now holds.
    const drawn = view.rendered.length;
    frames.step(1);
    expect(view.rendered).toHaveLength(drawn + 1);
  });

  it('stays realistic, and says nothing, when the realistic world loads', async () => {
    const { view, snapshots } = stageWith(Promise.resolve({ loaded: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(view.qualities.at(-1)?.world).toBe('realistic');
    expect(snapshots.at(-1)?.notice).toBeUndefined();
  });

  it('steps down the product ladder on slow frames, and says so on leaving realism', () => {
    const { frames, view, stage, snapshots } = stageWith();
    stage.play();
    frames.step(FRAMES_TO_LEAVE_REALISM, SLOW_FRAME_MS);
    expect(view.qualities.length).toBeGreaterThan(1);
    expect(view.qualities.at(-1)?.world).toBe('stylised');
    expect(snapshots.at(-1)).toMatchObject({
      world: 'stylised',
      notice: REALISTIC_WORLD_LEFT_NOTICE,
    });
  });

  describe('says the realistic world is loading until its load settles — #1654', () => {
    it('from the first snapshot, while the files have not arrived', () => {
      const { frames, stage, snapshots } = stageWith();
      stage.play();
      frames.step(30);
      expect(snapshots.length).toBeGreaterThan(1);
      expect(snapshots.every((each) => each.realisticLoading)).toBe(true);
    });

    it.each([
      ['loaded', { loaded: true }],
      ['refused', { loaded: false, offline: false, detail: 'refused' }],
    ])('and no longer once they are %s, on a paused stage', async (_name, outcome) => {
      const { snapshots } = stageWith(Promise.resolve(outcome));
      expect(snapshots.at(-1)?.realisticLoading).toBe(true);
      await Promise.resolve();
      await Promise.resolve();
      expect(snapshots.at(-1)?.realisticLoading).toBe(false);
    });

    it('and no longer when they arrive after the ladder left realism, on a paused stage', async () => {
      let arrive: (outcome: RealisticWorldOutcome) => void = () => undefined;
      const { frames, stage, snapshots } = stageWith(
        new Promise((resolve) => {
          arrive = resolve;
        }),
      );
      stage.play();
      frames.step(FRAMES_TO_LEAVE_REALISM, SLOW_FRAME_MS);
      stage.pause();
      frames.step(1);
      const published = snapshots.length;
      expect(snapshots.at(-1)?.realisticLoading).toBe(true);
      arrive({ loaded: true });
      await Promise.resolve();
      await Promise.resolve();
      expect(snapshots.length).toBeGreaterThan(published);
      expect(snapshots.at(-1)?.realisticLoading).toBe(false);
    });
  });

  it('does not put realism back when the files arrive after the ladder left it', async () => {
    let arrive: (outcome: RealisticWorldOutcome) => void = () => undefined;
    const { frames, view, stage, snapshots } = stageWith(
      new Promise((resolve) => {
        arrive = resolve;
      }),
    );
    stage.play();
    frames.step(FRAMES_TO_LEAVE_REALISM, SLOW_FRAME_MS);
    expect(view.qualities.at(-1)?.world).toBe('stylised');
    const settings = view.qualities.length;
    arrive({ loaded: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(view.qualities).toHaveLength(settings);
    expect(snapshots.at(-1)?.world).toBe('stylised');
  });
});
