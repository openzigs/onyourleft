// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A feature whose module is gone is skipped, and the skip is visible — #1653.
 *
 * `../game/season` is mocked with no `seasonOn`, the export the showcase
 * tells the view the season with: a build in which #1622 had not landed.
 * The whole stage then runs the timeline, and what it published is read.
 */

import { describe, expect, it, vi } from 'vitest';

import { featuresInBuild } from './showcase-features';
import { createDemoPlayer } from './player';
import { GROUP_PRESET } from './presets';
import { SHOWCASE_TIMELINE, showcaseShots } from './showcase';
import { startDemoStage, type DemoSnapshot } from './stage';
import { fakeDrawnSeason, fakeDrawnWorld, fakeRenderer, SteppedFrames } from './stage-testing';

vi.mock('../game/season', async (importOriginal) => {
  // Undefined rather than absent: vitest refuses a read of a key a mock lacks.
  return { ...(await importOriginal<typeof import('../game/season')>()), seasonOn: undefined };
});

describe('a showcase feature that is not in the build — #1653', () => {
  it('is not among the build’s features; the others are', () => {
    expect([...featuresInBuild()].sort()).toEqual(['countryside', 'people', 'realistic']);
  });

  it('has its cues skipped and listed in __oylDemo.skipped, and no caption claims it', async () => {
    const frames = new SteppedFrames();
    const { renderer, views } = fakeRenderer(Promise.resolve({ loaded: true }));
    const player = createDemoPlayer(GROUP_PRESET, {
      reducedMotion: false,
      shots: showcaseShots(SHOWCASE_TIMELINE),
    });
    player.play();
    const snapshots: DemoSnapshot[] = [];
    startDemoStage({
      canvas: {} as HTMLCanvasElement,
      renderer,
      drawnWorld: fakeDrawnWorld,
      drawnSeason: fakeDrawnSeason,
      player,
      frames,
      showcase: { timeline: SHOWCASE_TIMELINE, features: featuresInBuild() },
      publish: (snapshot) => void snapshots.push(snapshot),
    });
    // The realistic world's load settles.
    await Promise.resolve();
    // 50 s of ride at 4 Hz: past both season moments.
    frames.step(200, 250);
    const last = snapshots.at(-1);
    // The season's cues, and the captions that name it: and no other skip is the season's.
    const seasonal = /^season |^caption at (34\.5|42\.5)$/;
    expect(last?.skipped.filter((each) => seasonal.test(each))).toEqual([
      'season none at 0',
      'season 2026-10-31 at 34',
      'caption at 34.5',
      'season 2026-12-20 at 42',
      'caption at 42.5',
    ]);
    // The synthetic road has no map data, so the countryside is skipped too, and says so.
    expect(last?.skipped).toEqual(
      expect.arrayContaining(['countryside off at 0', 'countryside on at 16', 'caption at 16.5']),
    );
    const shown = new Set(snapshots.map((each) => each.showcase?.caption).filter(Boolean));
    expect([...shown].some((caption) => /season|Halloween|winter/i.test(caption ?? ''))).toBe(
      false,
    );
    // The view was told no season by the showcase: only the stage's opening one.
    expect(views[0]?.seasons.every((season) => season.holiday === undefined)).toBe(true);
    expect(last?.showcase?.holiday).toBe('none');
  });
});
